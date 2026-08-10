export type UpdateStatus =
  | "idle"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export type UpdateErrorStage =
  | "check"
  | "download"
  | "install";

export interface UpdateSnapshot {
  currentVersion: string;
  status: UpdateStatus;
  latestVersion: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  errorMessage: string | null;
  errorStage: UpdateErrorStage | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
  releasePageUrl: string | null;
  assetDownloadUrl: string | null;
}
