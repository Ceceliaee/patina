# 冗余代码收敛执行方案

> 状态：实施完成并归档；归档日期 2026-09-27。归档后对抗式审查已完成，发现项已修复并验证。
> 创建日期：2026-09-27。
> 检查基线：`de11ac5` 与检查时的工作区；实施前按阶段 A 重新确认。
> 执行责任：本轮执行者；代码归属按各工作包列出的 owner。
> 生命周期：一次性工作执行单。完成、否决或明确移交所有适用项后，按仓库规则归档。

## 1. 目标、依据与范围

本方案要减少已经失去职责的实现、重复表示的状态，以及验证旧路径的维护成本，同时保持用户当前可观察的行为和数据保证。产出应是更少的实现与状态、更贴近生产的验证，以及可解释的剩余例外。

长期约束由以下文档持有，本方案只记录这轮工作的操作和证据：

- [产品原则与范围](../product-principles-and-scope.md)：个人、本地优先、计时可信和数据可控。
- [架构](../architecture.md)：真实 owner、唯一实现、写侧与读模型边界。
- [工程质量](../engineering-quality.md)：测试层级、验证门槛、性能证据和测试删除条件。
- [修复边界守则](../issue-fix-boundary-guardrails.md)：小修、边界判断与执行单的适用范围。
- [Quiet Pro](../quiet-pro-component-guidelines.md)：涉及组件时的交互、焦点和视觉约束。
- [AGENTS.md](../../AGENTS.md)：任务授权、既有改动保护、文档生命周期和编码。
- [package.json](../../package.json)：实际命令与测试执行图。本文列出的命令是本次工作入口，不构成第二份命令清单。

范围包括 11 项主要发现、少量次级候选及对应测试、性能脚本和检查器中的专属残留。数据库迁移、旧备份读取、外部协议、权限 guard、文件恢复、凭据处理和发布行为不属于删除目标。备份与导出调度策略继续独立。

本方案不要求安装新依赖、重构整个目录、修改产品功能或新建通用框架。用户已在后续请求中授权实施、完成后勾选归档及对抗式审查。提交、推送、分支、PR、Issue、Project 和发布仍按各自授权规则处理。

## 2. 从第一性原理判断什么可以消失

### 2.1 必要性来自当前承诺和真实消费者

一段实现有保留价值，是因为它承担产品行为、数据兼容、边界校验或运行生命周期中的具体职责。导出、测试调用、历史文档提及和文件体积都不能单独证明这项职责仍然存在。

对每个候选沿以下顺序判断：当前需要什么结果 → 谁拥有输入事实与副作用 → 哪条生产路径实现结果 → 候选是否还承担独有职责 → 删除后靠什么观察行为不变。

因此，静态无引用仅用于发现候选；删除前还要检查动态 import、组件注册、IPC、生成入口和已发布消费者。检查无法排除这些消费者时，保留该候选并记录未决点。

### 2.2 测试应该观察真实实现

如果产品和测试分别调用两套业务实现，测试通过只能证明测试调用的那一套成立。正确的收敛顺序是提取有效场景、让测试进入当前 owner、证明断言能检测错误，再移除旧实现和只固定旧实现细节的断言。

独立的参考算法可以有价值，但必须明确它用于差分验证，并能解释独立性和维护责任。不能把没有差分用途的旧实现改名为测试工具，就视为完成删除。

### 2.3 状态必须有不可替代的职责

对状态列出创建、更新、读取、失效、取消、发布、清理和持久化的路径。两个变量只有在表达同一事实、生命周期一致且删除同步逻辑后仍保持行为时，才适合合并。

缓存容量、请求去重、结果发布顺序和失效是不同事实。容量为 1 的 LRU 可以简化；generation 与 pending 请求不能因此一并删除。

### 2.4 重复代码要按语义与 owner 收敛

同一个 owner 内完全相同的查询和行映射适合共享。不同格式的编码、不同排序要求和不同 UI 交互不能仅因源码相似而统一。共享后新增的参数、分支和生命周期责任必须少于被删除的机制。

每包记录生产、测试、工具和文档的增删，另列消失的接口、状态和实现。零运行时调用的源码清理主要降低维护成本，不直接宣称减少安装包或加快运行。体积和性能收益只有实测后才能报告。

## 3. 检查基线与证据限度

2026-09-27 的前置审计扫描了 `src`、`src-tauri/src` 共 597 个文件，并检查测试、脚本、调用与注册入口。下列记录仅属于修改前基线，不能替代实施后的验收。

| 已执行检查 | 基线结果 | 能说明的范围 |
| --- | --- | --- |
| `quality:exports` 对应脚本 | internal-only 4、test-only 99、unreferenced 1 | 语言服务导出使用提示；test-only 也可能在同模块内用于生产 |
| `quality:hotspots` 对应脚本 | 已生成候选报告并复核重点调用链 | 文件大小、文本重复与引用提示，不是删除证明 |
| `tsc --noEmit -p tsconfig.json` | 通过 | 当前前端配置下的类型与局部未使用检查 |
| `cargo check --manifest-path src-tauri/Cargo.toml --offline --locked --quiet` | 通过 | 当前本机目标的离线编译；不代表 Rust 测试或 clippy 通过 |
| IPC 契约检查 | 通过：103 个 platform 调用、105 个注册 command | 检查器覆盖的调用、注册与权限配置一致性 |
| 测试入口治理 | 通过：51 个顶层测试，无默认门禁重复 | 测试执行图，无权证明测试语义与生产一致 |
| 前端及 Rust 架构边界检查 | 通过 | 当前静态边界规则 |

前置审计没有运行完整行为门禁、桌面交互或本轮性能对比。CSS 的字面无引用报告包含动态类名，不能批量删除。所有候选以实际实施时的调用事实为准。

## 4. 工作包与执行顺序

| 编号 | 内容 | 主要 owner | 依赖与预期终点 |
| --- | --- | --- | --- |
| R1 | 旧应用目录 SQL 与旧性能基准 | Rust activity read model、classification persistence、perf | 先验证当前目录路径，再删除旧 SQL |
| R2 | 测试专用的旧计时状态解析器 | Rust tracking domain / engine | 先迁移有效场景，再删除旧模块 |
| R3 | History 测试入口与生产入口分叉 | app read-model orchestration、History cache | 只剩一条编排路径，测试覆盖真实缓存发布 |
| R4 | 旧页面预加载调度器 | app preload / startup warmup | 删除闲置调度，保留按需加载与当前预热 |
| R5 | 前端旧 SQL 批量写 helper | persistence、mutation tests | 删除失效写入接口，保留串行任务执行器 |
| R6 | Data 旧日期草稿与单选逻辑 | Data、共享日期选择器 | 删除旧交互分支，测试当前日期选择和多选 |
| R7 | 备份恢复旧组合入口 | Settings actions | 测试与 UI 使用同一准备／提交路径 |
| R8 | 清理计划的重复构造与恒定字段 | Settings cleanup | 一次截止时间计算、一次实际清理调用 |
| R9 | CSV / Parquet 重复读取 | Rust data/export | 同一读取实现、独立格式编码 |
| R10 | Dashboard 单条 LRU | Dashboard snapshot cache | 单槽缓存，保留发布代数和失效行为 |
| R11 | 无消费者的 QuietInlineAction | shared components / styles | 删除孤立组件，保留活跃按钮样式 |
| S1–S4 | 次级包装、导出面、CSS、弹层候选 | 各原有 owner | 按收益决定执行、保留或否决 |

推荐按 A → B → C → D → E → F 推进。阶段 B 处理 R4、R5、R6、R7、R11；阶段 C 处理 R1、R2、R3；阶段 D 处理 R8、R9、R10；阶段 E 处置次级候选；阶段 F 汇总验收。R1–R3 的价值较高，但测试迁移风险也较高，不与其他包混成不可区分的大 diff。

不同包可独立推进；某包证据不足只阻塞该包。执行顺序不意味着创建对应数量的提交，也不授予提交权限。

## 5. 阶段 A：建立可复核的执行起点

- [x] A1：读取当前 `AGENTS.md` 和命中的长期 owner，确认用户已授权的实施范围。
- [x] A2：记录当前 HEAD、`git status --short` 和已有 diff。检查时已有侧栏、About、样式检查器与图片改动；重新核实当前状态，不覆盖、不代为回退。
- [x] A3：对即将处理的候选运行精确符号与模块路径检索，区分生产、同文件内部、测试、脚本、动态注册和兼容消费者。使用 `rg -n`，不使用宽泛文本替换删除。
- [x] A4：运行 `pnpm run quality:exports`、`pnpm run quality:hotspots`，只保存与本轮候选有关的结论。复核默认执行没有开启写入选项。
- [x] A5：为每个进入实施的包确定一个可观察终点、真实 owner 和现有测试落点；将新发现的生产消费者记入第 12 节，必要时撤回候选。
- [x] A6：确认比较依据：R9 修改前 19 项 Rust export 测试通过；两份 loader 在迁移前逐字一致。R1 不比较旧算法耗时，改用当前生产算法的固定规模预算验证，不宣称性能提升。详见第 12 节偏差。
- [x] A7：检查需要联网的工具代理、代理环境变量与 Windows 系统代理，按当前配置在进程范围使用；不输出凭据、不改永久配置、不把 PAC URL 当代理地址。纯离线检查无需为了本方案主动联网。

进入下一阶段的条件：目标文件和既有改动能够区分，候选有证据，验收入口可执行或明确说明受阻原因。测试与临时数据库使用隔离 fixture，不操作用户真实记录。

## 6. 阶段 B：清除已退出生产的接口与机制

### R4：移除旧页面预加载调度器

依据：[viewChunkPreloadService.ts](../../src/app/services/viewChunkPreloadService.ts) 的 `scheduleLazyViewChunkPreload` 只被测试调用；当前预热由 [startupWarmupService.ts](../../src/app/services/startupWarmupService.ts) 编排。业务需要页面加载、去重和预热，并不需要同时保留两套调度器。

- [x] R4.1：重新检索调度函数与模块导入，确认启动、导航和开发入口均不使用旧调度函数。
- [x] R4.2：列出旧函数独占的选项类型、默认顺序、延迟常量、idle callback 和取消 helper；区分仍由 `preloadLazyViewChunk` 使用的 loader 类型及依赖参数。
- [x] R4.3：审查 `tests/viewChunkPreloadService.test.ts`，把“旧调度策略”与“实际 chunk 加载行为”分开；只删除前者专属断言。
- [x] R4.4：删除旧调度函数及其独占依赖，保留模块记录、pending 合并、错误状态、失败后重试和 `createPreloadableViewComponent`。
- [x] R4.5：运行 `pnpm run test:preload`、`pnpm run test:warmup`，核对当前预热取消、导航加载及共享 promise 场景。
- [x] R4.6：复查动态 import 和生产构建中的页面加载边界，确认未把懒加载页面改为静态导入。

验收：旧调度及专属测试消失；生产预热顺序与策略不变。若发现真实消费者，先确认其与当前预热的职责，停止直接删除该函数。

### R5：移除前端 SQL 批量写接口

依据：[sqliteTransactions.ts](../../src/platform/persistence/sqliteTransactions.ts) 中批量写 helper 仅被测试和 mutation 调用；同文件的 `createSerializedJobRunner` 仍承担快照写入的排序和失败后释放责任。

- [x] R5.1：复核 `SqlWriteExecutor`、`SqlWriteOperation`、`executeWriteBatchWithExecutor` 的全部引用和前端 SQL 写权限边界。
- [x] R5.2：删除这三个专属声明，保留串行任务执行器及 Data、History 调用，不为消除文件名历史顺手迁移其他模块。
- [x] R5.3：从 `tests/persistenceTransaction.test.ts` 删除仅验证旧批量写循环的用例；保留串行顺序、异常释放、后续任务继续以及 command error 行为。
- [x] R5.4：检查 `scripts/check-critical-mutations.ts`，仅退役针对旧循环和缺失 await 的专属变异；保留串行 runner 与错误解析的有效变异及验证函数。
- [x] R5.5：审查架构检查器中的该文件例外。只删除因旧写入接口存在而需要的例外，若变更检查器，补对应正反自测。
- [x] R5.6：保留有效 coverage 风险域和阈值，不通过移除整个文件的 coverage 配置完成清理；运行 `test:persistence`、`test:mutation` 及受影响检查器自测。

验收：前端不再维护旧 SQL 执行接口；快照串行化及其失败保护仍由真实生产测试覆盖。

### R6：删除 Data 旧交互实现

依据：[dataTrendRange.ts](../../src/features/data/services/dataTrendRange.ts) 的日期草稿逻辑已由 [QuietDateRangePicker.tsx](../../src/shared/components/QuietDateRangePicker.tsx) 承担；[dataAppSearch.ts](../../src/features/data/services/dataAppSearch.ts) 的旧单选决策不参与当前多选页面。

- [x] R6.1：沿 `DataTrendRangePicker` 到共享选择器确认当前草稿 owner，复核 `DataTrendRangeDraft` 和 `selectDataTrendDraftDate` 无其他消费者。
- [x] R6.2：列出旧测试保护的用户事实：起止日期反选、再次开始选择、未来日期拒绝、周/月/年选择、确认与取消；将仍适用的场景对应到当前选择器已有测试。
- [x] R6.3：仅在现有保护缺失时补当前组件行为测试，然后删除旧草稿接口、函数和失效测试。保留 `resolveDataTrendRange` 等真实范围计算。
- [x] R6.4：复核 `resolveDataAppSearchSelection` 的旧单选语义；确认当前多选、过滤及选择协调的 owner，不把旧自动选中规则迁回新 UI。
- [x] R6.5：删除旧单选 helper、专属参数类型和测试；保留 `dedupeDataAppOptions`、`filterDataAppOptionsForQuery` 及其有效用例。
- [x] R6.6：运行 `test:data-range`、`test:data`、相关共享组件测试及 browser 场景；观察搜索清空、多选保留、日期确认／取消和键盘焦点。

验收：产品交互未改变；测试进入实际 UI 或其真实纯函数，不再为旧状态机保留生产代码。

### R7：移除备份恢复旧组合入口

依据：[settingsPageActions.ts](../../src/features/settings/services/settingsPageActions.ts) 的 `runBackupRestoreFlow` 只有测试消费者；Settings 实际分别调用准备和提交函数。

- [x] R7.1：确认本地恢复及其他恢复入口如何调用准备、展示预览和提交；核对无字符串注册调用旧组合函数。
- [x] R7.2：将旧组合测试改为对当前准备与提交行为的断言，不新增另一套恢复业务实现。
- [x] R7.3：覆盖取消选择、不兼容备份拒绝、预览失败、确认取消、成功后的通知／刷新，以及执行失败后的 busy 释放；已有稳定测试直接复用。
- [x] R7.4：确认提交继续传递用户确认的路径、策略和 preview hash，保留旧格式恢复后的提示；不更改后端兼容 reader。
- [x] R7.5：删除 `runBackupRestoreFlow` 和仅服务它的 `BackupRestoreFlowOptions`，清理失效 import。
- [x] R7.6：运行 `test:settings` 及备份恢复 UI 相关场景；若实际 diff 涉及文件切换或后端恢复，按长期风险路由扩展验证并重新评估范围。

验收：同一准备／提交链同时服务 UI 与测试，恢复安全保证未减少。

### R11：删除孤立行内操作组件

依据：原 `src/shared/components/QuietInlineAction.tsx`（本轮删除） 无产品、测试和动态入口；Data 与 Destination 仍直接消费 `qp-inline-action` 样式。

- [x] R11.1：复核组件名称、文件路径、动态 import 和生成入口；确认没有新增消费者。
- [x] R11.2：删除孤立组件文件，保留仍被引用的 Tooltip、按钮基础样式与 accent 状态。
- [x] R11.3：对 neutral／warning／danger 样式单独追踪动态类名；仅在证明无消费者时清理，不能因组件删除就删掉整份样式文件。
- [x] R11.4：核对 Data、Destination 的重试按钮点击、禁用和 focus-visible 行为；纯孤立文件删除不新增镜像测试。
- [x] R11.5：运行类型、样式门禁和适用 UI 验证，记录删除的是组件、样式还是两者。

验收：孤立文件消失，现有按钮表现与行为保持。

## 7. 阶段 C：让测试和性能证据回到真实生产路径

### R1：退出旧应用目录 SQL

依据：[classificationPersistence.ts](../../src/platform/persistence/classificationPersistence.ts) 的 `buildRecordedAppCatalogQuery` 已不用于产品；实际通过 `loadActivityCatalogPage` 进入 [catalog.rs](../../src-tauri/src/data/activity_read_model/catalog.rs)。旧基准仍属于 `perf:stable`，应先替换其验证对象。

- [x] R1.1：记录当前链路：classification service → persistence gateway → `cmd_get_recorded_app_catalog_page` → Rust catalog owner；确认 SQL fallback 由当前 Rust 实现持有。
- [x] R1.2：逐项提取旧测试与基准的意图：首屏、后续 cursor、名称搜索、特殊 LIKE 字符、空结果、来源优先级、最后记录删除、应用数量与数据量预算。
- [x] R1.3：对照 Rust 现有 catalog 测试，复用已有覆盖，把缺失意图放到真实 `load_page` 路径；加入当前特有的修订变化及投影／fallback 场景，不复制旧 SQL 作为新断言。
- [x] R1.4：检查旧 fixture 是否与当前生产过滤规则一致。先证明 fixture 中预期应用确实可追踪、返回数量和排序正确，再测量速度。
- [x] R1.5：在 Rust owner 内或已有性能入口建立可直接调用当前目录实现的确定性基准。复用隔离数据库、计时与清理机制；不要为 benchmark 给产品新增 IPC 或 public API。
- [x] R1.6：覆盖首屏、深分页、搜索、投影命中和必要 fallback，记录数据规模、实际返回条数、读取路径、查询计划与耗时分布。本轮算法不变，记录当前算法预算与稳定重复结果，不作旧 TS 算法对比。
- [x] R1.7：将新基准接入既有稳定性能执行路径，保留子进程失败、超预算和不允许 table scan 的失败传播；若入口需变更，记录原意图到新入口的对应关系。
- [x] R1.8：在替代验证成立后删除旧查询、专属 SQL 转义 helper 和结果类型；保留真实 gateway 仍使用的 cursor、输入、输出类型。
- [x] R1.9：删除或改写旧基准及旧查询专属测试，清理脚本引用。不通过直接移除 `perf:stable` 项目来获得通过，不把旧算法耗时当新算法基线。
- [x] R1.10：运行 `test:classification`、相关 Rust catalog 测试、检查器自测和 `perf:stable`；确保快速测试 owner、专项 benchmark 入口可达且无重复默认执行。

验收：仓库只维护当前目录生产实现；性能报告测量当前实现并保留原先有价值的预算保护。若新基准尚不能可靠调用生产路径，暂时保留旧基准并明确其局限，不能宣布 R1 完成。

### R2：删除旧计时状态解析器

依据：原 `src-tauri/src/domain/tracking/status_resolution.rs`（本轮删除） 及其输入类型被 `allow(dead_code)` 保留；真实解析在 [sustained_participation.rs](../../src-tauri/src/engine/tracking/sustained_participation.rs)，并被运行循环调用。

- [x] R2.1：复核 Rust 模块可见性、重导出、command 和运行循环，确认旧函数不是协议或已发布数据 reader，也没有外部可访问的受支持调用者。
- [x] R2.2：为旧 domain 测试建立场景对应：连续性无信号、已匹配系统媒体、未知播放器音频、浏览器音频、超过通用 AFK 但未超过持续参与阈值。
- [x] R2.3：使用当前 `SustainedParticipationStatusInput` 和受控时间在 engine 测试中表达这五个场景；直接调用生产解析器并显式指定系统媒体／音频通道，避免旧单信号假设。
- [x] R2.4：保留并核对双信号优先级、明确暂停、暂时丢失、宽限期到期、身份变化、空窗口和 tracking pause 的当前测试。旧算法与新算法不等价，不逐字段照搬旧默认诊断值。
- [x] R2.5：确认每项新增或迁移断言观察实际状态、原因或截止行为，能区分信号匹配错误和错误激活；不依赖真实前台应用或媒体播放。
- [x] R2.6：删除旧解析模块、路径声明、重导出、专属输入类型及对应 suppression；保留当前 engine 使用的 domain 身份和信号匹配函数。
- [x] R2.7：运行相关 Rust tracking 测试，再按 Rust／运行主链风险执行完整要求；检查暂停、AFK、持续参与和会话封口的验证责任没有缺口。

验收：计时状态只有实际运行的解析路径，测试不再维护第二套简化业务实现。若某旧场景与当前契约冲突，记录应保留的行为及 owner 判断，不顺手修改真实算法。

### R3：收敛 History runtime 的测试分叉

依据：[readModelRuntimeService.ts](../../src/app/services/readModelRuntimeService.ts) 中测试专用 `loadHistoryRuntimeSnapshotWithDeps` 自行加载并发布；真实入口调用 [historySnapshotCache.ts](../../src/features/history/services/historySnapshotCache.ts) 的 `loadHistorySnapshotWithCache`。

- [x] R3.1：画清最小调用关系：mapper ready → 实际 snapshot loader → 请求合并 → 可发布检查 → cache 写入 → 调用者返回；标明 app 仅承担协调。
- [x] R3.2：检查 `tests/trackingLifecycle/readModelRuntime.ts` 的旧 helper 用例，将业务数据场景与 app 前置就绪／缓存发布场景分开。
- [x] R3.3：优先复用真实 cache loader 的依赖注入；若 app 协调需要测试入口，让生产函数也走该入口，禁止继续维护另一套加载／写缓存实现。
- [x] R3.4：把数据组合断言放回真实 read model，把 mapper 等待顺序放在协调测试，把缓存竞态放在 cache owner 测试；不引入全局可变测试开关。
- [x] R3.5：使用显式 promise 闸门覆盖同 key 合并、不同日期／范围／web／details 参数、失败后重试、清理后旧请求不能发布，以及新快照覆盖期间的旧请求完成。
- [x] R3.6：保留“请求可以返回但不再有权发布”的区别；检查拒绝、finally 清理和 mapper 失败时不继续读取的行为。
- [x] R3.7：删除旧的独立实现与无用依赖类型；保留已成为生产共用入口的 `loadHistoryRuntimeSnapshotWithDeps` 及其测试导入，确认真实 UI 和测试走同一协调路径。
- [x] R3.8：运行 `test:tracking`、`test:history-timeline`、`test:warmup`；性能敏感路径按风险追加 `perf:stable`，不能靠绕过 mapper 或 cache 提升数字。

验收：测试会观察生产编排的等待和发布错误；app 层没有吸收 History 缓存实现。

## 8. 阶段 D：减少重复表示和同 owner 实现

### R8：简化历史清理参数流

依据：[settingsRuntimeAdapterService.ts](../../src/features/settings/services/settingsRuntimeAdapterService.ts) 先创建计划再传回原参数；[sessionCleanupPolicy.ts](../../src/features/settings/services/sessionCleanupPolicy.ts) 再建一次计划，实际只使用 `cutoffTime`。恒定说明字段不执行保护。

- [x] R8.1：追踪 UI range → 本地日期截止计算 → Rust 清理 command，确认清理单位、比较符和活动会话处理的真实 owner。
- [x] R8.2：检索计划全部字段，区分生产读取与测试自证。确认计划不是持久化数据、IPC payload 或支持的外部 API。
- [x] R8.3：把适用测试改为断言实际传出的截止时间、调用次数和异常传播；删除仅断言三个字段恒为 true 的用例。
- [x] R8.4：在现有 owner 中保留一个截止时间计算入口，直接交给清理依赖；删除两次计划构造、无用途字段和只转发的执行层。
- [x] R8.5：保留按本地日历减天数的语义；验证跨月、跨年，以及支持环境下的时区／夏令时边界，不能替换成固定毫秒减法。
- [x] R8.6：由真实数据清理测试确认截止前、恰好截止、截止后及跨截止活动记录的处理；前端测试中的 `shouldDeleteSessionByStartTime` 不能冒充 Rust 数据验证。
- [x] R8.7：运行 `test:settings`、受影响的 tracking／replay 测试和命中的 Rust 数据测试。仅移除计划表示，不更改清理 SQL 或其他数据域政策。

验收：一次计算、一次清理调用；用户选择和落盘清理边界不变。任何实际数据政策变化都转为独立问题，暂停本包的相关实现。

### R9：共用 CSV 与 Parquet 的导出读取

依据：[csv_exporter.rs](../../src-tauri/src/data/export/csv_exporter.rs) 与 [parquet_exporter.rs](../../src-tauri/src/data/export/parquet_exporter.rs) 重复定义 session／web 行和相同查询。共享点是导出事实读取，编码仍归各格式。

- [x] R9.1：逐字段比较两份行结构、SQL、参数顺序、排序、空值和错误信息，确认是否仍完全一致；列出实际差异再确定共享范围。
- [x] R9.2：检查 [common.rs](../../src-tauri/src/data/export/common.rs) 的现有职责。优先在 `data/export` 内复用足够窄的具体读取函数；若独立文件确有必要，按架构 owner 重新判断后确定，不新增通用查询框架。
- [x] R9.3：用隔离数据库固定样本：已结束与未结束 session、空字段、标题特殊字符、网页记录、匿名记录、仅起点／仅终点／双边界过滤、相同时间不同 ID。
- [x] R9.4：复用修改前已通过的格式输出断言作基线，明确 CSV 文本／转义与 Parquet 类型／null 的差异；新加边界 fixture 在迁移后验证，不冒充保存过迁移前的文件字节。
- [x] R9.5：提取一份行结构和读取实现，两个 exporter 调用它；保持时间重叠条件、`effective_now_ms`、排序及分类加载行为。
- [x] R9.6：保留 CSV 的 Excel 公式防护和 Parquet 的 typed column 构建；不把格式逻辑塞入读取函数，不改变文件发布策略。
- [x] R9.7：Markdown 按 `start_time, id` 排序，与本包 `id` 排序不同；本包默认保留其读取路径，不为强行复用增加排序开关。
- [x] R9.8：解析重构后的两个输出并对照原有断言及新增边界预期，验证字段顺序、记录顺序、空值、时间过滤、匿名数据和错误传播；检查是否新增 clone、重复查询或全量中间副本。
- [x] R9.9：删除被替代的私有行类型与 loader；运行相关 Rust export 测试、`test:export`，检查结构边界与完整门禁。

验收：两个 exporter 只维护一份相同读取逻辑，格式行为和受保护的数据边界保持。收益来自真正删除重复实现；若共享需要比原代码更多分支，收窄或撤回共享方案。

### R10：将 Dashboard 容量为 1 的缓存改为单槽

依据：[dashboardSnapshotCache.ts](../../src/features/dashboard/services/dashboardSnapshotCache.ts) 当前容量固定为 1，Map 读取重排与循环淘汰不提供额外行为。

- [x] R10.1：复核容量、日期 key、读写调用、诊断统计和测试；确认没有运行时配置会扩大容量。
- [x] R10.2：记录当前状态职责：槽位存储日期与快照；generation 决定加载结果是否仍有发布权；clear 同时失效槽位与旧发布权。
- [x] R10.3：复用现有测试，确认覆盖同日读取、不同日不命中、后一次写入替换、旧请求晚完成、clear 后旧请求完成和容量统计。
- [x] R10.4：用一个可空的日期键／快照记录替代 Map，删除读取时重排和淘汰循环，保持本地日期 key 和默认时间语义。
- [x] R10.5：保留 `beginDashboardSnapshotCacheLoad` 的 generation 防护；诊断 `entries` 继续返回 0 或 1，limit 继续反映实际容量。
- [x] R10.6：检查 Dashboard 首屏、History seed 和启动预热调用，运行 `test:dashboard-snapshot`、`test:warmup`、`test:tracking`，按性能风险运行相关稳定基准。

验收：容器与操作减少，跨日读取和异步发布顺序不变。若发现确需多条缓存的当前契约，保留 Map 并关闭本候选，不以扩展缓存容量完成清理。

## 9. 阶段 E：处置次级候选

这些条目的终点可以是保留或否决。不能为达到删除数量而增加测试辅助框架或 UI 行为变化。

### S1：仅用于测试的包装与观察接口

- [x] S1.1：复核 `buildDataAppTrendViewModel`、`buildHistoryTimelineViewModel`、`buildHistoryWebTimelineViewModel` 的当前消费者及底层真实函数。
- [x] S1.2：判断它们是必要的纯组合测试便利函数，还是掩盖了生产流程差异。纯组合可由测试直接调用真实步骤，或移到一个小型测试 helper；不得搬运业务算法。
- [x] S1.3：复核 `getDataDestinationSessionOptions`、`shouldDeleteSessionByStartTime`、`isRetryableCommandError`，只有在不丢失独有验证且有净收益时移除或改写消费者。
- [x] S1.4：保留验证缓存限额和资源释放所需的 stats／reset 接口；例如 `getDataWebActivitySnapshotCacheStats` 只有测试调用并不自动构成删除理由。
- [x] S1.5：记录每项决定及真实验证落点，避免一批删除“test-only”导出。

### S2：收窄无外部消费者的导出面

- [x] S2.1：复核 `EXPORT_RANGE_MODES`、`WEB_LINK_GROUP_PREFIX`、`CompiledWebActivitySegment`、`ThemePreset` 的跨模块、类型及生成引用。
- [x] S2.2：仍仅在内部使用时去掉多余 export，保留声明和行为；若出现新消费者则保留。
- [x] S2.3：运行类型检查并复核导出报告，不把导出数量归零设为目标。

### S3：样式残留

- [x] S3.1：复核热力图 skeleton／swatch、settings action trigger 和 R11 的 tone 类等候选，检查 JSX 模板字符串、class 组合、测试注入及样式 import。
- [x] S3.2：对真实无 DOM 消费者的选择器单独删除；组合规则只移除无用分支，保留仍有效的选择器和声明。
- [x] S3.3：区分“禁止重新出现某元素”的有效负向测试与失效测试，不因元素当前不存在就删除前者。
- [x] S3.4：如有实际样式删除，核对主题、hover、禁用、焦点及相关 browser 场景，保持现有样式预算不放宽。

### S4：日期／时间弹层重复逻辑

- [x] S4.1：比较 DatePicker、TimePicker 与 AnchoredPopover 的开关、定位、滚动、Escape、外部点击、初始焦点和焦点返回行为。
- [x] S4.2：明确当前差异：日期／时间弹层随滚动更新位置，AnchoredPopover 可因外部滚动关闭；角色、几何与焦点也不完全相同。
- [x] S4.3：评估窄范围复用的净复杂度；结果为不满足保留现有行为且减少复杂度的条件，本轮否决合并，没有提出新的抽象。
- [x] S4.4：若需要大量配置、统一不同交互或新通用控制器，记录否决并保留现状。本项评估完成不等于组件已合并。

## 10. 阶段 F：验证与交付

### 10.1 验证选择

各包的 focused 测试用于快速定位风险，不能替代 [默认验证门槛](../engineering-quality.md#5-默认验证门槛)。执行前核对 `package.json` 中当前入口。相同输入和环境下有效证据可以复用；代码、base、配置或验证规则变化后，只重跑失效证据和应适用的默认门槛。

| 实际变化 | 本轮验证责任 |
| --- | --- |
| 仅编制或更新本计划 | `pnpm run check:docs`，另对本文件验证 UTF-8、相对链接、锚点、符号和命令 |
| 前端行为变化 | focused 证据加 `pnpm run check` |
| Rust、架构实现边界或完整跨栈收敛 | `pnpm run check:full`；Rust 检查遵循其实际命令图，避免重复执行 |
| 目录／缓存等性能敏感路径 | `pnpm run perf:stable`；串行测量，记录同输入比较及真实读取路径 |
| IPC、capability、SQLite plugin 或真实桌面运行时变化 | 追加 `pnpm run test:tauri-runtime-smoke`，不把纯 Rust 代码删除自动视为已改变 IPC |
| 检查器、测试 owner 或性能入口变化 | 对应自测、真实调用路径和失败传播；不得靠移除门禁通过 |

本轮完整实施包含 Rust 与边界调整，因此总体验收按 `check:full` 加命中的风险入口进行。依赖审计若联网受阻，按现行受控离线规则记录证据有效性和限制，不把无效缓存当作成功。

### 10.2 完成清单

- [x] F1：逐包复查生产 diff，证明承诺删除的机制已经消失，未以别名、兼容壳或新测试业务实现留存。
- [x] F2：逐包复查测试 diff，明确删除测试的原因、保留行为的真实测试落点和独有失败模式；coverage 与 mutation 的有效保护未被整块移除。
- [x] F3：重新运行导出和热点报告，对新增候选只作诊断，不借机扩大范围。
- [x] F4：核对动态 import、command 注册、权限边界、前后端 owner 和测试执行图，无孤儿入口或默认重复执行。
- [x] F5：完成实际 diff 命中的默认门槛与风险验证；记录不可运行项的原因、残余风险、负责补证据的 owner，不勾选其通过状态。
- [x] F6：按生产、测试、工具、文档分别统计增删，列出减少的接口、状态与实现数量；不要把测试删除行数当成生产收益。
- [x] F7：核对整个工作区，确认其他任务的改动未被修改、提交或回退；若确有重叠，记录这轮实际拥有的 diff。
- [x] F8：复核是否改变长期事实或契约。只有事实确实变化或发现 owner 文档错误时更新该 owner，完成已有契约不要求改母文档。
- [x] F9：在第 12 节记录各包的最终处置、验证证据与剩余风险；未实施项写“否决”或“移交及 owner”，不能记作代码已完成。

## 11. 失败处理与恢复

以下为条件分支。已在收尾复核：检查失败按第三条修复并补证；其余升级条件未触发，不把未发生的动作勾为已执行。

- 发现新生产消费者：暂停该候选删除，记录消费者、职责与影响，继续独立工作包。
- 迁移测试暴露生产缺陷：记录最小复现、当前 owner 和影响；与冗余清理分开判断，避免顺手改变计时、恢复或清理契约。
- 类型或行为检查失败：先判断是否由本包引入。修复本包问题；若需撤销，只撤销本包自己的修改，不覆盖已有用户改动。
- 新性能基准无法复现或输出不正确：先修正 fixture 与真实调用路径，再比较速度；不得放宽预算、跳过数据加载或只留下旧基准的通过记录。
- 抽象后状态／分支反而增加：收窄到确实相同的部分，仍无净收益则撤回候选。
- 需要改变外部协议、已发布兼容窗口、真实用户数据或 UI 语义：停止依赖该变化的动作，回到相应 owner 判断范围及所需授权。

本方案预期只修改源码和隔离测试数据，恢复手段以逐包可审查 diff 为主。不得用 destructive reset、整目录清理或操作用户真实数据库作为验证与恢复方法。

## 12. 执行记录与关闭

### 12.1 工作包记录

下表记录本轮实施与验证，不将计划中的预期写成已验证结果。证据可以是命令、结果摘要和绑定的代码版本；必要产物放在合适的临时或 artifact 路径，不把截图媒体加入仓库。

| 工作包 | 处置／状态 | 实际删除与保留 | 验证及绑定输入 | 偏差、剩余风险与 owner |
| --- | --- | --- | --- | --- |
| A | 完成 | 基线 `de11ac5`；六个已有修改文件保存 SHA-256 | 导出／热点报告及原 export 19 测试 | R1 不报告前后速度收益；未提交、推送或改外部状态 |
| R1–R3 | 完成 | 删除 TS 目录 SQL、旧 domain 解析器和 History 独立发布路径；保留单一 owner | Rust catalog fixture 与实际基准、engine 五场景、History mapper promise 闸门 | R3 保留函数名用于生产共用协调；fallback 性能仅 300 行 fixture |
| R4–R7、R11 | 完成 | 删除旧调度／批量 SQL／Data 草稿单选／恢复组合／孤立组件 | focused 测试及 25/25 mutation 已通过 | 日期反选与重新选择补到真实 browser；恢复测试调用 prepare/commit |
| R8–R10 | 完成 | 一次截止计算；CSV/Parquet 共用读取；Dashboard 单槽，generation 保留 | 跨年／闰年／167 小时 DST；真实导出与清理 fixture；缓存竞态 | Markdown 排序不同，保持独立；格式编码和文件发布不变 |
| S1–S4 | 处置完成 | S1 保留，S2 去除 4 个 export，S3 清理无消费者样式，S4 否决合并 | internal-only 4→0；test-only 99→91；unreferenced 1→0 | 组合 helper 不持有第二套算法；弹层几何、滚动关闭及焦点语义不同 |
| F | 完成 | 完整默认子图、稳定性能及文档验证 | 见 12.5 | 对抗式审查在归档后进行 |

### 12.2 文档自身验收

- [x] 本文件 UTF-8、Markdown 结构、相对链接和命令入口已核验。
- [x] `pnpm run check:docs` 通过；明确该脚本默认不扫描 working 文档，已另行验证本文件链接和锚点。
- [x] 当前文档准确区分前置审计证据、本轮实施结果与验证边界。

2026-09-27 文档验证：顶层文档门禁通过；单独调用现有文档检查器的 `collectDocGovernanceErrors` 检查本文件，链接与锚点错误为 0；严格 UTF-8 解码、所列 `pnpm run` 入口及代码路径检查通过。以上仅证明方案文档的检查结果，不代表实施步骤已执行。

### 12.3 实施关闭

- [x] 所有适用工作包已完成，或有明确否决理由／移交 owner；没有把无法验证的删除记为完成。
- [x] 真实行为、数据安全和生命周期证据成立，未运行检查和残余风险已明确交付。
- [x] 长期事实继续由顶层 owner 文档持有，本计划没有成为新的规则来源。
- [x] 将状态改为完成，把执行单移到 `docs/archive/`，修复指向旧 working 路径的活跃链接。
- [x] 归档后再次验证文档链接与编码；提交、推送和外部状态变更按当时任务授权单独处理。

### 12.4 处置说明与证据边界

- S1：保留三个 view-model 组合 helper，以及 `getDataDestinationSessionOptions`、`shouldDeleteSessionByStartTime`、`isRetryableCommandError` 和缓存 stats/reset。逐项复核后，它们是纯组合、观察接口或既有 fixture 的便利入口，没有另一套完整生产算法；搬入测试会增加跨文件维护而没有足够净收益。清理安全另由 Rust 数据测试验证。
- S4：否决本轮弹层合并。日期／时间选择器随滚动更新位置，通用弹层可关闭；role、初始焦点、返回焦点和几何不同。没有引入配置分支来强行合并。
- R1：原稳定性能入口保留，改为执行 owner 内 ignored Rust 基准；80,000 native、20,000 exact、10,000 bucket、1,500 apps，首屏／深页各 120 行，搜索 1 行。事实回退用独立 300 行 fixture，不能据此声称大规模回退吞吐成立。250 ms 平均预算及 p95/max 预算保持；每项 12 次采样。
- R9：迁移前两份 loader/行结构逐字等价，原 19 项 export 测试通过。没有保存迁移前的二进制产物；通过保留原输出断言、迁移后解析 CSV/Parquet 和新增单边界／未结束记录／null／ID 顺序测试验证。
- 发现并修复的实施问题：迁移 Rust 场景最初借用了短生命周期临时值，改为局部 no-signal 值；TS controller 测试仍引用已删 SQL fixture，改为分页输入 fixture；ignored 基准登记理由与注解不完全一致，已修正为精确一致。新增清理 fixture 最初违反单活动会话索引，改为先清理旧活动会话，再将截止点记录设为活动并再次验证；失败没有计为通过。
- IPC、capability、SQLite plugin、数据库 schema、备份兼容 reader 和真实桌面生命周期均未改变；本轮不追加 Tauri runtime smoke，不把 browser stub 证据当作真实桌面验收。

### 12.5 验证记录

基线为 `de11ac5`，结果绑定本轮未提交 diff；源码输入与既有文件哈希记录在本地临时审计目录，正式结论以下表为准。

| 检查 | 实际结果 | 范围／说明 |
| --- | --- | --- |
| `check:full` 的前端 `check` 子图 | 通过 | 类型、lint、全部静态边界和自测、快速测试、coverage、mutation、151 项 browser smoke、构建与 bundle |
| coverage | 通过 | 行／语句 97.07%，分支 89.86%，函数 94.62%；高风险逐文件门槛通过 |
| mutation | 25/25 killed | 仅退役旧 SQL batch 的两个专属变异，串行 runner 和其他风险保护保留 |
| `check:rust` | 修正 fixture 后通过 | 816 项库测试、6 项示例测试；4 项登记忽略；fmt、check、clippy 无警告 |
| `check:dependencies` | 在线通过 | Rust 四条精确 lock-only 例外核验在 Windows 不可达；pnpm 无漏洞 |
| `perf:stable` 对应脚本 | 通过，退出 0 | 七个入口各五轮，35 次执行均满足预算；不与编译或行为测试并行 |
| Rust export focused | 20/20 通过 | 包含迁移后新增的真实文件顺序、null、未结束记录与单边界场景 |
| DST 专项 | 通过 | 独立 Node 进程 `TZ=America/New_York`；2026-03-09 本地 12 时减 7 日仍为 12 时，相差 167 小时 |
| 已有改动保护 | 通过 | 六个文件 SHA-256 与起点一致 |

完整命令首次未整体退出成功：遇到本轮新增 fixture 的单活动会话冲突后修正，保留已成功的前端子图证据，重新执行完整 Rust 子图与依赖审计。没有为了获得一条绿色总命令而重复不受影响的长浏览器套件。

### 12.6 变更量

按生产、测试和工具分别统计，排除六个已有改动；Rust 文件按 `#[cfg(test)]` 分开计算。生产新增 154 行、删除 912 行，净减少 758 行。测试新增 637 行、删除 742 行，含迁移、fixture 与回归验证，独立记录，不计入生产收益；工具脚本新增 30 行、删除 165 行。文档为本执行单。行数是维护规模指标，不代表安装包或运行速度收益。

消失的机制包括：旧目录 SQL、旧 tracking 解析器、History 第二条发布实现、旧 preload 调度器、前端 batch SQL 接口、Data 旧日期草稿与单选规则、恢复组合入口、清理 plan 表示、第二份 export loader、单条缓存的 LRU 维护以及孤立组件；四个无外部消费者的声明收窄为模块内部。

归档复核：主要工作包 R1–R11 均完成；S1 保留、S4 否决，S2/S3 完成。所有适用实施项已处置，没有移交未完成代码工作。长期 owner 契约不变，无需修改母文档。源码仍为本地未提交改动。

## 13. 归档后的对抗式审查

2026-09-27，在第 12 节实施关闭并归档后执行。审查范围为本轮相对 `de11ac5` 的代码／测试／工具 diff，排除六个已有修改。审查按调用入口、数据 owner、异常与取消、请求交错、日期边界、动态消费者和门禁可达性展开。

### 13.1 发现与修复

- [x] P2：新增日期反向选择测试假定“昨天”总在当前月网格中。将浏览器时间固定为 2026-06-01（月初周一），在真实 DOM 上复现找不到 2026-05-31 而失败；产品选择器本身正常。修正 [日期场景](../../tests/uiBrowserSmoke/dataScenarios.ts)：目标不在网格时先翻上月，等待目标出现，完成反选后回到本月。固定月初与普通日期 2026-09-27 各重跑真实浏览器场景，均通过。
- [x] P2：新目录性能入口强制 `--offline`，空 Cargo 缓存时在测量前失败。用独立空 `CARGO_HOME` 复现并保存失败；修正 [性能入口](../../scripts/perf/classification-app-catalog-benchmark.ts)，与现有 Rust 性能入口一致使用 `--locked`，不强制离线，同时去掉包含首次编译时间的 180 秒超时。Cargo 沿用调用环境配置；耗时预算只作用于实际查询采样。修正后目录基准独立五轮全部通过。没有重新下载整套 Cargo 依赖做冷编译，因此不声称已测首次编译耗时。

### 13.2 主动反例与复核

- [x] 将 History mapper 等待临时替换成不等待：真实 tracking 测试在“读取次数应为 0”断言失败，证明前置顺序受保护。
- [x] 临时移除 Dashboard generation 发布条件：真实 tracking 测试检测旧快照覆盖新快照，断言失败，证明单槽化没有只靠容量断言验收。
- [x] 两个临时变异均在 `finally` 中逐字恢复；哈希与完整门禁输入相同，恢复后 98 项 tracking 测试通过。
- [x] 对生产 diff 复核：导出 SQL、参数与格式编码保持；清理比较符及数据事务仍归 Rust；恢复 preview hash／策略／路径保持；History 发布权仍归 cache owner；懒加载动态入口、IPC 与兼容 reader 无变化。没有发现需要修改生产行为的新增缺陷。
- [x] 审查修复后类型、lint、两组日期专项 browser 和目录五轮性能复验通过；其他生产文件未变，沿用第 12.5 节完整门禁证据。
- [x] 最终复核既有改动哈希、已删除符号、diff 空白、归档 UTF-8／链接／锚点；无未处置审查项。

稳定套件中目录首页／深页／搜索／小规模回退的五轮平均分别为 1.91／1.92／1.39／3.72 ms，均低于 250 ms 平均预算；这是本机固定 fixture 的当前结果，不能当作跨机器保证或清理前后提速结论。
