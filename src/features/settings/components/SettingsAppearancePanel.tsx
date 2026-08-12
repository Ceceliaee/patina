import { LOCALE_METADATA, SUPPORTED_LOCALES, useLocaleText } from "../../../shared/i18n/index.ts";
import { ChevronRight, Palette } from "lucide-react";
import { useRef, useState } from "react";
import QuietBadge from "../../../shared/components/QuietBadge";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietButton from "../../../shared/components/QuietButton";
import QuietSelect from "../../../shared/components/QuietSelect";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import SettingsPanelHeader from "./SettingsPanelHeader";
import type { AppLanguage, ColorScheme, ThemeMode } from "../../../shared/settings/appSettings.ts";
import {
  COLOR_SCHEME_OPTIONS, type ThemeLibrary, } from "../../../shared/settings/colorSchemeOptions.ts";


type SettingsAppearancePanelProps = {
  themeMode: ThemeMode;
  onThemeModeChange: (nextThemeMode: ThemeMode) => void;
  language: AppLanguage;
  onLanguageChange: (nextLanguage: AppLanguage) => void;
  languageDisabled?: boolean;
  colorSchemeLight: ColorScheme;
  onColorSchemeLightChange: (nextColorScheme: ColorScheme) => void;
  colorSchemeDark: ColorScheme;
  onColorSchemeDarkChange: (nextColorScheme: ColorScheme) => void;
  dynamicEffects: boolean;
  onDynamicEffectsChange: (nextChecked: boolean) => void;
  onConfirmColorSchemeChange: (library: ThemeLibrary) => Promise<boolean>;
  colorSchemeConfirming: boolean;
};

export default function SettingsAppearancePanel({
  themeMode,
  onThemeModeChange,
  language,
  onLanguageChange,
  languageDisabled = false,
  colorSchemeLight,
  onColorSchemeLightChange,
  colorSchemeDark,
  onColorSchemeDarkChange,
  dynamicEffects,
  onDynamicEffectsChange,
  onConfirmColorSchemeChange,
  colorSchemeConfirming,
}: SettingsAppearancePanelProps) {
  const UI_TEXT = useLocaleText();
  const selectedSchemeRef = useRef<HTMLButtonElement>(null);
  const [activeLibrary, setActiveLibrary] = useState<ThemeLibrary | null>(null);
  const [dialogSnapshot, setDialogSnapshot] = useState<{
    library: ThemeLibrary;
    colorScheme: ColorScheme;
  } | null>(null);
  const themeModeOptions: Array<{ value: ThemeMode; label: string }> = [
    { value: "light", label: UI_TEXT.settings.themeModeOptions.light },
    { value: "dark", label: UI_TEXT.settings.themeModeOptions.dark },
    { value: "system", label: UI_TEXT.settings.themeModeOptions.system },
  ];
  const languageOptions: Array<{ value: AppLanguage; label: string }> = SUPPORTED_LOCALES.map((value) => ({
    value,
    label: LOCALE_METADATA[value].label,
  }));
  const themeLibraryOptions: Array<{
    value: ThemeLibrary;
    label: string;
  }> = [
    { value: "light", label: UI_TEXT.settings.themeLibraryOptions.light },
    { value: "dark", label: UI_TEXT.settings.themeLibraryOptions.dark },
  ];
  const activeLibraryOption = themeLibraryOptions.find((option) => option.value === activeLibrary);
  const activeColorScheme = activeLibrary === "dark" ? colorSchemeDark : colorSchemeLight;
  const changeActiveColorScheme = activeLibrary === "dark" ? onColorSchemeDarkChange : onColorSchemeLightChange;

  const openColorSchemeDialog = (library: ThemeLibrary) => {
    setDialogSnapshot({
      library,
      colorScheme: library === "dark" ? colorSchemeDark : colorSchemeLight,
    });
    setActiveLibrary(library);
  };

  const closeColorSchemeDialog = () => {
    if (dialogSnapshot) {
      if (dialogSnapshot.library === "dark") {
        onColorSchemeDarkChange(dialogSnapshot.colorScheme);
      } else {
        onColorSchemeLightChange(dialogSnapshot.colorScheme);
      }
    }

    setDialogSnapshot(null);
    setActiveLibrary(null);
  };

  const handleConfirmColorScheme = async () => {
    if (!activeLibrary) return;
    const accepted = await onConfirmColorSchemeChange(activeLibrary);
    if (accepted) {
      setDialogSnapshot(null);
      setActiveLibrary(null);
    }
  };

  return (
    <section className="qp-panel p-5 md:p-6">
      <SettingsPanelHeader
        icon={<Palette size={16} className="text-[var(--qp-accent-default)]" />}
        title={UI_TEXT.settings.appearanceTitle}
      />

      <div className="mt-5 grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_236px] md:gap-4">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]">
            {UI_TEXT.settings.themeModeLabel}
          </label>
          <p className="mt-2 text-sm leading-relaxed text-[var(--qp-text-secondary)]">
            {UI_TEXT.settings.themeModeHint}
          </p>
        </div>

        <QuietSegmentedFilter
          value={themeMode}
          options={themeModeOptions}
          onChange={onThemeModeChange}
          className="md:self-end md:justify-self-end"
        />
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_236px] md:gap-4">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]">
            {UI_TEXT.settings.colorSchemeLabel}
          </label>
          <p className="mt-2 text-sm leading-relaxed text-[var(--qp-text-secondary)]">
            {UI_TEXT.settings.colorSchemeHint}
          </p>
        </div>

        <div
          className="settings-theme-entry-list md:self-end md:justify-self-end"
          role="group"
          aria-label={UI_TEXT.accessibility.settings.colorScheme}
        >
          {themeLibraryOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => openColorSchemeDialog(option.value)}
              className="settings-theme-entry"
            >
              <span className="settings-theme-entry-title">{option.label}</span>
              <ChevronRight size={14} aria-hidden="true" />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_236px] md:gap-4">
        <div>
          <label className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]">
            {UI_TEXT.settings.languageLabel}
          </label>
          <p className="mt-2 text-sm leading-relaxed text-[var(--qp-text-secondary)]">
            {UI_TEXT.settings.languageHint}
          </p>
        </div>

        <QuietSelect
          value={language}
          options={languageOptions}
          onChange={onLanguageChange}
          ariaLabel={UI_TEXT.settings.languageLabel}
          disabled={languageDisabled}
          density="compact"
          className="max-w-full justify-self-start md:self-end md:justify-self-end"
        />
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_236px] md:gap-4">
        <div>
          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]">
            {UI_TEXT.settings.dynamicEffectsLabel}
            <QuietBadge variant="beta" size="compact">{UI_TEXT.settings.betaLabel}</QuietBadge>
          </label>
          <p className="mt-2 text-sm leading-relaxed text-[var(--qp-text-secondary)]">
            {UI_TEXT.settings.dynamicEffectsHint}
          </p>
        </div>

        <div className="md:self-end md:justify-self-end">
          <QuietSwitch
            checked={dynamicEffects}
            ariaLabel={UI_TEXT.settings.dynamicEffectsLabel}
            onChange={onDynamicEffectsChange}
          />
        </div>
      </div>

      <QuietDialog
        open={activeLibrary !== null}
        title={activeLibraryOption?.label ?? UI_TEXT.settings.colorSchemeDialogFallbackTitle}
        description={UI_TEXT.settings.colorSchemeDialogDescription}
        onClose={closeColorSchemeDialog}
        initialFocusRef={selectedSchemeRef}
        surfaceClassName="qp-theme-dialog-surface"
        actions={(
          <>
            <QuietButton
              size="large"
              onClick={closeColorSchemeDialog}
              className="qp-dialog-action"
              disabled={colorSchemeConfirming}
            >
              {UI_TEXT.common.cancel}
            </QuietButton>
            <QuietButton
              tone="primary"
              size="large"
              onClick={() => void handleConfirmColorScheme()}
              busy={colorSchemeConfirming}
              className="qp-dialog-action"
            >
              {colorSchemeConfirming ? UI_TEXT.settings.colorSchemeSaving : UI_TEXT.common.confirm}
            </QuietButton>
          </>
        )}
      >
        {activeLibrary ? (
          <div className="qp-theme-dialog-body qp-scroll-region">
            <div className="settings-color-scheme-list" role="group" aria-label={activeLibraryOption?.label}>
              {COLOR_SCHEME_OPTIONS[activeLibrary].map((option) => {
                const selected = option.value === activeColorScheme;
                return (
                  <button
                    key={option.value}
                    ref={selected ? selectedSchemeRef : undefined}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => changeActiveColorScheme(option.value)}
                    className={`settings-color-scheme-option ${
                      selected ? "settings-color-scheme-option-selected" : ""
                    }`.trim()}
                  >
                    <span className="settings-color-scheme-swatches" aria-hidden="true">
                      {option.swatches.map((swatch, index) => (
                        <span
                          key={`${option.value}-${index}`}
                          className="settings-color-scheme-swatch"
                          style={{ backgroundColor: swatch }}
                        />
                      ))}
                    </span>
                    <span>{option.label ?? UI_TEXT.common.default}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </QuietDialog>
    </section>
  );
}
