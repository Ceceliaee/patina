import {
  clearDataBootstrapSnapshotPayload as clearDataBootstrapSnapshotPayloadViaCommand,
  saveDataBootstrapSnapshotPayload as saveDataBootstrapSnapshotPayloadViaCommand,
} from "./persistenceWriteRuntimeGateway.ts";
import { loadSettingValue } from "./settingsPersistence.ts";

const DATA_BOOTSTRAP_SNAPSHOT_KEY = "data.bootstrap_snapshot";

export async function loadDataBootstrapSnapshotPayload(): Promise<string | null> {
  return loadSettingValue(DATA_BOOTSTRAP_SNAPSHOT_KEY);
}

export async function saveDataBootstrapSnapshotPayload(payload: string): Promise<void> {
  await saveDataBootstrapSnapshotPayloadViaCommand(payload);
}

export async function clearDataBootstrapSnapshotPayload(): Promise<void> {
  await clearDataBootstrapSnapshotPayloadViaCommand();
}
