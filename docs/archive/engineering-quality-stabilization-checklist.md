# 工程质量稳定期长期执行清单

## 1. 文档定位

本文是 `Time Tracker` 在当前稳定期使用的工程质量长期执行清单。

它服务于：

- [`../engineering-quality-target.md`](./engineering-quality-target.md)
- [`../code-quality-target.md`](./code-quality-target.md)
- [`../performance-target.md`](./performance-target.md)
- [`../reliability-and-validation-target.md`](./reliability-and-validation-target.md)
- [`../architecture.md`](../architecture.md)

它不是长期母文档，也不是纯说明文，而是一份可以逐项勾选、逐阶段推进、最终归档的执行清单。

它的作用是：

- 把“工程质量提升”拆成可落地的阶段任务
- 让仓库维护者随时知道当前推进到哪一阶段
- 让后续 Codex / GPT 协作者可以直接按清单推进，而不是每次重做全局判断
- 为后续沉淀长期 `engineering-quality.md` 母文档积累真实规则

本文当前已完成文档化收口。
后续仍保留未勾选项，表示真实尚未落地的工程工作，而不表示本文还有待补写的文档空缺。

如果本文与长期规则文档冲突，以 [`../architecture.md`](../architecture.md) 和 [`../engineering-quality-target.md`](./engineering-quality-target.md) 为准；本文应随之更新。

---

## 2. 使用方式

### 2.1 勾选规则

每个任务只有在下面条件都满足时才可以勾选：

- 代码已经落地
- 相关导入、调用路径、目录落点或脚本入口已经收口
- 没有引入新的边界回流
- 对应的最低验证已经完成
- 如有必要，相关文档也已经同步

### 2.2 执行粒度

本文故意把任务拆小。

默认原则是：

- 一次任务尽量只推进一个小阶段
- 一次任务尽量只解决一个清楚的质量问题
- 先补基线和保护，再做高风险整理
- 先解决真实热点，再解决普遍整洁
- 先保证可靠，再追求更快

### 2.3 允许调整

本文中的目标落点和建议文件，不是机械搬运规则，而是“推荐 owner 与推荐顺序”。

如果执行过程中发现：

- 更小的安全切分路径
- 更合适的 owner
- 更自然的 feature 边界
- 更适合前置的低风险工作

可以调整实现方式，但不要改变本清单的整体方向。

### 2.4 何时回写文档状态

出现下面情况时，应及时更新本文，而不是等很多轮之后一起回写：

- 某个阶段已经明显完成
- 某个热点已经自然收口
- 某个默认验证门槛发生变化
- 某个热点 owner 判断已经改变
- 某个阶段需要被拆成新的专项执行单

### 2.5 完成判断

“完成当前稳定期的工程质量执行”不等于仓库已经完美，而是至少满足：

- 仓库已经建立统一质量 gate
- 关键可靠性热点已经有硬保护
- 关键代码质量热点已经完成首轮有效收口
- 性能讨论已经建立在统一口径上
- 团队已经积累出足够稳定的长期规则

如果后续只剩未勾选工程项需要逐步落地，本文仍应视为“完成态执行台账”，而不是“待继续补写的草稿文档”。

---

## 3. 当前阶段快照

下面这些事项已经基本成立，可以视为当前已完成的基础盘：

- [x] 已有工程质量总览文档 [`../engineering-quality-target.md`](./engineering-quality-target.md)
- [x] 已有三份专项长期目标文档：代码质量、性能、可靠性与验证
- [x] 已有当前 working 执行清单，可作为阶段性执行载体
- [x] 已有基础验证脚本：`npm test`、`npm run test:replay`、`npm run build`
- [x] 当前仓库已有长期架构母规则 [`../architecture.md`](../architecture.md)
- [x] 当前仓库已完成一轮较大规模的结构迁移，主要边界已比过去清晰

下面这些事项是当前仍未完成的关键工程质量里程碑：

- [x] 仓库有统一的工程质量检查入口，例如 `npm run check`
- [x] 已形成“改哪类风险，就默认跑哪组验证”的统一矩阵
- [x] tracking 主链的关键不变量已被文档化并映射到验证动作
- [x] backup / restore / cleanup 的数据边界风险已有更明确的默认验证
- [x] `AppMapping.tsx`、`Settings.tsx`、`sessionReadCompiler.ts`、`runtime.rs`、`trackingLifecycle.test.ts` 等热点已有明确收口计划
- [x] 性能讨论已有统一口径，而不是只凭主观感觉
- [x] 当前执行已具备评估是否沉淀长期 `engineering-quality.md` 的条件；当前判断为“可整理提纲与素材，但不进入正式收口起草”

### 3.1 当前默认高风险区

下面这些位置默认视为当前稳定期高风险区。
这一节用于固定风险登记与关注名单，不在此处勾选；具体收口动作与验收应在后续阶段条目中完成。

- `src/features/classification/components/AppMapping.tsx`
- `src/features/settings/components/Settings.tsx`
- `src/shared/lib/sessionReadCompiler.ts`
- `src/app/services/*`
- `src-tauri/src/engine/tracking/runtime.rs`
- `tests/trackingLifecycle.test.ts`
- `src-tauri/src/app/*`
- `src-tauri/src/commands/*`

### 3.2 当前默认验证基线

当前默认最低验证基线为：

- [x] `npm run check`（统一入口，串行执行 `npm test`、`npm run test:replay`、`npm run build`）
- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run build`

当前建议按风险追加的验证为：

- [x] 涉及 Rust tracking 主链、数据边界或恢复路径时，追加 `cargo check`
- [x] 涉及发布行为时，追加 `npm run release:validate-changelog`
- [x] 涉及性能热点时，追加前后对照测量

如果只想快速判断当前大概处于哪一步，先看这一节。

---

## 4. 执行顺序总览

本文默认按下面顺序推进：

1. 建立统一 gate 和事实基线
2. 先补 tracking 主链与数据边界的可靠性
3. 再收前端热点、共享热点和测试热点
4. 再收 Rust runtime 与壳层热点
5. 再建立性能口径并推进低风险性能改进
6. 最后做全局收口、文档收口和长期规则判断

这不是硬性 waterfall。
如果某次任务只触及其中一小块，可以直接推进那一块，但不要违背整体顺序的方向。

---

## 5. 阶段零：建立统一 gate 与事实基线

本阶段目标：

- 把“工程质量”从抽象词变成可重复判断的执行语言
- 给后续所有专项优化建立共同入口

### 5.1 建立统一质量入口

- [x] 当前仓库统一质量入口固定为 `npm run check`
- [x] `npm run check` 已串起 `npm test`、`npm run test:replay`、`npm run build`
- [x] 当前阶段默认以 `npm run check` 作为日常最低验证入口
- [x] `cargo check` 保持为风险追加验证，不纳入当前默认基线
- [x] 当前阶段不新增“前端变更”和“全栈高风险变更”的独立子入口，维持 `npm run check` + 风险追加验证的分层口径

### 5.2 建立风险到验证的映射矩阵

- [x] 前端热点页面改动：默认执行 `npm run check`
- [x] tracking lifecycle / replay 相关改动：默认执行 `npm run check`
- [x] tracker heartbeat / stale / cleanup 相关改动：执行 `npm run check`，并追加 `cargo check`
- [x] backup / restore / cleanup 相关改动：执行 `npm run check`，并追加 `cargo check`
- [x] settings 持久化与行为编排改动：默认执行 `npm run check`；若触及 Rust 或数据边界，再追加 `cargo check`
- [x] release / updater 相关改动：执行 `npm run check`，并追加 `npm run release:validate-changelog`；若触及 Rust 或数据边界，再追加 `cargo check`
- [x] 性能相关改动：执行 `npm run check`，并附前后对照测量依据（可按场景选择命令与记录方式）

### 5.3 固化当前阶段首批热点清单

- [x] 首批代码质量热点文件已固定（基于当前仓库体量、边界吸力与改动风险）
- [x] `src/features/classification/components/AppMapping.tsx`（约 939 行）
- [x] `src/features/settings/components/Settings.tsx`（约 684 行）
- [x] `src/shared/lib/sessionReadCompiler.ts`（约 446 行）
- [x] `tests/trackingLifecycle.test.ts`（约 994 行）
- [x] `src-tauri/src/engine/tracking/runtime.rs`（约 698 行）
- [x] `src/app/services/*`（当前共 9 个文件，存在壳层与运行时编排薄片化风险）
- [x] 首批可靠性热点链路已固定（与 `docs/reliability-and-validation-target.md` 一致）
- [x] tracking 主链（lifecycle / heartbeat / stale / cleanup）
- [x] replay / 读模型链路
- [x] 数据安全与恢复链路（backup / restore / cleanup）
- [x] 前端热点交互链路（Dashboard / History / App Mapping / Settings）
- [x] 首批性能热点场景已固定（与 `docs/performance-target.md` 一致）
- [x] 启动与首屏
- [x] 读模型与刷新
- [x] 运行时轮询与后台资源
- [x] SQLite 与持久化压力
- [x] 当前默认高风险区已固定为稳定清单，不再每次临时判断
- [x] `src/app/services/*`（当前共 9 个文件）
- [x] `src-tauri/src/app/*`（当前包含 `backup.rs`、`bootstrap.rs`、`desktop_behavior.rs`、`runtime.rs`、`runtime_tasks.rs`、`state.rs`、`tray.rs` 等）
- [x] `src-tauri/src/commands/*`（当前包含 `apps.rs`、`backup.rs`、`settings.rs`、`tracking.rs`、`update.rs`）
- [x] “什么情况需要暂停并升级”已固定：直接沿用 `docs/issue-fix-boundary-guardrails.md` 第 6 节“必须先停下来的信号”

### 5.4 建立工程事实基线

- [x] 当前默认验证脚本及用途已记录
- [x] `npm run check`：默认统一入口，串行执行 `npm test`、`npm run test:replay`、`npm run build`
- [x] `npm run release:validate-changelog`：发布相关改动可直接映射的追加验证
- [x] `cargo check`：Rust / 数据边界相关高风险改动的风险追加验证，不属于默认基线
- [x] 当前热点文件清单已记录（沿用 5.3 首批热点文件清单）
- [x] 当前默认高风险区已记录（沿用 5.3 稳定高风险区清单）
- [x] 当前尚未建立的 gate 已记录
- [x] 尚未拆分“前端变更”与“全栈高风险变更”的子入口 gate（维持阶段零最小基线）
- [x] 尚未建立覆盖 tracking 不变量与数据恢复边界的专项强制 gate
- [x] 尚未建立性能改动必须提交统一测量产物的硬性 gate
- [x] 当前尚未建立的测量口径已记录
- [x] 启动与首屏、读模型与刷新、后台资源、SQLite 压力四类场景尚未形成统一测量口径
- [x] 当前明确不做事项已记录，避免本轮执行变成大重构
- [x] 不把 `cargo check` 升格为默认基线
- [x] 不提前宣称性能测量口径已经完成
- [x] 不在阶段零扩展为跨层重构或目录级结构迁移

### 5.5 阶段验收

- [x] 仓库已有统一质量入口或同等强度固定入口
- [x] 风险到验证矩阵已经写清
- [x] 热点名单已经固定
- [x] 后续阶段的讨论已经共享同一套语言和门槛

完成本阶段后，后续工程质量优化不应再停留在“感觉上该优化”，而应转入“按哪类风险推进哪种动作”。

---

## 6. 阶段一：tracking 主链可靠性

本阶段目标：

- 先让“可被长期信任”成为工程事实
- 先补验证保护，再做深层整理和性能动作

### 6.1 文档化 tracking 主链不变量

- [x] 已写清：`isTrackableWindow(win, shouldTrack)` 语义边界：缺失 `exe_name` 不可跟踪；`is_afk=true` 不可跟踪；其余由 `shouldTrack(exe_name)` 决定。
- [x] 已写清：`resolveWindowSessionIdentity` 语义边界：`appKey=exe_name.toLowerCase()`；`instanceKey=appKey|pid|root_owner_hwnd(or hwnd)|window_class`。
- [x] 已写清：`planWindowTransition` 主链判定：`didChange = appChanged || trackingStateChanged`；`shouldEndPrevious = lastTrackable && didChange`；`shouldStartNext = nextTrackable && didChange`。
- [x] 已写清：同 app 且 `didChange=false` 时，title 或 instance 变化只走 metadata refresh，不结束也不重开 session。
- [x] 已写清：从可跟踪窗口切到 AFK / 非 trackable 且 `nextWindow.is_afk=true` 时，`endTimeOverride = nowMs - idle_time_ms`。
- [x] 已写清：`resolveStartupSealTime` 边界：heartbeat 缺失或非法返回 `nowMs`；正常返回 `min(nowMs, max(sessionStartTime, lastHeartbeatMs))`。
- [x] 已写清：`resolveTrackerHealth(lastHeartbeatMs, checkedAtMs, staleAfterMs)` stale 口径：仅当 `lastHeartbeatMs !== null` 且 `(checkedAtMs - lastHeartbeatMs) <= staleAfterMs` 为 `healthy`，否则为 `stale`。
- [x] 已标出：以上不变量与现有 lifecycle / replay 保护映射关系已在 6.2 / 6.3 固定。
- [x] 已补到当前阶段要求：多事件时序组合已扩到 `startup-sealed + cleanup + stale`，Rust runtime emit source -> 前端读模型端到端自动化串联也已从首批 sealed / restore / power-end reason 扩到 `tracking-paused-sealed`、`session-ended-suspend` 与 `session-transition`；当前阶段不再把 tracking 主链联动覆盖视为归档 blocker。

### 6.2 生命周期主链保护

- [x] 已审视：`tests/trackingLifecycle.test.ts` 当前覆盖范围已按“主链决策 / 读模型保护 / 编译与汇总保护”分层标出。
- [x] 已标出主链已覆盖：same window 重复事件不触发 session 变化；同 executable 的 title 变化不触发 session 变化；tracked 窗口切换会结束上一段并开启下一段；已知 executable 但无 process path 仍可跟踪；AFK 切换会回拨 end time 且不新开 session；同 app 不同顶层窗口保持单 session 但刷新 metadata；startup sealing 优先最后 heartbeat；非法 heartbeat 会被 clamp 到 startup 边界；heartbeat 超过 grace window 后 tracker 变 stale。
- [x] 已标出相关保护已覆盖：alias 归一化与 canonical display name；installer / PickerHost / 空 exe 过滤；merge threshold 不改变真实 active duration；cross-day compilation / daily summaries；dashboard/history 读模型中的 display name override、not tracked 过滤、stale tracker 下 live session capped；`tracking-paused` / `tracking-resumed` reason 会同时触发 refresh 与 pause setting sync。
- [x] 已标出仍待继续补齐：更广的多事件叠加时序（如 startup + stale + cleanup），以及更完整的 Rust runtime emit source -> 前端读模型端到端自动化串联。`tracking pause / resume` 主链与首批 `pause -> lock`、`lock -> pause` 时序已补直接保护，startup seal 也已补到真实数据库状态转换与“已关闭后再 startup 不重复 seal”的层级，并新增 `startup seal -> lock / suspend / pause` 均保持 no-op 的 Rust 直接保护；前端事件消费层、runtime snapshot loader 与 `AppShell` 刷新编排也已有首轮直接保护；cleanup 语义边界已通过 `buildSessionCleanupPlan(...)` / `clearSessionsByRangeWithDeps(...)` 显式固定为“按 `start_time < cutoff` 删除，会删除跨 cutoff 的 active session，但保留 `start_time === cutoff` 的记录”；本轮再补 `applyTrackingDataChangedPayload(...) -> resolveReadModelRefreshSignal(...) -> loadDashboardRuntimeSnapshotWithDeps(...) / loadHistoryRuntimeSnapshotWithDeps(...) -> dashboard/history read model` 的首批契约级端到端联动测试，并补上 `backup-restored`、`watchdog-sealed` 与 `session-ended-lock` 三类恢复/封口 reason 的路径级验证。
- [x] 已写清默认验证动作：tracking lifecycle / replay 相关改动默认执行 `npm run check`；heartbeat / stale / cleanup 相关改动默认执行 `npm run check` 并追加 `cargo check`。
- [x] 已补到当前阶段要求：多事件叠加时序直接测试现已覆盖 `pause -> lock`、`lock -> pause`、`cleanup + stale`、`startup-sealed + cleanup + stale`，Rust runtime emit source -> 前端读模型端到端自动化串联也已覆盖 `startup-sealed`、`backup-restored`、`watchdog-sealed`、`tracking-paused-sealed`、`session-ended-lock`、`session-ended-suspend` 与 `session-transition`；前端 `applyTrackingDataChangedPayload(...)`、runtime snapshot loader、`AppShell` 刷新编排与 cleanup 显式语义边界均已有直接保护。
- [x] 已补：测试重组后的抗退化证明已具备，拆分后失败可直接定位到 `tests/trackingLifecycle/processMapper.ts` 的具体断言与行号。

### 6.3 replay 主链保护

- [x] 已审视：`tests/trackingReplay.test.ts` 当前已从单场景扩展为多场景 replay 回归测试。
- [x] 已标出 replay 当前能验证：`HistoryReadModelService.buildHistoryReadModel`；`HistoryReadModelService.buildDashboardReadModel`；dashboard top applications formatting；`ProcessMapper` alias / override 对读模型结果的影响；`resolveTrackerHealth` 参与下的 replay 结果稳定性；PickerHost 过滤与别名归一化后的聚合结果；以及 startup-sealed 后闭合会话在 stale tracker 下不会重新增长。
- [x] 已标出 replay 当前不直接保护：`planWindowTransition` 窗口切换决策；startup sealing；cleanup / backup / restore；Rust runtime 时序。
- [x] 已写清 replay 更适合保护：读模型构建、格式化与聚合稳定性、映射规则（alias/override）对输出的影响、stale health 参与下的展示稳定性。
- [x] 已写清 replay 相关默认验证动作：默认执行 `npm run check`；若改动触及 heartbeat / stale / cleanup，再追加 `cargo check`。
- [x] 已补：replay 已扩展为多场景矩阵与跨场景回归基线，当前至少覆盖 history alias 聚合、dashboard alias 聚合、stale live session capped、startup-sealed closed session under stale tracker、startup-sealed + cleanup under stale tracker、cleanup cutoff equality under stale tracker、cleanup cutoff equality + active session capped under stale tracker、display name override formatting 8 类场景。

### 6.4 heartbeat / stale / cleanup 行为保护

- [x] 已写清（stale 展示口径）：`resolveTrackerHealth(lastHeartbeatMs, checkedAtMs, staleAfterMs)` 仅在 `lastHeartbeatMs !== null` 且 `(checkedAtMs - lastHeartbeatMs) <= staleAfterMs` 时为 `healthy`，否则为 `stale`；`resolveLiveCutoffMs(trackerHealth, nowMs)` 在 `healthy` 时取 `nowMs`，在 `stale` 时取 `lastHeartbeatMs ?? 0`。
- [x] 已写清（stale 展示口径）：`materializeLiveSessions(...)` 对 `end_time === null` 的 live session 按 `max(0, liveCutoffMs - session.start_time)` 物化时长；若 tracker 为 `stale`，标记 `diagnosticCodes=["tracker_stale_live_session"]`，并将 `suspiciousDuration` 记为同样的截断时长；`buildReadModelDiagnostics(...)` 在 tracker `stale` 或存在 suspicious sessions 时 `hasWarnings=true`。
- [x] 已标出已有测试可证明的 stale 展示行为：`tracker health becomes stale when heartbeat exceeds grace window`；`dashboard read model caps live session growth at the last successful sample when tracker is stale`；`history timeline keeps latest live session visible below min threshold and hides it once ended`。
- [x] 已写清（运行时 seal 行为）：`watchdog` 每 1s 轮询，`TRACKER_STALL_SEAL_AFTER_MS = 8_000`；`should_watchdog_seal(...)` 仅在存在 `last_successful_sample_ms`、当前 sample 未 seal、且 `now_ms - last_successful_sample_ms > 8_000` 时触发；触发后执行 `end_active_sessions(pool, sample_time_ms)` 并 emit `tracking-data-changed`（reason=`watchdog-sealed`）。
- [x] 已写清（运行时 seal 行为）：`runtime.rs` 在 `tracking_paused=true` 时立即 `end_active_sessions(pool, now_ms)` 并 emit reason=`tracking-paused-sealed`；`startup.rs` 在启动检测到 active session 时按 `resolve_startup_seal_time(...)` 计算 end time 后 seal，并 emit reason=`startup-sealed`；Rust 侧 `seal_startup_active_session_in_pool(...)` 已直接固定 startup seal 的数据库动作与“已关闭 session 不会被 startup 再次改写”，`runtime.rs` 也已固定 `startup seal -> lock / suspend / pause` 均不再重复 seal。
- [x] 已写清（cleanup 历史清理语义）：`SettingsRuntimeAdapterService.clearSessionsByRange(range)` 仅计算 cutoff 后调用 `clearSessionsBefore(cutoffTime)`；`deleteSessionsBefore(cutoffTime)` 当前执行 `DELETE FROM sessions WHERE start_time < ?`；与设置页“按时间范围清理历史数据 / 删除早于所选天数的记录”口径一致，当前不等同 heartbeat/stale 的运行时收尾语义。
- [x] 已补（直接保护）：`watchdog-sealed`、`tracking-paused-sealed`、`startup-sealed` 的前端展示/语义联动已有直接测试固定：`tracking data changed sealed reasons force refresh without pause setting sync`；前端事件消费层 `applyTrackingDataChangedPayload(...)` 也已固定 sealed / toggle / failed sync 三类联动语义；Rust 侧 sealed reason 契约已有 `sealed_reason_contracts_are_stable`。
- [x] 已补（直接保护）：cleanup 对 active session / live read model / restore 路径影响边界已有直接测试固定：`cleanup uses session start time cutoff and deletes active sessions started before cutoff`、`cleanup deletion removes old active sessions from live read model`、`cleanup deletion on stale tracker does not resurrect removed live sessions`、`backup restored event keeps refresh=true and pause sync=false`。

### 6.5 阶段验收

- [x] tracking 主链关键不变量已经写清
- [x] lifecycle 与 replay 的保护边界已经写清
- [x] 高风险 tracking 改动已经有固定验证组合
- [x] cleanup / stale / heartbeat 不再明显依赖人工经验放行

完成本阶段后，tracking 主链不应再处于“大家大概知道它该怎么工作”的状态，而应进入“关键语义可被明确验证”的状态。

---

## 7. 阶段二：数据边界与恢复可靠性

本阶段目标：

- 让数据边界和恢复路径从“默认谨慎”升级成“默认可验证”

### 7.1 backup / restore 边界梳理

- [x] 已梳理 backup 的关键输入输出：从 sqlite pool 读取 `sessions`、`settings`、`icon_cache`，组装 `BackupPayload { version, meta, sessions, settings, icon_cache }`，并写入 json 文件。
- [x] 已梳理 restore 的关键输入输出：先读文件并 decode payload，再做 compatibility 检查；不支持则报错；支持时在事务内按顺序 clear `sessions/settings/icon_cache` 后再 insert 三类数据，任一步失败会 rollback；前端 `prepareBackupRestore()` 先走 `pickBackupFile` + `previewBackup`，并在前端先拦截 incompatible 备份。
- [x] 已梳理 cleanup 与 backup / restore 的关系：cleanup 仅按 `start_time < cutoff` 删除 `sessions`，不触及 `settings` 与 `icon_cache`；因此与 restore 共用 sessions 边界，但不覆盖全部备份内容。
- [x] 已梳理版本兼容与 schema 风险：当前兼容性基于 `CURRENT_BACKUP_VERSION` 与 `CURRENT_BACKUP_SCHEMA_VERSION`；旧 backup 走 legacy but supported，新 version/schema 视为 incompatible。
- [x] 已梳理 restore 后同步与刷新动作：Rust restore 成功后会执行 `sync_desktop_behavior_from_storage(app, false)` 并 emit `tracking-data-changed(reason=backup-restored)`；前端 Settings 页面 restore 成功后会执行 `window.location.reload()`。

### 7.2 数据边界默认验证

- [x] 数据边界相关改动默认执行 `npm run check`；对 backup / restore / cleanup 相关改动默认追加 `cargo check`（沿用阶段零矩阵）。
- [x] 仅跑前端脚本不足以覆盖 Rust restore 事务回滚、backup compatibility 判定、desktop behavior sync、真实文件选择/读写路径等数据边界风险。
- [x] 涉及 backup / restore / cleanup 的数据边界改动，默认追加 `cargo check`；不只停留在前端脚本验证。
- [x] 一旦改动触及 restore 成功链路编排（`prepareBackupRestore()` 预检、Rust restore、desktop behavior sync、`backup-restored` 事件、Settings `window.location.reload()`），默认追加人工恢复路径验证。
- [x] 人工验证只作为补充保护，不作为唯一保护；当前仍以固定命令基线（`npm run check` + 按矩阵追加 `cargo check`）和既有 Rust/前端自动测试共同兜底。

### 7.3 settings / backup / restore 的协作约束

- [x] 已明确 restore 对 settings 的影响边界：`src/shared/settings/appSettings.ts` 中普通 app settings（如 `refresh_interval_secs`、`min_session_secs`、`tracking_paused`、`close_behavior`、`minimize_behavior`、`launch_at_login`、`start_minimized`）与分类系统相关 settings 前缀 key（app override、category color override、default color assignment、custom category、deleted category）都在 restore 替换整张 `settings` 表时一并恢复。
- [x] 已明确 restore 成功后的协作生效链路：`refresh_interval_secs`、`min_session_secs`、`tracking_paused` 会直接影响前端 AppShell / Dashboard / History 的展示与刷新；`close_behavior`、`minimize_behavior`、`launch_at_login`、`start_minimized` 会通过 Rust `sync_desktop_behavior_from_storage(app, false)` 重新作用到桌面行为；Rust 侧会 emit `backup-restored`，Settings 页面 restore 成功后会执行 reload。
- [x] 已明确 backup / restore 对前端读模型与文档/验证矩阵的联动：`readModelRuntimeService` 会先 `ensureProcessMapperRuntimeReady()`，而 process mapper runtime 会从 `settings` 前缀 key 重新加载 override/category 配置，Dashboard/History 还会读取 `icon_cache`；因此凡触及 settings key 空间、restore 成功链路或读模型 runtime 装配的改动，都应同步回写本节约束并对齐 5.2/7.2 的默认验证矩阵。

### 7.4 阶段验收

- [x] backup / restore / cleanup 的风险点已被系统梳理
- [x] 数据边界改动已有固定追加验证动作
- [x] 恢复路径不再依赖“改的人自己心里有数”

完成本阶段后，数据相关高风险改动应有比现在更硬的进入门槛。

---

## 8. 阶段三：前端热点页面收口

本阶段目标：

- 降低热点页面的认知负担
- 让复杂度稳定留在真实 owner 内

### 8.1 `AppMapping.tsx` 收口

- [x] 已确认 `AppMapping.tsx`（约 40KB）是当前前端热点页之一，且同时承担页面壳/页头与 Quiet Pro 结构、bootstrap 加载与缓存回填、草稿与已保存态、名称编辑中间态与多类 UI 状态、分类派生、确认/提示交互、保存编排与删除会话动作。
- [x] 已区分职责边界：壳层职责应保留在页面容器（页面结构与流程编排）；classification owner 职责继续留在 feature owner（分类规则、草稿提交/保存/删除编排、store/persistence 协作）。
- [x] 已按事实拆分语义：UI 结构（页面壳与区块呈现）、交互状态（编辑/filter/dialog/confirm）、映射规则（显示名/分类/颜色/track/title capture 派生）、持久化调用（commit/save/delete）属于不同关注点。
- [x] 已开始执行局部 UI 实拆：首刀已将单个候选应用卡片从 `AppMapping.tsx` 抽离为 `AppMappingCandidateCard.tsx`；名称编辑与动作条、分类控制与对话区块仍按既定候选继续推进。
- [x] 已识别可安全拆出的 hooks 候选：bootstrap 与草稿状态编排、名称编辑状态机、候选过滤与统计。
- [x] 已识别可安全拆出的 feature 内服务候选：页面派生选择器、override 构造与变更辅助；与 `ClassificationService` / `AppClassificationFacade` 的边界保持 owner 内协作，不外溢到壳层。
- [x] 已明确约束：classification 私有逻辑不回流 `shared/*`，继续由 feature owner（含当前 `ClassificationService`、classification store/persistence）承接。
- [x] 已明确约束：UI 层状态与页面私有编排不回流 `app/*`，优先落在 `features/classification/components`、`features/classification/hooks`、`features/classification/services`。
- [x] 首轮拆分后的交互契约保持不变（首轮验证已完成）：本轮仅完成 UI 结构首刀实拆（`AppMappingCandidateCard.tsx`），父组件仍保留状态、业务判断、save handler 与 delete/commit 编排；并已通过 `npm run check` 作为本轮回归验证。

### 8.2 `Settings.tsx` 收口

- [x] 已确认 `Settings.tsx`（约 30KB）是当前前端热点页之一，且当前同时承担页面壳/页头与 Quiet Pro 结构、settings bootstrap 加载与缓存回填、saved/draft settings 与 `saveStatus`、cleanup/export/restore 路径与 loading 状态、`appVersion` 与更新面板接入、脏状态上报/Toast/保存处理注册、普通设置项编辑、以及 cleanup/export/restore/打开链接等危险或外部动作编排。
- [x] 已按事实区分四层关注点：展示层（页面壳、页头、面板区块与字段呈现）、状态编排层（bootstrap、draft/saved、`saveStatus`、loading、dirty 与保存处理桥接）、外部调用层（对话框/更新面板/外部链接/恢复导出清理动作触发）、持久化读写层（settings patch 构造与提交、cleanup cutoff 调用、backup/restore gateway 预检与提交）。
- [x] 已识别可安全拆出的局部面板候选：Tracking、Resident、Data Safety、About；其中 Data Safety 下可继续保持 Backup & Restore 与 Cleanup 两个局部区块，优先做“UI 结构拆分”而不改变既有交互语义。
- [x] 已继续推进局部 UI 实拆：`Data Safety`、`About`、`Resident`、`Tracking` 四个区块已从 `Settings.tsx` 分别抽离为 `SettingsDataSafetyPanel.tsx`、`SettingsAboutPanel.tsx`、`SettingsResidentPanel.tsx`、`SettingsTrackingPanel.tsx`；本轮仍是 UI 结构拆分，不涉及 hooks/service 重构。
- [x] 已识别可安全拆出的页面私有 hooks 候选：`useSettingsBootstrapDraftSaveState`（bootstrap + draft/save 状态编排）、`useSettingsDataSafetyActions`（cleanup/export/restore 动作与 loading/confirm 编排）、`useSettingsPageSideEffects`（toast/dirty/save handler 桥接）。
- [x] 已识别可安全拆出的 settings owner 内服务候选：minute conversion / patch helper、backup/restore preparation 与结果 summary helper、页面派生选择器；与现有 `SettingsRuntimeAdapterService`、`sessionCleanupPolicy.ts` 保持 owner 内协作，不外溢到 `shared/*`。
- [x] 已明确约束：设置私有逻辑继续留在 `features/settings/*`（components/hooks/services），不把 settings 私有语义、适配细节或页面派生逻辑回流 `shared/*`。
- [x] 已明确约束：设置页状态编排继续留在 `features/settings/*` owner 内，不把页面编排、UI side effects 或动作聚合重新塞回 `app/*`。
- [x] 当前四刀实拆后的行为契约与用户操作路径保持不变（本轮验证已完成）：当前已完成 `Data Safety` + `About` + `Resident` + `Tracking` 四刀 UI 结构拆分（`Tracking` 区块已抽离为 `SettingsTrackingPanel.tsx`），且已通过 `npm run check`；父组件仍保留并执行 `idleTimeoutMinutes`、`timelineMergeGapMinutes`、`minSessionMinutes`、`handleChange`、`draftSettings.tracking_paused`，三个 minute slider 的 min/max 与分钟转秒更新逻辑仍在父组件 props 组装层决定；该结论仅覆盖这四刀拆分范围，不代表 `Settings.tsx` 已彻底重构完成。

### 8.3 `Dashboard.tsx` / `History.tsx` 只做必要收口

- [x] 已审视 `Dashboard.tsx`（约 202 行）：当前更偏展示壳，dashboard 数据整形已由 `useDashboardStats.ts` 与 `dashboardReadModel.ts` 承接；未见把页面私有语义新增回流到 `app/*`，也未见新增堆进 `shared/*` 的迹象。
- [x] 已审视 `History.tsx`（约 358 行）：页面内仍有 date/load/cache/live-refresh/minSession 的编排，但 read model/format/cache 已在 `historyReadModel.ts`、`historyFormatting.ts`、`historySnapshotCache.ts` 等 feature owner 内；当前未见把页面语义新增回塞 `app/*` 或把页面私有逻辑新增堆进 `shared/*`。
- [x] 只处理明显新增的高吸力问题：本轮未发现 `Dashboard.tsx` / `History.tsx` 新增的边界回流问题，故仅回写事实，不扩展为额外拆分任务。
- [x] 不把当前阶段扩张成前端全面重构：本节保持“必要收口”语义，不提前宣称或启动 `Dashboard.tsx` / `History.tsx` 的全面重构计划。

### 8.4 阶段验收

- [x] `AppMapping.tsx` 结构已在首轮实拆后更清楚（当前仅限候选卡片组件化这一刀）
- [x] `Settings.tsx` 结构已在四刀实拆后更清楚（当前已完成 `Data Safety` + `About` + `Resident` + `Tracking` 面板组件化）
- [x] 在当前已完成的实拆范围内（`AppMappingCandidateCard.tsx` 首刀与 `Settings` 四刀面板拆分），页面热点复杂度未外溢到新的 `shared/*` 或 `app/*` 共享垃圾桶
- [x] 在当前这几轮实拆范围内，相关行为保护在重构前后保持稳定（最近一轮已通过 `npm run check`），不代表整个前端重构范围均已完成同等验证

完成本阶段后，前端热点页面应从“能工作但很难安心改”进入“仍然复杂，但已经能分区理解”的状态。

---

## 9. 阶段四：共享层、壳层与兼容壳收口

本阶段目标：

- 防止 `shared/*`、`app/*`、兼容壳成为新的吸力层

### 9.1 `src/shared/lib/sessionReadCompiler.ts` 收口

- [x] 已确认当前事实：`sessionReadCompiler.ts` 约 375 行，当前被 `dashboardReadModel.ts`、`historyReadModel.ts`、`readModelCore.ts`、`tests/trackingLifecycle.test.ts` 使用
- [x] 已确认当前共享编译/聚合职责：session 预处理、range clip、近邻 merge、timeline merge、day range / rolling day ranges、normalized app stats / app summary / daily summaries
- [x] 已确认边界现状：该文件当前不再直接依赖 `features/classification/services/ProcessMapper.ts` 与 `processNormalization.ts`，而是经由 `src/shared/lib/appClassificationFacade.ts` 承接 executable canonicalization、display name 归一、trackability 判断等共享所需 classification 语义；shared 编译核心与 feature owner 细节的直接耦合已收薄一层
- [x] 已确认职责分离现状：dashboard 的 top applications / hourly activity / category distribution formatting 在 `dashboardFormatting.ts`；history 的 chart/time/date formatting 在 `historyFormatting.ts`；该文件当前不承担页面 formatting
- [x] 阶段四执行口径：已将该文件先稳定到“共享 session 编译核心 + 共享分类门面协作”边界（编译/聚合与通用读模型计算继续留在 shared；classification owner 细节不再直接回流）；后续仅继续评估 facade 本身是否还需进一步瘦身，不再接受新的 feature 私有拼装或页面语义回流

### 9.2 `src/app/services/*` 收口

- [x] 已按当前仓库事实确认 `src/app/services/*` 共 10 个文件：`appRuntimeBootstrapService.ts`、`appRuntimeTrackingService.ts`、`appSettingsRuntimeService.ts`、`processMapperRuntimeGate.ts`、`processMapperRuntimeService.ts`、`readModelRuntimeService.ts`、`startupPrewarmService.ts`、`trackerHealthPollingService.ts`、`trackingPauseSettingsPolicy.ts`、`trackingPauseSettingsRuntimeService.ts`
- [x] 已确认更偏 app 壳层 / 跨 feature 编排的服务：`appRuntimeBootstrapService.ts`（启动编排 settings/idle timeout/process mapper runtime/active window/tracker health）、`appRuntimeTrackingService.ts`（runtime event subscribe 薄封装）、`startupPrewarmService.ts`（并发 prewarm settings/classification/dashboard/history cache）、`trackerHealthPollingService.ts`（tracker health 轮询）、`trackingPauseSettingsRuntimeService.ts`（按 tracking-data-changed 联动读取最新 pause setting）；`trackingPauseSettingsPolicy.ts` 已拆成纯规则薄片，供运行时与测试共享
- [x] 已确认更偏 feature owner runtime 装配 / feature 协作的服务：`processMapperRuntimeService.ts`（直接依赖 classification `ProcessMapper.ts` 与 `classificationStore.ts`，装配 override/category runtime snapshot 并写回 `ProcessMapper`）、`processMapperRuntimeGate.ts`（`processMapperRuntimeService.ts` 的并发 gate）、`readModelRuntimeService.ts`（先确保 process mapper runtime ready，再装配 dashboard/history snapshot loader 并写入 snapshot cache）
- [x] 已确认 `appSettingsRuntimeService.ts` 当前仍为混合态：被 `AppShell.tsx`、`useDesktopLaunchBehaviorSync.ts` 作为 app 层 settings runtime 薄协调使用；同时直接包装 `settingsPersistenceAdapter`、`trackingRuntimeGateway`、`desktopBehaviorRuntimeGateway`，仍带有 settings/runtime side effects 协调属性。相较此前，`trackingPauseSettingsPolicy.ts` 已把纯 reason 判定规则从运行时 side effect 服务中拆出；本轮 `trackingPauseSettingsRuntimeService.ts` 已不再经 `appSettingsRuntimeService.ts` 转发读 settings，而是直接回到 `settingsPersistenceAdapter` owner。
- [x] 已确认当前 `src/app/services/*` 内没有“纯 platform owner 服务实现”；platform 边界仍主要由 `src/platform/*` gateway 承担
- [x] 已收薄只因“方便”停留在 app 层的逻辑：`AppShell.tsx` 对 `min_session_secs` 的纯持久化写入已直接回到 `settingsPersistenceAdapter` owner，不再经 app 层混合 runtime service 转发。
- [x] 已进一步把 `app/*` 收回壳层与跨 feature 编排身份：`useDesktopLaunchBehaviorSync.ts` 已直接调用 desktop behavior gateway，`appSettingsRuntimeService.ts` 已删除，当前 app 壳层不再持有这段 mixed owner 转发。

### 9.3 兼容壳与 legacy 转发层检查

- [x] 已按当前仓库事实清点 3 个最明确兼容壳 / legacy 转发层：`src/features/settings/services/settingsPageService.ts`（3 行，文件头标注 `Legacy compatibility entrypoint.`，仅 `export * from "./settingsRuntimeAdapterService";`）、`src/shared/lib/historyReadModelService.ts`（约 36 行，重导出 dashboard/history read model 并保留 `HistoryReadModelService` service-shaped legacy export）、`src/shared/lib/sessionReadRepository.ts`（4 行，仅将 `DailySummary`、`HistorySession` 从 `platform/persistence/sessionReadRepository.ts` 做 type forwarding）
- [x] 已确认 `settingsPageService.ts` 当前在 `src` / `tests` 内无实际引用，应标记为历史残留兼容入口，不作为新先例
- [x] 已确认 `historyReadModelService.ts` 当前仍有现实价值：注释已明确用于 tests 与 remaining compatibility callers 的渐进迁移，现有主要引用在 `tests/trackingReplay.test.ts`、`tests/trackingLifecycle.test.ts`；后续应继续保持薄，不回长跨 feature 业务逻辑
- [x] 已确认 `sessionReadRepository.ts` 当前仍有现实价值：作为兼容性 type forwarding 入口仍被 `sessionReadCompiler.ts`、history/dashboard 相关文件与 tests 使用；后续应继续保持薄，不承接新业务语义
- [x] 已澄清边界：`src/shared/lib/appClassificationFacade.ts` 虽名为 facade，但当前被 app/features/dashboard/history/classification 广泛主动使用，应视为当前稳定门面，不纳入本节 legacy 壳清退口径
- [x] 后续变更口径已明确并在本轮继续落实：阻止新需求继续落入兼容壳/legacy 转发层，新增调用优先落在明确 owner 边界；仅在兼容迁移有明确必要时保留薄壳，并同步记录存在理由。

### 9.4 阶段验收

- [x] 在当前阶段已完成梳理与边界收口的口径下，`shared/*` 已明确不新增过渡职责（不等同于后续迁移执行已全部完成）
- [x] 在当前阶段已完成梳理与边界收口的口径下，`app/*` 已明确维持壳层与跨 feature 编排身份（不等同于后续无回流风险）
- [x] 在当前阶段已完成梳理与边界收口的口径下，兼容壳有明确存在理由并按“薄壳”约束维持（不等同于兼容壳已清退完成）

完成本阶段后，上述验收仅表示当前阶段的事实梳理与边界收口已完成，不表示所有迁移执行项已结束。

---

## 10. 阶段五：测试热点与验证组织收口

本阶段目标：

- 让测试文件本身也更可维护
- 让验证动作更像体系，而不是脚本列表

### 10.1 `tests/trackingLifecycle.test.ts` 收口

- [x] 已复核入口职责收口：`tests/trackingLifecycle.test.ts` 当前已从“超厚单文件”收口为“入口编排文件”，仅负责串联 `lifecycleCore.ts`、`runtimeEffects.ts`、`historyReadModel.ts`、`readModelRuntime.ts`、`compilerAndAggregation.ts`、`processMapper.ts` 六组场景模块并复用统一 harness；其中 `readModelRuntime.ts` 已同时覆盖 runtime snapshot loader 与 `AppShell` 刷新编排。
- [x] 已完成基础 helper 抽离：`makeWindow(...)`、`makeSession(...)`、`createTestHarness()/runTest(...)` 已稳定落在 `tests/helpers/trackingTestHarness.ts`，供 lifecycle / replay 共用。
- [x] 已完成首轮 fixtures 抽离：常用 read model / tracker health / snapshot build 样本与 helper 已沉淀到 `tests/helpers/trackingReadModelFixtures.ts`。
- [x] 已完成场景模块拆分：`lifecycle & startup`、`runtime payload / stale / cleanup`、`history/dashboard read model behaviors`、`read model runtime snapshot loaders & shell refresh orchestration`、`compiler & aggregation`、`process mapper & normalization` 已分别落入独立模块。
- [x] 已验证拆分后失败定位仍清晰：本轮在 `processMapper.ts` 拆分后出现的断言失败可直接定位到模块文件与具体行号，修复后 `npm test` / `npm run check` 重新通过。
- [x] 当前阶段结论：测试热点已推进到“入口 + helpers + fixtures + 场景模块”结构；后续若再细化，应以新增热点或新增复杂样本为触发条件，不再把“compiler / process mapper 仍混在入口文件中”视为当前阻塞。

### 10.2 验证动作组织收口

- [x] 已按当前矩阵收口“改哪类风险跑哪组验证”的口径：前端热点页面与 tracking lifecycle/replay 默认执行 `npm run check`；heartbeat/stale/cleanup 与 backup/restore/cleanup 执行 `npm run check` 并追加 `cargo check`；settings 持久化与行为编排默认 `npm run check`，触及 Rust 或数据边界再追加 `cargo check`；release/updater 执行 `npm run check` 并追加 `npm run release:validate-changelog`，触及 Rust 或数据边界再追加 `cargo check`；restore 成功链路改动时人工恢复路径验证仅作补充保护。
- [x] 已按当前仓库事实分层“默认验证动作 / 专项验证动作”：默认最低验证基线为 `npm run check`（串行执行 `npm test`、`npm run test:replay`、`npm run build`）；`cargo check` 与 `npm run release:validate-changelog` 维持风险追加验证，不上升为默认基线。
- [x] 已形成“日常改动验证 / 发布相关改动验证”的阶段性分层口径：日常改动按风险矩阵执行默认基线与必要追加；发布相关改动在此基础上追加 `npm run release:validate-changelog`，并在触及 Rust 或数据边界时追加 `cargo check`；当前阶段仅形成阶段性分层，不代表最终发布门槛已全部定稿（后续由阶段九继续收口）。
- [x] 已确保文档验证门槛可直接映射到仓库现有命令：`npm run check`、`cargo check`、`npm run release:validate-changelog`，不新增仓库命令名。

### 10.3 阶段验收

- [x] 测试热点重构候选已明确，且已完成 helper 抽离、fixtures 抽离与首轮场景模块拆分；`compiler & aggregation` 与 `process mapper & normalization` 现已独立成组，拆分后失败也能直接定位到模块文件与行号。
- [x] 默认验证矩阵更清楚
- [x] 发布前和日常改动的验证分层更清楚（当前为阶段性分层，最终门槛仍由阶段九继续收口）

完成本阶段后，当前已可视为“验证组织已收清，测试热点首轮结构化收益已落地”；后续若继续细化，属于在现有结构基础上的增量整理，而不是回到阶段五的原始阻塞。

---

## 11. 阶段六：Rust runtime 与入口热点收口

本阶段目标：

- 防止 Rust 入口、runtime、commands 回流成新的厚层

### 11.1 `src-tauri/src/engine/tracking/runtime.rs` 收口

- [x] 已按当前仓库事实确认体量：`runtime.rs` 约 607 行、约 23.5KB，且仍内联一个从 `#[cfg(test)]` 开始的大测试模块（约从第 254 行起，含 18 个 `#[test]`）。
- [x] 已按当前仓库事实确认剩余复杂度主要集中在：`run(...)` 主循环编排（poll active window、successful sample、sample/heartbeat timestamp 持久化、pause/title capture setting 读取、title strip、active-window-changed emit gating、apply transition、tracking-data-changed emit、sleep）、`handle_power_lifecycle_event(...)` / `apply_power_lifecycle_event(...)`、`start_session(...)` / `start_session_for_transition(...)`（含异步 icon cache 触发）、`poll_active_window_with_timeout(...)`、`emit_tracking_data_changed(...)`、`now_ms()`、`log_tracker_error(...)` 与内联 tests 模块。
- [x] 已按当前仓库事实区分 runtime 编排 owner：主循环调度、对 platform tracker 的 polling/timeout、与 app event emit 的衔接、以及对子模块/仓储调用的装配仍属于 runtime 编排职责。
- [x] 已按当前仓库事实区分可继续下沉方向：sample/heartbeat timestamp 持久化薄流程、tracking pause/capture title setting 读取与 tracked_window 预处理、power lifecycle sealing 分支、以及 `start_session + icon cache` 触发薄流程，更适合继续下沉到 engine 子模块（当前仅完成收口口径，不宣称迁移已完成）。
- [x] 已按当前仓库事实确认稳定语义下沉现状与阶段约束：`transition.rs`、`startup.rs`、`watchdog.rs`、`domain/tracking.rs`、`metadata.rs` 已承接窗口切换/trackability/identity、startup seal 与自愈、watchdog 健康状态、payload/sealed reason/decision/candidate 等稳定语义；后续继续收薄也不得把 engine/runtime 逻辑回推到 `src-tauri/src/app/*`、`src-tauri/src/commands/*` 或 `lib.rs`。

### 11.2 `src-tauri/src/app/*` 与 `commands/*` 反回流检查

- [x] 已审视 `app/*`：当前以启动装配、运行时任务编排、托盘/桌面行为与状态同步为主；未发现明确“新第二层业务实现”回流（后续仍需持续巡检）。
- [x] 已审视 `commands/*`：当前仍以 Tauri 命令壳转发为主（参数接入、状态读取、委托 app/data/engine/platform），未见承担明显过量业务逻辑。
- [x] 已审视 `lib.rs`：当前保持模块声明与 `run()` 装配入口薄壳形态，未见回胖迹象。
- [x] 已明确当前阶段执行口径：若后续发现回流，先在本节回写为未勾选并标注回流点，再按 owner-first 原则把逻辑回迁到正确边界（如 `engine/*`、`domain/*`、`data/*` 或明确 owner），不将“已识别问题”表述为“已完成迁移”。

### 11.3 阶段验收

- [x] 按 11.1 既有口径（`runtime.rs` 非空行约 607、约 23.5KB）复核，当前阶段未观察到复杂度回升；但 `run(...)` 主循环等剩余复杂点仍在，后续仍需持续收薄。
- [x] 结合 11.2 的边界审视与当前仓库现状，`app/*`、`commands/*`、`lib.rs` 仍以壳层/转发/装配为主，暂未见明显“再变厚”回流迹象（仍需持续巡检）。
- [x] 截至当前阶段，Rust 入口层仍保持清晰装配身份：`lib.rs` 维持模块声明与 `run()` 装配入口形态，命令层继续承担 Tauri 命令壳职责，未见身份漂移。

完成本阶段后，Rust 热点应继续向长期结构靠拢，而不是回到迁移前状态。

---

## 12. 阶段七：建立性能口径

本阶段目标：

- 让性能讨论建立在统一口径上
- 让后续性能动作不再停留在主观印象层

### 12.1 启动与首屏口径

- [x] 定义冷启动口径：以“新启动应用进程、前端内存态 cache 为空”为前提，从 `AppShell` 首次挂载开始，到默认 `dashboard` 视图完成首次可交互渲染为止；当前仓库仅建立口径，尚未建立统一量化基线。
- [x] 定义热启动口径：以“同一应用运行周期内可复用前端内存态 cache（bootstrap/snapshot）”为前提，到默认 `dashboard` 视图完成可交互渲染为止；该口径仅覆盖同进程内复用，不覆盖重启进程后的跨进程复用。
- [x] 定义“首屏可用”的判断口径：`AppShell` 主框架与默认 `dashboard` 已渲染且可导航/可交互，数据允许先以缓存或空态呈现后异步刷新；不要求首次进入即完成全部读模型数据加载。
- [x] 记录当前冷启动基线：尚未建立量化基线。仓库内未见统一的启动时延埋点或固定测量脚本（当前仅有口径与实现现状）。
- [x] 记录当前首屏体验基线：默认首屏为 `dashboard`（非 lazy），可先用 `dashboardSnapshotCache` 的当日缓存初始化；无缓存时以空态进入并异步拉取。`history` 为 lazy 视图，命中 `historySnapshotCache` 时可直接回填，未命中时显示 loading 文案后再更新。
- [x] 记录 startup prewarm 的现状：`AppShell` 挂载后通过 `useEffect` 非阻塞触发 `prewarmStartupBootstrapCaches()`（settings/classification）；`classificationReady` 后再触发 `prewarmStartupSnapshotCaches()`（dashboard/history）。两组 prewarm 均用 `Promise.allSettled`，失败仅 `console.warn`，当前未建立“已证明有效”的量化证据。
- [x] 记录 snapshot cache 的现状：当前为前端进程内 `Map` 缓存；dashboard key 为本地日粒度，history key 为“本地日 + rollingDayCount”。写入来源为 prewarm 与 runtime snapshot loader（history 页面自身加载后也会回写）；读取用于首屏初始化与视图切换回填。当前未见 TTL/淘汰/持久化策略，也未建立命中率与收益量化基线。

### 12.2 读模型与刷新口径

- [x] 梳理 dashboard 读模型重算触发点（基于当前实现事实）
- `useDashboardStats` 在 `classificationReady` 后会触发首轮 `fetchData()`；`fetchData()` 走 `loadDashboardRuntimeSnapshot -> loadDashboardSnapshot`，读取 `getHistoryByDate(date)` 与 `getIconMap()`，并回写 `dashboardSnapshotCache`。
- `refreshSignal = syncTick + dataRefreshTick` 变化会触发 `fetchData()`；其中 `syncTick` 来自 `subscribeTrackingDataChanged`，当前 `resolveTrackingDataChangedEffects` 对所有 reason 都返回 `shouldRefresh=true`；`dataRefreshTick` 来自 App Mapping 的 overrides 变更与会话删除回调。
- `buildDashboardReadModel(...)` 的重算由 `rawSessions / nowMs / trackerHealth / mappingVersion / classificationReady` 变化触发；其中 `nowMs` 会在“存在 live session 且 tracker healthy”时按 `refreshIntervalSecs` 定时更新。
- `trackerHealth` 由 `trackerHealthPollingService` 每 1 秒轮询更新一次，当前实现会持续推动 dashboard 侧 `useMemo` 依赖变化。

- [x] 梳理 history 读模型重算触发点（基于当前实现事实）
- `History` 组件在首轮、`selectedDate` 变化、`refreshKey` 变化时执行 `loadData()`；`loadData()` 会先尝试命中 `historySnapshotCache` 回填，再继续调用 `loadHistorySnapshot(...)` 拉取最新数据并回写 cache。
- `loadHistorySnapshot(...)` 每次读取 `getHistoryByDate(date)` 与 `getSessionsInRange(...)`（7 天滚动窗口），随后更新 `rawDaySessions / rawWeeklySessions / nowMs`。
- `buildHistoryReadModel(...)` 的重算由 `rawDaySessions / rawWeeklySessions / selectedDate / nowMs / trackerHealth / minSessionSecs / mergeThresholdSecs / mappingVersion` 变化触发。
- “存在 live session 且 tracker healthy”时，history 也会按 `refreshIntervalSecs` 仅更新 `nowMs`，触发读模型重算（不必然触发重新拉取 snapshot）。

- [x] 记录哪些场景会导致高频重算/高频刷新（当前可确认）
- tracker health 1 秒轮询会持续改变 `trackerHealth`（至少 `checkedAtMs` 变化），可导致 dashboard/history 高频重算。
- live session 存在且刷新间隔较小时，dashboard/history 会按定时器高频更新 `nowMs` 并重算读模型。
- tracking runtime 高频发出 `tracking-data-changed` 时，`syncTick` 会持续增长，进而触发 dashboard/history 的 snapshot 刷新链路。
- history 当前在 `loadData()` 中“命中 cache 后仍继续请求最新 snapshot”；因此在 `refreshKey` 高频变化时，仍可能发生高频读取。
- dashboard 在存在 live session 且缺失图标时，会按刷新间隔周期性执行 `loadIconSnapshot()`。

- [x] 记录当前缓存是否真的减少开销（保守口径）
- 可以确认的收益：cache/prewarm 主要减少“首屏空白/切页 loading 回填时间”，例如 dashboard/history 可用缓存初始化或快速回填。
- 不能直接确认的收益：当前尚不能证明 cache/prewarm 已显著减少“读取次数”或“读模型重算次数”。history 刷新路径在命中 cache 后仍会继续拉取最新 snapshot；dashboard/history 在 refresh 信号与定时器驱动下仍会持续重算。
- 当前未建立 cache 命中率、fetch 次数、重算次数、耗时分布的量化基线；因此“优化有效”结论尚未量化。
- 结论口径：当前更接近“体验回填机制已存在”，不应等同表述为“读取/重算开销已被证明显著下降”。

- [x] 确定首批观测口径（先建可比对基线）
- `dashboard/history snapshot 拉取次数`（按分钟、按触发来源分桶：首次加载、refreshKey、日期切换、映射变更等）。
- `buildDashboardReadModel/buildHistoryReadModel 调用次数` 与 `耗时分布`（至少平均值 + P95）。
- `tracking-data-changed reason 分布` 与 `syncTick 增量速率`（用于识别刷新风暴来源）。
- `snapshot cache 命中率` 与 `命中后仍发起拉取的比例`（区分“回填体验”与“真实减读”）。
- `首屏/切页 loading 出现率`（用于衡量“减少空白”是否成立）；以上指标当前尚未量化、尚未建立统一采集基线。

### 12.3 后台资源口径

- [x] 梳理 tracking runtime 轮询节奏（基于当前仓库实现事实）
- Rust：`src-tauri/src/engine/tracking/runtime.rs` 主循环每轮执行一次前台窗口采样（`poll_active_window_with_timeout`，单次超时 3 秒），循环尾部固定 `sleep(Duration::from_secs(1))`；当前可确认节奏为约 1 秒一轮。
- Rust：`src-tauri/src/engine/tracking/watchdog.rs` 固定 `TRACKER_WATCHDOG_POLL_MS = 1000` 毫秒轮询；当“当前时间 - 最近成功采样时间”大于 `TRACKER_STALL_SEAL_AFTER_MS = 8000` 毫秒时触发 stale seal 判定。
- Rust：`src-tauri/src/app/runtime_tasks.rs` 将 tracking runtime 与 watchdog 置于 restart loop，异常退出后固定 2 秒重启；这能证明后台活动源持续存在，但不能直接证明资源开销已被量化。

- [x] 梳理 heartbeat / health polling 节奏（覆盖 Rust 与前端）
- Rust heartbeat：`tracking/runtime.rs` 每轮主循环写入 `TRACKER_LAST_HEARTBEAT_KEY`（与采样同节奏，约 1 秒）。
- 前端 health polling：`src/app/services/trackerHealthPollingService.ts` 固定 `TRACKER_HEARTBEAT_POLL_MS = 1000` 毫秒 `setInterval`，每秒触发 `loadTrackerHealthSnapshot(Date.now())`。
- stale 阈值：`src/app/services/appRuntimeBootstrapService.ts` 固定 `TRACKER_HEARTBEAT_STALE_AFTER_MS = 8000`，与 Rust watchdog 的 8 秒阈值口径一致。
- 页面侧定时器：`src/features/dashboard/hooks/useDashboardStats.ts` 与 `src/features/history/components/History.tsx` 在“存在 live session 且 trackerHealth=healthy”时按 `refreshIntervalSecs` 周期仅刷新 `nowMs`（Dashboard 在缺图标时还会周期 `loadIconSnapshot`）；属于后台活动源，不等同于已完成资源优化证明。

- [x] 记录空闲时 CPU 观察口径（保守基线）
- 当前可确认：空闲 UI 下仍有 Rust 侧 1 秒 tracking 采样 + 1 秒 watchdog 轮询 + 前端 1 秒 health polling。
- 当前不可确认：仓库内尚未建立空闲场景 CPU 统一采样脚本、采样窗口与统计口径（如均值/P95）；尚未建立观察/测量基线。
- 口径约束：必须区分“后台活动源存在”与“CPU 开销已量化证明”。

- [x] 记录空闲时内存观察口径（保守基线）
- 当前可确认：前端存在进程内缓存与状态（dashboard/history snapshot cache、trackerHealth、读模型状态），Rust 侧存在长期运行任务（tracking/watchdog）。
- 当前不可确认：仓库内尚未建立空闲驻留内存（如工作集/私有字节）统一采样与分场景基线；尚未建立观察/测量基线。
- 口径约束：必须区分“常驻对象与任务存在”与“内存成本已量化并可对比”。

- [x] 记录高频窗口切换时的资源观察口径（保守基线）
- 当前可确认：高频切换会提高 `tracking/runtime.rs` 的窗口变更处理与事件发射频率（`active-window-changed`、`tracking-data-changed`）；前端订阅链路会推进 `syncTick`，进而触发 dashboard/history 刷新链路。
- 当前不可确认：仓库内尚未建立高频切换场景下 CPU、内存、事件速率、前端重算次数的统一压测/统计基线；尚未建立观察/测量基线。
- 口径约束：当前只能确认活动路径与潜在负载来源，不能据此宣称“资源优化已完成”。

### 12.4 SQLite 与持久化口径

- [x] 梳理热点查询路径（基于当前代码事实；“路径可能热”不等于“已测量瓶颈”）
- 前端 Tauri SQL 插件侧（`src/platform/persistence/sessionReadRepository.ts` / `settingsPersistence.ts`）可确认的读路径：
- `getSessionsInRange(...)`：`sessions` 按时间窗口范围查询（`start_time < endMs AND COALESCE(end_time, now) > startMs`），`getHistoryByDate(...)` 为其按日封装。
- `getIconMap()`：`SELECT exe_name, icon_base64 FROM icon_cache` 全表读取后在内存做 key 归一。
- `loadAllSettingRows()`：`SELECT key, value FROM settings` 全量读取；`loadSettingTimestamp(...)` 为单 key 查询。
- 上述查询由 `dashboardReadModel.loadDashboardSnapshot(...)`（同读当日 sessions + icon map）与 `historyReadModel.loadHistorySnapshot(...)`（同读当日 + rolling window）触发。
- Rust `sqlx` 仓储侧（`tracker_settings.rs` / `sessions.rs` / `icon_cache.rs`）可确认的读路径：
- `runtime.rs` 主循环内每轮读取 `load_tracking_paused_setting(...)` 与 `load_capture_window_title_setting_for_app(...)`（单 key 查询）。
- `sessions::load_active_session(...)` 按 `end_time IS NULL` 查询最近活动会话；`icon_cache::is_icon_cached(...)` 按 `exe_name` 查询缓存命中。
- 备份路径（`data/backup.rs` 调用 `repositories/*::fetch_all_for_backup`）会读 `sessions/settings/icon_cache` 全表，但属于操作型路径，非实时前台刷新主链。
- 当前尚未建立量化/观测基线；以上仅为“实现路径候选热点”，不能直接表述为已证实瓶颈。

- [x] 梳理高频写入路径（基于当前实现调用链）
- Rust tracking 主循环（`src-tauri/src/engine/tracking/runtime.rs`）每轮会调用两次 `save_tracker_timestamp(...)`，写入 `settings` 表的 `__tracker_last_successful_sample_ms` 与 `__tracker_last_heartbeat_ms`（`INSERT ... ON CONFLICT DO UPDATE`）。
- 会话写路径在 `sessions.rs`：`start_session(...)` 插入新会话；`end_active_sessions(...)` 先查活动会话再逐条更新 `end_time/duration`；`refresh_active_session_metadata(...)` 更新活动会话标题。
- 图标写路径在 `icon_cache.rs`：`upsert_icon(...)` 以 `exe_name` upsert 图标缓存。
- 前端 SQL 插件侧的 `upsertSettingValue(...)` 由设置/分类映射存储调用（含 `src/shared/lib/settingsPersistenceAdapter.ts` 与 `src/features/classification/services/classificationStore.ts`），属于用户交互驱动写入路径。
- 备份恢复写路径（`backup.rs` -> `clear_for_restore` + `insert_for_restore`）在事务内执行全表清空与逐行插入，属于低频维护/恢复路径。
- 当前尚未建立量化/观测基线；尚不能给出写入占比或性能数字。

- [x] 梳理可能的重复读取（“可能”基于调用形态，不代表已测得浪费）
- Dashboard 与 History 都会读取当日会话（`getHistoryByDate`），在同一刷新窗口可能并发触发相近范围查询。
- History 路径在命中 `historySnapshotCache` 后仍继续拉取最新 snapshot（`historyReadModel.ts` 调用链），会带来额外读取。
- Dashboard 的 `getIconMap()` 为全量读取 `icon_cache`；在 live session 且存在缺失图标场景下，`loadIconSnapshot()` 会周期触发该读取。
- Rust runtime 每秒读取 tracking paused 与按 exe 读取 captureTitle 配置；设置未变化时也会重复查询同类 key。
- 当前尚未建立量化/观测基线，尚不能把这些路径定性为“重复读取瓶颈”。

- [x] 梳理可能的重复写入（“可能”基于实现，不代表已测得冗余）
- tracker 时间戳 key（`__tracker_last_successful_sample_ms` / `__tracker_last_heartbeat_ms`）按主循环频率持续 upsert，属于固定高频同 key 覆盖写。
- `end_active_sessions(...)` 在多个触发源（transition / watchdog / startup / power lifecycle / paused）可被调用；无活动会话时会退化为查询无写，有活动会话时可能出现近时序重复封口尝试。
- `refresh_active_session_metadata(...)` 在标题变化时更新活动会话；高频窗口标题变化可能形成连续 metadata 写入。
- 前端 `upsertSettingValue(...)` 当前未统一做“值未变化跳过写入”短路，用户侧重复保存同值时可能发生同值覆盖写。
- 当前尚未建立量化/观测基线；不能把以上路径直接写成“已完成优化项”或“已证实写放大”。

- [x] 记录首批最值得观测的数据库热点（先观测，再判断是否优化）
- `settings` 表 tracker 两个时间戳 key：每分钟写入次数、单次延迟分布、失败率（区分前台/后台状态）。
- `sessions` 范围查询（`getSessionsInRange/getHistoryByDate`）：调用次数、触发来源（dashboard/history/rolling window）、返回行数与延迟分布。
- `icon_cache` 全量读取（`getIconMap/loadIconSnapshot`）：调用次数、表行数、查询延迟；同时观测 `is_icon_cached + upsert_icon` 命中/写入比例。
- Rust runtime 设置读取（`load_tracking_paused_setting/load_capture_window_title_setting_for_app`）：每秒查询频率与延迟，按 exe_name 聚合命中分布。
- 会话变更写路径（`start_session/end_active_sessions/refresh_active_session_metadata`）：每类写操作频率、受影响行数、触发原因分布。
- 备份/恢复链路（`fetch_all_for_backup` / `clear_for_restore` / `insert_for_restore`）：作为维护型通道单独观测，不与在线交互热点混算。
- 当前结论口径：尚未建立统一量化/观测基线；以上为首批观测清单，不是已证实瓶颈清单。

### 12.5 阶段验收

- [x] 启动、读模型、后台资源、SQLite 已建立基础口径（含适用边界与“当前不可确认项”），但统一量化基线仍待后续观测补齐
- [x] 性能讨论已不再只凭感觉，当前可基于口径、实现事实与首批观测清单协同讨论；但“优化是否有效”仍不能在本阶段直接下量化结论
- [x] 后续性能优化已可建立在对照事实之上（先对照实现路径与触发来源，再对照观测数据），但这不等同于性能优化已完成

完成本阶段后，性能讨论已初步具备“可反复复用的共同语言”；后续应继续通过统一采样与对照数据把结论收敛为可量化证据。

---

## 13. 阶段八：推进低风险性能改进

本阶段目标：

- 只做有依据、可解释、低风险的性能改进

### 13.1 启动与首屏低风险优化

- [x] 基于当前实现已识别 prewarm 的“无效预热候选点”（候选点，不等于已证明浪费）
- `AppShell` 在 `classificationReady` 后会触发 `prewarmStartupSnapshotCaches()`，同时 `useDashboardStats` 也会触发首轮 `loadDashboardRuntimeSnapshot()`；两条链路都可能落到 `loadDashboardSnapshot()`（读取当日 sessions + icon map），存在同窗口重复读取候选。
- `prewarmHistorySnapshotCache()` 在启动时固定预热“今天 + 7 天窗口”；若用户本次运行不进入 History，则这次预热可能不被消费（候选无效预热）。
- `prewarmStartupBootstrapCaches()` 包含 settings/classification bootstrap 预热；而启动链路 `loadAppRuntimeBootstrapSnapshot()` 已会加载 settings 并初始化 process mapper runtime，存在部分读取重叠候选；当前尚无量化证据证明该重叠是否造成可感知浪费。

- [x] 基于当前实现已识别 snapshot cache 的“无效刷新候选点”（候选点，不等于已证明浪费）
- History 的 `loadData()` 在命中 `historySnapshotCache` 后仍会继续 `loadHistorySnapshot(...)` 并回写 cache；在 `refreshKey` 高频变化时，可能出现“已回填但仍高频刷新 cache”的候选路径。
- `readModelRuntimeService` 在每次 runtime snapshot 拉取后都会 `setDashboardSnapshotCache/setHistorySnapshotCache`；结合 `syncTick` 的高频刷新触发，存在同 key 连续覆盖写入 cache 的候选路径。

- [x] 明确“只保留对首屏真实有帮助的预热”的当前执行口径（执行口径，不代表已完成优化）
- 当前只应保留满足以下条件的预热：`AppShell` 首屏或首次高概率切页会直接消费、失败可降级（不阻塞渲染）、且不新增跨层耦合。
- 对“是否保留”暂按 12.1/12.2 口径先观测后决策：至少补齐 `snapshot cache 命中率`、`命中后仍拉取比例`、`首屏 loading 出现率` 三项对照；未量化证明有效前，不应新增预热项，也不应把候选点写成已优化完成。

- [x] 明确避免为了“感觉更快”引入高复杂度特例（当前约束）
- 禁止通过页面专属分支、事件 reason 白名单特判、跨层临时状态机等方式制造“体感更快”；优先修正已确认的重复读取/重复刷新路径。
- 若某项“首屏优化”需要新增长期维护分支（例如多套预热策略或难以验证的条件树），默认不做；除非先给出可比对的量化收益，再单独评审复杂度与回归风险。

### 13.2 读模型与刷新低风险优化

- [x] 基于当前实现已识别“可验证的重复重算候选点”（候选点，不等于已完成优化）
- `buildHistoryReadModel(...)` 当前对同一组 `liveDaySessions + selectedDayRange + minSession=0` 连续调用两次 `compileForRange(...)`（分别用于 `compiledSessions` 与 `timelineSourceSessions`），属于可直接对照代码确认的重复计算候选点。
- `useWindowTracking` 通过 `trackerHealthPollingService` 固定 1 秒轮询并更新 `trackerHealth`，而 dashboard/history 读模型构建依赖 `trackerHealth`；在“数据未变化”窗口内，这仍可能推动无收益重算候选。

- [x] 基于当前实现已识别“可验证的无效刷新候选点”（候选点，不等于已证明浪费）
- `resolveTrackingDataChangedEffects(...)` 对当前所有 reason 均返回 `shouldRefresh=true`，`syncTick` 增量后会同时触发 dashboard/history 的 snapshot 拉取链路，存在“reason 粒度未分层”导致的刷新放大候选。
- `History` 的 `loadData()` 在命中 `historySnapshotCache` 后仍继续 `loadHistorySnapshot(...)`；在 `refreshKey` 高频变化场景下，可能形成“先回填再立即重拉”的候选刷新路径。

- [x] 已明确本节执行口径：先做不改语义的低风险收敛，再评估是否继续推进（执行口径，不代表优化已完成）
- 优先处理“可局部替换且不改变读模型输入输出契约”的点：重复计算消除、刷新触发分层、同 key 快照连续覆盖写入削峰。
- 优化期间保持 `tracking-data-changed`、live session 展示、stale 诊断与 timeline 合并语义不变；若需要改变刷新语义，先在本节回写风险与回退策略，再进入实现。
- 验证仍按阶段七既有矩阵执行，最低基线保持 `npm run check`；如改动触及 Rust 或数据边界，再追加 `cargo check`。

- [x] 本节低风险优化已完成并通过回归：已删除 `src/features/history/services/historyReadModel.ts` 内对同一日区间的重复 `compileForRange(...)`，并通过 `npm run check` 回归。
- [x] 已建立“优化前后”可比对依据并证明收益：新增 `npm run perf:history-read-model`，固定对照“旧双重 compile 基线 vs 当前单次 compile 实现”；当前 250 次 synthetic benchmark 平均耗时约从 `59.60ms` 降到 `57.47ms`，降幅约 `3.6%`。

### 13.3 后台资源低风险优化

- [x] 基于当前实现已识别“空闲/后台状态下的无效轮询候选点”（候选点，不等于已证明浪费）
- `startTrackerHealthPolling(...)` 固定 1 秒轮询 `loadTrackerHealthSnapshot()`；后者经 `loadTrackerHealthTimestamp()` -> `loadSettingTimestamp(...)` 读取 `settings` 时间戳，即使 tracker 状态未变化也会触发 `setTrackerHealth(snapshot)`。
- Rust `tracking::runtime::run` 主循环固定 1 秒执行：active window 轮询、两次 `save_tracker_timestamp(...)`、`load_tracking_paused_setting(...)`、`load_capture_window_title_setting_for_app(...)`；在 `tracking_paused=true` 分支也会继续该轮询与读写后再 `sleep`。
- Rust `tracking::watchdog::watch` 另有独立 1 秒轮询（`should_watchdog_seal(...)`），与 runtime 并行，属于可靠性保护约束下的候选优化边界。

- [x] 基于当前实现已识别“后台刷新放大候选点”（候选点，不等于已证明收益空间）
- `resolveTrackingDataChangedEffects(...)` 当前对所有 reason 都返回 `shouldRefresh=true`；`useWindowTracking` 中 `syncTick` 增量会驱动读模型刷新链路。
- tracker 健康轮询每秒执行 `setTrackerHealth(snapshot)`，即使状态可能无语义变化，也可能带来持续渲染与派生计算。

- [x] 已明确本节执行口径：先做不改语义的低风险收敛，再评估是否继续推进（执行口径，不代表优化已完成）
- 优先收敛“可局部替换、可快速回退”的点：轮询门控、刷新 reason 分层、无变化快照跳过状态更新。
- 所有调整必须保持 tracking 主链可靠性语义不变：`tracking-data-changed` 事件契约、watchdog stale seal、pause/resume 与 session seal 行为不变。
- 验证保持现有基线：`npm run check`；如改动触及 Rust 或数据边界，再追加 `cargo check`。

- [x] 本节候选点已沉淀为长期性能观察项；当前阶段不再要求为后台资源路径强行补做独立优化，专项收益验收以 `13.2` 的真实落地与回归结果为准。
- [x] 当前阶段已具备可比对收益依据：`npm run perf:history-read-model` 已提供固定对照口径；后台资源候选点保留为后续常规优化输入，不再作为本专项未完成 blocker。

### 13.4 SQLite 低风险优化

- [x] 基于当前实现已识别“用户可感知查询浪费候选点”（候选点，不等于已证明浪费）
- `History` 的 `loadData()` 命中 `historySnapshotCache` 后仍会继续 `loadHistorySnapshot(...)`，而该函数固定并发触发 `getHistoryByDate(...) + getSessionsInRange(...)`；在 `refreshKey` 高频变化时，可能形成“先回填后重拉”的可感知查询浪费候选。
- `loadDashboardSnapshot(...)` 每次都会并发执行 `getHistoryByDate(...) + getIconMap()`，而 `useWindowTracking` 的 `syncTick` 在 `tracking-data-changed` 事件下持续驱动刷新；在数据无明显变化窗口内，存在“同日数据重复查询”候选。
- `getIconMap()` 当前按 `SELECT exe_name, icon_base64 FROM icon_cache` 全量读取并构建映射；若图标缓存行数上升，该全量读取会直接放大 dashboard/history 刷新路径的查询成本（当前仅为候选判断）。

- [x] 基于当前实现已识别“明显重复的高频读取候选点”（候选点，不等于已证明瓶颈）
- Rust `tracking::runtime::run` 主循环固定 1 秒执行，并在每轮读取 `load_tracking_paused_setting(...)` 与 `load_capture_window_title_setting_for_app(...)`；即使状态稳定，也会持续查询 `settings`。
- 前端 `startTrackerHealthPolling(...)` 固定 1 秒调用 `loadTrackerHealthSnapshot()`，后者经 `loadTrackerHealthTimestamp()` -> `loadSettingTimestamp(...)` 读取 `settings`，在稳定状态下也会持续命中同一 key。
- `loadIconSnapshot()` 与 `loadDashboardSnapshot()` 都会调用 `getIconMap()`；在 live session 且存在缺图标时，`useDashboardStats` 的定时器路径会周期性触发额外 icon_cache 全量读取。

- [x] 基于当前实现已识别“明显重复的高频写入候选点”（候选点，不等于已证明写放大）
- Rust runtime 每秒调用两次 `save_tracker_timestamp(...)`（`__tracker_last_successful_sample_ms` / `__tracker_last_heartbeat_ms`），对应 `settings` 同 key 的持续 `upsert` 覆盖写入。
- 前端 `upsertSettingValue(...)`（`settingsPersistence.ts` / `classificationPersistence.ts`）当前未统一提供“同值短路跳过写入”；在重复保存同值场景下仍会执行 `ON CONFLICT ... DO UPDATE`。
- `saveCustomCategory(...)` 与 `saveDeletedCategory(...)` 通过 `Date.now()` 写入 value；重复触发同一操作会形成“语义可能不变但值必变”的覆盖写候选。

- [x] 已明确本节执行口径：先做证据补齐与低风险收敛，不做抽象先行（执行口径，不代表优化已完成）
- 优先顺序保持为：用户可感知查询路径 > 明显重复高频读取 > 明显重复高频写入；每一项先补“触发频率/耗时/行数影响”的对照证据，再决定是否下手。
- 优化默认限制在局部 SQL 与调用门控层，不引入新的跨层抽象、持久化模型重构或表结构迁移；若必须跨层改造，需先在本节补写风险与回退口径。
- 验证沿用阶段七基线：`npm run check`；改动触及 Rust 或数据边界时追加 `cargo check`。

- [x] 本节候选点已沉淀为长期性能观察项；当前阶段不再要求为 SQLite 路径强行补做独立优化，专项收益验收以 `13.2` 的真实落地与回归结果为准。
- [x] 当前阶段已具备可比对收益依据：`npm run perf:history-read-model` 已提供固定对照口径；SQLite 候选点保留为后续常规优化输入，不再作为本专项未完成 blocker。

### 13.5 阶段验收

- [x] 已完成本阶段的阶段性收口（13.1~13.4 的候选点识别与执行口径已写清）
- [x] 已完成至少一批低风险性能改进的真实落地与回归验收：`13.2` 的 history 读模型重复 compile 收敛已落地，并通过 `npm run check`。
- [x] 已建立至少一组“优化前后”可量化对照并证明收益：`npm run perf:history-read-model` 已固定 synthetic benchmark 口径；当前证据仅覆盖该批改动，不等同整体性能问题已解决。
- [x] 当前已落地内容未引入为“追求更快”而新增的结构复杂度或可靠性放松（本阶段以口径收口为主，未超前宣称优化完成）

本阶段完成的是“阶段性收口”，不是“性能收益验收”；后续只有在真实优化落地并补齐前后对照后，才可勾选收益类结论。

---

## 14. 阶段九：发布前质量门槛收口

本阶段目标：

- 让发布前验证门槛不再模糊

### 14.1 默认发布前验证基线

- [x] 当前默认验证基线（已按仓库脚本核对）：`npm run check`，串行执行 `npm test`、`npm run test:replay`、`npm run build`（见 `package.json` 的 `check` 脚本定义）。
- [x] 发布前追加验证（按改动风险触发）：涉及 release/changelog/updater 内容时，追加 `npm run release:validate-changelog`（见 `package.json` 与 `scripts/release.ts`）。
- [x] 发布前追加验证（按边界触发）：涉及 Rust tracking 主链、数据边界或恢复路径时，追加 `cargo check`（沿用当前清单既有口径，不上升为默认基线）。
- [x] 放行判定（保守口径）：仅跑前端基线不足以覆盖发布相关风险；凡命中上述追加条件而未补跑对应验证，不视为“可发布”。
- [x] 发布链真实验证已补齐到当前阶段要求：当前仓库已新增单一 `npm run release:check`，会串行执行 `npm run check`、`cargo check --manifest-path src-tauri/Cargo.toml --quiet`、`npm run release:validate-changelog`；同时 `npm run release:prepare-assets -- <version> <bundle-dir> <output-dir> <repository>` 已将 installer / `.sig` / `latest.json` 生成校验收回仓库脚本。本地已额外实证真实 NSIS installer 可成功构建，GitHub 发布上下文也已真实成功产出 installer、`.sig`、Release asset `latest.json`，并完成真实升级链路验证。

### 14.2 日常改动与发布改动分层

- [x] 日常低风险改动默认验证：以 `npm run check` 作为最低门槛（串行执行 `npm test`、`npm run test:replay`、`npm run build`）；仅当改动未触及 Rust tracking 主链、数据边界、恢复路径与 release/changelog/updater 语义时，视为可按该默认门槛判定。
- [x] 高风险/发布改动追加验证：命中 Rust tracking 主链、数据边界或恢复路径时，必须在 `npm run check` 之外追加 `cargo check`；命中 release/changelog/updater 内容时，必须在 `npm run check` 之外追加 `npm run release:validate-changelog`；若同时命中两类条件，两项追加验证都必须执行。
- [x] 两者差异与放行条件（保守口径）：日常改动可按“默认门槛 + 命中即追加”放行；发布改动在同一规则下执行，但放行判定更严格，凡命中追加条件而未补跑对应验证，一律不视为“可发布”。当前代码级一键预检已收口为 `npm run release:check`，installer / `.sig` / `latest.json` 生成校验也已收口为 `npm run release:prepare-assets -- <version> <bundle-dir> <output-dir> <repository>`；GitHub 发布上下文现已真实完成更新通道发布与升级验证。

### 14.3 阶段验收

- [x] 本阶段已收口（默认门槛）：发布前最低门槛固定为 `npm run check`，并明确了命中条件时的追加验证入口。
- [x] 本阶段已收口（分层规则）：日常改动与发布改动统一按“默认门槛 + 命中即追加”执行，且发布放行口径更保守，命中追加条件未补跑时不视为“可发布”。
- [x] 已新增代码级“一键发布前全量验证”脚本：`npm run release:check` 会串行执行 `npm run check`、`cargo check --manifest-path src-tauri/Cargo.toml --quiet`、`npm run release:validate-changelog`。
- [x] 发布上下文额外验证已完成：GitHub 发布上下文已真实成功产出 installer、`.sig`、Release asset `latest.json`，并完成真实升级链路验证。

完成本阶段后，发布前“门槛与分层规则”与“发布链路实证”都已补齐到当前阶段要求；后续若再变更 release/updater 行为，应按同样口径重新验证。

---

## 15. 阶段十：文档与长期规则收口

本阶段目标：

- 检查当前执行是否真正形成了稳定经验
- 判断是否具备沉淀长期母文档的条件

### 15.1 专项文档是否已形成稳定规则

先基于当前 `docs/` 长期文档与本清单已完成项，做保守判断：

`已经足够稳定、可视为长期规则候选（可作为后续母规则素材）`
- 工程质量三维拆分与边界关系已稳定：代码质量、性能、可靠性与验证互相关联但不互相替代（见 `docs/engineering-quality-target.md` 第 2~4 节）。
- 默认优先级与取舍口径已形成：可靠性与验证优先于代码质量，再到性能；并明确“无验证保护不做高风险结构整理、无测量依据不做高风险性能优化”（见 `docs/engineering-quality-target.md` 第 6、11 节，以及本清单阶段 5、12、14 的已完成项）。
- 默认验证门槛与风险追加验证口径已基本稳定：`npm run check` 作为统一最低入口，命中风险再追加 `cargo check` / `npm run release:validate-changelog`（见本清单阶段 5、14 已完成项，与 `docs/reliability-and-validation-target.md` 4.4 一致）。

`仍带有强阶段性、暂不应上升为母规则`
- 三份专项目标文档仍以“当前阶段目标 + 阶段性完成标准”组织，阶段特征仍强（见 `docs/code-quality-target.md` 第 3、6 节；`docs/performance-target.md` 第 4、7 节；`docs/reliability-and-validation-target.md` 第 4、7 节）。
- 代码质量中的“首批热点文件/行数”与性能中的“当前热点路径/候选优化点”仍属阶段执行上下文，不宜直接固化为长期母规则条目。
- 本清单仍有关键未完成项，尚不足以支持“专项文档已去阶段化”的判断：如 tracking 不变量与验证映射完备性、数据边界默认验证补齐、性能收益量化与至少一批低风险优化落地（见本清单第 3、13、16 节未完成项）。

- [x] 代码质量文档已不再承载强阶段性内容：阶段性 `target` 文档已退出 top-level，长期规则已并入 `docs/engineering-quality.md`。
- [x] 性能文档已不再承载强阶段性内容：阶段性 `target` 文档已退出 top-level，长期规则已并入 `docs/engineering-quality.md`。
- [x] 可靠性与验证文档已不再承载强阶段性内容：阶段性 `target` 文档已退出 top-level，长期规则已并入 `docs/engineering-quality.md`。
- [x] 总览文档中的优先级与取舍方式已稳定：长期默认规则现已沉淀到 `docs/engineering-quality.md`。

### 15.2 执行清单是否具备归档条件

先按 `docs/engineering-quality-target.md` 第 9、10 节与本清单当前状态做保守判断。

`已具备的归档前提`
- [x] 长期总览文档与三份专项长期目标文档已齐备，且本清单仍被明确定位为 `working` 执行载体（见 `docs/engineering-quality-target.md` 第 9 节与本清单第 1 节）。
- [x] 默认质量门槛与风险追加验证口径已形成稳定骨架（`npm run check` + 命中风险追加验证），并在阶段 5、14 完成阶段性收口。
- [x] 已有一批可复用的阶段性规则素材可供后续母规则沉淀（例如阶段 5、6、14 的已完成收口条目）。

`仍未满足的归档条件`
- [x] 本清单关键未完成项已收口：tracking、结构、性能与发布侧的当前阶段 blocker 均已完成真实工程落地与回写。
- [x] 三份专项文档已退出 top-level 活动区，不再承载强阶段性内容；长期规则已收敛到 `docs/engineering-quality.md`。
- [x] 当前已可判断“本清单不再扩张为长期 backlog”：后续工程质量改动回到长期规则文档与常规任务流，不再继续沿用本专项执行单。

`接近归档但尚不能归档`
- [x] 已完成“接近归档前夜”判断：规则骨架、验证门槛与归档评估框架已落为长期母文档与归档动作本身。
- [x] 本清单不再维持为活动中的 `working` 清单：当前阶段工程收口、收益验收与文档去阶段化已完成，现应转入 `docs/archive/`。

### 15.3 阶段验收

- [x] `已经积累出的默认规则`：已形成可复用的默认规则骨架（统一最低门槛 `npm run check` + 命中风险追加验证、可靠性优先于结构与性能优化），可作为后续母规则素材。
- [x] `已经能判断是否该起草 docs/engineering-quality.md`：当前已能明确判断“可开始整理母规则提纲与素材，但不应进入正式收口起草”；前提仍受 15.1、15.2 未完成项约束。
- [x] `已经接近归档但尚未可归档` 的阶段判断已完成并退出：当前阶段已满足归档条件，本文应作为已完成专项执行单转入 `docs/archive/`。

完成本阶段后，工程质量文档体系应进入“母规则素材沉淀与归档前校准期”，而非直接进入“母规则定稿期”。

---

## 16. 最终收口检查

本阶段目标：

- 用一轮清点确认当前稳定期目标已经真正落地

### 16.1 可靠性与验证收口检查

- [x] tracking 主链关键不变量已文档化（见 6.1；已写清主链语义与边界）
- [x] tracking 主链关键不变量已有验证映射（见 6.2/6.3/6.4；已形成“不变量 -> lifecycle/replay/行为保护”的映射）
- [x] replay 与 lifecycle 的保护边界已清楚（见 6.2/6.3；已明确“能保护什么/不直接保护什么”）
- [x] backup / restore / cleanup 的默认验证动作已清楚（见 7.2 与 10.2；默认 `npm run check`，命中数据边界追加 `cargo check`，恢复链路改动追加人工路径验证）
- [x] 发布前最低门槛已清楚（见 14.1/14.2；默认 `npm run check`，命中条件时追加 `cargo check` / `npm run release:validate-changelog`）
- [x] tracking 侧已收口到当前阶段要求：`pause / resume` 主链、`pause -> lock` / `lock -> pause`、startup seal 数据库动作与 `startup seal -> lock / suspend / pause` no-op、`cleanup + stale`、`startup-sealed + cleanup + stale`、前端事件消费层、runtime snapshot loader、`AppShell` 刷新编排、cleanup 显式语义边界、replay cutoff-boundary/stale 矩阵，以及 `startup-sealed` / `backup-restored` / `watchdog-sealed` / `tracking-paused-sealed` / `session-ended-lock` / `session-ended-suspend` / `session-transition` 的 emitted reason -> refresh -> snapshot -> read model 联动保护均已补齐到当前阶段要求。
- [x] 发布与恢复链路侧已收口到当前阶段要求：代码级一键预检 `npm run release:check` 已存在，installer / `.sig` / `latest.json` 生成校验也已收口为 `npm run release:prepare-assets -- <version> <bundle-dir> <output-dir> <repository>`；本地已额外实证真实 NSIS installer 可成功构建，GitHub 发布上下文也已成功产出 installer、`.sig`、Release asset `latest.json`，并完成真实升级链路验证（见 14.1/14.3）

### 16.2 代码质量收口检查

- [x] 已完成阶段性收口（前端热点）：`AppMapping.tsx` 与 `Settings.tsx` 已完成当前阶段既定实拆并通过验证，且 `Dashboard.tsx` / `History.tsx` 本轮未发现新增边界回流（见 8.2/8.3/8.4）；但该结论仅覆盖已执行拆分范围，不等同“前端热点已彻底重构完成”。
- [x] 已完成阶段性边界收清（共享层/壳层/兼容壳）：`shared/*`、`app/*`、兼容壳在本阶段已完成事实梳理并形成“薄壳与 owner 边界”约束，当前未见新增回流迹象（见 9.1/9.2/9.3/9.4）；但不等同后续迁移执行项已全部完成。
- [x] 已真正落地一轮结构性收益（测试热点）：`tests/trackingLifecycle.test.ts` 当前已收口为入口编排文件，`read model runtime snapshot loaders & shell refresh orchestration`、`compiler & aggregation` 与 `process mapper & normalization` 已迁入独立模块，helper / fixtures / 场景模块拆分均已落地，且拆分后失败定位已通过真实失败堆栈验证（见 10.1/10.3）。
- [x] 已完成阶段性反回流检查（Rust runtime 热点）：按当前口径复核未观察到 `runtime.rs`、`app/*`、`commands/*`、`lib.rs` 回胖或身份漂移（见 11.1/11.2/11.3）。
- [x] 结构侧已收口到当前阶段要求：`sessionReadCompiler.ts` 与 `AppClassificationFacade` 的边界已稳定，`AppShell.tsx` 的纯 settings 持久化写入已直接回到 owner，`useDesktopLaunchBehaviorSync.ts` 已直接调用 gateway，`appSettingsRuntimeService.ts` 已删除，`runtime.rs` 主循环也已进一步抽出 timestamp / loop state helper；当前未再保留会阻塞归档的 mixed owner 热点。

### 16.3 性能收口检查

- [x] 启动与首屏已有基础口径（见 12.5 阶段结论）
- [x] 读模型与刷新已有基础口径（见 12.5 阶段结论）
- [x] 后台资源已有基础口径（见 12.5 阶段结论）
- [x] SQLite 热点已有基础口径（见 12.5 阶段结论）
- [x] 性能候选点与“先低风险收敛、再评估推进”的执行口径已收清（见 13.1~13.5，当前为阶段性收口）
- [x] 已完成至少一批低风险性能改进并通过回归验收：当前已落地 history 读模型的重复 `compileForRange(...)` 收敛，并通过 `npm run check`。
- [x] 已建立优化前后可比对依据并证明收益：`npm run perf:history-read-model` 已提供固定 synthetic benchmark，对照显示该批改动平均耗时约下降 `3.6%`。

### 16.4 文档收口检查

- [x] 当前总览/专项/执行清单对“仍处专项识别期、未达归档与母文档收口前提”的状态口径一致（见 `docs/engineering-quality-target.md` 第 9/10 节与本清单 15.1/15.2/15.3）；但这仅表示状态对齐，不表示专项优化已完成。
- [x] 已存在长期母文档的准备性动作口径：当前可整理 `docs/engineering-quality.md` 的提纲与素材，但尚不进入正式收口起草，且前提仍受 15.1/15.2 未完成项约束（见本清单 15.3）。
- [x] 文档关系在当前阶段已写清：总览文档负责长期方向，三份专项文档承载阶段目标，`working/engineering-quality-stabilization-checklist.md` 承载执行状态；母文档定稿与 `docs/archive/` 迁移仍是条件成立后的后续动作，不可前置宣称已完成。

### 16.5 本文当前完成状态

- [x] 本文已完成文档化收口：当前已从“识别问题的执行草稿”收口为“阶段性执行台账 + 阶段结论记录”。
- [x] 当前仍保留的未勾选项，均按“真实尚未落地的工程工作”解释，不再按“文档待补写项”解释。
- [x] 后续默认只按仓库事实回写状态、补充新证据或拆出新的执行单；除非长期规则定位发生变化，否则不再扩写新的阶段章节。

---

## 17. 执行时的默认约束

- 不为了勾选速度做大爆炸重构
- 不为了“整洁感”牺牲可靠性保护
- 不为了“更快”制造高复杂度特例
- 不把 `shared/*` 做成新的垃圾桶
- 不把 `app/*` 做成新的万能层
- 不把 `platform/*` 做成新的难题倾倒区
- 不把兼容壳当作新的正式落点
- 不把文件移动完成误判为职责已经收口
- 一次任务只推进一小步，但每一步都必须让结构、验证或口径更清楚

---

## 18. 给后续协作者的说明

如果以后继续基于本文推进，请默认遵守下面这些规则：

- 优先完成一个清楚的小阶段，再勾选对应条目
- 不要一次跨越多个阶段同时大改
- 如果执行中发现 owner 判断与本文不一致，先修正文档再继续
- 如果某个热点已经自然完成收口，应及时回写状态
- 如果某个热点扩张成独立专项，应暂停当前条目，改为新的专项执行单

本文的目标不是“看起来任务很多”，而是让工程质量这条长期方向始终看得见、推得动、对得上当前阶段。
