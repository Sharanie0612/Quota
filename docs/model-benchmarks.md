# 模型天梯与六维对比

1.0.3001 使用 `source-native-configuration/4.0`。AI 模型页保留人民币价格与能力坐标图、六维对比；模型库、原分层卡片、场景总分和效率曲线入口已移除。

## 分数

综合能力直接读取 [Artificial Analysis Intelligence Index v5](https://artificialanalysis.ai/methodology/intelligence-benchmarking) 的非估算公开指数。每个点对应一个完整评测配置，包括推理档位和公开的回退设置。保留原始精度绘制坐标，详情显示一位小数；不按厂商、价格、发布时间、同池名次或个人偏好额外加分。

不把 ECI、AA、LiveBench 的总分相加，不从不同推理配置中分别挑选最高分。过去的 ECI/场景适配器和独立参考回归保留为历史兼容，不作为本页能力坐标。公开测评的任务分布与个人工作流不同，分数不保证等同于特定 harness 的体验。

## 日期与价格

- 默认展示各厂商当前主力配置，测评版本须在近30天内公开更新，包含今天和此前29个自然日。主力集以来源当前对比图的默认在用配置为基础，为未覆盖厂商补充该厂商完整实测最高分配置；可切换近30天全部档位或全部有效测评。
- 版本日期取自 [AA v5 更新公告](https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v5/) 中的 `datePublished`，当前为2026-10-27；原始配置与分数同时核对官方评测页。型号即使在30天之前发布，仍可进入当前主力图。
- 来源没有提供每个型号的重跑日期，界面明确称“测评版本更新”。型号发布、抓取/核实时间、公告编辑时间均不能替代测评版本日期；旧测评不会因重新抓取而刷新时效。更新日不明或超过时限时不进入近30天范围，全部有效测评中保留。
- 横轴固定人民币，默认每百万输入加每百万输出 Token 的标准成本，也可比较输入、输出或缓存命中价格。图中标明具体单位，价格轴沿用对数刻度。
- 价格来自厂商官方定价解析，按厂商和精确型号关联；不同厂商的同名模型不能借用价格。美元按现有 ECB 参考汇率换算。价格、汇率或单位无法确认时保留型号与分数，不制造价格坐标。
- 可按具体推理档位筛选。推理档位改变任务消耗 Token 的数量；坐标中的 API 单价不等同于完成一项任务的账单。

## 六维

六边形形式保留，每次最多比较三个公开配置。各轴直接显示同一配置的原始百分比，不填补缺失维度、不把 Elo 强行改成百分比，也不将六轴再平均为另一套综合分。

| 轴 | 原始测评 |
| --- | --- |
| 推理 | HLE-Diamond |
| 编程 | FrontierCode 2.0 |
| 知识 | AA-Omniscience v1.1 accuracy |
| 科研 | CritPt v2 hard subset |
| 智能体 | AutomationBench-AA |
| 视觉 | MMMU-Pro |

## 更新与核对

公开测评、测评版本公告、型号发布日期和官方价格分别核实，失败保留上次有效资料并显示来源状态。`model-releases.json` 只为详情提供发布日期，不参与近30天筛选。兼容的schema 3来源增加可选 `edition`（版本发布日期、原始链接、主力配置ID）。缺少该字段的旧缓存从已核实种子升级；旧本机资料和备份格式保留。

验证命令：

```text
python scripts/audit-benchmark-sources.py
python scripts/reference-scenarios.py
cargo run --release --example benchmark_checks -- --fixtures
node scripts/verify-visual-models.cjs
node scripts/verify-benchmark-ui.cjs
```

源站快照附 SHA-256。独立期望值、配置关联、日期边界、厂商隔离、真实 React 坐标及打包后 WebView 分别验证。原始 Epoch 数据与历史适配的署名见 `src-tauri/data/NOTICE-benchmark-data.md`。
