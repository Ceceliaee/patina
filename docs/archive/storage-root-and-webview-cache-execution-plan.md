# 自定义数据目录与 WebView 缓存治理执行方案

Status: completed and archived

Completed: 2026-06-22

Issue: Refs #20

Document type: How-to / execution plan

Audience: 后续负责实现 Patina 存储架构改造的维护者

Goal: 在不损害现有数据可信链路的前提下，支持自定义主数据目录，并治理 WebView2 可再生成缓存占用。

---

## 1. 背景与问题定义

当前用户反馈的表面问题是：

- 用户希望数据不要只能放在 C 盘。
- `EBWebView` 目录可能增长到数百 MB，占用 C 盘空间。
- 现有“选择备份位置”容易被误解为“选择主数据位置”，但两者不是一回事。

当前仓库现实：

- 安装目录由 NSIS 安装器决定。默认 `currentUser` 安装时常见位置是 `%LOCALAPPDATA%\Patina`，但用户安装时可以选择其他目录。
- 主 SQLite 数据库当前固定在 `product_roaming_data_dir(app)/patina.db`，也就是默认 `%APPDATA%\Patina\patina.db`。
- 本地备份默认目录当前在 `product_roaming_data_dir(app)/backups`。
- WebDAV 下载/上传临时目录当前在 `product_roaming_data_dir(app)/remote-backup-temp`；它只是远程备份流程的工作目录，不进入备份包，也不是需要保留的长期数据。
- WebView2 数据根当前由 `.data_directory(app_paths::product_webview_data_dir(app)?)` 指定，实际缓存目录表现为 `EBWebView`，默认在 `%LOCALAPPDATA%\Patina\EBWebView`。
- 当前默认安装目录与默认 WebView root 都可能落在 `%LOCALAPPDATA%\Patina`，所以它们在默认安装下看起来重合；但如果用户把安装目录改到其他盘，WebView root 仍按代码走 `%LOCALAPPDATA%\Patina`，不会自然跟随安装目录。

这次计划要处理的是“本地存储控制力”，不是安装器布局本身。

---

## 2. 产品范围

### 2.1 目标

- [x] 在 Settings / 存储中清晰显示当前主数据目录和 WebView 缓存目录。
- [x] 支持用户选择一个本机目录作为新的 Patina 主数据目录。
- [x] 自定义主数据目录时，同时决定未来 WebView cache 根目录。
- [x] 提供 WebView 可再生成缓存大小统计。
- [x] 提供“下次启动前清理 WebView 缓存”的安全入口。
- [x] 提供 WebView 缓存自动上限和启动前修剪，避免旧缓存长期膨胀。
- [x] 迁移主数据目录时保护 `patina.db`、默认本地备份目录和必要元数据。
- [x] 任何迁移失败都不能让用户看到一个空的新数据库并误以为数据丢失。
- [x] 自定义目录丢失、不可写或不可读时，进入明确的恢复模式，不静默回退到默认空数据库。

### 2.2 非目标

- [x] 不改变安装器的安装目录语义。
- [x] 不把安装目录、updater 文件或卸载器迁到数据目录。
- [x] 不做完整便携模式。
- [x] 不做云同步、冲突合并或多设备数据库共享。
- [x] 不在本轮引入数据库加密。
- [x] 不承诺清空 C 盘上的所有痕迹；默认仍保留很小的锚点配置目录。
- [x] 不在第一版自动删除旧数据目录；成功迁移后只提示用户可手动确认清理。
- [x] 不默认迁移旧 `EBWebView` 缓存内容；旧缓存是可再生成数据，默认清理或遗留给用户确认处理。

---

## 3. 术语

| 术语 | 含义 | 当前默认位置 | 自定义后位置 |
| --- | --- | --- | --- |
| 安装目录 | 程序本体、卸载器、资源文件 | 安装器决定，默认常见为 `%LOCALAPPDATA%\Patina` | 安装器决定，不由本功能改变 |
| 锚点配置目录 | 启动前读取的小配置所在位置，用来寻找真实数据目录 | `%APPDATA%\Patina` | 仍保留在 `%APPDATA%\Patina` |
| 主数据目录 | 用户长期数据事实源所在根目录 | `%APPDATA%\Patina` | 用户选择的目录 |
| SQLite 数据库 | `patina.db` 及可能存在的 WAL/SHM 文件 | `%APPDATA%\Patina\patina.db` | `<主数据目录>\patina.db` |
| 默认本地备份目录 | 没有指定导出路径时的备份目录 | `%APPDATA%\Patina\backups` | `<主数据目录>\backups` |
| WebDAV 临时目录 | 远程备份下载、上传过程的可再生成工作目录，不进入备份包 | `%APPDATA%\Patina\remote-backup-temp` | `<主数据目录>\remote-backup-temp` |
| WebView root | 传给 Tauri `.data_directory(...)` 的目录 | `%LOCALAPPDATA%\Patina` | `<主数据目录>\webview` |
| WebView 可再生成缓存 | `EBWebView` 下的 `Cache`、`Code Cache`、`GPUCache` 等目录 | `%LOCALAPPDATA%\Patina\EBWebView\...` | `<主数据目录>\webview\EBWebView\...` |

---

## 4. 推荐目标架构

### 4.1 默认用户不变

没有锚点配置时，保持现有行为：

- [x] 主数据目录继续是 `app_paths::product_roaming_data_dir(app)`。
- [x] WebView root 继续是 `app_paths::product_local_data_dir(app)`。
- [x] `patina.db` 连接名继续保持 `sqlite:patina.db`，不改前端 DB URL 和 capability 中的 DB 名称。
- [x] 现有安装、更新、备份、恢复流程不因没有锚点配置而变化。

### 4.2 自定义用户使用锚点配置

新增一个极小的锚点配置文件，放在默认 roaming product dir：

```text
%APPDATA%\Patina\storage-anchor.json
```

推荐 schema：

以下 JSON 中的 `%APPDATA%` 和 `<dataRoot>` 仅表示目录位置。实际配置由程序写入解析后的绝对路径，不支持直接填写这些占位符。

```json
{
  "format": "patina.storage-anchor.v1",
  "profile": "production",
  "dataRoot": "<dataRoot>",
  "webviewRoot": "<dataRoot>\\webview",
  "updatedAtMs": 1780000000000
}
```

要求：

- [x] `format` 必须等于当前唯一支持值 `patina.storage-anchor.v1`。
- [x] 不做多版本锚点兼容；格式不匹配时进入恢复/错误处理，不尝试自动迁移旧锚点 schema。
- [x] `profile` 必须匹配当前 app profile，避免 Production / Local / Dev 串用路径。
- [x] `dataRoot` 必须是用户选择的主数据目录。
- [x] `webviewRoot` 第一版由 `dataRoot` 派生，不提供单独选择入口。
- [x] `webviewRoot` 推荐固定为 `<dataRoot>\webview`。
- [x] 锚点不保存密码、token、备份内容或任何时间记录。
- [x] 锚点不可放进 SQLite `settings` 表，因为启动时需要先知道数据库路径，才能打开 SQLite。

### 4.3 维护状态与待执行动作分开

不要把“已生效路径”和“待迁移任务”写在同一个 JSON 里。建议同目录新增：

```text
%APPDATA%\Patina\storage-migration-pending.json
%APPDATA%\Patina\storage-maintenance-state.json
```

`storage-migration-pending.json` 示例：

```json
{
  "format": "patina.storage-migration-pending.v1",
  "id": "20260622-150000",
  "sourceDataRoot": "%APPDATA%\\Patina",
  "targetDataRoot": "<dataRoot>",
  "targetWebviewRoot": "<dataRoot>\\webview",
  "createdAtMs": 1780000000000,
  "state": "pending-restart"
}
```

`storage-maintenance-state.json` 示例：

```json
{
  "format": "patina.storage-maintenance-state.v1",
  "lastWebviewCacheTrimAtMs": 1780000000000,
  "pendingWebviewCacheClear": false,
  "lastMaintenanceError": null
}
```

---

## 5. Owner 与落点

### 5.1 Rust owner

- [x] `src-tauri/src/platform/app_paths.rs`
  - 继续作为路径解析入口。
  - 增加默认 anchor dir、默认 data root、默认 webview root 的纯解析函数。
  - 不承担复制、迁移、删除缓存等厚逻辑。

- [x] 新增 `src-tauri/src/platform/storage_anchor.rs`
  - 负责 anchor、pending migration、maintenance state 的 JSON 读写。
  - 负责 profile 匹配、当前 format 判断、路径字符串解析。
  - 不维护多版本兼容分支；format 不匹配按损坏或不支持处理。
  - 负责安全写入：先写临时文件，再原子替换或尽量使用 Windows 安全替换策略。
  - 不直接打开 SQLite。

- [x] 新增 `src-tauri/src/platform/storage_paths.rs`
  - 根据默认路径和 anchor 生成 `StoragePaths`。
  - 输出 `data_root`、`db_path`、`backup_dir`、`remote_backup_temp_dir`、`webview_root`。
  - 处理 anchor 缺失、anchor 不匹配、anchor 损坏等情况。

- [x] 新增 `src-tauri/src/platform/webview_cache.rs`
  - 负责 WebView cache 大小统计。
  - 负责可再生成目录 allowlist。
  - 负责启动前修剪和“下次启动清理”。
  - 必须防止删除 webview root 外部路径。
  - 必须跳过 symlink、junction、reparse point，避免路径穿越。

- [x] `src-tauri/src/data/sqlite_pool.rs`
  - 把 `resolve_product_db_path` 改为消费 `StoragePaths.db_path`。
  - `initialize_app_sqlite` 和 `reopen_sqlite_pool` 都必须使用同一个路径解析结果。
  - 保持 `SQLITE_DB_NAME = "sqlite:patina.db"` 不变。
  - 保持 migration repair、baseline normalization、schema validation 仍在 data owner。

- [x] 新增 `src-tauri/src/data/storage_migration.rs`
  - 负责主数据目录迁移。
  - 负责 SQLite 文件复制、schema 校验、关键表 count 对比。
  - 负责迁移失败时保留旧目录和旧 anchor。
  - 不负责 UI 文案。

- [x] 新增 `src-tauri/src/domain/storage.rs`
  - 定义 `StorageSnapshot`、`StorageDirectoryKind`、`StorageMigrationPreview`、`WebviewCacheSnapshot` 等稳定 DTO。
  - 只放稳定语义，不放文件系统实现。

- [x] 新增 `src-tauri/src/commands/storage.rs`
  - 暴露薄命令：
    - `cmd_get_storage_snapshot`
    - `cmd_pick_storage_directory`
    - `cmd_preview_storage_migration`
    - `cmd_schedule_storage_migration`
    - `cmd_cancel_pending_storage_migration`
    - `cmd_schedule_webview_cache_clear`
    - `cmd_get_webview_cache_snapshot`
    - `cmd_open_storage_directory`
  - 每个命令只做参数接收、DTO 转发、错误字符串映射。

- [x] `src-tauri/src/app/bootstrap.rs`
  - 在 `initialize_app_sqlite(app.handle())` 之前执行 pending storage migration。
  - 在 pending migration 失败时不继续初始化空目标数据库。
  - 启动后把迁移失败状态暴露给 Settings 或使用事件通知。

- [x] `src-tauri/src/app/main_window.rs` 和 `src-tauri/src/app/widget.rs`
  - 创建 WebView 前解析当前 `webview_root`。
  - 创建 WebView 前执行安全的 cache trim 检查。
  - `.data_directory(...)` 使用统一的 storage path resolver。

### 5.2 Frontend owner

- [x] 新增 `src/platform/storage/storageRuntimeGateway.ts`
  - 封装 storage 相关 invoke。
  - 解析 raw DTO 到前端模型。

- [x] 新增或扩展 `src/features/settings/services/settingsStorageService.ts`
  - Settings 页私有流程编排。
  - 负责确认弹窗文案、pending 状态和按钮状态。
  - 不直接访问 SQLite。

- [x] 扩展 `src/features/settings/components/SettingsDataSafetyPanel.tsx`
  - 增加数据目录和缓存目录展示。
  - 增加缓存大小、清理状态和目录迁移动作。
  - 保持 Quiet Pro：低噪音、信息优先、不要做强视觉警告，除非真的处于失败或危险状态。

- [x] 扩展 `src/shared/copy/uiText.ts`
  - 中英文文案都要补齐。
  - 文案必须区分“备份位置”“数据目录”“缓存目录”。

---

## 6. 路径解析规则

### 6.1 默认路径

- [x] `default_anchor_dir = product_roaming_data_dir(app)`。
- [x] `default_data_root = product_roaming_data_dir(app)`。
- [x] `default_webview_root = product_local_data_dir(app)`。
- [x] 默认 backup dir = `<default_data_root>\backups`。
- [x] 默认 remote temp dir = `<default_data_root>\remote-backup-temp`。
- [x] remote temp dir 只服务 WebDAV 上传/下载过程，不参与 structured backup，不作为迁移时必须复制的数据。

### 6.2 自定义路径

- [x] 如果 anchor 存在且有效：
  - [x] `data_root = anchor.dataRoot`
  - [x] `webview_root = anchor.webviewRoot`
  - [x] `db_path = data_root\patina.db`
  - [x] `backup_dir = data_root\backups`
  - [x] `remote_temp_dir = data_root\remote-backup-temp`
  - [x] `remote_temp_dir` 只在需要远程备份临时文件时创建，可随时清理和重建。

- [x] 如果 anchor 不存在：
  - [x] 使用默认路径。

- [x] 如果 anchor 存在但损坏：
  - [x] 不静默创建新数据库。
  - [x] 记录错误。
  - [x] 如果默认数据目录中存在 `patina.db` 且 anchor 没有成功读取过自定义 root，可退回默认并提示。
  - [x] 如果无法判断真实数据目录，进入 storage recovery mode。

- [x] 如果 anchor 指向的自定义目录不存在或不可读：
  - [x] 不自动回退默认目录。
  - [x] 不自动创建空 `patina.db`。
  - [x] 显示恢复选项：重试、选择新的数据目录、恢复默认目录。

### 6.3 目标目录限制

第一版推荐限制为：

- [x] 必须是本机绝对路径。
- [x] 拒绝 UNC/network path，例如 `\\server\share`。
- [x] 拒绝空路径。
- [x] 拒绝系统目录、Windows 目录、Program Files 目录。
- [x] 拒绝当前安装目录本身，避免卸载时误伤数据。
- [x] 拒绝选择 `EBWebView` 内部或当前 webview root 内部。
- [x] 拒绝路径是当前 data root 的子目录或父目录，避免递归复制。
- [x] 允许目标目录不存在，由应用创建。
- [x] 如果目标目录已存在且非空，第一版只允许其中没有 `patina.db`、`EBWebView`、`.patina-*` 以外的冲突文件；否则要求用户选择空目录或新目录。
- [x] 写入前创建并删除 probe file，验证可写。

---

## 7. 主数据目录迁移流程

### 7.1 UI 预览阶段

- [x] 用户在 Settings / 存储点击“更改数据目录”。
- [x] Rust 打开目录选择器，返回候选目录。
- [x] 前端调用 `cmd_preview_storage_migration(candidatePath)`。
- [x] Rust 校验目标目录。
- [x] Rust 生成 preview：
  - [x] 当前数据目录。
  - [x] 目标数据目录。
  - [x] 当前数据库大小。
  - [x] 当前本地备份目录大小。
  - [x] 当前 WebView 可再生成缓存大小。
  - [x] 成功后新的 WebView cache root。
  - [x] 是否需要重启。
  - [x] 将保留旧目录不自动删除的说明。
- [x] 前端显示确认弹窗。
- [x] 文案明确：
  - [x] 这是主数据目录，不是备份导出位置。
  - [x] 迁移需要重启。
  - [x] 迁移前会创建备份。
  - [x] 失败会继续使用旧数据目录。
  - [x] 旧 WebView 缓存不会迁移，新的缓存会重新生成。

### 7.2 调度阶段

- [x] 用户确认迁移。
- [x] Rust 在当前数据库中执行轻量一致性准备：
  - [x] 暂停或封口当前 active session 的策略要明确；推荐先只要求重启迁移，不在运行中迁移 active writes。
  - [x] 尝试执行 SQLite checkpoint，例如 `PRAGMA wal_checkpoint(TRUNCATE)`。
  - [x] 不因 checkpoint 失败直接破坏现有数据；失败时阻止迁移并提示。
- [x] Rust 调用现有 structured backup 逻辑导出迁移前备份：
  - [x] 默认保存到当前 data root 的 `backups`。
  - [x] 文件名建议包含 `pre-storage-migration`。
  - [x] 备份失败则不写 pending migration。
- [x] Rust 写入 `storage-migration-pending.json`。
- [x] Rust 写入 maintenance state：
  - [x] `pendingWebviewCacheClear = true`，因为旧 cache 不迁移，启动新 root 前可清理旧 root allowlist。
- [x] 前端提示用户重启应用。
- [x] 第一版可以要求用户手动重启；如果实现自动重启，必须先确认 Tauri updater/restart 行为不会和迁移冲突。

### 7.3 启动前执行阶段

启动顺序必须是：

1. 解析默认 anchor dir。
2. 读取 `storage-migration-pending.json`。
3. 如有 pending migration，先执行迁移。
4. 迁移成功后写入新的 active anchor。
5. 删除 pending migration。
6. 解析最终 storage paths。
7. 初始化 SQLite。
8. 初始化 runtime。
9. 创建主窗口或 widget。

具体迁移步骤：

- [x] 创建 migration lock，避免两个 Patina 实例同时迁移。
- [x] 校验 pending plan 的 source root 仍然等于当前 active root。
- [x] 校验目标目录仍可写。
- [x] 创建目标目录。
- [x] 创建 staging 目录，例如 `<targetDataRoot>\.patina-migration-staging-<id>`。
- [x] 复制 SQLite 相关文件：
  - [x] `patina.db`
  - [x] `patina.db-wal`，如果存在
  - [x] `patina.db-shm`，如果存在
- [x] 复制默认本地备份目录：
  - [x] `backups\`
- [x] 不复制 `remote-backup-temp`；启动后重新创建。
- [x] 不复制旧 `EBWebView`；新 WebView root 重新生成。
- [x] 打开 staging 中的 target DB。
- [x] 运行现有 schema repair、baseline normalization、current migrations。
- [x] 验证 schema 完整。
- [x] 对比 source 和 target 的关键表 count：
  - [x] `sessions`
  - [x] `session_title_samples`
  - [x] `settings`
  - [x] `icon_cache`
  - [x] `tool_reminders`
  - [x] `tool_timers`
  - [x] `tool_timer_laps`
  - [x] `tool_pomodoro_runs`
  - [x] `tool_daily_stats`
  - [x] `tool_software_reminder_rules`
  - [x] `web_activity_segments`
- [x] 验证 target DB 至少可以执行一次 settings read。
- [x] 将 staging 内容提升为目标根内容。
- [x] 写入 active `storage-anchor.json`。
- [x] 删除 pending migration 文件。
- [x] 写入 migration success marker，供 UI 首次启动后展示。
- [x] 保留 source data root，不自动删除。

### 7.4 失败回滚

任何一步失败时：

- [x] 不写入新的 active anchor。
- [x] 不删除旧 data root。
- [x] 不初始化 target 空数据库。
- [x] 尽量删除 staging 目录；删除失败只记录，不阻塞回退。
- [x] 写入 migration failure marker：
  - [x] migration id
  - [x] source root
  - [x] target root
  - [x] failed step
  - [x] error message
  - [x] timestamp
- [x] 删除或保留 pending migration 的策略必须明确：
  - 推荐失败后将 pending 文件重命名为 `storage-migration-failed-<id>.json`。
  - 避免每次启动反复执行同一个失败迁移。
- [x] 继续使用旧 data root 启动应用。
- [x] Settings 首屏显示低噪音 warning，说明迁移失败且当前数据仍在旧目录。

### 7.5 恢复默认目录

恢复默认目录不是“删除 anchor”这么简单，必须走同一迁移机制：

- [x] 目标 data root = 默认 `%APPDATA%\Patina`。
- [x] 目标 webview root = 默认 `%LOCALAPPDATA%\Patina`。
- [x] 如果默认目录已经有旧 `patina.db`，必须预览冲突。
- [x] 推荐第一版要求默认目录为空或由 Patina 确认可覆盖的旧迁移残留。
- [x] 成功迁回后删除 active anchor。
- [x] 仍不自动删除旧自定义目录。

---

## 8. WebView 缓存治理

### 8.1 可再生成缓存 allowlist

只允许自动清理明确可再生成的目录：

- [x] `<webviewRoot>\EBWebView\Default\Cache`
- [x] `<webviewRoot>\EBWebView\Default\Code Cache`
- [x] `<webviewRoot>\EBWebView\Default\GPUCache`
- [x] `<webviewRoot>\EBWebView\ShaderCache`
- [x] `<webviewRoot>\EBWebView\GrShaderCache`
- [x] `<webviewRoot>\EBWebView\Default\DawnGraphiteCache`
- [x] `<webviewRoot>\EBWebView\Default\DawnWebGPUCache`

第一版不自动删除：

- [x] `<webviewRoot>\EBWebView\Default\Local Storage`
- [x] `<webviewRoot>\EBWebView\Default\Session Storage`
- [x] `<webviewRoot>\EBWebView\Default\Preferences`
- [x] `<webviewRoot>\EBWebView\Default\History`

原因：

- Patina 当前有少量 UI layout preference 使用 `localStorage`。
- 这些不是核心时间记录，但清掉会让用户看到一些视图偏好恢复默认。
- Cache 和 Code Cache 已经能释放主要空间。

### 8.2 缓存大小统计

- [x] 新增 Rust 函数统计 webview root 下各目录大小。
- [x] 统计时跳过 symlink、junction、reparse point。
- [x] 统计失败不阻塞应用启动。
- [x] 输出：
  - [x] total size
  - [x] reclaimable size
  - [x] allowlist breakdown
  - [x] last trim time
  - [x] pending clear flag

### 8.3 手动清理

运行中不直接删除 WebView cache，因为主窗口和 widget 可能持有锁。

推荐第一版流程：

- [x] 用户点击“清理缓存”。
- [x] 前端确认弹窗说明：
  - [x] 清理不会删除时间记录。
  - [x] 下次启动可能稍慢。
  - [x] 清理将在下次启动前执行。
- [x] Rust 设置 `pendingWebviewCacheClear = true`。
- [x] UI 显示“已安排下次启动前清理”。
- [x] 下次启动创建任何 WebView 前执行 allowlist 清理。

### 8.4 自动上限与启动前修剪

推荐默认策略：

- [x] `WEBVIEW_CACHE_TRIM_THRESHOLD_MB = 256`
- [x] `WEBVIEW_CACHE_TRIM_MIN_INTERVAL_HOURS = 24`
- [x] 只统计 allowlist reclaimable size。
- [x] 如果 `pendingWebviewCacheClear = true`，忽略 threshold，直接清理 allowlist。
- [x] 如果 reclaimable size > threshold 且距离上次自动 trim 超过 24 小时，清理 allowlist。
- [x] 如果 reclaimable size <= threshold，不清理。
- [x] 清理失败只记录，不阻塞启动，除非失败暴露出路径穿越或权限异常风险。

执行位置：

- [x] 在 `main_window` 创建 WebView 前调用。
- [x] 在 `widget` 创建 WebView 前调用。
- [x] 调用前检查没有现存 main/widget WebView window。
- [x] 如果已有任一 WebView window，跳过清理，避免运行中删缓存。

### 8.5 自定义数据目录后的 WebView root

用户选择数据目录后，以下文件均相对该目录：

```text
.\
  patina.db
  backups\
  remote-backup-temp\
  webview\
    EBWebView\
```

行为要求：

- [x] 新 WebView root 使用 `<dataRoot>\webview`。
- [x] 不复制旧 `%LOCALAPPDATA%\Patina\EBWebView`。
- [x] 旧 `EBWebView` 可作为“旧缓存目录”显示给用户。
- [x] 迁移成功后可以提示用户清理旧缓存。
- [x] 不自动删除旧缓存，除非用户明确点击并确认。

---

## 9. Storage recovery mode

必须设计一个最小恢复模式，避免自定义数据目录出错时用户看到空数据。

触发条件：

- [x] active anchor 指向的 data root 不存在。
- [x] active anchor 指向的 data root 不可读。
- [x] active anchor 指向的 `patina.db` 不存在。
- [x] active anchor 与当前 profile 不匹配。
- [x] anchor JSON 损坏且无法安全推断默认数据库。
- [x] pending migration 失败且旧 data root 也不可用。

推荐第一版实现：

- [x] 启动时检测到 storage fatal error 后，使用 native dialog 或最小错误窗口。
- [x] 给出三个动作：
  - [x] 重试
  - [x] 选择数据目录
  - [x] 使用默认目录
- [x] “使用默认目录”必须提示：如果默认目录没有旧数据库，将创建新的空数据库。
- [x] 不在用户确认前创建新数据库。
- [x] 所有恢复动作写入 diagnostic log。

---

## 10. Settings UI 设计要求

Settings / 存储建议拆成三个 Quiet Pro 子区：

### 10.1 数据目录

- [x] 显示当前数据目录。
- [x] 显示数据库大小。
- [x] 显示默认备份目录大小。
- [x] 提供按钮：
  - [x] 打开目录
  - [x] 复制路径
  - [x] 更改目录
- [x] 如果有 pending migration，显示 pending 状态和取消入口。
- [x] 如果最近迁移失败，显示失败状态和重试入口。

### 10.2 WebView 缓存

- [x] 显示当前缓存目录。
- [x] 显示可清理缓存大小。
- [x] 显示最近清理时间。
- [x] 提供按钮：
  - [x] 安排下次启动清理
  - [x] 打开缓存目录
  - [x] 复制路径
- [x] 如果缓存超过 threshold，显示低噪音提示。
- [x] 不使用强 danger 样式，除非清理失败或路径不可访问。

### 10.3 备份与恢复

- [x] 保留现有备份/恢复流程。
- [x] 文案补充“备份文件位置不等于主数据目录”。
- [x] 不把备份导出路径设置成新的数据目录。

---

## 11. 文案原则

### 11.1 必须区分的概念

- [x] “安装位置”：程序放在哪里。
- [x] “数据目录”：时间记录和设置事实源放在哪里。
- [x] “缓存目录”：WebView 运行缓存放在哪里。
- [x] “备份位置”：导出的 zip 文件放在哪里。

### 11.2 推荐中文文案

- [x] 数据目录说明：
  - `Patina 的时间记录、设置和本地备份默认保存在这里。更改目录需要重启，并会先创建迁移前备份。`
- [x] WebView 缓存说明：
  - `用于界面运行的 WebView 缓存，可以重新生成。清理不会删除时间记录，但下次启动可能稍慢。`
- [x] 迁移确认：
  - `迁移会复制当前数据到新目录。旧目录会保留，直到你确认不再需要。`
- [x] 失败提示：
  - `迁移没有完成，Patina 已继续使用原数据目录。当前数据没有被删除。`

### 11.3 推荐英文文案

- [x] Data directory:
  - `Patina stores time records, settings, and default local backups here. Changing this location requires a restart and creates a pre-migration backup first.`
- [x] WebView cache:
  - `Used by the embedded WebView runtime and can be regenerated. Clearing it does not delete time records, but the next launch may be slightly slower.`
- [x] Migration confirmation:
  - `Patina will copy current data to the new location. The old folder is kept until you decide it is safe to remove.`
- [x] Failure:
  - `Storage migration did not finish. Patina kept using the previous data directory. No current data was deleted.`

---

## 12. 实施阶段

### Phase 0: 现状基线与测试准备

- [x] 记录当前路径解析：
  - [x] `product_roaming_data_dir`
  - [x] `product_local_data_dir`
  - [x] `product_webview_data_dir`
  - [x] `resolve_product_db_path`
- [x] 记录当前 `EBWebView` 目录结构和 cache allowlist。
- [x] 添加测试 fixture：
  - [x] default root with `patina.db`
  - [x] custom root with `patina.db`
  - [x] corrupted anchor
  - [x] missing custom root
  - [x] pending migration
  - [x] oversized webview cache tree
- [x] 确认 `app / commands / platform / data / domain` owner 分工。

Validation:

- [x] `npm run check:rust-boundaries`
- [x] `npm run check:architecture`

### Phase 1: Anchor 与 StoragePaths

- [x] 新增 anchor DTO。
- [x] 新增 anchor read/write。
- [x] 新增 `StoragePaths` resolver。
- [x] 保持无 anchor 时路径完全兼容现状。
- [x] 增加 profile-aware 测试：
  - [x] Production 只读取 Production anchor。
  - [x] Local / Dev 不误读 Production anchor。
- [x] 增加损坏 anchor 测试。

Validation:

- [x] `cargo test --manifest-path src-tauri/Cargo.toml --quiet storage`
- [x] `npm run check:rust-boundaries`

### Phase 2: WebView cache 统计与修剪

- [x] 新增 cache allowlist。
- [x] 新增 size walker，跳过 symlink/junction。
- [x] 新增 manual pending clear state。
- [x] 新增 auto trim threshold。
- [x] 在 WebView 创建前接入 trim。
- [x] 增加 oversized cache 测试。
- [x] 增加路径穿越防护测试。
- [x] 增加 active window 存在时跳过 trim 的测试或可验证逻辑。

Validation:

- [x] `cargo test --manifest-path src-tauri/Cargo.toml --quiet webview_cache`
- [x] `npm run check:rust`

### Phase 3: Settings storage UI

- [x] 新增 frontend storage gateway。
- [x] 新增 Settings storage state。
- [x] 新增 storage snapshot load。
- [x] 扩展 `SettingsDataSafetyPanel`。
- [x] 增加 path copy/open actions。
- [x] 增加 pending cache clear UI。
- [x] 增加 migration preview dialog。
- [x] 补中文文案。
- [x] 补英文文案。
- [x] 测试 Settings UI 状态：
  - [x] loading
  - [x] default paths
  - [x] custom paths
  - [x] oversized cache
  - [x] pending cache clear
  - [x] migration failed

Validation:

- [x] `npm run test:settings`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`

### Phase 4: 主数据目录迁移

- [x] 新增 migration preview command。
- [x] 新增 migration schedule command。
- [x] 迁移前创建 structured backup。
- [x] 写 pending migration。
- [x] 启动前执行 pending migration。
- [x] 成功后写 active anchor。
- [x] 失败后保留旧 anchor。
- [x] 失败后写 failure marker。
- [x] 启动后展示 success/failure 状态。
- [x] 添加 default -> custom 测试。
- [x] 添加 custom -> custom 测试。
- [x] 添加 custom -> default 测试。
- [x] 添加 target not writable 测试。
- [x] 添加 target db validation failure 测试。
- [x] 添加 migration failure does not create empty active db 测试。

Validation:

- [x] `cargo test --manifest-path src-tauri/Cargo.toml --quiet storage_migration`
- [x] `npm run check:rust`

### Phase 5: Recovery mode

- [x] 启动时检测 active custom root missing。
- [x] 启动时检测 active custom DB missing。
- [x] 增加 native dialog 或最小 recovery window。
- [x] 增加“重试”。
- [x] 增加“选择数据目录”。
- [x] 增加“恢复默认目录”。
- [x] 确认恢复默认目录不会静默覆盖旧默认 DB。
- [x] 增加 recovery mode 测试或手工 smoke checklist。

Validation:

- [x] `npm run check:rust`
- [x] 手工 smoke：临时改 anchor 指向不存在目录，启动后不能生成空数据库。

### Phase 6: 端到端验证

- [x] 默认安装路径，未配置 anchor，升级后仍读旧数据。
- [x] 自定义安装路径，未配置 anchor，WebView root 仍为默认 local root。
- [x] 自定义数据目录后，DB 写入新目录。
- [x] 自定义数据目录后，默认 backup dir 在新目录。
- [x] 自定义数据目录后，remote-backup-temp 在新目录。
- [x] 自定义数据目录后，WebView root 在 `<dataRoot>\webview`。
- [x] 清理 WebView cache 后，时间记录不丢失。
- [x] 清理 WebView cache 后，视图偏好可能恢复默认；如果发生，确认文案或迁移策略可接受。
- [x] 迁移失败后继续使用旧目录。
- [x] 自定义目录丢失时不创建空新库。
- [x] 更新安装后 anchor 仍生效。

Validation:

- [x] `npm run check`
- [x] `npm run check:rust`
- [x] `npm run check:full`

---

## 13. 数据安全要求

- [x] 任何涉及 `patina.db` 的迁移必须先创建备份。
- [x] 任何目标 DB 生效前必须通过 schema validation。
- [x] 任何失败都不能删除旧 DB。
- [x] 任何失败都不能把 active anchor 指向未验证目标。
- [x] 任何自定义 root 缺失都不能静默初始化空库。
- [x] 所有路径输入都必须 canonicalize 或做等价规范化。
- [x] 所有文件操作必须使用 `PathBuf` 和 `fs` API，不拼 shell 命令。
- [x] 删除 cache 时必须只删除 allowlist 目录。
- [x] 删除 cache 时必须确认目标在当前 webview root 内。
- [x] 不遍历 symlink、junction、reparse point。
- [x] 错误信息不能暴露不必要的内部 SQL 细节。

---

## 14. 测试矩阵

| 场景 | 预期 |
| --- | --- |
| 无 anchor 启动 | 使用当前默认路径 |
| 有有效 anchor 启动 | 使用 custom data root 和 custom webview root |
| anchor profile 不匹配 | 不使用该 anchor |
| anchor JSON 损坏 | 不创建空 DB，进入恢复或安全默认 |
| custom root 不存在 | 不创建空 DB，进入恢复 |
| default -> custom 迁移成功 | 新 root 有 DB，旧 root 保留 |
| default -> custom 迁移失败 | 旧 root 继续可用，anchor 不变 |
| custom -> custom 迁移成功 | 新 custom root 生效 |
| custom -> default 迁移成功 | anchor 删除或恢复默认 |
| WebView cache 超过阈值 | 下次创建 WebView 前清理 allowlist |
| WebView cache 未超过阈值 | 不清理 |
| 用户安排清理 | 下次启动前清理 allowlist |
| Cache 路径含 symlink | 跳过，不跟随删除 |
| WebView 正在运行 | 跳过运行中清理 |
| 更新后启动 | anchor 仍生效 |
| 备份恢复 | 使用当前 active data root |

---

## 15. 发布与文档

- [x] `CHANGELOG.md` 的 `Unreleased` 增加用户可理解条目。
- [x] 如果进入发布，按实际范围判断 SemVer；该功能大概率是 `MINOR`。
- [x] README 或用户文档补充：
  - [x] 安装目录与数据目录区别。
  - [x] 备份位置与数据目录区别。
  - [x] WebView cache 可清理但会再生成。
- [x] GitHub issue 回应时只用 `Refs #20`，不要使用 closing keyword，除非明确准备关闭 issue。

---

## 16. 关键开放决策

实现前需要最终确认这些默认值：

- [x] 自动 trim 阈值使用 `256MB` 还是更保守的 `512MB`。
- [x] 是否允许用户选择 OneDrive、Dropbox、坚果云等同步目录作为 data root。
- [x] 是否第一版严格拒绝 removable drive。
- [x] 成功迁移后是否提供“删除旧数据目录”按钮，还是只提供“打开旧目录”。
- [x] 自定义 data root 后是否接受 WebView localStorage 偏好重置。
- [x] Recovery mode 用 native dialog 还是最小 Tauri window。
- [x] 是否实现自动重启，还是第一版要求用户手动重启。

推荐默认：

- [x] 自动 trim 阈值先用 `256MB`。
- [x] 第一版拒绝 UNC/network path。
- [x] 第一版不主动删除旧数据目录。
- [x] 第一版不迁移旧 `EBWebView`。
- [x] 第一版接受少量 WebView localStorage UI 偏好重置，并在测试中记录实际影响。
- [x] 第一版可以手动重启，降低迁移风险。

---

## 17. 验收标准

完成后必须同时满足：

- [x] 默认用户无感升级，旧数据仍在默认位置可读。
- [x] 用户可以看懂安装目录、数据目录、缓存目录、备份位置的区别。
- [x] 用户可以把主数据目录迁到非 C 盘本机目录。
- [x] 自定义目录生效后，未来 WebView cache root 跟随新主数据目录。
- [x] 大体积 WebView cache 可以清理。
- [x] WebView cache 超过上限后会自动启动前修剪。
- [x] 迁移失败不会造成数据丢失或空库误导。
- [x] 自定义目录缺失不会静默创建空数据库。
- [x] 所有新增逻辑符合 `app / commands / platform / engine / data / domain` owner 边界。
- [x] `npm run check:full` 通过。
