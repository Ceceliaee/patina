import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { collectRustAuditFindings, type CargoAuditReport } from "./rust-audit-report.ts";
import { runPnpmAudit } from "./pnpm-audit.ts";

const LOCKFILE = "desktop/Cargo.lock";
const OFFLINE = process.env.PATINA_DEPENDENCY_AUDIT_OFFLINE === "1";

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

const findings = collectRustAuditFindings(auditReport, readFileSync(LOCKFILE, "utf8"));
if (findings.length) {
  for (const item of findings) console.error(item.advisory?.id, item.package?.name, item.package?.version);
  process.exit(1);
}

const pnpmExecutable = process.env.npm_execpath;
if (!pnpmExecutable) {
  throw new Error("npm_execpath is unavailable; run this gate through pnpm run check:dependencies");
}
const pnpmAuditStatus = await runPnpmAudit(pnpmExecutable, { offline: OFFLINE });
if (pnpmAuditStatus !== 0) process.exit(pnpmAuditStatus);

console.log(`Dependency audit passed${OFFLINE ? " in explicit offline mode" : ""}.`);
