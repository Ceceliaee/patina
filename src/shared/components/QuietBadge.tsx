import { forwardRef, type HTMLAttributes } from "react";

type QuietBadgeTone = "neutral" | "warning" | "subtle";
type QuietBadgeSize = "compact" | "inline" | "regular";
type QuietBadgeVariant = "default" | "beta";

interface Props extends HTMLAttributes<HTMLSpanElement> {
  tone?: QuietBadgeTone;
  size?: QuietBadgeSize;
  variant?: QuietBadgeVariant;
}

const QuietBadge = forwardRef<HTMLSpanElement, Props>(function QuietBadge({
  children,
  tone = "neutral",
  size = "regular",
  variant = "default",
  className = "",
  ...spanProps
}, ref) {
  const variantClass = variant === "beta" ? " qp-badge-beta" : "";
  return (
    <span {...spanProps} ref={ref} className={`qp-badge qp-badge-${tone} qp-badge-${size}${variantClass} ${className}`.trim()}>
      {children}
    </span>
  );
});

export default QuietBadge;
