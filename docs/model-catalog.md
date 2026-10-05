# 内置模型资料库（模型 ID → 简介卡片）

> 核实日期：2026-09-23（小米 MiMo 小节于该日新增并合并）。用途：把 API 拉回的 model id 匹配成简介卡片。
> 取数规则：
> 1. 价格与上下文均逐条摘自各厂商官网定价/模型文档页原文，**官网查不到一律写 `unknown`，不编造数字**；
> 2. 默认输入价只取**标准档、非缓存命中**；缓存命中、5 分钟与 1 小时缓存写入独立保存为 `cachedInput`、`cacheWrite`、`cacheWriteLong`，缺失留空。闲时和 Batch 折扣不混入标准价；
> 3. 价格单位以每节表格最后一列为准（同节内一致）；
> 4. "上下文长度"括号内为官网标注的"最大输出"（如有）。
> 5. 自动应用资料只允许显式别名归一化后精确匹配；相似名称不能证明同一计费模型，也不能继承“已核实”价格。未知型号保留原始 ID 与 API 提供的上下文，价格待核实。
> 6. 本机覆盖与内置资料分别展示完整价格、来源与核实日期，不跨记录补齐字段或借用核实状态。已有覆盖缺缓存字段时，通过价格比对显式采用官方资料；保留本机名称与简介。
> 7. 建议优先选最新的已核实价格记录，同日同时间时选价格字段较完整的记录；无已核实记录时才建议官网抓取候选。候选始终需人工核对后采用；完全没有价格字段时不显示采用建议。第三方参考价采用后仍为待核实。
> 8. 比价可信度同时检查重叠的输入、输出、缓存价格以及币种和单位。同一官网的本机、内置和抓取副本不算独立来源；不同币种或不可比单位不声称价格一致。
> 9. 保存前校验价格为有限非负数、上下文为正整数；已核实记录须有有效来源和核实时间。磁盘保存成功后才更新内存，失败保留原有记录；更新一个别名不删除其他别名的资料。

### 1.0.0700 天梯精确自动核实

应用户要求，天梯对 OpenAI 官方 Markdown 的 Standard 短上下文表与 Kimi 官方 DocTable 提供确定性自动核实。必须匹配固定列名、精确模型 ID、币种与百万 Token 单位；不会使用批量、优先、长上下文或模糊名称匹配。推理版本仅去掉明确的评测强度后缀，不去掉模型版本号。OpenAI 的通用缓存写入列未明确 TTL，不写入 5min/1h 字段。页面结构变动、重复型号或字段无效时停止对应条目的自动核实。自动核实记录保存在天梯快照并附官网来源与时间；本机人工覆盖仍走采用流程。其余厂商的启发式候选不自动采用，不把官网成功抓取等同于价格已核实。

### 1.0.0800 十厂商官网自动核实

天梯已取消人工核对和采用表单。OpenAI、Kimi、Anthropic、DeepSeek、智谱、Google、小米、阿里云、xAI、Meta 各有独立的官方表格解析器；仅匹配精确型号与明确评测后缀。AITier 负责型号和排名，价格从厂商官网独立获取；AITier 读取失败仍检查价格。不同型号不继承价格。

解析器校验列名、计价单位、币种和档位。Anthropic 排除退役型号并分别保存 5min/1h 缓存；DeepSeek 默认高峰标准价；Google 读取 Standard 短上下文及当前生效日期，缓存存储不当作缓存命中；小米只取中文国内实时推理；阿里云固定华北 2 北京实时推理、首个短上下文档，详情注明地域与长度。阿里云模式价格不同或标准型号缺失时不推算。图像、音频、视频按次或时长计价的型号保留能力排名，不能放进百万 Token 比价坐标。

官网访问失败、表头变化、精确型号缺失均显示原因并保留上次核实记录。成功检查更新来源和核实时间，价格详情保留条件；小数按原精度显示。天梯自动记录保存在 ladder_cache.json，模型库人工资料覆盖仍使用原有流程。每日自动检查可在设置关闭；更新按钮同时更新排名与价格。

### 2026-10-04 缓存字段补录

以下为官方页面当前标准价，单位均为 CNY / 百万 Token。此前已有数字备注，但结构化字段缺失，现已补齐，核实时间保存在资料库条目中。

| 模型 | 未命中输入 | 命中输入 | 输出 | 缓存写入 5min / 1h |
| --- | ---: | ---: | ---: | --- |
| Kimi K3 | 20 | 2 | 100 | 20 / 40 |
| Kimi K2.7 Code | 6.5 | 1.3 | 27 | 未单列 |
| Kimi K2.7 Code Highspeed | 13 | 2.6 | 54 | 未单列 |
| Kimi K2.6 | 6.5 | 1.1 | 27 | 未单列 |
| MiMo V2.6 Pro UltraSpeed | 30 | 0.25 | 60 | 写入限时免费（0） |

来源：[Kimi 官方推理定价](https://platform.kimi.com/docs/pricing/chat)（官方 Markdown 版本包含 DocTable 完整表格）、[MiMo 官方按量定价](https://mimo.mi.com/docs/price/pay-as-you-go)（中文文档当前静态页面块）。天梯的 K3 Max/Low 和 K2.6 Reasoning/Non-reasoning 为同一模型不同评测配置，使用相同官方模型标准价；不引用 AITier 的价格候选。

---

## 1. DeepSeek

来源：https://api-docs.deepseek.com/quick_start/pricing 、https://api-docs.deepseek.com/news/news260910（2026-09-10 公告）

| 匹配ID模式 | 显示名 | 一句话中文简介 | 上下文长度 | 输入价格 | 输出价格 | 能力标签 | 价格币种与单位 |
|---|---|---|---|---|---|---|---|
| deepseek-flash, deepseek-v4-flash, deepseek-v4-flash-vision-exp | DeepSeek V4.1-Flash | 支持视觉的新旗舰对话模型 | 1M（最大输出384K） | 2 | 8 | 视觉,工具调用,推理,代码 | CNY/百万tokens |
| deepseek-v4-pro | DeepSeek V4-Pro | 长文本旗舰 | 1M（最大输出384K） | 9 | 27 | 工具调用,推理,代码 | CNY/百万tokens |
| deepseek-chat, deepseek-reasoner | DeepSeek Chat / Reasoner | 历史别名，官网已下线 | unknown | unknown | unknown | unknown | unknown |

备注：
- 表中为**高峰（标准）价**；2026-10-04 重新核对官网，高峰为北京时间周一至周五（不含中国法定节假日）09:00–12:00、14:00–18:00；其他时段、周末及中国法定节假日全天为空闲时段，价格为高峰的五折。资料库默认保持标准高峰价。
- 已采用当前官方缓存命中标准价：Flash 0.04、V4-Pro 0.30 元/百万 Token；空闲价分别为 0.02、0.15。旧备注的 0.006/0.044 已过时，不作为当前价格。
- 2026-10-03 重新核实[中文官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)，国内标准非缓存价以本表为准；9 月临时路由说明只作为历史记录，不作为当前计费承诺。
- `deepseek-chat` / `deepseek-reasoner` 在当前官网文档已完全下线（仅历史 ID），故价格/上下文为 unknown。
- 能力表（官网）：JSON 输出、工具调用、Responses API、Anthropic API 兼容均 ✓；视觉仅 Flash ✓（V4-Pro 明确"不支持"）；双模式（思考/非思考）。

---

## 2. 小米 MiMo 开放平台（mimo.mi.com / platform.xiaomimimo.com）

来源：https://mimo.mi.com/docs/price/pay-as-you-go （按量付费定价页，2026-09-23 核对）、
https://mimo.mi.com/docs/quick-start/model （模型列表）、
https://mimo.mi.com/docs/quick-start/first-api-call （OpenAI 兼容调用说明）

| 匹配ID模式 | 显示名 | 一句话中文简介 | 上下文长度 | 输入价格 | 输出价格 | 能力标签 | 价格币种与单位 |
|---|---|---|---|---|---|---|---|
| mimo-v2.6-pro, mimo-v2.5-pro | MiMo V2.6 Pro | 旗舰对话模型，1M 上下文 | 1M（最大输出128K） | 3.00 | 6.00 | 工具调用,长上下文 | CNY/百万tokens |
| mimo-v2.6-flash, mimo-v2.5 | MiMo V2.6 Flash | 高性价比档位，适合大批量 | 1M（最大输出128K） | 1.00 | 2.00 | 工具调用,长上下文 | CNY/百万tokens |
| mimo-v2.6-pro-ultraspeed | MiMo V2.6 Pro 极速版 | 超高吞吐，单价明显更高 | 1M（最大输出128K） | 30.00 | 60.00 | 高速,长上下文 | CNY/百万tokens |
| mimo-v2.5-asr | MiMo V2.5 ASR | 语音识别，按音频时长计费 | 8K（最大输出2K） | unknown（按音频小时计 ¥0.5/h） | — | 语音识别 | CNY/音频小时 |
| mimo-v2.5-tts, mimo-v2.5-tts-voiceclone, mimo-v2.5-tts-voicedesign | MiMo V2.5 TTS | 语音合成，含音色克隆/设计 | 8K（最大输出8K） | 官方限时免费 | 官方限时免费 | 语音合成 | CNY/百万tokens |

备注：
- 上表为**国内站人民币价**，取「缓存未命中（cache miss）」标准档；缓存命中输入价：Pro ¥0.025、Flash ¥0.02、极速版 ¥0.25。
- 海外站为美元价：Pro $0.435 / $0.87、Flash $0.14 / $0.28、极速版 $4.35 / $8.70（本表未采用）。
- Batch 批量为实时价的一半左右，仅 Pro 与 Flash 支持；极速版、mimo-v2.5-pro、mimo-v2.5 不支持 Batch。
- 官方公告：`mimo-v2.5-pro` 与 `mimo-v2.5` 将于 **2026-10-21 10:00（北京时间）停用**，建议改用 v2.6 系列。
- `GET /v1/models` 实测（2026-09-23）：按量付费端返回 9 个 id（`mimo-v2.5`、`mimo-v2.5-{asr,pro,tts,tts-voiceclone,tts-voicedesign}`、
  `mimo-v2.6-{flash,pro,pro-ultraspeed}`）；Token Plan 订阅端 8 个（无 `mimo-v2.6-pro-ultraspeed`）。均无 description 字段。
  模型库里 `mimo-v2.5`/`mimo-v2.5-pro` 两个对话档 id 已按过时隐藏，语音档（ASR/TTS）为现役模型不隐藏、价格已按本节补录。
- 接口：OpenAI 兼容，Base URL `https://api.xiaomimimo.com/v1`，`GET /v1/models` 可用；鉴权头 `api-key: <MIMO_API_KEY>` 或 `Authorization: Bearer <MIMO_API_KEY>` 均可（本项目用后者）。
- **余额**：官方文档中没有任何用 API Key 查余额/额度的公开接口，余额与用量仅控制台可见（https://platform.xiaomimimo.com/#/console/balance ）。
  本软件通过隔离的官方登录窗口连接，再由后端读取控制台余额与套餐额度；失败可切换手动余额。

---

## 3. 智谱 GLM（open.bigmodel.cn / docs.bigmodel.cn）

来源：https://docs.bigmodel.cn/cn/guide/start/pricing.md（API 定价）、https://docs.bigmodel.cn/cn/guide/start/model-overview.md（模型概览）、https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3.md

| 匹配ID模式 | 显示名 | 一句话中文简介 | 上下文长度 | 输入价格 | 输出价格 | 能力标签 | 价格币种与单位 |
|---|---|---|---|---|---|---|---|
| glm-5.3 | GLM-5.3 | 始终思考的旗舰，编程智能体强 | 1M（最大输出128K） | 8 | 28 | 工具调用,推理,代码 | CNY/百万tokens |
| glm-5.3-flash | GLM-5.3-Flash | 原生多模态，图视频文件理解 | 1M（最大输出128K） | 0.8 | 2.8 | 视觉,工具调用,推理,代码 | CNY/百万tokens |
| glm-5.3-flashx | GLM-5.3-FlashX | 多模态高速版约200tok/s | 1M（最大输出128K） | 2 | 7 | 视觉,工具调用,推理 | CNY/百万tokens |
| glm-5.2 | GLM-5.2 | 工程交付与长程任务见长 | 1M（最大输出128K） | 8 | 28 | 工具调用,推理,代码 | CNY/百万tokens |
| glm-5.1 | GLM-5.1 | 编码对标Opus4.6，可长自主 | 200K（最大输出128K） | 6 | 24 | 工具调用,推理,代码 | CNY/百万tokens |
| glm-5-turbo | GLM-5-Turbo | 长任务连续性优化版 | 200K（最大输出128K） | 5 | 22 | 工具调用,推理,代码 | CNY/百万tokens |
| glm-5 | GLM-5 | Agentic长程规划与执行 | 200K（最大输出128K） | 4 | 18 | 工具调用,推理,代码 | CNY/百万tokens |
| glm-4.7 | GLM-4.7 | 通用对话推理智能体升级 | 200K（最大输出128K） | 2 | 8 | 工具调用,推理,代码 | CNY/百万tokens |
| glm-4.7-flashx | GLM-4.7-FlashX | 轻量高速，小尺寸强能力 | 200K（最大输出128K） | 0.5 | 3 | 工具调用,推理 | CNY/百万tokens |
| glm-4.7-flash | GLM-4.7-Flash | 免费通用文本模型 | 200K（最大输出128K） | 免费 | 免费 | 工具调用,推理 | CNY/百万tokens |
| glm-4.5-air | GLM-4.5-Air | 推理编码智能体均衡轻量 | 128K（最大输出96K） | 0.8 | 2 | 工具调用,推理,代码 | CNY/百万tokens |
| glm-4.6 | GLM-4.6 | 高级编码复杂推理工具调用 | 200K（最大输出128K） | unknown | unknown | 工具调用,推理,代码 | CNY/百万tokens |
| glm-5v-turbo | GLM-5V-Turbo | 多模态Coding视觉基座 | 200K（最大输出128K） | 5 | 22 | 视觉,工具调用,推理,代码 | CNY/百万tokens |
| glm-4.6v | GLM-4.6V | 原生工具调用，前端复刻强 | 128K（最大输出32K） | 1 | 3 | 视觉,工具调用,代码 | CNY/百万tokens |
| glm-4.6v-flashx | GLM-4.6V-FlashX | 高并发视觉推理 | 128K（最大输出32K） | 0.15 | 1.5 | 视觉,推理 | CNY/百万tokens |
| glm-4.6v-flash | GLM-4.6V-Flash | 免费视觉推理模型 | 128K（最大输出32K） | 免费 | 免费 | 视觉,推理 | CNY/百万tokens |
| glm-4.5v | GLM-4.5V | 视觉理解多模态模型 | 64K | 2 | 6 | 视觉,推理 | CNY/百万tokens |
| glm-4.1v-thinking-flashx | GLM-4.1V-Thinking-FlashX | 复杂场景视觉思考 | 64K（最大输出16K） | 2 | 2 | 视觉,推理 | CNY/百万tokens |
| glm-4.1v-thinking-flash | GLM-4.1V-Thinking-Flash | 免费视觉思考模型 | 64K（最大输出16K） | 免费 | 免费 | 视觉,推理 | CNY/百万tokens |
| glm-4v-flash | GLM-4V-Flash | 免费图像理解模型 | 4K | 免费 | 免费 | 视觉 | CNY/百万tokens |
| glm-4-long | GLM-4-Long | 超长文本与记忆型任务 | 1M（最大输出4K） | 1 | 1 | unknown | CNY/百万tokens |
| glm-4-flashx-250414 | GLM-4-FlashX-250414 | 高并发增强高速版 | 128K（最大输出16K） | 0.1 | 0.1 | 工具调用,推理 | CNY/百万tokens |
| glm-4-flash-250414 | GLM-4-Flash-250414 | 免费文本模型 | 128K（最大输出16K） | 免费 | 免费 | unknown | CNY/百万tokens |
| glm-ocr | GLM-OCR | 轻量高精图文文档解析 | 32K | 0.2 | 0.2 | 视觉 | CNY/百万tokens |
| codegeex-4 | CodeGeeX-4 | 代码补全与生成模型 | 128K（最大输出32K） | 0.1* | 0.1* | 代码 | CNY/百万tokens |

备注：
- 表中取**首档、非缓存命中**价。阶梯档（官网原文）：GLM-5.1 ≥32K 为 8/28；GLM-5-Turbo ≥32K 7/26；GLM-5 ≥32K 6/22；GLM-5V-Turbo ≥32K 7/26；GLM-4.7 输出≥0.2K 时 3/14、输入[32K,200K) 时 4/16；GLM-4.5-Air 输出≥0.2K 时 0.8/6、输入[32K,128K) 时 1.2/8；GLM-4.6V [32K,128K) 2/6；GLM-4.6V-FlashX [32K,128K) 0.3/3；GLM-4.5V [32K,64K) 4/12。
- 2026-10-04 重新读取官方 API 定价 Markdown，复核现有 23 个确切型号。GLM-5.3 / Flash / FlashX 命中价为 2 / 0.23 / 0.57；GLM-5.1 首档 1.3、长输入档 2；GLM-5-Turbo 和 GLM-5V-Turbo 首档 1.2、长输入档 1.8；GLM-4.7 三档分别 0.4 / 0.6 / 0.8。完整档位条件及价格保存于条目备注，主字段取标准首档。
- 缓存存储"限时免费"按百万 Token/小时计费，不能写成 5 分钟或 1 小时缓存写入价。官方标明“不支持缓存”的型号留空命中价，官方免费缓存才填 0。GLM-4.6 未出现在当前定价表，输入、输出、缓存全留空并显示待核实，不将未知输出误写成免费。
- `GLM-4.6`、`GLM-4.5-AirX` 的推理单价**未列入官网 API 定价表**（GLM-4.6 仅见私有实例"175 元/算力单元/天"）→ unknown。
- `*` CodeGeeX-4 官网价目只列**统一单价 0.1 元/百万tokens**，不区分输入/输出。
- GLM-4-Flash-250414 的"免费"来自模型概览"免费文本模型"标注。
- API id 按官网请求示例（`"model": "glm-5.3"`）的小写命名规则整理，`glm-5.3` 为文档原文核实。
- 官网还有 Embedding-2/3（0.5 元/百万tokens）、Rerank（0.8）、GLM-rerank-pro（0.8）、GLM-Image（0.1 元/次）、GLM-TTS（2 元/万字符）、GLM-ASR-2512（16 元/百万tokens）等非对话模型，本表未列。

---

## 4. Moonshot / Kimi（platform.kimi.com）

来源：https://platform.kimi.com/docs/pricing/chat.md（模型推理价格）、https://platform.kimi.com/docs/models.md（模型列表）

| 匹配ID模式 | 显示名 | 一句话中文简介 | 上下文长度 | 输入价格 | 输出价格 | 能力标签 | 价格币种与单位 |
|---|---|---|---|---|---|---|---|
| kimi-k3 | Kimi K3 | 原生视觉的深度推理旗舰 | 1,048,576（1M） | 20 | 100 | 视觉,工具调用,推理 | CNY/百万tokens |
| kimi-k2.7-code | Kimi K2.7 Code | 长上下文可靠编程模型 | 262,144（256K） | 6.5 | 27 | 代码,工具调用 | CNY/百万tokens |
| kimi-k2.7-code-highspeed | Kimi K2.7 Code Highspeed | 编程模型高速版 | 262,144（256K） | 13 | 54 | 代码,工具调用 | CNY/百万tokens |
| kimi-k2.6 | Kimi K2.6 | 视觉文本双模Agent模型 | 262,144（256K） | 6.5 | 27 | 视觉,工具调用,推理 | CNY/百万tokens |
| kimi-latest | Kimi Latest（已下线） | 2026-01-28下线的滚动版 | unknown | unknown | unknown | unknown | unknown |
| moonshot-v1-8k, moonshot-v1-32k, moonshot-v1-128k, moonshot-v1-auto, moonshot-v1-8k-vision-preview, moonshot-v1-32k-vision-preview, moonshot-v1-128k-vision-preview | Moonshot v1 系列（已下线） | 2026-08-31下线旧系列 | unknown | unknown | unknown | unknown | unknown |
| kimi-k2-0905-preview, kimi-k2-0711-preview, kimi-k2-turbo-preview, kimi-k2-thinking, kimi-k2-thinking-turbo, kimi-k2.5 | Kimi K2/K2.5 系列（已下线） | K2系2026-05-25起下线 | unknown | unknown | unknown | unknown | unknown |
| kimi-thinking-preview | Kimi Thinking Preview（已下线） | 2025-11-11下线 | unknown | unknown | unknown | unknown | unknown |

备注：
- 输入价取 **cache miss（非缓存命中）** 标准价；cache hit 价（kimi-k3 ¥2、k2.7-code ¥1.3 等）与缓存写入价（5 分钟/1 小时 TTL）未采用。官网注明"1M = 1,000,000"。
- 已下线模型官网不再标价（下线日期见简介列），官方迁移建议指向 `kimi-k3`；`kimi-k2.7-code-highspeed` 官网模型表未印上下文，取价目表 262,144。
- 能力：K3"原生支持视觉理解"、深度推理与工具调用（官方有 K3 工具调用最佳实践文档）；K2.6"支持视觉与文本输入、思考与非思考模式、对话与 Agent 任务"；K2.7 系为 Coding 模型。

---

## 5. 阿里百炼 通义千问（help.aliyun.com/zh/model-studio）

来源：https://help.aliyun.com/zh/model-studio/billing-for-model-studio（价目）、https://help.aliyun.com/zh/model-studio/text-generation-model（文本模型）、https://help.aliyun.com/zh/model-studio/vision-model（视觉模型）

| 匹配ID模式 | 显示名 | 一句话中文简介 | 上下文长度 | 输入价格 | 输出价格 | 能力标签 | 价格币种与单位 |
|---|---|---|---|---|---|---|---|
| qwen3.8-max, qwen3.8-max-0902 | 通义千问 Max 3.8 | 百炼旗舰通用模型 | 1M | 12 | 36 | 工具调用,推理 | CNY/百万tokens |
| qwen3.8-max-prime | 通义千问 Max 3.8 Prime | 旗舰高配增强版 | unknown | 24 | 72 | 工具调用,推理 | CNY/百万tokens |
| qwen3.7-plus, qwen3.7-plus-2026-05-26 | 通义千问 Plus 3.7 | 性价比通用均衡款 | 1M | 2 | 8 | 工具调用,推理 | CNY/百万tokens |
| qwen3.7-flash, qwen3.7-flash-2026-07-15 | 通义千问 Flash 3.7 | 轻量高性价比模型 | 1M | 0.2 | 0.8 | 工具调用,推理 | CNY/百万tokens |
| qwen3.8-flash | 通义千问 Flash 3.8 | 新一代轻量主力 | 1M | 0.8 | 2.7 | 工具调用,推理 | CNY/百万tokens |
| qwen3-max, qwen3-max-2026-01-23, qwen3-max-preview | 通义千问 Max 3 | 上代旗舰 | 256K | 2.5 | 10 | 工具调用,推理 | CNY/百万tokens |
| qwen-plus | 通义千问 Plus（旧） | 旧版通用模型 | 1M | 0.8 | 2 | 工具调用,推理 | CNY/百万tokens |
| qwen-max | 通义千问 Max（旧） | 旧版旗舰 | 32K | 2.4 | 9.6 | 工具调用 | CNY/百万tokens |
| qwen-flash | 通义千问 Flash（旧） | 旧版轻量模型 | 1M | 0.15 | 1.5 | 工具调用,推理 | CNY/百万tokens |
| qwen-turbo | 通义千问 Turbo | 旧版高速低价模型 | 128K | 0.3 | 0.6 | 工具调用,推理 | CNY/百万tokens |
| qwen-long, qwen-long-latest, qwen-long-2025-01-25 | 通义千问 Long | 超长文档理解总结 | 10M | 0.5 | 2 | 无 | CNY/百万tokens |
| qwen3-coder-plus, qwen3-coder-plus-2025-09-23, qwen3-coder-plus-2025-07-22 | Qwen3 Coder Plus | 长程代码智能体 | 1M | 4 | 16 | 代码,工具调用,推理 | CNY/百万tokens |
| qwen3-coder-flash, qwen3-coder-flash-2025-07-28 | Qwen3 Coder Flash | 轻量代码模型 | 1M | 1 | 4 | 代码,工具调用,推理 | CNY/百万tokens |
| qwen-coder-plus | Qwen Coder Plus（旧） | 旧版代码模型 | unknown | 3.5 | 7 | 代码 | CNY/百万tokens |
| qwen-coder-turbo | Qwen Coder Turbo（旧） | 旧版轻量代码模型 | unknown | 2 | 6 | 代码 | CNY/百万tokens |
| qwen3-vl-plus | Qwen3 VL Plus | 视觉理解，长视频支持 | unknown | 1 | 10 | 视觉,工具调用 | CNY/百万tokens |
| qwen3-vl-flash | Qwen3 VL Flash | 轻量视觉理解模型 | unknown | 0.15 | 1.5 | 视觉,工具调用 | CNY/百万tokens |
| qwen-vl-max | Qwen VL Max（旧） | 旧版视觉旗舰 | unknown | 1.6 | 4 | 视觉 | CNY/百万tokens |
| qwen-vl-plus | Qwen VL Plus（旧） | 旧版视觉模型 | unknown | 0.8 | 2 | 视觉 | CNY/百万tokens |
| qwen3.8-omni-flash | Qwen3.8 Omni Flash | 全模态实时理解生成 | unknown | 0.8 | 2.7 | 视觉,工具调用,推理 | CNY/百万tokens |
| qwen3-omni-flash | Qwen3 Omni Flash（旧） | 旧版全模态模型 | unknown | 1.8 | 6.9 | 视觉,推理 | CNY/百万tokens |
| qwen3.5-omni-plus | Qwen3.5 Omni Plus | 全模态离线语音强 | unknown | 7 | unknown | 视觉,推理 | CNY/百万tokens |

备注：
- 表中取**首档、非缓存**价。阶梯档（官网原文，输入/输出）：qwen3.7-plus >256K 为 6/24（且当前"限时 8 折"，表内为原价）；qwen3.7-flash 32K-256K 0.6/2.4、256K-1M 1.2/4.8；qwen3-max 32-128K 4/16、128-256K 7/28；qwen-plus 128K 以上 2.4/20、4.8/48；qwen-flash 128K 以上 0.6/6、1.2/12；qwen3-coder-plus 32-128K 6/24、128-256K 10/40、256K-1M 20/200；qwen3-coder-flash 32-128K 1.5/6、128-256K 2.5/10、256K-1M 5/25；qwen3-vl-plus 32-128K 1.5/15、128-256K 3/30；qwen3-vl-flash 32-128K 0.3/3、128-256K 0.6/6。
- qwen-plus、qwen-turbo 有"思考模式"输出价（qwen-plus 首档 8、qwen-turbo 3），表内取非思考标准输出价（2 / 0.6）。
- 缓存命中输入另有折扣价（如 qwen3.8-omni-flash 0.1 元、qwen3.8-max 按标准输入 10% 计），Batch 半价，两者不可叠加；表内均取标准输入价。
- qwen3-vl 系列与 qwen-coder-plus/turbo、omni 系列官网未印上下文 → unknown（qwen3-vl 价目输入档最高至 256K）。
- qwen3.5-omni-plus 按输入/输出**模态**分档（输入：文本 7、音频 53、图片/视频 40 元/百万tokens；输出含"文本+音频 213 元"等档），文本输出单价本次抓取存在歧义 → 输出写 unknown，以官网为准。
- 各模型免费额度普遍为 100 万 tokens（90 天内），未计入表。

---

## 6. 硅基流动 SiliconFlow（siliconflow.cn/pricing）

| 匹配ID模式 | 显示名 | 一句话中文简介 | 上下文长度 | 输入价格 | 输出价格 | 能力标签 | 价格币种与单位 |
|---|---|---|---|---|---|---|---|
| deepseek-ai/DeepSeek-V4-Flash | DeepSeek-V4-Flash | 分时计价的DeepSeek部署 | unknown | 3 | 9 | 工具调用,推理 | CNY/百万tokens |
| deepseek-ai/DeepSeek-V4-Pro | DeepSeek-V4-Pro | DeepSeek高配部署版 | unknown | 12 | 24 | 工具调用,推理 | CNY/百万tokens |
| deepseek-ai/DeepSeek-V3.2, Pro/deepseek-ai/DeepSeek-V3.2 | DeepSeek-V3.2 | 上代通用部署（含Pro） | unknown | 4 | 6 | 工具调用,推理 | CNY/百万tokens |
| deepseek-ai/DeepSeek-V3.1-Terminus, Pro/deepseek-ai/DeepSeek-V3.1-Terminus | DeepSeek-V3.1-Terminus | V3.1终版部署 | unknown | 4 | 12 | 工具调用,推理 | CNY/百万tokens |
| Qwen/Qwen3.8-27B | Qwen3.8-27B | 开源通用部署 | unknown | 3 | 12 | 工具调用,推理 | CNY/百万tokens |
| Qwen/Qwen3.6-35B-A3B | Qwen3.6-35B-A3B | MoE轻量部署 | unknown | 1.8 | 10.8 | 工具调用,推理 | CNY/百万tokens |
| Qwen/Qwen3.6-27B | Qwen3.6-27B | 开源通用部署 | unknown | 3 | 18 | 工具调用,推理 | CNY/百万tokens |
| Qwen/Qwen3.5-122B-A10B | Qwen3.5-122B-A10B | 大杯MoE部署 | unknown | 0.8 | 6.4 | 工具调用,推理 | CNY/百万tokens |
| Qwen/Qwen3.5-35B-A3B | Qwen3.5-35B-A3B | 中杯MoE部署 | unknown | 0.4 | 3.2 | 工具调用,推理 | CNY/百万tokens |
| Qwen/Qwen3.5-27B | Qwen3.5-27B | 密集小模型部署 | unknown | 0.6 | 4.8 | 工具调用,推理 | CNY/百万tokens |
| zai-org/GLM-5.3 | GLM-5.3 | 智谱旗舰部署版 | unknown | 8 | 28 | 工具调用,推理,代码 | CNY/百万tokens |
| zai-org/GLM-5.2 | GLM-5.2 | 智谱次旗舰部署 | unknown | 8 | 28 | 工具调用,推理,代码 | CNY/百万tokens |
| Pro/zai-org/GLM-5.1 | GLM-5.1 (Pro) | 加速通道部署版 | unknown | 6 | 24 | 工具调用,推理,代码 | CNY/百万tokens |
| zai-org/GLM-4.5V | GLM-4.5V | 视觉模型部署版 | unknown | 1 | 6 | 视觉,推理 | CNY/百万tokens |
| zai-org/GLM-4.5-Air | GLM-4.5-Air | 轻量部署版 | unknown | 1 | 6 | 工具调用,推理 | CNY/百万tokens |
| THUDM/GLM-4-32B-0414 | GLM-4-32B-0414 | 开源32B部署 | unknown | 1.89 | 1.89 | 工具调用 | CNY/百万tokens |
| moonshotai/Kimi-K2.7-Code | Kimi-K2.7-Code | Kimi编程模型部署版 | unknown | 6.5 | 27 | 代码,工具调用 | CNY/百万tokens |
| Pro/moonshotai/Kimi-K2.6 | Kimi-K2.6 (Pro) | Kimi部署加速版 | unknown | 6.5 | 27 | 视觉,工具调用,推理 | CNY/百万tokens |

备注：
- 来源：https://siliconflow.cn/pricing（单位为该页"输入/输出价格（M Tokens）"）。`Pro/` 前缀为平台**加速通道**，与基础 ID 同价，匹配时应剥离。
- DeepSeek-V4-Flash 为**分时计价**：闲时（2:00-8:00）1.5/4.5；表中取标准时段（0-2 点、8-24 点）3/9。
- 输入档阶梯（未采用高价档）：GLM-5.1 ≥32K 为 8/28；Qwen3.5-122B ≥128K 为 2/16；Qwen3.5-35B ≥128K 为 1.6/12.8；Qwen3.5-27B ≥128K 为 1.8/14.4。
- 缓存命中价（如 DeepSeek-V4-Flash 0.3、GLM-5.3 2、Kimi-K2.7-Code 1.3）未采用。
- **官网定价页未标注上下文长度** → 全部 unknown。页面另有"展开更多"隐藏型号（DeepSeek 6 个、Qwen 30 余个等）未逐一收录。

---

## 7. OpenAI（openai.com 官方发布页）

来源：https://openai.com/index/gpt-6-astra/ 、https://openai.com/index/gpt-5-6/ 、https://openai.com/index/introducing-gpt-5-5/ 、https://openai.com/index/introducing-gpt-5-4/（platform.openai.com/docs 从本网络返回 403，价格取自官网发布页原文）

| 匹配ID模式 | 显示名 | 一句话中文简介 | 上下文长度 | 输入价格 | 输出价格 | 能力标签 | 价格币种与单位 |
|---|---|---|---|---|---|---|---|
| gpt-6-astra | GPT-6 Astra | 计算机操作与编程新旗舰 | unknown | 10 | 50 | 工具调用,推理,代码 | USD/百万tokens |
| gpt-5.6-sol | GPT-5.6 Sol | 5.6代旗舰档 | unknown | 5 | 30 | 工具调用,推理,代码 | USD/百万tokens |
| gpt-5.6-terra | GPT-5.6 Terra | 5.6代均衡档 | unknown | 2.5 | 15 | 工具调用,推理,代码 | USD/百万tokens |
| gpt-5.6-luna | GPT-5.6 Luna | 5.6代极速低价档 | unknown | 1 | 6 | 工具调用,推理,代码 | USD/百万tokens |
| gpt-5.5 | GPT-5.5 | 长程智能体旗舰 | 1M | 5 | 30 | 推理,工具调用,代码 | USD/百万tokens |
| gpt-5.5-pro | GPT-5.5 Pro | 高精度增强版 | unknown | 30 | 180 | 推理,工具调用 | USD/百万tokens |
| gpt-5.4 | GPT-5.4 | 原生计算机操作模型 | 272K（实验1M） | 2.5 | 15 | 视觉,推理,工具调用,代码 | USD/百万tokens |
| gpt-5.4-pro | GPT-5.4 Pro | 5.4最高精度版 | unknown | 30 | 180 | 推理,工具调用 | USD/百万tokens |
| gpt-5.2 | GPT-5.2 | 上代推理模型 | unknown | 1.75 | 14 | 推理,工具调用 | USD/百万tokens |
| gpt-5.2-pro | GPT-5.2 Pro | 上代高精度版 | unknown | 21 | 168 | 推理 | USD/百万tokens |
| gpt-5.3-codex | GPT-5.3 Codex | 前代编码专用模型 | unknown | unknown | unknown | 代码 | unknown |
| gpt-4.1, gpt-4.1-mini, gpt-4.1-nano | GPT-4.1 系列（旧） | 旧版通用模型 | unknown | unknown | unknown | unknown | unknown |
| gpt-4o, gpt-4o-mini | GPT-4o 系列（旧） | 旧版多模态模型 | unknown | unknown | unknown | unknown | unknown |
| o1, o3, o3-mini, o4-mini | o 系列（旧） | 旧版推理模型 | unknown | unknown | unknown | 推理 | unknown |

备注：
- 价格均为官网原文：GPT-6 Astra "Standard pricing is $10 per million input tokens and $50 per million output tokens"；GPT-5.6 "Sol is $5 input / $30 output; Terra is $2.50 input / $15 output; and Luna is $1 input / $6 output"；GPT-5.5 页价目：gpt-5.5 "$5 per 1M input / $30 per 1M output"、gpt-5.5-pro "$30 / $180"；GPT-5.4 页 API 价目表：gpt-5.2 "$1.75 / $14"、gpt-5.4 "$2.50 / $15"、gpt-5.2-pro "$21 / $168"、gpt-5.4-pro "$30 / $180"。
- 缓存输入价未采用（gpt-5.2/5.4 为 $0.175/$0.25，即标准输入 10%）；gpt-5.6 及以后 cache write 按 1.25x 未缓存输入价、cache read 享 90% 折扣（官网原文）。
- 其他档位：Batch/Flex 半价；Priority processing 2x-2.5x；GPT-6 Astra Fast mode 2x 价 2x 速；gpt-5.6-sol 自 2026-08-21 起 3 个月内 API 价格下调 20%+（限时）。
- `gpt-5.6-terra`、`gpt-5.6-luna` 的 API id **官网正文未逐字印出**（仅印出 `gpt-5.6-sol` 与 `gpt-6-astra`、`gpt-5.5`、`gpt-5.5-pro`、`gpt-5.4`、`gpt-5.4-pro`），按同族命名推断，匹配时建议模糊处理。
- 上下文：GPT-5.5 为 1M（原文）；GPT-5.4 标准 272K、Codex 实验支持 1M（原文）；其余官网正文未印 → unknown。
- gpt-4.1 / gpt-4o / o 系列 / gpt-5.3-codex 在 2026-09 的官网现行价目已不再列出，价格与上下文 unknown，仅收作历史 ID 匹配用。

---

## 8. Anthropic（claude.com/pricing、anthropic.com/claude/* 产品页）

来源：https://claude.com/pricing（API 价目）、https://www.anthropic.com/claude/fable|opus|sonnet|haiku（产品页含 API id 原文）。注：platform.claude.com 文档站对本核实网络区域受限（307 → app-unavailable-in-region）。

| 匹配ID模式 | 显示名 | 一句话中文简介 | 上下文长度 | 输入价格 | 输出价格 | 能力标签 | 价格币种与单位 |
|---|---|---|---|---|---|---|---|
| claude-fable-5-1 | Claude Fable 5.1 | 长程智能体新旗舰 | unknown | 10 | 50 | 视觉,工具调用,推理,代码 | USD/百万tokens |
| claude-opus-5 | Claude Opus 5 | 企业级智能体编码旗舰 | unknown | 5 | 25 | 视觉,工具调用,推理,代码 | USD/百万tokens |
| claude-sonnet-5 | Claude Sonnet 5 | 高性能编码智能体均衡款 | unknown | 2 | 10 | 视觉,工具调用,推理,代码 | USD/百万tokens |
| claude-haiku-4-5 | Claude Haiku 4.5 | 最快最省的轻量模型 | unknown | 1 | 5 | 视觉,工具调用,推理,代码 | USD/百万tokens |
| claude-fable-5 | Claude Fable 5 | 上代旗舰 | unknown | 10 | 50 | 视觉,工具调用,推理,代码 | USD/百万tokens |
| claude-opus-4-8 | Claude Opus 4.8 | 1M上下文推理编码模型 | 1M | 5 | 25 | 视觉,工具调用,推理,代码 | USD/百万tokens |
| claude-opus-4-7 | Claude Opus 4.7 | 上代Opus | unknown | 5 | 25 | 视觉,工具调用,推理,代码 | USD/百万tokens |
| claude-opus-4-6 | Claude Opus 4.6 | 上代Opus | unknown | 5 | 25 | 视觉,工具调用,推理,代码 | USD/百万tokens |
| claude-opus-4-5, claude-opus-4-5-20251101 | Claude Opus 4.5 | 旧版Opus（含日期版） | unknown | 5 | 25 | 视觉,工具调用,推理,代码 | USD/百万tokens |
| claude-sonnet-4-6 | Claude Sonnet 4.6 | 实时智能体高吞吐款 | 1M（beta） | 3 | 15 | 视觉,工具调用,推理,代码 | USD/百万tokens |
| claude-sonnet-4-5 | Claude Sonnet 4.5 | 旧版Sonnet | unknown | 3 | 15 | 视觉,工具调用,推理,代码 | USD/百万tokens |

备注：
- 价格为 claude.com/pricing API 价目原文（非缓存标准输入/输出，USD per MTok）。缓存分档（5 分钟 TTL 写入/命中价）未采用；Fable 5.1 官方另称 "Cache reads now cost $0.25 per million tokens"。
- 其他档位：US-only 推理 1.1x（输入输出）；Opus 5 fast mode 2x 价格 2x 速度；Batch processing 5 折。
- API id 均为产品页原文（"use claude-fable-5-1 / claude-opus-5 / claude-sonnet-5 / claude-haiku-4-5 via the Claude API"）；`claude-opus-4-5-20251101` 为页面原文出现的**带日期后缀** id 实例。
- 上下文：官网标注 Sonnet 4.6 与 Opus 4.8 为 "1M token context window（beta）"；其余型号在可达官网页面未印 → unknown。
- 能力：产品页描述为 hybrid reasoning（推理）、tool use/agent（工具调用）、advanced coding（代码）、vision/PDF/multimodal 输入（视觉，家族级描述）。

---

## 9. Google Gemini（deepmind.google 等可达官方页）

⚠ **重要**：Gemini API 官方定价页（https://ai.google.dev/gemini-api/docs/pricing）与 cloud.google.com、aistudio.google.com 从本次核实网络**均连接超时不可达**，developers.google.cn 无现行 Gemini API 文档（旧版 1.0/1.5 内容）。故**全部价格与上下文为 unknown**，仅收录 deepmind.google 官方页可核实的型号/ID。

来源：https://deepmind.google/models/（含跳转 Google AI Studio 的官方 model 参数）

| 匹配ID模式 | 显示名 | 一句话中文简介 | 上下文长度 | 输入价格 | 输出价格 | 能力标签 | 价格币种与单位 |
|---|---|---|---|---|---|---|---|
| gemini-3.8-flash | Gemini 3.8 Flash | 大规模智能体任务主力 | unknown | unknown | unknown | 视觉,工具调用,推理 | unknown |
| gemini-3.1-flash-lite, gemini-3.1-flash-lite-image | Gemini 3.1 Flash Lite | 轻量款（含图像版） | unknown | unknown | unknown | 视觉,推理 | unknown |
| gemini-omni-1.1-flash | Gemini Omni 1.1 Flash | 视频创作为主的全模态 | unknown | unknown | unknown | 视觉,推理 | unknown |
| gemini-robotics-er-2-preview | Gemini Robotics（ER 2） | 机器人具身智能 | unknown | unknown | unknown | 视觉,推理,工具调用 | unknown |
| gemini-embedding | Gemini Embedding | 多模态向量模型 | unknown | unknown | unknown | 视觉 | unknown |
| gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite | Gemini 2.5 系列（未核实） | 旧款，官网本次不可达 | unknown | unknown | unknown | unknown | unknown |
| gemini-3-pro, gemini-3-flash | Gemini 3 系列（未核实） | 除3.8外未能核实 | unknown | unknown | unknown | unknown | unknown |

备注：
- ID 来源：deepmind.google/models/ 页面跳转 Google AI Studio 的官方链接参数（`model=gemini-3.8-flash`、`model=gemini-3.1-flash-lite-image`、`model=gemini-omni-1.1-flash`、`model=gemini-robotics-er-2-preview`、`model=gemma-4-31b-it`）。
- 官方页一句话定位（原文英译）："Gemini 3.8 Flash—Best for tackling complex agentic tasks at scale"、"Gemini Omni 1.1 Flash—Greater creative control and production-ready outputs"、"Gemini Embedding—State-of-the-art multimodal embedding model"；另有 Gemini Audio、Nano Banana 2 Lite（Gemini Image）、Gemma 4 等。
- 最后两行（2.5 / 3 系列）为**占位行**：ID 按常见形式收录用于命中提示，官网本次不可达未核实，字段一律 unknown。
- 待网络可达 ai.google.dev 定价页后应优先补齐本节价格与上下文。

---

## 10. 匹配规则说明

> **过时隐藏（hidden 字段）**：资料库条目可标 `"hidden": true`，命中的模型**不进模型库列表**（本地覆盖里编辑过的条目除外）。
> 隐藏判定用「归一化后相等、或以 `-` 为词边界互为前缀」，**不做模糊打分**——否则 `gpt-5` 这种键会误伤 `gpt-5.5`、`gpt-5.6` 等在售新版本；
> 但若可见条目里有**同归一化名的精确条目**，精确条目优先、不隐藏（所以 `mimo-v2.5` 键带不走现役的 `mimo-v2.5-asr`/`-tts`，
> 而只与可见条目模糊擦边的 `kimi-latest` 仍会被隐藏）。
> 目前标记为 hidden 的：DeepSeek V3/R1 系列（含 `deepseek-chat`/`deepseek-reasoner` 历史别名）、智谱 GLM-4 系列与免费档旧名、
> OpenAI GPT-4o/4.1/GPT-5/o 系列条目、小米 `mimo-v2.5`/`mimo-v2.5-pro` 对话档（2026-10-21 停用，语音档不受影响），
> 以及一条汇总「已下线/过时模型历史 ID」的条目（kimi-latest、moonshot-v1-*、kimi-k2.5 系、
> deepseek-v1/v2、glm-3、qwen2*、gpt-3.5/gpt-4、claude-1~3、gemini-1.x/2.x 等，依据见上文各节备注）。
> 注意带点号的新版本号不会被 `-` 边界前缀命中（`deepseek-v3.2`、`glm-4.7-flash`、`gpt-5.5` 都会正常显示）；
> 现役条目优先于隐藏键：`glm-4.6`、`glm-4.5-air`、`glm-4-flash-250414` 虽然也在隐藏键里，
> 但第 3 节价目表已补了带价格（或已知无价）的现役条目，精确兜底让它们照常显示。
> 想恢复某条，删掉该条目的 `hidden` 字段即可。

API 实际返回的 model id 与官网"标准名"常有变体，建议按下述顺序做**逐级归一化 + 模糊匹配**：

1. **精确匹配**：先按完整 id 精确命中（含大小写原样），命中即返回。
2. **大小写与分隔符归一**：统一转小写，`.`/`_`/`-` 视作等价分隔符（`GLM-4.5` ≈ `glm-4.5`；`Qwen3.8-Max` ≈ `qwen3.8-max`；`DeepSeek-V3.2` ≈ `deepseek-v3.2`）。
3. **剥离日期/快照后缀**：
   - `-YYYY-MM-DD`（如 `qwen3.7-plus-2026-05-26`、`claude-opus-4-5-20251101`）；
   - `-YYMMDD` / `-MMDD`（如 `glm-4-flash-250414`、`qwen3.8-max-0902`、`kimi-k2-0905-preview`）；
   - `-latest`、`-preview`、`-exp`、`-terminus` 等滚动/实验后缀（`qwen-long-latest`、`deepseek-v4-flash-vision-exp`）。
   剥离后回退匹配基名（`qwen3.7-plus-2026-05-26` → `qwen3.7-plus`）；注意**基名匹配失败时保留后缀原样再试**，避免误并不同快照。
4. **剥离组织/渠道前缀**（聚合网关常见）：
   - 开源组织前缀：`deepseek-ai/DeepSeek-V3.2`、`Qwen/Qwen3.5-27B`、`THUDM/GLM-4-32B-0414`、`zai-org/GLM-5.3`、`moonshotai/Kimi-K2.6` → 取 `/` 后段匹配；
   - 渠道/加速前缀：硅基流动 `Pro/xxx`、one-api/new-api 风格 `openai/gpt-5.4`、`azure/xxx`、百炼市场 `kimi/kimi-k3` → 逐段试剥前缀；
   - 剥离后大小写不敏感匹配。
5. **剥离运行时/量化/形态后缀**：
   - 免费通道 `:free` / `-free`（`qwen-turbo:free`）；
   - Ollama/LM Studio 形态 `:extended`、`:latest`、`:q4_K_M`、`:fp16`（冒号后整体视为修饰符）；
   - 微调形态 `-instruct` / `-chat` / `-it` / `-bf16`（`Qwen3-8B-Instruct` → `qwen3-8b`）。
6. **历史别名映射表**（已按官网核实，可作为内置静态映射）：
   - `deepseek-chat` / `deepseek-reasoner` → DeepSeek 历史 ID（官网已下线）；`deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` → 按 V4.1-Flash 服务与计费；`deepseek-v4-pro` 暂按 V4.1-Flash 计费；
   - `kimi-latest`、`moonshot-v1-*`、`kimi-k2*`、`kimi-thinking-preview` → 已下线，建议映射 `kimi-k3` 卡片并标注"已下线"；
   - `qwen-max` / `qwen-plus` / `qwen-turbo` / `qwen-flash` 为仍在售的旧名（有独立价格），**不要**合并到 qwen3.x 卡片；`qwen3-max-*` 各快照并入 `qwen3-max`。
7. **模糊兜底**：以上全未命中时，取"家族名 + 主版本号"做前缀/包含匹配（`glm-4.5*`、`qwen3-vl-*`、`claude-sonnet-4-*`、`gemini-3*`、`deepseek-v3*`），命中家族卡片并把简介标为"同系列"；再不行按平台兜底到"未知模型"卡片。
8. **多 ID 归一到一张卡**：同卡多 ID 时（如 `deepseek-flash` 与两个 legacy id），展示用"显示名"，匹配列表放本表"匹配ID模式"列全部条目；建议再挂"历史 ID"标签区分已下线别名。

> 本文件按 2026-09-22 官网现状整理；模型迭代快，价格/上下文复核时请以各节"来源"链接为准，官网缺失字段继续保持 `unknown`，不要补录推算值。

## 2026-10-03 天梯价格台账

新增精选天梯与本次原厂价格来源见 [1.0.0100 发布记录](release-1.0.0100.md)。排名与价格独立，GLM-5.3、Kimi K3 本次未能从当前官方页确认，天梯显示待核实，不沿用未经刷新确认的历史价格。

## 2026-10-04 缓存价格补充

标准未命中输入仍是默认比价口径；缓存命中、5 分钟缓存写入、1 小时缓存写入分别存储，不再丢弃缓存字段。已补核实天梯中 OpenAI、Anthropic、Gemini、小米 MiMo 与 DeepSeek 的缓存价，来源与日期写入 `ladder.json`；未知字段留空，不能把按小时收取的缓存存储费写成每百万 Token 的缓存写入价。其他资料条目的历史备注仅代表当时取数状态，不表示本次已经核实所有旧模型。

## 2026-10-04 GLM 缓存价格复核

已读取官方 API 定价文档 https://docs.bigmodel.cn/cn/guide/start/pricing ：GLM-5.3 / Flash / FlashX 缓存命中分别为 2 / 0.23 / 0.57 元每百万 Token。其余文本与视觉型号按官方表标准首档补齐，缓存存储按小时计费且限时免费，不写入缓存写入字段。此前 GLM 天梯待核实备注为历史状态，本次已核实型号更新来源及日期；变体评测档位不自动套用基础型号价格。
