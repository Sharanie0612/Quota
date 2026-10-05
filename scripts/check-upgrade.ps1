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
foreach ($file in @($PreviousInstaller, $Installer)) { if (-not (Test-Path -LiteralPath $file)) { throw "Installer missing: $file" } }
$oldData = $env:QUOTA_DATA_DIR
$installPath = Join-Path $testPath 'app'
$env:QUOTA_DATA_DIR = Join-Path $testPath 'data'
New-Item -ItemType Directory -Path $testPath | Out-Null
try {
  $old = Start-Process -FilePath $PreviousInstaller -ArgumentList @('/S', ('/D=' + $installPath)) -PassThru -Wait -WindowStyle Hidden
  if ($old.ExitCode -ne 0) { throw "Previous installer failed: $($old.ExitCode)" }
  $exe = Join-Path $installPath 'quota.exe'
  if (-not (Test-Path -LiteralPath $exe)) { throw 'Previous install missing quota.exe' }
  Write-Output ('previous installed: ' + (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion)
  $marker = Join-Path $installPath 'upgrade-check.txt'
  Set-Content -LiteralPath $marker -Value 'isolated upgrade marker'
  $next = Start-Process -FilePath $Installer -ArgumentList @('/S', ('/D=' + $installPath)) -PassThru -Wait -WindowStyle Hidden
  if ($next.ExitCode -ne 0) { throw "Upgrade installer failed: $($next.ExitCode)" }
  $version = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  $expectedVersion = (Get-Content -LiteralPath (Join-Path $workspace 'src-tauri\tauri.conf.json') -Raw | ConvertFrom-Json).version
  if ($version -notmatch ('^' + [regex]::Escape($expectedVersion) + '(\.|$)')) { throw "Unexpected upgraded package version: $version" }
  if (-not (Test-Path -LiteralPath $marker)) { throw 'Upgrade removed the unrelated marker file' }
  if (-not (Test-Path -LiteralPath (Join-Path $installPath 'WebView2Loader.dll'))) { throw 'Upgrade missing WebView2Loader.dll' }
  & (Join-Path $PSScriptRoot 'check-install.ps1') -ExePath $exe -DataDir $env:QUOTA_DATA_DIR
  Write-Output "PASS installer upgrade to $version"
} finally {
  $uninstaller = Join-Path $installPath 'uninstall.exe'
  if (Test-Path -LiteralPath $uninstaller) {
    $removed = Start-Process -FilePath $uninstaller -ArgumentList @('/S', ('_?=' + $installPath)) -PassThru -Wait -WindowStyle Hidden
    Write-Output ('test uninstall exit: ' + $removed.ExitCode)
  }
  $env:QUOTA_DATA_DIR = $oldData
}
