//! 校验和保存账户配置，处理凭据关联、删除与本机状态清理。

use crate::{
    model::{Account, AccountInput},
    providers, secrets, AppState,
};
use chrono::Local;
use uuid::Uuid;

fn trimmed(value: &Option<String>) -> Option<String> {
    value
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
}

pub async fn save(state: &AppState, input: AccountInput) -> Result<String, String> {
    state.store.ensure_config_writable()?;
    let provider = providers::find(&input.provider)
        .ok_or_else(|| format!("未知供应商：{}", input.provider))?;
    input.validate_numbers()?;
    let base_url = trimmed(&input.base_url);
    if base_url.is_none()
        && provider.default_base_url.trim().is_empty()
        && !provider.models_path.is_empty()
    {
        return Err(format!(
            "{} 需要填写 Base URL（OpenAI 兼容地址，通常以 /v1 结尾）",
            provider.name
        ));
    }

    let id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    attach_pending_connection(state, &input, &id).await?;
    {
        let mut config = state
            .config
            .lock()
            .map_err(|_| "配置锁定失败".to_string())?;
        state.store.update_config(&mut config, |next| {
            let existing = next.accounts.iter_mut().find(|account| account.id == id);
            let (provider_id, created_at) = match existing.as_deref() {
                Some(account) => (account.provider.clone(), account.created_at.clone()),
                None => (input.provider.clone(), Local::now().to_rfc3339()),
            };
            let label = input.label.trim();
            let account = Account {
                id: id.clone(),
                provider: provider_id,
                created_at,
                label: if label.is_empty() {
                    provider.name.to_owned()
                } else {
                    label.to_owned()
                },
                base_url,
                recharge_url: trimmed(&input.recharge_url),
                low_balance_threshold: input.low_balance_threshold.unwrap_or(0.0).max(0.0),
                manual_balance: input.manual_balance,
                manual_currency: trimmed(&input.manual_currency),
                manual_recharge_total: input.manual_recharge_total,
                manual_spend_total: input.manual_spend_total,
                manual_recharge_currency: input.manual_recharge_currency.clone(),
                manual_spend_currency: input.manual_spend_currency.clone(),
                note: trimmed(&input.note),
                balance_mode: Some(trimmed(&input.balance_mode).unwrap_or_else(|| "auto".into())),
                custom_url: trimmed(&input.custom_url),
                custom_headers: trimmed(&input.custom_headers),
                custom_json_path: trimmed(&input.custom_json_path),
                custom_currency: trimmed(&input.custom_currency),
                custom_method: trimmed(&input.custom_method),
                custom_body: trimmed(&input.custom_body),
                quota_total: input.quota_total.filter(|amount| *amount > 0.0),
            };
            if let Some(slot) = existing {
                *slot = account;
            } else {
                next.accounts.push(account);
            }
        })?;
    }
    save_credentials(state, &input, &id)?;
    if let Some(connection_id) = &input.connection_id {
        state
            .pending_connections
            .lock()
            .map_err(|_| "连接状态不可用")?
            .remove(connection_id);
        secrets::delete(connection_id)?;
    }
    Ok(id)
}

async fn attach_pending_connection(
    state: &AppState,
    input: &AccountInput,
    id: &str,
) -> Result<(), String> {
    if let Some(connection_id) = &input.connection_id {
        let _mimo_guard = state.mimo_refresh_lock.lock().await;
        let pending = state
            .pending_connections
            .lock()
            .map_err(|_| "连接状态不可用")?;
        if pending.get(connection_id) != Some(&input.provider) {
            return Err("连接已失效，请重新连接".into());
        }
        let staged = secrets::get_secrets(connection_id)?;
        let mut target = secrets::get_secrets(id)?;
        if let Some(cookie) = staged.console_cookie {
            crate::connections::update_mimo_connection(
                state,
                id,
                &cookie,
                staged.mimo_session.as_deref(),
            )?;
            target.console_cookie = Some(cookie);
            target.mimo_session = staged.mimo_session;
        }
        if staged.subscription_account.is_some() {
            target.subscription_account = staged.subscription_account;
        }
        secrets::restore(id, &target)?;
    }
    Ok(())
}

fn save_credentials(state: &AppState, input: &AccountInput, id: &str) -> Result<(), String> {
    if let Some(key) = input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty())
    {
        secrets::set_api_key(id, key)?;
    } else if input.id.is_none() && !secrets::has_api_key(id) {
        // 允许先保存账户、稍后补 Key；查询时会在卡片上提示缺少 Key
        eprintln!("[Quota] 新增账户 {id} 未填写 API Key");
    }

    if let Some(admin_key) = input
        .admin_key
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty())
    {
        secrets::set_admin_key(id, admin_key)?;
    }

    // AccessKey 对：只在两个都填了的时候才写入，避免存下半对
    let ak_id = input
        .access_key_id
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty());
    let ak_secret = input
        .access_key_secret
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty());
    if let (Some(id_part), Some(secret)) = (ak_id, ak_secret) {
        secrets::set_access_key(id, id_part, secret)?;
    }

    // MiMo 控制台 Cookie（浏览器小米账号 SSO 会话），同样只存凭据管理器
    if let Some(cookie) = input
        .console_cookie
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
    {
        crate::connections::update_mimo_cookie(state, id, cookie)?;
    }
    Ok(())
}

pub fn remove(state: &AppState, id: &str) -> Result<(), String> {
    crate::account_sync::remove_account(state, id)?;
    let _ = secrets::delete(id);
    if let Ok(mut map) = state.statuses.lock() {
        map.remove(id);
    }
    if let Ok(mut h) = state.history.lock() {
        h.remove(id);
    }
    Ok(())
}
