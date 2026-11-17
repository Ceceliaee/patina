use super::*;
use patina_recorder::format_text;

fn n(value: &Value, key: &str) -> String {
    value[key].as_u64().unwrap_or(0).to_string()
}
fn stamp(value: &Value) -> String {
    crate::page_controls::stamp(value.as_i64().unwrap_or(0), "%Y-%m-%d %H:%M")
}
pub(super) fn bytes(value: u64) -> String {
    if value < 1024 {
        format!("{value} B")
    } else if value < 1048576 {
        format!("{:.1} KiB", value as f64 / 1024.)
    } else {
        format!("{:.1} MiB", value as f64 / 1048576.)
    }
}
impl StorageCard {
    pub(super) fn prepare_move(
        &mut self,
        path: Option<std::path::PathBuf>,
        w: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.busy = true;
        let future = self
            .client
            .request::<Value>(Query::Storage(Request::PreviewMove(path.clone())));
        cx.spawn_in(w, async move |view, cx| {
            let result = future.await;
            let _ = view.update_in(cx, |s, w, cx| {
                s.busy = false;
                match result {
                    Ok(value) => s.confirm(
                        Request::Move(path),
                        View::Home,
                        "settings.storage.storageDataMigrationConfirmTitle",
                        s.formatted(
                            "settings.storage.storageDataMigrationConfirmDetail",
                            &[
                                (
                                    "currentDataRoot",
                                    value["from"].as_str().unwrap_or_default().into(),
                                ),
                                (
                                    "targetDataRoot",
                                    value["to"].as_str().unwrap_or_default().into(),
                                ),
                            ],
                        ),
                        w,
                        cx,
                    ),
                    Err(_) => s.message = s.tr("settings.storage.storageMigrationFailed"),
                }
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }
    pub(super) fn formatted(&self, key: &str, args: &[(&str, String)]) -> String {
        format_text(self.client.locale.get(), key, args)
    }
    pub(super) fn remember_parent(&mut self, _win: &Window, cx: &App) {
        self.parents.push(ParentView {
            view: self.view,
            result: self.result.clone(),
            values: std::array::from_fn(|i| {
                if i == 3 {
                    String::new()
                } else {
                    self.val(i, cx)
                }
            }),
        });
    }
    pub(super) fn confirmation_dialog(&self, win: &mut Window, cx: &mut Context<Self>) -> Dialog {
        let c = self.client.palette(win);
        let confirm = self.confirmation.as_ref().unwrap();
        let title = confirm.title.clone();
        let key = if matches!(confirm.request, Request::Move(_)) {
            "settings.storage.restartAndApplyAction"
        } else {
            "dialog.confirmDanger"
        };
        let content = quietpro::dialog_surface(c, win.viewport_size())
            .w(px(600.))
            .track_focus(&self.dialog_content_focus)
            .on_key_down(cx.listener(|s, event: &KeyDownEvent, w, cx| {
                if event.keystroke.key == "escape" {
                    s.close(w, cx);
                    cx.stop_propagation();
                }
            }))
            .child(heading(title.clone()))
            .child(
                div()
                    .id("storage-confirm-detail")
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(label(confirm.detail.clone())),
            )
            .child(
                quietpro::dialog_actions()
                    .child(
                        text_button("cancel-storage-confirm", self.tr("common.cancel"), c, true)
                            .on_click(cx.listener(|s, _, w, cx| s.close(w, cx))),
                    )
                    .child(
                        text_button("accept-storage-confirm", self.tr(key), c, true).on_click(
                            cx.listener(|s, _, w, cx| {
                                if let Some(confirm) = s.confirmation.take() {
                                    s.fetch(confirm.request, confirm.next, w, cx);
                                }
                            }),
                        ),
                    ),
            );
        let weak = cx.weak_entity();
        Dialog::new(cx)
            .focus_handle(self.dialog_focus.clone())
            .accessibility_label(title)
            .close_on_escape(false)
            .backdrop(quietpro::dialog_backdrop())
            .popup(DialogPopup::new().child(content))
            .on_open_change(move |open, _, w, cx| {
                if !open {
                    let _ = weak.update(cx, |s, cx| s.close(w, cx));
                }
            })
    }
    pub(super) fn preview_details(&self, c: quietpro::Palette) -> Div {
        let p = &self.result;
        let available = p["validRecords"]
            .as_u64()
            .unwrap_or(0)
            .saturating_sub(p["duplicateRecords"].as_u64().unwrap_or(0));
        let candidates = p["categoryCandidates"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[]);
        let categorized = candidates
            .iter()
            .filter(|v| v["categories"].as_array().is_some_and(|v| v.len() == 1))
            .count();
        let conflicts = candidates
            .iter()
            .filter(|v| v["categories"].as_array().is_some_and(|v| v.len() > 1))
            .count();
        let mut body = div().flex().flex_col().gap(px(8.));
        for (key, count) in [
            ("settings.dataImport.availableLabel", available),
            (
                "settings.dataImport.categorizedAppsLabel",
                categorized as u64,
            ),
            ("settings.dataImport.conflictedAppsLabel", conflicts as u64),
        ] {
            body = body.child(label(format!("{} · {count}", self.tr(key))));
        }
        if conflicts > 0 {
            body = body.child(
                label(self.tr("settings.dataImport.categoryConflictNote")).text_color(c.secondary),
            );
        }
        for error in p["errors"].as_array().into_iter().flatten() {
            body = body.child(
                label(self.formatted(
                    "settings.dataImport.lineError",
                    &[
                        ("line", n(error, "line")),
                        (
                            "message",
                            error["message"].as_str().unwrap_or_default().into(),
                        ),
                    ],
                ))
                .text_color(c.danger),
            );
        }
        body
    }
    pub(super) fn backup_summary(&self, p: &Value, remote: bool) -> String {
        let key = |snake, camel| if remote { camel } else { snake };
        let counts = self.formatted(
            "backup.itemCounts",
            &[
                ("sessionCount", n(p, key("session_count", "sessionCount"))),
                ("settingCount", n(p, key("setting_count", "settingCount"))),
                (
                    "iconCacheCount",
                    n(p, key("icon_cache_count", "iconCacheCount")),
                ),
            ],
        );
        let imports = self.formatted(
            "backup.importItemCounts",
            &[
                (
                    "batchCount",
                    n(p, key("import_batch_count", "importBatchCount")),
                ),
                (
                    "exactCount",
                    n(
                        p,
                        key("import_exact_session_count", "importExactSessionCount"),
                    ),
                ),
                (
                    "bucketCount",
                    n(p, key("import_time_bucket_count", "importTimeBucketCount")),
                ),
            ],
        );
        if remote {
            return format!(
                "{} · {}\n{counts}\n{imports}",
                stamp(&p["createdAtMs"]),
                bytes(p["sizeBytes"].as_u64().unwrap_or(0))
            );
        }
        let safety_key = p["restore_message_key"].as_str().unwrap_or_default();
        let safety = if safety_key.is_empty() {
            p["restore_message"].as_str().unwrap_or_default().into()
        } else {
            self.tr(safety_key)
        };
        format!(
            "{}\n{}\n{}\n{}\n{counts}\n{imports}",
            self.tr("backup.formatLabel"),
            self.formatted(
                "backup.appVersion",
                &[(
                    "version",
                    p["app_version"].as_str().unwrap_or_default().into()
                )]
            ),
            self.formatted(
                "backup.exportedAt",
                &[("value", stamp(&p["exported_at_ms"]))]
            ),
            self.formatted("backup.restoreSafety", &[("message", safety)])
        )
    }
    pub(super) fn task_error(&self, code: &str, backup: bool) -> String {
        let key = match code {
            "missing_config" => "toast.webDavMissingConfig",
            "authentication_failed" => "toast.webDavTestFailed",
            "target_conflict" => "export.scheduledErrors.targetConflict",
            "target_missing" => "export.scheduledErrors.targetMissing",
            "permission_denied" => "export.scheduledErrors.permissionDenied",
            "disk_full" => "export.scheduledErrors.diskFull",
            "database_unavailable" => "export.scheduledErrors.databaseUnavailable",
            "format_validation_failed" => "export.scheduledErrors.validation",
            "publish_failed" => "export.scheduledErrors.publishFailed",
            "interrupted" => "export.scheduledErrors.interrupted",
            _ if backup => "toast.backupExportFailed",
            _ => "export.scheduledErrors.generic",
        };
        self.tr(key)
    }
    pub(super) fn poll_schedule(&mut self, backup: bool, cx: &mut Context<Self>) {
        let client = self.client.clone();
        self.schedule_poll = Some(cx.spawn(async move |view, cx| {
            loop {
                cx.background_executor()
                    .timer(std::time::Duration::from_secs(2))
                    .await;
                if !view
                    .read_with(cx, |s, _| s.view == View::Schedule(backup))
                    .unwrap_or(false)
                {
                    break;
                }
                let result = client
                    .request::<Value>(Query::Storage(Request::Schedule { backup }))
                    .await;
                if view
                    .update(cx, |s, cx| {
                        if s.view != View::Schedule(backup) {
                            return;
                        }
                        match result {
                            Ok(value) => s.result = value,
                            Err(_) => s.message = s.tr("settings.loadFailed"),
                        }
                        cx.notify();
                    })
                    .is_err()
                {
                    break;
                }
            }
        }));
    }
    pub(super) fn schedule_status(&self, backup: bool, c: quietpro::Palette) -> Div {
        let p = &self.result;
        let mut body = div().flex().flex_col().gap(px(8.));
        for (key, value) in [
            (
                "settings.scheduledBackupLabels.nextExecution",
                &p["nextExecutionAtMs"],
            ),
            (
                "settings.scheduledBackupLabels.recentSuccess",
                &p["recentSuccess"]["completedAtMs"],
            ),
            (
                "settings.scheduledBackupLabels.recentFailure",
                &p["recentFailure"]["completedAtMs"],
            ),
        ] {
            if value.is_number() {
                body = body.child(label(format!("{} · {}", self.tr(key), stamp(value))));
            }
        }
        if let Some(size) = p["recentSuccess"]["sizeBytes"].as_u64() {
            body = body.child(label(bytes(size)));
        }
        if let Some(code) = p["recentFailure"]["errorCode"].as_str() {
            body = body.child(label(self.task_error(code, backup)).text_color(c.danger));
        }
        if p["recentSuccess"]["cleanupWarning"]
            .as_str()
            .is_some_and(|warning| !warning.is_empty())
        {
            body = body.child(
                label(self.tr("settings.scheduledBackupCleanupWarning")).text_color(c.secondary),
            );
        }
        if let Some(status) = p["activeRun"]["status"].as_str() {
            body = body.child(label(if status == "running" {
                self.tr(if backup {
                    "settings.backupExporting"
                } else {
                    "export.exporting"
                })
            } else {
                format!(
                    "{} · {}",
                    self.tr("settings.retry"),
                    stamp(&p["activeRun"]["retryAtMs"])
                )
            }));
            if let Some(code) = p["activeRun"]["errorCode"].as_str() {
                body = body.child(label(self.task_error(code, backup)));
            }
        }
        body
    }
    pub(super) fn schedule_time(&self, c: quietpro::Palette, cx: &Context<Self>) -> Div {
        let value = self.val(4, cx);
        let parts: Vec<u8> = value.split(':').filter_map(|v| v.parse().ok()).collect();
        let mut row = div().flex().gap(px(4.));
        for part in 0..2 {
            let selected = parts.get(part).copied().unwrap_or(0);
            let weak = cx.weak_entity();
            row = row.child(
                quietpro::Dropdown::new(
                    if part == 0 {
                        "schedule-hour"
                    } else {
                        "schedule-minute"
                    },
                    self.tr(if part == 0 {
                        "time.hours"
                    } else {
                        "time.minutes"
                    }),
                    (0u8..if part == 0 { 24 } else { 60 }).map(|v| (v, format!("{v:02}"))),
                    selected,
                    c,
                    move |value, w, cx| {
                        let _ = weak.update(cx, |s, cx| {
                            let old = s.val(4, cx);
                            let mut parts: Vec<u8> =
                                old.split(':').filter_map(|v| v.parse().ok()).collect();
                            parts.resize(2, 0);
                            parts[part] = value;
                            s.set(
                                4,
                                "settings.storageTime",
                                &format!("{:02}:{:02}", parts[0], parts[1]),
                                w,
                                cx,
                            );
                            cx.notify();
                        });
                    },
                )
                .disabled(self.busy || !self.enabled),
            );
            if part == 0 {
                row = row.child(label(":".into()));
            }
        }
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .child(label(self.tr("settings.storageTime")))
            .child(row)
    }
    pub(super) fn completed(&self, request: &Request, result: &Value) -> String {
        match request {
            Request::Export(r) => self.formatted(
                "native.export.completed",
                &[
                    ("count", result.as_u64().unwrap_or(0).to_string()),
                    ("path", r.output_path.clone()),
                ],
            ),
            Request::Import { .. } => self.formatted(
                "settings.dataImport.importSuccess",
                &[("count", n(result, "importedRecords"))],
            ),
            Request::DeleteBatch(_) => self.formatted(
                "settings.dataImport.deleteSuccess",
                &[(
                    "count",
                    (result["deletedExactSessions"].as_u64().unwrap_or(0)
                        + result["deletedHourBuckets"].as_u64().unwrap_or(0))
                    .to_string(),
                )],
            ),
            Request::Backup(path) => self.formatted(
                "toast.backupExportSuccess",
                &[("path", path.display().to_string())],
            ),
            Request::Convert(_) => self.formatted(
                "settings.dataImport.destructureSuccess",
                &[
                    ("count", n(result, "recordsWritten")),
                    (
                        "path",
                        result["outputPath"].as_str().unwrap_or_default().into(),
                    ),
                ],
            ),
            Request::Restore { .. } => self.tr("toast.backupRestoreSuccess"),
            Request::Cleanup(_) => self.tr("toast.cleanupSuccess"),
            Request::DavSave { .. } => self.tr("toast.webDavConfigSaved"),
            Request::DavClear => self.tr("toast.webDavConfigDeleted"),
            Request::DavTest { .. } => self.tr("toast.webDavTestSuccess"),
            Request::DavUpload { file, .. } => {
                self.formatted("toast.webDavUploadSuccess", &[("fileName", file.clone())])
            }
            _ => self.tr("common.saved"),
        }
    }
    pub(super) fn failed(&self, request: &Request, error: &str) -> String {
        let key = match error {
            "remote_name_conflict" => "settings.webDavNameConflict",
            "webdav_invalid_file_name" => "settings.webDavInvalidFileName",
            "webdav_config_changed" => "settings.webDavTargetChanged",
            _ => match request {
                Request::Export(_) => "export.exportFailed",
                Request::Backup(_) => "toast.backupExportFailed",
                Request::Restore { .. } => "toast.backupRestoreFailed",
                Request::PreviewRestore(_) => "toast.backupPreviewFailed",
                Request::Cleanup(_) => "toast.cleanupFailed",
                Request::Move(_) => "settings.storage.storageMigrationFailed",
                Request::DavSave { .. } => "toast.webDavConfigSaveFailed",
                Request::DavClear => "toast.webDavConfigDeleteFailed",
                Request::DavTest { .. } => "toast.webDavTestFailed",
                Request::DavList => "toast.webDavListFailed",
                Request::DavDownload(_) => "toast.webDavDownloadFailed",
                Request::DavUpload { .. } => "toast.webDavUploadFailed",
                _ => "settings.loadFailed",
            },
        };
        self.tr(key)
    }
}
