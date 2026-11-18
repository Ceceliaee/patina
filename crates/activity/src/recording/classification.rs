use super::desktop::{RecordingSignals, TrackingHost};
use crate::ActivityError;
use sqlx::SqlitePool;

pub struct Classification {
    pool: SqlitePool,
    signals: Option<RecordingSignals>,
}

impl Classification {
    pub fn new(pool: SqlitePool) -> Self {
        Self {
            pool,
            signals: None,
        }
    }
    pub fn with_recording(pool: SqlitePool, signals: RecordingSignals) -> Self {
        Self {
            pool,
            signals: Some(signals),
        }
    }

    pub async fn edit_app(&self, exe: String, edit: crate::AppEdit) -> Result<(), ActivityError> {
        super::today::edit_app(self.pool.clone(), exe, edit).await?;
        if let Some(host) = &self.signals {
            host.notify();
        }
        Ok(())
    }

    pub async fn load_classification_rules(
        &self,
    ) -> Result<crate::ClassificationRules, ActivityError> {
        Ok(super::classification_rules::load_classification_rules(self.pool.clone()).await?)
    }

    pub async fn save_classification_rules(
        &self,
        app_rules: Vec<crate::AppRule>,
        websites: Option<crate::WebsiteRuleDraft>,
        links: Vec<crate::AppLinkEdit>,
        categories: Vec<crate::CategoryEdit>,
    ) -> Result<(), ActivityError> {
        let _guard = match &self.signals {
            Some(host) => Some(host.projection().transition.lock().await),
            None => None,
        };
        super::classification_rules::save_classification_rules(
            &self.pool,
            &app_rules,
            websites.as_ref(),
            &links,
            &categories,
        )
        .await?;
        if let Some(host) = &self.signals {
            host.titles().invalidate_app_overrides();
            host.projection().note_tracking_policy_change();
            host.notify();
        }
        Ok(())
    }
    pub async fn delete_application(
        &self,
        exe: String,
        confirmed: Option<crate::DeletionImpact>,
    ) -> Result<crate::DeletionImpact, ActivityError> {
        use crate::data::classification_deletion::{run, Target};
        use crate::domain::tracking::resolve_app_override_executable;
        let key = resolve_app_override_executable(&exe).ok_or("Invalid application identity")?;
        if exe == "activity:anonymous" {
            return Err("Invalid application identity".into());
        }
        let apply = confirmed.is_some();
        let _guard = match &self.signals {
            Some(host) if apply => Some(host.projection().transition.lock().await),
            _ => None,
        };
        let result = run(&self.pool, &Target::App(key.clone()), confirmed).await?;
        if let Some(host) = self.signals.as_ref().filter(|_| apply) {
            if host
                .projection()
                .snapshot()
                .and_then(|s| s.active_session)
                .is_some_and(|s| {
                    resolve_app_override_executable(&s.exe_name).as_deref() == Some(&key)
                })
            {
                host.projection().replace_active_session(None);
            }
            host.titles().invalidate_app_overrides();
            host.projection().note_tracking_policy_change();
            host.notify();
        }
        Ok(result)
    }
    pub async fn delete_website(
        &self,
        identity: String,
        confirmed: Option<crate::DeletionImpact>,
    ) -> Result<crate::DeletionImpact, ActivityError> {
        use crate::data::classification_deletion::{run, Target};
        let target = if let Some(root) = crate::domain::web_links::group_domain(&identity) {
            Target::Group(root)
        } else {
            let domain = crate::domain::web_activity::normalize_domain(&identity)
                .ok_or("invalid website identity")?;
            if domain != identity {
                return Err("invalid website identity".into());
            }
            Target::Web(domain)
        };
        let apply = confirmed.is_some();
        let _guard = match &self.signals {
            Some(host) => Some(host.projection().transition.lock().await),
            None => None,
        };
        let result = run(&self.pool, &target, confirmed).await?;
        if let Some(host) = self.signals.as_ref().filter(|_| apply) {
            host.projection().note_tracking_policy_change();
            host.notify();
        }
        Ok(result)
    }
    pub async fn remember_classification_mode(&self, web: bool) -> Result<(), ActivityError> {
        use crate::data::repositories::app_settings::{
            commit_app_setting_mutations, AppSettingMutation,
        };
        commit_app_setting_mutations(
            &self.pool,
            &[AppSettingMutation {
                key: "classification_object_mode".into(),
                value: if web { "web" } else { "app" }.into(),
            }],
        )
        .await
        .map_err(|error| error.to_string())?;
        Ok(())
    }
}
