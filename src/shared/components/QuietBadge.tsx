import type { ComponentPropsWithoutRef } from "react";

export type QuietBadgeTone = "neutral" | "warning" | "subtle";
export type QuietBadgeSize = "compact" | "regular";
export type QuietBadgeVariant = "default" | "beta";

interface Props extends ComponentPropsWithoutRef<"span"> {
  tone?: QuietBadgeTone;
  size?: QuietBadgeSize;
  variant?: QuietBadgeVariant;
}

export default function QuietBadge({
  children,
  tone = "neutral",
  size = "regular",
  variant = "default",
  className,
  ...spanProps
}: Props) {
  return (
    <span
      {...spanProps}
      className={`qp-badge qp-badge-${tone} qp-badge-${size} qp-badge-${variant} ${className ?? ""}`.trim()}
    >
      <span className="qp-badge-label">{children}</span>
    </span>
  );
}
