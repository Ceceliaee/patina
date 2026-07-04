import { getWidgetIcon } from "../../platform/desktop/widgetRuntimeGateway.ts";
import { AppClassification } from "../../shared/classification/appClassification.ts";

interface WidgetIconServiceDeps {
  getIcon: (exeName: string) => Promise<string | null>;
}

const widgetIconServiceDeps: WidgetIconServiceDeps = {
  getIcon: getWidgetIcon,
};

const MAX_WIDGET_ICON_CACHE_ENTRIES = 16;
const iconCache = new Map<string, string | null>();
const iconPromises = new Map<string, Promise<string | null>>();

function rememberIcon(key: string, icon: string | null) {
  if (iconCache.has(key)) {
    iconCache.delete(key);
  }

  iconCache.set(key, icon);

  while (iconCache.size > MAX_WIDGET_ICON_CACHE_ENTRIES) {
    const oldestKey = iconCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    iconCache.delete(oldestKey);
  }
}

async function loadWidgetIcon(key: string, deps: WidgetIconServiceDeps) {
  if (iconCache.has(key)) {
    return iconCache.get(key) ?? null;
  }

  const existingPromise = iconPromises.get(key);
  if (existingPromise) {
    return existingPromise;
  }

  const promise = deps.getIcon(key)
    .then((icon) => {
      rememberIcon(key, icon);
      iconPromises.delete(key);
      return icon;
    })
    .catch((error) => {
      iconPromises.delete(key);
      throw error;
    });

  iconPromises.set(key, promise);
  return promise;
}

function resolveWidgetIconKey(objectIconKey: string) {
  const trimmed = objectIconKey.trim();
  return trimmed
    ? AppClassification.resolveCanonicalExecutable(trimmed)
    : null;
}

export async function loadWidgetObjectIconWithDeps(
  objectIconKey: string | null,
  deps: WidgetIconServiceDeps,
): Promise<string | null> {
  if (!objectIconKey) {
    return null;
  }

  const key = resolveWidgetIconKey(objectIconKey);
  if (!key) {
    return null;
  }

  return loadWidgetIcon(key, deps);
}

export async function loadWidgetObjectIcon(objectIconKey: string | null): Promise<string | null> {
  return loadWidgetObjectIconWithDeps(objectIconKey, widgetIconServiceDeps);
}

export function resetWidgetIconCacheForTests() {
  iconCache.clear();
  iconPromises.clear();
}

export function getWidgetIconCacheSizeForTests() {
  return iconCache.size;
}
