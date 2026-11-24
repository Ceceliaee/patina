use super::{Host, InstallationRecord, Package, archive::plain_path, package::identifier};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
};

pub(super) fn folder_name(id: &str) -> String {
    let stem = id.split('.').next().unwrap_or(id);
    let reserved = matches!(stem, "aux" | "con" | "nul" | "prn")
        || (stem.starts_with("com") || stem.starts_with("lpt"))
            && stem.len() == 4
            && stem.as_bytes()[3].is_ascii_digit();
    if reserved || id.ends_with('.') {
        format!("_{id}_")
    } else {
        id.to_owned()
    }
}

#[derive(Serialize, Deserialize)]
struct Change {
    id: String,
    generation: String,
    had_directory: bool,
}

fn directory(root: &Path, id: &str) -> io::Result<PathBuf> {
    if !identifier(id) {
        return Err(io::Error::other("Invalid installed plugin ID"));
    }
    let plugins = root.join("plugins");
    if !plain_path(&plugins)?.is_dir() {
        return Err(io::Error::other("Expected plugins directory"));
    }
    Ok(plugins.join(folder_name(id)))
}

impl Host {
    pub(super) fn read_installed(&self, id: &str) -> Result<Package, String> {
        let record = &self.records[id];
        let files = record.files.as_ref().ok_or("Missing installed plugin")?;
        let path = directory(&self.root, id).map_err(|e| e.to_string())?;
        let package = Package::read_directory(&path).map_err(|e| e.to_string())?;
        if package.manifest != files.manifest
            || package.publisher != record.publisher
            || package.verified_digest()? != files.digest
        {
            return Err("Installed files differ from the confirmed plugin".into());
        }
        package.validated_wasm()?;
        Ok(package)
    }

    pub(super) fn save_installation(
        &mut self,
        id: &str,
        mut record: InstallationRecord,
        package: Option<&Package>,
    ) -> Result<(), String> {
        self.recover_change().map_err(|e| e.to_string())?;
        record.files = package.map(super::InstalledFiles::new).transpose()?;
        record.package = None;
        let prepare = || -> io::Result<()> {
            let active = directory(&self.root, id)?;
            let had_directory = active.try_exists()?;
            if had_directory
                && (!plain_path(&active)?.is_dir()
                    || self.records.get(id).is_none_or(|r| r.files.is_none()))
            {
                return Err(io::Error::other(
                    "Plugin folder already exists outside this installation",
                ));
            }
            let change = Change {
                id: id.into(),
                generation: record.generation.clone(),
                had_directory,
            };
            let stage = self.root.join(".plugin-stage");
            fs::create_dir(&stage)?;
            if let Some(p) = package {
                p.write_directory(&stage.join("new"))?;
            }
            let mut journal = fs::File::create_new(stage.join("change.json"))?;
            serde_json::to_writer(&mut journal, &change)?;
            journal.flush()?;
            journal.sync_all()?;
            drop(journal);
            let pending = self.root.join(".plugin-change");
            fs::rename(stage, &pending)?;
            if had_directory {
                fs::rename(&active, pending.join("old"))?;
            }
            if package.is_some() {
                fs::rename(pending.join("new"), active)?;
            }
            Ok(())
        };
        let result = prepare()
            .map_err(|e| e.to_string())
            .and_then(|()| self.save(id, record));
        // The registry rename is the commit point. A failed cleanup is retried on open or before the next install.
        let recovered = self.recover_change();
        if let Err(error) = result {
            recovered.map_err(|e| format!("{error}; could not restore plugin directory: {e}"))?;
            return Err(error);
        }
        Ok(())
    }

    pub(super) fn recover_change(&self) -> io::Result<()> {
        let stage = self.root.join(".plugin-stage");
        if stage.try_exists()? {
            plain_path(&stage)?;
            fs::remove_dir_all(&stage)?;
        }
        let pending = self.root.join(".plugin-change");
        if !pending.try_exists()? {
            return Ok(());
        }
        plain_path(&pending)?;
        let change: Change = serde_json::from_reader(fs::File::open(pending.join("change.json"))?)?;
        let active = directory(&self.root, &change.id)?;
        let committed = self
            .records
            .get(&change.id)
            .is_some_and(|r| r.generation == change.generation && r.package.is_none());
        if !committed {
            let old = pending.join("old");
            let staged = pending.join("new");
            if old.try_exists()? {
                if active.try_exists()? {
                    fs::rename(&active, &staged)?;
                }
                fs::rename(old, &active)?;
            } else if !change.had_directory && !staged.try_exists()? && active.try_exists()? {
                fs::rename(active, staged)?;
            }
        }
        // Detach the complete journal before removing its contents so recovery is idempotent.
        fs::rename(pending, &stage)?;
        fs::remove_dir_all(stage)
    }
}
