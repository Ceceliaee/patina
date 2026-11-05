import { useSyncExternalStore } from "react";
import { getActivityDisplayTheme, subscribeActivityDisplayTheme } from "../theme/activityDisplayTheme.ts";

export function useActivityDisplayColor() {
  return useSyncExternalStore(subscribeActivityDisplayTheme, getActivityDisplayTheme, getActivityDisplayTheme);
}
