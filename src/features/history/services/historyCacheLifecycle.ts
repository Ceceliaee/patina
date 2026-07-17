import { clearHistoryBootstrapSnapshot } from "./historyBootstrapSnapshot.ts";
import { clearHistorySnapshotCache } from "./historySnapshotCache.ts";

export async function clearHistoryCachesAfterDataChange(): Promise<void> {
  clearHistorySnapshotCache();
  await clearHistoryBootstrapSnapshot();
}
