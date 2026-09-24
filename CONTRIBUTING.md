# Contributing to Quota

欢迎提交小而明确的修复。开始前请阅读 [开发指南](docs/development.md) 和 [安全规则](docs/security.md)。

1. 使用 `npm ci` 安装依赖。修改前端后运行 `npm run typecheck` 和 `npm run build`；修改 Rust 后在 `src-tauri/` 运行 `cargo check`。还需运行 `node scripts/verify-logic.cjs`。
2. 新增服务商时，确认其官方接口、鉴权、失败回退与账单链接，在 [供应商能力](docs/providers.md) 中更新实际支持状态。不要把控制台网页接口描述成正式公开 API。
3. 不提交 API Key、AccessKey、Cookie、个人配置、真实账单数据或未经官方来源核实的模型价格。价格核实规则见 [模型资料库](docs/model-catalog.md)。
4. PR 写清用户可见变化、验证结果和涉及的兼容风险。修改安装配置或图标时，附上安装版启动检查结果。

当前仓库尚未确定开源许可证；接受外部代码贡献前需要先确定许可条款。
