import { clearDataBootstrapSnapshot } from "./dataBootstrapSnapshot.ts";
import { clearDataReadModelCache } from "./dataReadModel.ts";
import { clearDataTrendSnapshotCache } from "./dataTrendSnapshot.ts";
import { clearDataWebActivitySnapshotCache } from "./dataWebActivityReadModel.ts";

export function clearDataHeavyCaches(): void {
  clearDataReadModelCache();
  clearDataTrendSnapshotCache();
  clearDataWebActivitySnapshotCache();
}

export function clearDataBootstrapCache(): Promise<void> {
  return clearDataBootstrapSnapshot();
}
