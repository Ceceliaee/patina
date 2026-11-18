use super::{Result, repository};
use serde_json::Value;
use std::{env, fs::OpenOptions, io::Write, process::Command};

pub(super) const JOBS: [&str; 6] = [
    "Resolve and verify immutable candidate",
    "Repository tooling checks",
    "Native desktop checks (x64)",
    "Native desktop checks (arm64)",
    "Native Windows acceptance (x64)",
    "Native Windows acceptance (arm64)",
];

fn query(path: &str) -> Result<Value> {
    let out = Command::new("gh").args(["api", path]).output()?;
    if !out.status.success() {
        return Err(format!("GitHub API failed for {path}: {}", out.status).into());
    }
    Ok(serde_json::from_slice(&out.stdout)?)
}

pub(super) fn verified(
    repo: &str,
    commit: &str,
    mut api: impl FnMut(&str) -> Result<Value>,
) -> Result<String> {
    repository(repo)?;
    if commit.len() != 40
        || !commit
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("A full release commit SHA is required".into());
    }
    let base = format!("repos/{repo}/actions");
    let runs = api(&format!(
        "{base}/workflows/verify.yml/runs?branch=main&event=push&head_sha={commit}&per_page=1"
    ))?;
    let run = runs["workflow_runs"]
        .as_array()
        .and_then(|r| r.first())
        .ok_or("Missing main push Verify run")?;
    if run["path"] != ".github/workflows/verify.yml"
        || run["event"] != "push"
        || run["head_branch"] != "main"
        || run["repository"]["full_name"] != repo
        || run["head_repository"]["full_name"] != repo
        || run["head_sha"] != commit
        || run["status"] != "completed"
        || run["conclusion"] != "success"
    {
        return Err(
            "Verify did not complete successfully for the exact main commit and repository".into(),
        );
    }
    let id = run["id"]
        .as_u64()
        .filter(|n| *n > 0)
        .ok_or("Invalid Verify run ID")?;
    let attempt = run["run_attempt"]
        .as_u64()
        .filter(|n| *n > 0)
        .ok_or("Invalid Verify run attempt")?;
    let response = api(&format!(
        "{base}/runs/{id}/attempts/{attempt}/jobs?per_page=100"
    ))?;
    let jobs = response["jobs"].as_array().ok_or("Missing Verify jobs")?;
    if response["total_count"].as_u64() != Some(jobs.len() as u64)
        || jobs.iter().any(|j| {
            j["run_id"] != id
                || j["head_sha"] != commit
                || j["status"] != "completed"
                || j["conclusion"] != "success"
        })
    {
        return Err("Incomplete or unsuccessful Verify jobs".into());
    }
    for name in JOBS {
        if !jobs.iter().any(|j| j["name"] == name) {
            return Err(format!("Missing Verify job {name}").into());
        }
    }
    Ok(format!(
        "https://github.com/{repo}/actions/runs/{id}/attempts/{attempt}"
    ))
}

pub fn verify(repo: &str, commit: &str) -> Result<()> {
    let link = verified(repo, commit, query)?;
    let summary = format!("Verified release commit {commit} on main: {link}\n");
    print!("{summary}");
    if let Some(path) = env::var_os("GITHUB_STEP_SUMMARY") {
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?
            .write_all(summary.as_bytes())?;
    }
    Ok(())
}
