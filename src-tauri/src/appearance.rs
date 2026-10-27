use crate::commands::AppState;
use serde::{Deserialize, Serialize};
use tauri::{Emitter, State};
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Preferences {
    pub theme: String,
    pub mode: String,
    pub collapsed: bool,
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
    let _ = app.emit("appearance-updated", preferences);
    Ok(())
}
