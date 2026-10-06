# Quota 1.0.1000 · 本地 Mac 交付

日期：2026-10-06。展示号和 npm / Cargo / Tauri 包版本均为 `1.0.1000`。以已交付 1.0.0900 为基线，作为功能迭代递增一次；不代表已公开发布或已合并 main。

## 变化

- Token 自动采集频率在设置中可选，默认 30 秒，最短 5 秒；采集后活动页自动刷新。共享 Token 指标交换最低间隔 5 分钟，账户资料交换独立每 5 分钟执行。
- 账户总览沿用用户选择的 iCloud Drive / OneDrive / NAS 共享目录，同步显示资料及结构化余额/订阅快照。所有密钥、Cookie、Token、自由格式连接字段及原始响应排除；新设备需独立连接账户。删除仅影响本机，不跨设备删除。
- Mac 跟随系统 HTTP(S) 代理，官网文档读取增加系统 curl 回退；无汇率时保留原币种图，部分排名响应不丢已有型号。沿用确定性官方价格解析，无法核实的型号仍不进入价格图。
- ZCode 任务索引库不再误报用量格式不兼容；重复采集不叠加 Token。未知用量库结构仍给出错误。
- 删除飞书自动调用与界面入口；导出 / 导入统一，登录信息默认不包含，需要用户选择加密备份才导出。旧备份与统计文件保持兼容。

## 验证与产物

- TypeScript 类型检查、Vite 构建、Rust `cargo check --examples`、纯逻辑 7/7 通过。
- UI 渲染、活动图表、账户总览、模型比较，以及 activity / account_sync / migration / sync_price / product / harness examples 通过。账户同步测试使用合成双设备共享目录，验证白名单、幂等、冲突、旧快照保护、本机连接保留及非法设备输出路径拒绝。
- 十家官方价格在线读取在本次代码优化阶段通过；本机 ZCode / Codex 只读采集无错误，紧接重复采集无新增 Token。
- 1024px 浏览器演示检查通过，不替代真实文件选择、凭据库或云端传输验收。
- Mac arm64 App / DMG 实际生成，包版本核对为 1.0.1000，`codesign --verify --deep --strict` 与 `hdiutil verify` 通过。隔离配置无账户、关闭自动采集/天梯更新/云同步，App 启动后持续存活并结束测试进程；未读取个人账户、未写入真实云盘。

本地产物：`src-tauri/target/release/bundle/dmg/Quota_1.0.1000_aarch64.dmg`，约 5.5 MB。

SHA-256：`184edab3cbc110529dbab8bd6a6862956d5e8c4b7d733c64c8763df1886884ae`。重新构建可能不同。

为避免出现两份 App，本次构建副本已移到废纸篓，可恢复；只保留现有安装 App 与新版 DMG。**没有自动替换已安装的 1.0.0900**。用户退出 Quota 后可用 DMG 替换「应用程序」中的旧版。

## 尚未验证

Windows 1.0.1000 原生 NSIS 构建/升级、Mac 覆盖升级、Windows / Mac 双机对照、真实 iCloud / OneDrive 云端传输、真实账户与钥匙串迁移尚未完成。仅 ad-hoc 临时签名，没有 Apple Developer ID 签名或公证；Intel / Universal 未构建。
