# Project #1 分类配置升级保真：对抗式审查与执行方案

Project：[`Patina Development Queue #1`](https://github.com/users/Ceceliaee/projects/1)

Issue：Refs [#37](https://github.com/Ceceliaee/patina/issues/37)

状态：实现与验证已完成，文档已归档；Project #1 已同步为 `Done`

文档类型：How-to / 执行指南

目标读者：负责实现、验证或审查本修复的 Patina 维护者

建立日期：2026-07-10

最后审查日期：2026-07-10

当前代码版本：`1.8.2`

目标版本：根因、范围和验证成本明确前不预设

完成证据：[`project-1-classification-upgrade-preservation-completion-record-2026-07-10.md`](./project-1-classification-upgrade-preservation-completion-record-2026-07-10.md)

## 0. 执行摘要

Project #1 要解决的问题是：从受支持旧版本升级后，用户已有的分类配置或与分类相关的显示偏好可能丢失、失效，或在界面上表现为默认值。

本问题不能在没有证据时直接归类为“分类页状态 bug”。同一个用户现象至少可能来自五个不同层次：

1. 升级后打开了另一份数据库或另一套 WebView 数据目录。
2. SQLite schema repair、migration history 归一化或安装器升级破坏了原数据。
3. 原始 `settings` 行仍存在，但当前兼容解析或规范化发生有损转换。
4. 持久化数据和解析结果都正确，但启动、缓存或运行时应用顺序回退到了默认值。
5. 首次启动看似正确，随后某条写回路径把旧数据覆盖、删除或半保存。

因此本任务采用“执行单模式”，先建立端到端不变量和可重复升级复现，再根据证据选择真实 owner。禁止先选修复文件，再反向解释根因。

截至建档时已经确认：

- [x] Project #1 标题为“修复升级后分类配置丢失”。
- [x] Project #1 原状态为 `Next`，队列中不存在其他 `In progress`。
- [x] Project #1 已按维护者授权更新为 `In progress`。
- [x] 状态变化后已按手动顺序补位 `Next`，未改变 Project 手动排序。
- [x] 当前工作区在建档前没有其他未提交改动。
- [x] `npm run test:classification` 通过，37 个测试全部成功。
- [x] `cargo test --manifest-path src-tauri/Cargo.toml data::sqlite_pool::tests --quiet` 通过，19 个 SQLite pool 测试全部成功。
- [x] 当前测试覆盖分类解析、分类草稿、部分兼容修复和 SQLite schema repair。
- [x] 当前测试没有覆盖“真实旧发布版状态 → 当前版本 → 第一次冷启动 → 第二次冷启动”的分类语义保真。
- [x] v1.8.2 已修复 Issue #32 的现代自定义分类 ID 截断问题；本任务不能在没有新复现证据时重复实现同一修复。

## 1. 任务定义

### 1.1 Problem

版本升级后，既有分类配置或相关显示设置可能丢失，直接削弱用户对升级可靠性的信任。

“丢失”必须拆成可验证的具体状态，不能只按界面观感判断：

- 物理丢失：原数据库或 WebView 数据目录未被继续使用。
- 原始数据丢失：升级前存在的 `settings` 行在升级后消失或被改写。
- 语义丢失：原始行仍存在，但解析后不再表达相同分类、名称、颜色或记录规则。
- 应用丢失：解析结果正确，但未被应用到 `ProcessMapper`、Classification、Dashboard 或 History。
- 偏好丢失：SQLite 分类配置仍在，但 WebView `localStorage` 中的分类相关显示模式回到默认值。
- 延迟丢失：第一次启动正确，第二次启动或打开 Classification 后发生有损写回。

### 1.2 Expected outcome

从明确列入支持矩阵的旧版本升级到当前版本后：

- 分类配置使用同一份用户数据。
- 配置的有效语义完整保留并继续生效。
- 第一次冷启动和后续冷启动结果一致。
- 必要的兼容归一化是确定、无损、原子且幂等的。
- 无法安全自动修复的数据不会被猜测改写。
- 自动化测试和隔离的 Windows 安装包升级验证能够重复证明上述结论。

### 1.3 范围内

- 明确“受支持旧版本”的最低边界和代表性升级节点。
- 复现至少一条真实或合成的受影响升级路径。
- 区分 SQLite 分类配置与 WebView `localStorage` 显示偏好。
- 检查默认数据目录、自定义数据目录和 WebView 数据目录连续性。
- 检查 SQLite schema repair、migration history 归一化和 settings 保真。
- 检查分类 settings key、value、引用关系和兼容解析。
- 检查启动 bootstrap、缓存、运行时应用和冷启动顺序。
- 检查升级后的保存、写回、失败回滚和第二次启动行为。
- 在真实 owner 中实施最小修复。
- 补齐旧版本升级、重启和幂等回归验证。
- 在 `CHANGELOG.md` 的 `Unreleased / Fixed` 中记录最终用户结果。

### 1.4 非目标

- 不重做 Classification 信息架构或视觉设计。
- 不新增与本问题无关的分类能力。
- 不把所有分类 settings 迁移到新表，除非证据证明当前键值模型无法安全修复，并先重新确认范围。
- 不顺手整理所有历史兼容代码。
- 不把 pre-1.5.2 直接升级静默扩成新的支持承诺。
- 不用真实生产 `%APPDATA%\Patina` 或 `%LOCALAPPDATA%\Patina` 做破坏性测试。
- 不在没有确定映射时猜测用户自定义分类的身份。
- 不把备份 v2、定时备份或完整恢复系统并入本任务。
- 不关闭、重开或修改任何 GitHub Issue 状态。
- 不预设目标 release，不在本任务实现阶段自动改版本号或推送发布 tag。

## 2. 当前证据与已知边界

### 2.1 当前持久化事实

分类配置目前复用 SQLite `settings(key, value)` 表，主要 key 前缀包括：

- `__app_override::`
- `__web_domain_override::`
- `__category_color_override::`
- `__category_label_override::`
- `__category_default_color_assignment::`
- `__custom_category::`
- `__deleted_category::`
- `__classification_manual_confirmation_migration::`

相关 owner：

- SQLite schema 和升级准备：`src-tauri/src/data/schema.rs`、`src-tauri/src/data/sqlite_pool.rs`
- 分类写入事务与 key 白名单：`src-tauri/src/data/repositories/classification_settings.rs`
- 前端 SQLite 读取边界：`src/platform/persistence/classificationPersistence.ts`
- Tauri 写入 gateway：`src/platform/persistence/classificationSettingsGateway.ts`
- 分类兼容读取与变更计划持久化：`src/features/classification/services/classificationStore.ts`
- 分类身份、应用 override 规范化：`src/shared/classification/categoryTokens.ts`、`src/shared/classification/processMapper.ts`
- Classification bootstrap：`src/features/classification/services/classificationService.ts`
- 全局运行时应用：`src/app/services/processMapperRuntimeService.ts`

### 2.2 与分类相关的 WebView 显示偏好

以下数据不在 SQLite `settings` 表，而在 WebView `localStorage`：

- `patina:classification-object-mode`
- `patina:history-timeline-mode`
- `patina:history-day-distribution-mode`
- `patina:history-timeline-zoom-hours`

因此“分类配置存在但显示模式重置”与“分类配置本身丢失”必须分开调查。前者优先检查 WebView profile、identifier、数据根目录和显式缓存清理；后者优先检查 SQLite 数据根、migration、parser 和 writeback。

### 2.3 当前升级边界证据

- v1.5.2 将底层身份和数据库迁移到当前 Patina 路径，并把数据库名改为 `patina.db`。
- v1.6.0 的发布说明明确要求 pre-1.5.2 用户先安装并成功启动 v1.5.2；v1.6.0 已移除旧 Time Tracker 自动迁移入口。
- 当前稳定线为 `1.x`，但“所有 1.x 任意版本可直接跳到当前版本”不能只凭 SemVer 猜测，必须结合已发布迁移承诺明确支持矩阵。
- v1.8.1 引入更完整的分类管理和现代 opaque custom category ID。
- v1.8.2 修复现代 custom category ID 被截断及唯一前缀恢复问题。

### 2.4 已有验证覆盖

已有 TypeScript 分类测试能够证明：

- override 正常归一化。
- legacy 自动分类迁移生成原子 mutation 和完成标记。
- legacy extended category 编码保持规范。
- 现代 custom category ID 可往返。
- 唯一可匹配的截断 custom category ID 可保守恢复。
- 分类草稿先持久化成功，再同步运行时状态。
- 可选网页分类读取失败时，应用分类仍可加载。

已有 Rust SQLite 测试能够证明：

- 当前 baseline migration 可建立完整 schema。
- migration history 可归一到当前 baseline。
- 旧 schema 缺列、active session、title sample 和 index 可修复。
- 当前这些 schema repair 测试通过。

### 2.5 当前验证缺口

- 没有以旧发布版 `settings` 数据为输入的升级回归 fixture。
- 没有断言 schema repair 前后分类 settings 行完整保留。
- 没有同时比较 raw persistence snapshot 和 effective classification snapshot。
- 没有覆盖默认数据目录与自定义数据目录两类升级。
- 没有覆盖 WebView `localStorage` 与 SQLite 独立保真的安装包升级。
- 没有覆盖第一次启动正确、第二次启动被 writeback 破坏的延迟失败。
- 没有覆盖 current build 对同一升级后的数据库连续启动两次仍不产生新 mutation 的幂等门槛。
- 没有把 Project 验收条件固化为发布前可重复执行的升级矩阵。

## 3. 第一性原理与不可破坏的不变量

### 3.1 物理身份连续性

升级不是“把旧数据复制到任意新位置”，而是让新版本继续识别同一个逻辑用户数据集。

- 同一 profile 的 production/local/dev identifier 不发生意外切换。
- 当前版本解析出的 SQLite 路径与支持矩阵预期一致。
- 自定义 data anchor 存在且有效时，当前版本继续使用该数据根。
- 自定义数据根暂时不可用时，不静默创建并长期使用一份空数据库伪装成功。
- WebView 数据根连续性独立验证，不能由 SQLite 连续性代替。

### 3.2 数据保留不等于语义保留

仅比较 `settings` 行数不足以证明升级正确。一个值可能仍在，但含义已改变。

- 对每类分类数据同时记录 raw key/value 与 effective semantic value。
- 允许的 canonical transformation 必须逐项列出 before/after 和理由。
- 未列入允许转换清单的字段必须严格等价。
- 分类 ID、显示名和颜色是不同概念，不能互相推导后覆盖。

### 3.3 Round-trip 不变量

对当前合法格式：

```text
decode(encode(value)) == value
```

对历史受支持格式：

```text
decodeLegacy(oldValue) == expectedSemanticValue
```

如果兼容读取需要写回：

```text
decode(writeCanonical(decodeLegacy(oldValue))) == expectedSemanticValue
```

- 现代 opaque category ID 必须原样保留。
- legacy label-encoded ID 只能执行已验证的兼容归一化。
- 显示 fallback 不能改写持久化身份。
- 未识别格式不能被当成“空值”后删除。

### 3.4 默认值只能填补缺失，不能覆盖存在

- 默认分类、默认颜色和默认显示模式只在持久化值确实不存在或明确无效时使用。
- 启动预热失败不能触发“把空 bootstrap 保存回数据库”。
- 临时读取失败不能被解释为用户主动清空配置。
- 可选 Web 分类失败不能影响应用分类数据。

### 3.5 原子性

如果一次兼容迁移需要修改多个相互引用的 settings 行：

- 所有写入和删除在一个 SQLite transaction 内完成。
- 任一 mutation 失败时，数据库保持升级前状态。
- 运行时状态只在持久化事务成功后更新。
- 不保留“分类定义已写、应用引用未写”或相反的半状态。

### 3.6 幂等性

同一升级后的数据库重复启动不得持续改变数据。

- 第一次启动允许执行一次明确的 canonical migration。
- 第二次启动不得产生新的分类 mutation。
- 第三次启动结果与第二次完全一致。
- 兼容完成标记只能在全部变更成功后提交。
- 崩溃发生在事务前、事务中或事务后，重新启动都能收敛到同一结果。

### 3.7 保守修复

- 可以唯一证明的映射才允许自动修复。
- 零匹配或多匹配时保留原数据，不猜测。
- 不通过可编辑、非唯一的显示名猜测 category identity。
- 不隐藏未知分类来制造“看起来修好了”的假象。

### 3.8 证据优先

- 修复前必须有在当前 `main` 上失败的自动化复现，或有隔离安装包升级的可重复失败记录。
- 如果只有用户现象但无法得到原始样本，先构造覆盖相同数据形态的合成 fixture。
- 不把“测试现在全绿”误判为“升级问题不存在”。
- 不把某个历史 Issue 的根因直接套到新问题。

## 4. 对抗式失败模型

### 4.1 A 类：打开了错误的数据根或数据库

攻击性假设：升级后新版本没有继续使用升级前的 `patina.db`。

重点检查：

- Tauri identifier 与 `AppProfile`。
- production/local/dev profile 解析。
- `%APPDATA%` 与 `%LOCALAPPDATA%` 下的 product folder。
- `data-anchor.json` 的 format、profile 和 `dataRoot`。
- 自定义数据根不可用时的 fallback 行为。
- 安装器升级是否改变 product name、identifier 或 WebView profile。

证伪条件：

- 升级前后解析出的 canonical DB path 相同。
- DB 文件身份、大小、关键表和预期 marker 一致。
- 升级后 session 历史与分类 settings 同时存在。

高价值症状：

- sessions 和 settings 一起“消失”。
- 默认目录出现新空 DB，而旧 DB 仍在另一目录。
- SQLite 数据正确，但所有 localStorage 偏好一起重置。

### 4.2 B 类：SQLite migration 或 repair 破坏 settings

攻击性假设：升级打开了正确 DB，但 schema repair、migration 或 migration history 归一化改变了 settings。

重点检查：

- `prepare_pool_schema()` 的执行顺序。
- `repair_legacy_schema_before_baseline_normalization()`。
- `normalize_current_baseline_migration_history_for_pool()`。
- `run_current_migrations()`。
- upgrade 前后 `PRAGMA integrity_check`。
- upgrade 前后 settings 受保护前缀的完整快照。

证伪条件：

- 使用同一 DB 文件运行当前 `prepare_pool_schema()` 后，受保护 settings raw snapshot 不变。
- 允许的 canonical transformation 之外不存在 key/value 改动。
- 第二次运行 schema preparation 不再产生变化。

高价值症状：

- sessions 保留，但 settings 全部或部分丢失。
- 数据在第一次当前版本启动后变化，尚未打开 Classification 页面。

### 4.3 C 类：兼容解析或规范化有损

攻击性假设：raw rows 完整存在，但当前 parser 忽略、截断或改写了旧格式。

重点检查：

- `ProcessMapper.fromOverrideStorageValue()`。
- `normalizeExtendedCategory()`。
- `buildAppOverrideTransition()`。
- `loadWebDomainOverrides()`。
- category color、label、definition、deleted marker 读取。
- key prefix、JSON shape、字段默认语义。

证伪条件：

- raw snapshot 与 effective snapshot 都保持期望语义。
- 第一次 parser 兼容写回后，第二次读取不再生成 mutation。

高价值症状：

- 只有自定义分类、中文分类或某一代格式失效。
- settings 行仍在，但 UI 显示 `category_...`、未分类或默认颜色。
- 第一次打开 Classification 后数据库才发生变化。

### 4.4 D 类：启动、缓存或运行时应用错误

攻击性假设：持久化和 parser 都正确，但 bootstrap 没有可靠应用结果。

重点检查：

- `initializeProcessMapperRuntime()`。
- `prewarmClassificationBootstrapCache()`。
- `ClassificationService.loadClassificationBootstrap()`。
- `ClassificationService.applyBootstrapToProcessMapper()`。
- AppShell 的 classification ready 门槛。
- Dashboard、History、Data 对 mapping version 的刷新。
- warmup 失败、取消和重复进入页面的行为。

证伪条件：

- effective snapshot 在启动阶段被准确应用到 `ProcessMapper`。
- Classification、Dashboard 和 History 在同一 mapping version 下显示一致。
- warmup 成功、失败和取消后都不会把空配置保存回持久化层。

高价值症状：

- 重新进入页面或手动刷新后恢复正常。
- Classification 正确，但 Dashboard/History 仍显示默认分类。
- 数据库没有变化，重启后表现不稳定。

### 4.5 E 类：升级后写入或延迟 writeback 破坏数据

攻击性假设：首次加载正确，但迁移 transition、保存流程或失败恢复在稍后写坏数据。

重点检查：

- legacy migration 的 promise 和完成 marker。
- transition mutation 生成顺序。
- Rust command key 白名单和长度限制。
- transaction failure rollback。
- `commitDraftChangesWithDeps()` 持久化与运行时同步顺序。
- 前端读取连接与 Rust 写入连接恢复。

证伪条件：

- 第一次启动、打开 Classification、保存无改动草稿和第二次启动后 raw/effective snapshot 都稳定。
- 人为注入任一 mutation 失败时，事务完全回滚。

高价值症状：

- 第一次升级启动正确，第二次启动丢失。
- 只要打开或离开 Classification 页面就发生变化。
- 保存多项设置时出现部分保留、部分丢失。

## 5. 支持矩阵与测试数据设计

### 5.1 先锁定支持边界

- 从 `CHANGELOG.md`、release tag 和现有升级承诺确认最低支持源版本。
- 默认候选最低边界为“已安装并成功启动过 v1.5.2 的数据状态”。
- 把“pre-1.5.2 直接升级”列为明确 negative control，不纳入成功验收，除非维护者另行扩展支持范围。
- 把支持边界写入测试名、fixture 元数据和最终 changelog/说明，避免口径漂移。

### 5.2 代表性源版本

至少覆盖以下发布节点；如果 git 历史证明某节点没有独立数据形态，可以合并，但必须记录理由：

- `v1.5.2-started`：已完成 Patina 身份和 `patina.db` 迁移的最早支持状态。
- `v1.6.0`：旧身份兼容清理后的稳定状态。
- `v1.8.0`：当前 storage directory 管理能力已存在、现代分类管理变更之前的状态。
- `v1.8.1`：现代 custom category ID 与分类管理增强状态。
- `v1.8.2`：Issue #32 修复后的同版本重启控制组。
- 当前 `HEAD`：目标实现。

### 5.3 每个源版本的场景维度

- 默认数据目录。
- 自定义数据目录，并存在有效 `data-anchor.json`。
- 显式 WebView 数据目录未清理。
- 当前版本第一次冷启动。
- 当前版本第二次冷启动。
- 打开 Classification 前后。
- 无改动直接离开 Classification。
- 修改一项设置并正常保存。
- 保存时注入失败并验证回滚。

### 5.4 合成分类数据集

测试数据只使用合成内容，不包含真实用户窗口标题、域名或个人标识。

- seeded category 应用 override：`development`。
- seeded category 自定义 label：如 `Engineering`。
- seeded category 自定义 color：如 `#112233`。
- app display name override：如 `Editor Alpha`。
- app `track: false`。
- app `captureTitle: false`。
- legacy label-encoded custom category，包括中文标签。
- modern opaque custom category：`custom:category_<stable-id>`。
- custom category definition row。
- custom category label override。
- custom category color override。
- custom category default color assignment。
- app 对 custom category 的引用。
- web domain 对 custom category 的引用（源版本支持时）。
- deleted seeded category marker。
- manual confirmation migration marker。
- 一个合法但当前实现不认识的未来扩展 row，用于验证未知数据不会被误删。

### 5.5 显示偏好数据集

- `patina:classification-object-mode = web`。
- `patina:history-timeline-mode = category`。
- `patina:history-day-distribution-mode = category`。
- `patina:history-timeline-zoom-hours` 使用非默认合法值。
- 明确记录显式清理 WebView cache 后回默认属于用户行为，不算升级回归。

## 6. 执行阶段

## Phase 0 — 安全预检与证据冻结

- 运行并保存工作区状态：

  ```powershell
  git status --short --branch
  git log -1 --oneline --decorate
  ```

- 确认本任务只修改与复现、修复、验证、changelog 和本执行单有关的文件。
- 如果工作区出现其他用户改动，记录并避开，不覆盖、不重置。
- 确认 Project #1 仍为 `In progress`，没有第二个主要 `In progress`。
- 记录当前版本文件和最近已发布 tag。
- 把本节已有基线测试结果保留为“修复前基线”，不要覆盖成修复后结果。

如果用户提供真实数据库或截图：

- 先确认用户明确授权使用该样本。
- 永远只操作副本，不直接启动应用读取原文件。
- 记录副本 SHA-256、文件大小和来源版本。
- 默认只提取 schema、分类 key 前缀和必要的结构信息。
- 不把真实 app 名、窗口标题、URL、token 或凭据写入测试 fixture、日志或文档。
- 如果无法安全脱敏，放弃真实样本，改用合成 fixture。

Phase 0 完成门：

- 工作区和样本边界清楚。
- 不存在误伤生产数据的路径。
- 当前基线和待复现版本已记录。

## Phase 1 — 定义可比较的升级快照

目标：避免只靠 UI 观察，建立升级前后可机器比较的证据。

- 定义 raw persistence snapshot，至少包含：
  - 实际 DB canonical path。
  - DB 文件大小和 SHA-256（文件关闭并 checkpoint 后计算）。
  - `PRAGMA user_version`。
  - `_sqlx_migrations` 版本、description 和 success。
  - `PRAGMA integrity_check` 结果。
  - 受保护分类前缀的排序后 key/value。
  - settings 受保护行数。
  - session 总数作为“是否打开错 DB”的辅助信号。

- 定义 effective classification snapshot，至少包含：
  - app overrides。
  - web domain overrides。
  - category definitions。
  - category label overrides。
  - category color overrides。
  - category default color assignments。
  - deleted categories。
  - legacy migration marker。
  - 对每个测试 app/domain 的最终 category、label、color、track、captureTitle。

- 定义 WebView preference snapshot，至少包含第 5.5 节四个 key。
- 所有 snapshot 使用稳定排序和确定性 JSON。
- 忽略 `updatedAt` 等允许变化字段前，必须逐字段说明原因，不能整体忽略对象。
- 为允许的 canonical transformation 建立显式映射表。
- 为未允许变化建立严格深度相等断言。

建议输出形状：

```ts
interface ClassificationUpgradeSnapshot {
  sourceVersion: string;
  database: {
    canonicalPath: string;
    integrityCheck: string;
    migrationVersions: number[];
    protectedSettings: Array<{ key: string; value: string }>;
    sessionCount: number;
  };
  effectiveClassification: {
    appOverrides: Record<string, unknown>;
    webDomainOverrides: Record<string, unknown>;
    categoryDefinitions: string[];
    categoryLabels: Record<string, string>;
    categoryColors: Record<string, string>;
    defaultColorAssignments: Record<string, string>;
    deletedCategories: string[];
  };
  webviewPreferences: Record<string, string | null>;
}
```

Phase 1 完成门：

- 同一未变化数据库连续生成两次 snapshot 完全一致。
- snapshot 不包含敏感数据。
- raw 与 effective 两个层面都能区分“行存在但语义失效”。

## Phase 2 — 建立自动化旧库升级 fixture

### 2.1 Rust 数据库升级测试

- 在 `src-tauri/src/data/sqlite_pool.rs` 的测试模块或相邻真实 owner 中新增专用 helper，创建代表旧版本的临时 SQLite 数据库。
- 不把升级测试塞进 `commands/*`、`app/*` 或 `lib.rs`。
- 用旧状态 schema、旧 migration history 和第 5.4 节 settings 数据填充 fixture。
- 在运行当前 `prepare_pool_schema()` 前获取 raw snapshot。
- 运行当前 schema preparation。
- 再次获取 raw snapshot。
- 断言：
  - integrity check 为 `ok`。
  - settings 受保护行完整保留。
  - schema 和 migration history 到达当前状态。
  - 除明确允许的 schema 变化外，不改变分类数据。
- 对同一 pool 第二次运行 `prepare_pool_schema()`，断言 raw snapshot 不再变化。
- 至少添加以下测试名或等价语义：
  - `supported_upgrade_preserves_classification_settings_rows`
  - `supported_upgrade_preserves_custom_category_references`
  - `supported_upgrade_is_idempotent_for_classification_settings`
  - `supported_upgrade_does_not_accept_incomplete_legacy_schema_as_current`

### 2.2 TypeScript 兼容解析测试

- 在 `tests/classificationDraftState.test.ts` 或新建的专用升级测试中读取确定性 old-format rows。
- 从 raw rows 构造 effective snapshot。
- 断言各 source-version fixture 得到相同预期语义。
- 如果 parser 生成 transition mutations：
  - 断言 mutation 完整列表。
  - 应用 mutation 后再次解析。
  - 断言第二次 mutation 列表为空。
- 分别覆盖 app override、web domain override、category definition、label、color 和 deleted marker。
- 未知未来格式不得导致 delete mutation。

### 2.3 先证明当前实现失败

- 在写生产修复前运行新测试。
- 保存失败测试名、expected、actual 和关联层。
- 如果所有新测试都通过，说明合成 fixture 尚未命中问题；不得为了完成任务制造无依据改动。
- 返回 Phase 3 做真实安装包升级或补充用户环境差异。

Phase 2 完成门：

- 至少一个自动化用例能在当前实现上稳定复现，或明确证明数据层不是根因。
- 测试能区分 path、migration、parser 和 bootstrap。

## Phase 3 — 隔离的 Windows 安装包升级复现

目标：验证 Tauri identifier、NSIS upgrade、SQLite path 与 WebView profile 的整体行为。

### 3.1 隔离原则

- 使用 `Patina Local` profile 和 `src-tauri/tauri.local.conf.json`。
- 不使用 production identifier。
- 不读写 `%APPDATA%\Patina`、`%LOCALAPPDATA%\Patina` 或用户真实自定义目录。
- 在开始前记录隔离目录绝对路径。
- 每个 source-version 场景使用独立、可删除的测试目录或独立 Windows 测试账户。
- 构建旧 tag 时使用独立 git worktree，不切换或污染当前主工作区。

### 3.2 构建源版本

- 为每个代表性 tag 创建临时 worktree。
- 在各 worktree 中使用该 tag 自带 lockfile 执行依赖安装。
- 使用该 tag 自带 `tauri.local.conf.json` 构建 `Patina Local` 安装包。
- 记录 installer 文件 SHA-256 和构建 commit。
- 如果旧 tag 无法在当前 toolchain 构建，优先使用已发布 installer 的校验副本；不要随意修改旧 tag 后假装是原发布行为。

建议命令形状，实际参数以对应 tag 的 Tauri CLI 为准：

```powershell
git worktree add <temp-path> v1.8.1
npm ci
npm run tauri build -- --config src-tauri/tauri.local.conf.json
```

### 3.3 种入源版本数据

- 安装并启动 source-version `Patina Local` 一次，确保 schema 和 profile 初始化完成。
- 关闭应用并确认 SQLite WAL 已 checkpoint 或连接已完全释放。
- 通过该版本真实 UI 或受控 fixture helper 写入第 5.4 节数据。
- 写入第 5.5 节 localStorage 偏好。
- 冷启动 source version 一次，确认 seed 本身可被该版本读取。
- 保存升级前 raw、effective 和 preference snapshots。

### 3.4 执行升级

- 用 current target installer 覆盖安装同一个 `Patina Local` profile。
- 第一次冷启动前记录文件系统目录树和关键文件时间戳。
- 第一次冷启动 current build。
- 在打开 Classification 页面前保存 snapshot A。
- 打开 Classification、Dashboard、History 后保存 snapshot B。
- 无改动退出应用，确认进程完全结束。
- 第二次冷启动，保存 snapshot C。
- 如有兼容写回，第三次冷启动保存 snapshot D，确认已经收敛。

### 3.5 失败注入

- 自定义数据根暂时不可用。
- data anchor JSON 损坏或 profile 不匹配。
- migration transaction 中途返回错误。
- classification command 返回 key/value validation error。
- optional web classification read 失败。
- warmup 被取消或失败。

失败注入必须满足：

- 不操作生产目录。
- 不以删除真实数据模拟失败。
- 每个失败场景有预期行为和恢复步骤。

Phase 3 完成门：

- 至少一条安装包升级路径可重复执行。
- 第一次和第二次冷启动均有 snapshot。
- 能精确指出第一次不符合不变量的阶段。

## Phase 4 — 根因定位与 owner 决策门

在本阶段结束前，禁止修改生产逻辑。

### 分支 A：数据库路径或 profile 变化

判定证据：升级前后 canonical DB path 不同，或 current build 打开新空 DB。

- owner 优先为 `src-tauri/src/platform/app_paths.rs`、`storage_paths.rs`、`storage_anchor.rs` 或 Tauri release config。
- 检查 installer identifier、product folder 和 local/dev/prod profile 是否稳定。
- 修复应保证选择正确数据根，不在 Classification 层复制数据。
- 如果旧、新两个 DB 都非空且无法自动判断，停止自动合并并升级为数据迁移决策，不猜测。

### 分支 B：同一 DB 的 settings 行被 migration 改坏

判定证据：path 相同，但 `prepare_pool_schema()` 前后 protected settings snapshot 变化。

- owner 优先为 `src-tauri/src/data/sqlite_pool.rs`、`schema.rs` 或明确的 data migration 模块。
- 先补失败 Rust 测试，再修改 migration/repair。
- 修复必须使用 transaction。
- migration history 归一化只能修改 `_sqlx_migrations`，不能清理 settings。
- 增加第二次运行幂等测试。

### 分支 C：raw 行保留但 effective 语义变化

判定证据：raw snapshot 等价，parser/normalizer 输出不等价。

- 分类身份规则落在 `src/shared/classification/*`。
- feature 私有兼容读取、transition 和 mutation 落在 `src/features/classification/services/classificationStore.ts`。
- 不把 parser repair 放进 React component 或 app shell。
- 对现代、legacy 和未知格式分别测试。

### 分支 D：effective snapshot 正确但页面显示错误

判定证据：service 输出正确，`ProcessMapper` 或页面视图仍使用默认值。

- owner 优先为 classification bootstrap 或 `src/app/services/processMapperRuntimeService.ts` 的薄协调。
- 检查 ready gate、mapping version、cache refresh 和 warmup 取消。
- 不把 persistence 重写成 UI workaround。
- Dashboard、History、Classification 三个消费者必须使用同一有效映射。

### 分支 E：只丢失 WebView 显示偏好

判定证据：SQLite 分类数据完整，localStorage key 消失或来自不同 WebView profile。

- 先检查 identifier、WebView product folder、cache/data root 和显式清理行为。
- 如果 key 名改变，兼容迁移留在各 feature preference storage owner。
- 如果整个 WebView profile 变化，修复 platform/release path，不逐个复制 localStorage key。
- 用户显式清理 WebView cache 后回默认不算升级 bug。

### 分支 F：升级后保存路径失败或半保存

判定证据：加载正确，但保存或 writeback 后丢失。

- owner 优先为 Rust classification repository、data service 或前端 change plan。
- 验证 key whitelist 和长度限制覆盖所有合法历史 key。
- 验证单 transaction 和 recoverable retry。
- 不恢复前端直接 SQLite write fallback。

Phase 4 完成门：

- 根因有最小失败用例。
- 真实 owner、允许修改层和禁止扩散层已写清。
- 如果 Project 原范围与根因明显不一致，先向维护者提供范围调整预览，不静默扩大。

## Phase 5 — 测试先行实施最小修复

### 5.1 通用要求

- 保留 Phase 2/3 的失败复现，不先改 expected 迁就实现。
- 只修改 Phase 4 确认的 owner 链。
- 不新增无明确 owner 的 shared helper、facade 或 compatibility shell。
- `app/*`、Rust `commands/*` 和 `lib.rs` 保持薄。
- 不恢复前端直接 SQLite write。
- 所有兼容写回必须原子、幂等且保守。

### 5.2 如果需要兼容迁移

- 给迁移定义稳定、版本化的 marker，仅在确实需要时新增。
- marker 只能在所有 mutations 成功后提交。
- 迁移输入包含 source format 判定，不能只看“marker 不存在”。
- 已是当前格式的数据不产生 mutation。
- 不认识的数据保留原样。
- 唯一可证明的旧 key → 新 key 转换在同一事务中完成。
- 删除旧 key 前，新 key/value 必须已在同一 transaction 中验证可写。
- 测试 transaction failure 时旧状态完整保留。

### 5.3 如果需要数据修复

- 自动修复只处理确定映射。
- 记录 repair reason 和受影响行数到可测试诊断，不记录用户敏感值。
- 多匹配、零匹配或非法值不自动改写。
- 不以“隐藏未知分类”替代修复。
- 如果修复具有不可逆风险，停止本任务并先设计备份/回滚边界；不要借用未完成的 v2 backup 工作项作隐含依赖。

### 5.4 如果需要修复数据根选择

- 优先继续使用已有、有效、非空且已被当前 profile 明确锚定的数据根。
- 不在旧根与新根同时非空时自动覆盖其中一方。
- 不因自定义路径短暂不可用就永久改写 anchor。
- fallback 必须产生可诊断状态，并在路径恢复后行为可预测。

### 5.5 如果需要修复 bootstrap

- 持久化读取成功后再标记 classification ready。
- warmup cache 只能加速，不能成为唯一正确性来源。
- 读取失败时保留上一个有效运行时状态或明确失败，不把空对象解释成用户配置。
- 页面重新进入不触发无条件写回。
- mapping version 只在有效数据变化后递增。

Phase 5 完成门：

- 修复前失败测试通过。
- 现有 Issue #32 用例继续通过。
- 不相关分类行为没有变化。
- 第二次启动/第二次迁移无新 mutation。

## Phase 6 — 自动化回归验证

### 6.1 聚焦验证

- 分类测试：

  ```powershell
  npm run test:classification
  ```

- 交互与失败保存：

  ```powershell
  npm run test:interaction
  npm run test:persistence
  ```

- 设置和显示偏好相关：

  ```powershell
  npm run test:settings
  npm run test:history-timeline
  ```

- Rust 升级与仓储测试：

  ```powershell
  cargo test --manifest-path src-tauri/Cargo.toml data::sqlite_pool::tests --quiet
  cargo test --manifest-path src-tauri/Cargo.toml data::repositories::classification_settings::tests --quiet
  ```

### 6.2 UI smoke

- 浏览器 smoke 覆盖 Classification 基础进入与保存。
- 如果 bootstrap 或 mapping refresh 被修改，补 Dashboard/History 同步显示场景。
- 确认控制台无新增 error。
- UI 验证只证明应用层显示，不能替代 raw DB upgrade 测试。

### 6.3 完整质量门

本任务涉及升级可信链、Rust 数据边界或跨层兼容时，交付前必须运行：

```powershell
npm run check:full
```

- `check:types` 通过。
- `check:naming` 通过。
- `check:architecture` 通过。
- `check:hotspots` 通过。
- 前端完整测试链通过。
- build 和 bundle budget 通过。
- `check:rust-boundaries` 通过。
- `cargo check`、Rust tests 和 clippy 通过。

只有进入正式发布准备时才追加：

```powershell
npm run release:check
```

Phase 6 完成门：

- 聚焦测试和 `npm run check:full` 全部通过。
- 任何因环境导致未运行的验证被明确记录，不能声称完整通过。

## Phase 7 — 安装包升级与冷启动验收

对支持矩阵中的每个必选源版本：

- source build seed 数据可读。
- current build 第一次冷启动成功。
- 升级前后使用预期 SQLite 路径。
- SQLite integrity check 为 `ok`。
- raw protected settings 满足允许转换清单。
- effective classification snapshot 满足语义等价。
- Classification 显示正确。
- Dashboard 分类结果正确。
- History 分类结果正确。
- 分类相关 localStorage 偏好保留。
- 无改动退出后第二次冷启动仍正确。
- 第三次启动不产生新增 repair mutation。
- 自定义数据目录场景通过。
- 失败注入场景没有半保存或静默切换到空数据集。

建议形成验收矩阵：

| 源状态 | 数据根 | 第一次启动 | 第二次启动 | SQLite 分类配置 | localStorage 偏好 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| v1.5.2-started | 默认 | 待执行 | 待执行 | 待执行 | 待执行 | 待执行 |
| v1.6.0 | 默认 | 待执行 | 待执行 | 待执行 | 待执行 | 待执行 |
| v1.8.0 | 自定义 | 待执行 | 待执行 | 待执行 | 待执行 | 待执行 |
| v1.8.1 | 默认 | 待执行 | 待执行 | 待执行 | 待执行 | 待执行 |
| v1.8.2 | 默认 | 待执行 | 待执行 | 待执行 | 待执行 | 待执行 |

Phase 7 完成门：

- 所有必选矩阵项通过。
- 失败项有明确根因和修复 commit，不以“偶发”跳过。
- production 用户目录未被测试触碰。

## Phase 8 — Changelog、交付与 Project 状态

- 修改 `CHANGELOG.md` 前检查已有 diff。
- 在 `Unreleased / Fixed` 中写用户可理解的结果，不写成内部模块清单。
- 引用 Project 链接或任务标题，不使用 `Closes`、`Fixes`、`Resolves`。
- 不修改版本文件，除非维护者明确进入发布准备。
- 汇总真实改动 owner、支持升级边界和验证命令。
- 只有实现和相应验证全部完成后，才把 Project #1 更新为 `Done`。
- Project 状态变化后按手动顺序重新计算最多三个 `Next`。
- Project item 进入 `Done` 不关闭任何 GitHub Issue。
- 正式发布并写入对应 changelog 后，再按长期规则从 Project 清理 draft item。
- 任务完成后把本执行单从 `docs/working/` 移入 `docs/archive/`。
- 只有长期升级规则真的变化时，才更新 top-level 长期文档。

## 7. 验收标准

全部条件必须满足：

- 已明确并记录受支持旧版本边界。
- 至少一条受影响升级路径在修复前可重复失败。
- 修复落在真实 owner，没有新增无 owner 的中间层。
- 支持矩阵中的旧版本分类 raw 数据得到保留或只发生明确允许的 canonical transformation。
- app override、web domain override、category definition、label、color、default color assignment 和 deleted marker 的有效语义正确。
- modern opaque custom category ID 不被截断或改写。
- legacy label-encoded category 保持受支持兼容语义。
- 未知或歧义数据不被猜测修复。
- SQLite migration/repair 对分类 settings 幂等。
- 第一次和第二次冷启动结果一致。
- Classification、Dashboard 和 History 对分类结果一致。
- 分类相关 localStorage 偏好在未显式清理 WebView 数据时保留。
- 保存失败不会留下半保存状态。
- 默认数据目录与自定义数据目录的必选场景通过。
- 聚焦测试通过。
- `npm run check:full` 通过。
- 隔离的 Windows 安装包升级矩阵通过。
- `CHANGELOG.md` 有用户可读记录。
- Project #1 仅在全部实现与验证完成后进入 `Done`。

## 8. 停手条件与升级处理

出现以下任一情况，停止按当前最小修复推进：

- 旧、新两个非空数据库都可能是用户主数据，无法确定权威来源。
- 修复需要合并两个数据集。
- 修复需要新增通用 shared abstraction，但稳定共享语义不清楚。
- 修复需要让页面、app shell 或 commands 直接接触 SQL。
- 修复需要改变 `settings` schema 或把分类数据迁到新表。
- 修复需要不可逆删除未知或歧义分类数据。
- 修复需要扩大到 pre-1.5.2 自动迁移承诺。
- 修复依赖尚未完成的 v2 backup/restore 契约。
- Project item 的验收范围与真实根因明显不一致。

发生停手条件时：

1. 保留现有失败复现和证据。
2. 写出范围变更预览、风险、依赖和队列影响。
3. 不静默扩大 Project item。
4. 等待维护者确认后，再拆分或升级执行单。
