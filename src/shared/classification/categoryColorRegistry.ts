import {
  isAppCategory,
  isExtendedCategory,
  OTHER_CATEGORY_FIXED_COLOR,
  QUIET_PRO_CATEGORY_PALETTE_37,
  USER_ASSIGNABLE_CATEGORIES,
  type AppCategory,
} from "./categoryTokens.ts";
import { RELEASE_DEFAULT_CATEGORY_COLOR_ASSIGNMENTS } from "./releaseDefaultCategoryColors.ts";

function normalizeHexColor(color: string | undefined): string | null {
  const raw = (color ?? "").trim();
  if (!raw) return null;

  const normalized = raw.startsWith("#") ? raw : `#${raw}`;
  if (!/^#[0-9A-Fa-f]{6}$/.test(normalized)) {
    return null;
  }

  return normalized.toUpperCase();
}

function normalizeCategoryColorOverrides(
  overrides: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!overrides) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [category, colorValue] of Object.entries(overrides)) {
    if (!isAppCategory(category)) {
      continue;
    }
    const color = normalizeHexColor(colorValue);
    if (!color) {
      continue;
    }
    normalized[category] = color;
  }
  return normalized;
}

function normalizeDefaultColorAssignments(
  assignments: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!assignments) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [category, colorValue] of Object.entries(assignments)) {
    if (!isAppCategory(category) || category === "system" || category === "other") {
      continue;
    }
    const color = normalizeHexColor(colorValue);
    if (!color || !QUIET_PRO_CATEGORY_PALETTE_37.includes(color as (typeof QUIET_PRO_CATEGORY_PALETTE_37)[number])) {
      continue;
    }
    normalized[category] = color;
  }
  return normalized;
}

export class CategoryColorRegistry {
  private categoryColorOverrides: Record<string, string> = {};
  private categoryDefaultColorAssignments: Record<string, string> = {};
  private persistCategoryDefaultColorAssignment:
    ((category: AppCategory, colorValue: string | null) => Promise<void>) | null = null;
  private deletedCategories = new Set<AppCategory>();

  setDeletedCategories(categories: AppCategory[]) {
    const nextDeleted = new Set(categories);
    for (const category of Object.keys(this.categoryDefaultColorAssignments)) {
      if (!isAppCategory(category) || category === "system" || category === "other") {
        continue;
      }
      const wasDeleted = this.deletedCategories.has(category);
      const isNowDeleted = nextDeleted.has(category);
      if (!wasDeleted && isNowDeleted) {
        void this.removeCategoryDefaultColorAssignment(category);
      }
    }
    this.deletedCategories = nextDeleted;
  }

  getDeletedCategories(): AppCategory[] {
    return Array.from(this.deletedCategories);
  }

  isCategoryDeleted(category: AppCategory): boolean {
    return this.deletedCategories.has(category);
  }

  resolveActiveCategory(category: AppCategory): AppCategory {
    if (!this.deletedCategories.has(category)) {
      return category;
    }

    if (category === "system") {
      return "system";
    }

    const fallback = USER_ASSIGNABLE_CATEGORIES.find((item) => !this.deletedCategories.has(item));
    return (fallback ?? "other") as AppCategory;
  }

  getCategoryColor(category: AppCategory) {
    return this.categoryColorOverrides[category] ?? this.getDefaultCategoryColor(category);
  }

  getDefaultCategoryColor(category: AppCategory) {
    if (category === "system") {
      return "#475569";
    }

    if (category === "other") {
      return OTHER_CATEGORY_FIXED_COLOR;
    }

    const persisted = this.categoryDefaultColorAssignments[category];
    if (persisted) {
      return persisted;
    }

    if (!isExtendedCategory(category)) {
      const releaseDefaultColor = Object.prototype.hasOwnProperty.call(
        RELEASE_DEFAULT_CATEGORY_COLOR_ASSIGNMENTS,
        category,
      )
        ? RELEASE_DEFAULT_CATEGORY_COLOR_ASSIGNMENTS[
          category as keyof typeof RELEASE_DEFAULT_CATEGORY_COLOR_ASSIGNMENTS
        ]
        : undefined;
      if (releaseDefaultColor) {
        return releaseDefaultColor;
      }
    }

    const usedColors = new Set<string>();
    for (const [assignedCategory, color] of Object.entries(this.categoryDefaultColorAssignments)) {
      if (!isAppCategory(assignedCategory)) {
        continue;
      }
      if (assignedCategory === "system" || assignedCategory === "other") {
        continue;
      }
      if (this.deletedCategories.has(assignedCategory)) {
        continue;
      }
      usedColors.add(color);
    }

    const availableColors = QUIET_PRO_CATEGORY_PALETTE_37.filter((color) => !usedColors.has(color));
    const palette = availableColors.length > 0 ? availableColors : [...QUIET_PRO_CATEGORY_PALETTE_37];
    const nextColor = palette[Math.floor(Math.random() * palette.length)];

    this.categoryDefaultColorAssignments[category] = nextColor;
    if (this.persistCategoryDefaultColorAssignment) {
      void this.persistCategoryDefaultColorAssignment(category, nextColor).catch((error) => {
        console.warn("Failed to persist category default color assignment", { category, error });
      });
    }

    return nextColor;
  }

  getCategoryColorOverride(category: AppCategory): string | null {
    return this.categoryColorOverrides[category] ?? null;
  }

  setCategoryColorOverrides(overrides: Record<string, string>) {
    this.categoryColorOverrides = normalizeCategoryColorOverrides(overrides);
  }

  setCategoryColorOverride(category: AppCategory, colorValue?: string | null) {
    const color = normalizeHexColor(colorValue ?? undefined);
    if (!color) {
      delete this.categoryColorOverrides[category];
      return;
    }
    this.categoryColorOverrides[category] = color;
  }

  clearCategoryColorOverrides() {
    this.categoryColorOverrides = {};
  }

  setCategoryDefaultColorAssignments(assignments: Record<string, string>) {
    this.categoryDefaultColorAssignments = normalizeDefaultColorAssignments(assignments);
  }

  setCategoryDefaultColorAssignmentPersistence(
    handler: ((category: AppCategory, colorValue: string | null) => Promise<void>) | null,
  ) {
    this.persistCategoryDefaultColorAssignment = handler;
  }

  async removeCategoryDefaultColorAssignment(category: AppCategory) {
    if (category === "system" || category === "other") {
      return;
    }
    delete this.categoryDefaultColorAssignments[category];
    if (this.persistCategoryDefaultColorAssignment) {
      await this.persistCategoryDefaultColorAssignment(category, null);
    }
  }
}
