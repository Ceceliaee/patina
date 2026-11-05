import { OTHER_CATEGORY_FIXED_COLOR, type AppCategory } from "./categoryTokens.ts";
import { resolveCanonicalExecutable } from "./processNormalization.ts";
import { isAnonymousActivity } from "./anonymousActivity.ts";

const fallbackPalette = ["#36AC7E", "#4790CF", "#6F7AE6", "#B07E55", "#35A69E", "#C56A73", "#8C6FA1"] as const;

export function objectColor(
  kind: "app" | "web",
  owner: string,
  override: string | null | undefined,
  icon: string | null | undefined,
  category: AppCategory | undefined,
  categoryColor: string | undefined,
): string {
  if (isAnonymousActivity(owner) || category === "anonymous")
    return OTHER_CATEGORY_FIXED_COLOR;
  if (override)
    return override;
  if (icon)
    return icon;
  if (category && category !== "other" && categoryColor)
    return categoryColor;
  const normalized = kind === "app" ? resolveCanonicalExecutable(owner) : owner.trim().toLowerCase();
  let hash = 0;
  for (const char of kind + ":" + normalized)
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return fallbackPalette[hash % fallbackPalette.length];
}
