use patina_activity::{NativeToolData, TaskKind};
use patina_desktop_protocol::tools::{Notice, NoticeContext, NoticeTarget};
use patina_plugin_host::{Capability, Host, now_ms};
use std::collections::{BTreeMap, BTreeSet};

mod legacy;

fn context(n: &Notice) -> NoticeContext {
    let target = if let Some(id) = n.source {
        if n.usage {
            NoticeTarget::Usage(id)
        } else {
            NoticeTarget::Reminder(id)
        }
    } else if let Some((kind, id, revision)) = &n.focus_task {
        NoticeTarget::Focus {
            kind: kind.clone(),
            id: *id,
            revision: *revision,
        }
    } else {
        NoticeTarget::Timer
    };
    NoticeContext {
        target,
        label: n.label.clone(),
        at_ms: n.at_ms,
        local_time: chrono::DateTime::from_timestamp_millis(n.at_ms)
            .map(|t| {
                t.with_timezone(&chrono::Local)
                    .format("%Y-%m-%d %H:%M")
                    .to_string()
            })
            .unwrap_or_default(),
    }
}

#[derive(Default)]
pub(super) struct ToolEvents {
    usage: BTreeMap<(String, i64), Notice>,
    pub next_usage: Option<i64>,
    announced: BTreeSet<(String, Option<i64>, bool, i64)>,
    assignment: Option<(
        String,
        Option<i64>,
        bool,
        i64,
        patina_activity::NoticePreferences,
    )>,
}

impl ToolEvents {
    fn current_usage(
        &self,
        storage: &NativeToolData,
        id: &str,
        now: i64,
    ) -> Result<Vec<i64>, String> {
        let pending = self
            .usage
            .iter()
            .filter(|((owner, _), _)| owner == id)
            .map(|((_, rule), n)| (*rule, n.at_ms))
            .collect();
        storage
            .plugin_tasks(id, TaskKind::Reminders)?
            .reminders()
            .current_usage(&pending, now)
    }
    pub fn delivery(
        &mut self,
        host: &Host,
        storage: &NativeToolData,
    ) -> Result<Option<bool>, String> {
        let Some(n) = self.list(host, storage)?.into_iter().next() else {
            self.assignment = None;
            return Ok(None);
        };
        if !self.assignment.as_ref().is_some_and(|(g, s, u, t, _)| {
            g == &n.generation && *s == n.source && *u == n.usage && *t == n.at_ms
        }) {
            self.assignment = Some((
                n.generation,
                n.source,
                n.usage,
                n.at_ms,
                storage.preferences()?,
            ));
        }
        Ok(self
            .assignment
            .as_ref()
            .map(|(_, _, _, _, p)| p.delivery == patina_activity::NoticeDelivery::Dialog))
    }
    pub fn evaluate(&mut self, host: &Host, storage: &NativeToolData) -> Result<bool, String> {
        self.usage.retain(|(id, _), n| {
            host.bound_installation(id).is_some_and(|t| {
                t.generation == n.generation
                    && t.manifest.capabilities.contains(&Capability::Reminders)
            })
        });
        let now = now_ms();
        self.next_usage = None;
        let mut changed = false;
        for tool in host.providers(Capability::Reminders) {
            let id = &tool.manifest.id;
            let pending = self.current_usage(storage, id, now)?;
            let evaluation = storage
                .plugin_tasks(id, TaskKind::Reminders)?
                .reminders()
                .usage(now, &pending)?;
            self.usage.retain(|(owner, rule), _| {
                owner != id || (pending.contains(rule) && evaluation.watched.contains(rule))
            });
            self.next_usage = self.next_usage.into_iter().chain(evaluation.next).min();
            changed |= !evaluation.alerts.is_empty();
            for (source, label) in evaluation.alerts {
                self.usage.insert(
                    (id.clone(), source),
                    Notice {
                        id: id.clone(),
                        generation: tool.generation.clone(),
                        at_ms: now,
                        label,
                        content: None,
                        source: Some(source),
                        usage: true,
                        focus_task: None,
                    },
                );
            }
        }
        Ok(changed)
    }

    pub fn list(&self, host: &Host, storage: &NativeToolData) -> Result<Vec<Notice>, String> {
        let mut items = Vec::new();
        for n in host.notices() {
            let bound = host.bound_installation(&n.id);
            let has = |c| {
                bound
                    .as_ref()
                    .is_some_and(|t| t.manifest.capabilities.contains(&c))
            };
            let focus_task = n.task.filter(|_| has(Capability::Focus));
            if let Some((kind, task, rev)) = &focus_task {
                if !storage
                    .plugin_tasks(&n.id, TaskKind::Focus)?
                    .focus()
                    .current_focus(kind, *task, *rev)?
                {
                    continue;
                }
            } else if has(Capability::Reminders) {
                continue;
            }
            items.push(Notice {
                id: n.id,
                generation: n.generation,
                at_ms: n.at_ms,
                label: n.label,
                content: None,
                source: None,
                usage: false,
                focus_task,
            });
        }
        for tool in host.providers(Capability::Reminders) {
            let id = &tool.manifest.id;
            for (source, at_ms, label) in storage
                .plugin_tasks(id, TaskKind::Reminders)?
                .reminders()
                .pending()?
            {
                items.push(Notice {
                    id: id.clone(),
                    generation: tool.generation.clone(),
                    at_ms,
                    label,
                    content: None,
                    source: Some(source),
                    usage: false,
                    focus_task: None,
                });
            }
            for rule in self.current_usage(storage, id, now_ms())? {
                if let Some(n) = self
                    .usage
                    .get(&(id.clone(), rule))
                    .filter(|n| n.generation == tool.generation)
                {
                    items.push(n.clone());
                }
            }
        }
        items.sort_by_key(|n| (n.at_ms, n.source));
        Ok(items)
    }

    pub fn for_display(
        &self,
        host: &mut Host,
        storage: &NativeToolData,
        locale: &str,
    ) -> Result<Vec<Notice>, String> {
        let mut items = self.list(host, storage)?;
        for item in &mut items {
            let notice = context(item);
            item.content = Some(
                host.describe_notice(&item.id, &item.generation, &notice, locale)?
                    .unwrap_or_else(|| legacy::content(&notice, locale)),
            );
        }
        Ok(items)
    }

    fn current(
        &self,
        n: &Notice,
        host: &Host,
        storage: &NativeToolData,
    ) -> Result<Vec<Notice>, String> {
        let items = self.list(host, storage)?;
        if items.iter().any(|v| {
            v.generation == n.generation
                && v.id == n.id
                && v.source == n.source
                && v.at_ms == n.at_ms
                && v.usage == n.usage
        }) {
            Ok(items)
        } else {
            Err("Notification is no longer current".into())
        }
    }

    pub fn present(
        &mut self,
        n: &Notice,
        host: &Host,
        storage: &NativeToolData,
    ) -> Result<(), String> {
        let key = |n: &Notice| (n.generation.clone(), n.source, n.usage, n.at_ms);
        let active: BTreeSet<_> = self.current(n, host, storage)?.iter().map(key).collect();
        self.announced.retain(|k| active.contains(k));
        if !self.announced.contains(&key(n)) {
            let Some((g, s, u, t, p)) = &self.assignment else {
                return Err("Notification is not assigned".into());
            };
            if g != &n.generation || *s != n.source || *u != n.usage || *t != n.at_ms {
                return Err("Notification assignment changed".into());
            }
            NativeToolData::play(p.sound);
            self.announced.insert(key(n));
        }
        Ok(())
    }

    pub fn acknowledge(
        &mut self,
        n: &Notice,
        choice: &str,
        host: &mut Host,
        storage: &NativeToolData,
        locale: &str,
    ) -> Result<(), String> {
        let items = self.current(n, host, storage)?;
        let n = items
            .into_iter()
            .find(|v| {
                v.id == n.id
                    && v.generation == n.generation
                    && v.source == n.source
                    && v.usage == n.usage
                    && v.at_ms == n.at_ms
            })
            .ok_or("Notification changed")?;
        if host.apply_notice_action(&n.id, &n.generation, context(&n), choice, locale)? {
            if let Some(id) = n.source
                && n.usage
            {
                self.usage.remove(&(n.id, id));
            }
            return Ok(());
        }
        if let Some(id) = n.source {
            if n.usage {
                if choice != "dismiss" {
                    storage.plugin_tasks(&n.id,TaskKind::Reminders)?.reminders().apply(serde_json::json!({"kind":"extend","id":id,"at":n.at_ms,"extension":choice}),now_ms())?;
                }
                self.usage.remove(&(n.id.clone(), id));
            } else {
                let delay = match choice {
                    "dismiss" => None,
                    "5" => Some(5),
                    "15" => Some(15),
                    "30" => Some(30),
                    _ => return Err("Invalid reminder action".into()),
                };
                storage.plugin_tasks(&n.id,TaskKind::Reminders)?.reminders().apply(
                    serde_json::json!({"kind":"confirm","id":id,"fired_at":n.at_ms,"delay":delay}),
                    now_ms(),
                )?;
                host.dispatch_panel_event(&n.id, &n.generation, None, locale)?;
            }
            Ok(())
        } else {
            if choice == "start" {
                let (kind, id, rev) = n.focus_task.as_ref().ok_or("No task assigned")?;
                storage.plugin_tasks(&n.id,TaskKind::Focus)?.focus().apply(serde_json::json!({"kind":kind,"action":{"kind":"start_next","id":id,"expectedUpdatedAt":rev}}),now_ms())?;
                host.dispatch_panel_event(&n.id, &n.generation, None, locale)?;
            } else if choice != "dismiss" {
                return Err("Invalid notification action".into());
            }
            host.acknowledge(&n.id, &n.generation, n.at_ms)
        }
    }
}
