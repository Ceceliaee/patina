import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type QuietTooltipPlacement = "top" | "right" | "bottom" | "left";

interface Props {
  children: ReactNode;
  label?: ReactNode | null;
  placement?: QuietTooltipPlacement;
  disabled?: boolean;
  className?: string;
  tooltipClassName?: string;
}

interface TooltipPosition {
  top: number;
  left: number;
}

const TOOLTIP_GAP = 8;
const VIEWPORT_PADDING = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolvePlacement(
  anchorRect: DOMRect,
  tooltipWidth: number,
  tooltipHeight: number,
  preferredPlacement: QuietTooltipPlacement,
) {
  const availableTop = anchorRect.top;
  const availableRight = window.innerWidth - anchorRect.right;
  const availableBottom = window.innerHeight - anchorRect.bottom;
  const availableLeft = anchorRect.left;

  if (preferredPlacement === "top" && availableTop < tooltipHeight + TOOLTIP_GAP && availableBottom > availableTop) {
    return "bottom";
  }

  if (
    preferredPlacement === "bottom"
    && availableBottom < tooltipHeight + TOOLTIP_GAP
    && availableTop > availableBottom
  ) {
    return "top";
  }

  if (preferredPlacement === "right" && availableRight < tooltipWidth + TOOLTIP_GAP && availableLeft > availableRight) {
    return "left";
  }

  if (preferredPlacement === "left" && availableLeft < tooltipWidth + TOOLTIP_GAP && availableRight > availableLeft) {
    return "right";
  }

  return preferredPlacement;
}

function resolvePosition(
  anchorRect: DOMRect,
  tooltipWidth: number,
  tooltipHeight: number,
  placement: QuietTooltipPlacement,
): TooltipPosition {
  const resolvedPlacement = resolvePlacement(anchorRect, tooltipWidth, tooltipHeight, placement);
  let top = anchorRect.top + (anchorRect.height - tooltipHeight) / 2;
  let left = anchorRect.left + (anchorRect.width - tooltipWidth) / 2;

  if (resolvedPlacement === "top") {
    top = anchorRect.top - tooltipHeight - TOOLTIP_GAP;
  } else if (resolvedPlacement === "right") {
    left = anchorRect.right + TOOLTIP_GAP;
  } else if (resolvedPlacement === "bottom") {
    top = anchorRect.bottom + TOOLTIP_GAP;
  } else {
    left = anchorRect.left - tooltipWidth - TOOLTIP_GAP;
  }

  return {
    top: clamp(top, VIEWPORT_PADDING, window.innerHeight - tooltipHeight - VIEWPORT_PADDING),
    left: clamp(left, VIEWPORT_PADDING, window.innerWidth - tooltipWidth - VIEWPORT_PADDING),
  };
}

export default function QuietTooltip({
  children,
  label,
  placement = "top",
  disabled = false,
  className,
  tooltipClassName,
}: Props) {
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const canShow = Boolean(label) && !disabled;

  const hideTooltip = useCallback(() => {
    setVisible(false);
    setPosition(null);
  }, []);

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    setPosition(resolvePosition(anchorRect, tooltipRect.width, tooltipRect.height, placement));
  }, [placement]);

  useLayoutEffect(() => {
    if (!visible || !canShow) {
      return undefined;
    }

    updatePosition();
    return undefined;
  }, [canShow, updatePosition, visible]);

  useEffect(() => {
    if (!visible || !canShow) {
      return undefined;
    }

    const handleViewportChange = () => updatePosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [canShow, updatePosition, visible]);

  const showTooltip = () => {
    if (canShow) {
      setVisible(true);
    }
  };

  return (
    <>
      <span
        ref={anchorRef}
        className={`qp-tooltip-anchor ${className ?? ""}`.trim()}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onMouseDown={hideTooltip}
      >
        {children}
      </span>

      {visible && canShow && typeof document !== "undefined" && createPortal(
        <div
          ref={tooltipRef}
          role="tooltip"
          className={`qp-tooltip ${tooltipClassName ?? ""}`.trim()}
          style={{
            top: position ? `${position.top}px` : 0,
            left: position ? `${position.left}px` : 0,
            visibility: position ? "visible" : "hidden",
          }}
        >
          {label}
        </div>,
        document.body,
      )}
    </>
  );
}
