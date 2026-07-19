import {
  commitCanonicalImport,
  deleteImportBatch,
  destructureExternalData,
  listImportBatches,
  pickCanonicalImportFile,
  pickExternalImportFile,
  previewCanonicalImport,
} from "../../../platform/persistence/importRuntimeGateway.ts";
import type {
  ImportBatch,
  ImportCategoryCandidate,
  ImportCommitReport,
  ImportDeleteReport,
  ImportPreview,
} from "../../../platform/persistence/importRuntimeGateway.ts";
import type { ClassificationSettingMutation } from "../../../platform/persistence/classificationSettingsGateway.ts";

export type {
  DestructureReport,
  ImportBatch,
  ImportCommitReport,
  ImportDeleteReport,
  ImportPreview,
  ImportPreviewError,
  ImportCategoryCandidate,
} from "../../../platform/persistence/importRuntimeGateway.ts";

export interface PreparedImportClassification {
  mutations: ClassificationSettingMutation[];
  applyRuntime: () => void;
}

interface CommitImportWithClassificationDeps {
  commitImport: (
    preview: ImportPreview,
    classificationMutations: readonly ClassificationSettingMutation[],
  ) => Promise<ImportCommitReport>;
  prepareClassification: (
    candidates: readonly ImportCategoryCandidate[],
  ) => Promise<PreparedImportClassification>;
}

export async function commitImportWithClassification(
  preview: ImportPreview,
  deps: CommitImportWithClassificationDeps,
): Promise<ImportCommitReport> {
  const prepared = await deps.prepareClassification(preview.categoryCandidates);
  const report = await deps.commitImport(preview, prepared.mutations);
  if (report.batchId && report.importedRecords > 0) {
    prepared.applyRuntime();
  }
  return report;
}

interface DeleteImportBatchWithRefreshDeps {
  deleteImportBatch: (batchId: string) => Promise<ImportDeleteReport>;
  refreshBatches: () => Promise<ImportBatch[]>;
  onImportedDataChanged: () => void | Promise<void>;
}

export async function deleteImportBatchWithRefresh(
  batchId: string,
  deps: DeleteImportBatchWithRefreshDeps,
): Promise<{ report: ImportDeleteReport; batches: ImportBatch[] }> {
  const report = await deps.deleteImportBatch(batchId);
  await deps.onImportedDataChanged();
  const batches = await deps.refreshBatches();
  return { report, batches };
}

export const SettingsImportService = {
  commitCanonicalImport,
  deleteImportBatch,
  destructureExternalData,
  listImportBatches,
  pickCanonicalImportFile,
  pickExternalImportFile,
  previewCanonicalImport,
};
