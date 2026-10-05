//! Cross-platform migration. Plain exports never restore credentials or custom requests.
use crate::{backup, commands::AppState, history::HistoryPoint, model::{Account, AppConfig, CatalogEntry, Settings}, secrets::{self, SecretBlob}};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::{HashMap, HashSet}, fs, io::Read, path::Path};
use tauri::{AppHandle, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialEntry { pub account_id: String, pub blob: SecretBlob }

pub struct ImportPayload {
    pub accounts: Vec<Account>,
    pub settings: Option<Settings>,
    pub catalog: Option<Vec<CatalogEntry>>,
    pub hidden: Option<Vec<String>>,
    pub history: Option<HashMap<String, Vec<HistoryPoint>>>,
    pub activity: Option<Value>,
    pub credentials: Vec<CredentialEntry>,
    pub encrypted: bool,
}

#[derive(Deserialize, Serialize, Clone, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportSelection {
    pub account_ids: Vec<String>,
    pub credentials: bool,
    pub settings: bool,
    pub catalog: bool,
    pub balance_history: bool,
    pub activity: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    fingerprint: String,
    encrypted: bool,
    accounts: Vec<Value>,
    settings: bool,
    catalog: bool,
    catalog_count: usize,
    balance_history: bool,
    history_count: usize,
    activity: bool,
    activity_count: usize,
    credentials: bool,
}

fn parse<T: serde::de::DeserializeOwned>(value: Value, section: &str) -> Result<T, String> {
    serde_json::from_value(value).map_err(|_| format!("{section}格式无效，未导入"))
}

pub fn decode(bytes: &[u8], password: &str) -> Result<ImportPayload, String> {
    let outer: Value = serde_json::from_slice(bytes).map_err(|_| "文件 JSON 格式无效")?;
    let encrypted = outer["magic"] == "QuotaBackup";
    let value: Value = if encrypted {
        serde_json::from_slice(&backup::open(password, bytes)?).map_err(|_| "备份内容格式无效")?
    } else { outer };
    if encrypted {
        if !matches!(value["version"].as_u64(), Some(1 | 2)) { return Err("不支持此备份版本".into()); }
    } else if !matches!(value["format"].as_str(), Some("quota-data-export" | "quota-activity-sync"))
        || !matches!(value["schemaVersion"].as_u64(), Some(1 | 2)) {
        return Err("不支持此数据文件格式".into());
    }
    let config = if encrypted { value.get("config").ok_or("备份缺少账户配置")? } else { &value };
    let mut accounts: Vec<Account> = match config.get("accounts") {
        Some(v) => parse(v.clone(), "账户")?, None if !encrypted => Vec::new(), None => return Err("备份缺少账户列表".into()),
    };
    if accounts.len() > 10000 { return Err("账户数量超过上限".into()); }
    let mut ids = HashSet::new();
    for a in &mut accounts {
        if a.id.is_empty() || a.id.len() > 256 || a.id.chars().any(char::is_control) || !ids.insert(a.id.clone())
            || crate::providers::find(&a.provider).is_none() || a.label.len() > 1024
            || !a.low_balance_threshold.is_finite() || a.low_balance_threshold < 0.0
            || a.manual_balance.is_some_and(|v| !v.is_finite())
            || a.manual_recharge_total.is_some_and(|v| !v.is_finite() || v < 0.0)
            || a.manual_spend_total.is_some_and(|v| !v.is_finite() || v < 0.0) {
            return Err("账户信息无效或 ID 重复，未导入".into());
        }
        if !encrypted {
            // Accept older JSON exports, but never let plain JSON inject a secret-bearing field.
            a.base_url = None; a.recharge_url = None; a.note = None;
            a.custom_url = None; a.custom_headers = None; a.custom_body = None;
            a.custom_json_path = None; a.custom_method = None; a.custom_currency = None;
        }
    }
    let settings: Option<Settings> = config.get("settings").filter(|v| !v.is_null()).map(|v| parse(v.clone(), "设置")).transpose()?;
    if settings.as_ref().is_some_and(|s| !(1..=1440).contains(&s.refresh_interval_minutes) || !s.default_low_threshold.is_finite() || s.default_low_threshold < 0.0) {
        return Err("设置数值无效，未导入".into());
    }
    let catalog: Option<Vec<CatalogEntry>> = value.get("catalogOverrides").map(|v| parse(v.clone(), "模型资料")).transpose()?;
    if let Some(entries) = &catalog {
        if entries.len() > 100000 { return Err("模型资料超过导入上限".into()); }
        for entry in entries {
            // Legacy report exports omitted source even when verified. Retain their price,
            // but clear the verification marker instead of inventing an official source.
            if encrypted || value["schemaVersion"] == 2 { crate::catalog::validate_entry(entry)?; }
        }
    }
    let hidden: Option<Vec<String>> = value.get("hiddenModels").map(|v| parse(v.clone(), "隐藏模型")).transpose()?;
    if hidden.as_ref().is_some_and(|entries| entries.len() > 100000 || entries.iter().any(|id|id.len() > 4096)) { return Err("隐藏模型列表超过导入上限".into()); }
    let mut catalog = catalog;
    if !encrypted && value["schemaVersion"] == 1 {
        for entry in catalog.iter_mut().flatten() {
            if entry.source.is_none() { entry.verified = false; entry.verified_at = None; }
            crate::catalog::validate_entry(entry)?;
        }
    }
    let history: Option<HashMap<String, Vec<HistoryPoint>>> = value.get("balanceHistory").map(|v| parse(v.clone(), "余额历史")).transpose()?;
    if history.as_ref().is_some_and(|map| map.len() > 10000 || map.values().any(|points| points.len() > 100000 || points.iter().any(|p| !p.v.is_finite() || p.t < 0))) {
        return Err("余额历史格式或大小无效，未导入".into());
    }
    let mut credentials: Vec<CredentialEntry> = if encrypted {
        value.get("credentials").map(|v| parse(v.clone(), "登录信息")).transpose()?.unwrap_or_default()
    } else { Vec::new() };
    let mut credential_ids = HashSet::new();
    if credentials.iter().any(|c| !ids.contains(&c.account_id) || !credential_ids.insert(c.account_id.clone())) {
        return Err("登录信息与账户不匹配，未导入".into());
    }
    // Empty entries in old backups must not erase credentials already on the target device.
    credentials.retain(|entry| serde_json::to_value(&entry.blob).is_ok_and(|value|
        value.as_object().is_some_and(|fields| fields.values().any(|v| v.as_str().is_some_and(|s| !s.trim().is_empty())))));
    Ok(ImportPayload { accounts, settings, catalog, hidden, history, activity: value.get("activity").cloned(), credentials, encrypted })
}

fn read_file(path: &str) -> Result<Vec<u8>, String> {
    if !Path::new(path).is_absolute() { return Err("请选择绝对路径的数据文件".into()); }
    let file = fs::File::open(path).map_err(|_| "无法读取数据文件")?;
    let mut bytes = Vec::new();
    file.take(256 * 1024 * 1024 + 1).read_to_end(&mut bytes).map_err(|_| "读取数据文件失败")?;
    if bytes.len() > 256 * 1024 * 1024 { return Err("数据文件超过 256 MB 上限".into()); }
    Ok(bytes)
}

fn fingerprint(bytes: &[u8]) -> String { format!("{:x}", Sha256::digest(bytes)) }

pub fn preview(payload: &ImportPayload, bytes: &[u8]) -> ImportPreview {
    ImportPreview {
        fingerprint: fingerprint(bytes), encrypted: payload.encrypted,
        accounts: payload.accounts.iter().map(|a| json!({"id":a.id,"label":a.label,"provider":a.provider,
            "hasCredentials":payload.credentials.iter().any(|c| c.account_id == a.id && serde_json::to_value(&c.blob).is_ok_and(|v|v != json!({})))})).collect(),
        settings: payload.settings.is_some(), catalog: payload.catalog.is_some() || payload.hidden.is_some(),
        catalog_count: payload.catalog.as_ref().map_or(0, Vec::len) + payload.hidden.as_ref().map_or(0, Vec::len),
        balance_history: payload.history.is_some(), history_count: payload.history.as_ref().map_or(0, |h|h.values().map(Vec::len).sum()),
        activity: payload.activity.is_some(), activity_count: payload.activity.as_ref().and_then(|a|a["events"].as_array()).map_or(0,Vec::len),
        credentials: payload.encrypted && !payload.credentials.is_empty(),
    }
}

pub fn merge_accounts(current: &AppConfig, payload: &ImportPayload, selection: &ImportSelection) -> Result<AppConfig, String> {
    let selected: HashSet<&str> = selection.account_ids.iter().map(String::as_str).collect();
    if selected.len() != selection.account_ids.len() || selected.iter().any(|id| !payload.accounts.iter().any(|a| a.id == *id)) {
        return Err("选择的账户不在此文件中".into());
    }
    let mut next = current.clone();
    for imported in payload.accounts.iter().filter(|a| selected.contains(a.id.as_str())) {
        if let Some(existing) = next.accounts.iter_mut().find(|a| a.id == imported.id) {
            if existing.provider != imported.provider { return Err("同 ID 账户的平台不同，已中止导入".into()); }
            let mut account = imported.clone();
            if !payload.encrypted {
                account.base_url = existing.base_url.clone(); account.recharge_url = existing.recharge_url.clone(); account.note = existing.note.clone();
                account.custom_url = existing.custom_url.clone(); account.custom_headers = existing.custom_headers.clone(); account.custom_body = existing.custom_body.clone();
                account.custom_json_path = existing.custom_json_path.clone(); account.custom_method = existing.custom_method.clone(); account.custom_currency = existing.custom_currency.clone();
            }
            *existing = account;
        } else { next.accounts.push(imported.clone()); }
    }
    if selection.settings { next.settings = payload.settings.clone().ok_or("文件不含设置")?; }
    Ok(next)
}

pub fn merge_history(current: &HashMap<String, Vec<HistoryPoint>>, imported: &HashMap<String, Vec<HistoryPoint>>, allowed: &HashSet<String>) -> HashMap<String, Vec<HistoryPoint>> {
    let mut next = current.clone();
    for (id, points) in imported.iter().filter(|(id, _)| allowed.contains(*id)) {
        let target = next.entry(id.clone()).or_default();
        let known: HashSet<(i64, u64)> = target.iter().map(|p| (p.t, p.v.to_bits())).collect();
        target.extend(points.iter().filter(|p| !known.contains(&(p.t, p.v.to_bits()))).copied());
        target.sort_by_key(|p| p.t);
        target.dedup_by(|a,b| a.t == b.t && a.v == b.v);
    }
    next
}

pub fn apply(state: &AppState, payload: ImportPayload, selection: ImportSelection) -> Result<String, String> {
    if selection.account_ids.is_empty() && !selection.settings && !selection.catalog && !selection.balance_history && !selection.activity {
        return Err("请至少选择一项导入内容".into());
    }
    if selection.credentials && (!payload.encrypted || selection.account_ids.is_empty()) { return Err("登录信息须与加密备份中的账户一起导入".into()); }
    if selection.activity && payload.activity.is_none() || selection.balance_history && payload.history.is_none()
        || selection.catalog && payload.catalog.is_none() && payload.hidden.is_none() { return Err("文件不包含选择的内容".into()); }
    state.store.ensure_core_files_writable()?;
    // Hold the same locks as normal writes so a background update cannot be lost.
    let mut config = state.config.lock().map_err(|_| "配置暂不可用")?;
    let mut catalog = state.overrides.lock().map_err(|_| "模型资料暂不可用")?;
    let mut hidden = state.hidden_models.lock().map_err(|_| "隐藏模型暂不可用")?;
    let mut history = state.history.lock().map_err(|_| "余额历史暂不可用")?;
    let _activity = state.activity_lock.lock().map_err(|_| "活动统计暂不可用")?;
    let next = merge_accounts(&config, &payload, &selection)?;
    let account_ids: HashSet<String> = next.accounts.iter().map(|a|a.id.clone()).collect();
    // With account selection, history follows those selected accounts. History-only imports
    // merge records for accounts already present and never create orphan histories.
    let history_ids = if selection.account_ids.is_empty() { account_ids } else { selection.account_ids.iter().cloned().collect() };
    let old_history = history.export_points();
    let next_history = if selection.balance_history { merge_history(&old_history, payload.history.as_ref().unwrap(), &history_ids) } else { old_history.clone() };
    let mut next_catalog = catalog.clone();
    let mut next_hidden = hidden.clone();
    if selection.catalog {
        for entry in payload.catalog.iter().flatten() {
            if let Some(existing) = next_catalog.iter_mut().find(|c| c.r#match == entry.r#match && c.providers == entry.providers) { *existing = entry.clone(); }
            else { next_catalog.push(entry.clone()); }
        }
        for id in payload.hidden.iter().flatten() { if !next_hidden.contains(id) { next_hidden.push(id.clone()); } }
    }
    let selected: HashSet<&str> = selection.account_ids.iter().map(String::as_str).collect();
    let credentials: Vec<&CredentialEntry> = if selection.credentials { payload.credentials.iter().filter(|c| selected.contains(c.account_id.as_str())).collect() } else { Vec::new() };
    let old_credentials: Vec<(String, SecretBlob)> = credentials.iter().map(|c| Ok((c.account_id.clone(), secrets::get_secrets(&c.account_id)?))).collect::<Result<_,String>>()?;
    let mut written_keys = 0;
    let mut wrote_config = false;
    let mut wrote_catalog = false;
    let mut wrote_hidden = false;
    let mut wrote_history = false;
    let result = (|| {
        for entry in &credentials { secrets::restore(&entry.account_id, &entry.blob)?; written_keys += 1; }
        if !selection.account_ids.is_empty() || selection.settings { state.store.save_config(&next)?; wrote_config = true; }
        if selection.catalog {
            state.store.save_overrides(&next_catalog)?; wrote_catalog = true;
            state.store.save_hidden_models(&next_hidden)?; wrote_hidden = true;
        }
        if selection.balance_history { history.replace_points(next_history)?; wrote_history = true; }
        if selection.activity { crate::activity::import_activity_data(state.store.dir(), payload.activity.as_ref().unwrap()) } else { Ok(0) }
    })();
    let events = match result {
        Ok(count) => count,
        Err(error) => {
            let mut rollback_failed = false;
            for (id, blob) in old_credentials.iter().take(written_keys) { rollback_failed |= secrets::restore(id, blob).is_err(); }
            if wrote_config { rollback_failed |= state.store.save_config(&config).is_err(); }
            if wrote_catalog { rollback_failed |= state.store.save_overrides(&catalog).is_err(); }
            if wrote_hidden { rollback_failed |= state.store.save_hidden_models(&hidden).is_err(); }
            if wrote_history { rollback_failed |= history.replace_points(old_history).is_err(); }
            return Err(if rollback_failed { "导入失败且部分回滚失败，请保留原迁移文件并重试".into() } else { format!("导入未完成，已还原本次写入：{error}") });
        }
    };
    *config = next; *catalog = next_catalog; *hidden = next_hidden;
    if let Ok(mut statuses) = state.statuses.lock() { for id in &selection.account_ids { statuses.remove(id); } }
    if let Ok(mut notifications) = state.low_notified.lock() { for id in &selection.account_ids { notifications.remove(id); } }
    Ok(format!("已导入 {} 个账户、{} 组登录信息、{events} 条活动更新；未选内容已保留", selection.account_ids.len(), credentials.len()))
}

#[tauri::command]
pub async fn preview_import(path: String, password: String) -> Result<ImportPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_file(&path)?;
        Ok(preview(&decode(&bytes, &password)?, &bytes))
    }).await.map_err(|_| "读取迁移文件失败")?
}

#[tauri::command]
pub async fn import_data(app: AppHandle, path: String, password: String, fingerprint: String, selection: ImportSelection) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = read_file(&path)?;
        if self::fingerprint(&bytes) != fingerprint { return Err("文件在预览后已变化，请重新选择文件".into()); }
        apply(&app.state::<AppState>(), decode(&bytes, &password)?, selection)
    }).await.map_err(|_| "导入任务中断，请重试")?
}
