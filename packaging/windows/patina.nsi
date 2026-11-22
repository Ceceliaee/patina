Unicode true
RequestExecutionLevel user
ManifestDPIAware true
SetCompressor /SOLID lzma
!include "MUI2.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!ifndef INSTALLATION_ID
  !define INSTALLATION_ID "Ceceliaee.Patina"
  !define PREVIOUS_INSTALLATION_ID "Patina.Desktop"
  !define PREVIOUS_SHORTCUT_NAME "Patina Desktop"
  !define EARLY_INSTALLATION_ID "Patina.GPUI"
  !define SHORTCUT_NAME "Patina"
!else
  !define SHORTCUT_NAME "${INSTALLATION_ID}"
!endif
!ifdef PREVIOUS_INSTALLATION_ID
  !define /ifndef PREVIOUS_SHORTCUT_NAME "${PREVIOUS_INSTALLATION_ID}"
!endif
!define /ifndef TAURI_PRODUCT "Patina"
!define /ifndef TAURI_STORAGE_KEY "Software\Patina\Storage\production"
!define /ifndef TAURI_DATA_DIR "$APPDATA\Patina"
!define TAURI_UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${TAURI_PRODUCT}"

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
!ifndef DEFAULT_INSTALL_DIR
  !define DEFAULT_INSTALL_DIR "$LOCALAPPDATA\Programs\Patina"
!endif

Name "Patina"
OutFile "${OUTPUT_FILE}"
InstallDir "${DEFAULT_INSTALL_DIR}"
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
Var TauriUpdate
Var TauriLogin
Var ShortcutPath
!ifdef PREVIOUS_INSTALLATION_ID
Var PreviousInstallDir
!endif
!ifdef EARLY_INSTALLATION_ID
Var EarlyInstallDir
!endif

!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipTauriDirectory
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "SimpChinese"

!macro LockSetup ID
  System::Call 'kernel32::CreateMutexW(p 0, i 0, w "Local\${ID}.Setup") p.r1 ?e'
  Pop $2
  ${If} $1 == 0
  ${OrIf} $2 == 183
    SetErrorLevel 1
    Abort "A Patina installation is already in progress."
  ${EndIf}
!macroend

!macro LockPreviousSetup ID DIRECTORY
  ReadRegStr ${DIRECTORY} HKCU "Software\${ID}" "InstallLocation"
  ${If} ${DIRECTORY} != ""
    !insertmacro LockSetup "${ID}"
  ${EndIf}
!macroend

!macro SetupMutex
  SetRegView 64
  SetShellVarContext current
  !insertmacro LockSetup "${INSTALLATION_ID}"
!ifdef PREVIOUS_INSTALLATION_ID
  !insertmacro LockPreviousSetup "${PREVIOUS_INSTALLATION_ID}" $PreviousInstallDir
!endif
!ifdef EARLY_INSTALLATION_ID
  !insertmacro LockPreviousSetup "${EARLY_INSTALLATION_ID}" $EarlyInstallDir
!endif
!macroend

Function un.onInit
  !insertmacro SetupMutex
FunctionEnd

Function SkipTauriDirectory
  ${If} $TauriUpdate == 1
    Abort
  ${EndIf}
FunctionEnd

!macro ReadSetupOption PREFIX DESTINATION
  StrLen $4 "${PREFIX}"
  StrCpy $5 $3 $4
  ${If} $5 == "${PREFIX}"
    StrCpy ${DESTINATION} $3 "" $4
  ${EndIf}
!macroend

!macro UsePreviousDirectory DIRECTORY
  ${If} ${DIRECTORY} != ""
    ${If} ${FileExists} "${DIRECTORY}\patina-installation"
    ${OrIf} ${FileExists} "${DIRECTORY}\.patina-previous\patina-installation"
    ${OrIf} ${FileExists} "${DIRECTORY}\patina-gpui-installation"
    ${OrIf} ${FileExists} "${DIRECTORY}\.patina-previous\patina-gpui-installation"
      StrCpy $INSTDIR ${DIRECTORY}
      Goto options_done
    ${EndIf}
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
    ${If} $3 == "/UPDATE"
      StrCpy $TauriUpdate 1
    ${ElseIf} $3 == "/ARGS"
      ${ExitWhile}
    ${EndIf}
    ; NSIS consumes the rest of the command line as the unquoted /D= destination.
    StrCpy $4 $3 3
    ${If} $4 == "/D="
      Goto options_done
    ${EndIf}
    !insertmacro ReadSetupOption "/UPDATEPID=" $UpdatePid
    !insertmacro ReadSetupOption "/UPDATEGATE=" $UpdateGate
    !insertmacro ReadSetupOption "/PROFILEPARENT=" $ProfileParent
  ${EndWhile}
  ReadRegStr $3 HKCU "Software\${INSTALLATION_ID}" "InstallLocation"
  ${If} $3 != ""
    StrCpy $INSTDIR $3
  ${Else}
!ifdef PREVIOUS_INSTALLATION_ID
    !insertmacro UsePreviousDirectory $PreviousInstallDir
!endif
!ifdef EARLY_INSTALLATION_ID
    !insertmacro UsePreviousDirectory $EarlyInstallDir
!endif
  ${EndIf}
options_done:
  System::Call 'kernel32::LocalFree(p r0)'
  ${If} $TauriUpdate == 1
    ReadRegStr $1 HKCU "${TAURI_UNINSTALL_KEY}" "InstallLocation"
    ReadRegStr $2 HKCU "${TAURI_UNINSTALL_KEY}" "MainBinaryName"
    StrCpy $3 $1 1
    ${If} $3 == '"'
      StrCpy $1 $1 -1 1
    ${EndIf}
    ReadRegStr $3 HKCU "${TAURI_UNINSTALL_KEY}" "UninstallString"
    ${If} $1 == ""
    ${OrIf} $2 != "Patina.exe"
    ${OrIf} $3 != '"$1\uninstall.exe"'
      Goto invalid_previous_install
    ${EndIf}
    ReadRegStr $3 HKCU "Software\${INSTALLATION_ID}" "InstallLocation"
    ${If} $3 != ""
    ${AndIf} $3 != $1
      Goto invalid_previous_install
    ${EndIf}
    StrCpy $INSTDIR $1
    ; Tauri starts NSIS before its process exits. Wait for the installed executable to be released.
    StrCpy $4 0
    ${DoWhile} ${FileExists} "$INSTDIR\Patina.exe"
      System::Call 'kernel32::CreateFileW(w "$INSTDIR\Patina.exe", i 0x40000000, i 0, p 0, i 3, i 0, p 0) p.r2'
      ${If} $2 P<> -1
        System::Call 'kernel32::CloseHandle(p r2)'
        ${ExitDo}
      ${EndIf}
      IntOp $4 $4 + 1
      ${If} $4 >= 150
        Goto shutdown_failed
      ${EndIf}
      Sleep 100
    ${Loop}
    ReadRegStr $2 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${TAURI_PRODUCT}"
    StrCpy $TauriLogin 0
    ${If} $2 == '"$INSTDIR\Patina.exe" --autostart'
    ${OrIf} $2 == '$INSTDIR\Patina.exe --autostart'
    ${OrIf} $2 == '"$INSTDIR\Patina.exe"'
      StrCpy $TauriLogin 1
    ${EndIf}
    SetAutoClose true
  ${EndIf}
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
invalid_previous_install:
  MessageBox MB_OK|MB_ICONSTOP "Patina could not identify the existing installation for this update." /SD IDOK
  SetErrorLevel 1
  Quit
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
  Delete "$INSTDIR\${DIRECTORY}\patina-installation"
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
    !insertmacro RemoveCurrent "patina-installation"
    !insertmacro RemoveCurrent "patina-gpui-installation"
    ClearErrors
    Rename "$INSTDIR\.patina-publishing" "$INSTDIR\.patina-backing"
    IfErrors recovery_failed
backing:
  IfFileExists "$INSTDIR\.patina-backing" 0 done
  !insertmacro Restore "Font-Licenses.txt"
  !insertmacro Restore "patina-gpui.exe"
  !insertmacro Restore "patina-gpui-installation"
  !insertmacro Restore "patina.exe"
  !insertmacro Restore "patina-ui.exe"
  !insertmacro Restore "patina-probe.exe"
  !insertmacro Restore "Uninstall.exe"
  !insertmacro Restore "patina-installation"
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

!macro RemovePreviousRegistration ID DIRECTORY SHORTCUT
  ${If} ${DIRECTORY} == $INSTDIR
    DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${ID}"
    DeleteRegValue HKCU "Software\${ID}" "InstallLocation"
    DeleteRegKey /ifempty HKCU "Software\${ID}"
    Delete "$SMPROGRAMS\${SHORTCUT}.lnk"
  ${EndIf}
!macroend

Function SetShortcutAppId
  ; Open the link itself for writing its System.AppUserModel.ID property.
  System::Call 'shell32::SHGetPropertyStoreFromParsingName(w "$ShortcutPath", p 0, i 2, g "${IID_IPropertyStore}", *p .r0) i.r1'
  ${If} $1 == 0
    System::Call '*${SYSSTRUCT_PROPERTYKEY}(${PKEY_AppUserModel_ID})p.r2'
    System::Call '*(&w${NSIS_MAX_STRLEN} "${INSTALLATION_ID}")p.r3'
    System::Call '*${SYSSTRUCT_PROPVARIANT}(${VT_LPWSTR},,p r3)p.r4'
    ${IPropertyStore::SetValue} $0 '($2,$4).r1'
    ${If} $1 == 0
      ${IPropertyStore::Commit} $0 ""
    ${EndIf}
    System::Free $4
    System::Free $3
    System::Free $2
    ${IUnknown::Release} $0 ""
  ${EndIf}
FunctionEnd

!macro CheckShortcutTarget PREFIX
Function ${PREFIX}CheckShortcutTarget
  StrCpy $9 0
  IfFileExists "$ShortcutPath" 0 done
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
  ${If} $0 P<> 0
    ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
    ${If} $1 P<> 0
      ${IPersistFile::Load} $1 '("$ShortcutPath",0).r2'
      ${If} $2 == 0
        ${IShellLink::GetPath} $0 '(.r3,${NSIS_MAX_STRLEN},0,0).r2'
        ${If} $2 == 0
        ${AndIf} $3 == "$INSTDIR\Patina.exe"
          StrCpy $9 1
        ${EndIf}
      ${EndIf}
      ${IUnknown::Release} $1 ""
    ${EndIf}
    ${IUnknown::Release} $0 ""
  ${EndIf}
done:
FunctionEnd
!macroend
!insertmacro CheckShortcutTarget ""
!insertmacro CheckShortcutTarget "un."

Section "Patina"
  SetOutPath "$INSTDIR"
  Call Recover
  ${If} $TauriUpdate == 1
  ${AndIfNot} ${FileExists} "$INSTDIR\Patina.exe"
    SetErrorLevel 1
    Abort "The installed Patina executable is missing."
  ${EndIf}
  ; The previous installation can contain separate window and probe executables.
  CreateDirectory "$INSTDIR\.patina-previous"
  SetOutPath "$INSTDIR\.patina-staging"
  ClearErrors
  File /oname=patina.exe "${APP_BINARY}"
  File "..\..\crates\quietpro\assets\fonts\Font-Licenses.txt"
  WriteUninstaller "$INSTDIR\.patina-staging\Uninstall.exe"
  FileOpen $0 "$INSTDIR\.patina-staging\patina-installation" w
  FileWrite $0 "patina-desktop"
  FileClose $0
  IfErrors stage_failed
  SetOutPath "$INSTDIR"
  FileOpen $0 "$INSTDIR\.patina-backing" w
  IfErrors stage_failed
  FileClose $0
  !insertmacro Backup "patina-gpui.exe"
  !insertmacro Backup "patina-gpui-installation"
  !insertmacro Backup "Font-Licenses.txt"
  !insertmacro Backup "patina.exe"
  !insertmacro Backup "patina-ui.exe"
  !insertmacro Backup "patina-probe.exe"
  !insertmacro Backup "Uninstall.exe"
  !insertmacro Backup "patina-installation"
  ${If} $TauriUpdate == 1
    StrCpy $1 ""
    ${If} $ProfileParent != ""
      StrCpy $1 "$ProfileParent\."
    ${EndIf}
    nsExec::ExecToStack '"$INSTDIR\.patina-staging\patina.exe" --upgrade-tauri-profile "$1" "${TAURI_DATA_DIR}" "${TAURI_STORAGE_KEY}" "$TauriLogin"'
    Pop $1
    Pop $2
    ${If} $1 != 0
      MessageBox MB_OK|MB_ICONSTOP "Unable to open the existing Patina data. The previous application will be restored.$\r$\n$2" /SD IDOK
      Goto rollback
    ${EndIf}
  ${EndIf}
  ClearErrors
  Rename "$INSTDIR\.patina-backing" "$INSTDIR\.patina-publishing"
  IfErrors rollback
  !insertmacro Publish "Uninstall.exe"
  !insertmacro Publish "Font-Licenses.txt"
  !insertmacro Publish "patina-installation"
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
  StrCpy $ShortcutPath "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
  CreateShortcut "$ShortcutPath" "$INSTDIR\patina.exe" "--main"
  Call SetShortcutAppId
  ${If} $TauriUpdate == 1
    StrCpy $ShortcutPath "$SMPROGRAMS\${TAURI_PRODUCT}\${TAURI_PRODUCT}.lnk"
    Call CheckShortcutTarget
    ${If} $9 == 1
      Delete "$ShortcutPath"
      RMDir "$SMPROGRAMS\${TAURI_PRODUCT}"
    ${EndIf}
    StrCpy $ShortcutPath "$DESKTOP\${TAURI_PRODUCT}.lnk"
    Call CheckShortcutTarget
    ${If} $9 == 1
      Call SetShortcutAppId
    ${EndIf}
    DeleteRegKey HKCU "${TAURI_UNINSTALL_KEY}"
    ${If} $TauriLogin == 1
      DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${TAURI_PRODUCT}"
    ${EndIf}
  ${EndIf}
!ifdef PREVIOUS_INSTALLATION_ID
  !insertmacro RemovePreviousRegistration "${PREVIOUS_INSTALLATION_ID}" $PreviousInstallDir "${PREVIOUS_SHORTCUT_NAME}"
!endif
!ifdef EARLY_INSTALLATION_ID
  !insertmacro RemovePreviousRegistration "${EARLY_INSTALLATION_ID}" $EarlyInstallDir "${EARLY_INSTALLATION_ID}"
!endif
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
    Exec '"$INSTDIR\patina.exe" --main'
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
    Exec '"$INSTDIR\patina.exe" --main --profile-parent "$ProfileParent"'
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
  Delete "$INSTDIR\patina-installation"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${SHORTCUT_NAME}.lnk"
  StrCpy $ShortcutPath "$DESKTOP\${TAURI_PRODUCT}.lnk"
  Call un.CheckShortcutTarget
  ${If} $9 == 1
    Delete "$ShortcutPath"
  ${EndIf}
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
