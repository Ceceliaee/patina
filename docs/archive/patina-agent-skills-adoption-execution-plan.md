# Patina 仓库专用 Agent Skills 建设执行方案

## 0. 文档状态

- [x] 文档类型：一次性、可勾选执行方案
- [x] 创建日期：2026-08-30
- [x] 实施状态：已完成（2026-08-30）
- [x] 完成后状态：长期规则已回写，本文已移动到 `docs/archive/`
- [x] 主要 owner：仓库协作规则、工程质量、Agent 工作流
- [x] 当前目标：把 Patina 已有的长期规则和验证脚本组织成少量、可触发、可审计的仓库专用 skills，建立外部 skills 的可发现、可评审、可回退更新生命周期，并在 skills 稳定后完成长期文档归位与去重复
- [x] 明确决策：可见 UI 的 Pull Request 必须提供外部截图证据，但截图、GIF 和视频不得提交进仓库或进入 Git 历史；长期可重复证据仍由测试、门禁和契约承担
- [x] 最终边界修正：`.agents/` 与 `skills-lock.json` 是被 Git 忽略的本地工作区状态；skills 不作为仓库内容、协作者前提或 CI 输入
- [x] 最终治理归位：中间产物 `docs/agent-skills.md` 已移入本地 `patina-skill-governance` skill；仓库只保留不可依赖本地 skill 的常驻安全规则
- [x] 最终退场状态：7 个重复、冲突或 user-scope skills 的 payload 已从本地工作区彻底移除；7 个 Patina skills 与 4 个仍有独立价值的外部 skills 保持活跃

本文定义实施顺序、边界、验收和回滚方式；完成记录见第 24 节。执行者不得因为某个复选框出现在本文中，就把它解释为修改 GitHub Project、提交、推送、创建 tag、发布 Release、删除现有 skill 或改变外部状态的授权。

第 1 节至第 24.6 节记录了本轮先建立“仓库版本化 skills”方案、完成验证并进行第一次对抗式审查的历史过程。维护者随后明确要求忽略 `.agents/`，因此最终有效状态以第 24.7 节及当前 `AGENTS.md` 为准；旧复选框表示对应步骤当时确实执行过，不表示其产物仍是当前仓库要求。

本文是 `docs/working/` 下的临时执行依据。完成后必须把仍然有效的长期规则写回对应长期 owner，再将本文整体移动到 `docs/archive/`；不得把已完成执行步骤长期留在顶层 `docs/`。

## 1. 第一性原理

### 1.1 Skill 是情境化执行协议，不是事实来源

Patina 已经通过长期文档定义产品、架构、工程质量、Quiet Pro、稳定期修复和发布规则。新增 skill 的职责不是复制这些规则，而是在命中特定任务时回答：本次要读取哪些 owner、按什么顺序判断、何时停止、运行哪些验证、最终如何报告。

- [x] 每个 skill 都只链接长期事实 owner，不复制整段长期政策。
- [x] 长期规则变化时先更新 owner 文档，再调整 skill 的流程或链接。
- [x] `AGENTS.md` 只保留每次任务都必须知道的常驻约束和指向 skill 的简短路由。
- [x] `SKILL.md` 不保存产品契约、协议字段、数据库格式或发布版本事实。
- [x] `references/` 只保存该 skill 独有的判断表、示例和报告格式，不建立第二套长期规则。
- [x] 人类贡献者、不加载 skill 的 Agent 和外部工具仍能从长期文档读到完整政策；skill 不能成为关键规则的唯一入口。
- [x] 删除长期文档段落前，先建立新的长期 owner 或确认原 owner 仍完整，再让 skill 只引用该 owner。

### 1.2 长期可重复证据与 PR 外部截图分层

证据承担两个不同任务：测试、门禁和契约证明行为可重复；PR 截图帮助维护者审查可见 UI 的真实呈现。截图是 UI review 的必要补充，但不能替代行为测试，也不能为了保留审查附件而污染仓库历史。

- [x] UI、交互和桌面运行时的长期证据使用测试、门禁、结构化日志和明确文字结果。
- [x] 可见 UI 的 Pull Request 必须在 PR 正文提供截图证据。
- [x] 截图通过 GitHub `user-attachments` 或其他仓库外 HTTPS 附件提供，不提交到 PR branch、`main`、tag 或 assets branch。
- [x] PR intake gate 继续验证可见 UI 变更存在外部截图和 Quiet Pro 确认。
- [x] 截图不能替代 focused tests、browser/runtime gates 或风险说明。
- [x] GIF 和视频不作为必需证据，也不建立录制、编码或发布流程。
- [x] 临时截图只允许写入 gitignored 或系统临时目录；完成外部上传后清理，不纳入仓库产物。
- [x] 手工 UI 检查同时记录检查对象、状态、结果和限制，避免截图成为唯一说明。
- [x] 用户在 Issue 中自愿提供的图片只作为问题上下文，不能替代复现步骤、测试或验收证据。

这里的“PR 外部截图”不等于产品本身的截图采集能力，也不等于测试失败时受控的临时诊断。执行时必须精确区分：

- [x] 不删除 `src-tauri` 下属于产品能力的截图采集、保留期或路径安全实现。
- [x] 不删除 `screenshot-capture` 风险域及其 Rust 测试要求。
- [x] 不因为本计划批量删除测试框架中仅在显式环境变量下启用的临时诊断能力。
- [x] 任何临时诊断都不得提交进仓库；PR 所需截图必须通过外部附件承载。

### 1.3 稳定期兼容性高于表面代码缩减

Patina 是 `1.x` 稳定期、本地优先的桌面数据产品。减少行数、文件或类型数量不能自动证明简化成立；如果变化削弱 tracking 可信度、已发布数据读取、备份恢复、升级、协议兼容或安全拒绝路径，就不再是普通简化。

- [x] 所有简化候选先判断用户可见行为、持久化语义和外部兼容性是否变化。
- [x] 数据库 migration、repair、备份读取、恢复回滚、升级身份与旧路径兼容默认受保护。
- [x] Patina Web Activity 协议、updater、release artifact 和外部调用方边界默认受保护。
- [x] “没有当前前端调用方”不能单独证明已发布接口或持久化字段可以删除。
- [x] 任何行为差异都升级为明确的产品或边界决策，不在普通清理中静默接受。

### 1.4 少量高质量 skill 优于大量重叠 skill

每新增一个 skill 都会增加触发竞争、上下文加载和维护成本。第一阶段只建设高频、边界清晰、能够直接复用现有门禁的 Patina 专用 skill。

- [x] 首批 skill 控制在六个。
- [x] 不为相近任务创建多个只改名称的 skill。
- [x] `dsh-trim-cot-leakage` 的原则并入 Patina prose/doc 工作流，不单独复制。
- [x] `dsh-archive-agent-notes` 只保留为未来决策记录体系的参考，不在本轮实施。
- [x] `dsh-translate-docs` 只借鉴显式触发和最小差异思想，不复制双语 Markdown triplet 流程。
- [x] `dsh-merging-stacked-prs` 在 Patina 未采用官方 PR stack 前不实施。
- [x] `record-browser-gif` 不引入、不移植；Patina 只保留外部静态 PR 截图，不建立 GIF/视频工作流。

### 1.5 读、写、远端动作必须分权

审计、review、实现、提交、push、Project 修改和发布是不同权限。skill 只能执行用户当前请求已经授权的动作。

- [x] `review`、`audit`、`find` 和 `report` 默认只读。
- [x] `fix`、`implement`、`create` 或等价请求才允许修改明确范围内的本地文件。
- [x] 本地提交需要当前任务明确授权。
- [x] 任何 `git push` 都需要当前任务明确表达远端目的地。
- [x] tag、Release、Issue、PR 和 Project 状态修改分别需要对应授权。
- [x] skill 的“完成”定义不得隐式包含提交、push 或远端清理。

### 1.6 Agent 自动化必须可审计

自然语言流程会漂移，关键元数据和资源关系应由轻量门禁保护；语义判断仍由 review 承担。

- [x] 机器检查名称、目录、frontmatter、必需章节、相对链接、编码和已声明命令。
- [x] 机器检查仅覆盖确定性事实，不尝试用关键词判断架构质量。
- [x] 每条门禁有自测，至少包含一个有效夹具和一个明确无效夹具。
- [x] 新门禁先覆盖 `patina-*` skills，不让历史第三方 skill 一次性阻塞整个仓库。
- [x] 旧 skill 的冲突通过单独审计和确认处理，不靠宽泛自动重写。
- [x] 外部 skill 更新视为可执行依赖升级：发现可以自动，采纳必须经过隔离 diff、策略审查和旧版对照评测。
- [x] 联网上游检查只报告 `current`、`update-available`、`unknown` 或 `untracked`，不得直接覆盖工作区。
- [x] 离线质量门禁只验证仓库内可确定事实，不把网络可用性或“是否最新”接入普通 `npm run check`。

### 1.7 外部 skill 追求可审计，不追求永远最新

外部 skill 的 `SKILL.md`、脚本和资源会改变 Agent 的判断、工具调用和权限边界。它们不是普通参考资料，而是需要锁定、评审和回退的行为依赖。上游更新可能包含有价值的修复，也可能扩大触发范围、引入不适用于 Codex 的工具假设，或者与 Patina 的长期规则冲突。

- [x] 仓库继续保存已经评审通过的外部 skill 快照，而不是在每次运行时动态加载上游默认分支。
- [x] `skills-lock.json` 保存安装来源和当前内容哈希；独立注册表保存 Patina 接受的分类、上游 revision、评审状态和更新策略。
- [x] 不把上游默认分支的最新状态等同于 Patina 已接受状态。
- [x] 不在主工作区直接批量运行 `npx skills update -p -y`。
- [x] 有本地 Patina 规则时优先使用 wrapper、overlay 或 Patina-owned skill，不直接修改外部快照制造不可追踪 fork。
- [x] 无法重建历史上游 commit 的旧安装标记为 `legacy-hash-only`，保留现有内容哈希，不编造 revision。
- [x] 首次接受可重建的新版本后记录准确完整 commit SHA；tag 只作为人类可读版本信息，不能代替不可变 revision。

## 2. 来源与边界

### 2.1 Patina 当前事实 owner

执行前必须以这些当前文件为准：

- [`../product-principles-and-scope.md`](../product-principles-and-scope.md)：产品范围、核心用户和非目标。
- [`../roadmap-and-prioritization.md`](../roadmap-and-prioritization.md)：稳定期优先级与 GitHub Project 协作。
- [`../engineering-quality.md`](../engineering-quality.md)：质量维度、验证入口、外部 PR intake 和归档规则。
- [`../architecture.md`](../architecture.md)：前端与 Rust owner、边界、高吸力层和最低验证。
- [`../issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md)：小修、边界判断和执行单分流。
- [`../quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)：Quiet Pro、组件 owner、状态与真实浏览器证据。
- [`../versioning-and-release-policy.md`](../versioning-and-release-policy.md)：版本、提交、push、tag、Release 和发布验证。
- [`../localization.md`](../localization.md)：本地化 owner、生成、审查和导入边界。
- [`../../AGENTS.md`](../../AGENTS.md)：每次任务必须遵守的常驻协作规则。

### 2.2 外部参考的定位

下列 DSH skills 只提供结构和判断方法，不构成 Patina 当前事实：

- [`dsh-find-simplifications`](https://github.com/deepseek-ai/deepseek-harness/tree/master/.agents/skills/dsh-find-simplifications)
- [`dsh-code-review`](https://github.com/deepseek-ai/deepseek-harness/tree/master/.agents/skills/dsh-code-review)
- [`dsh-pre-push-checks`](https://github.com/deepseek-ai/deepseek-harness/tree/master/.agents/skills/dsh-pre-push-checks)
- [`dsh-prose-standard`](https://github.com/deepseek-ai/deepseek-harness/tree/master/.agents/skills/dsh-prose-standard)
- [`dsh-doc`](https://github.com/deepseek-ai/deepseek-harness/tree/master/.agents/skills/dsh-doc)
- [`dsh-trim-cot-leakage`](https://github.com/deepseek-ai/deepseek-harness/tree/master/.agents/skills/dsh-trim-cot-leakage)

以下内容明确不进入本轮：

- [x] 不复制 DSH 的预发布兼容策略。
- [x] 不复制“每个非机械变更都必须写 Agent Note”。
- [x] 不复制双语 Agent Note triplet、hash manifest 或冻结归档机制。
- [x] 不复制官方 GitHub stacked PR 强制流程。
- [x] 不复制 GUI PR 的 GIF、视频或真实模型演示要求；只保留 Patina 自己的外部静态截图要求。

### 2.3 当前外部 skill 安装基线

仓库根目录当时存在的 `skills-lock.json` 已为 11 个本地外部 skills 记录 GitHub 来源、部分上游路径和当前内容哈希。它是本机安装状态的重要输入，但不是仓库供应链清单：多数条目没有固定上游 commit 或 tag，也没有 Patina 分类、评审日期、局部适配和更新结论。最终它与 `.agents/` 一并被 Git 忽略。

- [x] 保留 `skills-lock.json` 作为 Skills CLI 管理的安装锁文件，不手工塞入可能被 CLI 覆盖的 Patina 私有字段。
- [x] 逐项验证 lock 中的名称能映射到唯一 `.agents/skills/<directory>/SKILL.md`。
- [x] 逐项验证 `computedHash` 与当前安装内容一致；不一致时先判断本地修改来源，不能直接更新覆盖。
- [x] 不用 `SKILL.md` 自报的 `version` 代替上游 commit，因为现有外部 skills 并未统一维护版本字段。
- [x] 将 Patina 接受状态保存在独立的 `.agents/skills-registry.json`，并由确定性 checker 验证它与 lock、目录和分类表一致。

### 2.4 目标长期 owner

本计划实施后新增 `docs/agent-skills.md` 作为 Agent Skills 的长期 reference owner。该文件在创建前只是目标产物，不得在创建失败时通过指向 working 方案代替。

- [x] `agent-skills.md` 拥有 Patina-owned skill 规范、外部 skill 分类、registry/lock 关系、更新生命周期、触发评测和退役规则。
- [x] `engineering-quality.md` 拥有代码与文档 prose 的长期质量要求，以及 skill gate 在总体质量图中的位置。
- [x] 产品、架构、Quiet Pro、发布、路线图、本地化和贡献契约继续由现有长期文档拥有；`agent-skills.md` 只链接，不复制其正文。
- [x] `AGENTS.md` 只保留常驻安全边界和路由，不成为 skill 规范或外部更新流程的第二 owner。
- [x] 本 working 方案在上述 owner 均已建立并通过链接验证后才能归档。

## 3. 目标结果

### 3.1 首批仓库专用 skills

- [x] 创建 `patina-find-simplifications`：从明确范围中寻找少量、证据充分的删除、合并、降级或 rehome 候选。
- [x] 创建 `patina-code-review`：对本地 diff 或 Pull Request 做 owner-first、风险优先的语义 review。
- [x] 创建 `patina-pre-push-checks`：从实际 outgoing diff 选择与风险匹配的验证，并分离验证与 push 授权。
- [x] 创建 `patina-prose-standard`：保护完整契约，清理代码复述、审查辩解和会话推理残留。
- [x] 创建 `patina-doc-hygiene`：管理长期文档、working 执行单、archive、链接和 UTF-8。
- [x] 创建 `patina-quiet-pro-review`：审查 UI owner、token、组件状态、可访问性和可重复测试，并确保可见 UI PR 的截图通过仓库外附件提供。

### 3.2 自动化与治理

- [x] 新增 `scripts/check-agent-skills.ts`。
- [x] 新增 `check:agent-skills:self-test` package script。
- [x] 新增 `check:agent-skills` package script。
- [x] 将两项检查接入 `npm run check` 的唯一执行图，避免重复执行。
- [x] skill 内容结构和语义门禁只对 `patina-*` skills 阻塞；第三方 skill 内容先报告、后治理，已建立接受基线后的 lock/registry/目录一致性可以阻塞。
- [x] 为六个 skills 建立正向与负向触发用例。
- [x] 为 skill 之间的重叠场景建立路由优先级。
- [x] 新增 `.agents/skills-registry.json`，通过 lockKey 关联来源，并登记所有项目级外部 skills 的分类、接受基线和更新策略。
- [x] 新增 `scripts/check-agent-skill-updates.ts`，只读比较注册表与上游状态，不修改 skill、lock 或 Git 工作区。
- [x] 新增 `check:agent-skill-updates:self-test` 和按需执行的 `check:agent-skill-updates` package scripts。
- [x] 将注册表、lock 和本地目录的一致性检查纳入 `check:agent-skills`；联网更新检查不接入普通 `npm run check`。

### 3.3 当前协作入口收口

- [x] 更新 `CONTRIBUTING.md` 的英文和中文截图条款，明确截图只通过 GitHub `user-attachments` 或仓库外 HTTPS 附件提供。
- [x] 保留 `.github/pull_request_template.md` 的截图 checkbox 和 `Screenshots` 章节，同时明确禁止把证据媒体提交进仓库。
- [x] 保留 PR intake policy 的外部图片验证，并拒绝同仓库 blob/raw URL 充当截图证据。
- [x] 更新 PR intake tests，同时验证外部截图存在、Quiet Pro 已确认、可重复 UI 验证信息完整且仓库未新增审查媒体。
- [x] 检查 Issue 模板，确保图片只可能作为可选问题上下文，而不是必需证据。
- [x] 审计项目级第三方 skills 中与 Patina 冲突的截图、视觉冒险和自动重构指令。
- [x] 在新 skills 稳定后，缩减 `AGENTS.md` 中可下沉的情境流程，并保留关键安全规则。

### 3.4 长期文档归位与修剪

- [x] 新增 `docs/agent-skills.md`，承接长期 Agent Skills 治理事实。
- [x] 在 `docs/engineering-quality.md` 增加 prose 长期规则和 skill 质量门禁的 owner 说明。
- [x] 逐份审计当前顶层长期文档，把 Agent 执行步骤下沉到 skills，把领域事实、契约和人类贡献规则保留在原 owner。
- [x] 缩短各文档末尾重复的“给 Codex 与后续协作者”段落，只保留该文档独有且无法由路由表达的约束。
- [x] 不为减少行数而删除领域解释、失败契约、兼容性理由、验证最低门槛或人类贡献步骤。
- [x] 为每个删除、替换或链接化的段落建立可追踪去向和语义强度对照。

## 4. 非目标

- [x] 本计划不实现任何产品功能。
- [x] 本计划不改变 tracking、统计、SQLite、备份、恢复或 Web Activity 协议行为。
- [x] 本计划不创建完整 Agent Notes 或 ADR 生命周期体系。
- [x] 本计划不创建 GitHub Project item；如未来需要，先展示完整预览并取得确认。
- [x] 本计划不自动删除、移动或重写现有第三方 skills。
- [x] 本计划不要求一次性清理全部 `AGENTS.md` 或全部文档重复。
- [x] 本计划不把截图、GIF 或视频提交进仓库，不创建媒体 assets branch，不建立 GIF/视频发布流程；可见 UI PR 的静态截图通过仓库外附件提供。
- [x] 本计划不删除产品截图能力或其风险测试。
- [x] 本计划不创建分支、Pull Request、tag 或 Release。
- [x] 本计划不授权提交或 push。
- [x] 本计划不自动跟随任何外部 skill 的默认分支，不自动执行批量升级，也不因发现新版本直接覆盖项目级 skill。
- [x] 本计划不设长期文档删减行数目标，不把“文档更短”本身当作完成证据。
- [x] 本计划不因 skill 存在而缩短 `CONTRIBUTING.md` 的人类贡献契约，或删除当前领域文档中的事实、原因和最低验证门槛。

## 5. 目标目录结构

实施完成后的目标结构如下。只有在内容确实需要独立加载时才创建 `references/` 或 `templates/`；不得为了目录整齐创建空文件夹。

```text
.agents/
  skills-registry.json
  skills/
    patina-find-simplifications/
      SKILL.md
      references/
        candidate-rubric.md
    patina-code-review/
      SKILL.md
      references/
        risk-review-map.md
    patina-pre-push-checks/
      SKILL.md
      references/
        validation-map.md
    patina-prose-standard/
      SKILL.md
      references/
        examples.md
    patina-doc-hygiene/
      SKILL.md
      templates/
        working-execution-plan.md
    patina-quiet-pro-review/
      SKILL.md
      references/
        interaction-review.md
scripts/
  check-agent-skills.ts
  check-agent-skill-updates.ts
docs/
  agent-skills.md
```

每个 `SKILL.md` 使用最小、可移植的 frontmatter：

```markdown
---
name: patina-example
description: Use when ...
---
```

- [x] `name` 使用 kebab-case。
- [x] 目录名与 `name` 完全一致。
- [x] `description` 写清正向触发场景和关键排除场景。
- [x] 在确认当前 Codex skill loader 支持前，不复制 DSH 专用的 invocation frontmatter 字段。
- [x] 不写模型固定、人格、营销语或无法验证的效果声明。

每个 Patina skill 至少包含：

```text
Purpose
Scope and exclusions
Sources of truth
Inputs
Workflow
Stop conditions
Validation
Reporting
```

- [x] `Purpose` 只说明该 skill 解决的任务。
- [x] `Scope and exclusions` 区分只读审计与授权修改。
- [x] `Sources of truth` 链接当前 owner，不复制正文。
- [x] `Inputs` 要求明确范围、base、目标或风险上下文。
- [x] `Workflow` 给出顺序和判断节点。
- [x] `Stop conditions` 列出不能继续自动推进的信号。
- [x] `Validation` 只列真实存在并与风险匹配的命令。
- [x] `Reporting` 规定最终必须交代的证据、限制和未完成项。

## 6. 阶段一：锁定基线并明确 PR 截图的仓库外存储政策

### 6.1 保护当前工作区

- [x] 运行 `git status --short --branch`，记录实施开始时已有的用户改动。
- [x] 将本计划相关文件与既有业务改动区分，禁止覆盖、恢复或格式化无关文件。
- [x] 如现有改动与目标文件重叠，先读取完整 diff，再决定能否安全并行修改。
- [x] 不使用 `git reset --hard`、`git checkout --` 或其他破坏性恢复命令。
- [x] 后续每个阶段开始前重新检查工作区，避免把新产生的无关改动纳入范围。

### 6.2 建立当前规则追踪表

- [x] 搜索当前有效文件中的 `screenshot`、`截图`、`GIF`、`video evidence` 和同义表达。
- [x] 将命中项分成“PR 外部截图要求”“仓库内审查媒体”“用户问题上下文”“产品截图能力”“测试临时诊断”五类。
- [x] 保留并澄清“PR 外部截图要求”，移除或阻止“仓库内审查媒体”。
- [x] 为 `CONTRIBUTING.md` 英文和中文重复段落建立一一对应修改清单。
- [x] 为 PR 模板、PR intake policy 和 tests 建立同一行为的追踪关系。
- [x] 确认 `docs/archive/` 只记录历史，不因新政策回写或重写归档执行单。

### 6.3 修改贡献文档和 Pull Request 模板

- [x] 保留“UI changes include screenshots”及中文等价条款。
- [x] 保留 PR 示例中的 `Screenshots attached` checkbox。
- [x] 保留 `## Screenshots` 模板章节及中文等价内容。
- [x] 明确截图使用 GitHub PR 编辑器上传后的 `user-attachments` URL，或其他仓库外 HTTPS 附件。
- [x] 明确禁止把 before/after、review、demo、evidence 截图提交到 branch、`main`、tag、release asset 或同仓库 assets branch。
- [x] 明确不要求 GIF 或视频。
- [x] 保留 Quiet Pro、owner、状态完整性、风险和验证要求。
- [x] 在 `UI Validation` 或现有 Validation 中列出受影响状态、键盘/焦点行为、自动测试和已运行命令。
- [x] 明确现有测试已经覆盖时可以说明 owner test，不强迫为静态展示制造重复测试。
- [x] 对视觉角色、主题或窄布局确有变化时要求对应静态截图，但仍通过仓库外附件提供。

### 6.4 修改 PR intake gate

- [x] 保留 `Screenshots attached` checkbox 解析。
- [x] 保留 PR 正文 Markdown image、`<img>` 和 HTTPS 图片链接检测。
- [x] 优先接受 `https://github.com/user-attachments/assets/...`，并允许明确的仓库外 HTTPS 图片附件。
- [x] 拒绝当前仓库的 `blob/<branch>/...`、`raw` 或 raw.githubusercontent URL 充当审查截图，避免用同仓库 Git 对象保存证据。
- [x] 对 UI 实现路径要求 `UI follows Quiet Pro` 和 `Screenshots attached` 已确认。
- [x] 要求 `UI Validation` 或 `Additional validation` 包含可重复命令或 owner test 说明。
- [x] 新增精确的 `repository-review-media` 检查，阻止路径或文件名明确属于 before/after、review、demo、evidence 的图片、GIF 和视频进入 diff。
- [x] 不对所有图片扩展名做宽泛封禁；应用图标、品牌资源和产品功能资产必须继续按真实产品 owner 判断。
- [x] 不把“有图片”当作 UI 正确性的完整证明；缺少行为验证时仍失败。
- [x] 保留 hardcoded style、独立 CSS、错误 owner 和风险路径缺测试等现有门禁。
- [x] 保留 `screenshot-capture` 产品风险域和 Rust 测试匹配规则。

### 6.5 更新 PR intake tests

- [x] 将 `VALID_BODY` 的示例图片改为 GitHub `user-attachments` URL。
- [x] 保留 `testVisibleUiRequiresScreenshotEvidence`，补强为截图、Quiet Pro 与可重复验证的组合测试。
- [x] 有效用例证明：外部截图、Quiet Pro 确认和可重复验证信息齐全时通过。
- [x] 无效用例证明：可见 UI 变更缺少截图时失败。
- [x] 无效用例证明：缺少 Quiet Pro 确认时失败。
- [x] 无效用例证明：UI 变更既无 focused test 也无现有 owner test 说明时失败。
- [x] 无效用例证明：当前仓库 blob/raw URL 不能满足截图证据要求。
- [x] 无效用例证明：新增 `docs/screenshots/before.png`、`review-demo.gif` 或视频证据文件时失败。
- [x] 有效用例证明：真实产品图标或产品 screenshot-capture 代码不被 review-media 规则误伤。
- [x] 保持产品截图风险域测试原样通过。

### 6.6 阶段一验证

- [x] 运行 `npm run test:pr-intake`。
- [x] 运行 PR intake checker 的 self-test 或等价有效/无效夹具。
- [x] 搜索活动规则，确认截图要求明确指向仓库外附件，并明确禁止把审查媒体提交进仓库。
- [x] 确认 `docs/archive/` 未被修改。
- [x] 运行 `git diff --check`。
- [x] 记录实际命令和结果；若该阶段形成可见 UI 变化，截图只附到 PR 外部附件，不进入 Git diff。

## 7. 阶段二：建立 Patina skill 规范与机器门禁

### 7.1 定义确定性检查范围

- [x] checker 只枚举 `.agents/skills/patina-*/SKILL.md`。
- [x] 检查目录名和 frontmatter `name` 一致。
- [x] 检查名称符合 `^[a-z0-9]+(?:-[a-z0-9]+)*$`。
- [x] 检查 `description` 存在、非空且包含可识别的触发描述。
- [x] 检查 `Purpose`、`Scope and exclusions`、`Sources of truth`、`Inputs`、`Workflow`、`Stop conditions`、`Validation`、`Reporting` 章节存在。
- [x] 检查相对 Markdown 链接解析后位于仓库内并且目标存在。
- [x] 检查引用的 `npm run <script>` 在 `package.json` 中存在。
- [x] 检查文件可按 UTF-8 读取、没有 BOM、没有替换字符和常见 mojibake 标记。
- [x] 检查 Patina-owned skills 不要求把截图、GIF 或视频提交进仓库，也不创建媒体 assets branch；允许并要求可见 UI PR 使用仓库外静态截图。
- [x] 不检查第三方 skill 的人格、模型字段和完整内容，避免历史债务一次性阻塞。

### 7.2 编写 checker self-test

- [x] 在 `scripts/check-agent-skills.ts --self-test` 中使用临时夹具，不向真实 `.agents/skills` 写测试文件。
- [x] 有效夹具覆盖最小合法 frontmatter、章节和相对链接。
- [x] 无效夹具覆盖目录/name 不一致。
- [x] 无效夹具覆盖非 kebab-case 名称。
- [x] 无效夹具覆盖缺少必需章节。
- [x] 无效夹具覆盖失效相对链接。
- [x] 无效夹具覆盖不存在的 npm script。
- [x] 无效夹具覆盖 BOM 或 mojibake。
- [x] 无效夹具覆盖“把证据媒体提交仓库”或“创建 assets branch”的要求。
- [x] self-test 创建的临时目录在成功和失败路径都清理。
- [x] 删除临时目录前验证绝对路径位于测试专属临时根。

### 7.3 接入 package scripts

- [x] 添加 `check:agent-skills:self-test`。
- [x] 添加 `check:agent-skills`。
- [x] 将两项加入 `npm run check`，放在命名/架构类门禁附近。
- [x] 检查测试治理执行图，确保两项只执行一次。
- [x] 不删除或弱化现有 `check` 子命令。
- [x] 不借本次变更放宽 coverage、bundle 或 hotspot 预算。

### 7.4 阶段二验证

- [x] 运行 `npm run check:agent-skills:self-test`。
- [x] 运行 `npm run check:agent-skills`。
- [x] 人工制造一个临时无效夹具，确认顶层命令因预期规则失败后清理夹具。
- [x] 确认未触碰非 `patina-*` skills 的阻塞状态。
- [x] 运行 `git diff --check`。

## 8. 阶段三：实现 `patina-find-simplifications`

### 8.1 定义触发和权限

- [x] 正向触发包括：寻找简化机会、删除冗余、减少兼容壳、审计重复状态、识别过度设计、评估是否可删除 API。
- [x] 负向场景包括：实现已确认功能、普通 bug 修复、单纯性能分析、只要求格式化或重命名。
- [x] 默认模式是只读审计；用户明确要求实施后才修改代码。
- [x] 要求显式 scope；不得把一个局部请求自动扩大为全仓库清理。
- [x] 用户明确要求广度或多候选时才允许采用并行 agent 分区调查。

### 8.2 建立 Patina 候选判定标准

- [x] 强候选：没有生产消费者的 API、配置、事件、helper 或兼容壳。
- [x] 强候选：同一统计、状态或生命周期事实由两个 owner 重复维护。
- [x] 强候选：已退出能力仍保留只为其服务的测试、fixture、文档或 expected output。
- [x] 强候选：feature 私有逻辑滞留在 `app/*`、`shared/*`、`platform/*`、Rust `lib.rs` 或 `commands/*`。
- [x] 强候选：一次性 Quiet Pro 外壳与已有共享原型重复。
- [x] 强候选：手写实现可被标准库或健康依赖替代，并产生真实净删除。
- [x] 弱候选：只因为文件大、名字旧、代码看起来复杂或静态工具报 unused。
- [x] 弱候选：只能减少行数但不减少 API、状态、owner 或验证负担。

### 8.3 建立消费者证明流程

- [x] 先用 `rg` 搜索精确符号、command、event、配置键、SQLite 字段和协议字符串。
- [x] 分别记录生产消费者、测试/文档消费者和模糊入口。
- [x] 阅读每个模糊入口，判断它是否属于真实启动、loader、IPC、migration、外部协议或 release 路径。
- [x] 运行 `npm run quality:exports` 获取线索，但不把输出直接当删除结论。
- [x] 运行 `npm run quality:hotspots` 确定调查起点，但不按行数决定结果。
- [x] 必要时运行架构、命名或 IPC checker，验证候选是否触及受保护边界。
- [x] 对动态调用、serde/IPC 字段和 SQLite 字符串做额外搜索，避免只依赖 TypeScript 静态引用。

### 8.4 建立稳定期拒绝条件

- [x] 存在生产调用方且删除会改变已承诺能力时，降级为产品决策而不是清理。
- [x] 涉及数据库 migration、repair、备份读取或升级兼容时停止普通简化。
- [x] 涉及 Web Activity 协议或外部客户端兼容时停止普通简化。
- [x] 只是把复杂度移动到 wrapper、facade 或新 shared abstraction 时拒绝候选。
- [x] 会让高吸力层变厚时拒绝候选。
- [x] 会削弱安全拒绝路径、失败回滚或 tracking 可信度时拒绝候选。
- [x] 需要跨层迁移或新端口时，升级为边界判断或执行单。

### 8.5 定义候选报告

每个候选必须包含：

- [x] 标题和真实 owner。
- [x] 涉及文件和符号。
- [x] 生产、非生产与模糊消费者证据。
- [x] 当前维护成本。
- [x] 建议删除、合并、降级或 rehome 的内容。
- [x] 用户可见行为和持久化行为是否变化。
- [x] 兼容性与安全影响。
- [x] 净删除：删除的实现、测试、文档减去保留 glue。
- [x] 风险、替代方案和放弃的能力。
- [x] 实施模式：小修、边界判断、执行单或产品决策。
- [x] 验证命令。
- [x] 结论：推荐、保留、降级为局部 TODO 或等待确认。

### 8.6 阶段三验收

- [x] 用一个真实模块执行只读试跑。
- [x] 试跑至少产生一个被拒绝候选，证明 skill 不以候选数量为目标。
- [x] 试跑结果不修改代码、不创建 Project item、不提交或 push。
- [x] 正向触发用例能选择该 skill。
- [x] “修复某个明确 bug”不会误触发全仓库简化审计。
- [x] 运行 `npm run check:agent-skills`。

## 9. 阶段四：实现 `patina-code-review`

### 9.1 定义 review 类型

- [x] 本地 diff review：确认 base、工作区状态和改动范围。
- [x] 内部分支/PR review：读取 live base/head 和当前 CI 状态。
- [x] 外部贡献 PR：先执行 intake gate，未过门禁时停止逐行 review。
- [x] review 默认只报告发现；没有明确修复请求时不修改代码。

### 9.2 定义 review 顺序

- [x] 正确性、数据安全和不可逆风险优先。
- [x] tracking、session、备份、恢复、升级和外部协议优先于风格问题。
- [x] 判断真实 owner，检查高吸力层是否吸收新逻辑。
- [x] 检查 frontend/Rust/IPC/SQLite 接口两端是否一起变化。
- [x] 检查兼容壳是否有真实已发布边界和退出条件。
- [x] UI 改动检查 Quiet Pro、token、共享准入、状态和可访问性。
- [x] 用户可见 copy 检查 locale owner，不接受 JSX 或 Rust 调用点硬编码。
- [x] 测试必须保护新增风险和独有失败模式，不以数量或 coverage 百分比代替语义判断。
- [x] 文档和注释检查当前状态、owner 和完整契约。

### 9.3 定义 intake 停止条件

- [x] scope 未被接受时停止完整 review。
- [x] diff 超过仓库人工维护体量门槛且未拆分时停止完整 review。
- [x] 主要实现位于错误 owner 时先报告门禁失败。
- [x] Quiet Pro 主要方向需要维护者重做时先报告门禁失败。
- [x] 高风险行为没有 focused tests 时先报告门禁失败。
- [x] 可见 UI PR 缺少仓库外截图时报告 intake 失败；不要求 GIF 或视频，也不接受把截图提交仓库作为修复方式。

### 9.4 定义 findings 格式

- [x] 每条 finding 包含位置、缺陷、影响和证据。
- [x] 区分 blocker 与 suggestion。
- [x] 局部问题绑定最窄代码范围；跨层问题作为总体 finding。
- [x] 不重复报告已经由绿色门禁明确阻止的问题，除非门禁本身有缺口。
- [x] 没有 finding 时明确说明已检查范围和仍未验证的限制。
- [x] finding 仍用位置、影响和可重复证据说明；PR 截图只补充可见 UI 语境，不替代 finding。

### 9.5 阶段四验收

- [x] 使用一个小型本地 diff 验证 review 路由。
- [x] 使用一个模拟 intake 失败的 PR body 验证提前停止。
- [x] 使用一个包含 UI 变化、GitHub 外部截图附件且仓库 diff 无媒体文件的有效 PR body 验证不会误报。
- [x] 确认 review 请求不会自动实施修复。
- [x] 运行 `npm run test:pr-intake` 和 `npm run check:agent-skills`。

## 10. 阶段五：实现 `patina-pre-push-checks`

### 10.1 分离验证与 push

- [x] skill 可以在“准备提交、准备 push、准备交付、准备发布”时触发。
- [x] skill 首先检查 branch、root、工作区和 outgoing diff。
- [x] 没有当前任务远端授权时只运行验证并报告“未 push”。
- [x] commit 授权不解释为 push 授权。
- [x] 普通 push 授权不解释为 tag、Release、Issue 或 Project 修改授权。

### 10.2 建立风险到验证的映射

- [x] 局部开发先运行命中的 focused test。
- [x] 普通前端、读模型和 UI 改动交付前运行 `npm run check`。
- [x] Rust、架构边界、tracking、数据和恢复路径运行 `npm run check:full`。
- [x] IPC 注册、capability、plugin SQL 或真实桌面 runtime 追加 `npm run test:tauri-runtime-smoke`。
- [x] 性能敏感 read model、SQLite 查询或导航追加 `npm run perf:stable`。
- [x] release、changelog、updater、版本或打包追加对应 release validator；正式准备发布运行 `npm run release:check`。
- [x] 本地化结构变化运行 `check:i18n:self-test`、`check:i18n` 和 `check:full`；翻译-only 按长期文档选择较小集合。
- [x] 纯文档改动按 owner 规则运行编码、链接、skill gate 和 `git diff --check`，不机械构建产品。

### 10.3 避免重复和错误声明

- [x] 同一代码状态下已通过的检查不因 commit 或 push 再无意义重复。
- [x] base 或 diff 变化后只重跑被变化影响的证据。
- [x] 失败时记录完整命令、失败测试和最后观测，不用“可能是环境”直接归因。
- [x] pending CI 报告为 pending，不宣称通过。
- [x] 只报告实际运行的命令，不把建议命令写成已通过。
- [x] 不以截图或录屏代替浏览器、runtime 或性能命令。

### 10.4 阶段五验收

- [x] 用 docs-only diff 验证不会默认运行不必要的完整构建。
- [x] 用 frontend UI diff 验证映射到 focused tests 和 `npm run check`。
- [x] 用模拟 Rust/IPC diff 验证追加 `check:full` 与 runtime smoke。
- [x] 用 release 文档/脚本 diff 验证追加 release gate。
- [x] 没有 push 授权时试跑结果明确停在本地。
- [x] 运行 `npm run check:agent-skills`。

## 11. 阶段六：实现 `patina-prose-standard`

### 11.1 定义完整命题

每次修改 prose 前，枚举并保留相关事实：

- [x] actor 和 action。
- [x] 条件、时机与顺序。
- [x] `must`、`may`、`never` 等强度。
- [x] negative guarantee 与例外。
- [x] owner、side effect、failure mode 和 consequence。
- [x] 已发布兼容承诺和退出条件。

### 11.2 定义各表面的 prose 责任

- [x] Markdown：当前状态、清晰 owner、避免重复长期规则。
- [x] Public JSDoc：调用方可见的返回区别、失败、所有权、时序和副作用。
- [x] Internal comment：只解释非局部不变量、竞态顺序、安全和反直觉失败。
- [x] Tests：只解释为什么 fixture、入口或间接观察不可替代，不写测试过程导览。
- [x] Diagnostics：指出失败对象、违反规则和修正动作，不叙述内部执行过程。
- [x] UI/Rust visible strings：通过 locale owner 修改，并运行对应 i18n 与行为测试。

### 11.3 合并 `trim-cot-leakage` 原则

- [x] 删除或改写无法从当前仓库解析的“决策 3”“审查 B2”“上一轮计划”等引用。
- [x] 把“这个 PR 增加”“上一提交修改”改为当前机制。
- [x] 删除“评审认为”“为了回应 reviewer”等审查编排。
- [x] 删除显而易见的控制流复述和测试 walkthrough。
- [x] 将“暂时应该够用”改为真实限制，或建立明确 TODO/FIXME owner。
- [x] 保留可解析 Issue 引用、标准引用、当前 runtime old/new 状态和必要 suppression reason。
- [x] 不从 `docs/archive/` 抽取历史文字作为当前事实。

### 11.4 定义模式和权限

- [x] 要求显式 scope。
- [x] review/audit 模式只报告。
- [x] 用户明确要求写、修或 trim 时才修改。
- [x] 默认排除 `docs/archive/`；归档计划闭环移动是单独操作。
- [x] owner source 先改，生成物后更新。
- [x] 中文 `.md`、`.ts`、`.tsx` 和 `.rs` 保持 UTF-8，不通过 PowerShell 输出重写。

### 11.5 阶段六验收

- [x] 用一段保留完整契约的注释作为正向夹具。
- [x] 用代码复述、reviewer 辩解和死引用作为负向夹具。
- [x] 证明 skill 不把减少字数当唯一目标。
- [x] 证明 review 请求不自动编辑文件。
- [x] 运行 `npm run check:agent-skills`。

## 12. 阶段七：实现 `patina-doc-hygiene`

### 12.1 先分类再写作

- [x] 长期产品、架构、工程、UI、发布和协议事实进入现有顶层 owner 文档。
- [x] 一次性实施步骤进入 `docs/working/`。
- [x] 已完成执行单进入 `docs/archive/`。
- [x] 用户教程、reference、说明和执行计划不混成一篇无明确任务的文档。
- [x] 新文档先说明读者、目标、范围、非目标和完成状态。

### 12.2 建立 working execution plan 模板

- [x] 包含文档状态、owner、目标文件和非目标。
- [x] 包含第一性原理。
- [x] 包含逐阶段可勾选步骤。
- [x] 每阶段包含输入、动作、停机条件、验证和产物。
- [x] 包含风险、回滚、提交边界和完成定义。
- [x] 包含“完成后回写长期 owner 并归档”的关闭步骤。
- [x] 不包含要求把截图、GIF 或视频提交进仓库的证据栏；涉及 UI PR 时只声明仓库外静态截图要求。

### 12.3 文档事实和链接治理

- [x] 每项长期规则只有一个主要 owner。
- [x] 其他文档使用相对链接，不复制整段规则。
- [x] 不把 package scripts 的完整易漂移清单复制进多个文档。
- [x] 不把 archive 作为当前默认依据。
- [x] 文档移动时同一变更修复所有活动 inbound links。
- [x] 不通过 shell redirection、`Set-Content` 或 `Out-File` 重写 Markdown。

### 12.4 阶段七验收

- [x] 使用模板生成一个临时夹具并通过 skill gate，然后删除夹具。
- [x] 检查中英文和代码片段未出现 mojibake。
- [x] 检查相对链接可解析。
- [x] 检查执行单没有冒充长期事实 owner。
- [x] 运行 `npm run check:agent-skills` 和 `git diff --check`。

## 13. 阶段八：实现 `patina-quiet-pro-review`

### 13.1 定义审查起点

- [x] 先读 Quiet Pro 当前规范和相关 feature owner。
- [x] 先查 `src/shared/components/*`、`src/styles/tokens.css`、`src/styles/quiet-pro.css` 和真实消费者。
- [x] 判断是已有原型复用、feature-owned 组合，还是需要维护者确认的新稳定角色。
- [x] 不从截图外观反推组件实现。

### 13.2 定义 UI review 内容

- [x] 信息层级、密度、排版和对齐服务真实任务。
- [x] 使用现有 semantic token，不新增 page-local hardcoded 颜色、圆角、阴影或边框。
- [x] `default`、`hover`、`active`、`focus`、`disabled` 和相关 loading/empty/error 状态完整。
- [x] Dialog、Popover、Select 和复合输入满足焦点、键盘、Escape、portal 和 cleanup 契约。
- [x] 图标只辅助识别，Tooltip 不承担唯一可访问名称。
- [x] 新 shared component 有两个真实消费者或属于稳定全局原型。
- [x] app、feature、shared 和 platform owner 不因 UI 修改回流。

### 13.3 定义可重复验证与仓库外截图

- [x] 纯展示变化由结构测试、现有页面 smoke 和 style-debt gate 保护。
- [x] portal、global listener、键盘、焦点、复合输入和危险操作使用真实浏览器测试。
- [x] IPC/capability/desktop runtime 行为使用 Tauri runtime smoke。
- [x] 手工检查只记录页面、状态、预期、实际和限制。
- [x] 可见 UI PR 准备能够展示受影响状态的静态截图，并通过 GitHub `user-attachments` 或仓库外 HTTPS 附件提供。
- [x] 截图生成在 gitignored 或系统临时目录；上传完成后清理，不进入 Git diff。
- [x] 不要求 GIF 或视频，不创建 `record-browser-gif` 等录制 skill。
- [x] 上传工具不可用时明确报告缺少 PR 截图附件，不能通过提交图片到仓库绕过。

### 13.4 阶段八验收

- [x] 用一个现有 Dialog 或 Popover 做只读试跑。
- [x] 输出必须包含 owner、状态、可访问性和测试建议。
- [x] 输出必须提醒可见 UI PR 使用仓库外静态截图，并禁止把截图提交进仓库。
- [x] 运行 `npm run check:quiet-pro-style-debt`、命中的 UI test 和 `npm run check:agent-skills`。

## 14. 阶段九：审计现有项目级 skills

### 14.1 分类

对每个现有 skill 标记一个结果：

- [x] `project-owned`：Patina 专用、长期受仓库维护。
- [x] `pinned-general`：通用能力，但有明确 Patina 使用价值并经过冲突审查。
- [x] `user-scope-candidate`：更适合个人全局环境，不应影响所有 Patina 协作者。
- [x] `replace`：与 Patina 长期规则冲突，应由 Patina-owned skill 替代。
- [x] `remove-candidate`：无真实用途或存在不可接受冲突；删除前必须获得确认。

### 14.2 初始分类建议

以下只是实施起点，不是已经批准的删除或迁移决定。执行者必须结合实际内容、调用场景和触发评测逐项确认。

| 确认 | 当前 skill | 初始分类 | 推荐动作 |
| --- | --- | --- | --- |
| - [x] | `SQLite Database Expert` | `pinned-general` | 保留 SQLite/Tauri 安全能力；Patina 数据 owner、migration 和恢复规则优先。 |
| - [x] | `documentation-writer` | `pinned-general` | 只负责通用 Diátaxis 写作；文档归属、UTF-8 和生命周期交给 `patina-doc-hygiene`。 |
| - [x] | `find-skills` | `user-scope-candidate` | 外部能力发现和安装更适合个人环境，不应默认影响所有仓库协作者。 |
| - [x] | `frontend-design` | `replace` | 项目级触发由 `patina-quiet-pro-review` 接管；通用版本可移到个人环境。 |
| - [x] | `kill-ai-slop` | `replace` | 将仍适合 Patina 的反模式判断并入 Quiet Pro review，避免两个 UI skills 竞争。 |
| - [x] | `pua` | `user-scope-candidate` | 交互风格属于个人偏好，不作为共享工程基线。 |
| - [x] | `review-and-refactor` | `replace` | 由 `patina-code-review` 和 `patina-find-simplifications` 取代其宽泛职责。 |
| - [x] | `skill-creator` | `pinned-general` | 在建设期保留；先审计 Claude CLI、模型和评测工具假设，再决定 wrapper 或迁移。 |
| - [x] | `tauri-v2` | `pinned-general` | 保留通用 Tauri 能力；Patina architecture 和 platform owner 优先。 |
| - [x] | `vercel-react-best-practices` | `pinned-general` | 仅保留 React/Vite 适用部分，不把 Next.js 假设带入 Patina。 |
| - [x] | `webapp-testing` | `pinned-general` | 保留 DOM、console 和交互测试；截图仅临时生成或作为仓库外 PR 附件。 |

### 14.3 重点冲突审计

- [x] `frontend-design`：审查“必须承担视觉风险”是否冲突 Quiet Pro，并确保其截图建议只使用临时文件和仓库外 PR 附件。
- [x] `kill-ai-slop`：提取仍适合 Quiet Pro 的判断，不复制通用视觉偏好、修复权限或重复触发描述。
- [x] `review-and-refactor`：审查“保持文件完整、不拆分”是否冲突 owner-first 和 hotspot 收口。
- [x] `documentation-writer`：审查强制等待大纲确认是否适合高自主执行任务，以及是否复制 Patina 文档规则。
- [x] `webapp-testing`：保留 DOM、console 和交互测试能力；禁止把 screenshot 输出写进仓库或当作唯一验证。
- [x] `pua`：判断是否应保持个人级可选，而不是共享仓库协作基线。
- [x] `find-skills`：审查其安装行为、全局写入和外部来源选择是否属于项目任务授权。
- [x] `skill-creator`：审查 Claude/Cowork/CLI 专用步骤、subagent 假设和评测产物位置是否适用于当前 Codex 工作流。
- [x] `SQLite Database Expert`：审查名称、frontmatter、模型固定和当前 SQLite/Tauri owner 规则。
- [x] `tauri-v2`：审查通用架构建议是否会让 command、platform 或 `lib.rs` 重新变厚。
- [x] `vercel-react-best-practices`：排除 Next.js、服务端渲染和 Vercel 部署专用假设，保留适用于 React/Vite 的性能原则。

### 14.4 变更确认边界

- [x] 先交付完整分类表和推荐动作。
- [x] 删除、移动、重命名或大幅改写任何现有 skill 前取得维护者确认。
- [x] 不因新增 checker 立即批量改写第三方 skill。
- [x] 替换 skill 时先让 Patina-owned skill 通过门禁和触发试跑。
- [x] 确认没有调用方或文档仍依赖旧 skill 名称后再移除。
- [x] 更新初始分类时记录理由、替代者、停机条件和回退方式，不能只改一个标签。

## 15. 阶段十：建立外部 skills 更新生命周期

### 15.1 建立 Patina 接受注册表

新增 `.agents/skills-registry.json`。它不替代 `skills-lock.json`：lock 记录 Skills CLI 的安装来源和当前内容，registry 记录 Patina 是否接受该内容以及以后如何更新。建议每个项目级外部 skill 至少包含以下字段：

```json
{
  "lockKey": "webapp-testing",
  "directory": "webapp-testing",
  "classification": "pinned-general",
  "provenanceState": "legacy-hash-only",
  "acceptedRevision": null,
  "acceptedHash": "<skills-lock computedHash>",
  "updatePolicy": "tracked-review",
  "localMode": "pristine",
  "lastReviewed": "2026-08-30",
  "notes": "Patina owner documents remain authoritative."
}
```

- [x] `lockKey` 必须唯一对应 `skills-lock.json` 的一个条目。
- [x] `directory` 必须唯一对应 `.agents/skills/<directory>/SKILL.md`。
- [x] `classification` 只允许阶段九定义的五种结果。
- [x] `provenanceState` 只允许 `revision-pinned`、`legacy-hash-only` 或 `forked`。
- [x] `acceptedRevision` 使用完整 commit SHA；无法证明时保持 `null`，不得猜测；tag 只记录在 notes 等人类可读字段中。
- [x] `acceptedHash` 必须与已经评审通过的 lock `computedHash` 一致，用于阻止未经评审的直接覆盖。
- [x] `updatePolicy` 只允许 `tracked-review`、`frozen-replacement`、`user-scope` 或 `project-owned`。
- [x] `localMode` 只允许 `pristine`、`wrapper` 或 `forked`。
- [x] `lastReviewed` 记录最近一次人工接受或明确拒绝上游变化的日期。
- [x] registry 不存 token、账号、私有 URL 或本机绝对路径。
- [x] 在建立全部 11 个条目的接受基线后，扩展 `check:agent-skills`：离线验证 registry JSON、枚举、唯一性、lockKey、directory 和 acceptedHash 一致性。
- [x] registry 一致性门禁可以阻塞，但不对外部 `SKILL.md` 的文风、章节和人格做批量强制改写。
- [x] 为 registry 缺项、重复目录、未知枚举、lock 缺失和 acceptedHash 漂移增加 self-test fixtures。
- [x] `check:agent-skills` 继续保持无网络，不判断上游是否最新。

### 15.2 建立当前 11 个 skills 的可审计基线

- [x] 从 `skills-lock.json` 读取名称、source、sourceType、skillPath 和 computedHash，不靠目录名猜来源。
- [x] 使用 Skills CLI 相同的范围和算法计算当前内容哈希并与 lock 比较；算法无法确认时停止，不另造一个看似相同的哈希。
- [x] lock 与目录一致时，把当前哈希登记为首个 `acceptedHash`。
- [x] lock 与目录不一致时停止基线建立并报告 `local-divergence`，先查明本地修改，不得联网更新覆盖；它不是允许写入 registry 的 provenanceState。
- [x] 尝试从仓库历史、安装记录或上游历史重建准确 revision；只有证据唯一时才登记。
- [x] 不能重建的旧安装登记为 `legacy-hash-only`，继续以现有内容为接受基线。
- [x] 为 11 个 skills 填写阶段九分类、updatePolicy、localMode、lastReviewed 和简短理由。
- [x] 确认 registry、lock 和 `.agents/skills` 三方没有缺项、重名或孤儿目录。

### 15.3 实现只读上游更新检测

新增 `scripts/check-agent-skill-updates.ts`，只回答“上游是否可能变化”，不承担安装或接受。

- [x] 当前只支持 registry 中明确声明的 GitHub 来源；其他 sourceType 返回 `untracked`，不能猜下载方式。
- [x] 根据上游仓库实际默认分支或 registry 指定引用解析远端 revision，不硬编码 `main` 或 `master`。
- [x] 对 `revision-pinned` 条目比较 acceptedRevision 与远端 revision。
- [x] 对 `legacy-hash-only` 条目报告“可建立新基线”，不能声称当前内容对应哪个历史 commit。
- [x] 输出 `current`、`update-available`、`unknown` 或 `untracked`，并包含 skill、接受 revision、候选 revision 和原因。
- [x] 支持机器可读 JSON 输出，字段顺序和退出码保持稳定。
- [x] 网络失败、GitHub rate limit 或上游删除返回 `unknown`；不得把未知误报为最新。
- [x] 不在输出中打印 token、认证头、完整本机环境或私有路径。
- [x] 不调用 `npx skills update`，不修改 registry、lock、skill 目录或 Git index。
- [x] 不把联网检测接入普通 `npm run check`；它只作为显式维护命令运行。
- [x] self-test 使用本地 fixtures 模拟最新、有更新、未知、无 revision 和路径缺失，不依赖网络。

### 15.4 在隔离区准备单项候选更新

- [x] 一次只选择一个外部 skill，或一组无法独立评审的同源强关联 skills。
- [x] 开始前记录当前 directory、acceptedHash、acceptedRevision、分类和 Git 状态。
- [x] 使用系统临时目录创建唯一 staging root，不在仓库内创建更新缓存。
- [x] 删除临时目录前验证解析后的绝对路径位于本次 staging root；失败时停止，不执行递归删除。
- [x] 以候选完整 commit SHA 拉取上游，不直接评审移动中的默认分支；tag 只能帮助定位，最终仍解析并记录 commit SHA。
- [x] 根据 registry/lock 的 skillPath 提取完整 skill 目录，包括 `SKILL.md`、scripts、references、assets 和 license。
- [x] 如果 skillPath 不存在、大小写变化或出现多个候选，停止并报告上游结构变化。
- [x] staging 阶段不得改写 `.agents/skills`、`skills-lock.json`、registry 或 package scripts。
- [x] 不在 staging 中执行未经审查的上游脚本。

### 15.5 做供应链和 Patina 策略 diff

- [x] 分开审查 frontmatter、触发描述、正文指令、scripts、references、assets、license 和依赖变化。
- [x] 标出新增或扩大的文件写入、删除、shell、网络、浏览器、凭据、远端消息、Git 和发布行为。
- [x] 检查是否出现固定模型、Claude/Cowork/其他代理专用工具或当前环境不存在的命令。
- [x] 检查是否扩大触发范围，导致与 Patina-owned 或其他 pinned-general skill 竞争。
- [x] 检查是否复制或覆盖 `AGENTS.md`、architecture、engineering quality、Quiet Pro 和 release owner。
- [x] 检查是否要求把截图、GIF、视频、评测产物或临时文件提交进仓库。
- [x] 检查 scripts 的路径解析、临时目录清理、命令参数、依赖下载和破坏性操作。
- [x] 检查新 assets 是否属于 skill 运行必需资源；审查媒体证据仍不得进入仓库。
- [x] 对每项变化记录 `accept`、`adapt-with-wrapper`、`defer` 或 `reject` 及理由。
- [x] 任何无法解释的权限扩大、混淆脚本、来源漂移或许可证问题都触发停止。

### 15.6 以旧版为基线做对照评测

- [x] 保留当前已接受 skill 作为 old baseline，不先覆盖再尝试回忆差异。
- [x] 使用同一组现实任务分别运行 old 和 candidate。
- [x] 至少覆盖两个应触发场景、两个不应触发场景和一个与相邻 skill 竞争的场景。
- [x] 客观流程用可验证 assertions；写作、设计和判断质量保留人工评审。
- [x] 比较完成质量、错误工具假设、额外权限、触发准确性、执行时间和上下文开销。
- [x] candidate 不得因为更新而跳过 Patina sources of truth、授权停机条件或风险验证。
- [x] 评测产物写入系统临时或明确 gitignored 的 workspace，不把截图、视频或批量运行结果提交进仓库。
- [x] candidate 没有实质改善且增加复杂度时选择 `defer` 或 `reject`，不为追版本号而升级。

### 15.7 接受、延期或拒绝候选

- [x] 在修改项目级 skill 前向维护者报告来源、old revision/hash、candidate revision/hash、关键 diff、评测和推荐结论。
- [x] 只有维护者确认后才将候选内容应用到 `.agents/skills`。
- [x] 禁止在主工作区直接运行无 dry-run 的全量 `npx skills update -p -y`。
- [x] 如果 Skills CLI 能锁定并安装已评审的准确 revision，使用该机制并验证结果哈希。
- [x] 如果 CLI 只能追移动分支，停止直接 update；改用能保证 exact revision 的受控安装方案后再继续。
- [x] 应用后确认实际目录哈希与已评审 candidateHash 完全一致。
- [x] 更新 `skills-lock.json` 的来源和 computedHash，并验证没有无关 skill 被改写。
- [x] 更新 registry 的 acceptedRevision、acceptedHash、provenanceState、localMode、lastReviewed 和 notes。
- [x] `adapt-with-wrapper` 时保持外部目录 pristine，把 Patina 差异放入明确 wrapper/Patina-owned skill。
- [x] `defer` 或 `reject` 时保留当前接受基线，并记录候选 revision、原因和下次复查条件。
- [x] 每次接受更新只形成一个可独立回退的本地变更集；commit 和 push 仍需要当前任务授权。

### 15.8 验证和回退

- [x] 运行 registry/lock/directory 一致性检查。
- [x] 运行该 skill 的正向、负向、重叠触发评测和所有命中的 owner checks。
- [x] 搜索实际 diff，确认只有已批准 skill、lock、registry 和必要测试发生变化。
- [x] 确认没有未经批准的脚本执行、网络写入、Git index 修改或媒体入库。
- [x] 更新失败时保留当前接受版本，不把半更新目录作为新基线。
- [x] 已形成 focused commit 后通过正常 revert 回退，不使用 `git reset --hard` 或宽泛 restore。
- [x] 回退时同步恢复 skill 目录、lock 和 registry，避免三者分裂。
- [x] 回退后重新运行一致性检查和旧版触发 smoke。

### 15.9 更新节奏

- [x] 默认每月做一次只读上游检查；没有更新时不产生仓库改动。
- [x] 在依赖某个外部 skill 执行高风险任务前，额外检查该 skill 的已接受状态和已知上游变化。
- [x] 安全修复或当前功能阻塞可以单项加急，但不能跳过 exact revision、diff 和回退准备。
- [x] 普通上游更新可以批量发现，但必须逐项接受；不创建自动合并或自动 push 流程。
- [x] 联网检查失败时记录 `unknown` 并稍后重试，不阻塞离线开发，也不声称“全部最新”。
- [x] 是否创建定时自动化或 GitHub workflow 属于后续独立决策，本计划只实现可显式运行的只读命令。

## 16. 阶段十一：建立长期 owner 并修剪长期文档

### 16.1 先分类段落，不按文件大小删减

每个候选段落只允许进入以下一种处理结果：

- [x] `keep-fact`：产品、架构、设计、数据、协议、发布、贡献或验证契约，继续留在当前长期 owner。
- [x] `keep-explanation`：解释规则为什么存在、失败会造成什么影响，继续服务人类和不加载 skill 的协作者。
- [x] `move-workflow`：只描述 Agent 在特定任务中的执行顺序、停机条件或报告格式，迁入对应 skill。
- [x] `replace-with-link`：事实已由另一个长期 owner 完整承担，当前文档只保留简短边界和精确链接。
- [x] `keep-human-contract`：人类贡献者必须直接阅读的要求，保留在 `CONTRIBUTING.md`、模板或对应贡献文档。
- [x] `archive-temporary`：一次性计划或阶段结果已完成，长期事实回写后整体归档，不拆散成多个伪长期文件。
- [x] `remove-obsolete`：规则已被当前现实明确取代且没有历史兼容价值；删除前记录替代依据和消费者检查。
- [x] 不以行数、标题数量或与 skill 的表面相似度决定删除。

### 16.2 建立规则追踪矩阵

在修改任何长期文档前，为候选规则建立追踪矩阵，至少记录：

```text
rule-id
current-file-and-heading
current-statement
modal-strength
classification
canonical-owner
skill-consumers
human-consumers
planned-action
replacement-link
validation
```

- [x] `rule-id` 在本次收口中稳定，方便 review 前后逐项核对。
- [x] `modal-strength` 区分 `must`、`should`、`may` 和说明性事实；迁移不得降低强度。
- [x] `canonical-owner` 必须是活动长期文档、代码契约或机器门禁，不能指向 working 计划或 archive。
- [x] `skill-consumers` 可以有多个，但长期事实 owner 只能有一个。
- [x] `human-consumers` 非空时，不得只保留在 skill 中。
- [x] `planned-action` 为 `move-workflow` 时，先写入并验证目标 skill，再删除原执行步骤。
- [x] `replace-with-link` 必须链接到精确 owner 文档，不能用“参见相关文档”代替。
- [x] `validation` 说明如何证明语义、授权和失败边界没有丢失。

### 16.3 新建 `docs/agent-skills.md`

该文档是长期 reference 与 explanation，不是另一份实施清单。目标读者包括维护者、仓库协作者、加载项目 skills 的 Agent，以及需要判断某个 skill 是否应保留或升级的人。

- [x] 文档定位：说明它拥有什么、不拥有什么，以及与 `AGENTS.md`、`engineering-quality.md`、`skills-lock.json` 和 registry 的关系。
- [x] 基本模型：区分长期事实 owner、Patina-owned skill、外部 skill、wrapper、checker 和一次性评测产物。
- [x] Patina-owned 规范：名称、frontmatter、必需章节、资源边界、授权、停机条件、验证和报告要求。
- [x] 外部 skill 分类：长期保存阶段九的分类语义和确认边界，不复制本次 11 项临时处理进度。
- [x] 接受基线：定义 lock、registry、acceptedRevision、acceptedHash、legacy-hash-only、wrapper 和 local divergence。
- [x] 更新生命周期：长期保留“发现可自动、采纳需评审”、exact revision、隔离 diff、对照评测、接受和回退原则。
- [x] 评测与触发：定义正向、负向、重叠测试和旧版/candidate 基线，不固定某个外部模型或 Claude CLI。
- [x] 生命周期：定义创建、试运行、稳定、替换、移出项目级、退役和 archive 的条件。
- [x] 证据与媒体：只链接贡献和工程质量 owner，重申外部 PR 静态截图与仓库媒体禁入的边界，不复制全部条款。
- [x] 远端与破坏性动作：只链接 `AGENTS.md` 和版本发布 owner，不让 skill 文档产生额外授权。
- [x] 更新时机：说明哪些变化必须先更新本文，再更新 checker、registry schema 或 skills。
- [x] 不把六个首批 skill 的完整工作流复制进本文；各 skill 自己拥有情境化步骤。

### 16.4 把 prose 长期事实写入 `docs/engineering-quality.md`

当前 `patina-prose-standard` 所依赖的完整命题、JSDoc、注释和推理残留规则没有活动长期 owner。先在工程质量文档建立最小长期章节，再让 skill 引用。

- [x] 定义 prose 的目标：保留调用方、维护者和用户真正需要的契约，而不是追求字数少或字数多。
- [x] Public JSDoc 保留返回差异、失败、所有权、时序、副作用和兼容性等非显然契约。
- [x] Internal comment 解释约束、反直觉原因、平台限制和安全拒绝路径，不逐行复述代码。
- [x] 文档说明当前行为、输入输出、限制和操作，不保留会话推理、reviewer 辩解或临时建议。
- [x] 用户文案保持短、清楚、可行动，技术失败信息不伪装成产品解释。
- [x] 删除代码复述、过期引用、推理草稿和只为说服审查者存在的文字时，不得同时删掉真实契约。
- [x] 将 prose 质量纳入 code review 和文档 review，但不建立纯关键词阻塞门禁。
- [x] `patina-prose-standard` 链接该长期章节，只保存扫描、分类、修改和报告流程。

### 16.5 逐份长期文档处理建议

| 确认 | 文档 | 处理方向 |
| --- | --- | --- |
| - [x] | `docs/engineering-quality.md` | 增加 prose 长期质量 owner；保留质量维度、门禁和归档规则；Agent skill 细节最终移入被忽略的本地 skill。 |
| - [x] | `docs/issue-fix-boundary-guardrails.md` | 保留三种模式、owner 判断、停机信号和风险门槛；情境化 review/simplification 步骤下沉到 skills。 |
| - [x] | `docs/architecture.md` | 保留结构、owner、禁止事项、高吸力层和最低验证；缩短重复 Agent 执行附录，只保留领域独有约束。 |
| - [x] | `docs/quiet-pro-component-guidelines.md` | 保留视觉、token、组件、状态、可访问性和实现契约；UI review 顺序与报告格式由 Quiet Pro skill 承担。 |
| - [x] | `CONTRIBUTING.md` | 保留完整人类贡献契约、PR intake 和外部截图要求；只消除与长期 owner 明确重复且可链接的维护者内部流程。 |
| - [x] | `docs/product-principles-and-scope.md` | 默认不修剪；它保存产品事实、范围、非目标和功能准入理由。 |
| - [x] | `docs/roadmap-and-prioritization.md` | 默认不修剪 Project 协作流程；本地 skills 未提供等价 Project skill。 |
| - [x] | `docs/versioning-and-release-policy.md` | 默认不修剪发布流程、授权和跨仓契约；本轮没有 release skill。 |
| - [x] | `docs/localization.md` | 默认不修剪本地化贡献与验证步骤；本轮没有 translation/localization skill。 |
| - [x] | `docs/archive/*` | 不把旧 archive 作为迁移来源；本计划自身只记录经验证的执行历史。 |

### 16.6 安全迁移顺序和停机条件

- [x] 六个 Patina-owned skills 已通过结构门禁和正负触发评测后，才开始删除重复执行步骤。
- [x] `docs/agent-skills.md` 和 engineering quality prose 章节先创建并通过 review，再更新任何消费者链接。
- [x] 同一个原子变更中完成“新 owner 存在、skill 链接更新、旧重复删除”，不留下断链窗口。
- [x] 每次只处理一个 owner 主题；不把产品、架构、UI、发布和文档规则一次性机械重写。
- [x] 如果候选段落同时服务人类贡献者和 Agent，优先保留或重写为精确长期规则，不下沉成 skill-only 内容。
- [x] 如果 skill 与长期文档对同一规则的强度不同，停止删除，先确定 canonical owner 的正确语义。
- [x] 如果删除后无法在不加载 skill 的情况下回答“规则是什么、为什么存在、最低要求是什么”，停止并恢复该段。
- [x] 不从 mojibake 终端输出、archive 或旧执行单重建当前长期规则。

### 16.7 阶段十一验证

- [x] 追踪矩阵中的每个 rule-id 都有唯一 canonical owner 和至少一个验证结果。
- [x] 搜索六个 skills，确认事实段落通过链接引用长期 owner，而不是复制大段正文。
- [x] 搜索顶层长期文档，确认不再重复完整 Agent 执行序列或报告模板。
- [x] 逐个打开新增和修改的相对链接，确认不存在循环指向 working 方案或 archive。
- [x] 比较迁移前后的 `must`、`should`、`may` 和否定规则，确认强度未被稀释。
- [x] 确认人类不加载 skill 仍能从 `CONTRIBUTING.md` 和领域文档完成贡献与理解关键契约。
- [x] 确认产品、架构、Quiet Pro、路线图、发布和本地化事实没有迁入 `SKILL.md`。
- [x] 确认本轮新增或修改的 Markdown 为 UTF-8、无 BOM、无 mojibake 和尾随空格；未把历史 archive 的既有编码债务冒充本轮结果。
- [x] 运行 `npm run check:agent-skills`、命中的文档链接检查和 `git diff --check`。

## 17. 阶段十二：收敛 `AGENTS.md`

### 17.1 建立 `AGENTS.md` 路由矩阵

- [x] 为每段拟下沉内容记录当前位置、长期 owner、目标 skill 和保留的一行常驻规则。
- [x] Project 维护细节链接到路线图或未来 Project skill，不删除主动维护义务。
- [x] 外部 PR intake 细节链接到工程质量文档和 `patina-code-review`。
- [x] 验证选择细节链接到工程质量文档和 `patina-pre-push-checks`。
- [x] 文档工作流链接到工程质量文档和 `patina-doc-hygiene`。
- [x] UI review 细节链接到 Quiet Pro 文档和 `patina-quiet-pro-review`。
- [x] Agent skill 结构、外部依赖和更新生命周期链接到 `docs/agent-skills.md`，不保留完整流程副本。

### 17.2 必须继续常驻的规则

- [x] 产品范围和 Quiet Pro 基线。
- [x] owner-first 与高吸力层约束。
- [x] 不恢复退出层、不新增无 owner 公共桶。
- [x] 当前任务没有明确远端授权时不得 push。
- [x] Issue、Project、tag 和 Release 修改需要对应授权。
- [x] 中文与 Markdown UTF-8 规则。
- [x] archive 不作为当前事实。
- [x] 外部 PR 先过 intake gate。
- [x] “可见 UI PR 需要仓库外截图，但证据媒体不得提交进仓库”的简短常驻声明。

### 17.3 原子迁移

- [x] 目标 skill 和长期 owner 先存在并通过验证。
- [x] 同一变更中缩短 `AGENTS.md` 并加入精确链接。
- [x] 不留下两个长期 owner。
- [x] 对照追踪矩阵逐条确认没有规则丢失或改变强度。
- [x] 对 `must`、`may`、`never` 和授权边界做专门复读。
- [x] 确认缩短后的 `AGENTS.md` 仍能把任务准确路由到长期 owner 和对应 skill；加载失败时安全边界仍然成立。

## 18. 触发与重叠评估

### 18.1 `patina-find-simplifications`

- [x] 正向：“审计 tracking runtime 中有没有可以删除的重复生命周期状态。”
- [x] 正向：“找出没有生产消费者的兼容壳，但不要改代码。”
- [x] 负向：“修复设置页保存失败。”
- [x] 负向：“解释这个函数做什么。”

### 18.2 `patina-code-review`

- [x] 正向：“Review 当前 diff，重点看 owner 和数据风险。”
- [x] 正向：“检查外部 PR 是否通过 intake gate。”
- [x] 负向：“实现这个已确认功能。”
- [x] 负向：“准备发布 1.6.0。”

### 18.3 `patina-pre-push-checks`

- [x] 正向：“这些改动准备推到远端，先跑合适的检查。”
- [x] 正向：“我准备提交，验证到什么程度？”
- [x] 负向：“为什么这个测试失败？”
- [x] 负向：“Review PR 的架构。”

### 18.4 `patina-prose-standard`

- [x] 正向：“清理这些注释中的审查过程和代码复述。”
- [x] 正向：“Review 这段 JSDoc 是否保留完整失败契约。”
- [x] 负向：“新增俄语 locale。”
- [x] 负向：“重新组织 docs 目录。”

### 18.5 `patina-doc-hygiene`

- [x] 正向：“写一份一次性执行方案，完成后要归档。”
- [x] 正向：“判断这份文档应该留在顶层还是 archive。”
- [x] 负向：“只修一个 TypeScript 类型错误。”
- [x] 负向：“Review 一个 Rust command。”

### 18.6 `patina-quiet-pro-review`

- [x] 正向：“Review 这个 Dialog 的 Quiet Pro、焦点和键盘行为。”
- [x] 正向：“这个新控件应该进 shared 还是 feature？”
- [x] 负向：“优化 SQLite 查询。”
- [x] 负向：“给 PR 录一个演示 GIF。”Patina 只要求仓库外静态截图，该请求不路由到录制 skill。

### 18.7 重叠优先级

- [x] “寻找复杂度”优先 `patina-find-simplifications`，不自动进入 code review。
- [x] “Review diff/PR”优先 `patina-code-review`，其中调用 prose 或 Quiet Pro 规则。
- [x] “准备交付/push”优先 `patina-pre-push-checks`，不重新做完整语义 review。
- [x] “修改文档结构”优先 `patina-doc-hygiene`；句子级契约判断调用 prose standard。
- [x] “UI owner/交互审查”优先 `patina-quiet-pro-review`；外部 PR 总体准入仍由 code review 拥有。

## 19. 风险与缓解

### 19.1 规则丢失

- [x] 风险：缩短 `AGENTS.md` 时遗漏安全或授权边界。
- [x] 缓解：最后阶段才缩短；先建立追踪矩阵；逐条对照 modal 强度。

### 19.2 Skill 过度触发

- [x] 风险：通用描述导致每次任务加载多个重叠 skill。
- [x] 缓解：description 写正向和负向边界；执行正负触发用例；优先合并而不是增加新 skill。

### 19.3 Skill 复制长期事实

- [x] 风险：版本、命令、协议或 owner 在 skill 与 docs 同时维护。
- [x] 缓解：skill 链接 owner；checker 验证命令存在；review 阶段搜索重复规则。

### 19.4 自动门禁阻塞历史第三方 skills

- [x] 风险：现有 skill 名称和 frontmatter 不符合新标准。
- [x] 缓解：第一版只阻塞 `patina-*`；第三方 skill 单独分类并经确认迁移。

### 19.5 简化误伤兼容性

- [x] 风险：unused 调用分析看不到持久化、IPC、动态 loader 或外部客户端。
- [x] 缓解：生产/非生产/模糊消费者分类；协议和 durable 边界停机条件；完整字符串搜索。

### 19.6 仓库媒体禁入规则误伤产品截图能力

- [x] 风险：阻止审查媒体入库时误删产品截图采集、应用图标或安全测试。
- [x] 缓解：只拦截明确的 review/demo/evidence 媒体；保留外部 PR 截图要求、`screenshot-capture` 风险域和真实产品资产；禁止全仓库机械替换。

### 19.7 当前脏工作区冲突

- [x] 风险：实施改动与维护者正在进行的业务改动混合。
- [x] 缓解：每阶段检查 status/diff；只编辑明确文件；提交前按行为和 owner 分组。

### 19.8 外部 skill 供应链漂移

- [x] 风险：上游默认分支变化、来源转移、恶意或意外脚本、许可证变化和触发扩张未经审查进入仓库。
- [x] 缓解：接受 revision 与 hash 双重基线；隔离拉取完整目录；逐项供应链 diff；old/candidate 对照评测；人工确认后才应用。

### 19.9 自动更新覆盖本地适配

- [x] 风险：批量 update 覆盖 Patina 特有修改，或 lock、registry 与目录只更新其中一部分。
- [x] 缓解：外部目录保持 pristine；本地差异使用 wrapper；禁止无 dry-run 全量更新；三方一致性作为阻塞门禁；更新形成 focused 变更集。

### 19.10 网络状态造成错误结论

- [x] 风险：GitHub 不可用、rate limit、认证失败或上游删除被误判为“已是最新”。
- [x] 缓解：联网 checker 使用 `unknown` 状态；不接入离线 `npm run check`；失败时保留当前已接受基线并稍后重试。

### 19.11 长期文档过度修剪

- [x] 风险：为了让文档变短，把产品事实、失败原因、最低验证或人类贡献契约只留在 skill 中。
- [x] 缓解：段落先分类；human-consumers 检查；新 owner 先存在；按 modal strength 对照；没有非 skill 阅读路径时禁止删除。

### 19.12 新增 `agent-skills.md` 形成第二事实中心

- [x] 风险：Agent Skills 文档复制 architecture、Quiet Pro、release、贡献和授权正文，形成新的漂移源。
- [x] 缓解：只拥有 skill 结构、依赖和生命周期；领域事实使用精确链接；review 搜索重复段落和版本化事实。

### 19.13 文档与 skill 原子迁移失败

- [x] 风险：先删旧规则、后补 skill 或 owner，导致中间提交断链；或者只更新一侧导致语义强度不同。
- [x] 缓解：同一 focused 变更包含新 owner、消费者链接和旧重复删除；每个 rule-id 验证后才进入下一主题。

## 20. 推荐提交边界（已评估，未执行）

以下只是逻辑提交建议，不构成当前提交或 push 授权。本轮没有本地 commit 授权，因此本节勾选表示边界和文件归属已经复核，并不表示创建了提交。

### 20.1 提交一：外部 PR 截图政策与仓库媒体边界

- [x] `CONTRIBUTING.md`
- [x] `.github/pull_request_template.md`
- [x] `.github/ISSUE_TEMPLATE/bug_report.yml` 中与证据混淆的可选文字
- [x] `scripts/pr-intake-policy.ts`
- [x] `scripts/check-pr-intake.ts` 中模板要求
- [x] `tests/prIntakeGate.test.ts`

建议主题：`docs(contributing): keep PR screenshots outside repository history`

### 20.2 提交二：skill checker

- [x] `scripts/check-agent-skills.ts`
- [x] `package.json`
- [x] `package-lock.json`，不适用：脚本未新增依赖，`npm ci` 后锁文件也保持无差异

建议主题：`feat(quality): validate Patina-owned agent skills`

### 20.3 提交三至五：首批 skills

- [x] 将 review/verification skills 与 prose/docs skills 按 owner 分成可独立审查提交。
- [x] 每个提交通过 skill gate。
- [x] 不为了减少提交数制造超过仓库 review 门槛的大提交。

### 20.4 提交六：外部 skill 注册表与只读更新检测

- [x] `.agents/skills-registry.json`
- [x] `scripts/check-agent-skill-updates.ts`
- [x] 更新 checker self-test、package scripts 和必要 fixtures。
- [x] 不在该提交中升级任何外部 skill，保证治理机制可以独立审查。

建议主题：`feat(quality): track external agent skill updates`

### 20.5 提交七：长期 Agent Skills owner 与文档归位

- [x] `docs/agent-skills.md`
- [x] `docs/engineering-quality.md` 中的 prose 和 skill gate owner。
- [x] 经追踪矩阵确认的 `docs/issue-fix-boundary-guardrails.md`、`docs/architecture.md` 和 `docs/quiet-pro-component-guidelines.md` 去重复。
- [x] 只调整有明确 canonical owner 和 skill 消费者的段落；不顺手重写产品、路线图、发布、本地化或贡献契约。
- [x] 同一提交内保证新 owner、链接和旧重复删除闭合。

建议主题：`docs(agents): define durable skill governance`

### 20.6 提交八：经确认的现有 skills 收口

本轮只完成分类和冻结政策，没有删除、移动、升级、wrapper 或替换动作；以下条目勾选表示对应授权前提已验证并保持不执行。

- [x] 只有维护者确认具体分类动作后执行。
- [x] 每个接受的外部更新、wrapper、迁移或替换按可独立回退边界分组。
- [x] 同步更新 skill 目录、`skills-lock.json`、registry 和相应评测。
- [x] 不把互不相关的多个上游升级压进同一提交。
- [x] 不与产品功能改动混在同一提交。

### 20.7 提交九：`AGENTS.md` 收口

- [x] 在新 skills 已稳定、链接可解析、追踪矩阵完成后执行。
- [x] 确认外部 skill 分类和长期更新 owner 已存在。
- [x] 不与产品功能改动混在同一提交。

## 21. 最终验证

- [x] `npm run check:agent-skills:self-test`
- [x] `npm run check:agent-skills`
- [x] `npm run check:agent-skill-updates:self-test`
- [x] 显式联网条件可用时运行 `npm run check:agent-skill-updates`，记录 `current`、`update-available`、`unknown` 和 `untracked`；不把它当成离线质量门禁。
- [x] `npm run test:pr-intake`
- [x] `npm run check`
- [x] `git diff --check`
- [x] 搜索活动贡献规则，确认可见 UI PR 仍要求外部静态截图，并明确禁止证据媒体进入仓库。
- [x] 搜索 Patina-owned skills，确认不存在把媒体提交仓库或创建 assets branch 的工作流。
- [x] 确认产品截图能力、对应风险域和 Rust tests 未因协作政策调整被删除。
- [x] 确认 `docs/archive/` 未被重写。
- [x] 确认本轮新增或修改的 Markdown 为 UTF-8、无 BOM、无 mojibake；全仓扫描发现的既有 archive BOM 作为基线债务记录但不在本轮重写。
- [x] 确认每个相对链接和 npm script 可解析。
- [x] 确认 registry 覆盖全部项目级外部 skills，acceptedHash 与 lock computedHash 一致，且没有孤儿目录或未经评审漂移。
- [x] 确认更新检测不会修改 skill、lock、registry、Git index 或工作区其他文件。
- [x] 确认 `docs/agent-skills.md` 是 Agent skill 结构、外部依赖和生命周期的唯一长期 owner，且不复制领域事实正文。
- [x] 确认 `docs/engineering-quality.md` 已拥有 prose 长期质量规则，`patina-prose-standard` 只保留情境化工作流。
- [x] 确认追踪矩阵中所有被删除或链接化的段落都有 canonical owner、消费者和 modal strength 对照。
- [x] 确认不加载 skills 的人类或 Agent 仍能从 `CONTRIBUTING.md` 与领域文档理解完整贡献契约和最低要求。
- [x] 确认 `product-principles-and-scope.md`、roadmap、release、localization 和 archive 未被无对应 skill 的机械修剪波及。
- [x] 确认实际运行结果以文字报告；可见 UI 的审查截图只存在于 PR 外部附件。
- [x] 如实施范围未触及 Rust、架构或发布行为，不机械运行 `check:full`；如实际 diff 命中对应风险，则按长期文档追加验证。

## 22. 完成定义

只有全部满足下列条件，才可以把本执行方案标记完成：

- [x] 六个 Patina-owned skills 已创建并通过元数据、资源和触发评估。
- [x] skills 与长期文档之间形成清晰的一事实一 owner 关系。
- [x] `docs/agent-skills.md` 已建立并承接 Patina-owned、外部依赖、registry/lock、更新、评测和退役的长期规则。
- [x] `docs/engineering-quality.md` 已承接 prose 长期事实和 skill 质量门禁位置。
- [x] 每个 Patina-owned skill 都链接当前长期 owner，没有把产品、架构、Quiet Pro、发布或贡献契约复制为第二事实源。
- [x] 长期文档修剪已通过规则追踪矩阵证明语义、授权和 modal strength 未丢失；没有使用行数目标作为完成标准。
- [x] `CONTRIBUTING.md` 和领域文档仍对人类完整可用，关键规则不依赖 skill 才能被发现。
- [x] PR 模板、贡献文档、intake gate 和 tests 继续要求可见 UI 的仓库外静态截图。
- [x] UI 验收由 Quiet Pro、focused tests、browser/runtime gates、文字结果和外部静态截图共同承担，截图不作为唯一证据。
- [x] `record-browser-gif` 未被引入，未创建媒体 assets branch，仓库历史未新增审查截图、GIF 或视频。
- [x] 现有第三方 skills 已完成分类；任何删除或移动均已单独确认。
- [x] `.agents/skills-registry.json` 覆盖全部保留的项目级外部 skills，并明确 legacy、pinned、wrapper、replace 和 user-scope 状态。
- [x] registry、`skills-lock.json` 和本地 skill 目录通过一致性门禁。
- [x] 只读更新检测及其离线 self-test 已通过；联网未知不会被误报为最新。
- [x] 外部更新流程要求 exact revision、隔离 diff、供应链审查、old/candidate 对照评测、人工接受和可回退变更集。
- [x] 未引入自动批量 update、自动 merge 或自动 push。
- [x] `AGENTS.md` 的情境流程只在不丢失安全规则的前提下完成收口。
- [x] `npm run check` 和所有命中风险的附加验证通过。
- [x] 没有未经授权的 commit、push、tag、Release、Issue 或 Project 修改。
- [x] 长期规则变化已写回当前 owner 文档。
- [x] 本文的状态更新为已完成，并移动到 `docs/archive/patina-agent-skills-adoption-execution-plan.md`。

## 23. 实施结束报告模板

实施完成时，最终报告至少包含：

- [x] 新增、修改、保留、替换和延期的 skills。
- [x] 每个 skill 的触发范围与主要 owner。
- [x] 每个外部 skill 的来源、分类、accepted revision/hash、更新策略和最近评审状态。
- [x] 本轮发现、接受、延期或拒绝了哪些上游候选，以及对应 diff、评测与理由。
- [x] PR 外部截图要求、仓库媒体禁入规则及对应可重复验证。
- [x] 保留的产品截图能力和测试诊断边界。
- [x] `AGENTS.md` 下沉了哪些流程、保留了哪些常驻规则。
- [x] 新建或更新了哪些长期 owner，哪些段落被保留、链接化、下沉、删除或延期，以及对应 rule-id。
- [x] 哪些文档明确没有修剪，以及因为缺少对应 skill、人类契约或领域事实而保留的理由。
- [x] 实际运行的全部命令和结果。
- [x] 未解决、阻塞或需要维护者确认的事项。
- [x] 本地 commit 和远端 push 状态。
- [x] Project 状态建议；只有明确映射到现有 item 时才报告，不自行修改。

## 24. 实施完成记录

### 24.1 交付结果

- 新增六个 Patina-owned skills：`patina-find-simplifications`、`patina-code-review`、`patina-pre-push-checks`、`patina-prose-standard`、`patina-doc-hygiene`、`patina-quiet-pro-review`。每个 skill 都有最小 frontmatter、八个必需章节、情境化 reference/template 和至少四个正反向 eval。
- 中间阶段曾新增 `docs/agent-skills.md` 作为 skill 结构、外部依赖、registry/lock、只读更新检测、评测与退役的 owner；最终按第 24.7 节移入被忽略的本地 skill，`AGENTS.md` 只保留常驻安全边界和可选路由。
- 新增 `.agents/skills-registry.json`、`scripts/check-agent-skills.ts`、自测夹具模块和 `scripts/check-agent-skill-updates.ts`；离线 skill gate 接入唯一 `npm run check` 执行图，联网检测保持显式、只读且不进入普通门禁。
- 新增 `.agents/THIRD_PARTY_NOTICES.md`；registry 同时锁定 source/sourceType/skillPath、许可证据和 19 个脚本/active HTML 精确路径。加载外部 skill 不再被解释为执行其 helper、联网或写外部状态的授权。
- 更新 `CONTRIBUTING.md`、PR/Issue 模板、PR intake policy 与 33 个测试：可见 UI PR 仍必须提供静态截图，但只接受 GitHub `user-attachments` 或仓库外 HTTPS；审查截图、GIF 和视频不得进入分支、`main`、tag 或 assets branch。产品自身的截图采集能力、`screenshot-capture` 风险域和测试未被删除。
- `docs/engineering-quality.md` 现在拥有 prose、Public JSDoc、内部注释、诊断和 skill gate 的长期质量规则；`architecture.md`、`issue-fix-boundary-guardrails.md` 与 `quiet-pro-component-guidelines.md` 只删除了已由新 owner/路由承接的重复 Agent 提醒。
- 明确保留且未修剪 `product-principles-and-scope.md`、roadmap、release、localization、`CONTRIBUTING.md` 的人类契约正文和既有 archive 历史；未引入 `record-browser-gif`，未创建媒体 branch 或审查媒体文件。

### 24.2 Skill 试跑与重叠路由

- `patina-find-simplifications` 对 `scripts/pr-intake-policy.ts` 做了只读候选审查：拒绝把共享 policy 合并进 checker，因为 checker、tests 和 trusted-base 分离共同消费该 owner；拒绝删除 `screenshot-capture` 风险域，因为它保护产品能力而非 PR 媒体政策。没有为了“简化”改代码。
- `patina-code-review` 用 UI intake 的失败样例和外部附件成功样例验证了 scope、Quiet Pro、状态、键盘/焦点、可重复测试和仓库媒体禁入边界。
- `patina-pre-push-checks` 根据实际 diff 选择 focused gates 与完整 `npm run check`；本轮没有 push 授权，因此报告停在本地验证完成。
- `patina-prose-standard` 用其 positive/negative fixture 复核 modal strength、actor、例外、JSDoc/注释边界和无 chain-of-thought 残留。
- `patina-doc-hygiene` 以本计划为真实 working-plan 试跑，并由 checker 验证模板的 owner、验证矩阵、完成记录和 working/archive 生命周期。
- `patina-quiet-pro-review` 只读审查 `QuietAnchoredPopover` 与 `DestinationDetailRecords`：owner 位于 shared primitive、feature 只组合业务内容；portal、ARIA region、trigger `aria-expanded`/`aria-controls`、Escape、外部点击、滚动关闭、viewport clamp 和布局稳定性均有实现或真实浏览器覆盖，不需要产品代码修改。
- 重叠规则按任务目标选择单一主 skill：找复杂度→simplifications，review diff/PR→code review，准备交付→pre-push，文档生命周期→doc hygiene，句子契约→prose，可见 UI owner/交互→Quiet Pro。24 个 eval 覆盖正向、负向、邻接路由和高风险越权。

### 24.3 外部 skills 基线

完整 SHA-256、目录内容哈希、冲突说明和最近评审日期以 `.agents/skills-registry.json` 为准；本表给出可读摘要。全部接受 revision 均为 `null`，provenance 为 `legacy-hash-only`，没有把默认分支 HEAD 伪装成历史接受 revision。

许可证据见 `.agents/THIRD_PARTY_NOTICES.md`：5 个唯一上游由 GitHub 官方 LICENSE 元数据确认，Anthropic 的 3 个 snapshots 自带 Apache-2.0 文本；`pua` 与 `vercel-labs/agent-skills` 仅在 README 声明 MIT，登记为较弱的 `upstream-declared`，接受新 revision 或再分发刷新内容前必须复核。Registry 与 lock 还会对 source/sourceType/skillPath 做双向一致性检查，避免只替换下载源而沿用旧哈希。

| Skill / source | 分类 | acceptedHash 前 12 位 | 更新政策 | 本轮结论 |
|---|---|---:|---|---|
| SQLite Database Expert / `martinholovsky/claude-skills-generator` | pinned-general | `0e75baa1c315` | tracked-review | 保留；忽略固定 model/persona，Patina data owner 优先 |
| documentation-writer / `github/awesome-copilot` | pinned-general | `ee53d65b163c` | tracked-review | 保留；强制暂停不能覆盖已授权自治执行 |
| find-skills / `vercel-labs/skills` | user-scope-candidate | `b146008599c3` | user-scope | 延期到显式个人级决策 |
| frontend-design / `anthropics/skills` | replace | `4eabc6618376` | frozen-replacement | 由 Quiet Pro review 替代；未删除 |
| kill-ai-slop / `yetone/kill-ai-slop` | replace | `459c60c76a49` | frozen-replacement | 由 Quiet Pro baseline 替代；未删除 |
| pua / `tanweai/pua` | user-scope-candidate | `1768c3299140` | user-scope | 不作为项目工程基线 |
| review-and-refactor / `github/awesome-copilot` | replace | `9236d06a1500` | frozen-replacement | 由 code review + simplifications 替代；未删除 |
| skill-creator / `anthropics/skills` | pinned-general | `b122f4d1e91a` | tracked-review | 保留，适配当前 Codex 环境 |
| tauri-v2 / `nodnarbnitram/claude-code-extensions` | pinned-general | `377c61c46cf4` | tracked-review | 保留通用知识，Patina architecture 优先 |
| vercel-react-best-practices / `vercel-labs/agent-skills` | pinned-general | `ca7b0c0c6e5f` | tracked-review | 仅使用适合 Vite desktop 的 React 规则 |
| webapp-testing / `anthropics/skills` | pinned-general | `cf8e5916d474` | tracked-review | 保留 DOM/交互测试；截图仅临时或外部 |

本轮没有接受任何上游候选。只读 detector 对 11 个 legacy/frozen/user-scope 项返回 `untracked`，这表示需要专门迁移或评审，不能误报 `current`。一次探索性运行第三方 `npx skills check` 时发现它会执行刷新；四个目录被报告为 updated，但运行前后 lock 和本地内容哈希完全一致，没有形成语义 diff。此后长期规则明确禁止把该命令当作只读检测器，并改用仓库自有脚本。

### 24.4 验证与环境偏差

- 通过 `npm run check:agent-skills:self-test`、`npm run check:agent-skills`、`npm run check:agent-skill-updates:self-test`、`npm run check:agent-skill-updates -- --json`、`npm run test:pr-intake`、`npm run check:quiet-pro-style-debt`、`npm run test:shared-primitives` 和 `git diff --check`。
- 最终 `npm run check` 通过：静态/架构/IPC/hotspot/test-governance 门禁、覆盖率、27/27 mutation、103 个浏览器 UI smoke 场景、生产构建和 bundle budget 全部成功。
- UTF-8 严格扫描验证了本轮新增或修改的 Markdown 文件无 BOM、无非法 UTF-8 和常见 mojibake。全仓扫描另发现 10 个既有 `docs/archive/*` 文件带 BOM；它们不是本轮创建或修改的文件，按“archive 不重写”规则保留为历史基线债务，未把该事实隐去或误报为通过。
- 第一次完整门禁在浏览器启动前因本地 `@tailwindcss/oxide` 原生二进制不可读和沙箱 `spawn EPERM` 失败；按 lock 运行 `npm ci` 重建 314 个依赖（0 vulnerabilities），随后在允许启动浏览器进程的环境重跑成功。`package-lock.json` 无差异。
- `check:full` 未运行：实际 diff 不修改 Rust、产品架构、发布版本或协议行为；命中的 UI/贡献/脚本风险均已有 focused gate 和完整默认门禁。

### 24.5 权限、Project 与剩余状态

- 没有创建 commit、push、branch、tag、Release、PR，也没有修改 Issue 或 GitHub Project。只读检查未发现与本任务明确映射的现有 Project item，因此没有状态拖动建议。
- 没有删除、移动或升级现有第三方 skill；replace 与 user-scope 仅登记为未来需要维护者单独确认的分类。
- 没有未解决阻塞。已知供应链状态是 11 个历史安装缺少精确接受 revision；这不是当前门禁失败，后续按长期 owner 的月度只读巡检和单 skill 隔离接受流程处理。
- 本文所有勾选表示“已执行”或“已验证为不适用并保持边界”；特别是第 20 节不表示已创建提交，第 20.6 节不表示执行了外部 skill 迁移。归档后本文只保留为历史记录，不再作为未来执行依据。

### 24.6 对抗式审查结果

任务完成并首次归档后，按外部贡献者视角重新攻击门禁、供应链、触发路由和文档 owner，发现并修复以下问题：

1. **验证声明过宽**：初稿把“本轮 Markdown 合格”写成“全仓 Markdown 无 BOM”。全仓扫描证明 10 个旧 archive 文件已有 BOM；完成记录和复选项已改成准确的 changed/new scope，没有重写历史 archive。
2. **Checker 失败模式不够稳健**：畸形 registry entry、畸形 lock shape、非法百分号链接编码可能使 checker 抛异常而不是给规则化失败；中文媒体入库指令也可能绕过英文启发式。现已加入结构防御、反例和中英文媒体用例，并把 registry owner 拆到独立模块，两个文件都低于 hotspot 阈值。
3. **PR 媒体门禁存在逃逸边界**：初版允许任何 `src/features/*/assets` 媒体，且媒体扩展集合偏窄，`existing owner test` 的空泛文字也可冒充可重复验证。现已阻止 product asset 路径中带 review/evidence/before/after/demo/screenshot 等证据标记的媒体，覆盖常见静态图和视频格式，并要求真实命令、test 路径或具名 owner/browser/structural test。
4. **外部来源身份没有双锁**：只比较 lock hash 与 content hash 仍允许把 lock source 换成其他仓库。Registry 现在复制接受的 source/sourceType/skillPath，离线门禁要求三者与 lock 一致，并有 source-drift 反例。
5. **许可证与可执行载荷未进入机器治理**：11 个 snapshots 中只有 3 个目录自带许可证，另有 17 个脚本和 2 个 active HTML（合计 19 个可执行/主动载荷）。现已增加第三方许可索引、license status/evidence、精确载荷清单与目录重新枚举门禁；`AGENTS.md` 明确 skill 指令不能自动授权执行这些内容。
6. **更新 detector 反例不足**：初版覆盖四种输出状态，但没有逐项保护 frozen replacement、user-scope 和 forked 分支。Self-test 现已覆盖这些分支，并确保它们不会调用远端 resolver。

修复后没有剩余高、中、低优先级实现 finding。两个已知事实不是本轮缺陷：11 个 legacy snapshots 尚无历史 exact revision；10 个旧 archive 文件带 BOM。二者均已明确归属后续专门治理，且不会被误报为 current 或本轮验证通过。

### 24.7 本地化边界修正与最终归档状态

第一次完成与对抗式审查后，维护者进一步明确：`.agents/` 必须被忽略，`docs/agent-skills.md` 也应放入 skills，而不是作为仓库长期文档。该决定改变了交付载体，但不改变已经完成的 PR 媒体政策、长期 prose 规则或文档修剪目标。最终已执行：

- [x] 在 `.gitignore` 恢复 `.agents/` 与 `skills-lock.json`，并验证两者均为 ignored local state。
- [x] 保留六个已完成的 Patina skills 供当前工作区本地使用，不提交、不暂存，也不让协作者或 CI 依赖其存在。
- [x] 将 `docs/agent-skills.md` 的有效治理内容重构为第七个本地 skill：`patina-skill-governance`，包含独立 `SKILL.md`、governance reference 和四个正反向/重叠/越权 eval。
- [x] 删除仓库中的 `docs/agent-skills.md`，清除 `AGENTS.md` 与长期 docs 对该文件的链接；新 clone 不需要被忽略文件也能理解所有仓库规则。
- [x] 从 `package.json` 和默认 `npm run check` 执行图移除 Agent skill checker/update commands，并删除对应仓库脚本；CI 不再读取 `.agents/`、local registry 或 lock。
- [x] 将 `AGENTS.md` 路由改成明确的“本机存在时可用、缺失时直接遵循长期 owner”，并保留 skill 不得扩大联网、安装、文件系统、Git 或远程权限的常驻边界。
- [x] 将 `docs/engineering-quality.md` 收口为仓库拥有的 prose 质量规则；skill 的内容契约、分类、更新、评测和退役流程只在 `patina-skill-governance` 命中时加载。
- [x] 修复 `patina-doc-hygiene`、`patina-pre-push-checks` 和 validation map 中已失效的仓库 checker 命令。
- [x] 历史外部 skill 的来源、分类、哈希与许可审计保留在本归档记录和本机 ignored records 中，不再被描述为共享仓库接受基线。
- [x] 本轮没有删除现有本地第三方 skill，没有安装或接受上游更新，也没有引入图片、GIF 或视频证据文件。

最终 owner 分工是：人类与所有 clone 必须知道的规则由 `AGENTS.md`、`CONTRIBUTING.md` 和顶层长期 docs 拥有；只有 Agent Skill 维护任务需要的详细流程由本地 `patina-skill-governance` 拥有；本归档只保存决策与执行历史，不再作为当前执行依据。

### 24.8 最终状态对抗式审查

在 `.agents/` 本地化和治理文档移入 skill 后，再以“没有本机 skills 的新 clone”“恶意或陈旧的本地 skill”“只阅读归档的维护者”三个视角重新审查，发现并关闭以下问题：

1. **Ignored state 仍可能变成仓库依赖**：中间方案的 package scripts、默认 `npm run check`、长期文档链接和 checker 都依赖 `.agents/`。最终已全部移除；仓库只保留可选路由，明确缺少本地 skills 时直接执行当前长期 owner。
2. **本地 skill 仍引用已删除命令**：`patina-doc-hygiene`、`patina-pre-push-checks` 和 validation map 仍提到 `check:agent-skills`。现已改为本地结构/eval/UTF-8/link/ignored-state 验证，不再制造无法执行的命令。
3. **Skill 治理没有独立触发边界**：简单把原文塞进 doc hygiene 会混淆文档生命周期与供应链维护。现已建立独立 `patina-skill-governance`，把正向/负向触发、fresh-clone 边界、external exact-revision review、许可与 executable payload 检查、权限停止条件写入工作流和四个 eval。
4. **归档完成状态存在视觉假阴性**：两张状态表共有 21 个空复选框，虽然正文任务已完成，仍会让读者判断计划未收口。所有条目已按实际分类/处理结果勾选；最终扫描为零未勾选项。
5. **历史记录可能被误读为当前事实**：第 1 节至第 24.6 节记录了已撤销的“版本化 skills”阶段。文档状态区和第 24.7 节现已明确时间顺序、最终 owner 和 supersession 关系，并移除指向被忽略文件的仓库链接。
6. **具体本地路由仍泄漏到长期文档**：第一次本地化收口只给具体名称增加了“本机存在时”限定，却仍在 `AGENTS.md`、architecture、engineering quality、issue guardrails 和 Quiet Pro 文档枚举本地 skills。这使 ignored inventory 继续成为长期文档的软依赖。现已删除所有具体名称；`AGENTS.md` 只保留通用安全边界，发现、清单和路由完全由本地 metadata 拥有。

修复后的验证结果：7 个本地 Patina skills 均有完整必需章节、可解析 owner 链接和至少 4 个 eval，共 28 个；`.agents/` 与 `skills-lock.json` 均由 `.gitignore` 命中且不在 `git ls-files`；仓库非 archive 范围不存在具体本地 skill 名称、`docs/agent-skills.md`、skill checker、registry 或 lock 依赖；本轮 tracked/untracked 交付中没有图片、GIF 或视频；本轮变更 Markdown 严格 UTF-8、无 BOM；`npm run test:pr-intake` 与最终 `npm run check` 通过。

该阶段没有剩余高、中、低优先级 finding。当时保留的 11 个外部 snapshots、local registry/notice/lock 和 7 个 Patina skills 都只是当前机器上的 ignored state；随后执行的有序退场以第 24.9 节为最终状态，其存在、分类或历史哈希不被声称为仓库保证。

### 24.9 外部 skills 有序退场补正

维护者在最终目录检查中指出：前序执行只把若干外部 skills 标为 `replace` 或 `user-scope-candidate`，却没有完成实际退场。第 14.4 节的确认边界解释了当时没有移动目录的原因，但执行者应在报告完成前主动取得确认，而不应把分类本身误报为有序退场。

本次将维护者反馈视为对已分类候选的退场授权；维护者进一步明确退场后不得保留 archive payload，因此完成以下动作：

- [x] 重新扫描 7 个活跃 Patina skills，确认没有依赖七个退场候选；退场不会破坏 Patina 自有工作流。
- [x] 将 `frontend-design`、`kill-ai-slop` 和 `review-and-refactor` 作为已被 Patina 工作流替代的重复/冲突能力退场。
- [x] 将 `find-skills` 和 `pua` 作为不属于 Patina 活跃工程基线的 user-scope 能力退场；没有擅自写入用户全局 skill 目录。
- [x] 将 `documentation-writer` 的 Diátaxis 读者任务分类、拆分规则和自治边界迁入 `patina-doc-hygiene`，新增独立参考资料与 3 个评测后再退场外部快照。
- [x] 确认 Codex 系统级 `skill-creator` 已覆盖创建、更新、资源组织、初始化、元数据和验证；将同名、Claude/Cowork 导向的项目本地快照退场，避免触发和更新双轨。
- [x] 删除七个退场 snapshot 的 55 个 payload 文件，并删除原 retired README；`.agents/retired-skills/` 整个目录不再存在，共移除 56 个 ignored 本地文件，没有触及 Git 跟踪内容。
- [x] 将 `skills-lock.json` 从 11 个外部条目收口为 4 个活跃条目，退场项不再处于安装活跃状态。
- [x] 明确 lock 与 registry 的边界：`skills-lock.json` 只保存外部安装器消费的 active set 和 source/hash；registry 保存 Patina 本地评审信息与不可执行 tombstone，外部安装器不会读取 registry。
- [x] 将本地 registry 升级为 tombstone-aware version 3；全部 11 个历史记录仍保留，4 个标记 `active`，7 个标记 `retired`、`payloadState: removed`、`localMode: removed`、`updatePolicy: retired-no-refresh`，不再记录 `archivedPath`。
- [x] 将 `THIRD_PARTY_NOTICES.md` 收口为仅覆盖 4 个当前安装 payload；退场历史只留 registry tombstone，不保留失效许可链接或 retired notice 区。
- [x] 更新本地治理 workflow 和评测：退场必须同时删除 active payload、lock 与 active notice，只留 registry tombstone，并验证 `.agents/retired-skills/` 不存在；恢复被定义为重新下载并完整评审的新安装，而不是移动旧副本。

退场后活跃集合为：7 个 Patina-owned skills，以及仍有独立价值的 SQLite、Tauri、React 性能和浏览器交互测试 4 类外部能力。通用文档结构与 skill 创建能力分别由 Patina 自有工作流和 Codex 系统能力承担。具体本地名称、清单和 lifecycle 只存在 ignored metadata 与本归档历史中，不回流到当前长期文档。
