import {
  clearSessionsBefore,
  loadSettings,
  saveSetting,
  type AppSettings,
} from "../../../shared/lib/settingsPersistenceAdapter";
import {
  exportBackup,
  pickBackupFile,
  pickBackupSaveFile,
  previewBackup,
  restoreBackup,
  type BackupPreview,
} from "../../../platform/backup/backupRuntimeGateway";
import { getAppVersion } from "../../../platform/desktop/appInfoGateway";
import { openExternalUrl } from "../../../platform/desktop/externalUrlGateway";
import { setIdleTimeout } from "../../../platform/runtime/trackingRuntimeGateway";
import type { CleanupRange } from "../types";
import {
  getSettingsBootstrapCache,
  setSettingsBootstrapCache,
} from "./settingsBootstrapCache";

export type { BackupPreview } from "../../../platform/backup/backupRuntimeGateway";

export interface SettingsPageBootstrapData {
  settings: AppSettings;
  appVersion: string;
}

export interface BackupRestorePreparation {
  path: string;
  preview: BackupPreview;
  previewSummary: string;
  compatible: boolean;
  incompatibilityMessage?: string;
}

type SettingsPatch = Partial<AppSettings>;

const RELEASE_NOTES_URL = "https://github.com/182376/time-tracking/releases";
const FEEDBACK_URL = "https://github.com/182376/time-tracking/issues/new/choose";

function resolveCleanupCutoffTime(range: CleanupRange, nowMs: number): number {
  const date = new Date(nowMs);
  date.setDate(date.getDate() - range);
  return date.getTime();
}

function buildBackupPreviewSummary(preview: BackupPreview): string {
  const exportedAt = new Date(preview.exported_at_ms).toLocaleString();
  return [
    `备份版本：v${preview.version}（Schema ${preview.schema_version}）`,
    `导出时间：${exportedAt}`,
    `应用版本：${preview.app_version}`,
    `兼容提示：${preview.compatibility_message}`,
    `会话数：${preview.session_count}，设置项：${preview.setting_count}，图标缓存：${preview.icon_cache_count}`,
  ].join("\n");
}

export class SettingsRuntimeAdapterService {
  static async loadBootstrap(): Promise<SettingsPageBootstrapData> {
    const [settings, appVersion] = await Promise.all([
      loadSettings(),
      getAppVersion().catch(() => "unknown"),
    ]);

    const bootstrap = {
      settings,
      appVersion,
    };
    setSettingsBootstrapCache(bootstrap);
    return bootstrap;
  }

  static getBootstrapCache(): SettingsPageBootstrapData | null {
    return getSettingsBootstrapCache();
  }

  static async prewarmBootstrapCache(): Promise<SettingsPageBootstrapData> {
    const bootstrap = await this.loadBootstrap();
    setSettingsBootstrapCache(bootstrap);
    return bootstrap;
  }

  static async updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    await saveSetting(key, value);

    if (key === "idle_timeout_secs") {
      await setIdleTimeout(value as number);
    }
  }

  static async clearSessionsByRange(range: CleanupRange, nowMs: number = Date.now()): Promise<void> {
    const cutoffTime = resolveCleanupCutoffTime(range, nowMs);
    await clearSessionsBefore(cutoffTime);
  }

  static async exportBackupWithPicker(initialPath?: string): Promise<string | null> {
    const selectedPath = await pickBackupSaveFile(initialPath);
    if (!selectedPath) {
      return null;
    }

    return exportBackup(selectedPath);
  }

  static async prepareBackupRestore(initialPath?: string): Promise<BackupRestorePreparation | null> {
    const selectedPath = await pickBackupFile(initialPath);
    if (!selectedPath) {
      return null;
    }

    const preview = await previewBackup(selectedPath);
    if (preview.compatibility_level === "incompatible") {
      return {
        path: selectedPath,
        preview,
        previewSummary: "",
        compatible: false,
        incompatibilityMessage: preview.compatibility_message,
      };
    }

    return {
      path: selectedPath,
      preview,
      previewSummary: buildBackupPreviewSummary(preview),
      compatible: true,
    };
  }

  static async restoreBackup(path: string): Promise<void> {
    await restoreBackup(path);
  }

  static async openReleaseNotes(): Promise<void> {
    await openExternalUrl(RELEASE_NOTES_URL);
  }

  static async openFeedback(): Promise<void> {
    await openExternalUrl(FEEDBACK_URL);
  }

  static buildSettingsPatch(
    saved: AppSettings,
    draft: AppSettings,
  ): SettingsPatch {
    const patch: SettingsPatch = {};
    const patchRecord = patch as Record<keyof AppSettings, AppSettings[keyof AppSettings]>;
    const keys = Object.keys(saved) as Array<keyof AppSettings>;
    for (const key of keys) {
      if (saved[key] !== draft[key]) {
        patchRecord[key] = draft[key];
      }
    }
    return patch;
  }

  static async commitSettingsPatch(patch: SettingsPatch): Promise<void> {
    const entries = Object.entries(patch) as Array<[keyof AppSettings, AppSettings[keyof AppSettings]]>;
    for (const [key, value] of entries) {
      await saveSetting(key, value);
      if (key === "idle_timeout_secs") {
        await setIdleTimeout(value as number);
      }
    }
  }
}

export async function prewarmSettingsBootstrapCache(): Promise<SettingsPageBootstrapData> {
  return SettingsRuntimeAdapterService.prewarmBootstrapCache();
}
