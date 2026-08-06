import { useLocaleText } from "../../../shared/i18n/index.ts";
import { useCallback, useEffect, useState } from "react";
import { Info } from "lucide-react";

import type { QuietToastTone } from "../../../shared/types/toast";
import QuietPageHeader from "../../../shared/components/QuietPageHeader";
import type { UpdateSnapshot } from "../../../shared/types/update";
import AboutPanel from "./AboutPanel";
import AboutSupportDialog from "./AboutSupportDialog";
import AboutFeedbackDialog from "./AboutFeedbackDialog";
import {
  getSettingsPageBootstrapCache,
  prewarmSettingsBootstrapCache,
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
  const UI_TEXT = useLocaleText();
  const cachedBootstrap = getSettingsPageBootstrapCache();
  const initialVersion = updateSnapshot?.currentVersion ?? cachedBootstrap?.appVersion ?? "-";
  const [appVersion, setAppVersion] = useState(initialVersion);
  const [supportDialogOpen, setSupportDialogOpen] = useState(false);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const bootstrap = await prewarmSettingsBootstrapCache();
        if (!cancelled) {
          setAppVersion(bootstrap.appVersion);
        }
      } catch (error) {
        console.error("load about bootstrap failed", error);
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
      notify(UI_TEXT.toast.releaseNotesOpenFailed, "error");
    }
  }, [notify, UI_TEXT]);

  const handleOpenRepository = useCallback(async () => {
    try {
      await SettingsRuntimeAdapterService.openRepository();
    } catch (error) {
      console.error("open repository link failed", error);
      notify(UI_TEXT.toast.repositoryOpenFailed, "error");
    }
  }, [notify, UI_TEXT]);

  const handleOpenFeedback = useCallback(async (): Promise<boolean> => {
    try {
      await SettingsRuntimeAdapterService.openFeedback();
      return true;
    } catch (error) {
      console.error("open feedback link failed", error);
      notify(UI_TEXT.toast.feedbackOpenFailed, "error");
      return false;
    }
  }, [notify, UI_TEXT]);

  const handleOpenKofiSupport = useCallback(async () => {
    try {
      await SettingsRuntimeAdapterService.openKofiSupport();
    } catch (error) {
      console.error("open Ko-fi support link failed", error);
      notify(UI_TEXT.toast.supportOpenFailed, "error");
    }
  }, [notify, UI_TEXT]);

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
          onOpenRepository={() => {
            void handleOpenRepository();
          }}
          onOpenFeedback={() => {
            setFeedbackDialogOpen(true);
          }}
          onOpenSupportDialog={() => {
            setSupportDialogOpen(true);
          }}
        />
      </div>

      <AboutSupportDialog
        open={supportDialogOpen}
        onClose={() => setSupportDialogOpen(false)}
        onOpenKofi={() => {
          void handleOpenKofiSupport();
        }}
      />
      <AboutFeedbackDialog
        open={feedbackDialogOpen}
        onClose={() => setFeedbackDialogOpen(false)}
        onOpenGitHub={handleOpenFeedback}
      />
    </div>
  );
}
