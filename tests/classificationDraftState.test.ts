import assert from "node:assert/strict";
import {
  buildCustomCategory,
  type UserAssignableAppCategory,
} from "../src/features/classification/config/categoryTokens.ts";
import {
  buildAppMappingOverride,
  createAppMappingDraftState,
  filterAndSortCandidates,
} from "../src/features/classification/hooks/appMappingStateHelpers.ts";
import type { ObservedAppCandidate } from "../src/features/classification/services/classificationStore.ts";
import {
  type ClassificationCommitDeps,
  commitDraftChangesWithDeps,
} from "../src/features/classification/services/classificationService.ts";
import {
  buildClassificationDraftChangePlan,
  cloneClassificationDraftState,
  hasClassificationDraftChanges,
  normalizeClassificationOverride,
  sanitizeDeletedCategories,
  type ClassificationDraftState,
} from "../src/features/classification/services/classificationDraftState.ts";

function buildDraftState(overrides: Partial<ClassificationDraftState> = {}): ClassificationDraftState {
  return {
    overrides: {},
    categoryColorOverrides: {},
    customCategories: [],
    deletedCategories: [],
    ...overrides,
  };
}

function buildCandidate(
  exeName: string,
  appName: string,
  totalDuration: number = 600,
  lastSeenMs: number = 1_714_000_000_000,
): ObservedAppCandidate {
  return {
    exeName,
    appName,
    totalDuration,
    lastSeenMs,
  };
}

let passed = 0;

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

await runTest("normalizeClassificationOverride trims values and drops empty overrides", () => {
  assert.equal(normalizeClassificationOverride(null), null);
  assert.equal(normalizeClassificationOverride({ enabled: true, updatedAt: 1 }), null);

  assert.deepEqual(
    normalizeClassificationOverride({
      enabled: true,
      displayName: "  Focus Browser  ",
      captureTitle: false,
      updatedAt: 99,
    }),
    {
      enabled: true,
      displayName: "Focus Browser",
      captureTitle: false,
      updatedAt: 99,
    },
  );
});

await runTest("sanitizeDeletedCategories keeps only builtin user-assignable categories", () => {
  const customCategory = buildCustomCategory("Deep Work");

  assert.deepEqual(
    sanitizeDeletedCategories(["music", "other", "system", customCategory]),
    ["music"],
  );
});

await runTest("hasClassificationDraftChanges ignores unsupported deleted categories", () => {
  const customCategory = buildCustomCategory("Deep Work");
  const saved = buildDraftState({
    deletedCategories: ["other", "system", customCategory],
  });
  const draft = buildDraftState();

  assert.equal(hasClassificationDraftChanges(saved, draft), false);
  assert.equal(
    hasClassificationDraftChanges(
      saved,
      buildDraftState({
        overrides: {
          "chrome.exe": { enabled: true, track: false },
        },
      }),
    ),
    true,
  );
});

await runTest("buildClassificationDraftChangePlan captures state diffs", () => {
  const customFocus = buildCustomCategory("Focus");
  const customDeepWork = buildCustomCategory("Deep Work");
  const saved = buildDraftState({
    overrides: {
      "chrome.exe": {
        enabled: true,
        displayName: "Chrome",
      },
    },
    categoryColorOverrides: {
      development: "#111111",
    },
    customCategories: [customFocus],
    deletedCategories: ["music"],
  });
  const draft = buildDraftState({
    overrides: {
      "chrome.exe": {
        enabled: true,
        displayName: "Work Browser",
      },
      "slack.exe": {
        enabled: true,
        category: "communication",
      },
    },
    categoryColorOverrides: {
      development: "#222222",
    },
    customCategories: [customDeepWork],
    deletedCategories: ["music", "video", "other"],
  });

  assert.deepEqual(buildClassificationDraftChangePlan(saved, draft), {
    overrideUpserts: [
      {
        exeName: "chrome.exe",
        override: {
          enabled: true,
          displayName: "Work Browser",
        },
      },
      {
        exeName: "slack.exe",
        override: {
          enabled: true,
          category: "communication",
        },
      },
    ],
    categoryColorUpdates: [
      {
        category: "development",
        colorValue: "#222222",
      },
    ],
    customCategoriesToAdd: [customDeepWork],
    customCategoriesToRemove: [customFocus],
    deletedCategoryUpdates: [
      {
        category: "video",
        deleted: true,
      },
    ],
    sanitizedDeletedCategories: ["music", "video"],
  });
});

await runTest("createAppMappingDraftState clones bootstrap snapshots", () => {
  const customCategory = buildCustomCategory("Deep Work");
  const snapshot = {
    loadedOverrides: {
      "chrome.exe": {
        enabled: true,
        displayName: "Chrome",
      },
    },
    loadedCategoryColorOverrides: {
      development: "#111111",
    },
    loadedCustomCategories: [customCategory],
    loadedDeletedCategories: ["music" as const],
  };

  const state = createAppMappingDraftState(snapshot);
  const cloned = cloneClassificationDraftState(state);
  state.overrides["chrome.exe"]!.displayName = "Changed";
  state.categoryColorOverrides.development = "#222222";
  state.customCategories.push(buildCustomCategory("Focus"));
  state.deletedCategories.push("video");

  assert.equal(snapshot.loadedOverrides["chrome.exe"]?.displayName, "Chrome");
  assert.equal(snapshot.loadedCategoryColorOverrides.development, "#111111");
  assert.deepEqual(snapshot.loadedCustomCategories, [customCategory]);
  assert.deepEqual(snapshot.loadedDeletedCategories, ["music"]);
  assert.deepEqual(cloned, {
    overrides: {
      "chrome.exe": {
        enabled: true,
        displayName: "Chrome",
      },
    },
    categoryColorOverrides: {
      development: "#111111",
    },
    customCategories: [customCategory],
    deletedCategories: ["music"],
  });
});

await runTest("buildAppMappingOverride normalizes colors and omits no-op values", () => {
  assert.equal(buildAppMappingOverride({ track: true, captureTitle: true }), null);

  assert.deepEqual(
    buildAppMappingOverride({
      category: "communication",
      color: "abc123",
      displayName: "  Slack  ",
      track: false,
      captureTitle: false,
      updatedAt: 12,
    }),
    {
      enabled: true,
      category: "communication",
      color: "#ABC123",
      displayName: "Slack",
      track: false,
      captureTitle: false,
      updatedAt: 12,
    },
  );
});

await runTest("filterAndSortCandidates filters by category and sorts by resolved label", () => {
  const candidates = [
    buildCandidate("zeta.exe", "Same Name"),
    buildCandidate("alpha.exe", "Same Name"),
    buildCandidate("notes.exe", "Notes"),
    buildCandidate("other.exe", "Other"),
  ];
  const categories: Record<string, UserAssignableAppCategory> = {
    "zeta.exe": "development",
    "alpha.exe": "development",
    "notes.exe": "communication",
    "other.exe": "other",
  };

  const filtered = filterAndSortCandidates({
    candidates,
    filter: "classified",
    resolveMappedCategory: (candidate) => categories[candidate.exeName] ?? "other",
    resolveEffectiveDisplayName: (candidate) => candidate.appName,
  });

  assert.deepEqual(
    filtered.map((candidate) => candidate.exeName),
    ["notes.exe", "alpha.exe", "zeta.exe"],
  );
});

await runTest("commitDraftChangesWithDeps persists before syncing process mapper state", async () => {
  const events: string[] = [];
  const saved = buildDraftState();
  const draft = buildDraftState({
    overrides: {
      "chrome.exe": {
        enabled: true,
        displayName: "Work Browser",
      },
    },
    categoryColorOverrides: {
      development: "#112233",
    },
    deletedCategories: ["music"],
  });
  const deps: ClassificationCommitDeps = {
    commitChangePlan: async (changePlan) => {
      events.push(`commit:${changePlan.overrideUpserts.length}:${changePlan.categoryColorUpdates.length}`);
    },
    setUserOverrides: () => {
      events.push("sync:user");
    },
    setCategoryColorOverrides: () => {
      events.push("sync:color");
    },
    setDeletedCategories: () => {
      events.push("sync:deleted");
    },
  };

  await commitDraftChangesWithDeps(saved, draft, deps);

  assert.deepEqual(events, [
    "commit:1:1",
    "sync:user",
    "sync:color",
    "sync:deleted",
  ]);
});

await runTest("commitDraftChangesWithDeps does not sync process mapper state when persistence fails", async () => {
  const events: string[] = [];
  const saved = buildDraftState();
  const draft = buildDraftState({
    overrides: {
      "chrome.exe": {
        enabled: true,
        displayName: "Work Browser",
      },
    },
  });
  const deps: ClassificationCommitDeps = {
    commitChangePlan: async () => {
      events.push("commit");
      throw new Error("sqlite busy");
    },
    setUserOverrides: () => {
      events.push("sync:user");
    },
    setCategoryColorOverrides: () => {
      events.push("sync:color");
    },
    setDeletedCategories: () => {
      events.push("sync:deleted");
    },
  };

  await assert.rejects(
    commitDraftChangesWithDeps(saved, draft, deps),
    /sqlite busy/,
  );

  assert.deepEqual(events, ["commit"]);
});

console.log(`Passed ${passed} classification draft state tests`);
