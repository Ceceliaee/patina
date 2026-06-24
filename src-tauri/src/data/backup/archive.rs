use crate::domain::backup::{
    BackupIconCache, BackupMeta, BackupPayload, BackupSession, BackupSetting, BackupTitleSample,
    BackupWebActivitySegment,
};
use crc32fast::Hasher;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

pub(super) const BACKUP_FORMAT: &str = "PatinaBackup";
pub(super) const BACKUP_MANIFEST_ENTRY_NAME: &str = "manifest.json";
pub(super) const BACKUP_CHECKSUMS_ENTRY_NAME: &str = "checksums.json";
pub(super) const BACKUP_SESSIONS_ENTRY_NAME: &str = "data/sessions.json";
pub(super) const BACKUP_TITLE_SAMPLES_ENTRY_NAME: &str = "data/session_title_samples.json";
pub(super) const BACKUP_SETTINGS_ENTRY_NAME: &str = "data/settings.json";
pub(super) const BACKUP_ICON_CACHE_ENTRY_NAME: &str = "data/icon_cache.json";
pub(super) const BACKUP_WEB_ACTIVITY_SEGMENTS_ENTRY_NAME: &str = "data/web_activity_segments.json";
pub(super) const BACKUP_TOOL_REMINDERS_ENTRY_NAME: &str = "data/tool_reminders.json";
pub(super) const BACKUP_TOOL_TIMERS_ENTRY_NAME: &str = "data/tool_timers.json";
pub(super) const BACKUP_TOOL_TIMER_LAPS_ENTRY_NAME: &str = "data/tool_timer_laps.json";
pub(super) const BACKUP_TOOL_POMODORO_RUNS_ENTRY_NAME: &str = "data/tool_pomodoro_runs.json";
pub(super) const BACKUP_TOOL_DAILY_STATS_ENTRY_NAME: &str = "data/tool_daily_stats.json";

#[derive(Debug, Serialize, Deserialize)]
pub(super) struct BackupArchiveManifest {
    pub(super) format: String,
    pub(super) backup_version: u32,
    pub(super) exported_at_ms: u64,
    pub(super) schema_version: u32,
    pub(super) app_version: String,
    pub(super) files: BackupArchiveFiles,
    pub(super) counts: BackupArchiveCounts,
}

#[derive(Debug, Serialize, Deserialize)]
pub(super) struct BackupArchiveFiles {
    pub(super) sessions: String,
    #[serde(default)]
    pub(super) title_samples: String,
    pub(super) settings: String,
    pub(super) icon_cache: String,
    #[serde(default)]
    pub(super) web_activity_segments: String,
    #[serde(default)]
    pub(super) tool_reminders: String,
    #[serde(default)]
    pub(super) tool_timers: String,
    #[serde(default)]
    pub(super) tool_timer_laps: String,
    #[serde(default)]
    pub(super) tool_pomodoro_runs: String,
    #[serde(default)]
    pub(super) tool_daily_stats: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub(super) struct BackupArchiveCounts {
    pub(super) sessions: usize,
    #[serde(default)]
    pub(super) title_samples: usize,
    pub(super) settings: usize,
    pub(super) icon_cache: usize,
    #[serde(default)]
    pub(super) web_activity_segments: usize,
    #[serde(default)]
    pub(super) tool_reminders: usize,
    #[serde(default)]
    pub(super) tool_timers: usize,
    #[serde(default)]
    pub(super) tool_timer_laps: usize,
    #[serde(default)]
    pub(super) tool_pomodoro_runs: usize,
    #[serde(default)]
    pub(super) tool_daily_stats: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub(super) struct BackupArchiveChecksums {
    pub(super) algorithm: String,
    pub(super) files: BTreeMap<String, String>,
}

fn build_backup_manifest(payload: &BackupPayload) -> BackupArchiveManifest {
    BackupArchiveManifest {
        format: BACKUP_FORMAT.to_string(),
        backup_version: payload.version,
        exported_at_ms: payload.meta.exported_at_ms,
        schema_version: payload.meta.schema_version,
        app_version: payload.meta.app_version.clone(),
        files: BackupArchiveFiles {
            sessions: BACKUP_SESSIONS_ENTRY_NAME.to_string(),
            title_samples: BACKUP_TITLE_SAMPLES_ENTRY_NAME.to_string(),
            settings: BACKUP_SETTINGS_ENTRY_NAME.to_string(),
            icon_cache: BACKUP_ICON_CACHE_ENTRY_NAME.to_string(),
            web_activity_segments: BACKUP_WEB_ACTIVITY_SEGMENTS_ENTRY_NAME.to_string(),
            tool_reminders: BACKUP_TOOL_REMINDERS_ENTRY_NAME.to_string(),
            tool_timers: BACKUP_TOOL_TIMERS_ENTRY_NAME.to_string(),
            tool_timer_laps: BACKUP_TOOL_TIMER_LAPS_ENTRY_NAME.to_string(),
            tool_pomodoro_runs: BACKUP_TOOL_POMODORO_RUNS_ENTRY_NAME.to_string(),
            tool_daily_stats: BACKUP_TOOL_DAILY_STATS_ENTRY_NAME.to_string(),
        },
        counts: BackupArchiveCounts {
            sessions: payload.sessions.len(),
            title_samples: payload.title_samples.len(),
            settings: payload.settings.len(),
            icon_cache: payload.icon_cache.len(),
            web_activity_segments: payload.web_activity_segments.len(),
            tool_reminders: payload.tool_reminders.len(),
            tool_timers: payload.tool_timers.len(),
            tool_timer_laps: payload.tool_timer_laps.len(),
            tool_pomodoro_runs: payload.tool_pomodoro_runs.len(),
            tool_daily_stats: payload.tool_daily_stats.len(),
        },
    }
}

pub(super) fn serialize_pretty<T: Serialize>(value: &T, label: &str) -> Result<String, String> {
    serde_json::to_string_pretty(value)
        .map_err(|error| format!("failed to serialize backup {label}: {error}"))
}

pub(super) fn checksum(value: &str) -> String {
    let mut hasher = Hasher::new();
    hasher.update(value.as_bytes());
    format!("{:08x}", hasher.finalize())
}

fn zip_start_file(
    archive: &mut ZipWriter<Cursor<Vec<u8>>>,
    name: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    archive
        .start_file(name, options)
        .map_err(|error| format!("failed to start backup archive entry `{name}`: {error}"))
}

pub(super) fn zip_write_file(
    archive: &mut ZipWriter<Cursor<Vec<u8>>>,
    name: &str,
    content: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip_start_file(archive, name, options)?;
    archive
        .write_all(content.as_bytes())
        .map_err(|error| format!("failed to write backup archive entry `{name}`: {error}"))
}

pub(super) fn encode_backup_archive(payload: &BackupPayload) -> Result<Vec<u8>, String> {
    let manifest = build_backup_manifest(payload);
    let sessions = serialize_pretty(&payload.sessions, "sessions")?;
    let title_samples = serialize_pretty(&payload.title_samples, "title samples")?;
    let settings = serialize_pretty(&payload.settings, "settings")?;
    let icon_cache = serialize_pretty(&payload.icon_cache, "icon cache")?;
    let web_activity_segments =
        serialize_pretty(&payload.web_activity_segments, "web activity segments")?;
    let tool_reminders = serialize_pretty(&payload.tool_reminders, "tool reminders")?;
    let tool_timers = serialize_pretty(&payload.tool_timers, "tool timers")?;
    let tool_timer_laps = serialize_pretty(&payload.tool_timer_laps, "tool timer laps")?;
    let tool_pomodoro_runs = serialize_pretty(&payload.tool_pomodoro_runs, "tool pomodoro runs")?;
    let tool_daily_stats = serialize_pretty(&payload.tool_daily_stats, "tool daily stats")?;
    let manifest_json = serialize_pretty(&manifest, "manifest")?;

    let mut checksum_files = BTreeMap::new();
    checksum_files.insert(
        BACKUP_MANIFEST_ENTRY_NAME.to_string(),
        checksum(&manifest_json),
    );
    checksum_files.insert(BACKUP_SESSIONS_ENTRY_NAME.to_string(), checksum(&sessions));
    checksum_files.insert(
        BACKUP_TITLE_SAMPLES_ENTRY_NAME.to_string(),
        checksum(&title_samples),
    );
    checksum_files.insert(BACKUP_SETTINGS_ENTRY_NAME.to_string(), checksum(&settings));
    checksum_files.insert(
        BACKUP_ICON_CACHE_ENTRY_NAME.to_string(),
        checksum(&icon_cache),
    );
    checksum_files.insert(
        BACKUP_WEB_ACTIVITY_SEGMENTS_ENTRY_NAME.to_string(),
        checksum(&web_activity_segments),
    );
    checksum_files.insert(
        BACKUP_TOOL_REMINDERS_ENTRY_NAME.to_string(),
        checksum(&tool_reminders),
    );
    checksum_files.insert(
        BACKUP_TOOL_TIMERS_ENTRY_NAME.to_string(),
        checksum(&tool_timers),
    );
    checksum_files.insert(
        BACKUP_TOOL_TIMER_LAPS_ENTRY_NAME.to_string(),
        checksum(&tool_timer_laps),
    );
    checksum_files.insert(
        BACKUP_TOOL_POMODORO_RUNS_ENTRY_NAME.to_string(),
        checksum(&tool_pomodoro_runs),
    );
    checksum_files.insert(
        BACKUP_TOOL_DAILY_STATS_ENTRY_NAME.to_string(),
        checksum(&tool_daily_stats),
    );
    let checksums = BackupArchiveChecksums {
        algorithm: "crc32".to_string(),
        files: checksum_files,
    };
    let checksums_json = serialize_pretty(&checksums, "checksums")?;

    let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    zip_write_file(
        &mut archive,
        BACKUP_MANIFEST_ENTRY_NAME,
        &manifest_json,
        options,
    )?;
    zip_write_file(&mut archive, BACKUP_SESSIONS_ENTRY_NAME, &sessions, options)?;
    zip_write_file(
        &mut archive,
        BACKUP_TITLE_SAMPLES_ENTRY_NAME,
        &title_samples,
        options,
    )?;
    zip_write_file(&mut archive, BACKUP_SETTINGS_ENTRY_NAME, &settings, options)?;
    zip_write_file(
        &mut archive,
        BACKUP_ICON_CACHE_ENTRY_NAME,
        &icon_cache,
        options,
    )?;
    zip_write_file(
        &mut archive,
        BACKUP_WEB_ACTIVITY_SEGMENTS_ENTRY_NAME,
        &web_activity_segments,
        options,
    )?;
    zip_write_file(
        &mut archive,
        BACKUP_TOOL_REMINDERS_ENTRY_NAME,
        &tool_reminders,
        options,
    )?;
    zip_write_file(
        &mut archive,
        BACKUP_TOOL_TIMERS_ENTRY_NAME,
        &tool_timers,
        options,
    )?;
    zip_write_file(
        &mut archive,
        BACKUP_TOOL_TIMER_LAPS_ENTRY_NAME,
        &tool_timer_laps,
        options,
    )?;
    zip_write_file(
        &mut archive,
        BACKUP_TOOL_POMODORO_RUNS_ENTRY_NAME,
        &tool_pomodoro_runs,
        options,
    )?;
    zip_write_file(
        &mut archive,
        BACKUP_TOOL_DAILY_STATS_ENTRY_NAME,
        &tool_daily_stats,
        options,
    )?;
    zip_write_file(
        &mut archive,
        BACKUP_CHECKSUMS_ENTRY_NAME,
        &checksums_json,
        options,
    )?;

    let buffer = archive
        .finish()
        .map_err(|error| format!("failed to finish backup archive: {error}"))?
        .into_inner();
    Ok(buffer)
}

fn read_zip_entry(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
    entry_name: &str,
    backup_path: &Path,
) -> Result<String, String> {
    let mut entry = archive.by_name(entry_name).map_err(|error| {
        format!(
            "backup archive `{}` does not contain {entry_name}: {error}",
            backup_path.display()
        )
    })?;
    let mut content = String::new();
    entry.read_to_string(&mut content).map_err(|error| {
        format!(
            "failed to read backup archive entry `{entry_name}` from `{}`: {error}",
            backup_path.display()
        )
    })?;
    Ok(content)
}

fn parse_json<T: for<'de> Deserialize<'de>>(
    raw_json: &str,
    source_path: &Path,
    label: &str,
) -> Result<T, String> {
    serde_json::from_str::<T>(raw_json).map_err(|error| {
        format!(
            "failed to parse backup {label} from `{}`: {error}",
            source_path.display()
        )
    })
}

fn verify_backup_checksums(
    checksums: &BackupArchiveChecksums,
    entries: &[(&str, &str)],
    backup_path: &Path,
) -> Result<(), String> {
    if checksums.algorithm != "crc32" {
        return Err(format!(
            "backup archive `{}` uses unsupported checksum algorithm `{}`",
            backup_path.display(),
            checksums.algorithm
        ));
    }

    for (entry_name, content) in entries {
        let Some(expected) = checksums.files.get(*entry_name) else {
            return Err(format!(
                "backup archive `{}` is missing checksum for {entry_name}",
                backup_path.display()
            ));
        };
        let actual = checksum(content);
        if expected != &actual {
            return Err(format!(
                "backup archive `{}` checksum mismatch for {entry_name}",
                backup_path.display()
            ));
        }
    }

    Ok(())
}

fn backup_archive_declares_title_samples(
    manifest: &BackupArchiveManifest,
    checksums: &BackupArchiveChecksums,
) -> bool {
    !manifest.files.title_samples.trim().is_empty()
        || checksums
            .files
            .contains_key(BACKUP_TITLE_SAMPLES_ENTRY_NAME)
}

fn backup_archive_declares_entry(
    manifest_path: &str,
    checksums: &BackupArchiveChecksums,
    entry_name: &str,
) -> bool {
    !manifest_path.trim().is_empty() || checksums.files.contains_key(entry_name)
}

fn read_optional_declared_zip_entry(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
    manifest_path: &str,
    checksums: &BackupArchiveChecksums,
    entry_name: &str,
    backup_path: &Path,
) -> Result<Option<String>, String> {
    if backup_archive_declares_entry(manifest_path, checksums, entry_name) {
        return read_zip_entry(archive, entry_name, backup_path).map(Some);
    }

    Ok(None)
}

pub(super) fn decode_structured_backup_archive(
    archive: &mut ZipArchive<Cursor<Vec<u8>>>,
    backup_path: &Path,
) -> Result<BackupPayload, String> {
    let manifest_json = read_zip_entry(archive, BACKUP_MANIFEST_ENTRY_NAME, backup_path)?;
    let sessions_json = read_zip_entry(archive, BACKUP_SESSIONS_ENTRY_NAME, backup_path)?;
    let settings_json = read_zip_entry(archive, BACKUP_SETTINGS_ENTRY_NAME, backup_path)?;
    let icon_cache_json = read_zip_entry(archive, BACKUP_ICON_CACHE_ENTRY_NAME, backup_path)?;
    let checksums_json = read_zip_entry(archive, BACKUP_CHECKSUMS_ENTRY_NAME, backup_path)?;

    let checksums =
        parse_json::<BackupArchiveChecksums>(&checksums_json, backup_path, "checksums")?;
    let manifest = parse_json::<BackupArchiveManifest>(&manifest_json, backup_path, "manifest")?;
    if manifest.format != BACKUP_FORMAT {
        return Err(format!(
            "backup archive `{}` has unsupported format `{}`",
            backup_path.display(),
            manifest.format
        ));
    }
    let title_samples_json = if backup_archive_declares_title_samples(&manifest, &checksums) {
        Some(read_zip_entry(
            archive,
            BACKUP_TITLE_SAMPLES_ENTRY_NAME,
            backup_path,
        )?)
    } else {
        None
    };
    let tool_reminders_json = read_optional_declared_zip_entry(
        archive,
        &manifest.files.tool_reminders,
        &checksums,
        BACKUP_TOOL_REMINDERS_ENTRY_NAME,
        backup_path,
    )?;
    let tool_timers_json = read_optional_declared_zip_entry(
        archive,
        &manifest.files.tool_timers,
        &checksums,
        BACKUP_TOOL_TIMERS_ENTRY_NAME,
        backup_path,
    )?;
    let tool_timer_laps_json = read_optional_declared_zip_entry(
        archive,
        &manifest.files.tool_timer_laps,
        &checksums,
        BACKUP_TOOL_TIMER_LAPS_ENTRY_NAME,
        backup_path,
    )?;
    let tool_pomodoro_runs_json = read_optional_declared_zip_entry(
        archive,
        &manifest.files.tool_pomodoro_runs,
        &checksums,
        BACKUP_TOOL_POMODORO_RUNS_ENTRY_NAME,
        backup_path,
    )?;
    let tool_daily_stats_json = read_optional_declared_zip_entry(
        archive,
        &manifest.files.tool_daily_stats,
        &checksums,
        BACKUP_TOOL_DAILY_STATS_ENTRY_NAME,
        backup_path,
    )?;
    let web_activity_segments_json = read_optional_declared_zip_entry(
        archive,
        &manifest.files.web_activity_segments,
        &checksums,
        BACKUP_WEB_ACTIVITY_SEGMENTS_ENTRY_NAME,
        backup_path,
    )?;
    let mut checksum_entries = vec![
        (BACKUP_MANIFEST_ENTRY_NAME, manifest_json.as_str()),
        (BACKUP_SESSIONS_ENTRY_NAME, sessions_json.as_str()),
        (BACKUP_SETTINGS_ENTRY_NAME, settings_json.as_str()),
        (BACKUP_ICON_CACHE_ENTRY_NAME, icon_cache_json.as_str()),
    ];
    if let Some(web_activity_segments_json) = web_activity_segments_json.as_deref() {
        checksum_entries.push((
            BACKUP_WEB_ACTIVITY_SEGMENTS_ENTRY_NAME,
            web_activity_segments_json,
        ));
    }
    if let Some(title_samples_json) = title_samples_json.as_deref() {
        checksum_entries.push((BACKUP_TITLE_SAMPLES_ENTRY_NAME, title_samples_json));
    }
    if let Some(tool_reminders_json) = tool_reminders_json.as_deref() {
        checksum_entries.push((BACKUP_TOOL_REMINDERS_ENTRY_NAME, tool_reminders_json));
    }
    if let Some(tool_timers_json) = tool_timers_json.as_deref() {
        checksum_entries.push((BACKUP_TOOL_TIMERS_ENTRY_NAME, tool_timers_json));
    }
    if let Some(tool_timer_laps_json) = tool_timer_laps_json.as_deref() {
        checksum_entries.push((BACKUP_TOOL_TIMER_LAPS_ENTRY_NAME, tool_timer_laps_json));
    }
    if let Some(tool_pomodoro_runs_json) = tool_pomodoro_runs_json.as_deref() {
        checksum_entries.push((
            BACKUP_TOOL_POMODORO_RUNS_ENTRY_NAME,
            tool_pomodoro_runs_json,
        ));
    }
    if let Some(tool_daily_stats_json) = tool_daily_stats_json.as_deref() {
        checksum_entries.push((BACKUP_TOOL_DAILY_STATS_ENTRY_NAME, tool_daily_stats_json));
    }
    verify_backup_checksums(&checksums, &checksum_entries, backup_path)?;

    let sessions = parse_json::<Vec<BackupSession>>(&sessions_json, backup_path, "sessions")?;
    let title_samples = title_samples_json
        .map(|json| parse_json::<Vec<BackupTitleSample>>(&json, backup_path, "title samples"))
        .transpose()?
        .unwrap_or_default();
    let settings = parse_json::<Vec<BackupSetting>>(&settings_json, backup_path, "settings")?;
    let icon_cache =
        parse_json::<Vec<BackupIconCache>>(&icon_cache_json, backup_path, "icon cache")?;
    let web_activity_segments = web_activity_segments_json
        .map(|json| {
            parse_json::<Vec<BackupWebActivitySegment>>(&json, backup_path, "web activity segments")
        })
        .transpose()?
        .unwrap_or_default();
    let tool_reminders = tool_reminders_json
        .map(|json| parse_json(&json, backup_path, "tool reminders"))
        .transpose()?
        .unwrap_or_default();
    let tool_timers = tool_timers_json
        .map(|json| parse_json(&json, backup_path, "tool timers"))
        .transpose()?
        .unwrap_or_default();
    let tool_timer_laps = tool_timer_laps_json
        .map(|json| parse_json(&json, backup_path, "tool timer laps"))
        .transpose()?
        .unwrap_or_default();
    let tool_pomodoro_runs = tool_pomodoro_runs_json
        .map(|json| parse_json(&json, backup_path, "tool pomodoro runs"))
        .transpose()?
        .unwrap_or_default();
    let tool_daily_stats = tool_daily_stats_json
        .map(|json| parse_json(&json, backup_path, "tool daily stats"))
        .transpose()?
        .unwrap_or_default();

    Ok(BackupPayload {
        version: manifest.backup_version,
        meta: BackupMeta {
            exported_at_ms: manifest.exported_at_ms,
            schema_version: manifest.schema_version,
            app_version: manifest.app_version,
        },
        sessions,
        title_samples,
        settings,
        icon_cache,
        web_activity_segments,
        tool_reminders,
        tool_timers,
        tool_timer_laps,
        tool_pomodoro_runs,
        tool_daily_stats,
    })
}

pub(super) fn read_backup_payload(backup_path: &Path) -> Result<BackupPayload, String> {
    let raw_bytes = fs::read(backup_path).map_err(|error| {
        format!(
            "failed to read backup file `{}`: {error}",
            backup_path.display()
        )
    })?;

    if raw_bytes.starts_with(b"PK") {
        let mut archive = ZipArchive::new(Cursor::new(raw_bytes)).map_err(|error| {
            format!(
                "failed to read backup archive `{}`: {error}",
                backup_path.display()
            )
        })?;

        if archive.by_name(BACKUP_MANIFEST_ENTRY_NAME).is_ok() {
            return decode_structured_backup_archive(&mut archive, backup_path);
        }

        return Err(format!(
            "backup archive `{}` is not a supported structured Patina backup",
            backup_path.display()
        ));
    }

    Err(format!(
        "backup file `{}` is not a supported structured Patina backup",
        backup_path.display()
    ))
}
