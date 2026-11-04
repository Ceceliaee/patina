import type { KeyboardEvent, ReactNode, RefObject } from "react";
import QuietTooltip from "./QuietTooltip";

export interface QuietSegmentedFilterOption<T extends string> {
  value: T;
  label: ReactNode;
  tooltip?: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  value: T;
  options: QuietSegmentedFilterOption<T>[];
  onChange: (nextValue: T) => void;
  variant?: "compact" | "control" | "separate";
  className?: string;
  semantics?: "buttons" | "tabs";
  ariaLabel?: string;
  tabIdPrefix?: string;
  tabPanelId?: string;
  selectedOptionRef?: RefObject<HTMLButtonElement | null>;
}

export default function QuietSegmentedFilter<T extends string>({
  value,
  options,
  onChange,
  variant = "compact",
  className,
  semantics = "buttons",
  ariaLabel,
  tabIdPrefix,
  tabPanelId,
  selectedOptionRef,
}: Props<T>) {
  const variantClassName = variant === "separate"
    ? "qp-segmented-filter-separate"
    : `qp-segmented-filter-compact${variant === "control" ? " qp-segmented-filter-control" : ""}`;
  const tabs = semantics === "tabs";

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentValue: T) => {
    if (!tabs || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const enabledOptions = options.filter((option) => !option.disabled);
    if (enabledOptions.length === 0) return;

    event.preventDefault();
    const currentIndex = enabledOptions.findIndex((option) => option.value === currentValue);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? enabledOptions.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + enabledOptions.length)
          % enabledOptions.length;
    const nextOption = enabledOptions[nextIndex];
    onChange(nextOption.value);
    if (tabIdPrefix) {
      requestAnimationFrame(() => {
        document.getElementById(`${tabIdPrefix}-${nextOption.value}`)?.focus();
      });
    }
  };

  return (
    <div
      className={`qp-segmented-filter ${variantClassName} ${className ?? ""}`.trim()}
      role={tabs ? "tablist" : undefined}
      aria-label={ariaLabel}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const button = (
          <button
            key={option.value}
            ref={selected && selectedOptionRef ? selectedOptionRef : undefined}
            id={tabs && tabIdPrefix ? `${tabIdPrefix}-${option.value}` : undefined}
            type="button"
            role={tabs ? "tab" : undefined}
            disabled={option.disabled}
            aria-pressed={tabs ? undefined : selected}
            aria-selected={tabs ? selected : undefined}
            aria-controls={tabs ? tabPanelId : undefined}
            aria-label={option.ariaLabel}
            tabIndex={tabs ? (selected ? 0 : -1) : undefined}
            onClick={() => onChange(option.value)}
            onKeyDown={tabs ? (event) => handleTabKeyDown(event, option.value) : undefined}
            className={`qp-segmented-filter-item ${selected ? "qp-segmented-filter-item-selected" : ""}`.trim()}
          >
            {option.label}
          </button>
        );

        if (option.tooltip) {
          return (
            <QuietTooltip
              key={option.value}
              label={option.tooltip}
              placement="top"
              disabled={option.disabled}
            >
              {button}
            </QuietTooltip>
          );
        }

        return button;
      })}
    </div>
  );
}
