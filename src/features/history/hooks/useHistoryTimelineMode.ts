import { useEffect, useRef, useState } from "react";
import { useLocaleText, type UiText } from "../../../shared/i18n/index.ts";
import { effectiveActivityTimelineMode, nextActivityTimelineMode, type ActivityTimelineMode } from "../../../shared/settings/activityDisplaySettings.ts";
import { startHistoryTimelinePreference } from "../services/historyTimelinePreferenceService.ts";

function getModeLabel(mode: ActivityTimelineMode, text: UiText["history"]) {
  if (mode === "app") return text.distributionByApp;
  if (mode === "category") return text.distributionByCategory;
  return text.distributionByWeb;
}

function getModeActionLabel(mode: ActivityTimelineMode, text: UiText["history"]) {
  if (mode === "app") return text.showTimelineByApp;
  if (mode === "category") return text.showTimelineByCategory;
  return text.showTimelineByWeb;
}

export function useHistoryTimelineMode(webActivityEnabled: boolean, onError: (message: string) => void) {
  const UI_TEXT = useLocaleText();
  const [storedMode, setStoredMode] = useState<ActivityTimelineMode>("app");
  const toggle = useRef<() => void>(() => {});
  const failure = useRef(onError);
  failure.current = onError;
  const mode = effectiveActivityTimelineMode(storedMode, webActivityEnabled);
  const nextMode = nextActivityTimelineMode(mode, webActivityEnabled);

  useEffect(() => {
    const runtime = startHistoryTimelinePreference({ webEnabled: webActivityEnabled, accept: setStoredMode,
      failed: (error, writing) => {
        failure.current(writing ? UI_TEXT.settings.saveFailed : UI_TEXT.settings.loadFailed);
        console.warn("history:timeline-mode", error);
      },
    });
    toggle.current = () => { void runtime.toggle(); };
    return runtime.dispose;
  }, [webActivityEnabled, UI_TEXT.settings.loadFailed, UI_TEXT.settings.saveFailed]);

  return {
    mode,
    actionLabel: getModeActionLabel(nextMode, UI_TEXT.history),
    ariaLabel: UI_TEXT.history.timelineModeSwitch(getModeLabel(mode, UI_TEXT.history), getModeLabel(nextMode, UI_TEXT.history)),
    toggleMode: () => toggle.current(),
  };
}
