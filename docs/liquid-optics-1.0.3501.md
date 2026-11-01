# 1.0.3501：透镜边缘与减少动态

2026-11-01，修复1.0.3500材质偏平、光效仅像光斑，以及减少动态仍采用位置过渡的问题。保留液态玻璃主开关及条件显示的减少视觉效果次开关。

## 视觉与交互

侧栏和顶部栏使用实时背景折射、细高光和柔和景深；顶部栏浮于可滚动内容之上，初始内容留出空间。文字、按钮命中区域及业务卡片保持稳定。选择反馈只使文字下方的覆盖层形变，快速反向时从当前可见位置接续。鼠标反馈同时调整局部漫反射和表面边缘方向。

Apple将减少透明度和减少动态作为不同的材质修饰：前者增加磨砂，后者降低运动强度、去掉弹性。[官方材质介绍](https://developer.apple.com/videos/play/wwdc2025/219/)。本应用按用户要求保留一个“减少视觉效果”开关，同时适度增加遮挡、降低折射，并将导航和侧栏运动替换为淡入淡出。系统减少动态则保留所选透明度，单独降低透镜强度并取消空间运动；高对比度恢复实底。

这是Windows WebView中的实现，不宣称与Apple原生渲染完全一致。

## 实现边界

`appearance/lens.ts`只生成圆角几何位移，`GlassMaterial`复用该映射对实时背景应用局部SVG滤镜；不截取账户、对话或图表内容制作纹理。两处材质各有自己的圆角裁剪；没有整窗透明、原生Acrylic或全窗滤镜。位移图按尺寸生成并缓存，鼠标移动不重建。Chromium支持路径须以真实像素验证，未支持的浏览器保留CSS磨砂和轮廓。

`useSlidingHighlight`统一导航和分段选择的动效；`useMaterialLight`统一输入光效和清理；主题与圆角沿用已有来源。没有增加依赖、账本、采集渠道或个人数据格式。

## 验证记录

本机证据位于`target/materials-3501/`。所有页面及光学标定均使用合成资料；标定纹理不作为产品截图。

| 范围 | 实际结果 | 证据 |
| --- | --- | --- |
| 源码 | typecheck、Vite build、npm verify及GNU `cargo check --examples --locked --offline`通过，仅既有get_api_key警告 | `logic-final.log`、`cargo-check.log`、`package.log` |
| 完整界面 | 7组通过：20种材质组合、光效/光学、费用操作、模型/96调用、80项焦点、20项显示、8种任务状态及95秒计时；1024/1360px正常 | `ui-final/result.json`及子目录 |
| 光学与可读性 | 预览2142/2868个边缘采样发生实际折射，安全圆角外零差异；20处导航文字样本最低对比度5.36；不支持滤镜时回退、空闲映射零更新通过 | `ui-final/material-optics/evidence.json`、`navigation-ink.json`、`fallback-idle.json` |
| 包内程序 | visuals、optics、light、chrome及widget-state通过；鼠标检查须先核对原生窗口真实焦点 | `native-extracted1/checks-result.json` |
| 实际覆盖升级 | 1.0.3500 → 1.0.3501，8个既有数据文件hash不变；安装向导bootstrap/前端/复制/完成页、Loader及实际payload核对通过 | `upgrade1/evidence.json`、`upgrade1/modern-setup.json` |
| 安装版 | 五组再次通过；实际光学2046/2472个边缘采样改变，安全圆角外0变化；完整形变可反向接续，减少效果与系统减少动态没有位置或弹性关键帧 | `native-installed1/checks-result.json`、`native-installed1/verify-material-optics/evidence.json` |
| 原生窗口 | 普通及减少效果验证浮动圆角，最大化/全屏/分屏方角，还原圆角；重绘保护实际执行；任务窗几何和关闭行为通过 | `upgrade1/frame-data/`、`frame-frosted1/`、`upgrade1/isolated-data/` |
| 截图 | 材质/侧栏来自隔离安装版真实WebView，业务图来自同一最终构建合成预览 | `readme-native1/source.json`、`ui-final/workbench/` |

检查确实捕获并修复了三类问题：滤镜引用在祖先CSS变量处提前解析而未生效；系统极短transition隐式创建高亮位移；部分高透背景的浅色导航文字对比不足。缩放检查补充等待真实resize事件。包内鼠标首轮发生在未激活窗口，保留失败日志`native-extracted1/verify-material-light.log`，核对真实焦点后通过`light-focused.log`；安装版脚本现显式检查这个前置条件，不伪造焦点状态。

Windows Computer Use成功激活窗口并读取可访问性树；截图仍返回FrameArrived/channel超时，实际点击返回`coordinate input geometry is unavailable`。因此桌面合成目视、真实鼠标点击/拖动/Snap仍未验证，详见`computer-use.json`。CDP输入、原生命令和WebView截图不代替这些结论。

## 交付

- 展示号与npm/Cargo/Tauri包版本均为`1.0.3501`。
- Windows x64安装包：`target/materials-3501/candidate1/Quota_1.0.3501_x64-setup.exe`，4,002,757字节。
- 安装包SHA-256：`667d7cac866d436aa8feea0646fddc42c682e2495a9e6ee3b6fb5897525e4aef`。
- 安装主程序SHA-256：`09f6c8a5c10f90ce2e30db67cd4a722cfb9a5b4ed078aeb8aa78011c2f58cb11`。安装向导与主程序为同一实际Cargo产物，WebView2Loader.dll已核对。
- 旧版本回滚文件保留于`upgrade1/original-*`；最终隔离检查结束后恢复`D:\Quota`的正常数据环境运行。本轮仅本地commit，不推送或公开发布。
