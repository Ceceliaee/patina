import { ChevronRight, Palette } from "lucide-react";
import { useState } from "react";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import type { AppLanguage, ColorScheme, ThemeMode } from "../../../shared/settings/appSettings.ts";
import {
  COLOR_SCHEME_OPTIONS,
  type ThemeLibrary,
} from "../../../shared/settings/colorSchemeOptions.ts";
import { UI_TEXT } from "../../../shared/copy/index.ts";

type SettingsAppearancePanelProps = {
  themeMode: ThemeMode;
  onThemeModeChange: (nextThemeMode: ThemeMode) => void;
  language: AppLanguage;
  onLanguageChange: (nextLanguage: AppLanguage) => void;
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
  colorSchemeLight,
  onColorSchemeLightChange,
  colorSchemeDark,
  onColorSchemeDarkChange,
  dynamicEffects,
  onDynamicEffectsChange,
  onConfirmColorSchemeChange,
  colorSchemeConfirming,
}: SettingsAppearancePanelProps) {
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
  const languageOptions: Array<{ value: AppLanguage; label: string }> = [
    { value: "zh-CN", label: UI_TEXT.settings.languageOptions.zhCN },
    { value: "en-US", label: UI_TEXT.settings.languageOptions.enUS },
  ];
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
      <div className="flex items-center gap-2.5 border-b border-[var(--qp-border-subtle)] pb-2">
        <Palette size={16} className="text-[var(--qp-accent-default)]" />
        <h2 className="text-sm font-semibold text-[var(--qp-text-primary)]">{UI_TEXT.settings.appearanceTitle}</h2>
      </div>

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

        <QuietSegmentedFilter
          value={language}
          options={languageOptions}
          onChange={onLanguageChange}
          className="md:self-end md:justify-self-end"
        />
      </div>

      <div className="mt-5 grid grid-cols-1 items-start gap-3 md:grid-cols-[minmax(0,1fr)_236px] md:gap-4">
        <div>
          <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--qp-text-tertiary)]">
            {UI_TEXT.settings.dynamicEffectsLabel}
            <span className="settings-beta-badge settings-beta-badge-small">{UI_TEXT.settings.betaLabel}</span>
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
        surfaceClassName="qp-theme-dialog-surface"
        actions={(
          <>
            <button
              type="button"
              onClick={closeColorSchemeDialog}
              className="qp-button-secondary qp-dialog-action"
              disabled={colorSchemeConfirming}
            >
              {UI_TEXT.common.cancel}
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmColorScheme()}
              className="qp-button-primary qp-dialog-action"
              disabled={colorSchemeConfirming}
            >
              {colorSchemeConfirming ? UI_TEXT.settings.colorSchemeSaving : UI_TEXT.common.confirm}
            </button>
          </>
        )}
      >
        {activeLibrary ? (
          <div className="qp-theme-dialog-body">
            <div className="settings-color-scheme-list" role="group" aria-label={activeLibraryOption?.label}>
              {COLOR_SCHEME_OPTIONS[activeLibrary].map((option) => {
                const selected = option.value === activeColorScheme;
                return (
                  <button
                    key={option.value}
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
