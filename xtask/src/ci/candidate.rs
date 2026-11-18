use super::Result;
use base64::{Engine, engine::general_purpose::STANDARD};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    env,
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
    process::Command,
};

#[derive(Deserialize, PartialEq, Eq)]
struct Repository {
    id: u64,
    full_name: String,
}

#[derive(Deserialize)]
struct Reference {
    number: u64,
    id: u64,
    head: RefBranch,
    base: RefBranch,
}

#[derive(Deserialize)]
struct RefBranch {
    repo: Option<RepoId>,
}

#[derive(Deserialize)]
struct RepoId {
    id: u64,
}

#[derive(Deserialize)]
struct Run {
    id: u64,
    run_attempt: u64,
    workflow_id: u64,
    repository: Repository,
    head_repository: Repository,
    head_branch: String,
    path: String,
    event: String,
    status: String,
    conclusion: String,
    pull_requests: Vec<Reference>,
}

#[derive(Deserialize)]
struct Branch {
    repo: Option<Repository>,
    #[serde(rename = "ref")]
    name: String,
    sha: String,
}

#[derive(Deserialize)]
struct Pr {
    number: u64,
    id: u64,
    head: Branch,
    base: Branch,
    state: String,
    draft: bool,
    body: Value,
}

struct Context<'a> {
    event: &'a str,
    repo: Repository,
    default: &'a str,
    workflow: &'a str,
    sha: &'a str,
}

#[derive(Debug)]
struct Pull {
    number: u64,
    base: String,
    body: String,
}

#[derive(Debug)]
struct Candidate {
    head: String,
    pull: Option<Pull>,
}

fn require(condition: bool, message: &'static str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(message.into())
    }
}

fn valid_sha(sha: &str) -> bool {
    sha.len() == 40
        && sha
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

// GitHub event consumers must agree on the integer represented in JSON.
fn valid_id(id: u64) -> bool {
    (1..=9_007_199_254_740_991).contains(&id)
}

fn valid_repo(repo: &Repository) -> bool {
    let mut parts = repo.full_name.split('/');
    let valid = |s: &str| {
        !s.is_empty()
            && s != "."
            && s != ".."
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"_.-".contains(&b))
    };
    valid_id(repo.id)
        && parts.next().is_some_and(valid)
        && parts.next().is_some_and(valid)
        && parts.next().is_none()
}

impl Run {
    fn check(&self, repo: &Repository) -> Result<Option<(u64, u64)>> {
        require(
            &self.repository == repo
                && valid_id(self.id)
                && valid_id(self.run_attempt)
                && valid_id(self.workflow_id),
            "unexpected intake run identity",
        )?;
        require(
            self.path == ".github/workflows/pr-intake.yml"
                && self.event == "pull_request"
                && self.status == "completed"
                && self.conclusion == "success",
            "a successful PR Intake run is required",
        )?;
        require(
            valid_repo(&self.head_repository) && !self.head_branch.is_empty(),
            "invalid upstream source",
        )?;
        require(
            self.pull_requests.len() <= 1,
            "ambiguous associated pull requests",
        )?;
        self.pull_requests
            .first()
            .map(|r| {
                require(
                    valid_id(r.number)
                        && valid_id(r.id)
                        && r.base.repo.as_ref().map(|v| v.id) == Some(repo.id)
                        && r.head.repo.as_ref().map(|v| v.id) == Some(self.head_repository.id),
                    "invalid associated pull request",
                )?;
                Ok((r.number, r.id))
            })
            .transpose()
    }
    fn matches(&self, pr: &Pr) -> bool {
        pr.head.repo.as_ref() == Some(&self.head_repository) && pr.head.name == self.head_branch
    }
}

fn resolve(
    ctx: &Context<'_>,
    event: &Value,
    mut api: impl FnMut(&str) -> Result<Value>,
) -> Result<Candidate> {
    let repo: Repository = serde_json::from_value(event["repository"].clone())?;
    require(
        valid_repo(&repo) && repo == ctx.repo && !ctx.default.is_empty(),
        "unexpected repository identity",
    )?;
    require(
        ctx.workflow
            == format!(
                "{}/.github/workflows/verify.yml@refs/heads/{}",
                repo.full_name, ctx.default
            ),
        "Verify must run from the default branch workflow",
    )?;
    require(valid_sha(ctx.sha), "invalid workflow SHA")?;
    if ctx.event == "push" {
        require(
            event["ref"] == format!("refs/heads/{}", ctx.default)
                && event["after"] == ctx.sha
                && event["deleted"] == false,
            "push ref or SHA changed",
        )?;
        return Ok(Candidate {
            head: ctx.sha.into(),
            pull: None,
        });
    }
    let prefix = format!("repos/{}", repo.full_name);
    let (number, id, upstream) = match ctx.event {
        "workflow_dispatch" => {
            let n = event["inputs"]["pr_number"]
                .as_str()
                .ok_or("missing PR number")?;
            require(
                !n.is_empty() && !n.starts_with('0') && n.bytes().all(|b| b.is_ascii_digit()),
                "invalid PR number",
            )?;
            let id = n.parse::<u64>()?;
            require(valid_id(id), "invalid PR number")?;
            (id, None, None)
        }
        "workflow_run" => {
            let trigger: Run = serde_json::from_value(event["workflow_run"].clone())?;
            let first = trigger.check(&repo)?;
            let current: Run =
                serde_json::from_value(api(&format!("{prefix}/actions/runs/{}", trigger.id))?)?;
            let next = current.check(&repo)?;
            require(
                trigger.id == current.id
                    && trigger.workflow_id == current.workflow_id
                    && trigger.run_attempt == current.run_attempt
                    && trigger.head_repository == current.head_repository
                    && trigger.head_branch == current.head_branch
                    && (first.is_none() || next.is_none() || first == next),
                "trigger identity differs from GitHub metadata",
            )?;
            let (number, id) = if let Some(reference) = next.or(first) {
                reference
            } else {
                let owner = current.head_repository.full_name.split('/').next().unwrap();
                let query = url::form_urlencoded::Serializer::new(String::new())
                    .append_pair("state", "open")
                    .append_pair("base", ctx.default)
                    .append_pair("head", &format!("{owner}:{}", current.head_branch))
                    .append_pair("per_page", "100")
                    .finish();
                let prs: Vec<Pr> =
                    serde_json::from_value(api(&format!("{prefix}/pulls?{query}"))?)?;
                require(prs.len() < 100, "PR lookup may be truncated")?;
                let mut found = prs.into_iter().filter(|pr| {
                    pr.state == "open"
                        && pr.base.repo.as_ref() == Some(&repo)
                        && pr.base.name == ctx.default
                        && current.matches(pr)
                });
                let pr = found.next().ok_or("no matching pull request")?;
                require(found.next().is_none(), "ambiguous fork branch")?;
                (pr.number, pr.id)
            };
            require(
                valid_id(number) && valid_id(id),
                "invalid resolved PR identity",
            )?;
            (number, Some(id), Some(current))
        }
        _ => return Err("unsupported GitHub event".into()),
    };
    let pr: Pr = serde_json::from_value(api(&format!("{prefix}/pulls/{number}"))?)?;
    require(
        pr.number == number && valid_id(pr.id) && id.is_none_or(|i| i == pr.id),
        "PR identity changed",
    )?;
    require(
        pr.base.repo.as_ref() == Some(&repo)
            && pr.base.name == ctx.default
            && pr.state == "open"
            && !pr.draft,
        "PR is not open for the default branch",
    )?;
    require(
        pr.head.repo.as_ref().is_some_and(valid_repo)
            && upstream.as_ref().is_none_or(|r| r.matches(&pr)),
        "PR source changed",
    )?;
    require(
        valid_sha(&pr.base.sha) && valid_sha(&pr.head.sha),
        "invalid PR commit",
    )?;
    let body = match pr.body {
        Value::Null => String::new(),
        Value::String(s) => s,
        _ => return Err("invalid PR body".into()),
    };
    Ok(Candidate {
        head: pr.head.sha,
        pull: Some(Pull {
            number,
            base: pr.base.sha,
            body,
        }),
    })
}

fn output(command: &mut Command) -> Result<Vec<u8>> {
    let out = command.output()?;
    require(
        out.status.success(),
        "candidate verification command failed",
    )?;
    Ok(out.stdout)
}

fn verify(root: &Path, candidate: &Candidate, repo: &str) -> Result<()> {
    let git = || {
        let mut c = Command::new("git");
        c.current_dir(root);
        c
    };
    let reference = if let Some(pr) = &candidate.pull {
        let auth = STANDARD.encode(format!("x-access-token:{}", env::var("GH_TOKEN")?));
        let key = format!("http.{}/{repo}.extraheader", env::var("GITHUB_SERVER_URL")?);
        output(
            git()
                .args([
                    "fetch",
                    "--no-tags",
                    "origin",
                    &pr.base,
                    &format!("pull/{}/head:refs/remotes/verify-candidate/head", pr.number),
                ])
                .env("GIT_CONFIG_COUNT", "1")
                .env("GIT_CONFIG_KEY_0", key)
                .env("GIT_CONFIG_VALUE_0", format!("AUTHORIZATION: basic {auth}")),
        )?;
        "refs/remotes/verify-candidate/head"
    } else {
        "HEAD"
    };
    let oid = String::from_utf8(output(git().args(["rev-parse", reference]))?)?;
    require(
        oid.trim() == candidate.head,
        "fetched candidate changed after validation",
    )?;
    if let Some(pr) = &candidate.pull {
        let temp = tempfile::tempdir()?;
        let base = temp.path().join("base");
        output(
            git()
                .args(["worktree", "add", "--detach"])
                .arg(&base)
                .arg(&pr.base),
        )?;
        let checked = Command::new("cargo")
            .current_dir(&base)
            .args([
                "xtask",
                "ci",
                "intake",
                "--base",
                &pr.base,
                "--head",
                &candidate.head,
                "--body-env",
                "PR_BODY",
                "--require-pr-body",
            ])
            .env_remove("GH_TOKEN")
            .env_remove("GITHUB_TOKEN")
            .env("PR_BODY", &pr.body)
            .status();
        let removed = output(git().args(["worktree", "remove", "--force"]).arg(&base));
        require(checked?.success(), "trusted base intake rejected candidate")?;
        removed?;
    }
    Ok(())
}

pub(super) fn run(root: &Path) -> Result<()> {
    let get = env::var;
    let event: Value = serde_json::from_slice(&fs::read(get("GITHUB_EVENT_PATH")?)?)?;
    let ctx = Context {
        event: &get("GITHUB_EVENT_NAME")?,
        repo: Repository {
            id: get("GITHUB_REPOSITORY_ID")?.parse()?,
            full_name: get("GITHUB_REPOSITORY")?,
        },
        default: event["repository"]["default_branch"]
            .as_str()
            .ok_or("missing default branch")?,
        workflow: &get("VERIFY_WORKFLOW_REF")?,
        sha: &get("GITHUB_SHA")?,
    };
    let candidate = resolve(&ctx, &event, |path| {
        let server = url::Url::parse(&get("GITHUB_SERVER_URL")?)?;
        let host = server.host_str().ok_or("invalid GitHub server")?;
        Ok(serde_json::from_slice(&output(Command::new("gh").args(
            [
                "api",
                "--hostname",
                host,
                "-H",
                "X-GitHub-Api-Version: 2022-11-28",
                path,
            ],
        ))?)?)
    })?;
    verify(root, &candidate, &ctx.repo.full_name)?;
    let pr = candidate.pull.as_ref();
    let digest = Sha256::digest(pr.map_or("N/A", |p| &p.body).as_bytes());
    let mut summary = OpenOptions::new()
        .append(true)
        .open(get("GITHUB_STEP_SUMMARY")?)?;
    writeln!(
        summary,
        "Verified candidate `{}`\n\nTrusted base `{}`\n\nPR body SHA-256 `{digest:x}`",
        candidate.head,
        pr.map_or("push event", |p| &p.base)
    )?;
    let mut outputs = OpenOptions::new()
        .append(true)
        .open(get("GITHUB_OUTPUT")?)?;
    writeln!(
        outputs,
        "head_sha={}\nbase_sha={}\npr_number={}",
        candidate.head,
        pr.map_or("", |p| &p.base),
        pr.map(|p| p.number.to_string()).unwrap_or_default()
    )?;
    Ok(())
}

#[cfg(test)]
mod tests;
