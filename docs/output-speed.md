# 输出速度

页面记录当前 Codex 模型的客户端观测输出速度，支持时间、模型与设备筛选。记录沿用 Token 活动的采集周期、资料库、事件身份、压缩目录同步与导入导出；没有另建一套用量账本。

## 计算

```text
非推理输出用量 = usage.output_tokens − usage.reasoning_output_tokens
输出速度 = 非推理输出用量 × 1000 / 输出片段总时长毫秒
```

从 Codex JSONL 的 `token_usage_record` 读取逐次用量，与同一次响应的 `AgentMessage` 起止时间关联。重叠输出片段按区间并集合并。输出计时与对应增量不一致、缺少计时、工具调用响应、思考时间和等待时间不产生速度样本。至少 64 个非推理输出 Token 和 500 毫秒输出时长才作为有效样本，减少短输出与缓冲突发的噪声。

这是客户端观测值，包含接收链路的影响，不能当作服务端引擎的纯解码速度。输出 Token 使用日志报告的计数，可能包括协议格式 Token；不以字符数估算，不重新分词。依据 [OpenAI 输出用量口径](https://developers.openai.com/api/docs/guides/token-counting) 和本机实际事件结构核对；[Codex 观测文档](https://learn.chatgpt.com/docs/config-file/config-advanced#observability-and-telemetry) 将模型事件、工具事件与整轮耗时分开描述。

今天按 5 分钟、其他范围按小时和模型汇总，以该桶输出 Token 总数除以总输出时长，避免将快慢响应的比率直接平均。概览平均值使用同一加权口径；中位数与 P95 按有效响应计算。没有记录的时段留空，长时间空档不连线。

## 保存、回填与同步

`Metric.speed` 是原 Token 事件中的可选字段，只含响应摘要标识、输出片段起止、时长、Token 数量与方法版本。游标只保留必要计时状态，不保存消息、工具参数或凭据。

首次升级重读已有 Codex 日志以补充速度元数据；既有 Token ID 保持不变，去重后补充元数据。日志已被删除或没有计时的历史不补造速度。旧客户端不能展示速度，旧包重放不会抹除新版已保留的速度样本。

SSH 采集仍只在远端读取字段白名单，新增传输的是角色、计时与用量元数据，不传文本内容、不在远端创建文件。未纳入统计的 SSH 设备不会贡献速度记录；设备筛选只限定当前视图。其他 harness 后续通过相同的版本化测量字段接入，当前界面只开放 Codex。

## 验证

`output_speed_checks` 覆盖加权速度、推理/工具排除、缺少计时、升级回填、旧包重放、两份隔离资料库去重同步、排除设备和隐私字段。可指定 Codex 日志目录，读取真实日志到新建的隔离测试资料库：

```text
cargo run --release --example output_speed_checks
cargo run --release --example output_speed_checks -- <Codex日志目录>
```

真实双机与真实 SSH 传输需另行实测；本地双资料库和合成 SSH 回归不能代替目标设备验证。
