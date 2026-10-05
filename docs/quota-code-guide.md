# Quota 工程逐部分理解指南

> 写给没学过 Rust / TypeScript 的你。目标：读完能独立看懂每个模块「在干嘛、为什么这么写」，并能自己改一点东西。
> 全文只假设一件事：你会用电脑。不需要任何编程基础。

---

## 怎么读这份文档（建议三遍读法）

- **第一遍 · 15 分钟**：只读每部分开头的「这节回答」加粗句和所有表格，跳过代码。建立全景。
- **第二遍 · 1 小时**：对照仓库源码读正文里的代码片段。遇到不认识的词，翻最后的「术语小词典」。
- **第三遍 · 动手**：按第 14 部分的练习路径，自己改一点代码并跑验收命令。

文档分四个板块：**板块一打地基**（全景、语言、地图）→ **板块二走主线**（跟着一次「刷新余额」把前后端走一遍）→ **板块三看支线**（后台任务、模型库、天梯、备份）→ **板块四动手**。主线各部分结尾有「→ 下一步」指引，顺着读就是一条完整的数据流。

## 目录

| 板块 | 部分 | 内容 |
|---|---|---|
| 一 · 打地基 | 第 1 部分 | 全景：软件由什么组成 |
| 一 · 打地基 | 第 2 部分 | 语言速查：高频符号对照表 |
| 一 · 打地基 | 第 3 部分 | 文件地图 + 一次调用的完整旅程 |
| 二 · 走主线 | 第 4 部分 | 前端骨架（App.tsx） |
| 二 · 走主线 | 第 5 部分 | 传话筒（api.ts / types.ts） |
| 二 · 走主线 | 第 6 部分 | 后端大门（lib.rs / commands.rs） |
| 二 · 走主线 | 第 7 部分 | 供应商登记表（providers.rs） |
| 二 · 走主线 | 第 8 部分 | 密钥保险箱（secrets.rs / connections.rs） |
| 二 · 走主线 | 第 9 部分 | 账本（storage.rs / history.rs） |
| 三 · 看支线 | 第 10 部分 | 自动化值班（refresh.rs / tray.rs） |
| 三 · 看支线 | 第 11 部分 | 模型库与价格纪律（catalog.rs / pricing.rs） |
| 三 · 看支线 | 第 12 部分 | AI 天梯（ladder.rs） |
| 三 · 看支线 | 第 13 部分 | 加密备份（backup.rs） |
| 四 · 动手 | 第 14 部分 | 验收命令与练习路径 |

---

# 板块一 · 打地基

## 第 1 部分 全景：这个软件是怎么组成的

**这节回答：Quota 由什么组成？为什么界面是网页、核心却是 Rust？**

Quota 是一个 Windows 桌面软件，技术栈叫 **Tauri 2**。用一家餐厅来理解它的三个角色：

| 角色 | 技术 | 类比 | 负责 |
|---|---|---|---|
| 外壳 | **Tauri**（框架） | 整栋餐厅建筑 + 传菜窗口 | 开窗口、系统托盘、通知、打包成 exe |
| 前端 | **React + TypeScript**（网页） | 大堂：菜单、桌椅、点餐屏 | 你看到的一切界面 |
| 后端 | **Rust**（编程语言） | 后厨：真正干活的厨房 | 发网络请求、算价格、管密钥、存文件 |

**为什么界面是「网页」？** Tauri 的做法是：Rust 负责开一个系统自带的浏览器内核（WebView2，Windows 自带，不用额外安装），里面跑一个本地网页。所以 `src/` 目录下全是网页代码，`src-tauri/` 目录下全是 Rust 代码。

**为什么要分成两半？** 最主要的原因是**安全**：API Key 这类秘密只放在 Rust 这边，永远不传给网页层。网页就算被注入恶意代码，也拿不到密钥。

**前后端只有两条对话通道**，记住它们，整个工程就通了：

1. **前端喊话（invoke）**：前端「点菜」——`invoke("refresh_all")` 就是对后厨喊「执行 refresh_all 这道工序」。
2. **后端广播（event）**：后端「叫号」——干完活后喊一嗓子 `accounts-updated`，前端听到就自动刷新界面。

一句话总结：**前端是屏幕，后端是机房，invoke 是传话筒，事件是广播。**

→ 下一步：要看懂两边各自在说什么，先认识几个高频「单词」，见第 2 部分。

## 第 2 部分 语言速查：读代码前先认识这些「单词」

**这节回答：看到不认识的符号去哪查？**

不用系统学语言，认识下面这些高频写法，就能读懂本项目 90% 的代码。

### TypeScript（前端）的 6 个高频写法

| 写法 | 意思 | 本项目真实例子 |
|---|---|---|
| `interface Xxx { ... }` | 给一份「数据」规定字段说明书 | `types.ts` 里的 `AccountView`：一个账户卡片上该有哪些字段 |
| `: string` / `: number` | 变量的类型标注（写错了编辑器会标红） | `provider: string` |
| `?`（字段后） | 这个字段**可以没有** | `note?: string \| null` |
| `\|`（联合类型） | 「或者是 A 或者是 B」 | `"api" \| "manual" \| "custom"` —— 余额来源只能是这几种之一 |
| `async` / `await` | 「这事要等结果，等到了再往下走」（像等外卖） | `const accounts = await api.listAccounts()` |
| `=>` | 函数的简写形式 | `onClick={() => setView("models")}`（点击时执行） |

React 专属、出镜率最高的一个：

```ts
const [view, setView] = useState<View>("accounts");
```

`useState` = **组件的记忆**。这行翻译成人话：「这个页面记住一个叫 view 的变量，初始值是 'accounts'；以后调 setView('models') 就改它的值，界面会自动跟着重画。」

### Rust（后端）的 10 个高频写法

| 写法 | 意思 | 怎么读 |
|---|---|---|
| `fn foo(...) -> Result<T, String>` | 定义函数，返回「成功值 T 或错误 String」 | 失败不会崩溃，错误会一路传回给界面显示 |
| `Option<T>` | 可能是「有（Some）」也可能是「没有（None）」 | 比空值 null 更安全：编译器逼你处理「没有」的情况 |
| `?`（行尾） | 「如果这步失败了，立刻把错误往上交」 | `let cfg = load()?;` = 加载失败就直接报错返回 |
| `&` / `&mut` | 借用：只读借 / 可写借（不搬走原件） | `fn view(state: &AppState)` 只看不动它 |
| `struct` + `impl` | 数据结构 + 挂在它身上的函数 | `struct Account {...}` + `impl Account { fn ... }` |
| `match` | 增强版 switch，把所有情况列全 | 余额查询按平台分发就是一大段 `match` |
| `Mutex<T>` + `.lock()` | 上锁的共享格子：同一时刻只有一个人能用 | 后端的公共数据都锁着，防止两边同时改坏 |
| `#[xxx]` | 贴在函数/结构上的「标签」 | `#[tauri::command]` = 「这个函数允许前端调用」 |
| `.clone()` | 复印一份 | Rust 默认「移动」数据不复印，要复印必须写明 clone（编译器在防你出错） |
| `serde` / `serde_json` | 翻译官：Rust 结构 ↔ JSON 文本互转 | 配置文件是 JSON，靠它读进来写出去 |

有了这两张表，你可以直接去读任何一段代码，卡住了再回来查。

→ 下一步：单词认识了，看一眼整个工程的「地图」和一条完整的调用链，见第 3 部分。

## 第 3 部分 文件地图 + 一次调用的完整旅程

**这节回答：文件各管什么？点一次「刷新全部」，数据是怎么流动的？**

### 3.1 目录速览（一句话版职责）

```
src/                        前端（网页层）
├── App.tsx                 总壳：左侧导航 + 4 个页面切换
├── views/                  4 个页面：账户总览 / 模型库 / AI 天梯 / 设置
├── components/             可复用积木：账户卡片、编辑表单、弹窗、图标…
└── lib/
    ├── api.ts              传话筒：所有 invoke 命令的集中封装（唯一前后端边界）
    ├── types.ts            数据说明书：与 Rust 端字段一一对应
    └── store.ts            小型状态管理：toast 提示 + 账户数据自动刷新

src-tauri/src/              后端（Rust 层）
├── lib.rs                  启动入口：装插件、建共享状态、启动后台任务、注册 30 个命令
├── commands.rs             前端命令的「前台接待」（最大的文件）
├── providers.rs            供应商登记表 + 各平台余额查询实现（第二大的文件）
├── secrets.rs              密钥保险箱（Windows 凭据管理器）
├── connections.rs          小米登录隔离窗口 / ChatGPT 连接
├── subscription.rs         ChatGPT 订阅额度读取
├── mimo.rs / aliyun.rs     小米控制台解析 / 阿里云官方签名
├── custom.rs               自定义余额接口（任意 URL + JSONPath）
├── storage.rs / model.rs   JSON 文件读写（原子写入）/ 全部数据结构定义
├── history.rs              余额历史（趋势、可用天数预测、充值检测）
├── refresh.rs              后台自动刷新 + 低余额系统通知
├── ladder.rs               AI 天梯：抓 AITier 排名 + 价格候选
├── catalog.rs / pricing.rs 内置模型资料库 / 官方定价页抓取与比价
├── backup.rs               AES-256-GCM 加密备份
└── tray.rs                 托盘图标（红点角标是代码画的）
```

### 3.2 旅程示例：你点了「刷新全部」按钮，中间发生了什么

这条旅程是**全文的主线**，后面第 4~9 部分就是把它一段一段拆开讲：

1. 你点击按钮 → `AccountsView` 里绑定的 `refreshAll()` 被执行（`src/lib/store.ts:66`）。
2. `refreshAll` 调 `api.refreshAll()`，它就是一行 `invoke<AccountView[]>("refresh_all")`（`src/lib/api.ts:35`）——递菜窗口喊：「refresh_all！」
3. Rust 侧收到，找到贴了 `#[tauri::command]` 标签的 `refresh_all` 函数（`src-tauri/src/commands.rs`）。
4. 它遍历每个账户，按账户的「余额策略」调 `providers.rs::fetch_balance`：DeepSeek 走官方余额接口、小米走 Cookie、阿里云走 AccessKey 签名……
5. 结果写进共享状态 `AppState.statuses`（一把锁保护的白板），再追加一条余额历史。
6. 后端喊一嗓子 `emit("accounts-updated")`。
7. 前端 `useAccounts`（`src/lib/store.ts:57`）一直在听这个广播，听到后重新拉最新数据 → 界面自动重画。

**一句话总结数据流：后端是状态源，前端靠事件同步。** 前端自己不保存「真相」，每次都是问后端要。

→ 下一步：从旅程第 1 步开始拆，先看前端长什么样，见第 4 部分。

---

# 板块二 · 走主线：跟着一次「刷新余额」走一遍

## 第 4 部分 前端骨架：App.tsx 与状态管理

**这节回答：界面怎么组织？四个页面怎么切换？**

### 4.1 App.tsx —— 总壳

`src/App.tsx` 一共干三件事：

1. **记住当前在哪个页面**：`const [view, setView] = useState("accounts")`，点侧边栏按钮就 `setView("models")`。
2. **按 view 渲染对应页面**（React 的条件渲染写法 `{view === "x" ? <页面/> : null}`）。
3. **订阅两个事件**：`focus-account`（从托盘点进某个账户时，打开它的编辑面板）和 `recharge-detected`（后端检测到「疑似充值」时，弹一条提示）。

没有任何路由库——**四个页面就是一个字符串变量的切换**，这是它极简的原因。

### 4.2 store.ts —— 手写的迷你状态管理

- `useAccounts()`：封装「拉账户列表 + 听 accounts-updated 广播自动重拉 + 手动刷新单个/全部」。
- `useToasts()`：全局小通知（右上角弹的提示条），3 秒自动消失、错误 6 秒。
- `useSettings()`：读/存设置。

没有引入 redux/zustand 之类的库，因为数据流足够简单：**所有数据都以后端为准，前端只做「问 + 听」**。

→ 下一步：前端怎么「问」后端？看传话筒，见第 5 部分。

## 第 5 部分 传话筒：api.ts 与 types.ts

**这节回答：前端的一句 invoke 是怎么变成后端的一次执行的？两边怎么对齐字段？**

### 5.1 api.ts —— 唯一的前后端边界

前端任何地方需要后端，都必须经过 `src/lib/api.ts`。它就是 30 个命令的名字清单：

```ts
listAccounts: () => invoke<AccountView[]>("list_accounts"),
refreshAll:   () => invoke<AccountView[]>("refresh_all"),
saveAccount:  (input: AccountInput) => invoke<AccountView>("save_account", { input }),
```

读法：「调后端的 list_accounts 命令，返回值是一组 AccountView」。**想找「前端能干什么」，看这一个文件就够了。**

另外 `events` 对象集中了 3 个广播：`accounts-updated`（账户变了）、`recharge-detected`（疑似充值）、`focus-account`（托盘定位到某账户）。

### 5.2 types.ts —— 两边的「合同」

`invoke` 跨语言时传的是 JSON。`types.ts` 里的每个 interface 必须和 Rust 端结构体的字段**一字不差**（Rust 侧用 `#[serde(rename_all = "camelCase")]` 把自己的 snake_case 自动转成前端的 camelCase）。所以改字段时要两边同步改——这是本项目少数需要「人肉保持一致」的地方。

→ 下一步：传话筒的另一头是什么？看后端大门，见第 6 部分。

## 第 6 部分 后端大门：lib.rs 与 commands.rs

**这节回答：Rust 侧怎么接收命令？所有模块共享的数据放在哪？**

### 6.1 lib.rs —— 启动流程（105 行，建议第一个读）

启动时按顺序做四件事：

1. 建共享状态 `AppState`（下面细讲）；
2. 装系统托盘（`tray::setup`）；
3. 启动**后台值班员**（`refresh::spawn` 定时刷新余额、`ladder::spawn` 每小时更新天梯）；
4. `generate_handler![...]` 注册全部 30 个命令——**没注册的函数前端调不到**。

另外有一处窗口行为：点关闭按钮时如果设置里开了「关闭到托盘」，就隐藏窗口而不是退出。

### 6.2 AppState —— 后厨的公告板

`commands.rs:22` 定义的 `AppState` 是整个后端的公共白板，所有模块共享：

```rust
pub struct AppState {
    pub config: Mutex<AppConfig>,            // 账户与设置（内存里的最新版）
    pub statuses: Mutex<HashMap<..>>,        // 每个账户的最新查询结果
    pub history: Mutex<HistoryStore>,        // 余额历史
    pub catalog: Vec<CatalogEntry>,          // 内置模型资料库（只读）
    pub overrides: Mutex<Vec<CatalogEntry>>, // 用户本机改过的资料
    pub http: reqwest::Client,               // 一个复用的网络客户端
    ...
}
```

为什么都包 `Mutex`？因为 Rust 是多线程的，后台刷新任务和前端命令可能**同时**读改同一份数据。`Mutex` 就是「板擦只有一块，谁拿到锁谁才能写」，防止写花。

一个值得注意的细节（`commands.rs:51`）：创建 http 客户端时会**探测 Windows 系统代理**并挂上。因为网络库默认不读系统代理，挂了 Clash 的用户会直连失败——这是国内软件的必修课。

→ 下一步：命令收到后，最常打交道的就是那批 AI 平台——看它们怎么被统一管理，见第 7 部分。

## 第 7 部分 供应商登记表：providers.rs

**这节回答：11 个 AI 平台的差异，为什么能用一张表管住？余额的 6 种拿法分别是什么？**

### 7.1 一张表管所有平台

每个 AI 平台的全部「性格」都写在一张静态登记表里（`DEFS`，`providers.rs:176`）：

```rust
ProviderDef {
    id: "deepseek",
    name: "DeepSeek 开放平台",
    default_base_url: "https://api.deepseek.com",
    models_path: "/models",            // 拉模型列表的地址
    balance: BalanceProbe::DeepSeek,   // 余额用哪种探测方式（关键！）
    balance_path: "/user/balance",
    recharge_url: "https://platform.deepseek.com/top_up",   // 充值入口
    pricing_url: "...", docs_url: "...",
    key_hint: "sk-…（DeepSeek 控制台 → API keys）",          // 界面上的 Key 填写提示
}
```

**加一个供应商 = 往数组里加一条登记**，界面下拉框、提示文案、跳转链接全自动长出来。

### 7.2 界面只显示 6 个平台的秘密

```rust
const HIDDEN: [&str; 5] = ["dashscope", "siliconflow", "openai", "anthropic", "gemini"];
```

代码里其实定义了 11 个平台，其中 5 个被这个名单隐藏（逻辑路径保留）。**想加回来，把 id 从数组里删掉即可**——这是文档里强调过的开关。

### 7.3 余额查询的 6 种策略（match 分发）

`fetch_balance`（`providers.rs:535`）按 `BalanceProbe` 枚举分发，每种平台一种拿余额的方式：

| 策略 | 平台 | 做法 |
|---|---|---|
| 官方余额 API | DeepSeek / Kimi / 硅基流动 | Bearer Token 调官方接口 |
| 隐藏报表接口 | 智谱 GLM | 官方没文档但实测可用；**注意它鉴权失败也返回 HTTP 200**，必须看返回里的 `success` 字段判断真假 |
| 云账单接口 | 阿里云百炼 | 用 AccessKey 走阿里云 BSS，HMAC-SHA1 官方签名（`aliyun.rs`） |
| 控制台 Cookie | 小米 MiMo（按量/订阅） | 官方没有余额 API，用登录 Cookie 调控制台接口（`mimo.rs`） |
| 自定义 | 任何平台 | 用户填 URL + 请求头 + JSONPath，`custom.rs` 自动发现金额字段 |
| 不支持 | OpenAI / Claude / Gemini / ChatGPT | 明确说明原因，引导「手动余额」或订阅入口 |

**设计原则：任何平台都要能退化到「手动余额」参与低余额提醒**——供应商接口挂了也不能让提醒功能失效。

→ 下一步：查询要用到密钥，密钥存在哪、怎么保证安全？见第 8 部分。

## 第 8 部分 密钥保险箱：secrets.rs 与 connections.rs

**这节回答：API Key、Cookie 这些秘密存在哪？为什么连前端都拿不到？**

### 8.1 保险柜模型

`secrets.rs` 是**唯一**允许接触密钥的模块。它把密钥存进 Windows 系统自带的「凭据管理器」（控制面板里能看到的那个）：

- 服务名 `Quota` = 柜子编号；账户 UUID = 保险箱编号；
- 一个账户的所有秘密（API Key、管理员密钥、AccessKey 对、小米 Cookie、订阅账户）打包成**一个 JSON 字符串**存进同一个箱子（`SecretBlob` 结构）；
- 兼容旧版：旧服务名 `AgentPrice` 只读不删，读到就复印到新柜子（`secrets.rs:46`）；旧格式存的裸 Key 会自动当作 API Key 解析。

密钥**永不**写进 `config.json`、日志或前端——这是全项目最重要的纪律。

### 8.2 小米登录：隔离窗口（connections.rs）

小米没有 API Key 查余额的接口，只能用浏览器 Cookie。做法：

1. `start_mimo_login` 开一个**独立的登录窗口**（无痕模式），只放行小米域名；这个窗口里的网页**没有任何 Quota 权限**。
2. 你在窗口里正常登录小米账号。
3. 点「完成连接」→ 后端从窗口取 Cookie → 先验证一次可用 → 写进凭据管理器 → **前端只拿到一个随机 UUID**。真正的 Cookie 从头到尾不经过前端。
4. 保存账户时，后端用这个 UUID 把 Cookie「搬」到正式账户名下，然后销毁暂存。

### 8.3 ChatGPT 订阅：借本机 Codex 的登录态（subscription.rs）

ChatGPT 订阅没有 API，但有官方的额度端点。本项目**不复制、不刷新 Codex 的 token**：读取本机 Codex CLI 的登录缓存（也在凭据管理器里），借用它的 access_token 调一次官方额度接口，拿到「5 小时窗口 / 每周窗口」的用量百分比。token 用完即弃，不落盘。

→ 下一步：余额查到了存哪、怎么画出趋势和预测？见第 9 部分。

## 第 9 部分 账本：storage.rs 与 history.rs

**这节回答：数据落在哪些文件？断电会坏吗？「还能用几天」是怎么算出来的？**

### 9.1 存储就是几个 JSON 文件

数据全在 `%APPDATA%\Quota\` 下：

| 文件 | 内容 |
|---|---|
| `config.json` | 账户列表 + 设置（无密钥） |
| `catalog_overrides.json` | 用户在模型库里「采用」的价格覆盖 |
| `hidden_models.json` | 手动隐藏的模型 id |
| `balance_history.json` | 余额历史 |
| `ladder_cache.json` | 天梯缓存 |

两个值得学的细节：

- **原子写入**（`storage.rs:97`）：先写 `xxx.json.tmp` 草稿，成功后「改名」顶替正式文件。写到一半断电也不会损坏正式数据——改名在操作系统层是原子操作。
- **旧版迁移**（`storage.rs:19`）：启动时逐个检查旧目录 `AgentPrice` 里的文件，缺哪个复印哪个；已存在的绝不覆盖，旧目录永不删除。这样迁移到一半失败也不会毁数据。

### 9.2 history.rs —— 余额的「体检报告」

每次刷新成功就记一条（时间， 余额）。基于这条曲线算三件事：

- **趋势**：取最近 7 天样本拟合日均消耗（样本不足就「不猜」，返回空）；
- **还能用几天**：当前余额 ÷ 日均消耗，附在低余额通知里（「按当前消耗速度约 X 天后用完」）；
- **充值检测**：余额比上一条**上涨超过 max(5 元, 15%)** 判为疑似充值——宁可漏报不误报——事件广播给前端弹提示。

另有防膨胀设计：5 分钟内的连续记录合并、最多存 90 天 / 2000 条、给前端的曲线最多抽 120 个点。

→ 主线到此走完。下面是几条支线：后台值班、模型库、天梯、备份，可以按需跳读。

---

# 板块三 · 看支线

## 第 10 部分 自动化值班：refresh.rs 与 tray.rs

**这节回答：关着窗口它怎么自动刷新？通知为什么不会轰炸？托盘红点哪来的？**

### 10.1 refresh.rs —— 定时刷新 + 通知

`spawn` 就是「请个值班员」：启动后等 3 秒（不跟首屏抢资源），进入死循环——按设置间隔全量刷新 → 广播事件 → 更新托盘 → 给低余额账户发**系统通知**。

通知有两个克制的设计：

- **同一账户 6 小时内只提醒一次**（`low_notified` 时间戳表去重），不轰炸；
- 刷新**失败时保留上一次的成功数据**（`preserve_snapshot`，`commands.rs:479`），界面只标错误不清空——不会闪空白。

### 10.2 tray.rs —— 红点是代码画出来的

托盘图标右上角的红点角标没有用任何图片资源：直接取出默认图标的像素数组，在右上角圆形区域内把像素改红、外加一圈白边，再设回托盘（`tray.rs:71`）。有余额不足账户时才画，数值归零就换回原图标。

## 第 11 部分 模型库与价格纪律：catalog.rs 与 pricing.rs

**这节回答：「不猜价格」这条纪律，在代码里是怎么落实的？**

### 11.1 两层数据

- **内置资料库**：`src-tauri/data/model_catalog.json`，编译时打进程序（离线也能看），人工维护、台账在 `docs/model-catalog.md`；
- **本机覆盖**：`catalog_overrides.json`，你「采用」的价格写在这里，读取时覆盖内置值。

`model_cards` 命令把两层合并后返回给前端。

### 11.2 置信度三档

每张模型卡片的价格标三档：**high**（已核实，带来源链接 + 核实时间）/ **medium**（有价但未核实）/ **none**（显示「待核实」）。**官网查不到一律写 unknown，绝不编数字**——这是价格纪律在代码里的落点。

### 11.3 「抓取只产候选，采用才写入」

`pricing.rs::scan_pricing_page` 会去抓官方定价页，启发式抽出价格**候选**。但候选只是候选：必须你在界面上手动点「采用」，才写进 `catalog_overrides.json` 并刷新核实日期。流程上杜绝「爬到什么就信什么」。

## 第 12 部分 AI 天梯：ladder.rs

**这节回答：排名哪来的？为什么它和价格要严格分开管？**

排名数据来自 AITier（第三方评测），**价格只允许用厂商官方标准档**——两者严格分离。

### 12.1 怎么拿到排名（最「黑客」的一段代码）

AITier 是个 Next.js 网站，没有公开 API。`parse_rankings`（`ladder.rs:91`）的做法：

1. 抓整页 HTML；
2. Next.js 会把数据塞在一串 `self.__next_f.push(...)` 的脚本调用里——把每段里的 JSON 字符串抠出来拼接；
3. 在拼出的数据流里递归找包含 `initialRankings` 的对象，提取每个模型的排名/分数。

配套的防御：响应超过 12MB 就认为「数据格式已变化」并放弃；解析不到就报「继续显示上次数据」；24 小时 TTL 内不重复抓；用 `ladder_refreshing` 标志防止两个人同时刷新。

### 12.2 价格候选与「采用」

每次更新天梯时，并发给每个模型的**原厂定价页**跑一遍 `scan_pricing_page`，产出候选价格存在 `candidate` 字段里——同样要人工「采用」才生效。天梯页面上显示的已核实价格可以反向写回模型库（`adopt_ladder_price`），两处数据保持一致。

## 第 13 部分 加密备份：backup.rs

**这节回答：备份文件怎么保证只有你的密码能打开？**

导出的备份文件 = 明文 JSON 头（魔数 `QuotaBackup` + 版本 + 盐 + 随机数）+ AES-256-GCM 密文。要点：

- **钥匙从密码「搅」出来**：PBKDF2-HMAC-SHA256 迭代 **60 万次**（OWASP 2023 建议下限）。类比：把你的密码和一撮随机盐放进搅拌机搅 60 万圈，出来的才是真钥匙；密码本身不存档、不进日志。
- AES-256-GCM 自带完整性校验：密码错一位或文件被篡改，解密直接失败，报「密码错误或文件已损坏」。
- 备份内容包含配置 + 模型资料 + **全部密钥**（从凭据管理器里读出来加密打包），所以备份文件本身等同于密码保护的全部身家。

---

# 板块四 · 动手

## 第 14 部分 验收命令与练习路径

**这节回答：改完代码怎么自证没改坏？第一个练手改什么？**

改代码后的固定验收（详见 AGENTS.md）：

```bash
npm run typecheck              # 前端类型检查
npm run build                  # 前端构建
cd src-tauri && cargo check    # Rust 类型检查
node scripts/verify-logic.cjs  # 纯逻辑自检 7 项（含阿里云官方签名基准）
```

本机跑不了 `cargo test`（Windows GNU 工具链的已知问题），要真跑 Rust 逻辑就写 / 跑 `src-tauri/examples/` 下的例子，如 `cargo run --release --example zhipu_parse`。

**建议的练习路径**（由易到难，每步都只碰一个概念）：

1. 把某个隐藏平台加回界面：从 `HIDDEN` 数组删掉一个 id（如 `siliconflow`），跑 `npm run tauri dev` 看下拉框变化。——练「改登记表」
2. 改一句界面文案：`App.tsx` 里侧边栏的副标题。——练「改前端」
3. 给低余额通知改个措辞：`refresh.rs` 的 `body(format!(...))`。——练「改 Rust」
4. 加一个设置项：`model.rs` 的 `Settings` 结构 + `types.ts` 同步 + `SettingsView.tsx` 加控件。——练「两边同步」

---

# 附录 · 术语小词典

读正文卡住时回来查：

| 术语 | 一句话解释 |
|---|---|
| invoke | 前端→后端的函数调用（Tauri 的「传菜窗口」） |
| event / emit | 后端→前端的广播 |
| serde | Rust 的序列化框架，负责 Rust 结构 ↔ JSON 互转 |
| Mutex / lock | 上锁的共享数据 / 获取锁（同一时刻只有一个人能动它） |
| Option / Result / ? | Rust 表示「可能没有 / 可能失败 / 失败就上交」的三件套 |
| reqwest | Rust 的 HTTP 客户端库（派出去跑腿的快递员） |
| TTL | 数据保质期，过期才重新抓 |
| UUID | 随机唯一编号（账户 id、暂存连接 id 都用它） |
| JSONPath | 在 JSON 里按路径找值的迷你查询语言（自定义余额接口用） |
| WebView2 | Windows 系统自带的浏览器内核，Tauri 用它显示前端页面 |
| PBKDF2 | 把「密码+盐」反复哈希 N 次派生密钥的算法，防暴力破解 |
| AES-256-GCM | 带完整性校验的对称加密，备份文件用它 |
| RSC 流 | Next.js 服务端渲染时埋在 HTML 里的数据流（天梯解析的目标） |
| 凭据管理器 | Windows 系统级密码保险柜（控制面板 → 凭据管理器） |
| AppState | 后端所有模块共享的「公告板」，改动都要先拿锁 |
| 原子写入 | 先写临时文件再改名顶替，保证断电也不损坏正式数据 |
