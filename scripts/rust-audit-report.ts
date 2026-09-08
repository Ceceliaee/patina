export interface AuditFinding {
  advisory?: { id?: string };
  package?: { name?: string; version?: string };
}

export interface CargoAuditReport {
  vulnerabilities?: { list?: AuditFinding[] };
  warnings?: { unsound?: AuditFinding[] };
}

export function collectRustAuditFindings(report: CargoAuditReport, lockfile: string): AuditFinding[] {
  if (!Array.isArray(report?.vulnerabilities?.list) || !report.warnings) {
    throw new Error("Incomplete cargo-audit report");
  }
  if (report.warnings.unsound !== undefined && !Array.isArray(report.warnings.unsound)) {
    throw new Error("Invalid cargo-audit unsound warnings");
  }
  const findings = [...report.vulnerabilities.list, ...(report.warnings.unsound ?? [])];
  // GitHub advisories absent from RustSec still need regression protection.
  // https://github.com/advisories/GHSA-7gmj-67g7-phm9
  // https://github.com/advisories/GHSA-2f9f-gq7v-9h6m
  for (const block of lockfile.split("[[package]]").slice(1)) {
    const name = /^name = "([^"]+)"/m.exec(block)?.[1];
    if (name !== "tauri" && name !== "thrift") continue;
    const version = /^version = "([^"]+)"/m.exec(block)?.[1];
    if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
      throw new Error(`Unsupported audited version: ${name}@${version}`);
    }
    const [major, minor, patch] = version.split(".").map(Number);
    const id = name === "tauri"
      ? major === 2 && (minor < 11 || (minor === 11 && patch === 0)) ? "GHSA-7gmj-67g7-phm9" : null
      : major === 0 && minor < 23 ? "GHSA-2f9f-gq7v-9h6m" : null;
    if (id) findings.push({ advisory: { id }, package: { name, version } });
  }
  return findings;
}
