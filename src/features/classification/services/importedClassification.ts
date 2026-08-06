import type { ImportCategoryCandidate } from "../../../platform/persistence/importRuntimeGateway.ts";
import {
  createCategoryId,
  EXTENDED_CATEGORY_PREFIX,
  normalizeCategoryLabelInput,
  USER_ASSIGNABLE_CATEGORIES,
  type ExtendedAppCategory,
  type UserAssignableAppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import { resolveCanonicalExecutable } from "../../../shared/classification/processNormalization.ts";
import { cloneClassificationDraftState, type ClassificationDraftState } from "./classificationDraftState.ts";

interface ImportedClassificationDeps {
  createCategoryId?: () => ExtendedAppCategory;
  now?: () => number;
}

export interface ImportedClassificationResult {
  draft: ClassificationDraftState;
  categoriesCreated: number;
  classifiedApps: number;
  conflictedApps: number;
  preservedManualApps: number;
}

const SEEDED_CATEGORY_ALIASES: Partial<Record<UserAssignableAppCategory, readonly string[]>> = {
  ai: ["AI"],
  development: ["开发", "开发编码", "Dev", "Development"],
  office: ["办公", "办公协作", "Office"],
  browser: ["浏览", "浏览器", "Browser"],
  communication: ["通讯", "沟通", "即时通讯", "Chat", "Communication"],
  video: ["视频", "视频内容", "Video"],
  music: ["音乐", "音乐音频", "Music"],
  game: ["游戏", "Game", "Games"],
  design: ["设计", "设计创作", "Design"],
  utility: ["工具", "工具效率", "Tool", "Tools", "Utility", "Utilities"],
  other: ["未分类", "其他", "Other", "Unknown", "未知"],
};

function categoryLabelKey(label: string): string {
  return normalizeCategoryLabelInput(label).toLocaleLowerCase();
}

function buildExistingCategoryIndex(
  state: ClassificationDraftState,
): Map<string, UserAssignableAppCategory> {
  const index = new Map<string, UserAssignableAppCategory>();
  for (const category of USER_ASSIGNABLE_CATEGORIES) {
    const labels = new Set<string>([
      state.categoryLabelOverrides[category] ?? "",
      ...(SEEDED_CATEGORY_ALIASES[category] ?? []),
    ]);
    for (const label of labels) {
      const key = categoryLabelKey(label);
      if (key) index.set(key, category);
    }
  }
  for (const category of state.persistedCategoryIds) {
    const label = state.categoryLabelOverrides[category]
      ?? decodeURIComponent(category.slice(EXTENDED_CATEGORY_PREFIX.length));
    const key = categoryLabelKey(label);
    if (key && !index.has(key)) index.set(key, category);
  }
  return index;
}

export function buildImportedClassificationDraft(
  saved: ClassificationDraftState,
  candidates: readonly ImportCategoryCandidate[],
  deps: ImportedClassificationDeps = {},
): ImportedClassificationResult {
  const draft = cloneClassificationDraftState(saved);
  const categoryIndex = buildExistingCategoryIndex(draft);
  const createId = deps.createCategoryId ?? createCategoryId;
  const now = deps.now ?? Date.now;
  let categoriesCreated = 0;

  const normalizedByExe = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const canonicalExe = resolveCanonicalExecutable(candidate.exeName);
    if (!canonicalExe) continue;
    const labels = normalizedByExe.get(canonicalExe) ?? new Set<string>();
    for (const rawLabel of candidate.categories) {
      const label = normalizeCategoryLabelInput(rawLabel);
      if (!label) continue;
      const key = categoryLabelKey(label);
      labels.add(key);
      if (categoryIndex.has(key)) continue;
      let category = createId();
      while (draft.persistedCategoryIds.includes(category)) category = createId();
      draft.persistedCategoryIds.push(category);
      draft.categoryLabelOverrides[category] = label;
      categoryIndex.set(key, category);
      categoriesCreated += 1;
    }
    normalizedByExe.set(canonicalExe, labels);
  }

  let classifiedApps = 0;
  let conflictedApps = 0;
  let preservedManualApps = 0;
  for (const [canonicalExe, labels] of normalizedByExe) {
    const current = draft.overrides[canonicalExe];
    if (current?.category) {
      preservedManualApps += 1;
      continue;
    }
    if (labels.size > 1) {
      conflictedApps += 1;
      continue;
    }
    const labelKey = labels.values().next().value as string | undefined;
    const category = labelKey ? categoryIndex.get(labelKey) : "other";
    if (!category || category === "other") continue;
    draft.overrides[canonicalExe] = {
      ...current,
      category,
      enabled: true,
      updatedAt: now(),
    };
    classifiedApps += 1;
  }

  return {
    draft,
    categoriesCreated,
    classifiedApps,
    conflictedApps,
    preservedManualApps,
  };
}
