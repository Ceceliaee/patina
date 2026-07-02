import type { DataAppOption } from "./dataReadModel.ts";

function getDataAppOptionDisplayKey(app: DataAppOption) {
  return `${app.appName.trim().toLowerCase().replace(/\s+/g, " ")}|${app.exeName.trim().toLowerCase()}`;
}

export function dedupeDataAppOptions(options: DataAppOption[]) {
  const merged = new Map<string, DataAppOption>();

  for (const app of options) {
    const key = getDataAppOptionDisplayKey(app);
    const existing = merged.get(key);

    if (!existing) {
      merged.set(key, { ...app });
      continue;
    }

    existing.totalDuration += app.totalDuration;
    existing.percentage += app.percentage;
    existing.averageDuration += app.averageDuration;
    existing.activeDayCount = Math.max(existing.activeDayCount, app.activeDayCount);
  }

  return Array.from(merged.values()).sort((left, right) => right.totalDuration - left.totalDuration);
}

export function filterDataAppOptionsForQuery(options: DataAppOption[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return options;

  return options.filter((app) => (
    app.appName.toLowerCase().includes(normalizedQuery)
    || app.exeName.toLowerCase().includes(normalizedQuery)
  ));
}

interface ResolveDataAppSearchSelectionArgs {
  wasSearching: boolean;
  isSearching: boolean;
  selectedAppKey: string | null;
  selectedApp: DataAppOption | null | undefined;
  filteredOptions: DataAppOption[];
}

export function resolveDataAppSearchSelection({
  wasSearching,
  isSearching,
  selectedAppKey,
  selectedApp,
  filteredOptions,
}: ResolveDataAppSearchSelectionArgs): string | null | undefined {
  if (wasSearching && !isSearching) {
    return null;
  }

  if (!isSearching) {
    return undefined;
  }

  const selectedKey = selectedApp?.appKey ?? selectedAppKey;
  const selectedAppKeyIsVisible = Boolean(
    selectedKey && filteredOptions.some((app) => app.appKey === selectedKey),
  );

  if (selectedAppKeyIsVisible) {
    return undefined;
  }

  return filteredOptions[0]?.appKey;
}
