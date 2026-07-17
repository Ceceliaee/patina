import { Cloud, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietButton from "../../../shared/components/QuietButton";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import type { RemoteBackupEntry, RemoteBackupState, RemoteBackupFormDraft } from "../hooks/useRemoteBackupState.ts";
import { DEFAULT_WEBDAV_REMOTE_DIR } from "../hooks/useRemoteBackupState.ts";

interface SettingsRemoteBackupPanelProps {
  remoteBackup: RemoteBackupState;
  onRestoreEntrySelected: (entry: RemoteBackupEntry) => void;
}

function stripFixedRemoteDirSuffix(url: string): string {
  const trimmed = url.trim();
  const suffix = DEFAULT_WEBDAV_REMOTE_DIR;
  if (!trimmed.endsWith(suffix)) return trimmed;
  return trimmed.slice(0, -suffix.length).replace(/\/+$/, "/");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function buildInitialDraft(remoteBackup: RemoteBackupState): RemoteBackupFormDraft {
  return {
    url: stripFixedRemoteDirSuffix(remoteBackup.config?.url ?? ""),
    username: remoteBackup.config?.username ?? "",
    remoteDir: DEFAULT_WEBDAV_REMOTE_DIR,
    password: "",
  };
}

function RemoteBackupEntryRow({
  entry,
  disabled,
  onRestore,
}: {
  entry: RemoteBackupEntry;
  disabled: boolean;
  onRestore: () => void;
}) {
  return (
    <QuietActionRow>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[var(--qp-text-primary)]">{entry.fileName}</p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">
            {new Date(entry.createdAtMs).toLocaleString()} · {formatBytes(entry.sizeBytes)}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">
            {UI_TEXT.backup.itemCounts(entry.sessionCount, entry.settingCount, entry.iconCacheCount)}
          </p>
        </div>
        <QuietButton
          size="regular"
          onClick={onRestore}
          disabled={disabled}
          className="shrink-0 rounded-[8px]"
        >
          {UI_TEXT.settings.webDavRestoreSelected}
        </QuietButton>
      </div>
    </QuietActionRow>
  );
}

export default function SettingsRemoteBackupPanel({
  remoteBackup,
  onRestoreEntrySelected,
}: SettingsRemoteBackupPanelProps) {
  const serverUrlRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<RemoteBackupFormDraft>(() => buildInitialDraft(remoteBackup));
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [isRevealingPassword, setIsRevealingPassword] = useState(false);
  const wasConfigDialogOpenRef = useRef(false);
  const busy = remoteBackup.isSaving
    || remoteBackup.isTesting
    || remoteBackup.isUploading
    || remoteBackup.isListing
    || remoteBackup.isDownloading;
  const configured = Boolean(remoteBackup.config);
  const hasSavedConfigSecret = configured && remoteBackup.hasSecret;

  useEffect(() => {
    let cancelled = false;
    const openedNow = remoteBackup.configDialogOpen && !wasConfigDialogOpenRef.current;
    wasConfigDialogOpenRef.current = remoteBackup.configDialogOpen;
    if (openedNow) {
      setDraft(buildInitialDraft(remoteBackup));
      setPasswordVisible(false);
      if (hasSavedConfigSecret) {
        setIsRevealingPassword(true);
        void remoteBackup.revealSavedPassword()
          .then((savedPassword) => {
            if (!cancelled && savedPassword) {
              setDraft((current) => ({ ...current, password: savedPassword }));
            }
          })
          .finally(() => {
            if (!cancelled) {
              setIsRevealingPassword(false);
            }
          });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [remoteBackup.configDialogOpen, remoteBackup.config, hasSavedConfigSecret, remoteBackup]);

  const canUseRemote = configured && remoteBackup.hasSecret;
  const handleTogglePasswordVisibility = async () => {
    if (passwordVisible) {
      setPasswordVisible(false);
      return;
    }
    let shouldShowPassword = true;
    if (!draft.password && hasSavedConfigSecret) {
      setIsRevealingPassword(true);
      try {
        const savedPassword = await remoteBackup.revealSavedPassword();
        if (savedPassword) {
          setDraft((current) => ({ ...current, password: savedPassword }));
        } else {
          shouldShowPassword = false;
        }
      } finally {
        setIsRevealingPassword(false);
      }
    }
    setPasswordVisible(shouldShowPassword);
  };

  return (
    <>
      <QuietActionRow className="mt-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <Cloud size={14} className="text-[var(--qp-text-tertiary)]" />
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">
                {UI_TEXT.settings.remoteBackupTitle}
              </p>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">
              {UI_TEXT.settings.remoteBackupHint}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
            {configured && (
              <QuietButton
                size="regular"
                onClick={() => void remoteBackup.testConfig()}
                disabled={busy || !canUseRemote}
                busy={remoteBackup.isTesting}
                className="shrink-0 rounded-[8px] text-[var(--qp-text-secondary)]"
              >
                {remoteBackup.isTesting ? UI_TEXT.settings.webDavTesting : UI_TEXT.settings.webDavTestConnection}
              </QuietButton>
            )}
            <QuietButton
              size="regular"
              onClick={remoteBackup.openConfigDialog}
              disabled={busy}
              className="shrink-0 rounded-[8px] text-[var(--qp-text-secondary)]"
            >
              {configured ? UI_TEXT.settings.webDavEdit : UI_TEXT.settings.webDavConfigure}
            </QuietButton>
            {configured && (
              <QuietButton
                size="regular"
                onClick={() => void remoteBackup.deleteConfig()}
                disabled={busy}
                className="shrink-0 rounded-[8px] text-[var(--qp-danger)]"
              >
                {UI_TEXT.settings.webDavDeleteAction}
              </QuietButton>
            )}
          </div>
        </div>
      </QuietActionRow>

      <QuietDialog
        open={remoteBackup.configDialogOpen}
        title={UI_TEXT.settings.webDavConfigTitle}
        description={UI_TEXT.settings.webDavConfigDescription}
        onClose={remoteBackup.closeConfigDialog}
        closeOnBackdrop={!busy}
        initialFocusRef={serverUrlRef}
        actions={(
          <>
            <QuietButton
              size="large"
              onClick={remoteBackup.closeConfigDialog}
              disabled={busy}
              className="rounded-[8px]"
            >
              {UI_TEXT.common.cancel}
            </QuietButton>
            <QuietButton
              size="large"
              onClick={() => void remoteBackup.testConfig(draft)}
              disabled={busy}
              busy={remoteBackup.isTesting}
              className="rounded-[8px]"
            >
              {remoteBackup.isTesting ? UI_TEXT.settings.webDavTesting : UI_TEXT.settings.webDavTestConnection}
            </QuietButton>
            <QuietButton
              tone="primary"
              size="large"
              onClick={() => void remoteBackup.saveConfig(draft)}
              disabled={busy}
              busy={remoteBackup.isSaving}
              className="rounded-[8px]"
            >
              {remoteBackup.isSaving ? UI_TEXT.common.saving : UI_TEXT.common.save}
            </QuietButton>
          </>
        )}
      >
        <div className="grid gap-4">
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--qp-text-secondary)]">
            {UI_TEXT.settings.webDavServerUrl}
            <div className="settings-webdav-server-input h-9">
              <input
                ref={serverUrlRef}
                value={draft.url}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  url: stripFixedRemoteDirSuffix(event.target.value),
                  remoteDir: DEFAULT_WEBDAV_REMOTE_DIR,
                }))}
                disabled={busy}
                autoComplete="off"
              />
              <span>{DEFAULT_WEBDAV_REMOTE_DIR}</span>
            </div>
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--qp-text-secondary)]">
            {UI_TEXT.settings.webDavUsername}
            <input
              value={draft.username}
              onChange={(event) => setDraft((current) => ({ ...current, username: event.target.value }))}
              className="qp-input h-9"
              disabled={busy}
              autoComplete="username"
            />
          </label>
          <label className="grid gap-1.5 text-xs font-semibold text-[var(--qp-text-secondary)]">
            {UI_TEXT.settings.webDavPassword}
            <div className="relative w-full">
              <input
                value={draft.password}
                onChange={(event) => setDraft((current) => ({ ...current, password: event.target.value }))}
                className={`qp-input h-9 w-full pr-10 ${passwordVisible ? "" : "settings-webdav-password-masked"}`.trim()}
                type="text"
                disabled={busy}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => void handleTogglePasswordVisibility()}
                disabled={busy || isRevealingPassword}
                aria-label={passwordVisible ? UI_TEXT.common.hidePassword : UI_TEXT.common.showPassword}
                className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-[6px] text-[var(--qp-text-tertiary)] transition-colors hover:bg-[var(--qp-surface-muted)] hover:text-[var(--qp-text-secondary)] disabled:opacity-50"
              >
                {passwordVisible ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>
        </div>
      </QuietDialog>

      <QuietDialog
        open={remoteBackup.restoreDialogOpen}
        title={UI_TEXT.settings.webDavRemoteBackupsTitle}
        description={UI_TEXT.settings.webDavRemoteBackupsDescription}
        onClose={remoteBackup.closeRestoreDialog}
        closeOnBackdrop={!remoteBackup.isDownloading}
        actions={(
          <QuietButton
            size="large"
            onClick={remoteBackup.closeRestoreDialog}
            disabled={remoteBackup.isDownloading}
            className="rounded-[8px]"
          >
            {UI_TEXT.common.close}
          </QuietButton>
        )}
      >
        <div className="grid max-h-[420px] gap-3 overflow-y-auto pr-1">
          {remoteBackup.entries.length === 0 && (
            <p className="text-sm leading-relaxed text-[var(--qp-text-tertiary)]">
              {UI_TEXT.settings.webDavRemoteBackupsEmpty}
            </p>
          )}
          {remoteBackup.entries.map((entry) => (
            <RemoteBackupEntryRow
              key={entry.id}
              entry={entry}
              disabled={remoteBackup.isDownloading}
              onRestore={() => onRestoreEntrySelected(entry)}
            />
          ))}
        </div>
      </QuietDialog>
    </>
  );
}
