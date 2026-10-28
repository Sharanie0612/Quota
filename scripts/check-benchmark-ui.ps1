param([Parameter(Mandatory=$true)][string]$ExePath,[Parameter(Mandatory=$true)][string]$DataDir)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')+'\'
$data=[IO.Path]::GetFullPath($DataDir)
if(-not $data.StartsWith($workspace,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $data)){throw 'Use a fresh isolated data directory in this workspace'}
if(@(Get-Process quota -ErrorAction SilentlyContinue).Count){throw 'Close Quota before native benchmark verification'}
New-Item -ItemType Directory -Path $data | Out-Null
$utf8=[Text.UTF8Encoding]::new($false)
$config=@{version=1;accounts=@();settings=@{autoRefresh=$false;ladderAutoUpdate=$false;notifyLowBalance=$false;closeToTray=$false;refreshIntervalMinutes=30;defaultLowThreshold=20;notifyRecharge=$false;trayAlert=$false}}
$options=@{deviceId=[guid]::NewGuid().ToString();deviceName='Benchmark UI check';autoCollect=$false;syncAccounts=$false;syncDir='';codexHome='';zcodeHome='';harnessHome='';traeHome='';traeEnabled=$false;codexSshDevices=@()}
foreach($entry in @(@('config.json',$config),@('activity-settings.json',$options),@('usage-widget.json',@{enabled=$false;side='right';heightPercent=50}))){[IO.File]::WriteAllText((Join-Path $data $entry[0]),($entry[1]|ConvertTo-Json -Depth 8),$utf8)}
$previousData=$env:QUOTA_DATA_DIR;$previousSmoke=$env:QUOTA_BENCHMARK_SMOKE
try{
 $env:QUOTA_DATA_DIR=$data;$env:QUOTA_BENCHMARK_SMOKE='1'
 $process=Start-Process -FilePath $ExePath -WindowStyle Hidden -PassThru
 if(-not $process.WaitForExit(60000)){throw 'Packaged benchmark UI did not complete within 60 seconds'}
 $report=Get-Content -LiteralPath (Join-Path $data 'benchmark-ui-check.json') -Raw|ConvertFrom-Json
 if($process.ExitCode -ne 0 -or -not $report.passed){throw ('Packaged benchmark UI mismatch: '+$report.error)}
 $golden=Get-Content -LiteralPath (Join-Path $workspace 'src-tauri\data\benchmark-golden.json') -Raw|ConvertFrom-Json
 foreach($case in $golden.cases){$actual=@($report.boards.($case.board)|Where-Object {$_.id -eq $case.modelId});if($actual.Count -ne 1 -or [Math]::Abs([double]$actual[0].score-[double]$case.score) -gt 0.00501){throw ('Native rendered golden mismatch: '+$case.board+' '+$case.modelId)}}
 Write-Output ('PASS actual packaged WebView: '+$report.boards.aa.Count+' AA, '+$report.boards.livebench.Count+' LiveBench, '+$report.boards.consensus.Count+' consensus rows; displayed values, ranks and complete profile IDs match Rust and source golden cases')
}finally{
 if($process -and -not $process.HasExited){Stop-Process -Id $process.Id -ErrorAction SilentlyContinue}
 $env:QUOTA_DATA_DIR=$previousData;$env:QUOTA_BENCHMARK_SMOKE=$previousSmoke
}
