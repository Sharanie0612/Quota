param([Parameter(Mandatory=$true)][string]$ExePath,[Parameter(Mandatory=$true)][string]$DataDir,[Parameter(Mandatory=$true)][string]$ActivityDb)
$ErrorActionPreference='Stop'
$taskWorkspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')+'\'
$taskData=[IO.Path]::GetFullPath($DataDir)
if(-not $taskData.StartsWith($taskWorkspace,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $taskData)){throw 'Use a fresh isolated data directory in this workspace'}
if(-not (Test-Path -LiteralPath $ActivityDb)){throw 'Provide the synthetic output_speed_checks activity.sqlite fixture'}
New-Item -ItemType Directory -Path $taskData | Out-Null
$taskUtf8=[Text.UTF8Encoding]::new($false)
$taskConfig=@{version=1;accounts=@();settings=@{autoRefresh=$false;ladderAutoUpdate=$false;notifyLowBalance=$false;closeToTray=$false;refreshIntervalMinutes=30;defaultLowThreshold=20;notifyRecharge=$false;trayAlert=$false}}
$taskOptions=@{deviceId=[guid]::NewGuid().ToString();deviceName='Product UI check';autoCollect=$false;syncAccounts=$false;syncDir='';codexHome='';zcodeHome='';harnessHome='';traeHome='';traeEnabled=$false;codexSshDevices=@()}
foreach($taskEntry in @(@('config.json',$taskConfig),@('activity-settings.json',$taskOptions),@('usage-widget.json',@{enabled=$false;side='right';heightPercent=50}))){[IO.File]::WriteAllText((Join-Path $taskData $taskEntry[0]),($taskEntry[1]|ConvertTo-Json -Depth 8),$taskUtf8)}
Copy-Item -LiteralPath $ActivityDb -Destination (Join-Path $taskData 'activity.sqlite')
$taskPreviousData=$env:QUOTA_DATA_DIR;$taskPreviousSmoke=$env:QUOTA_BENCHMARK_SMOKE;$taskPreviousWebView=$env:WEBVIEW2_USER_DATA_FOLDER
try{
 $env:QUOTA_DATA_DIR=$taskData;$env:QUOTA_BENCHMARK_SMOKE='1';$env:WEBVIEW2_USER_DATA_FOLDER=Join-Path $taskData 'WebViewProfile'
 $taskProcess=Start-Process -FilePath $ExePath -WindowStyle Hidden -PassThru
 if(-not $taskProcess.WaitForExit(60000)){throw 'Packaged product UI did not complete within 60 seconds'}
 $taskReport=Get-Content -LiteralPath (Join-Path $taskData 'benchmark-ui-check.json') -Raw|ConvertFrom-Json
 if($taskProcess.ExitCode -ne 0 -or -not $taskReport.passed){throw ('Packaged product UI mismatch: '+$taskReport.error)}
 Write-Output ('PASS packaged WebView: '+@($taskReport.report.all).Count+' full-configuration scores; '+@($taskReport.report.recent).Count+' recent releases; six-axis radar; output-speed values; model-library and donut-detail removal')
}finally{
 if($taskProcess -and -not $taskProcess.HasExited){Stop-Process -Id $taskProcess.Id -ErrorAction SilentlyContinue}
 $env:QUOTA_DATA_DIR=$taskPreviousData;$env:QUOTA_BENCHMARK_SMOKE=$taskPreviousSmoke;$env:WEBVIEW2_USER_DATA_FOLDER=$taskPreviousWebView
}
