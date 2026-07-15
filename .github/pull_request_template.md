## Purpose

<!--
Explain the user problem, bug, or maintenance goal.
Reference related issues with `Refs #123`.
Do not use `Closes`, `Fixes`, or `Resolves` unless the maintainer explicitly requests an issue state change.
-->

Refs #

## Accepted Scope

<!--
Link the accepted issue, Project item, or maintainer-approved scope.
The automated intake gate checks this section before normal verification runs.
-->

- Linked issue / Project item / maintainer approval:

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
Examples: features/settings, platform/persistence, engine/export, data/repositories.
-->

- Frontend owner:
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

<!-- For visible UI changes, attach screenshots. Write N/A when there is no visible UI impact. -->

- [ ] No UI changes
- [ ] UI follows Quiet Pro
- [ ] Screenshots attached

## Validation

<!--
Check the commands that were run. See CONTRIBUTING.md for the required validation level.
Focused tests must match the changed risk area; unrelated tests do not satisfy the intake gate.
-->

- [ ] `npm run check`
- [ ] `npm run check:full` for Rust, tracking, SQLite, runtime, or architecture-boundary changes
- [ ] `npm run release:check` for release, changelog, updater, version, tag, or packaging changes
- [ ] Added or updated focused tests for the changed behavior

Additional validation:

-

## Screenshots

<!--
Add before/after screenshots for visible UI changes.
Include relevant empty, disabled, error, narrow-layout, light-theme, or dark-theme states when applicable.
Write `N/A` if the change has no visible UI impact.
-->

## Contributor Checklist

- [ ] I read the relevant active project documents under `docs/`.
- [ ] This pull request is linked to the Issue or Project item where its scope was agreed, or to an explicit maintainer-approved scope.
- [ ] This pull request solves one coherent problem and excludes unrelated cleanup.
- [ ] Every changed file is necessary for the accepted problem.
- [ ] The commits are reviewable; oversized changes were split coherently by behavior, owner, or independently verifiable stage.
- [ ] New behavior is placed under the correct owner and does not bypass architecture boundaries.
- [ ] I did not add standalone CSS or hardcoded visual styles outside the design system.
- [ ] I did not weaken package validation scripts or change quality gate scripts, CI workflows, bundle budgets, or hotspot budgets unless the maintainer explicitly requested that maintenance work.
- [ ] User-facing copy is owned by the relevant copy domain, not hardcoded inline in JSX.
- [ ] Risk-bearing behavior has focused tests that match the changed risk area.
- [ ] I rebased onto the latest `main`, or confirmed that the branch is compatible with it.
- [ ] I documented security behavior for any local or network interface.
- [ ] I used `Refs #N` instead of an issue-closing keyword unless explicitly requested.
