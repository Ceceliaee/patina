export interface QuietSegmentedFilterOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface Props<T extends string> {
  value: T;
  options: QuietSegmentedFilterOption<T>[];
  onChange: (nextValue: T) => void;
  variant?: "compact" | "separate";
  className?: string;
}

export default function QuietSegmentedFilter<T extends string>({
  value,
  options,
  onChange,
  variant = "compact",
  className,
}: Props<T>) {
  const variantClassName = variant === "compact"
    ? "qp-segmented-filter-compact"
    : "qp-segmented-filter-separate";

  return (
    <div className={`qp-segmented-filter ${variantClassName} ${className ?? ""}`.trim()}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`qp-segmented-filter-item ${selected ? "qp-segmented-filter-item-selected" : ""}`.trim()}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
