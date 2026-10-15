# Windows build

项目在现有开发机使用 Rust GNU 工具链。`Cargo.toml` 的 `crate-type` 保持 `staticlib` 与 `rlib`；加入 `cdylib` 曾在 GNU 链接时因导出序号过多失败。系统中第三方 MinGW GCC 8.1.0 不适合作为当前链接器，优先使用 rustup 工具链自带的 MinGW。

```powershell
npm run package:windows
```

`src-tauri/WebView2Loader.dll` 必须存在，并由 `tauri.conf.json` 的 `bundle.resources` 带入 NSIS 安装包。曾出现便携版能运行、安装版因 DLL 缺失而报 `0xC0000135` 的情况。打包后应在干净的安装目录验证它与 `quota.exe` 均存在。

安装包在 `src-tauri/target/release/bundle/nsis/`；可执行文件是 `src-tauri/target/release/quota.exe`。在真实安装并确保没有同名旧进程后，用 `scripts/check-install.ps1` 对默认位置 `%LOCALAPPDATA%\Quota\quota.exe` 做启动检查；如果升级保留了自定义安装目录，传入 `-ExePath`。脚本只结束它启动的实例。NSIS 工具链首次下载可能需要网络代理。

本机 `cargo test` 曾在加载 tauri-winrt-notification 的 WinRT API-set DLL 时失败（`STATUS_ENTRYPOINT_NOT_FOUND`）。`cargo check` 可做 Rust 类型检查；签名与解析等纯逻辑另由 `scripts/verify-logic.cjs` 验证。可运行 `src-tauri/examples/` 中的例子做特定逻辑检查。

标准打包命令 npm run tauri build 现在经过 scripts/tauri.cjs：构建前核对各根包版本、归档旧安装包，成功后以 A.B.FFBB 命名唯一安装包；归档位于 src-tauri/target/installer-archive。直接运行 npx tauri 会绕过此检查。

## 构建流程与缓存

此命令自动选择 rustup 的 Windows GNU 工具链及其链接器路径。依赖与锁文件匹配时复用 node_modules，否则运行 npm ci；并行执行 TypeScript、Rust 类型检查、纯逻辑与组件渲染检查，全部通过才打包。前端由 Tauri 的 beforeBuildCommand 构建一次，不需要提前 npm run build。

保留 src-tauri/target 的编译缓存、Cargo 下载缓存和 NSIS 缓存，避免 cargo clean。继续使用正式 release 优化设置，没有降低优化级别或跳过校验。每步输出耗时，便于判断瓶颈。组件渲染检查不能代替浏览器中的布局检查。

首次下载 NSIS 工具需要代理时，可仅为当前终端设置：

```powershell
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
$env:HTTP_PROXY = $env:HTTPS_PROXY
npm run package:windows
```

脚本不会更改系统代理或主动结束 Quota。打包前先退出构建产物位置运行的 Quota（正式安装目录的实例不锁定构建产物）；任一检查失败时不生成新安装包。安装包沿用 scripts/tauri.cjs 的完整展示版本命名和旧包归档规则，位置为 src-tauri/target/release/bundle/nsis；便携版为 src-tauri/target/release/quota.exe。

安装包还需用 scripts/check-install.ps1 验证启动，升级用 scripts/check-upgrade.ps1 单独验证。两者应使用绝对路径的隔离数据目录；已有正式安装时不要运行隔离升级脚本，避免污染卸载注册信息。解包启动检查不代表安装器升级检查通过。
