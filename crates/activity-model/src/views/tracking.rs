#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub enum CurrentActivity {
    Waiting,
    Unavailable,
    Paused,
    Inactive,
    Anonymous,
    Application(String),
}
