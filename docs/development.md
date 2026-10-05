# Development

开始开发前先阅读 [Git 分支规范](git-workflow.md)：每个任务使用独立分支，并行聊天使用独立工作树，合并前完成适用验收。

前端是 React 18 + TypeScript + Vite；桌面端是 Tauri 2 + Rust。主窗口在 `src/App.tsx`，账户、模型、AI 模型天梯与设置视图在 `src/views/`，托盘单击直接打开主窗口，登录连接在 `connections.rs`。Tauri invoke 封装在 `src/lib/api.ts`，命令在 `src-tauri/src/commands.rs` 注册。

```powershell
npm ci
npm run tauri dev
```

改动后运行：

```powershell
npm run typecheck
npm run build
node scripts/verify-logic.cjs
node scripts/verify-model-comparison.cjs
node scripts/verify-account-overview.cjs
node scripts/verify-activity-charts.cjs
node scripts/verify-ui-render.cjs
```

Rust 代码还需在 `src-tauri/` 运行 `cargo check`。本机 Windows GNU 环境中，`cargo test` 的测试可执行文件曾因 WinRT API-set DLL 加载失败；详见 [Windows 构建说明](build-windows.md)。纯逻辑核验脚本包含阿里云官方签名样例，预期 7/7 通过。

新增 invoke 命令：在 `commands.rs` 实现，在 `lib.rs` 的 `generate_handler!` 注册，再到 `src/lib/api.ts` 封装。新增服务商的现状和限制见 [providers.md](providers.md)。如改动界面，使用 `scripts/mock-tauri.js` 与 `scripts/preview-server.cjs` 查看主窗口、表单、天梯和 1024px 最小窗口布局；模拟数据只用于视觉检查。

新增解析逻辑可用 `cargo run --release --example product_checks` 验证（合成数据，不读取凭据）；可附加公开 AITier HTML 文件路径验证真实页面解析。启动自检用 `scripts/check-install.ps1 -ExePath <绝对路径> -DataDir <隔离目录绝对路径>`，不会迁移个人配置。

模型合计成本仅在币种、计价单位、输入与输出都完整时比较。模型库按原厂币种和单位分组，各组独立排序与缩放；已知每百万 Token 写法可以归一，其他单位保留原含义，不假设汇率。`verify-model-comparison.cjs` 执行生产 TypeScript，覆盖分组、缺失/非法价格、真实零价、稳定排序和未知单位隔离。

视觉验收可用 `?modelsCase=compare-groups` 生成两条明确标注“仅验收”的不同计价样本，用于检查三个独立尺度。`?theme=dark` 仅在演示页面提升现有深色 CSS 规则，供深色样式审查；它不更改系统设置，也不等价于在 Windows 实机上验证系统主题切换。

配置持久化检查使用 `cargo run --release --example config_checks`，在 `src-tauri/target/config-checks/` 的独立目录中运行生产存储逻辑，不读取个人配置或凭据。检查真实写入失败、Windows 文件占用导致替换失败、失败后的重试及持锁并发更新。命令层在写盘成功后才替换配置内存；备份恢复涉及多份文件及凭据，不能将单文件检查等同于完整恢复事务验证。

配置读取保护：config.json、catalog_overrides.json 和 hidden_models.json 只有文件确实不存在时才能按空配置初始化。解析或读取失败会保留原文件，并锁住该文件的保存；界面显示读取失败提示。解析错误不回显文件字段内容。修复文件后须重启，避免旧默认内存覆盖已修复的数据；恢复/导出备份会在读取或修改凭据前做三文件预检。此保护不等于多文件恢复事务，外部进程在检查后修改文件的竞争仍需单独处理。
config_checks 还覆盖损坏文件、错误类型、不可读取路径、保存前才出现损坏、错误内容脱敏、重启后恢复，以及损坏状态下禁止生成空资料备份。
