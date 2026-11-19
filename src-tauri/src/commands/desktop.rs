//! 主窗口、通用设置和应用信息的 Tauri 接口。

use crate::{model::Settings, tray, AppState};
use tauri::{AppHandle, Emitter, Manager, State};

#[tauri::command]
pub fn get_main_window_chrome(
    window: tauri::WebviewWindow,
) -> Result<crate::window_frame::ChromeStatus, String> {
    if window.label() != "main" {
        return Err("只能读取主窗口边框状态".into());
    }
    Ok(crate::window_frame::chrome_status(window.app_handle()))
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.config_snapshot().settings
}

#[tauri::command]
pub fn save_settings(
    state: State<'_, AppState>,
    app: AppHandle,
    settings: Settings,
) -> Result<Settings, String> {
    let mut cfg = state
        .config
        .lock()
        .map_err(|_| "配置锁定失败".to_string())?;
    let mut next = settings;
    if !next.default_low_threshold.is_finite() || next.default_low_threshold < 0.0 {
        return Err("默认提醒阈值须为有限非负数".into());
    }
    next.refresh_interval_minutes = next.refresh_interval_minutes.clamp(1, 1440);
    next.default_low_threshold = next.default_low_threshold.max(0.0);
    state
        .store
        .update_config(&mut cfg, |config| config.settings = next.clone())?;
    drop(cfg);
    tray::refresh_alert(&app);
    Ok(next)
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
pub fn show_main_window(app: AppHandle, account: Option<String>, view: Option<String>) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    if let Some(view) = view.filter(|v| {
        matches!(
            v.as_str(),
            "output-speed" | "activity" | "costs" | "settings"
        )
    }) {
        let _ = app.emit("navigate-main", view);
    }
    // 可按账户 id 定位编辑面板
    if let Some(id) = account.filter(|s| !s.trim().is_empty()) {
        let _ = app.emit("focus-account", id);
    }
}
