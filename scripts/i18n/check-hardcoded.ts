import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { HARDCODED_COPY_EXCEPTIONS } from "./hardcoded-exceptions.ts";
import { REPO_ROOT, loadLocaleMessages } from "./core.ts";

interface Finding { file: string; value: string; kind: string }
const visibleAttributes = new Set(["aria-label", "aria-description", "placeholder", "title"]);
const visibleObjectProperties = new Set(["ariaLabel", "body", "description", "label", "message", "placeholder", "title"]);
const controlledCalls = /(?:toast|alert|confirm|notification)/i;

function filesBelow(root: string, extension: RegExp): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    return entry.isDirectory() ? filesBelow(path, extension) : extension.test(entry.name) ? [path] : [];
  });
}

function meaningful(value: string): string | null {
  const normalized = value.replace(/\s+/g, " ").trim();
  return /[\p{L}\p{Script=Han}]/u.test(normalized) ? normalized : null;
}

export function scanFrontendSource(path: string, source: string): Finding[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings: Finding[] = [];
  const constantExpressions = new Map<ts.Node, Map<string, ts.Expression | null>>();
  const mutableExpressions = new Map<ts.Node, Map<string, Array<{ position: number; expression: ts.Expression | null; conditional: boolean }>>>();
  const lexicalScope = (node: ts.Node): ts.Node => {
    let cursor: ts.Node | undefined = node.parent;
    while (cursor && !ts.isSourceFile(cursor) && !ts.isBlock(cursor) && !ts.isFunctionLike(cursor)) cursor = cursor.parent;
    return cursor ?? file;
  };
  const collectDeclarations = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const declarationList = node.parent;
      if (ts.isVariableDeclarationList(declarationList) && (declarationList.flags & ts.NodeFlags.Const) !== 0 && node.initializer) {
        const scope = lexicalScope(node);
        let declarations = constantExpressions.get(scope);
        if (!declarations) {
          declarations = new Map();
          constantExpressions.set(scope, declarations);
        }
        declarations.set(node.name.text, declarations.has(node.name.text) ? null : node.initializer);
      }
      if (ts.isVariableDeclarationList(declarationList) && (declarationList.flags & ts.NodeFlags.Let) !== 0) {
        const scope = lexicalScope(node);
        let declarations = mutableExpressions.get(scope);
        if (!declarations) {
          declarations = new Map();
          mutableExpressions.set(scope, declarations);
        }
        const definitions = declarations.get(node.name.text) ?? [];
        definitions.push({ position: node.getStart(file), expression: node.initializer ?? null, conditional: false });
        declarations.set(node.name.text, definitions);
      }
    }
    ts.forEachChild(node, collectDeclarations);
  };
  collectDeclarations(file);
  const collectAssignments = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left)) {
      const isAssignment = node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
      if (isAssignment) {
        let cursor: ts.Node | undefined = node;
        while (cursor) {
          if (ts.isSourceFile(cursor) || ts.isBlock(cursor) || ts.isFunctionLike(cursor)) {
            const definitions = mutableExpressions.get(cursor)?.get(node.left.text);
            if (definitions) {
              let ancestor: ts.Node | undefined = node.parent;
              let conditional = false;
              while (ancestor && ancestor !== cursor) {
                if (
                  ts.isIfStatement(ancestor) || ts.isConditionalExpression(ancestor)
                  || ts.isSwitchStatement(ancestor) || ts.isCaseClause(ancestor) || ts.isDefaultClause(ancestor)
                  || ts.isForStatement(ancestor) || ts.isForInStatement(ancestor) || ts.isForOfStatement(ancestor)
                  || ts.isWhileStatement(ancestor) || ts.isDoStatement(ancestor)
                  || ts.isTryStatement(ancestor) || ts.isCatchClause(ancestor)
                  || ts.isFunctionLike(ancestor)
                ) conditional = true;
                ancestor = ancestor.parent;
              }
              definitions.push({
                position: node.getStart(file),
                expression: node.operatorToken.kind === ts.SyntaxKind.EqualsToken ? node.right : null,
                conditional,
              });
              break;
            }
          }
          cursor = cursor.parent;
        }
      }
    }
    ts.forEachChild(node, collectAssignments);
  };
  collectAssignments(file);
  const record = (value: string, kind: string) => {
    const normalized = meaningful(value);
    if (normalized) findings.push({ file: relative(REPO_ROOT, path).replaceAll("\\", "/"), value: normalized, kind });
  };
  const literalTexts = (node: ts.Node | undefined, resolving = new Set<string>()): string[] => {
    if (!node) return [];
    if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isTemplateExpression(node)) {
      let values = [node.head.text];
      for (const span of node.templateSpans) {
        const substitutions = literalTexts(span.expression, resolving);
        values = values.flatMap((prefix) => (substitutions.length ? substitutions : ["{…}"]).map((value) => `${prefix}${value}${span.literal.text}`));
      }
      return values;
    }
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literalTexts(node.expression, resolving);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const left = literalTexts(node.left, resolving);
      const right = literalTexts(node.right, resolving);
      return left.flatMap((leftValue) => right.map((rightValue) => leftValue + rightValue));
    }
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return functionReturnTexts(node, resolving);
    if (ts.isIdentifier(node) && !resolving.has(node.text)) {
      let cursor: ts.Node | undefined = node;
      while (cursor) {
        if (ts.isSourceFile(cursor) || ts.isBlock(cursor) || ts.isFunctionLike(cursor)) {
          const expression = constantExpressions.get(cursor)?.get(node.text);
          if (expression) {
            const identity = `${cursor.pos}:${node.text}`;
            if (resolving.has(identity)) return null;
            const next = new Set(resolving);
            next.add(identity);
            return literalTexts(expression, next);
          }
          const mutable = mutableExpressions.get(cursor)?.get(node.text);
          if (mutable) {
            const prior = mutable.filter((item) => item.position < node.getStart(file));
            let lastUnconditional = -1;
            for (let index = 0; index < prior.length; index += 1) {
              if (!prior[index].conditional) lastUnconditional = index;
            }
            const candidates = prior.slice(Math.max(0, lastUnconditional));
            const values: string[] = [];
            for (const definition of candidates) {
              if (!definition.expression) continue;
              const identity = `${cursor.pos}:${node.text}:${definition.position}`;
              if (resolving.has(identity)) continue;
              const next = new Set(resolving);
              next.add(identity);
              values.push(...literalTexts(definition.expression, next));
            }
            return [...new Set(values)];
          }
        }
        cursor = cursor.parent;
      }
    }
    return [];
  };
  const literalText = (node: ts.Node | undefined, resolving = new Set<string>()): string | null => literalTexts(node, resolving)[0] ?? null;
  function functionReturnTexts(functionNode: ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration, resolving = new Set<string>()): string[] {
    if (ts.isArrowFunction(functionNode) && !ts.isBlock(functionNode.body)) return literalTexts(functionNode.body, resolving);
    const findReturns = (candidate: ts.Node): string[] => {
      if (candidate !== functionNode && ts.isFunctionLike(candidate)) return [];
      if (ts.isReturnStatement(candidate)) return literalTexts(candidate.expression, resolving);
      const values: string[] = [];
      for (const child of candidate.getChildren(file)) {
        values.push(...findReturns(child));
      }
      return values;
    };
    return functionNode.body ? findReturns(functionNode.body) : [];
  }
  const recordAll = (node: ts.Node | undefined, kind: string) => {
    for (const value of literalTexts(node)) record(value, kind);
  };
  const propertyName = (node: ts.PropertyName): string | null => {
    if (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) return node.text;
    if (ts.isComputedPropertyName(node)) return literalText(node.expression);
    return null;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) record(node.text, "jsx-text");
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent)) {
      recordAll(node.expression, "jsx-expression");
    }
    if (ts.isJsxAttribute(node) && visibleAttributes.has(node.name.getText(file)) && node.initializer) {
      const expression = ts.isJsxExpression(node.initializer) ? node.initializer.expression : node.initializer;
      recordAll(expression, `jsx-${node.name.getText(file)}`);
    }
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      if (name && visibleObjectProperties.has(name)) recordAll(node.initializer, `object-${name}`);
    }
    if (ts.isShorthandPropertyAssignment(node) && visibleObjectProperties.has(node.name.text)) {
      recordAll(node.name, `object-${node.name.text}`);
    }
    if (ts.isFunctionDeclaration(node) && node.name && visibleObjectProperties.has(node.name.text)) {
      for (const value of functionReturnTexts(node)) record(value, `function-${node.name.text}`);
    }
    if (ts.isCallExpression(node) && controlledCalls.test(node.expression.getText(file))) {
      const argument = node.arguments[0];
      recordAll(argument, "controlled-call");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

async function scanRustNativeSurfaces(): Promise<Finding[]> {
  const sourceMessages = await loadLocaleMessages("zh-CN");
  const localizedValues = Object.entries(sourceMessages)
    .filter(([key, value]) => key.startsWith("native.") && typeof value === "string")
    .map(([, value]) => value as string).filter((value) => value.length >= 2);
  const files = [
    "src-tauri/src/app/tray.rs",
    "src-tauri/src/engine/tools/mod.rs",
    "src-tauri/src/data/export/common.rs",
    "src-tauri/src/data/export/markdown_exporter.rs",
  ];
  const findings: Finding[] = [];
  for (const file of files) {
    const source = readFileSync(join(REPO_ROOT, file), "utf8").split("#[cfg(test)]")[0];
    const literals = new Set([...source.matchAll(/"(?:\\.|[^"\\])*"/g)].map((match) => match[0].slice(1, -1)));
    for (const value of localizedValues) {
      if (literals.has(value)) findings.push({ file, value, kind: "rust-native-copy" });
    }
  }
  return findings;
}

const exceptionId = (item: { file: string; value: string }): string => `${item.file}\0${item.value}`;

async function collectFindings(): Promise<Finding[]> {
  const generatedRoot = join(REPO_ROOT, "src", "shared", "i18n", "generated");
  const frontend = filesBelow(join(REPO_ROOT, "src"), /\.tsx?$/)
    .filter((path) => !path.startsWith(generatedRoot))
    .flatMap((path) => scanFrontendSource(path, readFileSync(path, "utf8")));
  return [...frontend, ...await scanRustNativeSurfaces()];
}

async function selfTest(): Promise<void> {
  const findings = scanFrontendSource(join(REPO_ROOT, "src", "fixture.tsx"), `
    const viewModel = { label: "Save", title: \`Delete ${'${count}'} items\` };
    const ok = <><button title={"Save"}>{"Open"}</button><div>{\`Ready\`}</div></>;
    alert("Done");
  `);
  if (findings.length !== 6) throw new Error(`hardcoded checker self-test expected 6 findings, received ${findings.length}`);
  const indirect = scanFrontendSource(join(REPO_ROOT, "src", "fixture.tsx"), `
    const label = "Sa" + "ve";
    const first = { label };
    const second = { ["title"]: label };
    const child = <button>{label}</button>;
    function description() { return "Ready"; }
  `);
  for (const expected of ["Save", "Ready"]) {
    if (!indirect.some((item) => item.value === expected)) throw new Error(`hardcoded checker missed propagated ${expected}`);
  }
  const scoped = scanFrontendSource(join(REPO_ROOT, "src", "fixture.tsx"), `
    function first() { const label = "Save"; return { label }; }
    function second() { const label = copy.label; return { label }; }
    let title = "Open"; const view = { title };
    const description = () => "Ready"; const model = { description };
    function label() { function diagnostic() { return "Internal invariant"; } return copy.label; }
  `);
  for (const expected of ["Save", "Open", "Ready"]) {
    if (!scoped.some((item) => item.value === expected)) throw new Error(`hardcoded checker missed scoped ${expected}`);
  }
  if (scoped.some((item) => item.value === "Internal invariant")) throw new Error("hardcoded checker crossed a nested function scope");
  const reassigned = scanFrontendSource(join(REPO_ROOT, "src", "fixture.tsx"), `
    let label = "Save"; label = copy.label; const localized = { label };
    { let label = copy.label; label = "Ready"; const hardcoded = { label }; }
  `);
  if (reassigned.some((item) => item.value === "Save")) throw new Error("hardcoded checker retained a replaced let initializer");
  if (!reassigned.some((item) => item.value === "Ready")) throw new Error("hardcoded checker missed a reassigned let value");
  const branched = scanFrontendSource(join(REPO_ROOT, "src", "fixture.tsx"), `
    let label = copy.label;
    if (condition) { label = "Save"; } else { label = copy.label; }
    const model = { label };
  `);
  if (!branched.some((item) => item.value === "Save")) throw new Error("hardcoded checker missed a conditional let definition");
  const exceptionMask = scanFrontendSource(join(REPO_ROOT, "src", "fixture.tsx"), `
    let label = "Patina";
    if (condition) { label = "Save"; }
    const model = { label };
  `);
  for (const expected of ["Patina", "Save"]) {
    if (!exceptionMask.some((item) => item.value === expected)) throw new Error(`hardcoded checker let ${expected} mask another reaching definition`);
  }
  if (scanFrontendSource(join(REPO_ROOT, "src", "fixture.tsx"), `const ok = <button title={copy.save}>{copy.open}</button>`).length) throw new Error("localized JSX was rejected");
  console.log("i18n hardcoded checker self-tests passed");
}

if (process.argv.includes("--self-test")) await selfTest();
else {
  const findings = await collectFindings();
  const exceptions = new Map(HARDCODED_COPY_EXCEPTIONS.map((item) => [exceptionId(item), item]));
  const unapproved = findings.filter((item) => !exceptions.has(exceptionId(item)));
  const foundIds = new Set(findings.map(exceptionId));
  const stale = HARDCODED_COPY_EXCEPTIONS.filter((item) => !foundIds.has(exceptionId(item)));
  if (unapproved.length || stale.length) {
    for (const item of unapproved) console.error(`${item.file}: ${item.kind}: ${JSON.stringify(item.value)}`);
    for (const item of stale) console.error(`${item.file}: stale exception: ${JSON.stringify(item.value)}`);
    process.exitCode = 1;
  } else console.log(`i18n hardcoded copy gate passed (${findings.length} reviewed exceptions)`);
}
