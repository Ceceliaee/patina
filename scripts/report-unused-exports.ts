import ts from "typescript";
import { relative, resolve } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";

interface ExportUsage {
  file: string;
  kind: string;
  line: number;
  name: string;
  usage: "internal-only" | "test-only" | "unreferenced";
  exportStart: number;
  exportEnd: number;
}

const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, "tsconfig.json");
if (!configPath) throw new Error("tsconfig.json was not found");
const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, process.cwd());
const fileNames = [...new Set([
  ...parsed.fileNames,
  ...ts.sys.readDirectory(resolve("tests"), [".ts", ".tsx"], ["**/node_modules/**"]),
  ...ts.sys.readDirectory(resolve("scripts"), [".ts", ".tsx"], ["**/node_modules/**"]),
].map((file) => resolve(file)))];
const versions = new Map(fileNames.map((file) => [file, "0"]));
const host: ts.LanguageServiceHost = {
  getCompilationSettings: () => parsed.options,
  getCurrentDirectory: () => process.cwd(),
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  getScriptFileNames: () => fileNames,
  getScriptSnapshot: (fileName) => {
    const source = ts.sys.readFile(fileName);
    return source === undefined ? undefined : ts.ScriptSnapshot.fromString(source);
  },
  getScriptVersion: (fileName) => versions.get(resolve(fileName)) ?? "0",
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
};
const service = ts.createLanguageService(host, ts.createDocumentRegistry());
const program = service.getProgram();
if (!program) throw new Error("TypeScript language service did not create a program");

function normalize(path: string) {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

function hasExportModifier(node: ts.Node) {
  return ts.canHaveModifiers(node)
    && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function declarationNames(sourceFile: ts.SourceFile) {
  const declarations: Array<{
    exportModifier: ts.Modifier;
    isDefaultExport: boolean;
    kind: string;
    name: ts.Identifier;
  }> = [];
  for (const statement of sourceFile.statements) {
    if (!ts.canHaveModifiers(statement) || !hasExportModifier(statement)) continue;
    const exportModifier = ts.getModifiers(statement)?.find(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    );
    if (!exportModifier) continue;
    const isDefaultExport = ts.getModifiers(statement)?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
    ) ?? false;
    if (
      ts.isFunctionDeclaration(statement)
      || ts.isClassDeclaration(statement)
      || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement)
    ) {
      if (statement.name) declarations.push({
        exportModifier,
        isDefaultExport,
        kind: ts.SyntaxKind[statement.kind],
        name: statement.name,
      });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          declarations.push({
            exportModifier,
            isDefaultExport,
            kind: "VariableDeclaration",
            name: declaration.name,
          });
        }
      }
    }
  }
  return declarations;
}

const dynamicallyImportedFiles = new Set<string>();
for (const sourceFile of program.getSourceFiles()) {
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
      && ts.isStringLiteralLike(node.arguments[0])
    ) {
      const resolvedModule = ts.resolveModuleName(
        node.arguments[0].text,
        sourceFile.fileName,
        parsed.options,
        ts.sys,
      ).resolvedModule;
      if (resolvedModule) dynamicallyImportedFiles.add(resolve(resolvedModule.resolvedFileName));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
}

const usages: ExportUsage[] = [];
for (const sourceFile of program.getSourceFiles()) {
  const path = normalize(sourceFile.fileName);
  if (!path.startsWith("src/") || path.includes("/generated/") || sourceFile.isDeclarationFile) continue;
  for (const declaration of declarationNames(sourceFile)) {
    if (declaration.isDefaultExport && dynamicallyImportedFiles.has(resolve(sourceFile.fileName))) {
      continue;
    }
    const groups = service.findReferences(sourceFile.fileName, declaration.name.getStart(sourceFile)) ?? [];
    const references = groups.flatMap((group) => group.references)
      .filter((reference) => !reference.isDefinition);
    const external = references.filter((reference) => resolve(reference.fileName) !== resolve(sourceFile.fileName));
    if (external.some((reference) => normalize(reference.fileName).startsWith("src/"))) continue;

    const usage: ExportUsage["usage"] = external.length > 0
      ? "test-only"
      : references.length > 0
        ? "internal-only"
        : "unreferenced";
    usages.push({
      file: path,
      kind: declaration.kind,
      line: sourceFile.getLineAndCharacterOfPosition(declaration.name.getStart(sourceFile)).line + 1,
      name: declaration.name.text,
      usage,
      exportStart: declaration.exportModifier.getStart(sourceFile),
      exportEnd: declaration.exportModifier.getEnd(),
    });
  }
}

usages.sort((left, right) => left.usage.localeCompare(right.usage)
  || left.file.localeCompare(right.file)
  || left.line - right.line);
const counts = Object.fromEntries(
  ["internal-only", "test-only", "unreferenced"].map((usage) => [
    usage,
    usages.filter((item) => item.usage === usage).length,
  ]),
);

if (process.argv.includes("--write-internal-only")) {
  const editsByFile = new Map<string, Array<{ start: number; end: number }>>();
  for (const item of usages) {
    if (item.usage !== "internal-only") continue;
    const edits = editsByFile.get(item.file) ?? [];
    if (!edits.some((edit) => edit.start === item.exportStart)) {
      edits.push({ start: item.exportStart, end: item.exportEnd });
    }
    editsByFile.set(item.file, edits);
  }
  for (const [file, edits] of editsByFile) {
    const absolute = resolve(file);
    let source = readFileSync(absolute, "utf8");
    for (const edit of edits.sort((left, right) => right.start - left.start)) {
      let end = edit.end;
      while (source[end] === " " || source[end] === "\t") end += 1;
      source = source.slice(0, edit.start) + source.slice(end);
    }
    writeFileSync(absolute, source, "utf8");
  }
  console.log(`Removed ${counts["internal-only"]} internal-only export modifiers from ${editsByFile.size} files.`);
  process.exit(0);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ counts, usages }, null, 2));
} else {
  console.log("TypeScript language-service unused export advisory");
  console.log(`internal-only=${counts["internal-only"]} test-only=${counts["test-only"]} unreferenced=${counts.unreferenced}`);
  for (const item of usages) {
    console.log(`${item.usage.padEnd(13)} ${item.file}:${item.line} ${item.kind} ${item.name}`);
  }
}
