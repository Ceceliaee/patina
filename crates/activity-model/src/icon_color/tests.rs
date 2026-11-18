use super::*;
use serde::Deserialize;

#[derive(Deserialize)]
struct Fixture {
    name: String,
    bg: [u8; 4],
    rects: Vec<(usize, usize, usize, usize, [u8; 4])>,
    expected: Option<String>,
}

#[test]
fn matches_frontend_representative_colors() {
    // Reference outputs from src/shared/colors/iconRepresentative.ts on the same RGBA samples.
    let fixtures: Vec<Fixture> = serde_json::from_str(include_str!("fixtures.json")).unwrap();
    for fixture in fixtures {
        let mut bytes = fixture.bg.repeat(48 * 48);
        for (x, y, w, h, color) in fixture.rects {
            for row in y..y + h {
                for col in x..x + w {
                    bytes[(row * 48 + col) * 4..(row * 48 + col + 1) * 4].copy_from_slice(&color);
                }
            }
        }
        let actual = from_rgba(&bytes, 48).map(|c| format!("#{c:06X}"));
        assert_eq!(actual, fixture.expected, "{}", fixture.name);
    }
}

#[test]
fn invalid_dimensions_have_no_color() {
    assert_eq!(from_rgba(&[], 0), None);
    assert_eq!(from_rgba(&[255; 4], 2), None);
    assert_eq!(from_rgba(&[255; 4], usize::MAX), None);
}
