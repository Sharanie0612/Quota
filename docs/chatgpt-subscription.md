# ChatGPT 订阅接入方案研究(参考 cc-switch)

> 2026-09-28 整理。来源:[farion1231/cc-switch](https://github.com/farion1231/cc-switch) 源码、
> [openai/codex](https://github.com/openai/codex) 官方源码(codex-rs/login)、vct_core、
> [CodexBar 文档](https://github.com/bcharleson/codexbar/blob/main/docs/codex.md),四方交叉验证。

## 结论一句话

不做 OAuth 登录,直接**读取 Codex CLI 写在本机的 `~/.codex/auth.json`**,拿其中的
`tokens.access_token` 当 Bearer token,请求 ChatGPT 后端接口
`GET https://chatgpt.com/backend-api/wham/usage`,解析
`rate_limit.primary_window / secondary_window` 的 `used_percent + reset_at`,
得到「5 小时窗口 / 每周窗口」的已用百分比与重置时间。

## 1. 凭据:读 `~/.codex/auth.json`

- 位置:`$CODEX_HOME/auth.json`(默认 `%USERPROFILE%\.codex\auth.json`),尊重 `CODEX_HOME` 环境变量。
- 只有 `auth_mode == "chatgpt"` 才走订阅额度查询(`apikey` 模式有 `OPENAI_API_KEY` 字段,是另一回事)。

```jsonc
{
  "auth_mode": "chatgpt",
  "OPENAI_API_KEY": null,
  "last_refresh": "2026-09-20T08:30:00.123456789Z",
  "tokens": {
    "id_token": "<JWT>",          // 含身份 claims(plan 类型)
    "access_token": "<JWT>",      // Bearer 令牌,有效期约 8 天
    "refresh_token": "<不透明>",   // 服务器会轮换
    "account_id": "<workspace UUID>"  // 即请求头 ChatGPT-Account-Id
  },
  "cli_auth_credentials_store": "file"   // keyring 模式时 auth.json 可能不存在
}
```

- **plan 类型**:解 `id_token`(JWT)的 payload(base64url、无 padding),plan 在嵌套 claim
  `https://api.openai.com/auth.chatgpt_plan_type` 里,值为 `free / plus / pro / business / enterprise / edu`
  (团队订阅叫 `business`,没有 `teams`)。官方参考:`codex-rs/login/src/token_data.rs`。
- `account_id` 优先级:`tokens.account_id` → JWT `auth.chatgpt_account_id`。
- 若 `cli_auth_credentials_store == "keyring"`,凭据在系统密钥环(Windows 服务名 `Codex Auth`),v1 不支持时给出可读提示即可。

## 2. Token 刷新(可选做;v1 可只读不刷)

```
POST https://auth.openai.com/oauth/token        # form-urlencoded
grant_type=refresh_token
refresh_token=<tokens.refresh_token>
client_id=app_EMoamEEZ73f0CkXaXp7hrann          # Codex CLI 公开 client id
scope=openid profile email
```

- 响应带新的三件套;**refresh_token 会轮换,必须写回 auth.json**,否则下次刷新即失效。
  写回用 CAS 保护:写前比较文件里旧的 refresh_token 与刷新时读到的一致(Codex CLI 可能同时在运行)。
- **有效期是约 8 天,不是 1 小时**。按 `last_refresh` 距今 > 8 天才刷新;不要按小时刷。
- 刷新失败的可识别错误码:`refresh_token_expired / reused / invalidated`,以及 401/403 → 提示重新登录。
- v1 最安全策略:不自己刷新;`last_refresh` 超期时提示用户跑一次 `codex` 命令让官方刷新。

## 3. 用量接口

```
GET https://chatgpt.com/backend-api/wham/usage

Authorization: Bearer <access_token>
ChatGPT-Account-Id: <account_id>     # 恒带,多 workspace 时必需
originator: codex_cli_rs             # 官方常量
User-Agent: codex_cli_rs/0.42.0      # 或 codex-cli,均可
Accept: application/json
```

响应(宽松解析,字段随时可能变):

```jsonc
{
  "rate_limit": {                    // 单数;个别旧实现为 rate_limits,两者都试
    "primary_window":   { "used_percent": 34.5, "limit_window_seconds": 18000,  "reset_at": 1730000000 },
    "secondary_window": { "used_percent": 12.1, "limit_window_seconds": 604800, "reset_at": 1730600000 }
  },
  "credits": { ... }, "spend_control": { ... }
}
```

- 窗口命名**按 `limit_window_seconds` 判定**,不按位置:18000 = 5 小时,604800 = 每周,
  2592000 = 30 天(free 计划的 secondary)。
- 展示:每个窗口一行「已用 N% + 重置倒计时」;颜色阈值 <70% 绿、70–89% 橙、≥90% 红。
- `used_percent` 可能为 0/null(窗口未激活)、`reset_at` 可能缺,解析要容忍;business 账户的限额可能嵌在
  `spend_control` 下。

## 4. cc-switch 的关键实现文件(参考用)

| 文件 | 内容 |
| --- | --- |
| `src-tauri/src/services/subscription.rs` | 核心:`query_codex_quota` → 请求/头/解析/窗口分类/401 处理 |
| `src-tauri/src/codex_config.rs` | auth.json 读取、JWT `sub` 解码、原子写回 |
| `src-tauri/src/proxy/providers/codex_oauth_auth.rs` | 自有 OAuth(设备码登录流),v1 不需要 |
| `src/components/SubscriptionQuotaFooter.tsx` | 前端 tier 展示/颜色/倒计时 |

## 5. 移植到 Quota 的要点

1. **只读、不存储、不落日志**:token 只在内存中现取现用,符合安全红线;凭据本来就属于 Codex,不进凭据管理器。
2. 新模块 `src-tauri/src/codex_subscription.rs`:reqwest GET wham/usage,15s 超时,`serde_json::Value` 宽松解析;
   走 `proxy::system_proxy_url()` 的现有跟随逻辑(chatgpt.com 在国内需要代理)。
3. 命令链:`commands.rs` 加 `get_codex_subscription_quota` → `lib.rs` 注册 → `api.ts` 封装 → ChatGPT 订阅卡片展示。
4. 错误策略:401/403 → 琥珀提示「凭据过期,请在 Codex CLI 重新登录」+ 官网入口;网络错误 → 保留上次成功值、可重试、可改手动。
5. 刷新频率:默认 5 分钟一次、仅查询该账户时(与 cc-switch 一致)。
6. 界面:plan 名(解 JWT)+ 两个窗口行 + 重置倒计时;配色用 `styles.css` 现有变量。

## 坑清单

1. `rate_limit` 单数为主,容错 `rate_limits`。
2. access_token 寿命 ~8 天,别按小时刷;401 时先刷新重试一次。
3. refresh_token 轮换必须原子写回(tmp + rename + 值比对),写回失败当刷新失败。
4. business 账户限额形状不同,字段缺省兜底。
5. 这是未公开内部 API,无契约;解析失败显示「暂无法获取」,不要崩。
6. 不带浏览器 Cookie 访问网页版路径(会撞 Cloudflare 人机验证);`backend-api/wham/*` + Bearer JWT 不会被拦。
7. keyring 模式下 auth.json 不存在,要给可读错误「未找到 Codex 登录凭据」。
