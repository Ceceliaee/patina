use super::{Capability, Host, Installed, Manifest};
use serde_json::Value;
use std::sync::Arc;

pub trait CapabilityData: Send + Sync {
    fn read(&self, locale: &str, now: i64, state: &Value) -> Result<Value, String>;
    fn apply(&self, command: Value, now: i64) -> Result<(), String>;
    fn suspend(&self, now: i64) -> Result<(), String>;
    fn delete_data(&self) -> Result<(), String>;
    fn uninstall_impact(
        &self,
        locale: &str,
        now: i64,
        fallback: &str,
    ) -> Result<Vec<String>, String>;
}

pub type DataProvider = dyn Fn(&Manifest) -> Result<Arc<dyn CapabilityData>, String> + Send + Sync;

pub(super) fn requires_binding(manifest: &Manifest) -> bool {
    manifest
        .capabilities
        .iter()
        .any(|c| matches!(c, Capability::Focus | Capability::Reminders))
}

impl Host {
    pub fn set_data_provider(&mut self, provider: Box<DataProvider>) -> Result<(), String> {
        self.provider = Some(provider);
        let retiring: Vec<_> = self
            .records
            .iter()
            .filter_map(|(id, r)| Some((id.clone(), r.retiring_at?)))
            .collect();
        for (id, at) in retiring {
            self.finish_removal(&id, at)?;
        }
        Ok(())
    }

    pub(super) fn data_for(
        &self,
        manifest: &Manifest,
    ) -> Result<Option<Arc<dyn CapabilityData>>, String> {
        if !requires_binding(manifest) {
            return Ok(None);
        }
        let provider = self
            .provider
            .as_ref()
            .ok_or("Task capability unavailable")?;
        provider(manifest).map(Some)
    }

    pub fn providers(&self, capability: Capability) -> impl Iterator<Item = Installed> + '_ {
        self.records.keys().filter_map(move |id| {
            self.bound_installation(id)
                .filter(|p| p.manifest.capabilities.contains(&capability))
        })
    }

    pub fn bound_installation(&self, id: &str) -> Option<Installed> {
        let record = self.records.get(id)?;
        let files = self.current(id, &record.generation).ok()?.files.as_ref()?;
        (self.provider.is_some() && requires_binding(&files.manifest)).then(|| Installed {
            manifest: files.display_manifest(),
            generation: record.generation.clone(),
        })
    }
}
