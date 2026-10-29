//! Local metadata tailing. There is no per-token stream in Codex rollout files.
//! A heartbeat means the source was checked, never that a speed was measured.
use super::{collect_codex_file, cursor, database, files, now, options, LOCAL_CODEX_LOCK};
use crate::commands::AppState;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}, time::{Duration, Instant, SystemTime}};
use tauri::{Emitter, Manager};

pub const POLL_MS: u64 = 1000;

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase")]
pub struct RunningTask {
    pub id:String,pub model:String,pub started_at:i64,pub last_event_at:i64,
    pub confirmed_output_tokens:u64,pub measured_output_tokens:u64,
    pub measured_duration_ms:u64,pub measured_responses:u64,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase")]
pub struct StreamActivity {pub available:bool,pub last_delta_at:Option<i64>,pub chunks_last_five_seconds:u64}
/// Only count notification metadata. Never SELECT diagnostic log bodies, text
/// deltas, tool outputs or connection identifiers into the application.
pub fn stream_activity(home:&Path,at:i64)->StreamActivity {
    let path=home.join("logs_2.sqlite");if !path.is_file(){return Default::default()}
    let result=(||->rusqlite::Result<StreamActivity>{
        let db=rusqlite::Connection::open_with_flags(path,rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        db.busy_timeout(Duration::from_millis(80))?;
        let (chunks,last):(u64,Option<i64>)=db.query_row("SELECT COUNT(*), MAX(ts*1000+ts_nanos/1000000) FROM logs WHERE ts>=?1 AND ts<=?2 AND ts*1000+ts_nanos/1000000>=?3 AND ts*1000+ts_nanos/1000000<=?4 AND target='codex_app_server::outgoing_message' AND feedback_log_body LIKE '%item/agentMessage/delta%'",rusqlite::params![(at-5000)/1000,at/1000,at-5000,at],|row|Ok((row.get::<_,i64>(0)?.max(0) as u64,row.get(1)?)))?;
        Ok(StreamActivity{available:true,last_delta_at:last,chunks_last_five_seconds:chunks})
    })();result.unwrap_or_default()
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase")]
pub struct Status {
    pub checked_at: Option<i64>,
    pub last_event_at: Option<i64>,
    pub active_requests: usize,
    pub enabled: bool,
    pub source_configured: bool,
    pub files_read: usize,
    pub read_ms: u64,
    pub errors: Vec<String>,
    pub tasks:Vec<RunningTask>,
    pub stream:StreamActivity,
}

#[derive(Default)]
pub struct LocalReader {
    home: PathBuf,
    discovered: Option<Instant>,
    signatures: BTreeMap<PathBuf, Option<(u64, SystemTime)>>,
    active: BTreeMap<PathBuf, RunningTask>,
    discovery_errors: Vec<String>,
}
impl LocalReader {
    pub fn tick(&mut self, dir:&Path) -> Result<usize,String> {
        let started=Instant::now();
        let o=options(dir);
        let mut status=Status { enabled:o.auto_collect, source_configured:!o.codex_home.is_empty(), ..Default::default() };
        if !status.enabled || !status.source_configured { self.save(dir,&status)?; return Ok(0); }
        // The full local reader uses the same lock, but SSH/sync never takes it.
        let Ok(_guard)=LOCAL_CODEX_LOCK.try_lock() else { return Ok(0) };
        let home=PathBuf::from(&o.codex_home);
        if home!=self.home { self.home=home.clone();self.signatures.clear();self.active.clear();self.discovered=None;self.discovery_errors.clear(); }
        let mut found=Vec::new();
        // New sessions are discovered every second in today's folder. Periodic
        // discovery also covers custom layouts and archived/imported sessions.
        let today=home.join("sessions").join(chrono::Local::now().format("%Y/%m/%d").to_string());
        if today.is_dir() { files(&today,&mut found,0,&mut status.errors); }
        if self.discovered.is_none_or(|time| time.elapsed()>=Duration::from_secs(15)) {
            let mut exists=false;
            for name in ["sessions","archived_sessions"] {
                let folder=home.join(name);
                if folder.is_dir() { exists=true;files(&folder,&mut found,0,&mut status.errors); }
            }
            if !exists { status.errors.push("未找到 Codex 会话目录，请检查采集设置".into()); }
            self.discovery_errors=status.errors.clone();
            self.discovered=Some(Instant::now());
        }else{
            status.errors.extend(self.discovery_errors.iter().cloned());
        }
        for path in found {
            // The normal collector backfills history. The fast path watches only
            // recently written files, rather than reopening the whole archive.
            if fs::metadata(&path).and_then(|meta|meta.modified()).is_ok_and(|at|at.elapsed().unwrap_or_default()<Duration::from_secs(86400)) {
                self.signatures.entry(path).or_insert(None);
            }
        }
        let mut db=None;let mut changed=0;
        for (path, signature) in &mut self.signatures {
            let meta=match fs::metadata(path){Ok(meta)=>meta,Err(error) if error.kind()==std::io::ErrorKind::NotFound=>continue,Err(_)=>{status.errors.push("部分本机会话状态无法读取".into());continue}};
            let current=(meta.len(),meta.modified().unwrap_or(SystemTime::UNIX_EPOCH));
            if signature.as_ref()==Some(&current) { continue; }
            if db.is_none() {db=Some(database(dir)?);}
            let connection=db.as_mut().unwrap();
            match collect_codex_file(connection,path,&o.device_id) {
                Ok(count)=>{
                    changed+=count;status.files_read+=1;*signature=Some(current);
                    let c=cursor(connection,&path.to_string_lossy())?;
                    let start=c.speed.active_since.unwrap_or(0);
                    let (confirmed,measured,duration,responses):(u64,u64,u64,u64)=if start>0 {
                        connection.query_row("SELECT COALESCE(SUM(MAX(COALESCE(json_extract(body,'$.tokens.output'),0)-COALESCE(json_extract(body,'$.tokens.reasoning'),0),0)),0),COALESCE(SUM(json_extract(body,'$.speed.outputTokens')),0),COALESCE(SUM(json_extract(body,'$.speed.durationMs')),0),SUM(CASE WHEN json_extract(body,'$.speed') IS NOT NULL THEN 1 ELSE 0 END) FROM metrics WHERE json_extract(body,'$.source')='codex' AND json_extract(body,'$.kind')='tokens' AND json_extract(body,'$.timestamp')>=?1 AND json_extract(body,'$.session')=?2 AND json_extract(body,'$.model')=?3",rusqlite::params![start,super::label(&c.session),c.model],|row|Ok((row.get::<_,i64>(0)?.max(0) as u64,row.get::<_,i64>(1)?.max(0) as u64,row.get::<_,i64>(2)?.max(0) as u64,row.get::<_,Option<i64>>(3)?.unwrap_or(0).max(0) as u64))).map_err(|_|"读取当前任务用量失败")?
                    }else{(0,0,0,0)};
                    self.active.insert(path.clone(),RunningTask{id:super::hash(&c.session),model:c.model,started_at:start,last_event_at:c.speed.last_event_at,confirmed_output_tokens:confirmed,measured_output_tokens:measured,measured_duration_ms:duration,measured_responses:responses});
                }
                Err(error)=>status.errors.push(error),
            }
        }
        let at=now();
        status.checked_at=Some(at);
        status.last_event_at=self.active.values().map(|task|task.last_event_at).filter(|at|*at>0).max();
        status.tasks=self.active.values().filter(|task|task.started_at>0&&task.last_event_at<=at+1000&&at-task.last_event_at<900_000).cloned().collect();
        status.tasks.sort_by_key(|task|std::cmp::Reverse(task.last_event_at));let mut seen=std::collections::BTreeSet::new();status.tasks.retain(|task|seen.insert(task.id.clone()));status.tasks.truncate(16);
        status.active_requests=status.tasks.len();
        status.stream=stream_activity(&home,at);
        status.read_ms=started.elapsed().as_millis() as u64;
        self.save(dir,&status)?;
        Ok(changed)
    }
    fn save(&self,dir:&Path,status:&Status)->Result<(),String>{
        crate::storage::write_atomic(&dir.join("output-speed-live.json"),&serde_json::to_string(status).map_err(|_|"保存读取状态失败")?)
    }
}
pub fn status(dir:&Path)->Status {
    fs::read(dir.join("output-speed-live.json")).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default()
}
pub fn spawn(app:tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut reader=LocalReader::default();
        loop {
            let start=Instant::now();let handle=app.clone();
            reader=tauri::async_runtime::spawn_blocking(move||{
                let dir=handle.state::<AppState>().store.dir().to_path_buf();
                match reader.tick(&dir) {
                    Ok(n)=>{let _=handle.emit(if n>0{"activity-updated"}else{"output-speed-updated"},());}
                    Err(error)=>{let mut status=status(&dir);status.errors=vec![error];let _=reader.save(&dir,&status);let _=handle.emit("output-speed-updated",());}
                }
                reader
            }).await.unwrap_or_default();
            tokio::time::sleep(Duration::from_millis(POLL_MS).saturating_sub(start.elapsed())).await;
        }
    });
}
#[tauri::command]
pub async fn refresh_output_speed(app:tauri::AppHandle)->Result<usize,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let count=LocalReader::default().tick(app.state::<AppState>().store.dir())?;
        let _=app.emit("activity-updated",());Ok(count)
    }).await.map_err(|_|"读取输出记录失败")?
}
