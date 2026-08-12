import type { TimerMode } from "../../../shared/types/tools.ts";
import type { ReminderFormMode, ReminderMode, ToolsSection } from "../types.ts";
import { getBrowserLocalStorage } from "../../../platform/browser/browserStorageGateway.ts";

const TOOLS_SECTION_KEY = "patina:tools-section";
const TOOLS_TIMER_MODE_KEY = "patina:tools-timer-mode";
const TOOLS_REMINDER_MODE_KEY = "patina:tools-reminder-mode";
const TOOLS_REMINDER_FORM_MODE_KEY = "patina:tools-reminder-form-mode";

function readStoredValue<T extends string>(
  key: string,
  fallback: T,
  isValid: (value: string | null) => value is T,
): T {
  const storage = getBrowserLocalStorage();
  if (!storage) return fallback;

  try {
    const value = storage.getItem(key);
    return isValid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function rememberStoredValue(key: string, value: string) {
  const storage = getBrowserLocalStorage();
  if (!storage) return;

  try {
    storage.setItem(key, value);
  } catch {
    // Tool UI preferences are best-effort; never block the interaction.
  }
}

function isTimerMode(value: string | null): value is TimerMode {
  return value === "stopwatch" || value === "countdown";
}

function isToolsSection(value: string | null): value is ToolsSection {
  return value === "reminders" || value === "timer" || value === "pomodoro";
}

function isReminderMode(value: string | null): value is ReminderMode {
  return value === "event" || value === "app" || value === "category" || value === "web";
}

function isReminderFormMode(value: string | null): value is ReminderFormMode {
  return value === "relative" || value === "absolute";
}

export function readToolsSection(): ToolsSection {
  return readStoredValue(TOOLS_SECTION_KEY, "reminders", isToolsSection);
}

export function rememberToolsSection(section: ToolsSection) {
  rememberStoredValue(TOOLS_SECTION_KEY, section);
}

export function readToolsTimerMode(): TimerMode {
  return readStoredValue(TOOLS_TIMER_MODE_KEY, "stopwatch", isTimerMode);
}

export function rememberToolsTimerMode(mode: TimerMode) {
  rememberStoredValue(TOOLS_TIMER_MODE_KEY, mode);
}

export function readToolsReminderMode(): ReminderMode {
  const storage = getBrowserLocalStorage();
  if (!storage) return "event";
  try {
    const value = storage.getItem(TOOLS_REMINDER_MODE_KEY);
    if (value === "software") {
      rememberStoredValue(TOOLS_REMINDER_MODE_KEY, "app");
      return "app";
    }
    return isReminderMode(value) ? value : "event";
  } catch {
    return "event";
  }
}

export function rememberToolsReminderMode(mode: ReminderMode) {
  rememberStoredValue(TOOLS_REMINDER_MODE_KEY, mode);
}

export function readToolsReminderFormMode(): ReminderFormMode {
  return readStoredValue(
    TOOLS_REMINDER_FORM_MODE_KEY,
    "relative",
    isReminderFormMode,
  );
}

export function rememberToolsReminderFormMode(mode: ReminderFormMode) {
  rememberStoredValue(TOOLS_REMINDER_FORM_MODE_KEY, mode);
}
