import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deriveTheme } from "../src/shared/theme/deriveTheme.ts";
import { effectiveThemeContrast, getThemePreset, normalizeThemeContrast, type ThemeVariant } from "../src/shared/theme/themePresets.ts";
import { COLOR_SCHEME_OPTIONS } from "../src/shared/settings/colorSchemeOptions.ts";
import type { ColorScheme } from "../src/shared/settings/appSettings.ts";
import { normalizeSettingsRecord, buildAppSettingMutations, buildRawAppSettingsPatch } from "../src/platform/persistence/appSettingsStore.ts";
import { normalizeWidgetBootstrapSettings } from "../src/shared/settings/appSettingsNormalization.ts";

// Expected values come from the original installed Codex functions, not deriveTheme.
const fixtures = JSON.parse(readFileSync(new URL("./fixtures/theme/codex-colors.json", import.meta.url), "utf8")) as Array<{
  variant: ThemeVariant; scheme: ColorScheme; contrast: number; expected: Record<string, string>;
}>;
for (const fixture of fixtures) {
  const actual = deriveTheme(fixture.variant, fixture.scheme, fixture.contrast);
  for (const [key, expected] of Object.entries(fixture.expected)) {
    assert.equal(actual[key], expected, `${fixture.variant}/${fixture.scheme}/${fixture.contrast}/${key}`);
  }
}
for (const variant of ["light", "dark"] as const) {
  for (const option of COLOR_SCHEME_OPTIONS[variant]) {
    const expected = option.value === "vercel" ? (variant === "light" ? 40 : 50) : (variant === "light" ? 45 : 60);
    assert.equal(effectiveThemeContrast(variant, option.value, null), expected);
    assert.equal(getThemePreset(variant, option.value).surface, option.swatches[0]);
    assert.equal(deriveTheme(variant, option.value, null)["--qp-text-on-accent"], "rgb(255, 255, 255)");
    for (const contrast of [0, expected, 100]) {
      const colors = deriveTheme(variant, option.value, contrast);
      assert.ok(Object.values(colors).every((color) => !/NaN|undefined/.test(color)));
    }
  }
}
for (const invalid of [null, undefined, "40", NaN, Infinity, -1, 101, 0.5]) {
  assert.equal(normalizeThemeContrast(invalid), null);
}
assert.equal(normalizeThemeContrast(0), 0);
assert.equal(normalizeThemeContrast(100), 100);
// Removed customization fields must not affect normalized settings.
const main = normalizeSettingsRecord({ theme_mode: "dark", color_scheme_dark: "catppuccin", theme_contrast_light: "0", theme_contrast_dark: "73" });
assert.equal("themeContrastLight" in main, false);
assert.equal("themeContrastDark" in main, false);
assert.deepEqual(buildAppSettingMutations(buildRawAppSettingsPatch({ colorSchemeLight: "vercel" })), [{ key: "color_scheme_light", value: "vercel" }]);
const widget = normalizeWidgetBootstrapSettings({ trackingPaused: null, themeMode: "dark", language: null, colorSchemeLight: "vercel", colorSchemeDark: "catppuccin" });
assert.deepEqual(deriveTheme("dark", widget.colorSchemeDark, null), deriveTheme("dark", main.colorSchemeDark, null));

// Nested cards need a distinct surface at each preset's normal contrast.
const channels = (color: string) => color.startsWith("#")
  ? color.slice(1).match(/../g)!.map(value => Number.parseInt(value, 16))
  : color.match(/\d+/g)!.map(Number);
for (const scheme of ["default", "absolutely", "catppuccin", "vercel"] as const) {
  for (const variant of ["light", "dark"] as const) {
    const colors = deriveTheme(variant, scheme, null);
    const panel = channels(colors["--qp-bg-panel"]);
    const card = channels(colors["--qp-bg-elevated"]);
    const separation = panel.reduce((sum, value, index) => sum + Math.abs(value - card[index]), 0) / 3;
    assert.ok(card.reduce((sum, value) => sum + value, 0) < panel.reduce((sum, value) => sum + value, 0), `${variant}/${scheme}: nested card must be darker than its panel`);
    assert.ok(separation >= 5, `${variant}/${scheme}: nested cards must remain distinct from their panel (${separation})`);
  }
}

console.log(`Theme derivation passed: ${fixtures.length} independent Codex fixtures, all presets, persistence and widget normalization`);

const borders = JSON.parse(readFileSync(new URL("./fixtures/theme/patina-borders.json", import.meta.url), "utf8")) as Array<{variant: ThemeVariant; scheme: ColorScheme; subtle: string; strong: string}>;
for (const fixture of borders) {
  const actual = deriveTheme(fixture.variant, fixture.scheme, null);
  assert.equal(actual["--qp-border-subtle"], fixture.subtle);
  assert.equal(actual["--qp-border-strong"], fixture.strong);
}

assert.equal(deriveTheme("light", "default", null)["--qp-bg-elevated"], "#f5f5f5");

const controls = JSON.parse(readFileSync(new URL("./fixtures/theme/patina-controls.json", import.meta.url), "utf8")) as Array<{variant: ThemeVariant; scheme: ColorScheme; expected: Record<string, string>}>;
for (const fixture of controls) {
  const actual = deriveTheme(fixture.variant, fixture.scheme, null);
  for (const [key, expected] of Object.entries(fixture.expected)) assert.equal(actual[key], expected, `${fixture.variant}/${fixture.scheme}/${key}`);
}

assert.equal(deriveTheme("light", "default", null)["--qp-chart-track"], "rgba(23, 23, 23, 0.049)");
assert.equal(deriveTheme("dark", "default", null)["--qp-chart-track"], "rgba(209, 213, 220, 0.052)");
assert.equal(deriveTheme("light", "default", null)["--qp-track-muted"], "#e6e6e6");
assert.equal(deriveTheme("dark", "default", null)["--qp-track-muted"], "#484848");
