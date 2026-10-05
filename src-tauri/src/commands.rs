//! Tauri 命令层：前端通过 invoke 调用的所有接口。

use crate::aliyun;
use crate::backup;
use crate::catalog;
use crate::custom;
use crate::history::{self, HistoryStore};
use crate::mimo;
use crate::model::*;
use crate::pricing;
use crate::proxy;
use crate::providers::{self, AdminProbe, BalanceProbe};
use crate::secrets;
use crate::storage::Store;
use chrono::Local;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

pub struct AppState {
    pub activity_lock: Mutex<()>,
    pub ladder: Mutex<crate::ladder::Snapshot>,
    pub ladder_refreshing: Mutex<bool>,
    pub pending_connections: Mutex<HashMap<String, String>>,
    pub store: Store,
    pub http: reqwest::Client,
    pub config: Mutex<AppConfig>,
    pub statuses: Mutex<HashMap<String, AccountStatus>>,
    /// 余额历史（画趋势、估算可用天数、识别充值）
    pub history: Mutex<HistoryStore>,
    /// 内置模型资料库
    pub catalog: Vec<CatalogEntry>,
    /// 本地编辑过的资料库条目
    pub overrides: Mutex<Vec<CatalogEntry>>,
    /// 用户在模型库里手动隐藏的模型 id（本机 hidden_models.json）
    pub hidden_models: Mutex<Vec<String>>,
    /// 低余额通知时间戳，避免重复打扰
    pub low_notified: Mutex<HashMap<String, i64>>,
    /// 第三方参考价缓存：(抓取时间戳, 归一化 id → 价格)
    pub reference_prices: Mutex<Option<(i64, HashMap<String, pricing::RefPrice>)>>,
}

/// 第三方参考价的缓存时长：6 小时
const REFERENCE_TTL_SECONDS: i64 = 6 * 3600;

impl AppState {
    pub fn new(store: Store, config: AppConfig, overrides: Vec<CatalogEntry>) -> Self {
        let activity_options=crate::activity::options(store.dir());
        let _=crate::activity::save_options(store.dir(),&activity_options);
        let hidden_models = store.load_hidden_models();
        let history = HistoryStore::load(store.dir());
        // 跟随系统代理：reqwest 默认只认环境变量，不读 Windows 系统代理，
        // 否则 Clash 开了系统代理、应用仍然直连，chatgpt.com 这类站点就连不上。
        let http = {
            let mut builder = reqwest::Client::builder()
                .timeout(Duration::from_secs(25))
                .user_agent(concat!("Quota/", env!("CARGO_PKG_VERSION")));
            if let Some(url) = proxy::system_proxy_url() {
                match reqwest::Proxy::all(&url) {
                    Ok(p) => {
                        eprintln!("[Quota] 跟随系统代理：{url}");
                        builder = builder.proxy(p);
                    }
                    Err(e) => eprintln!("[Quota] 系统代理地址无效 {url}：{e}"),
                }
            }
            builder.build().unwrap_or_default()
        };
        Self {
            activity_lock: Mutex::new(()),
            ladder: Mutex::new(crate::ladder::load(store.dir())),
            ladder_refreshing: Mutex::new(false),
            pending_connections: Mutex::new(HashMap::new()),
            store,
            http,
            config: Mutex::new(config),
            statuses: Mutex::new(HashMap::new()),
            history: Mutex::new(history),
            catalog: catalog::embedded_file().entries,
            overrides: Mutex::new(overrides),
            hidden_models: Mutex::new(hidden_models),
            low_notified: Mutex::new(HashMap::new()),
            reference_prices: Mutex::new(None),
        }
    }
}

fn lock_config(state: &AppState) -> AppConfig {
    state
        .config
        .lock()
        .map(|c| c.clone())
        .unwrap_or_default()
}

/// 组装账户视图
pub fn account_view(state: &AppState, account: &Account) -> AccountView {
    let def = providers::find(&account.provider);
    let mut status = state
        .statuses
        .lock()
        .ok()
        .and_then(|m| m.get(&account.id).cloned())
        .unwrap_or_default();
    apply_manual_balance(account, &mut status);

    let provider_name = def
        .map(|d| d.name.to_string())
        .unwrap_or_else(|| format!("未知供应商（{}）", account.provider));
    let provider_vendor = def.map(|d| d.vendor.to_string()).unwrap_or_default();
    let provider_region = def.map(|d| d.region.to_string()).unwrap_or_default();
    let provider_custom = def.map(|d| d.custom).unwrap_or(true);
    let balance_supported = def.map(providers::api_key_balance_supported).unwrap_or(false);
    let balance_note = def.and_then(providers::balance_note);
    let access_key_hint = def
        .and_then(providers::access_key_hint)
        .map(str::to_string);
    let effective_base_url = def
        .map(|d| providers::base_url_of(d, &account.base_url))
        .unwrap_or_else(|| account.base_url.clone().unwrap_or_default());

    let account_recharge = account.recharge_url.clone().unwrap_or_default();
    let effective_recharge_url = if account_recharge.trim().is_empty() {
        def.map(|d| d.recharge_url.to_string()).unwrap_or_default()
    } else {
        account_recharge
    };

    let total = status.subscription.as_ref().and_then(|s| s.windows.iter().map(|w| w.remaining).reduce(f64::min))
        .or_else(|| status.balance.as_ref().and_then(|b| b.total));
    let low = account.low_balance_threshold > 0.0
        && total.map(|t| t < account.low_balance_threshold).unwrap_or(false);

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

/// 「其他方式获取余额」之一：用阿里云 AccessKey 读阿里云账户可用额度。
/// 百炼等平台本身没有余额接口，但费用从阿里云账户扣，这条路径能拿到真实余额。
async fn fetch_aliyun_balance(state: &AppState, account_id: &str) -> Result<Balance, String> {
    match secrets::get_access_key(account_id) {
        Some((id, secret)) => {
            aliyun::fetch_account_balance(&state.http, &id, &secret).await
        }
        None => Err(
            "还没有保存阿里云 AccessKey（需要 AccessKey ID 与 Secret 成对填写），无法读取阿里云账户余额。"
                .into(),
        ),
    }
}

/// 「其他方式获取余额」之一：用浏览器里的小米账号 Cookie 查 MiMo 控制台
/// （余额 / 本月用量 / 套餐余量）。官方没有查询 API，这是唯一能自动查的途径。
async fn fetch_mimo_balance(
    state: &AppState,
    account_id: &str,
    provider_id: &str,
) -> Result<Balance, String> {
    match secrets::get_console_cookie(account_id) {
        Some(cookie) => mimo::fetch_console(&state.http, &cookie, provider_id).await,
        None => Err("还没有保存 MiMo 控制台 Cookie：在浏览器登录 platform.xiaomimimo.com 后复制 Cookie，填到「编辑」里即可自动查。".into()),
    }
}

/// 查询单个账户的余额与模型列表。
/// 余额按账户选择的「获取方式」来：
///   auto   —— 官方余额接口；没有官方接口时尝试管理员用量接口
///   custom —— 用户配置的自定义余额接口
///   manual —— 只用用户填写的手动余额
/// 任何自动方式失败都会退回手动余额，保证低余额提醒始终可用。
pub async fn refresh_one(state: &AppState, account: &Account) -> AccountStatus {
    let mut status = AccountStatus::default();
    let mode = account
        .balance_mode
        .clone()
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| "auto".into());

    match providers::find(&account.provider) {
        None => {
            status.balance_error = Some(format!("未知供应商：{}", account.provider));
        }
        Some(def) => {
            let base = providers::base_url_of(def, &account.base_url);
            let blob = secrets::get_secrets(&account.id).unwrap_or_default();
            let api_key = blob.api_key.filter(|k| !k.trim().is_empty());
            let admin_key = blob.admin_key.filter(|k| !k.trim().is_empty());

            // ---------------- 余额 ----------------
            if mode == "manual" {
                // 用户明确选择手动，不发起查询
            } else if def.id == "custom" && matches!(mode.as_str(), "codex" | "auto") {
                match blob.subscription_account.as_deref() {
                    Some(id) => match crate::subscription::fetch(&state.http, Some(id)).await {
                        Ok((quota, _)) => status.subscription = Some(quota),
                        Err(e) => status.balance_error = Some(e),
                    },
                    None => status.balance_error = Some("请连接本机 ChatGPT 登录".into()),
                }
            } else if mode == "custom" {
                match custom::fetch_custom_balance(&state.http, account).await {
                    Ok(b) => status.balance = Some(b),
                    Err(e) => status.balance_error = Some(e),
                }
            } else if mode == "aliyun" {
                match fetch_aliyun_balance(state, &account.id).await {
                    Ok(b) => status.balance = Some(b),
                    Err(e) => status.balance_error = Some(e),
                }
            } else if mode == "console" {
                match fetch_mimo_balance(state, &account.id, def.id).await {
                    Ok(b) => status.balance = Some(b),
                    Err(e) => status.balance_error = Some(e),
                }
            } else {
                match def.balance {
                    // 官方也没接口，但控制台接口能读（MiMo 余额/用量/套餐余量）
                    BalanceProbe::MimoConsole => match fetch_mimo_balance(state, &account.id, def.id).await {
                        Ok(b) => status.balance = Some(b),
                        Err(e) => status.balance_error = Some(e),
                    },
                    // 官方也没接口，但云厂商账单接口能读（百炼 → 阿里云账户）
                    BalanceProbe::AliyunBss => match fetch_aliyun_balance(state, &account.id).await {
                        Ok(b) => status.balance = Some(b),
                        Err(e) => status.balance_error = Some(e),
                    },
                    // 官方没有余额接口：尝试管理员级用量接口
                    BalanceProbe::Unsupported(_) => {
                        if let (Some(AdminProbe::OpenAiCosts), Some(ak)) =
                            (providers::admin_probe(def), admin_key.as_deref())
                        {
                            if base.trim().is_empty() {
                                status.balance_error =
                                    Some("未填写 Base URL，无法调用用量接口。".into());
                            } else {
                                match providers::fetch_admin_costs(&state.http, def, &base, ak).await
                                {
                                    Ok(b) => status.balance = Some(b),
                                    Err(e) => status.balance_error = Some(e),
                                }
                            }
                        } else if providers::admin_probe(def).is_some() {
                            // 有可用的管理员接口，但还没填密钥：给出提示，不算错误
                            status.balance_error = Some(
                                "该平台只能通过管理员用量接口自动获取消费额：请在「编辑」里填写管理员密钥。"
                                    .into(),
                            );
                        }
                    }
                    _ => {
                        if base.trim().is_empty() {
                            status.balance_error = Some(
                                "未填写 Base URL，无法查询余额与模型列表。请在「编辑」里补上。".into(),
                            );
                        } else {
                            match api_key.as_deref() {
                                None => {
                                    status.balance_error =
                                        Some("未找到该账户的 API Key，请在「编辑」里填写。".into())
                                }
                                Some(key) => {
                                    match providers::fetch_balance(&state.http, def, &base, key).await
                                    {
                                        Ok(b) => status.balance = Some(b),
                                        Err(e) => status.balance_error = Some(e),
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // 成本型来源（管理员用量接口）：用「已充值/预算总额 − 累计消费」推算剩余
            if let Some(balance) = status.balance.as_mut() {
                if balance.source == "costs" {
                    let spent = balance
                        .amounts
                        .iter()
                        .find(|a| a.kind == "spent")
                        .map(|a| a.value)
                        .unwrap_or(0.0);
                    match account.quota_total {
                        Some(quota) if quota > 0.0 => {
                            let left = quota - spent;
                            balance.total = Some(left);
                            balance.usable = Some(left > 0.0);
                            balance.amounts.push(BalanceAmount {
                                label: "已充值/预算总额".into(),
                                value: quota,
                                kind: "quota".into(),
                            });
                            balance.note = Some(format!(
                                "按「已充值总额 {:.2} − 近 30 天消费 {:.2}」估算剩余，仅供提醒参考",
                                quota, spent
                            ));
                        }
                        _ => {
                            balance.note = Some(format!(
                                "该平台不提供余额接口，只取到近 30 天消费 {:.2}；填写「已充值/预算总额」后可推算剩余额度",
                                spent
                            ));
                        }
                    }
                }
            }

            // ---------------- 模型列表 ----------------
            if def.models_path.is_empty() {
                // 网页版订阅（ChatGPT）没有 /models 接口：不拉取、也不报错
            } else if base.trim().is_empty() {
                status.models_error = Some("未填写 Base URL，无法拉取模型列表。".into());
            } else {
                match api_key.as_deref() {
                    None => {
                        status.models_error =
                            Some("未找到该账户的 API Key，无法拉取模型列表。".into())
                    }
                    Some(key) => {
                        match providers::fetch_models(&state.http, def, &base, key).await {
                            Ok(models) => status.models = models,
                            Err(e) => status.models_error = Some(e),
                        }
                    }
                }
            }
        }
    }

    apply_manual_balance(account, &mut status);

    // 平台本来就不支持余额接口时，不把说明当作错误报红
    if !matches!(mode.as_str(), "custom") {
        if let Some(def) = providers::find(&account.provider) {
            let unsupported_offline = matches!(def.balance, BalanceProbe::Unsupported(_))
                && providers::admin_probe(def).is_none();
            if unsupported_offline && account.provider != "custom" && status.balance_error.is_some() {
                status.balance_error = None;
            }
        }
    }

    status.last_checked = Some(Local::now().to_rfc3339());
    status
}

/// 首次读取即可显示已保存的手动记录；自动订阅成功时不再被备用手动值遮住。
pub fn apply_manual_balance(account: &Account, status: &mut AccountStatus) {
    let explicit_manual = account.balance_mode.as_deref() == Some("manual");
    if explicit_manual {
        status.subscription = None;
        status.balance = None;
        status.balance_error = None;
    } else if status.balance.is_some() || status.subscription.is_some() {
        return;
    }
    if let Some(manual) = account.manual_balance.filter(|value| value.is_finite()) {
        status.balance = Some(Balance {
            currency: account.manual_currency.clone().filter(|currency| !currency.trim().is_empty()).unwrap_or_else(|| "CNY".into()),
            total: Some(manual),
            source: "manual".into(),
            amounts: Vec::new(),
            usable: Some(manual > 0.0),
            note: Some(if explicit_manual { "手动记录" } else { "备用手动记录，尚未取得自动余额或订阅额度" }.into()),
            raw: None,
        });
    }
}

/// 刷新拿到余额后追加一条历史记录；余额明显上涨时向前端广播疑似充值事件
fn record_history(state: &AppState, account: &Account, app: &AppHandle) {
    let Some(balance) = state
        .statuses
        .lock()
        .ok()
        .and_then(|m| m.get(&account.id).cloned())
        .filter(|s| s.balance_error.is_none())
        .and_then(|s| s.balance)
    else {
        return;
    };
    let Some(total) = balance.total else {
        return;
    };
    let recharged = state
        .history
        .lock()
        .ok()
        .and_then(|mut h| h.record(&account.id, total));
    if let Some(delta) = recharged.filter(|_| lock_config(state).settings.notify_recharge) {
        let _ = app.emit(
            "recharge-detected",
            serde_json::json!({
                "accountId": account.id,
                "label": account.label,
                "currency": balance.currency,
                "amount": delta,
                "total": total,
            }),
        );
    }
}

/// 依据当前账户状态刷新托盘图标：有余额不足的账户时给图标加红点角标
pub fn update_tray_alert(app: &AppHandle) {
    let state = app.state::<AppState>();
    let low = lock_config(&state)
        .accounts
        .iter()
        .filter(|a| account_view(&state, a).low)
        .count();
    crate::tray::update_alert(app, if lock_config(&state).settings.tray_alert { low } else { 0 });
}

pub async fn refresh_account_inner(state: &AppState, app: &AppHandle, id: &str) -> Result<AccountView, String> {
    let account = lock_config(state)
        .accounts
        .into_iter()
        .find(|a| a.id == id)
        .ok_or_else(|| format!("账户不存在：{id}"))?;
    let mut status = refresh_one(state, &account).await;
    if let Ok(mut map) = state.statuses.lock() {
        preserve_snapshot(&mut status, map.get(&account.id));
        map.insert(account.id.clone(), status);
    }
    record_history(state, &account, app);
    Ok(account_view(state, &account))
}

pub async fn refresh_all_inner(state: &AppState, app: &AppHandle) -> Vec<AccountView> {
    let accounts = lock_config(state).accounts;
    let mut views = Vec::with_capacity(accounts.len());
    for account in accounts.iter() {
        let mut status = refresh_one(state, account).await;
        if let Ok(mut map) = state.statuses.lock() {
            preserve_snapshot(&mut status, map.get(&account.id));
            map.insert(account.id.clone(), status);
        }
        record_history(state, account, app);
        views.push(account_view(state, account));
    }
    views
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

fn emit_updated(app: &AppHandle) {
    let _ = app.emit("accounts-updated", ());
}

// ---------------------------------------------------------------- 供应商

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
    let accounts = lock_config(&state).accounts;
    let mut views: Vec<AccountView> = accounts.iter().map(|a| account_view(&state, a)).collect();
    views.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    views
}

#[tauri::command]
pub async fn save_account(
    state: State<'_, AppState>,
    app: AppHandle,
    input: AccountInput,
) -> Result<AccountView, String> {
    state.store.ensure_config_writable()?;
    let def = providers::find(&input.provider)
        .ok_or_else(|| format!("未知供应商：{}", input.provider))?;
    input.validate_numbers()?;

    let label = {
        let l = input.label.trim();
        if l.is_empty() {
            def.name.to_string()
        } else {
            l.to_string()
        }
    };
    let base_url = input
        .base_url
        .clone()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    // 需要拉模型/查接口的平台才强制要 Base URL；网页版订阅（models_path 为空）不用填
    if base_url.is_none()
        && def.default_base_url.trim().is_empty()
        && !def.models_path.is_empty()
    {
        return Err(format!(
            "{} 需要填写 Base URL（OpenAI 兼容地址，通常以 /v1 结尾）",
            def.name
        ));
    }
    let recharge_url = input
        .recharge_url
        .clone()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let manual_currency = input
        .manual_currency
        .clone()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let note = input
        .note
        .clone()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let clean = |v: &Option<String>| -> Option<String> {
        v.clone().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
    };
    let balance_mode = clean(&input.balance_mode).unwrap_or_else(|| "auto".into());
    let custom_url = clean(&input.custom_url);
    let custom_headers = clean(&input.custom_headers);
    let custom_json_path = clean(&input.custom_json_path);
    let custom_currency = clean(&input.custom_currency);
    let custom_method = clean(&input.custom_method);
    let custom_body = clean(&input.custom_body);
    let quota_total = input.quota_total.filter(|q| *q > 0.0);

    let is_new = input.id.is_none();
    let id = input.id.clone().unwrap_or_else(|| Uuid::new_v4().to_string());
    if let Some(connection_id) = &input.connection_id {
        let pending = state.pending_connections.lock().map_err(|_| "连接状态不可用")?;
        if pending.get(connection_id) != Some(&input.provider) { return Err("连接已失效，请重新连接".into()); }
        let staged = secrets::get_secrets(connection_id)?;
        let mut target = secrets::get_secrets(&id)?;
        if let Some(cookie) = staged.console_cookie {
            crate::connections::update_mimo_cookie(&state, &id, &cookie)?;
            target.console_cookie = Some(cookie);
        }
        if staged.subscription_account.is_some() { target.subscription_account = staged.subscription_account; }
        secrets::restore(&id, &target)?;
    }
    let threshold = input.low_balance_threshold.unwrap_or(0.0).max(0.0);

    {
        let mut cfg = state.config.lock().map_err(|_| "配置锁定失败".to_string())?;
        state.store.update_config(&mut cfg, |next| {
            if let Some(existing) = next.accounts.iter_mut().find(|a| a.id == id) {
                existing.label = label;
                existing.base_url = base_url;
                existing.recharge_url = recharge_url;
                existing.low_balance_threshold = threshold;
                existing.manual_balance = input.manual_balance;
                existing.manual_currency = manual_currency;
                existing.manual_recharge_total = input.manual_recharge_total;
                existing.manual_spend_total = input.manual_spend_total;
                existing.manual_recharge_currency = input.manual_recharge_currency.clone();
                existing.manual_spend_currency = input.manual_spend_currency.clone();
                existing.note = note;
                existing.balance_mode = Some(balance_mode);
                existing.custom_url = custom_url;
                existing.custom_headers = custom_headers;
                existing.custom_json_path = custom_json_path;
                existing.custom_currency = custom_currency;
                existing.custom_method = custom_method;
                existing.custom_body = custom_body;
                existing.quota_total = quota_total;
            } else {
                next.accounts.push(Account {
                    id: id.clone(),
                    provider: input.provider.clone(),
                    label,
                    base_url,
                    recharge_url,
                    low_balance_threshold: threshold,
                    manual_balance: input.manual_balance,
                    manual_currency,
                    manual_recharge_total: input.manual_recharge_total,
                    manual_spend_total: input.manual_spend_total,
                    manual_recharge_currency: input.manual_recharge_currency.clone(),
                    manual_spend_currency: input.manual_spend_currency.clone(),
                    note,
                    balance_mode: Some(balance_mode),
                    custom_url,
                    custom_headers,
                    custom_json_path,
                    custom_currency,
                    custom_method,
                    custom_body,
                    quota_total,
                    created_at: Local::now().to_rfc3339(),
                });
            }
        })?;
    }

    if let Some(key) = input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty())
    {
        secrets::set_api_key(&id, key)?;
    } else if is_new && !secrets::has_api_key(&id) {
        // 允许先保存账户、稍后补 Key；查询时会在卡片上提示缺少 Key
        eprintln!("[Quota] 新增账户 {id} 未填写 API Key");
    }

    if let Some(admin_key) = input
        .admin_key
        .as_deref()
        .map(str::trim)
        .filter(|k| !k.is_empty())
    {
        secrets::set_admin_key(&id, admin_key)?;
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
        secrets::set_access_key(&id, id_part, secret)?;
    }

    // MiMo 控制台 Cookie（浏览器小米账号 SSO 会话），同样只存凭据管理器
    if let Some(cookie) = input
        .console_cookie
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
    {
        crate::connections::update_mimo_cookie(&state, &id, cookie)?;
    }

    if let Some(connection_id) = &input.connection_id {
        state.pending_connections.lock().map_err(|_| "连接状态不可用")?.remove(connection_id);
        secrets::delete(connection_id)?;
    }
    let view = refresh_account_inner(&state, &app, &id).await?;
    emit_updated(&app);
    update_tray_alert(&app);
    Ok(view)
}

#[tauri::command]
pub async fn delete_account(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> Result<(), String> {
    {
        let mut cfg = state.config.lock().map_err(|_| "配置锁定失败".to_string())?;
        state.store.update_config(&mut cfg, |next| next.accounts.retain(|a| a.id != id))?;
    }
    let _ = secrets::delete(&id);
    if let Ok(mut map) = state.statuses.lock() {
        map.remove(&id);
    }
    if let Ok(mut h) = state.history.lock() {
        h.remove(&id);
    }
    emit_updated(&app);
    update_tray_alert(&app);
    Ok(())
}

#[tauri::command]
pub async fn refresh_account(
    state: State<'_, AppState>,
    app: AppHandle,
    id: String,
) -> Result<AccountView, String> {
    let view = refresh_account_inner(&state, &app, &id).await?;
    emit_updated(&app);
    update_tray_alert(&app);
    Ok(view)
}

#[tauri::command]
pub async fn refresh_all(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<AccountView>, String> {
    let views = refresh_all_inner(&state, &app).await;
    emit_updated(&app);
    update_tray_alert(&app);
    Ok(views)
}

// ---------------------------------------------------------------- 设置

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    lock_config(&state).settings
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    app: AppHandle,
    settings: Settings,
) -> Result<Settings, String> {
    let mut cfg = state.config.lock().map_err(|_| "配置锁定失败".to_string())?;
    let mut next = settings;
    if !next.default_low_threshold.is_finite() || next.default_low_threshold < 0.0 {
        return Err("默认提醒阈值须为有限非负数".into());
    }
    next.refresh_interval_minutes = next.refresh_interval_minutes.clamp(1, 1440);
    next.default_low_threshold = next.default_low_threshold.max(0.0);
    state.store.update_config(&mut cfg, |config| config.settings = next.clone())?;
    drop(cfg);
    update_tray_alert(&app);
    Ok(next)
}

// ---------------------------------------------------------------- 余额历史

#[tauri::command]
pub fn get_balance_history(state: State<'_, AppState>) -> HashMap<String, history::AccountTrend> {
    state
        .history
        .lock()
        .map(|h| h.all_trends())
        .unwrap_or_default()
}

// ---------------------------------------------------------------- 备份与迁移

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackupPayload<'a> {
    version: u32,
    exported_at: String,
    config: &'a AppConfig,
    catalog_overrides: Vec<CatalogEntry>,
    hidden_models: Vec<String>,
    /// (账户 id, 凭据 blob)：解密后原样写回凭据管理器
    credentials: Vec<CredentialEntry>,
    balance_history: HashMap<String, Vec<history::HistoryPoint>>,
    activity: serde_json::Value,
}

#[derive(serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CredentialEntry {
    account_id: String,
    blob: secrets::SecretBlob,
}

/// 导出加密备份：配置 + 资料库覆盖 + 隐藏列表 + 凭据，全部打进一个密码加密的文件。
/// 文件本身 AES-256-GCM 加密，密码不落盘。
#[tauri::command]
pub fn export_backup(
    state: State<'_, AppState>,
    password: String,
    path: String,
) -> Result<(), String> {
    state.store.ensure_core_files_writable()?;
    let config = lock_config(&state);
    let overrides = state.overrides.lock().map_err(|_| "资料库锁定失败".to_string())?.clone();
    let hidden_models = state
        .hidden_models
        .lock()
        .map_err(|_| "隐藏列表锁定失败".to_string())?
        .clone();
    let mut credentials = Vec::new();
    for account in &config.accounts {
        match secrets::get_secrets(&account.id) {
            Ok(blob) => credentials.push(CredentialEntry {
                account_id: account.id.clone(),
                blob,
            }),
            Err(e) => return Err(format!("读取「{}」的凭据失败：{e}", account.label)),
        }
    }
    let payload = BackupPayload {
        version: 2,
        exported_at: Local::now().to_rfc3339(),
        config: &config,
        catalog_overrides: overrides,
        hidden_models,
        credentials,
        balance_history: state.history.lock().map_err(|_| "余额历史暂不可用")?.export_points(),
        activity: {
            let _guard = state.activity_lock.lock().map_err(|_| "活动统计暂不可用")?;
            crate::data_export::activity_data(state.store.dir())?
        },
    };
    let plaintext = serde_json::to_vec(&payload).map_err(|e| format!("打包备份失败：{e}"))?;
    let sealed = backup::seal(&password, &plaintext)?;
    let sealed_json = serde_json::from_slice(&sealed).map_err(|_| "加密备份编码失败")?;
    crate::data_export::write_file(std::path::Path::new(&path), state.store.dir(), &sealed_json)
}

// ---------------------------------------------------------------- 模型资料库

#[tauri::command]
pub fn model_cards(state: State<'_, AppState>, provider: Option<String>) -> Vec<ModelCard> {
    let accounts = lock_config(&state).accounts;
    let overrides = state
        .overrides
        .lock()
        .map(|o| o.clone())
        .unwrap_or_default();
    let statuses = state
        .statuses
        .lock()
        .map(|s| s.clone())
        .unwrap_or_default();

    let filter = provider.unwrap_or_default();
    let mut cards = Vec::new();
    for account in accounts.iter() {
        if !filter.is_empty() && account.provider != filter {
            continue;
        }
        if let Some(status) = statuses.get(&account.id) {
            cards.extend(catalog::cards_for_account(
                &account.provider,
                &account.id,
                &status.models,
                &state.catalog,
                &overrides,
            ));
        }
    }
    let mut merged = catalog::merge_cards(cards);
    // 手动隐藏的模型仍然返回，只打上 hidden 标记，由前端决定展示与否（「显示已隐藏」要用）
    let hidden: HashSet<String> = state
        .hidden_models
        .lock()
        .map(|h| h.iter().map(|id| catalog::normalize(id)).collect())
        .unwrap_or_default();
    for card in &mut merged {
        card.hidden = hidden.contains(&catalog::normalize(&card.id));
    }
    merged
}

/// 在模型库里隐藏/恢复某个模型（按 id 记在本机 hidden_models.json）
#[tauri::command]
pub fn set_model_hidden(
    state: State<'_, AppState>,
    model_id: String,
    hidden: bool,
) -> Result<(), String> {
    let mut list = state
        .hidden_models
        .lock()
        .map_err(|_| "隐藏列表锁定失败".to_string())?;
    let norm = catalog::normalize(&model_id);
    let mut next = list.clone();
    // 先去掉同归一化 id 的旧记录，保证同一模型只有一条
    next.retain(|id| catalog::normalize(id) != norm);
    if hidden {
        next.push(model_id);
    }
    state.store.save_hidden_models(&next)?;
    *list = next;
    Ok(())
}

/// 保存用户对某个模型资料的本地修改（按 match 第一项作为键）
#[tauri::command]
pub fn save_catalog_entry(
    state: State<'_, AppState>,
    entry: CatalogEntry,
) -> Result<(), String> {
    let mut overrides = state.overrides.lock().map_err(|_| "资料库锁定失败".to_string())?;
    catalog::save_entry(&mut overrides, entry, |next| state.store.save_overrides(next))
}

/// 清空本地资料库覆盖，恢复内置资料
#[tauri::command]
pub fn reset_catalog_overrides(state: State<'_, AppState>) -> Result<(), String> {
    let mut overrides = state.overrides.lock().map_err(|_| "资料库锁定失败".to_string())?;
    state.store.save_overrides(&[])?;
    overrides.clear();
    Ok(())
}

/// 保留当前覆盖，与内置资料分开供用户核对，不能自动合并不同来源的价格。
fn resolve_entry(state: &AppState, provider: &str, model_id: &str) -> Result<(CatalogEntry, Option<CatalogEntry>), String> {
    let overrides = state
        .overrides
        .lock()
        .map_err(|_| "资料库暂不可用".to_string())?;
    Ok(catalog::comparison_entries(&state.catalog, &overrides, provider, model_id))
}

/// 取第三方参考价（带 6 小时内存缓存）
async fn reference_index(
    state: &AppState,
    force: bool,
) -> Result<HashMap<String, pricing::RefPrice>, String> {
    let now = Local::now().timestamp();
    if !force {
        if let Ok(guard) = state.reference_prices.lock() {
            if let Some((at, map)) = guard.as_ref() {
                if now - at < REFERENCE_TTL_SECONDS {
                    return Ok(map.clone());
                }
            }
        }
    }
    let refs = pricing::fetch_reference(&state.http).await?;
    let map = pricing::index_reference(&refs);
    if let Ok(mut guard) = state.reference_prices.lock() {
        *guard = Some((now, map.clone()));
    }
    Ok(map)
}

/// 模型价格比对：把本地资料库、官方定价页抓取、第三方参考价摆在一起，
/// 并给出一个「可信度」结论。
#[tauri::command]
pub async fn compare_prices(
    state: State<'_, AppState>,
    model_id: String,
    provider: String,
    include_page: bool,
    include_reference: bool,
) -> Result<PriceComparison, String> {
    let (entry, builtin) = resolve_entry(&state, &provider, &model_id)?;

    let mut page = None;
    if include_page {
        let url = providers::find(&provider)
            .map(|d| d.pricing_url.to_string())
            .unwrap_or_default();
        let mut hints = entry.r#match.clone();
        hints.push(model_id.clone());
        if !entry.name.is_empty() {
            hints.push(entry.name.clone());
        }
        page = Some(pricing::scan_pricing_page(&state.http, &url, &hints).await);
    }

    let mut reference = None;
    let mut warnings: Vec<String> = Vec::new();
    if include_reference {
        match reference_index(&state, false).await {
            Ok(map) => {
                reference = map.get(&catalog::normalize(&model_id)).cloned();
                if reference.is_none() {
                    warnings.push(format!(
                        "第三方参考价里没有收录「{model_id}」，该模型只有本地资料与官方定价页两个来源。"
                    ));
                }
            }
            Err(e) => warnings.push(e),
        }
    }

    let mut cmp = pricing::build_comparison(
        &model_id,
        &entry.name,
        &provider,
        entry.price.clone(),
        entry.verified,
        entry.verified_at.clone(),
        entry.source.clone(),
        builtin.as_ref(),
        page,
        reference,
    );
    cmp.warnings.extend(warnings);
    Ok(cmp)
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

// ---------------------------------------------------------------- 其它

/// 生成一条能直接粘贴运行的 cURL 调用示例（含该账户的 API Key，注意不要外传）
#[tauri::command]
pub fn api_snippet(
    state: State<'_, AppState>,
    account_id: String,
    model_id: String,
) -> Result<String, String> {
    let account = lock_config(&state)
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

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> Result<(), String> {
    let u = url.trim();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("只允许打开 http/https 链接".into());
    }
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(u, None::<&str>)
        .map_err(|e| format!("打开链接失败：{e}"))
}

#[tauri::command]
pub fn app_info(state: State<'_, AppState>) -> serde_json::Value {
    serde_json::json!({
        "version": crate::version::display_version(),
        "configDir": state.store.dir().to_string_lossy(),
        "storageIssues": state.store.read_issues(),
    })
}

#[tauri::command]
pub fn show_main_window(app: AppHandle, account: Option<String>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    // 可按账户 id 定位编辑面板
    if let Some(id) = account.filter(|s| !s.trim().is_empty()) {
        let _ = app.emit("focus-account", id);
    }
}
