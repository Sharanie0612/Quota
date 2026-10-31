# 架构

Quota 是本地优先的 Tauri 2 应用。前端管理视图、交互与展示计算，Rust 管理账户、凭据、统计、账务、同步和原生窗口；不在 UI 中建立第二份用量账本。

```text
main.tsx → window.ts → App / UsageWidget / SetupView
                        ↓
                 views → components
                        ↓
                 lib/api.ts → Tauri 命令
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
| `src/lib/api.ts` | 业务 invoke 封装和接口类型 |
| `src/lib/` | 价格坐标、统计筛选、费用分摊、速度布局等纯计算 |
| `src/lib/appearance/` | 外观配色、偏好校验、共享状态和同步 |

外观模块有三个职责：`themes.ts` 生成语义颜色和尺寸变量；`preferences.ts` 处理合法值、旧格式与修订号；`index.ts` 应用变量、订阅系统模式并同步本机偏好。原生外观命令集中于这一个状态入口，组件只读状态或提交选择。旧 `glass` 字段继续读取，含义调整为应用内毛玻璃。

`src/styles.css` 是唯一样式入口，依次导入基础、布局、公共控件、页面、动效与材质六层。图表和业务复杂布局使用相邻 CSS。新增控件复用语义变量和公共按钮，避免页面再次覆写按钮透明度、圆角或指针光层。

`src-tauri/data/ui-geometry.json` 是窗口、面板、普通控件与分段内层的尺寸来源，前端和 Windows 原生裁剪共用。开关、状态圆点和图表标记保留自己的几何形状。

## 桌面与窗口

主窗口 `main` 使用不透明 WebView。毛玻璃只模糊应用自身背景，导航/工作区承载材质，卡片和常规按钮保持实底。`appearance.rs` 负责偏好校验、原子保存和广播，不再操作 Blur/Acrylic。

`window_frame.rs` 维护无系统标题栏的重绘保护、浮动圆角及最大化/Snap 方角。`widget.rs` 管理独立 `usage-widget` 的位置、尺寸和命中区域，前端负责可打断的展开/收起；任务窗不继承主窗口磨砂。所有原生窗口变更遵守窗口线程约束。

`mimo-login` 是无 Quota IPC 权限的官方登录窗口。安装向导使用同一 Cargo 可执行产物的 setup 入口；外观固定浅色，不读取用户主题。托盘单击打开主窗口，关闭行为沿用 Tauri 事件处理。

## Rust 领域边界

| 领域 | 主要模块 |
| --- | --- |
| 命令与共享状态 | `commands.rs`、`lib.rs` |
| 账户与订阅 | `providers.rs`、`connections.rs`、`refresh.rs`、`mimo*`、`subscription.rs` |
| 模型与官方价格 | `ladder.rs`、`benchmarks/`、`ai_models.rs`、`official_prices.rs`、`official_tables.rs` |
| 用量与速度 | `activity.rs`、`activity_*`、`output_speed*` |
| 支出与汇率 | `vendor_costs.rs`、`usage_costs.rs`、`usage_fx.rs`、`usage_sync.rs` |
| 保存与迁移 | `storage.rs`、`secrets.rs`、`backup.rs`、`migration.rs`、`account_sync.rs` |

命令负责参数、锁和调用边界，领域服务负责计算与持久化规则。账户查询仍以 `Balance` 为中心，供应商定义和部分请求仍集中在 `providers.rs`；本轮没有把这些历史约束描述成已完成的服务拆分。

`catalog.rs`、旧资料格式和账务迁移仍被导入、官方资料适配与旧安装使用。删除未接入入口的旧前端页面，不代表可以删除这些数据兼容路径。模型价格来源、单位、配置与核实时间继续独立保存，未知值保持未知。

## 验证与维护

`npm run verify` 执行纯逻辑与组件检查，`npm run verify:ui` 在实际构建的合成预览中验证外观、账务操作、图表和任务窗。`scripts/lib/` 共用 TypeScript 加载器、合成费用和表面断言；已经退役的液态效果及旧页面测试删除。

Rust 运行逻辑使用对应 example；安装包另做覆盖升级、数据哈希、真实命令、窗口几何和任务窗检查。WebView 截图不等于桌面合成或真实鼠标拖动验收。详见 [开发指南](development.md)、[安全边界](security.md)、[统计与账务](activity-stats.md)。
