use crate::data::repositories::classification_settings::{
    commit_classification_setting_mutations, ClassificationSettingMutation,
};
use crate::data::sqlite_error::SqliteOperationError;
use crate::data::sqlite_pool::{reopen_sqlite_pool, wait_for_sqlite_pool};
use std::collections::HashMap;
use tauri::{AppHandle, Runtime};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AppRecordingPolicyChange {
    pub exe_name: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WebDomainRecordingPolicyChange {
    pub normalized_domain: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TitleRecordingPolicyChange {
    pub identity: String,
    pub enabled: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ClassificationCommitOutcome {
    pub app_recording_changes: Vec<AppRecordingPolicyChange>,
    pub web_domain_recording_changes: Vec<WebDomainRecordingPolicyChange>,
    pub app_title_changes: Vec<TitleRecordingPolicyChange>,
    pub web_domain_title_changes: Vec<TitleRecordingPolicyChange>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RecordingPolicyApplyOutcome {
    pub app_sealed: bool,
    pub web_sealed: bool,
}

pub async fn commit_classification_setting_mutations_with_recovery<R: Runtime>(
    app: &AppHandle<R>,
    mutations: &[ClassificationSettingMutation],
) -> Result<ClassificationCommitOutcome, SqliteOperationError> {
    let pool = wait_for_sqlite_pool(app).await.map_err(|error| {
        SqliteOperationError::operation_failed("load classification settings pool", error)
    })?;
    match commit_classification_setting_mutations(&pool, mutations).await {
        Ok(()) => Ok(build_commit_outcome(mutations)),
        Err(error) if error.retryable() => {
            let reopened_pool = reopen_sqlite_pool(app).await.map_err(|error| {
                SqliteOperationError::operation_failed("reopen classification settings pool", error)
            })?;
            commit_classification_setting_mutations(&reopened_pool, mutations).await?;
            Ok(build_commit_outcome(mutations))
        }
        Err(error) => Err(error),
    }
}

pub async fn apply_recording_policy_changes<R: Runtime>(
    app: &AppHandle<R>,
    outcome: &ClassificationCommitOutcome,
    changed_at_ms: i64,
) -> Result<RecordingPolicyApplyOutcome, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    apply_recording_policy_changes_in_pool(&pool, outcome, changed_at_ms).await
}

async fn apply_recording_policy_changes_in_pool(
    pool: &sqlx::Pool<sqlx::Sqlite>,
    outcome: &ClassificationCommitOutcome,
    changed_at_ms: i64,
) -> Result<RecordingPolicyApplyOutcome, String> {
    let mut result = RecordingPolicyApplyOutcome::default();
    for change in &outcome.app_recording_changes {
        if !change.enabled {
            result.app_sealed |= crate::data::repositories::sessions::end_active_session_for_exe(
                pool,
                &change.exe_name,
                changed_at_ms,
            )
            .await
            .map_err(|error| format!("failed to seal excluded app session: {error}"))?;
        }
    }
    for change in &outcome.web_domain_recording_changes {
        if !change.enabled {
            result.web_sealed |=
                crate::data::repositories::web_activity::end_active_segment_for_domain(
                    pool,
                    &change.normalized_domain,
                    changed_at_ms,
                )
                .await
                .map_err(|error| format!("failed to seal excluded web domain: {error}"))?;
        }
    }
    for change in &outcome.app_title_changes {
        if !change.enabled {
            result.app_sealed |= crate::data::repositories::sessions::disable_active_title_for_exe(
                pool,
                &change.identity,
                changed_at_ms,
            )
            .await
            .map_err(|error| format!("failed to seal blocked app title: {error}"))?;
        }
    }
    for change in &outcome.web_domain_title_changes {
        if !change.enabled {
            result.web_sealed |=
                crate::data::repositories::web_activity::end_active_segment_for_domain(
                    pool,
                    &change.identity,
                    changed_at_ms,
                )
                .await
                .map_err(|error| format!("failed to seal blocked web title: {error}"))?;
        }
    }
    Ok(result)
}

fn build_commit_outcome(
    mutations: &[ClassificationSettingMutation],
) -> ClassificationCommitOutcome {
    use crate::data::repositories::classification_settings::{
        APP_OVERRIDE_KEY_PREFIX, WEB_DOMAIN_OVERRIDE_KEY_PREFIX,
    };

    let mut apps = HashMap::<String, bool>::new();
    let mut domains = HashMap::<String, bool>::new();
    let mut app_titles = HashMap::<String, bool>::new();
    let mut domain_titles = HashMap::<String, bool>::new();
    for mutation in mutations {
        if let Some(raw_exe_name) = mutation.key.strip_prefix(APP_OVERRIDE_KEY_PREFIX) {
            let exe_name = normalize_exe_name(raw_exe_name);
            if !exe_name.is_empty() {
                apps.insert(
                    exe_name.clone(),
                    parse_enabled_field(mutation.value.as_deref(), "track"),
                );
                app_titles.insert(
                    exe_name,
                    parse_enabled_field(mutation.value.as_deref(), "captureTitle"),
                );
            }
        } else if let Some(raw_domain) = mutation.key.strip_prefix(WEB_DOMAIN_OVERRIDE_KEY_PREFIX) {
            if let Some(domain) = crate::domain::web_activity::normalize_domain(raw_domain) {
                domains.insert(
                    domain.clone(),
                    parse_enabled_field(mutation.value.as_deref(), "enabled"),
                );
                domain_titles.insert(
                    domain,
                    parse_enabled_field(mutation.value.as_deref(), "captureTitle"),
                );
            }
        }
    }

    let mut app_recording_changes = apps
        .into_iter()
        .map(|(exe_name, enabled)| AppRecordingPolicyChange { exe_name, enabled })
        .collect::<Vec<_>>();
    app_recording_changes.sort_by(|left, right| left.exe_name.cmp(&right.exe_name));
    let mut web_domain_recording_changes = domains
        .into_iter()
        .map(
            |(normalized_domain, enabled)| WebDomainRecordingPolicyChange {
                normalized_domain,
                enabled,
            },
        )
        .collect::<Vec<_>>();
    web_domain_recording_changes
        .sort_by(|left, right| left.normalized_domain.cmp(&right.normalized_domain));
    let mut app_title_changes = app_titles
        .into_iter()
        .map(|(identity, enabled)| TitleRecordingPolicyChange { identity, enabled })
        .collect::<Vec<_>>();
    app_title_changes.sort_by(|left, right| left.identity.cmp(&right.identity));
    let mut web_domain_title_changes = domain_titles
        .into_iter()
        .map(|(identity, enabled)| TitleRecordingPolicyChange { identity, enabled })
        .collect::<Vec<_>>();
    web_domain_title_changes.sort_by(|left, right| left.identity.cmp(&right.identity));

    ClassificationCommitOutcome {
        app_recording_changes,
        web_domain_recording_changes,
        app_title_changes,
        web_domain_title_changes,
    }
}

fn normalize_exe_name(value: &str) -> String {
    let mut normalized = value.trim().trim_matches('"').to_ascii_lowercase();
    if !normalized.is_empty() && !normalized.ends_with(".exe") {
        normalized.push_str(".exe");
    }
    normalized
}

fn parse_enabled_field(raw_value: Option<&str>, field: &str) -> bool {
    raw_value
        .and_then(|value| serde_json::from_str::<serde_json::Value>(value).ok())
        .and_then(|value| value.get(field).and_then(serde_json::Value::as_bool))
        .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::repositories::{sessions, web_activity};
    use crate::data::schema as db_schema;
    use sqlx::{Executor, SqlitePool};

    #[test]
    fn commit_outcome_uses_final_app_and_domain_values() {
        let outcome = build_commit_outcome(&[
            ClassificationSettingMutation {
                key: "__app_override::QQ.exe".into(),
                value: Some(r#"{"track":false}"#.into()),
            },
            ClassificationSettingMutation {
                key: "__app_override::qq.exe".into(),
                value: Some(r#"{"track":true}"#.into()),
            },
            ClassificationSettingMutation {
                key: "__web_domain_override::GitHub.COM.".into(),
                value: Some(r#"{"enabled":false}"#.into()),
            },
        ]);

        assert_eq!(
            outcome.app_recording_changes,
            vec![AppRecordingPolicyChange {
                exe_name: "qq.exe".into(),
                enabled: true
            }]
        );
        assert_eq!(
            outcome.web_domain_recording_changes,
            vec![WebDomainRecordingPolicyChange {
                normalized_domain: "github.com".into(),
                enabled: false,
            }]
        );
        assert_eq!(outcome.app_title_changes[0].enabled, true);
        assert_eq!(outcome.web_domain_title_changes[0].enabled, true);
    }

    #[test]
    fn title_policy_apply_closes_titles_without_closing_app_session() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            pool.execute(db_schema::WEB_ACTIVITY_SCHEMA_SQL)
                .await
                .unwrap();
            sessions::start_session(&pool, "QQ", "QQ.exe", "Chat", 1_000, 1_000)
                .await
                .unwrap();
            web_activity::upsert_active_segment(
                &pool,
                &crate::domain::web_activity::WebActivitySegmentInput {
                    browser_client_id: "client".into(),
                    browser_kind: "chrome".into(),
                    browser_exe_name: "chrome.exe".into(),
                    domain: "github.com".into(),
                    normalized_domain: "github.com".into(),
                    url: None,
                    title: Some("Issue".into()),
                    favicon_url: None,
                },
                1_000,
            )
            .await
            .unwrap();

            let outcome = ClassificationCommitOutcome {
                app_title_changes: vec![TitleRecordingPolicyChange {
                    identity: "qq.exe".into(),
                    enabled: false,
                }],
                web_domain_title_changes: vec![TitleRecordingPolicyChange {
                    identity: "github.com".into(),
                    enabled: false,
                }],
                ..ClassificationCommitOutcome::default()
            };
            let applied = apply_recording_policy_changes_in_pool(&pool, &outcome, 2_000)
                .await
                .unwrap();
            assert!(applied.app_sealed);
            assert!(applied.web_sealed);
            let row: (String, Option<i64>) =
                sqlx::query_as("SELECT window_title, end_time FROM sessions LIMIT 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(row, (String::new(), None));
            let web_end: Option<i64> =
                sqlx::query_scalar("SELECT end_time FROM web_activity_segments LIMIT 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(web_end, Some(2_000));
        });
    }

    #[test]
    fn policy_apply_seals_matching_app_and_web_activity_together() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            pool.execute(db_schema::WEB_ACTIVITY_SCHEMA_SQL)
                .await
                .unwrap();
            pool.execute(db_schema::WEB_FAVICON_CACHE_SCHEMA_SQL)
                .await
                .unwrap();
            sessions::start_session(&pool, "QQ", "QQ.exe", "Chat", 1_000, 1_000)
                .await
                .unwrap();
            web_activity::upsert_active_segment(
                &pool,
                &crate::domain::web_activity::WebActivitySegmentInput {
                    browser_client_id: "client".into(),
                    browser_kind: "chrome".into(),
                    browser_exe_name: "chrome.exe".into(),
                    domain: "github.com".into(),
                    normalized_domain: "github.com".into(),
                    url: None,
                    title: Some("Issue".into()),
                    favicon_url: None,
                },
                1_000,
            )
            .await
            .unwrap();

            let applied = apply_recording_policy_changes_in_pool(
                &pool,
                &ClassificationCommitOutcome {
                    app_recording_changes: vec![AppRecordingPolicyChange {
                        exe_name: "qq.exe".into(),
                        enabled: false,
                    }],
                    web_domain_recording_changes: vec![WebDomainRecordingPolicyChange {
                        normalized_domain: "github.com".into(),
                        enabled: false,
                    }],
                    ..ClassificationCommitOutcome::default()
                },
                3_000,
            )
            .await
            .unwrap();

            assert_eq!(
                applied,
                RecordingPolicyApplyOutcome {
                    app_sealed: true,
                    web_sealed: true,
                }
            );
            let active_sessions: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            let active_web: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM web_activity_segments WHERE end_time IS NULL",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(active_sessions, 0);
            assert_eq!(active_web, 0);
        });
    }

    #[test]
    fn policy_apply_immediately_seals_active_canonical_alias() {
        tauri::async_runtime::block_on(async {
            let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
            pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
                .await
                .unwrap();
            sessions::start_session(
                &pool,
                "Alma",
                "alma-0.0.750-win-x64.exe",
                "Alma",
                1_000,
                1_000,
            )
            .await
            .unwrap();

            let title_applied = apply_recording_policy_changes_in_pool(
                &pool,
                &ClassificationCommitOutcome {
                    app_title_changes: vec![TitleRecordingPolicyChange {
                        identity: "alma.exe".into(),
                        enabled: false,
                    }],
                    ..ClassificationCommitOutcome::default()
                },
                1_500,
            )
            .await
            .unwrap();

            assert!(title_applied.app_sealed);
            let title_row: (String, Option<i64>) =
                sqlx::query_as("SELECT window_title, end_time FROM sessions LIMIT 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title_row, (String::new(), None));
            let title_sample_end: Option<i64> =
                sqlx::query_scalar("SELECT end_time FROM session_title_samples LIMIT 1")
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(title_sample_end, Some(1_500));

            let tracking_applied = apply_recording_policy_changes_in_pool(
                &pool,
                &ClassificationCommitOutcome {
                    app_recording_changes: vec![AppRecordingPolicyChange {
                        exe_name: "alma.exe".into(),
                        enabled: false,
                    }],
                    ..ClassificationCommitOutcome::default()
                },
                2_000,
            )
            .await
            .unwrap();

            assert!(tracking_applied.app_sealed);
            let end_time: Option<i64> = sqlx::query_scalar("SELECT end_time FROM sessions LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(end_time, Some(2_000));
        });
    }
}
