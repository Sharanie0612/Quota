# Provider capabilities

下表依据 `src-tauri/src/providers.rs` 的 `DEFS`、`HIDDEN` 和实际查询分支，以及 `mimo.rs`、`aliyun.rs` 整理。`✓` 表示代码有对应查询路径，不保证第三方接口长期可用。所有服务商都可选择手动余额；自定义接口用于用户自有的余额 JSON 地址。

| Provider | 添加账户可见 | 自动余额 / 额度 | 模型列表 | 说明 |
| --- | --- | --- | --- | --- |
| DeepSeek | ✓ | API Key 余额 | ✓ | 充值、赠送余额分项 |
| Kimi (Moonshot) | ✓ | API Key 余额 | ✓ | 现金与代金券分项 |
| 智谱 GLM | ✓ | 账户报表余额 | ✓ | 报表接口未见官方文档收录，可能变化 |
| 小米 MiMo 按量 | ✓ | 控制台 Cookie 余额和本月用量 | ✓ | Cookie 到期后需更新 |
| 小米 MiMo Token Plan | ✓ | 控制台 Cookie 套餐余量和本月用量 | ✓ | API Key 与按量账户不同 |
| ChatGPT 订阅 | ✓ | 无 | 无 | 当前仅提供订阅设置等页面入口，不显示实时 5h/weekly 额度 |
| 阿里云百炼 | 隐藏 | 阿里云 AccessKey + BSS 账单余额 | ✓ | 查询的是阿里云账户余额 |
| 硅基流动 | 隐藏 | API Key 余额 | ✓ | 保留代码路径 |
| OpenAI Platform | 隐藏 | 普通 API Key 无余额；管理员成本接口可辅助估算 | ✓ | 成本并非账户余额 |
| Anthropic | 隐藏 | 无 | ✓ | 可手动或自定义接口 |
| Gemini | 隐藏 | 无 | ✓ | 可手动或自定义接口 |

服务商定义含官网、账单、充值、定价、文档和默认接口地址。查询失败应给用户可读原因，并保留重试、官网和手动余额路径。新增 Provider 目前需要修改 `providers.rs` 的定义与相应查询分支；适配器模块化属于后续重构。

任何价格数据都要遵守 [模型资料库规则](model-catalog.md)。
