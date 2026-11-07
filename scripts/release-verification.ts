import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const requiredJobs = [
  "Resolve and verify immutable candidate",
  "Frontend checks",
  "Rust checks (x64)",
  "Rust checks (arm64)",
  "Tauri runtime smoke",
];

function readApi(path: string) {
  return JSON.parse(execFileSync("gh", ["api", path], { encoding: "utf8" }));
}

export function requireMainVerification(repository: string, commit: string, read = readApi) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("Expected a repository and a full release commit SHA");
  }
  const api = `repos/${repository}/actions`;
  const { workflow_runs } = read(`${api}/workflows/verify.yml/runs?branch=main&event=push&head_sha=${commit}&per_page=1`);
  const run = workflow_runs[0];
  if (!run || run.path !== ".github/workflows/verify.yml" || run.event !== "push" ||
      run.repository?.full_name !== repository || run.head_repository?.full_name !== repository ||
      run.head_branch !== "main" || run.head_sha !== commit) {
    throw new Error(`No main push Verify run for ${repository}@${commit}. Verify this commit on main before publishing.`);
  }
  if (run.status !== "completed" || run.conclusion !== "success") {
    throw new Error(`Verify run ${run.id} for ${commit} is ${run.conclusion || run.status}. All checks must pass before publishing.`);
  }
  if (!Number.isSafeInteger(run.id) || run.id <= 0 || !Number.isSafeInteger(run.run_attempt) || run.run_attempt <= 0) {
    throw new Error("Verify returned an invalid run or attempt");
  }
  const { jobs, total_count } = read(`${api}/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`);
  if (jobs.length !== total_count || !jobs.every(job => job.run_id === run.id && job.head_sha === commit &&
      job.status === "completed" && job.conclusion === "success")) {
    throw new Error(`Verify run ${run.id} has incomplete or unsuccessful jobs for ${commit}.`);
  }
  for (const name of requiredJobs) {
    if (!jobs.some(job => job.name === name)) throw new Error(`Verify run ${run.id} is missing "${name}".`);
  }
  return `https://github.com/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const commit = process.argv[2];
  const url = requireMainVerification(process.env.GITHUB_REPOSITORY ?? "", commit);
  const summary = `Verified release commit \`${commit}\` on main: ${url}\n`;
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
