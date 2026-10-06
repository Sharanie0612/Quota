//! Read-only source adapters. Persist/sync metrics only: never messages, arguments or credentials.
use std::{collections::BTreeMap, fs, io::{BufRead, BufReader, Seek, SeekFrom}, path::{Path, PathBuf}};
use rusqlite::{params, Connection, OpenFlags, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};
use crate::commands::AppState;
#[path = "activity_harness.rs"]
mod harness;

fn hash(text: &str) -> String { format!("{:x}", Sha256::digest(text.as_bytes())) }
fn label(text: &str) -> String { text.chars().filter(|c| !c.is_control()).take(160).collect() }
fn now() -> i64 { chrono::Utc::now().timestamp_millis() }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Options {
    pub device_id: String, pub device_name: String, pub auto_collect: bool,
    #[serde(default = "default_interval")]
    pub collect_interval_seconds: u64,
    #[serde(default = "sync_accounts_default")]
    pub sync_accounts: bool,
    pub codex_home: String, pub zcode_home: String, pub sync_dir: String,
    #[serde(default)]
    pub harness_home: String,
}
fn default_interval() -> u64 { 30 }
fn sync_accounts_default() -> bool { true }
pub fn options(dir: &Path) -> Options {
    fs::read(dir.join("activity-settings.json")).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_else(|| {
        let home = std::env::var_os("USERPROFILE").map(PathBuf::from).or_else(dirs::home_dir).unwrap_or_default();
        Options { device_id: uuid::Uuid::new_v4().to_string(), device_name: std::env::var("COMPUTERNAME").unwrap_or("本机".into()), auto_collect: true, collect_interval_seconds: default_interval(), sync_accounts: true,
            codex_home: std::env::var_os("CODEX_HOME").map(PathBuf::from).unwrap_or_else(|| home.join(".codex")).to_string_lossy().into(),
            zcode_home: home.join(".zcode").to_string_lossy().into(), sync_dir: String::new(), harness_home: String::new() }
    })
}
pub fn save_options(dir: &Path, o: &Options) -> Result<(), String> {
    crate::storage::write_atomic(&dir.join("activity-settings.json"), &serde_json::to_string_pretty(o).map_err(|_| "保存统计设置失败")?)
}

#[derive(Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase")]
pub struct Tokens { pub input: u64, pub cached: u64, pub cache_write: u64, pub output: u64, pub reasoning: u64, pub total: u64 }
impl Tokens {
    fn codex(v: &Value) -> Self {
        let n = |key| v.get(key).and_then(Value::as_u64).unwrap_or(0);
        let input = n("input_tokens"); let output = n("output_tokens");
        Self { input, cached: n("cached_input_tokens"), cache_write: n("cache_write_input_tokens"), output, reasoning: n("reasoning_output_tokens"), total: v.get("total_tokens").and_then(Value::as_u64).unwrap_or(input.saturating_add(output)) }
    }
    fn delta(&self, old: &Self) -> Self {
        if self.input < old.input || self.output < old.output || self.total < old.total { return self.clone(); }
        Self { input:self.input-old.input, cached:self.cached.saturating_sub(old.cached), cache_write:self.cache_write.saturating_sub(old.cache_write), output:self.output-old.output, reasoning:self.reasoning.saturating_sub(old.reasoning), total:self.total-old.total }
    }
    fn add(&mut self, b: &Self) { self.input=self.input.saturating_add(b.input); self.cached=self.cached.saturating_add(b.cached); self.cache_write=self.cache_write.saturating_add(b.cache_write); self.output=self.output.saturating_add(b.output); self.reasoning=self.reasoning.saturating_add(b.reasoning); self.total=self.total.saturating_add(b.total); }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct Metric {
    pub id: String, pub device: String, pub source: String, pub session: String, pub model: String,
    pub agent: String, pub tool: String, pub timestamp: i64, pub kind: String, pub tokens: Tokens,
    #[serde(default)]
    pub revision: u64,
}
impl Metric {
    fn valid(&self) -> bool {
        self.id.len()==64 && self.id.bytes().all(|b| b.is_ascii_hexdigit()) && uuid::Uuid::parse_str(&self.device).is_ok()
            && matches!(self.source.as_str(), "codex"|"zcode"|"harness") && matches!(self.kind.as_str(), "tokens"|"tool")
            && [&self.session,&self.model,&self.agent,&self.tool].iter().all(|s| s.len()<=640 && !s.chars().any(char::is_control))
            && self.timestamp>0 && self.timestamp <= now()+86400000
            && [self.tokens.input,self.tokens.cached,self.tokens.output,self.tokens.total,self.tokens.reasoning,self.tokens.cache_write].iter().all(|v| *v<=1_000_000_000_000)
    }
}
#[derive(Default, Serialize, Deserialize)]
pub struct Cursor { pub offset:u64, pub session:String, pub model:String, pub agent:String, pub previous:Tokens, pub inherited_until:Option<u64> }
pub fn parse_codex(v: &Value, c: &mut Cursor, device: &str) -> Option<Metric> {
    let p=v.get("payload")?;
    let timestamp=v.get("timestamp").and_then(Value::as_str).and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())?.timestamp_millis();
    let outer=v.get("type").and_then(Value::as_str).unwrap_or("");
    if outer=="session_meta" {
        c.session=p.get("session_id").or_else(|| p.get("id")).and_then(Value::as_str).unwrap_or("").to_string();
        c.inherited_until=p.get("subagent_history_start_ordinal").and_then(Value::as_u64);
        c.agent=if p.get("parent_thread_id").is_some_and(|x| !x.is_null()) { "子 Agent" } else { "主 Agent" }.into();
        return None;
    }
    if outer=="turn_context" { c.model=label(p.get("model").and_then(Value::as_str).unwrap_or("未知模型")); return None; }
    let inner=p.get("type").and_then(Value::as_str).unwrap_or("");
    let inherited=c.inherited_until.is_some_and(|n| v.get("ordinal").and_then(Value::as_u64).is_some_and(|i| i<n));
    if outer=="event_msg" && inner=="token_count" {
        let raw=p.get("info")?.get("total_token_usage")?;
        if raw.is_null() { return None; }
        let total=Tokens::codex(raw); let delta=total.delta(&c.previous); c.previous=total;
        if inherited || delta.total==0 || c.session.is_empty() { return None; }
        // Timestamp + cumulative counters also deduplicate history copied into forks.
        let id=hash(&format!("codex:tokens:{timestamp}:{}", serde_json::to_string(raw).ok()?));
        return Some(Metric { id, device:device.into(), source:"codex".into(),revision:0, session:label(&c.session), model:if c.model.is_empty(){"未知模型".into()}else{c.model.clone()},agent:c.agent.clone(),tool:String::new(),timestamp,kind:"tokens".into(),tokens:delta });
    }
    if outer=="response_item" && matches!(inner,"function_call"|"custom_tool_call") && !inherited {
        let call=p.get("call_id").or_else(|| p.get("id")).and_then(Value::as_str)?;
        let tool=label(p.get("name").and_then(Value::as_str).unwrap_or("未知工具"));
        return Some(Metric { id:hash(&format!("codex:tool:{call}")),device:device.into(),source:"codex".into(),revision:0,session:label(&c.session),model:c.model.clone(),agent:c.agent.clone(),tool,timestamp,kind:"tool".into(),tokens:Tokens::default() });
    }
    None
}

fn database(dir:&Path) -> Result<Connection,String> {
    let db=Connection::open(dir.join("activity.sqlite")).map_err(|_| "无法打开统计资料库")?;
    db.busy_timeout(std::time::Duration::from_secs(3)).map_err(|_| "统计资料库忙碌")?;
    db.execute_batch("PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS metrics(id TEXT PRIMARY KEY, body TEXT NOT NULL, local INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE IF NOT EXISTS cursors(path TEXT PRIMARY KEY, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS outbox(seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS receipts(path TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS devices(id TEXT PRIMARY KEY, name TEXT NOT NULL);").map_err(|_| "初始化统计资料库失败")?;
    Ok(db)
}
pub fn merge_metric(db:&Connection, event:&Metric, local:bool) -> Result<bool,String> {
    if !event.valid() { return Err("统计记录格式无效".into()); }
    let old:Option<String>=db.query_row("SELECT body FROM metrics WHERE id=?1",[&event.id],|r|r.get(0)).optional().map_err(|_| "读取统计记录失败")?;
    let mut next=event.clone();
    if let Some(text)=&old {
        let previous:Metric=serde_json::from_str(text).map_err(|_| "统计记录损坏")?;
        // A deterministic owner keeps device subtotals consistent even if identical logs exist on both devices.
        next.device=previous.device.clone().min(next.device);
        // Harness replaces the latest settlement for an attempt; older synced samples must
        // not resurrect an earlier (possibly larger) count.
        if next.source == "harness" {
            if previous.revision > next.revision { let owner=next.device; next=previous; next.device=owner; }
        } else {
        next.tokens.input=previous.tokens.input.max(next.tokens.input); next.tokens.cached=previous.tokens.cached.max(next.tokens.cached);
        next.tokens.cache_write=previous.tokens.cache_write.max(next.tokens.cache_write);next.tokens.output=previous.tokens.output.max(next.tokens.output);
        next.tokens.reasoning=previous.tokens.reasoning.max(next.tokens.reasoning);next.tokens.total=previous.tokens.total.max(next.tokens.total);
        }
    }
    let body=serde_json::to_string(&next).map_err(|_| "保存统计失败")?;
    if old.as_deref()==Some(&body) { return Ok(false); }
    db.execute("INSERT INTO metrics(id,body,local) VALUES(?1,?2,?3) ON CONFLICT(id) DO UPDATE SET body=excluded.body,local=MAX(metrics.local,excluded.local)",params![next.id,body,local as i32]).map_err(|_| "保存统计失败")?;
    if local { db.execute("INSERT INTO outbox(event_id) VALUES(?1)",[&next.id]).map_err(|_| "保存同步队列失败")?; }
    Ok(true)
}
fn cursor(db:&Connection,key:&str) -> Result<Cursor,String> {
    let text:Option<String>=db.query_row("SELECT body FROM cursors WHERE path=?1",[key],|r|r.get(0)).optional().map_err(|_| "读取采集进度失败")?;
    Ok(text.and_then(|s|serde_json::from_str(&s).ok()).unwrap_or_default())
}
fn save_cursor(db:&Connection,key:&str,c:&Cursor) -> Result<(),String> {
    db.execute("INSERT INTO cursors(path,body) VALUES(?1,?2) ON CONFLICT(path) DO UPDATE SET body=excluded.body",params![key,serde_json::to_string(c).map_err(|_| "保存采集进度失败")?]).map_err(|_| "保存采集进度失败")?; Ok(())
}
fn files(dir:&Path, out:&mut Vec<PathBuf>,depth:u8) {
    if depth>12{return} if let Ok(items)=fs::read_dir(dir){for i in items.flatten(){if let Ok(t)=i.file_type(){if t.is_symlink(){continue}if t.is_dir(){files(&i.path(),out,depth+1)}else if i.path().extension().is_some_and(|e|e=="jsonl"){out.push(i.path())}}}}
}
fn collect_codex(db:&mut Connection,home:&Path,device:&str) -> Result<usize,String> {
    let mut paths=Vec::new(); files(&home.join("sessions"),&mut paths,0);files(&home.join("archived_sessions"),&mut paths,0);paths.sort();
    let mut count=0;
    for path in paths {
        let key=path.to_string_lossy().to_string(); let mut c=cursor(db,&key)?;
        let mut f=fs::File::open(&path).map_err(|_| "部分 Codex 会话暂时无法读取")?;
        let size=f.metadata().map_err(|_| "无法读取会话大小")?.len();
        if size<c.offset { c=Cursor::default(); } if size==c.offset {continue}
        f.seek(SeekFrom::Start(c.offset)).map_err(|_| "读取会话进度失败")?;
        let tx=db.transaction().map_err(|_| "统计资料库忙碌")?;
        let mut reader=BufReader::new(f);let mut line=Vec::new();
        loop { line.clear();let n=reader.read_until(b'\n',&mut line).map_err(|_| "读取 Codex 会话失败")?;if n==0||line.last()!=Some(&b'\n'){break}
            c.offset+=n as u64;
            if line.len()>32*1024*1024 {continue}
            if let Ok(v)=serde_json::from_slice::<Value>(&line){if let Some(e)=parse_codex(&v,&mut c,device){if merge_metric(&tx,&e,true)?{count+=1}}}
        }
        save_cursor(&tx,&key,&c)?;tx.commit().map_err(|_| "保存采集进度失败")?;
    } Ok(count)
}
fn collect_zcode(db:&mut Connection,path:&Path,device:&str) -> Result<usize,String> {
    if !path.exists(){return Ok(0)}
    let source=Connection::open_with_flags(path,OpenFlags::SQLITE_OPEN_READ_ONLY|OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|_| "ZCode 统计暂时无法读取")?;
    source.busy_timeout(std::time::Duration::from_millis(800)).map_err(|_| "ZCode 统计忙碌")?;
    let modern = source.prepare("SELECT id FROM model_usage LIMIT 0").is_ok();
    // New task-index databases hold scheduling metadata, not usage records.
    if !modern && source.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='tasks')",[],|r|r.get::<_,bool>(0)).unwrap_or(false) { return Ok(0); }
    let key=format!("zcode:{}",path.to_string_lossy());let mut c=cursor(db,&key)?;let since=c.offset.saturating_sub(5000);
    let sql="SELECT logical_request_id,attempt_index,session_id,model_id,agent,COALESCE(completed_at,started_at,0),input_tokens,cache_read_input_tokens,cache_creation_input_tokens,output_tokens,reasoning_tokens,COALESCE(computed_total_tokens,provider_total_tokens),id FROM model_usage WHERE COALESCE(completed_at,started_at,0)>=?1 ORDER BY COALESCE(completed_at,started_at,0)";
    let mut statement=source.prepare(sql).map_err(|_| "此 ZCode 版本的统计格式暂不支持")?;
    let rows=statement.query_map([since as i64],|r|{
        let num=|i|r.get::<_,Option<i64>>(i).map(|v|v.unwrap_or(0).max(0) as u64);
        let request:String=r.get::<_,Option<String>>(0)?.unwrap_or(r.get(12)?);
        let attempt=num(1)?;
        Ok(Metric { id:hash(&format!("zcode:model:{request}:{attempt}")),device:device.into(),source:"zcode".into(),revision:0,session:label(&r.get::<_,String>(2)?),model:label(&r.get::<_,String>(3)?),agent:label(&r.get::<_,Option<String>>(4)?.unwrap_or("主 Agent".into())),tool:String::new(),timestamp:r.get(5)?,kind:"tokens".into(),tokens:Tokens{input:num(6)?,cached:num(7)?,cache_write:num(8)?,output:num(9)?,reasoning:num(10)?,total:num(11)?} })
    }).map_err(|_| "读取 ZCode Token 统计失败")?;
    let tx=db.transaction().map_err(|_| "统计资料库忙碌")?;let mut count=0;
    for row in rows {let e=row.map_err(|_| "读取 ZCode Token 记录失败")?;c.offset=c.offset.max(e.timestamp.max(0) as u64);if e.timestamp>0 && merge_metric(&tx,&e,true)?{count+=1}}
    let mut tools=source.prepare("SELECT COALESCE(tool_call_id,id),session_id,tool_name,COALESCE(completed_at,started_at,0),COALESCE((SELECT model_id FROM model_usage m WHERE m.session_id=t.session_id AND m.turn_id=t.turn_id ORDER BY m.started_at DESC LIMIT 1),'未知模型'),COALESCE((SELECT agent FROM model_usage m WHERE m.session_id=t.session_id AND m.turn_id=t.turn_id ORDER BY m.started_at DESC LIMIT 1),'主 Agent') FROM tool_usage t WHERE COALESCE(completed_at,started_at,0)>=?1").map_err(|_| "此 ZCode 版本的工具统计暂不支持")?;
    let rows=tools.query_map([since as i64],|r|Ok(Metric {id:hash(&format!("zcode:tool:{}",r.get::<_,String>(0)?)),device:device.into(),source:"zcode".into(),revision:0,session:label(&r.get::<_,String>(1)?),tool:label(&r.get::<_,String>(2)?),timestamp:r.get(3)?,model:label(&r.get::<_,String>(4)?),agent:label(&r.get::<_,String>(5)?),kind:"tool".into(),tokens:Tokens::default()})).map_err(|_| "读取 ZCode 工具统计失败")?;
    for row in rows {let e=row.map_err(|_| "读取 ZCode 工具记录失败")?;c.offset=c.offset.max(e.timestamp.max(0) as u64);if e.timestamp>0 && merge_metric(&tx,&e,true)?{count+=1}}
    // Older ZCode records predate model_usage. Select metrics only and exclude modern rows.
    let legacy_key=format!("{key}:legacy");let mut legacy=cursor(&tx,&legacy_key)?;let legacy_since=legacy.offset.saturating_sub(5000) as i64;
    // Capture source watermarks before scanning, including rows excluded by modern usage.
    let legacy_highwater=source.query_row("SELECT MAX(n) FROM (SELECT MAX(time_updated) AS n FROM message UNION ALL SELECT MAX(time_updated) AS n FROM part)",[],|r|r.get::<_,Option<i64>>(0)).ok().flatten().unwrap_or(0).max(0) as u64;
    let sql="SELECT m.id,m.session_id,COALESCE(json_extract(m.data,'$.modelID'),json_extract(m.data,'$.modelId'),'未知模型'),COALESCE(json_extract(m.data,'$.agent'),'主 Agent'),m.time_created,json_extract(m.data,'$.tokens.input'),json_extract(m.data,'$.tokens.cache.read'),json_extract(m.data,'$.tokens.cache.write'),json_extract(m.data,'$.tokens.output'),json_extract(m.data,'$.tokens.reasoning'),json_extract(m.data,'$.tokens.total'),m.time_updated FROM message m WHERE m.time_updated>=?1 AND json_extract(m.data,'$.role')='assistant' AND COALESCE(json_extract(m.data,'$.tokens.output'),0)+COALESCE(json_extract(m.data,'$.tokens.input'),0)>0 AND NOT EXISTS(SELECT 1 FROM model_usage u WHERE u.assistant_message_id=m.id OR (u.assistant_message_id IS NULL AND u.session_id=m.session_id AND u.completed_at=m.time_created AND u.input_tokens=json_extract(m.data,'$.tokens.input') AND u.output_tokens=json_extract(m.data,'$.tokens.output')))";
    if let Ok(mut stmt)=source.prepare(sql){let rows=stmt.query_map([legacy_since],|r|{let n=|i|r.get::<_,Option<i64>>(i).map(|v|v.unwrap_or(0).max(0) as u64);let input=n(5)?;let output=n(8)?;Ok((Metric{id:hash(&format!("zcode:legacy:model:{}",r.get::<_,String>(0)?)),device:device.into(),source:"zcode".into(),revision:0,session:label(&r.get::<_,String>(1)?),model:label(&r.get::<_,String>(2)?),agent:label(&r.get::<_,String>(3)?),tool:String::new(),timestamp:r.get(4)?,kind:"tokens".into(),tokens:Tokens{input,output,cached:n(6)?,cache_write:n(7)?,reasoning:n(9)?,total:r.get::<_,Option<i64>>(10)?.map(|v|v.max(0) as u64).unwrap_or(input+output)}},r.get::<_,i64>(11)?))}).map_err(|_|"读取 ZCode 历史统计失败")?;for row in rows{let(e,updated)=row.map_err(|_|"读取 ZCode 历史记录失败")?;legacy.offset=legacy.offset.max(updated.max(0) as u64);if merge_metric(&tx,&e,true)?{count+=1}}}
    let sql="SELECT COALESCE(json_extract(p.data,'$.callID'),p.id),p.session_id,json_extract(p.data,'$.tool'),p.time_created,p.time_updated FROM part p WHERE p.time_updated>=?1 AND json_extract(p.data,'$.type')='tool' AND NOT EXISTS(SELECT 1 FROM tool_usage t WHERE t.tool_call_id=json_extract(p.data,'$.callID'))";
    if let Ok(mut stmt)=source.prepare(sql){let rows=stmt.query_map([legacy_since],|r|Ok((Metric{id:hash(&format!("zcode:tool:{}",r.get::<_,String>(0)?)),device:device.into(),source:"zcode".into(),revision:0,session:label(&r.get::<_,String>(1)?),tool:label(&r.get::<_,String>(2)?),timestamp:r.get(3)?,model:"未知模型".into(),agent:"未知 Agent".into(),kind:"tool".into(),tokens:Tokens::default()},r.get::<_,i64>(4)?))).map_err(|_|"读取 ZCode 历史工具失败")?;for row in rows{let(e,updated)=row.map_err(|_|"读取 ZCode 历史工具失败")?;legacy.offset=legacy.offset.max(updated.max(0) as u64);if merge_metric(&tx,&e,true)?{count+=1}}}
    legacy.offset=legacy.offset.max(legacy_highwater);
    save_cursor(&tx,&legacy_key,&legacy)?;
    save_cursor(&tx,&key,&c)?;tx.commit().map_err(|_| "保存 ZCode 统计失败")?; Ok(count)
}

#[derive(Serialize,Deserialize)]
struct Packet { schema:u32, device:OptionsDevice, events:Vec<Metric> }

// 旧指标包格式兼容：每包最多 1000 条，仅包含白名单指标。
pub fn cloud_packets(dir: &Path) -> Result<Vec<(String,String)>,String> {
    let o=options(dir); save_options(dir,&o)?;
    let db=database(dir)?;
    let mut stmt=db.prepare("SELECT body FROM metrics WHERE local=1 ORDER BY id").map_err(|_|"读取同步统计失败")?;
    let rows=stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|_|"读取同步统计失败")?;
    let mut packets=Vec::new(); let mut events=Vec::new();
    for row in rows {
        events.push(serde_json::from_str::<Metric>(&row.map_err(|_|"读取同步统计失败")?).map_err(|_|"统计格式无效")?);
        if events.len()==1000 { packets.push(cloud_packet(&o,std::mem::take(&mut events))?); }
    }
    if !events.is_empty() { packets.push(cloud_packet(&o,events)?); }
    Ok(packets)
}
fn cloud_packet(o:&Options,events:Vec<Metric>)->Result<(String,String),String>{
    let body=serde_json::to_string(&Packet{schema:1,device:OptionsDevice{id:o.device_id.clone(),name:o.device_name.clone()},events}).map_err(|_|"编码同步统计失败")?;
    Ok((format!("quota-{}-{}.json",o.device_id,hash(&body)),body))
}
pub fn import_cloud_packet(dir:&Path,data:&[u8])->Result<usize,String>{
    if data.len()>4*1024*1024 {return Err("同步文件过大".into())}
    let p:Packet=serde_json::from_slice(data).map_err(|_|"同步文件格式无效")?;
    if p.schema!=1||p.events.len()>1000||uuid::Uuid::parse_str(&p.device.id).is_err()||p.device.name.len()>640||p.events.iter().any(|e|!e.valid()) {return Err("同步文件格式无效".into())}
    let mut db=database(dir)?;let tx=db.transaction().map_err(|_|"统计资料库忙碌")?;
    tx.execute("INSERT INTO devices(id,name) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET name=excluded.name",params![p.device.id,label(&p.device.name)]).map_err(|_|"保存设备失败")?;
    let mut count=0;for e in p.events {if merge_metric(&tx,&e,false)?{count+=1}}
    tx.commit().map_err(|_|"保存同步统计失败")?;Ok(count)
}

pub fn import_activity_data(dir:&Path,data:&Value)->Result<usize,String>{
    let events:Vec<Metric>=serde_json::from_value(data.get("events").cloned().ok_or("文件缺少统计事件")?).map_err(|_|"统计事件格式无效")?;
    let devices:Vec<OptionsDevice>=serde_json::from_value(data.get("devices").cloned().ok_or("文件缺少设备列表")?).map_err(|_|"设备列表格式无效")?;
    if events.len()>500000||events.iter().any(|e|!e.valid())||devices.len()>10000||devices.iter().any(|d|uuid::Uuid::parse_str(&d.id).is_err()||d.name.len()>640||d.name.chars().any(char::is_control)){return Err("同步数据格式或大小无效，未导入".into())}
    let mut db=database(dir)?;let tx=db.transaction().map_err(|_|"统计资料库忙碌")?;
    for d in devices{tx.execute("INSERT INTO devices(id,name) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET name=excluded.name",params![d.id,d.name]).map_err(|_|"保存设备失败")?;}
    let mut count=0;for event in events{if merge_metric(&tx,&event,false)?{count+=1}}
    tx.commit().map_err(|_|"保存同步统计失败")?;Ok(count)
}
#[derive(Clone,Serialize,Deserialize)]
pub struct OptionsDevice { pub id:String, pub name:String }
fn sync(db:&mut Connection,o:&Options) -> Result<(),String> {
    if o.sync_dir.is_empty(){return Ok(())}
    let root=PathBuf::from(&o.sync_dir).join("quota-activity-v1");let own=root.join(&o.device_id);
    fs::create_dir_all(&own).map_err(|_| "同步目录不可用，统计已保留在本机")?;
    loop {
        let pending:Vec<(i64,String)>=db.prepare("SELECT seq,event_id FROM outbox ORDER BY seq LIMIT 1000").map_err(|_| "读取同步队列失败")?.query_map([],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_| "读取同步队列失败")?.collect::<Result<_,_>>().map_err(|_| "读取同步队列失败")?;
        if pending.is_empty(){break}let mut events=Vec::new();
        for (_,id) in &pending {let text:String=db.query_row("SELECT body FROM metrics WHERE id=?1",[id],|r|r.get(0)).map_err(|_| "读取同步统计失败")?;events.push(serde_json::from_str(&text).map_err(|_| "同步统计格式无效")?);}
        let max=pending.last().expect("nonempty").0;
        let packet=Packet {schema:1,device:OptionsDevice{id:o.device_id.clone(),name:o.device_name.clone()},events};
        crate::storage::write_atomic(&own.join(format!("{max:020}.json")),&serde_json::to_string(&packet).map_err(|_| "写入同步统计失败")?)?;
        db.execute("DELETE FROM outbox WHERE seq<=?1",[max]).map_err(|_| "保存同步进度失败")?;
    }
    let dirs=fs::read_dir(&root).map_err(|_| "同步目录暂时无法读取")?;
    for device in dirs.flatten(){if !device.file_type().is_ok_and(|t|t.is_dir()&&!t.is_symlink()){continue}if let Ok(items)=fs::read_dir(device.path()){for file in items.flatten(){
        if !file.file_type().is_ok_and(|t|t.is_file()&&!t.is_symlink())||file.path().extension().is_none_or(|e|e!="json"){continue}
        let receipt=file.path().to_string_lossy().into_owned();let seen:bool=db.query_row("SELECT EXISTS(SELECT 1 FROM receipts WHERE path=?1)",[&receipt],|r|r.get(0)).map_err(|_| "读取同步进度失败")?;if seen{continue}
        if file.metadata().map_err(|_| "同步文件暂不可用")?.len()>4*1024*1024{return Err("同步文件过大".into())}
        let data=fs::read(file.path()).map_err(|_| "同步文件暂不可用")?;
        let p:Packet=serde_json::from_slice(&data).map_err(|_| "同步文件尚未下载完成或格式无效")?;
        if p.schema!=1||p.events.len()>1000||uuid::Uuid::parse_str(&p.device.id).is_err()||p.device.name.len()>640{return Err("同步文件格式无效".into())}
        let tx=db.transaction().map_err(|_| "统计资料库忙碌")?;
        tx.execute("INSERT INTO devices(id,name) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET name=excluded.name",params![p.device.id,label(&p.device.name)]).map_err(|_| "保存设备信息失败")?;
        for e in p.events {merge_metric(&tx,&e,false)?;}
        tx.execute("INSERT INTO receipts(path) VALUES(?1)",[receipt]).map_err(|_| "保存同步进度失败")?;tx.commit().map_err(|_| "保存同步统计失败")?;
    }}}
    Ok(())
}

#[derive(Default,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Group { pub key:String, pub tokens:Tokens, pub calls:u64, pub sessions:u64 }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Report { pub options:Options, pub devices:Vec<OptionsDevice>, pub totals:Group, pub models:Vec<Group>, pub available_models:Vec<Group>, pub tools:Vec<Group>, pub agents:Vec<Group>,pub daily:Vec<Group>,pub sources:Vec<Group>,pub by_device:Vec<Group>,pub updated_at:Option<i64>,pub errors:Vec<String> }
fn aggregate(events:&[Metric],key:impl Fn(&Metric)->String)->Vec<Group>{
    let mut result:BTreeMap<String,(Group,std::collections::BTreeSet<String>)>=BTreeMap::new();
    for e in events{let k=key(e);let (g,s)=result.entry(k.clone()).or_insert_with(||(Group{key:k,..Default::default()},Default::default()));g.tokens.add(&e.tokens);g.calls+=u64::from(e.kind=="tool");s.insert(format!("{}:{}",e.source,e.session));}
    result.into_values().map(|(mut g,s)|{g.sessions=s.len() as u64;g}).collect()
}
pub fn report(dir:&Path, device:Option<String>,source:Option<String>,days:Option<u32>)->Result<Report,String>{
    report_filtered(dir,device,source,days,None)
}
pub fn report_filtered(dir:&Path, device:Option<String>,source:Option<String>,days:Option<u32>,model:Option<String>)->Result<Report,String>{
    report_range(dir,device,source,days,model,None,None)
}
pub fn report_range(dir:&Path, device:Option<String>,source:Option<String>,days:Option<u32>,model:Option<String>,from:Option<String>,to:Option<String>)->Result<Report,String>{
    let date=|value:Option<String>|->Result<Option<chrono::NaiveDate>,String>{value.filter(|s|!s.is_empty()).map(|s|chrono::NaiveDate::parse_from_str(&s,"%Y-%m-%d").map_err(|_|"日期格式无效".to_string())).transpose()};
    let from=date(from)?;let to=date(to)?;if from.zip(to).is_some_and(|(a,b)|a>b){return Err("开始日期不能晚于结束日期".into())}
    let db=database(dir)?;let o=options(dir);let mut events=Vec::new();
    // Calendar dates agree with the daily chart, including the first day in full.
    // Subtract dates rather than 24-hour durations so daylight-saving days work too.
    let today=chrono::Local::now().date_naive();
    let first_day=days.filter(|d|*d>0).map(|d|today.checked_sub_days(chrono::Days::new(u64::from(d-1))).unwrap_or(chrono::NaiveDate::MIN));
    let mut stmt=db.prepare("SELECT body FROM metrics").map_err(|_| "读取统计失败")?;let rows=stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|_| "读取统计失败")?;
    for r in rows{let e:Metric=serde_json::from_str(&r.map_err(|_| "读取统计失败")?).map_err(|_| "统计资料库损坏")?;
        let in_range=chrono::DateTime::from_timestamp_millis(e.timestamp).is_some_and(|t|{let date=t.with_timezone(&chrono::Local).date_naive();date<=today&&first_day.is_none_or(|first|date>=first)&&from.is_none_or(|d|date>=d)&&to.is_none_or(|d|date<=d)});
        if in_range && device.as_ref().is_none_or(|d|d.is_empty()||d==&e.device) && source.as_ref().is_none_or(|s|s.is_empty()||s==&e.source){events.push(e)}}
    let devices=db.prepare("SELECT id,name FROM devices ORDER BY name").map_err(|_| "读取设备失败")?.query_map([],|r|Ok(OptionsDevice{id:r.get(0)?,name:r.get(1)?})).map_err(|_| "读取设备失败")?.collect::<Result<_,_>>().map_err(|_| "读取设备失败")?;
    let status:Value=fs::read(dir.join("activity-status.json")).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
    // Keep model choices scoped to device/source/dates while viewing one model.
    let available_models=aggregate(&events.iter().filter(|e|e.kind=="tokens").cloned().collect::<Vec<_>>(),|e|e.model.clone());
    events.retain(|e|model.as_ref().is_none_or(|m|m.is_empty()||m==&e.model));
    let token_events:Vec<Metric>=events.iter().filter(|e|e.kind=="tokens").cloned().collect();let tool_events:Vec<Metric>=events.iter().filter(|e|e.kind=="tool").cloned().collect();
    Ok(Report{ options:o,devices,totals:aggregate(&events,|_|"全部".into()).pop().unwrap_or_default(),models:aggregate(&token_events,|e|e.model.clone()),available_models,tools:aggregate(&tool_events,|e|e.tool.clone()),agents:aggregate(&events,|e|e.agent.clone()),daily:aggregate(&events,|e|chrono::DateTime::from_timestamp_millis(e.timestamp).map(|t|t.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string()).unwrap_or_default()),sources:aggregate(&events,|e|e.source.clone()),by_device:aggregate(&events,|e|e.device.clone()),updated_at:status.get("at").and_then(Value::as_i64),errors:status.get("errors").and_then(|v|serde_json::from_value(v.clone()).ok()).unwrap_or_default() })
}
pub fn collect(dir:&Path)->Result<usize,String>{
    collect_cycle(dir, true)
}
fn collect_cycle(dir:&Path,sync_enabled:bool)->Result<usize,String>{
    let o=options(dir);save_options(dir,&o)?;let mut db=database(dir)?;
    db.execute("INSERT INTO devices(id,name) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET name=excluded.name",params![o.device_id,o.device_name]).map_err(|_| "保存设备失败")?;
    let mut errors=Vec::new();let mut count=0;
    match collect_codex(&mut db,Path::new(&o.codex_home),&o.device_id){Ok(n)=>count+=n,Err(e)=>errors.push(e)}
    for path in [PathBuf::from(&o.zcode_home).join("v2/tasks-index.sqlite"),PathBuf::from(&o.zcode_home).join("cli/db/db.sqlite")]{match collect_zcode(&mut db,&path,&o.device_id){Ok(n)=>count+=n,Err(e)=>errors.push(e)}}
    if !o.harness_home.is_empty() { harness::collect(&mut db, Path::new(&o.harness_home), &o.device_id, &mut count, &mut errors); }
    let sync_errors:Vec<String>=if sync_enabled {
        sync(&mut db,&o).err().into_iter().collect()
    } else {
        fs::read(dir.join("activity-status.json")).ok().and_then(|b|serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v|v.get("syncErrors").cloned()).and_then(|v|serde_json::from_value(v).ok()).unwrap_or_default()
    };
    errors.extend(sync_errors.iter().cloned());
    crate::storage::write_atomic(&dir.join("activity-status.json"),&serde_json::json!({"at":now(),"errors":errors,"syncErrors":sync_errors}).to_string())?;Ok(count)
}
#[tauri::command]
pub async fn get_activity(app:AppHandle,device:Option<String>,source:Option<String>,days:Option<u32>,model:Option<String>,from:Option<String>,to:Option<String>)->Result<Report,String>{tauri::async_runtime::spawn_blocking(move||{let state=app.state::<AppState>();report_range(state.store.dir(),device,source,days,model,from,to)}).await.map_err(|_|"读取统计失败")?}
#[tauri::command]
pub async fn refresh_activity(app:AppHandle)->Result<usize,String>{
    tauri::async_runtime::spawn_blocking(move ||{let state=app.state::<AppState>();let _guard=state.activity_lock.lock().map_err(|_| "统计暂不可用")?;let count=collect(state.store.dir())?;let _=app.emit("activity-updated", ());Ok(count)}).await.map_err(|_| "采集统计失败")?
}
#[tauri::command]
pub fn get_activity_options(app:AppHandle)->Options{options(app.state::<AppState>().store.dir())}
#[tauri::command]
pub async fn save_activity_options(app:AppHandle,mut input:Options)->Result<(),String>{
    tauri::async_runtime::spawn_blocking(move||{let state=app.state::<AppState>();
    let _guard=state.activity_lock.lock().map_err(|_| "统计暂不可用")?;
    let previous=options(state.store.dir());
    input.device_id=previous.device_id;input.device_name=label(&input.device_name);
    if !(5..=3600).contains(&input.collect_interval_seconds) { return Err("采集间隔应为 5–3600 秒".into()); }
    for p in [&input.codex_home,&input.zcode_home,&input.harness_home,&input.sync_dir]{if !p.is_empty()&&!Path::new(p).is_absolute(){return Err("请选择绝对路径的目录".into())}}
    if !input.sync_dir.is_empty() && (input.sync_dir!=previous.sync_dir || input.device_name!=previous.device_name) {let db=database(state.store.dir())?;db.execute("INSERT INTO outbox(event_id) SELECT id FROM metrics WHERE local=1",[]).map_err(|_|"初始化同步队列失败")?;}
    save_options(state.store.dir(),&input)
    }).await.map_err(|_|"保存统计设置失败")?
}
pub fn spawn(app:AppHandle){tauri::async_runtime::spawn(async move{
    tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    let mut last_collect=None;let mut last_sync=None;
    loop {
        let o={let state=app.state::<AppState>();options(state.store.dir())};
        if o.auto_collect && last_collect.is_none_or(|t:std::time::Instant|t.elapsed().as_secs()>=o.collect_interval_seconds.clamp(5,3600)) {
            let should_sync=last_sync.is_none_or(|t:std::time::Instant|t.elapsed().as_secs()>=300);
            let handle=app.clone();
            let completed=tauri::async_runtime::spawn_blocking(move||{
                let state=handle.state::<AppState>();let Ok(_guard)=state.activity_lock.try_lock() else{return false};
                if collect_cycle(state.store.dir(),should_sync).is_ok(){let _=handle.emit("activity-updated",());}
                true
            }).await.unwrap_or(false);
            if completed{last_collect=Some(std::time::Instant::now());if should_sync{last_sync=last_collect;}}
        }
        tokio::time::sleep(std::time::Duration::from_secs(1)).await;
    }
});}
