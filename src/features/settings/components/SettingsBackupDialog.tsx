import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Cloud, Folder, RefreshCw, X } from "lucide-react";

import QuietActionRow from "../../../shared/components/QuietActionRow";
import QuietBadge from "../../../shared/components/QuietBadge";
import QuietButton from "../../../shared/components/QuietButton";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietIconAction from "../../../shared/components/QuietIconAction";
import QuietSelect from "../../../shared/components/QuietSelect";
import QuietSwitch from "../../../shared/components/QuietSwitch";
import QuietTimePicker from "../../../shared/components/QuietTimePicker";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import {
  ScheduledBackupService,
  type ScheduledBackupConfigInput,
  type ScheduledBackupSnapshot,
} from "../services/scheduledBackupService.ts";
import { toUserVisibleStoragePath } from "../services/storagePathDisplay.ts";
import {
  formatScheduledDateTime as formatDateTime,
  formatScheduledSize as formatSize,
  scheduledMinutesToTime as minutesToTime,
  scheduledTimeToMinutes as timeToMinutes,
} from "../services/scheduledTaskPresentation.ts";

interface SettingsBackupDialogProps {
  open: boolean;
  busy: boolean;
  hasRemoteBackupTarget: boolean;
  remoteBackupTargetSummary: string;
  onClose: () => void;
  onLocalBackup: () => void;
  onRemoteBackup: () => void;
}

type ScheduledTargetKind = ScheduledBackupConfigInput["target"]["kind"];

function toDraft(
  snapshot: ScheduledBackupSnapshot,
  requestedTarget?: ScheduledTargetKind,
): ScheduledBackupConfigInput {
  const { config } = snapshot;
  const targetKind = requestedTarget ?? config.target.kind;
  return {
    enabled: config.enabled,
    cadence: config.cadence,
    weekday: config.weekday,
    localTimeMinutes: config.localTimeMinutes,
    target: targetKind === "webdav"
      ? { kind: "webdav" }
      : {
        kind: "local",
        targetDir: config.target.kind === "local"
          ? config.target.targetDir
          : snapshot.defaultLocalTargetDir,
      },
  };
}

function scheduledErrorMessage(
  errorCode: string | null | undefined,
  targetKind: ScheduledTargetKind,
  backupFailed: string,
  webDavMessages: {
    missingConfig: string;
    connectionFailed: string;
    uploadFailed: string;
  },
): string {
  if (targetKind !== "webdav") return backupFailed;
  if (errorCode === "credential_missing" || errorCode === "webdav_not_configured") {
    return webDavMessages.missingConfig;
  }
  if (errorCode === "authentication_failed") return webDavMessages.connectionFailed;
  return webDavMessages.uploadFailed;
}

export default function SettingsBackupDialog({
  open,
  busy,
  hasRemoteBackupTarget,
  remoteBackupTargetSummary,
  onClose,
  onLocalBackup,
  onRemoteBackup,
}: SettingsBackupDialogProps) {
  const UI_TEXT = useLocaleText();
  const text = UI_TEXT.settings;
  const labels = text.scheduledBackupLabels;
  const localBackupRef = useRef<HTMLButtonElement>(null);
  const [scheduledDialogOpen, setScheduledDialogOpen] = useState(false);
  const [scheduledTargetKind, setScheduledTargetKind] = useState<ScheduledTargetKind>("local");
  const [snapshot, setSnapshot] = useState<ScheduledBackupSnapshot | null>(null);
  const [draft, setDraft] = useState<ScheduledBackupConfigInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const dirty = Boolean(
    snapshot
      && draft
      && JSON.stringify(toDraft(snapshot)) !== JSON.stringify(draft),
  );
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!scheduledDialogOpen) return undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const load = async (replaceDraft: boolean) => {
      setLoading(true);
      try {
        const next = await ScheduledBackupService.getSnapshot();
        if (disposed) return;
        setSnapshot(next);
        setDraft((current) => (
          replaceDraft || current === null || !dirtyRef.current
            ? toDraft(next, scheduledTargetKind)
            : current
        ));
        setLoadError(false);
      } catch (error) {
        console.error("scheduled backup snapshot load failed", error);
        if (!disposed) setLoadError(true);
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load(true);
    void ScheduledBackupService.onChanged(() => load(false)).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [scheduledDialogOpen, scheduledTargetKind, reloadToken]);

  useEffect(() => {
    if (!open) {
      setScheduledDialogOpen(false);
      setSnapshot(null);
      setDraft(null);
      setLoadError(false);
      setSaveError(false);
    }
  }, [open]);

  const cadenceOptions = useMemo(() => [
    { value: "daily" as const, label: UI_TEXT.data.heatmapDaily },
    { value: "weekly" as const, label: UI_TEXT.data.heatmapWeekly },
  ], [UI_TEXT.data.heatmapDaily, UI_TEXT.data.heatmapWeekly]);
  const weekdayOptions = useMemo(() => UI_TEXT.date.weekdaysShort
    .map((label, index) => ({ value: index + 1, label })), [UI_TEXT.date.weekdaysShort]);

  const updateDraft = (patch: Partial<ScheduledBackupConfigInput>) => {
    setSaveError(false);
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const chooseDirectory = async () => {
    if (!draft || draft.target.kind !== "local") return;
    const selected = await ScheduledBackupService.pickDirectory(draft.target.targetDir);
    if (selected) updateDraft({ target: { kind: "local", targetDir: selected } });
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(false);
    try {
      const next = await ScheduledBackupService.saveConfig(draft);
      setSnapshot(next);
      setDraft(toDraft(next));
    } catch (error) {
      console.error("scheduled backup configuration save failed", error);
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  };

  const closeScheduledDialog = () => {
    if (!saving) setScheduledDialogOpen(false);
  };
  const controlsDisabled = busy || saving || !draft?.enabled;
  const recentSuccessAt = snapshot?.recentSuccess?.completedAtMs ?? null;
  const recentFailureAt = snapshot?.recentFailure?.completedAtMs ?? null;
  const targetDirDisplay = toUserVisibleStoragePath(
    draft?.target.kind === "local" ? draft.target.targetDir : "",
  );
  const viewingSavedTarget = snapshot?.config.target.kind === draft?.target.kind;
  const hasScheduledStatus = Boolean(
    viewingSavedTarget
      && draft?.enabled
      && (
        snapshot?.nextExecutionAtMs
        || recentSuccessAt
        || recentFailureAt
        || snapshot?.activeRun
      ),
  );

  const openScheduledDialog = (targetKind: ScheduledTargetKind) => {
    setScheduledTargetKind(targetKind);
    setSnapshot(null);
    setDraft(null);
    setLoadError(false);
    setSaveError(false);
    setScheduledDialogOpen(true);
  };

  return (
    <>
      <QuietDialog
        open={open}
        title={text.backupTargetTitle}
        description={text.backupTargetHint}
        onClose={onClose}
        closeOnBackdrop={!busy}
        initialFocusRef={localBackupRef}
        surfaceClassName="settings-backup-dialog"
        headerAside={(
          <div className="settings-dialog-header-actions">
            <button
              type="button"
              className="qp-dialog-close-button"
              aria-label={UI_TEXT.common.close}
              disabled={busy}
              onClick={onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      >
        <div className={`grid gap-3 ${hasRemoteBackupTarget ? "md:grid-cols-2" : ""}`.trim()}>
          <QuietActionRow className="settings-dialog-action-card settings-backup-target-card">
            <button
              ref={localBackupRef}
              type="button"
              onClick={onLocalBackup}
              disabled={busy}
              className="settings-dialog-action-trigger settings-backup-local-trigger"
            >
              <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{text.backupTargetLocalTitle}</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{text.backupTargetLocalHint}</p>
            </button>
            <div className="settings-backup-schedule-anchor">
              <QuietIconAction
                icon={<CalendarClock size={16} aria-hidden="true" />}
                title={labels.title}
                disabled={busy}
                className="settings-backup-schedule-action"
                onClick={() => openScheduledDialog("local")}
              />
            </div>
          </QuietActionRow>
          {hasRemoteBackupTarget ? (
            <QuietActionRow className="settings-dialog-action-card settings-backup-target-card">
              <button
                type="button"
                onClick={onRemoteBackup}
                disabled={busy}
                className="settings-dialog-action-trigger settings-backup-local-trigger"
              >
                <p className="text-sm font-semibold text-[var(--qp-text-primary)]">{text.backupTargetRemoteTitle}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{text.backupTargetRemoteHint}</p>
              </button>
              <div className="settings-backup-schedule-anchor">
                <QuietIconAction
                  icon={<CalendarClock size={16} aria-hidden="true" />}
                  title={labels.title}
                  disabled={busy}
                  className="settings-backup-schedule-action"
                  onClick={() => openScheduledDialog("webdav")}
                />
              </div>
            </QuietActionRow>
          ) : null}
        </div>
      </QuietDialog>

      <QuietDialog
        open={open && scheduledDialogOpen}
        title={(
          <span className="inline-flex items-center gap-1.5">
            {labels.title}
            <QuietBadge variant="beta" size="regular">{text.betaLabel}</QuietBadge>
          </span>
        )}
        onClose={closeScheduledDialog}
        closeOnBackdrop={!saving}
        surfaceClassName="settings-scheduled-backup-dialog"
        headerAside={(
          <div className="settings-dialog-header-actions">
            <QuietSwitch
              checked={draft?.enabled ?? false}
              disabled={!draft || loading || saving}
              ariaLabel={labels.title}
              onChange={(enabled) => updateDraft({ enabled })}
            />
          </div>
        )}
        actions={(
          <>
            <QuietButton size="large" onClick={closeScheduledDialog} disabled={saving}>
              {UI_TEXT.common.cancel}
            </QuietButton>
            <QuietButton
              tone="primary"
              size="large"
              onClick={() => void save()}
              disabled={
                !draft
                || loading
                || saving
                || !dirty
                || (draft.target.kind === "local" && !draft.target.targetDir.trim())
              }
              busy={saving}
            >
              {saving ? UI_TEXT.common.saving : UI_TEXT.common.save}
            </QuietButton>
          </>
        )}
      >
        <div className="settings-scheduled-backup">
          {loadError ? (
            <div className="settings-scheduled-backup-error" role="alert">
              <span>{text.loadFailed}</span>
              <QuietButton size="regular" onClick={() => setReloadToken((value) => value + 1)}>
                <RefreshCw size={14} aria-hidden="true" />
                {text.retry}
              </QuietButton>
            </div>
          ) : draft ? (
            <>
              <div
                className="settings-scheduled-backup-fields"
                data-cadence={draft.cadence}
                aria-disabled={controlsDisabled}
              >
                <div className="settings-scheduled-backup-setting-row">
                  <span className="settings-scheduled-backup-setting-label">{labels.frequency}</span>
                  <div className="settings-scheduled-backup-schedule-controls">
                    <QuietSelect
                      value={draft.cadence}
                      options={cadenceOptions}
                      ariaLabel={labels.frequency}
                      disabled={controlsDisabled}
                      onChange={(cadence) => updateDraft({
                        cadence,
                        weekday: cadence === "weekly" ? (draft.weekday ?? (new Date().getDay() || 7)) : null,
                      })}
                    />
                    {draft.cadence === "weekly" ? (
                      <QuietSelect
                        value={draft.weekday ?? 1}
                        options={weekdayOptions}
                        ariaLabel={UI_TEXT.export.fields.weekday.label}
                        disabled={controlsDisabled}
                        onChange={(weekday) => updateDraft({ weekday })}
                      />
                    ) : null}
                    <QuietTimePicker
                      value={minutesToTime(draft.localTimeMinutes)}
                      ariaLabel={labels.time}
                      disabled={controlsDisabled}
                      onChange={(value) => updateDraft({ localTimeMinutes: timeToMinutes(value) })}
                    />
                  </div>
                </div>
                <div className="settings-scheduled-backup-setting-row settings-scheduled-backup-directory-field">
                  <span className="settings-scheduled-backup-setting-label">{labels.directory}</span>
                  {draft.target.kind === "local" ? (
                    <div>
                      <span className="settings-scheduled-backup-directory-value">
                        <Folder size={14} aria-hidden="true" />
                        <span>{targetDirDisplay}</span>
                      </span>
                      <QuietButton size="regular" onClick={() => void chooseDirectory()} disabled={controlsDisabled}>
                        {text.storage.changePathAction}
                      </QuietButton>
                    </div>
                  ) : (
                    <span className="settings-scheduled-backup-directory-value">
                      <Cloud size={14} aria-hidden="true" />
                      <span>{remoteBackupTargetSummary}</span>
                    </span>
                  )}
                </div>
              </div>
              {hasScheduledStatus ? (
                <dl className="settings-scheduled-backup-status">
                  {snapshot?.nextExecutionAtMs ? (
                    <div>
                      <dt>{labels.nextExecution}</dt>
                      <dd>{formatDateTime(snapshot.nextExecutionAtMs)}</dd>
                    </div>
                  ) : null}
                  {recentSuccessAt ? (
                    <div>
                      <dt>{labels.recentSuccess}</dt>
                      <dd>
                        {[formatDateTime(recentSuccessAt), formatSize(snapshot?.recentSuccess?.sizeBytes ?? null)]
                          .filter(Boolean)
                          .join(" · ")}
                      </dd>
                    </div>
                  ) : null}
                  {recentFailureAt ? (
                    <div>
                      <dt>{labels.recentFailure}</dt>
                      <dd>
                        {[
                          formatDateTime(recentFailureAt),
                          scheduledErrorMessage(
                            snapshot?.recentFailure?.errorCode,
                            snapshot?.config.target.kind ?? scheduledTargetKind,
                            UI_TEXT.toast.backupExportFailed,
                            {
                              missingConfig: UI_TEXT.toast.webDavMissingConfig,
                              connectionFailed: UI_TEXT.toast.webDavTestFailed,
                              uploadFailed: UI_TEXT.toast.webDavUploadFailed,
                            },
                          ),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </dd>
                    </div>
                  ) : null}
                  {snapshot?.activeRun ? (
                    <div className="settings-scheduled-backup-active-run">
                      <dt>{labels.title}</dt>
                      <dd>
                        {snapshot.activeRun.status === "running"
                          ? text.backupExporting
                          : [
                            text.retry,
                            formatDateTime(snapshot.activeRun.retryAtMs),
                            scheduledErrorMessage(
                              snapshot.activeRun.errorCode,
                              snapshot.config.target.kind,
                              UI_TEXT.toast.backupExportFailed,
                              {
                                missingConfig: UI_TEXT.toast.webDavMissingConfig,
                                connectionFailed: UI_TEXT.toast.webDavTestFailed,
                                uploadFailed: UI_TEXT.toast.webDavUploadFailed,
                              },
                            ),
                          ].filter(Boolean).join(" · ")}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              {snapshot?.recentSuccess?.cleanupWarning ? (
                <p className="settings-scheduled-backup-warning" role="status">
                  {text.scheduledBackupCleanupWarning}
                </p>
              ) : null}
              {saveError ? (
                <p className="settings-scheduled-backup-error" role="alert">{text.saveFailed}</p>
              ) : null}
            </>
          ) : (
            <div className="settings-scheduled-backup-loading" aria-busy="true">
              <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
              {UI_TEXT.common.loading}
            </div>
          )}
        </div>
      </QuietDialog>
    </>
  );
}
