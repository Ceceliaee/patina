import { createPortal } from "react-dom";
import type { QuietToastItem } from "../types/toast";
import QuietToast from "./QuietToast";

interface Props {
  toasts: QuietToastItem[];
}

export default function QuietToastStack({ toasts }: Props) {
  const content = (
    <div
      className="pointer-events-none fixed right-4 top-4 md:right-6 md:top-6 z-[80] flex w-[320px] max-w-[calc(100vw-2rem)] flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="qp-toast-entry">
          <QuietToast message={toast.message} tone={toast.tone} />
        </div>
      ))}
    </div>
  );

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(content, document.body);
}
