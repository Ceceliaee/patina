import { MousePointerClick } from "lucide-react";
import type { ReactNode } from "react";
import QuietSwitch from "../../../shared/components/QuietSwitch";
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

type SecondControlProps = {
  label: string;
  hint: ReactNode;
  seconds: number;
  minSeconds: number;
  maxSeconds: number;
  onSecondsChange: (nextSeconds: number) => void;
};

type SettingsTrackingPanelProps = {
  idleTimeoutControl: MinuteControlProps;
  timelineMergeGapControl: MinuteControlProps;
  sustainedParticipationGraceWindowControl: SecondControlProps;
  trackingPaused: boolean;
  onTrackingPausedChange: (nextChecked: boolean) => void;
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

function TrackingMinuteField({
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

function TrackingSecondField({
  label,
  hint,
  seconds,
  minSeconds,
  maxSeconds,
  onSecondsChange,
}: SecondControlProps) {
  return (
    <div>
      <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">{label}</label>
      <div className="mt-2 grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_minmax(240px,260px)] md:gap-4">
        <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">{hint}</p>
        <SettingsStepperSlider
          ariaLabel={label}
          value={seconds}
          min={minSeconds}
          max={maxSeconds}
          step={3}
          displayValue={`${seconds}s`}
          decreaseAriaLabel={`Decrease ${label}`}
          increaseAriaLabel={`Increase ${label}`}
          onChange={onSecondsChange}
        />
      </div>
    </div>
  );
}

export default function SettingsTrackingPanel({
  idleTimeoutControl,
  timelineMergeGapControl,
  sustainedParticipationGraceWindowControl,
  trackingPaused,
  onTrackingPausedChange,
}: SettingsTrackingPanelProps) {
  return (
    <section className="qp-panel min-h-[240px] p-5 md:p-6">
      <div className="flex items-center gap-2.5 pb-2 border-b border-[var(--qp-border-subtle)]">
        <MousePointerClick size={16} className="text-[var(--qp-accent-default)]" />
        <h2 className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.trackingPanelTitle}</h2>
      </div>

      <div className="mt-5 space-y-5">
        <TrackingMinuteField {...timelineMergeGapControl} />
        <TrackingMinuteField {...idleTimeoutControl} />
        <TrackingSecondField {...sustainedParticipationGraceWindowControl} />

        <div>
          <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">
            {UI_TEXT.settings.trackingPausedLabel}
          </label>
          <div className="mt-2 flex items-start justify-between gap-4">
            <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">
              {UI_TEXT.settings.trackingPausedHint}
            </p>
            <QuietSwitch
              checked={trackingPaused}
              onChange={onTrackingPausedChange}
              ariaLabel={UI_TEXT.accessibility.settings.toggleTrackingPaused}
              tone="warning"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
