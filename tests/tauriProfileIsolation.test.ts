import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  DEV_CONFIG_PATH,
  resolveTauriArguments,
} from "../scripts/tauri-cli.ts";

test("tauri dev defaults to the isolated development profile", () => {
  assert.deepEqual(resolveTauriArguments(["dev"]), [
    "dev",
    "--config",
    DEV_CONFIG_PATH,
  ]);
  assert.deepEqual(resolveTauriArguments(["dev", "--no-watch"]), [
    "dev",
    "--config",
    DEV_CONFIG_PATH,
    "--no-watch",
  ]);
  assert.deepEqual(resolveTauriArguments(["-v", "dev"]), [
    "-v",
    "dev",
    "--config",
    DEV_CONFIG_PATH,
  ]);
  assert.deepEqual(
    resolveTauriArguments(["dev", "--", "--config", "runner.json"]),
    [
      "dev",
      "--config",
      DEV_CONFIG_PATH,
      "--",
      "--config",
      "runner.json",
    ],
  );
});

test("tauri dev preserves an explicitly selected non-default profile", () => {
  const explicitLong = [
    "dev",
    "--config",
    "src-tauri/tauri.local.conf.json",
  ];
  const explicitShort = [
    "dev",
    "-c",
    "src-tauri/tauri.local.conf.json",
  ];

  assert.deepEqual(resolveTauriArguments(explicitLong), explicitLong);
  assert.deepEqual(resolveTauriArguments(explicitShort), explicitShort);
});

test("tauri release commands remain on the production profile", () => {
  assert.deepEqual(resolveTauriArguments(["build"]), ["build"]);
  assert.deepEqual(
    resolveTauriArguments(["build", "--bundles", "nsis"]),
    ["build", "--bundles", "nsis"],
  );
  assert.deepEqual(resolveTauriArguments(["build", "--", "dev"]), [
    "build",
    "--",
    "dev",
  ]);
});

test("production and development configs declare distinct identities", () => {
  const production = JSON.parse(
    fs.readFileSync("src-tauri/tauri.conf.json", "utf8"),
  ) as { identifier?: string; productName?: string; mainBinaryName?: string };
  const development = JSON.parse(
    fs.readFileSync("src-tauri/tauri.dev.conf.json", "utf8"),
  ) as { identifier?: string; productName?: string; mainBinaryName?: string };

  assert.equal(production.identifier, "com.ceceliaee.patina");
  assert.equal(development.identifier, "com.ceceliaee.patina.dev");
  assert.notEqual(development.identifier, production.identifier);
  assert.notEqual(development.productName, production.productName);
  assert.notEqual(development.mainBinaryName, production.mainBinaryName);
});
