# 官方定价解析回归样本

2026-10-04 至 2026-10-05 抓取的官方公开页面片段，仅供解析回归验证；不是运行时价格数据库。HTML 片段保留原表头、标准/地域条件与完整表格，删除其他页面导航；阿里云保留 ICE 文档内容封装，小米保存当前官方静态文档块解码后的 HTML。

运行 `cargo run --release --example official_price_checks` 验证档位、单位、缓存列及结构变化时停止核实；`--live` 额外请求当前十厂商官网并输出成功数量或失败原因。运行时始终从官方地址获取，不将旧样本的核实时间更新为当前日期。

- [openai.txt](https://developers.openai.com/api/docs/pricing.md)
- [kimi.txt](https://platform.kimi.com/docs/pricing/chat.md)
- [anthropic.txt](https://platform.claude.com/docs/en/about-claude/pricing.md)
- [deepseek.txt](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)
- [zhipu.txt](https://docs.bigmodel.cn/cn/guide/start/pricing.md)
- [google.txt](https://ai.google.dev/gemini-api/docs/pricing)
- [alibaba.txt](https://help.aliyun.com/zh/model-studio/model-pricing)
- [xai.txt](https://docs.x.ai/developers/pricing)
- [meta.txt](https://dev.meta.ai/docs/pricing-rate-limits)
- [xiaomi-html.txt](https://mimo.mi.com/docs/price/pay-as-you-go)
