import { getVersion } from "@tauri-apps/api/app";

export async function getAppVersion(): Promise<string> {
  return getVersion();
}
