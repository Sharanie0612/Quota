param([Parameter(Mandatory=$true)][string]$ExePath,[Parameter(Mandatory=$true)][string]$DataDir)
$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$testPath = [IO.Path]::GetFullPath($DataDir)
if (-not $testPath.StartsWith(($workspace + '\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Widget check data must be inside this workspace' }
$config = Get-Content -LiteralPath (Join-Path $testPath 'config.json') -Raw | ConvertFrom-Json
if ($config.accounts.Count -ne 0 -or $config.settings.autoRefresh) { throw 'Widget checks require isolated empty accounts and disabled refresh' }
$activity = Get-Content -LiteralPath (Join-Path $testPath 'activity-settings.json') -Raw | ConvertFrom-Json
if ($activity.autoCollect -or $activity.syncAccounts -or $activity.syncDir -or $activity.codexHome -or $activity.zcodeHome -or $activity.harnessHome -or $activity.traeHome) { throw 'Widget checks require disabled collection/sync and empty source paths' }
$evidencePath = Join-Path $testPath 'widget-native-check.json'
if (Test-Path -LiteralPath $evidencePath) { throw 'Use fresh isolated test data' }
$oldData = $env:QUOTA_DATA_DIR
$oldSmoke = $env:QUOTA_WIDGET_SMOKE
try {
  $env:QUOTA_DATA_DIR=$testPath
  $env:QUOTA_WIDGET_SMOKE='1'
  $process=Start-Process -FilePath $ExePath -PassThru -WindowStyle Hidden
  if (-not $process.WaitForExit(30000)) { throw 'Widget check did not exit on main-window close within 30 seconds' }
  if (-not (Test-Path -LiteralPath $evidencePath)) { throw "No widget check evidence; process exit=$($process.ExitCode)" }
  $evidence=Get-Content -LiteralPath $evidencePath -Raw | ConvertFrom-Json
  if ($process.ExitCode -ne 0 -or -not $evidence.ok) { throw "Native widget checks failed: $($evidence.error)" }
  Write-Output 'PASS packaged native widget: frontend handshake, geometry, docking, visibility, close-to-tray and whole-app exit'
} finally {
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
  $env:QUOTA_DATA_DIR=$oldData
  $env:QUOTA_WIDGET_SMOKE=$oldSmoke
}
