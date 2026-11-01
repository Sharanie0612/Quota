//! A local-only, edge-docked usage surface. It never collects or syncs its own metrics.
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindowBuilder};
#[cfg(not(windows))]
use tauri::PhysicalSize;
use crate::commands::AppState;

pub const LABEL: &str = "usage-widget";
pub const EXPANDED_WIDTH: f64 = 324.0;
pub const EXPANDED_HEIGHT: f64 = 276.0;
#[derive(Default)]
struct DragOrigin(std::sync::Mutex<Option<(PhysicalPosition<i32>,f64)>>);
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default, deny_unknown_fields)]
pub struct Options { pub enabled: bool, pub side: String, pub height_percent: u8 }
impl Default for Options {
    fn default() -> Self { Self { enabled: true, side: "right".into(), height_percent: 50 } }
}
pub fn options(app: &tauri::AppHandle) -> Options {
    let path = app.state::<AppState>().store.dir().join("usage-widget.json");
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}
/// Physical work-area coordinates; supports negative monitor origins and per-monitor DPI.
pub fn bounds(x: i32, y: i32, width: u32, height: u32, scale: f64, expanded: bool, left: bool, percent: u8) -> (i32,i32,u32,u32) {
    let scale = if scale.is_finite() && scale > 0.0 { scale } else { 1.0 };
    let w = ((if expanded { EXPANDED_WIDTH } else { 22.0 }) * scale).round().max(1.0).min(width.max(1) as f64) as u32;
    let h = ((if expanded { EXPANDED_HEIGHT } else { 100.0 }) * scale).round().max(1.0).min(height.max(1) as f64) as u32;
    let top = (height as f64 * f64::from(percent.min(100)) / 100.0 - h as f64 / 2.0).round().max(0.0).min(height.saturating_sub(h) as f64) as i32;
    (if left { x } else { x.saturating_add(width.saturating_sub(w) as i32) }, y.saturating_add(top), w, h)
}
fn place(app: &tauri::AppHandle, expanded: bool, initial: bool) -> Result<(), String> {
    let win = app.get_webview_window(LABEL).ok_or("用量悬浮窗尚未准备好")?;
    let main = app.get_webview_window("main");
    let monitor = if initial { main.as_ref().and_then(|w| w.current_monitor().ok().flatten()) } else { win.current_monitor().ok().flatten() }
        .or_else(|| app.primary_monitor().ok().flatten()).ok_or("无法读取屏幕工作区")?;
    let o = options(app); let area = monitor.work_area();
    // Keep WebView's viewport stable on Windows. Resizing it on every hover
    // stalls composition before CSS can start, even with atomic SetWindowPos.
    let (x,y,w,h) = bounds(area.position.x, area.position.y, area.size.width, area.size.height, monitor.scale_factor(), cfg!(windows) || expanded, o.side == "left", o.height_percent);
    #[cfg(windows)] {
        use windows_sys::Win32::Graphics::Gdi::{CreateRectRgn,DeleteObject,SetWindowRgn};
        use windows_sys::Win32::UI::WindowsAndMessaging::{SetWindowPos,SWP_NOACTIVATE,SWP_NOZORDER};
        let hwnd=win.hwnd().map_err(|_|"无法读取悬浮窗句柄")?;
        let pos=win.outer_position().map_err(|_|"无法读取悬浮窗位置")?;
        let size=win.outer_size().map_err(|_|"无法读取悬浮窗大小")?;
        if (pos.x,pos.y,size.width,size.height)!=(x,y,w,h) && unsafe { SetWindowPos(hwnd.0 as _,std::ptr::null_mut(),x,y,w as i32,h as i32,SWP_NOACTIVATE|SWP_NOZORDER) } == 0 {return Err("无法调整悬浮窗位置".into());}
        // A shaped native region keeps transparent space click-through while
        // collapsed. Windows owns a successfully installed region; on failure
        // we must release it ourselves. Expanding only removes this clip.
        let region=if expanded {std::ptr::null_mut()} else {
            let (left,top,right,bottom)=handle_region(w,h,monitor.scale_factor(),o.side=="left");
            let region=unsafe {CreateRectRgn(left,top,right,bottom)};
            if region.is_null(){return Err("无法准备悬浮窗触发区域".into());}
            region
        };
        if unsafe {SetWindowRgn(hwnd.0 as _,region,1)} == 0 {
            if !region.is_null(){unsafe{DeleteObject(region as _);}}
            return Err("无法更新悬浮窗触发区域".into());
        }
    }
    #[cfg(not(windows))] {
        win.set_size(PhysicalSize::new(w,h)).map_err(|_| "无法调整悬浮窗大小")?;
        win.set_position(PhysicalPosition::new(x,y)).map_err(|_| "无法贴合屏幕边缘")?;
    }
    // Settings/ready placement resets interaction; an older hover reply must
    // not reopen the surface after it has moved or been disabled.
    win.emit("widget-state", serde_json::json!({"expanded":expanded,"side":o.side,"enabled":o.enabled,"reset":initial})).map_err(|_| "无法更新悬浮窗")?;
    Ok(())
}
/// Collapsed handle in local physical coordinates of the fixed-size canvas.
pub fn handle_region(width:u32,height:u32,scale:f64,left:bool)->(i32,i32,i32,i32){
    let scale=if scale.is_finite()&&scale>0.0{scale}else{1.0};
    let w=(22.0*scale).round().max(1.0).min(width as f64) as i32;
    let h=(100.0*scale).round().max(1.0).min(height as f64) as i32;
    let x=if left{0}else{width as i32-w};let y=(height as i32-h)/2;
    (x,y,x+w,y+h)
}
pub fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    app.manage(DragOrigin::default());
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?window=usage-widget".into()))
        .title("Quota 用量悬浮窗").inner_size(if cfg!(windows){EXPANDED_WIDTH}else{22.0},if cfg!(windows){EXPANDED_HEIGHT}else{100.0}).decorations(false).shadow(false)
        .transparent(true).background_color(tauri::window::Color(0,0,0,0))
        .resizable(false).maximizable(false).minimizable(false).always_on_top(true)
        .skip_taskbar(true).focused(false).visible(false).incognito(true)
        .on_navigation(|url| matches!(url.host_str(),Some("tauri.localhost"|"localhost"|"127.0.0.1")) || url.scheme()=="tauri")
        .build()?;
    Ok(())
}
#[tauri::command]
pub fn get_widget_options(app: tauri::AppHandle) -> Options { options(&app) }
#[tauri::command]
pub fn save_widget_options(app: tauri::AppHandle, window: tauri::WebviewWindow, options: Options) -> Result<Options,String> {
    if window.label() != "main" { return Err("只能在主窗口设置悬浮窗".into()); }
    if !matches!(options.side.as_str(),"left"|"right") || options.height_percent > 100 { return Err("悬浮窗位置无效".into()); }
    let state = app.state::<AppState>();
    crate::storage::write_atomic(&state.store.dir().join("usage-widget.json"), &serde_json::to_string(&options).map_err(|_| "无法保存悬浮窗设置")?)?;
    let win = app.get_webview_window(LABEL).ok_or("用量悬浮窗尚未准备好")?;
    if options.enabled { place(&app,false,true)?;win.show().map_err(|_| "无法显示悬浮窗")?; }
    else { win.hide().map_err(|_| "无法隐藏悬浮窗")?;win.emit("widget-state",serde_json::json!({"expanded":false,"side":options.side,"enabled":false,"reset":true})).map_err(|_|"无法更新悬浮窗")?; }
    Ok(options)
}
#[tauri::command]
pub fn widget_ready(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(),String> {
    if window.label()!=LABEL { return Err("无效窗口".into()); }
    place(&app,false,true)?;
    if options(&app).enabled { window.show().map_err(|_| "无法显示悬浮窗")?; }
    Ok(())
}
#[tauri::command]
pub fn set_widget_expanded(app: tauri::AppHandle, window: tauri::WebviewWindow, expanded: bool) -> Result<(),String> {
    if window.label()!=LABEL { return Err("无效窗口".into()); }
    place(&app,expanded,false)
}
/// Pointer deltas are logical pixels; only the widget may reposition itself.
#[tauri::command]
pub fn move_widget(app:tauri::AppHandle,window:tauri::WebviewWindow,dx:f64,dy:f64,finished:bool)->Result<(),String>{
    if window.label()!=LABEL || !dx.is_finite() || !dy.is_finite() || dx.abs()>100000.0 || dy.abs()>100000.0 {return Err("无效悬浮窗移动".into());}
    let state=app.state::<DragOrigin>();let mut origin=state.0.lock().map_err(|_|"悬浮窗移动忙碌")?;
    let (start,scale)=*origin.get_or_insert((window.outer_position().map_err(|_|"无法读取窗口位置")?,window.scale_factor().map_err(|_|"无法读取屏幕缩放")?));
    window.set_position(PhysicalPosition::new(start.x.saturating_add((dx*scale).round() as i32),start.y.saturating_add((dy*scale).round() as i32))).map_err(|_|"无法移动悬浮窗")?;
    if finished {
        *origin=None;
        let monitor=window.current_monitor().map_err(|_|"无法读取屏幕")?.ok_or("无法读取屏幕")?;
        let area=monitor.work_area();let pos=window.outer_position().map_err(|_|"无法读取窗口位置")?;let size=window.outer_size().map_err(|_|"无法读取窗口大小")?;
        let mut o=options(&app);o.side=if f64::from(pos.x)+f64::from(size.width)/2.0 < f64::from(area.position.x)+f64::from(area.size.width)/2.0{"left"}else{"right"}.into();
        o.height_percent=((f64::from(pos.y)-f64::from(area.position.y)+f64::from(size.height)/2.0)/f64::from(area.size.height.max(1))*100.0).round().clamp(0.0,100.0) as u8;
        crate::storage::write_atomic(&app.state::<AppState>().store.dir().join("usage-widget.json"),&serde_json::to_string(&o).map_err(|_|"无法保存悬浮窗位置")?)?;
        place(&app,true,false)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn get_widget_usage(app: tauri::AppHandle) -> Result<crate::activity::UsageSummary,String> {
    tauri::async_runtime::spawn_blocking(move || crate::activity::usage_summary(app.state::<AppState>().store.dir())).await.map_err(|_| "读取用量失败")?
}
#[tauri::command]
pub fn get_widget_speed(app:tauri::AppHandle)->crate::activity::speed_live::Status {
    crate::activity::speed_live::status(app.state::<AppState>().store.dir())
}

/// Integration checks run inside the packaged executable because bare Tauri test
/// executables cannot load this machine's WinRT API set. Never run on personal data.
fn smoke_on_window_thread<T: Send + 'static>(
    app: &tauri::AppHandle,
    check: impl FnOnce(tauri::AppHandle, tauri::WebviewWindow, tauri::WebviewWindow) -> Result<T,String> + Send + 'static,
) -> Result<T,String> {
    let widget=app.get_webview_window(LABEL).ok_or("悬浮窗未创建")?;
    let main=app.get_webview_window("main").ok_or("主窗口未创建")?;
    let (send,receive)=std::sync::mpsc::channel();
    let current=app.clone();
    app.run_on_main_thread(move || {
        let result=(|| {
            #[cfg(windows)] {
                use windows_sys::Win32::{System::Threading::GetCurrentThreadId,UI::WindowsAndMessaging::GetWindowThreadProcessId};
                let hwnd=widget.hwnd().map_err(|_|"无法读取悬浮窗句柄")?;
                if unsafe{GetCurrentThreadId()}!=unsafe{GetWindowThreadProcessId(hwnd.0 as _,std::ptr::null_mut())}{
                    return Err("悬浮窗检查未在窗口线程执行".into());
                }
            }
            check(current,widget,main)
        })();
        let _=send.send(result);
    }).map_err(|_|"无法调度悬浮窗检查")?;
    receive.recv_timeout(std::time::Duration::from_secs(5)).map_err(|_|"悬浮窗检查等待窗口线程超时")?
}

pub fn smoke_if_requested(app: &tauri::AppHandle) {
    if std::env::var("QUOTA_WIDGET_SMOKE").as_deref()!=Ok("1") { return; }
    let state=app.state::<AppState>();
    let isolated=std::env::var_os("QUOTA_DATA_DIR").map(std::path::PathBuf::from);
    let Ok(config)=state.config.lock() else {return;};
    if !config.accounts.is_empty() || config.settings.auto_refresh || isolated.as_deref()!=Some(state.store.dir()) {return;}
    drop(config);let app=app.clone();
    std::thread::spawn(move||{
        let mut phase="frontend-ready";let mut checks=Vec::new();let mut window_thread_verified=false;
        let mut check=||->Result<(),String>{
            let win=app.get_webview_window(LABEL).ok_or("悬浮窗未创建")?;
            let main=app.get_webview_window("main").ok_or("主窗口未创建")?;
            let _=main.hide();
            let deadline=std::time::Instant::now()+std::time::Duration::from_secs(15);
            while !win.is_visible().unwrap_or(false) {if std::time::Instant::now()>deadline{return Err("前端未完成悬浮窗就绪握手".into());}std::thread::sleep(std::time::Duration::from_millis(100));}
            // Normal synchronous IPC runs on the window thread. The smoke
            // worker must use that same path for raw HWND geometry/regions;
            // keep sleeps and the second-process wait outside the UI thread.
            smoke_on_window_thread(&app,|_,_,_|Ok(()))?;window_thread_verified=true;
            checks.push(phase);phase="frameless-topmost";
            if win.is_decorated().unwrap_or(true)||win.is_resizable().unwrap_or(true)||!win.is_always_on_top().unwrap_or(false){return Err("悬浮窗属性不符".into());}
            checks.push(phase);phase="repeat-expand-collapse";
            for expanded in [true,false,true,false]{
                smoke_on_window_thread(&app,move|app,win,_|set_widget_expanded(app,win,expanded))?;
                std::thread::sleep(std::time::Duration::from_millis(150));
                smoke_on_window_thread(&app,move|_,win,_|{
                let monitor=win.current_monitor().map_err(|_|"无法读取屏幕")?.ok_or("无法读取屏幕")?;let area=monitor.work_area();
                let(x,y,w,h)=bounds(area.position.x,area.position.y,area.size.width,area.size.height,monitor.scale_factor(),cfg!(windows)||expanded,false,50);
                let pos=win.inner_position().map_err(|_|"无法读取位置")?;let size=win.inner_size().map_err(|_|"无法读取大小")?;
                if (pos.x,pos.y,size.width,size.height)!=(x,y,w,h){return Err(format!("窗口几何不符: {:?} != {:?}",(pos.x,pos.y,size.width,size.height),(x,y,w,h)));}
                #[cfg(windows)] check_region(&win,expanded,false)?;
                Ok(())})?;
            }
            checks.extend(["native-size-position",phase]);
            #[cfg(windows)] checks.extend(["fixed-hover-viewport","collapsed-hit-region"]);
            phase="appearance-hit-region";
            for expanded in [false,true] {
                smoke_on_window_thread(&app,move|app,win,_|set_widget_expanded(app,win,expanded))?;
                for (glass,reduce_effects) in [(false,false),(true,false),(true,true)] {
                    smoke_on_window_thread(&app,move|app,_,main|{
                        let state=app.state::<AppState>();
                        let previous=state.appearance.lock().map_err(|_|"外观不可用")?.as_ref().map_or(0,|p|p.revision);
                        let revision=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"时钟不可用")?.as_millis() as u64;
                        crate::appearance::save_appearance(app.clone(),main,state,crate::appearance::Preferences{theme:"quota".into(),mode:"light".into(),collapsed:false,glass,reduce_effects:Some(reduce_effects),revision:revision.max(previous.saturating_add(1))})
                    })?;
                    std::thread::sleep(std::time::Duration::from_millis(150));
                    smoke_on_window_thread(&app,move|_,win,_|{
                    #[cfg(windows)] check_region(&win,expanded,false)?;
                    Ok(())})?;
                }
            }
            checks.push(phase);phase="window-identity";
            smoke_on_window_thread(&app,|app,_,main|{
                if set_widget_expanded(app.clone(),main.clone(),true).is_ok(){return Err("窗口身份保护失效".into());}
                if move_widget(app,main,0.0,0.0,true).is_ok(){return Err("移动窗口身份保护失效".into());}
                Ok(())
            })?;
            checks.push(phase);phase="drag-save-collapse";
            smoke_on_window_thread(&app,|app,win,_|{
            set_widget_expanded(app.clone(),win.clone(),true)?;
            move_widget(app.clone(),win.clone(),-100.0,-120.0,false)?;
            move_widget(app.clone(),win.clone(),-100.0,-120.0,true)?;
            let saved=options(&app);
            if saved.height_percent==50{return Err("拖动位置未保存".into());}
            set_widget_expanded(app.clone(),win.clone(),false)?;
            if options(&app).height_percent!=saved.height_percent{return Err("收起后位置未保留".into());}
            Ok(())})?;
            checks.push(phase);phase="left-right-docking";
            for side in ["left","right"]{
                smoke_on_window_thread(&app,move|app,_,main|save_widget_options(app,main,Options{enabled:true,side:side.into(),height_percent:75}).map(|_|()))?;
                std::thread::sleep(std::time::Duration::from_millis(150));
                smoke_on_window_thread(&app,move|_,win,_|{
                let monitor=win.current_monitor().map_err(|_|"无法读取屏幕")?.ok_or("无法读取屏幕")?;let area=monitor.work_area();
                let(x,y,_,_)=bounds(area.position.x,area.position.y,area.size.width,area.size.height,monitor.scale_factor(),cfg!(windows),side=="left",75);let pos=win.inner_position().map_err(|_|"无法读取位置")?;
                if(pos.x,pos.y)!=(x,y){return Err("左右停靠位置不符".into());}
                #[cfg(windows)] check_region(&win,false,side=="left")?;
                Ok(())})?;
            }
            checks.push(phase);phase="close-to-tray";
            app.state::<AppState>().config.lock().map_err(|_|"配置不可用")?.settings.close_to_tray=true;
            main.close().map_err(|_|"无法验证主窗口关闭")?;std::thread::sleep(std::time::Duration::from_millis(150));
            if app.get_webview_window("main").is_none()||main.is_visible().unwrap_or(true)||!win.is_visible().unwrap_or(false){return Err("关闭到托盘未保留悬浮窗".into());}
            checks.push(phase);phase="single-instance-restore";
            let mut command=std::process::Command::new(std::env::current_exe().map_err(|_|"无法读取程序路径")?);
            #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
            let mut second=command.spawn().map_err(|_|"无法检查再次启动")?;
            let deadline=std::time::Instant::now()+std::time::Duration::from_secs(10);
            loop {if second.try_wait().map_err(|_|"无法读取第二进程")?.is_some(){break}if std::time::Instant::now()>deadline{let _=second.kill();return Err("再次启动未退出第二进程".into())}std::thread::sleep(std::time::Duration::from_millis(100));}
            if !main.is_visible().unwrap_or(false)||app.webview_windows().len()!=2{return Err("再次启动未恢复原主窗口".into());}
            checks.push(phase);phase="disabled-hidden";
            smoke_on_window_thread(&app,|app,_,main|save_widget_options(app,main,Options{enabled:false,..Default::default()}).map(|_|()))?;
            std::thread::sleep(std::time::Duration::from_millis(150));
            if win.is_visible().unwrap_or(true){return Err("关闭设置未隐藏悬浮窗".into());}
            checks.push(phase);phase="ready-to-close-main";
            app.state::<AppState>().config.lock().map_err(|_|"配置不可用")?.settings.close_to_tray=false;
            Ok(())
        };
        let result=check();let ok=result.is_ok();
        let evidence=serde_json::json!({"ok":ok,"error":result.err(),"phase":phase,"checks":checks,"windowThreadVerified":window_thread_verified,"exitOnMainCloseExpected":true});
        let state=app.state::<AppState>();let _=crate::storage::write_atomic(&state.store.dir().join("widget-native-check.json"),&evidence.to_string());
        if ok {if let Some(main)=app.get_webview_window("main"){let _=main.close();}else{app.exit(1);}}else{app.exit(1);}
    });
}

#[cfg(windows)]
fn check_region(win:&tauri::WebviewWindow,expanded:bool,left:bool)->Result<(),String>{
    use windows_sys::Win32::Graphics::Gdi::{CreateRectRgn,DeleteObject,GetWindowRgn,GetRgnBox,PtInRegion};
    let hwnd=win.hwnd().map_err(|_|"无法读取窗口句柄")?;
    let size=win.inner_size().map_err(|_|"无法读取窗口大小")?;
    let scale=win.scale_factor().map_err(|_|"无法读取缩放")?;
    let (l,t,r,b)=handle_region(size.width,size.height,scale,left);
    let region=unsafe{CreateRectRgn(0,0,0,0)};
    if region.is_null(){return Err("无法检查触发区域".into());}
    let kind=unsafe{GetWindowRgn(hwnd.0 as _,region)};
    let mut rect=windows_sys::Win32::Foundation::RECT::default();
    unsafe{GetRgnBox(region,&mut rect);}
    // DWM may replace an unrestricted region with a full-window complex
    // region. Both are valid, provided the visible panel is fully reachable.
    let valid=if expanded{
        kind==0||((rect.left,rect.top,rect.right,rect.bottom)==(0,0,size.width as i32,size.height as i32)
        &&[(12,size.height as i32/2),(size.width as i32-12,size.height as i32/2),(size.width as i32/2,10),(size.width as i32/2,size.height as i32-10)].iter().all(|&(x,y)|unsafe{PtInRegion(region,x,y)}!=0))
    }else{
        kind!=0&&(rect.left,rect.top,rect.right,rect.bottom)==(l,t,r,b)
        &&unsafe{PtInRegion(region,(l+r)/2,(t+b)/2)}!=0
        &&unsafe{PtInRegion(region,if left{size.width as i32-1}else{0},size.height as i32/2)}==0
    };
    unsafe{DeleteObject(region as _);}
    if !valid{
        let expected=if expanded{(0,0,size.width as i32,size.height as i32)}else{(l,t,r,b)};
        return Err(format!("悬浮窗触发区域未匹配可见窄条: expanded={expanded}, left={left}, kind={kind}, actual={:?}, expected={expected:?}, size={}x{}, scale={scale}",(rect.left,rect.top,rect.right,rect.bottom),size.width,size.height));
    }
    Ok(())
}
