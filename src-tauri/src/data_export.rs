//! Portable data export. Never reads keyring, raw provider responses or source logs.
use crate::{activity::Metric, commands::AppState, model::{Account, AccountStatus}};
use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::{collections::HashMap, fs, io::Write, path::Path};
use tauri::{AppHandle, Manager};

struct LimitedWriter<'a> { file: &'a mut fs::File, bytes: usize }
impl Write for LimitedWriter<'_> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        if self.bytes.saturating_add(buffer.len()) >= 256 * 1024 * 1024 {
            return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "导出文件超过 256 MB 上限"));
        }
        let count = self.file.write(buffer)?;
        self.bytes += count;
        Ok(count)
    }
    fn flush(&mut self) -> std::io::Result<()> { self.file.flush() }
}

pub fn account_data(account: &Account, status: Option<&AccountStatus>) -> Value {
    let balance = status.and_then(|s| s.balance.as_ref()).map(|b| json!({
        "currency":b.currency,"total":b.total,"source":b.source,"amounts":b.amounts,"usable":b.usable
    }));
    json!({"id":account.id,"provider":account.provider,"label":account.label,"createdAt":account.created_at,
        "balanceMode":account.balance_mode,"lowBalanceThreshold":account.low_balance_threshold,
        "manualBalance":account.manual_balance,"manualCurrency":account.manual_currency,
        "manualRechargeTotal":account.manual_recharge_total,"manualRechargeCurrency":account.manual_recharge_currency,
        "manualSpendTotal":account.manual_spend_total,"manualSpendCurrency":account.manual_spend_currency,
        "quotaTotal":account.quota_total,
        "balance":balance,"lastChecked":status.and_then(|s|s.last_checked.as_ref()),
        "subscription":status.and_then(|s|s.subscription.as_ref())})
}

pub fn activity_data(dir: &Path) -> Result<Value, String> {
    let path = dir.join("activity.sqlite");
    if !path.exists() { return Ok(json!({"events":[],"devices":[]})); }
    let mut db = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e|format!("读取活动资料库失败：{e}"))?;
    db.busy_timeout(std::time::Duration::from_secs(5)).map_err(|e|e.to_string())?;
    let tx = db.transaction().map_err(|e|format!("读取统计快照失败：{e}"))?;
    let mut events = Vec::new();
    let mut bytes = 0usize;
    {
        let mut stmt = tx.prepare("SELECT body FROM metrics ORDER BY id").map_err(|e|format!("读取活动事件失败：{e}"))?;
        let rows = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(|e|e.to_string())?;
        for row in rows {
            let text = row.map_err(|e|e.to_string())?;
            bytes = bytes.saturating_add(text.len());
            if bytes > 256 * 1024 * 1024 { return Err("活动数据超过当前单文件导出上限 256 MB，未写入导出文件".into()); }
            events.push(serde_json::from_str::<Metric>(&text).map_err(|_|"活动记录格式损坏，已中止导出".to_string())?);
        }
    }
    let devices = {
        let mut stmt = tx.prepare("SELECT id,name FROM devices ORDER BY id").map_err(|e|format!("读取设备失败：{e}"))?;
        let rows = stmt.query_map([], |row|Ok(json!({"id":row.get::<_,String>(0)?,"name":row.get::<_,String>(1)?}))).map_err(|e|e.to_string())?;
        rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?
    };
    tx.commit().map_err(|e|e.to_string())?;
    Ok(json!({"events":events,"devices":devices}))
}

pub fn write_file(path: &Path, data_dir: &Path, value: &Value) -> Result<(), String> {
    if !path.is_absolute() || path.extension().is_none_or(|e| !e.to_string_lossy().eq_ignore_ascii_case("json")) { return Err("请选择绝对路径的 JSON 导出文件".into()); }
    let parent = path.parent().ok_or("保存目录无效")?.canonicalize().map_err(|_|"保存目录不存在或不可访问")?;
    let source = data_dir.canonicalize().map_err(|_|"配置目录不可访问")?;
    if parent.starts_with(&source) || path.exists() && path.canonicalize().map_err(|_|"导出目标不可访问")?.starts_with(&source) { return Err("请保存到 Quota 配置目录之外，避免覆盖正在使用的数据".into()); }
    let temp = parent.join(format!(".quota-export-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e|format!("创建导出文件失败：{e}"))?;
        serde_json::to_writer_pretty(&mut LimitedWriter { file: &mut file, bytes: 0 }, value).map_err(|e|format!("写入导出数据失败：{e}"))?;
        file.write_all(b"\n").and_then(|_|file.sync_all()).map_err(|e|format!("保存导出数据失败：{e}"))?;
        drop(file);
        fs::rename(&temp, parent.join(path.file_name().ok_or("导出文件名无效")?)).map_err(|e|format!("完成导出失败：{e}"))
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

fn export(state: &AppState, path: &Path) -> Result<String, String> {
    state.store.ensure_core_files_writable()?;
    let config = state.config.lock().map_err(|_|"读取账户失败")?.clone();
    let statuses: HashMap<String, AccountStatus> = state.statuses.lock().map_err(|_|"读取余额失败")?.clone();
    let accounts: Vec<Value> = config.accounts.iter().map(|a|account_data(a,statuses.get(&a.id))).collect();
    let overrides = state.overrides.lock().map_err(|_|"读取模型资料失败")?.clone();
    let catalog: Vec<Value> = overrides.iter().map(|c|json!({"match":c.r#match,"name":c.name,"vendor":c.vendor,"providers":c.providers,"summary":c.summary,"abilities":c.abilities,"source":c.source,"context":c.context,"maxOutput":c.max_output,"price":c.price,"verified":c.verified,"verifiedAt":c.verified_at,"edited":c.edited,"hidden":c.hidden})).collect();
    let hidden = state.hidden_models.lock().map_err(|_|"读取隐藏列表失败")?.clone();
    let history = state.history.lock().map_err(|_|"读取余额历史失败")?.export_points();
    let activity = {
        let _guard = state.activity_lock.lock().map_err(|_|"统计暂不可用")?;
        activity_data(state.store.dir())?
    };
    let events = activity["events"].as_array().map_or(0,Vec::len);
    let payload = json!({"format":"quota-data-export","schemaVersion":2,"appVersion":crate::version::display_version(),
        "exportedAt":chrono::Utc::now().to_rfc3339(),"reportTimezone":"system-local",
        "accounts":accounts,"settings":config.settings,"balanceHistory":history,"catalogOverrides":catalog,"hiddenModels":hidden,"activity":activity,
        "exclusions":["credentials","customRequests","accountNotes","rawResponses","sourcePaths","sourceLogs","syncQueues"],
        "restorable":true});
    write_file(path,state.store.dir(),&payload)?;
    Ok(format!("已导出 {} 个账户、{events} 条活动记录",config.accounts.len()))
}

#[tauri::command]
pub async fn export_data(app: AppHandle, path: String) -> Result<String,String> {
    tauri::async_runtime::spawn_blocking(move ||export(&app.state::<AppState>(),Path::new(&path))).await.map_err(|_|"导出任务未完成，请重试".to_string())?
}

#[tauri::command]
pub async fn export_activity_sync(app:AppHandle,path:String)->Result<String,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let state=app.state::<AppState>();let _guard=state.activity_lock.lock().map_err(|_|"统计同步忙碌")?;
        crate::activity::collect(state.store.dir())?;
        let activity=activity_data(state.store.dir())?;
        let n=activity["events"].as_array().map_or(0,Vec::len);
        let value=json!({"format":"quota-activity-sync","schemaVersion":1,"exportedAt":chrono::Utc::now().to_rfc3339(),"activity":activity});
        write_file(Path::new(&path),state.store.dir(),&value)?;Ok(format!("已导出 {n} 条统计记录，请上传到飞书 Quota 同步文件夹"))
    }).await.map_err(|_|"导出统计任务中断".to_string())?
}
#[tauri::command]
pub async fn import_activity_sync(app:AppHandle,path:String)->Result<String,String>{
    tauri::async_runtime::spawn_blocking(move||{
        let path=Path::new(&path);if !path.is_absolute(){return Err("请选择绝对路径的同步文件".into())}
        let file=fs::File::open(path).map_err(|_|"无法读取统计文件")?;
        use std::io::Read;let mut bytes=Vec::new();file.take(256*1024*1024+1).read_to_end(&mut bytes).map_err(|_|"无法读取统计文件")?;
        if bytes.len()>256*1024*1024{return Err("同步文件超过 256 MB 上限".into())}
        let value:Value=serde_json::from_slice(&bytes).map_err(|_|"同步文件 JSON 格式无效")?;
        if !matches!(value["format"].as_str(),Some("quota-activity-sync"|"quota-data-export"))||!matches!(value["schemaVersion"].as_u64(),Some(1|2)){return Err("不支持此同步文件格式".into())}
        let state=app.state::<AppState>();let _guard=state.activity_lock.lock().map_err(|_|"统计同步忙碌")?;
        let n=crate::activity::import_activity_data(state.store.dir(),&value["activity"])?;
        Ok(format!("已合并 {n} 条新记录或更新，重复记录已去重；可在 Token 活动查看"))
    }).await.map_err(|_|"导入统计任务中断".to_string())?
}
