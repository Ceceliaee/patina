import { COPY } from "./bundle.ts";
import type { UiLanguage, UiText } from "./types.ts";

let activeUiLanguage: UiLanguage = "zh-CN";

export function getUiText(language: UiLanguage): UiText {
  return COPY[language];
}

export function getUiTextLanguage(): UiLanguage {
  return activeUiLanguage;
}

export function getUiLocale(): UiLanguage {
  return activeUiLanguage;
}

export function setUiTextLanguage(language: UiLanguage): void {
  activeUiLanguage = language;
}

export const UI_TEXT: UiText = new Proxy({} as UiText, {
  get(_target, prop: keyof UiText) {
    const value = COPY[activeUiLanguage][prop];
    if (value === undefined) {
      console.warn(`[UI_TEXT] Missing key "${String(prop)}" in locale "${activeUiLanguage}"`);
    }
    return value;
  },
});
