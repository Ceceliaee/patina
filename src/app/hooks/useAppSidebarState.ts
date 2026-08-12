import { useCallback, useState } from "react";
import type { AppSidebarProps } from "../components/AppSidebar.tsx";
import {
  readSidebarNavigationMode,
  rememberSidebarNavigationMode,
} from "../services/sidebarNavigationPreferenceStorage.ts";

type SidebarStateOptions = Omit<
  AppSidebarProps,
  "navigationMode" | "onNavigationModeToggle"
>;

export function useAppSidebarState(options: SidebarStateOptions) {
  const [navigationMode, setNavigationMode] = useState(readSidebarNavigationMode);
  const onNavigationModeToggle = useCallback(() => {
    setNavigationMode((current) => {
      const next = current === "labeled" ? "icons" : "labeled";
      rememberSidebarNavigationMode(next);
      return next;
    });
  }, []);

  return {
    navigationMode,
    sidebarProps: {
      ...options,
      navigationMode,
      onNavigationModeToggle,
    } satisfies AppSidebarProps,
  };
}
