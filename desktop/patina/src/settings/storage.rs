use super::*;
use chrono::{Datelike, Duration, Local, NaiveDate, TimeZone};
use gpui_kit::base::{
    Button, Dialog, DialogPopup,
    input::{InputAccessibility, InputEvent, InputState},
};
use patina_recorder::{
    ALL_EXPORT_FIELDS, DEFAULT_EXPORT_FIELDS, ExportDataRequest, StorageRequest as Request,
};
use serde_json::{Value, json};
use std::path::PathBuf;

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
    paths: Value,
    result: Value,
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
            paths: Value::Null,
            result: Value::Null,
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
        self.view = view;
    }
    fn close(&mut self, win: &mut Window, cx: &mut Context<Self>) {
        if !self.busy {
            if self.view == View::Fields {
                self.finish_fields(false, win, cx);
            } else {
                self.go(View::Home, win, cx);
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
            self.view = View::Export;
            win.focus(focus.as_ref().unwrap_or(&self.dialog_content_focus), cx);
            cx.notify();
        }
    }
    fn go(&mut self, view: View, win: &mut Window, cx: &mut Context<Self>) {
        self.message.clear();
        if self.view == View::Dav {
            self.hide_password(win, cx);
            self.set(3, "settings.webDavPassword", "", win, cx);
        }
        self.set_view(view, win, cx);
        match view {
            View::Home => self.fetch(Request::Info, view, win, cx),
            View::Batches => self.fetch(Request::Batches, view, win, cx),
            View::Dav => self.fetch(Request::DavInfo, view, win, cx),
            View::Upload => self.fetch(Request::DavInfo, view, win, cx),
            View::Remote => self.fetch(Request::DavList, view, win, cx),
            View::Schedule(backup) => self.fetch(Request::Schedule { backup }, view, win, cx),
            View::Export => {
                let today = Local::now().date_naive().to_string();
                self.set(4, "native.export.field.start_time", &today, win, cx);
                self.set(5, "native.export.field.end_time", &today, win, cx);
            }
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
        if !self.val(3, cx).is_empty() || self.result["hasSecret"] != true {
            self.fields[3].update(cx, |f, cx| {
                f.set_masked(false, win, cx);
                f.set_scroll_offset(point(px(0.), px(0.)), cx);
            });
            self.revealed = true;
            cx.notify();
            return;
        }
        let Ok(hwnd) = crate::dock::hwnd(win) else {
            return;
        };
        let read = self
            .client
            .request::<Option<String>>(Query::Storage(Request::DavReveal(hwnd.0 as usize)));
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
                    Err(e) => s.message = e,
                    _ => (),
                }
                c.notify();
            });
        })
        .detach();
    }
    fn fetch(&mut self, req: Request, next: View, win: &mut Window, cx: &mut Context<Self>) {
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
                | Request::SaveSchedule { .. }
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
        let request = self.client.request::<Value>(Query::Storage(req));
        cx.spawn_in(win, async move |v, cx| {
            let response = request.await;
            let _ = v.update_in(cx, |s, win, cx| {
                s.busy = false;
                match response {
                    Err(e) => {
                        s.message = match e.as_str() {
                            "remote_name_conflict" => s.tr("settings.webDavNameConflict"),
                            "webdav_invalid_file_name" => s.tr("settings.webDavInvalidFileName"),
                            "webdav_config_changed" => s.tr("settings.webDavTargetChanged"),
                            _ => e,
                        };
                    }
                    Ok(data) => {
                        if testing {
                            s.message = s.tr("settings.webDavTestConnection") + " ✓";
                            cx.notify();
                            return;
                        }
                        if converted && let Some(path) = data["outputPath"].as_str() {
                            s.fetch(Request::PreviewCsv(path.into()), View::PreviewCsv, win, cx);
                            return;
                        }
                        if s.view == View::Dav {
                            s.hide_password(win, cx);
                            s.set(3, "settings.webDavPassword", "", win, cx);
                        }
                        s.set_view(next, win, cx);
                        if info {
                            s.paths = data.clone();
                        }
                        if next == View::Upload {
                            s.set(
                                6,
                                "settings.webDavFileName",
                                &format!("Patina-{}.zip", Local::now().format("%Y%m%d-%H%M%S")),
                                win,
                                cx,
                            );
                        }
                        if next == View::Dav {
                            for (i, key, k) in [
                                (0, "settings.webDavServerUrl", "url"),
                                (1, "settings.webDavUsername", "username"),
                                (2, "settings.webDavDirectory", "remoteDir"),
                            ] {
                                s.set(
                                    i,
                                    key,
                                    data["config"][k].as_str().unwrap_or(if i == 2 {
                                        "/Patina"
                                    } else {
                                        ""
                                    }),
                                    win,
                                    cx,
                                );
                            }
                        }
                        if let View::Schedule(b) = next {
                            let cfg = &data["config"];
                            s.enabled = cfg["enabled"].as_bool().unwrap_or(false);
                            s.weekly = cfg["cadence"] == "weekly";
                            s.remote = b && cfg["target"]["kind"] == "webdav";
                            let mins = cfg["localTimeMinutes"].as_u64().unwrap_or(1260);
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
                                &cfg["weekday"].as_u64().unwrap_or(1).to_string(),
                                win,
                                cx,
                            );
                            s.set(
                                6,
                                "settings.storage.dataDirectoryLabel",
                                cfg["targetDir"]
                                    .as_str()
                                    .or(cfg["target"]["targetDir"].as_str())
                                    .or(data["defaultLocalTargetDir"].as_str())
                                    .unwrap_or_default(),
                                win,
                                cx,
                            );
                            if !b {
                                s.format = match cfg["format"].as_str() {
                                    Some("markdown") => "markdown",
                                    Some("sqlite") => "sqlite",
                                    Some("parquet") => "parquet",
                                    _ => "csv",
                                };
                                s.columns = cfg["selectedFields"]
                                    .as_array()
                                    .into_iter()
                                    .flatten()
                                    .filter_map(Value::as_str)
                                    .map(str::to_owned)
                                    .collect();
                            }
                        }
                        s.message = if upload && data["indexUpdated"] == false {
                            data["indexMessage"]
                                .as_str()
                                .unwrap_or("WebDAV index update failed")
                                .into()
                        } else if moved {
                            s.tr("settings.storageMovePending")
                        } else if finished {
                            s.tr("common.saved")
                        } else if info {
                            s.message.clone()
                        } else {
                            String::new()
                        };
                        s.result = data;
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
        let ext = if matches!(pick, Pick::Backup) {
            "zip"
        } else {
            match self.format {
                "markdown" => "md",
                other => other,
            }
        };
        let suggested = format!("Patina-{}.{ext}", Local::now().format("%Y-%m-%d"));
        let save_picker = save.then(|| cx.prompt_for_new_path(&root, Some(&suggested)));
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
                let p = path.to_string_lossy().into_owned();
                match pick {
                    Pick::Move => s.confirm(
                        Request::Move(Some(path)),
                        View::Home,
                        "settings.storage.storageDataMigrationConfirmTitle",
                        p,
                        win,
                        cx,
                    ),
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
        let answer = win.prompt(
            PromptLevel::Warning,
            &self.tr(key),
            Some(&detail),
            &[
                self.tr("common.cancel").as_str(),
                self.tr("common.confirm").as_str(),
            ],
            cx,
        );
        self.busy = true;
        cx.notify();
        cx.spawn_in(win, async move |v, cx| {
            let ok = answer.await == Ok(1);
            let _ = v.update_in(cx, |s, w, c| {
                s.busy = false;
                if ok {
                    s.fetch(req, next, w, c)
                }
                c.notify()
            });
        })
        .detach();
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
            .child(label(self.tr(key)).text_size(px(14.)))
            .child(
                div().flex().h(px(32.)).child(
                    quietpro::TextInput::new(("storage-input", i), &self.fields[i], c)
                        .disabled(self.busy),
                ),
            )
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
        let mut input = json!({"enabled":self.enabled,"cadence":if self.weekly{"weekly"}else{"daily"},"weekday":if self.weekly{weekday}else{None},"localTimeMinutes":time.hour()*60+time.minute()});
        if b {
            input["target"] = if self.remote {
                json!({"kind":"webdav"})
            } else {
                json!({"kind":"local","targetDir":self.val(6,cx)})
            };
        } else {
            input["targetDir"] = json!(self.val(6, cx));
            input["format"] = json!(self.format);
            input["selectedFields"] = json!(self.columns);
        }
        self.fetch(
            Request::SaveSchedule { backup: b, input },
            View::Schedule(b),
            w,
            cx,
        )
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
                    heading(title.clone())
                        .id("field-group-title")
                        .text_size(px(14.))
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
                            "{} · {title}",
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
                            "{} · {title}",
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
                .p(px(12.))
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
        let go = |key, next| self.btn(key, c, cx, move |s, w, c| s.go(next, w, c));
        let picker = |key, pick| self.btn(key, c, cx, move |s, w, c| s.choose(pick, w, c));
        let button =
            |key, f: fn(&mut Self, &mut Window, &mut Context<Self>)| self.btn(key, c, cx, f);
        let choice = |key: &'static str, f: fn(&mut Self, &mut Window, &mut Context<Self>)| {
            quietpro::choice_entry(key, self.tr(key), !self.busy, c)
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
        if view == Export || view == Import || view == Backup {
            let (key, next, icon) = match view {
                Export => ("export.scheduledTitle", Schedule(false), Icon::Clock),
                Import => ("settings.dataImport.batchesTitle", Batches, Icon::Trash),
                _ => (
                    "settings.storageScheduledBackup",
                    Schedule(true),
                    Icon::Clock,
                ),
            };
            header_icons.push(
                IconControl::new("storage-header-action", self.tr(key), icon)
                    .disabled(self.busy)
                    .action(c, cx.listener(move |s, _, w, cx| s.go(next, w, cx)))
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
                let wide = crate::main_window::page_width(win.viewport_size().width) >= px(680.);
                let subhead = |key| {
                    heading(self.tr(key))
                        .aria_level(3)
                        .text_size(px(14.))
                        .line_height(px(20.))
                };
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
                let entry = |key, view| {
                    settings_row()
                        .justify_between()
                        .gap(px(8.))
                        .child(label(self.tr(key)))
                        .child(go(key, view))
                };
                let portable = settings_rows_card(c).child(pair(
                    entry("settings.dataExportAction", Export),
                    entry("settings.dataImportAction", Import),
                ));
                let config = &self.paths["dav"];
                let dav = row()
                    .child(label(self.tr("settings.webDavConfigTitle")).flex_1())
                    .child(
                        text_button(
                            "dav-test",
                            self.tr("settings.webDavTestConnection"),
                            c,
                            !self.busy && config.is_object(),
                        )
                        .on_click(cx.listener(|s, _, w, cx| {
                            let config = &s.paths["dav"];
                            s.fetch(
                                Request::DavTest {
                                    url: config["url"].as_str().unwrap_or_default().into(),
                                    username: config["username"]
                                        .as_str()
                                        .unwrap_or_default()
                                        .into(),
                                    directory: config["remoteDir"]
                                        .as_str()
                                        .unwrap_or_default()
                                        .into(),
                                    password: None,
                                },
                                Home,
                                w,
                                cx,
                            );
                        })),
                    )
                    .child(go("settings.webDavEdit", Dav))
                    .child(
                        text_button(
                            "dav-delete",
                            self.tr("settings.webDavDeleteAction"),
                            c,
                            !self.busy && config.is_object(),
                        )
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
                        .disabled(self.busy)
                        .action(c, cx.listener(|s, _, w, cx| s.go(Home, w, cx))),
                    );
                let directory = |key, id: &'static str| {
                    let name = self.tr(key);
                    let path = self.paths[id].as_str().map(PathBuf::from);
                    let mut dir = settings_row()
                        .min_w_0()
                        .gap(px(4.))
                        .child(label(name.clone()));
                    if id == "data"
                        && let Some(bytes) = self.paths["bytes"].as_u64()
                    {
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
                                "{} · {}",
                                self.tr("settings.storage.openDirectoryAction"),
                                name
                            ),
                            Icon::FolderOpen,
                        )
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
                            .disabled(self.busy)
                            .action(c, cx.listener(|s, _, w, cx| s.choose(Pick::Move, w, cx))),
                        );
                        actions = actions.child(
                            IconControl::new(
                                "data-cleanup",
                                self.tr("settings.cleanupTitle"),
                                Icon::Trash,
                            )
                            .disabled(self.busy)
                            .action(c, cx.listener(|s, _, w, cx| s.go(Cleanup, w, cx))),
                        );
                        if self.paths["data"] != self.paths["default"]
                            || self.paths["pending"].is_string()
                        {
                            actions = actions.child(
                                IconControl::new(
                                    "restore-data-path",
                                    self.tr("settings.storage.restoreDefaultPathAction"),
                                    Icon::RotateCcw,
                                )
                                .disabled(self.busy)
                                .action(
                                    c,
                                    cx.listener(|s, _, w, cx| {
                                        s.confirm(
                                            Request::Move(None),
                                            Home,
                                            "settings.storage.restoreDefaultPathAction",
                                            s.paths["default"].as_str().unwrap_or_default().into(),
                                            w,
                                            cx,
                                        )
                                    }),
                                ),
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
                    .gap(px(SUBHEADING_GAP))
                    .child(section(
                        div().child(subhead("settings.dataExportTitle")),
                        portable,
                    ))
                    .child(section(
                        div().child(subhead("settings.backupRestoreTitle")),
                        backups,
                    ))
                    .child(section(dir_head, directories));
                for (field, key) in [
                    ("pending", "settings.storageMovePending"),
                    ("moveError", "settings.storage.storageMigrationFailed"),
                ] {
                    if let Some(detail) = self.paths[field].as_str() {
                        body = body.child(label(format!("{} · {detail}", self.tr(key))));
                    }
                }
            }
            Export => {
                let mut ranges = row();
                for (idx, key) in [
                    "export.timeRangeModeDay",
                    "export.timeRangeModeWeek",
                    "export.timeRangeModeMonth",
                    "export.timeRangeModeYear",
                ]
                .into_iter()
                .enumerate()
                {
                    ranges = ranges.child(self.btn(key, c, cx, move |s, w, cx| {
                        let end = Local::now().date_naive();
                        let start = match idx {
                            0 => end,
                            1 => {
                                end - Duration::days(i64::from(
                                    end.weekday().num_days_from_monday(),
                                ))
                            }
                            2 => end.with_day(1).unwrap(),
                            _ => end.with_ordinal(1).unwrap(),
                        };
                        s.set(
                            4,
                            "native.export.field.start_time",
                            &start.to_string(),
                            w,
                            cx,
                        );
                        s.set(5, "native.export.field.end_time", &end.to_string(), w, cx);
                        cx.notify();
                    }));
                }
                let mut range = content_card(c.border, c.panel)
                    .gap(px(12.))
                    .flex_none()
                    .id("export-time-range")
                    .child(
                        div()
                            .flex()
                            .flex_wrap()
                            .items_center()
                            .justify_between()
                            .gap(px(8.))
                            .child(heading(self.tr("export.timeRangeLabel")).text_size(px(14.)))
                            .child(ranges),
                    );
                range = range.child(
                    div()
                        .grid()
                        .grid_cols(2)
                        .gap(px(12.))
                        .child(self.input(4, "native.export.field.start_time", c))
                        .child(self.input(5, "native.export.field.end_time", c)),
                );
                body = body.child(range);

                let options = [
                    ("csv", "CSV"),
                    ("markdown", "Markdown"),
                    ("parquet", "Parquet"),
                    ("sqlite", "SQLite"),
                ];
                let weak = cx.weak_entity();
                let formats = quietpro::segmented::<_, 4>(
                    "export-format",
                    self.tr("export.formatLabel"),
                    std::array::from_fn(|i| {
                        (
                            options[i].0,
                            options[i].1.to_owned(),
                            None,
                            self.format_focus[i].clone(),
                        )
                    }),
                    self.format,
                    !self.busy,
                    c,
                    move |format, _, cx| {
                        let _ = weak.update(cx, |s, cx| {
                            s.format = format;
                            cx.notify();
                        });
                    },
                );
                body = body
                    .child(
                        content_card(c.border, c.panel).flex_none().child(
                            div()
                                .flex()
                                .items_center()
                                .justify_between()
                                .gap(px(12.))
                                .child(
                                    heading(self.tr("export.formatLabel"))
                                        .text_size(px(14.))
                                        .flex_1(),
                                )
                                .child(formats),
                        ),
                    )
                    .child(
                        content_card(c.border, c.panel).flex_none().child(
                            row()
                                .justify_between()
                                .child(
                                    div()
                                        .flex()
                                        .flex_col()
                                        .gap(px(4.))
                                        .child(
                                            heading(self.tr("export.fieldsSectionTitle"))
                                                .text_size(px(14.)),
                                        )
                                        .child(
                                            label(format!(
                                                "{} / {}",
                                                self.columns.len(),
                                                ALL_EXPORT_FIELDS.len()
                                            ))
                                            .text_size(px(12.))
                                            .text_color(c.secondary),
                                        ),
                                )
                                .child(
                                    button("export.configFields", |s, w, cx| {
                                        s.expanded_field_groups = [false; 6];
                                        s.field_draft = Some((s.columns.clone(), w.focused(cx)));
                                        s.set_view(Fields, w, cx);
                                        cx.notify();
                                    })
                                    .track_focus(&self.fields_trigger),
                                ),
                        ),
                    );
                actions.push(picker("settings.dataExportAction", Pick::Export).into_any_element());
            }
            Fields => {
                body = body.child(FieldGroups(cx.weak_entity()));
                actions.push(
                    text_button(
                        "confirm-fields",
                        self.tr("common.confirm"),
                        c,
                        !self.busy && !self.columns.is_empty(),
                    )
                    .on_click(cx.listener(|s, _, w, cx| s.finish_fields(true, w, cx)))
                    .into_any_element(),
                );
            }
            Import => {
                body = body
                    .child(choice("settings.dataImport.csvTitle", |s, w, cx| {
                        s.choose(Pick::Csv, w, cx)
                    }))
                    .child(choice(
                        "settings.dataImport.destructureTitle",
                        |s, w, cx| s.choose(Pick::Convert, w, cx),
                    ));
            }
            PreviewCsv => {
                body = body.child(label(
                    self.result["fileName"].as_str().unwrap_or_default().into(),
                ));
                for (key, field) in [
                    ("settings.dataImport.exactLabel", "exactSessions"),
                    ("settings.dataImport.hourLabel", "hourBuckets"),
                    ("settings.dataImport.duplicateLabel", "duplicateRecords"),
                    ("settings.dataImport.errorLabel", "errorRecords"),
                ] {
                    body = body.child(label(format!("{} · {}", self.tr(key), self.result[field])));
                }
                if self.result["validRecords"].as_u64().unwrap_or(0)
                    > self.result["duplicateRecords"].as_u64().unwrap_or(0)
                {
                    actions.push(
                        button("settings.dataImportAction", |s, w, c| {
                            let p = &s.result;
                            s.fetch(
                                Request::Import {
                                    path: p["filePath"].as_str().unwrap_or_default().into(),
                                    fingerprint: p["fileFingerprint"]
                                        .as_str()
                                        .unwrap_or_default()
                                        .into(),
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
                for (i, item) in self.result.as_array().into_iter().flatten().enumerate() {
                    let remote = view == Remote;
                    let name = item[if remote { "fileName" } else { "sourceName" }]
                        .as_str()
                        .unwrap_or_default()
                        .to_owned();
                    let id = item["id"].as_str().unwrap_or_default().to_owned();
                    let key = if remote {
                        "settings.backupRestoreAction"
                    } else {
                        "settings.webDavDeleteAction"
                    };
                    body = body.child(
                        row()
                            .when(i > 0, |r| line_above(r, c, 0.))
                            .child(
                                label(name.clone())
                                    .id(SharedString::from(format!("label-{id}")))
                                    .flex_1(),
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
                                            s.fetch(
                                                Request::DavDownload(id.clone()),
                                                PreviewBackup,
                                                w,
                                                c,
                                            )
                                        } else {
                                            s.confirm(
                                                Request::DeleteBatch(id.clone()),
                                                Home,
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
                if self.result.as_array().is_some_and(Vec::is_empty) {
                    body = body.child(label(self.tr(if view == Remote {
                        "settings.webDavRemoteBackupsEmpty"
                    } else {
                        "settings.dataImport.batchesEmpty"
                    })));
                }
            }
            Backup => {
                body = body
                    .child(choice("settings.backupTargetLocalTitle", |s, w, cx| {
                        s.choose(Pick::Backup, w, cx)
                    }))
                    .child(choice("settings.backupTargetRemoteTitle", |s, w, cx| {
                        s.go(Upload, w, cx)
                    }));
            }
            Upload => {
                if self.result["hasSecret"] == true {
                    let target = &self.result["config"];
                    let url = target["url"].as_str().unwrap_or_default();
                    let dir = target["remoteDir"].as_str().unwrap_or_default();
                    let username = target["username"].as_str().unwrap_or_default();
                    body = body
                        .child(label(format!(
                            "{username} · {}{}{}",
                            url.trim_end_matches('/'),
                            "/",
                            dir.trim_start_matches('/')
                        )))
                        .child(self.input(6, "settings.webDavFileName", c));
                    actions.push(
                        button("settings.webDavUploadAction", |s, w, c| {
                            let cfg = &s.result["config"];
                            s.fetch(
                                Request::DavUpload {
                                    file: s.val(6, c),
                                    url: cfg["url"].as_str().unwrap_or_default().into(),
                                    username: cfg["username"].as_str().unwrap_or_default().into(),
                                    directory: cfg["remoteDir"].as_str().unwrap_or_default().into(),
                                },
                                Home,
                                w,
                                c,
                            )
                        })
                        .into_any_element(),
                    );
                } else {
                    body = body.child(go("settings.webDavConfigTitle", Dav));
                }
            }
            Restore => {
                body = body
                    .child(choice("settings.restoreSourceLocalTitle", |s, w, cx| {
                        s.choose(Pick::Restore, w, cx)
                    }))
                    .child(choice("settings.restoreSourceRemoteTitle", |s, w, cx| {
                        s.go(Remote, w, cx)
                    }));
            }
            PreviewBackup => {
                let preview = &self.result;
                body = body.child(label(format!(
                    "{} · {} · {} {}",
                    preview["app_version"].as_str().unwrap_or_default(),
                    crate::page_controls::stamp(
                        preview["exported_at_ms"].as_i64().unwrap_or(0),
                        "%Y-%m-%d %H:%M"
                    ),
                    self.tr("settings.dataImport.exactLabel"),
                    preview["session_count"]
                )));
                if preview["restore_supported"] == true {
                    let mut strategies = row();
                    for (key, replace) in [
                        ("settings.restoreStrategyOptions.merge", false),
                        ("settings.restoreStrategyOptions.replace", true),
                    ] {
                        strategies = strategies.child(self.btn(key, c, cx, move |s, w, c| {
                            s.confirm(
                                Request::Restore {
                                    hash: s.result["hash"].as_str().unwrap_or_default().into(),
                                    replace,
                                },
                                Home,
                                key,
                                s.tr(if replace {
                                    "settings.restoreStrategyOptionHints.replace"
                                } else {
                                    "settings.restoreStrategyOptionHints.merge"
                                }),
                                w,
                                c,
                            )
                        }));
                    }
                    actions.push(strategies.into_any_element());
                } else {
                    body = body.child(label(
                        preview["restore_message"]
                            .as_str()
                            .unwrap_or_default()
                            .into(),
                    ));
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
                            .child(label(self.tr("settings.webDavServerUrl")).text_size(px(14.)))
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
                        .child(label(self.tr("settings.webDavPassword")).text_size(px(14.)))
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
                let mut retention =
                    row().child(label(self.tr("settings.cleanupRangeLabel")).flex_1());
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
                                label(patina_recorder::format_text(
                                    self.client.locale.get(),
                                    "settings.storageCleanupBefore",
                                    &[("days", self.days.to_string())],
                                ))
                                .min_w(px(64.))
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
                            format!("{} · {} d", s.tr("settings.cleanupRangeLabel"), s.days),
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
                .child(label(self.tr("settings.storageFrequency")).text_size(px(14.)))
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
                    .disabled(self.busy),
                );
            let mut controls = div()
                .grid()
                .grid_cols(if self.weekly { 3 } else { 2 })
                .gap(px(12.))
                .child(cadence);
            if self.weekly {
                controls = controls.child(self.input(5, "settings.storageWeekday", c));
            }
            body = body.child(controls.child(self.input(4, "settings.storageTime", c)));
            if backup {
                let v = cx.weak_entity();
                body = body.child(quietpro::slide_switch(
                    "schedule-remote",
                    self.tr("settings.backupTargetRemoteTitle"),
                    self.remote,
                    !self.busy,
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
                        .child(picker(
                            "settings.storage.changePathAction",
                            Pick::ScheduleDirectory,
                        )),
                );
            }
            actions.push(
                self.btn("common.save", c, cx, move |s, w, c| {
                    s.schedule_save(backup, w, c)
                })
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
        if view == self.view
            && (self.busy || !self.message.is_empty())
            && !(matches!(view, Import | Backup | Restore) && self.busy)
        {
            panel = panel.child(
                label(if self.busy {
                    self.tr("common.loading")
                } else {
                    self.message.clone()
                })
                .id("storage-status")
                .role(Role::Status)
                .flex_none(),
            );
        }
        if !actions.is_empty() {
            panel = panel.child(
                div()
                    .id("storage-dialog-actions")
                    .flex()
                    .flex_wrap()
                    .flex_none()
                    .items_center()
                    .justify_end()
                    .gap(px(8.))
                    .pt(px(4.))
                    .child(button("common.cancel", |s, w, cx| s.close(w, cx)))
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
        if self.view == View::Home {
            return home;
        }
        let title = self.tr(self.view.title());
        let form_width = (win.viewport_size().width - px(48.)).min(px(
            if matches!(self.view, View::Export | View::Fields) {
                760.
            } else {
                600.
            },
        ));
        let content = self
            .content(self.view, win, cx)
            .id("storage-dialog")
            .role(Role::Group)
            .accessibility_id("storage-dialog-surface")
            .track_focus(&self.dialog_content_focus)
            .max_w(form_width)
            .when(
                matches!(
                    self.view,
                    View::Export
                        | View::Fields
                        | View::Dav
                        | View::Schedule(_)
                        | View::Batches
                        | View::Remote
                ),
                |d| d.w(form_width),
            )
            .on_key_down(cx.listener(|s, e: &KeyDownEvent, w, cx| {
                if e.keystroke.key == "escape" {
                    s.close(w, cx);
                    cx.stop_propagation();
                }
            }));
        let view = cx.weak_entity();
        home.child(
            Dialog::new(cx)
                .focus_handle(self.dialog_focus.clone())
                .accessibility_label(title)
                .on_ok(|_, _, _| false)
                .close_on_escape(false)
                .close_on_backdrop_press(!self.busy)
                .backdrop(quietpro::dialog_backdrop())
                .popup(DialogPopup::new().child(content))
                .on_open_change(move |open, _, w, cx| {
                    if !open {
                        let _ = view.update(cx, |s, cx| s.close(w, cx));
                    }
                }),
        )
    }
}
