//! Own the native main-window frame and its rounded/square geometry.
use serde::Serialize;
use tauri::{Emitter, Manager, Window};

#[derive(Default)]
struct ChromeCounters {
    installed: std::sync::atomic::AtomicBool,
    paint: std::sync::atomic::AtomicU64,
    themed_paint: std::sync::atomic::AtomicU64,
    activation: std::sync::atomic::AtomicU64,
}

#[derive(Default)]
struct ChromeGuard(std::sync::Arc<ChromeCounters>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChromeStatus {
    pub installed: bool,
    pub blocked_frame_paints: u64,
    pub blocked_themed_paints: u64,
    pub safe_activation_forwards: u64,
}

pub fn chrome_status(app: &tauri::AppHandle) -> ChromeStatus {
    use std::sync::atomic::Ordering::Relaxed;
    let counters = app.try_state::<ChromeGuard>();
    ChromeStatus {
        installed: counters
            .as_ref()
            .is_some_and(|guard| guard.0.installed.load(Relaxed)),
        blocked_frame_paints: counters
            .as_ref()
            .map_or(0, |guard| guard.0.paint.load(Relaxed)),
        blocked_themed_paints: counters
            .as_ref()
            .map_or(0, |guard| guard.0.themed_paint.load(Relaxed)),
        safe_activation_forwards: counters
            .as_ref()
            .map_or(0, |guard| guard.0.activation.load(Relaxed)),
    }
}

pub fn chrome_ready(app: &tauri::AppHandle) -> bool {
    #[cfg(windows)]
    {
        chrome_status(app).installed
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        true
    }
}

// Keep WS_CAPTION/WS_THICKFRAME: tao uses them for native resize/Snap. Only
// suppress their painting; CSS clipping cannot hide a nonclient title bar.
#[cfg(windows)]
mod chrome {
    use super::ChromeCounters;
    use std::sync::{atomic::Ordering::Relaxed, Arc};
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
        Graphics::Gdi::{RedrawWindow, RDW_ALLCHILDREN, RDW_INVALIDATE, RDW_UPDATENOW},
        UI::{
            HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi},
            Input::KeyboardAndMouse::{GetAsyncKeyState, ReleaseCapture, VK_LBUTTON, VK_RBUTTON},
            Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                FindWindowExW, GetCursorPos, GetSystemMetrics, GetWindowRect, IsIconic, PostMessageW,
                SendMessageW, ShowWindow, HTBOTTOM, HTBOTTOMLEFT, HTBOTTOMRIGHT, HTLEFT, HTRIGHT, HTTOP,
                HTTOPLEFT, HTTOPRIGHT, SM_CXSIZEFRAME, SM_CYSIZEFRAME, SM_SWAPBUTTON, SW_HIDE,
                WM_ACTIVATE, WM_APP, WM_NCACTIVATE, WM_NCDESTROY, WM_NCLBUTTONDOWN, WM_NCPAINT,
                WM_SHOWWINDOW, WM_SIZE,
            },
        },
    };
    const ID: usize = 0x5155_4f54;
    // These custom-frame messages are also handled by Chromium's HWND handler.
    const WM_NCUAHDRAWCAPTION: u32 = 0x00ae;
    const WM_NCUAHDRAWFRAME: u32 = 0x00af;
    const REPAINT_AFTER_ACTIVATION: u32 = WM_APP + 0x151;

    /// Tauri's Win32 resize child can draw rectangular pixels through a
    /// transparent WebView. The native edge command handles resizing instead.
    fn hide_resize_overlay(hwnd: HWND) {
        use std::ptr::null;
        use windows_sys::core::w;

        let child = unsafe {
            FindWindowExW(hwnd, std::ptr::null_mut(), w!("TAURI_DRAG_RESIZE_BORDERS"), null())
        };
        if !child.is_null() {
            unsafe { ShowWindow(child, SW_HIDE); }
        }
    }

    pub fn resize_from_cursor(window: &tauri::Window) -> Result<(), String> {
        use windows_sys::Win32::Foundation::POINT;

        let hwnd = window.hwnd().map_err(|_| "无法读取主窗口句柄")?.0 as HWND;
        let button = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } == 0 { VK_LBUTTON } else { VK_RBUTTON };
        let active = unsafe { GetAsyncKeyState(i32::from(button)) } < 0;
        let mut cursor = POINT::default();
        let mut rect = RECT::default();
        if !active
            || unsafe { GetCursorPos(&mut cursor) } == 0
            || unsafe { GetWindowRect(hwnd, &mut rect) } == 0
            || cursor.x < rect.left || cursor.x >= rect.right
            || cursor.y < rect.top || cursor.y >= rect.bottom
        {
            return Ok(());
        }
        let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96);
        let bx = unsafe { GetSystemMetricsForDpi(SM_CXSIZEFRAME, dpi) };
        let by = unsafe { GetSystemMetricsForDpi(SM_CYSIZEFRAME, dpi) };
        let horizontal = if cursor.x < rect.left + bx { HTLEFT }
            else if cursor.x >= rect.right - bx { HTRIGHT } else { 0 };
        let vertical = if cursor.y < rect.top + by { HTTOP }
            else if cursor.y >= rect.bottom - by { HTBOTTOM } else { 0 };
        let hit = match (horizontal, vertical) {
            (HTLEFT, HTTOP) => HTTOPLEFT,
            (HTRIGHT, HTTOP) => HTTOPRIGHT,
            (HTLEFT, HTBOTTOM) => HTBOTTOMLEFT,
            (HTRIGHT, HTBOTTOM) => HTBOTTOMRIGHT,
            (0, 0) => return Ok(()),
            _ => horizontal + vertical,
        };
        let position = (cursor.x as u16 as u32 | ((cursor.y as u16 as u32) << 16)) as LPARAM;
        unsafe {
            ReleaseCapture();
            SendMessageW(hwnd, WM_NCLBUTTONDOWN, hit as WPARAM, position);
        }
        Ok(())
    }

    unsafe extern "system" fn procedure(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _: usize,
        data: usize,
    ) -> LRESULT {
        if data == 0 {
            return unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
        }
        let counters = unsafe { &*(data as *const ChromeCounters) };
        if message == REPAINT_AFTER_ACTIVATION {
            if unsafe { IsIconic(hwnd) } == 0 {
                unsafe {
                    RedrawWindow(hwnd, std::ptr::null(), std::ptr::null_mut(),
                        RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_UPDATENOW);
                }
            }
            return 0;
        }
        if message == WM_NCDESTROY {
            unsafe {
                RemoveWindowSubclass(hwnd, Some(procedure), ID);
            }
            counters.installed.store(false, Relaxed);
            let owned = unsafe { Arc::from_raw(data as *const ChromeCounters) };
            let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
            drop(owned);
            return result;
        }
        if unsafe { IsIconic(hwnd) } == 0 {
            match message {
                WM_NCPAINT => {
                    counters.paint.fetch_add(1, Relaxed);
                    return 0;
                }
                WM_NCUAHDRAWCAPTION | WM_NCUAHDRAWFRAME => {
                    counters.themed_paint.fetch_add(1, Relaxed);
                    return 0;
                }
                WM_NCACTIVATE => {
                    counters.activation.fetch_add(1, Relaxed);
                    // Forward activation to tao, while DefWindowProc's -1
                    // parameter prevents repainting the system frame.
                    return unsafe { DefSubclassProc(hwnd, message, wparam, -1) };
                }
                _ => {}
            }
        }
        let result = unsafe { DefSubclassProc(hwnd, message, wparam, lparam) };
        if message == WM_SIZE || message == WM_SHOWWINDOW && wparam != 0 {
            hide_resize_overlay(hwnd);
        }
        if message == WM_ACTIVATE && unsafe { IsIconic(hwnd) } == 0 {
            // Repaint once Windows finishes updating the activation frame.
            unsafe { PostMessageW(hwnd, REPAINT_AFTER_ACTIVATION, 0, 0); }
        }
        result
    }

    pub fn install(window: &tauri::Window, counters: Arc<ChromeCounters>) -> Result<(), String> {
        let hwnd = window.hwnd().map_err(|_| "无法读取主窗口句柄")?.0 as HWND;
        let data = Arc::into_raw(counters.clone()) as usize;
        if unsafe { SetWindowSubclass(hwnd, Some(procedure), ID, data) } == 0 {
            unsafe {
                drop(Arc::from_raw(data as *const ChromeCounters));
            }
            return Err("无法安装主窗口边框保护".into());
        }
        counters.installed.store(true, Relaxed);
        hide_resize_overlay(hwnd);
        Ok(())
    }

    /// Called only by the empty-profile packaged frame smoke check.
    pub fn probe(window: &tauri::Window) -> Result<super::ChromeStatus, String> {
        use tauri::Manager;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetWindowLongPtrW, SendMessageW, GWL_STYLE, WS_CAPTION, WS_THICKFRAME,
        };
        let hwnd = window.hwnd().map_err(|_| "无法读取主窗口句柄")?.0 as HWND;
        let mut data = 0usize;
        if unsafe { GetWindowSubclass(hwnd, Some(procedure), ID, &mut data) } == 0 || data == 0 {
            return Err("主窗口边框保护未注册".into());
        }
        let mask = (WS_CAPTION | WS_THICKFRAME) as isize;
        let style = unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } & mask;
        let before = super::chrome_status(window.app_handle());
        for _ in 0..12 {
            unsafe {
                SendMessageW(hwnd, WM_NCACTIVATE, 1, 0);
                SendMessageW(hwnd, WM_NCPAINT, 1, 0);
                SendMessageW(hwnd, WM_NCUAHDRAWCAPTION, 0, 0);
                SendMessageW(hwnd, WM_NCUAHDRAWFRAME, 0, 0);
                SendMessageW(hwnd, WM_NCACTIVATE, 0, 0);
            }
        }
        let after = super::chrome_status(window.app_handle());
        if after.blocked_frame_paints < before.blocked_frame_paints + 12
            || after.blocked_themed_paints < before.blocked_themed_paints + 24
            || after.safe_activation_forwards < before.safe_activation_forwards + 24
            || unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) } & mask != style
        {
            return Err("主窗口原生重绘保护或缩放样式不符".into());
        }
        Ok(after)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub maximized: bool,
    pub fullscreen: bool,
    pub square: bool,
}

#[derive(Default)]
struct Applied(std::sync::Mutex<Option<State>>);

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

fn state(window: &Window) -> Result<State, String> {
    let size = window.outer_size().map_err(|_| "无法读取窗口大小")?;
    let pos = window.outer_position().map_err(|_| "无法读取窗口位置")?;
    let scale = window.scale_factor().map_err(|_| "无法读取窗口缩放")?;
    let maximized = window.is_maximized().unwrap_or(false);
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let snapped = window
        .current_monitor()
        .ok()
        .flatten()
        .is_some_and(|monitor| {
            let area = monitor.work_area();
            tiled(
                (pos.x, pos.y, size.width, size.height),
                (
                    area.position.x,
                    area.position.y,
                    area.size.width,
                    area.size.height,
                ),
                scale,
            )
        });
    Ok(State {
        maximized,
        fullscreen,
        square: maximized || fullscreen || snapped,
    })
}

pub fn update(window: &Window) -> Result<State, String> {
    // Tao provides a per-pixel alpha surface on Windows. Chromium owns the
    // visible curve, so a binary HWND region cannot cut off its edge pixels.
    let next = state(window)?;
    if let Some(applied) = window.app_handle().try_state::<Applied>() {
        let mut previous = applied.0.lock().map_err(|_| "窗口外观暂不可用")?;
        if *previous != Some(next) {
            *previous = Some(next);
            drop(previous);
            let _ = window.emit("main-window-state", next);
        }
    }
    Ok(next)
}

pub fn setup(app: &tauri::AppHandle) {
    app.manage(Applied::default());
    app.manage(ChromeGuard::default());
    if let Some(webview) = app.get_webview_window("main") {
        let window = webview.as_ref().window().clone();
        #[cfg(windows)]
        let counters = app.state::<ChromeGuard>().0.clone();
        // The main window starts hidden so no native caption can be painted
        // before its UI-thread subclass is installed.
        let _ = webview.run_on_main_thread(move || {
            #[cfg(windows)]
            let _ = chrome::install(&window, counters);
            let _ = update(&window);
            let _ = window.show();
        });
    }
}

#[tauri::command]
pub fn get_main_window_state(app: tauri::AppHandle) -> Result<State, String> {
    let window = app
        .get_webview_window("main")
        .ok_or("主窗口尚未准备好")?
        .as_ref()
        .window();
    state(&window)
}

#[tauri::command]
pub fn begin_main_window_resize(window: tauri::Window) -> Result<(), String> {
    if window.label() != "main" {
        return Err("只能调整 Quota 主窗口".into());
    }
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return Ok(());
    }
    #[cfg(windows)]
    chrome::resize_from_cursor(&window)?;
    Ok(())
}

/// Explicit, isolated runtime check, mirroring the existing widget smoke workflow.
#[cfg(windows)]
pub fn smoke_if_requested(app: &tauri::AppHandle) {
    if std::env::var("QUOTA_FRAME_SMOKE").as_deref() != Ok("1")
        || std::env::var_os("QUOTA_DATA_DIR").is_none()
    {
        return;
    }
    let state = app.state::<crate::commands::AppState>();
    let isolated = std::env::var_os("QUOTA_DATA_DIR").map(std::path::PathBuf::from);
    let Ok(config) = state.config.lock() else {
        return;
    };
    if !config.accounts.is_empty()
        || config.settings.auto_refresh
        || isolated.as_deref() != Some(state.store.dir())
    {
        return;
    }
    drop(config);
    let app = app.clone();
    std::thread::spawn(move || {
        use tauri::{PhysicalPosition, PhysicalSize};
        use windows_sys::Win32::{
            Foundation::RECT,
            Graphics::Gdi::{CreateRectRgn, DeleteObject, GetRgnBox, GetWindowRgn, PtInRegion, COMPLEXREGION},
        };
        let pause = || std::thread::sleep(std::time::Duration::from_millis(500));
        std::thread::sleep(std::time::Duration::from_secs(2));
        let mut samples = Vec::new();
        let mut chrome = None;
        let result = (|| -> Result<(), String> {
            let window = app
                .get_webview_window("main")
                .ok_or("主窗口缺失")?
                .as_ref()
                .window();
            let monitor = window
                .current_monitor()
                .map_err(|_| "屏幕不可用")?
                .ok_or("屏幕缺失")?;
            let area = monitor.work_area();
            let scale = monitor.scale_factor();
            let normal = PhysicalSize::new((1280.0 * scale) as u32, (800.0 * scale) as u32);
            let origin = PhysicalPosition::new(area.position.x + 60, area.position.y + 60);
            let probe = |name: &str,
                         square: bool,
                         samples: &mut Vec<serde_json::Value>|
             -> Result<(), String> {
                pause();
                let (send, receive) = std::sync::mpsc::channel();
                let current = window.clone();
                window.run_on_main_thread(move || {
                    let result = (|| -> Result<(State,bool,serde_json::Value),String> {
                        let shape = update(&current)?;
                        let size = current.outer_size().map_err(|_| "窗口大小不可用")?;
                        let hwnd = current.hwnd().map_err(|_| "窗口句柄不可用")?;
                        let region = unsafe { CreateRectRgn(0, 0, 0, 0) };
                        if region.is_null() {
                            return Err("测试区域不可用".into());
                        }
                        let kind = unsafe { GetWindowRgn(hwnd.0 as _, region) };
                        let mut bounds = RECT::default();
                        unsafe { GetRgnBox(region, &mut bounds); }
                        // DWM can report a complex composition region even without
                        // an application-supplied clip. The old GDI curve removed
                        // all four corners while retaining the center.
                        let corners = [
                            (bounds.left, bounds.top),
                            (bounds.right - 1, bounds.top),
                            (bounds.left, bounds.bottom - 1),
                            (bounds.right - 1, bounds.bottom - 1),
                        ].map(|(x, y)| unsafe { PtInRegion(region, x, y) } != 0);
                        let center = unsafe { PtInRegion(region, size.width as i32 / 2, size.height as i32 / 2) } != 0;
                        let clips_all_corners = kind == COMPLEXREGION && center && !corners.into_iter().any(|inside| inside);
                        unsafe { DeleteObject(region as _); }
                        Ok((shape, clips_all_corners, serde_json::json!({
                            "state":shape,"width":size.width,"height":size.height,
                            "nativeRegionKind":kind, "regionCorners":corners,
                            "nativeRegionBounds":[bounds.left,bounds.top,bounds.right,bounds.bottom]
                        })))
                    })();
                    let _ = send.send(result);
                }).map_err(|_| "无法在窗口线程验证区域")?;
                let (shape, native_curve, mut row) = receive
                    .recv_timeout(std::time::Duration::from_secs(3))
                    .map_err(|_| "原生区域验证超时")??;
                row["mode"] = serde_json::json!(name);
                samples.push(row);
                if shape.square != square || (!square && native_curve) {
                    return Err(format!("{name} 窗口形状不符"));
                }
                Ok(())
            };
            window.unmaximize().map_err(|_| "无法还原")?;
            window.set_position(origin).map_err(|_| "无法移动")?;
            window.set_size(normal).map_err(|_| "无法调整")?;
            probe("floating", false, &mut samples)?;
            let (send, receive) = std::sync::mpsc::channel();
            let chrome_window = window.clone();
            window
                .run_on_main_thread(move || {
                    let _ = send.send(chrome::probe(&chrome_window));
                })
                .map_err(|_| "无法验证原生重绘")?;
            chrome = Some(
                receive
                    .recv_timeout(std::time::Duration::from_secs(3))
                    .map_err(|_| "原生重绘验证超时")??,
            );
            window.maximize().map_err(|_| "无法最大化")?;
            probe("maximized", true, &mut samples)?;
            window.unmaximize().map_err(|_| "无法还原")?;
            pause();
            window.set_fullscreen(true).map_err(|_| "无法全屏")?;
            probe("fullscreen", true, &mut samples)?;
            window.set_fullscreen(false).map_err(|_| "无法退出全屏")?;
            pause();
            window.set_position(area.position).map_err(|_| "无法贴边")?;
            window
                .set_size(PhysicalSize::new(area.size.width / 2, area.size.height))
                .map_err(|_| "无法分屏")?;
            probe("left-tile", true, &mut samples)?;
            window.set_position(origin).map_err(|_| "无法移动")?;
            window.set_size(normal).map_err(|_| "无法调整")?;
            probe("restored", false, &mut samples)?;
            Ok(())
        })();
        let evidence = serde_json::json!({"passed":result.is_ok(),"error":result.err(),"samples":samples,"chrome":chrome});
        let dir = app
            .state::<crate::commands::AppState>()
            .store
            .dir()
            .to_path_buf();
        let _ = crate::storage::write_atomic(
            &dir.join("window-frame-check.json"),
            &evidence.to_string(),
        );
        app.exit(if evidence["passed"] == true { 0 } else { 1 });
    });
}

#[cfg(not(windows))]
pub fn smoke_if_requested(_: &tauri::AppHandle) {}
