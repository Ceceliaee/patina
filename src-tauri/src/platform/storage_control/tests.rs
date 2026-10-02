use super::*;
use std::fs;
use std::sync::atomic::{AtomicU64, Ordering};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct RegistryDeny<'a> {
    key: &'a str,
    rights: &'a str,
}
impl RegistryDeny<'_> {
    fn apply(&self, remove: bool) {
        use std::os::windows::process::CommandExt;
        assert!(self.key.starts_with(r"Software\Patina\Storage\tests\"));
        let output = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", r#"
                $ErrorActionPreference = 'Stop'
                $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($env:PATINA_TEST_REG_KEY,
                    [Microsoft.Win32.RegistryKeyPermissionCheck]::ReadWriteSubTree,
                    [System.Security.AccessControl.RegistryRights]'ReadPermissions,ChangePermissions')
                try {
                    $acl = $key.GetAccessControl()
                    $sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
                    $rule = New-Object System.Security.AccessControl.RegistryAccessRule($sid,
                        [System.Security.AccessControl.RegistryRights]$env:PATINA_TEST_REG_RIGHTS,
                        [System.Security.AccessControl.AccessControlType]::Deny)
                    if ($env:PATINA_TEST_REG_REMOVE -eq '1') { $acl.RemoveAccessRuleSpecific($rule) }
                    else { $acl.AddAccessRule($rule) }
                    $key.SetAccessControl($acl)
                } finally { $key.Close() }
            "#])
            .env("PATINA_TEST_REG_KEY", self.key)
            .env("PATINA_TEST_REG_RIGHTS", self.rights)
            .env("PATINA_TEST_REG_REMOVE", if remove { "1" } else { "0" })
            .creation_flags(0x08000000)
            .output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
}
impl Drop for RegistryDeny<'_> {
    fn drop(&mut self) {
        self.apply(true);
    }
}

struct Fixture {
    store: StorageControlStore,
    root: PathBuf,
}

#[test]
fn registry_access_denial_preserves_old_configuration_and_never_uses_defaults() {
    for rights in ["QueryValues", "SetValue"] {
        let f = Fixture::new();
        f.anchors();
        if rights == "QueryValues" {
            f.store
                .save(
                    &file_import::read("dev", &f.store.import_data, &f.store.import_cache).unwrap(),
                )
                .unwrap();
        } else {
            // Leave an existing empty key, as after an interrupted first creation.
            storage_registry::write(&f.store.key, b"temporary").unwrap();
            let output = std::process::Command::new("reg.exe")
                .args([
                    "delete",
                    &format!("HKCU\\{}", f.store.key),
                    "/v",
                    "State",
                    "/f",
                ])
                .output()
                .unwrap();
            assert!(output.status.success());
        }
        let denied = RegistryDeny {
            key: &f.store.key,
            rights,
        };
        denied.apply(false);
        let error = f.store.prepare().unwrap_err();
        assert!(
            error.contains(if rights == "QueryValues" {
                "cannot open storage registry key"
            } else {
                "cannot create storage registry key"
            }),
            "{rights}: {error}"
        );
        assert!(f.store.import_data.join("data-anchor.json").exists());
        assert!(f.store.import_cache.join("cache-anchor.json").exists());
        drop(denied);
        f.store.prepare().unwrap();
        assert_eq!(
            f.store.load().unwrap().data_root,
            Some(f.root.join("custom-data"))
        );
    }
}

#[test]
fn flush_and_readback_failures_do_not_clean_recovery_sources() {
    for phase in ["flush", "readback"] {
        let f = Fixture::new();
        f.anchors();
        let error =
            storage_registry::with_failure(&f.store.key, phase, || f.store.prepare()).unwrap_err();
        assert!(error.contains(if phase == "flush" {
            "flush"
        } else {
            "verification"
        }));
        assert!(f.store.import_data.join("data-anchor.json").exists());
        assert!(f.store.import_cache.join("cache-anchor.json").exists());
        if phase == "flush" {
            // SetValue succeeded: the next startup must persist that same snapshot before cleanup.
            f.store.prepare().unwrap();
            assert_eq!(
                f.store.load().unwrap().data_root,
                Some(f.root.join("custom-data"))
            );
        } else {
            // The mismatched value is corrupt, so startup must stop rather than reimport or default.
            assert!(f.store.prepare().is_err());
            assert!(f.store.import_data.join("data-anchor.json").exists());
        }
    }
}
impl Fixture {
    fn new() -> Self {
        let id = format!(
            "{}-{}-{}",
            std::process::id(),
            now_ms(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        );
        let root = std::env::temp_dir().join(format!("patina-storage-control-{id}"));
        fs::create_dir_all(root.join("roaming")).unwrap();
        fs::create_dir_all(root.join("local")).unwrap();
        let store = StorageControlStore::new(
            format!(r"Software\Patina\Storage\tests\{id}"),
            "dev".into(),
            root.join("roaming"),
            root.join("local"),
        );
        Self { store, root }
    }
    fn anchors(&self) {
        fs::write(self.store.import_data.join("data-anchor.json"), serde_json::to_vec(&serde_json::json!({
            "format":"patina.data-anchor.v1", "profile":"dev", "dataRoot":self.root.join("custom-data"), "updatedAtMs":1
        })).unwrap()).unwrap();
        fs::write(self.store.import_cache.join("cache-anchor.json"), serde_json::to_vec(&serde_json::json!({
            "format":"patina.cache-anchor.v1", "profile":"dev", "webviewRoot":self.root.join("custom-cache"), "updatedAtMs":1
        })).unwrap()).unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        storage_registry::remove_test_key(&self.store.key);
        assert!(self.root.starts_with(std::env::temp_dir()));
        assert!(self
            .root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("patina-storage-control-"));
        fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn imports_both_locations_and_survives_deleted_original_directories() {
    let f = Fixture::new();
    f.anchors();
    f.store.prepare().unwrap();
    assert!(!f.store.import_data.join("data-anchor.json").exists());
    assert!(!f.store.import_cache.join("cache-anchor.json").exists());
    fs::remove_dir_all(&f.store.import_data).unwrap();
    fs::remove_dir_all(&f.store.import_cache).unwrap();
    for _ in 0..2 {
        f.store.prepare().unwrap();
        let s = f.store.load().unwrap();
        assert_eq!(s.data_root, Some(f.root.join("custom-data")));
        assert_eq!(s.webview_root, Some(f.root.join("custom-cache")));
    }
}

#[test]
fn imports_each_location_independently_and_preserves_defaults() {
    for data_only in [true, false] {
        let f = Fixture::new();
        f.anchors();
        let absent = if data_only {
            f.store.import_cache.join("cache-anchor.json")
        } else {
            f.store.import_data.join("data-anchor.json")
        };
        fs::remove_file(absent).unwrap();
        f.store.prepare().unwrap();
        let s = f.store.load().unwrap();
        assert_eq!(s.data_root.is_some(), data_only);
        assert_eq!(s.webview_root.is_some(), !data_only);
    }
}

#[test]
fn default_initialization_never_reimports_stale_anchors() {
    let f = Fixture::new();
    f.store.prepare().unwrap();
    f.anchors();
    f.store.prepare().unwrap();
    assert!(f.store.load().unwrap().data_root.is_none());
    assert!(f.store.import_data.join("data-anchor.json").exists());
}

#[test]
fn corrupt_new_state_never_falls_back_to_valid_old_files() {
    let f = Fixture::new();
    f.anchors();
    storage_registry::write(&f.store.key, b"broken").unwrap();
    assert!(f.store.prepare().is_err());
    assert!(f.store.import_data.join("data-anchor.json").exists());
}

#[test]
fn invalid_old_state_is_preserved_without_creating_new_state() {
    let f = Fixture::new();
    f.anchors();
    fs::write(f.store.import_cache.join("cache-anchor.json"), b"broken").unwrap();
    assert!(f.store.prepare().is_err());
    assert!(storage_registry::read(&f.store.key).unwrap().is_none());
    assert!(f.store.import_data.join("data-anchor.json").exists());
}

#[test]
fn previous_is_imported_but_uncommitted_tmp_is_not() {
    let f = Fixture::new();
    f.anchors();
    let path = f.store.import_data.join("data-anchor.json");
    fs::rename(&path, path.with_extension("previous")).unwrap();
    fs::write(path.with_extension("tmp"), b"broken").unwrap();
    f.store.prepare().unwrap();
    assert_eq!(
        f.store.load().unwrap().data_root,
        Some(f.root.join("custom-data"))
    );
    assert!(!path.with_extension("previous").exists());
    assert!(!path.with_extension("tmp").exists());
}

#[test]
fn interrupted_cleanup_reuses_committed_snapshot() {
    let f = Fixture::new();
    f.anchors();
    let state = file_import::read("dev", &f.store.import_data, &f.store.import_cache).unwrap();
    f.store.save(&state).unwrap();
    fs::remove_file(f.store.import_data.join("data-anchor.json")).unwrap();
    f.store.prepare().unwrap();
    assert_eq!(f.store.load().unwrap().data_root, state.data_root);
    assert!(f.store.load().unwrap().cleanup_files.is_empty());
}

#[test]
fn locked_old_file_keeps_committed_locations_and_retries_cleanup() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    f.anchors();
    let state = file_import::read("dev", &f.store.import_data, &f.store.import_cache).unwrap();
    f.store.save(&state).unwrap();
    let path = f.store.import_data.join("data-anchor.json");
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    f.store.prepare().unwrap();
    let saved = f.store.load().unwrap();
    assert_eq!(saved.data_root, state.data_root);
    assert!(!saved.cleanup_files.is_empty());
    assert!(saved.maintenance.last_maintenance_error.is_some());
    drop(locked);
    f.store.prepare().unwrap();
    assert!(!path.exists());
    assert!(f.store.load().unwrap().cleanup_files.is_empty());
}

#[test]
fn pending_operation_and_both_locations_are_one_snapshot() {
    let f = Fixture::new();
    f.anchors();
    let pending = PendingStorageMigration {
        format: STORAGE_MIGRATION_PENDING_FORMAT.into(),
        id: "operation-1".into(),
        source_data_root: f.root.join("custom-data"),
        target_data_root: f.root.join("next-data"),
        target_webview_root: f.root.join("custom-cache"),
        created_at_ms: 1,
        state: "pending-restart".into(),
        clear_webview_cache: false,
    };
    fs::write(
        f.store.import_data.join("storage-migration-pending.json"),
        serde_json::to_vec(&pending).unwrap(),
    )
    .unwrap();
    f.store.prepare().unwrap();
    assert_eq!(f.store.load().unwrap().pending.unwrap().id, pending.id);
    f.store
        .update(|s| {
            s.data_root = Some(pending.target_data_root.clone());
            s.pending.as_mut().unwrap().state = "locations-committed".into();
            Ok(())
        })
        .unwrap();
    let s = f.store.load().unwrap();
    assert_eq!(s.data_root, Some(pending.target_data_root));
    assert_eq!(s.webview_root, Some(pending.target_webview_root));
    assert_eq!(s.pending.unwrap().state, "locations-committed");
}

#[test]
fn foreign_profile_is_not_imported_or_deleted() {
    let f = Fixture::new();
    f.anchors();
    let path = f.store.import_data.join("data-anchor.json");
    let raw = fs::read_to_string(&path)
        .unwrap()
        .replace("dev", "production");
    fs::write(&path, raw).unwrap();
    f.store.prepare().unwrap();
    assert!(f.store.load().unwrap().data_root.is_none());
    assert!(path.exists());
}

#[test]
fn cleanup_rejects_paths_outside_import_allowlist() {
    let f = Fixture::new();
    let data = f.root.join("patina.db");
    fs::write(&data, b"preserve").unwrap();
    assert!(file_import::cleanup(
        std::slice::from_ref(&data),
        &f.store.import_data,
        &f.store.import_cache
    )
    .is_err());
    assert_eq!(fs::read(data).unwrap(), b"preserve");
}

#[test]
fn concurrent_updates_preserve_other_fields() {
    let f = Fixture::new();
    f.store.prepare().unwrap();
    std::thread::scope(|scope| {
        scope.spawn(|| {
            f.store
                .update(|s| {
                    s.data_root = Some(f.root.join("data"));
                    Ok(())
                })
                .unwrap()
        });
        scope.spawn(|| {
            f.store
                .update(|s| {
                    s.webview_root = Some(f.root.join("cache"));
                    Ok(())
                })
                .unwrap()
        });
    });
    let state = f.store.load().unwrap();
    assert_eq!(state.data_root, Some(f.root.join("data")));
    assert_eq!(state.webview_root, Some(f.root.join("cache")));
}

#[test]
fn invalid_candidate_does_not_replace_committed_state() {
    let f = Fixture::new();
    f.store.prepare().unwrap();
    assert!(f
        .store
        .update(|s| {
            s.data_root = Some(PathBuf::from("relative"));
            Ok(())
        })
        .is_err());
    assert!(f.store.load().unwrap().data_root.is_none());
}

#[test]
fn registry_state_is_readable_by_fresh_process() {
    const CHILD: &str = "PATINA_STORAGE_TEST_KEY";
    if let Ok(key) = std::env::var(CHILD) {
        assert!(key.starts_with(r"Software\Patina\Storage\tests\"));
        let raw = storage_registry::read(&key).unwrap().unwrap();
        let state: StorageControl = serde_json::from_slice(&raw).unwrap();
        state.validate("dev").unwrap();
        assert!(state.data_root.is_some());
        return;
    }
    let f = Fixture::new();
    f.anchors();
    f.store.prepare().unwrap();
    fs::remove_dir_all(&f.store.import_data).unwrap();
    fs::remove_dir_all(&f.store.import_cache).unwrap();
    let status = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "platform::storage_control::tests::registry_state_is_readable_by_fresh_process",
            "--nocapture",
        ])
        .env(CHILD, &f.store.key)
        .status()
        .unwrap();
    assert!(status.success());
}

#[test]
fn process_exit_at_import_boundaries_preserves_locations_and_database() {
    const PHASE: &str = "PATINA_STORAGE_TEST_PHASE";
    if let Ok(phase) = std::env::var(PHASE) {
        let root = PathBuf::from(std::env::var_os("PATINA_STORAGE_TEST_ROOT").unwrap());
        let key = std::env::var("PATINA_STORAGE_TEST_KEY").unwrap();
        assert!(key.starts_with(r"Software\Patina\Storage\tests\"));
        assert!(root.starts_with(std::env::temp_dir()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("patina-storage-control-"));
        let store =
            StorageControlStore::new(key, "dev".into(), root.join("roaming"), root.join("local"));
        let state = file_import::read("dev", &store.import_data, &store.import_cache).unwrap();
        if phase != "before-commit" {
            store.save(&state).unwrap();
        }
        if phase == "partial-cleanup" {
            fs::remove_file(store.import_data.join("data-anchor.json")).unwrap();
        }
        if phase == "after-cleanup" {
            store.prepare().unwrap();
        }
        // End the process without unwinding; recovery cannot use in-memory state.
        std::process::exit(0);
    }
    for phase in [
        "before-commit",
        "after-commit",
        "partial-cleanup",
        "after-cleanup",
    ] {
        let f = Fixture::new();
        f.anchors();
        let db = f.root.join("custom-data").join("patina.db");
        fs::create_dir_all(db.parent().unwrap()).unwrap();
        fs::write(&db, b"unchanged database payload").unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "platform::storage_control::tests::process_exit_at_import_boundaries_preserves_locations_and_database"])
            .env(PHASE, phase)
            .env("PATINA_STORAGE_TEST_ROOT", &f.root)
            .env("PATINA_STORAGE_TEST_KEY", &f.store.key)
            .status().unwrap();
        assert!(status.success(), "{phase}");
        f.store.prepare().unwrap();
        assert_eq!(
            f.store.load().unwrap().data_root,
            Some(f.root.join("custom-data"))
        );
        assert_eq!(
            f.store.load().unwrap().webview_root,
            Some(f.root.join("custom-cache"))
        );
        assert_eq!(fs::read(&db).unwrap(), b"unchanged database payload");
    }
}

#[test]
fn oversize_commit_keeps_previous_snapshot() {
    let f = Fixture::new();
    f.store.prepare().unwrap();
    let before = storage_registry::read(&f.store.key).unwrap();
    assert!(f
        .store
        .update(|s| {
            s.maintenance.last_maintenance_error =
                Some("x".repeat(storage_registry::MAX_STATE_BYTES));
            Ok(())
        })
        .is_err());
    assert_eq!(storage_registry::read(&f.store.key).unwrap(), before);
}

#[test]
fn unreadable_old_file_and_corrupt_pending_do_not_initialize_defaults() {
    use std::os::windows::fs::OpenOptionsExt;
    let f = Fixture::new();
    f.anchors();
    let path = f.store.import_data.join("data-anchor.json");
    let locked = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&path)
        .unwrap();
    assert!(f.store.prepare().is_err());
    assert!(storage_registry::read(&f.store.key).unwrap().is_none());
    drop(locked);
    fs::write(
        f.store.import_data.join("storage-migration-pending.json"),
        b"corrupt",
    )
    .unwrap();
    assert!(f.store.prepare().is_err());
    assert!(storage_registry::read(&f.store.key).unwrap().is_none());
    assert!(path.exists());
}

#[test]
fn imports_v180_pending_and_separate_user_cache_request() {
    for has_migration in [false, true] {
        let f = Fixture::new();
        f.anchors();
        if has_migration {
            fs::write(f.store.import_data.join("storage-migration-pending.json"), serde_json::to_vec(&serde_json::json!({
                "format":"patina.storage-migration-pending.v1", "id":"old-operation",
                "sourceDataRoot":f.root.join("custom-data"), "targetDataRoot":f.root.join("next-data"),
                "targetWebviewRoot":f.root.join("custom-cache"), "createdAtMs":1,"state":"pending-restart"
            })).unwrap()).unwrap();
        }
        fs::write(
            f.store.import_data.join("storage-maintenance-state.json"),
            serde_json::to_vec(&serde_json::json!({
                "format":"patina.storage-maintenance-state.v1", "lastWebviewCacheTrimAtMs":42,
                "pendingWebviewCacheClear":true, "pendingWebviewCacheClearSource":"user",
                "lastMaintenanceError":"old diagnostic", "lastMigrationStatus":"completed"
            }))
            .unwrap(),
        )
        .unwrap();
        f.store.prepare().unwrap();
        let state = f.store.load().unwrap();
        let pending = state.pending.unwrap();
        assert_eq!(pending.format, STORAGE_MIGRATION_PENDING_FORMAT);
        assert!(pending.clear_webview_cache);
        assert_eq!(
            pending.target_data_root,
            f.root.join(if has_migration {
                "next-data"
            } else {
                "custom-data"
            })
        );
        assert_eq!(state.maintenance.last_webview_cache_trim_at_ms, Some(42));
        assert_eq!(
            state.maintenance.last_maintenance_error.as_deref(),
            Some("old diagnostic")
        );
    }
}
