param(
  [string]$ExePath = (Join-Path $env:LOCALAPPDATA 'Quota\quota.exe'),
  [string]$DataDir
)

$ErrorActionPreference = 'Stop'
$exe = $ExePath
Write-Output ("target: " + $exe)
if (-not (Test-Path -LiteralPath $exe)) { throw "Installed Quota executable not found: $exe" }

$previousDataDir = $env:QUOTA_DATA_DIR
try {
  if ($DataDir) {
    if (-not [System.IO.Path]::IsPathRooted($DataDir)) { throw 'DataDir must be absolute' }
    $env:QUOTA_DATA_DIR = $DataDir
  }
  $process = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
  Start-Sleep -Seconds 8
  $process.Refresh()
  if ($process.HasExited) { throw "Quota exited during startup with code $($process.ExitCode)" }
  Write-Output ("RUNNING pid=" + $process.Id + " path=" + $process.Path)
} finally {
  # End only the instance started by this smoke check.
  if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -ErrorAction SilentlyContinue }
  $env:QUOTA_DATA_DIR = $previousDataDir
}
Write-Output "startup check passed"
