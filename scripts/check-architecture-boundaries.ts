import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative, sep } from "node:path";
import ts from "typescript";

const SCAN_ROOTS = ["src/app", "src/features", "src/shared", "src/platform"] as const;
const DEFAULT_CAPABILITY_PATH = "src-tauri/capabilities/default.json";
const WIDGET_CAPABILITY_PATH = "src-tauri/capabilities/widget.json";

interface SourceFile {
  path: string;
  content: string;
}

interface ArchitectureViolation {
  path: string;
  line: number;
  rule: string;
  text: string;
}

interface ModuleReference {
  specifier: string | null;
  node: ts.Node;
  dynamic: boolean;
}

function normalizePath(path: string) {
  return path.split(sep).join("/");
}

function normalizeImportPath(fromFile: string, specifier: string) {
  if (specifier.startsWith(".")) {
    return normalizePath(normalize(join(dirname(fromFile), specifier)));
  }
  if (specifier.startsWith("@/")) {
    return `src/${specifier.slice(2)}`;
  }
  return specifier;
}

function collectSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  function walk(path: string) {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) {
        walk(join(path, entry));
      }
      return;
    }
    if (/\.(ts|tsx)$/.test(path)) {
      files.push({
        path: normalizePath(relative(process.cwd(), path)),
        content: readFileSync(path, "utf8"),
      });
    }
  }
  walk(root);
  return files;
}

function parseSource(file: SourceFile) {
  return ts.createSourceFile(
    file.path,
    file.content,
    ts.ScriptTarget.Latest,
    true,
    file.path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isFeatureComponentOrHook(path: string) {
  return /^src\/features\/[^/]+\/(components|hooks)\//.test(path);
}

function isSharedSource(path: string) {
  return /^src\/shared\//.test(path);
}

function isPlatformSource(path: string) {
  return /^src\/platform\//.test(path);
}

function isAppSource(path: string) {
  return /^src\/app\//.test(path);
}

function isAppComponentOrHook(path: string) {
  return /^src\/app\/(components|hooks)\//.test(path);
}

function isAppComponent(path: string) {
  return /^src\/app\/components\//.test(path);
}

function isStringLiteral(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
  return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function collectModuleReferences(sourceFile: ts.SourceFile) {
  const references: ModuleReference[] = [];
  function visit(node: ts.Node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier && isStringLiteral(node.moduleSpecifier)) {
        references.push({ specifier: node.moduleSpecifier.text, node, dynamic: false });
      }
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const argument = node.arguments[0];
      references.push({
        specifier: argument && isStringLiteral(argument) ? argument.text : null,
        node,
        dynamic: true,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return references;
}

function nodeLine(sourceFile: ts.SourceFile, node: ts.Node) {
  return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
}

function nodeText(sourceFile: ts.SourceFile, node: ts.Node) {
  return node.getText(sourceFile).replace(/\s+/g, " ").slice(0, 240);
}

function addViolation(
  violations: ArchitectureViolation[],
  file: SourceFile,
  sourceFile: ts.SourceFile,
  node: ts.Node,
  rule: string,
) {
  violations.push({
    path: file.path,
    line: nodeLine(sourceFile, node),
    rule,
    text: nodeText(sourceFile, node),
  });
}

function findArchitectureViolations(files: SourceFile[]): ArchitectureViolation[] {
  const violations: ArchitectureViolation[] = [];

  for (const file of files) {
    const sourceFile = parseSource(file);
    const moduleReferences = collectModuleReferences(sourceFile);

    for (const reference of moduleReferences) {
      if (reference.specifier === null) {
        addViolation(
          violations,
          file,
          sourceFile,
          reference.node,
          "restricted-no-nonliteral-dynamic-import",
        );
        continue;
      }

      const importedPath = normalizeImportPath(file.path, reference.specifier);
      if (/^src\/shared\/copy(?:\/|$)/.test(importedPath)) {
        addViolation(violations, file, sourceFile, reference.node, "frontend-no-legacy-copy-import");
      }
      if (isSharedSource(file.path) && /^src\/app\//.test(importedPath)) {
        addViolation(violations, file, sourceFile, reference.node, "shared-no-app-import");
      }
      if (isSharedSource(file.path) && /^src\/features\//.test(importedPath)) {
        addViolation(violations, file, sourceFile, reference.node, "shared-no-feature-import");
      }
      if (isSharedSource(file.path) && /^src\/platform\//.test(importedPath)) {
        addViolation(violations, file, sourceFile, reference.node, "shared-no-platform-import");
      }
      if (isFeatureComponentOrHook(file.path) && /^src\/platform\//.test(importedPath)) {
        addViolation(violations, file, sourceFile, reference.node, "feature-ui-no-platform-import");
      }
      if (isAppComponentOrHook(file.path) && /^src\/platform\/persistence\//.test(importedPath)) {
        addViolation(
          violations,
          file,
          sourceFile,
          reference.node,
          "app-shell-no-direct-persistence-import",
        );
      }
      if (isAppComponent(file.path) && /^src\/features\//.test(importedPath)) {
        addViolation(violations, file, sourceFile, reference.node, "app-component-no-feature-import");
      }
      if (isPlatformSource(file.path) && /^src\/app\//.test(importedPath)) {
        addViolation(violations, file, sourceFile, reference.node, "platform-no-app-import");
      }
      if (isPlatformSource(file.path) && /^src\/features\//.test(importedPath)) {
        addViolation(violations, file, sourceFile, reference.node, "platform-no-feature-import");
      }
      if (isFeatureComponentOrHook(file.path) && reference.specifier.includes("@tauri-apps")) {
        addViolation(violations, file, sourceFile, reference.node, "feature-ui-no-tauri-api");
      }
      if (isAppSource(file.path) && reference.specifier.includes("@tauri-apps/api")) {
        addViolation(violations, file, sourceFile, reference.node, "app-no-tauri-api");
      }
    }

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (isFeatureComponentOrHook(file.path) && node.expression.text === "invoke") {
          addViolation(violations, file, sourceFile, node, "feature-ui-no-direct-invoke");
        }
      }

      if (
        ts.isIdentifier(node) &&
        (node.text === "executeWrite" || node.text === "executeWriteBatch") &&
        !file.path.endsWith("src/platform/persistence/sqlite.ts") &&
        !file.path.endsWith("src/platform/persistence/sqliteTransactions.ts")
      ) {
        addViolation(violations, file, sourceFile, node, "frontend-no-sql-execute-write");
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  return violations;
}

function assertRuntimeBoundaryGuards() {
  const defaultCapability = JSON.parse(readFileSync(DEFAULT_CAPABILITY_PATH, "utf8")) as {
    windows?: string[];
    permissions?: unknown[];
  };
  const widgetCapability = JSON.parse(readFileSync(WIDGET_CAPABILITY_PATH, "utf8")) as {
    windows?: string[];
    permissions?: unknown[];
  };

  if (defaultCapability.windows?.includes("widget")) {
    throw new Error("Default capability must not include the widget window");
  }
  if (!widgetCapability.windows?.includes("widget")) {
    throw new Error("Widget capability must explicitly include the widget window");
  }
  const widgetPermissionText = JSON.stringify(widgetCapability.permissions ?? []);
  if (!widgetPermissionText.includes("core:event:allow-unlisten")) {
    throw new Error(
      "Widget capability must include core:event:allow-unlisten for listener cleanup",
    );
  }
  if (widgetPermissionText.includes("sql:allow-execute")) {
    throw new Error("Widget capability must not include sql:allow-execute");
  }
  const defaultPermissionText = JSON.stringify(defaultCapability.permissions ?? []);
  if (defaultPermissionText.includes("sql:allow-execute")) {
    throw new Error("Default capability must not include sql:allow-execute");
  }

  const appShell = readFileSync("src/app/AppShell.tsx", "utf8");
  const widgetShell = readFileSync("src/app/widget/WidgetShell.tsx", "utf8");
  for (const [path, content] of [
    ["src/app/AppShell.tsx", appShell],
    ["src/app/widget/WidgetShell.tsx", widgetShell],
  ] as const) {
    if (content.includes("setUiTextLanguage(")) {
      throw new Error(`${path} must not call the retired setUiTextLanguage API`);
    }
  }

  const widgetIconService = readFileSync("src/app/widget/widgetIconService.ts", "utf8");
  if (widgetIconService.includes("platform/persistence/sessionReadRepository")) {
    throw new Error("Widget icon service must not import the session read repository directly");
  }
}

function runSelfTest() {
  const violations = findArchitectureViolations([
    {
      path: "src/features/data/components/Data.tsx",
      content: [
        "import {",
        "  getSessionsInRange,",
        "} from '../../../platform/persistence/sessionReadRepository.ts';",
        "const fake = `import('../../platform/fake.ts')`;",
      ].join("\n"),
    },
    {
      path: "src/features/data/services/dataReadModel.ts",
      content: "const repository = await import(\n'../../../platform/persistence/sessionReadRepository.ts'\n);",
    },
    {
      path: "src/shared/lib/sessionReadRepository.ts",
      content: [
        "export type { HistorySession } from '../../platform/persistence/sessionReadRepository.ts';",
        "import type { View } from '../../app/types/view.ts';",
        "export { default as Dashboard } from '../../features/dashboard/components/Dashboard.tsx';",
      ].join("\n"),
    },
    {
      path: "src/features/settings/hooks/useSettings.ts",
      content: "await invoke('cmd_save_settings');",
    },
    {
      path: "src/app/components/AppTitleBar.tsx",
      content: [
        "import { getSessionsInRange } from '../../platform/persistence/sessionReadRepository.ts';",
        "import ToolsStatusChip from '../../features/tools/components/ToolsStatusChip.tsx';",
      ].join("\n"),
    },
    {
      path: "src/platform/persistence/sessionReadRepository.ts",
      content: "import { loadDashboardSnapshot } from '../../features/dashboard/services/dashboardReadModel.ts';",
    },
    {
      path: "src/platform/runtime/trackingRuntimeGateway.ts",
      content: "import { invoke } from '@tauri-apps/api/core';",
    },
    {
      path: "src/app/widget/badGateway.ts",
      content: "import { invoke } from '@tauri-apps/api/core';",
    },
    {
      path: "src/platform/persistence/badWrite.ts",
      content: "import { executeWrite } from './sqlite.ts';",
    },
    {
      path: "src/features/data/services/lazy.ts",
      content: "const path = './dynamic'; import(path);",
    },
    {
      path: "src/features/settings/services/legacyCopy.ts",
      content: "import { UI_TEXT } from '../../../shared/copy/index.ts';",
    },
  ]);

  const rules = violations.map((violation) => violation.rule).sort();
  const expectedRules = [
    "feature-ui-no-platform-import",
    "shared-no-platform-import",
    "shared-no-app-import",
    "shared-no-feature-import",
    "feature-ui-no-direct-invoke",
    "app-shell-no-direct-persistence-import",
    "app-component-no-feature-import",
    "platform-no-feature-import",
    "app-no-tauri-api",
    "frontend-no-sql-execute-write",
    "restricted-no-nonliteral-dynamic-import",
    "frontend-no-legacy-copy-import",
  ].sort();

  if (JSON.stringify(rules) !== JSON.stringify(expectedRules)) {
    throw new Error(
      `Architecture boundary self-test failed\nexpected ${JSON.stringify(expectedRules)}\nactual ${JSON.stringify(rules)}`,
    );
  }
}

function main() {
  runSelfTest();
  if (process.argv.includes("--self-test")) {
    console.log("Architecture boundary self-test passed");
    return;
  }

  const files = SCAN_ROOTS.flatMap((root) => collectSourceFiles(root));
  const violations = findArchitectureViolations(files);
  assertRuntimeBoundaryGuards();

  if (violations.length === 0) {
    console.log("Architecture boundary check passed");
    return;
  }

  console.error("Architecture boundary check failed. UI, shell, and platform code must stay within owned boundaries.");
  for (const violation of violations) {
    console.error(
      `${violation.path}:${violation.line} ${violation.rule} -> ${violation.text} ` +
        "[owner: feature service / app composition / platform gateway]",
    );
  }
  process.exitCode = 1;
}

main();
