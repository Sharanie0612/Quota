//! 账户数据、刷新快照与余额历史，由交互和定时任务共用。

mod balance;
mod edit;

pub use balance::apply_manual_balance;
pub use edit::{remove, save};

use crate::{
    model::{Account, AccountStatus, AccountView},
    providers, secrets, AppState,
};

fn effective_status(state: &AppState, account: &Account) -> AccountStatus {
    let mut status = state
        .statuses
        .lock()
        .ok()
        .and_then(|m| m.get(&account.id).cloned())
        .unwrap_or_default();
    apply_manual_balance(account, &mut status);
    status
}

fn is_low(account: &Account, status: &AccountStatus) -> bool {
    let total = status
        .subscription
        .as_ref()
        .and_then(|s| s.windows.iter().map(|w| w.remaining).reduce(f64::min))
        .or_else(|| status.balance.as_ref().and_then(|b| b.total));
    account.low_balance_threshold > 0.0
        && total
            .map(|t| t < account.low_balance_threshold)
            .unwrap_or(false)
}

/// 卡片与托盘使用同一个有效余额和阈值。托盘只需判断有无低余额账户。
pub fn has_low_balance(state: &AppState, account: &Account) -> bool {
    is_low(account, &effective_status(state, account))
}

/// 组装账户视图
pub fn view(state: &AppState, account: &Account) -> AccountView {
    let def = providers::find(&account.provider);
    let status = effective_status(state, account);

    let provider_name = def
        .map(|d| d.name.to_string())
        .unwrap_or_else(|| format!("未知供应商（{}）", account.provider));
    let provider_vendor = def.map(|d| d.vendor.to_string()).unwrap_or_default();
    let provider_region = def.map(|d| d.region.to_string()).unwrap_or_default();
    let provider_custom = def.map(|d| d.custom).unwrap_or(true);
    let balance_supported = def
        .map(providers::api_key_balance_supported)
        .unwrap_or(false);
    let balance_note = def.and_then(providers::balance_note);
    let access_key_hint = def.and_then(providers::access_key_hint).map(str::to_string);
    let effective_base_url = def
        .map(|d| providers::base_url_of(d, &account.base_url))
        .unwrap_or_else(|| account.base_url.clone().unwrap_or_default());

    let account_recharge = account.recharge_url.clone().unwrap_or_default();
    let effective_recharge_url = if account_recharge.trim().is_empty() {
        def.map(|d| d.recharge_url.to_string()).unwrap_or_default()
    } else {
        account_recharge
    };

    let low = is_low(account, &status);

    let balance_alternatives = def.map(providers::balance_alternatives).unwrap_or_default();

    AccountView {
        id: account.id.clone(),
        provider: account.provider.clone(),
        provider_name,
        provider_vendor,
        provider_region,
        provider_custom,
        label: account.label.clone(),
        note: account.note.clone(),
        low_balance_threshold: account.low_balance_threshold,
        manual_balance: account.manual_balance,
        manual_currency: account.manual_currency.clone(),
        manual_recharge_total: account.manual_recharge_total,
        manual_spend_total: account.manual_spend_total,
        manual_recharge_currency: account.manual_recharge_currency.clone(),
        manual_spend_currency: account.manual_spend_currency.clone(),
        balance_mode: account
            .balance_mode
            .clone()
            .filter(|m| !m.trim().is_empty())
            .unwrap_or_else(|| "auto".into()),
        custom_url: account.custom_url.clone(),
        custom_headers: account.custom_headers.clone(),
        custom_json_path: account.custom_json_path.clone(),
        custom_currency: account.custom_currency.clone(),
        custom_method: account.custom_method.clone(),
        custom_body: account.custom_body.clone(),
        quota_total: account.quota_total,
        has_key: secrets::has_api_key(&account.id),
        needs_api_key: def.map(providers::needs_api_key).unwrap_or(true),
        has_admin_key: secrets::has_admin_key(&account.id),
        has_access_key: secrets::has_access_key(&account.id),
        has_console_cookie: secrets::has_console_cookie(&account.id),
        created_at: account.created_at.clone(),
        balance_supported,
        balance_note,
        access_key_hint,
        balance_alternatives,
        action_links: def.map(providers::action_links).unwrap_or_default(),
        effective_base_url,
        effective_recharge_url,
        billing_url: def.map(|d| d.billing_url.to_string()).unwrap_or_default(),
        pricing_url: def.map(|d| d.pricing_url.to_string()).unwrap_or_default(),
        docs_url: def.map(|d| d.docs_url.to_string()).unwrap_or_default(),
        low,
        status,
    }
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RechargeEvent {
    account_id: String,
    label: String,
    currency: String,
    amount: f64,
    total: f64,
}

/// 获取当前账户的供应商结果并提交本次刷新。
pub async fn refresh_status(state: &AppState, account: &Account) -> Option<RechargeEvent> {
    let status = balance::query(state, account).await;
    record_status(state, account, status)
}

/// 合并供应商查询结果、手动余额与上次成功快照，并记录费用和余额历史。
pub fn record_status(
    state: &AppState,
    account: &Account,
    mut status: AccountStatus,
) -> Option<RechargeEvent> {
    apply_manual_balance(account, &mut status);
    if let Ok(mut statuses) = state.statuses.lock() {
        preserve_snapshot(&mut status, statuses.get(&account.id));
        statuses.insert(account.id.clone(), status);
    }
    if crate::vendor_costs::capture(state, account).is_err() {
        // No provider response, credentials or account content enters this log.
        eprintln!("[Quota] 本次账面消费记录未能保存");
    }
    let balance = state
        .statuses
        .lock()
        .ok()?
        .get(&account.id)
        .cloned()
        .filter(|status| status.balance_error.is_none())?
        .balance?;
    let total = balance.total?;
    let amount = state.history.lock().ok()?.record(&account.id, total)?;
    state
        .config_snapshot()
        .settings
        .notify_recharge
        .then(|| RechargeEvent {
            account_id: account.id.clone(),
            label: account.label.clone(),
            currency: balance.currency,
            amount,
            total,
        })
}

fn preserve_snapshot(status: &mut AccountStatus, previous: Option<&AccountStatus>) {
    if status.balance_error.is_some() {
        if let Some(previous) = previous {
            if status.balance.is_none() && status.subscription.is_none() {
                status.balance = previous.balance.clone();
                status.subscription = previous.subscription.clone();
            }
            status.last_checked = previous.last_checked.clone();
        }
    }
}
