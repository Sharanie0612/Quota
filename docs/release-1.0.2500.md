# 1.0.2500：Trae 模型明细与 SSH 设备名称

模型或供应商筛选用于限定本页概览、趋势、缓存和活动明细，不改变采集设置。厂商汇总统计直接使用的模型；Trae 提供和自带 API 接入分别显示，并可选择通道下的具体模型。

Trae 明细分为「Trae 提供」「API 接入 Trae」以及有历史记录时的「未鉴别」，每个通道列出模型、输入、缓存命中、输出、总 Token 和会话数。普通模型明细及缓存列表也保留各模型的通道，点击后传递原始型号和通道筛选键。缓存命中包含在输入中，不重复相加；没有原始型号或通道时保留未知，不推断补全。

SSH 采集设置直接列出每台设备的真实名称、各连接别名、远程目录与短设备标识。设备筛选和设备用量明细保留设备 ID，显示具体名称、连接别名和独立用量。同机多个 SSH 别名继续作为一台设备去重，不产生重复用量；不同设备即使名称相同也保持独立。

schema-1 同步包新增可选 `devices` 描述，仅传递事件所属设备的稳定 ID 和名称。连接别名、路径、SSH 配置及统计选择留在本机。旧包仍可读取；旧客户端忽略该可选字段。设备名称变化后按原事件 ID 重发已有指标，使用内容指纹及既有去重机制补齐旧包的统一占位名称。来源端和接收端需更新后同步，才能补齐早期跨设备记录的名称。

展示号及 npm / Cargo / Tauri 包版本统一为 `1.0.2500`，以已交付 1.0.2400 递增一次功能迭代。本轮沿用独立 UI 工作树，不改动原工作目录。

## 验证

- 前端 typecheck、build、组件渲染通过；覆盖 Trae 模型可搜索和选择、通道键不混用、缓存分模型且总命中率不变、同名 SSH 设备独立展示。
- Release examples `device_names_checks`、`activity_checks`、`ssh_activity_checks`、`sync_storage_checks` 通过。覆盖旧包修复、目录名称更新、总数不变、非法名称拒绝、连接信息不进入同步包、同机别名去重、历史排除和恢复、旧版兼容及解压上限。SSH 验证使用合成投影，不连接实际主机。
- 1024px 浏览器检查 Trae 通道下具体模型筛选及趋势联动、双通道模型表、缓存明细、SSH 名称与别名、按设备查看，以及账户表单、天梯和设置页；无页面横向溢出。浏览器截图使用演示数据。
- `npm run package:windows` 全部检查及 NSIS 打包通过，总耗时 280.4 秒。Rust 仅有既有 `get_api_key` 未使用警告。
- 安装包解包后产品版本为 `1.0.2500`，WebView2Loader.dll 哈希匹配；`check-install.ps1` 隔离启动 8 秒和 `check-widget.ps1` 原生前端握手、几何、贴边、显隐、托盘及整应用退出检查通过。证据在本工作树 `target/package-1.0.2500-check-20261018-130527/evidence.json`。

安装包：`src-tauri/target/release/bundle/nsis/Quota_1.0.2500_x64-setup.exe`，3,525,199 字节；SHA-256 `a8151b234640d8f6bc98eb12f7fc37a0eb67630d66123f7479ff8a5e0d043d73`。产物目录通过 Junction 复用仓库根目录 `src-tauri/target`。

上述本地交付检查当时未执行实际安装或覆盖升级；为避开单实例限制，隔离检查期间短暂退出并恢复了原安装的 1.0.2400，测试不读取个人用量日志和凭据。随后公开发布的升级验证见下节。真实 SSH 连接和云盘传输仍需各设备环境验证。

## 2026-10-18 GitHub 双平台公开发布

[Quota 1.0.2500](https://github.com/Sharanie0612/Quota/releases/tag/1.0.2500) 已公开，并设为 GitHub 最新版。标签指向 `db898b7585cb96811f686f785f5d6615aff0012b`，该安装包源提交已通过 PR #17 合入 main。后续发布工具和文档提交没有更改产品版本或业务代码。

| 平台 | 带版本号的安装包 | 大小 / SHA-256 |
| --- | --- | --- |
| Windows x64 | `Quota_1.0.2500_x64-setup.exe` | 3,525,199 字节；`a8151b234640d8f6bc98eb12f7fc37a0eb67630d66123f7479ff8a5e0d043d73` |
| macOS Apple Silicon | `Quota_1.0.2500_aarch64.dmg` | 6,373,074 字节；`5a32ab0393e1306ee88a12a81291dae63b05971d73ffce3a25d6483e4bfd0ca4` |

每个安装包另有相同内容的固定名称，README 的最新版入口无需逐次改链接。公开下载的两个固定链接均已在不登录的情况下实际下载，大小与 SHA-256 匹配；`SHA256SUMS.txt` 和 `release-manifest.json` 同页保留。

[发布工作流](https://github.com/Sharanie0612/Quota/actions/runs/39130772462)通过：两平台文件与源提交检查、严格产物白名单、SHA-256，以及 GitHub 临时 Windows runner 的 **1.0.1900 → 1.0.2500** 实际覆盖升级。已安装程序和 WebView2Loader.dll 匹配，两个隔离配置文件保留，升级后启动存活 8 秒；证据 artifact 为 `windows-upgrade-evidence`。维护者本机安装、个人日志与凭据未参与该检查。

[Mac 构建](https://github.com/Sharanie0612/Quota/actions/runs/39112234288)通过 App 整包签名结构、arm64、版本、无 Windows DLL、DMG 完整性及隔离启动 8 秒。包为 ad-hoc 临时签名，未进行 Developer ID 签名或公证；真实 Keychain、账户登录、覆盖升级和完整 UI 仍需实机验收。

历史安装包和标签不覆盖，后续修复使用新版本。渠道、固定链接和维护步骤见 [发布管理](releases.md)。
