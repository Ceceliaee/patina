import { AppClassification } from "./appClassification.ts";

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
