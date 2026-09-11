import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

type AuditResult = { status: number | null; stdout: string; stderr: string; error?: Error };

function isTransientAuditError(result: AuditResult): boolean {
  if (result.stdout.trim()) return false;
  const diagnostic = stripVTControlCharacters(result.stderr)
    .replace(/[\u2500-\u257f▶×]/g, " ").replace(/\s+/g, " ").trim();
  if (!diagnostic.startsWith("Error: ERR_PNPM_AUDIT_BAD_RESPONSE ")) return false;
  const responseStatus = diagnostic.match(/\bresponded with (\d{3}):/);
  if (responseStatus) {
    const status = Number(responseStatus[1]);
    return status === 408 || status === 429 || (status >= 500 && status <= 599);
  }
  return diagnostic.includes("Failed to request the audit endpoint")
    && /operation timed out|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up|os error 10054\b/i.test(diagnostic);
}

function cleanReport(text: string): boolean {
  const report = JSON.parse(text);
  const counts = report?.metadata?.vulnerabilities;
  if (!report?.advisories || typeof report.advisories !== "object" || Array.isArray(report.advisories)
    || !counts || !["info", "low", "moderate", "high", "critical"].every((key) => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) {
    throw new Error("pnpm audit returned an incomplete report");
  }
  return Object.keys(report.advisories).length === 0 && ["low", "moderate", "high", "critical"].every((key) => counts[key] === 0);
}

export async function runPnpmAudit(pnpmExecutable: string, options: {
  offline?: boolean;
  execute?: (args: string[]) => AuditResult;
  pause?: (ms: number) => Promise<unknown>;
  report?: (text: string) => void;
  snapshotPath?: string;
  lockfilePath?: string;
  now?: () => number;
} = {}): Promise<number> {
  const snapshotPath = options.snapshotPath ?? "artifacts/dependency-audit/pnpm.json";
  const now = options.now ?? Date.now;
  const lockHash = () => createHash("sha256").update(readFileSync(options.lockfilePath ?? "pnpm-lock.yaml")).digest("hex");
  if (options.offline) {
    const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8"));
    const age = now() - snapshot.createdAt;
    if (snapshot.lockHash !== lockHash() || !Number.isFinite(age) || age < 0 || age > 86_400_000) {
      throw new Error("Offline pnpm audit requires an online report for this lockfile from the last 24 hours");
    }
    return cleanReport(snapshot.report) ? 0 : 1;
  }
  if (!path.isAbsolute(pnpmExecutable) || !/^pnpm(?:\.exe)?$/i.test(path.basename(pnpmExecutable))) {
    throw new Error("Run this gate through the pinned native pnpm executable");
  }
  const auditedLockHash = lockHash();
  rmSync(snapshotPath, { force: true });
  const execute = options.execute ?? ((args) => spawnSync(pnpmExecutable, args, {
    cwd: process.cwd(), encoding: "utf8", shell: false, timeout: 150_000,
  }));
  const report = options.report ?? ((text) => process.stdout.write(text));
  const args = ["audit", "--audit-level=low", "--json"];
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = execute(args);
    if (result.stdout) report(result.stdout);
    if (result.stderr) report(result.stderr);
    if (result.error) throw result.error;
    if (result.status === 0) {
      if (!cleanReport(result.stdout)) return 1;
      if (lockHash() !== auditedLockHash) throw new Error("Lockfile changed during pnpm audit; run the audit again");
      mkdirSync(path.dirname(snapshotPath), { recursive: true });
      writeFileSync(snapshotPath, JSON.stringify({ lockHash: auditedLockHash, createdAt: now(), report: result.stdout }), "utf8");
      return 0;
    }
    if (attempt === 3 || !isTransientAuditError(result)) return result.status ?? 1;
    report(`pnpm audit: transient registry error on attempt ${attempt}/3; retrying in 2 seconds.\n`);
    await (options.pause ?? delay)(2_000);
  }
  return 1;
}
