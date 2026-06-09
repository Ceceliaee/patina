import type { View } from "../types/view";

const LAST_ACTIVE_VIEW_KEY = "patina:last-active-view";
const LEGACY_LAST_ACTIVE_VIEW_KEY = "time-tracker:last-active-view";
const PENDING_UPDATE_RELAUNCH_VIEW_KEY = "patina:pending-update-relaunch-view";
const LEGACY_PENDING_UPDATE_RELAUNCH_VIEW_KEY = "time-tracker:pending-update-relaunch-view";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function isView(value: string | null): value is View {
  return value === "dashboard"
    || value === "history"
    || value === "data"
    || value === "mapping"
    || value === "tools"
    || value === "settings"
    || value === "about";
}

function migrateLegacyStorageValue(storage: Storage, key: string, legacyKey: string): string | null {
  const value = storage.getItem(key);
  if (value !== null) return value;

  const legacyValue = storage.getItem(legacyKey);
  if (legacyValue === null) return null;

  storage.setItem(key, legacyValue);
  storage.removeItem(legacyKey);
  return legacyValue;
}

export function rememberLastActiveView(view: View) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(LAST_ACTIVE_VIEW_KEY, view);
  storage.removeItem(LEGACY_LAST_ACTIVE_VIEW_KEY);
}

export function markPendingUpdateRelaunchViewRestore() {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(PENDING_UPDATE_RELAUNCH_VIEW_KEY, "1");
  storage.removeItem(LEGACY_PENDING_UPDATE_RELAUNCH_VIEW_KEY);
}

export function clearPendingUpdateRelaunchViewRestore() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(PENDING_UPDATE_RELAUNCH_VIEW_KEY);
  storage.removeItem(LEGACY_PENDING_UPDATE_RELAUNCH_VIEW_KEY);
}

export function consumePendingUpdateRelaunchView(): View | null {
  const storage = getStorage();
  if (!storage) return null;

  const pendingValue = migrateLegacyStorageValue(
    storage,
    PENDING_UPDATE_RELAUNCH_VIEW_KEY,
    LEGACY_PENDING_UPDATE_RELAUNCH_VIEW_KEY,
  );

  if (pendingValue !== "1") {
    return null;
  }

  storage.removeItem(PENDING_UPDATE_RELAUNCH_VIEW_KEY);
  const storedView = migrateLegacyStorageValue(storage, LAST_ACTIVE_VIEW_KEY, LEGACY_LAST_ACTIVE_VIEW_KEY);
  return isView(storedView) ? storedView : null;
}
