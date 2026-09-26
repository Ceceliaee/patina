import { useLocaleText } from "../../../shared/i18n/index.ts";
import { MonitorCog } from "lucide-react";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import SettingsPanelHeader from "./SettingsPanelHeader";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "./SettingsPreferenceLayout";


type SettingsResidentPanelProps = {
  minimizeToWidgetChecked: boolean;
  onMinimizeToWidgetChange: (nextChecked: boolean) => void;
  showTrayIconChecked: boolean;
  onShowTrayIconChange: (nextChecked: boolean) => void;
  closeToTrayChecked: boolean;
  onCloseToTrayChange: (nextChecked: boolean) => void;
  backgroundOptimizationChecked: boolean;
  onBackgroundOptimizationChange: (nextChecked: boolean) => void;
  launchAtLoginChecked: boolean;
  onLaunchAtLoginChange: (nextChecked: boolean) => void;
  startMinimizedChecked: boolean;
  onStartMinimizedChange: (nextChecked: boolean) => void;
};

export default function SettingsResidentPanel({
  minimizeToWidgetChecked,
  onMinimizeToWidgetChange,
  showTrayIconChecked,
  onShowTrayIconChange,
  closeToTrayChecked,
  onCloseToTrayChange,
  backgroundOptimizationChecked,
  onBackgroundOptimizationChange,
  launchAtLoginChecked,
  onLaunchAtLoginChange,
  startMinimizedChecked,
  onStartMinimizedChange,
}: SettingsResidentPanelProps) {
  const UI_TEXT = useLocaleText();
  return (
    <section className="qp-panel p-5 md:p-6">
      <SettingsPanelHeader
        icon={<MonitorCog size={16} className="text-[var(--qp-accent-default)]" />}
        title={UI_TEXT.settings.residentTitle}
      />

      <div className="mt-5 space-y-5">
        <SettingsPreferenceGroup title={UI_TEXT.settings.windowBehaviorTitle}>
          <QuietActionRow className="settings-preference-list">
            <SettingsPreferenceRow title={UI_TEXT.settings.minimizeToWidgetLabel}>
              <QuietSwitch
                checked={minimizeToWidgetChecked}
                onChange={onMinimizeToWidgetChange}
                ariaLabel={UI_TEXT.accessibility.settings.toggleMinimizeToWidget}
              />
            </SettingsPreferenceRow>
            <SettingsPreferenceRow title={UI_TEXT.settings.closeToTrayLabel}>
              <QuietSwitch
                checked={closeToTrayChecked}
                onChange={onCloseToTrayChange}
                ariaLabel={UI_TEXT.accessibility.settings.toggleCloseToTray}
              />
            </SettingsPreferenceRow>
            <SettingsPreferenceRow title={UI_TEXT.settings.showTrayIconLabel}>
              <QuietSwitch
                checked={showTrayIconChecked}
                onChange={onShowTrayIconChange}
                ariaLabel={UI_TEXT.accessibility.settings.toggleShowTrayIcon}
              />
            </SettingsPreferenceRow>
          </QuietActionRow>
        </SettingsPreferenceGroup>
        <SettingsPreferenceGroup title={UI_TEXT.settings.runtimeBehaviorTitle}>
          <QuietActionRow className="settings-preference-list">
            <SettingsPreferenceRow title={UI_TEXT.settings.launchAtLoginLabel}>
              <QuietSwitch
                checked={launchAtLoginChecked}
                onChange={onLaunchAtLoginChange}
                ariaLabel={UI_TEXT.accessibility.settings.toggleLaunchAtLogin}
              />
            </SettingsPreferenceRow>
            <SettingsPreferenceRow title={UI_TEXT.settings.startMinimizedLabel}>
              <QuietSwitch
                checked={startMinimizedChecked}
                onChange={onStartMinimizedChange}
                ariaLabel={UI_TEXT.accessibility.settings.toggleStartMinimized}
              />
            </SettingsPreferenceRow>
            <SettingsPreferenceRow title={UI_TEXT.settings.backgroundOptimizationLabel} hint={UI_TEXT.settings.backgroundOptimizationHint}>
              <QuietSwitch
                checked={backgroundOptimizationChecked}
                onChange={onBackgroundOptimizationChange}
                ariaLabel={UI_TEXT.accessibility.settings.toggleBackgroundOptimization}
              />
            </SettingsPreferenceRow>
          </QuietActionRow>
        </SettingsPreferenceGroup>
      </div>
    </section>
  );
}
