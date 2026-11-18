import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  LOCALES_ROOT,
  RUST_GENERATED_PATH,
  loadAndValidateProductionLocales,
  schemaEntriesBySurface,
  sourceLocale,
  stableStringify,
  type MessageDescriptor,
  type MessageValue,
} from "./core.ts";
import { LOCALE_REGISTRY } from "../../locales/registry.ts";
import { MESSAGE_SCHEMA } from "../../locales/schema.ts";
import { MESSAGES as RUSSIAN_FIXTURE } from "../../locales/fixtures/ru-RU/plurals.ts";

function rustString(value: string): string {
  return JSON.stringify(value).replaceAll("\\u2028", "\\u{2028}").replaceAll("\\u2029", "\\u{2029}");
}

function rustLocaleVariant(locale: string): string {
  return locale.split(/[^A-Za-z0-9]+/).map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`).join("");
}

function renderRustExpression(expression: unknown, locale: string): string {
  if (typeof expression === "string") return `NativeExpr::Literal(${rustString(expression)})`;
  if (!expression || typeof expression !== "object" || Array.isArray(expression)) throw new Error("Native messages only support string expression nodes");
  const node = expression as Record<string, unknown>;
  if (node.$op === "arg" && typeof node.name === "string") return `NativeExpr::Arg(${rustString(node.name)})`;
  if (node.$op === "concat" && Array.isArray(node.parts)) {
    return `NativeExpr::Concat(&[${node.parts.map((part) => renderRustExpression(part, locale)).join(", ")}])`;
  }
  if (node.$op === "if") {
    const test = node.when as { $op?: string; left?: { $op?: string; name?: string }; right?: string | number };
    if (test?.$op === "eq" && test.left?.$op === "arg" && typeof test.left.name === "string" && (typeof test.right === "string" || typeof test.right === "number")) {
      return `NativeExpr::IfEqual(${rustString(test.left.name)}, ${rustString(String(test.right))}, &${renderRustExpression(node.then, locale)}, &${renderRustExpression(node.else, locale)})`;
    }
  }
  if (node.$op === "plural" && typeof node.arg === "string" && node.cases && typeof node.cases === "object" && !Array.isArray(node.cases)) {
    const cases = Object.entries(node.cases as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([category, value]) => `(${rustString(category)}, ${renderRustExpression(value, locale)})`)
      .join(", ");
    return `NativeExpr::Plural { arg: ${rustString(node.arg)}, cases: &[${cases}] }`;
  }
  if (node.$op === "monthName") {
    const month = node.zeroBasedMonth as { $op?: string; left?: { $op?: string; name?: string }; right?: number };
    if (month?.$op === "subtract" && month.left?.$op === "arg" && typeof month.left.name === "string" && month.right === 1) {
      const formatter = new Intl.DateTimeFormat(locale, { month: node.style === "long" ? "long" : "short", timeZone: "UTC" });
      let expression = `NativeExpr::Literal("")`;
      for (let i = 12; i >= 1; i--) {
        const name = formatter.format(new Date(Date.UTC(2020, i - 1, 1)));
        expression = `NativeExpr::IfEqual(${rustString(month.left.name)}, ${rustString(String(i))}, &NativeExpr::Literal(${rustString(name)}), &${expression})`;
      }
      return expression;
    }
  }
  throw new Error(`Native generated message uses unsupported op ${String(node.$op)}`);
}

function nativeExpression(value: MessageValue, locale: string): string {
  if (typeof value === "string") return renderRustExpression(value, locale);
  if (value && typeof value === "object" && !Array.isArray(value) && (value as MessageDescriptor).$type === "message") {
    return renderRustExpression((value as MessageDescriptor).body, locale);
  }
  throw new Error("Native message must be a string or supported expression descriptor");
}

function renderRustResources(allMessages: Record<string, Record<string, MessageValue>>): string {
  const nativeEntries = schemaEntriesBySurface("native");
  const nativeKeys = nativeEntries.filter(([, entry]) => entry.kind !== "data" && entry.kind !== "string-array").map(([key]) => key).sort();
  const arms: string[] = [];
  for (const locale of Object.keys(LOCALE_REGISTRY)) {
    const variant = `Locale::${rustLocaleVariant(locale)}`;
    for (const key of nativeKeys) {
      const value = allMessages[locale][key];
      const entry = MESSAGE_SCHEMA[key as keyof typeof MESSAGE_SCHEMA];
      if (entry.kind === "string-record") {
        for (const [field, message] of Object.entries(value as Record<string, string>)) {
          arms.push(`        (${variant}, ${rustString(`${key}.${field}`)}) => Some(${nativeExpression(message, locale)}),`);
        }
      } else {
        arms.push(`        (${variant}, ${rustString(key)}) => Some(${nativeExpression(value, locale)}),`);
      }
    }
  }
  const russianCases = (RUSSIAN_FIXTURE["fixture.cases"] as readonly string[]).map((entry) => {
    const [value, category] = entry.split(":");
    return `    (${value}_i64, ${rustString(category)}),`;
  }).join("\n");
  const russianMessage = RUSSIAN_FIXTURE["fixture.cardinal"] as MessageDescriptor;
  const locales = Object.keys(LOCALE_REGISTRY);
  const canonicalSourceLocale = sourceLocale();
  const variants = locales.map((locale) => `    ${locale === canonicalSourceLocale ? "#[default]\n    " : ""}${rustLocaleVariant(locale)},`).join("\n");
  const parsers = locales.map((locale) => `            Some(value) if value.eq_ignore_ascii_case(${rustString(locale)}) => Self::${rustLocaleVariant(locale)},`).join("\n");
  const tags = locales.map((locale) => `            Self::${rustLocaleVariant(locale)} => ${rustString(locale)},`).join("\n");
  return `// Generated by scripts/i18n/generate.ts. Do not edit.\n\nuse super::NativeExpr;\n\n#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize, serde::Deserialize)]\npub enum Locale {\n${variants}\n}\n\npub const SOURCE_LOCALE: Locale = Locale::${rustLocaleVariant(canonicalSourceLocale)};\n\nimpl Locale {\n    pub fn from_tag(raw: Option<&str>) -> Self {\n        match raw.map(str::trim) {\n${parsers}\n            Some(value) if !value.is_empty() => {\n                eprintln!("[i18n] unsupported locale {value:?}; falling back to ${canonicalSourceLocale}");\n                SOURCE_LOCALE\n            }\n            _ => SOURCE_LOCALE,\n        }\n    }\n\n    pub fn tag(self) -> &'static str {\n        match self {\n${tags}\n        }\n    }\n}\n\n#[cfg(test)]\npub(super) const RUSSIAN_CARDINAL_CASES: &[(i64, &str)] = &[\n${russianCases}\n];\n\n#[cfg(test)]\n#[rustfmt::skip]\npub(super) const RUSSIAN_CARDINAL_MESSAGE: NativeExpr = ${renderRustExpression(russianMessage.body, "ru-RU")};\n\n#[rustfmt::skip]\npub(super) fn lookup(locale: Locale, key: &str) -> Option<NativeExpr> {\n    match (locale, key) {\n${arms.join("\n")}\n        _ => None,\n    }\n}\n`;
}

function renderRustData(allMessages: Record<string, Record<string, MessageValue>>): string {
  const dataKeys = schemaEntriesBySurface("native").filter(([, entry]) => (entry.kind === "data" || entry.kind === "string-array")).map(([key]) => key).sort();
  const arms: string[] = [];
  for (const locale of Object.keys(LOCALE_REGISTRY)) {
    const variant = `Locale::${rustLocaleVariant(locale)}`;
    for (const key of dataKeys) {
      arms.push(`        (${variant}, ${rustString(key)}) => Some(${rustString(JSON.stringify(allMessages[locale][key]))}),`);
    }
  }
  return `// Generated by scripts/i18n/generate.ts. Do not edit.\n\nuse crate::domain::localization::Locale;\n\n#[rustfmt::skip]\npub(super) fn lookup_data(locale: Locale, key: &str) -> Option<&'static str> {\n    match (locale, key) {\n${arms.join("\n")}\n        _ => None,\n    }\n}\n`;
}

function expectedFiles(allMessages: Record<string, Record<string, MessageValue>>): Record<string, string> {
  return {
    [RUST_GENERATED_PATH]: renderRustResources(allMessages),
    [join(dirname(RUST_GENERATED_PATH), "generated_data.rs")]: renderRustData(allMessages),
  };
}

export async function generateI18n(write: boolean): Promise<void> {
  const messages = await loadAndValidateProductionLocales();
  const files = expectedFiles(messages);
  const stale: string[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (write) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    } else {
      let current = "";
      try { current = readFileSync(path, "utf8"); } catch { /* reported as stale */ }
      if (current !== content) stale.push(path);
    }
  }
  if (stale.length > 0) throw new Error(`Generated i18n output is stale:\n${stale.join("\n")}\nRun pnpm run i18n:generate.`);
  if (write) console.log(`Generated ${Object.keys(MESSAGE_SCHEMA).length} locale contract entries from ${LOCALES_ROOT}`);
  else console.log(`i18n contract and generated output are current (${stableStringify(Object.keys(files))})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await generateI18n(process.argv.includes("--write"));
}
