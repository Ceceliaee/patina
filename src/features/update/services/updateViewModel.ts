import type { UpdateErrorStage, UpdateSnapshot } from "../../../shared/types/update";
import { SUPPORTED_LOCALES, type Locale, type UiText } from "../../../shared/i18n/generated/contract.ts";

type UpdateAction =
  | "check"
  | "open_confirm"
  | "open_release_page"
  | "open_download_url";

export interface UpdateActionModel {
  label: string;
  action: UpdateAction;
  disabled: boolean;
  loading: boolean;
  emphasis?: "primary" | "secondary";
}

interface UpdateProgressModel {
  percent: number | null;
  label: string;
  valueText: string | null;
  indeterminate: boolean;
}

interface UpdateStatusPanelModel {
  statusTitle: string;
  statusDetail: string | null;
  primaryAction: UpdateActionModel;
  secondaryAction: UpdateActionModel | null;
  progress: UpdateProgressModel | null;
}

interface UpdateConfirmDialogModel {
  title: string;
  versionCompareLabel: string;
  confirmDescription: string;
  notesPreview: string | null;
  progress: UpdateProgressModel | null;
  primaryAction: UpdateActionModel | null;
  secondaryAction: UpdateActionModel | null;
}

export function shouldOpenUpdateDialogForSnapshot(snapshot: UpdateSnapshot): boolean {
  return snapshot.status === "available"
    || snapshot.status === "downloaded"
    || snapshot.status === "downloading"
    || snapshot.status === "installing"
    || (snapshot.status === "error" && snapshot.errorStage !== null && Boolean(
      snapshot.releasePageUrl || snapshot.assetDownloadUrl || snapshot.latestVersion,
    ));
}

export function shouldShowSidebarUpdateEntry(snapshot: UpdateSnapshot): boolean {
  return snapshot.status === "available"
    || snapshot.status === "downloaded"
    || snapshot.status === "downloading"
    || snapshot.status === "installing";
}

function formatVersion(value: string | null): string {
  return `v${value ?? "0.0.0"}`;
}

function getReleaseNotesPreview(releaseNotes: string | null, locale: Locale): string | null {
  if (!releaseNotes) return null;
  const trimmed = resolveLocalizedReleaseNotes(releaseNotes, locale).trim();
  if (!trimmed) return null;
  return trimmed.length > 220 ? `${trimmed.slice(0, 220).trimEnd()}...` : trimmed;
}

function resolveLocalizedReleaseNotes(releaseNotes: string, locale: Locale): string {
  const localizedNotes: Partial<Record<Locale, string>> = {};

  for (const line of releaseNotes.split(/\r?\n/)) {
    const match = /^([A-Za-z]{2,3}(?:-[A-Za-z0-9]+)*):\s*(.+)$/.exec(line.trim());
    if (match && SUPPORTED_LOCALES.includes(match[1] as Locale)) {
      const language = match[1] as Locale;
      localizedNotes[language] = match[2].trim();
    }
  }

  return localizedNotes[locale] ?? localizedNotes[SUPPORTED_LOCALES[0]] ?? releaseNotes;
}

function formatByteCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let next = value;
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  const digits = next >= 100 || unitIndex === 0 ? 0 : 1;
  return `${next.toFixed(digits)} ${units[unitIndex]}`;
}

function buildErrorDetail(stage: UpdateErrorStage | null, UI_TEXT: UiText): string {
  return stage === "check"
    ? UI_TEXT.update.checkErrorDetail
    : stage === "download"
      ? UI_TEXT.update.downloadErrorDetail
      : stage === "install"
        ? UI_TEXT.update.installErrorDetail
        : UI_TEXT.update.genericErrorDetail;
}

function buildUpdateProgressModel(snapshot: UpdateSnapshot, UI_TEXT: UiText): UpdateProgressModel | null {
  const downloadedBytes = snapshot.downloadedBytes;
  const totalBytes = snapshot.totalBytes;
  const hasDownloadedBytes = typeof downloadedBytes === "number" && Number.isFinite(downloadedBytes);
  const hasTotalBytes = typeof totalBytes === "number" && Number.isFinite(totalBytes) && totalBytes > 0;
  const percent = hasDownloadedBytes && hasTotalBytes
    ? Math.max(0, Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)))
    : null;

  if (snapshot.status === "downloading") {
    if (!hasDownloadedBytes) {
      return null;
    }

    return {
      percent,
      label: hasDownloadedBytes && hasTotalBytes
        ? `${formatByteCount(downloadedBytes)} / ${formatByteCount(totalBytes)}`
        : hasDownloadedBytes
          ? UI_TEXT.update.downloadedBytes(formatByteCount(downloadedBytes))
          : UI_TEXT.update.progressPending,
      valueText: percent !== null ? `${percent}%` : null,
      indeterminate: percent === null,
    };
  }

  if (snapshot.status === "downloaded") {
    return {
      percent: 100,
      label: UI_TEXT.update.packageDownloaded(hasDownloadedBytes ? formatByteCount(downloadedBytes) : undefined),
      valueText: "100%",
      indeterminate: false,
    };
  }

  if (snapshot.status === "installing") {
    return {
      percent: 100,
      label: UI_TEXT.update.installingProgress,
      valueText: null,
      indeterminate: true,
    };
  }

  return null;
}

function buildOpenReleaseAction(snapshot: UpdateSnapshot, UI_TEXT: UiText, label: string = UI_TEXT.update.manualDownload): UpdateActionModel | null {
  if (!snapshot.releasePageUrl) return null;
  return {
    label,
    action: "open_release_page",
    disabled: false,
    loading: false,
    emphasis: "secondary",
  };
}

function buildOpenDownloadAction(snapshot: UpdateSnapshot, UI_TEXT: UiText, label: string = UI_TEXT.update.downloadInstaller): UpdateActionModel | null {
  if (!snapshot.assetDownloadUrl) return null;
  return {
    label,
    action: "open_download_url",
    disabled: false,
    loading: false,
    emphasis: "primary",
  };
}

export function buildUpdateStatusPanelModel(
  snapshot: UpdateSnapshot,
  isChecking: boolean,
  isInstalling: boolean,
  UI_TEXT: UiText,
): UpdateStatusPanelModel {
  const latestVersion = snapshot.latestVersion ? formatVersion(snapshot.latestVersion) : null;
  const progress = buildUpdateProgressModel(snapshot, UI_TEXT);

  if (snapshot.status === "available") {
    return {
      statusTitle: UI_TEXT.update.foundVersion(latestVersion ?? UI_TEXT.update.unknownVersion),
      statusDetail: UI_TEXT.update.updateReadyDetail,
      primaryAction: {
        label: UI_TEXT.update.downloadNow,
        action: "open_confirm",
        disabled: isInstalling,
        loading: isInstalling,
        emphasis: "primary",
      },
      secondaryAction: null,
      progress,
    };
  }

  if (snapshot.status === "downloaded") {
    return {
      statusTitle: UI_TEXT.update.downloadedTitle(latestVersion ?? UI_TEXT.update.unknownVersion),
      statusDetail: UI_TEXT.update.downloadedDetail,
      primaryAction: {
        label: UI_TEXT.update.restartInstall,
        action: "open_confirm",
        disabled: isInstalling,
        loading: isInstalling,
        emphasis: "primary",
      },
      secondaryAction: buildOpenDownloadAction(snapshot, UI_TEXT, UI_TEXT.update.redownloadInstaller),
      progress,
    };
  }

  if (snapshot.status === "downloading") {
    return {
      statusTitle: UI_TEXT.update.downloading,
      statusDetail: latestVersion ? UI_TEXT.update.targetVersion(latestVersion) : UI_TEXT.update.preparingPackage,
      primaryAction: {
        label: UI_TEXT.update.processing,
        action: "check",
        disabled: true,
        loading: true,
        emphasis: "primary",
      },
      secondaryAction: buildOpenReleaseAction(snapshot, UI_TEXT, UI_TEXT.update.manualDownload),
      progress,
    };
  }

  if (snapshot.status === "installing") {
    return {
      statusTitle: UI_TEXT.update.installing,
      statusDetail: latestVersion ? UI_TEXT.update.targetVersion(latestVersion) : UI_TEXT.update.installRestartDetail,
      primaryAction: {
        label: UI_TEXT.update.processing,
        action: "check",
        disabled: true,
        loading: true,
        emphasis: "primary",
      },
      secondaryAction: null,
      progress,
    };
  }

  if (snapshot.status === "checking" || isChecking) {
    return {
      statusTitle: UI_TEXT.update.checkingUpdates,
      statusDetail: null,
      primaryAction: {
        label: UI_TEXT.update.checking,
        action: "check",
        disabled: true,
        loading: true,
        emphasis: "primary",
      },
      secondaryAction: null,
      progress: null,
    };
  }

  if (snapshot.status === "up_to_date") {
    return {
      statusTitle: UI_TEXT.update.upToDate,
      statusDetail: null,
      primaryAction: {
        label: UI_TEXT.update.checkUpdates,
        action: "check",
        disabled: isChecking || isInstalling,
        loading: isChecking,
        emphasis: "primary",
      },
      secondaryAction: null,
      progress: null,
    };
  }

  if (snapshot.status === "error") {
    const releaseAction = buildOpenReleaseAction(snapshot, UI_TEXT, UI_TEXT.update.manualDownload);
    const downloadAction = buildOpenDownloadAction(snapshot, UI_TEXT, UI_TEXT.update.downloadInstaller);
    const primaryAction = snapshot.errorStage === "download" && downloadAction
      ? downloadAction
      : snapshot.errorStage === "install"
        ? {
          label: UI_TEXT.update.installAgain,
          action: "open_confirm" as const,
          disabled: isInstalling,
          loading: false,
          emphasis: "primary" as const,
        }
        : releaseAction ?? {
          label: UI_TEXT.update.checkAgain,
          action: "check",
          disabled: isChecking || isInstalling,
          loading: isChecking,
          emphasis: "primary",
        };
    const secondaryAction = primaryAction.action === "check"
      ? releaseAction ?? downloadAction
      : snapshot.errorStage === "install"
        ? downloadAction ?? releaseAction ?? {
          label: UI_TEXT.update.checkAgain,
          action: "check" as const,
          disabled: isChecking || isInstalling,
          loading: isChecking,
          emphasis: "secondary" as const,
        }
        : {
          label: UI_TEXT.update.checkAgain,
          action: "check" as const,
          disabled: isChecking || isInstalling,
          loading: isChecking,
          emphasis: "secondary" as const,
        };

    return {
      statusTitle: snapshot.errorStage === "check"
        ? UI_TEXT.update.checkFailed
        : snapshot.errorStage === "download"
          ? UI_TEXT.update.downloadFailed
          : snapshot.errorStage === "install"
            ? UI_TEXT.update.installFailed
            : UI_TEXT.update.updateFailed,
      statusDetail: buildErrorDetail(snapshot.errorStage, UI_TEXT),
      primaryAction,
      secondaryAction,
      progress,
    };
  }

  return {
    statusTitle: UI_TEXT.update.notChecked,
    statusDetail: null,
    primaryAction: {
      label: UI_TEXT.update.checkUpdates,
      action: "check",
      disabled: isChecking || isInstalling,
      loading: isChecking,
      emphasis: "primary",
    },
    secondaryAction: null,
    progress: null,
  };
}

export function buildUpdateConfirmDialogModel(
  snapshot: UpdateSnapshot,
  UI_TEXT: UiText,
  locale: Locale,
): UpdateConfirmDialogModel {
  const currentVersion = formatVersion(snapshot.currentVersion);
  const latestVersion = formatVersion(snapshot.latestVersion ?? snapshot.currentVersion);
  const isDownloaded = snapshot.status === "downloaded";
  const isDownloading = snapshot.status === "downloading";
  const isInstalling = snapshot.status === "installing";

  if (snapshot.status === "error") {
    const primaryAction = snapshot.errorStage === "download"
      ? buildOpenDownloadAction(snapshot, UI_TEXT, UI_TEXT.update.downloadInstaller) ?? buildOpenReleaseAction(snapshot, UI_TEXT)
      : snapshot.errorStage === "install"
        ? {
          label: UI_TEXT.update.installAgain,
          action: "open_confirm" as const,
          disabled: false,
          loading: false,
          emphasis: "primary" as const,
        }
        : buildOpenReleaseAction(snapshot, UI_TEXT, UI_TEXT.update.manualDownload);

    return {
      title: snapshot.errorStage === "check"
        ? UI_TEXT.update.checkFailedDialog
        : snapshot.errorStage === "download"
          ? UI_TEXT.update.downloadFailedDialog
          : snapshot.errorStage === "install"
            ? UI_TEXT.update.installFailedDialog
            : UI_TEXT.update.updateFailedDialog,
      versionCompareLabel: `${currentVersion} -> ${latestVersion}`,
      confirmDescription: buildErrorDetail(snapshot.errorStage, UI_TEXT),
      notesPreview: getReleaseNotesPreview(snapshot.releaseNotes, locale),
      progress: buildUpdateProgressModel(snapshot, UI_TEXT),
      primaryAction,
      secondaryAction: primaryAction?.action === "check"
        ? buildOpenReleaseAction(snapshot, UI_TEXT, UI_TEXT.update.manualDownload)
        : snapshot.errorStage === "install"
          ? buildOpenDownloadAction(snapshot, UI_TEXT, UI_TEXT.update.redownloadInstaller)
            ?? buildOpenReleaseAction(snapshot, UI_TEXT, UI_TEXT.update.manualDownload)
          : {
            label: UI_TEXT.update.checkAgain,
            action: "check",
            disabled: false,
            loading: false,
            emphasis: "secondary",
          },
    };
  }

  return {
    title: isInstalling
      ? UI_TEXT.update.dialogInstalling
      : isDownloading
        ? UI_TEXT.update.dialogDownloading
        : isDownloaded
          ? UI_TEXT.update.dialogDownloaded
          : UI_TEXT.update.dialogAvailable,
    versionCompareLabel: `${currentVersion} -> ${latestVersion}`,
    confirmDescription: isInstalling
      ? UI_TEXT.update.dialogInstallingDetail
      : isDownloading
        ? UI_TEXT.update.dialogDownloadingDetail
        : isDownloaded
          ? UI_TEXT.update.dialogDownloadedDetail
          : UI_TEXT.update.dialogAvailableDetail,
    notesPreview: getReleaseNotesPreview(snapshot.releaseNotes, locale),
    progress: buildUpdateProgressModel(snapshot, UI_TEXT),
    primaryAction: isInstalling
      ? null
      : {
        label: isDownloaded ? UI_TEXT.update.restartInstall : UI_TEXT.update.downloadNow,
        action: "open_confirm",
        disabled: isDownloading,
        loading: isDownloading,
        emphasis: "primary",
      },
    secondaryAction: isDownloading
      ? buildOpenReleaseAction(snapshot, UI_TEXT, UI_TEXT.update.manualDownload)
      : null,
  };
}
