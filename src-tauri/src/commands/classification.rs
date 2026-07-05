use crate::data::classification_service::commit_classification_setting_mutations_with_recovery;
use crate::data::repositories::classification_settings::ClassificationSettingMutation;
use crate::engine::classification::auto_classifier;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoClassifyCandidate {
    app_name: String,
    exe_name: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoClassifyRequest {
    pub candidates: Vec<AutoClassifyCandidate>,
    pub reclassify: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoClassifyResult {
    exe_name: String,
    category: Option<String>,
    display_name: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedExe {
    pub exe_name: String,
    pub file_path: String,
}

#[tauri::command]
pub async fn cmd_scan_directory_for_exes(
    dir_path: String,
) -> Result<Vec<ScannedExe>, String> {
    let dir = std::path::PathBuf::from(&dir_path);
    if !dir.is_dir() {
        return Err(format!("Not a valid directory: {dir_path}"));
    }

    let mut results = Vec::new();
    if let Ok(entries) = dir.read_dir() {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().map(|e| e.to_ascii_lowercase() == "exe").unwrap_or(false) {
                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    results.push(ScannedExe {
                        exe_name: name.to_string(),
                        file_path: path.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }

    // Also check one level deep
    if let Ok(entries) = dir.read_dir() {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Ok(sub_entries) = path.read_dir() {
                    for sub in sub_entries.flatten() {
                        let sub_path = sub.path();
                        if sub_path.extension().map(|e| e.to_ascii_lowercase() == "exe").unwrap_or(false) {
                            if let Some(name) = sub_path.file_name().and_then(|n| n.to_str()) {
                                results.push(ScannedExe {
                                    exe_name: name.to_string(),
                                    file_path: sub_path.to_string_lossy().to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn cmd_auto_classify_apps(
    request: AutoClassifyRequest,
    app: AppHandle,
) -> Result<Vec<AutoClassifyResult>, String> {
    let pool = crate::data::sqlite_pool::wait_for_sqlite_pool(&app).await?;
    let reclassify = request.reclassify.unwrap_or(false);

    let mut results = Vec::with_capacity(request.candidates.len());

    // Load custom scan directories from settings
    let extra_dirs: Vec<String> = sqlx::query_scalar::<_, String>(
        "SELECT value FROM settings WHERE key = 'custom_scan_dirs'",
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
    .unwrap_or_default();

    for candidate in &request.candidates {
        // Skip already-classified apps unless reclassify is true
        if !reclassify {
            let exists: bool = sqlx::query_scalar::<_, i64>(
                "SELECT COUNT(*) FROM settings WHERE key = ?1",
            )
            .bind(format!("__app_override::{}", candidate.exe_name))
            .fetch_one(&pool)
            .await
            .map_err(|e| format!("db check failed: {e}"))?
                > 0;
            if exists {
                results.push(AutoClassifyResult {
                    exe_name: candidate.exe_name.clone(),
                    category: None,
                    display_name: None,
                });
                continue;
            }
        }

        let classification =
            auto_classifier::classify_app(&candidate.app_name, &candidate.exe_name, &extra_dirs).await?;
        results.push(AutoClassifyResult {
            exe_name: candidate.exe_name.clone(),
            category: classification.as_ref().and_then(|c| c.category.clone()),
            display_name: classification
                .as_ref()
                .and_then(|c| c.display_name.clone()),
        });
    }

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("time error: {e}"))?
        .as_millis() as i64;

    let mutations: Vec<ClassificationSettingMutation> = results
        .iter()
        .filter_map(|r| {
            r.category.as_ref().map(|cat| {
                let value = serde_json::json!({
                    "category": cat,
                    "displayName": r.display_name,
                    "color": null,
                    "track": true,
                    "captureTitle": true,
                    "enabled": true,
                    "updatedAt": now_ms,
                });
                ClassificationSettingMutation {
                    key: format!("__app_override::{}", r.exe_name),
                    value: Some(value.to_string()),
                }
            })
        })
        .collect();

    if !mutations.is_empty() {
        commit_classification_setting_mutations_with_recovery(&app, &mutations).await?;
    }

    Ok(results)
}
