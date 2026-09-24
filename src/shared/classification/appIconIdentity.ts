import { AppClassification } from "./appClassification.ts";
import { isAnonymousActivity } from "./anonymousActivity.ts";

export function resolveAppIconKeys(exeName: string): string[] {
  if (isAnonymousActivity(exeName)) return [];
  const canonicalExe = AppClassification.resolveCanonicalExecutable(exeName);
  const parent = AppClassification.resolveStatisticalApp(exeName);
  if (parent !== canonicalExe) return [parent];
  return resolveExecutableIconKeys(exeName);
}

export function resolveExecutableIconKeys(exeName: string): string[] {
  if (isAnonymousActivity(exeName)) return [];
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
