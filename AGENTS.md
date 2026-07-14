# AGENTS.md

This repository uses `Quiet Pro` as the only long-term UI design baseline.

This file is the top-level collaboration entry point for repository-aware agents.

These instructions apply to all UI work unless the user gives an explicit task-specific override.

## Always Read First

- Product direction and scope must follow `docs/product-principles-and-scope.md`.
- Roadmap and priority decisions must follow `docs/roadmap-and-prioritization.md`.
- Engineering quality direction should follow `docs/engineering-quality.md`.
- UI work must follow `docs/quiet-pro-component-guidelines.md`.
- Architecture refactors, boundary decisions, and new modules must align with `docs/architecture.md`.
- Stable-period issue fixes and boundary triage must follow `docs/issue-fix-boundary-guardrails.md`.
- Versioning, changelog, and release work must follow `docs/versioning-and-release-policy.md`.
- Treat the top-level long-lived docs under `docs/` as the current source of truth.

## Quiet Pro Baseline

- Build calm, professional, restrained desktop-product UI.
- Prefer typography, spacing, alignment, and hierarchy over decoration.
- Keep the interface neutral and durable rather than flashy or brand-heavy.
- New UI should feel native to the existing Dashboard, History, App Mapping, and Settings surfaces.

## Hard Rules

- Do not introduce glassmorphism, blur-heavy panels, neon glow, or large gradient backgrounds.
- Do not hardcode new colors, radii, shadows, or border styles when a token or semantic variable should exist.
- Do not add one-off visual treatments that only work on a single page.
- Do not make components louder than the information they present.
- Do not trade readability or efficiency for "design feeling".

## Token And Styling Rules

- Reuse existing semantic tokens first.
- If a new visual role is needed, add or extend a token instead of hardcoding a value in a component.
- Keep radius, border, elevation, and motion within the existing Quiet Pro scale.
- Category or status colors may vary by feature, but surrounding chrome must stay within the Quiet Pro system.

## Component Rules

- New components must define clear `default`, `hover`, `active`, `focus`, `disabled`, and where relevant `loading` and `empty` states.
- Prefer existing component archetypes: `panel`, `control`, `chip`, `status`.
- Icons support recognition; they should not become the main visual focus.
- Dense pages may be efficient, but they must still scan cleanly at a glance.

## Implementation Preference

- Extend the design system before inventing a page-local workaround.
- Preserve existing product behavior unless the user explicitly asks for interaction changes.
- If a proposed UI change conflicts with Quiet Pro or requires a new visual direction, pause and confirm before proceeding.

## Architecture Direction

- Follow `docs/architecture.md` as the architecture mother document.
- Frontend long-term structure is `app / features / shared / platform`.
- Rust long-term structure is `lib.rs + app / commands / platform / engine / data / domain`.
- Keep Tauri command handlers thin; do not let `commands/*` or `lib.rs` regrow thick business logic.
- Prefer owner-first placement: decide the real owner before deciding the file or layer.
- `shared/*` is only for stable shared capability, not a temporary bucket.
- `platform/*` is for explicit external-environment boundaries, not a generic dump for hard problems.
- Do not reintroduce exited root layers such as `src/lib/` or `src/types/`.
- Treat compatibility shells and forwarding layers as explicit exceptions that should stay thin.
- Treat files under `docs/archive/` as historical context, not the default source of truth.

## Product And Priority Direction

- Keep the product centered on personal, local-first, Windows desktop time tracking.
- Prioritize trust, readability, control, and long-term usability over feature count.
- Do not quietly expand the product toward team SaaS, cloud-first workflows, mobile-first usage, or gamified productivity unless the user explicitly changes product direction.
- When multiple directions compete, prefer correctness, data safety, and high-frequency core flows before expansion work.

## GitHub Project Active Maintenance

- When the current request clearly maps to an existing Project item, proactively read the live Project before implementation even if the user does not separately mention Project maintenance.
- For a newly approved item, create one complete draft item at the bottom of the Project, fill its long-form scope and fields, set its confirmed initial status, verify the live result, and report the recommended manual position. Do not move or reorder it after creation.
- During implementation of an existing item, do not mutate its Project status on the maintainer's behalf. Tell the maintainer exactly which item should move from its current status to `In progress`, `Blocked`, `Done`, `Next`, or `Queued`, and explain the triggering event.
- After every start, completion, block, or unblock event, recompute the `Next` window according to `docs/roadmap-and-prioritization.md` and report all required drag operations together. The maintainer performs the actual status changes in the Project `Board` view.
- Status dragging is a non-blocking collaboration action: continue authorized implementation while the maintainer updates the Board, then re-read the live Project at the next relevant checkpoint or after the maintainer says the drag is complete.
- If the live Project still differs from the reported status plan, say so explicitly. A local checklist, archived plan, commentary update, commit, push, Issue state, or Pull Request state is not a substitute for the maintainer's live Project update.
- Proactive maintenance does not authorize structural Project changes. Adding, deleting, merging, splitting, or expanding items still requires the preview and confirmation defined in `docs/roadmap-and-prioritization.md`; manual ordering remains the maintainer's responsibility.

## Stable-Period Fixing

- In the stable period, fix problems by deciding owner first and implementation second.
- Use the lightest mode that fits the issue: small fix, boundary judgment, or execution plan.
- If a fix requires a new shared abstraction, cross-layer relocation, or a new compatibility shell, stop and reassess before implementing.
- Keep `app/*`, `shared/*`, `platform/*`, `lib.rs`, and `commands/*` under extra scrutiny because they are high-attraction layers.

## Release And Validation

- For release work, keep version files, Git tags, GitHub Release titles, and updater artifacts consistent.
- Do not skip the minimum validation bar for architecture-affecting or release-affecting changes.
- The default minimum frontend validation bar is `npm test`, `npm run test:replay`, and `npm run build`.
- Treat code quality, software performance, and reliability/validation as related but different concerns; do not optimize one by accidentally damaging the others.

## GitHub Push And Issue Rules

- This is a personal repository. When the user asks to push changes to the repository, default to committing the confirmed scope and pushing directly to `origin/main`.
- When the user says to push to the repository without specifying a narrower scope, treat it as a request to include all current uncommitted changes, split them into logical commits for easier review, and then push those commits to `origin/main`.
- Keep grouped commits reviewable: each commit should have a focused subject and contain related files only, unless the user explicitly asks for a single commit.
- Before creating a commit, inspect the staged scope with `git diff --cached --stat` and `git diff --cached --numstat`.
- If one staged commit exceeds 1,000 changed lines of manually maintained content (additions plus deletions) or touches more than 25 files, stop and split it into coherent, reviewable commits. Do not create the oversized commit unless the user explicitly approves it after receiving an explanation of why it is not reasonably divisible.
- Lockfiles, generated files, snapshots, bulk assets, and mechanical migration output may be excluded from the manually maintained line count, but should be isolated in a separate commit when practical. Do not satisfy the limit by arbitrarily splitting files; split by behavior, owner, or independently reviewable stage, and keep each commit buildable or verifiable where practical.
- A single Project item may produce multiple commits; do not compress an entire Project item into one oversized commit.
- Do not create a branch or pull request unless the user explicitly asks for one.
- Do not use issue-closing keywords such as `Closes`, `Fixes`, or `Resolves` in commits, changelog entries, pull request descriptions, or GitHub comments unless the user explicitly asks to close the issue.
- When a change relates to an issue, reference it without changing its state, for example with `Refs #3` or a Markdown issue link.
- Do not close, reopen, label, or otherwise mutate GitHub issues unless the user explicitly requests that issue action.

## External Pull Request Intake

- Before reviewing or merging an external contributor pull request, apply the intake gate in `CONTRIBUTING.md` and `docs/engineering-quality.md`.
- Do not perform a full line-by-line review for a PR that fails accepted scope, owner placement, Quiet Pro, risk coverage, diff size, or validation gate checks; report the failed gate items first.
- Treat `intake/accepted-scope` as the only machine-readable proof that a maintainer accepted an external PR's problem, boundary, and acceptance criteria. PR body text, comments, linked issues, and author claims provide context but do not grant approval.
- Treat maintainer exception labels as the only automatic PR intake bypass mechanism: `intake-exception/size` for size-only exceptions and `intake-exception/tests` for risk-test exceptions. Do not treat PR body text, comments, or author claims as automatic approval.
- Do not merge a PR merely to preserve contribution traces when the maintainer would need to rewrite the main implementation, UI, owner boundary, or tests.

## Documentation Hygiene

- Top-level `docs/` is for active long-lived reference documents only.
- One-off execution plans, temporary fix plans, and completed task documents should not stay in top-level `docs/`.
- Temporary execution plans may live under a dedicated subdirectory such as `docs/working/`, but should be archived once they stop being the active execution basis.
- When a one-off document is no longer the current source of truth, move it to `docs/archive/`.
- When a long-lived rule changes, update the relevant top-level doc instead of scattering the new rule across temporary notes.
- Do not update or rely on `docs/archive/*` as the default execution basis unless the user explicitly asks for historical context.
- Do not try to reconstruct long-lived docs from old mojibake terminal output or archived one-off plans when a current top-level source-of-truth document already exists.

## Encoding Rules

- Markdown and documentation files must be saved as UTF-8.
- When editing Chinese documentation on Windows, preserve readable UTF-8 text and do not introduce mojibake.
- Do not rewrite `.md` files through shell output or redirection patterns that may change encoding implicitly.
- Do not rewrite source files or documentation through PowerShell text-output commands or redirection, including `>`, `>>`, `Set-Content`, and `Out-File`.
- When a task touches Chinese text in `.md`, `.ts`, `.tsx`, or `.rs` files, prefer normal code edits only; if encoding damage is detected, stop and repair encoding first before continuing the task.
- If a documentation file appears garbled in terminal output, verify the file bytes before assuming the content is corrupted.
