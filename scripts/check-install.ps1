$ErrorActionPreference = 'Continue'
$exe = Join-Path $env:LOCALAPPDATA 'AgentPrice\agentprice.exe'
Write-Output ("target: " + $exe)
Write-Output ("exists: " + (Test-Path $exe))

$p = Start-Process -FilePath $exe -PassThru
Start-Sleep -Seconds 8

$alive = Get-Process -Name agentprice -ErrorAction SilentlyContinue
if ($alive) {
  foreach ($a in $alive) {
    Write-Output ("RUNNING pid=" + $a.Id + " path=" + $a.Path + " start=" + $a.StartTime.ToString('HH:mm:ss'))
  }
} else {
  Write-Output "NOT RUNNING after 8s"
  if ($p) { Write-Output ("launcher reported ExitCode=" + $p.ExitCode + " HasExited=" + $p.HasExited) }
}

# 收尾：结束测试启动的实例
Get-Process -Name agentprice -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 1
if (Get-Process -Name agentprice -ErrorAction SilentlyContinue) { Write-Output "still running after cleanup" } else { Write-Output "cleaned up" }
