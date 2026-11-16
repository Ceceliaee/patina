import type { UserAssignableAppCategory } from "./categoryTokens.ts";

type SeededAssignableCategoryForDefaultColor = Exclude<UserAssignableAppCategory, "other">;

export const RELEASE_DEFAULT_CATEGORY_COLOR_ASSIGNMENTS: Record<
  SeededAssignableCategoryForDefaultColor,
  string
> = {
  ai: "#3293C8",
  development: "#4790CF",
  office: "#6F7AE6",
  browser: "#36AC7E",
  communication: "#C56A73",
  video: "#66955C",
  music: "#3D9C6B",
  game: "#B07E55",
  design: "#8C6FA1",
  utility: "#35A69E",
  learning: "#AA8752",
};
