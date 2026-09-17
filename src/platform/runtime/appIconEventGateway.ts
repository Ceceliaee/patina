import { listen } from "@tauri-apps/api/event";
import { publishAppIconChange } from "../../shared/hooks/appIconChanges.ts";

export function installAppIconEvents(): () => void {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  const reconcile = () => {
    if (document.visibilityState === "visible") publishAppIconChange(null);
  };
  void listen<unknown>("app-icon-changed", ({ payload }) => {
    if (!disposed && typeof payload === "string" && payload.trim()) publishAppIconChange(payload);
  }).then((stop) => {
    if (disposed) { stop(); return; }
    unlisten = stop;
    reconcile();
  }).catch(console.warn);
  document.addEventListener("visibilitychange", reconcile);
  return () => {
    disposed = true;
    unlisten?.();
    document.removeEventListener("visibilitychange", reconcile);
  };
}
