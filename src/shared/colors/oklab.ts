export type ColorVector = [
  number,
  number,
  number
];

const linear = Array.from({ length: 256 }, (_, channel) => {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});

export function parseHex(hex: string): ColorVector {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)) as ColorVector;
}

export function toHex(rgb: ColorVector): string {
  return "#" + rgb.map(c => Math.round(c).toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function toLab([r, g, b]: ColorVector): ColorVector {
  const red = linear[r], green = linear[g], blue = linear[b];
  const l = Math.cbrt(.4122214708 * red + .5363325363 * green + .0514459929 * blue);
  const m = Math.cbrt(.2119034982 * red + .6806995451 * green + .1073969566 * blue);
  const s = Math.cbrt(.0883024619 * red + .2817188376 * green + .6299787005 * blue);
  return [
    .2104542553 * l + .793617785 * m - .0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + .4505937099 * s,
    .0259040371 * l + .7827717662 * m - .808675766 * s,
  ];
}

export function labToLinearRgb([L, a, b]: ColorVector): ColorVector {
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
}

export function labToHex(lab: ColorVector): string {
  const rgb = labToLinearRgb(lab).map(channel => {
    const v = Math.min(1, Math.max(0, channel));
    return 255 * (v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055);
  }) as ColorVector;
  return toHex(rgb);
}

export function colorContrast(first: string, second: string): number {
  const luminance = (hex: string) => {
    const [r, g, b] = parseHex(hex);
    return .2126 * linear[r] + .7152 * linear[g] + .0722 * linear[b];
  };
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

export function hueDistance(a: number, b: number): number {
  const distance = Math.abs(a - b);
  return Math.min(distance, 360 - distance);
}

export function hueAngle([, a, b]: ColorVector): number {
  return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
}

export function squaredDistance(a: ColorVector, b: ColorVector): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}
