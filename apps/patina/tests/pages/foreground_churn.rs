use super::*;
use base64::Engine;

const GROUPS: usize = 20;

pub(super) fn count_rank_controls(d: &mut Driver) -> Result<(), Error> {
    let list = d.ready(UIA_AutomationIdPropertyId, "trend-objects")?;
    let buttons = unsafe {
        let condition = d.ui.CreatePropertyCondition(
            UIA_ControlTypePropertyId,
            &VARIANT::from(UIA_ButtonControlTypeId.0),
        )?;
        list.FindAll(TreeScope_Descendants, &condition)?.Length()?
    };
    assert!(buttons > 0, "the ranking has no accessible controls");
    d.event("rank-controls", json!({"buttons": buttons}))
}

pub(super) fn seed_catalog(db: &Path) -> Result<(), Error> {
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let mut conn = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db)).await?;
        let mut tx = conn.begin().await?;
        let start: i64 = sqlx::query_scalar("SELECT MAX(start_time) FROM sessions WHERE exe_name='bench00.exe'").fetch_one(&mut *tx).await?;
        for group in 0..GROUPS {
            for i in 0..16 {
                let exe = format!("stream{group:02}-{i:02}.exe");
                let name = format!("Stream {group:02}-{i:02}");
                let domain = format!("s{group:02}-{i:02}.test");
                let stamp = start + ((group*16+i) as i64)*2000;
                let svg = format!(r##"<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#20{group:02x}{i:02x}"/></svg>"##);
                let url = format!("data:image/svg+xml;base64,{}", base64::engine::general_purpose::STANDARD.encode(svg));
                sqlx::query("INSERT INTO sessions(exe_name,app_name,start_time,end_time,duration) VALUES(?,?,?,?,1000)").bind(&exe).bind(name).bind(stamp).bind(stamp+1000).execute(&mut *tx).await?;
                sqlx::query("INSERT INTO icon_cache(exe_name,icon_base64,last_updated) SELECT ?,icon_base64,1 FROM icon_cache WHERE exe_name='bench00.exe'").bind(exe).execute(&mut *tx).await?;
                sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,created_at,updated_at) VALUES('fixture','chromium','chrome.exe',?,?,?,?,1000,?,?)")
                    .bind(&domain).bind(&domain).bind(stamp).bind(stamp+1000).bind(stamp).bind(stamp+1000).execute(&mut *tx).await?;
                sqlx::query("INSERT INTO web_favicon_cache(normalized_domain,favicon_url,updated_at) VALUES(?,?,0)").bind(domain).bind(url).execute(&mut *tx).await?;
            }
        }
        tx.commit().await?;
        conn.close().await?;
        Ok(())
    })
}

pub(super) fn visit_catalog(d: &mut Driver) -> Result<(), Error> {
    let date = Local::now().date_naive();
    d.visit(
        0,
        "History",
        "View details for Studio",
        false,
        Some("History"),
    )?;
    for ago in 1..=12 {
        let previous = (date - chrono::Duration::days(ago)).to_string();
        d.visit(0, "Previous day", &previous, false, None)?;
    }
    for group in 0..GROUPS {
        if group % 4 == 0 {
            d.visit(0, "Today", "View details for Studio", false, Some("Today"))?;
            d.visit(0, "Classification", "Apps", false, Some("Classification"))?;
        }
        for (tab, field, prefix, suffix) in [
            ("Apps", "Search apps", "Stream ", ""),
            ("Web", "Search websites", "s", ".test"),
        ] {
            d.visit(0, tab, field, false, None)?;
            let edit = d.ready(UIA_NamePropertyId, field)?;
            let value: IUIAutomationValuePattern =
                unsafe { edit.GetCurrentPatternAs(UIA_ValuePatternId)? };
            for half in [0, 1] {
                let query = format!("{prefix}{group:02}-{half}");
                unsafe {
                    value.SetValue(&query.as_str().into())?;
                }
                d.ready(UIA_NamePropertyId, &format!("Category ･ {query}0{suffix}"))?;
            }
        }
        d.event(
            "catalog-group",
            json!({"groupsVisited":group+1,"appsAndSitesPerGroup":16}),
        )?;
    }
    d.visit(0, "Today", "View details for Studio", false, Some("Today"))?;
    d.event("round", json!(0))
}
