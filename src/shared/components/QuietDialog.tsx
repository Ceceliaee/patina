import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface QuietDialogProps {
  open: boolean;
  title: string;
  description?: string;
  actions?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  closeOnBackdrop?: boolean;
  surfaceClassName?: string;
}

export default function QuietDialog({
  open,
  title,
  description,
  actions,
  onClose,
  children,
  closeOnBackdrop = true,
  surfaceClassName,
}: QuietDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [open, onClose]);

  const dialog = open ? (
        <div
          className="qp-dialog-backdrop qp-motion-overlay-enter"
          onMouseDown={(event) => {
            if (!closeOnBackdrop) return;
            if (event.target === event.currentTarget) {
              onClose();
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`qp-dialog-surface qp-motion-overlay-enter ${surfaceClassName ?? ""}`}
          >
            <header className="qp-dialog-header">
              <h3 className="qp-dialog-title">{title}</h3>
              {description && <p className="qp-dialog-description">{description}</p>}
            </header>
            {children && <div className="qp-dialog-body">{children}</div>}
            {actions && <footer className="qp-dialog-actions">{actions}</footer>}
          </div>
        </div>
      ) : null;

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(dialog, document.body);
}
