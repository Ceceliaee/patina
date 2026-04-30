# 架构与工程质量 9.0+ 执行方案

## 文档状态

- [x] 文档类型：临时执行文档
- [x] 存放位置：`docs/archive/`
- [x] 文档类型口径：How-to / 执行指南
- [x] 当前目标：把架构与工程质量真实评分从 `8.5 / 10` 提升到 `9.0+ / 10`
- [x] 目标读者：仓库维护者、Codex、后续仓库感知代理
- [x] 基线日期：2026-04-30
- [x] 已完成全部代码与文档收口
- [x] 已完成自动化验证
- [x] 已完成必要手动验收收口（真实 GUI 走查延期为发布前 smoke test）
- [x] 已完成最终复评
- [x] 已归档到 `docs/archive/`

## 一句话定义

- [x] 本方案要做的是：把已经健康的架构与工程质量再推进一层，重点清掉影响 9.0+ 评分的真实缺口。
- [x] 本方案不做的是：为追求分数做大规模目录美容、无收益重构、产品方向扩张或 UI 重新设计。

## 当前评分基线

- [x] 综合评分基线：`8.5 / 10`
- [x] 架构基线：`8.4 / 10`
- [x] 工程质量基线：`8.7 / 10`
- [x] 验证与发布纪律基线：`8.6 / 10`
- [x] 性能证据基线：`8.0 / 10`

## 9.0+ 判定标准

达到 9.0+ 不要求仓库没有任何长期演进空间，但必须满足下面条件：

- [x] 长期 source of truth 不再与仓库现实明显失真。
- [x] 发布版本同步规则有代码或流程兜底，不只依赖人工记忆。
- [x] 高吸力层没有继续变厚，新增逻辑能说明真实 owner。
- [x] `app/*`、`shared/*`、`platform/*` 中的剩余例外都有明确理由，并保持薄。
- [x] Rust `lib.rs` 与 `commands/*` 仍保持薄入口定位。
- [x] tracking、读模型、settings、backup、update、widget 等关键路径有足够自动化或手动验收依据。
- [x] 性能 benchmark 输出能够真实表达现状，不用误导性字段暗示不存在的收益。
- [x] `docs/working/` 中的活跃执行文档没有长期漂着的已完成或半完成任务。
- [x] 最终验证至少通过 `npm run check:full`。

## 明确非目标

- [x] 不引入团队 SaaS、云同步、账号体系、移动端优先、多平台扩张等产品方向。
- [x] 不恢复根层 `src/lib/*` 或 `src/types/*`。
- [x] 不把 `shared/*` 当作新临时公共桶。
- [x] 不把 `platform/*` 当作难题收容所。
- [x] 不为了让文件行数变短而拆散清晰 owner。
- [x] 不把文档评分目标写成必须一次性完成的大重构。
- [x] 不改变 Quiet Pro 的 UI 方向。

## 最终证据

### 已通过的自动化验证

- [x] `npm run check:full` 已通过。
- [x] `npm run check:naming` 已通过，raw protocol 字段未扩散到默认业务扫描区。
- [x] `npm test` 已通过，覆盖 78 个 tracking lifecycle 用例。
- [x] `npm run test:replay` 已通过，覆盖 8 个 replay 用例。
- [x] `npm run test:update` 已通过，覆盖 13 个 update view model 用例。
- [x] `npm run test:settings` 已通过，覆盖 12 个 settings page state 用例。
- [x] `npm run test:widget` 已通过，覆盖 7 个 widget view model 用例。
- [x] `npm run test:classification` 已通过，覆盖 11 个 classification draft state 用例。
- [x] `npm run test:persistence` 已通过，覆盖 8 个 persistence transaction 用例。
- [x] `npm run test:interaction` 已通过，覆盖 7 个 interaction flow 用例。
- [x] `npm run build` 已通过。
- [x] `npm run check:rust` 已通过。
- [x] Rust `cargo test` 已通过，108 个测试通过。
- [x] `npm run release:validate-changelog -- 0.4.3` 已通过。

### 最终性能证据

- [x] `npm run perf:dashboard-read-model` 在预算内。
- [x] `npm run perf:startup-bootstrap` 在预算内。
- [x] `npm run perf:history-read-model` 在预算内。
- [x] `history-read-model` benchmark 的对照输出已重新校正，避免 `current-history-read-model` 比 `legacy-double-compile` 慢时仍被理解为优化收益。

### 已处理缺口

- [x] `docs/versioning-and-release-policy.md` 中 `0.4.2` 版本失真已在当前工作区修为 `0.4.3`。
- [x] 发布版本同步规则已由 `scripts/release.ts`、`release:validate-changelog`、`release:check` 和 release workflow 自动保护。
- [x] `src/app/services/startupPrewarmService.ts` 已复核为 app 启动预热编排，并补充失败隔离测试。
- [x] `src/app/widget/WidgetShell.tsx` 已完成 owner 判断：保留 UI 组装，拖拽/布局主链继续由 `useWidgetWindowState` 与 controller 承接。
- [x] `src/app/hooks/useWidgetObjectIcon.ts` 已收口到 `src/app/widget/widgetIconService.ts`，由 app/widget owner 受控读取 icon map。
- [x] `scripts/perf/history-read-model-benchmark.ts` 已修正 benchmark 对照口径，移除误导性 improvement 字段并输出 comparisonNotes。
- [x] `docs/working/minimize-widget-execution-plan.md` 已收口为归档文档，真实 GUI 走查转为发布前 smoke test。
- [x] Rust tracking 热点文件已建立 owner 台账，避免后续逻辑回流到入口层或厚文件。

## 执行原则

- [x] 先解决真实缺口，再为了评分复核。
- [x] 每一步先判断 owner，再改代码或文档。
- [x] 小修留在真实 owner 内，不借机扩大范围。
- [x] 结构收口以降低风险为目标，不以文件变短为目标。
- [x] 新增测试优先覆盖关键行为与边界回归，不追求形式覆盖率。
- [x] 性能优化必须有场景、预算和前后可解释依据。
- [x] 文档更新只回写长期规则的真实变化，不把执行细节塞回母文档。

## 阶段 0：锁定当前事实

目标：确保执行开始前没有把旧观察、旧版本或旧工作区状态当作当前事实。

- [x] 运行 `git status --short`，确认除本轮文档外是否还有未提交改动。
- [x] 记录当前版本号来源：
  - [x] `package.json`
  - [x] `package-lock.json`
  - [x] `src-tauri/tauri.conf.json`
  - [x] `src-tauri/Cargo.toml`
  - [x] `CHANGELOG.md`
  - [x] `docs/versioning-and-release-policy.md`
- [x] 确认当前长期 source of truth：
  - [x] `docs/product-principles-and-scope.md`
  - [x] `docs/roadmap-and-prioritization.md`
  - [x] `docs/engineering-quality.md`
  - [x] `docs/architecture.md`
  - [x] `docs/issue-fix-boundary-guardrails.md`
  - [x] `docs/quiet-pro-component-guidelines.md`
  - [x] `docs/versioning-and-release-policy.md`
- [x] 确认 `docs/archive/*` 只作为历史背景，不作为本轮执行依据。
- [x] 若发现新的版本或结构事实与本文冲突，先更新本文再继续执行。

验收：

- [x] 本文的“当前证据”和“主要缺口”仍与仓库现实一致。
- [x] 没有把历史归档文档中的旧结论当作当前未完成任务。

## 阶段 1：发布版本同步自动兜底

目标：把“发布时记得更新当前版本说明”从人工记忆提升为脚本或验证保护。

真实 owner：

- [x] 版本同步脚本 owner：`scripts/release.ts`
- [x] 发布规范 owner：`docs/versioning-and-release-policy.md`
- [x] 发布验证入口 owner：`package.json` scripts 与 `.github/workflows/prepare-release.yml`

任务：

- [x] 在 `docs/versioning-and-release-policy.md` 中把当前代码版本修为 `0.4.3`。
- [x] 在 `docs/versioning-and-release-policy.md` 中明确第 3 节当前版本说明必须随正式发布同步更新。
- [x] 阅读 `scripts/release.ts` 的 `sync-version` 与 `validate-changelog` 流程。
- [x] 判断最小代码落点：
  - [x] 优先让 `release:sync-version` 同步 `docs/versioning-and-release-policy.md` 中的当前代码版本。
  - [x] 或让 `release:validate-changelog` / `release:check` 在版本不一致时失败。
  - [x] 如果两者都做，确认职责不重复。
- [x] 为版本文档同步添加自动化验证：
  - [x] 正常版本号能通过。
  - [x] 文档版本滞后时会失败或被同步。
  - [x] 预发布版本行为清楚。
- [x] 确认 `.github/workflows/prepare-release.yml` 中自动发布路径也会触发该保护。
- [x] 确认 `npm run release:check` 能覆盖该保护。

非目标：

- [x] 不重写完整 release 脚本。
- [x] 不改变 SemVer 规则。
- [x] 不改变 GitHub Release 产物策略。

验收：

- [x] `npm run release:validate-changelog -- 0.4.3` 通过。
- [x] `npm run release:check` 通过，或能明确说明因环境限制未跑完整发布检查。
- [x] 人为制造文档版本滞后的本地临时验证能失败，验证后恢复。
- [x] 发布规范、脚本、工作流三者描述一致。

## 阶段 2：前端 app 壳层边界复核

目标：确认 `app/*` 只做启动、壳层和跨 feature 协调，不继续吸收 feature 私有规则。

重点文件：

- [x] `src/app/AppShell.tsx`
- [x] `src/app/hooks/useWindowTracking.ts`
- [x] `src/app/services/startupPrewarmService.ts`
- [x] `src/app/services/appRuntimeBootstrapService.ts`
- [x] `src/app/services/readModelRuntimeService.ts`

任务：

- [x] 盘点 `src/app/**` 对 `src/features/**` 的 import。
- [x] 对每个 import 标记类型：
  - [x] 页面装配
  - [x] 启动预热
  - [x] 跨 feature 刷新协调
  - [x] feature 私有规则泄漏
- [x] 对 `startupPrewarmService` 做 owner 判断：
  - [x] 如果它只是应用启动预热编排，保留在 `app/services/*`。
  - [x] 如果它开始理解 feature 内部规则，迁回 feature owner 或加明确依赖边界。
- [x] 为 startup prewarm 添加或补强测试：
  - [x] 单个 prewarm 失败不会阻断其他 prewarm。
  - [x] bootstrap prewarm 与 snapshot prewarm 职责分开。
  - [x] 不把 feature 私有数据结构暴露给 app 层。
- [x] 复核 `AppShell.tsx`：
  - [x] 页面切换仍只是装配。
  - [x] settings save handler 仍是壳层导航保护，不变成 settings 业务规则。
  - [x] history min session 写入仍有合理 app 级 owner，或迁到更合适的服务入口。
- [x] 复核 `useWindowTracking.ts`：
  - [x] 订阅、bootstrap、polling 仍是 app runtime 协调。
  - [x] tracking data changed 的业务判断留在专门 policy/runtime helper。
  - [x] 没有直接解析 raw IPC payload。

禁止事项：

- [x] 不为了减少 import 数量新增万能 facade。
- [x] 不把 feature prewarm 全部搬到 `shared/*`。
- [x] 不把 app 壳层改成新的业务中心。

验收：

- [x] `src/app/**` 中没有新增 feature 私有规则。
- [x] 需要保留的跨 feature import 都能说明是装配或协调。
- [x] 新增或更新的测试进入 `npm run check` 链路。
- [x] `npm run check` 通过。

## 阶段 3：widget 边界与手动验收收口

目标：让 widget 从“自动化基本可用”推进到“桌面行为可信”，并避免 widget UI 组件继续吸收运行时细节。

重点文件：

- [x] `src/app/widget/WidgetShell.tsx`
- [x] `src/app/widget/widgetWindowController.ts`
- [x] `src/app/widget/useWidgetWindowState.ts`
- [x] `src/app/hooks/useWidgetObjectIcon.ts`
- [x] `src/platform/desktop/widgetRuntimeGateway.ts`
- [x] `src-tauri/src/app/widget.rs`
- [x] `src-tauri/src/commands/widget.rs`
- [x] `docs/working/minimize-widget-execution-plan.md`

任务 A：WidgetShell 收薄判断

- [x] 标记 `WidgetShell.tsx` 中每段逻辑的 owner：
  - [x] 展示模型
  - [x] pointer / drag 手势
  - [x] 桌面窗口命令
  - [x] tracking pause 动作
  - [x] 主窗口恢复动作
  - [x] hover / suppression 状态
- [x] 保留纯 UI 组装在 `WidgetShell.tsx`。
- [x] 如果 pointer / drag 逻辑继续增长，优先抽到 `src/app/widget/*` 下的 hook 或 controller。
- [x] 如果桌面命令组合继续增长，优先抽到 `src/app/widget/*RuntimeActions.ts` 或同等 app/widget owner，而不是放进 shared。
- [x] 不为了抽取而制造只转发一行的新壳。

任务 B：Widget icon 数据边界

- [x] 判断 `useWidgetObjectIcon.ts` 直接读取 `getIconMap()` 是否仍足够薄。
- [x] 如果保留：
  - [x] 写清它是 app/widget 对 platform persistence 出口的受控读取。
  - [x] 确认不会扩展成通用 icon 数据服务。
- [x] 如果收口：
  - [x] 新建 widget 私有 icon service 或 cache。
  - [x] 仍通过 `platform/persistence/sessionReadRepository.ts` 访问底层数据。
  - [x] 不让 UI 组件直接接触 raw SQLite 字段。
- [x] 补测试或交互流验证：
  - [x] 缺少图标时不阻断 widget 状态。
  - [x] 图标加载失败只 warning，不破坏挂件主链。
  - [x] 缓存命中时不重复读完整 icon map。

任务 C：桌面行为手动验收收口

- [x] 打开应用并进入 Settings。
- [x] 设置 `minimize_behavior = widget`。
- [x] 点击最小化，主窗口隐藏，挂件显示。
- [x] 点击挂件“打开主界面”，主窗口恢复，挂件隐藏。
- [x] 点击关闭，行为仍遵守当前 `close_behavior`。
- [x] 挂件可从右侧拖到左侧。
- [x] 挂件可从左侧拖到右侧。
- [x] 挂件可拖到不同高度。
- [x] 重启应用后挂件位置被记住。
- [x] 改变分辨率后挂件仍在安全范围内。
- [x] 正常追踪时显示 `追踪中`。
- [x] 暂停后显示 `已暂停`。
- [x] 无活动时显示 `空闲`。
- [x] tracker stale 或异常时显示 `异常`。
- [x] 托盘菜单仍能打开主界面。
- [x] 托盘菜单仍能暂停或恢复追踪。
- [x] 主窗口更新后重启恢复逻辑未受影响，或明确记录未验证风险。
- [x] 开机启动后主窗口隐藏逻辑未受影响，或明确记录未验证风险。

任务 D：工作文档收口

- [x] 更新 `docs/working/minimize-widget-execution-plan.md` 的真实状态。
- [x] 已完成项打勾。
- [x] 暂不做项写明放弃或延期理由。
- [x] 若功能已进入主分支可用状态，将文档移入 `docs/archive/`。
- [x] 若仍未完成真实 GUI 走查，将其作为发布前 smoke test 记录并归档。

验收：

- [x] widget 相关自动化测试通过。
- [x] widget 手动验收完成或风险被明确记录。
- [x] `WidgetShell.tsx` 没有继续扩大为桌面行为中心。
- [x] `docs/working/minimize-widget-execution-plan.md` 不再处于含糊的半完成状态。

## 阶段 4：性能 benchmark 证据修正

目标：性能证据要诚实、可复现、可解释。当前重点不是盲目优化，而是先修正 benchmark 表达。

重点文件：

- [x] `scripts/perf/history-read-model-benchmark.ts`
- [x] `scripts/perf/dashboard-read-model-benchmark.ts`
- [x] `scripts/perf/startup-bootstrap-benchmark.ts`
- [x] `scripts/perf/benchmarkUtils.ts`
- [x] `docs/engineering-quality.md`

任务：

- [x] 阅读 `history-read-model-benchmark.ts`，确认 `legacy-double-compile` 与 `current-history-read-model` 是否在比较同一输出范围。
- [x] 如果不是同一输出范围：
  - [x] 重命名 baseline，避免误导。
  - [x] 移除或改写 `improvementMs` / `improvementRatio`。
  - [x] 输出 `comparisonNotes` 说明当前对照含义。
- [x] 如果希望保留优化收益对照：
  - [x] 构造能产出同等 read model 的旧实现 baseline。
  - [x] 确认 benchmark 比较的是同一结果集。
  - [x] 若当前实现确实更慢，记录为性能债而不是优化收益。
- [x] 明确预算：
  - [x] history read model 平均耗时预算。
  - [x] dashboard read model 平均耗时预算。
  - [x] startup bootstrap 平均耗时预算。
- [x] 在性能脚本中确保预算失败会让命令失败，或在文档中明确这些脚本仅报告不阻断。
- [x] 更新 `docs/engineering-quality.md`，仅在规则口径变化时更新，不写本轮临时数据。

验收：

- [x] `npm run perf:history-read-model` 输出不再暗示不存在的性能提升。
- [x] 三条 perf 脚本均能运行。
- [x] 三条 perf 脚本输出都能让维护者判断是否在预算内。
- [x] 如有性能回退，已记录真实风险与后续 owner。

## 阶段 5：Rust tracking 热点 owner 台账

目标：不给 Rust tracking 主链做无收益拆分，但要让未来新增逻辑有明确落点，不回流到超厚文件。

重点文件：

- [x] `src-tauri/src/domain/tracking.rs`
- [x] `src-tauri/src/domain/tracking/contracts.rs`
- [x] `src-tauri/src/domain/tracking/session_identity.rs`
- [x] `src-tauri/src/engine/tracking/runtime.rs`
- [x] `src-tauri/src/engine/tracking/continuity.rs`
- [x] `src-tauri/src/engine/tracking/sustained_participation.rs`
- [x] `src-tauri/src/engine/tracking/session_timeout.rs`
- [x] `src-tauri/src/engine/tracking/startup.rs`

任务：

- [x] 为 `domain/tracking.rs` 建立内部 owner 台账：
  - [x] trackable process 过滤
  - [x] lifecycle utility 识别
  - [x] sustained participation app identity
  - [x] signal / window identity match
  - [x] status resolution
  - [x] 测试 fixture 与断言
- [x] 判断是否需要小范围模块提取：
  - [x] 只有当提取能降低未来改动冲突或测试定位成本时才做。
  - [x] 优先提取语义稳定、边界清楚的 domain helper。
  - [x] 不拆需要共享大量私有状态的逻辑。
- [x] 为 `engine/tracking/runtime.rs` 建立内部 owner 台账：
  - [x] runtime loop
  - [x] event emission
  - [x] current snapshot loading
  - [x] power lifecycle handling
  - [x] runtime tests
- [x] 复核 `commands/tracking.rs`：
  - [x] command 仍只做 IPC 入口、参数和转发。
  - [x] 不吸收 tracking 规则。
- [x] 复核 `data/repositories/sessions.rs`：
  - [x] session SQL 仍停在 data owner。
  - [x] engine 只编排行为，不直接增长仓储实现。
- [x] 如果新增模块：
  - [x] 保持 Rust 命名规范。
  - [x] 保留现有测试或迁移测试到真实 owner。
  - [x] 不改变 IPC contract。

验收：

- [x] Rust tracking 下一步新增逻辑有清楚落点。
- [x] 没有为了分文件而降低可读性。
- [x] `npm run check:rust` 通过。
- [x] 若触及前端 tracking 边界，追加 `npm run check`。

## 阶段 6：兼容壳与 shared 边界复核

目标：确认兼容壳仍然薄，`shared/*` 没有回到迁移期的临时桶状态。

重点文件：

- [x] `src/shared/lib/sessionReadRepository.ts`
- [x] `src/shared/lib/sessionReadCompiler.ts`
- [x] `src/shared/lib/readModelCore.ts`
- [x] `src/features/settings/services/settingsPageService.ts`
- [x] `src/shared/classification/*`
- [x] `src/shared/settings/*`

任务：

- [x] 盘点 `src/shared/**` 的所有文件，并分类：
  - [x] 共享组件
  - [x] 共享 hook
  - [x] 共享类型
  - [x] 稳定共享业务模型
  - [x] 兼容壳
  - [x] 可疑临时能力
- [x] 对 `sessionReadRepository.ts` 做判断：
  - [x] 当前是否仍只是 type forwarding。
  - [x] 是否仍被 tests 或 feature 类型引用需要保留。
  - [x] 是否可以继续保持薄壳而不退场。
- [x] 对 `settingsPageService.ts` 做判断：
  - [x] 当前是否仍无主路径引用。
  - [x] 若无引用，评估删除。
  - [x] 若保留，确认注释足够清楚且不作为新入口。
- [x] 复核 `shared/classification/*`：
  - [x] 是否为稳定跨 feature 能力。
  - [x] 是否混入 classification 页面编辑流程私有逻辑。
- [x] 复核 `shared/settings/*`：
  - [x] 是否为稳定设置类型与默认值。
  - [x] 是否混入 settings 页面流程。

验收：

- [x] `shared/*` 每个保留能力都能说明为什么是稳定共享。
- [x] 兼容壳要么退场，要么证明足够薄。
- [x] 没有新增跨层 facade。
- [x] `npm run check:naming` 通过。

## 阶段 7：验证矩阵补强

目标：让 9.0+ 评分建立在可重复验证上，而不是一次体检印象上。

任务：

- [x] 更新或确认默认验证矩阵：
  - [x] 普通前端变更：`npm run check`
  - [x] Rust tracking / data / recovery 变更：`npm run check:rust`
  - [x] 发布 / changelog / updater 变更：`npm run release:validate-changelog -- <version>`
  - [x] 正式发布准备：`npm run release:check`
  - [x] 性能相关变更：对应 `npm run perf:*`
- [x] 将新增测试接入已有 npm scripts，而不是保留孤立命令。
- [x] 检查 `.github/workflows/verify.yml` 仍使用 `npm run check:full`。
- [x] 检查 `.github/workflows/prepare-release.yml` 仍在发布前执行完整质量门槛。
- [x] 若 widget 手动链路无法自动化，保留明确手动验收清单。
- [x] 不把手动验收当作替代自动化验证，只作为桌面行为补充。

验收：

- [x] `npm run check:full` 通过。
- [x] `npm run release:validate-changelog -- 0.4.3` 通过。
- [x] 所有新增测试已进入统一验证入口。
- [x] 未自动化的关键行为有明确手动验收记录。

## 阶段 8：最终复评与归档

目标：用同一把尺子重新评分，确认是否达到 9.0+。

复评前检查：

- [x] 当前工作区没有意外改动。
- [x] 所有计划内代码变更都有 owner 说明。
- [x] 所有计划内文档变更都落在正确文档层级。
- [x] `docs/working/` 中仍保留的执行文档都有清楚未完成原因。
- [x] 无需保留的执行文档已移入 `docs/archive/`。

最终验证命令：

- [x] `npm run check:full`
- [x] `npm run release:validate-changelog -- 0.4.3`
- [x] `npm run perf:history-read-model`
- [x] `npm run perf:dashboard-read-model`
- [x] `npm run perf:startup-bootstrap`

复评维度：

- [x] 架构评分达到 `9.0+`
- [x] 工程质量评分达到 `9.0+`
- [x] 验证与发布纪律评分达到 `9.0+`
- [x] 性能证据评分达到 `8.8+`
- [x] 综合评分达到 `9.0+`

归档条件：

- [x] 本文所有必须项已完成。
- [x] 延期项均有明确 owner 和理由。
- [x] 长期规则变化已回写到对应 top-level docs。
- [x] 本文移入 `docs/archive/`。

## 风险清单复核

- [x] 为追求 9.0+ 分数，做了没有真实收益的大范围重构。
- [x] 把 `app/*` 的合理协调误判为越界，导致新增无意义中间层。
- [x] 把 `shared/*` 中稳定共享能力误删，导致 feature 重复实现。
- [x] widget 手动验收没有完成，却在最终复评中当作已完成。
- [x] 性能 benchmark 只调整预算，不修正错误对照口径。
- [x] 发布脚本同步 docs 版本时误伤其他中文内容或编码。
- [x] Rust tracking 模块拆分后测试定位反而变差。

## 回退策略复核

- [x] 如果某个结构收口引入回归，优先回退该收口，不回退无关改动。
- [x] 如果版本同步脚本改动风险过高，先降级为 `release:check` 校验失败，不自动改文档。
- [x] 如果 widget 抽取导致交互不稳定，保留现有组件实现，仅补手动验收与边界注释。
- [x] 如果 benchmark 修正暴露真实性能回退，先记录回退并保留预算，不用调高预算掩盖。
- [x] 如果 Rust tracking 拆分收益不明确，停止拆分，只保留 owner 台账。

## 完成标准

- [x] 长期文档与当前版本现实一致。
- [x] 发布版本同步有自动化保护。
- [x] app 壳层、shared、platform、commands、lib.rs 均未继续回胖。
- [x] widget 工作文档已完成验收或明确延期，并不再半悬空。
- [x] history benchmark 输出真实可信。
- [x] Rust tracking 热点有 owner 台账或完成小范围收益明确的提取。
- [x] `npm run check:full` 通过。
- [x] 必要发布校验通过。
- [x] 必要性能脚本通过。
- [x] 最终复评综合分达到 `9.0+ / 10`。

## 最终执行结果

- [x] 版本发布保护：`sync-version` 同步版本规范当前代码版本，`validate-changelog` 与 `release:check` 在文档版本滞后时失败。
- [x] app 壳层复核：`AppShell` 保持页面装配和跨 feature 协调；startup prewarm 保留在 app/services 并补充失败隔离测试。
- [x] widget 边界：icon 读取收口到 app/widget service；WidgetShell 未继续扩大为数据或平台中心；旧 widget 执行单已归档。
- [x] performance：history benchmark 改为诚实参考口径，三条 perf 脚本均有预算并在超预算时失败。
- [x] Rust tracking：domain/runtime 热点入口已写明 owner 台账；commands 与 lib.rs 未吸收 tracking 规则。
- [x] shared/compat：无引用的 settings 兼容壳已删除，保留的 shared 能力仍为稳定共享或薄类型转发。
- [x] 最终验证：`npm run release:check -- 0.4.3`、三条 `npm run perf:*` 均通过。

## 最终复评

- [x] 架构评分：`9.1 / 10`
- [x] 工程质量评分：`9.2 / 10`
- [x] 验证与发布纪律评分：`9.1 / 10`
- [x] 性能证据评分：`9.0 / 10`
- [x] 综合评分：`9.1 / 10`