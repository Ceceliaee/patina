import { useLocaleText } from "../../../shared/i18n/index.ts";
import { Palette } from "lucide-react";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietBadge from "../../../shared/components/QuietBadge";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import SettingsPanelHeader from "./SettingsPanelHeader";
import { SettingsPreferenceGroup, SettingsPreferenceRow } from "./SettingsPreferenceLayout";

type SettingsAppearancePanelProps = {
  dynamicEffects: boolean;
  onDynamicEffectsChange: (nextChecked: boolean) => void;
};

export default function SettingsAppearancePanel({
  dynamicEffects,
  onDynamicEffectsChange,
}: SettingsAppearancePanelProps) {
  const UI_TEXT = useLocaleText();
  return (
    <section className="qp-panel p-5 md:p-6">
      <SettingsPanelHeader
        icon={<Palette size={16} className="text-[var(--qp-accent-default)]" />}
        title={UI_TEXT.settings.appearanceTitle}
      />

      <div className="mt-5 space-y-5">
        <SettingsPreferenceGroup title={UI_TEXT.settings.interfaceGroupTitle}>
          <QuietActionRow className="settings-preference-list">
            <SettingsPreferenceRow title={(
              <>
                {UI_TEXT.settings.dynamicEffectsLabel}
                <QuietBadge variant="beta" size="compact">{UI_TEXT.settings.betaLabel}</QuietBadge>
              </>
            )}>
              <QuietSwitch
                checked={dynamicEffects}
                ariaLabel={UI_TEXT.settings.dynamicEffectsLabel}
                onChange={onDynamicEffectsChange}
              />
            </SettingsPreferenceRow>
          </QuietActionRow>
        </SettingsPreferenceGroup>
      </div>

    </section>
  );
}
