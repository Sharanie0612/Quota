param(
  [Parameter(Mandatory=$true)][string]$BaselineInstaller,
  [Parameter(Mandatory=$true)][string]$Installer,
  [Parameter(Mandatory=$true)][string]$ExpectedVersion,
  [Parameter(Mandatory=$true)][string]$TestRoot
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'This install check only runs on disposable GitHub-hosted runners' }
$testPath = [IO.Path]::GetFullPath($TestRoot)
$runnerPath = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\') + '\'
if (-not $testPath.StartsWith($runnerPath, [StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $testPath)) { throw 'TestRoot must be a new directory within RUNNER_TEMP' }
$installDir = Join-Path $testPath 'app'
$data = Join-Path $testPath 'data'
$extracted = Join-Path $testPath 'extracted'
New-Item -ItemType Directory -Path $installDir,$data,$extracted | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$settings = @{notifyRecharge=$false;trayAlert=$false;ladderAutoUpdate=$false;autoRefresh=$false;refreshIntervalMinutes=30;notifyLowBalance=$false;closeToTray=$false;defaultLowThreshold=20}
$config = @{version=1;accounts=@();settings=$settings}
$activity = @{deviceId=[guid]::NewGuid().ToString();deviceName='Release upgrade check';autoCollect=$false;collectIntervalSeconds=30;syncAccounts=$false;codexHome='';zcodeHome='';syncDir='';harnessHome='';traeHome='';traeEnabled=$false;codexSshDevices=@()}
foreach ($entry in @(@('config.json',$config),@('activity-settings.json',$activity),@('usage-widget.json',@{enabled=$false;side='right';heightPercent=50}))) {
  [IO.File]::WriteAllText((Join-Path $data $entry[0]),($entry[1] | ConvertTo-Json -Depth 8),$utf8)
}
function Install-Package([string]$File, [switch]$Update) {
  $arguments = @('/S','/NS')
  if ($Update) { $arguments += '/UPDATE' }
  $arguments += ('/D=' + $installDir)
  $process = Start-Process -FilePath (Resolve-Path -LiteralPath $File).Path -ArgumentList $arguments -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit(60000)) { throw 'Installer timeout' }
  if ($process.ExitCode -ne 0) { throw "Installer failed: $($process.ExitCode)" }
}
$previousData = $env:QUOTA_DATA_DIR
$env:QUOTA_DATA_DIR = $data
$exe = Join-Path $installDir 'quota.exe'
try {
  Install-Package $BaselineInstaller
  if (-not (Test-Path -LiteralPath $exe)) { throw 'Baseline installer did not create the expected application' }
  $oldVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  if ([version]$oldVersion -ge [version]$ExpectedVersion) { throw "Baseline $oldVersion is not older than $ExpectedVersion" }
  & (Join-Path $PSScriptRoot 'check-install.ps1') -ExePath $exe -DataDir $data
  $hashes = @{}
  foreach ($name in @('config.json','activity-settings.json')) { $hashes[$name] = (Get-FileHash -LiteralPath (Join-Path $data $name)).Hash }
  Install-Package $Installer -Update
  $actualVersion = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  if ($actualVersion -ne $ExpectedVersion) { throw "Unexpected installed version $actualVersion" }
  foreach ($name in $hashes.Keys) { if ((Get-FileHash -LiteralPath (Join-Path $data $name)).Hash -ne $hashes[$name]) { throw "Installer changed isolated data: $name" } }
  $sevenZip = (Get-Command 7z.exe -ErrorAction Stop).Source
  & $sevenZip x $Installer ('-o' + $extracted) -y | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Cannot extract candidate installer' }
  if ((Get-FileHash -LiteralPath $exe).Hash -ne (Get-FileHash -LiteralPath (Join-Path $extracted 'quota.exe')).Hash) { throw 'Installed binary differs from candidate' }
  $loader = Join-Path $installDir 'WebView2Loader.dll'
  $sourceLoader = Join-Path $PSScriptRoot '..\src-tauri\WebView2Loader.dll'
  if ((Get-FileHash -LiteralPath $loader).Hash -ne (Get-FileHash -LiteralPath $sourceLoader).Hash) { throw 'Installed WebView2 loader differs from source' }
  & (Join-Path $PSScriptRoot 'check-install.ps1') -ExePath $exe -DataDir $data
  $evidence = @{kind='fresh-baseline-and-overwrite-upgrade';baseline=$oldVersion;version=$actualVersion;actualUpgradeVerified=$true;retainedConfigFiles=$hashes.Count;startupSeconds=8;installerSha256=(Get-FileHash -LiteralPath $Installer).Hash.ToLowerInvariant()}
  [IO.File]::WriteAllText((Join-Path $testPath 'evidence.json'),($evidence | ConvertTo-Json),$utf8)
  Write-Output ($evidence | ConvertTo-Json)
} finally {
  foreach ($instance in @(Get-Process quota -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe })) { Stop-Process -Id $instance.Id -ErrorAction SilentlyContinue }
  $env:QUOTA_DATA_DIR = $previousData
}
