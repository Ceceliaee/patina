use super::palette::*;

pub(super) struct Surface {
    pub pixels: Vec<Pixel>,
    adjacent: Vec<Vec<usize>>,
    pub visible: Vec<usize>,
    pub rim: Vec<usize>,
    pub total: f64,
    pub rim_mass: f64,
    pub size: usize,
}
impl Surface {
    pub fn new(pixels: Vec<Pixel>, size: usize) -> Self {
        let adjacent: Vec<Vec<usize>> = (0..pixels.len())
            .map(|i| {
                let mut near = Vec::with_capacity(4);
                if i % size > 0 {
                    near.push(i - 1);
                }
                if i % size < size - 1 {
                    near.push(i + 1);
                }
                if i >= size {
                    near.push(i - size);
                }
                if i < size * (size - 1) {
                    near.push(i + size);
                }
                near
            })
            .collect();
        let visible: Vec<_> = pixels
            .iter()
            .enumerate()
            .filter(|(_, p)| p.weight > 0.0)
            .map(|(i, _)| i)
            .collect();
        let rim: Vec<_> = visible
            .iter()
            .copied()
            .filter(|i| {
                adjacent[*i].len() < 4 || adjacent[*i].iter().any(|j| pixels[*j].weight == 0.0)
            })
            .collect();
        let total = visible.iter().map(|i| pixels[*i].weight).sum();
        let rim_mass = rim.iter().map(|i| pixels[*i].weight).sum();
        Self {
            pixels,
            adjacent,
            visible,
            rim,
            total,
            rim_mass,
            size,
        }
    }
    fn connected(&self, seeds: &[usize], accepts: impl Fn(usize) -> bool) -> Vec<usize> {
        let mut seen = vec![false; self.pixels.len()];
        let mut region = Vec::new();
        for &i in seeds {
            if !seen[i] {
                seen[i] = true;
                region.push(i);
            }
        }
        let mut cursor = 0;
        while cursor < region.len() {
            for &j in &self.adjacent[region[cursor]] {
                if !seen[j] && accepts(j) {
                    seen[j] = true;
                    region.push(j);
                }
            }
            cursor += 1;
        }
        region
    }
    pub fn largest(&self, indices: &[usize]) -> f64 {
        let mut pending = vec![false; self.pixels.len()];
        for &i in indices {
            pending[i] = true;
        }
        let mut largest: f64 = 0.0;
        for &seed in indices {
            if !pending[seed] {
                continue;
            }
            let region = self.connected(&[seed], |i| pending[i]);
            let mass = region
                .iter()
                .map(|&i| {
                    pending[i] = false;
                    self.pixels[i].weight
                })
                .sum();
            largest = largest.max(mass);
        }
        largest
    }
    fn mass(&self, indices: &[usize]) -> f64 {
        indices.iter().map(|i| self.pixels[*i].weight).sum()
    }
    pub fn foreground(&self, palette: &[Swatch], initial: usize) -> Option<Foreground> {
        let plate = palette.iter().find(|p| {
            p.share >= 0.40 && ((p.lab[0] >= 0.90 && p.chroma <= 0.035) || p.lab[0] <= 0.35)
        })?;
        let bg = to_lab(plate.color);
        let near = |lab| distance(lab, bg) <= 0.12_f64.powi(2);
        if !near(to_lab(palette[initial].color)) {
            return None;
        }
        let seeds: Vec<_> = self
            .rim
            .iter()
            .copied()
            .filter(|i| near(self.pixels[*i].lab))
            .collect();
        if self.mass(&seeds) < 0.55 * self.rim_mass {
            return None;
        }
        let backing = self.connected(&seeds, |i| {
            self.pixels[i].weight > 0.0 && near(self.pixels[i].lab)
        });
        if self.mass(&backing) < 0.35 * self.total {
            return None;
        }
        let mut backdrop = vec![false; self.pixels.len()];
        for i in backing {
            backdrop[i] = true;
        }
        let light = plate.lab[0] >= 0.90;
        let mut result = Foreground {
            index: 0,
            bg,
            light,
        };
        let mass: f64 = self
            .visible
            .iter()
            .filter(|&&i| {
                let p = &self.pixels[i];
                !backdrop[i] && result.separated(p.lab, p.lab[0]) && (light || p.chroma >= CHROMA)
            })
            .map(|i| self.pixels[*i].weight)
            .sum();
        if mass < 0.05 * self.total {
            return None;
        }
        let foreground: Vec<_> = palette
            .iter()
            .enumerate()
            .filter(|(_, p)| result.separated(to_lab(p.color), p.lab[0]))
            .collect();
        let colored: Vec<_> = foreground
            .iter()
            .filter(|(_, p)| p.chroma >= CHROMA)
            .map(|(_, p)| *p)
            .collect();
        let mut candidates: Vec<_> = foreground
            .iter()
            .filter(|(_, p)| p.chroma >= CHROMA)
            .map(|(i, p)| (*i, family_share(&colored, p.hue)))
            .filter(|(_, share)| *share >= FAMILY_SHARE)
            .collect();
        candidates.sort_by(|(a, sa), (b, sb)| {
            sb.total_cmp(sa)
                .then(palette[*b].share.total_cmp(&palette[*a].share))
                .then(palette[*a].color.cmp(&palette[*b].color))
        });
        let grey: Vec<_> = foreground
            .iter()
            .filter(|(_, p)| p.chroma < CHROMA)
            .collect();
        let mut dark: Vec<_> = grey
            .iter()
            .filter(|(_, p)| {
                light
                    && grey
                        .iter()
                        .filter(|(_, q)| (q.lab[0] - p.lab[0]).abs() <= 0.18)
                        .map(|(_, q)| q.share)
                        .sum::<f64>()
                        >= 0.05
            })
            .map(|(i, _)| *i)
            .collect();
        dark.sort_by(|a, b| {
            palette[*a].lab[0]
                .total_cmp(&palette[*b].lab[0])
                .then(palette[*b].share.total_cmp(&palette[*a].share))
        });
        result.index = candidates
            .first()
            .map(|v| v.0)
            .or_else(|| dark.first().copied())?;
        Some(result)
    }
    pub fn grey_subject_mean(&self, tones: &[&Swatch]) -> Option<f64> {
        if self
            .visible
            .iter()
            .filter(|i| self.pixels[**i].neutral)
            .map(|i| self.pixels[*i].weight)
            .sum::<f64>()
            < 0.95 * self.total
        {
            return None;
        }
        let mut rim = vec![false; self.pixels.len()];
        for &i in &self.rim {
            rim[i] = true;
        }
        struct Plate {
            region: Vec<usize>,
            area: f64,
            light: f64,
            score: f64,
        }
        let mut plates = Vec::new();
        for tone in tones.iter().filter(|p| p.chroma < CHROMA) {
            let band = |i: usize| {
                let p = &self.pixels[i];
                p.weight > 0.0 && p.neutral && (p.lab[0] - tone.lab[0]).abs() <= 0.13
            };
            let mut seen = vec![false; self.pixels.len()];
            for &seed in &self.visible {
                if seen[seed] || !band(seed) {
                    continue;
                }
                let region = self.connected(&[seed], band);
                let (mut mass, mut weighted, mut edge) = (0.0, 0.0, 0.0);
                for &i in &region {
                    seen[i] = true;
                    let p = &self.pixels[i];
                    mass += p.weight;
                    weighted += p.weight * p.lab[0];
                    if rim[i] {
                        edge += p.weight;
                    }
                }
                let area = mass / self.total;
                let light = weighted / mass;
                if area < 0.35 || light < 0.55 {
                    continue;
                }
                let spread = (region
                    .iter()
                    .map(|i| self.pixels[*i].weight * (self.pixels[*i].lab[0] - light).powi(2))
                    .sum::<f64>()
                    / mass)
                    .sqrt();
                if spread <= 0.075 {
                    plates.push(Plate {
                        region,
                        area,
                        light,
                        score: area * (1.0 - spread) + 0.04 * edge / self.rim_mass,
                    });
                }
            }
        }
        plates.sort_by(|a, b| b.score.total_cmp(&a.score));
        let plate = plates.first()?;
        if plates
            .iter()
            .any(|p| (p.light - plate.light).abs() >= 0.23 && p.area * 1.25 >= plate.area)
        {
            return None;
        }
        let mut backing = vec![false; self.pixels.len()];
        for &i in &plate.region {
            backing[i] = true;
        }
        let island = self.connected(&[plate.region[0]], |i| self.pixels[i].weight > 0.0);
        let subject: Vec<_> = island
            .into_iter()
            .filter(|i| {
                !backing[*i]
                    && self.pixels[*i].neutral
                    && (self.pixels[*i].lab[0] - plate.light).abs() >= 0.23
            })
            .collect();
        let mass = self.mass(&subject);
        if mass < 0.05 * self.total
            || plate.area < 1.25 * mass / self.total
            || self.largest(&subject) < 0.025 * self.total
        {
            return None;
        }
        Some(
            subject
                .iter()
                .map(|i| self.pixels[*i].lab[0] * self.pixels[*i].weight)
                .sum::<f64>()
                / mass,
        )
    }
}
pub(super) struct Foreground {
    pub index: usize,
    bg: Lab,
    light: bool,
}
impl Foreground {
    fn separated(&self, lab: Lab, light: f64) -> bool {
        distance(lab, self.bg) >= 0.25_f64.powi(2)
            && if self.light {
                light <= self.bg[0] - 0.20
            } else {
                light >= self.bg[0] + 0.20
            }
    }
    pub fn accepts(&self, p: &Swatch) -> bool {
        self.separated(p.lab, p.lab[0])
    }
}
