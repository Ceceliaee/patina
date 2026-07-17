const ICON_THEME_COLOR_STORAGE_KEY = "patina.icon-theme-colors.v1";
const ICON_THEME_COLOR_CACHE_LIMIT = 512;
const ICON_SOURCE_FINGERPRINT_CACHE_LIMIT = 256;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

const iconSourceFingerprintCache = new Map<string, string>();
let persistedColors: Map<string, string> | null = null;
let flushScheduled = false;
let storeGeneration = 0;

function getLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function fingerprintIconSource(iconSource: string): string {
  const cached = iconSourceFingerprintCache.get(iconSource);
  if (cached) return cached;

  let firstHash = 0x811c9dc5;
  let secondHash = 0x9e3779b9;
  for (let index = 0; index < iconSource.length; index += 1) {
    const code = iconSource.charCodeAt(index);
    firstHash = Math.imul(firstHash ^ code, 0x01000193);
    secondHash = Math.imul(secondHash ^ code, 0x5bd1e995);
  }

  const fingerprint = [
    iconSource.length.toString(36),
    (firstHash >>> 0).toString(36),
    (secondHash >>> 0).toString(36),
  ].join("-");
  iconSourceFingerprintCache.set(iconSource, fingerprint);

  while (iconSourceFingerprintCache.size > ICON_SOURCE_FINGERPRINT_CACHE_LIMIT) {
    const oldestSource = iconSourceFingerprintCache.keys().next().value;
    if (!oldestSource) break;
    iconSourceFingerprintCache.delete(oldestSource);
  }

  return fingerprint;
}

function hydratePersistedColors(): Map<string, string> {
  if (persistedColors) return persistedColors;

  persistedColors = new Map<string, string>();
  const storage = getLocalStorage();
  if (!storage) return persistedColors;

  try {
    const raw = storage.getItem(ICON_THEME_COLOR_STORAGE_KEY);
    if (!raw) return persistedColors;

    const entries: unknown = JSON.parse(raw);
    if (!Array.isArray(entries)) return persistedColors;

    for (const entry of entries) {
      if (
        !Array.isArray(entry)
        || entry.length !== 2
        || typeof entry[0] !== "string"
        || typeof entry[1] !== "string"
        || !HEX_COLOR_PATTERN.test(entry[1])
      ) {
        continue;
      }
      persistedColors.set(entry[0], entry[1]);
    }
  } catch {
    persistedColors.clear();
  }

  while (persistedColors.size > ICON_THEME_COLOR_CACHE_LIMIT) {
    const oldestKey = persistedColors.keys().next().value;
    if (!oldestKey) break;
    persistedColors.delete(oldestKey);
  }

  return persistedColors;
}

function flushPersistedColors(): void {
  flushScheduled = false;
  const storage = getLocalStorage();
  if (!storage || !persistedColors) return;

  try {
    storage.setItem(
      ICON_THEME_COLOR_STORAGE_KEY,
      JSON.stringify(Array.from(persistedColors.entries())),
    );
  } catch {
    // Theme colors are a regenerable optimization; storage failure must not block rendering.
  }
}

function schedulePersistedColorFlush(): void {
  if (flushScheduled) return;

  flushScheduled = true;
  const scheduledGeneration = storeGeneration;
  queueMicrotask(() => {
    if (scheduledGeneration !== storeGeneration) return;
    flushPersistedColors();
  });
}

function read(iconSource: string): string | null {
  if (!iconSource) return null;
  return hydratePersistedColors().get(fingerprintIconSource(iconSource)) ?? null;
}

function remember(iconSource: string, color: string): void {
  if (!iconSource || !HEX_COLOR_PATTERN.test(color)) return;

  const colors = hydratePersistedColors();
  const key = fingerprintIconSource(iconSource);
  if (colors.get(key) === color) return;

  colors.delete(key);
  colors.set(key, color);
  while (colors.size > ICON_THEME_COLOR_CACHE_LIMIT) {
    const oldestKey = colors.keys().next().value;
    if (!oldestKey) break;
    colors.delete(oldestKey);
  }
  schedulePersistedColorFlush();
}

export const iconThemeColorStore = {
  read,
  remember,
};

export const __iconThemeColorStoreInternals = {
  clearMemoryCache() {
    storeGeneration += 1;
    flushScheduled = false;
    persistedColors = null;
    iconSourceFingerprintCache.clear();
  },
  clearPersistentCache() {
    storeGeneration += 1;
    flushScheduled = false;
    persistedColors = new Map<string, string>();
    iconSourceFingerprintCache.clear();
    try {
      getLocalStorage()?.removeItem(ICON_THEME_COLOR_STORAGE_KEY);
    } catch {
      // Test cleanup is best-effort when storage is unavailable.
    }
  },
  fingerprintIconSource,
  flushPersistedColors,
  storageKey: ICON_THEME_COLOR_STORAGE_KEY,
};
