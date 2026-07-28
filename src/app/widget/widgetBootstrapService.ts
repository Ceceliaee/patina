import type { AppSettings } from "../../shared/settings/appSettings.ts";
import { ProcessMapper, type AppOverride } from "../../shared/classification/processMapper.ts";
import { normalizeSettingsRecord } from "../../shared/settings/appSettingsNormalization.ts";
import {
  getWidgetBootstrapSnapshot,
  type WidgetBootstrapSnapshot,
} from "../../platform/desktop/widgetRuntimeGateway.ts";

const APP_OVERRIDE_KEY_PREFIX = "__app_override::";

export interface WidgetRuntimeBootstrapSnapshot {
  settings: AppSettings;
}

export function applyWidgetBootstrapSnapshot(
  snapshot: WidgetBootstrapSnapshot,
): WidgetRuntimeBootstrapSnapshot {
  const overrides: Record<string, AppOverride> = {};
  for (const row of snapshot.appOverrides) {
    if (!row.key.startsWith(APP_OVERRIDE_KEY_PREFIX)) {
      continue;
    }
    const exeName = row.key.slice(APP_OVERRIDE_KEY_PREFIX.length);
    const override = ProcessMapper.fromOverrideStorageValue(row.value);
    if (override) {
      overrides[exeName] = override;
    }
  }
  ProcessMapper.setUserOverrides(overrides);

  return {
    settings: normalizeSettingsRecord({
      tracking_paused: snapshot.settings.trackingPaused ?? undefined,
      theme_mode: snapshot.settings.themeMode ?? undefined,
      language: snapshot.settings.language ?? undefined,
      color_scheme_light: snapshot.settings.colorSchemeLight ?? undefined,
      color_scheme_dark: snapshot.settings.colorSchemeDark ?? undefined,
    }),
  };
}

export async function loadWidgetRuntimeBootstrapSnapshot(): Promise<WidgetRuntimeBootstrapSnapshot> {
  return applyWidgetBootstrapSnapshot(await getWidgetBootstrapSnapshot());
}
