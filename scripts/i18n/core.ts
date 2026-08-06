import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { LOCALE_REGISTRY } from "../../locales/registry.ts";
import { MESSAGE_SCHEMA } from "../../locales/schema.ts";
import { LOCALE_SOURCE_REVIEWS } from "../../locales/review-manifest.ts";

export type ProductionLocale = keyof typeof LOCALE_REGISTRY;
export type SchemaEntry = (typeof MESSAGE_SCHEMA)[keyof typeof MESSAGE_SCHEMA];
export type MessageValue = string | readonly string[] | Readonly<Record<string, string>> | MessageDescriptor;
export interface MessageDescriptor {
  readonly $type: "message";
  readonly body: Expression;
}
export type Expression = string | number | boolean | null | readonly Expression[] | Readonly<Record<string, unknown>>;

export const REPO_ROOT = resolve(import.meta.dirname, "../..");
export const LOCALES_ROOT = join(REPO_ROOT, "locales");
export const FRONTEND_GENERATED_ROOT = join(REPO_ROOT, "src", "shared", "i18n", "generated");
export const RUST_GENERATED_PATH = join(REPO_ROOT, "src-tauri", "src", "domain", "localization", "generated.rs");
export const PENDING_REVIEW = "PENDING";

export function sourceLocale(): ProductionLocale {
  const sources = Object.entries(LOCALE_REGISTRY)
    .filter(([, metadata]) => metadata.source)
    .map(([locale]) => locale as ProductionLocale);
  if (sources.length !== 1) throw new Error(`locale registry must declare exactly one source locale; found ${sources.length}`);
  return sources[0];
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sourceHash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, 16);
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    node = node.expression;
  }
  return node;
}

export function validatePureResourceFile(path: string): void {
  const source = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parseDiagnostics = (file as unknown as { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (parseDiagnostics.length > 0) throw new Error(`${path}: invalid TypeScript resource syntax`);
  if (file.statements.length !== 1 || !ts.isVariableStatement(file.statements[0])) {
    throw new Error(`${path}: locale resources must contain one exported const`);
  }
  const statement = file.statements[0];
  if (!statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
    throw new Error(`${path}: locale resource must export MESSAGES`);
  }
  const declarations = statement.declarationList.declarations;
  if (declarations.length !== 1 || !ts.isIdentifier(declarations[0].name) || declarations[0].name.text !== "MESSAGES") {
    throw new Error(`${path}: locale resource must export exactly MESSAGES`);
  }
  const initializer = declarations[0].initializer && unwrapExpression(declarations[0].initializer);
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) {
    throw new Error(`${path}: MESSAGES must be an object literal`);
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionLike(node)
      || ts.isCallExpression(node)
      || ts.isNewExpression(node)
      || ts.isSpreadAssignment(node)
      || ts.isSpreadElement(node)
      || ts.isComputedPropertyName(node)
      || ts.isShorthandPropertyAssignment(node)
      || ts.isIdentifier(node) && node.text !== "MESSAGES"
    ) {
      throw new Error(`${path}: executable or non-literal syntax is forbidden (${ts.SyntaxKind[node.kind]})`);
    }
    ts.forEachChild(node, visit);
  };
  visit(initializer);
}

export async function loadLocaleMessages(locale: string): Promise<Record<string, MessageValue>> {
  const localeRoot = join(LOCALES_ROOT, locale);
  const files = readdirSync(localeRoot).filter((file) => file.endsWith(".ts")).sort();
  const messages: Record<string, MessageValue> = {};
  for (const file of files) {
    const path = join(localeRoot, file);
    validatePureResourceFile(path);
    const module = await import(`${pathToFileURL(path).href}?v=${Date.now()}-${file}`) as { MESSAGES: Record<string, MessageValue> };
    for (const [key, value] of Object.entries(module.MESSAGES)) {
      if (Object.hasOwn(messages, key)) throw new Error(`${locale}: duplicate message key ${key}`);
      messages[key] = value;
    }
  }
  return messages;
}

function pluralCategories(locale: string): string[] {
  return [...new Intl.PluralRules(locale, { type: "cardinal" }).resolvedOptions().pluralCategories].sort();
}

type ExpressionType = "array" | "boolean" | "null" | "number" | "string" | "unknown";

function parameterExpressionTypes(type: string): Set<ExpressionType> {
  const output = new Set<ExpressionType>();
  if (type.includes("string[]")) output.add("array");
  else if (type === "number" || type === "integer") output.add("number");
  else if (type === "boolean") output.add("boolean");
  else output.add("string");
  if (type.includes("null") || type.includes("undefined")) output.add("null");
  return output;
}

function validateExpression(
  expression: unknown,
  key: string,
  locale: string,
  parameters: ReadonlyMap<string, string>,
  pluralArgs: Set<string>,
): Set<ExpressionType> {
  if (expression === null) return new Set(["null"]);
  if (typeof expression === "string") return new Set(["string"]);
  if (typeof expression === "number") {
    if (!Number.isFinite(expression)) throw new Error(`${locale}:${key}: numeric expressions must be finite`);
    return new Set(["number"]);
  }
  if (typeof expression === "boolean") return new Set(["boolean"]);
  if (Array.isArray(expression)) {
    expression.forEach((item) => validateExpression(item, key, locale, parameters, pluralArgs));
    return new Set(["array"]);
  }
  if (!expression || typeof expression !== "object") throw new Error(`${locale}:${key}: invalid expression`);
  const node = expression as Record<string, unknown>;
  const op = node.$op;
  const allowed = new Set(["arg", "concat", "if", "eq", "notEq", "coalesce", "subtract", "element", "join", "monthName", "plural"]);
  if (typeof op !== "string" || !allowed.has(op)) throw new Error(`${locale}:${key}: unsupported expression op ${String(op)}`);
  const requireShape = (required: string[], optional: string[] = []): void => {
    const allowedFields = new Set(["$op", ...required, ...optional]);
    const missing = required.filter((field) => !Object.hasOwn(node, field));
    const extra = Object.keys(node).filter((field) => !allowedFields.has(field));
    if (missing.length > 0 || extra.length > 0) {
      throw new Error(`${locale}:${key}: invalid ${op} shape; missing=[${missing.join(",")}], extra=[${extra.join(",")}]`);
    }
  };
  const requireTypes = (field: string, actual: Set<ExpressionType>, expected: ExpressionType[]): void => {
    if ([...actual].some((type) => !expected.includes(type))) {
      throw new Error(`${locale}:${key}: ${op}.${field} must be ${expected.join(" or ")}; received ${[...actual].join(" or ")}`);
    }
  };
  const child = (field: string): Set<ExpressionType> => validateExpression(node[field], key, locale, parameters, pluralArgs);
  const merge = (...sets: Set<ExpressionType>[]): Set<ExpressionType> => new Set(sets.flatMap((set) => [...set]));
  if (op === "arg") {
    requireShape(["name"]);
    if (typeof node.name !== "string" || !parameters.has(node.name)) throw new Error(`${locale}:${key}: unknown argument ${String(node.name)}`);
    return parameterExpressionTypes(parameters.get(node.name)!);
  }
  if (op === "plural") {
    requireShape(["arg", "cases"]);
    if (typeof node.arg !== "string" || parameters.get(node.arg) !== "integer") throw new Error(`${locale}:${key}: plural argument must be a declared integer`);
    pluralArgs.add(node.arg);
    if (!node.cases || typeof node.cases !== "object" || Array.isArray(node.cases)) throw new Error(`${locale}:${key}: plural cases must be an object`);
    const actual = Object.keys(node.cases as Record<string, unknown>).sort();
    const expected = pluralCategories(locale);
    if (actual.join("|") !== expected.join("|")) {
      throw new Error(`${locale}:${key}: plural categories ${actual.join(",")} do not match CLDR ${expected.join(",")}`);
    }
    return merge(...Object.values(node.cases as Record<string, unknown>)
      .map((caseExpression) => validateExpression(caseExpression, key, locale, parameters, pluralArgs)));
  }
  const shapes: Record<string, { required: string[]; optional?: string[] }> = {
    concat: { required: ["parts"] },
    if: { required: ["when", "then", "else"] },
    eq: { required: ["left", "right"] },
    notEq: { required: ["left", "right"] },
    coalesce: { required: ["left", "right"] },
    subtract: { required: ["left", "right"] },
    element: { required: ["target", "index"] },
    join: { required: ["target", "separator"] },
    monthName: { required: ["year", "zeroBasedMonth"], optional: ["style"] },
  };
  const shape = shapes[op];
  requireShape(shape.required, shape.optional);
  switch (op) {
    case "concat": {
      if (!Array.isArray(node.parts)) throw new Error(`${locale}:${key}: concat parts must be an array`);
      for (const part of node.parts) {
        requireTypes("parts", validateExpression(part, key, locale, parameters, pluralArgs), ["string", "number", "boolean", "null", "unknown"]);
      }
      return new Set(["string"]);
    }
    case "if": {
      requireTypes("when", child("when"), ["boolean"]);
      return merge(child("then"), child("else"));
    }
    case "eq":
    case "notEq":
      child("left");
      child("right");
      return new Set(["boolean"]);
    case "coalesce": {
      const left = child("left");
      left.delete("null");
      return merge(left, child("right"));
    }
    case "subtract":
      requireTypes("left", child("left"), ["number"]);
      requireTypes("right", child("right"), ["number"]);
      return new Set(["number"]);
    case "element":
      requireTypes("target", child("target"), ["array"]);
      requireTypes("index", child("index"), ["number"]);
      return new Set(["unknown"]);
    case "join":
      requireTypes("target", child("target"), ["array"]);
      requireTypes("separator", child("separator"), ["string"]);
      return new Set(["string"]);
    case "monthName":
      if (node.style !== undefined && node.style !== "short" && node.style !== "long") {
        throw new Error(`${locale}:${key}: monthName style must be short or long`);
      }
      requireTypes("year", child("year"), ["number"]);
      requireTypes("zeroBasedMonth", child("zeroBasedMonth"), ["number"]);
      if (typeof node.zeroBasedMonth === "number" && (!Number.isInteger(node.zeroBasedMonth) || node.zeroBasedMonth < 0 || node.zeroBasedMonth > 11)) {
        throw new Error(`${locale}:${key}: monthName zeroBasedMonth literal must be an integer from 0 to 11`);
      }
      if (typeof node.year === "number" && typeof node.zeroBasedMonth === "number") {
        const date = new Date(Date.UTC(node.year, node.zeroBasedMonth, 1));
        if (Number.isNaN(date.getTime())) throw new Error(`${locale}:${key}: monthName literal date is outside the supported range`);
      }
      return new Set(["string"]);
    default:
      throw new Error(`${locale}:${key}: unsupported expression op ${op}`);
  }
}

function validateStructuredData(value: unknown, key: string, locale: string, validator: string | undefined): void {
  if (validator !== "webActivityHelpSteps") throw new Error(`${locale}:${key}: unknown structured data validator ${String(validator)}`);
  if (!Array.isArray(value)) throw new Error(`${locale}:${key}: expected structured data array`);
  const exactObject = (candidate: unknown, required: string[], optional: string[], path: string): Record<string, unknown> => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`${locale}:${key}:${path}: expected object`);
    const record = candidate as Record<string, unknown>;
    const allowed = new Set([...required, ...optional]);
    if (required.some((field) => !Object.hasOwn(record, field)) || Object.keys(record).some((field) => !allowed.has(field))) {
      throw new Error(`${locale}:${key}:${path}: invalid object shape`);
    }
    return record;
  };
  value.forEach((step, stepIndex) => {
    const record = exactObject(step, ["title", "description", "details"], ["showStoreBadges"], `[${stepIndex}]`);
    if (typeof record.title !== "string" || typeof record.description !== "string" || !Array.isArray(record.details)) {
      throw new Error(`${locale}:${key}:[${stepIndex}]: invalid title, description, or details`);
    }
    if (record.showStoreBadges !== undefined && typeof record.showStoreBadges !== "boolean") {
      throw new Error(`${locale}:${key}:[${stepIndex}].showStoreBadges: expected boolean`);
    }
    record.details.forEach((detail, detailIndex) => {
      if (typeof detail === "string") return;
      const detailRecord = exactObject(detail, ["text", "links"], [], `[${stepIndex}].details[${detailIndex}]`);
      if (typeof detailRecord.text !== "string" || !Array.isArray(detailRecord.links)) {
        throw new Error(`${locale}:${key}:[${stepIndex}].details[${detailIndex}]: invalid text or links`);
      }
      detailRecord.links.forEach((link, linkIndex) => {
        const linkRecord = exactObject(link, ["label", "href"], [], `[${stepIndex}].details[${detailIndex}].links[${linkIndex}]`);
        if (typeof linkRecord.label !== "string" || typeof linkRecord.href !== "string") {
          throw new Error(`${locale}:${key}:[${stepIndex}].details[${detailIndex}].links[${linkIndex}]: invalid link`);
        }
      });
    });
  });
}

export function validateLocaleBundle(locale: string, messages: Record<string, MessageValue>): void {
  const schemaKeys = Object.keys(MESSAGE_SCHEMA).sort();
  const actualKeys = Object.keys(messages).sort();
  if (schemaKeys.join("\n") !== actualKeys.join("\n")) {
    const missing = schemaKeys.filter((key) => !Object.hasOwn(messages, key));
    const extra = actualKeys.filter((key) => !Object.hasOwn(MESSAGE_SCHEMA, key));
    throw new Error(`${locale}: key mismatch; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}]`);
  }
  for (const key of schemaKeys) {
    const schema = MESSAGE_SCHEMA[key as keyof typeof MESSAGE_SCHEMA];
    const value = messages[key];
    if (schema.kind === "string" && typeof value !== "string") throw new Error(`${locale}:${key}: expected string`);
    if (schema.kind === "string-array" && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) throw new Error(`${locale}:${key}: expected string array`);
    if (schema.kind === "data") validateStructuredData(value, key, locale, "validator" in schema ? schema.validator : undefined);
    if (schema.kind === "string-record" && (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((item) => typeof item !== "string"))) throw new Error(`${locale}:${key}: expected string record`);
    if (schema.kind === "message") {
      if (!value || typeof value !== "object" || Array.isArray(value) || (value as MessageDescriptor).$type !== "message") throw new Error(`${locale}:${key}: expected message descriptor`);
      const parameters = new Map<string, string>(schema.params.map((param) => [param.name, param.type] as [string, string]));
      const pluralArgs = new Set<string>();
      validateExpression((value as MessageDescriptor).body, key, locale, parameters, pluralArgs);
      if ("pluralArg" in schema && typeof schema.pluralArg === "string" && !pluralArgs.has(schema.pluralArg)) {
        throw new Error(`${locale}:${key}: missing declared plural argument ${schema.pluralArg}`);
      }
      if ("pluralArgs" in schema && Array.isArray(schema.pluralArgs)) {
        const expected = [...schema.pluralArgs].sort();
        const actual = [...pluralArgs].sort();
        if (actual.join("|") !== expected.join("|")) {
          throw new Error(`${locale}:${key}: plural arguments ${actual.join(",")} do not match schema ${expected.join(",")}`);
        }
      }
    }
  }
}

export async function validateRussianFixture(): Promise<Record<string, MessageValue>> {
  const path = join(LOCALES_ROOT, "fixtures", "ru-RU", "plurals.ts");
  validatePureResourceFile(path);
  const module = await import(`${pathToFileURL(path).href}?v=${Date.now()}`) as { MESSAGES: Record<string, MessageValue> };
  const value = module.MESSAGES["fixture.cardinal"] as MessageDescriptor;
  if (!value || value.$type !== "message") throw new Error("ru-RU fixture.cardinal must be a message descriptor");
  validateExpression(value.body, "fixture.cardinal", "ru-RU", new Map([["count", "integer"]]), new Set());
  const cases = module.MESSAGES["fixture.cases"];
  if (!Array.isArray(cases) || cases.some((entry) => typeof entry !== "string" || !/^\d+:(zero|one|two|few|many|other)$/.test(entry))) {
    throw new Error("ru-RU fixture.cases must contain value:category strings");
  }
  return module.MESSAGES;
}

export async function loadAndValidateProductionLocales(): Promise<Record<ProductionLocale, Record<string, MessageValue>>> {
  const output = {} as Record<ProductionLocale, Record<string, MessageValue>>;
  for (const locale of Object.keys(LOCALE_REGISTRY) as ProductionLocale[]) {
    const messages = await loadLocaleMessages(locale);
    validateLocaleBundle(locale, messages);
    output[locale] = messages;
  }
  const canonicalSourceLocale = sourceLocale();
  const source = output[canonicalSourceLocale];
  const sourceKeys = Object.keys(source).sort();
  for (const locale of Object.keys(LOCALE_REGISTRY) as ProductionLocale[]) {
    if (locale === canonicalSourceLocale) continue;
    const reviews = (LOCALE_SOURCE_REVIEWS as Record<string, Record<string, string>>)[locale];
    if (!reviews) throw new Error(`${locale}: missing source-review manifest`);
    const reviewKeys = Object.keys(reviews).sort();
    if (reviewKeys.join("\n") !== sourceKeys.join("\n")) throw new Error(`${locale}: review manifest keys do not match source locale`);
    for (const key of sourceKeys) {
      const expected = sourceHash(source[key]);
      if (reviews[key] !== expected) throw new Error(`${locale} translation requires review after source change: ${key}`);
    }
  }
  await validateRussianFixture();
  return output;
}

export function schemaEntriesBySurface(surface: "frontend" | "native"): Array<[string, SchemaEntry]> {
  return Object.entries(MESSAGE_SCHEMA).filter(([, entry]) => entry.surface === surface) as Array<[string, SchemaEntry]>;
}
