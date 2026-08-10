type DataHeavyCacheOwner =
  | "heatmap-read-model"
  | "trend-snapshot"
  | "web-activity-snapshot";

const heavyCacheClearers = new Map<DataHeavyCacheOwner, () => void>();

export function registerDataHeavyCacheClearer(
  owner: DataHeavyCacheOwner,
  clear: () => void,
): void {
  heavyCacheClearers.set(owner, clear);
}

export function clearDataHeavyCaches(): void {
  for (const clear of heavyCacheClearers.values()) {
    clear();
  }
}

export function clearDataBootstrapCache(): Promise<void> {
  return import("./dataBootstrapSnapshot.ts")
    .then(({ clearDataBootstrapSnapshot }) => clearDataBootstrapSnapshot());
}
