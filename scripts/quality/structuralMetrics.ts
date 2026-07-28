import * as ts from "typescript";

export interface TypeScriptStructuralMetrics {
  astNodes: number;
  branchPoints: number;
  crossFeatureOwners: number;
  effectCalls: number;
  exportCount: number;
  forwardingExports: number;
  hookCalls: number;
  importOwners: number;
  jsxAttributes: number;
  jsxNodes: number;
  maxFunctionAstNodes: number;
  maxFunctionBranchPoints: number;
  nonEmptyLines: number;
  physicalLines: number;
  topLevelFunctions: number;
}

export interface RustStructuralMetrics {
  branchPoints: number;
  dependencyOwners: number;
  functionCount: number;
  maxFunctionBranchPoints: number;
  nonEmptyProductionLines: number;
  physicalLines: number;
}

export type StructuralMetrics = TypeScriptStructuralMetrics | RustStructuralMetrics;

const EFFECT_NAMES = new Set(["useEffect", "useInsertionEffect", "useLayoutEffect"]);
const FUNCTION_KINDS = new Set([
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.SetAccessor,
]);
const BRANCH_KINDS = new Set([
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.CatchClause,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.DefaultClause,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.WhileStatement,
]);

function countPhysicalLines(content: string): number {
  return content.split(/\r?\n/).length;
}

function countNonEmptyLines(content: string): number {
  return content.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function readCallName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) {
    return expression.text;
  }
  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }
  return null;
}

function isBranchNode(node: ts.Node): boolean {
  if (BRANCH_KINDS.has(node.kind)) {
    return true;
  }
  return ts.isBinaryExpression(node)
    && [
      ts.SyntaxKind.AmpersandAmpersandToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken,
    ].includes(node.operatorToken.kind);
}

function isStructuralNode(node: ts.Node): boolean {
  return !ts.isJsxText(node) || node.text.trim().length > 0;
}

function resolveImportOwner(specifier: string): string {
  const normalized = specifier.replaceAll("\\", "/");
  const featureMatch = normalized.match(/(?:^|\/)features\/([^/]+)/u);
  if (featureMatch?.[1]) {
    return `feature:${featureMatch[1]}`;
  }
  for (const owner of ["app", "platform", "shared"] as const) {
    if (new RegExp(`(?:^|/)${owner}(?:/|$)`, "u").test(normalized)) {
      return owner;
    }
  }
  if (normalized.startsWith(".")) {
    return "local";
  }
  const packageParts = normalized.split("/");
  return normalized.startsWith("@")
    ? `external:${packageParts.slice(0, 2).join("/")}`
    : `external:${packageParts[0]}`;
}

function resolveCurrentFeature(fileName: string): string | null {
  return fileName.replaceAll("\\", "/").match(/(?:^|\/)features\/([^/]+)/u)?.[1] ?? null;
}

function countFunctionStructure(node: ts.Node): {
  astNodes: number;
  branchPoints: number;
} {
  let astNodes = 0;
  let branchPoints = 1;
  const visit = (current: ts.Node) => {
    if (isStructuralNode(current)) {
      astNodes += 1;
    }
    if (current !== node && FUNCTION_KINDS.has(current.kind)) {
      return;
    }
    if (isBranchNode(current)) {
      branchPoints += 1;
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return { astNodes, branchPoints };
}

export function measureTypeScriptSource(
  content: string,
  fileName = "fixture.tsx",
): TypeScriptStructuralMetrics {
  const scriptKind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(
    fileName,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const importOwners = new Set<string>();
  const crossFeatureOwners = new Set<string>();
  const currentFeature = resolveCurrentFeature(fileName);
  let astNodes = 0;
  let branchPoints = 0;
  let effectCalls = 0;
  let exportCount = 0;
  let forwardingExports = 0;
  let hookCalls = 0;
  let jsxAttributes = 0;
  let jsxNodes = 0;
  let maxFunctionAstNodes = 0;
  let maxFunctionBranchPoints = 0;
  let topLevelFunctions = 0;

  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement)
      || (
        ts.isVariableStatement(statement)
        && statement.declarationList.declarations.some((declaration) => (
          declaration.initializer
          && (
            ts.isArrowFunction(declaration.initializer)
            || ts.isFunctionExpression(declaration.initializer)
          )
        ))
      )
    ) {
      topLevelFunctions += 1;
    }

    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      exportCount += 1;
    }
    if (ts.isExportDeclaration(statement)) {
      exportCount += 1;
      if (statement.moduleSpecifier) {
        forwardingExports += statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.length
          : 1;
      }
    }
  }

  const visit = (node: ts.Node) => {
    if (isStructuralNode(node)) {
      astNodes += 1;
    }
    if (isBranchNode(node)) {
      branchPoints += 1;
    }
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const owner = resolveImportOwner(node.moduleSpecifier.text);
      importOwners.add(owner);
      const importedFeature = owner.startsWith("feature:") ? owner.slice("feature:".length) : null;
      if (importedFeature && importedFeature !== currentFeature) {
        crossFeatureOwners.add(importedFeature);
      }
    }
    if (ts.isCallExpression(node)) {
      const callName = readCallName(node.expression);
      if (callName?.startsWith("use")) {
        hookCalls += 1;
      }
      if (callName && EFFECT_NAMES.has(callName)) {
        effectCalls += 1;
      }
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      jsxNodes += 1;
    }
    if (ts.isJsxAttribute(node) || ts.isJsxSpreadAttribute(node)) {
      jsxAttributes += 1;
    }
    if (FUNCTION_KINDS.has(node.kind)) {
      const functionStructure = countFunctionStructure(node);
      maxFunctionAstNodes = Math.max(maxFunctionAstNodes, functionStructure.astNodes);
      maxFunctionBranchPoints = Math.max(
        maxFunctionBranchPoints,
        functionStructure.branchPoints,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return {
    astNodes,
    branchPoints,
    crossFeatureOwners: crossFeatureOwners.size,
    effectCalls,
    exportCount,
    forwardingExports,
    hookCalls,
    importOwners: importOwners.size,
    jsxAttributes,
    jsxNodes,
    maxFunctionAstNodes,
    maxFunctionBranchPoints,
    nonEmptyLines: countNonEmptyLines(content),
    physicalLines: countPhysicalLines(content),
    topLevelFunctions,
  };
}

function stripRustCfgTestItems(content: string): string {
  const lines = content.split(/\r?\n/);
  const production = [...lines];
  let pendingTestAttribute = false;
  let testDepth: number | null = null;
  let itemStarted = false;
  const braceDelta = (line: string) => (
    (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0)
  );

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (testDepth !== null) {
      production[index] = "";
      testDepth += braceDelta(line);
      if (testDepth <= 0) testDepth = null;
      return;
    }
    if (/^#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]/u.test(trimmed)) {
      pendingTestAttribute = true;
      production[index] = "";
      return;
    }
    if (!pendingTestAttribute) return;

    production[index] = "";
    if (!trimmed || (!itemStarted && trimmed.startsWith("#"))) return;
    itemStarted = true;
    const delta = braceDelta(line);
    if (delta > 0) {
      testDepth = delta;
      pendingTestAttribute = false;
      itemStarted = false;
    } else if (trimmed.endsWith(";") || (trimmed.includes("{") && delta === 0)) {
      pendingTestAttribute = false;
      itemStarted = false;
    }
  });

  return production.join("\n");
}

function rustStructuralTokens(content: string): string[] {
  return content.match(
    /::|=>|&&|\|\||\b(?:fn|if|match|for|while|loop|use|mod|crate|super|self)\b|[{}();]/gu,
  ) ?? [];
}

function countRustMaxFunctionBranches(content: string): number {
  const tokens = rustStructuralTokens(content);
  let inFunction = false;
  let pendingFunction = false;
  let depth = 0;
  let branches = 0;
  let maxBranches = 0;

  for (const token of tokens) {
    if (!inFunction && token === "fn") {
      pendingFunction = true;
      continue;
    }
    if (pendingFunction && token === "{") {
      pendingFunction = false;
      inFunction = true;
      depth = 1;
      branches = 1;
      continue;
    }
    if (!inFunction) continue;
    if (token === "{") depth += 1;
    if (token === "}") {
      depth -= 1;
      if (depth === 0) {
        inFunction = false;
        maxBranches = Math.max(maxBranches, branches);
      }
    }
    if (["if", "match", "for", "while", "loop", "=>", "&&", "||"].includes(token)) {
      branches += 1;
    }
  }

  return maxBranches;
}

export function measureRustSource(content: string): RustStructuralMetrics {
  const production = stripRustCfgTestItems(content);
  const tokens = rustStructuralTokens(production);
  const dependencyOwners = new Set<string>();
  for (const match of production.matchAll(/\b(?:crate|super)::([a-zA-Z_][a-zA-Z0-9_]*)/gu)) {
    dependencyOwners.add(match[1]);
  }
  for (const match of production.matchAll(/^\s*mod\s+([a-zA-Z_][a-zA-Z0-9_]*)/gmu)) {
    dependencyOwners.add(match[1]);
  }

  return {
    branchPoints: tokens.filter((token) => (
      ["if", "match", "for", "while", "loop", "=>", "&&", "||"].includes(token)
    )).length,
    dependencyOwners: dependencyOwners.size,
    functionCount: tokens.filter((token) => token === "fn").length,
    maxFunctionBranchPoints: countRustMaxFunctionBranches(production),
    nonEmptyProductionLines: countNonEmptyLines(production),
    physicalLines: countPhysicalLines(content),
  };
}

export function aggregateTypeScriptMetrics(
  sources: ReadonlyArray<{ content: string; fileName: string }>,
): TypeScriptStructuralMetrics {
  const measured = sources.map(({ content, fileName }) => (
    measureTypeScriptSource(content, fileName)
  ));
  const sumKeys: Array<keyof TypeScriptStructuralMetrics> = [
    "astNodes",
    "branchPoints",
    "crossFeatureOwners",
    "effectCalls",
    "exportCount",
    "forwardingExports",
    "hookCalls",
    "importOwners",
    "jsxAttributes",
    "jsxNodes",
    "nonEmptyLines",
    "physicalLines",
    "topLevelFunctions",
  ];
  const aggregate = measureTypeScriptSource("", "empty.ts");
  for (const key of sumKeys) {
    aggregate[key] = measured.reduce((sum, metrics) => sum + metrics[key], 0);
  }
  aggregate.maxFunctionAstNodes = Math.max(
    0,
    ...measured.map((metrics) => metrics.maxFunctionAstNodes),
  );
  aggregate.maxFunctionBranchPoints = Math.max(
    0,
    ...measured.map((metrics) => metrics.maxFunctionBranchPoints),
  );
  return aggregate;
}

export function typeScriptStructuralSignature(metrics: TypeScriptStructuralMetrics): string {
  const {
    nonEmptyLines: _nonEmptyLines,
    physicalLines: _physicalLines,
    ...structural
  } = metrics;
  return JSON.stringify(structural);
}

export function rustStructuralSignature(metrics: RustStructuralMetrics): string {
  const {
    nonEmptyProductionLines: _nonEmptyProductionLines,
    physicalLines: _physicalLines,
    ...structural
  } = metrics;
  return JSON.stringify(structural);
}
