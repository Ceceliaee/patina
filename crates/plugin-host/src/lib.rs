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

mod bindings;
pub use bindings::CapabilityData;
use bindings::{Binding, bound_data, candidate_data, requires_binding};
pub use patina_plugin_sdk::installation::{Installed, Preview, now_ms};

#[derive(Debug, PartialEq, Eq)]
pub enum InstallError {
    StalePreview,
    Rejected(String),
}
impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::StalePreview => f.write_str("Tool changed since preview; open the package again"),
            Self::Rejected(reason) => f.write_str(reason),
        }
    }
}
impl std::error::Error for InstallError {}
impl From<String> for InstallError {
    fn from(reason: String) -> Self {
        Self::Rejected(reason)
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct TimerNotice {
    pub id: String,
    pub generation: String,
    pub at_ms: i64,
    pub label: String,
    #[serde(default, rename = "focus_task")]
    pub task: Option<(String, i64, i64)>,
}

#[derive(Clone, Serialize, Deserialize)]
struct InstallationRecord {
    #[serde(default)]
    requires_timer_restart: bool,
    package: Option<Package>,
    state: Value,
    generation: String,
    #[serde(default)]
    timer: Option<Timer>,
    #[serde(default)]
    notice: Option<TimerNotice>,
    #[serde(default)]
    retiring_at: Option<i64>,
    #[serde(default)]
    publisher: String,
}

pub struct Host {
    root: PathBuf,
    records: BTreeMap<String, InstallationRecord>,
    loaded: BTreeMap<String, Plugin>,
    retry_at: BTreeMap<String, i64>,
    bindings: BTreeMap<String, Binding>,
}

impl Host {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let records = match fs::read(root.join("tools.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|e| format!("Read tools: {e}"))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(e) => return Err(e.to_string()),
        };
        let mut host = Self {
            root,
            records,
            loaded: BTreeMap::new(),
            retry_at: BTreeMap::new(),
            bindings: BTreeMap::new(),
        };
        let pending: Vec<_> = host
            .records
            .iter()
            .filter_map(|(id, record)| {
                let at = record.retiring_at?;
                (!requires_binding(&record.package.as_ref()?.manifest)).then(|| (id.clone(), at))
            })
            .collect();
        for (id, at) in pending {
            host.finish_removal(&id, at)?;
        }
        Ok(host)
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

    /// Install new bundled plugins and update existing ones. The removal
    /// record is retained across restarts, including upgrades of the application.
    fn sync_bundled_plugin(&mut self, package: Package, locale: &str) -> Result<(), String> {
        let id = package.manifest.id.clone();
        if let Some(previous) = self.records.get(&id).and_then(|r| r.package.as_ref())
            && (previous.wasm != package.wasm
                || previous.manifest != package.manifest
                || previous.publisher != package.publisher
                || previous.signature != package.signature)
        {
            self.activate(package, locale)?;
            return Ok(());
        }
        if !self.records.contains_key(&id) {
            package.validated_wasm()?;
            self.save(
                &id,
                InstallationRecord {
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
        if candidate_data(&self.bindings, &package)?.is_none() {
            return Err("Unknown bundled plugin".into());
        }
        if self
            .records
            .get(&package.manifest.id)
            .is_some_and(|r| r.package.is_some())
        {
            return Err("Tool already installed".into());
        }
        self.activate(package, locale)
    }

    fn check_external(&self, package: &Package) -> Result<(), String> {
        if package.manifest.id.starts_with("patina.") || requires_binding(&package.manifest) {
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
        let (p, digest) = Package::read_verified(path)?;
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
    ) -> Result<Installed, InstallError> {
        let (p, digest) = Package::read_verified(path)?;
        self.check_external(&p)?;
        let id = p.manifest.id.clone();
        let previous = self.records.get(&id);
        if digest != preview.digest
            || p.manifest != preview.manifest
            || p.publisher != preview.publisher
            || previous.map(|r| &r.generation) != preview.replaces.as_ref()
        {
            return Err(InstallError::StalePreview);
        }
        Ok(self.activate(p, locale)?)
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
            candidate_data(&self.bindings, &p)?,
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
            InstallationRecord {
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
        if let Some(binding) = self.bindings.get_mut(&id) {
            binding.generation = Some(installed.generation.clone());
        }
        self.loaded.insert(id, plugin);
        Ok(installed)
    }

    fn current(&self, id: &str, generation: &str) -> Result<&InstallationRecord, String> {
        self.records
            .get(id)
            .filter(|r| {
                r.generation == generation
                    && r.retiring_at.is_none()
                    && r.package
                        .as_ref()
                        .is_some_and(|p| p.manifest.id == id && p.publisher == r.publisher)
            })
            .ok_or_else(|| "Tool installation has changed".into())
    }

    pub fn dispatch_panel_event(
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
        self.current(id, generation)?;
        let r = &self.records[id];
        let p = r.package.as_ref().unwrap();
        let due_notice = if matches!(event, Event::Due) {
            r.timer.as_ref().map(|timer| TimerNotice {
                id: id.into(),
                generation: generation.into(),
                at_ms: timer.at_ms,
                label: timer.label.clone(),
                task: timer
                    .task
                    .as_ref()
                    .map(|(kind, id)| (kind.clone(), *id, now)),
            })
        } else {
            None
        };
        let manifest = p.manifest.clone();
        let data = bound_data(&self.bindings, &p.manifest, generation)?;
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
            data,
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
            let updated = InstallationRecord {
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
            InstallationRecord {
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
        let Some(package) = record.package.as_ref() else {
            return Err("Missing retiring installation".into());
        };
        if package.manifest.id != id {
            return Err("Retiring plugin identity mismatch".into());
        }
        let binding = self.bindings.get(id);
        if requires_binding(&package.manifest) {
            let binding = binding.ok_or("Plugin capability unavailable")?;
            binding.verify_owner(package, &record.publisher)?;
            binding.data.suspend(now)?;
        }
        if let Some(p) = record
            .package
            .as_ref()
            .filter(|p| p.manifest.capabilities.contains(&Capability::Timer))
        {
            // Let cooperative timers settle elapsed time. A broken guest must still be removable.
            if let Ok(data) = candidate_data(&self.bindings, p)
                && let Ok(mut guest) = compile(p)
                && let Ok(response) = invoke(
                    &mut guest,
                    &p.manifest,
                    state.clone(),
                    Event::Uninstall,
                    "en-US",
                    now,
                    data,
                )
            {
                state = response.state;
            }
        }
        self.save(
            id,
            InstallationRecord {
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
        if let Some(binding) = self.bindings.get_mut(id) {
            binding.generation = None;
        }
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

    pub fn notices(&self) -> Vec<TimerNotice> {
        self.records
            .iter()
            .filter_map(|(id, record)| {
                let notice = record.notice.as_ref()?;
                (notice.id == *id && self.current(id, &notice.generation).is_ok())
                    .then(|| notice.clone())
            })
            .collect()
    }

    pub fn uninstall_impact_labels(
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
        let manifest = &r.package.as_ref().unwrap().manifest;
        if let Some(data) = bound_data(&self.bindings, manifest, generation)? {
            labels.extend(data.uninstall_impact(locale, now_ms(), &manifest.name)?);
        }
        labels.sort();
        labels.dedup();
        Ok(labels)
    }

    pub fn acknowledge(&mut self, id: &str, generation: &str, at_ms: i64) -> Result<(), String> {
        let current = self.current(id, generation)?;
        if !current.notice.as_ref().is_some_and(|n| n.at_ms == at_ms) {
            return Err("Notification is no longer current".into());
        }
        self.save(
            id,
            InstallationRecord {
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

    fn save(&mut self, id: &str, record: InstallationRecord) -> Result<(), String> {
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
    let manifest = extism::Manifest::new([Wasm::data(package.validated_wasm()?)])
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
    data: Option<&dyn CapabilityData>,
) -> Result<Response, String> {
    let can_mutate = matches!(event, Event::Action(_) | Event::Submit { .. } | Event::Due);
    let request = Request {
        data: match data {
            Some(store) => store.read(locale, now_ms, &state)?,
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
        let store = data.ok_or("Tool lacks task data access")?;
        store.apply(command, now_ms)?;
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

#[cfg(test)]
mod limits;
