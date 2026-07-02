import {
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

interface HeatmapTooltipState {
  label: string;
}

interface HeatmapTooltipPosition {
  top: number;
  left: number;
}

interface DataHeatmapTooltipProps {
  containerRef: RefObject<HTMLDivElement | null>;
  granularity: string;
  rows: readonly unknown[];
  selectedHeatmapViewKey: string;
}

const HEATMAP_TOOLTIP_GAP = 8;
const HEATMAP_TOOLTIP_VIEWPORT_PADDING = 8;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function resolveHeatmapTooltipPosition(
  anchorRect: DOMRect,
  tooltipWidth: number,
  tooltipHeight: number,
): HeatmapTooltipPosition {
  const availableTop = anchorRect.top;
  const availableBottom = window.innerHeight - anchorRect.bottom;
  const useBottom = availableTop < tooltipHeight + HEATMAP_TOOLTIP_GAP && availableBottom > availableTop;
  const top = useBottom
    ? anchorRect.bottom + HEATMAP_TOOLTIP_GAP
    : anchorRect.top - tooltipHeight - HEATMAP_TOOLTIP_GAP;
  const left = anchorRect.left + (anchorRect.width - tooltipWidth) / 2;

  return {
    top: clamp(
      top,
      HEATMAP_TOOLTIP_VIEWPORT_PADDING,
      window.innerHeight - tooltipHeight - HEATMAP_TOOLTIP_VIEWPORT_PADDING,
    ),
    left: clamp(
      left,
      HEATMAP_TOOLTIP_VIEWPORT_PADDING,
      window.innerWidth - tooltipWidth - HEATMAP_TOOLTIP_VIEWPORT_PADDING,
    ),
  };
}

function findHeatmapTooltipAnchor(target: EventTarget | null, container: HTMLElement) {
  if (!(target instanceof Element)) return null;

  const anchor = target.closest<HTMLElement>("[data-heatmap-tooltip]");
  return anchor && container.contains(anchor) ? anchor : null;
}

export default function DataHeatmapTooltip({
  containerRef,
  granularity,
  rows,
  selectedHeatmapViewKey,
}: DataHeatmapTooltipProps) {
  const activeTooltipAnchorRef = useRef<HTMLElement | null>(null);
  const activeTooltipLabelRef = useRef<string | null>(null);
  const heatmapTooltipRef = useRef<HTMLDivElement | null>(null);
  const [heatmapTooltip, setHeatmapTooltip] = useState<HeatmapTooltipState | null>(null);
  const [heatmapTooltipPosition, setHeatmapTooltipPosition] = useState<HeatmapTooltipPosition | null>(null);

  const hideTooltip = useCallback(() => {
    activeTooltipAnchorRef.current = null;
    activeTooltipLabelRef.current = null;
    setHeatmapTooltip(null);
    setHeatmapTooltipPosition(null);
  }, []);
  const updateTooltipPosition = useCallback(() => {
    const anchor = activeTooltipAnchorRef.current;
    const tooltip = heatmapTooltipRef.current;
    if (!anchor || !tooltip) {
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    setHeatmapTooltipPosition(resolveHeatmapTooltipPosition(
      anchorRect,
      tooltipRect.width,
      tooltipRect.height,
    ));
  }, []);
  const showTooltip = useCallback((event: PointerEvent) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const anchor = findHeatmapTooltipAnchor(event.target, container);
    if (!anchor) {
      return;
    }

    const label = anchor.dataset.heatmapTooltip;
    if (!label) {
      return;
    }

    if (activeTooltipAnchorRef.current === anchor && activeTooltipLabelRef.current === label) {
      return;
    }

    activeTooltipAnchorRef.current = anchor;
    activeTooltipLabelRef.current = label;
    setHeatmapTooltip({ label });
    setHeatmapTooltipPosition(null);
  }, [containerRef]);
  const hideTooltipAfterPointerOut = useCallback((event: PointerEvent) => {
    const container = containerRef.current;
    if (container && findHeatmapTooltipAnchor(event.relatedTarget, container)) {
      return;
    }

    hideTooltip();
  }, [containerRef, hideTooltip]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return undefined;
    }

    container.addEventListener("pointerover", showTooltip);
    container.addEventListener("pointerout", hideTooltipAfterPointerOut);
    container.addEventListener("pointerdown", hideTooltip, true);
    container.addEventListener("pointerleave", hideTooltip);
    return () => {
      container.removeEventListener("pointerover", showTooltip);
      container.removeEventListener("pointerout", hideTooltipAfterPointerOut);
      container.removeEventListener("pointerdown", hideTooltip, true);
      container.removeEventListener("pointerleave", hideTooltip);
    };
  }, [containerRef, hideTooltip, hideTooltipAfterPointerOut, showTooltip]);

  useLayoutEffect(() => {
    if (!heatmapTooltip) {
      return undefined;
    }

    updateTooltipPosition();
    return undefined;
  }, [heatmapTooltip, updateTooltipPosition]);

  useEffect(() => {
    if (!heatmapTooltip) {
      return undefined;
    }

    const handleViewportChange = () => updateTooltipPosition();
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
    };
  }, [heatmapTooltip, updateTooltipPosition]);

  useEffect(() => {
    hideTooltip();
  }, [granularity, hideTooltip, rows, selectedHeatmapViewKey]);

  return heatmapTooltip && typeof document !== "undefined" && createPortal(
    <div
      ref={heatmapTooltipRef}
      role="tooltip"
      className="qp-tooltip"
      style={{
        top: heatmapTooltipPosition ? `${heatmapTooltipPosition.top}px` : 0,
        left: heatmapTooltipPosition ? `${heatmapTooltipPosition.left}px` : 0,
        visibility: heatmapTooltipPosition ? "visible" : "hidden",
      }}
    >
      {heatmapTooltip.label}
    </div>,
    document.body,
  );
}
