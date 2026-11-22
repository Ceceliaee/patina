use super::*;
use base64::Engine;
use sqlx::Executor;

#[tokio::test]
async fn rolling_hour_uses_timeline_colors_and_merge_gap_but_ranks_actual_time() {
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::data::sqlite_pool::prepare_pool_schema(&pool, std::path::Path::new(":memory:"))
        .await
        .unwrap();
    pool.execute(
        r##"INSERT OR REPLACE INTO settings(key, value) VALUES
        ('__app_override::editor.exe', '{"displayName":"Editor","color":"#714599"}'),
        ('__app_link::helper.exe', 'editor.exe'),
        ('__app_override::notes.exe', '{"category":"office"}'),
        ('__category_color_override::office', '#336699'),
        ('timeline_merge_gap_secs', '180')"##,
    )
    .await
    .unwrap();
    let png = crate::icon_png_from_bgra(&[0x40, 0x80, 0x20, 255].repeat(256), 16, 16).unwrap();
    let encoded = base64::engine::general_purpose::STANDARD.encode(png);
    for exe in ["editor.exe", "chat.exe"] {
        sqlx::query("INSERT INTO icon_cache(exe_name, icon_base64) VALUES (?,?)")
            .bind(exe)
            .bind(&encoded)
            .execute(&pool)
            .await
            .unwrap();
    }

    let midnight = Local
        .with_ymd_and_hms(2026, 1, 15, 0, 0, 0)
        .single()
        .unwrap()
        .timestamp_millis();
    let base = midnight - 1_800_000;
    let at = |seconds| base + seconds * 1000_i64;
    for (exe, start, end) in [
        ("editor.exe", -60, Some(40)),
        ("chat.exe", 40, Some(60)),
        ("editor.exe", 60, Some(100)),
        ("chat.exe", 100, Some(120)),
        ("helper.exe", 120, Some(160)),
        ("notes.exe", 160, Some(180)),
        ("editor.exe", 300, Some(330)),
        ("notes.exe", 1800, Some(1860)),
        ("editor.exe", 3600, None),
    ] {
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time)
             VALUES (?, ?, '', ?, ?)",
        )
        .bind(exe)
        .bind(exe)
        .bind(at(start))
        .bind(end.map(at))
        .execute(&pool)
        .await
        .unwrap();
    }
    let read = || load(pool.clone(), at(3630), Some(at(3610)), crate::Locale::EnUs);
    let recent = read().await.unwrap();
    assert_eq!(recent.hour_labels, ("23:30".into(), "00:30".into()));
    assert_eq!(recent.day_total_ms, 70_000);
    assert_eq!(recent.day_range, "00:00–00:30");
    assert_eq!(
        recent
            .leaders
            .iter()
            .map(|l| (l.name.as_str(), l.duration_ms, l.color))
            .collect::<Vec<_>>(),
        [
            ("Editor", 130_000, 0x714599),
            ("notes.exe", 80_000, 0x336699),
            ("chat.exe", 40_000, 0x208040)
        ]
    );
    let spans = |recent: &Recent| {
        recent
            .spans
            .iter()
            .map(|s| {
                (
                    (s.left * 3600.).round() as i64,
                    (s.width * 3600.).round() as i64,
                    s.color,
                )
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        spans(&recent),
        [
            (0, 30, 0x208040),
            (30, 270, 0x714599),
            (1770, 60, 0x336699),
            (3570, 10, 0x714599)
        ]
    );
    pool.execute("UPDATE settings SET value='60' WHERE key='timeline_merge_gap_secs'")
        .await
        .unwrap();
    let shorter_gap = read().await.unwrap();
    assert!(shorter_gap
        .leaders
        .iter()
        .map(|l| l.duration_ms)
        .eq(recent.leaders.iter().map(|l| l.duration_ms)));
    assert_eq!(
        spans(&shorter_gap),
        [
            (0, 30, 0x208040),
            (30, 120, 0x714599),
            (270, 30, 0x714599),
            (1770, 60, 0x336699),
            (3570, 10, 0x714599)
        ]
    );
}
