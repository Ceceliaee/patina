import { CircleAlert, Trash2, X } from "lucide-react";
import { useState } from "react";
import QuietActionRow from "../../../shared/components/QuietActionRow.tsx";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietConfirmDialog from "../../../shared/components/QuietConfirmDialog.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
import QuietTooltip from "../../../shared/components/QuietTooltip.tsx";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import type { ImportBatch, ImportPreview } from "../services/settingsImportService.ts";

interface Props {
  open: boolean;
  view: "actions" | "preview" | "batches";
  busy: boolean;
  preview: ImportPreview | null;
  batches: ImportBatch[];
  onClose: () => void;
  onChooseCanonicalCsv: () => void;
  onConfirmImport: () => void;
  onDestructureExternal: () => void;
  onShowBatches: () => void;
  onShowActions: () => void;
  onRemoveBatch: (batchId: string) => void;
}

export default function SettingsDataImportDialog({
  open,
  view,
  busy,
  preview,
  batches,
  onClose,
  onChooseCanonicalCsv,
  onConfirmImport,
  onDestructureExternal,
  onShowBatches,
  onShowActions,
  onRemoveBatch,
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<ImportBatch | null>(null);
  const importText = UI_TEXT.settings.dataImport;
  const availableRecords = preview
    ? Math.max(0, preview.validRecords - preview.duplicateRecords)
    : 0;
  const categorizedApps = preview?.categoryCandidates.filter((candidate) => candidate.categories.length === 1).length ?? 0;
  const conflictedApps = preview?.categoryCandidates.filter((candidate) => candidate.categories.length > 1).length ?? 0;
  const mainOpen = open && view !== "batches";
  const batchOpen = open && view === "batches";

  return (
    <>
      <QuietDialog
        open={mainOpen}
        title={view === "preview" ? importText.previewTitle : importText.dialogTitle}
        description={view === "preview" ? undefined : importText.dialogDescription}
        onClose={onClose}
        closeOnBackdrop={!busy}
        surfaceClassName="settings-data-action-dialog"
        headerAside={(
          <div className="settings-dialog-header-actions">
            {view === "actions" && batches.length > 0 ? (
              <QuietIconAction
                icon={<Trash2 size={15} />}
                title={importText.batchesTitle}
                tone="danger"
                disabled={busy}
                onClick={onShowBatches}
              />
            ) : null}
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
        actions={view === "preview" ? (
          <>
            <QuietButton disabled={busy} onClick={onShowActions}>{UI_TEXT.common.cancel}</QuietButton>
            <QuietButton
              tone="primary"
              busy={busy}
              disabled={availableRecords === 0}
              onClick={onConfirmImport}
            >
              {UI_TEXT.settings.dataImportAction}
            </QuietButton>
          </>
        ) : undefined}
      >
        {view === "actions" ? (
          <div className="settings-import-action-list">
            <QuietActionRow className="settings-dialog-action-card">
              <button
                type="button"
                aria-label={importText.csvTitle}
                disabled={busy}
                className="settings-dialog-action-trigger"
                onClick={onChooseCanonicalCsv}
              >
                <p className="settings-import-action-title text-sm font-semibold text-[var(--qp-text-primary)]">{importText.csvTitle}</p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{importText.csvHint}</p>
              </button>
            </QuietActionRow>
            <QuietActionRow className="settings-dialog-action-card">
              <div
                className="settings-dialog-action-composite"
                data-disabled={busy ? "true" : undefined}
              >
                <button
                  type="button"
                  aria-label={importText.destructureTitle}
                  disabled={busy}
                  className="settings-dialog-action-hit-target"
                  onClick={onDestructureExternal}
                />
                <div className="settings-dialog-action-copy">
                  <div className="settings-import-action-heading">
                    <p className="settings-import-action-title text-sm font-semibold text-[var(--qp-text-primary)]">{importText.destructureTitle}</p>
                    <QuietTooltip
                      label={importText.destructureFormatsHint}
                      placement="top"
                      tooltipClassName="settings-restore-help-tooltip"
                      hideOnPointerDown={false}
                    >
                      <button
                        type="button"
                        className="settings-restore-help"
                        aria-label={importText.destructureFormatsHint}
                      >
                        <CircleAlert size={13} aria-hidden="true" />
                      </button>
                    </QuietTooltip>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--qp-text-tertiary)]">{importText.destructureHint}</p>
                </div>
              </div>
            </QuietActionRow>
          </div>
        ) : preview ? (
          <div className="settings-import-preview">
            <div className="settings-import-preview-details">
              <dl className="settings-import-preview-detail-group">
                <div>
                  <dt>{importText.fileLabel}{importText.detailSeparator}</dt>
                  <dd>{preview.fileName}</dd>
                </div>
                <div>
                  <dt>{importText.availableLabel}{importText.detailSeparator}</dt>
                  <dd>{availableRecords}</dd>
                </div>
              </dl>
              <dl className="settings-import-preview-detail-group">
                {preview.exactSessions > 0 ? (
                  <div><dt>{importText.exactLabel}{importText.detailSeparator}</dt><dd>{preview.exactSessions}</dd></div>
                ) : null}
                {preview.hourBuckets > 0 ? (
                  <div><dt>{importText.hourLabel}{importText.detailSeparator}</dt><dd>{preview.hourBuckets}</dd></div>
                ) : null}
                {preview.duplicateRecords > 0 ? (
                  <div><dt>{importText.duplicateLabel}{importText.detailSeparator}</dt><dd>{preview.duplicateRecords}</dd></div>
                ) : null}
                {preview.errorRecords > 0 ? (
                  <div><dt>{importText.errorLabel}{importText.detailSeparator}</dt><dd>{preview.errorRecords}</dd></div>
                ) : null}
                {categorizedApps > 0 ? (
                  <div><dt>{importText.categorizedAppsLabel}{importText.detailSeparator}</dt><dd>{categorizedApps}</dd></div>
                ) : null}
                {conflictedApps > 0 ? (
                  <div><dt>{importText.conflictedAppsLabel}{importText.detailSeparator}</dt><dd>{conflictedApps}</dd></div>
                ) : null}
              </dl>
            </div>
            {conflictedApps > 0 ? (
              <div className="settings-import-notes">
                <div>
                  <p className="settings-import-note">{importText.categoryConflictNote}</p>
                </div>
              </div>
            ) : null}
            {preview.errors.length > 0 ? (
              <ul className="settings-import-errors">
                {preview.errors.map((error) => (
                  <li key={`${error.line}-${error.message}`}>{importText.lineError(error.line, error.message)}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </QuietDialog>

      <QuietDialog
        open={batchOpen}
        title={importText.batchesTitle}
        description={importText.batchesDescription}
        onClose={onShowActions}
        closeOnBackdrop={!busy}
        surfaceClassName="settings-data-action-dialog"
        headerAside={(
          <div className="settings-dialog-header-actions">
            <button
              type="button"
              className="qp-dialog-close-button"
              aria-label={UI_TEXT.common.close}
              disabled={busy}
              onClick={onShowActions}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        )}
      >
        <div className="settings-import-batch-list">
          {batches.map((batch, index) => (
            <div className="settings-import-batch-row" key={batch.id}>
              <strong className="settings-import-batch-title">{importText.batchTitle(index + 1)}</strong>
              <div className="settings-import-batch-copy">
                <span>{new Date(batch.importedAt).toLocaleString()} · {batch.sourceName}</span>
                <small>{UI_TEXT.settings.importRecordCount(batch.exactSessions + batch.hourBuckets)}</small>
              </div>
              <QuietIconAction
                icon={<Trash2 size={14} />}
                title={importText.deleteBatchAction(index + 1)}
                tone="danger"
                disabled={busy}
                onClick={() => setPendingDelete(batch)}
              />
            </div>
          ))}
        </div>
      </QuietDialog>

      <QuietConfirmDialog
        open={pendingDelete !== null}
        title={importText.deleteConfirmTitle}
        description={pendingDelete ? importText.deleteConfirmDescription(pendingDelete.sourceName) : ""}
        confirmLabel={importText.deleteConfirmAction}
        cancelLabel={UI_TEXT.common.cancel}
        danger
        confirmLoading={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          const batchId = pendingDelete.id;
          setPendingDelete(null);
          onRemoveBatch(batchId);
        }}
      />
    </>
  );
}
