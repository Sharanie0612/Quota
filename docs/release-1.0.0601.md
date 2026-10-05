# Quota 1.0.0601

2026-10-04 · 界面修复 · 包版本 1.0.601 · 本地测试交付，未公开发布

用户反馈多种异形标记显得杂乱、浅色主题配色沉闷。以已交付 1.0.0600 为基线，只递增修复字段一次。

天梯散点和厂商图例全部使用圆形，普通半径 6.5、激活半径 8.5，保留透明点击区域；选中和悬停保留系统蓝外圈与型号文字。移除方形、星形、十字等标记，键盘焦点离开时清除临时悬停状态，已选型号仍保留。

采用青绿、杏橙、蓝、紫、粉、金黄、珊瑚、绿、青蓝、兰紫十种固定厂商色相，整体提高亮度，移除灰、棕和暗红色块。颜色集中在设计系统 CSS 变量，浅色使用明亮填充和同色细描边，深色使用更亮的同色相。图例和图中点共用同一组件和变量。

参考 [Vega 分类配色指南](https://vega.github.io/vega/docs/schemes/#categorical) 的分类编码方式，最终色值为 Quota 自定义，并非直接采用某个内置色板。没有宣称十色可保证色盲辨识；厂商文字、型号提示和键盘详情保留。价格、汇率、能力分及推理版本不作修改。

| 厂商 | 浅色填充 | 深色填充 |
| --- | --- | --- |
| OpenAI | #4DB6AC | #6BCDBF |
| Anthropic | #F5A261 | #FFB578 |
| Google | #6495ED | #83ADFA |
| DeepSeek | #A78BEB | #BDA2FF |
| Kimi | #EF83AC | #FF9BC5 |
| Z AI | #E7BE50 | #F3D170 |
| Xiaomi | #EF7A70 | #FF9989 |
| Alibaba | #88BE68 | #A4D485 |
| SpaceXAI | #54BBDA | #77D0EB |
| Meta | #BE85CD | #DBA3E7 |

typecheck、npm run build、现有静态渲染五组与逻辑 7/7 通过。静态检查已替换旧形状断言，核对圆点、十厂商颜色与图例一致、选中外圈；实际卡片背景上的圆点边界对比度达到 3:1，未将明亮填充误称为全部达到 3:1。

检查/构建句柄 69812 已退出 0，cargo check、Tauri/NSIS 构建通过，仅有既存 get_api_key 未使用警告。当前唯一安装包：`D:\AgentProjects\Quota\src-tauri\target\release\bundle\nsis\Quota_1.0.0601_x64-setup.exe`，2824157 字节，SHA256=`5BF852804E71C9B892C1ECAB3ACD5D9ACEF65DF3F94EE34A6DDA32D7564C2CB8`。上一安装包已移入 target/installer-archive，未公开发布。

解包目录 `D:\AgentProjects\Quota\src-tauri\target\install-smoke-0601-20261004-215828`，ProductVersion=1.0.601，WebView2Loader.dll 与源文件哈希一致；check-install.ps1 在隔离配置目录启动 8 秒通过，仅关闭检查实例，未更改个人安装。证据记录于 target/installer-0601-evidence.json。

真实浏览器交互、1024px/深浅色视觉仍受既有访问策略限制，未绕过；安装器实际升级未验证。不能用静态检查替代视觉验收，解包启动不等同于安装器升级。
