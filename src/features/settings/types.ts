import type { AppLanguage, AppSettings, ColorScheme, ThemeMode } from "../../shared/settings/appSettings";
import type { QuietToastTone } from "../../shared/types/toast";
import type { UpdateSnapshot } from "../../shared/types/update";

export interface ColorSchemePreview {
  light: ColorScheme;
  dark: ColorScheme;
}

export interface SettingsPageProps {
  onSettingsChanged: (settings: AppSettings) => void;
  onColorSchemeSaved?: (settings: AppSettings) => void;
  onCheckForUpdates?: () => Promise<void>;
  onOpenUpdateDialog?: () => void;
  onOpenUpdateReleasePage?: () => Promise<void>;
  onOpenUpdateDownload?: () => Promise<void>;
  updateSnapshot?: UpdateSnapshot;
  updateChecking?: boolean;
  updateInstalling?: boolean;
  updateDialogOpen?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onToast?: (message: string, tone?: QuietToastTone) => void;
  onRegisterSaveHandler?: (handler: (() => Promise<boolean>) | null) => void;
  onThemeModePreview?: (themeMode: ThemeMode | null) => void;
  onColorSchemePreview?: (colorScheme: ColorSchemePreview | null) => void;
  onLanguagePreview?: (language: AppLanguage | null) => void;
}

export type CleanupRange = 180 | 90 | 60 | 30 | 15 | 7;
