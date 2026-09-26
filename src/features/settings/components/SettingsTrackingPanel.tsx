import { useLocaleText } from "../../../shared/i18n/index.ts";
import { MousePointerClick } from "lucide-react";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import QuietActionRow from "../../../shared/components/QuietActionRow";

import QuietStepperSlider from "../../../shared/components/QuietStepperSlider.tsx";
import SettingsPanelHeader from "./SettingsPanelHeader";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "./SettingsPreferenceLayout";

type MinuteControlProps = {
  label: string;
  hint: string;
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
  const UI_TEXT = useLocaleText();
  return (
    <QuietStepperSlider
      className="settings-minute-control"
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
    <SettingsPreferenceRow title={label} hint={hint} stacked>
      <div className="settings-preference-slider">
        <MinuteStepperSlider
          ariaLabel={label}
          minutes={minutes}
          minMinutes={minMinutes}
          maxMinutes={maxMinutes}
          onMinutesChange={onMinutesChange}
        />
      </div>
    </SettingsPreferenceRow>
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
  const UI_TEXT = useLocaleText();
  return (
    <section className="qp-panel p-5 md:p-6">
      <SettingsPanelHeader
        icon={<MousePointerClick size={16} className="text-[var(--qp-accent-default)]" />}
        title={UI_TEXT.settings.trackingPanelTitle}
      />

      <div className="mt-5 space-y-5">
        <SettingsPreferenceGroup title={UI_TEXT.settings.timeRulesTitle}>
          <QuietActionRow className="settings-preference-list">
            <TrackingMinuteField {...timelineMergeGapControl} />
            <TrackingMinuteField {...idleTimeoutControl} />
          </QuietActionRow>
        </SettingsPreferenceGroup>
        <SettingsPreferenceGroup title={UI_TEXT.settings.recordingOptionsTitle}>
          <QuietActionRow className="settings-preference-list settings-recording-options">
            <SettingsPreferenceRow title={UI_TEXT.settings.trackingPausedLabel}>
              <QuietSwitch
                checked={trackingPaused}
                onChange={onTrackingPausedChange}
                ariaLabel={UI_TEXT.accessibility.settings.toggleTrackingPaused}
              />
            </SettingsPreferenceRow>
            <SettingsPreferenceRow title={UI_TEXT.settings.globalTitleLabel} hint={UI_TEXT.settings.globalTitleHint}>
              <QuietSwitch
                checked={titleRecordingEnabled}
                onChange={onTitleRecordingEnabledChange}
                ariaLabel={UI_TEXT.accessibility.settings.toggleGlobalTitle}
              />
            </SettingsPreferenceRow>
          </QuietActionRow>
        </SettingsPreferenceGroup>
      </div>
    </section>
  );
}
