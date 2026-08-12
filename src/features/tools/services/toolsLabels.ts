import { type UiText } from "../../../shared/i18n/index.ts";
import type { ToolsViewModelLabels } from "../types.ts";

export function buildToolsViewModelLabels(uiText: UiText): ToolsViewModelLabels {
  return {
    timerIdle: uiText.tools.timerStatus.idle,
    timerRunning: uiText.tools.timerStatus.running,
    timerPaused: uiText.tools.timerStatus.paused,
    timerCompleted: uiText.tools.timerStatus.completed,
    pomodoroFocus: uiText.tools.pomodoroPhase.focus,
    pomodoroShortBreak: uiText.tools.pomodoroPhase.shortBreak,
    pomodoroLongBreak: uiText.tools.pomodoroPhase.longBreak,
    chipFocus: uiText.tools.statusChip.focus,
    chipBreak: uiText.tools.statusChip.break,
    chipCountdown: uiText.tools.statusChip.countdown,
    chipStopwatch: uiText.tools.statusChip.stopwatch,
    chipReminder: uiText.tools.statusChip.reminder,
    activityReminderActive: uiText.tools.activityReminderActive,
    activityReminderDailyLimit: uiText.tools.activityReminderDailyLimit,
    dueNow: uiText.tools.dueNow,
    completedToday: uiText.tools.completedToday,
    cycle: uiText.tools.pomodoroCycle,
  };
}
