export function getBrowserLocalStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readBrowserStorage(key: string): string | null {
  try {
    return getBrowserLocalStorage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeBrowserStorage(key: string, value: string): boolean {
  try {
    const storage = getBrowserLocalStorage();
    if (!storage) return false;
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeBrowserStorage(key: string): boolean {
  try {
    const storage = getBrowserLocalStorage();
    if (!storage) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
