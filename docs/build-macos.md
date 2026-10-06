# macOS 构建与本地交付

展示版本 `1.0.0900`，包版本 `1.0.900`。2026-10-05 在 Apple Silicon Mac 上完成 arm64 原生构建；尚未公开发布，Intel / Universal 构建未验证。

## 环境与构建

准备 Node.js、Rust stable（`aarch64-apple-darwin`）及 Xcode Command Line Tools。确保 `node`、`npm`、`cargo` 在 PATH 中；若 Rust 已安装但命令找不到，将 `$HOME/.cargo/bin` 加入 PATH。

在仓库根目录执行：

```bash
npm ci
npm run typecheck
npm run build
node scripts/verify-logic.cjs
cd src-tauri
cargo check
cd ..
npm run tauri -- build --bundles app,dmg --config '{"bundle":{"resources":[],"macOS":{"signingIdentity":"-","hardenedRuntime":false}}}'
```

命令行覆盖仅用于本次 Mac 构建：选择 App / DMG，排除 Windows 专用 `WebView2Loader.dll`，并对整个 App 做 ad-hoc 临时签名。仓库默认 NSIS 配置、Windows DLL 资源和产品版本保持不变。仅保留链接器的二进制签名不足以通过 App 资源校验，因此需显式整包签名。

产物：

- `src-tauri/target/release/bundle/macos/Quota.app`
- `src-tauri/target/release/bundle/dmg/Quota_1.0.900_aarch64.dmg`

自定义配置构建不会自动按展示号重命名 DMG。确认目标文件不存在后，交付时重命名：

```bash
mv -n src-tauri/target/release/bundle/dmg/Quota_1.0.900_aarch64.dmg src-tauri/target/release/bundle/dmg/Quota_1.0.0900_aarch64.dmg
```

若 DMG 创建步骤失败而 App 已生成，查看打包日志并确认当前运行环境允许 `hdiutil` 创建、挂载和卸载临时磁盘映像，再重试；无需删除已有编译缓存。

## 安装与副本管理

打开 DMG，将 Quota 拖入「应用程序」，随后推出磁盘映像。日常使用 `/Applications/Quota.app`；更新时先退出 Quota，再替换该应用。

源码构建完成并确认安装副本后，将 `src-tauri/target/release/bundle/macos/Quota.app` 移到废纸篓，只保留安装后的 App，避免 macOS 应用搜索显示两份。DMG 可以保留用于重装；清理 App 构建副本不会删除配置或统计。

当前使用临时签名，未完成 Apple Developer ID 签名或公证。系统可能阻止首次打开；确认安装包来源后，在「系统设置 → 隐私与安全性」中允许打开。公开分发前需要另行完成正式签名与公证。

## 实际验证与限制

2026-10-05 本地构建结果：

- `npm run typecheck`、`npm run build`、`cargo check` 通过，纯逻辑自检 7/7 通过；保留已有的 `get_api_key` 未使用警告。
- App 二进制为 `Mach-O 64-bit executable arm64`，包版本为 `1.0.900`。
- `codesign --verify --deep --strict` 通过，签名为 ad-hoc，App 资源仅包含图标，未带入 Windows DLL。
- `hdiutil verify` 通过；DMG 约 5.5 MB。
- DMG SHA-256：`5ef09e9947e785a25a82383506b932f5f0985f8d7b85b372b336395f038fcb46`。该值仅对应本次本地产物，重新构建可能不同。

校验命令：

```bash
codesign --verify --deep --strict --verbose=2 /Applications/Quota.app
file /Applications/Quota.app/Contents/MacOS/quota
hdiutil verify src-tauri/target/release/bundle/dmg/Quota_1.0.0900_aarch64.dmg
shasum -a 256 src-tauri/target/release/bundle/dmg/Quota_1.0.0900_aarch64.dmg
```

这些检查确认构建、签名结构和磁盘映像完整性，不代表五页界面、真实账户登录、Keychain 读写、备份恢复或跨设备统计已完成实机验收。

macOS 配置与统计目录为 `~/Library/Application Support/Quota/`，凭据后端为系统 Keychain。共享目录需在每台设备重新选择，ChatGPT 需显式连接新设备的 Codex 登录，小米 Cookie 可能需要重新登录。飞书自动同步目前按 Windows 的默认 npm 全局路径查找 `lark-cli.exe`，不能宣称 macOS 自动同步已可用；文件导出 / 导入流程需另行实机验证。

构建产物遵守 `.gitignore`，不提交到 Git 源码仓库；安装包公开发布与源码推送分别进行。
