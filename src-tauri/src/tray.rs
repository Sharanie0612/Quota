//! 系统托盘：托盘图标 + 右键菜单 + 余额悬浮卡窗口。

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, LogicalSize, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder,
};

const POPUP_W: f64 = 364.0;
/// 悬浮卡高度按账户数量自适应，由前端算好后调用 resize_popup
const POPUP_DEFAULT_H: f64 = 400.0;
const POPUP_MIN_H: f64 = 264.0;
const POPUP_MAX_H: f64 = 620.0;

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let popup_item = MenuItem::with_id(app, "popup", "余额悬浮卡", true, None::<&str>)?;
    let show_item = MenuItem::with_id(app, "show", "打开主面板", true, None::<&str>)?;
    let refresh_item = MenuItem::with_id(app, "refresh", "立即刷新余额", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 AgentPrice", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&popup_item, &show_item, &refresh_item, &separator, &quit_item],
    )?;

    let mut builder = TrayIconBuilder::with_id("agentprice-tray")
        .tooltip("AgentPrice · 模型账户管家")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "popup" => toggle_popup(app),
            "show" => show_main(app),
            "refresh" => {
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    crate::refresh::run_cycle(&handle).await;
                });
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_popup(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
    hide_popup(app);
}

pub fn hide_popup(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("tray") {
        let _ = w.hide();
    }
}

/// 按前端算出的内容高度调整悬浮卡窗口，并重新摆到鼠标附近。
/// 账户少的时候窗口就矮一点，不留下大片空白。
pub fn resize_popup(app: &AppHandle, height: f64) {
    let Some(window) = app.get_webview_window("tray") else {
        return;
    };
    let h = height.clamp(POPUP_MIN_H, POPUP_MAX_H);
    let _ = window.set_size(LogicalSize::new(POPUP_W, h));
    position_popup(app, &window, h);
}

/// 点击托盘图标：显示/隐藏余额悬浮卡（首次点击时创建窗口）
pub fn toggle_popup(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("tray") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            position_popup(app, &window, current_height(&window));
            let _ = window.show();
            let _ = window.set_focus();
        }
        return;
    }

    let built = WebviewWindowBuilder::new(app, "tray", WebviewUrl::App("index.html".into()))
        .title("AgentPrice")
        .inner_size(POPUP_W, POPUP_DEFAULT_H)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .shadow(true)
        .visible(false)
        .build();

    match built {
        Ok(window) => {
            position_popup(app, &window, POPUP_DEFAULT_H);
            let _ = window.show();
            let _ = window.set_focus();
        }
        Err(e) => eprintln!("[AgentPrice] 创建悬浮卡窗口失败：{e}"),
    }
}

/// 读取窗口当前的逻辑高度（取不到时退回默认值）
fn current_height(window: &tauri::WebviewWindow) -> f64 {
    window
        .outer_size()
        .ok()
        .map(|size| {
            let scale = window.scale_factor().unwrap_or(1.0);
            size.height as f64 / scale
        })
        .filter(|h| *h > 0.0)
        .unwrap_or(POPUP_DEFAULT_H)
}

/// 把悬浮卡放到鼠标附近（托盘通常在屏幕右下角），并保证不超出屏幕
fn position_popup(app: &AppHandle, window: &tauri::WebviewWindow, height: f64) {
    let Some(cursor) = app.cursor_position().ok() else {
        return;
    };
    let monitor = app
        .monitor_from_point(cursor.x, cursor.y)
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return;
    };

    let scale = monitor.scale_factor();
    let size = monitor.size();
    let origin = monitor.position();

    let popup_w = (POPUP_W * scale) as i32;
    let popup_h = (height * scale) as i32;

    // 默认放在光标左上方一点（避免盖住托盘图标）
    let mut x = cursor.x as i32 - popup_w / 2;
    let mut y = cursor.y as i32 - popup_h - (12.0 * scale) as i32;

    let min_x = origin.x + (8.0 * scale) as i32;
    let max_x = origin.x + size.width as i32 - popup_w - (8.0 * scale) as i32;
    let min_y = origin.y + (8.0 * scale) as i32;
    let max_y = origin.y + size.height as i32 - popup_h - (8.0 * scale) as i32;

    x = x.clamp(min_x.min(max_x), max_x.max(min_x));
    y = y.clamp(min_y.min(max_y), max_y.max(min_y));

    let _ = window.set_position(PhysicalPosition::new(x, y));
}
