param([Parameter(Mandatory=$true)][string]$ExePath,[Parameter(Mandatory=$true)][string]$CodexHome,[Parameter(Mandatory=$true)][string]$DataDir)
$ErrorActionPreference='Stop'
$taskRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')+'\'
$taskData=[IO.Path]::GetFullPath($DataDir)
$taskHome=(Resolve-Path -LiteralPath $CodexHome).Path
if(-not $taskData.StartsWith($taskRoot,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $taskData)){throw 'Use a fresh data directory inside this workspace'}
if(-not $taskHome.StartsWith($taskRoot,[StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath (Join-Path $taskHome 'sessions\fixture.jsonl'))){throw 'Use the synthetic output_speed_checks logs inside this workspace'}
New-Item -ItemType Directory -Path $taskData | Out-Null
$taskUtf8=[Text.UTF8Encoding]::new($false)
# Empty accounts permit autoRefresh=true so the benchmark navigation harness stays
# off; a separate absolute profile and opt-in flag bypass the user's app instance.
$taskConfig=@{version=1;accounts=@();settings=@{autoRefresh=$true;ladderAutoUpdate=$false;notifyLowBalance=$false;closeToTray=$false;refreshIntervalMinutes=30;defaultLowThreshold=20;notifyRecharge=$false;trayAlert=$false}}
$taskOptions=@{deviceId=[guid]::NewGuid().ToString();deviceName='Cadence fixture';autoCollect=$true;collectIntervalSeconds=900;syncAccounts=$false;syncDir='';codexHome=$taskHome;zcodeHome='';harnessHome='';traeHome='';traeEnabled=$false;codexSshDevices=@()}
foreach($taskEntry in @(@('config.json',$taskConfig),@('activity-settings.json',$taskOptions),@('usage-widget.json',@{enabled=$false;side='right';heightPercent=50}))){[IO.File]::WriteAllText((Join-Path $taskData $taskEntry[0]),($taskEntry[1]|ConvertTo-Json -Depth 8),$taskUtf8)}
$taskPreviousData=$env:QUOTA_DATA_DIR;$taskPreviousSmoke=$env:QUOTA_BENCHMARK_SMOKE;$taskPreviousWebView=$env:WEBVIEW2_USER_DATA_FOLDER
try{
 $env:QUOTA_DATA_DIR=$taskData;$env:QUOTA_BENCHMARK_SMOKE='1';$env:WEBVIEW2_USER_DATA_FOLDER=Join-Path $taskData 'WebViewProfile'
 $taskProcess=Start-Process -FilePath $ExePath -WindowStyle Hidden -PassThru
 $taskWatch=[Diagnostics.Stopwatch]::StartNew();$taskTicks=[Collections.Generic.List[long]]::new()
 while($taskWatch.Elapsed.TotalSeconds -lt 45 -and $taskTicks.Count -lt 3){
  if($taskProcess.HasExited){throw 'Cadence fixture exited before three collections'}
  $taskStatusFile=Join-Path $taskData 'output-speed-status.json'
  if(Test-Path -LiteralPath $taskStatusFile){$taskStatus=Get-Content -LiteralPath $taskStatusFile -Raw|ConvertFrom-Json;if($taskStatus.errors.Count){throw 'Synthetic speed collection reported errors'};$taskAt=[long]$taskStatus.collectedAt;if($taskAt -gt 0 -and ($taskTicks.Count -eq 0 -or $taskAt -ne $taskTicks[$taskTicks.Count-1])){$taskTicks.Add($taskAt)}}
  Start-Sleep -Milliseconds 200
 }
 if($taskTicks.Count -lt 3){throw 'Did not observe three collections within 45 seconds'}
 $taskIntervals=@(($taskTicks[1]-$taskTicks[0]),($taskTicks[2]-$taskTicks[1]))
 foreach($taskInterval in $taskIntervals){if($taskInterval -lt 8500 -or $taskInterval -gt 13500){throw ('Collection cadence outside 10-second tolerance: '+$taskInterval)}}
 Stop-Process -Id $taskProcess.Id;$taskProcess.WaitForExit()
 $taskProbe='const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync(process.argv[1],{readOnly:true});const rows=db.prepare("SELECT body FROM metrics").all().map(r=>JSON.parse(r.body));const speed=rows.filter(r=>r.speed);if(speed.length!==2||rows.reduce((n,r)=>n+r.tokens.total,0)!==3390)throw Error("Cadence collection duplicated metrics");console.log(JSON.stringify({samples:speed.length,tokens:3390}));db.close();'
 $taskLedger=& node --no-warnings -e $taskProbe (Join-Path $taskData 'activity.sqlite')
 if($LASTEXITCODE -ne 0){throw 'Cadence ledger reconciliation failed'}
 $taskEvidence=@{passed=$true;kind='native-background-cadence';targetIntervalSeconds=10;fullCollectionIntervalSeconds=900;observedIntervalsMs=$taskIntervals;observations=$taskTicks.Count;ledger=($taskLedger|ConvertFrom-Json);noViewRefreshRequired=$true}
 [IO.File]::WriteAllText((Join-Path $taskData 'cadence-check.json'),($taskEvidence|ConvertTo-Json -Depth 6),$taskUtf8)
 Write-Output ('PASS native background collection: '+($taskIntervals -join ', ')+' ms; full collection set to 900s; shared ledger retains two speed samples without duplicate usage')
}finally{
 if($taskProcess -and -not $taskProcess.HasExited){Stop-Process -Id $taskProcess.Id -ErrorAction SilentlyContinue}
 $env:QUOTA_DATA_DIR=$taskPreviousData;$env:QUOTA_BENCHMARK_SMOKE=$taskPreviousSmoke;$env:WEBVIEW2_USER_DATA_FOLDER=$taskPreviousWebView
}
