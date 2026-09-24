# Quota 开源化重构任务说明

## 0. 任务背景

当前仓库：

- Repository: `Sharanie0612/Quota`
- 当前技术栈：
  - Tauri 2
  - Rust
  - React 18
  - TypeScript
  - Vite
- 当前项目已经具备：
  - AI 服务商账户管理
  - 余额查询
  - 部分套餐 / Usage 查询
  - 模型列表
  - 模型价格资料
  - 系统托盘
  - 自动刷新
  - 低余额提醒
  - Windows Credential Manager 凭据保存
  - 本地配置存储

项目之前内部名称为：

`AgentPrice`

现在正式对外名称确定为：

# Quota

定位：

> A lightweight local-first dashboard for AI provider balances, credits and quotas.

中文：

> 一个轻量、本地优先的 AI 服务商余额、额度与用量看板。

本次不是重写项目。

目标是在保持现有功能可用的前提下，将当前项目整理为一个结构清晰、适合 GitHub 开源的小型桌面应用。

---

# 1. 产品边界

Quota 的核心用途：

- 查看多个 AI 服务商账户余额
- 查看 Credits
- 查看套餐 Quota
- 查看 Usage
- 自动刷新
- 低余额 / 低额度提醒
- 快速跳转官方充值、账单、套餐页面
- 本地安全保存凭据

核心体验：

> 打开 Quota，几秒钟内知道自己的 AI 服务还剩多少。

Quota 可以支持不同类型的数据：

```text
DeepSeek
¥32.51

OpenRouter
$16.20

MiMo Coding Plan
68%

ChatGPT
5h quota  72%
Weekly    43%
```

## 明确不做

当前阶段不要把项目扩展成：

- AI 聊天客户端
- API Proxy
- 模型路由器
- OneAPI / NewAPI 替代品
- API Gateway
- 支付系统
- 完整财务管理系统
- 企业级 SaaS

保持“小而美”。

---

# 2. 第一阶段：AgentPrice → Quota 品牌统一

这是优先级最高的任务。

首先全仓库搜索：

```text
AgentPrice
agentprice
AGENTPRICE
模型账户管家
```

确认所有引用位置。

将用户可见品牌统一为：

```text
Quota
```

包括但不限于：

- App 名称
- 窗口标题
- README
- AGENTS.md
- package.json
- Tauri 配置
- 安装包名称
- EXE 名称
- UI 中显示的名称
- About / Version 信息
- 通知标题
- 托盘菜单
- 描述信息

package.json 建议改为：

```json
{
  "name": "quota",
  "description": "A lightweight local-first dashboard for AI provider balances and quotas."
}
```

应用程序最终希望呈现为：

```text
Quota
quota.exe
Quota_x.x.x_x64-setup.exe
```

---

# 3. 非常重要：旧数据和凭据不得丢失

当前项目已经使用：

```text
AgentPrice
```

作为部分本地目录或 Credential Manager Service Name。

不能简单全局替换后导致已有数据消失。

修改前必须检查：

- config.json 存储目录
- catalog_overrides.json
- hidden_models.json
- Credential Manager service name
- API Key
- Admin Key
- AccessKey
- Console Cookie
- Tauri app identifier
- Windows 安装信息

如果当前数据目录为：

```text
%APPDATA%\AgentPrice\
```

新目录计划为：

```text
%APPDATA%\Quota\
```

需要设计向后兼容迁移。

建议逻辑：

```text
启动 Quota
    ↓
检查 Quota 新目录
    ↓
如果不存在
    ↓
检查 AgentPrice 旧目录
    ↓
存在则迁移 / 复制旧数据
    ↓
验证新数据可正常读取
```

不要主动删除旧数据。

Credential Manager 同理：

```text
先读取 Quota
↓
没有
↓
尝试读取 AgentPrice
↓
读取成功
↓
写入 Quota
```

迁移成功前绝不能删除旧凭据。

这一项属于高风险修改。

必须单独检查和测试。

---

# 4. 第二阶段：README 重构

当前 README 内容较完整，但更接近：

> 开发记录 + 技术文档

需要改造成真正的 GitHub 项目首页。

目标：

README 第一屏让陌生用户快速知道：

1. Quota 是什么
2. 长什么样
3. 支持什么
4. 怎么安装

建议 README 结构：

```text
Logo
Quota
Tagline
项目简介
Screenshot

Features
Supported Providers
Installation / Download
Security
Development
Adding a Provider
Roadmap
License
```

README 顶部风格参考当前 `OneProcure`：

```html
<p align="center">
  <img src="./assets/icon.png" width="128" alt="Quota">
</p>

<h1 align="center">Quota</h1>

<p align="center">
  <strong>Your AI balances and quotas, at a glance.</strong>
</p>

<p align="center">
  一个轻量、本地优先的 AI 服务商余额与额度看板。
</p>

<p align="center">
  Windows · Tauri · Rust · React
</p>
```

如果当前仓库没有合适的：

```text
assets/icon.png
assets/readme/dashboard.png
```

不要引用不存在的文件。

可以先整理目录并保留实际存在的资源。

不要生成虚假的 UI 截图。

---

# 5. README 功能列表做减法

不要把 README 首页写成几十条功能。

建议首页只突出：

- 多服务商余额统一查看
- Balance / Credits / Quota / Usage
- 自动刷新
- 低余额提醒
- 系统托盘
- Local-first
- 凭据存储在系统 Credential Manager
- Provider 可扩展

详细技术说明移入 `docs/`。

---

# 6. README Provider 表

根据当前代码实际支持能力生成。

不要根据印象写。

必须从代码确认当前 Provider 和能力。

推荐格式：

```md
| Provider | Balance | Usage / Quota | Method |
|----------|---------|---------------|--------|
| DeepSeek | ✓ | — | API |
| Kimi | ✓ | — | API |
| GLM | ✓ | — | API |
| MiMo | ✓ | ✓ | Console |
| Alibaba Bailian | ✓ | — | BSS |
```

实际内容以代码为准。

不要宣称尚未实现的功能。

---

# 7. docs 拆分

将 README 中过于详细的开发说明迁移到：

```text
docs/
├── architecture.md
├── providers.md
├── security.md
├── development.md
├── build-windows.md
└── model-catalog.md
```

职责：

```text
README.md
给用户看。

AGENTS.md
给 AI / 开发代理看。

docs/
给开发者看。
```

不要简单复制形成重复文档。

README 应链接到 docs。

---

# 8. 第三阶段：Provider 架构整理

当前重点检查：

```text
src-tauri/src/providers.rs
```

目前这个文件承担过多职责，包括：

- Provider metadata
- Provider URL
- Balance Probe
- Models Probe
- Credential Hint
- Balance Mode
- Provider 特例
- API 请求

随着供应商增加会越来越难维护。

目标结构建议：

```text
src-tauri/src/
└── providers/
    ├── mod.rs
    ├── traits.rs
    ├── registry.rs
    ├── deepseek.rs
    ├── moonshot.rs
    ├── zhipu.rs
    ├── siliconflow.rs
    ├── dashscope.rs
    ├── mimo.rs
    ├── openai.rs
    └── custom.rs
```

注意：

这不是要求机械拆文件。

先分析当前依赖关系。

在不破坏功能的情况下逐步拆分。

优先目标：

> 一个 Provider 的修改尽量只影响自己的模块。

---

# 9. Provider Adapter

设计一个简单的 Provider Adapter。

不要设计复杂的动态插件系统。

Rust trait 即可。

设计方向：

```rust
#[async_trait]
pub trait ProviderAdapter {
    fn metadata(&self) -> ProviderMetadata;

    async fn fetch_metrics(
        &self,
        ctx: &ProviderContext,
    ) -> Result<Vec<QuotaMetric>, ProviderError>;
}
```

metadata 示例：

```rust
pub struct ProviderMetadata {
    pub id: &'static str,
    pub name: &'static str,
    pub website: &'static str,
    pub docs_url: &'static str,
    pub billing_url: &'static str,
}
```

registry 示例：

```rust
pub fn providers() -> Vec<Box<dyn ProviderAdapter>> {
    vec![
        Box::new(DeepSeek),
        Box::new(Moonshot),
        Box::new(Zhipu),
        Box::new(SiliconFlow),
    ]
}
```

目标：

以后增加 Provider 时：

```text
创建 provider 文件
↓
实现 Adapter
↓
registry 注册
↓
添加测试 / fixture
```

不要继续往一个巨大 match 里添加逻辑。

---

# 10. 第四阶段：从 Balance 抽象到 QuotaMetric

当前数据核心偏向：

```text
Balance
```

但 Quota 未来需要同时表达：

```text
现金余额
Credits
Quota
Usage
套餐剩余
滚动时间窗口
```

所以需要评估引入统一 Metric。

建议：

```rust
pub enum MetricKind {
    Balance,
    Credit,
    Quota,
    Usage,
}
```

核心模型：

```rust
pub struct QuotaMetric {
    pub kind: MetricKind,
    pub label: String,

    pub current: Option<f64>,
    pub total: Option<f64>,
    pub remaining: Option<f64>,

    pub unit: String,

    pub reset_at: Option<String>,

    pub source: MetricSource,
}
```

例子：

DeepSeek：

```text
kind = Balance
remaining = 32.51
unit = CNY
```

MiMo：

```text
kind = Quota
current = 320
total = 1000
remaining = 680
unit = requests
```

订阅：

```text
kind = Usage
current = 43
total = 100
unit = percent
reset_at = ...
```

---

# 11. 兼容现有 Balance 数据

不要一次性删除：

```text
Balance
BalanceAmount
```

如果改动范围过大，可以：

第一阶段：

```text
现有 Balance
↓
内部转换为 QuotaMetric
↓
UI 开始消费 QuotaMetric
```

等验证稳定后再移除旧类型。

原则：

> 先兼容，再清理。

不要为了架构漂亮一次重写大量业务逻辑。

---

# 12. 前端结构整理

检查当前：

```text
src/
```

推荐逐渐整理为：

```text
src/
├── components/
│   ├── account/
│   ├── provider/
│   ├── quota/
│   └── ui/
│
├── views/
│   ├── DashboardView.tsx
│   ├── ProvidersView.tsx
│   └── SettingsView.tsx
│
├── lib/
│   ├── api.ts
│   ├── types.ts
│   ├── format.ts
│   └── store.ts
│
├── App.tsx
└── main.tsx
```

不要为了目录结构进行无意义的大规模移动。

只有明显改善职责时再调整。

---

# 13. 产品导航重新确认

当前产品核心应该逐渐从：

```text
Accounts
Models
Settings
```

转向：

```text
Dashboard
Providers
Settings
```

模型资料和价格仍然可以保留。

但不要让：

```text
Models
```

比：

```text
Balance / Quota
```

更像核心功能。

Quota 的第一身份必须是：

> AI Account / Quota Dashboard

不是模型百科。

---

# 14. Security 原则

必须保留当前安全设计：

API Key / AccessKey / 管理密钥 / Cookie：

```text
只能进入系统 Credential Manager
```

禁止：

- 写进 config.json
- 写日志
- 上传远程服务器
- 打进前端 bundle
- 放 README 示例真实值
- 提交 Git

Quota 本身：

```text
不处理支付。
```

充值按钮只能跳官方页面。

README 要明确说明。

---

# 15. 开源项目目录目标

最终希望大致形成：

```text
Quota/
├── .github/
│   └── workflows/
│
├── assets/
│   ├── icon.png
│   └── readme/
│
├── docs/
│   ├── architecture.md
│   ├── providers.md
│   ├── security.md
│   ├── development.md
│   ├── build-windows.md
│   └── model-catalog.md
│
├── src/
│
├── src-tauri/
│   └── src/
│       ├── providers/
│       ├── quota/
│       ├── commands.rs
│       ├── refresh.rs
│       ├── secrets.rs
│       └── storage.rs
│
├── AGENTS.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
└── package.json
```

注意：

如果当前没有 LICENSE：

不要自行决定 MIT / Apache / GPL。

先报告给用户选择。

---

# 16. CONTRIBUTING.md

创建简洁的贡献指南。

重点描述：

```text
开发环境
验证命令
如何新增 Provider
安全规则
PR 基本要求
```

不要写企业级复杂贡献流程。

这是个人小型开源项目。

---

# 17. AGENTS.md 更新

现有 AGENTS.md 中仍然大量使用：

```text
AgentPrice
```

需要更新为：

```text
Quota
```

并保持其中已经记录的：

- Windows GNU 工具链限制
- cargo test 已知问题
- verify-logic
- WebView2Loader.dll
- NSIS
- 安全要求
- 价格不能猜
- 打包检查

这些经验不能因为 README 精简而丢失。

AGENTS.md 可以比 README 详细很多。

---

# 18. 不要破坏当前已知工程约束

现有项目已经有一些踩坑记录。

必须先阅读 AGENTS.md。

尤其包括：

```text
Windows GNU Rust toolchain
WebView2Loader.dll
NSIS
cargo test 问题
verify-logic.cjs
Credential Manager
模型价格核实规则
```

不要重新“优化”掉已经用于解决真实问题的配置。

---

# 19. GitHub 风格

Quota 应该与用户现有独立项目保持一致：

```text
OneIDE
OneProcure
Quota
```

而：

```text
ZeroOne_xxx
```

继续作为内部 / 工程项目命名。

因此：

不要把仓库重命名成：

```text
quota-ai
ai-quota
QuotaAI
ZeroOne_Quota
```

当前：

```text
Sharanie0612/Quota
```

保持。

---

# 20. GitHub Description

建议：

```text
A lightweight local-first desktop dashboard for AI provider balances, credits and quotas.
```

如果 Codex 无权限修改仓库 Description，则只报告给用户。

不要绕过权限。

---

# 21. 推荐 GitHub Topics

仅作为最后报告建议，不要求代码修改：

```text
ai
llm
quota
balance
usage
dashboard
tauri
rust
react
desktop-app
```

---

# 22. 执行方式

不要一口气进行大规模重构。

按照下面阶段执行：

```text
Phase 1
仓库审计
↓
品牌统一
↓
数据迁移兼容

Phase 2
README + docs + CONTRIBUTING

Phase 3
Provider 模块化

Phase 4
QuotaMetric 数据抽象

Phase 5
前端整理

Phase 6
完整验证
```

每阶段完成后确认：

```text
git diff
```

确保没有无关改动。

---

# 23. 每阶段提交

建议拆成独立 commit。

例如：

```text
refactor: 将 AgentPrice 品牌统一为 Quota

docs: 重构 Quota 开源项目文档

refactor: 拆分 provider adapter

refactor: 引入统一 quota metric

refactor: 整理 Quota 前端结构
```

如果某阶段非常大，再进一步拆。

---

# 24. 验证要求

修改后至少运行：

```bash
npm run typecheck
npm run build

cd src-tauri
cargo check
cd ..

node scripts/verify-logic.cjs
```

必须全部通过。

如果修改：

```text
Tauri 配置
应用名称
EXE
Bundle
图标
安装器
WebView2Loader
```

还要实际运行：

```bash
npm run tauri build
```

并执行当前项目已有的：

```text
scripts/check-install.ps1
```

确认安装版可启动。

---

# 25. UI 验证

如果改动 UI：

继续使用项目现有 Preview 流程检查：

```text
主窗口
托盘 Popup
364px 窄窗口
```

不要只看 TypeScript 编译通过。

---

# 26. 最终搜索

任务完成后执行全仓库搜索：

```text
AgentPrice
agentprice
```

逐个判断：

应该迁移的全部迁移。

只有为了：

```text
旧数据兼容
旧 Credential Service 兼容
迁移逻辑
```

才允许继续出现 `AgentPrice`。

并在代码中注明：

```text
legacy compatibility
```

---

# 27. 最终不要做的事情

本次禁止：

- 重写整个应用
- 换技术栈
- 换 Tauri
- 换 React
- 引入大型状态管理库
- 引入数据库，只为“架构完整”
- 引入服务器
- 增加登录系统
- 增加云同步
- 做支付
- 做模型网关
- 删除旧用户数据
- 删除旧 Credential 前不做迁移
- 编造模型价格
- 编造 Provider 支持状态
- 提交真实 API Key
- 为了目录漂亮做无意义文件移动

---

# 28. 最终验收标准

完成后 Quota 应满足：

### 品牌

所有用户可见内容统一使用：

```text
Quota
```

### 产品定位

打开 GitHub README，陌生用户能够在 30 秒内明白：

```text
Quota 是做什么的
支持什么
安全吗
怎么运行
```

### 架构

新增 Provider 不需要修改一个巨大 `providers.rs` 中的大量 match。

### 数据模型

架构能够合理表达：

```text
Balance
Credits
Quota
Usage
```

而不是所有数据都强行叫 Balance。

### 安全

旧 API Key 和配置不会因为重命名丢失。

### 工程

以下验证通过：

```text
TypeScript
Vite build
cargo check
verify-logic
```

涉及打包时：

```text
Tauri build
安装包启动验证
```

也必须通过。

---

# 29. 最终向用户汇报

完成所有任务后，不要只说“完成”。

输出一份简洁报告：

```text
1. 修改了哪些内容
2. 哪些文件发生核心变化
3. AgentPrice → Quota 如何迁移
4. Provider 架构如何变化
5. QuotaMetric 是否完成
6. README / docs 如何整理
7. 跑了哪些验证
8. 每项验证结果
9. 还存在什么风险
10. 推荐下一步做什么
```

如果发现某个改动风险明显高于收益，可以暂停该项，并说明原因。

不要为了完成清单强行重构。
