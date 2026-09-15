import { ProcessMapper, type AppInfo, type AppOverride, type MappingHints } from "./processMapper.ts";
import type { AppCategory } from "./categoryTokens.ts";
import type { UiText } from "../i18n/index.ts";
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
    return resolveLinkedApp(exeName, this.links);
  }

  static getLinkedAppKeys(exeName: string): string[] {
    return linkedAppKeys(this.resolveStatisticalApp(exeName), this.links);
  }

  static mapApp(exeName: string, hints: MappingHints = {}): AppInfo {
    const parent = this.resolveStatisticalApp(exeName);
    return ProcessMapper.map(parent, parent === resolveCanonicalExecutable(exeName) ? hints : {});
  }

  static mapAppWithoutOverride(exeName: string, hints: MappingHints = {}): AppInfo {
    return ProcessMapper.mapWithoutOverride(exeName, hints);
  }

  static getCategoryLabel(category: AppCategory, uiText: UiText): string {
    return ProcessMapper.getCategoryLabel(category, uiText);
  }

  static getCategoryLabelOverride(category: AppCategory): string | null {
    return ProcessMapper.getCategoryLabelOverride(category);
  }

  static getCategoryColor(category: AppCategory): string {
    return ProcessMapper.getCategoryColor(category);
  }

  static getUserOverride(exeName: string): AppOverride | null {
    return ProcessMapper.getUserOverride(exeName);
  }

  static shouldTrackApp(exeName: string): boolean {
    return ProcessMapper.shouldTrack(exeName);
  }

  static isAppTrackingEnabledByUser(exeName: string): boolean {
    return ProcessMapper.isTrackingEnabledByUser(exeName);
  }

  static resolveCanonicalExecutable(exeName: string): string {
    return resolveCanonicalExecutable(exeName);
  }

  static shouldTrackProcess(
    exeName: string,
    options: { appName?: string; windowTitle?: string } = {},
  ): boolean {
    return shouldTrackProcess(exeName, options);
  }

  static normalizeExecutable(exeName: string): string {
    return normalizeExecutable(exeName);
  }
}
