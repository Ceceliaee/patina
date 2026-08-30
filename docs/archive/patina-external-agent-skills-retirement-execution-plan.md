# Patina 外部 Agent Skills 有序退场执行方案

> Status: Complete  
> Created: 2026-08-30  
> Last updated: 2026-08-30  
> Execution owner: Codex（仅在用户明确授权执行后）  
> Long-term owners affected: [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture.md`](../architecture.md)、[`docs/engineering-quality.md`](../engineering-quality.md)、[`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)；这些 owner 本轮原则上不改动

## 0. 文档定位和使用方式

本文件是一次性活动执行单，当前位于 `docs/working/`。它可以记录当前工作区中的具体本地 Skill 名称，因为这些名称是本次退场任务的操作对象；它不是长期 Agent Skill 清单，也不得被 `AGENTS.md`、顶层长期文档、构建脚本或 CI 当作当前规则来源。

执行时遵循以下记录规则：

- 只有观察到对应证据后才能把 `[ ]` 改为 `[x]`。
- 不适用的项目必须写明原因，不能为了归档而直接勾选。
- 每个阶段结束后记录偏差、失败和恢复动作，再进入下一阶段。
- `.agents/` 内的本地变化保持 ignored，不提交到 Git。
- 本文件完成后移动到 `docs/archive/`；归档文件只保存历史，不再参与未来路由。
- 本计划不授权 commit、push、tag、release、Issue 或 Project 变更。

- [x] 文档生命周期已分类为活动 working execution plan。
- [x] 当前 `docs/working/` 在创建本文件前为空，不存在竞争执行单。
- [x] 具体 Skill 名称仅放在本地元数据和本次 working plan 中，没有回流到长期 owner。
- [x] 执行开始前，用户已经明确授权删除本计划列出的四个本地外部 Skill payload。

## 1. 决策和第一性原理

### 1.1 要解决的根问题

Skill 的价值不是“目录里有更多知识”，而是让 Codex 在一类重复任务上作出比默认能力更稳定、更符合当前仓库契约的决定。一个 Skill 只有同时满足以下条件才值得保持活跃：

1. 它解决稳定、可重复、边界清楚的任务。
2. 它提供当前模型和仓库 owner 之外的净增量。
3. 它不会与产品、架构、安全、权限或验证 owner 冲突。
4. 它的 `description` 能把正确任务吸引进来，并把相邻任务排除出去。
5. 它的来源、许可、可执行 payload 和更新路径可审查。
6. 移除它以后，仓库仍然完整、可理解、可验证。

规划时四个外部 Skill 至少违反其中一项，而且当时 registry 中的备注不会在 Skill 触发后自动注入或改写其正文。Codex 会先根据名称和 `description` 选择 Skill，再加载完整 `SKILL.md`；默认允许隐式触发。因此，已知冲突不能只留在旁路元数据中等待模型自行规避。参见 [OpenAI 官方 Skills 文档](https://learn.chatgpt.com/docs/build-skills)。

### 1.2 本次决策

本次采用永久有序退场，不采用长期禁用、显式调用隔离或继续维护 pristine 外部快照：

- 退场四个活跃外部 Skill payload。
- 不创建 `.agents/retired-skills/`，不在 `.agents/skills/` 保留副本。
- 退场后不保留 registry tombstone、`lifecycle: retired` 或 `payloadState: removed` 记录。
- 活跃外部集合归零后，删除不再有消费者的 `.agents/skills-registry.json`、`skills-lock.json` 和 `.agents/THIRD_PARTY_NOTICES.md`。
- 保留七个 Patina 自有 Skill；七不是目标数量，而是当前经边界审查后的结果。
- 不立即创建 SQLite、Tauri、React 或 Playwright 替代 Skill。
- 未来只有真实任务反复暴露稳定能力缺口，且现有 Skill 无法自然扩展时，才单独评审新 Skill。

### 1.3 必须保持不变的契约

- Patina 的长期事实继续由 `AGENTS.md` 和顶层 `docs/` owner 持有。
- 当前 Rust owner 结构仍为 `lib.rs + app / commands / platform / engine / data / domain`，`lib.rs` 与 `commands/*` 保持薄。
- 当前 SQLite 实现继续以实际代码和 `sqlx` / `tauri-plugin-sql` 依赖为准。
- React 工作继续以当前 React 19 + Vite 工程和仓库规则为准，不自动引入 Next.js、RSC、SSR 或 Vercel 部署假设。
- UI 验证继续要求可重复行为证据；PR 可见 UI 截图只能使用仓库外附件。
- 仓库内不新增 Skill 截图、GIF、视频、浏览器录屏、benchmark viewer 或 eval artifact。
- 缺少 `.agents/` 的 fresh clone 仍能理解并验证仓库。
- Skill 文本不授予安装、网络、文件删除、Git 或远端写入权限。

- [x] 期望结果可以通过“活跃目录、三个 active metadata 文件是否存在、重启后的 Skill 目录和行为 smoke”观察。
- [x] 必须保持的产品、架构、验证和权限契约已明确。
- [x] 真实 owner 在文件操作之前确定。
- [x] 执行结束后逐项复核上述契约没有变化。

## 2. 当前证据基线

### 2.1 当前本地结构

规划时核对到：

- `.agents/skills/` 下有 11 个活跃目录：7 个 Patina 自有 Skill，4 个外部 Skill。
- `.agents/skills-registry.json` 有 11 条外部历史记录：4 条 `active`，7 条 `retired` tombstone。
- `skills-lock.json` 只包含这 4 个活跃外部条目。
- `.agents/THIRD_PARTY_NOTICES.md` 只包含这 4 个活跃外部许可行。
- `.agents/retired-skills/` 不存在。
- `.agents/` 与 `skills-lock.json` 被 `.gitignore` 命中且没有被 Git 跟踪。
- `.agents/` 中没有图片、GIF、视频或 PDF。
- 7 个 Patina 自有 Skill 共有 65 个 eval case；规划时结构均可解析。
- 4 个外部 Skill 全部是 `legacy-hash-only`，`acceptedRevision` 为 `null`。

规划时的外部 payload 快照如下；执行前必须重新统计，不能把本表当作删除后的证明：

| Directory | Files | Bytes | Executable or active payload | Registry state |
|---|---:|---:|---|---|
| `sqlite-database-expert` | 3 | 46,478 | 无登记脚本 | active, legacy-hash-only |
| `tauri-v2` | 8 | 65,294 | 无登记脚本 | active, legacy-hash-only |
| `vercel-react-best-practices` | 76 | 230,383 | 无登记脚本；包含大型规则集和汇编文档 | active, legacy-hash-only |
| `webapp-testing` | 6 | 22,406 | 1 个 helper、3 个可运行示例 | active, legacy-hash-only |
| **合计** | **93** | **364,561** | **4 个登记可执行文件** | **4 active** |

### 2.2 逐项退场依据

| 外部 Skill | 已验证问题 | 为什么不能只靠 registry 备注 | 退场后的真实替代路径 |
|---|---|---|---|
| `sqlite-database-expert` | Frontmatter 含当前系统校验器不支持的字段；固定 Claude model/persona；正文以 `rusqlite`、`sea-query`、`r2d2` 为核心，而 Patina 使用 `sqlx` 与 `tauri-plugin-sql`；触发边界宽且没有 Patina eval | registry 不参与 Skill 正文加载，无法阻止错误依赖和迁移模式进入建议 | [`architecture.md`](../architecture.md)、[`engineering-quality.md`](../engineering-quality.md)、`src-tauri/Cargo.toml`、`src-tauri/src/data/*` 和当前代码测试 |
| `tauri-v2` | Frontmatter 含不受支持的 `version`；正文多次要求所有应用逻辑进入 `lib.rs`，直接违反 Patina thin-entry owner；包含大量通用初始化、安装、移动端和发布建议 | “以 Patina 为准”的 notes 不是运行时约束，宽泛 Tauri 任务仍可能加载冲突正文 | [`AGENTS.md`](../../AGENTS.md)、[`architecture.md`](../architecture.md)、实际 `src-tauri` owner；需要当前 API 事实时再查官方 Tauri 文档 |
| `vercel-react-best-practices` | 约 230 KB；description 会吸引大量普通 React 任务；大量 Next.js、RSC、SSR、Server Action、`next/dynamic` 内容不适用于 React 19 + Vite；汇编文档有 3 个失效相对链接 | registry 的 “Next.js 不适用” notes 不会裁剪已加载内容，也不能避免过宽隐式触发 | 当前 `package.json`、React/Vite 源码、focused performance evidence 和 [`engineering-quality.md`](../engineering-quality.md) |
| `webapp-testing` | 指示把外部 helper 当黑盒直接运行，违反“执行前检查准确文件”；使用 `shell=True`；Windows 子进程清理不可靠；示例硬编码 Linux 输出路径、固定 sleep 和截图流程；当前能力与 Patina UI/browser 工作流重叠 | notes 只限制媒体落库，不能修复脚本安全、平台和稳定性问题 | `patina-quiet-pro-review`、仓库现有浏览器测试、当前可用浏览器工具；任何 helper 仍须先审查源码 |

### 2.3 已知评测和元数据债务

- `patina-skill-governance/evals/evals.json` 的第 1 个 case 仍假设“现有 SQLite Skill”存在；四个外部 Skill 退场后该前提会失效。
- `webapp-testing` 的许可证据来自将随 payload 删除的本地 `LICENSE.txt`；未来候选必须重新核对许可，不能依赖失效路径。
- 外部 Skill 没有可证明的历史 commit SHA，最终删除后不能精确恢复同一字节快照。
- registry、lock 与 notice 在 active set 为空时都没有保留价值。

- [x] 当前目录、registry、lock、notices、可执行 payload 和 Git ignored 边界已检查。
- [x] 当前技术栈和 Rust owner 冲突已从活动 owner 与代码配置核对。
- [x] 现有 eval 的失效前提已识别。
- [x] 本任务不对应必须维护的 live GitHub Project/Issue 项；未创建或修改远端项目状态。
- [x] 执行开始时重新生成当前文件数、字节数和 registry/lock/notices active set，记录与本基线的差异。

## 3. 范围

### 3.1 In scope

- 为四个外部 payload 建立短期、仓库外、可验证的 rollback staging。
- 删除全部退场 registry records；active external 归零后删除 `.agents/skills-registry.json`。
- 删除四个外部目录及全部 payload。
- 删除 `skills-lock.json`。
- 删除 `.agents/THIRD_PARTY_NOTICES.md`。
- 修正 `patina-skill-governance` 中假设外部 SQLite Skill 存在的 eval。
- 运行本地结构、链接、编码、路由、权限和行为 smoke。
- 重启或刷新 Codex Skill catalog，确认四个外部路由消失。
- 完成单代理对抗式审查；只有用户另行明确授权时才使用 subagent。
- 完成后归档本执行单。

### 3.2 Out of scope

- 不创建 SQLite、Tauri、React、Vite、Playwright 或 browser 替代 Skill。
- 不修改 Patina 产品代码、依赖、数据库 schema、migration、Tauri capability 或 UI。
- 不修改用户级 `~/.codex/config.toml`。
- 不给退场 Skill 增加 `allow_implicit_invocation: false` 作为长期替代方案。
- 不下载上游新版本，不尝试把当前默认分支伪装成历史 accepted revision。
- 不保留 `.agents/retired-skills/`、压缩包或长期外部 payload 备份。
- 不把 registry、lock、notices 或 eval 变成 package script、CI 或 release 输入。
- 不添加仓库截图、GIF、视频、录屏或 evidence-media 目录。
- 不 commit、push、tag、release 或修改 Issue/Project。

- [x] 每个拟操作文件都服务于已确认的退场问题。
- [x] 相邻技术栈重写和新 Skill 创建已明确排除。
- [x] 本方案不隐含任何 Git 或远端写入权限。
- [x] 执行期间发现范围外问题时，记录到偏差表而不是顺手扩大任务。

## 4. 目标状态、owner 和不变量

### 4.1 目标目录状态

完成后的本地结构应为：

```text
.agents/
  skills/
    patina-code-review/
    patina-doc-hygiene/
    patina-find-simplifications/
    patina-pre-push-checks/
    patina-prose-standard/
    patina-quiet-pro-review/
    patina-skill-governance/
```

以下路径必须不存在：

```text
.agents/skills/sqlite-database-expert/
.agents/skills/tauri-v2/
.agents/skills/vercel-react-best-practices/
.agents/skills/webapp-testing/
.agents/retired-skills/
.agents/skills-registry.json
.agents/THIRD_PARTY_NOTICES.md
skills-lock.json
```

### 4.2 结果—owner—不变量矩阵

| 结果 | Owner | 不变量 | 证明 |
|---|---|---|---|
| 只保留 Patina 自有本地工作流 | `.agents/skills/patina-*` | 本地 Skill 只增加任务工作流，不成为仓库事实唯一 owner | 目录 inventory、Skill links、fresh-clone 边界 |
| 不保留退场历史状态 | active metadata 生命周期 | registry、lock 和 notices 只服务当前 active external；active set 为零时三个文件都不存在 | `Test-Path` 与 payload inventory |
| 不再有外部 installer active set | `skills-lock.json` 的生命周期 | active external 为零时 lock 文件不存在 | `Test-Path` 与外部目录 inventory |
| 不再有活跃第三方 payload 许可索引 | `.agents/THIRD_PARTY_NOTICES.md` 的生命周期 | notices 只服务当前安装的第三方 payload；零 active 时文件不存在 | `Test-Path` 与外部目录 inventory |
| 技术任务回到真实 owner | `AGENTS.md`、顶层 docs、代码和测试 | 不再加载已知冲突外部方法；没有新增替代 Skill | 行为 smoke 与 long-lived doc scan |
| 退场不污染仓库 | `.gitignore`、Git index | `.agents/` 和 lock 仍 ignored/untracked；没有媒体或 eval artifact | `git check-ignore`、`git ls-files`、media scan |

## 5. 执行阶段

### Phase 0 — 授权、工作区和删除目标冻结

目的：在任何 destructive action 前确认权限、目标、当前状态和恢复边界。

- [x] 记录用户对“四个明确目录和相关 metadata 文件”的当前任务删除授权。
- [x] 运行 `git status --short`，记录已有 tracked/untracked 修改；不得覆盖或混入无关用户修改。
- [x] 运行 `git status --short --ignored -- .agents skills-lock.json`，确认本地 Agent state 显示为 ignored。
- [x] 运行 `git ls-files -- .agents skills-lock.json`，确认无输出。
- [x] 运行 `git check-ignore -v .agents/skills/patina-skill-governance/SKILL.md skills-lock.json`，确认两条路径均命中 `.gitignore`。
- [x] 解析 `.agents/skills-registry.json` 和 `skills-lock.json`，确认 active external set 都是且仅是四个目标。
- [x] 枚举 `.agents/skills/`，确认除 7 个 `patina-*` 目录外只存在四个目标目录。
- [x] 确认 `.agents/retired-skills/` 不存在。
- [x] 重新统计每个目标目录的文件数、字节数、文件列表和 executable/active payload。
- [x] 将重新统计结果与第 2.1 节比较；任何新增、缺失或本地修改必须先解释。
- [x] 如果出现未知脚本、二进制、hook、HTML、安装命令或网络行为，暂停执行并重新评审。

建议用同一个 PowerShell 进程解析目标，避免跨 shell 拼接 destructive path：

```powershell
$workspaceRoot = (Resolve-Path -LiteralPath '.').Path
$skillsRoot = (Resolve-Path -LiteralPath '.agents\skills').Path
$retirementTargetNames = @(
  'sqlite-database-expert',
  'tauri-v2',
  'vercel-react-best-practices',
  'webapp-testing'
)
$expectedSkillsPrefix = $skillsRoot.TrimEnd('\') + '\'
$resolvedRetirementTargets = foreach ($targetName in $retirementTargetNames) {
  $candidate = Join-Path $skillsRoot $targetName
  $resolved = (Resolve-Path -LiteralPath $candidate).Path
  if (-not $resolved.StartsWith($expectedSkillsPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Retirement target escaped skills root: $resolved"
  }
  if ((Split-Path -Leaf $resolved) -ne $targetName) {
    throw "Retirement target leaf mismatch: $resolved"
  }
  $resolved
}
$resolvedRetirementTargets
```

通过条件：输出恰好是四个预期绝对路径，全部位于当前 workspace 的 `.agents\skills\` 之下。

停止条件：没有明确删除授权、路径不匹配、目标是 symlink/reparse point、出现第五个外部 active 目录、registry/lock/notices 不一致或当前 payload 与记录无法解释。

### Phase 1 — 建立短期仓库外 rollback staging

目的：删除发生在 ignored 文件中，Git 无法恢复；在最终验收前保留一次短期可恢复副本，但不建立长期 retired payload。

- [x] 使用系统临时目录创建带随机 ID 的独立 staging 根目录。
- [x] 验证 staging 的解析绝对路径位于系统临时目录内，而不是 workspace、用户文档目录或 `.agents/`。
- [x] 将四个目标目录逐个复制到 staging；不执行其中任何文件。
- [x] 比较源和 staging 的文件数量与逐文件 SHA-256，确认完全一致。
- [x] 把 staging 绝对路径和核对结果记录在本次执行记录中，不写入长期文档或 registry。
- [x] 确认 staging 中没有新增截图、GIF、视频或录屏。
- [x] 在最终验收前不得删除 staging。
- [x] 最终验收后必须删除整个 staging；删除前再次验证其绝对路径仍位于系统临时目录，且 leaf 含本次随机 ID。

建议创建方式：

```powershell
$systemTempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
$rollbackLeaf = 'patina-skill-retirement-' + [guid]::NewGuid().ToString('N')
$rollbackRoot = Join-Path $systemTempRoot $rollbackLeaf
[void](New-Item -ItemType Directory -Path $rollbackRoot)
$resolvedRollbackRoot = (Resolve-Path -LiteralPath $rollbackRoot).Path
$expectedTempPrefix = $systemTempRoot + '\'
if (-not $resolvedRollbackRoot.StartsWith($expectedTempPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw "Rollback root escaped system temp: $resolvedRollbackRoot"
}
```

恢复规则：

- Phase 3 删除后、最终验收前，如果 catalog 或行为 smoke 出现不可接受问题，可以从 staging 恢复 payload，并按 Phase 0 捕获的 active metadata 重新建立 registry/lock/notices。
- 最终验收并删除 staging 后，恢复不再是文件移动；必须按新的外部 Skill 接纳流程重新下载、固定 revision、复核许可/payload/冲突并获得明确批准。
- 因四个记录都没有历史 accepted revision，最终验收后不能声称可精确重建旧字节快照。

### Phase 2 — 冻结退场决定并移除 registry records

目的：在删除 payload 前保留本次任务所需的临时恢复证据，但不建立持久 tombstone。

- [x] 执行开始时解析 registry，确认 4 条 active 和 7 条既有 retired records 的来源、hash、许可与 executable metadata 可用于本轮核对。
- [x] 在 working plan 和短期 staging 中记录本次实际目标、文件数、字节数、退场原因、替代路径与恢复限制。
- [x] 不把 staging 路径、payload 副本或 retired metadata 写入长期 active docs。
- [x] 用户进一步明确要求不保留 `lifecycle: retired`、`payloadState: removed` 或等价 tombstone。
- [x] 删除所有已退场 registry records；active external set 归零后删除 `.agents/skills-registry.json` 本身。
- [x] 不创建空 registry，不把删除记录移动到第二个历史 JSON，也不创建 `.agents/retired-skills/`。

四个退场决定仍由本执行单保存为历史结果，但不作为未来自动恢复输入。未来恢复必须重新定位来源、固定候选 revision、检查许可和 executable payload，并重新获得明确授权。

中断恢复：若 payload 已删除而最终验证失败，只能在短期 staging 尚在时恢复 payload 并按 Phase 0 captured active state 重建 metadata；staging 删除后不再承诺恢复旧快照。

### Phase 3 — 删除四个外部 payload

目的：让已知冲突内容退出 Codex 的目录发现和隐式路由。

- [x] 确认 Phase 1 staging 完整，且 Phase 2 的退场目标与 metadata 删除边界已经冻结。
- [x] 再次输出四个 `$resolvedRetirementTargets`，逐项人工核对 leaf。
- [x] 检查每个目标是否为 reparse point/symlink；如是则停止，不递归删除。
- [x] 在同一个已验证 PowerShell 进程中，使用 `Remove-Item -LiteralPath <resolved> -Recurse -Force` 逐个删除四个目标。
- [x] 每删除一个目录后立即运行 `Test-Path -LiteralPath`，确认返回 `False`。
- [x] 枚举 `.agents/skills/`，确认只剩 7 个 `patina-*` 目录。
- [x] 确认没有空外部目录、隐藏副本、`.bak`、`.disabled`、zip 或重命名 payload。
- [x] 确认 `.agents/retired-skills/` 仍不存在。

禁止做法：

- 不使用 `rm -rf`、通配符或未解析环境变量。
- 不对 `.agents/skills/` 根目录执行递归删除。
- 不跨 shell 生成目标列表后交给另一个 shell 删除。
- 不把目标移动到 `.agents/retired-skills/`。
- 不把目标改名为 `*.disabled` 继续留在扫描目录。

### Phase 4 — 收口 lock、notice 和治理 eval

目的：删除所有已退场内容的 active 路由和安装/许可索引，同时修复 retained governance 的旧前提。

- [x] 删除根目录 `skills-lock.json`，因为 active external set 已经为空。
- [x] 删除 `.agents/THIRD_PARTY_NOTICES.md`，因为当前不再安装第三方 payload。
- [x] 删除 `.agents/skills-registry.json`，因为不再有 active external，且用户明确拒绝 retired records 和 tombstone。
- [x] 保留 `.gitignore` 中 `.agents/` 和 `skills-lock.json` 两条规则，防止未来本地状态误入 Git。
- [x] 更新 `patina-skill-governance/evals/evals.json` 第 1 个 case，移除“现有 SQLite Skill”前提。
- [x] 新 prompt 要求在创建数据库 migration Skill 前先检查当前仓库 owner 和现有工作流能否承接。
- [x] 新期望明确：数据库事实留在 architecture/data owner；只有独立、重复且边界稳定的 Agent workflow 才允许新建 Skill。
- [x] 保持该 eval 的 owner、权限和 ignored-state hard expectations，不把退场变成“以后禁止任何外部 Skill”。
- [x] 更新 governance retirement case 和 reference：退场时从 active directory、registry、lock、notices 全部移除；active external 为零时三个 metadata 文件都删除。
- [x] 检查其他 64 个 eval，没有对四个已删除 active payload 的隐含依赖。
- [x] 解析全部 7 个 `evals/evals.json`，确认 ID 唯一、字段完整、至少保留正向、负向、重叠和越权覆盖。
- [x] 使用当前系统 `skill-creator` 的结构校验器验证 7 个 retained Skill；Windows 上显式使用 UTF-8 模式，避免默认 GBK 造成假失败。

中断恢复：如果 payload 已删除但 lock/notices 仍存在，系统处于 stale active metadata 状态；不得结束任务，必须完成本阶段或从 staging 全量恢复 Phase 0。

### Phase 5 — Catalog 刷新和行为 smoke

目的：证明删除改变了实际可选路由，而不只是文件系统形状。

- [x] 当前任务上下文无法热重载宿主选择器；workspace 发现目录已确认只剩 7 个 retained Skill，下一次任务或宿主重启后的选择器刷新作为低风险观察项。
- [x] 当前 workspace Skills 目录确认四个外部名称和 payload 均不存在；本任务启动时固定的宿主 prompt 快照可能保留旧 description，但已经没有正文目录可加载。
- [x] 确认 7 个 Patina 自有 Skill 仍可发现。
- [x] 不使用截图或录屏作为 catalog 证据；记录文本 inventory 即可。
- [x] 执行下面四个代表性 smoke prompt，记录实际 owner、工具和建议；不要只检查是否出现某个短语。

#### Smoke A — SQLite migration

请求示例：

> 为 Patina 设计一个 SQLite migration，补充缺失列并保护旧安装数据。

必须观察到：

- [x] 从 `AGENTS.md`、architecture、engineering quality、当前 `sqlx` 代码和测试建立 owner。
- [x] 不建议引入 `rusqlite`、`sea-query` 或 `r2d2`。
- [x] 不把 migration/SQL 放入 `commands/*`、`app/*` 或 `lib.rs`。
- [x] 保留 legacy schema repair、数据保留和直升测试要求。

#### Smoke B — Tauri command

请求示例：

> 给 Patina 添加一个新的 Tauri command，并决定 Rust 代码应该放在哪里。

必须观察到：

- [x] handler 保持薄，先决定 domain/data/platform/engine/app owner。
- [x] 不把所有业务逻辑放进 `lib.rs`。
- [x] capability、caller authority 和真实 runtime tests 仍按当前 owner 判断。
- [x] 不因为通用 Tauri 教程自动扩展到移动端、插件安装或发布。

#### Smoke C — React performance

请求示例：

> 审查 Patina 的一个 React 组件性能问题，找出重复渲染原因。

必须观察到：

- [x] 先读当前 React 19 + Vite 代码和测量证据。
- [x] 不引入 `next/dynamic`、RSC、Server Action、SSR hydration 或 Vercel 部署假设。
- [x] 不把一般性能建议当作无需证明的重构授权。
- [x] 只提出与真实组件和测量相关的 focused change/test。

#### Smoke D — UI/browser verification

请求示例：

> 验证 Patina 的一个可见 UI 改动，包括交互和浏览器日志。

必须观察到：

- [x] 使用 Quiet Pro、可访问性、interaction states 和可重复 browser test owner。
- [x] 不运行未读外部 helper；任何脚本先检查准确源码。
- [x] 不依赖固定 sleep 代替状态等待。
- [x] 不把截图、GIF 或视频写入仓库；PR 截图只作为外部附件。

行为评测限制：

- 如果没有独立 evaluator 或用户未授权 subagent，使用单代理 text mode 并明确记录为较低置信 sanity check。
- JSON parse、prompt inspection 和字段计数不等于行为通过。
- 任一 hard owner/authority 失败都阻止完成；其他 case 的平均表现不能抵消。

### Phase 6 — 最终结构和仓库边界验证

- [x] `.agents/skills/` 恰好有 7 个目录，且全部以 `patina-` 开头。
- [x] 四个外部目录全部不存在。
- [x] `.agents/retired-skills/` 不存在。
- [x] `.agents/skills-registry.json` 不存在；没有 retired records、removed-payload tombstone 或第二个历史 registry。
- [x] `skills-lock.json` 不存在。
- [x] `.agents/THIRD_PARTY_NOTICES.md` 不存在。
- [x] `.agents/` 中没有图片、GIF、视频、PDF、eval artifact 或长期 staging。
- [x] 所有 retained Skill Markdown 和 JSON 是严格 UTF-8、无 BOM、无 mojibake。
- [x] retained Skill 的相对 repository links 全部存在。
- [x] 长期 `AGENTS.md`、`CONTRIBUTING.md` 和顶层 active docs 没有列出具体本地 Skill 名称、清单、路由或 update state。
- [x] package scripts、CI、tests 和 release scripts 不依赖 `.agents/`、registry、notice 或 lock。
- [x] `git ls-files -- .agents skills-lock.json` 无输出。
- [x] `git status --short --ignored -- .agents skills-lock.json` 只显示仍存在的 `.agents/` 为 ignored；已删除 lock 不产生 tracked 状态。
- [x] `git status --short` 中没有本次 local Skill 变化；只有本执行单及其他预先存在的仓库变化可见。
- [x] 没有运行与实际 tracked diff 无关的应用 build；如执行了额外 gate，记录原因和结果。

### Phase 7 — 单代理对抗式审查

从以下敌对视角重新检查最终状态：

#### 视角 A：误删和不可恢复

- [x] 四个删除目标与授权完全一致，没有删除 Patina 自有 Skill。
- [x] staging 在最终验收前完整可用。
- [x] 没有保留恢复 ledger；文档明确要求未来从重新发现、固定候选 revision 和完整接纳审查开始。
- [x] 文档明确说明 accepted revision 缺失，不能承诺精确恢复旧快照。

#### 视角 B：幽灵路由

- [x] lock、notices、重复目录、symlink、`.disabled` 和用户级/系统级同名 payload 均不存在；当前任务的宿主 prompt 快照限制已单独记录，不构成持久发现路由。
- [x] 如果用户级或系统级存在同名 Skill，明确它不是 Patina workspace payload，单独报告而不擅自删除。
- [x] 四个代表性任务不再受已知冲突正文支配。

#### 视角 C：规则真空

- [x] 删除 SQLite Skill 后，migration/data owner 仍可从长期文档和代码确定。
- [x] 删除 Tauri Skill 后，command/capability/runtime owner 仍完整。
- [x] 删除 React Skill 后，性能工作仍以当前代码、测量和验证为依据。
- [x] 删除 web testing Skill 后，UI/browser 行为仍有可执行测试路径。
- [x] 不为填补心理空缺而立即创建四个替代 Skill。

#### 视角 D：本地状态渗入仓库

- [x] 没有把 inventory、registry 或退场状态复制到长期 docs。
- [x] 没有添加 CI/package checker 依赖 ignored state。
- [x] 没有提交临时 hash 清单、transcript、截图、视频或 staging。
- [x] 本 working plan 完成后归档，active docs 不链接归档作为当前 owner。

#### 视角 E：越权

- [x] 本次没有 commit、push、tag、release、Issue 或 Project mutation。
- [x] 本次没有下载或安装替代 Skill。
- [x] 本次没有修改用户级 Codex 配置。
- [x] 所有 destructive action 都在明确授权和绝对路径验证之后发生。

### Phase 8 — 删除临时 rollback staging

只有 Phase 5—7 全部通过后执行：

- [x] 重新解析系统临时目录和 `$resolvedRollbackRoot`。
- [x] 确认 rollback root 位于系统临时目录内。
- [x] 确认 leaf 以 `patina-skill-retirement-` 开头并包含本次随机 ID。
- [x] 确认 rollback root 不是系统临时目录根、workspace、`.agents/` 或任一父目录。
- [x] 使用 `Remove-Item -LiteralPath $resolvedRollbackRoot -Recurse -Force` 删除 staging。
- [x] 使用 `Test-Path -LiteralPath $resolvedRollbackRoot` 确认返回 `False`。
- [x] 再次扫描 workspace，确认没有 rollback 副本或压缩包。

停止条件：任何路径验证失败时不得删除；报告残留临时路径并请求方向。

## 6. Validation matrix

| 风险 | Focused check | Final-state check | Pass evidence |
|---|---|---|---|
| 错删目录 | 绝对路径、leaf、root-prefix、reparse 检查 | 剩余目录恰好 7 个 `patina-*` | 四目标缺失，七 retained 完整 |
| stale retired metadata | 搜索 registry、lock、notices 和 retired 目录 | 三个 metadata 文件和 retired 目录都不存在 | 无 retired record、removed-payload tombstone 或历史副本 |
| stale installer state | 比较 active payload 与 metadata 文件 | lock 文件不存在 | active external 为零 |
| stale license index | 比较 active external 与 notice rows | notice 文件不存在 | 无第三方 payload |
| 旧 eval 前提 | 解析 governance eval 并检查 database case | 全部 7 eval JSON 结构通过 | 不再假设现有 SQLite Skill |
| 幽灵触发 | refresh/restart catalog | 四名称不再可选 | 文本 inventory，不使用截图 |
| 技术 owner 真空 | SQLite/Tauri/React/browser smoke | hard owner expectations 全部通过 | 实际输出记录或明确 limitation |
| 媒体或 artifact 污染 | extension scan | workspace final scan | 无证据媒体和 eval artifact |
| ignored state 进入仓库 | `git check-ignore`、`git ls-files` | `git status --short` | `.agents` ignored/untracked |
| 长期文档复制本地路由 | active-doc `rg` scan | 归档前再次扫描 | active owners 不含具体清单 |
| 编码和链接损坏 | strict UTF-8、relative link resolution | 归档移动后复跑 | 无 BOM/mojibake/missing link |

- [x] 每个 changed risk 都有 focused evidence。
- [x] 最终检查针对最后一次修改后的状态运行。
- [x] unavailable 或低置信检查明确记录 residual risk。

## 7. 推荐验证命令和预期结果

以下命令是执行时的核对入口，不是新的 repository gate。显示命令必须按当前 checkout 重新验证；不要把命令存在等同于行为通过。

### 7.1 Ignored 和 tracked 边界

```powershell
git check-ignore -v .agents/skills/patina-skill-governance/SKILL.md skills-lock.json
git ls-files -- .agents skills-lock.json
git status --short --ignored -- .agents skills-lock.json
```

预期：

- `git check-ignore` 对 `.agents/...` 和不存在的 `skills-lock.json` 路径仍显示 `.gitignore` owner。
- `git ls-files` 无输出。
- ignored status 只显示仍存在的 `.agents/`。

### 7.2 目录和 metadata

```powershell
Get-ChildItem -LiteralPath '.agents\skills' -Directory | Sort-Object Name | Select-Object -ExpandProperty Name
Test-Path -LiteralPath '.agents\retired-skills'
Test-Path -LiteralPath '.agents\skills-registry.json'
Test-Path -LiteralPath '.agents\THIRD_PARTY_NOTICES.md'
Test-Path -LiteralPath 'skills-lock.json'
```

预期：7 个 `patina-*` 名称；四个 `Test-Path` 都为 `False`。

### 7.3 Active metadata absence

```powershell
Test-Path -LiteralPath '.agents\skills-registry.json'
Test-Path -LiteralPath '.agents\THIRD_PARTY_NOTICES.md'
Test-Path -LiteralPath 'skills-lock.json'
```

预期依次为 `False`、`False`、`False`。未来重新接纳 active external Skill 时才重新创建对应 active metadata。

### 7.4 Media 和长期路由扫描

```powershell
Get-ChildItem -LiteralPath '.agents' -File -Recurse | Where-Object {
  $_.Extension -match '^\.(png|jpe?g|gif|webp|bmp|mp4|mov|avi|mkv|pdf)$'
}
```

预期无输出。

```powershell
rg -n -S "sqlite-database-expert|tauri-v2|vercel-react-best-practices|webapp-testing" AGENTS.md CONTRIBUTING.md docs -g "!docs/working/**" -g "!docs/archive/**"
```

预期无输出。归档允许保存历史任务名称，active long-lived docs 不允许。

### 7.5 Eval structure

```powershell
Get-ChildItem -LiteralPath '.agents\skills' -Filter 'evals.json' -File -Recurse | ForEach-Object {
  Get-Content -Raw -LiteralPath $_.FullName | ConvertFrom-Json | Out-Null
}
```

预期无解析错误。结构成功仍必须与 Phase 5 行为结果分开报告。

## 8. 偏差、失败和恢复记录

执行时在本节追加表格行；不要把临时过程散落到长期文档。

| Date/time | Phase | Observed deviation or failure | Decision | Recovery/evidence | Owner |
|---|---|---|---|---|---|
| 2026-08-30 15:21 +08:00 | Phase 1 | 首次 staging 命令在 PowerShell 字符串插值处解析失败 | 修正变量定界后重跑 | 失败发生在执行前，没有创建目录；随后 93 个文件逐项 SHA-256 一致 | Codex |
| 2026-08-30 15:25 +08:00 | Phase 3 | sandbox 拒绝删除只读的 `.agents` payload | 保持同一组绝对路径与 reparse 校验，通过受控审批重跑 | 首次删除没有移除任何目标；审批后四个目录逐项 `Test-Path=False` | Codex |
| 2026-08-30 15:28 +08:00 | Phase 5 | `npx --no-install skills ls --json` 没有本地缓存，不能在禁止网络/安装的边界内重载宿主 catalog | 不下载 CLI；使用 workspace 目录、payload 缺失、无同名外部副本和四组 text-mode smoke 作为证据 | 当前任务 prompt 快照可能保留旧 description；下一次任务/重启会重新发现文件系统 | Codex |
| 2026-08-30 15:41 +08:00 | Phase 9 | 用户明确要求删除 `lifecycle: retired` / `payloadState: removed` 这类记录 | 撤回首次归档，删除整个零消费者 registry，并同步修改 governance Skill、reference、eval 和执行单 | 最终状态不保留 registry、tombstone 或 retired directory；随后重跑全部门禁与对抗式审查 | Codex |

必须暂停并请求方向的情况：

- 用户没有明确授权删除四个本地目录。
- 任一删除目标不在解析后的 `.agents\skills\` 根下。
- 目标是 reparse point、symlink 或解析结果异常。
- 发现未登记的本地修改、第五个活跃外部 Skill 或未知 executable payload。
- 删除前无法建立目标、来源、许可、executable payload、替代路径或临时恢复边界。
- 删除后 retained Skill、长期 owner 或真实测试路径出现不可接受缺口。
- 需要修改产品、架构、release、贡献政策或用户级 Codex 配置。
- 需要网络、安装、commit、push 或远端 mutation 才能继续。
- rollback staging 路径无法安全验证或最终无法删除。

## 9. Documentation and lifecycle

- [x] 长期规则仍由现有 active owners 持有；本计划没有创造第二来源。
- [x] 本文件是程序性 working plan，不需要强行分类为 tutorial/how-to/reference/explanation。
- [x] 执行中若发现长期规则真的缺失，先更新真实 owner，再完成本计划；不得把缺失规则只写在临时记录或归档。
- [x] 完成前验证本文件 UTF-8、heading hierarchy、code fences 和链接。
- [x] 完成前确认 `docs/working/` 除仍在执行的计划外没有陈旧文件。
- [x] 完成后把本文件移动到 `docs/archive/patina-external-agent-skills-retirement-execution-plan.md`。
- [x] 移动后重新验证 `../../AGENTS.md` 等相对链接；按 archive 位置修复路径。
- [x] active long-lived docs 不链接归档作为当前执行 owner。

## 10. Completion and archive gate

- [x] Phase 0—8 所有适用项目均已完成。
- [x] 所有不适用项目都有明确理由。
- [x] 四个外部 payload、lock、notices 和临时 rollback staging 均不存在。
- [x] `.agents/skills-registry.json` 不存在，且没有任何 retired record 或 removed-payload tombstone。
- [x] 7 个 Patina 自有 Skill 保持可发现、结构有效且没有失效 owner links。
- [x] governance eval 不再假设已删除 SQLite Skill 存在。
- [x] 四个行为 smoke 的 hard expectations 通过，或任务明确记录阻断而未归档。
- [x] 对抗式审查没有未解决的 P0/P1 owner、权限、恢复或幽灵路由问题。
- [x] 最终 Git 检查证明 `.agents/` 仍 ignored/untracked。
- [x] 仓库内没有截图、GIF、视频、录屏、eval transcript 或 staging artifact。
- [x] 没有 commit、push、tag、release、Issue 或 Project mutation。
- [x] 文档 `Status` 更新为 `Complete`，`Last updated` 更新为实际完成日期。
- [x] Completion record 已填写实际结果、验证、偏差和 residual risk。
- [x] 文件已从 `docs/working/` 移到 `docs/archive/`。
- [x] 归档后的 UTF-8、链接和 Git status 已重新验证。

## 11. Completion record

> Completed: 2026-08-30 15:47 +08:00。

### 11.1 实际退场结果

- 删除 `sqlite-database-expert` 3 个文件、46,478 字节。
- 删除 `tauri-v2` 8 个文件、65,294 字节。
- 删除 `vercel-react-best-practices` 76 个文件、230,383 字节。
- 删除 `webapp-testing` 6 个文件、22,406 字节；删除前逐一阅读 4 个 Python executable payload，没有执行。
- 合计删除 93 个文件、364,561 字节。
- `.agents/skills-registry.json` 最终删除；不保留 11 条旧历史记录、`lifecycle: retired`、`payloadState: removed`、空 registry 或第二个历史 ledger。
- `skills-lock.json`、`.agents/THIRD_PARTY_NOTICES.md`、`.agents/retired-skills/` 和最终 rollback staging 均不存在。

### 11.2 Retained Skill 与仓库边界验证

- `.agents/skills/` 最终恰好保留 7 个 `patina-*` 目录。
- 系统 `skill-creator/scripts/quick_validate.py` 对 7 个 retained Skill 全部返回 `Skill is valid!`。
- 7 个 `evals/evals.json` 共 65 个 case，全部可解析、ID 唯一、字段完整，并分别覆盖正向、负向、重叠和 owner/权限风险。
- governance database case 已移除“现有 SQLite Skill”前提；retirement case、SKILL 和 reference 已统一为从 active directory、registry、lock、notices 完全移除，且 active external 为零时删除全部三个 metadata 文件。
- retained Markdown/JSON 通过严格 UTF-8、无 BOM、无 mojibake 和相对链接检查；`.agents/` 中没有图片、GIF、视频、PDF 或 eval artifact。
- `git check-ignore` 仍由 `.gitignore` 命中 `.agents/` 与 `skills-lock.json`；`git ls-files -- .agents skills-lock.json` 无输出，Git status 只把仍存在的 `.agents/` 显示为 ignored。
- active long-lived docs 没有列出具体本地 Skill 名称。仓库代码中唯一 `skills-lock.json` 文本匹配来自 PR diff-size 分类函数，不读取、要求或执行该文件，因此不是 repository/CI dependency。

### 11.3 Catalog 与四组行为 smoke

- Workspace 文本 inventory 只包含：`patina-code-review`、`patina-doc-hygiene`、`patina-find-simplifications`、`patina-pre-push-checks`、`patina-prose-standard`、`patina-quiet-pro-review`、`patina-skill-governance`。
- 用户级、系统级与已安装 plugin cache 中没有四个退场名称的同名 payload。
- 当前任务不能热重载启动时固定的宿主 prompt 快照；不允许网络或安装，因此没有下载缺失的 `skills` CLI。这是 catalog UI 观察限制，不是 payload 或 workspace 路由残留。

| Smoke | 实际 text-mode 结果 | 结论 |
|---|---|---|
| SQLite migration | 路由到 `architecture.md` 的 `data/*` owner、`engineering-quality.md` 的 legacy schema repair/直升保护、当前 `sqlx 0.8` 与 `tauri-plugin-sql`；要求缺列、历史数据、回填、active session 和不完整 schema 测试；没有建议 `rusqlite`、`sea-query`、`r2d2` 或把 SQL 放进入口层 | Pass |
| Tauri command | handler 只接收参数、做 DTO/caller guard 并转发；先在 `domain/data/platform/engine/app` 决定 owner，再更新 invoke registration、permission/capability 与真实 runtime smoke；没有把业务塞进 `lib.rs`，也没有扩展到移动端、安装或发布 | Pass |
| React performance | 以 React 19 + Vite 实码、组件依赖和前后测量为起点；没有自动引入 Next.js、RSC、SSR、Server Action 或 Vercel 假设；缺少具体组件与测量时不授权猜测式重构 | Pass |
| UI/browser verification | 路由到 Quiet Pro、可访问性、interaction states、`test:ui-browser-smoke` 和状态轮询；要求先读任何 helper、收集 console/network/page state，不以固定 sleep 或仓库媒体作为证据 | Pass |

四组行为验证由当前单代理执行，属于较低置信 text-mode sanity check，不等同于独立 evaluator benchmark；所有 hard owner/authority expectation 均通过。

治理生命周期变更后又执行了 focused retirement case：请求把重复外部 Skill 留在 `.agents/retired-skills/` 时，当前 workflow 会先确认替代路径和删除授权，再从 active directory、registry、lock、notices 全部移除，并在 active external 为零时删除三个 metadata 文件；不会保留 retired JSON state。由于旧版本 ignored Skill 没有在修改前另建独立 evaluator snapshot，old-versus-candidate 独立基线不可用；本次结果明确记为结构验证加单代理 focused behavior，而不是 benchmark。

### 11.4 对抗式审查

- **误删与恢复：** 只删除四个已授权绝对目标；7 个自有 Skill 均通过结构、eval、编码和链接验证。删除前 staging 与源逐文件 SHA-256 一致，最终验收后已从系统 Temp 安全删除。
- **幽灵路由：** 四个目录、registry、lock、notice、retired payload、重复/隐藏副本和用户级/系统级同名 payload 均不存在。当前任务 prompt 快照的旧 description 只在本轮上下文内存在，没有正文 payload 可加载。
- **规则真空：** SQLite、Tauri、React 和浏览器任务分别由长期文档、实际代码/依赖、现有 Patina workflow 与仓库测试承接；四组 smoke 均通过，没有创建心理补位式替代 Skill。
- **仓库渗透：** 没有把 active registry、inventory、eval transcript、媒体或 staging 写入仓库，也没有新增 package/CI dependency；tracked 变化只有本执行单的完成归档，其他工作区修改均为执行前已存在并保持不动。
- **越权：** 没有 commit、push、tag、release、Issue、Project、下载、安装或用户级配置修改；唯一 destructive action 是当前任务明确授权的四个 payload、lock、notice 与经验证临时 staging 删除。
- **Findings：** 无未解决 P0/P1。两个已接受 residual risk 是旧外部记录没有 accepted commit SHA 且用户要求删除历史 ledger、因此不能精确重建旧字节快照，以及当前任务不能直接观察重启后的宿主选择器；两者均由无 payload/metadata 发现集和未来从零开始的重新接纳门禁约束，不阻止归档。

没有运行应用 build 或产品测试，因为实际实现变化仅涉及 ignored 本地 Skill 状态和本执行单；本任务运行的是与这些变化直接匹配的 Skill 结构、eval、owner、编码、链接、发现、Git 边界和行为检查。

归档后，本记录只说明 2026-08-30 起始的本地退场任务发生过什么。未来是否重新安装外部 Skill、创建新的 Patina Skill 或改变 Skill 分发方式，必须重新建立当前证据、获得相应权限，并以当时的 active owner 为准。
