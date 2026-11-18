use crate::data::import::model::{
    ImportClassificationMutation, ImportCommitReportDto, ParsedCanonicalCsv,
};
use crate::data::import::preview::{load_canonical_file, validate_canonical_path};
use crate::data::repositories::classification_settings::ClassificationSettingMutation;
use crate::data::repositories::import_batches;

pub struct PreparedCanonicalImport {
    source_name: String,
    fingerprint: String,
    pub(crate) parsed: ParsedCanonicalCsv,
    pub(crate) classification_mutations: Vec<ClassificationSettingMutation>,
}

pub async fn prepare_canonical_import(
    file_path: String,
    expected_fingerprint: String,
    classification_mutations: Vec<ImportClassificationMutation>,
) -> Result<PreparedCanonicalImport, String> {
    if expected_fingerprint.trim().is_empty() {
        return Err("preview fingerprint is required".to_string());
    }
    let path = validate_canonical_path(&file_path)?;
    let (_, actual_fingerprint, parsed) = load_canonical_file(&path).await?;
    if actual_fingerprint != expected_fingerprint {
        return Err("canonical CSV changed after preview; preview it again".to_string());
    }
    let source_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "canonical CSV file name is not valid UTF-8".to_string())?
        .to_string();
    let classification_mutations = classification_mutations
        .into_iter()
        .map(|mutation| ClassificationSettingMutation {
            key: mutation.key,
            value: mutation.value,
        })
        .collect::<Vec<_>>();
    Ok(PreparedCanonicalImport {
        source_name,
        fingerprint: actual_fingerprint,
        parsed,
        classification_mutations,
    })
}

pub async fn commit_in_pool(
    pool: &sqlx::SqlitePool,
    prepared: PreparedCanonicalImport,
) -> Result<ImportCommitReportDto, String> {
    import_batches::commit_records(
        pool,
        &prepared.source_name,
        "patina-csv",
        &prepared.fingerprint,
        &prepared.parsed.records,
        prepared.parsed.errors.len(),
        &prepared.classification_mutations,
    )
    .await
}
