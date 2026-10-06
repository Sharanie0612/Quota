mod aliyun;
pub mod activity;
pub mod account_sync;
pub mod data_export;
pub mod official_prices;
pub mod official_tables;
mod backup;
mod catalog;
mod commands;
mod connections;
pub mod migration;
mod subscription;
mod version;
mod exchange;
mod ladder;
mod custom;
mod history;
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
pub use catalog::{cards_for_account, comparison_entries, embedded_file, hidden_keys, is_hidden, merge_cards, normalize};
pub use catalog::{save_entry as save_catalog_override, validate_entry as validate_catalog_entry};
pub use mimo::{parse_balance, parse_plan_detail, parse_token_plan_usage, MimoMoney, PlanInfo, QuotaItem};
pub use model::{Account, AccountInput, AccountStatus, AppConfig, CatalogEntry, RemoteModel};
pub use model::{Balance, BalanceAmount};
pub use commands::apply_manual_balance;
pub use commands::AppState;
pub use connections::update_mimo_cookie;
pub use storage::Store;
pub use proxy::system_proxy_url;
pub use proxy::parse_macos_proxy;
pub use providers::{fetch_balance, find, parse_zhipu_report};
pub use secrets::get_secrets;
pub use subscription::parse_usage as parse_subscription_usage;
pub use ladder::parse_rankings as parse_ladder_rankings;
pub use ladder::{load as load_ladder, with_overrides as ladder_with_overrides};
pub use backup::{open as open_backup, seal as seal_backup};
pub use version::display_version;
pub use exchange::parse_reference as parse_exchange_reference;
pub use pricing::{build_comparison, PageScan};

use tauri::{Manager, WindowEvent};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let store = storage::Store::new().map_err(|e| -> Box<dyn std::error::Error> {
                e.into()
            })?;
            let config = store.load_config();
            let overrides = store.load_overrides();
            app.manage(commands::AppState::new(store, config, overrides));
            tray::setup(app.handle())?;
            refresh::spawn(app.handle().clone());
            ladder::spawn(app.handle().clone());
            activity::spawn(app.handle().clone());
            account_sync::spawn(app.handle().clone());
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
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            exchange::get_exchange_rate,
            activity::get_activity,
            activity::get_activity_options,
            activity::refresh_activity,
            activity::save_activity_options,
            ladder::get_ladder,
            ladder::refresh_ladder,
            ladder::check_ladder_price,
            ladder::adopt_ladder_price,
            connections::start_mimo_login,
            connections::list_mimo_connections,
            connections::reuse_mimo_connection,
            connections::finish_mimo_login,
            connections::cancel_mimo_login,
            connections::connect_chatgpt,
            connections::discard_connection,
            commands::list_providers,
            commands::list_accounts,
            commands::save_account,
            commands::delete_account,
            commands::refresh_account,
            commands::refresh_all,
            commands::get_settings,
            commands::save_settings,
            commands::get_balance_history,
            commands::export_backup,
            data_export::export_data,
            data_export::export_activity_sync,
            account_sync::get_account_sync_status,
            account_sync::sync_accounts,
            data_export::import_activity_sync,
            migration::preview_import,
            migration::import_data,
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
        ])
        .run(tauri::generate_context!())
        .expect("Quota 启动失败");
}
