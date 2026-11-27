use super::Client;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use patina_activity_model::{self as model, AppEdit, DaySummary, Recent};
use patina_desktop_protocol::{FromReply, RequestError, WindowRequest, tools::ToolCall};

impl Client {
    pub(crate) fn tool<T: FromReply>(
        &self,
        call: ToolCall<T>,
    ) -> impl Future<Output = Result<T, RequestError>> + 'static {
        self.request(WindowRequest::Tools(call.into_request()))
    }
    pub(crate) fn load_today_summary(
        &self,
    ) -> impl Future<Output = Result<DaySummary, RequestError>> + 'static {
        self.request(WindowRequest::Today)
    }
    pub(crate) fn trends(
        &self,
        range: Option<(i64, i64)>,
        kind: patina_activity_model::SeriesKind,
    ) -> impl Future<Output = Result<patina_activity_model::Trends, RequestError>> + 'static {
        self.request(WindowRequest::Trends(range, kind))
    }
    pub(crate) fn history(
        &self,
        day: i64,
        app: Option<String>,
        titles: bool,
        web: bool,
    ) -> impl Future<Output = Result<patina_activity_model::HistoryDay, RequestError>> + 'static
    {
        self.request(WindowRequest::History {
            day,
            app,
            titles,
            web,
        })
    }
    pub(crate) fn recent(&self) -> impl Future<Output = Result<Recent, RequestError>> + 'static {
        self.request(WindowRequest::Recent)
    }
    pub(crate) fn save_mini(
        &self,
        prefs: model::views::mini::MiniPreferences,
    ) -> impl Future<Output = Result<(), RequestError>> + 'static {
        self.request(WindowRequest::SaveMini(prefs))
    }
    pub(crate) fn edit_app(
        &self,
        key: String,
        edit: AppEdit,
    ) -> impl Future<Output = Result<(), RequestError>> + 'static {
        self.request(WindowRequest::Edit(key, edit))
    }
    pub(crate) fn icons(
        &self,
        keys: Vec<String>,
    ) -> impl Future<Output = Result<Vec<(String, Vec<u8>)>, RequestError>> + 'static {
        let read = self.request::<Vec<(String, String)>>(WindowRequest::Icons(keys));
        async move {
            read.await?
                .into_iter()
                .map(|(k, v)| {
                    STANDARD
                        .decode(v)
                        .map(|b| (k, b))
                        .map_err(|e| RequestError::Rejected(e.to_string()))
                })
                .collect()
        }
    }
    pub(crate) fn update(
        &self,
        request: patina_updater::Request,
    ) -> impl Future<Output = Result<patina_updater::Snapshot, RequestError>> + 'static {
        self.request(WindowRequest::Update(request))
    }
    pub(crate) fn install_update(
        &self,
    ) -> impl Future<Output = Result<(), RequestError>> + 'static {
        self.request(WindowRequest::InstallUpdate)
    }
    pub(crate) fn open_external(
        &self,
        url: String,
    ) -> impl Future<Output = Result<(), RequestError>> + 'static {
        self.request(WindowRequest::OpenExternal(url))
    }
    pub(crate) fn load_classification_rules(
        &self,
    ) -> impl Future<Output = Result<model::ClassificationRules, RequestError>> + 'static {
        self.request(WindowRequest::Rules)
    }
    pub(crate) fn save_classification_rules(
        &self,
        app_rules: Vec<model::AppRule>,
        web_draft: Option<model::WebsiteRuleDraft>,
        app_links: Vec<model::AppLinkEdit>,
        category_edits: Vec<model::CategoryEdit>,
    ) -> impl Future<Output = Result<(), RequestError>> + 'static {
        self.request(WindowRequest::SaveRules(
            app_rules,
            web_draft,
            app_links,
            category_edits,
        ))
    }
    pub(crate) fn delete_source(
        &self,
        identity: String,
        web: bool,
        confirmed: Option<model::DeletionImpact>,
    ) -> impl Future<Output = Result<model::DeletionImpact, RequestError>> + 'static {
        self.request(if web {
            WindowRequest::DeleteWebsite(identity, confirmed)
        } else {
            WindowRequest::DeleteApplication(identity, confirmed)
        })
    }
    pub(crate) fn classification_mode(
        &self,
        web: bool,
    ) -> impl Future<Output = Result<(), RequestError>> + 'static {
        self.request(WindowRequest::ClassificationMode(web))
    }
    pub(crate) fn preferences(
        &self,
    ) -> impl Future<Output = Result<model::AppPreferences, RequestError>> + 'static {
        self.request(WindowRequest::Preferences)
    }
    pub(crate) fn login_status(
        &self,
        repair: bool,
    ) -> impl Future<Output = Result<patina_desktop_protocol::LoginStatus, RequestError>> + 'static
    {
        self.request(if repair {
            WindowRequest::RepairLogin
        } else {
            WindowRequest::LoginStatus
        })
    }
    pub(crate) fn save_preferences(
        &self,
        old: model::AppPreferences,
        next: model::AppPreferences,
    ) -> impl Future<Output = Result<(), RequestError>> + 'static {
        self.request(WindowRequest::SavePreferences(old, next))
    }
    pub(crate) fn history_modes(
        &self,
        modes: Option<[u8; 2]>,
    ) -> impl Future<Output = Result<([u8; 2], bool), RequestError>> + 'static {
        self.request(WindowRequest::HistoryModes(modes))
    }
    pub(crate) fn zoom(
        &self,
        detail: bool,
        hours: Option<f32>,
    ) -> impl Future<Output = Result<f32, RequestError>> + 'static {
        self.request(if detail {
            WindowRequest::DetailZoom(hours)
        } else {
            WindowRequest::HistoryZoom(hours)
        })
    }
    pub(crate) fn history_minimum(
        &self,
        detail: bool,
        seconds: i64,
    ) -> impl Future<Output = Result<(), RequestError>> + 'static {
        self.request(WindowRequest::HistoryMinimum(detail, seconds))
    }
    pub(crate) fn storage(
        &self,
        request: model::StorageRequest,
    ) -> impl Future<Output = Result<model::views::storage::StorageReply, RequestError>> + 'static
    {
        self.request(WindowRequest::Storage(request))
    }
    pub(crate) fn save_export_preferences(
        &self,
        preferences: model::views::storage::ExportPreferences,
    ) -> impl Future<Output = Result<(), RequestError>> + 'static {
        self.request(WindowRequest::Storage(
            model::StorageRequest::ExportPreferences(Some(preferences)),
        ))
    }
    pub(crate) fn reveal_dav_password(
        &self,
        window: usize,
    ) -> impl Future<Output = Result<Option<String>, RequestError>> + 'static {
        self.request(WindowRequest::Storage(model::StorageRequest::DavReveal(
            window,
        )))
    }
    pub(crate) fn save_resume_page(
        &self,
        page: String,
    ) -> impl Future<Output = Result<(), RequestError>> + 'static {
        self.request(WindowRequest::Storage(
            model::StorageRequest::ResumeAfterUpdate(Some(page)),
        ))
    }
}
