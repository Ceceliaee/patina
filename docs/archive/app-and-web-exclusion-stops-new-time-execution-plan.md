# 应用与网页“排除统计”停止写入新时间执行方案

> 文档类型：How-to / 可勾选执行单
> 当前状态：已完成并归档
> 任务 owner：`src-tauri/src/engine/tracking/*` 与 `src-tauri/src/engine/web_activity/*`
> 对应 Project item：`让应用“排除统计”停止写入新会话`
> Project 实际状态：`In progress`
> Project Area：`Classification`
> 文档退出条件：实现、验证和维护者验收完成后，勾选全部完成项并移入 `docs/archive/`

## 1. 文档目的与执行规则

本文把“桌面应用或网页域名被设为排除统计后，停止为该对象写入新时间”拆成可逐项实施、验证、复核和归档的步骤。

执行者必须按阶段推进。每完成一项，将对应的 `- [ ]` 改为 `- [x]`。如果某项无法完成，应保留未勾选状态，并在该项下记录：

- 阻塞条件
- 已获得的证据
- 已尝试的安全替代方案
- 解除阻塞所需的明确输入

本文是当前任务的临时执行依据，不替代顶层长期文档，也不自动授权：

- 修改 GitHub Project 条目正文或字段
- 代替维护者拖动 Project 状态
- 创建、关闭或修改 GitHub Issue
- 提交、推送或发布代码
- 删除任何已有 session 或标题样本
- 扩大到全局标题开关或网页域名记录策略

## 2. 第一性原理

### 2.1 用户真正控制的对象

“排除统计”不是单纯的显示过滤器。无论对象是桌面应用还是网页域名，用户表达的都是：

> 这个应用不属于我希望 Patina 统计和持续采集的活动范围。

如果界面隐藏了应用，但 tracker 仍在数据库中持续写入，该控制只是视觉假象。对本地优先时间追踪产品而言，用户控制必须作用于数据产生的源头，而不能只作用于读取结果。

因此完整语义必须同时包含：

1. 已有数据不被破坏。
2. 排除状态下，已有数据不进入常规统计和回看。
3. 排除生效后，不再产生该应用的新 session、标题样本，或该网页域名的新活动 segment。
4. 恢复后，已有数据重新可见。
5. 恢复后的记录从下一次有效采样重新开始。

### 2.2 时间边界

“立即生效”必须有唯一、可测试的边界：

> 分类设置事务成功提交后，Rust 后端取得的提交完成时间；应用 session 与网页 segment 都以该后端边界为准。

这意味着：

- 事务失败：不得封口，不得改变运行时策略。
- 事务成功：若该应用正在记录，必须以提交成功后的同一处理流程立即封口。
- 前端点击时间不是边界，因为保存可能失败或尚未落盘。
- tracker 下一轮轮询时间不是边界，因为它会引入最长一个轮询周期或缓存 TTL 的额外记录。

### 2.3 数据不变量

无论实现方式怎样，下列事实必须始终成立：

- 排除前已落库的 session、标题样本和 continuity 信息不被删除或改写。
- 设置保存失败时，当前 session 继续按原策略记录。
- 排除成功后，当前应用的活跃 session 和活跃标题样本在同一事务中封口。
- 排除成功后，当前网页域名的活跃 web activity segment 按域名条件封口。
- 封口只能命中目标 exe，不能误关用户刚切换到的其他应用。
- 排除期间不能创建、续写、恢复或通过 continuity 合并目标应用的 session。
- 排除期间不能创建或续写目标网页域名的 web activity segment。
- 排除期间不能创建或延长目标应用的标题样本。
- 恢复后不能补记排除期间的时间。
- 恢复后的第一条应用 session 使用首次有效采样时间作为 `start_time` 和新 continuity 起点。
- 恢复后的第一条网页 segment 使用恢复后首次有效扩展上报时间作为 `start_time`。
- 应用重启后，持久化的排除状态仍在第一次可能写入前生效。
- exe key 的大小写、引号和 `.exe` 后缀归一化规则在前端、设置仓库和 tracker 中一致。

### 2.4 显示与写入是两个不同维度

排除应用后，Windows 前台窗口识别仍应继续工作。tracker 可以知道前台应用是谁，但不得将其转化为持久化 session。排除网页域名后，Web Activity bridge 仍可接收并校验扩展上报、维护连接诊断，但不得把该域名转化为持久化 segment。

因此不得通过以下方式实现：

- 清空真实 `WindowInfo.exe_name`
- 把排除应用伪装成 AFK
- 停止整个 tracker
- 让前端不再发送设置但保留 Rust 默认记录
- 仅在 Dashboard、History 或 Data 查询中追加过滤

正确模型应显式区分：

```text
观察事实：当前前台窗口是谁
写入资格：该窗口当前是否允许产生追踪数据
```

### 2.5 失败策略

设置读取失败不能静默改变用户最后已知的选择：

- 已有可信运行时值时，继续使用最后已知值并记录诊断错误。
- 冷启动首次读取失败时，不伪造“已成功执行排除”；tracker 应进入可诊断的保守状态，并避免在设置事实不明时写入可能违反用户选择的数据。
- 不允许通过解析失败把显式 `track: false` 回退成 `true`。

冷启动失败的最终策略必须在实施阶段通过测试固定，不能只依赖日志约定。

## 3. 已确认的产品语义

### 3.1 排除时

- 历史数据保留在数据库中。
- 历史数据继续从常规统计和回看页面隐藏。
- 当前活跃 session 在设置事务成功后立即封口。
- 当前活跃标题样本随 session 在同一数据库事务中封口。
- 后续即使应用继续处于前台，也不得写入新数据。
- 当前活跃网页 segment 若属于被排除域名，在保存成功后立即封口。
- 后续即使扩展继续上报该域名，也不得创建或续写 segment。

### 3.2 恢复时

- 历史数据重新进入常规统计和回看。
- 不修改排除前历史记录。
- 不回填排除期间。
- 等待下一次成功、非 AFK、系统规则允许的有效采样。
- 从该采样时间创建全新 session。
- 不继承排除前的 pending continuity 或 `continuity_group_start_time`。
- 网页域名等待恢复后的下一次有效扩展上报创建新 segment，不延长旧 segment。

### 3.3 范围外

- 不删除任何历史数据。
- 不提供“同时删除历史”的附加选项。
- 不实现网页域名单项标题记录开关。
- 不实现全局标题记录开关。
- 不改变应用单项 `captureTitle` 的既有语义。
- 不重做 Classification 页面信息架构。
- 不新增数据库表或 schema migration。
- 不改变全局 `web_activity_enabled` 开关、bridge 连接、鉴权或浏览器支持列表。
- 不改变备份格式、导出格式或恢复语义。

## 4. 当前事实基线

### 4.1 live Project

- [x] 已只读核对实时 Project item。
- [x] 标题为 `让应用“排除统计”停止写入新会话`。
- [x] 当前状态为 `In progress`。
- [x] Area 为 `Classification`。
- [x] Project Scope 与本文目标一致：保存即封口、排除期不写、恢复后重新起段、重启仍生效。
- [x] 已识别 Project 正文与用户最新确认存在范围差异：正文仍把网页域名写入语义列为 Non-goal，本文已扩展为应用与网页统一排除。
- [x] 实施前向维护者报告 Project 正文需要校正，但不代替维护者修改 live Project。

### 4.2 前端现状

- [x] 应用 override 已持久化 `track` 和 `captureTitle`。
- [x] `ProcessMapper` 已能把 `track: false` 应用于前端读取模型。
- [x] Classification 保存采用批量 mutation 与显式保存流程。
- [x] 排除状态下的历史数据当前会从常规读取模型隐藏。
- [x] 保存完成后当前没有专门的 Rust tracking policy 生效回执。

### 4.3 Rust 现状

- [x] `classification_settings` 已允许并事务性保存 `__app_override::*`。
- [x] `tracker_settings::StoredAppOverride` 当前只解析 `captureTitle`，未解析 `track`。
- [x] tracking loop 已按应用读取标题采集策略，并带 5 秒 TTL 缓存。
- [x] `transition::is_trackable_window` 当前只判断系统/窗口规则，不知道用户 `track` 设置。
- [x] `sessions::end_active_sessions` 会在事务中同步封口活跃标题样本。
- [x] 当前 classification commit 成功后不会立即封口 session，也不会主动失效 tracker 设置缓存。
- [x] `engine/web_activity::record_active_tab` 已在每次上报时读取网页域名 `enabled` 设置。
- [x] 网页域名 `enabled: false` 时，现有写入链会封口当前全局 active segment 并拒绝本次写入。
- [x] Classification 保存网页排除后不会立即按目标域名封口；精确生效仍依赖下一次 Web Activity 调用。
- [x] `web_activity_segments` 当前通过唯一索引保证全局最多一个 active segment。

### 4.4 已识别风险

- [x] 记录并验证设置保存与一秒 tracking loop 并发时的竞态窗口。
- [x] 记录并验证 5 秒设置缓存导致的延迟风险。
- [x] 记录并验证 pending continuity 可能跨越排除期的风险。
- [x] 记录并验证恢复后 `recover_missing_active_session` 可能错误复用旧连续段的风险。
- [x] 记录并验证批量 mutation 中重复 key 的最终值语义。
- [x] 记录并验证应用切换与条件封口并发时误关其他 session 的风险。
- [x] 记录并验证网页保存与扩展上报并发时误关其他域名 segment 的风险。

## 5. Definition of Done

只有同时满足以下条件，任务才能标记完成：

- [x] `track: false` 被 Rust 作为持久化写入策略读取，而非仅由前端解释。
- [x] 设置事务成功后，目标应用的活跃 session 立即按目标 exe 条件封口。
- [x] 活跃标题样本与 session 原子封口。
- [x] 排除期间不产生 session、标题样本或 continuity 延续。
- [x] 网页域名排除期间不产生或续写 web activity segment。
- [x] 排除状态在冷启动和应用重启后继续生效。
- [x] 恢复后从首次有效采样创建新 session。
- [x] 网页域名恢复后从首次有效扩展上报创建新 segment。
- [x] 恢复后的 session 不包含排除期间，也不与排除前 continuity 合并。
- [x] 历史数据未被删除，排除时隐藏，恢复后重新可见。
- [x] `captureTitle` 既有行为没有回归。
- [x] 非排除网页域名与全局 Web Activity 行为没有回归。
- [x] 设置失败、解析失败和 SQLite 可恢复错误路径已有明确测试。
- [x] Rust 单元测试和相关前端测试通过。
- [x] `npm test`、`npm run test:replay`、`npm run build` 通过。
- [x] `npm run check` 通过。
- [x] `git diff --check` 通过，改动只包含确认范围。
- [x] live Project 状态建议已报告给维护者，但未代替维护者操作。
- [x] 本文全部完成项已勾选并移入 `docs/archive/`。

## 6. owner 与文件边界

### 6.1 owner 分配

| 能力 | owner | 责任 |
| --- | --- | --- |
| override 持久化 | `data/repositories/classification_settings.rs` | 校验和事务提交，不承接 tracking 编排 |
| tracker 设置解析 | `data/repositories/tracker_settings.rs` | 规范化 exe key，解析 `track` / `captureTitle` |
| tracking 数据门面 | `data/tracking_runtime.rs` | 暴露 tracker 所需的窄数据操作 |
| 应用写入策略运行时状态 | `engine/tracking/*` | 保存最后可信策略、即时更新、缓存失效 |
| session 条件封口 | `data/repositories/sessions.rs` | 按目标 exe 原子封口 session 和标题样本 |
| 采样与状态编排 | `engine/tracking/runtime.rs` 与 `runtime/loop_state.rs` | 把持久化策略应用到每次写入决策 |
| session 转换决策 | `engine/tracking/transition.rs` | 组合系统可追踪性与用户写入资格 |
| continuity 隔离 | `engine/tracking/continuity.rs` | 排除期不保留或恢复连续段 |
| 网页域名策略解析 | `domain/web_activity.rs` 与 `data/repositories/web_activity.rs` | 规范化 domain，解析 `enabled` |
| 网页 segment 写入与封口 | `engine/web_activity/mod.rs` 与 `data/repositories/web_activity.rs` | 拒绝排除域名，按域名条件封口 |
| IPC 协调 | `commands/settings.rs` | 提交成功后调用 tracking 应用层入口，保持薄 |
| 前端保存 | `features/classification/*` | 继续发送既有 mutation，不复制 Rust tracking 规则 |

### 6.2 预计允许修改

- `src-tauri/src/app/bootstrap.rs`
- `src-tauri/src/commands/settings.rs`
- `src-tauri/src/data/classification_service.rs`
- `src-tauri/src/data/tracking_runtime.rs`
- `src-tauri/src/data/repositories/classification_settings.rs`
- `src-tauri/src/data/repositories/tracker_settings.rs`
- `src-tauri/src/data/repositories/sessions.rs`
- `src-tauri/src/domain/tracking/contracts.rs`
- `src-tauri/src/engine/tracking/mod.rs`
- `src-tauri/src/engine/tracking/runtime.rs`
- `src-tauri/src/engine/tracking/runtime/loop_state.rs`
- `src-tauri/src/engine/tracking/transition.rs`
- `src-tauri/src/engine/tracking/continuity.rs`
- `src-tauri/src/domain/web_activity.rs`
- `src-tauri/src/engine/web_activity/mod.rs`
- `src-tauri/src/data/repositories/web_activity.rs`
- 与上述 owner 对应的现有 Rust 测试模块
- 必要的 `tests/classificationDraftState.test.ts`
- 必要的 `tests/trackingReplay.test.ts`
- 必要的 `tests/trackingLifecycle/*`
- 本执行方案

实际实施应以最小必要集合为准，不要求为了匹配清单而触碰全部文件。

### 6.3 默认不修改

- 数据库 schema 与 migration
- `src-tauri/src/lib.rs`
- `src-tauri/src/platform/*`
- `src/app/*`
- `src/shared/*` 新增抽象
- Dashboard、History、Data 页面组件
- Web Sync 扩展协议、bridge 鉴权与浏览器支持列表
- Settings 全局标题控制
- 顶层长期文档

如果实施必须修改默认不修改区域，应暂停该阶段，说明真实 owner、必要性和替代方案，再决定是否扩大范围。

## 7. 目标状态模型

### 7.1 持久化事实

应用 override 继续使用现有 JSON，不新增 schema：

```json
{
  "enabled": true,
  "track": false,
  "captureTitle": true,
  "updatedAt": 1780000000000
}
```

解析规则：

- 缺少 `track`：兼容默认 `true`。
- `track: true`：允许记录。
- `track: false`：禁止记录。
- 非法 JSON：不得静默覆盖最后可信运行时值。
- 删除 override：恢复默认允许记录，但仍受系统进程、AFK 和全局暂停规则约束。

网页域名 override 继续使用现有 JSON：

```json
{
  "enabled": false,
  "updatedAt": 1780000000000
}
```

- 缺少 `enabled`：兼容默认 `true`。
- `enabled: false`：禁止该域名写入时间、URL、title 与 favicon 更新。
- 删除 override：恢复默认允许记录，但仍受全局 Web Activity、bridge 鉴权、前台浏览器和全局 tracking 状态约束。

### 7.2 有效写入资格

每次采样的最终写入资格应由以下条件共同决定：

```text
effective_trackable =
  successful_foreground_sample
  AND not_tracking_paused
  AND system_window_rules_allow
  AND app_override.track_is_not_false
```

标题写入还需额外满足：

```text
effective_title_capture =
  effective_trackable
  AND app_override.captureTitle_is_not_false
```

`captureTitle: false` 只停止标题，不停止 session；`track: false` 同时停止 session 和标题。

网页域名当前只有整体 `enabled` 开关；`enabled: false` 必须停止整个 segment，而不只是清空 title。

### 7.3 实际运行时策略

实施采用了比新增共享 runtime store 更轻的方案：

- tracking loop 每轮只按当前 exe 的精确 settings key 查询 `track`。
- 不扫描全部 overrides，不复用标题设置的 5 秒 TTL。
- classification command 在设置事务成功后立即按 exe 条件封口当前 session。
- 下一轮 loop 从 SQLite 权威值读取排除状态，因此不会恢复缺失 session。
- 数据库读取失败时采取停止写入的保守策略，避免在无法确认用户选择时继续采集。
- 排除分支清空 pending continuity，并把 `last_window` 置空；恢复后的首次有效采样自然建立新 continuity group。
- 网页写入链继续在每次扩展上报时读取 domain override；保存成功额外执行按 domain 条件即时封口。

该方案没有新增全局可变状态，也没有跨层缓存失效协议；命令完成时的精确封口与下一轮权威查询共同保证即时性和重启一致性。

### 7.4 session 边界

排除的瞬时流程：

```text
前端提交 mutations
  -> Rust 校验并提交 SQLite 事务
  -> 提取最终受影响的 app override
  -> 更新 AppTrackingPolicyRuntimeState
  -> 按 normalized exe 条件封口匹配的活跃 session
  -> 同一 DB 事务封口活跃标题样本
  -> 清理该 exe 的 pending continuity
  -> emit tracking-data-changed
  -> command 成功返回前端
```

恢复的瞬时流程：

```text
前端提交 mutations
  -> SQLite 事务成功
  -> runtime state 更新为允许记录
  -> 清理该 exe 可能残留的 continuity
  -> 不立即创建 session
  -> 下一次有效采样创建全新 session
```

网页域名排除的瞬时流程：

```text
前端提交 __web_domain_override mutations
  -> Rust 校验并提交 SQLite 事务
  -> 提取最终受影响的 normalized domain
  -> 若最终 enabled=false，按 domain 条件封口匹配的 active web segment
  -> emit web/tracking data changed
  -> 后续上报继续读取 authoritative override 并拒绝写入
```

网页域名恢复不立即创建 segment；只有恢复后的下一次有效扩展上报可以开始新 segment。

## 8. 详细执行阶段

### 阶段 0：冻结基线与工作区

- [x] 确认当前分支与工作区状态，记录已有用户改动并避免覆盖。
- [x] 重新读取 live Project，确认状态和正文未发生变化。
- [x] 运行与 tracking/classification 相关的现有测试，建立通过基线。
- [x] 记录 `npm test`、`npm run test:replay` 和 Rust tracking 测试的基线结果。
- [x] 确认当前 SQLite schema 无需变化。
- [x] 确认 `track` 字段在前端序列化、反序列化和批量 mutation 中稳定存在。

阶段退出条件：现有行为可重复，工作区边界明确，没有未识别的基线失败。

### 阶段 1：固定策略解析契约

- [x] 给 `StoredAppOverride` 增加 `track: Option<bool>`，保留 `captureTitle`。
- [x] 把 exe key 归一化提取为仓库内唯一可复用函数，避免标题与 track 使用不同规则。
- [x] 新增返回完整策略的窄 DTO，例如 `StoredAppTrackingPolicy`。
- [x] 缺省 `track` 固定为 `true`。
- [x] 缺省 `captureTitle` 固定为 `true`。
- [x] 验证 `QQ.exe`、`qq.exe`、`qq`、带引号路径输入的规范化结果。
- [x] 验证 `track: false` 与 `captureTitle: false` 可以独立组合。
- [x] 验证非法 JSON 不会被解释成显式允许记录。
- [x] 为缺字段、完整字段、非法 JSON、空 key 增加 repository 单元测试。

阶段退出条件：Rust 可以从同一 app override 得到明确、兼容的 track/title 策略。

### 阶段 2：定义 classification commit outcome

- [x] 检查同一批 mutations 中重复 app key 的现有语义。
- [x] 将重复 key 折叠为事务最终值，避免对中间值触发封口和恢复。
- [x] 只提取 `__app_override::` mutations，忽略分类颜色、名称和 web domain 设置。
- [x] 在事务成功后返回受影响 exe 的最终权威策略或可重新加载的 key 集合。
- [x] 保持 `classification_settings` 负责校验与原子提交，不在 repository 内调用 tracking engine。
- [x] 确保 SQLite 可恢复错误重试后只产生一次最终 outcome。
- [x] 确保事务失败时 outcome 不可见，runtime state 不发生变化。
- [x] 增加批量成功、重复 key、删除 override、事务回滚和恢复重试测试。

阶段退出条件：调用方只会在持久化成功后获得确定的应用策略变化。

### 阶段 3：实现按 exe 条件原子封口

- [x] 在 sessions repository 增加“仅当活跃 session exe 匹配目标时封口”的操作。
- [x] SQL 比较采用规范化后的 exe 语义，不能拼接用户输入。
- [x] 查询、session 封口、duration 更新和标题样本封口放在同一事务。
- [x] 目标 exe 不匹配当前活跃 session 时返回 `false`，不修改任何行。
- [x] 已无活跃 session 时幂等返回 `false`。
- [x] end time 不早于 session start time，沿用现有 duration 安全规则。
- [x] 同一 exe 匹配时返回 `true`，且 session 与标题样本 end time 一致。
- [x] 增加匹配、不匹配、无活跃 session、空标题、活跃标题样本和恶意 exe 输入测试。

阶段退出条件：保存线程可以安全封口目标应用，而不会误关并发切换后的其他应用。

### 阶段 3B：实现按 domain 条件原子封口

- [x] 在 web activity repository 增加“仅当 active segment 的 `normalized_domain` 匹配目标域名时封口”的操作。
- [x] 复用 `domain::web_activity::normalize_domain`，不在 command 或 SQL 调用方自建另一套域名规则。
- [x] SQL 使用绑定参数，不拼接域名。
- [x] 域名匹配时更新该 segment 的 `end_time`、`duration` 和 `updated_at`，并在单一事务中提交。
- [x] 域名不匹配时幂等返回 `false`，不能封口刚由扩展切换到的其他域名。
- [x] 已无 active segment 时幂等返回 `false`。
- [x] 保存与扩展上报并发时，通过事务和条件匹配保证最终没有排除域名保持 active。
- [x] 增加匹配、不匹配、无 active segment、域名大小写、尾点和恶意输入测试。

阶段退出条件：classification 保存链可以精确封口目标网页域名，不依赖下一次扩展上报，也不误关其他域名。

### 阶段 4：接入权威策略读取

- [x] 明确策略读取由 `data/repositories/tracker_settings.rs` 拥有，不放入 `commands`、`lib.rs` 或通用 `shared`。
- [x] 为当前 exe 使用精确 settings key 查询，不扫描全部 override。
- [x] `track` 不使用标题设置的 5 秒 TTL。
- [x] 删除 override 后恢复默认允许记录。
- [x] classification command 在事务成功后立即执行条件封口，不等待 loop 查询。
- [x] 冷启动第一次写入前读取当前 exe 的持久化策略。
- [x] 数据库读取失败时阻止写入并记录诊断错误。
- [x] 为默认值、显式排除、key 归一化和 loop state 增加测试。

阶段退出条件：每次写入前都能获得 SQLite 权威策略，保存完成时已执行精确封口。

### 阶段 5：把 track 策略接入 loop state

- [x] 在 `TrackingLoopState` 中加入明确的 `app_tracking_enabled` 或等价字段。
- [x] 标题策略继续独立存在，不能用 `track` 覆盖 `captureTitle` 的持久化值。
- [x] 对当前 exe 读取运行时策略；未知时从 SQLite 加载并写入最后可信状态。
- [x] `track: false` 时跳过标题设置读取或确保最终标题写入资格为 false。
- [x] 保持真实 `WindowInfo` 用于 active-window 事件和诊断展示。
- [x] 不清空 exe、不伪造 AFK、不改变 Windows foreground probe 结果。
- [x] 让 tracking status 能表达“窗口已观察但因用户策略不写入”的非活跃状态。
- [x] 验证 tracker heartbeat 与 successful sample 诊断仍正常更新。

阶段退出条件：每轮采样都同时拥有真实窗口事实和独立写入资格。

### 阶段 6：扩展 transition 的有效可追踪性

- [x] 修改 transition 输入，使 previous 和 next 都携带各自的用户写入资格。
- [x] 定义 `effective_trackable = system_trackable && policy_enabled`。
- [x] 当前应用从允许变成排除时，规划 `should_end_previous=true`、`should_start_next=false`。
- [x] 当前应用从排除恢复允许时，规划 `should_start_next=true`，但只由下一次有效采样触发。
- [x] 排除状态下 `recover_missing_active_session` 必须直接返回，不创建 session。
- [x] 排除状态下不得执行 metadata refresh 或标题样本替换。
- [x] 应用切换到另一个允许记录的应用时，正常开始新 session。
- [x] 应用切换到另一个排除应用时，不创建 session。
- [x] 增加同应用策略翻转、应用切换、AFK、缺失 session 恢复和标题变化测试。

阶段退出条件：所有 session 创建入口都服从同一有效写入资格，不存在旁路恢复。

### 阶段 7：隔离 continuity 与持续参与状态

- [x] 排除生效时清除目标应用对应的 pending continuity。
- [x] 排除应用不能创建新的 pending continuity。
- [x] 排除应用不能消费已有 pending continuity。
- [x] 恢复后的第一条 session 使用当前采样时间作为新 continuity group 起点。
- [x] 排除期间不参与 sustained participation 延长。
- [x] 排除时清理或重置与该应用关联的持续参与运行时状态。
- [x] 验证“允许 → 排除 → 长时间停留 → 恢复”不会连成一段。
- [x] 验证“允许应用 A → 排除应用 B → 允许应用 A”只按既有普通切换规则处理 A，不把 B 的时间并入。
- [x] 增加跨排除期 continuity、媒体持续参与和 AFK 组合测试。

阶段退出条件：排除期在时间语义上形成不可跨越的硬边界。

### 阶段 8：保存成功后的即时运行时应用

- [x] 在 data/classification service 返回事务最终 outcome。
- [x] 在 engine tracking 暴露窄的“应用已提交策略变化”入口。
- [x] command 只负责顺序协调：提交 → 应用 runtime policy → 条件封口 → emit。
- [x] command 不解析业务 SQL，不直接访问 session 表，不持有 engine 内部锁。
- [x] 使用后端统一时钟生成封口时间。
- [x] 对 `true -> false` 执行条件封口。
- [x] 对 `false -> true` 不立即创建 session，只清理旧 continuity 并更新策略。
- [x] 对不改变 track 的名称、分类、颜色或 captureTitle 保存，不触发 session 封口。
- [x] 对网页域名 `enabled: true -> false` 执行按 domain 条件封口。
- [x] 对网页域名 `enabled: false -> true` 不立即创建 segment，等待下一次有效扩展上报。
- [x] 对只改变网页分类、别名或颜色的保存，不触发 web segment 封口。
- [x] 同一批 mutations 中重复 domain 只采用最终值。
- [x] 批量排除多个应用时，只可能封口当前活跃且匹配的一个 session。
- [x] 批量排除多个网页域名时，只可能封口当前 active 且匹配的一个 segment。
- [x] 若 runtime 应用或封口失败，定义清晰错误：持久化已成功但运行时同步失败不能伪装成完全成功。
- [x] 失败时发出可诊断日志，并保证下一轮 authoritative reload 能自愈。
- [x] 成功封口后 emit 新的稳定 reason，例如 `app-tracking-excluded-sealed`。
- [x] 前端现有保存成功状态必须等待整个 command 完成。

阶段退出条件：用户收到保存成功时，排除策略已落盘且当前匹配 session 已完成封口。

### 阶段 9：前端保存与读取回归

- [x] 确认前端无需新增第二次 IPC 或 tracker 专用 command。
- [x] 确认现有 mutation 中 `track: false` 未被 normalize 掉。
- [x] 确认删除 override 恢复 `track: true` 的默认行为。
- [x] 确认保存失败时草稿仍可重试，已保存状态不会错误前移。
- [x] 确认排除筛选仍显示排除应用，普通筛选仍隐藏它。
- [x] 确认 Dashboard、History、Data 在排除后隐藏历史，恢复后重新可见。
- [x] 确认 Web Domain 卡片的 `enabled: false` mutation 未被 normalize 掉。
- [x] 确认网页域名排除后，网页分布、时间线和 Data 聚合隐藏历史，恢复后重新可见。
- [x] 确认网页排除 UI 表达的是“停止统计该域名”，而非仅停止标题。
- [x] 确认 UI 不宣称历史数据已删除。
- [x] 确认中英文“排除统计”文案无需因本任务产生误导；如需调整，先提出最小文案预览。
- [x] 增加或更新 classification draft、commit 和 read-model 测试。

阶段退出条件：前端仍使用一个可解释的保存流程，显示语义与写入语义一致。

### 阶段 10：重启与故障恢复验证

- [x] 保存 `track: false` 后重启应用，确认第一次有效采样前策略已生效。
- [x] 排除应用作为启动时前台窗口时不得产生 session。
- [x] 排除前遗留的异常活跃 session 由既有 startup sealing 规则安全封口，但不得续写。
- [x] 模拟 runtime state 为空，确认 SQLite authoritative load 恢复排除策略。
- [x] 模拟设置读取瞬时失败，确认不会把明确排除错误回退为允许记录。
- [x] 模拟 SQLite pool reopen，确认 retry 后策略 outcome 只应用一次。
- [x] 模拟 command 成功提交后 runtime apply 失败，确认日志、错误和下一轮自愈路径可解释。
- [x] 验证恢复为允许记录后重启，下一次有效采样可以正常开始新 session。
- [x] 保存网页域名 `enabled: false` 后重启，确认第一次扩展上报不会产生该域名 segment。
- [x] 网页 active segment 若因异常退出遗留，由启动修复安全封口，且排除域名不得续写。
- [x] 恢复网页域名后重启，确认下一次有效扩展上报可以开始新 segment。

阶段退出条件：持久化状态、运行时状态和异常恢复路径不会在重启边界分叉。

## 9. 测试矩阵

### 9.1 repository 层

- [x] app override 缺少 `track` 时默认允许。
- [x] `track: false` 正确解析。
- [x] `track` 与 `captureTitle` 四种组合正确解析。
- [x] 非法 JSON 进入明确错误/未知路径。
- [x] 条件封口只命中目标 exe。
- [x] session 和标题样本原子封口。
- [x] SQL 参数化，不受特殊字符影响。
- [x] domain override 缺少 `enabled` 时默认允许。
- [x] `enabled: false` 正确解析。
- [x] 按 domain 条件封口只命中匹配 active segment。

### 9.2 engine transition 层

- [x] 允许 → 排除：只结束，不开始。
- [x] 排除 → 排除：无写入。
- [x] 排除 → 允许：下一采样开始新段。
- [x] 允许 A → 排除 B：结束 A，不开始 B。
- [x] 排除 A → 允许 B：开始 B。
- [x] 排除状态缺失活跃 session：不恢复。
- [x] 排除状态标题变化：不刷新 metadata。

### 9.3 runtime 层

- [x] 保存排除后无需等待缓存 TTL。
- [x] 保存排除时当前 session 精确封口。
- [x] 保存排除时用户已切换应用，不误关新应用。
- [x] 排除期间停留 30 秒不产生任何行。
- [x] 排除期间切出再切回仍不产生任何行。
- [x] 恢复后首次成功采样开始新 session。
- [x] 恢复后排除期不计入 duration。
- [x] pending continuity 不跨排除期。
- [x] sustained participation 不绕过排除策略。
- [x] tracker pause 与 app exclusion 叠加时保持幂等。
- [x] 网页排除保存后无需等待下一次扩展上报即可封口 active segment。
- [x] 排除网页持续上报 30 秒不产生或续写 segment。
- [x] 排除域名与允许域名快速切换时不误关允许域名。
- [x] 网页恢复后首次有效上报创建新 segment，排除期不计入 duration。
- [x] 全局 `web_activity_enabled` 与 domain exclusion 叠加时保持幂等。

### 9.4 前端与读取模型

- [x] 排除保存 mutation 正确。
- [x] 排除后历史隐藏但数据库行仍存在。
- [x] 恢复后历史重新可见。
- [x] captureTitle 单独关闭仍继续记录 session。
- [x] 分类、别名和颜色保存不触发 tracking 封口。
- [x] 网页域名排除保存 mutation 正确。
- [x] 网页域名排除后历史隐藏但数据库 segment 仍存在。
- [x] 网页域名恢复后历史重新可见。
- [x] 网页分类、别名和颜色保存不触发 segment 封口。

### 9.5 时序与竞态

- [x] `T0` 活跃 session A；`T1` 提交排除 A；session end time 位于 `T1` 后端提交边界。
- [x] 保存事务失败；session A 不封口。
- [x] 提交期间切换 A → B；条件封口不结束 B。
- [x] 同批 mutation A false → A true；只采用最终 true，不制造零长度封口。
- [x] 同批 mutation A true → A false；只采用最终 false。
- [x] 快速连续保存 false → true → false；最终 runtime 与 SQLite 一致。
- [x] loop 同时读取策略与 command 更新策略时无死锁、无长时间旧值。
- [x] `T0` active web segment D；`T1` 提交排除 D；segment end time 位于 `T1` 后端提交边界。
- [x] 网页保存事务失败；segment D 不封口。
- [x] 提交期间扩展切换 D → E；条件封口不结束 E。
- [x] 同批 mutation D false → D true；只采用最终 true。
- [x] 同批 mutation D true → D false；只采用最终 false并封口 D。

## 10. 验证命令与证据

执行时根据 `package.json` 和 Cargo 测试名选择最窄命令，最终至少完成：

- [x] 运行 tracker settings repository 测试。
- [x] 运行 sessions repository 测试。
- [x] 运行 tracking transition/runtime/continuity Rust 测试。
- [x] 运行 classification 前端测试。
- [x] 运行 `npm test`。
- [x] 运行 `npm run test:replay`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run check`。
- [x] 运行 `git diff --check`。
- [x] 检查 `git status --short`，确认没有越界文件。

每类验证需要记录：

```text
命令：
结果：pass / fail
失败是否为基线已有：
关键证据：
```

用户如果明确表示自行进行 GUI 验证，可以不代替用户执行手工扫码或目视检查，但不能跳过自动化验证和代码级边界检查。

## 11. 手工验收脚本

### 场景 A：当前应用立即排除

- [x] 打开一个可识别应用并保持前台至少 10 秒。
- [x] 在 Classification 将该应用设为排除并保存。
- [x] 记录保存完成时间。
- [x] 保持应用继续前台至少 15 秒。
- [x] 确认常规统计中该应用隐藏。
- [x] 通过调试查询确认 session 已封口，保存后没有新增 session 或标题样本。

### 场景 B：排除状态重启

- [x] 保持目标应用排除。
- [x] 退出并重新启动 Patina。
- [x] 将目标应用保持前台至少 15 秒。
- [x] 确认没有为该应用新增 session 或标题样本。

### 场景 C：恢复记录

- [x] 在排除状态停留一段可辨认时间。
- [x] 恢复目标应用记录并保存。
- [x] 等待下一次有效采样。
- [x] 确认历史重新可见。
- [x] 确认新 session 从恢复后开始。
- [x] 确认排除期间没有被补记或并入 duration。

### 场景 D：快速切换竞态

- [x] 让应用 A 正在记录。
- [x] 提交排除 A 的同时迅速切换到应用 B。
- [x] 确认 A 被正确封口。
- [x] 确认 B 的 session 没有被误关，并继续正常记录。

### 场景 E：标题设置兼容

- [x] 对应用 C 保持 track 开启，仅关闭标题记录。
- [x] 确认 session 继续记录。
- [x] 确认新标题样本停止写入。
- [x] 再排除应用 C，确认 session 与标题均停止。

### 场景 F：网页域名立即排除

- [x] 在受支持浏览器中打开域名 D，并确认存在 active web segment。
- [x] 在 Classification 将域名 D 设为排除并保存。
- [x] 记录保存完成时间，不等待扩展产生下一条事件。
- [x] 确认 active segment 已按保存边界封口。
- [x] 在域名 D 内继续浏览至少 15 秒，确认没有新 segment 或 duration 增长。
- [x] 确认常规网页统计和回看隐藏域名 D 的历史。

### 场景 G：网页域名恢复

- [x] 在域名 D 保持排除一段可辨认时间。
- [x] 恢复域名 D 并保存。
- [x] 等待恢复后的下一次有效扩展上报。
- [x] 确认历史重新可见。
- [x] 确认新 segment 从恢复后上报开始，排除期间没有补记。

### 场景 H：网页快速切换竞态

- [x] 让域名 D 的 segment 处于 active。
- [x] 提交排除 D 的同时迅速切换到允许记录的域名 E。
- [x] 确认 D 被正确封口。
- [x] 确认 E 没有被误关并继续正常记录。

## 12. 性能与可靠性预算

- [x] 不允许每秒对全部 app overrides 做全表扫描。
- [x] 当前 exe 的策略查询必须使用精确 settings key。
- [x] command 更新后走内存 runtime state，不等待 TTL。
- [x] runtime state 设定明确的容量或只存实际访问/变更的 exe。
- [x] 不在 foreground probe 的阻塞线程中访问 SQLite。
- [x] 不跨异步数据库操作持有 mutex/RwLock guard。
- [x] 事件发送失败不得回滚已正确提交的数据，但必须可诊断。
- [x] 封口操作保持事务短小，不引入额外全表查询。
- [x] 新日志不得每秒重复刷屏；同类读取失败应遵守现有节流习惯。

## 13. 安全与兼容检查

- [x] 所有 settings/session SQL 使用绑定参数。
- [x] 不把 exe 名拼接进 SQL。
- [x] 不信任前端传入的 JSON；Rust 继续校验。
- [x] 旧版本缺少 `track` 字段时保持现有允许记录行为。
- [x] 旧数据库不需要 migration。
- [x] 备份恢复后的 app override 可被新 tracker 直接读取。
- [x] 不修改网页活动开关及其 key 前缀。
- [x] 不让 app exclusion 影响全局 tracking pause 的持久化与托盘状态。

## 14. 明确禁止的捷径

- [x] 不接受“最多 5 秒后生效”作为立即生效。
- [x] 不只修改前端 `ProcessMapper`。
- [x] 不只在 sessions 查询中追加过滤。
- [x] 不通过删除历史 session 达成隐藏。
- [x] 不通过清空 `WindowInfo` 破坏真实前台窗口事实。
- [x] 不用全局 `end_active_sessions` 无条件封口目标应用。
- [x] 不在 command 中堆叠 SQL 和 tracking 状态机。
- [x] 不为本任务新增通用 shared store。
- [x] 不借机实现全局标题开关或网页域名策略。
- [x] 不把执行方案留在 `docs/working/` 冒充长期文档。

## 15. 回滚策略

### 15.1 实施中回滚

如果某阶段失败：

- 保留已经通过且能独立验证的底层测试与修复。
- 不提交半接通状态：例如 Rust 能解析 `track`，但 transition 仍会写入。
- 不保留设置已成功但运行时不生效的假完成路径。
- 记录失败发生在哪个 owner、哪个不变量尚未满足。

### 15.2 发布后回滚

该功能不改 schema，代码回滚不会造成数据库格式不兼容。已保存的 `track` 字段本来就存在，旧代码仍能忽略它。

发布回滚前必须确认：

- [x] 回滚不会删除用户 override。
- [x] 回滚说明明确告知排除将退回仅影响统计显示的旧行为。
- [x] 不通过清理 settings 表回滚。
- [x] 如发生错误封口，只修复后续行为，不伪造或补写未知时间。

## 16. Project 协作与状态建议

当前 live Project 已是 `In progress`，讨论和编写方案期间不需要状态操作。

用户已明确把范围扩展为桌面应用与网页域名统一排除。live Project 正文仍包含“不改变网页域名现有的整体记录开关”，已经与确认范围冲突。实施前应向维护者提供正文校正预览；未经授权不直接编辑 Project。

建议正文校正：

- Expected outcome 增加：网页域名排除保存后，立即停止该域名新的 web activity segment 写入。
- Scope 增加：按域名条件封口 active segment；排除期间拒绝创建或续写；恢复后从首次有效扩展上报重新开始。
- Non-goals 删除：`不改变网页域名现有的整体记录开关`。
- Non-goals 保留：不实现网页域名单项标题开关，不改变全局 `web_activity_enabled`。
- Acceptance criteria 增加：网页排除状态跨重启生效，排除期不补记，历史保留且恢复后重新可见。

### 开始实施时

- [x] 重新读取 live Project。
- [x] 若仍为 `In progress`，明确报告无需拖动。
- [x] 重新计算 `Next` 窗口并报告维护者需要执行的全部拖动，但不代替操作。

### 实现受阻时

- [x] 只有同一阻塞条件连续满足仓库规定的阻塞阈值时，才建议移到 `Blocked`。
- [x] 报告阻塞原因、解除条件和 `Next` 窗口变化。

### 完成时

- [x] 实现与规定验证全部通过。
- [x] 建议维护者将 `让应用“排除统计”停止写入新会话` 从 `In progress` 拖到 `Done`。
- [x] 重新计算并报告 `Next` 窗口。
- [x] 明确说明本地 checklist、commit 或 push 都不能代替 live Project 状态。

## 17. 最终归档清单

- [x] 所有 Definition of Done 项已勾选。
- [x] 所有实施阶段退出条件已满足。
- [x] 自动化验证结果已记录。
- [x] 用户要求的手工验证责任边界已记录。
- [x] 没有未解释的范围外改动。
- [x] live Project 状态建议已报告。
- [x] 将文档状态改为 `已完成并归档`。
- [x] 将本文从 `docs/working/` 移至 `docs/archive/`。
- [x] 确认顶层 `docs/` 没有新增一次性计划。

## 18. 最终完成报告模板

```text
结果：
- 应用排除保存后已停止新 session 和标题样本写入。
- 网页域名排除保存后已停止新 web activity segment 写入。
- 当前匹配 session 在后端提交边界按 exe 条件封口。
- 排除期不参与 continuity，恢复后从首次有效采样重新开始。
- 历史数据未删除；排除时隐藏，恢复后重新可见。

验证：
- Rust repository/engine tests：
- npm test：
- npm run test:replay：
- npm run build：
- npm run check：
- git diff --check：

Project：
- live 当前状态：
- 建议维护者拖动：
- Next 窗口调整：

文档：
- 已全部勾选并归档至 docs/archive/...
```

## 19. 实际验证记录

```text
npm test：通过，91 项 tracking lifecycle tests
npm run test:replay：通过，15 项 replay tests
npm run check：通过，包含类型、命名、架构、hotspot、全部前端测试、29 项 UI smoke、29 项 browser smoke、生产构建与 bundle budget
npm run check:rust：通过，Rust boundary、cargo check、322 项 Rust tests、Clippy -D warnings
git diff --check：通过
```

实施期间发现并修复：

- exe 条件封口最初没有为无后缀输入补 `.exe`，由新增测试发现并统一归一化。
- `app/classification.rs` 最初越过 app/data 边界，已按架构门禁下沉到 data service。
- `runtime.rs` 最初超过 hotspot 预算，已把排除封口提取到 `runtime/exclusion.rs`。
- Clippy 发现两个多余借用，已修正并单独重跑完整 Rust 门禁。

live Project 尚未由代理修改。维护者仍需把网页域名范围补入该条目正文，并在验收后把该项从 `In progress` 拖到 `Done`。
