import { useCallback, useRef, useState } from "react";
import { isAnonymousActivity } from "../../../shared/classification/anonymousActivity.ts";
import { preloadQuickClassificationEntry } from "../components/QuickClassificationEntry.tsx";
import {
  resolveQuickClassificationElementAnchor,
  type QuickClassificationAnchor,
  type QuickClassificationOpenRequest,
  type QuickClassificationTarget,
} from "../types.ts";

export function useQuickClassificationLauncher() {
  const [request, setRequest] = useState<QuickClassificationOpenRequest | null>(null);
  const activeRequestRef = useRef<QuickClassificationOpenRequest | null>(null);

  const preload = useCallback(() => {
    void preloadQuickClassificationEntry().catch(() => undefined);
  }, []);

  const open = useCallback((
    target: QuickClassificationTarget,
    anchor: QuickClassificationAnchor,
    returnFocusTo: HTMLElement | null,
  ) => {
    if (target.category === "anonymous" || (target.kind === "app" && isAnonymousActivity(target.exeName))) return;
    preload();
    const nextRequest = { target, anchor, returnFocusTo };
    activeRequestRef.current = nextRequest;
    setRequest(nextRequest);
  }, [preload]);

  const openAtPointer = useCallback((
    target: QuickClassificationTarget,
    anchor: QuickClassificationAnchor,
    returnFocusTo: HTMLElement | null,
  ) => {
    open(target, anchor, returnFocusTo);
  }, [open]);

  const openAtElement = useCallback((
    target: QuickClassificationTarget,
    element: HTMLElement,
  ) => {
    open(target, resolveQuickClassificationElementAnchor(element), element);
  }, [open]);

  const close = useCallback((focusTarget?: HTMLElement) => {
    const activeRequest = activeRequestRef.current;
    if (!activeRequest) return;
    activeRequestRef.current = null;
    setRequest(null);
    const target = focusTarget?.isConnected
      ? focusTarget
      : activeRequest.returnFocusTo?.isConnected
        ? activeRequest.returnFocusTo
        : null;
    target?.focus();
  }, []);

  return {
    request,
    preload,
    openAtPointer,
    openAtElement,
    close,
  };
}
