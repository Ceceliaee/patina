import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import ExcelJS from "exceljs";
import { loadLocaleMessages, validateLocaleBundle } from "../scripts/i18n/core.ts";
import { buildTranslationKit, materializeTranslationKit } from "../scripts/i18n/translation-kit.ts";
import { readTranslationWorkbook, writeTranslationWorkbook } from "../scripts/i18n/translation-kit-workbook.ts";
import { importTranslationKit } from "../scripts/i18n/import-translation-kit.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function expectFailure(label: string, run: () => Promise<unknown> | unknown): Promise<void> {
  try {
    await run();
  } catch {
    console.log(`PASS ${label}`);
    return;
  }
  throw new Error(`Expected failure: ${label}`);
}

const root = mkdtempSync(join(tmpdir(), "patina-i18n-kit-test-"));
try {
  const source = await loadLocaleMessages("en-US");
  const kit = buildTranslationKit("en-US", "ru-RU", "Русский", "ltr", source);
  assert(kit.units.length > Object.keys(source).length, "branch and structured messages should expand into separate translation units");
  const pluralIds = kit.units.filter((unit) => unit.unitId.includes("plural:")).map((unit) => unit.unitId);
  for (const category of ["one", "few", "many", "other"]) {
    assert(pluralIds.some((id) => id.endsWith(`:${category}`) || id.includes(`:${category}|`)), `Russian kit is missing ${category} plural units`);
  }
  console.log("PASS generic target locale expands CLDR plural categories");

  const arabicKit = buildTranslationKit("en-US", "ar-EG", "العربية", "rtl", source);
  const arabicPluralIds = arabicKit.units.filter((unit) => unit.unitId.includes("plural:")).map((unit) => unit.unitId);
  for (const category of ["zero", "one", "two", "few", "many", "other"]) {
    assert(arabicPluralIds.some((id) => id.endsWith(`:${category}`) || id.includes(`:${category}|`)), `Arabic kit is missing ${category} plural units`);
  }
  assert(arabicKit.direction === "rtl" && arabicKit.targetLocale === "ar-EG", "generic kit did not preserve target metadata");
  console.log("PASS non-Russian RTL locale uses its own CLDR categories");

  const translations = new Map(kit.units.map((unit) => [unit.unitId, unit.sourceText]));
  const reorderUnit = kit.units.find((unit) => unit.placeholders.includes("⟦count⟧") && unit.sourceText.includes("⟦count⟧"));
  assert(reorderUnit, "expected a count placeholder unit");
  translations.set(reorderUnit.unitId, `⟦count⟧ ${reorderUnit.sourceText.replace("⟦count⟧", "").trim()}`);
  const materialized = materializeTranslationKit(kit, translations);
  validateLocaleBundle("ru-RU", materialized);
  console.log("PASS translated placeholders may be reordered while generated DSL remains valid");

  const workbookPath = join(root, "kit.xlsx");
  await writeTranslationWorkbook(kit, workbookPath, translations);
  const imported = await readTranslationWorkbook(workbookPath, kit);
  validateLocaleBundle("ru-RU", materializeTranslationKit(kit, imported));
  console.log("PASS XLSX export and import round trip");

  const forgedZip = readFileSync(workbookPath);
  let eocd = forgedZip.length - 22;
  while (eocd >= 0 && forgedZip.readUInt32LE(eocd) !== 0x06054b50) eocd -= 1;
  assert(eocd >= 0, "expected XLSX end-of-central-directory record");
  const firstCentralEntry = forgedZip.readUInt32LE(eocd + 16);
  assert(forgedZip.readUInt32LE(firstCentralEntry) === 0x02014b50, "expected XLSX central directory entry");
  forgedZip.writeUInt32LE(forgedZip.readUInt32LE(firstCentralEntry + 24) + 1, firstCentralEntry + 24);
  const forgedZipPath = join(root, "forged-uncompressed-size.xlsx");
  writeFileSync(forgedZipPath, forgedZip);
  await expectFailure("forged ZIP expansion metadata is rejected before workbook parsing", () => readTranslationWorkbook(forgedZipPath, kit));

  const placeholderWorkbook = new ExcelJS.Workbook();
  await placeholderWorkbook.xlsx.readFile(workbookPath);
  const translationSheet = placeholderWorkbook.getWorksheet("Translations")!;
  const placeholderRow = kit.units.findIndex((unit) => unit.unitId === reorderUnit.unitId) + 2;
  translationSheet.getCell(placeholderRow, 9).value = "placeholder removed";
  const placeholderPath = join(root, "placeholder-tampered.xlsx");
  await placeholderWorkbook.xlsx.writeFile(placeholderPath);
  const placeholderTranslations = await readTranslationWorkbook(placeholderPath, kit);
  await expectFailure("placeholder removal is rejected", () => materializeTranslationKit(kit, placeholderTranslations));

  const immutableWorkbook = new ExcelJS.Workbook();
  await immutableWorkbook.xlsx.readFile(workbookPath);
  immutableWorkbook.getWorksheet("Translations")!.getCell(2, 8).value = "changed reference text";
  const immutablePath = join(root, "immutable-tampered.xlsx");
  await immutableWorkbook.xlsx.writeFile(immutablePath);
  await expectFailure("immutable source columns cannot be changed", () => readTranslationWorkbook(immutablePath, kit));

  const metadataWorkbook = new ExcelJS.Workbook();
  await metadataWorkbook.xlsx.readFile(workbookPath);
  const manifest = metadataWorkbook.getWorksheet("_Manifest")!;
  const fingerprintRow = manifest.getColumn(1).values.findIndex((value) => value === "sourceFingerprint");
  manifest.getCell(fingerprintRow, 2).value = "stale-source";
  const metadataPath = join(root, "metadata-tampered.xlsx");
  await metadataWorkbook.xlsx.writeFile(metadataPath);
  await expectFailure("stale translation kit metadata is rejected", () => readTranslationWorkbook(metadataPath, kit));

  const formulaWorkbook = new ExcelJS.Workbook();
  await formulaWorkbook.xlsx.readFile(workbookPath);
  formulaWorkbook.getWorksheet("Translations")!.getCell(2, 9).value = { formula: "1+1", result: 2 };
  const formulaPath = join(root, "formula-target.xlsx");
  await formulaWorkbook.xlsx.writeFile(formulaPath);
  await expectFailure("formula content is rejected from translation cells", () => readTranslationWorkbook(formulaPath, kit));

  const richTextWorkbook = new ExcelJS.Workbook();
  await richTextWorkbook.xlsx.readFile(workbookPath);
  richTextWorkbook.getWorksheet("Translations")!.getCell(2, 9).value = { richText: [{ text: kit.units[0].sourceText }] };
  const richTextPath = join(root, "rich-text-target.xlsx");
  await richTextWorkbook.xlsx.writeFile(richTextPath);
  await expectFailure("rich text is rejected from translation cells", () => readTranslationWorkbook(richTextPath, kit));

  const externalLinkWorkbook = new ExcelJS.Workbook();
  await externalLinkWorkbook.xlsx.readFile(workbookPath);
  externalLinkWorkbook.getWorksheet("Instructions")!.getCell("B2").value = { text: "Русский", hyperlink: "file:///C:/Windows/System32/calc.exe" };
  const externalLinkPath = join(root, "external-link.xlsx");
  await externalLinkWorkbook.xlsx.writeFile(externalLinkPath);
  await expectFailure("external workbook relationships are rejected", () => readTranslationWorkbook(externalLinkPath, kit));

  const definedNameWorkbook = new ExcelJS.Workbook();
  await definedNameWorkbook.xlsx.readFile(workbookPath);
  definedNameWorkbook.definedNames.add("Translations!$A$1", "UnexpectedName");
  const definedNamePath = join(root, "defined-name.xlsx");
  await definedNameWorkbook.xlsx.writeFile(definedNamePath);
  await expectFailure("defined names are rejected regardless of XML namespace prefixes", () => readTranslationWorkbook(definedNamePath, kit));

  const identityWorkbook = new ExcelJS.Workbook();
  await identityWorkbook.xlsx.readFile(workbookPath);
  const identityManifest = identityWorkbook.getWorksheet("_Manifest")!;
  const targetRow = identityManifest.getColumn(1).values.findIndex((value) => value === "targetLocale");
  identityManifest.getCell(targetRow, 2).value = "uk-UA";
  const identityPath = join(root, "identity-tampered.xlsx");
  await identityWorkbook.xlsx.writeFile(identityPath);
  await expectFailure("workbook identity cannot override explicit maintainer expectations", () => importTranslationKit({
    apply: false,
    direction: "ltr",
    expectedSource: "en-US",
    input: identityPath,
    label: "Русский",
    output: join(root, "identity-output"),
    target: "ru-RU",
  }));
} finally {
  rmSync(root, { recursive: true, force: true });
}
