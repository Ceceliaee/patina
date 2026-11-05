import type { UiText } from "../../../shared/i18n/index.ts";
import type { useQuietDialogs } from "../../../shared/hooks/useQuietDialogs.tsx";
import { ClassificationService, type DeletionTarget } from "../services/classificationService.ts";
import { webDisplayDomain } from "../../../shared/classification/webLinks.ts";

export async function confirmObjectDeletion(target: DeletionTarget, name: string, text: UiText, confirm: ReturnType<typeof useQuietDialogs>["confirm"]) {
  const impact = await ClassificationService.deleteObject(target);
  const title = target.kind === "app" ? text.mapping.deleteAppRecords : text.mapping.deleteWebRecords;
  const sections: ReadonlyArray<readonly [string, string[]]> = [
    [text.mapping.deletionMembers, impact.members],
    [text.mapping.deletionLinks, impact.links.map(([member, parent]) => `${member} → ${parent}`)],
    ...[false, true].map(shared => [
      shared ? text.mapping.deletionSharedReminders : text.mapping.deletionReminders,
      impact.reminders.filter(rule => rule.shared === shared).map(rule => `${rule.label} · ${webDisplayDomain(rule.target)} (#${rule.id})`),
    ] as const),
  ] as const;
  const approved = await confirm({
    title,
    description: text.mapping.deleteObjectDetail(name),
    details: sections.map(([heading, items]) => items.length > 0 && (
      <section key={heading} className="qp-object-delete-section"><strong>{heading}</strong><ul>
        {items.map(item => <li key={item}>{item}</li>)}</ul></section>
    )),
    confirmLabel: title,
    danger: true,
  });
  if (!approved) return false;
  await ClassificationService.deleteObject(target, impact);
  return true;
}
