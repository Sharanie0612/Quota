//! Quota's model registry. Official identities/prices are primary; benchmarks are
//! optional adapters and never determine which models can be discovered or priced.
use crate::{
    commands::AppState,
    model::{CatalogEntry, ModelPrice},
    official_prices::{self, CacheWrite, Check, PriceOption},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    path::Path,
};
use tauri::{Emitter, State};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    #[serde(default)]
    pub available: bool,
    pub id: String,
    pub api_id: String,
    pub name: String,
    pub vendor: String,
    pub provider: String,
    pub summary: String,
    pub context: Option<i64>,
    pub max_output: Option<i64>,
    pub abilities: Vec<String>,
    pub price: Option<ModelPrice>,
    pub source: String,
    pub verified_at: Option<String>,
    #[serde(default)]
    pub price_options: Vec<PriceOption>,
    #[serde(default)]
    pub cache_writes: Vec<CacheWrite>,
    pub first_seen: String,
    pub issue: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub vendor: String,
    pub url: String,
    pub checked_at: String,
    pub models: usize,
    pub error: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema: u32,
    pub checked_at: Option<String>,
    pub models: Vec<Model>,
    pub sources: Vec<Source>,
}
pub fn provider(vendor: &str) -> &'static str {
    match vendor {
        "OpenAI" => "custom",
        "Anthropic" => "anthropic",
        "Google" => "google",
        "DeepSeek" => "deepseek",
        "Kimi" | "Moonshot" => "moonshot",
        "Z AI" | "Zhipu" | "智谱" => "zhipu",
        "Xiaomi" | "小米" => "mimo",
        "Alibaba" | "阿里云" => "aliyun",
        "SpaceXAI" | "xAI" => "xai",
        "Meta" => "meta",
        _ => "unknown",
    }
}
fn vendor_for(entry: &CatalogEntry) -> Option<&'static str> {
    // Compatible resale channels do not establish the original vendor.
    let vendors = || official_prices::SOURCES.iter().map(|(vendor, _)| *vendor);
    vendors()
        .find(|vendor| entry.vendor == *vendor)
        .or_else(|| {
            let primary = entry.providers.first()?;
            if primary == "custom" {
                return None;
            }
            vendors().find(|vendor| primary == provider(vendor))
        })
}
fn id(vendor: &str, api_id: &str) -> String {
    format!("{}:{api_id}", provider(vendor))
}
fn priced(price: &Option<ModelPrice>) -> bool {
    price.as_ref().is_some_and(|p| {
        p.input.is_some_and(|n| n.is_finite() && n >= 0.)
            && p.output.is_some_and(|n| n.is_finite() && n >= 0.)
    })
}
fn seed_catalog(snapshot: &mut Snapshot) {
    for entry in crate::catalog::embedded_file()
        .entries
        .into_iter()
        .filter(|entry| !entry.hidden)
    {
        let Some(vendor) = vendor_for(&entry) else {
            continue;
        };
        let Some(api_id) = entry.r#match.first() else {
            continue;
        };
        let api_id = official_prices::api_id(vendor, api_id);
        let model_id = id(vendor, &api_id);
        if snapshot.models.iter().any(|model| model.id == model_id) {
            continue;
        }
        let verified = entry.verified
            && priced(&entry.price)
            && entry
                .source
                .as_ref()
                .is_some_and(|s| s.starts_with("https://"));
        snapshot.models.push(Model {
            available: false,
            id: model_id,
            api_id,
            name: entry.name,
            vendor: vendor.into(),
            provider: provider(vendor).into(),
            summary: entry.summary,
            context: entry.context,
            max_output: entry.max_output,
            abilities: entry.abilities,
            price: if verified { entry.price } else { None },
            source: entry.source.unwrap_or_default(),
            verified_at: if verified { entry.verified_at } else { None },
            price_options: vec![],
            cache_writes: vec![],
            first_seen: "内置资料".into(),
            issue: if verified {
                None
            } else {
                Some("官网当前未收录可比较的标准 Token 价格".into())
            },
        });
    }
}
pub fn load(dir: &Path) -> Snapshot {
    let base: Snapshot = serde_json::from_str(include_str!("../data/ai-models.json"))
        .expect("valid AI model registry");
    let mut value = std::fs::read(dir.join("ai-models.json"))
        .ok()
        .filter(|b| b.len() <= 8 * 1024 * 1024)
        .and_then(|bytes| serde_json::from_slice::<Snapshot>(&bytes).ok())
        .filter(|v| v.schema == 1 && v.models.len() <= 5000 && v.sources.len() <= 32)
        .unwrap_or_else(|| base.clone());
    for model in base.models {
        if let Some(old) = value.models.iter_mut().find(|m| m.id == model.id) {
            if model.verified_at > old.verified_at {
                *old = model;
            }
        } else {
            value.models.push(model);
        }
    }
    let mut identities: BTreeMap<String, Model> = BTreeMap::new();
    for mut model in value.models {
        model.api_id = official_prices::api_id(&model.vendor, &model.api_id);
        model.id = id(&model.vendor, &model.api_id);
        match identities.get_mut(&model.id) {
            Some(old) if old.verified_at >= model.verified_at => {}
            Some(old) => *old = model,
            None => {
                identities.insert(model.id.clone(), model);
            }
        }
    }
    value.models = identities.into_values().collect();
    seed_catalog(&mut value);
    value
}
pub fn merge(previous: Snapshot, checks: &HashMap<String, Check>, at: &str) -> Snapshot {
    let mut models: BTreeMap<_, _> = previous
        .models
        .into_iter()
        .map(|m| (m.id.clone(), m))
        .collect();
    let catalog = crate::catalog::embedded_file();
    let mut sources = Vec::new();
    for &(vendor, url) in official_prices::SOURCES {
        let Some(check) = checks.get(vendor) else {
            let error = "官网读取未完成，请稍后重试".to_string();
            sources.push(Source {
                vendor: vendor.into(),
                url: url.trim_end_matches(".md").into(),
                checked_at: at.into(),
                models: 0,
                error: Some(error.clone()),
            });
            for model in models.values_mut().filter(|model| model.vendor == vendor) {
                model.issue = Some(error.clone());
            }
            continue;
        };
        sources.push(Source {
            vendor: vendor.into(),
            url: url.trim_end_matches(".md").into(),
            checked_at: at.into(),
            models: check.prices.len(),
            error: check.error.clone(),
        });
        for model in models.values_mut().filter(|m| m.vendor == vendor) {
            if check.error.is_none() {
                model.available = check
                    .prices
                    .contains_key(&official_prices::key(&model.api_id));
            }
            model.issue = check.error.clone().or_else(|| {
                if check
                    .prices
                    .contains_key(&official_prices::key(&model.api_id))
                {
                    None
                } else {
                    Some("本次官网未列出此精确型号，保留上次记录".into())
                }
            });
        }
        for (key, price) in &check.prices {
            let Some(api_id) = check.model_ids.get(key) else {
                continue;
            };
            let model_id = id(vendor, api_id);
            let old = models
                .values()
                .find(|model| model.vendor == vendor && official_prices::key(&model.api_id) == *key)
                .map(|model| model.id.clone());
            if let Some(old) = old.filter(|old| old != &model_id) {
                if let Some(mut model) = models.remove(&old) {
                    model.id = model_id.clone();
                    model.api_id = api_id.clone();
                    models.insert(model_id.clone(), model);
                }
            }
            let metadata = catalog.entries.iter().find(|entry| {
                entry.r#match.iter().any(|alias| {
                    official_prices::api_id(vendor, alias).eq_ignore_ascii_case(api_id)
                })
            });
            let model = models.entry(model_id.clone()).or_insert_with(|| Model {
                available: true,
                id: model_id,
                api_id: api_id.clone(),
                name: metadata
                    .map(|m| m.name.clone())
                    .unwrap_or_else(|| api_id.clone()),
                vendor: vendor.into(),
                provider: provider(vendor).into(),
                summary: metadata.map(|m| m.summary.clone()).unwrap_or_default(),
                context: metadata.and_then(|m| m.context),
                max_output: metadata.and_then(|m| m.max_output),
                abilities: metadata.map(|m| m.abilities.clone()).unwrap_or_default(),
                price: None,
                source: check.source.clone(),
                verified_at: None,
                price_options: vec![],
                cache_writes: vec![],
                first_seen: at.into(),
                issue: None,
            });
            model.price = Some(price.clone());
            model.available = true;
            model.source = check.source.clone();
            model.verified_at = Some(at.into());
            model.issue = None;
            model.price_options = check.options.get(key).cloned().unwrap_or_default();
            model.cache_writes = check.cache_writes.get(key).cloned().unwrap_or_default();
        }
    }
    Snapshot {
        schema: 1,
        checked_at: Some(at.into()),
        models: models.into_values().collect(),
        sources,
    }
}
/// A packaged, verified quote is useful immediately, even before the next daily
/// network check. Benchmark identity adapters never create a new API SKU.
pub fn apply_to_ladder(snapshot: &mut crate::ladder::Snapshot, registry: &Snapshot) {
    for entry in &mut snapshot.entries {
        let names = [
            entry.id.clone(),
            crate::ladder::api_model_id(&entry.id),
            entry
                .name
                .split(" (")
                .next()
                .unwrap_or(&entry.name)
                .to_string(),
        ];
        let found = names.iter().find_map(|name| {
            registry.models.iter().find(|model| {
                model.vendor == entry.vendor
                    && official_prices::key(&model.api_id) == official_prices::key(name)
                    && priced(&model.price)
                    && model.verified_at.is_some()
            })
        });
        if let Some(model) = found.filter(|model| model.verified_at >= entry.verified_at) {
            entry.price = model.price.clone().expect("priced quote");
            entry.price_source = model.source.clone();
            entry.verified_at = model.verified_at.clone();
            entry.price_options = model.price_options.clone();
            entry.off_peak = model
                .price_options
                .iter()
                .find(|option| option.id == "off-peak")
                .map(|option| option.price.clone());
            entry.candidate = Some(crate::ladder::Candidate {
                prices: vec![],
                excerpts: vec![],
                checked_at: registry.checked_at.clone().unwrap_or_default(),
                error: model.issue.clone(),
            });
        }
    }
}
pub(crate) fn ingest(
    state: &AppState,
    checks: &HashMap<String, Check>,
) -> Result<Snapshot, String> {
    let mut current = state.ai_models.lock().map_err(|_| "AI 模型资料暂不可用")?;
    let next = merge(current.clone(), checks, &chrono::Utc::now().to_rfc3339());
    crate::storage::write_atomic(
        &state.store.dir().join("ai-models.json"),
        &serde_json::to_string_pretty(&next).map_err(|_| "编码 AI 模型资料失败")?,
    )?;
    *current = next.clone();
    Ok(next)
}
pub fn catalog_entries(state: &AppState) -> Vec<CatalogEntry> {
    let mut entries = state.catalog.clone();
    if let Ok(registry) = state.ai_models.lock() {
        for model in &registry.models {
            if model.verified_at.is_none() || !priced(&model.price) {
                continue;
            }
            let incoming = CatalogEntry {
                r#match: vec![model.api_id.clone()],
                name: model.name.clone(),
                vendor: model.vendor.clone(),
                providers: vec![model.provider.clone()],
                summary: model.summary.clone(),
                context: model.context,
                max_output: model.max_output,
                price: model.price.clone(),
                abilities: model.abilities.clone(),
                verified: true,
                verified_at: model.verified_at.clone(),
                source: Some(model.source.clone()),
                edited: false,
                hidden: false,
            };
            // Explicit aliases only; preserve descriptive metadata while updating its quote.
            if let Some(old) = entries.iter_mut().find(|entry| {
                entry
                    .r#match
                    .iter()
                    .any(|alias| alias.eq_ignore_ascii_case(&model.api_id))
            }) {
                if incoming.verified_at >= old.verified_at {
                    old.price = incoming.price;
                    old.source = incoming.source;
                    old.verified = true;
                    old.verified_at = incoming.verified_at;
                }
            } else {
                entries.push(incoming);
            }
        }
    }
    entries
}
#[tauri::command]
pub fn get_ai_models(state: State<'_, AppState>) -> Snapshot {
    state.ai_models.lock().expect("model registry").clone()
}
pub async fn refresh(state: &AppState, force: bool) -> Result<Snapshot, String> {
    {
        let current = state.ai_models.lock().map_err(|_| "AI 模型资料暂不可用")?;
        let ttl = if current.sources.len() != official_prices::SOURCES.len()
            || current.sources.iter().any(|s| s.error.is_some())
        {
            3600
        } else {
            86400
        };
        if !force
            && current
                .checked_at
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .is_some_and(|t| {
                    (0..ttl).contains(&(chrono::Utc::now().timestamp() - t.timestamp()))
                })
        {
            return Ok(current.clone());
        }
    }
    let Ok(_refreshing) = state.ai_models_refreshing.try_lock() else {
        return Ok(state.ai_models.lock().map_err(|_| "模型暂不可用")?.clone());
    };
    let checks = official_prices::fetch(&state.http).await;
    let result = ingest(state, &checks).and_then(|snapshot| {
        crate::ladder::apply_official(state, &checks)?;
        Ok(snapshot)
    });
    result
}
#[tauri::command]
pub async fn refresh_ai_models(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    force: bool,
) -> Result<Snapshot, String> {
    let result = refresh(&state, force).await?;
    let _ = app.emit("ai-models-updated", ());
    Ok(result)
}
