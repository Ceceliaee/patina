use super::{notify_tools_runtime, ToolsRuntimeState};
use crate::domain::tools::{ActivityReminderCheck, ActivityReminderTarget, ActivityReminderWatch};
use crate::domain::tracking::ActiveSessionSnapshot;
use std::sync::{Mutex, PoisonError};
use tauri::{AppHandle, Manager, Runtime};

pub fn notify_activity_reminder_app_transition<R: Runtime>(
    app: &AppHandle<R>,
    session: Option<&ActiveSessionSnapshot>,
) {
    if app
        .try_state::<ToolsRuntimeState>()
        .is_some_and(|state| state.activity_schedule.app_transition(session))
    {
        notify_tools_runtime(app);
    }
}

pub fn notify_activity_reminder_web_transition<R: Runtime>(
    app: &AppHandle<R>,
    domain: Option<&str>,
) {
    if app
        .try_state::<ToolsRuntimeState>()
        .is_some_and(|state| state.activity_schedule.web_transition(domain))
    {
        notify_tools_runtime(app);
    }
}

#[derive(Debug)]
pub(super) struct ActivityReminderSchedule(Mutex<ScheduleState>);

#[derive(Debug, Default)]
struct ScheduleState {
    watch: ActivityReminderWatch,
    pending_ids: Vec<i64>,
    reload_pending: bool,
    watch_stale: bool,
}

impl Default for ActivityReminderSchedule {
    fn default() -> Self {
        Self(Mutex::new(ScheduleState {
            reload_pending: true,
            watch_stale: true,
            ..Default::default()
        }))
    }
}

fn include(ids: &mut Vec<i64>, id: i64) {
    if !ids.contains(&id) {
        ids.push(id);
    }
}

impl ActivityReminderSchedule {
    pub fn invalidate(&self) {
        let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        state.reload_pending = true;
        state.watch_stale = true;
        state.pending_ids.clear();
    }

    pub fn request_rule(&self, id: i64) {
        let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if !state.watch_stale && state.watch.rules.iter().any(|rule| rule.id == id) {
            include(&mut state.pending_ids, id);
        }
    }

    pub fn next_check_at(&self) -> Option<i64> {
        let state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if state.reload_pending || !state.pending_ids.is_empty() {
            Some(0)
        } else {
            state.watch.next_check_at()
        }
    }

    pub fn take_due(&self, now_ms: i64) -> Option<ActivityReminderCheck> {
        let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if state.reload_pending {
            state.reload_pending = false;
            state.pending_ids.clear();
            return Some(ActivityReminderCheck::All);
        }
        let ScheduleState {
            watch, pending_ids, ..
        } = &mut *state;
        for rule in &mut watch.rules {
            if rule.next_check_at.is_some_and(|at| at <= now_ms) {
                include(pending_ids, rule.id);
            }
            if pending_ids.contains(&rule.id) {
                rule.next_check_at = None;
            }
        }
        (!pending_ids.is_empty()).then(|| ActivityReminderCheck::Rules(std::mem::take(pending_ids)))
    }

    pub fn retry(&self, check: &ActivityReminderCheck) {
        match check {
            ActivityReminderCheck::All => self.invalidate(),
            ActivityReminderCheck::Rules(ids) => {
                for &id in ids {
                    self.request_rule(id);
                }
            }
        }
    }

    pub fn complete(&self, check: &ActivityReminderCheck, watch: ActivityReminderWatch) {
        let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if state.reload_pending {
            return;
        }
        match check {
            ActivityReminderCheck::All => {
                state.watch = watch;
                state.watch_stale = false;
            }
            ActivityReminderCheck::Rules(ids) => {
                let ScheduleState {
                    watch: current,
                    pending_ids,
                    ..
                } = &mut *state;
                // A transition during the query owns the active state and next check.
                current
                    .rules
                    .retain(|rule| !ids.contains(&rule.id) || pending_ids.contains(&rule.id));
                current.rules.extend(
                    watch
                        .rules
                        .into_iter()
                        .filter(|rule| !pending_ids.contains(&rule.id)),
                );
            }
        }
    }

    pub fn app_transition(&self, session: Option<&ActiveSessionSnapshot>) -> bool {
        let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        // Newly enabled targets must not lose a visit while configuration is reloading.
        if state.watch_stale {
            state.reload_pending = true;
            return true;
        }
        let ScheduleState {
            watch, pending_ids, ..
        } = &mut *state;
        let category = session
            .filter(|_| {
                watch
                    .rules
                    .iter()
                    .any(|rule| matches!(rule.target, ActivityReminderTarget::Category { .. }))
            })
            .and_then(|session| {
                watch
                    .classification
                    .resolve_tracked_session_category(&session.exe_name)
            });
        let mut involved = false;
        for rule in &mut watch.rules {
            let active = session.is_some_and(|session| match &rule.target {
                ActivityReminderTarget::App { app_name, exe_name } => {
                    exe_name.as_deref().map_or_else(
                        || session.app_name.eq_ignore_ascii_case(app_name),
                        |exe| session.exe_name.eq_ignore_ascii_case(exe),
                    )
                }
                ActivityReminderTarget::Category { category_id } => category
                    .as_ref()
                    .is_some_and(|category| category.id == *category_id),
                // Native transitions also close the browser's bound web activity.
                ActivityReminderTarget::Web { .. } => false,
            });
            if rule.active || active {
                include(pending_ids, rule.id);
                involved = true;
            }
            rule.active = active;
        }
        involved
    }

    pub fn web_transition(&self, domain: Option<&str>) -> bool {
        let mut state = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if state.watch_stale {
            state.reload_pending = true;
            return true;
        }
        let ScheduleState {
            watch, pending_ids, ..
        } = &mut *state;
        let mut involved = false;
        for rule in &mut watch.rules {
            let ActivityReminderTarget::Web { normalized_domain } = &rule.target else {
                continue;
            };
            let active =
                domain.is_some_and(|domain| normalized_domain.eq_ignore_ascii_case(domain));
            if rule.active || active {
                include(pending_ids, rule.id);
                involved = true;
            }
            rule.active = active;
        }
        involved
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::tools::ActivityReminderWatchedRule;

    fn session(exe: &str) -> ActiveSessionSnapshot {
        ActiveSessionSnapshot {
            id: 1,
            exe_name: exe.into(),
            app_name: "Editor".into(),
            start_time: 1,
            continuity_group_start_time: 1,
            closed_duration_ms: 0,
        }
    }

    fn app(
        id: i64,
        exe: &str,
        active: bool,
        next_check_at: Option<i64>,
    ) -> ActivityReminderWatchedRule {
        ActivityReminderWatchedRule {
            id,
            target: ActivityReminderTarget::App {
                app_name: "Editor".into(),
                exe_name: Some(exe.into()),
            },
            active,
            next_check_at,
        }
    }

    fn web(
        id: i64,
        domain: &str,
        active: bool,
        next_check_at: Option<i64>,
    ) -> ActivityReminderWatchedRule {
        ActivityReminderWatchedRule {
            id,
            target: ActivityReminderTarget::Web {
                normalized_domain: domain.into(),
            },
            active,
            next_check_at,
        }
    }

    fn loaded(rules: Vec<ActivityReminderWatchedRule>) -> ActivityReminderSchedule {
        let schedule = ActivityReminderSchedule::default();
        assert_eq!(schedule.take_due(1), Some(ActivityReminderCheck::All));
        schedule.complete(
            &ActivityReminderCheck::All,
            ActivityReminderWatch {
                rules,
                ..Default::default()
            },
        );
        schedule
    }

    fn selected(schedule: &ActivityReminderSchedule, now: i64) -> Vec<i64> {
        let Some(ActivityReminderCheck::Rules(mut ids)) = schedule.take_due(now) else {
            panic!("expected selected rules");
        };
        ids.sort_unstable();
        ids
    }

    #[test]
    fn switches_select_only_departing_and_entering_rules_and_merge_fast_switches() {
        let schedule = loaded(vec![
            app(1, "a.exe", true, None),
            app(2, "b.exe", false, None),
            app(3, "c.exe", false, None),
            app(4, "unused.exe", false, None),
        ]);
        assert!(schedule.app_transition(Some(&session("B.exe"))));
        assert_eq!(selected(&schedule, 2), vec![1, 2]);
        assert!(schedule.app_transition(Some(&session("c.exe"))));
        assert!(schedule.app_transition(Some(&session("unrelated.exe"))));
        schedule.complete(
            &ActivityReminderCheck::Rules(vec![1, 2]),
            ActivityReminderWatch {
                rules: vec![
                    app(1, "a.exe", false, None),
                    app(2, "b.exe", true, Some(60_000)),
                ],
                ..Default::default()
            },
        );
        assert_eq!(selected(&schedule, 3), vec![2, 3]);
        assert!(!schedule.app_transition(Some(&session("other.exe"))));
    }

    #[test]
    fn category_members_and_linked_apps_include_only_matching_category_rules() {
        let mut development = app(2, "", false, None);
        development.target = ActivityReminderTarget::Category {
            category_id: "development".into(),
        };
        let mut game = app(3, "", false, None);
        game.target = ActivityReminderTarget::Category {
            category_id: "game".into(),
        };
        let schedule = loaded(vec![app(1, "editor.exe", false, None), development, game]);
        schedule.0.lock().unwrap().watch.classification =
            crate::domain::classification::ClassificationSnapshot::from_settings([
                (
                    "__app_override::editor.exe".into(),
                    r#"{"category":"development"}"#.into(),
                ),
                ("__app_link::helper.exe".into(), "editor.exe".into()),
            ]);
        assert!(schedule.app_transition(Some(&session("helper.exe"))));
        assert_eq!(selected(&schedule, 2), vec![2]);
        assert!(schedule.app_transition(Some(&session("EDITOR.exe"))));
        assert_eq!(selected(&schedule, 3), vec![1, 2]);
    }

    #[test]
    fn web_switches_do_not_check_native_rules_and_native_departure_closes_web() {
        let schedule = loaded(vec![
            app(1, "browser.exe", true, Some(100)),
            web(2, "a.test", true, Some(90)),
            web(3, "b.test", false, None),
            web(4, "unused.test", false, None),
        ]);
        assert!(schedule.web_transition(Some("B.test")));
        assert_eq!(selected(&schedule, 2), vec![2, 3]);
        assert!(schedule.app_transition(Some(&session("unrelated.exe"))));
        assert_eq!(selected(&schedule, 3), vec![1, 3]);
        assert!(!schedule.app_transition(Some(&session("other.exe"))));
        assert!(!schedule.web_transition(None));
    }

    #[test]
    fn deadlines_are_per_rule_and_partial_results_preserve_other_deadlines() {
        let schedule = loaded(vec![
            app(1, "browser.exe", true, Some(100)),
            web(2, "a.test", true, Some(200)),
        ]);
        assert_eq!(schedule.take_due(99), None);
        assert_eq!(selected(&schedule, 100), vec![1]);
        schedule.complete(
            &ActivityReminderCheck::Rules(vec![1]),
            ActivityReminderWatch {
                rules: vec![app(1, "browser.exe", true, None)],
                ..Default::default()
            },
        );
        assert_eq!(schedule.next_check_at(), Some(200));
        assert_eq!(selected(&schedule, 200), vec![2]);
        schedule.retry(&ActivityReminderCheck::Rules(vec![2]));
        assert_eq!(selected(&schedule, 201), vec![2]);
        schedule.complete(
            &ActivityReminderCheck::Rules(vec![2]),
            ActivityReminderWatch::default(),
        );
        assert_eq!(schedule.take_due(3_600_000), None);
    }

    #[test]
    fn leaving_cancels_only_that_rules_deadline() {
        let schedule = loaded(vec![
            app(1, "browser.exe", true, Some(100)),
            web(2, "a.test", true, Some(90)),
        ]);
        assert!(schedule.web_transition(None));
        assert_eq!(selected(&schedule, 2), vec![2]);
        schedule.complete(
            &ActivityReminderCheck::Rules(vec![2]),
            ActivityReminderWatch {
                rules: vec![web(2, "a.test", false, None)],
                ..Default::default()
            },
        );
        assert_eq!(schedule.take_due(90), None);
        assert_eq!(selected(&schedule, 100), vec![1]);
    }

    #[test]
    fn disabled_watch_skips_matching_and_reload_preserves_new_visits() {
        let schedule = loaded(vec![]);
        assert!(!schedule.app_transition(Some(&session("editor.exe"))));
        assert!(!schedule.web_transition(Some("example.test")));
        assert_eq!(schedule.take_due(60_000), None);
        schedule.invalidate();
        assert_eq!(schedule.take_due(60_001), Some(ActivityReminderCheck::All));
        assert!(schedule.app_transition(Some(&session("editor.exe"))));
        schedule.complete(
            &ActivityReminderCheck::All,
            ActivityReminderWatch::default(),
        );
        assert_eq!(schedule.take_due(60_002), Some(ActivityReminderCheck::All));
        schedule.complete(
            &ActivityReminderCheck::All,
            ActivityReminderWatch::default(),
        );
        assert!(!schedule.app_transition(Some(&session("editor.exe"))));
    }
}
