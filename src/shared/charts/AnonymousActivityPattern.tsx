import { OTHER_CATEGORY_FIXED_COLOR } from "../classification/categoryTokens.ts";

export const ANONYMOUS_ACTIVITY_BACKGROUND = "radial-gradient(circle, color-mix(in srgb, var(--qp-text-secondary) 35%, transparent) 0.7px, transparent 0.85px)";
export const ANONYMOUS_ACTIVITY_STYLE = {
  backgroundImage: ANONYMOUS_ACTIVITY_BACKGROUND,
  backgroundSize: "6px 6px",
};

export default function AnonymousActivityPattern({ id }: { id: string }) {
  return <defs><pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
    <rect width="6" height="6" fill={OTHER_CATEGORY_FIXED_COLOR} />
    <circle cx="3" cy="3" r="0.7" fill="var(--qp-text-secondary)" fillOpacity="0.35" />
  </pattern></defs>;
}
