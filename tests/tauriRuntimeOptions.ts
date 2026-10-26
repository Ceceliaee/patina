import assert from "node:assert/strict";

export const runtimeGroups = ["contracts", "data-recovery", "storage-restart", "webview-recovery", "window-lifecycle", "mini-input", "resources"] as const;
export type RuntimeGroup = typeof runtimeGroups[number];

export function parseRuntimeOptions(args: string[]) {
  let group: RuntimeGroup | null = null;
  let resourceCycles = false;
  let prepareOnly = false;
  let prepared: string | null = null;
  let feedback = false;
  for(let index = 0;index < args.length;index++) {
    const argument = args[index];
    if(argument === "--feedback") {
      assert.ok(!feedback, "Duplicate --feedback"); feedback = true;
    } else if(argument === "--resource-cycles") {
      assert.ok(!resourceCycles, "Duplicate --resource-cycles"); resourceCycles = true;
    } else if(argument === "--prepare-only") {
      assert.ok(!prepareOnly, "Duplicate --prepare-only"); prepareOnly = true;
    } else if(argument === "--group") {
      assert.equal(group, null, "Only one --group is accepted");
      const value = args[++index];
      assert.ok(runtimeGroups.includes(value as RuntimeGroup), `Unknown runtime group: ${value}`);
      group = value as RuntimeGroup;
    } else if(argument === "--prepared") {
      assert.equal(prepared, null, "Duplicate --prepared");
      prepared = args[++index];
      assert.ok(prepared && !prepared.startsWith("--"), "--prepared requires a manifest path");
    } else throw new Error(`Unknown runtime argument: ${argument}`);
  }
  assert.ok(!(group && resourceCycles), "--group and --resource-cycles cannot be combined");
  assert.ok(!(prepareOnly && (group || resourceCycles || prepared || feedback)), "--prepare-only cannot be combined with execution options");
  assert.ok(!feedback || (group && group !== "resources" && !resourceCycles), "--feedback requires one non-resource --group");
  return { group, resourceCycles, prepareOnly, prepared, feedback };
}

export function miniFeedbackSamples(feedback: boolean) {
  return feedback ? { hover: 3, reopen: 2 } : { hover: 50, reopen: 10 };
}

export function assertRuntimeResults(expected: readonly string[], results: Array<{ group: string; status: string }>) {
  assert.ok(expected.length > 0, "Runtime requires at least one group");
  assert.equal(new Set(expected).size, expected.length, "Duplicate required runtime group");
  assert.deepEqual(results.map(result => result.group).sort(), [...expected].sort(), "Runtime result set differs from required groups");
  assert.ok(results.every(result => result.status === "passed"), "Required runtime group did not pass");
}

export function selectRuntimeGroups(options: ReturnType<typeof parseRuntimeOptions>): RuntimeGroup[] {
  return options.group ? [options.group] : runtimeGroups.filter(group => options.resourceCycles ? group !== "mini-input" : group !== "resources");
}

export function assertResourceEnvironment(env: NodeJS.ProcessEnv) {
  assert.ok(!env.PATINA_COVERAGE_TARGET_DIR && !/instrument-coverage|profile-generate|sanitizer/.test(`${env.RUSTFLAGS ?? ""} ${env.CARGO_ENCODED_RUSTFLAGS ?? ""}`), "Resource acceptance requires an uninstrumented build");
}
