import { useLayoutEffect, type RefObject } from "react";
import type { MiniAction, MiniSnapshot } from "../../platform/desktop/miniWindowRuntimeGateway.ts";

export function useMiniTransition(snapshot: MiniSnapshot | null, panel: RefObject<HTMLDivElement | null>, handle: RefObject<HTMLButtonElement | null>, act: (action: MiniAction) => Promise<void>) {
  const epoch = snapshot?.epoch;
  const id = snapshot?.transitionId;
  const pending = snapshot?.transitioning;
  useLayoutEffect(() => {
    if (!pending || id === undefined || !panel.current || !handle.current) return;
    let cancelled = false;
    // Reading animations flushes the committed target styles. CSS reverses an
    // interrupted transition from its current value, including reduced motion.
    const animations = [...panel.current.getAnimations({ subtree: true }), ...handle.current.getAnimations()];
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (!cancelled) void act({ kind: "transition_complete", transition_id: id });
    });
    return () => { cancelled = true; };
  }, [epoch, id, pending, panel, handle, act]);
}
