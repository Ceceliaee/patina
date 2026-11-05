import { useEffect } from "react";
import { onMainToolsTargetChanged, takeMainToolsTarget } from "../../platform/desktop/mainToolsNavigationGateway.ts";
import type { ToolsOpenTarget } from "../../features/tools/types.ts";

export function useMainToolsNavigation(open: (target: ToolsOpenTarget) => Promise<void>) {
  useEffect(() => {
    let disposed = false;
    let off: (() => void) | undefined;
    const consume = async () => {
      if (disposed) return;
      try {
        const section = await takeMainToolsTarget();
        if (section && !disposed) await open({ section });
      } catch (error) { console.warn("main tools navigation failed", error); }
    };
    // Subscribe before consuming the pending target so cold startup cannot miss it.
    void onMainToolsTargetChanged(() => { void consume(); }).then(unlisten => {
      if (disposed) { unlisten(); return; }
      off = unlisten;
      void consume();
    }).catch(error => console.warn("main tools navigation subscription failed", error));
    return () => { disposed = true; off?.(); };
  }, [open]);
}
