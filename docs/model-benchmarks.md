# AI 模型评测与价格

Quota 1.0.3700 按 [Artificial Analysis Intelligence Index v5.0.1](https://artificialanalysis.ai/methodology/intelligence-benchmarking) 组织 AI 模型页。用户可从综合榜切换到四个领域榜，按型号、厂商及评测范围筛选，或切换同一范围的人民币价格图。能力对比最多选择三个完整评测配置。

## 评测权重

| 领域 | 评测 | 占综合指数的权重 |
| --- | --- | ---: |
| 知识工作 | AA-Briefcase v1.1 | 15% |
| 知识工作 | AutomationBench-AA | 5% |
| 知识工作 | GDP.pdf | 5% |
| 编程 | FrontierCode-AA 2.0 | 15% |
| 编程 | Terminal-Bench 4.0 | 10% |
| 科学 | Terminal-Bench-Science 0.1 | 15% |
| 科学 | CritPt v2 困难子集 | 10% |
| 通用 | AA-Omniscience v1.1 | 15%（准确率 10%，非幻觉率 5%） |
| 通用 | HLE-Diamond | 10% |

综合榜采用 AA 发布的原始指数。每行对应一个完整配置，包括推理档位及公开的回退设置。领域分等于同一配置分项乘以各自在综合指数中的权重，再除以该领域的总权重 25%。缺少分项、单位不符或同一分项有互相冲突的值时，该领域分留空，保留其余原始分项和综合分。MMMU-Pro 是独立的视觉测评。

AA-Briefcase 保留原始 Elo。领域参考分将公开 Elo 按 `clamp((Elo - 500) / 2000, 0, 1) × 100` 换算。AA 使用该配置加入指数时冻结的 Elo，因此公开 Elo 计算的领域参考分与指数内部贡献可能不同。v5.0 和 v5.0.1 权重相同，v5.0.1 更新了 CritPt v2 的评分。评测以英文文本任务为主。

## 版本与离线使用

- 程序从现有公开榜单与评测页核对指数版本，并对照主力配置的名称和原分。完整分项、版本和模型配置一起写入本机缓存。遇到未知版本、数据冲突、暂时返回旧版或断网时保留上次有效快照并显示来源状态。
- 安装包内置此前已核实的 v5.0 快照。可用「更新数据」或每日自动更新获取 v5.0.1，界面展示实际快照版本。
- 主力集使用 AA 评测图默认配置，并为未覆盖厂商补充其完整实测最高分配置。近 30 天范围按明确的测评版本发布日期计算，覆盖当日及此前 29 个自然日。v5.0.1 的版本记录公布了更新月份，默认使用主力配置范围。型号发布日期和抓取日期仅作溯源。

## 价格

横轴以人民币显示每百万输入加每百万输出 Token 的标准单价，可切换为单独输入、输出、缓存命中价格。价格来自厂商官网，按厂商和精确型号关联。美元采用现有 ECB 参考汇率。无已核实标准价、价格单位不可比或美元缺少汇率时，型号仍可查看榜单和详情。API 单价与任务总支出是不同计量口径。

## 验证

按仓库流程保留历史 ECI、LiveBench 和 AA 快照的黄金样本。验证使用公开来源和合成账户/活动资料：

```text
python scripts/audit-benchmark-sources.py
python scripts/reference-scenarios.py
cargo run --release --locked --example benchmark_checks -- --fixtures
node scripts/verify-visual-models.cjs
node scripts/verify-benchmark-ui.cjs
```

Rust 验证输出 `target/benchmark-sources/board.json` 与 `dataset.json`，分别用于前端预览和 `check-benchmark-ui.ps1 -BenchmarkData` 的隔离 WebView 验收。

2026-11-13 在 Windows x64 验证了安装向导、1.0.3600 → 1.0.3700 的实际覆盖升级、安装文件与 DLL 校验及安装版启动。安装版 WebView 核对了 77 个离线配置和 107 个 v5.0.1 配置的综合指数与显示。另用隔离实例验证了从内置 v5.0 联网刷新、获取 107 个 v5.0.1 配置并写入缓存。原始 Epoch 数据与历史适配的署名见 [评测数据署名](../src-tauri/data/NOTICE-benchmark-data.md)。
