import { useEffect, useState } from "react";
import { useLocaleText, type UiText } from "../../../shared/i18n/index.ts";

import {
  getNextHistoryTimelineMode,
  readHistoryTimelineMode,
  rememberHistoryTimelineMode,
  resolveEffectiveHistoryTimelineMode,
} from "../services/historyLayoutPreferenceStorage.ts";
import type { HistoryTimelineDisplayMode } from "../services/historyTimelineViewModel.ts";

function getModeLabel(mode: HistoryTimelineDisplayMode, text: UiText["history"]) {
  if (mode === "app") return text.distributionByApp;
  if (mode === "category") return text.distributionByCategory;
  return text.distributionByWeb;
}

function getModeActionLabel(mode: HistoryTimelineDisplayMode, text: UiText["history"]) {
  if (mode === "app") return text.showTimelineByApp;
  if (mode === "category") return text.showTimelineByCategory;
  return text.showTimelineByWeb;
}

export function useHistoryTimelineMode(webActivityEnabled: boolean) {
  const UI_TEXT = useLocaleText();
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
    actionLabel: getModeActionLabel(nextMode, UI_TEXT.history),
    ariaLabel: UI_TEXT.history.timelineModeSwitch(
      getModeLabel(mode, UI_TEXT.history),
      getModeLabel(nextMode, UI_TEXT.history),
    ),
    toggleMode,
  };
}
