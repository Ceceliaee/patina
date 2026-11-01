use chrono::{Datelike, Duration, LocalResult, Months, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum ReminderRecurrence {
    Interval { minutes: u32 },
    Daily,
    Monthly,
    Yearly,
    Weekly { weekdays: Vec<u32> },
}

impl ReminderRecurrence {
    pub fn validate(&self) -> Result<(), String> {
        match self {
            Self::Interval { minutes } if !(1..=86_400).contains(minutes) => {
                Err("reminder interval must be between 1 minute and 60 days".into())
            }
            Self::Weekly { weekdays }
                if weekdays.is_empty()
                    || weekdays.len() > 7
                    || weekdays.iter().any(|day| !(1..=7).contains(day))
                    || weekdays
                        .iter()
                        .enumerate()
                        .any(|(i, day)| weekdays[..i].contains(day)) =>
            {
                Err("reminder weekdays must be unique ISO weekdays".into())
            }
            _ => Ok(()),
        }
    }

    pub fn next_after<T: TimeZone>(
        &self,
        anchor_ms: i64,
        after_ms: i64,
        timezone: &T,
    ) -> Result<i64, String> {
        self.validate()?;
        let invalid = || "reminder time is outside the supported range".to_string();
        let anchor = timezone
            .timestamp_millis_opt(anchor_ms)
            .single()
            .ok_or_else(invalid)?;
        let after = timezone
            .timestamp_millis_opt(after_ms)
            .single()
            .ok_or_else(invalid)?;
        if let Self::Interval { minutes } = self {
            let step = i64::from(*minutes) * 60_000;
            let count = if after_ms < anchor_ms {
                0
            } else {
                after_ms.checked_sub(anchor_ms).ok_or_else(invalid)? / step + 1
            };
            return count
                .checked_mul(step)
                .and_then(|delta| anchor_ms.checked_add(delta))
                .filter(|next| timezone.timestamp_millis_opt(*next).single().is_some())
                .ok_or_else(invalid);
        }
        let start = after.date_naive().max(anchor.date_naive());
        // Eight years includes the leap-day gap across a non-leap century.
        for offset in 0..=8 {
            let date = match self {
                Self::Monthly => start
                    .with_day(1)
                    .and_then(|date| date.checked_add_months(Months::new(offset)))
                    .and_then(|date| {
                        NaiveDate::from_ymd_opt(date.year(), date.month(), anchor.day())
                    }),
                Self::Yearly => start
                    .year()
                    .checked_add(offset as i32)
                    .and_then(|year| NaiveDate::from_ymd_opt(year, anchor.month(), anchor.day())),
                _ => start.checked_add_signed(Duration::days(i64::from(offset))),
            };
            let Some(date) = date else { continue };
            if let Self::Weekly { weekdays } = self {
                if !weekdays.contains(&date.weekday().number_from_monday()) {
                    continue;
                }
            }
            let wall_time = date.and_time(anchor.time());
            // A missing DST wall time moves to the first valid minute; an ambiguous time fires once.
            for minutes in 0..=180 {
                let candidate = wall_time
                    .checked_add_signed(Duration::minutes(minutes))
                    .ok_or_else(invalid)?;
                let resolved = match timezone.from_local_datetime(&candidate) {
                    LocalResult::Single(value) => Some(value),
                    LocalResult::Ambiguous(first, second) => Some(first.min(second)),
                    LocalResult::None => None,
                };
                if let Some(value) = resolved {
                    let next = value.timestamp_millis();
                    if next > after_ms && next >= anchor_ms {
                        return Ok(next);
                    }
                    break;
                }
            }
        }
        Err(invalid())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{FixedOffset, Utc};

    #[test]
    fn interval_keeps_original_cadence_after_snooze_or_long_absence() {
        let rule = ReminderRecurrence::Interval { minutes: 30 };
        assert_eq!(rule.next_after(60_000, 60_000, &Utc).unwrap(), 1_860_000);
        assert_eq!(rule.next_after(60_000, 5_000_000, &Utc).unwrap(), 5_460_000);
        assert_eq!(rule.next_after(60_000, 0, &Utc).unwrap(), 60_000);
    }

    #[test]
    fn calendar_rules_use_local_dates_and_skip_unselected_days() {
        let zone = FixedOffset::east_opt(8 * 3600).unwrap();
        let start = zone.with_ymd_and_hms(2026, 11, 1, 18, 0, 0).unwrap();
        let monday = zone.with_ymd_and_hms(2026, 11, 2, 18, 0, 0).unwrap();
        assert_eq!(
            ReminderRecurrence::Daily
                .next_after(start.timestamp_millis(), start.timestamp_millis(), &zone)
                .unwrap(),
            monday.timestamp_millis()
        );
        let weekly = ReminderRecurrence::Weekly {
            weekdays: vec![1, 5],
        };
        assert_eq!(
            weekly
                .next_after(
                    start.timestamp_millis(),
                    start.timestamp_millis() - 1,
                    &zone
                )
                .unwrap(),
            monday.timestamp_millis()
        );
        assert_eq!(
            weekly
                .next_after(start.timestamp_millis(), monday.timestamp_millis(), &zone)
                .unwrap(),
            zone.with_ymd_and_hms(2026, 11, 6, 18, 0, 0)
                .unwrap()
                .timestamp_millis()
        );
    }

    #[test]
    fn invalid_rules_and_time_overflow_fail() {
        for rule in [
            ReminderRecurrence::Interval { minutes: 0 },
            ReminderRecurrence::Weekly { weekdays: vec![] },
            ReminderRecurrence::Weekly {
                weekdays: vec![1, 1],
            },
            ReminderRecurrence::Weekly { weekdays: vec![8] },
        ] {
            assert!(rule.validate().is_err());
        }
        assert!(ReminderRecurrence::Daily
            .next_after(i64::MAX, 0, &Utc)
            .is_err());
    }

    #[test]
    fn monthly_skips_missing_dates_and_retains_the_original_day() {
        let zone = FixedOffset::east_opt(8 * 3600).unwrap();
        let at = |year, month, day| {
            zone.with_ymd_and_hms(year, month, day, 9, 15, 0)
                .unwrap()
                .timestamp_millis()
        };
        let anchor = at(2026, 1, 31);
        let rule = ReminderRecurrence::Monthly;
        assert_eq!(rule.next_after(anchor, anchor - 1, &zone).unwrap(), anchor);
        assert_eq!(
            rule.next_after(anchor, anchor, &zone).unwrap(),
            at(2026, 3, 31)
        );
        assert_eq!(
            rule.next_after(anchor, at(2026, 3, 31), &zone).unwrap(),
            at(2026, 5, 31)
        );
        assert_eq!(
            rule.next_after(anchor, at(2026, 12, 31), &zone).unwrap(),
            at(2027, 1, 31)
        );
        assert_eq!(
            rule.next_after(at(2026, 1, 30), at(2026, 1, 30), &zone)
                .unwrap(),
            at(2026, 3, 30)
        );
    }

    #[test]
    fn yearly_skips_non_leap_years_including_century_exceptions() {
        let at = |year, month, day| {
            Utc.with_ymd_and_hms(year, month, day, 18, 0, 0)
                .unwrap()
                .timestamp_millis()
        };
        let rule = ReminderRecurrence::Yearly;
        assert_eq!(
            rule.next_after(at(2024, 2, 29), at(2024, 2, 29), &Utc)
                .unwrap(),
            at(2028, 2, 29)
        );
        assert_eq!(
            rule.next_after(at(2096, 2, 29), at(2096, 2, 29), &Utc)
                .unwrap(),
            at(2104, 2, 29)
        );
        assert_eq!(
            rule.next_after(at(2026, 11, 1), at(2026, 11, 1), &Utc)
                .unwrap(),
            at(2027, 11, 1)
        );
    }

    #[derive(Clone)]
    struct ClockChangeZone;

    impl TimeZone for ClockChangeZone {
        type Offset = FixedOffset;
        fn from_offset(_: &FixedOffset) -> Self {
            Self
        }
        fn offset_from_local_date(&self, date: &chrono::NaiveDate) -> LocalResult<FixedOffset> {
            self.offset_from_local_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
        }
        fn offset_from_utc_date(&self, date: &chrono::NaiveDate) -> FixedOffset {
            self.offset_from_utc_datetime(&date.and_hms_opt(0, 0, 0).unwrap())
        }
        fn offset_from_utc_datetime(&self, value: &chrono::NaiveDateTime) -> FixedOffset {
            let spring = chrono::NaiveDate::from_ymd_opt(2026, 3, 29)
                .unwrap()
                .and_hms_opt(1, 0, 0)
                .unwrap();
            let autumn = chrono::NaiveDate::from_ymd_opt(2026, 10, 25)
                .unwrap()
                .and_hms_opt(1, 0, 0)
                .unwrap();
            FixedOffset::east_opt(if *value >= spring && *value < autumn {
                7200
            } else {
                3600
            })
            .unwrap()
        }
        fn offset_from_local_datetime(
            &self,
            value: &chrono::NaiveDateTime,
        ) -> LocalResult<FixedOffset> {
            let spring = chrono::NaiveDate::from_ymd_opt(2026, 3, 29)
                .unwrap()
                .and_hms_opt(2, 0, 0)
                .unwrap();
            let autumn = chrono::NaiveDate::from_ymd_opt(2026, 10, 25)
                .unwrap()
                .and_hms_opt(2, 0, 0)
                .unwrap();
            let winter = FixedOffset::east_opt(3600).unwrap();
            let summer = FixedOffset::east_opt(7200).unwrap();
            if *value >= spring && *value < spring + Duration::hours(1) {
                LocalResult::None
            } else if *value >= autumn && *value < autumn + Duration::hours(1) {
                LocalResult::Ambiguous(summer, winter)
            } else {
                LocalResult::Single(if *value >= spring && *value < autumn {
                    summer
                } else {
                    winter
                })
            }
        }
    }

    #[test]
    fn calendar_reminder_handles_missing_and_repeated_local_clock_times() {
        let zone = ClockChangeZone;
        let spring_anchor = zone
            .with_ymd_and_hms(2026, 3, 28, 2, 30, 0)
            .unwrap()
            .timestamp_millis();
        let spring_next = ReminderRecurrence::Daily
            .next_after(spring_anchor, spring_anchor, &zone)
            .unwrap();
        assert_eq!(
            spring_next,
            zone.with_ymd_and_hms(2026, 3, 29, 3, 0, 0)
                .unwrap()
                .timestamp_millis()
        );
        assert_eq!(
            ReminderRecurrence::Daily
                .next_after(spring_anchor, spring_next, &zone)
                .unwrap(),
            zone.with_ymd_and_hms(2026, 3, 30, 2, 30, 0)
                .unwrap()
                .timestamp_millis()
        );
        let autumn_anchor = zone
            .with_ymd_and_hms(2026, 10, 24, 2, 30, 0)
            .unwrap()
            .timestamp_millis();
        let autumn_next = ReminderRecurrence::Daily
            .next_after(autumn_anchor, autumn_anchor, &zone)
            .unwrap();
        assert_eq!(
            autumn_next,
            zone.with_ymd_and_hms(2026, 10, 25, 2, 30, 0)
                .earliest()
                .unwrap()
                .timestamp_millis()
        );
        let second_clock_hour = zone
            .with_ymd_and_hms(2026, 10, 25, 2, 15, 0)
            .latest()
            .unwrap()
            .timestamp_millis();
        assert_eq!(
            ReminderRecurrence::Daily
                .next_after(autumn_anchor, second_clock_hour, &zone)
                .unwrap(),
            zone.with_ymd_and_hms(2026, 10, 26, 2, 30, 0)
                .unwrap()
                .timestamp_millis()
        );
    }
}
