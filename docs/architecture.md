# 架构

Quota 是本地优先的 Tauri 2 应用。前端管理视图、交互与展示计算，Rust 管理账户、凭据、统计、账务、同步和原生窗口；不在 UI 中建立第二份用量账本。

```text
main.tsx → window.ts → App / UsageWidget / SetupView
                        ↓
                 views → components
                        ↓
                 lib/api.ts → lib/api/ → Tauri 命令
                        ↓
                 领域服务 → 存储 / 系统凭据库
```

## 前端职责

| 位置 | 职责 |
| --- | --- |
| `src/main.tsx`、`src/window.ts` | 解析窗口类型、初始化外观、挂载对应入口 |
| `src/views/` | 六个业务页面及安装向导，组合视图和用户操作 |
| `src/components/ui.tsx` | 按钮、开关、分段选择、弹层等公共控件 |
| `src/components/` | 账户卡、图表、导航、任务窗等可复用界面 |
| `src/lib/api.ts`、`src/lib/api/` | 页面从 `api.ts` 导入 `api` 和事件订阅。`api/` 中的账户、活动、费用、模型、桌面和文件传输模块各自维护调用名、参数和返回类型。 |
| `src/lib/` | 价格坐标、统计筛选、费用分摊、速度布局等纯计算 |
| `src/lib/appearance/` | 外观配色、偏好校验、共享状态和同步 |

外观模块有三个职责：`themes.ts` 生成语义颜色和尺寸变量；`preferences.ts` 处理合法值、旧格式与修订号；`index.ts` 应用变量、订阅系统模式并同步本机偏好。原生外观命令集中于这一个状态入口，组件只读状态或提交选择。`glass`作为主开关，可选`reduceEffects`保存降低强度；旧开启且缺字段时保留毛玻璃，旧关闭保持关闭。不增加另一份偏好文件。

`src/styles.css` 是唯一样式入口，依次导入基础、布局、公共控件、页面、动效与材质六层。图表和业务复杂布局使用相邻 CSS。新增控件复用语义变量和公共按钮，避免页面再次覆写按钮透明度、圆角或指针光层。

`src-tauri/data/ui-geometry.json` 是窗口、面板、普通控件与分段内层的尺寸来源，前端和 Windows 原生裁剪共用。开关、状态圆点和图表标记保留自己的几何形状。

## 桌面与窗口

主窗口 `main` 使用不透明 WebView。侧栏和工具栏各有一个材质平面；`GlassMaterial` 复用 `appearance/lens.ts` 的圆角几何位移图，对实时背景做局部折射。位移图仅含几何，不复制账户、文本或图表像素；按尺寸缓存、缩放时重建，鼠标移动不重建。Chromium使用裁剪后的SVG backdrop滤镜，不支持时保留CSS磨砂和轮廓。主要内容区、卡片和常规按钮保持实底。`appearance.rs` 负责偏好校验、原子保存和广播，不操作 Blur/Acrylic。

侧栏按钮与品牌位于同一标题行，收起后的图标24px、目标48px。侧栏宽度通过一个CSS变量同时决定导航尺寸和拖动遮罩起点；侧栏层级高于内容区移动，避免展开时遮挡按钮。顶部栏浮于滚动内容之上，初始内容留出空间。`useSlidingHighlight`统一导航和分段选择的覆盖层动效；完整模式可形变并中断重接，减少效果及系统减少动态改为淡入淡出，侧栏沿用同一运动策略。

`window_frame.rs` 维护无系统标题栏的重绘保护、浮动圆角及最大化/Snap 方角。`widget.rs` 管理独立 `usage-widget` 的位置、尺寸和命中区域，前端负责可打断的展开/收起；任务窗不继承主窗口磨砂。所有原生窗口变更遵守窗口线程约束。

`mimo-login` 是无 Quota IPC 权限的官方登录窗口。安装向导使用同一 Cargo 可执行产物的 setup 入口；外观固定浅色，不读取用户主题。托盘单击打开主窗口，关闭行为沿用 Tauri 事件处理。

`useMaterialLight`负责主App内的输入光效：局部坐标、每帧调度、键盘优先、淡出和硬清理。光层位于内容下方，不变更文字或命中区域；原生focus、隐藏及resize与DOM事件分别处理。

## Rust 领域边界

| 领域 | 主要模块 |
| --- | --- |
| 命令注册与应用状态 | `lib.rs` 注册桌面命令并启动任务。`app_state.rs` 构造 `AppState`，供命令和后台任务共用。 |
| 账户、桌面、资料库与备份命令 | `commands/accounts.rs`、`commands/desktop.rs`、`commands/catalog.rs`、`commands/backup.rs` |
| 账户与订阅 | `accounts/edit.rs` 保存配置并关联凭据，`accounts/balance.rs` 选择查询方式并处理手动余额，`accounts/mod.rs` 维护账户视图、刷新快照和历史。供应商协议由 `providers.rs`、`connections.rs`、`mimo*` 和 `subscription.rs` 处理。 |
| 模型与官方价格 | `ladder.rs`、`benchmarks/`、`ai_models.rs`、`official_prices.rs`、`official_tables.rs` |
| 用量与速度 | `activity.rs`、`activity_*`、`output_speed*` |
| 支出与汇率 | `vendor_costs.rs`、`usage_costs.rs`、`usage_fx.rs`、`usage_sync.rs` |
| 保存与迁移 | `storage.rs`、`secrets.rs`、`backup.rs`、`migration.rs`、`account_sync.rs` |

### 跟踪一次账户刷新

页面从 `api.refreshAccount` 或 `api.refreshAll` 进入 `commands/accounts.rs`。启动、定时和托盘刷新从 `refresh.rs` 进入。两条路径均调用 `accounts::refresh_status`，由 `balance::query` 获取供应商结果，再由 `accounts::record_status` 应用手动余额、保留成功快照、采样费用并记录余额历史。账户模块返回疑似充值事件，`refresh.rs` 将事件发给窗口，整次操作结束后广播一次账户更新并刷新托盘角标。角标和账户卡共用低余额判定。

新增桌面命令时，先找对应领域的已有入口，在 `lib.rs` 的 `generate_handler!` 中注册，然后更新 `src/lib/api/` 中同一业务的封装。安装向导使用 `setup.rs` 的独立注册表，窗口能力配置在 `src-tauri/capabilities/`。

`catalog.rs`、旧资料格式和账务迁移仍被导入、官方资料适配与旧安装使用。删除未接入入口的旧前端页面，不代表可以删除这些数据兼容路径。模型价格来源、单位、配置与核实时间继续独立保存，未知值保持未知。

## 验证与维护

`npm run verify` 执行纯逻辑与组件检查，`npm run verify:ui` 在实际构建的合成预览中验证外观、账务操作、图表和任务窗。`scripts/lib/` 共用 TypeScript 加载器、合成费用和表面断言；退役的全窗合成与旧页面检查不再作为当前入口。

在 `src-tauri/` 运行 `cargo run --release --example account_workflow_checks`，可用合成响应、临时目录和内存凭据库验证账户保存、刷新结果处理、删除和疑似充值事件。其余 Rust 运行逻辑使用对应 example。安装包另做覆盖升级、数据哈希、真实命令、窗口几何和任务窗检查。WebView 截图不等于桌面合成或真实鼠标拖动验收。详见 [开发指南](development.md)、[安全边界](security.md)、[统计与账务](activity-stats.md)。
