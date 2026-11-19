//! Bounded, read-only native records. No text, tool arguments, endpoint or auth
//! values are persisted. Unsupported usage stays unavailable, never estimated.
use super::{decorate, Environment, Instance, SourceStatus};
use crate::activity::{self, hash, label, merge_metric, Metric, Tokens};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

const MAX_FILE: u64 = 256 * 1024 * 1024;
const MAX_LINE: usize = 32 * 1024 * 1024;
const MAX_FILES: usize = 10000;
#[derive(Default, Serialize, Deserialize)]
pub struct ReaderCursor {
    #[serde(default)]
    pub offset: u64,
    #[serde(default)]
    pub stamp: String,
    #[serde(default)]
    pub fingerprint: String,
    #[serde(default)]
    pub session: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub turn: i64,
    #[serde(default)]
    pub step: u64,
    #[serde(default)]
    pub attempt: u64,
    #[serde(default)]
    pub codex: activity::Cursor,
    #[serde(default)]
    pub observed: usize,
    #[serde(default)]
    pub context_digest: String,
    #[serde(skip)]
    pub multica_roots: Vec<PathBuf>,
}
pub fn context_digest(instance: &Instance, environment: &Environment, roots: &[PathBuf]) -> String {
    hash(&format!(
        "1:{}:{}:{}:{}:{roots:?}",
        instance.launcher, instance.access, instance.revision, environment.kind
    ))
}
pub fn timestamp(value: &Value) -> Option<i64> {
    if let Some(text) = value.as_str() {
        chrono::DateTime::parse_from_rfc3339(text)
            .ok()
            .map(|t| t.timestamp_millis())
    } else {
        value.as_i64().filter(|n| *n > 0)
    }
}
fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
}
fn count(v: &Value, key: &str, required: bool) -> Result<u64, String> {
    match v.get(key) {
        Some(value) => value
            .as_u64()
            .filter(|n| *n <= 1_000_000_000_000)
            .ok_or_else(|| format!("用量字段 {key} 无效")),
        None if !required => Ok(0),
        _ => Err(format!("缺少用量字段 {key}")),
    }
}
fn checked(tokens: Tokens) -> Result<Tokens, String> {
    if tokens.total
        != tokens
            .input
            .checked_add(tokens.output)
            .ok_or("Token 数值溢出")?
        || tokens.cached > tokens.input
        || tokens.cache_write > tokens.input
        || tokens.reasoning > tokens.output
    {
        return Err("Token 子项与总量不一致，未采用此记录".into());
    }
    Ok(tokens)
}
pub fn anthropic_usage(v: &Value) -> Result<Tokens, String> {
    let plain = count(v, "input_tokens", true)?;
    let cached = count(v, "cache_read_input_tokens", false)?;
    let write = count(v, "cache_creation_input_tokens", false)?;
    let input = plain
        .checked_add(cached)
        .and_then(|n| n.checked_add(write))
        .ok_or("Token 数值溢出")?;
    let output = count(v, "output_tokens", true)?;
    checked(Tokens {
        input,
        cached,
        cache_write: write,
        output,
        reasoning: 0,
        total: input.checked_add(output).ok_or("Token 数值溢出")?,
    })
}
fn make(
    instance: &Instance,
    environment: &Environment,
    id: &str,
    session: &str,
    model: &str,
    at: i64,
    tokens: Tokens,
    revision: u64,
) -> Metric {
    let mut event = Metric {
        origin: None,
        id: hash(id),
        device: environment.id.clone(),
        source: instance.software.clone(),
        session: label(session),
        model: label(if model.is_empty() {
            "未知模型"
        } else {
            model
        }),
        agent: "主 Agent".into(),
        tool: String::new(),
        timestamp: at,
        kind: "tokens".into(),
        tokens,
        channel: String::new(),
        revision,
        harness_identity: 0,
        codex_usage_version: 0,
        multica: false,
        speed: None,
    };
    decorate(&mut event, instance, environment, &instance.format);
    event
}
fn tool(
    instance: &Instance,
    environment: &Environment,
    id: &str,
    session: &str,
    model: &str,
    at: i64,
    name: &str,
) -> Metric {
    let mut event = make(
        instance,
        environment,
        &format!("tool:{id}"),
        session,
        model,
        at,
        Tokens::default(),
        0,
    );
    event.kind = "tool".into();
    event.tool = label(name);
    event
}

/// Stateless projection is shared with remote collectors after source-side
/// whitelisting; its output is the same canonical ledger event.
pub fn parse_line(
    row: &Value,
    c: &mut ReaderCursor,
    instance: &Instance,
    environment: &Environment,
) -> Result<Vec<Metric>, String> {
    if instance.format == "codex-jsonl" {
        return Ok(activity::parse_codex(row, &mut c.codex, &environment.id)
            .map(|mut e| {
                decorate(&mut e, instance, environment, "codex-jsonl");
                e
            })
            .into_iter()
            .collect());
    }
    if instance.format == "kimi-wire" {
        return parse_kimi(row, c, instance, environment);
    }
    if instance.format == "gemini-session" {
        return parse_gemini_line(row, c, instance, environment);
    }
    let mut events = Vec::new();
    if let Some(session) = text(row, "sessionId").or_else(|| text(row, "session_id")) {
        c.session = label(session);
    }
    if text(row, "type") == Some("session_meta") {
        return Ok(events);
    }
    if text(row, "type") != Some("assistant") {
        return Ok(events);
    }
    let Some(message) = row.get("message") else {
        return Ok(events);
    };
    let at = row
        .get("timestamp")
        .and_then(timestamp)
        .ok_or("助手记录缺少有效时间，未采集")?;
    let model = text(message, "model").unwrap_or("未知模型");
    if let Some(usage) = message.get("usage").filter(|v| !v.is_null()) {
        // Native message IDs survive transcript copies and block notifications.
        let id = text(message, "id").ok_or("用量缺少原始消息 ID，无法可靠去重")?;
        if c.session.is_empty() {
            return Err("用量缺少会话标识，未采集".into());
        }
        let mut event = make(
            instance,
            environment,
            &format!("anthropic:tokens:{id}"),
            &c.session,
            model,
            at,
            anthropic_usage(usage)?,
            at.max(0) as u64,
        );
        if let Some(origin) = &mut event.origin {
            origin.cache_known = usage.get("cache_read_input_tokens").is_some()
                && usage.get("cache_creation_input_tokens").is_some();
        }
        if text(row, "cwd").is_some_and(|cwd| {
            c.multica_roots
                .iter()
                .any(|root| Path::new(cwd).starts_with(root))
        }) {
            if let Some(origin) = &mut event.origin {
                origin.launcher = "multica".into();
                origin.evidence = "native".into();
            }
        }
        if let Some(source) = text(row, "access").filter(|s| matches!(*s, "builtin" | "api")) {
            if let Some(origin) = &mut event.origin {
                origin.access = source.into();
                origin.evidence = "native".into();
            }
        }
        events.push(event);
    }
    if let Some(parts) = message.get("content").and_then(Value::as_array) {
        for part in parts {
            if text(part, "type") == Some("tool_use") {
                if let (Some(id), Some(name)) = (text(part, "id"), text(part, "name")) {
                    events.push(tool(
                        instance,
                        environment,
                        &format!("anthropic:{id}"),
                        &c.session,
                        model,
                        at,
                        name,
                    ));
                }
            }
        }
    }
    for event in &mut events {
        if let Some(origin) = &mut event.origin {
            if let Some(access) = text(row, "access").filter(|s| matches!(*s, "builtin" | "api")) {
                origin.access = access.into();
                origin.evidence = "native".into();
            }
            if text(row, "cwd").is_some_and(|cwd| {
                c.multica_roots
                    .iter()
                    .any(|root| Path::new(cwd).starts_with(root))
            }) {
                origin.launcher = "multica".into();
                origin.evidence = "native".into();
            }
        }
    }
    Ok(events)
}
fn gemini_message(
    row: &Value,
    c: &ReaderCursor,
    instance: &Instance,
    environment: &Environment,
    revision: u64,
) -> Result<Vec<Metric>, String> {
    if text(row, "type") != Some("gemini") {
        return Ok(vec![]);
    }
    let mut events = Vec::new();
    let model = text(row, "model").unwrap_or("未知模型");
    let at = row
        .get("timestamp")
        .and_then(timestamp)
        .ok_or("Gemini 记录缺少有效时间")?;
    if let Some(usage) = row.get("tokens").filter(|u| !u.is_null()) {
        let id = text(row, "id").ok_or("Gemini 用量缺少消息 ID")?;
        if c.session.is_empty() {
            return Err("Gemini 用量缺少会话 ID".into());
        }
        let tool_input = count(usage, "tool", false)?;
        let thought = count(usage, "thoughts", false)?;
        let input = count(usage, "input", true)?
            .checked_add(tool_input)
            .ok_or("Gemini 输入溢出")?;
        let output = count(usage, "output", true)?
            .checked_add(thought)
            .ok_or("Gemini 输出溢出")?;
        let tokens = checked(Tokens {
            input,
            output,
            cached: count(usage, "cached", true)?,
            reasoning: thought,
            cache_write: 0,
            total: count(usage, "total", true)?,
        })?;
        events.push(make(
            instance,
            environment,
            &format!("gemini:tokens:{id}"),
            &c.session,
            model,
            at,
            tokens,
            revision.max(at.max(0) as u64),
        ));
    }
    if let Some(calls) = row.get("toolCalls").and_then(Value::as_array) {
        for call in calls {
            if let (Some(id), Some(name)) = (text(call, "id"), text(call, "name")) {
                events.push(tool(
                    instance,
                    environment,
                    &format!("gemini:{id}"),
                    &c.session,
                    model,
                    at,
                    name,
                ));
            }
        }
    }
    Ok(events)
}
fn parse_gemini_line(
    row: &Value,
    c: &mut ReaderCursor,
    instance: &Instance,
    environment: &Environment,
) -> Result<Vec<Metric>, String> {
    if let Some(session) = text(row, "sessionId") {
        c.session = label(session);
    }
    if let Some(set) = row.get("$set") {
        if let Some(session) = text(set, "sessionId") {
            c.session = label(session);
        }
        if let Some(messages) = set.get("messages").and_then(Value::as_array) {
            let revision = set
                .get("lastUpdated")
                .and_then(timestamp)
                .unwrap_or(0)
                .max(0) as u64;
            let mut events = vec![];
            for message in messages {
                events.extend(gemini_message(message, c, instance, environment, revision)?);
            }
            return Ok(events);
        }
    }
    // Rewinds remove context, not already-consumed model usage. Content-only
    // patches are deliberately ignored; they are not additional requests.
    gemini_message(row, c, instance, environment, 0)
}
fn parse_kimi(
    row: &Value,
    c: &mut ReaderCursor,
    instance: &Instance,
    environment: &Environment,
) -> Result<Vec<Metric>, String> {
    if let Some(model) = text(row, "model") {
        c.model = label(model);
    }
    let Some(message) = row.get("message") else {
        return Ok(vec![]);
    };
    let kind = text(message, "type").unwrap_or("");
    let p = message.get("payload").unwrap_or(&Value::Null);
    let at = row
        .get("timestamp")
        .and_then(Value::as_f64)
        .filter(|n| n.is_finite() && *n > 0.0)
        .map(|n| (n * 1000.0) as i64)
        .ok_or("Kimi 用量缺少有效时间")?;
    match kind {
        "TurnBegin" => {
            c.turn = at;
            c.step = 0;
            c.attempt = 0;
        }
        "StepBegin" => {
            c.step = p.get("n").and_then(Value::as_u64).unwrap_or(0);
            c.attempt = 0;
        }
        "StepRetry" => {
            c.attempt = p
                .get("next_attempt")
                .and_then(Value::as_u64)
                .unwrap_or(c.attempt + 1);
        }
        "StatusUpdate" => {
            let Some(usage) = p.get("token_usage").filter(|u| !u.is_null()) else {
                return Ok(vec![]);
            };
            if let Some(model) = text(p, "model") {
                c.model = label(model);
            }
            let cached = count(usage, "input_cache_read", false)?;
            let write = count(usage, "input_cache_creation", false)?;
            let input = count(usage, "input_other", true)?
                .checked_add(cached)
                .and_then(|n| n.checked_add(write))
                .ok_or("Kimi 输入溢出")?;
            let output = count(usage, "output", true)?;
            let tokens = checked(Tokens {
                input,
                cached,
                cache_write: write,
                output,
                reasoning: 0,
                total: input.checked_add(output).ok_or("Kimi 总量溢出")?,
            })?;
            if c.session.is_empty() {
                return Err("Kimi 用量缺少会话标识".into());
            }
            let key = if let Some(id) = text(p, "message_id") {
                format!("kimi:tokens:{id}")
            } else if c.turn > 0 && c.step > 0 {
                format!(
                    "kimi:tokens:{}:{}:{}:{}",
                    c.session, c.turn, c.step, c.attempt
                )
            } else {
                return Err("Kimi 用量缺少步骤或消息标识，未猜测去重".into());
            };
            return Ok(vec![make(
                instance,
                environment,
                &key,
                &c.session,
                &c.model,
                at,
                tokens,
                at.max(0) as u64,
            )]);
        }
        _ => {}
    }
    Ok(vec![])
}
fn json_file(
    value: &Value,
    instance: &Instance,
    environment: &Environment,
) -> Result<Vec<Metric>, String> {
    if instance.format != "gemini-session" {
        return Err("此来源需要 JSONL 用量流或官方 CSV，未猜测 JSON 格式".into());
    }
    let session = text(value, "sessionId").ok_or("Gemini 会话缺少 sessionId")?;
    let messages = value
        .get("messages")
        .and_then(Value::as_array)
        .ok_or("Gemini 会话缺少 messages")?;
    let c = ReaderCursor {
        session: label(session),
        ..Default::default()
    };
    let revision = value
        .get("lastUpdated")
        .and_then(timestamp)
        .unwrap_or(0)
        .max(0) as u64;
    let mut events = Vec::new();
    for row in messages {
        events.extend(gemini_message(row, &c, instance, environment, revision)?);
    }
    Ok(events)
}

pub fn csv_rows(input: &str) -> Result<Vec<Vec<String>>, String> {
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut value = String::new();
    let mut quoted = false;
    let mut chars = input.trim_start_matches('\u{feff}').chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' if quoted && chars.peek() == Some(&'"') => {
                value.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ',' if !quoted => row.push(std::mem::take(&mut value)),
            '\n' if !quoted => {
                row.push(std::mem::take(&mut value));
                if row.iter().any(|s| !s.is_empty()) {
                    rows.push(std::mem::take(&mut row));
                } else {
                    row.clear();
                }
            }
            '\r' if !quoted => {}
            _ => value.push(ch),
        }
    }
    if quoted {
        return Err("CSV 末尾仍在引号中，等待导出完成".into());
    }
    if !value.is_empty() || !row.is_empty() {
        row.push(value);
        rows.push(row);
    }
    Ok(rows)
}
pub fn cursor_csv(
    input: &str,
    instance: &Instance,
    environment: &Environment,
) -> Result<Vec<Metric>, String> {
    let rows = csv_rows(input)?;
    let header = rows.first().ok_or("CSV 为空")?;
    let column = |names: &[&str]| {
        header
            .iter()
            .position(|h| names.iter().any(|n| h.trim().eq_ignore_ascii_case(n)))
    };
    let date = column(&["Date", "Timestamp"]).ok_or("Cursor CSV 缺少 Date")?;
    let model = column(&["Model"]).ok_or("Cursor CSV 缺少 Model")?;
    let total = column(&["Total Tokens", "Total tokens"])
        .ok_or("Cursor CSV 缺少 Total Tokens，未使用费用或 Credits 估算")?;
    let output = column(&["Output Tokens", "Output"]).ok_or("Cursor CSV 缺少 Output Tokens")?;
    let cached = column(&["Cache Read Tokens", "Cache Read"]);
    let write = column(&[
        "Cache Write Tokens",
        "Cache Write",
        "Input (w/ Cache Write)",
    ]);
    let plain = column(&["Input (w/o Cache Write)"]);
    let request = column(&["Request ID", "Request Id"]);
    let kind = column(&["Kind"]);
    let user = column(&["User", "User Email"]);
    let mut events = Vec::new();
    let mut occurrences = std::collections::BTreeMap::<String, usize>::new();
    for row in rows.iter().skip(1) {
        let cell = |n: usize| {
            row.get(n)
                .map(String::as_str)
                .ok_or("CSV 行与表头列数不一致")
        };
        let integer = |n: usize| -> Result<u64, String> {
            cell(n)?
                .trim()
                .parse::<u64>()
                .ok()
                .filter(|n| *n <= 1_000_000_000_000)
                .ok_or_else(|| "CSV Token 必须是完整非负整数".into())
        };
        let at =
            timestamp(&Value::String(cell(date)?.into())).ok_or("CSV 日期应包含完整时间与时区")?;
        let total = integer(total)?;
        let output = integer(output)?;
        let input = total.checked_sub(output).ok_or("CSV 输出超过总量")?;
        let tokens = checked(Tokens {
            input,
            output,
            cached: cached.map(integer).transpose()?.unwrap_or(0),
            cache_write: write.map(integer).transpose()?.unwrap_or(0),
            reasoning: 0,
            total,
        })?;
        if tokens
            .cached
            .checked_add(tokens.cache_write)
            .is_none_or(|n| n > input)
        {
            return Err("CSV 缓存子项超过输入".into());
        }
        if let (Some(plain), Some(_), Some(_)) = (plain, write, cached) {
            if integer(plain)?
                .checked_add(tokens.cached)
                .and_then(|n| n.checked_add(tokens.cache_write))
                != Some(input)
            {
                return Err("CSV 输入子项与 Total Tokens 不一致".into());
            }
        }
        // Export rows without request IDs retain identical-row multiplicity.
        // Overlapping exports deduplicate the same occurrence; filenames and
        // user email are never stored in ledger metadata.
        let fallback = format!(
            "{at}:{}:{input}:{output}:{}:{}:{}:{}",
            cell(model)?,
            tokens.cached,
            tokens.cache_write,
            kind.map(cell).transpose()?.unwrap_or(""),
            user.map(cell).transpose()?.unwrap_or("")
        );
        let ordinal = occurrences.entry(fallback.clone()).or_default();
        *ordinal += 1;
        let native = request
            .map(cell)
            .transpose()?
            .filter(|s| !s.is_empty())
            .map(String::from)
            .unwrap_or_else(|| format!("{}:{}", hash(&fallback), ordinal));
        let mut event = make(
            instance,
            environment,
            &format!("cursor:tokens:{native}"),
            &format!("cursor:{native}"),
            cell(model)?,
            at,
            tokens,
            at.max(0) as u64,
        );
        if let Some(origin) = &mut event.origin {
            origin.cache_known = cached.is_some();
        }
        if let Some(n) = kind {
            if let Some(origin) = &mut event.origin {
                let k = cell(n)?.to_lowercase();
                origin.access = if k.contains("api key") || k == "byok" {
                    "api"
                } else if k.contains("included") || k.contains("usage-based") {
                    "builtin"
                } else {
                    "unknown"
                }
                .into();
            }
        }
        events.push(event);
    }
    Ok(events)
}

fn files(root: &Path, result: &mut Vec<PathBuf>, depth: usize) -> Result<(), String> {
    if depth > 12 || result.len() > MAX_FILES {
        return Err("日志目录超过本轮读取上限".into());
    }
    if root.is_file() {
        result.push(root.into());
        return Ok(());
    }
    for item in fs::read_dir(root).map_err(|_| "无法读取日志目录")? {
        let item = item.map_err(|_| "无法读取部分日志目录项")?;
        let kind = item.file_type().map_err(|_| "无法读取日志状态")?;
        if kind.is_symlink() {
            continue;
        }
        if kind.is_dir() {
            files(&item.path(), result, depth + 1)?;
        } else if kind.is_file()
            && item
                .path()
                .extension()
                .and_then(|s| s.to_str())
                .is_some_and(|s| matches!(s, "jsonl" | "json" | "csv"))
        {
            result.push(item.path());
        }
    }
    Ok(())
}
pub fn collect(
    db: &mut Connection,
    instance: &Instance,
    environment: &Environment,
) -> Result<(usize, SourceStatus), String> {
    collect_with_roots(db, instance, environment, &[])
}
pub fn collect_with_roots(
    db: &mut Connection,
    instance: &Instance,
    environment: &Environment,
    multica_roots: &[PathBuf],
) -> Result<(usize, SourceStatus), String> {
    let mut status = SourceStatus {
        instance: instance.id.clone(),
        state: "disabled".into(),
        ..Default::default()
    };
    if !instance.enabled || !environment.included {
        return Ok((0, status));
    }
    if instance.root.is_empty() {
        status.state = "needs-path".into();
        status.message = "选择日志或官方用量导出位置后开始记录".into();
        return Ok((0, status));
    }
    let root = Path::new(&instance.root);
    if !root.exists() {
        status.state = "not-found".into();
        status.message = "尚未检测到本机记录".into();
        return Ok((0, status));
    }
    if matches!(instance.format.as_str(), "harness" | "zcode") {
        let mut event = make(
            instance,
            environment,
            "context",
            "context",
            "",
            1,
            Tokens::default(),
            0,
        );
        let origin = event.origin.take().expect("decorated");
        let mut changed = 0;
        let mut errors = Vec::new();
        if instance.format == "harness" {
            activity::harness::collect_configured(
                db,
                root,
                &environment.id,
                &mut changed,
                &mut errors,
                origin,
            );
        } else {
            let paths = if root.is_file() {
                vec![root.to_path_buf()]
            } else {
                vec![
                    root.join("v2/tasks-index.sqlite"),
                    root.join("cli/db/db.sqlite"),
                ]
            };
            for path in &paths {
                match activity::collect_zcode_origin(db, path, &environment.id, origin.clone()) {
                    Ok(n) => changed += n,
                    Err(e) => errors.push(e),
                }
            }
            match activity::reconcile_zcode_legacy(db, &paths) {
                Ok(n) => changed += n,
                Err(e) => errors.push(e),
            }
        }
        let records=db.query_row("SELECT COUNT(*) FROM metrics WHERE json_extract(body,'$.device')=?1 AND json_extract(body,'$.source')=?2 AND json_extract(body,'$.kind')='tokens'",params![environment.id,instance.software],|r|r.get::<_,i64>(0)).unwrap_or(0).max(0) as usize;
        status.state = if !errors.is_empty() {
            "partial"
        } else if records > 0 {
            "ready"
        } else {
            "no-usage"
        }
        .into();
        status.records = records;
        status.at = Some(activity::now());
        status.message = errors.join("；");
        return Ok((changed, status));
    }
    let mut paths = vec![];
    if instance.format == "codex-jsonl"
        && root.is_dir()
        && ["sessions", "archived_sessions"]
            .iter()
            .any(|n| root.join(n).is_dir())
    {
        for name in ["sessions", "archived_sessions"] {
            if root.join(name).is_dir() {
                files(&root.join(name), &mut paths, 0)?;
            }
        }
    } else {
        files(root, &mut paths, 0)?;
    }
    paths.sort();
    paths.retain(|p| match instance.format.as_str() {
        "kimi-wire" => p.file_name().is_some_and(|n| n == "wire.jsonl"),
        "cursor-csv" => p.extension().is_some_and(|x| x == "csv"),
        "gemini-session" => p.file_name().and_then(|n| n.to_str()).is_some_and(|n| {
            n.starts_with("session-") && (n.ends_with(".json") || n.ends_with(".jsonl"))
        }),
        _ => p.extension().is_some_and(|x| x == "jsonl"),
    });
    let mut changed = 0;
    let mut failures = vec![];
    for path in &paths {
        match collect_file(db, path, instance, environment, multica_roots) {
            Ok((n, observed)) => {
                changed += n;
                status.records += observed;
                status.files += 1;
            }
            Err(error) => failures.push(error),
        }
    }
    status.at = Some(activity::now());
    status.state = if !failures.is_empty() {
        "partial"
    } else if paths.is_empty() {
        "not-found"
    } else if status.records == 0 {
        "no-usage"
    } else {
        "ready"
    }
    .into();
    status.message = if !failures.is_empty() {
        format!("{} 个文件未完成；{}", failures.len(), failures[0])
    } else if status.state == "no-usage" {
        "已发现会话；本版本日志尚未提供可核实的 Token，未按文本长度估算".into()
    } else {
        String::new()
    };
    Ok((changed, status))
}
fn collect_file(
    db: &mut Connection,
    path: &Path,
    instance: &Instance,
    environment: &Environment,
    multica_roots: &[PathBuf],
) -> Result<(usize, usize), String> {
    let key = format!("source:{}:{}", instance.id, hash(&path.to_string_lossy()));
    let old: Option<String> = db
        .query_row("SELECT body FROM cursors WHERE path=?1", [&key], |r| {
            r.get(0)
        })
        .optional()
        .map_err(|_| "读取来源进度失败")?;
    let mut c: ReaderCursor = old
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    let context = context_digest(instance, environment, multica_roots);
    if c.context_digest != context {
        c = Default::default();
    }
    c.context_digest = context.clone();
    let metadata = fs::metadata(path).map_err(|_| "日志暂不可读")?;
    if metadata.len() > MAX_FILE {
        return Err("单份日志超过 256 MiB，原文件未改动".into());
    }
    let stamp = format!("{}:{:?}", metadata.len(), metadata.modified().ok());
    let jsonl = path.extension().is_some_and(|x| x == "jsonl");
    let mut input = fs::File::open(path).map_err(|_| "日志暂不可读")?;
    if !jsonl {
        let mut bytes = Vec::new();
        input
            .take(MAX_FILE + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "读取日志失败")?;
        let fingerprint = hash(std::str::from_utf8(&bytes).map_err(|_| "日志不是 UTF-8")?);
        if c.fingerprint == fingerprint {
            return Ok((0, c.observed));
        }
        let events = if instance.format == "cursor-csv" {
            cursor_csv(
                std::str::from_utf8(&bytes).map_err(|_| "CSV 编码无效")?,
                instance,
                environment,
            )?
        } else {
            json_file(
                &serde_json::from_slice::<Value>(&bytes)
                    .map_err(|_| "会话 JSON 尚未写完或格式不支持")?,
                instance,
                environment,
            )?
        };
        let tx = db.transaction().map_err(|_| "统计资料库忙碌")?;
        let mut changed = 0;
        for e in &events {
            if merge_metric(&tx, e, true)? {
                changed += 1
            }
        }
        c.fingerprint = fingerprint;
        c.stamp = stamp;
        c.offset = metadata.len();
        c.observed = events.iter().filter(|e| e.kind == "tokens").count();
        save(&tx, &key, &c)?;
        tx.commit().map_err(|_| "保存来源进度失败")?;
        return Ok((changed, c.observed));
    }
    if metadata.len() < c.offset || (metadata.len() == c.offset && c.stamp != stamp) {
        c = ReaderCursor::default();
        c.context_digest = context;
    }
    c.multica_roots = multica_roots.to_vec();
    if metadata.len() == c.offset {
        return Ok((0, c.observed));
    }
    if c.session.is_empty() {
        c.session = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .into();
        if instance.format == "kimi-wire" {
            c.session = path
                .parent()
                .and_then(Path::file_name)
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .into();
        }
    }
    input
        .seek(SeekFrom::Start(c.offset))
        .map_err(|_| "读取来源进度失败")?;
    let mut reader = BufReader::new(input);
    let tx = db.transaction().map_err(|_| "统计资料库忙碌")?;
    let mut changed = 0;
    let mut observed = 0;
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = reader
            .read_until(b'\n', &mut line)
            .map_err(|_| "读取日志失败")?;
        if n == 0 || line.last() != Some(&b'\n') {
            break;
        }
        if line.len() > MAX_LINE {
            return Err("单行日志超过 32 MiB，未推进进度".into());
        }
        let row: Value =
            serde_json::from_slice(&line).map_err(|_| "日志包含无效 JSON 行，原记录已保留")?;
        for e in parse_line(&row, &mut c, instance, environment)? {
            if e.kind == "tokens" {
                observed += 1;
            }
            if merge_metric(&tx, &e, true)? {
                changed += 1;
            }
        }
        c.offset += n as u64;
    }
    c.stamp = stamp;
    c.observed += observed;
    save(&tx, &key, &c)?;
    tx.commit().map_err(|_| "保存来源进度失败")?;
    Ok((changed, c.observed))
}
fn save(db: &Connection, key: &str, c: &ReaderCursor) -> Result<(), String> {
    db.execute("INSERT INTO cursors(path,body) VALUES(?1,?2) ON CONFLICT(path) DO UPDATE SET body=excluded.body",params![key,serde_json::to_string(c).map_err(|_|"编码来源进度失败")?]).map_err(|_|"保存来源进度失败")?;
    Ok(())
}
