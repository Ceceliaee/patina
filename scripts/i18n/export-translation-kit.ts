import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { LOCALE_REGISTRY } from "../../locales/registry.ts";
import { REPO_ROOT, loadLocaleMessages, sourceLocale, validateLocaleBundle } from "./core.ts";
import { buildTranslationKit, type TranslationDirection } from "./translation-kit.ts";
import { writeTranslationWorkbook } from "./translation-kit-workbook.ts";

interface ExportOptions {
  direction: TranslationDirection;
  label: string;
  output: string;
  source: string;
  target: string;
}

function canonicalLocale(value: string): string {
  const canonical = Intl.getCanonicalLocales(value)[0];
  if (!canonical || canonical !== value) throw new Error(`Use canonical BCP 47 locale tag ${canonical ?? value}`);
  return canonical;
}

export function parseExportOptions(args: string[]): ExportOptions {
  const target = args[0] ? canonicalLocale(args[0]) : "";
  const label = args[1] && !args[1].startsWith("--") ? args[1].trim() : "";
  if (!target || !label) throw new Error("Usage: npm run i18n:export-kit -- <target-locale> <native-label> [--from <locale>] [--direction ltr|rtl] [--output <file.xlsx>]");
  const valueAfter = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index < 0 ? undefined : args[index + 1];
  };
  const known = new Set(["--from", "--direction", "--output"]);
  for (let index = 2; index < args.length; index += 2) {
    if (!known.has(args[index]) || !args[index + 1]) throw new Error(`Invalid export option near ${args[index] ?? "end of command"}`);
  }
  const source = valueAfter("--from") ?? sourceLocale();
  const direction = valueAfter("--direction") ?? "ltr";
  if (direction !== "ltr" && direction !== "rtl") throw new Error("Direction must be ltr or rtl");
  if (!(source in LOCALE_REGISTRY)) throw new Error(`Reference locale is not registered: ${source}`);
  const output = resolve(valueAfter("--output") ?? join(REPO_ROOT, "artifacts", "i18n", `patina-${target}-from-${source}-translation-kit.xlsx`));
  return { direction, label, output, source, target };
}

export async function exportTranslationKit(options: ExportOptions): Promise<string> {
  const sourceMessages = await loadLocaleMessages(options.source);
  validateLocaleBundle(options.source, sourceMessages);
  const kit = buildTranslationKit(options.source, options.target, options.label, options.direction, sourceMessages);
  mkdirSync(dirname(options.output), { recursive: true });
  await writeTranslationWorkbook(kit, options.output);
  console.log(`Created ${options.output} with ${kit.units.length} translation units for ${options.target} from ${options.source}.`);
  return options.output;
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) {
  await exportTranslationKit(parseExportOptions(process.argv.slice(2)));
}

