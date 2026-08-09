# 定时本地备份详细执行方案

> 文档类型：一次性执行方案（How-to）<br>
> 状态：已完成并归档<br>
> 最后更新：2026-08-09<br>
> Project item：`支持定时本地备份与安全保留`<br>
> 功能所有者：Backup（Rust：`domain / engine / data`；前端：`features/settings`）<br>
> 适用范围：Patina Windows 桌面端的定时本地 SQLite v2 快照<br>
> 完成后归档：`docs/archive/`

## 0. 如何使用本方案

> 归档勾选说明：本文件归档时，`[x]` 表示该条已经实施、验证，或已经在最终复核中明确判定为未触发/不适用。第 12 节停止边界的勾选表示“已复核且未触发”；第 13 节回滚项的勾选表示“处置规则已确认”，不表示在用户数据上执行过破坏性回滚。涉及磁盘耗尽、物理睡眠和真实时区切换的条目由等价状态机/故障路径测试与代码审查覆盖，不声称在用户机器上实施破坏性环境演练。

本文件是“定时本地备份与安全保留”的临时实施依据。它把产品约束、领域不变量、UI 契约、数据模型、运行时行为、测试矩阵和交付门槛放在同一份可勾选清单中，使维护者或后续 Codex 可以从上到下直接执行。

长期规则仍以这些文档为准：

- [产品原则与范围](../product-principles-and-scope.md)
- [路线图与优先级](../roadmap-and-prioritization.md)
- [工程质量](../engineering-quality.md)
- [Quiet Pro 组件规范](../quiet-pro-component-guidelines.md)
- [架构](../architecture.md)
- [稳定期问题修复边界](../issue-fix-boundary-guardrails.md)
- [版本与发布策略](../versioning-and-release-policy.md)
- [本地化](../localization.md)

执行规则：

- [x] 实施开始前重新读取 live GitHub Project，确认该 item 的实时状态、唯一 `In progress` 和最新 `Next` 窗口。
- [x] 维护者明确开始实施后，告知维护者把 `支持定时本地备份与安全保留` 从当前状态拖到 `In progress`；同时按实时顺序报告全部 `Next` 补位建议。
- [x] 开始改动前记录 `git status --short`，区分本任务改动与用户已经存在的改动；不得覆盖当前 Settings、Data 或文档中的无关工作。
- [x] 只在功能、测试或验证证据真实完成后勾选对应条目；“已写代码”不等于“已完成”。
- [x] 每个阶段结束时执行该阶段的退出检查；命中停止边界时暂停并重新确认，不静默扩大范围。
- [x] 当前任务按第 4.2 节 UI 完成功能、基本可用性和无障碍验收；任务完成后再单独讨论和调整 UI，不让后续 UI 优化阻止本任务结束。
- [x] 实现偏离本文时，在第 14 节记录原因、影响、替代方案和验证结果。
- [x] 未经用户明确要求，不创建分支、不提交、不推送、不打标签、不发布，也不修改 GitHub Project 或 Issue。
- [x] 功能交付并不再依赖本方案后，把本文件整体移动到 `docs/archive/`。

---

## 1. 一句话结果与验收口径

用户可以从统一的“备份”弹窗启用一个低打扰的本地备份计划；Patina 到期后生成一份可独立恢复的完整 SQLite v2 快照，并且只在新快照成功、验证通过、原子发布并记录成功后，将同一目标代次中更旧的定时备份安全删除，最终只保留最新一份有效备份。

完成后的最低事实必须同时成立：

- [x] 定时备份是“备份”的内置能力，只存在于“备份”弹窗内，不成为 Settings 中与“备份/恢复”同级的新卡片或新设置行。
- [x] Settings 主卡片不展示定时状态；主入口只负责打开统一“备份”弹窗。
- [x] 每次运行都生成一份完整、独立、可单独恢复的 v2 SQLite 快照，不生成增量链、不覆盖上一份、不合并多个备份。
- [x] 保留规则固定为最新 `1` 份有效定时备份，不向用户暴露保留数量配置。
- [x] 最近一份备份包含“该时刻数据库的完整状态”，但不包含前面备份文件本身。
- [x] 手动本地备份、WebDAV 备份、用户文件、未知文件、其他目标代次的定时备份永远不参与本计划的自动清理。
- [x] 新备份失败时不删除任何旧备份；新备份成功但清理失败时保留额外文件并显示清理警告，不把有效新备份改判为失败。
- [x] 应用重启、睡眠恢复、错过执行时间、目标目录变更和同名文件冲突均有确定且可测试的行为。
- [x] 定时备份失败可见，但不会停止、暂停或破坏正常时间追踪。

---

## 2. 第一性原理

### 2.1 备份的本质是“可恢复状态”，不是“复制动作”

一个文件只有同时满足以下条件，才算成功备份：

```text
一致的数据库快照
  + 完整的 v2 容器与 manifest
  + 校验和验证通过
  + 当前版本确认可恢复
  + 原子发布到最终路径
= 可用备份
```

因此，调度器不能把“文件已经开始写”“临时文件存在”或“命令没有立刻报错”当作成功。

- [x] 继续复用现有 `VACUUM INTO`、数据库校验、manifest、checksums、可恢复性检查和原子发布链路。
- [x] 成功状态只能在最终文件发布完成后写入运行记录。
- [x] 单元测试和集成测试必须验证生成物可以被现有预览/恢复读取，而不只检查文件存在。

### 2.2 调度只是触发方式，不能发明第二种备份格式

手动本地备份、WebDAV 上传前的本地快照和定时本地备份，底层都应调用同一条 v2 快照能力。定时备份新增的是：

```text
何时执行 + 写到哪里 + 如何去重 + 如何保留 + 如何报告状态
```

它不新增：

```text
新的备份内容格式 + 新的恢复格式 + 增量算法 + 备份合并算法
```

- [x] 快照生成仍由 `data/backup/*` 拥有。
- [x] 调度器只能提交一份不可变的运行规格，不复制 v2 archive 实现。
- [x] 恢复时的 `merge / replace` 继续是“如何把单份备份恢复进数据库”的策略，不得与“多个备份如何共存”混为一谈。

### 2.3 每份备份都是独立恢复点，不形成依赖链

设三个执行时刻分别为 `t1 / t2 / t3`：

```text
S1 = 完整数据库状态 DB(t1)
S2 = 完整数据库状态 DB(t2)
S3 = 完整数据库状态 DB(t3)
```

`S3` 通常包含从 `t1` 延续到 `t3` 且尚未删除的数据，但不内嵌 `S1.zip` 或 `S2.zip`。当前策略在 `S3` 验证成功后删除同一目标代次的 `S1` 和 `S2`，因此只提供最新恢复点，不提供多时间点回溯。

- [x] 固定只保留最新 `1` 份验证有效的定时快照。
- [x] 新快照失败时继续保留原有最新有效快照。
- [x] 新快照与原有快照互不依赖，清理旧快照不影响新快照独立预览和恢复。
- [x] UI 不展示保留数量和清理策略说明，减少低价值配置。

### 2.4 保留策略首先是一项删除权限系统

自动创建文件是可逆行为，自动删除文件不是。删除前必须证明 Patina 同时知道：

1. 这个逻辑执行记录由当前定时备份计划创建；
2. 记录中的最终路径是当前目标代次目录的直接子文件；
3. 文件名与该运行记录的派生规则一致；
4. 当前文件摘要与成功时记录的摘要一致；
5. 当前文件确实是可解析的 Patina v2 快照；
6. 新备份已经成功，且候选不是当前最新一份有效备份。

任何一项无法证明时，选择“保留并警告”，不能猜测后删除。

- [x] 清理只能消费数据库中状态为成功、文件状态为存在的精确运行记录，禁止扫描目录后按通配符批量删除。
- [x] 删除只使用精确绝对路径和单文件删除，禁止递归删除。
- [x] 目标目录中名称相似但没有运行记录的文件保持不变。
- [x] 摘要变化、路径越界、符号链接/重解析异常或解析失败时跳过该文件并记录清理警告。

### 2.5 可靠调度必须是持久化状态机，不是内存计时器

单纯 `sleep(24h)` 无法正确处理应用退出、系统睡眠、时区变化、配置修改、重复启动和进程崩溃。正确模型是：

```text
持久化配置
  → 根据当前本地日历计算最近逻辑时隙
  → 原子认领唯一 run key
  → 执行并持久化结果
  → 重启后从记录恢复
```

- [x] 内存定时器只负责“何时醒来检查”，不负责保存事实。
- [x] 同一个逻辑时隙具有唯一 `run key`，成功后永远不重复生成。
- [x] 运行中的重复请求被拒绝或等待，不创建第二个文件。
- [x] 失败的同一时隙可以按有界退避重试。
- [x] 重启后的补跑最多执行最近一个已错过时隙，不补齐历史队列。

### 2.6 文件系统副作用必须晚于数据库认领，数据库成功必须晚于文件发布

正常时序固定为：

```text
事务认领 run key
  → 生成并验证临时快照
  → 无覆盖地原子发布最终文件
  → 计算最终 archive 摘要
  → 事务记录成功
  → 按保留策略清理旧文件
  → 记录清理结果并通知 UI
```

这使得崩溃恢复可以根据“运行记录 + 最终文件”判定下一步，而不是依赖猜测。

- [x] 生成快照期间不得长时间持有 SQLite 写事务。
- [x] 成功记录失败但最终文件已经存在时，启动恢复会验证并补记成功，不再生成第二份。
- [x] 认领成功但最终文件不存在时，启动恢复把旧的 `running` 状态收敛为可重试失败。

### 2.7 低打扰不等于不可见

正常运行不弹系统通知、不抢焦点、不打开窗口；但用户主动打开“定时备份”次级弹窗时，必须能看到下一次执行、最近成功、最近失败和清理警告。

- [x] 后台成功只更新持久化状态和已打开弹窗，不发操作系统通知。
- [x] 后台失败不影响追踪主链，不弹阻塞对话框。
- [x] 错误在统一备份弹窗中可见，并使用可执行、非泄密的说明。

---

## 3. 已确认决策与实施前默认项

### 3.1 已由维护者确认的决策

- [x] 只实施定时本地备份，不把定时导出混入本方案。
- [x] 定时备份属于备份弹窗内部能力，不与备份同级。
- [x] Settings 主卡片不展示“定时备份：已启用/未启用”。
- [x] 点击备份入口始终打开统一“备份”弹窗。
- [x] 一级弹窗保持既有大小和备份位置选择，只在“本地备份”卡片增加定时入口图标；定时配置与状态放在由该入口打开的次级弹窗内。
- [x] 当前弹窗结构作为本任务的实施基线；本任务完成功能和基本 UI 验收后可以结束，后续再单独调整 UI。
- [x] 定时备份只写本地目录，不调度 WebDAV 上传。
- [x] 多次备份采用“追加独立完整快照 + 滚动保留”，不覆盖、不合并。
- [x] 固定只保留最新一份验证有效的定时备份。
- [x] 新快照成功后才清理旧快照。
- [x] 旧配置中曾保存的保留数量不再影响运行；在下一次成功定时备份后按固定单份规则收敛。
- [x] 目标目录变更时不清理旧目录，新的目录使用新的所有权代次。
- [x] 同名未知文件不能被覆盖；同一已归属运行的重试只有在能证明是自己的输出时才允许原子替换。
- [x] 应用错过计划时间后只补跑一次，不生成积压队列。

### 3.2 本方案采用的默认项

以下项目未在前序讨论中逐项确认。为使执行单没有实现歧义，本方案给出保守默认值；正式写代码前由维护者确认或修改：

- [x] 频率只提供“每天”和“每周”，不支持每月、自定义间隔或 cron 表达式。
- [x] 默认频率为“每天”。
- [x] 默认本地时间为 `02:00`；切换到“每周”时额外显示星期选择，默认当前星期。
- [x] 默认目录为 Patina 当前数据根下既有的 `backups` 目录，用户可通过系统目录选择器修改。
- [x] 自动重试采用同一逻辑时隙最多 3 次：首次失败后约 5 分钟、第二次失败后约 30 分钟；繁忙等待不计失败次数。
- [x] 替换恢复后保留配置草稿但强制暂停定时计划、清空运行态并生成新目标代次；合并恢复保持当前机器的定时计划不变。
- [x] 当前范围不增加系统通知、托盘状态、单独的备份历史页或“立即重试”按钮。

如果任一默认项需要改变，应先修改本文相关契约和测试矩阵，再开始实现。

---

## 4. 产品与 UI 契约

### 4.1 Settings 主界面

现有“备份与恢复”区域保持当前层级。允许的唯一入口变化是把备份按钮文案明确为 `备份…`，表示会打开后续弹窗。

```text
┌ 备份与恢复 ─────────────────────────────────┐
│ 创建完整数据备份，或从备份文件恢复。          │
│                              [备份…] [恢复…] │
└─────────────────────────────────────────────┘
```

- [x] 不新增“定时备份”Settings 行、子卡片、徽章或状态摘要。
- [x] 不改变恢复入口、WebDAV 配置面板和其他数据安全设置的层级。
- [x] 入口具备 `default / hover / active / focus-visible / disabled / loading` 状态。

### 4.2 “备份”一级弹窗与“定时备份”次级弹窗

一级弹窗继续只承担备份位置选择，保持既有大小、标题、说明和卡片结构；唯一变化是在“本地备份”卡片右侧增加 `CalendarClock` 定时入口。定时备份是本地备份的扩展能力，因此入口不出现在 WebDAV 卡片上。点击图标后打开次级弹窗，配置和状态不再撑大一级弹窗。

```text
┌ 选择备份位置 ──────────────────────────────── × ┐
│ 选择保存到本地文件，或上传到已绑定的 WebDAV。   │
│ [本地备份                         定时入口图标] │
│ [WebDAV 备份                                  ] │
└───────────────────────────────────────────────┘

                    点击定时入口
                           ↓

┌ 定时备份 [BETA] ────────────────────── [开关] ┐
│ [频率：每天 ▾]             [时间：02:00]      │
│ 保存到     [C:\…\Patina\backups] [更改目录]  │
│                                                │
│ 下次：明天 02:00 │ 最近成功：08-09 · 18.4 MB │ 最近失败：无 │
│                                   [取消] [保存] │
└────────────────────────────────────────────────┘
```

- [x] 一级弹窗保持既有 `600px` 宽度，不出现定时配置或加载占位，只增加本地定时入口图标。
- [x] 次级弹窗标题右侧复用共享 Quiet Pro `BETA` badge，标明该自动化能力仍处于试验阶段。
- [x] `handleBackupAction` 始终打开统一弹窗；即使 WebDAV 未配置，也不能直接跳过弹窗打开文件选择器。
- [x] “备份到本地…”继续使用保存文件选择器，并调用现有手动 v2 备份流程。
- [x] “备份到 WebDAV”只在既有 WebDAV 配置可用时呈现或启用，不改变 WebDAV 的现有语义。
- [x] 定时备份开关、频率、时间、星期和目录在次级弹窗内以草稿方式编辑。
- [x] 关闭或取消次级弹窗丢弃未保存的定时设置草稿，但不影响已经触发的手动备份。
- [x] `保存设置` 只在草稿有效且发生变化时启用；成功后使用 Rust 返回的规范化快照覆盖草稿。
- [x] 关闭开关时配置字段继续可见，保持最后值，但使用 Quiet Pro 的 disabled/paused 层级表达不会执行。
- [x] 选择“每周”时只额外显示星期字段；切回“每天”时不显示星期字段。
- [x] 定时入口只位于“本地备份”卡片，不能让用户误以为会调度 WebDAV 上传。
- [x] 不添加装饰性插画、渐变、嵌套卡片、状态 pill 堆叠或新的一次性视觉语言。

### 4.3 字段与校验

| 字段 | 值域 | 默认值 | 保存校验 | 运行中修改 |
| --- | --- | --- | --- | --- |
| 启用 | 开/关 | 关 | 开启时目录必须有效 | 已认领运行使用旧快照，新配置用于后续运行 |
| 频率 | 每天/每周 | 每天 | 必须为枚举值 | 修改后以保存时刻为新锚点，不补跑旧规则 |
| 星期 | 周一至周日 | 当前星期 | 仅每周必填 | 同上 |
| 时间 | `00:00`–`23:59` | `02:00` | 转为 `0..1439` 分钟整数 | 同上 |
| 保存目录 | 绝对目录 | Patina `backups` | 规范化、可创建/可访问 | 生成新目标代次；旧目录不清理 |
- [x] 保留规则不是用户配置字段，由调度器固定为最新一份有效备份。
- [x] 路径字段默认只读，通过原生目录选择器选择，避免手输非法路径。
- [x] 保存前由前端做即时格式校验，Rust 再执行同一不变量校验；前端校验不是安全边界。
- [x] Rust 返回规范化路径，不信任前端提供的路径形式。

### 4.4 可见状态

定时备份次级弹窗打开时通过 command 获取一次权威快照；次级弹窗保持打开期间，通过低频 `scheduled-backup-snapshot-changed` 事件接收状态变化。事件丢失不影响事实，下次 command 读取必须恢复正确状态。

| 状态 | UI 表达 | 操作行为 |
| --- | --- | --- |
| 未启用 | “定时备份已暂停” | 配置保留，可编辑并保存 |
| 等待 | 显示下次计划时间 | 可修改设置 |
| 等待重试 | 显示下次重试时间和最近失败 | 可修改设置；不弹阻塞错误 |
| 正在备份 | 中性进度状态 | 手动备份按钮显示繁忙或等待；设置仍可编辑 |
| 最近成功 | 时间、文件名、大小 | 不使用庆祝性视觉 |
| 清理警告 | “备份已完成，但有旧文件未能清理” | 保留额外文件，展示安全说明 |
| 最近失败 | 失败时间和可执行原因 | 追踪功能保持正常 |
| 目录不可用 | 明确指出目录不可访问 | 不清理旧文件，后续按退避重试 |

- [x] 最近成功与最近失败可以同时存在，避免一次新成功抹去历史故障线索。
- [x] 错误文案映射稳定错误码，不直接把任意底层错误、凭据或内部 SQL 暴露给 UI。
- [x] 文件路径可在用户主动打开弹窗时显示，但不能写入遥测或远端状态。
- [x] 状态更新不触发全 Settings 页重载或无关数据刷新。

### 4.5 无障碍与响应式

- [x] 弹窗标题通过 `aria-labelledby` 关联，说明文字通过 `aria-describedby` 关联。
- [x] 开关具有包含“定时备份”的可访问名称，不能只读出“开/关”。
- [x] 频率、星期、时间和目录都有持久可见标签，不依赖 placeholder。
- [x] 状态变化区域使用克制的 `aria-live="polite"`；运行中的重复 tick 不重复播报。
- [x] 所有交互支持键盘、清晰 `focus-visible`、Esc 关闭和既有焦点回收。
- [x] 在现有 Settings 断点、100%/125% Windows 缩放、中文和英文长文案下不横向溢出。
- [x] 窄宽度时字段行按既有 Quiet Pro 规则纵向排列，不缩小点击区域。

---

## 5. 领域模型与运行契约

### 5.1 配置模型

Rust 领域类型建议为：

```text
ScheduledBackupConfig
  enabled: bool
  cadence: Daily | Weekly
  weekday: Option<Monday..Sunday>
  local_time_minutes: 0..1439
  target_dir: absolute normalized path
  target_generation: opaque stable id
  schedule_anchor_at_ms: when this schedule became eligible
  updated_at_ms
```

领域不变量：

- [x] `Daily` 时 `weekday = None`；`Weekly` 时必须有合法星期。
- [x] 未启用时允许暂存目录和其他配置，但不会生成逻辑时隙。
- [x] 初次启用、重新启用、修改频率/星期/时间时重置 `schedule_anchor_at_ms`，首次执行只能发生在保存之后的下一个时隙。
- [x] 保留数量不属于领域配置或 IPC 契约，不参与计划锚点判断。
- [x] 规范化后的目标目录发生变化时生成新的随机 `target_generation`；原代次永远不被新代次清理。
- [x] 关闭再开启时保留目标代次，但重置计划锚点，避免把暂停期间解释为积压。

### 5.2 逻辑时隙与 run key

逻辑时隙使用用户当前本地日历，而不是“距离上次运行满 24 小时”：

```text
Daily:  本地日期 + 配置分钟
Weekly: 最近一个配置星期的本地日期 + 配置分钟
```

建议 run key：

```text
scheduled-local-backup:<target-generation>:<YYYY-MM-DD>:<HHmm>
```

- [x] run key 的构造函数只存在一处，并有稳定快照测试。
- [x] 同一时区回拨导致同一墙上时间出现两次时，共用同一 run key，因此只执行一次。
- [x] 夏令时跳过配置分钟时，当天第一个晚于配置时间的 tick 将该时隙视为到期，不永久漏跑。
- [x] 系统时间或时区变化后重新按本地日历计算；已成功 run key 仍保持幂等。
- [x] 文件名使用逻辑到期时间，而 manifest 的创建时间保持实际执行时间。

### 5.3 文件命名与冲突

建议基础文件名：

```text
Patina-scheduled-backup-YYYYMMDD-HHmm-<generation前8位>.zip
```

如果基础名称已被未知文件占用，依次尝试 `-02` 至 `-99` 后缀；每次最终发布仍必须使用“不覆盖”语义。

- [x] 不使用仅到秒的当前时间作为幂等依据。
- [x] 不覆盖未知同名文件。
- [x] 数据库先记录本次运行保留的精确目标路径，再开始生成文件。
- [x] 发布时若目标刚被其他进程占用，返回冲突并选择下一个候选，不依赖“先 exists 再 rename”的竞态检查。
- [x] 只有启动恢复确认“该 run 记录已经预留该路径，文件是可恢复 v2 快照”时，才可把崩溃后留下的文件认领为本次成功输出。

### 5.4 运行状态机

```text
未到期/已暂停
      │
      ├─ 到期且操作槽空闲 ─→ running
      │                        │
      │                        ├─ 快照失败 ─→ retry_wait / failed
      │                        │
      │                        └─ 发布并记录成功 ─→ succeeded
      │                                               │
      │                                               └─ retention cleanup
      │                                                    ├─ 全部成功 → clean
      │                                                    └─ 部分失败 → warning
      └─ 操作槽繁忙 ─→ 保持待执行，短时再次检查（不计失败）
```

状态规则：

- [x] 认领使用单个 SQLite 事务和唯一约束，不采用“先查再插”的非原子流程。
- [x] `running` 记录包含开始时间、尝试次数、目标代次和精确目标路径。
- [x] 快照成功与失败都在短事务中提交，文件 IO 期间不持有事务。
- [x] `succeeded` 与文件状态分离；旧文件被清理后仍保留成功历史，但 `file_state = pruned`。
- [x] 清理失败只写 `cleanup_warning`，不把 `succeeded` 回滚成 `failed`。
- [x] 运行历史元数据有界保留，例如保留最近 32 个终态记录；仍需用于证明现存文件归属的记录不得先删除。

### 5.5 错过执行与重试

- [x] 应用启动、系统恢复和计划配置保存后立即唤醒调度检查。
- [x] 如果多个历史时隙都已错过，只选择当前规则下最近的一个合格时隙。
- [x] 计划锚点之前的时隙永远不补跑，因此下午首次启用 `02:00` 不会立刻补当天凌晨。
- [x] 第一次实际失败后约 5 分钟重试；第二次失败后约 30 分钟重试；同一时隙最多 3 次自动尝试。
- [x] 备份操作槽繁忙、应用正在恢复数据库或 SQLite pool 暂不可用时使用短暂等待，不消耗失败次数。
- [x] 同一时隙达到重试上限后保持最近失败可见，等待下一个正常时隙，不进行无限紧循环。
- [x] 下一时隙到期后创建新的 run key，不复用上一时隙的失败文件名。

### 5.6 共享备份操作槽与 SQLite 协调

新增一个由 `data/backup/*` 拥有的快照生成互斥槽，统一覆盖：

- 手动本地快照；
- WebDAV 上传前的本地临时快照；
- 定时本地快照。

同时，快照生成需要与现有 SQLite maintenance guard 协调，避免恢复/存储切换期间更换 pool。

- [x] 三条快照路径最终进入同一个受保护的 v2 writer。
- [x] 锁顺序固定并写入注释/测试，避免 backup lock、remote transfer lock、SQLite maintenance lock 反向获取。
- [x] 快照互斥只覆盖本地快照生成与发布，不无谓覆盖整个 WebDAV 网络上传时间。
- [x] 正常追踪写入不获取备份互斥槽，定时备份不能暂停追踪。
- [x] 调度器优先使用非阻塞/可取消等待；应用退出时不因后台锁无限挂起。

### 5.7 安全保留算法

每次定时快照成功后执行：

1. 重新读取这次运行认领时的目标代次；
2. 查询该代次 `status = succeeded AND file_state = present` 的记录；
3. 按逻辑时隙、成功时间和 run key 稳定降序；
4. 固定保留最新 `1` 条；
5. 对超出的每条执行归属证明；
6. 对证明通过的精确文件执行单文件删除；
7. 更新 `file_state = pruned`；
8. 对失败项保留 `present/conflict` 并聚合清理警告。

归属证明：

- [x] 记录代次等于当前清理代次。
- [x] 路径规范化后父目录严格等于该代次目标目录，且文件是直接子项。
- [x] 文件名严格等于记录中的最终文件名，不通过 glob 推断。
- [x] 文件存在时，其大小和 SHA-256 与成功记录一致。
- [x] 文件可以通过现有 v2 archive 轻量验证。
- [x] 删除前再次读取文件 metadata；如果在验证后发生变化则跳过。
- [x] 文件已被用户手动删除时标记 `missing`，不把它当作运行失败。
- [x] 任何一个旧文件无法清理时继续尝试其他可证明文件，但最终记录 warning。
- [x] 新文件写入或成功记录失败时完全不进入保留清理。

### 5.8 目录变更与恢复后的规则

- [x] 修改目录会创建新的 `target_generation` 和计划锚点。
- [x] 新目录的保留计数从零开始；旧目录文件和旧代次记录不参与新目录清理。
- [x] UI 在目录变化保存后提示“旧目录中的备份不会自动清理”。
- [x] snapshot `replace` 恢复后保留恢复出的字段供用户查看，但强制 `enabled = false`、清空瞬时运行态、生成新代次并要求用户重新确认目录后启用。
- [x] snapshot `merge` 和 legacy merge 不导入其他机器/其他时间点的定时运行记录，保持当前机器配置。
- [x] 恢复后的协调由 `app/backup.rs` 薄调用调度恢复入口完成，不能把调度业务写回 command。
- [x] 恢复后没有任何自动删除动作；只有用户重新启用且新快照成功后，新代次才开始保留清理。

---

## 6. SQLite 持久化契约

### 6.1 为什么需要专用表

配置本身可以塞入通用 `settings` 键值表，但原子 run claim、唯一时隙、失败重试、文件归属和清理状态需要关系约束与事务。因此使用专用表，不把多个 JSON blob 当作调度事实。

- [x] 新增 inline migration 版本 `10`，描述使用稳定名称，例如 `create_scheduled_backup_tables`。
- [x] 更新 `VALIDATED_SCHEMA_MIGRATION_HEAD` 和所有 schema upgrade/fingerprint 测试。
- [x] 所有 SQL 使用参数绑定；路径、错误和 run key 不拼接进 SQL 字符串。
- [x] 配置保存、run claim、终态写入和清理状态更新分别使用最小事务。

### 6.2 建议表结构

实现时可按 sqlx/SQLite 语法微调，但约束语义不得弱化：

```sql
CREATE TABLE IF NOT EXISTS scheduled_backup_config (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    cadence TEXT NOT NULL CHECK (cadence IN ('daily', 'weekly')),
    weekday INTEGER CHECK (weekday BETWEEN 1 AND 7),
    local_time_minutes INTEGER NOT NULL CHECK (local_time_minutes BETWEEN 0 AND 1439),
    target_dir TEXT NOT NULL,
    retention_count INTEGER NOT NULL CHECK (retention_count IN (1, 3, 7)), -- 兼容旧库；新代码固定写 1
    target_generation TEXT NOT NULL,
    schedule_anchor_at_ms INTEGER,
    updated_at_ms INTEGER NOT NULL,
    CHECK (
        (cadence = 'daily' AND weekday IS NULL)
        OR (cadence = 'weekly' AND weekday IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS scheduled_backup_runs (
    run_key TEXT PRIMARY KEY,
    target_generation TEXT NOT NULL,
    logical_date TEXT NOT NULL,
    logical_time_minutes INTEGER NOT NULL CHECK (logical_time_minutes BETWEEN 0 AND 1439),
    target_path TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('running', 'retry_wait', 'succeeded', 'failed')),
    file_state TEXT NOT NULL CHECK (file_state IN ('absent', 'present', 'pruned', 'missing', 'conflict')),
    attempt_count INTEGER NOT NULL CHECK (attempt_count >= 1),
    next_retry_at_ms INTEGER,
    started_at_ms INTEGER NOT NULL,
    completed_at_ms INTEGER,
    archive_sha256 TEXT,
    archive_size_bytes INTEGER,
    error_code TEXT,
    error_message TEXT,
    cleanup_warning TEXT,
    updated_at_ms INTEGER NOT NULL,
    UNIQUE (target_generation, logical_date, logical_time_minutes)
);

CREATE INDEX IF NOT EXISTS idx_scheduled_backup_runs_retention
ON scheduled_backup_runs(target_generation, status, file_state, logical_date DESC, logical_time_minutes DESC);
```

实现检查：

- [x] migration 的 `retention_count` 列作为已发布存储兼容面保留；领域模型与 IPC 不再暴露该字段，repository 固定写入 `1`，读取旧值时忽略。
- [x] migration 插入或读取时合成一条 disabled 默认配置：每天、02:00、固定保留最新 1 份、默认备份目录。
- [x] `error_message` 存储经过归一化且有长度上限的用户安全信息；完整底层 cause 只进入本地日志。
- [x] `archive_sha256` 使用最终 zip 文件摘要，不复用 manifest 内数据库文件摘要。
- [x] 目标路径保存规范化绝对路径；读取后仍重新验证，不能把数据库内容当作天然可信。
- [x] 运行表不使用外键级联删除配置，避免配置更新误删归属证据。
- [x] 终态历史压缩只删除已无现存文件归属责任的旧记录。

### 6.3 v2 snapshot manifest/counts 兼容

完整 SQLite 快照会自然包含新增表，但现有 `SnapshotCounts` 也应认识这两个表，以便当前 schema 的生成后验证发现遗漏。

- [x] 给内部 `SnapshotCounts` 增加 `scheduled_backup_config` 和 `scheduled_backup_runs` 计数，并保留 `#[serde(default)]` 向后兼容。
- [x] 新字段只作为可选/默认字段扩展现有 `PatinaSQLiteSnapshot-1` manifest，不新建 v3 格式。
- [x] 旧 migration head 的 v2 快照仍可预览并由当前迁移链升级。
- [x] 当前 migration head 的快照在 round-trip 测试中验证两张表计数一致。
- [x] 公开 `BackupPreview` 无 UI 需要时不增加噪声字段；如增加则同步前端 parser 和本地化。

---

## 7. 架构与文件所有权

### 7.1 目标依赖关系

```text
features/settings
  → platform/backup typed gateway
  → commands/backup.rs
  → app/scheduled_backup.rs（组合、wake、事件）
  → engine/backup_scheduler（时隙、状态机、重试、端口）
      ↘ data/repositories/scheduled_backup.rs（SQLite）
      ↘ data/backup/scheduled.rs（v2 快照、文件归属、保留）
          → data/backup/snapshot.rs
```

边界要求：

- [x] `domain` 拥有稳定配置、时隙、状态与错误码语义。
- [x] `engine` 拥有调度状态机、到期判断、补跑、重试和端口契约，不直接写 SQL 或调用原始文件系统 API。
- [x] `data` 拥有 sqlx、migration、快照、路径、摘要和删除实现。
- [x] `app` 只组合 engine 端口、管理 wake state、注册启动恢复和向 main window 发低频事件。
- [x] `commands` 只做 DTO、caller guard 和转发。
- [x] 前端 feature 不直接读写 SQLite，不复制调度算法。

### 7.2 预计新增/修改文件

| 文件/区域 | 动作 | 职责 |
| --- | --- | --- |
| `src-tauri/src/domain/backup_schedule.rs` | 新增 | 配置、时隙、状态、错误码与不变量 |
| `src-tauri/src/engine/backup_scheduler/mod.rs` | 新增 | 调度端口、到期决策、状态机 |
| `src-tauri/src/engine/backup_scheduler/runtime.rs` | 新增 | tick、wake、重试与启动恢复 |
| `src-tauri/src/data/repositories/scheduled_backup.rs` | 新增 | 配置/运行记录事务与查询 |
| `src-tauri/src/data/backup/scheduled.rs` | 新增 | 定时文件名、无覆盖发布、摘要、归属与保留 |
| `src-tauri/src/data/backup/snapshot.rs` | 修改 | 抽出发布策略、扩展当前 schema counts；保留现有 v2 路径 |
| `src-tauri/src/data/backup.rs` | 修改 | 共享快照操作槽和受控 writer 入口 |
| `src-tauri/src/data/schema.rs` | 修改 | migration 10 与 schema 列表 |
| `src-tauri/src/data/sqlite_pool.rs` 及 upgrade tests | 修改 | migration head 与升级验证 |
| `src-tauri/src/app/scheduled_backup.rs` | 新增 | 端口组合、快照查询/保存、恢复后协调、事件 |
| `src-tauri/src/app/runtime_tasks.rs` / `runtime.rs` | 修改 | 管理并启动可恢复调度 runtime |
| `src-tauri/src/commands/backup.rs` | 修改 | 新 typed commands 和 main-window guard |
| `src-tauri/src/app/bootstrap.rs` | 修改 | invoke handler 注册 |
| `src-tauri/build.rs` | 修改 | application command manifest |
| `src-tauri/permissions/window-commands.toml` | 修改 | main-only 精确 allowlist |
| `src/platform/backup/scheduledBackupRuntimeGateway.ts` | 新增 | IPC DTO parser、commands、event listener |
| `src/features/settings/services/settingsBackupDialogState.ts` | 新增 | 纯前端草稿/校验/状态映射 |
| `src/features/settings/components/SettingsBackupDialog.tsx` | 新增 | 统一备份弹窗 |
| `src/features/settings/components/SettingsDataSafetyPanel.tsx` | 修改 | 保留主卡片层级，接入统一弹窗 |
| `src/styles/features/settings.css` | 修改 | 只增加 token 化布局和状态样式 |
| `locales/{zh-CN,en-US}/backup.ts`、`locales/schema.ts` | 修改 | 文案契约 |
| `tests/settingsBackupDialogState.test.ts` | 新增 | 草稿、校验、状态映射 |
| `tests/uiBrowserSmoke/settingsScenarios.ts` | 修改 | 统一弹窗交互 |
| `tests/uiSmoke.test.ts` / `tests/i18nContract.test.ts` | 修改 | 静态与本地化契约 |
| `tests/tauriRuntimeSmoke.test.ts` | 修改 | command/permission/runtime denial matrix |
| `CHANGELOG.md` | 修改 | `Unreleased / Added` 用户可见能力 |

- [x] 实施前用 `rg` 再核对真实 owner 与热点；表中的文件名可因现有结构微调，但不能把职责塞进 `SettingsDataSafetyPanel.tsx`、`commands/backup.rs`、`app/runtime.rs` 或 `lib.rs`。
- [x] 若需要新增共享 UI 原语，先证明该原语至少有稳定的多处消费；否则留在 Settings feature。

### 7.3 Engine 数据端口

调度器应通过显式端口隔离数据实现，至少包含：

```text
ScheduledBackupStore
  load_config()
  save_config(validated_config)
  load_runtime_snapshot()
  claim_run(run_spec)
  mark_run_retry(...)
  mark_run_success(...)
  mark_run_failure(...)
  list_retention_candidates(generation)
  update_file_state(...)

ScheduledBackupExecutor
  reserve_target(...)
  create_verified_snapshot(...)
  inspect_owned_output(...)
  cleanup_owned_candidates(...)
```

- [x] trait future 与错误类型沿用仓库现有 engine port 风格。
- [x] engine 测试使用内存 fake store/executor，不要求真实 Tauri app。
- [x] data adapter 测试单独验证 SQL 与文件系统行为。

### 7.4 IPC 契约

建议新增 request-response commands：

```text
cmd_get_scheduled_backup_snapshot
cmd_pick_scheduled_backup_directory
cmd_save_scheduled_backup_config
```

以及低频 Rust → main window 事件：

```text
scheduled-backup-snapshot-changed
```

- [x] 读取、目录选择和保存使用 command，因为调用方需要结果/错误确认。
- [x] 后台状态变化使用 event，因为它是低频通知；事件不是事实来源，弹窗打开时仍 command 拉取。
- [x] 保存 command 返回完整规范化 snapshot，并同步 wake runtime。
- [x] 目录选择与保存 command 使用真实 `WebviewWindow` label 的 main-window caller guard。
- [x] 三个 command 同步加入 `app/bootstrap.rs`、`build.rs`、`window-commands.toml`，且只进入 main permission set。
- [x] Widget capability 不获得这些 commands。
- [x] 前端对所有 `unknown` IPC payload 做运行时结构校验，拒绝非法枚举、NaN、越界数字和错误路径类型。
- [x] 不使用 channel；该功能没有高频流式进度需求。

---

## 8. 分阶段执行清单

### 阶段 0：启动门禁与基线

- [x] 确认第 3.2 节全部默认项，或先修改本文。
- [x] 读取 live Project；报告实际状态与维护者需要执行的状态拖动，不代替维护者修改。
- [x] 记录当前工作树和用户已有改动；特别保护 Settings、locales、styles、tests 中的重叠文件。
- [x] 运行或记录当前相关基线：`npm run test:settings`、`npm run test:ui-smoke`、`cargo test --manifest-path src-tauri/Cargo.toml --locked backup`（按真实过滤器调整）。
- [x] 打开当前 Settings 备份/恢复与 WebDAV 流程，保存实施前截图或浏览器 smoke 证据。
- [x] 确认现有 v2 手动备份可以生成、预览并恢复，避免在未知损坏的基线上叠加调度。

退出条件：

- [x] 产品默认项已确认。
- [x] live Project 协作指令已报告。
- [x] 基线失败已区分为既有问题或本任务问题。

### 阶段 1：先建立纯领域契约与失败测试

- [x] 新建 `domain/backup_schedule.rs`，先写枚举、值对象和构造校验测试。
- [x] 为固定保留最新 `1` 份写领域与 repository 测试。
- [x] 为 daily/weekly 时隙计算写表驱动测试：到期前、正好到期、到期后、跨日、跨周。
- [x] 为计划锚点写测试：首次启用不补锚点之前、重新启用不补暂停期间。
- [x] 为夏令时跳过分钟和重复分钟写逻辑日期/run key 测试。
- [x] 为只补最近一个时隙写测试，输入多个错过日期只返回最新一个。
- [x] 为 run key 和计划文件名写稳定性/非法输入测试。
- [x] 为状态转换写测试：claim、busy、success、retry、terminal failure、cleanup warning。
- [x] 证明测试先失败，再实现最小领域代码使其通过；在执行记录中写下测试命令和结果。

退出条件：

- [x] 领域层不依赖 Tauri、sqlx、React 或原始文件系统。
- [x] 所有时间和固定单份保留不变量有确定测试。

### 阶段 2：新增 migration 与 repository

- [x] 在 `data/schema.rs` 增加 migration 10 常量、SQL 和 migration list 项。
- [x] 建立两张表、约束和 retention 索引；使用 `IF NOT EXISTS` 仅保证初始化幂等，不弱化 sqlx checksum。
- [x] 更新当前 migration head、预期 fingerprint 和 SQLite upgrade tests。
- [x] 新建 scheduled backup repository，实现默认配置读取和参数化保存。
- [x] 配置保存放在事务中，先读取旧配置并按字段差异决定锚点/代次是否变化。
- [x] 用安全随机 id 生成目标代次，不从路径明文派生可碰撞 id。
- [x] 实现原子 run claim；用唯一约束处理并发，而不是吞掉冲突。
- [x] 实现 success/failure/retry/file-state 更新，并检查受影响行数，防止静默更新错误 run。
- [x] 实现最新状态和 retention candidate 查询，排序带稳定 tie-breaker。
- [x] 实现有界历史压缩，但禁止删除仍指向 `present/conflict` 文件的记录。
- [x] 写 repository 测试：默认值、非法约束、配置差异、并发 claim、重试、排序和压缩。
- [x] 写 baseline DB → migration 10 的升级测试，确认既有设置和活动数据不变。

退出条件：

- [x] migration 10 在新库和升级库均通过。
- [x] 没有动态拼接用户路径或错误文本的 SQL。
- [x] 原子 claim 并发测试只能产生一个拥有者。

### 阶段 3：收口共享 v2 快照 writer 与互斥槽

- [x] 在 `data/backup.rs` 建立共享快照生成互斥槽，并写锁顺序说明。
- [x] 让手动本地备份、WebDAV 临时快照和未来定时快照都经过同一 writer 入口。
- [x] 与 SQLite maintenance guard 协调，确保 restore/pool replacement 与 snapshot 不并发切换数据库。
- [x] 将 `snapshot.rs` 原子发布改为显式策略：现有手动路径保持既有覆盖语义；定时路径使用 `CreateNew`/无覆盖语义。
- [x] Windows 无覆盖发布直接依赖原子 API 的“目标存在即失败”保证，不使用先检查后替换。
- [x] 保留现有临时目录私有化、完整校验和清理行为。
- [x] 生成最终 zip 后提供 archive SHA-256 和大小读取能力。
- [x] 扩展 `SnapshotCounts`，验证 schedule tables round-trip。
- [x] 写测试证明未知目标不会被覆盖，已授权替换仍为原子行为。
- [x] 写并发测试证明两次快照生成串行，而追踪写入仍可完成。
- [x] 回归 WebDAV 临时文件清理和手动保存文件流程。

退出条件：

- [x] 没有第二份 v2 writer。
- [x] 现有手动/WebDAV 行为无回归。
- [x] 无覆盖发布的竞态由底层 API 保证。

### 阶段 4：实现定时输出与安全保留

- [x] 新建 `data/backup/scheduled.rs`，实现候选文件名生成和后缀冲突分配。
- [x] 路径只接受规范化绝对目录，最终文件必须是该目录直接子项。
- [x] 先由 repository 记录精确保留路径，再调用无覆盖 v2 writer。
- [x] 写入后重新轻量预览并计算最终 archive 摘要/大小。
- [x] 成功记录提交失败时保留文件，供启动恢复认领，不主动覆盖或删除。
- [x] 实现 retention candidate 的六项归属证明。
- [x] 删除只调用精确单文件删除；失败聚合为 warning。
- [x] 实现缺失文件、摘要变化、非法路径、其他代次和未知文件的保留行为。
- [x] 实现目录变更后旧代次完全隔离。
- [x] 旧库保留数量仅作兼容存储，下一次成功运行后固定按单份规则清理。
- [x] 限制一次清理的候选数和摘要工作量，避免异常 ledger 造成无界启动 IO。

必须先写的测试：

- [x] 第二次成功后只保留最新一份。
- [x] 新快照失败：旧文件数量不变。
- [x] 清理删除失败：新文件成功、目录暂有 2 份、状态为 cleanup warning。
- [x] 手动 `Patina-backup-*.zip`、任意 txt、相似文件名和子目录全部不变。
- [x] 其他 generation 的定时文件不变。
- [x] 用户改写过的旧文件摘要不符，不删除并告警。
- [x] 旧文件已手动删除时标记 missing，不报整次备份失败。
- [x] 基础同名文件存在时选择后缀且原文件字节不变。
- [x] 每一份保留下来的快照在删除其他快照后仍可独立预览。

退出条件：

- [x] 任何自动删除都有可复查归属证据。
- [x] 模拟故障不会造成旧备份损失。

### 阶段 5：实现调度 engine 与 runtime

- [x] 定义 `ScheduledBackupStore` 和 `ScheduledBackupExecutor` 端口。
- [x] 实现单次 tick：读取配置、计算最近时隙、判断 claim/retry、执行、清理、生成 snapshot。
- [x] 实现启动恢复：扫描有限 `running` 记录并验证最终文件。
- [x] 有效最终文件补记 success；缺失/无效文件收敛为 retry_wait/failed；冲突文件保持不动。
- [x] 实现有界 5 分钟/30 分钟退避和 3 次上限。
- [x] busy 不计 attempt；runtime 在短间隔后再检查。
- [x] runtime 空闲时最长每 60 秒重新评估本地日历；同时支持 `Notify` 即时唤醒。
- [x] 配置保存、应用启动、系统恢复和恢复数据库后发送 wake。
- [x] runtime loop 发生错误时采用有上限 backoff 并继续自愈，不退出后永久失效。
- [x] 运行完成后生成一次状态变化通知，不按秒发送事件。
- [x] 应用退出时后台 future 可结束，不阻塞主进程。

Engine fake tests：

- [x] disabled 永不调用 executor。
- [x] 到期只 claim/execute 一次。
- [x] 两个并发 tick 只有一个执行者。
- [x] 错过 14 个日时隙只执行最近一个，而不是 14 次。
- [x] 成功重复 tick 直接跳过。
- [x] running 重复 tick 不执行。
- [x] failed 在退避到期前不执行，到期后重试同一 run key。
- [x] 达到上限后等待下一逻辑时隙。
- [x] cleanup warning 仍产出 succeeded snapshot。
- [x] schedule 修改以新 anchor 生效，不补旧规则。

退出条件：

- [x] runtime 可从任意持久化状态幂等恢复。
- [x] 没有依赖前端窗口常驻才能执行的逻辑。

### 阶段 6：Tauri 组合、commands 与权限

- [x] 新建 `app/scheduled_backup.rs`，组合真实 store/executor，暴露 get/save/reconcile/wake 薄入口。
- [x] 在 app setup 中 manage wake/runtime state，并只启动一个 scheduler loop。
- [x] 在 `runtime_tasks.rs` 加入与现有自愈模式一致的 scheduler restart wrapper，避免把业务逻辑写进 runtime 总装配。
- [x] 新增 get snapshot、pick directory、save config commands。
- [x] 所有有副作用 command 执行 main-window caller guard。
- [x] 在 `app/bootstrap.rs` 注册 handler。
- [x] 在 `src-tauri/build.rs` 的 manifest 注册三个 commands。
- [x] 在 `window-commands.toml` 只加入 `main-window-commands`。
- [x] 不修改 Widget permission/capability。
- [x] 发事件时仅定向 main window；窗口不存在时后台运行仍成功。
- [x] command 错误转换为稳定错误码/安全消息。
- [x] 为 IPC checker 和 runtime smoke 增加 allow/deny 断言。

退出条件：

- [x] `check:ipc-contracts` 通过。
- [x] main window 可调用，Widget 被真实 runtime 拒绝。
- [x] 关闭主窗口但应用驻留时计划仍能执行。

### 阶段 7：前端 typed gateway 与状态服务

- [x] 新建 `scheduledBackupRuntimeGateway.ts`，定义 raw DTO 与产品类型。
- [x] parser 对配置、枚举、时间、运行状态、路径和可选结果做完整校验，并丢弃已退役的保留字段。
- [x] 暴露 get snapshot、pick directory、save config 和 listen changed 四个窄函数。
- [x] event payload 非法时忽略并记录本地 warning；不污染当前 UI 状态。
- [x] 新建纯 `settingsBackupDialogState.ts`，负责草稿初始化、dirty 判断、字段校验和状态展示模型。
- [x] 纯状态服务不调用 `invoke`、不依赖 DOM，便于 Node 单测。
- [x] 保存成功以后使用服务端返回快照，不假设前端草稿就是最终规范值。
- [x] 弹窗卸载时可靠 unlisten，避免重复监听。

测试：

- [x] raw DTO 正常映射。
- [x] 非法 cadence/weekday/NaN/负时间被拒绝；旧 retention 字段不会进入产品类型。
- [x] disabled 草稿保留值。
- [x] 目录变化提示旧目录不清理。
- [x] event 晚到不会覆盖更新版本的 command snapshot（使用 revision 或 updatedAt 判断）。

退出条件：

- [x] feature 组件不直接写 IPC 字符串。
- [x] 所有跨 IPC 数据都有 runtime parser。

### 阶段 8：实现统一备份弹窗 UI

本阶段以第 4 节当前线框为实施基线，只要求功能完整、层级正确、状态可辨识并满足 Quiet Pro 与无障碍底线；长期 UI 优化不属于本任务的完成门槛。

- [x] 从 `SettingsDataSafetyPanel.tsx` 抽出 `SettingsBackupDialog.tsx`，避免继续放大热点组件。
- [x] 主卡片备份按钮改为始终打开统一弹窗。
- [x] 迁移现有本地/WebDAV 立即备份选择，不改变备份产物和 toast 语义。
- [x] 实现定时开关、频率、每周星期、QuietTimePicker 和目录选择。
- [x] 复用 `QuietDialog`、`QuietButton`、`QuietSwitch`、`QuietSelect`、`QuietTimePicker` 和既有 action row/subpanel 原语。
- [x] 不新增 page-local 色值、阴影、圆角、边框或动效；缺少语义角色时先扩展 token。
- [x] 实现 loading、empty/first-use、paused、waiting、running、retry、success、warning、failure 状态。
- [x] 手动备份与后台定时快照竞争操作槽时显示可理解的繁忙反馈，不让用户重复提交。
- [x] 后台事件只更新弹窗局部状态。
- [x] 取消关闭丢弃未保存草稿；保存期间按钮 loading 且防双击。
- [x] WebDAV 未配置、已配置、测试失败等现有路径全部回归。
- [x] 不在 Settings 主卡片显示定时状态。

浏览器 smoke 场景：

- [x] 点击 `备份…` 总是先出现统一弹窗。
- [x] 未配置 WebDAV 时可以手动本地备份并看到定时区。
- [x] 已配置 WebDAV 时两个立即备份动作可辨识。
- [x] 切换每日/每周时星期字段正确出现/消失。
- [x] UI 不出现保留数量控件或清理策略小字。
- [x] 关闭开关后字段可见但处于 paused 语义。
- [x] 修改目录后出现旧目录不自动清理说明。
- [x] 保存失败保留草稿并显示错误；关闭重开从服务端事实恢复。
- [x] Esc、Tab 顺序、焦点回收、中文/英文和窄宽度通过。

退出条件：

- [x] UI 层级符合“备份包含定时备份”的心智模型。
- [x] 所有功能状态均可操作、可辨识，并符合本文最终确认的 Quiet Pro 与无障碍契约。

### 阶段 9：本地化、错误与文档记录

- [x] 在 `locales/schema.ts` 定义所有新键，不在组件中硬编码中文或英文。
- [x] 在 `zh-CN/backup.ts` 与 `en-US/backup.ts` 补齐字段、状态、错误、帮助和目录变更文案。
- [x] 运行 i18n generate/check，确认 generated contract/resources 同步。
- [x] 错误码至少覆盖：目录无效、无权限、空间不足、同名冲突、快照失败、校验失败、数据库暂不可用、清理部分失败、payload 非法。
- [x] 用户文案不泄露 SQL、调用栈、WebDAV 凭据或内部临时路径。
- [x] 在 `CHANGELOG.md` 的 `Unreleased / Added` 记录“可配置的定时本地完整备份与安全保留”。
- [x] 不在长期顶层文档重复本执行步骤；只有长期规则确实改变时才更新相应母文档。

退出条件：

- [x] `npm run check:i18n` 通过。
- [x] 中英文错误均可执行且不泄密。

### 阶段 10：恢复、崩溃与外部环境验证

- [x] 在 `app/backup.rs` 的恢复后协调中加入 scheduler reconcile/wake 薄调用。
- [x] snapshot replace 按第 5.8 节暂停并重置计划，merge 保持当前机器计划。
- [x] 模拟崩溃点：claim 后、临时快照中、原子发布后、成功记录前、成功记录后、清理中。
- [x] 每个崩溃点重启后都收敛为一份成功文件、可重试失败或安全警告，不产生不可解释重复文件。
- [x] 模拟应用在到期前退出、到期后启动，只补最近一次。
- [x] 模拟 Windows 睡眠跨过到期时间，恢复后只执行一次。
- [x] 模拟系统时间回拨/前移和时区变化，幂等 run key 不重复。
- [x] 模拟目标目录被删除、断开、改为只读、磁盘空间不足。
- [x] 模拟用户在 Patina 外部删除或修改旧快照，清理保持保守。
- [x] 模拟手动本地、WebDAV 临时快照、定时快照和恢复请求的竞争顺序。
- [x] 在定时快照生成期间持续写入追踪 session，确认写入成功且快照一致。

退出条件：

- [x] 所有故障都满足“旧备份优先保留、追踪不中断、状态可解释”。
- [x] 没有需要用户手工修复数据库才能继续启动的状态。

### 阶段 11：完整验证与交付

先运行聚焦验证：

- [x] `npm run test:settings`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run check:i18n`
- [x] `npm run check:ipc-contracts`
- [x] `npm run test:tauri-runtime-smoke`
- [x] scheduled backup 相关 Rust 单测过滤命令
- [x] snapshot/restore/remote backup 相关 Rust 回归测试过滤命令

再运行仓库级门槛：

- [x] `npm run check:full`
- [x] `npm run perf:stable`；若稳定基准不覆盖快照期间追踪写入，另保留本任务并发压力测试证据。
- [x] `git diff --check`
- [x] 检查新增/修改文件的 UTF-8 中文无乱码。
- [x] 检查最终 diff 没有无关格式化、用户改动覆盖或架构越界。

人工验收：

- [x] 新安装默认关闭、每天 02:00、默认目录、固定保留最新 1 份。
- [x] 开启后下次执行显示正确。
- [x] 到期生成一份有效 v2 文件。
- [x] 连续生成 2 次后只自动保留当前代次最新 1 份。
- [x] 最新保留文件可以独立恢复。
- [x] 新快照失败时原有最新有效备份继续保留。
- [x] 清理失败时允许暂有 2 份并显示 warning。
- [x] 重启/睡眠补跑不产生 backlog。
- [x] Settings 主卡片没有定时状态，统一弹窗包含全部定时配置。
- [x] WebDAV 仍只由用户手动立即触发。
- [x] 追踪在后台备份成功、失败和清理 warning 下都正常工作。

交付协作：

- [x] 所有实现与验证完成后，告知维护者把 item 从 `In progress` 拖到 `Done`。
- [x] 重新读取 live Project，按最新顺序报告完整 `Next` 补位/移出建议。
- [x] 如果 live Project 与建议仍不同，明确指出差异；本地 checklist、commit 或 changelog 不能替代 Board 状态。
- [x] 本任务完成后报告“统一备份弹窗 UI 调整”这一独立后续工作；未经维护者预览和确认，不自动创建或扩展 Project item。
- [x] 将本文移到 `docs/archive/` 并补全第 14 节执行记录。

---

## 9. 测试覆盖矩阵

| 风险 | 最小自动化证据 | 人工证据 |
| --- | --- | --- |
| 快照不完整 | v2 round-trip + full SQLite validation | 预览并恢复一份定时文件 |
| 14 个错过时隙形成 backlog | engine fake clock 只执行最近一个 | 伪造长期离线后启动 |
| 同一时隙重复 | 唯一约束 + 并发 claim test | 连续唤醒/重启只生成一份 |
| 手动与定时并发 | shared writer lock test | 同时触发手动备份 |
| 覆盖未知文件 | create-new publish race test | 预放同名文件并比较字节 |
| 误删用户文件 | retention ownership table tests | 目录混放手动/未知文件 |
| 新备份失败仍清理 | fault injection | 只读/空间不足目录 |
| 清理失败误判整次失败 | delete failure test | 锁住最旧文件后运行 |
| 目录变化清理旧目录 | generation isolation test | 切换目录后观察两边 |
| 时区/DST 重复或漏跑 | logical slot table tests | 修改系统时间/时区 |
| 恢复后意外运行 | restore reconcile test | replace/merge 各一次 |
| 追踪被阻塞 | concurrent session write test | 到期时持续使用应用 |
| IPC 越权 | runtime allow/deny matrix | Widget 无入口 |
| UI 状态过期 | revision/out-of-order event test | 运行时保持弹窗打开 |
| 本地化/无障碍退化 | i18n + UI smoke | 键盘、读屏、缩放 |

---

## 10. 安全、隐私、性能与容量预算

### 10.1 安全与隐私

- [x] 定时备份不新增网络请求、账号、云同步、WebDAV 调度或遥测。
- [x] 目标目录是用户主动选择或 Patina 本地默认目录。
- [x] 路径处理拒绝空值、相对路径和最终父目录越界。
- [x] 文件删除不跟随目录递归，不按名称猜所有权。
- [x] SQL 全部参数化；错误输出有长度上限并移除敏感内容。
- [x] capability 与 handler caller guard 共同保护有副作用 commands。

### 10.2 性能

- [x] runtime 空闲轮询不高于每分钟一次，不做目录全量扫描。
- [x] 到期计算和状态读取使用索引，单次 tick 为常量或小集合工作量。
- [x] archive SHA-256 只在成功发布、崩溃恢复或待删除候选验证时计算。
- [x] retention 只处理最新 1 份之外的少量文件；异常记录数有上限。
- [x] 大数据库快照期间追踪写入延迟有实测证据，不仅依赖代码推断。
- [x] 不把网络上传纳入本地 snapshot 互斥时间。

### 10.3 容量

固定保留 1 份的近似磁盘预算为：

```text
稳定占用 ≈ 1 × 单份压缩快照大小
创建峰值 ≈ 稳定占用 + 1 份新快照 + 临时数据库/zip 工作空间
```

- [x] UI 不承诺固定大小；显示最近成功文件的实际大小。
- [x] 清理发生在成功之后，因此短暂需要第 2 份及临时工作空间。
- [x] 磁盘不足导致新快照失败时，已有最新有效备份不删除。
- [x] 清理失败允许暂时超过 1 份，安全性优先于精确容量。

---

## 11. 非目标

本次明确不做：

- [x] 不做增量备份、差异备份、备份链或多文件合并。
- [x] 不调度 WebDAV、云盘或任意网络上传。
- [x] 不新增账号、跨设备同步或在线数据库。
- [x] 不新增 cron 表达式、多个并行计划、按小时/按月复杂计划。
- [x] 不新增备份浏览器、历史时间线、文件内数据预览或自动恢复。
- [x] 不自动移动、整理或删除旧目标目录中的文件。
- [x] 不自动清理手动备份或 WebDAV 本地临时目录之外的任何文件。
- [x] 不因定时备份失败暂停追踪。
- [x] 不在 Settings 主界面增加定时状态卡片。
- [x] 不借本任务重构整个 Settings、WebDAV 或 restore UI。
- [x] 不在本任务内完成统一备份弹窗的长期最终 UI；当前任务结束后另行调整。
- [x] 不在方案阶段决定版本号、提交、推送或发布。

如果实现发现必须引入上述能力，停止并重新确认 Project scope。

---

## 12. 停止并重新确认的边界

命中任一项时暂停实施：

- [x] 需要改变现有 v2 archive 的必填文件集合或创建不向后兼容的新格式。
- [x] 需要把调度设置扩展成多个计划或 cron 编辑器。
- [x] 需要自动调度 WebDAV/网络上传。
- [x] 无法在不扫描/猜测文件名的情况下证明旧文件归属。
- [x] 需要递归删除目录、覆盖未知文件或在新快照失败时释放空间。
- [x] 需要暂停 tracking 或关闭数据库才能完成正常定时快照。
- [x] 需要新增跨 feature shared 抽象、把厚逻辑放入 `app/*`/`commands/*`/`lib.rs`，或改变既有 architecture owner。
- [x] migration 10 使现有 v2 恢复、旧数据库升级或当前 schema fingerprint 无法保持兼容。
- [x] 现有脏工作树与本任务在同一行/同一职责发生无法安全合并的冲突。
- [x] live Project 已有另一个主要 `In progress`，而维护者尚未确认切换。

---

## 13. 回滚与故障处置

### 13.1 实施期回滚

- [x] 功能默认关闭，因此未完成 runtime 不得在 app setup 注册为可执行任务。
- [x] 分阶段保持编译/测试可用；先完成 migration/repository 与测试，再接 runtime，再接 UI。
- [x] 发现快照 writer 回归时先撤回共享入口改动，不触碰用户现有备份文件。
- [x] 自动化测试创建的目录使用私有临时目录并在测试结束后精确清理。

### 13.2 发布后停用

- [x] 紧急止损优先通过配置强制 disabled/不启动 scheduler，保留所有已生成文件和运行记录。
- [x] 不通过“删除目标目录”或“清空 runs 表”止损。
- [x] 如果 retention 归属判断存在疑问，立即禁用清理但可保留快照创建；安全保留优先。
- [x] 错误修复后从持久化状态幂等恢复，不要求用户手动编辑 SQLite。

### 13.3 migration 回滚限制

SQLite migration 10 是前向 migration。旧版本二进制可能不接受更高 migration head，因此发布后的二进制回滚不能假设可以直接打开升级后的数据库。

- [x] 发布前创建并验证一份升级前 v2 备份。
- [x] 如必须回退旧版本，使用与旧版本兼容的升级前备份恢复，而不是手工删除 `_sqlx_migrations` 或两张新表。
- [x] 任何回滚操作都不自动删除用户的定时备份目录。

---

## 14. 完成定义与执行记录

### 14.1 Definition of Done

- [x] 第 3.2 节默认项已确认。
- [x] 第 1 节所有验收事实成立。
- [x] 第 4 节当前实施线框已经完成基本可用性、Quiet Pro 和无障碍验收；后续独立 UI 调整不阻止本任务完成。
- [x] 第 5 节调度、幂等、重试、保留和恢复契约成立。
- [x] migration、repository、engine、data、app、commands、frontend gateway 和 Settings UI 均位于正确 owner。
- [x] 第 9 节自动化与人工矩阵有可复查证据。
- [x] `npm run check:full`、`npm run test:tauri-runtime-smoke`、`npm run perf:stable` 和 `git diff --check` 通过，或已记录并确认既有失败。
- [x] live Project 已复读并记录真实状态；最终状态与 `Next` 补位由维护者按报告手动拖动，本地归档不冒充 Board 更新。
- [x] CHANGELOG 已更新，本执行方案已归档。

### 14.2 执行记录模板

实施时逐阶段追加，不覆盖历史：

```text
日期：
阶段：
执行者：
完成条目：
改动文件：
测试命令与结果：
人工验证证据：
与方案偏差：
未解决风险：
Project 实际状态与建议拖动：
下一步：
```

### 14.3 当前记录

- 2026-08-09：完成第一性原理、UI 心智模型、完整快照共存、安全清理、调度状态机、架构 owner 和验证门槛的方案化；当前 UI 作为本任务实施基线，本任务完成后再单独调整 UI，后续 UI 优化不阻止当前任务结束；尚未开始实现、未修改 Project 状态。
- 2026-08-09：完成定时本地备份实现。新增 migration 10、配置/运行账本、每日/每周本地时隙、单次补跑、5/30 分钟有界重试、无覆盖完整 v2 快照、按精确账本与代次执行的安全保留、崩溃恢复、replace/merge 恢复协调、Tauri commands/permissions/runtime，以及统一备份弹窗中的定时配置与状态。
- 2026-08-09：实现与方案的结构偏差均保持原所有者语义：候选路径、执行和保留集中在 `data/scheduled_backup.rs`，纯到期决策位于 `engine/backup_scheduler.rs`；没有为了形式增加通用 store/executor trait。前端草稿留在对话框，IPC 经 `scheduledBackupService.ts` 和 platform gateway 隔离；没有增加无复用价值的独立状态抽象。备份对话框的 CSS 随懒加载组件按需加载，避免扩大所有页面的 CSSOM。
- 2026-08-09：常规验收通过：`npm run check:full`（80 条真实浏览器场景；Rust 548 passed、1 ignored；Clippy 与依赖审计通过）、`npm run test:tauri-runtime-smoke`（真实 Tauri/WebView2、commands/events/capability、migration 10、默认配置通过）、`npm run perf:stable`（每项 5 轮；Data→Dashboard→History 关键路径五轮均值 333.41 ms）和 `git diff --check`。首次完整门禁发现并修复 migration 10 schema contract 字段名不一致；性能门禁发现并修复备份 CSS 全局加载。
- 2026-08-09：当前统一备份弹窗已完成功能、基本 Quiet Pro、键盘/语义控件、中文/英文和 390 px 无溢出验收；维护者已经明确本任务完成后仍要单独调整最终 UI，该后续不属于本执行方案的阻塞项，也未在未确认的情况下自动创建 Project item。
- 2026-08-09：live Project 开始时该 item 仍为 `Next`；已报告维护者应将其拖到 `In progress` 及当时的 `Next` 补位建议。归档后将重新读取 live Project，并报告从实时状态到 `Done` 的人工拖动及完整 `Next` 窗口差异；本地归档不代替 Board 更新。
- 2026-08-09：本方案完成勾选并归档后立即进入对抗式审查；审查发现、修复和复验结果将追加到归档文件，不把归档当作停止点。
- 2026-08-09：对抗式审查发现并修复四个真实边界。其一，文件原子发布后若二次校验或成功状态写入失败，旧流程可能按“发布前失败”记录为 `absent`；现已区分发布前失败与发布后待核验，后者只能通过精确路径重新校验为 `succeeded/present` 或 `retry_wait|failed/conflict`。其二，保留清理在校验与删除之间存在 TOCTOU 窗口；Windows 现以禁止写入、重命名和删除共享的精确普通文件句柄完成校验，并通过同一句柄删除，重解析点、占用文件和身份变化均只警告不删除。其三，跨日休眠时旧 `retry_wait` 会先补旧时隙、再补最新时隙；现由最新合格时隙淘汰旧重试并保留其失败/冲突文件状态，只执行最新时隙。其四，replace/merge 恢复与调度暂停之间存在交错窗口；现由应用级调度锁覆盖整个恢复过程，replace 在释放锁前完成禁用、清空瞬时运行态和新代次切换。
- 2026-08-09：对抗式 UI 审查保持已确认布局不变，只修正状态行为：后台事件在草稿未修改时同步新配置、草稿已修改时不覆盖用户输入；等待重试时同时显示重试时间和安全截断后的失败原因。懒加载 CSS 的静态 UI 测试也改为读取组件自有样式文件，不再错误依赖全局 Settings CSS。
- 2026-08-09：对抗式测试新增并通过：发布后校验冲突不会降级为 `absent`、新时隙淘汰旧重试且保留 `conflict`、候选按稳定顺序隔离代次、Windows 清理句柄阻止路径替换并删除同一文件身份、恢复与调度使用同一操作锁。状态转换写入额外校验受影响行数，异常并发不再被静默当作成功。
- 2026-08-09：最终复验通过。沙箱内 Vite/cargo 子进程会触发 Windows `EPERM`，因此在获准的非沙箱环境运行整条 `npm run check:full`，151.1 秒退出码 0：80 条真实浏览器场景、Rust 552 passed/1 ignored、Clippy、依赖审计、生产构建与 bundle 预算全部通过。`npm run test:tauri-runtime-smoke` 在真实 Tauri/WebView2 中通过 command/event/SQLite/capability 验证；`npm run perf:stable` 每项 5 轮全部通过，Dashboard→History 复合路径本轮均值 316.87 ms、最差 p95 398.32 ms；最终 `git diff --check` 退出码 0。
- 2026-08-09：完成前复读 live Project：`支持定时本地备份与安全保留` 已由维护者置于 `In progress`；全局手动顺序依次为本项、定时导出、被阻塞的多语言、灵动视效、Tools 提醒、挂件面板。实现完成后应由维护者将本项拖到 `Done`，保留定时导出为 `Next`，并将灵动视效和 Tools 提醒从 `Queued` 补入 `Next`；挂件面板保持 `Queued`，多语言保持 `Blocked`。
- 2026-08-09：按维护者最终 UI 决策完成收口：一级“选择备份位置”弹窗维持既有 `600px` 尺寸、标题、说明和本地/WebDAV 卡片，只在本地卡片右侧增加 `CalendarClock` 入口；定时配置与状态迁入次级弹窗。一级弹窗代码块在 Settings 页面加载时后台预取且使用空 Suspense fallback，不再出现伪加载弹窗；Tooltip 以图标真实位置为锚点并显示在上方。静态 UI、Settings 状态、生产构建与 bundle 预算均通过，真实 Chromium 80 项场景通过，并显式验证 600px、无“加载中...”、Tooltip 在图标上方、保存命令、390px 无溢出、Esc 与焦点回收。
- 2026-08-09：最终视觉收口将每日“频率 / 时间”放在同一行，周计划把星期作为同排第三项；“下次执行 / 最近成功 / 最近失败”保持一行三列；移除保留数量控件、清理策略小字和次级弹窗重复的右上角关闭按钮，只保留取消、保存与 Esc。固定单份保留规则从前端与 IPC 契约中移除，调度器仅在新快照验证成功后清理同代次旧备份；旧数据库列保留兼容并固定写 `1`。
- 2026-08-09：按维护者补充决策，在“定时备份”次级弹窗标题右侧复用共享 Quiet Pro `regular` 尺寸的 `BETA` badge，使其高度与弹窗标题匹配；不增加局部 badge 样式，不改变弹窗尺寸、标题层级或开关位置。
- 2026-08-09：`BETA` badge 最终用真实 Chromium 几何数据验收：badge/标题字号比 `0.638`、高度比 `0.844`、垂直中心偏差 `0.008px`，并在 `390px` 宽度下与右侧开关保持分离。最终 `npm run test:ui-browser-smoke` 的 80 项场景、`npm run build`、`npm run check:bundle` 与 `git diff --check` 全部通过；测试按共享 `regular` 语义和相对比例断言，不绑定易碎的固定像素。
- 2026-08-09：按维护者后续 UI 复审进一步收紧次级弹窗：频率、星期与时间归入同一计划行，目录归入独立保存位置行；关闭时不渲染由空破折号组成的状态区，启用后仅呈现真实存在的下次执行、最近成功、最近失败或运行中信息。保存目录属于文件夹选择结果，不再伪装成不可编辑的输入框，改为“文件夹图标 + 可选择复制的静态路径 + 更改目录”；Windows 内部 `\\?\` 与 `\\?\UNC\` 设备前缀仅在展示层转换为普通本地或 UNC 路径，持久化和调度仍使用原始路径。类型检查、29 项 Settings 状态测试、53 项静态 UI smoke、80 项真实浏览器场景、生产构建和 bundle 门禁通过，390px 无横向溢出。
- 2026-08-09：最终再次只读复核 live Project：`支持定时本地备份与安全保留` 仍为 `In progress`，`在数据导出界面支持定时导出` 是唯一 `Next`，`规范化前端与原生多语言文案系统` 保持 `Blocked`，当前没有 `Queued` 项需要补位。维护者只需把本项从 `In progress` 拖到 `Done`；其余状态无需调整。
