//! 系统托盘：单击打开主窗口，右键提供刷新与退出。

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "打开主面板", true, None::<&str>)?;
    let refresh_item = MenuItem::with_id(app, "refresh", "立即刷新余额", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出 Quota", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&show_item, &refresh_item, &separator, &quit_item],
    )?;

    let mut builder = TrayIconBuilder::with_id("quota-tray")
        .tooltip("Quota · 余额与额度看板")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
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
                show_main(tray.app_handle());
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
}
