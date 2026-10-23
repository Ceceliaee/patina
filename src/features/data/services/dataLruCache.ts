import type { AggregateSessionRecord } from "../../../platform/persistence/sessionReadRepository.ts";

// UTF-16 text plus two numeric timestamps; excludes JS object/Map overhead.
export function estimateDataSessionPayloadBytes(sessions: AggregateSessionRecord[]): number {
  return sessions.reduce((bytes, session) => bytes + 16 + 2 * (session.appName.length + session.exeName.length), 0);
}

export function touchBoundedDataCacheEntry<Key, Value>(
  cache: Map<Key, Value>,
  key: Key,
  value: Value,
  limit: number,
): void {
  cache.delete(key);
  cache.set(key, value);

  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}
