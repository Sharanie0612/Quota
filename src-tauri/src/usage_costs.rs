//! Billing references are exact model aliases, never fuzzy catalogue matches.
use crate::{commands::AppState, model::ModelPrice};
use serde::{Serialize, Deserialize};
use std::{collections::BTreeMap, path::Path};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reference { aliases: Vec<String>, price: ModelPrice, source: String, verified_at: String }

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rate {
    pub currency: String, pub input: Option<f64>, pub cached_input: Option<f64>,
    pub cache_write: Option<f64>, pub output: Option<f64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scope { pub device: String, pub source: String, pub from: String, pub to: String }
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bill { pub amount: f64, pub currency: String }
#[derive(Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct UsageSettings { pub rates: BTreeMap<String, Rate>, pub bills: BTreeMap<String, Bill> }
pub fn load_settings(dir: &Path) -> Result<UsageSettings, String> {
    let path = dir.join("usage-prices.json");
    if !path.exists() { return Ok(UsageSettings::default()); }
    let bytes = std::fs::read(path).map_err(|_| "读取使用单价失败")?;
    serde_json::from_slice(&bytes).map_err(|_| "使用单价文件损坏，已保留原文件".into())
}
pub fn save_calculation(dir: &Path, model: String, rate: Option<Rate>, scope: Scope, bill: Option<Bill>) -> Result<(), String> {
    validate_scope(&scope)?;
    if model.is_empty() || model.len() > 640 || model.chars().any(char::is_control) { return Err("型号无效".into()); }
    if let Some(value) = &rate {
        if !matches!(value.currency.as_str(), "CNY" | "USD") || [&value.input, &value.cached_input, &value.cache_write, &value.output]
            .iter().any(|n| n.is_some_and(|v| !v.is_finite() || !(0.0..=1_000_000_000.0).contains(&v))) {
            return Err("单价须为有限非负数，币种须为 CNY 或 USD".into());
        }
    }
    if bill.as_ref().is_some_and(|b| !b.amount.is_finite() || !(0.0..=1_000_000_000.0).contains(&b.amount) || !matches!(b.currency.as_str(), "CNY" | "USD")) { return Err("账单金额或币种无效".into()); }
    let mut settings = load_settings(dir)?;
    let key = bill_key(&scope, &model);
    if let Some(rate) = rate { settings.rates.insert(model, rate); } else { settings.rates.remove(&model); }
    if let Some(bill) = bill { settings.bills.insert(key, bill); } else { settings.bills.remove(&key); }
    crate::storage::write_atomic(&dir.join("usage-prices.json"), &serde_json::to_string_pretty(&settings).map_err(|_| "编码使用价格失败")?)
}
fn bill_key(scope: &Scope, model: &str) -> String { serde_json::json!([scope.device,scope.source,scope.from,scope.to,model]).to_string() }
fn validate_scope(scope: &Scope) -> Result<(), String> {
    let from = chrono::NaiveDate::parse_from_str(&scope.from,"%Y-%m-%d").map_err(|_| "账单日期无效")?;
    let to = chrono::NaiveDate::parse_from_str(&scope.to,"%Y-%m-%d").map_err(|_| "账单日期无效")?;
    if from > to || !matches!(scope.source.as_str(), "" | "codex" | "zcode" | "harness" | "trae") || (!scope.device.is_empty() && uuid::Uuid::parse_str(&scope.device).is_err()) { return Err("账单范围无效".into()); }
    Ok(())
}
pub fn bills_for(dir: &Path, scope: &Scope) -> Result<BTreeMap<String, Bill>, String> {
    validate_scope(scope)?;
    let mut result = BTreeMap::new();
    for (key,bill) in load_settings(dir)?.bills {
        if let Ok(parts) = serde_json::from_str::<Vec<String>>(&key) {
            if parts.len() == 5 && parts[..4] == [scope.device.clone(),scope.source.clone(),scope.from.clone(),scope.to.clone()] { result.insert(parts[4].clone(),bill); }
        }
    }
    Ok(result)
}
#[tauri::command]
pub fn get_usage_prices(app: AppHandle) -> Result<(Vec<Reference>, BTreeMap<String, Rate>), String> {
    let state = app.state::<AppState>();
    let mut result = Vec::new();
    let overrides = state.overrides.lock().map_err(|_| "读取价格资料失败")?;
    for entry in state.catalog.iter().chain(overrides.iter()) {
        if let (true, Some(price), Some(source), Some(at)) = (entry.verified, &entry.price, &entry.source, &entry.verified_at) {
            if source.starts_with("https://") { result.push(Reference { aliases: entry.r#match.clone(), price: price.clone(), source: source.clone(), verified_at: at.clone() }); }
        }
    }
    drop(overrides);
    let snapshot = state.ladder.lock().map_err(|_| "读取天梯价格失败")?;
    for entry in &snapshot.entries {
        if let Some(at) = &entry.verified_at {
            if entry.price_source.starts_with("https://") {
                result.push(Reference { aliases: vec![entry.id.clone(), crate::ladder::api_model_id(&entry.id)], price: entry.price.clone(), source: entry.price_source.clone(), verified_at: at.clone() });
            }
        }
    }
    Ok((result, load_settings(state.store.dir())?.rates))
}
#[tauri::command]
pub fn save_usage_calculation(app: AppHandle, model: String, rate: Option<Rate>, scope: Scope, bill: Option<Bill>) -> Result<(), String> {
    let state = app.state::<AppState>();
    let _guard = state.activity_lock.lock().map_err(|_| "统计暂不可用")?;
    save_calculation(state.store.dir(), model, rate, scope, bill)
}
#[tauri::command]
pub fn get_usage_bills(app: AppHandle, scope: Scope) -> Result<BTreeMap<String, Bill>, String> { bills_for(app.state::<AppState>().store.dir(), &scope) }
