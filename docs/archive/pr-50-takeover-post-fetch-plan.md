# PR #50 接管与收敛：拉取后实况执行方案

> 文档类型：How-to / 可勾选执行计划
>
> 适用对象：Patina 维护者
>
> 状态：已完成；2026-07-18 归档
>
> 实况核对日期：2026-07-18
>
> 前置文档：`pr-50-takeover-pre-fetch-plan.md`（已由本文取代）

## 0. 完成与归档核对

### 0.1 最终路线与贡献归属

- [x] 采用路线 B，在最新 `main` 上重建可审查提交链，不直接拼接已冲突的 PR 分支。
- [x] 从原提交 `31800e3` 提取继续有效的 Tai CSV 小时汇总解析基础。
- [x] 来源提交 `05cb68b` 保留 author `gdm257 <gdm@disroot.org>`，并记录 `Original-commit` 与 `Refs #50`。
- [x] 维护者的模型、持久化、解构、查询、IPC、UI、测试和加固均使用维护者自己的后续提交。
- [x] 提交链未 squash，贡献来源和后续修改可分别追溯。

### 0.2 产品与数据语义

- [x] 通用导入只接受版本化 Patina CSV；外部 `.csv`、`.db`、`.sqlite` 先经解构器转换。
- [x] `exact_session` 必须具备真实开始、结束时间和 `.exe` 程序标识。
- [x] `hour_bucket` 只保存小时起点、持续时长和程序事实，不重建不存在的精确顺序。
- [x] Tai 小时 CSV 输出 `hour_bucket`；Tai/Taix 数据库按实际表结构提取精确会话和小时汇总。
- [x] 小时汇总参与 Dashboard、排行、趋势、热力图和分类统计，不进入 History 精确时间线。
- [x] 缺失标题、路径、分类等信息保持为空，UI 只显示来源真正具备的数据能力。

### 0.3 写入、撤销与界面

- [x] 解构结果以不覆盖方式原子写入源文件同级的 `.patina.csv`，源文件保持不变。
- [x] 导入先预览、校验、去重，再在单个事务中写入批次及其事实记录。
- [x] 批次删除只删除该次外部记录，不影响 Patina 原生记录和用户映射资产。
- [x] UI 使用“数据导入与导出”父卡片；导出保留原能力，导入弹窗只显示“导入 CSV”和“解构外部数据”。
- [x] 仅在存在批次时显示垃圾桶图标；删除列表使用当前 `第 1、2、3 次导入` 编号。
- [x] 删除中间批次后显示序号重排；全部删除后图标隐藏，下一次导入重新显示为第 1 次。
- [x] 导入或删除后会失效 Dashboard、History、Data 和启动快照缓存，避免旧数据残留。

### 0.4 对抗式审查与验证

- [x] 修复同一文件内部重复记录导致事务唯一约束失败的问题。
- [x] 修复 Tai/Taix 混合粒度按全局截点丢失部分应用小时汇总的问题，改为按程序选择事实粒度。
- [x] 修复实时 SQLite WAL 读取、静态表名白名单、查询只读模式、文件/记录资源上限等外部输入边界。
- [x] 修复小时桶超过一小时、CSV 公式前缀、空标题写库、同毫秒批次排序和读取后文件大小复核问题。
- [x] 修复导入/删除事件未清理聚合缓存的问题，并补充策略与 UI 合同测试。
- [x] `npm test`、`npm run test:replay`、`npm run build` 均通过。
- [x] `npm run check:full` 最终零退出：覆盖率、8/8 变异测试、42 个浏览器场景、392 个 Rust 测试、Clippy、架构、IPC、Quiet Pro、bundle 和依赖审计全部通过。
- [x] 两份一次性执行方案已勾选完成并移入 `docs/archive/`。

> 说明：路线 A、停止条件和方案建立时的“尚未执行”条目保留原勾选状态，用于记录当时的决策分支，不表示最终工作未完成。

## 1. 结论先行

PR #50 目前不能直接逐行评审或合并。它同时触发了范围、owner、规模、风险覆盖、冲突和 Rust 测试问题；而且最终产品设计已经从“Tai CSV 直接恢复为 Patina 会话”转为“第三方格式先解构为 Patina 通用 CSV，再由通用导入器按数据能力写入”。但这些问题不再作为丢弃有效贡献的理由：先保留来源解析、fixture 和边界测试中真实可用的部分，再决定使用原 PR 分支还是重建提交链。

实际可行的处理顺序是：

1. [x] 先做一次受控的“有效贡献提取”，逐项标记 Tai CSV 识别、字段解析、规范化、fixture 和测试中能继续使用的内容。
2. [x] 当前 intake 失败不阻塞提取和重构，也不参与“是否保留贡献”的判断。
3. [ ] 未采用路线 A：没有在原 PR 分支上同步 `main` 后直接合并。
4. [x] 采用路线 B，在最新 `main` 上重建提交链：来源提交只放真实提取内容并保留 `gdm257` author，后续修改使用维护者自己的 author。
5. [x] 最终提交链未 squash，代码来源、维护者修改和验证结果均可追溯。
6. [x] 通用导入、批次删除、小时汇总存储、Tai/Taix DB 和最终 UI 均由维护者独立完成。

本文初次写入时只定义执行步骤，尚未改代码、提交或推送；归档后的实际完成状态以第 0 节为准。

## 2. 拉取实况记录

### 2.1 Git 对象

- [x] 当前主线引用：`origin/main`。
- [x] 当前主线 SHA：`96ffc448f3dba34393bee91bd2599f123fd0e3a3`。
- [x] PR 专用本地引用：`origin/pr-50-review`。
- [x] PR head SHA：`31800e300927b0f2a9d7c183e091212b59e700ac`。
- [x] merge-base：`3eb79f2daab35175573bbad4a38da7d9a9bfb80a`。
- [x] PR 从 merge-base 起有 1 个提交。
- [x] 当前 `main` 从 merge-base 起已有 61 个提交。
- [x] 这 61 个提交共触及 288 个路径，不能把冲突视为简单的五处文本拼接。

### 2.2 作者与远端状态

- [x] PR 作者：`gdm257`。
- [x] 原始提交 author/committer：`gdm257 <gdm@disroot.org>`。
- [x] 原始提交：`31800e3 feat: support tai data import`。
- [x] 来源仓库：`gdm257/patina`。
- [x] 来源分支：`pr/feat-tai-data-import`。
- [x] 跨仓库 PR：是。
- [x] `maintainerCanModify`：是。
- [x] PR 状态：Open。
- [x] GitHub 合并状态：`CONFLICTING / DIRTY`。

### 2.3 差异规模

- [x] 17 个手工维护文件。
- [x] Git 差异：1,330 行新增、4 行删除。
- [x] intake 口径：1,334 行手工维护内容，超过 1,000 行硬门槛。
- [x] 最大文件：`src-tauri/src/engine/import/tai.rs`，新增 1,046 行。
- [x] 该文件约前 492 行为实现，后 554 行为内联测试。
- [x] 共有 24 个具名测试；其中 19 个偏解析/转换，5 个涉及 SQLite/备份恢复或源文件行为。

### 2.4 真实文本冲突

通过不会修改 index/工作树的 `git merge-tree` 核对，出现冲突标记的文件为：

- [x] `src-tauri/src/app/backup.rs`
- [x] `src-tauri/src/data/backup.rs`
- [x] `src-tauri/src/engine/mod.rs`
- [x] `src/features/settings/services/settingsRuntimeAdapterService.ts`
- [x] `src/shared/copy/domains/toastCopy.ts`

以下文件虽然两边都改过，但本次合并树没有出现文本冲突标记；仍须按行为重新核对，不能机械接受：

- [x] `src-tauri/src/app/bootstrap.rs`
- [x] `src-tauri/src/commands/backup.rs`
- [x] `src/features/settings/components/Settings.tsx`
- [x] `src/features/settings/components/SettingsDataSafetyPanel.tsx`
- [x] `src/features/settings/hooks/useSettingsPageState.ts`
- [x] `src/features/settings/services/settingsPageActions.ts`
- [x] `src/platform/backup/backupRuntimeGateway.ts`
- [x] `src/shared/copy/domains/settingsCopy.ts`
- [x] `tests/settingsPageState.test.ts`

### 2.5 实时 CI 与 intake

- [x] Frontend quality gate：通过。
- [x] Rust quality gate：失败。
- [x] Rust 结果：377 通过、1 失败、1 忽略。
- [x] 失败测试：`engine::import::tai::tests::convert_then_merge_restore_writes_data_in_milliseconds`。
- [x] 失败位置：PR 文件第 866 行，断言实际为 4、预期为 5。
- [x] PR Intake：失败。
- [x] 当次 intake 失败项：Accepted Scope 为空、模板范围/owner 不完整、缺少当时要求的维护者接受标记、1,334 行超限、SQLite/backup 风险文件缺少门禁能识别的聚焦测试。
- [x] 注意：该 CI 运行基于旧 merge-base。当时日志仍要求 label；当前 `main` 的规则已经改为 label-free，不能通过补旧 label 修复。变基后必须按当前 gate 重新计算。

## 3. 实际代码行为判断

### 3.1 当前实现做了什么

- [x] 识别 Tai `时段.csv` 的 `时段`、`应用`、`时长` 必要列。
- [x] 支持 BOM、逐行跳过和错误原因统计。
- [x] 将应用名去引号、转小写并补 `.exe`。
- [x] 解析 Tai 的小时起点和秒级持续时长。
- [x] 读取描述、分类并生成 Patina 分类/应用 override settings。
- [x] 将同一小时内的行按 CSV 顺序首尾相接，超过小时边界的部分截断或跳过。
- [x] 把这些人工排布结果构造为 `BackupSession` 与 `BackupTitleSample`。
- [x] 调用 `data::backup::restore_backup_payload(..., Merge)` 写入主数据库。
- [x] 设置页新增“从 Tai 导入”，导入后刷新整个页面。

### 3.2 为什么当前数据语义不能保留

Tai 旧版 `时段.csv` 只说明“某程序在某个小时累计使用多少秒”，不包含那个小时内真实的开始、结束和先后顺序。当前代码中的 cursor 排布是算法生成的时间线，不是来源事实：

- [ ] 删除 `back-to-back placement`。
- [ ] 删除“小时满后截断/跳过”作为会话重建规则。
- [ ] 不生成 `BackupSession`。
- [ ] 不生成与虚构会话一一对应的 `BackupTitleSample`。
- [ ] 保留小时起点、持续时长、应用、描述、分类这些确实存在的来源字段。
- [ ] 输出 `record_type=hour_bucket`，`end_time` 为空。

### 3.3 为什么当前 owner 不能保留

当前代码将导入放在 `engine/import`，再让 `app/backup`、`commands/backup` 和 `data/backup` 配合写库。实际 owner 应按职责分离：

- [ ] 外部格式解构：`data/import/destructure`。
- [ ] 通用 CSV 合同：`data/import/model.rs` 与 `data/import/canonical_csv.rs`。
- [ ] 后续导入预览/提交：`data/import/preview.rs` 与 `data/import/commit.rs`。
- [ ] 后续批次持久化：`data/repositories/import_batches.rs` 等明确 repository。
- [ ] Tauri IPC：未来单独的薄 `commands/import.rs`。
- [ ] 备份恢复：保持原有职责，不暴露内部 payload restore 给导入调用。

## 4. 文件级处置矩阵

| PR 路径 | 实际职责 | 处置 | 原因 |
| --- | --- | --- | --- |
| `src-tauri/src/engine/import/tai.rs` | Tai 解析、虚构会话、分类 settings、写库、测试混合 | 部分提取后重写边界 | 只可能保留来源识别、字段解析、规范化和部分 fixture；其余语义错误 |
| `src-tauri/src/engine/import/mod.rs` | 暴露 Tai import | 删除并改由 `data/import/destructure/mod.rs` 所有 | owner 不正确 |
| `src-tauri/src/engine/mod.rs` | 暴露 `engine/import` | 删除 PR 改动 | 不应新增该 engine owner |
| `src-tauri/src/app/backup.rs` | 导入协调、刷新事件 | 删除 PR 改动 | 首批 decoder 不写库；backup owner 不应承载 import |
| `src-tauri/src/app/bootstrap.rs` | 注册命令 | 删除 PR 改动 | 首批可只做 Rust 数据模块；最终改用 import command |
| `src-tauri/src/commands/backup.rs` | 文件选择、导入命令 | 删除 PR 改动 | 命令不属于 backup；首批不需要最终 UI IPC |
| `src-tauri/src/data/backup.rs` | 暴露内部 restore payload | 删除 PR 改动 | 防止外部数据绕过通用导入边界 |
| `src-tauri/src/data/backup/paths.rs` | Tai 文件选择器 | 删除 PR 改动 | 最终应由 import/platform 边界所有，不属于 backup |
| `src/features/settings/components/Settings.tsx` | 传入 Tai UI 状态 | 删除 PR 改动 | 最终 UI 设计已变，移到维护者后续 |
| `src/features/settings/components/SettingsDataSafetyPanel.tsx` | 单行 Tai 导入入口 | 删除 PR 改动 | 应改成“数据导入与导出”父卡片和导入弹窗 |
| `src/features/settings/hooks/useSettingsPageState.ts` | Tai busy/flow | 删除 PR 改动 | 当前流程直接写库并 reload，不符合新流程 |
| `src/features/settings/services/settingsPageActions.ts` | Tai 导入 action | 删除 PR 改动 | 后续需“导入 CSV / 解构外部数据 / 删除批次”状态机 |
| `src/features/settings/services/settingsRuntimeAdapterService.ts` | Tai runtime adapter | 删除 PR 改动 | 后续改接通用 import gateway |
| `src/platform/backup/backupRuntimeGateway.ts` | Tai invoke/types | 删除 PR 改动 | import 不属于 backup platform gateway |
| `src/shared/copy/domains/settingsCopy.ts` | Tai 文案 | 删除 PR 改动 | 最终交互和文案已改变 |
| `src/shared/copy/domains/toastCopy.ts` | Tai 成败文案 | 删除 PR 改动 | 最终需预览、解构和提交的不同结果语义 |
| `tests/settingsPageState.test.ts` | 当前 Tai UI flow | 删除 PR 改动 | 测试的是将被移除的直接写库交互 |

处置矩阵的直接结果：17 个原始路径中，只有 `tai.rs` 的一部分具有可迁移价值；没有任何原路径可以原样成为最终 owner。因此必须先提取有效内容，再根据改写比例选择“直接收敛原 PR”或“重建提交链”。两条路线都必须保留真实有效贡献，而不是由 intake 决定是否保留。

## 5. 决策门：选择怎样保留贡献

### 5.1 评估方法

在临时本地实施分支上完成一个不推送的最小提取试验：

- [ ] 从原提交标记可保留的来源格式知识：表头、时间格式、时长单位、BOM、描述/分类字段、应用规范化。
- [ ] 将可保留实现迁到目标 owner，但先不优化风格、不扩展格式。
- [ ] 将对应测试改为断言 `hour_bucket` 通用记录，而不是 `BackupSession`。
- [ ] 删除 UI、backup restore、分类 settings 写入、虚构排布和 SQLite 合并测试。
- [ ] 用 `git diff --word-diff`、函数级对比和 `git blame` 辅助记录哪些核心实现仍来自贡献者。
- [ ] 评估“主要实现、owner、UI、测试”四项中需要维护者重写的比例和性质，用于选择提交路线，不用于决定是否丢弃有效贡献。
- [ ] 建立来源清单：原文件、原函数/测试、原提交 SHA、迁移后文件和语义变化。
- [ ] 当前 intake 结果只作为最终合并待办记录，不中断提取试验。

### 5.2 路线 A：允许在原 PR 上修改后合并

只有以下条件全部满足才选路线 A：

- [ ] Tai CSV decoder 的主要解析结构和大部分边界测试仍由原贡献实现提供。
- [ ] 核心实现预计重写不超过 30%。
- [ ] owner 迁移是职责移动和接口收窄，不是重新设计全部算法。
- [ ] 最终差异低于 1,000 手工行和 25 文件。
- [ ] PR 能被描述为一个独立可验证贡献：Tai CSV → Patina 通用 CSV。
- [ ] 维护者修改可以拆成独立提交，原作者归属可准确保留。

### 5.3 路线 B：重建提交链并保留贡献者 author

出现任一条件就不直接修改并合并当前 PR，而是选择路线 B：

- [ ] decoder 需要重新设计超过 30%。
- [ ] 原测试多数只能随虚构会话/backup 写库一同删除。
- [ ] 最终保留的只是几行表头或时间格式常量。
- [ ] 为让 intake 通过需要把维护者的新主体实现伪装成对原 PR 的小修。
- [ ] 贡献者分支出现无法安全协调的新提交。

路线 B 不是丢弃贡献。它将可用内容从过时的 17 文件大提交中拆出，形成一条可审查的新提交链：

- [ ] 从 `31800e3` 机械提取继续使用的解析代码、fixture 和测试，不混入维护者重新设计的内容。
- [ ] 将这部分形成独立来源提交，author 保持 `gdm257 <gdm@disroot.org>`，committer 为实际执行整理的维护者。
- [ ] 来源提交 message 明确记录 `Refs #50`、`Original-commit: 31800e3...` 和“只提取有效 Tai CSV decoder 基础”。
- [ ] 使用对比清单证明来源提交中的内容确实来自贡献者，避免把维护者新代码署给贡献者。
- [ ] owner 迁移、通用模型改造、数据语义修复和新增测试全部放在后续维护者提交中。
- [ ] 未经作者共同参与，不使用虚假的 `Co-authored-by`；有效贡献通过真实 author 提交保留，不只做文字致谢。
- [ ] 不 cherry-pick 一个随后被基本清空的大提交来制造贡献记录。
- [ ] 如作者愿意继续参与，可邀请其审阅提取结果或提交 decoder-only 更新，但这不是保留有效贡献的前置条件。

### 5.4 当前推荐

根据拉取后的 17 文件处置矩阵，默认先执行有效贡献提取。若提取后证明原 PR 主体仍满足直接合入条件，则走路线 A；否则走路线 B，把真实沿用的贡献者内容作为 author 为 `gdm257` 的来源提交落到最新 `main`，我们的修改另行提交。当前 intake 失败不会阻止这一步，只在最终合并前处理。

## 6. 路线 A 的详细执行步骤

### 阶段 A0：授权和远端防护

- [ ] 获得维护者对“在贡献者 PR 分支上修改并推送”的明确授权。
- [ ] 添加贡献者 fork 为独立 remote；不要把 `origin` 改指向 fork。
- [ ] fetch `gdm257/patina` 的 `pr/feat-tai-data-import`。
- [ ] 确认 fork head 仍为 `31800e300927b0f2a9d7c183e091212b59e700ac`；若不同，停止并重新评估。
- [ ] 创建本地实施分支，基于 PR head；分支创建本身不改变远端。
- [ ] 保存 rebase 前 head SHA，作为 `--force-with-lease` 的明确租约依据。

### 阶段 A1：先同步最新 `main`

仓库规范要求冲突 PR 在最终评审前 rebase。rebase 会改变 commit SHA，但保留 author；维护者成为新的 committer。这比保留旧 SHA 更符合当前贡献规范。

- [ ] 确认工作树只有本任务允许的文件。
- [ ] fetch 最新 `origin/main` 并再次记录 SHA。
- [ ] 运行 rebase 到 `origin/main`，不在冲突时使用整文件 ours/theirs。
- [ ] 对五个冲突文件按最终职责处理：原 PR 在这些路径上的修改最终都应撤除，而不是拼回当前主线。
- [ ] 检查所有 17 个路径在 rebase 后的行为差异，避免“无文本冲突但语义过期”。
- [ ] rebase 完成后核对贡献者提交 author 仍为 `gdm257`。
- [ ] 暂不推送；先在本地完成收敛和验证。

### 阶段 A2：建立通用 CSV v1 最小合同

- [ ] 新建 `src-tauri/src/data/import/mod.rs`。
- [ ] 新建 `src-tauri/src/data/import/model.rs`。
- [ ] 新建 `src-tauri/src/data/import/canonical_csv.rs`。
- [ ] 新建 `src-tauri/src/data/import/destructure/mod.rs`。
- [ ] 新建 `src-tauri/src/data/import/destructure/tai_csv.rs`。
- [ ] 在 `src-tauri/src/data/mod.rs` 只加入必要的 `pub mod import;`。
- [ ] 不新增 `domain/import`；合同尚未形成跨 owner 稳定共享需求。
- [ ] 不新增 `engine/import`。

最小模型：

- [ ] `RecordType::ExactSession`。
- [ ] `RecordType::HourBucket`。
- [ ] `start_time`：必填，解析后使用明确时区/时间戳语义。
- [ ] `duration_ms`：必填，非负、非零且防溢出。
- [ ] `exe_name`：必填；Tai 可按已验证规则补 `.exe`。
- [ ] `end_time`：仅 `exact_session` 必填；`hour_bucket` 必须为空。
- [ ] `app_name`：可选，保存来源显示名，不与用户改名混为一谈。
- [ ] `title`、`path`、`category`：来源不存在时为空。
- [ ] 格式版本：明确写入 CSV 或配套元信息，确保以后能演进。

### 阶段 A3：迁移 Tai CSV decoder

- [ ] 保留 `时段`、`应用`、`时长` 必要列校验。
- [ ] 保留 BOM 与 UTF-8 中文处理。
- [ ] 保留逐行错误的行号和原因。
- [ ] 保留确定性的时间/时长解析。
- [ ] 审核补 `.exe` 规则：只把 Tai 的 ProcessName 语义规范化为程序标识，不声称该 exe 当前已安装。
- [ ] 将每行直接转换为一个 `hour_bucket`。
- [ ] 删除按小时分组后的 cursor、排序排布、clamp 和“hour bucket full”逻辑。
- [ ] 删除 `BackupPayload`、`BackupSession`、`BackupTitleSample` 依赖。
- [ ] 删除读取现有 settings、生成分类 settings 和 app override 的逻辑。
- [ ] 分类只作为可选来源字段写入通用 CSV，不修改 Patina 用户分类。

### 阶段 A4：同级 `.patina.csv` 输出

- [ ] 解构入口接收源文件路径并先验证常规文件。
- [ ] 用表头/结构识别 Tai CSV，扩展名只作为初筛。
- [ ] 输出文件名为源文件 stem 加 `.patina.csv`。
- [ ] 输出目录严格等于源文件父目录。
- [ ] 目标已存在时不静默覆盖。
- [ ] 使用临时文件 + 完成后原子替换/改名；写入失败不留下伪完整目标。
- [ ] 源文件以只读方式打开，解构前后字节不变。
- [ ] 返回输出路径、有效记录数、跳过数及错误摘要。
- [ ] 首批不提供设置页入口时，至少通过 Rust API/测试证明能力；是否增加薄 command 由最终 PR 规模决定，不能把 UI 拉回本 PR。

### 阶段 A5：测试重构

可迁移并改写语义的测试：

- [ ] `converts_basic_single_row` → 断言 `hour_bucket` 字段。
- [ ] `description_falls_back_to_app_when_empty` → 改为 app_name 可选规则，不伪造 title。
- [ ] `skips_unparseable_timestamp`。
- [ ] `skips_empty_app`。
- [ ] `skips_non_integer_and_non_positive_duration`。
- [ ] `rejects_non_tai_csv_missing_required_columns`。
- [ ] `bom_prefix_is_stripped`。
- [ ] `deterministic_for_same_input`。
- [ ] `convert_does_not_mutate_source_file`。
- [ ] `normalize_exe`、中文、CRLF、未知列和巨大字段专项测试。

必须删除或重新定义的测试：

- [ ] `places_back_to_back_and_clamps_to_hour`。
- [ ] `overflows_full_bucket_are_skipped`。
- [ ] `multi_hour_buckets_are_sorted_ascending` 中依赖虚构 session 顺序的断言。
- [ ] `placement_is_non_overlapping_and_start_before_end`。
- [ ] 分类/override settings 写入测试。
- [ ] `convert_then_merge_restore_writes_data_in_milliseconds`。
- [ ] `importing_same_csv_twice_does_not_increase_counts`。
- [ ] `merge_restore_rolls_back_on_schema_constraint_violation`。
- [ ] `merge_restore_does_not_overwrite_existing_app_override`。

新增的真实风险测试：

- [ ] 每个小时汇总保持原行事实，不生成 `end_time`。
- [ ] 同一小时多个应用不会被排成先后时间线。
- [ ] 总时长超过 3,600 秒时按来源格式规则报错/跳过，不通过截断制造事实。
- [ ] 输出同级目录、已存在目标、写入失败清理和源文件不变。
- [ ] CSV 公式前缀、超长单元格和解析资源上限。
- [ ] Windows 路径及重解析点边界按实际文件 API 覆盖。

### 阶段 A6：提交拆分与贡献归属

- [ ] rebase 后的贡献者提交 author 保持 `gdm257`。
- [ ] 不使用 amend 把维护者后续工作塞进贡献者提交。
- [ ] 维护者提交 1：同步/移除错误的 backup、UI 和 engine 路径。
- [ ] 维护者提交 2：迁移 decoder 到 `data/import` 并建立通用 CSV 合同。
- [ ] 维护者提交 3：补充输出安全和风险测试；若与实现紧耦合，可与提交 2 合并但仍需满足规模门槛。
- [ ] 每次提交前检查 staged stat/numstat。
- [ ] 单提交超过 1,000 手工行或 25 文件时按 owner/行为拆分。
- [ ] 最终不 squash，保证双方作者记录可见。

### 阶段 A7：本地验证

- [ ] 运行 decoder/通用 CSV 聚焦 Rust 测试。
- [ ] 运行 `npm test`。
- [ ] 运行 `npm run test:replay`。
- [ ] 运行 `npm run build`。
- [ ] 运行 `npm run check:rust`。
- [ ] 对架构/SQLite 风险运行 `npm run check:full`。
- [ ] 运行 `git diff --check`。
- [ ] 检查 UTF-8/BOM/mojibake。
- [ ] 重新计算三点 diff 的手工行数和文件数。
- [ ] 验证最终 diff 只包含 decoder-only 范围。

### 阶段 A8：更新 PR 文本和 Project 协作

- [ ] 在 Accepted Scope 中链接已确认的 Project 项或明确维护者 scope。
- [ ] 将 Changes 改成 Tai CSV → Patina 通用 CSV，不再宣称直接 merge 数据库。
- [ ] 完整填写 In scope 和 Out of scope。
- [ ] Owner Check 写明 `data/import`，Frontend 填 `N/A`。
- [ ] Risk Review 明确本机文件读取、同级写出、编码、路径、覆盖和资源上限。
- [ ] Validation 填写实际运行命令，不预先勾选。
- [ ] 截图填 `N/A`；如果最终无 UI，删除旧 UI 截图语义。
- [ ] 不使用 issue-closing 关键词。
- [ ] 不替维护者修改 Project 状态；实施开始时提醒维护者确认该项在 `In progress`，完成时报告应拖动的状态和 Next 窗口。

### 阶段 A9：安全推送与 CI

- [ ] 推送前再次 fetch fork 分支，确认 head 未变化。
- [ ] 使用明确的 `--force-with-lease=<ref>:<旧 SHA>` 更新 rebase 后分支；不用裸 `--force`。
- [ ] 推送后核对 GitHub PR head、作者列表和提交顺序。
- [ ] 等待当前 PR Intake 重新运行；不以旧日志或本地 `npm run check` 代替。
- [ ] intake 失败则只修准入问题，不开始逐行评审。
- [ ] intake 通过后再运行/等待 Verify，并逐行评审最终三点 diff。
- [ ] 所有检查通过、评审结论为 Accepted 后才允许非 squash 合并。

## 7. 路线 B 的详细执行步骤

### 阶段 B0：建立提取工作区

- [ ] 获得创建本地实施分支和整理提交的明确授权。
- [ ] 从最新 `origin/main` 创建本地实施分支，不以过时 merge-base 为实现基础。
- [ ] 保留 `origin/pr-50-review` 指向原始 `31800e3`，不移动这个审计引用。
- [ ] 记录贡献者姓名、邮箱、PR、原始 SHA 和来源文件。
- [ ] 不在这一阶段修改 PR #50 远端分支。

### 阶段 B1：形成贡献者来源提交

- [ ] 从原始 `tai.rs` 提取表头识别、CSV 读取、BOM 处理、时间解析、时长解析、应用名规范化和仍适用的错误结构。
- [ ] 从原始测试提取仍验证真实来源行为的 fixture 与断言框架。
- [ ] 排除 cursor 排布、`BackupSession`、`BackupTitleSample`、settings、restore 和 UI 代码。
- [ ] 首个提交只包含原贡献中真实继续使用的代码；为适配当前目录所需的纯机械路径/模块调整保持最小。
- [ ] 提交 author 设置为原作者 `gdm257 <gdm@disroot.org>`，committer 保持实际整理者身份。
- [ ] 提交正文记录 `Refs #50`、完整 `Original-commit` SHA、提取范围和排除范围。
- [ ] 用 `git show --format=fuller` 验证 author/committer 分离准确。
- [ ] 用函数级 diff 和来源清单验证没有把维护者的新算法错误署给贡献者。

### 阶段 B2：追加维护者提交

- [ ] 维护者提交 1：建立 canonical CSV 模型和 `hour_bucket` 真实语义。
- [ ] 维护者提交 2：把 decoder 完整迁入 `data/import/destructure/tai_csv.rs`，删除不再适用的兼容壳。
- [ ] 维护者提交 3：实现同级 `.patina.csv` 安全输出与路径错误处理。
- [ ] 维护者提交 4：补充新的边界、安全和确定性测试；可按耦合程度与前一提交合并。
- [ ] 每个提交使用维护者自己的 author，不 amend 来源提交。
- [ ] 每个提交都能说明相对来源提交改变了什么以及为什么。
- [ ] 每次提交前执行 staged stat/numstat，按 owner 或可独立验证行为拆分超限内容。

### 阶段 B3：验证贡献归属和最终差异

- [ ] `git log --format=fuller` 能清楚显示贡献者来源提交和维护者后续提交。
- [ ] `git blame` 对继续沿用的原始解析逻辑能追溯到贡献者来源提交。
- [ ] 不使用 squash、虚假 co-author 或只有文字致谢的替代方案。
- [ ] 最终三点 diff 只包含 decoder-only 范围，低于仓库规模门槛。
- [ ] 运行与路线 A 相同的 Rust、前端、replay、build、完整检查和编码校验。
- [ ] 在最终合并载体中说明为何没有直接合并 PR #50，以及有效代码如何保留了原 author。

### 阶段 B4：选择最终合并载体

- [ ] 优先评估是否能把重建提交链安全更新到 PR #50 分支；若这样会误导审查历史或覆盖作者新提交，则不更新。
- [ ] 若不能更新原 PR，按个人仓库规则将已确认的维护者提交链直接合入 `main`；不额外创建 PR，除非维护者明确要求。
- [ ] 推送前重新 fetch `origin/main` 和贡献者分支，确认没有外部状态变化。
- [ ] 合入/推送前完成当前 intake 等价检查和完整验证；当前旧 intake 失败不影响提取，但最终代码仍需满足现行质量门槛。
- [ ] 合入后在 PR #50 留下准确交代，再由维护者决定 PR 状态；不在未授权情况下关闭或修改 Issue。

## 8. 后续维护者实现计划

该部分不应回填到 decoder-only PR。

### 8.1 通用导入提交链

1. [ ] 冻结 canonical CSV v1 的字段、时区、错误和兼容策略。
2. [ ] 实现 CSV 预览：有效/重复/跳过/错误数量及样例。
3. [ ] 设计数据库：导入批次、精确会话关联、小时汇总事实。
4. [ ] 实现事务性 commit：全部成功或全部回滚。
5. [ ] 实现重复识别：同一文件重复导入不重复写入，规则稳定且可解释。
6. [ ] 实现按内部批次 ID 精确删除，删除后 UI 序号重排。
7. [ ] 实现能力查询：History 只读 exact session，统计页同时读取可支持的 hour bucket。
8. [ ] 实现 Tai DB 与 Taix DB decoder。
9. [ ] 最后实现设置页 UI 和真实应用回归。

### 8.2 批次删除的不可变验收条件

- [ ] 内部使用稳定、不可见的随机/数据库批次 ID。
- [ ] UI 当前列表动态编号 `1、2、3……`。
- [ ] 删除中间批次后自动重排显示编号。
- [ ] 删除全部后下一次导入显示第 1 次。
- [ ] 删除弹窗显示导入时间、来源、文件名、记录类型和数量。
- [ ] 只删除所选批次关联的导入事实。
- [ ] 不删除 Patina 原生记录。
- [ ] 不自动删除用户分类、应用改名或映射。
- [ ] 删除失败整体回滚并保留批次。

### 8.3 按能力显示

- [ ] `exact_session`：可进入 History、Dashboard、排行和趋势。
- [ ] `hour_bucket`：可进入支持小时汇总的 Dashboard、排行和趋势，不进入 History。
- [ ] 没有精确标题时不显示标题字段。
- [ ] 没有路径时不显示路径入口。
- [ ] 没有任何导入批次时不显示删除图标。
- [ ] 不以灰色空壳或“近似时间线”占据用户界面。

### 8.4 最终 UI

- [ ] 设置页父卡片命名为“数据导入与导出”，视觉结构参考“备份与恢复”。
- [ ] “导出”保持现有功能。
- [ ] “导入”打开独立弹窗。
- [ ] 初始弹窗只有“导入 CSV”和“解构外部数据”。
- [ ] “导入 CSV”只选择 Patina canonical CSV。
- [ ] “解构外部数据”首期文件筛选显示 `.csv` 与 `.db`，再按内容确认格式。
- [ ] 解构结果写到源文件同级 `.patina.csv`。
- [ ] 有批次时在导入弹窗右上角显示单个垃圾桶图标。
- [ ] 点击垃圾桶后打开第二个删除弹窗，而不是在初始弹窗直接铺开管理列表。
- [ ] UI 遵循 Quiet Pro tokens、组件状态、键盘焦点和错误反馈要求。

## 9. Tai 与 Taix 来源能力边界

### 9.1 Tai CSV

- [ ] 识别 `时段,应用,描述,时长,分类`（顺序是否固定由样本验证）。
- [ ] `应用` 规范化为 `exe_name`；补 `.exe` 是来源语义转换，不表示本机存在该程序。
- [ ] 输出 `hour_bucket`。
- [ ] 不输出 History 精确会话。

### 9.2 Tai DB

- [ ] 首次实现前固定支持的 schema 版本和表结构 fixture。
- [ ] 旧 Tai DB 的小时/每日数据仍按汇总能力导入。
- [ ] 数据库中没有精确事件时，不通过数据库格式本身推断精确时间。

### 9.3 Taix DB

- [ ] `AppModels.File` 用于可靠的程序文件标识。
- [ ] `AppModels.Name/Alias/Description` 作为可选 `app_name`/来源描述。
- [ ] `AppSessions(StartTime, EndTime, Duration)` 转换为 `exact_session`。
- [ ] 旧 `Hours` 汇总转换为 `hour_bucket`。
- [ ] 同一来源可同时产生两种记录，但不得把汇总和精确会话重复计算。

### 9.4 Taix CSV

- [ ] 先识别其字段与粒度。
- [ ] 如果只有日汇总且缺少可靠 `exe_name`，v1 明确拒绝并建议选择 Taix DB。
- [ ] 不根据 Alias/Name 猜测 `.exe`。

## 10. 最终 intake 与逐行评审清单

只有以下全部勾选后，才能开始用户要求的逐行评审：

- [ ] Accepted Scope 可审计且已由维护者确认。
- [ ] PR 只解决 decoder-only 一个问题。
- [ ] 最终所有文件都属于真实 owner。
- [ ] 手工维护内容不超过 1,000 行。
- [ ] 手工维护文件不超过 25 个。
- [ ] 若直接合并当前 PR，核心实现预计重写不超过 30%；若采用路线 B，来源提交只包含真实提取内容，维护者设计全部位于后续提交。
- [ ] 没有 backup/restore/SQLite 写入风险；如仍有文件写出风险，已有对应专项测试。
- [ ] 当前 PR template 所有必要字段完整。
- [ ] 当前 PR Intake workflow 通过。
- [ ] 当前 Verify workflow 通过。
- [ ] 与最新 `main` 无冲突。

逐行评审随后按以下顺序进行：

1. [ ] 通用模型是否表达事实，不混淆粒度。
2. [ ] Tai 识别和字段解析是否严格、可解释。
3. [ ] 时间、单位、时区和 `.exe` 规范化是否正确。
4. [ ] 文件读取/输出是否防覆盖、防越界、失败可恢复。
5. [ ] 错误是否能定位行和字段。
6. [ ] 测试是否覆盖真实风险且不测试虚构行为。
7. [ ] 模块依赖是否符合 `data` owner 和薄 command 原则。
8. [ ] 公共 API 是否最小，未为未来格式过度抽象。
9. [ ] 性能是否避免不受控全量复制和内存增长。
10. [ ] 文档、PR 描述和实现是否一致。

## 11. 回滚和停止条件

- [ ] rebase 冲突判断失误时执行 `git rebase --abort`，回到已记录 head。
- [ ] fork head 变化时不推送，重新 fetch 和比较。
- [ ] 任何强制更新只使用 `--force-with-lease` 且需要单独授权。
- [ ] 不使用 `git reset --hard`、`git checkout --` 或清理命令覆盖用户工作。
- [ ] 解构输出失败时保留源文件，清理临时输出。
- [ ] 通用合同未冻结时不开始数据库迁移。
- [ ] 发现必须新增跨层共享抽象或兼容壳时暂停，重新做 owner 判断。
- [ ] 评估落入路线 B 时停止直接修改 PR，转为重建提交链；继续保留有效贡献，但不把维护者主体实现伪装成原 PR 小修。

## 12. 本轮已完成与尚未授权

### 已完成

- [x] 写入拉取前执行方案。
- [x] 拉取最新 `origin/main`。
- [x] 拉取 PR #50 到 `origin/pr-50-review`。
- [x] 核对 SHA、提交、差异、冲突和 CI。
- [x] 写入本文实况执行方案。

### 方案建立时尚未执行（归档时已由路线 B 完成或明确不采用）

- [ ] 创建/切换实施分支。
- [ ] 修改 PR 代码。
- [ ] rebase PR 分支。
- [ ] 修改 PR body 或 Project 状态。
- [ ] commit、push 或 force-with-lease。
- [ ] 逐行评审。
- [ ] 合并或关闭 PR。

## 13. 文档生命周期

- [x] 实施期间以本文为唯一主清单；拉取前方案只保留决策追踪价值。
- [x] 每个阶段完成后记录实际完成项，不提前声称验证或远端动作完成。
- [x] 实施期间未发现要求重做实况基线的 PR head 或产品合同变化。
- [x] 任务结束后将两份一次性方案移入 `docs/archive/`。
