# AGENTS.md · Quota 编码代理指南

给在这个仓库里工作的 AI 编码代理（也适用于人类）。目标：改完代码能通过验证、不破坏打包、不写错价格。

---

## 1. 这是什么项目

Windows 桌面应用 Quota：本地优先地查看 AI 服务商余额、额度与用量，并保留模型资料与官方充值入口。

- 技术栈：Tauri 2（Rust）+ React 18 + TypeScript + Vite，界面为苹果简约风格。
- 三个页面：账户总览 / 模型库 / 设置；外加系统托盘悬浮卡（窗口 label `tray`，主窗口 label `main`）。
- 界面要求（用户明确要求，不要改回去）：
  - **极简表单**：添加/编辑账户只留 4 个必填项（平台、账户名称、API Key、余额获取方式），其余全部收进「高级设置」折叠。
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
- 定价页抓取是启发式的：抓到的数值只是候选，界面里必须人工点「采用」才写入本机资料库（`%APPDATA%\Quota\catalog_overrides.json`），采用时刷新核实日期。
- 同一模型多档价格（缓存命中/闲时/批量折扣）时，只取**标准档、非缓存命中**。
- 「比价」面板的可信度结论（高/中/低/无）由来源数量与一致性打分，逻辑在 `src-tauri/src/pricing.rs`。
- 模型取数的人工台账在 `docs/model-catalog.md`；改资料库前先看它的取数规则一节。

---

## 5. 代码结构速查

前端调用链：组件 → `src/lib/api.ts`（invoke 封装）→ `src-tauri/src/commands.rs`（命令层）→ `providers.rs` / `pricing.rs` / `storage.rs` / `secrets.rs` 等。

- 加一个 invoke 命令：`commands.rs` 写函数 → `lib.rs` 的 `generate_handler!` 注册 → `api.ts` 加封装 → 组件里调。
- 加一个供应商：`providers.rs` 的 `provider_defs()` 加定义（含余额探测与模型列表能力）；如默认隐藏，把 id 加进 `HIDDEN`。
- 供应商接口挂了怎么办：查询失败要显示可读错误 + 三个动作（重试 / 打开官网 / 改手动余额）。任何供应商都要能退化到「手动余额」参与低余额通知。
- 前端窗口分流在 `src/main.tsx`：label `tray` → `TrayPopup`，否则 → `App`。
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
6. 改了界面 → 用 preview-server 过一遍主面板和 364px 悬浮卡。

## 7. Git

仓库历史从本项目初始化开始。提交信息用中文、说清「改了什么 + 为什么」。`node_modules/`、`dist/`、`dist-mock/`、`src-tauri/target/`、`src-tauri/gen/`、`app-icon.png` 已在 `.gitignore`，不要试图提交它们；`WebView2Loader.dll` 要提交（打包需要）。
