<p align="center"><img src="./src-tauri/icons/128x128.png" width="96" alt="Quota icon"></p>

<h1 align="center">Quota</h1>

<p align="center"><strong>Your AI balances and quotas, at a glance.</strong></p>
<p align="center">一个轻量、本地优先的 AI 服务商余额与额度看板。</p>
<p align="center">Windows · Tauri 2 · Rust · React</p>

Quota 将多个 AI 服务商账户放在一个桌面窗口和系统托盘里。你可以查看余额、部分套餐额度与用量，设置自动刷新和低余额提醒，并跳转到服务商的官方账单或充值页面。模型列表与价格资料仍可在应用内查看。

> 当前仓库没有经过验证的应用截图。界面以实际构建版本为准。

## Features

- 多账户余额汇总；按服务商能力显示余额分项、套餐额度或用量。
- 定时刷新、低余额通知、系统托盘悬浮卡。
- 无可用查询接口时可选择自定义接口或手动余额。
- 本地配置与系统凭据管理器；充值与订阅操作只打开服务商页面。
- 模型列表、可编辑的本地价格资料和价格来源比对。

## Supported providers

以下是当前“添加账户”列表里可见的项目，能力根据代码路径整理；接口可用性仍取决于服务商和你的账户权限。

| Provider | Balance | Usage / quota | Method |
| --- | --- | --- | --- |
| DeepSeek | ✓ | — | API Key，余额接口 |
| Kimi (Moonshot) | ✓ | — | API Key，余额接口 |
| 智谱 GLM | ✓ | — | API Key，未收录在官方文档的账户报表接口 |
| 小米 MiMo 按量 | ✓ | 本月用量 | 控制台 Cookie |
| 小米 MiMo Token Plan | 套餐余量 | 本月用量 | 控制台 Cookie |
| ChatGPT 订阅 | — | — | 当前仅提供订阅页面入口 |

阿里云百炼、硅基流动、OpenAI Platform、Anthropic、Gemini 的代码定义保留，但目前不在添加账户列表。详情见 [供应商能力](docs/providers.md)。

## Install and run

仓库源码不包含预编译安装包。要在 Windows 本地构建，请安装 Node.js、Rust GNU 工具链和 WebView2 运行时，然后运行：

```powershell
npm ci
npm run tauri build
```

构建结果位于 `src-tauri/target/release/quota.exe` 与 `src-tauri/target/release/bundle/nsis/`。Windows GNU、NSIS 和 `WebView2Loader.dll` 的已知限制见 [Windows 构建说明](docs/build-windows.md)。开发运行与验证命令见 [开发指南](docs/development.md)。

## Security and data

账户设置保存在 `%APPDATA%\Quota\`；内置凭据字段中的 API Key、管理密钥、AccessKey 和控制台 Cookie 保存在系统凭据管理器的 `Quota` 服务下。旧版 `AgentPrice` 的配置与凭据在首次需要时复制到新位置，旧数据保留。Quota 不处理支付。自定义接口字段的注意事项见 [安全与迁移说明](docs/security.md)。

## Contributing

新增供应商或修复查询接口前，请读 [贡献指南](CONTRIBUTING.md)、[架构](docs/architecture.md) 和 [供应商能力](docs/providers.md)。模型价格必须依据官方来源核实，规则见 [模型资料库](docs/model-catalog.md)。

## Roadmap

- 将供应商逻辑按适配器逐步模块化。
- 设计能够区分 Balance、Credit、Quota、Usage 的统一指标模型。
- 调整主导航，让余额与额度总览更突出。

## License

尚未选择开源许可证。仓库公开可读不代表已授予再分发或修改许可；贡献和复用前请等待许可证确定。
