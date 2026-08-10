import { getBrowserLocalStorage } from "../../../platform/browser/browserStorageGateway.ts";

export type MappingObjectMode = "app" | "web";

const CLASSIFICATION_OBJECT_MODE_KEY = "patina:classification-object-mode";

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
