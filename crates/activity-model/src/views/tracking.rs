#[derive(serde::Serialize, serde::Deserialize, Clone)]
pub enum Activity {
    Waiting,
    Unavailable,
    Paused,
    Inactive,
    Anonymous,
    Application(String),
}
