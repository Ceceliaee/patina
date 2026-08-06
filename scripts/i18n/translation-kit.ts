import { sourceHash, stableStringify, type MessageDescriptor, type MessageValue } from "./core.ts";
import { MESSAGE_SCHEMA } from "../../locales/schema.ts";

export const TRANSLATION_KIT_FORMAT_VERSION = "1";
export const PLACEHOLDER_PATTERN = /⟦([A-Za-z][A-Za-z0-9_]*)⟧/g;

export type TranslationDirection = "ltr" | "rtl";

export interface TranslationUnit {
  context: string;
  developerNote: string;
  domain: string;
  key: string;
  parameters: string;
  placeholders: string;
  sourceText: string;
  surface: "frontend" | "native";
  unitId: string;
  valuePath: string;
  variant: string;
}

export interface TranslationKit {
  direction: TranslationDirection;
  formatVersion: string;
  immutableFingerprint: string;
  nativeLabel: string;
  schemaFingerprint: string;
  sourceFingerprint: string;
  sourceLocale: string;
  targetLocale: string;
  units: TranslationUnit[];
}

type ExpressionNode = Record<string, unknown>;
type PlaceholderPart = { expression: unknown; token: string };
type PatternPart = string | PlaceholderPart;
type TemplateTree =
  | { kind: "leaf"; parts: PatternPart[] }
  | { branchId: string; kind: "if"; when: unknown; then: TemplateTree; else: TemplateTree }
  | { arg: string; branchId: string; cases: Record<string, TemplateTree>; kind: "plural" };

interface CompiledMessage {
  tokens: Map<string, unknown>;
  tree: TemplateTree;
}

interface StaticPath {
  path: Array<string | number>;
  valuePath: string;
}

interface KitInternals {
  compiledMessages: Map<string, CompiledMessage>;
  sourceMessages: Record<string, MessageValue>;
  staticPaths: Map<string, StaticPath[]>;
}

const kitInternals = new WeakMap<TranslationKit, KitInternals>();

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isNode(value: unknown, op?: string): value is ExpressionNode {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && typeof (value as ExpressionNode).$op === "string" && (!op || (value as ExpressionNode).$op === op));
}

function pluralCategories(locale: string): string[] {
  return [...new Intl.PluralRules(locale, { type: "cardinal" }).resolvedOptions().pluralCategories].sort();
}

function humanize(segment: string): string {
  return segment
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

function contextFor(key: string, surface: "frontend" | "native", description?: string): string {
  const location = key.split(".").map(humanize).join(" › ");
  const base = `${surface === "native" ? "Native surface" : "Application interface"} · ${location}`;
  return description ? `${base} — ${description}` : base;
}

function developerNoteFor(key: string, variant: string, translatorNote?: string): string {
  const notes: string[] = [];
  if (translatorNote) notes.push(translatorNote);
  if (key.startsWith("accessibility.")) notes.push("Screen-reader text; translate meaning, not visual layout.");
  if (key.startsWith("native.")) notes.push("Shown by a native tray, reminder, or export surface.");
  if (variant.includes("plural")) notes.push("Translate for the stated CLDR plural category.");
  return notes.join(" ");
}

function tokenBase(expression: unknown): string {
  if (isNode(expression, "arg") && typeof expression.name === "string") return expression.name;
  if (isNode(expression, "join") && isNode(expression.target, "arg") && typeof expression.target.name === "string") return expression.target.name;
  if (isNode(expression, "coalesce") && isNode(expression.left, "arg") && typeof expression.left.name === "string") return expression.left.name;
  if (isNode(expression, "monthName")) return "monthName";
  return isNode(expression) ? String(expression.$op) : "value";
}

function createTokenRegistry(): { register: (expression: unknown) => PlaceholderPart; tokens: Map<string, unknown> } {
  const tokens = new Map<string, unknown>();
  const tokenByExpression = new Map<string, string>();
  return {
    tokens,
    register(expression) {
      const identity = stableStringify(expression);
      const existing = tokenByExpression.get(identity);
      if (existing) return { expression: tokens.get(existing), token: existing };
      const base = tokenBase(expression).replace(/[^A-Za-z0-9_]/g, "") || "value";
      let token = base;
      let suffix = 2;
      while (tokens.has(token)) token = `${base}_${suffix++}`;
      const copy = clone(expression);
      tokens.set(token, copy);
      tokenByExpression.set(identity, token);
      return { expression: copy, token };
    },
  };
}

function concatTrees(left: TemplateTree, right: TemplateTree): TemplateTree {
  if (left.kind === "leaf" && right.kind === "leaf") return { kind: "leaf", parts: [...left.parts, ...right.parts] };
  if (left.kind === "if") return { ...left, then: concatTrees(left.then, right), else: concatTrees(left.else, right) };
  if (left.kind === "plural") return { ...left, cases: Object.fromEntries(Object.entries(left.cases).map(([category, child]) => [category, concatTrees(child, right)])) };
  if (right.kind === "if") return { ...right, then: concatTrees(left, right.then), else: concatTrees(left, right.else) };
  const pluralRight = right as Extract<TemplateTree, { kind: "plural" }>;
  return { ...pluralRight, cases: Object.fromEntries(Object.entries(pluralRight.cases).map(([category, child]) => [category, concatTrees(left, child)])) };
}

function compileExpression(expression: unknown, path: string, targetLocale: string, register: (expression: unknown) => PlaceholderPart): TemplateTree {
  if (typeof expression === "string") {
    if (expression.includes("⟦") || expression.includes("⟧")) throw new Error(`Source text uses reserved translation placeholder brackets at ${path}`);
    return { kind: "leaf", parts: [expression] };
  }
  if (isNode(expression, "if")) {
    return {
      branchId: `if@${path}`,
      kind: "if",
      when: clone(expression.when),
      then: compileExpression(expression.then, `${path}/then`, targetLocale, register),
      else: compileExpression(expression.else, `${path}/else`, targetLocale, register),
    };
  }
  if (isNode(expression, "plural")) {
    const sourceCases = expression.cases as Record<string, unknown>;
    const cases = Object.fromEntries(pluralCategories(targetLocale).map((category) => [
      category,
      compileExpression(sourceCases[category] ?? sourceCases.other, `${path}/cases/${category}`, targetLocale, register),
    ]));
    return { arg: String(expression.arg), branchId: `plural:${String(expression.arg)}@${path}`, cases, kind: "plural" };
  }
  if (isNode(expression, "concat")) {
    const parts = expression.parts as unknown[];
    return parts.reduce<TemplateTree>((tree, part, index) => concatTrees(tree, compileExpression(part, `${path}/parts/${index}`, targetLocale, register)), { kind: "leaf", parts: [] });
  }
  return { kind: "leaf", parts: [register(expression)] };
}

function pattern(parts: PatternPart[]): string {
  return parts.map((part) => typeof part === "string" ? part : `⟦${part.token}⟧`).join("");
}

function unitId(key: string, variants: string[]): string {
  return `${key}::${variants.length ? variants.join("|") : "default"}`;
}

function flattenMessage(
  key: string,
  entry: { description?: string; params: readonly { name: string; type: string; optional: boolean }[]; surface: "frontend" | "native"; translatorNote?: string },
  tree: TemplateTree,
): TranslationUnit[] {
  const output: TranslationUnit[] = [];
  const walk = (node: TemplateTree, variants: string[]): void => {
    if (node.kind === "if") {
      walk(node.then, [...variants, `${node.branchId}:then`]);
      walk(node.else, [...variants, `${node.branchId}:else`]);
      return;
    }
    if (node.kind === "plural") {
      for (const [category, child] of Object.entries(node.cases)) walk(child, [...variants, `${node.branchId}:${category}`]);
      return;
    }
    const sourceText = pattern(node.parts);
    const placeholderTokens = node.parts.filter((part): part is PlaceholderPart => typeof part !== "string").map((part) => part.token);
    if (sourceText === "" && placeholderTokens.length === 0) return;
    const variant = variants.length ? variants.join(" · ") : "default";
    output.push({
      context: contextFor(key, entry.surface, entry.description),
      developerNote: developerNoteFor(key, variant, entry.translatorNote),
      domain: key.split(".")[0],
      key,
      parameters: entry.params.map((param) => `${param.name}: ${param.type}${param.optional ? " (optional)" : ""}`).join(", "),
      placeholders: [...new Set(placeholderTokens)].map((token) => `⟦${token}⟧`).join(", "),
      sourceText,
      surface: entry.surface,
      unitId: unitId(key, variants),
      valuePath: "message",
      variant,
    });
  };
  walk(tree, []);
  return output;
}

function pointer(path: Array<string | number>): string {
  return path.length ? path.map((segment) => `[${JSON.stringify(segment)}]`).join("") : "value";
}

function staticUnit(key: string, entry: { description?: string; params: readonly unknown[]; surface: "frontend" | "native"; translatorNote?: string }, path: Array<string | number>, sourceText: string): TranslationUnit {
  const valuePath = pointer(path);
  return {
    context: contextFor(key, entry.surface, entry.description),
    developerNote: developerNoteFor(key, valuePath, entry.translatorNote),
    domain: key.split(".")[0],
    key,
    parameters: "",
    placeholders: "",
    sourceText,
    surface: entry.surface,
    unitId: `${key}::${valuePath}`,
    valuePath,
    variant: valuePath,
  };
}

function collectStaticPaths(kind: string, value: unknown): StaticPath[] {
  if (kind === "string") return [{ path: [], valuePath: "value" }];
  if (kind === "string-array") return (value as readonly string[]).map((_, index) => ({ path: [index], valuePath: pointer([index]) }));
  if (kind === "string-record") return Object.keys(value as Record<string, string>).map((field) => ({ path: [field], valuePath: pointer([field]) }));
  if (kind !== "data") return [];
  const paths: StaticPath[] = [];
  (value as unknown[]).forEach((stepValue, stepIndex) => {
    const step = stepValue as Record<string, unknown>;
    for (const field of ["title", "description"] as const) paths.push({ path: [stepIndex, field], valuePath: pointer([stepIndex, field]) });
    (step.details as unknown[]).forEach((detail, detailIndex) => {
      if (typeof detail === "string") paths.push({ path: [stepIndex, "details", detailIndex], valuePath: pointer([stepIndex, "details", detailIndex]) });
      else {
        const record = detail as Record<string, unknown>;
        paths.push({ path: [stepIndex, "details", detailIndex, "text"], valuePath: pointer([stepIndex, "details", detailIndex, "text"]) });
        (record.links as unknown[]).forEach((_, linkIndex) => paths.push({ path: [stepIndex, "details", detailIndex, "links", linkIndex, "label"], valuePath: pointer([stepIndex, "details", detailIndex, "links", linkIndex, "label"]) }));
      }
    });
  });
  return paths;
}

function readPath(value: unknown, path: Array<string | number>): unknown {
  let cursor = value;
  for (const segment of path) cursor = (cursor as Record<string | number, unknown>)[segment];
  return cursor;
}

function writePath(value: unknown, path: Array<string | number>, replacement: string): unknown {
  if (path.length === 0) return replacement;
  const output = clone(value) as Record<string | number, unknown>;
  let cursor = output;
  for (const segment of path.slice(0, -1)) cursor = cursor[segment] as Record<string | number, unknown>;
  cursor[path[path.length - 1]] = replacement;
  return output;
}

function immutableUnit(unit: TranslationUnit): unknown {
  return {
    context: unit.context,
    developerNote: unit.developerNote,
    domain: unit.domain,
    key: unit.key,
    parameters: unit.parameters,
    placeholders: unit.placeholders,
    sourceText: unit.sourceText,
    surface: unit.surface,
    unitId: unit.unitId,
    valuePath: unit.valuePath,
    variant: unit.variant,
  };
}

export function buildTranslationKit(
  sourceLocale: string,
  targetLocale: string,
  nativeLabel: string,
  direction: TranslationDirection,
  sourceMessages: Record<string, MessageValue>,
): TranslationKit {
  const units: TranslationUnit[] = [];
  const compiledMessages = new Map<string, CompiledMessage>();
  const staticPaths = new Map<string, StaticPath[]>();
  for (const [key, schemaValue] of Object.entries(MESSAGE_SCHEMA)) {
    const entry = schemaValue as { description?: string; kind: string; params: readonly { name: string; type: string; optional: boolean }[]; surface: "frontend" | "native"; translatorNote?: string };
    for (const [field, metadata] of [["description", entry.description], ["translatorNote", entry.translatorNote]] as const) {
      if (metadata !== undefined && (typeof metadata !== "string" || !metadata.trim())) throw new Error(`${key}: schema ${field} must be a non-empty string when present`);
    }
    const value = sourceMessages[key];
    if (entry.kind === "message") {
      const registry = createTokenRegistry();
      const tree = compileExpression((value as MessageDescriptor).body, "body", targetLocale, registry.register);
      compiledMessages.set(key, { tokens: registry.tokens, tree });
      units.push(...flattenMessage(key, entry, tree));
    } else {
      const paths = collectStaticPaths(entry.kind, value).filter((item) => String(readPath(value, item.path)) !== "");
      staticPaths.set(key, paths);
      for (const item of paths) units.push(staticUnit(key, entry, item.path, String(readPath(value, item.path))));
    }
  }
  const schemaFingerprint = sourceHash(MESSAGE_SCHEMA);
  const sourceFingerprint = sourceHash(sourceMessages);
  const immutableFingerprint = sourceHash(units.map(immutableUnit));
  const kit: TranslationKit = {
    direction,
    formatVersion: TRANSLATION_KIT_FORMAT_VERSION,
    immutableFingerprint,
    nativeLabel,
    schemaFingerprint,
    sourceFingerprint,
    sourceLocale,
    targetLocale,
    units,
  };
  kitInternals.set(kit, { compiledMessages, sourceMessages, staticPaths });
  return kit;
}

function placeholderMultiset(value: string): string[] {
  return [...value.matchAll(new RegExp(PLACEHOLDER_PATTERN.source, "g"))].map((match) => match[1]).sort();
}

function materializePattern(value: string, tokens: Map<string, unknown>, expected: string): unknown {
  const expectedTokens = placeholderMultiset(expected);
  const actualTokens = placeholderMultiset(value);
  if (stableStringify(actualTokens) !== stableStringify(expectedTokens)) {
    throw new Error(`Placeholder mismatch; expected [${expectedTokens.join(", ")}], received [${actualTokens.join(", ")}]`);
  }
  const parts: unknown[] = [];
  let cursor = 0;
  for (const match of value.matchAll(new RegExp(PLACEHOLDER_PATTERN.source, "g"))) {
    if (match.index > cursor) parts.push(value.slice(cursor, match.index));
    const expression = tokens.get(match[1]);
    if (expression === undefined) throw new Error(`Unknown placeholder ${match[0]}`);
    parts.push(clone(expression));
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : { $op: "concat", parts };
}

function materializeTree(key: string, node: TemplateTree, tokens: Map<string, unknown>, translations: ReadonlyMap<string, string>, variants: string[] = []): unknown {
  if (node.kind === "if") {
    return {
      $op: "if",
      when: clone(node.when),
      then: materializeTree(key, node.then, tokens, translations, [...variants, `${node.branchId}:then`]),
      else: materializeTree(key, node.else, tokens, translations, [...variants, `${node.branchId}:else`]),
    };
  }
  if (node.kind === "plural") {
    return {
      $op: "plural",
      arg: node.arg,
      cases: Object.fromEntries(Object.entries(node.cases).map(([category, child]) => [category, materializeTree(key, child, tokens, translations, [...variants, `${node.branchId}:${category}`])])),
    };
  }
  const id = unitId(key, variants);
  const translated = translations.get(id);
  const sourcePattern = pattern(node.parts);
  if (sourcePattern === "" && translated === undefined) return "";
  if (!translated?.trim()) throw new Error(`${id}: translation is required`);
  return materializePattern(translated, tokens, sourcePattern);
}

export function materializeTranslationKit(kit: TranslationKit, translations: ReadonlyMap<string, string>): Record<string, MessageValue> {
  const internals = kitInternals.get(kit);
  if (!internals) throw new Error("Translation kit was not created by buildTranslationKit in this process");
  const expectedIds = new Set(kit.units.map((unit) => unit.unitId));
  for (const id of translations.keys()) if (!expectedIds.has(id)) throw new Error(`Unknown translation unit ${id}`);
  const output: Record<string, MessageValue> = {};
  for (const [key, schemaValue] of Object.entries(MESSAGE_SCHEMA)) {
    const entry = schemaValue as { kind: string };
    if (entry.kind === "message") {
      const compiled = internals.compiledMessages.get(key)!;
      output[key] = { $type: "message", body: materializeTree(key, compiled.tree, compiled.tokens, translations) } as MessageDescriptor;
      continue;
    }
    let value: unknown = internals.sourceMessages[key];
    for (const item of internals.staticPaths.get(key) ?? []) {
      const id = `${key}::${item.valuePath}`;
      const translated = translations.get(id);
      if (!translated?.trim()) throw new Error(`${id}: translation is required`);
      value = writePath(value, item.path, translated);
    }
    output[key] = value as MessageValue;
  }
  return output;
}

export function verifyKitMetadata(kit: TranslationKit, metadata: Record<string, string>): void {
  const expected: Record<string, string> = {
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
  for (const [key, value] of Object.entries(expected)) {
    if (metadata[key] !== value) throw new Error(`Translation kit metadata mismatch for ${key}; expected ${value}, received ${metadata[key] ?? "missing"}`);
  }
}

export function verifyImmutableUnit(expected: TranslationUnit, actual: Record<string, string>): void {
  for (const key of ["unitId", "domain", "context", "surface", "key", "variant", "sourceText", "placeholders", "parameters", "developerNote"] as const) {
    if ((actual[key] ?? "") !== expected[key]) throw new Error(`${expected.unitId}: immutable workbook column ${key} was changed`);
  }
}
