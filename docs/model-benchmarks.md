# 综合与场景天梯的计算

当前版本 1.0.2900，算法标识 `calibrated-scenarios/3.0`，场景规则 `quota-scenarios/1.0`。

按用户选择，默认是**通用综合**，同时提供**编程、推理、Agent、知识**分榜。AA 与 LiveBench 保留原始平台对照，不再把两种不同尺度的总分或名次平均后当作模型能力。价格、速度和厂商热度不影响能力排序。

## 为什么再次调整

1.0.2800 的分位数、小样本交集、跨配置取最高分和任意官网权重有实质问题。1.0.2801 修复了来源数值和显示，但主要仍是两张原榜与平均名次，不能满足通用综合及场景分析。历史交付记录保留，不能当作当前方法。

本版区分“来源发布的综合能力估计”“Quota 的场景计算”和“原始测评成绩”。不同任务难度、单位、版本与运行工具不能仅因列名相近而直接平均。

## 通用综合：使用发布的 ECI

主榜直接读取 [Epoch AI 官方数据包](https://epoch.ai/data/benchmark_data.zip)中的 `epoch_capabilities_index/eci_scores.csv`，保留原始 ECI、小数精度及来源发布的 90% 区间，不自行改写它。

[ECI 的公开方法](https://epoch.ai/data/eci-documentation/methodology)使用逻辑曲线：

```text
预期测评成绩(m,b) = sigmoid(斜率_b × (能力_m − 难度_b))
```

来源使用多项测评来联合估计模型能力、测评难度和斜率，通过带正则项的非线性最小二乘拟合；尺度以 Claude 3.5 Sonnet = 130、GPT-5 = 150 为锚点。它不是百分比或 IQ。公开数据包含 Epoch 实测、测评机构与厂商报告，并非每一项都是独立复测。

来源发布的综合值可能按其模型组规则聚合多套配置。Quota 明确标为“Epoch 发布综合 · 来源聚合配置”，**不宣称它代表一套配置或同一预算**。下方的同配置单项是对照证据，不拿来伪装重算官方综合值。

本轮快照有 270 个综合型号、59 个难度参数。示例：Opus 5.5 为 168.83，90% 区间 165.25–173.95；Astra 为 168.81，区间 165.45–174.51。点估计顺序不表示存在统计显著的领先，区间明显重叠。

## Quota 场景计算

参考 [Epoch 的领域方法](https://epoch.ai/data/eci-documentation/domain-specific-eci)和[官方实现](https://github.com/epoch-research/eci-public)，保留当前公开的测评难度和斜率，只针对场景重估模型能力。Quota 自行维护数据适配、场景规则、配置约束、计算及验收，不依赖 AITier 提供任何分数。

### 原始记录与配置

- 用 `model_metadata.csv` 的显式型号组与配置映射关联，不用近似名称猜型号。日期、尺寸、未知变体不合并。
- 按 `benchmark_metadata.csv` 指定的文件、列、单位、随机基线和上限读取原始成绩；不执行下载的脚本，不读取评测运行日志。
- 同一型号、同一配置、同一测评的相同值去重；数值冲突则整组排除，不取最高值。本轮排除 209 个冲突组合。
- 新版测评只在**同一配置**同时拥有新旧记录时替代旧版。
- 每个型号固定一套配置，首先按场景集合中有效测评数量选取，数量相同才按 Max / Xhigh / High 等公开档位及配置标识稳定选择。选择过程不读取成绩高低；不同分项不会各挑一套配置。
- 至少两项场景测评才能给出分榜指数。两项记录会显示“少量测评”，缺失、冲突或无法识别时保留未知，不补零或用另一个档位顶替。

原始包经过大小、解压总量、CSV 表头、CRC、有限数值、型号映射及记录唯一性检查；失败保留上次成功数据。

### 基线与难度校准

```text
p_b = clamp((原始成绩_b × 单位缩放_b − 随机基线_b)
            / (成绩上限_b − 随机基线_b), 0, 1)

场景指数 C = argmin_C mean_b[
  (sigmoid(公开斜率_b × (C − 公开难度_b)) − p_b)²
]
```

例如 GPQA 的元数据给出随机基线 0.25、上限 0.97；若原始成绩是 80%，校准值是 `(0.80−0.25)/(0.97−0.25)=0.7639`，不是直接把 80 加入平均。该示例仅说明换算，不指某款模型。

同一场景内每项测评各一份权重；没有按厂商、发布时间或官网自报身份加分。难度与斜率来自同一公开快照，避免自己用少量型号的名次估计测评难度。场景指数与 ECI 共用校准尺度，但**不是 Epoch 官方发布的领域指数**。

平方逻辑曲线误差不保证全局凸，计算会扫描 0–250 的区间并细化每个局部极小值，选择全局扫描中的最优值。最优值落在边界时不输出有限能力估计；全 0 或全 1 不能被伪装成确定的能力值。搜索边界属于实现约束，会在无法界定时显示缺测，而不是截断成 0 或 250 分。

### 场景范围

规则在 `src-tauri/data/benchmark-policy.json`，只有明确列入的测评参与。代表性测评包括：

| 分榜 | 测评例子 | 本轮可排名型号 |
| --- | --- | ---: |
| 编程 | SWE-Bench verified、Aider polyglot、GSO、FrontierCode、FrontierSWE、MirrorCode、WeirdML v3 | 27 |
| 推理 | ARC-AGI-2、DTBench、SimpleBench、BBH、MATH、OTIS AIME、FrontierMath v2 | 178 |
| Agent | APEX-Agents、The Agent Company、Remote Labor Index、GDPval、OSWorld 2.0、EBR、MirrorCode 等 | 30 |
| 知识 | GPQA、SimpleQA Verified、MMLU、TriviaQA、OpenBookQA | 116 |

本轮不将含不同任务版本与运行工具的 `Terminal Bench` 表绑定到单一难度参数，也不把 METR 时长直接当成通过率。新测评的场景归类须明确适配；新型号通过来源元数据自动识别，不需要手工维护型号名单。

### 不确定性和分层

综合榜保留**来源发布的 90% 区间**。场景榜有至少三项数据且每次留出都可求有限值时，逐项删除一个测评重算，展示最小到最大结果作为**敏感性范围**；它不是 90% 或 95% 置信区间。不完整范围不展示为完整区间。

综合和场景等级采用固定展示边界：S ≥165、A ≥155、B ≥145、C ≥130、D <130。它们是界面分组规则，不是统计显著性或答对率。不会因搜索、厂商筛选或新增型号而改动既有分数或等级。

## 原始平台与官网对照

[AA](https://artificialanalysis.ai/leaderboards/models)保留 Intelligence Index v5 原始指数和完整配置，分项、成本通过原始 slug 关联。默认选公开综合指数最高的一整套配置，也可选择 Low / High / Max 等档位。不是逐分项选最高值。

[LiveBench](https://livebench.ai/)按当前 `categories.json` 的 `_overall_weights` 计算：20261025 版本长程任务 2，编程和设计各 1.5，推理、浏览、数据分析和研究各 1。空项移出分母，0 分保留。它与 ECI、AA 的数值不直接混合。

模型详情并列显示 ECI、AA、LiveBench 的原始综合值，原始成绩与基线校准值分列，保留配置、来源链接及运行条件。官网报告保留为独立对照；不能将不同 harness 或预算的成绩称作同一次测量。效率图仍使用同一 AA 配置的指数与美元/任务；厂商 API 单价另列。

## 自动更新与验证

三个公开来源每日检查，共用设置中的天梯自动检查开关；任一来源失败不清空其他有效数据，也不将旧值标成新测量。schema 3 写入 `ai-benchmarks-v3.json`，旧 v1/v2 文件保留但不参与新显示。Epoch 数据包的 SHA-256 标识整套参数与记录版本。

```powershell
python scripts/audit-benchmark-sources.py
python scripts/reference-scenarios.py
cd src-tauri
cargo run --release --example benchmark_checks -- --fixtures --live
# 人工审查原始来源和对账后，再加 --write-seed 更新内置公开快照
```

独立 Python 解析、配置选择和数值搜索与 Rust 实现逐条对账。本轮包含 270 个公开综合值、351 个场景结果和既有 35 个 AA/LiveBench 黄金预期，共 656 个预期值；另核对所有 AA 主榜配置。浏览器及真实安装版检查七张榜单的显示值、配置、名次和区间，并验证分页展开后的全量记录。

这些验证证明来源、实现和显示一致，不证明某个指数可以预测所有实际工作；测评样本、工具、配置与来源偏差仍需结合具体任务判断。

Epoch AI 数据采用 [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)，署名与变换说明见 `src-tauri/data/NOTICE-benchmark-data.md`。
