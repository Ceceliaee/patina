//! Theme-independent icon identity, matching the frontend iconRepresentative rules.
mod palette;
mod surface;
use palette::*;
use surface::Surface;

struct Family {
    anchor: usize,
    weight: f64,
    center: f64,
    x: f64,
    y: f64,
    swatches: Vec<usize>,
}
fn nearest(hue: f64, families: &[Family], palette: &[Swatch]) -> usize {
    families
        .iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            hue_distance(hue, palette[a.anchor].hue)
                .total_cmp(&hue_distance(hue, palette[b.anchor].hue))
        })
        .unwrap()
        .0
}
struct Choice {
    index: usize,
    hue: Option<f64>,
    accepts: Vec<bool>,
    foreground: bool,
    body: bool,
}
fn select(surface: &Surface, palette: &[Swatch], initial: usize) -> Choice {
    let mut choice = Choice {
        index: initial,
        hue: None,
        accepts: vec![true; palette.len()],
        foreground: false,
        body: false,
    };
    if let Some(plate) = surface.foreground(palette, initial) {
        choice.index = plate.index;
        choice.foreground = true;
        choice.accepts = palette.iter().map(|p| plate.accepts(p)).collect();
        return choice;
    }
    let mut families: Vec<Family> = Vec::new();
    for (i, p) in palette
        .iter()
        .enumerate()
        .filter(|(_, p)| p.chroma >= CHROMA)
    {
        if families
            .iter()
            .all(|f| hue_distance(p.hue, palette[f.anchor].hue) > HUE_RADIUS)
        {
            families.push(Family {
                anchor: i,
                weight: 0.0,
                center: 0.0,
                x: 0.0,
                y: 0.0,
                swatches: vec![],
            });
        }
    }
    for (i, p) in palette
        .iter()
        .enumerate()
        .filter(|(_, p)| p.chroma >= CHROMA)
    {
        let family = nearest(p.hue, &families, palette);
        families[family].swatches.push(i);
    }
    for &i in &surface.visible {
        let p = &surface.pixels[i];
        if families.is_empty() || p.chroma < CHROMA {
            continue;
        }
        let f = nearest(p.hue, &families, palette);
        let family = &mut families[f];
        if hue_distance(p.hue, palette[family.anchor].hue) > HUE_RADIUS {
            continue;
        }
        let x = (i % surface.size) as f64 + 0.5;
        let x = x / surface.size as f64;
        let y = (i / surface.size) as f64 + 0.5;
        let y = y / surface.size as f64;
        family.weight += p.weight;
        family.x += x * p.weight;
        family.y += y * p.weight;
        if (x - 0.5).abs() <= 0.15 && (y - 0.5).abs() <= 0.15 {
            family.center += p.weight;
        }
    }
    families.retain(|f| f.weight > 0.0);
    families.sort_by(|a, b| {
        b.weight
            .total_cmp(&a.weight)
            .then(palette[a.anchor].hue.total_cmp(&palette[b.anchor].hue))
    });
    let maximum = families.first().map_or(0.0, |f| f.weight);
    let dark: Vec<_> = surface
        .visible
        .iter()
        .copied()
        .filter(|i| surface.pixels[*i].lab[0] <= 0.48 && surface.pixels[*i].chroma < CHROMA)
        .collect();
    let dark_mass: f64 = dark.iter().map(|i| surface.pixels[*i].weight).sum();
    let light_rim: f64 = surface
        .rim
        .iter()
        .filter(|i| surface.pixels[**i].lab[0] >= 0.9 && surface.pixels[**i].chroma <= 0.035)
        .map(|i| surface.pixels[*i].weight)
        .sum();
    let backdrop = palette[0].lab[0] >= 0.90
        && palette[0].chroma < 0.035
        && palette[0].share >= 0.40
        && light_rim >= surface.rim_mass * 0.55;
    if backdrop
        && dark_mass >= 0.12 * surface.total
        && dark_mass >= 1.35 * maximum
        && surface.largest(&dark) >= 0.07 * surface.total
    {
        if let Some(index) = palette
            .iter()
            .position(|p| p.lab[0] <= 0.48 && p.chroma < CHROMA)
        {
            choice.index = index;
            choice.body = true;
            return choice;
        }
    }
    let tied: Vec<_> = families
        .iter()
        .enumerate()
        .filter(|(_, f)| f.weight >= 0.05 * surface.total && f.weight >= 0.8 * maximum)
        .map(|(i, _)| i)
        .collect();
    if palette[initial].chroma < CHROMA
        || !tied.iter().any(|a| {
            tied.iter().any(|b| {
                hue_distance(
                    palette[families[*a].anchor].hue,
                    palette[families[*b].anchor].hue,
                ) >= 45.0
            })
        })
    {
        return choice;
    }
    let center_mass: f64 = tied.iter().map(|i| families[*i].center).sum();
    let best_center = tied
        .iter()
        .map(|i| families[*i].center)
        .fold(0.0_f64, f64::max);
    let mut finalists: Vec<_> = tied
        .into_iter()
        .filter(|i| best_center - families[*i].center <= 0.05 * center_mass + 1e-9)
        .collect();
    let cell = |v: f64| (v * 3.0).floor().min(2.0) as u8;
    finalists.sort_by(|a, b| {
        let a = &families[*a];
        let b = &families[*b];
        cell(a.y / a.weight)
            .cmp(&cell(b.y / b.weight))
            .then(cell(a.x / a.weight).cmp(&cell(b.x / b.weight)))
            .then(palette[a.anchor].hue.total_cmp(&palette[b.anchor].hue))
    });
    let winner = finalists[0];
    choice.index = families[winner].swatches[0];
    choice.hue = Some(palette[families[winner].anchor].hue);
    choice.accepts = palette
        .iter()
        .map(|p| nearest(p.hue, &families, palette) == winner)
        .collect();
    choice
}

pub fn from_rgba(bytes: &[u8], size: usize) -> Option<u32> {
    if size == 0 || size.checked_mul(size)?.checked_mul(4)? != bytes.len() {
        return None;
    }
    let (pixels, palette) = sample(bytes);
    if palette.is_empty() {
        return None;
    }
    let surface = Surface::new(pixels, size);
    let choice = select(&surface, &palette, initial(&palette));
    let swatch = &palette[choice.index];
    let colored: Vec<_> = palette.iter().filter(|p| p.chroma >= CHROMA).collect();
    if swatch.chroma >= CHROMA {
        let group: Vec<_> = palette
            .iter()
            .enumerate()
            .filter(|(i, p)| {
                p.chroma >= CHROMA
                    && hue_distance(p.hue, choice.hue.unwrap_or(swatch.hue)) <= HUE_RADIUS
                    && choice.accepts[*i]
            })
            .map(|(_, p)| p)
            .collect();
        let share: f64 = group.iter().map(|p| p.share).sum();
        let total: f64 = colored.iter().map(|p| p.share).sum();
        if share > 0.0 && (share >= FAMILY_SHARE || total >= COLOUR_SHARE || choice.foreground) {
            return Some(to_rgb(mean(&group)));
        }
    }
    let neutral: Vec<_> = palette.iter().filter(|p| p.chroma < CHROMA).collect();
    let tones: Vec<_> = if neutral.is_empty() {
        palette.iter().collect()
    } else {
        neutral
    };
    let dark_share = tones
        .iter()
        .filter(|p| p.lab[0] < 0.55)
        .map(|p| p.share)
        .sum::<f64>()
        / tones.iter().map(|p| p.share).sum::<f64>();
    let dark = if (dark_share - 0.5).abs() <= 0.10 {
        tones[0].lab[0] < 0.55
    } else {
        dark_share > 0.5
    };
    if !dark {
        if let Some(light) = surface.grey_subject_mean(&tones) {
            return Some(to_rgb([light, 0.0, 0.0]));
        }
        if choice.body || choice.foreground {
            return Some(swatch.color);
        }
    }
    let same: Vec<_> = tones
        .into_iter()
        .filter(|p| (p.lab[0] < 0.55) == dark)
        .collect();
    let shades: Vec<_> = same
        .iter()
        .copied()
        .filter(|p| (p.lab[0] - same[0].lab[0]).abs() <= 0.13)
        .collect();
    Some(to_rgb(mean(&shades)))
}

#[cfg(test)]
mod tests;
