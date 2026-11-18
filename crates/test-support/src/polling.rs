use std::{
    thread,
    time::{Duration, Instant},
};

/// Observe readiness without repeating the action that caused the transition.
/// Pending observations become the timeout diagnostic.
pub fn wait_observed<T>(label: &str, read: impl FnMut() -> Result<T, String>) -> Result<T, String> {
    poll(
        label,
        Duration::from_secs(25),
        Duration::from_millis(100),
        read,
    )
}

fn poll<T>(
    label: &str,
    timeout: Duration,
    interval: Duration,
    mut read: impl FnMut() -> Result<T, String>,
) -> Result<T, String> {
    let start = Instant::now();
    loop {
        let observation = match read() {
            Ok(value) => return Ok(value),
            Err(observation) => observation,
        };
        let remaining = timeout.saturating_sub(start.elapsed());
        if remaining.is_zero() {
            return Err(format!(
                "Timed out waiting for {label}; last observation: {observation}"
            ));
        }
        thread::sleep(interval.min(remaining));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pending_observations_do_not_complete_the_wait() {
        let mut calls = 0;
        let value = poll(
            "request completion",
            Duration::from_secs(1),
            Duration::ZERO,
            || {
                calls += 1;
                match calls {
                    1 => Err("not started".into()),
                    2 => Err("pending".into()),
                    _ => Ok(42),
                }
            },
        )
        .unwrap();
        assert_eq!(value, 42);
        assert_eq!(calls, 3);
    }

    #[test]
    fn timeout_reports_observation_without_retrying_action() {
        let mut calls = 0;
        let result = poll::<()>("focus", Duration::ZERO, Duration::ZERO, || {
            calls += 1;
            Err("focused=false, enabled=true".into())
        });
        assert_eq!(calls, 1);
        assert_eq!(
            result.unwrap_err(),
            "Timed out waiting for focus; last observation: focused=false, enabled=true"
        );
    }

    #[test]
    fn ready_value_is_returned_without_sleeping() {
        assert_eq!(
            poll("ready", Duration::ZERO, Duration::ZERO, || Ok(7)),
            Ok(7)
        );
    }
}
