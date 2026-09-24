# AgentPrice · 模型账户管家

一个 Windows 桌面小工具，用来集中管理你在大模型平台上的**账户余额**、**可用模型简介**和**一键充值入口**。

技术栈：Tauri 2（Rust）+ React 18 + TypeScript + Vite。安装包小、常驻内存低，界面为苹果简约风格（浅色中性底、毛玻璃、大圆角、系统蓝点缀，跟随系统深色模式）。

---

## 一、已确认的需求

| 项目 | 结论 |
| --- | --- |
| 形态 | 桌面软件（Tauri，安装包 ~5–10 MB） |
| 主界面 | 账户总览 / 模型库 / 设置 三个页面 |
| 常驻形态 | 主窗口 + 系统托盘；左键点托盘图标弹出「余额悬浮卡」，点击别处自动收起 |
| 账户模型 | 同一供应商可添加多个账户（个人号 / 团队号分开管） |
| 密钥存储 | Windows 凭据管理器（服务名 `AgentPrice`），不写明文、不上传 |
| 余额刷新 | 后台按间隔自动刷新（默认 30 分钟，可设 10 分钟 – 24 小时） |
| 提醒 | 余额低于该账户阈值时发 Windows 系统通知，同一账户 6 小时内只提醒一次 |
| 一键充值 | 在默认浏览器打开该账户的**官方充值/账单页**（链接可自定义）。软件不接入支付流程、不代持资金 |
| 模型简介 | 名称、简介、上下文长度、输入/输出价格、能力标签；支持搜索与按供应商筛选 |
| 资料库来源 | 内置资料库（已核实条目 + 参考资料）+ 用户本地编辑覆盖 |
| 其他余额方式 | 没有余额接口的平台，用「自定义余额接口」或云厂商账单接口（阿里云 AccessKey）补齐余额 |
| 价格比对 | 按模型把本地资料库 / 官方定价页抓取 / 第三方参考价摆在一起，并给出价格可信度 |

---

## 二、核心功能

### 1. 账户总览
- 每个账户一张卡片：余额大数字、分项余额（充值余额 / 赠送余额 / 代金券）、状态徽标（正常 / 余额不足 / 待查询）。
- 卡片底部：最近更新时间、可用模型数量、`模型` / `刷新` / `编辑` / `充值` 四个操作。
- 顶部横幅集中提示所有低余额账户。
- **添加 / 编辑表单只留四个必填**：平台、账户名称、API Key、余额获取方式；顶部有三步教程和「API Key 在哪拿？」链接。
  Base URL、充值页链接、阈值、手动余额、备注这些都收在「高级设置」折叠里，默认不用管。

### 2. 一键充值
点卡片上的「充值」，用系统默认浏览器打开该账户的官方充值页：DeepSeek 充值页、Kimi 控制台账户页、智谱财务页、阿里云百炼账单页、硅基流动财务页、OpenAI/Anthropic/Google 账单页等。每个账户都能在「编辑」里把链接改成任意自定义页面。

### 3. 模型库（一行一个模型，只做四件事）

每行：供应商 logo + 模型名（下面是型号 id）+ 输入 / 输出价格（每 1M tokens），右边三个按钮。

| 你要做的事 | 怎么做 |
| --- | --- |
| 刷新最新的模型列表 | 点左上角「刷新模型列表」，会拉各账户的 `/models` 并更新价格 |
| 一键复制调用 API | 每行的复制按钮，复制出可直接粘贴运行的 cURL 示例（含该账户的 API Key，注意别外传） |
| 查看对应价格 | 每行直接显示输入价 / 输出价；没有收录价格的显示「未收录价格，点比价查官方定价页」 |
| 比较各个模型的价格 | 切到「价格对比」视图：按「输入 + 输出」合计从便宜到贵排列，条形长度表示相对价格高低 |
| 隐藏过时模型 | 官方已下线或被新代际取代的模型（DeepSeek V3/R1、GLM-4 系列、GPT-4o/4.1、kimi-latest、moonshot-v1、qwen2、mimo-v2.5 对话档等历史 id）自动不出现；标记在 `data/model_catalog.json` 条目的 `hidden` 字段，想恢复某条把标记去掉即可 |
| 自己隐藏模型 | 每行最右的「闭眼」按钮把该模型从列表拿掉（记录存本机 `hidden_models.json`，重启仍在）；工具栏「显示已隐藏（N）」可以查看并一键恢复 |

价格对比里没有价格的模型排最后（不会被当成最便宜）。搜索框可以按模型名或型号过滤。

### 4. 比价（次要功能，用于核对价格可信度）
每行中间的「比价」按钮打开核对面板，把同一个模型的多个价格来源摆在一起：

| 来源 | 说明 |
| --- | --- |
| 本地资料库 | 内置/已核实/你编辑过的价格，带来源链接与核实时间 |
| 官方定价页（抓取） | 实时抓取该供应商的定价页，抽出价格相关原文片段与候选数值，可展开逐行核对 |
| 第三方参考价 | 可选，取自 OpenRouter 公开模型列表（需要联网），作为旁证 |

面板给出**可信度结论**（高 / 中 / 低 / 无）：来源越多、越一致、越已核实，可信度越高。任何来源都可以「采用」，
采用后写入本机资料库、记下来源链接并把核实时间刷新为当天。

### 5. 无法查询余额的供应商，怎么拿到余额
「官方接口」不是唯一路径，账户编辑面板里可以为每个平台选择获取方式：

- **自定义余额接口**：填任意能返回余额 JSON 的地址（自己控制台内部接口、中转站接口都行），可选 GET/POST、
  自定义请求头与请求体；JSON 路径留空会自动识别，也可以点「测试接口」把返回里所有数值字段列出来一键选用。
- **阿里云账单（百炼）**：百炼的费用从阿里云账户扣，填一对阿里云 AccessKey 后，软件用 BSS 接口
  `QueryAccountBalance` 读取阿里云账户可用额度（建议用只授予 `bss:DescribeAcccount` 只读权限的 RAM 子账号）。
- **手动余额**：所有平台都能用，同样参与低余额提醒。

发现路径 / 密钥对都只存在本机：AccessKey 与 API Key 一样写进 Windows 凭据管理器。

### 6. 设置
自动刷新开关与间隔、低余额通知开关、新增账户默认阈值、关闭主窗口时最小化到托盘、恢复内置模型资料、查看配置目录、版本信息。

---

## 三、支持的供应商与查询能力

| 供应商 | 余额查询 | 模型列表 | 备注 |
| --- | --- | --- | --- |
| DeepSeek 开放平台 | ✅ `GET /user/balance` | ✅ | 可区分充值余额 / 赠送余额、是否可调用 |
| Kimi 开放平台（Moonshot） | ✅ `GET /v1/users/me/balance` | ✅ | 可用余额 / 现金 / 代金券 |
| 智谱 GLM（BigModel） | ⚠️ 账户报表接口（官方文档未收录，实测可用） | ✅ | 读可用余额 / 累计充值 / 累计消费；接口变动时改用自定义接口或手动余额 |
| 小米 MiMo 开放平台 | ⚠️ 控制台 Cookie（余额 / 本月用量） | ✅ `GET /v1/models` | 官方无查询 API，用浏览器小米账号 Cookie 查 cashBalance 等 |
| 小米 MiMo 订阅（Token Plan） | ⚠️ 控制台 Cookie（套餐余量 / 本月用量） | ✅ | `tp-…` 密钥走 `token-plan-cn.xiaomimimo.com/v1`；卡片上有订阅操作按钮 |
| ChatGPT 订阅（OpenAI 官方） | ❌ 包月无余额 | ❌ 网页订阅，无接口 | 不需要 API Key、不用填 Base URL；卡片上有「订阅设置 / 定价 / 帮助」一键跳转 |

> 下拉里只保留上面 6 个（百炼、硅基流动、OpenAI、Anthropic、Gemini 已从界面隐藏，
> 代码路径保留）。想加回来：编辑 `src-tauri/src/providers.rs` 里的 `HIDDEN` 数组。

**设计原则**：任何一家的接口变动都不会让软件不可用 —— 查询失败时卡片会显示可读的错误原因（401 / 404 / 超时等）与重试、打开官网、改用手动余额三个动作。**手动余额**对所有供应商都可用，同样参与低余额提醒。

### 智谱与小米 MiMo 的余额说明

- **智谱**：官方文档没有收录余额查询接口，但 `open.bigmodel.cn` 的账户报表接口实测可用
  （`GET /api/biz/account/query-customer-account-report`，`Authorization: Bearer <API Key>`，
  返回 `data.availableBalance` 为可用余额，另有累计充值 / 累计消费 / 赠送 / 冻结）。
  已内置为「官方接口」方式；注意该接口鉴权失败也返回 HTTP 200，软件靠 `success` 字段判断成败。
  财务页在 `open.bigmodel.cn/finance/overview`。接口若改版，改用「自定义余额接口」或「手动余额」。
- **小米 MiMo 的模型与价格**：官方 OpenAI 兼容地址 `https://api.xiaomimimo.com/v1`（`GET /v1/models` 可用）；
  在售模型 `mimo-v2.6-pro`、`mimo-v2.6-flash`、`mimo-v2.6-pro-ultraspeed`（另有 ASR / TTS 档位），
  官方公告 `mimo-v2.5-pro` 与 `mimo-v2.5` 将于 2026-10-21 停用。价格（国内站人民币 / 每百万 tokens，
  取缓存未命中标准档）：Pro ¥3 / ¥6，Flash ¥1 / ¥2，极速版 ¥30 / ¥60，已标「已核实」，
  来源 https://mimo.mi.com/docs/price/pay-as-you-go 。
- **小米 MiMo / MiMo 订阅的余额与额度**：官方文档没有任何余额或用量查询 API（见 `mimo.mi.com/llms.txt` 的接口索引），
  但控制台 `platform.xiaomimimo.com` 调的 `https://platform.xiaomimimo.com/api/v1/...` 可以直接查
  （社区已有同样做法：`github.com/w101723/xiaomimimo_token_usage_detection`），鉴权走**浏览器里的小米账号 Cookie**。
  账户编辑里选「控制台 Cookie」粘贴一次即可自动查：
  - **余额**：按量付费读 `cashBalance` / `giftBalance` / `frozenBalance`；订阅读套餐剩余 Credits。
  - **本月额度**：`tokenPlan/usage` 的 `monthUsage`（本月已用 / 本月额度）与套餐余量、补偿额度。
  - Cookie 过期时卡片会提示重新复制（F12 → Network → 任意请求 → 复制整行 `Cookie: …`）。
  账户卡片上的**订阅操作**按钮（套餐管理 / 购买 · 续订 / 本月用量 / 余额明细 / 充值）只做跳转，
  充值与订阅都在官方控制台完成——软件不接入支付。
  接口若改版，改用「自定义余额接口」或「手动余额」。

---

## 四、开发与构建

前置：Node.js 18+、Rust（本项目在 Windows 上使用 GNU 工具链，无需 Visual Studio）、WebView2 运行时（Win10/11 通常已自带）。

```bash
npm install                 # 安装前端依赖
npm run tauri dev           # 开发模式（热重载）
npm run tauri build         # 打包：生成 exe 与 NSIS 安装包
npm run tauri build -- --no-bundle   # 只生成可执行文件，不打包安装程序
```

产物位置：`src-tauri/target/release/agentprice.exe`，安装包在 `src-tauri/target/release/bundle/nsis/`。

前端单独校验：`npm run typecheck`、`npm run build`。

### 纯逻辑自检（在本机比 cargo test 更可靠）

本机用 GNU 工具链，`cargo test` 生成的测试可执行文件会去加载 WinRT 的 API-set DLL
（`api-ms-win-core-winrt-*`，来自 tauri-winrt-notification），在当前环境里加载失败
（`STATUS_ENTRYPOINT_NOT_FOUND`），所以单测虽然写在源码里，但在这台机器上跑不起来。

签名算法与定价页解析这类纯逻辑改用一份等价的 JS 移植来核对，其中包含**阿里云官方文档给出的签名示例**
（期望值 `9NaGiOspFP5UPcwX8Iwt2YJXXuk=`），用来保证 `aliyun.rs` 的签名规则没写错：

```bash
node scripts/verify-logic.cjs      # 7/7 通过
```

`cargo check` 是照常可用的（只做类型检查、不生成可执行文件），改动后建议跑一次。

### 本机环境注意点（Windows + GNU 工具链）

本机没有 Visual Studio，因此使用 Rust 的 GNU 工具链（`stable-x86_64-pc-windows-gnu`），无需安装 MSVC：

- 工具链与 crate 源都走国内镜像：`~/.cargo/config.toml` 里配置了 rsproxy 的 sparse 源；安装工具链时用 `RUSTUP_DIST_SERVER=https://rsproxy.cn`。
- `~/.cargo/config.toml` 里显式指定了 rustup 自带的 MinGW 作为链接器。系统 PATH 里那个第三方 MinGW（GCC 8.1.0）会导致链接报错，不要用它。
- `Cargo.toml` 的 `crate-type` 只保留 `staticlib` 与 `rlib`：GNU 工具链下生成 `cdylib` 会因 DLL 导出序号过多而链接失败。
- 打包 NSIS 安装程序时，Tauri CLI 需要从 GitHub 下载 NSIS 与 nsis_tauri_utils.dll，国内直连会超时。带代理执行即可：
  ```bash
  HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 npm run tauri build
  ```

### 界面自检（无需启动桌面程序）

`scripts/mock-tauri.js` 是一份 Tauri API 桩数据（4 个示例账户 + 7 张模型卡片，含小米 MiMo 与智谱 GLM）。
`scripts/preview-server.cjs` 是配套的静态服务器，用它可以在浏览器里直接渲染真实界面，方便调样式：

```bash
npm run build
rm -rf dist-mock && mkdir -p dist-mock && cp -r dist/assets dist-mock/
node -e "const fs=require('fs');const h=fs.readFileSync('dist/index.html','utf8');fs.writeFileSync('dist-mock/index.html',h.replace('<head>','<head><script>'+fs.readFileSync('scripts/mock-tauri.js','utf8')+'</script>'))"
node scripts/preview-server.cjs 4174
```

- 主面板：http://127.0.0.1:4174/
- 托盘悬浮卡：http://127.0.0.1:4174/?window=tray （建议把浏览器窗口调窄到 364px 宽，与真实悬浮卡一致）

### 目录结构

```
AgentPrice/
├── src/                       前端（React + TS）
│   ├── components/            AccountCard / AccountSheet / ModelRow / ModelEditModal /
│   │                          PriceCompareModal / TrayPopup / ui / icons / logos
│   ├── views/                 AccountsView / ModelsView / SettingsView
│   ├── lib/                   api（invoke 封装）/ types / store（数据 hook + toast）/ format
│   ├── App.tsx                主窗口布局与路由
│   ├── main.tsx               按窗口标签分流（main → App，tray → TrayPopup）
│   └── styles.css             苹果风格设计系统
├── src-tauri/                 Rust 后端
│   ├── src/lib.rs             Builder 装配、关闭到托盘、悬浮卡失焦收起
│   ├── src/commands.rs        invoke 命令层 + 账户视图组装 + 查询编排 + 价格比对
│   ├── src/providers.rs       供应商元信息与余额/模型接口适配（HIDDEN 数组在第 393 行）
│   ├── src/aliyun.rs          阿里云 BSS 账单接口（HMAC-SHA1 签名）读账户余额
│   ├── src/custom.rs          自定义余额接口（GET/POST、请求头、自动识别金额字段）
│   ├── src/mimo.rs            小米 MiMo 控制台 Cookie 的余额 / 套餐用量解析
│   ├── src/proxy.rs           读取系统代理（国际平台查询走代理）
│   ├── src/pricing.rs         官方定价页抓取、第三方参考价、价格可信度打分
│   ├── src/catalog.rs         模型 id 归一化、模糊匹配、卡片生成与合并
│   ├── src/model.rs           CatalogEntry / RemoteModel 等数据结构
│   ├── src/storage.rs         config.json / catalog_overrides.json 读写
│   ├── src/secrets.rs         凭据管理器读写（API Key / 管理员密钥 / 云平台 AccessKey）
│   ├── src/refresh.rs         后台刷新循环与低余额通知
│   ├── src/tray.rs            托盘图标、菜单、自适应高度的悬浮卡窗口
│   ├── tauri.conf.json        窄口 1420、frontendDist ../dist、NSIS 打包、WebView2Loader.dll 资源
│   ├── WebView2Loader.dll     打包必须带上（见「打包注意」），仓库里保留一份
│   ├── data/model_catalog.json 内置模型资料库
│   ├── examples/              本机跑不了 cargo test，用 example 真跑解析与网络查询
│   └── capabilities/default.json 权限清单
└── scripts/                   verify-logic.cjs（纯逻辑自检）/ mock-tauri.js / preview-server.cjs /
                               check-install.ps1 / make_icon.py / make-logos.cjs /
                               add-glm-catalog.cjs / trim-catalog.cjs
```

数据位置：`%APPDATA%\AgentPrice\config.json`（账户与设置）、`%APPDATA%\AgentPrice\catalog_overrides.json`（模型资料本地修改）、`%APPDATA%\AgentPrice\hidden_models.json`（模型库里手动隐藏的模型）。API Key 只在凭据管理器里。

打包产物（`target/` 不入库，执行上面的打包命令重新生成）：
- 便携版（免安装，双击即用）：`src-tauri/target/release/agentprice.exe`（约 4.8 MB）
- 安装包（NSIS，当前用户级安装）：`src-tauri/target/release/bundle/nsis/AgentPrice_0.1.0_x64-setup.exe`（约 1.8 MB）
- 本机当前安装的副本在 `%LOCALAPPDATA%\AgentPrice\`（agentprice.exe + WebView2Loader.dll + uninstall.exe）

重新打包（NSIS 工具链已缓存在 `%LOCALAPPDATA%\tauri\NSIS`，只有首次打包才需要代理下载）：

```bash
export PATH="$HOME/.rustup/toolchains/stable-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu/bin:$HOME/.cargo/bin:$PATH"
HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 npm run tauri build
```

打包前先退出正在运行的 agentprice.exe，避免文件被占用导致写入失败。

**打包注意**：`WebView2Loader.dll` 必须通过 `bundle.resources` 带进安装包（`src-tauri/tauri.conf.json` 已配置，
DLL 也放在 `src-tauri/` 下）。Tauri 的 NSIS 打包默认不会带这个 DLL，装出来的程序启动会报
`0xC0000135 (STATUS_DLL_NOT_FOUND)`，错误信息里提到 `api-ms-win-core-winrt-l1-1-0.dll` ——
那是因为 WebView2 的 COM 激活链路依赖它，而根因是缺了 `WebView2Loader.dll`。
便携版不受影响（`target/release` 里本来就有这个 DLL），所以判断标准是：便携版能跑、安装版起不来，就查这一项。

装完想确认安装版能启动，跑一下：

```bash
MSYS_NO_PATHCONV=1 powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/check-install.ps1
```

它会用 CreateProcess 启动安装目录里的 exe、确认 8 秒后仍存活再结束进程（避免用 bash 直接 exec 造成误判）。

---

## 五、模型价格数据的说明（重要）

2026 年的在售模型与价格变动很快，本项目的做法是**不猜价格**：

- 资料库中标注 `已核实` 的条目（当前为小米 MiMo V2.6 Pro / Flash / 极速版、DeepSeek V4.1 Flash / V4 Pro、
  Kimi K3 / K2.7 Code / K2.7 Code 高速版 / K2.6）来自官方定价页，字段含上下文、输入输出价格、计价单位与**核实时间**。
- 其他厂商只保留名称、家族简介与官方定价页链接，价格留空，卡片上显示「待核实」并给出「官网」按钮；
- 卡片上的「比价」是主要的交叉验证手段：抓官方定价页原文 + 可选的第三方参考价，一致才给「可信度高」。
  抓到的数值只作为候选，必须人工点「采用」才会写进本机资料库（并记为已核实、带上核实日期）。
- 任何卡片都可以在界面里直接编辑（简介、上下文、价格、能力标签、来源链接），修改保存在本机并优先生效；设置里可一键恢复内置资料。

---

## 六、已知限制与后续可做

- **无余额接口的平台**：小米 MiMo 只能走「自定义余额接口」或「手动余额」；百炼走阿里云 AccessKey 的账单接口；
  智谱用的是官方未收录的账户报表接口，若哪天失效改用自定义接口或手动余额即可。若某平台日后开放接口，
  只需在 `src-tauri/src/providers.rs` 里加一个 `BalanceProbe` 分支。
- **官方定价页抓取是启发式的**：定价页改版或前端渲染时可能抽不到价格，这时界面会提示并保留「打开定价页」按钮，
  抓到的原文片段也始终展示出来供人工核对 —— 不会用猜出来的数字覆盖任何东西。
- **第三方参考价**来自 OpenRouter 公开列表，需要联网且只作旁证；该平台的聚合价不等于官方直连价。
- **中转站余额**：目前按 one-api 风格账单接口探测；new-api 的 `/api/user/self` 需要站点访问令牌，未纳入（可用「自定义余额接口」自行接入）。
- **未做**：消费记录与趋势曲线、多设备云同步、开机自启（需求确认时未选）。这些都在现有数据结构上容易扩展。
- 国际平台（OpenAI / Anthropic / Gemini）在这类网络环境下访问需要系统代理，查询失败时错误提示会说明这一点。
