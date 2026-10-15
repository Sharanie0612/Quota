//! Replicate billing metadata beside the existing activity packets. No Token
//! events, source logs, account names, endpoints or credentials enter this file.
use crate::{activity, commands::AppState, usage_fx::{self, MonthlyRate}, vendor_costs::{self, Expense, Samples}};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::{collections::{BTreeMap, BTreeSet}, fs, io::Read, path::Path};

const LIMIT: u64 = 8 * 1024 * 1024;
const MAX_RECORDS: usize = 10_000;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
struct Record<T> { clock: u64, device: String, value: Option<T> }
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Records {
    expenses: BTreeMap<String, Record<Expense>>,
    rates: BTreeMap<String, Record<MonthlyRate>>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Packet { schema: u32, device: String, records: Records, samples: Samples }
fn read<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let file = fs::File::open(path).map_err(|_| "费用同步文件暂不可用")?;
    if file.metadata().map_err(|_| "费用同步文件暂不可用")?.len() > LIMIT { return Err("费用同步文件超过 8 MB 上限".into()); }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1).read_to_end(&mut bytes).map_err(|_| "费用同步文件暂不可用")?;
    if bytes.len() as u64 > LIMIT { return Err("费用同步文件超过 8 MB 上限".into()); }
    serde_json::from_slice(&bytes).map_err(|_| "费用同步文件损坏，原文件已保留".into())
}
fn write<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let text = serde_json::to_string(value).map_err(|_| "编码费用同步失败")?;
    if text.len() as u64 > LIMIT { return Err("费用同步内容超过 8 MB 上限".into()); }
    crate::storage::write_atomic(path, &text)
}
fn valid_records(rows: &Records) -> bool {
    let version = |clock: u64, device: &str| clock > 0 && clock < u64::MAX && uuid::Uuid::parse_str(device).is_ok();
    rows.expenses.len() + rows.rates.len() <= MAX_RECORDS
        && rows.expenses.iter().all(|(id,r)| version(r.clock,&r.device) && vendor_costs::valid_sync_key(id)
            && r.value.as_ref().is_none_or(|e| vendor_costs::valid_expense(e) && vendor_costs::expense_key(e) == *id))
        && rows.rates.iter().all(|(id,r)| version(r.clock,&r.device)
            && chrono::NaiveDate::parse_from_str(&format!("{id}-01"),"%Y-%m-%d").is_ok_and(|d| d.format("%Y-%m").to_string() == *id)
            && r.value.as_ref().is_none_or(|v| usage_fx::valid(v) && v.month == *id))
}
fn load(dir: &Path) -> Result<Records,String> {
    let path = dir.join("usage-sync.json");
    if !path.try_exists().map_err(|_| "费用同步索引暂不可用")? { return Ok(Records::default()); }
    let records: Records = read(&path)?;
    if !valid_records(&records) { return Err("费用同步索引无效，原文件已保留".into()); }
    Ok(records)
}
fn clock(rows: &Records) -> u64 {
    rows.expenses.values().map(|r|r.clock).chain(rows.rates.values().map(|r|r.clock)).max().unwrap_or(0)
}
fn reconcile<T: Clone + PartialEq>(rows: &mut BTreeMap<String,Record<T>>, current: &BTreeMap<String,T>, device: &str, clock: u64) {
    let keys: BTreeSet<_> = rows.keys().chain(current.keys()).cloned().collect();
    for id in keys {
        let value = current.get(&id);
        if rows.get(&id).and_then(|r|r.value.as_ref()) != value {
            rows.insert(id,Record { clock,device:device.into(),value:value.cloned() });
        }
    }
}
fn merge<T: Clone + PartialEq>(target: &mut BTreeMap<String,Record<T>>, source: &BTreeMap<String,Record<T>>) -> Result<(),String> {
    for (id,next) in source {
        if let Some(old) = target.get(id) {
            if (old.clock,&old.device) == (next.clock,&next.device) && old != next { return Err("费用同步版本冲突，原记录已保留".into()); }
            if (old.clock,&old.device) >= (next.clock,&next.device) { continue; }
        }
        target.insert(id.clone(),next.clone());
    }
    Ok(())
}
fn values<T: Clone>(rows: &BTreeMap<String,Record<T>>) -> BTreeMap<String,T> {
    rows.iter().filter_map(|(id,r)|r.value.clone().map(|v|(id.clone(),v))).collect()
}

/// Called with billing_lock held by application entry points. The local files
/// retain their old formats so older devices keep reading their own settings.
pub fn exchange(dir: &Path) -> Result<(),String> {
    let options = activity::options(dir);
    if options.sync_dir.is_empty() { return Ok(()); }
    if uuid::Uuid::parse_str(&options.device_id).is_err() { return Err("费用同步设备标识无效".into()); }
    let (expenses, _) = vendor_costs::sync_data(dir)?;
    let rates = usage_fx::load(dir)?;
    let mut local = load(dir)?;
    let next = clock(&local).checked_add(1).filter(|n| *n < u64::MAX).ok_or("费用同步版本已满")?;
    reconcile(&mut local.expenses,&expenses,&options.device_id,next);
    reconcile(&mut local.rates,&rates,&options.device_id,next);
    if !valid_records(&local) { return Err("费用同步记录超过上限，原记录已保留".into()); }
    // Save local edits/deletion markers before touching the cloud folder.
    write(&dir.join("usage-sync.json"),&local)?;
    let root = Path::new(&options.sync_dir).join("quota-usage-v1");
    if fs::symlink_metadata(&root).is_ok_and(|m| m.file_type().is_symlink()) { return Err("费用同步目录不能为符号链接".into()); }
    fs::create_dir_all(&root).map_err(|_| "费用同步目录不可用，本机支出已保留")?;
    let mut files = fs::read_dir(&root).map_err(|_| "费用同步目录暂不可用")?
        .collect::<Result<Vec<_>,_>>().map_err(|_| "部分费用同步文件暂不可用")?;
    files.sort_by_key(|f|f.file_name());
    let mut errors = Vec::new(); let mut count = 0;
    for file in files {
        let path = file.path();
        if path.extension().is_none_or(|e|e != "json") { continue; }
        count += 1;
        if count > 100 { errors.push("费用同步设备文件超过 100 个上限".into()); break; }
        let result = (|| -> Result<(),String> {
            if !file.file_type().is_ok_and(|t|t.is_file() && !t.is_symlink()) { return Err("不读取符号链接的费用同步文件".into()); }
            let packet: Packet = read(&path)?;
            // Cloud drives rename conflict copies. The signed-in local folder is
            // not an identity authority: validate the embedded UUID and records.
            if packet.schema != 1 || uuid::Uuid::parse_str(&packet.device).is_err()
                || !valid_records(&packet.records) || !vendor_costs::valid_samples(&packet.samples) { return Err("费用同步数据无效，原记录已保留".into()); }
            let mut candidate = local.clone();
            merge(&mut candidate.expenses,&packet.records.expenses)?;
            merge(&mut candidate.rates,&packet.records.rates)?;
            if !valid_records(&candidate) { return Err("合并费用同步记录超过上限".into()); }
            // Apply valid domains independently; an overlapping bill never
            // becomes counted twice and cannot block valid exchange rates.
            let expenses = values(&candidate.expenses);
            let bill_result = vendor_costs::validate_expenses(&expenses);
            let applied = if bill_result.is_ok() { expenses } else { values(&local.expenses) };
            vendor_costs::apply_sync(dir,applied,packet.samples)?;
            if bill_result.is_ok() { local.expenses = candidate.expenses; }
            usage_fx::save(dir,&values(&candidate.rates))?;
            local.rates = candidate.rates;
            write(&dir.join("usage-sync.json"),&local)?;
            bill_result
        })();
        if let Err(error) = result { errors.push(error); }
    }
    let (_,samples) = vendor_costs::sync_data(dir)?;
    write(&root.join(format!("{}.json",options.device_id)),&Packet { schema:1,device:options.device_id,records:local,samples })?;
    errors.sort(); errors.dedup();
    if errors.is_empty() { Ok(()) } else { Err(errors.into_iter().take(4).collect::<Vec<_>>().join("；")) }
}
pub fn sync(state: &AppState) -> Result<(),String> {
    let _guard = state.billing_lock.lock().map_err(|_| "费用同步忙碌")?;
    let result = exchange(state.store.dir());
    write(&state.store.dir().join("usage-sync-status.json"),&result.as_ref().err())?;
    result
}
#[tauri::command]
pub async fn sync_usage_now(app: tauri::AppHandle) -> Result<(),String> {
    use tauri::{Manager, Emitter};
    tauri::async_runtime::spawn_blocking(move || {
        let result = sync(&app.state::<AppState>());
        let _ = app.emit("activity-updated", ());
        result
    }).await.map_err(|_| "费用同步暂不可用")?
}
pub fn queue(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move { let _ = sync_usage_now(app).await; });
}
pub(crate) fn errors(dir: &Path) -> Vec<String> {
    if activity::options(dir).sync_dir.is_empty() { return Vec::new(); }
    match read::<Option<String>>(&dir.join("usage-sync-status.json")) {
        Ok(Some(error)) => vec![format!("我的使用：{error}")],
        Ok(None) => Vec::new(),
        Err(_) if !dir.join("usage-sync-status.json").exists() => Vec::new(),
        Err(error) => vec![error],
    }
}
