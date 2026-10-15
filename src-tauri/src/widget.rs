//! A local-only, edge-docked usage surface. It never collects or syncs its own metrics.
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use crate::commands::AppState;

pub const LABEL: &str = "usage-widget";
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
    let w = ((if expanded { 292.0 } else { 22.0 }) * scale).round().max(1.0).min(width.max(1) as f64) as u32;
    let h = ((if expanded { 186.0 } else { 100.0 }) * scale).round().max(1.0).min(height.max(1) as f64) as u32;
    let top = (height as f64 * f64::from(percent.min(100)) / 100.0 - h as f64 / 2.0).round().max(0.0).min(height.saturating_sub(h) as f64) as i32;
    (if left { x } else { x.saturating_add(width.saturating_sub(w) as i32) }, y.saturating_add(top), w, h)
}
fn place(app: &tauri::AppHandle, expanded: bool, initial: bool) -> Result<(), String> {
    let win = app.get_webview_window(LABEL).ok_or("用量悬浮窗尚未准备好")?;
    let main = app.get_webview_window("main");
    let monitor = if initial { main.as_ref().and_then(|w| w.current_monitor().ok().flatten()) } else { win.current_monitor().ok().flatten() }
        .or_else(|| app.primary_monitor().ok().flatten()).ok_or("无法读取屏幕工作区")?;
    let o = options(app); let area = monitor.work_area();
    let (x,y,w,h) = bounds(area.position.x, area.position.y, area.size.width, area.size.height, monitor.scale_factor(), expanded, o.side == "left", o.height_percent);
    // Keep the native hit area as small as the visible handle while collapsed.
    win.set_size(PhysicalSize::new(w,h)).map_err(|_| "无法调整悬浮窗大小")?;
    win.set_position(PhysicalPosition::new(x,y)).map_err(|_| "无法贴合屏幕边缘")?;
    win.emit("widget-state", serde_json::json!({"expanded":expanded,"side":o.side,"enabled":o.enabled})).map_err(|_| "无法更新悬浮窗")?;
    Ok(())
}
pub fn setup(app: &tauri::AppHandle) -> tauri::Result<()> {
    app.manage(DragOrigin::default());
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?window=usage-widget".into()))
        .title("Quota 用量悬浮窗").inner_size(22.0,100.0).decorations(false).shadow(false)
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
    else { win.hide().map_err(|_| "无法隐藏悬浮窗")?;win.emit("widget-state",serde_json::json!({"expanded":false,"side":options.side,"enabled":false})).map_err(|_|"无法更新悬浮窗")?; }
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

/// Integration checks run inside the packaged executable because bare Tauri test
/// executables cannot load this machine's WinRT API set. Never run on personal data.
pub fn smoke_if_requested(app: &tauri::AppHandle) {
    if std::env::var("QUOTA_WIDGET_SMOKE").as_deref()!=Ok("1") { return; }
    let state=app.state::<AppState>();
    let isolated=std::env::var_os("QUOTA_DATA_DIR").map(std::path::PathBuf::from);
    let Ok(config)=state.config.lock() else {return;};
    if !config.accounts.is_empty() || config.settings.auto_refresh || isolated.as_deref()!=Some(state.store.dir()) {return;}
    drop(config);let app=app.clone();
    std::thread::spawn(move||{
        let check=||->Result<(),String>{
            let win=app.get_webview_window(LABEL).ok_or("悬浮窗未创建")?;
            let main=app.get_webview_window("main").ok_or("主窗口未创建")?;
            let _=main.hide();
            let deadline=std::time::Instant::now()+std::time::Duration::from_secs(15);
            while !win.is_visible().unwrap_or(false) {if std::time::Instant::now()>deadline{return Err("前端未完成悬浮窗就绪握手".into());}std::thread::sleep(std::time::Duration::from_millis(100));}
            if win.is_decorated().unwrap_or(true)||win.is_resizable().unwrap_or(true)||!win.is_always_on_top().unwrap_or(false){return Err("悬浮窗属性不符".into());}
            for expanded in [true,false,true,false]{
                set_widget_expanded(app.clone(),win.clone(),expanded)?;std::thread::sleep(std::time::Duration::from_millis(150));
                let monitor=win.current_monitor().map_err(|_|"无法读取屏幕")?.ok_or("无法读取屏幕")?;let area=monitor.work_area();
                let(x,y,w,h)=bounds(area.position.x,area.position.y,area.size.width,area.size.height,monitor.scale_factor(),expanded,false,50);
                let pos=win.inner_position().map_err(|_|"无法读取位置")?;let size=win.inner_size().map_err(|_|"无法读取大小")?;
                if (pos.x,pos.y,size.width,size.height)!=(x,y,w,h){return Err(format!("窗口几何不符: {:?} != {:?}",(pos.x,pos.y,size.width,size.height),(x,y,w,h)));}
            }
            if set_widget_expanded(app.clone(),main.clone(),true).is_ok(){return Err("窗口身份保护失效".into());}
            if move_widget(app.clone(),main.clone(),0.0,0.0,true).is_ok(){return Err("移动窗口身份保护失效".into());}
            set_widget_expanded(app.clone(),win.clone(),true)?;
            move_widget(app.clone(),win.clone(),-100.0,-120.0,false)?;
            move_widget(app.clone(),win.clone(),-100.0,-120.0,true)?;
            let saved=options(&app);
            if saved.height_percent==50{return Err("拖动位置未保存".into());}
            set_widget_expanded(app.clone(),win.clone(),false)?;
            if options(&app).height_percent!=saved.height_percent{return Err("收起后位置未保留".into());}
            for side in ["left","right"]{
                save_widget_options(app.clone(),main.clone(),Options{enabled:true,side:side.into(),height_percent:75})?;std::thread::sleep(std::time::Duration::from_millis(150));
                let monitor=win.current_monitor().map_err(|_|"无法读取屏幕")?.ok_or("无法读取屏幕")?;let area=monitor.work_area();
                let(x,y,_,_)=bounds(area.position.x,area.position.y,area.size.width,area.size.height,monitor.scale_factor(),false,side=="left",75);let pos=win.inner_position().map_err(|_|"无法读取位置")?;
                if(pos.x,pos.y)!=(x,y){return Err("左右停靠位置不符".into());}
            }
            app.state::<AppState>().config.lock().map_err(|_|"配置不可用")?.settings.close_to_tray=true;
            main.close().map_err(|_|"无法验证主窗口关闭")?;std::thread::sleep(std::time::Duration::from_millis(150));
            if app.get_webview_window("main").is_none()||main.is_visible().unwrap_or(true)||!win.is_visible().unwrap_or(false){return Err("关闭到托盘未保留悬浮窗".into());}
            let mut command=std::process::Command::new(std::env::current_exe().map_err(|_|"无法读取程序路径")?);
            #[cfg(windows)] {use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
            let mut second=command.spawn().map_err(|_|"无法检查再次启动")?;
            let deadline=std::time::Instant::now()+std::time::Duration::from_secs(10);
            loop {if second.try_wait().map_err(|_|"无法读取第二进程")?.is_some(){break}if std::time::Instant::now()>deadline{let _=second.kill();return Err("再次启动未退出第二进程".into())}std::thread::sleep(std::time::Duration::from_millis(100));}
            if !main.is_visible().unwrap_or(false)||app.webview_windows().len()!=2{return Err("再次启动未恢复原主窗口".into());}
            save_widget_options(app.clone(),main.clone(),Options{enabled:false,..Default::default()})?;std::thread::sleep(std::time::Duration::from_millis(150));
            if win.is_visible().unwrap_or(true){return Err("关闭设置未隐藏悬浮窗".into());}
            app.state::<AppState>().config.lock().map_err(|_|"配置不可用")?.settings.close_to_tray=false;
            Ok(())
        };
        let result=check();let ok=result.is_ok();
        let evidence=serde_json::json!({"ok":ok,"error":result.err(),"checks":["frontend-ready","frameless-topmost","native-size-position","repeat-expand-collapse","drag-save-collapse","left-right-docking","window-identity","close-to-tray","single-instance-restore","disabled-hidden"],"exitOnMainCloseExpected":true});
        let state=app.state::<AppState>();let _=crate::storage::write_atomic(&state.store.dir().join("widget-native-check.json"),&evidence.to_string());
        if ok {if let Some(main)=app.get_webview_window("main"){let _=main.close();}else{app.exit(1);}}else{app.exit(1);}
    });
}
