use super::*;
use crate::domain::backup::{BackupSession, BackupSetting};
use std::io::{Cursor, Read, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

fn recompress_backup_archive(
    archive_bytes: Vec<u8>,
    compression_method: CompressionMethod,
) -> Vec<u8> {
    let mut source = ZipArchive::new(Cursor::new(archive_bytes)).expect("source backup zip");
    let mut target = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default()
        .compression_method(compression_method)
        .last_modified_time(
            DateTime::from_date_and_time(2026, 7, 10, 12, 0, 0)
                .expect("valid recompressed backup timestamp"),
        );

    for index in 0..source.len() {
        let mut source_entry = source.by_index(index).expect("source backup entry");
        let entry_name = source_entry.name().unwrap().into_owned();
        let mut content = Vec::new();
        source_entry
            .read_to_end(&mut content)
            .expect("source backup entry content");
        target
            .start_file(entry_name, options)
            .expect("recompressed backup entry");
        target
            .write_all(&content)
            .expect("recompressed backup entry content");
    }

    target
        .finish()
        .expect("recompressed backup zip")
        .into_inner()
}

#[test]
fn structured_backup_archive_recompressed_with_deflate_still_decodes() {
    let payload = BackupPayload {
        version: CURRENT_BACKUP_VERSION,
        meta: BackupMeta {
            exported_at_ms: 1_714_000_000_000,
            schema_version: CURRENT_BACKUP_SCHEMA_VERSION,
            app_version: "test".to_string(),
        },
        sessions: vec![BackupSession {
            id: 1,
            app_name: "App".to_string(),
            exe_name: "app.exe".to_string(),
            window_title: Some("Window".to_string()),
            start_time: 10,
            end_time: Some(20),
            duration: Some(10),
            continuity_group_start_time: Some(10),
        }],
        title_samples: Vec::new(),
        settings: vec![BackupSetting {
            key: "language".to_string(),
            value: "zh-CN".to_string(),
        }],
        icon_cache: Vec::new(),
        web_activity_segments: Vec::new(),
        web_favicon_cache: Vec::new(),
        tool_reminders: Vec::new(),
        tool_timers: Vec::new(),
        tool_timer_laps: Vec::new(),
        tool_pomodoro_runs: Vec::new(),
        tool_daily_stats: Vec::new(),
        tool_software_reminder_rules: Vec::new(),
    };

    let stored_archive = encode_backup_archive(&payload).expect("stored backup archive");
    let mut stored_zip =
        ZipArchive::new(Cursor::new(stored_archive.clone())).expect("stored backup zip");
    for index in 0..stored_zip.len() {
        assert_eq!(
            stored_zip
                .by_index(index)
                .expect("stored backup entry")
                .compression(),
            CompressionMethod::Stored
        );
    }

    let deflated_archive = recompress_backup_archive(stored_archive, CompressionMethod::Deflated);
    let mut deflated_zip =
        ZipArchive::new(Cursor::new(deflated_archive.clone())).expect("deflated backup zip");
    for index in 0..deflated_zip.len() {
        assert_eq!(
            deflated_zip
                .by_index(index)
                .expect("deflated backup entry")
                .compression(),
            CompressionMethod::Deflated
        );
    }

    let backup_path = std::env::temp_dir().join(format!(
        "patina-deflated-backup-{}-{}.zip",
        std::process::id(),
        payload.meta.exported_at_ms
    ));
    fs::write(&backup_path, deflated_archive).expect("write deflated backup fixture");
    let decoded = read_backup_payload(&backup_path);
    let _ = fs::remove_file(&backup_path);
    let decoded = decoded.expect("deflated current-format backup should decode");

    assert_eq!(decoded.version, payload.version);
    assert_eq!(decoded.meta.exported_at_ms, payload.meta.exported_at_ms);
    assert_eq!(decoded.sessions.len(), 1);
    assert_eq!(decoded.settings.len(), 1);
}
