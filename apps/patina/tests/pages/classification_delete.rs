use super::*;

fn sql(db: &Path, query: &'static str) -> Result<(), Error> {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?
        .block_on(async {
            let mut c =
                SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db)).await?;
            sqlx::raw_sql(query).execute(&mut c).await?;
            Ok(())
        })
}

fn counts(db: &Path) -> Result<Vec<i64>, Error> {
    tokio::runtime::Builder::new_current_thread().enable_all().build()?.block_on(async {
        let mut c = SqliteConnection::connect_with(&SqliteConnectOptions::new().filename(db)).await?;
        let mut counts = Vec::new();
        for query in [
            "SELECT COUNT(*) FROM sessions WHERE lower(exe_name)='studio.exe'",
            "SELECT COUNT(*) FROM session_title_samples",
            "SELECT COUNT(*) FROM import_exact_sessions WHERE exe_name='Studio.EXE'",
            "SELECT COUNT(*) FROM import_time_buckets WHERE exe_name='studio.exe'",
            "SELECT COUNT(*) FROM sessions WHERE exe_name='writer.exe'",
            "SELECT COUNT(*) FROM import_exact_sessions WHERE exe_name='writer.exe'",
            "SELECT exact_session_count FROM import_batches WHERE id='test'",
            "SELECT hour_bucket_count FROM import_batches WHERE id='test'",
            "SELECT COUNT(*) FROM settings WHERE key='__app_override::studio.exe' AND value='{\"category\":\"development\",\"displayName\":\"Studio\"}'",
            "SELECT COUNT(*) FROM anonymous_activity",
            "SELECT COUNT(*) FROM icon_cache WHERE lower(exe_name)='studio.exe'",
            "SELECT COUNT(*) FROM settings WHERE key='__app_link::writer.exe'",
            "SELECT COUNT(*) FROM tool_activity_reminder_rules WHERE exe_name='studio.exe'",
            "SELECT COUNT(*) FROM tool_activity_reminder_rules WHERE exe_name='writer.exe'",
            "SELECT COUNT(*) FROM settings WHERE key='__app_override::writer.exe'",
        ] {
            counts.push(sqlx::query_scalar(query).fetch_one(&mut c).await?);
        }
        Ok(counts)
    })
}

fn ready(hwnd: HWND) -> Result<(), Error> {
    wait("deletion preview ready", || {
        named(hwnd, "Studio ･ studio.exe")?;
        button(hwnd, "Delete application")
            .filter(|b| unsafe { b.CurrentIsEnabled().is_ok_and(|v| v.as_bool()) })
    })?;
    Ok(())
}

#[test]
#[ignore = "isolated Win32 desktop"]
fn classification_delete_records() -> Result<(), Error> {
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
    sql(
        &db,
        r#"
        INSERT INTO sessions(exe_name,app_name,start_time,end_time,duration) VALUES ('Studio.EXE','Studio',100,200,100);
        INSERT INTO session_title_samples(session_id,title,start_time,end_time) SELECT id,'Document',start_time,end_time FROM sessions WHERE lower(exe_name)='studio.exe';
        INSERT INTO import_exact_sessions(batch_id,fingerprint,exe_name,app_name,start_time,end_time,duration) VALUES ('test','studio','Studio.EXE','Studio',100,200,100);
        INSERT INTO import_time_buckets(batch_id,fingerprint,exe_name,app_name,bucket_start_time,duration) VALUES ('test','bucket','studio.exe','Studio',0,100);
        UPDATE import_batches SET exact_session_count=2,hour_bucket_count=1 WHERE id='test';
        INSERT INTO icon_cache(exe_name,icon_base64,last_updated) VALUES ('STUDIO.EXE','fixture',1);
        INSERT INTO settings(key,value) VALUES ('__app_link::writer.exe','studio.exe');
        INSERT INTO tool_activity_reminder_rules(target_kind,app_name,exe_name,label_snapshot,limit_ms,message,created_at,updated_at)
            VALUES ('app','Studio','studio.exe','Studio reminder',60000,'',1,1),('app','Writer','writer.exe','Writer reminder',60000,'',1,1);
    "#,
    )?;
    let before = counts(&db)?;
    assert_eq!(before, [2, 2, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 1, 1]);
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
    let search = wait("search", || {
        controls(hwnd).ok()?.into_iter().find(|e| unsafe {
            e.CurrentControlType().ok() == Some(UIA_EditControlTypeId)
                && e.CurrentName().is_ok_and(|n| n == "Search apps")
        })
    })?;
    unsafe {
        search
            .GetCurrentPatternAs::<IUIAutomationValuePattern>(UIA_ValuePatternId)?
            .SetValue(&"Studio".into())?;
    }
    wait("single application", || {
        (names(hwnd)
            .iter()
            .filter(|n| n.starts_with("Category ･ "))
            .count()
            == 1)
            .then_some(())
    })?;
    click(hwnd, "Delete application")?;
    ready(hwnd)?;
    wait("reminder impact", || {
        named(hwnd, "Studio reminder ･ studio.exe (#1)")
    })?;
    assert_eq!(counts(&db)?, before);
    key(hwnd, 13)?;
    wait("Enter selects safe action", || {
        named(hwnd, "Studio ･ studio.exe").is_none().then_some(())
    })?;
    assert_eq!(counts(&db)?, before);
    click(hwnd, "Delete application")?;
    ready(hwnd)?;
    click(hwnd, "Cancel")?;
    wait("cancelled", || {
        named(hwnd, "Studio ･ studio.exe").is_none().then_some(())
    })?;
    assert_eq!(counts(&db)?, before);
    key(hwnd, 13)?;
    ready(hwnd)?;
    key(hwnd, 0x1b)?;
    wait("escape cancels", || {
        named(hwnd, "Studio ･ studio.exe").is_none().then_some(())
    })?;
    assert_eq!(counts(&db)?, before);

    sql(
        &db,
        "CREATE TRIGGER fail_record_delete BEFORE DELETE ON import_time_buckets BEGIN SELECT RAISE(ABORT,'test failure'); END;",
    )?;
    click(hwnd, "Delete application")?;
    ready(hwnd)?;
    click(hwnd, "Delete application")?;
    wait("deletion failure", || {
        named(
            hwnd,
            "Deletion did not finish. Review the scope and try again.",
        )
    })?;
    assert_eq!(
        counts(&db)?,
        before,
        "failed deletion must roll back all tables"
    );
    sql(&db, "DROP TRIGGER fail_record_delete;")?;
    click(hwnd, "Retry")?;
    ready(hwnd)?;
    click(hwnd, "Delete application")?;
    wait("deleted", || {
        named(hwnd, "Studio ･ studio.exe").is_none().then_some(())
    })?;
    assert_eq!(counts(&db)?, [0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1]);
    wait("application removed from classification", || {
        named(hwnd, "Category ･ Studio").is_none().then_some(())
    })?;
    let tray = wait("tray", || window(pid, w!("Patina Tray")))?;
    command(tray, 2)?;
    wait("exit", || host.0.try_wait().ok().flatten())?;
    Ok(())
}
