param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$ExePath,
  [Parameter(Mandatory=$true)][string]$ExpectedExe,
  [Parameter(Mandatory=$true)][string]$TestRoot,
  [switch]$CheckWidget,
  [switch]$ModernSetup,
  [switch]$CheckFrame,
  [switch]$CheckBenchmarks,
  [string]$BenchmarkActivityDb
)
$ErrorActionPreference = 'Stop'
if ($CheckBenchmarks -and (-not $BenchmarkActivityDb -or -not (Test-Path -LiteralPath $BenchmarkActivityDb))) { throw 'CheckBenchmarks requires the synthetic output_speed_checks activity.sqlite via BenchmarkActivityDb' }
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testPath = [IO.Path]::GetFullPath($TestRoot)
if (-not $testPath.StartsWith(($workspace + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'TestRoot must be inside this workspace' }
if (Test-Path -LiteralPath $testPath) { throw 'Use a new TestRoot' }
$exe = (Resolve-Path -LiteralPath $ExePath).Path
$installPath = Split-Path -Parent $exe
$registryPaths = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
$existing = @(Get-ItemProperty $registryPaths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Quota' })
if ($existing.Count -ne 1 -or $existing[0].InstallLocation.Trim('"') -ne $installPath) { throw 'Installed Quota directory does not match the explicit target' }
if (@(Get-Process quota -ErrorAction SilentlyContinue | Where-Object { $_.Path -ne $exe }).Count) { throw 'A different Quota instance is running' }
$previousVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
$expectedVersion = (Get-Content -LiteralPath (Join-Path $workspace 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
New-Item -ItemType Directory -Path $testPath | Out-Null
foreach ($name in @('quota.exe','WebView2Loader.dll','uninstall.exe')) {
  $file = Join-Path $installPath $name
  if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination (Join-Path $testPath ('original-' + $name)) }
}
$data = Join-Path $testPath 'isolated-data'
New-Item -ItemType Directory -Path $data | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$config = @{version=1;accounts=@();settings=@{notifyRecharge=$false;trayAlert=$false;ladderAutoUpdate=$false;autoRefresh=$false;refreshIntervalMinutes=30;notifyLowBalance=$false;closeToTray=$false;defaultLowThreshold=20}} | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $data 'config.json'),$config,$utf8)
$options = @{deviceId=[guid]::NewGuid().ToString();deviceName='覆盖升级验证';autoCollect=$false;collectIntervalSeconds=30;syncAccounts=$false;codexHome='';zcodeHome='';harnessHome='';traeHome='';traeEnabled=$false;syncDir=''} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $data 'activity-settings.json'),$options,$utf8)
$resume = @(Get-Process quota -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })
$personalHashes = @{}
$previousSetupSmoke=$env:QUOTA_SETUP_SMOKE
$previousSetupReport=$env:QUOTA_SETUP_SMOKE_REPORT
$previousWebView=$env:WEBVIEW2_USER_DATA_FOLDER
try {
  foreach ($instance in $resume) { Stop-Process -Id $instance.Id }
  $env:WEBVIEW2_USER_DATA_FOLDER=Join-Path $testPath 'WebViewProfile'
  foreach ($name in @('config.json','vendor-costs.json','monthly-usage-fx.json','monthly-average-fx.json','activity-settings.json','activity.sqlite','activity.sqlite-wal','appearance.json','usage-widget.json')) {
    $file = Join-Path (Join-Path $env:APPDATA 'Quota') $name
    if (Test-Path -LiteralPath $file) { $personalHashes[$file] = (Get-FileHash -LiteralPath $file).Hash }
  }
  $startParams=@{FilePath=$Installer;PassThru=$true;WindowStyle='Hidden'}
  if($ModernSetup){$env:QUOTA_SETUP_SMOKE='1';$env:QUOTA_SETUP_SMOKE_REPORT=Join-Path $testPath 'modern-setup.json'}
  else{$startParams.ArgumentList=@('/S','/NS','/UPDATE',('/D=' + $installPath))}
  $install = Start-Process @startParams
  if (-not $install.WaitForExit(240000)) { throw 'Installer did not complete within 240 seconds' }
  if ($install.ExitCode -ne 0) { throw "Installer exit code $($install.ExitCode)" }
  if($ModernSetup){$modern=Get-Content -LiteralPath $env:QUOTA_SETUP_SMOKE_REPORT -Raw|ConvertFrom-Json;if(-not($modern.passed -and $modern.bootstrap -and $modern.frontendLoaded -and $modern.finishRendered)){throw 'Modern setup bootstrap, engine or WebView verification failed'}}
  $env:QUOTA_SETUP_SMOKE=$previousSetupSmoke
  $env:QUOTA_SETUP_SMOKE_REPORT=$previousSetupReport
  $version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  if ($version -notmatch ('^' + [regex]::Escape($expectedVersion) + '(\.|$)')) { throw "Unexpected version $version" }
  # NSIS embeds its own bundle-type marker. Compare with the executable extracted
  # from this installer, rather than the separately marked portable executable.
  $builtExe = (Resolve-Path -LiteralPath $ExpectedExe).Path
  if ((Get-FileHash -LiteralPath $exe).Hash -ne (Get-FileHash -LiteralPath $builtExe).Hash) { throw 'Installed binary does not match the validated build' }
  if ((Get-FileHash -LiteralPath (Join-Path $installPath 'WebView2Loader.dll')).Hash -ne (Get-FileHash -LiteralPath (Join-Path $workspace 'src-tauri\WebView2Loader.dll')).Hash) { throw 'Installed loader hash mismatch' }
  foreach ($file in $personalHashes.Keys) { if ((Get-FileHash -LiteralPath $file).Hash -ne $personalHashes[$file]) { throw 'Installer changed personal application data' } }
  & (Join-Path $PSScriptRoot 'check-install.ps1') -ExePath $exe -DataDir $data
  if ($CheckWidget) { & (Join-Path $PSScriptRoot 'check-widget.ps1') -ExePath $exe -DataDir $data }
  if ($CheckFrame) { & (Join-Path $PSScriptRoot 'check-window-frame.ps1') -ExePath $exe -DataDir (Join-Path $testPath 'frame-data') }
  if ($CheckBenchmarks) { & (Join-Path $PSScriptRoot 'check-benchmark-ui.ps1') -ExePath $exe -DataDir (Join-Path $testPath 'benchmark-data') -ActivityDb $BenchmarkActivityDb }
  $evidence = @{previousVersion=$previousVersion;version=$version;kind='existing-install-overwrite';actualUpgradeVerified=$true;personalFilesUnchanged=$personalHashes.Count;startupSeconds=8;installerSha256=(Get-FileHash -LiteralPath $Installer).Hash.ToLowerInvariant()}
  if($ModernSetup){$evidence.modernSetup=$modern}
  [IO.File]::WriteAllText((Join-Path $testPath 'evidence.json'),($evidence | ConvertTo-Json -Depth 6),$utf8)
  Write-Output "PASS installed overwrite $previousVersion -> $version; build and loader hashes match; personal data retained"
} finally {
  $env:QUOTA_SETUP_SMOKE=$previousSetupSmoke
  $env:QUOTA_SETUP_SMOKE_REPORT=$previousSetupReport
  $env:WEBVIEW2_USER_DATA_FOLDER=$previousWebView
  if ($resume.Count -and -not @(Get-Process quota -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe }).Count) { Start-Process -FilePath $exe -WindowStyle Hidden | Out-Null }
}
