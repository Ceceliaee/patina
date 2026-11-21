use std::collections::BTreeMap;

pub(super) type Lab = [f64; 3];
pub(super) const CHROMA: f64 = 0.045;
pub(super) const HUE_RADIUS: f64 = 10.0;
pub(super) const FAMILY_SHARE: f64 = 0.10;
pub(super) const COLOUR_SHARE: f64 = 0.25;

#[derive(Clone)]
pub(super) struct Pixel {
    pub lab: Lab,
    pub weight: f64,
    pub chroma: f64,
    pub hue: f64,
    pub neutral: bool,
}
#[derive(Clone)]
pub(super) struct Swatch {
    pub color: u32,
    pub lab: Lab,
    pub share: f64,
    pub chroma: f64,
    pub hue: f64,
}
struct Point {
    color: u32,
    lab: Lab,
    weight: f64,
    key: String,
}
pub(super) fn to_lab(color: u32) -> Lab {
    let [r, g, b] = [16, 8, 0].map(|shift| {
        let v = f64::from((color >> shift) & 255) / 255.0;
        if v <= 0.04045 {
            v / 12.92
        } else {
            ((v + 0.055) / 1.055).powf(2.4)
        }
    });
    let l = (0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b).cbrt();
    let m = (0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b).cbrt();
    let s = (0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b).cbrt();
    [
        0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ]
}
pub(super) fn to_rgb([light, a, b]: Lab) -> u32 {
    let l = (light + 0.3963377774 * a + 0.2158037573 * b).powi(3);
    let m = (light - 0.1055613458 * a - 0.0638541728 * b).powi(3);
    let s = (light - 0.0894841775 * a - 1.291485548 * b).powi(3);
    let channels = [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ];
    channels.into_iter().fold(0, |color, v| {
        let v = v.clamp(0.0, 1.0);
        let v = if v <= 0.0031308 {
            12.92 * v
        } else {
            1.055 * v.powf(1.0 / 2.4) - 0.055
        };
        (color << 8) | (255.0 * v).round() as u32
    })
}
pub(super) fn distance(a: Lab, b: Lab) -> f64 {
    let x = a[0] - b[0];
    let y = a[1] - b[1];
    let z = a[2] - b[2];
    x * x + y * y + z * z
}
fn hue(lab: Lab) -> f64 {
    (lab[2].atan2(lab[1]).to_degrees() + 360.0) % 360.0
}
pub(super) fn hue_distance(a: f64, b: f64) -> f64 {
    let d = (a - b).abs();
    d.min(360.0 - d)
}
pub(super) fn family_share(palette: &[&Swatch], hue: f64) -> f64 {
    palette
        .iter()
        .filter(|s| hue_distance(s.hue, hue) <= HUE_RADIUS)
        .map(|s| s.share)
        .sum()
}
pub(super) fn mean(palette: &[&Swatch]) -> Lab {
    let total: f64 = palette.iter().map(|s| s.share).sum();
    std::array::from_fn(|axis| palette.iter().map(|s| s.lab[axis] * s.share).sum::<f64>() / total)
}
pub(super) fn initial(palette: &[Swatch]) -> usize {
    let colored: Vec<_> = palette.iter().filter(|s| s.chroma >= CHROMA).collect();
    let total: f64 = colored.iter().map(|s| s.share).sum();
    let mut candidates: Vec<_> = palette
        .iter()
        .enumerate()
        .filter(|(_, s)| s.chroma >= CHROMA)
        .filter_map(|(i, s)| {
            let support = family_share(&colored, s.hue);
            (support >= FAMILY_SHARE || total >= COLOUR_SHARE)
                .then_some((i, 0.7 * support + 0.3 * (s.chroma / 0.20).min(1.0)))
        })
        .collect();
    candidates.sort_by(|(a, sa), (b, sb)| {
        sb.total_cmp(sa)
            .then(palette[*b].share.total_cmp(&palette[*a].share))
            .then(palette[*a].color.cmp(&palette[*b].color))
    });
    candidates.first().map_or(0, |v| v.0)
}

pub(super) fn sample(bytes: &[u8]) -> (Vec<Pixel>, Vec<Swatch>) {
    let mut distinct = BTreeMap::<u32, Point>::new();
    let mut pixels = Vec::with_capacity(bytes.len() / 4);
    for &[r, g, b, a] in bytes.as_chunks::<4>().0 {
        let color = (u32::from(r) << 16) | (u32::from(g) << 8) | u32::from(b);
        let weight = if a >= 48 { f64::from(a) / 255.0 } else { 0.0 };
        let lab = distinct
            .get(&color)
            .map_or_else(|| to_lab(color), |p| p.lab);
        if weight > 0.0 {
            distinct
                .entry(color)
                .or_insert_with(|| Point {
                    color,
                    lab,
                    weight: 0.0,
                    key: format!("{r},{g},{b}"),
                })
                .weight += weight;
        }
        pixels.push(Pixel {
            lab,
            weight,
            chroma: lab[1].hypot(lab[2]),
            hue: hue(lab),
            neutral: r.max(g).max(b) - r.min(g).min(b) <= 15,
        });
    }
    let mut points: Vec<_> = distinct.into_values().collect();
    points.sort_by(|a, b| b.weight.total_cmp(&a.weight).then(a.key.cmp(&b.key)));
    let palette = quantize(&points);
    (pixels, palette)
}
fn quantize(points: &[Point]) -> Vec<Swatch> {
    if points.is_empty() {
        return vec![];
    }
    let mut centers = vec![points[0].lab];
    let mut nearest = vec![f64::INFINITY; points.len()];
    while centers.len() < 12.min(points.len()) {
        let mut best = (0.0, 0);
        let last = *centers.last().unwrap();
        for (i, p) in points.iter().enumerate() {
            nearest[i] = nearest[i].min(distance(p.lab, last));
            let score = nearest[i] * p.weight.sqrt();
            if score > best.0 {
                best = (score, i);
            }
        }
        if best.0 < 1e-12 {
            break;
        }
        centers.push(points[best.1].lab);
    }
    let mut groups: Vec<Vec<&Point>> = vec![Vec::new(); centers.len()];
    let mut assigned = vec![0; points.len()];
    for _ in 0..30 {
        let mut separation = [[0.; 12]; 12];
        let mut closest_neighbor = [f64::INFINITY; 12];
        for (i, center) in centers.iter().enumerate() {
            groups[i].clear();
            for (j, &other) in centers[..i].iter().enumerate() {
                let d = distance(*center, other);
                separation[i][j] = d;
                separation[j][i] = d;
                closest_neighbor[i] = closest_neighbor[i].min(d);
                closest_neighbor[j] = closest_neighbor[j].min(d);
            }
        }
        for (p, cluster) in points.iter().zip(&mut assigned) {
            let previous = *cluster;
            let mut best = distance(p.lab, centers[previous]);
            // A center farther than twice the point's current distance cannot win.
            // Include a margin and retain the lowest index on exact ties.
            let bound = 4. * best + 1e-14;
            if closest_neighbor[previous] <= bound {
                for (i, &center) in centers.iter().enumerate() {
                    if i == previous || separation[previous][i] > bound {
                        continue;
                    }
                    let d = distance(p.lab, center);
                    if d < best || (d == best && i < *cluster) {
                        best = d;
                        *cluster = i;
                    }
                }
            }
            groups[*cluster].push(p);
        }
        let mut movement = 0.0;
        for (i, group) in groups.iter().enumerate() {
            if group.is_empty() {
                continue;
            }
            let mass: f64 = group.iter().map(|p| p.weight).sum();
            let next = std::array::from_fn(|axis| {
                group.iter().map(|p| p.lab[axis] * p.weight).sum::<f64>() / mass
            });
            movement += distance(centers[i], next);
            centers[i] = next;
        }
        if movement < 1e-10 {
            break;
        }
    }
    let total: f64 = points.iter().map(|p| p.weight).sum();
    let mut palette: Vec<_> = groups
        .iter()
        .enumerate()
        .filter(|(_, g)| !g.is_empty())
        .map(|(i, g)| {
            let lab = centers[i];
            let nearest = g
                .iter()
                .min_by(|a, b| distance(a.lab, lab).total_cmp(&distance(b.lab, lab)))
                .unwrap();
            Swatch {
                color: nearest.color,
                lab,
                share: g.iter().map(|p| p.weight).sum::<f64>() / total,
                hue: hue(lab),
                chroma: lab[1].hypot(lab[2]),
            }
        })
        .collect();
    palette.sort_by(|a, b| b.share.total_cmp(&a.share).then(a.color.cmp(&b.color)));
    palette
}
