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
!define QUOTA_SHORTCUT_ICON "$INSTDIR\Quota.ico"
!define QUOTA_SLGP_RAWPATH 0x4
Var QuotaShortcutsReady
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
    !if "$%QUOTA_SETUP_PAYLOAD%" != ""
      File "/oname=quota-setup.exe" "$%QUOTA_SETUP_PAYLOAD%"
    !else
      File "/oname=quota-setup.exe" "${__FILEDIR__}\..\target\release\quota.exe"
    !endif
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

; Edit only the icon property of an existing link to this installation.
Function QuotaSetShortcutIcon
  Exch $R7
  Push $0
  Push $1
  Push $2
  Push $3
  ${If} ${FileExists} "$R7"
    !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
    ${If} $0 P<> 0
      ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
      ${If} $1 P<> 0
        ${IPersistFile::Load} $1 '("$R7", ${STGM_READWRITE}).r2'
        ${If} $2 = 0
          ; The output buffer belongs to the caller of IShellLinkW::GetPath.
          System::Call '*(&w1024 "") p.r3'
          System::Call '$0->3(p r3, i 1024, p 0, i ${QUOTA_SLGP_RAWPATH}) i.r2'
          ${If} $2 = 0
            System::Call '*$3(&w1024 .r2)'
          ${EndIf}
          System::Free $3
          ${If} $2 == "$INSTDIR\quota.exe"
            ${IShellLink::SetIconLocation} $0 '("${QUOTA_SHORTCUT_ICON}",0).r2'
            ${If} $2 = 0
              ${IPersistFile::Save} $1 '("$R7",1).r2'
              ${If} $2 = 0
                ; Notify Explorer that this link changed (SHCNE_UPDATEITEM).
                System::Call 'shell32::SHChangeNotify(i 0x2000, i 0x3005, w "$R7", p 0) v'
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
        ${IUnknown::Release} $1 ""
      ${EndIf}
      ${IUnknown::Release} $0 ""
    ${EndIf}
  ${EndIf}
  Pop $3
  Pop $2
  Pop $1
  Pop $0
  Pop $R7
FunctionEnd

Function QuotaRefreshShortcutIcons
  ${If} ${FileExists} "${QUOTA_SHORTCUT_ICON}"
    Push "$DESKTOP\Quota.lnk"
    Call QuotaSetShortcutIcon
    Push "$SMPROGRAMS\Quota.lnk"
    Call QuotaSetShortcutIcon
    Push "$SMPROGRAMS\Quota\Quota.lnk"
    Call QuotaSetShortcutIcon
  ${EndIf}
FunctionEnd

; The classic finish page can create a desktop shortcut after POSTINSTALL.
Function .onGUIEnd
  ${If} $QuotaShortcutsReady = 1
    Call QuotaRefreshShortcutIcons
  ${EndIf}
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
    ${IfNot} ${FileExists} "$DESKTOP\${PRODUCTNAME}.lnk"
      CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "${QUOTA_SHORTCUT_ICON}" 0
      !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}
  ClearErrors
  ${GetOptions} $R8 "/QUOTA_STARTMENU" $R9
  ${IfNot} ${Errors}
    ${IfNot} ${FileExists} "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "" "${QUOTA_SHORTCUT_ICON}" 0
      !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}
  StrCpy $QuotaShortcutsReady 1
  Call QuotaRefreshShortcutIcons
  ClearErrors
  ${GetOptions} $R8 "/QUOTA_PROGRESS=" $R9
  ${IfNot} ${Errors}
    WriteINIStr "$R9" "setup" "phase" "done"
  ${EndIf}
  Pop $R9
  Pop $R8
!macroend
