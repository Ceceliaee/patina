import { Wrench } from "lucide-react";
import type { ReactNode } from "react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import SettingsStepperSlider from "./SettingsStepperSlider";

type MinuteControlProps = {
  label: string;
  hint: ReactNode;
  minutes: number;
  minMinutes: number;
  maxMinutes: number;
  onMinutesChange: (nextMinutes: number) => void;
};

type SettingsToolsPanelProps = {
  reminderSnoozeMinutes: number;
  pomodoroSnoozeMinutes: number;
  countdownSnoozeMinutes: number;
  onReminderSnoozeMinutesChange: (nextMinutes: number) => void;
  onPomodoroSnoozeMinutesChange: (nextMinutes: number) => void;
  onCountdownSnoozeMinutesChange: (nextMinutes: number) => void;
};

type MinuteStepperSliderProps = {
  ariaLabel: string;
  minutes: number;
  minMinutes: number;
  maxMinutes: number;
  onMinutesChange: (nextMinutes: number) => void;
};

function MinuteStepperSlider({
  ariaLabel,
  minutes,
  minMinutes,
  maxMinutes,
  onMinutesChange,
}: MinuteStepperSliderProps) {
  return (
    <SettingsStepperSlider
      ariaLabel={ariaLabel}
      value={minutes}
      min={minMinutes}
      max={maxMinutes}
      displayValue={UI_TEXT.settings.minuteValue(minutes)}
      decreaseAriaLabel={UI_TEXT.settings.decreaseMinute(ariaLabel)}
      increaseAriaLabel={UI_TEXT.settings.increaseMinute(ariaLabel)}
      onChange={onMinutesChange}
    />
  );
}

function ToolMinuteField({
  label,
  hint,
  minutes,
  minMinutes,
  maxMinutes,
  onMinutesChange,
}: MinuteControlProps) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">{label}</label>
      <div className="mt-2 grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,260px)] md:gap-4">
        <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">{hint}</p>
        <MinuteStepperSlider
          ariaLabel={label}
          minutes={minutes}
          minMinutes={minMinutes}
          maxMinutes={maxMinutes}
          onMinutesChange={onMinutesChange}
        />
      </div>
    </div>
  );
}

export default function SettingsToolsPanel({
  reminderSnoozeMinutes,
  pomodoroSnoozeMinutes,
  countdownSnoozeMinutes,
  onReminderSnoozeMinutesChange,
  onPomodoroSnoozeMinutesChange,
  onCountdownSnoozeMinutesChange,
}: SettingsToolsPanelProps) {
  return (
    <section className="qp-panel min-h-[240px] p-5 md:p-6">
      <div className="flex items-center gap-2.5 pb-2 border-b border-[var(--qp-border-subtle)]">
        <Wrench size={16} className="text-[var(--qp-accent-default)]" />
        <h2 className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.toolsTitle}</h2>
      </div>

      <div className="mt-5 space-y-5">
        <ToolMinuteField
          label={UI_TEXT.settings.reminderSnoozeLabel}
          hint={UI_TEXT.settings.reminderSnoozeHint}
          minutes={reminderSnoozeMinutes}
          minMinutes={1}
          maxMinutes={60}
          onMinutesChange={onReminderSnoozeMinutesChange}
        />
        <ToolMinuteField
          label={UI_TEXT.settings.pomodoroSnoozeLabel}
          hint={UI_TEXT.settings.pomodoroSnoozeHint}
          minutes={pomodoroSnoozeMinutes}
          minMinutes={1}
          maxMinutes={60}
          onMinutesChange={onPomodoroSnoozeMinutesChange}
        />
        <ToolMinuteField
          label={UI_TEXT.settings.countdownSnoozeLabel}
          hint={UI_TEXT.settings.countdownSnoozeHint}
          minutes={countdownSnoozeMinutes}
          minMinutes={1}
          maxMinutes={60}
          onMinutesChange={onCountdownSnoozeMinutesChange}
        />
      </div>
    </section>
  );
}
