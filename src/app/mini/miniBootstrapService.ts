import type { AppSettings } from "../../shared/settings/appSettings.ts";
import { AppClassification } from "../../shared/classification/appClassification.ts";
import { APP_LINK_KEY_PREFIX } from "../../shared/classification/appLinks.ts";
import { ProcessMapper, type AppOverride } from "../../shared/classification/processMapper.ts";
import {
  type MiniBootstrapSnapshot,
} from "../../platform/desktop/miniContentRuntimeGateway.ts";

const APP_OVERRIDE_KEY_PREFIX = "__app_override::";

interface MiniRuntimeBootstrapSnapshot {
  settings: AppSettings;
}

export function applyMiniBootstrapSnapshot(
  snapshot: MiniBootstrapSnapshot,
): MiniRuntimeBootstrapSnapshot {
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
  AppClassification.setAppLinks(Object.fromEntries(snapshot.appLinks
    .filter((row) => row.key.startsWith(APP_LINK_KEY_PREFIX))
    .map((row) => [row.key.slice(APP_LINK_KEY_PREFIX.length), row.value])));

  return {
    settings: snapshot.settings,
  };
}
