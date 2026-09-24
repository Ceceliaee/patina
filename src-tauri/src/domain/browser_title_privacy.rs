use crate::domain::web_activity::WEB_ACTIVITY_OBSERVATION_TTL_MS;

/// An in-memory grant for one observed browser window and one confirmed page title.
/// No raw page identity is persisted by this policy.
#[derive(Clone, Debug)]
pub struct ConfirmedBrowserTitle {
    pub exe_name: String,
    pub hwnd: String,
    pub process_id: u32,
    pub native_title: String,
    pub observed_at_ms: i64,
    pub policy_generation: u64,
}

impl ConfirmedBrowserTitle {
    pub fn permits(
        &self,
        exe_name: &str,
        hwnd: &str,
        process_id: u32,
        native_title: &str,
        now_ms: i64,
        policy_generation: u64,
    ) -> bool {
        self.exe_name.eq_ignore_ascii_case(exe_name)
            && self.hwnd == hwnd
            && self.process_id == process_id
            && self.native_title == native_title
            && self.policy_generation == policy_generation
            && now_ms >= self.observed_at_ms
            && now_ms - self.observed_at_ms < WEB_ACTIVITY_OBSERVATION_TTL_MS
    }
}

/// A page observation must account for the whole native title. A prefix match
/// could authorize unrelated text from a different page sampled earlier.
pub fn matches_observed_page_title(native_title: &str, page_title: &str) -> bool {
    if page_title.trim().is_empty() {
        return false;
    }
    if native_title == page_title {
        return true;
    }
    [
        " - Google Chrome",
        " - Chromium",
        " - Microsoft Edge",
        " — Mozilla Firefox",
        " - Mozilla Firefox",
        " - Brave",
        " - Opera",
        " - Vivaldi",
    ]
    .iter()
    .any(|suffix| native_title.strip_suffix(suffix) == Some(page_title))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_confirmation_cannot_authorize_an_unrelated_native_title() {
        assert!(matches_observed_page_title(
            "Public - Google Chrome",
            "Public"
        ));
        assert!(matches_observed_page_title(
            "Public — Mozilla Firefox",
            "Public"
        ));
        assert!(!matches_observed_page_title(
            "Public secret - Google Chrome",
            "Public"
        ));
        assert!(!matches_observed_page_title("Secret - Google Chrome", ""));
    }

    #[test]
    fn grant_expires_and_is_bound_to_window_title_process_and_policy() {
        let grant = ConfirmedBrowserTitle {
            exe_name: "chrome.exe".into(),
            hwnd: "10".into(),
            process_id: 12,
            native_title: "Public - Google Chrome".into(),
            observed_at_ms: 1_000,
            policy_generation: 2,
        };
        assert!(grant.permits("CHROME.EXE", "10", 12, &grant.native_title, 1_001, 2));
        assert!(!grant.permits("chrome.exe", "11", 12, &grant.native_title, 1_001, 2));
        assert!(!grant.permits("chrome.exe", "10", 13, &grant.native_title, 1_001, 2));
        assert!(!grant.permits("chrome.exe", "10", 12, "Secret", 1_001, 2));
        assert!(!grant.permits("chrome.exe", "10", 12, &grant.native_title, 999, 2));
        assert!(!grant.permits("chrome.exe", "10", 12, &grant.native_title, 46_000, 2));
        assert!(!grant.permits("chrome.exe", "10", 12, &grant.native_title, 1_001, 3));
    }
}
