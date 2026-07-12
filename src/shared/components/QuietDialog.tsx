import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface QuietDialogProps {
  open: boolean;
  title: string;
  description?: string;
  headerAside?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  closeOnBackdrop?: boolean;
  surfaceClassName?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  initialFocus?: "first" | "surface";
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return !element.hidden
      && style.display !== "none"
      && style.visibility !== "hidden"
      && element.getClientRects().length > 0;
  });
}

export default function QuietDialog({
  open,
  title,
  description,
  headerAside,
  actions,
  onClose,
  children,
  closeOnBackdrop = true,
  surfaceClassName,
  initialFocusRef,
  initialFocus = "first",
}: QuietDialogProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const initialTarget = initialFocusRef?.current
        ?? (initialFocus === "surface" ? surface : getFocusableElements(surface)[0] ?? surface);
      initialTarget.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const surface = surfaceRef.current;
      if (!surface) return;
      const focusable = getFocusableElements(surface);
      if (focusable.length === 0) {
        event.preventDefault();
        surface.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !surface.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !surface.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      }
    };
  }, [initialFocus, initialFocusRef, open]);

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
            ref={surfaceRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className={`qp-dialog-surface qp-motion-overlay-enter ${surfaceClassName ?? ""}`}
          >
            <header className="qp-dialog-header">
            <div className="qp-dialog-heading">
              <h3 className="qp-dialog-title">{title}</h3>
              {description && <p className="qp-dialog-description">{description}</p>}
            </div>
            {headerAside ? <div className="qp-dialog-header-aside">{headerAside}</div> : null}
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
