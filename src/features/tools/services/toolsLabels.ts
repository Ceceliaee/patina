import type { Locale, UiText } from "../../../shared/i18n/index.ts";
import type { ToolsViewModelLabels } from "../types.ts";

export function buildToolsViewModelLabels(uiText: UiText): ToolsViewModelLabels {
  return {
    pomodoroFocus: uiText.tools.pomodoroPhase.focus,
    pomodoroShortBreak: uiText.tools.pomodoroPhase.shortBreak,
    pomodoroLongBreak: uiText.tools.pomodoroPhase.longBreak,
    chipFocus: uiText.tools.statusChip.focus,
    chipBreak: uiText.tools.statusChip.break,
    chipReminder: uiText.tools.statusChip.reminder,
    completedToday: uiText.tools.completedToday,
    cycle: uiText.tools.pomodoroCycle,
  };
}

export function formatUsageDuration(totalMinutes: number, locale: Locale): string {
  const total = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const unit = (value: number, name: "hour" | "minute") => new Intl.NumberFormat(locale, {
    style: "unit", unit: name, unitDisplay: "long",
  }).formatToParts(value).filter(part => part.type !== "literal").map(part => part.value).join(" ");
  return [hours ? unit(hours, "hour") : "", minutes || !hours ? unit(minutes, "minute") : ""].filter(Boolean).join(" ");
}
