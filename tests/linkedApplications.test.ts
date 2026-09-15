import assert from "node:assert/strict";
import { syncAppMappingNameDraft } from "../src/features/classification/hooks/appMappingInteractions.ts";
import { ClassificationService } from "../src/features/classification/services/classificationService.ts";
import { changeAppLink, validateAppLinks } from "../src/shared/classification/appLinks.ts";
import { AppClassification } from "../src/shared/classification/appClassification.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";
import { compileSessions, buildNormalizedAppStats } from "../src/shared/lib/sessionReadCompiler.ts";
import { resolveStatisticalDataAppKey } from "../src/features/data/services/dataHeatmapReadModel.ts";
import { groupLinkedAppCatalog, seedLinkedAppName } from "../src/features/classification/services/linkedAppCatalog.ts";
import { resolveAppIconKeys } from "../src/shared/classification/appIconIdentity.ts";
import { buildClassificationDraftChangePlan, cloneClassificationDraftState, hasClassificationDraftChanges } from "../src/features/classification/services/classificationDraftState.ts";

const links = changeAppLink({}, "b.exe", "a.exe");
assert.throws(() => changeAppLink(links, "a.exe", "b.exe"));
assert.throws(() => changeAppLink(links, "c.exe", "b.exe"));
assert.throws(() => validateAppLinks({ "A.exe": "b.exe" }));
const saved = { overrides: {}, webDomainOverrides: {}, categoryColorOverrides: {}, categoryLabelOverrides: {}, persistedCategoryIds: [], deletedCategories: [] };
const draft = { ...cloneClassificationDraftState(saved), appLinks: links };
const parent = { exeName: "a.exe", appName: "Parent", totalDuration: 0, lastSeenMs: 0 };
seedLinkedAppName(draft, saved, saved, parent, [parent]);
assert.equal(hasClassificationDraftChanges(saved, draft), true);
assert.deepEqual(buildClassificationDraftChangePlan(saved, draft).appLinkChanges,
  [{ member: "b.exe", parent: "a.exe", previous: null }]);
const linkedDraft = cloneClassificationDraftState(draft);
const resetName = syncAppMappingNameDraft({ draftState: linkedDraft, nameDrafts: {}, nameEditSnapshots: {},
  editingNameExe: "a.exe", skipNextNameBlurExe: null }, parent, "", "Parent");
assert.equal(resetName.draftState.overrides["a.exe"].displayName, "Parent");
draft.appLinks = changeAppLink(draft.appLinks, "b.exe", null);
seedLinkedAppName(draft, linkedDraft, saved, null, [parent]);
assert.equal(hasClassificationDraftChanges(saved, draft), false);

const sessions = [10, 20, 5].map((minutes, index) => ({ id: index + 1, exeName: `${"abc"[index]}.exe`,
  appName: "Same name", windowTitle: `Document ${index}`, startTime: index * 3600000, continuityGroupStartTime: index * 3600000,
  endTime: index * 3600000 + minutes * 60000, duration: minutes * 60000 }));
const compile = () => compileSessions(sessions, { startMs: 0, endMs: 10800000, minSessionSecs: 0 });
ProcessMapper.setUserOverrides({ "a.exe": { displayName: "Parent", category: "office", color: "#112233" },
  "b.exe": { displayName: "Child", category: "development", color: "#445566" } });
assert.equal(buildNormalizedAppStats(compile()).length, 3);
AppClassification.setAppLinks(links);
const stats = buildNormalizedAppStats(compile());
assert.equal(stats.length, 2);
assert.equal(stats.find((row) => row.exeName === "a.exe")?.totalDuration, 30 * 60000);
assert.equal(stats.reduce((sum, row) => sum + row.totalDuration, 0), 35 * 60000);
assert.equal(compile()[1].appKey, "b.exe");
assert.equal(compile()[1].displayName, "Parent");
assert.equal(compile()[1].exeName, "b.exe");
assert.equal(AppClassification.mapApp("b.exe").color, "#112233");
assert.deepEqual(resolveAppIconKeys("b.exe"), ["a.exe"]);
assert.equal(resolveStatisticalDataAppKey(sessions[1]), "a.exe");
ProcessMapper.setUserOverrides({ "b.exe": { track: false } });
assert.equal(resolveStatisticalDataAppKey(sessions[1]), null);
assert.equal(buildNormalizedAppStats(compile()).reduce((sum, row) => sum + row.totalDuration, 0), 15 * 60000);
const catalog = groupLinkedAppCatalog([{ exeName: "b.exe", appName: "Child", totalDuration: 20, lastSeenMs: 1 }], links,
  { "a.exe": { displayName: "Parent" } });
assert.equal(catalog.length, 1);
assert.equal(catalog[0].exeName, "a.exe");
assert.equal(catalog[0].appName, "Parent");
assert.match(catalog[0].searchText!, /Child/);
AppClassification.setAppLinks({});
ProcessMapper.clearUserOverrides();
assert.equal(buildNormalizedAppStats(compile()).length, 3);
console.log("Linked application identity, statistics, draft and catalog checks passed");

const large = Array.from({ length: 10000 }, (_, index) => ({ ...sessions[index % 3], id: index + 1,
  startTime: index * 60000, continuityGroupStartTime: index * 60000, endTime: (index + 1) * 60000, duration: 60000 }));
const measure = () => {
  const start = performance.now();
  const result = buildNormalizedAppStats(compileSessions(large, { startMs: 0, endMs: 600000000, minSessionSecs: 0 }));
  return { duration: result.reduce((sum, row) => sum + row.totalDuration, 0), milliseconds: performance.now() - start };
};
measure();
const baseline = measure();
AppClassification.setAppLinks(links);
const grouped = measure();
assert.equal(grouped.duration, baseline.duration);
AppClassification.setAppLinks({});
console.log("Linked application comparison", { records: large.length, baseline, grouped });

const host = globalThis as unknown as { window?: unknown };
const originalWindow = host.window;
const ensureCatalog = ClassificationService.ensureAppCatalogLoaded;
const catalogSnapshot = ClassificationService.getAppCatalogSnapshot;
try {
  const snapshot = { candidates: [parent], sourceRevision: 1, completedAtMs: 1 };
  ClassificationService.ensureAppCatalogLoaded = () => Promise.resolve(snapshot);
  ClassificationService.getAppCatalogSnapshot = () => ({ status: "ready", committed: snapshot, requestGeneration: 1, error: null });
  let storedName = "";
  host.window = { __TAURI_INTERNALS__: { invoke: async (command: string, args: { mutations: Array<{value: string}> }) => {
    assert.equal(command, "cmd_commit_classification_settings");
    storedName = JSON.parse(args.mutations[0].value).displayName;
  } } };
  ProcessMapper.setUserOverrides({ "a.exe": { displayName: "Custom parent" }, "b.exe": { displayName: "Custom child" } });
  AppClassification.setAppLinks(links);
  await ClassificationService.saveAppOverride("a.exe", null);
  assert.equal(storedName, "Parent");
  assert.equal(buildNormalizedAppStats(compile()).find((row) => row.exeName === "a.exe")?.appName, "Parent");
  assert.equal(ProcessMapper.getUserOverride("b.exe")?.displayName, "Custom child");
  console.log("Linked root name restore retains a consistent catalog and statistical identity");
} finally {
  host.window = originalWindow;
  ClassificationService.ensureAppCatalogLoaded = ensureCatalog;
  ClassificationService.getAppCatalogSnapshot = catalogSnapshot;
  AppClassification.setAppLinks({});
  ProcessMapper.clearUserOverrides();
}
