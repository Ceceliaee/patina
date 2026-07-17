import type { ReactNode } from "react";
import { AlertCircle, CheckCircle2, CircleX, Info } from "lucide-react";
import type { QuietToastTone } from "../types/toast";

interface Props {
  message: string;
  tone: QuietToastTone;
}

function resolveToastTone(tone: QuietToastTone): { icon: ReactNode; className: string } {
  if (tone === "success") {
    return {
      icon: <CheckCircle2 size={14} className="text-[var(--qp-success)]" />,
      className: "qp-toast-success",
    };
  }

  if (tone === "warning") {
    return {
      icon: <AlertCircle size={14} className="text-[var(--qp-warning)]" />,
      className: "qp-toast-warning",
    };
  }

  if (tone === "error") {
    return {
      icon: <CircleX size={14} className="text-[var(--qp-danger)]" />,
      className: "qp-toast-error",
    };
  }

  return {
    icon: <Info size={14} className="text-[var(--qp-accent-default)]" />,
    className: "qp-toast-info",
  };
}

export default function QuietToast({ message, tone }: Props) {
  const toneMeta = resolveToastTone(tone);
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      aria-atomic="true"
      className={`qp-toast ${toneMeta.className}`}
    >
      <div className="qp-toast-content">
        <span className="qp-toast-icon">{toneMeta.icon}</span>
        <span className="qp-toast-message">{message}</span>
      </div>
    </div>
  );
}
