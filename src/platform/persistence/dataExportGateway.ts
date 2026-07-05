import { invoke } from "@tauri-apps/api/core";

const PICK_PARQUET_FILE_COMMAND = "cmd_pick_parquet_save_file";
const EXPORT_PARQUET_COMMAND = "cmd_export_data_to_parquet";
const EXPORT_FIELDS_COMMAND = "cmd_get_parquet_export_fields";
const PICK_EXPORT_FILE_COMMAND = "cmd_pick_export_save_file";
const EXPORT_DATA_COMMAND = "cmd_export_data";

export interface ExportFieldInfo {
  name: string;
  label: string;
  group: string;
  selectedByDefault: boolean;
}

export interface ExportToParquetRequest {
  outputPath: string;
  selectedFields: string[];
}

export interface ExportToParquetResult {
  rowCount: number;
}

export interface ExportDataRequest {
  format: string;
  outputPath: string;
  startTime?: number | null;
  endTime?: number | null;
  selectedFields?: string[] | null;
}

export interface ExportDataResult {
  rowCount: number;
}

export async function pickParquetSaveFile(initialPath?: string): Promise<string | null> {
  return invoke<string | null>(PICK_PARQUET_FILE_COMMAND, { initialPath: initialPath ?? null });
}

export async function getParquetExportFields(): Promise<ExportFieldInfo[]> {
  return invoke<ExportFieldInfo[]>(EXPORT_FIELDS_COMMAND);
}

export async function exportDataToParquet(request: ExportToParquetRequest): Promise<ExportToParquetResult> {
  return invoke<ExportToParquetResult>(EXPORT_PARQUET_COMMAND, { request });
}

export async function pickExportSaveFile(format: string, initialPath?: string): Promise<string | null> {
  return invoke<string | null>(PICK_EXPORT_FILE_COMMAND, { format, initialPath: initialPath ?? null });
}

export async function exportData(request: ExportDataRequest): Promise<ExportDataResult> {
  return invoke<ExportDataResult>(EXPORT_DATA_COMMAND, { request });
}
