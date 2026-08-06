import { useCallback, useState } from "react";
import {
  commitImportWithClassification,
  deleteImportBatchWithRefresh,
  SettingsImportService,
  type ImportCategoryCandidate,
  type ImportBatch,
  type ImportPreview,
  type PreparedImportClassification,
} from "../services/settingsImportService.ts";
import type { QuietToastTone } from "../../../shared/types/toast.ts";
import { useLocaleText } from "../../../shared/i18n/index.ts";

type ImportDialogView = "actions" | "preview" | "batches";

export function useSettingsImportState(
  onToast?: (message: string, tone?: QuietToastTone) => void,
  onPrepareImportCategories?: (
    candidates: readonly ImportCategoryCandidate[],
  ) => Promise<PreparedImportClassification>,
  onImportedDataChanged: () => void = () => {},
) {
  const UI_TEXT = useLocaleText();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ImportDialogView>("actions");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [batches, setBatches] = useState<ImportBatch[]>([]);

  const refreshBatches = useCallback(async () => {
    const nextBatches = await SettingsImportService.listImportBatches();
    setBatches(nextBatches);
    return nextBatches;
  }, []);

  const openDialog = useCallback(async () => {
    setOpen(true);
    setView("actions");
    setPreview(null);
    try {
      await refreshBatches();
    } catch (error) {
      onToast?.(String(error), "error");
    }
  }, [onToast, refreshBatches]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    setOpen(false);
    setPreview(null);
    setView("actions");
  }, [busy]);

  const chooseCanonicalCsv = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const filePath = await SettingsImportService.pickCanonicalImportFile();
      if (!filePath) return;
      const nextPreview = await SettingsImportService.previewCanonicalImport(filePath);
      setPreview(nextPreview);
      setView("preview");
    } catch (error) {
      onToast?.(String(error), "error");
    } finally {
      setBusy(false);
    }
  }, [busy, onToast]);

  const confirmImport = useCallback(async () => {
    if (busy || !preview || preview.validRecords <= preview.duplicateRecords) return;
    setBusy(true);
    try {
      const report = await commitImportWithClassification(preview, {
        commitImport: SettingsImportService.commitCanonicalImport,
        prepareClassification: onPrepareImportCategories ?? (async () => ({
          mutations: [],
          applyRuntime: () => {},
        })),
      });
      await refreshBatches();
      onToast?.(UI_TEXT.settings.dataImport.importSuccess(report.importedRecords), "success");
      setPreview(null);
      setView("actions");
    } catch (error) {
      onToast?.(String(error), "error");
    } finally {
      setBusy(false);
    }
  }, [UI_TEXT, busy, onPrepareImportCategories, onToast, preview, refreshBatches]);

  const destructureExternal = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const filePath = await SettingsImportService.pickExternalImportFile();
      if (!filePath) return;
      const report = await SettingsImportService.destructureExternalData(filePath);
      onToast?.(UI_TEXT.settings.dataImport.destructureSuccess(report.recordsWritten, report.outputPath), "success");
    } catch (error) {
      onToast?.(String(error), "error");
    } finally {
      setBusy(false);
    }
  }, [UI_TEXT, busy, onToast]);

  const showBatches = useCallback(() => {
    if (batches.length > 0) setView("batches");
  }, [batches.length]);

  const removeBatch = useCallback(async (batchId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const { report, batches: nextBatches } = await deleteImportBatchWithRefresh(batchId, {
        deleteImportBatch: SettingsImportService.deleteImportBatch,
        refreshBatches,
        onImportedDataChanged,
      });
      onToast?.(UI_TEXT.settings.dataImport.deleteSuccess(
        report.deletedExactSessions + report.deletedHourBuckets,
      ), "success");
      if (nextBatches.length === 0) setView("actions");
    } catch (error) {
      onToast?.(String(error), "error");
    } finally {
      setBusy(false);
    }
  }, [UI_TEXT, busy, onImportedDataChanged, onToast, refreshBatches]);

  return {
    open,
    view,
    busy,
    preview,
    batches,
    openDialog,
    closeDialog,
    chooseCanonicalCsv,
    confirmImport,
    destructureExternal,
    showBatches,
    showActions: () => setView("actions"),
    removeBatch,
  };
}
