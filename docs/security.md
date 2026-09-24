# Security and migration

Quota 在本地保存账户设置和模型资料。`%APPDATA%\Quota\config.json` 记录账户与设置，`catalog_overrides.json` 保存用户编辑的模型资料，`hidden_models.json` 保存隐藏列表。这些文件不应包含 API Key、管理密钥、AccessKey 或控制台 Cookie；密钥由系统凭据管理器保存，键是服务名 `Quota` 加账户 id。

## 从 AgentPrice 升级

启动时，`storage.rs` 会针对新目录中缺失的三个 JSON 文件，逐个验证并从 `%APPDATA%\AgentPrice\` 复制。已存在的新文件不会被覆盖。旧文件保留；旧 JSON 无法解析时启动会报错，以免静默创建空配置并覆盖用户数据。

读取某账户凭据时，`secrets.rs` 先查 `Quota` 服务。如果没有条目，再读取旧 `AgentPrice` 服务并将原始凭据复制到新服务；旧条目保留。旧版裸 API Key 仍可读取。删除账户或清空某账户密钥会在新服务写入空条目，阻止旧凭据再次被回退逻辑读出。旧服务中的条目仍保留，供回滚使用；用户若要彻底清理，需自行确认旧版不再使用后删除。

Tauri identifier 仍是 `com.agentprice.desktop`（legacy compatibility），目的是维持旧安装的升级关系。不要在没有验证安装器升级和卸载行为前改动它。

## Rules

- 密钥只进入系统凭据管理器，不写入配置、日志、前端 bundle 或仓库。
- 自定义接口的请求头和请求体可能由用户填入敏感信息；当前配置格式会将它们写入 `config.json`。不要在这些字段放密钥，使用系统凭据字段。改进这一路径前，不应宣称所有自定义接口密钥都受凭据管理器保护。
- 价格页抓取和模型列表会访问对应的第三方站点；Quota 本身没有云同步或自有服务器。
- 充值、订阅和账单按钮只打开服务商页面，Quota 不处理支付。
