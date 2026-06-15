import { useEffect, useState } from "react";

const ICON_THEME_CACHE = new Map<string, string>();

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
  const bucket = (value: number) => Math.floor(value / 32);
  return `${bucket(r)}-${bucket(g)}-${bucket(b)}`;
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
  const size = 24;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  let data: Uint8ClampedArray;
  try {
    context.drawImage(image, 0, 0, size, size);
    data = context.getImageData(0, 0, size, size).data;
  } catch {
    return null;
  }

  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const a = data[index + 3];
    if (a < 48) continue;

    const brightness = (r + g + b) / 3;
    if (brightness > 245 || brightness < 10) continue;

    const key = toBucketKey(r, g, b);
    const existing = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
    existing.count += 1;
    existing.r += r;
    existing.g += g;
    existing.b += b;
    buckets.set(key, existing);
  }

  let selected: { count: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!selected || bucket.count > selected.count) {
      selected = bucket;
    }
  }

  if (!selected) return null;

  const color = rgbToHex(
    Math.round(selected.r / selected.count),
    Math.round(selected.g / selected.count),
    Math.round(selected.b / selected.count),
  );
  ICON_THEME_CACHE.set(imageSource, color);
  return color;
}

export function useIconThemeColors(icons: Record<string, string>) {
  const [colors, setColors] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    const resolveColors = async () => {
      const entries = Object.entries(icons);
      if (entries.length === 0) {
        setColors({});
        return;
      }

      const resolved: Record<string, string> = {};
      await Promise.all(entries.map(async ([exeName, icon]) => {
        const color = await extractDominantColor(icon);
        if (color) {
          resolved[exeName] = color;
        }
      }));

      if (!cancelled) {
        setColors(resolved);
      }
    };

    void resolveColors();

    return () => {
      cancelled = true;
    };
  }, [icons]);

  return colors;
}
