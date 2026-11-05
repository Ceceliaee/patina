import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export async function takeMainToolsTarget(): Promise<"pomodoro" | "reminders" | null> {
  const target = await invoke<unknown>("cmd_take_main_tools_target");
  if (target === null || target === "pomodoro" || target === "reminders") return target;
  throw new Error("Invalid main tools target");
}

export function onMainToolsTargetChanged(handler: () => void) {
  return listen("main-tools-target-changed", handler);
}
