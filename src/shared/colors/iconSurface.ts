import { parseHex, squaredDistance, toLab, type ColorVector } from "./oklab.ts";
import { familyShare, minimumChroma, minimumFamilyShare, type Pixel, type Swatch } from "./iconPalette.ts";

export function neighbors(i: number, n: number): number[] {
  return [i % n ? i - 1 : -1, i % n < n - 1 ? i + 1 : -1, i >= n ? i - n : -1, i < n * (n - 1) ? i + n : -1].filter(j => j >= 0);
}

export function connected(seeds: number[], adjacent: number[][], accepts: (i: number) => boolean): Set<number> {
  const result = new Set(seeds);
  for (const i of result)
    for (const j of adjacent[i])
      if (!result.has(j) && accepts(j))
        result.add(j);
  return result;
}

export function largestComponent(indices: number[], pixels: Pixel[], adjacent: number[][]): number {
  const pending = new Set(indices);
  let largest = 0;
  for (const seed of pending) {
    const region = connected([seed], adjacent, i => pending.has(i));
    let mass = 0;
    for (const i of region) {
      mass += pixels[i].weight;
      pending.delete(i);
    }
    largest = Math.max(largest, mass);
  }
  return largest;
}

export interface IconSurface {
  pixels: Pixel[];
  adjacent: number[][];
  visible: number[];
  rim: number[];
  total: number;
  rimMass: number;
  size: number;
}

export function iconSurface(pixels: Pixel[], size: number): IconSurface {
  const adjacent = pixels.map((_, i) => neighbors(i, size));
  const visible = pixels.flatMap((p, i) => p.weight ? [i] : []);
  const rim = visible.filter(i => adjacent[i].length < 4 || adjacent[i].some(j => !pixels[j].weight));
  return { pixels, adjacent, visible, rim, size, total: visible.reduce((s, i) => s + pixels[i].weight, 0),
    rimMass: rim.reduce((s, i) => s + pixels[i].weight, 0) };
}

export interface Foreground {
  swatch: Swatch;
  accepts: (s: Swatch) => boolean;
}

export function foregroundOnPlate(surface: IconSurface, palette: Swatch[], initial: Swatch): Foreground | null {
  const plate = palette.find(p => p.share >= .40 && ((p.lab[0] >= .90 && p.chroma <= .035) || p.lab[0] <= .35));
  if (!plate)
    return null;
  const bg = toLab(parseHex(plate.color));
  const near = (lab: ColorVector) => squaredDistance(lab, bg) <= .12 ** 2;
  if (!near(toLab(parseHex(initial.color))))
    return null;
  const { pixels, rim, rimMass, adjacent, visible, total } = surface;
  const seeds = rim.filter(i => near(pixels[i].lab));
  if (seeds.reduce((s, i) => s + pixels[i].weight, 0) < .55 * rimMass)
    return null;
  const backing = connected(seeds, adjacent, i => pixels[i].weight > 0 && near(pixels[i].lab));
  if ([...backing].reduce((s, i) => s + pixels[i].weight, 0) < .35 * total)
    return null;
  const light = plate.lab[0] >= .90;
  const separated = (lab: ColorVector, L: number) => squaredDistance(lab, bg) >= .25 ** 2 && (light ? L <= bg[0] - .20 : L >= bg[0] + .20);
  const mass = visible.reduce((s, i) => {
    const p = pixels[i];
    return s + (!backing.has(i) && separated(p.lab, p.lab[0]) && (light || p.chroma >= minimumChroma) ? p.weight : 0);
  }, 0);
  if (mass < .05 * total)
    return null;
  const accepts = (p: Swatch) => separated(toLab(parseHex(p.color)), p.lab[0]);
  const foreground = palette.filter(accepts);
  const colored = foreground.filter(p => p.chroma >= minimumChroma);
  const best = colored.map(p => ({ p, share: familyShare(colored, p.hue) })).filter(x => x.share >= minimumFamilyShare)
    .sort((a, b) => b.share - a.share || b.p.share - a.p.share || a.p.color.localeCompare(b.p.color))[0]?.p;
  const greys = foreground.filter(p => p.chroma < minimumChroma);
  const dark = light ? greys.filter(p => greys.reduce((s, q) => s + (Math.abs(q.lab[0] - p.lab[0]) <= .18 ? q.share : 0), 0) >= .05)
    .sort((a, b) => a.lab[0] - b.lab[0] || b.share - a.share)[0] : undefined;
  const swatch = best ?? dark;
  return swatch ? { swatch, accepts: p => separated(p.lab, p.lab[0]) } : null;
}

export function greySubjectMean(surface: IconSurface, tones: Swatch[]): number | null {
  const { pixels, visible, total, adjacent, rim, rimMass } = surface;
  if (visible.reduce((s, i) => s + (pixels[i].neutral ? pixels[i].weight : 0), 0) < .95 * total)
    return null;
  const rimSet = new Set(rim);
  const plates: {
    region: Set<number>;
    area: number;
    L: number;
    score: number;
  }[] = [];
  for (const tone of tones.filter(p => p.chroma < minimumChroma)) {
    const inBand = (i: number) => pixels[i].weight > 0 && pixels[i].neutral && Math.abs(pixels[i].lab[0] - tone.lab[0]) <= .13;
    const seen = new Set<number>();
    for (const seed of visible) {
      if (seen.has(seed) || !inBand(seed))
        continue;
      const region = connected([seed], adjacent, inBand);
      let mass = 0, weightedL = 0, edgeMass = 0;
      for (const i of region) {
        seen.add(i);
        const p = pixels[i];
        mass += p.weight;
        weightedL += p.weight * p.lab[0];
        if (rimSet.has(i))
          edgeMass += p.weight;
      }
      const area = mass / total, L = weightedL / mass;
      if (area < .35 || L < .55)
        continue;
      const spread = Math.sqrt([...region].reduce((s, i) => s + pixels[i].weight * (pixels[i].lab[0] - L) ** 2, 0) / mass);
      if (spread <= .075)
        plates.push({ region, area, L, score: area * (1 - spread) + .04 * edgeMass / rimMass });
    }
  }
  plates.sort((a, b) => b.score - a.score);
  const plate = plates[0];
  if (!plate || plates.some(p => Math.abs(p.L - plate.L) >= .23 && p.area * 1.25 >= plate.area))
    return null;
  const island = connected([plate.region.values().next().value!], adjacent, i => pixels[i].weight > 0);
  const subject = [...island].filter(i => !plate.region.has(i) && pixels[i].neutral && Math.abs(pixels[i].lab[0] - plate.L) >= .23);
  const mass = subject.reduce((s, i) => s + pixels[i].weight, 0);
  if (mass < .05 * total || plate.area < 1.25 * mass / total || largestComponent(subject, pixels, adjacent) < .025 * total)
    return null;
  return subject.reduce((s, i) => s + pixels[i].lab[0] * pixels[i].weight, 0) / mass;
}
