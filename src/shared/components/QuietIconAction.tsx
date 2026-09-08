import type { ReactNode, Ref, MouseEventHandler } from "react";
import QuietTooltip, { type QuietTooltipPlacement } from "./QuietTooltip";

type QuietIconActionTone = "neutral" | "danger" | "warning" | "accent";

interface Props {
  icon: ReactNode;
  title: string;
  tone?: QuietIconActionTone;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  showTooltip?: boolean;
  tooltipPlacement?: QuietTooltipPlacement;
  pressed?: boolean;
  showPressedStyle?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  buttonRef?: Ref<HTMLButtonElement>;
  expanded?: boolean;
  controls?: string;
  describedBy?: string;
}

export default function QuietIconAction({
  icon,
  title,
  tone = "neutral",
  disabled = false,
  ariaLabel,
  className,
  showTooltip = true,
  tooltipPlacement = "top",
  pressed,
  showPressedStyle = true,
  onClick,
  buttonRef,
  expanded,
  controls,
  describedBy,
}: Props) {
  const button = (
    <button
      type="button"
      ref={buttonRef}
      aria-expanded={expanded}
      aria-controls={controls}
      aria-describedby={describedBy}
      aria-label={ariaLabel ?? title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`qp-icon-action qp-icon-action-${tone} ${pressed && showPressedStyle ? "qp-icon-action-pressed" : ""} ${className ?? ""}`.trim()}
    >
      {icon}
    </button>
  );

  if (!showTooltip) {
    return button;
  }

  return (
    <QuietTooltip label={title} placement={tooltipPlacement}>
      {button}
    </QuietTooltip>
  );
}
