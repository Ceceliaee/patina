import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

interface QuietDialogProps {
  open: boolean;
  title: ReactNode;
  description?: string;
  headerAside?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  closeOnBackdrop?: boolean;
  surfaceClassName?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const openDialogStack: symbol[] = [];

function removeDialogFromStack(dialogToken: symbol) {
  const index = openDialogStack.lastIndexOf(dialogToken);
  if (index >= 0) {
    openDialogStack.splice(index, 1);
  }
}

function getFocusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => {
    const style = window.getComputedStyle(element);
    return !element.hidden
      && element.getAttribute("aria-disabled") !== "true"
      && style.display !== "none"
      && style.visibility !== "hidden"
      && element.getClientRects().length > 0;
  });
}

function isAvailableFocusTarget(target: HTMLElement | null, surface: HTMLElement): target is HTMLElement {
  if (!target || !target.isConnected || !surface.contains(target)) return false;
  const style = window.getComputedStyle(target);
  return !target.hidden
    && target.getAttribute("aria-disabled") !== "true"
    && !(target instanceof HTMLButtonElement && target.disabled)
    && !(target instanceof HTMLInputElement && target.disabled)
    && !(target instanceof HTMLSelectElement && target.disabled)
    && !(target instanceof HTMLTextAreaElement && target.disabled)
    && style.display !== "none"
    && style.visibility !== "hidden"
    && target.getClientRects().length > 0;
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
}: QuietDialogProps) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const dialogTokenRef = useRef(Symbol("quiet-dialog"));
  const initialFocusRefRef = useRef(initialFocusRef);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  initialFocusRefRef.current = initialFocusRef;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const restoreAncestors: HTMLElement[] = [];
    let restoreAncestor = previouslyFocused?.parentElement ?? null;
    while (restoreAncestor) {
      restoreAncestors.push(restoreAncestor);
      restoreAncestor = restoreAncestor.parentElement;
    }
    const dialogToken = dialogTokenRef.current;
    removeDialogFromStack(dialogToken);
    openDialogStack.push(dialogToken);
    const frame = window.requestAnimationFrame(() => {
      const surface = surfaceRef.current;
      if (!surface) return;
      const requestedTarget = initialFocusRefRef.current?.current ?? null;
      const initialTarget = isAvailableFocusTarget(requestedTarget, surface)
        ? requestedTarget
        : headingRef.current ?? surface;
      initialTarget.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (openDialogStack[openDialogStack.length - 1] !== dialogToken) return;
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
        (headingRef.current ?? surface).focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeIndex = focusable.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && activeIndex <= 0) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeIndex < 0 || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      const wasTopmost = openDialogStack[openDialogStack.length - 1] === dialogToken;
      removeDialogFromStack(dialogToken);
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown);
      if (wasTopmost && previouslyFocused?.isConnected) {
        previouslyFocused.focus();
      } else if (wasTopmost) {
        for (const ancestor of restoreAncestors) {
          if (!ancestor.isConnected) continue;
          const fallback = getFocusableElements(ancestor)[0];
          if (fallback) {
            fallback.focus();
            break;
          }
        }
      }
    };
  }, [open]);

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
            aria-labelledby={titleId}
            tabIndex={-1}
            className={`qp-dialog-surface qp-motion-overlay-enter ${surfaceClassName ?? ""}`}
          >
            <header className="qp-dialog-header">
            <div className="qp-dialog-heading">
              <h3 ref={headingRef} id={titleId} tabIndex={-1} className="qp-dialog-title">{title}</h3>
              {description && <p className="qp-dialog-description">{description}</p>}
            </div>
            {headerAside ? <div className="qp-dialog-header-aside">{headerAside}</div> : null}
            </header>
            {children && <div className="qp-dialog-body qp-scroll-region">{children}</div>}
            {actions && <footer className="qp-dialog-actions">{actions}</footer>}
          </div>
        </div>
      ) : null;

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(dialog, document.body);
}
