import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { UI_TEXT } from "../../../shared/copy/index.ts";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietSegmentedFilter from "../../../shared/components/QuietSegmentedFilter";
import type {
  TaiImportOptions,
  TaiOverlapMode,
  TaiParsePreview,
  TaiImportReport,
} from "../services/settingsRuntimeAdapterService.ts";

// Dialog state machine: idle (no file) → parsing → preview (stats shown) →
// committing → done (refresh button). parseFailed recovers by re-picking.
type Phase = "idle" | "parsing" | "preview" | "committing" | "done" | "parseFailed";

interface SettingsTaiImportDialogProps {
  open: boolean;
  onClose: () => void;
  pickTaiFile: (initialPath?: string) => Promise<string | null>;
  parseTaiFile: (path: string) => Promise<TaiParsePreview | null>;
  importTaiFile: (path: string, options: TaiImportOptions) => Promise<TaiImportReport | null>;
  reload: () => void;
  isParsing: boolean;
  isCommitting: boolean;
}

const BTN_BASE = "h-8 min-h-0 rounded-[8px] px-3 text-xs font-semibold leading-none";

export default function SettingsTaiImportDialog({
  open,
  onClose,
  pickTaiFile,
  parseTaiFile,
  importTaiFile,
  reload,
  isParsing,
  isCommitting,
}: SettingsTaiImportDialogProps) {
  const copy = UI_TEXT.settings.taiImport;
  const [phase, setPhase] = useState<Phase>("idle");
  const [filePath, setFilePath] = useState<string | null>(null);
  const [preview, setPreview] = useState<TaiParsePreview | null>(null);
  const [report, setReport] = useState<TaiImportReport | null>(null);
  const [options, setOptions] = useState<TaiImportOptions>({
    importCategories: false,
    overlapMode: "skip",
  });

  const busy = isParsing || isCommitting;

  const reset = () => {
    setPhase("idle");
    setFilePath(null);
    setPreview(null);
    setReport(null);
  };

  const handleClose = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const handlePick = async () => {
    const selected = await pickTaiFile();
    if (!selected) return;
    setFilePath(selected);
    setReport(null);
    setPreview(null);
    setPhase("parsing");
    const result = await parseTaiFile(selected);
    if (result) {
      setPreview(result);
      setPhase("preview");
    } else {
      setPhase("parseFailed");
    }
  };

  const handleCommit = async () => {
    if (!filePath) return;
    setPhase("committing");
    const result = await importTaiFile(filePath, options);
    if (result) {
      setReport(result);
      setPhase("done");
    } else {
      setPhase("preview");
    }
  };

  const overlapOptions: Array<{ value: TaiOverlapMode; label: string; tooltip: string }> = [
    { value: "skip", label: copy.overlapSkip, tooltip: copy.overlapSkipHint },
    { value: "coexist", label: copy.overlapCoexist, tooltip: copy.overlapCoexistHint },
  ];

  const done = phase === "done";

  return (
    <QuietDialog
      open={open}
      title={copy.dialogTitle}
      description={copy.dialogHint}
      onClose={handleClose}
      closeOnBackdrop={!busy}
      actions={done ? (
        <>
          <button
            type="button"
            onClick={handleClose}
            className={`qp-button-secondary ${BTN_BASE}`}
          >
            {UI_TEXT.common.close}
          </button>
          <button
            type="button"
            onClick={reload}
            className={`qp-button-primary ${BTN_BASE}`}
          >
            {copy.refresh}
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={handleClose}
            disabled={busy}
            className={`qp-button-secondary ${BTN_BASE} disabled:opacity-50`}
          >
            {UI_TEXT.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => void handleCommit()}
            disabled={!preview || busy}
            className={`qp-button-primary ${BTN_BASE} disabled:opacity-50`}
          >
            {isCommitting ? copy.committing : copy.commit}
          </button>
        </>
      )}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--qp-text-primary)]">
            <input
              type="checkbox"
              checked={options.importCategories}
              disabled={busy}
              onChange={(event) =>
                setOptions((prev) => ({ ...prev, importCategories: event.target.checked }))
              }
            />
            {copy.importCategories}
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-[var(--qp-text-primary)]">{copy.overlapLabel}</span>
            <QuietSegmentedFilter
              value={options.overlapMode}
              options={overlapOptions}
              onChange={(value: TaiOverlapMode) =>
                setOptions((prev) => ({ ...prev, overlapMode: value }))
              }
              className="self-start"
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void handlePick()}
            disabled={busy}
            className={`qp-button-secondary ${BTN_BASE} disabled:opacity-50`}
          >
            {isParsing ? copy.picking : filePath ? copy.repick : copy.pickFile}
          </button>
          {filePath ? (
            <span className="min-w-0 truncate text-xs text-[var(--qp-text-tertiary)]">
              {filePath}
            </span>
          ) : null}
        </div>

        {phase === "parsing" ? (
          <p className="flex items-center gap-2 text-sm text-[var(--qp-text-secondary)]">
            <RefreshCw size={14} className="animate-spin" />
            {copy.picking}
          </p>
        ) : null}

        {phase === "preview" && preview ? (
          <>
            <dl className="grid grid-cols-1 gap-1 text-sm text-[var(--qp-text-secondary)]">
              <div>
                <span>{copy.previewCategories}: </span>
                <span className="font-semibold">{preview.categoriesCreated} / {preview.categoriesReused}</span>
              </div>
              <div>
                <span>{copy.previewSessions}: </span>
                <span className="font-semibold">{preview.sessionsCreated}</span>
              </div>
              <div>
                <span>{copy.previewSkipped}: </span>
                <span className="font-semibold">{preview.rowsSkipped}</span>
              </div>
            </dl>
            <p className="text-xs text-[var(--qp-text-tertiary)]">{copy.previewNote}</p>
          </>
        ) : null}

        {phase === "done" && report ? (
          <div className="flex flex-col gap-2 text-sm text-[var(--qp-text-secondary)]">
            <p className="font-semibold text-[var(--qp-text-primary)]">
              {UI_TEXT.toast.taiImportSummary(report)}
            </p>
            <p className="text-xs text-[var(--qp-text-tertiary)]">{copy.refreshHint}</p>
          </div>
        ) : null}

        {phase === "parseFailed" ? (
          <p className="text-sm text-[var(--qp-text-secondary)]">{copy.parseFailed}</p>
        ) : null}

        {phase === "idle" ? (
          <p className="text-sm text-[var(--qp-text-tertiary)]">{copy.awaitFile}</p>
        ) : null}
      </div>
    </QuietDialog>
  );
}
