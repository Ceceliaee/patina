use patina_activity::NativeToolData;
use patina_desktop_protocol::tools::Notice;
use patina_plugin_host::{Host, now_ms};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Default)]
pub(super) struct ToolEvents {
    usage: BTreeMap<i64, Notice>,
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
    fn current_usage(&self, storage: &NativeToolData, now: i64) -> Result<Vec<i64>, String> {
        storage.reminders().current_usage(
            &self.usage.iter().map(|(id, n)| (*id, n.at_ms)).collect(),
            now,
        )
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
        let Some(tool) = host.bound_installation("patina.reminders") else {
            self.usage.clear();
            self.next_usage = None;
            return Ok(false);
        };
        self.usage.retain(|_, n| n.generation == tool.generation);
        let now = now_ms();
        let pending = self.current_usage(storage, now)?;
        self.usage.retain(|id, _| pending.contains(id));
        let evaluation = storage.reminders().usage(now, &pending)?;
        self.usage.retain(|id, _| evaluation.watched.contains(id));
        self.next_usage = evaluation.next;
        let changed = !evaluation.alerts.is_empty();
        for (source, label) in evaluation.alerts {
            self.usage.insert(
                source,
                Notice {
                    id: tool.manifest.id.clone(),
                    generation: tool.generation.clone(),
                    at_ms: now,
                    label,
                    source: Some(source),
                    usage: true,
                    focus_task: None,
                },
            );
        }
        Ok(changed)
    }

    pub fn list(&self, host: &Host, storage: &NativeToolData) -> Result<Vec<Notice>, String> {
        let mut items: Vec<_> = host
            .notices()
            .into_iter()
            .map(|n| Notice {
                focus_task: if n.id == "patina.focus"
                    && host
                        .bound_installation(&n.id)
                        .is_some_and(|t| t.generation == n.generation)
                {
                    n.task
                } else {
                    None
                },
                id: n.id,
                generation: n.generation,
                at_ms: n.at_ms,
                label: n.label,
                source: None,
                usage: false,
            })
            .collect();
        items.retain(|n| {
            n.id != "patina.reminders"
                && n.focus_task.as_ref().is_none_or(|(kind, id, rev)| {
                    storage
                        .focus()
                        .current_focus(kind, *id, *rev)
                        .unwrap_or(false)
                })
        });
        if let Some(tool) = host.bound_installation("patina.reminders") {
            items.extend(storage.reminders().pending()?.into_iter().map(
                |(source, at_ms, label)| Notice {
                    id: tool.manifest.id.clone(),
                    generation: tool.generation.clone(),
                    at_ms,
                    label,
                    source: Some(source),
                    usage: false,
                    focus_task: None,
                },
            ));
            for id in self.current_usage(storage, now_ms())? {
                if let Some(n) = self
                    .usage
                    .get(&id)
                    .filter(|n| n.generation == tool.generation)
                {
                    items.push(n.clone());
                }
            }
        }
        items.sort_by_key(|n| (n.at_ms, n.source));
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
                v.id == n.id && v.source == n.source && v.usage == n.usage && v.at_ms == n.at_ms
            })
            .ok_or("Notification changed")?;
        if let Some(id) = n.source {
            if n.usage {
                if choice != "dismiss" {
                    storage.reminders().apply(serde_json::json!({"kind":"extend","id":id,"at":n.at_ms,"extension":choice}),now_ms())?;
                }
                self.usage.remove(&id);
            } else {
                let delay = match choice {
                    "dismiss" => None,
                    "5" => Some(5),
                    "15" => Some(15),
                    "30" => Some(30),
                    _ => return Err("Invalid reminder action".into()),
                };
                storage.reminders().apply(
                    serde_json::json!({"kind":"confirm","id":id,"fired_at":n.at_ms,"delay":delay}),
                    now_ms(),
                )?;
                host.dispatch_panel_event(&n.id, &n.generation, None, locale)?;
            }
            Ok(())
        } else {
            if choice == "start" && n.id == "patina.focus" {
                let (kind, id, rev) = n.focus_task.as_ref().ok_or("No task assigned")?;
                storage.focus().apply(serde_json::json!({"kind":kind,"action":{"kind":"start_next","id":id,"expectedUpdatedAt":rev}}),now_ms())?;
                host.dispatch_panel_event(&n.id, &n.generation, None, locale)?;
            } else if choice != "dismiss" {
                return Err("Invalid notification action".into());
            }
            host.acknowledge(&n.id, &n.generation, n.at_ms)
        }
    }
}
