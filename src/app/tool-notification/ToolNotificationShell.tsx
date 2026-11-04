import { LocaleProvider } from "../../shared/i18n/index.ts";
import { normalizeSettingsRecord } from "../../shared/settings/appSettingsNormalization.ts";
import { useAppThemeMode } from "../hooks/useAppThemeMode.ts";
import { useToolPresentation } from "../../features/tools/hooks/useToolPresentation.ts";
import ToolAlertDialog from "../../features/tools/components/ToolAlertDialog.tsx";

export default function ToolNotificationShell() {
  const { snapshot } = useToolPresentation();
  const settings = normalizeSettingsRecord(snapshot?.appearance ?? {});
  useAppThemeMode(settings.themeMode, settings.colorSchemeLight, settings.colorSchemeDark);
  return <LocaleProvider locale={settings.language}><ToolAlertDialog notification /></LocaleProvider>;
}
