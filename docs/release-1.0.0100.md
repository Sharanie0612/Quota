# Quota 1.0.0100

2026-10-03 · 首次采用新版本规则 · 包版本 1.0.100 · 本地构建待发布

- 小米：在官方窗口登录后完成连接，无需复制 Cookie；API Key 收进高级设置，作为模型同步的可选信息。
- ChatGPT：连接本机 Codex 登录，显示订阅内 Codex 的短期/每周额度及重置时间。它不代表 ChatGPT 网页聊天次数；登录过期需重新登录 Codex。
- 表单与提示：保留三步教程，常用连接和手动记录直接可见，自定义接口等设置折叠。
- 托盘：移除悬浮卡，单击直接打开软件。系统通知、充值提示、托盘预警角标可分别关闭。
- Token 活动：自动采集 Codex 与智谱 ZCode 的本地历史，按设备、来源与时间查看 Token、模型、Agent 和工具统计；共享目录自动同步、事件去重。首次使用在每台设备选择同一个网盘同步目录或 NAS，详见 [使用说明](activity-stats.md)。
- 缓存价格：标准输入未命中、缓存命中、短期和长期缓存写入独立展示，未核实字段留空。
- AI 模型天梯：322 个模型、68 个厂商，图表按厂商分色，十一种能力分类、厂商/币种筛选、同币种价格排序、最多三个模型对比。排名来自 [AITier](https://aitier.net/zh)，名次保留全榜名次。
- 默认每日检查排名和官方价格候选，可在设置关闭。离线保留最近排名；价格候选须人工核对后采用，保存到本机资料库，自动检查不会覆盖已核实价格。
- 修复：查询失败保留上次数据，失败快照不记为余额变化；备份解密检查长度与计算参数。

## 原厂价格快照

每百万 tokens，标准档；未命中输入、缓存命中与缓存写入独立展示，各币种独立展示，不换汇。核实日期独立于排名更新时间。官网无法确认的价格留空。Gemini 价格包含官方限时活动，详见价格备注。

| 模型 | 输入 / 输出 | 币种 | 核实日期 | 来源 |
| --- | --- | --- | --- | --- |
| GPT-6 Astra | 10 / 50 | USD | 2026-10-03T00:00:00+08:00 | [官方定价](https://developers.openai.com/api/docs/pricing) |
| GPT-6.1 Sol | 2 / 10 | USD | 2026-10-03T00:00:00+08:00 | [官方定价](https://developers.openai.com/api/docs/pricing) |
| GPT-6 Luna | 0.1 / 0.5 | USD | 2026-10-03T00:00:00+08:00 | [官方定价](https://developers.openai.com/api/docs/pricing) |
| Claude Opus 5.5 | 4 / 20 | USD | 2026-10-03T00:00:00+08:00 | [官方定价](https://platform.claude.com/docs/en/about-claude/pricing) |
| Claude Sonnet 5.5 | 2 / 10 | USD | 2026-10-03T00:00:00+08:00 | [官方定价](https://platform.claude.com/docs/en/about-claude/pricing) |
| Gemini 3.8 Flash | 0.75 / 3.75 | USD | 2026-10-03T00:00:00+08:00 | [官方定价](https://ai.google.dev/gemini-api/docs/pricing) |
| DeepSeek V4.1 Flash | 2 / 8 | CNY | 2026-10-03T00:00:00+08:00 | [官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) |
| DeepSeek V4 Pro 0813 | 9 / 27 | CNY | 2026-10-03T00:00:00+08:00 | [官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) |
| Kimi K3 | unknown / unknown | CNY | 待核实 | [官方定价](https://platform.kimi.com/docs/pricing/chat) |
| GLM-5.3 | unknown / unknown | CNY | 待核实 | [官方定价](https://bigmodel.cn/pricing) |
| MiMo-V2.6-Pro | 3 / 6 | CNY | 2026-10-03T00:00:00+08:00 | [官方定价](https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go) |
| MiMo-V2.6-Flash | 1 / 2 | CNY | 2026-10-03T00:00:00+08:00 | [官方定价](https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go) |

## 验证范围

类型检查、前端构建、Rust 检查、逻辑自检、订阅/天梯/备份解析示例、浏览器真实组件布局与 NSIS 安装包解包启动检查（隔离配置目录，包含 WebView2Loader.dll）。模拟账户用于布局检查，不代表已验证真实账户登录。小米登录页与 Codex 额度端点变化可能要求重新连接或后续适配。

覆盖现有安装的升级/卸载流程和真实小米、ChatGPT 账户登录尚未进行现场验证。现有安装和账户数据未更改。本次未提交、推送或创建远程发布。

已通过：`npm run typecheck`、`npm run build`、`cargo check`、`verify-logic.cjs` 7/7；`product_checks` 对实际 AITier 页面解析得到 322 个模型，并通过限额边界、文本帧、备份损坏及展示版本检查。界面在默认尺寸和 1024×600 下检查，无前端错误。

2026-10-04 补充功能仍属于本次未发布的 `1.0.0100`（包版本 `1.0.100`），按每次发布只递增一次的规则不按提交或修改次数累加。

本次补充验证：类型检查与前端构建通过；Rust 检查仅保留既有 `get_api_key` dead_code 警告；逻辑自检 7/7。`activity_checks` 已通过 ZCode 新旧记录、迁移数据库、追加、未完整行、截断、分叉、双设备合并及隐私字段排除；本机只读扫描可读取 Codex/ZCode 指标且无来源错误。真实多设备网络同步需各设备配置共享目录后使用，本次验证使用隔离的双设备目录。

2026-10-04 最终补充构建已通过 NSIS 解包后的程序启动检查（独立配置目录，8 秒存活，包含 WebView2Loader.dll），并生成完整展示号命名的安装包与便携 ZIP；未执行覆盖个人安装的升级流程。
