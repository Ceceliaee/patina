import assert from "node:assert/strict";
import test from "node:test";
import { resolveAppIconKeys } from "../src/shared/classification/appIconIdentity.ts";
import { resolveStableDomainColor } from "../src/shared/classification/domainColor.ts";
import { formatExecutableFallbackName } from "../src/shared/classification/executableDisplayName.ts";
import {
  countInclusiveLocalDays,
  getIsoWeek,
  maxLocalDate,
  minLocalDate,
} from "../src/shared/lib/localDate.ts";
import { touchBoundedDataCacheEntry } from "../src/features/data/services/dataLruCache.ts";
import { formatDestinationTime } from "../src/features/destination/services/destinationTimeFormatting.ts";
import {
  formatScheduledDateTime,
  formatScheduledSize,
  scheduledMinutesToTime,
  scheduledTimeToMinutes,
} from "../src/features/settings/services/scheduledTaskPresentation.ts";
import {
  getBrowserLocalStorage,
  readBrowserStorage,
  removeBrowserStorage,
  writeBrowserStorage,
} from "../src/platform/browser/browserStorageGateway.ts";
import { MemoryStorage, withWindowValue } from "./helpers/browserTestGlobals.ts";
import {
  isFiniteNumber,
  isNullableString,
  isObjectRecord,
  isPlainRecord,
  isStringArray,
} from "../src/shared/lib/runtimeTypeGuards.ts";

test("local date range primitives preserve inclusive and ISO boundary semantics", () => {
  assert.equal(countInclusiveLocalDays("2024-02-28", "2024-03-01"), 3);
  assert.equal(countInclusiveLocalDays("2024-03-01", "2024-02-28"), 0);
  assert.equal(countInclusiveLocalDays("invalid", "2024-03-01"), 0);
  assert.deepEqual(getIsoWeek(new Date(2021, 0, 1)), { week: 53, year: 2020 });
  const earlier = new Date(2026, 0, 1);
  const later = new Date(2026, 0, 2);
  assert.equal(minLocalDate(earlier, later), earlier);
  assert.equal(maxLocalDate(earlier, later), later);
});

test("domain colors are stable, normalized-input sensitive, and palette bounded", () => {
  const first = resolveStableDomainColor("example.com");
  assert.equal(resolveStableDomainColor("example.com"), first);
  assert.match(first, /^#[0-9A-F]{6}$/);
  assert.notEqual(resolveStableDomainColor("another.example"), first);
});

test("app icon identity keeps raw, normalized, and canonical lookup aliases together", () => {
  const keys = resolveAppIconKeys("  Code.EXE  ");
  assert.equal(keys[0], "Code.EXE");
  assert.ok(keys.includes("code.exe"));
  assert.equal(new Set(keys).size, keys.length);
});

test("executable fallback display names share one punctuation and casing policy", () => {
  assert.equal(formatExecutableFallbackName("visual_studio-code.exe"), "Visual Studio Code");
  assert.equal(formatExecutableFallbackName("already readable"), "Already Readable");
});

test("scheduled task presentation keeps backup and export boundary formatting", () => {
  assert.equal(scheduledMinutesToTime(-1), "00:00");
  assert.equal(scheduledMinutesToTime(1_500), "23:59");
  assert.equal(scheduledTimeToMinutes("02:30"), 150);
  assert.equal(scheduledTimeToMinutes("bad"), 120);
  assert.equal(formatScheduledDateTime(null), "");
  assert.ok(formatScheduledDateTime(0).length > 0);
  assert.equal(formatScheduledSize(null), "");
  assert.equal(formatScheduledSize(1_048_576), "1.00 MB");
  assert.equal(formatScheduledSize(10 * 1_048_576), "10.0 MB");
});

test("destination time formatting preserves the explicit end-of-day label", () => {
  const dayEndMs = new Date(2026, 0, 2).getTime();
  assert.equal(formatDestinationTime(dayEndMs, dayEndMs, "en-US"), "24:00");
  assert.match(formatDestinationTime(dayEndMs - 60_000, dayEndMs, "en-US"), /23:59|24:59/);
});

test("data LRU touch refreshes recency and evicts the oldest entry", () => {
  const cache = new Map<string, number>([["a", 1], ["b", 2]]);
  touchBoundedDataCacheEntry(cache, "a", 3, 2);
  touchBoundedDataCacheEntry(cache, "c", 4, 2);
  assert.deepEqual([...cache], [["a", 3], ["c", 4]]);
});

test("runtime guards keep array-tolerant and plain-record semantics explicit", () => {
  assert.equal(isObjectRecord([]), true);
  assert.equal(isPlainRecord([]), false);
  assert.equal(isPlainRecord({ value: 1 }), true);
  assert.equal(isFiniteNumber(Number.POSITIVE_INFINITY), false);
  assert.equal(isNullableString(null), true);
  assert.equal(isStringArray(["a", "b"]), true);
  assert.equal(isStringArray(["a", 1]), false);
});

test("browser storage gateway fails closed for SecurityError-like access", () => {
  withWindowValue(Object.defineProperty({}, "localStorage", {
    configurable: true,
    get() {
      throw new Error("storage denied");
    },
  }), () => {
    assert.equal(getBrowserLocalStorage(), null);
    assert.equal(readBrowserStorage("key"), null);
    assert.equal(writeBrowserStorage("key", "value"), false);
    assert.equal(removeBrowserStorage("key"), false);
  });
});

test("browser storage gateway performs guarded reads, writes, and removals", () => {
  const storage = new MemoryStorage();
  withWindowValue({ localStorage: storage }, () => {
    assert.equal(writeBrowserStorage("key", "value"), true);
    assert.equal(readBrowserStorage("key"), "value");
    assert.equal(removeBrowserStorage("key"), true);
    assert.equal(readBrowserStorage("key"), null);
  });
});
