import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { LOCALE_METADATA, type Locale, type UiText } from "./generated/contract.ts";
import { SOURCE_LOCALE } from "./generated/resources.ts";
import { getLoadedLocaleText, getLocaleText, resolveLocaleActivation } from "./runtime.ts";

interface LocaleContextValue {
  locale: Locale;
  text: UiText;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({
  locale,
  children,
  onLocaleLoadError,
}: {
  locale: Locale;
  children: ReactNode;
  onLocaleLoadError?: (locale: Locale, error: unknown) => void;
}) {
  const [value, setValue] = useState<LocaleContextValue | null>(() => {
    const text = getLoadedLocaleText(locale);
    return text ? { locale, text } : null;
  });
  const onLocaleLoadErrorRef = useRef(onLocaleLoadError);

  useEffect(() => {
    onLocaleLoadErrorRef.current = onLocaleLoadError;
  }, [onLocaleLoadError]);

  useEffect(() => {
    const loaded = getLoadedLocaleText(locale);
    if (loaded) {
      setValue((current) => (
        current?.locale === locale && current.text === loaded
          ? current
          : { locale, text: loaded }
      ));
      return undefined;
    }

    let currentRequest = true;
    void resolveLocaleActivation(locale, () => currentRequest).then((result) => {
      if (result.status === "ready") {
        setValue({ locale: result.locale, text: result.text });
        return;
      }
      if (result.status === "failed") {
        console.error(`[i18n] failed to load locale ${result.locale}`, result.error);
        onLocaleLoadErrorRef.current?.(result.locale, result.error);
        setValue((current) => current ?? {
          locale: SOURCE_LOCALE,
          text: getLocaleText(SOURCE_LOCALE),
        });
      }
    });
    return () => {
      currentRequest = false;
    };
  }, [locale]);

  useLayoutEffect(() => {
    if (!value) return;
    document.documentElement.lang = value.locale;
    document.documentElement.dir = LOCALE_METADATA[value.locale].direction;
  }, [value]);

  if (!value) return null;
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
