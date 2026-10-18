# 版本与安装包管理

用户从 [Releases](https://github.com/Sharanie0612/Quota/releases) 下载。一个版本对应一个完整展示号标签（如 `1.0.2500`）、一份更新说明、Windows x64 安装包、macOS Apple Silicon DMG 和 SHA-256 校验清单。

## 下载入口

| 用途 | 入口 |
| --- | --- |
| 最新正式发布 | [版本说明](https://github.com/Sharanie0612/Quota/releases/latest) |
| Windows 最新版 | [Quota-Windows-x64-setup.exe](https://github.com/Sharanie0612/Quota/releases/latest/download/Quota-Windows-x64-setup.exe) |
| Mac 最新版 | [Quota-macOS-AppleSilicon.dmg](https://github.com/Sharanie0612/Quota/releases/latest/download/Quota-macOS-AppleSilicon.dmg) |
| 最新版校验值 | [SHA256SUMS.txt](https://github.com/Sharanie0612/Quota/releases/latest/download/SHA256SUMS.txt) |
| 旧版本与测试版 | [全部 Releases](https://github.com/Sharanie0612/Quota/releases) |

固定文件名用于最新版链接；同一 Release 另保留带完整版本号的原始安装包。两者字节和哈希完全相同。历史下载使用对应标签页，不替换已发布的文件。Source code (zip / tar.gz) 是 GitHub 自动生成的源码，不能当作安装包。

最新版入口使用 GitHub 的官方 `/releases/latest/download/文件名` 规则；草稿与预发布版不会替换正式最新版。参考 [GitHub 下载链接文档](https://docs.github.com/en/repositories/releasing-projects-on-github/linking-to-releases)。

## 发布步骤

1. 按 [AGENTS.md](../AGENTS.md) 同步版本，完成产品变更所需验证，通过 PR 合入 `main`。纯文档与发布工具维护不递增产品版本。
2. 创建名为 `Quota A.B.FFBB` 的 Release **草稿**，目标填写已合入 main 的确切提交 SHA，写清更新内容、平台和实际验收范围。暂不公开，也不改写历史标签。
3. 上传同版本的 `Quota_A.B.FFBB_x64-setup.exe` 和 `Quota_A.B.FFBB_aarch64.dmg`。Windows 使用 `npm run package:windows`；Mac 使用 [macOS 构建工作流](../.github/workflows/macos-package.yml) 或本机 Mac 构建并验收。
4. 在 [Actions → Publish installers](https://github.com/Sharanie0612/Quota/actions/workflows/release.yml) 选择 **Run workflow**，分支选择 `main`，填写完整展示版本。选择 `draft` 仅整理草稿；`preview` 公开测试版；`release` 公开并设为最新版。
5. 工作流检查两平台文件、版本、源提交归属与 SHA-256，在一次性 Windows runner 上安装上个公开版本并覆盖升级，校验已安装程序、DLL、隔离配置保留和启动。通过后生成固定下载文件、校验清单与 `release-manifest.json`，上传并按所选渠道发布。缺少任一平台、校验失败、升级失败均不会公开。
6. 发布后打开 README 两个平台链接，确认下载重定向到本版本，核对安装包哈希。正式版才更新固定最新版入口；测试版只从对应版本页下载。

发布工作流整理已经构建并验收的包，不会代替前端、Rust、统计和 Mac 原生包验收。`release-manifest.json` 保存版本、源提交和各文件大小/哈希；它用于追溯，不是数字签名。Windows 升级检查只使用 runner 的临时目录和合成配置，不接触维护者本机数据。

macOS 当前为 Apple Silicon 临时签名分发，未进行 Developer ID 签名和公证；不能宣称已验证真实 Keychain、账户登录或完整 UI，除非该版本另有实机证据。版本说明应列出实际通过与未覆盖的场景。

## 校验下载

Windows PowerShell：

```powershell
Get-FileHash .\Quota-Windows-x64-setup.exe -Algorithm SHA256
```

macOS：

```bash
shasum -a 256 Quota-macOS-AppleSilicon.dmg
```

将结果与同一个 Release 的 `SHA256SUMS.txt` 对照。固定名称和带版本号名称各有一行，哈希应相同。

## 修复与回退

- 草稿上传了错误的原始包：核对源提交，修正草稿后重新验证；工具不会悄悄覆盖不同内容的安装包。
- 发布流程失败：修正失败原因，再从同一草稿重试；未公开前可重新生成校验索引。
- 已发布版本出现问题：发布新修复版本，不覆盖旧包、不改写标签。紧急回退最新版入口需维护者明确操作并说明原因；历史版本继续保留下载。
- GitHub Release 不是应用内自动更新。当前下载方式是手动下载并安装；不宣称应用会自动升级。
