import { hueAngle, hueDistance, squaredDistance, toHex, toLab, type ColorVector } from "./oklab.ts";

export const hueRadius = 10;

export const minimumChroma = .045;

export const minimumFamilyShare = .10;

export const minimumTotalColourShare = .25;

export interface Swatch {
  color: string;
  lab: ColorVector;
  share: number;
  chroma: number;
  hue: number;
}

interface Point {
  rgb: ColorVector;
  lab: ColorVector;
  weight: number;
  key: string;
}

export interface Pixel {
  lab: ColorVector;
  weight: number;
  chroma: number;
  hue: number;
  neutral: boolean;
}

export function sampleIcon(bytes: Uint8ClampedArray) {
  const distinct = new Map<number, Point>();
  const pixels: Pixel[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    const r = bytes[i], g = bytes[i + 1], b = bytes[i + 2];
    const weight = bytes[i + 3] >= 48 ? bytes[i + 3] / 255 : 0;
    const key = (r << 16) + (g << 8) + b;
    let point = distinct.get(key);
    if (!point) {
      const rgb: ColorVector = [r, g, b];
      point = { rgb, lab: toLab(rgb), weight: 0, key: rgb.join(",") };
      if (weight)
        distinct.set(key, point);
    }
    point.weight += weight;
    pixels.push({ lab: point.lab, weight, chroma: Math.hypot(point.lab[1], point.lab[2]),
      hue: hueAngle(point.lab), neutral: Math.max(r, g, b) - Math.min(r, g, b) <= 15 });
  }
  const points = [...distinct.values()].sort((a, b) => b.weight - a.weight || a.key.localeCompare(b.key));
  return { pixels, points };
}

function seedCenters(points: Point[]): ColorVector[] {
  const centers = [points[0].lab];
  const nearest = points.map(() => Infinity);
  while (centers.length < Math.min(12, points.length)) {
    let bestScore = 0, bestIndex = 0;
    const last = centers[centers.length - 1];
    points.forEach((point, index) => {
      nearest[index] = Math.min(nearest[index], squaredDistance(point.lab, last));
      const score = nearest[index] * Math.sqrt(point.weight);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });
    if (bestScore < 1e-12)
      break;
    centers.push(points[bestIndex].lab);
  }
  return centers;
}

function centroid(points: Point[], mass: number): ColorVector {
  return [0, 1, 2].map(axis => points.reduce((sum, p) => sum + p.lab[axis] * p.weight, 0) / mass) as ColorVector;
}

export function quantizeIcon(points: Point[]): Swatch[] {
  if (!points.length)
    return [];
  const centers = seedCenters(points);
  let groups: Point[][] = [];
  for (let pass = 0; pass < 30; pass++) {
    groups = centers.map(() => []);
    for (const point of points) {
      let nearest = 0, minDistance = Infinity;
      centers.forEach((c, i) => {
        const distance = squaredDistance(point.lab, c);
        if (distance < minDistance) {
          minDistance = distance;
          nearest = i;
        }
      });
      groups[nearest].push(point);
    }
    let movement = 0;
    groups.forEach((group, i) => {
      if (!group.length)
        return;
      const next = centroid(group, group.reduce((sum, p) => sum + p.weight, 0));
      movement += squaredDistance(centers[i], next);
      centers[i] = next;
    });
    if (movement < 1e-10)
      break;
  }
  const total = points.reduce((sum, p) => sum + p.weight, 0);
  return groups.flatMap((group, i) => {
    if (!group.length)
      return [];
    const lab = centers[i];
    const nearest = group.reduce((best, p) => squaredDistance(p.lab, lab) < squaredDistance(best.lab, lab) ? p : best);
    return [{ color: toHex(nearest.rgb), lab, share: group.reduce((sum, p) => sum + p.weight, 0) / total,
        hue: hueAngle(lab), chroma: Math.hypot(lab[1], lab[2]) }];
  }).sort((a, b) => b.share - a.share || a.color.localeCompare(b.color));
}

export function familyShare(swatches: Swatch[], hue: number): number {
  return swatches.reduce((sum, p) => sum + (hueDistance(p.hue, hue) <= hueRadius ? p.share : 0), 0);
}

export function initialSwatch(palette: Swatch[]): Swatch {
  const colored = palette.filter(s => s.chroma >= minimumChroma);
  const total = colored.reduce((sum, p) => sum + p.share, 0);
  const candidates = colored.map(s => ({ s, support: familyShare(colored, s.hue) }))
    .filter(({ support }) => support >= minimumFamilyShare || total >= minimumTotalColourShare)
    .map(({ s, support }) => ({ s, score: .7 * support + .3 * Math.min(s.chroma / .20, 1) }))
    .sort((a, b) => b.score - a.score || b.s.share - a.s.share || a.s.color.localeCompare(b.s.color));
  return candidates[0]?.s ?? palette[0];
}

export function meanSwatchColor(group: Swatch[]): ColorVector {
  const total = group.reduce((sum, p) => sum + p.share, 0);
  return [0, 1, 2].map(i => group.reduce((s, p) => s + p.share * p.lab[i], 0) / total) as ColorVector;
}
