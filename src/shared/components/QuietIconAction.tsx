import type { ReactNode } from "react";
import QuietTooltip, { type QuietTooltipPlacement } from "./QuietTooltip";

type QuietIconActionTone = "neutral" | "danger";

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
  onClick?: () => void;
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
  onClick,
}: Props) {
  const button = (
    <button
      type="button"
      aria-label={ariaLabel ?? title}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`qp-icon-action qp-icon-action-${tone} ${pressed ? "qp-icon-action-pressed" : ""} ${className ?? ""}`.trim()}
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
