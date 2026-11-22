use super::*;

#[test]
#[ignore = "isolated Win32 desktop"]
fn settings_color_schemes() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let dir = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&dir)?;
    let path = dir.join("patina.db");
    seed(&path)?;
    let start = || -> Result<_, Error> {
        let host = TestChild(
            Command::new(env!("CARGO_BIN_EXE_patina"))
                .env("PATINA_PROFILE_PARENT", root.path())
                .arg("--today")
                .spawn()?,
        );
        let hwnd = wait("main", || {
            children::find(host.0.id(), |p| window(p, w!("Patina")))
        })?;
        click(hwnd, "Settings")?;
        wait("color scheme row", || named(hwnd, "Color scheme"))?;
        Ok((host, hwnd))
    };
    let stop = |mut host: TestChild| -> Result<(), Error> {
        command(
            window(host.0.id(), w!("Patina Tray")).ok_or("missing tray")?,
            2,
        )?;
        assert!(wait("exit", || host.0.try_wait().ok().flatten())?.success());
        Ok(())
    };
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let read = |key: &str| -> Result<Option<String>, Error> {
        rt.block_on(async {
            let mut db = SqliteConnection::connect_with(
                &SqliteConnectOptions::new().filename(&path).read_only(true),
            )
            .await?;
            Ok(sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
                .bind(key)
                .fetch_optional(&mut db)
                .await?)
        })
    };
    let selected = |hwnd, name: &str| {
        wait(name, || unsafe {
            let opt = button(hwnd, name)?;
            (opt.GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
                .ok()?
                .CurrentToggleState()
                .ok()?
                == ToggleState_On)
                .then_some(())
        })
    };
    let (host, hwnd) = start()?;
    let bounds = |name: &str| -> Result<_, Error> {
        Ok(unsafe { wait(name, || button(hwnd, name))?.CurrentBoundingRectangle()? })
    };
    let light = bounds("Light theme")?;
    let dark = bounds("Dark theme")?;
    let save = bounds("Save")?;
    for (name, height) in [
        ("Light theme", 28),
        ("Dark theme", 28),
        ("Cancel", 32),
        ("Save", 32),
    ] {
        assert_control_height(hwnd, &wait(name, || button(hwnd, name))?, height)?;
    }
    assert!(light.right > light.left && dark.right > dark.left);
    assert!(light.top == dark.top && light.right < dark.left && dark.right <= save.right);
    let old_gap = read("timeline_merge_gap_secs")?;
    let old_dark = read("color_scheme_dark")?;
    click(hwnd, "+ Activity hold time")?;
    press(hwnd, "Dark theme")?;
    press(hwnd, "Dracula")?;
    selected(hwnd, "Dracula")?;
    assert_eq!(read("color_scheme_dark")?, old_dark);
    key(hwnd, 0x1b)?;
    wait("preview dismissed", || {
        button(hwnd, "Dracula").is_none().then_some(())
    })?;
    press(hwnd, "Dark theme")?;
    selected(hwnd, "Default")?;
    press(hwnd, "Nord")?;
    press(hwnd, "Confirm")?;
    wait("dark scheme saved", || {
        (read("color_scheme_dark").ok()?.as_deref() == Some("nord")).then_some(())
    })?;
    assert_eq!(read("timeline_merge_gap_secs")?, old_gap);
    click(hwnd, "Light theme")?;
    click(hwnd, "Catppuccin")?;
    let set_write_failure = |enabled| -> Result<(), Error> {
        rt.block_on(async {
            let mut db = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(&path)).await?;
            let sql = if enabled {
                "CREATE TRIGGER fail_scheme BEFORE INSERT ON settings WHEN NEW.key='color_scheme_light' BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END"
            } else {
                "DROP TRIGGER fail_scheme"
            };
            sqlx::query(sql).execute(&mut db).await?;
            Ok(())
        })
    };
    set_write_failure(true)?;
    press(hwnd, "Confirm")?;
    wait("save failure in picker", || {
        named(hwnd, "Could not save settings. Try again later.")
    })?;
    selected(hwnd, "Catppuccin")?;
    set_write_failure(false)?;
    press(hwnd, "Confirm")?;
    wait("light scheme saved", || {
        (read("color_scheme_light").ok()?.as_deref() == Some("catppuccin")).then_some(())
    })?;
    click(hwnd, "Cancel")?;
    wait("page draft reverted", || named(hwnd, "3 min"))?;
    stop(host)?;
    let (host, hwnd) = start()?;
    press(hwnd, "Light theme")?;
    selected(hwnd, "Catppuccin")?;
    press(hwnd, "Cancel")?;
    press(hwnd, "Dark theme")?;
    selected(hwnd, "Nord")?;
    stop(host)
}
