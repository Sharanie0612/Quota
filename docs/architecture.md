# Architecture

Quota 是一个本地 Tauri 2 桌面应用。React 前端通过 `src/lib/api.ts` 调用 Tauri commands；`src-tauri/src/commands.rs` 负责账户视图、刷新和模型资料操作，`providers.rs` 维护服务商定义与部分余额和模型请求逻辑。

```text
React views / tray popup
  → src/lib/api.ts
  → Tauri commands.rs
  → providers.rs / mimo.rs / aliyun.rs / custom.rs / pricing.rs
  → storage.rs (non-secret JSON) / secrets.rs (system keyring)
```

主窗口 label 为 `main`，`src/main.tsx` 渲染 App；托盘单击打开主窗口。`mimo-login` 为无 Quota IPC 权限的隔离官方登录窗口。`refresh.rs` 定时更新账户并触发低余额通知。模型资料由 `catalog.rs` 合并内置数据、服务商模型列表及本地覆盖；价格比对在 `pricing.rs`。

当前账户查询模型仍以 `Balance` 为中心。MiMo 的套餐余量和用量会映射到已有卡片字段；尚未引入独立的 `QuotaMetric`。供应商适配器也尚未拆分，扩展时请先检查 `providers.rs`、`commands.rs` 及前端的调用关系，避免扩大单一文件的职责。

安全边界与迁移行为见 [security.md](security.md)，新增供应商见 [providers.md](providers.md)。

`subscription.rs` 读取官方 Codex 登录并查询固定官方额度端点，绑定账户 id 存入系统凭据管理器；不复制 token。`ladder.rs` 管理全厂商排名缓存、原厂价格和每日检查；候选价格不自动覆盖本机核实资料。

`activity.rs` 在后台只读扫描 Codex JSONL 与 ZCode SQLite，增量游标、全局事件去重和共享目录分片同步独立于账户与凭据；前端 `ActivityView` 只接收聚合指标。详见 `activity-stats.md`。
