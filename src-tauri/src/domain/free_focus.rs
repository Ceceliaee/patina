use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RestMode {
    Fixed,
    Ratio,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct FreeFocusTask {
    pub id: i64,
    pub label: String,
    pub rest_mode: RestMode,
    pub rest_minutes: i64,
    pub rest_ratio: i64,
    pub phase: String,
    pub status: String,
    pub elapsed_ms: i64,
    pub rest_remaining_ms: i64,
    pub started_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

impl FreeFocusTask {
    fn delta(&self, now: i64) -> i64 {
        if self.status == "running" {
            now.saturating_sub(self.started_at.unwrap_or(now)).max(0)
        } else {
            0
        }
    }
    pub fn elapsed_at(&self, now: i64) -> i64 {
        self.elapsed_ms
            .saturating_add(if self.phase == "focus" {
                self.delta(now)
            } else {
                0
            })
            .min(9_007_199_254_740_991)
    }
    pub fn remaining_at(&self, now: i64) -> i64 {
        self.rest_remaining_ms
            .saturating_sub(if self.phase == "break" {
                self.delta(now)
            } else {
                0
            })
            .max(0)
    }
    pub fn rest_duration(&self, now: i64) -> i64 {
        match self.rest_mode {
            RestMode::Fixed => self.rest_minutes * 60_000,
            RestMode::Ratio => (self.elapsed_at(now) / self.rest_ratio).max(1_000),
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum FreeFocusAction {
    Save {
        id: Option<i64>,
        label: String,
        rest_mode: RestMode,
        rest_minutes: i64,
        rest_ratio: i64,
    },
    Resume {
        id: i64,
    },
    StartNext {
        id: i64,
        expected_updated_at: i64,
    },
    Pause {
        id: i64,
    },
    Finish {
        id: i64,
    },
    Reset {
        id: i64,
    },
    Delete {
        id: i64,
    },
}
