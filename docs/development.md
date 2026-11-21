# 开发与验证

先按任务选定修改范围和验收。下列 npm 和 Node 命令在仓库根目录执行。在维护者的 Windows 机器上，安装依赖、预览或运行会写文件的测试前先核对实际盘位。[仓库编码规则](../AGENTS.md) · [Windows 路径检查](build-windows.md#维护者本机的构建位置) · [架构](architecture.md)

## 开发

```powershell
npm ci
npm run tauri dev
```

前端开发端口为 1420。业务页面调用 `src/lib/api.ts`，Rust 命令在 `lib.rs` 注册。新增界面复用公共控件与外观语义变量，不在页面内重新实现一套材质、圆角或偏好保存。

## 按改动选择检查

纯文档改动核对链接、命令和 `git diff --check`。前端使用下列 npm 检查，Rust 使用 Cargo 检查。修改 IPC 时两端都验。已有依赖与锁文件一致时可直接运行。

```powershell
npm run typecheck
npm run build
npm run verify
cargo check --locked --manifest-path src-tauri/Cargo.toml
```

`verify` 包括签名/解析 7 项基准、外观偏好兼容、生产组件、官方资料、模型坐标、速度散点、账务边界与任务窗状态。各脚本仍可独立执行，避免无关改动反复运行全部检查。

本机 Windows GNU 的 `cargo test` 遇到过 WinRT DLL 加载失败。验证 Rust 业务逻辑时，切到 `src-tauri/` 执行下表涉及的 release example，例如 `cargo run --release --locked --example account_workflow_checks`。部分 example 按当前工作目录定位 `target/` 或 `../target/`，只传 `--manifest-path` 不会切换目录。改多个 example 可加跑 `cargo check --examples --locked`。

| 改动范围 | 相关 example / 检查 |
| --- | --- |
| 账户、凭据与订阅 | 保存和刷新用 `account_workflow_checks`。关联与同步用 `account_connection_checks`、`account_sync_checks`、`account_sync_migration_checks`。小米登录或续接用 `mimo_login_checks`、`mimo_session_checks`。 |
| 配置、导入与迁移 | `config_checks`、`data_export_checks`、`migration_checks`。覆盖旧数据、损坏原件和写入失败。 |
| 活动采集与报表 | `activity_checks`、`activity_report_checks`。多来源用 `activity_source_checks -- python`（将 python 换成可用的 Python 3 解释器），含远程字段投影的合成回归。Codex 续聊、Multica 或 ZCode 分叉分别用 `codex_usage_checks`、`multica_checks`、`zcode_fork_checks`。 |
| 设备、同步与速度 | SSH 选择用 `ssh_activity_checks` 与 `node scripts/verify-ssh-devices.cjs`，新旧同步包重放用 `sync_storage_checks`，完成响应与半行日志用 `output_speed_checks`。调整本地增量采集周期时见[测速验收](output-speed.md#验证)。 |
| 账务与汇率 | `vendor_cost_checks`、`usage_fx_checks`、`usage_sync_checks`。核对跨月、缺汇率、原币和重复同步。 |
| 主窗、导航与悬浮窗 | 先运行下节的合成界面检查，悬浮窗汇总另跑 `widget_checks`。原生命中、边框与托盘行为在安装版核对。 |
| 官方价格与 AI 模型 | 官方表格适配用 `official_price_checks`。AA 单任务成本用 `task_cost_checks`，前端构建后运行 `node scripts/verify-benchmark-ui.cjs`。更改历史测评解析时按[测评来源验证](model-benchmarks.md#验证)准备样本，再运行 `benchmark_checks -- --fixtures`。 |

## 界面检查

```powershell
npm run build
npm run preview:ui
# 另一终端
npm run verify:ui
```

默认预览地址为 `http://127.0.0.1:4187/`，任务窗为 `/?window=usage-widget`。预览只注入合成响应；真实安装版检查不替换 Rust 命令。

首次预览也直接使用仓库内的模型种子。`scripts/lib/preview.cjs` 读取 `src-tauri/data/` 下的 JSON 和已构建的 `dist/`，将合成响应写入 `dist-mock/`。先完成前端构建，再保持预览服务运行，让另一终端执行界面检查。

需要 Playwright 和 Edge，可设置 `QUOTA_PLAYWRIGHT_MODULE` 指向已安装模块，`QUOTA_BROWSER_PATH` 指向浏览器，`QUOTA_PREVIEW_URL` 指向预览，`QUOTA_UI_OUTPUT` 指向截图/证据目录。无需把个人资料作为测试样本。

当前界面入口包括：20种配色/深浅/材质组合，实底控件与圆角，系统模式、高对比度、减少动效，1024/1360px布局，费用筛选/编辑/导出，模型图，速度鼠标/键盘/DPI，以及任务窗状态和收起计时。`verify-material-interface.cjs`对照材质真实像素和侧栏命中，检查双开关、旧偏好迁移与保存。`verify-material-light.cjs`检查局部坐标、快速按压、焦点优先及清理；`verify-material-optics.cjs`用独立标定纹理核对边缘实际折射、圆角外无泄漏、快速反向连续性，以及减少效果的真实关键帧没有位移或弹性。两者都支持隔离Native环境。标定图仅作光学证据，不用作README产品截图；旧全窗光斑与已删除页面的检查已退役。

## 打包与安装

Windows 使用 `npm run package:windows`。若构建输出目录里的 Quota 正在运行，先退出该实例。安装向导与主程序须使用同一个实际 Cargo 产物。macOS 构建和验收在对应平台进行。[Windows 构建](build-windows.md) · [macOS 构建](build-macos.md)

启动检查使用 `scripts/check-install.ps1 -ExePath <绝对路径> -DataDir <隔离目录>`。窗口和任务窗检查分别使用 `scripts/check-window-frame.ps1` 和 `scripts/check-widget.ps1`，按脚本要求准备隔离资料。覆盖升级需实际安装基线版，再运行候选安装器，核对升级前后版本、数据保留和启动。操作日常安装前须有对应授权，安装器退出码或解包启动各自只记录实际完成的步骤。[安装与升级验证](build-windows.md#安装与升级验证)

`verify-native-visuals.cjs`、`verify-native-chrome.cjs`、`verify-native-widget-state.cjs` 通过本地 CDP 连接已打开的隔离安装版。必须设置 `QUOTA_NATIVE_DATA` 和 `QUOTA_CDP_URL`；开始操作前核对真实 `app_info.configDir`，配置账户为空，采集仅指向合成日志。不要连接正常使用的资料。

## 数据保护

保留账户、账务、旧资料和同步格式的兼容路径。`config.json`、`catalog_overrides.json`、`hidden_models.json` 读取或解析失败时不得用默认空数据覆盖。`config_checks` 验证原子保存、占用/失败重试、并发及损坏文件保护，不等同于多文件恢复事务或完整备份验收。凭据、支付和同步边界见 [安全规则](security.md)。
