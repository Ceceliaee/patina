export { LocaleProvider, useLocale, useLocaleText } from "./LocaleContext.tsx";
export {
  cardinalPluralCategory,
  formatDate,
  formatNumber,
  getLoadedLocaleText,
  getLocaleText,
  loadLocaleText,
} from "./runtime.ts";
export { LOCALE_METADATA, SUPPORTED_LOCALES } from "./generated/contract.ts";
export type { Locale, UiText } from "./generated/contract.ts";
