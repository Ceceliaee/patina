use crate::engine::screenshots::ports::SharedScreenshotDataStore;
use crate::platform::app_paths;
use crate::platform::windows::screen_capture;
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use image::RgbImage;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};
use tokio::time::{sleep, Duration};
use webp::{Encoder, WebPMemory};

const SCREENSHOTS_DIR: &str = "screenshots";
const THUMB_WIDTH: u32 = 320;
const MAX_CONSECUTIVE_FAILURES: u32 = 5;
const CAPTURE_RETRY_DELAY_MS: u64 = 500;

pub async fn run<R: Runtime>(
    app: AppHandle<R>,
    store: SharedScreenshotDataStore,
) -> Result<(), String> {
    let screenshots_dir = screenshots_dir(&app)?;
    std::fs::create_dir_all(&screenshots_dir).map_err(|e| format!("create dir: {e}"))?;

    // One-time backfill: associate historical screenshots with their active web URLs
    match store.backfill_missing_web_info().await {
        Ok((total, updated)) => {
            if total > 0 {
                eprintln!("[screenshots] backfilled web info for {updated}/{total} historical screenshots");
            } else {
                eprintln!("[screenshots] no historical screenshots need web info backfill");
            }
        }
        Err(e) => {
            eprintln!("[screenshots] backfill failed (non-fatal): {e}");
        }
    }

    let mut consecutive_failures: u32 = 0;

    loop {
        let settings = store.load_settings().await.map_err(|e| e.to_string())?;
        let tracking_paused = store.load_tracking_paused().await.unwrap_or(false);

        if settings.enabled && !tracking_paused {
            match try_capture_with_retry(&store, &screenshots_dir).await {
                Ok(()) => {
                    if consecutive_failures > 0 {
                        eprintln!(
                            "[screenshots] capture recovered after {consecutive_failures} failures"
                        );
                    }
                    consecutive_failures = 0;
                    cleanup_old(&store, &screenshots_dir, settings.retention_days).await;
                }
                Err(e) => {
                    consecutive_failures += 1;
                    if consecutive_failures == 1 {
                        eprintln!("[screenshots] capture failed: {e}");
                    } else if consecutive_failures.is_multiple_of(MAX_CONSECUTIVE_FAILURES) {
                        eprintln!(
                            "[screenshots] capture has failed {consecutive_failures} times consecutively: {e}"
                        );
                    }
                }
            }
        } else {
            consecutive_failures = 0;
        }
        sleep(Duration::from_secs(settings.interval_secs)).await;
    }
}

async fn try_capture_with_retry(
    store: &SharedScreenshotDataStore,
    screenshots_dir: &Path,
) -> Result<(), String> {
    match capture_and_save(store, screenshots_dir).await {
        Ok(()) => Ok(()),
        Err(first_error) => {
            sleep(Duration::from_millis(CAPTURE_RETRY_DELAY_MS)).await;
            match capture_and_save(store, screenshots_dir).await {
                Ok(()) => Ok(()),
                Err(_) => Err(first_error),
            }
        }
    }
}

async fn capture_and_save(
    store: &SharedScreenshotDataStore,
    screenshots_dir: &Path,
) -> Result<(), String> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    let session_id = store
        .find_active_session_id(now_ms)
        .await
        .map_err(|e| e.to_string())?;

    // Privacy: skip screenshot if the active app is excluded from tracking
    if let Some(sid) = session_id {
        if let Some(exe_name) = store
            .get_session_exe_name(sid)
            .await
            .map_err(|e| e.to_string())?
        {
            if store.is_app_excluded(&exe_name).await.unwrap_or(false) {
                return Ok(());
            }
        }
    }

    let (active_url, active_normalized_domain) = store
        .find_active_web_info_at(now_ms, session_id)
        .await
        .unwrap_or((None, None));

    // Privacy: strip URL/domain info if the domain is excluded, but still capture
    let (active_url, active_normalized_domain) = match &active_normalized_domain {
        Some(domain) if !domain.is_empty() => {
            if store.is_domain_excluded(domain).await.unwrap_or(false) {
                (None, None)
            } else {
                (active_url, active_normalized_domain)
            }
        }
        _ => (active_url, active_normalized_domain),
    };

    let capture = screen_capture::capture_virtual_screen()?;

    let file_name = format_datetime_for_filename(now_ms);
    let file_path = screenshots_dir.join(&file_name);
    let file_path_str = file_path.to_string_lossy().to_string();

    let img = RgbImage::from_raw(capture.width, capture.height, capture.rgb_bytes)
        .ok_or("failed to create RGB image")?;

    let thumb_base64 = {
        let encoder = Encoder::from_rgb(&img, capture.width, capture.height);
        let webp_image: WebPMemory = encoder.encode(85.0);
        let webp_bytes: Vec<u8> = webp_image.to_vec();
        std::fs::write(&file_path, &webp_bytes).map_err(|e| format!("write webp: {e}"))?;

        let thumb = image::imageops::resize(
            &img,
            THUMB_WIDTH,
            (THUMB_WIDTH * capture.height / capture.width).max(1),
            image::imageops::FilterType::Triangle,
        );
        let thumb_encoder = Encoder::from_rgb(&thumb, thumb.width(), thumb.height());
        let thumb_webp: WebPMemory = thumb_encoder.encode(50.0);
        BASE64.encode(&*thumb_webp)
    };

    store
        .insert_screenshot(
            &file_path_str,
            now_ms,
            capture.width,
            capture.height,
            &thumb_base64,
            session_id,
            active_url.as_deref(),
            active_normalized_domain.as_deref(),
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(())
}

async fn cleanup_old(store: &SharedScreenshotDataStore, _dir: &Path, retention_days: u64) {
    let cutoff = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64 - retention_days as i64 * 86_400_000)
        .unwrap_or(0);

    let rows = match store.list_stale_screenshots(cutoff).await {
        Ok(rows) => rows,
        Err(e) => {
            eprintln!("[screenshots] failed to list stale screenshots: {e}");
            return;
        }
    };

    for (id, path) in rows {
        if let Err(e) = std::fs::remove_file(&path) {
            eprintln!("[screenshots] failed to delete stale file {path}: {e}");
        }
        if let Err(e) = store.delete_screenshot(id).await {
            eprintln!("[screenshots] failed to delete stale screenshot record {id}: {e}");
        }
    }
}

fn screenshots_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app_paths::product_roaming_data_dir(app).map(|p| p.join(SCREENSHOTS_DIR))
}

fn format_datetime_for_filename(ms: i64) -> String {
    use chrono::{Local, TimeZone};
    let dt = Local
        .timestamp_millis_opt(ms)
        .single()
        .unwrap_or_else(Local::now);
    dt.format("%Y-%m-%d %H.%M.%S").to_string() + ".webp"
}
