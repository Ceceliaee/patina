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
Icon "..\patina\assets\icons\icon.ico"
UninstallIcon "..\patina\assets\icons\icon.ico"
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

Function .onInit
  SetRegView 64
  SetShellVarContext current
  ${GetParameters} $0
  ${GetOptions} $0 "/UPDATEPID=" $UpdatePid
  ${GetOptions} $0 "/UPDATEGATE=" $UpdateGate
  ${GetOptions} $0 "/PROFILEPARENT=" $ProfileParent
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

Section "Patina"
  SetOutPath "$INSTDIR"
  ClearErrors
  File /oname=patina-gpui.new.exe "${APP_BINARY}"
  ${If} ${Errors}
    Abort "Unable to stage the new application."
  ${EndIf}
  Delete "$INSTDIR\patina-gpui.previous.exe"
  ${If} ${FileExists} "$INSTDIR\patina-gpui.exe"
    ClearErrors
    Rename "$INSTDIR\patina-gpui.exe" "$INSTDIR\patina-gpui.previous.exe"
    ${If} ${Errors}
      Delete "$INSTDIR\patina-gpui.new.exe"
      Abort "Close Patina before installing this update."
    ${EndIf}
  ${EndIf}
  ClearErrors
  Rename "$INSTDIR\patina-gpui.new.exe" "$INSTDIR\patina-gpui.exe"
  ${If} ${Errors}
    Rename "$INSTDIR\patina-gpui.previous.exe" "$INSTDIR\patina-gpui.exe"
    Abort "Unable to replace the application. The previous version was restored."
  ${EndIf}
  FileOpen $0 "$INSTDIR\patina-gpui-installation" w
  FileWrite $0 "patina-gpui"
  FileClose $0
  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKCU "Software\${INSTALLATION_ID}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "Patina"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "Ceceliaee"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\patina-gpui.exe"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/Ceceliaee/patina"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0
  CreateShortcut "$SMPROGRAMS\${INSTALLATION_ID}.lnk" "$INSTDIR\patina-gpui.exe" "--today"
  Delete "$INSTDIR\patina-gpui.previous.exe"
SectionEnd

Function .onInstSuccess
  ${If} $ProfileParent == ""
    Exec '"$INSTDIR\patina-gpui.exe" --today'
  ${Else}
    Exec '"$INSTDIR\patina-gpui.exe" --today --profile-parent "$ProfileParent"'
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SetRegView 64
  SetShellVarContext current
  Delete "$INSTDIR\patina-gpui.exe"
  ${If} ${FileExists} "$INSTDIR\patina-gpui.exe"
    Abort "Close Patina before uninstalling."
  ${EndIf}
  Delete "$INSTDIR\patina-gpui.previous.exe"
  Delete "$INSTDIR\patina-gpui.new.exe"
  Delete "$INSTDIR\patina-gpui-installation"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${INSTALLATION_ID}.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "Software\${INSTALLATION_ID}"
SectionEnd
