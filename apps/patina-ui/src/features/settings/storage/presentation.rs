use super::*;
use patina_i18n::format_text;

fn stamp(value: i64) -> String {
    crate::features::page_controls::stamp(value, "%Y-%m-%d %H:%M")
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
        let future = self.client.storage(Request::PreviewMove(path.clone()));
        cx.spawn_in(w, async move |view, cx| {
            let result = future.await;
            let _ = view.update_in(cx, |s, w, cx| {
                s.busy = false;
                match result {
                    Ok(StorageReply::Move(value)) => s.confirm(
                        Request::Move(path),
                        View::Home,
                        "settings.storage.storageDataMigrationConfirmTitle",
                        s.formatted(
                            "settings.storage.storageDataMigrationConfirmDetail",
                            &[
                                (
                                    "currentDataRoot",
                                    value
                                        .from
                                        .map(|p| p.display().to_string())
                                        .unwrap_or_default(),
                                ),
                                ("targetDataRoot", value.to.display().to_string()),
                            ],
                        ),
                        w,
                        cx,
                    ),
                    _ => s.message = s.tr("settings.storage.storageMigrationFailed"),
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
            .w(px(if confirm.detail.is_empty() {
                280.
            } else {
                600.
            }))
            .track_focus(&self.dialog_content_focus)
            .on_key_down(cx.listener(|s, event: &KeyDownEvent, w, cx| {
                if event.keystroke.key == "escape" {
                    s.close(w, cx);
                    cx.stop_propagation();
                }
            }))
            .child(heading(title.clone()))
            .when(!confirm.detail.is_empty(), |dialog| {
                dialog.child(
                    div()
                        .id("storage-confirm-detail")
                        .min_h_0()
                        .overflow_y_scroll()
                        .child(label(confirm.detail.clone())),
                )
            })
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
        quietpro::modal_dialog(
            title,
            self.dialog_focus.clone(),
            content,
            move |w, cx| {
                let _ = weak.update(cx, |s, cx| s.close(w, cx));
            },
            cx,
        )
        .close_on_escape(false)
    }
    pub(super) fn preview_details(
        &self,
        p: &patina_activity_model::views::imports::ImportPreviewDto,
        c: quietpro::Palette,
    ) -> Div {
        let available = p.valid_records.saturating_sub(p.duplicate_records);
        let candidates = &p.category_candidates;
        let categorized = candidates
            .iter()
            .filter(|v| v.categories.len() == 1)
            .count();
        let conflicts = candidates.iter().filter(|v| v.categories.len() > 1).count();
        let mut body = div().flex().flex_col().gap(px(8.));
        for (key, count) in [
            ("settings.dataImport.availableLabel", available),
            ("settings.dataImport.categorizedAppsLabel", categorized),
            ("settings.dataImport.conflictedAppsLabel", conflicts),
        ] {
            body = body.child(label(format!("{} ･ {count}", self.tr(key))));
        }
        if conflicts > 0 {
            body = body.child(
                label(self.tr("settings.dataImport.categoryConflictNote")).text_color(c.secondary),
            );
        }
        for error in &p.errors {
            body = body.child(
                label(self.formatted(
                    "settings.dataImport.lineError",
                    &[
                        ("line", error.line.to_string()),
                        ("message", error.message.clone()),
                    ],
                ))
                .text_color(c.danger),
            );
        }
        body
    }
    fn backup_counts(&self, counts: [usize; 3], imports: [usize; 3]) -> String {
        let [sessions, settings, icons] = counts;
        let [batches, exact, buckets] = imports;
        let records = self.formatted(
            "backup.itemCounts",
            &[
                ("sessionCount", sessions.to_string()),
                ("settingCount", settings.to_string()),
                ("iconCacheCount", icons.to_string()),
            ],
        );
        let imported = self.formatted(
            "backup.importItemCounts",
            &[
                ("batchCount", batches.to_string()),
                ("exactCount", exact.to_string()),
                ("bucketCount", buckets.to_string()),
            ],
        );
        format!("{records}\n{imported}")
    }
    pub(super) fn remote_backup_summary(
        &self,
        p: &patina_activity_model::views::dav::RemoteBackupEntry,
    ) -> String {
        let counts = self.backup_counts(
            [p.session_count, p.setting_count, p.icon_cache_count],
            [
                p.import_batch_count,
                p.import_exact_session_count,
                p.import_time_bucket_count,
            ],
        );
        format!(
            "{} ･ {}\n{counts}",
            stamp(p.created_at_ms as i64),
            bytes(p.size_bytes)
        )
    }
    pub(super) fn backup_summary(
        &self,
        p: &patina_activity_model::backup::BackupPreview,
    ) -> String {
        let counts = self.backup_counts(
            [p.session_count, p.setting_count, p.icon_cache_count],
            [
                p.import_batch_count,
                p.import_exact_session_count,
                p.import_time_bucket_count,
            ],
        );
        let safety = if p.restore_message_key.is_empty() {
            p.restore_message.clone()
        } else {
            self.tr(&p.restore_message_key)
        };
        format!(
            "{}\n{}\n{}\n{}\n{counts}",
            self.tr("backup.formatLabel"),
            self.formatted("backup.appVersion", &[("version", p.app_version.clone())]),
            self.formatted(
                "backup.exportedAt",
                &[("value", stamp(p.exported_at_ms as i64))]
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
                let result = client.storage(Request::Schedule { backup }).await;
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
    pub(super) fn schedule_status(&self, backup: bool, c: quietpro::Palette) -> Option<Div> {
        let mut lines = Vec::new();
        let p = form::schedule(&self.result)?;
        for (key, value) in [
            ("settings.scheduledBackupLabels.nextExecution", p.next),
            ("settings.scheduledBackupLabels.recentSuccess", p.success),
            ("settings.scheduledBackupLabels.recentFailure", p.failure),
        ] {
            if let Some(value) = value {
                lines.push(label(format!("{} ･ {}", self.tr(key), stamp(value))));
            }
        }
        if let Some(size) = p.size {
            lines.push(label(bytes(size)));
        }
        if let Some(code) = p.error {
            lines.push(label(self.task_error(code, backup)).text_color(c.danger));
        }
        if p.cleanup.is_some_and(|w| !w.is_empty()) {
            lines.push(
                label(self.tr("settings.scheduledBackupCleanupWarning")).text_color(c.secondary),
            );
        }
        if let Some(status) = p.active {
            lines.push(label(if status == "running" {
                self.tr(if backup {
                    "settings.backupExporting"
                } else {
                    "export.exporting"
                })
            } else {
                format!(
                    "{} ･ {}",
                    self.tr("settings.retry"),
                    p.retry.map(stamp).unwrap_or_default()
                )
            }));
            if let Some(code) = p.active_error {
                lines.push(label(self.task_error(code, backup)));
            }
        }
        (!lines.is_empty()).then(|| div().flex().flex_col().gap(px(8.)).children(lines))
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
                .value_typography(px(12.), FontWeight::MEDIUM)
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
            .child(label(self.tr("settings.storageTime")).font_weight(FontWeight::BOLD))
            .child(row)
    }
    pub(super) fn completed(&self, request: &Request, result: &StorageReply) -> String {
        match (request, result) {
            (Request::Export(r), StorageReply::ExportCount(count)) => self.formatted(
                "native.export.completed",
                &[
                    ("count", count.to_string()),
                    ("path", r.output_path.clone()),
                ],
            ),
            (Request::Import { .. }, StorageReply::Imported(report)) => self.formatted(
                "settings.dataImport.importSuccess",
                &[("count", report.imported_records.to_string())],
            ),
            (Request::DeleteBatch(_), StorageReply::Deleted(report)) => self.formatted(
                "settings.dataImport.deleteSuccess",
                &[(
                    "count",
                    (report.deleted_exact_sessions + report.deleted_hour_buckets).to_string(),
                )],
            ),
            (Request::Backup(path), _) => self.formatted(
                "toast.backupExportSuccess",
                &[("path", path.display().to_string())],
            ),
            (Request::Convert(_), StorageReply::Converted(report)) => self.formatted(
                "settings.dataImport.destructureSuccess",
                &[
                    ("count", report.records_written.to_string()),
                    ("path", report.output_path.clone()),
                ],
            ),
            (Request::Restore { .. }, _) => self.tr("toast.backupRestoreSuccess"),
            (Request::Cleanup(_), _) => self.tr("toast.cleanupSuccess"),
            (Request::DavSave { .. }, _) => self.tr("toast.webDavConfigSaved"),
            (Request::DavClear, _) => self.tr("toast.webDavConfigDeleted"),
            (Request::DavTest { .. }, _) => self.tr("toast.webDavTestSuccess"),
            (Request::DavUpload { file, .. }, _) => {
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
