use crate::commands::{error::CommandErrorDto, window_guard::require_main_window};
use crate::data::repositories::{icon_cache, sessions, settings, web_activity};
use crate::data::{sqlite_error::SqliteOperationError, sqlite_pool::wait_for_sqlite_pool};
use tauri::{AppHandle, Runtime, WebviewWindow};

#[tauri::command]
pub async fn cmd_get_setting_rows<R: Runtime>(
    key: Option<String>,
    key_prefix: Option<String>,
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Vec<settings::SettingRow>, CommandErrorDto> {
    require_main_window(&window)?;
    let pool = wait_for_sqlite_pool(&app)
        .await
        .map_err(|error| CommandErrorDto::new("SQLITE_UNAVAILABLE", error, true))?;
    settings::load_rows(&pool, key.as_deref(), key_prefix.as_deref())
        .await
        .map_err(|error| SqliteOperationError::from_sqlx("reading local data", error).into())
}

#[tauri::command]
pub async fn cmd_get_history_range_rows<R: Runtime>(
    start_ms: i64,
    end_ms: i64,
    now_ms: i64,
    include_title_samples: bool,
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<sessions::read::HistoryRangeRows, CommandErrorDto> {
    require_main_window(&window)?;
    let pool = wait_for_sqlite_pool(&app)
        .await
        .map_err(|error| CommandErrorDto::new("SQLITE_UNAVAILABLE", error, true))?;
    sessions::read::load_history_range(&pool, start_ms, end_ms, now_ms, include_title_samples)
        .await
        .map_err(|error| SqliteOperationError::from_sqlx("reading local data", error).into())
}

#[tauri::command]
pub async fn cmd_get_executable_icon_rows<R: Runtime>(
    exe_names: Vec<String>,
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Vec<icon_cache::ExecutableIconRow>, CommandErrorDto> {
    require_main_window(&window)?;
    let pool = wait_for_sqlite_pool(&app)
        .await
        .map_err(|error| CommandErrorDto::new("SQLITE_UNAVAILABLE", error, true))?;
    icon_cache::load_executable_icons(&pool, &exe_names)
        .await
        .map_err(|error| SqliteOperationError::from_sqlx("reading local data", error).into())
}

#[tauri::command]
pub async fn cmd_get_earliest_activity_start_time<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Option<i64>, CommandErrorDto> {
    require_main_window(&window)?;
    let pool = wait_for_sqlite_pool(&app)
        .await
        .map_err(|error| CommandErrorDto::new("SQLITE_UNAVAILABLE", error, true))?;
    sessions::read::earliest_activity_start(&pool)
        .await
        .map_err(|error| SqliteOperationError::from_sqlx("reading local data", error).into())
}

#[tauri::command]
pub async fn cmd_get_recorded_executable_names<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Vec<String>, CommandErrorDto> {
    require_main_window(&window)?;
    let pool = wait_for_sqlite_pool(&app)
        .await
        .map_err(|error| CommandErrorDto::new("SQLITE_UNAVAILABLE", error, true))?;
    sessions::read::recorded_executable_names(&pool)
        .await
        .map_err(|error| SqliteOperationError::from_sqlx("reading local data", error).into())
}

#[tauri::command]
pub async fn cmd_get_web_activity_segment_rows<R: Runtime>(
    start_ms: i64,
    end_ms: i64,
    now_ms: i64,
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Vec<web_activity::read::WebSegmentRow>, CommandErrorDto> {
    require_main_window(&window)?;
    let pool = wait_for_sqlite_pool(&app)
        .await
        .map_err(|error| CommandErrorDto::new("SQLITE_UNAVAILABLE", error, true))?;
    web_activity::read::segments_in_range(&pool, start_ms, end_ms, now_ms)
        .await
        .map_err(|error| SqliteOperationError::from_sqlx("reading local data", error).into())
}

#[tauri::command]
pub async fn cmd_get_observed_web_domain_rows<R: Runtime>(
    since_ms: i64,
    now_ms: i64,
    limit: i64,
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Vec<web_activity::read::ObservedDomainRow>, CommandErrorDto> {
    require_main_window(&window)?;
    let pool = wait_for_sqlite_pool(&app)
        .await
        .map_err(|error| CommandErrorDto::new("SQLITE_UNAVAILABLE", error, true))?;
    web_activity::read::observed_domains(&pool, since_ms, now_ms, limit)
        .await
        .map_err(|error| SqliteOperationError::from_sqlx("reading local data", error).into())
}

#[tauri::command]
pub async fn cmd_get_web_favicon_rows<R: Runtime>(
    domains: Vec<String>,
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Vec<web_activity::read::FaviconRow>, CommandErrorDto> {
    require_main_window(&window)?;
    let pool = wait_for_sqlite_pool(&app)
        .await
        .map_err(|error| CommandErrorDto::new("SQLITE_UNAVAILABLE", error, true))?;
    web_activity::read::favicons(&pool, &domains)
        .await
        .map_err(|error| SqliteOperationError::from_sqlx("reading local data", error).into())
}
