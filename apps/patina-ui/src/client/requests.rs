use super::Client;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use patina_activity_model::{self as model, AppEdit, DaySummary, Recent};
use patina_desktop_protocol::{FromReply, Query, tools::ToolCall};

impl Client {
    pub(crate) fn tool<T: FromReply>(
        &self,
        call: ToolCall<T>,
    ) -> impl Future<Output = Result<T, String>> + 'static {
        self.request(Query::Tools(call.into_request()))
    }
    pub(crate) fn today(&self) -> impl Future<Output = Result<DaySummary, String>> + 'static {
        self.request(Query::Today)
    }
    pub(crate) fn trends(
        &self,
        range: Option<(i64, i64)>,
        kind: patina_activity_model::SeriesKind,
    ) -> impl Future<Output = Result<patina_activity_model::Trends, String>> + 'static {
        self.request(Query::Trends(range, kind))
    }
    pub(crate) fn history(
        &self,
        day: i64,
        app: Option<String>,
        titles: bool,
        web: bool,
    ) -> impl Future<Output = Result<patina_activity_model::HistoryDay, String>> + 'static {
        self.request(Query::History {
            day,
            app,
            titles,
            web,
        })
    }
    pub(crate) fn recent(&self) -> impl Future<Output = Result<Recent, String>> + 'static {
        self.request(Query::Recent)
    }
    pub(crate) fn set_chart_mode(
        &self,
        mode: bool,
    ) -> impl Future<Output = Result<(), String>> + 'static {
        self.request(Query::ChartMode(mode))
    }
    pub(crate) fn edit_app(
        &self,
        key: String,
        edit: AppEdit,
    ) -> impl Future<Output = Result<(), String>> + 'static {
        self.request(Query::Edit(key, edit))
    }
    pub(crate) fn icons(
        &self,
        keys: Vec<String>,
    ) -> impl Future<Output = Result<Vec<(String, Vec<u8>)>, String>> + 'static {
        let read = self.request::<Vec<(String, String)>>(Query::Icons(keys));
        async move {
            read.await?
                .into_iter()
                .map(|(k, v)| {
                    STANDARD
                        .decode(v)
                        .map(|b| (k, b))
                        .map_err(|e| e.to_string())
                })
                .collect()
        }
    }
    pub(crate) fn update(
        &self,
        request: patina_updater::Request,
    ) -> impl Future<Output = Result<patina_updater::Snapshot, String>> + 'static {
        self.request(Query::Update(request))
    }
    pub(crate) fn install_update(&self) -> impl Future<Output = Result<(), String>> + 'static {
        self.request(Query::InstallUpdate)
    }
    pub(crate) fn open_external(
        &self,
        url: String,
    ) -> impl Future<Output = Result<(), String>> + 'static {
        self.request(Query::OpenExternal(url))
    }
    pub(crate) fn rules(&self) -> impl Future<Output = Result<model::Rules, String>> + 'static {
        self.request(Query::Rules)
    }
    pub(crate) fn save_rules(
        &self,
        apps: Vec<model::AppRule>,
        sites: Option<model::WebDraft>,
        links: Vec<model::AppLinkEdit>,
        categories: Vec<model::CategoryEdit>,
    ) -> impl Future<Output = Result<(), String>> + 'static {
        self.request(Query::SaveRules(apps, sites, links, categories))
    }
    pub(crate) fn delete_source(
        &self,
        identity: String,
        web: bool,
        confirmed: Option<model::DeletionImpact>,
    ) -> impl Future<Output = Result<model::DeletionImpact, String>> + 'static {
        self.request(if web {
            Query::DeleteWebsite(identity, confirmed)
        } else {
            Query::DeleteApplication(identity, confirmed)
        })
    }
    pub(crate) fn classification_mode(
        &self,
        web: bool,
    ) -> impl Future<Output = Result<(), String>> + 'static {
        self.request(Query::ClassificationMode(web))
    }
    pub(crate) fn preferences(
        &self,
    ) -> impl Future<Output = Result<model::TrackingPreferences, String>> + 'static {
        self.request(Query::Preferences)
    }
    pub(crate) fn save_preferences(
        &self,
        old: model::TrackingPreferences,
        next: model::TrackingPreferences,
    ) -> impl Future<Output = Result<(), String>> + 'static {
        self.request(Query::SavePreferences(old, next))
    }
    pub(crate) fn history_modes(
        &self,
        modes: Option<[u8; 3]>,
    ) -> impl Future<Output = Result<([u8; 3], bool), String>> + 'static {
        self.request(Query::HistoryModes(modes))
    }
    pub(crate) fn zoom(
        &self,
        detail: bool,
        hours: Option<f32>,
    ) -> impl Future<Output = Result<f32, String>> + 'static {
        self.request(if detail {
            Query::DetailZoom(hours)
        } else {
            Query::HistoryZoom(hours)
        })
    }
    pub(crate) fn history_minimum(
        &self,
        detail: bool,
        seconds: i64,
    ) -> impl Future<Output = Result<(), String>> + 'static {
        self.request(Query::HistoryMinimum(detail, seconds))
    }
    pub(crate) fn storage(
        &self,
        request: model::StorageRequest,
    ) -> impl Future<Output = Result<model::views::storage::StorageReply, String>> + 'static {
        self.request(Query::Storage(request))
    }
    pub(crate) fn save_export_preferences(
        &self,
        preferences: model::views::storage::ExportPreferences,
    ) -> impl Future<Output = Result<(), String>> + 'static {
        self.request(Query::Storage(model::StorageRequest::ExportPreferences(
            Some(preferences),
        )))
    }
    pub(crate) fn reveal_dav_password(
        &self,
        window: usize,
    ) -> impl Future<Output = Result<Option<String>, String>> + 'static {
        self.request(Query::Storage(model::StorageRequest::DavReveal(window)))
    }
    pub(crate) fn save_resume_page(
        &self,
        page: String,
    ) -> impl Future<Output = Result<(), String>> + 'static {
        self.request(Query::Storage(model::StorageRequest::ResumeAfterUpdate(
            Some(page),
        )))
    }
    pub(crate) fn take_resume_page(
        &self,
    ) -> impl Future<Output = Result<Option<String>, String>> + 'static {
        self.request(Query::Storage(model::StorageRequest::ResumeAfterUpdate(
            None,
        )))
    }
}
