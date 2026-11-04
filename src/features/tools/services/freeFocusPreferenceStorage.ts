import { getBrowserLocalStorage } from "../../../platform/browser/browserStorageGateway.ts";
import type { FreeFocusSettings } from "../../../shared/types/tools.ts";

const FREE_FOCUS_REST_KEY = "patina:free-focus-rest-settings";

export function readFreeFocusRestSettings(): FreeFocusSettings {
  try {
    const { restMode, restMinutes, restRatio } = JSON.parse(getBrowserLocalStorage()?.getItem(FREE_FOCUS_REST_KEY) ?? "{}");
    if ((restMode === "fixed" || restMode === "ratio")
      && Number.isInteger(restMinutes) && restMinutes >= 1 && restMinutes <= 120
      && Number.isInteger(restRatio) && restRatio >= 1 && restRatio <= 20) {
      return { restMode, restMinutes, restRatio };
    }
  } catch {
    // Invalid saved preferences fall back to the creation defaults.
  }
  return { restMode: "fixed", restMinutes: 5, restRatio: 5 };
}

export function rememberFreeFocusRestSettings(settings: FreeFocusSettings): void {
  try {
    getBrowserLocalStorage()?.setItem(FREE_FOCUS_REST_KEY, JSON.stringify(settings));
  } catch {
    // Creation preferences are best-effort and must not block editing.
  }
}
