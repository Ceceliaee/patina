import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../../shared/settings/appSettings.ts";
import { normalizeSettingsRecord } from "../../shared/settings/appSettingsNormalization.ts";
import { isFiniteNumber } from "../../shared/lib/runtimeTypeGuards.ts";
import {
  parseTrackingStatusSnapshot,
  parseTrackingWindowSnapshot,
} from "../runtime/trackingRawDtos.ts";
import type {
  TrackingRuntimeProbeStatus,
  TrackingStatusSnapshot,
  TrackingWindowSnapshot,
} from "../../shared/types/tracking.ts";
interface RawMiniBootstrapSettings {
  tracking_paused: string | null;
  theme_mode: string | null;
  language: string | null;
  color_scheme_light: string | null;
  color_scheme_dark: string | null;
}

interface RawMiniAppOverrideRow {
  key: string;
  value: string;
}

interface RawMiniBootstrapSnapshot {
  settings: RawMiniBootstrapSettings;
  app_overrides: RawMiniAppOverrideRow[];
  app_links: RawMiniAppOverrideRow[];
}

interface RawMiniToolProjection {
  kind: "stopwatch" | "countdown" | "pomodoro";
  state: "running" | "paused" | "completed";
  value_ms: number;
  counts_down: boolean;
  visible_until_ms: number | null;
}

interface RawMiniStatusSnapshot {
  tools: RawMiniToolProjection[];
  sampled_at_ms: number;
}

interface RawMiniPresentationSnapshot {
  tracking_paused: boolean;
  window: unknown;
  tracking_status: unknown;
  tracking_probe_status: TrackingRuntimeProbeStatus;
  status: unknown;
}

interface MiniAppOverrideRow {
  key: string;
  value: string;
}

export interface MiniBootstrapSnapshot {
  settings: AppSettings;
  appOverrides: MiniAppOverrideRow[];
  appLinks: MiniAppOverrideRow[];
}

export interface MiniToolProjection {
  kind: "stopwatch" | "countdown" | "pomodoro";
  state: "running" | "paused" | "completed";
  valueMs: number;
  countsDown: boolean;
  visibleUntilMs: number | null;
}

export interface MiniStatusSnapshot {
  tools: MiniToolProjection[];
  sampledAtMs: number;
}

interface MiniPresentationSnapshot {
  trackingPaused: boolean;
  activeWindow: TrackingWindowSnapshot;
  trackingStatus: TrackingStatusSnapshot;
  trackingProbeStatus: TrackingRuntimeProbeStatus;
  status: MiniStatusSnapshot;
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRawMiniBootstrapSettings(value: unknown): value is RawMiniBootstrapSettings {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isOptionalString(record.tracking_paused)
    && isOptionalString(record.theme_mode)
    && isOptionalString(record.language)
    && isOptionalString(record.color_scheme_light)
    && isOptionalString(record.color_scheme_dark);
}

function isRawMiniAppOverrideRow(value: unknown): value is RawMiniAppOverrideRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.key === "string" && typeof record.value === "string";
}

function isRawMiniBootstrapSnapshot(value: unknown): value is RawMiniBootstrapSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isRawMiniBootstrapSettings(record.settings)
    && Array.isArray(record.app_overrides)
    && record.app_overrides.every(isRawMiniAppOverrideRow)
    && Array.isArray(record.app_links)
    && record.app_links.every(isRawMiniAppOverrideRow);
}

export function parseMiniBootstrapSnapshot(value: unknown): MiniBootstrapSnapshot | null {
  if (!isRawMiniBootstrapSnapshot(value)) {
    return null;
  }

  return {
    settings: normalizeSettingsRecord({
      tracking_paused: value.settings.tracking_paused ?? undefined,
      theme_mode: value.settings.theme_mode ?? undefined,
      language: value.settings.language ?? undefined,
      color_scheme_light: value.settings.color_scheme_light ?? undefined,
      color_scheme_dark: value.settings.color_scheme_dark ?? undefined,
    }),
    appLinks: value.app_links.map((row) => ({ key: row.key, value: row.value })),
    appOverrides: value.app_overrides.map((row) => ({
      key: row.key,
      value: row.value,
    })),
  };
}

function isRawMiniToolProjection(value: unknown): value is RawMiniToolProjection {
  if (!value || typeof value !== "object") return false;
  const raw = value as RawMiniToolProjection;
  return ["stopwatch", "countdown", "pomodoro"].includes(raw.kind)
    && ["running", "paused", "completed"].includes(raw.state)
    && isFiniteNumber(raw.value_ms)
    && raw.value_ms >= 0
    && typeof raw.counts_down === "boolean"
    && (raw.visible_until_ms === null || isFiniteNumber(raw.visible_until_ms));
}

export function parseMiniStatusSnapshot(value: unknown): MiniStatusSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as RawMiniStatusSnapshot;
  if (
    !Array.isArray(raw.tools)
    || raw.tools.length > 2
    || !raw.tools.every(isRawMiniToolProjection)
    || !isFiniteNumber(raw.sampled_at_ms)
  ) {
    return null;
  }
  const timerTools = raw.tools.filter((tool) => tool.kind !== "pomodoro");
  const pomodoroTools = raw.tools.filter((tool) => tool.kind === "pomodoro");
  if (
    timerTools.length > 1
    || pomodoroTools.length > 1
    || (raw.tools.length === 2 && raw.tools[1]?.kind !== "pomodoro")
  ) {
    return null;
  }
  return {
    tools: raw.tools.map((tool) => ({
      kind: tool.kind,
      state: tool.state,
      valueMs: tool.value_ms,
      countsDown: tool.counts_down,
      visibleUntilMs: tool.visible_until_ms,
    })),
    sampledAtMs: raw.sampled_at_ms,
  };
}

const TRACKING_PROBE_STATUSES = new Set<TrackingRuntimeProbeStatus>([
  "ok",
  "timeout-fallback",
  "timeout-inactive",
  "backing-off-fallback",
  "backing-off-inactive",
  "recovery-attempted-fallback",
  "recovery-attempted-inactive",
  "hard-degraded-fallback",
  "hard-degraded-inactive",
  "task-failed-fallback",
  "task-failed-inactive",
]);

function parseMiniPresentationSnapshot(
  value: unknown,
): MiniPresentationSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as RawMiniPresentationSnapshot;
  const activeWindow = parseTrackingWindowSnapshot(raw.window);
  const trackingStatus = parseTrackingStatusSnapshot(raw.tracking_status);
  const status = parseMiniStatusSnapshot(raw.status);
  if (
    !activeWindow
    || !trackingStatus
    || !status
    || typeof raw.tracking_paused !== "boolean"
    || !TRACKING_PROBE_STATUSES.has(raw.tracking_probe_status)
  ) {
    return null;
  }

  return {
    activeWindow,
    trackingStatus,
    trackingPaused: raw.tracking_paused,
    trackingProbeStatus: raw.tracking_probe_status,
    status,
  };
}

export async function getMiniPresentationSnapshot(): Promise<MiniPresentationSnapshot> {
  const snapshot = parseMiniPresentationSnapshot(
    await invoke<unknown>("cmd_get_mini_presentation_snapshot"),
  );
  if (!snapshot) throw new Error("invalid mini presentation snapshot");
  return snapshot;
}

export async function getMiniBootstrapSnapshot(): Promise<MiniBootstrapSnapshot> {
  const payload = await invoke<unknown>("cmd_get_mini_bootstrap_snapshot");
  const snapshot = parseMiniBootstrapSnapshot(payload);
  if (!snapshot) {
    throw new Error("invalid mini bootstrap snapshot");
  }
  return snapshot;
}
