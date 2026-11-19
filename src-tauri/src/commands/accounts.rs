//! 账户、余额和供应商相关的 Tauri 接口。

use crate::{
    accounts, custom, history,
    model::{Account, AccountInput, AccountView, CustomProbe, ProviderView},
    providers, refresh, secrets, AppState,
};
use chrono::Local;
use std::collections::HashMap;
use tauri::{AppHandle, State};

#[tauri::command]
pub fn list_providers() -> Vec<ProviderView> {
    providers::visible_defs()
        .map(|d| ProviderView {
            id: d.id.into(),
            name: d.name.into(),
            vendor: d.vendor.into(),
            region: d.region.into(),
            custom: d.custom,
            default_base_url: d.default_base_url.into(),
            base_url_editable: d.base_url_editable,
            balance_supported: providers::api_key_balance_supported(d),
            balance_note: providers::balance_note(d),
            recharge_url: d.recharge_url.into(),
            billing_url: d.billing_url.into(),
            pricing_url: d.pricing_url.into(),
            docs_url: d.docs_url.into(),
            key_hint: d.key_hint.into(),
            needs_api_key: providers::needs_api_key(d),
            admin_key_hint: providers::admin_key_hint(d).map(str::to_string),
            access_key_hint: providers::access_key_hint(d).map(str::to_string),
            balance_alternatives: providers::balance_alternatives(d),
            balance_modes: providers::balance_modes(d),
            action_links: providers::action_links(d),
        })
        .collect()
}

// ---------------------------------------------------------------- 账户

#[tauri::command]
pub fn list_accounts(state: State<'_, AppState>) -> Vec<AccountView> {
    let accounts = state.config_snapshot().accounts;
    let mut views: Vec<AccountView> = accounts.iter().map(|a| accounts::view(&state, a)).collect();
    views.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    views
}

#[tauri::command]
pub async fn save_account(
    state: State<'_, AppState>,
    app: AppHandle,
    input: AccountInput,
) -> Result<AccountView, String> {
    let id = accounts::save(&state, input).await?;
    refresh::one(&state, &app, &id).await
}

#[tauri::command]
pub async fn delete_account(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> Result<(), String> {
    accounts::remove(&state, &id)?;
    refresh::accounts_updated(&app);
    Ok(())
}

#[tauri::command]
pub async fn refresh_account(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> Result<AccountView, String> {
    refresh::one(&state, &app, &id).await
}

#[tauri::command]
pub async fn refresh_all(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<AccountView>, String> {
    Ok(refresh::all(&state, &app).await)
}

#[tauri::command]
pub fn get_balance_history(state: State<'_, AppState>) -> HashMap<String, history::AccountTrend> {
    state
        .history
        .lock()
        .map(|h| h.all_trends())
        .unwrap_or_default()
}

/// 「自定义余额接口」的即时测试：直接从返回 JSON 里找出可用的金额字段，
/// 用户可以先测通、一键选用路径，再保存。不需要先把账户存下来。
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomProbeInput {
    #[serde(default)]
    pub custom_url: Option<String>,
    #[serde(default)]
    pub custom_headers: Option<String>,
    #[serde(default)]
    pub custom_json_path: Option<String>,
    #[serde(default)]
    pub custom_currency: Option<String>,
    #[serde(default)]
    pub custom_method: Option<String>,
    #[serde(default)]
    pub custom_body: Option<String>,
}

#[tauri::command]
pub async fn probe_custom_balance(
    state: State<'_, AppState>,
    input: CustomProbeInput,
) -> Result<CustomProbe, String> {
    let temp = Account {
        id: "probe".into(),
        provider: "custom".into(),
        label: "probe".into(),
        base_url: None,
        recharge_url: None,
        low_balance_threshold: 0.0,
        manual_balance: None,
        manual_currency: None,
        manual_recharge_total: None,
        manual_spend_total: None,
        manual_recharge_currency: None,
        manual_spend_currency: None,
        note: None,
        balance_mode: Some("custom".into()),
        custom_url: input.custom_url.clone(),
        custom_headers: input.custom_headers.clone(),
        custom_json_path: input.custom_json_path.clone(),
        custom_currency: input.custom_currency.clone(),
        custom_method: input.custom_method.clone(),
        custom_body: input.custom_body.clone(),
        quota_total: None,
        created_at: Local::now().to_rfc3339(),
    };

    let mut probe = CustomProbe {
        currency: input
            .custom_currency
            .clone()
            .filter(|c| !c.trim().is_empty())
            .unwrap_or_else(|| "CNY".into()),
        ..Default::default()
    };

    match custom::call_custom(&state.http, &temp).await {
        Err(e) => {
            probe.error = Some(e);
            Ok(probe)
        }
        Ok((json, text)) => {
            probe.discovered = custom::discover_numeric_paths(&json);
            probe.raw_preview = text.chars().take(1200).collect();

            let configured = input
                .custom_json_path
                .as_deref()
                .map(str::trim)
                .filter(|p| !p.is_empty());
            match configured {
                Some(p) => match custom::json_path(&json, p).and_then(|v| match v {
                    serde_json::Value::Number(n) => n.as_f64(),
                    serde_json::Value::String(s) => s.trim().parse::<f64>().ok(),
                    _ => None,
                }) {
                    Some(v) => {
                        probe.ok = true;
                        probe.value = Some(v);
                    }
                    None => {
                        probe.error = Some(format!(
                            "按路径「{p}」没取到数字，可从下面发现的字段里选一个。"
                        ));
                    }
                },
                None => {
                    // 没填路径：报告自动识别的结果，让用户确认后再保存
                    if let Some(first) = probe.discovered.first().cloned() {
                        probe.ok = true;
                        probe.value = Some(first.value);
                    } else {
                        probe.error = Some("返回内容里没有找到任何数值字段。".into());
                    }
                }
            }
            Ok(probe)
        }
    }
}

/// 生成一条能直接粘贴运行的 cURL 调用示例（含该账户的 API Key，注意不要外传）
#[tauri::command]
pub fn api_snippet(
    state: State<'_, AppState>,
    account_id: String,
    model_id: String,
) -> Result<String, String> {
    let account = state
        .config_snapshot()
        .accounts
        .into_iter()
        .find(|a| a.id == account_id)
        .ok_or_else(|| format!("账户不存在：{account_id}"))?;
    let def = providers::find(&account.provider)
        .ok_or_else(|| format!("未知供应商：{}", account.provider))?;
    let base = providers::base_url_of(def, &account.base_url);
    if base.trim().is_empty() {
        return Err("该账户还没有填写 Base URL，无法生成调用示例（可在「编辑」里补上）".into());
    }
    let key = secrets::get_secrets(&account.id)?
        .api_key
        .filter(|k| !k.trim().is_empty())
        .ok_or_else(|| "该账户还没有保存 API Key".to_string())?;

    let url = format!("{}/chat/completions", base.trim_end_matches('/'));
    // 注意 format! 里 JSON 的花括号要写成 {{ }}
    Ok(format!(
        "curl {url} \\\n  -H \"Content-Type: application/json\" \\\n  -H \"Authorization: Bearer {key}\" \\\n  -d '{{\"model\":\"{model_id}\",\"messages\":[{{\"role\":\"user\",\"content\":\"你好\"}}],\"stream\":false}}'"
    ))
}
