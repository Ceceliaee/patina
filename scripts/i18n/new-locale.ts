import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { LOCALE_REGISTRY } from "../../locales/registry.ts";
import { LOCALES_ROOT, PENDING_REVIEW, REPO_ROOT, loadLocaleMessages } from "./core.ts";

export function validateLocaleTag(tag: string): string {
  const canonical = Intl.getCanonicalLocales(tag)[0];
  if (!canonical || canonical !== tag) throw new Error(`Use the canonical locale tag ${canonical ?? tag}`);
  return canonical;
}

function usage(): never { throw new Error("Usage: npm run i18n:new -- <locale-tag> <native-label> [--from <locale>] [--direction ltr|rtl]"); }

type NewLocaleOptions = {
  direction: "ltr" | "rtl";
  dryRun: boolean;
  label: string;
  source: string;
  tag: string;
};

export function parseNewLocaleOptions(args: string[], defaultSource: string): NewLocaleOptions {
  const tag = args[0] ? validateLocaleTag(args[0]) : usage();
  const label = args[1] && !args[1].startsWith("--") ? args[1].trim() : usage();
  if (!label) usage();
  const knownFlags = new Set(["--from", "--direction", "--dry-run"]);
  for (let index = 2; index < args.length; index += 1) {
    const value = args[index];
    if (!knownFlags.has(value)) throw new Error(`Unknown option: ${value}`);
    if (value !== "--dry-run") index += 1;
  }
  const fromIndex = args.indexOf("--from");
  const source = fromIndex >= 0 ? args[fromIndex + 1] : defaultSource;
  if (!source || source.startsWith("--")) usage();
  const directionIndex = args.indexOf("--direction");
  const direction = directionIndex >= 0 ? args[directionIndex + 1] : "ltr";
  if (direction !== "ltr" && direction !== "rtl") throw new Error("Direction must be ltr or rtl");
  return { direction, dryRun: args.includes("--dry-run"), label, source, tag };
}

function atomicWrite(path: string, contents: string): void {
  const temporaryPath = `${path}.i18n-new-locale.tmp`;
  rmSync(temporaryPath, { force: true });
  try {
    writeFileSync(temporaryPath, contents, "utf8");
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

interface LocaleTransaction {
  originalRegistry: string;
  originalReview: string;
  nextRegistry: string;
  nextReview: string;
  registryPath: string;
  reviewPath: string;
  sourceRoot: string;
  stagingRoot: string;
  targetRoot: string;
}

export function applyLocaleTransaction(transaction: LocaleTransaction, failAfter?: "resources" | "review" | "registry"): void {
  const { originalRegistry, originalReview, nextRegistry, nextReview, registryPath, reviewPath, sourceRoot, stagingRoot, targetRoot } = transaction;
  if (existsSync(stagingRoot)) throw new Error(`Stale locale staging directory exists: ${stagingRoot}`);
  const lockPath = join(dirname(registryPath), ".i18n-locale.lock");
  let lockHandle: number;
  try {
    lockHandle = openSync(lockPath, "wx");
    writeFileSync(lockHandle, `${process.pid}\n`, "utf8");
  } catch {
    throw new Error(`Another locale transaction is active, or a stale lock needs inspection: ${lockPath}`);
  }
  let targetCreated = false;
  let reviewChanged = false;
  let registryChanged = false;
  try {
    if (readFileSync(registryPath, "utf8") !== originalRegistry || readFileSync(reviewPath, "utf8") !== originalReview) {
      throw new Error("Locale registry or review manifest changed before the transaction acquired its lock; rebuild the operation from current files");
    }
    mkdirSync(stagingRoot, { recursive: false });
    cpSync(sourceRoot, stagingRoot, { recursive: true });
    renameSync(stagingRoot, targetRoot);
    targetCreated = true;
    if (failAfter === "resources") throw new Error("injected failure after resources");
    atomicWrite(reviewPath, nextReview);
    reviewChanged = true;
    if (failAfter === "review") throw new Error("injected failure after review");
    // Register last: an interrupted run can never expose a production locale without its resources and review state.
    atomicWrite(registryPath, nextRegistry);
    registryChanged = true;
    if (failAfter === "registry") throw new Error("injected failure after registry");
  } catch (error) {
    const rollbackErrors: unknown[] = [];
    const attempt = (rollback: () => void): void => {
      try { rollback(); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
    };
    if (registryChanged) attempt(() => atomicWrite(registryPath, originalRegistry));
    if (reviewChanged) attempt(() => atomicWrite(reviewPath, originalReview));
    if (targetCreated) attempt(() => rmSync(targetRoot, { recursive: true, force: true }));
    attempt(() => rmSync(stagingRoot, { recursive: true, force: true }));
    if (rollbackErrors.length) throw new AggregateError([error, ...rollbackErrors], "Locale transaction failed and rollback was incomplete");
    throw error;
  } finally {
    closeSync(lockHandle);
    unlinkSync(lockPath);
  }
}

export function insertRegistryEntry(source: string, entry: string): string {
  const marker = "\n} as const;";
  const index = source.lastIndexOf(marker);
  if (index < 0) throw new Error("Could not find registry insertion boundary");
  const prefix = source.slice(0, index).replace(/\s*$/, "");
  return `${prefix},\n${entry}${marker}${source.slice(index + marker.length)}`;
}

async function main(): Promise<void> {
if (process.argv.includes("--self-test")) {
  if (validateLocaleTag("ru-RU") !== "ru-RU") throw new Error("locale tag validation failed");
  try { validateLocaleTag("ru-ru"); throw new Error("noncanonical tag accepted"); } catch (error) {
    if (error instanceof Error && error.message === "noncanonical tag accepted") throw error;
  }
  const inserted = insertRegistryEntry("export const X = {\n  a: 1\n} as const;\n", "  b: 2");
  if (!inserted.includes("a: 1,\n  b: 2")) throw new Error("registry insertion failed");
  const options = parseNewLocaleOptions(["ru-RU", "Русский", "--from", "zh-CN", "--dry-run"], "en-US");
  if (options.tag !== "ru-RU" || options.source !== "zh-CN" || !options.dryRun) {
    throw new Error("new locale option parsing failed");
  }
  try { parseNewLocaleOptions(["ru-RU", "Русский", "--unknown"], "zh-CN"); throw new Error("unknown option accepted"); } catch (error) {
    if (error instanceof Error && error.message === "unknown option accepted") throw error;
  }
  const fixtureRoot = mkdtempSync(join(tmpdir(), "patina-i18n-new-locale-"));
  try {
    const sourceRoot = join(fixtureRoot, "source");
    const targetRoot = join(fixtureRoot, "target");
    const stagingRoot = join(fixtureRoot, "staging");
    const registryPath = join(fixtureRoot, "registry.ts");
    const reviewPath = join(fixtureRoot, "review.ts");
    mkdirSync(sourceRoot);
    writeFileSync(join(sourceRoot, "messages.ts"), "source", "utf8");
    writeFileSync(registryPath, "old registry", "utf8");
    writeFileSync(reviewPath, "old review", "utf8");
    for (const failAfter of ["resources", "review", "registry"] as const) {
      try {
        applyLocaleTransaction({ originalRegistry: "old registry", originalReview: "old review", nextRegistry: "new registry", nextReview: "new review", registryPath, reviewPath, sourceRoot, stagingRoot, targetRoot }, failAfter);
        throw new Error(`transaction accepted ${failAfter} failure`);
      } catch (error) {
        if (error instanceof Error && error.message === `transaction accepted ${failAfter} failure`) throw error;
      }
      if (readFileSync(registryPath, "utf8") !== "old registry" || readFileSync(reviewPath, "utf8") !== "old review" || existsSync(targetRoot) || existsSync(stagingRoot)) {
        throw new Error(`transaction did not roll back ${failAfter} failure`);
      }
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
  console.log("new locale command self-tests passed");
} else {
  const args = process.argv.slice(2);
  const sourceLocale = Object.entries(LOCALE_REGISTRY).find(([, metadata]) => metadata.source)?.[0];
  if (!sourceLocale) throw new Error("Locale registry has no source locale");
  const { direction, dryRun, label, source, tag } = parseNewLocaleOptions(args, sourceLocale);
  if (!(source in LOCALE_REGISTRY)) throw new Error(`Source locale is not registered: ${source}`);
  const sourceRoot = join(LOCALES_ROOT, source);
  const targetRoot = join(LOCALES_ROOT, tag);
  if (!existsSync(sourceRoot)) throw new Error(`Source locale does not exist: ${source}`);
  if (existsSync(targetRoot)) throw new Error(`Locale resource directory already exists: ${tag}`);
  const registryPath = join(REPO_ROOT, "locales", "registry.ts");
  const originalRegistry = readFileSync(registryPath, "utf8");
  const registryEntry = `  ${JSON.stringify(tag)}: {\n    "label": ${JSON.stringify(label)},\n    "source": false,\n    "direction": ${JSON.stringify(direction)},\n    "production": true\n  }`;
  const nextRegistry = insertRegistryEntry(originalRegistry, registryEntry);

  const sourceMessages = await loadLocaleMessages(sourceLocale);
  const reviews = Object.fromEntries(Object.keys(sourceMessages).map((key) => [key, PENDING_REVIEW]));
  const reviewPath = join(REPO_ROOT, "locales", "review-manifest.ts");
  const originalReview = readFileSync(reviewPath, "utf8");
  const reviewEntry = `  ${JSON.stringify(tag)}: ${JSON.stringify(reviews, null, 2).replace(/^/gm, "  ").trimStart()}`;
  const nextReview = insertRegistryEntry(originalReview, reviewEntry);
  const domainFileCount = cpDomainFileCount(sourceRoot);
  if (dryRun) {
    console.log(`Would create locales/${tag} from ${source} (${domainFileCount} resource files), register ${label}, and mark ${Object.keys(reviews).length} translations pending review.`);
    process.exit(0);
  }

  const stagingRoot = join(LOCALES_ROOT, `.i18n-new-${tag}`);
  applyLocaleTransaction({ originalRegistry, originalReview, nextRegistry, nextReview, registryPath, reviewPath, sourceRoot, stagingRoot, targetRoot });
  console.log(`Created and registered ${tag} (${label}) from ${source}. Translate locales/${tag}, explicitly review it with npm run i18n:review -- ${tag} --all, then generate and check.`);
}
}

if (process.argv[1] && import.meta.filename === resolve(process.argv[1])) await main();

function cpDomainFileCount(root: string): number {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .length;
}
