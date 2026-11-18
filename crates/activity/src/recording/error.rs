#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ActivityError {
    Conflict(String),
    Rejected(String),
}

impl From<String> for ActivityError {
    fn from(value: String) -> Self {
        Self::Rejected(value)
    }
}

impl From<&str> for ActivityError {
    fn from(value: &str) -> Self {
        Self::Rejected(value.into())
    }
}

impl std::fmt::Display for ActivityError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Conflict(message) | Self::Rejected(message) => f.write_str(message),
        }
    }
}
impl std::error::Error for ActivityError {}

impl From<patina_storage::sqlite_error::SqliteOperationError> for ActivityError {
    fn from(error: patina_storage::sqlite_error::SqliteOperationError) -> Self {
        if error.code() == patina_storage::sqlite_error::SqliteErrorCode::Conflict {
            Self::Conflict(error.to_string())
        } else {
            Self::Rejected(error.to_string())
        }
    }
}
