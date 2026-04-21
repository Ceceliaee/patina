import { ProcessMapper } from "./ProcessMapper.ts";
import type { AppOverride } from "./ProcessMapper.ts";
import {
  type AppCategory,
  type CustomAppCategory,
} from "../config/categoryTokens.ts";
import * as classificationStore from "./classificationStore.ts";
import type { ObservedAppCandidate } from "./classificationStore.ts";
import {
  getClassificationBootstrapCache,
  setClassificationBootstrapCache,
} from "./classificationBootstrapCache.ts";
import {
  buildClassificationDraftChangePlan,
  hasClassificationDraftChanges,
  sanitizeDeletedCategories,
  type ClassificationDraftState,
} from "./classificationDraftState.ts";

export type { AppOverride } from "./ProcessMapper.ts";
export type { ClassificationDraftState } from "./classificationDraftState.ts";

export interface ClassificationBootstrapData {
  observed: ObservedAppCandidate[];
  loadedOverrides: Record<string, AppOverride>;
  loadedCategoryColorOverrides: Record<string, string>;
  loadedCustomCategories: CustomAppCategory[];
  loadedDeletedCategories: AppCategory[];
}

export interface ClassificationCommitDeps {
  commitChangePlan: (changePlan: ReturnType<typeof buildClassificationDraftChangePlan>) => Promise<void>;
  setUserOverrides: (overrides: ClassificationDraftState["overrides"]) => void;
  setCategoryColorOverrides: (overrides: ClassificationDraftState["categoryColorOverrides"]) => void;
  setDeletedCategories: (categories: AppCategory[]) => void;
}

const defaultClassificationCommitDeps: ClassificationCommitDeps = {
  commitChangePlan: classificationStore.commitDraftChangePlan,
  setUserOverrides: ProcessMapper.setUserOverrides,
  setCategoryColorOverrides: ProcessMapper.setCategoryColorOverrides,
  setDeletedCategories: ProcessMapper.setDeletedCategories,
};

export class ClassificationService {
  static async loadObservedAppCandidates(days: number = 30, limit: number = 120): Promise<ObservedAppCandidate[]> {
    return classificationStore.loadObservedAppCandidates(days, limit);
  }

  static async loadClassificationBootstrap(): Promise<ClassificationBootstrapData> {
    const [
      observed,
      loadedOverrides,
      loadedCategoryColorOverrides,
      loadedCustomCategories,
      loadedDeletedCategories,
    ] = await Promise.all([
      this.loadObservedAppCandidates(),
      classificationStore.loadAppOverrides(),
      classificationStore.loadCategoryColorOverrides(),
      classificationStore.loadCustomCategories(),
      classificationStore.loadDeletedCategories(),
    ]);

    const sanitizedDeletedCategories = sanitizeDeletedCategories(loadedDeletedCategories ?? []);

    const bootstrap = {
      observed,
      loadedOverrides,
      loadedCategoryColorOverrides: loadedCategoryColorOverrides ?? {},
      loadedCustomCategories,
      loadedDeletedCategories: sanitizedDeletedCategories,
    };
    setClassificationBootstrapCache(bootstrap);
    return bootstrap;
  }

  static getBootstrapCache(): ClassificationBootstrapData | null {
    return getClassificationBootstrapCache();
  }

  static async prewarmBootstrapCache(): Promise<ClassificationBootstrapData> {
    const bootstrap = await this.loadClassificationBootstrap();
    setClassificationBootstrapCache(bootstrap);
    return bootstrap;
  }

  static async saveAppOverride(exeName: string, override: AppOverride | null) {
    await classificationStore.saveAppOverride(exeName, override);
    ProcessMapper.setUserOverride(exeName, override);
  }

  static async saveCategoryColorOverride(category: AppCategory, colorValue: string | null) {
    await classificationStore.saveCategoryColorOverride(category, colorValue);
    ProcessMapper.setCategoryColorOverride(category, colorValue);
  }

  static async removeCategoryDefaultColorAssignment(category: AppCategory) {
    await ProcessMapper.removeCategoryDefaultColorAssignment(category);
  }

  static setDeletedCategories(categories: AppCategory[]) {
    ProcessMapper.setDeletedCategories(sanitizeDeletedCategories(categories));
  }

  static async saveCustomCategory(category: CustomAppCategory) {
    await classificationStore.saveCustomCategory(category);
  }

  static async deleteCustomCategory(category: CustomAppCategory) {
    await classificationStore.deleteCustomCategory(category);
  }

  static async saveDeletedCategory(category: AppCategory, deleted: boolean) {
    await classificationStore.saveDeletedCategory(category, deleted);
  }

  static async deleteObservedAppSessions(exeName: string, scope: "today" | "all" = "all") {
    await classificationStore.deleteObservedAppSessions(exeName, scope);
  }

  static hasDraftChanges(saved: ClassificationDraftState, draft: ClassificationDraftState): boolean {
    return hasClassificationDraftChanges(saved, draft);
  }

  static async commitDraftChanges(saved: ClassificationDraftState, draft: ClassificationDraftState): Promise<void> {
    await commitDraftChangesWithDeps(saved, draft, defaultClassificationCommitDeps);
  }
}

export async function prewarmClassificationBootstrapCache(): Promise<ClassificationBootstrapData> {
  return ClassificationService.prewarmBootstrapCache();
}

export async function commitDraftChangesWithDeps(
  saved: ClassificationDraftState,
  draft: ClassificationDraftState,
  deps: ClassificationCommitDeps,
): Promise<void> {
  const changePlan = buildClassificationDraftChangePlan(saved, draft);
  await deps.commitChangePlan(changePlan);
  deps.setUserOverrides(draft.overrides);
  deps.setCategoryColorOverrides(draft.categoryColorOverrides);
  deps.setDeletedCategories(changePlan.sanitizedDeletedCategories);
}
