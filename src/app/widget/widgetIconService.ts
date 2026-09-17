import { appIconChangeAffects, subscribeAppIconChanges } from "../../shared/hooks/appIconChanges.ts";
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
let generation = 0;
subscribeAppIconChanges((exeName) => {
  generation += 1;
  for (const key of iconCache.keys()) {
    if (appIconChangeAffects(exeName, [key])) iconCache.delete(key);
  }
});

function rememberIcon(key: string, icon: string | null) {
  iconCache.delete(key);

  iconCache.set(key, icon);

  while (iconCache.size > MAX_WIDGET_ICON_CACHE_ENTRIES) {
    iconCache.delete(iconCache.keys().next().value!);
  }
}

export async function loadWidgetObjectIcon(
  objectIconKey: string | null,
  deps: WidgetIconServiceDeps = widgetIconServiceDeps,
): Promise<string | null> {
  const key = AppClassification.resolveCanonicalExecutable(objectIconKey?.trim() ?? "");
  if (!key) return null;
  const cached = iconCache.get(key);
  if (cached !== undefined) return cached;

  const existingPromise = iconPromises.get(key);
  if (existingPromise) {
    return existingPromise;
  }

  const requestGeneration = generation;
  const promise: Promise<string | null> = deps.getIcon(key)
    .then((icon) => {
      if (iconPromises.get(key) === promise) iconPromises.delete(key);
      if (requestGeneration !== generation) return loadWidgetObjectIcon(key, deps);
      rememberIcon(key, icon);
      return icon;
    })
    .finally(() => {
      if (iconPromises.get(key) === promise) iconPromises.delete(key);
    });

  iconPromises.set(key, promise);
  return promise;
}

export function resetWidgetIconCacheForTests() {
  generation += 1;
  iconCache.clear();
  iconPromises.clear();
}

export function getWidgetIconCacheSizeForTests() {
  return iconCache.size;
}
