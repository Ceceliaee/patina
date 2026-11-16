#[path = "../../test-support/children.rs"]
mod children;
#[path = "../../test-support/windows.rs"]
mod desktop;
#[path = "../../test-support/recording.rs"]
mod fixture;
use desktop::{ComApartment, Error, TestChild, controls, wait, window};
use fixture::seed;
use std::{fs, process::Command};
use windows::{
    Win32::{
        Foundation::{HWND, LPARAM, POINT, WPARAM},
        Graphics::Gdi::ScreenToClient,
        UI::{Accessibility::*, HiDpi::*, WindowsAndMessaging::*},
    },
    core::w,
};

fn named(hwnd: HWND, label: &str) -> Option<IUIAutomationElement> {
    controls(hwnd)
        .ok()?
        .into_iter()
        .rev()
        .find(|el| unsafe { el.CurrentName().is_ok_and(|n| n == label) })
}
fn button(hwnd: HWND, label: &str) -> Option<IUIAutomationElement> {
    controls(hwnd).ok()?.into_iter().rev().find(|el| unsafe {
        el.CurrentControlType().ok() == Some(UIA_ButtonControlTypeId)
            && el.CurrentName().is_ok_and(|n| n == label)
    })
}
fn click(hwnd: HWND, label: &str) -> Result<(), Error> {
    let el = wait(label, || {
        button(hwnd, label).filter(|el| unsafe { el.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
    })?;
    unsafe {
        let r = el.CurrentBoundingRectangle()?;
        let mut point = POINT {
            x: (r.left + r.right) / 2,
            y: (r.top + r.bottom) / 2,
        };
        ScreenToClient(hwnd, &mut point).ok()?;
        let position = LPARAM(((point.y as isize) << 16) | point.x as isize);
        PostMessageW(Some(hwnd), WM_MOUSEMOVE, WPARAM(0), position)?;
        PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), position)?;
        PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), position)?;
    }
    Ok(())
}
fn key(hwnd: HWND, code: usize) -> Result<(), Error> {
    unsafe {
        PostMessageW(Some(hwnd), WM_KEYDOWN, WPARAM(code), LPARAM(1))?;
        PostMessageW(Some(hwnd), WM_KEYUP, WPARAM(code), LPARAM(0xc0000001))?;
    }
    Ok(())
}
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};

#[test]
#[ignore = "isolated Win32 desktop"]
fn native_update_download_confirmation_and_navigation() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&dir)?;
    seed(&dir.join("patina.db"))?;
    let fixture = root.path().join("updater-fixture");
    fs::create_dir(&fixture)?;
    let signed: Value =
        serde_json::from_str(include_str!("../../updater/tests/fixtures/signed.json"))?;
    let payload = STANDARD.decode(signed["payload"].as_str().unwrap())?;
    fs::write(fixture.join("payload.bin"), &payload)?;
    fs::write(
        fixture.join("config.json"),
        serde_json::to_vec(
            &json!({"application":"patina-gpui","endpoints":["https://fixture.invalid/manifest"],"public_key":signed["public_key"]}),
        )?,
    )?;
    let (platform, signature) = if cfg!(target_arch = "aarch64") {
        ("windows-aarch64", &signed["signature_arm64"])
    } else {
        ("windows-x86_64", &signed["signature"])
    };
    fs::write(
        fixture.join("manifest.json"),
        serde_json::to_vec(
            &json!({"schema":1,"application":"patina-gpui","version":"0.2.0","platforms":{platform:{"url":"https://fixture.invalid/setup.exe","size":payload.len(),"signature":signature}}}),
        )?,
    )?;
    let mut child = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
            .arg("--today")
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .env("PATINA_GPUI_UPDATE_FIXTURE", &fixture)
            .spawn()?,
    );
    let hwnd = wait("main", || {
        children::find(child.0.id(), |p| window(p, w!("Patina")))
    })?;
    click(hwnd, "About")?;
    click(hwnd, "Check updates")?;
    wait("available update", || button(hwnd, "Download now"))?;
    click(hwnd, "Download now")?;
    click(hwnd, "Settings")?;
    click(hwnd, "About")?;
    wait("verified update", || button(hwnd, "Restart to install"))?;
    click(hwnd, "Restart to install")?;
    wait("installation confirmation", || button(hwnd, "Cancel"))?;
    click(hwnd, "Cancel")?;
    wait("confirmation dismissed", || {
        button(hwnd, "Cancel").is_none().then_some(())
    })?;
    click(hwnd, "Restart to install")?;
    wait("confirmation reopened", || button(hwnd, "Cancel"))?;
    key(hwnd, 0x1b)?;
    wait("escape dismissed", || {
        button(hwnd, "Cancel").is_none().then_some(())
    })?;
    assert!(
        child.0.try_wait()?.is_none(),
        "cancel must not exit the host"
    );
    assert!(button(hwnd, "Restart to install").is_some());
    // The signed fixture is deliberately not executable. Spawn failure must keep the host alive.
    click(hwnd, "Restart to install")?;
    wait("confirm invalid executable", || button(hwnd, "Cancel"))?;
    click(hwnd, "Restart to install")?;
    wait("installation failure", || {
        named(hwnd, "Update installation failed")
    })?;
    assert!(child.0.try_wait()?.is_none());
    // A fresh check can report failure without executing the previously downloaded file.
    fs::write(fixture.join("manifest.json"), "invalid manifest")?;
    click(hwnd, "Check updates")?;
    wait("check failure", || named(hwnd, "Could not check updates"))?;
    assert!(button(hwnd, "Restart to install").is_none());
    Ok(())
}
