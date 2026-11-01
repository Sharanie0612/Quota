param([Parameter(Mandatory=$true)][string]$ExePath,[Parameter(Mandatory=$true)][string]$TestRoot)
$ErrorActionPreference='Stop'
$taskScript=Join-Path $PSScriptRoot 'verify-output-speed-incremental.cjs'
& node --no-warnings $taskScript prepare $TestRoot
if($LASTEXITCODE -ne 0){throw 'Could not create isolated synthetic logs'}
$taskPreviousData=$env:QUOTA_DATA_DIR;$taskPreviousSmoke=$env:QUOTA_BENCHMARK_SMOKE;$taskPreviousWebView=$env:WEBVIEW2_USER_DATA_FOLDER
try{
 $env:QUOTA_DATA_DIR=Join-Path $TestRoot 'data';$env:QUOTA_BENCHMARK_SMOKE='1';$env:WEBVIEW2_USER_DATA_FOLDER=Join-Path $TestRoot 'WebViewProfile'
 $taskProcess=Start-Process -FilePath $ExePath -WindowStyle Hidden -PassThru
 & node --no-warnings $taskScript check $TestRoot
 if($LASTEXITCODE -ne 0){throw 'Packaged incremental ingestion failed'}
 if($taskProcess.HasExited){throw 'Packaged app exited during collection'}
}finally{
 if($taskProcess -and -not $taskProcess.HasExited){Stop-Process -Id $taskProcess.Id -ErrorAction SilentlyContinue}
 $env:QUOTA_DATA_DIR=$taskPreviousData;$env:QUOTA_BENCHMARK_SMOKE=$taskPreviousSmoke;$env:WEBVIEW2_USER_DATA_FOLDER=$taskPreviousWebView
}
