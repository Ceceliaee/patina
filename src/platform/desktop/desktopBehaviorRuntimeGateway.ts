import { invoke } from "@tauri-apps/api/core";

export async function setDesktopBehavior(): Promise<void> {
  await invoke("cmd_set_desktop_behavior");
}

export async function setLaunchBehavior(
  launchAtLogin: boolean,
  startMinimized: boolean,
): Promise<void> {
  await invoke("cmd_set_launch_behavior", { launchAtLogin, startMinimized });
}
