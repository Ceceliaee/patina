import { useCallback, useEffect, useState } from "react";
import type { UpdateSnapshot } from "../../shared/types/update";
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateSnapshot,
  installUpdate,
  onUpdateSnapshotChanged,
} from "../../platform/runtime/updateRuntimeGateway";
import { openExternalUrl } from "../../platform/desktop/externalUrlGateway";
import { shouldShowCompactUpdateEntry } from "../../features/update/services/updateViewModel";
import {
  clearPendingUpdateRelaunchViewRestore,
  markPendingUpdateRelaunchViewRestore,
} from "../services/updateRelaunchViewStorage";

function createFallbackSnapshot(): UpdateSnapshot {
  return {
    currentVersion: "0.0.0",
    status: "idle",
    latestVersion: null,
    releaseNotes: null,
    releaseDate: null,
    errorMessage: null,
    errorStage: null,
    downloadedBytes: null,
    totalBytes: null,
    releasePageUrl: null,
    assetDownloadUrl: null,
  };
}

export function useUpdateState() {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>(createFallbackSnapshot);
  const [dialogOpen, setDialogOpen] = useState(false);
  const isChecking = snapshot.status === "checking";
  const isInstalling = snapshot.status === "downloading" || snapshot.status === "installing";

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    void getUpdateSnapshot()
      .then((nextSnapshot) => {
        if (!cancelled) {
          setSnapshot(nextSnapshot);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("Failed to load update snapshot", error);
        }
      });

    void onUpdateSnapshotChanged((nextSnapshot) => {
      if (!cancelled) {
        setSnapshot(nextSnapshot);
      }
    })
      .then((dispose) => {
        if (cancelled) {
          dispose();
          return;
        }

        unlisten = dispose;
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("Failed to subscribe update snapshot changes", error);
        }
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const runUpdateCheck = useCallback(async (silent: boolean) => {
    if (isChecking) return snapshot;
    try {
      const nextSnapshot = await checkForUpdates(silent);
      setSnapshot(nextSnapshot);
      return nextSnapshot;
    } catch (error) {
      if (!silent) {
        const message = error instanceof Error ? error.message : String(error);
        const errorSnapshot = {
          ...snapshot,
          status: "error" as const,
          errorMessage: message,
        };
        setSnapshot((current) => ({
          ...current,
          status: "error",
          errorMessage: message,
        }));
        return errorSnapshot;
      }
      return snapshot;
    }
  }, [isChecking, snapshot]);

  const runConfirmAction = useCallback(async () => {
    if (isInstalling) return snapshot;
    const canRetryInstall = snapshot.status === "error" && snapshot.errorStage === "install";
    const shouldInstall = snapshot.status === "downloaded" || canRetryInstall;
    if (
      snapshot.status !== "available"
      && snapshot.status !== "downloaded"
      && !canRetryInstall
    ) {
      return snapshot;
    }
    try {
      if (shouldInstall) {
        markPendingUpdateRelaunchViewRestore();
      }

      const nextSnapshot = shouldInstall
        ? await installUpdate()
        : await downloadUpdate();
      if (shouldInstall && nextSnapshot.status === "error") {
        clearPendingUpdateRelaunchViewRestore();
      }
      setSnapshot(nextSnapshot);
      return nextSnapshot;
    } catch (error) {
      if (shouldInstall) {
        clearPendingUpdateRelaunchViewRestore();
      }
      const message = error instanceof Error ? error.message : String(error);
      const errorSnapshot = {
        ...snapshot,
        status: "error" as const,
        errorMessage: message,
      };
      setSnapshot((current) => ({
        ...current,
        status: "error",
        errorMessage: message,
      }));
      return errorSnapshot;
    }
  }, [isInstalling, snapshot]);

  const openReleasePage = useCallback(async () => {
    if (!snapshot.releasePageUrl) return;
    await openExternalUrl(snapshot.releasePageUrl);
  }, [snapshot.releasePageUrl]);

  const openAssetDownload = useCallback(async () => {
    if (!snapshot.assetDownloadUrl) return;
    await openExternalUrl(snapshot.assetDownloadUrl);
  }, [snapshot.assetDownloadUrl]);

  return {
    snapshot,
    isChecking,
    isInstalling,
    dialogOpen,
    shouldShowCompactEntry: shouldShowCompactUpdateEntry(snapshot),
    openDialog: () => setDialogOpen(true),
    closeDialog: () => setDialogOpen(false),
    checkForUpdates: runUpdateCheck,
    confirmUpdateAction: runConfirmAction,
    openReleasePage,
    openAssetDownload,
  };
}
