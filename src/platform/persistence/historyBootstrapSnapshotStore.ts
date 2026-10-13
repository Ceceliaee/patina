import {
  clearHistoryBootstrapSnapshotPayload as clearHistoryBootstrapSnapshotPayloadViaCommand,
  saveHistoryBootstrapSnapshotPayload as saveHistoryBootstrapSnapshotPayloadViaCommand,
} from "./persistenceWriteRuntimeGateway.ts";
import { loadSettingValue } from "./settingsPersistence.ts";

const HISTORY_BOOTSTRAP_SNAPSHOT_KEY = "history.bootstrap_snapshot.v1";

export async function loadHistoryBootstrapSnapshotPayload(): Promise<string | null> {
  return loadSettingValue(HISTORY_BOOTSTRAP_SNAPSHOT_KEY);
}

export async function saveHistoryBootstrapSnapshotPayload(payload: string): Promise<void> {
  await saveHistoryBootstrapSnapshotPayloadViaCommand(payload);
}

export async function clearHistoryBootstrapSnapshotPayload(): Promise<void> {
  await clearHistoryBootstrapSnapshotPayloadViaCommand();
}
