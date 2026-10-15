//! Official-origin session cookies only. Serialized payloads live solely in OS credentials.
use serde::{Deserialize, Serialize};
use tauri::webview::cookie::Cookie;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Session {
    schema: u32,
    cookies: Vec<String>,
}
fn official_domain(domain: &str) -> bool {
    let d = domain.trim_start_matches('.').to_ascii_lowercase();
    d == "platform.xiaomimimo.com"
        || d == "xiaomimimo.com"
        || d == "xiaomi.com"
        || d == "account.xiaomi.com"
        || d.ends_with(".account.xiaomi.com")
}
fn valid(cookie: &Cookie<'_>) -> bool {
    cookie.domain().is_some_and(official_domain)
        && !cookie.name().is_empty()
        && !cookie
            .name()
            .chars()
            .any(|c| c.is_control() || c == ';' || c == '=')
        && !cookie.value().chars().any(char::is_control)
        && cookie
            .path()
            .is_none_or(|p| p.starts_with('/') && !p.chars().any(char::is_control))
}
pub fn encode(cookies: Vec<Cookie<'static>>) -> Result<String, String> {
    let values: Vec<_> = cookies
        .into_iter()
        .filter(valid)
        .filter(|c| {
            c.expires_datetime()
                .is_none_or(|e| e.unix_timestamp() > chrono::Utc::now().timestamp())
        })
        .map(|c| c.to_string())
        .collect();
    if values.len() > 256 {
        return Err("小米会话 Cookie 过多".into());
    }
    let payload = serde_json::to_string(&Session {
        schema: 1,
        cookies: values,
    })
    .map_err(|_| "小米会话编码失败")?;
    if payload.len() > 65536 {
        return Err("小米会话过大".into());
    }
    Ok(payload)
}
pub fn decode(payload: &str) -> Result<Vec<Cookie<'static>>, String> {
    if payload.len() > 65536 {
        return Err("小米会话过大".into());
    }
    let session: Session = serde_json::from_str(payload).map_err(|_| "小米会话格式无效")?;
    if session.schema != 1 || session.cookies.len() > 256 {
        return Err("小米会话格式无效".into());
    }
    let cookies = session
        .cookies
        .into_iter()
        .map(|raw| {
            let c = Cookie::parse(raw)
                .map_err(|_| "小米会话 Cookie 无效")?
                .into_owned();
            if !valid(&c) {
                return Err("小米会话包含非官方 Cookie".into());
            }
            Ok(c)
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(cookies
        .into_iter()
        .filter(|c| {
            c.expires_datetime()
                .is_none_or(|e| e.unix_timestamp() > chrono::Utc::now().timestamp())
        })
        .collect())
}
/// Apply official Set-Cookie attributes to the saved SSO session, keyed by name/domain/path.
pub fn update(payload: Option<&str>, updates: &[String]) -> Result<String, String> {
    let mut cookies = match payload {
        Some(p) => decode(p)?,
        None => vec![],
    };
    for raw in updates {
        let c = Cookie::parse(raw.clone())
            .map_err(|_| "小米更新的 Cookie 无效")?
            .into_owned();
        if !valid(&c) {
            return Err("小米更新的 Cookie 来源无效".into());
        }
        cookies.retain(|old| {
            !(old.name() == c.name() && old.domain() == c.domain() && old.path() == c.path())
        });
        if c.max_age().is_none_or(|a| a.whole_seconds() > 0) {
            cookies.push(c);
        }
    }
    encode(cookies)
}
/// Return an updated query header and retained attributes. Never accept a foreign domain.
pub fn merge_header(header: &mut String, raw: &str) -> Option<String> {
    let mut cookie = Cookie::parse(raw.to_string()).ok()?.into_owned();
    if cookie.domain().is_some_and(|d| {
        !matches!(
            d.trim_start_matches('.'),
            "platform.xiaomimimo.com" | "xiaomimimo.com"
        )
    }) {
        return None;
    }
    if cookie.domain().is_none() {
        cookie.set_domain("platform.xiaomimimo.com");
    }
    if cookie.path().is_none() {
        cookie.set_path("/");
    }
    if !valid(&cookie) || !"/api/v1/balance".starts_with(cookie.path().unwrap_or("/")) {
        return None;
    }
    let mut values = std::collections::BTreeMap::new();
    for part in header.split(';') {
        if let Some((name, value)) = part.trim().split_once('=') {
            values.insert(name.to_string(), value.to_string());
        }
    }
    let expired = cookie.max_age().is_some_and(|a| a.whole_seconds() <= 0)
        || cookie
            .expires_datetime()
            .is_some_and(|e| e.unix_timestamp() <= chrono::Utc::now().timestamp());
    if expired {
        values.remove(cookie.name());
    } else {
        values.insert(cookie.name().into(), cookie.value().into());
    }
    *header = values
        .into_iter()
        .map(|(n, v)| format!("{n}={v}"))
        .collect::<Vec<_>>()
        .join("; ");
    Some(cookie.to_string())
}
