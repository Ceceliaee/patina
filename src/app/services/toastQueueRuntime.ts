import type { QuietToastItem, QuietToastTone } from "../../shared/types/toast";

export interface ToastQueueScheduler {
  schedule: (callback: () => void, delayMs: number) => number;
  cancel: (timerId: number) => void;
}

interface ToastQueueRuntimeOptions {
  dismissAfterMs: number;
  maxVisible: number;
  scheduler: ToastQueueScheduler;
  onChange: (toasts: QuietToastItem[]) => void;
}

export interface ToastQueueRuntime {
  push: (message: string, tone: QuietToastTone) => void;
  snapshot: () => QuietToastItem[];
  dispose: () => void;
}

export function createToastQueueRuntime({
  dismissAfterMs,
  maxVisible,
  scheduler,
  onChange,
}: ToastQueueRuntimeOptions): ToastQueueRuntime {
  const visibleLimit = Math.max(1, maxVisible);
  const timerByToastId = new Map<number, number>();
  let nextToastId = 0;
  let toasts: QuietToastItem[] = [];
  let disposed = false;

  const publish = () => {
    onChange(toasts.map((toast) => ({ ...toast })));
  };

  const cancelExpiration = (toastId: number) => {
    const timerId = timerByToastId.get(toastId);
    if (timerId === undefined) return;
    scheduler.cancel(timerId);
    timerByToastId.delete(toastId);
  };

  const scheduleExpiration = (toastId: number) => {
    const timerId = scheduler.schedule(() => {
      timerByToastId.delete(toastId);
      if (disposed) return;
      const nextToasts = toasts.filter((toast) => toast.id !== toastId);
      if (nextToasts.length === toasts.length) return;
      toasts = nextToasts;
      publish();
    }, dismissAfterMs);
    timerByToastId.set(toastId, timerId);
  };

  return {
    push(message, tone) {
      if (disposed) return;

      const duplicate = toasts.find((toast) => toast.message === message && toast.tone === tone);
      if (duplicate) {
        cancelExpiration(duplicate.id);
        toasts = [...toasts.filter((toast) => toast.id !== duplicate.id), duplicate];
        scheduleExpiration(duplicate.id);
        publish();
        return;
      }

      const toast: QuietToastItem = {
        id: nextToastId,
        message,
        tone,
      };
      nextToastId += 1;
      toasts = [...toasts, toast];

      while (toasts.length > visibleLimit) {
        const removedToast = toasts.shift();
        if (removedToast) cancelExpiration(removedToast.id);
      }

      scheduleExpiration(toast.id);
      publish();
    },

    snapshot() {
      return toasts.map((toast) => ({ ...toast }));
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      timerByToastId.forEach((timerId) => scheduler.cancel(timerId));
      timerByToastId.clear();
      toasts = [];
    },
  };
}
