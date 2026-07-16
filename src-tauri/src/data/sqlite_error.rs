use serde::Serialize;
use std::fmt;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SqliteErrorCode {
    Busy,
    Locked,
    PoolClosed,
    PoolTimedOut,
    InvalidInput,
    OperationFailed,
}

#[derive(Debug)]
pub struct SqliteOperationError {
    code: SqliteErrorCode,
    context: &'static str,
    detail: String,
}

impl SqliteOperationError {
    pub fn from_sqlx(context: &'static str, error: sqlx::Error) -> Self {
        let code = classify_sqlx_error(&error);
        Self {
            code,
            context,
            detail: error.to_string(),
        }
    }

    pub fn invalid_input(context: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code: SqliteErrorCode::InvalidInput,
            context,
            detail: detail.into(),
        }
    }

    pub fn operation_failed(context: &'static str, detail: impl Into<String>) -> Self {
        Self {
            code: SqliteErrorCode::OperationFailed,
            context,
            detail: detail.into(),
        }
    }

    pub fn code(&self) -> SqliteErrorCode {
        self.code
    }

    pub fn retryable(&self) -> bool {
        matches!(
            self.code,
            SqliteErrorCode::Busy
                | SqliteErrorCode::Locked
                | SqliteErrorCode::PoolClosed
                | SqliteErrorCode::PoolTimedOut
        )
    }
}

impl SqliteErrorCode {
    pub fn api_code(self) -> &'static str {
        match self {
            Self::Busy => "SQLITE_BUSY",
            Self::Locked => "SQLITE_LOCKED",
            Self::PoolClosed => "SQLITE_POOL_CLOSED",
            Self::PoolTimedOut => "SQLITE_POOL_TIMED_OUT",
            Self::InvalidInput => "SQLITE_INVALID_INPUT",
            Self::OperationFailed => "SQLITE_OPERATION_FAILED",
        }
    }
}

impl fmt::Display for SqliteOperationError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "{}: {}", self.context, self.detail)
    }
}

impl std::error::Error for SqliteOperationError {}

fn classify_database_code(code: &str) -> SqliteErrorCode {
    let normalized = code.trim().to_ascii_uppercase();
    if normalized.starts_with("SQLITE_BUSY") {
        return SqliteErrorCode::Busy;
    }
    if normalized.starts_with("SQLITE_LOCKED") {
        return SqliteErrorCode::Locked;
    }

    match normalized.parse::<i32>().ok().map(|numeric| numeric & 0xff) {
        Some(5) => SqliteErrorCode::Busy,
        Some(6) => SqliteErrorCode::Locked,
        _ => SqliteErrorCode::OperationFailed,
    }
}

pub fn classify_sqlx_error(error: &sqlx::Error) -> SqliteErrorCode {
    match error {
        sqlx::Error::PoolClosed => SqliteErrorCode::PoolClosed,
        sqlx::Error::PoolTimedOut => SqliteErrorCode::PoolTimedOut,
        sqlx::Error::Database(database) => database
            .code()
            .map(|code| classify_database_code(code.as_ref()))
            .unwrap_or(SqliteErrorCode::OperationFailed),
        _ => SqliteErrorCode::OperationFailed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_primary_and_extended_codes_are_classified_without_messages() {
        assert_eq!(classify_database_code("5"), SqliteErrorCode::Busy);
        assert_eq!(classify_database_code("517"), SqliteErrorCode::Busy);
        assert_eq!(classify_database_code("6"), SqliteErrorCode::Locked);
        assert_eq!(classify_database_code("262"), SqliteErrorCode::Locked);
        assert_eq!(
            classify_database_code("SQLITE_BUSY_SNAPSHOT"),
            SqliteErrorCode::Busy
        );
        assert_eq!(
            classify_database_code("SQLITE_LOCKED_SHAREDCACHE"),
            SqliteErrorCode::Locked
        );
        assert_eq!(
            classify_database_code("2067"),
            SqliteErrorCode::OperationFailed
        );
    }

    #[test]
    fn pool_variants_have_stable_retryability() {
        assert_eq!(
            classify_sqlx_error(&sqlx::Error::PoolClosed),
            SqliteErrorCode::PoolClosed
        );
        assert_eq!(
            classify_sqlx_error(&sqlx::Error::PoolTimedOut),
            SqliteErrorCode::PoolTimedOut
        );
        assert!(SqliteOperationError::from_sqlx("write", sqlx::Error::PoolClosed).retryable());
        assert!(!SqliteOperationError::invalid_input("write", "bad").retryable());
    }
}
