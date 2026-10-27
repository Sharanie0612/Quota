//! A dedicated, isolated installer UI. NSIS remains the installation engine.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    version: String,
    target: String,
    previous_version: Option<String>,
    payload_bytes: u64,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    phase: String,
    message: String,
    done: bool,
    error: Option<String>,
}
impl Default for Progress {
    fn default() -> Self {
        Self {
            phase: "idle".into(),
            message: String::new(),
            done: false,
            error: None,
        }
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    target: String,
    desktop_shortcut: bool,
    start_menu: bool,
}
struct SetupState {
    installer: PathBuf,
    info: Info,
    expected_hash: String,
    loader_hash: String,
    progress: Mutex<Progress>,
    target: Mutex<Option<PathBuf>>,
    running: Mutex<bool>,
    frontend_phase: Mutex<String>,
}
fn hash(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|_| "无法读取安装文件")?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let len = file.read(&mut buffer).map_err(|_| "无法校验安装文件")?;
        if len == 0 {
            break;
        }
        hash.update(&buffer[..len]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn validate_target(value: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(value.trim());
    if !path.is_absolute()
        || path.components().count() < 3
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir | Component::CurDir))
        || value.chars().any(|c| c.is_control() || c == '"')
        || value.len() > 220
    {
        return Err("请选择本机磁盘中的完整安装文件夹，例如 D:\\Quota".into());
    }
    #[cfg(windows)]
    if !matches!(path.components().next(),Some(Component::Prefix(prefix)) if matches!(prefix.kind(),std::path::Prefix::Disk(_)|std::path::Prefix::VerbatimDisk(_)))
    {
        return Err("请选择本机磁盘目录".into());
    }
    for root in [
        std::env::var_os("WINDIR"),
        std::env::var_os("USERPROFILE"),
        std::env::var_os("APPDATA"),
        std::env::var_os("LOCALAPPDATA"),
    ]
    .into_iter()
    .flatten()
    {
        if path
            .to_string_lossy()
            .trim_end_matches(['\\', '/'])
            .eq_ignore_ascii_case(&PathBuf::from(root).to_string_lossy())
        {
            return Err("请为 Quota 选择独立文件夹".into());
        }
    }
    Ok(path)
}
#[cfg(windows)]
fn installed_value(name: &str) -> Option<String> {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_SZ};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<_>>();
    let key = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Quota");
    let name = wide(name);
    let mut buffer = [0u16; 2048];
    let mut bytes = (buffer.len() * 2) as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            buffer.as_mut_ptr() as _,
            &mut bytes,
        )
    };
    if status != 0 {
        return None;
    }
    let value = String::from_utf16_lossy(&buffer[..(bytes as usize / 2).saturating_sub(1)]);
    Some(value.trim_matches('"').to_string())
}
#[cfg(not(windows))]
fn installed_value(_: &str) -> Option<String> {
    None
}
#[cfg(windows)]
fn is_running(path: &Path) -> bool {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
                TH32CS_SNAPPROCESS,
            },
            Threading::{
                OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
            },
        },
    };
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE {
            return false;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut found = Process32FirstW(snapshot, &mut entry) != 0;
        let mut running = false;
        while found {
            let end = entry
                .szExeFile
                .iter()
                .position(|c| *c == 0)
                .unwrap_or(entry.szExeFile.len());
            if String::from_utf16_lossy(&entry.szExeFile[..end]).eq_ignore_ascii_case("quota.exe") {
                let process =
                    OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, entry.th32ProcessID);
                if !process.is_null() {
                    let mut buffer = [0u16; 32768];
                    let mut size = buffer.len() as u32;
                    if QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut size) != 0
                        && String::from_utf16_lossy(&buffer[..size as usize])
                            .eq_ignore_ascii_case(&path.to_string_lossy())
                    {
                        running = true
                    }
                    CloseHandle(process);
                }
            }
            if running {
                break;
            }
            found = Process32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
        running
    }
}
#[cfg(not(windows))]
fn is_running(_: &Path) -> bool {
    false
}
fn report(app: &tauri::AppHandle, progress: Progress) {
    if let Ok(mut current) = app.state::<SetupState>().progress.lock() {
        *current = progress.clone();
    }
    let _ = app.emit("setup-progress", progress);
}
#[tauri::command]
fn setup_info(state: State<'_, SetupState>) -> Info {
    state.info.clone()
}
#[tauri::command]
fn setup_status(state: State<'_, SetupState>) -> Progress {
    state.progress.lock().map(|p| p.clone()).unwrap_or_default()
}
#[tauri::command]
fn setup_ready(state: State<'_, SetupState>, phase: String) {
    if matches!(
        phase.as_str(),
        "welcome" | "location" | "review" | "installing" | "finish"
    ) {
        if let Ok(mut current) = state.frontend_phase.lock() {
            *current = phase;
        }
    }
}
// Explicit package QA only: wait for the actual setup WebView before exercising
// the same install command. Ordinary launches never enter this path.
fn smoke_if_requested(app: &tauri::AppHandle) {
    if std::env::var("QUOTA_SETUP_SMOKE").as_deref() != Ok("1") {
        return;
    }
    let Some(report_path) = std::env::var_os("QUOTA_SETUP_SMOKE_REPORT")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute() && path.parent().is_some_and(Path::is_dir))
    else {
        return;
    };
    let app = app.clone();
    std::thread::spawn(move || {
        let mut phases = Vec::new();
        let result = (|| -> Result<(), String> {
            let state = app.state::<SetupState>();
            let start = Instant::now();
            while state
                .frontend_phase
                .lock()
                .map(|s| s.is_empty())
                .unwrap_or(true)
            {
                if start.elapsed() > Duration::from_secs(30) {
                    return Err("安装 WebView 未完成握手".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            phases.push("frontend-ready".to_string());
            setup_install(
                app.clone(),
                app.state(),
                Request {
                    target: state.info.target.clone(),
                    desktop_shortcut: false,
                    start_menu: false,
                },
            )?;
            loop {
                let progress = state
                    .progress
                    .lock()
                    .map_err(|_| "无法读取测试状态")?
                    .clone();
                if phases.last() != Some(&progress.phase) {
                    phases.push(progress.phase.clone());
                }
                if let Some(error) = progress.error {
                    return Err(error);
                }
                if progress.done
                    && state
                        .frontend_phase
                        .lock()
                        .is_ok_and(|phase| phase.as_str() == "finish")
                {
                    break;
                }
                if start.elapsed() > Duration::from_secs(210) {
                    return Err("安装测试超时".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Ok(())
        })();
        let evidence = serde_json::json!({"passed":result.is_ok(),"error":result.err(),"bootstrap":std::env::current_exe().ok().is_some_and(|p|p.file_name().is_some_and(|n|n=="quota-setup.exe")),"frontendLoaded":phases.first().is_some_and(|s|s=="frontend-ready"),"finishRendered":app.state::<SetupState>().frontend_phase.lock().is_ok_and(|s|s.as_str()=="finish"),"phases":phases});
        let _ = crate::storage::write_atomic(&report_path, &evidence.to_string());
        app.exit(if evidence["passed"] == true { 0 } else { 1 });
    });
}
#[tauri::command]
fn setup_install(
    app: tauri::AppHandle,
    state: State<'_, SetupState>,
    request: Request,
) -> Result<(), String> {
    let target = validate_target(&request.target)?;
    if state.info.previous_version.is_some()
        && !target
            .to_string_lossy()
            .eq_ignore_ascii_case(&state.info.target)
    {
        return Err("升级会继续使用现有安装位置，以保留安装与卸载关系".into());
    }
    let mut running = state.running.lock().map_err(|_| "安装状态暂不可用")?;
    if *running {
        return Err("安装正在进行".into());
    }
    *running = true;
    drop(running);
    *state.target.lock().map_err(|_| "安装位置暂不可用")? = Some(target.clone());
    let installer = state.installer.clone();
    std::thread::spawn(move || {
        let result = (|| -> Result<(), String> {
            report(
                &app,
                Progress {
                    phase: "preparing".into(),
                    message: "正在检查安装环境".into(),
                    ..Default::default()
                },
            );
            let state = app.state::<SetupState>();
            let old = PathBuf::from(&state.info.target).join("quota.exe");
            if is_running(&old) {
                let mut command = Command::new(&old);
                command.arg("--quota-exit-for-update");
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    command.creation_flags(0x08000000);
                }
                let _ = command.spawn();
                std::thread::sleep(Duration::from_millis(1200));
                if is_running(&old) {
                    return Err("Quota 正在运行。请从系统托盘退出 Quota，再点击重试安装。已有账户和用量会保留。".into());
                }
            }
            let folder =
                std::env::temp_dir().join(format!("quota-install-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&folder).map_err(|_| "无法创建安装临时目录")?;
            let progress_file = folder.join("progress.ini");
            std::fs::write(&progress_file, b"[setup]\r\nphase=preparing\r\n")
                .map_err(|_| "无法创建安装状态文件")?;
            let mut command = Command::new(installer);
            command
                .args(["/S", "/NS", "/UPDATE"])
                .arg(format!("/QUOTA_PROGRESS={}", progress_file.display()));
            if request.desktop_shortcut {
                command.arg("/QUOTA_DESKTOP");
            }
            if request.start_menu {
                command.arg("/QUOTA_STARTMENU");
            }
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                command
                    .creation_flags(0x08000000)
                    .raw_arg(format!("/D={}", target.display()));
            }
            #[cfg(not(windows))]
            command.arg(format!("/D={}", target.display()));
            command
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            let mut child = command.spawn().map_err(|_| "无法启动安装引擎")?;
            let start = Instant::now();
            let mut phase = String::new();
            loop {
                if let Some(status) = child.try_wait().map_err(|_| "无法读取安装状态")? {
                    if !status.success() {
                        return Err(format!(
                            "安装引擎未完成（代码 {}），请重试安装",
                            status.code().unwrap_or(-1)
                        ));
                    }
                    break;
                }
                if start.elapsed() > Duration::from_secs(180) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("安装超时，尚未确认完成。请检查安装位置后重试。".into());
                }
                let next = std::fs::read_to_string(&progress_file)
                    .ok()
                    .and_then(|text| {
                        text.lines()
                            .find_map(|line| line.trim().strip_prefix("phase=").map(str::to_string))
                    })
                    .unwrap_or_else(|| "installing".into());
                if phase != next {
                    phase = next;
                    report(
                        &app,
                        Progress {
                            phase: phase.clone(),
                            message: match phase.as_str() {
                                "copying" => "正在解压并复制 Quota 文件",
                                "finishing" => "正在完成注册与快捷方式",
                                "done" => "正在校验安装结果",
                                _ => "安装引擎正在运行",
                            }
                            .into(),
                            ..Default::default()
                        },
                    );
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            if hash(&target.join("quota.exe"))? != state.expected_hash
                || hash(&target.join("WebView2Loader.dll"))? != state.loader_hash
            {
                return Err("安装结果校验未通过，请重试安装".into());
            }
            let _ = std::fs::remove_file(&progress_file);
            let _ = std::fs::remove_dir(&folder);
            Ok(())
        })();
        if let Ok(mut running) = app.state::<SetupState>().running.lock() {
            *running = false;
        }
        match result {
            Ok(()) => report(
                &app,
                Progress {
                    phase: "done".into(),
                    message: "Quota 已安装完成".into(),
                    done: true,
                    error: None,
                },
            ),
            Err(error) => report(
                &app,
                Progress {
                    phase: "failed".into(),
                    message: String::new(),
                    done: false,
                    error: Some(error),
                },
            ),
        }
    });
    Ok(())
}
#[tauri::command]
fn setup_finish(
    app: tauri::AppHandle,
    state: State<'_, SetupState>,
    launch: bool,
) -> Result<(), String> {
    if !state.progress.lock().map_err(|_| "安装状态暂不可用")?.done {
        return Err("安装尚未完成".into());
    }
    if launch {
        let path = state
            .target
            .lock()
            .map_err(|_| "安装位置暂不可用")?
            .clone()
            .ok_or("安装位置缺失")?
            .join("quota.exe");
        let mut command = Command::new(path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        command
            .spawn()
            .map_err(|_| "Quota 已安装，请从安装目录打开应用")?;
    }
    app.exit(0);
    Ok(())
}
pub fn run(installer: PathBuf) -> Result<(), String> {
    if !installer.is_absolute() || !installer.is_file() {
        return Err("安装包路径无效".into());
    }
    let own = std::env::current_exe().map_err(|_| "无法读取安装程序")?;
    let location = installed_value("InstallLocation").unwrap_or_else(|| {
        dirs::data_local_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("Quota")
            .to_string_lossy()
            .into()
    });
    let loader = own
        .parent()
        .ok_or("安装资源缺失")?
        .join("WebView2Loader.dll");
    let payload_bytes = [own.as_path(), loader.as_path()]
        .into_iter()
        .filter_map(|path| std::fs::metadata(path).ok().map(|m| m.len()))
        .sum();
    let state = SetupState {
        installer,
        info: Info {
            version: crate::version::display_version(),
            target: location,
            previous_version: installed_value("DisplayVersion"),
            payload_bytes,
        },
        expected_hash: hash(&own)?,
        loader_hash: hash(&loader)?,
        progress: Mutex::new(Progress::default()),
        target: Mutex::new(None),
        running: Mutex::new(false),
        frontend_phase: Mutex::new(String::new()),
    };
    let mut context = tauri::generate_context!();
    let window = &mut context.config_mut().app.windows[0];
    window.label = "setup".into();
    window.title = "Quota 安装".into();
    window.url = tauri::WebviewUrl::App("index.html?window=setup".into());
    window.width = 900.;
    window.height = 650.;
    window.min_width = Some(900.);
    window.min_height = Some(650.);
    window.resizable = false;
    window.maximizable = false;
    window.incognito = true;
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .setup(|app| {
            crate::window_frame::setup(app.handle());
            if let Some(window) = app.get_webview_window("setup") {
                let _ = crate::window_frame::update(&window.as_ref().window());
            }
            smoke_if_requested(app.handle());
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::Moved(_)
                    | tauri::WindowEvent::ScaleFactorChanged { .. }
            ) {
                let _ = crate::window_frame::update(window);
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<SetupState>();
                if state.running.lock().map(|r| *r).unwrap_or(true) {
                    api.prevent_close();
                } else {
                    window.app_handle().exit(
                        if state.progress.lock().map(|p| p.done).unwrap_or(false) {
                            0
                        } else {
                            1
                        },
                    );
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            setup_info,
            setup_status,
            setup_ready,
            setup_install,
            setup_finish
        ])
        .run(context)
        .map_err(|_| "安装界面启动失败".into())
}
