import { useCallback, useEffect, useRef, useState } from "react";
import { getMiniSnapshot, onMiniSnapshot, sendMiniAction, type MiniAction, type MiniSnapshot } from "../../platform/desktop/miniWindowRuntimeGateway.ts";

export function useMiniWindow() {
  const [snapshot, setSnapshot] = useState<MiniSnapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const current = useRef<MiniSnapshot | null>(null);
  const mounted = useRef(false);
  const accept = useCallback((next: MiniSnapshot) => {
    if (!mounted.current) return;
    const previous = current.current;
    if (previous && (next.epoch < previous.epoch || (next.epoch === previous.epoch && next.revision < previous.revision))) return;
    current.current = next;
    setSnapshot(next);
  }, []);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    void (async () => {
      const off = await onMiniSnapshot(accept);
      if (cancelled) { off(); return; }
      unlisten = off;
      accept(await getMiniSnapshot());
    })().catch((error: unknown) => { if (!cancelled) setFailed(true); console.warn("mini:init", error); });
    return () => { cancelled = true; mounted.current = false; unlisten?.(); };
  }, [accept]);
  const act = useCallback(async (action: MiniAction) => {
    const state = current.current;
    if (!state) return;
    try {
      accept(await sendMiniAction(state.epoch, action));
      if (mounted.current) setFailed(false);
    } catch (error) {
      try { accept(await getMiniSnapshot()); } catch { /* Keep the last confirmed state if the window is unavailable. */ }
      if (mounted.current) setFailed(true);
      console.warn("mini:action", error);
    }
  }, [accept]);
  return { snapshot, failed, act };
}
