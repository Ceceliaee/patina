import type { AppCategory } from "../../shared/classification/categoryTokens.ts";

export type CandidateFilter = "all" | "other" | "classified" | "excluded";
export type { ObservedAppCandidate } from "./services/classificationStore";

interface QuickAppClassificationTarget {
  kind: "app";
  exeName: string;
  displayName: string;
  category: AppCategory;
}

interface QuickWebClassificationTarget {
  kind: "web";
  normalizedDomain: string;
  displayName: string;
  category: AppCategory;
}

export type QuickClassificationTarget =
  | QuickAppClassificationTarget
  | QuickWebClassificationTarget;

export interface QuickClassificationAnchor {
  clientX: number;
  clientY: number;
}

export interface QuickClassificationOpenRequest {
  target: QuickClassificationTarget;
  anchor: QuickClassificationAnchor;
  returnFocusTo: HTMLElement | null;
}

export function createQuickAppClassificationTarget({
  exeName,
  displayName,
  category,
}: Omit<QuickAppClassificationTarget, "kind">): QuickAppClassificationTarget {
  const normalizedExeName = exeName.trim();
  if (!normalizedExeName) {
    throw new Error("Quick app classification requires a non-empty executable name");
  }
  return {
    kind: "app",
    exeName: normalizedExeName,
    displayName: displayName.trim() || normalizedExeName,
    category,
  };
}

export function createQuickWebClassificationTarget({
  normalizedDomain,
  displayName,
  category,
}: Omit<QuickWebClassificationTarget, "kind">): QuickWebClassificationTarget {
  const normalizedKey = normalizedDomain.trim().replace(/\.$/, "").toLocaleLowerCase();
  if (!normalizedKey) {
    throw new Error("Quick web classification requires a non-empty normalized domain");
  }
  return {
    kind: "web",
    normalizedDomain: normalizedKey,
    displayName: displayName.trim() || normalizedKey,
    category,
  };
}

export function getQuickClassificationTargetKey(target: QuickClassificationTarget): string {
  return target.kind === "app"
    ? `app:${target.exeName}`
    : `web:${target.normalizedDomain}`;
}

export function resolveQuickClassificationElementAnchor(
  element: HTMLElement,
): QuickClassificationAnchor {
  const bounds = element.getBoundingClientRect();
  return {
    clientX: bounds.left + bounds.width / 2,
    clientY: bounds.top + bounds.height / 2,
  };
}
