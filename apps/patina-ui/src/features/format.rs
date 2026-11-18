pub(crate) fn duration(ms: i64) -> String {
    let minutes = ms / 60_000;
    if minutes >= 60 {
        format!("{}h {}m", minutes / 60, minutes % 60)
    } else {
        format!("{minutes}m")
    }
}
