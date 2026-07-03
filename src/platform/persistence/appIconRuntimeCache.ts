import { AppClassification } from "../../shared/classification/appClassification.ts";
import { getIconsForExecutables } from "./sessionReadRepository.ts";

type LoadIconsForExecutables = typeof getIconsForExecutables;

interface MissingIconRetryState {
  attempts: number;
  nextRetryAtMs: number;
}

export interface AppIconRuntimeCacheDeps {
  loadIcons?: LoadIconsForExecutables;
  nowMs?: () => number;
}

const MISSING_ICON_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 60_000] as const;
const APP_ICON_RUNTIME_CACHE_LIMIT = 256;
const MISSING_ICON_RETRY_CACHE_LIMIT = 256;

const appIconCache = new Map<string, string>();
const missingIconRetryState = new Map<string, MissingIconRetryState>();
let pendingIconRefresh: Promise<void> | null = null;

function nowFromDeps(deps: AppIconRuntimeCacheDeps): number {
  return deps.nowMs?.() ?? Date.now();
}

function normalizeRequestedExecutables(exeNames: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const exeName of exeNames) {
    const rawExe = exeName.trim();
    if (!rawExe) continue;

    const retryKey = resolveAppIconRetryKey(rawExe);
    if (seen.has(retryKey)) continue;

    seen.add(retryKey);
    result.push(rawExe);
  }

  return result;
}

function resolveAppIconRetryKey(exeName: string): string {
  const canonicalExe = AppClassification.resolveCanonicalExecutable(exeName);
  return canonicalExe || AppClassification.normalizeExecutable(exeName);
}

function retryDelayForAttempts(attempts: number): number {
  const index = Math.min(Math.max(attempts - 1, 0), MISSING_ICON_RETRY_DELAYS_MS.length - 1);
  return MISSING_ICON_RETRY_DELAYS_MS[index];
}

function readIcon(icons: Record<string, string>, exeName: string): string | null {
  for (const key of resolveAppIconKeys(exeName)) {
    const icon = icons[key];
    if (icon) return icon;
  }

  return null;
}

function readRuntimeIcon(exeName: string): string | null {
  for (const key of resolveAppIconKeys(exeName)) {
    const icon = appIconCache.get(key);
    if (!icon) continue;

    appIconCache.delete(key);
    appIconCache.set(key, icon);
    return icon;
  }

  return null;
}

function rememberIconAliases(icons: Record<string, string>, exeName: string, icon: string): void {
  for (const key of resolveAppIconKeys(exeName)) {
    icons[key] = icon;
  }
}

function setRuntimeIconCacheEntry(key: string, icon: string): void {
  appIconCache.delete(key);
  appIconCache.set(key, icon);

  while (appIconCache.size > APP_ICON_RUNTIME_CACHE_LIMIT) {
    const oldestKey = appIconCache.keys().next().value;
    if (!oldestKey) break;
    appIconCache.delete(oldestKey);
  }
}

function mergeIntoRuntimeCache(icons: Record<string, string>): void {
  for (const [key, icon] of Object.entries(icons)) {
    if (key.trim() && icon) {
      setRuntimeIconCacheEntry(key, icon);
    }
  }
}

function expandRequestedIconAliases(
  requestedExeNames: string[],
  foundIcons: Record<string, string>,
): Record<string, string> {
  const expandedIcons = { ...foundIcons };
  mergeIntoRuntimeCache(foundIcons);

  for (const exeName of requestedExeNames) {
    const icon = readIcon(expandedIcons, exeName) ?? readRuntimeIcon(exeName);
    if (icon) {
      rememberIconAliases(expandedIcons, exeName, icon);
    }
  }

  mergeIntoRuntimeCache(expandedIcons);
  return expandedIcons;
}

function markIconRefreshResult(
  requestedExeNames: string[],
  foundIcons: Record<string, string>,
  nowMs: number,
): void {
  const expandedIcons = expandRequestedIconAliases(requestedExeNames, foundIcons);

  for (const exeName of requestedExeNames) {
    const retryKey = resolveAppIconRetryKey(exeName);
    if (readIcon(expandedIcons, exeName) ?? readRuntimeIcon(exeName)) {
      missingIconRetryState.delete(retryKey);
      continue;
    }

    const previous = missingIconRetryState.get(retryKey);
    const attempts = (previous?.attempts ?? 0) + 1;
    missingIconRetryState.delete(retryKey);
    missingIconRetryState.set(retryKey, {
      attempts,
      nextRetryAtMs: nowMs + retryDelayForAttempts(attempts),
    });
    while (missingIconRetryState.size > MISSING_ICON_RETRY_CACHE_LIMIT) {
      const oldestKey = missingIconRetryState.keys().next().value;
      if (!oldestKey) break;
      missingIconRetryState.delete(oldestKey);
    }
  }
}

export function resolveAppIconKeys(exeName: string): string[] {
  const rawExe = exeName.trim();
  if (!rawExe) return [];

  const lowerExe = rawExe.toLowerCase();
  const normalizedExe = AppClassification.normalizeExecutable(rawExe);
  const canonicalExe = AppClassification.resolveCanonicalExecutable(rawExe);

  return Array.from(new Set([
    rawExe,
    lowerExe,
    normalizedExe,
    canonicalExe,
  ].filter(Boolean)));
}

export function getAppIcon(icons: Record<string, string>, exeName: string): string | null {
  return readIcon(icons, exeName);
}

export function hasAppIconForExecutable(
  icons: Record<string, string>,
  exeName: string,
): boolean {
  return Boolean(readIcon(icons, exeName));
}

export function getRetryableMissingAppIconExecutables(
  exeNames: string[],
  icons: Record<string, string> = {},
  nowMs: number = Date.now(),
): string[] {
  const result: string[] = [];

  for (const exeName of normalizeRequestedExecutables(exeNames)) {
    if (readIcon(icons, exeName) ?? readRuntimeIcon(exeName)) {
      continue;
    }

    const retryKey = resolveAppIconRetryKey(exeName);
    const retryState = missingIconRetryState.get(retryKey);
    if (retryState && retryState.nextRetryAtMs > nowMs) {
      missingIconRetryState.delete(retryKey);
      missingIconRetryState.set(retryKey, retryState);
      continue;
    }

    result.push(exeName);
  }

  return result;
}

export function getAppIconRuntimeCacheSnapshot(): Record<string, string> {
  return Object.fromEntries(appIconCache.entries());
}

export function getCachedAppIconsForExecutables(exeNames: string[]): Record<string, string> {
  const requestedExeNames = normalizeRequestedExecutables(exeNames);
  const icons: Record<string, string> = {};

  for (const exeName of requestedExeNames) {
    const icon = readRuntimeIcon(exeName);
    if (icon) {
      rememberIconAliases(icons, exeName, icon);
    }
  }

  return icons;
}

export async function loadAppIconsForExecutables(
  exeNames: string[],
  deps: AppIconRuntimeCacheDeps = {},
): Promise<Record<string, string>> {
  const requestedExeNames = normalizeRequestedExecutables(exeNames);
  if (requestedExeNames.length === 0) {
    return getAppIconRuntimeCacheSnapshot();
  }

  if (pendingIconRefresh) {
    await pendingIconRefresh;
  }

  const nowMs = nowFromDeps(deps);
  const missingExeNames = getRetryableMissingAppIconExecutables(
    requestedExeNames,
    {},
    nowMs,
  );

  if (missingExeNames.length === 0) {
    return getAppIconRuntimeCacheSnapshot();
  }

  const loadIcons = deps.loadIcons ?? getIconsForExecutables;
  const refresh = loadIcons(missingExeNames)
    .then((foundIcons) => {
      markIconRefreshResult(missingExeNames, foundIcons, nowMs);
    })
    .catch((error) => {
      markIconRefreshResult(missingExeNames, {}, nowMs);
      throw error;
    });

  pendingIconRefresh = refresh;

  try {
    await refresh;
  } finally {
    if (pendingIconRefresh === refresh) {
      pendingIconRefresh = null;
    }
  }

  return getAppIconRuntimeCacheSnapshot();
}

export function resetAppIconRuntimeCacheForTests(): void {
  appIconCache.clear();
  missingIconRetryState.clear();
  pendingIconRefresh = null;
}

export function getAppIconRuntimeCacheStats() {
  return {
    entries: appIconCache.size,
    limit: APP_ICON_RUNTIME_CACHE_LIMIT,
    missingRetryEntries: missingIconRetryState.size,
    missingRetryLimit: MISSING_ICON_RETRY_CACHE_LIMIT,
    pendingRefresh: pendingIconRefresh !== null,
  };
}
