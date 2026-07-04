import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  availableMonitors,
  cursorPosition,
  currentMonitor,
  getCurrentWindow,
  primaryMonitor,
  type Monitor,
} from "@tauri-apps/api/window";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

const WIDGET_RUNTIME_COLLAPSED_EVENT = "widget-runtime-collapsed";
const WIDGET_RUNTIME_SHOWN_EVENT = "widget-runtime-shown";

export type WidgetSide = "left" | "right";

export type AppWindowLabel = "main" | "widget";

interface RawWidgetPlacement {
  side: WidgetSide;
  anchor_y: number;
}

export interface WidgetPlacement {
  side: WidgetSide;
  anchorY: number;
}

export interface WidgetWindowPosition {
  x: number;
  y: number;
}

export interface WidgetWindowSize {
  width: number;
  height: number;
}

export interface WidgetWindowRect {
  position: WidgetWindowPosition;
  size: WidgetWindowSize;
}

export interface WidgetMonitorLike {
  workArea: {
    position: WidgetWindowPosition;
    size: WidgetWindowSize;
  };
}

function isWidgetSide(value: unknown): value is WidgetSide {
  return value === "left" || value === "right";
}

function isRawWidgetPlacement(value: unknown): value is RawWidgetPlacement {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return isWidgetSide(record.side) && typeof record.anchor_y === "number";
}

function mapRawWidgetPlacement(raw: RawWidgetPlacement): WidgetPlacement {
  return {
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

export async function setWidgetPlacement(side: WidgetSide, anchorY: number): Promise<void> {
  await invoke("cmd_set_widget_placement", {
    side,
    anchorY,
  });
}

export async function applyWidgetLayout(
  side: WidgetSide,
  anchorY: number,
  expanded: boolean,
  showObjectSlot: boolean,
): Promise<void> {
  await invoke("cmd_apply_widget_layout", {
    side,
    anchorY,
    expanded,
    showObjectSlot,
  });
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

export async function readCurrentWidgetWindowRect(): Promise<WidgetWindowRect | null> {
  const currentWindow = getCurrentWindow();
  const visible = await currentWindow.isVisible().catch(() => false);
  if (!visible) {
    return null;
  }

  const [position, size] = await Promise.all([
    currentWindow.outerPosition().catch(() => null),
    currentWindow.outerSize().catch(() => null),
  ]);

  if (!position || !size) {
    return null;
  }

  return {
    position,
    size,
  };
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

function monitorToWidgetMonitor(monitor: Monitor | null): WidgetMonitorLike | null {
  if (!monitor) {
    return null;
  }

  return {
    workArea: monitor.workArea,
  };
}

export async function resolveWidgetMonitorForWindowRect(
  position: WidgetWindowPosition | null,
  size: WidgetWindowSize | null,
): Promise<WidgetMonitorLike | null> {
  const monitors = await availableMonitors().catch(() => []);
  if (position && size && monitors.length > 0) {
    const centerX = position.x + size.width / 2;
    const centerY = position.y + size.height / 2;

    for (const monitor of monitors) {
      const workArea = monitor.workArea;
      if (
        centerX >= workArea.position.x
        && centerX <= (workArea.position.x + workArea.size.width)
        && centerY >= workArea.position.y
        && centerY <= (workArea.position.y + workArea.size.height)
      ) {
        return monitorToWidgetMonitor(monitor);
      }
    }

    let nearestMonitor = monitors[0] ?? null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const monitor of monitors) {
      const workArea = monitor.workArea;
      const workCenterX = workArea.position.x + workArea.size.width / 2;
      const workCenterY = workArea.position.y + workArea.size.height / 2;
      const distance = ((workCenterX - centerX) ** 2) + ((workCenterY - centerY) ** 2);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestMonitor = monitor;
      }
    }

    if (nearestMonitor) {
      return monitorToWidgetMonitor(nearestMonitor);
    }
  }

  const current = await currentMonitor().catch(() => null);
  if (current) {
    return monitorToWidgetMonitor(current);
  }

  return monitorToWidgetMonitor(await primaryMonitor().catch(() => null));
}

export async function onCurrentWidgetWindowMoved(
  handler: () => void,
): Promise<() => void> {
  return getCurrentWindow().onMoved(handler);
}

export async function onCurrentWidgetWindowFocusChanged(
  handler: (focused: boolean) => void,
): Promise<() => void> {
  return getCurrentWindow().onFocusChanged(({ payload }) => {
    handler(payload);
  });
}
