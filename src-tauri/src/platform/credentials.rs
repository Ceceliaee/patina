use crate::platform::app_paths::AppProfile;

mod store;
pub use store::{CredentialStore, WebDavCredentialStore};

const WEBDAV_BACKUP_LEGACY_CREDENTIAL_TARGET: &str = "com.ceceliaee.patina.backup.webdav.default";
const WEBDAV_BACKUP_CREDENTIAL_TARGET_PREFIX: &str = "com.ceceliaee.patina.backup.webdav";

fn webdav_backup_credential_target(profile: AppProfile) -> String {
    format!("{WEBDAV_BACKUP_CREDENTIAL_TARGET_PREFIX}.{}", profile.key())
}

fn credential_lookup_targets(profile: AppProfile) -> Vec<String> {
    let mut targets = vec![webdav_backup_credential_target(profile)];
    if profile == AppProfile::Production {
        targets.push(WEBDAV_BACKUP_LEGACY_CREDENTIAL_TARGET.to_string());
    }
    targets
}

#[cfg(target_os = "windows")]
mod windows_credentials;
#[cfg(not(target_os = "windows"))]
mod windows_credentials {
    pub fn save_webdav_password(
        _credential_target: &str,
        _username: &str,
        _password: &str,
    ) -> Result<(), String> {
        Err("WebDAV credential storage is only available on Windows".to_string())
    }

    pub fn read_webdav_password(_credential_target: &str) -> Result<Option<String>, String> {
        Ok(None)
    }

    pub fn delete_webdav_password(_credential_target: &str) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webdav_credential_targets_are_isolated_by_app_profile() {
        let production = webdav_backup_credential_target(AppProfile::Production);
        let local = webdav_backup_credential_target(AppProfile::Local);
        let dev = webdav_backup_credential_target(AppProfile::Dev);

        assert_ne!(production, local);
        assert_ne!(production, dev);
        assert_ne!(local, dev);
        assert!(production.ends_with(".production"));
        assert!(local.ends_with(".local"));
        assert!(dev.ends_with(".dev"));
    }

    #[test]
    fn only_production_reads_the_legacy_unscoped_target_for_migration() {
        assert_eq!(credential_lookup_targets(AppProfile::Production).len(), 2);
        assert_eq!(credential_lookup_targets(AppProfile::Local).len(), 1);
        assert_eq!(credential_lookup_targets(AppProfile::Dev).len(), 1);
        assert_eq!(
            credential_lookup_targets(AppProfile::Production)[1],
            WEBDAV_BACKUP_LEGACY_CREDENTIAL_TARGET
        );
    }
}

use crate::platform::app_paths::{app_profile, product_roaming_data_dir};
use tauri::{AppHandle, Runtime};
impl WebDavCredentialStore {
    pub fn for_app<R: Runtime>(app: &AppHandle<R>) -> Result<Self, String> {
        let profile = app_profile(app);
        let directory = product_roaming_data_dir(app)?.join("webdav-credentials");
        // Test data roots must not read, overwrite or migrate a real profile's secret.
        let isolated = cfg!(debug_assertions) && std::env::var("PATINA_E2E").as_deref() == Ok("1");
        Ok(Self::scoped(
            directory,
            format!(
                "{WEBDAV_BACKUP_CREDENTIAL_TARGET_PREFIX}.{}.v2",
                profile.key()
            ),
            if isolated {
                vec![]
            } else {
                credential_lookup_targets(profile)
            },
        ))
    }
}
