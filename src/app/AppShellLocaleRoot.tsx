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
  return (
    <LocaleProvider locale={windowTracking.appSettings.language}>
      <UpdateDialogProvider>
        <AppShellContent
          appWindowState={appWindowState}
          windowTracking={windowTracking}
        />
      </UpdateDialogProvider>
    </LocaleProvider>
  );
}
