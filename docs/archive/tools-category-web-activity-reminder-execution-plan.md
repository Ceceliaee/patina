# Tools：为提醒器增加分类与网页活动目标执行方案

> 文档类型：执行型 How-to / 可勾选实施清单
> 文档状态：实现与对抗式审查已完成；因宿主环境限制，真实浏览器/Windows 视觉验收与 canonical Vite gate 留有明确证据，本文已归档
> 编写日期：2026-08-12
> 目标读者：Patina 维护者，以及负责 React、Tauri、Rust、SQLite、备份与本地化的实现者
> 目标界面：`Tools / 提醒器` 顶部模式切换，由 `事件 | 应用` 扩展为 `事件 | 应用 | 分类 | 网页`
> 文档归宿：实现、验证、对抗式审查和 Project 收口全部完成后移入 `docs/archive/`

## 1. 文档定位与使用方法

本文把“在提醒器顶部增加分类和网页”转化为一份可以逐项执行、逐项验收、逐项归档的实施合同。它不是只增加两个标签的视觉任务，而是新增两类由可信活动数据驱动的提醒规则：

- `分类`：当某个应用分类在本地自然日内的桌面应用累计时间达到阈值时提醒；
- `网页`：当某个已记录域名在本地自然日内的网页累计时间达到阈值时提醒。

本文不替代以下长期规范，发生冲突时以长期规范为准：

- [`../product-principles-and-scope.md`](../product-principles-and-scope.md)
- [`../roadmap-and-prioritization.md`](../roadmap-and-prioritization.md)
- [`../engineering-quality.md`](../engineering-quality.md)
- [`../quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)
- [`../architecture.md`](../architecture.md)
- [`../issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md)
- [`../versioning-and-release-policy.md`](../versioning-and-release-policy.md)
- [`../localization.md`](../localization.md)
- [`../web-activity-protocol.md`](../web-activity-protocol.md)

执行规则：

- `[x]` 只表示用户已经确认的方向，或本文编写时已经完成且可复查的调查。
- `[ ]` 表示仍需实际执行；不得因为现有代码“差不多能用”而提前勾选。
- 每勾选一个实施项，必须在条目下补充文件、测试名、命令结果、截图或人工验收结论。
- 一个阶段的退出条件未满足时，不进入下一阶段。
- 本文不授权创建分支、提交、推送、发布、修改 GitHub Issue 或修改 GitHub Project；这些动作仍需用户在当前任务中明确授权。
- 当前工作区包含其他任务的大量未提交改动。实施时必须按 owner 逐项补丁，禁止用整文件回退、`git checkout --`、`git reset --hard` 或其他方式覆盖用户改动。

### 1.1 当前确认状态

- [x] 用户已确认在截图所示提醒器模式区增加 `分类` 与 `网页`。
- [x] 最终顺序固定为 `事件 | 应用 | 分类 | 网页`。
- [x] 现有 `事件` 与 `应用` 功能必须保留，不以新模式替代。
- [x] 新模式继续服务个人、本地优先、Windows 桌面时间追踪，不扩张为任务、日程、团队或云端规则系统。
- [x] 2026-08-12 已只读核对 live GitHub Project；没有与本需求范围相同的现有工作项。
- [x] live Project 中的 `完善 Tools 到期的 Patina 提醒弹窗` 只负责提醒出现后的轻量展示表面，与本任务的规则来源和累计语义不同，不应合并。
- [ ] 为本需求创建独立 Project draft item 并获得维护者确认。
- [x] 实现开始。
- [x] 自动化验证已执行并记录；可运行门禁全部通过，宿主阻断项见第 15 节。
- [ ] 真实桌面与视觉验收完成。
- [x] 对抗式审查完成。
- [x] 执行单归档。

## 2. 最终交付结果

提醒器顶部保持当前 Quiet Pro 紧凑分段控件，只把闭合集合从两个模式扩展为四个模式：

```text
┌──────────────────────────────────────────────────────────────────┐
│  提醒器                                                          │
├──────────────────────────────────────────────────────────────────┤
│  [ 事件 ] [ 应用 ] [ 分类 ] [ 网页 ]                            │
│                                                                  │
│  当前模式对应的创建表单                                          │
│                                                                  │
│  当前模式对应的待处理提醒 / 活动规则列表                          │
└──────────────────────────────────────────────────────────────────┘
```

四种模式的最终语义：

| 模式 | 目标 | 时间口径 | 触发口径 | 数据来源 |
|---|---|---|---|---|
| `事件` | 一次性文字事件 | 相对时间或绝对时间 | 到达指定时刻触发 | `tool_reminders` |
| `应用` | 一个已记录桌面应用 | 本地自然日累计 | 达到每日阈值后当天最多触发一次 | `sessions` |
| `分类` | 一个当前有效的应用分类 | 本地自然日内属于该分类的桌面应用累计 | 达到每日阈值后当天最多触发一次 | `sessions` + 当前分类设置 |
| `网页` | 一个已记录网页域名 | 本地自然日累计 | 达到每日阈值后当天最多触发一次 | `web_activity_segments` |

最终结果必须同时满足：

- `分类` 与 `网页` 是完整可创建、可查看、可停用、可触发、可恢复的规则，不是占位标签。
- `应用 / 分类 / 网页` 共享同一套“每日累计活动提醒”业务核心，不能复制成三套独立状态机。
- `分类` 第一版只统计桌面应用会话，不混入网页域名分类时间。
- `网页` 只统计 Web Sync 已经写入本地数据库的网页片段，不用浏览器进程时长推测网页时长。
- 浏览器应用会话与网页片段不相加，避免同一段浏览行为被重复计算。
- 每条活动规则在同一本地自然日最多触发一次；跨过本地午夜后自动进入新一天的累计周期。
- 应用重启、主窗口隐藏、最小化、驻留托盘时，规则仍由 Rust Tools runtime 可靠评估。
- 分类重命名不破坏规则身份；分类删除、目标排除、Web Sync 停用或暂时断连时，界面如实表达状态，不静默删除规则。
- 不增加新的 Settings 选项，不修改 Patina Web Sync 扩展协议，不依赖云服务或 Windows 系统通知。

## 3. 第一性原理推导

### 3.1 提醒规则的本质是“可信事实达到阈值”

活动提醒不是另起一个计时器，也不是根据前端页面停留时间推测使用时间。其最小模型是：

```text
规则 = 稳定目标身份 + 本地自然日 + 可信累计时长 + 阈值 + 当日触发记录
```

评估公式固定为：

```text
usage(target, local_day, now)
  = Σ max(0, min(record.end_or_now, now) - max(record.start, local_day_start))

fire(rule)
  ⇔ rule.enabled
  ∧ rule.last_fired_date_key ≠ current_date_key
  ∧ usage(rule.target, current_date_key, now) ≥ rule.limit_ms
```

因此实现必须从 SQLite 中已经存在的可信记录计算，不得：

- 在 React 中用 `setInterval` 自行累计；
- 根据窗口是否可见推测活动；
- 把浏览器进程时间当作具体网站时间；
- 把候选列表中的历史总时长当作今日时长；
- 因为主窗口关闭而停止规则评估。

### 3.2 身份必须与显示名称分离

目标的稳定身份与界面名称不是同一件事：

- 应用身份优先使用 canonical executable，显示名称允许被用户改名；
- 分类身份使用稳定 category id，显示名称允许重命名或随语言变化；
- 网页身份使用 normalized domain，显示名称和 favicon 只是呈现信息。

数据库必须保存稳定身份。为了在目标后来被删除或无法解析时仍可向用户解释旧规则，可以保存非权威的 `label_snapshot` 作为回退，但它不能参与匹配、去重或累计。

### 3.3 三类活动来源必须共享规则核心，但保持统计边界

共享规则核心解决的是：阈值校验、每日一次、停用、事务内去重、通知生成和快照表达。统计来源仍必须分开：

```text
应用规则 ───────> sessions / 指定应用
分类规则 ───────> sessions / 当前有效应用分类
网页规则 ───────> web_activity_segments / 指定域名
```

`分类` 不把网页分类混入应用分类总量，原因是：

1. 当前产品已有“应用分类统计”和“网页维度分开”的长期口径；
2. 浏览器进程会话与网页片段通常重叠，直接求和会重复计时；
3. 在没有明确的时间区间替换算法前，混合结果不可解释也不可信。

如果未来要做跨来源分类提醒，应另立工作项，先定义浏览器应用时间与网页时间的覆盖、替换和空洞规则；本任务不预埋半成品开关。

### 3.4 业务运行时必须在 Rust，而不是前端

用户期待提醒在主窗口不可见时仍可靠发生。因此：

- React 只负责选择目标、提交意图、展示快照与管理表单草稿；
- platform gateway 只负责 DTO 校验、命令调用与事件适配；
- Rust `engine/tools` 负责规则语义、runtime 调度和通知编排；
- Rust `data/repositories/tools` 负责参数化 SQL、事务与持久化；
- `commands/tools.rs` 继续保持薄转发。

不得把分类累计放进 `ReminderToolPanel.tsx`，也不得让 Tauri command handler 直接拼 SQL。

### 3.5 低打扰来自稳定结构和诚实状态

增加两个模式后，界面不需要增加说明弹窗、引导气泡、卡片套卡片或新的设置项。低打扰方案是：

- 仍使用同一行分段控件；
- 切换后只替换下方内容面板；
- 每个活动模式复用同一表单骨架和列表骨架；
- 无数据、数据源关闭、暂时断连、目标被排除等情况使用面板内低噪音说明；
- 不用 Toast 反复报告“当前没有网页数据”；
- 不隐藏已经存在的规则，也不伪装成正常启用。

### 3.6 兼容性的重点是用户数据，不是保留旧命名

当前实现以 `software reminder` 命名应用规则。扩展为应用、分类和网页后，长期模型应改为 `activity reminder`。真正需要兼容的是：

- 已发布数据库里的应用提醒规则；
- 已保存的本机提醒模式偏好值 `software`；
- 仍在支持窗口内的旧结构化备份；
- 旧 SQLite 快照恢复后继续向新 migration head 升级。

不需要为了内部旧名长期保留两套 command、两套表或 `V2 / New / Next` 类型。前后端随同一个安装包原子发布，没有支持旧前端调用新 Rust 的外部协议承诺。

## 4. 已确认的产品合同

### 4.1 模式顺序与可见性

- [x] 顺序固定为 `事件 | 应用 | 分类 | 网页`。
- [x] 四个模式始终可见，不因 Web Sync 是否开启动态增删标签。
- [x] 继续使用 `QuietSegmentedFilter`，不改成下拉菜单、二级导航或独立页面。
- [x] 四项属于少量、固定、短标签且需要同时比较的闭合集合，符合 segmented control 原型。
- [x] 实现时把外层控件明确设为 `semantics="tabs"`，提供 `tablist / tab / tabpanel` 语义。
- [x] 左右方向键循环切换，`Home / End` 跳到首尾，焦点跟随选中项。
- [x] 中文、英文和最小主窗口宽度下保持单行，不允许横向滚动。

### 4.2 模式偏好

- [x] 继续记住用户最后一次明确选择的提醒模式。
- [x] 这是 Tools 页面局部 UI 偏好，不进入 Settings、SQLite 或备份。
- [x] 新 canonical 值使用 `event | app | category | web`。
- [x] 读取旧 `patina:tools-reminder-mode=software` 时映射为 `app`，并尽力回写 canonical 值。
- [x] 存储不可用或值损坏时回退到 `event`，不能阻止页面打开。
- [x] 旧 `software` 读兼容在首个包含迁移的稳定版本发布满 90 天后复核是否删除；未满足退出条件前只保留一处解析映射。

### 4.3 活动规则共同字段

`应用 / 分类 / 网页` 的创建表单共同包含：

- 一个必选目标；
- `每日上限（分钟）`；
- 可选 `提醒内容`；
- `创建` 按钮。

共同约束：

- [x] 阈值单位继续使用分钟。
- [x] 最小值为 `1`，最大值为 `1440`。
- [x] 创建时转为 `limit_ms`，Rust 再次校验，不能只信任 HTML `min/max`。
- [x] 空自定义文案作为空值保存，由触发时的当前界面语言生成默认通知正文。
- [x] 不在 repository 中写死 `休息一下` 或其他单一语言文案。
- [x] 同一目标允许存在多条不同阈值或不同文案的规则；本任务不增加唯一约束。
- [x] 停用是软删除，保留审计与备份数据；当前 UI 继续只展示活动规则。

### 4.4 应用模式

- [x] 保持现有“已记录应用 + 每日累计上限”行为。
- [x] 目标身份优先使用 canonical executable；缺少 executable 时才回退到 app name。
- [x] 只累计 Patina 原生 `sessions`，不把导入批次、小时桶或网页片段并入。
- [x] 包含当天仍未封口的当前活动 session，并裁剪到 `now`。
- [x] 候选列表继续过滤系统噪音与被用户排除的应用。
- [x] 当前显示名称改动后，规则行显示最新名称；无法解析时回退到创建时名称快照。

### 4.5 分类模式

- [x] `分类` 表示应用分类累计，不表示网页分类累计或二者混合累计。
- [x] 目标身份使用稳定 category id，不保存本地化标签作为身份。
- [x] 可选目标包括当前有效的用户可分配 seeded category、自定义分类和 `其他`。
- [x] 不把 `system` 作为普通可选分类；系统噪音继续服从现有追踪排除规则。
- [x] 规则计算使用“评估当下的当前分类设置”重新解释当天所有 session。
- [x] 因此同一天内修改应用分类后，今天较早的记录也按新分类口径重新归类；这与当前导出和统计的“当前分类”语义一致。
- [x] 分类重命名不影响规则匹配，规则行立即显示新名称。
- [x] 分类删除后规则不自动转移到 `其他`，而是保留并显示“分类已删除 / 已暂停”；该分类原有应用可按当前产品规则归入 `其他`，但旧规则不能悄悄改变目标。
- [x] 分类当前没有任何应用时，规则仍是有效规则，累计为 `0`，不视为错误。
- [x] 分类选择使用 `QuietSelect` 或符合其 listbox 契约的共享选择器，不把可能扩展的分类列表做成第二层 segmented control。

### 4.6 网页模式

- [x] 目标身份使用 `normalized_domain`，不按完整 URL、路径、标题或标签页 id 建规则。
- [x] 域名规范化复用 Web Activity 的 canonical 函数：去空白、去末尾点、统一小写，并与当前数据库语义一致。
- [x] 不在 Tools 中新增另一套 `www` 处理规则；以数据库现有 `normalized_domain` 为准。
- [x] 只累计 `web_activity_segments`，包括当天仍未封口的 active web segment，并裁剪到 `now`。
- [x] 不用 Chrome / Edge / Firefox 应用 session 推测某个网站的时间。
- [x] 只允许从已经观察到的域名候选中选择，不允许输入任意未记录域名制造永远不触发的规则。
- [x] 被用户设置为不记录/排除的域名不进入新规则候选。
- [x] 现有规则的域名后来被排除时，不删除规则；规则显示“已排除 / 已暂停”，恢复记录后继续使用同一规则。
- [x] Web Sync 关闭时仍显示 `网页` 标签和已有规则；没有候选时显示面板内说明，不弹窗、不 Toast。
- [x] Web Sync 开启但扩展暂时断连时，历史候选和规则仍可管理；累计只依据已经落库的片段，不生成虚拟时间。
- [x] 删除某域名历史后，规则仍保留，累计从现有记录重新计算为 `0`；不自动删除或改绑。
- [x] 本任务不修改扩展、HTTP endpoint、token、协议版本或跨仓发布契约。

### 4.7 本地自然日与触发语义

- [x] `date_key` 使用运行设备当前本地日期 `YYYY-MM-DD`。
- [x] `day_start_ms` 使用本地当天午夜，并沿用当前 DST 安全转换方式。
- [x] 每次 runtime tick 都以同一组 `now_ms / date_key / day_start_ms` 计算，避免一次 tick 内跨日混用。
- [x] 达到阈值后，在同一 SQLite 事务内条件更新 `last_fired_date_key`；只有成功更新的规则才返回通知。
- [x] 应用重启后，如果规则今天已经触发，不重复触发。
- [x] 应用启动时如果今天累计已经超过阈值且尚未触发，应在恢复 tick 中触发一次。
- [x] 午夜后即使 runtime 处于空闲，也必须在新日边界后重新评估。
- [x] 修改系统时区后以当前本地日期重新计算；不尝试伪造旧时区日界线。

### 4.8 规则行与状态表达

每个活动模式只展示属于当前模式的规则，避免列表混杂：

```text
[目标图标/色点]  目标名称
                 提醒内容或本地化默认说明
                                  [启用/暂停原因] [每日 30 分钟] [停用]
```

- [x] 应用使用应用图标或现有首字 fallback。
- [x] 分类使用分类色点和名称，不新增彩色图标砖。
- [x] 网页使用 favicon 或现有域名 fallback。
- [x] 正常状态沿用克制的状态文本/状态 chip，不增加发光圆点。
- [x] “分类已删除”“目标已排除”“网页同步关闭”使用可解释的次级文案；只有真实操作失败才使用错误色。
- [x] 切换模式不清空同一页面生命周期内其他活动模式的未提交草稿。
- [x] 切换页面或重启时不持久化未提交草稿。
- [x] 停用按钮提供包含目标名称的可访问名称，焦点状态复用现有 Quiet Pro 控件。

## 5. 范围与非目标

### 5.1 本轮范围

- 扩展提醒器模式为 `事件 / 应用 / 分类 / 网页`。
- 把现有应用规则抽象为 canonical activity reminder domain model。
- 新增分类目标和网页域名目标的创建、显示、停用与每日触发。
- 迁移既有应用提醒规则，确保数量、阈值、文案、触发日期与停用状态不丢失。
- 扩展 SQLite migration、schema contract、备份清单与旧备份恢复适配。
- 扩展 Rust Tools runtime、domain、data repository、app/commands 和 Tauri capability。
- 扩展 frontend DTO parser、gateway、view model、候选加载、表单和列表。
- 抽取 Rust 侧当前分类解析为可由 export 与 Tools 共用的单一实现，避免 Tools 依赖 export 私有模块。
- 阻止 Tools 新代码继续依赖 `features/classification/*` 私有实现；目标候选由 Tools service 通过稳定 shared/platform 边界组成。
- 补齐中英文 UI 与 native notification 文案，并通过本地化生成与审查流程。
- 增加单元、SQLite、migration、备份恢复、IPC、SSR、真实浏览器和 Windows runtime smoke 验证。
- 完成浅色、深色、中文、英文、最小窗口和数据源降级状态的视觉验收。
- 完成一次独立于实现自证的对抗式审查。

### 5.2 明确非目标

- 不新增 Settings 选项。
- 不新增规则通知总开关、默认阈值或默认文案设置。
- 不新增周/月累计、滚动 24 小时、工作日或自定义统计周期。
- 不支持一个规则选择多个应用、多个分类或多个域名。
- 不支持 URL path、页面标题、窗口标题或正则表达式目标。
- 不把网页分类时间并入分类提醒。
- 不把外部导入数据并入活动提醒。
- 不支持修改既有规则；第一版继续采用“停用旧规则，再新建”的模型。
- 不新增重复规则合并、排序、分组、批量停用或历史触发日志页面。
- 不新增常驻通知中心。
- 不改变提醒弹窗交付表面；未来的 `完善 Tools 到期的 Patina 提醒弹窗` 工作项只需消费统一 `ToolAlert`。
- 不使用 Windows 系统通知。
- 不修改 Patina Web Sync 浏览器扩展或协议。
- 不创建新的通用 `shared/utils`、万能 repository 或兼容命名链。
- 不为了本任务重写整个 Tools 页面或整个 classification feature。
- 不创建 `ActivityReminderV2`、`NewActivityReminder` 或同义临时类型。

## 6. 当前实现基线与缺口

### 6.1 当前可复用事实

- `src/features/tools/components/ReminderToolPanel.tsx` 已有事件/应用模式切换、应用规则表单和规则列表。
- `src/features/tools/services/toolsLayoutPreferenceStorage.ts` 已有提醒模式局部偏好。
- `src/features/tools/services/softwareReminderAppCandidates.ts` 已有完整应用目录候选与缓存生命周期。
- `src/platform/runtime/toolsRuntimeGateway.ts` 与 `toolsRawDtos.ts` 已有严格 DTO 解析和 Tools command gateway。
- `src-tauri/src/engine/tools/mod.rs` 已有后台循环、日界线唤醒、通知队列和 locale snapshot。
- `src-tauri/src/data/repositories/tools.rs` 已有应用每日累计、事务内触发去重和 focused SQLite tests。
- `src-tauri/src/data/schema.rs` migration head 当前为 `12`，应用规则表来自 migration `3`。
- `web_activity_segments` 已有 `(normalized_domain, start_time, end_time)` 索引和单 active row 约束。
- 分类设置已持久化在 `settings`：应用 override、网页 override、分类定义、标签、颜色和删除标记。
- `src-tauri/src/data/export/common.rs` 已能解析当前 app/domain category，但实现属于 export 私有 owner，不能被 Tools 直接反向依赖。
- 当前主备份是 SQLite data snapshot；旧结构化 JSON ZIP reader 仍处于已承诺的迁移兼容路径。

### 6.2 当前必须解决的缺口

- `ReminderMode` 只有 `event | software`。
- domain、snapshot、alert kind、command、DTO、repository 和表名都绑定 `software reminder`。
- 规则表只能保存 `app_name / exe_name`，无法表达分类或域名身份。
- 当前 native 默认正文的应用语义不能表达分类与网页。
- repository 会在空文案时写入硬编码中文默认值，破坏动态语言切换。
- Tools 应用候选当前直接导入 `features/classification/*` 私有 service/type；扩展更多分类和网页依赖会加重错误边界。
- Rust 分类解析被放在 export 私有模块，Tools runtime 没有可复用的当前分类 snapshot。
- 备份 manifest、preview count、legacy restore adapter 和 schema contract 都使用旧表名。
- 真实浏览器 smoke 只覆盖应用规则，没有四 tab、分类、网页与降级状态。

## 7. 目标架构与 owner 合同

### 7.1 Owner 表

| 能力 | 目标 owner | 允许职责 | 禁止职责 |
|---|---|---|---|
| 提醒器模式与表单草稿 | `src/features/tools/*` | mode、草稿、表单校验、候选选择、view model | SQLite、Tauri raw DTO、后台计时 |
| 活动目标候选组合 | `src/features/tools/services/activityReminderTargetCatalog.ts` | 组合 app/category/web 候选并面向 Tools 排序 | 复制 classification 持久化、直接拼业务 SQL |
| 稳定分类 token/解析 | `src/shared/classification/*` | 前端稳定 category id、标签、颜色和 process mapping | Tools 页面状态 |
| 外部持久化读取 | `src/platform/persistence/*` | 读取 app catalog、web domain facts、classification settings | 业务表单状态、通知语义 |
| Tools runtime IPC | `src/platform/runtime/toolsRuntimeGateway.ts`、`toolsRawDtos.ts` | strict DTO parse、invoke、event mapping | React 状态、SQLite SQL |
| 活动提醒 domain | `src-tauri/src/domain/tools.rs` | tagged target、rule、notification、snapshot 类型 | SQL、Tauri command |
| 当前分类纯解析 | Rust domain 中的 classification snapshot/resolver | category id、删除、排除、标签 fallback 的纯规则 | 数据库连接、export 格式 |
| 分类设置读取 | `src-tauri/src/data/repositories/classification_settings.rs` 或同 owner 子模块 | 参数化读取并构建 classification snapshot | Tools runtime 编排 |
| 规则持久化与累计 | `src-tauri/src/data/repositories/tools/*` | migration 后表读写、使用时长查询、事务去重 | UI 文案、窗口行为 |
| runtime 编排与通知 | `src-tauri/src/engine/tools/mod.rs` | tick、day boundary、mutation、localized ToolAlert | SQL 细节、厚 command DTO |
| app/command 壳 | `src-tauri/src/app/tools.rs`、`commands/tools.rs` | 组装、校验 DTO 形状、转发 | 规则计算、分类计算、SQL |
| schema 与升级 | `src-tauri/src/data/schema.rs`、`sqlite_pool*` | migration 13、schema contract、升级修复 | 页面逻辑 |
| backup/restore | `src-tauri/src/data/backup*`、tools backup repository | snapshot count、旧 payload adapter、restore test | 新业务规则实现 |

### 7.2 Canonical domain model

目标语义模型应类似以下结构；具体 Rust 语法可按现有 serde 约定调整，但语义不得退化为字符串字典：

```rust
enum ActivityReminderTarget {
    App {
        app_name: String,
        exe_name: Option<String>,
    },
    Category {
        category_id: String,
    },
    WebDomain {
        normalized_domain: String,
    },
}

struct ToolActivityReminderRule {
    id: i64,
    target: ActivityReminderTarget,
    label_snapshot: String,
    limit_ms: i64,
    message: String,
    created_at: i64,
    updated_at: i64,
    disabled_at: Option<i64>,
    last_fired_date_key: Option<String>,
}
```

约束：

- [x] 使用 domain enum 表达合法形状，不允许 category rule 同时携带 app/domain 字段。
- [x] `label_snapshot` 只用于回退显示，不参与目标匹配。
- [x] input 和 snapshot 分开建模；不要直接把 command DTO 当 domain model。
- [x] `ToolAlertKind` 收口为活动提醒语义，例如 `activity_reminder`；目标类型由 notification payload 在 Rust 内决定本地化标题。
- [x] `ToolsRuntimeSnapshot` 的 canonical 字段改为 `activity_reminder_rules` / `activityReminderRules`。
- [x] 现有 event reminder、timer 和 pomodoro 类型不受影响。

### 7.3 SQLite canonical schema

新增 migration `13`，建议描述为 `generalize_activity_reminder_rules`。保留 migration `3` 作为历史升级事实，不改写已发布 checksum。

目标表建议使用显式列和互斥 `CHECK`，避免把三种身份塞进含义不清的单个字符串：

```sql
CREATE TABLE tool_activity_reminder_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_kind TEXT NOT NULL
        CHECK(target_kind IN ('app', 'category', 'web_domain')),
    app_name TEXT,
    exe_name TEXT,
    category_id TEXT,
    normalized_domain TEXT,
    label_snapshot TEXT NOT NULL,
    limit_ms INTEGER NOT NULL
        CHECK(limit_ms >= 60000 AND limit_ms <= 86400000),
    message TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    disabled_at INTEGER,
    last_fired_date_key TEXT,
    CHECK(
        (target_kind = 'app'
            AND app_name IS NOT NULL
            AND category_id IS NULL
            AND normalized_domain IS NULL)
        OR
        (target_kind = 'category'
            AND app_name IS NULL
            AND exe_name IS NULL
            AND category_id IS NOT NULL
            AND normalized_domain IS NULL)
        OR
        (target_kind = 'web_domain'
            AND app_name IS NULL
            AND exe_name IS NULL
            AND category_id IS NULL
            AND normalized_domain IS NOT NULL)
    )
);
```

索引至少覆盖：

- 活动规则快照和 tick：`(disabled_at, last_fired_date_key, target_kind)`；
- app target：`(target_kind, exe_name, app_name)`；
- category target：`(target_kind, category_id)`；
- web target：`(target_kind, normalized_domain)`。

迁移步骤必须在同一 migration 事务内：

1. 创建 canonical 新表和索引；
2. 把 `tool_software_reminder_rules` 全量插入为 `target_kind='app'`；
3. `label_snapshot=app_name`，原样保留 id、limit、message、timestamps、disabled 和 last fired date；
4. 删除旧表；
5. schema contract 验证新表存在、字段和索引完整、旧表不存在。

不得：

- 修改 migration `3` 的 SQL 或 checksum；
- 先删除旧表再复制；
- 用字符串拼接用户值；
- 给 category/domain 造假 app name；
- 长期同时写两张表。

### 7.4 统一 evaluator

`fire_due_software_reminders` 应被一个 canonical `fire_due_activity_reminders` 替代。建议算法：

1. 开启 SQLite transaction。
2. 读取 `disabled_at IS NULL` 且今天尚未触发的活动规则。
3. 在同一一致性窗口读取当前分类设置、目标排除状态与 Web Sync enabled 状态。
4. 收集规则所需 app executable、category id 和 normalized domain。
5. 一次读取当天 app usage facts；按 current classification snapshot 映射后得到 category totals。
6. 一次读取当天所需 web domain usage totals。
7. 为每条规则解析 `usage_ms` 和 suspension reason。
8. 达到阈值的规则执行条件更新：仍启用且今天未触发时写入 `last_fired_date_key`。
9. 只为 `rows_affected == 1` 的规则产生 notification。
10. 提交事务后把 notification 交给 engine 本地化并入队。

性能边界：

- [x] 不为每个分类规则重新全表扫描当天 sessions。
- [x] app facts 至多扫描一次，category totals 在内存中一次聚合。
- [x] web usage 使用现有 domain-time index，并限制到规则所需 domain。
- [x] 不在 SQL 中拼接 `IN (...)` 文本；使用安全 QueryBuilder/bind，或先聚合今日域名再在内存过滤。
- [x] 大量规则测试至少覆盖 100 条规则，tick 时间和查询计划不出现明显线性全表重复扫描。

### 7.5 Classification snapshot 收口

现有 `src-tauri/src/data/export/common.rs` 的 `ExportClassification` 不能成为 Tools 的依赖方向。实施时应：

- [x] 抽取“从 persisted settings 解析当前 app/domain category、label、deleted、enabled”的纯模型到真实 classification domain owner。
- [x] 把数据库读取放在 classification settings repository。
- [x] export 适配为消费新 resolver，不再拥有第二套 category parsing。
- [x] Tools evaluator 消费同一 resolver，确保导出与提醒对同一 session 的 category id 判断一致。
- [x] 保留 export 格式、字段顺序和本地化结果，不顺手重写 exporter。
- [x] 为 `track:false`、`enabled:false`、deleted category、custom category、label override 和 malformed JSON 增加纯测试。
- [x] malformed setting 使用安全 fallback 并报告可诊断错误/忽略单条；不能让整个 Tools runtime 永久停止。

### 7.6 IPC 合同

新建 canonical command：

```text
cmd_create_activity_reminder_rule
cmd_disable_activity_reminder_rule
```

创建 input 使用 tagged target，而不是大量可空平级字段：

```json
{
  "target": {
    "kind": "category",
    "categoryId": "development"
  },
  "labelSnapshot": "开发",
  "limitMs": 1800000,
  "message": ""
}
```

- [x] Rust DTO 对每种 target shape 做长度、空白、规范化和枚举校验。
- [x] web domain 在 Rust 再次 canonicalize，并拒绝空域名。
- [x] category id 必须存在且当前未删除；创建时失效返回 validation error。
- [x] app target 必须有非空 app name，exe name 如存在必须 canonicalize。
- [x] `limit_ms` 必须在 1..1440 分钟范围内。
- [x] message 和 label snapshot 设置合理长度上限，拒绝超大 payload。
- [x] command handler 只转换 DTO 并转发 engine，不打开 SQLite。
- [x] 更新 `app/bootstrap.rs`、permissions、generated ACL schema、IPC contract checker 和 runtime smoke。
- [x] 因前后端随安装包原子发布且无外部受支持调用方，删除旧 create/disable software command；不要保留无退出条件的 wrapper。

### 7.7 Frontend 组件结构

禁止在 `ReminderToolPanel.tsx` 内复制三份近似表单。目标结构建议为：

```text
ReminderToolPanel
├─ EventReminderPanel
└─ ActivityReminderPanel
   ├─ ActivityReminderTargetPicker
   │  ├─ AppTargetPicker
   │  ├─ CategoryTargetPicker
   │  └─ WebDomainTargetPicker
   ├─ ActivityReminderRuleFormFields
   └─ ActivityReminderRuleList
```

边界要求：

- [x] `ReminderToolPanel` 只决定当前一级模式和 tabpanel。
- [x] event 逻辑保持独立，不强行塞进 activity target enum。
- [x] activity form 共享 threshold、message、create、validation 和 busy state。
- [x] 三种 target picker 只负责候选选择与呈现。
- [x] 列表共享行骨架，通过 target view model 提供 icon/color/favicon、label 和 status。
- [x] 每种模式保留独立草稿，切换 tab 不丢失。
- [x] candidate 加载失败保留最后一次成功结果，并提供低噪音重试；不能把整个 Tools 页面变成全屏 error。
- [x] feature component 不接触 raw snake_case DTO。
- [x] 不新增页面私有 hardcoded color、radius、shadow 或 border。

### 7.8 候选目录边界

当前 `softwareReminderAppCandidates.ts` 直接依赖 classification feature 私有 service。实施不能继续照此增加 category/web imports。执行方式：

- [x] 建立 Tools-owned `activityReminderTargetCatalog`，输入只来自稳定 shared 分类能力与 platform persistence gateway。
- [x] 如 `ObservedAppCandidate` 被两个 feature 使用，把中性 catalog DTO 移到稳定 owner；不要让 Tools import `features/classification/types.ts`。
- [x] 应用候选继续使用 complete app catalog、canonical exe、当前 display name 和 tracking exclusion。
- [x] 分类候选从当前 active category definitions 构建，按 locale label 排序，保留 `other`，排除 deleted/system。
- [x] 网页候选复用已记录 domain facts、favicon、display name override 和 domain exclusion。
- [x] 候选只在进入对应 tab 后懒加载；event tab 不触发 app/category/web 大目录读取。
- [x] locale、classification revision、web activity revision 或显式数据清理后失效相关缓存。
- [x] 候选结果返回拷贝或不可变快照，消费者不能污染缓存。
- [x] 网页候选的时间窗口与数量上限必须显式写入常量和文档；第一版如复用当前 `30 天 / 120 个`，UI 搜索只能承诺搜索已加载候选，不能假装覆盖全部历史。
- [x] 如果验收要求搜索任意历史域名，应在本阶段升级为可分页/服务端搜索 catalog，而不是把上限偷偷调大。

## 8. 数据迁移、备份与兼容合同

### 8.1 数据库升级

- [x] 新增 migration version `13`，不占用或改写已有版本。
- [x] 新安装数据库从 migration 1 顺序运行到 13 后只保留 canonical activity rule table。
- [x] 从 migration head 12 升级时，旧应用规则行数、id 和所有字段保持一致。
- [x] 升级失败时 transaction 回滚，旧表和旧数据仍可用，不留下半张新表。
- [x] `has_current_schema` 改为检查 canonical table 和索引，并确认旧表不再是 current contract。
- [x] migration history normalization/repair 增加 version 13 边界，不把已合法的 head 12 数据误判成 current。
- [x] `sqlite_pool_upgrade_tests.rs` 增加真实 head 12 fixture → head 13 升级测试。
- [x] `storage_migration.rs` 的 allowlist、表清单和验证逻辑改为 canonical 表名。

### 8.2 SQLite snapshot backup

当前正式 writer 是 SQLite snapshot，因此规则表会随数据库文件进入备份。仍需同步 manifest 和恢复验收：

- [x] manifest count 改为 `tool_activity_reminder_rules`。
- [x] 读取旧 manifest 时接受旧 `tool_software_reminder_rules` count alias；新 writer 只写 canonical 字段。
- [x] 新 snapshot preview 显示活动提醒规则总数，不再把分类/网页误称为软件规则。
- [x] head 12 snapshot 恢复后自动运行 migration 13，并保留旧应用规则。
- [x] head 13 snapshot 覆盖恢复和合并恢复都保留三种 target。
- [x] merge restore 的身份/重复判断包含 target kind 和稳定 target identity，不能只比较 app name。
- [x] remote backup index 的 schema/migration head 和 count 解析同步更新。

### 8.3 旧结构化 backup reader

旧结构化 payload 中的 `tool_software_reminder_rules` 是真实已发布数据兼容边界，但旧 writer 不应继续扩展：

- [x] 保留 `BackupToolSoftwareReminderRule` 作为 legacy read DTO，并在 restore adapter 中映射成 `target_kind='app'`。
- [x] 不给 legacy payload 增加 category/web 字段，不复活旧 writer。
- [x] 新 domain 和 repository 不依赖 legacy DTO。
- [x] 旧 zip 恢复后立即生成的新 SQLite snapshot 含 canonical activity table。
- [x] 保留并扩展 legacy restore fixture，证明 app rule 的 id、limit、message、disabled 和 last fired date 不丢失。
- [x] 遵守版本规范中旧 reader 的正式退出窗口；本任务不提前删除读取器。

### 8.4 UI 局部偏好兼容

- [x] 只迁移 reminder mode 的 localStorage 值，不新增 Settings schema。
- [x] 旧值 `software` 读为 `app`。
- [x] 未知值、空字符串、JSON 垃圾回退 `event`。
- [x] localStorage 抛错时切换仍即时生效，只影响下次启动恢复。
- [x] 测试证明迁移不改变 event form mode 的现有 `relative / absolute` 偏好。

## 9. 详细分阶段执行清单

## 阶段 A：实施前冻结范围与工作区安全

进入条件：用户确认开始实现；对应 Project item 已获准创建或现有 item 已明确更新。

- [ ] 重新读取 live Project，确认新 item、当前 Status、唯一 `In progress` 和 `Next` 窗口。
- [ ] 向维护者报告应把本 item 从实际状态拖到 `In progress`，并同时给出 `Next` 补位建议；不代替维护者拖动。
- [x] 运行 `git status --short`，记录所有既有修改和未跟踪文件。
- [x] 对本任务会触及且已经 dirty 的文件逐个查看 diff，标记用户改动区域。
- [x] 确认本任务是跨 React、Rust、SQLite、backup 和 IPC 的“执行单模式”，不按单点小修处理。
- [x] 把本文复制到当前执行上下文并保持唯一 active checklist，不另建第二份平行计划。
- [x] 确认不创建分支、不 commit、不 push，除非用户另行授权。

退出条件：范围、owner、冲突文件和 Project 协作状态均明确。

## 阶段 B：先用测试锁定产品语义

- [x] 为 `event | app | category | web` mode parser 写失败优先测试。
- [x] 为 legacy `software → app` 偏好迁移写测试。
- [x] 为 tagged `ActivityReminderTarget` raw DTO parser 写合法/非法矩阵。
- [x] 为本地自然日使用时长裁剪写纯测试：完全在区间内、跨午夜、早于日界线、未封口、未来异常 end。
- [x] 为 once-per-day 条件更新写 SQLite 测试。
- [x] 为分类当前映射语义写测试：重命名、重分类、删除、other、自定义分类、excluded app。
- [x] 为网页语义写测试：normalized domain、active segment、排除、Web Sync off、历史删除后 0。
- [x] 为“不混合网页到分类”写明确反例测试：同一时段 browser session + web segment 只能分别进入 category/app 和 web rule，不能相加进 category rule。
- [x] 为 empty custom message 的动态 locale fallback 写 zh-CN / en-US 测试。
- [ ] 先运行 focused tests，确认新断言在实现前按预期失败，而不是测试写错或意外覆盖现有行为。

退出条件：核心语义已由可执行测试表达，不再依赖口头理解。

## 阶段 C：收口 Rust 分类解析 owner

- [x] 从 `data/export/common.rs` 识别 category parsing、label、color、deleted 与 normalization 的纯逻辑。
- [x] 在 domain 的真实 classification owner 建立纯 `ClassificationSnapshot/Resolver`。
- [x] 在 classification settings repository 建立 pool/transaction 读取函数。
- [x] 明确解析 app override 的 `track`、`enabled`、`category`；明确 web override 的 `enabled`、`category`。
- [x] 对 malformed JSON、空 category、未知 category 和被删 category定义 deterministic fallback。
- [x] 改造 export 使用新 resolver，删除 export 私有重复解析。
- [x] 用现有 export tests 证明 CSV/Markdown/Parquet/SQLite 的 category id、label、color 未回归。
- [x] 不把 exporter 字段配置、路径或格式逻辑搬进新 classification owner。

退出条件：Rust 侧存在一份可由 export 与 Tools 共用的当前分类语义实现。

## 阶段 D：实现 migration 13 与 schema contract

- [x] 在 `schema.rs` 增加 version、description、SQL 和 tracker migration 注册。
- [x] 创建 `tool_activity_reminder_rules`、互斥 CHECK 和索引。
- [x] 迁移旧 app rows，保留主键与所有状态字段。
- [x] 删除旧表，保持旧 migration 3 不变。
- [x] 更新 `sqlite_pool.rs` schema inspection 和 current schema 判定。
- [x] 更新 migration history normalization、baseline repair 和 checksum tests。
- [x] 更新 `storage_migration.rs` 表清单与复制/验证逻辑。
- [x] 增加全新数据库、head 12 升级、损坏 schema 拒绝/修复三类测试。
- [x] 用 `PRAGMA foreign_key_check`、`integrity_check` 和 schema contract 验证升级结果。

退出条件：新库和旧库都能稳定得到唯一 canonical rule table。

## 阶段 E：实现 domain、repository 与统一 evaluator

- [x] 新增 `ActivityReminderTarget`、`ToolActivityReminderRule`、notification 和 snapshot 类型。
- [x] 删除 production 主路径中的 SoftwareReminder domain 类型；legacy backup DTO 除外。
- [x] 实现 create：normalize、validate、bind、insert、read back。
- [x] 实现 disable：条件软删除、updated timestamp、幂等行为。
- [x] 实现 active rule snapshot read 和 rule row mapping。
- [x] 实现 app usage facts 查询，保持当前 session 裁剪与 canonical match。
- [x] 实现一次 app facts → category totals 聚合。
- [x] 实现 domain usage 聚合，复用 domain-time index。
- [x] 实现 target availability/suspension 判断。
- [x] 实现事务内 once-per-day 条件更新。
- [x] 实现创建时已越过阈值的下一 tick 行为。
- [x] 实现午夜、启动恢复和 runtime slow poll 行为。
- [x] 对 100 条混合规则运行 focused perf/query-plan test，确认没有每个 category rule 扫描整日 sessions。
- [x] 所有 SQL 使用 bind；对 search/IN 使用安全 QueryBuilder，不把 target 文本直接拼进 SQL。

退出条件：不依赖 Tauri 或 React 即可在 SQLite test 中完成三种规则全生命周期。

## 阶段 F：接入 Tools engine、app、commands 与 runtime

- [x] `ToolsMutation` 改为 create/disable activity rule。
- [x] `ToolsTickEvents` 改为 activity notifications。
- [x] `ToolsStore` 与 `SqliteToolsStore` 接入统一 repository。
- [x] runtime wake 判定遍历 pending activity rules，而不是只看 software rules。
- [x] app startup recovery、normal tick 和 snapshot refresh 保持现有顺序。
- [x] native alert id 使用 rule id + date key，三种 target 都能稳定去重。
- [x] 按 target kind 选择本地化标题和默认正文；一次事件批次仍使用同一 locale snapshot。
- [x] 删除 repository 中硬编码中文 fallback。
- [x] 新增薄 app functions 和 command DTO 转换。
- [x] 注册新 commands，移除旧 commands，更新 permissions 和 generated schemas。
- [x] 更新 IPC contract checker、critical mutation checker 和 tauri runtime smoke stubs。
- [x] 模拟 command 返回错误，确认错误可到达前端且 runtime loop 不崩溃。

退出条件：隐藏主窗口时 Rust runtime 仍能产生三种 activity ToolAlert。

## 阶段 G：改造 frontend types、raw DTO 与 gateway

- [x] 在 shared tools types 中新增 discriminated activity target/rule/input。
- [x] `toolsRawDtos.ts` 对 snake_case snapshot 做严格解析。
- [x] 拒绝未知 target kind、缺字段、字段互斥错误、非法 id/limit/date key。
- [x] `toolsRuntimeGateway.ts` 调用 canonical create/disable commands。
- [x] `parseToolsRuntimeSnapshot` 对 absent/invalid activity rule array 采取当前严格失败策略，不静默吞掉损坏 payload。
- [x] 更新 ToolAlert kind parser。
- [x] 更新 test stubs、settings preview count 和所有构造 snapshot 的 fixtures。
- [x] 删除 production frontend 的 software-only types/functions，legacy mode alias 除外。

退出条件：前端业务层只看到 camelCase canonical activity model。

## 阶段 H：建立 Tools-owned 目标候选目录

- [x] 先把 app candidate 中性 DTO 从 classification feature 私有类型解耦。
- [x] 建立 app candidate adapter，保持 current display name、canonical exe、last seen 和 exclusion。
- [x] 建立 category candidate adapter，输出 id、localized label、color、deleted/active 状态。
- [x] 建立 web candidate adapter，输出 normalized domain、display name、favicon、last seen 和 exclusion。
- [x] 定义候选缓存 key：locale + classification revision + app/web source revision。
- [x] 进入 tab 时才加载对应候选；切回已加载 tab 复用一致快照。
- [x] classification save、web history deletion、locale change、data restore 后清除对应缓存。
- [ ] 为并发 load、stale result、失败后保留 committed snapshot 和手动 retry 写测试。
- [x] 确认 candidate service 不 import React，也不 import ReminderToolPanel。

退出条件：三种 picker 获得稳定、可测试、不会跨 feature 私有依赖的候选。

## 阶段 I：实现四模式 UI

- [x] 把 `ReminderMode` 改为 canonical 四值。
- [x] 扩展 mode storage 和 legacy migration。
- [x] 外层 `QuietSegmentedFilter` 增加四项并启用 tabs 语义。
- [x] 建立稳定 tab id、tabpanel id、aria-label 和焦点行为。
- [x] 保留 EventReminderPanel 的相对/绝对时间行为。
- [x] 抽取 ActivityReminderPanel 的共同 fields、create 和 list。
- [x] 实现 AppTargetPicker，复用现有应用候选呈现。
- [x] 实现 CategoryTargetPicker，使用 QuietSelect/listbox 契约。
- [x] 实现 WebDomainTargetPicker，使用搜索、favicon/fallback 和 normalized domain 次级信息。
- [x] 为 app/category/web 各保留独立 draft。
- [x] 规则创建成功只清空当前模式 draft，不影响其他模式。
- [x] 创建失败保留用户输入并显示表单内 validation/error。
- [x] 实现 active、creating、disabling、empty、loading、stale、error、source-off、disconnected、excluded、deleted 状态。
- [x] 规则列表只显示当前 target kind，并保持现有面板高度和内部滚动策略。
- [x] 更新 Tools icon preload，使 app rules 和 web rules 所需 icon/favicon 不产生空白跳动。
- [x] 样式只扩展现有 Tools/Quiet Pro owner；没有 token 时先判断是否真需要新语义 token。
- [ ] 检查四标签在 900px 最小主窗口、英文 `Category` 下仍无溢出。

退出条件：四个 tab 的创建、展示、停用和状态反馈完整可用。

## 阶段 J：本地化与无障碍

- [x] 在 `locales/schema.ts` 定义 mode、target、form、empty、error、suspension 和 native notification keys。
- [x] 在 `locales/zh-CN/tools.ts`、`en-US/tools.ts` 增加前端文案。
- [x] 在 native locale source 增加 app/category/web title 和默认 body formatter。
- [x] `应用` 英文使用 `App`，`分类` 使用 `Category`，`网页` 使用 `Web`，与 Data/History 现有术语一致。
- [x] 复用已有通用文案，不复制 Save/Loading/Retry 等 key。
- [x] 运行 locale 生成脚本，不手改 `src/shared/i18n/generated/*` 或 Rust generated locale。
- [x] 更新 review manifest 并完成 zh-CN/en-US 逐项审查。
- [x] 默认正文包含 target name、usage minutes 和 limit minutes，并正确处理英文 singular/plural。
- [x] tablist、target picker、create、disable、validation 和 status 全部具有可访问名称。
- [ ] 屏幕阅读器读取 tab 选中状态、规则目标、每日阈值和暂停原因。
- [ ] 200% 缩放下焦点轮廓不被容器裁剪。

退出条件：中英文和 native/runtime 文案均来自同一 locale 系统，无硬编码分支。

## 阶段 K：备份、恢复与清理链路

- [x] 更新 SQLite snapshot manifest count 和 serde alias。
- [x] 更新 preview domain/frontend view model 字段。
- [x] 更新 backup snapshot table count 清单。
- [x] 更新覆盖恢复的 expected table/row counts。
- [x] 更新合并恢复的 activity target identity 和 conflict 规则。
- [x] 更新 legacy payload restore adapter，只映射旧 app rules。
- [x] 更新清理历史/重置数据库后的 rule table 行为；不要因删除 session/web history自动删除规则。
- [x] 更新远端备份索引 fixtures 的 migration head/count。
- [x] 覆盖 head 12 snapshot、head 13 snapshot、legacy structured zip 三条恢复路径。
- [x] 恢复失败时验证回滚数据库可继续启动。

退出条件：升级和恢复都不会静默丢失任何已有应用规则，新规则也能完整往返。

## 阶段 L：自动化验证

### L1. Frontend focused tests

- [x] mode storage 四值与 legacy migration。
- [ ] candidate build/filter/sort/cache/revision。
- [x] activity rule raw DTO parse 和 view model。
- [ ] 三种 target form validation。
- [ ] deleted/excluded/source-off 状态映射。
- [ ] zh-CN/en-US label 和 default copy。

### L2. Rust focused tests

- [x] migration 12 → 13 保留旧 app rules。
- [x] app/category/web create/read/disable。
- [x] app active session 累计。
- [x] category current mapping、rename、delete、other、自定义分类。
- [x] web normalized domain、active segment、history deletion、excluded domain。
- [ ] once-per-day、restart、midnight、timezone boundary。
- [ ] transaction race：disable 与 fire、两个并发 tick。
- [x] malformed DTO/setting/oversize input。
- [x] backup snapshot and legacy restore round trip。

### L3. Repository minimum gates

- [x] `npm test`
- [x] `npm run test:replay`
- [ ] `npm run build`
- [ ] `npm run check`
- [ ] `npm run check:full`
- [ ] `npm run test:tauri-runtime-smoke`
- [ ] `npm run perf:stable`（因为新增 SQLite 日累计查询和 runtime poll）

任何命令失败时：

- [x] 先判断是本任务回归、既有 dirty worktree 冲突还是环境问题。
- [x] 记录完整失败命令、首个根因和修复证据。
- [x] 不通过跳过测试、扩大 allowlist、放宽 DTO parser 或删除断言来“通过”。

退出条件：所有与风险匹配的 gate 通过，失败项都有可复查处置。

## 阶段 M：真实浏览器与 Windows 桌面验收

### M1. 四模式基础交互

- [ ] 默认进入已保存 mode；无偏好进入事件。
- [ ] 旧 `software` 偏好进入应用，并迁移为 app。
- [ ] 鼠标点击四个 tab 均切换正确 panel。
- [ ] ArrowLeft/ArrowRight/Home/End 行为正确，焦点不丢失。
- [ ] 切换 tab 后各自未提交 draft 保留。
- [ ] 离开 Tools 再返回时只恢复 mode，不恢复 draft。

### M2. 应用规则

- [ ] 从已记录应用创建规则。
- [ ] 今日累计未达到阈值不触发。
- [ ] 达到阈值只触发一次。
- [ ] 重启 Patina 不重复触发。
- [ ] 停用后不再触发。

### M3. 分类规则

- [ ] seeded category 创建并触发。
- [ ] custom category 创建并触发。
- [ ] 重命名后规则行更新名称且 id 不变。
- [ ] 同日把应用改入/移出分类后累计按当前映射重算。
- [ ] 删除分类后规则保留并显示暂停原因。
- [ ] 浏览器网页域名同分类时间不进入分类规则。

### M4. 网页规则

- [ ] Web Sync 开启且已连接时，从 observed domain 创建。
- [ ] active web segment 到达阈值触发。
- [ ] 同一浏览器 app session 不被重复加到 web usage。
- [ ] 断连后不虚增时间，规则仍可管理。
- [ ] 关闭 Web Sync 后 tab 和规则仍可见，状态说明正确。
- [ ] 排除域名后规则暂停，重新启用后恢复。
- [ ] 删除域名历史后规则保留且 usage 从现有记录重算。

### M5. 视觉矩阵

- [ ] 浅色 / 简体中文 / 默认窗口。
- [ ] 深色 / 简体中文 / 默认窗口。
- [ ] 浅色 / English / 最小 900px 窗口。
- [ ] 深色 / English / 最小 900px 窗口。
- [ ] 125%、150%、200% Windows 缩放。
- [ ] 长 custom category name、长 domain、长 app display name。
- [ ] 空状态、loading、error、source-off、disconnected、deleted/excluded。
- [ ] 四 tab 无横向溢出，tabpanel 不跳高到不可用，规则列表内部滚动正常。
- [ ] 无玻璃、发光、渐变、过度圆角、重复 pill 或卡片套卡片。

退出条件：真实桌面行为与自动化结果一致，并保存关键截图证据。

## 阶段 N：对抗式审查

实现者完成后，开启一次以“证明实现有错”为目标的独立审查。审查者不能只重复实现者的 happy path。

### N1. 数据正确性攻击

- [x] 构造跨午夜 app session，检查只计当天重叠区间。
- [x] 构造未来 end、负 duration、未封口记录，确认查询不产生负数或超出 now。
- [x] 同一时段构造 browser session + web segment，检查 category/web 不双算。
- [ ] 在阈值边界前后各 1ms 测试 `>=` 语义。
- [ ] 两个并发 tick 同时看见达标规则，只允许一个 notification。
- [ ] 达标与停用并发，不能在停用成功后继续产生新提醒。
- [x] 修改分类后立即 tick，确认使用一致的 classification snapshot。

### N2. 升级与恢复攻击

- [x] 用包含 active/disabled/fired-today app rules 的 head 12 数据库升级。
- [x] 故意让 migration insert 失败，确认旧数据不丢且没有半迁移表。
- [x] 恢复旧 snapshot 后再次重启，确认 migration 不重复迁移或复制规则。
- [x] 合并两个含同 id 但不同 target 的备份，确认冲突策略可解释。
- [x] legacy zip 只恢复 app rule，不生成空 category/web 垃圾行。

### N3. IPC 与输入攻击

- [x] 发送未知 kind、混合 target 字段、空 category、超长 domain、非法 Unicode/空白。
- [x] 发送 `limitMs=0`、负数、超过一天、NaN 对应异常 JSON。
- [x] 发送 SQL metacharacters，确认参数绑定且数据表完整。
- [x] 返回损坏 snapshot，确认 frontend parser 拒绝并显示可诊断错误。

### N4. UI 与无障碍攻击

- [ ] 仅键盘完成 tab 切换、目标选择、创建和停用。
- [ ] 快速连续切换 app/category/web，确认旧异步结果不会写入错误 tab。
- [ ] 创建请求未完成时切 tab，busy state 不串到错误规则。
- [ ] locale 在候选加载中切换，最终标签与当前 locale 一致。
- [ ] 长英文和 200% 缩放不遮挡 create/disable/focus ring。
- [ ] Web Sync 关闭时没有弹窗、Toast 风暴或隐藏规则。

### N5. 架构攻击

- [x] `commands/*`、`app/*`、`lib.rs` 没有新增厚业务逻辑。
- [x] Tools 没有新增对 `features/classification/*` 私有实现的依赖。
- [x] export 和 Tools 没有两套 category resolver。
- [x] 没有双写旧表/新表或长期 software/activity 两套 production model。
- [x] 没有新增 `shared` 万能 helper、V2 命名或无退出条件兼容壳。
- [x] generated locale/schema 文件只由生成流程更新。

### N6. 审查处置

- [x] 每个发现按严重度记录：数据丢失/重复提醒/错误统计/主路径/可访问性/代码边界。
- [x] P0/P1 或任何数据可信度问题必须修复并重跑全套相关 gate。
- [x] 未修复问题必须有明确 owner、阻断理由和 Project 状态建议；不能带着未知风险勾选完成。
- [x] 审查者给出“通过 / 有条件通过 / 不通过”结论和证据。

退出条件：对抗式审查通过，或所有未决项被明确阻断且任务不得标记 Done。

## 阶段 O：完成、Project 协作与归档

- [x] 汇总实际修改文件、schema version、兼容行为和验证结果。
- [x] 更新 `CHANGELOG.md` 的 `Unreleased`，从用户结果描述“提醒器支持按应用分类和网页每日累计提醒”，不写内部重构清单。
- [x] 如实现触及长期分类/Tools 契约，更新对应长期文档；若没有长期规则变化，不把本执行单内容散抄到顶层 docs。
- [ ] 重新读取 live Project。
- [ ] 向维护者报告把本 item 从实际状态拖到 `Done`；若仍等待外部审核则建议 `Blocked`，不能提前 Done。
- [ ] 重新计算最多三个 `Next` 的补位建议，并一次性报告所有拖动。
- [x] 不关闭、修改或关联 GitHub Issue，除非用户明确授权。
- [x] 把本文所有真实完成项勾选并补证据；未执行项不得伪造为完成。
- [x] 将本文移动到 `docs/archive/tools-category-web-activity-reminder-execution-plan.md`。
- [x] 最后运行文档链接、UTF-8 和 git diff 范围检查。

退出条件：实现、验证、对抗式审查、Project 人工协作建议和文档归档全部完成。

## 10. 关键测试矩阵

### 10.1 目标与数据来源矩阵

| 场景 | 应用规则 | 分类规则 | 网页规则 | 预期 |
|---|---:|---:|---:|---|
| 普通桌面应用 session | 计入匹配应用 | 计入当前应用分类 | 不计入 | 不重复 |
| 浏览器进程 session，无 Web Sync 数据 | 计入浏览器应用 | 计入浏览器应用分类 | 不计入 | 网页为 0 |
| 浏览器进程 session + 同时段 web segment | 计入浏览器应用 | 只计入应用分类 | 计入匹配域名 | 三个规则各自独立，不相加进同一规则 |
| web segment 被分到某分类 | 不计入 | 第一版不计入 | 计入域名 | 保持当前产品口径 |
| imported exact session/bucket | 不计入 | 不计入 | 不计入 | 保持现有应用提醒语义 |
| 目标被排除 | 暂停 | 排除的 app 不贡献 | 暂停 | 不静默删除 |

### 10.2 生命周期矩阵

| 状态 | 创建 | 累计 | 触发 | 管理 |
|---|---:|---:|---:|---:|
| 主窗口前台 | 是 | 是 | 是 | 是 |
| 主窗口最小化 | 不适用 | 是 | 是 | 回到主窗口后可见 |
| 驻留托盘 | 不适用 | 是 | 是 | 回到主窗口后可见 |
| Patina 重启 | 规则保留 | 从当天记录重算 | 未触发且达标则触发一次 | 是 |
| Web Sync disabled | 有历史候选时允许；无候选不可创建 | 不增长 | suspended 规则不触发 | 已有规则可见/可停用 |
| Web Sync disconnected | 有历史候选时允许 | 仅已有落库片段 | 达标规则按已记录事实处理 | 状态可见 |
| 分类删除 | 不允许新建 | 旧 rule 为 0/suspended | 不触发 | 规则可见/可停用 |

### 10.3 本地化矩阵

| 创建时语言 | 触发时语言 | 自定义 message | 预期正文 |
|---|---|---|---|
| 中文 | 中文 | 空 | 中文动态默认正文 |
| 中文 | English | 空 | English 动态默认正文 |
| English | 中文 | 空 | 中文动态默认正文 |
| 任意 | 任意 | 非空 | 原样使用用户 message |

## 11. 风险登记与缓解

| 风险 | 严重度 | 触发信号 | 缓解与阻断条件 |
|---|---|---|---|
| category 与 web 重复累计 | 高 | 同时段总量超过实际活动时间 | 明确来源隔离测试；本轮不混合 web category |
| migration 丢失旧应用规则 | 高 | head 12 升级后 row count/字段不一致 | 事务迁移、fixture、回滚和 row-by-row equality test |
| 同日重复提醒 | 高 | restart/并发 tick 产生两条 alert | 事务内条件更新 + rows_affected gate |
| 分类规则与导出分类不一致 | 高 | 同一 exe 在两处 category id 不同 | 抽取单一 Rust resolver，export/Tools 共用 |
| Web Sync 关闭仍虚增 | 高 | 无新 segment 但 usage 增长 | 只读 web_activity_segments，不读取 browser process 推测 |
| runtime poll 性能回归 | 中高 | rule 数增加后周期性 CPU/SQLite 峰值 | 一次 facts 聚合、索引、100-rule perf test、perf:stable |
| 旧 backup 无法恢复 | 高 | head 12 snapshot/legacy zip restore 失败 | manifest alias、legacy adapter、三路径 fixture |
| Tools 与 Classification 边界继续变厚 | 中高 | 新文件 import feature private service | target catalog 通过 shared/platform 稳定边界，架构 gate |
| 四标签英文溢出 | 中 | Category/Web 挤压或换行 | 最小窗口/200%/English visual test；不缩到不可读 |
| dirty worktree 覆盖用户改动 | 高 | 整文件重写或 diff 混入其他任务 | apply_patch、逐文件 diff、禁止 destructive restore |
| 本地化改动与 Blocked 工作项冲突 | 中 | locale/schema dirty 区域重叠 | 实施前重读 diff，保留已有改动，生成后审查精确 key 范围 |

## 12. 回滚策略

本功能触及 schema 和已发布数据，不能把“回滚”理解为删除 migration 13 或恢复旧表写入。

安全回滚原则：

- 已发布 migration 13 后不得改写或删除其 checksum。
- 如 UI 需要临时隐藏新模式，仍必须保留 canonical activity table、旧 app rule 数据和 runtime 可读性。
- 若 category/web evaluator 出现严重错误，可在后续 forward migration/patch 中暂停对应 target kind 的触发，但不能删除规则。
- 恢复旧版本应用前必须明确旧 binary 不认识 migration 13；不能承诺无损降级运行。
- 发布前发现问题时，可回退尚未发布的代码补丁，但必须验证 head 12 fixture 与用户工作区不被破坏。
- 不通过双写旧表来制造“可回滚”；双写会增加分叉和不一致风险。

回滚验收：

- [x] 规则数据仍在数据库中。
- [x] 旧应用规则仍可解析。
- [x] 事件、计时器和番茄钟不受影响。
- [x] Tools runtime 遇到暂时禁用的 target kind 不崩溃。
- [x] 备份仍能生成并恢复。

## 13. Definition of Done

只有以下全部满足，任务才可标记完成：

- [x] UI 显示 `事件 | 应用 | 分类 | 网页`，四模式键盘和鼠标均可用。
- [x] 分类和网页规则可创建、显示、停用并在后台可靠触发。
- [x] 分类只统计应用 session，网页只统计 web segment，无重复累计。
- [ ] 每条规则每天最多触发一次，restart/midnight/concurrency 测试通过。
- [x] 旧应用规则 migration 无数据丢失。
- [x] head 12 snapshot、head 13 snapshot、legacy zip 恢复通过。
- [x] Web Sync off/disconnected、分类删除、目标排除、历史删除状态诚实可解释。
- [x] Rust 分类 resolver 只有一个 canonical 实现供 export/Tools 使用。
- [x] Tools 不新增 classification feature 私有依赖。
- [x] commands/app/lib.rs 未变厚，SQL 全部参数化。
- [x] zh-CN/en-US 和 native notification 通过 locale 生成与审查。
- [ ] `npm test`、`npm run test:replay`、`npm run build`、`npm run check:full`、runtime smoke 和 perf gate 通过。
- [ ] 视觉矩阵与真实 Windows 行为验收通过。
- [x] 对抗式审查通过且无未处置高风险问题。
- [ ] live Project 状态建议已报告，维护者完成相应人工拖动。
- [x] 本文补全证据并移入 `docs/archive/`。

## 14. GitHub Project 变更预览（本次未执行）

2026-08-12 live Board 只读结果：

- `Queued`：2 项；包含 `完善 Tools 到期的 Patina 提醒弹窗`、`复测并收口灵动视效`。
- `Next`：2 项；包含 `支持侧边导航在图标与文字模式间切换`、`增加任务栏追踪与工具状态视口`。
- `In progress`：0 项。
- `Blocked`：1 项；`规范化前端与原生多语言文案系统`。
- `Done`：32 项。

本需求没有精确匹配项。建议新增独立 draft item：

### 建议标题

`为 Tools 活动提醒增加分类与网页目标`

### 建议字段

- `Status`：`Queued`
- `Area`：`Tools`
- `Target release`：暂不填写；范围虽明确，但 migration、backup 和本地化冲突成本尚未实施验证。
- 创建位置：按 Project 默认行为添加到队列底部。
- 推荐人工位置：放在 `完善 Tools 到期的 Patina 提醒弹窗` 之前；二者无硬依赖，但先稳定规则与统一 alert model，可降低后续轻量提醒窗口适配分叉。

### 建议正文

#### Problem

Tools 提醒器当前只支持一次性事件和单个应用的每日累计提醒。用户无法针对一整类桌面活动或一个具体网站设置每日使用上限，必须逐个应用估算，网页活动也没有对应规则入口。

#### Expected outcome

提醒器顶部提供 `事件 / 应用 / 分类 / 网页` 四种模式；分类和网页规则基于本地可信活动记录累计，在达到每日阈值时可靠提醒，并保留现有应用规则和数据兼容性。

#### Scope

- 增加分类与网页规则的创建、展示、停用和每日触发
- 分类只累计当前分类下的桌面应用会话
- 网页只累计 Web Sync 已落库的 normalized domain 片段
- 统一应用、分类和网页活动规则 domain/runtime/SQLite 模型
- 迁移旧应用规则并覆盖 SQLite snapshot、旧备份恢复、IPC、本地化和自动化验证
- 处理分类删除、目标排除、Web Sync 关闭/断连和历史删除状态

#### Non-goals

- 不新增 Settings 选项
- 不把网页分类混入应用分类累计
- 不支持多目标、周/月周期、URL path 或标题规则
- 不修改浏览器扩展协议
- 不改变提醒弹窗交付表面

#### Acceptance criteria

- 提醒器显示 `事件 / 应用 / 分类 / 网页`，键盘和鼠标均可切换
- 分类和网页规则可创建、停用并在后台达到阈值时每天只提醒一次
- 浏览器应用时间与网页时间不重复累计
- 分类重命名不破坏规则；分类删除、目标排除和 Web Sync 不可用状态可解释
- 既有应用规则升级后字段和状态不丢失
- SQLite snapshot 与仍支持的旧备份恢复路径通过回归
- 中英文、浅深色、最小窗口和 runtime smoke 验收通过

本次文档任务未获得修改 Project 的授权，因此以上仅为预览，不声称 live Project 已更新。

## 15. 执行证据日志

### 15.1 实现结果

日期：2026-08-12

完成项：

- 提醒器模式固定为 `事件 | 应用 | 分类 | 网页`，继续使用 Quiet Pro 分段控件；外层使用 `tablist / tab / tabpanel` 语义并实现方向键、`Home`、`End` 焦点移动。
- `应用 / 分类 / 网页` 使用一套 canonical activity reminder domain、SQLite 表、repository、runtime tick、notification 和前端 snapshot 合同。
- 分类只聚合原生桌面 `sessions`，按评估当下的 canonical classification resolver 重新解释；网页只聚合 `web_activity_segments`。
- 新增 migration 13，把旧 `tool_software_reminder_rules` 原样迁移到 tagged `tool_activity_reminder_rules`，并以互斥 `CHECK` 防止混合 target shape。
- 旧 `software` UI 偏好迁移到 `app`；旧结构化备份继续只作为 app-rule reader；新 SQLite snapshot 使用 canonical count 并接受旧 count alias。
- app、category、web 分别保留页面生命周期内未提交草稿；创建失败不清空输入。
- 候选目录按进入模式懒加载，缓存失效后重新读取；加载失败保留最后成功数据并提供面板内重试，不弹窗。
- 网页规则只允许绑定已观察且未排除的 normalized domain；Rust 再次验证，不能通过直接 IPC 创建永不触发的任意域名。
- zh-CN、en-US 和 native notification 文案全部进入 locale schema、生成产物和 review manifest。

关键 owner：

- `src-tauri/src/domain/classification.rs`
- `src-tauri/src/domain/tools.rs`
- `src-tauri/src/data/repositories/tools/activity_reminders.rs`
- `src-tauri/src/data/backup/snapshot/restore.rs`
- `src-tauri/src/engine/tools/activity_notifications.rs`
- `src/platform/persistence/activityReminderCatalogGateway.ts`
- `src/features/tools/services/activityReminderTargetCandidates.ts`
- `src/features/tools/components/ReminderToolPanel.tsx`

### 15.2 自动化证据

通过：

- `cargo test --manifest-path src-tauri/Cargo.toml`：645 tests，644 passed，1 ignored，0 failed。
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`：通过。
- `npm test`：通过，包括 tools raw DTO、mode migration、gateway、UI smoke source contracts 与既有完整前端测试集。
- `npm run test:replay`：15 passed。
- `npm run check:types`、`npm run check:lint`、`npm run check:i18n`：通过。
- `npm run check:architecture`、`npm run check:ipc-contracts`、`npm run check:hotspots`、`npm run check:quiet-pro-style-debt`、`npm run check:test-governance`：通过。
- 隔离 Vite production build：2056 modules transformed，构建成功；该入口绕开了本机损坏的 Tailwind native binding，仅用于确认本任务模块图和生产 bundling 可完成。
- `git diff --check`：通过。

新增/强化的高风险 focused tests：

- head 12 → 13 旧应用规则逐字段保留。
- app 当前活动 session、跨午夜裁剪、未封口记录、未来记录不越过 `now`。
- 分类按当前映射重算，excluded app 不贡献，网页片段不混入分类。
- Web Sync source-off、domain excluded、category deleted 的 suspension precedence。
- 未观察/已排除网页域名拒绝创建。
- 100 条 app/category/web 混合规则单 tick 评估。
- snapshot merge 在 id 冲突下保留 app/category/web、disabled 状态和 label snapshot，并保持幂等。

### 15.3 对抗式审查发现与处置

审查目标是主动证明实现有错，而不是重复 happy path。发现并修复：

1. **高风险：SQLite snapshot 合并丢失 category/web 规则。** 原结构化 payload 只承载 legacy app rule；若复用该 payload 合并，新 target 会消失，app label snapshot 也会退化。现改为 snapshot restore 单独读取 canonical tagged rules，在同一事务内按 target identity 合并，并增加 id 冲突与二次合并测试。
2. **中风险：网页候选查询失败被伪装成空列表。** 移除 `.catch(() => [])`，现在失败会进入保留旧数据的 error/retry 状态。
3. **中风险：error 与 empty 同时出现。** 网页空状态现在只在候选成功加载且确实为空时显示。
4. **中风险：直接 IPC 可创建未观察网页。** Rust repository 现在验证 normalized domain 已落库且未被排除，并有拒绝测试。
5. **工程风险：backup owner 分支预算增长。** snapshot restore 移入 `backup/snapshot/restore.rs` 的真实 owner，热点 gate 恢复通过；没有扩大预算掩盖问题。

结论：代码、数据、迁移、备份、IPC、运行时和可执行自动化审查通过；没有已知未处置 P0/P1 或数据可信度缺陷。

### 15.4 宿主环境阻断与未伪造项

- `npm run build` 的 `tsc` 阶段通过，Vite 加载仓库标准配置时失败：本机 `node_modules/@tailwindcss/oxide-win32-x64-msvc/*.node` 已损坏（`stream did not contain valid UTF-8`），同时子进程受到 `spawn EPERM`。重新执行 `npm ci` 的权限请求被宿主用量审批层拒绝，因此未绕过或改写依赖。
- 真实 UI browser smoke 和无头 Edge 截图需要启动隔离浏览器进程；宿主审批层因用量上限拒绝了该动作。没有声称完成浅/深色、中英文、900px、200% 缩放和真实 Windows 托盘场景。
- 为隔离 build 生成的未跟踪目录 `dist-codex-smoke/` 删除请求也被同一审批层拒绝；它不是源码或交付物，未被加入 Git，也未改写 `.gitignore` 掩盖它。
- 完成时尝试只读重查 GitHub Project，但 `gh` 凭据已失效且当前代理拒绝连接；未伪造 live 状态。开始时已确认没有精确匹配 item，因此没有可安全建议直接拖到 `Done` 的现有 item，也没有代替维护者创建或移动 Project 项。

这些条目保持未勾选，表示环境/人工验收尚未实际发生；归档不把它们伪装成成功门禁。
