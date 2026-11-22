use semver::Version;
use serde::Deserialize;
use std::{
    error::Error,
    fs, io,
    path::Path,
    process::{Command, Output},
};

#[derive(Deserialize)]
struct Advisory {
    id: String,
}

#[derive(Deserialize)]
struct Package {
    name: String,
    version: String,
}

#[derive(Deserialize)]
struct Finding {
    advisory: Advisory,
    package: Package,
}

#[derive(Deserialize)]
struct Vulnerabilities {
    list: Vec<Finding>,
}

#[derive(Deserialize)]
struct Warnings {
    #[serde(default)]
    unsound: Vec<Finding>,
}

#[derive(Deserialize)]
struct Report {
    vulnerabilities: Vulnerabilities,
    warnings: Warnings,
}

#[derive(Deserialize)]
struct Lockfile {
    package: Vec<Package>,
}

fn findings(report: &[u8], lock: &str) -> Result<Vec<String>, Box<dyn Error>> {
    let report: Report = serde_json::from_slice(report)?;
    let mut result: Vec<_> = report
        .vulnerabilities
        .list
        .into_iter()
        .chain(report.warnings.unsound)
        .map(|f| format!("{} {}@{}", f.advisory.id, f.package.name, f.package.version))
        .collect();
    let lock: Lockfile = toml::from_str(lock)?;
    for package in lock.package {
        let (fixed, advisory) = match package.name.as_str() {
            "thrift" => (Version::new(0, 23, 0), "GHSA-2f9f-gq7v-9h6m"),
            "zip" => (Version::new(9, 0, 5), "GHSA-m665-v7pm-7grj"),
            _ => continue,
        };
        if Version::parse(&package.version)? < fixed {
            result.push(format!("{advisory} {}@{}", package.name, package.version));
        }
    }
    Ok(result)
}

pub(super) const LOCKS: [&str; 4] = [
    "Cargo.lock",
    "plugins/bundled/Cargo.lock",
    "plugins/counter/Cargo.lock",
    "examples/remote-status-bridge-worker/Cargo.lock",
];

fn audit_report<'a>(relative: &str, output: &'a Output) -> io::Result<&'a [u8]> {
    if matches!(output.status.code(), Some(0 | 1))
        && !output.stdout.iter().all(u8::is_ascii_whitespace)
    {
        return Ok(&output.stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(io::Error::other(format!(
        "{relative}: cargo audit could not produce a report ({}): {}",
        output.status,
        stderr.trim()
    )))
}

pub fn run(root: &Path, offline: bool) -> Result<(), Box<dyn Error>> {
    for relative in LOCKS {
        let lock = root.join(relative);
        let mut command = Command::new("cargo");
        command
            .current_dir(root)
            .args(["audit", "--json", "--file"])
            .arg(&lock);
        if offline {
            command.arg("--no-fetch");
        }
        let output = command.output()?;
        let report = audit_report(relative, &output)?;
        let results = findings(report, &fs::read_to_string(&lock)?)?;
        for entry in &results {
            eprintln!("{relative}: {entry}");
        }
        if !output.status.success() || !results.is_empty() {
            return Err(format!("Dependency audit failed for {relative}").into());
        }
        println!("{relative}: passed");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_report_preserves_cargo_audit_diagnostic() {
        #[cfg(unix)]
        use std::os::unix::process::ExitStatusExt;
        #[cfg(windows)]
        use std::os::windows::process::ExitStatusExt;
        use std::process::ExitStatus;

        #[cfg(unix)]
        let status = ExitStatus::from_raw(1 << 8);
        #[cfg(windows)]
        let status = ExitStatus::from_raw(1);
        let mut output = Output {
            status,
            stdout: Vec::new(),
            stderr: b"could not obtain the advisory database lock\n".to_vec(),
        };
        let error = audit_report("plugins/counter/Cargo.lock", &output)
            .unwrap_err()
            .to_string();
        assert!(error.contains("plugins/counter/Cargo.lock"));
        assert!(error.contains("could not obtain the advisory database lock"));
        output.stdout = br#"{"vulnerabilities":{"list":[]},"warnings":{}}"#.to_vec();
        assert_eq!(audit_report("Cargo.lock", &output).unwrap(), output.stdout);
    }

    #[test]
    fn advisory_inputs_fail_closed() {
        let lock = "[[package]]\nname='zip'\nversion='9.0.4'";
        let clean = br#"{"vulnerabilities":{"list":[]},"warnings":{}}"#;
        assert_eq!(
            findings(clean, lock).unwrap(),
            ["GHSA-m665-v7pm-7grj zip@9.0.4"]
        );
        assert!(
            findings(clean, &lock.replace("9.0.4", "9.0.5"))
                .unwrap()
                .is_empty()
        );
        assert!(findings(br#"{"vulnerabilities":{"list":[]}}"#, lock).is_err());
        let warning = br#"{"vulnerabilities":{"list":[]},"warnings":{"unsound":[{"package":{"name":"demo","version":"1"},"advisory":{"id":"test"}}]}}"#;
        assert_eq!(findings(warning, "package=[]").unwrap(), ["test demo@1"]);
    }
}
