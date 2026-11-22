use super::classification_color::{field, set, value};
use super::*;

fn click(hwnd: HWND, name: &str) -> Result<(), Error> {
    super::click(hwnd, name).map_err(|e| format!("click {name}: {e}").into())
}

fn setting(db: &Path, key: &str) -> Option<String> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .ok()?
        .block_on(async {
            let mut conn =
                SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db))
                    .await
                    .ok()?;
            sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
                .bind(key)
                .fetch_optional(&mut conn)
                .await
                .ok()
                .flatten()
        })
}
pub(super) fn close_manager(hwnd: HWND) -> Result<(), Error> {
    click(hwnd, "Close")?;
    wait("manager closed", || {
        button(hwnd, "Close").is_none().then_some(())
    })?;
    Ok(())
}
pub(super) fn finish_color(hwnd: HWND) -> Result<(), Error> {
    key(hwnd, 0x1b)?;
    wait("category color picker closed", || {
        field(hwnd, "Hex color value").is_none().then_some(())
    })?;
    wait("manager remains open", || button(hwnd, "Close"))?;
    Ok(())
}

fn name_dialog(hwnd: HWND, title: &str) -> Result<(), Error> {
    wait("named category dialog", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_WindowControlTypeId)
                && el.CurrentName().is_ok_and(|name| name == title)
        })
    })?;
    name_field_receives_typing(hwnd)?;
    let stops = if unsafe { button(hwnd, "Apply").unwrap().CurrentIsEnabled()?.as_bool() } {
        3
    } else {
        2
    };
    for _ in 0..stops {
        key(hwnd, 9)?;
    }
    name_field_receives_typing(hwnd)?;
    let input = unsafe {
        field(hwnd, "New category name")
            .unwrap()
            .CurrentBoundingRectangle()?
    };
    let last_row = unsafe {
        button(hwnd, "Rename category: Utility")
            .unwrap()
            .CurrentBoundingRectangle()?
    };
    assert!(
        input.top < last_row.top,
        "name editor overlays the list instead of extending its bottom"
    );
    Ok(())
}

fn name_field_receives_typing(hwnd: HWND) -> Result<(), Error> {
    let before = value(hwnd, "New category name").ok_or("missing category name")?;
    // The isolated desktop does not report foreground keyboard focus through UIA.
    // Type without SetFocus to verify the dialog's actual input target instead.
    unsafe {
        PostMessageW(Some(hwnd), WM_CHAR, WPARAM('x' as usize), LPARAM(1))?;
    }
    wait("name field receives keyboard input", || {
        value(hwnd, "New category name").filter(|after| after != &before)
    })?;
    unsafe {
        field(hwnd, "New category name")
            .unwrap()
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?
            .SetValue(&before.as_str().into())?;
    }
    wait("name field restored", || {
        (value(hwnd, "New category name") == Some(before.clone())).then_some(())
    })?;
    Ok(())
}

fn name_dialog_closed(hwnd: HWND, trigger: &str) -> Result<(), Error> {
    wait("name dialog closed", || {
        field(hwnd, "New category name").is_none().then_some(())
    })?;
    key(hwnd, 32)?;
    wait("Space reopens the focused category action", || {
        field(hwnd, "New category name")
    })?;
    assert_eq!(
        value(hwnd, "New category name").as_deref(),
        Some(trigger.strip_prefix("Rename category: ").unwrap_or(""))
    );
    key(hwnd, 0x1b)?;
    wait("reopened name dialog closed", || {
        field(hwnd, "New category name").is_none().then_some(())
    })?;
    assert!(
        button(hwnd, "Close").is_some(),
        "parent manager remains open"
    );
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn category_manager_content_width_and_narrow_layout() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    // These fit in two columns at the default window size, but require one at the minimum size.
    let labels = ["AAA WWWWWWWWWWWWWWWWWWWW", "AAB"];
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    for tag in ["zh-CN", "en-US", "ru-RU", "es"] {
        let root = tempfile::tempdir()?;
        let profile = root.path().join(patina::PROFILE_DIRECTORY);
        fs::create_dir(&profile)?;
        let db = profile.join("patina.db");
        seed(&db)?;
        rt.block_on(async {
            let mut c =
                SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
            sqlx::query("UPDATE settings SET value=? WHERE key='language'")
                .bind(tag)
                .execute(&mut c)
                .await?;
            for (index, label) in labels.iter().enumerate() {
                for (key, value) in [
                    (format!("__custom_category::custom:width_{index}"), "1"),
                    (
                        format!("__category_label_override::custom:width_{index}"),
                        *label,
                    ),
                ] {
                    sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)")
                        .bind(key)
                        .bind(value)
                        .execute(&mut c)
                        .await?;
                }
            }
            Ok::<_, Error>(())
        })?;
        let mut host = TestChild(
            Command::new(env!("CARGO_BIN_EXE_patina"))
                .env("PATINA_PROFILE_PARENT", root.path())
                .env_remove("PATINA_DEV_SESSION")
                .stderr(fs::File::create(root.path().join("renderer.log"))?)
                .arg("--today")
                .spawn()?,
        );
        let hwnd = wait("Today", || {
            children::find(host.0.id(), |p| window(p, w!("Patina")))
        })?;
        let locale = patina_activity::Locale::from_tag(Some(tag));
        navigate_sidebar(hwnd, locale, "mapping.title")?;
        click(
            hwnd,
            &patina_activity::text(locale, "mapping.categoryControl"),
        )?;
        let action = |key, label: &str| {
            patina_activity::format_text(locale, key, &[("label", label.to_owned())])
        };
        let bounds = |name: &str| -> Option<RECT> {
            unsafe { button(hwnd, name)?.CurrentBoundingRectangle().ok() }
        };
        let first_name = action("mapping.renameCategory", labels[0]);
        let second_name = action("mapping.renameCategory", labels[1]);
        let delete_name = action("mapping.deleteCategory", labels[0]);
        let color_name = format!(
            "{} ･ {}",
            patina_activity::text(locale, "mapping.color"),
            labels[0]
        );
        let dpi = unsafe { GetDpiForWindow(hwnd) } as i32;
        for (width, height, single_column) in
            [(1080, 720, false), (810, 540, true), (1080, 720, false)]
        {
            unsafe {
                SetWindowPos(
                    hwnd,
                    None,
                    0,
                    0,
                    width * dpi / 96,
                    height * dpi / 96,
                    SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOZORDER,
                )?;
            }
            let (first, second, color) = wait(&format!("{tag} category layout at {width}"), || {
                let first = bounds(&first_name)?;
                let second = bounds(&second_name)?;
                let color = bounds(&color_name)?;
                let second_color = bounds(&format!(
                    "{} ･ {}",
                    patina_activity::text(locale, "mapping.color"),
                    labels[1]
                ))?;
                let delete = bounds(&delete_name)?;
                let name = unsafe { named(hwnd, labels[0])?.CurrentBoundingRectangle().ok()? };
                let second_label =
                    unsafe { named(hwnd, labels[1])?.CurrentBoundingRectangle().ok()? };
                let correct_columns = if single_column {
                    color.left == second_color.left && first.top != second.top
                } else {
                    first.top == second.top && first.left != second.left
                };
                // Keep the full name before the pencil, color and delete controls.
                (correct_columns
                    && name.right - name.left >= 240 * dpi / 96
                    && name.right <= first.left
                    && first.left - name.right <= 5 * dpi / 96
                    && second.left - second_label.right <= 5 * dpi / 96
                    && second.left >= second_label.right
                    && second.right < second_color.left
                    && first.right <= color.left
                    && color.right <= delete.left)
                    .then_some((first, second, color))
            })
            .map_err(|e| {
                format!(
                    "{e}; pencil {:?}; color {:?}; delete {:?}; name {:?}",
                    bounds(&first_name),
                    bounds(&color_name),
                    bounds(&delete_name),
                    named(hwnd, labels[0])
                        .and_then(|el| unsafe { el.CurrentBoundingRectangle().ok() })
                )
            })?;
            let mut window_rect = RECT::default();
            unsafe {
                GetWindowRect(hwnd, &mut window_rect)?;
            }
            assert!(
                color.left >= window_rect.left
                    && first.right <= window_rect.right
                    && second.right <= window_rect.right
            );
        }
        command(
            window(host.0.id(), w!("Patina Tray")).ok_or("missing tray")?,
            2,
        )?;
        assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    }
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn category_manager_drafts_and_persistence() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let mut c = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        for (key,value) in [
            ("__custom_category::custom:category_research","1"),
            ("__category_label_override::custom:category_research","Research"),
            ("__category_color_override::custom:category_research","#112233"),
            ("__app_override::studio.exe",r##"{"category":"custom:category_research","displayName":"Studio","color":"#AABBCC","captureTitle":false}"##),
            ("__web_domain_override::example.com",r#"{"category":"custom:category_research","enabled":false,"knownDomain":true}"#),
        ] { sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)").bind(key).bind(value).execute(&mut c).await?; }
        Ok::<_,Error>(())
    })?;
    let mut host = TestChild(
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .env("PATINA_PROFILE_PARENT", root.path())
            .env_remove("PATINA_DEV_SESSION")
            .stderr(fs::File::create(root.path().join("renderer.log"))?)
            .arg("--today")
            .spawn()?,
    );
    let pid = host.0.id();
    let hwnd = wait("Today", || children::find(pid, |p| window(p, w!("Patina"))))?;
    click(hwnd, "Classification")?;
    click(hwnd, "Manage")?;
    wait("learning category rendered", || {
        button(hwnd, "Rename category: Learning")
    })?;
    assert!(button(hwnd, "Rename category: AI").is_none());
    assert!(button(hwnd, "Rename category: Music").is_none());
    let bounds = |name: &str| -> Result<RECT, Error> {
        Ok(unsafe { wait(name, || button(hwnd, name))?.CurrentBoundingRectangle()? })
    };
    let create = bounds("New category")?;
    let close = bounds("Close")?;
    assert_eq!(create.top, close.top);
    assert!(create.left < close.left);
    let first = bounds("Color ･ Browser")?;
    assert!(close.bottom < first.top);
    let second = bounds("Color ･ Creation")?;
    let third = bounds("Color ･ Development")?;
    assert_eq!(first.top, second.top);
    assert!(first.left < second.left);
    assert!(third.top > first.top);
    assert_eq!(third.left, first.left);
    assert!(button(hwnd, "Delete category: Unclassified").is_none());
    for name in ["Browser", "Creation", "Social", "Utility"] {
        let trigger = bounds(&format!("Color ･ {name}"))?;
        click(hwnd, &format!("Color ･ {name}"))?;
        let panel = wait("category color panel above or below its trigger", || {
            let panel = controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentControlType().ok() == Some(UIA_GroupControlTypeId)
                    && el.CurrentName().is_ok_and(|name| name == "Color")
            })?;
            let panel = unsafe { panel.CurrentBoundingRectangle().ok()? };
            (panel.bottom <= trigger.top || panel.top >= trigger.bottom).then_some(panel)
        })?;
        let mut window_rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut window_rect)? };
        assert!(
            panel.left >= window_rect.left
                && panel.right <= window_rect.right
                && panel.top >= window_rect.top
                && panel.bottom <= window_rect.bottom
        );
        finish_color(hwnd)?;
    }
    click(hwnd, "New category")?;
    name_dialog(hwnd, "New category")?;
    key(hwnd, 0x1b)?;
    name_dialog_closed(hwnd, "New category")?;
    click(hwnd, "New category")?;
    name_dialog(hwnd, "New category")?;
    let backdrop = LPARAM(80isize << 16 | 180);
    unsafe {
        PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), backdrop)?;
        PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), backdrop)?;
    }
    name_dialog_closed(hwnd, "New category")?;
    click(hwnd, "Rename category: Research")?;
    name_dialog(hwnd, "Rename category")?;
    click(hwnd, "Cancel")?;
    name_dialog_closed(hwnd, "Rename category: Research")?;
    assert_eq!(
        bounds("Close")?.top,
        close.top,
        "manager keeps its original height"
    );
    click(hwnd, "Color ･ Research")?;
    wait("stored category color", || {
        (value(hwnd, "Hex color value").as_deref() == Some("#112233")).then_some(())
    })
    .map_err(|e| {
        format!(
            "{e}; value {:?}; nodes {:?}",
            value(hwnd, "Hex color value"),
            names(hwnd)
        )
    })?;
    set(hwnd, "Hex color value", "#224466")?;
    finish_color(hwnd)?;
    close_manager(hwnd)?;
    click(hwnd, "Cancel")?;
    wait("draft discarded", || unsafe {
        (!button(hwnd, "Cancel")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    click(hwnd, "Manage")?;
    click(hwnd, "Color ･ Research")?;
    wait("cancel restores category color", || {
        (value(hwnd, "Hex color value").as_deref() == Some("#112233")).then_some(())
    })?;
    click(hwnd, "Restore default color")?;
    wait("category color reset", || {
        (value(hwnd, "Hex color value").as_deref() == Some("#5A9861")).then_some(())
    })?;
    finish_color(hwnd)?;
    close_manager(hwnd)?;
    click(hwnd, "Save")?;
    wait("reset category override persisted", || {
        setting(&db, "__category_color_override::custom:category_research")
            .is_none()
            .then_some(())
    })?;
    wait("reset save finished", || unsafe {
        (!button(hwnd, "Save")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    click(hwnd, "Manage")?;
    click(hwnd, "Color ･ Research")?;
    wait("reopened default category color", || {
        (value(hwnd, "Hex color value").as_deref() == Some("#5A9861")).then_some(())
    })?;
    set(hwnd, "Hex color value", "#224466")?;
    finish_color(hwnd)?;
    click(hwnd, "Rename category: Research")?;
    name_dialog(hwnd, "Rename category")?;
    set(hwnd, "New category name", "Research Work")?;
    wait("category renamed within manager", || {
        button(hwnd, "Rename category: Research Work")
    })?;
    name_dialog_closed(hwnd, "Rename category: Research Work")?;
    click(hwnd, "New category")?;
    name_dialog(hwnd, "New category")?;
    wait("empty name cannot apply", || unsafe {
        (!button(hwnd, "Apply")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    set(hwnd, "New category name", "Study")?;
    wait("new category in manager", || {
        button(hwnd, "Delete category: Study")
    })?;
    name_dialog_closed(hwnd, "New category")?;
    close_manager(hwnd)?;
    click(hwnd, "Save")?;
    wait("category edits persisted", || {
        (setting(&db, "__category_label_override::custom:category_research").as_deref()
            == Some("Research Work")
            && setting(&db, "__category_color_override::custom:category_research").as_deref()
                == Some("#224466"))
        .then_some(())
    })?;
    wait("save finished", || unsafe {
        (!button(hwnd, "Save")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    click(hwnd, "Manage")?;
    let manager_top = bounds("Close")?.top;
    click(hwnd, "Delete category: Study")?;
    wait("independent delete confirmation", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_WindowControlTypeId)
                && el.CurrentName().is_ok_and(|name| name == "Delete category")
        })
    })?;
    assert!(
        button(hwnd, "Delete category: Study").is_some(),
        "category remains until confirmation"
    );
    assert_eq!(
        bounds("Close")?.top,
        manager_top,
        "parent list retains its layout"
    );
    key(hwnd, 32)?;
    wait("initial focus is safe Cancel action", || {
        button(hwnd, "Continue").is_none().then_some(())
    })?;
    assert!(button(hwnd, "Delete category: Study").is_some());
    key(hwnd, 32)?;
    wait("focus returns to delete trigger", || {
        button(hwnd, "Continue")
    })?;
    key(hwnd, 0x1b)?;
    wait("Escape cancels deletion", || {
        button(hwnd, "Continue").is_none().then_some(())
    })?;
    assert!(button(hwnd, "Delete category: Study").is_some());
    click(hwnd, "Delete category: Study")?;
    click(hwnd, "Continue")?;
    wait("category removed from draft", || {
        button(hwnd, "Delete category: Study")
            .is_none()
            .then_some(())
    })?;
    click(hwnd, "Rename category: Research Work")?;
    set(hwnd, "New category name", "Office")?;
    wait("merge confirmation", || {
        named(hwnd, "Merge matching category")
    })?;
    key(hwnd, 0x1b)?;
    name_dialog(hwnd, "Rename category")?;
    set(hwnd, "New category name", "Office")?;
    wait("merge confirmation reopened", || {
        named(hwnd, "Merge matching category")
    })?;
    click(hwnd, "Confirm")?;
    wait("source category merged", || {
        button(hwnd, "Delete category: Research Work")
            .is_none()
            .then_some(())
    })?;
    close_manager(hwnd)?;
    click(hwnd, "Save")?;
    wait("merge persisted", || {
        setting(&db, "__custom_category::custom:category_research")
            .is_none()
            .then_some(())
    })?;
    let app: serde_json::Value =
        serde_json::from_str(&setting(&db, "__app_override::studio.exe").ok_or("app missing")?)?;
    assert_eq!(app["category"], "office");
    assert_eq!(app["color"], "#AABBCC");
    assert_eq!(app["captureTitle"], false);
    let web: serde_json::Value = serde_json::from_str(
        &setting(&db, "__web_domain_override::example.com").ok_or("web missing")?,
    )?;
    assert_eq!(web["category"], "office");
    assert_eq!(web["enabled"], false);
    assert_eq!(web["knownDomain"], true);
    assert_eq!(
        setting(&db, "__category_color_override::office").as_deref(),
        Some("#6f7ae6")
    );
    wait("merge save finished", || unsafe {
        (!button(hwnd, "Save")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    click(hwnd, "Manage")?;
    click(hwnd, "Delete category: Office")?;
    click(hwnd, "Continue")?;
    wait("office removed from draft", || {
        button(hwnd, "Delete category: Office")
            .is_none()
            .then_some(())
    })?;
    close_manager(hwnd)?;
    click(hwnd, "Save")?;
    wait("app and website become unclassified", || {
        [
            "__app_override::studio.exe",
            "__web_domain_override::example.com",
        ]
        .iter()
        .all(|key| {
            setting(&db, key)
                .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
                .is_some_and(|value| value["category"] == "other")
        })
        .then_some(())
    })?;
    let app: serde_json::Value =
        serde_json::from_str(&setting(&db, "__app_override::studio.exe").ok_or("app deleted")?)?;
    assert_eq!(app["displayName"], "Studio");
    assert_eq!(app["color"], "#AABBCC");
    assert_eq!(app["captureTitle"], false);
    let web: serde_json::Value = serde_json::from_str(
        &setting(&db, "__web_domain_override::example.com").ok_or("website deleted")?,
    )?;
    assert_eq!(web["enabled"], false);
    assert_eq!(web["knownDomain"], true);
    let count: i64 = rt.block_on(async {
        let mut c =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE exe_name='studio.exe'")
            .fetch_one(&mut c)
            .await
    })?;
    assert!(
        count > 0,
        "category removal must retain application history"
    );
    command(window(pid, w!("Patina Tray")).ok_or("missing host")?, 2)?;
    assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
    Ok(())
}
