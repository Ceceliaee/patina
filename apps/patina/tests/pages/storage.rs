use super::*;
use chrono::Datelike;

#[test]
#[ignore = "isolated Win32 desktop"]
fn settings_storage_card() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina::APP_ID);
    fs::create_dir(&dir)?;
    seed(&dir.join("patina.db"))?;
    let mut child = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .arg("--today")
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .spawn()?,
    );
    let pid = child.0.id();
    let hwnd = wait("main", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "Settings")?;
    wait("storage", || named(hwnd, "Storage"))?;
    let dialog = |title: &str| {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_WindowControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == title)
        })
    };
    let surface = || {
        controls(hwnd)
            .ok()?
            .into_iter()
            .find(|el| unsafe {
                el.CurrentAutomationId()
                    .is_ok_and(|id| id == "storage-dialog-surface")
            })
            .and_then(|el| unsafe { el.CurrentBoundingRectangle().ok() })
    };
    for (i, (entry, title, inside)) in [
        ("Export", "Data Export", "Format"),
        ("Import", "Choose import method", "Import CSV"),
        ("Back up", "Choose backup location", "Local backup"),
        ("Restore", "Choose restore source", "Local restore"),
        ("Edit", "WebDAV configuration", "Server address"),
        ("Clear history records", "Clear history records", "Clear"),
    ]
    .into_iter()
    .enumerate()
    {
        press(hwnd, entry)?;
        wait(title, || dialog(title))?;
        wait(inside, || named(hwnd, inside))?;
        let dismiss = if matches!(entry, "Export" | "Edit" | "Clear history records") {
            "Cancel"
        } else {
            "Close"
        };
        wait("dialog loaded", || {
            button(hwnd, dismiss)
                .filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
        })?;
        assert!(
            named(
                hwnd,
                &patina_recorder::text(patina_recorder::Locale::EnUs, "settings.dataExportTitle")
            )
            .is_some(),
            "storage card replaced by dialog"
        );
        let rect = wait("dialog surface", surface)?;
        if matches!(entry, "Import" | "Back up" | "Restore") {
            let mut window = RECT::default();
            unsafe {
                GetWindowRect(hwnd, &mut window)?;
            }
            assert!(
                rect.bottom - rect.top < (window.bottom - window.top) / 2,
                "short dialog should fit content: {entry}: {rect:?}"
            );
        }
        if i % 2 == 0 {
            key(hwnd, 0x1b)?;
        } else {
            press(hwnd, dismiss)?;
        }
        wait(&format!("{entry} dialog dismissed"), || {
            dialog(title).is_none().then_some(())
        })?;
        wait("storage ready", || {
            button(hwnd, entry)
                .filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
        })?;
        // Exercise restored focus without requiring the isolated desktop to be foreground.
        key(hwnd, 13)?;
        wait(&format!("{entry} reopens from restored focus"), || {
            dialog(title)
        })?;
        wait("dialog ready", || {
            button(hwnd, dismiss)
                .filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
        })?;
        key(hwnd, 27)?;
        wait("reopened dialog dismissed", || {
            dialog(title).is_none().then_some(())
        })?;
    }
    for (entry, nested) in [
        ("Export", "Scheduled export"),
        ("Back up", "Scheduled backup · Local backup"),
        ("Import", "Delete external imported data"),
    ] {
        press(hwnd, entry)?;
        press(hwnd, nested)?;
        wait(nested, || {
            dialog(if entry == "Back up" {
                "Scheduled backup"
            } else {
                nested
            })
        })?;
        wait("nested view loaded", || {
            button(hwnd, if entry == "Import" { "Close" } else { "Cancel" })
                .filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
        })?;
        key(hwnd, 0x1b)?;
        wait("nested dialog dismissed", || {
            dialog(if entry == "Back up" {
                "Scheduled backup"
            } else {
                nested
            })
            .is_none()
            .then_some(())
        })?;
        let parent = match entry {
            "Export" => "Data Export",
            "Back up" => "Choose backup location",
            _ => "Choose import method",
        };
        wait("returned to parent", || dialog(parent))?;
        key(hwnd, 0x1b)?;
        wait("parent dismissed", || {
            dialog(parent).is_none().then_some(())
        })?;
    }
    press(hwnd, "Export")?;
    wait("export dialog", || dialog("Data Export"))?;
    press(hwnd, "Open range picker")?;
    wait("export calendar", || dialog("Select range"))?;
    press(hwnd, "Previous month")?;
    let previous_month = (Local::now().date_naive().with_day(1).unwrap()
        - chrono::Duration::days(1))
    .with_day(1)
    .unwrap();
    let first = previous_month.to_string();
    let last = previous_month.succ_opt().unwrap().to_string();
    for day in [&first, &last] {
        let cell = wait(day, || {
            controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentControlType().ok() != Some(UIA_ButtonControlTypeId)
                    && el.CurrentName().is_ok_and(|name| name == day.as_str())
            })
        })?;
        activate_control(hwnd, &cell, false)?;
    }
    press(hwnd, "Apply")?;
    wait("calendar returns to export", || dialog("Data Export"))?;
    press(hwnd, "Open range picker")?;
    wait("selected date range retained", || {
        named(hwnd, &format!("{first} – {last}"))
    })?;
    key(hwnd, 27)?;
    wait("calendar cancel returns to export", || {
        dialog("Data Export")
    })?;
    let format_option = |name: &str| {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_RadioButtonControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == name)
        })
    };
    let formats = ["CSV", "Markdown", "Parquet", "SQLite"].map(|name| unsafe {
        format_option(name)
            .unwrap()
            .CurrentBoundingRectangle()
            .unwrap()
    });
    unsafe {
        format_option("CSV").ok_or("CSV segment")?.SetFocus()?;
    }
    key(hwnd, 0x27)?;
    wait("format selection moves right", || unsafe {
        let selected = format_option("Markdown")?
            .GetCurrentPatternAs::<IUIAutomationSelectionItemPattern>(UIA_SelectionItemPatternId)
            .ok()?;
        selected.CurrentIsSelected().ok()?.as_bool().then_some(())
    })?;
    key(hwnd, 0x25)?;
    for pair in formats.windows(2) {
        assert_eq!(pair[0].top, pair[1].top, "formats share one row");
        // UIA rounds fractional DPI bounds outwards; adjacent segments may
        // share one physical pixel even though their layout boxes only touch.
        assert!(
            pair[0].right <= pair[1].left + 1,
            "formats do not overlap: {pair:?}"
        );
    }
    let cancel = unsafe {
        button(hwnd, "Cancel")
            .ok_or("cancel")?
            .CurrentBoundingRectangle()?
    };
    let export = unsafe {
        button(hwnd, "Export")
            .ok_or("export")?
            .CurrentBoundingRectangle()?
    };
    assert_eq!(cancel.top, export.top, "footer actions share one row");
    assert!(cancel.top > formats[0].bottom, "actions below form");
    press(hwnd, "Configure Fields")?;
    wait("field dialog", || dialog("Export Field Configuration"))?;
    let groups = [
        "Activity basics",
        "App information",
        "Web information",
        "Classification",
        "Time analysis",
        "Source and audit",
    ];
    for name in groups {
        assert!(button(hwnd, &format!("Expand · {name}")).is_some());
    }
    let collapsed = wait("collapsed field bounds", surface)?;
    press(hwnd, "Expand · Activity basics")?;
    wait("field group expands height", || {
        let bounds = surface()?;
        (bounds.bottom - bounds.top > collapsed.bottom - collapsed.top).then_some(())
    })?;
    let checkbox = |name: &str| {
        wait(name, || {
            controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentControlType().ok() == Some(UIA_CheckBoxControlTypeId)
                    && el.CurrentName().is_ok_and(|n| n == name)
            })
        })
    };
    let toggle = |name: &str| -> Result<(), Error> {
        let el = checkbox(name)?;
        unsafe {
            el.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)?
                .Toggle()?;
        }
        Ok(())
    };
    let group_state = |name: &str, state: ToggleState| -> Result<(), Error> {
        wait("group checkbox state", || unsafe {
            let el = checkbox(name).ok()?;
            let toggle = el
                .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
                .ok()?;
            (toggle.CurrentToggleState().ok()? == state).then_some(())
        })?;
        Ok(())
    };
    group_state("Select all · Activity basics", ToggleState_Indeterminate)?;
    toggle("Select all · Activity basics")?;
    wait("all activity fields selected", || named(hwnd, "8/8"))?;
    group_state("Deselect all · Activity basics", ToggleState_On)?;
    let field = checkbox("Record Type")?;
    let bounds = unsafe { field.CurrentBoundingRectangle()? };
    let dpi = unsafe { GetDpiForWindow(hwnd) } as f32 / 96.;
    assert!(((bounds.bottom - bounds.top) as f32 - 28. * dpi).abs() <= 1.);
    assert!(((bounds.right - bounds.left) as f32 - 28. * dpi).abs() <= 1.);
    let next_bounds = unsafe { checkbox("Start Time")?.CurrentBoundingRectangle()? };
    assert!(
        ((next_bounds.top - bounds.top) as f32 - 36. * dpi).abs() <= 1.,
        "36px row spacing"
    );
    let field_label = controls(hwnd)?
        .into_iter()
        .find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_TextControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == "Record Type")
        })
        .ok_or("record type label")?;
    activate_control(hwnd, &field_label, false)?;
    activate_control(hwnd, &field, false)?;
    wait("only checkbox click toggles the field", || {
        named(hwnd, "7/8")
    })?;
    activate_control(hwnd, &field, false)?;
    wait("checkbox click restores selection", || named(hwnd, "8/8"))?;
    unsafe { field.SetFocus()? };
    key(hwnd, 0x20)?;
    wait("space toggles one field", || named(hwnd, "7/8"))?;
    group_state("Select all · Activity basics", ToggleState_Indeterminate)?;
    toggle("Select all · Activity basics")?;
    toggle("Deselect all · Activity basics")?;
    wait("all activity fields cleared", || named(hwnd, "0/8"))?;
    group_state("Select all · Activity basics", ToggleState_Off)?;
    toggle("Select all · Activity basics")?;
    press(hwnd, "Collapse · Activity basics")?;
    wait("field dialog shrinks", || {
        let bounds = surface()?;
        ((bounds.bottom - bounds.top - (collapsed.bottom - collapsed.top)).abs() <= 2).then_some(())
    })?;
    press(hwnd, "Cancel")?;
    wait("return to export", || dialog("Data Export"))?;
    key(hwnd, 13)?;
    wait("field trigger focus restored", || {
        dialog("Export Field Configuration")
    })?;
    wait("cancel restores field draft", || named(hwnd, "4/8"))?;
    for name in groups {
        let selected = format!("Select all · {name}");
        let deselected = format!("Deselect all · {name}");
        if controls(hwnd)?
            .iter()
            .any(|el| unsafe { el.CurrentName().is_ok_and(|n| n == selected) })
        {
            toggle(&selected)?;
        }
        wait("group selected", || {
            controls(hwnd)
                .ok()?
                .into_iter()
                .find(|el| unsafe { el.CurrentName().is_ok_and(|n| n == deselected) })
        })?;
        toggle(&deselected)?;
    }
    wait("empty field selection blocks confirmation", || {
        button(hwnd, "Confirm")
            .filter(|el| unsafe { el.CurrentIsEnabled().is_ok_and(|v| !v.as_bool()) })
    })?;
    press(hwnd, "Restore defaults for this format")?;
    wait("format defaults restored", || named(hwnd, "4/8"))?;
    for name in groups {
        press(hwnd, &format!("Expand · {name}"))?;
    }
    wait("all grouped fields available", || {
        let count = controls(hwnd)
            .ok()?
            .into_iter()
            .filter(|el| unsafe { el.CurrentControlType().ok() == Some(UIA_CheckBoxControlTypeId) })
            .count();
        (count == 38).then_some(())
    })?;
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            900,
            560,
            SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE,
        )?;
    }
    wait("field dialog fits small window", || {
        let r = surface()?;
        let mut w = RECT::default();
        unsafe {
            GetWindowRect(hwnd, &mut w).ok()?;
        }
        (r.top > w.top && r.bottom < w.bottom).then_some(())
    })?;
    let confirm = unsafe {
        button(hwnd, "Confirm")
            .ok_or("confirm")?
            .CurrentBoundingRectangle()?
    };
    let bounds = wait("field dialog bounds", surface)?;
    assert!(
        confirm.top >= bounds.top && confirm.bottom <= bounds.bottom,
        "footer remains visible with long content"
    );
    press(hwnd, "Confirm")?;
    wait("fields applied", || dialog("Data Export"))?;
    key(hwnd, 27)?;
    wait("export closed", || {
        dialog("Data Export").is_none().then_some(())
    })?;
    press(hwnd, "Export")?;
    wait("export dialog", || dialog("Data Export"))?;
    unsafe {
        PostMessageW(
            Some(hwnd),
            WM_LBUTTONDOWN,
            WPARAM(1),
            LPARAM((80 << 16) | 8),
        )?;
        PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), LPARAM((80 << 16) | 8))?;
    }
    wait("backdrop dismisses dialog", || {
        dialog("Data Export").is_none().then_some(())
    })?;
    let tray = window(pid, w!("Patina GPUI")).ok_or("missing tray")?;
    command(tray, 2)?;
    assert!(wait("exit", || child.0.try_wait().ok().flatten())?.success());
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn settings_webdav_layout() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina::APP_ID);
    fs::create_dir(&dir)?;
    seed(&dir.join("patina.db"))?;
    let mut child = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .arg("--today")
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .spawn()?,
    );
    let pid = child.0.id();
    let hwnd = wait("main", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "Settings")?;
    wait("storage", || named(hwnd, "Storage"))?;
    let edit = wait("WebDAV edit", || {
        button(hwnd, "Edit").filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
    })?;
    unsafe {
        edit.SetFocus()?;
    }
    key(hwnd, 13)?;
    wait("WebDAV fields ready", || {
        button(hwnd, "Test connection")
            .filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
    })
    .map_err(|e| format!("{e}; nodes {:?}", names(hwnd)))?;
    let mut inputs = Vec::new();
    for name in ["Server address", "Username", "App password"] {
        let input = wait(name, || {
            controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                    && el.CurrentName().is_ok_and(|n| n == name)
            })
        })?;
        inputs.push(unsafe { input.CurrentBoundingRectangle()? });
    }
    assert!(inputs[0].bottom < inputs[1].top && inputs[1].bottom < inputs[2].top);
    assert!(!controls(hwnd)?.into_iter().any(|el| unsafe {
        el.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
            && el.CurrentName().is_ok_and(|n| n == "Remote folder")
    }));
    let suffix = wait("remote folder suffix", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentAutomationId()
                .is_ok_and(|id| id == "dav-directory-suffix")
        })
    })?;
    let suffix = unsafe { suffix.CurrentBoundingRectangle()? };
    assert!(
        suffix.left >= inputs[0].right
            && suffix.top < inputs[0].bottom
            && suffix.bottom > inputs[0].top,
        "remote folder belongs beside the server address"
    );
    click(hwnd, "Cancel")?;
    wait("WebDAV closed", || {
        named(hwnd, "Server address").is_none().then_some(())
    })?;
    key(hwnd, 13)?;
    wait("WebDAV reopened from trigger focus", || {
        named(hwnd, "Server address")
    })?;
    key(hwnd, 27)?;
    wait("WebDAV Escape", || {
        named(hwnd, "Server address").is_none().then_some(())
    })?;
    let tray = window(pid, w!("Patina GPUI")).ok_or("missing tray")?;
    command(tray, 2)?;
    assert!(wait("exit", || child.0.try_wait().ok().flatten())?.success());
    Ok(())
}
