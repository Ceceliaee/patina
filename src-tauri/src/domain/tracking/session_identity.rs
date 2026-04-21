#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WindowSessionIdentity {
    pub app_key: String,
    pub instance_key: String,
}

impl WindowSessionIdentity {
    pub fn from_window_fields(
        exe_name: &str,
        process_id: u32,
        root_owner_hwnd: &str,
        hwnd: &str,
        window_class: &str,
    ) -> Option<Self> {
        if exe_name.is_empty() {
            return None;
        }

        let app_key = exe_name.to_lowercase();
        let owner_key = if root_owner_hwnd.is_empty() {
            hwnd
        } else {
            root_owner_hwnd
        };
        let class_key = window_class.to_lowercase();
        let instance_key = format!(
            "{}|pid:{}|root:{}|class:{}",
            app_key, process_id, owner_key, class_key
        );

        Some(Self {
            app_key,
            instance_key,
        })
    }

    pub fn is_same_app(&self, other: &Self) -> bool {
        self.app_key == other.app_key
    }

    pub fn is_same_instance(&self, other: &Self) -> bool {
        self.instance_key == other.instance_key
    }
}

#[derive(Clone, Copy, Debug)]
pub struct WindowTrackingCandidate<'a> {
    pub exe_name: &'a str,
    pub title: &'a str,
    pub is_afk: bool,
}

impl<'a> WindowTrackingCandidate<'a> {
    pub fn from_window_fields(exe_name: &'a str, title: &'a str, is_afk: bool) -> Self {
        Self {
            exe_name,
            title,
            is_afk,
        }
    }
}

pub fn is_trackable_window(window: Option<WindowTrackingCandidate<'_>>) -> bool {
    let Some(window) = window else {
        return false;
    };

    !window.exe_name.is_empty()
        && !window.is_afk
        && super::should_track(window.exe_name)
        && !super::is_lifecycle_utility_window(window)
}
