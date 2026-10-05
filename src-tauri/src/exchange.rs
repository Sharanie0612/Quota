//! Public reference FX only; never changes official model prices.
use serde::{Deserialize, Serialize};
use tauri::State;
use crate::commands::AppState;
const SOURCE: &str = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExchangeRate {
    pub cny_per_usd: f64,
    pub date: String,
    pub checked_at: String,
    pub source: String,
    pub error: Option<String>,
}
fn attribute(tag: &str, name: &str) -> Option<String> {
    for quote in ['\'', '"'] {
        let prefix = format!("{name}={quote}");
        if let Some(tail) = tag.split_once(&prefix).map(|(_, tail)| tail) {
            return Some(tail.split(quote).next()?.to_string());
        }
    }
    None
}
pub fn parse_reference(xml: &str) -> Result<(f64, String), String> {
    let mut usd = None; let mut cny = None; let mut date = None;
    for tag in xml.split('<').filter_map(|tail| tail.split_once('>').map(|(tag, _)| tag)) {
        if let Some(value) = attribute(tag, "time") { date = Some(value); }
        if let Some(currency) = attribute(tag, "currency") {
            let rate = attribute(tag, "rate").and_then(|rate| rate.parse::<f64>().ok()).filter(|rate| rate.is_finite() && *rate > 0.0);
            match currency.as_str() { "USD" => usd = rate, "CNY" => cny = rate, _ => {} }
        }
    }
    let rate = cny.ok_or("汇率来源未返回 CNY")? / usd.ok_or("汇率来源未返回 USD")?;
    let date = date.filter(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok()).ok_or("汇率日期无效")?;
    if !rate.is_finite() || rate <= 0.0 { return Err("汇率无效".into()); }
    Ok((rate, date))
}
#[tauri::command]
pub async fn get_exchange_rate(state: State<'_, AppState>) -> Result<ExchangeRate, String> {
    let path = state.store.dir().join("exchange_rate.json");
    let cached: Option<ExchangeRate> = std::fs::read(&path).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .filter(|rate: &ExchangeRate| rate.source == SOURCE && rate.cny_per_usd.is_finite() && rate.cny_per_usd > 0.0);
    if let Some(rate) = &cached {
        if chrono::DateTime::parse_from_rfc3339(&rate.checked_at).is_ok_and(|checked| {
            let age = chrono::Utc::now().timestamp() - checked.timestamp(); (0..86400).contains(&age)
        }) { return Ok(rate.clone()); }
    }
    let fetched = async {
        let response = state.http.get(SOURCE).send().await.map_err(|_| "汇率同步失败".to_string())?
            .error_for_status().map_err(|_| "汇率来源暂不可用".to_string())?;
        let xml = response.text().await.map_err(|_| "汇率读取失败".to_string())?;
        if xml.len() > 262144 { return Err("汇率响应过大".into()); }
        let (cny_per_usd, date) = parse_reference(&xml)?;
        let rate = ExchangeRate { cny_per_usd, date, checked_at: chrono::Utc::now().to_rfc3339(), source: SOURCE.into(), error: None };
        let text = serde_json::to_string(&rate).map_err(|_| "汇率保存失败".to_string())?;
        crate::storage::write_atomic(&path, &text)?;
        Ok::<_, String>(rate)
    }.await;
    match fetched { Ok(rate) => Ok(rate), Err(error) => match cached {
        Some(mut rate) => { rate.error = Some(format!("{error}，暂用上次参考汇率")); Ok(rate) }, None => Err(error),
    } }
}
