use std::time::{SystemTime, UNIX_EPOCH};

/// Returns wall-clock Unix time in milliseconds.
///
/// The clock is deliberately owned by `platform`: consumers that need deterministic
/// domain decisions should still accept an injected timestamp instead of reading it.
pub fn unix_timestamp_millis_u64() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

pub fn unix_timestamp_millis_i64() -> i64 {
    unix_timestamp_millis_u64().min(i64::MAX as u64) as i64
}

pub fn local_day_range_at(timestamp_ms: i64) -> Result<(i64, i64), String> {
    use chrono::TimeZone;
    let local = chrono::Local
        .timestamp_millis_opt(timestamp_ms)
        .single()
        .ok_or("Invalid local timestamp")?;
    let date = local.date_naive();
    let midnight = |date| {
        first_valid_local_time(date, |value| {
            chrono::Local
                .from_local_datetime(&value)
                .earliest()
                .map(|value| value.timestamp_millis())
        })
    };
    Ok((
        midnight(date)?,
        midnight(date.succ_opt().ok_or("Local date overflow")?)?,
    ))
}

fn first_valid_local_time(
    date: chrono::NaiveDate,
    resolve: impl Fn(chrono::NaiveDateTime) -> Option<i64>,
) -> Result<i64, String> {
    let midnight = date.and_hms_opt(0, 0, 0).ok_or("Local date overflow")?;
    let at = |seconds| {
        midnight
            .checked_add_signed(chrono::Duration::seconds(seconds))
            .and_then(&resolve)
    };
    if let Some(value) = at(0) {
        return Ok(value);
    }
    // Some zones advance at midnight, and date-line changes can skip an entire date.
    // Find the first valid local second without assuming every day has a 00:00.
    for hour in 1..=48 {
        let mut upper = hour * 3600;
        if at(upper).is_none() {
            continue;
        }
        let mut lower = upper - 3600;
        while upper - lower > 1 {
            let middle = lower + (upper - lower) / 2;
            if at(middle).is_some() {
                upper = middle;
            } else {
                lower = middle;
            }
        }
        return at(upper).ok_or_else(|| "Local day boundary is unavailable".into());
    }
    Err("Local day boundary is unavailable".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signed_and_unsigned_views_share_the_same_epoch_policy() {
        let before = unix_timestamp_millis_u64();
        let signed = unix_timestamp_millis_i64();
        let after = unix_timestamp_millis_u64();

        assert!(signed >= 0);
        assert!((signed as u64) >= before);
        assert!((signed as u64) <= after);
    }

    #[test]
    fn day_boundary_resolves_midnight_gaps_and_skipped_dates() {
        let date = chrono::NaiveDate::from_ymd_opt(2026, 3, 8).unwrap();
        let midnight = date.and_hms_opt(0, 0, 0).unwrap();
        for gap_seconds in [0, 1800, 3600, 86400] {
            let first = midnight + chrono::Duration::seconds(gap_seconds);
            let actual = first_valid_local_time(date, |value| {
                (value >= first).then(|| value.and_utc().timestamp_millis())
            })
            .unwrap();
            assert_eq!(actual, first.and_utc().timestamp_millis());
        }
        assert!(first_valid_local_time(date, |_| None).is_err());
    }
}
