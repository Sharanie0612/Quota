# Quota 1.0.2600 桌面与安装体验

基于已发布的 1.0.2500，本地功能迭代版本为 1.0.2600，包版本为 1.0.2600。当前任务分支为 `codex/feat/desktop-polish`。原主目录的未提交改动保留，本任务在独立工作树完成。

## 工作区与配色

六个页面共用顶部工作区栏：左侧显示本机名称，右侧显示今日 Token，并提供「我的使用」与同步设置入口。数据来自现有本机统计接口，保留部分采集标记；读取失败显示重试，不把失败当作零用量。

浅色侧栏采用冷中性浅灰，工作区近白，内容卡片纯白。降低大面积阴影强度，用细边线区分表面。深色模式采用对应的灰阶，调整实心蓝色按钮的文字颜色以保持对比。

| 用途 | 浅色 | 深色 |
| --- | --- | --- |
| 窗口 / 侧栏 | `#EEF1F4` | `#171C23` |
| 工作区 / 顶部栏 | `#F7F8FA` | `#1D242D` |
| 卡片 | `#FFFFFF` | `#262E39` |
| 次级分组 | `#F0F2F5` | `#303A47` |
| 细边线 | `#E2E6EC` | `#35404E` |
| 主文字 | `#242C37` | `#EDF1F7` |
| 次文字 | `#606C7C` | `#B0BBCA` |
| 蓝色强调 | `#326DCC` | `#83B1FF` |

颜色集中在 `src/styles.css`。安装器位图由 `scripts/build-installer-art.py` 读取同一组浅色变量与现有应用图标生成，位图随源码保存，正常打包不依赖 Pillow。

## 窗口轮廓

Windows 普通窗口使用 14 个逻辑像素的实际原生圆角区域，跟随显示器 DPI 更新。最大化、全屏、占据工作区角落或铺满边缘的分屏布局使用直角。还原为悬空窗口后恢复圆角。

处理真实窗口区域，不依赖透明 WebView；窗口位置和大小变化后更新，尺寸与形状未变时跳过重复设置。前端接收形状事件，保持应用外表面与原生区域一致。贴边悬浮窗继续使用原有独立区域逻辑。

## SSH 来源与 Quota 客户端

SSH Codex 日志归属仍保留独立标识，继续参与用户勾选的统计。同步设置中的「其他 Quota 客户端」根据共享目录中的读取客户端证据统计，不再把指标的设备归属直接当作安装客户端。

SSH 在独立的「SSH 用量来源」中显示，并注明远端无需安装 Quota、无需创建同步目录。采集设置也说明同一行为。采集脚本继续通过 SSH 在内存执行，读取远端已有 Codex 日志；身份识别不扫描会话，不创建身份文件。未增加 Linux 程序、服务或远端安装步骤。

`verify-sync-devices.cjs` 覆盖本机、真实同步客户端、只有导入记录的设备、SSH 名称和配置身份、尚未同步名称的客户端。`ssh_activity_checks` 在每次执行实际投影脚本前后比较来源目录内容，检查识别和采集不会创建或修改来源文件。

## 中文安装向导

沿用 Tauri / NSIS 的安装、目录选择、进度、快捷方式、完成与打开、覆盖升级和卸载流程。使用中文界面、Quota 图标、灰白品牌侧图和页眉，以及与应用一致的蓝色进度条。身份标识和安装位置兼容关系保留。

安装器资源位于 `src-tauri/installer/`，通过官方 `installerHooks` 扩展界面；没有替换安装、升级或卸载脚本。配置方法参考 [Tauri Windows 安装器文档](https://v2.tauri.app/distribute/windows-installer/)。

## 验证

已通过：TypeScript、前端构建、`cargo check --locked --offline --examples`、纯逻辑 7/7、组件渲染、账户概览、活动图表、费用与月度统计、SSH 选择、同步客户端分类、悬浮窗过渡回归。

浏览器对六个页面执行浅色 / 深色、1024px 宽度的渲染与横向溢出检查，覆盖模型和天梯快照加载完成后的界面、添加账户三步说明、SSH 来源展开、快捷入口、读取失败、窗口状态事件，以及 1440px 宽度截图。

Windows Release 安装包已生成并解包确认包含 `quota.exe` 与 `WebView2Loader.dll`；生成的 NSIS 脚本确认引用中文语言、品牌侧图、页眉和主题钩子。

原生窗口检查通过普通、最大化、全屏、左侧贴边分屏几何和还原五种状态，直接读取 Windows 窗口区域确认圆角 / 直角；原生悬浮窗通过前端握手、几何、展开收起、拖动停靠、身份保护、托盘恢复、单实例和完整退出检查。几何示例另覆盖左右半屏、四分屏、居中三分屏、负坐标显示器与 DPI 容差。

已实际覆盖升级 `D:\Quota`：1.0.2500 → 1.0.2600。安装后二进制和 WebView2Loader 哈希与验证产物一致，5 个已有个人配置 / 统计文件哈希未变。安装版使用隔离数据启动 8 秒并通过原生悬浮窗检查，随后恢复正常运行。

安装包 SHA-256：`a3e1efe0388d1565b8b2539612f3886ee543b58623e2aa989342e1b4193da55a`。

最终证据位于工作树的 `target/desktop-polish-ui/evidence.json`、`target/frame-2600-data/window-frame-check.json`、`target/widget-2600-data/widget-native-check.json` 和 `target/installed-2600-upgrade/evidence.json`。`window_frame_checks`、`ssh_activity_checks` 与完整 Token 统计的 `activity_checks` release examples 均已通过，包含投影前后来源目录内容完全相同的断言。

重跑浏览器检查时，先构建并启动 `node scripts/preview-server.cjs 4178`，再设置 `QUOTA_PLAYWRIGHT_MODULE` 指向可用的 Playwright 模块，运行 `node scripts/verify-desktop-ui.cjs`。测试会准备内置快照与演示数据，默认使用本机 Edge，不读取个人配置。原生窗口检查使用 `scripts/check-window-frame.ps1`，要求先退出 Quota，使用工作树内尚不存在的隔离目录。

真实 Ubuntu / Linux SSH 网络认证和端到端采集未执行。桌面窗口像素捕获接口报 `window capture timed out: timed out waiting on channel`，浏览器截图可正常生成；原生窗口区域检查与手动 Windows 分屏手势、安装向导逐页视觉检查分别记录，不相互替代。本次不构建或发布 macOS 安装包，不推送 GitHub Release。
