import { ProcessMapper, type AppInfo, type AppOverride, type MappingHints } from "./processMapper.ts";
import type { AppCategory } from "./categoryTokens.ts";
import type { UiText } from "../i18n/index.ts";
import { isAnonymousActivity } from "./anonymousActivity.ts";
import { OTHER_CATEGORY_FIXED_COLOR } from "./categoryTokens.ts";
import { resolveLinkedApp, validateAppLinks, linkedAppKeys, type AppLinks } from "./appLinks.ts";
import {
  normalizeExecutable,
  resolveCanonicalExecutable,
  shouldTrackProcess,
} from "./processNormalization.ts";

export class AppClassification {
  private static links: AppLinks = {};

  static setAppLinks(links: AppLinks): void {
    validateAppLinks(links);
    this.links = { ...links };
  }

  static resolveStatisticalApp(exeName: string): string {
    if (isAnonymousActivity(exeName)) return exeName;
    return resolveLinkedApp(exeName, this.links);
  }

  static getLinkedAppKeys(exeName: string): string[] {
    if (isAnonymousActivity(exeName)) return [];
    return linkedAppKeys(this.resolveStatisticalApp(exeName), this.links);
  }

  static mapApp(exeName: string, hints: MappingHints = {}): AppInfo {
    if (isAnonymousActivity(exeName)) return { name: "", category: "anonymous", color: OTHER_CATEGORY_FIXED_COLOR };
    const parent = this.resolveStatisticalApp(exeName);
    return ProcessMapper.map(parent, parent === resolveCanonicalExecutable(exeName) ? hints : {});
  }

  static mapAppWithoutOverride(exeName: string, hints: MappingHints = {}): AppInfo {
    return ProcessMapper.mapWithoutOverride(exeName, hints);
  }

  static getCategoryLabel(category: AppCategory, uiText: UiText): string {
    if (category === "anonymous") return uiText.common.anonymousActivity;
    return ProcessMapper.getCategoryLabel(category, uiText);
  }

  static getCategoryLabelOverride(category: AppCategory): string | null {
    if (category === "anonymous") return null;
    return ProcessMapper.getCategoryLabelOverride(category);
  }

  static getCategoryColor(category: AppCategory): string {
    if (category === "anonymous") return OTHER_CATEGORY_FIXED_COLOR;
    return ProcessMapper.getCategoryColor(category);
  }

  static getUserOverride(exeName: string): AppOverride | null {
    if (isAnonymousActivity(exeName)) return null;
    return ProcessMapper.getUserOverride(exeName);
  }

  static shouldTrackApp(exeName: string): boolean {
    if (isAnonymousActivity(exeName)) return true;
    return ProcessMapper.shouldTrack(exeName);
  }

  static isAppTrackingEnabledByUser(exeName: string): boolean {
    if (isAnonymousActivity(exeName)) return true;
    return ProcessMapper.isTrackingEnabledByUser(exeName);
  }

  static resolveCanonicalExecutable(exeName: string): string {
    if (isAnonymousActivity(exeName)) return exeName;
    return resolveCanonicalExecutable(exeName);
  }

  static shouldTrackProcess(
    exeName: string,
    options: { appName?: string; windowTitle?: string } = {},
  ): boolean {
    if (isAnonymousActivity(exeName)) return true;
    return shouldTrackProcess(exeName, options);
  }

  static normalizeExecutable(exeName: string): string {
    if (isAnonymousActivity(exeName)) return exeName;
    return normalizeExecutable(exeName);
  }
}
