# Patina 全仓高置信度代码简化执行方案（2026-08-30）

> - Status: Complete
> - Created: 2026-08-30
> - Last updated: 2026-08-30
> - Execution owner: Codex，依据 2026-08-30 当前任务中的明确实施、验证与归档授权
> - Archive owner: `docs/archive/`
> - Long-term owners affected: frontend feature/app/platform owners、Tauri build/command owners、`package.json` 依赖 owner
> - Lifecycle: 已完成的一次性执行历史；不再是当前执行依据，也不是长期规则 owner

## 0. 文档定位与执行纪律

本文记录 2026-08-30 全仓只读审计所得简化候选的已完成执行历史。长期规则仍由 [`AGENTS.md`](../../AGENTS.md)、[`architecture.md`](../architecture.md)、[`engineering-quality.md`](../engineering-quality.md)、[`issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md) 和 [`versioning-and-release-policy.md`](../versioning-and-release-policy.md) 持有。

- [x] 本文被归类为 working execution plan，而不是顶层长期文档。
- [x] 本文没有建立新的产品、架构、兼容、发布或 GitHub Project 规则。
- [x] 执行者只在当前任务明确授权的范围内修改代码和依赖。
- [x] 执行者在每个阶段开始前确认目标文件没有与用户改动重叠。
- [x] 每个勾选项只在对应证据已经产生后标记完成。
- [x] 阶段内出现偏差时，先记录到第 9 节，再决定继续、降级或停止。
- [x] 不使用 `git reset --hard`、广域 restore 或其他会覆盖用户改动的回退方式。
- [x] 本文不授权 commit、push、tag、release、Issue 或 GitHub Project mutation。

状态转换规则：

- 获得方案批准但尚未实施时，将 Status 更新为 `Approved` 并更新 Last updated。
- 开始实施时，将 Status 更新为 `In progress`，记录实际 execution owner，并更新 Last updated。
- 遇到无法继续的阻塞时，将 Status 更新为 `Blocked`，在第 9 节记录事实、owner 与解除条件。
- 阻塞解除并恢复实施时，将 Status 更新回 `In progress`，同时更新第 9 节和 Last updated。

## 1. 决策与第一性原理

### 1.1 稳定事实

1. 用户可观察行为、数据兼容、异步顺序、缓存生命周期和权限边界才是必须保护的产品与工程价值。
2. 每个可调用入口、公开符号、转发层和直接依赖都会增加可达状态、认知负担与未来误用空间。
3. 删除只有在所有真实消费者与保护边界都已解析时才构成简化；没有证据的删除只是风险转移。
4. 文件位置由真实 owner 决定。不能为了减少文件数而让 feature 直接穿透平台边界，或让 `shared/*`、`app/*`、`platform/*` 接收不属于它们的职责。
5. 生成物由生成源和生成流程持有。手工修剪生成 JSON 会制造下一次生成时的漂移。
6. 已发布迁移、备份 reader、协议兼容和运行时测试通道承担用户数据或验证责任，不能按“看起来像旧代码”处理。
7. 验证必须对应改动风险：删入口要证明不可达，收窄导出要证明类型与构建仍成立，删依赖要证明依赖图和产物仍成立。

### 1.2 推导出的执行策略

- [x] 默认执行集只包含 High-confidence 候选。
- [x] Medium 候选必须通过独立证据门，不能混入普通删除阶段。
- [x] 每个阶段保持独立、可审查、可回退，并在进入下一阶段前通过聚焦验证。
- [x] 不为零消费者代码补测试；测试应保护保留下来的真实路径。
- [x] 不因本次清扫引入新 abstraction、compatibility shell、跨层 relocation 或 `V2`/`New` 命名。
- [x] 最终验收以行为不变、公开表面缩小、依赖声明准确和完整验证通过为准，不以删除行数为唯一目标。

### 1.3 可观察目标

- [x] 删除 2 个零消费者聚合函数和 1 个随之失去用途的接口。
- [x] 删除 1 个零消费者单状态芯片 wrapper。
- [x] 删除 1 个无增值重导出文件，并把唯一消费者改为直接引用同一 app owner 下的 provider。
- [x] 将 11 个仅在定义模块内部使用的符号改为模块私有。
- [x] 从根依赖声明移除无直接消费者的 `postcss`，并同步 lockfile。
- [x] `quality:exports` 不再报告本次基线中的 3 个 unreferenced export 和 12 个 internal-only export。
- [x] Tools、更新对话框、widget、i18n、构建、bundle、Tauri IPC 和既有兼容行为保持不变。
- [x] 所有未进入执行集的候选都有明确保留理由或后续 owner。

## 2. 当前证据与基线

### 2.1 仓库状态

- [x] 2026-08-30 审计开始和结束时，工作树没有未提交文件；`main` 相对 `origin/main` 为 ahead 4。
- [x] 仓库是 `private` package；没有受支持的 npm library consumer。
- [x] `docs/working/` 在创建本文前为空；本文在实施期间是唯一 working execution basis。
- [x] 当前请求没有指定 Issue 或 GitHub Project item，因此本次文档编写不需要读取或修改 live Project state。
- [x] 实施开始时重新运行 `git status --short --branch`，确认除本文外工作树 clean，且 `main` 相对 `origin/main` 为 ahead 4。

### 2.2 已验证的审计事实

| 事实 | 当前证据 | 状态 |
|---|---|---|
| `loadActivityReminderTargetCandidates` 无消费者 | 全仓精确引用搜索；生产路径使用 app/category/web 三个细粒度 loader | Verified |
| `loadActivityReminderCatalogSnapshot` 无消费者 | 全仓精确引用搜索；细粒度 platform gateway 仍有生产消费者 | Verified |
| `buildToolsStatusChipViewModel` 无消费者 | UI 和测试只使用复数版本 `buildToolsStatusChipViewModels` | Verified |
| `useUpdateDialog.ts` 仅做一行重导出 | 唯一消费者是 `useAppShellUpdateEntry.ts`；真实实现位于 provider | Verified |
| 12 个 export 仅在定义模块内部使用 | TypeScript language-service 导出审计；其中 1 个会随聚合接口删除 | Verified |
| 根 `postcss` 没有直接源码、脚本或配置消费者 | 全仓搜索与 `npm explain postcss`；Tailwind/Vite 依赖图仍含传递来源 | Verified |
| 4 个已退出命令仍残留在生成 schema | `build.rs`、invoke handler 与生成 schema 对照；`permission ls` 仍列出旧权限 | Verified |
| 2 个无普通生产调用的 Tauri command 有真实冒烟测试消费者 | `tauriRuntimeSmoke.test.ts` 分别使用就绪观测和窗口销毁入口 | Verified |

### 2.3 审计时的质量基线

- [x] `npm run quality:exports` 通过并报告：`internal-only=12`、`test-only=103`、`unreferenced=3`。
- [x] `npm run quality:hotspots` 通过；大文件和重复块仅作为审查线索，没有自动升级为删除候选。
- [x] 架构、Rust boundary、命名和 IPC contract 检查通过。
- [x] `npm run check` 通过，包括 103 项浏览器 UI smoke tests、前端构建和 bundle budget。
- [x] `npm run check:rust` 通过：650 项 Rust tests 通过、1 项忽略，Clippy 无警告。
- [x] 审计基线中的 `npm run check:dependencies` 两次因无法拉取 RustSec advisory database 而未通过；最终实施阶段已补齐有效报告。
- [x] RustSec 网络失败先被记录为 Unavailable，最终通过仓库显式离线模式使用已更新的本地 advisory database 验证通过。

## 3. 范围、非目标与授权边界

### 3.1 默认执行范围

1. Tools activity-reminder 候选聚合链删除。
2. Tools 单状态芯片 wrapper 删除。
3. Update dialog 一行转发层删除。
4. 11 个 internal-only export 收窄。
5. 根 `postcss` 直接依赖删除与 lockfile 更新。
6. 生成 ACL schema 漂移的证据门控处理：能通过 owner 生成流程得到窄幅确定性 diff 时纳入；否则显式转交，不手工修改。
7. 与上述风险直接相关的聚焦验证、最终聚合验证和计划状态维护。

### 3.2 明确不在范围内

- 大文件拆分、广泛去重、架构重写或新 shared abstraction。
- `toolsIconService.ts`、`dataIconService.ts`、`historyIconService.ts` 等 feature/platform facade 合并。
- `settingsDataExportService.ts`、tools/history cache lifecycle 等 owner 或生命周期 wrapper 删除。
- `cmd_get_activity_read_model_status` 与 `cmd_e2e_destroy_hidden_main_window` 删除或测试通道重构。
- 旧结构化备份 reader、`software -> app` 偏好迁移、classification migration、数据库 migration 或 Web Activity v1 协议兼容删除。
- UI、交互、文案、视觉证据、性能策略或产品范围变更。
- 版本号、changelog、release note、tag、release artifact 或 updater 变更。
- Commit、push、branch、PR、Issue 或 GitHub Project 变更。

- [x] 执行前确认 proposed diff 只落在本节的默认执行范围。
- [x] 发现相邻问题时记录 owner 与证据；仅处理了阻止本计划 schema 刷新的 4 个同范围忽略生成缓存，没有扩大到其他候选。
- 若某项需要新 abstraction、跨层 relocation 或 compatibility shell，立即停止该项并重新进行边界判断。

## 4. 结果、owner、消费者与保护不变量

| 结果 | 真实 owner | 已解析消费者 | 必须保持的不变量 | 聚焦证据 |
|---|---|---|---|---|
| 删除提醒候选聚合链 | `features/tools/services` 与 `platform/persistence` | 聚合入口为 0；三个细粒度 loader 有生产消费者 | 只加载当前提醒模式所需候选；cache invalidation 与语言/App Mapping 失效关系不变 | 精确引用搜索、完整 diff review、`check:types`；`test:tools` 仅作邻近回归 |
| 删除单状态芯片 wrapper | `features/tools/services/toolsViewModel.ts` | 单数入口为 0；复数入口由 UI 和 tests 使用 | 多个同时状态、排序和空状态语义不变 | `test:tools`、`quality:exports` |
| 删除 update dialog 转发文件 | `app/providers` 与 `app/hooks` | 转发文件只有 1 个消费者；provider hook 为 canonical implementation | provider 上下文校验、dialog 状态与 update flow 不变 | 精确引用搜索、provider 无 diff、`check:types`、`check:architecture`、`build`；`test:update` 仅作邻近回归 |
| 收窄 11 个 export | 各定义模块 | 仅模块内部消费者；无动态或 package consumer | 运行时代码、类型推导、序列化和公共 Tauri contract 不变 | `quality:exports`、`check:types`、`build` |
| 删除根 `postcss` 声明 | `package.json` 与 `package-lock.json` | 无直接代码消费者；存在工具链传递来源 | Tailwind/Vite 构建、CSS 产物和 bundle budget 不变 | `npm explain postcss`、`build`、`check:bundle` |
| 刷新生成 ACL schema | `src-tauri/build.rs` + `tauri-build` 生成流程 | schema 被 capability 配置与 CLI permission inspection 使用 | 只反映当前注册命令；不得扩大或缩小实际 runtime authority | Tauri no-bundle build、`permission ls`、IPC/Rust checks |

### 4.1 受保护兼容边界

- [x] 旧结构化备份 reader 的兼容截止事实由 [`CHANGELOG.md`](../../CHANGELOG.md) 记录为 2026-10-18；在该日期前不进入本计划。
- [x] 旧 reader 的删除还必须满足 [`versioning-and-release-policy.md`](../versioning-and-release-policy.md) 的正式发布与退出条件，不能仅按日期自动执行。
- [x] `software -> app` 偏好迁移随 1.9.4 于 2026-08-13 发布；最早复核日为 2026-11-11，届时仍需重新核对发布事实、消费者和 owner。
- [x] Web Activity protocol、backup format、database schema 和 updater contract 均不因本次内部清扫发生变化。

### 4.2 必须保留的 runtime-test IPC

- [x] `cmd_get_activity_read_model_status` 为 runtime smoke 提供 app catalog/hourly projection 收敛观测；测试要求 dirty counts 清零且 source revision 连续稳定，当前没有等价观察入口。
- [x] `cmd_e2e_destroy_hidden_main_window` 只在 debug、`PATINA_E2E=1` 且主窗口隐藏时允许销毁窗口；runtime smoke 用它验证隐藏主 WebView 的销毁与重建。
- [x] 两条命令同时存在于 `build.rs`、invoke handler、permission owner、IPC checker allowlist 和 runtime smoke，不属于生成漂移。
- 除非另一个独立方案先提供等价测试能力，否则不得删除、改名或移动这两条命令。

## 5. 候选准入与停止条件

### 5.1 进入默认执行集的必要条件

每个删除或收窄项必须同时满足：

- [x] 全仓静态消费者已搜索，包括 `src/`、`src-tauri/`、`tests/`、`scripts/`、配置、registries 和 manifests。
- [x] 动态 import、字符串注册、Tauri invoke、事件名、序列化字段和生成物消费者已经排除。
- [x] 不存在受支持的 package、protocol、migration、backup 或外部调用方。
- [x] 保留下来的 canonical implementation 与 owner 已明确。
- [x] 删除不会改变异步顺序、缓存填充/清理、错误传播、空状态或权限范围。
- [x] 净结果减少入口、层级、符号或直接依赖，而不是把复杂度搬到新位置。
- [x] 有与风险匹配的 focused check 和 aggregate gate。

### 5.2 必须停线或降级的情况

以下内容是触发规则，不是需要逐项勾选的正常路径：

- 如果搜索发现新的 production、test、dynamic 或 external consumer，取消该删除项并更新证据。
- 如果用户已有改动与目标 hunk 重叠，停止并请求方向，不覆盖或代替用户实现。
- 如果聚焦测试失败并显示行为差异，恢复当前阶段的窄幅改动，不通过改测试掩盖差异。
- 如果删除需要新增 wrapper、adapter、shared helper 或跨层 relocation，停止并重新判断 owner。
- 如果 lockfile 更新产生与 `postcss` 无关的版本漂移，停止依赖阶段并恢复该阶段的 manifest/lockfile diff。
- 如果 Tauri 生成流程不更新 schema，或产生不可解释的大面积格式/平台漂移，记录阻塞并转交生成物 owner；禁止手工编辑生成 JSON。
- 如果最终依赖审计仍因网络不可用，计划保持 Draft/In progress/Blocked，不得标记 Complete。

## 6. 分阶段详细执行

### Phase 0 — 冻结基线与授权范围

目标：证明执行从已知状态开始，并把用户改动、环境不一致和范围漂移挡在实现之前。

#### 检查

- [x] 重新判断当前实现请求是否映射到 existing Issue 或 live GitHub Project item；当前没有 Issue/Project 映射，不需要读取或修改 live Project。
- [x] 运行 `git status --short --branch`，记录分支、ahead/behind 与所有现有改动。
- [x] 对现有工作树逐文件完成 scope classification；除本文外工作树 clean，没有与目标源码重叠的改动。
- [x] 运行 `node --version` 和 `npm --version`，结果为 Node `24.18.0`、npm `11.16.0`，与 [`package.json`](../../package.json) 一致。
- [x] 运行 `npm run quality:exports`，基线为 `internal-only=12`、`test-only=103`、`unreferenced=3`。
- [x] 运行 `npm run check:architecture`、`npm run check:naming` 和 `npm run check:ipc-contracts`，三项均通过。
- [x] 运行以下精确搜索，确认候选仍符合 2026-08-30 审计结论：

```powershell
rg -n "loadActivityReminderTargetCandidates|ActivityReminderTargetCandidates|loadActivityReminderCatalogSnapshot|buildToolsStatusChipViewModel" src tests scripts
rg -n "useUpdateDialog" src tests scripts
rg -n "postcss" package.json package-lock.json src tests scripts vite.config.ts
```

#### 准入

- [x] 工作树状态已记录，且没有未解决的目标文件重叠。
- [x] 三个 unreferenced export 和十二个 internal-only export 仍可重现。
- [x] 边界基线通过；没有需要与本计划分离的既有失败。
- [x] 当前任务已明确授权本地实施、验证、归档和后续对抗式审查；没有 commit 或 push 授权。
- [x] 进入 Phase 1 前已把 Status 更新为 `In progress`，并写入实际 execution owner。

### Phase 1 — 删除 activity-reminder 候选聚合链

目标：删除没有消费者的“全量加载”入口，同时保持生产路径按 reminder mode 懒加载。

#### Owner 与文件

- [`activityReminderTargetCandidates.ts`](../../src/features/tools/services/activityReminderTargetCandidates.ts)
- [`activityReminderCatalogGateway.ts`](../../src/platform/persistence/activityReminderCatalogGateway.ts)
- 只读核对消费者：[`useToolsPageState.ts`](../../src/features/tools/hooks/useToolsPageState.ts)

#### 实施前检查

- [x] 确认 `loadActivityReminderTargetCandidates` 只出现在定义和返回类型中。
- [x] 确认 `ActivityReminderTargetCandidates` 没有独立消费者。
- [x] 确认 `loadActivityReminderCatalogSnapshot` 只出现在定义中。
- [x] 确认 `useToolsPageState` 仍分别调用 app、category、web 三个 loader，并保留现有 invalidation subscription。
- [x] 检查动态 import、barrel export、registries 与测试 fixture 中没有字符串消费者。

#### 修改

- [x] 删除 `ActivityReminderTargetCandidates` 接口。
- [x] 删除 `loadActivityReminderTargetCandidates` 函数。
- [x] 删除 `loadActivityReminderCatalogSnapshot` 函数。
- [x] 保留三个细粒度 candidate loader、它们的 cache、clear/invalidation 入口和现有错误传播。
- [x] 保留 `ActivityReminderCatalogSnapshot` 定义，供 gateway 文件内部的 indexed return types 使用；其 `export` 在 Phase 4 处理。
- [x] 不合并 app/category/web loader，不改变加载并发度或页面进入时机。

#### 聚焦验证

- [x] 重新运行候选精确搜索，确认三个删除目标为零定义、零引用。
- [x] 完整阅读 `useToolsPageState.ts` 与三个 candidate cache owners 的 diff，确认页面生产路径没有发生改动，cache owners 只有计划内删除或导出收窄。
- [x] 运行 `npm run test:tools`。
- [x] 运行 `npm run check:types`。
- [x] 运行 `npm run quality:exports`，最终 `unreferenced=0`。

#### 验收与回退

- [x] Tools 邻近回归 tests 通过。
- [x] TypeScript 类型检查通过。
- [x] 静态引用和完整 diff review 证明生产代码仍只按当前 reminder mode 加载目标候选；现有 `test:tools` 未被记作该懒加载不变量的机器证明。
- 若发现加载时机、缓存失效或错误行为变化，恢复本阶段的窄幅删除并停止，不进入 Phase 2。

### Phase 2 — 删除单状态芯片 wrapper

目标：保留支持多个并发状态的 canonical view-model builder，删除只取第一项的未使用入口。

#### Owner 与文件

- [`toolsViewModel.ts`](../../src/features/tools/services/toolsViewModel.ts)
- 只读核对消费者：[`ToolsStatusEntry.tsx`](../../src/features/tools/components/ToolsStatusEntry.tsx)
- 保护测试：[`toolsRuntime.test.ts`](../../tests/toolsRuntime.test.ts)

#### 实施前检查

- [x] 确认 `buildToolsStatusChipViewModel` 除定义外没有引用。
- [x] 确认 `buildToolsStatusChipViewModels` 仍被 UI 与 tests 使用。
- [x] 阅读复数 builder 的排序、空数组与并发状态测试，确认必须保持的断言。

#### 修改

- [x] 删除 `buildToolsStatusChipViewModel`。
- [x] 不改动 `buildToolsStatusChipViewModels` 的参数、返回值、排序或标签生成。
- [x] 不新增替代 wrapper 或兼容导出。

#### 聚焦验证

- [x] 运行 `rg -n "buildToolsStatusChipViewModel" src tests scripts`，确认只剩复数名称匹配。
- [x] 运行 `npm run test:tools`。
- [x] 运行 `npm run check:types`。
- [x] 运行 `npm run quality:exports`。

#### 验收与回退

- [x] 多状态 chips、顺序与空状态 tests 通过。
- 如果删除导致任何调用方需要“第一项”语义，恢复本阶段并重新分类消费者，而不是在调用点复制 `[0]` 逻辑。

### Phase 3 — 删除 `useUpdateDialog` 一行转发层

目标：让唯一 consumer 直接引用同一 app owner 内的 canonical provider hook，删除没有策略、适配或生命周期价值的文件。

#### Owner 与文件

- Canonical implementation：[`UpdateDialogProvider.tsx`](../../src/app/providers/UpdateDialogProvider.tsx)
- 唯一 consumer：[`useAppShellUpdateEntry.ts`](../../src/app/hooks/useAppShellUpdateEntry.ts)
- 待删除：`src/app/hooks/useUpdateDialog.ts`

#### 实施前检查

- [x] 确认转发文件只有 `export { useUpdateDialog } from "../providers/UpdateDialogProvider";`。
- [x] 确认没有 lazy import、barrel export、mock path 或测试替换依赖该文件路径。
- [x] 确认 provider hook 仍负责 provider 外调用错误，不把 invariant 搬到 consumer。

#### 修改

- [x] 将 `useAppShellUpdateEntry.ts` 的 import 改为直接引用 `../providers/UpdateDialogProvider`。
- [x] 删除 `src/app/hooks/useUpdateDialog.ts`。
- [x] 不移动 provider，不改变 context、state、effect 或 update command 调用。

#### 聚焦验证

- [x] 运行 `rg -n "useUpdateDialog" src tests scripts`，确认只有 provider 定义和真实调用保留。
- [x] 运行 `npm run test:update`，仅作为邻近 update behavior 回归，未把它记作 provider/AppShell wiring 证明。
- [x] 运行 `npm run check:types`。
- [x] 运行 `npm run check:architecture`。
- [x] 运行 `npm run build`，确认 direct import 能进入 production compilation graph。

#### 验收与回退

- [x] Update 邻近回归、类型检查、架构检查和 production build 通过。
- [x] Import 仍在 `app/*` owner 内，没有让 feature/shared/platform 穿透 provider。
- [x] Provider implementation 与 context invariant 没有代码 diff；现有 tests 未被虚报为 provider wiring 的运行时覆盖。
- 若测试或构建依赖旧模块路径，先判断其是否为真实受支持 consumer；未解析前恢复本阶段。

### Phase 4 — 收窄 11 个 internal-only export

目标：让模块公开表面与真实消费者一致，不移动实现、不改变运行时逻辑。

#### 精确符号清单

| 文件 | 改为模块私有的符号 |
|---|---|
| [`widgetStatusViewModel.ts`](../../src/app/widget/widgetStatusViewModel.ts) | `WidgetToolSlotViewModel`、`WidgetStatusViewModel` |
| [`settingsLanguagePreview.ts`](../../src/features/settings/services/settingsLanguagePreview.ts) | `SettingsLanguagePreviewResult` |
| [`widgetRuntimeGateway.ts`](../../src/platform/desktop/widgetRuntimeGateway.ts) | `WidgetTrackingProjection`、`WidgetPresentationSnapshot`、`parseWidgetPresentationSnapshot` |
| [`activityReminderCatalogGateway.ts`](../../src/platform/persistence/activityReminderCatalogGateway.ts) | `ACTIVITY_REMINDER_WEB_CANDIDATE_LOOKBACK_DAYS`、`ACTIVITY_REMINDER_WEB_CANDIDATE_LIMIT`、`ActivityReminderCatalogSnapshot` |
| [`runtime.ts`](../../src/shared/i18n/runtime.ts) | `LocaleActivationResult` |
| [`tools.ts`](../../src/shared/types/tools.ts) | `ActivityReminderSuspensionReason` |

#### 实施前检查

- [x] 对每个符号运行精确全仓搜索，确认引用只在定义模块内部。
- [x] 检查 `import type`、dynamic import、test compilation、generated code 和字符串 registry。
- [x] 确认没有 declaration publishing、package export map 或受支持外部 TypeScript consumer。
- [x] 确认 Phase 1 已删除的 `ActivityReminderTargetCandidates` 不再计入本阶段。

#### 修改

- [x] 只移除上述 11 个声明的 `export` 修饰符。
- [x] 不删除仍被模块内部使用的 type、interface、constant 或 parser。
- [x] 不把符号移动到新文件，不新增 barrel，不改变名称。
- 如果 exported function 的显式返回类型需要公开类型，先验证当前构建模式；不得用 `any`、复制类型或新 wrapper 绕过。

#### 聚焦验证

- [x] 运行 `npm run quality:exports`。
- [x] 确认本次基线中的 `internal-only=12` 已归零：1 个接口被删除，11 个符号不再导出。
- [x] 确认本次基线中的 `unreferenced=3` 已归零。
- [x] 确认 `test-only=103` 仍被保留；没有把测试契约误删为生产死代码。
- [x] 运行 `npm run check:types`。
- [x] 运行 `npm run test:widget`、`npm run test:i18n` 和 `npm run test:tools`。
- [x] 运行 `npm run test:settings`，保护 settings language preview 的真实消费路径。
- [x] 运行 `npm run build`。

#### 验收与回退

- [x] 没有新增 export-analysis whitelist 或 suppression。
- [x] Build、类型与聚焦 tests 通过。
- 若某符号被真实跨模块 consumer 使用，恢复该符号的 `export`，记录消费者并从候选清单移除。

### Phase 5 — 删除根 `postcss` 直接依赖

目标：让依赖声明表达直接消费者，而不是保留工具链已经提供的重复根声明。

#### Owner 与文件

- [`package.json`](../../package.json)
- [`package-lock.json`](../../package-lock.json)
- 构建 owner：[`vite.config.ts`](../../vite.config.ts)

#### 实施前检查

- [x] 运行 `rg -n "postcss" package.json package-lock.json src tests scripts vite.config.ts`，确认没有新增直接 import、config 或 script consumer。
- [x] 运行 `npm explain postcss`，保存移除前依赖图。
- [x] 确认 Node/npm 版本与 `package.json` 的 `devEngines` 一致，避免无关 lockfile 重写。
- [x] 确认 `esbuild` 仍由 release policy tests 与 `allowScripts` 约束；没有把它与 `postcss` 一并删除。

#### 修改

- [x] 运行 `npm uninstall postcss --ignore-scripts`，让 npm 同步修改 manifest 与 lockfile。
- [x] 检查 `git diff -- package.json package-lock.json`。
- [x] 确认 `package.json` 只删除根 `postcss` declaration。
- [x] 确认 lockfile 只移除根 dependency edge；Vite 所需的传递节点继续存在。
- 如果 npm 重排或升级无关依赖，恢复本阶段并使用匹配的 npm 版本重新执行，不手工接受噪声。

#### 聚焦验证

- [x] 再次运行 `npm explain postcss`，确认根 direct edge 已消失；仅保留 Vite 的传递依赖。
- [x] 运行 `npm run test:release`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run check:bundle`。
- [x] 运行 `npm run check:dependencies`；最终使用仓库显式离线模式获得有效报告。

#### 验收与回退

- [x] Tailwind/Vite production build 通过。
- [x] Bundle budget 通过，CSS 与初始 bundle 没有超出 owner 预算。
- [x] Dependency audit 获得有效报告且通过：0 个 Windows 可达 Rust 漏洞，npm 0 漏洞。
- 若工具链实际要求根 `postcss`，恢复依赖并在 `package.json` 附近使用现有 owner 可接受的方式记录原因；不要通过隐式全局安装补偿。

### Phase 6 — 证据门控：刷新 Tauri 生成 ACL schema

目标：让生成 schema 反映当前 `APP_COMMANDS`，同时避免手工修改生成物或扩大 runtime authority。

本阶段不是普通源码删除。[Tauri capability schema 文档](https://v2.tauri.app/security/capabilities/#schema-files)说明 schema 由 `tauri-build` 根据可用 permissions 生成。仓库中 app-command ACL 的生成源是 [`build.rs`](../../src-tauri/build.rs)；完整 schema 还受锁定依赖提供的 plugin permission manifests 影响。执行结果必须通过生成流程和权限检查共同证明。

#### 已知漂移

实施前的生成 schema 包含以下已经不在 `APP_COMMANDS` 和 invoke handler 中的命令：

- `cmd_clear_all_session_window_titles`
- `cmd_create_software_reminder_rule`
- `cmd_delete_web_activity_segments_before`
- `cmd_disable_software_reminder_rule`

实施前的精确集合差异为 `ACL_ONLY=4`、`BUILD_ONLY=0`。四条名称只出现在 `acl-manifests.json`、`desktop-schema.json` 和 `windows-schema.json` 三个 tracked 生成文件，以及 4 个被忽略的 `permissions/autogenerated/*.toml` 缓存中；实施后两处均已清除。

#### 实施前检查

- [x] 运行以下搜索，确认四个名称在 tracked 文件中只存在于 `src-tauri/gen/schemas/*`；后续根因检查还发现 4 个同名 ignored permission 缓存。

```powershell
rg -n "cmd_clear_all_session_window_titles|cmd_create_software_reminder_rule|cmd_delete_web_activity_segments_before|cmd_disable_software_reminder_rule" src-tauri
```

- [x] 核对 `src-tauri/build.rs` 的 `APP_COMMANDS`、`src-tauri/src/app/bootstrap.rs` 的 invoke handler 与 capability files。
- [x] 运行 `npm run check:ipc-contracts`，确认真实 frontend/backend command contract 在生成前已通过。
- [x] 使用四个精确 filter 运行 `npm run tauri -- permission ls`，保存生成前仍列出旧 permission 的证据。
- [x] 确认工作树除本计划的源码/依赖 diff 外没有生成物改动。

#### 生成

- [x] 从创建临时目录到完成幂等验证和 cleanup，始终使用同一个持久 PowerShell session；没有把进程内变量假定为跨命令或跨终端持久状态。
- [x] 为本阶段创建唯一的临时 Cargo target directory，避免既有 target cache 复用旧 ACL manifest。
- [x] 解析临时目录绝对路径，确认它位于系统 temp root 下且目录名以 `patina-schema-refresh-` 开头。
- [x] 使用以下 PowerShell 命令通过仓库固定的 Tauri CLI、`build.rs` 和 `tauri-build` 运行 schema 生成流程；首次和预热后的第二次构建暴露 ignored stale permission cache，按第 9 节处理后再次生成成功：

```powershell
$patinaTempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$patinaSchemaTarget = Join-Path $patinaTempRoot ("patina-schema-refresh-" + [guid]::NewGuid().ToString("N"))
$patinaSchemaTarget = [System.IO.Path]::GetFullPath($patinaSchemaTarget)
$patinaSchemaLeaf = Split-Path -Leaf $patinaSchemaTarget
if (-not $patinaSchemaTarget.StartsWith($patinaTempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Schema target escaped the system temp root."
}
if (-not $patinaSchemaLeaf.StartsWith("patina-schema-refresh-", [System.StringComparison]::Ordinal)) {
  throw "Unexpected schema target directory name."
}
$null = New-Item -ItemType Directory -Path $patinaSchemaTarget
Write-Output ("SCHEMA_TARGET=" + $patinaSchemaTarget)
$patinaPreviousCargoTarget = $env:CARGO_TARGET_DIR
try {
  $env:CARGO_TARGET_DIR = $patinaSchemaTarget
  npm run tauri -- build --debug --no-bundle --ci
  if ($LASTEXITCODE -ne 0) {
    throw "Tauri schema refresh build failed with exit code $LASTEXITCODE."
  }
} finally {
  if ($null -eq $patinaPreviousCargoTarget) {
    Remove-Item Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
  } else {
    $env:CARGO_TARGET_DIR = $patinaPreviousCargoTarget
  }
}
```

- [x] 把命令输出的 `SCHEMA_TARGET=<absolute path>` 写入第 9 节；PowerShell session 未丢失。
- [x] `--debug` 保持本阶段构建成本有界；`--no-bundle` 避免创建安装包和签名步骤。
- [x] 运行 `git status --short`，识别该命令产生的 tracked 与 ignored 输出。
- [x] 只审查 `src-tauri/gen/schemas/` 下的 tracked diff；build output 不进入交付范围。
- [x] 确认 schema diff 的语义仅是移除四个 stale 命令对应的 8 个 allow/deny permission 及其引用。
- 如果出现大面积纯格式、插件权限、平台 schema 或 capability 变化，停止本阶段并记录生成器版本与 diff；不得手工挑改压缩 JSON。

#### 聚焦验证

- [x] 再次运行四名称搜索，确认生成 schema 和 ignored permission cache 中不再出现旧命令。
- [x] 使用四个精确 filter 再次运行 `npm run tauri -- permission ls`，确认旧 permissions 不再列出。
- [x] 运行 `npm run check:ipc-contracts`。
- [x] 运行 `npm run check:rust`。
- [x] 在同一个持久 PowerShell session 中，重新把 `CARGO_TARGET_DIR` 临时设为同一个 `$patinaSchemaTarget`，再次运行 `npm run tauri -- build --debug --no-bundle --ci`，然后恢复原环境值；三个 schema 文件的生成前后 SHA-256 均一致。
- [x] 运行 `npm run test:tauri-runtime-smoke`，真实 Tauri/WebView2 command、event、SQLite 与 capability smoke 通过。
- [x] schema 验证结束后，再次解析 `$patinaSchemaTarget`，确认它仍位于系统 temp root 且 leaf 仍以 `patina-schema-refresh-` 开头。
- [x] 路径检查通过后使用 `Remove-Item -LiteralPath $patinaSchemaTarget -Recurse -Force` 删除临时 target directory，并确认路径不再存在。

- PowerShell session 意外退出时，先停止 Phase 6。后续 session 必须从第 9 节读取明确的 absolute target path，重新执行 temp-root 与 leaf 双重校验后才能继续或清理。

#### 验收、降级与转交

- [x] 生成结果窄幅、可解释、幂等，且不改变 capabilities 实际授予集合。
- 如果当前 Tauri 工具链无法稳定刷新 schema，本阶段标记 Blocked/Deferred，并把生成器入口、观察到的 diff 与 owner 写入第 9 节。
- 本阶段被 defer 时，High-confidence 主线可以完成实现验证，但整个计划只有在未完成工作获得明确 owner 后才能归档。

### Phase 7 — 最终引用审计、diff 审查与聚合验证

目标：证明各阶段组合后仍然只减少维护表面，没有改变行为或混入无关修改。

#### 最终引用与范围审查

- [x] 重跑 Phase 0 的候选精确搜索。
- [x] 运行 `npm run quality:exports` 和 `npm run quality:hotspots`。
- [x] 确认本次三个 unreferenced exports 已删除，十二个 internal-only exports 已删除或私有化。
- [x] 检查 `git diff --stat` 和 `git diff --numstat`；对抗式审查修复纳入后，实现范围为 16 个 tracked 文件、50 additions/154 deletions，净删 104 行。
- [x] 检查 `git diff --check`，确认没有 whitespace errors。
- [x] 逐文件阅读完整 diff，核对 owner、imports、错误传播、缓存生命周期与生成物来源。
- [x] 运行 `git status --short`，确认没有未解释的生成物、临时文件、coverage 或 build artifacts。

#### 最终验证

- [x] 运行 `npm run check`，包括 103 项浏览器 UI smoke tests 和 27/27 critical mutation score，全部通过。
- [x] 运行 `npm run check:rust`，650 项通过、1 项忽略，Clippy 无警告。
- [x] 运行 `npm run check:dependencies` 并获得有效通过报告；最终使用仓库显式离线模式。
- [x] 运行 `npm run check:full`，最终状态的 aggregate gate 完整通过。
- 如果 `check:dependencies` 因网络或 RustSec database 获取失败，记录错误与重试时间；该结果不等于通过。
- 本计划不要求 UI screenshot，因为默认范围不改变可见 UI；若实际 diff 出现 UI 变化，停止并转入 Quiet Pro 可见 UI 流程。

#### 授权与交付

- 在没有新授权时，不执行 `git add`、commit、push、tag 或 release。
- 如果后续任务明确要求 commit，先按 [`AGENTS.md`](../../AGENTS.md) 检查 staged stat/numstat、文件数与手工维护行数，再按 owner 拆分可审查 commits。
- 如果后续任务明确要求 push，重新确认当前任务、remote、branch 和精确 scope；既有授权不得沿用。

## 7. 验证矩阵

| 风险 | Focused check | Aggregate gate | 可观察通过证据 |
|---|---|---|---|
| 删除仍有消费者的入口 | 精确 `rg`；`npm run quality:exports` | `npm run check` | 目标为零引用；无新增 unreferenced/internal-only 项 |
| 改变 Tools 候选懒加载或状态排序 | 懒加载：精确引用搜索与 `useToolsPageState`/cache diff review；状态排序：`npm run test:tools` | `npm run check` | granular loaders 与 cache owners 无 diff；多 chips 既有断言通过 |
| Update provider 边界被穿透 | 精确引用搜索；`npm run check:types`；`npm run check:architecture`；`npm run build`；`test:update` 仅作邻近回归 | `npm run check` | direct import 进入 production build；provider implementation 无 diff；app owner 边界通过 |
| 私有类型导致跨模块或 declaration 错误 | `npm run check:types`；widget/settings/i18n/tools tests | `npm run build` | TypeScript 编译、相关 tests 和 production build 通过 |
| 删除依赖破坏 CSS 工具链 | `npm explain postcss`；`npm run test:release` | `npm run build && npm run check:bundle` | 无根 direct edge；Vite/Tailwind build 与预算通过 |
| 依赖安全状态未知 | `npm run check:dependencies` | `npm run check:full` | cargo/npm audit 返回有效且通过的报告 |
| 生成 schema 与真实 IPC/authority 漂移 | Tauri no-bundle build；`permission ls`；`check:ipc-contracts` | `npm run check:rust` | 纳入本次 diff 时：旧 permissions 消失、生成幂等、IPC/Rust gates 通过；defer 时：残余风险、具名 owner 和下一动作已记录 |
| 文档生命周期或链接错误 | `npm run check:docs:self-test`；`npm run check:docs`；手工链接检查 | `npm run check` | working/archive 状态唯一；链接与 UTF-8 可读 |

- [x] 每个实际变更风险都有 focused evidence；Phase 6 已纳入 diff 并获得生成、权限、IPC、Rust 和 runtime smoke 证据。
- [x] Aggregate gates 在最后一个代码或生成物改动之后执行。
- [x] 没有最终 skipped/unavailable check；在线 RustSec fetch 偏差已记录，并由有效离线报告解除。
- [x] 没有把早期阶段的通过结果当作最终状态证据；最终状态重新运行了 `check:full`。

## 8. 阶段回退规则

回退的目标是撤销当前阶段，而不是重写整个工作树。

- [x] 每个阶段开始前阅读当前 `git diff`，知道该阶段将新增哪些 hunks。
- [x] 本次没有需要回退的阶段；偏差通过同一范围内的生成缓存根因修复继续完成，没有覆盖前序改动。
- [x] 本次未使用 `HEAD` 整文件覆盖、broad restore 或 destructive reset。
- 只有在明确证明目标文件没有基线用户改动、没有前序阶段 hunks、也没有并发改动时，才允许把 `HEAD` 作为整文件内容来源。
- [x] 本次不需要恢复已删除文件；没有使用 broad reset。
- [x] `package.json`/lockfile 始终成对修改和验证。
- [x] 生成 schema 由完整生成批次产生，没有手工拼接或部分回退。
- [x] 本次无回退后复验场景；所有阶段均在最终聚合门槛中重新验证。

## 9. 偏差、阻塞与决策记录

执行期间只记录未来执行者需要的事实，不保留会话叙事或未经验证的推测。

| Date | Phase | Observed fact | Decision | Owner / next action |
|---|---|---|---|---|
| 2026-08-30 | Baseline | 审计阶段两次无法拉取 RustSec advisory database | 先记录为 Unavailable；实施阶段在线审计曾成功，最终在线重试又遇到 IO 失败 | 使用仓库支持的 `PATINA_DEPENDENCY_AUDIT_OFFLINE=1` 与已更新本地 database 取得有效最终报告；依赖 owner，无未完成动作 |
| 2026-08-30 | ACL schema | 前两次隔离 Tauri build 均未刷新 schema；`src-tauri/permissions/autogenerated/` 中存在 4 个 2026-07-28 遗留、被忽略的旧命令 TOML，生成器只新增当前文件而不删除旧文件 | 校验目录和精确文件名后只删除这 4 个可再生成缓存，再通过 `build.rs`/`tauri-build` 生成；不手改 JSON | Tauri build/command owner；已完成，并在 `build.rs` 增加生成前清理，使退出命令的旧 cache 不会在其他工作区重新污染 schema |
| 2026-08-30 | ACL schema | `SCHEMA_TARGET=C:\Users\SYBao\AppData\Local\Temp\patina-schema-refresh-72fd0a4ea4834eb9a2194766c49d938d` | 全程在同一持久 PowerShell session 复用；生成后 SHA-256 幂等，最终通过 temp-root/leaf 双重校验后递归删除 | 已清理，无后续动作 |
| 2026-08-30 | 对抗式审查 | 只删除当前工作区的 ignored stale TOML 无法保证其他长期工作区生成相同 schema；这是可复现的耐久性缺口 | 在 Tauri build owner 内于 manifest 生成前删除不属于当前 `APP_COMMANDS` 的普通 `.toml` 文件；注入 ignored stale probe 后运行构建，probe 被自动删除且 3 个 schema SHA-256 不变 | 已修复；重新通过 runtime smoke、IPC gate、Rust gate 和最终 `check:full`，无后续动作 |

- [x] 每个偏差都有日期、可复现事实、决定和后续 owner。
- [x] 未进入执行集的候选已记录不安全原因、保护边界或复核条件。
- [x] Commit、push、tag、release、Issue 与 Project mutation 均保持未执行；这些动作需要新的明确授权。

## 10. 文档与长期事实回写

本计划预计不改变任何长期规则，因此默认不修改顶层 `docs/`。如果实施证明长期事实已经变化，必须更新真实 owner，而不是把新规则永久留在本文。

- [x] 产品范围仍由 [`product-principles-and-scope.md`](../product-principles-and-scope.md) 持有。
- [x] 优先级与 stable-period 取舍仍由 [`roadmap-and-prioritization.md`](../roadmap-and-prioritization.md) 和 [`issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md) 持有。
- [x] 架构 owner 与允许依赖方向仍由 [`architecture.md`](../architecture.md) 持有。
- [x] 验证命令与风险覆盖仍由 [`engineering-quality.md`](../engineering-quality.md) 和 [`package.json`](../../package.json) 持有。
- [x] 兼容退出、版本与 release 规则仍由 [`versioning-and-release-policy.md`](../versioning-and-release-policy.md) 持有。
- [x] 本次没有把候选符号清单、审计工具输出或本地 agent workflow 提升为长期 repository policy。
- [x] 归档移动后运行 `npm run check:docs:self-test` 和 `npm run check:docs`，均通过。
- [x] 归档移动后验证本文为 UTF-8 无 BOM、标题层级连续、6 个代码 fence 成对闭合、34 个相对链接有效。

## 11. 完成与归档门

### 11.1 实现完成

- [x] Phase 0 至 Phase 5 以及 Phase 7 的所有适用项均已完成。
- [x] Phase 6 已完成，没有 defer。
- [x] 所有非适用项都有理由，不留无法解释的空 checkbox。
- [x] 最终 diff 只包含本文范围内的源码、manifest、lockfile、允许的生成物和计划状态变更。
- [x] 已纳入本次 diff 的 validation matrix 行全部通过。
- [x] `check:dependencies` 等本次实际改动的必需验证已经补齐，不再有未接受的 Unavailable 结果。
- [x] 没有未授权的 commit、push、tag、release、Issue 或 Project mutation。

### 11.2 文档完成

- [x] 将 Status 更新为 `Complete`，并更新 Last updated。
- [x] 将 `Working-plan owner: docs/working/` 改为 `Archive owner: docs/archive/`。
- [x] 将 Lifecycle 改为“已完成的一次性执行历史；不再是当前执行依据，也不是长期规则 owner”。
- [x] 把第 0 节和第 2.1 节中“本文是当前 working basis”一类当前时态陈述改为完成后的历史事实。
- [x] 在第 12 节写入实际交付结果、验证结果、批准偏差、残余风险与真实 owner。
- [x] 确认长期规则没有变化，并明确记录“无需长期文档更新”。
- [x] 将本文从 `docs/working/` 移动到 `docs/archive/`，没有保留 working 副本。
- [x] 移动后重新验证全部 34 个相对链接，缺失数为 0。
- [x] 移动后运行 `npm run check:docs:self-test`、`npm run check:docs` 和 `git diff --check`，均通过。
- [x] 确认 `docs/working/` 为空，不再把已完成计划当作当前执行依据。

### 11.3 对抗式审查完成

- [x] 在任务完成并首次归档后，从“另一长期工作区、旧 ignored cache 仍存在”的反例重新审查 schema 生成链。
- [x] 识别并修复 1 个耐久性问题：当前工作区的一次性缓存删除不能保证其他工作区生成结果收敛。
- [x] 用 ignored stale permission probe 验证构建入口会自动删除退出命令缓存，同时保持 3 个 tracked schema 的 SHA-256 不变。
- [x] 修复后重新运行真实 Tauri runtime smoke、IPC/Rust focused gates 和完整 `npm run check:full`，全部通过。
- [x] 第二轮逐文件 diff 复审没有发现仍需处理的 actionable finding。

## 12. 完成记录

以下记录描述归档时的实际交付与验证结果。

### Delivered

- 删除 2 个零消费者聚合函数、1 个聚合结果接口、1 个单状态芯片 wrapper 和 1 个一行 update hook 转发文件；唯一 consumer 直接引用同一 app owner 的 provider。
- 将 11 个 internal-only 声明改为模块私有；没有新增 suppression、barrel 或 compatibility shell。
- 从 `package.json` 和 lockfile 移除根级 `postcss` direct edge；Vite 传递依赖继续保留。
- 删除 4 个 ignored stale autogenerated permission TOML，并通过 `build.rs`/`tauri-build` 刷新 3 个 tracked schema；移除 4 个旧命令对应的 8 个 allow/deny permission，无新增 permission。对抗式审查后，`build.rs` 会在 manifest 生成前自动清理已退出命令的旧生成权限文件。
- 实现范围共 16 个 tracked 文件、50 additions/154 deletions，净删 104 行；归档计划文档不计入该实现净删量。

### Validation

- Focused checks 全部通过：`test:tools`、`test:update`、`test:widget`、`test:i18n`、`test:settings`、`test:release`、`check:types`、`check:architecture`、`check:ipc-contracts`、`build`、`check:bundle`。
- `npm run test:tauri-runtime-smoke` 通过真实 Tauri/WebView2 command、event、SQLite 与 capability smoke。
- `npm run check` 通过，包括 103 项浏览器 UI smoke tests、27/27 critical mutation score、production build 与 bundle budget。
- `npm run check:rust` 通过：650 项通过、1 项忽略，Clippy 无警告。
- `npm run check:dependencies` 通过：0 个 Windows 可达 Rust 漏洞、3 个精确 lock-only advisory 验证不可达、npm 0 漏洞；最终报告使用仓库显式离线模式。
- `npm run check:full` 在对抗式审查修复后的最终状态完整通过。
- 最终 `quality:exports` 为 `internal-only=0`、`test-only=103`、`unreferenced=0`；`quality:hotspots` 为 advisory 且没有新增执行候选。

### Approved deviations

- Tauri schema 首次与预热后的第二次隔离构建未刷新；根因是 4 个 ignored stale autogenerated permission TOML。删除精确缓存后由 owner 生成流程成功刷新并证明幂等；对抗式审查进一步把清理逻辑固化在 Tauri build owner，并用回归 probe 验证。
- 最终在线 RustSec fetch 曾因 GitHub IO 失败；使用仓库支持的显式离线模式和同日已成功更新的本地 advisory database 取得有效最终报告。

### Residual risks and owners

- 无已接受残余风险。真实 Tauri runtime smoke、最终 aggregate gates 与依赖审计均已通过。

### Durable owners

- 无需更新顶层长期文档；产品、架构、验证、兼容和发布规则均未改变，继续由第 10 节列出的现有 owner 持有。
- 归档后的本文只保留执行历史，不作为未来规则来源。
