import assert from "node:assert/strict";
import {
  buildCustomCategory,
  resolveCustomCategoryLabel,
  USER_ASSIGNABLE_CATEGORIES,
  type UserAssignableAppCategory,
} from "../src/shared/classification/categoryTokens.ts";
import {
  buildAppMappingCategoryOverride,
  buildAppMappingOverride,
  createAppMappingDraftState,
  filterAndSortCandidates,
} from "../src/features/classification/hooks/appMappingStateHelpers.ts";
import {
  buildAppOverrideTransition,
  buildLegacyAutoClassificationMigrationMutations,
  type ObservedAppCandidate,
} from "../src/features/classification/services/classificationStore.ts";
import {
  buildLegacyAutoClassificationOverrides,
  resolveLegacyAutoClassification,
} from "../src/features/classification/services/legacyAutoClassificationMigration.ts";
import {
  ClassificationService,
  type ClassificationBootstrapDeps,
  type ClassificationCommitDeps,
  commitDraftChangesWithDeps,
  createClassificationCommitDeps,
} from "../src/features/classification/services/classificationService.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
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
    webDomainOverrides: {},
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

await runTest("first install assignable categories match the lean default set", () => {
  assert.deepEqual(USER_ASSIGNABLE_CATEGORIES, [
    "ai",
    "development",
    "office",
    "browser",
    "communication",
    "video",
    "music",
    "game",
    "design",
    "utility",
    "other",
  ]);
  assert.equal(ProcessMapper.map("zoom.exe").category, "other");
  assert.equal(ProcessMapper.map("teams.exe").category, "other");
  assert.equal(
    ProcessMapper.fromOverrideStorageValue(JSON.stringify({ category: "meeting", enabled: true }))?.category,
    undefined,
  );
  assert.equal(
    ProcessMapper.fromOverrideStorageValue(JSON.stringify({ category: "reading", enabled: true }))?.category,
    undefined,
  );
  assert.equal(
    ProcessMapper.fromOverrideStorageValue(JSON.stringify({ category: "finance", enabled: true }))?.category,
    undefined,
  );
});

await runTest("default app mapping ignores saved runtime overrides", () => {
  ProcessMapper.clearUserOverrides();
  ProcessMapper.setUserOverride("chrome.exe", {
    enabled: true,
    displayName: "Work Browser",
    category: "other",
  });

  const mapped = ProcessMapper.map("chrome.exe");
  const defaults = ProcessMapper.mapDefault("chrome.exe");

  assert.equal(mapped.name, "Work Browser");
  assert.equal(mapped.category, "other");
  assert.equal(defaults.name, "Google Chrome");
  assert.equal(defaults.category, "other");

  ProcessMapper.clearUserOverrides();
});

await runTest("historical other category overrides remain safely readable as unclassified", () => {
  const parsed = ProcessMapper.fromOverrideStorageValue(JSON.stringify({
    category: "other",
    enabled: true,
    updatedAt: 123,
  }));

  assert.equal(parsed?.category, "other");
  ProcessMapper.setUserOverride("chrome.exe", parsed);
  assert.equal(ProcessMapper.map("chrome.exe").category, "other");
  ProcessMapper.clearUserOverrides();
});

await runTest("choosing unclassified clears only the manual category", () => {
  assert.deepEqual(
    buildAppMappingCategoryOverride({
      category: "development",
      displayName: "Work Browser",
      color: "#112233",
      track: false,
      captureTitle: false,
      enabled: true,
      updatedAt: 123,
    }, "other"),
    {
      displayName: "Work Browser",
      color: "#112233",
      track: false,
      captureTitle: false,
      enabled: true,
      updatedAt: 123,
    },
  );
  assert.equal(buildAppMappingCategoryOverride({ category: "office" }, "other"), null);
  const assigned = buildAppMappingCategoryOverride(null, "development");
  assert.equal(assigned?.category, "development");
  assert.equal(assigned?.enabled, true);
  assert.equal(typeof assigned?.updatedAt, "number");
});

await runTest("legacy auto-classification migration preserves historical categories without restoring runtime inference", () => {
  const migratedAt = 456;
  const migrated = buildLegacyAutoClassificationOverrides([
    buildCandidate("douyin.exe", "抖音"),
    buildCandidate("workbook-helper.exe", "Workbook Helper"),
    buildCandidate("unknown.exe", "Unknown"),
    buildCandidate("chrome.exe", "Google Chrome"),
  ], {
    "chrome.exe": {
      category: "communication",
      enabled: true,
      updatedAt: 123,
    },
    "workbook-helper.exe": {
      displayName: "Books",
      enabled: true,
      updatedAt: 234,
    },
  }, migratedAt);

  assert.equal(resolveLegacyAutoClassification("douyin.exe"), "video");
  assert.equal(resolveLegacyAutoClassification("workbook-helper.exe"), "browser");
  assert.equal(resolveLegacyAutoClassification("unknown.exe"), null);
  assert.deepEqual(migrated["douyin.exe"], {
    category: "video",
    enabled: true,
    updatedAt: migratedAt,
  });
  assert.deepEqual(migrated["workbook-helper.exe"], {
    displayName: "Books",
    enabled: true,
    updatedAt: 234,
    category: "browser",
  });
  assert.equal(migrated["unknown.exe"], undefined);
  assert.equal(migrated["chrome.exe"], undefined);
  assert.equal(ProcessMapper.map("douyin.exe").category, "other");
});

await runTest("legacy auto-classification migration writes migrated overrides and a completion marker", () => {
  const mutations = buildLegacyAutoClassificationMigrationMutations([
    buildCandidate("douyin.exe", "抖音"),
    buildCandidate("unknown.exe", "Unknown"),
  ], {}, 789);

  assert.equal(mutations.length, 2);
  assert.equal(mutations[0].key, "__app_override::douyin.exe");
  assert.equal(JSON.parse(mutations[0].value ?? "{}").category, "video");
  assert.deepEqual(mutations[1], {
    key: "__classification_manual_confirmation_migration::v1",
    value: "789",
  });
});

await runTest("unsupported historical classification overrides are ignored", () => {
  const transition = buildAppOverrideTransition(
    "__app_override::Zoom.exe",
    JSON.stringify({ category: "meeting", enabled: true, updatedAt: 123 }),
  );

  assert.equal(transition.canonicalExe, "zoom.exe");
  assert.equal(transition.override, null);
  assert.deepEqual(transition.mutations, []);
});

await runTest("plain category override storage values are ignored", () => {
  const transition = buildAppOverrideTransition("__app_override::reader.exe", "reading");

  assert.equal(transition.canonicalExe, "reader.exe");
  assert.equal(transition.override, null);
  assert.deepEqual(transition.mutations, []);
});

await runTest("custom category ids are not repeatedly percent encoded", () => {
  const category = buildCustomCategory("中文");
  const doubleEncodedCategory = buildCustomCategory(category.slice("custom:".length));

  assert.equal(category, "custom:%E4%B8%AD%E6%96%87");
  assert.equal(doubleEncodedCategory, "custom:%25E4%25B8%25AD%25E6%2596%2587");
  assert.equal(resolveCustomCategoryLabel(doubleEncodedCategory), "中文");
  assert.equal(
    ProcessMapper.fromOverrideStorageValue(JSON.stringify({ category, enabled: true }))?.category,
    category,
  );
  assert.equal(
    ProcessMapper.fromOverrideStorageValue(JSON.stringify({ category: doubleEncodedCategory, enabled: true }))?.category,
    category,
  );
});

await runTest("encoded custom category app override transitions back to canonical storage", () => {
  const category = buildCustomCategory("中文");
  const doubleEncodedCategory = buildCustomCategory(category.slice("custom:".length));
  const transition = buildAppOverrideTransition(
    "__app_override::notepad.exe",
    JSON.stringify({ category: doubleEncodedCategory, enabled: true, updatedAt: 123 }),
  );

  assert.equal(transition.canonicalExe, "notepad.exe");
  assert.equal(transition.override?.category, category);
  assert.deepEqual(transition.mutations, [
    {
      key: "__app_override::notepad.exe",
      value: JSON.stringify({
        category,
        displayName: null,
        color: null,
        track: true,
        captureTitle: true,
        enabled: true,
        updatedAt: 123,
      }),
    },
  ]);
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
    webDomainOverrides: {},
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
    webDomainOverrideUpserts: [],
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
    loadedWebDomainOverrides: {},
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
    webDomainOverrides: {},
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

await runTest("filterAndSortCandidates searches display names and executable names", () => {
  const candidates = [
    buildCandidate("alpha.exe", "Alpha"),
    buildCandidate("chrome.exe", "Google Chrome"),
    buildCandidate("notes.exe", "Notes"),
  ];

  const byDisplayName = filterAndSortCandidates({
    candidates,
    filter: "all",
    searchQuery: "goo",
    resolveMappedCategory: () => "development",
    resolveEffectiveDisplayName: (candidate) => candidate.appName,
  });
  const byExecutable = filterAndSortCandidates({
    candidates,
    filter: "all",
    searchQuery: "note",
    resolveMappedCategory: () => "development",
    resolveEffectiveDisplayName: (candidate) => candidate.appName,
  });

  assert.deepEqual(byDisplayName.map((candidate) => candidate.exeName), ["chrome.exe"]);
  assert.deepEqual(byExecutable.map((candidate) => candidate.exeName), ["notes.exe"]);
});

await runTest("filterAndSortCandidates searches category labels", () => {
  const candidates = [
    buildCandidate("code.exe", "Code"),
    buildCandidate("vlc.exe", "VLC"),
    buildCandidate("notes.exe", "Notes"),
  ];
  const categories: Record<string, UserAssignableAppCategory> = {
    "code.exe": "development",
    "vlc.exe": "video",
    "notes.exe": "office",
  };

  const filtered = filterAndSortCandidates({
    candidates,
    filter: "all",
    searchQuery: "media",
    resolveMappedCategory: (candidate) => categories[candidate.exeName] ?? "other",
    resolveEffectiveDisplayName: (candidate) => candidate.appName,
    resolveCategoryLabel: (category) => (category === "video" ? "Media" : category),
  });

  assert.deepEqual(filtered.map((candidate) => candidate.exeName), ["vlc.exe"]);
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

await runTest("default classification commit deps keep ProcessMapper runtime sync bound", async () => {
  ProcessMapper.clearUserOverrides();
  ProcessMapper.clearCategoryColorOverrides();
  ProcessMapper.setDeletedCategories([]);

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
  const deps = createClassificationCommitDeps(async () => {});

  await commitDraftChangesWithDeps(saved, draft, deps);

  assert.equal(ProcessMapper.getUserOverride("chrome.exe")?.displayName, "Work Browser");
  assert.equal(ProcessMapper.getCategoryColorOverride("development"), "#112233");
  assert.equal(ProcessMapper.isCategoryDeleted("music"), true);

  ProcessMapper.clearUserOverrides();
  ProcessMapper.clearCategoryColorOverrides();
  ProcessMapper.setDeletedCategories([]);
});

await runTest("classification bootstrap sync applies saved process mapper state", () => {
  ProcessMapper.clearUserOverrides();
  ProcessMapper.clearCategoryColorOverrides();
  ProcessMapper.setDeletedCategories([]);

  ClassificationService.applyBootstrapToProcessMapper({
    observed: [],
    loadedOverrides: {
      "chrome.exe": {
        enabled: true,
        displayName: "Work Browser",
      },
    },
    loadedCategoryColorOverrides: {
      development: "#112233",
    },
    loadedCustomCategories: [],
    loadedDeletedCategories: ["music"],
  });

  assert.equal(ProcessMapper.getUserOverride("chrome.exe")?.displayName, "Work Browser");
  assert.equal(ProcessMapper.getCategoryColorOverride("development"), "#112233");
  assert.equal(ProcessMapper.isCategoryDeleted("music"), true);

  ProcessMapper.clearUserOverrides();
  ProcessMapper.clearCategoryColorOverrides();
  ProcessMapper.setDeletedCategories([]);
});

await runTest("classification bootstrap keeps app data when optional web reads fail", async () => {
  const observed = [buildCandidate("vscodium.exe", "VSCodium")];
  const deps: ClassificationBootstrapDeps = {
    loadObservedAppCandidates: async () => observed,
    loadObservedWebDomainCandidates: async () => {
      throw new Error("no such table: web_activity_segments");
    },
    loadAppOverrides: async () => ({
      "vscodium.exe": {
        enabled: true,
        category: "development",
      },
    }),
    loadWebDomainOverrides: async () => {
      throw new Error("web overrides unavailable");
    },
    loadCategoryColorOverrides: async () => ({
      development: "#112233",
    }),
    loadCustomCategories: async () => [],
    loadDeletedCategories: async () => ["music"],
  };
  const originalWarn = console.warn;
  let warning = "";
  console.warn = (message?: unknown) => {
    warning = String(message ?? "");
  };

  try {
    const bootstrap = await ClassificationService.loadClassificationBootstrap(deps);

    assert.deepEqual(bootstrap.observed, observed);
    assert.deepEqual(bootstrap.observedWebDomains, []);
    assert.deepEqual(bootstrap.loadedWebDomainOverrides, {});
    assert.equal(bootstrap.loadedOverrides["vscodium.exe"]?.category, "development");
    assert.equal(bootstrap.loadedCategoryColorOverrides.development, "#112233");
    assert.deepEqual(bootstrap.loadedDeletedCategories, ["music"]);
    assert.match(warning, /Web domain classification data is unavailable/);
  } finally {
    console.warn = originalWarn;
  }
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
