use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::web_activity::normalize_domain;
use serde::Serialize;
use sqlx::{Pool, QueryBuilder, Row, Sqlite};
use std::collections::{BTreeMap, BTreeSet};
use tauri::{AppHandle, Runtime};

const MAX_WEB_ACTIVITY_BUCKETS: usize = 400;
const MAX_WEB_ACTIVITY_DOMAINS: usize = 7;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActivityAggregateRecordDto {
    pub normalized_domain: String,
    pub bucket_start_ms: i64,
    pub duration_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActivityDomainCoverageDto {
    pub normalized_domain: String,
    pub earliest_recorded_start_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebActivityAggregateRangeDto {
    pub records: Vec<WebActivityAggregateRecordDto>,
    pub domain_coverage: Vec<WebActivityDomainCoverageDto>,
}

#[derive(Clone, Debug)]
struct WebActivitySegmentSlice {
    normalized_domain: String,
    start_ms: i64,
    end_ms: i64,
}

fn validate_aggregate_input(
    start_ms: i64,
    end_ms: i64,
    bucket_boundaries_ms: &[i64],
) -> Result<(), String> {
    if start_ms < 0
        || end_ms <= start_ms
        || bucket_boundaries_ms.len() < 2
        || bucket_boundaries_ms.len() > MAX_WEB_ACTIVITY_BUCKETS + 1
        || bucket_boundaries_ms.first().copied() != Some(start_ms)
        || bucket_boundaries_ms.last().copied() != Some(end_ms)
        || bucket_boundaries_ms
            .windows(2)
            .any(|pair| pair[1] <= pair[0])
    {
        return Err("web activity aggregate bucket boundaries are invalid".to_string());
    }
    Ok(())
}

fn aggregate_segments(
    segments: Vec<WebActivitySegmentSlice>,
    bucket_boundaries_ms: &[i64],
) -> Vec<WebActivityAggregateRecordDto> {
    let mut durations = BTreeMap::<(String, i64), i64>::new();
    for segment in segments {
        let mut bucket_index = bucket_boundaries_ms
            .partition_point(|boundary| *boundary <= segment.start_ms)
            .saturating_sub(1);
        while bucket_index + 1 < bucket_boundaries_ms.len()
            && bucket_boundaries_ms[bucket_index] < segment.end_ms
        {
            let bucket_start = bucket_boundaries_ms[bucket_index];
            let bucket_end = bucket_boundaries_ms[bucket_index + 1];
            let clipped_start = segment.start_ms.max(bucket_start);
            let clipped_end = segment.end_ms.min(bucket_end);
            if clipped_end <= clipped_start {
                bucket_index += 1;
                continue;
            }
            *durations
                .entry((segment.normalized_domain.clone(), bucket_start))
                .or_default() += clipped_end - clipped_start;
            bucket_index += 1;
        }
    }

    durations
        .into_iter()
        .map(
            |((normalized_domain, bucket_start_ms), duration_ms)| WebActivityAggregateRecordDto {
                normalized_domain,
                bucket_start_ms,
                duration_ms,
            },
        )
        .collect()
}

fn normalize_domain_filter(
    normalized_domain: Option<&str>,
    normalized_domains: Option<&[String]>,
) -> Result<Option<Vec<String>>, String> {
    if normalized_domain.is_some() && normalized_domains.is_some() {
        return Err("web activity aggregate domain filters conflict".to_string());
    }
    if let Some(domain) = normalized_domain {
        return normalize_domain(domain)
            .map(|value| Some(vec![value]))
            .ok_or_else(|| "web activity aggregate domain is invalid".to_string());
    }
    let Some(domains) = normalized_domains else {
        return Ok(None);
    };
    if domains.is_empty() || domains.len() > MAX_WEB_ACTIVITY_DOMAINS {
        return Err("web activity aggregate domain selection is invalid".to_string());
    }
    let mut unique = BTreeSet::new();
    for domain in domains {
        let normalized = normalize_domain(domain)
            .ok_or_else(|| "web activity aggregate domain is invalid".to_string())?;
        unique.insert(normalized);
    }
    Ok(Some(unique.into_iter().collect()))
}

pub async fn load_web_activity_aggregate_range_from_pool(
    pool: &Pool<Sqlite>,
    start_ms: i64,
    end_ms: i64,
    bucket_boundaries_ms: &[i64],
    normalized_domain: Option<&str>,
    normalized_domains: Option<&[String]>,
    now_ms: i64,
) -> Result<WebActivityAggregateRangeDto, String> {
    validate_aggregate_input(start_ms, end_ms, bucket_boundaries_ms)?;
    let domain_filter = normalize_domain_filter(normalized_domain, normalized_domains)?;

    let mut segment_query =
        QueryBuilder::<Sqlite>::new("SELECT normalized_domain, start_time, COALESCE(end_time, ");
    segment_query
        .push_bind(now_ms)
        .push(") effective_end_time FROM web_activity_segments WHERE ");
    if let Some(domains) = domain_filter.as_ref() {
        segment_query.push("normalized_domain IN (");
        let mut separated = segment_query.separated(", ");
        for domain in domains {
            separated.push_bind(domain);
        }
        separated.push_unseparated(") AND ");
    }
    segment_query
        .push("start_time < ")
        .push_bind(end_ms)
        .push(" AND COALESCE(end_time, ")
        .push_bind(now_ms)
        .push(") > ")
        .push_bind(start_ms);
    let segment_rows = segment_query
        .build()
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to query web activity range: {error}"))?;

    let segments = segment_rows
        .into_iter()
        .filter_map(|row| {
            let normalized_domain = row.get::<String, _>("normalized_domain");
            let start_ms = row.get::<i64, _>("start_time");
            let end_ms = row.get::<i64, _>("effective_end_time");
            (end_ms > start_ms).then_some(WebActivitySegmentSlice {
                normalized_domain,
                start_ms,
                end_ms,
            })
        })
        .collect();

    let domain_coverage = if let Some(domains) = domain_filter.as_ref() {
        let mut coverage_query = QueryBuilder::<Sqlite>::new(
            "SELECT normalized_domain, MIN(start_time) earliest_recorded_start_ms \
             FROM web_activity_segments WHERE normalized_domain IN (",
        );
        let mut separated = coverage_query.separated(", ");
        for domain in domains {
            separated.push_bind(domain);
        }
        separated.push_unseparated(") GROUP BY normalized_domain");
        let coverage_rows = coverage_query
            .build()
            .fetch_all(pool)
            .await
            .map_err(|error| format!("failed to query web activity coverage: {error}"))?;
        coverage_rows
            .into_iter()
            .map(|row| WebActivityDomainCoverageDto {
                normalized_domain: row.get("normalized_domain"),
                earliest_recorded_start_ms: row.get("earliest_recorded_start_ms"),
            })
            .collect()
    } else {
        Vec::new()
    };

    Ok(WebActivityAggregateRangeDto {
        records: aggregate_segments(segments, bucket_boundaries_ms),
        domain_coverage,
    })
}

pub async fn load_web_activity_aggregate_range<R: Runtime>(
    app: &AppHandle<R>,
    start_ms: i64,
    end_ms: i64,
    bucket_boundaries_ms: Vec<i64>,
    normalized_domain: Option<String>,
    normalized_domains: Option<Vec<String>>,
) -> Result<WebActivityAggregateRangeDto, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    load_web_activity_aggregate_range_from_pool(
        &pool,
        start_ms,
        end_ms,
        &bucket_boundaries_ms,
        normalized_domain.as_deref(),
        normalized_domains.as_deref(),
        now_ms(),
    )
    .await
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::data::schema;
    use sqlx::Executor;

    async fn setup_test_db() -> Pool<Sqlite> {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();
        pool
    }

    #[test]
    fn aggregate_input_requires_exact_strict_boundaries_with_a_bounded_bucket_count() {
        assert!(validate_aggregate_input(0, 20, &[0, 10, 20]).is_ok());
        assert!(validate_aggregate_input(0, 20, &[0, 10, 10, 20]).is_err());
        assert!(validate_aggregate_input(0, 20, &[1, 10, 20]).is_err());
        assert!(validate_aggregate_input(0, 20, &[0, 10, 19]).is_err());
        assert!(validate_aggregate_input(20, 20, &[20, 20]).is_err());
        assert!(validate_aggregate_input(
            0,
            (MAX_WEB_ACTIVITY_BUCKETS + 1) as i64,
            &(0..=(MAX_WEB_ACTIVITY_BUCKETS + 1) as i64).collect::<Vec<_>>(),
        )
        .is_err());
    }

    #[test]
    fn domain_filter_rejects_conflicts_and_bounds_multi_selection() {
        let domains = vec!["a.test".to_string(), "b.test".to_string()];
        assert!(normalize_domain_filter(Some("a.test"), Some(&domains)).is_err());
        assert!(normalize_domain_filter(None, Some(&[])).is_err());
        let maximum = (0..MAX_WEB_ACTIVITY_DOMAINS)
            .map(|index| format!("{index}.test"))
            .collect::<Vec<_>>();
        assert_eq!(
            normalize_domain_filter(None, Some(&maximum))
                .unwrap()
                .as_ref()
                .map(Vec::len),
            Some(MAX_WEB_ACTIVITY_DOMAINS),
        );
        let too_many = (0..=MAX_WEB_ACTIVITY_DOMAINS)
            .map(|index| format!("{index}.test"))
            .collect::<Vec<_>>();
        assert!(normalize_domain_filter(None, Some(&too_many)).is_err());
        assert_eq!(
            normalize_domain_filter(
                None,
                Some(&[
                    "Example.COM.".to_string(),
                    "other.test".to_string(),
                    "example.com".to_string(),
                ]),
            )
            .unwrap(),
            Some(vec!["example.com".to_string(), "other.test".to_string()]),
        );
    }

    #[test]
    fn segment_durations_are_clipped_and_split_across_bucket_boundaries() {
        let records = aggregate_segments(
            vec![
                WebActivitySegmentSlice {
                    normalized_domain: "example.com".into(),
                    start_ms: 5,
                    end_ms: 15,
                },
                WebActivitySegmentSlice {
                    normalized_domain: "other.test".into(),
                    start_ms: -10,
                    end_ms: 4,
                },
            ],
            &[0, 10, 20],
        );

        assert_eq!(
            records,
            vec![
                WebActivityAggregateRecordDto {
                    normalized_domain: "example.com".into(),
                    bucket_start_ms: 0,
                    duration_ms: 5,
                },
                WebActivityAggregateRecordDto {
                    normalized_domain: "example.com".into(),
                    bucket_start_ms: 10,
                    duration_ms: 5,
                },
                WebActivityAggregateRecordDto {
                    normalized_domain: "other.test".into(),
                    bucket_start_ms: 0,
                    duration_ms: 4,
                },
            ],
        );
    }

    #[test]
    fn segment_durations_handle_midnight_month_and_range_edges_without_double_counting() {
        let records = aggregate_segments(
            vec![
                WebActivitySegmentSlice {
                    normalized_domain: "example.com".into(),
                    start_ms: -5,
                    end_ms: 12,
                },
                WebActivitySegmentSlice {
                    normalized_domain: "example.com".into(),
                    start_ms: 18,
                    end_ms: 35,
                },
            ],
            &[0, 10, 20, 30],
        );

        assert_eq!(
            records,
            vec![
                WebActivityAggregateRecordDto {
                    normalized_domain: "example.com".into(),
                    bucket_start_ms: 0,
                    duration_ms: 10,
                },
                WebActivityAggregateRecordDto {
                    normalized_domain: "example.com".into(),
                    bucket_start_ms: 10,
                    duration_ms: 4,
                },
                WebActivityAggregateRecordDto {
                    normalized_domain: "example.com".into(),
                    bucket_start_ms: 20,
                    duration_ms: 10,
                },
            ],
        );
    }

    #[test]
    fn pool_query_uses_a_fixed_now_for_active_segments_and_returns_minimal_coverage() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO web_activity_segments (
                    browser_client_id, browser_kind, browser_exe_name, domain, normalized_domain,
                    start_time, end_time, duration, source, created_at, updated_at
                 ) VALUES
                    ('a', 'chromium', 'chrome.exe', 'example.com', 'example.com',
                     5, 15, 10, 'test', 5, 15),
                    ('b', 'chromium', 'chrome.exe', 'example.com', 'example.com',
                     20, NULL, NULL, 'test', 20, 20)",
            )
            .execute(&pool)
            .await
            .unwrap();

            let result = load_web_activity_aggregate_range_from_pool(
                &pool,
                0,
                30,
                &[0, 10, 20, 30],
                Some("Example.COM."),
                None,
                25,
            )
            .await
            .unwrap();

            assert_eq!(
                result.records,
                vec![
                    WebActivityAggregateRecordDto {
                        normalized_domain: "example.com".into(),
                        bucket_start_ms: 0,
                        duration_ms: 5,
                    },
                    WebActivityAggregateRecordDto {
                        normalized_domain: "example.com".into(),
                        bucket_start_ms: 10,
                        duration_ms: 5,
                    },
                    WebActivityAggregateRecordDto {
                        normalized_domain: "example.com".into(),
                        bucket_start_ms: 20,
                        duration_ms: 5,
                    },
                ],
            );
            assert_eq!(
                result.domain_coverage,
                vec![WebActivityDomainCoverageDto {
                    normalized_domain: "example.com".into(),
                    earliest_recorded_start_ms: 5,
                }],
            );
        });
    }

    #[test]
    fn pool_query_filters_domains_and_uses_the_existing_range_indexes() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            for (domain, start, end) in [
                ("example.com", 5_i64, 15_i64),
                ("other.test", 7_i64, 12_i64),
            ] {
                sqlx::query(
                    "INSERT INTO web_activity_segments (
                        browser_client_id, browser_kind, browser_exe_name, domain, normalized_domain,
                        start_time, end_time, duration, source, created_at, updated_at
                     ) VALUES ('a', 'chromium', 'chrome.exe', ?, ?, ?, ?, ?, 'test', ?, ?)",
                )
                .bind(domain)
                .bind(domain)
                .bind(start)
                .bind(end)
                .bind(end - start)
                .bind(start)
                .bind(end)
                .execute(&pool)
                .await
                .unwrap();
            }

            let all = load_web_activity_aggregate_range_from_pool(
                &pool,
                0,
                20,
                &[0, 10, 20],
                None,
                None,
                20,
            )
            .await
            .unwrap();
            assert_eq!(all.records.len(), 4);
            assert!(all.domain_coverage.is_empty());

            let filtered = load_web_activity_aggregate_range_from_pool(
                &pool,
                0,
                20,
                &[0, 10, 20],
                Some("other.test"),
                None,
                20,
            )
            .await
            .unwrap();
            assert!(filtered
                .records
                .iter()
                .all(|record| record.normalized_domain == "other.test"));
            assert_eq!(
                filtered.domain_coverage,
                vec![WebActivityDomainCoverageDto {
                    normalized_domain: "other.test".into(),
                    earliest_recorded_start_ms: 7,
                }],
            );

            let selected_domains = vec!["other.test".to_string(), "example.com".to_string()];
            let multi = load_web_activity_aggregate_range_from_pool(
                &pool,
                0,
                20,
                &[0, 10, 20],
                None,
                Some(&selected_domains),
                20,
            )
            .await
            .unwrap();
            assert_eq!(multi.records.len(), 4);
            assert_eq!(
                multi.domain_coverage,
                vec![
                    WebActivityDomainCoverageDto {
                        normalized_domain: "example.com".into(),
                        earliest_recorded_start_ms: 5,
                    },
                    WebActivityDomainCoverageDto {
                        normalized_domain: "other.test".into(),
                        earliest_recorded_start_ms: 7,
                    },
                ],
            );

            let all_plan = sqlx::query(
                "EXPLAIN QUERY PLAN
                 SELECT normalized_domain, start_time, COALESCE(end_time, ?) effective_end_time
                 FROM web_activity_segments
                 WHERE start_time < ? AND COALESCE(end_time, ?) > ?",
            )
            .bind(20_i64)
            .bind(20_i64)
            .bind(20_i64)
            .bind(0_i64)
            .fetch_all(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.get::<String, _>("detail"))
            .collect::<Vec<_>>()
            .join("\n");
            assert!(
                all_plan.contains("idx_web_activity_segments_time"),
                "{all_plan}"
            );

            let domain_plan = sqlx::query(
                "EXPLAIN QUERY PLAN
                 SELECT normalized_domain, start_time, COALESCE(end_time, ?) effective_end_time
                 FROM web_activity_segments
                 WHERE normalized_domain = ? AND start_time < ? AND COALESCE(end_time, ?) > ?",
            )
            .bind(20_i64)
            .bind("other.test")
            .bind(20_i64)
            .bind(20_i64)
            .bind(0_i64)
            .fetch_all(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.get::<String, _>("detail"))
            .collect::<Vec<_>>()
            .join("\n");
            assert!(
                domain_plan.contains("idx_web_activity_segments_domain_time"),
                "{domain_plan}"
            );

            let multi_domain_plan = sqlx::query(
                "EXPLAIN QUERY PLAN
                 SELECT normalized_domain, start_time, COALESCE(end_time, ?) effective_end_time
                 FROM web_activity_segments
                 WHERE normalized_domain IN (?, ?)
                   AND start_time < ?
                   AND COALESCE(end_time, ?) > ?",
            )
            .bind(20_i64)
            .bind("example.com")
            .bind("other.test")
            .bind(20_i64)
            .bind(20_i64)
            .bind(0_i64)
            .fetch_all(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|row| row.get::<String, _>("detail"))
            .collect::<Vec<_>>()
            .join("\n");
            assert!(
                multi_domain_plan.contains("idx_web_activity_segments_domain_time"),
                "{multi_domain_plan}"
            );

            let empty = load_web_activity_aggregate_range_from_pool(
                &pool,
                30,
                40,
                &[30, 40],
                Some("missing.test"),
                None,
                40,
            )
            .await
            .unwrap();
            assert!(empty.records.is_empty());
            assert!(empty.domain_coverage.is_empty());
            assert!(load_web_activity_aggregate_range_from_pool(
                &pool,
                0,
                20,
                &[0, 20],
                Some(" "),
                None,
                20,
            )
            .await
            .is_err());
        });
    }
}
