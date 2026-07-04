import {
  clearDataBootstrapSnapshotPayload as clearDataBootstrapSnapshotPayloadViaCommand,
  saveDataBootstrapSnapshotPayload as saveDataBootstrapSnapshotPayloadViaCommand,
} from "./persistenceWriteRuntimeGateway.ts";
import { getDB } from "./sqlite.ts";

const DATA_BOOTSTRAP_SNAPSHOT_KEY = "data.bootstrap_snapshot";

export async function loadDataBootstrapSnapshotPayload(): Promise<string | null> {
  const db = await getDB();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = ? LIMIT 1",
    [DATA_BOOTSTRAP_SNAPSHOT_KEY],
  );

  return rows[0]?.value ?? null;
}

export async function saveDataBootstrapSnapshotPayload(payload: string): Promise<void> {
  await saveDataBootstrapSnapshotPayloadViaCommand(payload);
}

export async function clearDataBootstrapSnapshotPayload(): Promise<void> {
  await clearDataBootstrapSnapshotPayloadViaCommand();
}
