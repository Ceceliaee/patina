import { useCallback } from "react";
import type { View } from "../types/view";

export function useAppShellNavigation() {
  return {
    currentView: "tools" as View,
    prepareNavigate: useCallback((_nextView: View) => true, []),
    handleNavigate: useCallback(async (_nextView: View) => ({ navigated: true }), []),
  };
}
