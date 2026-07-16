use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Default)]
pub struct AppRestartState {
    requested: AtomicBool,
}

impl AppRestartState {
    pub fn try_request(&self) -> bool {
        !self.requested.swap(true, Ordering::AcqRel)
    }

    pub fn cancel_request(&self) {
        self.requested.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::AppRestartState;

    #[test]
    fn serializes_restart_requests_until_cancelled() {
        let state = AppRestartState::default();
        assert!(state.try_request());
        assert!(!state.try_request());
        state.cancel_request();
        assert!(state.try_request());
    }
}
