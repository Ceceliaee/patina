#[derive(serde::Serialize, serde::Deserialize)]
pub struct Span {
    pub left: f32,
    pub width: f32,
    pub color: u32,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Leader {
    pub name: String,
    pub duration_ms: i64,
    pub color: u32,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct Recent {
    pub spans: Vec<Span>,
    pub leaders: Vec<Leader>,
    pub hour_labels: (String, String),
    pub day_range: String,
    pub day_total_ms: i64,
}
