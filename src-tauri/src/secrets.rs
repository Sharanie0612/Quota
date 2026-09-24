//! API 凭据存储：写入操作系统凭据管理器（Windows Credential Manager /
//! macOS Keychain / Linux Secret Service），以「服务名 + 账户 id」为键。
//!
//! 一个账户可能有多个密钥（普通 API Key、管理员密钥、云厂商 AccessKey 对），
//! 这里用一个 JSON 对象存进同一条凭据；旧版本存的裸字符串会被当作 API Key 兼容读取。

use serde::{Deserialize, Serialize};

const SERVICE: &str = "Quota";
// legacy compatibility: existing Windows Credential Manager entries use this service.
const LEGACY_SERVICE: &str = "AgentPrice";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SecretBlob {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub api_key: Option<String>,
    /// 管理员/控制台密钥，用于用量、成本等需要更高权限的接口
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub admin_key: Option<String>,
    /// 云平台 AccessKey ID（如阿里云），用于调用云厂商账单接口查余额
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_key_id: Option<String>,
    /// 云平台 AccessKey Secret，与 AccessKey ID 成对出现
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_key_secret: Option<String>,
    /// MiMo 控制台 Cookie（浏览器小米账号 SSO 会话）
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub console_cookie: Option<String>,
}

fn entry(service: &str, account_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(service, account_id).map_err(|e| format!("无法访问系统凭据管理器：{e}"))
}

fn read_service(service: &str, account_id: &str) -> Result<Option<String>, String> {
    match entry(service, account_id)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("读取系统凭据管理器失败：{e}")),
    }
}

fn read_raw(account_id: &str) -> Result<Option<String>, String> {
    if let Some(value) = read_service(SERVICE, account_id)? {
        return Ok(Some(value));
    }
    let Some(legacy) = read_service(LEGACY_SERVICE, account_id)? else {
        return Ok(None);
    };
    // Copy the exact stored value, including the old bare API-key format. Never delete it.
    entry(SERVICE, account_id)?
        .set_password(&legacy)
        .map_err(|e| format!("迁移系统凭据失败，旧凭据仍保留：{e}"))?;
    Ok(Some(legacy))
}

/// 读取账户的全部凭据；不存在时返回空的 blob（不报错）
pub fn get_secrets(account_id: &str) -> Result<SecretBlob, String> {
    match read_raw(account_id)? {
        None => Ok(SecretBlob::default()),
        Some(raw) => match serde_json::from_str::<SecretBlob>(&raw) {
            Ok(blob) => Ok(blob),
            // 兼容旧格式：整串就是 API Key
            Err(_) => Ok(SecretBlob {
                api_key: Some(raw),
                ..Default::default()
            }),
        },
    }
}

fn write(account_id: &str, blob: &SecretBlob) -> Result<(), String> {
    let text = serde_json::to_string(blob).map_err(|e| format!("序列化凭据失败：{e}"))?;
    entry(SERVICE, account_id)?
        .set_password(&text)
        .map_err(|e| format!("写入系统凭据管理器失败：{e}"))
}

pub fn get_api_key(account_id: &str) -> Result<String, String> {
    get_secrets(account_id)?
        .api_key
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| "未找到该账户的 API Key，请在账户设置中填写。".to_string())
}

pub fn has_api_key(account_id: &str) -> bool {
    get_secrets(account_id)
        .map(|b| b.api_key.map(|k| !k.trim().is_empty()).unwrap_or(false))
        .unwrap_or(false)
}

pub fn has_admin_key(account_id: &str) -> bool {
    get_secrets(account_id)
        .map(|b| b.admin_key.map(|k| !k.trim().is_empty()).unwrap_or(false))
        .unwrap_or(false)
}

/// 是否已保存一对完整的云平台 AccessKey（ID 与 Secret 都在）
pub fn has_access_key(account_id: &str) -> bool {
    get_secrets(account_id)
        .map(|b| {
            let id_ok = b
                .access_key_id
                .map(|k| !k.trim().is_empty())
                .unwrap_or(false);
            let secret_ok = b
                .access_key_secret
                .map(|k| !k.trim().is_empty())
                .unwrap_or(false);
            id_ok && secret_ok
        })
        .unwrap_or(false)
}

/// 读取 AccessKey 对；缺任意一个都返回 None
pub fn get_access_key(account_id: &str) -> Option<(String, String)> {
    let blob = get_secrets(account_id).ok()?;
    let id = blob.access_key_id.filter(|k| !k.trim().is_empty())?;
    let secret = blob.access_key_secret.filter(|k| !k.trim().is_empty())?;
    Some((id, secret))
}

/// 设置（或清除，传空串时）AccessKey 对
pub fn set_access_key(account_id: &str, id: &str, secret: &str) -> Result<(), String> {
    let mut blob = get_secrets(account_id)?;
    let (id, secret) = (id.trim(), secret.trim());
    blob.access_key_id = if id.is_empty() {
        None
    } else {
        Some(id.to_string())
    };
    blob.access_key_secret = if secret.is_empty() {
        None
    } else {
        Some(secret.to_string())
    };
    write(account_id, &blob)
}

pub fn has_console_cookie(account_id: &str) -> bool {
    get_secrets(account_id)
        .map(|b| b.console_cookie.map(|c| !c.trim().is_empty()).unwrap_or(false))
        .unwrap_or(false)
}

pub fn get_console_cookie(account_id: &str) -> Option<String> {
    get_secrets(account_id)
        .ok()?
        .console_cookie
        .filter(|c| !c.trim().is_empty())
}

/// 设置（或清除，传空串时）控制台 Cookie
pub fn set_console_cookie(account_id: &str, value: &str) -> Result<(), String> {
    let mut blob = get_secrets(account_id)?;
    let trimmed = value.trim();
    blob.console_cookie = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    };
    write(account_id, &blob)
}

/// 设置（或清除，传空串时）API Key，不影响管理员密钥
pub fn set_api_key(account_id: &str, value: &str) -> Result<(), String> {
    let mut blob = get_secrets(account_id)?;
    let trimmed = value.trim();
    blob.api_key = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    };
    write(account_id, &blob)
}

/// 设置（或清除，传空串时）管理员密钥
pub fn set_admin_key(account_id: &str, value: &str) -> Result<(), String> {
    let mut blob = get_secrets(account_id)?;
    let trimmed = value.trim();
    blob.admin_key = if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    };
    write(account_id, &blob)
}

pub fn delete(account_id: &str) -> Result<(), String> {
    // An empty new-service entry prevents a deleted account's legacy key from reappearing.
    // The legacy entry is deliberately preserved for rollback.
    write(account_id, &SecretBlob::default())
}
