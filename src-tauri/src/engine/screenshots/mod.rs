pub mod ports;

#[cfg(test)]
mod tests {
    use super::ports::ScreenshotDataError;

    #[test]
    fn screenshot_data_error_roundtrips_through_display() {
        let error = ScreenshotDataError::new("capture failed for window 5");
        assert_eq!(error.to_string(), "capture failed for window 5");
    }
}
