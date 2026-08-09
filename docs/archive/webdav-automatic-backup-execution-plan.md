# WebDAV 自动备份执行方案

## 1. 文档定位

本文是一份面向 Patina 维护者与执行代理的可勾选实施清单，用于把现有“定时本地备份”扩展为可选择 WebDAV 的自动备份能力。

- 文档类型：执行型 How-to。
- 当前状态：已完成；实现、完整验证与对抗式审查均已收口，文档进入归档。
- 适用范围：WebDAV 自动备份、远端验证、安全替换、失败恢复、对应设置界面与验证。
- 前置条件：现有定时本地备份实现、测试与对抗式审查已经收口。
- 归档规则：实现、验证和对抗式审查全部完成后，将本文移至 `docs/archive/`；长期成立的规则回写顶层长期文档。
- 范围纪律：本文不是云同步方案，也不把 Patina 改造成依赖云端才能成立的产品。

## 2. 目标结果

用户在已绑定 WebDAV 的前提下，可以从“选择备份位置”一级弹窗的 WebDAV 卡片进入同一个“定时备份”次级弹窗，配置每日或每周自动执行。Patina 到期后在后台生成完整 SQLite 快照、完成本地校验、上传 WebDAV、从 WebDAV 回读并再次校验；只有新备份被证明可恢复后，才把它认定为成功，并清理同一自动目标下更旧的、由当前 Patina 实例明确拥有的自动备份。

交付后应同时满足：

- 本地备份与 WebDAV 备份共用一套“何时执行”的调度语义，但各自保留明确的目标执行逻辑。
- 同一时刻只启用一个自动备份目标：本地或 WebDAV。
- WebDAV 自动备份只保留一份最新有效备份。
- 手动创建的 WebDAV 备份不受自动保留策略影响。
- 网络失败、凭据缺失、远端索引写入失败或远端校验失败时，上一份有效备份不被删除。
- 密码不进入 SQLite、前端状态、IPC 返回值、事件载荷或日志。
- 应用退出、崩溃或重启后，未完成任务能够按持久化阶段安全恢复或安全失败，不会把半成品当成有效备份。

## 3. 第一性原理

### 3.1 备份的价值是可恢复，不是“产生了一个文件”

一个 WebDAV 文件只有同时满足以下条件，才能被称为有效自动备份：

1. 文件来自当前正式 SQLite 快照生成链路。
2. 本地暂存文件通过正式快照预览、结构检查、资源上限与 SHA-256 校验。
3. WebDAV 上传完成后，Patina 从远端重新下载独立副本。
4. 下载副本再次通过正式快照校验，且摘要与大小和本地暂存文件一致。
5. 远端条目已进入可恢复列表，应用可以通过既有恢复入口发现它。
6. 本地运行账本已持久化“成功”，后续重启可以解释这份备份的来源和状态。

因此，`PUT` 返回成功、远端 `HEAD` 存在、大小相同或索引写入成功，任何一项单独成立都不等于备份有效。

### 3.2 新备份先成立，旧备份后退出

“只保留一份”不能实现为先删旧文件再上传新文件。正确顺序必须是：

1. 生成新的本地完整快照。
2. 本地验证新快照。
3. 以不会覆盖旧文件的唯一名称上传。
4. 从远端回读并验证。
5. 发布新条目到远端索引。
6. 在本地账本中确认新备份成功。
7. 从远端索引移除旧的自动备份条目。
8. 删除旧的自动备份文件。

第 1 至 6 步任一步失败，都必须保留旧备份。第 7 或 8 步失败时，新备份仍然有效，但必须记录可见的清理警告并允许后续幂等清理。

### 3.3 自动目标是一个互斥选择

当前产品只需要一个自动备份计划。计划包含：

- 是否启用。
- 每日或每周。
- 每周时的星期。
- 本地时间。
- 自动目标：本地或 WebDAV。

不分别维护“本地计划”和“WebDAV 计划”，否则会产生重复执行、状态来源不清、恢复后目标冲突和 UI 双开关歧义。用户从另一目标卡片保存并启用计划时，实际含义是切换同一计划的目标。

### 3.4 网络副作用不得包在 SQLite 事务中

数据库事务只持久化意图、声明运行、阶段和结果。上传、下载、远端索引读写与删除都在事务外执行。每个外部副作用前后写入足够的阶段信息，使重启后可以判断应该继续、校验、重试、清理还是停止。

### 3.5 幂等优先于“尽快再试一次”

同一逻辑时隙只能有一个运行记录。每次远端上传使用不可重复的对象名，不覆盖已有对象。重试先检查持久化阶段和远端事实，再决定复用、校验或分配新对象，不能盲目重复上传或重复删除。

### 3.6 凭据与配置是两类数据

WebDAV 地址、用户名和远端目录属于非秘密配置，可以存入 SQLite。密码属于秘密，只能从 Windows 凭据存储读取。自动任务只保存对当前 WebDAV 目标的非秘密身份摘要，不复制密码，也不把密码传给前端调度模型。

### 3.7 清理权限来自所有权证据

文件名相似、位于同一目录或出现在远端列表中，都不足以证明 Patina 可以删除它。自动清理必须同时具备：

- 当前运行账本记录的精确远端对象路径。
- 远端索引中的自动来源标记。
- 与当前自动目标身份一致的目标标识。
- 已记录的摘要与大小。
- 新备份已经成功成立。

缺少任一证据时跳过清理，只记录警告，不推测、不扩大删除范围。

## 4. 已确认产品决策

- 定时备份是“备份”的小型扩展能力，不提升为设置页同级功能区。
- “选择备份位置”一级弹窗保持现有尺寸、标题、说明与两张目标卡片，不改既有文案。
- 本地卡片与 WebDAV 卡片都使用同一种 `CalendarClock` 次级操作图标。
- 点击目标卡片主体仍立即执行一次手动备份；点击图标只打开定时备份次级弹窗。
- 次级弹窗继续使用“定时备份”标题、常规尺寸的 `BETA` badge 和右上角开关。
- 频率、星期与时间保持一行；每日不显示星期控件，每周显示星期控件。
- WebDAV 次级弹窗只展示当前目标摘要，不提供伪装成输入框的不可编辑字段。
- WebDAV 目录仍在“WebDAV 配置”中修改，次级弹窗不重复提供编辑入口。
- 只保留一份最新有效的自动备份，不提供保留数量选择。
- 没有真实状态时不显示空的“下次执行 / 最近成功 / 最近失败”占位行。
- 当前只允许一个自动目标生效：本地或 WebDAV。

## 5. 非目标

- 不实现本地与 WebDAV 两个并行自动计划。
- 不实现多个 WebDAV 账户、多个远端目录或计划列表。
- 不实现任意 cron 表达式、按小时执行或复杂节假日规则。
- 不实现增量备份、差异合并或多个快照合并。
- 不把 WebDAV 当作实时同步、协作或多设备一致性服务。
- 不删除用户手动上传的 WebDAV 备份。
- 不扫描并删除不在本地账本中的“疑似 Patina 文件”。
- 不为定时导出提前建立通用任务框架。
- 不在本任务中改变手动本地备份、手动 WebDAV 备份和恢复操作的既有文案。
- 不在本任务中改变 WebDAV 的全局传输协议政策；自动备份复用现有已验证配置，不悄悄扩大可接受地址范围。
- 不引入内部功能代号、分阶段产品编号或面向用户的格式编号。

## 6. 当前事实与缺口

### 6.1 已有能力

- `src-tauri/src/domain/backup_schedule.rs` 已拥有每日/每周、本地时间、逻辑时隙、下次执行与目标身份标识。
- `src-tauri/src/engine/backup_scheduler.rs` 已拥有声明、重试、调和、过期重试让位于新时隙等纯决策状态机。
- `src-tauri/src/data/scheduled_backup.rs` 已拥有本地目录规范化、无覆盖文件名、快照校验、安全保留与重启调和。
- `src-tauri/src/data/repositories/scheduled_backup.rs` 已拥有配置和运行账本、唯一时隙、有限重试与终态压缩。
- `src-tauri/src/app/scheduled_backup.rs` 已拥有全局运行锁、30 秒轮询、主动唤醒和前端状态事件。
- `src-tauri/src/data/remote_backup.rs` 已拥有手动 WebDAV 上传、列表、下载、索引和恢复前预览。
- `src-tauri/src/platform/webdav.rs` 已拥有 URL/远端目录规范化、目录创建、上传与流式下载。
- `src-tauri/src/platform/credentials.rs` 已把 WebDAV 密码放入 Windows 凭据存储。
- `SettingsBackupDialog.tsx` 已把本地定时入口放在一级弹窗卡片内，并使用次级弹窗展示计划。

### 6.2 必须补齐的缺口

- 当前计划输入只有 `targetDir`，无法表达 WebDAV 目标。
- 当前运行键包含 `scheduled-local-backup`，语义被本地目标写死。
- 当前运行记录只有本地 `target_path` 和 `file_state`，无法解释本地暂存、已上传、远端已验证和索引已发布。
- 当前 WebDAV 配置由前端读取 settings 后传给手动命令；后台调度器没有 Rust 侧的规范化配置读取入口。
- 当前 WebDAV 上传只校验本地文件，没有远端回读校验。
- 当前 WebDAV client 没有精确删除、条件写入、远端元数据或索引冲突处理能力。
- 当前远端索引没有“手动 / 自动”来源和目标所有权信息，自动清理无法安全区分手动备份。
- 当前自动任务失败分类面向本地路径，无法区分凭据、鉴权、网络、远端完整性和索引冲突。
- 当前 WebDAV 卡片没有定时入口。

## 7. 目标所有权与架构

### 7.1 Rust owner

```text
src-tauri/src/
  domain/
    backup_schedule.rs          # 计划目标、时隙、不变量、运行快照契约
  engine/
    backup_scheduler.rs         # 备份专用声明/重试/调和决策，不做网络或 SQL
  data/
    repositories/
      scheduled_backup.rs       # 配置与运行账本 SQL
      remote_backup_settings.rs # Rust 侧 WebDAV 非秘密配置读取
    scheduled_backup.rs         # 按目标分派本地或 WebDAV 执行
    remote_backup.rs            # 兼容导出或薄入口
    remote_backup/
      index.rs                  # 索引解析、合并、发布与所有权字段
      transfer.rs               # 备份上传、回读验证、删除与幂等恢复
      temp.rs                   # 受控本地暂存路径与清理
  platform/
    webdav.rs                   # HTTP/WebDAV 原语，不承载备份保留策略
    credentials.rs              # Windows 凭据存储
  app/
    scheduled_backup.rs         # runtime 锁、唤醒、事件和跨 owner 协调
  commands/
    backup.rs                   # 薄 IPC 入口
```

执行时必须以真实职责决定最终文件，不为满足目录图强行拆文件。若 `data/remote_backup.rs` 拆分，原文件只保留稳定导出与薄组合，不能让新目录和旧大文件同时持有两套实现。

### 7.2 前端 owner

```text
src/
  features/settings/
    components/SettingsBackupDialog.tsx
    services/scheduledBackupService.ts
  platform/backup/
    scheduledBackupRuntimeGateway.ts
  styles/features/
    settings.css
```

- 组件只组织卡片、弹窗和可见状态；设置页样式集中由 `styles/features/settings.css` 持有，不在组件目录新增局部 CSS owner。
- feature service 暴露设置页私有流程。
- Tauri invoke、事件和 raw payload 解析只留在 `platform/backup` gateway。
- 不在组件中直接调用 `invoke`，不让前端读取或传递 WebDAV 密码。

### 7.3 与定时导出的边界

`backup_scheduler.rs` 保持备份专用名称。WebDAV 仍然是“备份目标”，不构成把文件改成通用 `scheduler.rs` 的理由。

等定时导出真正实施时，只在出现可证明的重复后提取纯时间语义，例如：

```text
domain/schedule.rs          # cadence / weekday / time / due slot
domain/backup_schedule.rs   # 备份目标与备份不变量
domain/export_schedule.rs   # 导出格式、字段和目标语义
engine/backup_scheduler.rs  # 备份状态机
engine/export_scheduler.rs  # 导出状态机
```

不得提前把备份快照校验、WebDAV 安全替换、导出格式选择和任意后台任务揉进同一个“通用调度器”。

## 8. 目标领域模型

### 8.1 自动目标

计划输入使用带判别字段的目标类型，而不是用空字符串或特殊目录代表 WebDAV：

```rust
enum ScheduledBackupTargetInput {
    Local { target_dir: String },
    WebDav,
}
```

持久化配置还需要：

- `target_kind`：`local` 或 `webdav`。
- 本地目标时保存规范化绝对目录。
- WebDAV 目标时保存非秘密目标身份摘要；摘要由规范化 URL、用户名和远端目录派生。
- `target_generation` 继续作为“这一组目标配置的所有权边界”，目标种类或目标身份变化时重新生成。

目标身份变化包括：

- 本地目录改变。
- 本地切换到 WebDAV，或 WebDAV 切换到本地。
- WebDAV URL、用户名或远端目录改变。
- WebDAV 配置被删除。

密码更新不改变远端目标身份，但必须唤醒调度器，使等待中的鉴权失败可以在下一次允许的执行点重新检查。

### 8.2 运行阶段

业务状态继续保持 `running / retry_wait / succeeded / failed`，另用明确的产物阶段解释外部副作用：

```text
absent
  -> staged
  -> uploaded
  -> remote_verified
  -> indexed
  -> succeeded
  -> pruned（旧运行）
```

另保留：

- `missing`：账本拥有的产物已不存在。
- `conflict`：远端对象或本地文件和记录身份不再一致。

运行记录至少要持久化：

- 目标种类。
- 目标身份标识。
- 逻辑日期与时间。
- 本地暂存路径，未创建时为空。
- 最终本地路径或精确远端对象路径。
- 远端索引条目 ID。
- 当前产物阶段。
- SHA-256 与字节大小。
- 可选的远端 ETag；只能作为并发与诊断信号，不能替代回读校验。
- 尝试次数、下次重试时间、错误码、安全化错误信息与清理警告。

### 8.3 有限重试

- 连接超时、临时 DNS 错误、网络中断、可重试服务端错误：沿用 5 分钟、30 分钟两次延迟重试。
- 凭据缺失、鉴权拒绝、无效 URL、无效远端目录、文件超限：当前时隙直接失败，不做密集重试；下一时隙仍可重新尝试。
- 摘要不一致、正式预览失败、远端对象冲突：当前时隙直接失败并保留旧备份。
- 新逻辑时隙到期时，旧时隙的等待重试让位于最新时隙，不补跑多份历史备份。
- 重试只复用已经通过身份校验的阶段；无法证明的半成品不覆盖、不晋级为成功。

## 9. 数据库迁移方案

### 9.1 配置表

- [x] 为 `scheduled_backup_config` 设计目标判别字段和互斥约束，禁止本地与 WebDAV 字段同时有效。
- [x] 把现有配置无损映射为 `local` 目标，保留 enabled、cadence、weekday、local_time_minutes、anchor 和 target_generation。
- [x] 保持单行配置约束 `id = 1`，从数据层保证只存在一个自动计划。
- [x] 把保留数量固定为 1；如果为升级兼容保留 `retention_count` 字段，数据库约束和 repository 写入都只能接受 1。
- [x] 为 WebDAV 目标保存非秘密身份摘要，不保存密码，不复制一份可漂移的完整 WebDAV 凭据。
- [x] 写互斥 CHECK：本地目标必须有非空本地目录；WebDAV 目标必须有非空目标身份摘要。

### 9.2 运行表

- [x] 为 `scheduled_backup_runs` 增加目标种类、暂存路径、远端条目 ID、产物阶段和可选 ETag。
- [x] 将现有本地运行映射到 `local`，把已成功且 `present` 的记录映射为已经验证的本地产物。
- [x] 保留 `(target_generation, logical_date, logical_time_minutes)` 唯一约束，防止同一时隙重复声明。
- [x] 更新 retention 与 retry 索引，使按当前目标身份查找最新成功和待重试运行仍然有索引支持。
- [x] 所有 SQL 值使用参数绑定；状态名和列名只有在固定白名单内才可动态选择。
- [x] 在单个数据库事务内完成表重建、数据拷贝、约束校验和替换，任一步失败都回滚。

### 9.3 升级与恢复保护

- [x] 新安装直接得到完整 schema。
- [x] 从现有定时本地备份 schema 升级时保留配置、成功记录、失败记录和目标身份。
- [x] 不完整旧 schema 不得被误标为当前基线。
- [x] `schema_contracts.rs` 同步检查新增列、CHECK 与索引。
- [x] `sqlite_pool_upgrade_tests.rs` 增加现有数据库直升测试与重复执行迁移测试。
- [x] 覆盖恢复后继续沿用“暂停自动备份、重置目标身份、清空旧运行账本”的安全规则。
- [x] 快照表计数、预览与恢复测试同步覆盖改变后的计划表和运行表。

## 10. Rust 侧 WebDAV 配置入口

当前前端通过读取所有 settings 组装 WebDAV 配置，后台调度不能依赖这条前端链路。

- [x] 在 `data/repositories` 建立 WebDAV 非秘密配置读取 owner，统一维护 URL、用户名和远端目录 key。
- [x] 把 `settings_payload_service.rs` 中重复的 key 常量迁到该 owner，避免写侧和读侧各自维护字符串。
- [x] repository 返回规范化、已验证的配置对象或明确的“未配置”结果。
- [x] 密码继续只通过 `platform/credentials.rs` 获取，不并入 repository DTO。
- [x] 移除“读取已保存明文密码到 WebView”的 `reveal` 调用链；编辑配置时以“已有凭据”状态表示，空密码代表保留原凭据，只有用户输入新密码时才替换。
- [x] 删除对应 reveal command、gateway 方法、command manifest 授权与前端状态，避免自动备份落地后仍存在密码经 IPC 返回的旁路。
- [x] 保存 WebDAV 配置时，由应用层协调“保存设置”和“通知计划目标身份变化”，不让 `commands/persistence.rs` 直接承载跨 owner 规则。
- [x] 删除 WebDAV 配置时，如果当前自动目标是 WebDAV，则原子地禁用计划、取消活动运行、更新目标身份并发出状态事件。
- [x] 只更新密码时不重置计划，但唤醒 runtime。
- [x] Rust 日志只记录错误类别和安全上下文，不输出 URL 用户信息、Authorization、密码或远端响应正文。

## 11. WebDAV 平台原语

`platform/webdav.rs` 只提供外部环境能力，不决定什么是有效备份或何时清理。

- [x] 为所有传输设置连接超时、整体请求超时和响应大小上限，避免后台任务永久占用全局运行锁。
- [x] 上传支持 `If-None-Match: *` 或等价“不覆盖已存在对象”语义；服务器不支持时，仍使用高熵唯一对象名并在冲突时失败，不回退为覆盖。
- [x] 增加精确远端对象删除，路径必须由规范化目录和安全文件名组成。
- [x] 增加远端元数据读取，返回存在性、字节大小和可选 ETag。
- [x] 增加索引读取时的 ETag 获取，以及条件写入能力。
- [x] 条件写入遭遇并发修改时返回可分类冲突，不把它包装成普通字符串成功。
- [x] 下载继续采用 `.partial` 临时文件、流式大小限制、flush 后 rename 的发布顺序。
- [x] 上传失败后不假定远端不存在；调用方必须通过精确对象路径重新核对。
- [x] 拒绝反斜杠、`..`、控制字符和不能安全编码的远端路径段。
- [x] 不跟随会把凭据发送到不同主机的跨主机重定向；加入针对重定向的测试。
- [x] 对错误响应只保留安全化状态与有限诊断，不把服务器 HTML/XML 原文写入用户错误或日志。

## 12. 远端索引与手动备份共存

### 12.1 索引条目

在现有索引条目中增加可缺省字段：

- `origin`：`manual` 或 `scheduled`；旧条目缺省视为 `manual`。
- `target_generation`：只有自动条目需要。
- `run_key`：只有自动条目需要。
- `archive_sha256`：用于所有权与校验，不替代回读验证。

- [x] 旧索引能够继续读取，不要求批量重写旧条目。
- [x] 手动上传仍创建 `manual` 条目。
- [x] 自动上传创建 `scheduled` 条目，并带当前目标身份和 run key。
- [x] 列表与恢复继续同时展示手动和自动条目。
- [x] 自动保留只选择 `origin = scheduled` 且 target_generation 与当前目标一致的旧条目。
- [x] 改变 URL、用户名或远端目录后，不跨目标清理旧自动备份。
- [x] 其他 Patina 实例写入同一目录时，不清理其不同 target_generation 的条目。

### 12.2 索引并发

- [x] 手动上传、自动上传、列表维护和清理共用同一个进程内索引锁。
- [x] 有 ETag 时使用“读取—合并—条件写入”，冲突后重新读取并有限重试。
- [x] 没有 ETag 时使用“读取—合并—写入—重新读取验证”，验证失败不得进入清理阶段。
- [x] 合并时保留当前读取到的未知条目与可缺省字段，不能以本地旧快照整体覆盖远端新索引。
- [x] 索引发布失败时，新远端文件记录为未发布半成品，旧有效备份保留。
- [x] 重启后能够通过 run 记录的精确对象路径继续验证并重新发布索引，不必再次生成快照。

## 13. 自动执行流水线

### 13.1 声明

- [x] 调度器按当前时区计算最新到期逻辑时隙。
- [x] run key 改为目标中立的 `scheduled-backup` 语义，不再写死 `local`。
- [x] 声明运行时持久化当前 target_kind、target_generation 和逻辑时隙。
- [x] 声明与读取活动运行在短 SQLite 事务内完成，不做文件或网络 I/O。
- [x] 全局 run lock 保证同一进程内手动恢复、配置保存和自动任务不会并发破坏数据边界。

### 13.2 生成本地暂存快照

- [x] WebDAV 自动任务从受控 `remote_backup_temp_dir` 分配包含 run 身份的唯一 `.zip` 路径。
- [x] 路径必须位于解析后的受控根目录直属层级，文件名通过白名单验证。
- [x] 使用现有“不覆盖创建”的正式 SQLite 快照入口生成完整备份。
- [x] 使用正式 scheduled snapshot validator 得到 SHA-256 与大小。
- [x] 本地校验成功后把阶段持久化为 `staged`，再进入网络操作。
- [x] 校验失败时删除可证明属于当前 run 的暂存文件，标记失败并保留旧远端备份。

### 13.3 上传

- [x] 生成包含日期、时间、目标身份前缀和随机后缀的唯一远端文件名。
- [x] 在上传前把精确远端对象路径写入 run 记录。
- [x] 确保远端目录存在；目录创建失败按配置或网络错误分类。
- [x] 以不可覆盖语义上传暂存文件。
- [x] 上传结束后读取远端元数据，大小不一致立即进入完整性失败。
- [x] 持久化 `uploaded` 阶段和可选 ETag。

### 13.4 远端回读验证

- [x] 下载到与上传暂存文件不同的验证路径，禁止把原文件当作回读结果。
- [x] 重新执行正式备份预览、结构校验、资源上限和 SHA-256 计算。
- [x] 远端副本的 SHA-256 与大小必须和上传前记录完全一致。
- [x] 校验成功后持久化 `remote_verified`。
- [x] 校验副本在成功、失败和取消路径都按精确所有权清理。
- [x] 远端校验失败时不删除上一份有效自动备份；当前远端对象进入待清理半成品状态。

全量回读会增加一次下载流量，但它是证明“WebDAV 上的实际字节可以走正式恢复链”的直接证据。没有跨服务器可靠的内容摘要能力前，不用 ETag、Content-Length 或服务器厂商特性替代这一步。

### 13.5 发布索引与确认成功

- [x] 在远端索引中合并新的 `scheduled` 条目。
- [x] 回读索引，确认新条目的 ID、路径、摘要、大小、run key 与目标身份一致。
- [x] 持久化 `indexed` 阶段。
- [x] 将 run 标记为 `succeeded`，记录完成时间、摘要和大小。
- [x] 更新既有“最近备份时间”展示来源，使手动与自动成功都能诚实反映。
- [x] 发出 `scheduled-backup-changed` 事件；事件只通知状态变化，不包含密码和完整 WebDAV 配置。

### 13.6 安全清理旧自动备份

- [x] 只在新 run 已 `succeeded` 后查找同一 target_generation 的旧成功自动条目。
- [x] 清理候选必须同时出现在本地账本和远端索引，路径、摘要、大小与来源一致。
- [x] 先用条件索引更新移除旧条目并回读确认。
- [x] 再删除精确旧远端对象。
- [x] 删除成功后把旧 run 标记为 `pruned`。
- [x] 删除前发现对象缺失时标记 `missing`，不扫描同目录寻找替代对象。
- [x] 身份、摘要或路径不一致时标记 `conflict`，不删除任何文件。
- [x] 索引更新或删除失败时在新 run 写入 cleanup warning；新备份保持成功，后续 tick 幂等重试清理。
- [x] 永远不清理 `manual` 条目，不清理其他 target_generation，不清理本地账本不存在的对象。

## 14. 崩溃与重启调和矩阵

| 最后持久化阶段 | 重启后动作 | 禁止动作 |
| --- | --- | --- |
| `absent` | 检查受控暂存路径；没有有效文件则重新生成 | 不推测远端已有文件 |
| `staged` | 重新校验本地暂存摘要后上传 | 不跳过本地校验 |
| 上传中断、仍为 `staged` | 检查已记录远端路径；存在时下载验证，不存在时换唯一名称重试 | 不覆盖可能的半成品 |
| `uploaded` | 从远端回读并校验 | 不仅凭 ETag 标成功 |
| `remote_verified` | 幂等合并并发布索引 | 不先清理旧备份 |
| `indexed` | 回读索引与远端对象，满足条件后补记成功 | 不重新生成另一份快照 |
| `succeeded` 且有清理警告 | 重跑精确清理 | 不改变成功事实，不扩大删除范围 |
| `retry_wait` | 到达 retry_at 后按持久化阶段继续 | 不从头盲目重复所有副作用 |
| 目标身份已变化 | 终止旧活动运行并保留旧目标产物 | 不跨目标继续上传或清理 |

- [x] 为矩阵每一行建立独立单元或集成测试。
- [x] 调和逻辑对同一状态重复执行两次仍得到同一安全结果。
- [x] 数据库更新失败但外部副作用已完成时，下一次调和能重新观察事实并补记状态。
- [x] 应用关闭期间错过多个时隙时只处理最新符合 anchor 的时隙。

## 15. 错误分类与用户可见状态

建议错误码至少覆盖：

- `webdav_not_configured`
- `credential_missing`
- `authentication_failed`
- `remote_target_unavailable`
- `remote_name_conflict`
- `upload_failed`
- `remote_validation_failed`
- `remote_index_conflict`
- `remote_index_publish_failed`
- `cleanup_failed`
- `configuration_changed`

- [x] 内部错误先归类，再映射为有限、可本地化、无敏感信息的用户文案。
- [x] `error_message` 限长、去换行，不写服务器响应正文。
- [x] 凭据缺失与鉴权失败明确提示用户检查 WebDAV 配置，不展示密码或 Authorization。
- [x] cleanup warning 与备份失败分开：清理失败不能把已经有效的新备份显示成失败。
- [x] 没有下次执行、成功、失败或活动运行时，不渲染空状态行。
- [x] UI 只显示当前 target_generation 的最近结果，避免切换目标后把本地成功误显示为 WebDAV 成功。

## 16. UI 执行方案

### 16.1 一级弹窗

- [x] 保持 `settings-backup-dialog` 当前宽度、卡片布局、标题和说明。
- [x] 本地备份卡片保持现状。
- [x] 在 WebDAV 备份卡片右侧加入与本地一致的 `CalendarClock` `QuietIconAction`。
- [x] 图标的 title 与 accessible name 使用本地化的“定时备份”。
- [x] 卡片主体点击区域与图标点击区域分离，图标点击不得冒泡触发手动上传。
- [x] 忙碌状态下主体和图标使用同一禁用规则。
- [x] WebDAV 未配置时继续不显示 WebDAV 卡片，因此不出现不可执行的自动入口。
- [x] 图标 tooltip 使用组件默认上方定位；不得被一级弹窗裁剪或落到弹窗外下方。

### 16.2 次级弹窗

- [x] 点击本地图标时以 `local` 目标打开；点击 WebDAV 图标时以 `webdav` 目标打开。
- [x] 标题保持“定时备份”，使用 `QuietBadge variant="beta" size="regular"`，badge 与标题字号、基线和间距匹配。
- [x] 右上角只保留启用开关，不增加多余关闭按钮；取消按钮和遮罩关闭承担退出。
- [x] 频率、可选星期和时间保持同一行，狭窄窗口按 Quiet Pro 规则有序换行。
- [x] 本地目标行显示文件夹图标、静态路径和“更改目录”。
- [x] WebDAV 目标行显示云端图标与包含协议的静态保存地址，例如 `https://example.com/webdav/Patina`；不使用 input 外观，不显示用户名、密码或 URL userinfo。
- [x] WebDAV 目标行不显示“更改目录”；目录修改继续由 WebDAV 配置卡片拥有。
- [x] 从另一目标打开并保存启用计划时，切换同一计划的 target_kind，并更新目标身份与 anchor。
- [x] 保存按钮只在草稿与已保存快照不一致且载入完成时启用。
- [x] 初次载入使用弹窗内局部 loading，一级弹窗卡片不进入错误的手动备份加载态。
- [x] 保存中禁止关闭导致状态丢失；保存失败保留草稿并显示有限错误。
- [x] 关闭后恢复到触发的 CalendarClock 图标焦点。

### 16.3 状态展示

- [x] WebDAV 自动目标启用后可显示下次执行时间。
- [x] 最近成功显示时间和远端有效文件大小。
- [x] 最近失败显示时间和安全化原因。
- [x] 活动运行显示统一“备份中”反馈，等待重试时显示重试时间和安全化原因；内部阶段仍完整持久化并用于调和。
- [x] 清理失败单独显示克制的警告，说明新备份仍有效。
- [x] 当前目标未启用且没有真实历史状态时不显示“未启用”占位文案。
- [x] 不加入成功率、进度百分比、存储统计或其他无真实数据支撑的装饰指标。

## 17. IPC、事件与权限

- [x] 扩展现有 `cmd_get_scheduled_backup_snapshot` 与 `cmd_save_scheduled_backup_config` 契约表达 target，不新建一组 WebDAV 专用计划命令。
- [x] `cmd_pick_scheduled_backup_directory` 仅对本地目标使用。
- [x] 自动执行完全由 Rust runtime 发起；前端不通过计时器调用手动 upload 命令。
- [x] command handler 继续只做 DTO、caller guard 和转发。
- [x] gateway 对 target 判别字段、阶段、nullable 字段和数值范围做运行时解析。
- [x] WebDAV 密码只允许作为用户主动保存配置时的 command 输入，不再通过任何 command 返回前端。
- [x] `scheduled-backup-changed` 继续作为低频全局通知；快照由 command 重新获取，不把完整状态塞进事件。
- [x] 核对 `build.rs` application command manifest、`window-commands.toml`、capability 与 invoke handler；只授予主窗口必要命令。
- [x] 不给 Widget 增加 WebDAV、密码、文件或网络能力。
- [x] Rust 后台使用原生 `reqwest`，不为前端新增宽泛 HTTP capability。

## 18. 安全与隐私审查清单

- [x] 密码只存在于 Windows 凭据存储和最短必要生命周期的 Rust 内存中。
- [x] 数据库、run 账本、远端索引、事件、日志、panic、错误 DTO 与前端状态均不包含密码。
- [x] URL userinfo 被拒绝或清除，不能用 `https://user:password@host` 绕过凭据边界。
- [x] 跨主机重定向不转发 Basic Auth。
- [x] 远端目录与文件名经过规范化和安全路径拼接。
- [x] 上传和下载均有 512 MiB 或更严格的统一上限，不允许 Content-Length 缺失绕过流式计数。
- [x] WebDAV XML/JSON 响应有大小上限、解析深度或条目数量上限。
- [x] 本地暂存文件只位于受控目录，不跟随符号链接或 Windows reparse point 越界清理。
- [x] 删除前重新核对对象所有权；校验不完整时跳过删除。
- [x] 自动备份包含与手动完整备份相同的数据，UI 和文档不暗示它是脱敏副本。
- [x] 日志审查覆盖 debug、error、网络失败和测试失败路径，确认没有秘密或完整远端响应泄漏。

## 19. 分阶段执行清单

### 阶段 0：冻结基线

- [x] 确认现有定时本地备份实现、测试和对抗式审查全部完成。
- [x] 记录开始前 `git status --short`，标出用户已有修改，不覆盖无关工作。
- [x] 运行定时本地备份相关单元测试，确认起点为绿。
- [x] 保存一级与次级弹窗桌面宽度和窄窗口截图作为回归基线。
- [x] 确认手动本地备份、手动 WebDAV 上传、列表、下载和恢复均可用。

### 阶段 1：先写失败测试

- [x] 为 target enum、互斥目标和目标身份变化写 domain 测试。
- [x] 为目标中立 run key 写测试，证明日期、时间和目标身份决定唯一时隙。
- [x] 为旧本地 schema 升级写数据库测试。
- [x] 为 WebDAV 自动运行各阶段与崩溃调和写状态机测试。
- [x] 为“新备份未验证时绝不删除旧备份”写高优先级回归测试。
- [x] 为“手动备份永不被自动清理”写回归测试。
- [x] 为远端索引并发冲突、旧条目缺省来源和跨目标隔离写测试。
- [x] 为缺凭据、鉴权失败、超时、部分上传、错误大小、错误摘要和索引失败写测试。
- [x] 确认新增测试直接覆盖原缺口，并在实现收口后能够捕获对应危险变体。

### 阶段 2：领域模型与数据库

- [x] 实现 target enum、输入验证和目标身份派生。
- [x] 改造 config/run DTO，保持 serde 判别清晰。
- [x] 实现 schema 迁移、repository 读写和升级保护。
- [x] 更新 schema contract、备份表计数和恢复 reset。
- [x] 运行 domain、repository、schema 和升级测试。

### 阶段 3：Rust 侧 WebDAV 配置 owner

- [x] 提取 settings key owner 和规范化读取。
- [x] 让手动 WebDAV 流程与自动流程共用同一非秘密配置类型。
- [x] 保存、删除配置时协调自动计划目标身份。
- [x] 更新凭据后唤醒调度器。
- [x] 运行 settings persistence、credential mock 与 caller guard 测试。

### 阶段 4：WebDAV 原语与远端索引

- [x] 实现不可覆盖上传、metadata、条件索引写入与精确删除。
- [x] 复核 `data/remote_backup.rs` 的 index、transfer 与 temp 职责；本次保持一个 data owner，未为尚未稳定的复用关系制造转发壳，平台 HTTP 原语继续独立位于 `platform/webdav.rs`。
- [x] 给索引条目添加缺省兼容的来源和所有权字段。
- [x] 统一手动与自动索引锁。
- [x] 运行 WebDAV mock server 测试，不连接真实用户服务器。

### 阶段 5：自动执行与安全替换

- [x] 实现本地暂存、正式校验、上传、回读校验、索引发布和成功确认。
- [x] 实现阶段持久化与重启调和。
- [x] 实现瞬时/永久/完整性错误分类。
- [x] 实现单份自动保留和清理警告。
- [x] 证明所有失败注入点都保留上一份有效备份。
- [x] 证明成功后正常路径只剩一份当前目标的自动备份。

### 阶段 6：runtime 与 IPC

- [x] 扩展现有 snapshot/save command 契约。
- [x] 保持 command 和 app 层薄，网络与 SQL 不进入 handler。
- [x] 保持恢复锁和自动运行锁一致。
- [x] 更新 command manifest、permission set 与 runtime smoke fixture。
- [x] 运行 IPC contract、Rust boundary 和 Tauri runtime smoke。

### 阶段 7：前端 UI

- [x] WebDAV 卡片加入同款 CalendarClock 图标，不改变一级弹窗尺寸。
- [x] 次级弹窗接受固定 target 上下文。
- [x] 本地目标与 WebDAV 目标使用各自静态目标行。
- [x] target 变化、dirty、loading、saving、error 与焦点恢复行为正确。
- [x] 补齐中英文 copy source、schema、review manifest 和生成产物。
- [x] 更新 SSR、真实浏览器和 Settings 页面状态测试。
- [x] 桌面、窄窗口、明暗主题和 125%/150% Windows 缩放完成视觉检查。

### 阶段 8：完整验证

- [x] 运行 `npm test`。
- [x] 运行 `npm run test:replay`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run check:full`。
- [x] 运行 `npm run test:tauri-runtime-smoke`。
- [x] 运行 `git diff --check`。
- [x] 检查测试临时目录、mock server、子进程和数据库均已清理。
- [x] 确认未放宽 bundle、hotspot、capability、coverage 或安全门禁来让改动通过。

### 阶段 9：文档、归档与交接

- [x] 把长期成立的自动备份安全替换规则写入合适的顶层文档。
- [x] 在 `CHANGELOG.md` 的 Unreleased 中只记录最终用户可感知结果，不记录中间试错。
- [x] 更新执行单中的实际文件、命令和验证结果。
- [x] 将本文所有完成项勾选，未完成项不得用说明替代勾选。
- [x] 对抗式审查通过后，把本文移入 `docs/archive/`。
- [x] 重新读取 live GitHub Project，报告状态与人工拖动建议。

## 20. 测试矩阵

### 20.1 Domain 与 repository

- [x] 每日、每周、星期边界、夏令时不存在时间与重复时间。
- [x] 启用后不补跑 anchor 之前时隙。
- [x] 本地/WebDAV 目标互斥。
- [x] 目标变化取消旧活动运行并生成新目标身份。
- [x] 同时 claim 同一时隙只有一个成功。
- [x] 重试次数、retry_at 与最新时隙 supersede 正确。
- [x] 迁移前后现有本地配置和运行记录一致。
- [x] replace restore 后计划禁用且旧 run 清空。

### 20.2 WebDAV mock server

- [x] 正常 MKCOL、PUT、GET、条件索引写入和 DELETE。
- [x] 服务器不支持 HEAD 或不返回 ETag 时仍通过全量回读验证。
- [x] PUT 返回成功但远端实际字节被截断。
- [x] PUT 中途断开但远端留下半成品。
- [x] GET 没有 Content-Length 且流超过上限。
- [x] GET 返回错误 Content-Length。
- [x] 索引第一次写入发生 ETag 冲突，重新读取合并后成功。
- [x] 索引持续冲突，当前 run 失败且旧备份保留。
- [x] 删除被拒绝，新备份成功且出现 cleanup warning。
- [x] 远端对象已缺失，只标 missing，不删除其他对象。
- [x] 恶意文件名、路径穿越、控制字符和跨主机重定向被拒绝。
- [x] 错误响应包含伪密码时，日志和用户错误不回显正文。

### 20.3 有效性与保留

- [x] 第一份自动 WebDAV 备份成功后可从既有列表下载并正式 preview。
- [x] 第二份未通过远端校验时，第一份仍在索引和远端存在。
- [x] 第二份完全成功后，第一份自动备份被安全清理。
- [x] 清理失败时两份文件可能暂时共存，但列表以新有效备份为准并显示警告。
- [x] 同目录的手动备份始终保留。
- [x] 同目录其他 Patina 实例的自动备份始终保留。
- [x] 切换 WebDAV 目录后不清理旧目录。
- [x] 切换到本地目标后不触碰 WebDAV 文件。

### 20.4 崩溃注入

- [x] 本地暂存创建前退出。
- [x] 本地暂存创建后、阶段写入前退出。
- [x] 上传开始前退出。
- [x] 上传结束后、`uploaded` 写入前退出。
- [x] 回读验证后、`remote_verified` 写入前退出。
- [x] 索引发布后、`indexed` 写入前退出。
- [x] run 成功后、清理前退出。
- [x] 索引移除旧条目后、远端删除前退出。
- [x] 每个注入点重启两次，结果仍幂等且不丢最后有效备份。

### 20.5 UI 与可访问性

- [x] 一级弹窗尺寸与现有截图一致。
- [x] 两张卡片图标对齐、hover/focus/disabled 状态一致。
- [x] tooltip 在图标上方且不被弹窗裁剪。
- [x] WebDAV 次级弹窗不出现本地目录按钮或假输入框。
- [x] badge 尺寸、标题基线和间距符合 Quiet Pro。
- [x] 键盘可打开两种目标、修改计划、保存、取消并恢复焦点。
- [x] 屏幕阅读器能区分卡片主体“立即备份”和图标“定时备份”。
- [x] 390px 宽度、长路径、长域名、中英文和系统字号放大无横向溢出。
- [x] 没有真实状态时不显示空状态表格。

## 21. 对抗式审查

功能和常规验证全部通过后，由未参与主要实现的人或独立审查轮次执行：

### 21.1 数据安全攻击面

- [x] 设法在新备份成立前触发旧备份删除，确认无法做到。
- [x] 伪造相似文件名、索引条目和 target_generation，确认清理拒绝。
- [x] 在删除检查与实际删除之间替换对象，确认身份不一致时停止。
- [x] 篡改远端索引路径指向目录外对象，确认安全拼接忽略不可信路径。
- [x] 篡改摘要、大小、来源和 run key，确认对象不能进入成功或清理阶段。
- [x] 模拟数据库写失败、磁盘满、Windows 凭据读取失败和系统时间回拨。

### 21.2 并发与竞态

- [x] 手动 WebDAV 上传与自动上传同时发生。
- [x] 自动上传与 WebDAV 配置保存同时发生。
- [x] 自动上传与 replace restore 同时发生。
- [x] 两个 Patina 实例同时更新同一远端索引。
- [x] 用户删除 WebDAV 配置时 run 正在等待网络响应。
- [x] 应用退出后立即重启，旧 runtime 不得继续持有任务。

### 21.3 边界与架构

- [x] `commands/*` 没有 SQL、网络流程或保留策略。
- [x] `app/*` 没有 repository 直连或第二套状态机。
- [x] `engine/*` 没有 SQL、reqwest、文件系统实现或平台凭据。
- [x] `platform/webdav.rs` 没有“保留一份”之类备份业务规则。
- [x] 前端组件没有 invoke、密码、raw DTO 或本地计时器调度。
- [x] 没有为了未来定时导出创建无法证明必要的通用任务框架。

### 21.4 审查退出条件

- [x] 所有 P0/P1 安全问题关闭并新增回归测试。
- [x] P2 问题要么修复，要么有明确 owner、影响与维护者确认，不能静默遗留。
- [x] 重新运行 `npm run check:full` 和 `npm run test:tauri-runtime-smoke`。
- [x] 重新执行两次端到端自动 WebDAV 备份，确认只保留一份最新有效自动备份。
- [x] 审查结论、测试命令和残余风险写回本文。

## 22. 验收标准

- [x] 已配置 WebDAV 时，一级弹窗 WebDAV 卡片出现定时图标，一级弹窗尺寸不变。
- [x] 用户能在次级弹窗设置每日或每周计划并选择 WebDAV 作为唯一自动目标。
- [x] 到期后无需打开设置页或保持前端计时器，Rust 后台完成自动备份。
- [x] 新备份只有在远端回读并通过正式校验、且进入远端索引后才显示成功。
- [x] 任意上传、下载、索引、凭据或校验失败都不会删除上一份有效自动备份。
- [x] 正常连续成功两次后，同一目标只保留一份当前实例拥有的有效自动备份。
- [x] 手动 WebDAV 备份、其他目标和其他实例的备份不被自动清理。
- [x] 重启可以调和所有已定义阶段，不重复同一时隙，不把半成品当成功。
- [x] 密码没有进入数据库、前端、事件、日志或远端索引。
- [x] UI、中英文、本地化、键盘、焦点、缩放和窄窗口验证通过。
- [x] 最低验证、完整验证、真实 Tauri runtime smoke 和对抗式审查全部通过。

## 23. 回滚与禁用策略

- [x] 出现远端完整性或误删风险时，第一处开关是强制把自动计划设为 disabled，不删除已有远端文件。
- [x] 禁用不清空配置、不删除最近有效备份、不清理手动备份。
- [x] 保留手动 WebDAV 上传、列表、下载和恢复能力，便于自动链路关闭时继续取回数据。
- [x] schema 只做前向兼容，不通过降级删除新增列或运行账本。
- [x] 如果索引扩展需要回退，旧 reader 仍能忽略新增可缺省字段并读取条目。
- [x] 回滚后 orphan 清理由维护者审查精确路径后另行处理，不在紧急回滚中批量删除。

## 24. GitHub Project 变更预览

live Project 核对结果：当前没有 WebDAV 自动备份的重复工作项；“支持定时本地备份与安全保留”为 `In progress`，“在数据导出界面支持定时导出”为 `Next`。

本文不修改 Project。若维护者确认新增，建议预览如下：

- 标题：`支持 WebDAV 自动备份与远端安全保留`
- Status：`Blocked`
- Area：`Backup`
- Target release：留空
- 推荐位置：紧跟“支持定时本地备份与安全保留”，排在“在数据导出界面支持定时导出”之前。
- 阻塞原因：复用的定时本地备份调度、账本、恢复锁与对抗式审查尚未在 live Project 中完成。
- 解除阻塞事件：本地定时备份实现、完整验证与对抗式审查完成。
- 解除阻塞后的建议：`Blocked → Next`；定时导出可继续保留 `Next`，近期窗口仍未超过三个。

建议 Project 正文：

### Problem

Patina 已支持手动 WebDAV 备份，但用户必须进入设置页主动触发。现有定时备份只支持本地目录，无法在无人值守时把经过验证的完整 SQLite 快照安全保存到已绑定 WebDAV。直接定时调用现有上传命令也无法证明远端文件可恢复，且缺少“新备份成立后再替换旧备份”的远端保留边界。

### Expected outcome

用户可以把唯一自动备份目标设为 WebDAV。到期后 Patina 在 Rust 后台生成、校验、上传、回读验证并发布一份完整备份；只有新备份成立后才安全清理同一目标中上一份由当前实例拥有的自动备份。手动备份和其他目标不受影响。

### Scope

- 复用每日/每周定时语义和运行账本。
- 新增 WebDAV 自动目标与目标切换。
- 本地生成与校验后上传，远端回读再校验。
- 远端索引兼容、自动/手动来源区分和并发保护。
- 只保留一份最新有效的自动 WebDAV 备份。
- 崩溃调和、有限重试、凭据和删除安全。
- WebDAV 卡片定时图标与固定目标次级弹窗。

### Non-goals

- 不实现本地与 WebDAV 并行计划。
- 不实现多账户、多目录、任意 cron 或增量备份。
- 不删除手动备份或其他实例的备份。
- 不实现云同步或团队能力。
- 不提前实现定时导出的通用调度框架。

### Acceptance criteria

- WebDAV 可作为唯一自动目标保存并按时后台执行。
- 新备份经远端回读正式校验后才成功。
- 新备份失败时上一份有效备份保留。
- 连续成功后只保留一份当前目标的有效自动备份。
- 手动与其他目标备份不被清理。
- 崩溃恢复、凭据安全、UI、本地化和完整质量门槛通过。

## 25. 执行记录

### 实际修改

- 文件：Rust 侧覆盖 `domain/backup_schedule.rs`、`engine/backup_scheduler.rs`、`data/scheduled_backup.rs`、`data/remote_backup.rs`、两个 repository owner、`platform/webdav.rs`、应用 runtime、commands、schema 与 capability；前端覆盖 `SettingsBackupDialog.tsx`、scheduled/remote gateway、目标摘要 service、集中式 `styles/features/settings.css`、中英文 copy 与测试。
- 数据迁移：SQLite schema 升至 11；单一计划新增本地/WebDAV 判别与目标身份，运行账本新增目标种类、远端对象、ETag 和持久化阶段；旧本地配置与运行记录无损迁移，固定保留数量为 1。
- 行为变化：WebDAV 自动备份按“生成完整快照 → 本地校验 → 不覆盖上传 → 远端全量回读 → 正式校验 → 条件发布索引 → 确认成功 → 精确清理旧自动对象”执行。手动备份、其他目标、其他实例和缺少完整所有权证据的对象永不自动删除。
- UI 变化：一级弹窗尺寸与既有文案不变，两张目标卡片只增加同款定时图标；次级弹窗固定显示当前目标、每日/每周与时间、BETA badge 和开关。WebDAV 摘要保留协议，并合并规范化服务器基路径与远端目录，例如 `https://dav.jianguoyun.com/dav/Patina`，不伪装成可编辑输入框。
- 安全边界：移除密码 reveal command、gateway、permission 与生成 schema；密码只从 Windows Credential Manager 读取。WebDAV 路径、重定向、大小、响应体、条件写入与删除均在 platform/data 边界收紧。

### 验证结果

- `npm run check:full`：通过；包含 i18n、类型、ESLint、架构/IPC/hotspot/Quiet Pro/test governance、覆盖率、mutation、81 项真实浏览器 UI smoke、生产构建、bundle、Rust boundary/fmt/check/test/clippy 和依赖审计。
- Rust：577 项，576 通过、1 项按既有约定忽略、0 失败。
- `npm run test:tauri-runtime-smoke`：通过；真实隔离 Tauri/WebView2 进程完成 command/event/SQLite migration 11/capability 验证。
- WebDAV/调度聚焦测试：覆盖不可覆盖上传、HEAD 不支持回退、无 Content-Length 限流、ETag 与无 ETag 索引冲突、失败对象所有权、保留冲突、重启调和、目标切换与手动条目共存。
- 前端：53 项 UI smoke 与 81 项真实浏览器场景通过；本地化首屏资源 24.54 KiB gzip，未放宽 25.4 KiB 且要求 3% 余量的预算。
- `git diff --check`：通过；未留下组件目录 CSS、密码 reveal 引用或测试临时进程。

### 对抗式审查结果

- 审查轮次：实现后进行三轮攻击面复核，覆盖远端对象所有权、并发索引、凭据更新竞态、重启调和、HTTP 边界、日志/IPC 泄漏和 UI/包体积边界。
- 发现：原实现可能把预先存在的同名对象误认作本次创建；失败清理和保留删除在 ETag 缺失或变化时证据不足；无 ETag 索引写入可能在回读时接受丢失未知条目的结果；文本响应可能先整体缓冲再检查上限；部分服务器不支持 HEAD；密码保存后过早唤醒可能形成新密码配旧目标竞态；运行错误和日志可能暴露过多原始上下文。
- 修复与回归测试：上传返回 `created_new` 所有权，只有本次新建且远端校验失败的对象可进入失败清理；删除必须匹配账本 ETag，证据不足时保留对象并警告；无 ETag 更新回读验证所有未改动条目；响应改为分块限流，metadata 支持受限 GET 回退；保存完整配置后再唤醒；日志和用户错误改为有限分类；每项均补充针对性回归测试。
- 残余风险：不同 WebDAV 服务对 ETag/条件请求的支持存在差异。策略固定为证据不足时保留旧对象并显示清理警告，可能暂时多占一份空间，但不会以自动清理换取误删风险；未对用户真实服务器执行会产生远端写入的测试，协议兼容由可控 mock server 与现有手动 WebDAV 链路覆盖。

### 归档结论

- 完成日期：2026-08-09。
- Project 实际状态：`支持 WebDAV 自动备份与远端安全保留` 仍为 `In progress`，遵循仓库规则由维护者手动拖至 `Done`；本地归档不替代 live Project 状态。
- 长期文档回写：`docs/architecture.md` 补充自动备份 owner、安全发布顺序和备份专用调度边界；`CHANGELOG.md` 的 Unreleased 记录用户可感知结果。
- 归档路径：`docs/archive/webdav-automatic-backup-execution-plan.md`。
