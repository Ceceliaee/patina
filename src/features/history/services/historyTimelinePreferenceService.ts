import { effectiveActivityTimelineMode, nextActivityTimelineMode, type ActivityTimelineMode } from "../../../shared/settings/activityDisplaySettings.ts";
import { loadActivityTimelineMode, migrateActivityTimelineMode, saveActivityTimelineMode } from "../../../platform/persistence/activityDisplaySettingsStore.ts";
import { onAppSettingsChanged } from "../../../platform/runtime/appSettingsEventGateway.ts";

const DEFAULT_DEPS = { load: loadActivityTimelineMode, migrate: migrateActivityTimelineMode,
  save: saveActivityTimelineMode, subscribe: onAppSettingsChanged };

export function startHistoryTimelinePreference(options: {
  webEnabled: boolean;
  accept: (mode: ActivityTimelineMode) => void;
  failed: (error: unknown, writing: boolean) => void;
}, deps = DEFAULT_DEPS) {
  let active = true;
  let off: (() => void) | undefined;
  let queue = Promise.resolve();
  const enqueue = (operation: "migrate" | "read" | "toggle") => {
    queue = queue.then(async () => {
      if (!active) return;
      const saved = await (operation === "read" ? deps.load() : deps.migrate());
      if (!active) return;
      const effective = effectiveActivityTimelineMode(saved, options.webEnabled);
      const next = operation === "toggle" ? nextActivityTimelineMode(effective, options.webEnabled) : effective;
      if (next !== saved) await deps.save(next);
      if (active) options.accept(next);
    }).catch((error: unknown) => { if (active) options.failed(error, operation === "toggle"); });
    return queue;
  };
  const ready = deps.subscribe(() => enqueue("read")).then(unsubscribe => {
    if (!active) { unsubscribe(); return; }
    off = unsubscribe;
    return enqueue("migrate");
  }).catch((error: unknown) => { if (active) options.failed(error, false); });
  return { ready, toggle: () => enqueue("toggle"), dispose: () => { active = false; off?.(); } };
}
