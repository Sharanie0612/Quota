# Windows build

项目在现有开发机使用 Rust GNU 工具链。`Cargo.toml` 的 `crate-type` 保持 `staticlib` 与 `rlib`；加入 `cdylib` 曾在 GNU 链接时因导出序号过多失败。系统中第三方 MinGW GCC 8.1.0 不适合作为当前链接器，优先使用 rustup 工具链自带的 MinGW。

```powershell
npm ci
npm run typecheck
npm run build
node scripts/verify-logic.cjs
Set-Location src-tauri
cargo check
Set-Location ..
npm run tauri build
```

`src-tauri/WebView2Loader.dll` 必须存在，并由 `tauri.conf.json` 的 `bundle.resources` 带入 NSIS 安装包。曾出现便携版能运行、安装版因 DLL 缺失而报 `0xC0000135` 的情况。打包后应在干净的安装目录验证它与 `quota.exe` 均存在。

安装包在 `src-tauri/target/release/bundle/nsis/`；可执行文件是 `src-tauri/target/release/quota.exe`。在真实安装并确保没有同名旧进程后，用 `scripts/check-install.ps1` 对默认位置 `%LOCALAPPDATA%\Quota\quota.exe` 做启动检查；如果升级保留了自定义安装目录，传入 `-ExePath`。脚本只结束它启动的实例。NSIS 工具链首次下载可能需要网络代理。

本机 `cargo test` 曾在加载 tauri-winrt-notification 的 WinRT API-set DLL 时失败（`STATUS_ENTRYPOINT_NOT_FOUND`）。`cargo check` 可做 Rust 类型检查；签名与解析等纯逻辑另由 `scripts/verify-logic.cjs` 验证。可运行 `src-tauri/examples/` 中的例子做特定逻辑检查。
