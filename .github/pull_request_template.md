## Purpose

<!--
Explain the user problem, bug, or maintenance goal.
Reference related issues with `Refs #123`.
Do not use `Closes`, `Fixes`, or `Resolves` unless the maintainer explicitly requests an issue state change.
-->

Refs #

## Changes

<!-- Describe the important behavior changes. Keep the pull request focused on one coherent problem. -->

-

## Scope

<!-- State what is intentionally included and excluded. Mention any unrelated follow-up work separately. -->

### Included

-

### Not Included

-

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

## Validation

<!--
Check the commands that were run. See CONTRIBUTING.md for the required validation level.
Add focused tests or manual checks below when relevant.
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
- [ ] This pull request solves one coherent problem and excludes unrelated cleanup.
- [ ] The commits are reviewable; oversized changes were split coherently or explicitly approved with an indivisibility explanation.
- [ ] New behavior is placed under the correct owner and does not bypass architecture boundaries.
- [ ] I rebased onto the latest `main`, or confirmed that the branch is compatible with it.
- [ ] I documented security behavior for any local or network interface.
- [ ] I used `Refs #N` instead of an issue-closing keyword unless explicitly requested.
