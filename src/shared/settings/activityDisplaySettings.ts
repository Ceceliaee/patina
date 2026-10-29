export type ActivityTimelineMode = "app" | "category" | "web";

export function parseActivityTimelineMode(value: unknown): ActivityTimelineMode {
  return value === "category" || value === "web" ? value : "app";
}

export function effectiveActivityTimelineMode(mode: ActivityTimelineMode, webEnabled: boolean): ActivityTimelineMode {
  return mode === "web" && !webEnabled ? "app" : mode;
}

export function nextActivityTimelineMode(mode: ActivityTimelineMode, webEnabled: boolean): ActivityTimelineMode {
  if (mode === "app") return "category";
  return mode === "category" && webEnabled ? "web" : "app";
}
