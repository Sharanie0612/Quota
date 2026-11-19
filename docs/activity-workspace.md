# 多软件用量工作区

展示版本、包版本均为 `1.0.4200`。功能分支 `codex/feat/activity-source-workspace` 基于 ZCode 去重修复 `f13b21a`，安装升级以 `1.0.4101` 为基线。

## 记录的维度

| 维度 | 示例 | 规则 |
| --- | --- | --- |
| 软件 | Claude Code、Codex、Gemini CLI、Cursor、Harness、ZCode、Kimi Code、Qoder、Trae、WorkBuddy | 与模型厂商分开，不因第三方模型而改写软件名称。 |
| 调度入口 | Multica、直接使用、历史未标记 | Multica 下继续区分实际软件。复制原日志不增加第二笔 Token。 |
| 模型 | 原始型号及型号所属厂商 | 没有历史型号时保留未知，不套用软件默认或当前配置。 |
| 接入 | 平台内置、自带 API、未标记 | Trae / WorkBuddy 使用别家模型不等于 BYOK；需明确记录或用户配置。 |
| 环境 | 本机、SSH、WSL、虚拟机挂载目录 | 独立设备标识；选中后才连接，取消纳入保留原始记录。 |

统一沿用 `activity.sqlite`，扩展可选 `origin` 元数据，不重建账本或改写旧事件 ID。原 `source`、`multica`、`channel` 和旧设置继续读取。新增软件走 `quota-activity-v2`，旧软件继续走 v1，避免旧客户端遇到未知来源而拒绝整包。全部软件的事件 ID 仍在同一主键空间去重。

首次历史重读前用 SQLite 一致备份保存原统计库，修正及拦截记录只保存事件标识、规则、时间和数值。已证实的 ZCode 分叉与跨格式别名采用零用量修订；旧同步回放不能恢复错误值。可重读的 Codex 续聊按原修复规则重算；找不到原日志的旧记录保留待复核。正常流式结算更新不当作历史错误。

另有一类 Quota → ZCode → Quota 的历史回填循环：仅当 ZCode 的 `logical_request_id=quota:<原事件ID>` 与存储 ID `usage_quota_<同一ID>` 同时匹配，且原始用量确实存在时，才把回流事件记为零用量别名。原始记录继续保留，并与修订一起发布；沿用旧版已识别的 ZCode 修订号 2。原记录缺失时不新增衍生用量，已经存在的唯一观察继续保留，显示待核对。后续同步恢复原记录后，即使时间游标已越过该行也会自动核对；相似的时间和数值不能单独作为删除依据。

相同原日志被复制到不同设备时，只保留一笔，确定性归属 UUID 较小的设备。这个规则保证各设备小计一致，不能证明原始执行机器；原环境标记与最终设备不一致时，环境类型保留未知。

## 页面与设置

软件、环境和模型直接可选；更多筛选包含入口、接入和厂商。所选条件独立移除，重新进入时恢复；晚到的请求不能覆盖当前条件。型号筛选跨软件匹配同一原始型号，旧接口仍保留原有 Trae 通道键的语义。曲线、概览、环图和新增来源明细共用同一筛选结果，框选日期继续作用于明细。

设置分为外观与窗口、采集来源、同步与备份、提醒与更新、关于与安全。采集仅有一个编辑入口，旧 IPC 和 `activity-settings.json` 继续兼容。额外软件位置可以分别标记接入与入口；修改标记后重读同一日志，只更新归属元数据，原事件 ID 和 Token 不增加。没有实际读取依据时，状态只显示已配置。上次采集的失败详情保留在来源页。

环境取消纳入后，同时退出 Token 活动、我的使用、实际单价分母和悬浮窗；指标及同步记录保留。软件关闭只停止后续采集，不隐藏历史。新识别的 SSH / WSL 和同步而来的虚拟环境默认未纳入，选择只对本机有效。来自同步的环境可以先选择历史，连接须在本机重新识别。同机不同别名保持原选择；旧 SSH 的 Codex 开关与环境纳入分开，重新纳入继续原采集行为。

平台内置、接入未知的第三方软件用量不会自动并入模型厂商账单的单价分母。明确自带 API 才纳入相应厂商；原生软件自身厂商的历史兼容口径保留。活动原始记录仍完整可见。没有缓存细分的导出，其输入不被当作未命中输入，缓存命中率与缓存曲线仅使用已知细分的记录。

## 采集能力

| 软件 | 当前路径 | 边界 |
| --- | --- | --- |
| Codex | 本机、Multica、SSH、WSL、额外目录 | 复用增量和续聊校正规则，保留原事件 ID。 |
| Claude Code | `~/.claude/projects` 的助手 JSONL | 同一消息多份快照不相加；后来的空占位不能擦掉已知用量。 |
| Gemini CLI | `~/.gemini/tmp` 的会话 JSON / JSONL | 迁移、重写和 rewind 不增加第二笔用量。 |
| Kimi Code | `~/.kimi/sessions/**/wire.jsonl` | 读取逐步 Token，缺少历史型号时保留未知。 |
| Cursor | 完整 Token 明细 CSV | 无费用估算；缺请求 ID 时保留同样行的出现次数并跨重叠导出去重，无法保证缺标识导出间的所有歧义均可消除。 |
| DeepSeek Harness | 原 v0–v4 原始 / Zstandard 会话 | 本机或挂载位置；当前 SSH / WSL 通用投影未接入其专用格式。 |
| ZCode | 原只读 SQLite 两库 | 支持额外挂载目录，分叉及现代/旧记录交叉去重。 |
| Trae | 原显式本机连接 | 原始提供 / API 通道保留，数据库只在内存解密。 |
| Qoder | Transcript JSONL | 只有完整消息用量才计 Token；只含对话、工具的版本显示字段不可用。 |
| WorkBuddy | 用户选择自己的兼容助手用量 JSONL | 尚未验证 WorkBuddy 原生持久化格式，不自动借用 CodeBuddy 身份或伪造可采集状态。 |
| CodeBuddy | 兼容助手用量 JSONL | 会话累计结果不重复相加；未覆盖的原生流格式显示不可用。 |

SSH / WSL 通用投影支持 Codex、Claude、Gemini、Kimi、Qoder、CodeBuddy 的上述日志格式。每轮至多 4,000 个投影记录，游标分批续读；整份 JSON 快照超过消息上限时提示不支持，不截断后冒充完整数据。尚无本机客户端或远端实例可做真实验证的项目，以合成官方格式回归为依据。

## 格式依据与边界

- [Gemini 记录类型](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts)：支持历史 JSON 与追加 JSONL；只读取消息标识、时间、型号、Token 和工具名。推理并入输出，工具提示 Token 并入输入，核对原始总量。
- [Kimi wire 类型](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/wire/types.py)、[持久化格式](https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/wire/file.py)：读取步骤/尝试和 `StatusUpdate.token_usage`。上下文占比不是用量；未记录的历史型号保持未知。
- [Qoder Transcript](https://docs.qoder.com/extensions/hooks)：部分版本只有工具和消息信息，不保证 Token。仅采纳具有明确原消息 ID 与完整用量字段的记录，缺失时显示字段不可用。
- [CodeBuddy 用量流](https://www.codebuddy.ai/docs/cli/stream-json-turn-usage)：会话累计、阶段和终态不能重复相加。当前读取原始助手消息用量；不把累计 `result.usage` 再加一遍。WorkBuddy 不自动借用 CodeBuddy 的历史身份，需选择自己的用量文件。
- Cursor CSV 只采纳完整 Token 数及带时区的时间，不用费用、Credits 或文本量推算。缺少请求 ID 时按时间、型号、用量和重复次数保守去重，不保存导出中的邮件地址。字段与输入子项须对账；[官方用量事件结构](https://cursor.com/docs/account/teams/admin-api)也将输入、输出、缓存分开。CSV 并非所有账户版本都保证提供这些字段。
- Claude 兼容助手记录中，非缓存输入、缓存读和缓存写互斥，三者组成输入总量。工具参数及正文始终不写入统计库。

源文件不存在、格式不支持、字段不可用、连接失败与已记录的零用量分别处理。远程只执行固定白名单投影，使用现有 SSH 凭据和主机信任；不上传脚本文件，不返回文本或认证字段。

新增本机文件为 `activity-sources.json`、`activity-source-status.json`、`activity-migration.json` 和 `activity-backups/`；修复记录在原 SQLite 中的 `activity_repairs` 表，回填别名关联和待核对状态保存在 `activity_feedback_aliases`。配置、路径、连接信息与备份不走用量同步，普通数据导出继续排除源路径。初始设备身份在第一次导入或打开采集工作区时保存；设置损坏或既有来源配置缺少配套设置时，保留原文件并报错，不能用随机新身份覆盖。原始对话、工具参数和凭据不进入指标、修复表或传输包。

## 验收

验证使用 Node 24、Windows GNU 工具链和 Python 3.11。`cargo test` 仍不作为本机验收手段。

- `npm run typecheck`、`npm run build`、`npm run verify`：通过。
- `npm run verify:ui`：9 组现有 / 新增检查通过，涵盖 10 组主题与明暗组合、6 页面、1024 / 1360px、筛选交集、迟到请求、设置持久化、Multica、环境不纳入、原图表和悬浮窗。
- `cargo check --locked --offline --examples`：通过，仅既有 `get_api_key` 未使用警告。
- `activity_source_checks`：合成 Claude / Gemini / Kimi / Cursor / Qoder / WorkBuddy、隐私、分批远程投影、v1 / v2 同步、来源重标记、坏设置保护及一致备份。
- 既有活动、Codex 续聊、Multica、Harness、同步压缩、费用、汇率、账务同步、悬浮窗、输出速度回归：通过；旧示例显式关闭无关的新客户端，避免开发机安装软件影响测试。SSH 新增验证同步来的环境默认未选择，选择后才计入。
- 隔离统计快照重放验证了 ZCode 重复修正、回填拦截及独立历史请求补读。再次重放时总量稳定。源数据库只读，缺少新解析标记且无法核对的旧 Codex 记录继续保留。具体用量和修复明细保存在本机验收记录中。

最终 NSIS 候选已构建，安装包 SHA-256 为 `13f8596fe3fe3150a8b7bf84ec7bf700f46203b3540f777b1fdf2d9a39b2bc85`。解包的 `WebView2Loader.dll` 与源文件 SHA-256 一致，最终打包 WebView 校验 30 个型号、输出速度及活动布局通过。

工作区实际安装 1.0.4101，启动 8 秒后建立旧版数据基线，再覆盖升级到 1.0.4200 并启动 8 秒：通过；合成配置、采集设置、费用数据及无关标记文件保留。升级脚本先运行旧版再取基线，避免将旧版首次启动的正常格式归一化当成升级破坏。

升级测试使用独立安装和配置目录。测试后核对了日常安装的登记、程序及数据文件，并恢复原程序运行。验收记录为 `target/activity-package/acceptance.json`，历史重放记录为 `target/token-audit/replay-evidence.json`。

真实 SSH / WSL 连接及未安装客户端未实测，合成投影不等同真实连接通过。WorkBuddy 目前只接收自身兼容用量文件，尚不宣称已支持其未验证的原生数据库格式；Qoder 需原日志包含完整 Token 字段。
