# Quota 1.0.2801 评分修复

基于 1.0.2800 的修复版；分支 `codex/fix/benchmark-validity`，展示号与包版本均为 1.0.2801。本轮不代表 macOS 或 GitHub 发布。

## 根因和修正

上一版将不同配置的分项最高值、不同任务类型的分位数与不对称的官网权重组合为通用性能分。自洽测试未充分检验测评口径与实际显示，这是验证缺口。

修复后保留源站原分和一套完整配置，按 LiveBench 当前官网权重计算，官网只独立对照；跨榜另列同池平均名次。完整规则见 [当前模型榜单说明](model-benchmarks.md)。原始 AA / LiveBench 榜不再要求两个平台都收录才显示。

## 本轮对账

| 榜单 | 型号数 | 排名前列 |
| --- | ---: | --- |
| AA v5 | 37 | Opus 5.5 58.41；Astra 56.85；Sol 54.51；Sonnet 54.24；Terra 50.98 |
| LiveBench 20261025 | 31 | Fable 85.69；Astra 85.64；Opus 85.14；Sol 84.07 |
| 同池共识 | 19 | Opus、Astra 的平均名次均为 2.00，并列第一；Sol 为 3.50，第 3 |

公开原始记录 1420 条、AA 配置 76 条；每条 AA 指数与分项通过原始配置 slug 关联。默认回退、Max/Xhigh 等不会在展示时被隐去。旧 schema 1 缓存不参与新榜单，用户无需手动删文件。

35 条独立黄金预期（4 AA + 31 LiveBench）全部通过；37 个 AA 主榜条目逐一与对应原始 profile 指数相等。浏览器真实组件的三榜所有卡片分数/名次/配置，以及 Low 切换、详情、原始分项和离线状态通过。

## 安装版与提交

Windows 最终构建已完成 `npm run package:windows`；前端类型检查、构建、纯逻辑 7/7、榜单/价格/SSH/用量相关 Node 回归以及 `cargo check --examples --locked` 通过。Rust 仅有原有 `get_api_key` 未使用警告，本机未使用 `cargo test`。

`benchmark_checks --fixtures --live --write-seed` 的独立源站对账通过；浏览器检查覆盖 1024px 明暗模式、三张榜单全部卡片、档位切换与原始分项。浏览器预览中的账户数据为模拟数据。

最终安装包实际将 `D:\Quota\quota.exe` 从 **1.0.2800 覆盖升级到 1.0.2801**：安装向导启动、WebView 加载、安装引擎及完成页均通过；安装后的 exe 与该安装包解出的 exe 一致，WebView2Loader 哈希一致，5 个既有个人数据文件哈希未变。便携 exe 与 NSIS payload 因包类型标记不同，不混用其哈希。

随后使用**安装目录中的 exe**、空账户和关闭采集的隔离目录验证启动、原生悬浮窗、窗口圆角状态，以及真实 WebView 的 37 条 AA、31 条 LiveBench、19 条共识记录：共 **87 行显示分数、名次与配置 ID** 全部匹配 Rust 输出，另与 35 个源站黄金预期核对。验证后恢复了正常安装版进程。

验收证据在工作树 `target/installed-2801-validity-upgrade/`，源站对账在 `target/benchmark-sources/reconciliation.json`。交付目录另附这些不含个人账户的报告。

| 文件 | SHA-256 |
| --- | --- |
| Windows 安装器 | `495ffbace090f8a10d14bd55b4eb06457b708606d8c6d9728873c3aecb9d9bec` |
| 便携版 quota.exe | `510772da03b321be34fb0fc24797c6e713fa90bcdda766cd2c13a730fd5c5f06` |
| NSIS 安装后的 quota.exe | `16bf2ca854e3532892402c2a6f0919b743df1187f1c333eb19d3f79d09b02065` |

本次没有验证 macOS、远程 CI 或人工鼠标拖拽/Snap；程序化窗口状态检查不能代替这些验证。榜单能忠实还原来源，不表示它能够预测所有实际任务；跨榜共识也不表示相同预算下的统一能力测量。
