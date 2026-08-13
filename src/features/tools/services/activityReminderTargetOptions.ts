import type {
  ActivityReminderAppCandidate,
  ActivityReminderCategoryCandidate,
  ActivityReminderTarget,
  ActivityReminderWebCandidate,
} from "../../../shared/types/tools.ts";

export type ActivityReminderTargetMode = ActivityReminderTarget["kind"];

export interface ActivityReminderTargetOption {
  key: string;
  value: string;
  label: string;
  meta: string | null;
  iconUrl: string | null;
  accentColor: string | null;
}

function resolveAppIcon(icons: Record<string, string>, exeName: string) {
  return icons[exeName] ?? icons[exeName.toLocaleLowerCase()] ?? null;
}

export function buildActivityReminderTargetOptions(
  mode: ActivityReminderTargetMode,
  appCandidates: readonly ActivityReminderAppCandidate[],
  categoryCandidates: readonly ActivityReminderCategoryCandidate[],
  webCandidates: readonly ActivityReminderWebCandidate[],
  icons: Record<string, string>,
): ActivityReminderTargetOption[] {
  if (mode === "app") {
    return appCandidates.map((candidate) => ({
      key: `app:${candidate.exeName}`,
      value: candidate.exeName,
      label: candidate.appName,
      meta: candidate.exeName,
      iconUrl: resolveAppIcon(icons, candidate.exeName),
      accentColor: null,
    }));
  }
  if (mode === "category") {
    return categoryCandidates.map((candidate) => ({
      key: `category:${candidate.categoryId}`,
      value: candidate.categoryId,
      label: candidate.label,
      meta: null,
      iconUrl: null,
      accentColor: candidate.color,
    }));
  }
  return webCandidates.map((candidate) => ({
    key: `web:${candidate.normalizedDomain}`,
    value: candidate.normalizedDomain,
    label: candidate.label,
    meta: candidate.label.toLocaleLowerCase() === candidate.normalizedDomain
      ? null
      : candidate.normalizedDomain,
    iconUrl: candidate.faviconUrl,
    accentColor: null,
  }));
}

export function findActivityReminderTargetOption(
  value: string,
  options: readonly ActivityReminderTargetOption[],
) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return null;
  return options.find((option) => option.value.toLocaleLowerCase() === normalized) ?? null;
}

export function filterActivityReminderTargetOptions(
  query: string,
  options: readonly ActivityReminderTargetOption[],
) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return options;
  return options.filter((option) => (
    option.label.toLocaleLowerCase().includes(normalized)
    || option.value.toLocaleLowerCase().includes(normalized)
    || option.meta?.toLocaleLowerCase().includes(normalized)
  ));
}
