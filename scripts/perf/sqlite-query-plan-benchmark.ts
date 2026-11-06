import { spawnSync } from "node:child_process";
import { qualityCargoEnv, qualityCargoProfile } from "../run-cargo-quality.ts";

const marker = "PATINA_QUERY_PLAN_REPORT_JSON:";

function extractJsonAfterMarker(output: string): string | null {
  const markerIndex = output.indexOf(marker);
  if (markerIndex < 0) return null;

  const jsonStart = output.indexOf("{", markerIndex + marker.length);
  if (jsonStart < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = jsonStart; index < output.length; index += 1) {
    const char = output[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return output.slice(jsonStart, index + 1);
      }
    }
  }

  return null;
}

const result = spawnSync("cargo", [
  "test",
  "--profile", qualityCargoProfile,
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--locked",
  "session_range_query_plan_report",
  "--",
  "--ignored",
  "--nocapture",
], {
  env: qualityCargoEnv(),
  encoding: "utf8",
});

const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const extractedJson = extractJsonAfterMarker(combinedOutput);

if (!extractedJson) {
  console.log(JSON.stringify({
    benchmark: "sqlite-session-query-plan",
    measuredAt: new Date().toISOString(),
    measurements: [],
    metadata: {
      error: "Failed to extract query plan JSON from cargo test output.",
      exitCode: result.status,
      spawnError: result.error ? String(result.error) : null,
      stdout: result.stdout,
      stderr: result.stderr,
    },
  }, null, 2));
  process.exitCode = result.status && result.status !== 0 ? result.status : 1;
} else {
  console.log(JSON.stringify(JSON.parse(extractedJson), null, 2));
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}
