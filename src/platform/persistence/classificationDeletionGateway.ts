import { invokeWithCommandError } from "./commandError.ts";

export interface DeletionTarget { kind: "app" | "web" | "group"; key: string }
export interface DeletionImpact {
  target: DeletionTarget;
  members: string[];
  links: [string, string][];
  reminders: { id: number; label: string; target: string; shared: boolean }[];
}

export function classificationDeletion(target: DeletionTarget, confirmed?: DeletionImpact) {
  return invokeWithCommandError<DeletionImpact>("cmd_classification_object_deletion", { target, confirmed });
}
