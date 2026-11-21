# Git 分支规范

Quota 使用短期任务分支，从 `main` 开始，一个可独立验收的任务通过 PR 集成回 `main`。验收范围与版本递增分别见[按改动选择验收](../AGENTS.md#按改动选择验收)和[版本换算](releases.md#版本换算)。

## 分支命名与职责

| 分支 | 用途 | 起点 |
| --- | --- | --- |
| `main` | 已通过适用验收的稳定集成代码，不等同于已公开发布 | 合并任务 PR |
| `codex/feat/<主题>` | 新功能、产品交互迭代 | 最新 `main` |
| `codex/fix/<主题>` | 常规缺陷修复 | 最新 `main` |
| `codex/docs/<主题>` | 纯文档变更 | 最新 `main` |
| `codex/chore/<主题>` | 构建、工具、依赖或测试维护 | 最新 `main` |
| `codex/release/<完整展示号>` | 发布冻结、版本同步、打包与验收 | 待发布的 `main` 提交 |
| `codex/hotfix/<完整展示号>-<主题>` | 已发布版本的紧急修复 | 经确认的已发布标签 |

主题使用小写英文、数字和连字符，如 `codex/feat/token-model-picker`、`codex/fix/mimo-balance`；不使用空格、中文或含糊的 `test`、`temp`。可在主题前加问题编号。release 与 hotfix 名称使用 `A.B.FFBB`，不使用三段包版本。

一个分支只处理一个明确目标；同一目标的实现、必要测试和文档一起提交。合并后新任务创建新分支。短期分支持续与 `main` 对齐，不在多个分支之间长期复制同一功能。

## 开始任务与保护现有改动

先检查仓库状态：

```powershell
git status --short --branch
git branch -a
git worktree list
```

工作目录干净且无人共用时，可更新 `main` 并创建任务分支：

```powershell
git switch main
git fetch origin
git merge --ff-only origin/main
git switch -c codex/feat/token-model-picker
```

以上名称只是示例。`--ff-only` 失败时先检查本地与远程差异，不 reset、不强行覆盖本地提交。只有完成 fetch 才能称基线为最新远程版本。

工作目录有未提交改动时，先确认改动归属。创建分支引用不会保存这些改动，切换分支也不是备份。单人任务可在确认改动属于本任务后创建并切换新分支，改动仍需检查、提交。已有其他聊天或进程使用同一目录时，只创建分支引用，保持当前检出状态：

```powershell
git branch --no-track codex/feat/quota-next HEAD
```

此命令基于当前提交创建分支，不包含未提交或未跟踪文件，也不建立远程跟踪关系。不对其他任务的改动执行 stash、reset、clean 或 checkout 覆盖，不未经核实将整批改动提交为本任务成果。

## 并行开发与工作树

每个并行聊天使用独立工作树。当前目录有人工作时，禁止在该目录切换分支或执行影响整个仓库检出状态的整理操作。同一分支只能在一个工作树中检出。

可在 Codex 的项目新建聊天界面选择 Worktree 和起始分支；也可使用 Git 创建单独目录，例如：

```powershell
git worktree add -b codex/fix/mimo-balance ..\Quota-mimo-balance main
```

新工作树以选定提交为基线，默认不会带入当前目录的未提交改动。若任务依赖尚未提交的功能，应先由原任务整理并保存相关提交，或明确使用 Codex 包含当前改动的创建流程并核对结果。不能把旧提交上的新工作树当作最新本地功能副本。

Codex 的托管工作树可能使用 detached HEAD；需要提交、推送和 PR 时，先确认并创建具名任务分支。通过 Codex 创建的托管工作树由 Codex 管理归档；手工创建的工作树清理前须确认无未保存改动且提交已保留，不强制移除。

## 提交说明

- 一个提交表达一个可独立理解的改动。先看 `git status --short` 和 `git diff`，按文件暂存。同一文件混有其他任务的修改时，用 `git add -p` 选择代码块。提交前读完整的 `git diff --cached` 并运行 `git diff --cached --check`。已有的暂存内容也会进入普通提交，须核对归属。
- 标题用一句中文写清动词、对象和具体结果，让只读 `git log --oneline` 的人也能判断影响。保留 API、命令和文件名的原文。修复可以写「修复小米余额解析，避免缺失字段显示为零」，文档可以写「补全英文 README 的安装与开发说明」。
- 标题足以说明的小改可省略正文。涉及多条路径、迁移或非显然的取舍时，空一行写明触发条件、做法及对已有用户或调用方的影响。提交说明与暂存差异对应，PR 再汇总跨提交的结果。
- 验证随改动选择。检查差异中是否混入凭据、个人配置、对话、账单或构建产物，保留仓库要求跟踪的 `WebView2Loader.dll`。[按改动选择验收](../AGENTS.md#按改动选择验收)

例如，下面的提交正文解释了保留原首页的原因。

```text
新增英文 README，保留中文首页的既有链接

已有文档直接链接到 README.md 的中文章节。英文版放在 README.en.md，
两版从页首互链，并共用安装包、校验文件和截图。
```

## 推送与结果说明

按用户要求完成对应操作。要求开 PR 时，可以完成该 PR 所需的本地提交和任务分支推送。仅要求本地提交时交付提交号，仅要求推送时交付远端分支。合并、标签和发布各自遵循本次授权。

以下以本仓库的 `origin`、目标 `main` 和当前任务分支为例。在 fork 中分别核对可写的推送远端和上游目标分支，并用实际目标替换比较命令中的 `origin/main`。先确认分支名非空且是预期的任务分支，再查看整个 PR 将包含的提交和差异。

```powershell
$quotaBranch = git branch --show-current
git remote get-url --push origin
git fetch origin
git log --oneline origin/main..HEAD
git diff --stat origin/main...HEAD
git diff --check origin/main...HEAD
```

以上比较针对已提交的历史。用 `git status --short` 区分工作区里尚未提交的内容，推送摘要只描述实际发出的提交。

- **首次推送**时用 `git ls-remote --heads origin "refs/heads/$quotaBranch"` 查询同名分支。查询成功且结果为空时，用 `git push -u origin $quotaBranch` 建立上游。如果分支已存在，先按下条核对归属与历史，确认是同一任务后也可用 `-u` 建立关联。
- **继续推送**时用 `git log --left-right --oneline "origin/$quotaBranch...HEAD"` 检查远端独有和本地待发的提交，确认范围后执行 `git push origin $quotaBranch`。收到 non-fast-forward 拒绝时，重新 fetch，检查并整合他人的提交，再验证受影响的部分。禁止强推共享分支或直接覆盖 `main`。
- **推送结果**写在交付消息中。用 `git ls-remote --exit-code --heads origin "refs/heads/$quotaBranch"` 查远端分支，与 `git rev-parse HEAD` 核对，再报告目标分支、最新短 SHA 和主要变化。有 PR 时附实际链接。若远端已经是该提交，写明已同步。推送失败时写明错误和本地保留的提交。

回报示例为「已将英文安装说明推送到 `origin/codex/docs/readme-en`，远端提交为 `<短 SHA>`。」实际交付时填入核对过的值。

## PR 标题与正文

1. 默认以 `main` 为目标。先确认目标仓库、目标分支（base）、来源分支（head）及两者之间已有的开放 PR。后续提交推到原分支并更新原 PR。写描述前看 `git diff origin/main...HEAD`，覆盖整条分支最终带来的变化。
2. 标题用中文概括合并后的主要效果，可直接作为 squash 提交标题。例如「补全 Quota 英文使用指南，统一两种语言的下载入口」。纯文档和工具改动写清读者或维护者获得的变化。只在确有对应发布或议题时带上版本号或关联 issue。
3. 正文先写原来的问题、受影响的人或场景，再写改后的行为。验证逐项给出实际命令或操作、结果及必要的平台信息。涉及界面时可附合成数据截图。涉及存储、同步或安装时说明旧数据兼容、升级路径及实际验收范围。适用检查失败或未完成时使用草稿 PR，写明剩余事项。[PR 正文模板](../.github/pull_request_template.md)
4. 发布前预览 Markdown，删除空小节和示例占位，核对截图、日志与链接。用 GitHub CLI 时，多段正文写入 UTF-8 Markdown 文件，通过 `--body-file` 传给 `gh pr create` 或 `gh pr edit`。区分本地结果和 GitHub 上实际触发的检查，创建后交付 PR 链接及草稿或待审状态。

## 合并与分支保护

分支更新后重跑受影响的检查。默认 squash 合并，检查合并标题与正文仍准确概括最终差异。多人共享的分支通过 merge 整合更新，仅未共享的本地提交可以整理或 rebase。

维护者应在 GitHub 为 `main` 配置保护：要求 PR、禁止强推和删除，并将已配置的自动检查设为必需；有独立审阅人时要求至少一位审批。未配置 CI 时，PR 必须附本地验收结果，不能宣称远程检查已通过。这些是维护要求，本文件不表示 GitHub 设置已经生效。

## 发布、紧急修复与清理

release 分支仅处理版本同步、发布说明、验收和阻塞发布的修复。以最近已发布版本为基线，同步 npm、Cargo、Tauri 与展示号。release 分支验证通过后先集成到 `main`，在已验收的实际发布提交上打完整展示号标签，安装包须对应该提交。公开发布以实际 Release 为准，保留已发布标签。[版本换算](releases.md#版本换算)

hotfix 从已确认的发布标签开始，按 Bug 修复规则确定完整展示号；修复验收后将对应提交回补到 `main`，避免后续版本重新引入问题。如有活动 release 分支，也需评估并回补。没有可确认的发布标签时按普通 fix 流程处理，不猜测发布基线。

任务合并后再清理分支。确认 PR 已合并、提交已保留、工作树无人使用且无未保存改动后，按授权删除远程分支和本地分支。squash 合并可能导致 `git branch -d` 拒绝删除，先核对 PR 与提交，不直接使用 `-D` 强删。

## 历史分支示例

2026-10-04 创建本地分支 `codex/feat/quota-next`，基于 `38ea942`。当时原目录存在未提交改动且有其他 Quota 聊天正在使用，因此保持原目录检出 `main`。新分支当时仅指向该基线提交，原目录的工作成果仍需单独保存。
