import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { LOCALE_REGISTRY } from "../../locales/registry.ts";
import {
  LOCALES_ROOT,
  PENDING_REVIEW,
  REPO_ROOT,
  loadLocaleMessages,
  sourceLocale,
  validateLocaleBundle,
  validatePureResourceFile,
  type MessageValue,
} from "./core.ts";
import { applyLocaleTransaction, insertRegistryEntry } from "./new-locale.ts";
import { buildTranslationKit, materializeTranslationKit, type TranslationDirection } from "./translation-kit.ts";
import { readTranslationWorkbook, readTranslationWorkbookMetadata } from "./translation-kit-workbook.ts";

interface ImportOptions {
  apply: boolean;
  direction: TranslationDirection;
  expectedSource: string;
  input: string;
  label: string;
  output?: string;
  target: string;
}

export function parseImportOptions(args: string[]): ImportOptions {
  const input = args[0] && !args[0].startsWith("--") ? resolve(args[0]) : "";
  const usage = "Usage: npm run i18n:import-kit -- <translation-kit.xlsx> --target <locale> --label <native-label> --direction <ltr|rtl> --from <locale> [--output <directory> | --apply]";
  if (!input) throw new Error(usage);
  const known = new Set(["--output", "--apply", "--target", "--label", "--direction", "--from"]);
  let output: string | undefined;
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    if (!known.has(flag)) throw new Error(`Unknown import option ${flag}`);
    if (flag !== "--apply") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      if (values.has(flag)) throw new Error(`Duplicate import option ${flag}`);
      values.set(flag, value);
      if (flag === "--output") output = resolve(value);
    }
  }
  const apply = args.includes("--apply");
  if (apply && output) throw new Error("Use either --apply or --output, not both");
  const target = values.get("--target") ?? "";
  const label = values.get("--label")?.trim() ?? "";
  const direction = values.get("--direction") as TranslationDirection | undefined;
  const expectedSource = values.get("--from") ?? "";
  if (!target || Intl.getCanonicalLocales(target)[0] !== target || !label || (direction !== "ltr" && direction !== "rtl") || !expectedSource) throw new Error(usage);
  return { apply, direction, expectedSource, input, label, output, target };
}

async function sourceBundleMapping(locale: string): Promise<Map<string, string>> {
  const mapping = new Map<string, string>();
  const root = join(LOCALES_ROOT, locale);
  for (const file of readdirSync(root).filter((name) => name.endsWith(".ts")).sort()) {
    const path = join(root, file);
    validatePureResourceFile(path);
    const module = await import(`${pathToFileURL(path).href}?translation-kit=${Date.now()}-${file}`) as { MESSAGES: Record<string, MessageValue> };
    for (const key of Object.keys(module.MESSAGES)) {
      if (mapping.has(key)) throw new Error(`${locale}: duplicate source key ${key}`);
      mapping.set(key, file);
    }
  }
  return mapping;
}

async function writeLocaleDirectory(target: string, source: string, messages: Record<string, MessageValue>, output: string): Promise<void> {
  if (existsSync(output)) throw new Error(`Output directory already exists: ${output}`);
  mkdirSync(output, { recursive: true });
  const mapping = await sourceBundleMapping(source);
  const bundles = new Map<string, Record<string, MessageValue>>();
  for (const [key, value] of Object.entries(messages)) {
    const file = mapping.get(key);
    if (!file) throw new Error(`Reference locale has no bundle owner for ${key}`);
    const bundle = bundles.get(file) ?? {};
    bundle[key] = value;
    bundles.set(file, bundle);
  }
  for (const [file, bundle] of [...bundles].sort(([left], [right]) => left.localeCompare(right))) {
    const domain = basename(file, ".ts");
    const contents = `// ${target} ${domain} locale resource. Pure data only.\nexport const MESSAGES = ${JSON.stringify(bundle, null, 2)} as const;\n`;
    writeFileSync(join(output, file), contents, "utf8");
  }
}

async function applyLocale(target: string, label: string, direction: TranslationDirection, generatedRoot: string): Promise<void> {
  if (target in LOCALE_REGISTRY) throw new Error(`Locale is already registered: ${target}`);
  const targetRoot = join(LOCALES_ROOT, target);
  if (existsSync(targetRoot)) throw new Error(`Locale resource directory already exists: ${targetRoot}`);
  const registryPath = join(LOCALES_ROOT, "registry.ts");
  const reviewPath = join(LOCALES_ROOT, "review-manifest.ts");
  const originalRegistry = readFileSync(registryPath, "utf8");
  const originalReview = readFileSync(reviewPath, "utf8");
  const registryEntry = `  ${JSON.stringify(target)}: {\n    "label": ${JSON.stringify(label)},\n    "source": false,\n    "direction": ${JSON.stringify(direction)},\n    "production": true\n  }`;
  const nextRegistry = insertRegistryEntry(originalRegistry, registryEntry);
  const canonicalMessages = await loadLocaleMessages(sourceLocale());
  const reviews = Object.fromEntries(Object.keys(canonicalMessages).map((key) => [key, PENDING_REVIEW]));
  const reviewEntry = `  ${JSON.stringify(target)}: ${JSON.stringify(reviews, null, 2).replace(/^/gm, "  ").trimStart()}`;
  const nextReview = insertRegistryEntry(originalReview, reviewEntry);
  applyLocaleTransaction({
    originalRegistry,
    originalReview,
    nextRegistry,
    nextReview,
    registryPath,
    reviewPath,
    sourceRoot: generatedRoot,
    stagingRoot: join(LOCALES_ROOT, `.i18n-import-${target}`),
    targetRoot,
  });
}

export async function importTranslationKit(options: ImportOptions): Promise<string> {
  if (!existsSync(options.input)) throw new Error(`Translation workbook does not exist: ${options.input}`);
  const metadata = await readTranslationWorkbookMetadata(options.input);
  const source = options.expectedSource;
  const target = options.target;
  const label = options.label;
  const direction = options.direction;
  for (const [field, expected] of [["sourceLocale", source], ["targetLocale", target], ["nativeLabel", label], ["direction", direction]] as const) {
    if (metadata[field] !== expected) throw new Error(`Workbook ${field} does not match the explicitly trusted value; expected ${expected}, received ${metadata[field] ?? "missing"}`);
  }
  if (!source || !(source in LOCALE_REGISTRY)) throw new Error(`Workbook reference locale is not registered: ${source ?? "missing"}`);
  const sourceMessages = await loadLocaleMessages(source);
  validateLocaleBundle(source, sourceMessages);
  const kit = buildTranslationKit(source, target, label, direction, sourceMessages);
  const translations = await readTranslationWorkbook(options.input, kit);
  const messages = materializeTranslationKit(kit, translations);
  validateLocaleBundle(target, messages);

  if (options.apply) {
    const temporaryRoot = mkdtempSync(join(tmpdir(), `patina-i18n-${target}-`));
    const generatedRoot = join(temporaryRoot, target);
    try {
      await writeLocaleDirectory(target, source, messages, generatedRoot);
      await applyLocale(target, label, direction, generatedRoot);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
    console.log(`Imported and registered ${target}. Review the locale in-app, then run npm run i18n:review -- ${target} --all.`);
    return join(LOCALES_ROOT, target);
  }

  const output = options.output ?? join(REPO_ROOT, "artifacts", "i18n", "imported", target);
  await writeLocaleDirectory(target, source, messages, output);
  console.log(`Validated ${translations.size} translated units and wrote reviewable ${target} resources to ${output}. No production locale was registered.`);
  return output;
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  await importTranslationKit(parseImportOptions(process.argv.slice(2)));
}
