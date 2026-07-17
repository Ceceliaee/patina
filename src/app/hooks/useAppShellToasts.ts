import { useCallback, useEffect, useRef, useState } from "react";
import type { QuietToastItem, QuietToastTone } from "../../shared/types/toast";
import {
  createToastQueueRuntime,
  type ToastQueueRuntime,
} from "../services/toastQueueRuntime";

const TOAST_AUTO_DISMISS_MS = 3200;
const TOAST_MAX_VISIBLE = 3;

export function useAppShellToasts() {
  const [toasts, setToasts] = useState<QuietToastItem[]>([]);
  const runtimeRef = useRef<ToastQueueRuntime | null>(null);

  const pushToast = useCallback((message: string, tone: QuietToastTone = "info") => {
    runtimeRef.current?.push(message, tone);
  }, []);

  useEffect(() => {
    const runtime = createToastQueueRuntime({
      dismissAfterMs: TOAST_AUTO_DISMISS_MS,
      maxVisible: TOAST_MAX_VISIBLE,
      scheduler: {
        schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
        cancel: (timerId) => window.clearTimeout(timerId),
      },
      onChange: setToasts,
    });
    runtimeRef.current = runtime;

    return () => {
      if (runtimeRef.current === runtime) runtimeRef.current = null;
      runtime.dispose();
    };
  }, []);

  return {
    toasts,
    pushToast,
  };
}
