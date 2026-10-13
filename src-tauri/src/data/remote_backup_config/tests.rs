use super::*;
use sqlx::Executor;
use std::collections::BTreeMap;
use std::sync::Mutex;

#[derive(Default)]
struct MemoryStore {
    records: Mutex<BTreeMap<String, (String, Option<String>)>>,
    legacy: Mutex<Option<String>>,
    fail_write: Mutex<bool>,
    corrupt_read: Mutex<bool>,
    fail_cleanup: Mutex<bool>,
}

impl CredentialStore for MemoryStore {
    fn candidates(&self) -> Result<Vec<String>, String> {
        Ok(self.records.lock().unwrap().keys().cloned().collect())
    }
    fn prepare(&self, identity: &str) -> Result<String, String> {
        let id = uuid::Uuid::new_v4().to_string();
        self.records
            .lock()
            .unwrap()
            .insert(id.clone(), (identity.into(), None));
        Ok(id)
    }
    fn write(&self, id: &str, _: &str, secret: &str) -> Result<(), String> {
        if *self.fail_write.lock().unwrap() {
            return Err("credential write failed".into());
        }
        self.records.lock().unwrap().get_mut(id).unwrap().1 = Some(secret.into());
        Ok(())
    }
    fn read(&self, id: &str, identity: &str) -> Result<Option<String>, String> {
        if *self.corrupt_read.lock().unwrap() {
            return Ok(Some("readback mismatch".into()));
        }
        Ok(self
            .records
            .lock()
            .unwrap()
            .get(id)
            .filter(|(bound, _)| bound == identity)
            .and_then(|(_, secret)| secret.clone()))
    }
    fn remove(&self, id: &str) -> Result<(), String> {
        if *self.fail_cleanup.lock().unwrap() {
            return Err("cleanup denied".into());
        }
        self.records.lock().unwrap().remove(id);
        Ok(())
    }
    fn read_legacy(&self) -> Result<Option<String>, String> {
        Ok(self.legacy.lock().unwrap().clone())
    }
    fn retire_legacy(&self) -> Result<(), String> {
        *self.legacy.lock().unwrap() = None;
        Ok(())
    }
}

async fn database() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    pool.execute(crate::data::schema::CURRENT_BASELINE_SCHEMA_SQL)
        .await
        .unwrap();
    pool
}

fn input(secret: Option<&str>) -> SaveConfigInput {
    SaveConfigInput {
        url: "https://example.invalid/dav".into(),
        username: "alice".into(),
        remote_dir: Some("/Patina".into()),
        password_update: secret.map_or(PasswordUpdate::Keep, |s| PasswordUpdate::Replace {
            password: s.into(),
        }),
        operation_id: uuid::Uuid::new_v4().to_string(),
    }
}

async fn assert_pair(pool: &SqlitePool, store: &MemoryStore, secret: &str, username: &str) {
    let state = repository::load_state(pool).await.unwrap();
    assert_eq!(state.config.as_ref().unwrap().username, username);
    assert_eq!(password(store, &state).unwrap().as_deref(), Some(secret));
    let rows = crate::data::repositories::settings::load_rows(pool, None, None)
        .await
        .unwrap();
    assert!(
        rows.iter().all(|row| !row.value.contains(secret)),
        "secret was persisted in SQLite"
    );
}

#[tokio::test]
async fn invalid_input_and_failed_candidates_preserve_existing_pair() {
    let pool = database().await;
    let store = MemoryStore::default();
    save_in_pool(&pool, &store, input(Some("old-secret")))
        .await
        .unwrap();
    for invalid in ["url", "username", "directory", "password"] {
        let mut request = input(Some("new-secret"));
        match invalid {
            "url" => request.url = "http://untrusted.invalid".into(),
            "username" => request.username.clear(),
            "directory" => request.remote_dir = Some("../escape".into()),
            _ => {
                request.password_update = PasswordUpdate::Replace {
                    password: "".into(),
                }
            }
        }
        let ids = store.candidates().unwrap();
        assert!(
            save_in_pool(&pool, &store, request).await.is_err(),
            "{invalid}"
        );
        assert_eq!(store.candidates().unwrap(), ids);
        assert_pair(&pool, &store, "old-secret", "alice").await;
    }
    *store.fail_write.lock().unwrap() = true;
    assert!(save_in_pool(&pool, &store, input(Some("new-secret")))
        .await
        .is_err());
    *store.fail_write.lock().unwrap() = false;
    *store.corrupt_read.lock().unwrap() = true;
    assert!(save_in_pool(&pool, &store, input(Some("new-secret")))
        .await
        .is_err());
    *store.corrupt_read.lock().unwrap() = false;
    assert_pair(&pool, &store, "old-secret", "alice").await;
    assert_eq!(store.candidates().unwrap().len(), 1);
}

#[tokio::test]
async fn sqlite_failure_and_cleanup_failure_have_distinct_commit_outcomes() {
    let pool = database().await;
    let store = MemoryStore::default();
    save_in_pool(&pool, &store, input(Some("old-secret")))
        .await
        .unwrap();
    pool.execute("CREATE TRIGGER reject_config BEFORE UPDATE ON settings WHEN NEW.key='webdav_backup_url' BEGIN SELECT RAISE(ABORT, 'injected transaction failure'); END").await.unwrap();
    *store.fail_cleanup.lock().unwrap() = true;
    assert!(save_in_pool(&pool, &store, input(Some("new-secret")))
        .await
        .is_err());
    assert_pair(&pool, &store, "old-secret", "alice").await;
    assert!(
        snapshot_in_pool(&pool, &store)
            .await
            .unwrap()
            .cleanup_pending
    );
    pool.execute("DROP TRIGGER reject_config").await.unwrap();
    let mut request = input(Some("committed-secret"));
    request.username = "bob".into();
    let saved = save_in_pool(&pool, &store, request).await.unwrap();
    assert!(saved.cleanup_pending);
    assert_pair(&pool, &store, "committed-secret", "bob").await;
    *store.fail_cleanup.lock().unwrap() = false;
    assert!(
        !snapshot_in_pool(&pool, &store)
            .await
            .unwrap()
            .cleanup_pending
    );
    assert_eq!(store.candidates().unwrap().len(), 1);
}

#[tokio::test]
async fn recovery_at_each_commit_boundary_and_lost_reply_are_idempotent() {
    let pool = database().await;
    let store = MemoryStore::default();
    save_in_pool(&pool, &store, input(Some("old-secret")))
        .await
        .unwrap();
    let old = repository::load_state(&pool).await.unwrap();
    let config = old.config.as_ref().unwrap();
    let identity = repository::target_identity(config);
    // Restart with a durable candidate record but no credential / no DB commit.
    for write_secret in [false, true] {
        let candidate = store.prepare(&identity).unwrap();
        if write_secret {
            store.write(&candidate, "alice", "orphan-secret").unwrap();
        }
        snapshot_in_pool(&pool, &store).await.unwrap();
        assert_pair(&pool, &store, "old-secret", "alice").await;
        assert_eq!(store.candidates().unwrap().len(), 1);
    }
    // Restart after commit but before cleanup. Readers must choose the new generation.
    let candidate = store.prepare(&identity).unwrap();
    store.write(&candidate, "alice", "new-secret").unwrap();
    let request = input(Some("new-secret"));
    repository::commit_config(&pool, Some(config), &candidate, &request.operation_id, None)
        .await
        .unwrap();
    let recovered = snapshot_in_pool(&pool, &store).await.unwrap();
    assert!(recovered.has_secret);
    assert_pair(&pool, &store, "new-secret", "alice").await;
    assert_eq!(store.candidates().unwrap(), vec![candidate.clone()]);
    // Retrying the original operation after its response was lost creates no generation.
    save_in_pool(&pool, &store, request).await.unwrap();
    assert_eq!(store.candidates().unwrap(), vec![candidate]);
}

#[tokio::test]
async fn keep_migrates_legacy_once_and_foreign_or_restored_references_cannot_resolve() {
    let pool = database().await;
    let store = MemoryStore::default();
    *store.legacy.lock().unwrap() = Some("legacy-secret".into());
    pool.execute("INSERT INTO settings(key,value) VALUES('webdav_backup_url','https://example.invalid/dav'),('webdav_backup_username','alice')").await.unwrap();
    assert!(snapshot_in_pool(&pool, &store).await.unwrap().has_secret);
    save_in_pool(&pool, &store, input(None)).await.unwrap();
    assert!(store.read_legacy().unwrap().is_none());
    assert_pair(&pool, &store, "legacy-secret", "alice").await;
    let ids = store.candidates().unwrap();
    save_in_pool(&pool, &store, input(None)).await.unwrap();
    assert_eq!(store.candidates().unwrap(), ids);
    let mut changed = input(None);
    changed.username = "bob".into();
    save_in_pool(&pool, &store, changed).await.unwrap();
    assert_pair(&pool, &store, "legacy-secret", "bob").await;
    let foreign = MemoryStore::default();
    assert!(!snapshot_in_pool(&pool, &foreign).await.unwrap().has_secret);
    let mut tx = pool.begin().await.unwrap();
    repository::detach_for_restore(&mut tx).await.unwrap();
    tx.commit().await.unwrap();
    assert!(!snapshot_in_pool(&pool, &store).await.unwrap().has_secret);
    assert!(store.candidates().unwrap().is_empty());
    assert!(save_in_pool(&pool, &store, input(None)).await.is_err());
}

// Run the same save coordinator in a separate process and terminate it at the
// actual durable boundaries. Only UUID targets in this test's ledger are used.
#[cfg(target_os = "windows")]
mod process_recovery {
    use super::*;
    use std::path::{Path, PathBuf};

    struct InterruptingStore {
        inner: WebDavCredentialStore,
        phase: String,
    }
    impl InterruptingStore {
        fn stop(&self, phase: &str) {
            if self.phase == phase {
                std::process::exit(41);
            }
        }
    }
    impl CredentialStore for InterruptingStore {
        fn candidates(&self) -> Result<Vec<String>, String> {
            self.stop("committed");
            self.inner.candidates()
        }
        fn prepare(&self, identity: &str) -> Result<String, String> {
            let id = self.inner.prepare(identity)?;
            self.stop("prepared");
            Ok(id)
        }
        fn write(&self, id: &str, username: &str, secret: &str) -> Result<(), String> {
            self.inner.write(id, username, secret)?;
            self.stop("written");
            Ok(())
        }
        fn read(&self, id: &str, identity: &str) -> Result<Option<String>, String> {
            self.inner.read(id, identity)
        }
        fn remove(&self, id: &str) -> Result<(), String> {
            self.inner.remove(id)
        }
        fn read_legacy(&self) -> Result<Option<String>, String> {
            self.inner.read_legacy()
        }
        fn retire_legacy(&self) -> Result<(), String> {
            self.inner.retire_legacy()
        }
    }
    struct Fixture {
        root: PathBuf,
        store: WebDavCredentialStore,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            self.store.retire_legacy().unwrap();
            for id in self.store.candidates().unwrap() {
                self.store.remove(&id).unwrap();
            }
            std::fs::remove_dir_all(&self.root).unwrap();
        }
    }
    async fn open(root: &Path) -> SqlitePool {
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(root.join("fixture.db"))
            .create_if_missing(true);
        sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap()
    }
    #[tokio::test]
    async fn child_save() {
        let Ok(root) = std::env::var("PATINA_CREDENTIAL_RECOVERY_CHILD") else {
            return;
        };
        let root = PathBuf::from(root);
        assert!(root.starts_with(std::env::temp_dir()));
        assert!(root
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("patina-credential-recovery-"));
        let store = InterruptingStore {
            inner: WebDavCredentialStore::isolated_test(root.join("ledger")),
            phase: std::env::var("PATINA_CREDENTIAL_RECOVERY_PHASE").unwrap(),
        };
        let pool = open(&root).await;
        let mut request = input(Some("process-new-secret"));
        request.username = "bob".into();
        save_in_pool(&pool, &store, request).await.unwrap();
        panic!("interruption checkpoint was not reached");
    }
    #[tokio::test]
    async fn real_process_termination_preserves_complete_pair_and_collects_orphans() {
        let root = std::env::temp_dir().join(format!(
            "patina-credential-recovery-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&root).unwrap();
        let fixture = Fixture {
            store: WebDavCredentialStore::isolated_test_with_legacy(
                root.join("ledger"),
                "alice",
                "legacy-process-secret",
            ),
            root,
        };
        let pool = open(&fixture.root).await;
        pool.execute(crate::data::schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute("INSERT INTO settings(key,value) VALUES('webdav_backup_url','https://example.invalid/dav'),('webdav_backup_username','alice')").await.unwrap();
        assert!(
            snapshot_in_pool(&pool, &fixture.store)
                .await
                .unwrap()
                .has_secret
        );
        save_in_pool(&pool, &fixture.store, input(None))
            .await
            .unwrap();
        assert!(fixture.store.read_legacy().unwrap().is_none());
        let upgraded = repository::load_state(&pool).await.unwrap();
        assert_eq!(
            password(&fixture.store, &upgraded).unwrap().as_deref(),
            Some("legacy-process-secret")
        );
        pool.close().await;
        for phase in ["prepared", "written", "committed"] {
            let pool = open(&fixture.root).await;
            save_in_pool(&pool, &fixture.store, input(Some("process-old-secret")))
                .await
                .unwrap();
            pool.close().await;
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "data::remote_backup_config::tests::process_recovery::child_save",
                    "--nocapture",
                ])
                .env("PATINA_CREDENTIAL_RECOVERY_CHILD", &fixture.root)
                .env("PATINA_CREDENTIAL_RECOVERY_PHASE", phase)
                .status()
                .unwrap();
            assert_eq!(status.code(), Some(41), "{phase}");
            let pool = open(&fixture.root).await;
            let snapshot = snapshot_in_pool(&pool, &fixture.store).await.unwrap();
            assert!(snapshot.has_secret && !snapshot.cleanup_pending, "{phase}");
            let state = repository::load_state(&pool).await.unwrap();
            assert_eq!(
                password(&fixture.store, &state).unwrap().as_deref(),
                Some(if phase == "committed" {
                    "process-new-secret"
                } else {
                    "process-old-secret"
                }),
                "{phase}"
            );
            assert_eq!(
                state.config.unwrap().username,
                if phase == "committed" { "bob" } else { "alice" }
            );
            assert_eq!(fixture.store.candidates().unwrap().len(), 1, "{phase}");
            pool.close().await;
        }
    }
}
