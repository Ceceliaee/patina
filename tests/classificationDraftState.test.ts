import assert from "node:assert/strict";
import {
  buildLegacyExtendedCategoryId,
  createCategoryId,
  resolveExtendedCategoryLabel,
  USER_ASSIGNABLE_CATEGORIES,
  type UserAssignableAppCategory,
} from "../src/shared/classification/categoryTokens.ts";
import {
  buildAppMappingCategoryOverride,
  buildAppMappingOverride,
  createCategoryInDraftState,
  createAppMappingDraftState,
  filterAndSortCandidates,
  mergeCategoryIntoDraftState,
  updateCategoryLabelInDraftState,
} from "../src/features/classification/hooks/appMappingStateHelpers.ts";
import {
  buildAppOverrideTransition,
  buildLegacyAutoClassificationMigrationMutations,
  parsePersistedDeletedCategories,
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
    categoryLabelOverrides: {},
    persistedCategoryIds: [],
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

await runTest("sanitizeDeletedCategories keeps only seeded user-assignable categories", () => {
  const extendedCategory = buildLegacyExtendedCategoryId("Deep Work");

  assert.deepEqual(
    sanitizeDeletedCategories(["music", "other", "system", extendedCategory]),
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

await runTest("default app mapping names supported browser family candidates", () => {
  assert.equal(ProcessMapper.mapDefault("360chromex.exe").name, "360 极速浏览器 X");
  assert.equal(ProcessMapper.mapDefault("thorium.exe").name, "Thorium");
  assert.equal(ProcessMapper.mapDefault("centbrowser.exe").name, "Cent Browser");
  assert.equal(ProcessMapper.mapDefault("catsxp.exe").name, "Catsxp");
  assert.equal(ProcessMapper.mapDefault("zen.exe").name, "Zen");
  assert.equal(ProcessMapper.mapDefault("floorp.exe").name, "Floorp");
  assert.equal(ProcessMapper.mapDefault("iceweasel.exe").name, "Iceweasel");
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

await runTest("legacy extended category ids are not repeatedly percent encoded", () => {
  const category = buildLegacyExtendedCategoryId("中文");
  const doubleEncodedCategory = buildLegacyExtendedCategoryId(category.slice("custom:".length));

  assert.equal(category, "custom:%E4%B8%AD%E6%96%87");
  assert.equal(doubleEncodedCategory, "custom:%25E4%25B8%25AD%25E6%2596%2587");
  assert.equal(resolveExtendedCategoryLabel(doubleEncodedCategory), "中文");
  assert.equal(
    ProcessMapper.fromOverrideStorageValue(JSON.stringify({ category, enabled: true }))?.category,
    category,
  );
  assert.equal(
    ProcessMapper.fromOverrideStorageValue(JSON.stringify({ category: doubleEncodedCategory, enabled: true }))?.category,
    category,
  );
});

await runTest("createCategoryId creates stable non-label category ids", () => {
  const category = createCategoryId();

  assert.match(category, /^custom:category_[a-z0-9]+$/i);
  assert.notEqual(category, buildLegacyExtendedCategoryId("Focus"));
});

await runTest("modern stable extended category ids round-trip through app override storage", () => {
  const category = "custom:category_76fe3862f1e4493badcafe1234567890" as const;
  const stored = ProcessMapper.toOverrideStorageValue({
    enabled: true,
    category,
  });

  assert.equal(ProcessMapper.fromOverrideStorageValue(stored)?.category, category);
});

await runTest("createCategoryInDraftState stores stable category label", () => {
  const category = "custom:category_focus" as const;
  const state = createCategoryInDraftState(buildDraftState(), category, "  Focus  ");

  assert.deepEqual(state.persistedCategoryIds, [category]);
  assert.equal(state.categoryLabelOverrides[category], "Focus");
});

await runTest("process mapper applies extended category display label overrides", () => {
  const category = "custom:category_focus" as const;

  ProcessMapper.setCategoryLabelOverrides({
    [category]: "Focus",
  });

  assert.equal(ProcessMapper.getCategoryLabel(category), "Focus");

  ProcessMapper.clearCategoryLabelOverrides();
});

await runTest("mergeCategoryIntoDraftState rewrites category references", () => {
  const focus = buildLegacyExtendedCategoryId("Focus");
  const deepWork = buildLegacyExtendedCategoryId("Deep Work");
  const merged = mergeCategoryIntoDraftState(buildDraftState({
    overrides: {
      "code.exe": {
        enabled: true,
        category: focus,
      },
    },
    webDomainOverrides: {
      "docs.example": {
        category: focus,
      },
    },
    categoryColorOverrides: {
      [focus]: "#112233",
    },
    persistedCategoryIds: [focus],
    deletedCategories: [focus],
  }), focus, deepWork, "#445566");

  assert.equal(merged.overrides["code.exe"]?.category, deepWork);
  assert.equal(merged.webDomainOverrides["docs.example"]?.category, deepWork);
  assert.deepEqual(merged.persistedCategoryIds, [deepWork]);
  assert.deepEqual(merged.deletedCategories, []);
  assert.equal(merged.categoryColorOverrides[focus], undefined);
  assert.equal(merged.categoryColorOverrides[deepWork], "#112233");
});

await runTest("updateCategoryLabelInDraftState stores and clears display label overrides", () => {
  const renamed = updateCategoryLabelInDraftState(buildDraftState(), "development", "  Dev Tools  ");
  assert.equal(renamed.categoryLabelOverrides.development, "Dev Tools");

  const cleared = updateCategoryLabelInDraftState(renamed, "development", "");
  assert.equal(cleared.categoryLabelOverrides.development, undefined);

  const extendedCategory = "custom:category_focus" as const;
  const extendedRenamed = updateCategoryLabelInDraftState(buildDraftState(), extendedCategory, "Deep Work");
  assert.equal(extendedRenamed.categoryLabelOverrides[extendedCategory], "Deep Work");
});

await runTest("encoded extended category app override transitions back to canonical storage", () => {
  const category = buildLegacyExtendedCategoryId("中文");
  const doubleEncodedCategory = buildLegacyExtendedCategoryId(category.slice("custom:".length));
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

await runTest("app override transition preserves full modern category ids", () => {
  const category = "custom:category_76fe3862f1e4493badcafe1234567890" as const;
  const stored = ProcessMapper.toOverrideStorageValue({
    category,
    enabled: true,
    updatedAt: 123,
  });
  const transition = buildAppOverrideTransition("__app_override::notepad.exe", stored);

  assert.equal(transition.canonicalExe, "notepad.exe");
  assert.equal(transition.override?.category, category);
  assert.deepEqual(transition.mutations, []);
});

await runTest("app override transition restores truncated modern category ids when the full category is known", () => {
  const category = "custom:category_76fe3862f1e4493badcafe1234567890" as const;
  const truncatedCategory = "custom:category_76fe3862f1e" as const;
  const transition = buildAppOverrideTransition(
    "__app_override::notepad.exe",
    JSON.stringify({ category: truncatedCategory, enabled: true, updatedAt: 123 }),
    [category],
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

await runTest("restored modern category ids remain stable on the next cold start", () => {
  const category = "custom:category_76fe3862f1e4493badcafe1234567890" as const;
  const firstTransition = buildAppOverrideTransition(
    "__app_override::notepad.exe",
    JSON.stringify({
      category: "custom:category_76fe3862f1e",
      enabled: true,
      updatedAt: 123,
    }),
    [category],
  );
  const repairedValue = firstTransition.mutations[0]?.value;

  assert.ok(repairedValue);
  const secondTransition = buildAppOverrideTransition(
    "__app_override::notepad.exe",
    repairedValue,
    [category],
  );

  assert.equal(secondTransition.override?.category, category);
  assert.deepEqual(secondTransition.mutations, []);
});

await runTest("upgrade reads ignore unknown deleted-category keys without treating them as current categories", () => {
  const categories = parsePersistedDeletedCategories([
    { key: "__deleted_category::development" },
    { key: "__deleted_category::system" },
    { key: "__deleted_category::other" },
    { key: "__deleted_category::custom:category_future" },
    { key: "__deleted_category::future-category" },
  ]);

  assert.deepEqual(categories, ["development"]);
});

await runTest("app override transition leaves ambiguous truncated modern category ids unchanged", () => {
  const truncatedCategory = "custom:category_1234567890a" as const;
  const transition = buildAppOverrideTransition(
    "__app_override::notepad.exe",
    JSON.stringify({ category: truncatedCategory, enabled: true, updatedAt: 123 }),
    [
      "custom:category_1234567890abcdef1111111111111111",
      "custom:category_1234567890abcdef2222222222222222",
    ],
  );

  assert.equal(transition.canonicalExe, "notepad.exe");
  assert.equal(transition.override?.category, truncatedCategory);
  assert.equal(transition.mutations.length, 1);
  assert.equal(
    JSON.parse(transition.mutations[0].value ?? "{}").category,
    truncatedCategory,
  );
});

await runTest("app override transition leaves unknown truncated modern category ids unchanged", () => {
  const truncatedCategory = "custom:category_99999999999" as const;
  const transition = buildAppOverrideTransition(
    "__app_override::notepad.exe",
    JSON.stringify({ category: truncatedCategory, enabled: true, updatedAt: 123 }),
    ["custom:category_1234567890abcdef1111111111111111"],
  );

  assert.equal(transition.canonicalExe, "notepad.exe");
  assert.equal(transition.override?.category, truncatedCategory);
  assert.equal(transition.mutations.length, 1);
  assert.equal(
    JSON.parse(transition.mutations[0].value ?? "{}").category,
    truncatedCategory,
  );
});

await runTest("hasClassificationDraftChanges ignores unsupported deleted categories", () => {
  const extendedCategory = buildLegacyExtendedCategoryId("Deep Work");
  const saved = buildDraftState({
    deletedCategories: ["other", "system", extendedCategory],
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
  const focusCategoryId = buildLegacyExtendedCategoryId("Focus");
  const deepWorkCategoryId = buildLegacyExtendedCategoryId("Deep Work");
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
    categoryLabelOverrides: {
      development: "Dev",
    },
    persistedCategoryIds: [focusCategoryId],
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
    categoryLabelOverrides: {
      development: "Engineering",
    },
    persistedCategoryIds: [deepWorkCategoryId],
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
    categoryLabelUpdates: [
      {
        category: "development",
        label: "Engineering",
      },
    ],
    persistedCategoryIdsToAdd: [deepWorkCategoryId],
    persistedCategoryIdsToRemove: [focusCategoryId],
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
  const categoryId = buildLegacyExtendedCategoryId("Deep Work");
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
    loadedCategoryLabelOverrides: {
      development: "Dev Tools",
    },
    loadedPersistedCategoryIds: [categoryId],
    loadedDeletedCategories: ["music" as const],
  };

  const state = createAppMappingDraftState(snapshot);
  const cloned = cloneClassificationDraftState(state);
  state.overrides["chrome.exe"]!.displayName = "Changed";
  state.categoryColorOverrides.development = "#222222";
  state.categoryLabelOverrides.development = "Engineering";
  state.persistedCategoryIds.push(buildLegacyExtendedCategoryId("Focus"));
  state.deletedCategories.push("video");

  assert.equal(snapshot.loadedOverrides["chrome.exe"]?.displayName, "Chrome");
  assert.equal(snapshot.loadedCategoryColorOverrides.development, "#111111");
  assert.equal(snapshot.loadedCategoryLabelOverrides.development, "Dev Tools");
  assert.deepEqual(snapshot.loadedPersistedCategoryIds, [categoryId]);
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
    categoryLabelOverrides: {
      development: "Dev Tools",
    },
    persistedCategoryIds: [categoryId],
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

await runTest("filterAndSortCandidates filters excluded apps by tracking state", () => {
  const candidates = [
    buildCandidate("active.exe", "Active"),
    buildCandidate("blocked.exe", "Blocked"),
  ];

  const filtered = filterAndSortCandidates({
    candidates,
    filter: "excluded",
    resolveMappedCategory: () => "utility",
    resolveTrackingEnabled: (candidate) => candidate.exeName !== "blocked.exe",
    resolveEffectiveDisplayName: (candidate) => candidate.appName,
  });

  assert.deepEqual(filtered.map((candidate) => candidate.exeName), ["blocked.exe"]);
});

await runTest("filterAndSortCandidates omits excluded apps from normal filters", () => {
  const candidates = [
    buildCandidate("active.exe", "Active"),
    buildCandidate("blocked.exe", "Blocked"),
  ];

  const filtered = filterAndSortCandidates({
    candidates,
    filter: "all",
    resolveMappedCategory: () => "utility",
    resolveTrackingEnabled: (candidate) => candidate.exeName !== "blocked.exe",
    resolveEffectiveDisplayName: (candidate) => candidate.appName,
  });

  assert.deepEqual(filtered.map((candidate) => candidate.exeName), ["active.exe"]);
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
    categoryLabelOverrides: {
      development: "Dev Tools",
    },
    deletedCategories: ["music"],
  });
  const deps: ClassificationCommitDeps = {
    commitChangePlan: async (changePlan) => {
      events.push(`commit:${changePlan.overrideUpserts.length}:${changePlan.categoryColorUpdates.length}:${changePlan.categoryLabelUpdates.length}`);
    },
    setUserOverrides: () => {
      events.push("sync:user");
    },
    setCategoryColorOverrides: () => {
      events.push("sync:color");
    },
    setCategoryLabelOverrides: () => {
      events.push("sync:label");
    },
    setDeletedCategories: () => {
      events.push("sync:deleted");
    },
  };

  await commitDraftChangesWithDeps(saved, draft, deps);

  assert.deepEqual(events, [
    "commit:1:1:1",
    "sync:user",
    "sync:color",
    "sync:label",
    "sync:deleted",
  ]);
});

await runTest("default classification commit deps keep ProcessMapper runtime sync bound", async () => {
  ProcessMapper.clearUserOverrides();
  ProcessMapper.clearCategoryColorOverrides();
  ProcessMapper.clearCategoryLabelOverrides();
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
    categoryLabelOverrides: {
      development: "Dev Tools",
    },
    deletedCategories: ["music"],
  });
  const deps = createClassificationCommitDeps(async () => {});

  await commitDraftChangesWithDeps(saved, draft, deps);

  assert.equal(ProcessMapper.getUserOverride("chrome.exe")?.displayName, "Work Browser");
  assert.equal(ProcessMapper.getCategoryColorOverride("development"), "#112233");
  assert.equal(ProcessMapper.getCategoryLabel("development"), "Dev Tools");
  assert.equal(ProcessMapper.isCategoryDeleted("music"), true);

  ProcessMapper.clearUserOverrides();
  ProcessMapper.clearCategoryColorOverrides();
  ProcessMapper.clearCategoryLabelOverrides();
  ProcessMapper.setDeletedCategories([]);
});

await runTest("classification bootstrap sync applies saved process mapper state", () => {
  ProcessMapper.clearUserOverrides();
  ProcessMapper.clearCategoryColorOverrides();
  ProcessMapper.clearCategoryLabelOverrides();
  ProcessMapper.setDeletedCategories([]);

  ClassificationService.applyBootstrapToProcessMapper({
    observed: [],
    observedWebDomains: [],
    loadedOverrides: {
      "chrome.exe": {
        enabled: true,
        displayName: "Work Browser",
      },
    },
    loadedWebDomainOverrides: {},
    loadedCategoryColorOverrides: {
      development: "#112233",
    },
    loadedCategoryLabelOverrides: {
      development: "Dev Tools",
    },
    loadedPersistedCategoryIds: [],
    loadedDeletedCategories: ["music"],
  });

  assert.equal(ProcessMapper.getUserOverride("chrome.exe")?.displayName, "Work Browser");
  assert.equal(ProcessMapper.getCategoryColorOverride("development"), "#112233");
  assert.equal(ProcessMapper.getCategoryLabel("development"), "Dev Tools");
  assert.equal(ProcessMapper.isCategoryDeleted("music"), true);

  ProcessMapper.clearUserOverrides();
  ProcessMapper.clearCategoryColorOverrides();
  ProcessMapper.clearCategoryLabelOverrides();
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
    loadCategoryLabelOverrides: async () => ({
      development: "Dev Tools",
    }),
    loadPersistedCategoryIds: async () => [],
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
    assert.equal(bootstrap.loadedCategoryLabelOverrides.development, "Dev Tools");
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
    setCategoryLabelOverrides: () => {
      events.push("sync:label");
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
