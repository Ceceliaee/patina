# 旧结构化备份读取器退役执行方案

> 状态：实现与对抗式代码审查完成，归档；完整运行时验收仍有原生前台焦点环境阻断，后续责任见 §9.4。勾选包含明确注明的转交项，不表示所有验收均已通过。
> 创建日期：2026-10-23。
> 执行负责人：本次工作区任务；正式安装包与发布接受由发布维护者按发布规范负责。
> 调查基线：`51777ac34535f33ab3fe557dcfaf0fa1e8fe8c00`。开始调查时工作树干净；实施前重新核对。

## 1. 交付目标与适用边界

完成旧结构化 JSON ZIP 备份格式的退出。最终设置界面中，“恢复”旁不再出现问号，也不存在对应 Tooltip；生产代码不再提供旧结构化备份的读取、预览数据解析、恢复、转换或成功提示。备份与恢复只执行当前 SQLite 数据快照路径。

用户于 2026-10-23 明确要求上述最终状态，随后授权实施、验证、勾选归档及完成后的对抗式审查。授权不包含提交、推送、tag、Release、Issue 或 Project 写入。

本次“旧兼容代码”特指旧结构化备份格式及其专用适配。已安装 SQLite 数据库升级、历史 SQLite 快照的受支持 migration、存储位置迁移、WebDAV 凭据升级、网页分组迁移属于各自仍受保护的契约；不能用全仓搜索 `legacy` 后批量删除的方式处理。若进一步退出这些边界，需要分别证明其支持责任已结束。

本方案采用[问题修复边界守则](../issue-fix-boundary-guardrails.md)中的执行单模式：涉及数据恢复、前后端契约、远端索引和发布接受条件，不能只删一条提示。

长期依据：

- [发布规范 §7.1](../versioning-and-release-policy.md#71-旧备份读取器的丢弃窗口)：旧读取器退出条件。
- [架构](../architecture.md)：备份、SQLite pool、repositories、IPC 和应用协调的所有权。
- [工程质量](../engineering-quality.md#5-默认验证门槛)：数据安全、测试有效性和验证路由。
- [Quiet Pro](../quiet-pro-component-guidelines.md)与[本地化契约](../localization.md)：界面和消息资源。
- [产品原则](../product-principles-and-scope.md)：用户拥有本地记录，恢复结果必须可信且可控制。

## 2. 从第一性原理确定方案

### 2.1 用户购买的是可恢复性，不是某个文件格式

备份的价值是把可信数据从某个时间点带回可使用状态。一个文件能解压、某个函数返回成功，都不足以证明恢复成功。验收必须同时检查事实记录、引用关系、设置、计时边界、可继续写入以及错误后的原数据。

因此，先验证当前 SQLite 路径和旧文件的离线迁移路径，再删除旧读取器。界面过期日期只说明应开始退出工作，不能替代这些证据。

### 2.2 退出一种容器格式，不应删除当前恢复的领域能力

旧 JSON 容器负责把文件解码成数据；当前 SQLite 合并同样需要读取源数据、解决 ID 冲突、保持关联并事务提交。两者目前复用代码，文件名或类型名不能直接决定删除范围。

因此，先把当前快照所需的数据集合和合并动作表达为当前实现，再删除旧格式解码和旧专用字段。不能把旧 reader 改名后保留，也不能把它移动到 `compat` 目录作为第二条主路径。

### 2.3 拒绝文件应早于恢复副作用

不支持的文件不能触发清表、数据库切换、设置重载或结束当前活动。正常后台计时仍可继续产生自己的写入，所以“不改变当前数据”的验证应在确定性 fixture 中观察恢复动作的副作用，不能在活跃数据库上只比较整库文件哈希。

因此，格式识别、预览身份核验和必要的源文件校验必须在恢复造成的计时边界变化之前完成。校验与执行消费同一份私有准备副本，不能先检查原路径，随后重新打开可能已被替换的原文件。

### 2.4 代码退役不等于删除用户保存的文件

旧备份和 WebDAV 索引仍然属于用户。当前程序不再恢复它们，不代表程序可以删除文件、改写它们，或在上传新备份时顺手丢弃旧索引条目。

因此，当前恢复列表只提供可识别的 SQLite 快照；索引里的其他条目按未知数据无损保留，不解释旧 payload、不转成旧备份业务对象、不参与自动轮换。保留未知 JSON 的通用边界服务于远端数据安全，不构成旧格式读取器。

### 2.5 界面只解释仍可执行的操作

兼容窗口关闭后，持续展示旧日期或迁移问号会让用户误以为旧恢复入口仍然存在。既然用户明确要求移除问号，就删除完整触发器、Tooltip、专用文案和对应样式依赖，不留下空按钮或将其替换为新的帮助图标。

遇到不支持的文件时，使用现有反馈组件说明“当前版本只支持 SQLite 数据快照备份”。完整迁移方法保存在维护文档与发布说明中，不要求设置页永久承载历史格式说明。

## 3. 实施前调查基线

### 3.1 发布事实

2026-10-23 通过 GitHub 连接器只读核对了以下公开事实：

| 事实 | 证据与结论 |
| --- | --- |
| 首个 SQLite 快照正式版本 | [Patina v1.8.5](https://github.com/Ceceliaee/patina/releases/tag/v1.8.5)，`draft=false`、`prerelease=false` |
| 实际发布日期 | `published_at=2026-07-20T07:25:39Z`，Asia/Singapore 为 2026-07-20 15:25:39 |
| tag 对应提交 | annotated tag 解引用到 `d3cdab9f05d7d730a73b6ce1f8f5c2697ff967c8` |
| 90 天窗口 | 发布日加 90 天为 2026-10-18；2026-10-23 已超过该日期 |
| 迁移提醒 | 公开 Release 和 [CHANGELOG](../../CHANGELOG.md) 的 1.8.5 条目均写明兼容至 10 月 18 日，恢复旧备份后立即创建新备份 |
| 最近发布状态 | 本次读取最近十个 Release，最新为 [v1.9.10](https://github.com/Ceceliaee/patina/releases/tag/v1.9.10)，发布于 2026-10-11；执行与发布前重新读取，不将此快照当成实时结论 |

方案编写时，上述证据仅证明窗口已到、提醒已发布。实施阶段补读了 v1.9.10 对应提交的真实运行时 CI，并完成本地转换样本实验，证据层级与尚未执行的安装包验收见 §9.2。以下调用链表描述调查基线，不代表清理后的现状。

### 3.2 当前调用链与风险

| owner / 文件 | 当前事实 | 本次处理 |
| --- | --- | --- |
| [data/backup.rs](../../src-tauri/src/data/backup.rs) | `preview_backup`、`restore_backup` 先判断快照，否则调用旧 reader | 删除旧格式 fallback；仅接受当前快照 |
| [backup/archive.rs](https://github.com/Ceceliaee/patina/blob/51777ac34535f33ab3fe557dcfaf0fa1e8fe8c00/src-tauri/src/data/backup/archive.rs) | `PatinaBackup` manifest、JSON 数据项、CRC32 校验及 test-only writer | 删除整条专用读取与构造链，留下的拒绝测试独立构造最小输入 |
| [backup/payload.rs](https://github.com/Ceceliaee/patina/blob/51777ac34535f33ab3fe557dcfaf0fa1e8fe8c00/src-tauri/src/data/backup/payload.rs)、[restore_payload.rs](https://github.com/Ceceliaee/patina/blob/51777ac34535f33ab3fe557dcfaf0fa1e8fe8c00/src-tauri/src/data/backup/restore_payload.rs) | 同时承担旧恢复和当前 SQLite 合并；后者还提供覆盖恢复后的计划任务重置 | 先收口当前能力，再删除旧专用分支，不能整文件先删 |
| [snapshot/restore.rs](../../src-tauri/src/data/backup/snapshot/restore.rs) | 当前合并调用 `load_backup_payload_from_pool` 和 `restore_backup_payload_in_tx`；另行合并 tagged reminder rules、外部导入和匿名记录 | 保持一个事务和完整数据集合；去掉先读 app-only 规则再清空的旧适配 |
| [domain/backup.rs](../../src-tauri/src/domain/backup.rs) | 同时定义数据行、旧 payload 元信息、旧恢复安全判断及当前 preview | 按调用方拆清职责，删除仅为旧格式存在的字段和判断 |
| [app/backup.rs](../../src-tauri/src/app/backup.rs) | `note_tracking_policy_change` 和 `end_active_sessions` 早于 data 层格式校验 | 调整为准备成功后才进入有副作用的恢复协调 |
| [prepared_source.rs](../../src-tauri/src/data/backup/prepared_source.rs) | 私有副本、输入大小限制、SHA-256 预览身份及生命周期清理 | 保留并贯穿准备与执行 |
| [snapshot.rs](../../src-tauri/src/data/backup/snapshot.rs)、[sqlite_pool/restore.rs](../../src-tauri/src/data/sqlite_pool/restore.rs) | 当前容器校验、schema 验证、替换、WAL、pool 激活及中断恢复 | 保留现有安全保证，按受影响调用补测试 |
| [remote_backup.rs](../../src-tauri/src/data/remote_backup.rs) | 缺失 `formatKind` 默认判成 `legacy_structured`；索引读取与写回共用强类型数组 | 删除旧默认解释；分离当前条目投影和完整索引保留，防止写回丢项 |
| [backupRuntimeGateway.ts](../../src/platform/backup/backupRuntimeGateway.ts)、[remoteBackupRuntimeGateway.ts](../../src/platform/backup/remoteBackupRuntimeGateway.ts) | DTO 有旧格式 union、缺字段旧格式 fallback、旧规则计数字段 fallback | 与 Rust 当前 DTO 一起收紧 |
| [SettingsDataSafetyPanel.tsx](../../src/features/settings/components/SettingsDataSafetyPanel.tsx) | “恢复”旁的问号以 `backupRestoreActionHelp` 同时作为 Tooltip 和 accessible label | 删除整个问号与 Tooltip，不只是清空文字 |
| settings flows / locales | 本地、WebDAV 有旧恢复成功提示，preview 有旧外部数据缺失提示；四个生产 locale 使用同一消息契约 | 删除旧分支、schema key、翻译和生成产物中的对应资源 |
| [remote_status_bridge/mod.rs](../../src-tauri/src/engine/remote_status_bridge/mod.rs) | 仍直接使用 `crc32fast` | 保留 Cargo 依赖；只删除旧备份自己的 CRC32 逻辑 |

当前快照 manifest 自身仍是 JSON，ZIP 自身也有校验机制。删除“旧 CRC32/JSON payload 分派”不表示删除当前 manifest、`serde_json`、ZIP 支持或全仓 CRC32。

### 3.3 已有验证入口

- `backup/snapshot.rs` 已有一致快照 round-trip、历史 migration 前缀、路径穿越、重复项、大小限制和摘要反例。
- `prepared_source.rs` 已有预览后字节变化拒绝测试。
- `sqlite_pool/restore.rs` 已有恢复标记锁定、中断替换和 WAL 事实恢复测试。
- [settingsPageState.test.ts](../../tests/settingsPageState.test.ts)、[interactionFlows.test.ts](../../tests/interactionFlows.test.ts)覆盖预览映射与恢复流程。
- [tauriRuntimeSmoke.test.ts](../../tests/tauriRuntimeSmoke.test.ts)存在真实导出、预览、合并、覆盖、缓存失效、继续写入和 Widget 拒绝场景；[tauriWebDavRuntime.ts](../../tests/tauriWebDavRuntime.ts)覆盖远端上传、下载与合并。
- [settingsScenarios.ts](../../tests/uiBrowserSmoke/settingsScenarios.ts)、[remoteBackupUploadScenarios.ts](../../tests/uiBrowserSmoke/remoteBackupUploadScenarios.ts)是相关 browser 消费者场景。

“已存在”只描述测试代码，不表示它们在本次调查中执行通过。以下阶段先复用保护相同风险的用例，再补独有缺口。

## 4. 目标契约

### 4.1 可接受输入与失败行为

| 输入或情形 | 目标结果 |
| --- | --- |
| 当前有效 SQLite 快照 | 可预览，用户确认后可覆盖或合并 |
| 受支持的历史 SQLite 快照 | 按已发布 schema/migration 契约校验和升级，不因旧结构化 reader 退出而拒绝 |
| 旧结构化备份、其他 ZIP、普通 JSON、未知格式 | 统一拒绝为不支持的格式；不解码旧数据、不尝试转换、不产生恢复副作用 |
| 损坏 ZIP、路径穿越、重复项、超限、摘要错误 | 按实际损坏原因拒绝；不能 fallback 成另一种格式 |
| 快照 schema 新于当前能力 | 明确要求升级，不尝试合并部分数据 |
| 预览后文件被替换或 hash 不合法 | 要求重新预览；执行不能消费不同字节 |
| 取消文件选择或确认 | 无恢复动作，临时对象按其生命周期回收 |
| WebDAV 混合索引 | 当前快照可列出并恢复；其他条目不进入可恢复 DTO，完整索引写回保留它们 |
| 绕过前端直接调用 restore | 后端仍执行同一源准备、格式和 hash 检查；Widget 仍被 caller guard 拒绝 |

保留“不支持文件”的通用判断不需要知道 `PatinaBackup` 的字段、版本、CRC32 或表名。生产路径只认识当前格式的正向契约；旧格式字面量仅可存在于退役历史、迁移说明和拒绝测试输入中。

### 4.2 当前恢复必须保持的不变量

- 覆盖恢复：候选库检查完成后才切换；失败按现有恢复标记与 rollback 机制保全原库。不能承诺所有底层 I/O 故障都可自动回滚；回滚本身失败时保留恢复文件、停止不可信写入并明确报告。
- 合并恢复：原有数据保留，新增事实、ID 映射、标题、网页引用、规则、导入和匿名数据在一个事务中提交；相同备份再次合并保持幂等。
- 开放活动：依据源归档自己的观察证据封口，不使用目标心跳补记备份日至今的空白。
- 隐私与运行状态：设置、标题策略、暂停状态、名称补全世代、图标维护、派生投影和前端缓存按现有 owner 调和，旧请求不能污染新库。
- 计划任务与凭据：覆盖恢复重置运行身份并解绑来源机凭据；合并保留现有有效配置，不激活来源机自动任务或凭据引用。

## 5. 分阶段执行清单

### 阶段 A：确认退出条件与执行基线

产出：可审查的退出判定；不满足时保留明确阻断原因，而不是先删代码后补证据。

- [x] **A01** 核对 1.8.5 的公开 Release、真实发布时间、迁移提醒和 tag 提交，结果见 §3.1。
- [x] **A02** 核对截图对应的实际文案及问号消费位置，确认当前旧 reader 仍可达。
- [x] **A03** 实施前记录当前 HEAD、工作树和涉及 owner 的并行改动；已有用户改动不得覆盖。未获要求时沿用当前 checkout，不创建分支或 PR。
- [x] **A04（不适用）** 本次请求未提供或识别到关联的 Issue / Project item，未使用私有项目状态做决策，也未修改项目。
- [x] **A05** 重新核对最新正式 Release 为 v1.9.10，窗口后尚无新正式版本；本次说明写入 `Unreleased`，没有预定下一版本号。有限兼容窗口的退出与正式版本决策仍遵守[发布规范](../versioning-and-release-policy.md)。
- [x] **A06** 核实正式发布 v1.9.10 对应提交的 CI 三路径验证，记录提交、运行环境和实际断言，见 §9.2。这是发布源码的真实 Tauri 运行证据，不是下载的安装资产验收。
- [x] **A07（转交）** 正式安装包的独立账户 / VM 验收由发布维护者在下一次 release acceptance 执行，归属[发布规范](../versioning-and-release-policy.md)。本任务未安装旧版本或覆盖生产 profile。
- [x] **A08** 核实 v1.9.10 保有旧读取器，并以删除前源码跑通旧样本转换、候选源码读取。正式二进制端到端迁移试验并入 A07；不得将本地源码实验记作安装包实验。
- [x] **A09** 代码退役依据为到期窗口、已发布提醒、精确 release 提交的三路径 CI，以及删除前 / 后源码的迁移闭环。正式安装与发布验收另由 A07、H06 承担；本任务不宣称已发布。§9.2 说明对初稿证据要求的修订及边界。

退出条件：A09 成立，且具备后续实施授权。纯文档完成不代表本阶段所有门槛已满足。

### 阶段 B：建立隔离样本与迁移退路

产出：能够重现数据语义的合成样本，以及旧文件迁移到当前快照的可执行操作说明。

- [x] **B01** 复用已有 runtime/test profile，检查其数据根、WebView、凭据和单实例身份与正式安装版隔离。官方旧版本若没有可证明的隔离入口，使用独立 Windows 用户或虚拟机，不为运行旧程序临时指向正式库。
- [x] **B02** 创建含会话、标题、设置、网页和图标的旧结构化合成样本，并记录原始哈希。工具域另由当前真实 SQLite 样本覆盖，不声称此转换样本包含所有旧数据域。
- [x] **B03** 创建当前快照源库 A 与目标库 B，覆盖同 ID 不同事实、相同事实不同 ID、重复导入、app/category/web 提醒规则、匿名活动、关联关系和定时任务配置。
- [x] **B04** 记录各表主键与引用、开始/结束时刻、关键设置、规则 target、导入 batch 指纹和匿名 UUID。验收使用这些事实及预期冲突规则，不能只比较总行数。
- [x] **B05** 复用 `older_migration_prefix_is_verified_before_current_table_counts`，验证网页原生会话关联 migration 之前的合法前缀可校验并升级。没有把合成历史前缀称为全部历史发行资产。
- [x] **B06（转交）** 下载正式中间版本、核对安装资产并在独立账户 / VM 验收归 A07。代码层迁移实验使用删除前基线和忽略目录中的合成样本；原文件保持不变。
- [x] **B07** 对照旧格式能够表达的事实验证恢复结果，再创建 SQLite 快照；检查容器、摘要与实际数据库，记录中间版本和新文件哈希。
- [x] **B08** 用候选源码预览转换后的快照并验证覆盖候选内容，在带冲突数据的目标执行合并及重复合并。真实文件切换、继续写入另由同一候选的 Tauri 当前快照场景验证；证据分层见 §9.2，不把准备阶段称为已切换。
- [x] **B09** 在发布规范 §7.1 给出含旧 reader 的正式中间版本 v1.9.10 及迁移步骤：保留旧文件 → 隔离打开中间版本 → 恢复副本 → 创建 SQLite 快照 → 当前版本预览 → 自行选择覆盖或合并。代码路径已验证；正式安装包接受仍按 A07 执行。

退出条件：迁移步骤由真实样本跑通，当前数据的备份不受实验影响。样本和运行产物放忽略的专属测试目录；不把个人数据库、凭据或截图提交仓库。

### 阶段 C：先补保护，再解除当前实现对旧 payload 的依赖

产出：当前 SQLite 恢复只依赖当前领域数据；旧代码可以完整移除而不丢失当前功能。

- [x] **C01** 沿 `snapshot/restore.rs → payload.rs → restore_payload.rs → repositories` 列出生产调用方，将每项归为“旧容器专用”“当前快照必需”“其他升级边界”。以调用证据决定，不能按文件名决定。
- [x] **C02** 先运行当前合并、替换和相关 repository 的有效基线测试；对当前只借旧 payload fixture 保护的回滚、ID 映射、Web 关联和设置行为补成 SQLite 源库驱动的测试。
- [x] **C03** 在现有 backup owner 内收口当前快照合并所需的数据集合。移除集合中仅用于旧容器的 version、旧 schema 上限、旧 preview/hash 方法；保留当前使用的数据行类型，避免新建通用迁移框架或复制第二套 merge。
- [x] **C04** 当前 snapshot preview 仍使用的格式版本字段保留真实含义；不能因为 `CURRENT_BACKUP_VERSION` 原先定义在旧 payload 附近而误删其当前消费者，或顺手升级当前容器版本。
- [x] **C05** 移除 `BackupToolSoftwareReminderRule`、旧 app-only 规则读取和适配参数；当前流程直接使用已有 tagged activity reminder rule owner。删除 `payload.tool_software_reminder_rules.clear()` 之前证明 app/category/web 三类规则都由当前路径覆盖。
- [x] **C06** 让当前合并入口只承担合并，移除仅由旧结构化恢复使用的 `Replace` 清表/逐行插入分支与旧事务包装。当前 SQLite 覆盖继续使用候选文件切换，不改成逐表复制。
- [x] **C07** 保留当前覆盖仍调用的 `reset_scheduled_tasks_for_replace_in_tx`，放在最近的当前恢复 owner；保持凭据解绑、调度 generation 和账本重置的同一事务语义。
- [x] **C08** 删除仅为旧 JSON 活动准备服务的 `seal_interrupted_payload_activity`；确认当前快照的 `prepare_snapshot_restore` 继续执行源观察证据封口，相关反例已迁移到当前路径。
- [x] **C09** 逐个核对原 `restore_payload.rs` 测试：迁移当前仍需的名称补全失效、失败回滚、调度重置、关联和隐私保护；仅旧格式成功解码/恢复测试可以随能力退役删除。
- [x] **C10** 验证外部导入、匿名活动、tagged 规则和基础事实仍共用一个目标事务；任一后半段写入失败都回滚此前插入。
- [x] **C11** 运行本阶段 focused tests 与 Rust 编译，检查新接口没有进入 `app/*` 或 `commands/*` 的 SQL/解码逻辑。若产生多个候选 owner，先依据架构收口再继续，不堆转发层。

退出条件：旧 reader 与当前恢复不再共享旧格式语义；当前恢复的保护用例能够在默认 Cargo module tree 中执行。

### 阶段 D：删除旧读取器，保证拒绝发生在恢复副作用之前

产出：本地预览与恢复只有当前格式路径，直接 IPC 同样无法绕过。

- [x] **D01** 为通用格式拒绝定义稳定机器错误，建议使用现有 `CommandErrorDto`/`parseCommandError` 契约承载 `BACKUP_FORMAT_UNSUPPORTED`、`retryable=false`。错误属于备份事实，由 data/domain owner 决定，command 只映射；不以解析英文错误句子识别旧格式。
- [x] **D02** 收紧格式入口：验证容器和有界 manifest，只接受 `PatinaSQLiteSnapshot-1`。其他格式统一拒绝；不增加识别 `PatinaBackup` 后读取旧字段的专门分支。
- [x] **D03** 删除 `preview_backup` 与 `restore_backup` 的旧 fallback、`read_backup_payload`、CRC32/JSON 数据项分派、旧恢复安全判断及旧 payload 反序列化契约。
- [x] **D04** 调整应用协调顺序：caller guard 通过后，先由 data owner 准备私有源副本、核验 hash 和当前格式、验证可恢复性；准备成功后才调用 `note_tracking_policy_change`、结束当前活动并进入恢复。
- [x] **D05** 准备结果由 backup owner 管理生命周期，app 仅持有并传回，不展开 manifest 或读取数据库。执行沿用同一副本，不能校验后再次从原路径复制；保持原有锁顺序，最终依赖目标状态的校验仍在正确锁/事务内执行。
- [x] **D06** 对旧文件、未知格式、非法 hash、预览后替换文件直接调用 restore，断言未触发活动封口、pool 替换、计划任务重置、凭据解绑或恢复成功事件。
- [x] **D07** 删除 `archive.rs` 及旧 archive module 注册、旧 writer 测试 helper、旧 manifest/checksums/types/constants。拒绝测试使用最小外部输入，不再链接完整旧 writer。同步将本文指向已删除文件的调查链接改为已核实基线的历史源码链接，当前实现链接指向实际 owner。
- [x] **D08** 保留当前快照的 ZIP 文件集、路径、重复项、大小上限、SHA-256、SQLite integrity/foreign key、migration fingerprint 检查；格式不匹配不能绕过这些边界。
- [x] **D09** 清理旧调用后再次核对 Cargo 依赖。当前已知 `remote_status_bridge` 使用 `crc32fast`，本任务不删除该依赖，也不强求锁文件中所有 CRC32 字符串消失。
- [x] **D10** 验证私有准备目录在拒绝、取消、错误及成功后释放；只清理本动作拥有的临时文件。恢复 rollback 文件的保留规则仍由 sqlite_pool owner 决定。

退出条件：生产代码中没有旧格式成功路径；不支持文件在有副作用的恢复阶段前返回；当前快照风险测试通过。

### 阶段 E：清理 WebDAV 旧适配，同时保护完整远端索引

产出：WebDAV 只提供当前快照的恢复能力，旧文件和未知索引数据不会被误删。

- [x] **E01** 删除 Rust `legacy_format_kind()`、缺 `formatKind` 时解释为旧格式的默认值，以及前端对应 fallback。前端可恢复条目的类型只表达当前 SQLite 快照。
- [x] **E02** 在现有 remote backup owner 内区分“完整索引文档”与“可操作的当前条目”。只对明确声明当前格式且通过现有字段、路径校验的条目建立可恢复 DTO；其他条目保留为不解释的 JSON 数据。
- [x] **E03** 保留索引整体的版本、产品、大小与条目数量约束。当前格式声明但关键字段损坏时不能当正常条目；错误要可诊断，不能为了显示列表放宽路径与身份校验。
- [x] **E04** 列表过滤在排序、数量上限之前完成，避免大量不支持条目挤掉当前快照。只有不支持条目时，展示当前恢复列表为空的真实状态，不声称远端目录没有文件。
- [x] **E05** 上传新快照或更新索引时，原有不可操作条目的 JSON 值保持语义相等，不转换、不修复旧字段、不删除。保留 ETag 条件写入、冲突重读和成功后确认，不把 UI 过滤后的数组当成完整索引写回。
- [x] **E06** 自动备份轮换仅处理当前格式且拥有完整来源、目标 generation、路径和 ETag 证据的对象；未知条目及其文件不参加清理，不能只按同名或时间判断归属。
- [x] **E07** 下载入口重新验证被请求条目是当前可操作对象；伪造 entry ID 或绕过 UI 不得选择旧条目。下载内容仍经同一本地快照预览，不信任索引中的格式声明或摘要作为恢复授权。
- [x] **E08** 构造混合索引：当前条目、缺格式条目、任意未知格式、未知额外字段、同名不同身份、并发追加。验证读取、上传、冲突重试和自动轮换均保留非本次拥有的数据。
- [x] **E09** 覆盖下载后格式不支持、网络失败、确认取消、恢复失败和成功后的临时文件清理；不支持文件的反馈不能被统称为下载失败或网络不可用。
- [x] **E10** 删除前端远端旧成功提示分支和旧 preview 类型；WebDAV 与本地共享当前恢复结果与错误呈现，不引入另一套恢复分派。

退出条件：旧格式没有可操作对象或恢复分支，当前 WebDAV 路径正常，索引写回和轮换都具有未知数据保留证据。

### 阶段 F：移除问号与所有旧专用 UI / 本地化资源

产出：恢复行只保留现有有效操作，不再展示兼容窗口的视觉或语义残留。

- [x] **F01** 删除 `SettingsDataSafetyPanel.tsx` 中“恢复”旁问号的 button/icon/Tooltip 组合；删除只服务这个触发器的 import、class 或布局占位，不改动其他帮助入口。
- [x] **F02** 检查删除后恢复行的对齐、间距、点击区域和键盘顺序。Tab 不再停在问号位置，accessible tree 不再包含兼容截止日期。
- [x] **F03** 删除 `settings.backupRestoreActionHelp`、`toast.legacyBackupRestoreSuccess`、`backup.legacyExternalDataNotice` 的 schema 条目、所有生产语言资源和专用消费代码。
- [x] **F04** 收紧 `backup.kindLine` 及 preview 的格式参数，只表达当前快照；删除本地和远端 `legacy_structured` 分支，删除仅服务旧 IPC 的缺字段默认解释及 `tool_software_reminder_rule_count` fallback。
- [x] **F05** 根据 §4.1 实现通用错误文案。建议中文为“此文件不是当前支持的 SQLite 数据快照备份。请保留原文件，并按迁移说明处理。”界面只显示已验证的处理方法；迁移说明未定稿时不放虚构链接。
- [x] **F06** 原有更高 schema、损坏文件、hash 改变和恢复失败文案继续区分原因；不要把所有恢复失败都改成“旧备份不支持”，也不将未经恢复的数据称为已恢复。
- [x] **F07** 按 `locales/registry.ts` 遍历当前生产语言，人工复核受影响翻译，再用 `i18n:review <locale> --key <message-key>` 更新相应复核状态；不直接改 review hash。
- [x] **F08** 运行 `pnpm run i18n:generate`，通过生成流程更新前端与 Rust 产物；手写资源与生成代码中的已删除 key 都应消失。
- [x] **F09** 更新 settings flow 测试：不支持输入无确认框、无 restore 调用、无 reload/成功 toast；正常快照保留覆盖/合并确认，取消路径不改变状态。
- [x] **F10** 更新真实 browser 场景：四种生产语言在桌面布局下问号与 Tooltip 不存在、文字与按钮不重叠，英文另覆盖 900px 最小窗口。明暗主题和键盘焦点继续由既有 settings 场景覆盖；不声称测遍语言、宽度、主题的全部组合。
- [x] **F11** 检查截图只作为人工观察，不提交仓库媒体；可重复 DOM、交互和布局断言承担验收，不能用源码字符串搜索代替 browser 行为测试。

退出条件：视觉、DOM、可访问语义、消息 schema、翻译和业务分支均无旧提示残留；没有新的问号替代原问号。

### 阶段 G：回归验证与剩余代码审查

产出：覆盖当前恢复与退役风险的证据，明确测试层级和未验证部分。

- [x] **G01** 按 §6 矩阵逐项复用或补充测试，记录实际入口与结果。新增顶层测试必须有 package script owner；Rust 测试必须在 module tree 中注册。
- [x] **G02** 在确定性数据 fixture 上验证覆盖、合并、重复合并、冲突映射和后半程失败回滚；不要以“编译通过”替代内容验收。
- [x] **G03** 在隔离真实 Tauri runtime 验证本地三路径、WebDAV 当前路径、直接 IPC 拒绝旧文件、Widget denial、恢复后缓存刷新及继续写入。
- [x] **G04** 覆盖当前候选与历史正式快照的相互关系：候选读取支持中的旧快照；中间版本转换生成的快照可读；更新 schema 的输入被准确拒绝。不要要求旧程序读取新 schema。
- [x] **G05（执行完成，环境验收转交）** `check:full` 通过；真实 Tauri 完整入口已运行，备份场景通过，但 Widget 原生焦点断言失败。没有跳过断言；交互式桌面复验归 §9.4 的运行时验收负责人，未计为完整 runtime 通过。
- [x] **G06** 对生产代码、资源、测试 fixture 和文档分别搜索旧符号，逐项判断剩余用途。旧格式的 parser、writer、版本判断、分派、DTO fallback 和成功提示必须为零；通用拒绝测试与历史发布说明可以保留旧格式字面量。
- [x] **G07** 审查 `toolSoftwareReminderRules` 等仍服务历史 SQLite 快照的 manifest 字段别名及 schema migration：记录其当前快照契约依据。它们不属于本次旧 JSON 容器退出；禁止为符号清零破坏支持中的快照。
- [x] **G08** 检查删除代码是否留下空 wrapper、孤儿测试、未消费消息、过时硬编码例外或未使用依赖；修复真实 owner，不放宽 gate、coverage 阈值或架构边界。
- [x] **G09** 若任何验证不可用，记录准确原因、影响范围和验证责任；不得勾选通过，也不得用删除断言或自动重跑掩盖失败。

退出条件：所有必须风险项通过；未适用项给出可核实原因。仍有数据恢复风险或正式版本证据缺口时，不能进入发布接受。

### 阶段 H：发布说明、发布接受与文档闭环

产出：发布用户能理解的最终行为，保留迁移入口与可核实的发布状态。

- [x] **H01** 在实际待发布版本的 changelog 中描述：只支持 SQLite 快照恢复、旧结构化读取器已退役、原文件不被删除、旧文件的已验证迁移方法。保留 1.8.5 已发布条目，不回写历史承诺。
- [x] **H02** 复核架构和发布规范中已经完成的旧 reader 状态；若成为过时现状，更新其事实 owner。退出政策仍有解释价值时保留适当历史语义或链接，不新增另一份长期步骤清单。
- [x] **H03** 为 B09 的用户迁移方法确定一个长期公开 owner，优先使用对应 Release 说明；若需要独立 how-to，则包含已验证版本、隔离要求、可观察成功结果及失败处理，并由发布说明链接。
- [x] **H04** `pnpm run release:validate-changelog` 通过。本任务未准备正式发布，不执行或声称通过 `release:check`；其归属为 H05、H06 的发布任务。
- [x] **H05（转交）** 提交、推送、版本号、tag、安装资产和 updater 属于后续获授权的发布任务，由发布维护者按[发布规范](../versioning-and-release-policy.md)处理。本任务未执行这些操作。
- [x] **H06（转交）** 正式安装产物的隔离验收归发布维护者：验证问号不存在、旧文件拒绝、SQLite 三路径及安装升级，并记录资产摘要与 Release。当前仅完成源码交付，不能标记正式发布接受完成。
- [x] **H07（不适用）** 无关联 Issue / Project，未变更其状态，未使用关闭关键词。
- [x] **H08** 实现工作完成，运行时环境复验与正式安装接受已按 §9.4 明确转交；本文移入 `docs/archive/`。归档仅关闭本次退役实施记录，不授予发布接受；文档链接与检查结果见 §9.3。

## 6. 验证矩阵

下表是验收清单，不是已经通过的测试报告。行内完成框仅在对应证据真实存在后勾选。

| 完成 | 场景 | 必须观察的结果 | 主要层级 / owner |
| --- | --- | --- | --- |
| [x] | 当前库创建快照 | 源库继续可用；归档摘要、schema 和实际事实一致 | Rust snapshot + runtime |
| [x] | 当前快照覆盖 | 新库事实正确、旧目标专有事实消失、重开后可写 | sqlite_pool + runtime |
| [x] | 当前快照合并及二次合并 | 目标保留、源新增、引用正确、二次无重复 | snapshot merge + repositories |
| [x] | ID 冲突 | 会话、标题、网页、工具子项重映射正确 | Rust integration |
| [x] | 三类活动提醒规则 | app/category/web target、禁用状态、limit、message 和 last fired 信息按现有规则保留 | tools repositories |
| [x] | 外部导入与匿名数据 | batch 及来源优先级正确、匿名 UUID 幂等且不产生身份 | import_data / anonymous repositories |
| [x] | 归档含开放活动 | 使用源观察证据封口；不增加停机或归档后的时长 | snapshot preparation |
| [x] | 合并后半程失败 | 基础事实、规则、导入、匿名集合整体回滚 | 同一 SQL transaction |
| [x] | 覆盖切换 / 重开失败 | 原库恢复或按契约保留 marker/rollback 并明确阻断不可信写入 | sqlite_pool fault tests |
| [x] | 旧或未知文件 preview | 通用不支持反馈；不构造旧 payload，不展示可恢复统计 | data + gateway |
| [x] | 旧文件直接 restore | 无恢复导致的封口、pool 切换、设置重置或成功事件 | app coordination + real IPC |
| [x] | 预览后替换文件 | hash 拒绝；不消费不同文件、不形成恢复副作用 | prepared_source + IPC |
| [x] | 恶意 ZIP / 超限 / 损坏摘要 | 在写目标库前拒绝，私有临时对象可回收 | snapshot archive tests |
| [x] | 历史受支持快照 | migration 升级后事实与引用正确 | historical snapshot fixtures |
| [x] | 更高 schema | 明确要求升级，无部分恢复 | snapshot safety + UI |
| [x] | 计划任务、凭据、隐私 | 覆盖重置/解绑、合并不夺取既有配置，标题和暂停策略及时生效 | repositories + runtime |
| [x] | 旧名称/图标异步结果 | 不能污染替换后的同 ID 记录，删除记录不复活 | epoch / pool lifecycle tests |
| [x] | 混合 WebDAV 索引读取 | 当前项可见，其他项不成为可恢复 DTO，数量限制不误伤当前项 | remote backup + gateway |
| [x] | 混合索引上传 / 并发更新 | 当前项更新，未知 JSON 语义保持、ETag 冲突正确重试 | WebDAV integration |
| [x] | 自动远端轮换 | 只删具备完整归属证据的当前自动对象 | scheduled backup integration |
| [x] | 远端声明当前但内容不支持 | 下载内容校验拒绝，远端原件不变，临时文件清理 | WebDAV runtime |
| [x] | 取消与失败的前端流程 | 无误发成功、无错误 reload、可重试操作恢复可用 | settings flow + browser |
| [x] | 问号彻底移除 | 无图标、空按钮、Tooltip、aria 文案、Tab 停留或布局空洞 | browser + accessibility |
| [x] | 多语言与主题 | 消息语义一致、无旧 key、无日期残留、布局正常 | i18n gates + browser |
| [x] | 权限与隔离 | main 按契约执行，Widget 拒绝，生产数据根不被测试触碰 | Tauri runtime |
| [x] 源码验证；安装包转交 | 旧文件经中间读取器迁移 | 原文件保持；候选源码可预览、准备覆盖并重复合并转换结果；正式二进制链路由发布维护者验收 | §9.2 迁移实验 / A07 |

### 6.1 命令选择与执行方式

命令图以 [package.json](../../package.json) 为准。以下是本轮可使用的入口；实施前核对脚本仍存在，测试筛选结果必须实际执行到目标用例，不能将“0 tests”当成功。

```powershell
# 按阶段定位反馈；这些 focused checks 不能替代最终完整门槛。
cargo test --manifest-path src-tauri/Cargo.toml --locked data::backup
cargo test --manifest-path src-tauri/Cargo.toml --locked data::sqlite_pool::restore
cargo test --manifest-path src-tauri/Cargo.toml --locked data::remote_backup
pnpm run test:settings
pnpm run test:i18n

# 修改消息源并完成人工复核后生成；复核命令的参数见本地化 owner。
pnpm run i18n:generate
pnpm run check:i18n:self-test
pnpm run check:i18n

# 最终实现门槛。
pnpm run check:full
pnpm run test:tauri-runtime-smoke

# 实际修改发布说明 / 准备正式发布时使用。
pnpm run release:validate-changelog
pnpm run release:check

# 本次仅编写方案所需的门槛。
pnpm run check:docs
```

使用仓库声明的 Node、pnpm 和 Rust 版本；不为文档编写安装额外工具链。需要联网的 Git、gh、Cargo、pnpm 等命令执行前，先核对工具代理、环境代理与当前 Windows 系统代理，沿用适用配置；只做命令或进程范围设置，不输出凭据、不写死端口、不把 PAC URL 当服务器。GitHub 连接器只读查询不需要修改本机 Git 配置。

检索用于人工清理审计，不建立以源码字符串代替行为断言的新测试：

```powershell
rg -n 'PatinaBackup|legacy_structured|read_backup_payload|decode_structured_backup_archive|encode_backup_archive' src src-tauri/src locales tests
rg -n 'backupRestoreActionHelp|legacyBackupRestoreSuccess|legacyExternalDataNotice' src src-tauri/src locales tests
rg -n 'BackupToolSoftwareReminderRule|tool_software_reminder_rule_count|fetch_all_software_reminder_rules_for_backup' src src-tauri/src tests
rg -n 'crc32fast' src-tauri/src src-tauri/Cargo.toml
```

不要求全仓单词 `legacy` 为零。要求每个与本次旧结构化格式有关的生产成功路径、默认适配和专用资源均被删除；受支持 SQLite 快照的 migration/manifest 兼容需要按独立边界保留与验证。

## 7. 失败处置与回退

| 失败位置 | 处置 | 继续条件 |
| --- | --- | --- |
| 正式验证证据或中间版本缺失 | 暂停 reader 删除，继续样本与现有路径验证；记录阻断和复核版本 | 阶段 A/B 证据补齐 |
| 拆解 payload 后当前合并丢域 | 停在当前逻辑收口阶段，修正真实数据 owner；不以恢复旧分派掩盖缺失 | 完整数据及回滚测试通过 |
| 格式拒绝仍提前封口活动 | 修正准备与恢复协调顺序，不仅修 UI 按钮 | 直接 IPC 反例验证无恢复副作用 |
| WebDAV 写回丢未知条目 | 阻止发布该实现，恢复完整索引保留和 ETag 逻辑 | 混合索引与并发反例通过 |
| 候选 SQLite 恢复失败 | 使用原库及 sqlite_pool 既有 marker/rollback；保留失败现场 | 数据完整性和继续写入得到验证 |
| 本地实施回退 | 按逻辑改动撤回本任务内容，保留用户并行改动和验证产物 | 重新建立可核实基线 |
| 正式发布后发现回归 | 按不可变发布政策使用新版本修复；维护者决定必要的支持措施 | 新产物验证通过，迁移说明同步 |

应用版本回退不意味着旧程序可直接写当前数据库。任何回退步骤必须区分源码回退、正式二进制回退和用户数据恢复；不覆盖旧 Release，不清除恢复标记来掩盖故障，不删除用户原始备份。

## 8. 完成定义

- [x] 设置页“恢复”旁问号、Tooltip、专用可访问文案和布局占位全部消失。
- [x] 生产备份链路只接受当前 SQLite 快照，没有旧结构化 reader、旧恢复分派、旧 app-only 适配、旧成功提示或旧 IPC fallback。
- [x] 当前快照覆盖、合并、历史快照升级、失败恢复及运行时调和保持正确；测试可达且证据绑定本次输入。
- [x] 不支持文件被统一拒绝，直接 IPC 不能触发提前封口或其他恢复副作用。
- [x] WebDAV 当前操作正常，未知索引数据和用户旧文件不因清理被改写或删除。
- [x] 正式 release 源码的三路径 CI 和本地迁移样本已有证据，迁移步骤进入长期 owner；正式安装包接受已明确转交，未冒充已执行。
- [x] 完整质量门槛已执行：`check:full` 通过，runtime 的唯一环境阻断明确转交；未将局部通过写成整套通过，产品实现与发布接受分开记录。
- [x] 长期事实更新到正确 owner，本文在实现完成及未决验收转交后归档。


## 9. 本次编写与后续执行记录

### 9.1 2026-10-23：方案编写

- 已完成：只读核对仓库 owner、旧/当前恢复调用链、WebDAV 索引读写、UI 与消息消费、已有测试入口；读取公开 Release 和 tag，确认实际时间与迁移提醒。
- 已纳入用户要求：最终完全移除问号与 Tooltip，删除旧结构化格式兼容代码；不以延期日期、隐藏触发器或保留旧 reader 改名代替。
- 尚未执行：产品实现、Rust/前端/runtime 测试、正式安装包恢复验证、中间版本迁移实验、提交或任何远端写入。
- 文档验证：`pnpm run check:docs` 通过（扫描 22 份文档，长期母文档 10/10）；UTF-8 严格解码、32 处相对链接、引用章节锚点、所列 package scripts、90 天日期计算、代码围栏及 77 个步骤编号唯一性均已核对。初次检查因沙箱无法启动只读 Git 子进程而失败，获准在沙箱外运行同一命令后通过；未改动检查器。

### 9.2 2026-10-23：实施与证据边界

实施仍使用调查基线 `51777ac34535f33ab3fe557dcfaf0fa1e8fe8c00`。初始仅本方案未跟踪，未覆盖其他任务改动；没有提交、推送、分支、PR、发布或 Issue / Project 写入。

**发布源码证据。** 只读复核 v1.9.10 的正式 Release 对应提交为 `24d25fe571264d6e152be63ed9eb2b55d9fb0cd9`。[Verify 运行 38127130371](https://github.com/Ceceliaee/patina/actions/runs/38127130371) 成功；其中真实 Tauri runtime job `114433748441` 的日志记录了 SQLite 导出、hash 预览、合并、覆盖后 pool 可用、历史视图刷新、目标独有事实消失、暂停设置恢复及继续计时。该提交的 [Publish 运行 38128304499](https://github.com/Ceceliaee/patina/actions/runs/38128304499) 也成功。证据绑定正式 release 的源码，但 runtime 是隔离的 debug Tauri/WebView2 构建，不能写成“本机已验证正式安装包”。

初稿 A06—A09 将“正式版本验证”进一步展开为下载资产摘要和本机安装实验。本次把代码层退役与发布安装接受明确分开：代码层采用精确发布提交的三路径 CI，加本地删除前 / 后源码迁移实验；安装资产、独立账户 / VM、updater 和最终发版交给发布维护者，长期 owner 为[发布规范](../versioning-and-release-policy.md)。这项处置不降低正式发布接受要求，也不把转交项记成已运行。

**迁移实验。** 删除前基线的 36 项 backup 测试通过。临时 probe 用该基线的旧 reader 恢复合成结构化样本，校验会话、标题、设置、图标、网页关系后导出 SQLite 快照。删除后的候选 probe 对转换结果完成当前预览、覆盖候选准备、带 ID 冲突的合并与重复合并，验证关联、幂等和原文件哈希未变。实际目标库切换由完整 Tauri runtime 的当前快照场景验证；未将“候选准备”当作文件切换。

| 忽略目录中的样本 | SHA-256 |
| --- | --- |
| `artifacts/backup-retirement/structured-source.zip` | `268f8531b73a26680a42311494511089cf4b6c15bf861084a5dc8a50c44567ee` |
| `artifacts/backup-retirement/converted-snapshot.zip` | `60b0786e6fcf3f4af67cb03a9fda4fe58e9c91cfc13f14ec8428be432f0c60ae` |

两个临时 probe 的 module 注册均已移除，临时 probe 源码及旧基线源码副本也已删除，仅保留合成样本和验证记录。生产代码和默认测试不依赖该忽略目录，不保留旧 decoder 或 writer 作为迁移工具。

**实现落点。** 备份数据集合改为当前内部 `BackupRecords`，没有旧 payload 反序列化契约；当前合并只做一个目标事务，覆盖仍通过 SQLite 候选文件切换。私有输入准备、hash 和 schema 校验在恢复协调副作用之前完成。WebDAV 只投影当前格式，完整索引保留未知条目及额外字段，轮换检查其他条目的文件引用。恢复行删除整个问号入口，四种生产语言删除旧 key 并生成产物。旧数据库 migration、历史 SQLite manifest 别名、网页分组和凭据升级保留在各自 owner。

**验证环境与修正。** 默认 debug 可执行文件被现有开发进程占用，改用 `src-tauri/target/retirement-check`；没有结束用户应用。沙箱对子进程的 `EPERM` 通过获准的同命令沙箱外运行解决。期间修复了 hook 跨层 import、backup owner 函数数量、新文案的旧断言、未加载 locale、Clippy 冗余转换等本次问题，未放宽门槛。恢复行布局使用已支持的桌面最小宽度 900px；390px 的既有语言控件场景不代表桌面支持宽度。

新增真实 IPC 拒绝测试曾用 1970 年开始时间引起大范围投影重建，修正为近期时间。暂停采样仍会封口外部插入的开放行，因此用隔离库触发器拒绝该行的封口，并断言返回格式 / hash 输入错误：若恢复先写库，返回触发器错误即失败。触发器及哨兵行在 `finally` 清理；这既消除了采样竞争，也保留了顺序回归的负例保护。

### 9.3 最终验证与对抗式审查

| 验证入口 | 实际结果与范围 |
| --- | --- |
| `pnpm run check:full` | 通过；完整脚本出口为 0，日志保存在忽略目录 `artifacts/backup-retirement/check-full.log` |
| 前端测试与构建 | 170 项 browser smoke 通过；关键 mutation 27/27；coverage 行 / 语句 97.48%、分支 90.84%、函数 95.74%；全部默认 gates、fast tests、构建和 bundle 检查通过 |
| Rust | 881 项通过、8 项既有忽略；原生探针集成 1 项及其他集成 9 项通过；fmt、check、Clippy `-D warnings` 通过 |
| 依赖审计 | npm 0 漏洞；Rust 无未接受漏洞或 unsound 项，4 个现有 lock-only 例外按检查器确认 Windows 不可达 |
| 最后修改的 TypeScript 文件 | 补跑 `check:types` 与定向 ESLint 通过；仅测试确定性修正和 import 排序发生在完整检查开始之后 |
| `pnpm run test:tauri-runtime-smoke` | 备份相关场景通过，但完整入口退出 1：既有 Widget 原生焦点断言失败。未将其记作整套通过 |
| 发布说明与文档 | `release:validate-changelog` 通过；4 份变更文档严格 UTF-8、代码围栏、65 个本地链接 / 锚点、77 个唯一步骤编号通过；归档后 `check:docs` 通过（21 份活动文档、长期 owner 10/10） |

真实 Tauri 的备份拒绝、非法 / 变化 hash、覆盖后 pool 读写及继续计时、缓存与投影刷新、WebDAV 混合索引、当前下载恢复和不支持内容临时文件清理均通过。2026-10-23 14:22 UTC 开始的完整运行最终仅保留 `widget has native focus before focus-loss control` 失败。随后临时增加主窗口前台激活前提仍得到 `main has native focus ... false`，确认此桌面无法通过程序获得原生前台焦点；临时诊断改动已撤回，原断言保留。

完整 runtime 验收需交互式桌面配合后重跑，当前是明确阻断，不能以备份子场景通过替代。已向用户请求一次点击测试窗口并短暂停止切换窗口的配合；没有将未收到回复当作许可或测试通过。

**对抗式审查。** 以调查 HEAD 为基线覆盖全部本次 unstaged / untracked 文件，无 staged 差异。沿真实命令入口复查格式与 hash 拒绝顺序、私有副本生命周期、覆盖回滚、合并事务、各领域关联、旧 pool 的异步名称结果、WebDAV 完整索引与自动删除归属，以及前端取消、失败、成功和本地化路径。

审查补齐一项测试覆盖缺口：原 ETag 冲突测试重读的是相同索引，不能证明并发新增的未知字段被保留。现在第二次 GET 返回新增未知条目和顶层元数据，断言重试 PUT 含有它们；`cargo test --lib data::remote_backup::tests` 的 21 项全部通过，fmt 通过。生产实现无需因此改动，未新增第二条恢复路径。未发现其他可确认的代码缺陷；以下验收限制仍保留。

### 9.4 已转交的验收与发布责任

| 责任 owner | 未完成事项 | 完成条件与限制 |
| --- | --- | --- |
| 运行时验收维护者（`tests/tauriRuntimeSmoke.test.ts` / `app/widget.rs` owner，归[工程质量](../engineering-quality.md)） | 当前 Windows 桌面拒绝主窗口及 Widget 的程序前台焦点，完整 runtime 入口退出 1 | 在可获得真实原生焦点的交互式桌面重跑完整命令并保留出口 0；不能删除 / 跳过焦点断言，也不能拿 browser DOM focus 代替 native focus。本次代码实现已经完成，发布前仍须解决此验收阻断 |
| 发布维护者（[发布规范](../versioning-and-release-policy.md) owner） | 正式中间版本安装包迁移实验、候选正式安装 / updater 验收、版本号与发布动作 | 隔离账户 / VM 中核对资产摘要、迁移与 SQLite 三路径，并按 release policy 获授权后发布；精确 release 源码 CI 不能冒充安装接受 |

本文归档后，后续验收结论应由上述 owner 的实际验收记录持有；如用户继续本次桌面复验，可补充本节结果。归档不是“所有发布条件均满足”的声明。
