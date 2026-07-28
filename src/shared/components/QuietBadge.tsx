import type { ReactNode } from "react";

export type QuietBadgeTone = "neutral" | "warning" | "subtle";
export type QuietBadgeSize = "compact" | "regular";
export type QuietBadgeVariant = "default" | "beta";

interface Props {
  children: ReactNode;
  tone?: QuietBadgeTone;
  size?: QuietBadgeSize;
  variant?: QuietBadgeVariant;
}

export default function QuietBadge({
  children,
  tone = "neutral",
  size = "regular",
  variant = "default",
}: Props) {
  const variantClass = variant === "beta" ? " qp-badge-beta" : "";
  return (
    <span className={`qp-badge qp-badge-${tone} qp-badge-${size}${variantClass}`}>
      {children}
    </span>
  );
}
