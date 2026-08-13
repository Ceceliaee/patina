import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActivityReminderTargetOptions,
  filterActivityReminderTargetOptions,
  findActivityReminderTargetOption,
} from "../src/features/tools/services/activityReminderTargetOptions.ts";
import { ProcessMapper } from "../src/shared/classification/processMapper.ts";

const apps = [{ appName: "Patina", exeName: "Patina.exe", lastSeenAt: 3 }];
const categories = [{ categoryId: "development", label: "开发", color: "#2563eb" }];
const webDomains = [{
  normalizedDomain: "github.com",
  label: "GitHub",
  faviconUrl: "https://github.com/favicon.ico",
  lastSeenAt: 2,
}];

test("seeded activity reminder categories resolve distinct registry defaults", () => {
  ProcessMapper.clearCategoryColorOverrides();
  ProcessMapper.setCategoryDefaultColorAssignments({});

  const colors = (["ai", "development", "office", "browser"] as const)
    .map((category) => ProcessMapper.getDefaultCategoryColor(category));

  assert.equal(new Set(colors).size, colors.length);
});

test("activity reminder target options keep readable labels and stable values", () => {
  const appOptions = buildActivityReminderTargetOptions(
    "app",
    apps,
    categories,
    webDomains,
    { "patina.exe": "data:image/png;base64,icon" },
  );
  const categoryOptions = buildActivityReminderTargetOptions("category", apps, categories, webDomains, {});
  const webOptions = buildActivityReminderTargetOptions("web", apps, categories, webDomains, {});

  assert.deepEqual(appOptions[0], {
    key: "app:Patina.exe",
    value: "Patina.exe",
    label: "Patina",
    meta: "Patina.exe",
    iconUrl: "data:image/png;base64,icon",
    accentColor: null,
  });
  assert.equal(categoryOptions[0]?.value, "development");
  assert.equal(categoryOptions[0]?.label, "开发");
  assert.equal(categoryOptions[0]?.accentColor, "#2563eb");
  assert.equal(webOptions[0]?.value, "github.com");
  assert.equal(webOptions[0]?.label, "GitHub");
  assert.equal(webOptions[0]?.meta, "github.com");
});

test("all activity reminder target modes are searchable by label or stable identity", () => {
  const allOptions = [
    ...buildActivityReminderTargetOptions("app", apps, categories, webDomains, {}),
    ...buildActivityReminderTargetOptions("category", apps, categories, webDomains, {}),
    ...buildActivityReminderTargetOptions("web", apps, categories, webDomains, {}),
  ];

  assert.deepEqual(filterActivityReminderTargetOptions("patina.exe", allOptions).map((item) => item.key), [
    "app:Patina.exe",
  ]);
  assert.deepEqual(filterActivityReminderTargetOptions("开发", allOptions).map((item) => item.key), [
    "category:development",
  ]);
  assert.deepEqual(filterActivityReminderTargetOptions("github.com", allOptions).map((item) => item.key), [
    "web:github.com",
  ]);
  assert.equal(findActivityReminderTargetOption(" PATINA.EXE ", allOptions)?.label, "Patina");
});
