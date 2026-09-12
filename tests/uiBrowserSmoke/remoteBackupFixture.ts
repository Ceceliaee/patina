import { createElement, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { LocaleProvider } from "../../src/shared/i18n/index.ts";
import { useRemoteBackupState, type RemoteBackupEntry, type RemoteBackupState } from "../../src/features/settings/hooks/useRemoteBackupState.ts";
import { restoreBackup } from "../../src/platform/backup/backupRuntimeGateway.ts";

// Keep the production hook and gateways. Only its caller-owned confirmation,
// notification and reload callbacks are observed by this browser fixture.
export function mountRemoteBackupProbe(accepted: boolean) {
  const host = document.createElement("div");
  host.id = "remote-backup-recovery-probe";
  document.body.append(host);
  const root = createRoot(host);
  const events: Array<{ kind: string; message?: string; tone?: string }> = [];
  const originalError = console.error;
  const originalLanguage = document.documentElement.lang;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => {
    if (args[0] === "restore WebDAV backup failed" || args[0] === "cleanup WebDAV backup temp failed") {
      errors.push(String(args[0]));
    } else originalError(...args);
  };
  let current: RemoteBackupState | null = null;
  const entry: RemoteBackupEntry = {
    id: "recovery-fixture", fileName: "fixture.zip", remotePath: "/Patina/fixture.zip",
    createdAtMs: 1, sizeBytes: 100, appVersion: "test", formatKind: "sqlite_snapshot",
    backupVersion: 1, schemaVersion: 1, sessionCount: 1, titleSampleCount: 0,
    importBatchCount: 0, importExactSessionCount: 0, importTimeBucketCount: 0,
    settingCount: 0, iconCacheCount: 0,
  };
  const options = {
    confirm: async () => { events.push({ kind: "confirm" }); return accepted; },
    notify: (message: string, tone?: string) => events.push({ kind: "notify", message, tone }),
    restoreBackup,
    reload: () => { events.push({ kind: "reload" }); },
  };
  function Probe() {
    const state = useRemoteBackupState(options);
    useEffect(() => { current = state; }, [state]);
    return createElement("button", {
      disabled: state.loading || state.isDownloading,
      onClick: () => void state.restoreEntry(entry, "replace"),
    }, "Restore fixture");
  }
  root.render(createElement(LocaleProvider, { locale: "zh-CN", children: createElement(Probe) }));
  return {
    read: () => ({ ready: Boolean(current?.config && !current.loading),
      busy: current?.isDownloading ?? false, events: [...events], errors: [...errors] }),
    dispose: () => {
      root.unmount(); host.remove(); console.error = originalError;
      document.documentElement.lang = originalLanguage;
    },
  };
}
