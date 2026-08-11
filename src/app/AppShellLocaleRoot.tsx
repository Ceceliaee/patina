import { useCallback, useState } from "react";
import type { AppLanguage } from "../shared/settings/appSettings.ts";
import { LocaleProvider } from "../shared/i18n/index.ts";
import UpdateDialogProvider from "./providers/UpdateDialogProvider.tsx";
import AppShellContent from "./AppShell.tsx";
import { useAppWindowState } from "./hooks/useAppWindowState.ts";
import { useWindowTracking } from "./hooks/useWindowTracking.ts";

export default function AppShellLocaleRoot() {
  const appWindowState = useAppWindowState();
  const windowTracking = useWindowTracking({
    trackerHealthPollingEnabled: appWindowState.isForegroundReady,
  });
  const [settingsLanguagePreview, setSettingsLanguagePreview] = useState<AppLanguage | null>(null);
  const locale = settingsLanguagePreview ?? windowTracking.appSettings.language;
  const handleLocaleLoadError = useCallback((failedLocale: AppLanguage) => {
    setSettingsLanguagePreview((current) => current === failedLocale ? null : current);
  }, []);

  return (
    <LocaleProvider locale={locale} onLocaleLoadError={handleLocaleLoadError}>
      <UpdateDialogProvider>
        <AppShellContent
          appWindowState={appWindowState}
          setSettingsLanguagePreview={setSettingsLanguagePreview}
          windowTracking={windowTracking}
        />
      </UpdateDialogProvider>
    </LocaleProvider>
  );
}
