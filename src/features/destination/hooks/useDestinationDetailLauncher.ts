import { useCallback, useRef, useState } from "react";
import { preloadDestinationDetailDialog } from "../components/DestinationDetailDialogEntry.tsx";
import type { DestinationDetailOpenRequest } from "../types.ts";

interface OpenOptions {
  onClose?: () => void;
  returnFocusTo?: HTMLElement | null;
}

interface ActiveDetail {
  request: DestinationDetailOpenRequest;
  onClose?: () => void;
  returnFocusTo: HTMLElement | null;
}

export function useDestinationDetailLauncher() {
  const [activeDetail, setActiveDetail] = useState<ActiveDetail | null>(null);
  const activeDetailRef = useRef<ActiveDetail | null>(null);
  const preparedDetailRef = useRef<ActiveDetail | null>(null);

  const prepare = useCallback((
    request: DestinationDetailOpenRequest,
    options: OpenOptions = {},
  ) => {
    void preloadDestinationDetailDialog().catch(() => undefined);
    preparedDetailRef.current = {
      request,
      onClose: options.onClose,
      returnFocusTo: options.returnFocusTo ?? null,
    };
  }, []);

  const open = useCallback((
    request: DestinationDetailOpenRequest,
    options: OpenOptions = {},
  ) => {
    void preloadDestinationDetailDialog().catch(() => undefined);
    const detail = {
      request,
      onClose: options.onClose,
      returnFocusTo: options.returnFocusTo ?? null,
    };
    preparedDetailRef.current = detail;
    activeDetailRef.current = detail;
    setActiveDetail(detail);
  }, []);

  const openPrepared = useCallback(() => {
    const detail = preparedDetailRef.current;
    if (!detail) return false;
    activeDetailRef.current = detail;
    setActiveDetail(detail);
    return true;
  }, []);

  const close = useCallback(() => {
    const detail = activeDetailRef.current;
    if (!detail) return;
    activeDetailRef.current = null;
    preparedDetailRef.current = null;
    setActiveDetail(null);
    detail.onClose?.();
    window.requestAnimationFrame(() => {
      if (detail.returnFocusTo?.isConnected) {
        detail.returnFocusTo.focus();
      }
    });
  }, []);

  return {
    request: activeDetail?.request ?? null,
    prepare,
    open,
    openPrepared,
    close,
  };
}
