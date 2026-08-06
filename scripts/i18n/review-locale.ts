import { readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LOCALE_REGISTRY } from "../../locales/registry.ts";
import { LOCALE_SOURCE_REVIEWS } from "../../locales/review-manifest.ts";
import {
  REPO_ROOT,
  loadLocaleMessages,
  sourceHash,
  sourceLocale,
  validateLocaleBundle,
} from "./core.ts";

function usage(): never {
  throw new Error("Usage: npm run i18n:review -- <locale-tag> (--all | --key <message-key>)");
}

const args = process.argv.slice(2);
const locale = args[0];
if (!locale || !(locale in LOCALE_REGISTRY) || locale === sourceLocale()) usage();
const reviewAll = args.includes("--all");
const keyIndex = args.indexOf("--key");
const selectedKey = keyIndex >= 0 ? args[keyIndex + 1] : undefined;
if (reviewAll === Boolean(selectedKey)) usage();

const targetMessages = await loadLocaleMessages(locale);
validateLocaleBundle(locale, targetMessages);
const sourceMessages = await loadLocaleMessages(sourceLocale());
const keys = reviewAll ? Object.keys(sourceMessages) : [selectedKey!];
for (const key of keys) {
  if (!Object.hasOwn(sourceMessages, key)) throw new Error(`Unknown message key: ${key}`);
}

const reviews = structuredClone(LOCALE_SOURCE_REVIEWS) as Record<string, Record<string, string>>;
const localeReviews = reviews[locale];
if (!localeReviews) throw new Error(`${locale}: missing pending review manifest`);
for (const key of keys) localeReviews[key] = sourceHash(sourceMessages[key]);

const path = join(REPO_ROOT, "locales", "review-manifest.ts");
const temporaryPath = `${path}.review.tmp`;
const output = `// Source-locale hashes explicitly accepted by each translation locale.\nexport const LOCALE_SOURCE_REVIEWS = ${JSON.stringify(reviews, null, 2)} as const;\n`;
rmSync(temporaryPath, { force: true });
try {
  // Read first so a missing or unreadable manifest is never replaced with a fresh file.
  readFileSync(path, "utf8");
  writeFileSync(temporaryPath, output, "utf8");
  renameSync(temporaryPath, path);
} finally {
  rmSync(temporaryPath, { force: true });
}
console.log(`Reviewed ${keys.length} ${locale} translation entries against the current ${sourceLocale()} source.`);
