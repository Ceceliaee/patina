import { invoke } from "@tauri-apps/api/core";
import { isFiniteNumber } from "../../shared/lib/runtimeTypeGuards.ts";
import { listen } from "@tauri-apps/api/event";
import {
  cursorPosition,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const WIDGET_RUNTIME_COLLAPSED_EVENT = "widget-runtime-collapsed";
const WIDGET_RUNTIME_SHOWN_EVENT = "widget-runtime-shown";

type WidgetSide = "left" | "right";

type AppWindowLabel = "main" | "widget";

interface RawWidgetPlacement {
  monitor: RawWidgetMonitorAffinity | null;
  side: WidgetSide;
  anchor_y: number;
}

interface RawWidgetBootstrapSettings {
  tracking_paused: string | null;
  theme_mode: string | null;
  language: string | null;
  color_scheme_light: string | null;
  color_scheme_dark: string | null;
}

interface RawWidgetAppOverrideRow {
  key: string;
  value: string;
}

interface RawWidgetBootstrapSnapshot {
  settings: RawWidgetBootstrapSettings;
  pinned: boolean;
  app_overrides: RawWidgetAppOverrideRow[];
}

interface RawWidgetTrackingProjection {
  app_name: string;
  exe_name: string;
  elapsed_ms: number;
  running: boolean;
}

interface RawWidgetToolProjection {
  kind: "stopwatch" | "countdown" | "pomodoro";
  state: "running" | "paused" | "completed";
  value_ms: number;
  counts_down: boolean;
  visible_until_ms: number | null;
}

interface RawWidgetStatusSnapshot {
  tracking: RawWidgetTrackingProjection | null;
  tools: RawWidgetToolProjection[];
  sampled_at_ms: number;
}

interface RawWidgetMonitorAffinity {
  name: string | null;
  work_area: RawWidgetPhysicalRect;
}

interface RawWidgetPhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WidgetMonitorAffinity {
  name: string | null;
  workArea: WidgetPhysicalRect;
}

interface WidgetPhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WidgetPhysicalPoint {
  x: number;
  y: number;
}

export interface WidgetPlacement {
  monitor: WidgetMonitorAffinity | null;
  side: WidgetSide;
  anchorY: number;
}

interface WidgetBootstrapSettings {
  trackingPaused: string | null;
  themeMode: string | null;
  language: string | null;
  colorSchemeLight: string | null;
  colorSchemeDark: string | null;
}

interface WidgetAppOverrideRow {
  key: string;
  value: string;
}

export interface WidgetBootstrapSnapshot {
  settings: WidgetBootstrapSettings;
  pinned: boolean;
  appOverrides: WidgetAppOverrideRow[];
}

export interface WidgetTrackingProjection {
  appName: string;
  exeName: string;
  elapsedMs: number;
  running: boolean;
}

export interface WidgetToolProjection {
  kind: "stopwatch" | "countdown" | "pomodoro";
  state: "running" | "paused" | "completed";
  valueMs: number;
  countsDown: boolean;
  visibleUntilMs: number | null;
}

export interface WidgetStatusSnapshot {
  tracking: WidgetTrackingProjection | null;
  tools: WidgetToolProjection[];
  sampledAtMs: number;
}

function isWidgetSide(value: unknown): value is WidgetSide {
  return value === "left" || value === "right";
}

function isRawWidgetPhysicalRect(value: unknown): value is RawWidgetPhysicalRect {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return Number.isInteger(record.x)
    && Number.isInteger(record.y)
    && Number.isInteger(record.width)
    && Number.isInteger(record.height)
    && Number(record.width) > 0
    && Number(record.height) > 0;
}

function isRawWidgetMonitorAffinity(value: unknown): value is RawWidgetMonitorAffinity {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (record.name === null || typeof record.name === "string")
    && isRawWidgetPhysicalRect(record.work_area);
}

function isRawWidgetPlacement(value: unknown): value is RawWidgetPlacement {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (record.monitor === null || isRawWidgetMonitorAffinity(record.monitor))
    && isWidgetSide(record.side)
    && isFiniteNumber(record.anchor_y);
}

function isOptionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isRawWidgetBootstrapSettings(value: unknown): value is RawWidgetBootstrapSettings {
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

function isRawWidgetAppOverrideRow(value: unknown): value is RawWidgetAppOverrideRow {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.key === "string" && typeof record.value === "string";
}

function isRawWidgetBootstrapSnapshot(value: unknown): value is RawWidgetBootstrapSnapshot {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isRawWidgetBootstrapSettings(record.settings)
    && typeof record.pinned === "boolean"
    && Array.isArray(record.app_overrides)
    && record.app_overrides.every(isRawWidgetAppOverrideRow);
}

function mapRawWidgetPlacement(raw: RawWidgetPlacement): WidgetPlacement {
  return {
    monitor: raw.monitor
      ? {
          name: raw.monitor.name,
          workArea: {
            x: raw.monitor.work_area.x,
            y: raw.monitor.work_area.y,
            width: raw.monitor.work_area.width,
            height: raw.monitor.work_area.height,
          },
        }
      : null,
    side: raw.side,
    anchorY: raw.anchor_y,
  };
}

function parseWidgetPlacement(value: unknown): WidgetPlacement | null {
  return isRawWidgetPlacement(value) ? mapRawWidgetPlacement(value) : null;
}

export function parseWidgetBootstrapSnapshot(value: unknown): WidgetBootstrapSnapshot | null {
  if (!isRawWidgetBootstrapSnapshot(value)) {
    return null;
  }

  return {
    settings: {
      trackingPaused: value.settings.tracking_paused,
      themeMode: value.settings.theme_mode,
      language: value.settings.language,
      colorSchemeLight: value.settings.color_scheme_light,
      colorSchemeDark: value.settings.color_scheme_dark,
    },
    pinned: value.pinned,
    appOverrides: value.app_overrides.map((row) => ({
      key: row.key,
      value: row.value,
    })),
  };
}

function isRawWidgetTrackingProjection(value: unknown): value is RawWidgetTrackingProjection {
  return Boolean(value)
    && typeof value === "object"
    && typeof (value as RawWidgetTrackingProjection).app_name === "string"
    && typeof (value as RawWidgetTrackingProjection).exe_name === "string"
    && isFiniteNumber((value as RawWidgetTrackingProjection).elapsed_ms)
    && (value as RawWidgetTrackingProjection).elapsed_ms >= 0
    && typeof (value as RawWidgetTrackingProjection).running === "boolean";
}

function isRawWidgetToolProjection(value: unknown): value is RawWidgetToolProjection {
  if (!value || typeof value !== "object") return false;
  const raw = value as RawWidgetToolProjection;
  return ["stopwatch", "countdown", "pomodoro"].includes(raw.kind)
    && ["running", "paused", "completed"].includes(raw.state)
    && isFiniteNumber(raw.value_ms)
    && raw.value_ms >= 0
    && typeof raw.counts_down === "boolean"
    && (raw.visible_until_ms === null || isFiniteNumber(raw.visible_until_ms));
}

export function parseWidgetStatusSnapshot(value: unknown): WidgetStatusSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as RawWidgetStatusSnapshot;
  if (
    !(raw.tracking === null || isRawWidgetTrackingProjection(raw.tracking))
    || !Array.isArray(raw.tools)
    || raw.tools.length > 2
    || !raw.tools.every(isRawWidgetToolProjection)
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
    tracking: raw.tracking
      ? {
          appName: raw.tracking.app_name,
          exeName: raw.tracking.exe_name,
          elapsedMs: raw.tracking.elapsed_ms,
          running: raw.tracking.running,
        }
      : null,
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

export async function getWidgetStatusSnapshot(): Promise<WidgetStatusSnapshot> {
  const snapshot = parseWidgetStatusSnapshot(
    await invoke<unknown>("cmd_get_widget_status_snapshot"),
  );
  if (!snapshot) throw new Error("invalid widget status snapshot");
  return snapshot;
}

export async function getWidgetBootstrapSnapshot(): Promise<WidgetBootstrapSnapshot> {
  const payload = await invoke<unknown>("cmd_get_widget_bootstrap_snapshot");
  const snapshot = parseWidgetBootstrapSnapshot(payload);
  if (!snapshot) {
    throw new Error("invalid widget bootstrap snapshot");
  }
  return snapshot;
}

export async function getWidgetPlacement(): Promise<WidgetPlacement | null> {
  const payload = await invoke<unknown>("cmd_get_widget_placement");
  return parseWidgetPlacement(payload);
}

export async function getWidgetIcon(exeName: string): Promise<string | null> {
  return invoke<string | null>("cmd_get_widget_icon", { exeName });
}

export async function finalizeWidgetDrag(
  releasePosition: WidgetPhysicalPoint | null,
  expanded: boolean,
  toolSlotCount: number,
): Promise<WidgetPlacement | null> {
  const payload = await invoke<unknown>("cmd_finalize_widget_drag", {
    releasePosition,
    expanded,
    toolSlotCount,
  });
  return parseWidgetPlacement(payload);
}

export async function getCurrentCursorPhysicalPosition(): Promise<WidgetPhysicalPoint | null> {
  const position = await cursorPosition().catch(() => null);
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) {
    return null;
  }

  const x = Math.round(position.x);
  const y = Math.round(position.y);
  if (
    x < -2_147_483_648
    || x > 2_147_483_647
    || y < -2_147_483_648
    || y > 2_147_483_647
  ) {
    return null;
  }

  return {
    x,
    y,
  };
}

export async function setWidgetExpanded(
  expanded: boolean,
  toolSlotCount: number,
): Promise<void> {
  await invoke("cmd_set_widget_expanded", {
    expanded,
    toolSlotCount,
  });
}

export async function setWidgetPinned(
  pinned: boolean,
  toolSlotCount: number,
): Promise<void> {
  await invoke("cmd_set_widget_pinned", { pinned, toolSlotCount });
}

export async function onWidgetToolsChanged(handler: () => void): Promise<() => void> {
  return listen("tools-runtime-changed", handler);
}

export async function showMainWindow(): Promise<void> {
  await invoke("cmd_show_main_window");
}

export async function hideWidgetWindow(): Promise<void> {
  await invoke("cmd_hide_widget_window");
}

export async function onWidgetRuntimeCollapsed(handler: () => void): Promise<() => void> {
  return listen(WIDGET_RUNTIME_COLLAPSED_EVENT, () => {
    handler();
  });
}

export async function onWidgetRuntimeShown(
  handler: (placement: WidgetPlacement | null) => void,
): Promise<() => void> {
  return listen<unknown>(WIDGET_RUNTIME_SHOWN_EVENT, (event) => {
    handler(parseWidgetPlacement(event.payload));
  });
}

export async function isPrimaryMouseButtonDown(): Promise<boolean> {
  return invoke<boolean>("cmd_is_primary_mouse_button_down");
}

export function resolveCurrentAppWindowLabel(): AppWindowLabel {
  try {
    const windowLabel = getCurrentWindow().label;
    const webviewLabel = getCurrentWebviewWindow().label;
    return windowLabel === "widget" || webviewLabel === "widget"
      ? "widget"
      : "main";
  } catch {
    return "main";
  }
}

export async function isCurrentWindowVisibleAndFocused(): Promise<boolean> {
  const currentWindow = getCurrentWindow();
  const visible = await currentWindow.isVisible();
  if (!visible) {
    return false;
  }

  return currentWindow.isFocused();
}

export async function setCurrentWidgetWindowFocusable(focusable: boolean): Promise<void> {
  await getCurrentWindow().setFocusable(focusable);
}

export async function startCurrentWidgetWindowDrag(): Promise<void> {
  await getCurrentWindow().startDragging();
}

export async function isCursorInsideCurrentWidgetWindow(): Promise<boolean> {
  const currentWindow = getCurrentWindow();
  const visible = await currentWindow.isVisible().catch(() => false);
  if (!visible) {
    return false;
  }

  const [position, size, cursor] = await Promise.all([
    currentWindow.outerPosition().catch(() => null),
    currentWindow.outerSize().catch(() => null),
    cursorPosition().catch(() => null),
  ]);

  if (!position || !size || !cursor) {
    return false;
  }

  return cursor.x >= position.x
    && cursor.x <= position.x + size.width
    && cursor.y >= position.y
    && cursor.y <= position.y + size.height;
}

export async function onCurrentWidgetWindowMoved(
  handler: () => void,
): Promise<() => void> {
  return getCurrentWindow().onMoved(handler);
}

export async function onCurrentWidgetWindowScaleChanged(
  handler: (scaleFactor: number) => void,
): Promise<() => void> {
  return getCurrentWindow().onScaleChanged(({ payload }) => {
    handler(payload.scaleFactor);
  });
}

export async function onCurrentWidgetWindowFocusChanged(
  handler: (focused: boolean) => void,
): Promise<() => void> {
  return getCurrentWindow().onFocusChanged(({ payload }) => {
    handler(payload);
  });
}
