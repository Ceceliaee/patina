use sqlx::{Pool, Row, Sqlite};

type SchemaRequirement = (
    &'static str,
    &'static [&'static str],
    &'static [&'static str],
);

type ForeignKeyRequirement = (&'static str, &'static str, &'static str, &'static str);

const BATCH_CASCADE_FOREIGN_KEY: ForeignKeyRequirement =
    ("batch_id", "import_batches", "id", "CASCADE");

const SHARED_REQUIREMENTS: &[SchemaRequirement] = &[
    (
        "import_batches",
        &[
            "id",
            "imported_at",
            "source_name",
            "source_kind",
            "source_fingerprint",
            "exact_session_count",
            "hour_bucket_count",
        ],
        &["idx_import_batches_imported_at"],
    ),
    (
        "import_time_buckets",
        &[
            "id",
            "batch_id",
            "fingerprint",
            "app_name",
            "exe_name",
            "bucket_start_time",
            "duration",
            "source_category",
            "source_path",
        ],
        &[
            "idx_import_time_buckets_time",
            "idx_import_time_buckets_exe_time",
            "idx_import_time_buckets_batch",
        ],
    ),
];

const V6_EXACT_REQUIREMENT: SchemaRequirement = (
    "import_exact_records",
    &[
        "batch_id",
        "session_id",
        "fingerprint",
        "source_category",
        "source_path",
    ],
    &["idx_import_exact_records_batch"],
);

const ISOLATED_EXACT_REQUIREMENT: SchemaRequirement = (
    "import_exact_sessions",
    &[
        "id",
        "batch_id",
        "fingerprint",
        "app_name",
        "exe_name",
        "window_title",
        "start_time",
        "end_time",
        "duration",
        "source_category",
        "source_path",
    ],
    &[
        "idx_import_exact_sessions_time",
        "idx_import_exact_sessions_exe_time",
        "idx_import_exact_sessions_batch",
    ],
);

pub(super) async fn has_import_data_v6_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    Ok(requirements_ready(pool, SHARED_REQUIREMENTS).await?
        && requirement_ready(pool, V6_EXACT_REQUIREMENT).await?
        && foreign_keys_match(
            pool,
            "import_exact_records",
            &[
                BATCH_CASCADE_FOREIGN_KEY,
                ("session_id", "sessions", "id", "CASCADE"),
            ],
        )
        .await?
        && foreign_keys_match(pool, "import_time_buckets", &[BATCH_CASCADE_FOREIGN_KEY]).await?)
}

pub(in crate::data) async fn has_import_data_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    Ok(requirements_ready(pool, SHARED_REQUIREMENTS).await?
        && requirement_ready(pool, ISOLATED_EXACT_REQUIREMENT).await?
        && foreign_keys_match(pool, "import_exact_sessions", &[BATCH_CASCADE_FOREIGN_KEY]).await?
        && foreign_keys_match(pool, "import_time_buckets", &[BATCH_CASCADE_FOREIGN_KEY]).await?
        && !table_exists(pool, "import_exact_records").await?
        && !table_exists(pool, "import_exact_migration_guard").await?)
}

async fn requirements_ready(
    pool: &Pool<Sqlite>,
    requirements: &[SchemaRequirement],
) -> Result<bool, String> {
    for requirement in requirements {
        if !requirement_ready(pool, *requirement).await? {
            return Ok(false);
        }
    }
    Ok(true)
}

async fn requirement_ready(
    pool: &Pool<Sqlite>,
    (table, columns, indexes): SchemaRequirement,
) -> Result<bool, String> {
    if !table_exists(pool, table).await? || !table_has_columns(pool, table, columns).await? {
        return Ok(false);
    }
    for index in indexes {
        if !table_has_index(pool, table, index).await? {
            return Ok(false);
        }
    }
    Ok(true)
}

async fn table_exists(pool: &Pool<Sqlite>, table: &str) -> Result<bool, String> {
    sqlx::query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
        .bind(table)
        .fetch_optional(pool)
        .await
        .map(|row| row.is_some())
        .map_err(|error| format!("failed to inspect sqlite table `{table}`: {error}"))
}

async fn table_has_columns(
    pool: &Pool<Sqlite>,
    table: &str,
    required: &[&str],
) -> Result<bool, String> {
    let pragma = match table {
        "import_batches" => "PRAGMA table_info(import_batches)",
        "import_exact_records" => "PRAGMA table_info(import_exact_records)",
        "import_exact_sessions" => "PRAGMA table_info(import_exact_sessions)",
        "import_time_buckets" => "PRAGMA table_info(import_time_buckets)",
        _ => return Err(format!("unsupported import schema table `{table}`")),
    };
    let columns = sqlx::query(pragma)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to inspect `{table}` columns: {error}"))?
        .into_iter()
        .map(|row| row.get::<String, _>("name"))
        .collect::<Vec<_>>();
    Ok(required
        .iter()
        .all(|name| columns.iter().any(|column| column == name)))
}

async fn table_has_index(pool: &Pool<Sqlite>, table: &str, required: &str) -> Result<bool, String> {
    let pragma = match table {
        "import_batches" => "PRAGMA index_list(import_batches)",
        "import_exact_records" => "PRAGMA index_list(import_exact_records)",
        "import_exact_sessions" => "PRAGMA index_list(import_exact_sessions)",
        "import_time_buckets" => "PRAGMA index_list(import_time_buckets)",
        _ => return Err(format!("unsupported import index table `{table}`")),
    };
    let rows = sqlx::query(pragma)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to inspect `{table}` indexes: {error}"))?;
    Ok(rows
        .iter()
        .any(|row| row.get::<String, _>("name") == required))
}

async fn foreign_keys_match(
    pool: &Pool<Sqlite>,
    table: &str,
    expected: &[ForeignKeyRequirement],
) -> Result<bool, String> {
    let pragma = match table {
        "import_exact_records" => "PRAGMA foreign_key_list(import_exact_records)",
        "import_exact_sessions" => "PRAGMA foreign_key_list(import_exact_sessions)",
        "import_time_buckets" => "PRAGMA foreign_key_list(import_time_buckets)",
        _ => return Err(format!("unsupported import foreign key table `{table}`")),
    };
    let rows = sqlx::query(pragma)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to inspect `{table}` foreign keys: {error}"))?;
    if rows.len() != expected.len() {
        return Ok(false);
    }
    Ok(expected.iter().all(|(from, target_table, to, on_delete)| {
        rows.iter().any(|row| {
            row.get::<String, _>("from") == *from
                && row.get::<String, _>("table") == *target_table
                && row.get::<String, _>("to") == *to
                && row.get::<String, _>("on_delete") == *on_delete
        })
    }))
}
