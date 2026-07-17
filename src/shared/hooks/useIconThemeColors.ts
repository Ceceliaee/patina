import { useEffect, useMemo, useState } from "react";

export interface IconThemeColorPersistence {
  read: (iconSource: string) => string | null;
  remember: (iconSource: string, color: string) => void;
}

const NO_ICON_THEME_COLOR_PERSISTENCE: IconThemeColorPersistence = {
  read: () => null,
  remember: () => undefined,
};

let iconThemeColorPersistence = NO_ICON_THEME_COLOR_PERSISTENCE;

const ICON_THEME_CACHE = new Map<string, string>();
const ICON_THEME_FALLBACK_CACHE = new Map<string, Map<string, string>>();
const ICON_THEME_IN_FLIGHT = new Map<string, Promise<string | null>>();
const ICON_SAMPLE_SIZE = 48;
const ALPHA_MIN = 48;
const NEAR_WHITE_BRIGHTNESS_MIN = 235;
const NEAR_WHITE_CHROMA_MAX = 20;
const EDGE_WIDTH = 3;
const EDGE_BACKGROUND_BRIGHTNESS_MIN = 190;
const EDGE_BACKGROUND_SATURATION_MAX = 0.3;
const EDGE_BACKGROUND_DISTANCE_MAX = 28;
const EDGE_BACKGROUND_MIN_SHARE = 0.35;
const EDGE_DARK_PROTECTION_BRIGHTNESS = 120;
const BACKGROUND_RAMP_BRIGHTNESS_MIN = 210;
const BACKGROUND_RAMP_SATURATION_MAX = 0.18;
const BACKGROUND_RAMP_DISTANCE_MAX = 72;
const DOMINANT_BACKGROUND_BRIGHTNESS_MIN = 190;
const DOMINANT_BACKGROUND_SATURATION_MAX = 0.22;
const DOMINANT_BACKGROUND_MIN_SHARE = 0.45;
const DOMINANT_BACKGROUND_MIN_CANVAS_SHARE = 0.25;
const BUCKET_SIZE = 24;
const FALLBACK_PALETTE = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#14B8A6",
  "#64748B",
];

type Rgb = {
  r: number;
  g: number;
  b: number;
};

type ColorBucket = {
  weight: number;
  rSum: number;
  gSum: number;
  bSum: number;
  count: number;
};

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (value: number) => value.toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

function toImageSource(icon: string) {
  const trimmed = icon.trim();
  if (!trimmed) return "";
  if (URL_SCHEME_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return `data:image/png;base64,${trimmed}`;
}

function toBucketKey(r: number, g: number, b: number) {
  const bucket = (value: number) => Math.floor(value / BUCKET_SIZE);
  return `${bucket(r)}-${bucket(g)}-${bucket(b)}`;
}

function colorBrightness({ r, g, b }: Rgb) {
  return (r + g + b) / 3;
}

function colorChroma({ r, g, b }: Rgb) {
  return Math.max(r, g, b) - Math.min(r, g, b);
}

function colorSaturation({ r, g, b }: Rgb) {
  const max = Math.max(r, g, b);
  if (max === 0) return 0;
  return (max - Math.min(r, g, b)) / max;
}

function colorDistance(left: Rgb, right: Rgb) {
  const dr = left.r - right.r;
  const dg = left.g - right.g;
  const db = left.b - right.b;
  return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
}

function pixelOffset(x: number, y: number, size: number) {
  return ((y * size) + x) * 4;
}

function isNearWhiteOrGray(color: Rgb) {
  return colorBrightness(color) > NEAR_WHITE_BRIGHTNESS_MIN
    && colorChroma(color) < NEAR_WHITE_CHROMA_MAX;
}

function isLightNeutralBackgroundLike(color: Rgb) {
  return colorBrightness(color) > DOMINANT_BACKGROUND_BRIGHTNESS_MIN
    && colorSaturation(color) < DOMINANT_BACKGROUND_SATURATION_MAX;
}

function isEdgePixel(x: number, y: number, size: number) {
  return x < EDGE_WIDTH
    || y < EDGE_WIDTH
    || x >= size - EDGE_WIDTH
    || y >= size - EDGE_WIDTH;
}

function centerWeightForPixel(x: number, y: number, size: number) {
  const center = (size - 1) / 2;
  if (center <= 0) return 1;

  const dx = (x - center) / center;
  const dy = (y - center) / center;
  const normalizedDistance = Math.min(1, Math.sqrt((dx * dx) + (dy * dy)) / Math.SQRT2);
  return 1.2 - (0.4 * normalizedDistance);
}

function addBucketPixel(
  buckets: Map<string, ColorBucket>,
  color: Rgb,
  weight: number,
) {
  const key = toBucketKey(color.r, color.g, color.b);
  const existing = buckets.get(key) ?? { weight: 0, rSum: 0, gSum: 0, bSum: 0, count: 0 };
  existing.weight += weight;
  existing.rSum += color.r * weight;
  existing.gSum += color.g * weight;
  existing.bSum += color.b * weight;
  existing.count += 1;
  buckets.set(key, existing);
}

function averageBucketColor(bucket: ColorBucket): Rgb {
  return {
    r: Math.round(bucket.rSum / bucket.weight),
    g: Math.round(bucket.gSum / bucket.weight),
    b: Math.round(bucket.bSum / bucket.weight),
  };
}

function detectLightEdgeBackground(data: Uint8ClampedArray, size: number): Rgb | null {
  const buckets = new Map<string, ColorBucket>();
  let edgePixelCount = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (!isEdgePixel(x, y, size)) continue;

      const offset = pixelOffset(x, y, size);
      const a = data[offset + 3];
      if (a < ALPHA_MIN) continue;

      const color = {
        r: data[offset],
        g: data[offset + 1],
        b: data[offset + 2],
      };
      edgePixelCount += 1;
      addBucketPixel(buckets, color, 1);
    }
  }

  let selected: ColorBucket | null = null;
  for (const bucket of buckets.values()) {
    if (!selected || bucket.count > selected.count) {
      selected = bucket;
    }
  }

  if (!selected) return null;
  if (selected.count / edgePixelCount < EDGE_BACKGROUND_MIN_SHARE) return null;

  const edgeColor = averageBucketColor(selected);
  const edgeBrightness = colorBrightness(edgeColor);
  if (edgeBrightness < EDGE_DARK_PROTECTION_BRIGHTNESS) return null;
  if (
    edgeBrightness > EDGE_BACKGROUND_BRIGHTNESS_MIN
    && colorSaturation(edgeColor) < EDGE_BACKGROUND_SATURATION_MAX
  ) {
    return edgeColor;
  }

  return null;
}

function detectDominantLightBackground(data: Uint8ClampedArray, size: number): Rgb | null {
  const buckets = new Map<string, ColorBucket>();
  let opaquePixelCount = 0;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = pixelOffset(x, y, size);
      const a = data[offset + 3];
      if (a < ALPHA_MIN) continue;

      const color = {
        r: data[offset],
        g: data[offset + 1],
        b: data[offset + 2],
      };
      opaquePixelCount += 1;
      addBucketPixel(buckets, color, 1);
    }
  }

  let selected: ColorBucket | null = null;
  for (const bucket of buckets.values()) {
    if (!selected || bucket.count > selected.count) {
      selected = bucket;
    }
  }

  if (!selected || opaquePixelCount === 0) return null;
  if (selected.count / opaquePixelCount < DOMINANT_BACKGROUND_MIN_SHARE) return null;
  if (selected.count / (size * size) < DOMINANT_BACKGROUND_MIN_CANVAS_SHARE) return null;

  const color = averageBucketColor(selected);
  if (colorBrightness(color) < EDGE_DARK_PROTECTION_BRIGHTNESS) return null;
  if (isLightNeutralBackgroundLike(color)) {
    return color;
  }

  return null;
}

function isBackgroundColor(color: Rgb, backgrounds: Rgb[]) {
  return backgrounds.some((background) => (
    colorDistance(color, background) <= EDGE_BACKGROUND_DISTANCE_MAX
  ));
}

function isBackgroundRampColor(color: Rgb, backgrounds: Rgb[]) {
  if (
    colorBrightness(color) <= BACKGROUND_RAMP_BRIGHTNESS_MIN
    || colorSaturation(color) >= BACKGROUND_RAMP_SATURATION_MAX
  ) {
    return false;
  }

  return backgrounds.some((background) => (
    isLightNeutralBackgroundLike(background)
    && colorDistance(color, background) <= BACKGROUND_RAMP_DISTANCE_MAX
  ));
}

function selectPrimaryBucket(buckets: Map<string, ColorBucket>, backgrounds: Rgb[]) {
  let selected: ColorBucket | null = null;
  for (const bucket of buckets.values()) {
    const color = averageBucketColor(bucket);
    if (isBackgroundColor(color, backgrounds)) continue;
    if (!selected || bucket.weight > selected.weight) {
      selected = bucket;
    }
  }
  return selected;
}

function chooseDominantColor(data: Uint8ClampedArray, size: number) {
  if (size <= 0 || data.length < size * size * 4) return null;

  const backgrounds = [
    detectLightEdgeBackground(data, size),
    detectDominantLightBackground(data, size),
  ].filter((background): background is Rgb => background !== null);
  const buckets = new Map<string, ColorBucket>();

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const offset = pixelOffset(x, y, size);
      const color = {
        r: data[offset],
        g: data[offset + 1],
        b: data[offset + 2],
      };
      const a = data[offset + 3];
      if (a < ALPHA_MIN) continue;
      if (isNearWhiteOrGray(color)) continue;
      if (isBackgroundRampColor(color, backgrounds)) continue;
      if (isBackgroundColor(color, backgrounds)) continue;

      const alphaWeight = a / 255;
      const pixelWeight = alphaWeight * centerWeightForPixel(x, y, size);
      addBucketPixel(buckets, color, pixelWeight);
    }
  }

  const selected = selectPrimaryBucket(buckets, backgrounds);
  if (!selected) return null;

  const color = averageBucketColor(selected);
  return rgbToHex(color.r, color.g, color.b);
}

function fallbackThemeColor(identifier: string) {
  let hash = 0;
  for (const char of identifier.trim().toLowerCase()) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length];
}

function normalizeThemeColorIdentifier(identifier: string) {
  return identifier.trim().toLowerCase();
}

function readCachedThemeColor(identifier: string, iconData: string): string | null {
  const imageSource = toImageSource(iconData);
  if (!imageSource) return null;

  const extractedColor = ICON_THEME_CACHE.get(imageSource);
  if (extractedColor) return extractedColor;

  try {
    const persistedColor = iconThemeColorPersistence.read(imageSource);
    if (persistedColor) {
      ICON_THEME_CACHE.set(imageSource, persistedColor);
      return persistedColor;
    }
  } catch {
    // Persistence is an optional optimization; extraction remains the source of truth.
  }

  return ICON_THEME_FALLBACK_CACHE
    .get(imageSource)
    ?.get(normalizeThemeColorIdentifier(identifier)) ?? null;
}

function readCachedThemeColors(icons: Record<string, string>): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const [identifier, iconData] of Object.entries(icons)) {
    const color = readCachedThemeColor(identifier, iconData);
    if (color) colors[identifier] = color;
  }
  return colors;
}

async function extractDominantColor(iconData: string): Promise<string | null> {
  const imageSource = toImageSource(iconData);
  if (!imageSource) return null;

  const cached = ICON_THEME_CACHE.get(imageSource);
  if (cached) return cached;

  const image = new Image();
  image.decoding = "async";
  if (/^https?:/i.test(imageSource)) {
    image.crossOrigin = "anonymous";
  }
  image.src = imageSource;
  try {
    await image.decode();
  } catch {
    return null;
  }

  const canvas = document.createElement("canvas");
  const size = ICON_SAMPLE_SIZE;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  let data: Uint8ClampedArray;
  try {
    const imageWidth = image.naturalWidth || image.width;
    const imageHeight = image.naturalHeight || image.height;
    if (imageWidth <= 0 || imageHeight <= 0) return null;

    const scale = Math.min(size / imageWidth, size / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    const x = (size - width) / 2;
    const y = (size - height) / 2;
    context.clearRect(0, 0, size, size);
    context.drawImage(image, x, y, width, height);
    data = context.getImageData(0, 0, size, size).data;
  } catch {
    return null;
  }

  const color = chooseDominantColor(data, size);
  if (!color) return null;

  ICON_THEME_CACHE.set(imageSource, color);
  return color;
}

async function resolveThemeColor(
  identifier: string,
  iconData: string,
  extractor: (value: string) => Promise<string | null> = extractDominantColor,
): Promise<string | null> {
  const imageSource = toImageSource(iconData);
  if (!imageSource) return null;

  const cachedColor = readCachedThemeColor(identifier, iconData);
  if (cachedColor) return cachedColor;

  let pending = ICON_THEME_IN_FLIGHT.get(imageSource);
  if (!pending) {
    const created = Promise.resolve()
      .then(() => extractor(iconData))
      .catch(() => null)
      .then((color) => {
        if (color) ICON_THEME_CACHE.set(imageSource, color);
        return color;
      })
      .finally(() => {
        if (ICON_THEME_IN_FLIGHT.get(imageSource) === created) {
          ICON_THEME_IN_FLIGHT.delete(imageSource);
        }
      });
    ICON_THEME_IN_FLIGHT.set(imageSource, created);
    pending = created;
  }

  const extractedColor = await pending;
  if (extractedColor) {
    try {
      iconThemeColorPersistence.remember(imageSource, extractedColor);
    } catch {
      // Persistence is an optional optimization; the in-memory result is still valid.
    }
    return extractedColor;
  }

  const fallbackColor = fallbackThemeColor(identifier);
  const sourceFallbacks = ICON_THEME_FALLBACK_CACHE.get(imageSource) ?? new Map<string, string>();
  sourceFallbacks.set(normalizeThemeColorIdentifier(identifier), fallbackColor);
  ICON_THEME_FALLBACK_CACHE.set(imageSource, sourceFallbacks);
  return fallbackColor;
}

function resetThemeColorCaches() {
  ICON_THEME_CACHE.clear();
  ICON_THEME_FALLBACK_CACHE.clear();
  ICON_THEME_IN_FLIGHT.clear();
}

export function configureIconThemeColorPersistence(
  persistence: IconThemeColorPersistence | null,
): void {
  iconThemeColorPersistence = persistence ?? NO_ICON_THEME_COLOR_PERSISTENCE;
}

export function useIconThemeColors(icons: Record<string, string>) {
  const [cacheRevision, setCacheRevision] = useState(0);
  const colors = useMemo(() => {
    void cacheRevision;
    return readCachedThemeColors(icons);
  }, [cacheRevision, icons]);

  useEffect(() => {
    const unresolvedEntries = Object.entries(icons).filter(([identifier, iconData]) => (
      Boolean(toImageSource(iconData)) && !readCachedThemeColor(identifier, iconData)
    ));
    if (unresolvedEntries.length === 0) return undefined;

    let cancelled = false;
    void Promise.all(unresolvedEntries.map(([identifier, iconData]) => (
      resolveThemeColor(identifier, iconData)
    ))).then(() => {
      if (!cancelled) setCacheRevision((current) => current + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [icons]);

  return colors;
}

export const __iconThemeColorInternals = {
  chooseDominantColor,
  detectDominantLightBackground,
  detectLightEdgeBackground,
  fallbackThemeColor,
  readCachedThemeColors,
  resetThemeColorCaches,
  resolveThemeColor,
};
