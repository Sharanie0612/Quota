param(
  [string]$ExePath = (Join-Path $env:LOCALAPPDATA 'Quota\quota.exe')
)

$ErrorActionPreference = 'Stop'
$exe = $ExePath
Write-Output ("target: " + $exe)
if (-not (Test-Path -LiteralPath $exe)) { throw "Installed Quota executable not found: $exe" }

$process = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8
$process.Refresh()
if ($process.HasExited) { throw "Quota exited during startup with code $($process.ExitCode)" }
Write-Output ("RUNNING pid=" + $process.Id + " path=" + $process.Path)

# End only the instance started by this smoke check.
Stop-Process -Id $process.Id -ErrorAction SilentlyContinue
Write-Output "startup check passed"
