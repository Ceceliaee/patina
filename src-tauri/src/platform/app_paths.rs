use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};

pub const PRODUCT_FOLDER: &str = "Patina";
pub const PRODUCT_FOLDER_LOCAL: &str = "Patina Local";
pub const PRODUCT_FOLDER_DEV: &str = "Patina Dev";

pub const IDENTIFIER_PROD: &str = "com.ceceliaee.patina";
pub const IDENTIFIER_LOCAL: &str = "com.ceceliaee.patina.local";
pub const IDENTIFIER_DEV: &str = "com.ceceliaee.patina.dev";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppProfile {
    Production,
    Local,
    Dev,
}

impl AppProfile {
    pub fn from_identifier(identifier: &str) -> Self {
        match identifier {
            IDENTIFIER_PROD => Self::Production,
            IDENTIFIER_LOCAL => Self::Local,
            IDENTIFIER_DEV => Self::Dev,
            _ => Self::Production,
        }
    }

    pub fn product_folder(self) -> &'static str {
        match self {
            Self::Production => PRODUCT_FOLDER,
            Self::Local => PRODUCT_FOLDER_LOCAL,
            Self::Dev => PRODUCT_FOLDER_DEV,
        }
    }

    pub fn webview_product_folder(self) -> &'static str {
        #[cfg(debug_assertions)]
        {
            if self == Self::Production {
                return PRODUCT_FOLDER_DEV;
            }
        }

        self.product_folder()
    }

    pub fn key(self) -> &'static str {
        match self {
            Self::Production => "production",
            Self::Local => "local",
            Self::Dev => "dev",
        }
    }
}

pub fn app_profile<R: Runtime>(app: &AppHandle<R>) -> AppProfile {
    AppProfile::from_identifier(&app.config().identifier)
}

pub fn product_roaming_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let isolated_root = isolated_e2e_root()?;
        ensure_persistent_profile_isolated(app_profile(app), isolated_root.is_some())?;
        if let Some(root) = isolated_root {
            return Ok(root.join("data"));
        }
    }

    Ok(roaming_root(app)?.join(app_profile(app).product_folder()))
}

pub fn product_webview_data_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        let isolated_root = isolated_e2e_root()?;
        ensure_persistent_profile_isolated(app_profile(app), isolated_root.is_some())?;
        if let Some(root) = isolated_root {
            return Ok(root.join("webview"));
        }
    }

    Ok(local_root(app)?.join(app_profile(app).webview_product_folder()))
}

#[cfg(any(debug_assertions, test))]
fn persistent_profile_is_allowed(
    profile: AppProfile,
    debug_build: bool,
    has_isolated_override: bool,
) -> bool {
    !debug_build || profile != AppProfile::Production || has_isolated_override
}

#[cfg(debug_assertions)]
fn ensure_persistent_profile_isolated(
    profile: AppProfile,
    has_isolated_override: bool,
) -> Result<(), String> {
    if persistent_profile_is_allowed(profile, cfg!(debug_assertions), has_isolated_override) {
        return Ok(());
    }

    Err(
        "refusing to open production Patina data from a debug build; start development with `npm run tauri dev` so src-tauri/tauri.dev.conf.json is applied"
            .to_string(),
    )
}

#[cfg(debug_assertions)]
fn isolated_e2e_root() -> Result<Option<PathBuf>, String> {
    if std::env::var("PATINA_E2E").as_deref() != Ok("1") {
        return Ok(None);
    }

    let root = std::env::var_os("PATINA_E2E_DATA_ROOT")
        .map(PathBuf::from)
        .ok_or_else(|| "PATINA_E2E_DATA_ROOT is required when PATINA_E2E=1".to_string())?;
    if !root.is_absolute() {
        return Err("PATINA_E2E_DATA_ROOT must be absolute".to_string());
    }
    Ok(Some(root))
}

fn roaming_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    parent_of_identifier_dir(
        app.path()
            .app_data_dir()
            .map_err(|error| format!("failed to resolve app data dir: {error}"))?,
    )
}

fn local_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    parent_of_identifier_dir(
        app.path()
            .app_local_data_dir()
            .map_err(|error| format!("failed to resolve app local data dir: {error}"))?,
    )
}

fn parent_of_identifier_dir(path: PathBuf) -> Result<PathBuf, String> {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .map(Path::to_path_buf)
        .ok_or_else(|| {
            format!(
                "failed to resolve parent directory for identifier path `{}`",
                path.display()
            )
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_profile_from_current_identifiers() {
        assert_eq!(
            AppProfile::from_identifier("com.ceceliaee.patina"),
            AppProfile::Production
        );
        assert_eq!(
            AppProfile::from_identifier("com.ceceliaee.patina.local"),
            AppProfile::Local
        );
        assert_eq!(
            AppProfile::from_identifier("com.ceceliaee.patina.dev"),
            AppProfile::Dev
        );
    }

    #[test]
    fn profile_folder_names_are_user_visible() {
        assert_eq!(AppProfile::Production.product_folder(), "Patina");
        assert_eq!(AppProfile::Local.product_folder(), "Patina Local");
        assert_eq!(AppProfile::Dev.product_folder(), "Patina Dev");
    }

    #[test]
    fn debug_production_build_uses_dev_webview_folder() {
        #[cfg(debug_assertions)]
        assert_eq!(
            AppProfile::Production.webview_product_folder(),
            "Patina Dev"
        );

        #[cfg(not(debug_assertions))]
        assert_eq!(AppProfile::Production.webview_product_folder(), "Patina");
    }

    #[test]
    fn debug_build_requires_an_isolated_persistent_profile() {
        assert!(!persistent_profile_is_allowed(
            AppProfile::Production,
            true,
            false,
        ));
        assert!(persistent_profile_is_allowed(
            AppProfile::Production,
            true,
            true,
        ));
        assert!(persistent_profile_is_allowed(AppProfile::Dev, true, false,));
        assert!(persistent_profile_is_allowed(
            AppProfile::Local,
            true,
            false,
        ));
    }

    #[test]
    fn release_build_can_use_the_production_profile() {
        assert!(persistent_profile_is_allowed(
            AppProfile::Production,
            false,
            false,
        ));
    }

    #[test]
    fn profile_folder_names_do_not_use_internal_identifiers() {
        for profile in [AppProfile::Production, AppProfile::Local, AppProfile::Dev] {
            let folder = profile.product_folder();
            assert!(!folder.contains("com.ceceliaee.patina"));
            assert!(!folder.contains("io.github"));
        }
    }

    #[test]
    fn profile_keys_are_stable_anchor_identifiers() {
        assert_eq!(AppProfile::Production.key(), "production");
        assert_eq!(AppProfile::Local.key(), "local");
        assert_eq!(AppProfile::Dev.key(), "dev");
    }
}
