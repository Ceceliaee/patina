import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, constants, copyFileSync, createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

export interface RuntimeMeasurementOptions {
  output: string;
  samples: number;
  warmupSeconds: number;
  resourceSeconds: number;
  intervalSeconds: number;
  fixtureManifest?: string;
}

interface FixtureQuery {
  startMs: number;
  endMs: number;
  localDayBoundariesMs: number[];
  expectedTotalDurationMs: number;
  boundaryTimezone: "UTC";
  verifiedDiversity?: { appCount: number; projectionAppCount: number; importSourceCount: number; domainCount: number };
}

interface RuntimeFixtureManifest {
  fixtureVersion: 2;
  profile: "e0" | "30d" | "r1" | "r3";
  days: number;
  seed: { kind: "deterministic-grid"; version: 2; utcStartMs: number; cohortDays: number;
    dailyCoverageStartOffsetMs: number; dailyCoverageEndOffsetMs: number };
  database: { file: "patina.db"; sha256: string; bytes: number; checkpointed: true; closed: true };
  schemaIdentity: { userVersion: number; sqlxMigrations: Array<{ version: number; checksum: string; success: boolean }> };
  query: FixtureQuery;
  yearQuery: FixtureQuery & { year: number; factDays: number };
  dailyOracle: Array<{ dayStartMs: number; totalDurationMs: number; nativeDurationMs: number; importedDurationMs: number }>;
}

export function parseRuntimeFixtureManifest(value: unknown): RuntimeFixtureManifest {
  assert.ok(value && typeof value === "object", "fixture manifest must be an object");
  const fixture = value as RuntimeFixtureManifest;
  const profiles = { e0: 0, "30d": 30, r1: 365, r3: 1095 };
  assert.equal(fixture.fixtureVersion, 2, "only fixture-v2 is supported");
  assert.ok(Object.hasOwn(profiles, fixture.profile) && fixture.days === profiles[fixture.profile], "invalid fixture profile/days");
  assert.equal(fixture.seed?.kind, "deterministic-grid");
  assert.equal(fixture.seed.version, 2);
  assert.equal(fixture.seed.utcStartMs, Date.UTC(2023, 0, 1));
  assert.equal(fixture.seed.cohortDays, 365);
  assert.equal(fixture.seed.dailyCoverageStartOffsetMs, 0);
  assert.equal(fixture.seed.dailyCoverageEndOffsetMs, 36_000_000);
  assert.equal(fixture.database?.file, "patina.db", "fixture database must be the adjacent patina.db");
  assert.match(fixture.database.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(fixture.database.bytes) && fixture.database.bytes > 0);
  assert.equal(fixture.database.closed, true);
  assert.equal(fixture.database.checkpointed, true);
  assert.ok(Number.isSafeInteger(fixture.schemaIdentity?.userVersion));
  assert.ok(Array.isArray(fixture.schemaIdentity.sqlxMigrations) && fixture.schemaIdentity.sqlxMigrations.length > 0);
  fixture.schemaIdentity.sqlxMigrations.forEach((migration, index, rows) => {
    assert.ok(Number.isSafeInteger(migration.version) && migration.version > (rows[index - 1]?.version ?? -1));
    assert.match(migration.checksum, /^[a-f0-9]{96}$/i);
    assert.equal(migration.success, true);
  });
  assert.ok(Array.isArray(fixture.dailyOracle) && fixture.dailyOracle.length === fixture.days);
  fixture.dailyOracle.forEach((day, index) => {
    assert.equal(day.dayStartMs, fixture.seed.utcStartMs + index * 86_400_000);
    assert.equal(day.nativeDurationMs, 16_200_000);
    assert.equal(day.importedDurationMs, 5_400_000);
    assert.equal(day.totalDurationMs, day.nativeDurationMs + day.importedDurationMs);
  });
  for (const query of [fixture.query, fixture.yearQuery]) {
    assert.equal(query?.boundaryTimezone, "UTC");
    assert.ok(Number.isSafeInteger(query.startMs) && Number.isSafeInteger(query.endMs) && query.endMs > query.startMs);
    assert.ok(Array.isArray(query.localDayBoundariesMs) && query.localDayBoundariesMs.length >= 2);
    assert.equal(query.localDayBoundariesMs[0], query.startMs);
    assert.equal(query.localDayBoundariesMs.at(-1), query.endMs);
    query.localDayBoundariesMs.forEach((boundary, index, rows) => {
      assert.ok(Number.isSafeInteger(boundary) && (index === 0 || boundary > rows[index - 1]));
    });
    assert.equal(query.expectedTotalDurationMs, fixtureExpectedTotal(fixture, query.startMs, query.endMs));
    if (fixture.days > 0) {
      assert.ok(query.verifiedDiversity, "populated fixtures must declare verified range diversity");
      for (const key of ["appCount", "projectionAppCount", "importSourceCount", "domainCount"] as const) {
        assert.ok(Number.isSafeInteger(query.verifiedDiversity[key]) && query.verifiedDiversity[key] > 0);
      }
      assert.ok(query.verifiedDiversity.projectionAppCount <= query.verifiedDiversity.appCount);
    }
  }
  assert.equal(fixture.yearQuery.year, fixture.profile === "r3" ? 2025 : 2023);
  assert.equal(fixture.yearQuery.startMs, Date.UTC(fixture.yearQuery.year, 0, 1));
  assert.equal(fixture.yearQuery.endMs, Date.UTC(fixture.yearQuery.year + 1, 0, 1));
  assert.equal(fixture.yearQuery.factDays * 21_600_000, fixture.yearQuery.expectedTotalDurationMs);
  const queryDays = Math.min(fixture.days, 365);
  assert.equal(fixture.query.startMs, fixture.seed.utcStartMs + (fixture.days - queryDays) * 86_400_000);
  assert.equal(fixture.query.endMs, fixture.seed.utcStartMs + (fixture.days === 0 ? 86_400_000 : (fixture.days - 1) * 86_400_000 + 36_000_000));
  assert.equal(fixture.query.localDayBoundariesMs.length, Math.max(queryDays, 1) + 1);
  assert.equal(fixture.yearQuery.localDayBoundariesMs.length, (fixture.yearQuery.endMs - fixture.yearQuery.startMs) / 86_400_000 + 1);
  for (const query of [fixture.query, fixture.yearQuery]) {
    query.localDayBoundariesMs.slice(0, -1).forEach((boundary, index) => assert.equal(boundary, query.startMs + index * 86_400_000));
  }
  return fixture;
}

export function fixtureExpectedTotal(fixture: RuntimeFixtureManifest, startMs: number, endMs: number) {
  return fixture.dailyOracle.reduce((total, day) => {
    const start = day.dayStartMs + fixture.seed.dailyCoverageStartOffsetMs;
    const end = day.dayStartMs + fixture.seed.dailyCoverageEndOffsetMs;
    if (end <= startMs || start >= endMs) return total;
    assert.ok(start >= startMs && end <= endMs, "local range cuts a fixture day; this oracle cannot validate partial-day time zones");
    return total + day.totalDurationMs;
  }, 0);
}

interface FixtureReadModelStatus {
  sourceRevision: number;
  activityHourlyState: string;
  activityCoverageStartMs: number | null;
  activityCoverageEndMs: number | null;
  dirtyRangeCount: number;
}

interface FixtureProjectionSample {
  readPath: string;
  fallbackReason: string | null;
  sourceRevision: number;
  projectionRows: number;
  factRows: number;
  readModelBefore: FixtureReadModelStatus;
  readModelAfter: FixtureReadModelStatus;
}

export function assertFixtureProjectionSample(
  fixture: RuntimeFixtureManifest,
  query: { startMs: number; endMs: number; allowEmptyBoundaryFallback?: boolean },
  sample: FixtureProjectionSample,
) {
  const status = sample.readModelBefore;
  assert.ok(status && typeof status === "object", "fixture read-model metadata is missing");
  assert.equal(status.activityHourlyState, "ready", "fixture read model is not ready");
  assert.equal(status.dirtyRangeCount, 0, "fixture measurement requires no pending dirty ranges");
  assert.ok(Number.isSafeInteger(status.sourceRevision) && status.sourceRevision >= 0, "invalid fixture source revision");
  const start = status.activityCoverageStartMs;
  const end = status.activityCoverageEndMs;
  assert.ok(typeof start === "number" && typeof end === "number"
    && Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start, "invalid fixture projection coverage");
  assert.deepEqual(sample.readModelAfter, status, "fixture read-model metadata changed during measurement");
  assert.equal(sample.sourceRevision, status.sourceRevision, "fixture response source revision changed");
  assert.equal(sample.factRows, 0, "historical fixture unexpectedly returned effective fact rows");
  assert.ok(Number.isSafeInteger(sample.projectionRows) && sample.projectionRows > 0, "historical fixture did not read projection rows");
  const outside = [
    [query.startMs, Math.min(query.endMs, start)],
    [Math.max(query.startMs, end), query.endMs],
  ].filter(([from, to]) => from < to);
  if (outside.length > 0) {
    assert.equal(query.allowEmptyBoundaryFallback, true, "fixture query unexpectedly exceeds projection coverage");
    for (const [from, to] of outside) {
      assert.equal(fixtureExpectedTotal(fixture, from, to), 0, "fallback must cover only an empty fixture boundary");
    }
  }
  assert.equal(sample.readPath, outside.length > 0 ? "hybrid" : "projection", "historical fixture read path differs from its verified coverage");
  assert.equal(sample.fallbackReason, outside.length > 0 ? "outside_projection_coverage" : null, "historical fixture fallback differs from its verified coverage");
}

async function fileSha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

const ownedFixtures = new WeakMap<RuntimeMeasurementOptions, { manifest: RuntimeFixtureManifest; manifestSha256: string; copiedSha256: string; sourceDatabase: string }>();

export async function prepareRuntimeFixture(options: RuntimeMeasurementOptions, dataRoot: string) {
  if (!options.fixtureManifest) return;
  const manifestPath = options.fixtureManifest;
  assert.ok(lstatSync(manifestPath).isFile() && !lstatSync(manifestPath).isSymbolicLink());
  assert.equal(realpathSync(manifestPath).toLowerCase(), resolve(manifestPath).toLowerCase(), "fixture manifest must not traverse a link");
  assert.ok(lstatSync(manifestPath).size <= 2 * 1024 * 1024, "fixture manifest exceeds 2 MiB");
  const source = readFileSync(manifestPath);
  const manifest = parseRuntimeFixtureManifest(JSON.parse(source.toString("utf8")));
  const sourceDatabase = join(dirname(manifestPath), manifest.database.file);
  const metadata = lstatSync(sourceDatabase);
  assert.ok(metadata.isFile() && !metadata.isSymbolicLink(), "fixture database must be a regular file");
  assert.equal(metadata.size, manifest.database.bytes, "fixture database byte size differs");
  for (const suffix of ["-wal", "-shm", "-journal"]) assert.ok(!existsSync(`${sourceDatabase}${suffix}`), `fixture contains ${suffix} sidecar`);
  assert.equal(await fileSha256(sourceDatabase), manifest.database.sha256, "fixture database SHA256 differs");
  const dataDirectory = join(dataRoot, "data");
  mkdirSync(dataDirectory);
  const destination = join(dataDirectory, "patina.db");
  copyFileSync(sourceDatabase, destination, constants.COPYFILE_EXCL);
  const copiedSha256 = await fileSha256(destination);
  assert.equal(copiedSha256, manifest.database.sha256, "copied fixture SHA256 differs");
  assert.equal(await fileSha256(sourceDatabase), copiedSha256, "fixture input changed while copying");
  const inspection = spawnSync("python", ["-c", `
import json, pathlib, sqlite3, sys
with sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri() + '?mode=ro&immutable=1', uri=True) as db:
    if db.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
        raise RuntimeError('fixture SQLite quick_check failed')
    for table in ['sessions', 'import_exact_sessions', 'import_time_buckets', 'activity_hourly_effective', 'web_activity_segments']:
        if not db.execute('PRAGMA table_info(' + table + ')').fetchall():
            raise RuntimeError('fixture missing table: ' + table)
    print(json.dumps({'userVersion': db.execute('PRAGMA user_version').fetchone()[0], 'sqlxMigrations': [
        {'version': row[0], 'checksum': row[1], 'success': bool(row[2])}
        for row in db.execute('SELECT version, hex(checksum), success FROM _sqlx_migrations ORDER BY version')]}))
`, destination], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  assert.equal(inspection.status, 0, `fixture read-only SQLite inspection failed: ${inspection.stderr || inspection.error?.message}`);
  assert.deepEqual(JSON.parse(inspection.stdout), { userVersion: manifest.schemaIdentity.userVersion,
    sqlxMigrations: manifest.schemaIdentity.sqlxMigrations.map((migration) => ({ ...migration, checksum: migration.checksum.toUpperCase() })) }, "fixture schema identity differs");
  ownedFixtures.set(options, { manifest, manifestSha256: createHash("sha256").update(source).digest("hex"), copiedSha256, sourceDatabase });
}

interface FixtureHistoryDay {
  dateKey: string;
  startMs: number;
  endMs: number;
  expectedTotalDurationMs: number;
}

export function resolveFixtureHistoryDays(fixture: RuntimeFixtureManifest, localDays: Array<Omit<FixtureHistoryDay, "expectedTotalDurationMs">>) {
  const completeDays = localDays.flatMap((day) => {
    assert.match(day.dateKey, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isSafeInteger(day.startMs) && Number.isSafeInteger(day.endMs) && day.endMs > day.startMs);
    const overlaps = fixture.dailyOracle.filter((oracle) => oracle.dayStartMs + 36_000_000 > day.startMs && oracle.dayStartMs < day.endMs);
    if (overlaps.length !== 1 || overlaps[0].dayStartMs < day.startMs || overlaps[0].dayStartMs + 36_000_000 > day.endMs) return [];
    return [{ ...day, expectedTotalDurationMs: fixtureExpectedTotal(fixture, day.startMs, day.endMs) }];
  }).sort((left, right) => right.startMs - left.startMs);
  const latest = completeDays.find((day) => completeDays.some((previous) => previous.endMs === day.startMs));
  assert.ok(latest, "fixture has no adjacent complete dense local days; partial-day oracles are unsupported");
  const previous = completeDays.find((day) => day.endMs === latest.startMs)!;
  for (const day of [previous, latest]) assert.equal(day.expectedTotalDurationMs, 21_600_000);
  return { previous, latest };
}

export function inspectFixtureHistoryDays(sourceDatabase: string, days: FixtureHistoryDay[]) {
  const inspection = spawnSync("python", ["-c", `
import json, pathlib, sqlite3, sys
with sqlite3.connect(pathlib.Path(sys.argv[1]).as_uri() + '?mode=ro&immutable=1', uri=True) as db:
    rows = []
    for day in json.loads(sys.argv[2]):
        counts = {}
        for name, table, start in [('nativeRows','sessions','start_time'), ('exactRows','import_exact_sessions','start_time'), ('bucketRows','import_time_buckets','bucket_start_time'), ('webRows','web_activity_segments','start_time')]:
            counts[name] = db.execute('SELECT COUNT(*) FROM ' + table + ' WHERE ' + start + ' >= ? AND ' + start + ' < ?', (day['startMs'], day['endMs'])).fetchone()[0]
        rows.append(dict(day, **counts))
    print(json.dumps(rows))
`, sourceDatabase, JSON.stringify(days)], { encoding: "utf8", windowsHide: true, timeout: 30_000 });
  assert.equal(inspection.status, 0, `dense-day source inspection failed: ${inspection.stderr || inspection.error?.message}`);
  const rows = JSON.parse(inspection.stdout) as Array<FixtureHistoryDay & { nativeRows: number; exactRows: number; bucketRows: number; webRows: number }>;
  assert.equal(rows.length, days.length);
  rows.forEach((row, index) => {
    assert.equal(row.dateKey, days[index].dateKey);
    assert.equal(row.nativeRows, 1001, "dense day must contain the fixture's 1001 native facts");
    for (const count of [row.exactRows, row.bucketRows, row.webRows]) assert.ok(count > 0, "dense day is missing fixture sources");
  });
  return rows;
}

export function fingerprintRuntimeInputs(root = process.cwd()) {
  const files: Array<{ path: string; bytes: number; sha256: string }> = [];
  const visit = (path: string) => {
    const absolute = join(root, path);
    const stat = lstatSync(absolute);
    assert.ok(!stat.isSymbolicLink(), `measurement input must not be a symbolic link: ${path}`);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(absolute).sort()) {
        if (!["target", "node_modules", ".git", "dist"].includes(entry)
          && !(path === "src-tauri" && entry === "gen")) visit(`${path}/${entry}`);
      }
    } else {
      files.push({ path, bytes: stat.size, sha256: createHash("sha256").update(readFileSync(absolute)).digest("hex") });
    }
  };
  for (const path of ["src", "src-tauri", "scripts", "tests", "public", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml",
    "rust-toolchain.toml", ".node-version", "index.html", "vite.config.ts", "tsconfig.json", "tsconfig.node.json",
    "tsconfig.quality.json", "eslint.config.js", ".npmrc"]) {
    if (existsSync(join(root, path))) visit(path);
  }
  files.sort((a, b) => a.path.localeCompare(b.path, "en"));
  return { sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex"), files };
}

const ownedMeasurements = new WeakMap<RuntimeMeasurementOptions, ReturnType<typeof fingerprintRuntimeInputs>>();

export function parseRuntimeMeasurementOptions(args: string[]): RuntimeMeasurementOptions | null {
  if (args.length === 0) return null;
  assert.equal(args[0], "--measure", "runtime measurement arguments must start with --measure");
  const values = new Map<string, string>();
  const names = new Set(["--output", "--samples", "--warmup-seconds", "--resource-seconds", "--interval-seconds", "--fixture-manifest"]);
  for (let index = 1; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert.ok(names.has(key) && value && !values.has(key), `invalid or repeated measurement option ${key}`);
    values.set(key, value);
  }
  const output = values.get("--output");
  assert.ok(output && isAbsolute(output), "--output must name a new absolute JSON file");
  const fixtureManifest = values.get("--fixture-manifest");
  if (fixtureManifest) assert.ok(isAbsolute(fixtureManifest), "--fixture-manifest must be absolute");
  const number = (name: string, defaultValue: number, min: number, max: number) => {
    const value = Number(values.get(name) ?? defaultValue);
    assert.ok(Number.isSafeInteger(value) && value >= min && value <= max, `${name} must be an integer in ${min}..${max}`);
    return value;
  };
  return {
    output, samples: number("--samples", 30, 30, 200),
    warmupSeconds: number("--warmup-seconds", 300, 0, 900),
    resourceSeconds: number("--resource-seconds", 600, 0, 28_800),
    intervalSeconds: number("--interval-seconds", 5, 1, 60),
    ...(fixtureManifest ? { fixtureManifest } : {}),
  };
}

export function summarizeRuntimeValues(values: number[]) {
  assert.ok(values.every((value) => Number.isFinite(value) && value >= 0), "invalid runtime sample");
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const percentile = (fraction: number) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
  return { count: values.length, average: values.reduce((sum, value) => sum + value, 0) / values.length,
    p50: percentile(0.5), p95: percentile(0.95), max: sorted.at(-1)! };
}

interface ProcessSample {
  unavailable?: boolean;
  privateBytes?: number;
  workingSetBytes?: number;
  cpuOneCorePercent?: number | null;
  handles?: number;
  threads?: number;
  gdiObjects?: number | null;
  userObjects?: number | null;
}

export function summarizeRuntimeResources(text: string, sceneAcceptanceEligible?: boolean) {
  const rows = text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const samples = rows.filter((row) => row.kind === "sample") as Array<{ elapsedSeconds: number; processes: ProcessSample[] }>;
  const completion = rows.slice().reverse().find((row) => row.kind === "completed");
  const metadata = rows.find((row) => row.kind === "metadata");
  const metrics = ["privateBytes", "workingSetBytes", "cpuOneCorePercent", "handles", "threads", "gdiObjects", "userObjects"] as const;
  const totals = samples.map((sample) => ({
    elapsedSeconds: sample.elapsedSeconds,
    values: Object.fromEntries(metrics.map((metric) => {
      const values = sample.processes.map((process) => process.unavailable ? null : process[metric]);
      const total = values.length > 0 && values.every((value) => typeof value === "number" && Number.isFinite(value) && value >= 0)
        ? (values as number[]).reduce((sum, value) => sum + value, 0) : null;
      return [metric, total];
    })),
  }));
  const distributions = Object.fromEntries(metrics.map((metric) => [metric,
    summarizeRuntimeValues(totals.flatMap((sample) => typeof sample.values[metric] === "number" ? [sample.values[metric]!] : [])),
  ]));
  const elapsedSeconds = completion?.elapsedSeconds ?? totals.at(-1)?.elapsedSeconds ?? 0;
  const medianPrivate = (window: typeof totals) => summarizeRuntimeValues(window.flatMap((sample) =>
    typeof sample.values.privateBytes === "number" ? [sample.values.privateBytes] : []))?.p50 ?? null;
  const firstMedian = elapsedSeconds >= 3_600 ? medianPrivate(totals.filter((sample) => sample.elapsedSeconds <= 1_800)) : null;
  const lastMedian = elapsedSeconds >= 3_600 ? medianPrivate(totals.filter((sample) => sample.elapsedSeconds >= elapsedSeconds - 1_800)) : null;
  const missing = Object.fromEntries(metrics.map((metric) => [metric, totals.filter((sample) => sample.values[metric] === null).length]));
  const interval = Number(metadata?.intervalSeconds);
  const gaps = totals.slice(1).map((sample, index) => sample.elapsedSeconds - totals[index].elapsedSeconds);
  const coverageComplete = Number.isFinite(interval) && interval > 0 && samples.length > 1
    && totals[0].elapsedSeconds <= interval + 10 && elapsedSeconds - totals.at(-1)!.elapsedSeconds <= interval + 10
    && gaps.every((gap) => gap >= 0 && gap <= interval + 10) && missing.privateBytes === 0;
  return {
    sampleCount: samples.length, elapsedSeconds, completed: completion?.stopReason === "duration",
    completionScope: "sampler duration; main-window scenario eligibility requires separate scene observation",
    sceneAcceptanceEligible: sceneAcceptanceEligible ?? null,
    stopReason: completion?.stopReason ?? "missing-completion", distributions, missingSamples: missing,
    first30MinutePrivateBytesMedian: firstMedian, last30MinutePrivateBytesMedian: lastMedian,
    privateBytesMedianGrowth: firstMedian === null || lastMedian === null ? null : lastMedian - firstMedian,
    samplingCoverageComplete: coverageComplete,
    maximumSampleGapSeconds: gaps.length ? Math.max(...gaps) : null,
    fullEightHourObservation: sceneAcceptanceEligible !== false && completion?.stopReason === "duration" && elapsedSeconds >= 28_800 && coverageComplete,
    metricAcceptanceEligible: Object.fromEntries(metrics.map((metric) => [metric,
      sceneAcceptanceEligible !== false && coverageComplete && (metric === "cpuOneCorePercent"
        ? totals.slice(1).every((sample) => sample.values.cpuOneCorePercent !== null)
        : missing[metric] === 0),
    ])),
    eightHourPrivateDriftAccepted: sceneAcceptanceEligible !== false && completion?.stopReason === "duration" && elapsedSeconds >= 28_800 && coverageComplete
      && firstMedian !== null && lastMedian !== null ? lastMedian - firstMedian <= Math.max(20 * 1024 * 1024, firstMedian * 0.05) : null,
    cpuConvention: "one logical core = 100%; missing process values are excluded and reported, never zero-filled",
    memoryConvention: "privateBytes sums private allocations; workingSetBytes sums shared pages repeatedly",
  };
}

// Release ignores PATINA_E2E_DATA_ROOT. Existing profiles cannot be claimed as
// disposable by a benchmark; this probe never writes anchors or user data.
export function inspectLocalReleaseIsolation() {
  assert.equal(process.platform, "win32", "local release profile inspection requires Windows");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", `
    [pscustomobject]@{ roaming = [Environment]::GetFolderPath('ApplicationData'); local = [Environment]::GetFolderPath('LocalApplicationData') } | ConvertTo-Json -Compress
  `], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  const folders = JSON.parse(result.stdout);
  const profiles = [join(folders.roaming, "Patina Local"), join(folders.local, "Patina Local")];
  return { profiles: profiles.map((path) => ({ path, exists: existsSync(path) })),
    existingProfileBlocksIsolatedLaunch: profiles.some(existsSync),
    e2eOverrideAvailableInRelease: false, anchorsModified: false, installedPackageValidated: false };
}

const RESOURCE_SAMPLER = join(process.cwd(), "src-tauri", "target", "debug", "examples", "windows-resource-sample.exe");

async function runChild(command: string, args: string[], timeoutMs: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const child = spawn(command, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  let output = "";
  child.stdout.on("data", (value) => { output = `${output}${value}`.slice(-8_192); });
  child.stderr.on("data", (value) => { output = `${output}${value}`.slice(-8_192); });
  let stopped: string | null = null;
  let exitTimeout: ReturnType<typeof setTimeout> | undefined;
  let rejectExit: (error: Error) => void = () => {};
  const exit = new Promise<number | null>((resolveExit, reject) => {
    rejectExit = reject;
    child.once("error", reject);
    child.once("close", resolveExit);
  });
  const stop = (reason: string) => {
    if (stopped) return;
    stopped = reason;
    if (child.pid && child.exitCode === null) {
      const result = spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true, encoding: "utf8", timeout: 5_000,
      });
      if (result.error || result.status !== 0) {
        output += `\ntermination helper for ${child.pid}: ${result.error?.message || result.stderr || result.stdout}`;
        try { child.kill("SIGKILL"); }
        catch (error) { output += `\nfallback termination: ${String(error)}`; }
      }
      exitTimeout = setTimeout(() => rejectExit(new Error(`${reason}; child ${child.pid} did not exit after termination: ${output}`)), 5_000);
    }
  };
  const abort = () => stop("measurement interrupted");
  signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => stop("measurement child timed out"), timeoutMs);
  try {
    const code = await exit;
    assert.ok(!stopped && code === 0, `${stopped ?? "measurement child failed"} (exit ${code}): ${output}`);
  } finally {
    clearTimeout(timeout);
    clearTimeout(exitTimeout);
    signal?.removeEventListener("abort", abort);
  }
}

export async function prepareRuntimeMeasurements(options: RuntimeMeasurementOptions) {
  assert.equal(process.platform, "win32", "Tauri runtime resource measurement requires Windows");
  mkdirSync(dirname(options.output), { recursive: true });
  for (const path of [options.output, `${options.output}.events.jsonl`, `${options.output}.resources.jsonl`]) {
    assert.ok(!existsSync(path), `refusing to replace measurement evidence: ${path}`);
  }
  const inputs = fingerprintRuntimeInputs();
  writeFileSync(options.output, JSON.stringify({ status: "preparing", measuredAt: new Date().toISOString(), options, inputs }), { flag: "wx" });
  ownedMeasurements.set(options, inputs);
  if (options.resourceSeconds > 0) {
    await runChild("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--example", "windows-resource-sample",
      "--target-dir", join(process.cwd(), "src-tauri", "target")], 480_000);
  }
}

type EvaluateRuntime = (expression: string) => Promise<unknown>;

export function resourceSceneExpression(action: "start" | "sample" | "stop") {
  return `(async () => {
    const key = '__patinaResourceScene';
    if ('${action}' === 'stop') {
      window[key]?.cleanup();
      delete window[key];
      return;
    }
    const activeView = () => document.querySelector('[data-sidebar-nav-item][aria-current="page"]')?.dataset.sidebarNavItem ?? null;
    if ('${action}' === 'start') {
      if (window[key]) throw new Error('resource scene observer already installed');
      const navigation = document.querySelector('[data-sidebar-primary-nav]');
      if (!navigation) throw new Error('resource scene navigation missing');
      const state = { violation: null };
      const invalidate = (reason) => { state.violation ??= reason; };
      const visibility = () => { if (document.visibilityState !== 'visible') invalidate('document hidden'); };
      const pagehide = () => invalidate('document pagehide');
      const observer = new MutationObserver(() => invalidate('navigation changed'));
      observer.observe(navigation, { subtree: true, attributes: true, attributeFilter: ['aria-current'] });
      document.addEventListener('visibilitychange', visibility);
      window.addEventListener('pagehide', pagehide);
      state.cleanup = () => {
        observer.disconnect();
        document.removeEventListener('visibilitychange', visibility);
        window.removeEventListener('pagehide', pagehide);
      };
      window[key] = state;
    }
    const state = window[key];
    if (!state) throw new Error('resource scene observer lost with its document');
    const mainWindowVisible = await window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible', { label: 'main' });
    const settings = await window.__TAURI_INTERNALS__.invoke('plugin:sql|select', {
      db: 'sqlite:patina.db',
      query: 'SELECT key, value FROM settings WHERE key IN (?, ?) ORDER BY key',
      values: ['tracking_paused', 'background_optimization'],
    });
    return {
      mainWindowVisible, documentVisibility: document.visibilityState,
      generation: window.__PATINA_MAIN_WINDOW_GENERATION__, timeOrigin: performance.timeOrigin,
      url: location.href, view: activeView(), frameVisible: Boolean(document.querySelector('.qp-app-frame')?.checkVisibility()),
      trackingPaused: settings.find(row => row.key === 'tracking_paused')?.value ?? null,
      backgroundOptimization: settings.find(row => row.key === 'background_optimization')?.value ?? null,
      violation: state.violation,
    };
  })()`;
}

interface RuntimeResourceSceneSnapshot {
  mainWindowVisible: boolean;
  documentVisibility: string;
  generation: number;
  timeOrigin: number;
  url: string;
  view: string;
  frameVisible: boolean;
  trackingPaused: string | null;
  backgroundOptimization: string | null;
  violation: string | null;
}

export async function observeRuntimeResourceScene(evaluate: EvaluateRuntime, options: {
  intervalSeconds: number;
  signal: AbortSignal;
  evidence: Record<string, unknown>;
  event: (value: Record<string, unknown>) => void;
}, operation: (signal: AbortSignal) => Promise<void>) {
  const { evidence, event } = options;
  const intervalMs = Math.min(options.intervalSeconds * 1_000, 5_000);
  Object.assign(evidence, { status: "running", acceptanceEligible: false, intervalMs, sampleCount: 0,
    observation: "State is checked before warmup, at most every 5 seconds plus evaluation latency, and after sampling. DOM visibility/pagehide/navigation changes are retained between checks. Native window/settings changes between checks are not atomically observed." });
  const controller = new AbortController();
  const abort = () => controller.abort(options.signal.reason);
  options.signal.addEventListener("abort", abort, { once: true });
  if (options.signal.aborted) abort();
  const boundedEvaluate = async (action: "start" | "sample" | "stop") => {
    const timeout = new AbortController();
    try {
      return await Promise.race([evaluate(resourceSceneExpression(action)),
        delay(5_000, undefined, { signal: timeout.signal }).then(() => { throw new Error(`resource scene ${action} observation timed out`); })]);
    } finally { timeout.abort(); }
  };
  let baseline: RuntimeResourceSceneSnapshot | undefined;
  const inspect = async (action: "start" | "sample") => {
    controller.signal.throwIfAborted();
    const state = await boundedEvaluate(action) as RuntimeResourceSceneSnapshot;
    controller.signal.throwIfAborted();
    evidence.sampleCount = Number(evidence.sampleCount) + 1;
    evidence.last = state;
    event({ kind: "resource-scene-state", ...state });
    assert.equal(state.violation, null, `resource scene changed: ${state.violation}`);
    assert.ok(state.mainWindowVisible && state.documentVisibility === "visible" && state.frameVisible, "resource scene main window is hidden or missing");
    assert.ok(Number.isSafeInteger(state.generation) && state.generation > 0 && Number.isFinite(state.timeOrigin) && state.timeOrigin > 0, "resource scene document identity missing");
    assert.ok(state.view && state.url, "resource scene view identity missing");
    assert.ok(state.trackingPaused === null || state.trackingPaused === "0" || state.trackingPaused === "false", "resource scene tracking is paused");
    if (baseline) assert.deepEqual(state, baseline, "resource scene window, document, view or settings changed");
    else { baseline = state; evidence.baseline = state; }
  };
  let observation: Promise<void> | undefined;
  let work: Promise<void> | undefined;
  let failure: unknown;
  let operationFinished = false;
  try {
    await inspect("start");
    observation = (async () => {
      while (!operationFinished) {
        await delay(intervalMs, undefined, { signal: controller.signal });
        if (!operationFinished) await inspect("sample");
      }
    })();
    work = operation(controller.signal);
    await Promise.race([observation, work]);
    operationFinished = true;
    await observation;
    await inspect("sample");
  } catch (error) { failure = error; evidence.error = String(error); }
  finally {
    controller.abort();
    await Promise.allSettled([observation, work]);
    options.signal.removeEventListener("abort", abort);
    try { await boundedEvaluate("stop"); evidence.cleanupCompleted = true; }
    catch (error) {
      evidence.cleanupCompleted = false;
      evidence.cleanupError = String(error);
      failure = failure ? new AggregateError([failure, error], "resource scene observation and cleanup failed") : error;
    }
  }
  evidence.status = failure ? "failed" : "completed";
  evidence.acceptanceEligible = !failure;
  if (failure) {
    evidence.error ??= String(failure);
    event({ kind: "resource-scene-failure", ...evidence });
    throw failure;
  }
}

const VIEW_READY = {
  dashboard: `document.querySelector('[data-dashboard-read-state="ready"] .dashboard-workspace')?.checkVisibility()`,
  history: `(() => { const root = document.querySelector('[data-history-content-state]'); return ['ready','empty'].includes(root?.dataset.historyContentState) && root?.dataset.historyContentDate && root.querySelector('.history-horizontal-timeline')?.checkVisibility(); })()`,
  data: `document.querySelector('[data-data-content-state="complete"]')?.checkVisibility()`,
};

interface HistoryDaySelection {
  dateKey: string;
  action: "calendar" | "previous" | "next";
  expectedTotalDurationMs: number;
}

export function navigationExpression(view: keyof typeof VIEW_READY, historyDay?: HistoryDaySelection) {
  if (historyDay) {
    assert.equal(view, "history");
    assert.match(historyDay.dateKey, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(Number.isSafeInteger(historyDay.expectedTotalDurationMs) && historyDay.expectedTotalDurationMs > 0);
  }
  return `new Promise((resolve, reject) => {
    const node = document.querySelector('[data-sidebar-nav-item="${view}"]');
    if (!node) return reject(new Error('navigation entry missing: ${view}'));
    const selection = ${JSON.stringify(historyDay ?? null)};
    const header = () => document.querySelector('.history-date-label');
    const action = !selection ? node : selection.action === 'calendar'
      ? document.querySelector('.history-calendar-popover [data-calendar-date="' + selection.dateKey + '"]')
      : header()?.parentElement[selection.action === 'previous' ? 'previousElementSibling' : 'nextElementSibling'];
    if (!action || action.disabled) return reject(new Error('History date action is unavailable'));
    const startedAt = performance.now(); let feedbackMs = null;
    let meaningfulContentMs = null, meaningfulContentState = null, meaningfulFramePending = false;
    let expectedMappingVersion = null;
    const today = new Date();
    const expectedDateKey = selection?.dateKey ?? (today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0'));
    const expectedDuration = selection ? Math.floor(selection.expectedTotalDurationMs / 3600000) + 'h ' + Math.floor(selection.expectedTotalDurationMs / 60000) % 60 + 'm' : null;
    const expectedDateLabel = selection ? new Date(selection.dateKey + 'T12:00:00').toLocaleDateString(document.documentElement.lang, { month: 'short', day: 'numeric' }) : null;
    const meaningfulHistory = () => {
      const root = document.querySelector('[data-history-content-state]');
      if (!root || root.dataset.historyContentMeaningful !== 'true'
        || root.dataset.historyRequestedDate !== expectedDateKey || root.dataset.historyContentDate !== expectedDateKey
        || !root.dataset.historyRequestedMappingVersion
        || root.dataset.historyContentMappingVersion !== root.dataset.historyRequestedMappingVersion
        || !['bootstrap', 'refreshing', 'ready', 'empty'].includes(root.dataset.historyContentState)
        || !root.querySelector('.history-horizontal-timeline')?.checkVisibility()
        || (selection && (root.querySelectorAll('.history-overview-timeline-card .history-horizontal-timeline-segment').length === 0
          || root.querySelector('.history-day-summary-value')?.textContent !== expectedDuration
          || header()?.textContent !== expectedDateLabel))) return null;
      if (expectedMappingVersion === null) expectedMappingVersion = root.dataset.historyRequestedMappingVersion;
      return root.dataset.historyRequestedMappingVersion === expectedMappingVersion ? root : null;
    };
    const ready = () => (${VIEW_READY[view]}) && (!selection || (() => {
      const root = document.querySelector('[data-history-content-state]');
      return root?.dataset.historyRequestedDate === expectedDateKey && root?.dataset.historyContentDate === expectedDateKey;
    })());
    const timeout = setTimeout(() => reject(new Error('content timed out: ${view}')), 15000);
    action.click();
    const check = () => {
      if (performance.now() - startedAt > 15000) return;
      const active = node.getAttribute('aria-current') === 'page';
      if (active && feedbackMs === null && (!selection || document.querySelector('[data-history-content-state]')?.dataset.historyRequestedDate === expectedDateKey)) feedbackMs = performance.now() - startedAt;
      if ('${view}' === 'history' && active && meaningfulContentMs === null && !meaningfulFramePending && meaningfulHistory()) {
        meaningfulFramePending = true;
        requestAnimationFrame(() => {
          meaningfulFramePending = false;
          const root = meaningfulHistory();
          if (node.getAttribute('aria-current') === 'page' && root) {
            meaningfulContentMs = performance.now() - startedAt;
            meaningfulContentState = root.dataset.historyContentState;
          }
        });
      }
      if (active && ready()) return requestAnimationFrame(() => {
        if (node.getAttribute('aria-current') !== 'page' || !ready()) {
          requestAnimationFrame(check);
          return;
        }
        clearTimeout(timeout);
        const stages = performance.getEntriesByType('mark').filter(entry => entry.name.startsWith('patina:data-navigation:') && entry.startTime >= startedAt)
          .map(entry => ({name: entry.name, elapsedMs: entry.startTime - startedAt}));
        const completeMs = performance.now() - startedAt;
        if ('${view}' === 'history' && (meaningfulContentMs === null || !meaningfulHistory())) {
          reject(new Error('History fresh content completed without a stable meaningful identity'));
          return;
        }
        resolve({feedbackMs, completeMs, freshCompleteMs: completeMs,
          ...('${view}' === 'history' ? { meaningfulContentMs, meaningfulContentState,
            meaningfulDateKey: expectedDateKey, meaningfulMappingVersion: expectedMappingVersion,
            ...(selection ? { dateLabel: header().textContent, actualDuration: document.querySelector('.history-day-summary-value').textContent,
              timelineSegments: document.querySelectorAll('.history-overview-timeline-card .history-horizontal-timeline-segment').length } : {}) } : {}), stages});
      });
      requestAnimationFrame(check);
    };
    check();
  })`;
}

export function annualSelectionExpression(year: number, expectedMs: number) {
  const expectedDuration = expectedMs === 0 ? "0s" : `${Math.floor(expectedMs / 3_600_000)}h ${Math.floor(expectedMs / 60_000) % 60}m`;
  return `(async () => {
    const wait = (predicate, label, confirmFrame = false) => new Promise((resolve, reject) => {
      let frame;
      const timer = setTimeout(() => { cancelAnimationFrame(frame); reject(new Error('annual fixture UI timeout: ' + label)); }, 15000);
      const check = async () => {
        try {
          let value = predicate();
          if (value && confirmFrame) {
            await new Promise(resolveFrame => { frame = requestAnimationFrame(resolveFrame); });
            value = predicate();
          }
          if (value) { clearTimeout(timer); resolve(value); } else frame = requestAnimationFrame(check);
        }
        catch (error) { clearTimeout(timer); reject(error); }
      };
      check();
    });
    const panel = () => document.querySelector('.data-overview .data-trend-panel');
    const ready = () => panel()?.getAttribute('aria-busy') === 'false' && !panel()?.querySelector('[data-trend-read-error]');
    const reset = panel()?.querySelector('.data-trend-range-reset');
    if (reset) { reset.click(); await wait(() => ready() && !panel()?.querySelector('.data-trend-range-reset'), 'seven-day reset'); }
    const interactionStarted = performance.now();
    const trigger = panel()?.querySelector('.data-trend-range-trigger');
    if (!trigger) throw new Error('annual fixture range control missing');
    trigger.click();
    await wait(() => document.querySelector('.qp-range-picker'), 'range picker');
    for (let step = 0; step < 3; step++) {
      const next = panel().querySelector('.data-trend-range-control > button:last-child');
      if (!next || next.disabled) throw new Error('annual fixture mode unavailable');
      const previous = trigger.textContent;
      next.click();
      await wait(() => trigger.textContent !== previous, 'year mode ' + step);
    }
    const target = '${year}-01';
    const month = () => document.querySelector('.qp-range-picker [data-range-picker-date]:not([data-muted])')?.getAttribute('data-range-picker-date')?.slice(0, 7);
    for (let step = 0; month() !== target && step < 120; step++) {
      const previous = month();
      const arrows = document.querySelectorAll('.qp-range-picker .qp-calendar-nav');
      const arrow = arrows[previous > target ? 0 : 1];
      if (!arrow || arrow.disabled) throw new Error('annual fixture month unavailable');
      arrow.click();
      await wait(() => month() !== previous, 'calendar month');
    }
    if (month() !== target) throw new Error('annual fixture month navigation exceeded 120 steps');
    document.querySelector('.qp-range-picker [data-range-picker-date="${year}-01-01"]').click();
    const apply = await wait(() => {
      const button = document.querySelector('.qp-range-picker-footer .qp-button-primary');
      return button && !button.disabled ? button : null;
    }, 'annual selection draft');
    const startedAt = performance.now();
    apply.click();
    await wait(() => !document.querySelector('.qp-range-picker'), 'selection feedback');
    const feedbackMs = performance.now() - startedAt;
    await wait(() => ready() && document.querySelector('[data-data-content-state="complete"]')?.checkVisibility()
      && trigger.textContent.includes('${year}')
      && panel().querySelector('.data-trend-inline-metric strong')?.textContent === ${JSON.stringify(expectedDuration)}
      && panel().querySelectorAll('.qp-native-trend-hit').length === 12, 'trusted annual content', true);
    return { feedbackMs, completeMs: performance.now() - startedAt, interactionCompleteMs: performance.now() - interactionStarted,
      pickerSetupMs: startedAt - interactionStarted, year: ${year}, expectedDuration: ${JSON.stringify(expectedDuration)},
      actualDuration: panel().querySelector('.data-trend-inline-metric strong').textContent,
      rangeLabel: trigger.textContent, chartPoints: panel().querySelectorAll('.qp-native-trend-hit').length };
  })()`;
}

async function measureFixtureRuntime(options: RuntimeMeasurementOptions, evaluate: EvaluateRuntime,
  event: (value: Record<string, unknown>) => void, signal: AbortSignal) {
  const fixture = ownedFixtures.get(options);
  assert.ok(fixture, "fixture was not prepared");
  const manifest = fixture.manifest;
  const localYear = await evaluate(`(() => {
    const year = ${manifest.yearQuery.year};
    return { startMs: new Date(year, 0, 1).getTime(), endMs: new Date(year + 1, 0, 1).getTime(),
      boundaries: Array.from({length: 13}, (_, month) => new Date(year, month, 1).getTime()),
      historyDays: ${JSON.stringify(manifest.dailyOracle.map(day => day.dayStartMs))}.map(timestamp => {
        const day = new Date(timestamp), year = day.getFullYear(), month = day.getMonth(), date = day.getDate();
        return { dateKey: year + '-' + String(month + 1).padStart(2, '0') + '-' + String(date).padStart(2, '0'),
          startMs: new Date(year, month, date).getTime(), endMs: new Date(year, month, date + 1).getTime() };
      }),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, januaryOffsetMinutes: new Date(year, 0, 1).getTimezoneOffset() };
  })()`) as { startMs: number; endMs: number; boundaries: number[]; timeZone: string; januaryOffsetMinutes: number;
    historyDays: Array<Omit<FixtureHistoryDay, "expectedTotalDurationMs">> };
  const { historyDays: localDays, ...localYearRange } = localYear;
  const historyDays = manifest.days > 0 ? resolveFixtureHistoryDays(manifest, localDays) : null;
  const historySourceCounts = historyDays ? inspectFixtureHistoryDays(fixture.sourceDatabase, [historyDays.previous, historyDays.latest]) : [];
  if (historyDays) event({ kind: "fixture-history-source", timeZone: localYear.timeZone, days: historySourceCounts });
  const expectedLocalTotal = fixtureExpectedTotal(manifest, localYear.startMs, localYear.endMs);
  const expectedMonthly = localYear.boundaries.slice(0, -1).map((start, index) => fixtureExpectedTotal(manifest, start, localYear.boundaries[index + 1]));
  const queries = [
    { name: "manifest-utc-daily", startMs: manifest.query.startMs, endMs: manifest.query.endMs,
      boundaries: manifest.query.localDayBoundariesMs, expectedTotal: manifest.query.expectedTotalDurationMs,
      expectedApps: manifest.query.verifiedDiversity?.projectionAppCount, sampleCount: options.samples },
    { name: "data-local-year-monthly", startMs: localYear.startMs, endMs: localYear.endMs,
      boundaries: localYear.boundaries, expectedTotal: expectedLocalTotal,
      expectedApps: manifest.yearQuery.verifiedDiversity?.projectionAppCount, allowEmptyBoundaryFallback: true, sampleCount: options.samples },
    ...(historyDays ? [historyDays.previous, historyDays.latest].map(day => ({
      name: `history-dense-day-${day.dateKey}`, startMs: day.startMs, endMs: day.endMs,
      boundaries: [day.startMs, day.endMs], expectedTotal: day.expectedTotalDurationMs,
      expectedApps: 17, allowEmptyBoundaryFallback: true, sampleCount: 1,
    })) : []),
  ];
  const ipc: Record<string, unknown> = {};
  for (const query of queries) {
    const samples: Array<{ durationMs: number; jsonBytes: number; records: number; projectionRows: number; factRows: number }> = [];
    for (let index = 0; index < query.sampleCount; index++) {
      signal.throwIfAborted();
      const sample = await evaluate(`(async () => {
        const query = ${JSON.stringify(query)};
        const readModelBefore = await window.__TAURI_INTERNALS__.invoke('cmd_get_activity_read_model_status');
        const started = performance.now();
        const result = await window.__TAURI_INTERNALS__.invoke('cmd_get_activity_aggregate_range', {
          startMs: query.startMs, endMs: query.endMs, bucketBoundariesMs: query.boundaries,
        });
        const durationMs = performance.now() - started;
        const readModelAfter = await window.__TAURI_INTERNALS__.invoke('cmd_get_activity_read_model_status');
        if (!Array.isArray(result.records) || !['projection','facts','hybrid'].includes(result.readPath)) throw new Error('invalid aggregate fixture response');
        const buckets = query.boundaries.slice(1).map(() => 0);
        for (const row of result.records) {
          if (!Number.isSafeInteger(row.startTime) || !Number.isSafeInteger(row.endTime) || row.endTime < row.startTime) throw new Error('invalid aggregate fixture row');
          const bucket = query.boundaries.findIndex((start, index) => row.startTime >= start && row.startTime < query.boundaries[index + 1]);
          if (bucket < 0) throw new Error('aggregate fixture row outside range');
          buckets[bucket] += row.endTime - row.startTime;
        }
        const total = buckets.reduce((sum, value) => sum + value, 0);
        if (total !== query.expectedTotal) throw new Error('fixture aggregate duration differs: ' + total + ' != ' + query.expectedTotal);
        const apps = new Set(result.records.map(row => row.exeName)).size;
        if (query.expectedApps !== undefined && apps !== query.expectedApps) throw new Error('fixture aggregate app diversity differs: ' + apps + ' != ' + query.expectedApps);
        return { durationMs, jsonBytes: new TextEncoder().encode(JSON.stringify(result)).byteLength,
          records: result.records.length, apps, projectionRows: result.projectionRowCount, factRows: result.factRowCount,
          readPath: result.readPath, fallbackReason: result.fallbackReason, sourceRevision: result.sourceRevision,
          readModelBefore, readModelAfter, total, buckets };
      })()`) as typeof samples[number] & FixtureProjectionSample & { buckets: number[] };
      event({ kind: "fixture-ipc", query: query.name, iteration: index + 1, ...sample });
      assert.ok(Number.isFinite(sample.durationMs) && sample.durationMs >= 0);
      if (manifest.days > 0) assertFixtureProjectionSample(manifest, query, sample);
      if (query.name === "data-local-year-monthly") assert.deepEqual(sample.buckets, expectedMonthly, "local-year month totals differ from independent daily oracle");
      samples.push(sample);
    }
    ipc[query.name] = { query, samples, durationMs: summarizeRuntimeValues(samples.map(row => row.durationMs)),
      jsonBytes: summarizeRuntimeValues(samples.map(row => row.jsonBytes)), records: summarizeRuntimeValues(samples.map(row => row.records)) };
  }
  const historyUi = historyDays ? await measureDenseHistoryDays(options, historyDays, evaluate, event, signal)
    : { scenario: "dense-day-selection", applicable: false, reason: "empty fixture" };
  await evaluate(navigationExpression("data"));
  const annual: Array<{ feedbackMs: number; completeMs: number; interactionCompleteMs: number }> = [];
  for (let index = 0; index <= options.samples; index++) {
    signal.throwIfAborted();
    const result = await evaluate(annualSelectionExpression(manifest.yearQuery.year, expectedLocalTotal)) as typeof annual[number];
    event({ kind: "fixture-annual-ui", phase: index === 0 ? "first-selection" : "warm-selection", iteration: index, ...result });
    annual.push(result);
  }
  return { ...fixture, localYear: { ...localYearRange, expectedTotalDurationMs: expectedLocalTotal, expectedMonthly }, ipc,
    historyUi: { ...historyUi, sourceDays: historySourceCounts },
    annualUi: { samples: annual, first: annual[0], warm: summarizeRuntimeValues(annual.slice(1).map(row => row.completeMs)),
      completeMs: summarizeRuntimeValues(annual.map(row => row.completeMs)), feedbackMs: summarizeRuntimeValues(annual.map(row => row.feedbackMs)),
      interactionCompleteMs: summarizeRuntimeValues(annual.map(row => row.interactionCompleteMs)) },
    limitations: ["The target year contains only the activity days listed by the fixture, including 364 days in R3 year 2025.",
      "IPC duration measures WebView invoke/response completion; JSON UTF-8 bytes are serialized DTO bytes, not transport framing.",
      "Read-model status checks run outside IPC timing. Background revision, coverage or dirty-state changes invalidate the sample rather than prove a product performance failure.",
      "Annual UI content timing starts when Apply commits the range; picker setup and full interaction are reported separately.",
      "Repeated annual selections exercise the real warm range cache; raw-fact cold reads and process cold startup are separate."] };
}

async function measureDenseHistoryDays(options: RuntimeMeasurementOptions, days: { previous: FixtureHistoryDay; latest: FixtureHistoryDay },
  evaluate: EvaluateRuntime, event: (value: Record<string, unknown>) => void, signal: AbortSignal) {
  await evaluate(navigationExpression("history"));
  const calendarSetup = await evaluate(`(async () => {
    const started = performance.now(), deadline = started + 15000;
    const wait = predicate => new Promise((resolve, reject) => {
      let frame;
      const timer = setTimeout(() => { cancelAnimationFrame(frame); reject(new Error('dense-day calendar setup timed out')); }, Math.max(0, deadline - performance.now()));
      const check = () => { if (predicate()) { clearTimeout(timer); resolve(); } else frame = requestAnimationFrame(check); };
      check();
    });
    document.querySelector('.history-date-label').click();
    await wait(() => document.querySelector('.history-calendar-popover'));
    const target = ${JSON.stringify(days.latest.dateKey.slice(0, 7))};
    const month = () => document.querySelector('.history-calendar-popover [data-calendar-date]:not([data-muted])')?.getAttribute('data-calendar-date')?.slice(0, 7);
    let steps = 0;
    while (month() !== target && steps < 120) {
      const previous = month();
      const arrow = document.querySelectorAll('.history-calendar-popover .qp-calendar-nav')[previous > target ? 0 : 1];
      if (!arrow || arrow.disabled) throw new Error('dense-day calendar month is unavailable');
      arrow.click(); steps += 1;
      await wait(() => month() !== previous);
    }
    if (month() !== target) throw new Error('dense-day calendar exceeded 120 months');
    return { setupMs: performance.now() - started, steps, month: month() };
  })()`);
  const select = async (day: FixtureHistoryDay, action: HistoryDaySelection["action"], iteration: number) => {
    signal.throwIfAborted();
    try {
      const result = await evaluate(navigationExpression("history", { ...day, action })) as {
        meaningfulContentMs: number; freshCompleteMs: number; completeMs: number; feedbackMs: number;
        meaningfulDateKey: string; meaningfulMappingVersion: string; timelineSegments: number; actualDuration: string;
      };
      assert.equal(result.meaningfulDateKey, day.dateKey);
      assert.ok(Number.isFinite(result.meaningfulContentMs) && result.meaningfulContentMs >= 0
        && Number.isFinite(result.freshCompleteMs) && result.freshCompleteMs >= result.meaningfulContentMs);
      assert.equal(result.completeMs, result.freshCompleteMs);
      assert.ok(Number.isFinite(result.feedbackMs) && result.feedbackMs >= 0 && result.timelineSegments > 0);
      assert.equal(result.actualDuration, "6h 0m");
      event({ kind: "dense-day-selection", phase: action === "calendar" ? "first-calendar-selection" : "warm-date-selection", action, iteration, ...day, ...result });
      return result;
    } catch (error) {
      event({ kind: "dense-day-selection-failure", action, iteration, ...day, message: String(error) });
      throw error;
    }
  };
  const firstCalendar = await select(days.latest, "calendar", 0);
  const previous = [], next = [];
  for (let index = 1; index <= options.samples; index++) {
    previous.push(await select(days.previous, "previous", index));
    next.push(await select(days.latest, "next", index));
  }
  const summarize = (samples: typeof previous) => ({ samples,
    meaningfulContentMs: summarizeRuntimeValues(samples.map(sample => sample.meaningfulContentMs)),
    freshCompleteMs: summarizeRuntimeValues(samples.map(sample => sample.freshCompleteMs)),
    feedbackMs: summarizeRuntimeValues(samples.map(sample => sample.feedbackMs)),
  });
  return { scenario: "dense-day-selection", applicable: true, targetMeaningfulP95Ms: 150, calendarSetup, firstCalendar,
    previous: summarize(previous), next: summarize(next),
    limitations: ["Date-button selection is distinct from sidebar navigation; first calendar selection is not a cold-process sample.",
      "Both days were independently checked against the fixture oracle through IPC before UI timing; backend reads are warm.",
      "UI duration text is checked at its displayed minute precision; exact milliseconds are verified by the separate day IPC checks."] };
}

export async function measureTauriRuntime(options: RuntimeMeasurementOptions, runtime: {
  evaluate: EvaluateRuntime;
  rootPid: number;
  binaryPath: string;
  dataRoot: string;
  frontendUrl: string;
}) {
  const report: Record<string, unknown> = {
    status: "running", startedAt: new Date().toISOString(), options,
    fixture: ownedFixtures.get(options),
    buildMode: "debug", profile: "isolated runtime-smoke", frontendMode: "production static preview",
    frontendUrl: runtime.frontendUrl, database: "real isolated SQLite", dataRoot: runtime.dataRoot,
    binarySha256: createHash("sha256").update(readFileSync(runtime.binaryPath)).digest("hex"),
    head: spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true }).stdout?.trim(),
    inputs: ownedMeasurements.get(options),
    lockfileSha256: createHash("sha256").update(readFileSync("pnpm-lock.yaml")).digest("hex"),
    localReleaseIsolation: inspectLocalReleaseIsolation(), releaseBudgetsAccepted: false,
    coldStartupSamples: 0, operatingSystemCacheCleared: false,
    limitations: ["debug runtime measurements do not establish a release or installed-package baseline",
      "navigation starts after bootstrap; measurements do not establish cold process startup",
      options.fixtureManifest ? "the isolated database is a verified copy of a deterministic historical fixture" : "the isolated database starts empty; it is not R1 or R3", "normal tracking stays enabled",
      "Widget, tray, low-resource background and sleep/resume remain separate scenarios",
      ...(options.fixtureManifest ? [] : ["7-day to historical annual navigation requires a fixture manifest"])],
  };
  const event = (value: Record<string, unknown>) => appendFileSync(`${options.output}.events.jsonl`, `${JSON.stringify({ utc: new Date().toISOString(), ...value })}\n`, "utf8");
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const heartbeat = setInterval(() => console.log("PATINA_MEASUREMENT_RUNNING", new Date().toISOString()), 30_000);
  try {
    report.initialWindowState = await runtime.evaluate(`(async () => ({
      mainWindowVisible: await window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" }),
      documentVisibility: document.visibilityState,
    }))()`);
    event({ kind: "initial-window-state", ...(report.initialWindowState as Record<string, unknown>) });
    await runtime.evaluate(`window.__TAURI_INTERNALS__.invoke("cmd_show_main_window")`);
    const visibilityDeadline = Date.now() + 10_000;
    let visibleWindowState: { mainWindowVisible: boolean; documentVisibility: string } | null = null;
    while (Date.now() < visibilityDeadline) {
      const state = await runtime.evaluate(`(async () => ({
        mainWindowVisible: await window.__TAURI_INTERNALS__.invoke("plugin:window|is_visible", { label: "main" }),
        documentVisibility: document.visibilityState,
      }))()`) as { mainWindowVisible: boolean; documentVisibility: string };
      if (state.mainWindowVisible && state.documentVisibility === "visible") {
        visibleWindowState = state;
        break;
      }
      await new Promise(resolveVisiblePoll => setTimeout(resolveVisiblePoll, 50));
    }
    if (!visibleWindowState) {
      report.windowReadinessFailure = await runtime.evaluate(`(() => {
        const frame = document.querySelector(".qp-app-frame");
        const style = frame ? getComputedStyle(frame) : null;
        const bounds = frame?.getBoundingClientRect();
        return {
          generation: window.__PATINA_MAIN_WINDOW_GENERATION__ ?? null,
          frameConnected: Boolean(frame?.isConnected),
          frameWidth: bounds?.width ?? null, frameHeight: bounds?.height ?? null,
          frameDisplay: style?.display ?? null, frameVisibility: style?.visibility ?? null,
          frameBackground: style?.backgroundColor ?? null,
          themeMode: document.documentElement.dataset.themeMode ?? null,
          colorScheme: document.documentElement.dataset.colorScheme ?? null,
          livenessHandlerInstalled: typeof window.__PATINA_MAIN_WINDOW_LIVENESS_REQUEST__ === "function",
        };
      })()`);
      event({ kind: "window-readiness-failure", ...(report.windowReadinessFailure as Record<string, unknown>) });
      throw new Error("main window did not become visible before runtime measurement");
    }
    report.windowStateBeforeNavigation = visibleWindowState;
    event({ kind: "visible-window-precondition", ...visibleWindowState });
    const navigate = async (view: keyof typeof VIEW_READY, phase: string, iteration: number) => {
      controller.signal.throwIfAborted();
      try {
        const result = await runtime.evaluate(navigationExpression(view)) as {
          feedbackMs: number; completeMs: number; freshCompleteMs: number; meaningfulContentMs?: number;
        };
        assert.ok(Number.isFinite(result.feedbackMs) && Number.isFinite(result.completeMs), "invalid navigation measurement");
        assert.equal(result.freshCompleteMs, result.completeMs, "fresh completion must preserve the original completion measurement");
        if (view === "history") assert.ok(typeof result.meaningfulContentMs === "number"
          && result.meaningfulContentMs >= 0 && result.meaningfulContentMs <= result.completeMs, "invalid meaningful History measurement");
        event({ kind: "navigation", view, phase, iteration, ...result });
        return result;
      } catch (error) {
        event({ kind: "navigation-failure", view, phase, iteration, message: String(error) });
        throw error;
      }
    };
    const measurements: Record<string, unknown> = {};
    await navigate("dashboard", "bootstrap-ready", 0);
    for (const view of ["history", "data"] as const) {
      const first = await navigate(view, "first-navigation", 0);
      await navigate("dashboard", "return", 0);
      const samples: Array<{ feedbackMs: number; completeMs: number; freshCompleteMs: number; meaningfulContentMs?: number }> = [];
      for (let index = 0; index < options.samples; index += 1) {
        samples.push(await navigate(view, "warm-navigation", index + 1));
        await navigate("dashboard", "return", index + 1);
      }
      measurements[view] = { first, completeMs: summarizeRuntimeValues(samples.map((sample) => sample.completeMs)),
        freshCompleteMs: summarizeRuntimeValues(samples.map((sample) => sample.freshCompleteMs)),
        ...(view === "history" ? { meaningfulContentMs: summarizeRuntimeValues(samples.map((sample) => sample.meaningfulContentMs!)) } : {}),
        feedbackMs: summarizeRuntimeValues(samples.map((sample) => sample.feedbackMs)) };
    }
    report.navigation = measurements;
    if (options.fixtureManifest) report.fixture = await measureFixtureRuntime(options, runtime.evaluate, event, controller.signal);
    if (options.resourceSeconds > 0) {
      controller.signal.throwIfAborted();
      const scene: Record<string, unknown> = {};
      report.resourceScene = scene;
      await observeRuntimeResourceScene(runtime.evaluate, { intervalSeconds: options.intervalSeconds, signal: controller.signal, evidence: scene, event }, async (signal) => {
        event({ kind: "warmup-start", seconds: options.warmupSeconds });
        await delay(options.warmupSeconds * 1_000, undefined, { signal });
        event({ kind: "resource-sampling-start", rootPid: runtime.rootPid });
        await runChild(RESOURCE_SAMPLER, [String(runtime.rootPid), `${options.output}.resources.jsonl`, String(options.resourceSeconds),
          String(options.intervalSeconds), "debug-main-idle-after-navigation"], (options.resourceSeconds + 30) * 1_000, signal);
      });
      const summary = summarizeRuntimeResources(readFileSync(`${options.output}.resources.jsonl`, "utf8"), scene.acceptanceEligible === true);
      report.resources = summary;
      assert.ok(summary.completed, `resource sampling stopped early: ${summary.stopReason}`);
      assert.equal(summary.missingSamples.privateBytes, 0, "private memory coverage is incomplete");
    }
    report.status = "completed";
    const finalInputs = fingerprintRuntimeInputs();
    report.finalInputSha256 = finalInputs.sha256;
    assert.equal(finalInputs.sha256, ownedMeasurements.get(options)?.sha256, "measurement source or configuration changed after build preparation");
  } catch (error) {
    report.status = "failed";
    report.error = String(error);
    if (existsSync(`${options.output}.resources.jsonl`)) {
      try { report.resources = summarizeRuntimeResources(readFileSync(`${options.output}.resources.jsonl`, "utf8"), false); }
      catch (resourceError) { report.resourceSummaryError = String(resourceError); }
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    report.finishedAt = new Date().toISOString();
    writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
}

export function recordRuntimeMeasurementCleanup(options: RuntimeMeasurementOptions, cleanupErrors: unknown[], primaryError?: unknown) {
  if (!ownedMeasurements.has(options) || !existsSync(options.output)) return;
  const report = JSON.parse(readFileSync(options.output, "utf8"));
  report.cleanupCompleted = cleanupErrors.length === 0;
  report.cleanupErrors = cleanupErrors.map(String);
  const failures = [...(primaryError ? [primaryError] : []), ...cleanupErrors];
  if (failures.length > 0) {
    report.status = "failed";
    report.failures = failures.map(String);
  }
  writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}
