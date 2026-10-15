//! Official-origin session cookies only. Serialized payloads live solely in OS credentials.
use serde::{Deserialize, Serialize};
use tauri::webview::cookie::{Cookie, time::{Duration, OffsetDateTime}};
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
fn normalized(mut cookie: Cookie<'static>, now: i64) -> Result<Cookie<'static>, String> {
    let domain = cookie.domain().ok_or("小米 Cookie 缺少域名")?.to_ascii_lowercase();
    cookie.set_domain(domain);
    if cookie.path().is_none() { cookie.set_path("/"); }
    // Max-Age is relative to RECEIPT, not each future browser restoration.
    // Persist an absolute Expires so restarts cannot revive a stale cookie.
    if let Some(age) = cookie.max_age() {
        let at = OffsetDateTime::from_unix_timestamp(now).map_err(|_| "小米会话时间无效")?;
        let expires = if age.whole_seconds() <= 0 { OffsetDateTime::UNIX_EPOCH }
            else { at.checked_add(Duration::seconds(age.whole_seconds())).ok_or("小米 Cookie 到期时间无效")? };
        cookie.set_expires(expires);
        cookie.set_max_age(None);
    }
    Ok(cookie)
}
fn alive(cookie: &Cookie<'_>, now: i64) -> bool {
    cookie.expires_datetime().is_none_or(|e| e.unix_timestamp() > now)
}
fn same_key(a: &Cookie<'_>, b: &Cookie<'_>) -> bool {
    a.name() == b.name() && a.domain() == b.domain() && a.path() == b.path()
}
pub fn encode(cookies: Vec<Cookie<'static>>) -> Result<String, String> {
    encode_at(cookies, chrono::Utc::now().timestamp())
}
/// Deterministic clock used by the isolated release example as well as production.
pub fn encode_at(cookies: Vec<Cookie<'static>>, now: i64) -> Result<String, String> {
    let mut unique: Vec<Cookie<'static>> = Vec::new();
    for cookie in cookies.into_iter().filter(valid) {
        let cookie = normalized(cookie, now)?;
        unique.retain(|old| !same_key(old, &cookie));
        if alive(&cookie, now) { unique.push(cookie); }
    }
    let values: Vec<_> = unique.into_iter().map(|c| c.to_string()).collect();
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
    decode_at(payload, chrono::Utc::now().timestamp())
}
pub fn decode_at(payload: &str, now: i64) -> Result<Vec<Cookie<'static>>, String> {
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
            normalized(c, now)
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(cookies.into_iter().filter(|c| alive(c, now)).collect())
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
        let c = normalized(c, chrono::Utc::now().timestamp())?;
        cookies.retain(|old| !same_key(old, &c));
        if alive(&c, chrono::Utc::now().timestamp()) {
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
            d.trim_start_matches('.').to_ascii_lowercase().as_str(),
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
    if !valid(&cookie) {
        return None;
    }
    let cookie = normalized(cookie, chrono::Utc::now().timestamp()).ok()?;
    // Retain other official cookie paths for SSO restoration without putting
    // path-specific cookies in the shared balance request header.
    if !path_matches("/api/v1/balance", cookie.path().unwrap_or("/")) { return Some(cookie.to_string()); }
    let mut values = std::collections::BTreeMap::new();
    for part in header.split(';') {
        if let Some((name, value)) = part.trim().split_once('=') {
            values.insert(name.to_string(), value.to_string());
        }
    }
    let expired = !alive(&cookie, chrono::Utc::now().timestamp());
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
fn path_matches(path: &str, cookie_path: &str) -> bool {
    path == cookie_path || (path.starts_with(cookie_path)
        && (cookie_path.ends_with('/') || path.as_bytes().get(cookie_path.len()) == Some(&b'/')))
}
