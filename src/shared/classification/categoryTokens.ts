import type { UiText } from "../i18n/index.ts";

// The persisted prefix is historical; keep the literal value for existing user data.
export const EXTENDED_CATEGORY_PREFIX = "custom:" as const;

type SeededAppCategory =
  | "ai"
  | "development"
  | "office"
  | "browser"
  | "communication"
  | "video"
  | "music"
  | "game"
  | "design"
  | "utility"
  | "other"
  | "system";

export type ExtendedAppCategory = `${typeof EXTENDED_CATEGORY_PREFIX}${string}`;
export type AppCategory = SeededAppCategory | ExtendedAppCategory;
export type UserAssignableAppCategory = Exclude<AppCategory, "system">;

export const USER_ASSIGNABLE_CATEGORIES: UserAssignableAppCategory[] = [
  "ai",
  "development",
  "office",
  "browser",
  "communication",
  "video",
  "music",
  "game",
  "design",
  "utility",
  "other",
];

interface CategoryToken {
  label: string;
  color: string;
}

export const QUIET_PRO_CATEGORY_PALETTE_37 = [
  "#4F5FD7",
  "#5968DE",
  "#6471E3",
  "#6F7AE6",
  "#4B78C8",
  "#5380CD",
  "#5D88D1",
  "#3F86C9",
  "#4790CF",
  "#3293C8",
  "#399CCB",
  "#2E9FAE",
  "#35A69E",
  "#2FA58B",
  "#36AC7E",
  "#3D9C6B",
  "#46956F",
  "#4F987F",
  "#5A9861",
  "#66955C",
  "#7C945C",
  "#8A9058",
  "#9A8C52",
  "#AA8752",
  "#B07E55",
  "#B97A58",
  "#C07158",
  "#C56A73",
  "#BE657D",
  "#B6688B",
  "#A06A7D",
  "#976C90",
  "#8C6FA1",
  "#8572A5",
  "#7E74A8",
  "#6F7F92",
  "#637D9F",
] as const;

export const OTHER_CATEGORY_FIXED_COLOR = "#8F98A8";

const SEEDED_CATEGORY_IDS: SeededAppCategory[] = [
  "ai",
  "development",
  "office",
  "browser",
  "communication",
  "video",
  "music",
  "game",
  "design",
  "utility",
  "other",
  "system",
];

const SEEDED_CATEGORY_SET = new Set<string>(SEEDED_CATEGORY_IDS);
const CATEGORY_NAME_LIMITS = {
  cjkCharacters: 6,
  latinWords: 2,
  latinCharacters: 12,
} as const;
const CJK_CHARACTER_PATTERN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function normalizeCategoryLabelInput(input: string): string {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (CJK_CHARACTER_PATTERN.test(normalized)) {
    return Array.from(normalized).slice(0, CATEGORY_NAME_LIMITS.cjkCharacters).join("");
  }
  const latinValue = normalized.split(" ").slice(0, CATEGORY_NAME_LIMITS.latinWords).join(" ");
  return Array.from(latinValue).slice(0, CATEGORY_NAME_LIMITS.latinCharacters).join("").trimEnd();
}

function getSeededCategoryLabel(category: SeededAppCategory, uiText: UiText): string {
  if (category === "ai") return uiText.categories.ai;
  return uiText.categories.short[category];
}

function normalizeLegacyExtendedCategoryLabel(label: string): string {
  const trimmed = label.trim().replace(/\s+/g, " ");
  if (!trimmed) {
    return "custom";
  }
  return trimmed.slice(0, 20);
}

function decodeLegacyExtendedCategoryRawLabel(raw: string): string {
  let decoded = raw;
  for (let index = 0; index < 4; index += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

export function resolveExtendedCategoryLabel(category: ExtendedAppCategory, uiText: UiText): string {
  const raw = category.slice(EXTENDED_CATEGORY_PREFIX.length);
  if (!raw) {
    return uiText.categories.custom;
  }
  return normalizeLegacyExtendedCategoryLabel(decodeLegacyExtendedCategoryRawLabel(raw));
}

export function buildLegacyExtendedCategoryId(label: string): ExtendedAppCategory {
  const normalizedLabel = normalizeLegacyExtendedCategoryLabel(label);
  const encodedLabel = encodeURIComponent(normalizedLabel);
  return `${EXTENDED_CATEGORY_PREFIX}${encodedLabel}` as ExtendedAppCategory;
}

export function createCategoryId(): ExtendedAppCategory {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  const idSegment = randomUuid
    ? randomUuid.replace(/-/g, "")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `${EXTENDED_CATEGORY_PREFIX}category_${idSegment}` as ExtendedAppCategory;
}

export function isExtendedCategory(category: string): category is ExtendedAppCategory {
  return category.startsWith(EXTENDED_CATEGORY_PREFIX) && category.length > EXTENDED_CATEGORY_PREFIX.length;
}

export function isModernExtendedCategoryId(category: string): boolean {
  return isExtendedCategory(category) && category.slice(EXTENDED_CATEGORY_PREFIX.length).startsWith("category_");
}

export function normalizeExtendedCategory(category: ExtendedAppCategory): ExtendedAppCategory {
  if (isModernExtendedCategoryId(category)) {
    return category;
  }
  return buildLegacyExtendedCategoryId(
    decodeLegacyExtendedCategoryRawLabel(category.slice(EXTENDED_CATEGORY_PREFIX.length)),
  );
}

function isSeededCategory(category: string): category is SeededAppCategory {
  return SEEDED_CATEGORY_SET.has(category);
}

export function isAppCategory(category: string): category is AppCategory {
  return isSeededCategory(category) || isExtendedCategory(category);
}

export function getCategoryToken(category: AppCategory, uiText: UiText): CategoryToken {
  if (category === "system") {
    return { label: uiText.categories.system, color: "#475569" };
  }

  if (category === "other") {
    return {
      label: getSeededCategoryLabel("other", uiText),
      color: OTHER_CATEGORY_FIXED_COLOR,
    };
  }

  if (isExtendedCategory(category)) {
    return {
      label: resolveExtendedCategoryLabel(category, uiText),
      color: QUIET_PRO_CATEGORY_PALETTE_37[0],
    };
  }

  return {
    label: getSeededCategoryLabel(category, uiText),
    color: QUIET_PRO_CATEGORY_PALETTE_37[0],
  };
}
