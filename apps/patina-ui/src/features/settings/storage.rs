mod form;
use super::*;
use chrono::{Datelike, Duration, Local, NaiveDate, TimeZone};
use gpui_kit::base::{
    Button, Dialog,
    input::{InputAccessibility, InputEvent, InputState},
};
use patina_activity_model::views::storage::{ExportPreferences, StorageInfo, StorageReply};
use patina_activity_model::{
    ALL_EXPORT_FIELDS, DEFAULT_EXPORT_FIELDS, ExportDataRequest, StorageRequest as Request,
};
use std::path::PathBuf;
mod export;
mod presentation;

struct ParentView {
    view: View,
    result: StorageReply,
    values: [String; 7],
}
struct Confirmation {
    request: Request,
    next: View,
    title: String,
    detail: String,
    focus: Option<FocusHandle>,
}

const FIELD_GROUPS: [(&str, &[&str]); 6] = [
    (
        "export.groupActivity",
        &[
            "record_type",
            "start_time",
            "end_time",
            "duration_ms",
            "duration_minutes",
            "local_date",
            "weekday",
            "start_hour",
        ],
    ),
    (
        "export.groupApps",
        &[
            "app_name",
            "exe_name",
            "window_title",
            "session_id",
            "continuity_group_start_time",
        ],
    ),
    (
        "export.groupWeb",
        &[
            "domain",
            "normalized_domain",
            "url",
            "page_title",
            "web_segment_id",
            "browser_client_id",
            "browser_kind",
            "browser_exe_name",
            "favicon_url",
            "web_source",
        ],
    ),
    (
        "export.groupClassification",
        &["category", "category_id", "category_color"],
    ),
    ("export.groupAnalysis", &["local_week", "local_month"]),
    (
        "export.groupAudit",
        &["source_key", "source_name", "created_at", "updated_at"],
    ),
];

#[derive(Clone, Copy, PartialEq)]
enum View {
    Home,
    Export,
    Fields,
    Range,
    Import,
    PreviewCsv,
    Batches,
    Backup,
    Upload,
    Restore,
    PreviewBackup,
    Dav,
    Remote,
    Cleanup,
    Schedule(bool),
}
#[derive(Clone, Copy)]
enum Pick {
    Export,
    Csv,
    Convert,
    Backup,
    Restore,
    Move,
    ScheduleDirectory,
}

pub(super) struct StorageCard {
    client: Rc<Client>,
    view: View,
    dialog_focus: FocusHandle,
    dialog_content_focus: FocusHandle,
    return_focus: Option<FocusHandle>,
    busy: bool,
    message: String,
    paths: Option<StorageInfo>,
    result: StorageReply,
    fields: [Entity<InputState>; 7],
    format: &'static str,
    format_focus: [FocusHandle; 4],
    columns: Vec<String>,
    field_draft: Option<(Vec<String>, Option<FocusHandle>)>,
    fields_trigger: FocusHandle,
    expanded_field_groups: [bool; 6],
    days: u16,
    retention: Entity<SliderState>,
    enabled: bool,
    weekly: bool,
    remote: bool,
    revealed: bool,
    saved_password_preview: bool,
    parents: Vec<ParentView>,
    confirmation: Option<Confirmation>,
    export_preferences: ExportPreferences,
    range_mode: String,
    range_from_calendar: bool,
    calendar_month: NaiveDate,
    calendar_start: Option<NaiveDate>,
    calendar_end: Option<NaiveDate>,
    calendar_active: NaiveDate,
    calendar_focus: FocusHandle,
    range_trigger: FocusHandle,
    range_bounds: Rc<std::cell::Cell<Bounds<Pixels>>>,
    range_group_bounds: Rc<std::cell::Cell<Bounds<Pixels>>>,
    calendar_mode: &'static str,
    schedule_poll: Option<Task<()>>,
}
impl StorageCard {
    pub(super) fn new(client: Rc<Client>, win: &mut Window, cx: &mut Context<Self>) -> Self {
        let fields = std::array::from_fn(|i| cx.new(|cx| InputState::new(win, cx).masked(i == 3)));
        for input in &fields {
            cx.subscribe(input, |_, _, event, cx| {
                if matches!(event, InputEvent::Focus | InputEvent::Blur) {
                    cx.notify();
                }
            })
            .detach();
        }
        let retention = cx.new(|_| {
            SliderState::new()
                .min(0.)
                .max(5.)
                .step(1.)
                .default_value(4.)
        });
        cx.subscribe(&retention, |s: &mut Self, _, e: &SliderEvent, cx| {
            if let SliderEvent::Change(SliderValue::Single(value)) = e {
                s.days = [7, 15, 30, 60, 90, 180][(value.round() as usize).min(5)];
                cx.notify();
            }
        })
        .detach();
        let mut card = Self {
            retention,
            client,
            fields,
            view: View::Home,
            dialog_focus: cx.focus_handle(),
            dialog_content_focus: cx.focus_handle(),
            return_focus: None,
            busy: false,
            message: String::new(),
            paths: None,
            result: StorageReply::Done,
            format: "csv",
            format_focus: std::array::from_fn(|_| cx.focus_handle()),
            columns: DEFAULT_EXPORT_FIELDS
                .iter()
                .map(|s| s.to_string())
                .collect(),
            field_draft: None,
            fields_trigger: cx.focus_handle(),
            expanded_field_groups: [false; 6],
            days: 90,
            enabled: false,
            weekly: false,
            remote: false,
            revealed: false,
            saved_password_preview: false,
            parents: Vec::new(),
            confirmation: None,
            export_preferences: ExportPreferences::default(),
            range_mode: "month".into(),
            range_from_calendar: false,
            calendar_month: Local::now().date_naive().with_day(1).unwrap(),
            calendar_start: None,
            calendar_end: None,
            calendar_active: Local::now().date_naive(),
            calendar_focus: cx.focus_handle(),
            range_trigger: cx.focus_handle(),
            range_bounds: Default::default(),
            range_group_bounds: Default::default(),
            calendar_mode: "custom",
            schedule_poll: None,
        };
        card.fetch(Request::Info, View::Home, win, cx);
        card
    }
    fn tr(&self, key: &str) -> String {
        text(self.client.locale.get(), key)
    }

    fn set(&self, i: usize, key: &str, value: &str, win: &mut Window, cx: &mut Context<Self>) {
        self.fields[i].update(cx, |f, cx| {
            f.set_accessibility(
                InputAccessibility::new(Some(Role::TextInput))
                    .with_label(Some(self.tr(key).into())),
            );
            f.set_value(value.to_string(), win, cx);
        });
    }
    fn val(&self, i: usize, cx: &App) -> String {
        self.fields[i].read(cx).value().to_string()
    }
    fn set_view(&mut self, view: View, win: &mut Window, cx: &mut Context<Self>) {
        if self.view == View::Home && view != View::Home {
            self.return_focus = win.focused(cx);
        }
        if self.view != view && view != View::Home {
            win.focus(&self.dialog_content_focus, cx);
        } else if self.view != View::Home
            && view == View::Home
            && let Some(focus) = self.return_focus.take()
        {
            win.focus(&focus, cx);
        }
        if !matches!(view, View::Schedule(_)) {
            self.schedule_poll = None;
        }
        if view == View::Home {
            self.parents.clear();
        }
        self.view = view;
    }
    fn close(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if self.busy {
            return;
        }
        if let Some(confirm) = self.confirmation.take() {
            if let Some(focus) = confirm.focus {
                win.focus(&focus, cx);
            }
            cx.notify();
            return;
        }
        if !self.busy {
            if self.view == View::Fields {
                self.finish_fields(false, win, cx);
            } else if let Some(parent) = self.parents.pop() {
                let was_calendar = self.view == View::Range;
                self.set_view(parent.view, win, cx);
                self.result = parent.result;
                for (i, value) in parent.values.iter().enumerate() {
                    if i != 3 {
                        self.fields[i].update(cx, |f, cx| f.set_value(value.clone(), win, cx));
                    }
                }
                win.focus(
                    if was_calendar {
                        &self.range_trigger
                    } else {
                        &self.dialog_content_focus
                    },
                    cx,
                );
                self.message.clear();
                cx.notify();
            } else {
                self.open_view(View::Home, win, cx);
            }
        }
    }
    fn finish_fields(&mut self, apply: bool, win: &mut Window, cx: &mut Context<Self>) {
        if let Some((columns, focus)) = self.field_draft.take() {
            if !apply {
                self.columns = columns;
            } else {
                self.columns = ALL_EXPORT_FIELDS
                    .iter()
                    .filter(|key| self.columns.iter().any(|selected| selected == **key))
                    .map(|key| (*key).to_owned())
                    .collect();
            }
            if apply {
                self.remember_export(cx);
            }
            self.view = View::Export;
            win.focus(focus.as_ref().unwrap_or(&self.dialog_content_focus), cx);
            cx.notify();
        }
    }
    fn open_view(&mut self, view: View, win: &mut Window, cx: &mut Context<Self>) {
        if view != View::Home && self.view != View::Home && view != self.view {
            self.remember_parent(win, cx);
        }
        self.message.clear();
        if self.view == View::Dav {
            self.hide_password(win, cx);
            self.set(3, "settings.webDavPassword", "", win, cx);
        }
        self.set_view(view, win, cx);
        if view == View::Range {
            win.focus(&self.calendar_focus, cx);
        }
        match view {
            View::Home => self.fetch(Request::Info, view, win, cx),
            View::Batches => self.fetch(Request::Batches, view, win, cx),
            View::Dav => self.fetch(Request::DavInfo, view, win, cx),
            View::Upload => self.fetch(Request::DavInfo, view, win, cx),
            View::Remote => self.fetch(Request::DavList, view, win, cx),
            View::Schedule(backup) => self.fetch(Request::Schedule { backup }, view, win, cx),
            View::Export => self.fetch(Request::ExportPreferences(None), view, win, cx),
            _ => (),
        }
        cx.notify();
    }
    fn hide_password(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if self.saved_password_preview {
            self.set(3, "settings.webDavPassword", "", win, cx);
        }
        self.fields[3].update(cx, |f, cx| {
            f.set_masked(true, win, cx);
            f.set_scroll_offset(point(px(0.), px(0.)), cx);
            f.set_readonly(false, cx);
        });
        self.saved_password_preview = false;
        self.revealed = false;
    }
    fn toggle_password(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if self.revealed {
            self.hide_password(win, cx);
            cx.notify();
            return;
        }
        if !self.val(3, cx).is_empty()
            || !matches!(&self.result, StorageReply::DavConfig(config) if config.has_secret)
        {
            self.fields[3].update(cx, |f, cx| {
                f.set_masked(false, win, cx);
                f.set_scroll_offset(point(px(0.), px(0.)), cx);
            });
            self.revealed = true;
            cx.notify();
            return;
        }
        let Ok(hwnd) = crate::windows::placement::hwnd(win) else {
            return;
        };
        let read = self.client.reveal_dav_password(hwnd.0 as usize);
        self.busy = true;
        cx.notify();
        cx.spawn_in(win, async move |v, cx| {
            let result = read.await;
            let _ = v.update_in(cx, |s, w, c| {
                s.busy = false;
                match result {
                    Ok(Some(password)) if s.view == View::Dav => {
                        s.set(3, "settings.webDavPassword", &password, w, c);
                        s.fields[3].update(c, |f, c| {
                            f.set_readonly(true, c);
                            f.set_masked(false, w, c);
                            f.set_scroll_offset(point(px(0.), px(0.)), c);
                        });
                        s.saved_password_preview = true;
                        s.revealed = true;
                    }
                    Err(e) => s.message = e.to_string(),
                    _ => (),
                }
                c.notify();
            });
        })
        .detach();
    }
    fn fetch(&mut self, req: Request, next: View, win: &mut Window, cx: &mut Context<Self>) {
        self.fetch_request(req, next, false, win, cx);
    }
    fn fetch_request(
        &mut self,
        req: Request,
        next: View,
        feedback: bool,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.busy {
            return;
        }
        let info = matches!(req, Request::Info);
        let finished = matches!(
            req,
            Request::Export(_)
                | Request::Import { .. }
                | Request::DeleteBatch(_)
                | Request::Backup(_)
                | Request::Restore { .. }
                | Request::Cleanup(_)
                | Request::Move(_)
                | Request::DavSave { .. }
                | Request::DavClear
                | Request::DavTest { .. }
                | Request::DavUpload { .. }
                | Request::SaveBackupSchedule(_)
                | Request::SaveExportSchedule(_)
        );
        let moved = matches!(req, Request::Move(_));
        let converted = matches!(req, Request::Convert(_));
        let upload = matches!(req, Request::DavUpload { .. });
        let testing = matches!(req, Request::DavTest { .. });
        self.busy = true;
        if !info {
            self.message.clear();
        }
        cx.notify();
        let outcome = req.clone();
        let client = self.client.clone();
        let request = self.client.storage(req);
        cx.spawn_in(win, async move |v, cx| {
            let response = request.await;
            let batches = if response.is_ok() && matches!(outcome, Request::DeleteBatch(_)) {
                Some(
                    client.storage(Request::Batches)
                        .await,
                )
            } else {
                None
            };
            let _ = v.update_in(cx, |s, win, cx| {
                s.busy = false;
                if feedback {
                    cx.emit(crate::windows::main::Feedback(s.tr(if response.is_ok() {
                        "settings.storage.storageSnapshotRefreshed"
                    } else {
                        "settings.storage.storageSnapshotRefreshFailed"
                    })));
                }
                match response {
                    Err(e) => {
                        if finished || converted {
                            cx.emit(crate::windows::main::Feedback(s.failed(&outcome, &e.to_string())));
                        } else if !feedback {
                            s.message = s.failed(&outcome, &e.to_string());
                        }
                    }
                    Ok(data) => {
                        if testing {
                            cx.emit(crate::windows::main::Feedback(s.tr("toast.webDavTestSuccess")));
                            cx.notify();
                            return;
                        }
                        if converted {
                            cx.emit(crate::windows::main::Feedback(s.completed(&outcome, &data)));
                            s.result = data;
                            cx.notify();
                            return;
                        }
                        if s.view == View::Dav {
                            s.hide_password(win, cx);
                            s.set(3, "settings.webDavPassword", "", win, cx);
                        }
                        s.set_view(next, win, cx);
                        if let StorageReply::Info(paths) = &data {
                            s.paths = Some(paths.clone());
                        }
                        if next == View::Upload {
                            s.set(
                                6,
                                "settings.webDavFileName",
                                &format!("Patina-backup-{}.zip", Local::now().format("%Y%m%d-%H%M%S")),
                                win,
                                cx,
                            );
                        }
                        if next == View::Dav && let StorageReply::DavConfig(account) = &data {
                            let cfg=account.config.as_ref();
                            for (i,key,value) in [
                                (0,"settings.webDavServerUrl",cfg.map_or("", |cfg| cfg.url.as_str())),
                                (1,"settings.webDavUsername",cfg.map_or("", |cfg| cfg.username.as_str())),
                                (2,"settings.webDavDirectory",cfg.map_or("/Patina", |cfg| cfg.remote_dir.as_str()))
                            ] { s.set(i,key,value,win,cx); }
                        }
                        if let View::Schedule(b) = next && let Some(cfg) = form::schedule(&data) {
                            s.enabled = cfg.enabled;
                            s.weekly = cfg.weekly;
                            s.remote = cfg.remote;
                            let mins = cfg.minutes;
                            s.set(
                                4,
                                "settings.storageTime",
                                &format!("{:02}:{:02}", mins / 60, mins % 60),
                                win,
                                cx,
                            );
                            s.set(
                                5,
                                "settings.storageWeekday",
                                &cfg.weekday.unwrap_or(1).to_string(),
                                win,
                                cx,
                            );
                            s.set(
                                6,
                                "settings.storage.dataDirectoryLabel",
                                cfg.directory,
                                win,
                                cx,
                            );
                            s.poll_schedule(b, cx);
                        }
                        if next == View::Export && let StorageReply::ExportPreferences(prefs) = &data {
                            s.export_preferences = prefs.clone().unwrap_or_default();
                            s.range_from_calendar = false;
                            s.range_mode = s.export_preferences.mode.clone().unwrap_or_else(|| "month".into());
                            s.format = export::format_name(s.export_preferences.format.as_deref().unwrap_or("csv"));
                            s.columns = s.saved_columns(s.format);
                            s.set_period(Local::now().date_naive(), win, cx);
                        }
                        s.message = if upload && matches!(&data, StorageReply::DavUpload(report) if !report.index_updated) {
                            let file = match &outcome {
                                Request::DavUpload { file, .. } => file.clone(),
                                _ => String::new(),
                            };
                            s.formatted("toast.webDavUploadIndexWarning", &[("fileName", file)])
                        } else if moved {
                            s.tr("settings.storageMovePending")
                        } else if finished {
                            s.completed(&outcome, &data)
                        } else if info {
                            s.message.clone()
                        } else {
                            String::new()
                        };
                        if finished && !moved {
                            cx.emit(crate::windows::main::Feedback(std::mem::take(&mut s.message)));
                        }
                        s.result = data;
                        if let Some(batches) = batches {
                            match batches {
                                Ok(batches) => s.result = batches,
                                Err(_) => s
                                    .message
                                    .push_str(&format!("\n{}", s.tr("settings.loadFailed"))),
                            }
                        }
                        if next == View::Home && !info {
                            let msg = s.message.clone();
                            s.fetch(Request::Info, View::Home, win, cx);
                            s.message = msg;
                        }
                    }
                }
                cx.notify();
            });
        })
        .detach();
    }
    fn choose(&mut self, pick: Pick, win: &mut Window, cx: &mut Context<Self>) {
        let save = matches!(pick, Pick::Export | Pick::Backup);
        let dir = matches!(pick, Pick::Move | Pick::ScheduleDirectory);
        let range = if matches!(pick, Pick::Export) {
            let day = |i, end: bool| {
                let date = NaiveDate::parse_from_str(&self.val(i, cx), "%Y-%m-%d").ok()?;
                let d = if end { date.succ_opt()? } else { date };
                Some(
                    Local
                        .from_local_datetime(&d.and_hms_opt(0, 0, 0)?)
                        .earliest()?
                        .timestamp_millis(),
                )
            };
            match (day(4, false), day(5, true)) {
                (Some(a), Some(b)) if a < b => Some((a, b)),
                _ => {
                    self.message = self.tr("export.timeRangeInvalid");
                    cx.notify();
                    return;
                }
            }
        } else {
            None
        };
        let root = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_default();
        let save_picker = save.then(|| {
            let (kind, ext) = if matches!(pick, Pick::Backup) {
                ("backup", "zip")
            } else {
                ("export", export::extension(self.format))
            };
            let suggested = format!(
                "Patina-{kind}-{}.{ext}",
                Local::now().format("%Y%m%d-%H%M%S")
            );
            cx.prompt_for_new_path(&root, Some(&suggested))
        });
        let open_picker = (!save).then(|| {
            cx.prompt_for_paths(PathPromptOptions {
                files: !dir,
                directories: dir,
                multiple: false,
                prompt: None,
            })
        });
        self.busy = true;
        cx.notify();
        cx.spawn_in(win, async move |v, cx| {
            let selection = if let Some(f) = save_picker {
                f.await
                    .map_err(|e| e.to_string())
                    .and_then(|r| r.map_err(|e| e.to_string()))
            } else {
                open_picker
                    .unwrap()
                    .await
                    .map_err(|e| e.to_string())
                    .and_then(|r| r.map_err(|e| e.to_string()))
                    .map(|paths| paths.and_then(|v| v.into_iter().next()))
            };
            let _ = v.update_in(cx, |s, win, cx| {
                s.busy = false;
                cx.notify();
                let path = match selection {
                    Ok(Some(path)) => path,
                    Ok(None) => return,
                    Err(error) => {
                        s.message = error;
                        return;
                    }
                };
                let path = if matches!(pick, Pick::Export) {
                    path.with_extension(export::extension(s.format))
                } else {
                    path
                };
                let p = path.to_string_lossy().into_owned();
                if matches!(pick, Pick::Csv | Pick::Restore) {
                    s.remember_parent(win, cx);
                }
                match pick {
                    Pick::Move => s.prepare_move(Some(path), win, cx),
                    Pick::ScheduleDirectory => {
                        s.set(6, "settings.storage.dataDirectoryLabel", &p, win, cx)
                    }
                    Pick::Backup => s.fetch(Request::Backup(path), View::Home, win, cx),
                    Pick::Restore => {
                        s.fetch(Request::PreviewRestore(p), View::PreviewBackup, win, cx)
                    }
                    Pick::Csv => s.fetch(Request::PreviewCsv(p), View::PreviewCsv, win, cx),
                    Pick::Convert => s.fetch(Request::Convert(p), View::PreviewCsv, win, cx),
                    Pick::Export => {
                        let (a, b) = range.unwrap();
                        s.fetch(
                            Request::Export(ExportDataRequest {
                                format: s.format.into(),
                                output_path: p,
                                start_time: Some(a),
                                end_time: Some(b),
                                selected_fields: Some(s.columns.clone()),
                            }),
                            View::Home,
                            win,
                            cx,
                        )
                    }
                }
            });
        })
        .detach();
    }
    fn confirm(
        &mut self,
        req: Request,
        next: View,
        key: &str,
        detail: String,
        win: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.confirmation = Some(Confirmation {
            request: req,
            next,
            title: self.tr(key),
            detail,
            focus: win.focused(cx),
        });
        win.focus(&self.dialog_content_focus, cx);
        cx.notify();
    }
    fn btn(
        &self,
        key: &'static str,
        c: quietpro::Palette,
        cx: &Context<Self>,
        f: impl Fn(&mut Self, &mut Window, &mut Context<Self>) + 'static,
    ) -> Button {
        text_button(key, self.tr(key), c, !self.busy)
            .on_click(cx.listener(move |s, _, w, cx| f(s, w, cx)))
    }
    fn input(&self, i: usize, key: &str, c: quietpro::Palette) -> Div {
        div()
            .flex()
            .flex_col()
            .gap(px(8.))
            .min_w_0()
            .flex_none()
            .child(
                label(self.tr(key))
                    .text_size(px(14.))
                    .when(matches!(self.view, View::Dav | View::Schedule(_)), |l| {
                        l.font_weight(FontWeight::BOLD)
                    }),
            )
            .child(div().flex().h(px(32.)).child(
                quietpro::TextInput::new(("storage-input", i), &self.fields[i], c).disabled(
                    self.busy || (matches!(self.view, View::Schedule(_)) && !self.enabled),
                ),
            ))
    }
    fn schedule_save(&mut self, b: bool, w: &mut Window, cx: &mut Context<Self>) {
        let time = chrono::NaiveTime::parse_from_str(&self.val(4, cx), "%H:%M");
        use chrono::Timelike;
        let Ok(time) = time else {
            self.message = self.tr("settings.storageTime");
            cx.notify();
            return;
        };
        let weekday = self.val(5, cx).parse::<u8>().ok();
        use patina_activity_model::{backup_schedule as backup, export_schedule as export};
        let local_time_minutes = (time.hour() * 60 + time.minute()) as u16;
        let weekday = if self.weekly { weekday } else { None };
        let request = if b {
            Request::SaveBackupSchedule(backup::ScheduledBackupConfigInput {
                enabled: self.enabled,
                weekday,
                local_time_minutes,
                cadence: if self.weekly {
                    backup::ScheduledBackupCadence::Weekly
                } else {
                    backup::ScheduledBackupCadence::Daily
                },
                target: if self.remote {
                    backup::ScheduledBackupTargetInput::WebDav
                } else {
                    backup::ScheduledBackupTargetInput::Local {
                        target_dir: self.val(6, cx),
                    }
                },
            })
        } else {
            let Ok(format) = export::ScheduledExportFormat::parse(self.format) else {
                self.message = self.tr("settings.saveFailed");
                cx.notify();
                return;
            };
            Request::SaveExportSchedule(export::ScheduledExportConfigInput {
                enabled: self.enabled,
                weekday,
                local_time_minutes,
                cadence: if self.weekly {
                    export::ScheduledExportCadence::Weekly
                } else {
                    export::ScheduledExportCadence::Daily
                },
                target_dir: self.val(6, cx),
                format,
                selected_fields: self.columns.clone(),
            })
        };
        self.fetch(request, View::Schedule(b), w, cx)
    }
}

impl StorageCard {
    fn field_groups(&self, c: quietpro::Palette, cx: &Context<Self>) -> Div {
        let mut body = div().flex().flex_col().gap(px(12.));
        if self.columns.is_empty() {
            body = body.child(
                label(self.tr("export.configFieldsEmpty"))
                    .text_color(c.danger)
                    .role(Role::Status),
            );
        }
        for (index, &(title_key, fields)) in FIELD_GROUPS.iter().enumerate() {
            let title = self.tr(title_key);
            let count = fields
                .iter()
                .filter(|key| self.columns.iter().any(|selected| selected == **key))
                .count();
            let all = count == fields.len();
            let expanded = self.expanded_field_groups[index];
            let group_view = cx.weak_entity();
            let header = div()
                .flex()
                .items_center()
                .gap(px(8.))
                .child(
                    quietpro::group_heading(title.clone())
                        .id("field-group-title")
                        .flex_1(),
                )
                .child(
                    label(format!("{count}/{}", fields.len()))
                        .text_size(px(12.))
                        .text_color(c.secondary),
                )
                .child(
                    quietpro::checkbox(
                        "select-group",
                        format!(
                            "{} ･ {title}",
                            self.tr(if all {
                                "export.deselectGroupFields"
                            } else {
                                "export.selectGroupFields"
                            })
                        ),
                        all,
                        count > 0 && !all,
                        !self.busy,
                        c,
                    )
                    .on_change(move |_, _, _, cx| {
                        let _ = group_view.update(cx, |s, cx| {
                            s.columns.retain(|key| !fields.contains(&key.as_str()));
                            if !all {
                                s.columns.extend(fields.iter().map(|key| (*key).to_owned()));
                            }
                            cx.notify();
                        });
                    }),
                )
                .child(
                    IconControl::new(
                        "expand-group",
                        format!(
                            "{} ･ {title}",
                            self.tr(if expanded {
                                "export.collapseFieldGroup"
                            } else {
                                "export.expandFieldGroup"
                            })
                        ),
                        if expanded {
                            Icon::ChevronUp
                        } else {
                            Icon::ChevronDown
                        },
                    )
                    .disabled(self.busy)
                    .button(c)
                    .aria_expanded(expanded)
                    .on_click(cx.listener(move |s, _, _, cx| {
                        s.expanded_field_groups[index] = !expanded;
                        cx.notify();
                    })),
                );
            let mut group = content_card(c.border, c.panel)
                .id(title_key)
                .p(px(12. + 1.))
                .when(!expanded, |card| card.h(px(48.)).py_0().justify_center())
                .gap(px(12.))
                .flex_none()
                .child(header);
            if expanded {
                let mut rows = div().flex().flex_col().gap_0();
                for (field_index, &key) in fields.iter().enumerate() {
                    let checked = self.columns.iter().any(|selected| selected == key);
                    let name = self.tr(&format!("export.fields.{key}.label"));
                    let field_view = cx.weak_entity();
                    rows = rows.child(
                        quietpro::field_row(field_index, fields.len(), c)
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .flex_1()
                                    .min_w_0()
                                    .gap_x(px(8.))
                                    .text_color(if self.busy { c.disabled_text } else { c.text })
                                    .child(label(name.clone()).text_size(px(14.)).flex_none())
                                    .child(
                                        label(self.tr(&format!("export.fields.{key}.desc")))
                                            .text_size(px(12.))
                                            .min_w_0()
                                            .truncate()
                                            .text_color(c.secondary),
                                    ),
                            )
                            .child(
                                quietpro::checkbox(key, name, checked, false, !self.busy, c)
                                    .on_change(move |_, _, _, cx| {
                                        let _ = field_view.update(cx, |s, cx| {
                                            s.columns.retain(|selected| selected != key);
                                            if !checked {
                                                s.columns.push(key.to_owned());
                                            }
                                            cx.notify();
                                        });
                                    }),
                            ),
                    );
                }
                group = group.child(rows);
            }
            body = body.child(group);
        }

        body
    }

    fn content(&self, view: View, win: &mut Window, cx: &mut Context<Self>) -> Div {
        use self::View::*;
        let c = self.client.palette(win);
        let row = || {
            div()
                .flex()
                .flex_wrap()
                .min_h(px(SETTINGS_ROW_HEIGHT))
                .items_center()
                .gap(px(8.))
        };
        let view_button = |key, next| self.btn(key, c, cx, move |s, w, c| s.open_view(next, w, c));
        let picker = |key, pick| self.btn(key, c, cx, move |s, w, c| s.choose(pick, w, c));
        let button = |key, f: fn(&mut Self, &mut Window, &mut Context<Self>)| {
            self.btn(key, c, cx, f)
                .when(matches!(view, Dav | Cleanup), |b| {
                    b.control_size(ControlSize::Large)
                })
        };
        let dav_configured = self.paths.as_ref().is_some_and(|info| info.dav.is_some());
        let choice = |key: &'static str,
                      enabled: bool,
                      f: fn(&mut Self, &mut Window, &mut Context<Self>)| {
            quietpro::choice_entry(key, self.tr(key), enabled && !self.busy, c)
                .on_click(cx.listener(move |s, _, w, cx| f(s, w, cx)))
        };
        let mut head = if view == Home {
            settings_title(c, Icon::Database, self.tr("settings.dataSafetyTitle"))
        } else {
            div()
                .flex()
                .items_center()
                .gap(px(12.))
                .child(heading(self.tr(view.title())).id("dialog-title").flex_1())
        };
        let mut header_icons = Vec::new();
        if matches!(view, Export | Import | Backup) {
            let (key, next, icon) = match view {
                Export => (
                    "export.scheduledTitle",
                    Schedule(false),
                    Icon::CalendarClock,
                ),
                Import => ("settings.dataImport.batchesTitle", Batches, Icon::Trash),
                _ => (
                    "settings.storageScheduledBackup",
                    Schedule(true),
                    Icon::CalendarClock,
                ),
            };
            header_icons.push(
                IconControl::new("storage-header-action", self.tr(key), icon)
                    .disabled(self.busy)
                    .action(c, cx.listener(move |s, _, w, cx| s.open_view(next, w, cx)))
                    .into_any_element(),
            );
        }
        if let Schedule(backup) = view {
            let key = if backup {
                "settings.storageScheduledBackup"
            } else {
                "export.scheduledTitle"
            };
            let weak = cx.weak_entity();
            head = head.child(quietpro::switch_control(
                "schedule-enabled",
                self.tr(key),
                self.enabled,
                !self.busy,
                c,
                move |enabled, _, _, cx| {
                    let _ = weak.update(cx, |s, cx| {
                        s.enabled = enabled;
                        cx.notify();
                    });
                },
            ));
        }
        if view == Fields {
            header_icons.push(
                IconControl::new(
                    "restore-field-defaults",
                    self.tr("export.restoreFormatDefaults"),
                    Icon::RotateCcw,
                )
                .disabled(self.busy)
                .action(
                    c,
                    cx.listener(|s, _, _, cx| {
                        s.columns = match s.format {
                            "sqlite" => ALL_EXPORT_FIELDS.to_vec(),
                            "parquet" => DEFAULT_EXPORT_FIELDS
                                .iter()
                                .copied()
                                .chain([
                                    "category_id",
                                    "local_date",
                                    "local_week",
                                    "local_month",
                                    "weekday",
                                    "start_hour",
                                    "duration_minutes",
                                    "source_key",
                                    "source_name",
                                ])
                                .collect(),
                            "markdown" => vec![
                                "start_time",
                                "end_time",
                                "duration_minutes",
                                "record_type",
                                "source_name",
                                "category",
                                "window_title",
                                "page_title",
                                "url",
                            ],
                            _ => DEFAULT_EXPORT_FIELDS.to_vec(),
                        }
                        .into_iter()
                        .map(str::to_owned)
                        .collect();
                        cx.notify();
                    }),
                )
                .into_any_element(),
            );
        }
        let mut panel = (if view == Home {
            content_card(c.border, c.panel)
        } else {
            quietpro::dialog_surface(c, win.viewport_size())
        })
        .flex_none()
        .gap(px(CARD_TITLE_GAP));
        let mut body = div().flex().flex_col().gap(px(12.)).min_w_0();
        let mut actions = Vec::<AnyElement>::new();
        match view {
            Home => {
                let wide = crate::windows::main::page_width(win.viewport_size().width) >= px(680.);
                let subhead = |key| quietpro::group_heading(self.tr(key)).text_color(c.secondary);
                let section = |title: Div, card: Div| {
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(SUBHEADING_GAP))
                        .child(title)
                        .child(card)
                };
                let pair = |left: Div, right: Div| {
                    if wide {
                        settings_row()
                            .gap(px(12.))
                            .child(left.flex_1())
                            .child(vertical_divider(c))
                            .child(right.flex_1())
                    } else {
                        div()
                            .flex()
                            .flex_col()
                            .child(left)
                            .child(line_above(right, c, 0.))
                    }
                };
                let row_name =
                    |name: String| settings_row_label(name).font_weight(FontWeight::BOLD);
                let row_action = |button: Button| {
                    button
                        .control_size(ControlSize::Medium)
                        .text_size(px(12.))
                        .font_weight(FontWeight::MEDIUM)
                };
                let entry = |key, view| {
                    settings_row()
                        .justify_between()
                        .gap(px(8.))
                        .child(row_name(self.tr(key)))
                        .child(row_action(view_button(key, view)))
                };
                let portable = settings_rows_card(c).child(pair(
                    entry("settings.dataExportAction", Export),
                    entry("settings.dataImportAction", Import),
                ));
                let dav = row()
                    .child(row_name(self.tr("settings.webDavConfigTitle")).flex_1())
                    .child(
                        row_action(text_button(
                            "dav-test",
                            self.tr("settings.webDavTestConnection"),
                            c,
                            !self.busy && dav_configured,
                        ))
                        .on_click(cx.listener(|s, _, w, cx| {
                            let Some(config) = s.paths.as_ref().and_then(|info| info.dav.as_ref())
                            else {
                                return;
                            };
                            s.fetch(
                                Request::DavTest {
                                    url: config.url.clone(),
                                    username: config.username.clone(),
                                    directory: config.remote_dir.clone(),
                                    password: None,
                                },
                                Home,
                                w,
                                cx,
                            );
                        })),
                    )
                    .child(row_action(view_button("settings.webDavEdit", Dav)))
                    .child(
                        row_action(text_button(
                            "dav-delete",
                            self.tr("settings.webDavDeleteAction"),
                            c,
                            !self.busy && dav_configured,
                        ))
                        .on_click(cx.listener(|s, _, w, cx| {
                            s.confirm(
                                Request::DavClear,
                                Home,
                                "settings.webDavDeleteTitle",
                                s.tr("settings.webDavDeleteDetail"),
                                w,
                                cx,
                            )
                        })),
                    );
                let backups = settings_rows_card(c)
                    .child(pair(
                        entry("settings.backupExportAction", Backup),
                        entry("settings.backupRestoreAction", Restore),
                    ))
                    .child(line_above(dav, c, 0.));
                let dir_head = div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(subhead("settings.storage.storageDirectoryTitle"))
                    .child(
                        IconControl::new(
                            "refresh-storage",
                            self.tr("settings.storage.storageSnapshotRefreshAction"),
                            Icon::RefreshCw,
                        )
                        .with_tooltip()
                        .disabled(self.busy)
                        .action(
                            c,
                            cx.listener(|s, _, w, cx| {
                                s.fetch_request(Request::Info, Home, true, w, cx)
                            }),
                        ),
                    );
                let directory = |key, id: &'static str| {
                    let name = self.tr(key);
                    let path = self.paths.as_ref().and_then(|info| {
                        if id == "data" {
                            info.data.clone()
                        } else {
                            Some(info.install.clone())
                        }
                    });
                    let mut dir = settings_row()
                        .min_w_0()
                        .gap(px(4.))
                        .child(row_name(name.clone()));
                    if let Some(bytes) = self.paths.as_ref().map(|info| {
                        if id == "data" {
                            info.bytes
                        } else {
                            info.install_bytes
                        }
                    }) {
                        dir = dir.child(quietpro::caption(
                            format!("{:.1} MiB", bytes as f64 / 1048576.),
                            c,
                        ));
                    }
                    dir = dir.child(div().flex_1());
                    let mut actions = quietpro::icon_actions().child(
                        IconControl::new(
                            id,
                            format!(
                                "{} ･ {}",
                                self.tr("settings.storage.openDirectoryAction"),
                                name
                            ),
                            Icon::FolderOpen,
                        )
                        .with_tooltip()
                        .disabled(self.busy || path.is_none())
                        .action(c, move |_, _, cx| {
                            if let Some(path) = &path {
                                cx.open_with_system(path)
                            }
                        }),
                    );
                    if id == "data" {
                        actions = actions.child(
                            IconControl::new(
                                "move-data",
                                self.tr("settings.storage.changePathAction"),
                                Icon::FolderPen,
                            )
                            .with_tooltip()
                            .disabled(self.busy)
                            .action(c, cx.listener(|s, _, w, cx| s.choose(Pick::Move, w, cx))),
                        );
                        actions = actions.child(
                            IconControl::new(
                                "data-cleanup",
                                self.tr("settings.cleanupTitle"),
                                Icon::Trash,
                            )
                            .with_tooltip()
                            .disabled(self.busy)
                            .action(
                                quietpro::Palette {
                                    secondary: c.danger,
                                    text: c.danger,
                                    disabled_text: c.danger.opacity(0.5),
                                    ..c
                                },
                                cx.listener(|s, _, w, cx| s.open_view(Cleanup, w, cx)),
                            ),
                        );
                        if self.paths.as_ref().is_some_and(|info| {
                            info.data.as_ref() != Some(&info.default) || info.pending.is_some()
                        }) {
                            actions = actions.child(
                                IconControl::new(
                                    "restore-data-path",
                                    self.tr("settings.storage.restoreDefaultPathAction"),
                                    Icon::RotateCcw,
                                )
                                .with_tooltip()
                                .disabled(self.busy)
                                .action(c, cx.listener(|s, _, w, cx| s.prepare_move(None, w, cx))),
                            );
                        }
                    }
                    dir.child(actions)
                };
                let directories = settings_rows_card(c).child(pair(
                    directory("settings.storage.installDirectoryLabel", "install"),
                    directory("settings.storage.dataDirectoryLabel", "data"),
                ));
                body = body
                    .gap(px(SECTION_GROUP_GAP))
                    .child(section(
                        div().child(subhead("settings.dataExportTitle")),
                        portable,
                    ))
                    .child(section(
                        div().child(subhead("settings.backupRestoreTitle")),
                        backups,
                    ))
                    .child(section(dir_head, directories));
                if let Some(info) = &self.paths {
                    for (detail, key) in [
                        (
                            info.pending.as_ref().map(|p| p.display().to_string()),
                            "settings.storageMovePending",
                        ),
                        (
                            info.move_error.clone(),
                            "settings.storage.storageMigrationFailed",
                        ),
                    ] {
                        if let Some(detail) = detail {
                            body = body.child(label(format!("{} ･ {detail}", self.tr(key))));
                        }
                    }
                }
            }
            Export => {
                body = body.child(export::ExportForm(cx.weak_entity()));
                actions.push(picker("settings.dataExportAction", Pick::Export).into_any_element());
            }
            Range => unreachable!("range calendar is anchored in export"),
            Fields => {
                body = body.child(FieldGroups(cx.weak_entity()));
                actions.push(
                    text_button(
                        "confirm-fields",
                        self.tr("common.confirm"),
                        c,
                        !self.busy && !self.columns.is_empty(),
                    )
                    .control_size(ControlSize::Large)
                    .on_click(cx.listener(|s, _, w, cx| s.finish_fields(true, w, cx)))
                    .into_any_element(),
                );
            }
            Import => {
                body = body
                    .child(choice("settings.dataImport.csvTitle", true, |s, w, cx| {
                        s.choose(Pick::Csv, w, cx)
                    }))
                    .child(choice(
                        "settings.dataImport.destructureTitle",
                        true,
                        |s, w, cx| s.choose(Pick::Convert, w, cx),
                    ));
            }
            PreviewCsv => {
                let StorageReply::Csv(p) = &self.result else {
                    return body;
                };
                body = body
                    .child(self.preview_details(p, c))
                    .child(label(p.file_name.clone()));
                for (key, count) in [
                    ("settings.dataImport.exactLabel", p.exact_sessions),
                    ("settings.dataImport.hourLabel", p.hour_buckets),
                    ("settings.dataImport.duplicateLabel", p.duplicate_records),
                    ("settings.dataImport.errorLabel", p.error_records),
                ] {
                    body = body.child(label(format!("{} ･ {count}", self.tr(key))));
                }
                if p.valid_records > p.duplicate_records {
                    actions.push(
                        button("settings.dataImportAction", |s, w, c| {
                            let StorageReply::Csv(p) = &s.result else {
                                return;
                            };
                            s.fetch(
                                Request::Import {
                                    path: p.file_path.clone(),
                                    fingerprint: p.file_fingerprint.clone(),
                                },
                                Home,
                                w,
                                c,
                            )
                        })
                        .into_any_element(),
                    );
                }
            }
            Batches | Remote => {
                body = body.gap_0();
                let remote = view == Remote;
                let rows: Vec<_> = match &self.result {
                    StorageReply::DavList(entries) if remote => entries
                        .iter()
                        .map(|entry| {
                            (
                                entry.id.clone(),
                                entry.file_name.clone(),
                                self.remote_backup_summary(entry),
                            )
                        })
                        .collect(),
                    StorageReply::Batches(batches) if !remote => batches
                        .iter()
                        .enumerate()
                        .map(|(index, batch)| {
                            (
                                batch.id.clone(),
                                batch.source_name.clone(),
                                format!(
                                    "{} ･ {} ･ {}",
                                    self.formatted(
                                        "settings.dataImport.batchTitle",
                                        &[("number", (index + 1).to_string())]
                                    ),
                                    crate::features::page_controls::stamp(
                                        batch.imported_at,
                                        "%Y-%m-%d %H:%M"
                                    ),
                                    self.formatted(
                                        "settings.importRecordCount",
                                        &[("count", batch.total_records.to_string())]
                                    )
                                ),
                            )
                        })
                        .collect(),
                    _ => return body,
                };
                let empty = rows.is_empty();
                for (i, (id, name, summary)) in rows.into_iter().enumerate() {
                    let key = if remote {
                        "settings.backupRestoreAction"
                    } else {
                        "settings.webDavDeleteAction"
                    };
                    body = body.child(
                        row()
                            .when(i > 0, |r| line_above(r, c, 0.))
                            .child(
                                div()
                                    .flex_1()
                                    .flex()
                                    .flex_col()
                                    .gap(px(4.))
                                    .child(
                                        label(name.clone())
                                            .id(SharedString::from(format!("label-{id}"))),
                                    )
                                    .child(
                                        label(summary).text_size(px(12.)).text_color(c.secondary),
                                    ),
                            )
                            .child(
                                text_button(
                                    SharedString::from(id.clone()),
                                    self.tr(key),
                                    c,
                                    !self.busy,
                                )
                                .on_click(cx.listener(
                                    move |s, _, w, c| {
                                        if remote {
                                            s.remember_parent(w, c);
                                            s.fetch(
                                                Request::DavDownload(id.clone()),
                                                PreviewBackup,
                                                w,
                                                c,
                                            )
                                        } else {
                                            s.confirm(
                                                Request::DeleteBatch(id.clone()),
                                                Batches,
                                                "settings.dataImport.batchesTitle",
                                                name.clone(),
                                                w,
                                                c,
                                            )
                                        }
                                    },
                                )),
                            ),
                    );
                }
                if empty {
                    body = body.child(label(self.tr(if view == Remote {
                        "settings.webDavRemoteBackupsEmpty"
                    } else {
                        "settings.dataImport.batchesEmpty"
                    })));
                }
            }
            Backup => {
                body = body
                    .child(choice(
                        "settings.backupTargetLocalTitle",
                        true,
                        |s, w, cx| s.choose(Pick::Backup, w, cx),
                    ))
                    .child(choice(
                        "settings.backupTargetRemoteTitle",
                        dav_configured,
                        |s, w, cx| s.open_view(Upload, w, cx),
                    ));
            }
            Upload => {
                if let StorageReply::DavConfig(snapshot) = &self.result
                    && snapshot.has_secret
                    && let Some(target) = &snapshot.config
                {
                    let url = &target.url;
                    let dir = &target.remote_dir;
                    let username = &target.username;
                    body = body
                        .child(label(format!(
                            "{username} ･ {}{}{}",
                            url.trim_end_matches('/'),
                            "/",
                            dir.trim_start_matches('/')
                        )))
                        .child(self.input(6, "settings.webDavFileName", c));
                    actions.push(
                        button("settings.webDavUploadAction", |s, w, c| {
                            let StorageReply::DavConfig(snapshot) = &s.result else {
                                return;
                            };
                            let Some(cfg) = &snapshot.config else {
                                return;
                            };
                            s.fetch(
                                Request::DavUpload {
                                    file: s.val(6, c),
                                    url: cfg.url.clone(),
                                    username: cfg.username.clone(),
                                    directory: cfg.remote_dir.clone(),
                                },
                                Home,
                                w,
                                c,
                            )
                        })
                        .into_any_element(),
                    );
                } else {
                    body = body.child(view_button("settings.webDavConfigTitle", Dav));
                }
            }
            Restore => {
                body = body
                    .child(choice(
                        "settings.restoreSourceLocalTitle",
                        true,
                        |s, w, cx| s.choose(Pick::Restore, w, cx),
                    ))
                    .child(choice(
                        "settings.restoreSourceRemoteTitle",
                        dav_configured,
                        |s, w, cx| s.open_view(Remote, w, cx),
                    ));
            }
            PreviewBackup => {
                let StorageReply::Restore(restore) = &self.result else {
                    return body;
                };
                let preview = &restore.preview;
                body = body.child(label(self.backup_summary(preview)));
                if preview.restore_supported {
                    for (key, replace) in [
                        ("settings.restoreStrategyOptions.merge", false),
                        ("settings.restoreStrategyOptions.replace", true),
                    ] {
                        let strategy = self.btn(key, c, cx, move |s, w, c| {
                            let StorageReply::Restore(restore) = &s.result else {
                                return;
                            };
                            s.confirm(
                                Request::Restore {
                                    hash: restore.preview.hash.clone(),
                                    replace,
                                },
                                Home,
                                key,
                                format!(
                                    "{}\n{}\n{}",
                                    restore.file_path.display(),
                                    s.backup_summary(&restore.preview),
                                    s.tr(if replace {
                                        "settings.restoreStrategyOptionHints.replace"
                                    } else {
                                        "settings.restoreStrategyOptionHints.merge"
                                    })
                                ),
                                w,
                                c,
                            )
                        });
                        actions.push(strategy.control_size(ControlSize::Large).into_any_element());
                    }
                } else {
                    body = body.child(label(preview.restore_message.clone()));
                }
            }
            Dav => {
                body = body
                    .child(
                        div()
                            .flex()
                            .flex_col()
                            .flex_none()
                            .gap(px(8.))
                            .child(
                                label(self.tr("settings.webDavServerUrl"))
                                    .text_size(px(14.))
                                    .font_weight(FontWeight::BOLD),
                            )
                            .child(
                                div().flex().h(px(32.)).child(
                                    quietpro::TextInput::new("dav-server", &self.fields[0], c)
                                        .disabled(self.busy)
                                        .suffix(
                                            label(self.val(2, cx))
                                                .id("dav-directory-suffix")
                                                .accessibility_id("dav-directory-suffix")
                                                .flex_none()
                                                .max_w(px(160.))
                                                .truncate()
                                                .border_l_1()
                                                .border_color(c.border)
                                                .px(px(8.))
                                                .text_size(px(12.))
                                                .text_color(c.secondary),
                                        ),
                                ),
                            ),
                    )
                    .child(self.input(1, "settings.webDavUsername", c));
                body = body.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .child(
                            label(self.tr("settings.webDavPassword"))
                                .text_size(px(14.))
                                .font_weight(FontWeight::BOLD),
                        )
                        .child(
                            div().flex().h(px(32.)).child(
                                quietpro::TextInput::new("dav-password", &self.fields[3], c)
                                    .disabled(self.busy)
                                    .suffix(
                                        IconControl::new(
                                            "reveal-password",
                                            self.tr(if self.revealed {
                                                "common.hidePassword"
                                            } else {
                                                "common.showPassword"
                                            }),
                                            if self.revealed {
                                                Icon::EyeOff
                                            } else {
                                                Icon::Eye
                                            },
                                        )
                                        .disabled(self.busy)
                                        .action(
                                            c,
                                            cx.listener(|s, _, w, cx| s.toggle_password(w, cx)),
                                        ),
                                    ),
                            ),
                        ),
                );
                actions.push(
                    button("settings.webDavTestConnection", |s, w, c| {
                        let password = s.val(3, c);
                        s.fetch(
                            Request::DavTest {
                                url: s.val(0, c),
                                username: s.val(1, c),
                                directory: s.val(2, c),
                                password: (!s.saved_password_preview && !password.is_empty())
                                    .then_some(password),
                            },
                            Dav,
                            w,
                            c,
                        )
                    })
                    .into_any_element(),
                );
                actions.push(
                    button("common.save", |s, w, c| {
                        let password = s.val(3, c);
                        s.fetch(
                            Request::DavSave {
                                url: s.val(0, c),
                                username: s.val(1, c),
                                directory: s.val(2, c),
                                password: (!s.saved_password_preview && !password.is_empty())
                                    .then_some(password),
                            },
                            Dav,
                            w,
                            c,
                        )
                    })
                    .into_any_element(),
                );
            }
            Cleanup => {
                let choices = [7, 15, 30, 60, 90, 180];
                let index = choices
                    .iter()
                    .position(|day| *day == self.days)
                    .unwrap_or(4) as i32;
                let mut retention = settings_row().gap(px(8.)).child(
                    settings_row_label(self.tr("settings.cleanupRangeLabel"))
                        .font_weight(FontWeight::BOLD)
                        .flex_1(),
                );
                for delta in [-1, 1] {
                    if delta == 1 {
                        retention = retention
                            .child(quietpro::value_slider(
                                &self.retention,
                                self.tr("settings.cleanupRangeLabel"),
                                !self.busy,
                                c,
                                cx,
                            ))
                            .child(
                                label(patina_i18n::format_text(
                                    self.client.locale.get(),
                                    "settings.storageCleanupBefore",
                                    &[("days", self.days.to_string())],
                                ))
                                .min_w(px(48.))
                                .whitespace_nowrap()
                                .text_right(),
                            );
                    }
                    retention = retention.child(
                        IconControl::new(
                            ("retention-step", (delta + 1) as usize),
                            self.tr(if delta < 0 {
                                "settings.decreaseCleanupRange"
                            } else {
                                "settings.increaseCleanupRange"
                            }),
                            if delta < 0 { Icon::Minus } else { Icon::Plus },
                        )
                        .disabled(self.busy || !(0..=5).contains(&(index + delta)))
                        .action(
                            c,
                            cx.listener(move |s, _, w, cx| {
                                let next = (index + delta).clamp(0, 5);
                                s.days = choices[next as usize];
                                s.retention
                                    .update(cx, |slider, cx| slider.set_value(next as f32, w, cx));
                                cx.notify();
                            }),
                        ),
                    );
                }
                body = body
                    .child(label(self.tr("settings.cleanupHint")).text_color(c.secondary))
                    .child(retention);
                actions.push(
                    button("settings.cleanupNow", |s, w, c| {
                        s.confirm(
                            Request::Cleanup(s.days),
                            Home,
                            "settings.cleanupTitle",
                            String::new(),
                            w,
                            c,
                        )
                    })
                    .into_any_element(),
                );
            }
            Schedule(_) => (),
        }
        if let Schedule(backup) = view {
            let v = cx.weak_entity();
            let cadence = div()
                .flex()
                .flex_col()
                .gap(px(8.))
                .child(
                    label(self.tr("settings.storageFrequency"))
                        .text_size(px(14.))
                        .font_weight(FontWeight::BOLD),
                )
                .child(
                    quietpro::Dropdown::new(
                        "schedule-cadence",
                        self.tr("settings.storageFrequency"),
                        [
                            (false, self.tr("data.heatmapDaily")),
                            (true, self.tr("data.heatmapWeekly")),
                        ],
                        self.weekly,
                        c,
                        move |weekly, _, cx| {
                            let _ = v.update(cx, |s, cx| {
                                s.weekly = weekly;
                                cx.notify();
                            });
                        },
                    )
                    .value_typography(px(12.), FontWeight::MEDIUM)
                    .disabled(self.busy || !self.enabled),
                );
            let mut controls = div()
                .grid()
                .grid_cols(if self.weekly { 3 } else { 2 })
                .gap(px(12.))
                .child(cadence);
            if self.weekly {
                let weak = cx.weak_entity();
                let days =
                    patina_i18n::localized_data(self.client.locale.get(), "date.weekdaysShort")
                        .unwrap();
                controls = controls.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap(px(8.))
                        .child(
                            label(self.tr("export.fields.weekday.label"))
                                .font_weight(FontWeight::BOLD),
                        )
                        .child(
                            quietpro::Dropdown::new(
                                "schedule-weekday",
                                self.tr("export.fields.weekday.label"),
                                (1u8..=7).map(|i| {
                                    (i, days[(i - 1) as usize].as_str().unwrap().to_owned())
                                }),
                                self.val(5, cx).parse::<u8>().unwrap_or(1),
                                c,
                                move |day, w, cx| {
                                    let _ = weak.update(cx, |s, cx| {
                                        s.set(5, "settings.storageWeekday", &day.to_string(), w, cx)
                                    });
                                },
                            )
                            .value_typography(px(12.), FontWeight::MEDIUM)
                            .disabled(self.busy || !self.enabled),
                        ),
                );
            }
            body = body.child(controls.child(self.schedule_time(c, cx)));
            if backup {
                let v = cx.weak_entity();
                body = body.child(quietpro::slide_switch(
                    "schedule-remote",
                    self.tr("settings.backupTargetRemoteTitle"),
                    self.remote,
                    !self.busy && self.enabled,
                    c,
                    move |remote, _, _, cx| {
                        let _ = v.update(cx, |s, cx| {
                            s.remote = remote;
                            cx.notify();
                        });
                    },
                ));
            }
            if !backup || !self.remote {
                body = body.child(
                    div()
                        .flex()
                        .items_end()
                        .gap(px(12.))
                        .child(
                            self.input(6, "settings.storage.dataDirectoryLabel", c)
                                .flex_1(),
                        )
                        .child(
                            picker("settings.storage.changePathAction", Pick::ScheduleDirectory)
                                .control_size(ControlSize::Large)
                                .disabled(self.busy || !self.enabled),
                        ),
                );
            }
            body = body.children(self.schedule_status(backup, c));
            actions.push(
                self.btn("common.save", c, cx, move |s, w, c| {
                    s.schedule_save(backup, w, c)
                })
                .control_size(ControlSize::Large)
                .into_any_element(),
            );
        }
        if view != Home && actions.is_empty() {
            header_icons.push(
                IconControl::new("close-storage", self.tr("common.close"), Icon::X)
                    .disabled(self.busy)
                    .action(c, cx.listener(|s, _, w, cx| s.close(w, cx)))
                    .into_any_element(),
            );
        }
        if !header_icons.is_empty() {
            head = head.child(quietpro::icon_actions().children(header_icons));
        }
        panel = panel.child(head.flex_none());
        panel = if view == Home {
            panel.child(body)
        } else {
            panel.child(
                div()
                    .id("storage-dialog-body")
                    .min_h_0()
                    .overflow_y_scroll()
                    .child(body.flex_none()),
            )
        };
        if view == self.view && !self.busy && !self.message.is_empty() {
            panel = panel.child(
                label(self.message.clone())
                    .id("storage-status")
                    .role(Role::Status)
                    .flex_none(),
            );
        }
        if !actions.is_empty() {
            panel = panel.child(
                quietpro::dialog_actions()
                    .id("storage-dialog-actions")
                    .child(button("common.cancel", |s, w, cx| s.close(w, cx)).when(
                        matches!(view, Fields | PreviewBackup | Schedule(_)),
                        |button| button.control_size(ControlSize::Large),
                    ))
                    .children(actions),
            );
        }
        panel
    }
}

#[derive(IntoElement)]
struct FieldGroups(WeakEntity<StorageCard>);

impl RenderOnce for FieldGroups {
    fn render(self, win: &mut Window, cx: &mut App) -> impl IntoElement {
        self.0
            .update(cx, |storage, cx| {
                storage.field_groups(storage.client.palette(win), cx)
            })
            .unwrap_or_else(|_| div())
    }
}

impl View {
    fn title(self) -> &'static str {
        match self {
            Self::Home => "settings.dataSafetyTitle",
            Self::Range => "data.rangePickerTitle",
            Self::Export => "export.title",
            Self::Fields => "export.configFieldsTitle",
            Self::Import => "settings.dataImport.dialogTitle",
            Self::PreviewCsv => "settings.dataImport.previewTitle",
            Self::Batches => "settings.dataImport.batchesTitle",
            Self::Backup => "settings.backupTargetTitle",
            Self::Upload => "settings.webDavUploadTitle",
            Self::Restore => "settings.restoreSourceTitle",
            Self::PreviewBackup => "settings.backupRestoreAction",
            Self::Dav => "settings.webDavConfigTitle",
            Self::Remote => "settings.webDavRemoteBackupsTitle",
            Self::Cleanup => "settings.cleanupTitle",
            Self::Schedule(false) => "export.scheduledTitle",
            Self::Schedule(true) => "settings.storageScheduledBackup",
        }
    }
}

impl Render for StorageCard {
    fn render(&mut self, win: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let home = self.content(View::Home, win, cx).id("storage-card");
        if self.confirmation.is_some() {
            return home.child(self.confirmation_dialog(win, cx));
        }
        if self.view == View::Home {
            return home;
        }
        let dialog_view = if self.view == View::Range {
            View::Export
        } else {
            self.view
        };
        let title = self.tr(dialog_view.title());
        let form_width = (win.viewport_size().width - px(48.)).min(px(match dialog_view {
            View::Export | View::Fields => 680.,
            View::Batches => match &self.result {
                StorageReply::Batches(rows) if !rows.is_empty() => 480.,
                _ => 280.,
            },
            _ => 600.,
        }));
        let content = self
            .content(dialog_view, win, cx)
            .id("storage-dialog")
            .role(Role::Group)
            .accessibility_id("storage-dialog-surface")
            .track_focus(&self.dialog_content_focus)
            .on_key_down(cx.listener(|s, event: &KeyDownEvent, w, cx| {
                if event.keystroke.key == "escape" {
                    s.close(w, cx);
                    cx.stop_propagation();
                }
            }))
            .max_w(form_width)
            .when(
                matches!(
                    dialog_view,
                    View::Export
                        | View::Fields
                        | View::Dav
                        | View::Schedule(_)
                        | View::Batches
                        | View::Remote
                ),
                |d| d.w(form_width),
            );
        let content = if self.view == View::Range {
            content.child(self.calendar(self.client.palette(win), win, cx))
        } else {
            content
        };
        let view = cx.weak_entity();
        home.child(
            quietpro::modal_dialog(
                title,
                self.dialog_focus.clone(),
                content,
                move |w, cx| {
                    let _ = view.update(cx, |s, cx| s.close(w, cx));
                },
                cx,
            )
            .close_on_escape(false)
            .close_on_backdrop_press(!self.busy),
        )
    }
}

impl gpui_kit::EventEmitter<crate::windows::main::Feedback> for StorageCard {}

#[cfg(all(test, feature = "test-support"))]
mod feedback_tests {
    use super::{Client, Rc, Request, StorageCard, StorageInfo, StorageReply, View};
    use gpui_kit::{AppContext, TestAppContext, WindowOptions};
    use patina_desktop_protocol::{FromWindow, Reply, RequestError, WindowRequest};
    #[gpui_kit::test]
    fn backup_result_uses_only_one_toast(cx: &mut TestAppContext) {
        cx.update(gpui_kit::init);
        let (client, requests) = Client::test_connection();
        let (handle, view) = cx.update(|cx| {
            gpui_kit::open_window(WindowOptions::default(), cx, |win, cx| {
                cx.new(|cx| StorageCard::new(client.clone(), win, cx))
            })
            .unwrap()
        });
        let messages = Rc::new(std::cell::RefCell::new(Vec::new()));
        let sink = messages.clone();
        cx.update(|cx| {
            cx.subscribe(
                &view,
                move |_, event: &crate::windows::main::Feedback, _| {
                    sink.borrow_mut().push(event.0.clone())
                },
            )
            .detach()
        });
        let request_id = || {
            requests
                .try_iter()
                .find_map(|message| match message {
                    FromWindow::Request(id, request)
                        if matches!(*request, WindowRequest::Storage(_)) =>
                    {
                        Some(id)
                    }
                    _ => None,
                })
                .expect("storage request")
        };
        cx.run_until_parked();
        client.test_answer(
            request_id(),
            Reply::Storage(StorageReply::Info(StorageInfo {
                install: "fixture/install".into(),
                install_bytes: 0,
                data: None,
                default: "fixture/data".into(),
                bytes: 0,
                pending: None,
                move_error: None,
                dav: None,
            })),
        );
        cx.run_until_parked();
        assert!(messages.borrow().is_empty(), "initial load stays silent");
        for success in [true, false] {
            cx.update_window(handle, |_, win, cx| {
                view.update(cx, |card, cx| {
                    card.fetch(
                        Request::Backup("fixture/backup.zip".into()),
                        View::Backup,
                        win,
                        cx,
                    )
                })
            })
            .unwrap();
            cx.run_until_parked();
            let id = request_id();
            if success {
                client.test_answer(id, Reply::Storage(StorageReply::Done));
            } else {
                client.test_reject(id, RequestError::Rejected("disk unavailable".into()));
            }
            cx.run_until_parked();
            cx.update(|cx| {
                let card = view.read(cx);
                let expected = if success {
                    card.completed(
                        &Request::Backup("fixture/backup.zip".into()),
                        &StorageReply::Done,
                    )
                } else {
                    card.failed(
                        &Request::Backup("fixture/backup.zip".into()),
                        "disk unavailable",
                    )
                };
                assert_eq!(messages.borrow().last(), Some(&expected));
                assert!(card.message.is_empty());
            });
        }
    }
}
