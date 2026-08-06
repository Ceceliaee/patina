import { useLocaleText } from "../i18n/index.ts";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { Pipette } from "lucide-react";
import QuietTooltip from "./QuietTooltip";
import {
  hexToHsl,
  hexToRgb,
  hslToHex,
  rgbToHex,
  type ColorDisplayFormat,
  type HslColor,
  type RgbColor,
} from "../lib/colorFormatting";
import QuietSegmentedFilter, {
  type QuietSegmentedFilterOption,
} from "./QuietSegmentedFilter.tsx";

interface Props {
  color: string;
  format: ColorDisplayFormat;
  disabled?: boolean;
  title?: string;
  fixedValueSlot?: boolean;
  onChange: (nextColor: string) => void;
  onFormatChange: (nextFormat: ColorDisplayFormat) => void;
}

interface PopoverPosition {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

const FORMAT_LIST: ColorDisplayFormat[] = ["hex", "rgb", "hsl"];
const POPOVER_GAP = 8;
const VIEWPORT_PADDING = 8;
const DEFAULT_POPOVER_WIDTH = 288;
const DEFAULT_POPOVER_HEIGHT = 340;
const FORMAT_OPTIONS: QuietSegmentedFilterOption<ColorDisplayFormat>[] = FORMAT_LIST.map((value) => ({
  value,
  label: value.toUpperCase(),
}));

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeHex(input: string): string {
  const trimmed = input.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(trimmed)) return trimmed;
  if (/^[0-9A-F]{6}$/.test(trimmed)) return `#${trimmed}`;
  return "#000000";
}

function toHexDraft(input: string): string {
  const value = input.toUpperCase().replace(/[^#0-9A-F]/g, "");
  const noHash = value.replace(/#/g, "");
  return `#${noHash.slice(0, 6)}`;
}

function isCompleteHex(value: string): boolean {
  return /^#[0-9A-F]{6}$/.test(value);
}

function parseRgbField(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return clamp(parsed, 0, 255);
}

function parseHslField(value: string, fallback: number, max: number): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return clamp(parsed, 0, max);
}

export default function QuietColorField({
  color,
  format,
  disabled = false,
  title,
  fixedValueSlot = false,
  onChange,
  onFormatChange,
}: Props) {
  const UI_TEXT = useLocaleText();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  const svAreaRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<PopoverPosition>({ top: 0, left: 0, placement: "bottom" });
  const normalizedColor = useMemo(() => normalizeHex(color), [color]);
  const hsl = useMemo(() => hexToHsl(normalizedColor), [normalizedColor]);
  const rgb = useMemo(() => hexToRgb(normalizedColor), [normalizedColor]);
  const [hue, setHue] = useState(hsl.h);
  const [hexDraft, setHexDraft] = useState(normalizedColor);
  const formatPanelId = useId();
  const titleId = useId();

  useEffect(() => {
    setHexDraft(normalizedColor);
  }, [normalizedColor]);

  useEffect(() => {
    if (hsl.s > 0) setHue(hsl.h);
  }, [hsl.h, hsl.s]);

  const resolvePopoverPosition = useCallback((measuredHeight?: number, measuredWidth?: number): PopoverPosition | null => {
    const trigger = triggerRef.current;
    if (!trigger) return null;
    const rect = trigger.getBoundingClientRect();
    const width = measuredWidth ?? popoverRef.current?.offsetWidth ?? DEFAULT_POPOVER_WIDTH;
    const height = measuredHeight ?? popoverRef.current?.offsetHeight ?? DEFAULT_POPOVER_HEIGHT;

    const left = clamp(
      rect.left,
      VIEWPORT_PADDING,
      window.innerWidth - width - VIEWPORT_PADDING,
    );

    const belowTop = rect.bottom + POPOVER_GAP;
    const aboveTop = rect.top - height - POPOVER_GAP;
    const spaceBelow = window.innerHeight - belowTop - VIEWPORT_PADDING;
    const spaceAbove = rect.top - POPOVER_GAP - VIEWPORT_PADDING;

    const shouldFlip = spaceBelow < height && spaceAbove > spaceBelow;
    const preferredTop = shouldFlip ? aboveTop : belowTop;
    const boundedTop = clamp(
      preferredTop,
      VIEWPORT_PADDING,
      window.innerHeight - height - VIEWPORT_PADDING,
    );

    return {
      top: boundedTop,
      left,
      placement: shouldFlip ? "top" : "bottom",
    };
  }, []);

  const updatePopoverPosition = useCallback((measuredHeight?: number, measuredWidth?: number) => {
    const nextPosition = resolvePopoverPosition(measuredHeight, measuredWidth);
    if (!nextPosition) return;
    setPosition((current) => {
      if (
        Math.abs(current.top - nextPosition.top) < 1
        && Math.abs(current.left - nextPosition.left) < 1
        && current.placement === nextPosition.placement
      ) {
        return current;
      }
      return nextPosition;
    });
  }, [resolvePopoverPosition]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    updatePopoverPosition(
      popoverRef.current?.offsetHeight,
      popoverRef.current?.offsetWidth,
    );
    return undefined;
  }, [format, open, updatePopoverPosition]);

  useEffect(() => {
    if (!open) return undefined;
    const handleViewport = () => {
      updatePopoverPosition(
        popoverRef.current?.offsetHeight,
        popoverRef.current?.offsetWidth,
      );
    };
    window.addEventListener("resize", handleViewport);
    window.addEventListener("scroll", handleViewport, true);
    return () => {
      window.removeEventListener("resize", handleViewport);
      window.removeEventListener("scroll", handleViewport, true);
    };
  }, [open, updatePopoverPosition]);

  useEffect(() => {
    if (!open) return undefined;
    const frame = window.requestAnimationFrame(() => titleRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        window.requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const applyHsl = (next: Partial<HslColor>) => {
    const nextHsl: HslColor = {
      h: next.h ?? hue,
      s: next.s ?? hsl.s,
      l: next.l ?? hsl.l,
    };
    if (next.h !== undefined) setHue(next.h);
    onChange(hslToHex(nextHsl));
  };

  const applySvFromPointer = (clientX: number, clientY: number) => {
    const area = svAreaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    const y = clamp(clientY - rect.top, 0, rect.height);
    const s = Math.round((x / rect.width) * 100);
    const l = Math.round(100 - (y / rect.height) * 100);
    applyHsl({ s, l });
  };

  const handleSvPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    applySvFromPointer(event.clientX, event.clientY);
    const onMove = (moveEvent: PointerEvent) => applySvFromPointer(moveEvent.clientX, moveEvent.clientY);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onHexDraftChange = (value: string) => {
    const next = toHexDraft(value);
    setHexDraft(next);
    if (isCompleteHex(next)) onChange(next);
  };

  const onHexDraftBlur = () => {
    if (isCompleteHex(hexDraft)) {
      onChange(normalizeHex(hexDraft));
      return;
    }
    setHexDraft(normalizedColor);
  };

  const onRgbInput = (channel: keyof RgbColor, value: string) => {
    const next: RgbColor = { ...rgb, [channel]: parseRgbField(value, rgb[channel]) };
    onChange(rgbToHex(next));
  };

  const onHslInput = (channel: keyof HslColor, value: string) => {
    const max = channel === "h" ? 360 : 100;
    const next: HslColor = { ...hsl, [channel]: parseHslField(value, hsl[channel], max) };
    if (channel === "h") setHue(next.h);
    onChange(hslToHex(next));
  };

  const pickByEyedropper = async () => {
    const EyeDropperCtor = (
      window as Window & {
        EyeDropper?: { new (): { open: () => Promise<{ sRGBHex: string }> } };
      }
    ).EyeDropper;
    if (!EyeDropperCtor) return;
    try {
      const instance = new EyeDropperCtor();
      const result = await instance.open();
      onChange(normalizeHex(result.sRGBHex));
    } catch {
      // User canceled eyedropper.
    }
  };

  const supportsEyedropper = typeof window !== "undefined" && "EyeDropper" in window;
  const triggerButton = (
    <button
      ref={triggerRef}
      type="button"
      disabled={disabled}
      aria-label={title ?? UI_TEXT.accessibility.color.color}
      onClick={() => {
        if (disabled) return;
        setOpen((previousOpen) => {
          if (previousOpen) {
            return false;
          }
          const initialPosition = resolvePopoverPosition(DEFAULT_POPOVER_HEIGHT, DEFAULT_POPOVER_WIDTH);
          if (initialPosition) {
            setPosition(initialPosition);
          }
          return true;
        });
      }}
      className={`qp-color-trigger ${fixedValueSlot ? "qp-color-trigger-fixed-slot" : ""}`}
    >
      <span className="qp-color-trigger-swatch" style={{ backgroundColor: normalizedColor }} aria-hidden />
      <span className="qp-color-trigger-value">{normalizedColor}</span>
    </button>
  );
  const eyedropperLabel = supportsEyedropper
    ? UI_TEXT.accessibility.color.eyedropper
    : UI_TEXT.accessibility.color.eyedropperUnsupported;

  return (
    <>
      {title ? (
        <QuietTooltip label={title}>
          {triggerButton}
        </QuietTooltip>
      ) : triggerButton}

      {open && !disabled && createPortal(
        <div
          ref={popoverRef}
          className={`qp-color-popover ${position.placement === "top" ? "qp-color-popover-top" : "qp-color-popover-bottom"}`}
          role="dialog"
          aria-labelledby={titleId}
          style={{ top: `${position.top}px`, left: `${position.left}px` }}
        >
          <div className="qp-color-popover-head">
            <div
              ref={titleRef}
              id={titleId}
              tabIndex={-1}
              className="qp-color-popover-title"
            >
              {UI_TEXT.accessibility.color.color}
            </div>
            <QuietTooltip label={eyedropperLabel}>
              <button
                type="button"
                className="qp-color-eyedropper"
                aria-label={eyedropperLabel}
                onClick={() => void pickByEyedropper()}
                disabled={!supportsEyedropper}
              >
                <Pipette size={14} />
              </button>
            </QuietTooltip>
          </div>

          <div
            ref={svAreaRef}
            className="qp-color-sv-area"
            onPointerDown={handleSvPointerDown}
            style={{ "--qp-hue": `${hue}` } as CSSProperties}
          >
            <span
              className="qp-color-sv-thumb"
              style={{ left: `${hsl.s}%`, top: `${100 - hsl.l}%` }}
              aria-hidden
            />
          </div>

          <div className="qp-color-control-row">
            <QuietSegmentedFilter
              value={format}
              options={FORMAT_OPTIONS}
              onChange={onFormatChange}
              semantics="tabs"
              ariaLabel={UI_TEXT.accessibility.color.colorFormat}
              tabIdPrefix={`${formatPanelId}-tab`}
              tabPanelId={formatPanelId}
              className="qp-color-format-switch"
            />
            <input
              type="range"
              min={0}
              max={359}
              step={1}
              value={hue}
              aria-label={UI_TEXT.accessibility.color.hueSlider}
              className="qp-color-hue-slider"
              style={{ "--qp-hue": `${hue}` } as CSSProperties}
              onChange={(event) => applyHsl({ h: Number(event.target.value) })}
            />
          </div>

          {format === "hex" && (
            <div
              id={formatPanelId}
              role="tabpanel"
              aria-labelledby={`${formatPanelId}-tab-hex`}
              className="qp-color-input-row"
            >
              <span className="qp-color-row-label">HEX</span>
              <input
                aria-label={UI_TEXT.accessibility.color.hexValue}
                value={hexDraft}
                onChange={(event) => onHexDraftChange(event.target.value)}
                onBlur={onHexDraftBlur}
                className="qp-input qp-color-text-input"
              />
            </div>
          )}

          {format === "rgb" && (
            <div
              id={formatPanelId}
              role="tabpanel"
              aria-labelledby={`${formatPanelId}-tab-rgb`}
              className="qp-color-triplet-row"
            >
              <span className="qp-color-row-label">RGB</span>
              <div className="qp-color-triplet-fields">
                <input
                  aria-label={UI_TEXT.accessibility.color.redChannel}
                  type="number"
                  min={0}
                  max={255}
                  value={rgb.r}
                  onChange={(event) => onRgbInput("r", event.target.value)}
                  className="qp-input qp-color-number-input"
                />
                <input
                  aria-label={UI_TEXT.accessibility.color.greenChannel}
                  type="number"
                  min={0}
                  max={255}
                  value={rgb.g}
                  onChange={(event) => onRgbInput("g", event.target.value)}
                  className="qp-input qp-color-number-input"
                />
                <input
                  aria-label={UI_TEXT.accessibility.color.blueChannel}
                  type="number"
                  min={0}
                  max={255}
                  value={rgb.b}
                  onChange={(event) => onRgbInput("b", event.target.value)}
                  className="qp-input qp-color-number-input"
                />
              </div>
            </div>
          )}

          {format === "hsl" && (
            <div
              id={formatPanelId}
              role="tabpanel"
              aria-labelledby={`${formatPanelId}-tab-hsl`}
              className="qp-color-triplet-row"
            >
              <span className="qp-color-row-label">HSL</span>
              <div className="qp-color-triplet-fields">
                <input
                  aria-label={UI_TEXT.accessibility.color.hueChannel}
                  type="number"
                  min={0}
                  max={360}
                  value={hsl.h}
                  onChange={(event) => onHslInput("h", event.target.value)}
                  className="qp-input qp-color-number-input"
                />
                <input
                  aria-label={UI_TEXT.accessibility.color.saturationChannel}
                  type="number"
                  min={0}
                  max={100}
                  value={hsl.s}
                  onChange={(event) => onHslInput("s", event.target.value)}
                  className="qp-input qp-color-number-input"
                />
                <input
                  aria-label={UI_TEXT.accessibility.color.lightnessChannel}
                  type="number"
                  min={0}
                  max={100}
                  value={hsl.l}
                  onChange={(event) => onHslInput("l", event.target.value)}
                  className="qp-input qp-color-number-input"
                />
              </div>
            </div>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}
