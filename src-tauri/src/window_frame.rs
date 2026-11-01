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
        Foundation::{HWND, LPARAM, LRESULT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{IsIconic, WM_NCACTIVATE, WM_NCDESTROY, WM_NCPAINT},
        },
    };
    const ID: usize = 0x5155_4f54;
    // These custom-frame messages are also handled by Chromium's HWND handler.
    const WM_NCUAHDRAWCAPTION: u32 = 0x00ae;
    const WM_NCUAHDRAWFRAME: u32 = 0x00af;

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
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
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
struct Applied(std::sync::Mutex<Option<(u32, u32, u32, State)>>);

#[cfg(windows)]
fn region_matches(window: &Window, width: u32, height: u32, square: bool) -> bool {
    use windows_sys::Win32::{
        Foundation::RECT,
        Graphics::Gdi::{
            CreateRectRgn, DeleteObject, GetRgnBox, GetWindowRgn, PtInRegion, COMPLEXREGION,
            SIMPLEREGION,
        },
    };
    let Ok(hwnd) = window.hwnd() else {
        return false;
    };
    let region = unsafe { CreateRectRgn(0, 0, 0, 0) };
    if region.is_null() {
        return false;
    }
    let kind = unsafe { GetWindowRgn(hwnd.0 as _, region) };
    let mut bounds = RECT {
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
    };
    unsafe {
        GetRgnBox(region, &mut bounds);
    }
    let matches = if square {
        // No custom region, or Windows' rectangular maximized work-area clip.
        kind == 0 || kind == SIMPLEREGION
    } else {
        kind == COMPLEXREGION
            && bounds.left == 0
            && bounds.top == 0
            && (width as i32..=width as i32 + 1).contains(&bounds.right)
            && (height as i32..=height as i32 + 1).contains(&bounds.bottom)
            && [
                (0, 0),
                (width as i32 - 1, 0),
                (0, height as i32 - 1),
                (width as i32 - 1, height as i32 - 1),
            ]
            .iter()
            .all(|&(x, y)| unsafe { PtInRegion(region, x, y) } == 0)
            && unsafe { PtInRegion(region, width as i32 / 2, height as i32 / 2) } != 0
    };
    unsafe {
        DeleteObject(region as _);
    }
    matches
}

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
    static LOGICAL_RADIUS:std::sync::LazyLock<f64>=std::sync::LazyLock::new(||{
        let geometry:serde_json::Value=serde_json::from_str(include_str!("../data/ui-geometry.json")).expect("embedded UI geometry must be valid");
        geometry["window"].as_f64().filter(|r|r.is_finite()&&(8.0..=40.0).contains(r)).expect("embedded window radius must be valid")
    });
    let radius = (*LOGICAL_RADIUS * scale).round().max(1.0) as u32;
    Ok((
        size.width,
        size.height,
        radius,
        State {
            maximized,
            fullscreen,
            square: maximized || fullscreen || snapped,
        },
    ))
}

pub fn update(window: &Window) -> Result<State, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::{
            System::Threading::GetCurrentThreadId,
            UI::WindowsAndMessaging::GetWindowThreadProcessId,
        };
        let hwnd = window.hwnd().map_err(|_| "无法读取窗口句柄")?;
        if unsafe { GetCurrentThreadId() }
            != unsafe { GetWindowThreadProcessId(hwnd.0 as _, std::ptr::null_mut()) }
        {
            return Err("窗口外观必须在窗口线程更新".into());
        }
    }
    let (width, height, radius, next) = state(window)?;
    let app = window.app_handle();
    let Some(applied) = app.try_state::<Applied>() else {
        return Ok(next);
    };
    let mut previous = applied.0.lock().map_err(|_| "窗口外观暂不可用")?;
    if *previous == Some((width, height, radius, next)) {
        #[cfg(windows)]
        let matches = region_matches(window, width, height, next.square);
        #[cfg(not(windows))]
        let matches = true;
        if matches {
            return Ok(next);
        }
    }
    #[cfg(windows)]
    {
        use windows_sys::Win32::Graphics::Gdi::{CreateRoundRectRgn, DeleteObject, SetWindowRgn};
        let hwnd = window.hwnd().map_err(|_| "无法读取窗口句柄")?;
        let region = if next.square {
            std::ptr::null_mut()
        } else {
            let region = unsafe {
                CreateRoundRectRgn(
                    0,
                    0,
                    width as i32 + 1,
                    height as i32 + 1,
                    radius as i32 * 2,
                    radius as i32 * 2,
                )
            };
            if region.is_null() {
                return Err("无法创建圆角窗口区域".into());
            }
            region
        };
        // Windows takes ownership on success; release the region ourselves on failure.
        if unsafe { SetWindowRgn(hwnd.0 as _, region, 1) } == 0 {
            if !region.is_null() {
                unsafe {
                    DeleteObject(region as _);
                }
            }
            return Err("无法更新窗口圆角".into());
        }
    }
    let changed = previous.map_or(true, |(_, _, _, old)| old != next);
    *previous = Some((width, height, radius, next));
    drop(previous);
    if changed {
        let _ = window.emit("main-window-state", next);
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
    state(&window).map(|(_, _, _, state)| state)
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
            Graphics::Gdi::{
                CreateRectRgn, DeleteObject, GetRgnBox, GetWindowRgn, PtInRegion, COMPLEXREGION,
            },
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
                if region.is_null() { return Err("测试区域不可用".into()); }
                let kind = unsafe { GetWindowRgn(hwnd.0 as _, region) };
                let mut bounds = RECT {
                    left: 0,
                    top: 0,
                    right: 0,
                    bottom: 0,
                };
                unsafe {
                    GetRgnBox(region, &mut bounds);
                }
                // A maximized window may have a rectangular work-area clip
                // starting at (8,8). An excluded outer (0,0) isn't a curve.
                let rounded = kind == COMPLEXREGION
                    && unsafe { PtInRegion(region, bounds.left, bounds.top) } == 0
                    && unsafe { PtInRegion(region, size.width as i32 / 2, size.height as i32 / 2) }
                        != 0;
                unsafe {
                    DeleteObject(region as _);
                }
                Ok((shape,rounded,serde_json::json!({"state": shape, "width":size.width,"height":size.height,"nativeRounded":rounded,"nativeRegionKind":kind,"nativeRegionBounds":[bounds.left,bounds.top,bounds.right,bounds.bottom]})))
                    })();
                    let _ = send.send(result);
                }).map_err(|_| "无法在窗口线程验证区域")?;
                let (shape, rounded, mut row) = receive
                    .recv_timeout(std::time::Duration::from_secs(3))
                    .map_err(|_| "原生区域验证超时")??;
                row["mode"] = serde_json::json!(name);
                samples.push(row);
                if shape.square != square || rounded == square {
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
