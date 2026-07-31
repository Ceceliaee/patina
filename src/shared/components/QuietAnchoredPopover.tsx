import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export type QuietAnchoredPopoverPlacement = "top" | "bottom";

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
      anchorRect.left + (anchorRect.width - popoverRect.width) / 2,
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
}: QuietAnchoredPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const [position, setPosition] = useState<QuietAnchoredPopoverPosition | null>(
    null,
  );
  onCloseRef.current = onClose;

  const updatePosition = useCallback(() => {
    const popover = popoverRef.current;
    if (!open || !anchor?.isConnected || !popover) return;
    const next = resolvePosition(
      anchor.getBoundingClientRect(),
      popover.getBoundingClientRect(),
    );
    setPosition((current) => positionsMatch(current, next) ? current : next);
  }, [anchor, open]);

  useLayoutEffect(() => {
    if (!open || !anchor) {
      setPosition(null);
      return undefined;
    }

    setPosition(null);
    updatePosition();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updatePosition);
    observer.observe(anchor);
    if (popoverRef.current) observer.observe(popoverRef.current);
    return () => observer.disconnect();
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
    const handleResize = () => updatePosition();
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && popoverRef.current?.contains(target)) {
        return;
      }
      onCloseRef.current();
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [anchor, open, updatePosition]);

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
