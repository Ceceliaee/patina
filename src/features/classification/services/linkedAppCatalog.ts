import { resolveLinkedApp, type AppLinks } from "../../../shared/classification/appLinks.ts";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import type { ObservedAppCandidate } from "../types.ts";
import type { ClassificationDraftState } from "./classificationDraftState.ts";

/** Capture the root's observed name without leaving a change after an unsaved add/remove. */
export function seedLinkedAppName(next: ClassificationDraftState, current: ClassificationDraftState,
  saved: ClassificationDraftState | null, parent: ObservedAppCandidate | null,
  candidates: readonly ObservedAppCandidate[]): void {
  if (parent && !next.overrides[parent.exeName]?.displayName) {
    next.overrides[parent.exeName] = { ...next.overrides[parent.exeName], displayName: parent.appName, enabled: true };
  }
  for (const root of new Set(Object.values(current.appLinks ?? {}))) {
    if (Object.values(next.appLinks ?? {}).includes(root) || Object.values(saved?.appLinks ?? {}).includes(root)
      || saved?.overrides[root]?.displayName) continue;
    const override = next.overrides[root];
    if (!override || override.displayName !== candidates.find((item) => item.exeName === root)?.appName) continue;
    const restored = { ...override };
    delete restored.displayName;
    if (Object.keys(restored).every((key) => key === "enabled" || key === "updatedAt")) {
      if (saved?.overrides[root]) next.overrides[root] = { ...saved.overrides[root] };
      else delete next.overrides[root];
    } else next.overrides[root] = restored;
  }
}

export function groupLinkedAppCatalog(candidates: readonly ObservedAppCandidate[], links: AppLinks,
  overrides: Readonly<Record<string, AppOverride>>): ObservedAppCandidate[] {
  const byKey = new Map(candidates.map((item) => [item.exeName, item]));
  const groups = new Map<string, ObservedAppCandidate>();
  for (const candidate of candidates) {
    const parent = resolveLinkedApp(candidate.exeName, links);
    const source = byKey.get(parent);
    const group = groups.get(parent) ?? {
      exeName: parent, appName: source?.appName ?? overrides[parent]?.displayName ?? parent,
      totalDuration: 0, lastSeenMs: 0, hasNativeRecords: source?.hasNativeRecords ?? false,
      searchText: "",
      memberCandidates: [],
    };
    group.totalDuration += candidate.totalDuration;
    group.memberCandidates!.push(candidate);
    group.lastSeenMs = Math.max(group.lastSeenMs, candidate.lastSeenMs);
    group.searchText += ` ${candidate.exeName} ${candidate.appName} ${overrides[candidate.exeName]?.displayName ?? ""}`;
    groups.set(parent, group);
  }
  return [...groups.values()];
}
