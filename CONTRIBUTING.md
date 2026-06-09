# Contributing To Patina

[English](#english) · [简体中文](#zh-cn)

<a id="english"></a>

## English

Thank you for taking the time to contribute.

Patina is a personal, local-first Windows desktop time tracker. The project
values trustworthy records, clear ownership boundaries, readable UI, and
changes that remain easy to maintain over time.

This guide explains how to prepare a change, open a pull request, respond to
review feedback, and decide whether a change is ready to merge.

## 1. Start Here

Before writing code, read the documents that define the current project
direction:

- [`docs/product-principles-and-scope.md`](docs/product-principles-and-scope.md)
- [`docs/roadmap-and-prioritization.md`](docs/roadmap-and-prioritization.md)
- [`docs/engineering-quality.md`](docs/engineering-quality.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/issue-fix-boundary-guardrails.md`](docs/issue-fix-boundary-guardrails.md)
- [`docs/quiet-pro-component-guidelines.md`](docs/quiet-pro-component-guidelines.md) for UI work
- [`docs/versioning-and-release-policy.md`](docs/versioning-and-release-policy.md) for release work

The active top-level files under `docs/` are the current sources of truth.
Files under `docs/archive/` are historical context and should not be used as the
default implementation basis.

## 2. Project Priorities

When several implementation options are possible, use this order of priority:

1. Protect tracking correctness and local data safety.
2. Preserve clear ownership boundaries.
3. Keep high-frequency desktop workflows readable and reliable.
4. Prefer the smallest change that fully solves the problem.
5. Add new surface area only when it fits the current product scope.

Patina is intentionally focused on personal, local-first Windows desktop
use. Team SaaS features, account systems, cloud-first workflows, mobile-first
features, and decorative complexity are not current priorities unless the
project direction is explicitly changed first.

## 3. Before You Start A Change

### 3.1 Check The Existing Context

Before implementing a fix or feature:

1. Search existing issues and pull requests for related work.
2. Read the relevant active project documents.
3. Identify the real owner of the behavior before choosing a file.
4. Decide whether the task is a focused change or a broader boundary change.
5. Keep unrelated cleanup out of the pull request.

If a fix requires a new shared abstraction, a cross-layer responsibility move,
or a new compatibility wrapper, pause and explain the design before
implementing it.

### 3.2 Choose A Suitable Issue

For a focused bug fix, small UX improvement, or clearly scoped feature, it is
fine to open a pull request directly and reference the related issue.
When opening a new issue, use the matching GitHub Issue Form and remove or
redact window titles, local database contents, backup files, access tokens, and
personal paths before posting.

For larger work, discuss the direction first when the change:

- modifies tracking session semantics;
- changes backup, restore, cleanup, or database migration behavior;
- exposes a new local or network interface;
- adds a new shared abstraction or cross-layer dependency;
- changes product scope;
- introduces a new UI direction outside the existing Quiet Pro system.

### 3.3 Install Dependencies

Use the lock file when preparing a contribution:

```bash
npm ci
```

Useful development commands:

```bash
npm run tauri dev
npm run build
```

## 4. Branch And Commit Workflow

### 4.1 Create A Branch From The Latest `main`

Start from an up-to-date `main` branch:

```bash
git switch main
git fetch origin main
git pull --ff-only origin main
git switch -c feat/short-description
```

Use a short branch name that describes the change:

```text
feat/local-websocket-api
fix/session-sealing
docs/contribution-guide
```

If you contribute from a fork, add the main repository as `upstream` and use
`upstream/main` as the source branch:

```bash
git remote add upstream https://github.com/Ceceliaee/patina.git
git fetch upstream main
git rebase upstream/main
```

### 4.2 Keep The Pull Request Focused

A pull request should solve one coherent problem.

Avoid:

- unrelated refactors;
- formatting churn in untouched areas;
- drive-by renames;
- generated file changes that are not required by the task;
- changing tracking behavior as part of an unrelated UI or integration feature.

If you notice a separate issue while working, mention it in the pull request or
open a follow-up issue instead of expanding the current diff.

### 4.3 Write Clear Commits

Prefer small, understandable commits with concise messages:

```text
feat: add local websocket settings
fix: revoke websocket clients when token changes
docs: add pull request contribution guide
```

Common prefixes:

- `feat:` for a user-facing capability;
- `fix:` for a bug fix;
- `docs:` for documentation-only changes;
- `refactor:` for behavior-preserving structure improvements;
- `test:` for test-only changes;
- `chore:` for maintenance work;
- `release:` for release preparation.

Do not use issue-closing keywords such as `Closes`, `Fixes`, or `Resolves`
unless the maintainer explicitly asks to close the issue. Reference related
issues with:

```text
Refs #4
```

## 5. Implementation Boundaries

### 5.1 Use Owner-First Placement

Choose the real owner before choosing the easiest file to edit.

Frontend long-term structure:

```text
src/
  app/
  features/
  shared/
  platform/
```

Rust long-term structure:

```text
src-tauri/src/
  lib.rs
  app/
  commands/
  platform/
  engine/
  data/
  domain/
```

### 5.2 Frontend Rules

- Put feature-specific behavior under `src/features/<feature>/`.
- Put external environment boundaries under `src/platform/`.
- Keep `src/shared/` for stable, low-context capabilities reused across
  features.
- Keep `src/app/` focused on application shell and cross-feature coordination.
- Do not access SQLite, Tauri APIs, or platform gateways directly from feature
  components or hooks.
- Do not reintroduce retired root layers such as `src/lib/` or `src/types/`.

### 5.3 Rust Rules

- Keep `lib.rs` focused on application assembly.
- Keep `commands/*` thin: receive parameters, map DTOs, and delegate.
- Keep platform-specific behavior under `platform/*`.
- Keep tracking rules and runtime behavior under `engine/*`.
- Keep SQLite pools, SQL, repositories, backup, and restore data access under
  `data/*`.
- Keep stable domain concepts and invariants under `domain/*`.

Do not move business logic into `commands/*`, `app/*`, or `lib.rs` for
convenience.

### 5.4 UI Rules

UI work must follow the Quiet Pro baseline:

- calm, professional, restrained desktop-product UI;
- typography, spacing, alignment, and hierarchy before decoration;
- semantic tokens before hardcoded colors, radii, borders, or shadows;
- existing `panel`, `control`, `chip`, and `status` archetypes before one-off
  treatments;
- complete interaction states where relevant: default, hover, active, focus,
  disabled, loading, and empty.

Do not introduce glassmorphism, blur-heavy panels, neon glow, large gradient
backgrounds, or page-local visual styles that do not belong to the design
system.

### 5.5 External Interface Rules

Changes that expose a local or network interface need an explicit security
review. Describe:

- whether the interface is disabled by default;
- which address it binds to;
- who can connect;
- how authentication works;
- how credentials are generated, stored, rotated, and revoked;
- how active and in-progress connections are stopped;
- how startup failures and port conflicts become visible to the user;
- whether the interface changes the local-first product boundary.

An interface bound to `127.0.0.1` is available only on the same computer. LAN
or remote access is a separate product and security decision.

## 6. Validation Requirements

Run focused checks while implementing, then run the required validation before
requesting review.

### 6.1 Default Code Validation

For frontend, UI, settings, read-model, or general code changes:

```bash
npm run check
```

This includes naming and architecture checks, focused frontend tests, UI smoke
tests, a real-browser smoke test, a production build, and bundle-budget checks.

### 6.2 Rust And Architecture Validation

For Rust changes, architecture boundary changes, runtime work, SQLite work, or
changes that touch tracking correctness:

```bash
npm run check:full
```

This includes the frontend validation chain and:

- Rust boundary checks;
- `cargo check`;
- Rust tests;
- `cargo clippy -- -D warnings`.

### 6.3 Release Validation

For release, changelog, updater, version, tag, or packaging changes:

```bash
npm run release:check
```

Follow [`docs/versioning-and-release-policy.md`](docs/versioning-and-release-policy.md)
for the full release workflow.

### 6.4 Documentation-Only Changes

Documentation-only pull requests do not require a full build by default.
Check:

- links;
- command names;
- terminology;
- UTF-8 readability;
- consistency with active top-level project documents.

### 6.5 Risk-Based Additional Checks

Add tests that match the behavior you changed.

| Change area | Minimum additional expectation |
| --- | --- |
| Tracking lifecycle | Cover session start, transition, sealing, recovery, or AFK behavior as relevant |
| SQLite schema or migration | Cover upgrades, preserved data, defaults, and legacy databases |
| Backup or restore | Cover preview, compatibility, data preservation, and runtime refresh |
| Settings | Cover persistence normalization, save behavior, and runtime synchronization |
| UI interaction | Cover primary interaction states and relevant browser smoke behavior |
| Local or network interface | Cover authentication, credential rotation, shutdown, active clients, in-progress clients, bind failures, and initial synchronization |

Passing existing tests does not replace coverage for newly introduced risk.

## 7. Open A Pull Request

### 7.1 Pull Request Title

Use a concise title that describes the result:

```text
feat: add optional local WebSocket status API
fix: seal active sessions after resume
docs: document contribution and PR workflow
```

### 7.2 Pull Request Description

Use this structure:

```md
## Purpose

Explain the user problem or maintenance goal.

Refs #123

## Changes

- Describe the important behavior changes.
- Mention the real owner modules that changed.

## Scope

- Describe what is intentionally included.
- Describe important non-goals.

## Risk Review

- Tracking correctness:
- Local data safety:
- Privacy or security:
- Compatibility:

## Validation

- [ ] `npm run check`
- [ ] `npm run check:full` when Rust or architecture boundaries changed
- [ ] Added or updated focused tests

## Screenshots

Add before/after screenshots for visible UI changes.
```

Keep the description readable. Explain behavior and risk before implementation
detail.

### 7.3 Reference Issues Without Closing Them

Use:

```text
Refs #4
```

Do not use:

```text
Closes #4
Fixes #4
Resolves #4
```

Issue state changes are explicit maintainer actions. A pull request should not
close, reopen, label, or otherwise mutate an issue unless the maintainer asks
for that action.

### 7.4 Include Screenshots For UI Changes

For visible UI changes, include screenshots showing:

- the relevant page;
- important empty, disabled, or error states when applicable;
- light and dark themes when the visual role changes;
- narrow layouts when the change affects responsive behavior.

## 8. Rebase Before Review Or Merge

### 8.1 What Rebase Means

Rebase moves your branch commits on top of the latest `main`:

```text
Before:

main:       A---B---C
                 \
feature:          D---E

After:

main:       A---B---C
                     \
feature:              D'---E'
```

This keeps the pull request based on current code and exposes conflicts before
merge.

### 8.2 When To Rebase

Rebase when:

- GitHub reports merge conflicts;
- `main` changed in the same files;
- the maintainer asks for an update;
- you are preparing the final version for merge.

### 8.3 Rebase Commands

For a branch pushed directly to this repository:

```bash
git status
git fetch origin main
git rebase origin/main
```

Resolve conflicts carefully, then continue:

```bash
git add path/to/resolved-file
git rebase --continue
```

After the rebase:

```bash
git push --force-with-lease
```

Use `--force-with-lease`, not `--force`. It refuses to overwrite unexpected
remote changes.

If the rebase needs to be abandoned:

```bash
git rebase --abort
```

For fork-based contributions, replace `origin/main` with `upstream/main`, then
push the rebased branch to your fork.

### 8.4 Resolve Conflicts By Behavior

Do not choose conflict sides mechanically.

When resolving conflicts:

1. Understand what changed on `main`.
2. Keep newer correctness fixes and architecture direction from `main`.
3. Reapply only the feature-specific behavior needed by the pull request.
4. Remove unrelated changes that are already superseded by `main`.
5. Run the required validation again.

Ask for help if a conflict touches tracking semantics, SQLite migrations,
backup or restore behavior, or a boundary you do not fully understand.

## 9. Review Process

Review is not only a style pass. The main purpose is to protect trustworthy
tracking behavior, local data, clear ownership, and long-term maintainability.

### 9.1 Review Order

Reviewers should check in this order:

1. Does the change solve the stated problem?
2. Does it fit the current product scope?
3. Does the diff contain unrelated changes?
4. Is the code placed under the correct owner?
5. Could it affect tracking correctness, local data, privacy, or security?
6. Are failure states visible and recoverable?
7. Do tests cover the new risk?
8. Does the branch conflict with the latest `main`?
9. Are remaining style or naming improvements worth blocking the merge?

### 9.2 Blocking Issues

Resolve these before merge:

- possible data loss or corruption;
- incorrect tracking, session transitions, or recovery behavior;
- authentication, privacy, or credential-revocation gaps;
- disabled services or closed connections continuing to expose data;
- unsafe backup, restore, cleanup, or migration behavior;
- build failures or required validation failures;
- conflicts with `main`;
- unrelated changes that obscure the intended diff;
- a responsibility placed in the wrong layer when merging it would create a
  new long-term boundary problem.

### 9.3 Follow-Up Issues

Small non-blocking improvements can be handled after merge when the accepted
implementation is already correct and safe. Examples:

- copy polish;
- minor naming improvements;
- small readability refactors;
- optional diagnostics;
- additional nice-to-have tests beyond the risk-bearing path.

Do not defer correctness, data safety, privacy, security, or required boundary
fixes as follow-up work.

### 9.4 Responding To Review Feedback

When updating a pull request:

1. Reply briefly when the intended behavior needs clarification.
2. Push focused follow-up commits or rebase when requested.
3. Mention which validation commands were rerun.
4. Mark conversations resolved only when the underlying issue is actually
   addressed.

## 10. Merge Rules

This is a personal repository. The maintainer may push confirmed internal work
directly to `origin/main`. Contributor pull requests should stay focused and be
merged only after the blocking review items are resolved.

Before merging a pull request:

1. Confirm the branch is based on the latest `main`.
2. Confirm required validation passed.
3. Confirm blocking review findings are resolved.
4. Confirm the final diff contains only the intended scope.
5. Confirm issue references use `Refs #N` unless an explicit close action was
   requested.
6. Confirm changelog or release notes are updated when the change belongs in
   the next release summary.

Do not create extra branches or pull requests for maintainer-owned follow-up
work unless there is a clear collaboration reason.

## 11. Quick Contributor Checklist

Before requesting review:

- [ ] I read the relevant active project documents.
- [ ] My branch started from a recent `main`.
- [ ] The pull request solves one coherent problem.
- [ ] I removed unrelated refactors and formatting churn.
- [ ] I placed new behavior under the correct owner.
- [ ] I added tests for the risk-bearing behavior.
- [ ] I ran `npm run check`.
- [ ] I ran `npm run check:full` if Rust, tracking, SQLite, runtime, or
      architecture boundaries changed.
- [ ] I included screenshots for visible UI changes.
- [ ] I documented security behavior for any local or network interface.
- [ ] I used `Refs #N` instead of an issue-closing keyword.
- [ ] I rebased if `main` changed or GitHub reports conflicts.

## 12. Quick Maintainer Review Checklist

Before merging:

- [ ] The change fits current product scope.
- [ ] The diff has a clear owner and no unrelated changes.
- [ ] Tracking, data safety, privacy, and security risks were checked first.
- [ ] Failure states are visible and recoverable.
- [ ] New risk has focused test coverage.
- [ ] Required validation passed.
- [ ] The branch is compatible with the latest `main`.
- [ ] Blocking findings are fixed before merge.
- [ ] Follow-up work contains only non-blocking improvements.
- [ ] Issue state changes remain explicit.

---

<a id="zh-cn"></a>

## 简体中文

感谢你愿意为 Patina 做出贡献。

Patina 是一个面向个人使用、本地优先的 Windows 桌面时间追踪工具。
项目重视可信的记录、清晰的职责边界、可读的界面，以及能够长期维护的改动。

本文说明如何准备改动、提交 Pull Request、响应 review 意见，以及判断一项改动是否可以合并。

### 1. 开始之前

开始编写代码前，请先阅读定义当前项目方向的文档：

- [`docs/product-principles-and-scope.md`](docs/product-principles-and-scope.md)
- [`docs/roadmap-and-prioritization.md`](docs/roadmap-and-prioritization.md)
- [`docs/engineering-quality.md`](docs/engineering-quality.md)
- [`docs/architecture.md`](docs/architecture.md)
- [`docs/issue-fix-boundary-guardrails.md`](docs/issue-fix-boundary-guardrails.md)
- UI 改动请阅读 [`docs/quiet-pro-component-guidelines.md`](docs/quiet-pro-component-guidelines.md)
- 发布改动请阅读 [`docs/versioning-and-release-policy.md`](docs/versioning-and-release-policy.md)

`docs/` 顶层的有效文档是当前事实来源。`docs/archive/` 下的文件是历史背景，
默认不应作为当前实现依据。

### 2. 项目优先级

当存在多种实现方式时，请按以下顺序判断：

1. 保护追踪正确性和本地数据安全。
2. 保持清晰的职责边界。
3. 保证高频桌面工作流清楚、可靠。
4. 优先采用能够完整解决问题的最小改动。
5. 只有符合当前产品范围时，才增加新的功能表面。

Patina 有意聚焦个人、本地优先的 Windows 桌面使用场景。除非先明确调整项目方向，
否则团队 SaaS、账号体系、云优先工作流、移动端优先功能和装饰性复杂度都不是当前重点。

### 3. 开始一项改动之前

#### 3.1 检查现有上下文

开始实现修复或功能前：

1. 搜索是否已有相关 issue 和 Pull Request。
2. 阅读相关的有效项目文档。
3. 先识别行为的真实 owner，再选择文件。
4. 判断任务是聚焦的小改动，还是更广泛的边界调整。
5. 不要在 Pull Request 中混入无关清理。

如果一项修复需要新增共享抽象、跨层迁移职责或新增兼容壳，请先暂停并解释设计，
再进入实现。

#### 3.2 选择合适的 issue

对于聚焦的 bug 修复、小型 UX 改进或范围清晰的功能，可以直接提交 Pull Request，
并引用相关 issue。
新建 issue 时，请使用对应的 GitHub Issue Form，并在发布前移除或脱敏窗口标题、
本地数据库内容、备份文件、访问 Token 和个人路径。

如果改动存在以下情况，请先讨论方向：

- 修改 tracking session 语义；
- 修改备份、恢复、清理或数据库 migration 行为；
- 暴露新的本机或网络接口；
- 新增共享抽象或跨层依赖；
- 改变产品范围；
- 引入 Quiet Pro 体系之外的新 UI 方向。

#### 3.3 安装依赖

准备贡献时，请使用 lock 文件安装依赖：

```bash
npm ci
```

常用开发命令：

```bash
npm run tauri dev
npm run build
```

### 4. 分支与提交工作流

#### 4.1 从最新 `main` 创建分支

先更新 `main`，再创建分支：

```bash
git switch main
git fetch origin main
git pull --ff-only origin main
git switch -c feat/short-description
```

使用简短、能够描述改动的分支名：

```text
feat/local-websocket-api
fix/session-sealing
docs/contribution-guide
```

如果你从 fork 贡献，请把主仓库添加为 `upstream`，并以 `upstream/main` 为基准：

```bash
git remote add upstream https://github.com/Ceceliaee/patina.git
git fetch upstream main
git rebase upstream/main
```

#### 4.2 保持 Pull Request 聚焦

一个 Pull Request 应只解决一个完整、连贯的问题。

请避免：

- 无关重构；
- 未触及区域的格式化改动；
- 顺手重命名；
- 与任务无关的生成文件改动；
- 在无关 UI 或集成功能中顺手修改 tracking 行为。

如果工作中发现另一个问题，请在 Pull Request 中说明或新建后续 issue，
不要扩大当前 diff。

#### 4.3 编写清晰的 commit

优先使用小而清楚的 commit，并使用简洁的提交信息：

```text
feat: add local websocket settings
fix: revoke websocket clients when token changes
docs: add pull request contribution guide
```

常见前缀：

- `feat:`：面向用户的新能力；
- `fix:`：bug 修复；
- `docs:`：仅文档改动；
- `refactor:`：不改变行为的结构整理；
- `test:`：仅测试改动；
- `chore:`：维护性工作；
- `release:`：发布准备。

除非维护者明确要求关闭 issue，否则不要使用 `Closes`、`Fixes` 或 `Resolves`
等自动关闭关键词。引用相关 issue 时请使用：

```text
Refs #4
```

### 5. 实现边界

#### 5.1 owner 优先

先选择真实 owner，再选择最方便修改的文件。

前端长期结构：

```text
src/
  app/
  features/
  shared/
  platform/
```

Rust 长期结构：

```text
src-tauri/src/
  lib.rs
  app/
  commands/
  platform/
  engine/
  data/
  domain/
```

#### 5.2 前端规则

- feature 私有行为放在 `src/features/<feature>/`。
- 外部环境边界放在 `src/platform/`。
- `src/shared/` 只放跨 feature 稳定复用、低上下文依赖的能力。
- `src/app/` 聚焦应用壳层和跨 feature 协调。
- feature 的 component 和 hook 不应直接访问 SQLite、Tauri API 或 platform gateway。
- 不要重新引入已经退出的根层目录，例如 `src/lib/` 或 `src/types/`。

#### 5.3 Rust 规则

- `lib.rs` 聚焦应用装配。
- `commands/*` 保持薄：接收参数、映射 DTO、转发调用。
- 平台相关行为放在 `platform/*`。
- tracking 规则和运行时行为放在 `engine/*`。
- SQLite pool、SQL、repository、备份和恢复数据访问放在 `data/*`。
- 稳定的领域概念和不变量放在 `domain/*`。

不要因为修改方便，就把业务逻辑塞进 `commands/*`、`app/*` 或 `lib.rs`。

#### 5.4 UI 规则

UI 改动必须遵守 Quiet Pro 基线：

- 安静、专业、克制的桌面产品界面；
- 优先使用排版、间距、对齐和层级，而不是装饰；
- 优先使用语义 token，而不是硬编码颜色、圆角、边框或阴影；
- 优先复用现有 `panel`、`control`、`chip` 和 `status` 原型，而不是新增一次性样式；
- 在适用时补齐交互状态：default、hover、active、focus、disabled、loading 和 empty。

不要引入玻璃拟态、重模糊面板、霓虹发光、大面积渐变背景，
或不属于设计系统的页面局部视觉样式。

#### 5.5 外部接口规则

暴露本机或网络接口的改动需要明确的安全审查。请说明：

- 接口是否默认关闭；
- 接口绑定哪个地址；
- 谁可以连接；
- 鉴权如何工作；
- 凭据如何生成、存储、轮换和撤销；
- 已连接和连接中的客户端如何停止；
- 启动失败和端口占用如何让用户看到；
- 接口是否改变了本地优先的产品边界。

绑定 `127.0.0.1` 的接口只能被同一台电脑访问。局域网或远程访问属于独立的产品和安全决策。

### 6. 验证要求

实现过程中先运行专项检查，请求 review 前再运行所需的完整验证。

#### 6.1 默认代码验证

对于前端、UI、设置、读模型或一般代码改动：

```bash
npm run check
```

它包含命名和架构检查、前端专项测试、UI smoke 测试、真实浏览器 smoke 测试、
生产构建和 bundle 预算检查。

#### 6.2 Rust 与架构验证

对于 Rust 改动、架构边界改动、runtime 工作、SQLite 工作，
或涉及 tracking 正确性的改动：

```bash
npm run check:full
```

它包含前端验证链，以及：

- Rust 边界检查；
- `cargo check`；
- Rust 测试；
- `cargo clippy -- -D warnings`。

#### 6.3 发布验证

对于 release、changelog、updater、版本、tag 或打包改动：

```bash
npm run release:check
```

完整发布流程见 [`docs/versioning-and-release-policy.md`](docs/versioning-and-release-policy.md)。

#### 6.4 仅文档改动

仅文档改动默认不要求运行完整构建。请检查：

- 链接；
- 命令名称；
- 术语；
- UTF-8 可读性；
- 与有效顶层项目文档的一致性。

#### 6.5 基于风险追加验证

请为实际修改的行为补充对应测试。

| 改动区域 | 最低追加要求 |
| --- | --- |
| Tracking 生命周期 | 根据改动覆盖 session 启动、切换、封口、恢复或 AFK 行为 |
| SQLite schema 或 migration | 覆盖升级、数据保留、默认值和旧数据库 |
| 备份或恢复 | 覆盖预览、兼容性、数据保留和 runtime 刷新 |
| 设置 | 覆盖持久化归一化、保存行为和 runtime 同步 |
| UI 交互 | 覆盖主要交互状态和相关浏览器 smoke 行为 |
| 本机或网络接口 | 覆盖鉴权、凭据轮换、关闭服务、已连接客户端、连接中客户端、绑定失败和初始同步 |

已有测试通过不能代替新增风险的对应覆盖。

### 7. 提交 Pull Request

#### 7.1 Pull Request 标题

使用简洁、能够描述结果的标题：

```text
feat: add optional local WebSocket status API
fix: seal active sessions after resume
docs: document contribution and PR workflow
```

#### 7.2 Pull Request 正文

使用以下结构：

```md
## Purpose

Explain the user problem or maintenance goal.

Refs #123

## Changes

- Describe the important behavior changes.
- Mention the real owner modules that changed.

## Scope

- Describe what is intentionally included.
- Describe important non-goals.

## Risk Review

- Tracking correctness:
- Local data safety:
- Privacy or security:
- Compatibility:

## Validation

- [ ] `npm run check`
- [ ] `npm run check:full` when Rust or architecture boundaries changed
- [ ] Added or updated focused tests

## Screenshots

Add before/after screenshots for visible UI changes.
```

正文应保持可读。先解释行为和风险，再说明实现细节。

#### 7.3 引用 issue，但不要自动关闭

请使用：

```text
Refs #4
```

不要使用：

```text
Closes #4
Fixes #4
Resolves #4
```

issue 状态变化属于维护者的显式操作。除非维护者明确要求，否则 Pull Request
不应关闭、重新打开、添加标签或以其他方式修改 issue 状态。

#### 7.4 UI 改动需要截图

对于可见的 UI 改动，请提供能够展示以下内容的截图：

- 相关页面；
- 适用时的重要 empty、disabled 或 error 状态；
- 视觉角色变化时的浅色和深色主题；
- 改动影响响应式行为时的窄布局。

### 8. Review 或合并前进行 rebase

#### 8.1 rebase 是什么

rebase 会把你的分支 commit 重新接到最新 `main` 后面：

```text
Before:

main:       A---B---C
                 \
feature:          D---E

After:

main:       A---B---C
                     \
feature:              D'---E'
```

这样可以让 Pull Request 基于当前代码，并在合并前暴露冲突。

#### 8.2 什么时候需要 rebase

遇到以下情况时，请执行 rebase：

- GitHub 提示存在合并冲突；
- `main` 修改了相同文件；
- 维护者要求更新分支；
- 正在准备最终合并版本。

#### 8.3 rebase 命令

对于直接推送到本仓库的分支：

```bash
git status
git fetch origin main
git rebase origin/main
```

仔细解决冲突，然后继续：

```bash
git add path/to/resolved-file
git rebase --continue
```

完成 rebase 后：

```bash
git push --force-with-lease
```

请使用 `--force-with-lease`，不要使用 `--force`。它会拒绝覆盖意外出现的远端改动。

如果需要放弃本次 rebase：

```bash
git rebase --abort
```

如果你通过 fork 贡献，请把 `origin/main` 替换为 `upstream/main`，
然后把 rebase 后的分支推送到自己的 fork。

#### 8.4 按行为解决冲突

不要机械地选择某一侧冲突内容。

解决冲突时：

1. 理解 `main` 发生了什么变化。
2. 保留 `main` 中更新的正确性修复和架构方向。
3. 只重新应用 Pull Request 真正需要的 feature 私有行为。
4. 删除已经被 `main` 取代的无关修改。
5. 重新运行所需验证。

如果冲突涉及 tracking 语义、SQLite migration、备份或恢复行为，
或你并不完全理解的边界，请寻求帮助。

### 9. Review 流程

Review 不只是样式检查。它的主要目的是保护可信的 tracking 行为、本地数据、
清晰职责和长期可维护性。

#### 9.1 Review 顺序

Review 时应按以下顺序检查：

1. 改动是否解决了所描述的问题？
2. 改动是否符合当前产品范围？
3. diff 中是否包含无关修改？
4. 代码是否放在正确的 owner 下？
5. 是否可能影响 tracking 正确性、本地数据、隐私或安全？
6. 失败状态是否可见、可恢复？
7. 测试是否覆盖了新增风险？
8. 分支是否与最新 `main` 冲突？
9. 剩余样式或命名改进是否值得阻塞合并？

#### 9.2 必须在合并前解决的问题

以下问题必须在合并前解决：

- 可能导致数据丢失或损坏；
- tracking、session 切换或恢复行为错误；
- 鉴权、隐私或凭据撤销缺口；
- 服务已经关闭或连接已经撤销，但数据仍然继续暴露；
- 不安全的备份、恢复、清理或 migration 行为；
- 构建失败或必需验证失败；
- 与 `main` 存在冲突；
- 无关改动遮蔽了真实 diff；
- 职责放错层级，并且合并后会制造新的长期边界问题。

#### 9.3 后续 issue

当已接受的实现正确、安全时，小型非阻塞改进可以在合并后处理。例如：

- 文案微调；
- 小型命名优化；
- 小型可读性重构；
- 可选诊断能力；
- 超出风险主路径的额外锦上添花测试。

不要把正确性、数据安全、隐私、安全或必需边界修复延后处理。

#### 9.4 响应 review 意见

更新 Pull Request 时：

1. 如果需要澄清预期行为，请简短回复。
2. 按要求推送聚焦的后续 commit 或执行 rebase。
3. 说明重新运行了哪些验证命令。
4. 只有底层问题真正解决后，才标记 conversation 为 resolved。

### 10. 合并规则

这是一个个人仓库。维护者可以把确认过的内部改动直接推送到 `origin/main`。
贡献者的 Pull Request 应保持聚焦，并在阻塞性 review 意见解决后再合并。

合并 Pull Request 前：

1. 确认分支基于最新 `main`。
2. 确认所需验证已通过。
3. 确认阻塞性 review findings 已解决。
4. 确认最终 diff 只包含预期范围。
5. 确认 issue 引用使用 `Refs #N`，除非明确要求执行关闭操作。
6. 如果改动属于下一次发布摘要范围，确认 changelog 或 release notes 已更新。

除非存在明确协作需要，不要为维护者自己处理的后续工作额外创建分支或 Pull Request。

### 11. 贡献者快速检查清单

请求 review 前：

- [ ] 我阅读了相关的有效项目文档。
- [ ] 我的分支从近期 `main` 创建。
- [ ] Pull Request 只解决一个完整、连贯的问题。
- [ ] 我删除了无关重构和格式化噪音。
- [ ] 我把新增行为放在正确的 owner 下。
- [ ] 我为承担风险的行为补充了测试。
- [ ] 我运行了 `npm run check`。
- [ ] 如果修改 Rust、tracking、SQLite、runtime 或架构边界，我运行了 `npm run check:full`。
- [ ] 对于可见 UI 改动，我提供了截图。
- [ ] 对于本机或网络接口，我说明了安全行为。
- [ ] 我使用 `Refs #N`，没有使用 issue 自动关闭关键词。
- [ ] 如果 `main` 已变化或 GitHub 提示冲突，我执行了 rebase。

### 12. 维护者 Review 快速检查清单

合并前：

- [ ] 改动符合当前产品范围。
- [ ] diff 有清楚的 owner，不包含无关修改。
- [ ] 优先检查了 tracking、数据安全、隐私和安全风险。
- [ ] 失败状态可见、可恢复。
- [ ] 新增风险有专项测试覆盖。
- [ ] 必需验证已通过。
- [ ] 分支与最新 `main` 兼容。
- [ ] 阻塞性问题已经在合并前修复。
- [ ] 后续工作只包含非阻塞改进。
- [ ] issue 状态变化仍然是显式操作。
