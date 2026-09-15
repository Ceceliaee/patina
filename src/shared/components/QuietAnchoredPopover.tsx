import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";

type QuietAnchoredPopoverPlacement = "top" | "bottom";

interface QuietAnchoredPopoverPosition {
  left: number;
  top: number;
  placement: QuietAnchoredPopoverPlacement;
}

interface QuietAnchoredPopoverProps {
  open: boolean;
  anchor: HTMLElement | null;
  id: string;
  ariaLabel: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  horizontalAnchorRatio?: number;
  horizontalAlign?: "start" | "center";
  initialFocusRef?: RefObject<HTMLElement | null>;
}

const POPOVER_GAP = 8;
const VIEWPORT_PADDING = 12;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function positionsMatch(
  current: QuietAnchoredPopoverPosition | null,
  next: QuietAnchoredPopoverPosition,
) {
  return current?.placement === next.placement
    && Math.abs(current.left - next.left) < 0.5
    && Math.abs(current.top - next.top) < 0.5;
}

function resolvePosition(
  anchorRect: DOMRect,
  popoverRect: DOMRect,
  horizontalAnchorRatio: number,
  horizontalAlign: "start" | "center",
): QuietAnchoredPopoverPosition {
  const availableBelow = window.innerHeight
    - anchorRect.bottom
    - POPOVER_GAP
    - VIEWPORT_PADDING;
  const availableAbove = anchorRect.top - POPOVER_GAP - VIEWPORT_PADDING;
  const placement: QuietAnchoredPopoverPlacement = (
    availableBelow < popoverRect.height && availableAbove > availableBelow
  )
    ? "top"
    : "bottom";
  const preferredTop = placement === "top"
    ? anchorRect.top - popoverRect.height - POPOVER_GAP
    : anchorRect.bottom + POPOVER_GAP;
  const maxLeft = Math.max(
    VIEWPORT_PADDING,
    window.innerWidth - popoverRect.width - VIEWPORT_PADDING,
  );
  const maxTop = Math.max(
    VIEWPORT_PADDING,
    window.innerHeight - popoverRect.height - VIEWPORT_PADDING,
  );

  return {
    left: clamp(
      anchorRect.left
        + (horizontalAlign === "start" ? 0 : anchorRect.width / 2
          - popoverRect.width * horizontalAnchorRatio),
      VIEWPORT_PADDING,
      maxLeft,
    ),
    top: clamp(preferredTop, VIEWPORT_PADDING, maxTop),
    placement,
  };
}

export default function QuietAnchoredPopover({
  open,
  anchor,
  id,
  ariaLabel,
  onClose,
  children,
  className,
  horizontalAnchorRatio = 0.5,
  horizontalAlign = "center",
  initialFocusRef,
}: QuietAnchoredPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [position, setPosition] = useState<QuietAnchoredPopoverPosition | null>(
    null,
  );
  onCloseRef.current = onClose;
  const ready = open && position !== null;
  useEffect(() => {
    if (!ready || !initialFocusRef) return;
    let frame = 0;
    const focusVisibleTarget = () => {
      const target = initialFocusRef.current;
      if (!target?.isConnected) return;
      if (getComputedStyle(target).visibility === "hidden") {
        frame = requestAnimationFrame(focusVisibleTarget);
        return;
      }
      target.focus({ preventScroll: true });
    };
    frame = requestAnimationFrame(focusVisibleTarget);
    return () => cancelAnimationFrame(frame);
  }, [ready, initialFocusRef]);

  const updatePosition = useCallback(() => {
    const popover = popoverRef.current;
    if (!open || !anchor?.isConnected || !popover) return;
    const next = resolvePosition(
      anchor.getBoundingClientRect(),
      popover.getBoundingClientRect(),
      clamp(horizontalAnchorRatio, 0, 1),
      horizontalAlign,
    );
    setPosition((current) => positionsMatch(current, next) ? current : next);
  }, [anchor, horizontalAnchorRatio, horizontalAlign, open]);

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPosition(null);
      return undefined;
    }

    setPosition(null);
    updatePosition();
    // ResizeObserver misses position-only shifts from responsive layout or transforms.
    let frame = 0;
    const trackAnchor = () => {
      updatePosition();
      frame = requestAnimationFrame(trackAnchor);
    };
    frame = requestAnimationFrame(trackAnchor);
    return () => cancelAnimationFrame(frame);
  }, [anchor, open, updatePosition]);

  useEffect(() => {
    if (!open || !anchor) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (anchor.contains(target) || popoverRef.current?.contains(target)) return;
      onCloseRef.current();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    };
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && popoverRef.current?.contains(target)) {
        return;
      }
      onCloseRef.current();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [anchor, open]);

  if (!open || !anchor || typeof document === "undefined") return null;

  const style: CSSProperties = {
    left: position?.left ?? 0,
    top: position?.top ?? 0,
    visibility: position ? "visible" : "hidden",
  };

  return createPortal(
    <div
      ref={popoverRef}
      id={id}
      role="region"
      aria-label={ariaLabel}
      data-placement={position?.placement}
      className={[
        "qp-anchored-popover",
        "qp-scroll-region",
        position ? `qp-anchored-popover-${position.placement}` : "",
        "qp-motion-popover-enter",
        className ?? "",
      ].filter(Boolean).join(" ")}
      style={style}
    >
      {children}
    </div>,
    document.body,
  );
}
