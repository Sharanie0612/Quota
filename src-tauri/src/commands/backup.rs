//! 从应用状态组装加密备份并写入用户选择的文件。

use crate::{
    backup, history,
    model::{AppConfig, CatalogEntry},
    secrets, AppState,
};
use chrono::Local;
use std::collections::HashMap;
use tauri::State;

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
    let config = state.config_snapshot();
    let overrides = state
        .overrides
        .lock()
        .map_err(|_| "资料库锁定失败".to_string())?
        .clone();
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
        balance_history: state
            .history
            .lock()
            .map_err(|_| "余额历史暂不可用")?
            .export_points(),
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
