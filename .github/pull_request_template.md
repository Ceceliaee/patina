## Purpose

<!--
Explain the user problem, bug, or maintenance goal.
Reference related issues with `Refs #123`.
Do not use `Closes`, `Fixes`, or `Resolves` unless the maintainer explicitly requests an issue state change.
-->

Refs #

## Accepted Scope

<!--
Link the accepted issue or the maintainer's explicit approval of the scope.
The automated intake gate checks this section before normal verification runs.
-->

- Linked issue / maintainer approval:

## Changes

<!-- Describe the important behavior changes. Keep the pull request focused on one coherent problem. -->

-

## Scope Boundary

<!--
Scope means: one accepted problem + necessary code changes + validation.
Mention unrelated follow-up work separately.
-->

- In scope:
- Out of scope:

## Owner Check

<!--
Explain why the changed files belong under these owners.
Examples: apps/patina-ui, crates/storage, crates/activity.
-->

- UI owner:
- Rust owner:
- Why this placement fits:

## Risk Review

<!--
Complete the relevant items. Use `N/A` when an area is not affected.
Call out changes to tracking, local data, privacy, security, migrations, backup, restore, cleanup, or external interfaces explicitly.
-->

- Tracking correctness:
- Local data safety:
- Privacy or security:
- Compatibility and migration:
- Failure and recovery behavior:

## UI Review

<!-- For visible UI changes, attach screenshots through GitHub user-attachments or another repository-external HTTPS host. Write N/A when there is no visible UI impact. -->

- [ ] No UI changes
- [ ] UI follows Quiet Pro
- [ ] Screenshots attached externally
- Affected states:
- Keyboard and focus:
- Repeatable test or existing owner test:

## Validation

<!--
Check the commands that were run. Select required validation under [validation scope](../docs/quality.md#验证范围) and [contributor checks](../CONTRIBUTING.md#6-validation-requirements).
Documentation-only changes still require checks for changed governance, operational claims, or other affected risks.
Follow docs/release.md for version, tag, updater, packaging, and formal release acceptance.
Focused tests must match the changed risk area; unrelated tests do not satisfy the intake gate.
-->

- [ ] `cargo xtask docs check` for documentation-only changes
- [ ] `cargo test -p xtask docs::` for documentation-governance or validation-policy changes
- [ ] `cargo xtask check tools` for repository tooling changes
- [ ] `cargo xtask check` when required by the [validation scope](../docs/quality.md#验证范围)
- [ ] Named native Windows tests for window, process, desktop integration, or installer changes
- [ ] Related performance benchmarks for affected read-model, SQLite-query, or navigation behavior (list actual commands below)
- [ ] `cargo xtask release validate-changelog` for release, changelog, or updater changes
- [ ] `cargo xtask release validate-version-files <version>` for formal release preparation
- [ ] Added or updated focused tests for the changed behavior

Additional validation (for local changes, list the actual related commands as checked items):

-

## Screenshots

<!--
Add before/after screenshots for visible UI changes.
Include relevant empty, disabled, error, narrow-layout, light-theme, or dark-theme states when applicable.
Use GitHub user-attachments or another repository-external HTTPS host. Do not commit review screenshots, GIFs, videos, or an evidence-media directory to this repository; repository blob/raw links do not count as evidence.
Write `N/A` if the change has no visible UI impact.
-->

## Contributor Checklist

- [ ] I read the relevant active project documents under `docs/`.
- [ ] This pull request links to an accepted issue or the maintainer's explicit approval of its scope.
- [ ] This pull request solves one coherent problem and excludes unrelated cleanup.
- [ ] Every changed file is necessary for the accepted problem.
- [ ] The commits are reviewable; oversized changes were split coherently by behavior, owner, or independently verifiable stage.
- [ ] New behavior is placed under the correct owner and does not bypass architecture boundaries.
- [ ] I did not add standalone CSS or hardcoded visual styles outside the design system.
- [ ] I did not weaken package validation scripts or change quality gate scripts, CI workflows, bundle budgets, or hotspot budgets unless the maintainer explicitly requested that maintenance work.
- [ ] User-facing copy is owned by the relevant copy domain, not hardcoded inline in JSX.
- [ ] Risk-bearing behavior has focused tests that match the changed risk area.
- [ ] I did not commit screenshots, GIFs, videos, or other review-evidence media to the repository.
- [ ] I rebased onto the latest `main`, or confirmed that the branch is compatible with it.
- [ ] I documented security behavior for any local or network interface.
- [ ] I used `Refs #N` instead of an issue-closing keyword unless explicitly requested.
