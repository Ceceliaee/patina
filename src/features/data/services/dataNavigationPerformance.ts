export const DATA_NAVIGATION_PERFORMANCE_MARKS = {
  intent: "patina:data-navigation:intent",
  chunkReady: "patina:data-navigation:chunk-ready",
  rootMounted: "patina:data-navigation:root-mounted",
  structureActive: "patina:data-navigation:structure-active",
  readModelReady: "patina:data-navigation:read-model-ready",
  complete: "patina:data-navigation:complete",
} as const;

export type DataNavigationPerformanceStage =
  Exclude<keyof typeof DATA_NAVIGATION_PERFORMANCE_MARKS, "intent">;

function getPerformance() {
  return typeof performance === "undefined" ? null : performance;
}

export function beginDataNavigationMeasurement() {
  const runtime = getPerformance();
  if (!runtime) return;

  for (const mark of Object.values(DATA_NAVIGATION_PERFORMANCE_MARKS)) {
    runtime.clearMarks(mark);
  }
  runtime.mark(DATA_NAVIGATION_PERFORMANCE_MARKS.intent);
}

export function markDataNavigationStage(stage: DataNavigationPerformanceStage) {
  const runtime = getPerformance();
  if (!runtime) return;

  const intentEntries = runtime.getEntriesByName(DATA_NAVIGATION_PERFORMANCE_MARKS.intent, "mark");
  const intent = intentEntries[intentEntries.length - 1];
  if (!intent) return;

  const mark = DATA_NAVIGATION_PERFORMANCE_MARKS[stage];
  const alreadyMarked = runtime
    .getEntriesByName(mark, "mark")
    .some((entry) => entry.startTime >= intent.startTime);
  if (!alreadyMarked) {
    runtime.mark(mark);
  }
}
