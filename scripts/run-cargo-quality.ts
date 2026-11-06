import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Quality builds must not replace the executable used by an active Tauri dev
// session. Cargo arguments and gate composition remain in package.json.
export const qualityCargoProfile = "validation";

export function qualityCargoEnv() {
  return { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? resolve("src-tauri/target/quality") };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = spawnSync("cargo", process.argv.slice(2), {
    env: qualityCargoEnv(), stdio: "inherit", windowsHide: true, shell: false,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
