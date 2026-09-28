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
    let quit_item = MenuItem::with_id(app, "quit", "退出 Quota", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&popup_item, &show_item, &refresh_item, &separator, &quit_item],
    )?;

    let mut builder = TrayIconBuilder::with_id("quota-tray")
        .tooltip("Quota · 余额与额度看板")
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

/// 托盘图标状态角标：有余额不足的账户时，在图标右上角叠一个红点。
/// 图标本身从默认图标（Q logo）的像素数据上实时绘制，不需要额外的资源文件。
pub fn update_alert(app: &AppHandle, low_count: usize) {
    let Some(tray) = app.tray_by_id("quota-tray") else {
        return;
    };
    let icon = if low_count > 0 {
        alert_icon(app)
    } else {
        app.default_window_icon().cloned()
    };
    if let Some(icon) = icon {
        let _ = tray.set_icon(Some(icon));
    }
}

/// 默认图标 + 右上角红点（带白边，深浅背景都可见）
fn alert_icon(app: &AppHandle) -> Option<tauri::image::Image<'static>> {
    let base = app.default_window_icon()?;
    let (w, h) = (base.width() as i32, base.height() as i32);
    let mut rgba = base.rgba().to_vec();

    // 红点圆心放在右上角，直径约图标的 55%
    let cx = (w as f64 * 0.74) as i32;
    let cy = (h as f64 * 0.26) as i32;
    let r_red = w as f64 * 0.24;
    let r_white = r_red * 1.35;

    for y in (cy - r_white as i32 - 1).max(0)..=(cy + r_white as i32 + 1).min(h - 1) {
        for x in (cx - r_white as i32 - 1).max(0)..=(cx + r_white as i32 + 1).min(w - 1) {
            let dx = (x - cx) as f64;
            let dy = (y - cy) as f64;
            let dist = (dx * dx + dy * dy).sqrt();
            let (idx, pixel) = {
                let i = ((y * w + x) * 4) as usize;
                (i, &mut rgba[i..i + 4])
            };
            let _ = idx;
            if dist <= r_red {
                // 系统红 #ff453a
                pixel[0] = 0xff;
                pixel[1] = 0x45;
                pixel[2] = 0x3a;
                pixel[3] = 0xff;
            } else if dist <= r_white {
                // 白色描边圈，叠在图标上时更清晰
                pixel[0] = 0xff;
                pixel[1] = 0xff;
                pixel[2] = 0xff;
                pixel[3] = 0xff;
            }
        }
    }

    Some(tauri::image::Image::new_owned(rgba, w as u32, h as u32))
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
        .title("Quota")
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
        Err(e) => eprintln!("[Quota] 创建悬浮卡窗口失败：{e}"),
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
