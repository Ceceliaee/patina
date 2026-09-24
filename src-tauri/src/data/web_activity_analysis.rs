use crate::data::sqlite_pool::wait_for_sqlite_pool;
use crate::domain::activity_read_model::ANONYMOUS_ACTIVITY_KEY;
use crate::domain::web_activity::normalize_domain;
use serde::Serialize;
use sha2::{Digest, Sha256};
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
    pub anonymous_records: Vec<AnonymousWebAggregateRecordDto>,
    pub web_links: crate::data::repositories::web_links::WebLinksSnapshot,
    pub records: Vec<WebActivityAggregateRecordDto>,
    pub domain_coverage: Vec<WebActivityDomainCoverageDto>,
    pub source_revision: String,
    pub snapshot_now_ms: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnonymousWebAggregateRecordDto {
    pub bucket_start_ms: i64,
    pub duration_ms: i64,
}

fn normalize_activity_domain(value: &str) -> Option<String> {
    if value == ANONYMOUS_ACTIVITY_KEY {
        Some(value.to_string())
    } else {
        normalize_domain(value)
    }
}

#[derive(Clone, Debug)]
struct WebActivitySegmentSlice {
    source_key: (String, String, String),
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
    mut segments: Vec<WebActivitySegmentSlice>,
    bucket_boundaries_ms: &[i64],
) -> Vec<WebActivityAggregateRecordDto> {
    let mut durations = BTreeMap::<(String, i64), i64>::new();
    segments.sort_by_key(|segment| (segment.start_ms, segment.end_ms));
    let mut source_ends = BTreeMap::new();
    for mut segment in segments {
        let key = (
            segment.source_key.clone(),
            segment.normalized_domain.clone(),
        );
        if let Some(end) = source_ends.get(&key) {
            segment.start_ms = segment.start_ms.max(*end);
        }
        if segment.end_ms <= segment.start_ms {
            continue;
        }
        source_ends.insert(key, segment.end_ms);
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
        return normalize_activity_domain(domain)
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
        let normalized = normalize_activity_domain(domain)
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
    let include_anonymous = domain_filter
        .as_ref()
        .is_none_or(|domains| domains.iter().any(|key| key == ANONYMOUS_ACTIVITY_KEY));
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin web activity aggregate snapshot: {error}"))?;
    let web_links = crate::data::repositories::web_links::snapshot_in_tx(&mut transaction).await?;
    let website_rules = &web_links.rules;
    let domain_filter = if let Some(selected) = domain_filter {
        if selected
            .iter()
            .any(|key| key.starts_with(crate::domain::web_links::LINK_GROUP_PREFIX))
        {
            Some(
                web_links
                    .domains
                    .iter()
                    .filter(|domain| {
                        selected.contains(domain)
                            || selected.contains(&crate::domain::web_links::resolve_owner(
                                domain,
                                website_rules,
                            ))
                    })
                    .cloned()
                    .collect::<Vec<_>>(),
            )
        } else {
            Some(selected)
        }
    } else {
        None
    };
    let domain_filter_json = domain_filter
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|error| error.to_string())?;
    let source_revision = sqlx::query_scalar::<_, i64>(
        "SELECT source_revision FROM web_activity_revision WHERE id = 1",
    )
    .fetch_one(&mut *transaction)
    .await
    .map_err(|error| format!("failed to read web activity source revision: {error}"))?;

    let mut segment_query = QueryBuilder::<Sqlite>::new(
        "SELECT browser_client_id, browser_kind, browser_exe_name, normalized_domain, start_time, COALESCE(end_time, MIN(updated_at + 45000, ",
    );
    segment_query
        .push_bind(now_ms)
        .push(")) effective_end_time FROM web_activity_segments WHERE ");
    if let Some(domains) = domain_filter_json.as_ref() {
        segment_query
            .push("normalized_domain IN (SELECT value FROM json_each(")
            .push_bind(domains)
            .push(")) AND ");
    }
    segment_query
        .push("start_time < ")
        .push_bind(end_ms)
        .push(" AND COALESCE(end_time, MIN(updated_at + 45000, ")
        .push_bind(now_ms)
        .push(")) > ")
        .push_bind(start_ms);
    let segment_rows = segment_query
        .build()
        .fetch_all(&mut *transaction)
        .await
        .map_err(|error| format!("failed to query web activity range: {error}"))?;

    let segments = segment_rows
        .into_iter()
        .filter_map(|row| {
            let normalized_domain = row.get::<String, _>("normalized_domain");
            let start_ms = row.get::<i64, _>("start_time");
            let end_ms = row.get::<i64, _>("effective_end_time").min(now_ms);
            (end_ms > start_ms).then_some(WebActivitySegmentSlice {
                source_key: (
                    row.get("browser_client_id"),
                    row.get("browser_kind"),
                    row.get("browser_exe_name"),
                ),
                normalized_domain,
                start_ms,
                end_ms,
            })
        })
        .collect();

    let mut domain_coverage = if let Some(domains) = domain_filter_json.as_ref() {
        let mut coverage_query = QueryBuilder::<Sqlite>::new(
            "SELECT normalized_domain, MIN(start_time) earliest_recorded_start_ms \
             FROM web_activity_segments WHERE normalized_domain IN (SELECT value FROM json_each(",
        );
        coverage_query
            .push_bind(domains)
            .push(")) GROUP BY normalized_domain");
        let coverage_rows = coverage_query
            .build()
            .fetch_all(&mut *transaction)
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

    if include_anonymous && domain_filter_json.is_some() {
        let earliest: Option<i64> = sqlx::query_scalar("SELECT MIN(start_time) FROM anonymous_activity WHERE is_web = 1 AND COALESCE(end_time, observed_until) > start_time")
            .fetch_one(&mut *transaction).await.map_err(|error| error.to_string())?;
        if let Some(start) = earliest {
            domain_coverage.push(WebActivityDomainCoverageDto {
                normalized_domain: crate::domain::activity_read_model::ANONYMOUS_ACTIVITY_KEY
                    .into(),
                earliest_recorded_start_ms: start,
            });
        }
    }

    let anonymous_records = if include_anonymous {
        let anonymous = crate::data::repositories::anonymous_activity::read_range_tx(
            &mut transaction,
            start_ms,
            end_ms,
        )
        .await
        .map_err(|error| error.to_string())?;
        aggregate_segments(
            anonymous
                .into_iter()
                .filter(|row| row.is_web)
                .map(|row| WebActivitySegmentSlice {
                    source_key: (String::new(), String::new(), String::new()),
                    normalized_domain: String::new(),
                    start_ms: row.start_time,
                    end_ms: row.end_time.unwrap_or(row.observed_until).min(now_ms),
                })
                .collect(),
            bucket_boundaries_ms,
        )
        .into_iter()
        .map(|row| AnonymousWebAggregateRecordDto {
            bucket_start_ms: row.bucket_start_ms,
            duration_ms: row.duration_ms,
        })
        .collect()
    } else {
        Vec::new()
    };
    let anonymous_revision: i64 =
        sqlx::query_scalar("SELECT source_revision FROM anonymous_activity_revision WHERE id = 1")
            .fetch_one(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
    transaction
        .commit()
        .await
        .map_err(|error| format!("failed to commit web activity aggregate snapshot: {error}"))?;

    let grouping_hash = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(&web_links, anonymous_revision))
                .map_err(|error| error.to_string())?
        )
    );
    Ok(WebActivityAggregateRangeDto {
        anonymous_records,
        web_links,
        records: aggregate_segments(segments, bucket_boundaries_ms),
        domain_coverage,
        source_revision: format!("{source_revision}:{grouping_hash}"),
        snapshot_now_ms: now_ms,
    })
}

pub async fn load_web_activity_aggregate_range<R: Runtime>(
    app: &AppHandle<R>,
    start_ms: i64,
    end_ms: i64,
    bucket_boundaries_ms: Vec<i64>,
    normalized_domain: Option<String>,
    normalized_domains: Option<Vec<String>>,
    snapshot_now_ms: Option<i64>,
) -> Result<WebActivityAggregateRangeDto, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let snapshot_now_ms = snapshot_now_ms.unwrap_or_else(now_ms);
    if snapshot_now_ms < 0 {
        return Err("web activity aggregate snapshot time is invalid".to_string());
    }
    load_web_activity_aggregate_range_from_pool(
        &pool,
        start_ms,
        end_ms,
        &bucket_boundaries_ms,
        normalized_domain.as_deref(),
        normalized_domains.as_deref(),
        snapshot_now_ms,
    )
    .await
}

fn now_ms() -> i64 {
    crate::platform::clock::unix_timestamp_millis_i64()
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
        pool.execute(schema::WEB_ACTIVITY_REVISION_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::IMPORT_DATA_SCHEMA_SQL).await.unwrap();
        pool.execute(schema::IMPORT_DATA_ISOLATION_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::ACTIVITY_READ_MODELS_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(crate::data::repositories::anonymous_activity::SCHEMA_SQL)
            .await
            .unwrap();
        pool
    }

    #[tokio::test]
    async fn anonymous_web_subset_preserves_boundaries_and_selection() {
        let pool = setup_test_db().await;
        let anonymous = crate::data::repositories::anonymous_activity::observe;
        anonymous(&pool, 0, false).await.unwrap();
        anonymous(&pool, 10_000, true).await.unwrap();
        anonymous(&pool, 20_000, false).await.unwrap();
        crate::data::repositories::anonymous_activity::seal(&pool, 30_000)
            .await
            .unwrap();
        let all = load_web_activity_aggregate_range_from_pool(
            &pool,
            0,
            30_000,
            &[0, 15_000, 30_000],
            None,
            None,
            30_000,
        )
        .await
        .unwrap();
        assert!(all.records.is_empty());
        assert_eq!(
            all.anonymous_records
                .iter()
                .map(|row| (row.bucket_start_ms, row.duration_ms))
                .collect::<Vec<_>>(),
            vec![(0, 5_000), (15_000, 5_000)]
        );
        let selected = load_web_activity_aggregate_range_from_pool(
            &pool,
            12_000,
            18_000,
            &[12_000, 18_000],
            Some(ANONYMOUS_ACTIVITY_KEY),
            None,
            30_000,
        )
        .await
        .unwrap();
        assert_eq!(selected.anonymous_records[0].duration_ms, 6_000);
        assert_eq!(
            selected.domain_coverage[0].earliest_recorded_start_ms,
            10_000
        );
        let named = load_web_activity_aggregate_range_from_pool(
            &pool,
            0,
            30_000,
            &[0, 30_000],
            Some("ordinary.test"),
            None,
            30_000,
        )
        .await
        .unwrap();
        assert!(named.anonymous_records.is_empty());
        assert!(named.domain_coverage.is_empty());
    }

    #[tokio::test]
    async fn website_filter_snapshot_and_revision_preserve_raw_facts() {
        let pool = setup_test_db().await;
        for (index, domain) in [
            "www.example.com",
            "mail.example.com",
            "a.mail.example.com",
            "other.com",
        ]
        .iter()
        .enumerate()
        {
            let start = index as i64 * 1000;
            sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,source,created_at,updated_at) VALUES('a','chrome','chrome.exe',?,?,?, ?,1000,'test',0,0)")
                .bind(domain).bind(domain).bind(start).bind(start+1000).execute(&pool).await.unwrap();
        }
        let before = load_web_activity_aggregate_range_from_pool(
            &pool,
            0,
            10000,
            &[0, 10000],
            None,
            None,
            10000,
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO settings(key,value) VALUES('__web_site::example.com',?)")
            .bind(r#"{"members":["www.example.com","a.mail.example.com"]}"#)
            .execute(&pool)
            .await
            .unwrap();
        let after = load_web_activity_aggregate_range_from_pool(
            &pool,
            0,
            10000,
            &[0, 10000],
            None,
            None,
            10000,
        )
        .await
        .unwrap();
        assert_ne!(before.source_revision, after.source_revision);
        assert_eq!(
            before
                .records
                .iter()
                .map(|row| row.duration_ms)
                .sum::<i64>(),
            after.records.iter().map(|row| row.duration_ms).sum::<i64>()
        );
        assert!(after
            .web_links
            .domains
            .contains(&"a.mail.example.com".into()));
        assert!(!after.web_links.domains.contains(&"example.com".into()));
        assert!(after.web_links.rules.contains_key("example.com"));
        let website = load_web_activity_aggregate_range_from_pool(
            &pool,
            0,
            10000,
            &[0, 10000],
            Some("site:example.com"),
            None,
            10000,
        )
        .await
        .unwrap();
        assert_eq!(
            website
                .records
                .iter()
                .map(|row| row.duration_ms)
                .sum::<i64>(),
            2000
        );
        assert!(website
            .records
            .iter()
            .all(|row| row.normalized_domain != "mail.example.com"));
        let raw = sqlx::query_scalar::<_, String>(
            "SELECT normalized_domain FROM web_activity_segments ORDER BY start_time",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(
            raw,
            vec![
                "www.example.com",
                "mail.example.com",
                "a.mail.example.com",
                "other.com"
            ]
        );
        pool.close().await;
    }

    #[tokio::test]
    async fn aggregate_unions_each_browser_source_without_filling_gaps() {
        let pool = setup_test_db().await;
        for (client, start, end) in [
            ("a", 0, 60000),
            ("a", 60800, 120800),
            ("a", 0, 60000),
            ("a", 10000, 20000),
            ("b", 0, 60000),
        ] {
            sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,source,created_at,updated_at) VALUES(?,'chrome','chrome.exe','example.test','example.test',?,?,?,'test',0,0)")
                .bind(client).bind(start).bind(end).bind(end-start).execute(&pool).await.unwrap();
        }
        let result = load_web_activity_aggregate_range_from_pool(
            &pool,
            0,
            200000,
            &[0, 60000, 60800, 200000],
            Some("example.test"),
            None,
            200000,
        )
        .await
        .unwrap();
        assert_eq!(
            result
                .records
                .iter()
                .map(|r| (r.bucket_start_ms, r.duration_ms))
                .collect::<Vec<_>>(),
            vec![(0, 120000), (60800, 60000)]
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM web_activity_segments")
                .fetch_one(&pool)
                .await
                .unwrap(),
            5
        );
        pool.close().await;
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
                    source_key: Default::default(),
                    normalized_domain: "example.com".into(),
                    start_ms: 5,
                    end_ms: 15,
                },
                WebActivitySegmentSlice {
                    source_key: Default::default(),
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
                    source_key: Default::default(),
                    normalized_domain: "example.com".into(),
                    start_ms: -5,
                    end_ms: 12,
                },
                WebActivitySegmentSlice {
                    source_key: Default::default(),
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
    fn handoff_facts_preserve_gaps_zero_fragments_and_fixed_cutoffs_in_the_sql_reader() {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Facts {
            case: String,
            native: Vec<(i64, i64)>,
            web: Vec<(i64, Option<i64>, i64)>,
            boundaries: Vec<i64>,
            now: i64,
            expected_buckets: Vec<i64>,
        }
        let fixtures: Vec<Facts> = serde_json::from_str(include_str!(
            "../../../tests/fixtures/activity-timing-facts.json"
        ))
        .unwrap();
        tauri::async_runtime::block_on(async {
            for facts in fixtures {
                let pool = setup_test_db().await;
                for (start, end, updated) in facts.web {
                    let cutoff = end.unwrap_or(facts.now.min(updated + 45_000)).max(start);
                    assert!(
                        cutoff == start
                            || facts.native.iter().any(|&(a, b)| a <= start && cutoff <= b),
                        "{}: webpage outside native interval",
                        facts.case
                    );
                    sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,end_time,duration,source,created_at,updated_at) VALUES('fixture','chrome','chrome.exe','fixture.test','fixture.test',?,?,?,'test',?,?)")
                        .bind(start).bind(end).bind(end.map(|end| end-start)).bind(start).bind(updated)
                        .execute(&pool).await.unwrap();
                }
                let result = load_web_activity_aggregate_range_from_pool(
                    &pool,
                    facts.boundaries[0],
                    *facts.boundaries.last().unwrap(),
                    &facts.boundaries,
                    None,
                    None,
                    facts.now,
                )
                .await
                .unwrap();
                let actual = facts.boundaries[..facts.boundaries.len() - 1]
                    .iter()
                    .map(|start| {
                        result
                            .records
                            .iter()
                            .filter(|row| row.bucket_start_ms == *start)
                            .map(|row| row.duration_ms)
                            .sum::<i64>()
                    })
                    .collect::<Vec<_>>();
                assert_eq!(actual, facts.expected_buckets, "{}", facts.case);
            }
        });
    }

    #[test]
    fn a_stalled_expiry_worker_cannot_make_readers_extend_an_observation_forever() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query("INSERT INTO web_activity_segments(browser_client_id,browser_kind,browser_exe_name,domain,normalized_domain,start_time,source,created_at,updated_at) VALUES('a','chrome','chrome.exe','example.test','example.test',1000,'test',1000,2000)")
                .execute(&pool).await.unwrap();
            let result = load_web_activity_aggregate_range_from_pool(
                &pool,
                0,
                600_000,
                &[0, 600_000],
                None,
                None,
                600_000,
            )
            .await
            .unwrap();
            assert_eq!(result.records.len(), 1);
            assert_eq!(result.records[0].duration_ms, 46_000);
            let end: Option<i64> = sqlx::query_scalar("SELECT end_time FROM web_activity_segments")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(end, None);
        });
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
            assert_eq!(result.source_revision.split(':').next(), Some("2"));
            assert_eq!(result.snapshot_now_ms, 25);
        });
    }

    #[test]
    fn web_activity_revision_changes_on_insert_update_and_delete() {
        tauri::async_runtime::block_on(async {
            let pool = setup_test_db().await;
            sqlx::query(
                "INSERT INTO web_activity_segments (
                    browser_client_id, browser_kind, browser_exe_name, domain, normalized_domain,
                    start_time, end_time, duration, source, created_at, updated_at
                 ) VALUES (
                    'a', 'chromium', 'chrome.exe', 'example.com', 'example.com',
                    5, 15, 10, 'test', 5, 15
                 )",
            )
            .execute(&pool)
            .await
            .unwrap();
            let inserted: i64 = sqlx::query_scalar(
                "SELECT source_revision FROM web_activity_revision WHERE id = 1",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(inserted, 1);

            sqlx::query(
                "UPDATE web_activity_segments
                 SET end_time = 20, duration = 15, updated_at = 20
                 WHERE id = 1",
            )
            .execute(&pool)
            .await
            .unwrap();
            let updated: i64 = sqlx::query_scalar(
                "SELECT source_revision FROM web_activity_revision WHERE id = 1",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(updated, 2);

            sqlx::query("DELETE FROM web_activity_segments WHERE id = 1")
                .execute(&pool)
                .await
                .unwrap();
            let deleted: i64 = sqlx::query_scalar(
                "SELECT source_revision FROM web_activity_revision WHERE id = 1",
            )
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(deleted, 3);
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
