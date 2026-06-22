import { useEffect, useMemo, useState } from "react";
import type { AppSettings } from "../../../shared/settings/appSettings.ts";
import {
  SettingsRuntimeAdapterService,
  type WebActivityBridgeSnapshot,
} from "../services/settingsRuntimeAdapterService.ts";
import { shouldShowWebActivityHelp } from "../services/webActivitySetupState.ts";

const WEB_ACTIVITY_SETUP_POLL_MS = 5_000;

interface UseWebActivitySetupStateOptions {
  savedSettings: AppSettings | null;
  draftSettings: AppSettings | null;
}

export function useWebActivitySetupState({
  savedSettings,
  draftSettings,
}: UseWebActivitySetupStateOptions) {
  const [snapshot, setSnapshot] = useState<WebActivityBridgeSnapshot | null>(null);

  const setupInput = useMemo(() => ({
    draftEnabled: draftSettings?.webActivityEnabled ?? false,
    draftPort: draftSettings?.webActivityPort ?? 0,
    draftToken: draftSettings?.webActivityToken ?? "",
    savedEnabled: savedSettings?.webActivityEnabled ?? false,
    savedPort: savedSettings?.webActivityPort ?? 0,
    savedToken: savedSettings?.webActivityToken ?? "",
    snapshot,
  }), [
    draftSettings?.webActivityEnabled,
    draftSettings?.webActivityPort,
    draftSettings?.webActivityToken,
    savedSettings?.webActivityEnabled,
    savedSettings?.webActivityPort,
    savedSettings?.webActivityToken,
    snapshot,
  ]);

  const showWebActivityHelp = shouldShowWebActivityHelp(setupInput);

  useEffect(() => {
    if (draftSettings?.webActivityEnabled !== true) {
      setSnapshot(null);
      return undefined;
    }

    let cancelled = false;
    let timeoutId: number | undefined;

    const pollSnapshot = async () => {
      try {
        const nextSnapshot = await SettingsRuntimeAdapterService.getWebActivityBridgeSnapshot();
        if (cancelled) return;
        setSnapshot(nextSnapshot);

        const shouldContinuePolling = shouldShowWebActivityHelp({
          draftEnabled: draftSettings.webActivityEnabled,
          draftPort: draftSettings.webActivityPort,
          draftToken: draftSettings.webActivityToken,
          savedEnabled: savedSettings?.webActivityEnabled ?? false,
          savedPort: savedSettings?.webActivityPort ?? 0,
          savedToken: savedSettings?.webActivityToken ?? "",
          snapshot: nextSnapshot,
        });
        if (shouldContinuePolling) {
          timeoutId = window.setTimeout(pollSnapshot, WEB_ACTIVITY_SETUP_POLL_MS);
        }
      } catch (error) {
        if (cancelled) return;
        console.warn("load web activity bridge snapshot failed", error);
        setSnapshot(null);
        timeoutId = window.setTimeout(pollSnapshot, WEB_ACTIVITY_SETUP_POLL_MS);
      }
    };

    void pollSnapshot();

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    draftSettings?.webActivityEnabled,
    draftSettings?.webActivityPort,
    draftSettings?.webActivityToken,
    savedSettings?.webActivityEnabled,
    savedSettings?.webActivityPort,
    savedSettings?.webActivityToken,
  ]);

  return {
    showWebActivityHelp,
    webActivityBridgeSnapshot: snapshot,
  };
}
