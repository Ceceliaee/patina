import { OTHER_CATEGORY_FIXED_COLOR } from "../classification/categoryTokens.ts";
import { useId, type CSSProperties } from "react";

interface Props {
  size?: number;
}

export function AnonymousActivityIndicator({ label, size, className, selectionKey, style }: Props & {
  label: string;
  className?: string;
  selectionKey?: string;
  style?: CSSProperties;
}) {
  return (
    <span role="img" aria-label={label} className={className} data-selection-key={selectionKey} style={style}>
      <AnonymousActivityIcon size={size} />
    </span>
  );
}

export default function AnonymousActivityIcon({ size = 20 }: Props) {
  const gradientId = useId();
  return (
    <svg
      className="anonymous-activity-icon shrink-0"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={OTHER_CATEGORY_FIXED_COLOR} />
          <stop offset="30%" stopColor={OTHER_CATEGORY_FIXED_COLOR} stopOpacity="0.95" />
          <stop offset="65%" stopColor={OTHER_CATEGORY_FIXED_COLOR} stopOpacity="0.5" />
          <stop offset="100%" stopColor={OTHER_CATEGORY_FIXED_COLOR} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="11" fill={`url(#${gradientId})`} />
    </svg>
  );
}
