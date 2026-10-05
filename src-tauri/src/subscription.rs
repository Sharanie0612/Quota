//! Read the official Codex login cache on explicit account connection. Never copy tokens to Quota files.
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub label: String,
    pub remaining: f64,
    pub reset_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Subscription {
    pub plan: String,
    pub windows: Vec<UsageWindow>,
}

pub fn parse_usage(value: &Value) -> Result<Subscription, String> {
    let limits = value.get("rate_limit").or_else(|| value.get("rate_limits"))
        .ok_or("暂时无法读取额度，请稍后重试")?;
    let mut windows = Vec::new();
    for key in ["primary_window", "secondary_window"] {
        let Some(w) = limits.get(key).filter(|w| !w.is_null()) else { continue };
        let Some(used) = w.get("used_percent").and_then(Value::as_f64).filter(|v| v.is_finite() && (0.0..=100.0).contains(v)) else { continue };
        let label = match w.get("limit_window_seconds").and_then(Value::as_i64) {
            Some(18000) => "5 小时额度".into(),
            Some(604800) => "每周额度".into(),
            Some(2592000) => "每月额度".into(),
            Some(n) if n > 0 => format!("{} 小时额度", n as f64 / 3600.0),
            _ => if key == "primary_window" { "短期额度".into() } else { "长期额度".into() },
        };
        windows.push(UsageWindow { label, remaining: 100.0 - used, reset_at: w.get("reset_at").and_then(Value::as_i64) });
    }
    if windows.is_empty() { return Err("暂时没有可用额度数据，请稍后重试".into()); }
    Ok(Subscription {
        plan: value.get("plan_type").and_then(Value::as_str).unwrap_or("ChatGPT").to_string(),
        windows,
    })
}

pub async fn fetch(client: &reqwest::Client, expected_account: Option<&str>) -> Result<(Subscription, String), String> {
    let home = std::env::var_os("CODEX_HOME").map(std::path::PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(std::path::PathBuf::from).or_else(dirs::home_dir).map(|p| p.join(".codex"))).ok_or("未找到本机 Codex，请先登录 Codex")?;
    let canonical = home.canonicalize().unwrap_or_else(|_| home.clone());
    let digest = format!("{:x}", Sha256::digest(canonical.to_string_lossy().as_bytes()));
    let entry = keyring::Entry::new("Codex Auth", &format!("cli|{}", &digest[..16]))
        .map_err(|_| "无法读取本机登录，请重试")?;
    let bytes = match entry.get_password() {
        Ok(text) => text.into_bytes(),
        Err(keyring::Error::NoEntry) => std::fs::read(home.join("auth.json"))
            .map_err(|_| "未找到本机登录，请先在 Codex 中用 ChatGPT 登录")?,
        Err(_) => return Err("无法读取系统登录凭据，请重试".into()),
    };
    let auth: Value = serde_json::from_slice(&bytes).map_err(|_| "登录信息不可用，请重新登录 Codex")?;
    let tokens = auth.get("tokens").ok_or("请在 Codex 中选择 ChatGPT 登录")?;
    let token = tokens.get("access_token").and_then(Value::as_str).filter(|s| !s.is_empty()).ok_or("请重新登录 Codex")?;
    let claims = tokens.get("id_token").and_then(Value::as_str).and_then(|t| t.split('.').nth(1))
        .and_then(|p| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(p).ok())
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    let account = tokens.get("account_id").and_then(Value::as_str)
        .or_else(|| claims.as_ref()?.get("https://api.openai.com/auth")?.get("chatgpt_account_id")?.as_str())
        .filter(|s| !s.is_empty()).ok_or("登录信息不完整，请重新登录 Codex")?;
    if expected_account.is_some_and(|id| id != account) { return Err("本机已切换 ChatGPT 账户，请重新连接此账户".into()); }
    let response = client.get("https://chatgpt.com/backend-api/wham/usage")
        .bearer_auth(token).header("ChatGPT-Account-Id", account)
        .header("originator", "codex_cli_rs").header("Accept", "application/json")
        .timeout(std::time::Duration::from_secs(15)).send().await
        .map_err(|_| "连接失败，请检查网络后重试")?;
    if matches!(response.status().as_u16(), 401 | 403) { return Err("登录已过期，请重新登录 Codex 后连接".into()); }
    if !response.status().is_success() { return Err("额度服务暂不可用，请稍后重试".into()); }
    let value: Value = response.json().await.map_err(|_| "暂时无法读取额度，请稍后重试")?;
    Ok((parse_usage(&value)?, account.to_string()))
}
