//! Read-only Trae metrics adapter. Select only usage metadata, never conversation text.
use super::{hash, label, merge_metric, Metric, Tokens};
use rusqlite::Connection;
use std::path::PathBuf;
pub fn paths(home: &str) -> Vec<PathBuf> {
    if !home.is_empty() {
        let home = PathBuf::from(home);
        return vec![if home.is_file() {
            home
        } else if home.join("database.db").is_file() {
            home.join("database.db")
        } else {
            home.join("ModularData/ai-agent/database.db")
        }];
    }
    let root = dirs::config_dir().unwrap_or_default();
    ["Trae CN", "TRAE SOLO CN", "Trae", "TRAE SOLO"]
        .iter()
        .map(|p| root.join(p).join("ModularData/ai-agent/database.db"))
        .collect()
}
#[path = "activity_trae_cipher.rs"]
pub mod cipher;
pub use cipher::open_source;
/// Model identity for one turn: the name to display and how the turn was obtained.
/// Trae records whether a configuration is its own preset or one the user added.
/// Only those facts are read; endpoint, key and token fields are never stored.
fn identity(info: Option<&serde_json::Value>) -> (String, String) {
    let Some(info) = info.filter(|value| value.is_object()) else {
        return ("未知模型".into(), String::new());
    };
    let text = |key: &str| {
        info.get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
    };
    let name = text("config_name")
        .or_else(|| text("display_model_name"))
        .or_else(|| text("model_name"))
        .unwrap_or("未知模型");
    let preset = info.get("is_preset").and_then(serde_json::Value::as_bool);
    let source = info.get("config_source").and_then(serde_json::Value::as_i64);
    // A user-added configuration is marked as not preset, uses another config source,
    // or necessarily brings its own endpoint or key. Anything else stays undetermined
    // rather than being guessed as a Trae-provided model.
    let own = text("base_url").is_some() || text("ak").is_some() || text("sk").is_some();
    let channel = if preset == Some(false) || source.is_some_and(|value| value != 1) || own {
        "api"
    } else if preset == Some(true) || source == Some(1) {
        "trae"
    } else {
        ""
    };
    (name.into(), channel.into())
}
pub fn collect_source(
    db: &mut Connection,
    source: &Connection,
    device: &str,
) -> Result<usize, String> {
    let columns: Vec<String> = source
        .prepare("PRAGMA table_info(chat_turn)")
        .map_err(|_| "Trae 用量格式暂不支持")?
        .query_map([], |r| r.get(1))
        .map_err(|_| "Trae 用量格式暂不支持")?
        .collect::<Result<_, _>>()
        .map_err(|_| "Trae 用量格式暂不支持")?;
    let id = if columns.iter().any(|s| s == "turn_id") {
        "turn_id"
    } else if columns.iter().any(|s| s == "id") {
        "id"
    } else {
        return Err("Trae 请求编号格式暂不支持".into());
    };
    let updated = if columns.iter().any(|s| s == "updated_at") {
        "COALESCE(updated_at,created_at)"
    } else {
        "created_at"
    };
    let sql=format!("SELECT {id},session_id,created_at,{updated},json_extract(context,'$.token_usage'),json_extract(context,'$.persist_user_message_context.model_info') FROM chat_turn WHERE json_valid(context) AND json_type(context,'$.token_usage')='object'");
    let mut query = source
        .prepare(&sql)
        .map_err(|_| "Trae 用量字段格式暂不支持")?;
    let rows = query
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, f64>(2)?,
                r.get::<_, f64>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|_| "Trae 用量暂时无法读取")?;
    let tx = db.transaction().map_err(|_| "统计资料库忙碌")?;
    let mut count = 0;
    for row in rows {
        let (id, session, created, updated, usage, model_info) =
            row.map_err(|_| "Trae 用量记录格式暂不支持")?;
        let info = model_info
            .as_deref()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok());
        let (model, channel) = identity(info.as_ref());
        let raw: serde_json::Value =
            serde_json::from_str(&usage).map_err(|_| "Trae 用量记录格式暂不支持")?;
        let n = |k: &str| raw.get(k).map_or(Some(0), serde_json::Value::as_u64);
        let input = n("prompt_tokens").ok_or("Trae 输入用量无效")?;
        let output = n("completion_tokens").ok_or("Trae 输出用量无效")?;
        let total = raw
            .get("total_tokens")
            .map_or(input.checked_add(output), serde_json::Value::as_u64)
            .ok_or("Trae 总用量无效")?;
        let cached = n("cache_read_input_tokens").ok_or("Trae 缓存用量无效")?;
        let cache_write = n("cache_creation_input_tokens").ok_or("Trae 缓存用量无效")?;
        let reasoning = n("reasoning_tokens").ok_or("Trae 推理用量无效")?;
        if total == 0 {
            continue;
        }
        if total != input.checked_add(output).ok_or("Trae 用量超出范围")?
            || cached.checked_add(cache_write).is_none_or(|v| v > input)
            || reasoning > output
            || !created.is_finite()
            || !updated.is_finite()
        {
            return Err("Trae 用量口径不明确，未计入此数据库".into());
        }
        let milliseconds = |v: f64| if v < 100_000_000_000.0 { v * 1000.0 } else { v };
        let event = Metric {
            id: hash(&format!("trae:tokens:{session}:{id}")),
            device: device.into(),
            source: "trae".into(),
            session: label(&session),
            model: label(&model),
            agent: "Trae Agent".into(),
            tool: String::new(),
            timestamp: milliseconds(created) as i64,
            kind: "tokens".into(),
            channel,
            revision: milliseconds(updated).max(0.0) as u64,
            tokens: Tokens {
                input,
                output,
                total,
                cached,
                cache_write,
                reasoning,
            },
        };
        if merge_metric(&tx, &event, true)? {
            count += 1;
        }
    }
    tx.commit().map_err(|_| "保存 Trae 用量失败")?;
    Ok(count)
}
pub fn collect(
    db: &mut Connection,
    home: &str,
    device: &str,
    count: &mut usize,
    errors: &mut Vec<String>,
) {
    for path in paths(home) {
        if !path.exists() {
            continue;
        }
        match open_source(&path).and_then(|source| collect_source(db, &source, device)) {
            Ok(n) => *count += n,
            Err(error) => errors.push(error),
        }
    }
}
