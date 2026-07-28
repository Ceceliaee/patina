use crate::commands::error::CommandErrorDto;
use crate::data::web_activity_analysis::{self, WebActivityAggregateRangeDto};
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn cmd_get_web_activity_aggregate_range<R: Runtime>(
    start_ms: i64,
    end_ms: i64,
    bucket_boundaries_ms: Vec<i64>,
    normalized_domain: Option<String>,
    normalized_domains: Option<Vec<String>>,
    snapshot_now_ms: Option<i64>,
    app: AppHandle<R>,
) -> Result<WebActivityAggregateRangeDto, CommandErrorDto> {
    web_activity_analysis::load_web_activity_aggregate_range(
        &app,
        start_ms,
        end_ms,
        bucket_boundaries_ms,
        normalized_domain,
        normalized_domains,
        snapshot_now_ms,
    )
    .await
    .map_err(|error| {
        CommandErrorDto::new(
            "WEB_ACTIVITY_ANALYSIS_FAILED",
            format!("failed to read web activity aggregate: {error}"),
            true,
        )
    })
}
