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
  const options = buildActivityReminderTargetOptions(
    apps,
    categories,
    webDomains,
    { "patina.exe": "data:image/png;base64,icon" },
  );
  assert.deepEqual(options[0], {
    key: "app:Patina.exe",
    value: "app:Patina.exe",
    label: "Patina",
    meta: "Patina.exe",
    iconUrl: "data:image/png;base64,icon",
    accentColor: null,
    target: { kind: "app", appName: "Patina", exeName: "Patina.exe" },
  });
  assert.equal(options[1]?.value, "category:development");
  assert.equal(options[1]?.label, "开发");
  assert.equal(options[1]?.accentColor, "#2563eb");
  assert.deepEqual(options[1]?.target, { kind: "category", categoryId: "development" });
  assert.equal(options[2]?.value, "web:github.com");
  assert.equal(options[2]?.label, "GitHub");
  assert.equal(options[2]?.meta, "github.com");
  assert.deepEqual(options[2]?.target, { kind: "web", normalizedDomain: "github.com" });
});

test("all activity reminder target modes are searchable by label or stable identity", () => {
  const allOptions = buildActivityReminderTargetOptions(apps, categories, webDomains, {});

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
  assert.equal(findActivityReminderTargetOption("Patina (Patina.exe)", allOptions)?.target.kind, "app");
  assert.equal(findActivityReminderTargetOption("GITHUB.COM.", allOptions)?.target.kind, "web");
});

test("merged activity targets require an explicit selection when identities overlap", () => {
  const options = buildActivityReminderTargetOptions(
    [{ appName: "Shared", exeName: "shared", lastSeenAt: 1 }],
    [{ categoryId: "shared", label: "Shared", color: "#2563eb" }],
    [{ normalizedDomain: "shared", label: "Shared", faviconUrl: null, lastSeenAt: 1 }],
    {},
  );
  assert.equal(filterActivityReminderTargetOptions("Shared", options).length, 3);
  assert.equal(findActivityReminderTargetOption("shared", options), null);
  for (const kind of ["app", "category", "web"]) {
    assert.equal(findActivityReminderTargetOption(`${kind}:shared`, options)?.target.kind, kind);
  }
});
