# Windows 一键打包

准备好 Node.js（含 npm）、rustup 的 `stable-x86_64-pc-windows-gnu` 工具链、可用的 MinGW C 构建工具 / binutils（PATH 中含 dlltool）与 WebView2 后，在项目根目录双击 **build-installer.cmd**。也可以在终端运行：

```powershell
npm run package:windows
```

不必手动设置 MinGW PATH、逐条执行检查或提前安装前端依赖。脚本自动选择 GNU 工具链及链接器路径；依赖与 lockfile 匹配时复用 node_modules，否则运行 npm ci。TypeScript、Rust 类型检查、7 项纯逻辑检查与组件渲染检查全部通过后才开始 release + NSIS 打包，前端由 Tauri 的 beforeBuildCommand 构建一次。任一步失败会返回非零退出码，双击窗口保留错误信息。

## 产物与重复构建

- 安装包：`src-tauri/target/release/bundle/nsis/Quota_A.B.FFBB_x64-setup.exe`。
- 便携版：`src-tauri/target/release/quota.exe`。
- 旧安装包自动归档到 `src-tauri/target/installer-archive/`。

成功后终端显示两个产物的绝对路径和每步耗时。保留 node_modules、src-tauri/target、Cargo 下载缓存与 NSIS 缓存即可加快后续构建，不要 cargo clean。沿用正式 release 优化设置。此入口使用项目内标准 target 目录；如设置过 CARGO_TARGET_DIR，请清除后再运行。

脚本不会拉取或切换 Git 分支，也不会关闭正在运行的 Quota。打包前退出构建产物位置正在运行的 quota.exe；正式安装目录中的实例不锁定构建文件。需要更新源码时先确认工作目录干净，再 git pull --ff-only；有未提交改动或其他聊天共用目录时，按 [Git 分支规范](git-workflow.md) 使用独立工作树。

首次下载依赖或 NSIS 工具需要网络。使用代理时，仅为当前终端设置：

```powershell
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
$env:HTTP_PROXY = $env:HTTPS_PROXY
npm run package:windows
```

## GNU 与 DLL 约束

Cargo.toml 的 crate-type 保持 staticlib 与 rlib；GNU 下加入 cdylib 曾因导出序号过多链接失败。系统中第三方 MinGW GCC 8.1.0 不适合作为当前链接器，脚本固定使用 rustup 自带的 GNU 链接器；保留 PATH 中的 binutils 用于生成导入库，不将缺少汇编器的 self-contained 目录置于 PATH 首位。缺少工具链时运行：

```powershell
rustup toolchain install stable-x86_64-pc-windows-gnu
```

`src-tauri/WebView2Loader.dll` 必须存在，并由 tauri.conf.json 的 bundle.resources 带入 NSIS 安装包。入口在构建前核对文件与资源声明。曾出现便携版能运行、安装版因 DLL 缺失报 0xC0000135 的情况。

本机 cargo test 曾因 tauri-winrt-notification 的 WinRT API-set DLL 加载失败，入口使用 cargo check。特定统计逻辑可额外运行 src-tauri/examples 下的 release example。组件渲染检查不能替代浏览器布局检查。

## 安装与升级验证

真实安装后用 scripts/check-install.ps1 验证启动；非默认安装位置传入 -ExePath，使用 -DataDir 指定绝对路径的隔离数据目录。脚本仅结束它启动的实例。解包后的 DLL 和启动检查不代表安装器覆盖升级通过。

升级用 scripts/check-upgrade.ps1 单独验证；已有正式安装时不要运行隔离升级脚本，避免污染卸载注册信息。

## 发布安装包的完整性标签（1.0.1502）

Windows 构建目录可能继承 Low Mandatory Level。EXE 继承此标签后启动进程也会降为低完整性，不能写普通 TEMP 或覆盖既有安装文件，表现为 NSIS “Error writing temporary file” 或返回成功但未升级。

一键打包仍通过 scripts/tauri.cjs 执行标准 build。它核对 npm / Cargo / Tauri 根包版本，以完整展示号命名唯一安装包，生成后仅对最终安装 EXE 执行 icacls /setintegritylevel M，恢复普通发布文件的中完整性标签。此步骤失败时归档失败产物并使构建失败。直接运行 npx tauri 会绕过这些检查。

此步骤不修改工作区或安装目录 ACL、系统 TEMP、SmartScreen/Defender 或安装包内容，沿用原 NSIS 升级与卸载逻辑。安装器验收应直接启动最终 EXE，使用原系统 TEMP，核对真实安装文件、实际版本、DLL 和隔离启动；不能只根据安装器退出码判定成功。

原理参见 [微软 Mandatory Integrity Control](https://learn.microsoft.com/en-us/windows/win32/secauthz/mandatory-integrity-control)。
