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

标准打包命令 npm run tauri build 现在经过 scripts/tauri.cjs：构建前核对各根包版本、归档旧安装包，成功后以 A.B.FFBB 命名唯一安装包；归档位于 src-tauri/target/installer-archive。直接运行 npx tauri 会绕过此检查。

## 发布安装包的完整性标签（1.0.1502）

Windows 构建目录可能继承 Low Mandatory Level。EXE 继承此标签后，启动进程也会降为低完整性，不能写普通 TEMP 或覆盖既有安装文件，表现为 NSIS “Error writing temporary file” 或返回成功但未升级。

标准 `npm run tauri build` 和 `npm run tauri -- bundle --bundles nsis --ci` 在 NSIS 打包后，仅对最终生成的安装 EXE 执行 `icacls /setintegritylevel M`，恢复普通发布文件的中完整性标签。不修改工作区或安装目录 ACL、不修改系统 TEMP、不关闭 SmartScreen/Defender、不改变安装包内容。此步骤失败时归档失败产物并使构建失败。原 NSIS 升级、快捷方式和卸载逻辑保持不变。

验收必须直接启动最终 EXE，使用原系统 TEMP，验证新目录真实安装、原路径升级、实际程序版本和 DLL，以及 `scripts/check-install.ps1` 的隔离数据启动。不能只根据安装器退出码判定成功。未签名应用的 SmartScreen 声誉提醒与此文件权限修复不同。

原理参见 [微软 Mandatory Integrity Control](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)。
