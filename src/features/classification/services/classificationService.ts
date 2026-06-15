import { ProcessMapper } from "../../../shared/classification/processMapper.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import {
  type AppCategory,
  type CustomAppCategory,
} from "../../../shared/classification/categoryTokens.ts";
import * as classificationStore from "./classificationStore.ts";
import type { ObservedAppCandidate } from "./classificationStore.ts";
import type {
  ObservedWebDomainCandidate,
  WebDomainOverride,
} from "../../../shared/types/webActivity.ts";
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

export type { AppOverride } from "../../../shared/classification/processMapper.ts";
export type { ClassificationDraftState } from "./classificationDraftState.ts";

export interface ClassificationBootstrapData {
  observed: ObservedAppCandidate[];
  observedWebDomains: ObservedWebDomainCandidate[];
  loadedOverrides: Record<string, AppOverride>;
  loadedWebDomainOverrides: Record<string, WebDomainOverride>;
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

export interface ClassificationBootstrapDeps {
  loadObservedAppCandidates: () => Promise<ObservedAppCandidate[]>;
  loadObservedWebDomainCandidates: () => Promise<ObservedWebDomainCandidate[]>;
  loadAppOverrides: () => Promise<Record<string, AppOverride>>;
  loadWebDomainOverrides: () => Promise<Record<string, WebDomainOverride>>;
  loadCategoryColorOverrides: () => Promise<Record<string, string>>;
  loadCustomCategories: () => Promise<CustomAppCategory[]>;
  loadDeletedCategories: () => Promise<AppCategory[]>;
}

export function createClassificationCommitDeps(
  commitChangePlan: ClassificationCommitDeps["commitChangePlan"] = classificationStore.commitDraftChangePlan,
): ClassificationCommitDeps {
  return {
    commitChangePlan,
    setUserOverrides: (overrides) => ProcessMapper.setUserOverrides(overrides),
    setCategoryColorOverrides: (overrides) => ProcessMapper.setCategoryColorOverrides(overrides),
    setDeletedCategories: (categories) => ProcessMapper.setDeletedCategories(categories),
  };
}

const defaultClassificationCommitDeps: ClassificationCommitDeps = createClassificationCommitDeps();
const defaultClassificationBootstrapDeps: ClassificationBootstrapDeps = {
  loadObservedAppCandidates: () => ClassificationService.loadObservedAppCandidates(),
  loadObservedWebDomainCandidates: () => ClassificationService.loadObservedWebDomainCandidates(),
  loadAppOverrides: () => classificationStore.loadAppOverrides(),
  loadWebDomainOverrides: () => classificationStore.loadWebDomainOverrides(),
  loadCategoryColorOverrides: () => classificationStore.loadCategoryColorOverrides(),
  loadCustomCategories: () => classificationStore.loadCustomCategories(),
  loadDeletedCategories: () => classificationStore.loadDeletedCategories(),
};

let warnedWebClassificationFallback = false;

async function loadOptionalWebClassificationData(
  deps: ClassificationBootstrapDeps,
): Promise<Pick<ClassificationBootstrapData, "observedWebDomains" | "loadedWebDomainOverrides">> {
  try {
    const [observedWebDomains, loadedWebDomainOverrides] = await Promise.all([
      deps.loadObservedWebDomainCandidates(),
      deps.loadWebDomainOverrides(),
    ]);
    return {
      observedWebDomains,
      loadedWebDomainOverrides,
    };
  } catch (error) {
    if (!warnedWebClassificationFallback) {
      warnedWebClassificationFallback = true;
      console.warn("Web domain classification data is unavailable; continuing with app classification only.", error);
    }
    return {
      observedWebDomains: [],
      loadedWebDomainOverrides: {},
    };
  }
}

export class ClassificationService {
  static async loadObservedAppCandidates(days: number = 30, limit: number = 120): Promise<ObservedAppCandidate[]> {
    return classificationStore.loadObservedAppCandidates(days, limit);
  }

  static async loadObservedWebDomainCandidates(days: number = 30, limit: number = 120): Promise<ObservedWebDomainCandidate[]> {
    return classificationStore.loadObservedWebDomainCandidates(days, limit);
  }

  static async loadClassificationBootstrap(
    deps: ClassificationBootstrapDeps = defaultClassificationBootstrapDeps,
  ): Promise<ClassificationBootstrapData> {
    const [
      observed,
      loadedOverrides,
      loadedCategoryColorOverrides,
      loadedCustomCategories,
      loadedDeletedCategories,
      webClassificationData,
    ] = await Promise.all([
      deps.loadObservedAppCandidates(),
      deps.loadAppOverrides(),
      deps.loadCategoryColorOverrides(),
      deps.loadCustomCategories(),
      deps.loadDeletedCategories(),
      loadOptionalWebClassificationData(deps),
    ]);

    const sanitizedDeletedCategories = sanitizeDeletedCategories(loadedDeletedCategories ?? []);

    const bootstrap = {
      observed,
      observedWebDomains: webClassificationData.observedWebDomains,
      loadedOverrides,
      loadedWebDomainOverrides: webClassificationData.loadedWebDomainOverrides,
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

  static applyBootstrapToProcessMapper(bootstrap: ClassificationBootstrapData): void {
    ProcessMapper.setUserOverrides(bootstrap.loadedOverrides);
    ProcessMapper.setCategoryColorOverrides(bootstrap.loadedCategoryColorOverrides);
    ProcessMapper.setDeletedCategories(bootstrap.loadedDeletedCategories);
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

  static async deleteObservedWebDomainHistory(normalizedDomain: string) {
    await classificationStore.deleteObservedWebDomainHistory(normalizedDomain);
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
