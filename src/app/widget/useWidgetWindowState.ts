import { useEffect, useMemo, useState } from "react";
import {
  PhysicalPosition,
  PhysicalSize,
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  primaryMonitor,
  type Monitor,
} from "@tauri-apps/api/window";
import {
  applyWidgetLayout,
  getWidgetPlacement,
  setWidgetExpanded,
  type WidgetPlacement,
} from "../../platform/desktop/widgetRuntimeGateway";
import {
  clampWidgetAnchorY,
  createWidgetWindowController,
  DEFAULT_WIDGET_PLACEMENT,
} from "./widgetWindowController.ts";

export const WIDGET_EXPANDED_WIDTH_WITH_OBJECT = 148;
export const WIDGET_EXPANDED_WIDTH_COMPACT = 116;
export const WIDGET_EXPANDED_HEIGHT = 48;
export const WIDGET_COLLAPSED_WIDTH = 34;
export const WIDGET_COLLAPSED_HEIGHT = 48;

async function resolveMonitorForWindowRect(
  position: PhysicalPosition | null,
  size: PhysicalSize | null,
): Promise<Monitor | null> {
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
        return monitor;
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
      return nearestMonitor;
    }
  }

  const current = await currentMonitor().catch(() => null);
  if (current) {
    return current;
  }

  return primaryMonitor().catch(() => null);
}

export function useWidgetWindowState(showObjectSlot: boolean) {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [placement, setPlacementState] = useState<WidgetPlacement>(DEFAULT_WIDGET_PLACEMENT);
  const [expanded, setExpandedState] = useState(false);
  const controller = useMemo(() => createWidgetWindowController(showObjectSlot, {
    loadPlacement: getWidgetPlacement,
    persistExpanded: setWidgetExpanded,
    applyLayout: async (nextPlacement, nextExpanded, nextShowObjectSlot) => {
      await applyWidgetLayout(
        nextPlacement.side,
        nextPlacement.anchor_y,
        nextExpanded,
        nextShowObjectSlot,
      );
    },
    readWindowRect: async () => {
      const [position, size] = await Promise.all([
        appWindow.outerPosition().catch(() => null),
        appWindow.outerSize().catch(() => null),
      ]);
      if (!position || !size) {
        return null;
      }

      return {
        position,
        size,
      };
    },
    resolveMonitorForWindowRect: async (position, size) => {
      const monitor = await resolveMonitorForWindowRect(
        new PhysicalPosition(position.x, position.y),
        new PhysicalSize(size.width, size.height),
      );
      if (!monitor) {
        return null;
      }

      return {
        workArea: monitor.workArea,
      };
    },
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearScheduled: (handle) => window.clearTimeout(handle),
    onPlacementChange: (nextPlacement) => {
      setPlacementState({
        side: nextPlacement.side,
        anchor_y: clampWidgetAnchorY(nextPlacement.anchor_y),
      });
    },
    onExpandedChange: setExpandedState,
    onWarning: (message, error) => {
      console.warn(message, error);
    },
  }), [appWindow]);

  useEffect(() => {
    let cancelled = false;
    const unlistenPromises: Array<Promise<() => void>> = [];

    void appWindow.setFocusable(true).catch((error) => {
      console.warn("widget set focusable failed", error);
    });

    void controller.initialize().then(() => {
      if (cancelled) {
        controller.dispose();
      }
    });

    unlistenPromises.push(appWindow.onMoved(() => {
      controller.handleWindowMoved();
    }));

    unlistenPromises.push(appWindow.onFocusChanged(({ payload: focused }) => {
      controller.handleFocusChanged(focused);
    }));

    return () => {
      cancelled = true;
      controller.dispose();
      for (const promise of unlistenPromises) {
        void promise.then((unlisten) => {
          unlisten();
        });
      }
    };
  }, [appWindow, controller]);

  useEffect(() => {
    controller.setShowObjectSlot(showObjectSlot);
  }, [controller, showObjectSlot]);

  return {
    collapse: controller.collapse,
    expand: controller.expand,
    expanded,
    placement,
    toggleExpanded: controller.toggleExpanded,
  };
}
