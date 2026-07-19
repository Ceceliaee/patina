import { getUiLocale } from "../../../shared/copy/index.ts";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { CandidateFilter, ObservedAppCandidate } from "../types.ts";

interface FilterAndSortCandidatesParams {
  candidates: ObservedAppCandidate[];
  filter: CandidateFilter;
  searchQuery?: string;
  resolveMappedCategory: (candidate: ObservedAppCandidate) => UserAssignableAppCategory;
  resolveTrackingEnabled?: (candidate: ObservedAppCandidate) => boolean;
  resolveEffectiveDisplayName: (candidate: ObservedAppCandidate) => string;
  resolveCategoryLabel?: (category: UserAssignableAppCategory) => string;
}

export function filterAndSortCandidates({
  candidates,
  filter,
  searchQuery,
  resolveMappedCategory,
  resolveTrackingEnabled,
  resolveEffectiveDisplayName,
  resolveCategoryLabel,
}: FilterAndSortCandidatesParams): ObservedAppCandidate[] {
  const locale = getUiLocale();
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const normalizedQuery = searchQuery?.trim().toLocaleLowerCase(locale) ?? "";
  return candidates
    .filter((candidate) => {
      const category = resolveMappedCategory(candidate);
      const trackingEnabled = resolveTrackingEnabled?.(candidate) ?? true;
      if (filter === "excluded") return !trackingEnabled;
      if (!trackingEnabled) return false;
      if (filter === "all") return true;
      return filter === "other" ? category === "other" : category !== "other";
    })
    .filter((candidate) => {
      if (!normalizedQuery) return true;
      const category = resolveMappedCategory(candidate);
      return [
        resolveEffectiveDisplayName(candidate),
        candidate.appName,
        candidate.exeName,
        resolveCategoryLabel?.(category) ?? category,
        category,
      ].join(" ").toLocaleLowerCase(locale).includes(normalizedQuery);
    })
    .sort((left, right) => (
      collator.compare(resolveEffectiveDisplayName(left), resolveEffectiveDisplayName(right))
      || collator.compare(left.exeName, right.exeName)
    ));
}
