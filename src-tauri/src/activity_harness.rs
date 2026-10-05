//! Metrics-only reader for DeepSeek Harness canonical v2-v4 JSONL sessions.
//! Sources: official session-persistence-jsonl and token-meter/usage-projection.
use super::{cursor, hash, label, merge_metric, save_cursor, Cursor, Metric, Tokens};
use std::{collections::BTreeMap, fs, io::{ErrorKind, Read}, path::{Path, PathBuf}};
use rusqlite::Connection;
use serde_json::Value;

const MAX_BYTES: u64 = 256 * 1024 * 1024;

fn generation(name: &str) -> Option<(u32, bool)> {
    let (stem, compressed) = if let Some(s) = name.strip_suffix(".jsonl.zstd") { (s, true) }
        else { (name.strip_suffix(".jsonl")?, false) };
    let version = if stem == "session" { 0 } else { stem.strip_prefix("session.v")?.parse().ok()? };
    Some((version, compressed))
}

fn discover(root: &Path, depth: u8, out: &mut Vec<PathBuf>) -> Result<(), String> {
    if depth > 12 { return Ok(()); }
    let items = fs::read_dir(root).map_err(|_| "Harness 日志目录无法读取，请检查日志位置".to_string())?;
    let mut best: Option<(u32, bool, PathBuf)> = None;
    let mut children = Vec::new();
    for item in items {
        let item = item.map_err(|_| "部分 Harness 日志无法读取".to_string())?;
        let kind = item.file_type().map_err(|_| "部分 Harness 日志无法读取".to_string())?;
        if kind.is_symlink() { continue; }
        if kind.is_dir() { children.push(item.path()); }
        else if let Some((version, compressed)) = generation(&item.file_name().to_string_lossy()) {
            if best.as_ref().is_some_and(|(old, encoding, _)| *old == version && *encoding != compressed) {
                return Err("Harness 同一会话包含混合编码，请选择单一持久化目录".into());
            }
            if best.as_ref().is_none_or(|(old, _, _)| version > *old) { best = Some((version, compressed, item.path())); }
        }
    }
    if let Some((_, _, path)) = best { out.push(path); }
    for child in children { discover(&child, depth + 1, out)?; }
    Ok(())
}

fn read_log(path: &Path, compressed: bool) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|_| "Harness 会话暂时无法读取")?;
    if file.metadata().map_err(|_| "Harness 会话暂时无法读取")?.len() > MAX_BYTES {
        return Err("Harness 会话超过 256 MB，暂未采集此会话".into());
    }
    let mut reader: Box<dyn Read> = if compressed {
        let mut decoder = zstd::stream::read::Decoder::new(file).map_err(|_| "Harness 压缩日志损坏")?;
        decoder.window_log_max(27).map_err(|_| "Harness 压缩日志无法读取")?;
        Box::new(decoder)
    } else { Box::new(file) };
    let mut bytes = Vec::new();
    let result = reader.by_ref().take(MAX_BYTES + 1).read_to_end(&mut bytes);
    if bytes.len() as u64 > MAX_BYTES { return Err("Harness 解压内容超过 256 MB，暂未采集此会话".into()); }
    // An incomplete last frame is a live/crash tail; complete decoded lines remain usable.
    if let Err(error) = result {
        if !compressed || error.kind() != ErrorKind::UnexpectedEof { return Err("Harness 日志损坏，未采集此会话".into()); }
    }
    Ok(bytes)
}

fn usage(value: &Value) -> Option<Tokens> {
    let count = |key: &str| value.get(key).map_or(Some(0), Value::as_u64);
    let uncached = value.get("inputTokens")?.as_u64()?;
    let output = value.get("outputTokens")?.as_u64()?;
    let cached = count("cacheReadTokens")?; let cache_write = count("cacheWriteTokens")?;
    let reasoning = count("reasoningTokens")?;
    let known_input = uncached.checked_add(cached)?.checked_add(cache_write)?;
    let total = value.get("totalTokens").map(Value::as_u64).unwrap_or_else(|| known_input.checked_add(output))?;
    if total < known_input.checked_add(output)? || reasoning > output { return None; }
    if value.get("cacheReadTokens").is_some() && value.get("cacheWriteTokens").is_some() && total != known_input.checked_add(output)? { return None; }
    // When optional cache buckets are absent, an authoritative total still supplies aggregate input.
    Some(Tokens { input: total.checked_sub(output)?, output, total, cached, cache_write, reasoning })
}

fn stream_usage(data: &Value) -> Option<&Value> {
    data.get("stream")?.as_array()?.iter().rev().find_map(|record| {
        let chunk = record.get("chunk").unwrap_or(record);
        (chunk.get("type")?.as_str()? == "usage").then(|| chunk.get("usage")).flatten()
    })
}

/// Reads only metadata/usage into Metric; conversation and tool arguments never enter storage.
pub(super) fn parse(bytes: &[u8], version: u32, device: &str) -> Result<Vec<Metric>, String> {
    if !(2..=4).contains(&version) { return Err("Harness 会话版本暂不支持（支持 v2–v4），未采集此会话".into()); }
    let mut rows = Vec::new();
    for raw in bytes.split_inclusive(|b| *b == b'\n') {
        if raw.last() != Some(&b'\n') { break; }
        if raw.len() > 32 * 1024 * 1024 { return Err("Harness 单条记录过大，未采集此会话".into()); }
        rows.push(serde_json::from_slice::<Value>(raw).map_err(|_| "Harness JSONL 记录损坏，未采集此会话")?);
    }
    let header = rows.first().ok_or("Harness 会话缺少完整头记录")?;
    let session = header.get("id").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("Harness 会话头记录无效")?;
    if header.get("type").and_then(Value::as_str) != Some("session") || header.get("version").and_then(Value::as_u64) != Some(version as u64) { return Err("Harness 会话版本与文件名不一致".into()); }
    let seeded = header.get("isSeeded").and_then(Value::as_bool).ok_or("Harness 会话缺少继承标识")?;
    let cut = if seeded {
        rows.iter().rposition(|v| v.get("type").and_then(Value::as_str) == Some("session/end-seed") && v.pointer("/data/inherited").and_then(Value::as_bool) == Some(true)).ok_or("Harness 分叉会话缺少继承边界，未采集此会话")? + 1
    } else { header.get("seedLength").and_then(Value::as_u64).unwrap_or(0) as usize + 1 };
    let agent = label(header.get("agentPreset").and_then(Value::as_str).unwrap_or(if header.get("origin").and_then(Value::as_str) == Some("subagent") { "子 Agent" } else { "主 Agent" }));
    let mut model = "未知模型".to_string(); let mut metrics = BTreeMap::new();
    let mut attempt = 0u64; let mut last_slot: Option<(u64,u64,u64)> = None;
    let mut last_seq = None;
    for (index, event) in rows.iter().enumerate().skip(1) {
        let seq = event.get("seq").and_then(Value::as_u64).ok_or("Harness 会话序号无效")?;
        if last_seq.is_some_and(|old| seq <= old) { return Err("Harness 会话序号重复或乱序，未采集此会话".into()); } last_seq = Some(seq);
        let kind = event.get("type").and_then(Value::as_str).unwrap_or("");
        let data = event.get("data").ok_or("Harness 会话记录缺少数据")?;
        if kind == "request/context" { model = label(data.get("model").and_then(Value::as_str).unwrap_or("未知模型")); }
        if kind == "request/header" { if let Some(name) = data.pointer("/header/config/model").and_then(Value::as_str) { model = label(name); } }
        if index < cut { continue; }
        if kind == "llm/retry-started" { attempt = seq; last_slot = None; continue; }
        let timestamp = event.get("time").and_then(Value::as_i64).ok_or("Harness 会话时间无效")?;
        if matches!(kind, "assistant/message" | "assistant/attempt") {
            let Some(tokens) = data.get("usage").or_else(|| stream_usage(data)).and_then(usage) else { continue; };
            let turn = data.get("turn").and_then(Value::as_u64).ok_or("Harness 请求编号无效")?;
            let step = data.get("step").and_then(Value::as_u64).ok_or("Harness 请求编号无效")?;
            let slot = match last_slot { Some((t,s,a)) if t == turn && s == step => (turn,step,a), _ => (turn,step,attempt) };
            last_slot = Some(slot);
            let route = data.pointer("/message/source/model").and_then(Value::as_str).map(label).unwrap_or_else(|| model.clone());
            let id = hash(&format!("harness:tokens:{session}:{turn}:{step}:{}",slot.2));
            metrics.insert(id.clone(), Metric { id, device:device.into(), source:"harness".into(), session:label(session), model:route, agent:agent.clone(), tool:String::new(), timestamp, kind:"tokens".into(), tokens, revision:seq });
        } else if kind == "tool/call" {
            let call = data.get("callId").and_then(Value::as_str).ok_or("Harness 工具编号无效")?;
            let id = hash(&format!("harness:tool:{session}:{call}"));
            metrics.insert(id.clone(), Metric { id, device:device.into(), source:"harness".into(), session:label(session), model:model.clone(), agent:agent.clone(), tool:label(data.get("name").and_then(Value::as_str).unwrap_or("未知工具")), timestamp, kind:"tool".into(), tokens:Tokens::default(), revision:seq });
        }
    }
    Ok(metrics.into_values().collect())
}

fn collect_file(db: &mut Connection, path: &Path, device: &str) -> Result<usize, String> {
    let (version, compressed) = generation(&path.file_name().unwrap_or_default().to_string_lossy()).ok_or("Harness 文件名无效")?;
    let meta = fs::metadata(path).map_err(|_| "Harness 会话暂时无法读取")?;
    let modified = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|t| t.as_nanos().to_string()).unwrap_or_default();
    let key = format!("harness:{}",path.to_string_lossy()); let previous = cursor(db,&key)?;
    if previous.offset == meta.len() && previous.model == modified { return Ok(0); }
    let bytes = read_log(path, compressed)?; let events = parse(&bytes,version,device)?;
    let tx = db.transaction().map_err(|_| "统计资料库忙碌")?; let mut count = 0;
    for event in events { if merge_metric(&tx,&event,true)? { count += 1; } }
    save_cursor(&tx,&key,&Cursor { offset:meta.len(), model:modified, ..Cursor::default() })?;
    tx.commit().map_err(|_| "保存 Harness 统计失败")?; Ok(count)
}

pub(super) fn collect(db: &mut Connection, root: &Path, device: &str, count: &mut usize, errors: &mut Vec<String>) {
    let mut paths = Vec::new();
    if let Err(error) = discover(root,0,&mut paths) { errors.push(error); return; }
    paths.sort(); let mut failures = 0;
    for path in paths { match collect_file(db,&path,device) { Ok(n) => *count += n, Err(error) => { if failures < 3 { errors.push(error); } failures += 1; } } }
    if failures > 3 { errors.push(format!("另有 {} 个 Harness 会话未采集",failures-3)); }
}
