import { useEffect, useState } from "react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import {
  getNextHistoryTimelineMode,
  readHistoryTimelineMode,
  rememberHistoryTimelineMode,
  resolveEffectiveHistoryTimelineMode,
} from "../services/historyLayoutPreferenceStorage.ts";
import type { HistoryTimelineDisplayMode } from "../services/historyTimelineViewModel.ts";

function getModeLabel(mode: HistoryTimelineDisplayMode) {
  if (mode === "app") return UI_TEXT.history.distributionByApp;
  if (mode === "category") return UI_TEXT.history.distributionByCategory;
  return UI_TEXT.history.distributionByWeb;
}

function getModeActionLabel(mode: HistoryTimelineDisplayMode) {
  if (mode === "app") return UI_TEXT.history.showTimelineByApp;
  if (mode === "category") return UI_TEXT.history.showTimelineByCategory;
  return UI_TEXT.history.showTimelineByWeb;
}

export function useHistoryTimelineMode(webActivityEnabled: boolean) {
  const [storedMode, setStoredMode] = useState<HistoryTimelineDisplayMode>(
    readHistoryTimelineMode,
  );
  const mode = resolveEffectiveHistoryTimelineMode(storedMode, webActivityEnabled);
  const nextMode = getNextHistoryTimelineMode(mode, webActivityEnabled);

  useEffect(() => {
    if (webActivityEnabled || storedMode !== "web") return;

    setStoredMode("app");
    rememberHistoryTimelineMode("app");
  }, [storedMode, webActivityEnabled]);

  const toggleMode = () => {
    setStoredMode((currentMode) => {
      const effectiveMode = resolveEffectiveHistoryTimelineMode(
        currentMode,
        webActivityEnabled,
      );
      const next = getNextHistoryTimelineMode(effectiveMode, webActivityEnabled);
      rememberHistoryTimelineMode(next);
      return next;
    });
  };

  return {
    mode,
    actionLabel: getModeActionLabel(nextMode),
    ariaLabel: UI_TEXT.history.timelineModeSwitch(
      getModeLabel(mode),
      getModeLabel(nextMode),
    ),
    toggleMode,
  };
}
