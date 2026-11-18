use super::*;
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    time::Duration,
};

fn post(port: u16, token: &str) -> Option<(u16, Value)> {
    let mut client = TcpStream::connect(("127.0.0.1", port)).ok()?;
    client.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
    let body = r#"{"protocolVersion":1,"url":"https://example.test/","incognito":false}"#;
    write!(client, "POST /web-activity HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\n\r\n{body}",body.len()).ok()?;
    let mut response = String::new();
    client.read_to_string(&mut response).ok()?;
    let (head, json) = response.split_once("\r\n\r\n")?;
    Some((
        head.split_whitespace().nth(1)?.parse().ok()?,
        serde_json::from_str(json).ok()?,
    ))
}

fn edit(hwnd: HWND, name: &str, value: &str) -> Result<(), Error> {
    let field = wait(name, || {
        controls(hwnd).ok()?.into_iter().find_map(|el| unsafe {
            if el.CurrentName().ok()? != name {
                return None;
            }
            el.GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)
                .ok()
        })
    })?;
    unsafe {
        field.SetValue(&value.into())?;
    }
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn settings_services() -> Result<(), Error> {
    if !patina_test_desktop::run_case()? {
        return Ok(());
    }
    let _com = ComApartment::init()?;
    unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    let root = tempfile::tempdir()?;
    let profile = root.path().join(patina::APP_ID);
    fs::create_dir(&profile)?;
    let db = profile.join("patina.db");
    seed(&db)?;
    let remote = TcpListener::bind(("127.0.0.1", 0))?;
    let address = remote.local_addr()?;
    remote.set_nonblocking(true)?;
    let port = TcpListener::bind(("127.0.0.1", 0))?.local_addr()?.port();
    let exe = r"C:\fixture\chrome.exe";
    fs::write(
        root.path().join("native-probe-fixture.json"),
        serde_json::to_vec(&json!({
            "foreground": {"hwnd":"0x42","root_owner_hwnd":"0x42","process_id":42,"window_class":"Fixture","title":"Fixture","exe_name":"chrome.exe","process_path":exe,"is_afk":false,"idle_time_ms":0},
            "names": {(exe):"Browser fixture"}
        }))?,
    )?;
    let launch = || {
        Command::new(env!("CARGO_BIN_EXE_patina"))
            .arg("--today")
            .env("PATINA_GPUI_PROFILE_PARENT", root.path())
            .env("PATINA_E2E_DATA_ROOT", root.path())
            .env("PATINA_E2E", "1")
            .env("PATINA_E2E_NATIVE_FIXTURE", "1")
            .spawn()
            .map(TestChild)
    };
    let mut app = launch()?;
    let pid = app.0.id();
    let main = || children::find(pid, |p| window(p, w!("Patina UI")));
    let hwnd = wait("main window", main)?;
    click(hwnd, "Settings")?;
    let switch = |hwnd, name: &str| -> Result<(), Error> {
        let control = wait(name, || {
            controls(hwnd).ok()?.into_iter().find(|el| unsafe {
                el.CurrentName().is_ok_and(|n| n == name)
                    && el
                        .GetCurrentPatternAs::<IUIAutomationTogglePattern>(UIA_TogglePatternId)
                        .is_ok()
            })
        })?;
        activate_control(hwnd, &control, true)
    };
    switch(hwnd, "Web sync")?;
    let guide = || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_WindowControlTypeId)
                && el.CurrentName().is_ok_and(|n| n == "Web Sync Guide")
        })
    };
    press(hwnd, "Guide")?;
    wait("web sync guide dialog", guide)?;
    for name in [
        "Chrome Web Store",
        "Firefox Add-ons",
        "Microsoft Edge Add-ons",
        "Copy port",
        "Copy Token",
        "Open releases",
    ] {
        wait(name, || button(hwnd, name))?;
    }
    let close = wait("guide close", || button(hwnd, "Close"))?;
    let close_bounds = unsafe { close.CurrentBoundingRectangle()? };
    let copy_bounds = unsafe {
        button(hwnd, "Copy Token")
            .ok_or("missing guide copy action")?
            .CurrentBoundingRectangle()?
    };
    assert!(copy_bounds.top > close_bounds.top);
    let bounds = |id: &str| {
        controls(hwnd).ok()?.into_iter().find_map(|el| unsafe {
            (el.CurrentAutomationId().ok()? == id)
                .then(|| el.CurrentBoundingRectangle().ok())
                .flatten()
        })
    };
    let mut previous_bottom = close_bounds.bottom;
    for (index, title) in [
        "Prepare connection details",
        "Install the browser extension",
        "Configure the extension",
        "Sync the current page",
    ]
    .into_iter()
    .enumerate()
    {
        wait(title, || named(hwnd, title))?;
        let card = wait("guide step card", || {
            bounds(&format!("web-sync-guide-step-{index}"))
        })?;
        assert!(
            card.top >= previous_bottom,
            "guide cards must stack without overlap"
        );
        assert!(card.bottom > card.top);
        previous_bottom = card.bottom;
        let actions: &[&str] = match index {
            0 => &["Copy port", "Copy Token"],
            1 => &[
                "Chrome Web Store",
                "Firefox Add-ons",
                "Microsoft Edge Add-ons",
                "Open releases",
            ],
            _ => &[],
        };
        for name in actions {
            let action = unsafe { button(hwnd, name).unwrap().CurrentBoundingRectangle()? };
            assert!(
                action.top >= card.top && action.bottom <= card.bottom,
                "{name} outside its step"
            );
        }
    }
    let surface = wait("guide surface", || bounds("web-sync-guide-surface"))?;
    let mut frame = RECT::default();
    unsafe {
        GetWindowRect(hwnd, &mut frame)?;
    }
    assert!(surface.top > frame.top && surface.bottom < frame.bottom);
    let body = wait("guide scroll body", || bounds("web-sync-guide-body"))?;
    assert!(body.bottom <= surface.bottom && body.top > close_bounds.bottom);
    press(hwnd, "Copy port")?;
    assert!(guide().is_some(), "copy must leave the guide open");
    key(hwnd, 0x1b)?;
    wait("guide closed with Escape", || {
        guide().is_none().then_some(())
    })?;
    key(hwnd, 0x0d)?;
    wait("guide trigger regained focus", guide)?;
    press(hwnd, "Close")?;
    wait("guide closed with button", || {
        guide().is_none().then_some(())
    })?;
    key(hwnd, 0x0d)?;
    wait("guide trigger regained focus after close button", guide)?;
    key(hwnd, 0x1b)?;
    wait("guide dismissed", || guide().is_none().then_some(()))?;
    let port_input = wait("port input", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                && el.CurrentName().is_ok_and(|name| name == "Port")
        })
    })?;
    let port_value: IUIAutomationValuePattern =
        unsafe { port_input.GetCurrentPatternAs(UIA_ValuePatternId)? };
    edit(hwnd, "Port", "")?;
    wait("empty port validation", || {
        named(hwnd, "Enter a port between 1024 and 65535.")
    })?;
    activate_control(hwnd, &port_input, true)?;
    // Keep the field away from the fixed header and the scroll viewport's clipped bottom.
    for attempt in 0..=8 {
        let r = unsafe { port_input.CurrentBoundingRectangle()? };
        let mut frame = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut frame)? };
        if (r.top + r.bottom) / 2 < frame.top + (frame.bottom - frame.top) * 2 / 3 {
            break;
        }
        if attempt == 8 {
            return Err(
                format!("port remains near viewport edge: port={r:?}, window={frame:?}").into(),
            );
        }
        unsafe {
            PostMessageW(
                Some(hwnd),
                WM_MOUSEWHEEL,
                WPARAM((-120i32 as u32 as usize) << 16),
                LPARAM(((frame.top + 300) as isize) << 16 | (frame.left + 600) as isize),
            )?;
        }
        desktop::wait_observed("port input moves away from viewport edge", || {
            let next =
                unsafe { port_input.CurrentBoundingRectangle() }.map_err(|e| e.to_string())?;
            if next.top != r.top {
                Ok(())
            } else {
                Err(format!("port bounds={next:?}"))
            }
        })?;
    }
    let bounds = unsafe { port_input.CurrentBoundingRectangle()? };
    let outside = LPARAM(
        client_center(hwnd, &port_input)?.0 - ((bounds.right - bounds.left) / 2 + 24) as isize,
    );
    unsafe {
        PostMessageW(Some(hwnd), WM_LBUTTONDOWN, WPARAM(1), outside)?;
        PostMessageW(Some(hwnd), WM_LBUTTONUP, WPARAM(0), outside)?;
        PostMessageW(Some(hwnd), WM_PAINT, WPARAM(0), LPARAM(0))?;
        PostMessageW(Some(hwnd), WM_CHAR, WPARAM('9' as usize), LPARAM(1))?;
    }
    activate_control(hwnd, &port_input, false)?;
    unsafe {
        PostMessageW(Some(hwnd), WM_PAINT, WPARAM(0), LPARAM(0))?;
        PostMessageW(Some(hwnd), WM_CHAR, WPARAM('1' as usize), LPARAM(1))?;
    }
    wait(
        "outside click blurs service input; pointer restores editing",
        || unsafe { (port_value.CurrentValue().ok()? == "1").then_some(()) },
    )
    .map_err(|e| {
        format!("{e}; port value {:?}; bounds {bounds:?}", unsafe {
            port_value.CurrentValue()
        })
    })?;
    click(hwnd, "Show token")?;
    wait("token reveal action changed", || named(hwnd, "Hide token"))?;
    let token_input = wait("revealed token input", || {
        controls(hwnd).ok()?.into_iter().find(|el| unsafe {
            el.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                && el.CurrentName().is_ok_and(|name| name == "Token")
        })
    })?;
    let token_value: IUIAutomationValuePattern =
        unsafe { token_input.GetCurrentPatternAs(UIA_ValuePatternId)? };
    let original_token = unsafe { token_value.CurrentValue()? };
    activate_control(hwnd, &token_input, true)?;
    key(hwnd, 0x23)?; // End: long plaintext scrolls to the caret before masking.
    click(hwnd, "Hide token")?;
    wait("token masking restored", || named(hwnd, "Show token"))?;
    click(hwnd, "Show token")?;
    wait("reveal after moving caret preserves token", || unsafe {
        (token_value.CurrentValue().ok()? == original_token).then_some(())
    })?;
    click(hwnd, "Hide token")?;
    edit(hwnd, "Port", "0")?;
    wait("invalid port message", || {
        named(hwnd, "Enter a port between 1024 and 65535.")
    })
    .map_err(|e| format!("{e}; controls {:?}", names(hwnd)))?;
    edit(hwnd, "Port", &port.to_string())?;
    click(hwnd, "Cancel")?;
    wait("cancel hides port", || {
        named(hwnd, "Port").is_none().then_some(())
    })?;
    switch(hwnd, "Web sync")?;
    edit(hwnd, "Port", &port.to_string())?;
    switch(hwnd, "Remote push")?;
    edit(hwnd, "Endpoint URL", &format!("ws://{address}/ws"))?;
    click(hwnd, "Save")?;
    wait("saved services", || named(hwnd, "Saved"))?;
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    let mut conn = rt.block_on(SqliteConnection::connect_with(
        &SqliteConnectOptions::new().filename(&db),
    ))?;
    let setting = |key: &str, c: &mut SqliteConnection| -> Result<String, Error> {
        Ok(rt.block_on(
            sqlx::query_scalar("SELECT value FROM settings WHERE key=?")
                .bind(key)
                .fetch_one(c),
        )?)
    };
    let token = setting("web_activity_token", &mut conn)?;
    assert_eq!(token.len(), 48);
    assert!(token != setting("remote_status_bridge_token", &mut conn)?);
    let (status, _) = wait("local web service", || post(port, "incorrect"))?;
    assert_eq!(status, 401);
    let (status, response) = post(port, &token).ok_or("web service unavailable")?;
    assert_eq!(status, 200);
    assert_eq!(response["ok"], true);
    assert_eq!(response["changed"], false); // Paused recording is ineligible.

    let (peer, _) = wait("worker connection", || remote.accept().ok())?;
    peer.set_nonblocking(false)?;
    peer.set_read_timeout(Some(Duration::from_secs(12)))?;
    let mut ws = tungstenite::accept(peer)?;
    let auth: Value = serde_json::from_str(ws.read()?.to_text()?)?;
    assert_eq!(auth["type"], "auth");
    assert!(auth["token"].as_str() == Some(&setting("remote_status_bridge_token", &mut conn)?));
    ws.send(tungstenite::Message::text(
        json!({"type":"auth-ok"}).to_string(),
    ))?;
    let snapshot: Value = serde_json::from_str(ws.read()?.to_text()?)?;
    assert_eq!(snapshot["type"], "snapshot");
    assert_eq!(
        snapshot["machineId"],
        setting("remote_status_bridge_machine_id", &mut conn)?
    );
    unsafe {
        PostMessageW(Some(hwnd), WM_CLOSE, WPARAM(0), LPARAM(0))?;
    }
    wait("renderer closed", || main().is_none().then_some(()))?;
    assert_eq!(
        post(port, &token).ok_or("web sync stopped on close")?.0,
        200
    );
    ws.send(tungstenite::Message::text(r#"{"type":"ping"}"#))?;
    let pong: Value = serde_json::from_str(ws.read()?.to_text()?)?;
    assert_eq!(pong["type"], "pong");
    let tray = window(pid, w!("Patina GPUI")).ok_or("missing tray")?;
    command(tray, 3)?;
    wait("eligible browser observation", || {
        let (_, r) = post(port, &token)?;
        (r["changed"] == true).then_some(())
    })?;
    let rows: i64 = rt.block_on(sqlx::query_scalar("SELECT count(*) FROM web_activity_segments WHERE url='https://example.test/' AND browser_exe_name='chrome.exe'").fetch_one(&mut conn))?;
    assert!(rows > 0);
    let machine = setting("remote_status_bridge_machine_id", &mut conn)?;
    command(tray, 2)?;
    assert!(wait("first host exit", || app.0.try_wait().ok().flatten())?.success());
    let mut app = launch()?;
    let pid = app.0.id();
    let tray = wait("new host", || window(pid, w!("Patina GPUI")))?;
    let reopened = wait("reopened", || {
        children::find(pid, |p| window(p, w!("Patina UI")))
    })?;
    assert_eq!(wait("restored web listener", || post(port, &token))?.0, 200);
    assert_eq!(
        machine,
        setting("remote_status_bridge_machine_id", &mut conn)?
    );
    click(reopened, "Settings")?;
    switch(reopened, "Remote push")?;
    click(reopened, "Save")?;
    wait("saved remote disable", || named(reopened, "Saved"))?;
    click(reopened, "Generate token")?;
    click(reopened, "Save")?;
    wait("rotated token rejected", || {
        (post(port, &token)?.0 == 401).then_some(())
    })?;
    let rotated = setting("web_activity_token", &mut conn)?;
    assert!(rotated != token);
    assert_eq!(
        post(port, &rotated).ok_or("rotated token unavailable")?.0,
        200
    );
    switch(reopened, "Web sync")?;
    click(reopened, "Save")?;
    wait("web listener closed", || {
        TcpStream::connect(("127.0.0.1", port))
            .is_err()
            .then_some(())
    })?;
    command(tray, 2)?;
    assert!(wait("exit", || app.0.try_wait().ok().flatten())?.success());
    Ok(())
}
