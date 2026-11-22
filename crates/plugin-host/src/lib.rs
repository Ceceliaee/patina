mod archive;
mod directories;
mod layout;
mod locales;
pub use locales::Catalogs;
mod notification;
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
use bindings::requires_binding;
pub use bindings::{CapabilityData, DataProvider};
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
struct InstalledFiles {
    manifest: Manifest,
    digest: [u8; 32],
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    names: BTreeMap<String, String>,
}

fn localized_manifest(manifest: &Manifest, names: &BTreeMap<String, String>) -> Manifest {
    let mut display = manifest.clone();
    if !names.is_empty() {
        let presentation =
            display
                .presentation
                .get_or_insert_with(|| patina_plugin_sdk::Presentation {
                    names: Default::default(),
                    order: u16::MAX,
                });
        presentation.names.extend(names.clone());
    }
    display
}

impl InstalledFiles {
    fn display_manifest(&self) -> Manifest {
        localized_manifest(&self.manifest, &self.names)
    }

    fn new(package: &Package) -> Result<Self, String> {
        Ok(Self {
            manifest: package.manifest.clone(),
            digest: package.bundle_digest()?,
            names: package.names(),
        })
    }
}

#[derive(Clone, Serialize, Deserialize)]
struct InstallationRecord {
    #[serde(default)]
    requires_timer_restart: bool,
    #[serde(default)]
    installed_from_file: bool,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    previous_capabilities: Vec<Capability>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    files: Option<InstalledFiles>,
    // Present only while migrating a registry that embedded the complete package.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    package: Option<Package>,
    state: Value,
    generation: String,
    #[serde(default)]
    timer: Option<Timer>,
    #[serde(default)]
    notice: Option<TimerNotice>,
    #[serde(default)]
    retiring_at: Option<i64>,
    // Older pending removals were confirmed under the keep-data policy.
    #[serde(default)]
    delete_data_on_removal: bool,
    #[serde(default)]
    publisher: String,
}

pub struct Host {
    root: PathBuf,
    records: BTreeMap<String, InstallationRecord>,
    loaded: BTreeMap<String, LoadedPlugin>,
    retry_at: BTreeMap<String, i64>,
    provider: Option<Box<DataProvider>>,
}

impl Host {
    pub fn open(root: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(root.join("plugins")).map_err(|e| e.to_string())?;
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
            provider: None,
        };
        host.recover_change().map_err(|e| e.to_string())?;
        let embedded: Vec<_> = host
            .records
            .iter()
            .filter(|(_, r)| r.package.is_some())
            .map(|(id, _)| id.clone())
            .collect();
        for id in embedded {
            let mut record = host.records[&id].clone();
            let package = record.package.take().unwrap();
            if package.manifest.id != id || package.publisher != record.publisher {
                return Err("Embedded plugin identity mismatch".into());
            }
            // Historical unsigned defaults are migrated on disk and replaced by signed seeds before execution.
            if !package.publisher.is_empty() || !package.signature.is_empty() {
                package.verify_signature()?;
            }
            package.validated_wasm()?;
            host.save_installation(&id, record, Some(&package))?;
        }
        let pending: Vec<_> = host
            .records
            .iter()
            .filter_map(|(id, record)| {
                let at = record.retiring_at?;
                (!requires_binding(&record.files.as_ref()?.manifest)
                    && record.previous_capabilities.is_empty())
                .then(|| (id.clone(), at))
            })
            .collect();
        for (id, at) in pending {
            host.finish_removal(&id, at)?;
        }
        Ok(host)
    }

    pub fn task_data_directory(&self) -> PathBuf {
        self.root.join("data")
    }

    pub fn list(&self) -> Vec<Installed> {
        self.records
            .values()
            .filter_map(|r| {
                if r.retiring_at.is_some() {
                    return None;
                }
                Some(Installed {
                    manifest: r.files.as_ref()?.display_manifest(),
                    generation: r.generation.clone(),
                })
            })
            .collect()
    }

    /// Install new bundled plugins and update existing ones. The removal
    /// record is retained across restarts, including upgrades of the application.
    pub fn seed(&mut self, package: Package, locale: &str) -> Result<(), String> {
        package.verify_signature()?;
        package.validated_wasm()?;
        let id = package.manifest.id.clone();
        if let Some(record) = self.records.get(&id) {
            if record.publisher.is_empty() && record.files.is_none() {
                // A verified bundled copy supplies the first key for legacy removals from either source.
                return self.save(
                    &id,
                    InstallationRecord {
                        publisher: package.publisher.clone(),
                        ..record.clone()
                    },
                );
            }
            if !record.publisher.is_empty() || record.installed_from_file {
                self.check_publisher(&package)?;
            }
        }
        if let Some(record) = self.records.get(&id)
            && !record.installed_from_file
            && let Some(previous) = &record.files
            && (record.publisher != package.publisher
                || previous.digest != package.bundle_digest()?
                || self.read_installed(&id).is_err())
        {
            self.activate(package, locale, false)?;
            return Ok(());
        }
        if !self.records.contains_key(&id) {
            self.save_installation(
                &id,
                InstallationRecord {
                    package: None,
                    files: None,
                    requires_timer_restart: false,
                    installed_from_file: false,
                    previous_capabilities: Vec::new(),
                    state: Value::Null,
                    generation: uuid::Uuid::new_v4().to_string(),
                    timer: None,
                    notice: None,
                    retiring_at: None,
                    delete_data_on_removal: false,
                    publisher: package.publisher.clone(),
                },
                Some(&package),
            )?;
        }
        Ok(())
    }

    pub fn restore_default(&mut self, package: Package, locale: &str) -> Result<Installed, String> {
        package.verify_signature()?;
        if self
            .records
            .get(&package.manifest.id)
            .is_some_and(|r| r.files.is_some())
        {
            return Err("Tool already installed".into());
        }
        self.check_publisher(&package)?;
        self.activate(package, locale, false)
    }

    fn check_publisher(&self, package: &Package) -> Result<(), String> {
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
        self.check_publisher(&p)?;
        if requires_binding(&p.manifest) && self.provider.is_none() {
            return Err("Task capability unavailable".into());
        }
        let replaces = self
            .records
            .get(&p.manifest.id)
            .map(|r| r.generation.clone());
        Ok(Preview {
            manifest: p.display_manifest(),
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
        self.check_publisher(&p)?;
        if requires_binding(&p.manifest) && self.provider.is_none() {
            return Err("Task capability unavailable".to_owned().into());
        }
        let id = p.manifest.id.clone();
        let previous = self.records.get(&id);
        if digest != preview.digest
            || p.display_manifest() != preview.manifest
            || p.publisher != preview.publisher
            || previous.map(|r| &r.generation) != preview.replaces.as_ref()
        {
            return Err(InstallError::StalePreview);
        }
        if let Some(record) = previous
            && record.retiring_at.is_none()
            && let Some(files) = &record.files
            && files.digest == p.bundle_digest()?
            && self.read_installed(&id).is_ok()
        {
            return Ok(Installed {
                manifest: files.display_manifest(),
                generation: record.generation.clone(),
            });
        }
        Ok(self.activate(p, locale, true)?)
    }

    fn activate(
        &mut self,
        p: Package,
        locale: &str,
        installed_from_file: bool,
    ) -> Result<Installed, String> {
        let id = p.manifest.id.clone();
        if self
            .records
            .get(&id)
            .is_some_and(|r| r.retiring_at.is_some())
        {
            return Err("Tool removal is still pending".into());
        }
        let requires_timer_restart = self
            .records
            .get(&id)
            .is_some_and(|r| r.files.is_none() || r.requires_timer_restart);
        let state = self
            .records
            .get(&id)
            .map(|r| r.state.clone())
            .unwrap_or_default();
        let mut previous_capabilities = Vec::new();
        let mut notice = None;
        if let Some(record) = self.records.get(&id)
            && let Some(files) = &record.files
        {
            previous_capabilities = record.previous_capabilities.clone();
            for cap in &files.manifest.capabilities {
                if matches!(cap, Capability::Focus | Capability::Reminders)
                    && !previous_capabilities.contains(cap)
                {
                    previous_capabilities.push(*cap);
                }
            }
            notice = record.notice.clone();
        }
        let mut plugin = LoadedPlugin::new(&p)?;
        let mut response = invoke(
            &mut plugin,
            &p.manifest,
            state,
            Event::Open,
            locale,
            now_ms(),
            self.data_for(&p.manifest)?.as_deref(),
        )?;
        let installed = Installed {
            manifest: p.display_manifest(),
            generation: uuid::Uuid::new_v4().to_string(),
        };
        if let Some(n) = &mut notice {
            n.generation.clone_from(&installed.generation);
        }
        let publisher = p.publisher.clone();
        if requires_timer_restart {
            response.timer = None;
        }
        self.save_installation(
            &id,
            InstallationRecord {
                files: None,
                package: None,
                requires_timer_restart,
                installed_from_file,
                previous_capabilities,
                state: response.state,
                generation: installed.generation.clone(),
                timer: response.timer,
                notice,
                retiring_at: None,
                delete_data_on_removal: false,
                publisher,
            },
            Some(&p),
        )?;
        self.retry_at.remove(&id);
        self.loaded.insert(id, plugin);
        Ok(installed)
    }

    fn current(&self, id: &str, generation: &str) -> Result<&InstallationRecord, String> {
        self.records
            .get(id)
            .filter(|r| {
                r.generation == generation
                    && r.retiring_at.is_none()
                    && r.files.as_ref().is_some_and(|p| p.manifest.id == id)
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

    pub fn select_tab(
        &mut self,
        id: &str,
        generation: &str,
        tab: String,
        locale: &str,
    ) -> Result<Vec<Control>, String> {
        let record = self.current(id, generation)?;
        if !package::identifier(&tab) || !record.files.as_ref().is_some_and(|p| p.manifest.api >= 4)
        {
            return Err("Unsupported plugin tab selection".into());
        }
        self.dispatch(id, generation, Event::SelectTab(tab), locale, now_ms())
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
        let p = r.files.as_ref().unwrap();
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
        let data = self.data_for(&p.manifest)?;
        let state = r.state.clone();
        if !self.loaded.contains_key(id) {
            let plugin = LoadedPlugin::new(&self.read_installed(id)?)?;
            self.loaded.insert(id.to_owned(), plugin);
        }
        let explicit_action = matches!(
            event,
            Event::Action(_)
                | Event::Submit { .. }
                | Event::Notification {
                    action: Some(_),
                    ..
                }
        );
        let handled_timer = matches!(
            &event,
            Event::Notification { notice, action: Some(_) }
                if matches!(notice.target, patina_plugin_sdk::notification::NoticeTarget::Timer | patina_plugin_sdk::notification::NoticeTarget::Focus { .. })
                    && r.notice.as_ref().is_some_and(|pending| pending.at_ms == notice.at_ms)
        );
        let result = invoke(
            self.loaded.get_mut(id).unwrap(),
            &manifest,
            state,
            event,
            locale,
            now,
            data.as_deref(),
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
            || handled_timer
        {
            let updated = InstallationRecord {
                requires_timer_restart,
                state: response.state,
                timer: response.timer,
                notice: if handled_timer {
                    None
                } else {
                    due_notice.or_else(|| current.notice.clone())
                },
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
                delete_data_on_removal: true,
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
        let files = record
            .files
            .as_ref()
            .ok_or("Missing retiring installation")?;
        if files.manifest.id != id {
            return Err("Retiring plugin identity mismatch".into());
        }
        let mut owned = files.manifest.clone();
        for cap in &record.previous_capabilities {
            if !owned.capabilities.contains(cap) {
                owned.capabilities.push(*cap);
            }
        }
        let data = self.data_for(&files.manifest)?;
        if !record.delete_data_on_removal
            && let Some(data) = &data
        {
            data.suspend(now)?;
        }
        // A broken timer must still be removable.
        if files.manifest.capabilities.contains(&Capability::Timer)
            && let Ok(p) = self.read_installed(id)
            && let Ok(mut guest) = LoadedPlugin::new(&p)
            && let Ok(response) = invoke(
                &mut guest,
                &p.manifest,
                state.clone(),
                Event::Uninstall,
                "en-US",
                now,
                data.as_deref(),
            )
        {
            state = response.state;
        }
        if record.delete_data_on_removal {
            if let Some(data) = self.data_for(&owned)? {
                data.delete_data()?;
            }
            state = Value::Null;
        }
        self.save_installation(
            id,
            InstallationRecord {
                files: None,
                package: None,
                requires_timer_restart: true,
                installed_from_file: record.installed_from_file,
                previous_capabilities: Vec::new(),
                generation: uuid::Uuid::new_v4().to_string(),
                state,
                timer: None,
                notice: None,
                retiring_at: None,
                delete_data_on_removal: false,
                publisher: record.publisher.clone(),
            },
            None,
        )?;
        self.loaded.remove(id);
        self.retry_at.remove(id);
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
        let manifest = &r.files.as_ref().unwrap().manifest;
        if let Some(data) = self.data_for(manifest)? {
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
    let mut config = wasmtime::Config::new();
    config.cranelift_opt_level(wasmtime::OptLevel::None);
    let manifest = extism::Manifest::new([Wasm::data(package.validated_wasm()?)])
        .with_memory_max(256)
        .with_timeout(Duration::from_millis(250));
    PluginBuilder::new(manifest)
        .with_wasmtime_config(config)
        .with_cache_disabled()
        .with_wasi(false)
        .with_fuel_limit(5_000_000)
        .build()
        .map_err(|e| e.to_string())
}

struct LoadedPlugin {
    wasm: Plugin,
    locales: Catalogs,
}

impl LoadedPlugin {
    fn new(package: &Package) -> Result<Self, String> {
        Ok(Self {
            wasm: compile(package)?,
            locales: package.locales.clone(),
        })
    }
}

fn invoke(
    plugin: &mut LoadedPlugin,
    manifest: &Manifest,
    state: Value,
    event: Event,
    locale: &str,
    now_ms: i64,
    data: Option<&dyn CapabilityData>,
) -> Result<Response, String> {
    let can_mutate = matches!(
        event,
        Event::Action(_)
            | Event::Submit { .. }
            | Event::Due
            | Event::Notification {
                action: Some(_),
                ..
            }
    );
    let request = Request {
        messages: locales::select(&plugin.locales, locale),
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
        .wasm
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
    let mut has_page = false;
    if response.panel.len() > 256
        || !response.panel.iter().all(|c| match c {
            Control::Page(page) => {
                manifest.api >= 2
                    && !std::mem::replace(&mut has_page, true)
                    && layout::valid(
                        page,
                        &response.panel,
                        manifest.api,
                        manifest.capabilities.contains(&Capability::Reminders),
                    )
            }
            Control::Text(s) => s.len() <= 8192,
            Control::ListRow {
                id,
                title,
                detail,
                actions,
                ..
            } => {
                package::identifier(id)
                    && ids.insert(id)
                    && title.len() <= 4096
                    && detail.len() <= 4096
                    && actions.len() <= 8
                    && actions.iter().all(|(id, label)| {
                        package::identifier(id)
                            && ids.insert(id)
                            && package::display_text(label, 256)
                    })
            }
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
