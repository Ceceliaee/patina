import assert from "node:assert/strict";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import * as esbuild from "esbuild";
import { COPY } from "../src/shared/copy/uiText.ts";

const EXPECTED_VIEWS = [
  "dashboard",
  "history",
  "data",
  "mapping",
  "settings",
  "about",
] as const;

const EXPECTED_NAV_LABELS = [
  "今天",
  "历史",
  "数据",
  "应用",
  "设置",
  "关于",
] as const;

let passed = 0;
const require = createRequire(import.meta.url);

async function runTest(name: string, fn: () => Promise<void> | void) {
  await fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function readUtf8(path: string) {
  return readFileSync(path, "utf8");
}

function collectCopyKeyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "function" || value === null || typeof value !== "object") {
    return [prefix];
  }

  if (Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return collectCopyKeyPaths(child, nextPrefix);
  });
}

function tauriStubFor(path: string) {
  if (path === "@tauri-apps/api/window") {
    return `
      const noop = async () => {};
      const currentWindow = {
        minimize: noop,
        toggleMaximize: noop,
        close: noop,
        startDragging: noop,
        isMaximized: async () => false,
        isVisible: async () => true,
        isFocused: async () => true,
        onResized: async () => () => {},
      };
      export function getCurrentWindow() {
        return currentWindow;
      }
    `;
  }

  if (path === "@tauri-apps/api/webviewWindow") {
    return `
      export function getCurrentWebviewWindow() {
        return { label: "main" };
      }
    `;
  }

  if (path === "@tauri-apps/api/core") {
    return `
      export async function invoke() {
        return null;
      }
      export class Channel {
        onmessage = null;
        constructor() {}
      }
    `;
  }

  if (path === "@tauri-apps/api/event") {
    return `
      export async function listen() {
        return () => {};
      }
      export async function emit() {}
    `;
  }

  if (path === "@tauri-apps/api/app") {
    return `
      export async function getVersion() {
        return "0.0.0-smoke";
      }
    `;
  }

  if (path === "@tauri-apps/plugin-opener") {
    return `
      export async function openUrl() {}
    `;
  }

  if (path === "@tauri-apps/plugin-sql") {
    return `
      export default class Database {
        static async load() {
          return new Database();
        }
        async select() {
          return [];
        }
        async execute() {}
        async close() {}
      }
    `;
  }

  throw new Error(`Missing Tauri smoke stub for ${path}`);
}

const tauriSmokeStubPlugin: esbuild.Plugin = {
  name: "tauri-smoke-stubs",
  setup(build) {
    build.onResolve({ filter: /^@tauri-apps\// }, (args) => ({
      path: args.path,
      namespace: "tauri-smoke-stub",
    }));
    build.onLoad({ filter: /.*/, namespace: "tauri-smoke-stub" }, (args) => ({
      contents: tauriStubFor(args.path),
      loader: "js",
    }));
  },
};

await runTest("app shell declares every primary desktop view", () => {
  const viewType = readUtf8("src/app/types/view.ts");
  const shell = readUtf8("src/app/AppShell.tsx");
  const sidebar = readUtf8("src/app/components/AppSidebar.tsx");

  for (const view of EXPECTED_VIEWS) {
    assert.match(viewType, new RegExp(`"${view}"`));
    assert.match(shell, new RegExp(`currentView === "${view}"`));
    assert.match(sidebar, new RegExp(`id: "${view}" as View`));
  }
});

await runTest("Chinese and English copy packages keep the same key structure", () => {
  assert.deepEqual(
    collectCopyKeyPaths(COPY["en-US"]).sort(),
    collectCopyKeyPaths(COPY["zh-CN"]).sort(),
  );
});

await runTest("app shell renders dashboard and primary navigation without Tauri runtime", async () => {
  const entry = `
    import React from "react";
    import { renderToString } from "react-dom/server";
    import AppShell from "./src/app/AppShell.tsx";

    const originalWarn = console.warn;
    console.warn = (...args) => {
      if (String(args[0] ?? "").includes("width(-1) and height(-1) of chart")) {
        return;
      }
      originalWarn(...args);
    };
    export const html = renderToString(React.createElement(AppShell));
    console.warn = originalWarn;
  `;
  const result = await esbuild.build({
    stdin: {
      contents: entry,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    loader: {
      ".png": "dataurl",
      ".css": "empty",
    },
    plugins: [tauriSmokeStubPlugin],
  });
  const bundled = result.outputFiles[0]?.text;
  assert.ok(bundled);

  const bundlePath = "tests/.tmp-ui-smoke-bundle.cjs";
  writeFileSync(bundlePath, bundled, "utf8");
  let html = "";
  try {
    const module = require(resolve(bundlePath)) as { html: string };
    html = module.html;
  } finally {
    unlinkSync(bundlePath);
  }

  for (const label of EXPECTED_NAV_LABELS) {
    assert.ok(html.includes(`aria-label="${label}"`), `missing nav label ${label}`);
  }
  assert.ok(html.includes("专注分布"));
  assert.ok(html.includes("应用排行"));
  assert.ok(html.includes(`aria-label="按分类显示"`));
});

console.log(`Passed ${passed} UI smoke tests`);
