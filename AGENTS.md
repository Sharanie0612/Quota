# Quota 仓库编码规则

本文件适用于整个仓库。Quota 是本地优先的桌面应用，React / TypeScript 负责界面，Tauri / Rust 负责账户、凭据、采集、账务、同步和原生窗口。历史需求与交付记录供追溯。开始新任务时，从当前用户要求、实际调用方和对应回归入手。

## 工作副本与修改范围

- 先运行 `git status --short --branch` 和 `git worktree list`，核对分支、基线及已有改动。在 `codex/<类型>/<主题>` 任务分支工作。目录被其他任务使用时选独立工作树，保留他人的未提交文件。新工作树只包含所选提交，依赖本地改动时先核对差异。[Git 流程](docs/git-workflow.md)
- 从用户实际使用的入口跟到实现，查清调用方、存储格式和已有检查。修复缺陷时用最小样例说明触发条件与期望结果。改动集中在负责该行为的模块，复用已有类型、组件和函数。重构保留调用方依赖的返回值、事件和失败行为。现有检查覆盖不到本次回归时，补一个能在修复前失败的用例。
- 提交只包含本任务的文件或代码块。新提交和 PR 的标题用英文 `type(scope): summary`，以动词说明具体变化。PR 正文用英文，按模板填写 Summary、Changes、Version impact、Testing。推送前核对远端、分支和待发提交，推送后核对远端提交号。推送、建 PR、合并与发布按本次授权执行。[提交、推送与 PR 规则](docs/git-workflow.md#提交说明) · [PR 模板](.github/pull_request_template.md)
- 中文首页为 `README.md`，完整英文版为 `README.en.md`，顶部互链。安装入口、功能、截图、平台限制或开发命令变化时，在同一变更中更新两版。单一语言的措辞修正可以单独提交。

## 本机 Windows 构建位置

**这台机器上的 Quota 编译、打包、开发预览及会写文件的测试全部使用非 C 盘。** 默认工作副本为 `D:\AgentProjects\Quota`。C 盘源码可阅读和编辑。若所需改动仅在 C 盘，先准备包含这些改动的非 C 盘副本，核对差异后在该副本运行命令。

1. 安装依赖、构建、启动预览或运行会写文件的测试前，检查源码、所有输出目录及其父目录的联接和符号链接目标。待创建的目录从最近已存在的父目录核对。确认实际输出盘有足够空间。
2. 将本次临时目录、依赖安装与下载缓存、Cargo target、Vite 输出、Tauri/NSIS 安装包、预览资料、截图和测试数据放在非 C 盘。包括仓库内的 `node_modules/`、`dist/`、`dist-mock/`、`target/`、`src-tauri/gen/` 和 `src-tauri/target/`。
3. `npm run package:windows` 要求当前进程未设置 `CARGO_TARGET_DIR`，使用该副本的标准 target。通过 `npm run tauri -- build` 执行标准 Windows 构建时，包装脚本会把外部 target 中的安装包复制回源码目录。仅迁移 Cargo 缓存或 target 无法覆盖这些输出。非 C 盘空间不可用时，停止构建。[Windows 路径与打包检查](docs/build-windows.md)

## 沿现有调用链修改

| 改动 | 实现入口与约束 |
| --- | --- |
| 页面、交互与窗口 | `src/main.tsx` 按窗口加载主界面、用量悬浮窗或安装向导。主窗导航在 `src/lib/workspacePages.ts`，业务样式在 `src/styles.css` 登记。复用公共控件、主题变量、`motion.ts` 和共享圆角。报表刷新沿用 `useReportQuery`，旧请求返回时不得覆盖新筛选。保留键盘焦点、减少动效、高对比度、关闭到托盘及悬浮窗命中区域。[架构](docs/architecture.md) · [交互反馈](docs/feedback-motion-1.0.4101.md) · [玻璃动效](docs/liquid-optics-1.0.3501.md) |
| 桌面命令 | 从页面调用的 `src/lib/api.ts` 追到 `src/lib/api/` 的业务封装、Rust 命令与领域服务。新增主程序命令在 `src-tauri/src/lib.rs` 注册，安装向导有独立的 `setup.rs` 注册表。核对 Rust 序列化字段、TypeScript 类型、调用参数、事件与预览模拟。只给需要的窗口授予能力，小米登录窗口保持隔离。[命令与窗口架构](docs/architecture.md) |
| 账户与订阅 | 账户保存和刷新复用 `src-tauri/src/accounts/`。`providers.rs` 的 `visible_defs()` 控制六个可见平台。基础表单显示平台、可选账户名、连接信息和同步方式，其他选项收进高级设置。保留三步中文教程及官方入口。查询失败保留上次成功快照，提供重试、官网及手动余额或额度入口。小米使用隔离的官方登录流程，ChatGPT 显示已绑定本机账户的 Codex 订阅额度。[供应商能力](docs/providers.md) · [小米会话](docs/mimo-session.md) · [ChatGPT 订阅](docs/chatgpt-subscription.md) |
| Token 活动、同步与速度 | 沿用 `activity.sqlite`、稳定事件 ID 和增量游标。分别记录软件、原始型号及厂商、调度入口、接入方式和环境。缓存与推理已计入输入或输出。重读同一日志或重放旧同步包应得出相同总量，缺少原日志时保留历史待核对。历史修复先做 SQLite 一致备份。SSH / WSL 环境由用户选择纳入。测速使用已完成响应的实际用量和计时。[来源与修复](docs/activity-workspace.md) · [同步协议](docs/activity-stats.md) · [测速](docs/output-speed.md) |
| 我的使用与费用 | 我的使用和用量悬浮窗复用去重指标并排除 Trae，Token 活动保留其原记录。分开记录充值与消费，保留原币实付。跨月按自然日分摊，用对应月已公布的日汇率均值折算人民币，缺失非零金额所需汇率时显示待换算。[账期与费用同步](docs/activity-stats.md) · [月均换算](docs/usage-simple-1.0.3200.md) |
| 官方价格与 AI 测评 | 标为已核实的价格须有精确型号、官方来源、核实时间、币种、单位和档位。标准未缓存输入、缓存命中、短时和长时缓存写入分别保存，无法核实时保留未知。AA 图表的指数与美元单任务成本取自同一配置，完整分页成功后才替换快照，保留用户选择和缺成本的型号。[定价取数](docs/model-catalog.md) · [AI 模型图表](docs/model-benchmarks.md) |

## 保护凭据与已有数据

- API Key、AccessKey、管理密钥和小米 Cookie 使用系统凭据库。自定义余额接口的请求头和请求体目前会随 `config.json` 保存，这些字段不得承载密钥。Codex 登录令牌只在内存中使用，充值和续费交给服务商官网。[安全边界](docs/security.md)
- 采集对第三方日志和数据库只读，指标、日志、同步包、测试样例均排除对话正文、工具参数和凭据。共享目录由用户选择。普通导出与共享包沿用字段白名单，包含登录信息的备份须经用户选择并加密。[账户同步](docs/account-sync.md) · [备份与导入](docs/data-migration.md)
- 改持久化格式时，覆盖旧文件缺字段、新旧同步包混用、重试和并发写入。沿用现有事务与原子保存，同时需要两把锁时先取 `activity_lock`，再取 `billing_lock`。读取失败保留原文件，从 AgentPrice 迁移配置时只补缺项。保留旧资料、删除标记和凭据迁移路径。调整安装标识 `com.agentprice.desktop` 时验证覆盖升级和卸载。[数据保护与回归](docs/development.md)

## 按改动选择验收

以下命令从仓库根目录执行。跨前后端的改动合并对应检查。具体领域的 example、浏览器预览步骤和安装验证见[开发与验证](docs/development.md)。

| 改动范围 | 验收 |
| --- | --- |
| 仅文档或代理规则 | 核对相对链接、命令与脚本是否一致，运行 `git diff --check`。无需安装依赖、编译或递增版本。 |
| 前端逻辑与界面 | `npm run typecheck`、`npm run build` 和对应逻辑回归。公共组件或跨模块变动运行 `npm run verify`。验证交互与布局时，构建后启动 `npm run preview:ui`，在另一终端运行 `npm run verify:ui`，核对受影响窗口、1024px 最小主窗宽度及相关状态。 |
| Rust、IPC 或数据格式 | `cargo check --locked --manifest-path src-tauri/Cargo.toml`，再运行受影响的 release example。改命令时同时验证前端调用，改迁移或统计时加入旧数据和重复执行的回归。本机 Windows GNU 有 WinRT DLL 加载限制，业务逻辑用可执行的 example 验证。 |
| 开发或发布脚本 | 从调用该脚本的 npm 命令或工作流核对参数、输出位置和失败退出码。修改发布清单或版本校验时运行 `node scripts/verify-release.cjs`。 |
| 安装器、原生窗口或发布 | Windows 从 `npm run package:windows` 进入，保留 GNU 的 `staticlib`、`rlib` 和随包的 `WebView2Loader.dll`。在隔离目录中验证对应的安装、启动、窗口行为或覆盖升级。macOS 包在相应平台验证。[Windows 构建](docs/build-windows.md) · [macOS 构建](docs/build-macos.md) |

用绝对路径 `QUOTA_DATA_DIR` 隔离 Quota 资料，另为凭据测试使用内存凭据库，采集测试指向合成日志。执行会写文件或更新安装目录的脚本前，核对实际读写路径。交付时说明改动、实际运行的检查和未覆盖的场景，分别记录合成预览、安装版 WebView、真实设备或供应商服务的结果。

## 版本与交付

每个产品迭代分配一次版本。以最新目标分支的源码版本为起点，核对同一发布线已分配和已交付的号码。纯文档沿用源码版本。界面、标签和发布说明使用完整展示号 `A.B.FFBB`，npm、Cargo、Tauri 使用 `A.B.(100 × FF + BB)`。升版时同步各清单与锁文件，将基线、目标和交付状态写入发布文档。[迭代基线与递增](docs/releases.md#迭代基线与递增)
