//! Output-only measurements. No message text, prompts, tool arguments or credentials.
use super::{database, hash, known_device_names, now, options, Metric, OptionsDevice};
use crate::commands::AppState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};
use tauri::Manager;
pub const COLLECTION_INTERVAL_SECONDS:u64=10;

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
    pub bucket_seconds:u32,pub collection_interval_seconds:u64,pub collection_enabled:bool,pub collected_at:Option<i64>,pub errors:Vec<String>,pub range_start:i64,pub range_end:i64,
}
pub fn report(dir: &Path, device: &str, source: &str, days: u32, model: &str) -> Result<Report, String> {
    report_window(dir,device,source,days,model,0,0)
}
pub fn report_window(dir:&Path,device:&str,source:&str,days:u32,model:&str,resolution:u32,lookback_hours:u32)->Result<Report,String>{
    if ![0,10,60,300,3600,21600,86400].contains(&resolution)||lookback_hours>24{return Err("输出速度时间范围无效".into())}
    let db = database(dir)?; let settings = options(dir); let excluded = settings.excluded_devices();
    let range_end=now();let rolling=if lookback_hours>0{Some(range_end-i64::from(lookback_hours)*3_600_000)}else{None};
    let today = chrono::Local::now().date_naive();
    let first = if lookback_hours==0 && days > 0 { today.checked_sub_days(chrono::Days::new((days-1).into())) } else { None };
    let bucket_seconds=if resolution>0{resolution}else if lookback_hours>0{60}else if days==1{300}else if days==0{86400}else if days>=30{21600}else{3600};
    let bucket_minutes=bucket_seconds/60;let bucket_ms=i64::from(bucket_seconds)*1000;
    let mut statement = db.prepare("SELECT body FROM metrics WHERE json_extract(body,'$.speed') IS NOT NULL").map_err(|_| "读取输出速度失败")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|_| "读取输出速度失败")?;
    let mut available = std::collections::BTreeSet::new(); let mut rates = Vec::<f64>::new();
    let mut buckets = BTreeMap::<(i64,String), Point>::new(); let mut summary = Summary::default(); let mut duration = 0_u64;
    for row in rows {
        let event: Metric = serde_json::from_str(&row.map_err(|_| "读取输出速度失败")?).map_err(|_| "输出速度记录损坏")?;
        let Some(sample) = &event.speed else { continue };
        if !sample.valid(&event) || excluded.contains(&event.device) || (!device.is_empty() && device != event.device) || (!source.is_empty() && source != event.source) { continue; }
        let Some(time) = chrono::DateTime::from_timestamp_millis(sample.completed_at) else { continue };
        let date = time.with_timezone(&chrono::Local).date_naive();
        if date > today || first.is_some_and(|first| date < first)||rolling.is_some_and(|first|sample.completed_at<first)||sample.completed_at>range_end { continue; }
        available.insert(event.model.clone());
        if !model.is_empty() && model != event.model { continue; }
        rates.push(sample.output_tokens as f64 * 1000. / sample.duration_ms as f64);
        summary.samples += 1; summary.output_tokens = summary.output_tokens.saturating_add(sample.output_tokens); duration = duration.saturating_add(sample.duration_ms);
        let local_ms=time.with_timezone(&chrono::Local).naive_local().and_utc().timestamp_millis();
        let hour=chrono::DateTime::from_timestamp_millis(local_ms.div_euclid(bucket_ms)*bucket_ms)
            .and_then(|date|date.naive_utc().and_local_timezone(chrono::Local).earliest()).map(|date|date.timestamp_millis()).unwrap_or(sample.completed_at.div_euclid(bucket_ms)*bucket_ms);
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
    let range_start=rolling.or_else(||first.and_then(|date|date.and_hms_opt(0,0,0)?.and_local_timezone(chrono::Local).earliest().map(|d|d.timestamp_millis()))).unwrap_or_else(||buckets.keys().next().map(|(time,_)|*time).unwrap_or(range_end-3_600_000));
    let status:Value=std::fs::read(dir.join("output-speed-status.json")).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
    Ok(Report { devices:known_device_names(&db,&settings)?.into_iter().filter(|d|!excluded.contains(&d.id)).collect(), models:available.into_iter().collect(), points:buckets.into_values().collect(), summary, updated_at:range_end,bucket_minutes,bucket_seconds,collection_interval_seconds:COLLECTION_INTERVAL_SECONDS,collection_enabled:settings.auto_collect,collected_at:status["collectedAt"].as_i64(),errors:status.get("errors").and_then(|v|serde_json::from_value(v.clone()).ok()).unwrap_or_default(),range_start,range_end })
}
#[tauri::command]
pub async fn get_output_speed(app:tauri::AppHandle,device:Option<String>,source:Option<String>,days:Option<u32>,model:Option<String>,bucket_seconds:Option<u32>,lookback_hours:Option<u32>) -> Result<Report,String> {
    tauri::async_runtime::spawn_blocking(move || report_window(app.state::<AppState>().store.dir(),&device.unwrap_or_default(),&source.unwrap_or_default(),days.unwrap_or(7),&model.unwrap_or_default(),bucket_seconds.unwrap_or(0),lookback_hours.unwrap_or(0))).await.map_err(|_| "读取输出速度失败")?
}
