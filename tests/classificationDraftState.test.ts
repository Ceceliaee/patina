import assert from "node:assert/strict";
import { WebLinksReadError } from "../src/platform/persistence/webLinksGateway.ts";
import {
  buildLegacyExtendedCategoryId,
  createCategoryId,
  resolveExtendedCategoryLabel as resolveExtendedCategoryLabelRaw,
  USER_ASSIGNABLE_CATEGORIES,
  type UserAssignableAppCategory,
} from "../src/shared/classification/categoryTokens.ts";
import {
  loadAppOverrides,
  buildAppOverrideTransition,
  buildSaveWebDomainOverrideMutations,
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
  type ClassificationBootstrapData,
  type ClassificationBootstrapDeps,
  type ClassificationCommitDeps,
  type AppOverride,
  applySavedWebDomainOverrideToBootstrap,
  commitDraftChangesWithDeps,
  createClassificationCommitDeps,
} from "../src/features/classification/services/classificationService.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import {
  buildClassificationDraftChangePlan,
  cloneClassificationDraftState,
  hasClassificationDraftChanges,
  normalizeClassificationOverride,
  normalizeWebDomainOverride,
  sanitizeDeletedCategories,
  type ClassificationDraftState,
} from "../src/features/classification/services/classificationDraftState.ts";
import {
  getClassificationBootstrapCache,
  setClassificationBootstrapCache,
} from "../src/features/classification/services/classificationBootstrapCache.ts";
import { getLocaleText } from "../src/shared/i18n/runtime.ts";

const ZH_TEXT = getLocaleText("zh-CN");
const resolveExtendedCategoryLabel = (
  category: Parameters<typeof resolveExtendedCategoryLabelRaw>[0],
) => resolveExtendedCategoryLabelRaw(category, ZH_TEXT);

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



await runTest("web override normalization keeps title capture exclusions", () => {
  assert.deepEqual(normalizeWebDomainOverride({
    displayName: "  Focus  ",
    captureTitle: false,
    updatedAt: 7,
  }), {
    displayName: "Focus",
    captureTitle: false,
    updatedAt: 7,
  });
});

await runTest("web override setting mutations preserve controls and normalize domain keys", () => {
  const [upsert] = buildSaveWebDomainOverrideMutations("  Example.COM. ", {
    category: "development",
    displayName: "  Example  ",
    color: "#123456",
    enabled: false,
    captureTitle: false,
    updatedAt: 8,
  });
  assert.equal(upsert?.key, "__web_domain_override::example.com");
  assert.deepEqual(JSON.parse(upsert?.value ?? "{}"), {
    category: "development",
    displayName: "Example",
    color: "#123456",
    enabled: false,
    captureTitle: false,
    updatedAt: 8,
  });
  assert.deepEqual(buildSaveWebDomainOverrideMutations("example.com", null), [{
    key: "__web_domain_override::example.com",
    value: null,
  }]);
  assert.deepEqual(buildSaveWebDomainOverrideMutations("   ", { displayName: "ignored" }), []);
});



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
    "office",
    "communication",
    "browser",
    "video",
    "game",
    "design",
    "development",
    "learning",
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

await runTest("legacy AI and music assignments use the new defaults without losing app settings", () => {
  for (const [oldCategory, category] of [["ai", "office"], ["music", "video"]]) {
    const value = ProcessMapper.fromOverrideStorageValue(JSON.stringify({
      category: oldCategory, displayName: "Personal name", color: "#123456", captureTitle: false,
    }));
    assert.equal(value?.category, category);
    assert.equal(value?.displayName, "Personal name");
    assert.equal(value?.color, "#123456");
    assert.equal(value?.captureTitle, false);
  }
  assert.equal(ProcessMapper.fromOverrideStorageValue('{"category":"learning"}')?.category, "learning");
  assert.equal(ProcessMapper.fromOverrideStorageValue('{"category":"custom:research"}')?.category, "custom:research");
  const web = buildSaveWebDomainOverrideMutations("example.com", { category: "music", captureTitle: false });
  assert.equal(JSON.parse(web[0].value!).category, "video");
  assert.equal(JSON.parse(web[0].value!).captureTitle, false);
});

await runTest("mapping without override ignores saved user overrides", () => {
  ProcessMapper.clearUserOverrides();
  ProcessMapper.setUserOverride("chrome.exe", {
    enabled: true,
    displayName: "Work Browser",
    category: "other",
  });

  const mapped = ProcessMapper.map("chrome.exe", { appName: "Google Chrome" });
  const withoutOverride = ProcessMapper.mapWithoutOverride("chrome.exe", { appName: "Google Chrome" });

  assert.equal(mapped.name, "Work Browser");
  assert.equal(mapped.category, "other");
  assert.equal(withoutOverride.name, "Google Chrome");
  assert.equal(withoutOverride.category, "other");

  ProcessMapper.clearUserOverrides();
});

await runTest("unknown apps use runtime names and executable fallbacks without a catalog entry", () => {
  assert.equal(
    ProcessMapper.mapWithoutOverride("new-editor.exe", { appName: "New Editor Runtime" }).name,
    "New Editor Runtime",
  );
  assert.equal(ProcessMapper.mapWithoutOverride("new-editor.exe").name, "New Editor");
  assert.equal(ProcessMapper.shouldTrack("new-editor.exe"), true);
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

await runTest("legacy migration reads bounded identities and retains configured applications without activity", async () => {
  const host = globalThis as unknown as { window?: unknown };
  const previousWindow = host.window;
  const marker = "__classification_manual_confirmation_migration::v1";
  const settings = new Map<string, string>();
  const commits: Array<Array<{ key: string; value: string | null }>> = [];
  let readFailure = true;
  let invalidPayload = false;
  let commitFailure = false;
  let identityReads = 0;
  let distinctReads = 0;
  host.window = { __TAURI_INTERNALS__: { invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === "cmd_get_legacy_classification_apps") {
      identityReads += 1;
      assert.equal(typeof args.nowMs, "number");
      if (readFailure) throw { code: "READ_FAILED", message: "controlled candidate read", retryable: true };
      return invalidPayload ? [{ exeName: "missing-name.exe" }] : [];
    }
    if (command === "cmd_commit_classification_settings") {
      if (commitFailure) throw { code: "COMMIT_FAILED", message: "controlled commit", retryable: true };
      const mutations = args.mutations as Array<{ key: string; value: string | null }>;
      commits.push(mutations);
      for (const mutation of mutations) {
        if (mutation.value === null) settings.delete(mutation.key);
        else settings.set(mutation.key, mutation.value);
      }
      return;
    }
    if (command === "cmd_get_recorded_executable_names") {
      distinctReads += 1;
      return [];
    }
    assert.equal(command, "cmd_get_setting_rows", "raw migration fact transfer is forbidden");
    if (typeof args.key === "string") return settings.has(args.key) ? [{ key: args.key, value: settings.get(args.key) }] : [];
    const prefix = String(args.keyPrefix ?? "");
    return Array.from(settings, ([key, value]) => ({ key, value })).filter(row => row.key.startsWith(prefix));
  } } };
  try {
    await assert.rejects(loadAppOverrides(), { code: "READ_FAILED" });
    assert.equal(settings.has(marker), false);
    assert.equal(commits.length, 0);
    readFailure = false;
    invalidPayload = true;
    await assert.rejects(loadAppOverrides(), /invalid legacy classification/i);
    assert.equal(settings.has(marker), false);
    invalidPayload = false;
    assert.deepEqual(await loadAppOverrides(), {});
    assert.equal(identityReads, 3);
    assert.equal(distinctReads, 0, "empty overrides have no consumer for the full recorded-executable scan");
    assert.equal(commits.length, 1);
    assert.deepEqual(commits[0].map(row => row.key), [marker]);

    settings.set("__app_override::Douyin_tray.exe", JSON.stringify({ category: "video", enabled: true }));
    const retained = await loadAppOverrides();
    assert.equal(retained["douyin.exe"]?.category, "video");
    assert.equal(identityReads, 3, "the successful migration is not rerun on ordinary mapping refresh");
    assert.deepEqual(commits[1].map(row => row.key), ["__app_override::Douyin_tray.exe", "__app_override::douyin.exe"]);

    settings.delete("__app_override::douyin.exe");
    settings.set("__app_override::Douyin_tray.exe", JSON.stringify({ category: "video", enabled: true }));
    commitFailure = true;
    await assert.rejects(loadAppOverrides(), { code: "COMMIT_FAILED" });
    assert.equal(commits.length, 2);
    assert.equal(settings.has("__app_override::Douyin_tray.exe"), true);
    commitFailure = false;
    assert.equal((await loadAppOverrides())["douyin.exe"]?.category, "video");
    assert.equal(distinctReads, 0);
    assert.deepEqual(commits[2].map(row => [row.key, row.value === null]), [
      ["__app_override::Douyin_tray.exe", true], ["__app_override::douyin.exe", false],
    ], "override transition is atomic");
  } finally {
    if (previousWindow === undefined) delete host.window;
    else host.window = previousWindow;
  }
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

await runTest("alias-backed app overrides migrate to the explicit canonical executable key", () => {
  const transition = buildAppOverrideTransition(
    "__app_override::Douyin_tray.exe",
    JSON.stringify({ displayName: "短视频", enabled: true, updatedAt: 123 }),
  );

  assert.equal(transition.canonicalExe, "douyin.exe");
  assert.equal(transition.override?.displayName, "短视频");
  assert.deepEqual(transition.mutations.map((mutation) => mutation.key), [
    "__app_override::Douyin_tray.exe",
    "__app_override::douyin.exe",
  ]);
  assert.equal(transition.mutations[0].value, null);
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



await runTest("process mapper applies extended category display label overrides", () => {
  const category = "custom:category_focus" as const;

  ProcessMapper.setCategoryLabelOverrides({
    [category]: "Focus",
  });

  assert.equal(ProcessMapper.getCategoryLabel(category, ZH_TEXT), "Focus");

  ProcessMapper.clearCategoryLabelOverrides();
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
    appLinkChanges: [],
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
  assert.equal(ProcessMapper.getCategoryLabel("development", ZH_TEXT), "Dev Tools");
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
  assert.equal(ProcessMapper.getCategoryLabel("development", ZH_TEXT), "Dev Tools");
  assert.equal(ProcessMapper.isCategoryDeleted("music"), true);

  ProcessMapper.clearUserOverrides();
  ProcessMapper.clearCategoryColorOverrides();
  ProcessMapper.clearCategoryLabelOverrides();
  ProcessMapper.setDeletedCategories([]);
});

await runTest("classification bootstrap keeps app rules when optional web reads fail", async () => {
  const deps: ClassificationBootstrapDeps = {
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

    assert.deepEqual(bootstrap.observedWebDomains, []);
    assert.deepEqual(bootstrap.loadedWebDomainOverrides, {});
    assert.equal(bootstrap.loadedOverrides["vscodium.exe"]?.category, "development");
    assert.equal(bootstrap.loadedCategoryColorOverrides.development, "#112233");
    assert.equal(bootstrap.loadedCategoryLabelOverrides.development, "Dev Tools");
    assert.deepEqual(bootstrap.loadedDeletedCategories, ["music"]);
    assert.match(warning, /Web domain classification data is unavailable/);
    await assert.rejects(() => ClassificationService.loadClassificationBootstrap({
      ...deps, loadObservedWebDomainCandidates: async () => [],
      loadWebDomainOverrides: async () => { throw new WebLinksReadError("rules unavailable"); },
    }), /rules unavailable/);
  } finally {
    console.warn = originalWarn;
  }
});

await runTest("classification bootstrap shares one in-flight read across warmup and page mount", async () => {
  let releaseOverrides!: (value: Record<string, AppOverride>) => void;
  const overridesPromise = new Promise<Record<string, AppOverride>>((resolve) => {
    releaseOverrides = resolve;
  });
  const calls: string[] = [];
  const deps: ClassificationBootstrapDeps = {
    loadObservedWebDomainCandidates: async () => {
      calls.push("web-observed");
      return [];
    },
    loadAppOverrides: async () => {
      calls.push("overrides");
      return overridesPromise;
    },
    loadWebDomainOverrides: async () => {
      calls.push("web-overrides");
      return {};
    },
    loadCategoryColorOverrides: async () => {
      calls.push("colors");
      return {};
    },
    loadCategoryLabelOverrides: async () => {
      calls.push("labels");
      return {};
    },
    loadPersistedCategoryIds: async () => {
      calls.push("categories");
      return [];
    },
    loadDeletedCategories: async () => {
      calls.push("deleted");
      return [];
    },
  };

  const warmupRequest = ClassificationService.loadClassificationBootstrap(deps);
  const pageRequest = ClassificationService.loadClassificationBootstrap(deps);
  await Promise.resolve();

  assert.equal(calls.filter((event) => event === "overrides").length, 1);

  releaseOverrides({});
  const [warmupBootstrap, pageBootstrap] = await Promise.all([warmupRequest, pageRequest]);

  assert.deepEqual(pageBootstrap, warmupBootstrap);
});

await runTest("classification bootstrap invalidation rejects an in-flight pre-delete snapshot", async () => {
  ClassificationService.invalidateBootstrapCache();
  let historyDeleted = false;
  let overrideReads = 0;
  let releaseStaleOverrides!: (value: Record<string, AppOverride>) => void;
  const staleOverrides = new Promise<Record<string, AppOverride>>((resolve) => {
    releaseStaleOverrides = resolve;
  });
  const deps: ClassificationBootstrapDeps = {
    loadObservedWebDomainCandidates: async () => historyDeleted ? [] : [{ normalizedDomain: "example.com", domain: "example.com", totalDuration: 100, lastSeenMs: 100, faviconUrl: null, title: null }],
    loadAppOverrides: async () => {
      overrideReads += 1;
      return overrideReads === 1
        ? staleOverrides
        : { "fresh.exe": { enabled: true, displayName: "Fresh" } };
    },
    loadWebDomainOverrides: async () => ({ "example.com": { captureTitle: false, ...(historyDeleted ? {} : { knownDomain: true }) } }),
    loadCategoryColorOverrides: async () => ({}),
    loadCategoryLabelOverrides: async () => ({}),
    loadPersistedCategoryIds: async () => [],
    loadDeletedCategories: async () => [],
  };

  const staleRequest = ClassificationService.loadClassificationBootstrap(deps);
  await Promise.resolve();
  historyDeleted = true;
  ClassificationService.invalidateBootstrapCache();
  releaseStaleOverrides({ "stale.exe": { enabled: true, displayName: "Stale" } });
  const resolved = await staleRequest;

  assert.equal(overrideReads, 2);
  assert.equal(resolved.loadedOverrides["fresh.exe"]?.displayName, "Fresh");
  assert.equal(ClassificationService.getBootstrapCache()?.loadedOverrides["fresh.exe"]?.displayName, "Fresh");
  assert.deepEqual(resolved.observedWebDomains, []);
  assert.deepEqual(resolved.loadedWebDomainOverrides["example.com"], { captureTitle: false });
});

await runTest("late classification refresh cannot overwrite a newer saved bootstrap", async () => {
  const baselineBootstrap: ClassificationBootstrapData = {
    observedWebDomains: [],
    loadedOverrides: {},
    loadedWebDomainOverrides: {},
    loadedCategoryColorOverrides: {},
    loadedCategoryLabelOverrides: {},
    loadedPersistedCategoryIds: [],
    loadedDeletedCategories: [],
  };
  const savedBootstrap: ClassificationBootstrapData = {
    ...baselineBootstrap,
    loadedOverrides: {
      "cursor.exe": {
        enabled: true,
        displayName: "Saved Cursor",
      },
    },
  };
  let releaseOverrides!: (value: Record<string, AppOverride>) => void;
  const overridesPromise = new Promise<Record<string, AppOverride>>((resolve) => {
    releaseOverrides = resolve;
  });
  const deps: ClassificationBootstrapDeps = {
    loadObservedWebDomainCandidates: async () => [],
    loadAppOverrides: () => overridesPromise,
    loadWebDomainOverrides: async () => ({}),
    loadCategoryColorOverrides: async () => ({}),
    loadCategoryLabelOverrides: async () => ({}),
    loadPersistedCategoryIds: async () => [],
    loadDeletedCategories: async () => [],
  };

  setClassificationBootstrapCache(baselineBootstrap);
  const refreshRequest = ClassificationService.loadClassificationBootstrap(deps);
  setClassificationBootstrapCache(savedBootstrap);
  releaseOverrides({ "cursor.exe": { enabled: true, displayName: "Stale Cursor" } });

  const resolvedBootstrap = await refreshRequest;

  assert.equal(resolvedBootstrap, savedBootstrap);
  assert.equal(getClassificationBootstrapCache(), savedBootstrap);
});

await runTest("saved web override updates only its normalized bootstrap key", () => {
  const baseline: ClassificationBootstrapData = {
    observedWebDomains: [],
    loadedOverrides: { "editor.exe": { category: "development" } },
    loadedWebDomainOverrides: {
      "existing.example": { displayName: "Existing", category: "office" },
    },
    loadedCategoryColorOverrides: { development: "#123456" },
    loadedCategoryLabelOverrides: {},
    loadedPersistedCategoryIds: [],
    loadedDeletedCategories: [],
  };

  const saved = applySavedWebDomainOverrideToBootstrap(
    baseline,
    "docs.example",
    {
      displayName: "Docs",
      category: "development",
      enabled: false,
      captureTitle: false,
    },
  );

  assert.equal(saved.loadedOverrides, baseline.loadedOverrides);
  assert.equal(saved.loadedCategoryColorOverrides, baseline.loadedCategoryColorOverrides);
  assert.deepEqual(saved.loadedWebDomainOverrides["existing.example"], {
    displayName: "Existing",
    category: "office",
  });
  assert.deepEqual(saved.loadedWebDomainOverrides["docs.example"], {
    displayName: "Docs",
    category: "development",
    enabled: false,
    captureTitle: false,
  });
  assert.equal(baseline.loadedWebDomainOverrides["docs.example"], undefined);

  const cleared = applySavedWebDomainOverrideToBootstrap(saved, "docs.example", null);
  assert.equal(cleared.loadedWebDomainOverrides["docs.example"], undefined);
  assert.deepEqual(cleared.loadedWebDomainOverrides["existing.example"], {
    displayName: "Existing",
    category: "office",
  });
  const metadata = { knownDomain: true, groupingRoot: "example.com", lifetimeDuration: 1000, faviconUrl: "https://chat.example.com/icon.png" };
  const observed = { ...baseline, loadedWebDomainOverrides: { "chat.example.com": { ...metadata, displayName: "Chat" } } };
  const renamed = applySavedWebDomainOverrideToBootstrap(observed, "chat.example.com", { displayName: "Renamed" });
  assert.deepEqual(renamed.loadedWebDomainOverrides["chat.example.com"], { ...metadata, displayName: "Renamed" });
  assert.deepEqual(applySavedWebDomainOverrideToBootstrap(renamed, "chat.example.com", null).loadedWebDomainOverrides["chat.example.com"], metadata);
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
