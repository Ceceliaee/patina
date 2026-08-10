import { Folder, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import QuietBadge from "../../../shared/components/QuietBadge.tsx";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import QuietSelect from "../../../shared/components/QuietSelect.tsx";
import QuietSwitch from "../../../shared/components/QuietSwitch.tsx";
import QuietTimePicker from "../../../shared/components/QuietTimePicker.tsx";
import { useLocaleText } from "../../../shared/i18n/index.ts";
import type { ExportFormat } from "../services/settingsDataExportRange.ts";
import type { SettingsDataExportFieldKey } from "../services/settingsDataExportFields.ts";
import {
  getScheduledExportErrorCode,
  ScheduledExportService,
  type ScheduledExportConfigInput,
  type ScheduledExportSnapshot,
} from "../services/scheduledExportService.ts";
import { toUserVisibleStoragePath } from "../services/storagePathDisplay.ts";
import {
  formatScheduledDateTime as formatDateTime,
  formatScheduledSize as formatSize,
  scheduledMinutesToTime as minutesToTime,
  scheduledTimeToMinutes as timeToMinutes,
} from "../services/scheduledTaskPresentation.ts";

interface Props {
  open: boolean;
  initialSnapshot: ScheduledExportSnapshot;
  currentFormat: ExportFormat;
  currentFields: SettingsDataExportFieldKey[];
  onClose: () => void;
}

export async function loadScheduledExportSnapshot(): Promise<ScheduledExportSnapshot> {
  return ScheduledExportService.getSnapshot();
}

function toDraft(
  snapshot: ScheduledExportSnapshot,
  format: ExportFormat,
  fields: SettingsDataExportFieldKey[],
): ScheduledExportConfigInput {
  return {
    enabled: snapshot.config.enabled,
    cadence: snapshot.config.cadence,
    weekday: snapshot.config.weekday,
    localTimeMinutes: snapshot.config.localTimeMinutes,
    targetDir: snapshot.config.targetDir,
    format,
    selectedFields: [...fields],
  };
}

function toSavedInput(snapshot: ScheduledExportSnapshot): ScheduledExportConfigInput {
  const { config } = snapshot;
  return {
    enabled: config.enabled,
    cadence: config.cadence,
    weekday: config.weekday,
    localTimeMinutes: config.localTimeMinutes,
    targetDir: config.targetDir,
    format: config.format,
    selectedFields: [...config.selectedFields],
  };
}

export default function SettingsScheduledExportDialog({
  open,
  initialSnapshot,
  currentFormat,
  currentFields,
  onClose,
}: Props) {
  const UI_TEXT = useLocaleText();
  const labels = UI_TEXT.settings.scheduledBackupLabels;
  const scheduledTitle = UI_TEXT.export.scheduledTitle;
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [draft, setDraft] = useState<ScheduledExportConfigInput>(() => (
    toDraft(initialSnapshot, currentFormat, currentFields)
  ));
  const [saving, setSaving] = useState(false);
  const [saveErrorCode, setSaveErrorCode] = useState<string | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toSavedInput(snapshot));
  const controlsDisabled = saving || !draft.enabled;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    setSnapshot(initialSnapshot);
    setDraft(toDraft(initialSnapshot, currentFormat, currentFields));
    setSaveErrorCode(null);
  }, [currentFields, currentFormat, initialSnapshot]);

  useEffect(() => {
    if (!open) return undefined;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const refresh = async () => {
      try {
        const next = await ScheduledExportService.getSnapshot();
        if (disposed) return;
        setSnapshot(next);
        if (!dirtyRef.current) {
          setDraft(toDraft(next, currentFormat, currentFields));
        }
      } catch (error) {
        console.error("scheduled export snapshot refresh failed", error);
      }
    };
    void ScheduledExportService.onChanged(refresh).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [currentFields, currentFormat, open]);

  const cadenceOptions = useMemo(() => [
    { value: "daily" as const, label: UI_TEXT.data.heatmapDaily },
    { value: "weekly" as const, label: UI_TEXT.data.heatmapWeekly },
  ], [UI_TEXT.data.heatmapDaily, UI_TEXT.data.heatmapWeekly]);
  const weekdayOptions = useMemo(() => UI_TEXT.date.weekdaysShort
    .map((label, index) => ({ value: index + 1, label })), [UI_TEXT.date.weekdaysShort]);

  const updateDraft = (patch: Partial<ScheduledExportConfigInput>) => {
    setSaveErrorCode(null);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const chooseDirectory = async () => {
    const selected = await ScheduledExportService.pickDirectory(draft.targetDir);
    if (selected) updateDraft({ targetDir: selected });
  };

  const save = async () => {
    setSaving(true);
    setSaveErrorCode(null);
    try {
      const next = await ScheduledExportService.saveConfig(draft);
      setSnapshot(next);
      setDraft(toDraft(next, next.config.format, next.config.selectedFields));
    } catch (error) {
      console.error("scheduled export configuration save failed", error);
      setSaveErrorCode(getScheduledExportErrorCode(error));
    } finally {
      setSaving(false);
    }
  };

  const statusVisible = draft.enabled && Boolean(
    snapshot.nextExecutionAtMs
    || snapshot.recentSuccess?.completedAtMs
    || snapshot.recentFailure?.completedAtMs
    || snapshot.activeRun,
  );
  const errorLabel = (code: string | null | undefined) => {
    switch (code) {
      case "target_conflict": return UI_TEXT.export.scheduledErrors.targetConflict;
      case "target_missing": return UI_TEXT.export.scheduledErrors.targetMissing;
      case "permission_denied": return UI_TEXT.export.scheduledErrors.permissionDenied;
      case "disk_full": return UI_TEXT.export.scheduledErrors.diskFull;
      case "database_busy":
      case "database_unavailable": return UI_TEXT.export.scheduledErrors.databaseUnavailable;
      case "format_validation_failed": return UI_TEXT.export.scheduledErrors.validation;
      case "publish_failed": return UI_TEXT.export.scheduledErrors.publishFailed;
      case "interrupted": return UI_TEXT.export.scheduledErrors.interrupted;
      default: return UI_TEXT.export.scheduledErrors.generic;
    }
  };

  return (
    <QuietDialog
      open={open}
      title={(
        <span className="inline-flex items-center gap-1.5">
          {scheduledTitle}
          <QuietBadge variant="beta" size="regular">{UI_TEXT.settings.betaLabel}</QuietBadge>
        </span>
      )}
      onClose={saving ? () => undefined : onClose}
      closeOnBackdrop={!saving}
      surfaceClassName="settings-scheduled-export-dialog"
      headerAside={(
        <QuietSwitch
          checked={draft.enabled}
          disabled={saving}
          ariaLabel={scheduledTitle}
          onChange={(enabled) => updateDraft({ enabled })}
        />
      )}
      actions={(
        <>
          <QuietButton size="large" onClick={onClose} disabled={saving}>
            {UI_TEXT.common.cancel}
          </QuietButton>
          <QuietButton
            tone="primary"
            size="large"
            onClick={() => void save()}
            disabled={saving || !dirty || !draft.targetDir.trim() || draft.selectedFields.length === 0}
            busy={saving}
          >
            {saving ? UI_TEXT.common.saving : UI_TEXT.common.save}
          </QuietButton>
        </>
      )}
    >
      <div className="settings-scheduled-export">
        <div
          className="settings-scheduled-export-schedule"
          data-cadence={draft.cadence}
          aria-disabled={controlsDisabled}
        >
          <div className="settings-scheduled-export-control">
            <span>{labels.frequency}</span>
            <QuietSelect
              value={draft.cadence}
              options={cadenceOptions}
              ariaLabel={labels.frequency}
              disabled={controlsDisabled}
              onChange={(cadence) => updateDraft({
                cadence,
                weekday: cadence === "weekly" ? (draft.weekday ?? 1) : null,
              })}
            />
          </div>
          {draft.cadence === "weekly" ? (
            <div className="settings-scheduled-export-control">
              <span>{UI_TEXT.export.fields.weekday.label}</span>
              <QuietSelect
                value={draft.weekday ?? 1}
                options={weekdayOptions}
                ariaLabel={UI_TEXT.export.fields.weekday.label}
                disabled={controlsDisabled}
                onChange={(weekday) => updateDraft({ weekday })}
              />
            </div>
          ) : null}
          <div className="settings-scheduled-export-control">
            <span>{labels.time}</span>
            <QuietTimePicker
              value={minutesToTime(draft.localTimeMinutes)}
              ariaLabel={labels.time}
              disabled={controlsDisabled}
              onChange={(value) => updateDraft({ localTimeMinutes: timeToMinutes(value) })}
            />
          </div>
        </div>

        <div className="settings-scheduled-export-directory">
          <span className="settings-scheduled-export-directory-label">{labels.directory}</span>
          <span className="settings-scheduled-export-directory-value">
            <Folder size={14} aria-hidden="true" />
            <span>{toUserVisibleStoragePath(draft.targetDir)}</span>
          </span>
          <QuietButton size="regular" onClick={() => void chooseDirectory()} disabled={controlsDisabled}>
            {UI_TEXT.settings.storage.changePathAction}
          </QuietButton>
        </div>

        {statusVisible ? (
          <dl className="settings-scheduled-export-status">
            {snapshot.nextExecutionAtMs ? (
              <div><dt>{labels.nextExecution}</dt><dd>{formatDateTime(snapshot.nextExecutionAtMs)}</dd></div>
            ) : null}
            {snapshot.recentSuccess?.completedAtMs ? (
              <div>
                <dt>{labels.recentSuccess}</dt>
                <dd>{[
                  formatDateTime(snapshot.recentSuccess.completedAtMs),
                  formatSize(snapshot.recentSuccess.sizeBytes),
                ].filter(Boolean).join(" · ")}</dd>
              </div>
            ) : null}
            {snapshot.recentFailure?.completedAtMs ? (
              <div>
                <dt>{labels.recentFailure}</dt>
                <dd>{[
                  formatDateTime(snapshot.recentFailure.completedAtMs),
                  errorLabel(snapshot.recentFailure.errorCode),
                ].filter(Boolean).join(" · ")}</dd>
              </div>
            ) : null}
            {snapshot.activeRun ? (
              <div>
                <dt>{scheduledTitle}</dt>
                <dd>{snapshot.activeRun.status === "running"
                  ? UI_TEXT.export.exporting
                  : [UI_TEXT.settings.retry, formatDateTime(snapshot.activeRun.retryAtMs)].filter(Boolean).join(" · ")}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}

        {saveErrorCode ? (
          <p className="settings-scheduled-export-error" role="alert">
            <RefreshCw size={14} aria-hidden="true" />
            {errorLabel(saveErrorCode)}
          </p>
        ) : null}
      </div>
    </QuietDialog>
  );
}
