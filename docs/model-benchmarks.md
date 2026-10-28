# Quota 模型测评与综合分

算法标识：`quota-index/1.0`。主天梯独立计算，不读取 AITier 排名。

## 数据与职责

| 来源 | 用途 | 更新方式 |
| --- | --- | --- |
| [Artificial Analysis](https://artificialanalysis.ai/leaderboards/models) | v5 分项原始成绩、各配置的能力指数与任务成本 | 固定公开页面解析，每日检查 |
| [LiveBench 2.0](https://livebench.ai/) | 推理、编程、知识分析、研究、长程智能体、浏览与设计成绩 | 从官网脚本中的发布日期列表发现最新版，再读取该版本 CSV 和分类定义 |
| OpenAI、Anthropic 官方发布报告 | 带精确型号、配置与出处的补充测评证据 | 人工核对后随版本提供；不把手工快照标成自动更新 |
| 十家厂商官方定价页 | 标准 API 单价、缓存与条件档位，以及可核对的型号资料 | 延续独立官方价格适配器；不使用评测平台单价替代官网报价 |

当前固定支持 AA Intelligence Index v5 的分项定义与 LiveBench 2.0 的七列结构。版本、表头、类别或单位出现不明确变化时拒绝更新该来源，保留上次成功的数据与时间，并在界面提示。一个来源失败不阻止另一个来源更新。

内置快照 `src-tauri/data/benchmarks.json` 首次打开即可使用；本机缓存为 `ai-benchmarks-v1.json`。数据只含公开模型测评，不读取账户凭据、不运行模型推理、不新增用量账本。每日检查可在设置关闭，失败在后续小时检查时重试。

## 型号与配置

只按精确型号规范化标识匹配：忽略大小写和分隔符，保留所有版本、日期、尺寸和其他变体。只有明确的 Low / Medium / High / Xhigh / Max / Reasoning / Non-reasoning 等配置后缀可从型号中拆出。不能把 `(0902)`、`(June 2026)`、`(32B)` 当成配置删除，不能模糊匹配相近名称。

每个来源、测评、版本、精确型号只取一条最高公开成绩。不同推理档位不重复增加权重，重复下载或镜像也不增加独立来源数。记录仍保存原始配置，包含来源说明的工具、默认回退与防护条件。这是公开可用配置的综合参考，不表示裸模型在相同算力预算下的能力；最高成绩也可能来自不同的配置。

## 五个主维度

| 维度 | 综合权重 | AA 指标族 | LiveBench 分类 |
| --- | ---: | --- | --- |
| 推理 | 20% | HLE-Diamond | Reasoning |
| 编程 | 20% | FrontierCode 2.0、Terminal-Bench 4.0 | Coding |
| 知识分析 | 20% | GDP.pdf、AA-Omniscience v1.1 | Data Analysis |
| 科学研究 | 20% | CritPt v2 Hard、Terminal-Bench-Science 0.1 | Research |
| 智能体 | 20% | AutomationBench-AA、AA-Briefcase v1.1 | Long Agentic、Browser |
| 视觉与创作 | 独立展示 | MMMU-Pro | Design |

视觉与创作包含不同类型的图像和设计任务，单独展示，避免把多模态覆盖差异混入文本综合分。Omniscience 的准确率与非幻觉率属于同一指标族，族内权重为 2:1；其余同平台、同维度的指标族等权。这个比例参考 AA 对两项的区分，并非照搬 AA 的整套综合分。

## 如何计算

1. **建立共同参考群体。** 取同时在至少两个独立评测平台出现的精确型号。官网补充结果不增加独立平台数。对每个测评版本，再从这个群体中筛出有原始成绩的型号；少于 5 个时，这项只展示原始数据，不参与评分。
2. **原始成绩转相对分位。** 对该项的参考成绩排序。零起始名次为 `r`、样本数为 `n` 时，分位为 `100 × r / (n − 1)`。并列取平均名次，全部同分时为 50。两个已知成绩之间按相邻分位线性插值；区间外限制在 0–100。这里所有纳入的指标都是越高越好；低者更好的新指标需要先明确实现方向。
3. **先按指标族、再按平台平均。** 指标族内使用声明的分项权重；一个平台在某维度的多个指标族等权平均。某维度的多个独立平台再等权平均。因此指标数量更多的平台不会天然占据更大权重。
4. **官网补充最多占 20%。** 当某维度既有独立成绩，也有满足相同参考要求的官网成绩时：`维度分 = 0.8 × 独立平台均分 + 0.2 × 官网报告均分`。没有可用官网成绩则完全使用独立平台；官网不能单独产生维度分。官网转述的第三方结果不能再次作为独立平台。目前内置官网补充仅影响编程维度，最多占完整综合分的 4%。
5. **综合五维。** `综合分 = Σ(可用维度分 × 20%) / Σ(可用维度的 20%)`。缺失留空，不能当作零；覆盖不足 80% 或少于两个独立平台时进入观察名单。完整覆盖时就是五维均分。
6. **展示与并列。** 最后四舍五入到一位小数，同分共享名次，之后跳号，例如 1、1、3。S ≥ 85、A ≥ 70、B ≥ 55、C ≥ 35，其余为 D；分档是 Quota 的展示规则，不是测评平台的能力认证。

演算例（用于解释规则的合成数据）：某型号五维独立分均为 100，官网编程分为 0，则编程分为 80，最终综合分为 `(100 + 80 + 100 + 100 + 100) / 5 = 96`。官网不能把这一项的影响扩大到整张榜单的 20%。对应边界在 `benchmark_checks` 中实际执行。

分数是**当前共同参考群体内的相对位置**，不是答对率，也不是统计置信区间。参考群体、版本或快照更新后，旧分数不能直接与新分数作纵向比较。不同平台的工具、预算、题目和回退条件仍有差异；原始数据与配置可以在模型详情展开核对。

## 效率曲线

参考近期 [OpenAI 模型发布图表](https://openai.com/index/introducing-gpt-6-1-terra/) 的能力与成本关系，用一个圆点表示一个公开推理配置，连线展示同型号各配置，虚线为所选点的 Pareto 边界。

- 横轴：AA 同一配置实测的美元 / 任务，对数刻度。未知、无效或零成本不放进对数坐标。
- 纵轴：该配置的 **AA Intelligence Index v5**，不是 Quota 综合分。只绘制非估计且具有 v5 核心分项的配置。
- 边界：在所选点中，不存在另一个点成本更低且能力不低的点。相同成本保留能力更高者。
- 不把低推理档位的成本与高推理档位的成绩拼接；不把每百万 Token 报价称为每任务成本。

## 官网证据台账

- [OpenAI GPT-6 Astra](https://openai.com/index/gpt-6-astra/) 的 Terminal-Bench 4.0 比较表，以及 [GPT-6.1 Terra](https://openai.com/index/introducing-gpt-6-1-terra/) 明确给出的两项成绩，共 8 条。当前共同参考群体中只有 4 款具有这一组官网结果，不足 5 个，故这些记录只展示，不强行计分。
- [Anthropic Opus 5.5](https://www.anthropic.com/claude-opus-5-5)、[Sonnet 5.5](https://www.anthropic.com/claude-sonnet-5-5)、[Haiku 5.5](https://www.anthropic.com/claude-haiku-5-5) 的 Terminal-Bench 4.0 报告中，5 个共同参考型号满足要求，作为同一个官网发布方的补充证据。保留表列配置；未明确的档位不猜测。不重复加入其中转述 OpenAI 的相同成绩。

官网数据不支持自动读取时不会标成自动；第三方评测与官方价格仍独立自动更新。后续扩展官网测评应先核对精确型号、题集版本、工具和配置，再加入台账或确定性解析器。

## 算法参考与区别

- [AITier 关于页](https://aitier.net/zh/about)：借鉴分层天梯与多来源展示；没有声称复现其未公开的完整算法。
- [AA 方法说明](https://artificialanalysis.ai/methodology/intelligence-benchmarking)：参考明确分项、版本和条件的做法；Quota 使用自己的五维和平台等权，效率图直接使用 AA 原指数。
- [LiveBench 评分代码](https://github.com/LiveBench/LiveBench/blob/main/livebench/show_livebench_result.py)：参考分项聚合与缺失值处理。LiveBench 2.0 自身的总榜类别权重不直接用于 Quota 的五维综合分。
- [Arena Rank](https://github.com/lmarena/arena-rank)：研究其 Bradley–Terry 与不确定性处理。Quota 没有原始对战票据，不拟合或宣称拥有 Elo / Bradley–Terry 排名、胜率或置信区间。AA-Briefcase 自身的公开 Elo 先转换成相对分位。

## 复现与验证

```powershell
python scripts/audit-benchmark-sources.py
cd src-tauri
cargo run --release --example benchmark_checks -- --fixtures
# 同时验证实时更新链路：加 --live
# 人工确认后更新内置快照：再加 --write-seed
```

公开夹具位于被忽略的 `target/benchmark-sources/`，生成的 `board.json` 用于浏览器预览。自检包含：日期/型号不可误合并、单项单型号去重、顺序无关、并列、缺失重归一、单源观察、官网权重上限、版本/表头变化拒绝采用、异常值隔离和失败保留。`verify-benchmark-views.cjs` 检查环形图分组守恒、缓存子项与成本效率边界；`verify-benchmark-ui.cjs` 检查真实生产组件。
