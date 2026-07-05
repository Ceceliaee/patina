import { GripVertical, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UI_TEXT } from "../../../shared/copy/index";

const ALL_FIELD_KEYS = [
  "record_type",
  "exe_name",
  "app_name",
  "window_title",
  "domain",
  "normalized_domain",
  "url",
  "page_title",
  "start_time",
  "end_time",
  "duration_ms",
] as const;

interface Props {
  open: boolean;
  selectedFields: string[];
  uiText: typeof UI_TEXT;
  onClose: () => void;
  onConfirm: (fields: string[]) => void;
}

const AUTO_SCROLL_SPEED = 8;
const AUTO_SCROLL_EDGE = 30;
const DRAG_THRESHOLD = 4;

export default function ExportFieldConfigDialog({ open, selectedFields, uiText, onClose, onConfirm }: Props) {
  const t = uiText.export;
  const [fields, setFields] = useState<string[]>(() => [...selectedFields]);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const autoScrollTimer = useRef<number | null>(null);
  const dragState = useRef<{
    fromIdx: number;
    startY: number;
    pointerId: number;
    started: boolean;
  } | null>(null);
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (open) {
      setFields([...selectedFields]);
    }
  }, [open, selectedFields]);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollTimer.current !== null) {
      window.clearInterval(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
  }, []);

  const startAutoScroll = useCallback((direction: "up" | "down") => {
    stopAutoScroll();
    const container = containerRef.current;
    if (!container) return;
    autoScrollTimer.current = window.setInterval(() => {
      const el = containerRef.current;
      if (!el) return;
      if (direction === "up") {
        el.scrollTop -= AUTO_SCROLL_SPEED;
      } else {
        el.scrollTop += AUTO_SCROLL_SPEED;
      }
    }, 16);
  }, [stopAutoScroll]);

  const updateAutoScroll = useCallback((clientY: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const relativeY = clientY - rect.top;
    if (relativeY < AUTO_SCROLL_EDGE && container.scrollTop > 0) {
      startAutoScroll("up");
    } else if (relativeY > rect.height - AUTO_SCROLL_EDGE &&
      container.scrollTop < container.scrollHeight - container.clientHeight) {
      startAutoScroll("down");
    } else {
      stopAutoScroll();
    }
  }, [startAutoScroll, stopAutoScroll]);

  const getDropIndex = useCallback((clientY: number) => {
    const container = containerRef.current;
    if (!container) return null;
    let result = fields.length;
    for (let i = 0; i < fields.length; i++) {
      const key = fields[i];
      const el = itemRefs.current.get(key);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (clientY < mid) {
        result = i;
        break;
      }
    }
    return result;
  }, [fields]);

  const handleRemove = (idx: number) => {
    setFields((prev) => prev.filter((_, i) => i !== idx));
  };

  const handlePointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    dragState.current = {
      fromIdx: idx,
      startY: e.clientY,
      pointerId: e.pointerId,
      started: false,
    };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const state = dragState.current;
    if (!state || state.pointerId !== e.pointerId) return;

    if (!state.started) {
      const dy = Math.abs(e.clientY - state.startY);
      if (dy < DRAG_THRESHOLD) return;
      state.started = true;
      setDraggingIndex(state.fromIdx);
      setDragOverIndex(state.fromIdx);
    }

    const to = getDropIndex(e.clientY);
    if (to !== null) {
      setDragOverIndex(to);
    }
    updateAutoScroll(e.clientY);
  }, [getDropIndex, updateAutoScroll]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    const state = dragState.current;
    if (!state || state.pointerId !== e.pointerId) return;

    const target = e.currentTarget as HTMLElement;
    if (target.hasPointerCapture(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }

    stopAutoScroll();
    const wasStarted = state.started;
    const fromIdx = state.fromIdx;
    dragState.current = null;

    if (!wasStarted) {
      setDraggingIndex(null);
      setDragOverIndex(null);
      return;
    }

    const to = getDropIndex(e.clientY);
    setDraggingIndex(null);
    setDragOverIndex(null);

    if (to === null || fromIdx === to) return;
    const adjustedTo = fromIdx < to ? to - 1 : to;
    if (fromIdx === adjustedTo) return;

    setFields((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(adjustedTo, 0, moved);
      return next;
    });
  }, [getDropIndex, stopAutoScroll]);

  const handlePointerCancel = useCallback((e: React.PointerEvent) => {
    const state = dragState.current;
    if (!state || state.pointerId !== e.pointerId) return;

    stopAutoScroll();
    dragState.current = null;
    setDraggingIndex(null);
    setDragOverIndex(null);
  }, [stopAutoScroll]);

  const setItemRef = useCallback((key: string) => (el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(key, el);
    } else {
      itemRefs.current.delete(key);
    }
  }, []);

  const handleReset = () => {
    setFields([...ALL_FIELD_KEYS]);
  };

  const handleConfirm = () => {
    onConfirm(fields);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="qp-panel rounded-[16px] w-full max-w-lg mx-4 max-h-[80vh] flex flex-col shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-[var(--qp-border-subtle)]">
          <h2 className="text-base font-semibold text-[var(--qp-text-primary)]">{t.configFieldsTitle}</h2>
          <button type="button" onClick={onClose} className="qp-button-ghost rounded-[8px] p-1">
            <X size={16} />
          </button>
        </div>

        <p className="px-5 pt-2 pb-1 text-xs text-[var(--qp-text-tertiary)]">{t.configFieldsHint}</p>

        <div
          ref={containerRef}
          className="flex-1 overflow-y-auto custom-scrollbar px-5 py-3"
        >
          {fields.length === 0 && (
            <p className="text-xs text-[var(--qp-text-tertiary)] italic">{t.configFieldsHint}</p>
          )}
          {fields.map((key, idx) => {
            const field = (t.fields as Record<string, { label: string; desc: string }>)[key];
            if (!field) return null;
            const isDragging = draggingIndex === idx;
            const showInsertBefore = dragOverIndex === idx && draggingIndex !== null && draggingIndex !== idx;
            return (
              <div key={key} className="relative">
                <div
                  className={`absolute left-0 right-0 top-0 h-[2px] bg-[var(--qp-accent)] rounded-full z-10 pointer-events-none transition-all duration-200 ease-out ${
                    showInsertBefore
                      ? "opacity-100 scale-x-100"
                      : "opacity-0 scale-x-95"
                  }`}
                  style={{
                    transform: showInsertBefore ? "translateY(-50%) scaleX(1)" : "translateY(-50%) scaleX(0.9)",
                    boxShadow: showInsertBefore ? "0 0 12px 2px rgba(99, 102, 241, 0.35)" : "none",
                  }}
                />
                <div
                  ref={setItemRef(key)}
                  onPointerDown={(e) => handlePointerDown(e, idx)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerCancel={handlePointerCancel}
                  className={`flex items-center gap-2 rounded-[10px] border px-3 py-2 cursor-grab active:cursor-grabbing select-none transition-all duration-150 touch-none ${
                    isDragging
                      ? "bg-[var(--qp-accent)]/10 border-[var(--qp-accent)]/50 scale-[0.98] opacity-80 shadow-lg z-20 relative"
                      : "bg-[var(--qp-bg-elevated)] border-[var(--qp-border-subtle)] hover:border-[var(--qp-border-strong)]"
                  } ${idx > 0 ? "mt-1.5" : ""}`}
                  style={isDragging ? { position: "relative" } : undefined}
                >
                  <GripVertical size={14} className="shrink-0 text-[var(--qp-text-tertiary)] pointer-events-none" />
                  <div className="flex-1 min-w-0 pointer-events-none">
                    <p className="text-xs font-medium text-[var(--qp-text-primary)]">{field.label}</p>
                    <p className="text-[11px] text-[var(--qp-text-tertiary)] truncate">{field.desc}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemove(idx)}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="shrink-0 rounded-[6px] p-1 text-[var(--qp-text-tertiary)] hover:text-[var(--qp-danger)] hover:bg-[var(--qp-danger)]/10 transition-colors"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })}

          <div className="relative mt-1.5">
            <div
              className={`absolute left-0 right-0 top-0 h-[2px] bg-[var(--qp-accent)] rounded-full z-10 pointer-events-none transition-all duration-200 ease-out ${
                dragOverIndex === fields.length && draggingIndex !== null && fields.length > 0
                  ? "opacity-100"
                  : "opacity-0"
              }`}
              style={{
                transform: dragOverIndex === fields.length && draggingIndex !== null && fields.length > 0
                  ? "translateY(-50%) scaleX(1)"
                  : "translateY(-50%) scaleX(0.9)",
                boxShadow: dragOverIndex === fields.length && draggingIndex !== null && fields.length > 0
                  ? "0 0 12px 2px rgba(99, 102, 241, 0.35)"
                  : "none",
              }}
            />
          </div>

          <div className={`flex items-center gap-2 rounded-[10px] border border-dashed border-[var(--qp-border-subtle)] px-3 py-2 pointer-events-none ${fields.length > 0 ? "mt-1.5" : ""}`}>
            <div className="w-3.5 shrink-0" />
            <p className="text-xs text-[var(--qp-text-tertiary)] italic">
              <span className="opacity-50">+</span>
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between px-5 pb-5 pt-3 border-t border-[var(--qp-border-subtle)]">
          <button
            type="button"
            onClick={handleReset}
            className="qp-button-ghost rounded-[8px] px-3 py-1.5 text-xs font-semibold text-[var(--qp-text-secondary)]"
          >
            {t.configFieldsReset}
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="qp-button-secondary rounded-[8px] px-4 py-1.5 text-xs font-semibold"
            >
              {uiText.dialog.cancel}
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="qp-button-primary rounded-[8px] px-4 py-1.5 text-xs font-semibold"
            >
              {uiText.dialog.confirm}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
