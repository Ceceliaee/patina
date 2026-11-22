use super::*;

fn resize_right_edge(hwnd: HWND, percent: u16) -> Result<(), Error> {
    unsafe {
        let dpi = f64::from(GetDpiForWindow(hwnd)) / 96.;
        let mut rect = RECT::default();
        let mut client = RECT::default();
        GetWindowRect(hwnd, &mut rect)?;
        GetClientRect(hwnd, &mut client)?;
        let frame = (
            rect.right - rect.left - client.right,
            rect.bottom - rect.top - client.bottom,
        );
        let anchor = (rect.left, rect.top);
        rect.right = rect.left + frame.0 + (1080. * f64::from(percent) / 100. * dpi).round() as i32;
        assert_eq!(
            SendMessageW(
                hwnd,
                WM_SIZING,
                Some(WPARAM(WMSZ_RIGHT as usize)),
                Some(LPARAM((&raw mut rect) as isize))
            )
            .0,
            1
        );
        assert_eq!((rect.left, rect.top), anchor);
        assert_eq!(
            rect.bottom - rect.top - frame.1,
            (720. * f64::from(percent) / 100. * dpi).round() as i32
        );
        SetWindowPos(
            hwnd,
            None,
            rect.left,
            rect.top,
            rect.right - rect.left,
            rect.bottom - rect.top,
            SWP_NOZORDER | SWP_NOACTIVATE,
        )?;
        PostMessageW(Some(hwnd), WM_EXITSIZEMOVE, WPARAM(0), LPARAM(0))?;
    }
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn window_scale_matches_settings_controls_and_restores_saved_geometry() -> Result<(), Error> {
    if !patina_test_support::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::PROFILE_DIRECTORY);
    fs::create_dir(&profile)?;
    seed(&profile.join("patina.db"))?;
    let start = || -> Result<_, Error> {
        let host = TestChild(
            Command::new(env!("CARGO_BIN_EXE_patina"))
                .env("PATINA_PROFILE_PARENT", root.path())
                .arg("--today")
                .spawn()?,
        );
        let hwnd = wait("main window", || {
            children::find(host.0.id(), |p| window(p, w!("Patina")))
        })?;
        click(hwnd, "Settings")?;
        wait("scale controls", || button(hwnd, "+ Scale"))?;
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
    let geometry = |hwnd: HWND, percent: u16| -> Result<(), Error> {
        let factor = f64::from(unsafe { GetDpiForWindow(hwnd) }) / 96. * f64::from(percent) / 100.;
        wait("scaled viewport and controls", || unsafe {
            let mut rect = RECT::default();
            GetClientRect(hwnd, &mut rect).ok()?;
            let save = button(hwnd, "Save")?.CurrentBoundingRectangle().ok()?;
            ((f64::from(rect.right) - 1080. * factor).abs() <= 1.
                && (f64::from(rect.bottom) - 720. * factor).abs() <= 1.
                && (f64::from(save.bottom - save.top) - 32. * factor).abs() <= 1.5)
                .then_some(())
        })?;
        Ok(())
    };
    let (host, hwnd) = start()?;
    let slider = |hwnd, name: &str| {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_SliderControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == name)
        })
    };
    let range = wait("scale slider", || slider(hwnd, "Scale"))?;
    let initial = unsafe {
        range
            .GetCurrentPatternAs::<IUIAutomationRangeValuePattern>(UIA_RangeValuePatternId)?
            .CurrentValue()?
    } as u16;
    let text_bounds = |name: &str| -> Result<RECT, Error> {
        Ok(unsafe { wait(name, || named(hwnd, name))?.CurrentBoundingRectangle()? })
    };
    let heading = text_bounds("Interface")?;
    for (first, second) in [
        ("− Continue counting", "− Scale"),
        ("+ Continue counting", "+ Scale"),
    ] {
        let bounds = |name| -> Result<RECT, Error> {
            Ok(unsafe { wait(name, || button(hwnd, name))?.CurrentBoundingRectangle()? })
        };
        let (a, b) = (bounds(first)?, bounds(second)?);
        assert_eq!((a.left, a.right), (b.left, b.right));
    }
    let reference = unsafe {
        wait("time slider", || slider(hwnd, "Continue counting"))?.CurrentBoundingRectangle()?
    };
    let scale = unsafe { range.CurrentBoundingRectangle()? };
    assert_eq!((reference.left, reference.right), (scale.left, scale.right));
    geometry(hwnd, initial)?;
    click(hwnd, "− Scale")?;
    geometry(hwnd, initial - 1)?;
    click(hwnd, "Cancel")?;
    geometry(hwnd, initial)?;
    let bounds = unsafe { range.CurrentBoundingRectangle()? };
    let slider_value = unsafe {
        range.GetCurrentPatternAs::<IUIAutomationRangeValuePattern>(UIA_RangeValuePatternId)?
    };
    let min = unsafe { slider_value.CurrentMinimum()? };
    let max = unsafe { slider_value.CurrentMaximum()? };
    let dpi = f64::from(unsafe { GetDpiForWindow(hwnd) }) / 96. * f64::from(initial) / 100.;
    let rail = f64::from(bounds.right - bounds.left) - 12. * dpi;
    let center = client_center(hwnd, &range)?.0;
    let pos = |value: f64| {
        let offset = (rail * ((value - min) / (max - min) - 0.5)).round() as isize;
        LPARAM((center & !0xffff) | ((center + offset) & 0xffff))
    };
    unsafe {
        let thumb = pos(f64::from(initial));
        PostMessageW(Some(hwnd), WM_MOUSEMOVE, WPARAM(0), thumb)?;
        PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), thumb)?;
        PostMessageW(
            Some(hwnd),
            WM_MOUSEMOVE,
            WPARAM(1),
            pos(f64::from(initial) - 6.),
        )?;
        for target in [82., 91., 84.] {
            PostMessageW(Some(hwnd), WM_MOUSEMOVE, WPARAM(1), pos(target))?;
            desktop::wait_observed("thumb tracks the held pointer", || {
                let value = slider_value.CurrentValue().map_err(|e| e.to_string())?;
                if (value - target).abs() <= 1. {
                    Ok(())
                } else {
                    let mut area = RECT::default();
                    let _ = GetClientRect(hwnd, &mut area);
                    Err(format!(
                        "value={value}, target={target}, initial={initial}, range=({min},{max}), slider={bounds:?}, client={area:?}, at={:?}",
                        pos(target)
                    ))
                }
            })?;
            let mut actual = RECT::default();
            GetClientRect(hwnd, &mut actual)?;
            assert!(
                (f64::from(actual.right) - 1080. * dpi).abs() <= 1.,
                "window resized during the drag: {actual:?}"
            );
        }
        let released = slider_value.CurrentValue()? as u16;
        PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), pos(84.))?;
        geometry(hwnd, released)?;
    }
    click(hwnd, "Cancel")?;
    geometry(hwnd, initial)?;
    unsafe {
        range.SetFocus()?;
    }
    assert_eq!(min, 50.);
    key(hwnd, 0x23)?; // End
    geometry(hwnd, max as u16)?;
    key(hwnd, 0x24)?; // Home
    geometry(hwnd, 50)?;
    let small = text_bounds("Interface")?;
    assert!(
        (f64::from(small.bottom - small.top)
            - f64::from(heading.bottom - heading.top) * 50. / f64::from(initial))
        .abs()
            <= 2.
    );
    click(hwnd, "+ Scale")?;
    geometry(hwnd, 51)?;
    click(hwnd, "− Scale")?;
    geometry(hwnd, 50)?;
    press(hwnd, "Save")?;
    wait("scale saved", || unsafe {
        (!button(hwnd, "Save")?.CurrentIsEnabled().ok()?.as_bool()).then_some(())
    })?;
    stop(host)?;
    let (host, hwnd) = start()?;
    geometry(hwnd, 50)?;
    resize_right_edge(hwnd, 83)?;
    geometry(hwnd, 83)?;
    wait("border resize updates scale setting", || named(hwnd, "83%"))?;
    click(hwnd, "Cancel")?;
    geometry(hwnd, 50)?;
    press(hwnd, "Maximize window")?;
    wait("maximized", || unsafe {
        IsZoomed(hwnd).as_bool().then_some(())
    })?;
    press(hwnd, "Restore window")?;
    geometry(hwnd, 50)?;
    click(hwnd, "Today")?;
    wait("settings closed", || {
        button(hwnd, "Save").is_none().then_some(())
    })?;
    resize_right_edge(hwnd, 85)?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    wait("border resize saved outside settings", || {
        rt.block_on(async {
            let mut db = SqliteConnection::connect_with(
                &SqliteConnectOptions::new()
                    .filename(profile.join("patina.db"))
                    .read_only(true),
            )
            .await
            .ok()?;
            let value: String =
                sqlx::query_scalar("SELECT value FROM settings WHERE key='window_scale'")
                    .fetch_one(&mut db)
                    .await
                    .ok()?;
            (value == "85").then_some(())
        })
    })?;
    click(hwnd, "Settings")?;
    geometry(hwnd, 85)?;
    stop(host)
}
