import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEV_CONFIG_PATH = "src-tauri/tauri.dev.conf.json";

const TAURI_COMMANDS = new Set([
  "init",
  "dev",
  "build",
  "bundle",
  "android",
  "migrate",
  "info",
  "add",
  "remove",
  "plugin",
  "icon",
  "signer",
  "completions",
  "permission",
  "capability",
  "inspect",
  "help",
]);

function hasExplicitConfig(args: readonly string[]): boolean {
  const separatorIndex = args.indexOf("--");
  const tauriArgs = separatorIndex < 0 ? args : args.slice(0, separatorIndex);
  return tauriArgs.some((arg) => (
    arg === "--config"
    || arg === "-c"
    || arg.startsWith("--config=")
    || arg.startsWith("-c=")
  ));
}

export function resolveTauriArguments(args: readonly string[]): string[] {
  const separatorIndex = args.indexOf("--");
  const commandSearchEnd = separatorIndex < 0 ? args.length : separatorIndex;
  const commandIndex = args
    .slice(0, commandSearchEnd)
    .findIndex((arg) => TAURI_COMMANDS.has(arg));
  if (commandIndex < 0 || args[commandIndex] !== "dev" || hasExplicitConfig(args)) {
    return [...args];
  }

  return [
    ...args.slice(0, commandIndex + 1),
    "--config",
    DEV_CONFIG_PATH,
    ...args.slice(commandIndex + 1),
  ];
}

function runTauri(args: readonly string[]): number {
  const require = createRequire(import.meta.url);
  const cliEntry = require.resolve("@tauri-apps/cli/tauri.js");
  const result = spawnSync(
    process.execPath,
    [cliEntry, ...resolveTauriArguments(args)],
    {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      stdio: "inherit",
    },
  );

  if (result.error) {
    throw result.error;
  }
  return result.status ?? 1;
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.exitCode = runTauri(process.argv.slice(2));
}
