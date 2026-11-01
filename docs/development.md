# 开发与验证

先阅读 [架构](architecture.md)、[AGENTS.md](../AGENTS.md) 和 [Git 流程](git-workflow.md)。每个任务使用独立分支；不要覆盖其他聊天的工作树或个人资料。

## 开发

```powershell
npm ci
npm run tauri dev
```

前端开发端口为 1420。业务页面调用 `src/lib/api.ts`，Rust 命令在 `lib.rs` 注册。新增界面复用公共控件与外观语义变量，不在页面内重新实现一套材质、圆角或偏好保存。

## 基础检查

```powershell
npm run typecheck
npm run build
npm run verify
cargo check --examples --locked --manifest-path src-tauri/Cargo.toml
```

`verify` 包括签名/解析 7 项基准、外观偏好兼容、生产组件、官方资料、模型坐标、速度散点、账务边界与任务窗状态。各脚本仍可独立执行，避免无关改动反复运行全部检查。

Windows GNU 的 `cargo test` 存在 WinRT DLL 加载限制。改动业务逻辑时运行对应的 `cargo run --release --locked --manifest-path src-tauri/Cargo.toml --example <name>`；不要把不能运行的 test 记为通过。

| 改动范围 | 相关 example / 检查 |
| --- | --- |
| 账户同步与凭据关联 | `account_sync_checks`、`account_connection_checks`、`account_sync_migration_checks` |
| 用量、设备与速度 | `activity_checks`、`output_speed_checks`、`ssh_activity_checks`、`sync_storage_checks` |
| 账务与汇率 | `vendor_cost_checks`、`usage_fx_checks`、`usage_sync_checks` |
| 任务窗 | `widget_checks`、`verify-widget-state.cjs`、`verify-widget-motion.cjs` |
| 测评与天梯 | `benchmark_checks -- --fixtures`、`verify-benchmark-ui.cjs` |

## 界面检查

```powershell
npm run build
npm run preview:ui
# 另一终端
npm run verify:ui
```

默认预览地址为 `http://127.0.0.1:4187/`，任务窗为 `/?window=usage-widget`。预览只注入合成响应；真实安装版检查不替换 Rust 命令。

首次预览需先运行 `cargo run --release --locked --manifest-path src-tauri/Cargo.toml --example benchmark_checks -- --fixtures`，从公开资料生成模型预览快照；也可通过 `QUOTA_BENCHMARK_BOARD` 指定已有快照。预览不会复制个人数据。

需要 Playwright 和 Edge，可设置 `QUOTA_PLAYWRIGHT_MODULE` 指向已安装模块，`QUOTA_BROWSER_PATH` 指向浏览器，`QUOTA_PREVIEW_URL` 指向预览，`QUOTA_UI_OUTPUT` 指向截图/证据目录。无需把个人资料作为测试样本。

当前界面入口包括：20 种配色/深浅/材质组合，实底控件与圆角，系统模式、高对比度、减少动效，1024/1360px 布局，费用筛选/编辑/导出，模型图，速度鼠标/键盘/DPI，以及任务窗状态和收起计时。`verify-material-interface.cjs` 还对照两档真实像素和侧栏按钮命中，检查双开关显示、旧偏好迁移与选择保存。`verify-material-light.cjs`验证局部坐标、快速按压、焦点优先与失焦/缩放/模式切换清理；也支持隔离Native环境。旧全窗光斑与已删除页面的检查已退役。

## 打包与安装

Windows 使用 `npm run package:windows`，工具链及 Loader 要求见 [Windows 构建](build-windows.md)。打包前退出 Quota，安装器和主程序必须使用同一个实际 Cargo 产物。macOS 见 [构建指南](build-macos.md)，不能以 Windows 检查代替 Mac 运行结果。

启动检查：`scripts/check-install.ps1 -ExePath <绝对路径> -DataDir <隔离目录>`。真实升级使用 `check-installed-upgrade.ps1`；解包启动仅证明 payload 可运行。窗口使用 `check-window-frame.ps1 -Frosted`，任务窗使用 `check-widget.ps1`，均需新的隔离资料目录。

`verify-native-visuals.cjs`、`verify-native-chrome.cjs`、`verify-native-widget-state.cjs` 通过本地 CDP 连接已打开的隔离安装版。必须设置 `QUOTA_NATIVE_DATA` 和 `QUOTA_CDP_URL`；开始操作前核对真实 `app_info.configDir`，配置账户为空，采集仅指向合成日志。不要连接正常使用的资料。

## 数据保护

保留账户、账务、旧资料和同步格式的兼容路径。`config.json`、`catalog_overrides.json`、`hidden_models.json` 读取或解析失败时不得用默认空数据覆盖。`config_checks` 验证原子保存、占用/失败重试、并发及损坏文件保护，不等同于多文件恢复事务或完整备份验收。凭据、支付和同步边界见 [安全规则](security.md)。
