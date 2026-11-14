//! Local view of Artificial Analysis's published Intelligence Index and task cost.
use crate::{benchmarks, commands::AppState, secrets, storage};
use chrono::{DateTime, NaiveDate, Utc};
use reqwest::{header::HeaderValue, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Number;
use std::{
    collections::HashSet,
    fs::File,
    io::Read,
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, State};

const ENDPOINT: &str = "https://artificialanalysis.ai/api/v2/language/models/free";
const CREDENTIAL: &str = "artificial-analysis-task-cost";
const CACHE: &str = "aa-task-cost.json";
const UPDATED: &str = "task-cost-updated";
const MAX_PAGES: usize = 24;
const MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_MODELS: usize = 6000;
const INVALID_DATA: &str = "Artificial Analysis 返回的模型数据不完整，请稍后重试";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub model_name: String,
    pub creator: String,
    pub release_date: Option<NaiveDate>,
    pub index: f64,
    pub cost_per_task: Option<f64>,
}

impl Model {
    fn valid(&self) -> bool {
        [&self.id, &self.name, &self.creator].iter().all(|value| {
            !value.trim().is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
        }) && (0.0..=100.0).contains(&self.index)
            && self
                .cost_per_task
                .is_none_or(|cost| cost.is_finite() && cost > 0.0)
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Origin {
    Api,
    Historical,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub origin: Origin,
    pub index_version: String,
    pub checked_at: DateTime<Utc>,
    pub models: Vec<Model>,
    page_count: usize,
}

impl Snapshot {
    fn valid_api(&self) -> bool {
        self.origin == Origin::Api
            && self
                .index_version
                .parse::<f64>()
                .is_ok_and(|version| version.is_finite() && version > 0.0)
            && (1..=MAX_PAGES).contains(&self.page_count)
            && self.models.len() <= MAX_MODELS
            && self
                .models
                .iter()
                .any(|model| model.cost_per_task.is_some())
            && self.models.iter().all(Model::valid)
            && self
                .models
                .iter()
                .map(|model| &model.id)
                .collect::<HashSet<_>>()
                .len()
                == self.models.len()
    }

    fn refresh_due(&self, now: DateTime<Utc>) -> bool {
        // Leave room in the documented free 100-request/day budget for manual updates.
        let interval = 3600.max((86_400 * self.page_count).div_ceil(80)) as i64;
        self.origin != Origin::Api
            || !(0..interval).contains(&(now - self.checked_at).num_seconds())
    }
}

fn positive_cost(cost: Option<f64>) -> Option<f64> {
    cost.filter(|cost| cost.is_finite() && *cost > 0.0)
}

// Only remove explicit settings at the end of an AA configuration name.
// Parenthesized model revisions, such as Qwen3.8 Max (0902), stay distinct.
fn base_model_name(name: &str) -> &str {
    let (base, _) = benchmarks::split_configuration(name);
    if let Some((model, suffix)) = base.rsplit_once(" (") {
        if matches!(
            suffix.to_ascii_lowercase().as_str(),
            "minimal)" | "thinking)" | "non-thinking)" | "adaptive)" | "no thinking)"
        ) {
            return model;
        }
    }
    base
}

fn historical_snapshot(dataset: &benchmarks::Dataset) -> Option<Snapshot> {
    let source = dataset
        .sources
        .iter()
        .find(|source| source.id == "artificial-analysis")?;
    let version = source
        .edition
        .as_ref()
        .map(|edition| edition.version.as_str())
        .or_else(|| {
            dataset
                .profiles
                .iter()
                .find(|profile| profile.source_id == source.id)
                .map(|profile| profile.version.as_str())
        })?;
    let checked_at = source.checked_at.parse().ok()?;
    let models: Vec<_> = dataset
        .profiles
        .iter()
        .filter(|profile| profile.source_id == source.id && profile.version == version)
        .map(|profile| Model {
            id: profile.id.clone(),
            name: profile.name.clone(),
            model_name: base_model_name(&profile.name).into(),
            creator: profile.vendor.clone(),
            release_date: dataset
                .releases
                .iter()
                .find(|release| {
                    release.id == profile.model_id
                        && release.vendor.eq_ignore_ascii_case(&profile.vendor)
                })
                .and_then(|release| release.released_at.parse().ok()),
            index: profile.index,
            cost_per_task: positive_cost(profile.cost),
        })
        .filter(Model::valid)
        .collect();
    (!models.is_empty()).then(|| Snapshot {
        origin: Origin::Historical,
        index_version: version.to_string(),
        checked_at,
        models,
        page_count: 0,
    })
}

pub fn load_snapshot(dir: &Path, historical: &benchmarks::Dataset) -> Option<Snapshot> {
    let saved = (|| {
        let mut bytes = Vec::new();
        File::open(dir.join(CACHE))
            .ok()?
            .take(MAX_BYTES as u64 + 1)
            .read_to_end(&mut bytes)
            .ok()?;
        (bytes.len() <= MAX_BYTES).then_some(())?;
        serde_json::from_slice::<Snapshot>(&bytes)
            .ok()
            .filter(Snapshot::valid_api)
    })();
    saved
        .map(|mut snapshot| {
            // Snapshots from 1.0.3900 carry the full configuration name.
            for model in &mut snapshot.models {
                model.model_name = base_model_name(&model.name).into();
            }
            snapshot
        })
        .or_else(|| historical_snapshot(historical))
}

#[derive(Deserialize)]
struct ApiPage {
    intelligence_index_version: Number,
    pagination: Pagination,
    data: Vec<ApiModel>,
}

#[derive(Deserialize)]
struct Pagination {
    page: usize,
    total_pages: usize,
    has_more: bool,
}

#[derive(Deserialize)]
struct ApiModel {
    id: String,
    name: String,
    model_creator: Creator,
    release_date: Option<NaiveDate>,
    evaluations: Option<Evaluations>,
    artificial_analysis_intelligence_index_cost: Option<IndexCost>,
}

#[derive(Deserialize)]
struct Creator {
    name: String,
}

#[derive(Deserialize)]
struct Evaluations {
    artificial_analysis_intelligence_index: Option<f64>,
}

#[derive(Deserialize)]
struct IndexCost {
    cost_per_task: Option<CostPerTask>,
}

#[derive(Deserialize)]
struct CostPerTask {
    total_cost: Option<f64>,
}

/// Accumulate a complete, single-edition response before replacing the snapshot.
#[derive(Default)]
pub struct Pages {
    version: Option<Number>,
    next_page: usize,
    total_pages: usize,
    seen: HashSet<String>,
    models: Vec<Model>,
}

impl Pages {
    pub fn ingest(&mut self, bytes: &[u8]) -> Result<bool, &'static str> {
        if bytes.len() > MAX_BYTES {
            return Err(INVALID_DATA);
        }
        let page: ApiPage = serde_json::from_slice(bytes).map_err(|_| INVALID_DATA)?;
        let pagination = page.pagination;
        if pagination.page != self.next_page + 1
            || pagination.page > pagination.total_pages
            || !(1..=MAX_PAGES).contains(&pagination.total_pages)
            || pagination.has_more != (pagination.page < pagination.total_pages)
            || page.data.is_empty()
            || self.seen.len() + page.data.len() > MAX_MODELS
            || self.version.as_ref().is_some_and(|version| {
                version.as_f64() != page.intelligence_index_version.as_f64()
                    || self.total_pages != pagination.total_pages
            })
        {
            return Err(INVALID_DATA);
        }
        for row in page.data {
            if !self.seen.insert(row.id.clone()) {
                return Err(INVALID_DATA);
            }
            let Some(index) = row
                .evaluations
                .and_then(|scores| scores.artificial_analysis_intelligence_index)
            else {
                continue;
            };
            let model = Model {
                id: row.id,
                model_name: base_model_name(&row.name).into(),
                name: row.name,
                creator: row.model_creator.name,
                release_date: row.release_date,
                index,
                cost_per_task: positive_cost(
                    row.artificial_analysis_intelligence_index_cost
                        .and_then(|cost| cost.cost_per_task)
                        .and_then(|cost| cost.total_cost),
                ),
            };
            if !model.valid() {
                return Err(INVALID_DATA);
            }
            self.models.push(model);
        }
        self.next_page = pagination.page;
        self.total_pages = pagination.total_pages;
        self.version = Some(page.intelligence_index_version);
        Ok(pagination.has_more)
    }

    pub fn finish(self, checked_at: DateTime<Utc>) -> Result<Snapshot, &'static str> {
        let version = self.version.ok_or(INVALID_DATA)?.to_string();
        let index_version = if version.contains(['.', 'e', 'E']) {
            version
        } else {
            format!("{version}.0")
        };
        let snapshot = Snapshot {
            origin: Origin::Api,
            index_version,
            checked_at,
            models: self.models,
            page_count: self.total_pages,
        };
        (self.next_page == self.total_pages && snapshot.valid_api())
            .then_some(snapshot)
            .ok_or(INVALID_DATA)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub snapshot: Option<Snapshot>,
    pub connected: bool,
    pub error: Option<String>,
}

#[derive(Default)]
struct RefreshGate {
    retry_at: Option<Instant>,
    limited_until: Option<Instant>,
}

pub struct Feed {
    current: Mutex<Report>,
    gate: tokio::sync::Mutex<RefreshGate>,
}

impl Feed {
    pub fn new(dir: &Path, historical: &benchmarks::Dataset) -> Self {
        Self {
            current: Mutex::new(Report {
                snapshot: load_snapshot(dir, historical),
                connected: false,
                error: None,
            }),
            gate: tokio::sync::Mutex::new(RefreshGate::default()),
        }
    }

    pub fn report(&self) -> Result<Report, String> {
        let mut report = self.current.lock().map_err(|_| "模型数据暂不可用")?.clone();
        report.connected = match secrets::get_secrets(CREDENTIAL) {
            Ok(secrets) => secrets.api_key.is_some_and(|key| !key.trim().is_empty()),
            Err(_) => {
                report.error = Some("无法读取系统凭据，请检查系统凭据管理器".into());
                false
            }
        };
        Ok(report)
    }

    fn publish(&self, dir: &Path, snapshot: Snapshot) -> Result<(), String> {
        let mut report = self.current.lock().map_err(|_| "模型数据暂不可用")?;
        let data = serde_json::to_string(&snapshot).map_err(|_| "无法编码模型快照")?;
        storage::write_atomic(&dir.join(CACHE), &data).map_err(|_| "无法保存本机模型快照")?;
        report.snapshot = Some(snapshot);
        report.error = None;
        Ok(())
    }

    fn set_error(&self, error: Option<String>) -> Result<(), String> {
        self.current.lock().map_err(|_| "模型数据暂不可用")?.error = error;
        Ok(())
    }
}

struct FetchFailure {
    message: &'static str,
    limited_for: Option<Duration>,
}

impl From<&'static str> for FetchFailure {
    fn from(message: &'static str) -> Self {
        Self {
            message,
            limited_for: None,
        }
    }
}

fn key_header(key: &str) -> Result<HeaderValue, &'static str> {
    if key.is_empty() || key.len() > 512 || !key.bytes().all(|byte| byte.is_ascii_graphic()) {
        return Err("请输入有效的 Artificial Analysis API Key");
    }
    let mut header =
        HeaderValue::from_str(key).map_err(|_| "请输入有效的 Artificial Analysis API Key")?;
    header.set_sensitive(true);
    Ok(header)
}

async fn fetch(key: HeaderValue) -> Result<Snapshot, FetchFailure> {
    let mut builder = reqwest::Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .user_agent(concat!("Quota/", env!("CARGO_PKG_VERSION")));
    if let Some(proxy) =
        crate::proxy::system_proxy_url().and_then(|url| reqwest::Proxy::all(url).ok())
    {
        builder = builder.proxy(proxy);
    }
    let client = builder.build().map_err(|_| "无法初始化模型数据连接")?;
    let mut pages = Pages::default();
    loop {
        let mut response = client
            .get(ENDPOINT)
            .query(&[("page", pages.next_page + 1)])
            .header("x-api-key", key.clone())
            .send()
            .await
            .map_err(|_| "连接 Artificial Analysis 失败，请检查网络")?;
        match response.status() {
            StatusCode::OK => (),
            StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
                return Err("Artificial Analysis 拒绝访问，请检查 API Key 和访问权限".into())
            }
            StatusCode::TOO_MANY_REQUESTS => {
                let seconds = response
                    .headers()
                    .get("retry-after")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(3600)
                    .clamp(60, 86_400);
                return Err(FetchFailure {
                    message: "Artificial Analysis 请求已达限额，将在额度恢复后继续更新",
                    limited_for: Some(Duration::from_secs(seconds)),
                });
            }
            _ => return Err("Artificial Analysis 暂时无法提供模型数据".into()),
        }
        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| "接收模型数据失败，请稍后重试")?
        {
            if body.len() + chunk.len() > MAX_BYTES {
                return Err(INVALID_DATA.into());
            }
            body.extend_from_slice(&chunk);
        }
        if !pages.ingest(&body)? {
            return Ok(pages.finish(Utc::now())?);
        }
    }
}

async fn fetch_bounded(key: HeaderValue) -> Result<Snapshot, FetchFailure> {
    tokio::time::timeout(Duration::from_secs(75), fetch(key))
        .await
        .map_err(|_| "模型数据更新超时，请稍后重试")?
}

async fn refresh(state: &AppState, force: bool) -> Result<bool, String> {
    let feed = &state.task_cost;
    let mut gate = match feed.gate.try_lock() {
        Ok(gate) => gate,
        Err(_) => {
            if force {
                drop(feed.gate.lock().await);
            }
            return Ok(false);
        }
    };
    let now = Instant::now();
    if gate.limited_until.is_some_and(|until| now < until) {
        return Ok(false);
    }
    if !force
        && (gate.retry_at.is_some_and(|until| now < until)
            || feed
                .current
                .lock()
                .map_err(|_| "模型数据暂不可用")?
                .snapshot
                .as_ref()
                .is_some_and(|snapshot| !snapshot.refresh_due(Utc::now())))
    {
        return Ok(false);
    }
    let Some(key) = secrets::get_secrets(CREDENTIAL)?
        .api_key
        .filter(|key| !key.trim().is_empty())
    else {
        return Ok(false);
    };
    match fetch_bounded(key_header(&key)?).await {
        Ok(snapshot) => {
            if let Err(error) = feed.publish(state.store.dir(), snapshot) {
                gate.retry_at = Some(Instant::now() + Duration::from_secs(300));
                feed.set_error(Some(error))?;
            }
        }
        Err(failure) => {
            let now = Instant::now();
            gate.retry_at = Some(now + Duration::from_secs(900));
            gate.limited_until = failure.limited_for.map(|duration| now + duration);
            feed.set_error(Some(failure.message.into()))?;
        }
    }
    Ok(true)
}

#[tauri::command]
pub fn get_task_cost(state: State<'_, AppState>) -> Result<Report, String> {
    state.task_cost.report()
}

#[tauri::command]
pub async fn refresh_task_cost(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Report, String> {
    if refresh(&state, true).await? {
        let _ = app.emit(UPDATED, ());
    }
    state.task_cost.report()
}

#[tauri::command]
pub async fn save_task_cost_key(
    app: AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    key: String,
) -> Result<Report, String> {
    if window.label() != "main" {
        return Err("请在 Quota 主窗口管理 Artificial Analysis 数据源".into());
    }
    let feed = &state.task_cost;
    let mut gate = feed.gate.lock().await;
    let key = key.trim();
    if key.is_empty() {
        secrets::set_api_key(CREDENTIAL, "")?;
        feed.set_error(None)?;
    } else {
        // A failed connection leaves the existing key and snapshot available.
        let snapshot = fetch_bounded(key_header(key)?)
            .await
            .map_err(|failure| failure.message)?;
        secrets::set_api_key(CREDENTIAL, key)?;
        if let Err(error) = feed.publish(state.store.dir(), snapshot) {
            feed.set_error(Some(error))?;
        }
    }
    *gate = RefreshGate::default();
    let _ = app.emit(UPDATED, ());
    feed.report()
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        loop {
            let state = app.state::<AppState>();
            let enabled = state
                .config
                .lock()
                .is_ok_and(|config| config.settings.ladder_auto_update);
            if enabled && refresh(&state, false).await.unwrap_or(false) {
                let _ = app.emit(UPDATED, ());
            }
            tokio::time::sleep(Duration::from_secs(60)).await;
        }
    });
}
