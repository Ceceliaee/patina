import { useEffect, useMemo, useState } from "react";

interface IconThemeColorPersistence {
  read: (iconSource: string) => string | null;
  remember: (iconSource: string, color: string) => void;
}

const NO_ICON_THEME_COLOR_PERSISTENCE: IconThemeColorPersistence = {
  read: () => null,
  remember: () => undefined,
};

let iconThemeColorPersistence = NO_ICON_THEME_COLOR_PERSISTENCE;

const ICON_THEME_CACHE_LIMIT = 256;
const ICON_THEME_CACHE = new Map<string, string | null>();
const ICON_THEME_IN_FLIGHT = new Map<string, Promise<string | null>>();
const ICON_SAMPLE_SIZE = 48;

const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

function toImageSource(icon: string) {
  const trimmed = icon.trim();
  if (!trimmed) return "";
  if (URL_SCHEME_PATTERN.test(trimmed)) {
    return trimmed;
  }
  return `data:image/png;base64,${trimmed}`;
}


function rememberThemeColor(imageSource: string, color: string | null) {
  ICON_THEME_CACHE.delete(imageSource);
  ICON_THEME_CACHE.set(imageSource, color);
  while (ICON_THEME_CACHE.size > ICON_THEME_CACHE_LIMIT) {
    const oldestSource = ICON_THEME_CACHE.keys().next().value;
    if (oldestSource === undefined) break;
    ICON_THEME_CACHE.delete(oldestSource);
  }
}

function readCachedThemeColor(iconData: string): string | null {
  const imageSource = toImageSource(iconData);
  if (!imageSource) return null;

  const extractedColor = ICON_THEME_CACHE.get(imageSource);
  if (extractedColor !== undefined) {
    rememberThemeColor(imageSource, extractedColor);
    return extractedColor;
  }

  try {
    const persistedColor = iconThemeColorPersistence.read(imageSource);
    if (persistedColor) {
      rememberThemeColor(imageSource, persistedColor);
      return persistedColor;
    }
  } catch {
    // Persistence is an optional optimization; extraction remains the source of truth.
  }

  return null;
}

function readCachedThemeColors(icons: Record<string, string>): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const [identifier, iconData] of Object.entries(icons)) {
    const color = readCachedThemeColor(iconData);
    if (color) colors[identifier] = color;
  }
  return colors;
}

export async function prewarmIconThemeColors(
  icons: Record<string, string>,
): Promise<Record<string, string>> {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    return readCachedThemeColors(icons);
  }

  // A caller's icon set can exceed the shared cache; retain every result for this call.
  const colors: Record<string, string> = {};
  await Promise.all(Object.entries(icons).map(async ([identifier, iconData]) => {
    const color = await resolveThemeColor(iconData);
    if (color) colors[identifier] = color;
  }));
  return colors;
}

async function extractDominantColor(iconData: string): Promise<string | null> {
  const imageSource = toImageSource(iconData);
  if (!imageSource) return null;

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

  const { iconRepresentative } = await import("../colors/iconRepresentative.ts");
  return iconRepresentative(data, size)?.color ?? null;
}

async function resolveThemeColor(
  iconData: string,
  extractor: (value: string) => Promise<string | null> = extractDominantColor,
): Promise<string | null> {
  const imageSource = toImageSource(iconData);
  if (!imageSource) return null;

  const cachedColor = readCachedThemeColor(iconData);
  if (cachedColor || ICON_THEME_CACHE.has(imageSource)) return cachedColor;

  let pending = ICON_THEME_IN_FLIGHT.get(imageSource);
  if (!pending) {
    const created = Promise.resolve()
      .then(() => extractor(iconData))
      .catch(() => null)
      .then((color) => {
        if (ICON_THEME_IN_FLIGHT.get(imageSource) === created) {
          rememberThemeColor(imageSource, color);
          if (color) {
            try {
              iconThemeColorPersistence.remember(imageSource, color);
            } catch {
              // Persistence is optional; the in-memory result remains valid.
            }
          }
        }
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

  return pending;
}

function resetThemeColorCaches() {
  ICON_THEME_CACHE.clear();
  ICON_THEME_IN_FLIGHT.clear();
}

export function configureIconThemeColorPersistence(
  persistence: IconThemeColorPersistence | null,
): void {
  iconThemeColorPersistence = persistence ?? NO_ICON_THEME_COLOR_PERSISTENCE;
}

export function useIconThemeColorSnapshot(icons: Record<string, string>) {
  const [resolved, setResolved] = useState<{
    icons: Record<string, string>;
    colors: Record<string, string>;
  } | null>(null);
  const cached = useMemo(() => {
    const colors = readCachedThemeColors(icons);
    const ready = Object.entries(icons).every(([key, icon]) => (
      colors[key] || !icon.trim() || ICON_THEME_CACHE.has(toImageSource(icon))
    ));
    return { colors, ready };
  }, [icons]);

  useEffect(() => {
    if (cached.ready) return;
    let cancelled = false;
    void prewarmIconThemeColors(icons).then((nextColors) => {
      if (!cancelled) setResolved({ icons, colors: nextColors });
    });

    return () => {
      cancelled = true;
    };
  }, [cached, icons]);

  return resolved?.icons === icons ? { colors: resolved.colors, ready: true } : cached;
}

export function useIconThemeColors(icons: Record<string, string>) {
  return useIconThemeColorSnapshot(icons).colors;
}

export const __iconThemeColorInternals = {
  readCachedThemeColors,
  resetThemeColorCaches,
  resolveThemeColor,
};
