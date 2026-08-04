import type { AppCategory } from "../../shared/classification/categoryTokens.ts";

export type CandidateFilter = "all" | "other" | "classified" | "excluded";
export type { ObservedAppCandidate } from "./services/classificationStore";

export interface QuickAppClassificationTarget {
  exeName: string;
  displayName: string;
  category: AppCategory;
}

export interface QuickAppClassificationAnchor {
  clientX: number;
  clientY: number;
}

export interface QuickAppClassificationOpenRequest {
  target: QuickAppClassificationTarget;
  anchor: QuickAppClassificationAnchor;
  returnFocusTo: HTMLElement | null;
}

export function createQuickAppClassificationTarget({
  exeName,
  displayName,
  category,
}: QuickAppClassificationTarget): QuickAppClassificationTarget {
  const normalizedExeName = exeName.trim();
  if (!normalizedExeName) {
    throw new Error("Quick app classification requires a non-empty executable name");
  }
  return {
    exeName: normalizedExeName,
    displayName: displayName.trim() || normalizedExeName,
    category,
  };
}

export function resolveQuickAppClassificationElementAnchor(
  element: HTMLElement,
): QuickAppClassificationAnchor {
  const bounds = element.getBoundingClientRect();
  return {
    clientX: bounds.left + bounds.width / 2,
    clientY: bounds.top + bounds.height / 2,
  };
}
