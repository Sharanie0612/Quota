//! Xiaomi login uses a private webview. Remote pages have no Quota command permissions.
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use crate::commands::AppState;

#[path = "mimo_login.rs"]
mod mimo_login;

#[derive(serde::Serialize)]
pub struct MimoConnection {
    id: String,
    label: String,
}

#[tauri::command]
pub fn list_mimo_connections(state: tauri::State<'_, AppState>) -> Result<Vec<MimoConnection>, String> {
    let accounts = state.config.lock().map_err(|_| "读取小米账户失败")?.accounts.clone();
    Ok(accounts.into_iter().filter(|a| matches!(a.provider.as_str(), "mimo" | "mimo-plan")
        && crate::secrets::has_console_cookie(&a.id))
        .map(|a| MimoConnection { id: a.id, label: a.label }).collect())
}

#[tauri::command]
pub async fn reuse_mimo_connection(app: AppHandle, account_id: String, provider: String) -> Result<String, String> {
    if !matches!(provider.as_str(), "mimo" | "mimo-plan") { return Err("请选择小米账户".into()); }
    let state = app.state::<AppState>();
    let valid = state.config.lock().map_err(|_| "读取小米账户失败")?.accounts.iter()
        .any(|a| a.id == account_id && matches!(a.provider.as_str(), "mimo" | "mimo-plan"));
    if !valid { return Err("原小米账户已删除，请重新选择".into()); }
    let cookie = crate::secrets::get_console_cookie(&account_id).ok_or("原账户没有登录信息，请重新登录小米")?;
    crate::mimo::fetch_console(&state.http, &cookie, &provider).await?;
    stage_mimo_connection(&state, &cookie, provider)
}

fn stage_mimo_connection(state: &AppState, cookie: &str, provider: String) -> Result<String, String> {
    let mut pending = state.pending_connections.lock().map_err(|_| "连接失败，请重试")?;
    let id = uuid::Uuid::new_v4().to_string();
    crate::secrets::set_console_cookie(&id, cookie)?;
    pending.insert(id.clone(), provider);
    Ok(id)
}

/// Reconnecting either card renews the exact same login's peer cards only.
pub fn update_mimo_cookie(state: &AppState, account_id: &str, cookie: &str) -> Result<(), String> {
    let accounts = state.config.lock().map_err(|_| "读取小米账户失败")?.accounts.clone();
    let old_cookie = crate::secrets::get_console_cookie(account_id);
    let mut ids = vec![account_id.to_string()];
    if let Some(old) = old_cookie.filter(|value| !value.is_empty()) {
        for account in accounts.iter().filter(|a| a.id != account_id && matches!(a.provider.as_str(), "mimo" | "mimo-plan")) {
            if crate::secrets::get_console_cookie(&account.id).as_deref() == Some(old.as_str()) { ids.push(account.id.clone()); }
        }
    }
    let previous = ids.iter().map(|id| crate::secrets::get_secrets(id).map(|blob| (id.clone(), blob))).collect::<Result<Vec<_>,_>>()?;
    for (index, id) in ids.iter().enumerate() {
        if let Err(error) = crate::secrets::set_console_cookie(id, cookie) {
            let mut failed = false;
            for (id, blob) in previous.iter().take(index) { failed |= crate::secrets::restore(id, blob).is_err(); }
            return Err(if failed { "更新小米登录失败，请重新连接".into() } else { error });
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn start_mimo_login(app: AppHandle) -> Result<(), String> {
    if let Some(w) = app.get_webview_window("mimo-login") {
        w.set_focus().map_err(|_| "无法打开登录窗口")?;
        return Ok(());
    }
    let popup_app = app.clone();
    WebviewWindowBuilder::new(&app, "mimo-login", WebviewUrl::External(
        "https://platform.xiaomimimo.com/".parse().map_err(|_| "无法打开登录页")?))
        .title("登录小米 · 登录后返回 Quota 点击完成连接")
        .inner_size(1000.0, 760.0).incognito(true)
        .on_navigation(mimo_login::allows_navigation)
        .on_new_window(move |url, _| {
            if mimo_login::allows_navigation(&url) {
                // Keep OAuth redirects and cookies in the original private session.
                // Queue navigation: navigating inside WebView2's callback can deadlock.
                let app = popup_app.clone();
                tauri::async_runtime::spawn(async move {
                    let target_app = app.clone();
                    let _ = app.run_on_main_thread(move || {
                        if let Some(window) = target_app.get_webview_window("mimo-login") {
                            let _ = window.navigate(url);
                            let _ = window.set_focus();
                        }
                    });
                });
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build().map_err(|_| "无法打开登录窗口，请重试")?;
    Ok(())
}

#[tauri::command]
pub async fn cancel_mimo_login(app: AppHandle) {
    if let Some(w) = app.get_webview_window("mimo-login") { let _ = w.close(); }
}

// Stage the cookie in the OS credential manager. The renderer only receives an opaque UUID.
#[tauri::command]
pub async fn finish_mimo_login(app: AppHandle, provider: String) -> Result<String, String> {
    if !matches!(provider.as_str(), "mimo" | "mimo-plan") { return Err("请选择小米账户".into()); }
    let w = app.get_webview_window("mimo-login").ok_or("请先打开小米登录")?;
    let url = "https://platform.xiaomimimo.com/api/v1/balance".parse().map_err(|_| "无法读取登录")?;
    let cookies = w.cookies_for_url(url).map_err(|_| "无法读取登录，请重试")?;
    if cookies.is_empty() { return Err("请先在登录窗口完成登录".into()); }
    let cookie = cookies.iter().map(|c| format!("{}={}", c.name(), c.value())).collect::<Vec<_>>().join("; ");
    let state = app.state::<AppState>();
    crate::mimo::fetch_console(&state.http, &cookie, &provider).await
        .map_err(|_| "尚未连接，请完成小米登录后重试")?;
    let id = stage_mimo_connection(&state, &cookie, provider)?;
    let _ = w.close();
    Ok(id)
}

#[tauri::command]
pub async fn connect_chatgpt(app: AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();
    let (_, account) = crate::subscription::fetch(&state.http, None).await?;
    let id = uuid::Uuid::new_v4().to_string();
    crate::secrets::set_subscription_account(&id, &account)?;
    state.pending_connections.lock().map_err(|_| "连接失败，请重试")?.insert(id.clone(), "custom".into());
    Ok(id)
}

#[tauri::command]
pub fn discard_connection(state: tauri::State<'_, AppState>, id: String) -> Result<(), String> {
    if state.pending_connections.lock().map_err(|_| "连接状态不可用")?.remove(&id).is_some() {
        crate::secrets::delete(&id)?;
    }
    Ok(())
}
