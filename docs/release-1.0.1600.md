# Quota 1.0.1600

新增多设备已确认账户关联与小米登录会话复用，基于 1.0.1504 递增功能字段一次；包版本与展示号均为 1.0.1600。保留 Trae 用量和 Windows 一键打包。

共享目录新增严格白名单的独立关联协议。关联一次后其他设备沿用该决定，保留本机 UUID 与连接；关联证据持久保存并转发，设备离线或旧账户文件回流不重建重复卡片。关联不会上传凭据、Cookie、散列或会话引用；身份冲突保留原账户并报告。

小米官方会话分片保存在系统凭据管理器，登录窗口保持无痕并恢复官方域 Cookie。定期查询保存服务端轮换 Cookie；明确登录过期时先尝试官方 SSO 恢复，有超时和重试间隔。升级后需重新连接一次以采集旧版没有保存的 SSO 信息；是否可免扫码取决于服务端验证。

操作说明见 account-sync.md 和 mimo-session.md。完整 SSO 会话不跨设备自动迁移。

## 验证

TypeScript、Vite、Cargo examples 类型检查、7/7 纯逻辑、组件渲染和 1024px 浏览器界面回归通过。

release examples：account_sync_checks、account_connection_checks、account_sync_migration_checks、shared_account_checks、mimo_session_checks、mimo_login_checks 已通过。共享回归覆盖一次确认、三设备传递、新设备无凭据探测、单次修改传播、创建时间差异、旧文件与缺失关联文件、重启、不同登录保护和本机删除。会话回归覆盖官方域、属性/过期/轮换、第三方 Cookie 拒绝、长会话分片和写入失败保留旧会话。

浏览器证据位于 src-tauri/target/qa-1600-ui。安装包解包后的隔离启动、旧同步台账读取、版本及 WebView2Loader.dll 校验通过，证据位于 src-tauri/target/package-smoke-1600/verification.json。交付安装包为 target/deliveries/Quota_1.0.1600_x64-setup.exe，SHA256 为 F15657DFA42D100754A7D13C6288BD3606C8B6C1E5643C55AA602DB304AB5CD4。未运行实际安装升级，当前个人安装与数据保留。多设备验证使用独立配置与合成共享目录；小米会话验证使用内存凭据库与合成 Cookie，不读取个人登录信息。真实双设备云盘传输与真实小米 SSO 续期仍需用户环境验收。
