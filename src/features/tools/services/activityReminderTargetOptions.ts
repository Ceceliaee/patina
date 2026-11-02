import type {
  ActivityReminderAppCandidate,
  ActivityReminderCategoryCandidate,
  ActivityReminderTarget,
  ActivityReminderWebCandidate,
} from "../../../shared/types/tools.ts";
import type { ActivityReminderRuleRowViewModel } from "../types.ts";

export function findActivityReminderRuleForTarget<T extends Pick<ActivityReminderRuleRowViewModel, "kind" | "targetKey" | "exeName">>(
  target: ActivityReminderTarget,
  rules: readonly T[],
): T | undefined {
  const canonicalText = (value: string) => value.trim().replace(/[A-Z]/g, char => char.toLowerCase());
  const canonicalExe = (value: string) => canonicalText(value).replace(/^"+|"+$/g, "");
  const canonicalDomain = (value: string) => canonicalText(value).replace(/\.+$/g, "");
  return rules.find(rule => {
    if (rule.kind !== target.kind) return false;
    if (target.kind === "app") {
      const exe = canonicalExe(target.exeName ?? "");
      const ruleExe = canonicalExe(rule.exeName ?? "");
      return exe || ruleExe ? Boolean(exe && exe === ruleExe)
        : canonicalText(target.appName) === canonicalText(rule.targetKey);
    }
    return target.kind === "category"
      ? target.categoryId.trim() === rule.targetKey.trim()
      : canonicalDomain(target.normalizedDomain) === canonicalDomain(rule.targetKey);
  });
}

export interface ActivityReminderTargetOption {
  key: string;
  value: string;
  label: string;
  meta: string | null;
  iconUrl: string | null;
  accentColor: string | null;
  target: ActivityReminderTarget;
}

function resolveAppIcon(icons: Record<string, string>, exeName: string) {
  return icons[exeName] ?? icons[exeName.toLocaleLowerCase()] ?? null;
}

export function buildActivityReminderTargetOptions(
  appCandidates: readonly ActivityReminderAppCandidate[],
  categoryCandidates: readonly ActivityReminderCategoryCandidate[],
  webCandidates: readonly ActivityReminderWebCandidate[],
  icons: Record<string, string>,
): ActivityReminderTargetOption[] {
  return [
    ...appCandidates.map((candidate): ActivityReminderTargetOption => ({
      key: `app:${candidate.exeName}`,
      value: `app:${candidate.exeName}`,
      label: candidate.appName,
      meta: candidate.exeName,
      iconUrl: resolveAppIcon(icons, candidate.exeName),
      accentColor: null,
      target: { kind: "app", appName: candidate.appName, exeName: candidate.exeName },
    })),
    ...categoryCandidates.map((candidate): ActivityReminderTargetOption => ({
      key: `category:${candidate.categoryId}`,
      value: `category:${candidate.categoryId}`,
      label: candidate.label,
      meta: null,
      iconUrl: null,
      accentColor: candidate.color,
      target: { kind: "category", categoryId: candidate.categoryId },
    })),
    ...webCandidates.map((candidate): ActivityReminderTargetOption => ({
      key: `web:${candidate.normalizedDomain}`,
      value: `web:${candidate.normalizedDomain}`,
      label: candidate.label,
      meta: candidate.label.toLocaleLowerCase() === candidate.normalizedDomain
        ? null
        : candidate.normalizedDomain,
      iconUrl: candidate.faviconUrl,
      accentColor: null,
      target: { kind: "web", normalizedDomain: candidate.normalizedDomain },
    })),
  ];
}

export function findActivityReminderTargetOption(
  value: string,
  options: readonly ActivityReminderTargetOption[],
) {
  const normalized = value.trim().toLocaleLowerCase();
  if (!normalized) return null;
  const selected = options.find((option) => option.value.toLocaleLowerCase() === normalized);
  if (selected) return selected;
  const matches = options.filter((option) => {
    const target = option.target;
    if (target.kind === "app") {
      return target.exeName?.toLocaleLowerCase() === normalized
        || target.appName.toLocaleLowerCase() === normalized
        || `${target.appName} (${target.exeName})`.toLocaleLowerCase() === normalized;
    }
    if (target.kind === "category") return target.categoryId.toLocaleLowerCase() === normalized;
    return target.normalizedDomain === normalized.replace(/\.$/, "")
      || option.label.toLocaleLowerCase() === normalized;
  });
  return matches.length === 1 ? matches[0] : null;
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
