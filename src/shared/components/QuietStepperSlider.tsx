import { Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";

interface QuietStepperSliderProps {
  ariaLabel: string;
  value: number;
  min: number;
  max: number;
  displayValue: ReactNode;
  decreaseAriaLabel: string;
  increaseAriaLabel: string;
  step?: number;
  integerButtons?: boolean;
  className?: string;
  onChange: (nextValue: number) => void;
}

const clampValue = (value: number, min: number, max: number) => (
  Math.min(max, Math.max(min, value))
);

export default function QuietStepperSlider({
  ariaLabel,
  value,
  min,
  max,
  displayValue,
  decreaseAriaLabel,
  increaseAriaLabel,
  step = 1,
  integerButtons = false,
  className,
  onChange,
}: QuietStepperSliderProps) {
  const safeValue = clampValue(value, min, max);
  const canDecrease = safeValue > min;
  const canIncrease = safeValue < max;
  const updateValue = (nextValue: number) => onChange(clampValue(nextValue, min, max));
  const getButtonValue = (direction: -1 | 1) => integerButtons
    ? direction > 0 ? Math.floor(safeValue) + 1 : Math.ceil(safeValue) - 1
    : safeValue + direction * step;
  const sliderProgress = max > min ? ((safeValue - min) / (max - min)) * 100 : 0;

  return (
    <div className={`flex w-full max-w-[224px] items-center gap-2.5 md:justify-self-end ${className ?? ""}`.trim()}>
      <div className="contents">
        <button
          type="button"
          onClick={() => updateValue(getButtonValue(-1))}
          disabled={!canDecrease}
          aria-label={decreaseAriaLabel}
          className="qp-button-secondary order-1 inline-flex h-6 w-6 items-center justify-center rounded-[6px] p-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Minus size={11} />
        </button>

        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={safeValue}
          onChange={(event) => updateValue(Number(event.target.value))}
          aria-label={ariaLabel}
          aria-valuetext={typeof displayValue === "string" ? displayValue : undefined}
          style={{
            backgroundImage: `linear-gradient(to right, var(--qp-text-tertiary) 0%, var(--qp-text-tertiary) ${sliderProgress}%, var(--qp-track-muted) ${sliderProgress}%, var(--qp-track-muted) 100%)`,
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
            backgroundSize: "100% 3px",
          }}
          className="order-2 h-5 min-w-[80px] flex-1 cursor-pointer appearance-none rounded-full [&::-webkit-slider-runnable-track]:h-[3px] [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-webkit-slider-thumb]:mt-[-5.5px] [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-[var(--qp-bg-panel)] [&::-webkit-slider-thumb]:bg-[var(--qp-text-tertiary)] [&::-moz-range-track]:h-[3px] [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-transparent [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-[var(--qp-bg-panel)] [&::-moz-range-thumb]:bg-[var(--qp-text-tertiary)]"
        />

        <button
          type="button"
          onClick={() => updateValue(getButtonValue(1))}
          disabled={!canIncrease}
          aria-label={increaseAriaLabel}
          className="qp-button-secondary order-4 inline-flex h-6 w-6 items-center justify-center rounded-[6px] p-0 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={11} />
        </button>
      </div>
      <p className="order-3 min-w-[48px] text-center text-xs font-medium tabular-nums text-[var(--qp-text-secondary)]">
        {displayValue}
      </p>
    </div>
  );
}
