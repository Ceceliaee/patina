import { groupLinkedAppCatalog } from "./linkedAppCatalog.ts";
import { isRecordedCandidateTrackingEnabled } from "./classificationAppCatalog.ts";
import type { ClassificationDraftState } from "./classificationDraftState.ts";
import type { ObservedAppCandidate } from "../types.ts";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { AiCategorySuggestion, AiClassificationPayload } from "../../../platform/runtime/aiClassificationGateway.ts";
export { loadAiClassificationConfig, suggestAiCategories } from "../../../platform/runtime/aiClassificationGateway.ts";

type CategoryOption = { value: UserAssignableAppCategory; label: string };

function isEligible(candidate: ObservedAppCandidate, draft: ClassificationDraftState) {
  const override = draft.overrides[candidate.exeName];
  return (!override?.category || override.category === "other")
    && override?.track !== false
    && (candidate.memberCandidates ?? [candidate]).some((item) => isRecordedCandidateTrackingEnabled(item, draft.overrides[item.exeName]));
}

export function buildAiClassificationRequest(
  catalog: readonly ObservedAppCandidate[],
  draft: ClassificationDraftState,
  options: readonly CategoryOption[],
) {
  const apps = groupLinkedAppCatalog(catalog, draft.appLinks ?? {}, draft.overrides)
    .filter((item) => isEligible(item, draft))
    .flatMap((item) => {
      const name = (draft.overrides[item.exeName]?.displayName ?? item.appName).trim();
      if (!name || /\\|^(?:[a-z]:|\/)|\.exe(?:$|[/\\])/i.test(name)
        || name.toLowerCase() === item.exeName.toLowerCase()) return [];
      return [{ candidate: item, name, category: draft.overrides[item.exeName]?.category }];
    });
  const categories = options.filter((option) => option.value !== "other")
    .map((option) => ({
      ...option,
      wasPersisted: draft.persistedCategoryIds.some((id) => id === option.value),
      overrideLabel: draft.categoryLabelOverrides[option.value] ?? null,
    }));
  const payload: AiClassificationPayload = {
    apps: apps.map(({ name }, index) => ({ id: index + 1, name })),
    categories: categories.map(({ label }, index) => ({ id: index + 1, name: label })),
  };
  return { apps, categories, payload };
}

export function applyAiClassificationSuggestions(
  draft: ClassificationDraftState,
  request: ReturnType<typeof buildAiClassificationRequest>,
  suggestions: readonly AiCategorySuggestion[],
  catalog: readonly ObservedAppCandidate[],
): ClassificationDraftState {
  const currentApps = new Map(groupLinkedAppCatalog(catalog, draft.appLinks ?? {}, draft.overrides)
    .map((candidate) => [candidate.exeName, candidate]));
  let overrides: ClassificationDraftState["overrides"] | undefined;
  for (const { appId, categoryId } of suggestions) {
    const app = request.apps[appId - 1];
    const category = request.categories[categoryId - 1];
    if (!app || !category) continue;
    const key = app.candidate.exeName;
    const candidate = currentApps.get(key);
    if (!candidate) continue;
    const current = (overrides ?? draft.overrides)[key];
    if (current?.category !== app.category || draft.appLinks?.[key] || !isEligible(candidate, draft)) continue;
    if ((current?.displayName ?? candidate.appName).trim() !== app.name) continue;
    if (draft.deletedCategories.includes(category.value)
      || (category.wasPersisted && !draft.persistedCategoryIds.some((id) => id === category.value))
      || (draft.categoryLabelOverrides[category.value] ?? null) !== category.overrideLabel) continue;
    overrides ??= { ...draft.overrides };
    overrides[key] = { ...current, category: category.value, enabled: true };
  }
  return overrides ? { ...draft, overrides } : draft;
}
