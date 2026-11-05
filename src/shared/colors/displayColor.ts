import { colorContrast, labToHex, labToLinearRgb, parseHex, toLab, type ColorVector } from "./oklab.ts";

function inGamut(lab: ColorVector) {
  return labToLinearRgb(lab).every(c => c >= -.000001 && c <= 1.000001);
}

function atLightness(L: number, a: number, b: number) {
  if (inGamut([L, a, b]))
    return labToHex([L, a, b]);
  // Scaling both chromatic axes reduces C without changing the OKLCH hue.
  let low = 0, high = 1;
  for (let i = 0; i < 22; i++) {
    const t = (low + high) / 2;
    if (inGamut([L, a * t, b * t]))
      low = t;
    else
      high = t;
  }
  return labToHex([L, a * low, b * low]);
}

export function activityDisplayColor(source: string, background: string, mode: "light" | "dark"): string {
  if (!/^#[0-9a-f]{6}$/i.test(source))
    return source;
  const target = mode === "light" ? 2 : 3;
  if (colorContrast(source, background) >= target)
    return source;
  const rgb = parseHex(source);
  let [L, a, b] = toLab(rgb);
  if (rgb.every(v => v === rgb[0])) {
    a = 0;
    b = 0;
  }
  const end = colorContrast("#FFFFFF", background) > colorContrast("#000000", background) ? 1 : 0;
  let fail = 0, pass = 1;
  for (let i = 0; i < 26; i++) {
    const t = (fail + pass) / 2;
    if (colorContrast(atLightness(L + (end - L) * t, a, b), background) >= target)
      pass = t;
    else
      fail = t;
  }
  return atLightness(L + (end - L) * pass, a, b);
}
