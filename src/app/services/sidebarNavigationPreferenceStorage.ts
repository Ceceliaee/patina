import {
  readBrowserStorage,
  writeBrowserStorage,
} from "../../platform/browser/browserStorageGateway.ts";

export type SidebarNavigationMode = "icons" | "labeled";

const SIDEBAR_NAVIGATION_MODE_KEY = "patina:sidebar-navigation-mode";

function isSidebarNavigationMode(value: string | null): value is SidebarNavigationMode {
  return value === "icons" || value === "labeled";
}

export function readSidebarNavigationMode(): SidebarNavigationMode {
  const value = readBrowserStorage(SIDEBAR_NAVIGATION_MODE_KEY);
  return isSidebarNavigationMode(value) ? value : "icons";
}

export function rememberSidebarNavigationMode(mode: SidebarNavigationMode): void {
  writeBrowserStorage(SIDEBAR_NAVIGATION_MODE_KEY, mode);
}
