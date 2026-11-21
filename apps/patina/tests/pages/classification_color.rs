use super::*;

pub(super) fn field(hwnd: HWND, name: &str) -> Option<IUIAutomationElement> {
    controls(hwnd).ok()?.into_iter().find(|e| unsafe {
        e.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
            && e.CurrentName().is_ok_and(|n| n == name)
    })
}
pub(super) fn value(hwnd: HWND, name: &str) -> Option<String> {
    unsafe {
        field(hwnd, name)?
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
            .ok()?
            .CurrentValue()
            .ok()
            .map(|s| s.to_string())
    }
}
pub(super) fn set(hwnd: HWND, name: &str, value: &str) -> Result<(), Error> {
    let input = wait(name, || field(hwnd, name))?;
    unsafe {
        input.SetFocus().map_err(|e| format!("focus {name}: {e}"))?;
        input
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?
            .SetValue(&value.into())
            .map_err(|e| format!("set {name}: {e}"))?;
    }
    key(hwnd, 13)?;
    Ok(())
}
fn click(hwnd: HWND, name: &str) -> Result<(), Error> {
    super::click(hwnd, name).map_err(|e| format!("click {name}: {e}").into())
}
fn press(hwnd: HWND, name: &str) -> Result<(), Error> {
    super::press(hwnd, name).map_err(|e| format!("press {name}: {e}").into())
}
pub(super) fn format(hwnd: HWND, name: &str) -> Result<(), Error> {
    let radio = wait(name, || {
        controls(hwnd).ok()?.into_iter().find(|e| unsafe {
            e.CurrentControlType().ok() == Some(UIA_RadioButtonControlTypeId)
                && e.CurrentName().is_ok_and(|n| n == name)
        })
    })?;
    activate_control(hwnd, &radio, false)?;
    wait("color format selected", || unsafe {
        let selected = controls(hwnd).ok()?.into_iter().find(|e| {
            e.CurrentControlType().ok() == Some(UIA_RadioButtonControlTypeId)
                && e.CurrentName().is_ok_and(|n| n == name)
        })?;
        selected
            .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
            .ok()?
            .CurrentIsSelected()
            .ok()?
            .as_bool()
            .then_some(())
    })?;
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn classification_color_editor() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::APP_ID);
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    seed(&db)?;
    tokio::runtime::Builder::new_current_thread().enable_all().build()?.block_on(async {
        let mut connection = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        for index in 0..6 {
            sqlx::query("INSERT INTO sessions(exe_name,app_name,start_time,end_time,duration) VALUES (?,?,1000,2000,1000)")
                .bind(format!("a{index}.exe")).bind(format!("App {index}"))
                .execute(&mut connection).await?;
        }
        Ok::<_,Error>(())
    })?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .env_remove("PATINA_GPUI_DEV_SESSION")
            .stderr(fs::File::create(root.path().join("renderer.log"))?)
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "Classification")?;
    set(hwnd, "Search apps", "Studio")?;
    wait("single card", || {
        (names(hwnd)
            .iter()
            .filter(|n| n.starts_with("Category ･ "))
            .count()
            == 1)
            .then_some(())
    })?;
    for name in [
        "Color",
        "Record titles",
        "Track anonymously",
        "Delete application",
    ] {
        wait(name, || named(hwnd, name)).map_err(|e| format!("{e}: {:?}", names(hwnd)))?;
    }
    press(hwnd, "Color")?;
    wait("category default color", || {
        (value(hwnd, "Hex color value").as_deref() == Some("#4790CF")).then_some(())
    })?;
    let mut screen_capture_available = true;
    for cancel in [true, false] {
        click(hwnd, "Eyedropper")?;
        let picker = wait("screen picker or capture restriction", || {
            children::find(pid, |p| window(p, w!("Eyedropper")))
                .map(Some)
                .or_else(|| named(hwnd, "Eyedropper is unavailable").map(|_| None))
        })?;
        let Some(picker) = picker else {
            let log = fs::read_to_string(root.path().join("renderer.log"))?;
            assert!(
                log.contains("0x80070005"),
                "unexpected screen capture failure: {log}"
            );
            assert_eq!(value(hwnd, "Hex color value").as_deref(), Some("#4790CF"));
            assert!(unsafe {
                button(hwnd, "Eyedropper")
                    .unwrap()
                    .CurrentIsEnabled()?
                    .as_bool()
            });
            eprintln!(
                "screen capture is denied on the isolated desktop; native selection uses a controlled bitmap test"
            );
            screen_capture_available = false;
            break;
        };
        if cancel {
            key(picker, 0x1b)?;
        } else {
            unsafe {
                PostMessageW(Some(picker), WM_RBUTTONUP, WPARAM(0), LPARAM(0))?;
            }
        }
        wait("screen selection cancelled", || {
            children::find(pid, |p| window(p, w!("Eyedropper")))
                .is_none()
                .then_some(())
        })?;
        assert_eq!(value(hwnd, "Hex color value").as_deref(), Some("#4790CF"));
        wait("eyedropper ready again", || unsafe {
            button(hwnd, "Eyedropper")?
                .CurrentIsEnabled()
                .ok()?
                .as_bool()
                .then_some(())
        })?;
    }
    if screen_capture_available {
        click(hwnd, "Eyedropper")?;
        let picker = wait("screen color picker for selection", || {
            children::find(pid, |p| window(p, w!("Eyedropper")))
        })?;
        let picked = unsafe {
            use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};
            let dc = GetDC(Some(picker));
            let pixel = GetPixel(dc, 32, 32).0;
            ReleaseDC(Some(picker), dc);
            assert_ne!(pixel, 0xffff_ffff);
            format!(
                "#{:02X}{:02X}{:02X}",
                pixel & 255,
                (pixel >> 8) & 255,
                (pixel >> 16) & 255
            )
        };
        unsafe {
            let point = LPARAM((32 << 16) | 32);
            PostMessageW(Some(picker), WM_LBUTTONDOWN, WPARAM(1), point)?;
            PostMessageW(Some(picker), WM_LBUTTONUP, WPARAM(0), point)?;
        }
        wait("sampled pixel fills color input", || {
            (value(hwnd, "Hex color value").as_deref() == Some(picked.as_str())).then_some(())
        })?;
        wait("screen picker released after selection", || {
            children::find(pid, |p| window(p, w!("Eyedropper")))
                .is_none()
                .then_some(())
        })?;
    }
    set(hwnd, "Hex color value", "#35A69E")?;
    key(hwnd, 0x1b)?;
    wait("Escape closes color panel", || {
        field(hwnd, "Hex color value").is_none().then_some(())
    })?;
    key(hwnd, 13)?;
    wait(
        "Escape returns to trigger so Enter reopens color panel",
        || field(hwnd, "Hex color value"),
    )?;
    key(hwnd, 0x1b)?;
    wait("keyboard closes reopened panel", || {
        field(hwnd, "Hex color value").is_none().then_some(())
    })?;
    click(hwnd, "Cancel")?;
    wait("cancel discards draft", || unsafe {
        (!button(hwnd, "Cancel")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    click(hwnd, "Color")?;
    wait("cancel restores color", || {
        (value(hwnd, "Hex color value").as_deref() == Some("#4790CF")).then_some(())
    })
    .map_err(|e| {
        format!(
            "{e}: value {:?}; nodes {:?}",
            value(hwnd, "Hex color value"),
            names(hwnd)
        )
    })?;
    set(hwnd, "Hex color value", "#35A69E")?;
    format(hwnd, "RGB")?;
    key(hwnd, 0x1b)?;
    click(hwnd, "Color")?;
    wait("reopening remembers RGB format", || {
        field(hwnd, "Red channel")
    })?;
    wait("RGB channels", || {
        (value(hwnd, "Red channel").as_deref() == Some("53")
            && value(hwnd, "Green channel").as_deref() == Some("166"))
        .then_some(())
    })?;
    set(hwnd, "Red channel", "255")?;
    format(hwnd, "HSL")?;
    wait("HSL channels", || field(hwnd, "Lightness"))?;
    set(hwnd, "Hue", "120")?;
    set(hwnd, "Saturation", "100")?;
    set(hwnd, "Lightness", "50")?;
    format(hwnd, "HEX")?;
    wait("HSL to HEX", || {
        (value(hwnd, "Hex color value").as_deref() == Some("#00FF00")).then_some(())
    })?;
    set(hwnd, "Hex color value", "#zzzzzz")?;
    format(hwnd, "RGB")?;
    format(hwnd, "HEX")?;
    wait("invalid input preserves last valid color", || {
        (value(hwnd, "Hex color value").as_deref() == Some("#00FF00")).then_some(())
    })
    .map_err(|e| format!("{e}: {:?}", value(hwnd, "Hex color value")))?;
    let area = wait("color plane", || named(hwnd, "Color picker"))?;
    activate_control(hwnd, &area, false)?;
    wait("color plane changes value", || {
        (value(hwnd, "Hex color value").as_deref() != Some("#00FF00")).then_some(())
    })?;
    let before = value(hwnd, "Hex color value");
    key(hwnd, 0x27)?;
    wait("keyboard adjusts color plane", || {
        (value(hwnd, "Hex color value") != before).then_some(())
    })?;
    set(hwnd, "Hex color value", "#35A69E")?;
    key(hwnd, 0x1b)?;
    wait("panel closed before save", || {
        field(hwnd, "Hex color value").is_none().then_some(())
    })?;
    press(hwnd, "Save")?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let saved = || {
        rt.block_on(async {
            let mut conn =
                SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db))
                    .await
                    .ok()?;
            let raw: String = sqlx::query_scalar(
                "SELECT value FROM settings WHERE key='__app_override::studio.exe'",
            )
            .fetch_one(&mut conn)
            .await
            .ok()?;
            serde_json::from_str::<serde_json::Value>(&raw).ok()
        })
    };
    wait("custom color persisted", || {
        (saved()?["color"] == "#35A69E").then_some(())
    })?;
    wait("save finished", || named(hwnd, "Saved"))?;
    rt.block_on(async {
        let mut conn = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        sqlx::query("INSERT INTO icon_cache(exe_name,icon_base64,last_updated) VALUES ('STUDIO.EXE',?,1)")
            .bind("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEUlEQVR4nGNQSDjwH4QZYAwASvQI/dnllI8AAAAASUVORK5CYII=")
            .execute(&mut conn).await?;
        Ok::<_,Error>(())
    })?;
    click(hwnd, "Today")?;
    wait("classification page left", || {
        field(hwnd, "Search apps").is_none().then_some(())
    })?;
    click(hwnd, "Classification")?;
    set(hwnd, "Search apps", "Studio")?;
    click(hwnd, "Color")?;
    wait("reopened saved color", || {
        (value(hwnd, "Hex color value").as_deref() == Some("#35A69E")).then_some(())
    })?;
    click(hwnd, "Restore default color")?;
    wait("reset prefers icon over category color", || {
        (value(hwnd, "Hex color value").as_deref() == Some("#2060C0")).then_some(())
    })?;
    key(hwnd, 0x1b)?;
    wait("reset panel closed", || {
        field(hwnd, "Hex color value").is_none().then_some(())
    })?;
    press(hwnd, "Save")?;
    wait("reset removes override", || {
        saved()?.get("color").is_none().then_some(())
    })?;
    rt.block_on(async {
        let mut conn =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        sqlx::query("UPDATE icon_cache SET icon_base64='bm90IGEgcG5n' WHERE exe_name='STUDIO.EXE'")
            .execute(&mut conn)
            .await?;
        Ok::<_, Error>(())
    })?;
    click(hwnd, "Today")?;
    wait("classification page left after reset", || {
        field(hwnd, "Search apps").is_none().then_some(())
    })?;
    click(hwnd, "Classification")?;
    set(hwnd, "Search apps", "Studio")?;
    click(hwnd, "Color")?;
    wait("invalid icon falls back to category", || {
        (value(hwnd, "Hex color value").as_deref() == Some("#4790CF")).then_some(())
    })?;
    if screen_capture_available {
        click(hwnd, "Eyedropper")?;
        wait("screen picker before closing color panel", || {
            children::find(pid, |p| window(p, w!("Eyedropper")))
        })?;
    }
    key(hwnd, 0x1b)?;
    wait("fallback panel closed", || {
        field(hwnd, "Hex color value").is_none().then_some(())
    })?;
    wait("closing color panel cancels native selection", || {
        children::find(pid, |p| window(p, w!("Eyedropper")))
            .is_none()
            .then_some(())
    })?;
    set(hwnd, "Search apps", "")?;
    let colors = wait("bottom row color controls", || {
        let mut controls: Vec<_> = controls(hwnd)
            .ok()?
            .into_iter()
            .filter(|el| unsafe {
                el.CurrentControlType().ok() == Some(UIA_ButtonControlTypeId)
                    && el.CurrentName().is_ok_and(|name| name == "Color")
            })
            .collect();
        controls.sort_by_key(|el| unsafe {
            el.CurrentBoundingRectangle()
                .map(|r| (r.top, r.left))
                .unwrap_or_default()
        });
        (controls.len() == 8).then_some(controls)
    })?;
    for trigger in &colors[6..] {
        activate_control(hwnd, trigger, false)?;
        let panel = wait("color panel above or below its trigger", || {
            let panel = controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentControlType().ok() == Some(UIA_GroupControlTypeId)
                    && el.CurrentName().is_ok_and(|name| name == "Color")
            })?;
            unsafe {
                let panel = panel.CurrentBoundingRectangle().ok()?;
                let trigger = trigger.CurrentBoundingRectangle().ok()?;
                (panel.bottom <= trigger.top || panel.top >= trigger.bottom).then_some(panel)
            }
        })?;
        let mut window_rect = RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut window_rect)?;
        }
        assert!(
            panel.left >= window_rect.left
                && panel.right <= window_rect.right
                && panel.bottom <= window_rect.bottom
        );
        key(hwnd, 0x1b)?;
        wait("positioned color panel closed", || {
            field(hwnd, "Hex color value").is_none().then_some(())
        })?;
    }
    command(window(pid, w!("Patina GPUI")).ok_or("missing host")?, 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}
