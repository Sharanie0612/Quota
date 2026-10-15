# Quota 1.0.1900

本页保留首次云同步构建记录。后续同一待发布版本的窗口与会话修复见[窗口交付说明](window-session-1.0.1900.md)；最新界面和安装包哈希见[产品界面优化说明](product-polish-1.0.1900.md)。

展示版本及 npm / Cargo / Tauri 包版本均为 `1.0.1900`。以已发布 `1.0.1800` 为基线，按功能迭代递增一次。

## 我的使用云盘同步

在设置中选择与其他设备相同的云盘文件夹后，订阅账期、实付支出、累计充值/消费观察及每月固定参考汇率会一起同步。Token 用量继续使用现有活动同步，不重复采集或另建账本。手动“更新我的使用”和“立即同步”均会交换费用；应用运行时约每 5 分钟同步，关闭自动采集仍有效。

账期修改、删除和移动可以跨设备传播，旧快照不会复活已删除记录。同键离线编辑按逻辑版本及设备 UUID 收敛，不同键新增保留；重叠账期保留本机版本并提示具体日期，需在原设备调整或删除一条后重试，不重复计费。显式关联的不同本机账户 UUID 可以合并消费观察，不自动合并不同账户。原始币种保留，费用不会从公开 Token 单价推算。

新增 `quota-usage-v1` 费用交换目录及本机 `usage-sync.json` 修订索引；原费用和汇率文件格式不变。协议仅允许结构化账期、金额、UUID、时间、公开套餐 ID 与固定汇率，不含 Token 事件、账户名称、网址配置、凭据或会话内容。旧版客户端忽略新目录，需升级才能同步费用。

## Harness 旧会话

支持 v0 的 `session.jsonl[.zstd]` 及 v1 的 `session.v1.jsonl[.zstd]`，保留 v2–v4。处理旧打包流片段及逻辑继承长度，最终 usage 替换同次尝试中的流式 usage；计费尝试标识不再依赖迁移中改变的物理序号。重读已有 Harness 日志以迁移旧统计标识，新客户端不会从旧云包恢复已替换计数。参与 Harness 统计的设备需一同升级。

未知新版本继续拒绝回退，错误会带实际版本号，不猜测用量。适配依据：[官方 v0/v1 物理解码](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-format-v0-to-v1/src/codec.ts)、[v1 到 v2 流式迁移](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/session/session-format-v1-to-v2/src/migration.ts)。

## 验收与范围

- `npm run typecheck`、`npm run build`、`cargo check --locked --examples`、纯逻辑 7/7、组件渲染与厂商费用逻辑检查通过。
- 10 个 release examples 通过：`usage_sync_checks`、`harness_checks`、`activity_checks`、`sync_storage_checks`、`vendor_cost_checks`、`usage_fx_checks`、`trae_checks`、`account_sync_checks`、`account_connection_checks`、`shared_account_checks`。费用同步覆盖旧文件迁移、关联账户、重复同步、删除、旧快照、离线新增、同键竞争、账期移动、重叠冲突、独立域合并、损坏重试、8 MiB 上限及严格字段白名单；凭据检查使用内存库。
- `npm run package:windows` 完成 NSIS 构建。安装包 `Quota_1.0.1900_x64-setup.exe`，3,416,851 字节；SHA-256：`9262a8ad91671d8a7f0fc3d42e7ebf3ae04bea88eb37ac42b850002dc023ca96`。
- 真实安装目录完成 `1.0.1800 → 1.0.1900` 覆盖升级：包内程序与安装后程序一致，WebView2Loader.dll 一致，四个个人配置/费用文件在安装过程中保持不变，隔离配置启动 8 秒通过，原应用恢复运行。另用包内程序与纯合成隔离配置验证：关闭自动采集时，启动后仍会自动发布费用同步包。
- 1024px 检查我的使用、账期管理、同步未开启/已开启/冲突状态、六平台极简账户表单及天梯页面，未出现横向溢出，浏览器无错误日志。

目标设备 `PC-20241016WKIL` 为另一台电脑；当前工作机未配置其 Harness 源日志，本轮用官方格式合成日志验证兼容，未宣称在该 PC 上实测。真实云盘跨电脑传输及 macOS 本轮未实测。安装包与本轮源码一起交付，需在该 PC 上升级后重新采集。
