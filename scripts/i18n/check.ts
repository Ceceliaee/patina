import { join } from "node:path";
import {
  REPO_ROOT,
  loadAndValidateProductionLocales,
  validateLocaleBundle,
  validatePureResourceFile,
  type MessageDescriptor,
  type MessageValue,
} from "./core.ts";
import { compactFrontendValue, generateI18n } from "./generate.ts";

function expectFailure(label: string, run: () => void): void {
  try {
    run();
  } catch {
    return;
  }
  throw new Error(`i18n self-test did not reject ${label}`);
}

async function runSelfTest(): Promise<void> {
  const compactConcat = compactFrontendValue({ $op: "concat", parts: ["", 1, ""] }) as { $op?: string; parts?: unknown[] };
  if (compactConcat.$op !== "concat" || compactConcat.parts?.length !== 1 || compactConcat.parts[0] !== 1) {
    throw new Error("i18n generator must preserve concat string coercion while removing empty literals");
  }
  const locales = await loadAndValidateProductionLocales();
  const valid = locales["zh-CN"];

  const missing = { ...valid };
  delete missing[Object.keys(missing)[0]];
  expectFailure("a missing key", () => validateLocaleBundle("zh-CN", missing));

  expectFailure("an extra key", () => validateLocaleBundle("zh-CN", { ...valid, "invalid.extra": "x" }));

  const badArg = structuredClone(valid) as Record<string, MessageValue>;
  badArg["dashboard.tracking"] = {
    $type: "message",
    body: { $op: "arg", name: "missingArg" },
  } as MessageDescriptor;
  expectFailure("an unknown parameter", () => validateLocaleBundle("zh-CN", badArg));

  const invalidExpressions: Array<[string, unknown]> = [
    ["concat without parts", { $op: "concat" }],
    ["concat with non-array parts", { $op: "concat", parts: "x" }],
    ["if without else", { $op: "if", when: true, then: "x" }],
    ["eq with an extra field", { $op: "eq", left: 1, right: 1, extra: true }],
    ["notEq without right", { $op: "notEq", left: 1 }],
    ["coalesce without right", { $op: "coalesce", left: null }],
    ["subtract without right", { $op: "subtract", left: 1 }],
    ["element without index", { $op: "element", target: [] }],
    ["join without separator", { $op: "join", target: [] }],
    ["monthName with invalid style", { $op: "monthName", year: 2026, zeroBasedMonth: 0, style: "wide" }],
    ["monthName with a nonnumeric year", { $op: "monthName", year: "not-a-year", zeroBasedMonth: 0 }],
    ["monthName with an out-of-range year", { $op: "monthName", year: 1e20, zeroBasedMonth: 0 }],
    ["monthName with an invalid month", { $op: "monthName", year: 2026, zeroBasedMonth: 12 }],
    ["subtract with a string operand", { $op: "subtract", left: "1", right: 1 }],
    ["element with a scalar target", { $op: "element", target: "not-an-array", index: 0 }],
    ["join with a numeric separator", { $op: "join", target: [], separator: 1 }],
    ["if with a string condition", { $op: "if", when: "truthy", then: "x", else: "y" }],
  ];
  for (const [label, body] of invalidExpressions) {
    const invalid = structuredClone(valid) as Record<string, MessageValue>;
    invalid["dashboard.tracking"] = { $type: "message", body } as MessageDescriptor;
    expectFailure(label, () => validateLocaleBundle("zh-CN", invalid));
  }

  const badPlural = structuredClone(valid) as Record<string, MessageValue>;
  badPlural["data.selectedObjectCount"] = {
    $type: "message",
    body: { $op: "plural", arg: "count", cases: { one: "wrong", other: "other" } },
  } as MessageDescriptor;
  expectFailure("locale-inapplicable plural categories", () => validateLocaleBundle("zh-CN", badPlural));

  const badData = structuredClone(valid) as Record<string, MessageValue>;
  badData["settings.webActivityHelpSteps"] = [null] as unknown as MessageValue;
  expectFailure("malformed structured data", () => validateLocaleBundle("zh-CN", badData));

  expectFailure("an executable locale resource", () => validatePureResourceFile(join(REPO_ROOT, "tests", "fixtures", "i18n", "invalid-function.ts")));
  expectFailure("a spread locale resource", () => validatePureResourceFile(join(REPO_ROOT, "tests", "fixtures", "i18n", "invalid-spread.ts")));

  console.log("i18n checker self-tests passed");
}

if (process.argv.includes("--self-test")) await runSelfTest();
else {
  await loadAndValidateProductionLocales();
  await generateI18n(false);
  console.log("i18n resources, source reviews, fixtures, and generated output passed");
}
