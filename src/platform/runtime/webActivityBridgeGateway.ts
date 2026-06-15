import { invoke } from "@tauri-apps/api/core";

const GET_WEB_ACTIVITY_BRIDGE_SNAPSHOT_COMMAND = "cmd_get_web_activity_bridge_snapshot";

export interface WebActivityBridgeSnapshot {
  enabled: boolean;
  connected: boolean;
  browserClientId: string | null;
  browserKind: string | null;
  extensionVersion: string | null;
  lastActivityAtMs: number | null;
}

export async function getWebActivityBridgeSnapshot(): Promise<WebActivityBridgeSnapshot> {
  return invoke<WebActivityBridgeSnapshot>(GET_WEB_ACTIVITY_BRIDGE_SNAPSHOT_COMMAND);
}
