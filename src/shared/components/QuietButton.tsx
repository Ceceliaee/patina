import { forwardRef, type ButtonHTMLAttributes } from "react";

export type QuietButtonTone = "primary" | "secondary" | "danger";
type QuietButtonSize = "compact" | "regular" | "large";

interface QuietButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: QuietButtonTone;
  size?: QuietButtonSize;
  busy?: boolean;
}

const QuietButton = forwardRef<HTMLButtonElement, QuietButtonProps>(function QuietButton({
  tone = "secondary",
  size = "regular",
  busy = false,
  disabled = false,
  className,
  type = "button",
  ...buttonProps
}, ref) {
  return (
    <button
      {...buttonProps}
      ref={ref}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`qp-button qp-button-${size} qp-button-${tone} disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`.trim()}
    />
  );
});

export default QuietButton;
