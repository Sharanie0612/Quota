# AGENTS.md · Quota 编码代理指南

给在这个仓库里工作的 AI 编码代理（也适用于人类）。目标：改完代码能通过验证、不破坏打包、不写错价格。

---

## 1. 这是什么项目

Windows 桌面应用 Quota：本地优先地查看 AI 服务商余额、额度与用量，并保留模型资料与官方充值入口。

- 技术栈：Tauri 2（Rust）+ React 18 + TypeScript + Vite，界面为苹果简约风格。
- 五个页面：账户总览 / 模型库 / AI 模型天梯 / Token 活动 / 设置。主窗口 label `main`；托盘单击直接打开主窗口，不再提供悬浮卡。
- 界面要求（用户明确要求，不要改回去）：
  - **极简表单**：添加/编辑账户只展示平台、账户名称、连接信息、同步方式（账户名称可选；小米与 ChatGPT 使用连接按钮），其余全部收进「高级设置」折叠。
  - **配三步中文教程**：表单顶部要有三步流程说明和「API Key 在哪拿？」入口。
- 供应商范围：**只显示 6 个**——DeepSeek、Kimi、智谱 GLM、小米 MiMo（按量）、小米 MiMo 订阅、ChatGPT 订阅。
  隐藏名单硬编码在 `src-tauri/src/providers.rs` 的 `HIDDEN` 数组（约第 393 行），加回供应商 = 从数组里删掉对应 id。
- 安全红线：API Key / AccessKey / 管理密钥 / Cookie 只进 Windows 凭据管理器（新服务名 `Quota`），**不写明文、不进日志、不上传**；软件不接入支付，充值只跳官方页面。旧服务名仅用于兼容迁移。
- 当前自定义余额接口的请求头/请求体会写入 `config.json`；不要在这些字段填写密钥。改造该路径前，文档不能宣称任意自定义请求中的秘密都受凭据管理器保护。

---

## 2. 常用命令

```bash
npm install                 # 装前端依赖（只在依赖变更后需要）
npm run typecheck           # tsc --noEmit，改前端后必跑
npm run build               # vite build，产出 dist/
npm run tauri dev           # 开发模式（前端热重载，走 1420 端口）

cd src-tauri
cargo check                 # 类型检查 Rust（改动 Rust 后必跑；本机可用）

cd ..
node scripts/verify-logic.cjs        # 纯逻辑自检（签名/解析/定价页抽取），期望 7/7 通过
```

打包（NSIS 工具链首次需代理下载，之后已缓存）：

```bash
export PATH="$HOME/.rustup/toolchains/stable-x86_64-pc-windows-gnu/lib/rustlib/x86_64-pc-windows-gnu/bin:$HOME/.cargo/bin:$PATH"
HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897 npm run tauri build
```

打包前先退出正在运行的 quota.exe。产物：`src-tauri/target/release/quota.exe`（便携版）与 `src-tauri/target/release/bundle/nsis/*-setup.exe`（安装包）。

UI 样式自检（不开桌面程序，浏览器里看真实界面）：

```bash
npm run build
rm -rf dist-mock && mkdir -p dist-mock && cp -r dist/assets dist-mock/
node -e "const fs=require('fs');const h=fs.readFileSync('dist/index.html','utf8');fs.writeFileSync('dist-mock/index.html',h.replace('<head>','<head><script>'+fs.readFileSync('scripts/mock-tauri.js','utf8')+'</script>'))"
node scripts/preview-server.cjs 4174
# 主面板 http://127.0.0.1:4174/ ；悬浮卡 http://127.0.0.1:4174/?window=tray（浏览器调窄到 364px）
```

---

## 3. 本机环境的硬约束（Windows + GNU 工具链）

改 Rust 前必读，踩过坑：

1. **`cargo test` 在本机跑不起来**：测试可执行文件加载 WinRT API-set DLL 失败（`STATUS_ENTRYPOINT_NOT_FOUND`，来自 tauri-winrt-notification）。单测写在源码里没关系，但不要把它当验证手段。替代方案：
   - 纯逻辑改动 → `node scripts/verify-logic.cjs`（内含阿里云官方签名示例做基准）；
   - 需要真跑 Rust 逻辑 → 写/跑 `src-tauri/examples/` 下的 example（`cargo run --release --example <name>`，如 `hidden_check`、`zhipu_parse`、`mimo_models`）。
   - `cargo check` 正常可用，改完 Rust 必跑。
2. **工具链是 GNU 不是 MSVC**：没有 Visual Studio，用 `stable-x86_64-pc-windows-gnu`；crate 源走 rsproxy 镜像（`~/.cargo/config.toml`）。系统 PATH 里第三方 MinGW（GCC 8.1.0）会导致链接失败，不要用它。
3. **`Cargo.toml` 的 `crate-type` 只能是 `staticlib` + `rlib`**：GNU 工具链下生成 `cdylib` 会因 DLL 导出序号过多链接失败，别加回去。
4. **`src-tauri/WebView2Loader.dll` 必须存在且被 `tauri.conf.json` 的 `bundle.resources` 带进安装包**。症状识别：便携版能跑、安装版启动报 `0xC0000135`（提示里提到 `api-ms-win-core-winrt-l1-1-0.dll`）→ 就是这个 DLL 没进包。
5. 打包 NSIS 需要代理下载工具链（首次），命令见上一节。

---

## 4. 价格数据的纪律（最重要的一条）

**不猜价格。** 2026 年价格变动快，规则：

- 只有从官方定价页核实过的条目才标「已核实」，必须带来源链接与核实时间（字段在 `src-tauri/data/model_catalog.json`）。
- 官网查不到一律写 `unknown`，卡片显示「待核实」，绝不编数字。
- 模型库的普通启发式抓取只生成候选，人工「采用」后写入本机资料库（`%APPDATA%\Quota\catalog_overrides.json`）。天梯按用户明确授权，使用固定官网表头、单位、档位和精确型号的确定性解析器自动核实，不需人工采用；结构或语义不明确时不得猜数字。
- 同一模型多档价格时，以**标准档、非缓存命中**作为默认输入价；缓存命中、5 分钟缓存写入、1 小时缓存写入分别使用 `cachedInput`、`cacheWrite`、`cacheWriteLong`，无法核实留空，不混用闲时或批量折扣。
- 「比价」面板的可信度结论（高/中/低/无）由来源数量与一致性打分，逻辑在 `src-tauri/src/pricing.rs`。
- 模型取数的人工台账在 `docs/model-catalog.md`；改资料库前先看它的取数规则一节。

---

## 5. 代码结构速查

前端调用链：组件 → `src/lib/api.ts`（invoke 封装）→ `src-tauri/src/commands.rs`（命令层）→ `providers.rs` / `pricing.rs` / `storage.rs` / `secrets.rs` 等。

- 加一个 invoke 命令：`commands.rs` 写函数 → `lib.rs` 的 `generate_handler!` 注册 → `api.ts` 加封装 → 组件里调。
- 加一个供应商：`providers.rs` 的 `provider_defs()` 加定义（含余额探测与模型列表能力）；如默认隐藏，把 id 加进 `HIDDEN`。
- 供应商接口挂了怎么办：查询失败要显示可读错误 + 三个动作（重试 / 打开官网 / 改手动余额）。任何供应商都要能退化到「手动余额」参与低余额通知。
- 前端 `src/main.tsx` 统一渲染 `App`。小米官方登录窗口 `mimo-login` 不授予 Quota IPC 权限。
- 设计系统全在 `src/styles.css`（浅色中性底/毛玻璃/大圆角/系统蓝，跟随系统深色模式），新组件复用其中的 CSS 变量，不要引入新色值。
- 数据文件：`%APPDATA%\Quota\config.json`（账户+设置）、`catalog_overrides.json`（资料本地覆盖）、`hidden_models.json`（用户手动隐藏的模型）。首次启动逐个复制旧目录中缺失的文件；旧目录不删除。
- 为延续旧安装的升级关系，Tauri identifier `com.agentprice.desktop` 暂时保留（legacy compatibility）。更改它必须先验证安装器升级与卸载行为。

---

## 6. 改完的验收清单

按顺序跑，全绿再提交：

1. `npm run typecheck` — 无错误（注意 `noUnusedLocals`，别留未使用的导入/变量）。
2. `npm run build` — 成功产出 dist。
3. `cd src-tauri && cargo check` — 通过（既有 dead_code 警告可忽略，新增警告要处理）。
4. `node scripts/verify-logic.cjs` — 7/7 PASS。
5. 改了打包相关（tauri.conf.json、资源、图标）→ 实际 `npm run tauri build` 并用 `scripts/check-install.ps1` 验证安装版能启动。
6. 改了界面 → 用 preview-server 检查账户表单、模型天梯、设置，以及 1024px 最小主窗口宽度。

## 7. Git

仓库历史从本项目初始化开始。提交信息用中文、说清「改了什么 + 为什么」。`node_modules/`、`dist/`、`dist-mock/`、`src-tauri/target/`、`src-tauri/gen/`、`app-icon.png` 已在 `.gitignore`，不要试图提交它们；`WebView2Loader.dll` 要提交（打包需要）。

分支与工作树完整流程见 [Git 分支规范](docs/git-workflow.md)。编码代理必须遵守：

- `main` 为稳定集成分支；新任务使用 `codex/<类型>/<主题>`，类型为 `feat`、`fix`、`docs`、`chore`、`release` 或 `hotfix`。一个分支对应一个可独立验收的任务，不建立常驻 `develop` 分支。
- 开始前检查当前分支、工作树和未提交改动；同一目录有其他聊天或进程工作时，不切换分支、不 stash、不移动其改动。并行任务使用独立工作树。
- 创建分支引用不会保存未提交改动；新工作树默认以提交为基线，既有改动须先按任务范围保存或明确选择包含当前改动的流程，不能假定已被复制。
- 提交前只暂存本任务文件或代码块，检查暂存差异及凭据；不要使用 `git add .` 混入既有改动。按第 6 节完成适用验收，再通过 PR 合并到 `main`。
- 发布与紧急修复使用完整展示号，版本递增与标签遵守第 8 节；仅建立分支或修改流程文档不递增产品版本。不得强推共享分支或改写已发布标签。
- 文档中的远程分支保护是维护要求，不代表 GitHub 已配置；推送、创建 PR、合并、发布及删除分支按用户授权范围执行。

---

## 8. 版本规则（展示版本 A.B.FFBB）

展示号固定为 `A.B.FFBB`：A 表示系统级重构，B 表示大版本，FF 表示两位功能迭代，BB 表示两位 Bug 修复。A、B 为非负整数，FF、BB 为 `00`–`99`，展示时必须补足两位。

- 增加功能：FF + 1，BB 归零；同一发布包含功能和修复时也按功能版处理。
- 仅修 Bug：BB + 1，A、B、FF 不变。
- 提升 A：B、FF、BB 全部归零；提升 B：FF、BB 全部归零。
- FF 或 BB 已到 `99` 时不得生成三位字段，也不得自动把修复当作功能迭代；发布前明确下一版本级别。
- 纯文档、测试或构建维护不自动递增产品版本；需要发布时按实际产品变化确定版本级别。
- 每次发布只递增一次，以最近已发布版本为基准，不按提交次数累加。
- 产品界面、Git 标签、发布说明一律使用完整展示号，例如标签 `1.0.0101`；不得用包版本替代展示号。

### 版本映射

包版本将 FFBB 作为一个十进制整数，去掉前导零：`A.B.int(FFBB)`，等价于 `A.B.(100 × FF + BB)`。Python/PEP 440 使用此映射；本仓库 npm、Cargo、Tauri 的三段包版本也统一使用此映射，避免带前导零的版本造成工具链兼容问题。

| 发布类型 | 完整展示号 | 包版本（npm / Cargo / Tauri / Python） |
| --- | --- | --- |
| 初始版本 | `1.0.0000` | `1.0.0` |
| 功能版 | `1.0.0100` | `1.0.100` |
| 修复版 | `1.0.0101` | `1.0.101` |
| 双平台大版本 | `1.1.0000` | `1.1.0` |
| 新大版本下的功能版 | `1.1.0100` | `1.1.100` |
| 系统级重构 | `2.0.0000` | `2.0.0` |
| 2026-10-03 功能更新（本地构建待发布） | `1.0.0100` | `1.0.100` |
| 2026-10-04 用户要求的新功能迭代（本地构建待发布） | `1.0.0200` | `1.0.200` |
| 2026-10-04 天梯分表与 Token 图表迭代（本地构建待发布） | `1.0.0300` | `1.0.300` |
| 2026-10-04 官方 Logo 与配置保护修复（本地构建待发布） | `1.0.0301` | `1.0.301` |
| 2026-10-04 价格性能图与活动交互迭代（本地构建待发布） | `1.0.0400` | `1.0.400` |
| 2026-10-04 累计消费显示与记录修复（本地测试交付） | `1.0.0401` | `1.0.401` |
| 2026-10-04 天梯厂商配色辨识修复（本地测试交付） | `1.0.0402` | `1.0.402` |
| 2026-10-04 Token 模型搜索选择迭代（本地测试交付） | `1.0.0500` | `1.0.500` |
| 2026-10-04 设置数据导出（本地测试交付） | `1.0.0600` | `1.0.600` |
| 2026-10-04 天梯圆点与明亮配色修复（本地测试交付） | `1.0.0601` | `1.0.601` |
| 2026-10-04 启动刷新、天梯核实与统计合并（本地测试交付） | `1.0.0700` | `1.0.700` |
| 2026-10-05 十厂商官方价格自动核实与活动交互（本地测试交付） | `1.0.0800` | `1.0.800` |
| 2026-10-05 小米微信登录修复（本地安装包交付） | `1.0.0801` | `1.0.801` |
| 2026-10-05 小米登录复用与选择性迁移（本地安装包交付） | `1.0.0900` | `1.0.900` |
| 2026-10-06 采集频率、跨平台天梯与无凭据账户同步（Mac 本地安装包交付；Windows 待构建） | `1.0.1000` | `1.0.1000` |
| 2026-10-07 订阅百分比账户共享格式修复（本地修复构建） | `1.0.1001` | `1.0.1001` |
| 2026-10-07 天梯价格坐标修复与模型 Logo（Windows 本地安装包交付） | `1.0.1100` | `1.0.1100` |
| 2026-10-07 模型六维能力与 Token 活动交互迭代（Windows 本地构建） | `1.0.1200` | `1.0.1200` |
| 2026-10-07 用量概览视觉修复（Windows 本地构建） | `1.0.1201` | `1.0.1201` |
| 2026-10-07 用量概览层级与紧凑布局修复（Windows 本地构建） | `1.0.1202` | `1.0.1202` |
| 2026-10-07 用量概览等宽与选中标记修复（Windows 本地构建） | `1.0.1203` | `1.0.1203` |
| 2026-10-07 用量概览完整数字单行修复（Windows 本地构建） | `1.0.1204` | `1.0.1204` |
| 2026-10-07 小时趋势入口与天梯布局迭代（Windows 本地构建） | `1.0.1300` | `1.0.1300` |
| 2026-10-07 天梯坐标区间自适应修复（Windows 本地构建） | `1.0.1301` | `1.0.1301` |
| 2026-10-08 天梯时间筛选、推理档选择与紧凑缓存概览（Windows 本地安装包交付） | `1.0.1400` | `1.0.1400` |

历史包版本为 `0.1.0`，不映射为已发布的 `1.0.0000`。2026-10-03 本次功能更新首次采用展示号 `1.0.0100` → 包版本 `1.0.100`，状态为本地构建、待发布；上表示例不代表历史发布记录。后续发布记录必须追加保留。

### 发布同步与验收

1. 确定发布级别和展示号，更新「版本映射」表，写明本次实际发布的展示号与包版本。
2. 同步 `package.json`、`package-lock.json` 中根包版本、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock` 中 Quota 自身包版本，以及 `src-tauri/tauri.conf.json`；不要改动依赖包版本。
3. 产品界面从统一版本来源获取完整展示号。`commands.rs` 的 `app_info` 调用 `version::display_version()`，由 `CARGO_PKG_VERSION` 生成完整展示号，避免界面显示 `1.0.100`。
4. 核对展示号与包版本可相互映射、各配置一致，Git 标签和发布说明使用完整展示号；执行第 6 节适用的验收项目。变更 Tauri 打包版本时实际打包并验证安装器升级与安装版启动。

### 订阅与天梯维护

- 小米通过隔离的官方登录窗口连接，Cookie 仅在后端和 Windows 凭据管理器中流转。
- ChatGPT 显示订阅内 Codex 额度，显式连接本机 Codex 登录；固定官方额度端点，不复制或刷新 Codex token。不可将这些额度称为网页聊天额度。
- 天梯排名来源 AITier，价格仅用厂商官方标准档，分别列出缓存命中和未命中价格。`ladder.json` 为全厂商模型快照，`ladder_cache.json` 保存排名及待核实价格候选；自动每日检查可关闭。
- 天梯按用户授权自动读取十家厂商的确定性官方价格表，成功核实时更新 `ladder_cache.json`，保存来源、条件与时间；启发式候选不能自动采用。厂商失败或精确型号缺失时保留上次记录并显示原因；排名网站失败不阻断官方价格检查。模型库的人工采用仍写入 `catalog_overrides.json`。

- 启动自检可用 `QUOTA_DATA_DIR` 指定绝对路径的隔离配置目录，不迁移个人数据。安装升级流程须与安装包解包启动检查分别记录，不可混称。

### Token 活动维护

- `activity.rs` 只读 Codex JSONL 和智谱 ZCode SQLite，保存和同步指标，不保存对话、工具参数和凭据。
- 同步需用户在各设备选择同一个共享目录；不自动猜测云盘目的地。设备 UUID 独立，事件 ID 全局去重，复制日志的确定性设备归属需在文档说明。
- 累计 Token 按增量计算，缓存与推理为子项，不能叠加到总量。ZCode 多份迁移数据库及旧记录适配不能重复统计。
- 统计改动运行 `cargo run --release --example activity_checks`；历史范围、同步协议见 `docs/activity-stats.md`。

本地修复交付记录：2026-10-04 累计消费显示与记录补全，展示版本 `1.0.0401`，包版本 `1.0.401`；以已交付 1.0.0400 为基线，修复字段递增一次。
