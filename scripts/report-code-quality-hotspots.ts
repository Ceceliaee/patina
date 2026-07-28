import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, extname, join, normalize, relative, sep } from "node:path";
import {
  measureRustSource,
  measureTypeScriptSource,
  type StructuralMetrics,
} from "./quality/structuralMetrics.ts";

const SCAN_ROOTS = ["src", "src-tauri/src", "tests", "scripts"] as const;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".rs", ".css"]);
const TYPESCRIPT_EXTENSIONS = new Set([".ts", ".tsx"]);
const LARGE_FILE_THRESHOLDS: Record<string, number> = {
  ".ts": 500,
  ".tsx": 500,
  ".rs": 800,
  ".css": 600,
};
const MAX_ROWS = 20;
const DUPLICATE_BLOCK_SIZE = 8;

const UNREFERENCED_FILE_ALLOWLIST = [
  /^src\/main\.tsx$/,
  /^src\/App\.tsx$/,
  /^src\/vite-env\.d\.ts$/,
  /^tests\/.*\.test\.ts$/,
  /^scripts\/.*\.ts$/,
  /^src-tauri\//,
] as const;

const EXPORT_ALLOWLIST = [
  /ForTests$/,
  /^__.*Internals$/,
  /^reset.*ForTests$/,
  /^get.*ForTests$/,
] as const;

interface SourceFile {
  path: string;
  extension: string;
  content: string;
  lines: number;
  structuralMetrics?: StructuralMetrics;
}

interface ImportSpecifier {
  sourcePath: string;
  importedPath: string;
  names: string[];
}

interface ExportCandidate {
  file: string;
  name: string;
  kind: string;
  line: number;
}

interface DuplicateBlock {
  hash: string;
  normalizedLines: string[];
  locations: Array<{
    file: string;
    line: number;
  }>;
}

function normalizePath(path: string) {
  return path.split(sep).join("/");
}

function toWorkspacePath(path: string) {
  return normalizePath(relative(process.cwd(), path));
}

function collectFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];

  if (!existsSync(root)) {
    return files;
  }

  function walk(path: string) {
    const stats = statSync(path);

    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) {
        if (["node_modules", "dist", "target", ".git"].includes(entry)) {
          continue;
        }
        walk(join(path, entry));
      }
      return;
    }

    const extension = extname(path);
    if (!SOURCE_EXTENSIONS.has(extension)) {
      return;
    }

    const content = readFileSync(path, "utf8");
    const workspacePath = toWorkspacePath(path);
    const structuralMetrics = extension === ".rs"
      ? measureRustSource(content)
      : TYPESCRIPT_EXTENSIONS.has(extension)
        ? measureTypeScriptSource(content, workspacePath)
        : undefined;
    files.push({
      path: workspacePath,
      extension,
      content,
      lines: structuralMetrics && "nonEmptyProductionLines" in structuralMetrics
        ? structuralMetrics.nonEmptyProductionLines
        : content.split(/\r?\n/).length,
      structuralMetrics,
    });
  }

  walk(root);
  return files;
}

function printSection(title: string) {
  console.log("");
  console.log(title);
  console.log("-".repeat(title.length));
}

function printTable<Row>(rows: Row[], render: (row: Row, index: number) => string) {
  if (rows.length === 0) {
    console.log("(none)");
    return;
  }

  rows.forEach((row, index) => {
    console.log(render(row, index));
  });
}

function formatStructuralSummary(file: SourceFile) {
  const metrics = file.structuralMetrics;
  if (!metrics) return "";
  if ("astNodes" in metrics) {
    return `, ast ${metrics.astNodes}, branches ${metrics.branchPoints}, owners ${metrics.importOwners}`;
  }
  return `, functions ${metrics.functionCount}, branches ${metrics.branchPoints}, owners ${metrics.dependencyOwners}`;
}

function normalizeImportPath(fromFile: string, specifier: string) {
  if (specifier.startsWith(".")) {
    return normalizePath(normalize(join(dirname(fromFile), specifier)));
  }

  if (specifier.startsWith("@/")) {
    return `src/${specifier.slice(2)}`;
  }

  return null;
}

function resolveSourcePath(path: string, knownPaths: Set<string>) {
  const candidates = [
    path,
    `${path}.ts`,
    `${path}.tsx`,
    `${path}.d.ts`,
    `${path}/index.ts`,
    `${path}/index.tsx`,
  ];

  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

function extractNamedImports(importText: string) {
  const names: string[] = [];
  const namedBlock = importText.match(/\{([^}]+)\}/)?.[1];
  if (!namedBlock) {
    return names;
  }

  for (const part of namedBlock.split(",")) {
    const sourceName = part.trim().split(/\s+as\s+/u)[0]?.trim();
    if (sourceName && sourceName !== "type") {
      names.push(sourceName.replace(/^type\s+/u, "").trim());
    }
  }

  return names.filter(Boolean);
}

function extractImports(file: SourceFile, knownPaths: Set<string>): ImportSpecifier[] {
  const imports: ImportSpecifier[] = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?([^'"]*?)\s+from\s+["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?([^'"]*?)\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const match of file.content.matchAll(patterns[0])) {
    const normalized = normalizeImportPath(file.path, match[2]);
    if (!normalized) {
      continue;
    }

    const resolved = resolveSourcePath(normalized, knownPaths);
    if (!resolved) {
      continue;
    }

    imports.push({
      sourcePath: file.path,
      importedPath: resolved,
      names: extractNamedImports(match[1]),
    });
  }

  for (const match of file.content.matchAll(patterns[1])) {
    const normalized = normalizeImportPath(file.path, match[2]);
    if (!normalized) {
      continue;
    }

    const resolved = resolveSourcePath(normalized, knownPaths);
    if (!resolved) {
      continue;
    }

    imports.push({
      sourcePath: file.path,
      importedPath: resolved,
      names: extractNamedImports(match[1]),
    });
  }

  for (const match of file.content.matchAll(patterns[2])) {
    const normalized = normalizeImportPath(file.path, match[1]);
    if (!normalized) {
      continue;
    }

    const resolved = resolveSourcePath(normalized, knownPaths);
    if (!resolved) {
      continue;
    }

    imports.push({
      sourcePath: file.path,
      importedPath: resolved,
      names: [],
    });
  }

  return imports;
}

function collectInboundCounts(files: SourceFile[]) {
  const knownPaths = new Set(files.filter((file) => TYPESCRIPT_EXTENSIONS.has(file.extension)).map((file) => file.path));
  const inboundCounts = new Map<string, number>();
  const namedImports = new Map<string, Set<string>>();

  for (const file of files) {
    if (!TYPESCRIPT_EXTENSIONS.has(file.extension)) {
      continue;
    }

    for (const importSpecifier of extractImports(file, knownPaths)) {
      if (importSpecifier.sourcePath === importSpecifier.importedPath) {
        continue;
      }

      inboundCounts.set(importSpecifier.importedPath, (inboundCounts.get(importSpecifier.importedPath) ?? 0) + 1);
      const names = namedImports.get(importSpecifier.importedPath) ?? new Set<string>();
      importSpecifier.names.forEach((name) => names.add(name));
      namedImports.set(importSpecifier.importedPath, names);
    }
  }

  return { inboundCounts, namedImports };
}

function isUnreferencedFileAllowed(path: string) {
  return UNREFERENCED_FILE_ALLOWLIST.some((pattern) => pattern.test(path));
}

function extractExportCandidates(file: SourceFile): ExportCandidate[] {
  const candidates: ExportCandidate[] = [];
  const lines = file.content.split(/\r?\n/);
  const exportPattern = /^\s*export\s+(?:async\s+)?(const|function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/u;

  lines.forEach((line, index) => {
    const match = line.match(exportPattern);
    if (!match) {
      return;
    }

    candidates.push({
      file: file.path,
      kind: match[1],
      name: match[2],
      line: index + 1,
    });
  });

  return candidates;
}

function isExportAllowed(name: string) {
  return EXPORT_ALLOWLIST.some((pattern) => pattern.test(name));
}

function normalizeDuplicateLine(line: string) {
  return line
    .replace(/\/\/.*$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function findDuplicateBlocks(files: SourceFile[]) {
  const blocks = new Map<string, DuplicateBlock>();

  for (const file of files) {
    if (!SOURCE_EXTENSIONS.has(file.extension)) {
      continue;
    }

    const normalizedLines = file.content
      .split(/\r?\n/)
      .map(normalizeDuplicateLine)
      .filter((line) => line.length > 0 && !line.startsWith("*") && line !== "{" && line !== "}");

    for (let index = 0; index <= normalizedLines.length - DUPLICATE_BLOCK_SIZE; index += 1) {
      const window = normalizedLines.slice(index, index + DUPLICATE_BLOCK_SIZE);
      if (window.join("").length < 120) {
        continue;
      }

      const hash = createHash("sha1").update(window.join("\n")).digest("hex");
      const block = blocks.get(hash) ?? {
        hash,
        normalizedLines: window,
        locations: [],
      };

      block.locations.push({
        file: file.path,
        line: index + 1,
      });
      blocks.set(hash, block);
    }
  }

  return [...blocks.values()]
    .filter((block) => {
      const uniqueFiles = new Set(block.locations.map((location) => location.file));
      return uniqueFiles.size > 1;
    })
    .sort((left, right) => right.locations.length - left.locations.length)
    .slice(0, MAX_ROWS);
}

function main() {
  const files = SCAN_ROOTS.flatMap((root) => collectFiles(root));
  const sourceFiles = files.filter((file) => SOURCE_EXTENSIONS.has(file.extension));
  const { inboundCounts, namedImports } = collectInboundCounts(sourceFiles);

  console.log("Code quality hotspot report");
  console.log("This report is advisory only. Treat candidates as prompts for review, not as hard failures.");

  printSection("Largest source files");
  printTable(
    [...sourceFiles].sort((left, right) => right.lines - left.lines).slice(0, MAX_ROWS),
    (file, index) => (
      `${index + 1}. ${file.path} - ${file.lines} lines${formatStructuralSummary(file)}`
    ),
  );

  printSection("Files above local thresholds");
  printTable(
    sourceFiles
      .filter((file) => file.lines > (LARGE_FILE_THRESHOLDS[file.extension] ?? Number.POSITIVE_INFINITY))
      .sort((left, right) => right.lines - left.lines),
    (file) => (
      `${file.path} - ${file.lines} lines${formatStructuralSummary(file)} `
      + `(threshold ${LARGE_FILE_THRESHOLDS[file.extension]})`
    ),
  );

  printSection("Unreferenced TS/TSX file candidates");
  printTable(
    sourceFiles
      .filter((file) => TYPESCRIPT_EXTENSIONS.has(file.extension))
      .filter((file) => !isUnreferencedFileAllowed(file.path))
      .filter((file) => (inboundCounts.get(file.path) ?? 0) === 0)
      .sort((left, right) => left.path.localeCompare(right.path)),
    (file) => `${file.path} - no inbound relative/@ imports found`,
  );

  const exportCandidates = sourceFiles
    .filter((file) => TYPESCRIPT_EXTENSIONS.has(file.extension))
    .flatMap(extractExportCandidates)
    .filter((candidate) => !isExportAllowed(candidate.name))
    .filter((candidate) => !(namedImports.get(candidate.file)?.has(candidate.name) ?? false));

  printSection("Unused named export candidates");
  printTable(
    exportCandidates.slice(0, MAX_ROWS),
    (candidate) => `${candidate.file}:${candidate.line} - ${candidate.kind} ${candidate.name}`,
  );
  if (exportCandidates.length > MAX_ROWS) {
    console.log(`...and ${exportCandidates.length - MAX_ROWS} more candidates`);
  }

  printSection("Duplicate block candidates");
  printTable(findDuplicateBlocks(sourceFiles), (block, index) => {
    const locations = block.locations.slice(0, 4).map((location) => `${location.file}:${location.line}`).join(", ");
    const suffix = block.locations.length > 4 ? `, +${block.locations.length - 4} more` : "";
    return `${index + 1}. ${locations}${suffix}\n   ${block.normalizedLines[0]}`;
  });
}

main();
