#[path = "../../test-support/windows.rs"]
mod desktop;

use desktop::{ComApartment, Error, TestChild, controls, wait, window};
use std::{path::PathBuf, process::Command};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        UI::{
            Accessibility::*,
            WindowsAndMessaging::{PostMessageW, WM_CLOSE},
        },
    },
    core::w,
};

fn named(hwnd: HWND, name: &str) -> Option<IUIAutomationElement> {
    controls(hwnd)
        .ok()?
        .into_iter()
        .find(|item| unsafe { item.CurrentName() }.is_ok_and(|value| value == name))
}

#[test]
#[ignore = "requires an interactive Windows desktop"]
fn accessible_controls() -> Result<(), Error> {
    let _apartment = ComApartment::init()?;
    let build = Command::new(env!("CARGO"))
        .current_dir(env!("CARGO_MANIFEST_DIR"))
        .args([
            "build",
            "--locked",
            "--example",
            "controls",
            "--message-format=json-render-diagnostics",
        ])
        .stderr(std::process::Stdio::inherit())
        .output()?;
    if !build.status.success() {
        return Err(format!("Could not build controls example: {}", build.status).into());
    }
    let messages =
        serde_json::Deserializer::from_slice(&build.stdout).into_iter::<serde_json::Value>();
    let mut executable = None;
    for message in messages {
        let message = message?;
        if message["reason"] == "compiler-artifact"
            && message["target"]["name"] == "controls"
            && let Some(path) = message["executable"].as_str()
        {
            executable = Some(PathBuf::from(path));
        }
    }
    let exe = executable.ok_or("Cargo did not report the controls example executable")?;
    let mut child = TestChild(Command::new(exe).arg("--verify").spawn()?);
    let hwnd = wait("controls example", || {
        window(child.0.id(), w!("QuietPro controls"))
    })?;
    let pin = wait("Pin", || named(hwnd, "Pin"))?;
    let count = wait("Count", || named(hwnd, "Count"))?;
    let reset = wait("Reset", || named(hwnd, "Reset"))?;
    unsafe {
        let toggle: IUIAutomationTogglePattern = pin.GetCurrentPatternAs(UIA_TogglePatternId)?;
        assert_eq!(toggle.CurrentToggleState()?, ToggleState_Off);
        assert!(!reset.CurrentIsEnabled()?.as_bool());
        assert_eq!(count.CurrentControlType()?, UIA_ButtonControlTypeId);
        assert!(!count.CurrentIsEnabled()?.as_bool());
        toggle.Toggle()?;
        wait("single activation and enabled Reset", || {
            (toggle.CurrentToggleState().ok()? == ToggleState_On
                && reset.CurrentIsEnabled().ok()?.as_bool()
                && count.CurrentIsEnabled().ok()?.as_bool())
            .then(|| named(hwnd, "Changes: 1"))
            .flatten()
        })?;
        let increment: IUIAutomationInvokePattern =
            count.GetCurrentPatternAs(UIA_InvokePatternId)?;
        increment.Invoke()?;
        wait("one text button activation", || named(hwnd, "Changes: 2"))?;
        let invoke: IUIAutomationInvokePattern = reset.GetCurrentPatternAs(UIA_InvokePatternId)?;
        invoke.Invoke()?;
        wait("zero changes and disabled Reset", || {
            (toggle.CurrentToggleState().ok()? == ToggleState_Off
                && !reset.CurrentIsEnabled().ok()?.as_bool()
                && !count.CurrentIsEnabled().ok()?.as_bool())
            .then(|| named(hwnd, "Changes: 0"))
            .flatten()
        })?;
        PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
    }
    assert!(wait("example exit", || child.0.try_wait().ok().flatten())?.success());
    Ok(())
}
