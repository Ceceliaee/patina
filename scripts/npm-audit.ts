import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

type AuditResult = { status: number | null; stdout: string; stderr: string; error?: Error };

function isTransientAuditError(result: AuditResult): boolean {
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    return false;
  }
  if (!report || typeof report !== "object" || "vulnerabilities" in report || "metadata" in report) return false;
  const status = Number(report.statusCode);
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return true;
  return /network timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|socket hang up/i.test(String(report.message ?? ""));
}

export async function runNpmAudit(npmExecutable: string, options: {
  offline?: boolean;
  execute?: (args: string[]) => AuditResult;
  pause?: (ms: number) => Promise<unknown>;
  report?: (text: string) => void;
} = {}): Promise<number> {
  const execute = options.execute ?? ((args) => spawnSync(process.execPath, args, {
    cwd: process.cwd(), encoding: "utf8", shell: false, timeout: 150_000,
  }));
  const report = options.report ?? ((text) => process.stdout.write(text));
  const args = [npmExecutable, "audit", "--audit-level=low", "--json", "--fetch-timeout=120000", "--fetch-retries=0"];
  if (options.offline) args.push("--offline");
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = execute(args);
    if (result.stdout) report(result.stdout);
    if (result.stderr) report(result.stderr);
    if (result.error) throw result.error;
    if (result.status === 0) return 0;
    if (options.offline || attempt === 3 || !isTransientAuditError(result)) return result.status ?? 1;
    // The advisory POST is read-only, but npm's HTTP client does not retry POSTs.
    report(`npm audit: transient registry error on attempt ${attempt}/3; retrying in 2 seconds.\n`);
    await (options.pause ?? delay)(2_000);
  }
  return 1;
}
