import { loadLocaleText } from "../../../shared/i18n/runtime.ts";
import type { AppLanguage } from "../../../shared/settings/appSettings.ts";

interface SettingsLanguagePreviewResult {
  ready: boolean;
  error: unknown | null;
}

export async function prepareSettingsLanguagePreview(
  language: AppLanguage,
  load: (language: AppLanguage) => Promise<unknown> = loadLocaleText,
): Promise<SettingsLanguagePreviewResult> {
  try {
    await load(language);
    return { ready: true, error: null };
  } catch (error) {
    return { ready: false, error };
  }
}
