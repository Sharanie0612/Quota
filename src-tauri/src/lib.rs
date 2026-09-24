mod aliyun;
mod catalog;
mod commands;
mod custom;
mod mimo;
mod model;
mod pricing;
mod proxy;
mod providers;
mod refresh;
mod secrets;
mod storage;
mod tray;

// 暴露给 examples/：本机跑不了 cargo test，用 example 真正执行解析与网络查询
pub use catalog::{cards_for_account, embedded_file, hidden_keys, is_hidden, merge_cards, normalize};
pub use mimo::{parse_balance, parse_plan_detail, parse_token_plan_usage, MimoMoney, PlanInfo, QuotaItem};
pub use model::{CatalogEntry, RemoteModel};
pub use proxy::system_proxy_url;
pub use providers::{fetch_balance, find, parse_zhipu_report};
pub use secrets::get_secrets;

use tauri::{Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let store = storage::Store::new().map_err(|e| -> Box<dyn std::error::Error> {
                e.into()
            })?;
            let config = store.load_config();
            let overrides = store.load_overrides();
            app.manage(commands::AppState::new(store, config, overrides));
            tray::setup(app.handle())?;
            refresh::spawn(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    if window.label() == "main" {
                        let close_to_tray = window
                            .state::<commands::AppState>()
                            .config
                            .lock()
                            .map(|c| c.settings.close_to_tray)
                            .unwrap_or(false);
                        if close_to_tray {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                    }
                }
                // 悬浮卡失去焦点（点到别处）时自动收起
                WindowEvent::Focused(false) => {
                    if window.label() == "tray" {
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_providers,
            commands::list_accounts,
            commands::save_account,
            commands::delete_account,
            commands::refresh_account,
            commands::refresh_all,
            commands::get_settings,
            commands::save_settings,
            commands::model_cards,
            commands::save_catalog_entry,
            commands::reset_catalog_overrides,
            commands::set_model_hidden,
            commands::compare_prices,
            commands::probe_custom_balance,
            commands::api_snippet,
            commands::open_external,
            commands::app_info,
            commands::show_main_window,
            commands::resize_popup,
            commands::hide_popup,
        ])
        .run(tauri::generate_context!())
        .expect("AgentPrice 启动失败");
}
