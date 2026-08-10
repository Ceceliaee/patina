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
