//! Monthly display references. Freeze the previous month's final ECB quote;
//! never silently replace a saved month or change original spending currencies.
use crate::commands::AppState;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};
use tauri::State;
pub const SOURCE: &str = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist.xml";
const LIMIT: usize = 16 * 1024 * 1024;
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MonthlyRate {
    pub month: String,
    pub cny_per_usd: f64,
    pub date: String,
    pub source: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rates {
    pub rates: Vec<MonthlyRate>,
    pub error: Option<String>,
}
fn month(s: &str) -> Result<chrono::NaiveDate, String> {
    let d = chrono::NaiveDate::parse_from_str(&format!("{s}-01"), "%Y-%m-%d")
        .map_err(|_| "月份无效")?;
    if d.format("%Y-%m").to_string() != s {
        return Err("月份无效".into());
    }
    Ok(d)
}
pub(crate) fn valid(r: &MonthlyRate) -> bool {
    month(&r.month).is_ok()
        && r.cny_per_usd.is_finite()
        && (0.01..=100.0).contains(&r.cny_per_usd)
        && (r.source == SOURCE || r.source == "manual")
        && chrono::NaiveDate::parse_from_str(&r.date, "%Y-%m-%d").is_ok()
}
pub(crate) fn load(dir: &Path) -> Result<BTreeMap<String, MonthlyRate>, String> {
    match std::fs::read(dir.join("monthly-usage-fx.json")) {
        Ok(b) => {
            if b.len() > 1024 * 1024 {
                return Err("月度汇率文件过大，原文件已保留".into());
            }
            let rows: BTreeMap<String, MonthlyRate> =
                serde_json::from_slice(&b).map_err(|_| "月度汇率文件损坏，原文件已保留")?;
            if rows.iter().any(|(k, r)| k != &r.month || !valid(r)) {
                return Err("月度汇率资料无效，原文件已保留".into());
            }
            Ok(rows)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(_) => Err("读取月度汇率失败".into()),
    }
}
pub(crate) fn save(dir: &Path, rows: &BTreeMap<String, MonthlyRate>) -> Result<(), String> {
    crate::storage::write_atomic(
        &dir.join("monthly-usage-fx.json"),
        &serde_json::to_string(rows).map_err(|_| "编码月度汇率失败")?,
    )
}
fn attr(tag: &str, name: &str) -> Option<String> {
    for q in ['\'', '"'] {
        if let Some((_, tail)) = tag.split_once(&format!("{name}={q}")) {
            return Some(tail.split(q).next()?.into());
        }
    }
    None
}
pub fn parse_history(xml: &str) -> Result<BTreeMap<chrono::NaiveDate, f64>, String> {
    if xml.len() > LIMIT {
        return Err("汇率响应过大".into());
    }
    let mut rows = BTreeMap::new();
    let mut day = None;
    let mut usd = None;
    let mut cny = None;
    for tag in xml
        .split('<')
        .filter_map(|s| s.split_once('>').map(|(t, _)| t))
    {
        if let Some(t) = attr(tag, "time") {
            day = chrono::NaiveDate::parse_from_str(&t, "%Y-%m-%d").ok();
            usd = None;
            cny = None;
        }
        if let Some(currency) = attr(tag, "currency") {
            let n = attr(tag, "rate")
                .and_then(|s| s.parse::<f64>().ok())
                .filter(|n| n.is_finite() && *n > 0.0);
            match currency.as_str() {
                "USD" => usd = n,
                "CNY" => cny = n,
                _ => {}
            }
            if let (Some(d), Some(u), Some(c)) = (day, usd, cny) {
                let n = c / u;
                if (0.01..=100.0).contains(&n) {
                    rows.insert(d, n);
                }
            }
        }
    }
    if rows.is_empty() {
        return Err("官方汇率表未提供可用 USD/CNY".into());
    }
    Ok(rows)
}
pub fn reference(
    history: &BTreeMap<chrono::NaiveDate, f64>,
    value: &str,
) -> Result<Option<MonthlyRate>, String> {
    let first = month(value)?;
    let min = first
        .checked_sub_days(chrono::Days::new(14))
        .ok_or("月份无效")?;
    Ok(history
        .range(min..first)
        .next_back()
        .map(|(d, n)| MonthlyRate {
            month: value.into(),
            cny_per_usd: *n,
            date: d.to_string(),
            source: SOURCE.into(),
        }))
}
pub fn save_manual(dir: &Path, value: &str, rate: Option<f64>) -> Result<(), String> {
    month(value)?;
    let mut rows = load(dir)?;
    if let Some(n) = rate {
        let r = MonthlyRate {
            month: value.into(),
            cny_per_usd: n,
            date: chrono::Local::now().date_naive().to_string(),
            source: "manual".into(),
        };
        if !valid(&r) {
            return Err("汇率需在 0.01–100 之间".into());
        }
        rows.insert(value.into(), r);
    } else {
        rows.remove(value);
    }
    save(dir, &rows)
}
#[tauri::command]
pub async fn get_monthly_usage_fx(
    state: State<'_, AppState>,
    months: Vec<String>,
) -> Result<Rates, String> {
    if months.len() > 600 {
        return Err("一次最多查看 600 个月的汇率".into());
    }
    for m in &months {
        month(m)?;
    }
    let existing = {
        let _guard = state.billing_lock.lock().map_err(|_| "汇率记录忙碌")?;
        load(state.store.dir())?
    };
    let today = chrono::Local::now().date_naive();
    let needed: Vec<_> = months
        .iter()
        .filter(|m| !existing.contains_key(*m) && month(m).is_ok_and(|d| d <= today))
        .collect();
    let fetched = if needed.is_empty() {
        Ok(BTreeMap::new())
    } else {
        async {
            let mut response = state
                .http
                .get(SOURCE)
                .send()
                .await
                .map_err(|_| "月度汇率暂时无法获取，可手动填写")?
                .error_for_status()
                .map_err(|_| "官方汇率来源暂不可用")?;
            if response.content_length().is_some_and(|n| n > LIMIT as u64) {
                return Err("汇率响应过大".to_string());
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|_| "读取官方汇率失败")?
            {
                if bytes.len() + chunk.len() > LIMIT {
                    return Err("汇率响应过大".into());
                }
                bytes.extend_from_slice(&chunk)
            }
            parse_history(std::str::from_utf8(&bytes).map_err(|_| "官方汇率编码无效")?)
        }
        .await
    };
    let _guard = state.billing_lock.lock().map_err(|_| "汇率记录忙碌")?;
    let mut saved = load(state.store.dir())?;
    let error = match fetched {
        Ok(history) => {
            let mut changed = false;
            for m in needed {
                if !saved.contains_key(m) {
                    if let Some(r) = reference(&history, m)? {
                        saved.insert(m.clone(), r);
                        changed = true;
                    }
                }
            }
            if changed {
                save(state.store.dir(), &saved)?;
            }
            None
        }
        Err(e) => Some(e),
    };
    Ok(Rates {
        rates: months
            .iter()
            .filter_map(|m| saved.get(m).cloned())
            .collect(),
        error,
    })
}
#[tauri::command]
pub fn save_monthly_usage_fx(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    month: String,
    rate: Option<f64>,
) -> Result<(), String> {
    let _guard = state.billing_lock.lock().map_err(|_| "汇率记录忙碌")?;
    save_manual(state.store.dir(), &month, rate)?;
    drop(_guard);
    crate::usage_sync::queue(app);
    Ok(())
}
