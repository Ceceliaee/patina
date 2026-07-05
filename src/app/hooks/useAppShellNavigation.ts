import { useCallback, useEffect, useRef, useState } from "react";
import { UI_TEXT } from "../../shared/copy/index.ts";
import type { View } from "../types/view";
import {
  consumePendingUpdateRelaunchView,
  readLastActiveView,
  rememberLastActiveView,
} from "../services/updateRelaunchViewStorage.ts";
import { shouldReturnHomeAfterBackground } from "../services/backgroundReturnHomePolicy.ts";

type SaveHandler = (() => Promise<boolean>) | null;

type NavigationResult = {
  navigated: boolean;
};

interface ConfirmDialogOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
}

interface UseAppShellNavigationParams {
  confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
}

interface ViewDirtyState {
  settings: boolean;
  mapping: boolean;
}

const INITIAL_DIRTY_STATE: ViewDirtyState = {
  settings: false,
  mapping: false,
};

export function useAppShellNavigation({ confirm }: UseAppShellNavigationParams) {
  const settingsSaveHandlerRef = useRef<SaveHandler>(null);
  const mappingSaveHandlerRef = useRef<SaveHandler>(null);
  const [currentView, setCurrentView] = useState<View>(
    () => consumePendingUpdateRelaunchView() ?? readLastActiveView() ?? "dashboard",
  );
  const [viewDirtyState, setViewDirtyState] = useState<ViewDirtyState>(INITIAL_DIRTY_STATE);

  useEffect(() => {
    rememberLastActiveView(currentView);
  }, [currentView]);

  const registerSettingsSaveHandler = useCallback((handler: SaveHandler) => {
    settingsSaveHandlerRef.current = handler;
  }, []);

  const registerMappingSaveHandler = useCallback((handler: SaveHandler) => {
    mappingSaveHandlerRef.current = handler;
  }, []);

  const setSettingsDirty = useCallback((dirty: boolean) => {
    setViewDirtyState((current) => ({ ...current, settings: dirty }));
  }, []);

  const setMappingDirty = useCallback((dirty: boolean) => {
    setViewDirtyState((current) => ({ ...current, mapping: dirty }));
  }, []);

  const resetToDashboardAfterLongBackground = useCallback((backgroundDurationMs: number): boolean => {
    const hasDirtyDraft = viewDirtyState.settings || viewDirtyState.mapping;
    const shouldReset = shouldReturnHomeAfterBackground({
      backgroundDurationMs,
      currentView,
      hasDirtyDraft,
    });

    if (!shouldReset) return false;

    setCurrentView("dashboard");
    return true;
  }, [currentView, viewDirtyState]);

  const handleNavigate = useCallback(async (nextView: View): Promise<NavigationResult> => {
    if (nextView === currentView) {
      return { navigated: true };
    }

    const hasUnsavedChanges = viewDirtyState.settings || viewDirtyState.mapping;
    if (!hasUnsavedChanges) {
      setCurrentView(nextView);
      return { navigated: true };
    }

    const confirmed = await confirm({
      title: UI_TEXT.app.unsavedConfirmTitle,
      description: UI_TEXT.app.unsavedConfirmBody,
      confirmLabel: UI_TEXT.app.unsavedConfirmSave,
    });
    if (!confirmed) {
      return { navigated: false };
    }

    const saveHandler = currentView === "settings"
      ? settingsSaveHandlerRef.current
      : currentView === "mapping"
        ? mappingSaveHandlerRef.current
        : null;
    const didSave = saveHandler ? await saveHandler() : false;
    if (!didSave) {
      return { navigated: false };
    }

    setViewDirtyState((current) => {
      if (currentView === "settings") {
        return { ...current, settings: false };
      }
      if (currentView === "mapping") {
        return { ...current, mapping: false };
      }
      return current;
    });
    setCurrentView(nextView);
    return { navigated: true };
  }, [confirm, currentView, viewDirtyState]);

  return {
    currentView,
    handleNavigate,
    registerSettingsSaveHandler,
    registerMappingSaveHandler,
    resetToDashboardAfterLongBackground,
    setSettingsDirty,
    setMappingDirty,
  };
}
