import ExcelJS from "exceljs";
import { readFileSync, statSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { SaxesParser } from "saxes";
import type { TranslationKit, TranslationUnit } from "./translation-kit.ts";
import { verifyImmutableUnit, verifyKitMetadata } from "./translation-kit.ts";

const TRANSLATION_COLUMNS = [
  ["status", "Status"],
  ["unitId", "Unit ID"],
  ["domain", "Area"],
  ["context", "Context"],
  ["surface", "Surface"],
  ["key", "Message key"],
  ["variant", "Variant"],
  ["sourceText", "Reference text"],
  ["translation", "Translation"],
  ["placeholders", "Required placeholders"],
  ["parameters", "Parameters"],
  ["translatorNote", "Translator note / question"],
  ["developerNote", "Developer note"],
] as const;

const GLOSSARY = [
  ["Patina", "Do not translate", "Product name."],
  ["GitHub", "Do not translate", "Service and brand name."],
  ["WebDAV", "Do not translate", "Protocol name."],
  ["CSV", "Do not translate", "File format name."],
  ["SQLite", "Do not translate", "Database and file format name."],
  ["Parquet", "Do not translate", "File format name."],
  ["Markdown", "Do not translate", "File format name."],
  ["HEX / RGB / HSL", "Do not translate", "Color notation names."],
  ["Token", "Use product context", "Connection secret shown in Web Sync settings; keep capitalization consistent."],
  ["Tracking", "Translate consistently", "Recording active desktop application time."],
  ["Session", "Translate consistently", "One continuous recorded activity interval."],
  ["Timeline", "Translate consistently", "Chronological activity visualization."],
  ["Widget", "Translate consistently", "Patina's compact side widget, not a mobile widget."],
] as const;

const MAX_XLSX_BYTES = 8 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5_000;
const BLANK_CELL = "\u00a0";
const SAFE_PART_NAMES = new Set([
  "[content_types].xml",
  "_rels/",
  "_rels/.rels",
  "docprops/",
  "docprops/app.xml",
  "docprops/core.xml",
  "xl/",
  "xl/_rels/",
  "xl/_rels/workbook.xml.rels",
  "xl/sharedstrings.xml",
  "xl/styles.xml",
  "xl/theme/",
  "xl/theme/theme1.xml",
  "xl/workbook.xml",
  "xl/worksheets/",
  "xl/worksheets/sheet1.xml",
  "xl/worksheets/sheet2.xml",
  "xl/worksheets/sheet3.xml",
  "xl/worksheets/sheet4.xml",
]);
const SAFE_RELATIONSHIP_SUFFIXES = new Set(["core-properties", "extended-properties", "officeDocument", "sharedStrings", "styles", "theme", "worksheet"]);
const SAFE_CONTENT_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.extended-properties+xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml",
  "application/vnd.openxmlformats-officedocument.theme+xml",
  "application/vnd.openxmlformats-officedocument.vmlDrawing",
  "application/vnd.openxmlformats-package.core-properties+xml",
  "application/vnd.openxmlformats-package.relationships+xml",
  "application/xml",
]);

function statusFormula(rowNumber: number): string {
  return `IF(OR(LEN(TRIM(I${rowNumber}))=0,I${rowNumber}=CHAR(160)),"TODO","TRANSLATED")`;
}

function decodeSafeXml(data: Buffer, partName: string): string {
  if ((data[0] === 0xff && data[1] === 0xfe) || (data[0] === 0xfe && data[1] === 0xff)) throw new Error(`${partName}: UTF-16 XML is not supported`);
  const bytes = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? data.subarray(3) : data;
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error(`${partName}: XML must be valid UTF-8`); }
  const encoding = xml.match(/^\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i)?.[1];
  if (encoding && !/^utf-?8$/i.test(encoding)) throw new Error(`${partName}: unsupported XML encoding ${encoding}`);
  return xml;
}

function inspectSafeXmlPart(partName: string, data: Buffer): void {
  if (!partName.endsWith(".xml") && !partName.endsWith(".rels")) return;
  const xml = decodeSafeXml(data, partName);
  const parser = new SaxesParser({ xmlns: true });
  let nodes = 0;
  parser.on("doctype", () => { throw new Error(`${partName}: XML document types are not supported`); });
  parser.on("opentag", (node) => {
    nodes += 1;
    if (nodes > 100_000) throw new Error(`${partName}: XML node limit exceeded`);
    const attributes = Object.values(node.attributes);
    if (attributes.length > 64) throw new Error(`${partName}: XML attribute limit exceeded`);
    if (partName.endsWith(".rels") && node.local === "Relationship") {
      const targetMode = attributes.find((attribute) => attribute.local === "TargetMode")?.value;
      const type = attributes.find((attribute) => attribute.local === "Type")?.value;
      const typeSuffix = type?.slice(type.lastIndexOf("/") + 1);
      if (targetMode?.toLowerCase() === "external") throw new Error(`${partName}: external relationships are not supported`);
      if (!typeSuffix || !SAFE_RELATIONSHIP_SUFFIXES.has(typeSuffix)) throw new Error(`${partName}: unsupported relationship type ${type ?? "missing"}`);
    }
    if (partName === "xl/workbook.xml" && node.local === "definedNames") throw new Error("Translation workbook defined names are not supported");
    if (partName === "[content_types].xml" && (node.local === "Default" || node.local === "Override")) {
      const contentType = attributes.find((attribute) => attribute.local === "ContentType")?.value;
      if (!contentType || !SAFE_CONTENT_TYPES.has(contentType)) throw new Error(`${partName}: unsupported content type ${contentType ?? "missing"}`);
    }
  });
  try { parser.write(xml).close(); } catch (error) {
    throw new Error(`${partName}: invalid or unsafe XML: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assertSafeXlsxContainer(path: string): void {
  const size = statSync(path).size;
  if (size > MAX_XLSX_BYTES) throw new Error(`Translation workbook exceeds ${MAX_XLSX_BYTES} byte input limit`);
  const bytes = readFileSync(path);
  const minimumEocd = 22;
  const searchStart = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let offset = bytes.length - minimumEocd; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error("Translation workbook is not a supported XLSX ZIP container");
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("ZIP64 translation workbooks are not supported");
  if (entryCount > MAX_ZIP_ENTRIES || centralOffset + centralSize > bytes.length) throw new Error("Translation workbook ZIP directory exceeds safety limits");
  let cursor = centralOffset;
  let totalUncompressed = 0;
  const entryNames = new Set<string>();
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Translation workbook ZIP directory is malformed");
    const flags = bytes.readUInt16LE(cursor + 8);
    const compressionMethod = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const declaredUncompressed = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    const entryName = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    const normalizedName = entryName.toLowerCase();
    if (!entryName || entryName.includes("\\") || entryName.includes("\0") || entryName.startsWith("/") || entryName.split("/").some((part) => part === "." || part === "..")) {
      throw new Error("Translation workbook contains an unsafe ZIP part name");
    }
    if (entryNames.has(normalizedName)) throw new Error(`Translation workbook contains a duplicate ZIP part: ${entryName}`);
    entryNames.add(normalizedName);
    if (!SAFE_PART_NAMES.has(normalizedName)) throw new Error(`Translation workbook contains an unsupported part: ${entryName}`);
    if ((flags & 0x1) !== 0) throw new Error("Encrypted translation workbook entries are not supported");
    if (compressionMethod !== 0 && compressionMethod !== 8) throw new Error(`Unsupported XLSX compression method ${compressionMethod}`);
    if (localOffset + 30 > centralOffset || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Translation workbook local ZIP entry is malformed");
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    if (localFlags !== flags || localMethod !== compressionMethod) throw new Error("Translation workbook ZIP headers are inconsistent");
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressed;
    if (dataStart > centralOffset || dataEnd > centralOffset) throw new Error("Translation workbook ZIP entry exceeds its declared boundary");
    const compressedData = bytes.subarray(dataStart, dataEnd);
    let uncompressedData: Buffer;
    try {
      const remainingBudget = Math.max(1, MAX_UNCOMPRESSED_BYTES - totalUncompressed + 1);
      uncompressedData = compressionMethod === 0
        ? compressedData
        : inflateRawSync(compressedData, { maxOutputLength: remainingBudget });
    } catch (error) {
      throw new Error(`Translation workbook entry cannot be safely decompressed: ${error instanceof Error ? error.message : String(error)}`);
    }
    const actualUncompressed = uncompressedData.length;
    if (actualUncompressed !== declaredUncompressed) throw new Error("Translation workbook ZIP entry size metadata is inconsistent");
    totalUncompressed += actualUncompressed;
    if (actualUncompressed > MAX_UNCOMPRESSED_BYTES || totalUncompressed > MAX_UNCOMPRESSED_BYTES) throw new Error("Translation workbook expands beyond the safety limit");
    if (compressed > 0 && actualUncompressed / compressed > 200) throw new Error("Translation workbook contains a suspicious compression ratio");
    inspectSafeXmlPart(normalizedName, uncompressedData);
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== centralOffset + centralSize) throw new Error("Translation workbook ZIP directory size is inconsistent");
}

function assertWorkbookStructure(workbook: ExcelJS.Workbook): void {
  const names = workbook.worksheets.map((sheet) => sheet.name).sort();
  const expected = ["Glossary", "Instructions", "Translations", "_Manifest"].sort();
  if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`Translation workbook sheets were changed: ${names.join(", ")}`);
  for (const sheet of workbook.worksheets) {
    sheet.eachRow((row, rowNumber) => row.eachCell((cell, columnNumber) => {
      const value = cell.value;
      if (!value || typeof value !== "object" || !("formula" in value)) return;
      const expectedFormula = sheet.name === "Translations" && columnNumber === 1 && rowNumber > 1
        ? statusFormula(rowNumber)
        : null;
      if (!expectedFormula || value.formula !== expectedFormula) throw new Error(`Unexpected formula in ${sheet.name}!${cell.address}`);
    }));
  }
}

function cellString(cell: ExcelJS.Cell, label: string): string {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value) === BLANK_CELL ? "" : String(value);
  throw new Error(`${label}: expected plain cell text`);
}

function styleHeader(row: ExcelJS.Row): void {
  row.height = 28;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFF7F7F5" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF333735" } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: "FF9AA09C" } } };
  });
}

function addInstructions(workbook: ExcelJS.Workbook, kit: TranslationKit): void {
  const sheet = workbook.addWorksheet("Instructions", { views: [{ showGridLines: false }] });
  sheet.columns = [{ width: 24 }, { width: 96 }];
  sheet.mergeCells("A1:B1");
  sheet.getCell("A1").value = `Patina ${kit.targetLocale} Translation Kit`;
  sheet.getCell("A1").font = { bold: true, size: 20, color: { argb: "FF202321" } };
  sheet.getCell("A1").alignment = { vertical: "middle" };
  sheet.getRow(1).height = 38;
  const rows: Array<[string, string]> = [
    ["Target language", `${kit.nativeLabel} (${kit.targetLocale}, ${kit.direction.toUpperCase()})`],
    ["Reference language", kit.sourceLocale],
    ["What to edit", "Edit only the yellow Translation and Translator note / question columns on the Translations sheet."],
    ["Placeholders", "Keep every ⟦placeholder⟧ exactly as shown. You may move placeholders to produce natural grammar."],
    ["Plural variants", "Translate every CLDR plural row separately. The Variant column identifies one, few, many, other, and any business branches."],
    ["Do not translate", "Follow the Glossary sheet. URLs, message keys, unit IDs, and technical columns are validated on import."],
    ["Empty cells", "Every Translation cell is required before final import. Use Translator note / question when context is unclear."],
    ["Line breaks", "Line breaks are allowed and preserved. Do not add formatting, formulas, HTML, or executable content."],
    ["Return format", "Return this .xlsx file without deleting, renaming, reordering, or adding translation rows."],
  ];
  sheet.addRows(rows);
  for (let index = 2; index <= rows.length + 1; index += 1) {
    sheet.getCell(index, 1).font = { bold: true, color: { argb: "FF4A504C" } };
    sheet.getCell(index, 2).alignment = { wrapText: true, vertical: "top" };
    sheet.getRow(index).height = index >= 4 ? 34 : 24;
  }
  sheet.getCell("A3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE8A3" } };
  sheet.getCell("B3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6D8" } };
}

function addGlossary(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet("Glossary", { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
  sheet.columns = [{ header: "Term", key: "term", width: 24 }, { header: "Treatment", key: "treatment", width: 24 }, { header: "Meaning / guidance", key: "guidance", width: 76 }];
  styleHeader(sheet.getRow(1));
  for (const row of GLOSSARY) sheet.addRow(row);
  sheet.autoFilter = `A1:C${GLOSSARY.length + 1}`;
  sheet.getColumn(3).alignment = { wrapText: true, vertical: "top" };
}

function addManifest(workbook: ExcelJS.Workbook, kit: TranslationKit): void {
  const sheet = workbook.addWorksheet("_Manifest", { state: "veryHidden" });
  const metadata: Record<string, string> = {
    direction: kit.direction,
    formatVersion: kit.formatVersion,
    immutableFingerprint: kit.immutableFingerprint,
    nativeLabel: kit.nativeLabel,
    schemaFingerprint: kit.schemaFingerprint,
    sourceFingerprint: kit.sourceFingerprint,
    sourceLocale: kit.sourceLocale,
    targetLocale: kit.targetLocale,
    unitCount: String(kit.units.length),
  };
  sheet.addRow(["key", "value"]);
  for (const [key, value] of Object.entries(metadata)) sheet.addRow([key, value]);
}

export async function writeTranslationWorkbook(kit: TranslationKit, path: string, initialTranslations?: ReadonlyMap<string, string>): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Patina i18n toolchain";
  workbook.created = new Date(0);
  workbook.modified = new Date(0);
  workbook.calcProperties.fullCalcOnLoad = true;
  addInstructions(workbook, kit);

  const sheet = workbook.addWorksheet("Translations", { views: [{ state: "frozen", xSplit: 2, ySplit: 1, showGridLines: false }] });
  sheet.columns = TRANSLATION_COLUMNS.map(([key, header]) => ({ key, header }));
  const widths = [14, 50, 16, 54, 16, 48, 58, 68, 68, 34, 34, 48, 48];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  styleHeader(sheet.getRow(1));
  for (const [index, unit] of kit.units.entries()) {
    const rowNumber = index + 2;
    const suppliedTranslation = initialTranslations?.get(unit.unitId);
    const initialTranslation = suppliedTranslation ?? BLANK_CELL;
    const row = sheet.addRow({
      context: unit.context,
      developerNote: unit.developerNote || BLANK_CELL,
      domain: unit.domain,
      key: unit.key,
      parameters: unit.parameters || BLANK_CELL,
      placeholders: unit.placeholders || BLANK_CELL,
      sourceText: unit.sourceText,
      surface: unit.surface,
      translation: initialTranslation,
      translatorNote: BLANK_CELL,
      unitId: unit.unitId,
      variant: unit.variant,
    });
    row.getCell(1).value = { formula: statusFormula(rowNumber), result: suppliedTranslation?.trim() ? "TRANSLATED" : "TODO" };
    row.height = 42;
    row.alignment = { vertical: "top", wrapText: true };
    row.getCell(9).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6D8" } };
    row.getCell(12).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF6D8" } };
    for (const columnNumber of [9, 10, 11, 12, 13]) {
      if (row.getCell(columnNumber).value === BLANK_CELL) row.getCell(columnNumber).numFmt = ";;;";
    }
  }
  const lastRow = kit.units.length + 1;
  sheet.autoFilter = `A1:M${lastRow}`;
  sheet.addConditionalFormatting({
    ref: `I2:I${lastRow}`,
    rules: [
      { type: "expression", priority: 1, formulae: ["OR(LEN(TRIM(I2))=0,I2=CHAR(160))"], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFFFE4E1" }, fgColor: { argb: "FFFFE4E1" } } } },
      { type: "expression", priority: 2, formulae: ["AND(LEN(TRIM(I2))>0,I2<>CHAR(160))"], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: "FFE5F2E9" }, fgColor: { argb: "FFE5F2E9" } } } },
    ],
  });
  sheet.getColumn(1).font = { bold: true, color: { argb: "FF5D625F" } };
  sheet.getColumn(2).font = { color: { argb: "FF777C79" }, size: 9 };
  sheet.getColumn(6).font = { color: { argb: "FF555B57" }, size: 9 };
  addGlossary(workbook);
  addManifest(workbook, kit);
  await workbook.xlsx.writeFile(path);
}

export async function readTranslationWorkbook(path: string, expectedKit: TranslationKit): Promise<Map<string, string>> {
  assertSafeXlsxContainer(path);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  assertWorkbookStructure(workbook);
  const manifestSheet = workbook.getWorksheet("_Manifest");
  const translationsSheet = workbook.getWorksheet("Translations");
  if (!manifestSheet || !translationsSheet) throw new Error("Translation workbook is missing Translations or _Manifest sheet");
  const metadata: Record<string, string> = {};
  manifestSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    metadata[cellString(row.getCell(1), `_Manifest!A${rowNumber}`)] = cellString(row.getCell(2), `_Manifest!B${rowNumber}`);
  });
  verifyKitMetadata(expectedKit, metadata);
  const headerByName = new Map<string, number>();
  translationsSheet.getRow(1).eachCell((cell, column) => headerByName.set(cellString(cell, `Translations!${column}1`), column));
  for (const [, header] of TRANSLATION_COLUMNS) if (!headerByName.has(header)) throw new Error(`Translations sheet is missing column ${header}`);
  const translations = new Map<string, string>();
  const actualUnits = new Map<string, Record<string, string>>();
  translationsSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: Record<string, string> = {};
    for (const [key, header] of TRANSLATION_COLUMNS) {
      if (key === "status") continue;
      values[key] = cellString(row.getCell(headerByName.get(header)!), `Translations row ${rowNumber} ${header}`);
    }
    if (!values.unitId) throw new Error(`Translations row ${rowNumber} has no Unit ID`);
    if (actualUnits.has(values.unitId)) throw new Error(`Duplicate translation unit ${values.unitId}`);
    actualUnits.set(values.unitId, values);
    translations.set(values.unitId, values.translation);
  });
  if (actualUnits.size !== expectedKit.units.length) throw new Error(`Translation row count mismatch; expected ${expectedKit.units.length}, received ${actualUnits.size}`);
  for (const expected of expectedKit.units) {
    const actual = actualUnits.get(expected.unitId);
    if (!actual) throw new Error(`Translation workbook is missing unit ${expected.unitId}`);
    verifyImmutableUnit(expected, actual);
  }
  return translations;
}

export async function readTranslationWorkbookMetadata(path: string): Promise<Record<string, string>> {
  assertSafeXlsxContainer(path);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  assertWorkbookStructure(workbook);
  const manifestSheet = workbook.getWorksheet("_Manifest");
  if (!manifestSheet) throw new Error("Translation workbook is missing _Manifest sheet");
  const metadata: Record<string, string> = {};
  manifestSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    metadata[cellString(row.getCell(1), `_Manifest!A${rowNumber}`)] = cellString(row.getCell(2), `_Manifest!B${rowNumber}`);
  });
  return metadata;
}
