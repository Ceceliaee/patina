import { ChevronLeft, ChevronRight } from "lucide-react";
import { forwardRef } from "react";

interface QuietRangeControlProps {
  ariaLabel: string;
  label: string;
  labelAriaLabel?: string;
  previousAriaLabel: string;
  nextAriaLabel: string;
  onPrevious: () => void;
  onNext: () => void;
  onLabelClick?: () => void;
  previousDisabled?: boolean;
  nextDisabled?: boolean;
  expanded?: boolean;
  className?: string;
  labelClassName?: string;
}

const QuietRangeControl = forwardRef<HTMLButtonElement, QuietRangeControlProps>(function QuietRangeControl({
  ariaLabel,
  label,
  labelAriaLabel,
  previousAriaLabel,
  nextAriaLabel,
  onPrevious,
  onNext,
  onLabelClick,
  previousDisabled = false,
  nextDisabled = false,
  expanded,
  className,
  labelClassName,
}, ref) {
  return (
    <div
      className={`qp-range-control ${className ?? ""}`.trim()}
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        onClick={onPrevious}
        disabled={previousDisabled}
        className="qp-control qp-range-control-arrow"
        aria-label={previousAriaLabel}
      >
        <ChevronLeft size={14} />
      </button>
      {onLabelClick ? (
        <button
          ref={ref}
          type="button"
          className={`qp-status qp-range-control-label ${labelClassName ?? ""}`.trim()}
          aria-label={labelAriaLabel}
          aria-expanded={expanded}
          aria-haspopup="dialog"
          onClick={onLabelClick}
        >
          <span className="qp-range-control-label-text">{label}</span>
        </button>
      ) : (
        <span
          className={`qp-status qp-range-control-label ${labelClassName ?? ""}`.trim()}
          aria-label={labelAriaLabel}
        >
          <span className="qp-range-control-label-text">{label}</span>
        </span>
      )}
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled}
        className="qp-control qp-range-control-arrow"
        aria-label={nextAriaLabel}
      >
        <ChevronRight size={14} />
      </button>
    </div>
  );
});

export default QuietRangeControl;
