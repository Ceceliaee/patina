import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveNativeSessionPrecedence,
  type OwnedTimeRange,
} from "../src/platform/persistence/nativeSessionPrecedence.ts";

function range(
  key: string,
  origin: OwnedTimeRange<string>["origin"],
  startTime: number,
  endTime: number,
  capacityEndTime?: number,
): OwnedTimeRange<string> {
  return { key, origin, startTime, endTime, capacityEndTime };
}

function compact(rows: OwnedTimeRange<string>[]) {
  return rows.map(({ key, origin, startTime, endTime }) => [key, origin, startTime, endTime]);
}

test("native sessions split an overlapping external exact record without changing native facts", () => {
  const resolved = resolveNativeSessionPrecedence([
    range("external", "import_exact", 50, 250),
    range("native", "native", 100, 200),
  ]);

  assert.deepEqual(compact(resolved), [
    ["external", "import_exact", 50, 100],
    ["native", "native", 100, 200],
    ["external", "import_exact", 200, 250],
  ]);
});

test("multiple native intervals leave only the uncovered external exact fragments", () => {
  const resolved = resolveNativeSessionPrecedence([
    range("external", "import_exact", 50, 250),
    range("native-a", "native", 100, 150),
    range("native-b", "native", 175, 225),
  ]);

  assert.deepEqual(compact(resolved).filter((row) => row[1] === "import_exact"), [
    ["external", "import_exact", 50, 100],
    ["external", "import_exact", 150, 175],
    ["external", "import_exact", 225, 250],
  ]);
});

test("fully covered external exact records disappear from the effective read model", () => {
  const resolved = resolveNativeSessionPrecedence([
    range("native", "native", 0, 100),
    range("external", "import_exact", 20, 80),
  ]);
  assert.deepEqual(compact(resolved), [["native", "native", 0, 100]]);
});

test("earlier external exact facts take precedence over later overlapping external exact facts", () => {
  const resolved = resolveNativeSessionPrecedence([
    range("first", "import_exact", 0, 100),
    range("second", "import_exact", 50, 150),
  ]);
  assert.deepEqual(compact(resolved), [
    ["first", "import_exact", 0, 100],
    ["second", "import_exact", 100, 150],
  ]);
});

test("hour buckets share only the capacity left after native and external exact facts", () => {
  const hour = 3_600_000;
  const minute = 60_000;
  const resolved = resolveNativeSessionPrecedence([
    range("native", "native", 0, 20 * minute),
    range("exact", "import_exact", 20 * minute, 30 * minute),
    range("bucket-a", "import_bucket", 0, 30 * minute, hour),
    range("bucket-b", "import_bucket", 0, 30 * minute, hour),
  ]);
  const buckets = resolved.filter((row) => row.origin === "import_bucket");
  assert.deepEqual(compact(buckets), [
    ["bucket-a", "import_bucket", 0, 15 * minute],
    ["bucket-b", "import_bucket", 0, 15 * minute],
  ]);
});

test("non-overlapping facts keep their original durations", () => {
  const resolved = resolveNativeSessionPrecedence([
    range("native", "native", 0, 100),
    range("external", "import_exact", 100, 200),
    range("bucket", "import_bucket", 300, 350, 400),
  ]);
  assert.deepEqual(compact(resolved), [
    ["native", "native", 0, 100],
    ["external", "import_exact", 100, 200],
    ["bucket", "import_bucket", 300, 350],
  ]);
});

test("large exact imports resolve without repeated whole-set merging", () => {
  const records = Array.from({ length: 10_000 }, (_, index) => ({
    key: `exact-${index}`,
    origin: "import_exact" as const,
    startTime: index,
    endTime: 20_000 - index,
    value: index,
  }));

  const resolved = resolveNativeSessionPrecedence(records);
  assert.deepEqual(
    resolved.map(({ startTime, endTime, value }) => ({ startTime, endTime, value })),
    [{ startTime: 0, endTime: 20_000, value: 0 }],
  );
});
