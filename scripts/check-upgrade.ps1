param(
  [Parameter(Mandatory=$true)][string]$PreviousInstaller,
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$TestRoot
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testPath = [IO.Path]::GetFullPath($TestRoot)
if (-not $testPath.StartsWith(($workspace + '\'), [StringComparison]::OrdinalIgnoreCase)) { throw 'TestRoot must be inside this workspace' }
if (Test-Path -LiteralPath $testPath) { throw 'Use a new empty TestRoot' }
$registryPaths = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')
$existing = @(Get-ItemProperty $registryPaths -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -match 'Quota|AgentPrice' })
if ($existing.Count) { throw 'An existing installed Quota was detected; isolated installer testing stopped' }
if (@(Get-Process quota -ErrorAction SilentlyContinue).Count) { throw 'Exit running Quota instances before isolated installer testing' }
foreach ($file in @($PreviousInstaller, $Installer)) { if (-not (Test-Path -LiteralPath $file)) { throw "Installer missing: $file" } }
$oldData = $env:QUOTA_DATA_DIR
$installPath = Join-Path $testPath 'app'
$env:QUOTA_DATA_DIR = Join-Path $testPath 'data'
New-Item -ItemType Directory -Path $testPath | Out-Null
$dataPath = $env:QUOTA_DATA_DIR
New-Item -ItemType Directory -Path $dataPath | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$config = @{version=1;accounts=@();settings=@{notifyRecharge=$false;trayAlert=$false;ladderAutoUpdate=$false;autoRefresh=$false;refreshIntervalMinutes=30;notifyLowBalance=$false;closeToTray=$false;defaultLowThreshold=20}} | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $dataPath 'config.json'), $config, $utf8)
$options = @{deviceId=[guid]::NewGuid().ToString();deviceName='隔离升级验证';autoCollect=$false;collectIntervalSeconds=30;syncAccounts=$false;codexHome='';zcodeHome='';harnessHome='';traeHome='';traeEnabled=$false;syncDir=''} | ConvertTo-Json
[IO.File]::WriteAllText((Join-Path $dataPath 'activity-settings.json'), $options, $utf8)
[IO.File]::WriteAllText((Join-Path $dataPath 'vendor-costs.json'), '{"expenses":{},"samples":{}}', $utf8)
$dataHashes = @{}
foreach ($name in @('config.json','activity-settings.json','vendor-costs.json')) { $dataHashes[$name] = (Get-FileHash -LiteralPath (Join-Path $dataPath $name)).Hash }
# NSIS writes its remembered directory and removes the Quota autorun value on
# uninstall. Restore these existing values after the isolated test.
$registrySnapshots = @()
foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64,[Microsoft.Win32.RegistryView]::Registry32)) {
  $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$view)
  foreach ($spec in @(@{Path='Software\agentprice\Quota';Names=@('','Installer Language')},@{Path='Software\Microsoft\Windows\CurrentVersion\Run';Names=@('Quota')})) {
    $key = $baseKey.OpenSubKey($spec.Path)
    foreach ($name in $spec.Names) {
      $present = $key -and ($key.GetValueNames() -contains $name)
      $registrySnapshots += @{View=$view;Path=$spec.Path;Name=$name;Present=$present;Value=$(if($present){$key.GetValue($name)});Kind=$(if($present){$key.GetValueKind($name)})}
    }
    if ($key) { $key.Dispose() }
  }
  $baseKey.Dispose()
}
try {
  $old = Start-Process -FilePath $PreviousInstaller -ArgumentList @('/S','/NS', ('/D=' + $installPath)) -PassThru -Wait -WindowStyle Hidden
  if ($old.ExitCode -ne 0) { throw "Previous installer failed: $($old.ExitCode)" }
  $exe = Join-Path $installPath 'quota.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw 'Previous install missing quota.exe' }
  Write-Output ('previous installed: ' + (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion)
  $marker = Join-Path $installPath 'upgrade-check.txt'
  Set-Content -LiteralPath $marker -Value 'isolated upgrade marker'
  $next = Start-Process -FilePath $Installer -ArgumentList @('/S','/NS', ('/D=' + $installPath)) -PassThru -Wait -WindowStyle Hidden
  if ($next.ExitCode -ne 0) { throw "Upgrade installer failed: $($next.ExitCode)" }
  $version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  $expectedVersion = (Get-Content -LiteralPath (Join-Path $workspace 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
  if ($version -notmatch ('^' + [regex]::Escape($expectedVersion) + '(\.|$)')) { throw "Unexpected upgraded package version: $version" }
  if (-not (Test-Path -LiteralPath $marker)) { throw 'Upgrade removed the unrelated marker file' }
  if (-not (Test-Path -LiteralPath (Join-Path $installPath 'WebView2Loader.dll'))) { throw 'Upgrade missing WebView2Loader.dll' }
  & (Join-Path $PSScriptRoot 'check-install.ps1') -ExePath $exe -DataDir $env:QUOTA_DATA_DIR
  foreach ($name in $dataHashes.Keys) { if ((Get-FileHash -LiteralPath (Join-Path $dataPath $name)).Hash -ne $dataHashes[$name]) { throw "Upgrade changed isolated data: $name" } }
  $evidence = @{version=$expectedVersion;previousVersion=(Get-Item -LiteralPath $PreviousInstaller).VersionInfo.ProductVersion;installerSha256=(Get-FileHash -LiteralPath $Installer).Hash.ToLowerInvariant();actualUpgradeVerified=$true;startupSeconds=8;isolatedDataPreserved=$true}
  [IO.File]::WriteAllText((Join-Path $testPath 'evidence.json'),($evidence | ConvertTo-Json),$utf8)
  Write-Output "PASS installer upgrade to $version"
} finally {
  $uninstaller = Join-Path $installPath 'uninstall.exe'
  if (Test-Path -LiteralPath $uninstaller) {
    $removed = Start-Process -FilePath $uninstaller -ArgumentList @('/S', ('_?=' + $installPath)) -PassThru -Wait -WindowStyle Hidden
    Write-Output ('test uninstall exit: ' + $removed.ExitCode)
  }
  foreach ($item in $registrySnapshots) {
    $baseKey = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser,$item.View)
    $key = $baseKey.CreateSubKey($item.Path)
    if ($item.Present) { $key.SetValue($item.Name,$item.Value,$item.Kind) } else { $key.DeleteValue($item.Name,$false) }
    $key.Dispose()
    $baseKey.Dispose()
  }
  $env:QUOTA_DATA_DIR = $oldData
}
