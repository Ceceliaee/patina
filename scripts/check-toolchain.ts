import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function toolchainErrors(nodeVersion: string, manifest: { engines?: { node?: string; pnpm?: string }; packageManager?: string }, actualNode: string, userAgent: string): string[] {
  const errors: string[] = [];
  if (manifest.engines?.node !== nodeVersion) errors.push("engines.node must match .node-version");
  if (actualNode !== nodeVersion) errors.push(`Node ${nodeVersion} required; received ${actualNode}`);
  const pnpmVersion = manifest.engines?.pnpm;
  if (!pnpmVersion || !/^\d+\.\d+\.\d+$/.test(pnpmVersion) || manifest.packageManager !== `pnpm@${pnpmVersion}`) {
    errors.push("packageManager must pin the same exact pnpm version as engines.pnpm");
  }
  if (userAgent.split(" ")[0] !== `pnpm/${pnpmVersion}`) errors.push(`Run through pnpm ${pnpmVersion}`);
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  const errors = toolchainErrors(readFileSync(".node-version", "utf8").trim(), manifest, process.versions.node, process.env.npm_config_user_agent ?? "");
  if (!existsSync("pnpm-lock.yaml")) errors.push("pnpm-lock.yaml is required; restore the committed lockfile");
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Toolchain versions match the project configuration");
}
