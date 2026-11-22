use super::windows_credentials;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;

/// The ledger contains ownership and configuration identities, never passwords.
pub trait CredentialStore {
    fn candidates(&self) -> Result<Vec<String>, String>;
    fn prepare(&self, identity: &str) -> Result<String, String>;
    fn write(&self, id: &str, username: &str, password: &str) -> Result<(), String>;
    fn read(&self, id: &str, identity: &str) -> Result<Option<String>, String>;
    fn remove(&self, id: &str) -> Result<(), String>;
    fn read_legacy(&self) -> Result<Option<String>, String>;
    fn retire_legacy(&self) -> Result<(), String>;
}

pub struct WebDavCredentialStore {
    directory: PathBuf,
    prefix: String,
    previous_prefix: Option<String>,
    legacy_targets: Vec<String>,
}

impl WebDavCredentialStore {
    pub fn scoped(
        directory: PathBuf,
        prefix: String,
        previous_prefix: Option<String>,
        legacy_targets: Vec<String>,
    ) -> Self {
        Self {
            directory,
            prefix,
            previous_prefix,
            legacy_targets,
        }
    }

    fn record_path(&self, id: &str) -> Result<PathBuf, String> {
        if uuid::Uuid::parse_str(id)
            .map(|value| value.to_string())
            .as_deref()
            != Ok(id)
        {
            return Err("invalid WebDAV credential reference".into());
        }
        Ok(self.directory.join(format!("{id}.credential")))
    }

    fn target(&self, id: &str) -> Result<String, String> {
        let path = self.record_path(id)?;
        if !path.is_file() {
            return Err("WebDAV credential is not owned by this installation".into());
        }
        Ok(format!("{}.{}", self.prefix, id))
    }
}

impl CredentialStore for WebDavCredentialStore {
    fn candidates(&self) -> Result<Vec<String>, String> {
        if !self.directory.exists() {
            return Ok(vec![]);
        }
        let mut ids = Vec::new();
        for entry in fs::read_dir(&self.directory).map_err(|e| e.to_string())? {
            let path = entry.map_err(|e| e.to_string())?.path();
            if path.extension().and_then(|s| s.to_str()) != Some("credential") {
                continue;
            }
            let Some(id) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            if self.record_path(id).is_ok() {
                ids.push(id.to_string());
            }
        }
        Ok(ids)
    }

    fn prepare(&self, identity: &str) -> Result<String, String> {
        fs::create_dir_all(&self.directory).map_err(|e| e.to_string())?;
        let id = uuid::Uuid::new_v4().to_string();
        let mut record = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(self.record_path(&id)?)
            .map_err(|e| e.to_string())?;
        // Durably record ownership before any Credential Manager side effect. An
        // interrupted/partial record is still safe to collect by its unique id.
        record
            .write_all(identity.as_bytes())
            .and_then(|_| record.sync_all())
            .map_err(|e| e.to_string())?;
        Ok(id)
    }

    fn write(&self, id: &str, username: &str, password: &str) -> Result<(), String> {
        let target = self.target(id)?;
        windows_credentials::save_webdav_password(&target, username, password)?;
        if windows_credentials::read_webdav_password(&target)?.as_deref() != Some(password) {
            return Err("failed to verify candidate WebDAV credential".into());
        }
        Ok(())
    }

    fn read(&self, id: &str, identity: &str) -> Result<Option<String>, String> {
        let path = self.record_path(id)?;
        let recorded = match fs::read_to_string(path) {
            Ok(value) => value,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        if recorded != identity {
            return Ok(None);
        }
        let password = windows_credentials::read_webdav_password(&self.target(id)?)?;
        match (password, &self.previous_prefix) {
            (None, Some(prefix)) => {
                windows_credentials::read_webdav_password(&format!("{prefix}.{id}"))
            }
            (password, _) => Ok(password),
        }
    }

    fn remove(&self, id: &str) -> Result<(), String> {
        let path = self.record_path(id)?;
        if !path.exists() {
            return Ok(());
        }
        windows_credentials::delete_webdav_password(&self.target(id)?)?;
        if let Some(prefix) = &self.previous_prefix {
            windows_credentials::delete_webdav_password(&format!("{prefix}.{id}"))?;
        }
        fs::remove_file(path).map_err(|e| e.to_string())
    }

    fn read_legacy(&self) -> Result<Option<String>, String> {
        for target in &self.legacy_targets {
            if let Some(password) = windows_credentials::read_webdav_password(target)? {
                return Ok(Some(password));
            }
        }
        Ok(None)
    }

    fn retire_legacy(&self) -> Result<(), String> {
        for target in &self.legacy_targets {
            windows_credentials::delete_webdav_password(target)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_foreign_ledger_references_and_traversal() {
        let store = WebDavCredentialStore {
            directory: std::env::temp_dir().join(uuid::Uuid::new_v4().to_string()),
            prefix: "com.ceceliaee.patina.test.webdav".into(),
            previous_prefix: None,
            legacy_targets: vec![],
        };
        assert!(store.record_path("../production").is_err());
        assert!(store.target(&uuid::Uuid::new_v4().to_string()).is_err());
        assert_eq!(store.read_legacy().unwrap(), None);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn isolated_windows_credential_ledger_survives_reopen_and_cleans_exact_target() {
        let store = WebDavCredentialStore {
            directory: std::env::temp_dir()
                .join(format!("patina-credential-test-{}", uuid::Uuid::new_v4())),
            prefix: "com.ceceliaee.patina.test.webdav".into(),
            previous_prefix: None,
            legacy_targets: vec![],
        };
        let id = store.prepare("config-identity").unwrap();
        let outcome = std::panic::catch_unwind(|| {
            store
                .write(&id, "fixture-only", "isolated-test-secret")
                .unwrap();
            let reopened = WebDavCredentialStore {
                directory: store.directory.clone(),
                prefix: "Patina.Test.WebDAV".into(),
                previous_prefix: Some(store.prefix.clone()),
                legacy_targets: vec![],
            };
            assert_eq!(
                reopened.read(&id, "config-identity").unwrap().as_deref(),
                Some("isolated-test-secret")
            );
            assert_eq!(reopened.read(&id, "different-config").unwrap(), None);
            reopened
                .write(&id, "fixture-only", "replacement-password")
                .unwrap();
            assert_eq!(
                reopened.read(&id, "config-identity").unwrap().as_deref(),
                Some("replacement-password")
            );
            assert_eq!(reopened.candidates().unwrap(), vec![id.clone()]);
            assert_eq!(
                fs::read_to_string(store.record_path(&id).unwrap()).unwrap(),
                "config-identity"
            );
            reopened.remove(&id).unwrap();
            assert!(
                windows_credentials::read_webdav_password(&format!("{}.{}", store.prefix, id))
                    .unwrap()
                    .is_none()
            );
        });
        store.remove(&id).unwrap();
        assert!(store.candidates().unwrap().is_empty());
        fs::remove_dir(&store.directory).unwrap();
        if let Err(error) = outcome {
            std::panic::resume_unwind(error);
        }
    }
}
