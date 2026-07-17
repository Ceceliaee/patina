import { ProcessMapper } from "../../../shared/classification/processMapper.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import {
  type AppCategory,
  type ExtendedAppCategory,
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
import { loadClassificationIconsForExecutables } from "./classificationIconService.ts";

export type { AppOverride } from "../../../shared/classification/processMapper.ts";
export type { ClassificationDraftState } from "./classificationDraftState.ts";

export interface ClassificationBootstrapData {
  icons?: Record<string, string>;
  observed: ObservedAppCandidate[];
  observedWebDomains: ObservedWebDomainCandidate[];
  loadedOverrides: Record<string, AppOverride>;
  loadedWebDomainOverrides: Record<string, WebDomainOverride>;
  loadedCategoryColorOverrides: Record<string, string>;
  loadedCategoryLabelOverrides: Record<string, string>;
  loadedPersistedCategoryIds: ExtendedAppCategory[];
  loadedDeletedCategories: AppCategory[];
}

export interface ClassificationCommitDeps {
  commitChangePlan: (changePlan: ReturnType<typeof buildClassificationDraftChangePlan>) => Promise<void>;
  setUserOverrides: (overrides: ClassificationDraftState["overrides"]) => void;
  setCategoryColorOverrides: (overrides: ClassificationDraftState["categoryColorOverrides"]) => void;
  setCategoryLabelOverrides: (overrides: ClassificationDraftState["categoryLabelOverrides"]) => void;
  setDeletedCategories: (categories: AppCategory[]) => void;
}

export interface ClassificationBootstrapDeps {
  loadObservedAppCandidates: () => Promise<ObservedAppCandidate[]>;
  loadObservedWebDomainCandidates: () => Promise<ObservedWebDomainCandidate[]>;
  loadAppOverrides: () => Promise<Record<string, AppOverride>>;
  loadWebDomainOverrides: () => Promise<Record<string, WebDomainOverride>>;
  loadCategoryColorOverrides: () => Promise<Record<string, string>>;
  loadCategoryLabelOverrides: () => Promise<Record<string, string>>;
  loadPersistedCategoryIds: () => Promise<ExtendedAppCategory[]>;
  loadDeletedCategories: () => Promise<AppCategory[]>;
  loadAppIconsForExecutables?: typeof loadClassificationIconsForExecutables;
}

export function createClassificationCommitDeps(
  commitChangePlan: ClassificationCommitDeps["commitChangePlan"] = classificationStore.commitDraftChangePlan,
): ClassificationCommitDeps {
  return {
    commitChangePlan,
    setUserOverrides: (overrides) => ProcessMapper.setUserOverrides(overrides),
    setCategoryColorOverrides: (overrides) => ProcessMapper.setCategoryColorOverrides(overrides),
    setCategoryLabelOverrides: (overrides) => ProcessMapper.setCategoryLabelOverrides(overrides),
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
  loadCategoryLabelOverrides: () => classificationStore.loadCategoryLabelOverrides(),
  loadPersistedCategoryIds: () => classificationStore.loadPersistedCategoryIds(),
  loadDeletedCategories: () => classificationStore.loadDeletedCategories(),
  loadAppIconsForExecutables: loadClassificationIconsForExecutables,
};

let warnedWebClassificationFallback = false;
let warnedClassificationIconFallback = false;
let classificationBootstrapInFlight: Promise<ClassificationBootstrapData> | null = null;

async function loadOptionalClassificationIconMap(
  deps: ClassificationBootstrapDeps,
  observed: ObservedAppCandidate[],
): Promise<Record<string, string>> {
  if (!deps.loadAppIconsForExecutables) {
    return {};
  }

  try {
    return await deps.loadAppIconsForExecutables(
      observed.map((candidate) => candidate.exeName),
    );
  } catch (error) {
    if (!warnedClassificationIconFallback) {
      warnedClassificationIconFallback = true;
      console.warn("Classification app icon cache is unavailable; continuing with app initials.", error);
    }
    return {};
  }
}

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

  static loadClassificationBootstrap(
    deps: ClassificationBootstrapDeps = defaultClassificationBootstrapDeps,
  ): Promise<ClassificationBootstrapData> {
    if (classificationBootstrapInFlight) {
      return classificationBootstrapInFlight;
    }

    const cacheAtRequestStart = getClassificationBootstrapCache();
    const request = (async () => {
      const [
        observed,
        loadedOverrides,
        loadedCategoryColorOverrides,
        loadedCategoryLabelOverrides,
        loadedPersistedCategoryIds,
        loadedDeletedCategories,
        webClassificationData,
      ] = await Promise.all([
        deps.loadObservedAppCandidates(),
        deps.loadAppOverrides(),
        deps.loadCategoryColorOverrides(),
        deps.loadCategoryLabelOverrides(),
        deps.loadPersistedCategoryIds(),
        deps.loadDeletedCategories(),
        loadOptionalWebClassificationData(deps),
      ]);

      const icons = await loadOptionalClassificationIconMap(deps, observed);
      const sanitizedDeletedCategories = sanitizeDeletedCategories(loadedDeletedCategories ?? []);

      const bootstrap = {
        icons,
        observed,
        observedWebDomains: webClassificationData.observedWebDomains,
        loadedOverrides,
        loadedWebDomainOverrides: webClassificationData.loadedWebDomainOverrides,
        loadedCategoryColorOverrides: loadedCategoryColorOverrides ?? {},
        loadedCategoryLabelOverrides: loadedCategoryLabelOverrides ?? {},
        loadedPersistedCategoryIds,
        loadedDeletedCategories: sanitizedDeletedCategories,
      };

      const latestCache = getClassificationBootstrapCache();
      if (latestCache !== cacheAtRequestStart && latestCache) {
        return latestCache;
      }

      setClassificationBootstrapCache(bootstrap);
      return bootstrap;
    })();

    classificationBootstrapInFlight = request;
    void request.then(
      () => {
        if (classificationBootstrapInFlight === request) {
          classificationBootstrapInFlight = null;
        }
      },
      () => {
        if (classificationBootstrapInFlight === request) {
          classificationBootstrapInFlight = null;
        }
      },
    );
    return request;
  }

  static getBootstrapCache(): ClassificationBootstrapData | null {
    return getClassificationBootstrapCache();
  }

  static applyBootstrapToProcessMapper(bootstrap: ClassificationBootstrapData): void {
    ProcessMapper.setUserOverrides(bootstrap.loadedOverrides);
    ProcessMapper.setCategoryColorOverrides(bootstrap.loadedCategoryColorOverrides);
    ProcessMapper.setCategoryLabelOverrides(bootstrap.loadedCategoryLabelOverrides);
    ProcessMapper.setDeletedCategories(bootstrap.loadedDeletedCategories);
  }

  static async prewarmBootstrapCache(): Promise<ClassificationBootstrapData> {
    return this.loadClassificationBootstrap();
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

  static async saveCategoryDefinition(category: ExtendedAppCategory) {
    await classificationStore.saveCategoryDefinition(category);
  }

  static async deleteCategoryDefinition(category: ExtendedAppCategory) {
    await classificationStore.deleteCategoryDefinition(category);
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
  deps.setCategoryLabelOverrides(draft.categoryLabelOverrides);
  deps.setDeletedCategories(changePlan.sanitizedDeletedCategories);
}
