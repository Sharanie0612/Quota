//! Build chart data from the existing ledger. Each SQLite row is decoded once.
use super::{
    database, known_device_names, options, sources, Metric, Options, OptionsDevice, Tokens,
};
use chrono::{DateTime, Days, Local, NaiveDate, Timelike};
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashMap, fs, path::Path};

mod groups;
use groups::{Counts, Details, Groups, SourceGroups};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub key: String,
    pub tokens: Tokens,
    pub calls: u64,
    pub sessions: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub options: Options,
    pub devices: Vec<OptionsDevice>,
    pub totals: Group,
    pub models: Vec<Group>,
    pub available_models: Vec<Group>,
    pub tools: Vec<Group>,
    pub agents: Vec<Group>,
    pub daily: Vec<Group>,
    pub hourly: Vec<Group>,
    pub sources: Vec<Group>,
    pub channels: Vec<Group>,
    pub by_device: Vec<Group>,
    pub updated_at: Option<i64>,
    pub errors: Vec<String>,
    pub sync_errors: Vec<String>,
    pub softwares: Vec<Group>,
    pub launchers: Vec<Group>,
    pub environments: Vec<Group>,
    pub accesses: Vec<Group>,
    pub facets: Facets,
    pub details: Vec<UsageDetail>,
    pub coverage: Coverage,
    pub cache: Vec<Group>,
    pub cache_daily: Vec<Group>,
    pub cache_hourly: Vec<Group>,
}
#[derive(Serialize)]
pub struct Facets {
    pub softwares: Vec<Group>,
    pub launchers: Vec<Group>,
    pub environments: Vec<Group>,
    pub accesses: Vec<Group>,
    pub vendors: Vec<Group>,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Coverage {
    pub token_records: usize,
    pub known_cache_input: u64,
    pub all_input: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDetail {
    pub software: String,
    pub launcher: String,
    pub environment: String,
    pub access: String,
    pub model: String,
    pub vendor: String,
    pub tokens: Tokens,
    pub calls: u64,
    pub sessions: u64,
}

const CHANNEL_SEPARATOR: char = '\u{1f}';

fn channel(event: &Metric) -> &str {
    if event.channel.is_empty() {
        "unknown"
    } else {
        &event.channel
    }
}

fn model_key(event: &Metric) -> String {
    let channel = if event.source == "trae" {
        channel(event)
    } else {
        &event.channel
    };
    if channel.is_empty() {
        event.model.clone()
    } else {
        format!("{}{CHANNEL_SEPARATOR}{channel}", event.model)
    }
}

fn model_matches(filter: &str, event: &Metric) -> bool {
    if filter.is_empty() {
        return true;
    }
    if let Some(model) = filter.strip_prefix("model:") {
        return model == event.model;
    }
    if let Some(vendor) = filter.strip_prefix("vendor:") {
        return if vendor == "trae" {
            event.source == "trae"
        } else {
            event.source != "trae" && vendor == model_vendor(&event.model)
        };
    }
    if let Some(name) = filter.strip_prefix("channel:") {
        return event.source == "trae" && name == channel(event);
    }
    match filter.split_once(CHANNEL_SEPARATOR) {
        Some((model, name)) => model == event.model && name == channel(event),
        None => event.source != "trae" && filter == event.model,
    }
}

#[derive(Default)]
struct ReportGroups {
    // Choices have a wider scope than the chart the user is currently viewing.
    choices: SourceGroups,
    vendors: Groups,
    available_models: Groups,
    selected: SourceGroups,
    totals: Counts,
    models: Groups,
    agents: Groups,
    tools: Groups,
    days: Groups,
    hours: Groups,
    sources: Groups,
    channels: Groups,
    devices: Groups,
    details: Details,
    cache_models: Groups,
    cache_days: Groups,
    cache_hours: Groups,
    coverage: Coverage,
}

impl ReportGroups {
    fn observe(
        &mut self,
        event: &Metric,
        time: DateTime<Local>,
        session: usize,
        filters: &sources::Filters,
        model: &str,
    ) {
        // Device, date and legacy source filters apply before computing any choices.
        self.choices.add(event, session);
        self.vendors.add(model_vendor(&event.model), event, session);
        if !filters.matches(event) {
            return;
        }
        let token_key = (event.kind == "tokens").then(|| model_key(event));
        if let Some(key) = &token_key {
            self.available_models.add(key, event, session);
        }
        if !model_matches(model, event) {
            return;
        }

        let day = time.date_naive().to_string();
        let hour = format!("{day}T{:02}", time.hour());
        self.totals.add(event, session);
        self.selected.add(event, session);
        self.details.add(event, session);
        self.agents.add(&event.agent, event, session);
        self.sources.add(event.activity_source(), event, session);
        self.devices.add(&event.device, event, session);
        self.days.add(&day, event, session);
        self.hours.add(&hour, event, session);
        if event.source == "trae" {
            self.channels.add(channel(event), event, session);
        }
        if event.kind == "tool" {
            self.tools.add(&event.tool, event, session);
        }
        if let Some(key) = token_key {
            self.models.add(&key, event, session);
            self.coverage.token_records += 1;
            self.coverage.all_input += event.tokens.input;
            if event.origin.as_ref().is_none_or(|o| o.cache_known) {
                self.coverage.known_cache_input += event.tokens.input;
                self.cache_models.add(&key, event, session);
                self.cache_days.add(&day, event, session);
                self.cache_hours.add(&hour, event, session);
            }
        }
    }

    fn finish(self, options: Options, devices: Vec<OptionsDevice>, dir: &Path) -> Report {
        let status: Value = fs::read(dir.join("activity-status.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or(Value::Null);
        let errors = |field: &str| -> Vec<String> {
            status
                .get(field)
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default()
        };
        let mut sync_errors = errors("syncErrors");
        sync_errors.extend(crate::usage_sync::errors(dir));
        let mut totals = self.totals.finish("全部".into());
        if totals.sessions == 0 {
            totals.key.clear();
        }
        Report {
            options,
            devices,
            totals,
            models: self.models.finish(),
            available_models: self.available_models.finish(),
            tools: self.tools.finish(),
            agents: self.agents.finish(),
            daily: self.days.finish(),
            hourly: self.hours.finish(),
            sources: self.sources.finish(),
            channels: self.channels.finish(),
            by_device: self.devices.finish(),
            updated_at: status.get("at").and_then(Value::as_i64),
            errors: errors("errors"),
            sync_errors,
            softwares: self.selected.software.finish(),
            launchers: self.selected.launcher.finish(),
            environments: self.selected.environment.finish(),
            accesses: self.selected.access.finish(),
            facets: Facets {
                softwares: self.choices.software.finish(),
                launchers: self.choices.launcher.finish(),
                environments: self.choices.environment.finish(),
                accesses: self.choices.access.finish(),
                vendors: self.vendors.finish(),
            },
            details: self.details.finish(),
            coverage: self.coverage,
            cache: self.cache_models.finish(),
            cache_daily: self.cache_days.finish(),
            cache_hourly: self.cache_hours.finish(),
        }
    }
}

pub fn report(
    dir: &Path,
    device: Option<String>,
    source: Option<String>,
    days: Option<u32>,
) -> Result<Report, String> {
    report_filtered(dir, device, source, days, None)
}
pub fn report_filtered(
    dir: &Path,
    device: Option<String>,
    source: Option<String>,
    days: Option<u32>,
    model: Option<String>,
) -> Result<Report, String> {
    report_range(dir, device, source, days, model, None, None)
}
pub fn model_vendor(key: &str) -> &'static str {
    let raw = key.to_lowercase();
    let name = raw.rsplit('/').next().unwrap_or(&raw);
    if name.starts_with("gpt")
        || ["o1", "o3", "o4"]
            .iter()
            .any(|p| name == *p || name.starts_with(&format!("{p}-")))
        || name.starts_with("codex")
        || raw.starts_with("openai/")
    {
        "custom"
    } else if name.starts_with("deepseek") {
        "deepseek"
    } else if name.starts_with("glm")
        || ["zai/", "z-ai/", "zhipu/"]
            .iter()
            .any(|p| raw.starts_with(p))
    {
        "zhipu"
    } else if name.starts_with("kimi") || name.starts_with("moonshot") {
        "moonshot"
    } else if name.starts_with("mimo") || raw.starts_with("xiaomi/") {
        "mimo"
    } else if name.starts_with("claude") || raw.starts_with("anthropic/") {
        "anthropic"
    } else if name.starts_with("gemini") || raw.starts_with("google/") {
        "google"
    } else if name.starts_with("grok") || raw.starts_with("xai/") {
        "xai"
    } else if name.starts_with("qwen") || raw.starts_with("alibaba/") {
        "alibaba"
    } else {
        "unknown"
    }
}
pub fn report_range(
    dir: &Path,
    device: Option<String>,
    source: Option<String>,
    days: Option<u32>,
    model: Option<String>,
    from: Option<String>,
    to: Option<String>,
) -> Result<Report, String> {
    report_workspace(
        dir,
        device,
        source,
        days,
        model,
        from,
        to,
        Default::default(),
    )
}

fn parse_date(value: Option<String>) -> Result<Option<NaiveDate>, String> {
    value
        .filter(|s| !s.is_empty())
        .map(|s| NaiveDate::parse_from_str(&s, "%Y-%m-%d").map_err(|_| "日期格式无效".to_string()))
        .transpose()
}

pub fn report_workspace(
    dir: &Path,
    device: Option<String>,
    source: Option<String>,
    days: Option<u32>,
    model: Option<String>,
    from: Option<String>,
    to: Option<String>,
    filters: sources::Filters,
) -> Result<Report, String> {
    let from = parse_date(from)?;
    let to = parse_date(to)?;
    if from.zip(to).is_some_and(|(first, last)| first > last) {
        return Err("开始日期不能晚于结束日期".into());
    }
    let today = Local::now().date_naive();
    // Calendar days rather than 24-hour durations keep the boundary aligned with the chart.
    let start = days
        .filter(|d| *d > 0)
        .map(|d| {
            today
                .checked_sub_days(Days::new(u64::from(d - 1)))
                .unwrap_or(NaiveDate::MIN)
        })
        .max(from);
    let end = to.unwrap_or(today).min(today);
    let db = database(dir)?;
    let options = options(dir);
    let excluded = sources::excluded(dir, &options)?;
    let device = device.as_deref().unwrap_or_default();
    let source = source.as_deref().unwrap_or_default();
    let model = model.as_deref().unwrap_or_default();
    let mut groups = ReportGroups::default();
    let mut sessions = HashMap::new();
    {
        let mut statement = db
            .prepare("SELECT body FROM metrics")
            .map_err(|_| "读取统计失败")?;
        let mut rows = statement.query([]).map_err(|_| "读取统计失败")?;
        while let Some(row) = rows.next().map_err(|_| "读取统计失败")? {
            let body = row
                .get_ref(0)
                .map_err(|_| "读取统计失败")?
                .as_str()
                .map_err(|_| "读取统计失败")?;
            let event: Metric = serde_json::from_str(body).map_err(|_| "统计资料库损坏")?;
            if event.superseded_zcode()
                || excluded.contains(&event.device)
                || (!device.is_empty() && device != event.device)
            {
                continue;
            }
            if !source.is_empty()
                && source != event.activity_source()
                && !(source == "without-trae" && event.source != "trae")
            {
                continue;
            }
            let Some(utc) = DateTime::from_timestamp_millis(event.timestamp) else {
                continue;
            };
            let local = utc.with_timezone(&Local);
            let date = local.date_naive();
            if date > end || start.is_some_and(|first| date < first) {
                continue;
            }
            // A source/session pair has the same identity in every dimension.
            let next = sessions.len();
            let session = *sessions
                .entry(format!("{}:{}", event.source, event.session))
                .or_insert(next);
            groups.observe(&event, local, session, &filters, model);
        }
    }
    let devices = known_device_names(&db, &options)?;
    Ok(groups.finish(options, devices, dir))
}
