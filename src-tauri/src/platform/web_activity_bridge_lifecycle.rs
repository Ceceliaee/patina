use serde::Serialize;
use std::io;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const RETRY_INITIAL_DELAY_MS: u64 = 1_000;
const RETRY_MAX_DELAY_MS: u64 = 30_000;
const RETRY_MAX_FAILURES: u32 = 7;
const RETRY_JITTER_SPAN_MS: u64 = 251;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WebActivityBridgeRuntimeStatus {
    Disabled,
    Starting,
    Listening,
    RetryWait,
    FailedTerminal,
    Stopping,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum WebActivityBridgeErrorCategory {
    AddressInUse,
    AddressUnavailable,
    PermissionDenied,
    InvalidInput,
    ResourceExhausted,
    Interrupted,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WebActivityBridgeRuntimeSnapshot {
    pub status: WebActivityBridgeRuntimeStatus,
    pub port: Option<u16>,
    pub last_error_category: Option<WebActivityBridgeErrorCategory>,
    pub retry_count: u32,
    pub next_retry_at_ms: Option<u64>,
}

impl Default for WebActivityBridgeRuntimeSnapshot {
    fn default() -> Self {
        Self {
            status: WebActivityBridgeRuntimeStatus::Disabled,
            port: None,
            last_error_category: None,
            retry_count: 0,
            next_retry_at_ms: None,
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct WebActivityBridgeLifecycle {
    generation: u64,
    snapshot: WebActivityBridgeRuntimeSnapshot,
}

impl WebActivityBridgeLifecycle {
    pub(crate) fn snapshot(&self) -> WebActivityBridgeRuntimeSnapshot {
        self.snapshot.clone()
    }

    pub(crate) fn start(&mut self, generation: u64, port: u16) {
        self.generation = generation;
        self.snapshot = WebActivityBridgeRuntimeSnapshot {
            status: WebActivityBridgeRuntimeStatus::Starting,
            port: Some(port),
            ..WebActivityBridgeRuntimeSnapshot::default()
        };
    }

    pub(crate) fn disable(&mut self, generation: u64) {
        if generation < self.generation {
            return;
        }
        self.generation = generation;
        self.snapshot = WebActivityBridgeRuntimeSnapshot::default();
    }

    pub(crate) fn mark_starting_retry(&mut self, generation: u64) {
        if generation != self.generation {
            return;
        }
        self.snapshot.status = WebActivityBridgeRuntimeStatus::Starting;
        self.snapshot.next_retry_at_ms = None;
    }

    pub(crate) fn mark_listening(&mut self, generation: u64) {
        if generation != self.generation {
            return;
        }
        self.snapshot.status = WebActivityBridgeRuntimeStatus::Listening;
        self.snapshot.last_error_category = None;
        self.snapshot.retry_count = 0;
        self.snapshot.next_retry_at_ms = None;
    }

    pub(crate) fn mark_retry_wait(
        &mut self,
        generation: u64,
        category: WebActivityBridgeErrorCategory,
        retry_count: u32,
        next_retry_at_ms: u64,
    ) {
        if generation != self.generation {
            return;
        }
        self.snapshot.status = WebActivityBridgeRuntimeStatus::RetryWait;
        self.snapshot.last_error_category = Some(category);
        self.snapshot.retry_count = retry_count;
        self.snapshot.next_retry_at_ms = Some(next_retry_at_ms);
    }

    pub(crate) fn mark_failed_terminal(
        &mut self,
        generation: u64,
        category: WebActivityBridgeErrorCategory,
        retry_count: u32,
    ) {
        if generation != self.generation {
            return;
        }
        self.snapshot.status = WebActivityBridgeRuntimeStatus::FailedTerminal;
        self.snapshot.last_error_category = Some(category);
        self.snapshot.retry_count = retry_count;
        self.snapshot.next_retry_at_ms = None;
    }

    pub(crate) fn mark_stopping(&mut self, generation: u64) {
        if generation != self.generation {
            return;
        }
        self.snapshot.status = WebActivityBridgeRuntimeStatus::Stopping;
        self.snapshot.next_retry_at_ms = None;
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct WebActivityBridgeRetryPolicy {
    initial_delay_ms: u64,
    max_delay_ms: u64,
    max_failures: u32,
    jitter_span_ms: u64,
}

impl WebActivityBridgeRetryPolicy {
    pub(crate) const PRODUCTION: Self = Self {
        initial_delay_ms: RETRY_INITIAL_DELAY_MS,
        max_delay_ms: RETRY_MAX_DELAY_MS,
        max_failures: RETRY_MAX_FAILURES,
        jitter_span_ms: RETRY_JITTER_SPAN_MS,
    };

    pub(crate) fn should_retry(self, failure_count: u32) -> bool {
        failure_count < self.max_failures
    }

    pub(crate) fn delay(self, port: u16, failure_count: u32) -> Duration {
        let exponent = failure_count.saturating_sub(1).min(31);
        let base_delay = self
            .initial_delay_ms
            .saturating_mul(1_u64 << exponent)
            .min(self.max_delay_ms);
        let jitter = if self.jitter_span_ms == 0 {
            0
        } else {
            (u64::from(port)
                .wrapping_mul(31)
                .wrapping_add(u64::from(failure_count).wrapping_mul(17)))
                % self.jitter_span_ms
        };
        Duration::from_millis(base_delay.saturating_add(jitter).min(self.max_delay_ms))
    }

    #[cfg(test)]
    pub(crate) const fn for_tests(delay_ms: u64, max_failures: u32) -> Self {
        Self {
            initial_delay_ms: delay_ms,
            max_delay_ms: delay_ms,
            max_failures,
            jitter_span_ms: 0,
        }
    }
}

pub(crate) fn classify_bind_error(error: &io::Error) -> WebActivityBridgeErrorCategory {
    match error.kind() {
        io::ErrorKind::AddrInUse => WebActivityBridgeErrorCategory::AddressInUse,
        io::ErrorKind::AddrNotAvailable => WebActivityBridgeErrorCategory::AddressUnavailable,
        io::ErrorKind::PermissionDenied => WebActivityBridgeErrorCategory::PermissionDenied,
        io::ErrorKind::InvalidInput => WebActivityBridgeErrorCategory::InvalidInput,
        io::ErrorKind::OutOfMemory => WebActivityBridgeErrorCategory::ResourceExhausted,
        io::ErrorKind::Interrupted => WebActivityBridgeErrorCategory::Interrupted,
        _ => WebActivityBridgeErrorCategory::Other,
    }
}

pub(crate) fn is_retryable_bind_error(category: WebActivityBridgeErrorCategory) -> bool {
    matches!(
        category,
        WebActivityBridgeErrorCategory::AddressInUse
            | WebActivityBridgeErrorCategory::AddressUnavailable
            | WebActivityBridgeErrorCategory::ResourceExhausted
            | WebActivityBridgeErrorCategory::Interrupted
    )
}

pub(crate) fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn production_retry_policy_is_bounded_and_deterministic() {
        let delays = (1..=7)
            .map(|failure| {
                WebActivityBridgeRetryPolicy::PRODUCTION
                    .delay(17_321, failure)
                    .as_millis() as u64
            })
            .collect::<Vec<_>>();

        assert!(delays[0] >= 1_000 && delays[0] < 1_251);
        assert!(delays[1] >= 2_000 && delays[1] < 2_251);
        assert!(delays[2] >= 4_000 && delays[2] < 4_251);
        assert!(delays[3] >= 8_000 && delays[3] < 8_251);
        assert!(delays[4] >= 16_000 && delays[4] < 16_251);
        assert_eq!(delays[5], 30_000);
        assert_eq!(delays[6], 30_000);
        assert!(WebActivityBridgeRetryPolicy::PRODUCTION.should_retry(6));
        assert!(!WebActivityBridgeRetryPolicy::PRODUCTION.should_retry(7));
    }

    #[test]
    fn bind_errors_distinguish_retryable_and_terminal_categories() {
        let occupied = classify_bind_error(&io::Error::from(io::ErrorKind::AddrInUse));
        let denied = classify_bind_error(&io::Error::from(io::ErrorKind::PermissionDenied));
        let invalid = classify_bind_error(&io::Error::from(io::ErrorKind::InvalidInput));

        assert_eq!(occupied, WebActivityBridgeErrorCategory::AddressInUse);
        assert!(is_retryable_bind_error(occupied));
        assert_eq!(denied, WebActivityBridgeErrorCategory::PermissionDenied);
        assert!(!is_retryable_bind_error(denied));
        assert_eq!(invalid, WebActivityBridgeErrorCategory::InvalidInput);
        assert!(!is_retryable_bind_error(invalid));
    }

    #[test]
    fn stale_generation_cannot_overwrite_current_lifecycle() {
        let mut lifecycle = WebActivityBridgeLifecycle::default();
        lifecycle.start(4, 17_321);
        lifecycle.mark_retry_wait(4, WebActivityBridgeErrorCategory::AddressInUse, 1, 100);
        lifecycle.start(5, 17_322);
        lifecycle.mark_failed_terminal(4, WebActivityBridgeErrorCategory::Other, 7);

        assert_eq!(
            lifecycle.snapshot(),
            WebActivityBridgeRuntimeSnapshot {
                status: WebActivityBridgeRuntimeStatus::Starting,
                port: Some(17_322),
                last_error_category: None,
                retry_count: 0,
                next_retry_at_ms: None,
            }
        );
    }

    #[test]
    fn serialized_diagnostics_have_no_token_field() {
        let snapshot = WebActivityBridgeRuntimeSnapshot {
            status: WebActivityBridgeRuntimeStatus::RetryWait,
            port: Some(17_321),
            last_error_category: Some(WebActivityBridgeErrorCategory::AddressInUse),
            retry_count: 2,
            next_retry_at_ms: Some(42),
        };
        let serialized = serde_json::to_string(&snapshot).unwrap();

        assert!(serialized.contains("\"status\":\"retry-wait\""));
        assert!(serialized.contains("\"last_error_category\":\"address-in-use\""));
        assert!(!serialized.contains("token"));
    }
}
