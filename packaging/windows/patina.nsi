Unicode true
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!ifndef INSTALLATION_ID
  !define INSTALLATION_ID "Patina.GPUI"
!endif

!ifndef APP_VERSION
  !error "APP_VERSION is required"
!endif
!ifndef RESOURCE_VERSION
  !error "RESOURCE_VERSION is required"
!endif
!ifndef APP_BINARY
  !error "APP_BINARY is required"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is required"
!endif

Name "Patina"
OutFile "${OUTPUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Patina GPUI"
InstallDirRegKey HKCU "Software\${INSTALLATION_ID}" "InstallLocation"
VIProductVersion "${RESOURCE_VERSION}"
VIAddVersionKey /LANG=1033 "ProductName" "Patina"
VIAddVersionKey /LANG=1033 "CompanyName" "Ceceliaee"
VIAddVersionKey /LANG=1033 "FileDescription" "Patina Installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Ceceliaee"
Icon "..\..\apps\patina\assets\icons\icon.ico"
UninstallIcon "..\..\apps\patina\assets\icons\icon.ico"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${INSTALLATION_ID}"

Var UpdatePid
Var UpdateGate
Var ProfileParent
Var ProcessHandle

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

!macro SetupMutex
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\${INSTALLATION_ID}.Setup") p.r1 ?e'
  Pop $2
  ${If} $1 == 0
  ${OrIf} $2 == 183
    SetErrorLevel 1
    Abort "A Patina installation is already in progress."
  ${EndIf}
  SetRegView 64
  SetShellVarContext current
!macroend

Function un.onInit
  !insertmacro SetupMutex
FunctionEnd

!macro ReadSetupOption PREFIX DESTINATION
  StrLen $4 "${PREFIX}"
  StrCpy $5 $3 $4
  ${If} $5 == "${PREFIX}"
    StrCpy ${DESTINATION} $3 "" $4
  ${EndIf}
!macroend

Function .onInit
  !insertmacro SetupMutex
  ; Windows callers may quote the entire /OPTION=value argument when a path contains spaces.
  System::Call 'kernel32::GetCommandLineW() p.r0'
  System::Call 'shell32::CommandLineToArgvW(p r0, *i .r1) p.r0'
  ${If} $0 == 0
    Goto shutdown_failed
  ${EndIf}
  StrCpy $2 $0
  ${While} $1 > 1
    IntOp $1 $1 - 1
    IntPtrOp $2 $2 + ${NSIS_PTR_SIZE}
    System::Call '*$2(w .r3)'
    ; NSIS consumes the rest of the command line as the unquoted /D= destination.
    StrCpy $4 $3 3
    ${If} $4 == "/D="
      ${Break}
    ${EndIf}
    !insertmacro ReadSetupOption "/UPDATEPID=" $UpdatePid
    !insertmacro ReadSetupOption "/UPDATEGATE=" $UpdateGate
    !insertmacro ReadSetupOption "/PROFILEPARENT=" $ProfileParent
  ${EndWhile}
  System::Call 'kernel32::LocalFree(p r0)'
  ${If} $UpdatePid != ""
    ${If} $UpdateGate == ""
      Goto shutdown_failed
    ${EndIf}
    System::Call 'kernel32::OpenProcess(i 0x100000, i 0, i $UpdatePid) p.r1'
    StrCpy $ProcessHandle $1
    ${If} $ProcessHandle != 0
      System::Call 'kernel32::WaitForSingleObject(p $ProcessHandle, i 60000) i.r2'
      System::Call 'kernel32::CloseHandle(p $ProcessHandle)'
      ${If} $2 != 0
        Goto shutdown_failed
      ${EndIf}
    ${EndIf}
    ClearErrors
    FileOpen $1 "$UpdateGate" r
    ${If} ${Errors}
      Goto shutdown_failed
    ${EndIf}
    FileRead $1 $2
    FileClose $1
    ${If} $2 != "clean"
      Goto shutdown_failed
    ${EndIf}
  ${EndIf}
  Return
shutdown_failed:
  MessageBox MB_OK|MB_ICONSTOP "Patina could not finish shutting down. The update was not installed." /SD IDOK
  SetErrorLevel 1
  Quit
FunctionEnd

!macro Backup NAME
  IfFileExists "$INSTDIR\${NAME}" 0 +4
    ClearErrors
    Rename "$INSTDIR\${NAME}" "$INSTDIR\.patina-previous\${NAME}"
    IfErrors rollback
!macroend

!macro Restore NAME
  IfFileExists "$INSTDIR\.patina-previous\${NAME}" 0 +4
    ClearErrors
    Rename "$INSTDIR\.patina-previous\${NAME}" "$INSTDIR\${NAME}"
    IfErrors recovery_failed
!macroend

!macro RemoveCurrent NAME
  Delete "$INSTDIR\${NAME}"
  IfFileExists "$INSTDIR\${NAME}" recovery_failed
!macroend

!macro Publish NAME
  ClearErrors
  Rename "$INSTDIR\.patina-staging\${NAME}" "$INSTDIR\${NAME}"
  IfErrors rollback
!macroend

!macro CleanOwned DIRECTORY
  Delete "$INSTDIR\${DIRECTORY}\Font-Licenses.txt"
  Delete "$INSTDIR\${DIRECTORY}\patina.exe"
  Delete "$INSTDIR\${DIRECTORY}\patina-ui.exe"
  Delete "$INSTDIR\${DIRECTORY}\patina-probe.exe"
  Delete "$INSTDIR\${DIRECTORY}\patina-gpui.exe"
  Delete "$INSTDIR\${DIRECTORY}\patina-gpui-installation"
  Delete "$INSTDIR\${DIRECTORY}\Uninstall.exe"
  RMDir "$INSTDIR\${DIRECTORY}"
!macroend

!macro RecoveryFunction NAME
Function ${NAME}
  IfFileExists "$INSTDIR\.patina-publishing" 0 backing
    !insertmacro RemoveCurrent "Font-Licenses.txt"
    !insertmacro RemoveCurrent "patina.exe"
    !insertmacro RemoveCurrent "patina-ui.exe"
    !insertmacro RemoveCurrent "patina-probe.exe"
    !insertmacro RemoveCurrent "Uninstall.exe"
    !insertmacro RemoveCurrent "patina-gpui-installation"
    ClearErrors
    Rename "$INSTDIR\.patina-publishing" "$INSTDIR\.patina-backing"
    IfErrors recovery_failed
backing:
  IfFileExists "$INSTDIR\.patina-backing" 0 done
  !insertmacro Restore "Font-Licenses.txt"
  !insertmacro Restore "patina-gpui.exe"
  !insertmacro Restore "patina.exe"
  !insertmacro Restore "patina-ui.exe"
  !insertmacro Restore "patina-probe.exe"
  !insertmacro Restore "Uninstall.exe"
  !insertmacro Restore "patina-gpui-installation"
  Delete "$INSTDIR\.patina-backing"
  IfFileExists "$INSTDIR\.patina-backing" recovery_failed
done:
  !insertmacro CleanOwned ".patina-staging"
  !insertmacro CleanOwned ".patina-previous"
  Return
recovery_failed:
  SetErrorLevel 1
  Abort "Close Patina and run setup again to restore the previous installation."
FunctionEnd

!macroend
!insertmacro RecoveryFunction "Recover"
!insertmacro RecoveryFunction "un.Recover"

Section "Patina"
  SetOutPath "$INSTDIR"
  Call Recover
  ; The previous installation can contain separate window and probe executables.
  CreateDirectory "$INSTDIR\.patina-previous"
  SetOutPath "$INSTDIR\.patina-staging"
  ClearErrors
  File /oname=patina.exe "${APP_BINARY}"
  File "..\..\crates\quietpro\assets\fonts\Font-Licenses.txt"
  WriteUninstaller "$INSTDIR\.patina-staging\Uninstall.exe"
  FileOpen $0 "$INSTDIR\.patina-staging\patina-gpui-installation" w
  FileWrite $0 "patina-gpui"
  FileClose $0
  IfErrors stage_failed
  SetOutPath "$INSTDIR"
  FileOpen $0 "$INSTDIR\.patina-backing" w
  IfErrors stage_failed
  FileClose $0
  !insertmacro Backup "patina-gpui.exe"
  !insertmacro Backup "Font-Licenses.txt"
  !insertmacro Backup "patina.exe"
  !insertmacro Backup "patina-ui.exe"
  !insertmacro Backup "patina-probe.exe"
  !insertmacro Backup "Uninstall.exe"
  !insertmacro Backup "patina-gpui-installation"
  ClearErrors
  Rename "$INSTDIR\.patina-backing" "$INSTDIR\.patina-publishing"
  IfErrors rollback
  !insertmacro Publish "Uninstall.exe"
  !insertmacro Publish "Font-Licenses.txt"
  !insertmacro Publish "patina-gpui-installation"
  !insertmacro Publish "patina.exe"
  Delete "$INSTDIR\.patina-publishing"
  IfFileExists "$INSTDIR\.patina-publishing" rollback
  !insertmacro CleanOwned ".patina-previous"
  RMDir "$INSTDIR\.patina-staging"
  WriteRegStr HKCU "Software\${INSTALLATION_ID}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Patina"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Ceceliaee"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\patina.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/Ceceliaee/patina"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0
  CreateShortcut "$SMPROGRAMS\${INSTALLATION_ID}.lnk" "$INSTDIR\patina.exe" "--today"
  Goto finished
rollback:
  Call Recover
stage_failed:
  SetOutPath "$INSTDIR"
  !insertmacro CleanOwned ".patina-staging"
  SetErrorLevel 1
  Abort "Unable to install the complete Patina application. The previous installation has been kept."
finished:
SectionEnd

Function .onInstSuccess
  ${If} $ProfileParent == ""
    Exec '"$INSTDIR\patina.exe" --today'
  ${Else}
    ; Each trailing backslash must survive the closing quote in the restarted host's argv.
    StrCpy $0 $ProfileParent
    ${Do}
      StrCpy $1 $0 1 -1
      ${If} $1 != "\"
        ${ExitDo}
      ${EndIf}
      StrCpy $0 $0 -1
      StrCpy $ProfileParent "$ProfileParent\"
    ${Loop}
    Exec '"$INSTDIR\patina.exe" --today --profile-parent "$ProfileParent"'
  ${EndIf}
FunctionEnd

Section "Uninstall"
  Call un.Recover
  ; Move the full program set before deleting it so a locked child leaves the installation intact.
  CreateDirectory "$INSTDIR\.patina-previous"
  ClearErrors
  FileOpen $0 "$INSTDIR\.patina-backing" w
  IfErrors busy
  FileClose $0
  !insertmacro Backup "Font-Licenses.txt"
  !insertmacro Backup "patina.exe"
  !insertmacro Backup "patina-ui.exe"
  !insertmacro Backup "patina-probe.exe"
  Delete "$INSTDIR\.patina-backing"
  IfFileExists "$INSTDIR\.patina-backing" rollback
  !insertmacro CleanOwned ".patina-previous"
  Delete "$INSTDIR\patina-gpui-installation"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${INSTALLATION_ID}.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\${INSTALLATION_ID}"
  Goto done
rollback:
  !insertmacro Restore "Font-Licenses.txt"
  !insertmacro Restore "patina.exe"
  !insertmacro Restore "patina-ui.exe"
  !insertmacro Restore "patina-probe.exe"
  Delete "$INSTDIR\.patina-backing"
  RMDir "$INSTDIR\.patina-previous"
recovery_failed:
busy:
  SetErrorLevel 1
  Abort "Close Patina before uninstalling."
done:
SectionEnd
