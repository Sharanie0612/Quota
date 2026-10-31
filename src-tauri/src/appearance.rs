use crate::commands::AppState;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
#[cfg(windows)]
use tauri::Manager;

#[derive(Serialize)]
pub struct MainMaterial {
    active: bool,
    revision: u64,
}

/// Only the primary renderer may enable desktop composition. The widget keeps
/// its own clipped CSS surface and never receives a whole-window material.
#[tauri::command]
pub fn sync_main_material(
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    revision: u64,
    dark: bool,
    allowed: bool,
) -> Result<MainMaterial, String> {
    if window.label() != "main" { return Err("只能设置主窗口材质".into()); }
    let current = state.appearance.lock().map_err(|_| "外观设置暂不可用")?;
    let stored_revision = current.as_ref().map_or(0, |p| p.revision);
    if stored_revision != revision { return Ok(MainMaterial {active:false,revision:stored_revision}); }
    let enabled = current.as_ref().is_some_and(|p| p.glass) && allowed;
    let dark = current.as_ref().map_or(dark, |p| match p.mode.as_str() {"dark"=>true,"light"=>false,_=>dark});
    let mut applied=state.main_material.lock().map_err(|_| "主窗口材质暂不可用")?;
    if let Some((previous_enabled,previous_dark,active))=*applied {
        if previous_enabled==enabled && previous_dark==dark { return Ok(MainMaterial {active,revision:stored_revision}); }
    }
    #[cfg(windows)]
    let active = {
        let transparent = window.set_background_color(Some(tauri::webview::Color(0,0,0,0))).is_ok();
        if enabled && transparent && crate::window_frame::chrome_ready(window.app_handle()) {
            // Clear blur keeps the desktop's colour and shape without Acrylic's
            // milky noise layer. Local surfaces carry contrast and optical rims.
            let tint = if dark {(18,25,38,144)} else {(255,255,255,116)};
            let _=window_vibrancy::clear_acrylic(&window);
            window_vibrancy::apply_blur(&window,Some(tint)).is_ok()
                || window_vibrancy::apply_acrylic(&window,Some(tint)).is_ok()
        } else { let _=window_vibrancy::clear_blur(&window);let _=window_vibrancy::clear_acrylic(&window);false }
    };
    #[cfg(not(windows))]
    let active = { let _=(enabled,dark);false };
    if !enabled || active { *applied=Some((enabled,dark,active)); }
    Ok(MainMaterial {active,revision:stored_revision})
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preferences {
    pub theme: String,
    pub mode: String,
    pub collapsed: bool,
    #[serde(default)]
    pub glass: bool,
    #[serde(default)]
    pub revision: u64,
}
impl Preferences {
    fn valid(&self) -> bool {
        matches!(
            self.theme.as_str(),
            "codex" | "claude" | "vscode" | "github" | "quota"
        ) && matches!(self.mode.as_str(), "system" | "light" | "dark")
    }
}
pub fn load(dir: &std::path::Path) -> Option<Preferences> {
    std::fs::read(dir.join("appearance.json"))
        .ok()
        .filter(|b| b.len() < 4096)
        .and_then(|bytes| serde_json::from_slice::<Preferences>(&bytes).ok())
        .filter(Preferences::valid)
}
#[tauri::command]
pub fn get_appearance(state: State<'_, AppState>) -> Option<Preferences> {
    state.appearance.lock().ok().and_then(|value| value.clone())
}
#[tauri::command]
pub fn save_appearance(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
    preferences: Preferences,
) -> Result<(), String> {
    if window.label() != "main" || !preferences.valid() {
        return Err("外观设置无效".into());
    }
    let mut current = state.appearance.lock().map_err(|_| "外观设置暂不可用")?;
    if current
        .as_ref()
        .is_some_and(|old| old.revision > preferences.revision)
    {
        return Ok(());
    }
    crate::storage::write_atomic(
        &state.store.dir().join("appearance.json"),
        &serde_json::to_string(&preferences).map_err(|_| "无法编码外观设置")?,
    )?;
    *current = Some(preferences.clone());
    drop(current);
    apply_widget_material(&app,preferences.glass);
    let _ = app.emit("appearance-updated", preferences);
    Ok(())
}

pub fn apply_widget_material(app:&tauri::AppHandle,_enabled:bool){
    #[cfg(windows)]
    {
        use tauri::{Manager,utils::config::WindowEffectsConfig};
        if let Some(window)=app.get_webview_window(crate::widget::LABEL){
            // Acrylic paints the whole fixed HWND, including its transparent
            // padding and collapsed hit region. Keep material inside the one
            // clipped CSS surface so it cannot leave a second floating box.
            let _=window.set_effects(None::<WindowEffectsConfig>);
        }
    }
    #[cfg(not(windows))]
    let _=app;
}
