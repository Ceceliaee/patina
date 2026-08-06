import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { LOCALE_METADATA, type Locale, type UiText } from "./generated/contract.ts";
import { getLocaleText } from "./runtime.ts";

interface LocaleContextValue {
  locale: Locale;
  text: UiText;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<LocaleContextValue>(() => ({ locale, text: getLocaleText(locale) }), [locale]);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = LOCALE_METADATA[locale].direction;
  }, [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

function useLocaleContext(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("LocaleProvider is required for localized UI");
  return value;
}

export function useLocaleText(): UiText {
  return useLocaleContext().text;
}

export function useLocale(): Locale {
  return useLocaleContext().locale;
}
