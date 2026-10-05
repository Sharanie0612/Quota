//! AITier provides benchmarks only. Prices come exclusively from the original vendor.
use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};
use crate::{commands::AppState, model::ModelPrice};

const SOURCE: &str = "https://aitier.net/zh";
const TTL: i64 = 86400;

fn supported_vendor(vendor: &str) -> bool {
    matches!(vendor, "OpenAI" | "Anthropic" | "Google" | "DeepSeek" | "Kimi" | "Z AI" | "Xiaomi" | "Alibaba" | "SpaceXAI" | "Meta")
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ranking {
    pub rank: u32,
    pub score: f64,
    pub source: String,
    pub updated_at: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Candidate {
    pub prices: Vec<ModelPrice>,
    pub excerpts: Vec<String>,
    pub checked_at: String,
    pub error: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub provider: String,
    pub rankings: HashMap<String, Ranking>,
    pub price: ModelPrice,
    pub price_source: String,
    pub verified_at: Option<String>,
    pub candidate: Option<Candidate>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub updated_at: String,
    pub checked_at: Option<String>,
    pub source: String,
    pub entries: Vec<Entry>,
    pub error: Option<String>,
}

pub fn load(dir: &std::path::Path) -> Snapshot {
    let mut snapshot: Snapshot = std::fs::read(dir.join("ladder_cache.json")).ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_else(|| serde_json::from_str(include_str!("../data/ladder.json")).expect("valid embedded ladder"));
    let base:Snapshot=serde_json::from_str(include_str!("../data/ladder.json")).expect("valid ladder");
    for e in base.entries {if !snapshot.entries.iter().any(|v|v.id==e.id){snapshot.entries.push(e)}}
    snapshot.entries.retain(|e| supported_vendor(&e.vendor));
    snapshot
}

fn api_model_id(id: &str) -> String {
    let id = ["-non-reasoning","-xhigh","-high","-medium","-low","-max"].iter().find_map(|suffix|id.strip_suffix(suffix)).unwrap_or(id);
    match id {
        "deepseek-v4-1-flash" => "deepseek-flash".into(),
        "gpt-6-1-sol" => "gpt-6.1-sol".into(),
        "glm-5-3" => "glm-5.3".into(),
        "kimi-k3" => "kimi-k3".into(),
        "kimi-k2-6" | "kimi-k2-6-non-reasoning" => "kimi-k2.6".into(),
        "kimi-k2-7-code" => "kimi-k2.7-code".into(),
        _ => id.replace("-v2-6", "-v2.6"),
    }
}

pub fn with_overrides(mut snapshot: Snapshot, overrides: &[crate::model::CatalogEntry]) -> Snapshot {
    snapshot.entries.retain(|e| supported_vendor(&e.vendor));
    let embedded: Snapshot = serde_json::from_str(include_str!("../data/ladder.json")).expect("valid ladder");
    for e in &mut snapshot.entries {
        if let Some(base) = embedded.entries.iter().find(|b| b.id == e.id).filter(|b|e.verified_at.as_deref().unwrap_or("")<=b.verified_at.as_deref().unwrap_or("")) {
            e.price = base.price.clone(); e.verified_at = base.verified_at.clone();
            e.price_source = base.price_source.clone();
        }
        let api_id = api_model_id(&e.id);
        if let Some(local) = overrides.iter().rev().find(|o| o.r#match.contains(&api_id) && o.verified && o.source.as_deref() == Some(e.price_source.as_str())) {
            if local.verified_at.as_deref().unwrap_or("") > e.verified_at.as_deref().unwrap_or("") && !e.price.note.as_deref().unwrap_or("").starts_with("官方自动核实") { if let Some(price) = &local.price { e.price = price.clone(); e.verified_at = local.verified_at.clone(); } }
        }
    }
    snapshot
}

fn find_props(value: &Value) -> Option<&Value> {
    match value {
        Value::Object(m) if m.contains_key("initialRankings") => Some(value),
        Value::Object(m) => m.values().find_map(find_props),
        Value::Array(a) => a.iter().find_map(find_props),
        _ => None,
    }
}

fn flight_props(html: &str) -> Result<Value, String> {
    let mut stream = String::new();
    for chunk in html.split("self.__next_f.push(").skip(1) {
        let Some((json, _)) = chunk.split_once(")</script>") else { continue };
        if let Ok(v) = serde_json::from_str::<Value>(json) {
            if let Some(s) = v.get(1).and_then(Value::as_str) { stream.push_str(s); }
        }
    }
    // Flight text frames use T<hex byte length>,<text> without a trailing newline.
    // Skip their exact byte lengths before parsing the following JSON frame.
    let mut cursor = 0;
    while let Some(tail) = stream.get(cursor..) {
        if tail.is_empty() { break; }
        if tail.starts_with('\n') || tail.starts_with('\r') { cursor += 1; continue; }
        let Some(colon) = tail.find(':') else { break };
        if !tail[..colon].bytes().all(|b| b.is_ascii_hexdigit()) { break; }
        let body = &tail[colon + 1..];
        if let Some(text) = body.strip_prefix('T') {
            let Some(comma) = text.find(',') else { break };
            let Ok(length) = usize::from_str_radix(&text[..comma], 16) else { break };
            let Some(next) = cursor.checked_add(colon + 1 + 1 + comma + 1).and_then(|n| n.checked_add(length)) else { break };
            if next > stream.len() || !stream.is_char_boundary(next) { break; }
            cursor = next;
            continue;
        }
        let end = body.find('\n').unwrap_or(body.len());
        let json = &body[..end];
        cursor += colon + 1 + end + usize::from(end < body.len());
        let Ok(value) = serde_json::from_str::<Value>(json) else { continue };
        if let Some(props) = find_props(&value) { return Ok(props.clone()); }
    }
    Err("天梯暂时无法更新，继续显示上次数据".into())
}

pub fn parse_rankings(html: &str) -> Result<HashMap<String, HashMap<String, Ranking>>, String> {
    let props = flight_props(html)?;
    let mut result: HashMap<String, HashMap<String, Ranking>> = HashMap::new();
        let Some(rankings) = props.get("initialRankings").and_then(Value::as_array) else { return Err("天梯格式已变化".into()) };
        for r in rankings {
            let Some(id) = r.get("modelId").and_then(Value::as_str) else { continue };
            let Some(domain) = r.get("domain").and_then(Value::as_str) else { continue };
            let Some(score) = r.get("score").and_then(Value::as_f64).filter(|v| v.is_finite() && (0.0..=100.0).contains(v)) else { continue };
            let Some(rank) = r.get("rank").and_then(Value::as_u64).filter(|r| *r > 0 && *r <= u32::MAX as u64) else { continue };
            result.entry(id.into()).or_default().insert(domain.into(), Ranking {
                rank: rank as u32, score,
                source: r.get("source").and_then(Value::as_str).unwrap_or("AITier").into(),
                updated_at: r.get("updatedAt").and_then(Value::as_str).unwrap_or("").trim_start_matches("$D").into(),
            });
        }
    if result.is_empty() { return Err("天梯暂时无法更新，继续显示上次数据".into()); }
    Ok(result)
}

pub fn parse_models(html: &str) -> Result<Vec<Entry>, String> {
    let props=flight_props(html)?;
    let models=props.get("initialModels").and_then(Value::as_array).ok_or("天梯模型格式已变化")?;
    let base:Snapshot=serde_json::from_str(include_str!("../data/ladder.json")).map_err(|_| "内置天梯格式无效")?;
    let mut entries=std::collections::BTreeMap::new();
    for m in models {
        let Some(id)=m.get("id").and_then(Value::as_str) else {continue};
        let name=m.get("name").and_then(Value::as_str).unwrap_or(id);
        let vendor=m.get("provider").and_then(Value::as_str).unwrap_or("Unknown");
        if !supported_vendor(vendor) { continue; }
        if let Some(e)=base.entries.iter().find(|e|e.id==id) {entries.insert(id.to_string(),e.clone());continue}
        let template=base.entries.iter().find(|e|e.vendor==vendor&&!e.price_source.is_empty());
        entries.insert(id.to_string(), Entry{id:id.into(),name:name.into(),vendor:vendor.into(),provider:template.map(|e|e.provider.clone()).unwrap_or_else(||vendor.to_lowercase()),rankings:HashMap::new(),price:ModelPrice::default(),price_source:template.map(|e|e.price_source.clone()).unwrap_or_default(),verified_at:None,candidate:None});
    }
    Ok(entries.into_values().collect())
}

#[tauri::command]
pub fn get_ladder(state: State<'_, AppState>) -> Snapshot {
    let snapshot = state.ladder.lock().expect("ladder mutex").clone();
    with_overrides(snapshot, &state.overrides.lock().expect("catalog mutex"))
}

pub async fn update(state: &AppState, force: bool) -> Result<Snapshot, String> {
    let now = chrono::Utc::now();
    {
        let mut refreshing = state.ladder_refreshing.lock().map_err(|_| "天梯暂不可用")?;
        if *refreshing {
            let snapshot = state.ladder.lock().map_err(|_| "天梯暂不可用")?.clone();
            return Ok(with_overrides(snapshot, &state.overrides.lock().map_err(|_| "资料库暂不可用")?));
        }
        let current = state.ladder.lock().map_err(|_| "天梯暂不可用")?;
        if !force && current.checked_at.as_deref().and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .is_some_and(|t| now.timestamp() - t.timestamp() < if current.error.is_some() || current.entries.iter().any(|e|e.candidate.as_ref().and_then(|c|c.error.as_deref()).is_some_and(|s|!s.starts_with("官网未找到"))) {3600} else {TTL}) {
                return Ok(with_overrides(current.clone(), &state.overrides.lock().map_err(|_| "资料库暂不可用")?));
            }
        *refreshing = true;
    }
    let previous=state.ladder.lock().map_err(|_|"天梯暂不可用")?.clone();
    let ranking_result=async {
        let response=state.http.get(SOURCE).timeout(std::time::Duration::from_secs(25)).send().await.map_err(|_|"排名网络不可用，保留上次排名")?;
        if !response.status().is_success(){return Err("排名网站暂不可用".to_string())}
        if response.content_length().is_some_and(|n|n>12*1024*1024){return Err("排名数据超出读取范围".into())}
        let html=response.text().await.map_err(|_|"排名读取失败")?;
        if html.len()>12*1024*1024{return Err("排名数据超出读取范围".into())}
        Ok((parse_rankings(&html)?,parse_models(&html)?))
    }.await;
    // Price verification is independent of AITier availability.
    let official=crate::official_prices::fetch(&state.http).await;
    let (mut entries,error)=match ranking_result {
        Ok((rankings,mut entries))=>{for e in &mut entries {e.rankings=rankings.get(&e.id).cloned().unwrap_or_default();} (entries,None)},
        Err(e)=>(previous.entries.clone(),Some(e)),
    };
    for entry in &mut entries {
        if let Some(old)=previous.entries.iter().find(|e|e.id==entry.id&&e.verified_at.as_deref().unwrap_or("")>entry.verified_at.as_deref().unwrap_or("")){
            entry.price=old.price.clone();entry.price_source=old.price_source.clone();entry.verified_at=old.verified_at.clone();
        }
        if let Some(check)=official.get(&entry.vendor){
            entry.price_source=check.source.clone();
            let name=entry.name.split(" (").next().unwrap_or(&entry.name);
            let model=api_model_id(&entry.id);
            let found=check.prices.get(&crate::official_prices::key(&model)).or_else(||check.prices.get(&crate::official_prices::key(name)));
            let issue=if let Some(price)=found {entry.price=price.clone();entry.verified_at=Some(now.to_rfc3339());None}
                else{Some(check.error.clone().unwrap_or_else(||"官网未找到该精确型号可确认的标准 Token 价格；保留上次核实记录，自动重试".into()))};
            entry.candidate=Some(Candidate{prices:Vec::new(),excerpts:Vec::new(),checked_at:now.to_rfc3339(),error:issue});
        }
    }
    let mut snapshot=state.ladder.lock().map_err(|_|"天梯暂不可用")?;
    snapshot.entries=entries;snapshot.checked_at=Some(now.to_rfc3339());snapshot.error=error;
    if snapshot.error.is_none(){snapshot.updated_at=now.to_rfc3339();}
    let output = snapshot.clone();
    let saved = serde_json::to_string_pretty(&output).map_err(|_| "保存天梯失败".to_string())
        .and_then(|text| crate::storage::write_atomic(&state.store.dir().join("ladder_cache.json"), &text));
    drop(snapshot);
    *state.ladder_refreshing.lock().map_err(|_| "天梯暂不可用")? = false;
    saved?;
    Ok(with_overrides(output, &state.overrides.lock().map_err(|_| "资料库暂不可用")?))
}

#[tauri::command]
pub async fn refresh_ladder(state: State<'_, AppState>, force: bool) -> Result<Snapshot, String> {
    update(&state, force).await
}

#[tauri::command]
pub async fn check_ladder_price(state: State<'_, AppState>, id: String) -> Result<Candidate, String> {
    let entry = state.ladder.lock().map_err(|_| "天梯暂不可用")?.entries.iter().find(|e| e.id == id).cloned().ok_or("模型不存在")?;
    if let Some(check) = &entry.candidate {
        if check.error.is_none() && chrono::DateTime::parse_from_rfc3339(&check.checked_at).ok()
            .is_some_and(|t| chrono::Utc::now().timestamp() - t.timestamp() < TTL) { return Ok(check.clone()); }
    }
    let hints = vec![api_model_id(&entry.id), entry.name.split(" (").next().unwrap_or(&entry.name).to_string()];
    let scan = crate::pricing::scan_pricing_page(&state.http, &entry.price_source, &hints).await;
    Ok(Candidate { prices: scan.candidates, excerpts: scan.excerpts, checked_at: scan.fetched_at, error: scan.error })
}

#[tauri::command]
pub fn adopt_ladder_price(state: State<'_, AppState>, id: String, input: f64, output: f64, currency: String, cached_input: Option<f64>, cache_write: Option<f64>, cache_write_long: Option<f64>) -> Result<(), String> {
    if [cached_input, cache_write, cache_write_long].into_iter().flatten().any(|v| !v.is_finite() || v < 0.0) || !input.is_finite() || !output.is_finite() || input < 0.0 || output < 0.0 || !matches!(currency.as_str(), "CNY" | "USD") {
        return Err("请填写有效价格与币种".into());
    }
    let mut snapshot = state.ladder.lock().map_err(|_| "天梯暂不可用")?;
    let mut next = snapshot.clone();
    let entry = next.entries.iter_mut().find(|e| e.id == id).ok_or("模型不存在")?;
    if entry.price_source.is_empty() { return Err("请先补充已核实的原厂定价来源".into()); }
    entry.price = ModelPrice { currency, unit: "每百万 tokens".into(), input: Some(input), output: Some(output), note: Some("标准档；本机核实".into()), cached_input, cache_write, cache_write_long };
    entry.verified_at = Some(chrono::Utc::now().to_rfc3339());
    let api_id = api_model_id(&entry.id);
    let mut overrides = state.overrides.lock().map_err(|_| "资料库暂不可用")?;
    let mut next_overrides = overrides.clone();
    let mut catalog_entry = next_overrides.iter().find(|o| o.r#match.contains(&api_id)).cloned()
        .or_else(|| state.catalog.iter().find(|o| o.r#match.contains(&api_id)).cloned()).unwrap_or_default();
    if !catalog_entry.r#match.contains(&api_id) { catalog_entry.r#match.push(api_id.clone()); }
    catalog_entry.name = entry.name.split(" (").next().unwrap_or(&entry.name).into();
    catalog_entry.vendor = entry.vendor.clone(); catalog_entry.providers = vec![entry.provider.clone()];
    catalog_entry.price = Some(entry.price.clone()); catalog_entry.verified = true;
    catalog_entry.verified_at = entry.verified_at.clone(); catalog_entry.source = Some(entry.price_source.clone()); catalog_entry.edited = true;
    next_overrides.retain(|o| !o.r#match.contains(&api_id)); next_overrides.push(catalog_entry);
    state.store.save_overrides(&next_overrides)?;
    *overrides = next_overrides;
    *snapshot = next;
    Ok(())
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(15)).await;
        loop {
            let enabled = app.state::<AppState>().config.lock().map(|c| c.settings.ladder_auto_update).unwrap_or(false);
            if enabled { let _ = update(&app.state::<AppState>(), false).await; }
            tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        }
    });
}
