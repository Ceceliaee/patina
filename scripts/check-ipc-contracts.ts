import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";

interface IpcInventory {
  called: Set<string>;
  dynamicCalls: string[];
  declared: Set<string>;
  registered: Set<string>;
  appManifest: Set<string>;
  mainPermission: Set<string>;
  miniPermission: Set<string>;
  mainCapabilityPermissions: Set<string>;
  miniCapabilityPermissions: Set<string>;
  callerGuarded: Set<string>;
}

const DYNAMIC_INVOKE_ALLOWLIST = new Map([
  ["src/platform/persistence/commandError.ts:invokeWithCommandError", "typed persistence command wrapper"],
  ["src/platform/persistence/commandError.ts:invokeWithCommandErrorUsing", "dependency-injected command wrapper covered by mutation tests"],
  ["src/platform/runtime/toolsRuntimeGateway.ts:invokeToolsSnapshot", "typed tools snapshot parser wrapper"],
]);

// Commands intentionally invoked by Rust runtime, auxiliary windows, or tests rather than src/platform.
const RUNTIME_ONLY_COMMANDS = new Map<string, string>([
  [
    "cmd_get_activity_read_model_status",
    "isolated Tauri runtime smoke waits for read-model projection convergence",
  ],
  [
    "cmd_e2e_destroy_hidden_main_window",
    "isolated debug-only Tauri runtime smoke recovery command",
  ],
]);

const SENSITIVE_CALLER_GUARD_COMMANDS = new Set([
  "cmd_migrate_history_timeline_mode",
  "cmd_open_mini_window",
  "cmd_restore_backup",
  "cmd_save_remote_backup_settings",
  "cmd_clear_remote_backup_settings",
  "cmd_get_remote_backup_config_snapshot",
  "cmd_reveal_webdav_backup_secret",
  "cmd_delete_sessions_before",
  "cmd_delete_sessions_by_exe_names",
  "cmd_delete_sessions_by_exe_names_between",
  "cmd_delete_web_activity_segments_by_domain",
  "cmd_restart_and_apply_storage_migration",
  "cmd_restart_and_apply_webview_cache_migration",
  "cmd_restart_and_apply_restore_default_storage_migration",
  "cmd_restart_and_apply_restore_default_webview_cache_migration",
  "cmd_restart_and_clear_webview_cache",
  "cmd_install_update",
]);

const MINI_COMMAND_ALLOWLIST = new Set([
  "cmd_get_mini_window_snapshot", "cmd_mini_window_action", "cmd_get_tracker_health_snapshot",
  "cmd_get_mini_bootstrap_snapshot", "cmd_get_mini_presentation_snapshot", "cmd_get_mini_activity_snapshot", "cmd_show_main_window",
]);
const MINI_CAPABILITY_ALLOWLIST = new Set(["core:event:allow-listen", "core:event:allow-unlisten", "mini-window-commands"]);

function normalizePath(path: string) {
  return path.split(sep).join("/");
}

function collectFiles(root: string, extension: RegExp): string[] {
  const files: string[] = [];
  function walk(path: string) {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) walk(join(path, entry));
    } else if (extension.test(path)) {
      files.push(path);
    }
  }
  walk(root);
  return files;
}

function collectFrontendCalls(path: string, sourceText: string) {
  const called = new Set<string>();
  const dynamicCalls: string[] = [];
  const constants = new Map<string, string>();
  const source = ts.createSourceFile(
    path,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && ts.isStringLiteralLike(node.initializer)) {
      constants.set(node.name.text, node.initializer.text);
    }

    if (ts.isCallExpression(node) && (
      (ts.isIdentifier(node.expression) && node.expression.text.startsWith("invoke"))
      || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "invoke")
    )) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteralLike(argument)) {
        called.add(argument.text);
      } else if (argument && ts.isIdentifier(argument) && constants.has(argument.text)) {
        called.add(constants.get(argument.text)!);
      } else {
        const owner = findContainingFunction(node);
        dynamicCalls.push(`${path}:${owner}`);
      }
    }
    ts.forEachChild(node, visit);
  }

  function findContainingFunction(node: ts.Node) {
    let current: ts.Node | undefined = node;
    while (current) {
      if (ts.isFunctionDeclaration(current) && current.name) return current.name.text;
      current = current.parent;
    }
    return "<module>";
  }

  visit(source);
  return { called, dynamicCalls };
}

function collectRustCommands(sourceText: string) {
  const declared = new Set<string>();
  const registered = new Set<string>();
  const commandPattern = /#\s*\[\s*tauri::command(?:\([^\]]*\))?\s*\][\s\S]*?\b(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  for (const match of sourceText.matchAll(commandPattern)) declared.add(match[1]);

  const handlerPattern = /generate_handler!\s*\[([\s\S]*?)\]/g;
  for (const handler of sourceText.matchAll(handlerPattern)) {
    for (const command of handler[1].matchAll(/(?:[A-Za-z_][A-Za-z0-9_]*::)+([A-Za-z_][A-Za-z0-9_]*)/g)) {
      registered.add(command[1]);
    }
  }
  return { declared, registered };
}

function collectCallerGuardedCommands(sourceText: string) {
  const guarded = new Set<string>();
  const commandPattern =
    /#\s*\[\s*tauri::command(?:\([^\]]*\))?\s*\][\s\S]*?\b(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  const commands = [...sourceText.matchAll(commandPattern)];
  commands.forEach((command, index) => {
    const segmentStart = command.index ?? 0;
    const segmentEnd = commands[index + 1]?.index ?? sourceText.length;
    const segment = sourceText.slice(segmentStart, segmentEnd);
    if (
      segment.includes("require_main_window(")
      || segment.includes("require_main_window_string(")
    ) {
      guarded.add(command[1]);
    }
  });
  return guarded;
}

function collectQuotedArray(sourceText: string, pattern: RegExp, owner: string) {
  const match = sourceText.match(pattern);
  if (!match?.groups?.body) {
    throw new Error(`failed to parse ${owner}`);
  }
  return new Set(
    [...match.groups.body.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)]
      .map((entry) => entry[1]),
  );
}

function collectAppManifestCommands(sourceText: string) {
  return collectQuotedArray(
    sourceText,
    /const\s+APP_COMMANDS\s*:\s*&\s*\[\s*&str\s*\]\s*=\s*&\[(?<body>[\s\S]*?)\];/,
    "APP_COMMANDS in src-tauri/build.rs",
  );
}

function collectWindowCommandPermissions(sourceText: string) {
  const permissions = new Map<string, Set<string>>();
  const blockPattern = /\[\[permission\]\](?<body>[\s\S]*?)(?=\r?\n\[\[permission\]\]|$)/g;
  for (const match of sourceText.matchAll(blockPattern)) {
    const body = match.groups?.body ?? "";
    const identifier = body.match(/identifier\s*=\s*"([^"]+)"/)?.[1];
    const commands = body.match(/commands\.allow\s*=\s*\[(?<body>[\s\S]*?)\]/)?.groups?.body;
    if (!identifier || commands === undefined) {
      continue;
    }
    permissions.set(
      identifier,
      new Set([...commands.matchAll(/"([A-Za-z_][A-Za-z0-9_]*)"/g)].map((entry) => entry[1])),
    );
  }
  return permissions;
}

function collectCapabilityPermissionIds(sourceText: string) {
  const capability = JSON.parse(sourceText) as {
    permissions?: Array<string | { identifier?: string }>;
  };
  return new Set(
    (capability.permissions ?? [])
      .map((permission) => (
        typeof permission === "string" ? permission : permission.identifier
      ))
      .filter((identifier): identifier is string => Boolean(identifier)),
  );
}

function inventory(): IpcInventory {
  const called = new Set<string>();
  const dynamicCalls: string[] = [];
  for (const absolute of collectFiles("src/platform", /\.tsx?$/)) {
    const path = normalizePath(relative(process.cwd(), absolute));
    const result = collectFrontendCalls(path, readFileSync(absolute, "utf8"));
    result.called.forEach((command) => called.add(command));
    dynamicCalls.push(...result.dynamicCalls);
  }

  const declared = new Set<string>();
  const callerGuarded = new Set<string>();
  const registered = new Set<string>();
  for (const absolute of collectFiles("src-tauri/src/commands", /\.rs$/)) {
    const sourceText = readFileSync(absolute, "utf8");
    collectRustCommands(sourceText).declared.forEach((command) => declared.add(command));
    collectCallerGuardedCommands(sourceText).forEach((command) => callerGuarded.add(command));
  }
  collectRustCommands(readFileSync("src-tauri/src/app/bootstrap.rs", "utf8"))
    .registered.forEach((command) => registered.add(command));
  const windowPermissions = collectWindowCommandPermissions(
    readFileSync("src-tauri/permissions/window-commands.toml", "utf8"),
  );
  return {
    called,
    dynamicCalls,
    declared,
    registered,
    appManifest: collectAppManifestCommands(readFileSync("src-tauri/build.rs", "utf8")),
    mainPermission: windowPermissions.get("main-window-commands") ?? new Set(),
    miniPermission: windowPermissions.get("mini-window-commands") ?? new Set(),
    miniCapabilityPermissions: collectCapabilityPermissionIds(readFileSync("src-tauri/capabilities/mini.json", "utf8")),
    mainCapabilityPermissions: collectCapabilityPermissionIds(
      readFileSync("src-tauri/capabilities/default.json", "utf8"),
    ),
    callerGuarded,
  };
}

function difference(left: Set<string>, right: Set<string>) {
  return [...left].filter((value) => !right.has(value)).sort();
}

function validate(result: IpcInventory) {
  const failures: string[] = [];
  for (const dynamic of result.dynamicCalls.sort()) {
    if (!DYNAMIC_INVOKE_ALLOWLIST.has(dynamic)) failures.push(`dynamic invoke is not allowed: ${dynamic}`);
  }
  for (const command of difference(result.called, result.registered)) {
    failures.push(`frontend command is not registered: ${command}`);
  }
  for (const command of difference(result.declared, result.registered)) {
    failures.push(`Rust command exists but is not registered: ${command}`);
  }
  for (const command of difference(result.registered, result.called)) {
    if (!RUNTIME_ONLY_COMMANDS.has(command)) {
      failures.push(`registered command has no platform caller or runtime-only reason: ${command}`);
    }
  }
  for (const command of difference(result.registered, result.appManifest)) {
    failures.push(`registered command is missing from the Tauri app manifest: ${command}`);
  }
  for (const command of difference(result.appManifest, result.registered)) {
    failures.push(`Tauri app manifest command is not registered: ${command}`);
  }
  for (const command of difference(result.registered, result.mainPermission)) {
    failures.push(`registered command is missing from the main-window permission: ${command}`);
  }
  for (const command of difference(result.mainPermission, result.registered)) {
    failures.push(`main-window permission references an unregistered command: ${command}`);
  }
  for (const command of difference(result.miniPermission, MINI_COMMAND_ALLOWLIST)) failures.push(`mini-window permission exceeds the reviewed allowlist: ${command}`);
  for (const command of difference(MINI_COMMAND_ALLOWLIST, result.miniPermission)) failures.push(`mini-window permission is missing a reviewed command: ${command}`);
  for (const permission of difference(result.miniCapabilityPermissions, MINI_CAPABILITY_ALLOWLIST)) failures.push(`mini capability exceeds the reviewed allowlist: ${permission}`);
  for (const permission of difference(MINI_CAPABILITY_ALLOWLIST, result.miniCapabilityPermissions)) failures.push(`mini capability is missing a reviewed permission: ${permission}`);
  if (!result.mainCapabilityPermissions.has("main-window-commands")) {
    failures.push("main capability does not include main-window-commands");
  }
  for (const [window, permissions] of [
    ["main", result.mainCapabilityPermissions], ["mini", result.miniCapabilityPermissions],
  ] as const) {
    for (const permission of permissions) {
      if (permission.startsWith("sql:")) {
        failures.push(`${window} capability must not expose raw SQL permission: ${permission}`);
      }
    }
  }
  for (const command of difference(SENSITIVE_CALLER_GUARD_COMMANDS, result.callerGuarded)) {
    failures.push(`sensitive command is missing a main-window caller guard: ${command}`);
  }
  return failures;
}

function runSelfTest() {
  const frontend = collectFrontendCalls(
    "src/platform/demo.ts",
    "const KNOWN = 'cmd_known'; invoke(KNOWN); invokeWithCommandError('cmd_typed'); function proxy(name: string) { invoke(name); }",
  );
  const rust = collectRustCommands(
    "#[tauri::command]\nasync fn cmd_known() {}\n#[tauri::command]\nfn cmd_typed() {}\ngenerate_handler![commands::cmd_known, commands::cmd_typed]",
  );
  const commandSet = new Set(["cmd_known", "cmd_typed"]);
  const failures = validate({
    called: frontend.called,
    dynamicCalls: [],
    declared: rust.declared,
    registered: rust.registered,
    appManifest: commandSet,
    mainPermission: commandSet,
    miniPermission: new Set(MINI_COMMAND_ALLOWLIST),
    miniCapabilityPermissions: new Set(MINI_CAPABILITY_ALLOWLIST),
    mainCapabilityPermissions: new Set(["main-window-commands"]),
    callerGuarded: new Set(SENSITIVE_CALLER_GUARD_COMMANDS),
  });
  if (failures.length > 0 || frontend.dynamicCalls[0] !== "src/platform/demo.ts:proxy") {
    throw new Error(`IPC contract self-test failed: ${failures.join("; ")}`);
  }

  const missing = validate({
    called: new Set(["cmd_typo"]),
    dynamicCalls: [],
    declared: new Set(["cmd_known"]),
    registered: new Set(["cmd_known"]),
    appManifest: new Set(["cmd_known"]),
    mainPermission: new Set(["cmd_known"]),
    miniPermission: new Set(MINI_COMMAND_ALLOWLIST),
    miniCapabilityPermissions: new Set(MINI_CAPABILITY_ALLOWLIST),
    mainCapabilityPermissions: new Set(["main-window-commands"]),
    callerGuarded: new Set(SENSITIVE_CALLER_GUARD_COMMANDS),
  });
  if (!missing.some((failure) => failure.includes("cmd_typo"))) {
    throw new Error("IPC contract self-test did not catch a missing registration");
  }

  const missingGuard = validate({
    called: commandSet,
    dynamicCalls: [],
    declared: commandSet,
    registered: commandSet,
    appManifest: commandSet,
    mainPermission: commandSet,
    miniPermission: new Set([...MINI_COMMAND_ALLOWLIST, "cmd_pause_timer"]),
    miniCapabilityPermissions: new Set([...MINI_CAPABILITY_ALLOWLIST, "sql:allow-load"]),
    mainCapabilityPermissions: new Set(["main-window-commands", "sql:allow-select"]),
    callerGuarded: new Set(),
  });
  if (!missingGuard.some((failure) => failure.includes("caller guard"))) {
    throw new Error("IPC contract self-test did not catch a missing sensitive caller guard");
  }
  if (!missingGuard.some((failure) => failure.includes("mini-window permission exceeds"))) throw new Error("IPC self-test did not reject mini tool mutation");
  for (const window of ["main", "mini"]) {
    if (!missingGuard.some(failure => failure.includes(`${window} capability must not expose raw SQL`))) {
      throw new Error(`IPC contract self-test did not reject ${window} raw SQL`);
    }
  }
}

runSelfTest();
if (process.argv.includes("--self-test")) {
  console.log("IPC contract self-test passed");
  process.exit(0);
}

const result = inventory();
const failures = validate(result);
if (process.argv.includes("--report")) {
  console.log(JSON.stringify({
    called: [...result.called].sort(),
    declared: [...result.declared].sort(),
    registered: [...result.registered].sort(),
    appManifest: [...result.appManifest].sort(),
    mainPermission: [...result.mainPermission].sort(),
    miniPermission: [...result.miniPermission].sort(),
    callerGuarded: [...result.callerGuarded].sort(),
    dynamicCalls: result.dynamicCalls.sort(),
    failures,
  }, null, 2));
  process.exit(0);
}
if (failures.length > 0) {
  console.error("IPC contract check failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}
console.log(`IPC contract check passed (${result.called.size} platform calls, ${result.registered.size} registered commands)`);
