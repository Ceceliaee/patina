import { invoke } from "@tauri-apps/api/core";

const COMMIT_CLASSIFICATION_SETTINGS_COMMAND = "cmd_commit_classification_settings";
const AUTO_CLASSIFY_COMMAND = "cmd_auto_classify_apps";
const SCAN_DIRECTORY_COMMAND = "cmd_scan_directory_for_exes";

export interface ClassificationSettingMutation {
  key: string;
  value: string | null;
}

export interface AutoClassifyCandidate {
  appName: string;
  exeName: string;
}

export interface AutoClassifyResult {
  exeName: string;
  category: string | null;
  displayName: string | null;
}

export async function commitClassificationSettingMutations(
  mutations: readonly ClassificationSettingMutation[],
): Promise<void> {
  if (mutations.length === 0) {
    return;
  }

  await invoke(COMMIT_CLASSIFICATION_SETTINGS_COMMAND, { mutations });
}

export async function autoClassifyApps(
  candidates: readonly AutoClassifyCandidate[],
  reclassify?: boolean,
): Promise<AutoClassifyResult[]> {
  if (candidates.length === 0) {
    return [];
  }

  return invoke<AutoClassifyResult[]>(AUTO_CLASSIFY_COMMAND, {
    request: { candidates, reclassify: reclassify ?? false },
  });
}

export interface ScannedExe {
  exeName: string;
  filePath: string;
}

export async function scanDirectoryForExes(dirPath: string): Promise<ScannedExe[]> {
  return invoke<ScannedExe[]>(SCAN_DIRECTORY_COMMAND, { dirPath });
}
