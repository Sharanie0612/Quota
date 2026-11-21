# Contributing to Quota

欢迎提交小而明确的修复。开始前按改动范围查看[仓库编码规则](AGENTS.md)和[安全规则](docs/security.md)。

1. 代码变更按对应前端、Rust 或安装路径运行检查。只改文档时核对链接、命令及差异格式。具体命令见[开发与验证](docs/development.md)。
2. 新增服务商时，确认其官方接口、鉴权、失败回退与账单链接，在 [供应商能力](docs/providers.md) 中更新实际支持状态。不要把控制台网页接口描述成正式公开 API。
3. 不提交 API Key、AccessKey、Cookie、个人配置、真实账单数据或未经官方来源核实的模型价格。价格核实规则见 [模型资料库](docs/model-catalog.md)。
4. 提交标题用中文说明改动对象和结果。推送前核对目标分支和待发提交，PR 用模板写明原问题、最终变化和实际验证。修改安装配置或图标时附安装版启动检查结果。[Git 流程](docs/git-workflow.md#提交说明) · [PR 模板](.github/pull_request_template.md)
5. 更新安装、功能、截图、限制或开发步骤时，同步维护[中文 README](README.md) 和[英文 README](README.en.md)，保留顶部的语言切换链接。

当前仓库尚未确定开源许可证；接受外部代码贡献前需要先确定许可条款。
