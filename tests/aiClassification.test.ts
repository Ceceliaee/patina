import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAiClassificationRequest, applyAiClassificationSuggestions } from "../src/features/classification/services/aiClassification.ts";
import type { ClassificationDraftState } from "../src/features/classification/services/classificationDraftState.ts";

const app = (exeName: string, appName: string) => ({
  exeName, appName, totalDuration: 412, lastSeenMs: 600,
});
const draft: ClassificationDraftState = {
  appLinks: { "helper.exe": "editor.exe" },
  overrides: { "excluded.exe": { track: false }, "known.exe": { category: "utility" } },
  webDomainOverrides: {}, categoryColorOverrides: {}, categoryLabelOverrides: {},
  persistedCategoryIds: [], deletedCategories: [],
};
const catalog = [
  app("editor.exe", "Editor"), app("helper.exe", "Editor Helper"),
  app("excluded.exe", "Excluded"), app("known.exe", "Known"),
  app("unknown.exe", "unknown.exe"), app("calc.exe", "Calculator"),
];
const categories = [{ value: "custom:editing", label: "Editing" }] as const;
const request = () => buildAiClassificationRequest(catalog, draft, categories);

test("the provider sees only eligible app display names and numbered categories", () => {
  assert.deepEqual(request().payload, {
    apps: [{ id: 1, name: "Editor" }, { id: 2, name: "Calculator" }],
    categories: [{ id: 1, name: "Editing" }],
  });
});

test("late suggestions preserve manual classification and reject unknown categories", () => {
  const current = { ...draft, overrides: { ...draft.overrides, "editor.exe": { category: "other" as const } } };
  assert.equal(applyAiClassificationSuggestions(current, request(), [
    { appId: 1, categoryId: 1 }, { appId: 2, categoryId: 99 },
  ], catalog), current);
});

test("an accepted suggestion changes only the draft category", () => {
  const current: ClassificationDraftState = { ...draft, overrides: { ...draft.overrides, "editor.exe": { color: "#123456" } } };
  const next = applyAiClassificationSuggestions(current, buildAiClassificationRequest(catalog, current, categories), [
    { appId: 1, categoryId: 1 },
  ], catalog);
  assert.equal(next.overrides["editor.exe"]?.category, "custom:editing");
  assert.equal(next.overrides["editor.exe"]?.color, "#123456");
  assert.equal(current.overrides["editor.exe"]?.category, undefined);
});

test("display punctuation is allowed but executable paths are not sent", () => {
  const names = [app("studio.exe", "Music/Audio Studio"), app("private.exe", "C:/Apps/private.exe")];
  assert.deepEqual(buildAiClassificationRequest(names, draft, categories).payload.apps, [
    { id: 1, name: "Music/Audio Studio" },
  ]);
});

test("a late suggestion cannot restore a deleted custom category after save", () => {
  const before: ClassificationDraftState = { ...draft, persistedCategoryIds: ["custom:editing"] };
  assert.equal(applyAiClassificationSuggestions(draft, buildAiClassificationRequest(catalog, before, categories), [
    { appId: 1, categoryId: 1 },
  ], catalog), draft);
});
