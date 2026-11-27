use patina_activity::{ActivityError, DesktopBehaviorSettings};
use patina_desktop_protocol::RequestError;
use std::io;

pub(super) async fn save(
    current: DesktopBehaviorSettings,
    original: DesktopBehaviorSettings,
    edited: DesktopBehaviorSettings,
    login: impl Fn(bool) -> io::Result<bool>,
    visibility: impl Fn(DesktopBehaviorSettings) -> io::Result<()>,
    persist: impl Future<Output = Result<(), ActivityError>>,
) -> Result<DesktopBehaviorSettings, RequestError> {
    if original != current && original != edited {
        return Err(RequestError::Conflict(
            "resident settings changed since loading".into(),
        ));
    }
    let desired = if original == edited { current } else { edited };
    let login_changed = desired.launch_at_login != current.launch_at_login;
    let previous_registration = login_changed
        .then(|| login(desired.launch_at_login))
        .transpose()
        .map_err(|e| e.to_string())?;
    let result = match visibility(desired) {
        Ok(()) => persist.await.map_err(super::activity_error),
        Err(error) => Err(RequestError::Rejected(error.to_string())),
    };
    if let Err(error) = result {
        let icon = visibility(current);
        let registration = previous_registration.map(login).transpose();
        if icon.is_err() || registration.is_err() {
            return Err(RequestError::Rejected(format!(
                "{error}; restore tray: {icon:?}, restore login: {registration:?}"
            )));
        }
        return Err(error);
    }
    Ok(desired)
}

#[cfg(test)]
mod tests {
    use super::*;
    use patina_activity::{Locale, Preferences, open_database};
    use std::cell::Cell;

    #[test]
    fn resident_settings_commit_and_compensate_with_the_real_database() {
        let dir = tempfile::tempdir().unwrap();
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            let pool = open_database(&dir.path().join("patina.db")).await.unwrap();
            let prefs = Preferences::new(pool.clone(), Locale::EnUs);
            let initial = prefs.preferences().await.unwrap();
            let mut edited = initial.clone();
            edited.desktop.launch_at_login = !initial.desktop.launch_at_login;
            edited.desktop.show_tray_icon = !initial.desktop.show_tray_icon;
            let registered = Cell::new(initial.desktop.launch_at_login);
            let visible = Cell::new(initial.desktop);
            let login = |value| Ok(registered.replace(value));
            let visibility = |value| {
                visible.set(value);
                Ok(())
            };
            let commit = |old, next| prefs.save_preferences(old, next);

            let saved = save(
                initial.desktop,
                initial.desktop,
                edited.desktop,
                login,
                visibility,
                commit(initial.clone(), edited.clone()),
            )
            .await
            .unwrap();
            assert_eq!(saved, edited.desktop);
            assert_eq!(visible.get(), saved);
            assert_eq!(registered.get(), saved.launch_at_login);
            assert_eq!(prefs.preferences().await.unwrap().desktop, saved);

            let result = save(
                saved,
                initial.desktop,
                edited.desktop,
                |_| panic!("stale input applied"),
                |_| panic!("stale input applied"),
                async { panic!("stale input persisted") },
            )
            .await;
            assert!(matches!(result, Err(RequestError::Conflict(_))));

            // A second writer changed these preferences after the window took its snapshot.
            let mut competing = edited.clone();
            competing.desktop.start_minimized = !edited.desktop.start_minimized;
            commit(edited.clone(), competing.clone()).await.unwrap();
            let mut retry = initial.clone();
            retry.desktop.start_minimized = competing.desktop.start_minimized;
            let result = save(
                saved,
                edited.desktop,
                retry.desktop,
                login,
                visibility,
                commit(edited, retry),
            )
            .await;
            assert!(matches!(result, Err(RequestError::Conflict(_))));
            assert_eq!(visible.get(), saved);
            assert_eq!(registered.get(), saved.launch_at_login);
            assert_eq!(
                prefs.preferences().await.unwrap().desktop,
                competing.desktop
            );
            pool.close().await;
        });
    }

    #[test]
    fn tray_failure_restores_login_and_reports_a_failed_compensation() {
        let current = DesktopBehaviorSettings::default();
        let edited = DesktopBehaviorSettings {
            launch_at_login: !current.launch_at_login,
            ..current
        };
        let registered = Cell::new(current.launch_at_login);
        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();
        let result = runtime.block_on(save(
            current,
            current,
            edited,
            |value| Ok(registered.replace(value)),
            |value| {
                Err(io::Error::other(if value == edited {
                    "apply failed"
                } else {
                    "restore failed"
                }))
            },
            async { panic!("must not persist when making the tray visible fails") },
        ));
        assert_eq!(registered.get(), current.launch_at_login);
        assert!(
            matches!(result, Err(RequestError::Rejected(message)) if message.contains("apply failed") && message.contains("restore failed"))
        );
    }
}
