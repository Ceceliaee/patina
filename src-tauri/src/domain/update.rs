use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UpdateStatus {
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Downloaded,
    Installing,
    Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct UpdateSnapshot {
    pub current_version: String,
    pub status: UpdateStatus,
    pub latest_version: Option<String>,
    pub release_notes: Option<String>,
    pub release_date: Option<String>,
    pub error_message: Option<String>,
}

impl UpdateSnapshot {
    pub fn idle(current_version: String) -> Self {
        Self {
            current_version,
            status: UpdateStatus::Idle,
            latest_version: None,
            release_notes: None,
            release_date: None,
            error_message: None,
        }
    }

    pub fn checking(self) -> Self {
        Self {
            status: UpdateStatus::Checking,
            error_message: None,
            ..self
        }
    }

    pub fn available(
        self,
        latest_version: impl Into<String>,
        release_notes: Option<String>,
        release_date: Option<String>,
    ) -> Self {
        Self {
            status: UpdateStatus::Available,
            latest_version: Some(latest_version.into()),
            release_notes,
            release_date,
            error_message: None,
            ..self
        }
    }

    pub fn up_to_date(self) -> Self {
        Self {
            status: UpdateStatus::UpToDate,
            latest_version: None,
            release_notes: None,
            release_date: None,
            error_message: None,
            ..self
        }
    }

    pub fn error(self, message: impl Into<String>) -> Self {
        Self {
            status: UpdateStatus::Error,
            error_message: Some(message.into()),
            ..self
        }
    }

    pub fn downloading(self) -> Self {
        Self {
            status: UpdateStatus::Downloading,
            error_message: None,
            ..self
        }
    }

    pub fn downloaded(self) -> Self {
        Self {
            status: UpdateStatus::Downloaded,
            error_message: None,
            ..self
        }
    }

    pub fn installing(self) -> Self {
        Self {
            status: UpdateStatus::Installing,
            error_message: None,
            ..self
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{UpdateSnapshot, UpdateStatus};

    #[test]
    fn available_snapshot_sets_release_fields_and_clears_error() {
        let snapshot = UpdateSnapshot::idle("0.1.0".to_string())
            .error("network issue")
            .available(
                "0.2.0",
                Some("changes".to_string()),
                Some("2025-01-01".to_string()),
            );

        assert_eq!(snapshot.status, UpdateStatus::Available);
        assert_eq!(snapshot.latest_version.as_deref(), Some("0.2.0"));
        assert_eq!(snapshot.release_notes.as_deref(), Some("changes"));
        assert_eq!(snapshot.release_date.as_deref(), Some("2025-01-01"));
        assert_eq!(snapshot.error_message, None);
    }

    #[test]
    fn up_to_date_clears_update_metadata() {
        let snapshot = UpdateSnapshot::idle("0.1.0".to_string())
            .available(
                "0.2.0",
                Some("changes".to_string()),
                Some("2025-01-01".to_string()),
            )
            .up_to_date();

        assert_eq!(snapshot.status, UpdateStatus::UpToDate);
        assert_eq!(snapshot.latest_version, None);
        assert_eq!(snapshot.release_notes, None);
        assert_eq!(snapshot.release_date, None);
        assert_eq!(snapshot.error_message, None);
    }

    #[test]
    fn transfer_states_keep_existing_update_metadata_but_clear_error() {
        let snapshot = UpdateSnapshot::idle("0.1.0".to_string())
            .available(
                "0.2.0",
                Some("changes".to_string()),
                Some("2025-01-01".to_string()),
            )
            .error("disk issue")
            .checking()
            .downloading()
            .downloaded()
            .installing();

        assert_eq!(snapshot.status, UpdateStatus::Installing);
        assert_eq!(snapshot.latest_version.as_deref(), Some("0.2.0"));
        assert_eq!(snapshot.error_message, None);
    }

    #[test]
    fn error_snapshot_sets_message_without_dropping_release_metadata() {
        let snapshot = UpdateSnapshot::idle("0.1.0".to_string())
            .available(
                "0.2.0",
                Some("changes".to_string()),
                Some("2025-01-01".to_string()),
            )
            .error("failed to install");

        assert_eq!(snapshot.status, UpdateStatus::Error);
        assert_eq!(snapshot.latest_version.as_deref(), Some("0.2.0"));
        assert_eq!(snapshot.error_message.as_deref(), Some("failed to install"));
    }
}
