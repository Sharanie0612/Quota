//! Output-only measurements. No message text, prompts, tool arguments or credentials.
use super::{database, hash, known_device_names, now, options, Metric, OptionsDevice};
use crate::commands::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};
use tauri::Manager;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sample {
    pub request_id: String,
    pub started_at: i64,
    pub completed_at: i64,
    pub duration_ms: u64,
    pub output_tokens: u64,
    pub method: String,
}
impl Sample {
    pub fn valid(&self, event: &Metric) -> bool {
        event.kind == "tokens" && event.source == "codex"
            && self.method == "codex-stream-v1"
            && self.request_id.len() == 64 && self.request_id.bytes().all(|b| b.is_ascii_hexdigit())
            && self.started_at > 0 && self.completed_at > self.started_at
            && self.completed_at <= event.timestamp + 1_000
            && self.duration_ms >= 500 && self.duration_ms <= 3_600_000
            && self.duration_ms <= (self.completed_at - self.started_at) as u64
            && self.output_tokens >= 64
            && self.output_tokens <= event.tokens.output.saturating_sub(event.tokens.reasoning)
    }
}

#[derive(Default, Serialize, Deserialize)]
#[serde(default)]
pub struct TimingCursor {
    pub version: u8,
    intervals: Vec<(i64, i64)>,
    messages: u32,
    timed_messages: u32,
    tool_call: bool,
    pending: Option<(u64, u64, Sample)>,
}
impl TimingCursor {
    fn reset_response(&mut self) {
        self.intervals.clear(); self.messages = 0; self.timed_messages = 0; self.tool_call = false;
    }
    pub fn observe(&mut self, value: &Value, timestamp: i64) {
        self.version = 1;
        let payload = &value["payload"];
        let outer = value["type"].as_str().unwrap_or("");
        let inner = payload["type"].as_str().unwrap_or("");
        if outer == "event_msg" && inner == "task_started" {
            self.reset_response(); self.pending = None;
        }
        if outer == "response_item" {
            if matches!(inner, "function_call" | "custom_tool_call") { self.tool_call = true; }
            if inner == "message" && payload["role"] == "assistant" { self.messages = self.messages.saturating_add(1); }
        }
        if outer == "event_msg" && inner == "item_completed" && payload["item"]["type"] == "AgentMessage" {
            if let (Some(start), Some(end)) = (payload["started_at_ms"].as_i64(), payload["completed_at_ms"].as_i64()) {
                if start > 0 && end > start && end - start <= 3_600_000 && end <= timestamp + 1_000 && self.intervals.len() < 128 {
                    self.intervals.push((start, end)); self.timed_messages = self.timed_messages.saturating_add(1);
                }
            }
        }
        if outer == "token_usage_record" {
            self.pending = None;
            let usage = &payload["usage"];
            if let (Some(output), Some(reasoning), Some(request)) = (usage["output_tokens"].as_u64(), usage["reasoning_output_tokens"].as_u64(), payload["response_id"].as_str()) {
                // Usage also includes generated tool arguments: those requests cannot be
                // divided by message-only timing. Never count tool execution as inference.
                if !self.tool_call && self.messages > 0 && self.messages == self.timed_messages && output > reasoning && !request.is_empty() {
                    let mut spans = self.intervals.clone(); spans.sort_unstable();
                    let mut merged: Vec<(i64, i64)> = Vec::new();
                    for (start, end) in spans {
                        if let Some(last) = merged.last_mut().filter(|last| start <= last.1) { last.1 = last.1.max(end); }
                        else { merged.push((start, end)); }
                    }
                    if let (Some(first), Some(last)) = (merged.first(), merged.last()) {
                        let duration_ms = merged.iter().map(|(a,b)| (b-a) as u64).sum();
                        // Short buffered bursts are not stable throughput samples.
                        if duration_ms >= 500 && duration_ms <= 3_600_000 && output-reasoning >= 64 {
                            self.pending = Some((output, reasoning, Sample { request_id:hash(request), started_at:first.0, completed_at:last.1, duration_ms, output_tokens:output-reasoning, method:"codex-stream-v1".into() }));
                        }
                    }
                }
            }
            self.reset_response();
        }
    }
    pub fn take(&mut self, output: u64, reasoning: u64) -> Option<Sample> {
        self.pending.take().filter(|(o,r,_)| *o == output && *r == reasoning).map(|(_,_,sample)| sample)
    }
}

#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub timestamp: i64, pub model: String, pub output_tokens: u64, pub duration_ms: u64, pub samples: usize,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub average: Option<f64>, pub median: Option<f64>, pub p95: Option<f64>, pub samples: usize, pub output_tokens: u64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub devices: Vec<OptionsDevice>, pub models: Vec<String>, pub points: Vec<Point>, pub summary: Summary, pub updated_at: i64, pub bucket_minutes: u32,
}
pub fn report(dir: &Path, device: &str, source: &str, days: u32, model: &str) -> Result<Report, String> {
    let db = database(dir)?; let settings = options(dir); let excluded = settings.excluded_devices();
    let today = chrono::Local::now().date_naive();
    let first = if days > 0 { today.checked_sub_days(chrono::Days::new((days-1).into())) } else { None };
    let bucket_minutes=if days==1{5}else{60};let bucket_ms=i64::from(bucket_minutes)*60_000;
    let mut statement = db.prepare("SELECT body FROM metrics WHERE json_extract(body,'$.speed') IS NOT NULL").map_err(|_| "读取输出速度失败")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|_| "读取输出速度失败")?;
    let mut available = std::collections::BTreeSet::new(); let mut rates = Vec::<f64>::new();
    let mut buckets = BTreeMap::<(i64,String), Point>::new(); let mut summary = Summary::default(); let mut duration = 0_u64;
    for row in rows {
        let event: Metric = serde_json::from_str(&row.map_err(|_| "读取输出速度失败")?).map_err(|_| "输出速度记录损坏")?;
        let Some(sample) = &event.speed else { continue };
        if !sample.valid(&event) || excluded.contains(&event.device) || (!device.is_empty() && device != event.device) || (!source.is_empty() && source != event.source) { continue; }
        let Some(time) = chrono::DateTime::from_timestamp_millis(event.timestamp) else { continue };
        let date = time.with_timezone(&chrono::Local).date_naive();
        if date > today || first.is_some_and(|first| date < first) { continue; }
        available.insert(event.model.clone());
        if !model.is_empty() && model != event.model { continue; }
        rates.push(sample.output_tokens as f64 * 1000. / sample.duration_ms as f64);
        summary.samples += 1; summary.output_tokens = summary.output_tokens.saturating_add(sample.output_tokens); duration = duration.saturating_add(sample.duration_ms);
        let hour = event.timestamp.div_euclid(bucket_ms) * bucket_ms;
        let point = buckets.entry((hour, event.model.clone())).or_insert_with(|| Point { timestamp:hour, model:event.model.clone(), ..Default::default() });
        point.output_tokens = point.output_tokens.saturating_add(sample.output_tokens); point.duration_ms = point.duration_ms.saturating_add(sample.duration_ms); point.samples += 1;
    }
    rates.sort_by(f64::total_cmp);
    if !rates.is_empty() {
        summary.average = Some(summary.output_tokens as f64 * 1000. / duration as f64);
        let middle = rates.len()/2;
        summary.median = Some(if rates.len()%2 == 0 { (rates[middle-1]+rates[middle])/2. } else { rates[middle] });
        summary.p95 = Some(rates[((rates.len() as f64 * 0.95).ceil() as usize).saturating_sub(1)]);
    }
    Ok(Report { devices:known_device_names(&db,&settings)?.into_iter().filter(|d|!excluded.contains(&d.id)).collect(), models:available.into_iter().collect(), points:buckets.into_values().collect(), summary, updated_at:now(),bucket_minutes })
}
#[tauri::command]
pub async fn get_output_speed(app:tauri::AppHandle,device:Option<String>,source:Option<String>,days:Option<u32>,model:Option<String>) -> Result<Report,String> {
    tauri::async_runtime::spawn_blocking(move || report(app.state::<AppState>().store.dir(),&device.unwrap_or_default(),&source.unwrap_or_default(),days.unwrap_or(7),&model.unwrap_or_default())).await.map_err(|_| "读取输出速度失败")?
}
