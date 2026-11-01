# 1.0.3500：液态玻璃双开关与侧栏

2026-11-01，基于本地1.0.3404。功能版本号统一为 `1.0.3500`，本轮不推送或公开发布。

## 设计依据

Apple将Liquid Glass用于导航与交互层，内容保持独立；减少透明度会让材质更磨砂，减少动态效果则降低动效和弹性。[Meet Liquid Glass](https://developer.apple.com/videos/play/wwdc2025/219/)、[材质指南](https://developer.apple.com/design/human-interface-guidelines/materials)。

Windows版本通过WebView实现这套层次和交互逻辑。主窗口继续使用不透明背景，侧栏和工具栏共用材质平面；账单、图表、表单与常规按钮保持实底。没有恢复整窗Blur/Acrylic、桌面透出、SVG位移滤镜或全窗指针光斑。

## 主开关与减少效果

设置使用两个关联开关。主开关关闭为普通界面；开启液态玻璃后才显示“减少视觉效果”。完整模式使用高透材质、圆角高光、柔和景深与局部鼠标反馈；减少效果提高磨砂和遮挡、停止位置追踪并缩短移动，保持同一布局和点击区域。次开关选择在主关闭后保留。

主开关仍使用glass，新可选reduceEffects字段保存强度。旧glass=true且没有新字段时保留为主开启+减少效果；旧关闭保持关闭。读取不会立即重写旧偏好文件。主窗口继续使用应用内材质，没有恢复整窗原生透明合成。

鼠标光效由useMaterialLight统一处理，光层在目标圆角范围内、文字下方，每帧更新输入坐标；不改变按钮或内容几何。键盘可见焦点使用居中高光并优先于鼠标。离开后淡出，失焦、隐藏、缩放或切换模式清理旧坐标；快速按下/抬起单独跟踪，避免按压光效残留。空闲不循环更新。

系统高对比度恢复实底，系统减少动态保留所选材质并禁用位置追踪和移动；应用的减少效果选择独立保存。五种深色配色在光效下对照实际背景像素，工具栏文字对比度最低5.42。

## 侧栏

收起按钮移入品牌旁的标题行，位于品牌拖动区之外。收起宽度80px，导航图标24px、点击目标48px；展开图标20px。标题行保持高度，按钮可用键盘操作。

侧栏宽度和窗口拖动遮罩共用一个变量，避免遮罩挡住按钮。实际检查还发现展开动画期间内容区可能盖住按钮，现已提升侧栏层级并验证按钮在过渡期间可命中。

## 验证

- `npm run typecheck`、Vite build、`npm run verify`、`cargo check --examples --locked` 通过，仅既有 `get_api_key` 警告。
- 主开关关闭及20种开启后的配色/明暗/强度组合通过；导航空白区域3点对照有实际像素差异（浅色最大RGB通道差总和25），根像素Alpha255。内容与常规控件保持实底。
- 检查24/48px图标与点击目标、标题行命中、双开关显示、次开关记忆、旧偏好迁移、保存恢复、高对比度和减少动效。
- 完整界面回归通过：1024/1360px、账户表单、人民币费用编辑/导出、模型图与六维对比、96次调用散点、8种任务状态；80项焦点像素和20项显示变化无失败，收起/隐藏任务计时0变更。

| 层次 | 结果 | 本机证据（`target/materials-3500/`） |
| --- | --- | --- |
| 源码与构建 | 类型检查、生产构建、逻辑与Rust examples类型检查通过 | `logic-switches.log`、`cargo-check-switches.log`、`package2.log` |
| 合成浏览器 | 双开关、20种组合、10项光效、费用/图表/任务全套通过 | `ui-delivery2/result.json` 及各子目录 |
| 包内程序 | 真实Rust月均汇率、人民币¥234、两次调用、两个运行任务、材质同步与窗口生命周期通过 | `native-extracted2/checks-result.json` |
| 实际覆盖升级 | 1.0.3404 → 1.0.3500，8个既有数据文件hash不变；安装向导加载、复制及完成页通过 | `upgrade2/evidence.json`、`upgrade2/modern-setup.json` |
| 安装版WebView | 四组检查再次通过；6组开关/明暗窗口状态、10项光效清理及4种任务窗重置通过 | `native-installed2/checks-result.json`、`material-light/evidence.json`、`native-chrome-evidence.json`、`widget-reset-evidence.json`（后三项位于该资料目录内） |
| 原生几何 | 普通与减少效果均验证浮动圆角、最大化/全屏/分屏方角、还原圆角；重绘保护已实际执行 | `upgrade2/frame-data/window-frame-check.json`、`frame-frosted2/window-frame-check.json` |
| 截图 | README材质/侧栏来自隔离安装版，费用和图表来自同一前端构建的合成预览 | `readme-native2/source.json`、`ui-delivery2/workbench/` |

Windows Computer Use可读取当前窗口的可访问性树，但按钮输入返回`coordinate input geometry is unavailable`，重新选择窗口后截图仍返回`window capture timed out: timed out waiting on channel`。因此桌面合成目视、真实鼠标拖动/Snap尚未验收；CDP输入和原生命令不代替这些结论。记录见`computer-use2.json`。全部截图及交互测试使用合成资料，不包含个人账户或费用。

额外毛玻璃窗口检查本身通过；调用包装层曾把未设置的`$LASTEXITCODE`当作失败，随后读取实际`window-frame-check.json`确认通过，没有重复运行或掩盖产品失败。旧分段选择候选保留本机历史，不交付。

## 交付

- 展示号及npm/Cargo/Tauri包版本均为`1.0.3500`。
- Windows x64安装包：`target/materials-3500/candidate2/Quota_1.0.3500_x64-setup.exe`，4,000,388字节。
- 安装包SHA-256：`e37dc6ac11f52e4a740c1bb53a16df9b50f3fc92b939eb5011b5d29d127b8e54`。
- 安装版主程序SHA-256：`5575517e86bf4cd107ad63bb810b9d74123e0e8a87ecde0eafeeb9cf7b2f159b`。安装向导与主程序为同一实际Cargo产物，WebView2Loader.dll哈希一致。
- 已安装至既有目录`D:\Quota`，隔离检查后以正常数据环境启动；旧版备份保留。本次仅本地提交，不推送或公开发布。
