mod package;

use extism::{Plugin, PluginBuilder, Wasm};
pub use package::Package;
pub use patina_plugin_sdk::{Capability, Control, Manifest};
use patina_plugin_sdk::{Event, Request, Response, Timer};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::Duration,
};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Installed {
    pub manifest: Manifest,
    pub generation: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Preview {
    pub manifest: Manifest,
    pub digest: String,
    pub replaces: Option<String>,
    pub publisher: String,
}

#[derive(Clone, Serialize, Deserialize)]
struct Record {
    #[serde(default)]
    requires_timer_restart: bool,
    package: Option<Package>,
    state: Value,
    generation: String,
    #[serde(default)]
    timer: Option<Timer>,
    #[serde(default)]
    notice: Option<Notice>,
    #[serde(default)]
    retiring_at: Option<i64>,
    #[serde(default)]
    publisher: String,
}

/// The native application binds legacy tool data only to its owning installation.
pub trait ToolData: Send {
    fn read(&self, id: &str, locale: &str, now: i64, state: &Value) -> Result<Value, String>;
    fn apply(&self, id: &str, command: Value, now: i64) -> Result<(), String>;
    fn suspend(&self, id: &str, now: i64) -> Result<(), String>;
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Notice {
    pub id: String,
    pub generation: String,
    pub at_ms: i64,
    pub label: String,
    #[serde(default)]
    pub source: Option<i64>,
    #[serde(default)]
    pub usage: bool,
    #[serde(default)]
    pub focus_task: Option<(String, i64, i64)>,
}

pub struct Host {
    root: PathBuf,
    records: BTreeMap<String, Record>,
    loaded: BTreeMap<String, Plugin>,
    retry_at: BTreeMap<String, i64>,
    data: Option<Box<dyn ToolData>>,
}

impl Host {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let records = match fs::read(root.join("tools.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Read tools: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(e.to_string()),
        };
        Ok(Self {
            root,
            records,
            loaded: BTreeMap::new(),
            retry_at: BTreeMap::new(),
            data: None,
        })
    }

    pub fn list(&self) -> Vec<Installed> {
        self.records
            .values()
            .filter_map(|r| {
                if r.retiring_at.is_some() {
                    return None;
                }
                Some(Installed {
                    manifest: r.package.as_ref()?.manifest.clone(),
                    generation: r.generation.clone(),
                })
            })
            .collect()
    }

    /// Register packages shipped with the application once per profile. The removal
    /// record is retained across restarts, including upgrades of the application.
    pub fn seed(&mut self, package: Package, locale: &str) -> Result<(), String> {
        let id = package.manifest.id.clone();
        if let Some(previous) = self.records.get(&id).and_then(|r| r.package.as_ref())
            && (previous.wasm != package.wasm
                || previous.manifest.version != package.manifest.version)
        {
            self.activate(package, locale)?;
            return Ok(());
        }
        if !self.records.contains_key(&id) {
            package.module()?;
            self.save(
                &id,
                Record {
                    package: Some(package),
                    requires_timer_restart: false,
                    state: Value::Null,
                    generation: uuid::Uuid::new_v4().to_string(),
                    timer: None,
                    notice: None,
                    retiring_at: None,
                    publisher: String::new(),
                },
            )?;
        }
        Ok(())
    }

    pub fn restore_bundled(&mut self, package: Package, locale: &str) -> Result<Installed, String> {
        if self
            .records
            .get(&package.manifest.id)
            .is_some_and(|r| r.package.is_some())
        {
            return Err("Tool already installed".into());
        }
        self.activate(package, locale)
    }

    pub fn bind(&mut self, data: Box<dyn ToolData>) -> Result<(), String> {
        self.data = Some(data);
        let pending: Vec<_> = self
            .records
            .iter()
            .filter_map(|(id, r)| r.retiring_at.map(|now| (id.clone(), now)))
            .collect();
        for (id, now) in pending {
            self.finish_removal(&id, now)?;
        }
        Ok(())
    }

    fn check_external(&self, package: &Package) -> Result<(), String> {
        if package.manifest.id.starts_with("patina.") || native_owner(&package.manifest) {
            return Err("The patina namespace is reserved for bundled tools".into());
        }
        if self
            .records
            .get(&package.manifest.id)
            .is_some_and(|p| p.publisher != package.publisher)
        {
            return Err("This tool ID belongs to another publisher".into());
        }
        Ok(())
    }

    pub fn inspect(&self, path: &Path) -> Result<Preview, String> {
        let (p, digest) = Package::from_file(path)?;
        self.check_external(&p)?;
        let replaces = self
            .records
            .get(&p.manifest.id)
            .map(|r| r.generation.clone());
        Ok(Preview {
            manifest: p.manifest,
            digest,
            replaces,
            publisher: p.publisher,
        })
    }

    pub fn install(
        &mut self,
        path: &Path,
        preview: &Preview,
        locale: &str,
    ) -> Result<Installed, String> {
        let (p, digest) = Package::from_file(path)?;
        self.check_external(&p)?;
        let id = p.manifest.id.clone();
        let previous = self.records.get(&id);
        if digest != preview.digest || previous.map(|r| &r.generation) != preview.replaces.as_ref()
        {
            return Err("Tool changed since preview; open the package again".into());
        }
        self.activate(p, locale)
    }

    fn activate(&mut self, p: Package, locale: &str) -> Result<Installed, String> {
        let id = p.manifest.id.clone();
        let requires_timer_restart = self
            .records
            .get(&id)
            .is_some_and(|r| r.package.is_none() || r.requires_timer_restart);
        let state = self
            .records
            .get(&id)
            .map(|r| r.state.clone())
            .unwrap_or_default();
        let mut plugin = compile(&p)?;
        let mut response = invoke(
            &mut plugin,
            &p.manifest,
            state,
            Event::Open,
            locale,
            now_ms(),
            self.data.as_deref(),
        )?;
        let installed = Installed {
            manifest: p.manifest.clone(),
            generation: uuid::Uuid::new_v4().to_string(),
        };
        let publisher = p.publisher.clone();
        if requires_timer_restart {
            response.timer = None;
        }
        self.save(
            &id,
            Record {
                package: Some(p),
                requires_timer_restart,
                state: response.state,
                generation: installed.generation.clone(),
                timer: response.timer,
                notice: None,
                retiring_at: None,
                publisher,
            },
        )?;
        self.retry_at.remove(&id);
        self.loaded.insert(id, plugin);
        Ok(installed)
    }

    fn current(&self, id: &str, generation: &str) -> Result<&Record, String> {
        self.records
            .get(id)
            .filter(|r| {
                r.generation == generation && r.package.is_some() && r.retiring_at.is_none()
            })
            .ok_or_else(|| "Tool installation has changed".into())
    }

    pub fn panel(
        &mut self,
        id: &str,
        generation: &str,
        action: Option<String>,
        locale: &str,
    ) -> Result<Vec<Control>, String> {
        self.dispatch(
            id,
            generation,
            action.map_or(Event::Open, Event::Action),
            locale,
            now_ms(),
        )
    }

    pub fn submit(
        &mut self,
        id: &str,
        generation: &str,
        button: String,
        fields: BTreeMap<String, String>,
        locale: &str,
    ) -> Result<Vec<Control>, String> {
        if fields.len() > 32
            || fields
                .iter()
                .any(|(key, v)| !package::identifier(key) || v.len() > 4096)
        {
            return Err("Invalid tool form".into());
        }
        self.dispatch(
            id,
            generation,
            Event::Submit { id: button, fields },
            locale,
            now_ms(),
        )
    }

    fn dispatch(
        &mut self,
        id: &str,
        generation: &str,
        event: Event,
        locale: &str,
        now: i64,
    ) -> Result<Vec<Control>, String> {
        let r = self.current(id, generation)?;
        let p = r.package.as_ref().unwrap();
        let due_notice = if matches!(event, Event::Due) {
            r.timer.as_ref().map(|timer| Notice {
                id: id.into(),
                generation: generation.into(),
                at_ms: timer.at_ms,
                label: timer.label.clone(),
                source: None,
                usage: false,
                focus_task: timer
                    .task
                    .as_ref()
                    .map(|(kind, id)| (kind.clone(), *id, now)),
            })
        } else {
            None
        };
        let manifest = p.manifest.clone();
        let state = r.state.clone();
        if !self.loaded.contains_key(id) {
            let plugin = compile(p)?;
            self.loaded.insert(id.to_owned(), plugin);
        }
        let explicit_action = matches!(event, Event::Action(_) | Event::Submit { .. });
        let result = invoke(
            self.loaded.get_mut(id).unwrap(),
            &manifest,
            state,
            event,
            locale,
            now,
            self.data.as_deref(),
        );
        let mut response = match result {
            Ok(response) => response,
            Err(e) => {
                self.loaded.remove(id);
                return Err(e);
            }
        };
        let current = &self.records[id];
        let requires_timer_restart =
            current.requires_timer_restart && !(explicit_action && response.timer.is_some());
        if requires_timer_restart {
            response.timer = None;
        }
        if due_notice.is_some() && response.timer.as_ref().is_some_and(|t| t.at_ms <= now) {
            return Err("A tool must advance its expired timer".into());
        }
        if requires_timer_restart != current.requires_timer_restart
            || response.state != current.state
            || response.timer != current.timer
            || due_notice.is_some()
        {
            let updated = Record {
                requires_timer_restart,
                state: response.state,
                timer: response.timer,
                notice: due_notice.or_else(|| current.notice.clone()),
                ..current.clone()
            };
            if let Err(e) = self.save(id, updated) {
                self.loaded.remove(id);
                return Err(e);
            }
        }
        Ok(response.panel)
    }

    pub fn uninstall(&mut self, id: &str, generation: &str) -> Result<(), String> {
        if let Some(at) = self
            .records
            .get(id)
            .filter(|r| r.generation == generation)
            .and_then(|r| r.retiring_at)
        {
            return self.finish_removal(id, at);
        }
        let record = self.current(id, generation)?;
        let now = now_ms();
        self.save(
            id,
            Record {
                retiring_at: Some(now),
                timer: None,
                notice: None,
                ..record.clone()
            },
        )?;
        self.finish_removal(id, now)
    }

    fn finish_removal(&mut self, id: &str, now: i64) -> Result<(), String> {
        let record = &self.records[id];
        let mut state = record.state.clone();
        if record
            .package
            .as_ref()
            .is_some_and(|p| native_owner(&p.manifest))
        {
            self.data
                .as_deref()
                .ok_or("Tool storage unavailable")?
                .suspend(id, now)?;
        }
        if let Some(p) = record
            .package
            .as_ref()
            .filter(|p| p.manifest.capabilities.contains(&Capability::Timer))
        {
            // Let cooperative timers settle elapsed time. A broken guest must still be removable.
            if let Ok(mut guest) = compile(p)
                && let Ok(response) = invoke(
                    &mut guest,
                    &p.manifest,
                    state.clone(),
                    Event::Uninstall,
                    "en-US",
                    now,
                    self.data.as_deref(),
                )
            {
                state = response.state;
            }
        }
        self.save(
            id,
            Record {
                package: None,
                requires_timer_restart: true,
                generation: uuid::Uuid::new_v4().to_string(),
                state,
                timer: None,
                notice: None,
                retiring_at: None,
                publisher: record.publisher.clone(),
            },
        )?;
        self.loaded.remove(id);
        Ok(())
    }

    pub fn next_deadline(&self) -> Option<i64> {
        self.records
            .iter()
            .filter_map(|(id, record)| {
                record
                    .timer
                    .as_ref()
                    .map(|timer| timer.at_ms.max(*self.retry_at.get(id).unwrap_or(&0)))
            })
            .min()
    }

    pub fn notices(&self) -> Vec<Notice> {
        self.records
            .values()
            .filter_map(|record| record.notice.clone())
            .collect()
    }

    pub fn stopping(
        &self,
        id: &str,
        generation: &str,
        locale: &str,
    ) -> Result<Vec<String>, String> {
        let r = self.current(id, generation)?;
        let mut labels = Vec::new();
        if let Some(timer) = &r.timer {
            labels.push(timer.label.clone());
        }
        if let Some(notice) = &r.notice {
            labels.push(notice.label.clone());
        }
        if let Some(p) = &r.package
            && native_owner(&p.manifest)
        {
            let data = self.data.as_ref().ok_or("Task store unavailable")?.read(
                id,
                locale,
                now_ms(),
                &Value::Null,
            )?;
            for (key, label) in [
                ("free", "label"),
                ("pomodoro", "label"),
                ("reminders", "label"),
                ("rules", "label_snapshot"),
            ] {
                for task in data[key].as_array().into_iter().flatten() {
                    if task["status"] == "running"
                        || task["run"]["status"] == "running"
                        || task["status"] == "scheduled"
                        || task["status"] == "pending_confirmation"
                        || task["enabled"] == true
                    {
                        labels.push(
                            task[label]
                                .as_str()
                                .filter(|s| !s.is_empty())
                                .unwrap_or(&p.manifest.name)
                                .to_string(),
                        );
                    }
                }
            }
        }
        labels.sort();
        labels.dedup();
        Ok(labels)
    }

    pub fn acknowledge(&mut self, notice: &Notice) -> Result<(), String> {
        let current = self.current(&notice.id, &notice.generation)?;
        if !current
            .notice
            .as_ref()
            .is_some_and(|n| n.at_ms == notice.at_ms)
        {
            return Err("Notification is no longer current".into());
        }
        self.save(
            &notice.id,
            Record {
                notice: None,
                ..current.clone()
            },
        )
    }

    pub fn fire_due(&mut self, now: i64, locale: &str) -> Vec<(String, String)> {
        let due: Vec<_> = self
            .records
            .iter()
            .filter_map(|(id, r)| {
                let timer = r.timer.as_ref()?;
                (timer.at_ms <= now && self.retry_at.get(id).is_none_or(|at| *at <= now))
                    .then(|| (id.clone(), r.generation.clone()))
            })
            .collect();
        let mut failures = Vec::new();
        for (id, generation) in due {
            if let Err(error) = self.dispatch(&id, &generation, Event::Due, locale, now) {
                self.retry_at.insert(id.clone(), now.saturating_add(5000));
                failures.push((id, error));
            } else {
                self.retry_at.remove(&id);
            }
        }
        failures
    }

    fn save(&mut self, id: &str, record: Record) -> Result<(), String> {
        let old = self.records.insert(id.to_owned(), record);
        let result = (|| -> Result<(), String> {
            let mut tmp = tempfile::NamedTempFile::new_in(&self.root).map_err(|e| e.to_string())?;
            serde_json::to_writer(tmp.as_file_mut(), &self.records).map_err(|e| e.to_string())?;
            tmp.flush()
                .and_then(|_| tmp.as_file().sync_all())
                .map_err(|e| e.to_string())?;
            tmp.persist(self.root.join("tools.json"))
                .map_err(|e| e.to_string())?;
            Ok(())
        })();
        if result.is_err() {
            match old {
                Some(r) => {
                    self.records.insert(id.to_owned(), r);
                }
                None => {
                    self.records.remove(id);
                }
            }
        }
        result
    }
}

fn compile(package: &Package) -> Result<Plugin, String> {
    let manifest = extism::Manifest::new([Wasm::data(package.module()?)])
        .with_memory_max(256)
        .with_timeout(Duration::from_millis(250));
    PluginBuilder::new(manifest)
        .with_cache_disabled()
        .with_wasi(false)
        .with_fuel_limit(5_000_000)
        .build()
        .map_err(|e| e.to_string())
}

fn invoke(
    plugin: &mut Plugin,
    manifest: &Manifest,
    state: Value,
    event: Event,
    locale: &str,
    now_ms: i64,
    data: Option<&dyn ToolData>,
) -> Result<Response, String> {
    let storage = if native_owner(manifest) {
        Some(data.ok_or("Tool storage unavailable")?)
    } else {
        None
    };
    let can_mutate = matches!(event, Event::Action(_) | Event::Submit { .. } | Event::Due);
    let request = Request {
        data: match storage {
            Some(store) => store.read(&manifest.id, locale, now_ms, &state)?,
            None => Value::Null,
        },
        state,
        event,
        locale: locale.into(),
        now_ms,
    };
    let input = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
    let bytes = plugin
        .call::<_, &[u8]>(&manifest.entry, input)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 256 * 1024 {
        return Err("Tool output exceeds 256 KiB".into());
    }
    let mut response: Response = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    if let Some(timer) = &response.timer
        && (!manifest.capabilities.contains(&Capability::Timer)
            || timer.at_ms <= 0
            || !package::display_text(&timer.label, 256))
    {
        return Err("Invalid tool timer or missing timer capability".into());
    }
    let mut ids = HashSet::new();
    if response.panel.len() > 256
        || !response.panel.iter().all(|c| match c {
            Control::Text(s) => s.len() <= 8192,
            Control::Clock { label, .. } => package::display_text(label, 256),
            Control::Select {
                id,
                label,
                value,
                choices,
            } => {
                package::identifier(id)
                    && ids.insert(id)
                    && package::display_text(label, 256)
                    && choices.len() <= 32
                    && choices.iter().any(|(v, _)| v == value)
                    && choices
                        .iter()
                        .all(|(v, n)| package::identifier(v) && package::display_text(n, 256))
            }
            Control::Input { id, label, value } => {
                package::identifier(id)
                    && ids.insert(id)
                    && package::display_text(label, 256)
                    && value.len() <= 4096
            }
            Control::Button { id, label } | Control::Submit { id, label } => {
                package::identifier(id) && ids.insert(id) && package::display_text(label, 256)
            }
        })
    {
        return Err("Invalid tool panel".into());
    }
    if response.reload && !can_mutate {
        return Err("Invalid recursive panel request".into());
    }
    if let Some(command) = response.command.take() {
        if !can_mutate {
            return Err("Tool reads cannot change task data".into());
        }
        let store = storage.ok_or("Tool lacks task data access")?;
        store.apply(&manifest.id, command, now_ms)?;
        return invoke(
            plugin,
            manifest,
            response.state,
            Event::Open,
            locale,
            now_ms,
            data,
        );
    }
    if response.reload {
        return invoke(
            plugin,
            manifest,
            response.state,
            Event::Open,
            locale,
            now_ms,
            data,
        );
    }
    Ok(response)
}

fn native_owner(manifest: &Manifest) -> bool {
    manifest
        .capabilities
        .iter()
        .any(|c| matches!(c, Capability::Focus | Capability::Reminders))
}

#[cfg(test)]
mod limits;

pub fn now_ms() -> i64 {
    std::time::UNIX_EPOCH
        .elapsed()
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}
