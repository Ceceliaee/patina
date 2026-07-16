import type { ButtonHTMLAttributes } from "react";

export type QuietButtonTone = "primary" | "secondary" | "danger";

interface QuietButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: QuietButtonTone;
  busy?: boolean;
}

export default function QuietButton({
  tone = "secondary",
  busy = false,
  disabled = false,
  className,
  type = "button",
  ...buttonProps
}: QuietButtonProps) {
  return (
    <button
      {...buttonProps}
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`qp-button-${tone} disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ""}`.trim()}
    />
  );
}
