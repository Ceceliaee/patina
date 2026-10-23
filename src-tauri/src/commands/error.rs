use crate::data::sqlite_error::SqliteOperationError;
use serde::Serialize;

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandErrorDto {
    pub code: String,
    pub message: String,
    pub retryable: bool,
}

impl CommandErrorDto {
    pub fn new(code: impl Into<String>, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            retryable,
        }
    }
}

impl From<SqliteOperationError> for CommandErrorDto {
    fn from(error: SqliteOperationError) -> Self {
        Self::new(
            error.code().api_code(),
            error.to_string(),
            error.retryable(),
        )
    }
}

impl From<crate::domain::backup::BackupError> for CommandErrorDto {
    fn from(error: crate::domain::backup::BackupError) -> Self {
        let code = match &error {
            crate::domain::backup::BackupError::UnsupportedFormat => "BACKUP_FORMAT_UNSUPPORTED",
            crate::domain::backup::BackupError::Invalid(_) => "BACKUP_FAILED",
        };
        Self::new(code, error.to_string(), false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqlite_error_mapping_is_stable_and_machine_readable() {
        let dto = CommandErrorDto::from(SqliteOperationError::from_sqlx(
            "saving settings",
            sqlx::Error::PoolClosed,
        ));
        assert_eq!(dto.code, "SQLITE_POOL_CLOSED");
        assert!(dto.retryable);
        assert!(dto.message.starts_with("saving settings:"));
    }
}
