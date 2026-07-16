import { MousePointerClick } from "lucide-react";
import type { ReactNode } from "react";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import QuietStepperSlider from "../../../shared/components/QuietStepperSlider.tsx";
import SettingsPanelHeader from "./SettingsPanelHeader";

type MinuteControlProps = {
  label: string;
  hint: ReactNode;
  minutes: number;
  minMinutes: number;
  maxMinutes: number;
  onMinutesChange: (nextMinutes: number) => void;
};

type SettingsTrackingPanelProps = {
  idleTimeoutControl: MinuteControlProps;
  timelineMergeGapControl: MinuteControlProps;
  trackingPaused: boolean;
  onTrackingPausedChange: (nextChecked: boolean) => void;
  titleRecordingEnabled: boolean;
  onTitleRecordingEnabledChange: (nextChecked: boolean) => void;
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
    <QuietStepperSlider
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

export default function SettingsTrackingPanel({
  idleTimeoutControl,
  timelineMergeGapControl,
  trackingPaused,
  onTrackingPausedChange,
  titleRecordingEnabled,
  onTitleRecordingEnabledChange,
}: SettingsTrackingPanelProps) {
  return (
    <section className="qp-panel min-h-[240px] p-5 md:p-6">
      <SettingsPanelHeader
        icon={<MousePointerClick size={16} className="text-[var(--qp-accent-default)]" />}
        title={UI_TEXT.settings.trackingPanelTitle}
      />

      <div className="mt-5 space-y-5">
        <TrackingMinuteField {...timelineMergeGapControl} />
        <TrackingMinuteField {...idleTimeoutControl} />

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

        <div>
          <label className="text-[11px] font-semibold text-[var(--qp-text-tertiary)] uppercase tracking-[0.06em]">
            {UI_TEXT.settings.globalTitleLabel}
          </label>
          <div className="mt-2 flex items-start justify-between gap-4">
            <p className="text-sm text-[var(--qp-text-secondary)] leading-relaxed">
              {UI_TEXT.settings.globalTitleHint}
            </p>
            <QuietSwitch
              checked={titleRecordingEnabled}
              onChange={onTitleRecordingEnabledChange}
              ariaLabel={UI_TEXT.accessibility.settings.toggleGlobalTitle}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
