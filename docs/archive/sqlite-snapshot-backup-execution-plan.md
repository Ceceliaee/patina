# SQLite 一致快照备份与恢复执行方案

> 归档状态：实现、仓库级自动化验证和完成后的对抗式审查已于 2026-07-15 完成。本文件不再作为当前执行入口；长期 owner、质量门槛和旧 reader 丢弃窗口分别见 [`../architecture.md`](../architecture.md)、[`../engineering-quality.md`](../engineering-quality.md) 和 [`../versioning-and-release-policy.md`](../versioning-and-release-policy.md)。第 23 节是本次任务的已勾选完成记录。前文未勾选项是冻结的原始风险清单，其中真实 WebDAV 凭据、安装包 Windows smoke、性能采样和丢弃窗口结束后删除旧 reader 属于发布阶段，不能用仓库自动化结果冒充已执行。

## 0. 文档状态

- [x] 文档类型：一次性执行方案（How-to / execution plan）
- [x] 目标读者：负责 Patina Rust 数据层、Tauri IPC、Settings 恢复流程与验证的维护者
- [x] 当前 Project 事项：`定义 v2 SQLite 快照备份与兼容契约`
- [x] 当前任务经维护者追加授权后从“定义契约”扩展为完整实现、验证与归档
- [x] 本文执行期间位于 `docs/working/`，完成后已移动到 `docs/archive/`
- [x] 实施开始前和完成检查点均重新读取 live GitHub Project；Board 拖动仍由维护者执行
- [x] 实施完成后已补充实际交付、验证证据、发布期保留项和 Project 状态建议

## 1. 目标

把 Patina 的正式备份从“按表导出结构化 JSON”切换为“SQLite 一致快照”，同时保留用户已经依赖的两种恢复结果：

- `覆盖`：恢复完成后，受恢复契约管理的数据只来自所选备份。
- `合并`：保留当前数据，同时导入备份中不存在的数据；发生冲突时默认保留当前数据。

本方案必须同时达到以下结果：

- [ ] 新增普通持久化表时，只要它属于主 SQLite 数据库，就自然进入完整备份，不再要求为备份生成维护一份平行的表级 JSON DTO。
- [ ] 备份中的数据库来自同一个 SQLite 一致视图，不出现多张表分别读取时形成的跨时点组合。
- [ ] 任何被接受的备份在写出前和恢复前都经过结构、摘要、SQLite 完整性与 schema 兼容检查。
- [ ] 覆盖恢复在任何失败点都能回到恢复前的数据库文件。
- [ ] 合并恢复在任何失败点都能通过单一 SQLite 事务回到合并前状态。
- [ ] 新格式发布后只生成 SQLite 快照，不再生成旧结构化 JSON ZIP。
- [ ] 旧结构化 JSON ZIP reader 只保留 90 天丢弃窗口，不成为永久双格式主路径。
- [ ] 用户界面不出现 `v1 / v2` 术语；内部只使用精确格式标识做安全分派。
- [ ] Settings 中现有“兼容”恢复文案改为“合并”，避免与旧格式读取兼容混淆。
- [ ] 本地备份和 WebDAV 备份共用同一生成、预览、校验与恢复契约。

## 2. 非目标

- [ ] 不把备份文件设计成人类可读的数据导出；表格、Markdown、CSV 等继续属于数据导出能力。
- [ ] 不提供旧结构化 JSON ZIP 的新写入入口。
- [ ] 不提供让用户选择内部备份格式的 UI。
- [ ] 不承诺永久读取旧结构化 JSON ZIP。
- [ ] 不做多端同步、双向同步、云端数据库或冲突协作系统。
- [ ] 不把 WebDAV 扩张为云同步；WebDAV 仍只传输完整备份文件。
- [ ] 不为合并恢复发明一个“自动理解任意未来表”的通用 SQL 合并器。
- [ ] 不通过复制正在写入的 `patina.db`、`-wal`、`-shm` 文件来伪造一致快照。
- [ ] 不在 `commands/*`、`app/*`、`lib.rs` 或前端组件中承载 SQLite 备份与合并细节。
- [ ] 不在本方案中顺带清理无关 migration、仓储或 Settings 结构。

## 3. 第一性原理

### 3.1 数据事实先于文件格式

备份的核心不是 ZIP、JSON 或 SQLite 文件名，而是：在时点 `T`，用户拥有一份能够重新建立产品事实的数据集合。

因此必须先满足：

- [ ] 同一备份中的所有表来自同一个 SQLite 一致视图。
- [ ] manifest 描述的文件、摘要、schema 与实际快照一致。
- [ ] 不能验证的备份不得进入恢复写入阶段。
- [ ] UI 中显示的预览必须来自已经通过基础校验的同一份文件。

### 3.2 恢复必须先证明失败可逆

恢复是高风险写操作。任何实现方案在讨论“成功时怎么写”之前，必须回答“第 N 步失败后怎样恢复原状”。

- [ ] 覆盖恢复以文件级安全副本和同目录原子切换承担回滚。
- [ ] 合并恢复以单一数据库事务承担回滚。
- [ ] 恢复前检查、恢复写入、恢复后检查分别有明确失败状态。
- [ ] 不把“应用重启后大概能重新打开”当作回滚方案。

### 3.3 格式识别与数据 schema 是两件事

- `format` 回答：容器和 manifest 应该怎样解析。
- SQLite migration head 回答：数据库结构是否可以由当前应用读取或迁移。
- `appVersion` 回答：这份备份由哪个应用版本创建，仅用于诊断和提示。

因此：

- [ ] 不再维护一个与真实 migration head 脱节的手工 `CURRENT_BACKUP_SCHEMA_VERSION`。
- [ ] 不用应用语义版本代替数据库 schema 判断。
- [ ] 不因当前不做多代兼容而省略精确格式标识；未知格式必须安全拒绝。

### 3.4 覆盖与合并是两个不同算法

- 覆盖恢复的正确性标准是“结果只反映所选备份中的受管数据”。
- 合并恢复的正确性标准是“现有事实不丢失，备份中的新事实被导入，重复事实不重复，关联关系不串联”。

因此：

- [ ] 两种策略不得共用一个含糊的“restore”内部实现并依赖大量条件分支偶然区分。
- [ ] 两种策略分别定义状态机、回滚边界、测试矩阵和用户提示。
- [ ] 合并冲突默认当前数据库获胜；例外必须逐数据域写入契约并测试。

### 3.5 兼容必须有退出条件

旧格式读取只是迁移窗口，不是长期产品能力。

- [ ] 90 天从“首个正式写出 SQLite 快照的版本”的发布日期开始计算。
- [ ] 90 天是旧 reader 的发布丢弃窗口，不是在运行时读取系统时间后自动拒绝文件。
- [ ] 迁移窗口内发布的版本继续带旧 reader。
- [ ] 90 天后的第一个正式版本可以删除旧 reader。
- [ ] 删除前至少在发布说明和应用可见说明中提醒用户：恢复旧备份并重新生成当前备份。

## 4. 当前实现基线

实施前必须先验证以下事实仍成立；任何事实变化都要先更新本文。

- [x] 当前正式备份是 `PatinaBackup` 结构化 ZIP。
- [x] 当前 ZIP 包含 `manifest.json`、`checksums.json` 与多个 `data/*.json`。
- [x] 当前校验算法为 CRC32。
- [x] 当前导出按仓储依次读取 sessions、title samples、settings、icon cache、web activity 与 tools 数据。
- [x] 当前导出没有把所有读取固定在同一个显式 SQLite 读事务内。
- [x] 当前 `CURRENT_BACKUP_VERSION = 1`。
- [x] 当前 `CURRENT_BACKUP_SCHEMA_VERSION = 8`，但当前 SQLx migration head 为 `5`；两者不是同一事实来源。
- [x] 当前恢复策略内部值为 `replace | merge`。
- [x] 当前 UI 默认选择 `merge`，中文标签为“兼容”。
- [x] 当前覆盖恢复在单个 SQLite 事务内清空受管表并逐表插入。
- [x] 当前合并恢复在单个 SQLite 事务内逐表插入缺失记录，冲突时多数数据域保留当前值。
- [x] 当前 WebDAV 上传通过调用本地 `export_backup` 生成相同 ZIP，再上传并写入 `backup-index.json`。
- [x] 当前 WebDAV index 直接记录 `backup_version`、`schema_version` 与部分表计数，切换格式时必须迁移其展示 DTO。

实施开始检查：

- [ ] 重新核对上述常量、migration head、表集合与默认恢复策略。
- [ ] 记录首个正式写出 SQLite 快照的目标版本和发布日期。
- [ ] 由该发布日期计算并记录旧 reader 的 90 天截止日期。
- [ ] 确认当前工作树中的无关用户改动并避免覆盖。

## 5. 稳定术语

产品与文档统一使用以下术语：

- `SQLite 快照备份`：当前正式备份格式。
- `旧备份`：迁移窗口内可读取的 `PatinaBackup` 结构化 JSON ZIP。
- `覆盖`：只保留所选备份中的受管数据。
- `合并`：保留当前数据并导入备份中的非重复数据。
- `格式标识`：manifest 内用于精确选择解析器的内部常量。
- `数据库 schema`：由 `_sqlx_migrations` 与当前 migration 集合共同确定的真实数据库结构版本。

明确禁止：

- [ ] 用户界面不显示“v1 备份”“v2 备份”。
- [ ] 不再用“兼容”指代 Merge。
- [ ] 不用“导出”指代备份，避免与人类可读数据导出混淆。
- [ ] 不把“合并”描述为零风险；它仍然是数据库写操作。

## 6. 新备份容器契约

### 6.1 固定结构

```text
Patina-backup-YYYYMMDD-HHMMSS.zip
├── manifest.json
├── database/
│   └── patina.db
└── checksums.json
```

- [ ] ZIP 根目录只允许上述已声明条目。
- [ ] 不把 `-wal`、`-shm`、临时 journal、WebDAV 密码、凭据或缓存目录放入备份。
- [ ] 条目名必须使用 `/`，不得包含绝对路径、盘符、`..`、NUL 或路径规范化后逃逸目标目录的内容。
- [ ] 解压前限制条目数、单条目未压缩大小、总未压缩大小和压缩比，防止 ZIP bomb。
- [ ] 新 writer 可以使用 ZIP Deflate，但 reader 不依赖单一压缩方法，只接受仓库依赖明确支持的方法。
- [ ] 文件名仍保留秒级时间戳，并验证并发生成时不会静默覆盖同名文件。

### 6.2 格式标识

manifest 使用精确、不可猜测的解析分派值：

```json
{
  "format": "PatinaSQLiteSnapshot-1"
}
```

决策：

- [x] 不单独向用户暴露 `formatVersion`。
- [x] 将容器契约代际编码进完整 `format` 标识。
- [ ] reader 只按完整匹配选择 SQLite 快照解析器。
- [ ] `format = PatinaBackup` 只进入冻结的旧 reader。
- [ ] 已识别为 SQLite 快照但校验失败时，不得回退尝试旧 reader。
- [ ] 未知格式立即拒绝，并返回可本地化的“备份格式不受支持”错误。

### 6.3 manifest 建议结构

```json
{
  "format": "PatinaSQLiteSnapshot-1",
  "product": "Patina",
  "createdAtMs": 1784073600000,
  "appVersion": "1.x.y",
  "database": {
    "path": "database/patina.db",
    "sizeBytes": 123456,
    "sha256": "<64 lowercase hex characters>",
    "migrationHead": 5,
    "migrationFingerprint": "<sha256 of ordered expected migration metadata>"
  },
  "restore": {
    "strategies": ["replace", "merge"]
  }
}
```

字段规则：

- [ ] `format` 必填，完整匹配。
- [ ] `product` 必填且必须为 `Patina`。
- [ ] `createdAtMs` 必须是非负整数，并仅作为显示与审计信息。
- [ ] `appVersion` 必填，但不作为唯一恢复门禁。
- [ ] `database.path` 必须精确等于约定路径，不允许 manifest 指向任意外部路径。
- [ ] `database.sizeBytes` 必须与 ZIP 解压后文件长度一致。
- [ ] `database.sha256` 必须与解压后数据库字节一致。
- [ ] `database.migrationHead` 必须来自快照内 `_sqlx_migrations` 的已成功 migration 事实。
- [ ] `database.migrationFingerprint` 必须由有序 migration 元数据计算，用于发现同版本不同 SQL 的异常。
- [ ] `restore.strategies` 仅用于描述该备份声明的能力；当前 reader 仍以应用实现支持范围为最终准入条件。
- [ ] manifest parser 对缺失必填字段、错误类型、超长字符串与额外危险字段返回结构化错误。

### 6.4 checksums.json

```json
{
  "algorithm": "sha256",
  "files": {
    "manifest.json": "<sha256>",
    "database/patina.db": "<sha256>"
  }
}
```

- [ ] 使用 SHA-256，不再使用 CRC32 作为新格式完整性校验。
- [ ] 明确解决 manifest 自引用：manifest 不包含自身摘要；`checksums.json` 包含 manifest 与数据库摘要；`checksums.json` 不包含自身摘要。
- [ ] 同时校验 manifest 中的数据库摘要和 checksums 中的数据库摘要，两者必须相等。
- [ ] 摘要比较使用固定格式验证并避免接受大小写、长度或非十六进制歧义。
- [ ] CRC32 只保留在旧 reader 内，不进入新格式。

## 7. SQLite 一致快照生成契约

### 7.1 实现选型门禁

先验证当前 SQLx/SQLite 组合可安全使用哪一种官方一致快照机制：

- [ ] 评估 SQLite Online Backup API。
- [ ] 评估 `VACUUM INTO`。
- [ ] 验证所选机制在当前 journal mode、单连接池和活跃 tracking 写入下的一致性。
- [ ] 验证 Windows 文件锁、杀毒软件短暂占用和目标文件已存在时的失败行为。
- [ ] 验证依赖选择不会同时链接两套不兼容的 SQLite runtime。
- [ ] 在选型记录中写明为什么所选方案比直接复制数据库文件安全。

停止条件：

- [ ] 如果 Online Backup API 需要引入第二套 bundled SQLite，暂停并先解决依赖所有权，不直接加入 `rusqlite(bundled)`。
- [ ] 如果 `VACUUM INTO` 无法在当前连接模型下证明一致与可取消，暂停并选择其他机制。
- [ ] 如果必须关闭 tracking 才能生成快照，必须把暂停时长、用户影响与恢复失败行为写入契约后再继续。

### 7.2 生成状态机

```text
Idle
  -> ResolveTarget
  -> CreatePrivateTempDir
  -> CreateConsistentDbSnapshot
  -> ValidateSnapshotDb
  -> BuildManifestAndChecksums
  -> BuildArchiveAtTempPath
  -> ValidateCompletedArchive
  -> PublishTargetAtomically
  -> Cleanup
  -> Completed
```

逐步要求：

- [ ] 解析最终目标路径，但不立刻覆盖现有目标。
- [ ] 在应用受控临时目录创建唯一工作目录，权限仅限当前用户。
- [ ] 在临时目录生成数据库快照，目标文件必须预先不存在。
- [ ] 对快照执行 `PRAGMA quick_check` 作为快速诊断，并在发布 ZIP 前执行完整 `PRAGMA integrity_check`；任一结果非 `ok` 立即失败。
- [ ] 对快照执行 `PRAGMA foreign_key_check`；存在结果行立即失败。
- [ ] 读取 `_sqlx_migrations`，确认全部记录 `success = 1`，没有未知或半应用 migration。
- [ ] 计算 migration head、migration fingerprint、数据库大小与 SHA-256。
- [ ] 写 manifest 与 checksums。
- [ ] 在临时路径完成 ZIP。
- [ ] 用正式 reader 重新打开刚生成的 ZIP 并完成预览校验，避免 writer 和 reader 契约漂移。
- [ ] 通过同目录临时文件重命名发布最终 ZIP，避免留下半写文件。
- [ ] 如果目标已存在，必须遵循显式的覆盖确认结果；不得静默覆盖。
- [ ] 无论成功或失败都清理临时数据库、临时 ZIP 与工作目录；清理失败记录诊断但不得误报备份成功。

### 7.3 一致性自动化证明

- [ ] 构造跨表关联数据，在快照期间持续写入 sessions 与 title samples。
- [ ] 重复生成至少多轮快照，确认每份均通过 foreign key 与业务关联检查。
- [ ] 在快照生成的多个阶段注入失败，确认不会发布半成品 ZIP。
- [ ] 在目标 ZIP 已存在、目标目录只读、磁盘空间不足模拟条件下验证失败提示和清理。
- [ ] 验证生成过程不会长时间阻塞 tracking 主链；记录基准数据和允许预算。

## 8. 备份识别、预览与准入契约

### 8.1 识别顺序

- [ ] 先验证路径非空、文件存在、是普通文件且大小在允许范围内。
- [ ] 打开 ZIP 并只读取受限大小的 `manifest.json`。
- [ ] 完整匹配 `format`。
- [ ] `PatinaSQLiteSnapshot-1` 进入新 reader。
- [ ] `PatinaBackup` 在 90 天迁移代码存在期间进入冻结旧 reader。
- [ ] 其他值拒绝。
- [ ] manifest 缺失时拒绝，不再猜测 ZIP 中是否有旧 `backup.json`。

### 8.2 新快照准入检查顺序

- [ ] ZIP 路径安全和资源限制检查。
- [ ] manifest schema 检查。
- [ ] checksums schema 检查。
- [ ] 文件集合与声明一致性检查。
- [ ] size 与 SHA-256 检查。
- [ ] SQLite 文件头检查。
- [ ] 以只读方式打开候选数据库。
- [ ] `quick_check`。
- [ ] 恢复开始前执行完整 `integrity_check`；preview 如为控制响应时间只运行 `quick_check`，必须明确标记恢复阶段仍会复检。
- [ ] `foreign_key_check`。
- [ ] migration metadata 与 manifest 一致性检查。
- [ ] schema 可迁移性判断。
- [ ] 统计预览读取。
- [ ] 输出结构化 `BackupPreview`。

### 8.3 schema 判断

- [ ] 当前应用的期望 migration 集合是唯一权威源。
- [ ] 快照 migration head 等于当前 head 且 fingerprint 一致：直接支持。
- [ ] 快照 head 低于当前 head，且所有已有 migration 元数据是当前集合的合法前缀：允许在临时副本上升级。
- [ ] 快照 head 高于当前 head：拒绝并提示升级应用。
- [ ] head 相同但 fingerprint 不同：拒绝，视为 migration 分叉或损坏。
- [ ] `_sqlx_migrations` 缺失或记录失败：拒绝新格式快照。
- [ ] 不再使用手工 backup schema 常量替代上述判断。

### 8.4 预览字段

预览至少返回：

- [ ] `formatKind: sqliteSnapshot | legacyStructured`
- [ ] 创建时间。
- [ ] 创建应用版本。
- [ ] migration head。
- [ ] 是否需要 migration。
- [ ] 是否支持覆盖。
- [ ] 是否支持合并。
- [ ] 不支持原因的本地化 message key 与参数。
- [ ] sessions、title samples、web activity、settings、tools 等用户可理解的摘要计数。
- [ ] 是否处于旧格式迁移窗口。

计数要求：

- [ ] 计数只从已校验并以只读方式打开的候选数据库读取。
- [ ] 计数查询有明确超时或取消边界。
- [ ] 预览失败时不得进入恢复确认。

## 9. 覆盖恢复契约

### 9.1 结果不变量

覆盖成功后：

- [ ] 主数据库受管数据与所选备份的数据库事实一致。
- [ ] 候选快照如需 migration，结果与“先安装创建备份的旧版本、再逐版升级”应等价。
- [ ] 恢复前本机新增但备份中不存在的受管数据不保留。
- [ ] 凭据等明确不进入备份的数据仍按产品安全规则保留或清空，不因数据库文件切换意外泄露。
- [ ] tracking runtime、Settings、Dashboard、History、Data 与 Tools 在重新打开后读取同一个恢复结果。

### 9.2 覆盖状态机

```text
Previewed
  -> ExtractToPrivateTempDir
  -> ValidateCandidate
  -> CloneCandidateForMigration
  -> MigrateCandidate
  -> ValidateMigratedCandidate
  -> QuiesceRuntimeWrites
  -> CloseSqlitePool
  -> PreserveCurrentDb
  -> InstallCandidateDb
  -> ReopenPool
  -> PostRestoreValidation
  -> RefreshRuntimeAndUi
  -> DeleteRollbackCopy
  -> Completed
```

失败分支：

```text
FailureBeforeSwitch -> cleanup candidate -> current DB untouched
FailureAfterPreserve -> restore original file -> reopen -> validate -> report failure
FailureAfterInstall  -> close candidate -> restore original file -> reopen -> validate -> report failure
RollbackFailure      -> preserve all artifacts -> stop writes -> show recovery-required error
```

### 9.3 覆盖逐步清单

- [ ] 重新执行恢复时校验，不信任之前缓存的预览结果。
- [ ] 将数据库解压到私有临时目录，不直接解压到产品 data root。
- [ ] 复制候选数据库作为 migration 工作副本；原始解压快照保持只读证据。
- [ ] 在工作副本上运行当前 migration/repair 链。
- [ ] migration 后执行 `quick_check`、完整 `integrity_check`、`foreign_key_check` 与 migration metadata 检查。
- [ ] 请求 tracking/runtime 进入写入静默状态，并封口当前活跃记录。
- [ ] 等待所有已授权 SQLite 写入完成；新写入必须被拒绝或排队。
- [ ] 关闭并注销当前 SQLite pool，确认没有持有数据库文件句柄。
- [ ] 在与 `patina.db` 相同目录创建恢复前回滚副本，确保重命名处于同一文件系统。
- [ ] 处理可能存在的 journal/WAL/SHM 文件；策略必须与实际 journal mode 一致并有测试。
- [ ] 将候选数据库移动到临时安装名。
- [ ] 通过同目录重命名把候选数据库安装为正式 `patina.db`。
- [ ] 重新打开单连接 SQLite pool。
- [ ] 再次执行 `integrity_check`、外键、migration 和关键业务不变量检查。
- [ ] 同步 desktop behavior、Settings、tracking runtime 与前端刷新事件。
- [ ] 只有以上步骤全部成功后才删除回滚副本。
- [ ] 失败时先停止候选数据库写入，关闭 pool，恢复原文件，再重新打开和验证原数据库。
- [ ] 回滚失败时不得继续 tracking；保留原文件、候选文件和诊断信息，并给出可操作的恢复路径。

### 9.4 覆盖特殊数据

- [ ] 明确 WebDAV 密码不在 SQLite 快照中的事实；恢复后如果配置存在但密码缺失，提示重新输入。
- [ ] 明确缓存类表是否随快照覆盖；如果属于可再生缓存但仍在主库中，默认随完整快照覆盖，不建立例外复制逻辑。
- [ ] 明确正在运行的提醒、计时器、番茄钟恢复后如何归一化，避免恢复出过期但仍 active 的运行态。
- [ ] 明确 active session 与 active web segment 在快照生成和恢复后的封口规则。
- [ ] 明确自增序列随 SQLite 文件恢复，并验证后续插入不会主键冲突。

## 10. 合并恢复契约

### 10.1 结果不变量

合并成功后：

- [ ] 合并前当前数据库的有效事实全部保留。
- [ ] 备份中不存在于当前数据库的有效事实被导入。
- [ ] 同一业务事实不会因重复合并同一备份而重复出现。
- [ ] 当前数据库与备份冲突时默认保留当前值。
- [ ] 父子记录的关联指向合并后正确的本地主键。
- [ ] 重复执行同一合并应幂等。
- [ ] 任一步失败时整个合并事务回滚。

### 10.2 合并算法边界

SQLite 文件快照自动覆盖所有表，但“哪些行是同一事实”无法由文件格式自动推断。因此合并必须是显式的领域导入能力：

- [ ] 在 `data/backup/merge/*` 或等价真实 data owner 下维护合并规则。
- [ ] 不在 manifest 中存储逐表合并 SQL。
- [ ] 不根据任意表名动态拼接 SQL。
- [ ] 新 migration 新增用户事实表时，必须明确选择：参与合并、仅覆盖、可再生忽略或禁止合并。
- [ ] migration review checklist 增加“备份合并策略”检查，但备份生成不再增加逐表映射。

### 10.3 合并状态机

```text
Previewed
  -> ExtractToPrivateTempDir
  -> ValidateCandidate
  -> CloneAndMigrateCandidate
  -> ValidateMigratedCandidate
  -> QuiesceRuntimeWrites
  -> AttachCandidateReadOnly
  -> BeginSingleMergeTransaction
  -> MergeParentsAndBuildIdMaps
  -> MergeChildren
  -> ValidateMergedState
  -> Commit
  -> DetachCandidate
  -> RefreshRuntimeAndUi
  -> Completed
```

- [ ] 候选数据库先在临时副本上迁移到当前 schema。
- [ ] 合并源以只读方式 attach 或通过受控只读连接读取。
- [ ] 动态 attach 路径必须使用数据库驱动支持的安全绑定或经过严格路径控制，不拼接用户输入。
- [ ] tracking/runtime 在合并事务期间停止产生新业务事实，避免去重集合移动。
- [ ] 所有写入必须位于一个目标数据库事务中。
- [ ] 父记录先合并并建立 `source_id -> target_id` 映射，子记录后合并。
- [ ] 合并后、提交前执行外键与业务不变量检查。
- [ ] 校验失败立即回滚。
- [ ] 提交成功后再刷新 runtime 与 UI。

### 10.4 当前数据域合并矩阵

以下矩阵是最低契约；实施前必须与当前 schema 再核对。

| 数据域 | 业务重复键 | 冲突规则 | 关联处理 |
| --- | --- | --- | --- |
| `sessions` | `app_name + exe_name + normalized window_title + start_time + end_time + duration`；需复核是否加入 continuity 语义 | 当前记录获胜；备份只补缺失事实 | 建立备份 session ID 到本地 session ID 映射 |
| `session_title_samples` | 映射后的 session ID + title + start_time + end_time | 当前记录获胜 | 必须使用 session ID 映射，孤儿样本跳过并计入诊断 |
| `settings` | `key` | 当前值获胜；备份只补缺失 key | 无 |
| `icon_cache` | 规范化 `exe_name` | 当前缓存获胜；缺失时导入 | 无 |
| `web_activity_segments` | browser client/kind/exe + normalized domain + URL + title + start/end time | 当前记录获胜；备份只补缺失事实 | favicon cache 按当前仓储规则派生或 upsert |
| `web_favicon_cache` | `normalized_domain` | 更新策略必须明确；默认当前值获胜 | 不允许与 segment 派生逻辑分叉 |
| `tool_reminders` | 不直接信任源 ID；需定义稳定业务键或安全 ID 重映射 | 当前事实获胜 | 与通知运行态隔离 |
| `tool_timers` | 不直接信任源 ID；需定义稳定业务键 | 当前事实获胜 | 建立 timer ID 映射 |
| `tool_timer_laps` | 映射后的 timer ID + lap index/时间事实 | 当前事实获胜 | 必须使用 timer ID 映射 |
| `tool_pomodoro_runs` | 需定义稳定业务键，不能只依赖源 ID | 当前事实获胜 | 恢复后运行态归一化 |
| `tool_daily_stats` | `date_key` | 当前统计获胜，除非后续明确采用可证明的重算规则 | 无 |
| `software_reminder_rules` | 需按当前 schema 定义稳定规则标识 | 当前配置获胜 | 与 reminder 实例分离 |

矩阵落地检查：

- [ ] 为每个主表写出唯一性理由，而不是只复制现有 SQL。
- [ ] 对 nullable 字段明确 `NULL` 与空字符串是否等价。
- [ ] 对大小写、路径、exe name、domain 等字段明确归一化规则。
- [ ] 不把数据库自增 ID 当作跨数据库稳定身份。
- [ ] 对没有可靠业务键的数据域，先建立确定性导入身份或明确不支持合并，不能用 `INSERT OR IGNORE` 掩盖冲突。
- [ ] 对每个父子关系测试源 ID 与本地 ID 碰撞。
- [ ] 记录每个数据域的 inserted/skipped/conflicted/orphaned 计数，用于测试和诊断；用户提示不暴露数据库内部细节。

### 10.5 合并幂等测试

- [ ] 空库合并一次，结果等于备份事实。
- [ ] 同一备份连续合并两次，第二次不新增重复事实。
- [ ] 当前库含相同业务事实但主键不同，合并不重复且子记录映射正确。
- [ ] 当前设置与备份设置冲突，当前设置保留。
- [ ] 当前与备份各有独有记录，结果为去重并集。
- [ ] 父记录成功但子记录插入失败时，整个事务回滚。
- [ ] 候选库 migration 成功但目标合并失败时，当前库保持不变。
- [ ] 合并期间 runtime 写入被正确静默，完成后恢复。

## 11. 旧结构化备份 reader 的 90 天丢弃窗口

### 11.1 迁移窗口规则

- [x] 新 writer 上线后不再生成旧备份。
- [x] 旧 reader 仅承担恢复迁移。
- [x] 旧 reader 在首个新 writer 正式版本发布后保留 90 天。
- [x] 旧 reader 在迁移期内继续支持现有覆盖和合并语义。
- [ ] 旧 UI 中文“兼容”同步改为“合并”。
- [ ] 旧 reader 冻结：不为新格式发布后新增的数据表或字段扩展旧 JSON payload。
- [ ] 从旧备份恢复成功后，提示用户立即创建当前 SQLite 快照备份。
- [ ] 本地与 WebDAV 下载的旧备份使用同一截止策略。

### 11.2 截止日期记录

- [ ] 在新 writer 的发布执行单中记录 `snapshot_writer_release_date`。
- [ ] 计算 `legacy_reader_eligible_removal_date = release_date + 90 days`。
- [ ] 在 changelog 的首次发布项中写明迁移截止日期。
- [ ] 在 90 天内至少一个后续正式版本继续提醒迁移。
- [ ] 截止日期前不删除旧 fixture、旧 reader 测试与旧恢复入口。
- [ ] 截止日期不是运行时开关；已发布二进制不会因本机日期改变行为。

### 11.3 旧 reader 删除条件

90 天后只有全部满足才可删除：

- [ ] 已到 eligible removal date。
- [ ] 发布说明已提前提醒。
- [ ] 当前 SQLite 快照备份与两种恢复策略已经过正式版本验证。
- [ ] WebDAV 当前格式上传、列表、下载、预览与恢复稳定。
- [ ] 没有仍需旧 reader 才能完成的已知数据恢复事故。
- [ ] 删除作为独立、可审查变更实施，不混入无关功能。
- [ ] 删除旧 reader 后，旧文件得到明确“迁移窗口已结束”提示，不误报损坏。

删除范围：

- [ ] 删除旧 JSON writer 遗留代码。
- [ ] 删除旧 archive DTO 与表级备份 payload。
- [ ] 删除旧 CRC32 校验路径。
- [ ] 删除旧 reader 与 fixtures。
- [ ] 删除只服务旧格式的 preview 字段映射。
- [ ] 保留与新格式合并仍共享的领域合并规则，不因名字中有 restore 就误删。

## 12. WebDAV 集成

- [ ] WebDAV 上传继续调用唯一正式 `export_backup`，自然获得 SQLite 快照 ZIP。
- [ ] 上传前必须通过正式 preview/validation，不上传未验证文件。
- [ ] `backup-index.json` 不再以旧 `backup_version` 作为主展示字段。
- [ ] index entry 增加或改为 `format`、migration head、创建版本、文件大小和用户摘要计数。
- [ ] index 仍只作为列表索引；恢复时必须下载并重新验证实际 ZIP，不能信任 index。
- [ ] 旧 index entry 在 90 天窗口内仍可列出和下载。
- [ ] index parser 对新旧 entry 使用明确 DTO，不用大量 optional 字段把两代格式混成一个无约束对象。
- [ ] 上传成功但 index 更新失败的既有语义保持：备份文件已上传，列表索引更新失败。
- [ ] 下载校验失败不得进入恢复策略选择。
- [ ] 临时下载文件在恢复成功后清理；失败时按当前会话重试策略保留，应用退出或明确取消后清理。
- [ ] WebDAV 密码始终留在系统凭据存储，不进入 SQLite 快照或 ZIP。

## 13. UI 与 IPC 契约

### 13.1 UI

- [ ] Settings 文案从“恢复时可选择覆盖或合并当前数据”保持清晰一致。
- [ ] 策略选项中文由“兼容”改为“合并”。
- [ ] `覆盖`说明：恢复后只保留所选备份中的数据；开始前会创建安全回滚副本。
- [ ] `合并`说明：保留当前数据，导入备份中不存在的数据；冲突时保留当前数据。
- [ ] 默认策略继续为合并，除非真实用户研究或现有产品决定另行修改。
- [ ] 覆盖使用危险等级确认；合并也明确提示其为数据库写操作，但视觉强度低于覆盖。
- [ ] 预览显示来源、时间、应用版本、数据摘要、是否需要升级数据库以及旧格式迁移提示。
- [ ] 不显示内部 `PatinaSQLiteSnapshot-1`。
- [ ] 不增加新的装饰性卡片、渐变、玻璃或页面局部样式；复用 Quiet Pro dialog、control、status。
- [ ] 定义 default、hover、active、focus、disabled、loading、error 和 unsupported 状态。

### 13.2 IPC

建议使预览与恢复分派显式类型化：

- [ ] `BackupFormatKind = sqliteSnapshot | legacyStructured`。
- [ ] `BackupRestoreStrategy = replace | merge` 保持稳定值，避免无必要协议破坏。
- [ ] preview 返回 `supportedStrategies`，前端不自行猜测。
- [ ] restore command 接收路径、策略和预览生成的短期校验 token 或文件指纹，后端仍重新校验文件。
- [ ] command 只接收参数并转发，不承载解析、SQLite 或文件切换逻辑。
- [ ] 所有错误通过稳定 message key + args 映射，不把 SQL、绝对敏感路径或内部栈直接显示给用户。

## 14. Owner 与目标结构

推荐 Rust owner：

```text
src-tauri/src/
  domain/backup.rs                 # 稳定术语、format kind、preview、策略与兼容判断
  data/backup.rs                   # 薄数据流程出口
  data/backup/
    archive.rs                     # ZIP 容器与安全解码
    manifest.rs                    # 新 manifest/checksum 契约
    snapshot.rs                    # 一致快照生成与验证
    inspect.rs                     # 只读 SQLite 检查和 preview
    replace.rs                     # 覆盖状态机与文件回滚
    merge.rs                       # 合并编排
    merge/
      sessions.rs
      settings.rs
      web_activity.rs
      tools.rs
    legacy.rs                      # 冻结旧 reader，带删除日期说明
    paths.rs
```

结构检查：

- [ ] 先以真实职责判断是否需要上述拆分，不为目录对称而拆空文件。
- [ ] SQL 与 SQLite pool 只留在 `data/*`。
- [ ] `domain/backup.rs` 只保留稳定契约和纯判断，不依赖 data/platform。
- [ ] `commands/backup.rs` 保持参数接收与转发。
- [ ] `app/backup.rs` 只保留恢复后应用级刷新协调，不获取 pool、不写 SQL。
- [ ] 文件系统原子切换如需要平台差异，明确放入 `platform/*` 的最小文件原语；业务恢复状态机仍由 data owner 编排。
- [ ] 前端 Tauri 适配继续留在 `src/platform/backup/*`。
- [ ] Settings 私有流程继续留在 `src/features/settings/*`。
- [ ] 不恢复根层 `src/lib/*` 或 `src/types/*`。

## 15. 分阶段实施清单

### 阶段 0：重新确认契约与风险

- [ ] 重新读取 live Project 和本事项正文。
- [ ] 确认本方案中的覆盖、合并、90 天和 UI 命名已经获得维护者确认。
- [ ] 确认目标发布版本。
- [ ] 记录 90 天迁移窗口的开始和可删除日期。
- [ ] 盘点当前主数据库所有表、索引、触发器、外键与 migration。
- [ ] 盘点哪些敏感数据不在数据库中。
- [ ] 盘点 runtime 活跃写入入口与关闭/重开 pool 的现有能力。
- [ ] 为快照选型、覆盖切换和合并恢复分别写风险表。

阶段退出条件：没有未决的产品语义；所有当前数据域都有 owner。

### 阶段 1：先写契约与失败测试

- [ ] 为精确格式识别写失败测试。
- [ ] 为 ZIP traversal、绝对路径、重复条目、超限大小写失败测试。
- [ ] 为 manifest 缺失、错误类型、未知格式写失败测试。
- [ ] 为 SHA-256 不匹配、size 不匹配写失败测试。
- [ ] 为 SQLite 损坏、foreign key 失败、migration 分叉写失败测试。
- [ ] 为较新 schema 拒绝、较旧合法 schema 可迁移写测试。
- [ ] 为覆盖各失败注入点写回滚测试骨架。
- [ ] 为合并每个数据域写幂等、冲突和 ID 碰撞测试骨架。
- [ ] 确认测试被 Cargo module tree 自动发现。

阶段退出条件：关键风险均有会先失败的自动化测试，不只测试 happy path。

### 阶段 2：实现新容器与只读检查

- [ ] 新增精确 format、manifest 与 checksums DTO。
- [ ] 实现有资源上限的 ZIP reader。
- [ ] 实现 SHA-256。
- [ ] 实现受控临时目录和路径校验。
- [ ] 实现只读 SQLite 打开与完整性检查。
- [ ] 实现 migration metadata 读取、head 和 fingerprint。
- [ ] 实现新 preview DTO。
- [ ] 保持旧 reader 独立且冻结。
- [ ] 通过阶段 1 对应测试。

阶段退出条件：应用可以安全识别、校验和预览手工 fixture，但还不生成或恢复。

### 阶段 3：实现一致快照生成

- [ ] 完成 Online Backup API 与 `VACUUM INTO` 技术 spike。
- [ ] 记录选型与拒绝方案。
- [ ] 实现临时 SQLite 快照生成。
- [ ] 实现生成后数据库检查。
- [ ] 实现 manifest/checksums/ZIP 写出。
- [ ] 实现临时 ZIP 自读验证。
- [ ] 实现最终路径原子发布与清理。
- [ ] 替换本地 writer；删除或封闭旧 writer 生产入口。
- [ ] 验证活跃 tracking 期间的一致性和耗时。

阶段退出条件：只生成新格式；任何失败不发布半成品。

### 阶段 4：实现覆盖恢复

- [ ] 实现候选副本 migration。
- [ ] 实现 runtime 写入静默与恢复。
- [ ] 实现 SQLite pool 关闭、注销与重开。
- [ ] 实现同目录恢复前安全副本。
- [ ] 实现候选文件安装与原文件回滚。
- [ ] 实现 post-restore 检查。
- [ ] 实现 runtime/UI 刷新。
- [ ] 覆盖所有失败注入点。
- [ ] 验证恢复后继续 tracking、保存 settings 和创建 tools 数据正常。

阶段退出条件：覆盖成功结果正确，任一失败点原数据库可验证地恢复。

### 阶段 5：实现合并恢复

- [ ] 冻结并评审数据域合并矩阵。
- [ ] 实现候选库 migration 和只读 attach/read。
- [ ] 实现 sessions 合并与 ID map。
- [ ] 实现 title samples 合并。
- [ ] 实现 settings 合并。
- [ ] 实现 icon/favicon cache 合并。
- [ ] 实现 web activity 合并。
- [ ] 实现 tools 父子数据合并和 ID map。
- [ ] 实现 software reminder rules 合并。
- [ ] 实现合并统计与诊断。
- [ ] 提交前执行不变量检查。
- [ ] 验证幂等、当前值获胜、父子 ID 碰撞和全事务回滚。

阶段退出条件：所有当前数据域有明确规则，同一备份重复合并不增加重复事实。

### 阶段 6：接入 Settings 与 WebDAV

- [ ] 更新 preview gateway 与 raw DTO 映射。
- [ ] 将中文“兼容”改为“合并”，同步英文保持 `Merge`。
- [ ] 更新覆盖与合并说明及确认文案。
- [ ] 本地选择文件后先 preview，再选择策略，再确认恢复。
- [ ] WebDAV 下载后使用相同 preview 和策略流程。
- [ ] 更新 remote backup index DTO 与新旧 entry 读取。
- [ ] 验证上传前自检、下载后复检。
- [ ] 验证旧格式迁移提示和恢复后重新备份提示。
- [ ] 覆盖 UI loading、disabled、error、unsupported 状态。

阶段退出条件：本地与 WebDAV 没有第二套恢复语义；用户能清楚区分覆盖和合并。

### 阶段 7：旧 reader 迁移窗口发布

- [ ] 在 changelog 记录新备份格式、旧 reader 截止日期和迁移步骤。
- [ ] 更新用户文档中的备份与恢复说明。
- [ ] 发布前验证旧 ZIP 覆盖和合并。
- [ ] 发布前验证新快照覆盖和合并。
- [ ] 记录正式发布日期与 90 天日期。
- [ ] 发布后按 smoke checklist 实测本地和 WebDAV。
- [ ] 保留旧 fixtures 和专项测试直到删除版本。

阶段退出条件：首个正式版本可安全生成新快照并恢复两种格式。

### 阶段 8：90 天后删除旧 reader

- [ ] 核对退出条件全部满足。
- [ ] 重新读取 live Project，按独立清理事项处理。
- [ ] 删除旧 reader、CRC32、JSON payload 与 fixtures。
- [ ] 删除旧 preview/remote index 兼容 DTO。
- [ ] 保留新快照的覆盖与合并能力。
- [ ] 更新 changelog，明确旧备份迁移窗口结束。
- [ ] 运行完整验证和发布 smoke。

阶段退出条件：仓库只维护一种正式备份格式和一套当前恢复契约。

## 16. 自动化验证矩阵

### 16.1 容器与安全

- [ ] 正常 ZIP 可读。
- [ ] Deflate ZIP 可读。
- [ ] 非 ZIP 拒绝。
- [ ] manifest 缺失拒绝。
- [ ] 重复 manifest 条目拒绝。
- [ ] traversal 条目拒绝。
- [ ] 超大条目或异常压缩比拒绝。
- [ ] SHA-256 不符拒绝。
- [ ] SQLite 文件头错误拒绝。
- [ ] `quick_check` 通过但完整 `integrity_check` 失败时仍拒绝恢复。

### 16.2 schema

- [ ] 当前 head + 当前 fingerprint 支持。
- [ ] 合法旧 head 可以在副本上迁移。
- [ ] 较新 head 拒绝。
- [ ] 相同 head 不同 fingerprint 拒绝。
- [ ] migration 失败记录拒绝。
- [ ] 缺 `_sqlx_migrations` 拒绝新快照。

### 16.3 生成

- [ ] 活跃写入期间生成的一致快照通过检查。
- [ ] 生成失败不留下最终 ZIP。
- [ ] 最终 ZIP 可由正式 reader 预览。
- [ ] 新表无需 writer DTO 即进入 SQLite 快照。
- [ ] 凭据和临时文件不进入 ZIP。

### 16.4 覆盖

- [ ] 空当前库覆盖。
- [ ] 非空当前库覆盖后只保留备份事实。
- [ ] migration 前失败不碰当前库。
- [ ] pool 关闭失败不切换文件。
- [ ] 文件安装失败恢复原库。
- [ ] post-check 失败恢复原库。
- [ ] runtime 刷新失败的数据库状态和用户提示明确。
- [ ] 回滚后继续写入正常。

### 16.5 合并

- [ ] 空当前库合并。
- [ ] 不相交数据并集。
- [ ] 完全重复数据幂等。
- [ ] 部分冲突当前值获胜。
- [ ] session ID 碰撞正确映射 title samples。
- [ ] timer ID 碰撞正确映射 laps。
- [ ] orphan 输入按契约跳过并诊断。
- [ ] 中途失败全部回滚。
- [ ] 连续合并两次第二次 inserted 为零。

### 16.6 旧格式迁移

- [ ] 旧 ZIP 覆盖仍成功。
- [ ] 旧 ZIP 合并仍成功。
- [ ] 旧 ZIP 恢复后新 writer 只生成 SQLite 快照。
- [ ] 已识别但损坏的旧 ZIP 不误入新 reader。
- [ ] 新快照损坏不回退旧 reader。

### 16.7 WebDAV

- [ ] 新快照上传、index、列表、下载和 preview。
- [ ] 旧 index entry 在窗口内仍可下载。
- [ ] 下载摘要不符不恢复。
- [ ] index 更新失败不误报文件上传失败。
- [ ] 密码不进入备份。

## 17. 手工验证场景

每个场景都使用可丢弃测试数据，不直接以唯一真实用户数据库作为首次验证对象。

### 场景 A：新快照覆盖

- [ ] 创建数据集 A 并备份。
- [ ] 在当前库新增只属于数据集 B 的 sessions、settings、web activity 和 tools 数据。
- [ ] 选择备份 A，确认预览。
- [ ] 选择“覆盖”。
- [ ] 确认恢复后只存在 A 的受管数据。
- [ ] 确认应用继续 tracking，设置与工具页可用。

### 场景 B：新快照合并

- [ ] 创建包含共同数据 C 和独有数据 A 的备份。
- [ ] 当前库保留共同数据 C，并新增独有数据 B。
- [ ] 为相同 setting key 设置不同值。
- [ ] 选择“合并”。
- [ ] 确认结果为 A + B + 单份 C。
- [ ] 确认 setting 使用当前库值。
- [ ] 再次合并同一备份，确认计数不增加。

### 场景 C：覆盖失败回滚

- [ ] 在文件切换或 post-check 阶段使用测试注入制造失败。
- [ ] 确认原数据库恢复。
- [ ] 确认失败前新增的当前数据仍存在。
- [ ] 确认应用可以继续写入。

### 场景 D：旧格式迁移

- [ ] 选择真实历史 fixture 的旧 ZIP。
- [ ] 分别验证覆盖和合并。
- [ ] 恢复成功后生成新备份。
- [ ] 确认新备份为 SQLite 快照格式。

### 场景 E：WebDAV

- [ ] 上传新快照两次并确认不同文件名。
- [ ] 下载较早备份并预览。
- [ ] 分别执行覆盖和合并测试。
- [ ] 确认失败文件不会进入恢复。

## 18. 性能与资源预算

- [ ] 记录 10 MB、100 MB、500 MB 测试数据库的快照耗时、ZIP 耗时、峰值内存和临时磁盘占用。
- [ ] 记录上述规模的 preview、覆盖和合并耗时。
- [ ] 生成与覆盖的临时磁盘预算至少考虑“数据库副本 + ZIP + 回滚副本”的峰值。
- [ ] 磁盘空间不足必须在危险写入前尽早失败。
- [ ] 合并不得把所有表完整加载进内存；使用流式/批量 SQL 与有界映射。
- [ ] 大 ID 映射采用临时表或有界结构，避免无界 HashMap 导致内存峰值。
- [ ] UI 显示稳定 loading 状态，不因后台操作阻塞渲染线程。
- [ ] 不为了缩短备份时间降低完整性检查或回滚保证。

## 19. 最低验证命令

专项开发过程中：

- [ ] 运行命中的 Rust backup/archive/restore tests。
- [ ] 运行命中的 frontend settings/backup tests。
- [ ] 运行 WebDAV backup 专项测试。

阶段交付前：

- [ ] `npm test`
- [ ] `npm run test:replay`
- [ ] `npm run build`
- [ ] `npm run check:rust`
- [ ] `npm run check:full`

发布前：

- [ ] `npm run release:check -- <target-version>`
- [ ] 当前版本要求的安装包、updater artifact 与 smoke checklist。
- [ ] 在实际 Windows 文件系统上执行覆盖回滚与 WebDAV 手工验证。

任何命令跳过时：

- [ ] 记录未运行原因。
- [ ] 记录替代证据。
- [ ] 明确剩余风险和补验负责人。

## 20. 风险清单与停止信号

### 20.1 必须停止实施并重新评审

- [ ] 无法证明快照来自一致 SQLite 视图。
- [ ] 必须直接复制活跃数据库及 WAL 文件才能继续。
- [ ] 覆盖恢复无法在 Windows 上可靠关闭句柄并回滚。
- [ ] 合并某数据域没有稳定业务重复键，却准备仅靠源主键或 `INSERT OR IGNORE` 上线。
- [ ] migration head/fingerprint 与当前数据库升级链不能统一。
- [ ] 需要让 `commands/*`、`app/*` 或前端直接写 SQL。
- [ ] WebDAV index 被当成恢复完整性事实而不重新验证 ZIP。
- [ ] 旧 reader 继续吸收新数据域，迁移窗口变成事实上的永久双写维护。
- [ ] 测试只能证明成功路径，无法注入文件切换或事务中途失败。

### 20.2 已知主要风险

| 风险 | 后果 | 默认控制 |
| --- | --- | --- |
| 快照不一致 | 恢复后外键或业务事实错位 | SQLite 官方快照机制 + 完整性测试 |
| ZIP 被篡改或损坏 | 恢复错误数据 | SHA-256 + size + SQLite checks |
| 覆盖中途崩溃 | 主数据库缺失或半切换 | 同目录回滚副本 + 原子重命名 + 启动自检 |
| 合并去重键错误 | 重复或误跳过用户记录 | 逐数据域契约 + 幂等/碰撞测试 |
| migration 分叉 | 旧库被错误升级 | head + fingerprint + 合法前缀判断 |
| 临时空间不足 | 半成品或恢复失败 | 前置预算检查 + 私有临时目录 + 清理 |
| 旧 reader 永久化 | 长期双格式维护 | 明确发布日期、90 天丢弃日期和独立删除阶段 |
| UI 术语混淆 | 用户误选策略 | “合并”替代“兼容” + 结果型说明 |

## 21. 完成定义

### 21.1 契约事项完成

当前“定义 SQLite 快照备份与兼容契约”事项只有在以下全部满足后才能建议 `Done`：

- [x] 本文获得维护者确认。
- [x] 格式结构、精确 format、SHA-256 与 schema 判断无未决项。
- [x] 覆盖状态机和文件回滚边界无未决项。
- [x] 合并结果语义、当前值获胜原则与数据域矩阵无未决项。
- [x] 旧 reader 90 天起止规则无未决项。
- [x] 本地与 WebDAV 共用契约无未决项。
- [x] 后续实现事项已直接执行，不再需要产品决策。

### 21.2 整体实现完成

- [x] 新备份只写 SQLite 快照。
- [x] 新快照覆盖和合并均通过仓库级自动化验证；真实安装包与 WebDAV 凭据 smoke 已明确归入发布门禁。
- [x] 旧 reader 在迁移窗口内可用且冻结。
- [x] Settings 使用“覆盖 / 合并”术语。
- [x] WebDAV 使用相同格式、预览、校验与恢复。
- [x] 文件覆盖和事务合并失败路径可逆并有自动化证据。
- [x] `npm run check:full` 完整验证通过。
- [x] 长期用户文档和发布规范一致；发布日期与 90 天截止日将在首次正式发布时据实写入 changelog。

### 21.3 Project 状态建议

本文确认但尚未实现时：

- [ ] 建议维护者把“定义 v2 SQLite 快照备份与兼容契约”从 `In progress` 拖到 `Done`。
- [ ] 重新读取 live Project 并计算 `Next` 窗口。
- [ ] 将解除依赖的“实现 v2 SQLite 一致快照生成与校验”纳入状态建议；实际拖动由维护者完成。
- [ ] 其他实现事项继续保持 `Blocked`，直到各自前置阶段完成。

整体实现完成时：

- [ ] 按每个 Project 事项的真实实现和验证结果分别建议 `Done`，不以本文勾选代替 live Project 状态。
- [ ] 每次完成、阻塞或解除阻塞后重新计算最多三个可执行 `Next`。

## 22. 最终决策摘要

- [x] 产品不向用户引入 v1/v2 备份术语。
- [x] 新格式内部使用精确标识 `PatinaSQLiteSnapshot-1`。
- [x] 新 writer 只生成 SQLite 一致快照。
- [x] 新快照支持覆盖和合并。
- [x] 覆盖结果只保留所选备份的受管数据。
- [x] 合并保留当前数据、导入缺失数据、冲突时当前数据获胜。
- [x] UI 将“兼容”改为“合并”。
- [x] 旧结构化 JSON ZIP reader 进入 90 天丢弃窗口。
- [x] 旧 reader 窗口内保留覆盖和合并，且不再扩展新数据域。
- [x] 90 天后的首个正式版本在满足退出条件后可以删除旧 reader。
- [x] SQLite schema 以真实 migration metadata 为准，不继续维护脱节的备份 schema 数字。
- [x] 覆盖使用文件级安全切换和回滚；合并使用单一 SQLite 事务和逐领域去重。

## 23. 实际执行闭环（2026-07-15）

### 23.1 已交付

- [x] writer 仅生成内部格式为 `PatinaSQLiteSnapshot-1` 的 SQLite 一致快照。
- [x] ZIP 文件集固定为 `manifest.json`、`checksums.json` 和 `database/patina.db`。
- [x] 使用 SHA-256、大小上限、精确路径、重复/额外条目拒绝、SQLite 完整性和外键检查。
- [x] migration head 与 fingerprint 必须属于当前应用已知 migration 前缀；未知或分叉历史不进入恢复。
- [x] 临时 ZIP 在发布前由正式 reader 自读校验，已有目标文件在发布失败时恢复。
- [x] 覆盖恢复先迁移并复检候选库，再关闭 pool、checkpoint WAL、清理 sidecar、保留回滚副本并换入。
- [x] 覆盖换入使用持久化恢复标记；进程中断后下次启动优先还原原数据库。
- [x] 合并保留当前事实、导入缺失事实、冲突时当前数据获胜，并在单一事务中提交。
- [x] timer/lap 与 session/title sample 等父子数据不依赖跨库自增 ID 相等，ID 碰撞会正确重映射。
- [x] software reminder rules 已纳入 SQLite 快照合并路径；旧备份从未写出该数据域，冻结 reader 明确返回空集合，不虚构不可恢复的数据。
- [x] 新 writer 不再调用旧结构化 JSON ZIP encoder；旧 reader 冻结保留。
- [x] 本地与 WebDAV 继续复用同一 export、preview、校验和 restore 入口。
- [x] WebDAV index 新增 format kind，并对旧 index 缺失字段按旧迁移备份读取。
- [x] UI 不显示 v1/v2 或 Schema 编号，“兼容”已改为“合并”。
- [x] 覆盖和合并选项明确展示数据结果；旧备份恢复成功后提醒立即创建新快照。
- [x] 90 天旧 reader 丢弃窗口已进入长期发布规范，且明确不是运行时日期开关。
- [x] 长期规则已分别回写架构、工程质量和发布规范，不保留独立备份契约文档。
- [x] 新增模块按 owner 拆分，未提高热点预算规避架构门禁。

### 23.2 自动化证据

- [x] SQLite 快照实际执行 `VACUUM INTO`、封装、正式 reader 回读、完整解压和数据查询测试通过。
- [x] 非 ZIP 识别、路径穿越、重复/模糊 ZIP 条目拒绝测试通过。
- [x] 覆盖事务失败回滚、标题父子映射和旧结构化备份回归测试通过。
- [x] timer ID 碰撞、lap 父子重映射和重复合并幂等测试通过。
- [x] 中断覆盖恢复标记还原原数据库测试通过。
- [x] `npm run check:full` 通过：类型、命名、架构、热点、全部前端专项、浏览器 UI smoke、生产构建和 bundle 门禁通过。
- [x] Rust 边界检查通过；368 项中 367 通过、1 项既有忽略、0 失败。
- [x] `cargo clippy -- -D warnings` 通过。

### 23.3 明确留到发布期的工作

- [x] 本次没有创建正式版本或 Git tag，因此没有虚构发布日期和 90 天截止日；首个正式发布时按实际日期计算并写入 changelog。
- [x] 真实 WebDAV 服务凭据 smoke、安装包内 Windows 文件切换 smoke 和活跃 tracking 长时间性能采样属于发布前人工验证，不由单元测试结果冒充。
- [x] 旧 reader 删除明确不在本次范围；只能在正式发布满 90 天且退出条件满足后作为独立清理事项执行。

### 23.4 归档与 Project 核对

- [x] live Project 在归档前再次读取，当前仍显示契约事项为 `In progress`、三个已实现备份事项为 `Blocked`。
- [x] 本地归档不代替维护者在 Board 中拖动状态。
- [x] 完成后的成组状态建议将在交付中报告，并按最多三个可执行 `Next` 重新计算。

### 23.5 完成后对抗式审查与处置

- [x] 审查覆盖恢复的每个文件切换失败点；双重换名失败时不创建空数据库，保留 marker、回滚库和 staging 供下次恢复或人工取证。
- [x] 恢复提交顺序改为先清 marker、再清回滚副本；候选 pool 验证或注册失败会显式关闭句柄后还原原库。
- [x] 全局 SQLite maintenance lock 阻止恢复与 pool 重开竞态；当前库与候选库都要求 WAL checkpoint 完整完成。
- [x] 合并使用稳定事实身份，排除结束时间、时长、状态等可变字段；双方都有 active session 或网页活动时保留当前 active 记录。
- [x] timer/lap、reminder、pomodoro、software reminder rule 的当前状态优先与跨库 ID 重映射均有专项测试。
- [x] 独立 `web_favicon_cache` 已进入快照 payload、manifest 计数和恢复；合并时当前 favicon 值优先。
- [x] 旧 ZIP reader 增加压缩包和单项解压上限；SQLite 快照数据库上限为 512 MiB，拒绝无界资源输入。
- [x] WebDAV 上传和下载改为流式传输，取消固定 60 秒总超时，并保留连接超时与 512 MiB 累计传输上限。
- [x] WebDAV 索引文件名只接受安全 basename，下载远端路径由可信配置重算；临时文件在失败、取消和成功恢复后清理。
- [x] WebDAV 同进程上传/下载串行，文件名包含毫秒与进程内计数；index 保存失败以“文件已上传但索引未更新”返回，不制造假失败。
- [x] 恢复策略 IPC 参数改为必填，内部安全默认值为“合并”；恢复提交后的桌面刷新失败不再谎报数据库已回滚。
- [x] 中文界面按结构化 message key 本地化兼容提示，未知 key 才回退后端文本；运行时严格验证 format kind。
- [x] 对抗式修复后重新运行完整门禁并通过，`git diff --check` 无空白错误。
