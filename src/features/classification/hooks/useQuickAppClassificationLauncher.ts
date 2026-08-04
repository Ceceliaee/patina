import { useCallback, useRef, useState } from "react";
import { preloadQuickAppClassificationEntry } from "../components/QuickAppClassificationEntry.tsx";
import {
  resolveQuickAppClassificationElementAnchor,
  type QuickAppClassificationAnchor,
  type QuickAppClassificationOpenRequest,
  type QuickAppClassificationTarget,
} from "../types.ts";

export function useQuickAppClassificationLauncher() {
  const [request, setRequest] = useState<QuickAppClassificationOpenRequest | null>(null);
  const activeRequestRef = useRef<QuickAppClassificationOpenRequest | null>(null);

  const preload = useCallback(() => {
    void preloadQuickAppClassificationEntry().catch(() => undefined);
  }, []);

  const open = useCallback((
    target: QuickAppClassificationTarget,
    anchor: QuickAppClassificationAnchor,
    returnFocusTo: HTMLElement | null,
  ) => {
    preload();
    const nextRequest = { target, anchor, returnFocusTo };
    activeRequestRef.current = nextRequest;
    setRequest(nextRequest);
  }, [preload]);

  const openAtPointer = useCallback((
    target: QuickAppClassificationTarget,
    anchor: QuickAppClassificationAnchor,
    returnFocusTo: HTMLElement | null,
  ) => {
    open(target, anchor, returnFocusTo);
  }, [open]);

  const openAtElement = useCallback((
    target: QuickAppClassificationTarget,
    element: HTMLElement,
  ) => {
    open(target, resolveQuickAppClassificationElementAnchor(element), element);
  }, [open]);

  const close = useCallback((focusTarget?: HTMLElement) => {
    const activeRequest = activeRequestRef.current;
    if (!activeRequest) return;
    activeRequestRef.current = null;
    setRequest(null);
    window.requestAnimationFrame(() => {
      const target = focusTarget?.isConnected
        ? focusTarget
        : activeRequest.returnFocusTo?.isConnected
          ? activeRequest.returnFocusTo
          : null;
      target?.focus();
    });
  }, []);

  return {
    request,
    preload,
    openAtPointer,
    openAtElement,
    close,
  };
}
