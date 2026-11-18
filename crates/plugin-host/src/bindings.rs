use super::{Capability, Host, Installed, Manifest, Package};
use serde_json::Value;
use std::collections::BTreeMap;

pub trait CapabilityData: Send {
    fn read(&self, locale: &str, now: i64, state: &Value) -> Result<Value, String>;
    fn apply(&self, command: Value, now: i64) -> Result<(), String>;
    fn suspend(&self, now: i64) -> Result<(), String>;
    fn uninstall_impact(
        &self,
        locale: &str,
        now: i64,
        fallback: &str,
    ) -> Result<Vec<String>, String>;
}

pub(super) struct Binding {
    trusted_digest: [u8; 32],
    pub(super) generation: Option<String>,
    capability: Capability,
    pub(super) data: Box<dyn CapabilityData>,
}

fn data_capabilities(manifest: &Manifest) -> impl Iterator<Item = Capability> + '_ {
    manifest
        .capabilities
        .iter()
        .copied()
        .filter(|c| !matches!(c, Capability::Panel | Capability::Timer))
}

pub(super) fn requires_binding(manifest: &Manifest) -> bool {
    data_capabilities(manifest).next().is_some()
}

impl Binding {
    pub(super) fn verify_owner(&self, package: &Package, publisher: &str) -> Result<(), String> {
        if !publisher.is_empty()
            || !package.publisher.is_empty()
            || !package.signature.is_empty()
            || !data_capabilities(&package.manifest).eq([self.capability])
        {
            return Err("Plugin capability owner mismatch".into());
        }
        Ok(())
    }
}

pub(super) fn candidate_data<'a>(
    bindings: &'a BTreeMap<String, Binding>,
    package: &Package,
) -> Result<Option<&'a dyn CapabilityData>, String> {
    if !requires_binding(&package.manifest) {
        return Ok(None);
    }
    let binding = bindings
        .get(&package.manifest.id)
        .ok_or("Plugin capability unavailable")?;
    binding.verify_owner(package, &package.publisher)?;
    if binding.trusted_digest != package.bundle_digest()? {
        return Err("Plugin differs from the trusted bundle".into());
    }
    Ok(Some(binding.data.as_ref()))
}

pub(super) fn bound_data<'a>(
    bindings: &'a BTreeMap<String, Binding>,
    manifest: &Manifest,
    generation: &str,
) -> Result<Option<&'a dyn CapabilityData>, String> {
    if !requires_binding(manifest) {
        return Ok(None);
    }
    let binding = bindings
        .get(&manifest.id)
        .filter(|b| b.generation.as_deref() == Some(generation))
        .ok_or("Plugin capability unavailable for this installation")?;
    Ok(Some(binding.data.as_ref()))
}
impl Host {
    pub fn bind_bundled(
        &mut self,
        package: Package,
        capability: Capability,
        data: Box<dyn CapabilityData>,
        locale: &str,
    ) -> Result<(), String> {
        if !package.manifest.id.starts_with("patina.")
            || !package.publisher.is_empty()
            || !package.signature.is_empty()
            || !data_capabilities(&package.manifest).eq([capability])
        {
            return Err("Invalid bundled capability".into());
        }
        let id = package.manifest.id.clone();
        let previous = self.bindings.insert(
            id.clone(),
            Binding {
                trusted_digest: package.bundle_digest()?,
                generation: None,
                capability,
                data,
            },
        );
        let result = (|| {
            if let Some(now) = self.records.get(&id).and_then(|r| r.retiring_at) {
                self.finish_removal(&id, now)?;
            }
            self.sync_bundled_plugin(package, locale)?;
            if let Some(record) = self.records.get(&id)
                && record.package.is_some()
                && record.publisher.is_empty()
            {
                self.bindings.get_mut(&id).unwrap().generation = Some(record.generation.clone());
            }
            Ok::<_, String>(())
        })();
        if result.is_err() {
            match previous {
                Some(binding) => {
                    self.bindings.insert(id, binding);
                }
                None => {
                    self.bindings.remove(&id);
                }
            }
        }
        result
    }
    pub fn bound_installation(&self, id: &str) -> Option<Installed> {
        let record = self.records.get(id)?;
        let package = self
            .current(id, &record.generation)
            .ok()?
            .package
            .as_ref()?;
        bound_data(&self.bindings, &package.manifest, &record.generation).ok()??;
        Some(Installed {
            manifest: package.manifest.clone(),
            generation: record.generation.clone(),
        })
    }
}
