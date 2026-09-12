import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface RepositoryIdentity {
  id: number;
  full_name: string;
}

interface PullRequestReference {
  id: number;
  number: number;
  base: { repo: { id: number } };
  head: { repo: { id: number } | null };
}

interface IntakeRun {
  id: number;
  run_attempt: number;
  workflow_id: number;
  path: string;
  repository: RepositoryIdentity;
  head_repository: RepositoryIdentity | null;
  head_branch: string;
  event: string;
  status: string;
  conclusion: string | null;
  pull_requests: PullRequestReference[];
}

interface PullRequestSnapshot extends PullRequestReference {
  state: string;
  draft: boolean;
  body: string | null;
  base: { sha: string; ref: string; repo: RepositoryIdentity };
  head: { sha: string; ref: string; repo: RepositoryIdentity | null };
}

export interface VerifyContext {
  eventName: string;
  repository: string;
  repositoryId: number;
  defaultBranch: string;
  workflowRef: string;
  sha: string;
  event: {
    repository: RepositoryIdentity;
    ref?: string;
    after?: string;
    deleted?: boolean;
    inputs?: { pr_number?: string };
    workflow_run?: IntakeRun;
  };
}

export interface VerifyCandidate {
  head: string;
  base?: string;
  pullRequestNumber?: number;
  body?: string;
}

type ReadApi = (path: string) => Promise<unknown>;

function requireCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Verify candidate rejected: ${message}`);
}

function requireSha(value: unknown): asserts value is string {
  requireCondition(typeof value === "string" && /^[0-9a-f]{40}$/.test(value), "expected a complete commit SHA");
}

function requireRepository(repository: RepositoryIdentity | undefined, context: VerifyContext) {
  requireCondition(repository?.id === context.repositoryId && repository.full_name === context.repository,
    "repository identity does not match this workflow");
}

function requireRun(run: IntakeRun | undefined, context: VerifyContext) {
  requireCondition(run, "upstream run is missing");
  requireRepository(run.repository, context);
  requireCondition(Number.isSafeInteger(run.id) && run.id > 0, "invalid upstream run id");
  requireCondition(run.path === ".github/workflows/pr-intake.yml" && run.event === "pull_request"
    && run.status === "completed" && run.conclusion === "success", "upstream is not a successful PR Intake run");
  requireCondition(run.head_repository && Number.isSafeInteger(run.head_repository.id)
    && run.head_repository.id > 0 && /^[^/]+\/[^/]+$/.test(run.head_repository.full_name)
    && typeof run.head_branch === "string" && run.head_branch.length > 0, "upstream head repository or branch is unavailable");
  requireCondition(Array.isArray(run.pull_requests) && run.pull_requests.length <= 1,
    "upstream identifies multiple pull requests");
  const reference = run.pull_requests[0];
  if (!reference) return undefined;
  requireCondition(Number.isSafeInteger(reference.number) && reference.number > 0
    && Number.isSafeInteger(reference.id) && reference.id > 0, "invalid associated pull request");
  requireCondition(reference.base?.repo?.id === context.repositoryId, "associated pull request belongs to another base repository");
  requireCondition(reference.head?.repo?.id === run.head_repository.id, "associated head repository is unavailable or mismatched");
  return reference;
}

// The upstream run is only a trigger. Resolve current PR metadata once and apply
// trusted base policy again; workflow_run.head_sha is not a validated PR-head receipt.
export async function resolveVerifyCandidate(context: VerifyContext, readApi: ReadApi): Promise<VerifyCandidate> {
  requireRepository(context.event.repository, context);
  requireCondition(context.workflowRef === `${context.repository}/.github/workflows/verify.yml@refs/heads/${context.defaultBranch}`,
    "Verify must run from the default branch workflow");
  requireSha(context.sha);

  if (context.eventName === "push") {
    requireCondition(context.event.ref === `refs/heads/${context.defaultBranch}`
      && context.event.after === context.sha && !context.event.deleted, "push commit or branch does not match the event");
    return { head: context.sha };
  }

  let number: number;
  let reference: PullRequestReference | undefined;
  let upstream: IntakeRun | undefined;
  const prefix = `/repos/${context.repository}`;
  if (context.eventName === "workflow_run") {
    const eventRun = context.event.workflow_run;
    const eventReference = requireRun(eventRun, context);
    const apiRun = await readApi(`${prefix}/actions/runs/${eventRun!.id}`) as IntakeRun;
    const apiReference = requireRun(apiRun, context);
    requireCondition(apiRun.id === eventRun!.id && apiRun.run_attempt === eventRun!.run_attempt
      && apiRun.workflow_id === eventRun!.workflow_id
      && apiRun.head_repository?.id === eventRun!.head_repository?.id
      && apiRun.head_repository?.full_name === eventRun!.head_repository?.full_name
      && apiRun.head_branch === eventRun!.head_branch
      && (!apiReference || !eventReference || (apiReference.id === eventReference.id && apiReference.number === eventReference.number)),
    "upstream API identity differs from the triggering run");
    upstream = apiRun;
    reference = apiReference ?? eventReference;
    if (!reference) {
      // GitHub omits pull_requests on some fork runs. Repository ID plus branch
      // identifies the source; the head filter alone is insufficient across forks.
      const head = `${apiRun.head_repository!.full_name.split("/")[0]}:${apiRun.head_branch}`;
      const matches = await readApi(`${prefix}/pulls?state=open&base=${encodeURIComponent(context.defaultBranch)}&head=${encodeURIComponent(head)}&per_page=100`) as PullRequestSnapshot[];
      requireCondition(Array.isArray(matches) && matches.length < 100, "pull request lookup is incomplete or invalid");
      const candidates = matches.filter((pr) => pr.state === "open" && pr.base?.repo?.id === context.repositoryId
        && pr.base.ref === context.defaultBranch && pr.head?.repo?.id === apiRun.head_repository?.id
        && pr.head.repo?.full_name === apiRun.head_repository?.full_name && pr.head.ref === apiRun.head_branch);
      requireCondition(candidates.length === 1, "upstream repository and branch do not identify exactly one open pull request");
      reference = candidates[0];
    }
    number = reference.number;
    requireCondition(Number.isSafeInteger(number) && number > 0 && Number.isSafeInteger(reference.id) && reference.id > 0,
      "invalid resolved pull request identity");
  } else {
    requireCondition(context.eventName === "workflow_dispatch", "unsupported event");
    const value = context.event.inputs?.pr_number ?? "";
    requireCondition(/^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)), "manual input must be a positive pull request number");
    number = Number(value);
  }

  const pullRequest = await readApi(`${prefix}/pulls/${number}`) as PullRequestSnapshot;
  requireCondition(pullRequest.number === number && (!reference || pullRequest.id === reference.id), "pull request identity mismatch");
  requireRepository(pullRequest.base?.repo, context);
  requireCondition(pullRequest.base.ref === context.defaultBranch, "pull request must target the default branch");
  requireCondition(pullRequest.state === "open" && pullRequest.draft === false, "pull request is closed or still a draft");
  requireCondition(pullRequest.head?.repo && (!reference || pullRequest.head.repo.id === reference.head.repo?.id),
    "head repository is unavailable or differs from the associated pull request");
  requireCondition(!upstream || (pullRequest.head.repo.id === upstream.head_repository?.id
    && pullRequest.head.repo.full_name === upstream.head_repository.full_name && pullRequest.head.ref === upstream.head_branch),
  "pull request source changed after upstream association");
  requireCondition(pullRequest.body === null || typeof pullRequest.body === "string", "invalid pull request body snapshot");
  requireSha(pullRequest.base.sha);
  requireSha(pullRequest.head.sha);
  return { head: pullRequest.head.sha, base: pullRequest.base.sha, body: pullRequest.body ?? "", pullRequestNumber: number };
}

interface CandidateOperations {
  fetch: (candidate: VerifyCandidate) => void;
  head: () => string;
  intake: (candidate: VerifyCandidate) => void;
  publish: (candidate: VerifyCandidate) => void;
}

export function verifyAndPublishCandidate(candidate: VerifyCandidate, operations: CandidateOperations) {
  requireSha(candidate.head);
  if (candidate.pullRequestNumber !== undefined) {
    requireSha(candidate.base);
    operations.fetch(candidate);
  }
  requireCondition(operations.head() === candidate.head, "fetched or checked-out HEAD moved after the metadata snapshot");
  if (candidate.pullRequestNumber !== undefined) operations.intake(candidate);
  operations.publish(candidate);
}

async function main() {
  const requiredEnv = (name: string) => {
    const value = process.env[name];
    requireCondition(value, `${name} is missing`);
    return value;
  };
  const event = JSON.parse(readFileSync(requiredEnv("GITHUB_EVENT_PATH"), "utf8"));
  const context: VerifyContext = {
    eventName: requiredEnv("GITHUB_EVENT_NAME"),
    repository: requiredEnv("GITHUB_REPOSITORY"),
    repositoryId: Number(requiredEnv("GITHUB_REPOSITORY_ID")),
    defaultBranch: event.repository.default_branch,
    workflowRef: requiredEnv("VERIFY_WORKFLOW_REF"),
    sha: requiredEnv("GITHUB_SHA"),
    event,
  };
  const token = requiredEnv("GH_TOKEN");
  const readApi: ReadApi = async (path) => {
    const response = await fetch(`${requiredEnv("GITHUB_API_URL")}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    requireCondition(response.ok, `GitHub metadata request failed with status ${response.status}`);
    return response.json();
  };
  const candidate = await resolveVerifyCandidate(context, readApi);
  const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  verifyAndPublishCandidate(candidate, {
    fetch: (snapshot) => {
      // Scope credentials to this Git process and the trusted checkout's origin;
      // candidate jobs receive no persisted checkout credentials.
      execFileSync("git", ["fetch", "--no-tags", "origin", snapshot.base!, `pull/${snapshot.pullRequestNumber}/head:refs/remotes/verify-candidate/head`], {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: "1",
          GIT_CONFIG_KEY_0: `http.${requiredEnv("GITHUB_SERVER_URL")}/${context.repository}.extraheader`,
          GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
        },
      });
    },
    head: () => git(["rev-parse", candidate.pullRequestNumber === undefined ? "HEAD" : "refs/remotes/verify-candidate/head"]),
    intake: (snapshot) => {
      const directory = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), "patina-verify-intake-"));
      const worktree = join(directory, "base");
      try {
        git(["worktree", "add", "--detach", worktree, snapshot.base!]);
        execFileSync(process.execPath, ["--experimental-strip-types", "scripts/check-pr-intake.ts",
          "--base", snapshot.base!, "--head", snapshot.head, "--body-env", "PR_BODY", "--require-pr-body"], {
          cwd: worktree,
          stdio: "inherit",
          env: { ...process.env, GH_TOKEN: "", PR_BODY: snapshot.body },
        });
      } finally {
        try { git(["worktree", "remove", "--force", worktree]); }
        finally { rmSync(directory, { recursive: true, force: true }); }
      }
    },
    publish: (snapshot) => {
      const output = `head_sha=${snapshot.head}\nbase_sha=${snapshot.base ?? ""}\npr_number=${snapshot.pullRequestNumber ?? ""}\n`;
      appendFileSync(requiredEnv("GITHUB_OUTPUT"), output, "utf8");
      const bodyDigest = snapshot.body === undefined ? "N/A" : snapshot.body;
      // The body is deliberately not copied to logs or outputs; only its digest
      // joins the immutable code identities in the reviewable evidence.
      appendFileSync(requiredEnv("GITHUB_STEP_SUMMARY"), `Verified candidate: \`${snapshot.head}\`\n\nTrusted base: \`${snapshot.base ?? "push event"}\`\n\nPR body SHA-256: \`${createHash("sha256").update(bodyDigest).digest("hex")}\`\n`, "utf8");
    },
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Verify candidate failed");
    process.exitCode = 1;
  });
}
