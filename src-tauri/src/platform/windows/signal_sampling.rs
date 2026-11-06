use std::{future::Future, sync::Mutex, time::Duration};
use tokio::sync::watch;

pub(super) struct SignalSampling {
    paused: watch::Receiver<bool>,
    sampled: Mutex<Option<watch::Receiver<bool>>>,
}

impl SignalSampling {
    pub(super) fn new(paused: watch::Receiver<bool>) -> Self {
        Self {
            paused,
            sampled: Mutex::default(),
        }
    }

    pub(super) fn current(&self) -> bool {
        self.sampled
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .as_ref()
            .is_some_and(|sample| matches!(sample.has_changed(), Ok(false)))
    }

    pub(super) async fn run<F, Fut>(&self, interval: Duration, mut probe: F)
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = ()>,
    {
        let mut paused = self.paused.clone();
        loop {
            if !*paused.borrow_and_update() {
                // The watch version distinguishes two active periods even if a
                // pause and resume both occurred during the same native call.
                let sampled = paused.clone();
                probe().await;
                *self
                    .sampled
                    .lock()
                    .unwrap_or_else(|error| error.into_inner()) = Some(sampled);
                tokio::select! {
                    result = paused.changed() => if result.is_err() { return },
                    _ = tokio::time::sleep(interval) => (),
                }
            } else if paused.changed().await.is_err() {
                return;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn pause_and_resume_during_probe_invalidates_old_result_and_wakes_immediately() {
        let (sender, paused) = watch::channel(true);
        let sampling = std::sync::Arc::new(SignalSampling::new(paused));
        let (entered, mut calls) = tokio::sync::mpsc::unbounded_channel();
        let release = std::sync::Arc::new(tokio::sync::Notify::new());
        let task = tokio::spawn({
            let gate = sampling.clone();
            let release = release.clone();
            async move {
                gate.run(Duration::from_secs(3600), || async {
                    entered.send(()).unwrap();
                    release.notified().await;
                })
                .await
            }
        });
        sender.send_replace(false);
        tokio::time::timeout(Duration::from_secs(2), calls.recv())
            .await
            .expect("initial resume did not start the probe")
            .unwrap();
        sender.send_replace(true);
        sender.send_replace(false);
        release.notify_one();
        tokio::time::timeout(Duration::from_secs(2), calls.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(!sampling.current());
        release.notify_one();
        tokio::time::timeout(Duration::from_secs(2), async {
            while !sampling.current() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        sender.send_replace(true);
        assert!(!sampling.current());
        drop(sender);
        tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("signal worker did not stop")
            .unwrap();
    }
}
