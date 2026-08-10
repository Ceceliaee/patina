import type { ToolSoftwareReminderAppCandidate } from "../../../shared/types/tools.ts";

function softwareReminderCandidateLabel(candidate: ToolSoftwareReminderAppCandidate) {
  return `${candidate.appName} (${candidate.exeName})`;
}

export function softwareReminderCandidateInputValue(candidate: ToolSoftwareReminderAppCandidate) {
  return candidate.appName;
}

function findSoftwareReminderAppCandidate(
  value: string,
  candidates: readonly ToolSoftwareReminderAppCandidate[],
) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return null;

  return candidates.find((candidate) => (
    softwareReminderCandidateLabel(candidate).toLocaleLowerCase() === normalized
    || candidate.appName.toLocaleLowerCase() === normalized
    || candidate.exeName.toLocaleLowerCase() === normalized
  )) ?? null;
}

export function filterSoftwareReminderAppCandidates(
  value: string,
  candidates: readonly ToolSoftwareReminderAppCandidate[],
) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) {
    return [...candidates];
  }

  return candidates.filter((candidate) => {
    const label = softwareReminderCandidateLabel(candidate).toLocaleLowerCase();
    return label.includes(normalized)
      || candidate.appName.toLocaleLowerCase().includes(normalized)
      || candidate.exeName.toLocaleLowerCase().includes(normalized);
  });
}

export function resolveSoftwareReminderSelectedCandidate(
  value: string,
  candidates: readonly ToolSoftwareReminderAppCandidate[],
  selectedCandidate: ToolSoftwareReminderAppCandidate | null,
) {
  if (
    selectedCandidate
    && value.trim() === softwareReminderCandidateInputValue(selectedCandidate).trim()
  ) {
    return selectedCandidate;
  }

  return findSoftwareReminderAppCandidate(value, candidates);
}
