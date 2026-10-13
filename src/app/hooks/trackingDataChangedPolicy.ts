const DATA_CACHE_INVALIDATION_REASONS = new Set([
  "backup-restored",
  "external-data-imported",
  "external-import-deleted",
]);

export function shouldInvalidateDataCaches(reason: string): boolean {
  return DATA_CACHE_INVALIDATION_REASONS.has(reason);
}
