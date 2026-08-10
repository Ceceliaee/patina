import {
  getCategoryToken,
  isAppCategory,
  isExtendedCategory,
  normalizeExtendedCategory,
  USER_ASSIGNABLE_CATEGORIES,
  type AppCategory,
  type UserAssignableAppCategory,
} from "./categoryTokens.ts";
import { resolveCanonicalExecutable, shouldTrackProcess } from "./processNormalization.ts";
import { CategoryColorRegistry } from "./categoryColorRegistry.ts";
import { formatExecutableFallbackName } from "./executableDisplayName.ts";
import type { UiText } from "../i18n/index.ts";

export interface MappingHints {
  appName?: string;
}

export interface AppOverride {
  category?: UserAssignableAppCategory;
  displayName?: string;
  color?: string;
  track?: boolean;
  captureTitle?: boolean;
  enabled?: boolean;
  updatedAt?: number;
}

export interface AppInfo {
  name: string;
  category: AppCategory;
  color: string;
}

const USER_ASSIGNABLE_CATEGORY_SET = new Set<string>(USER_ASSIGNABLE_CATEGORIES);

function normalizeDisplayName(name: string | undefined) {
  return (name ?? "").trim().replace(/\.exe$/i, "");
}

function normalizeHexColor(color: string | undefined): string | null {
  const raw = (color ?? "").trim();
  if (!raw) return null;

  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
    return null;
  }

  return normalized.toUpperCase();
}

function normalizeCategoryLabelOverrides(
  overrides: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!overrides) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [category, label] of Object.entries(overrides)) {
    if (!isAppCategory(category) || category === "system" || category === "other") {
      continue;
    }
    const trimmed = label.trim().replace(/\s+/g, " ");
    if (!trimmed) {
      continue;
    }
    normalized[category] = trimmed;
  }
  return normalized;
}

function normalizeUserAssignableCategory(category: string | undefined): UserAssignableAppCategory | null {
  const normalized = (category ?? "").trim();
  if (!normalized) {
    return null;
  }

  if (isExtendedCategory(normalized)) {
    return normalizeExtendedCategory(normalized);
  }

  if (USER_ASSIGNABLE_CATEGORY_SET.has(normalized)) {
    return normalized as UserAssignableAppCategory;
  }

  return null;
}

function normalizeOverride(override: AppOverride | null | undefined): AppOverride | null {
  if (!override) return null;
  if (override.enabled === false) return null;

  const normalized: AppOverride = {};

  const normalizedCategory = normalizeUserAssignableCategory(override.category);
  if (normalizedCategory) {
    normalized.category = normalizedCategory;
  }
  if (override.displayName?.trim()) {
    normalized.displayName = override.displayName.trim();
  }
  const color = normalizeHexColor(override.color);
  if (color) {
    normalized.color = color;
  }
  if (override.track === false) {
    normalized.track = false;
  }
  if (override.captureTitle === false) {
    normalized.captureTitle = false;
  }
  if (typeof override.updatedAt === "number" && Number.isFinite(override.updatedAt)) {
    normalized.updatedAt = override.updatedAt;
  }
  normalized.enabled = true;

  const hasMeaningfulOverride = Boolean(
    normalized.category
    || normalized.displayName
    || normalized.color
    || normalized.track === false
    || normalized.captureTitle === false,
  );

  return hasMeaningfulOverride ? normalized : null;
}

export class ProcessMapper {
  private static userOverrides: Record<string, AppOverride> = {};
  private static categoryColors = new CategoryColorRegistry();
  private static categoryLabelOverrides: Record<string, string> = {};

  static getUserAssignableCategories() {
    return [...USER_ASSIGNABLE_CATEGORIES];
  }

  static setDeletedCategories(categories: AppCategory[]) {
    this.categoryColors.setDeletedCategories(categories);
  }

  static getDeletedCategories(): AppCategory[] {
    return this.categoryColors.getDeletedCategories();
  }

  static isCategoryDeleted(category: AppCategory): boolean {
    return this.categoryColors.isCategoryDeleted(category);
  }

  static getCategoryLabel(category: AppCategory, uiText: UiText) {
    return this.categoryLabelOverrides[category] ?? getCategoryToken(category, uiText).label;
  }

  static getCategoryLabelOverride(category: AppCategory): string | null {
    return this.categoryLabelOverrides[category] ?? null;
  }

  static setCategoryLabelOverrides(overrides: Record<string, string>) {
    this.categoryLabelOverrides = normalizeCategoryLabelOverrides(overrides);
  }

  static setCategoryLabelOverride(category: AppCategory, label?: string | null) {
    const normalized = normalizeCategoryLabelOverrides({ [category]: label ?? "" });
    const nextLabel = normalized[category];
    if (!nextLabel) {
      delete this.categoryLabelOverrides[category];
      return;
    }
    this.categoryLabelOverrides[category] = nextLabel;
  }

  static clearCategoryLabelOverrides() {
    this.categoryLabelOverrides = {};
  }

  static getCategoryColor(category: AppCategory) {
    return this.categoryColors.getCategoryColor(category);
  }

  static getDefaultCategoryColor(category: AppCategory) {
    return this.categoryColors.getDefaultCategoryColor(category);
  }

  static getCategoryColorOverride(category: AppCategory): string | null {
    return this.categoryColors.getCategoryColorOverride(category);
  }

  static setCategoryColorOverrides(overrides: Record<string, string>) {
    this.categoryColors.setCategoryColorOverrides(overrides);
  }

  static setCategoryColorOverride(category: AppCategory, colorValue?: string | null) {
    this.categoryColors.setCategoryColorOverride(category, colorValue);
  }

  static clearCategoryColorOverrides() {
    this.categoryColors.clearCategoryColorOverrides();
  }

  static setCategoryDefaultColorAssignments(assignments: Record<string, string>) {
    this.categoryColors.setCategoryDefaultColorAssignments(assignments);
  }

  static setCategoryDefaultColorAssignmentPersistence(
    handler: ((category: AppCategory, colorValue: string | null) => Promise<void>) | null,
  ) {
    this.categoryColors.setCategoryDefaultColorAssignmentPersistence(handler);
  }

  static async removeCategoryDefaultColorAssignment(category: AppCategory) {
    await this.categoryColors.removeCategoryDefaultColorAssignment(category);
  }

  static setUserOverrides(overrides: Record<string, AppOverride>) {
    const normalized: Record<string, AppOverride> = {};
    for (const [exeName, override] of Object.entries(overrides)) {
      const canonicalExe = resolveCanonicalExecutable(exeName);
      if (!canonicalExe) continue;

      const safeOverride = normalizeOverride(override);
      if (!safeOverride) continue;
      normalized[canonicalExe] = safeOverride;
    }
    this.userOverrides = normalized;
  }

  static setUserOverride(exeName: string, override: AppOverride | null) {
    const canonicalExe = resolveCanonicalExecutable(exeName);
    if (!canonicalExe) return;

    const safeOverride = normalizeOverride(override);
    if (!safeOverride) {
      delete this.userOverrides[canonicalExe];
      return;
    }

    this.userOverrides[canonicalExe] = safeOverride;
  }

  static clearUserOverrides() {
    this.userOverrides = {};
  }

  static getUserOverride(exeName: string): AppOverride | null {
    const canonicalExe = resolveCanonicalExecutable(exeName);
    return this.userOverrides[canonicalExe] ?? null;
  }

  private static mapWithOverride(exeName: string, hints: MappingHints, override: AppOverride | null | undefined): AppInfo {
    const canonicalExe = resolveCanonicalExecutable(exeName);
    const fallbackName = formatExecutableFallbackName(canonicalExe) || canonicalExe;
    const resolvedName = override?.displayName || normalizeDisplayName(hints.appName) || fallbackName;
    const rawCategory = override?.category ?? "other";
    const resolvedCategory = this.categoryColors.resolveActiveCategory(rawCategory);

    return {
      name: resolvedName,
      category: resolvedCategory,
      color: override?.color ?? this.categoryColors.getCategoryColor(resolvedCategory),
    };
  }

  static map(exeName: string, hints: MappingHints = {}): AppInfo {
    const canonicalExe = resolveCanonicalExecutable(exeName);
    return this.mapWithOverride(exeName, hints, this.userOverrides[canonicalExe]);
  }

  static mapWithoutOverride(exeName: string, hints: MappingHints = {}): AppInfo {
    return this.mapWithOverride(exeName, hints, null);
  }

  static isTrackingEnabledByUser(exeName: string): boolean {
    const canonicalExe = resolveCanonicalExecutable(exeName);
    return this.userOverrides[canonicalExe]?.track !== false;
  }

  static shouldTrack(exeName: string): boolean {
    if (!shouldTrackProcess(exeName)) {
      return false;
    }

    return this.isTrackingEnabledByUser(exeName);
  }

  static toOverrideStorageValue(override: AppOverride) {
    return JSON.stringify({
      category: override.category ?? null,
      displayName: override.displayName ?? null,
      color: normalizeHexColor(override.color) ?? null,
      track: override.track !== false,
      captureTitle: override.captureTitle !== false,
      enabled: override.enabled !== false,
      updatedAt: override.updatedAt ?? Date.now(),
    });
  }

  static fromOverrideStorageValue(rawValue: string): AppOverride | null {
    if (!rawValue.trim()) return null;
    try {
      const parsed = JSON.parse(rawValue) as AppOverride;
      return normalizeOverride(parsed);
    } catch {
      return null;
    }
  }
}
