import { subscribeAppIconChanges } from "../../../shared/hooks/appIconChanges.ts";
import {
  getCachedAppIconsForExecutables,
  loadAppIconsForExecutables,
} from "../../../platform/persistence/appIconRuntimeCache.ts";
import { resolveExecutableIconKeys } from "../../../shared/classification/appIconIdentity.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import { getIconsForExecutables } from "../../../platform/persistence/sessionReadRepository.ts";

let classificationPresentationIcons: Record<string, string> = {};
let generation = 0;
subscribeAppIconChanges(() => { generation += 1; classificationPresentationIcons = {}; });

function rememberRequestedIcon(
  icons: Record<string, string>,
  exeName: string,
  icon: string,
) {
  for (const key of resolveExecutableIconKeys(exeName)) {
    icons[key] = icon;
  }
}

export function getCachedClassificationIconsForExecutables(
  exeNames: string[],
): Record<string, string> {
  const icons = getCachedAppIconsForExecutables(exeNames);
  for (const exeName of exeNames) {
    const icon = resolveExecutableIconKeys(exeName).map((key) => classificationPresentationIcons[key]).find(Boolean);
    if (icon) rememberRequestedIcon(icons, exeName, icon);
  }
  return icons;
}

export async function loadClassificationIconsForExecutables(
  exeNames: string[],
  deps?: Parameters<typeof loadAppIconsForExecutables>[1],
): Promise<Record<string, string>> {
  const revision = generation;
  let icons = await loadAppIconsForExecutables(exeNames, deps);
  // The editor needs each executable's own icon before an unlink draft is saved.
  const members = exeNames.filter((exeName) => AppClassification.resolveStatisticalApp(exeName)
    !== AppClassification.resolveCanonicalExecutable(exeName));
  if (members.length > 0) {
    const memberIcons = await (deps?.loadIcons ?? getIconsForExecutables)(members, "executable");
    icons = { ...icons, ...memberIcons };
  }
  if (revision !== generation) return loadClassificationIconsForExecutables(exeNames, deps);
  classificationPresentationIcons = icons;
  return getCachedClassificationIconsForExecutables(exeNames);
}

export function resetClassificationIconPresentationCacheForTests(): void {
  classificationPresentationIcons = {};
}
