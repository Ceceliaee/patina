import {
  getAppIcon,
  getCachedAppIconsForExecutables,
  loadAppIconsForExecutables,
  resolveAppIconKeys,
} from "../../../platform/persistence/appIconRuntimeCache.ts";

let classificationPresentationIcons: Record<string, string> = {};

function rememberRequestedIcon(
  icons: Record<string, string>,
  exeName: string,
  icon: string,
) {
  for (const key of resolveAppIconKeys(exeName)) {
    icons[key] = icon;
  }
}

export function getCachedClassificationIconsForExecutables(
  exeNames: string[],
): Record<string, string> {
  const icons = getCachedAppIconsForExecutables(exeNames);
  for (const exeName of exeNames) {
    const icon = getAppIcon(classificationPresentationIcons, exeName);
    if (icon) rememberRequestedIcon(icons, exeName, icon);
  }
  return icons;
}

export async function loadClassificationIconsForExecutables(
  exeNames: string[],
  deps?: Parameters<typeof loadAppIconsForExecutables>[1],
): Promise<Record<string, string>> {
  classificationPresentationIcons = await loadAppIconsForExecutables(exeNames, deps);
  return getCachedClassificationIconsForExecutables(exeNames);
}

export function resetClassificationIconPresentationCacheForTests(): void {
  classificationPresentationIcons = {};
}
