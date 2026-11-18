import { getBrowserLocalStorage } from "../../../platform/browser/browserStorageGateway.ts";

export type MappingObjectMode = "app" | "web";
export type ClassificationAppSort = "default" | "recent" | "filename";

const CLASSIFICATION_OBJECT_MODE_KEY = "patina:classification-object-mode";
const CLASSIFICATION_APP_SORT_KEY = "patina:classification-app-sort";

export function readClassificationAppSort(): ClassificationAppSort {
  try {
    const value = getBrowserLocalStorage()?.getItem(CLASSIFICATION_APP_SORT_KEY);
    return value === "recent" || value === "filename" ? value : "default";
  } catch {
    return "default";
  }
}

export function rememberClassificationAppSort(sort: ClassificationAppSort) {
  try {
    getBrowserLocalStorage()?.setItem(CLASSIFICATION_APP_SORT_KEY, sort);
  } catch {
    // View preferences are best-effort.
  }
}

function isMappingObjectMode(value: string | null): value is MappingObjectMode {
  return value === "app" || value === "web";
}

export function readClassificationObjectMode(): MappingObjectMode {
  const storage = getBrowserLocalStorage();
  if (!storage) return "app";

  try {
    const value = storage.getItem(CLASSIFICATION_OBJECT_MODE_KEY);
    return isMappingObjectMode(value) ? value : "app";
  } catch {
    return "app";
  }
}

export function rememberClassificationObjectMode(mode: MappingObjectMode) {
  const storage = getBrowserLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(CLASSIFICATION_OBJECT_MODE_KEY, mode);
  } catch {
    // Classification layout preferences are best-effort; never block the interaction.
  }
}
