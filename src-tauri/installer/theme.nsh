; The app renders setup; NSIS remains responsible for installation and upgrades.
; Silent installs and machines without WebView2 retain the standard NSIS path.
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
  IfSilent QuotaClassicGui
  ClearErrors
  ${GetOptions} $CMDLINE "/P" $R8
  ${IfNot} ${Errors}
    Goto QuotaClassicGui
  ${EndIf}
  ; WebView2 is installed by the standard wizard when it is not yet available.
  ReadRegStr $R8 HKCU "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${If} $R8 == ""
    ReadRegStr $R8 HKLM "Software\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $R8 == ""
    ReadRegStr $R8 HKLM "Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  ${EndIf}
  ${If} $R8 != ""
    InitPluginsDir
    SetOutPath "$PLUGINSDIR"
    File "/oname=quota-setup.exe" "${__FILEDIR__}\..\target\release\quota.exe"
    File "/oname=WebView2Loader.dll" "${__FILEDIR__}\..\WebView2Loader.dll"
    ShowWindow $HWNDPARENT ${SW_HIDE}
    ClearErrors
    ExecWait '"$PLUGINSDIR\quota-setup.exe" --quota-setup "$EXEPATH"' $R9
    ${IfNot} ${Errors}
      ${If} $R9 == 0
      ${OrIf} $R9 == 1
        SetErrorLevel $R9
        Quit
      ${EndIf}
    ${EndIf}
    ; The native wizard is a functional fallback if the renderer cannot start.
    ShowWindow $HWNDPARENT ${SW_SHOW}
  ${EndIf}
  QuotaClassicGui:
  SetCtlColors $HWNDPARENT "242C37" "EEF1F4"
  ClearErrors
FunctionEnd

!macro NSIS_HOOK_PREINSTALL
  Push $R8
  Push $R9
  ${GetParameters} $R8
  ClearErrors
  ${GetOptions} $R8 "/QUOTA_PROGRESS=" $R9
  ${IfNot} ${Errors}
    WriteINIStr "$R9" "setup" "phase" "copying"
  ${EndIf}
  Pop $R9
  Pop $R8
  ${If} $mui.InstFilesPage.ProgressBar != ""
    System::Call 'uxtheme::SetWindowTheme(p $mui.InstFilesPage.ProgressBar, w "", w "")'
    SendMessage $mui.InstFilesPage.ProgressBar 0x0409 0 0xCC6D32
    SendMessage $mui.InstFilesPage.ProgressBar 0x2001 0 0xF4F1EE
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  Push $R8
  Push $R9
  ${GetParameters} $R8
  ClearErrors
  ${GetOptions} $R8 "/QUOTA_PROGRESS=" $R9
  ${IfNot} ${Errors}
    WriteINIStr "$R9" "setup" "phase" "finishing"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R8 "/QUOTA_DESKTOP" $R9
  ${IfNot} ${Errors}
    CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R8 "/QUOTA_STARTMENU" $R9
  ${IfNot} ${Errors}
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  ${EndIf}
  ClearErrors
  ${GetOptions} $R8 "/QUOTA_PROGRESS=" $R9
  ${IfNot} ${Errors}
    WriteINIStr "$R9" "setup" "phase" "done"
  ${EndIf}
  Pop $R9
  Pop $R8
!macroend
