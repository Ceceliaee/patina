import { useEffect, useRef, useState } from "react";
import { getMiniActivitySnapshot, type MiniActivityPage } from "../../platform/desktop/miniActivityRuntimeGateway.ts";
import { onAppSettingsChanged } from "../../platform/runtime/appSettingsEventGateway.ts";
import { onTrackingDataChanged } from "../../platform/runtime/trackingRuntimeGateway.ts";
import { prewarmIconThemeColors } from "../../shared/hooks/useIconThemeColors.ts";
import { useLocaleText } from "../../shared/i18n/index.ts";
import type { TrackerHealthSnapshot } from "../../shared/types/tracking.ts";
import { buildMiniActivityViewModel, miniActivityIcons, type MiniActivityViewModel } from "./miniActivityViewModel.ts";

export function useMiniActivity(page: MiniActivityPage, health: TrackerHealthSnapshot) {
  const text = useLocaleText();
  const [view, setView] = useState<MiniActivityViewModel | null>(null);
  const [failed, setFailed] = useState(false);
  const [retryVersion, setRetryVersion] = useState(0);
  const healthRef = useRef(health);
  healthRef.current = health;
  useEffect(() => {
    let active = true;
    let generation = 0;
    let pending = false;
    let dirty = false;
    let intervalMs = 5_000;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unlisteners: Array<() => void> = [];
    setView(null);
    setFailed(false);
    const request = async (invalidate = false) => {
      if (!active) return;
      clearTimeout(timer);
      generation += 1;
      dirty = true;
      if (invalidate) setView(null);
      if (pending) return;
      pending = true;
      while (active && dirty) {
        dirty = false;
        const version = generation;
        try {
          const startedAt = Date.now();
          const startedTick = performance.now();
          const startedDay = new Date(startedAt).toDateString();
          const startedOffset = new Date(startedAt).getTimezoneOffset();
          const snapshot = await getMiniActivitySnapshot(page);
          const colors = await prewarmIconThemeColors(miniActivityIcons(snapshot));
          if (!active || version !== generation) continue;
          const finishedAt = Date.now();
          if (new Date(finishedAt).toDateString() !== startedDay
            || new Date(finishedAt).getTimezoneOffset() !== startedOffset
            || Math.abs(finishedAt - startedAt - (performance.now() - startedTick)) > 2_000) {
            setView(null);
            dirty = true;
            continue;
          }
          const next = buildMiniActivityViewModel(snapshot, healthRef.current, text, colors);
          setView(next);
          setFailed(false);
          intervalMs = Math.max(1_000, snapshot.bootstrap.settings.refreshIntervalSecs * 1_000);
        } catch (error) {
          if (active && version === generation) {
            // The old range must never acquire a fresh date or mode after a failed read.
            setView(null);
            setFailed(true);
            console.warn("mini:activity", error);
          }
        }
      }
      pending = false;
      if (active) {
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        const untilMidnight = Math.max(1, midnight.getTime() - Date.now());
        timer = setTimeout(() => { void request(untilMidnight <= intervalMs); }, Math.min(intervalMs, untilMidnight));
      }
    };
    const listen = async (subscription: Promise<() => void>) => {
      const off = await subscription;
      if (active) unlisteners.push(off); else off();
    };
    void Promise.all([
      listen(onAppSettingsChanged(() => request(true))),
      listen(onTrackingDataChanged(() => request())),
    ]).then(() => request()).catch((error: unknown) => {
      if (active) { setFailed(true); console.warn("mini:activity-subscription", error); }
    });
    return () => { active = false; generation += 1; clearTimeout(timer); unlisteners.forEach(off => off()); };
  }, [page, text, retryVersion]);
  return { view, failed, retry: () => setRetryVersion(value => value + 1) };
}
