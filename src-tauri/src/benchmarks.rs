//! Source-native benchmark scores, complete configurations and rank consensus.
//! No inference is run and no account credentials are used by this module.
mod adapters;
mod scoring;
pub(crate) mod smoke;
use crate::commands::AppState;
pub use adapters::{parse_aa, parse_livebench};
pub use scoring::calculate;
use serde::{Deserialize, Serialize};
pub use smoke::smoke_if_requested;
use std::{collections::BTreeMap, path::Path, sync::Mutex};
use tauri::{Emitter, Manager, State};

pub const ALGORITHM: &str = "publisher-benchmarks/2.0";
pub const AREAS: [&str; 6] = [
    "reasoning",
    "coding",
    "knowledge",
    "research",
    "agents",
    "visual",
];
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Observation {
    #[serde(default)]
    pub profile_id: String,
    pub model_id: String,
    pub model_name: String,
    pub vendor: String,
    pub source_id: String,
    pub metric: String,
    pub family: String,
    pub version: String,
    pub domain: String,
    pub setting: String,
    pub value: f64,
    pub unit: String,
    pub weight: f64,
    pub official: bool,
    pub url: String,
    pub checked_at: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Profile {
    #[serde(default)]
    pub id: String,
    pub model_id: String,
    pub name: String,
    pub vendor: String,
    pub setting: String,
    pub index: f64,
    pub cost: Option<f64>,
    pub speed: Option<f64>,
    pub latency: Option<f64>,
    pub source_id: String,
    pub version: String,
}
#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    #[serde(default)]
    pub weights: BTreeMap<String, f64>,
    pub id: String,
    pub name: String,
    pub url: String,
    pub version: String,
    pub checked_at: String,
    pub records: usize,
    pub error: Option<String>,
    pub automatic: bool,
}
#[derive(Clone, Serialize, Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Dataset {
    pub schema: u32,
    pub sources: Vec<Source>,
    pub observations: Vec<Observation>,
    pub profiles: Vec<Profile>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub metric: String,
    pub value: f64,
    pub unit: String,
    pub weight: Option<f64>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SourceResult {
    pub source_id: String,
    pub version: String,
    pub profile_id: String,
    pub setting: String,
    pub score: f64,
    pub coverage: f64,
    pub components: Vec<Component>,
    pub url: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RankEntry {
    pub model_id: String,
    pub score: f64,
    pub rank: u32,
    pub tier: String,
    pub coverage: f64,
    pub profile_id: String,
    pub setting: String,
    pub source_ranks: BTreeMap<String, f64>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Ranking {
    pub id: String,
    pub name: String,
    pub version: String,
    pub unit: String,
    pub entries: Vec<RankEntry>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RankedModel {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub results: Vec<SourceResult>,
    pub observations: Vec<Observation>,
}
#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub algorithm: String,
    pub sources: Vec<Source>,
    pub models: Vec<RankedModel>,
    pub profiles: Vec<Profile>,
    pub reference_cohort: Vec<String>,
    pub rankings: Vec<Ranking>,
}
pub struct Cache {
    pub dataset: Mutex<Dataset>,
    pub refreshing: tokio::sync::Mutex<()>,
}

pub fn key(value: &str) -> String {
    value
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}
pub fn split_configuration(name: &str) -> (&str, &str) {
    if let Some((base, suffix)) = name.rsplit_once(" (") {
        if let Some(setting) = suffix.strip_suffix(')') {
            let parts: Vec<_> = setting.split(',').map(str::trim).collect();
            if matches!(
                parts[0].to_ascii_lowercase().as_str(),
                "low" | "medium" | "high" | "xhigh" | "max" | "reasoning" | "non-reasoning"
            ) && parts
                .iter()
                .skip(1)
                .all(|part| part.eq_ignore_ascii_case("default fallback"))
            {
                return (base, setting);
            }
        }
    }
    (name, "")
}
pub fn identity(name: &str) -> String {
    key(split_configuration(name).0)
}
pub fn load(dir: &Path) -> Dataset {
    let base: Dataset = serde_json::from_str(include_str!("../data/benchmarks.json"))
        .expect("valid benchmark seed");
    let saved = std::fs::read(dir.join("ai-benchmarks-v2.json"))
        .ok()
        .filter(|b| b.len() <= 12 * 1024 * 1024)
        .and_then(|b| serde_json::from_slice::<Dataset>(&b).ok())
        .filter(valid);
    let mut result = saved.unwrap_or_else(|| base.clone());
    for source in &base.sources {
        if result
            .sources
            .iter()
            .find(|old| old.id == source.id)
            .is_none_or(|old| {
                chrono::DateTime::parse_from_rfc3339(&old.checked_at).ok()
                    < chrono::DateTime::parse_from_rfc3339(&source.checked_at).ok()
            })
        {
            replace_source(&mut result, &base, &source.id);
        }
    }
    result
}
pub fn valid(data: &Dataset) -> bool {
    data.schema == 2
        && data.sources.len() <= 8
        && data.observations.len() <= 12000
        && data.profiles.len() <= 1000
        && data.sources.iter().all(|s| {
            s.checked_at.len() < 64
                && matches!(
                    s.id.as_str(),
                    "artificial-analysis" | "livebench" | "official-openai" | "official-anthropic"
                )
        })
        && data.observations.iter().all(|o| {
            o.model_id.len() <= 160
                && !o.model_id.is_empty()
                && o.model_name.len() <= 200
                && o.value.is_finite()
                && o.value >= 0.
                && o.value <= 5000.
                && o.weight >= 0.
                && o.weight <= 10.
                && AREAS.contains(&o.domain.as_str())
                && o.url.starts_with("https://")
                && data.sources.iter().any(|s| s.id == o.source_id)
        })
        && data.profiles.iter().all(|p| {
            !p.id.is_empty()
                && p.source_id == "artificial-analysis"
                && p.index.is_finite()
                && (0. ..=100.).contains(&p.index)
                && [p.cost, p.speed, p.latency]
                    .into_iter()
                    .flatten()
                    .all(|v| v.is_finite() && v >= 0.)
        })
}
fn replace_source(target: &mut Dataset, incoming: &Dataset, id: &str) {
    target.sources.retain(|s| s.id != id);
    target
        .sources
        .extend(incoming.sources.iter().filter(|s| s.id == id).cloned());
    target.observations.retain(|o| o.source_id != id);
    target.observations.extend(
        incoming
            .observations
            .iter()
            .filter(|o| o.source_id == id)
            .cloned(),
    );
    target.profiles.retain(|p| p.source_id != id);
    target.profiles.extend(
        incoming
            .profiles
            .iter()
            .filter(|p| p.source_id == id)
            .cloned(),
    );
}
async fn download(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let mut response = client
        .get(url)
        .header("User-Agent", "Mozilla/5.0 Quota-public-benchmarks")
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "连接暂不可用")?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    if !matches!(
        response.url().host_str(),
        Some(
            "artificialanalysis.ai"
                | "www.artificialanalysis.ai"
                | "livebench.ai"
                | "www.livebench.ai"
        )
    ) {
        return Err("来源地址发生变化".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| "读取未完成")? {
        if bytes.len() + chunk.len() > 16 * 1024 * 1024 {
            return Err("来源超过读取上限".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).map_err(|_| "来源编码变化".into())
}
pub async fn fetch(client: &reqwest::Client) -> Vec<(String, Result<Dataset, String>)> {
    let aa = async {
        let body = download(client, "https://artificialanalysis.ai/leaderboards/models").await?;
        parse_aa(&body, &chrono::Utc::now().to_rfc3339())
    };
    let lb = async {
        let index = download(client, "https://livebench.ai/").await?;
        let asset = {
            let doc = scraper::Html::parse_document(&index);
            let selector = scraper::Selector::parse("script[src]").expect("selector");
            doc.select(&selector)
                .filter_map(|n| n.value().attr("src"))
                .find(|s| {
                    s.starts_with("./static/js/main.")
                        && s.ends_with(".js")
                        && s.bytes()
                            .all(|c| c.is_ascii_alphanumeric() || b"./-_".contains(&c))
                })
                .ok_or("LiveBench 版本入口变化")?
                .to_string()
        };
        let js = download(
            client,
            &format!("https://livebench.ai/{}", asset.trim_start_matches("./")),
        )
        .await?;
        let releases = adapters::livebench_releases(&js);
        let date = releases.last().ok_or("LiveBench 发布版本缺失")?;
        let table_url = format!("https://livebench.ai/data/{date}/table.csv");
        let categories_url = format!("https://livebench.ai/data/{date}/categories.json");
        let (table, categories) = tokio::join!(
            download(client, &table_url),
            download(client, &categories_url)
        );
        parse_livebench(
            &table?,
            &categories?,
            date,
            &chrono::Utc::now().to_rfc3339(),
        )
    };
    let (aa, lb) = tokio::join!(aa, lb);
    vec![("artificial-analysis".into(), aa), ("livebench".into(), lb)]
}
pub fn merge(mut previous: Dataset, updates: Vec<(String, Result<Dataset, String>)>) -> Dataset {
    for (id, result) in updates {
        match result {
            Ok(next) if valid(&next) && !next.observations.is_empty() => {
                replace_source(&mut previous, &next, &id)
            }
            other => {
                let error = other
                    .err()
                    .unwrap_or_else(|| "评测结构变化，保留上次记录".into());
                if let Some(source) = previous.sources.iter_mut().find(|s| s.id == id) {
                    source.error = Some(error);
                } else {
                    previous.sources.push(Source {
                        weights: BTreeMap::new(),
                        id: id.clone(),
                        name: if id == "livebench" {
                            "LiveBench"
                        } else {
                            "Artificial Analysis"
                        }
                        .into(),
                        url: if id == "livebench" {
                            "https://livebench.ai/"
                        } else {
                            "https://artificialanalysis.ai/leaderboards/models"
                        }
                        .into(),
                        version: String::new(),
                        checked_at: String::new(),
                        records: 0,
                        error: Some(error),
                        automatic: true,
                    });
                }
            }
        }
    }
    previous
}
pub async fn refresh(state: &AppState, force: bool) -> Result<Board, String> {
    {
        let current = state
            .benchmarks
            .dataset
            .lock()
            .map_err(|_| "评测数据暂不可用")?;
        let automatic: Vec<_> = current.sources.iter().filter(|s| s.automatic).collect();
        if !force
            && automatic.len() == 2
            && automatic.iter().all(|s| {
                s.error.is_none()
                    && chrono::DateTime::parse_from_rfc3339(&s.checked_at)
                        .ok()
                        .is_some_and(|t| {
                            (0..86400).contains(&(chrono::Utc::now().timestamp() - t.timestamp()))
                        })
            })
        {
            return Ok(calculate(&current));
        }
    }
    let Ok(_guard) = state.benchmarks.refreshing.try_lock() else {
        return Ok(calculate(
            &*state
                .benchmarks
                .dataset
                .lock()
                .map_err(|_| "评测数据暂不可用")?,
        ));
    };
    let updates = fetch(&state.http).await;
    let mut current = state
        .benchmarks
        .dataset
        .lock()
        .map_err(|_| "评测数据暂不可用")?;
    let next = merge(current.clone(), updates);
    if !valid(&next) {
        return Err("评测数据校验未通过".into());
    }
    crate::storage::write_atomic(
        &state.store.dir().join("ai-benchmarks-v2.json"),
        &serde_json::to_string(&next).map_err(|_| "编码评测数据失败")?,
    )?;
    *current = next;
    Ok(calculate(&current))
}
#[tauri::command]
pub fn get_benchmarks(state: State<'_, AppState>) -> Result<Board, String> {
    Ok(calculate(
        &*state
            .benchmarks
            .dataset
            .lock()
            .map_err(|_| "评测数据暂不可用")?,
    ))
}
#[tauri::command]
pub async fn refresh_benchmarks(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Board, String> {
    let board = refresh(&state, true).await?;
    let _ = app.emit("benchmarks-updated", ());
    Ok(board)
}
pub fn spawn(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(18)).await;
        loop {
            let enabled = app
                .state::<AppState>()
                .config
                .lock()
                .is_ok_and(|c| c.settings.ladder_auto_update);
            if enabled && refresh(&app.state::<AppState>(), false).await.is_ok() {
                let _ = app.emit("benchmarks-updated", ());
            }
            tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
        }
    });
}
