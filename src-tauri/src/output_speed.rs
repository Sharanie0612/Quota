//! Output-only measurements. No message text, prompts, tool arguments or credentials.
use super::{database, hash, known_device_names, now, options, Metric, OptionsDevice};
use serde::{Deserialize, Serialize};
use serde_json::Value;
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
    pub last_event_at: i64,
    pub active_since: Option<i64>,
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
        self.last_event_at = timestamp;
        let payload = &value["payload"];
        let outer = value["type"].as_str().unwrap_or("");
        let inner = payload["type"].as_str().unwrap_or("");
        if outer == "event_msg" && inner == "task_started" {
            self.reset_response(); self.pending = None;
            self.active_since = Some(timestamp);
        }
        if outer == "event_msg" && matches!(inner, "task_complete" | "turn_aborted") { self.active_since = None; }
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

#[path = "output_speed_report.rs"]
mod reports;
pub use reports::*;
