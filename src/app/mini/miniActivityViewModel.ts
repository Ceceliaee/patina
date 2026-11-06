import type { MiniActivitySnapshot } from "../../platform/desktop/miniActivityRuntimeGateway.ts";
import type { UiText } from "../../shared/i18n/index.ts";
import type { TrackerHealthSnapshot } from "../../shared/types/tracking.ts";
import { compileForRange, materializeLiveSessions } from "../../shared/lib/readModelCore.ts";
import { buildHourlyCategoryActivity } from "../../shared/lib/hourlyActivityCompiler.ts";
import { buildAppTimelineSources, buildHistoryTimelineViewModelFromSources } from "../../shared/lib/activityTimelineCompiler.ts";
import { buildHistoryWebTimelineSources, buildWebDomainIconMap, buildWebDomainDistribution } from "../../shared/lib/webActivityViewModel.ts";
import { resolveAppIconKeys } from "../../shared/classification/appIconIdentity.ts";

export function miniActivityIcons(snapshot: MiniActivitySnapshot): Record<string, string> {
  const favicons = snapshot.web ? Object.fromEntries(Object.entries(snapshot.web.overrides)
    .flatMap(([domain, override]) => override.faviconUrl ? [[domain, override.faviconUrl]] : [])) : {};
  const icons = snapshot.web ? buildWebDomainIconMap(snapshot.web.segments, snapshot.web.overrides, favicons) : snapshot.icons;
  // Mini only consumes stored images; looking at activity must not start website requests.
  return Object.fromEntries(Object.entries(icons).filter(([, icon]) => {
    const source = icon.trim();
    return !/^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith("data:image/");
  }));
}

export function buildMiniActivityViewModel(snapshot: MiniActivitySnapshot, health: TrackerHealthSnapshot,
  text: UiText, colors: Record<string, string> = {}) {
  const range = { startMs: snapshot.startMs, endMs: Math.min(snapshot.endMs, snapshot.sampledAtMs) };
  const records = snapshot.records.map((row, index) => ({ ...row, id: -index - 1, windowTitle: "",
    duration: row.endTime - row.startTime, continuityGroupStartTime: row.startTime }));
  const compiled = compileForRange(snapshot.kind === "today" ? records
    : materializeLiveSessions(snapshot.sessions, health, snapshot.sampledAtMs), range, 0);
  if (snapshot.kind === "today") {
    const hourly = buildHourlyCategoryActivity(compiled);
    return { kind: "today" as const, sampledAtMs: snapshot.sampledAtMs,
      total: hourly.series.reduce((total, item) => total + (item.category === null ? 0 : item.totalMinutes * 60_000), 0),
      period: compiled.reduce<{ startMs: number; endMs: number } | null>((period, item) => ({
        startMs: Math.min(period?.startMs ?? item.startTime, item.startTime),
        endMs: Math.max(period?.endMs ?? item.startTime, item.endTime ?? snapshot.sampledAtMs),
      }), null),
      hourly };
  }
  const icons = miniActivityIcons(snapshot);
  const appColors = { ...colors };
  for (const [key, color] of Object.entries(colors)) {
    for (const alias of resolveAppIconKeys(key)) appColors[alias] ??= color;
  }
  const sources = snapshot.web
    ? buildHistoryWebTimelineSources({ segments: snapshot.web.segments, overrides: snapshot.web.overrides,
      nowMs: snapshot.sampledAtMs, iconThemeColors: colors, uiText: text })
    : buildAppTimelineSources(compiled, appColors, text);
  const timeline = buildHistoryTimelineViewModelFromSources({ sources, range,
    selectedDate: new Date(snapshot.sampledAtMs), nowMs: snapshot.sampledAtMs,
    mode: snapshot.bootstrap.timelineMode, mergeThresholdSecs: snapshot.bootstrap.settings.timelineMergeGapSecs,
    viewport: { ...range, durationMs: range.endMs - range.startMs } });
  const leaders = snapshot.web ? buildWebDomainDistribution(snapshot.web.segments, range, snapshot.sampledAtMs,
    snapshot.web.overrides, colors, icons).map(item => ({ ...item,
      label: item.category === "anonymous" ? text.common.anonymousActivity : item.label })) : timeline.legendItems;
  return { kind: "activity" as const, sampledAtMs: snapshot.sampledAtMs, mode: snapshot.bootstrap.timelineMode,
    timeline, icons, total: timeline.legendItems.reduce((total, item) => total + item.duration, 0),
    leaders: leaders.slice().sort((a, b) => b.duration - a.duration || a.key.localeCompare(b.key)) };
}

export type MiniActivityViewModel = ReturnType<typeof buildMiniActivityViewModel>;

export function formatMiniActivityDuration(ms: number): string {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}
