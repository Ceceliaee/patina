use super::*;

pub(super) fn measure(d: &mut Driver, repeat_detail: bool) -> Result<(), Error> {
    d.visit(
        0,
        "History",
        "View details for Studio",
        false,
        Some("History"),
    )?;
    let date = Local::now()
        .date_naive()
        .pred_opt()
        .ok_or("previous day")?
        .to_string();
    d.visit(0, "Previous day", &date, false, None)?;
    if repeat_detail {
        let double_click =
            unsafe { windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime() };
        for visit in 0..9 {
            if visit > 0 {
                thread::sleep(Duration::from_millis(u64::from(double_click) + 1));
            }
            open_records(d)?;
        }
        d.visit(0, "Today", "View details for Studio", false, Some("Today"))?;
        return d.event("round", json!(0));
    }
    d.visit(0, "Open timeline zoom", "zoom-overview", true, None)?;
    let track = d.ready(UIA_AutomationIdPropertyId, "zoom-overview")?;
    unsafe {
        track.SetFocus()?;
    }
    key(d.hwnd, 36)?;
    d.ready(UIA_NamePropertyId, "00:00 – 04:00")?;
    key(d.hwnd, 39)?;
    d.ready(UIA_NamePropertyId, "02:00 – 06:00")?;
    key(d.hwnd, 39)?;
    let axis = d.ready(UIA_NamePropertyId, "04:00 – 08:00")?;
    let bounds = unsafe { track.CurrentBoundingRectangle()? };
    let center = client_center(d.hwnd, &track)?.0;
    let mut last = String::from("04:00 – 08:00");
    unsafe {
        PostMessageW(Some(d.hwnd), WM_LBUTTONDOWN, WPARAM(1), LPARAM(center))?;
    }
    for step in 1..=24 {
        let offset = (bounds.right - bounds.left) as isize * step / 72;
        let begin = Instant::now();
        unsafe {
            PostMessageW(
                Some(d.hwnd),
                WM_MOUSEMOVE,
                WPARAM(1),
                LPARAM(center - offset),
            )?;
        }
        let next = loop {
            let label = unsafe { axis.CurrentName()? }.to_string();
            if label != last && !label.is_empty() {
                break label;
            }
            if begin.elapsed() > Duration::from_secs(12) {
                return Err(format!("drag {step} stopped at {last}").into());
            }
            thread::sleep(Duration::from_millis(1));
        };
        d.event(
            "drag",
            json!({"step":step,"range":next,"inputMs":begin.duration_since(d.start).as_secs_f64()*1000.,"observableMs":begin.elapsed().as_secs_f64()*1000.}),
        )?;
        last = next;
    }
    unsafe {
        PostMessageW(
            Some(d.hwnd),
            WM_LBUTTONUP,
            WPARAM(0),
            LPARAM(center - (bounds.right - bounds.left) as isize / 3),
        )?;
    }
    key(d.hwnd, 27)?;
    open_records(d)?;
    d.visit(0, "Today", "View details for Studio", false, Some("Today"))?;
    d.event("round", json!(0))
}

fn open_records(d: &mut Driver) -> Result<(), Error> {
    let icon = d.ready(UIA_NamePropertyId, "View details for Bench 00")?;
    let at = client_center(d.hwnd, &icon)?;
    let begin = Instant::now();
    unsafe {
        PostMessageW(Some(d.hwnd), WM_MOUSEMOVE, WPARAM(0), at)?;
        for _ in 0..2 {
            PostMessageW(Some(d.hwnd), WM_LBUTTONDOWN, WPARAM(1), at)?;
            PostMessageW(Some(d.hwnd), WM_LBUTTONUP, WPARAM(0), at)?;
        }
    }
    let list = d.ready(UIA_AutomationIdPropertyId, "detail-record-list")?;
    let layout_ms = begin.elapsed().as_secs_f64() * 1000.;
    let groups = unsafe {
        d.ui.CreatePropertyCondition(
            UIA_ControlTypePropertyId,
            &VARIANT::from(UIA_GroupControlTypeId.0),
        )?
    };
    let first = loop {
        let first = unsafe {
            let nodes = list.FindAll(TreeScope_Descendants, &groups)?;
            (0..nodes.Length()?).find_map(|i| {
                let element = nodes.GetElement(i).ok()?;
                element
                    .CurrentName()
                    .ok()?
                    .to_string()
                    .starts_with("Bench 00")
                    .then_some(element)
            })
        };
        if let Some(first) = first {
            break first;
        }
        if begin.elapsed() > Duration::from_secs(12) {
            return Err("timed out waiting for the first detailed record".into());
        }
        thread::sleep(Duration::from_millis(8));
    };
    let first_ms = begin.elapsed().as_secs_f64() * 1000.;
    assert!(unsafe { first.CurrentBoundingRectangle()? }.bottom > 0);
    let cards = wait("detailed records", || unsafe {
        let nodes = list.FindAll(TreeScope_Descendants, &groups).ok()?;
        let count = (0..nodes.Length().ok()?)
            .filter(|i| {
                nodes
                    .GetElement(*i)
                    .ok()
                    .and_then(|el| el.CurrentName().ok())
                    .is_some_and(|n| n.to_string().starts_with("Bench 00"))
            })
            .count();
        (count > 0).then_some(count)
    })?;
    d.event(
        "dense-detail",
        json!({"cards":cards,"layoutMs":layout_ms,"firstRowMs":first_ms,"observableMs":begin.elapsed().as_secs_f64()*1000.}),
    )?;
    key(d.hwnd, 27)?;
    wait("detail dismissed", || {
        d.find(UIA_AutomationIdPropertyId, "detail-record-list")
            .is_none()
            .then_some(())
    })
}
