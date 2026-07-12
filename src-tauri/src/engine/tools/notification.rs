use crate::domain::tools::ToolAlertKind;
use tauri::{AppHandle, Runtime};
use tauri_plugin_notification::NotificationExt;
#[cfg(windows)]
use crate::platform::windows::notifications::{Duration, Scenario, ToastButton, ToastOptions};

pub fn send<R: Runtime + 'static>(
    app: &AppHandle<R>,
    kind: ToolAlertKind,
    title: &str,
    body: &str,
    alert_id: &str,
    snooze_minutes: i64,
) -> Result<(), String> {
    #[cfg(windows)]
    if should_use_dev_windows_toast_identity() {
        let app_id = app.config().identifier.as_str();
        let handle = app.clone();
        let alert_id_owned = alert_id.to_string();
        let kind_clone = kind;

        let buttons = build_toast_buttons(kind, snooze_minutes);

        let options = ToastOptions {
            app_id: app_id.to_owned(),
            title: title.to_string(),
            body: body.to_string(),
            scenario: Scenario::Default,
            duration: Duration::Long,
            buttons,
            icon_path: None,
        };

        if crate::platform::windows::notifications::send(
            app,
            options,
            move |action| {
                handle_notification_action(&handle, kind_clone, &action, &alert_id_owned);
                Ok(())
            },
        )
        .is_ok()
        {
            return Ok(());
        }
    }

    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

#[cfg(windows)]
fn build_toast_buttons(kind: ToolAlertKind, snooze_minutes: i64) -> Vec<ToastButton> {
    let snooze_label = format!("{} 分钟后提醒", snooze_minutes.max(1));
    match kind {
        ToolAlertKind::Pomodoro => vec![
            ToastButton {
                label: snooze_label,
                action: "pomodoro_snooze".to_string(),
            },
            ToastButton {
                label: "跳过".to_string(),
                action: "skip".to_string(),
            },
            ToastButton {
                label: "暂停".to_string(),
                action: "pause".to_string(),
            },
            ToastButton {
                label: "知道了".to_string(),
                action: "dismiss".to_string(),
            },
        ],
        ToolAlertKind::Countdown => vec![
            ToastButton {
                label: format!("再计时{}分钟", snooze_minutes.max(1)),
                action: "countdown_add_5min".to_string(),
            },
            ToastButton {
                label: "重置".to_string(),
                action: "countdown_reset".to_string(),
            },
            ToastButton {
                label: "知道了".to_string(),
                action: "dismiss".to_string(),
            },
        ],
        ToolAlertKind::SoftwareReminder => vec![
            ToastButton {
                label: "今日不再提醒".to_string(),
                action: "snooze_today".to_string(),
            },
            ToastButton {
                label: "知道了".to_string(),
                action: "dismiss".to_string(),
            },
        ],
        ToolAlertKind::Reminder => vec![
            ToastButton {
                label: snooze_label,
                action: "snooze_10min".to_string(),
            },
            ToastButton {
                label: "知道了".to_string(),
                action: "dismiss".to_string(),
            },
        ],
    }
}

#[cfg(windows)]
fn handle_notification_action<R: Runtime + 'static>(
    app: &AppHandle<R>,
    kind: ToolAlertKind,
    action: &str,
    alert_id: &str,
) {
    match action {
        "pause" => {
            if matches!(kind, ToolAlertKind::Pomodoro) {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = crate::engine::tools::pause_pomodoro(&app_handle).await {
                        eprintln!("[notifications] pause pomodoro failed: {error}");
                    }
                });
            }
        }
        "skip" => {
            if matches!(kind, ToolAlertKind::Pomodoro) {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) =
                        crate::engine::tools::skip_and_start_pomodoro_phase(&app_handle).await
                    {
                        eprintln!("[notifications] skip pomodoro phase failed: {error}");
                    }
                });
            }
        }
        "countdown_reset" => {
            if matches!(kind, ToolAlertKind::Countdown) {
                let app_handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = crate::engine::tools::reset_timer(&app_handle).await {
                        eprintln!("[notifications] reset timer failed: {error}");
                    }
                });
            }
        }
        "countdown_add_5min" => {
            if matches!(kind, ToolAlertKind::Countdown) {
                let app_handle = app.clone();
                let alert_id_owned = alert_id.to_string();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = add_countdown_five_minutes(&app_handle, &alert_id_owned).await {
                        eprintln!("[notifications] add 5 minutes to countdown failed: {error}");
                    }
                });
            }
        }
        "snooze_10min" => {
            if matches!(kind, ToolAlertKind::Reminder) {
                let app_handle = app.clone();
                let alert_id_owned = alert_id.to_string();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = snooze_reminder_ten_minutes(&app_handle, &alert_id_owned).await {
                        eprintln!("[notifications] snooze reminder 10 minutes failed: {error}");
                    }
                });
            }
        }
        "pomodoro_snooze" => {
            if matches!(kind, ToolAlertKind::Pomodoro) {
                let app_handle = app.clone();
                let alert_id_owned = alert_id.to_string();
                tauri::async_runtime::spawn(async move {
                    if let Err(error) = snooze_pomodoro(&app_handle, &alert_id_owned).await {
                        eprintln!("[notifications] snooze pomodoro failed: {error}");
                    }
                });
            }
        }
        "snooze_today" => {
            if matches!(kind, ToolAlertKind::SoftwareReminder) {
                crate::engine::tools::dismiss_alert(app, alert_id);
            }
        }
        "dismiss" => {
            crate::engine::tools::dismiss_alert(app, alert_id);
        }
        _ => {
            eprintln!("[notifications] unknown action: {action}");
        }
    }
}

#[cfg(windows)]
async fn add_countdown_five_minutes<R: Runtime + 'static>(
    app: &AppHandle<R>,
    alert_id: &str,
) -> Result<(), String> {
    use crate::data::sqlite_pool::wait_for_sqlite_pool;
    use crate::domain::tools::TimerStatus;
    use sqlx::Row;

    let pool = wait_for_sqlite_pool(app).await?;
    let now = crate::app::runtime::now_ms() as i64;

    let settings = crate::data::repositories::tools::load_tool_runtime_settings(&pool)
        .await
        .map_err(|error| format!("load tool settings failed: {error}"))?;
    let snooze_minutes = settings.countdown_snooze_minutes.max(1);
    let snooze_ms = snooze_minutes * 60 * 1000;

    let result = sqlx::query(
        "SELECT id, duration_ms, label FROM tool_timers
         WHERE mode = 'countdown' AND status = ?
         ORDER BY id DESC LIMIT 1",
    )
    .bind(TimerStatus::Completed.as_str())
    .fetch_optional(&pool)
    .await
    .map_err(|error| format!("fetch completed countdown failed: {error}"))?;

    if let Some(row) = result {
        let timer_id: i64 = row.get("id");
        let duration_ms: Option<i64> = row.get("duration_ms");
        let base_duration = duration_ms.unwrap_or(snooze_ms);
        let new_duration = base_duration.max(snooze_ms);

        sqlx::query(
            "UPDATE tool_timers
             SET status = ?, started_at = ?, completed_at = NULL, accumulated_ms = 0, duration_ms = ?, updated_at = ?
             WHERE id = ?",
        )
        .bind(TimerStatus::Running.as_str())
        .bind(now)
        .bind(new_duration)
        .bind(now)
        .bind(timer_id)
        .execute(&pool)
        .await
        .map_err(|error| format!("restart countdown failed: {error}"))?;
    } else {
        crate::engine::tools::start_timer(
            app,
            crate::engine::tools::StartTimerRequest {
                mode: crate::domain::tools::TimerMode::Countdown,
                duration_ms: Some(snooze_ms),
                label: None,
            },
        )
        .await?;
    }

    crate::engine::tools::dismiss_alert(app, alert_id);
    crate::engine::tools::refresh_snapshot_after_tool_change(app).await?;
    Ok(())
}

#[cfg(windows)]
async fn snooze_reminder_ten_minutes<R: Runtime + 'static>(
    app: &AppHandle<R>,
    alert_id: &str,
) -> Result<(), String> {
    use crate::data::sqlite_pool::wait_for_sqlite_pool;
    use crate::domain::tools::ReminderStatus;
    use sqlx::Row;

    let reminder_id_str = alert_id.strip_prefix("reminder:").unwrap_or("");
    let reminder_id: i64 = reminder_id_str.parse().map_err(|_| "invalid reminder id")?;

    let pool = wait_for_sqlite_pool(app).await?;
    let now = crate::app::runtime::now_ms() as i64;

    let settings = crate::data::repositories::tools::load_tool_runtime_settings(&pool)
        .await
        .map_err(|error| format!("load tool settings failed: {error}"))?;
    let snooze_minutes = settings.reminder_snooze_minutes.max(1);
    let snooze_until = now + snooze_minutes * 60 * 1000;

    let row = sqlx::query(
        "SELECT label FROM tool_reminders WHERE id = ?",
    )
    .bind(reminder_id)
    .fetch_optional(&pool)
    .await
    .map_err(|error| format!("fetch reminder failed: {error}"))?;

    let label: String = if let Some(row) = row {
        row.get("label")
    } else {
        "时间到了".to_string()
    };

    sqlx::query(
        "INSERT INTO tool_reminders (label, scheduled_at, created_at, status)
         VALUES (?, ?, ?, ?)",
    )
    .bind(&label)
    .bind(snooze_until)
    .bind(now)
    .bind(ReminderStatus::Scheduled.as_str())
    .execute(&pool)
    .await
    .map_err(|error| format!("create snooze reminder failed: {error}"))?;

    crate::engine::tools::dismiss_alert(app, alert_id);
    crate::engine::tools::refresh_snapshot_after_tool_change(app).await?;
    Ok(())
}

#[cfg(windows)]
async fn snooze_pomodoro<R: Runtime + 'static>(
    app: &AppHandle<R>,
    alert_id: &str,
) -> Result<(), String> {
    use crate::data::sqlite_pool::wait_for_sqlite_pool;
    use crate::domain::tools::ReminderStatus;

    let pool = wait_for_sqlite_pool(app).await?;
    let now = crate::app::runtime::now_ms() as i64;

    let settings = crate::data::repositories::tools::load_tool_runtime_settings(&pool)
        .await
        .map_err(|error| format!("load tool settings failed: {error}"))?;
    let snooze_minutes = settings.pomodoro_snooze_minutes.max(1);
    let snooze_until = now + snooze_minutes * 60 * 1000;

    let parts: Vec<&str> = alert_id.split(':').collect();
    let label = if parts.len() >= 4 {
        let phase = parts[3];
        match phase {
            "focus" => "专注结束",
            "short_break" => "休息结束",
            "long_break" => "休息结束",
            _ => "番茄钟",
        }
    } else {
        "番茄钟"
    }.to_string();

    sqlx::query(
        "INSERT INTO tool_reminders (label, scheduled_at, created_at, status)
         VALUES (?, ?, ?, ?)",
    )
    .bind(&label)
    .bind(snooze_until)
    .bind(now)
    .bind(ReminderStatus::Scheduled.as_str())
    .execute(&pool)
    .await
    .map_err(|error| format!("create pomodoro snooze reminder failed: {error}"))?;

    crate::engine::tools::dismiss_alert(app, alert_id);
    crate::engine::tools::refresh_snapshot_after_tool_change(app).await?;
    Ok(())
}

#[cfg(windows)]
fn should_use_dev_windows_toast_identity() -> bool {
    let Ok(exe_path) = std::env::current_exe() else {
        return false;
    };
    let Some(exe_dir) = exe_path.parent() else {
        return false;
    };
    let Some(profile_dir_name) = exe_dir.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    if profile_dir_name != "debug" && profile_dir_name != "release" {
        return false;
    }
    exe_dir
        .parent()
        .and_then(|parent| parent.file_name())
        .and_then(|name| name.to_str())
        .map(|name| name == "target")
        .unwrap_or(false)
}
