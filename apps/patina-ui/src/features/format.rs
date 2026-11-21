pub(crate) fn duration(ms: i64) -> String {
    if ms < 60_000 {
        return format!("{}s", ms.max(0) / 1000);
    }
    let minutes = ms / 60_000;
    if minutes >= 60 {
        format!("{}h {}m", minutes / 60, minutes % 60)
    } else {
        format!("{minutes}m")
    }
}

#[test]
fn short_durations_use_whole_seconds() {
    for (ms, expected) in [
        (0, "0s"),
        (999, "0s"),
        (1_000, "1s"),
        (42_700, "42s"),
        (59_999, "59s"),
        (60_000, "1m"),
        (3_600_000, "1h 0m"),
    ] {
        assert_eq!(duration(ms), expected);
    }
}
