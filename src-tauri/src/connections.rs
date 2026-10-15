//! Xiaomi login uses a private webview. Remote pages have no Quota command permissions.
use crate::commands::AppState;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
static MIMO_APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();
pub fn set_app_handle(app: AppHandle) {
    let _ = MIMO_APP.set(app);
}

#[path = "mimo_login.rs"]
mod mimo_login;

#[derive(serde::Serialize)]
pub struct MimoConnection {
    id: String,
    label: String,
}

#[tauri::command]
pub fn list_mimo_connections(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<MimoConnection>, String> {
    let accounts = state
        .config
        .lock()
        .map_err(|_| "读取小米账户失败")?
        .accounts
        .clone();
    Ok(accounts
        .into_iter()
        .filter(|a| {
            matches!(a.provider.as_str(), "mimo" | "mimo-plan")
                && crate::secrets::has_console_cookie(&a.id)
        })
        .map(|a| MimoConnection {
            id: a.id,
            label: a.label,
        })
        .collect())
}

#[tauri::command]
pub async fn reuse_mimo_connection(
    app: AppHandle,
    account_id: String,
    provider: String,
) -> Result<String, String> {
    if !matches!(provider.as_str(), "mimo" | "mimo-plan") {
        return Err("请选择小米账户".into());
    }
    let state = app.state::<AppState>();
    let valid = state
        .config
        .lock()
        .map_err(|_| "读取小米账户失败")?
        .accounts
        .iter()
        .any(|a| a.id == account_id && matches!(a.provider.as_str(), "mimo" | "mimo-plan"));
    if !valid {
        return Err("原小米账户已删除，请重新选择".into());
    }
    if !crate::secrets::has_console_cookie(&account_id) {
        return Err("原账户没有登录信息，请重新登录小米".into());
    }
    query_mimo(&state, &account_id, &provider).await?;
    let cookie = crate::secrets::get_console_cookie(&account_id).ok_or("小米登录已失效")?;
    let id = stage_mimo_connection(&state, &cookie, provider)?;
    let mut staged = crate::secrets::get_secrets(&id)?;
    staged.mimo_session = crate::secrets::get_secrets(&account_id)?.mimo_session;
    crate::secrets::restore(&id, &staged)?;
    Ok(id)
}

fn stage_mimo_connection(
    state: &AppState,
    cookie: &str,
    provider: String,
) -> Result<String, String> {
    let mut pending = state
        .pending_connections
        .lock()
        .map_err(|_| "连接失败，请重试")?;
    let id = uuid::Uuid::new_v4().to_string();
    crate::secrets::set_console_cookie(&id, cookie)?;
    pending.insert(id.clone(), provider);
    Ok(id)
}

/// Reconnecting either card renews the exact same login's peer cards only.
pub fn update_mimo_cookie(state: &AppState, account_id: &str, cookie: &str) -> Result<(), String> {
    update_mimo_connection(state, account_id, cookie, None)
}
pub fn update_mimo_connection(
    state: &AppState,
    account_id: &str,
    cookie: &str,
    session: Option<&str>,
) -> Result<(), String> {
    let accounts = state
        .config
        .lock()
        .map_err(|_| "读取小米账户失败")?
        .accounts
        .clone();
    let old_cookie = crate::secrets::get_console_cookie(account_id);
    let mut ids = vec![account_id.to_string()];
    if let Some(old) = old_cookie.filter(|value| !value.is_empty()) {
        for account in accounts
            .iter()
            .filter(|a| a.id != account_id && matches!(a.provider.as_str(), "mimo" | "mimo-plan"))
        {
            if crate::secrets::get_console_cookie(&account.id).as_deref() == Some(old.as_str()) {
                ids.push(account.id.clone());
            }
        }
    }
    let previous = ids
        .iter()
        .map(|id| crate::secrets::get_secrets(id).map(|blob| (id.clone(), blob)))
        .collect::<Result<Vec<_>, _>>()?;
    for (index, id) in ids.iter().enumerate() {
        let mut next = previous[index].1.clone();
        next.console_cookie = if cookie.is_empty() {
            None
        } else {
            Some(cookie.into())
        };
        if let Some(reference) = session {
            next.mimo_session = Some(reference.into());
        }
        if let Err(error) = crate::secrets::restore(id, &next) {
            let mut failed = false;
            for (id, blob) in previous.iter().take(index) {
                failed |= crate::secrets::restore(id, blob).is_err();
            }
            return Err(if failed {
                "更新小米登录失败，请重新连接".into()
            } else {
                error
            });
        }
    }
    Ok(())
}

async fn open_login_window(
    app: &AppHandle,
    label: &str,
    visible: bool,
    payload: Option<String>,
) -> Result<tauri::WebviewWindow, String> {
    let cookies = payload
        .as_deref()
        .map(crate::mimo_session::decode)
        .transpose()?
        .unwrap_or_default();
    let app = app.clone();
    let label = label.to_string();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let owner = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            let popup_app = owner.clone();
            let popup_label = label.clone();
            let window = WebviewWindowBuilder::new(
                &owner,
                &label,
                WebviewUrl::External("about:blank".parse().map_err(|_| "无法打开登录页")?),
            )
            .title("登录小米 · 完成登录后自动连接 Quota")
            .inner_size(1000.0, 760.0)
            .visible(visible)
            .incognito(true)
            .on_navigation(|url| {
                url.as_str() == "about:blank" || mimo_login::allows_navigation(url)
            })
            .on_new_window(move |url, _| {
                if mimo_login::allows_navigation(&url) {
                    // Keep OAuth redirects and cookies in the original private session.
                    // Queue navigation: navigating inside WebView2's callback can deadlock.
                    let app = popup_app.clone();
                    let popup_label = popup_label.clone();
                    tauri::async_runtime::spawn(async move {
                        let target_app = app.clone();
                        let _ = app.run_on_main_thread(move || {
                            if let Some(window) = target_app.get_webview_window(&popup_label) {
                                let _ = window.navigate(url);
                                if visible {
                                    let _ = window.set_focus();
                                }
                            }
                        });
                    });
                }
                tauri::webview::NewWindowResponse::Deny
            })
            .build()
            .map_err(|_| "无法打开小米登录窗口")?;
            for cookie in cookies {
                if let Err(_) = window.set_cookie(cookie) {
                    let _ = window.close();
                    return Err("无法恢复小米会话".into());
                }
            }
            if window
                .navigate(
                    "https://platform.xiaomimimo.com/"
                        .parse()
                        .map_err(|_| "无法打开登录页")?,
                )
                .is_err()
            {
                let _ = window.close();
                return Err("无法打开小米登录页".into());
            }
            Ok(window)
        })();
        let _ = sender.send(result);
    })
    .map_err(|_| "无法打开小米登录窗口")?;
    receiver.await.map_err(|_| "小米登录任务中断")?
}
#[tauri::command]
pub async fn start_mimo_login(app: AppHandle, account_id: Option<String>) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("mimo-login") {
        window.set_focus().map_err(|_| "无法打开登录窗口")?;
        return Ok(());
    }
    let state = app.state::<AppState>();
    let payload = {
        let _guard = state.mimo_refresh_lock.lock().await;
        if let Some(id) = account_id {
            if !state
                .config
                .lock()
                .map_err(|_| "读取账户失败")?
                .accounts
                .iter()
                .any(|a| a.id == id && matches!(a.provider.as_str(), "mimo" | "mimo-plan"))
            {
                return Err("原小米账户不存在".into());
            }
            crate::secrets::get_mimo_session(&id)?
        } else {
            None
        }
    };
    state.mimo_login_generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    open_login_window(&app, "mimo-login", true, payload).await?;
    Ok(())
}
#[tauri::command]
pub async fn cancel_mimo_login(app: AppHandle) {
    app.state::<AppState>().mimo_login_generation.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    if let Some(w) = app.get_webview_window("mimo-login") {
        let _ = w.close();
    }
}

// Stage the cookie in the OS credential manager. The renderer only receives an opaque UUID.
#[tauri::command]
pub async fn finish_mimo_login(app: AppHandle, provider: String) -> Result<String, String> {
    let status = poll_mimo_login(app, provider).await?;
    status.connection_id.ok_or(status.message)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
    pub state: &'static str,
    pub message: String,
    pub connection_id: Option<String>,
}

#[tauri::command]
pub async fn poll_mimo_login(app: AppHandle, provider: String) -> Result<LoginStatus, String> {
    if !matches!(provider.as_str(), "mimo" | "mimo-plan") {
        return Err("请选择小米账户".into());
    }
    let state = app.state::<AppState>();
    let _guard = state.mimo_login_lock.lock().await;
    let generation = state.mimo_login_generation.load(std::sync::atomic::Ordering::SeqCst);
    let waiting = |message: &str| LoginStatus { state: "waiting", message: message.into(), connection_id: None };
    let Some(w) = app.get_webview_window("mimo-login") else {
        return Ok(LoginStatus { state: "closed", message: "登录窗口已关闭，可重新打开".into(), connection_id: None });
    };
    let current = w.url().map_err(|_| "无法读取登录窗口状态")?;
    if current.host_str() != Some("platform.xiaomimimo.com") {
        return Ok(waiting("请在官方窗口完成登录，返回后会自动连接"));
    }
    let url = "https://platform.xiaomimimo.com/api/v1/balance"
        .parse()
        .map_err(|_| "无法读取登录")?;
    let cookies = w.cookies_for_url(url).map_err(|_| "无法读取登录，请重试")?;
    if cookies.is_empty() {
        return Ok(waiting("正在等待小米登录完成…"));
    }
    let mut cookie = cookies
        .iter()
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect::<Vec<_>>()
        .join("; ");
    let mut updates = vec![];
    if !crate::mimo::validate_login_tracked(&state.http, &mut cookie, &mut updates).await? {
        return Ok(waiting("登录尚未完成，请等待官网返回控制台后自动连接"));
    }
    if app.get_webview_window("mimo-login").is_none()
        || generation != state.mimo_login_generation.load(std::sync::atomic::Ordering::SeqCst) {
        return Ok(waiting("登录已取消，可重新打开窗口"));
    }
    let payload = crate::mimo_session::encode(w.cookies().map_err(|_| "无法读取小米会话")?)?;
    let payload = crate::mimo_session::update(Some(&payload), &updates)?;
    let id = stage_mimo_connection(&state, &cookie, provider)?;
    if let Err(error) = crate::secrets::save_mimo_session(&id, &payload) {
        let _ = crate::secrets::delete(&id);
        state
            .pending_connections
            .lock()
            .map_err(|_| "连接状态不可用")?
            .remove(&id);
        return Err(error);
    }
    let _ = w.close();
    Ok(LoginStatus { state: "connected", message: "已连接，保存账户后开始同步".into(), connection_id: Some(id) })
}

#[tauri::command]
pub async fn connect_chatgpt(app: AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();
    let (_, account) = crate::subscription::fetch(&state.http, None).await?;
    let id = uuid::Uuid::new_v4().to_string();
    crate::secrets::set_subscription_account(&id, &account)?;
    state
        .pending_connections
        .lock()
        .map_err(|_| "连接失败，请重试")?
        .insert(id.clone(), "custom".into());
    Ok(id)
}

#[tauri::command]
pub fn discard_connection(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    if state
        .pending_connections
        .lock()
        .map_err(|_| "连接状态不可用")?
        .remove(&id)
        .is_some()
    {
        crate::secrets::delete(&id)?;
    }
    Ok(())
}

async fn query_and_save(
    state: &AppState,
    id: &str,
    provider: &str,
) -> Result<crate::model::Balance, String> {
    let old =
        crate::secrets::get_console_cookie(id).ok_or("小米登录已过期，请编辑账户并重新登录")?;
    let mut cookie = old.clone();
    let mut updates = vec![];
    let result =
        crate::mimo::fetch_console_tracked(&state.http, &mut cookie, &mut updates, provider).await;
    if !updates.is_empty() {
        let payload = crate::mimo_session::update(
            crate::secrets::get_mimo_session(id)?.as_deref(),
            &updates,
        )?;
        crate::secrets::save_mimo_session(id, &payload)?;
    }
    if cookie != old || !updates.is_empty() {
        let session = crate::secrets::get_secrets(id)?.mimo_session;
        update_mimo_connection(state, id, &cookie, session.as_deref())?;
    }
    result
}
pub async fn query_mimo(
    state: &AppState,
    id: &str,
    provider: &str,
) -> Result<crate::model::Balance, String> {
    let _guard = state.mimo_refresh_lock.lock().await;
    let result = query_and_save(state, id, provider).await;
    if result
        .as_ref()
        .err()
        .is_none_or(|e| !e.contains("小米登录已过期"))
    {
        return result;
    }
    let Some(app) = MIMO_APP.get() else {
        return result;
    };
    let Some(payload) = crate::secrets::get_mimo_session(id)? else {
        return result;
    };
    {
        let mut attempts = state
            .mimo_recovery_attempts
            .lock()
            .map_err(|_| "小米连接状态不可用")?;
        if attempts
            .get(id)
            .is_some_and(|at| at.elapsed() < std::time::Duration::from_secs(1800))
        {
            return result;
        }
        attempts.insert(id.into(), std::time::Instant::now());
    }
    let label = format!("mimo-recover-{}", uuid::Uuid::new_v4());
    let window = open_login_window(app, &label, false, Some(payload)).await?;
    let recovered = tokio::time::timeout(std::time::Duration::from_secs(20), async {
        for attempt in 0..12 {
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
            if attempt % 3 != 2 {
                continue;
            }
            let cookies = window
                .cookies_for_url(
                    "https://platform.xiaomimimo.com/api/v1/balance"
                        .parse()
                        .map_err(|_| "无法读取小米登录")?,
                )
                .map_err(|_| "无法恢复小米登录")?;
            if cookies.is_empty() {
                continue;
            }
            let mut cookie = cookies
                .iter()
                .map(|c| format!("{}={}", c.name(), c.value()))
                .collect::<Vec<_>>()
                .join("; ");
            let mut updates = vec![];
            if let Ok(balance) =
                crate::mimo::fetch_console_tracked(&state.http, &mut cookie, &mut updates, provider)
                    .await
            {
                let payload =
                    crate::mimo_session::encode(window.cookies().map_err(|_| "无法读取小米会话")?)?;
                let payload = crate::mimo_session::update(Some(&payload), &updates)?;
                crate::secrets::save_mimo_session(id, &payload)?;
                let session = crate::secrets::get_secrets(id)?.mimo_session;
                update_mimo_connection(state, id, &cookie, session.as_deref())?;
                return Ok(balance);
            }
        }
        Err("小米登录已过期，自动恢复未成功；请编辑账户并重新登录".into())
    })
    .await
    .unwrap_or_else(|_| Err("小米登录已过期，自动恢复超时；请编辑账户并重新登录".into()));
    let _ = window.close();
    recovered
}
