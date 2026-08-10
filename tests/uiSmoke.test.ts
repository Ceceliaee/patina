import assert from "node:assert/strict";
import test from "node:test";
import { getLocaleText } from "../src/shared/i18n/runtime.ts";
import { resolveQuietMotionMode } from "../src/shared/motion/quietMotion.ts";

const COPY = { "zh-CN": getLocaleText("zh-CN"), "en-US": getLocaleText("en-US") } as const;

function collectCopyKeyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "function" || value === null || typeof value !== "object") {
    return [prefix];
  }
  if (Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    return collectCopyKeyPaths(child, nextPrefix);
  });
}

test("motion preference keeps reduced motion above enhanced motion", () => {
  assert.equal(resolveQuietMotionMode({
    enhancedMotionEnabled: true,
    prefersReducedMotion: true,
  }), "reduced");
  assert.equal(resolveQuietMotionMode({
    enhancedMotionEnabled: false,
    prefersReducedMotion: true,
  }), "reduced");
  assert.equal(resolveQuietMotionMode({
    enhancedMotionEnabled: false,
    prefersReducedMotion: false,
  }), "baseline");
  assert.equal(resolveQuietMotionMode({
    enhancedMotionEnabled: true,
    prefersReducedMotion: false,
  }), "enhanced");
});

test("Chinese and English copy packages keep the same key structure", () => {
  assert.deepEqual(
    collectCopyKeyPaths(COPY["en-US"]).sort(),
    collectCopyKeyPaths(COPY["zh-CN"]).sort(),
  );
});
