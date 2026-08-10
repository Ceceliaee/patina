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
}
