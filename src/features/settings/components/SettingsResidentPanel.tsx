import { MonitorCog } from "lucide-react";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import SettingsPanelHeader from "./SettingsPanelHeader";
import { UI_TEXT } from "../../../shared/copy/index.ts";

type SettingsResidentPanelProps = {
  minimizeToWidgetChecked: boolean;
  onMinimizeToWidgetChange: (nextChecked: boolean) => void;
  closeToTrayChecked: boolean;
  onCloseToTrayChange: (nextChecked: boolean) => void;
  backgroundOptimizationChecked: boolean;
  onBackgroundOptimizationChange: (nextChecked: boolean) => void;
  launchAtLoginChecked: boolean;
  onLaunchAtLoginChange: (nextChecked: boolean) => void;
  startMinimizedChecked: boolean;
  startMinimizedDisabled: boolean;
  onStartMinimizedChange: (nextChecked: boolean) => void;
};

export default function SettingsResidentPanel({
  minimizeToWidgetChecked,
  onMinimizeToWidgetChange,
  closeToTrayChecked,
  onCloseToTrayChange,
  backgroundOptimizationChecked,
  onBackgroundOptimizationChange,
  launchAtLoginChecked,
  onLaunchAtLoginChange,
  startMinimizedChecked,
  startMinimizedDisabled,
  onStartMinimizedChange,
}: SettingsResidentPanelProps) {
  return (
    <section className="qp-panel min-h-[220px] p-5 md:p-6">
      <SettingsPanelHeader
        icon={<MonitorCog size={16} className="text-[var(--qp-accent-default)]" />}
        title={UI_TEXT.settings.residentTitle}
      />

      <div className="mt-5 space-y-5">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]">
            {UI_TEXT.settings.minimizeToWidgetLabel}
          </label>
          <div className="mt-2 flex items-start justify-between gap-4">
            <p className="text-sm leading-relaxed text-[var(--qp-text-secondary)]">
              {UI_TEXT.settings.minimizeToWidgetHint}
            </p>
            <QuietSwitch
              checked={minimizeToWidgetChecked}
              onChange={onMinimizeToWidgetChange}
              ariaLabel={UI_TEXT.accessibility.settings.toggleMinimizeToWidget}
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]">
            {UI_TEXT.settings.closeToTrayLabel}
          </label>
          <div className="mt-2 flex items-start justify-between gap-4">
            <p className="text-sm leading-relaxed text-[var(--qp-text-secondary)]">
              {UI_TEXT.settings.closeToTrayHint}
            </p>
            <QuietSwitch
              checked={closeToTrayChecked}
              onChange={onCloseToTrayChange}
              ariaLabel={UI_TEXT.accessibility.settings.toggleCloseToTray}
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]">
            {UI_TEXT.settings.launchAtLoginLabel}
          </label>
          <div className="mt-2 flex items-start justify-between gap-4">
            <p className="text-sm leading-relaxed text-[var(--qp-text-secondary)]">
              {UI_TEXT.settings.launchAtLoginHint}
            </p>
            <QuietSwitch
              checked={launchAtLoginChecked}
              onChange={onLaunchAtLoginChange}
              ariaLabel={UI_TEXT.accessibility.settings.toggleLaunchAtLogin}
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]">
            {UI_TEXT.settings.startMinimizedLabel}
          </label>
          <div className="mt-2 flex items-start justify-between gap-4">
            <p className="text-sm leading-relaxed text-[var(--qp-text-secondary)]">
              {UI_TEXT.settings.startMinimizedHint}
            </p>
            <QuietSwitch
              checked={startMinimizedChecked}
              disabled={startMinimizedDisabled}
              onChange={onStartMinimizedChange}
              ariaLabel={UI_TEXT.accessibility.settings.toggleStartMinimized}
            />
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]">
            {UI_TEXT.settings.backgroundOptimizationLabel}
          </label>
          <div className="mt-2 flex items-start justify-between gap-4">
            <p className="text-sm leading-relaxed text-[var(--qp-text-secondary)]">
              {UI_TEXT.settings.backgroundOptimizationHint}
            </p>
            <QuietSwitch
              checked={backgroundOptimizationChecked}
              onChange={onBackgroundOptimizationChange}
              ariaLabel={UI_TEXT.accessibility.settings.toggleBackgroundOptimization}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
