# Development

前端是 React 18 + TypeScript + Vite；桌面端是 Tauri 2 + Rust。主窗口在 `src/App.tsx`，账户、模型与设置视图在 `src/views/`，托盘悬浮卡在 `src/components/TrayPopup.tsx`。Tauri invoke 封装在 `src/lib/api.ts`，命令在 `src-tauri/src/commands.rs` 注册。

```powershell
npm ci
npm run tauri dev
```

改动后运行：

```powershell
npm run typecheck
npm run build
node scripts/verify-logic.cjs
```

Rust 代码还需在 `src-tauri/` 运行 `cargo check`。本机 Windows GNU 环境中，`cargo test` 的测试可执行文件曾因 WinRT API-set DLL 加载失败；详见 [Windows 构建说明](build-windows.md)。纯逻辑核验脚本包含阿里云官方签名样例，预期 7/7 通过。

新增 invoke 命令：在 `commands.rs` 实现，在 `lib.rs` 的 `generate_handler!` 注册，再到 `src/lib/api.ts` 封装。新增服务商的现状和限制见 [providers.md](providers.md)。如改动界面，使用 `scripts/mock-tauri.js` 与 `scripts/preview-server.cjs` 查看主窗口和 364px 托盘悬浮卡；模拟数据只用于视觉检查。
