import { getIconMap } from "../../platform/persistence/sessionReadRepository.ts";

interface WidgetIconServiceDeps {
  getIconMap: () => Promise<Record<string, string>>;
}

const widgetIconServiceDeps: WidgetIconServiceDeps = {
  getIconMap,
};

let iconMapCache: Record<string, string> | null = null;
let iconMapPromise: Promise<Record<string, string>> | null = null;

async function loadWidgetIconMap(deps: WidgetIconServiceDeps) {
  if (iconMapCache) {
    return iconMapCache;
  }

  if (!iconMapPromise) {
    iconMapPromise = deps.getIconMap()
      .then((icons) => {
        iconMapCache = icons;
        return icons;
      })
      .catch((error) => {
        iconMapPromise = null;
        throw error;
      });
  }

  return iconMapPromise;
}

export async function loadWidgetObjectIconWithDeps(
  objectIconKey: string | null,
  deps: WidgetIconServiceDeps,
): Promise<string | null> {
  if (!objectIconKey) {
    return null;
  }

  const icons = await loadWidgetIconMap(deps);
  return icons[objectIconKey] ?? null;
}

export async function loadWidgetObjectIcon(objectIconKey: string | null): Promise<string | null> {
  return loadWidgetObjectIconWithDeps(objectIconKey, widgetIconServiceDeps);
}

export function resetWidgetIconCacheForTests() {
  iconMapCache = null;
  iconMapPromise = null;
}
