mod aliyun;
pub mod activity;
pub mod usage_costs;
pub mod vendor_costs;
pub mod usage_sync;
pub mod usage_fx;
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
pub mod mimo_session;
mod model;
mod pricing;
mod proxy;
mod providers;
mod refresh;
mod secrets;
mod storage;
mod tray;
pub mod widget;
pub mod window_frame;

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
pub use secrets::{get_secrets, SecretBlob, inherit_connection_with, save_mimo_session, get_mimo_session};
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
        .plugin(tauri_plugin_single_instance::init(|app, _, _| tray::show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let store = storage::Store::new().map_err(|e| -> Box<dyn std::error::Error> {
                e.into()
            })?;
            let config = store.load_config();
            let overrides = store.load_overrides();
            let state = commands::AppState::new(store, config, overrides);
            if let Err(error) = account_sync::repair_connections(&state) { account_sync::remember_connection_error(&state, error); }
            connections::set_app_handle(app.handle().clone());
            app.manage(state);
            window_frame::setup(app.handle());
            tray::setup(app.handle())?;
            widget::setup(app.handle())?;
            refresh::spawn(app.handle().clone());
            ladder::spawn(app.handle().clone());
            activity::spawn(app.handle().clone());
            account_sync::spawn(app.handle().clone());
            widget::smoke_if_requested(app.handle());
            window_frame::smoke_if_requested(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, WindowEvent::Resized(_) | WindowEvent::Moved(_) | WindowEvent::ScaleFactorChanged { .. }) {
                let _ = window_frame::update(window);
            }
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
                        } else {
                            window.app_handle().exit(0);
                        }
                    } else if window.label() == widget::LABEL {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            window_frame::get_main_window_state,
            widget::get_widget_options,
            widget::save_widget_options,
            widget::get_widget_usage,
            widget::widget_ready,
            widget::set_widget_expanded,
            widget::move_widget,
            usage_sync::sync_usage_now,
            exchange::get_exchange_rate,
            usage_fx::get_monthly_usage_fx,
            usage_fx::save_monthly_usage_fx,
            activity::get_activity,
            activity::get_sync_overview,
            activity::sync_activity_now,
            activity::get_activity_options,
            activity::refresh_activity,
            activity::save_activity_options,
            activity::ssh::discovery::discover_codex_ssh_hosts,
            activity::ssh::identify_codex_ssh_devices,
            activity::sync_storage::get_activity_storage,
            activity::sync_storage::optimize_activity_storage,
            activity::sync_storage::get_activity_readers,
            activity::sync_storage::rebuild_activity_sync,
            usage_costs::get_usage_prices,
            usage_costs::save_usage_calculation,
            usage_costs::get_usage_bills,
            vendor_costs::get_vendor_costs,
            vendor_costs::save_vendor_expense,
            ladder::get_ladder,
            ladder::refresh_ladder,
            ladder::check_ladder_price,
            ladder::adopt_ladder_price,
            connections::start_mimo_login,
            connections::list_mimo_connections,
            connections::reuse_mimo_connection,
            connections::finish_mimo_login,
            connections::poll_mimo_login,
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
            account_sync::get_account_sync_candidates,
            account_sync::resolve_account_sync,
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
