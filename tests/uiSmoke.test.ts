import assert from "node:assert/strict";
import test from "node:test";
import { SUPPORTED_LOCALES, type Locale, type UiText } from "../src/shared/i18n/generated/contract.ts";
import { loadLocaleText } from "../src/shared/i18n/runtime.ts";
import { resolveQuietMotionMode } from "../src/shared/motion/quietMotion.ts";

const COPY = Object.fromEntries(await Promise.all(
  SUPPORTED_LOCALES.map(async (locale) => [locale, await loadLocaleText(locale)] as const),
)) as Record<Locale, UiText>;

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

test("production locale copy packages keep the same key structure", () => {
  const sourceShape = collectCopyKeyPaths(COPY["zh-CN"]).sort();
  for (const locale of SUPPORTED_LOCALES) {
    assert.deepEqual(collectCopyKeyPaths(COPY[locale]).sort(), sourceShape);
  }
});
