use crate::data::import::canonical_csv::parse_canonical_csv;
use crate::data::import::model::{
    record_fingerprint, CanonicalImportRecord, ImportCategoryCandidateDto, ImportPreviewDto,
    ImportPreviewErrorDto, ImportRecordType, ParsedCanonicalCsv, MAX_IMPORT_FILE_BYTES,
    MAX_PREVIEW_ERRORS,
};
use crate::data::repositories::import_batches;
use crate::data::sqlite_pool::wait_for_sqlite_pool;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

pub async fn preview_canonical_import<R: Runtime>(
    app: &AppHandle<R>,
    file_path: String,
) -> Result<ImportPreviewDto, String> {
    let path = validate_canonical_path(&file_path)?;
    let (bytes, file_fingerprint, parsed) = load_canonical_file(&path).await?;
    drop(bytes);
    let pool = wait_for_sqlite_pool(app).await?;
    let mut known_fingerprints = import_batches::load_fingerprints(&pool).await?;
    let mut duplicate_records = 0usize;
    for record in &parsed.records {
        if !known_fingerprints.insert(record_fingerprint(record)) {
            duplicate_records += 1;
        }
    }
    Ok(build_preview_dto(
        &path,
        file_fingerprint,
        parsed,
        duplicate_records,
    ))
}

pub(crate) async fn load_canonical_file(
    path: &Path,
) -> Result<(Vec<u8>, String, ParsedCanonicalCsv), String> {
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|error| format!("failed to inspect canonical CSV: {error}"))?;
    if !metadata.is_file() {
        return Err("canonical import path must be a regular file".to_string());
    }
    if metadata.len() > MAX_IMPORT_FILE_BYTES {
        return Err(format!(
            "canonical CSV exceeds the {} MB safety limit",
            MAX_IMPORT_FILE_BYTES / 1024 / 1024
        ));
    }
    let bytes = tokio::fs::read(path)
        .await
        .map_err(|error| format!("failed to read canonical CSV: {error}"))?;
    if bytes.len() as u64 > MAX_IMPORT_FILE_BYTES {
        return Err(format!(
            "canonical CSV exceeds the {} MB safety limit",
            MAX_IMPORT_FILE_BYTES / 1024 / 1024
        ));
    }
    let file_fingerprint = bytes_fingerprint(&bytes);
    let parsed = parse_canonical_csv(&bytes)?;
    Ok((bytes, file_fingerprint, parsed))
}

pub(crate) fn validate_canonical_path(file_path: &str) -> Result<PathBuf, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("canonical import path cannot be empty".to_string());
    }
    let path = PathBuf::from(trimmed);
    let is_csv = path
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("csv"));
    if !is_csv {
        return Err("canonical import requires a CSV file".to_string());
    }
    Ok(path)
}

pub(crate) fn bytes_fingerprint(bytes: &[u8]) -> String {
    let mut digest = Sha256::new();
    digest.update(bytes);
    format!("{:x}", digest.finalize())
}

fn build_preview_dto(
    path: &Path,
    file_fingerprint: String,
    parsed: ParsedCanonicalCsv,
    duplicate_records: usize,
) -> ImportPreviewDto {
    let exact_sessions = parsed
        .records
        .iter()
        .filter(|record| record.record_type == ImportRecordType::ExactSession)
        .count();
    let hour_buckets = parsed.records.len() - exact_sessions;
    let category_candidates = collect_category_candidates(&parsed.records);
    ImportPreviewDto {
        file_path: path.to_string_lossy().to_string(),
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Patina CSV")
            .to_string(),
        file_fingerprint,
        valid_records: parsed.records.len(),
        duplicate_records,
        error_records: parsed.errors.len(),
        exact_sessions,
        hour_buckets,
        category_candidates,
        errors: parsed
            .errors
            .into_iter()
            .take(MAX_PREVIEW_ERRORS)
            .map(|error| ImportPreviewErrorDto {
                line: error.line,
                message: error.message,
            })
            .collect(),
    }
}

fn collect_category_candidates(
    records: &[CanonicalImportRecord],
) -> Vec<ImportCategoryCandidateDto> {
    let mut candidates = BTreeMap::<String, BTreeMap<String, String>>::new();
    for record in records {
        let categories = candidates.entry(record.exe_name.clone()).or_default();
        let Some(raw_category) = record.category.as_deref() else {
            continue;
        };
        let category = raw_category
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ");
        if category.is_empty() || category == "未知" || category.eq_ignore_ascii_case("unknown") {
            continue;
        }
        categories
            .entry(category.to_lowercase())
            .or_insert(category);
    }
    candidates
        .into_iter()
        .map(|(exe_name, categories)| ImportCategoryCandidateDto {
            exe_name,
            categories: categories.into_values().collect(),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::import::model::ImportRecordType;

    fn record(exe_name: &str, category: Option<&str>, line: usize) -> CanonicalImportRecord {
        CanonicalImportRecord {
            source_line: line,
            record_type: ImportRecordType::HourBucket,
            start_time_ms: line as i64 * 3_600_000,
            end_time_ms: None,
            duration_ms: 1_000,
            exe_name: exe_name.to_string(),
            app_name: None,
            title: None,
            category: category.map(str::to_string),
        }
    }

    #[test]
    fn category_candidates_group_by_executable_and_deduplicate_labels() {
        let candidates = collect_category_candidates(&[
            record("code.exe", Some(" 开发 "), 2),
            record("code.exe", Some("开发"), 3),
            record("slack.exe", Some("Development"), 4),
            record("slack.exe", Some("development"), 5),
            record("chrome.exe", Some("工作"), 6),
            record("chrome.exe", Some("娱乐"), 7),
            record("empty.exe", None, 8),
            record("unknown.exe", Some("未知"), 9),
        ]);

        assert_eq!(
            candidates,
            vec![
                crate::data::import::model::ImportCategoryCandidateDto {
                    exe_name: "chrome.exe".into(),
                    categories: vec!["娱乐".into(), "工作".into()],
                },
                crate::data::import::model::ImportCategoryCandidateDto {
                    exe_name: "code.exe".into(),
                    categories: vec!["开发".into()],
                },
                crate::data::import::model::ImportCategoryCandidateDto {
                    exe_name: "empty.exe".into(),
                    categories: vec![],
                },
                crate::data::import::model::ImportCategoryCandidateDto {
                    exe_name: "slack.exe".into(),
                    categories: vec!["Development".into()],
                },
                crate::data::import::model::ImportCategoryCandidateDto {
                    exe_name: "unknown.exe".into(),
                    categories: vec![],
                },
            ]
        );
    }
}
