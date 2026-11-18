use chrono::{Local, TimeZone};
use std::path::Path;

pub type Error = Box<dyn std::error::Error>;

pub fn seed(db: &Path) -> Result<(), Error> {
    seed_profile(db, false)
}

pub fn seed_profile(db: &Path, show_icon: bool) -> Result<(), Error> {
    let start = Local
        .from_local_datetime(&Local::now().date_naive().and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .unwrap()
        .timestamp_millis();
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()?;
    rt.block_on(async {
        let pool = patina_activity::open_database(db).await?;
        let mut c = pool.acquire().await?;
        for (key,value) in [
            ("language","en-US"), ("tracking_paused","1"), ("start_minimized","1"), ("launch_at_login","0"),
            ("close_behavior","tray"), ("show_tray_icon",if show_icon {"1"} else {"0"}), ("hourly_activity_chart_mode","total"),
            ("__classification_manual_confirmation_migration::v1","1"),
            ("__app_override::studio.exe", r##"{"category":"development","displayName":"Studio"}"##),
            ("__app_override::writer.exe", r##"{"category":"office"}"##),
            ("__category_color_override::development","#4790cf"), ("__category_color_override::office","#6f7ae6"),
        ] {
            sqlx::query("INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)").bind(key).bind(value).execute(&mut *c).await?;
        }
        let minute = 60_000;
        for (exe,name,lo,hi) in [("studio.exe","Studio",-30,45),("writer.exe","Writer",45,60)] {
            sqlx::query("INSERT INTO sessions(exe_name,app_name,start_time,end_time,duration) VALUES (?,?,?,?,?)")
                .bind(exe).bind(name).bind(start+lo*minute).bind(start+hi*minute).bind((hi-lo)*minute).execute(&mut *c).await?;
        }
        sqlx::query("INSERT INTO import_batches(id,imported_at,source_name,source_kind,source_fingerprint) VALUES ('test',0,'test','exact','test')").execute(&mut *c).await?;
        sqlx::query("INSERT INTO import_exact_sessions(batch_id,fingerprint,exe_name,app_name,start_time,end_time,duration) VALUES ('test','overlap','writer.exe','Writer',?,?,?)")
            .bind(start+55*minute).bind(start+65*minute).bind(10*minute).execute(&mut *c).await?;
        sqlx::query("INSERT INTO anonymous_activity(id,start_time,end_time,observed_until,is_web) VALUES ('anon',?,?,?,0)")
            .bind(start+65*minute).bind(start+70*minute).bind(start+70*minute).execute(&mut *c).await?;
        drop(c);
        pool.close().await;
        Ok::<(),Error>(())
    })?;
    Ok(())
}
