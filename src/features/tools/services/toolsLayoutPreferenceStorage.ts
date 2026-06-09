import type { TimerMode } from "../../../shared/types/tools.ts";
import type { ReminderFormMode, ReminderMode, ToolsSection } from "../types.ts";

const TOOLS_SECTION_KEY = "patina:tools-section";
const TOOLS_TIMER_MODE_KEY = "patina:tools-timer-mode";
const TOOLS_REMINDER_MODE_KEY = "patina:tools-reminder-mode";
const TOOLS_REMINDER_FORM_MODE_KEY = "patina:tools-reminder-form-mode";

const LEGACY_TOOLS_SECTION_KEY = "time-tracker:tools-section";
const LEGACY_TOOLS_TIMER_MODE_KEY = "time-tracker:tools-timer-mode";
const LEGACY_TOOLS_REMINDER_MODE_KEY = "time-tracker:tools-reminder-mode";
const LEGACY_TOOLS_REMINDER_FORM_MODE_KEY = "time-tracker:tools-reminder-form-mode";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function readStoredValue<T extends string>(
  key: string,
  legacyKey: string,
  fallback: T,
  isValid: (value: string | null) => value is T,
): T {
  const storage = getStorage();
  if (!storage) return fallback;

  try {
    const value = storage.getItem(key);
    if (isValid(value)) return value;

    const legacyValue = storage.getItem(legacyKey);
    if (!isValid(legacyValue)) return fallback;

    storage.setItem(key, legacyValue);
    storage.removeItem(legacyKey);
    return legacyValue;
  } catch {
    return fallback;
  }
}

function rememberStoredValue(key: string, legacyKey: string, value: string) {
  const storage = getStorage();
  if (!storage) return;

  try {
    storage.setItem(key, value);
    storage.removeItem(legacyKey);
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
  return value === "event" || value === "software";
}

function isReminderFormMode(value: string | null): value is ReminderFormMode {
  return value === "relative" || value === "absolute";
}

export function readToolsSection(): ToolsSection {
  return readStoredValue(TOOLS_SECTION_KEY, LEGACY_TOOLS_SECTION_KEY, "reminders", isToolsSection);
}

export function rememberToolsSection(section: ToolsSection) {
  rememberStoredValue(TOOLS_SECTION_KEY, LEGACY_TOOLS_SECTION_KEY, section);
}

export function readToolsTimerMode(): TimerMode {
  return readStoredValue(TOOLS_TIMER_MODE_KEY, LEGACY_TOOLS_TIMER_MODE_KEY, "stopwatch", isTimerMode);
}

export function rememberToolsTimerMode(mode: TimerMode) {
  rememberStoredValue(TOOLS_TIMER_MODE_KEY, LEGACY_TOOLS_TIMER_MODE_KEY, mode);
}

export function readToolsReminderMode(): ReminderMode {
  return readStoredValue(TOOLS_REMINDER_MODE_KEY, LEGACY_TOOLS_REMINDER_MODE_KEY, "event", isReminderMode);
}

export function rememberToolsReminderMode(mode: ReminderMode) {
  rememberStoredValue(TOOLS_REMINDER_MODE_KEY, LEGACY_TOOLS_REMINDER_MODE_KEY, mode);
}

export function readToolsReminderFormMode(): ReminderFormMode {
  return readStoredValue(
    TOOLS_REMINDER_FORM_MODE_KEY,
    LEGACY_TOOLS_REMINDER_FORM_MODE_KEY,
    "relative",
    isReminderFormMode,
  );
}

export function rememberToolsReminderFormMode(mode: ReminderFormMode) {
  rememberStoredValue(TOOLS_REMINDER_FORM_MODE_KEY, LEGACY_TOOLS_REMINDER_FORM_MODE_KEY, mode);
}
