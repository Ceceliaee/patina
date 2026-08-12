import {
  loadActivityReminderAppCatalog,
  loadActivityReminderCategoryCatalog,
  loadActivityReminderWebCatalog,
} from "../../../platform/persistence/activityReminderCatalogGateway.ts";
import { getCategoryToken } from "../../../shared/classification/categoryTokens.ts";
import type { UiText } from "../../../shared/i18n/index.ts";
import type {
  ActivityReminderAppCandidate,
  ActivityReminderCategoryCandidate,
  ActivityReminderWebCandidate,
} from "../../../shared/types/tools.ts";

export interface ActivityReminderTargetCandidates {
  apps: ActivityReminderAppCandidate[];
  categories: ActivityReminderCategoryCandidate[];
  webDomains: ActivityReminderWebCandidate[];
}

let appCatalogPromise: ReturnType<typeof loadActivityReminderAppCatalog> | null = null;
let categoryCatalogPromise: ReturnType<typeof loadActivityReminderCategoryCatalog> | null = null;
let webCatalogPromise: ReturnType<typeof loadActivityReminderWebCatalog> | null = null;
const invalidationListeners = new Set<() => void>();

export async function loadActivityReminderAppCandidates(): Promise<ActivityReminderAppCandidate[]> {
  appCatalogPromise ??= loadActivityReminderAppCatalog().catch((error) => {
    appCatalogPromise = null;
    throw error;
  });
  return (await appCatalogPromise).map((candidate) => ({ ...candidate }));
}

export async function loadActivityReminderCategoryCandidates(
  uiText: UiText,
): Promise<ActivityReminderCategoryCandidate[]> {
  categoryCatalogPromise ??= loadActivityReminderCategoryCatalog().catch((error) => {
    categoryCatalogPromise = null;
    throw error;
  });
  return (await categoryCatalogPromise).map((candidate) => {
    const token = getCategoryToken(candidate.categoryId, uiText);
    return {
      categoryId: candidate.categoryId,
      label: candidate.labelOverride ?? token.label,
      color: candidate.colorOverride ?? token.color,
    };
  });
}

export async function loadActivityReminderWebCandidates(): Promise<ActivityReminderWebCandidate[]> {
  webCatalogPromise ??= loadActivityReminderWebCatalog().catch((error) => {
    webCatalogPromise = null;
    throw error;
  });
  return (await webCatalogPromise).map((candidate) => ({ ...candidate }));
}

export async function loadActivityReminderTargetCandidates(
  uiText: UiText,
): Promise<ActivityReminderTargetCandidates> {
  const [apps, categories, webDomains] = await Promise.all([
    loadActivityReminderAppCandidates(),
    loadActivityReminderCategoryCandidates(uiText),
    loadActivityReminderWebCandidates(),
  ]);
  return {
    apps,
    categories,
    webDomains,
  };
}

export function clearActivityReminderTargetCandidateCache(): void {
  appCatalogPromise = null;
  categoryCatalogPromise = null;
  webCatalogPromise = null;
  for (const listener of invalidationListeners) listener();
}

export function subscribeActivityReminderTargetCandidateInvalidation(
  listener: () => void,
): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}
