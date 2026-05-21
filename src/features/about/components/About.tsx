import { useCallback, useEffect, useState } from "react";
import { Info, RefreshCw } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/uiText.ts";
import type { QuietToastTone } from "../../../shared/components/QuietToast";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import type { UpdateSnapshot } from "../../../shared/types/update";
import AboutPanel from "./AboutPanel";
import {
  getSettingsPageBootstrapCache,
  loadSettingsPageBootstrap,
} from "../../settings/services/settingsBootstrapService.ts";
import { SettingsRuntimeAdapterService } from "../../settings/services/settingsRuntimeAdapterService";

interface Props {
  onCheckForUpdates?: () => Promise<void>;
  onOpenUpdateDialog?: () => void;
  onOpenUpdateReleasePage?: () => Promise<void>;
  onOpenUpdateDownload?: () => Promise<void>;
  updateSnapshot?: UpdateSnapshot;
  updateChecking?: boolean;
  updateInstalling?: boolean;
  updateDialogOpen?: boolean;
  onToast?: (message: string, tone?: QuietToastTone) => void;
}

export default function About({
  onCheckForUpdates,
  onOpenUpdateDialog,
  onOpenUpdateReleasePage,
  onOpenUpdateDownload,
  updateSnapshot,
  updateChecking = false,
  updateInstalling = false,
  updateDialogOpen = false,
  onToast,
}: Props) {
  const cachedBootstrap = getSettingsPageBootstrapCache();
  const initialVersion = updateSnapshot?.currentVersion ?? cachedBootstrap?.appVersion ?? "-";
  const [appVersion, setAppVersion] = useState(initialVersion);
  const [loading, setLoading] = useState(!updateSnapshot?.currentVersion && !cachedBootstrap?.appVersion);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const bootstrap = await loadSettingsPageBootstrap();
        if (!cancelled) {
          setAppVersion(bootstrap.appVersion);
        }
      } catch (error) {
        console.error("load about bootstrap failed", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const notify = useCallback((message: string, tone: QuietToastTone = "info") => {
    onToast?.(message, tone);
  }, [onToast]);

  const handleOpenReleaseNotes = useCallback(async () => {
    try {
      await SettingsRuntimeAdapterService.openReleaseNotes();
    } catch (error) {
      console.error("open release notes failed", error);
      notify(UI_TEXT.toast.releaseNotesOpenFailed, "warning");
    }
  }, [notify]);

  const handleOpenFeedback = useCallback(async () => {
    try {
      await SettingsRuntimeAdapterService.openFeedback();
    } catch (error) {
      console.error("open feedback link failed", error);
      notify(UI_TEXT.toast.feedbackOpenFailed, "warning");
    }
  }, [notify]);

  const effectiveUpdateSnapshot = updateSnapshot ?? {
    currentVersion: appVersion,
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

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-3 text-[var(--qp-text-tertiary)]">
        <RefreshCw className="animate-spin" size={20} />
        <span className="text-sm font-medium">{UI_TEXT.settings.loading}</span>
      </div>
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col gap-4 md:gap-5">
      <QuietPageHeader
        icon={<Info size={18} />}
        title={UI_TEXT.about.title}
        subtitle={UI_TEXT.about.subtitle}
      />

      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
        <AboutPanel
          appVersion={appVersion}
          effectiveUpdateSnapshot={effectiveUpdateSnapshot}
          updateChecking={updateChecking}
          updateInstalling={updateInstalling}
          updateDialogOpen={updateDialogOpen}
          onCheckForUpdates={() => {
            if (!onCheckForUpdates) return;
            void onCheckForUpdates();
          }}
          onOpenUpdateDialog={() => onOpenUpdateDialog?.()}
          onOpenUpdateReleasePage={() => {
            if (!onOpenUpdateReleasePage) return;
            void onOpenUpdateReleasePage();
          }}
          onOpenUpdateDownload={() => {
            if (!onOpenUpdateDownload) return;
            void onOpenUpdateDownload();
          }}
          onOpenReleaseNotes={() => {
            void handleOpenReleaseNotes();
          }}
          onOpenFeedback={() => {
            void handleOpenFeedback();
          }}
        />
      </div>
    </div>
  );
}
