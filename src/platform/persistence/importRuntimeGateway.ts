import { invoke } from "@tauri-apps/api/core";
import type { ClassificationSettingMutation } from "./classificationSettingsGateway.ts";

export interface ImportPreviewError {
  line: number;
  message: string;
}

export interface ImportCategoryCandidate {
  exeName: string;
  categories: string[];
}

export interface ImportPreview {
  filePath: string;
  fileName: string;
  fileFingerprint: string;
  validRecords: number;
  duplicateRecords: number;
  errorRecords: number;
  exactSessions: number;
  hourBuckets: number;
  categoryCandidates: ImportCategoryCandidate[];
  errors: ImportPreviewError[];
}

export interface ImportCommitReport {
  batchId: string | null;
  importedRecords: number;
}

export interface ImportBatch {
  id: string;
  importedAt: number;
  sourceName: string;
  exactSessions: number;
  hourBuckets: number;
}

export interface ImportDeleteReport {
  deletedExactSessions: number;
  deletedHourBuckets: number;
}

export interface DestructureReport {
  outputPath: string;
  recordsWritten: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasFields(
  value: unknown,
  stringFields: readonly string[],
  numberFields: readonly string[],
): value is Record<string, unknown> {
  return isRecord(value)
    && stringFields.every((field) => typeof value[field] === "string")
    && numberFields.every((field) => (
      typeof value[field] === "number" && Number.isFinite(value[field])
    ));
}

function isPreviewError(value: unknown): value is ImportPreviewError {
  return hasFields(value, ["message"], ["line"]);
}

function isCategoryCandidate(value: unknown): value is ImportCategoryCandidate {
  return hasFields(value, ["exeName"], [])
    && Array.isArray(value.categories)
    && value.categories.every((category) => typeof category === "string");
}

export function parseImportPreview(value: unknown): ImportPreview {
  if (!hasFields(
    value,
    ["filePath", "fileName", "fileFingerprint"],
    ["validRecords", "duplicateRecords", "errorRecords", "exactSessions", "hourBuckets"],
  )
    || !Array.isArray(value.errors)
    || !value.errors.every(isPreviewError)
    || !Array.isArray(value.categoryCandidates)
    || !value.categoryCandidates.every(isCategoryCandidate)) {
    throw new Error("Received invalid import preview payload");
  }
  return value as unknown as ImportPreview;
}

export function parseImportBatches(value: unknown): ImportBatch[] {
  if (!Array.isArray(value) || !value.every((item) => hasFields(
    item,
    ["id", "sourceName"],
    ["importedAt", "exactSessions", "hourBuckets"],
  ))) {
    throw new Error("Received invalid import batch payload");
  }
  return value as unknown as ImportBatch[];
}

function parseCommitReport(value: unknown): ImportCommitReport {
  if (!hasFields(value, [], ["importedRecords"])
    || !(typeof value.batchId === "string" || value.batchId === null)) {
    throw new Error("Received invalid import commit payload");
  }
  return value as unknown as ImportCommitReport;
}

function parseDeleteReport(value: unknown): ImportDeleteReport {
  if (!hasFields(value, [], ["deletedExactSessions", "deletedHourBuckets"])) {
    throw new Error("Received invalid import deletion payload");
  }
  return value as unknown as ImportDeleteReport;
}

function parseDestructureReport(value: unknown): DestructureReport {
  if (!hasFields(value, ["outputPath"], ["recordsWritten"])) {
    throw new Error("Received invalid destructure payload");
  }
  return value as unknown as DestructureReport;
}

export function pickCanonicalImportFile(initialPath?: string): Promise<string | null> {
  return invoke("cmd_pick_canonical_import_file", { initialPath: initialPath ?? null });
}

export function pickExternalImportFile(initialPath?: string): Promise<string | null> {
  return invoke("cmd_pick_external_import_file", { initialPath: initialPath ?? null });
}

export async function previewCanonicalImport(filePath: string): Promise<ImportPreview> {
  return parseImportPreview(await invoke("cmd_preview_canonical_import", { filePath }));
}

export async function commitCanonicalImport(
  preview: ImportPreview,
  classificationMutations: readonly ClassificationSettingMutation[] = [],
): Promise<ImportCommitReport> {
  return parseCommitReport(await invoke("cmd_commit_canonical_import", {
    filePath: preview.filePath,
    expectedFingerprint: preview.fileFingerprint,
    classificationMutations,
  }));
}

export async function destructureExternalData(filePath: string): Promise<DestructureReport> {
  return parseDestructureReport(await invoke("cmd_destructure_external_data", { filePath }));
}

export async function listImportBatches(): Promise<ImportBatch[]> {
  return parseImportBatches(await invoke("cmd_list_import_batches"));
}

export async function deleteImportBatch(batchId: string): Promise<ImportDeleteReport> {
  return parseDeleteReport(await invoke("cmd_delete_import_batch", { batchId }));
}
