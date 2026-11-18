use super::*;
use serde_json::json;

const BASE: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

fn repo() -> Value {
    json!({"id":1,"full_name":"owner/project","default_branch":"main"})
}
fn fork() -> Value {
    json!({"id":2,"full_name":"fork/project"})
}
fn pr() -> Value {
    json!({"number":4,"id":12,"state":"open","draft":false,"body":"draft text","base":{"repo":repo(),"ref":"main","sha":BASE},"head":{"repo":fork(),"ref":"feature","sha":HEAD}})
}
fn run_event() -> Value {
    json!({"repository":repo(),"workflow_run":{"id":123,"run_attempt":1,"workflow_id":7,"repository":repo(),"head_repository":fork(),"head_branch":"feature","path":".github/workflows/pr-intake.yml","event":"pull_request","status":"completed","conclusion":"success","pull_requests":[]}})
}
fn ctx(event: &str) -> Context<'_> {
    Context {
        event,
        repo: serde_json::from_value(repo()).unwrap(),
        default: "main",
        workflow: "owner/project/.github/workflows/verify.yml@refs/heads/main",
        sha: HEAD,
    }
}

#[test]
fn push_matches_exact_default_branch_and_commit() {
    let context = ctx("push");
    let mut event =
        json!({"repository":repo(),"ref":"refs/heads/main","after":HEAD,"deleted":false});
    assert_eq!(resolve(&context, &event, |_| panic!()).unwrap().head, HEAD);
    for (key, value) in [
        ("after", json!(BASE)),
        ("ref", json!("refs/heads/fork")),
        ("deleted", json!(true)),
        ("repository", fork()),
    ] {
        let mut invalid = event.clone();
        invalid[key] = value;
        assert!(resolve(&context, &invalid, |_| panic!()).is_err());
    }
    event["ref"] = json!("refs/heads/main");
    let mut untrusted = ctx("push");
    untrusted.workflow = "owner/project/.github/workflows/verify.yml@refs/heads/feature";
    assert!(resolve(&untrusted, &event, |_| panic!()).is_err());
}

#[test]
fn dispatch_snapshots_body_and_rejects_malformed_id_or_pr() {
    let mut event = json!({"repository":repo(),"inputs":{"pr_number":"4"}});
    let verified = resolve(&ctx("workflow_dispatch"), &event, |_| Ok(pr())).unwrap();
    assert_eq!(verified.pull.unwrap().body, "draft text");
    for (k, v) in [
        ("state", json!("closed")),
        ("draft", json!(true)),
        ("number", json!(5)),
        ("body", json!({})),
        ("head", json!({"sha":HEAD,"ref":"feature","repo":null})),
        ("base", json!({"repo":fork(),"ref":"main","sha":BASE})),
    ] {
        let mut bad = pr();
        bad[k] = v;
        assert!(resolve(&ctx("workflow_dispatch"), &event, |_| Ok(bad.clone())).is_err());
    }
    for n in [
        "0",
        "04",
        "-4",
        "4.5",
        "9007199254740992",
        "9999999999999999999999999",
    ] {
        event["inputs"]["pr_number"] = json!(n);
        assert!(resolve(&ctx("workflow_dispatch"), &event, |_| panic!()).is_err());
    }
}

fn resolve_run(
    event: &Value,
    upstream: Value,
    matches: Value,
    snapshot: Value,
) -> Result<Candidate> {
    resolve(&ctx("workflow_run"), event, |url| {
        if url.ends_with("/actions/runs/123") {
            Ok(upstream.clone())
        } else if url.contains("/pulls?") {
            assert!(url.contains("head=fork%3Afeature"));
            Ok(matches.clone())
        } else {
            assert!(url.ends_with("/pulls/4"));
            Ok(snapshot.clone())
        }
    })
}

#[test]
fn fork_lookup_requires_exact_run_source_and_unique_result() {
    let event = run_event();
    let upstream = event["workflow_run"].clone();
    assert_eq!(
        resolve_run(&event, upstream.clone(), json!([pr()]), pr())
            .unwrap()
            .head,
        HEAD
    );
    for items in [json!([]), json!([pr(), pr()]), json!(vec![pr(); 100])] {
        assert!(resolve_run(&event, upstream.clone(), items, pr()).is_err());
    }
    for (k, v) in [
        ("run_attempt", json!(2)),
        ("workflow_id", json!(10)),
        ("head_repository", repo()),
        ("conclusion", json!("failure")),
        ("path", json!("other")),
        ("head_branch", json!("other")),
    ] {
        let mut bad = upstream.clone();
        bad[k] = v;
        assert!(resolve_run(&event, bad, json!([pr()]), pr()).is_err());
    }
    let mut changed = pr();
    changed["head"]["ref"] = json!("other");
    assert!(resolve_run(&event, upstream, json!([pr()]), changed).is_err());
}

#[test]
fn associated_pull_request_must_match_both_snapshots() {
    let mut event = run_event();
    event["workflow_run"]["pull_requests"] = json!([pr()]);
    let upstream = event["workflow_run"].clone();
    assert!(resolve_run(&event, upstream.clone(), Value::Null, pr()).is_ok());
    let mut changed = upstream.clone();
    changed["pull_requests"][0]["id"] = json!(888);
    assert!(resolve_run(&event, changed, Value::Null, pr()).is_err());
    let mut changed = pr();
    changed["head"]["repo"] = repo();
    assert!(resolve_run(&event, upstream, Value::Null, changed).is_err());
}

#[test]
fn moved_checkout_cannot_publish_push() {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path();
    for argv in [
        &["init", "-q"][..],
        &[
            "-c",
            "user.name=fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "commit",
            "--allow-empty",
            "-m",
            "fixture",
        ],
    ] {
        assert!(
            Command::new("git")
                .current_dir(root)
                .args(argv)
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    assert!(
        verify(
            root,
            &Candidate {
                head: HEAD.into(),
                pull: None
            },
            "owner/project"
        )
        .is_err()
    );
    let oid = String::from_utf8(
        output(
            Command::new("git")
                .current_dir(root)
                .args(["rev-parse", "HEAD"]),
        )
        .unwrap(),
    )
    .unwrap();
    assert!(
        verify(
            root,
            &Candidate {
                head: oid.trim().into(),
                pull: None
            },
            "owner/project"
        )
        .is_ok()
    );
}
