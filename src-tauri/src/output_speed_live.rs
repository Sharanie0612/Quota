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
pub struct Status {
    pub checked_at: Option<i64>,
    pub last_event_at: Option<i64>,
    pub active_requests: usize,
    pub enabled: bool,
    pub source_configured: bool,
    pub files_read: usize,
    pub read_ms: u64,
    pub errors: Vec<String>,
}

#[derive(Default)]
pub struct LocalReader {
    home: PathBuf,
    discovered: Option<Instant>,
    signatures: BTreeMap<PathBuf, Option<(u64, SystemTime)>>,
    active: BTreeMap<PathBuf, (i64, Option<i64>)>,
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
                    self.active.insert(path.clone(),(c.speed.last_event_at,c.speed.active_since));
                }
                Err(error)=>status.errors.push(error),
            }
        }
        let at=now();
        status.checked_at=Some(at);
        status.last_event_at=self.active.values().map(|(at,_)|*at).filter(|at|*at>0).max();
        status.active_requests=self.active.values().filter(|(last,start)|start.is_some()&&*last<=at+1000&&at-*last<900_000).count();
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
