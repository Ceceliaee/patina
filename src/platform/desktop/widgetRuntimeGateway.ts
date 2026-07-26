import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  cursorPosition,
  getCurrentWindow,
} from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const WIDGET_RUNTIME_COLLAPSED_EVENT = "widget-runtime-collapsed";
const WIDGET_RUNTIME_SHOWN_EVENT = "widget-runtime-shown";

export type WidgetSide = "left" | "right";

export type AppWindowLabel = "main" | "widget";

interface RawWidgetPlacement {
  monitor: RawWidgetMonitorAffinity | null;
  side: WidgetSide;
  anchor_y: number;
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

export interface WidgetMonitorAffinity {
  name: string | null;
  workArea: WidgetPhysicalRect;
}

export interface WidgetPhysicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WidgetPlacement {
  monitor: WidgetMonitorAffinity | null;
  side: WidgetSide;
  anchorY: number;
}

function isWidgetSide(value: unknown): value is WidgetSide {
  return value === "left" || value === "right";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

export function parseWidgetPlacement(value: unknown): WidgetPlacement | null {
  return isRawWidgetPlacement(value) ? mapRawWidgetPlacement(value) : null;
}

export async function getWidgetPlacement(): Promise<WidgetPlacement | null> {
  const payload = await invoke<unknown>("cmd_get_widget_placement");
  return parseWidgetPlacement(payload);
}

export async function getWidgetIcon(exeName: string): Promise<string | null> {
  return invoke<string | null>("cmd_get_widget_icon", { exeName });
}

export async function finalizeWidgetDrag(): Promise<WidgetPlacement | null> {
  const payload = await invoke<unknown>("cmd_finalize_widget_drag");
  return parseWidgetPlacement(payload);
}

export async function setWidgetExpanded(
  expanded: boolean,
  showObjectSlot: boolean,
): Promise<void> {
  await invoke("cmd_set_widget_expanded", {
    expanded,
    showObjectSlot,
  });
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

export async function onWidgetRuntimeShown(handler: () => void): Promise<() => void> {
  return listen(WIDGET_RUNTIME_SHOWN_EVENT, () => {
    handler();
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
