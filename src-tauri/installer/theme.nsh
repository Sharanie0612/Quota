; Quota's quiet gray/white surfaces, using standard NSIS upgrade/install behavior.
!define MUI_BGCOLOR "F7F8FA"
!define MUI_TEXTCOLOR "242C37"
!define MUI_INSTFILESPAGE_COLORS "242C37 FFFFFF"
!define MUI_HEADERIMAGE_RIGHT
!define MUI_WELCOMEPAGE_TITLE "欢迎使用 Quota"
!define MUI_WELCOMEPAGE_TEXT "你的 AI 用量空间。$\r$\n$\r$\n在一个地方查看账户额度、用量和订阅支出。$\r$\n$\r$\n接下来选择安装位置，完成后即可打开 Quota。升级会保留已有账户和本机资料。"
!define MUI_FINISHPAGE_TITLE "Quota 已准备就绪"
!define MUI_FINISHPAGE_TEXT "安装已完成。$\r$\n$\r$\n打开 Quota，继续管理你的 AI 用量。"
!define MUI_FINISHPAGE_RUN_TEXT "打开 Quota"
!define MUI_CUSTOMFUNCTION_GUIINIT QuotaGuiInit
SetFont "Microsoft YaHei UI" 9

Function QuotaGuiInit
  SetCtlColors $HWNDPARENT "242C37" "EEF1F4"
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  ${If} $mui.InstFilesPage.ProgressBar != ""
    System::Call 'uxtheme::SetWindowTheme(p $mui.InstFilesPage.ProgressBar, w "", w "")'
    SendMessage $mui.InstFilesPage.ProgressBar 0x0409 0 0xCC6D32
    SendMessage $mui.InstFilesPage.ProgressBar 0x2001 0 0xF4F1EE
  ${EndIf}
!macroend
