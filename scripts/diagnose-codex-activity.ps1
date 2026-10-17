# Read-only. Print settings and log metadata; never print messages, arguments,
# authentication files or source JSONL lines. Works with Windows PowerShell 5.1.
param([string]$QuotaDataDir = (Join-Path $env:APPDATA 'Quota'))
$ErrorActionPreference = 'Stop'
function Read-Json($Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        try { return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json) }
        catch { return $null }
    }
    return $null
}
function Log-Summary([string]$HomePath) {
    $result = [ordered]@{home=$HomePath;exists=(Test-Path -LiteralPath $HomePath -PathType Container);files=0;newestWriteUtc=$null;sampledFiles=0;sampleTokenRecords=0;unsupportedTokenRecords=0;latestTokenUtc=$null;latestTokenTotal=$null;readErrors=0}
    $logs = @()
    foreach ($name in @('sessions','archived_sessions')) {
        $folder = Join-Path $HomePath $name
        if (Test-Path -LiteralPath $folder -PathType Container) {
            $scanErrors = @()
            $logs += @(Get-ChildItem -LiteralPath $folder -Filter '*.jsonl' -Recurse -File -ErrorAction SilentlyContinue -ErrorVariable scanErrors)
            $result.readErrors += $scanErrors.Count
        }
    }
    $result.files = $logs.Count
    foreach ($file in @($logs | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 5)) {
        if (!$result.newestWriteUtc) { $result.newestWriteUtc=$file.LastWriteTimeUtc.ToString('o') }
        $stream=$null;$reader=$null
        try {
            $stream=[IO.File]::Open($file.FullName,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete))
            # Only inspect the final 2 MiB; discard a partial first line.
            $start=[Math]::Max(0,$stream.Length-2MB)
            [void]$stream.Seek($start,[IO.SeekOrigin]::Begin)
            $reader=New-Object IO.StreamReader($stream,[Text.Encoding]::UTF8)
            if ($start -gt 0) { [void]$reader.ReadLine() }
            $result.sampledFiles++
            while (($line=$reader.ReadLine()) -ne $null) {
                try { $v=$line | ConvertFrom-Json -ErrorAction Stop } catch { continue }
                if ($v.type -ne 'event_msg' -or $v.payload.type -ne 'token_count') { continue }
                $result.sampleTokenRecords++
                $usage=$v.payload.info.total_token_usage
                if ($null -eq $usage) { $result.unsupportedTokenRecords++;continue }
                try { $at=[DateTimeOffset]::Parse($v.timestamp).ToUniversalTime().ToString('o') } catch { continue }
                if (!$result.latestTokenUtc -or $at -gt $result.latestTokenUtc) { $result.latestTokenUtc=$at;$result.latestTokenTotal=$usage.total_tokens }
            }
        } catch { $result.readErrors++ }
        finally { if ($reader) { $reader.Dispose() } elseif ($stream) { $stream.Dispose() } }
    }
    return $result
}
function Database-Summary([string]$DatabasePath, [string]$CodexHome) {
    if (!(Test-Path -LiteralPath $DatabasePath -PathType Leaf)) { return @{exists=$false} }
    # Use Windows' bundled SQLite in read-only mode. No external runtime/install.
    if (!('QuotaDiagnosticsSqlite' -as [type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class QuotaDiagnosticRow { public string A; public string B; }
public static class QuotaDiagnosticsSqlite {
    [DllImport("winsqlite3", CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_open_v2(byte[] path, out IntPtr db, int flags, IntPtr vfs);
    [DllImport("winsqlite3", CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_close(IntPtr db);
    [DllImport("winsqlite3", CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_busy_timeout(IntPtr db, int milliseconds);
    [DllImport("winsqlite3", CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_prepare_v2(IntPtr db, byte[] sql, int length, out IntPtr statement, IntPtr tail);
    [DllImport("winsqlite3", CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_step(IntPtr statement);
    [DllImport("winsqlite3", CallingConvention=CallingConvention.Cdecl)] static extern IntPtr sqlite3_column_text(IntPtr statement, int column);
    [DllImport("winsqlite3", CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_column_bytes(IntPtr statement, int column);
    [DllImport("winsqlite3", CallingConvention=CallingConvention.Cdecl)] static extern int sqlite3_finalize(IntPtr statement);
    [DllImport("winsqlite3", CallingConvention=CallingConvention.Cdecl)] static extern IntPtr sqlite3_errmsg(IntPtr db);
    static string Error(IntPtr db) {
        IntPtr pointer=sqlite3_errmsg(db);int length=0;while(Marshal.ReadByte(pointer,length)!=0)length++;
        byte[] bytes=new byte[length];Marshal.Copy(pointer,bytes,0,length);return Encoding.UTF8.GetString(bytes);
    }
    static string Column(IntPtr statement, int column) {
        IntPtr pointer=sqlite3_column_text(statement,column);
        if(pointer==IntPtr.Zero) return "";
        byte[] bytes=new byte[sqlite3_column_bytes(statement,column)];
        Marshal.Copy(pointer,bytes,0,bytes.Length);return Encoding.UTF8.GetString(bytes);
    }
    public static List<QuotaDiagnosticRow> Rows(string path,string sql) {
        IntPtr db=IntPtr.Zero, statement=IntPtr.Zero;
        try {
            if(sqlite3_open_v2(Encoding.UTF8.GetBytes(path+"\0"),out db,1,IntPtr.Zero)!=0) throw new Exception("Cannot open statistics read-only");
            sqlite3_busy_timeout(db,1000);
            if(sqlite3_prepare_v2(db,Encoding.UTF8.GetBytes(sql+"\0"),-1,out statement,IntPtr.Zero)!=0) throw new Exception("Statistics query failed: "+Error(db));
            var rows=new List<QuotaDiagnosticRow>();int status;
            while((status=sqlite3_step(statement))==100) rows.Add(new QuotaDiagnosticRow {A=Column(statement,0),B=Column(statement,1)});
            if(status!=101) throw new Exception("Statistics read failed");return rows;
        } finally {if(statement!=IntPtr.Zero)sqlite3_finalize(statement);if(db!=IntPtr.Zero)sqlite3_close(db);}
    }
}
'@
    }
    $summary=[ordered]@{exists=$true;codexRecords=0;codexTotal=[decimal]0;latestCodexTokenUtc=$null;codexTodayTotal=[decimal]0;recentCursors=@();invalidMetricBodies=0}
    $latest=[long]0;$today=[DateTime]::Now.Date
    foreach ($row in [QuotaDiagnosticsSqlite]::Rows($DatabasePath,"SELECT body,'' FROM metrics")) {
        try { $metric=$row.A | ConvertFrom-Json -ErrorAction Stop } catch { $summary.invalidMetricBodies++;continue }
        if ($metric.source -ne 'codex' -or $metric.kind -ne 'tokens') { continue }
        $summary.codexRecords++;$summary.codexTotal += [decimal]$metric.tokens.total
        $latest=[Math]::Max($latest,[long]$metric.timestamp)
        if ([DateTimeOffset]::FromUnixTimeMilliseconds([long]$metric.timestamp).LocalDateTime.Date -eq $today) { $summary.codexTodayTotal += [decimal]$metric.tokens.total }
    }
    if ($latest -gt 0) { $summary.latestCodexTokenUtc=[DateTimeOffset]::FromUnixTimeMilliseconds($latest).ToString('o') }
    if ($CodexHome) {
        $recent=@(Get-ChildItem -LiteralPath (Join-Path $CodexHome 'sessions') -Filter '*.jsonl' -Recurse -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 3)
        $cursors=[QuotaDiagnosticsSqlite]::Rows($DatabasePath,'SELECT path,body FROM cursors')
        foreach ($file in $recent) {
            $stored=@($cursors | Where-Object { $_.A -eq $file.FullName } | Select-Object -First 1)
            $cursor=$null;if($stored.Count){try{$cursor=$stored[0].B | ConvertFrom-Json}catch{}}
            $header=$null;try{$header=Get-Content -LiteralPath $file.FullName -TotalCount 1 -Encoding UTF8 | ConvertFrom-Json}catch{}
            $summary.recentCursors+=@{file=[string]$file.Name;bytes=[long]$file.Length;cursorFound=($null -ne $cursor);offset=$cursor.offset;previousTotal=$cursor.previous.total;sessionEmpty=[string]::IsNullOrWhiteSpace([string]$cursor.session);headerType=[string]$header.type;headerIdIsString=($header.payload.id -is [string]);headerSessionIdIsString=($header.payload.session_id -is [string]);headerSessionIdEmpty=[string]::IsNullOrWhiteSpace([string]$header.payload.session_id)}
        }
    }
    return $summary
}
$settings=Read-Json (Join-Path $QuotaDataDir 'activity-settings.json')
$status=Read-Json (Join-Path $QuotaDataDir 'activity-status.json')
$homes=@((Join-Path $env:USERPROFILE '.codex'))
if ($env:CODEX_HOME) { $homes += $env:CODEX_HOME }
if ($settings.codexHome) { $homes += $settings.codexHome }
$quotaProcesses=@(Get-Process quota -ErrorAction SilentlyContinue | ForEach-Object { $_.Path })
$database=$null
try { $database=Database-Summary (Join-Path $QuotaDataDir 'activity.sqlite') $settings.codexHome }
catch { $database=@{readError=[string]$_.Exception.Message} }
[ordered]@{
    checkedAtUtc=[DateTimeOffset]::UtcNow.ToString('o')
    quotaRunning=($quotaProcesses.Count -gt 0)
    quotaVersions=@($quotaProcesses | ForEach-Object { if ($_) { (Get-Item -LiteralPath $_).VersionInfo.ProductVersion } })
    quotaSettingsFound=($null -ne $settings)
    autoCollect=$settings.autoCollect
    collectIntervalSeconds=$settings.collectIntervalSeconds
    configuredCodexHome=$settings.codexHome
    lastCycleUnixMs=$status.at
    collectionErrors=@($status.errors)
    sources=@($homes | Select-Object -Unique | ForEach-Object { Log-Summary $_ })
    database=$database
    sampleNote='Newest five files, last 2 MiB each; absence in sample does not prove absence in full logs.'
} | ConvertTo-Json -Depth 7
