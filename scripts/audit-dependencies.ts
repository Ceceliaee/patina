import { spawnSync } from "node:child_process";
import { WINDOWS_RELEASE_TARGETS } from "./release.ts";
import { runNpmAudit } from "./npm-audit.ts";

const MANIFEST = "src-tauri/Cargo.toml";
const LOCKFILE = "src-tauri/Cargo.lock";
const OFFLINE = process.env.PATINA_DEPENDENCY_AUDIT_OFFLINE === "1";

const LOCK_ONLY_ADVISORIES = [
  {
    id: "RUSTSEC-2023-0071",
    crate: "rsa@0.9.10",
    reason: "optional SQLx dependency is not enabled by Patina's SQLite-only feature set",
  },
  {
    id: "RUSTSEC-2026-0194",
    crate: "quick-xml@0.39.4",
    reason: "only reachable through the Linux Wayland scanner, not the Windows product target",
  },
  {
    id: "RUSTSEC-2026-0195",
    crate: "quick-xml@0.39.4",
    reason: "only reachable through the Linux Wayland scanner, not the Windows product target",
  },
] as const;

function run(command: string, args: string[], capture = false) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: false,
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.error) throw result.error;
  return result;
}

for (const { target } of WINDOWS_RELEASE_TARGETS) {
  for (const exception of LOCK_ONLY_ADVISORIES) {
    const result = run("cargo", [
      "tree",
      "--manifest-path",
      MANIFEST,
      "--target",
      target,
      "--locked",
      ...(OFFLINE ? ["--offline"] : []),
      "-i",
      exception.crate,
    ], true);
    const reachableLines = (result.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (result.status !== 0 || reachableLines.length > 0) {
      console.error(`Dependency audit exception is no longer safe: ${exception.id} ${exception.crate}`);
      console.error(exception.reason);
      if (result.stdout) console.error(result.stdout);
      if (result.stderr) console.error(result.stderr);
      process.exit(1);
    }
  }
}

interface CargoAuditReport {
  vulnerabilities?: {
    list?: Array<{
      advisory?: { id?: string };
      package?: { name?: string; version?: string };
    }>;
  };
}

const rustAuditArgs = ["audit", "--file", LOCKFILE, "--json"];
if (OFFLINE) rustAuditArgs.push("--no-fetch");
const rustAudit = run("cargo", rustAuditArgs, true);
if (rustAudit.status !== 0 && rustAudit.status !== 1) {
  if (rustAudit.stdout) console.error(rustAudit.stdout);
  if (rustAudit.stderr) console.error(rustAudit.stderr);
  process.exit(rustAudit.status ?? 1);
}

let auditReport: CargoAuditReport;
try {
  auditReport = JSON.parse(rustAudit.stdout ?? "") as CargoAuditReport;
} catch (error) {
  console.error("cargo-audit did not return a valid JSON report");
  if (rustAudit.stdout) console.error(rustAudit.stdout);
  if (rustAudit.stderr) console.error(rustAudit.stderr);
  throw error;
}

const configuredExceptions = new Set(
  LOCK_ONLY_ADVISORIES.map((exception) => `${exception.id}\0${exception.crate}`),
);
const observedExceptions = new Set<string>();
const unexpectedVulnerabilities: string[] = [];

for (const vulnerability of auditReport.vulnerabilities?.list ?? []) {
  const id = vulnerability.advisory?.id ?? "UNKNOWN_ADVISORY";
  const crateName = vulnerability.package?.name ?? "UNKNOWN_CRATE";
  const version = vulnerability.package?.version ?? "UNKNOWN_VERSION";
  const exactKey = `${id}\0${crateName}@${version}`;
  if (configuredExceptions.has(exactKey)) {
    observedExceptions.add(exactKey);
  } else {
    unexpectedVulnerabilities.push(`${id} ${crateName}@${version}`);
  }
}

const staleExceptions = [...configuredExceptions]
  .filter((key) => !observedExceptions.has(key))
  .map((key) => key.replace("\0", " "));

if (unexpectedVulnerabilities.length > 0 || staleExceptions.length > 0) {
  if (unexpectedVulnerabilities.length > 0) {
    console.error("Unexpected Rust vulnerabilities:");
    for (const vulnerability of unexpectedVulnerabilities) console.error(`- ${vulnerability}`);
  }
  if (staleExceptions.length > 0) {
    console.error("Stale Rust dependency audit exceptions must be removed:");
    for (const exception of staleExceptions) console.error(`- ${exception}`);
  }
  process.exit(1);
}

console.log(
  `Rust dependency audit passed: 0 Windows-reachable vulnerabilities; ${observedExceptions.size} exact lock-only advisories verified unreachable.`,
);

const npmExecutable = process.env.npm_execpath;
if (!npmExecutable) {
  throw new Error("npm_execpath is unavailable; run this gate through npm run check:dependencies");
}
const npmAuditStatus = await runNpmAudit(npmExecutable, { offline: OFFLINE });
if (npmAuditStatus !== 0) process.exit(npmAuditStatus);

console.log(`Dependency audit passed${OFFLINE ? " in explicit offline mode" : ""}.`);
