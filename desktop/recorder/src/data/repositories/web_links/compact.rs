use super::*;
use crate::domain::web_links::{registrable_domain, resolve_owner};
use std::collections::BTreeSet;

/// Read recent facts plus only the metadata needed by their statistical owners.
/// Cached favicon candidates use indexed per-domain history, not a whole-history scan.
pub(crate) async fn recent_snapshot_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    start: i64,
    end: i64,
    now: i64,
) -> Result<WebLinksSnapshot, String> {
    let segments = read_segments_in_tx(tx, start, end, now).await?;
    let rules = load_in_tx(tx).await?;
    let all_overrides = read_overrides_in_tx(tx).await?;
    let mut domains: BTreeSet<String> = segments
        .iter()
        .map(|row| row.normalized_domain.clone())
        .collect();
    let owners: BTreeSet<String> = domains
        .iter()
        .map(|domain| resolve_owner(domain, &rules))
        .collect();
    let cached: Vec<(String, String)> = sqlx::query_as(
        "SELECT normalized_domain,favicon_url FROM web_favicon_cache WHERE trim(favicon_url) <> ''",
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| error.to_string())?;
    let mut totals = BTreeMap::new();
    let mut favicons = BTreeMap::new();
    for (domain, icon) in cached {
        if !owners.contains(&resolve_owner(&domain, &rules)) {
            continue;
        }
        let total: Option<i64> = sqlx::query_scalar(
            "WITH ordered AS (SELECT browser_client_id,browser_kind,browser_exe_name,start_time,
             COALESCE(end_time,updated_at) finish,
             MAX(COALESCE(end_time,updated_at)) OVER (PARTITION BY browser_client_id,browser_kind,browser_exe_name
             ORDER BY start_time,id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING) previous_end
             FROM web_activity_segments WHERE normalized_domain=?)
             SELECT SUM(MAX(0,finish-MAX(start_time,COALESCE(previous_end,start_time)))) FROM ordered",
        ).bind(&domain).fetch_one(&mut **tx).await.map_err(|error| error.to_string())?;
        // The main catalog chooses icons only from domains with retained facts.
        if let Some(total) = total {
            domains.insert(domain.clone());
            totals.insert(domain.clone(), total);
            favicons.insert(domain, icon);
        }
    }
    let roots: BTreeMap<String, String> = domains
        .iter()
        .filter_map(|domain| registrable_domain(domain).map(|root| (domain.clone(), root)))
        .collect();
    let rules = rules
        .into_iter()
        .filter(|(root, _)| roots.values().any(|value| value == root))
        .collect();
    let overrides = all_overrides
        .into_iter()
        .filter(|(domain, _)| domains.contains(domain))
        .collect();
    let anonymous_activity = super::super::anonymous_activity::read_range_tx(tx, start, end)
        .await
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|row| row.is_web)
        .collect();
    Ok(WebLinksSnapshot {
        segments: Some(segments),
        anonymous_activity: Some(anonymous_activity),
        rules,
        overrides,
        domains: domains.into_iter().collect(),
        roots,
        totals,
        favicons,
    })
}
