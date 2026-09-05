!macro NSIS_HOOK_PREINSTALL
  !if "${ARCH}" == "arm64"
    ; NSIS itself is x86; inspect the native OS rather than the installer process.
    Push $0
    Push $1
    System::Alloc 64
    Pop $0
    System::Call 'kernel32::GetNativeSystemInfo(p r0)'
    System::Call '*$0(&i2 .r1)'
    System::Free $0
    ${If} $1 != 12
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONSTOP "This installer requires Windows on ARM64."
      ${EndIf}
      Pop $1
      Pop $0
      SetErrorLevel 1633
      Abort
    ${EndIf}
    Pop $1
    Pop $0
  !endif
!macroend
