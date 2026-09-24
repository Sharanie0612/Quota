//! 后台自动刷新循环：按设置的时间间隔查询所有账户余额，
//! 余额低于阈值时发系统通知（同一账户 6 小时内只提醒一次）。

use crate::commands::{self, AppState};
use chrono::Local;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

const RENOTIFY_SECONDS: i64 = 6 * 3600;

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // 启动后稍等，避免和界面首屏渲染抢资源
        tokio::time::sleep(Duration::from_secs(3)).await;
        loop {
            let (auto, minutes) = {
                let state = app.state::<AppState>();
                let cfg = state.config.lock().map(|c| c.settings.clone());
                match cfg {
                    Ok(s) => (s.auto_refresh, s.refresh_interval_minutes.clamp(1, 1440)),
                    Err(_) => (true, 30),
                }
            };

            if auto {
                run_cycle(&app).await;
            }

            let sleep_minutes = if auto { minutes } else { 10 };
            tokio::time::sleep(Duration::from_secs(sleep_minutes as u64 * 60)).await;
        }
    });
}

pub async fn run_cycle(app: &AppHandle) {
    let views = {
        let state = app.state::<AppState>();
        commands::refresh_all_inner(&state).await
    };

    let _ = app.emit("accounts-updated", ());

    // 注意：这里不复用 State 局部变量持有 MutexGuard，避免守卫比 State 活得更久
    let notify_enabled = app
        .state::<AppState>()
        .config
        .lock()
        .map(|c| c.settings.notify_low_balance)
        .unwrap_or(false);
    if !notify_enabled {
        return;
    }

    for view in views.iter().filter(|v| v.low) {
        let should_notify = {
            let state = app.state::<AppState>();
            let lock = state.low_notified.lock();
            match lock {
                Ok(mut map) => {
                    let now = Local::now().timestamp();
                    let last = map.get(&view.id).copied().unwrap_or(0);
                    if now - last > RENOTIFY_SECONDS {
                        map.insert(view.id.clone(), now);
                        true
                    } else {
                        false
                    }
                }
                Err(_) => false,
            }
        };
        if !should_notify {
            continue;
        }

        let balance = view.status.balance.as_ref();
        let total = balance.and_then(|b| b.total).unwrap_or(0.0);
        let currency = balance.map(|b| b.currency.clone()).unwrap_or_default();
        let source_hint = match balance.map(|b| b.source.as_str()) {
            Some("manual") => "（手动余额）",
            _ => "",
        };
        let _ = app
            .notification()
            .builder()
            .title(format!("{} 余额不足", view.label))
            .body(format!(
                "{} 当前余额 {:.2} {}{}，已低于提醒阈值 {:.2}。打开主面板即可一键跳转充值。",
                view.provider_name, total, currency, source_hint, view.low_balance_threshold
            ))
            .show();
    }
}
