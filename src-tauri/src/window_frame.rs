//! Shape the actual main window, including Windows 10, without a transparent WebView.
use serde::Serialize;
use tauri::{Emitter, Manager, Window};

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub maximized: bool,
    pub fullscreen: bool,
    pub square: bool,
}

#[derive(Default)]
struct Applied(std::sync::Mutex<Option<(u32, u32, u32, State)>>);

/// A window occupying a work-area corner or edge-to-edge tile has square corners.
/// Coordinates are physical pixels; monitor origins may be negative.
pub fn tiled(rect: (i32, i32, u32, u32), area: (i32, i32, u32, u32), scale: f64) -> bool {
    let (x, y, w, h) = rect;
    let (ax, ay, aw, ah) = area;
    let tolerance = (8.0 * scale.max(1.0)).round() as i64;
    let near = |a: i64, b: i64| (a - b).abs() <= tolerance;
    let left = near(x.into(), ax.into());
    let right = near(i64::from(x) + i64::from(w), i64::from(ax) + i64::from(aw));
    let top = near(y.into(), ay.into());
    let bottom = near(i64::from(y) + i64::from(h), i64::from(ay) + i64::from(ah));
    (top && bottom) || (left && right) || ((left || right) && (top || bottom))
}

fn state(window: &Window) -> Result<(u32, u32, u32, State), String> {
    let size = window.outer_size().map_err(|_| "无法读取窗口大小")?;
    let pos = window.outer_position().map_err(|_| "无法读取窗口位置")?;
    let scale = window.scale_factor().map_err(|_| "无法读取窗口缩放")?;
    let maximized = window.is_maximized().unwrap_or(false);
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let snapped = window.current_monitor().ok().flatten().is_some_and(|monitor| {
        let area = monitor.work_area();
        tiled((pos.x, pos.y, size.width, size.height), (area.position.x, area.position.y, area.size.width, area.size.height), scale)
    });
    let radius = (14.0 * scale).round().max(1.0) as u32;
    Ok((size.width, size.height, radius, State {maximized, fullscreen, square: maximized || fullscreen || snapped}))
}

pub fn update(window: &Window) -> Result<State, String> {
    let (width, height, radius, next) = state(window)?;
    let app = window.app_handle();
    let Some(applied) = app.try_state::<Applied>() else { return Ok(next) };
    let mut previous = applied.0.lock().map_err(|_| "窗口外观暂不可用")?;
    if *previous == Some((width, height, radius, next)) { return Ok(next) }
    #[cfg(windows)] {
        use windows_sys::Win32::Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, SetWindowRgn};
        let hwnd = window.hwnd().map_err(|_| "无法读取窗口句柄")?;
        let region = if next.square { std::ptr::null_mut() } else {
            let region = unsafe { CreateRoundRectRgn(0, 0, width as i32 + 1, height as i32 + 1, radius as i32 * 2, radius as i32 * 2) };
            if region.is_null() { return Err("无法创建圆角窗口区域".into()) }
            region
        };
        // Windows takes ownership on success; release the region ourselves on failure.
        if unsafe { SetWindowRgn(hwnd.0 as _, region, 1) } == 0 {
            if !region.is_null() { unsafe { DeleteObject(region as _); } }
            return Err("无法更新窗口圆角".into())
        }
    }
    let changed = previous.map_or(true, |(_, _, _, old)| old != next);
    *previous = Some((width, height, radius, next));
    drop(previous);
    if changed { let _ = window.emit("main-window-state", next); }
    Ok(next)
}

pub fn setup(app: &tauri::AppHandle) {
    app.manage(Applied::default());
    if let Some(window) = app.get_webview_window("main") { let _ = update(&window.as_ref().window()); }
}

#[tauri::command]
pub fn get_main_window_state(app: tauri::AppHandle) -> Result<State, String> {
    let window = app.get_webview_window("main").ok_or("主窗口尚未准备好")?.as_ref().window();
    state(&window).map(|(_, _, _, state)| state)
}

/// Explicit, isolated runtime check, mirroring the existing widget smoke workflow.
#[cfg(windows)]
pub fn smoke_if_requested(app: &tauri::AppHandle) {
    if std::env::var("QUOTA_FRAME_SMOKE").as_deref() != Ok("1") || std::env::var_os("QUOTA_DATA_DIR").is_none() { return }
    let app = app.clone();
    std::thread::spawn(move || {
        use windows_sys::Win32::Graphics::Gdi::{CreateRectRgn, DeleteObject, GetWindowRgn, PtInRegion};
        use tauri::{PhysicalPosition, PhysicalSize};
        let pause = || std::thread::sleep(std::time::Duration::from_millis(500));
        std::thread::sleep(std::time::Duration::from_secs(2));
        let mut samples = Vec::new();
        let result = (|| -> Result<(), String> {
            let window = app.get_webview_window("main").ok_or("主窗口缺失")?.as_ref().window();
            let monitor = window.current_monitor().map_err(|_| "屏幕不可用")?.ok_or("屏幕缺失")?;
            let area = monitor.work_area();
            let scale = monitor.scale_factor();
            let normal = PhysicalSize::new((1280.0 * scale) as u32, (800.0 * scale) as u32);
            let origin = PhysicalPosition::new(area.position.x + 60, area.position.y + 60);
            let probe = |name: &str, square: bool, samples: &mut Vec<serde_json::Value>| -> Result<(), String> {
                pause();
                let shape = update(&window)?;
                let size = window.outer_size().map_err(|_| "窗口大小不可用")?;
                let hwnd = window.hwnd().map_err(|_| "窗口句柄不可用")?;
                let region = unsafe { CreateRectRgn(0, 0, 0, 0) };
                if region.is_null() { return Err("测试区域不可用".into()) }
                let kind = unsafe { GetWindowRgn(hwnd.0 as _, region) };
                let rounded = kind != 0 && unsafe { PtInRegion(region, 0, 0) } == 0
                    && unsafe { PtInRegion(region, size.width as i32 / 2, size.height as i32 / 2) } != 0;
                unsafe { DeleteObject(region as _); }
                samples.push(serde_json::json!({"mode": name, "state": shape, "width":size.width,"height":size.height,"nativeRounded":rounded}));
                if shape.square != square || rounded == square { return Err(format!("{name} 窗口形状不符")) }
                Ok(())
            };
            window.unmaximize().map_err(|_| "无法还原")?;
            window.set_position(origin).map_err(|_| "无法移动")?;
            window.set_size(normal).map_err(|_| "无法调整")?;
            probe("floating", false, &mut samples)?;
            window.maximize().map_err(|_| "无法最大化")?;
            probe("maximized", true, &mut samples)?;
            window.unmaximize().map_err(|_| "无法还原")?;
            pause();
            window.set_fullscreen(true).map_err(|_| "无法全屏")?;
            probe("fullscreen", true, &mut samples)?;
            window.set_fullscreen(false).map_err(|_| "无法退出全屏")?;
            pause();
            window.set_position(area.position).map_err(|_| "无法贴边")?;
            window.set_size(PhysicalSize::new(area.size.width / 2, area.size.height)).map_err(|_| "无法分屏")?;
            probe("left-tile", true, &mut samples)?;
            window.set_position(origin).map_err(|_| "无法移动")?;
            window.set_size(normal).map_err(|_| "无法调整")?;
            probe("restored", false, &mut samples)?;
            Ok(())
        })();
        let evidence = serde_json::json!({"passed":result.is_ok(),"error":result.err(),"samples":samples});
        let dir = app.state::<crate::commands::AppState>().store.dir().to_path_buf();
        let _ = crate::storage::write_atomic(&dir.join("window-frame-check.json"), &evidence.to_string());
        app.exit(if evidence["passed"] == true {0} else {1});
    });
}

#[cfg(not(windows))]
pub fn smoke_if_requested(_: &tauri::AppHandle) {}
