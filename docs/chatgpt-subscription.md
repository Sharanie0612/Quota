# ChatGPT 订阅接入

1.0.0100 已实现订阅内 Codex 额度查询。先在本机 Codex 使用 ChatGPT 登录，再在 Quota 添加 ChatGPT 账户并点击「连接本机登录」。支持显示剩余百分比和重置时间，不把这些额度当作网页聊天次数或 API 余额。

后端遵循 [Codex 官方身份验证文档](https://developers.openai.com/codex/auth/)：尊重 CODEX_HOME，优先读取 Codex Auth 系统凭据，缺失时读取 auth.json；只在内存使用 access token 请求固定官方 wham/usage 端点。Quota 只将绑定账户 id 保存到 Windows 凭据管理器，不复制 token，不轮换 refresh token，不修改 Codex 登录。

登录过期时重新登录 Codex，再返回连接；本机切换 ChatGPT 账户时重新连接对应 Quota 账户，避免将另一账户的额度显示在原账户下。后台接口变化、网络或权限限制会显示可重试错误并保留上次数据，不能保证所有账户都返回同样的额度窗口。
