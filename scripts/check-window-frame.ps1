param(
  [Parameter(Mandatory=$true)][string]$ExePath,
  [Parameter(Mandatory=$true)][string]$DataDir,
  [switch]$Glass
)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\') + '\'
$data = [IO.Path]::GetFullPath($DataDir)
if (-not $data.StartsWith($workspace,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $data)) { throw 'DataDir must be a new directory inside this workspace' }
if (@(Get-Process quota -ErrorAction SilentlyContinue).Count) { throw 'Close Quota before running the isolated window check' }
$exe = (Resolve-Path -LiteralPath $ExePath).Path
New-Item -ItemType Directory -Path $data | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$config = @{version=1;accounts=@();settings=@{notifyRecharge=$false;trayAlert=$false;ladderAutoUpdate=$false;autoRefresh=$false;refreshIntervalMinutes=30;notifyLowBalance=$false;closeToTray=$false;defaultLowThreshold=20}}
$options = @{deviceId=[guid]::NewGuid().ToString();deviceName='Window frame check';autoCollect=$false;collectIntervalSeconds=30;syncAccounts=$false;codexHome='';zcodeHome='';syncDir='';harnessHome='';traeHome='';traeEnabled=$false;codexSshDevices=@()}
foreach ($entry in @(@('config.json',$config),@('activity-settings.json',$options),@('usage-widget.json',@{enabled=$false;side='right';heightPercent=50}))) {
  [IO.File]::WriteAllText((Join-Path $data $entry[0]),($entry[1] | ConvertTo-Json -Depth 8),$utf8)
}
$previousData = $env:QUOTA_DATA_DIR
$previousFrame = $env:QUOTA_FRAME_SMOKE
$previousWidget = $env:QUOTA_WIDGET_SMOKE
$previousWebView = $env:WEBVIEW2_USER_DATA_FOLDER
if ($Glass) {
  $preferences=@{theme='quota';mode='light';collapsed=$false;glass=$true;revision=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()}
  [IO.File]::WriteAllText((Join-Path $data 'appearance.json'),($preferences | ConvertTo-Json),$utf8)
}
try {
  $env:QUOTA_DATA_DIR=$data
  $env:WEBVIEW2_USER_DATA_FOLDER=Join-Path $data 'WebViewProfile'
  $env:QUOTA_FRAME_SMOKE='1'
  $env:QUOTA_WIDGET_SMOKE=$null
  $process=Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit(40000)) { throw 'Window frame check timed out' }
  $evidence=Get-Content -LiteralPath (Join-Path $data 'window-frame-check.json') -Raw | ConvertFrom-Json
  if ($process.ExitCode -ne 0 -or -not $evidence.passed) { throw ('Window frame check failed: '+$evidence.error) }
  if (-not $evidence.chrome.installed -or $evidence.chrome.blockedFramePaints -lt 12 -or $evidence.chrome.blockedThemedPaints -lt 24 -or $evidence.chrome.safeActivationForwards -lt 24) { throw 'Native caption/frame repaint guard was not exercised' }
  Write-Output ($evidence | ConvertTo-Json -Depth 8)
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
  $env:QUOTA_DATA_DIR=$previousData
  $env:QUOTA_FRAME_SMOKE=$previousFrame
  $env:QUOTA_WIDGET_SMOKE=$previousWidget
  $env:WEBVIEW2_USER_DATA_FOLDER=$previousWebView
}
