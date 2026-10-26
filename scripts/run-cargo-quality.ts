import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// Quality builds must not replace the executable used by an active Tauri dev
// session. Cargo arguments and gate composition remain in package.json.
const result = spawnSync("cargo", process.argv.slice(2), {
  env: { ...process.env, CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR ?? resolve("src-tauri/target/quality") },
  stdio: "inherit", windowsHide: true, shell: false,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
