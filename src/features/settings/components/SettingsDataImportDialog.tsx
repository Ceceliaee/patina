import { ArrowLeft, FileInput, Trash2, Unplug } from "lucide-react";
import { useState } from "react";
import QuietActionRow from "../../../shared/components/QuietActionRow.tsx";
import QuietButton from "../../../shared/components/QuietButton.tsx";
import QuietConfirmDialog from "../../../shared/components/QuietConfirmDialog.tsx";
import QuietDialog from "../../../shared/components/QuietDialog.tsx";
import QuietIconAction from "../../../shared/components/QuietIconAction.tsx";
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

function countParts(exactSessions: number, hourBuckets: number): string[] {
  const parts: string[] = [];
  if (exactSessions > 0) parts.push(UI_TEXT.settings.importExactCount(exactSessions));
  if (hourBuckets > 0) parts.push(UI_TEXT.settings.importHourCount(hourBuckets));
  return parts;
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
  const mainOpen = open && view !== "batches";
  const batchOpen = open && view === "batches";

  return (
    <>
      <QuietDialog
        open={mainOpen}
        title={view === "preview" ? importText.previewTitle : importText.dialogTitle}
        description={view === "preview" ? importText.previewDescription : importText.dialogDescription}
        onClose={onClose}
        closeOnBackdrop={!busy}
        surfaceClassName="settings-import-dialog"
        headerAside={view === "actions" && batches.length > 0 ? (
          <QuietIconAction
            icon={<Trash2 size={15} />}
            title={importText.manageAction}
            tone="danger"
            disabled={busy}
            onClick={onShowBatches}
          />
        ) : undefined}
        actions={view === "preview" ? (
          <>
            <QuietButton disabled={busy} onClick={onShowActions}>{UI_TEXT.common.cancel}</QuietButton>
            <QuietButton
              tone="primary"
              busy={busy}
              disabled={availableRecords === 0}
              onClick={onConfirmImport}
            >
              {importText.importAction}
            </QuietButton>
          </>
        ) : (
          <QuietButton disabled={busy} onClick={onClose}>{UI_TEXT.common.close}</QuietButton>
        )}
      >
        {view === "actions" ? (
          <div className="settings-import-action-list">
            <QuietActionRow>
              <div className="settings-import-action-row">
                <div className="settings-import-action-copy">
                  <div className="settings-import-action-title">
                    <FileInput size={14} />
                    <span>{importText.csvTitle}</span>
                  </div>
                  <p>{importText.csvHint}</p>
                </div>
                <QuietButton busy={busy} onClick={onChooseCanonicalCsv}>
                  {importText.chooseAction}
                </QuietButton>
              </div>
            </QuietActionRow>
            <QuietActionRow>
              <div className="settings-import-action-row">
                <div className="settings-import-action-copy">
                  <div className="settings-import-action-title">
                    <Unplug size={14} />
                    <span>{importText.destructureTitle}</span>
                  </div>
                  <p>{importText.destructureHint}</p>
                </div>
                <QuietButton busy={busy} onClick={onDestructureExternal}>
                  {importText.destructureAction}
                </QuietButton>
              </div>
            </QuietActionRow>
          </div>
        ) : preview ? (
          <div className="settings-import-preview">
            <div className="settings-import-file">
              <strong>{preview.fileName}</strong>
              <span>{preview.filePath}</span>
            </div>
            <dl className="settings-import-summary">
              <div><dt>{importText.availableLabel}</dt><dd>{availableRecords}</dd></div>
              {preview.exactSessions > 0 ? (
                <div><dt>{importText.exactLabel}</dt><dd>{preview.exactSessions}</dd></div>
              ) : null}
              {preview.hourBuckets > 0 ? (
                <div><dt>{importText.hourLabel}</dt><dd>{preview.hourBuckets}</dd></div>
              ) : null}
              {preview.duplicateRecords > 0 ? (
                <div><dt>{importText.duplicateLabel}</dt><dd>{preview.duplicateRecords}</dd></div>
              ) : null}
              {preview.errorRecords > 0 ? (
                <div><dt>{importText.errorLabel}</dt><dd>{preview.errorRecords}</dd></div>
              ) : null}
            </dl>
            {preview.hourBuckets > 0 ? <p className="settings-import-note">{importText.hourNote}</p> : null}
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
        onClose={onClose}
        closeOnBackdrop={!busy}
        surfaceClassName="settings-import-dialog"
        headerAside={(
          <QuietIconAction
            icon={<ArrowLeft size={15} />}
            title={importText.backAction}
            disabled={busy}
            onClick={onShowActions}
          />
        )}
        actions={<QuietButton disabled={busy} onClick={onClose}>{UI_TEXT.common.close}</QuietButton>}
      >
        <div className="settings-import-batch-list">
          {batches.map((batch, index) => (
            <div className="settings-import-batch-row" key={batch.id}>
              <div className="settings-import-batch-copy">
                <strong>{importText.batchTitle(index + 1)}</strong>
                <span>{new Date(batch.importedAt).toLocaleString()} · {batch.sourceName}</span>
                <small>{countParts(batch.exactSessions, batch.hourBuckets).join(" · ")}</small>
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
