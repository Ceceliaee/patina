# 兼容代码简并执行方案

更新时间：2026-05-15

本文是一次性执行方案，放在 `docs/working/` 下。它不是长期规则；长期规则仍以顶层 `docs/` 文档为准。

当前目标已经调整：

- `0.6.5` 已生成公开 Release，按发布规范保留，不删除、不重发、不覆盖。
- 已确认不会有用户下载或升级到 `0.6.5`，所以它不再作为实际数据过渡门禁。
- 下一步把 `0.6.6` 做成合并过渡版：用户可以从 `0.6.4` 直接升级到 `0.6.6`，如果有机器已经跑过 `0.6.5`，也能继续升级到 `0.6.6`。
- `0.6.7` 再做真正完全简并版，删除旧分类、旧设置、旧备份格式和旧迁移形态。

本轮文档决策：当前本地已经启动的一部分完全简并代码，不应直接作为 `0.6.6` 发布；代码下一步要按 `0.6.6 合并过渡版` 恢复或保留必要兼容能力，等 `0.6.6` 验证后，再把删除兼容代码的工作推进到 `0.6.7`。

方案二的定义仅归属 `0.6.7` 完全简并版：

- 把当前 SQLite schema 压成新的单一基线迁移。
- 不保留 `MIGRATION_4_SQL`、`MIGRATION_5_SQL`、`MIGRATION_6_SQL` 这类 no-op 历史迁移。
- 不保留 `MIGRATION_7_SQL` 这种“从旧 schema 追加字段”的分段迁移形态；`continuity_group_start_time` 直接写进新基线表结构。
- 对已经跑过 `0.6.6` 的现有数据库，必须在 SQL plugin 运行迁移前处理 `_sqlx_migrations` 历史，使它与新基线一致。否则单纯压成新基线可能让已有数据库因为迁移历史不匹配而启动失败。
- 方案二支持 `0.6.4 -> 0.6.6 -> 0.6.7` 的无手动恢复备份升级路径，也兼容少数可能存在的 `0.6.4 -> 0.6.5 -> 0.6.6 -> 0.6.7` 路径；但不支持从 `0.6.4` 直接跳过过渡版进入 `0.6.7`。

## 当前状态

- [x] `0.6.5` 过渡版本代码已完成。
- [x] `0.6.5` 本地发布校验已通过：`npm run release:check -- 0.6.5`。
- [x] `main` 已推送到 GitHub。
- [x] `v0.6.5` tag 已推送到 GitHub。
- [x] `0.6.5` Release 已生成并公开。
- [x] 已确认不会有用户下载或升级到 `0.6.5`。
- [x] `0.6.6` 合并过渡版代码已完成。
- [x] 当前本地工作区中偏向完全简并的改动已按 `0.6.6` 目标收回到合并过渡范围。
- [x] `0.6.6` 本地发布校验已通过：`npm run release:check -- 0.6.6`。
- [x] `0.6.6` release commit 已推送。
- [x] `v0.6.6` tag 已推送。
- [x] 当前电脑已升级到 `0.6.6`，并确认数据正常。
- [x] 另一台已安装 Time Tracker 的电脑已升级到 `0.6.6`，并确认数据正常。
- [x] 开始 `0.6.7` 完全简并前，已在 `0.6.6` 内导出一份新的结构化 `.zip` 备份作为临时回滚点。
- [ ] `0.6.7` 完全简并版本尚未开始实施。

发布工作流：

- `Publish Release` run: https://github.com/Ceceliaee/time-tracking/actions/runs/25920387288

## 一句话结论

不要把当前本地简并改动直接作为 `0.6.6` 完全简并版发布。

安全路径是：

`0.6.4` → `0.6.6 合并过渡版` → `确认数据正常` → `导出临时回滚备份` → `0.6.7 完全简并版`

`0.6.5` 已经发布，保持不动；它可以作为历史版本存在，但不再承担实际升级门禁。只要每台仍保留旧数据的电脑都成功跑过 `0.6.6`，之后再升级到 `0.6.7` 完全简并版时，用户通常不需要手动恢复 Downloads 里的备份。新导出的 `.zip` 是删除兼容代码前的保险，不是正常升级步骤，也不需要永久保存。

## 已有备份

这些备份是回滚保险，不是正常升级步骤。

- [x] 结构化备份：`C:\Users\SYBao\Downloads\TimeTracker-backup-20260515-205401.zip`
- [x] `0.6.6` 结构化临时回滚备份：`C:\Users\SYBao\Downloads\TimeTracker-backup-20260515.zip`
- [x] 原始 SQLite 文件组：`C:\Users\SYBao\Downloads\TimeTracker-raw-db-20260515-205417\`
- [x] 原始 SQLite 文件组包含：
  - [x] `timetracker.db`
  - [x] `timetracker.db-wal`
  - [x] `timetracker.db-shm`

继续保留这些旧备份，直到：

- [x] 当前电脑已成功升级并运行 `0.6.6`。
- [x] 另一台电脑已成功升级并运行 `0.6.6`。
- [x] `0.6.7` 完全简并前已导出新的 `.zip` 临时回滚备份。
- [ ] `0.6.7` 完全简并版本发布并正常运行一段时间。

## 兼容代码清单

| 兼容类别 | `0.6.6` 合并过渡版要求 | `0.6.7` 完全简并版处理 |
| --- | --- | --- |
| Classification 转发壳 | 可以继续保持已删除，只要调用方直接使用当前 owner | 无需继续处理 |
| 旧分类值读取 | 必须保留读取并写回当前 JSON，支持 `0.6.4 -> 0.6.6` | 删除旧解析 |
| 旧设置值读取 | 必须保留读取并写回当前 key，支持 `color_scheme` 与 `tray` 旧值 | 删除旧 fallback |
| 旧备份格式读取 | 必须保留旧 `.json`、`.ttbackup`、旧 zip 内 `backup.json` 导入；新导出只用当前 `.zip` | 删除旧导入 |
| 备份 preview 兼容字段 | 可以保留旧字段名，避免把过渡版和命名收窄混在一起 | 可改名为恢复安全状态字段 |
| SQLite migration repair / normalization | 必须保证 `0.6.4` 和可能已跑过 `0.6.5` 的数据库都能启动；清理可以做，但不能破坏过渡职责 | 方案二：压成新基线并重置已升级数据库的迁移历史，风险最高 |

不应删除的内容：

- `src/shared/classification/processNormalization.ts` 中 installer、updater、tray alias 归一化。这是追踪正确性，不是旧用户兼容。
- `src/shared/lib/sessionReadCompiler.ts` 中 alias 聚合。这是统计一致性，不是旧 API 兼容。
- Tauri / Rust / SQLite 边界的 snake_case raw DTO 映射。这是协议边界，不是遗留壳。
- 备份 “version/schema 过新不可恢复” 的拒绝逻辑。这是数据安全门槛。

## 阶段 A：`0.6.5` 过渡版本

状态：已完成并已生成公开 Release。按发布规范，`0.6.5` 现在只作为历史已发布版本保留，不删除、不重发、不覆盖；后续不再要求两台电脑必须安装它。

如果任何机器已经安装或运行过 `0.6.5`，后续仍必须能继续升级到 `0.6.6`。

完成内容：

- [x] 删除 6 个 classification 历史转发壳。
- [x] 调用方直接使用 `src/shared/classification/*`。
- [x] 旧分类 override 可读取，并在加载时写回当前 JSON / 当前 category。
- [x] 旧设置 `color_scheme` 可读取，并写回 `color_scheme_light` / `color_scheme_dark`。
- [x] 旧设置 `minimize_behavior = tray` 可读取，并写回当前语义。
- [x] 旧 `.json`、`.ttbackup`、旧 zip 内 `backup.json` 仍可导入。
- [x] 新导出的备份只使用当前结构化 `.zip`。
- [x] 保留 `repair_legacy_migration_history` 与 no-op migration。
- [x] `CHANGELOG.md` 已固化 `0.6.5` 发布说明。

已通过验证：

- [x] `npm run test:classification`
- [x] `npm run test:settings`
- [x] `npm run test:replay`
- [x] `npm run check:architecture`
- [x] `npm run check:naming`
- [x] `npm run check:rust`
- [x] `npm run check:full`
- [x] `npm run release:check -- 0.6.5`

## 阶段 B：`0.6.6` 合并过渡版

目标：把用户实际升级入口后移到 `0.6.6`，但不丢掉 `0.6.5` 原本承担的过渡职责。

`0.6.6` 必须满足：

- [x] 支持 `0.6.4` 或当前安装版直接升级到 `0.6.6`。
- [x] 支持少数可能已经安装 `0.6.5` 的机器继续升级到 `0.6.6`。
- [x] 保留旧分类 override 读取，并在加载时写回当前 JSON / 当前 category。
- [x] 保留旧设置 `color_scheme` 读取，并写回 `color_scheme_light` / `color_scheme_dark`。
- [x] 保留旧设置 `minimize_behavior = tray` 读取，并写回当前语义。
- [x] 保留旧 `.json`、`.ttbackup`、旧 zip 内 `backup.json` 导入。
- [x] 新导出的备份仍只使用当前结构化 `.zip`。
- [x] 保留备份 version/schema 过新时不可恢复的拒绝逻辑。
- [x] SQLite 迁移处理必须能打开 `0.6.4` 数据库和可能已经跑过 `0.6.5` 的数据库。
- [x] 未在 `0.6.6` 中引入新的 `_sqlx_migrations` 历史清理；继续保留 `0.6.5` 已验证的 repair 与 no-op migration 保护。

当前本地工作区回收要求：

- [x] 已删除的旧分类值兼容属于 `0.6.7` 工作，不应直接进入 `0.6.6`。
- [x] 已删除的旧设置值兼容属于 `0.6.7` 工作，不应直接进入 `0.6.6`。
- [x] 已删除的旧备份格式导入属于 `0.6.7` 工作，不应直接进入 `0.6.6`。
- [x] 已删除的 legacy migration repair / no-op migration 不能直接按“干净版”发布；当前已恢复 `0.6.5` 的过渡保护。

`0.6.6` 发布前验证：

- [x] `npm run test:classification`
- [x] `npm run test:settings`
- [x] `npm run test:replay`
- [x] `npm run check:architecture`
- [x] `npm run check:naming`
- [x] `npm run check:rust`
- [x] `npm run check:full`
- [x] `npm run release:check -- 0.6.6`

## 阶段 C：`0.6.6` 发布后升级验证

目标：确认 `0.6.6` 已经完成“旧数据 → 当前格式”的过渡职责。

先等待：

- [ ] GitHub Actions `Publish Release` 结束且状态为成功。
- [ ] GitHub Release 页面出现 `v0.6.6`。
- [ ] Release 附件包含 Windows 安装包。
- [ ] Release 附件包含 updater 使用的 `latest.json`。

当前电脑验证：

- [x] 从 `0.6.4`、`0.6.5` 或当前安装版升级到 `0.6.6`。
- [x] 启动应用，确认没有数据库启动错误。
- [x] 检查 Today / History / Data / App Mapping / Settings 能正常打开。
- [x] 检查历史数据、应用分类、设置项没有明显丢失。
- [x] 可选：在 Settings 内导出一份新的结构化 `.zip` 备份，作为之后完全简并前的临时回滚点。
- [x] 如果导出了新备份，记录新备份路径：`C:\Users\SYBao\Downloads\TimeTracker-backup-20260515.zip`。

另一台电脑验证：

- [x] 通过 updater 或安装包升级到 `0.6.6`。
- [x] 启动应用，确认没有数据库启动错误。
- [x] 检查历史数据、应用分类、设置项没有明显丢失。
- [ ] 可选：在 Settings 内导出一份新的结构化 `.zip` 备份，作为之后完全简并前的临时回滚点。
- [ ] 如果导出了新备份，记录新备份路径。

阶段 C 通过标准：

- [x] 两台电脑都成功启动过 `0.6.6`。
- [x] 两台电脑都确认主要数据正常。
- [x] 完全简并前至少导出过一份新的 `.zip` 临时回滚备份。
- [ ] 没有仍需从旧 `.json`、`.ttbackup`、旧 zip 内 `backup.json` 恢复的数据。

## 阶段 D：`0.6.7` 完全简并版本门禁

只有全部勾选后，才能开始删除兼容代码。

- [ ] `0.6.6` Release 已正式发布成功。
- [x] 当前电脑已运行过 `0.6.6`。
- [x] 另一台已安装电脑已运行过 `0.6.6`。
- [x] 所有需要保留的数据都已在 `0.6.6` 中正常显示。
- [x] 开始完全简并前，已导出至少一份 `0.6.6` 结构化 `.zip` 临时回滚备份。
- [ ] 明确接受完全简并版本不再读取旧设置、旧分类、旧备份格式。
- [ ] 开始前再次确认 git 工作区干净，或明确哪些改动属于本次任务。

方案二门禁：

- [ ] 不允许只删除 4/5/6 然后保留 `MIGRATION_7_SQL`。这属于方案一，不是当前文档采用的方案二。
- [ ] 不允许只把迁移压成 `MIGRATION_1_SQL` 而不处理已有数据库的 `_sqlx_migrations` 记录。
- [ ] 完全简并版本必须能打开已经成功运行过 `0.6.6` 的数据库。
- [ ] 完全简并版本可以明确不支持 `0.6.4` 数据库直接跳过 `0.6.6` 启动。

建议版本号：

- 默认先按 `0.6.7` 准备。
- 如果完全简并包含明显用户可感知变化或发布策略变化，再按 `docs/versioning-and-release-policy.md` 判断是否升到 `0.7.0`。

## 阶段 E：`0.6.7` 完全简并实施批次

按下面顺序执行。不要把 SQLite migration repair 提前到前面几批。

### E1. 删除旧分类值兼容

目标：分类 override 只接受当前 JSON 存储格式与当前 category 集。

- [ ] 在 `src/shared/classification/processMapper.ts` 删除旧 category 映射：
  - [ ] `meeting -> office`
  - [ ] `finance -> utility`
  - [ ] `reading -> browser`
  - [ ] 旧 `"custom"` 字符串兜底
- [ ] 保留当前 `custom:<name>` 格式支持。
- [ ] 删除 `fromOverrideStorageValue` 的纯字符串 category fallback。
- [ ] 更新 `tests/classificationDraftState.test.ts`。
- [ ] 跑 `npm run test:classification`。
- [ ] 跑 `npm run test:replay`。

### E2. 删除旧设置值兼容

目标：设置解析只支持当前字段与当前枚举。

开始前检查数据库中是否还有旧值：

- [ ] `color_scheme`
- [ ] `minimize_behavior = tray`
- [ ] 其他已退出枚举值

执行项：

- [ ] 在 `src/platform/persistence/appSettingsStore.ts` 删除 `RawAppSettingsKey` 中的旧 `color_scheme`。
- [ ] `colorSchemeLight` 只读取 `color_scheme_light`。
- [ ] `colorSchemeDark` 只读取 `color_scheme_dark`。
- [ ] `normalizeMinimizeBehavior` 只接受 `"widget"` / `"taskbar"`。
- [ ] 在 `src-tauri/src/domain/settings.rs` 同步收窄 `parse_minimize_behavior`。
- [ ] 更新 `tests/settingsPageState.test.ts`。
- [ ] 更新 Rust settings 相关测试。
- [ ] 跑 `npm run test:settings`。
- [ ] 跑 `npm run check:rust`。

### E3. 删除旧备份格式导入

目标：只支持当前结构化 `.zip` 备份格式。

前置条件：

- [ ] 已确认不再需要恢复旧 `.json`。
- [ ] 已确认不再需要恢复旧 `.ttbackup`。
- [ ] 已确认不再需要恢复旧 zip 内 `backup.json`。
- [ ] 至少一份新结构化 `.zip` 已成功 preview。

执行项：

- [ ] 在 `src-tauri/src/data/backup.rs` 删除 `BACKUP_JSON_ENTRY_NAME`。
- [ ] 在 `pick_backup_file` 删除 `"Legacy backup files"` 过滤器。
- [ ] 在 `read_backup_payload` 删除非 zip JSON 解析分支。
- [ ] 在 `read_backup_payload` 删除 zip 内 `backup.json` fallback。
- [ ] 在 `src-tauri/src/domain/backup.rs` 删除 `BackupCompatibilityLevel::Legacy`。
- [ ] 将 `version < CURRENT_BACKUP_VERSION` 处理为不支持。
- [ ] 保留 `version > CURRENT_BACKUP_VERSION` 与 `schema_version > CURRENT_BACKUP_SCHEMA_VERSION` 的拒绝逻辑。
- [ ] 更新 Rust 备份测试。
- [ ] 更新 `tests/settingsPageState.test.ts` 中 backup preview mock。
- [ ] 跑 `npm run test:settings`。
- [ ] 跑 `npm run check:rust`。

### E4. 收窄备份 preview 边界字段

目标：把“兼容性”命名改成“恢复安全状态”命名。

这批可以和 E3 合并，也可以单独提交。

- [ ] 将 Rust `BackupPreview.compatibility_level` 改为 `restore_status` 或 `restore_supported`。
- [ ] 将 `compatibility_message` 改为 `restore_message`。
- [ ] 评估是否删除 `compatibility_message_key` 与 `compatibility_message_args`。
- [ ] 更新 `src/platform/backup/backupRuntimeGateway.ts`。
- [ ] 更新 `src/features/settings/services/settingsRuntimeAdapterService.ts`。
- [ ] 更新 `src/shared/copy/uiText.ts`。
- [ ] 更新 `scripts/check-naming-boundaries.ts`。
- [ ] 跑 `npm run check:naming`。
- [ ] 跑 `npm run test:settings`。

### E5. 压成新的 SQLite schema 基线

目标：采用方案二，不再维护已发布旧迁移历史，也不留下 `1、2、3、7` 这种带空洞的迁移形态。

这是最高风险批次。只有在确认所有数据都跑过 `0.6.6` 后才能执行。

执行前：

- [ ] 关闭所有 Time Tracker 进程。
- [ ] 再复制一次 `timetracker.db`、`timetracker.db-wal`、`timetracker.db-shm` 到 Downloads。
- [ ] 确认新结构化 `.zip` 可以 preview。
- [ ] 确认接受旧 `0.6.4` 数据库不再直接跳过 `0.6.6` 进入 `0.6.7` 打开。

执行项：

- [ ] 把 `src-tauri/src/data/migrations.rs` 改成新的单一当前基线迁移。
- [ ] 新基线必须一次性创建当前完整 schema：
  - [ ] `sessions` 包含 `continuity_group_start_time`
  - [ ] `settings` 保持当前 key/value 表
  - [ ] `icon_cache` 保持当前字段
  - [ ] 保留 `idx_sessions_date`
  - [ ] 保留 `idx_sessions_single_active`
- [ ] 删除分段迁移常量：
  - [ ] `MIGRATION_2_SQL`
  - [ ] `MIGRATION_3_SQL`
  - [ ] `MIGRATION_4_SQL`
  - [ ] `MIGRATION_5_SQL`
  - [ ] `MIGRATION_6_SQL`
  - [ ] `MIGRATION_7_SQL`
- [ ] `tracker_migrations()` 只返回新的当前基线迁移。
- [ ] 增加或替换启动前的迁移历史处理逻辑：在 SQL plugin 运行迁移前，检测已运行过 `0.6.6` 的当前 schema，并把 `_sqlx_migrations` 重置为新基线对应的 metadata。
- [ ] 迁移历史重置前必须验证真实表结构已经是当前 schema，不能对未知旧库盲目改 `_sqlx_migrations`。
- [ ] 删除旧的 `repair_legacy_migration_history` 语义和命名，避免继续表达“修旧迁移历史”。
- [ ] 更新 `src-tauri/src/lib.rs` 启动前调用，改为新的 current-baseline history normalization。
- [ ] 更新所有 Rust 测试 setup，直接执行新的当前基线迁移。
- [ ] 新增 Rust 测试：
  - [ ] 空库执行新基线后表结构完整。
  - [ ] 已有当前 schema 可被迁移历史重置逻辑识别。
  - [ ] 缺少 `continuity_group_start_time` 的旧 schema 不会被错误重置为新基线。
- [ ] 跑 `npm run check:rust`。

## 完全简并验证门槛

每批之后至少跑该批列出的局部测试。全部完成后跑完整门槛：

- [ ] `npm run check:architecture`
- [ ] `npm run check:naming`
- [ ] `npm test`
- [ ] `npm run test:replay`
- [ ] `npm run test:settings`
- [ ] `npm run test:classification`
- [ ] `npm run check:rust`
- [ ] `npm run check:full`

发布前门槛：

- [ ] 更新 `CHANGELOG.md`。
- [ ] 同步目标版本号。
- [ ] 跑 `npm run release:check -- <version>`。
- [ ] 提交 `release: v<version>`。
- [ ] 推送 `main`。
- [ ] 推送 `v<version>` tag。
- [ ] 确认 GitHub Actions `Publish Release` 已触发。

## 暂停条件

出现任一情况就暂停，不继续删除兼容代码：

- [ ] `0.6.6` GitHub Actions 发布失败。
- [ ] 任意一台电脑升级到 `0.6.6` 后数据库打不开。
- [ ] 升级后历史数据、设置、应用映射有明显丢失。
- [ ] 无法导出新的结构化 `.zip` 备份。
- [ ] 仍需要从旧 `.json`、`.ttbackup` 或旧 zip 内 `backup.json` 恢复数据。
- [ ] 当前工作区出现无法归属的未提交改动。

## 文档收尾

- [ ] `0.6.7` 完全简并版本发布后，把本文移到 `docs/archive/`。
- [ ] 如果完全简并后产生长期规则变化，更新对应的顶层 `docs/` 文档，而不是继续修改本文。
