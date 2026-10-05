# Quota 1.0.0301

2026-10-04 · 修复迭代 · 包版本 1.0.301 · 本地构建待发布

以已交付本机测试的 1.0.0300 为基线，本次只修复问题，修复字段从 00 增为 01。仅按此次用户要求的交付递增一次；没有公开发布或推送。

- ChatGPT 账户、OpenAI 天梯模型及 Token 活动统一使用官方黑白 Blossom SVG，支持深浅色和离线显示。
- 配置、模型资料覆盖及隐藏列表读取失败时保护原文件，阻止默认值覆盖损坏资料；显示脱敏错误和修复后重启提示。备份和账户连接保存增加资料读取预检。

前端类型、构建、静态渲染、逻辑 7/7、Rust 检查及配置保护八组检查已通过。多文件恢复事务、真实浏览器视觉复验及安装器升级验证仍待完成。

安装包及隔离解包启动证据在构建完成后追加。

- 实际 Tauri/NSIS 构建成功，句柄 32863 已退出 0，无运行中的构建。唯一安装包：D:\AgentProjects\Quota\src-tauri\target\release\bundle\nsis\Quota_1.0.0301_x64-setup.exe。
- 大小：2794779 字节；SHA256：84013680C9299D4C003C574528B3680774084AD4EC8BD1BF1A9CEF96F4300824。
- 解包目录：D:\AgentProjects\Quota\src-tauri\target\install-smoke-0301-20261004-170411；ProductVersion=1.0.301，WebView2Loader.dll 与源资源 SHA256 一致。
- check-install.ps1 使用 isolated-data 启动 8 秒通过，仅关闭自检实例；没有覆盖个人安装。
- 这是解包启动验证；安装器实际升级和浏览器视觉复验仍未完成。包含官方 Logo 修正与配置读取保护。
