import type { AppSettings } from "../../shared/settings/appSettings";
import type { QuietToastTone } from "../../shared/types/toast";
import type { ImportCategoryCandidate } from "../../platform/persistence/importRuntimeGateway.ts";
import type { PreparedImportClassification } from "./services/settingsImportService.ts";

export interface SettingsPageProps {
  onSettingsChanged: (settings: AppSettings) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onToast?: (message: string, tone?: QuietToastTone) => void;
  onRegisterSaveHandler?: (handler: (() => Promise<boolean>) | null) => void;
  onPrepareImportCategories?: (
    candidates: readonly ImportCategoryCandidate[],
  ) => Promise<PreparedImportClassification>;
  onImportedDataChanged?: () => void;
}

export type CleanupRange = 180 | 90 | 60 | 30 | 15 | 7;
