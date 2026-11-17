use super::classification_color::{field, set};
use super::*;

#[test]
#[ignore = "isolated Win32 desktop"]
fn classification_app_web_switch_preserves_drafts() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina_gpui::APP_ID);
    fs::create_dir(&dir)?;
    let db = dir.join("patina.db");
    seed(&db)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let mut c =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        for (key, value) in [
            ("web_activity_enabled", "1"),
            (
                "__web_domain_override::a.example.com",
                r#"{"knownDomain":true}"#,
            ),
            (
                "__web_domain_override::b.example.com",
                r#"{"knownDomain":true}"#,
            ),
            (
                "__web_domain_override::sample.org",
                r#"{"knownDomain":true}"#,
            ),
            (
                "__web_site::example.com",
                r#"{"version":2,"displayName":"Example","category":"office"}"#,
            ),
        ] {
            sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)")
                .bind(key)
                .bind(value)
                .execute(&mut c)
                .await?;
        }
        let svg = br##"<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><path fill="#2060c0" d="M0 0h32v32H0z"/></svg>"##;
        let icon = format!("data:image/svg+xml;base64,{}", base64::Engine::encode(&base64::engine::general_purpose::STANDARD, svg));
        sqlx::query("INSERT INTO web_favicon_cache(normalized_domain,favicon_url,updated_at) VALUES('a.example.com',?,0)")
            .bind(icon).execute(&mut c).await?;
        Ok::<_, Error>(())
    })?;
    let launch = || -> Result<(TestChild, HWND), Error> {
        let host = TestChild(
            Command::new(env!("CARGO_BIN_EXE_patina-gpui"))
                .env("PATINA_GPUI_PROFILE_PARENT", root.path())
                .env_remove("PATINA_GPUI_DEV_SESSION")
                .stderr(fs::File::create(
                    root.path().join("web-classification.log"),
                )?)
                .arg("--today")
                .spawn()?,
        );
        let hwnd = wait("Today", || {
            children::find(host.0.id(), |p| window(p, w!("Patina")))
        })?;
        click(hwnd, "Classification")?;
        Ok((host, hwnd))
    };
    let (mut host, hwnd) = launch()?;
    wait("app totals", || {
        (classification_filter_counts(hwnd) == Some([2, 2, 0])).then_some(())
    })?;
    set(hwnd, "Search apps", "studio.exe")?;
    click(hwnd, "Edit app name")?;
    set(hwnd, "Edit app name", "Temporary")?;
    click(hwnd, "Edit app name")?;
    set(hwnd, "Edit app name", "Studio")?;
    wait("reverted app name is clean", || unsafe {
        (!button(hwnd, "Save")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    click(hwnd, "Color")?;
    super::classification_color::format(hwnd, "RGB")?;
    key(hwnd, 0x1b)?;
    click(hwnd, "Clear search")?;
    select_segment(hwnd, "Web")?;
    wait("website search and totals", || {
        field(hwnd, "Search websites")?;
        (classification_filter_counts(hwnd) == Some([2, 1, 1])).then_some(())
    })?;
    wait("website favicon rendered", || {
        controls(hwnd).ok()?.into_iter().find(|e| unsafe {
            e.CurrentControlType().ok() == Some(UIA_ImageControlTypeId)
                && e.CurrentName().is_ok_and(|name| name == "Example")
        })
    })?;
    click(hwnd, "Color")?;
    wait("web shares app RGB format", || field(hwnd, "Red channel"))?;
    super::classification_color::format(hwnd, "HSL")?;
    key(hwnd, 0x1b)?;
    click(hwnd, "Manage")?;
    click(hwnd, "Color · Office")?;
    wait("category shares web HSL format", || {
        field(hwnd, "Lightness")
    })?;
    super::classification_color::format(hwnd, "HEX")?;
    key(hwnd, 0x1b)?;
    click(hwnd, "Close")?;
    wait("format changes alone remain clean", || unsafe {
        (!button(hwnd, "Save")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    click(hwnd, "Automatic group: example.com")?;
    wait("website member menu", || {
        button(hwnd, "Show separately: a.example.com")
    })?;
    let member_title = wait("member title policy", || {
        named(hwnd, "Record titles: a.example.com")
    })?;
    activate_control(hwnd, &member_title, false)?;
    key(hwnd, 0x1b)?;
    wait("mixed website title policy", || unsafe {
        (named(hwnd, "Record titles")?
            .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
            .ok()?
            .CurrentToggleState()
            .ok()?
            == ToggleState_Indeterminate)
            .then_some(())
    })?;
    click(hwnd, "Automatic group: example.com")?;
    click(hwnd, "Show separately: a.example.com")?;
    wait("independent domain appears", || {
        (classification_filter_counts(hwnd) == Some([3, 1, 2])).then_some(())
    })?;
    click(hwnd, "Merge into example.com")?;
    wait("domain merged back", || {
        (classification_filter_counts(hwnd) == Some([2, 1, 1])).then_some(())
    })?;
    click(hwnd, "Cancel")?;
    wait("member draft discarded", || unsafe {
        (named(hwnd, "Record titles")?
            .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
            .ok()?
            .CurrentToggleState()
            .ok()?
            == ToggleState_On)
            .then_some(())
    })?;
    select_segment(hwnd, "Apps")?;
    click(hwnd, "Linked applications: studio.exe")?;
    click(hwnd, "Add application")?;
    set(hwnd, "Add application", "writer")?;
    let before = unsafe {
        button(hwnd, "Linked applications: studio.exe")
            .ok_or("root trigger")?
            .CurrentBoundingRectangle()?
    };
    click(hwnd, "writer.exe")?;
    wait("link menu keeps root position", || unsafe {
        let after = button(hwnd, "Linked applications: studio.exe")?
            .CurrentBoundingRectangle()
            .ok()?;
        (before.top == after.top && before.left == after.left).then_some(())
    })?;
    key(hwnd, 0x1b)?;
    wait("linked application is grouped", || {
        (classification_filter_counts(hwnd) == Some([1, 1, 0])).then_some(())
    })?;
    set(hwnd, "Search apps", "writer")?;
    wait("linked executable search finds root", || {
        named(hwnd, "Category · Studio")
    })?;
    click(hwnd, "Clear search")?;
    click(hwnd, "Linked applications: studio.exe")?;
    wait("application member controls", || {
        named(hwnd, "Record titles: writer.exe")
    })
    .map_err(|e| format!("{e}: {:?}", names(hwnd)))?;
    let member_title = named(hwnd, "Record titles: writer.exe").ok_or("member title")?;
    activate_control(hwnd, &member_title, false)?;
    key(hwnd, 0x1b)?;
    click(hwnd, "Save")?;
    wait("application links persisted", || {
        rt.block_on(async {
            let mut c = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db))
                .await
                .ok()?;
            let parent: Option<String> =
                sqlx::query_scalar("SELECT value FROM settings WHERE key='__app_link::writer.exe'")
                    .fetch_optional(&mut c)
                    .await
                    .ok()?;
            (parent.as_deref() == Some("studio.exe")).then_some(())
        })
    })?;
    click(hwnd, "Linked applications: studio.exe")?;
    click(hwnd, "Unlink application: writer.exe")?;
    key(hwnd, 0x1b)?;
    wait("unlinked application restored", || {
        (classification_filter_counts(hwnd) == Some([2, 2, 0])).then_some(())
    })?;
    click(hwnd, "Save")?;
    wait("unlink save completes", || unsafe {
        (!button(hwnd, "Save")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    select_segment(hwnd, "Web")?;
    assert!(named(hwnd, "Category · Studio").is_none());
    set(hwnd, "Search websites", "a.example.com")?;
    wait("group member search finds its website", || {
        named(hwnd, "Category · Example")
    })?;
    set(hwnd, "Search websites", "Example")?;
    wait("website filtered", || named(hwnd, "Category · Example"))?;
    click(hwnd, "Edit website name")?;
    set(hwnd, "Edit website name", "Work web")?;
    wait("website renamed", || named(hwnd, "Category · Work web"))?;
    click(hwnd, "Color")?;
    set(hwnd, "Hex color value", "#123456")?;
    key(hwnd, 0x1b)?;
    select_segment(hwnd, "Apps")?;
    wait("app search restored", || field(hwnd, "Search apps"))?;
    click(hwnd, "Clear search")?;
    set(hwnd, "Search apps", "Studio")?;
    click(hwnd, "Edit app name")?;
    set(hwnd, "Edit app name", "Studio draft")?;
    select_segment(hwnd, "Web")?;
    click(hwnd, "Clear search")?;
    wait("website draft survives switching", || {
        named(hwnd, "Category · Work web")
    })?;
    assert!(unsafe { button(hwnd, "Save").unwrap().CurrentIsEnabled()?.as_bool() });
    click(hwnd, "Cancel")?;
    wait("website draft discarded", || {
        named(hwnd, "Category · Example")
    })?;
    select_segment(hwnd, "Apps")?;
    wait("application draft discarded", || {
        named(hwnd, "Category · Studio")
    })?;
    select_segment(hwnd, "Web")?;
    set(hwnd, "Search websites", "Example")?;
    click(hwnd, "Edit website name")?;
    set(hwnd, "Edit website name", "Saved web")?;
    click(hwnd, "Save")?;
    wait("website save completes", || unsafe {
        (!button(hwnd, "Save")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    wait("website save persisted", || {
        rt.block_on(async {
            let mut c = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db))
                .await
                .ok()?;
            let raw: String = sqlx::query_scalar(
                "SELECT value FROM settings WHERE key='__web_site::example.com'",
            )
            .fetch_one(&mut c)
            .await
            .ok()?;
            (serde_json::from_str::<serde_json::Value>(&raw).ok()?["displayName"] == "Saved web")
                .then_some(())
        })
    })?;
    click(hwnd, "Delete website")?;
    desktop::wait_observed("website deletion confirmation", || {
        let ready = named(hwnd, "Saved web · example.com").is_some()
            && button(hwnd, "Delete website")
                .is_some_and(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) });
        if ready {
            Ok(())
        } else {
            Err(controls(hwnd)
                .unwrap_or_default()
                .iter()
                .filter_map(|e| unsafe {
                    let name = e.CurrentName().ok()?.to_string();
                    (name.contains("web")
                        || name.contains("Delete")
                        || name.contains("fail")
                        || name.contains("Example"))
                    .then(|| format!("{name}: enabled={:?}", e.CurrentIsEnabled()))
                })
                .collect::<Vec<_>>()
                .join("; "))
        }
    })?;
    click(hwnd, "Delete website")?;
    wait("website deleted", || {
        (classification_filter_counts(hwnd) == Some([1, 0, 1])).then_some(())
    })?;
    select_segment(hwnd, "Apps")?;
    click(hwnd, "Clear search")?;
    wait("applications remain", || {
        (classification_filter_counts(hwnd) == Some([2, 2, 0])).then_some(())
    })?;
    select_segment(hwnd, "Web")?;
    wait("website mode remembered", || {
        rt.block_on(async {
            let mut c = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db))
                .await
                .ok()?;
            let value: String = sqlx::query_scalar(
                "SELECT value FROM settings WHERE key='classification_object_mode'",
            )
            .fetch_one(&mut c)
            .await
            .ok()?;
            (value == "web").then_some(())
        })
    })?;
    command(window(host.0.id(), w!("Patina GPUI")).ok_or("host")?, 2)?;
    wait("exit", || host.0.try_wait().ok().flatten())?;
    let (mut host, hwnd) = launch()?;
    wait("website mode restored", || field(hwnd, "Search websites"))?;
    let dpi = unsafe { GetDpiForWindow(hwnd) } as i32;
    unsafe {
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            810 * dpi / 96,
            540 * dpi / 96,
            SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOZORDER,
        )?;
    }
    desktop::wait_observed("mode controls fit narrow window", || unsafe {
        let control = segment(hwnd, "Web")
            .ok_or("missing Web control")?
            .CurrentBoundingRectangle()
            .map_err(|e| e.to_string())?;
        let mut bounds = RECT::default();
        GetWindowRect(hwnd, &mut bounds).map_err(|e| e.to_string())?;
        let mut client = RECT::default();
        GetClientRect(hwnd, &mut client).map_err(|e| e.to_string())?;
        if client.right - client.left <= 810 * dpi / 96 + 1
            && control.left >= bounds.left
            && control.right <= bounds.right
        {
            Ok(())
        } else {
            Err(format!("window={bounds:?}, control={control:?}, dpi={dpi}"))
        }
    })?;
    select_segment(hwnd, "Apps")?;
    wait("narrow window switches to apps", || {
        field(hwnd, "Search apps")
    })?;
    select_segment(hwnd, "Web")?;
    command(window(host.0.id(), w!("Patina GPUI")).ok_or("host")?, 2)?;
    wait("exit", || host.0.try_wait().ok().flatten())?;
    rt.block_on(async {
        let mut c =
            SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&db)).await?;
        sqlx::query(
            "INSERT OR REPLACE INTO settings(key,value) VALUES('title_recording_enabled','0')",
        )
        .execute(&mut c)
        .await?;
        sqlx::query("UPDATE settings SET value='0' WHERE key='web_activity_enabled'")
            .execute(&mut c)
            .await?;
        Ok::<_, Error>(())
    })?;
    let (mut host, hwnd) = launch()?;
    wait("disabled web recording falls back to apps", || {
        field(hwnd, "Search apps")
    })?;
    assert!(segment(hwnd, "Web").is_none());
    wait("global title recording disables card controls", || unsafe {
        (!named(hwnd, "Global titles are off")?
            .CurrentIsEnabled()
            .ok()?
            .as_bool())
        .then_some(())
    })?;
    command(window(host.0.id(), w!("Patina GPUI")).ok_or("host")?, 2)?;
    wait("exit", || host.0.try_wait().ok().flatten())?;
    Ok(())
}
