import { hueDistance, labToHex } from "./oklab.ts";
import { hueRadius, initialSwatch, meanSwatchColor, minimumChroma, minimumFamilyShare, minimumTotalColourShare, quantizeIcon, sampleIcon, type Swatch } from "./iconPalette.ts";
import { foregroundOnPlate, greySubjectMean, iconSurface, largestComponent, type IconSurface } from "./iconSurface.ts";

interface HueFamily {
  anchor: Swatch;
  weight: number;
  center: number;
  x: number;
  y: number;
  swatches: Swatch[];
}

function nearestFamily(h: number, families: HueFamily[]) {
  return families.reduce((best, g) => hueDistance(h, g.anchor.hue) < hueDistance(h, best.anchor.hue) ? g : best);
}

function selectHue(surface: IconSurface, palette: Swatch[], initial: Swatch) {
  const plate = foregroundOnPlate(surface, palette, initial);
  if (plate)
    return { swatch: plate.swatch, accepts: plate.accepts, foreground: true, body: false };
  const { pixels, visible, rim, rimMass, total, adjacent, size } = surface;
  const families: HueFamily[] = [];
  const colored = palette.filter(p => p.chroma >= minimumChroma);
  for (const p of colored) {
    if (families.every(g => hueDistance(g.anchor.hue, p.hue) > hueRadius))
      families.push({ anchor: p, weight: 0, center: 0, x: 0, y: 0, swatches: [] });
  }
  for (const p of colored)
    nearestFamily(p.hue, families).swatches.push(p);
  for (const i of visible) {
    const p = pixels[i];
    if (!families.length || p.chroma < minimumChroma)
      continue;
    const family = nearestFamily(p.hue, families);
    if (hueDistance(p.hue, family.anchor.hue) > hueRadius)
      continue;
    const x = (i % size + .5) / size, y = (Math.floor(i / size) + .5) / size;
    family.weight += p.weight;
    family.x += x * p.weight;
    family.y += y * p.weight;
    if (Math.abs(x - .5) <= .15 && Math.abs(y - .5) <= .15)
      family.center += p.weight;
  }
  const ranked = families.filter(g => g.weight > 0).sort((a, b) => b.weight - a.weight || a.anchor.hue - b.anchor.hue);
  const maximum = ranked[0]?.weight ?? 0;
  const dark = visible.filter(i => pixels[i].lab[0] <= .48 && pixels[i].chroma < minimumChroma);
  const darkMass = dark.reduce((sum, i) => sum + pixels[i].weight, 0);
  const lightRim = rim.reduce((s, i) => s + (pixels[i].lab[0] >= .9 && pixels[i].chroma <= .035 ? pixels[i].weight : 0), 0);
  const backdrop = palette[0].lab[0] >= .90 && palette[0].chroma < .035 && palette[0].share >= .40 && lightRim >= rimMass * .55;
  if (backdrop && darkMass >= .12 * total && darkMass >= 1.35 * maximum && largestComponent(dark, pixels, adjacent) >= .07 * total) {
    const swatch = palette.find(p => p.lab[0] <= .48 && p.chroma < minimumChroma);
    if (swatch)
      return { swatch, body: true };
  }
  const tied = ranked.filter(g => g.weight >= .05 * total && g.weight >= .8 * maximum);
  if (initial.chroma < minimumChroma || !tied.some(a => tied.some(b => hueDistance(a.anchor.hue, b.anchor.hue) >= 45)))
    return { swatch: initial };
  const centerMass = tied.reduce((s, g) => s + g.center, 0), bestCenter = Math.max(...tied.map(g => g.center));
  const cell = (value: number) => Math.min(2, Math.floor(value * 3));
  const finalists = tied.filter(g => bestCenter - g.center <= .05 * centerMass + 1e-9);
  finalists.sort((a, b) => cell(a.y / a.weight) - cell(b.y / b.weight) || cell(a.x / a.weight) - cell(b.x / b.weight) || a.anchor.hue - b.anchor.hue);
  const winner = finalists[0];
  return { swatch: winner.swatches[0], hue: winner.anchor.hue, accepts: (p: Swatch) => nearestFamily(p.hue, ranked) === winner };
}

export type IconRepresentative = {
  kind: "dark" | "light" | "color";
  color: string;
};
/** Extracts a theme-independent identity from RGBA pixels. Empty icons have no identity colour. */
export function iconRepresentative(bytes: Uint8ClampedArray, size: number): IconRepresentative | null {
  if (size < 1 || bytes.length !== size * size * 4)
    return null;
  const { pixels, points } = sampleIcon(bytes);
  const palette = quantizeIcon(points);
  if (!palette.length)
    return null;
  const surface = iconSurface(pixels, size);
  const choice = selectHue(surface, palette, initialSwatch(palette));
  const colored = palette.filter(p => p.chroma >= minimumChroma);
  if (choice.swatch.chroma >= minimumChroma) {
    const group = colored.filter(p => hueDistance(p.hue, choice.hue ?? choice.swatch.hue) <= hueRadius && (!choice.accepts || choice.accepts(p)));
    const share = group.reduce((s, p) => s + p.share, 0);
    const total = colored.reduce((s, p) => s + p.share, 0);
    if (share > 0 && (share >= minimumFamilyShare || total >= minimumTotalColourShare || choice.foreground))
      return { color: labToHex(meanSwatchColor(group)), kind: "color" };
  }
  const neutral = palette.filter(p => p.chroma < minimumChroma);
  const tones = neutral.length ? neutral : palette;
  const darkShare = tones.reduce((s, p) => s + (p.lab[0] < .55 ? p.share : 0), 0) / tones.reduce((s, p) => s + p.share, 0);
  const dark = Math.abs(darkShare - .5) <= .10 ? tones[0].lab[0] < .55 : darkShare > .5;
  const kind = dark ? "dark" : "light";
  if (!dark) {
    const L = greySubjectMean(surface, tones);
    if (L !== null)
      return { kind, color: labToHex([L, 0, 0]) };
    if (choice.body || choice.foreground)
      return { kind, color: choice.swatch.color };
  }
  const sameSide = tones.filter(p => (p.lab[0] < .55) === dark);
  const shades = sameSide.filter(p => Math.abs(p.lab[0] - sameSide[0].lab[0]) <= .13);
  return { kind, color: labToHex(meanSwatchColor(shades)) };
}
