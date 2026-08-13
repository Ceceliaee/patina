import {
  FRONTEND_LOCALE_LOADERS,
  FRONTEND_MESSAGE_KEYS,
  FRONTEND_MESSAGE_PARAMS,
  FRONTEND_SOURCE_RESOURCES,
  SOURCE_LOCALE,
} from "./generated/resources.ts";
import type { Locale, UiText } from "./generated/contract.ts";

type RuntimeValue = string | number | boolean | null | undefined | readonly RuntimeValue[];
type RuntimeArgs = Record<string, RuntimeValue>;
type ExpressionNode = Record<string, unknown>;

const localeTextCache = new Map<Locale, UiText>();
const localeTextLoadCache = new Map<Locale, Promise<UiText>>();
const pluralRulesCache = new Map<Locale, Intl.PluralRules>();
const monthFormatCache = new Map<string, Intl.DateTimeFormat>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();
const dateFormatCache = new Map<string, Intl.DateTimeFormat>();

function display(value: RuntimeValue | object): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function cardinalPluralCategory(locale: string, value: number): Intl.LDMLPluralRule {
  let rules = pluralRulesCache.get(locale as Locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale, { type: "cardinal" });
    pluralRulesCache.set(locale as Locale, rules);
  }
  return rules.select(value);
}

function evaluate(expression: unknown, locale: Locale, args: RuntimeArgs): RuntimeValue | object {
  if (expression === null || ["string", "number", "boolean"].includes(typeof expression)) {
    return expression as RuntimeValue;
  }
  if (Array.isArray(expression)) return expression.map((item) => evaluate(item, locale, args)) as RuntimeValue[];
  const node = expression as ExpressionNode;
  switch (node.$op) {
    case "arg":
      return args[node.name as string];
    case "concat":
      return (node.parts as unknown[]).map((part) => display(evaluate(part, locale, args))).join("");
    case "if":
      return evaluate(evaluate(node.when, locale, args) ? node.then : node.else, locale, args);
    case "eq":
      return evaluate(node.left, locale, args) === evaluate(node.right, locale, args);
    case "notEq":
      return evaluate(node.left, locale, args) !== evaluate(node.right, locale, args);
    case "coalesce": {
      const left = evaluate(node.left, locale, args);
      return left === null || left === undefined ? evaluate(node.right, locale, args) : left;
    }
    case "subtract":
      return Number(evaluate(node.left, locale, args)) - Number(evaluate(node.right, locale, args));
    case "element": {
      const target = evaluate(node.target, locale, args);
      const index = Number(evaluate(node.index, locale, args));
      return Array.isArray(target) ? target[index] : undefined;
    }
    case "join": {
      const target = evaluate(node.target, locale, args);
      const separator = display(evaluate(node.separator, locale, args));
      return Array.isArray(target) ? target.map(display).join(separator) : "";
    }
    case "monthName": {
      const style = node.style === "short" ? "short" : "long";
      const cacheKey = `${locale}:${style}`;
      let formatter = monthFormatCache.get(cacheKey);
      if (!formatter) {
        formatter = new Intl.DateTimeFormat(locale, { month: style, timeZone: "UTC" });
        monthFormatCache.set(cacheKey, formatter);
      }
      const year = Number(evaluate(node.year, locale, args));
      const month = Number(evaluate(node.zeroBasedMonth, locale, args));
      const date = new Date(Date.UTC(year, month, 1));
      if (!Number.isFinite(year) || !Number.isInteger(month) || month < 0 || month > 11 || Number.isNaN(date.getTime())) {
        console.error(`[i18n] invalid monthName operands for ${locale}: year=${year}, month=${month}`);
        return "";
      }
      return formatter.format(date);
    }
    case "plural": {
      const value = Number(args[node.arg as string]);
      const category = cardinalPluralCategory(locale, value);
      const cases = node.cases as Record<string, unknown>;
      return evaluate(cases[category] ?? cases.other, locale, args);
    }
    default:
      throw new Error(`Unsupported generated localization expression: ${String(node.$op)}`);
  }
}

export function formatMessageDescriptor(
  locale: string,
  descriptor: { readonly $type: "message"; readonly body: unknown },
  parameterNames: readonly string[],
  values: readonly RuntimeValue[],
): string {
  const args = Object.fromEntries(parameterNames.map((name, index) => [name, values[index]]));
  return display(evaluate(descriptor.body, locale as Locale, args));
}

function assignNested(target: Record<string, unknown>, key: string, value: unknown): void {
  const segments = key.split(".");
  let cursor = target;
  for (const segment of segments.slice(0, -1)) {
    const next = cursor[segment];
    if (!next || typeof next !== "object" || Array.isArray(next)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1]] = value;
}

function compileLocale(locale: Locale, flat: readonly unknown[]): UiText {
  const output: Record<string, unknown> = {};
  for (let index = 0; index < FRONTEND_MESSAGE_KEYS.length; index += 1) {
    const key = FRONTEND_MESSAGE_KEYS[index];
    const resource = flat[index];
    const parameterNames = FRONTEND_MESSAGE_PARAMS[index] as readonly string[] | undefined;
    if (parameterNames) {
      assignNested(output, key, (...values: RuntimeValue[]) => formatMessageDescriptor(locale, { $type: "message", body: resource }, parameterNames, values));
    } else {
      assignNested(output, key, resource);
    }
  }
  return output as unknown as UiText;
}

export function getLocaleText(locale: Locale): UiText {
  const text = localeTextCache.get(locale);
  if (!text) throw new Error(`Locale ${locale} is not loaded. Call loadLocaleText(locale) first.`);
  return text;
}

export function getLoadedLocaleText(locale: Locale): UiText | null {
  return localeTextCache.get(locale) ?? null;
}

export function loadLocaleText(locale: Locale): Promise<UiText> {
  const cached = localeTextCache.get(locale);
  if (cached) return Promise.resolve(cached);
  const inFlight = localeTextLoadCache.get(locale);
  if (inFlight) return inFlight;

  const request = FRONTEND_LOCALE_LOADERS[locale]().then((flat) => {
    const text = compileLocale(locale, flat);
    localeTextCache.set(locale, text);
    return text;
  }).finally(() => {
    if (localeTextLoadCache.get(locale) === request) localeTextLoadCache.delete(locale);
  });
  localeTextLoadCache.set(locale, request);
  return request;
}

export type LocaleActivationResult =
  | { status: "ready"; locale: Locale; text: UiText }
  | { status: "stale"; locale: Locale }
  | { status: "failed"; locale: Locale; error: unknown };

export async function resolveLocaleActivation(
  locale: Locale,
  isCurrent: () => boolean,
  load: (locale: Locale) => Promise<UiText> = loadLocaleText,
): Promise<LocaleActivationResult> {
  try {
    const text = await load(locale);
    return isCurrent()
      ? { status: "ready", locale, text }
      : { status: "stale", locale };
  } catch (error) {
    return isCurrent()
      ? { status: "failed", locale, error }
      : { status: "stale", locale };
  }
}

localeTextCache.set(SOURCE_LOCALE, compileLocale(SOURCE_LOCALE, FRONTEND_SOURCE_RESOURCES));

export function formatNumber(locale: Locale, value: number, options?: Intl.NumberFormatOptions): string {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let formatter = numberFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, options);
    numberFormatCache.set(key, formatter);
  }
  return formatter.format(value);
}

export function formatDate(locale: Locale, value: Date | number, options?: Intl.DateTimeFormatOptions): string {
  const key = `${locale}:${JSON.stringify(options ?? {})}`;
  let formatter = dateFormatCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    dateFormatCache.set(key, formatter);
  }
  return formatter.format(value);
}
