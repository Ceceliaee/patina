import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const SCAN_ROOTS = [
  "src/app",
  "src/features",
  "src/shared/types",
  "src/shared/lib",
] as const;

const ALLOWED_PATH_PATTERNS = [
  /^src\/features\/[^/]+\/services\/.*ReadModel\.ts$/,
] as const;

const RAW_FIELD_NAMES = [
  "root_owner_hwnd",
  "process_id",
  "window_class",
  "exe_name",
  "process_path",
  "is_afk",
  "idle_time_ms",
  "is_tracking_active",
  "sustained_participation_eligible",
  "sustained_participation_active",
  "sustained_participation_kind",
  "sustained_participation_state",
  "sustained_participation_signal_source",
  "sustained_participation_reason",
  "sustained_participation_diagnostics",
  "is_available",
  "is_active",
  "signal_source",
  "source_app_id",
  "source_app_identity",
  "playback_type",
  "match_result",
  "window_identity",
  "effective_signal_source",
  "last_match_at_ms",
  "grace_deadline_ms",
  "system_media",
  "audio_session",
  "changed_at_ms",
  "current_version",
  "latest_version",
  "release_notes",
  "release_date",
  "error_message",
  "error_stage",
  "downloaded_bytes",
  "total_bytes",
  "release_page_url",
  "asset_download_url",
  "exported_at_ms",
  "schema_version",
  "app_version",
  "restore_supported",
  "restore_message",
  "session_count",
  "setting_count",
  "icon_cache_count",
  "anchor_y",
  "start_time",
  "end_time",
  "window_title",
  "continuity_group_start_time",
  "total_duration",
  "app_name",
  "suspicious_duration",
  "last_seen_ms",
  "idle_timeout_secs",
  "timeline_merge_gap_secs",
  "refresh_interval_secs",
  "min_session_secs",
  "tracking_paused",
  "close_behavior",
  "launch_at_login",
  "start_minimized",
  "onboarding_completed",
] as const;

interface SourceFile {
  path: string;
  content: string;
}

interface NamingViolation {
  path: string;
  line: number;
  token: string;
  rule: string;
  text: string;
}

const rawFieldPattern = new RegExp(
  `\\b(${RAW_FIELD_NAMES.map(escapeRegExp).join("|")})\\b`,
  "g",
);
const rawTypePattern = /\bRaw[A-Z][A-Za-z0-9_]*\b/g;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(path: string) {
  return path.split(sep).join("/");
}

function isAllowedPath(path: string) {
  return ALLOWED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

function collectSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];

  function walk(path: string) {
    const stats = statSync(path);
    if (stats.isDirectory()) {
      for (const entry of readdirSync(path)) {
        walk(join(path, entry));
      }
      return;
    }

    if (!/\.(ts|tsx)$/.test(path)) {
      return;
    }

    const normalized = normalizePath(relative(process.cwd(), path));
    files.push({
      path: normalized,
      content: readFileSync(path, "utf8"),
    });
  }

  walk(root);
  return files;
}

function findViolations(files: SourceFile[]): NamingViolation[] {
  const violations: NamingViolation[] = [];

  for (const file of files) {
    if (isAllowedPath(file.path)) {
      continue;
    }

    const lines = file.content.split(/\r?\n/);
    lines.forEach((lineText, index) => {
      rawFieldPattern.lastIndex = 0;
      for (const match of lineText.matchAll(rawFieldPattern)) {
        violations.push({
          path: file.path,
          line: index + 1,
          token: match[1],
          rule: "raw-field-outside-boundary",
          text: lineText.trim(),
        });
      }

      rawTypePattern.lastIndex = 0;
      for (const match of lineText.matchAll(rawTypePattern)) {
        violations.push({
          path: file.path,
          line: index + 1,
          token: match[0],
          rule: "raw-type-outside-boundary",
          text: lineText.trim(),
        });
      }
    });
  }

  return violations;
}

function runSelfTest() {
  const violations = findViolations([
    {
      path: "src/app/Bad.ts",
      content: "const active = snapshot.is_tracking_active;",
    },
    {
      path: "src/features/history/services/historyReadModel.ts",
      content: "interface RawHistorySessionRow { start_time: number }",
    },
    {
      path: "src/app/Good.ts",
      content: "const active = snapshot.isTrackingActive;",
    },
    {
      path: "src/app/services/badRawDto.ts",
      content: "interface RawSettingsSnapshot { is_tracking_active: boolean }",
    },
  ]);

  const tokens = violations.map((violation) => violation.token).sort();
  const expectedTokens = ["RawSettingsSnapshot", "is_tracking_active", "is_tracking_active"].sort();

  if (JSON.stringify(tokens) !== JSON.stringify(expectedTokens)) {
    throw new Error("Naming boundary self-test failed");
  }
}

function main() {
  if (process.argv.includes("--self-test")) {
    runSelfTest();
    console.log("Naming boundary self-test passed");
    return;
  }

  const files = SCAN_ROOTS.flatMap((root) => collectSourceFiles(root));
  const violations = findViolations(files);

  if (violations.length === 0) {
    console.log("Naming boundary check passed");
    return;
  }

  console.error("Naming boundary check failed. Raw protocol fields must stay in platform boundaries.");
  for (const violation of violations) {
    console.error(
      `${violation.path}:${violation.line} ${violation.rule} ${violation.token} -> ${violation.text}`,
    );
  }
  process.exitCode = 1;
}

main();
