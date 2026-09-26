interface UpdateProgressBarProps {
  percent: number | null;
  label: string;
  valueText: string | null;
  indeterminate?: boolean;
  className?: string;
}

export default function UpdateProgressBar({
  percent,
  label,
  valueText,
  indeterminate = false,
  className,
}: UpdateProgressBarProps) {
  const resolvedPercent = percent === null ? 0 : Math.max(0, Math.min(100, percent));

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-center justify-between gap-3 qp-text-caption text-[var(--qp-text-tertiary)]">
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {valueText ? <span className="shrink-0">{valueText}</span> : null}
      </div>
      <div
        className="relative h-2 overflow-hidden rounded-full bg-[var(--qp-track-muted)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : resolvedPercent}
        aria-valuetext={valueText ?? label}
      >
        {indeterminate ? (
          <div className="qp-progress-indeterminate absolute inset-y-0 left-0 w-[32%] rounded-full bg-[var(--qp-accent-default)] opacity-90" />
        ) : (
          <div
            className="h-full rounded-full bg-[var(--qp-accent-default)] transition-[width] duration-300 ease-out"
            style={{ width: `${resolvedPercent}%` }}
          />
        )}
      </div>
    </div>
  );
}
