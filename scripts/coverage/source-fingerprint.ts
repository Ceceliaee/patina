import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/** Bind evidence to both the base commit and the exact uncommitted source bytes. */
export function sourceFingerprint(scope: string[]) {
  const inventory = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { encoding: "utf8", windowsHide: true });
  const head = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", windowsHide: true });
  assert.equal(inventory.status, 0);
  assert.equal(head.status, 0);
  const files = [...new Set(inventory.stdout.split("\0"))].filter(path => path && existsSync(path)
    && scope.some(prefix => prefix.endsWith("/") ? path.startsWith(prefix) : path === prefix)).sort();
  const hash = createHash("sha256");
  for (const file of files) hash.update(file).update("\0").update(readFileSync(file)).update("\0");
  return { head: head.stdout.trim(), sha256: hash.digest("hex"), fileCount: files.length, scope };
}
