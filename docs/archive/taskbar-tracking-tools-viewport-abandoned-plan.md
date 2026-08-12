# Tools：任务栏追踪与工具状态视口执行方案（已放弃）

> 历史状态：该方案已于 2026-08-12 停止执行。Windows 11 任务栏内部结构、绘制层、点击命中、Explorer 生命周期与关闭残留在真实原型中暴露出不可接受的维护风险；未勾选事项保持原样，只用于记录当时的技术判断，不再作为实施依据。
>
> 替代方案：[`挂件常驻展开与追踪/工具计时状态执行方案`](./widget-persistent-expanded-status-execution-plan.md)
>
> 边界说明：替代方案不是任务栏实现的 fallback，也不保留两套运行路径；实施时必须删除任务栏原型，只演进现有 Widget。

> 文档状态：执行前方案已定稿，功能实施尚未开始
> 创建日期：2026-08-12
> 对应 Project：[`增加任务栏追踪与工具状态视口`](https://github.com/users/Ceceliaee/projects/1/views/2?pane=issue&itemId=211267379)
> Project 最近一次已验证字段：`Status = Next`，`Area = Taskbar`
> 已确认目标归属：`Area = Tools`；`Taskbar` 只表示 Windows 显示载体，live Project 字段仍需同步纠正
> 目标平台：Patina 当前正式范围内的 Windows 10 / Windows 11 桌面环境
> 文档归宿：实施与验收完成后移入 `docs/archive/`，不在 `docs/` 顶层形成第二套长期规则

## 1. 如何使用这份执行单

本文是实现型 How-to，不是产品愿景、长期架构母文档或静态 UI 规格。执行时遵守以下规则：

- `[ ]` 表示尚未完成；只有代码、测试或人工证据真实成立后才能改为 `[x]`。
- 每个阶段先完成“进入条件”，再做任务；“退出条件”未满足不得进入下一阶段。
- 技术闸门失败时，按该阶段的“停止条件”停止并记录事实，不得用悬浮窗、Widget 或顶层置顶窗绕过。
- 每次勾选应在条目下补充简短证据，例如测试名、命令结果、Windows build、DPI 或截图观察结论。
- 执行过程中如果产品范围、交互或 owner 与本文明显不一致，先更新 Project 范围并获得确认，再修改本文；不能静默扩大。
- 本文不授权创建分支、提交、推送、发布或修改 GitHub Issue；这些动作仍需维护者在当前任务中明确授权。

## 2. 最终交付目标

在 Windows 原生任务栏内增加一个真正的子窗口视口。它不是桌面挂件，也不是靠坐标贴在任务栏上方的置顶窗。视口固定保留一个模式切换按钮，并支持两种由用户手动选择、不会自动切换的读模式：

1. `追踪模式`：只显示当前追踪应用的图标、追踪状态和当前连续追踪累计时长；普通状态不显示应用名称。
2. `工具模式`：使用工具类型图标和核心时间显示当前活动工具；单工具单行，多工具最多双行；普通状态不堆叠说明文字。

最终结果必须同时满足：

- 视口的原生窗口父级是受支持的 Windows 任务栏窗口，而不是桌面窗口。
- 追踪时长来自 Patina 的真实会话与连续性语义，不是前台窗口存活时间、当天总时长或猜测值。
- Tools 时间直接复用当前计时器、倒计时、番茄钟和提醒的正式运行时语义。
- 主内容、切换按钮、Tooltip、右键菜单、无障碍名称和状态均可理解。
- Explorer 重启、任务栏重建、显示器变化、DPI 变化、主题变化和应用退出时不会留下孤立顶层窗或错误占位。
- 失败时保持隐藏并在 Tools 设置中说明不可用原因；不存在 Widget、悬浮窗或顶层置顶窗的降级路径。

## 3. 第一性原理推导

### 3.1 用户需要的是低成本确认，不是第三个主界面

用户查看任务栏的目的，是在不打开主窗口的情况下回答两个短问题之一：

- 现在正在记录哪个软件，已经真实记录了多久？
- 当前工具运行到哪里，还剩或已经过了多久？

因此视口只承担“确认”和“快速进入”职责。所有编辑、配置、历史分析和详细控制仍由主窗口拥有。

由此得到：

- 普通状态不显示应用名、窗口标题、网页域名、日期或当前时间。
- 当前时间和日期继续由 Windows 自带时钟负责，Patina 不重复显示。
- 任务栏视口不扩张为 CPU、内存、网络、天气、任务清单或项目管理面板。
- 复杂信息进入 Tooltip、右键菜单或主窗口，不进入常驻主显示。

### 3.2 “任务栏视口”的身份由父子关系决定

仅仅把一个置顶窗放在任务栏坐标附近，并不等于任务栏子视口。真正的判定条件是：

```text
IsWindow(viewport) == true
GetParent(viewport) == discovered_taskbar_host
window_style contains WS_CHILD
window_style does not contain WS_POPUP
viewport rectangle is clipped by and expressed in the parent client coordinate system
```

因此：

- 正式实现由 Rust 通过 `windows` crate 调用 Win32 API。
- 不为此功能增加 C++、C#、CMake、独立 DLL、sidecar 或第二个进程。
- 不使用 `WebviewWindowBuilder` 创建任务栏视口。
- 当前 `src-tauri/src/app/widget.rs` 的 WebView Widget 只能作为边界反例，不能复用为任务栏实现。
- 子窗口优先在发现父级后以 `CreateWindowExW(..., WS_CHILD, ..., parent_hwnd, ...)` 直接创建；不得先显示为顶层窗再贴过去。

产品归属与显示载体是两个不同问题：

- 用户获得的是一个可主动查看、切换和进入详情的轻量时间工具，因此产品 owner 是 `Tools / 工具`。
- Windows 任务栏只负责承载该工具的紧凑视图，不构成独立产品领域，也不应继续作为 Project `Area`。
- Tools 设置承载“是否启用”等组件偏好；全局 Settings 不出现这个开关。
- Win32 子窗口、Explorer 恢复和 DPI 处理仍由 `platform/windows` 所有，因为这些是平台机制，不是 Tools 领域语义。

### 3.3 时间是产品事实，绘制只是事实的最后一公里

如果显示的秒数与正式会话、AFK、排除或 Tools 状态不一致，界面再精致也会损害用户信任。

因此数据流固定为：

```text
tracking/tools 正式运行时事实
  -> 纯领域投影与确定性格式化
  -> app 生命周期协调
  -> Windows 原生宿主与渲染
```

禁止的数据流：

```text
Windows 子窗口
  -> 每秒查 SQLite
  -> 在 platform 层猜追踪状态
```

### 3.4 任务栏空间是稀缺资源

每增加一个字、图标或动态宽度，都会挤压系统托盘和任务按钮。因此：

- 两种模式使用同一固定外框尺寸，切换不引起任务栏横向跳动。
- 数字采用表格数字特性，基线和起点保持固定。
- 状态色只承担语义，不把整块任务栏染成彩色卡片。
- 进度环只用于存在已知总量的倒计时和番茄阶段；正计时和提醒不得伪造进度。

### 3.5 失败必须诚实

Windows 没有面向任意第三方状态视口的稳定公开任务栏扩展点，主流项目也是通过原生 HWND 与任务栏内部结构工作。因此未知任务栏结构、跨进程 DPI、Explorer 重建和几何冲突都必须被当作产品风险，而不是异常后随便换个窗体。

由此得到：

- 未验证父级前始终隐藏。
- 父级、样式或安全矩形失效时先隐藏和销毁，再恢复。
- 不修改 Explorer 子窗口尺寸来强行腾位；没有安全空白矩形时该任务栏实例保持隐藏。
- 不支持的结构进入明确的 `Unavailable` 状态，并在 Tools 设置中提供本地化说明和诊断摘要。
- 恢复与重建是同一原生实现的生命周期，不是降级策略。

## 4. 已确认的产品与技术决策

以下决策已经构成执行基线，不在实施时重新发散：

- [x] 功能名称使用“任务栏追踪与工具状态视口”；代码命名使用 `taskbar_viewport` / `TaskbarViewport`，不使用 `V2`、`New`、`Next`。
- [x] 产品归属固定为 `Tools / 工具`；Project `Area` 使用 `Tools`，`Taskbar` 只作为载体术语出现在名称、平台实现和技术说明中。
- [x] 只实现 Rust + Win32 原生子窗口，不引入其他实现语言。
- [x] 不复用 Widget WebView，不新增任务栏专用 WebView。
- [x] 不存在悬浮窗、Widget、topmost overlay 或坐标贴边兜底。
- [x] 视口有 `Tracking` 与 `Tools` 两种模式。
- [x] 模式只由固定切换按钮改变，不根据前台应用或工具状态自动切换。
- [x] 模式选择持久化，重启后恢复。
- [x] 追踪模式普通状态只显示应用图标、状态环和累计时间；应用全名放在 Tooltip 和无障碍名称中。
- [x] 工具模式普通状态只显示工具图标和核心时间；单工具单行，多工具最多双行。
- [x] 当前时间和日期不进入功能范围。
- [x] 主内容点击进入对应主窗口内容；切换按钮只切模式。
- [x] 正式渲染只有 Direct2D + DirectWrite 一条路径；不维护 GDI 文本渲染或 WebView 渲染分支。
- [x] 任务栏背景通过逐像素透明保留，不用硬编码颜色伪装 Windows 任务栏。
- [x] Windows 10 / 11 的已验证 Shell 结构可以有语义明确的 host profile，但共享同一宿主、渲染和状态实现；未知结构不猜测。
- [x] 初始只支持水平任务栏。Windows 10 竖直任务栏进入明确不可用状态，不擅自改变“右侧固定切换按钮”的交互。
- [x] 同一模式选择应用到所有成功附加的任务栏实例；不增加逐显示器配置。
- [x] 在 Tools 内建立正式的工具设置入口，并放置唯一的启用开关与状态摘要；全局 Settings 不出现这个开关，也不增加字体、颜色、间距、宽度、刷新率等配置。

## 5. 范围

### 5.1 本次必须完成

- Rust 领域读模型、格式化规则与状态矩阵。
- 追踪连续组的真实累计时长投影。
- Tools 活动项选择、排序与最多双行投影。
- `taskbar_view_enabled` 与 `taskbar_view_mode` 持久化。
- 原生宿主发现、创建、附加验证、几何定位和安全隐藏。
- Direct2D / DirectWrite 透明绘制、图标缓存、状态环和已知总量进度环。
- 固定模式切换按钮、主内容点击、Tooltip、右键菜单。
- UI Automation provider 与键盘/屏幕阅读器可理解性。
- Explorer 重启、任务栏重建、显示器、DPI、主题、高对比度与自动隐藏处理。
- Tools 设置入口、启用开关、运行状态、不可用原因和重试入口。
- 主窗口可靠导航到 Tools 或当前应用详情。
- 单元、集成、真实 Tauri runtime smoke、性能与人工视觉矩阵。
- 活跃长期文档与 Changelog 的必要更新；执行单完成后归档。

### 5.2 明确非目标

- 不替代或删除现有 Widget。
- 不改变“最小化到 Widget”的既有行为。
- 不增加当前时间、日期、天气、网速、CPU、内存或硬件监控。
- 不显示窗口标题、网页标题或域名。
- 不增加任务、项目、日程、目标、排行榜或游戏化信息。
- 不在任务栏内编辑 Tools、分类或追踪设置。
- 不支持用户拖动任务栏视口，也不提供任意位置锁定。
- 不增加皮肤系统、插件系统或自定义布局。
- 不修改 Explorer 的任务按钮、托盘、时钟或其他子窗口尺寸来腾位。
- 不承诺未知第三方任务栏替换器、Explorer patcher 或竖直 Windows 10 任务栏。

## 6. 领域契约

### 6.1 核心类型

计划在 `src-tauri/src/domain/taskbar_viewport.rs` 定义纯数据与纯函数，不引用 Tauri、SQLite 或 Win32：

```rust
pub enum TaskbarViewMode {
    Tracking,
    Tools,
}

pub enum TaskbarViewportAvailability {
    Disabled,
    Discovering,
    Attached,
    Recovering,
    Unavailable(TaskbarViewportUnavailableReason),
}

pub enum TrackingPresentationState {
    Running,
    Afk,
    Paused,
    Excluded,
    ProbeUnavailable,
    Empty,
}

pub enum ToolPresentationKind {
    Stopwatch,
    Countdown,
    PomodoroFocus,
    PomodoroBreak,
    Reminder,
}

pub struct TaskbarViewportSnapshot {
    pub mode: TaskbarViewMode,
    pub content: TaskbarViewportContent,
    pub sampled_at_ms: i64,
    pub locale: String,
}
```

类型名可以在实现时根据现有 Rust 规范微调，但语义不得变成页面组件状态或 Win32 细节。

### 6.2 追踪累计时间公式

任务栏显示的是当前应用在当前连续组内已经真实计入的时间，不是从连续组锚点到现在的自然时间跨度。

```text
displayed_tracking_ms =
  closed_effective_ms_in_current_continuity_group
  + active_session_effective_delta_ms
```

其中：

- `closed_effective_ms_in_current_continuity_group` 只统计当前应用、当前连续组已经封口的有效 session 时长。
- `active_session_effective_delta_ms` 只在当前 active session 身份匹配、追踪启用、应用未排除、非 AFK 且 probe 可相信时增长。
- 短暂切到其他应用再返回时，可以复用原连续组锚点，但不得把其他应用占用的时间算入当前应用累计。
- 暂停、AFK、排除、锁屏、睡眠和 probe 不可用时，秒数停在最后一次已确认值。
- 系统时间倒退时，显示值不得倒退；系统时间异常前跳时不得绕过追踪运行时直接增加未确认时长。
- 应用启动恢复时，从 SQLite 读取一次当前 active session 与连续组累计基线；此后由追踪运行时内存状态推进，不每秒查询数据库。

### 6.3 追踪状态矩阵

| 输入事实 | 主显示 | 时间行为 | 状态环 | Tooltip 重点 |
| --- | --- | --- | --- | --- |
| 正常记录 | 当前应用图标 + 时间 | 每秒按正式 runtime 增长 | 安静的活动色 | 应用全名、完整时长、正在记录 |
| AFK | 最后确认应用图标 + 冻结时间 | 停在 AFK 边界 | muted / warning | 当前空闲，时间已停止增长 |
| 全局暂停 | 最后确认图标；无可信对象时用通用图标 | 冻结 | paused | 追踪已暂停 |
| 当前应用被排除 | 当前应用图标 + `—` | 不增长，不借用其他应用时长 | excluded | 当前应用不记录 |
| probe 暂时不可用 | 最后确认图标 + 冻结时间 | 不增长 | unavailable | 追踪状态暂不可确认 |
| 尚无可追踪对象 | 通用应用图标 + `—` | 不增长 | empty | 暂无可追踪活动 |

### 6.4 Tools 选择与排序

参与常驻显示的时间型工具只有：当前 timer、当前 pomodoro 和下一条待触发 reminder。软件使用提醒规则不作为一个持续运行计时器显示。

候选项按以下确定性优先级排序：

1. 刚完成、到期且尚未被用户处理的项。
2. 正在运行的倒计时或番茄阶段。
3. 已暂停但仍保留上下文的倒计时、番茄或正计时。
4. 正在运行的正计时。
5. 下一条待触发提醒。

显示规则：

- 0 项：工具模式图标 + `—`，Tooltip 说明没有运行中的工具。
- 1 项：垂直居中的单行图标 + 时间。
- 2 项及以上：显示优先级最高的两项，形成上下双行；其余只进入 Tooltip 摘要。
- 同优先级使用 `updated_at`，再使用稳定 id 排序，确保每秒不会抖动换行。
- 倒计时显示剩余时间；正计时显示累计时间；番茄显示当前阶段剩余时间；提醒显示距离触发的剩余时间。
- 倒计时和番茄存在已知总量，可以显示进度环。
- 正计时和提醒没有可信总进度，不显示进度环。

### 6.5 时间格式

- 小于 1 小时：`mm:ss`。
- 1 小时到 999 小时：`h:mm:ss`，数字起点与基线固定。
- 超过 `999:59:59`：主显示为 `999h+`，Tooltip 与无障碍名称提供完整格式。
- 负数、NaN、溢出或未知时间统一变成 `—`，不显示伪造的 `00:00`。
- 倒计时到期为 `00:00`，同时由 completed 状态表达，不继续显示负数。
- DirectWrite 启用 tabular figures；如果当前系统字体不支持，对每个数字预先测量并采用最大字宽固定推进。

## 7. Owner 与预期文件布局

| Owner | 计划文件 | 职责 | 明确禁止 |
| --- | --- | --- | --- |
| `domain/tools` | `src-tauri/src/domain/tools.rs`；确有拆分必要时再建立其 Tools 子模块 | 拥有该工具的模式、状态、投影、排序、格式化和不可用原因 | Tauri、SQL、HWND、绘制；建立平行的 Taskbar 产品领域 |
| `engine/tracking` | `src-tauri/src/engine/tracking/runtime_snapshot.rs` 等 | 维护当前连续组累计只读事实 | 任务栏几何、颜色、点击 |
| `engine/tools` | `src-tauri/src/engine/tools/mod.rs` | 向 app 暴露只读内存快照 | 为任务栏另建计时器 |
| `data` | `src-tauri/src/data/repositories/sessions.rs`、`app_settings.rs` | 启动基线查询和设置原子持久化 | 每秒轮询、窗口行为 |
| `app/tools` | `src-tauri/src/app/taskbar_viewport.rs` 或经 owner 检查后的 Tools 子模块 | 以 Tools 产品 owner 组合生命周期、状态、异步意图、导航与持久化 | Win32 调用、厚领域计算；把文件名误当产品 Area |
| `platform/windows` | `src-tauri/src/platform/windows/taskbar_viewport/*` | HWND、宿主发现、消息循环、透明渲染、Tooltip、UIA | 查询 SQLite、猜追踪语义 |
| `commands/tools` | 现有 `src-tauri/src/commands/tools.rs` 或经 owner 检查后的窄子模块 | Tools 组件设置与状态查询等薄 IPC | 生命周期或业务逻辑；创建平行产品 Area |
| `features/tools` | `src/features/tools/*` | 建立 Tools 设置入口，承载组件开关、状态及进入 Tools 的导航语义 | Win32 实现、复制 runtime 状态 |
| `features/settings` | 无本项新增入口 | 保持全局应用偏好边界 | 放置任务栏视口开关或状态，成为组件产品 owner |
| `app/navigation` | 现有 app navigation owner 或窄新增模块 | 主窗口尚未就绪时保存一次性导航意图 | destination 业务读模型 |

建议的 Windows 平台子模块：

```text
src-tauri/src/platform/windows/taskbar_viewport/
  mod.rs
  thread.rs
  discovery.rs
  geometry.rs
  host.rs
  render.rs
  icon.rs
  tooltip.rs
  accessibility.rs
```

只有在每个文件有清楚 owner、测试或资源生命周期理由时才拆分；不能为了匹配本表制造空壳。

## 8. 执行阶段与可勾选步骤

### 阶段 0：开始事件、Board 与基线

进入条件：维护者明确授权开始实现，而不只是要求完善方案。

- [ ] 使用浏览器控制插件重新读取 live Project，确认本项仍存在，并确认当前唯一 `In progress` 与完整 `Next` 窗口。
- [ ] 核对本项 `Area`；如果仍是 `Taskbar`，将其同步纠正为已确认的 `Tools`，再重新读取页面验证字段实际生效。
- [ ] 告诉维护者把“增加任务栏追踪与工具状态视口”从 `Next` 拖到 `In progress`；同时按 live 手动顺序重新计算并报告需要补入 `Next` 的事项。
- [ ] 记录维护者是否已经完成拖动；拖动不阻塞已授权的本地实现。
- [ ] 运行 `git status --short`，记录已有修改；任何不属于本项的用户改动都保持不动。
- [ ] 确认当前 Node/npm/Rust 版本符合仓库锁定要求。
- [ ] 运行并记录实施前基线：
  - [ ] `npm test`
  - [ ] `npm run test:replay`
  - [ ] `npm run build`
  - [ ] `npm run check:rust`
- [ ] 如果基线已有失败，先区分“本项前已存在”与“本项引入”；不能把旧失败写成本项通过。

退出条件：live Project、工作树和质量基线均有记录。

### 阶段 1：先固定可测试契约

目标：在碰 Win32 之前，让“显示什么、何时增长、何时冻结”成为纯函数事实。

- [ ] 在现有 `domain/tools` owner 内定义任务栏视口契约；只有 `tools.rs` 已无法保持清晰时，才把它机械拆为 `domain/tools/mod.rs + taskbar_viewport.rs`，不得建立平行的 Taskbar 产品领域。
- [ ] 定义 `TaskbarViewMode::{Tracking, Tools}`，序列化值固定为 `tracking` / `tools`。
- [ ] 定义 availability、tracking presentation state、tool kind、tool state、progress、tooltip facts 和最终 snapshot。
- [ ] 把第 6 节的时间格式实现为纯函数，时钟通过参数传入。
- [ ] 把 Tools 候选选择和稳定排序实现为纯函数。
- [ ] 把 tracking 状态映射实现为纯函数，不在 renderer 中写 `if paused/afk` 业务分支。
- [ ] 先写失败测试，再实现到通过：
  - [ ] 正常 tracking 每秒增长。
  - [ ] AFK、暂停、排除、probe unavailable 不增长。
  - [ ] 连续组包含其他应用时不把其他应用时长计入当前应用。
  - [ ] 时钟倒退时不倒退。
  - [ ] 无对象与未知时长显示 `—`。
  - [ ] stopwatch 不产生 progress。
  - [ ] countdown / pomodoro progress 被夹在 `0.0..=1.0`。
  - [ ] 多工具最多两行且排序稳定。
  - [ ] 999 小时边界、溢出和负值。
- [ ] 确认 domain 模块不依赖 `tauri`、`sqlx`、`windows` 或 `platform`。

退出条件：领域测试能在无 Windows 桌面环境中确定最终显示事实。

### 阶段 2：原生可行性闸门

目标：先证明“真正子窗口 + 安全空位 + 透明渲染 + DPI 不污染”成立。此阶段不是发布实现。

#### 2.1 只读环境探测

- [ ] 用临时 probe 枚举并记录以下窗口树、class name、进程、矩形、DPI awareness context 和 monitor：
  - [ ] `Shell_TrayWnd`
  - [ ] 每个 `Shell_SecondaryTrayWnd`
  - [ ] `TrayNotifyWnd` 及其可见子窗口
  - [ ] Windows 10 任务按钮宿主
  - [ ] Windows 11 任务按钮/Composition host
- [ ] 在 Windows 10 和 Windows 11 当前受支持 build 上各收集至少一份证据。
- [ ] 覆盖任务栏图标左对齐与居中、系统托盘展开/收起、自动隐藏、多显示器和 100% / 150% DPI。
- [ ] 为结构事实定义 `Windows10TaskbarHost` 与 `Windows11TaskbarHost` 语义 profile；只使用验证过的 class tree，不仅凭 OS version 猜。
- [ ] 定义未知结构的错误类别 `unsupported_shell_structure`。

#### 2.2 子窗口与 DPI 证明

- [ ] 临时 probe 在发现父级后直接创建 `WS_CHILD` 隐藏窗口；创建前后记录：
  - [ ] Patina main window DPI awareness context。
  - [ ] taskbar host DPI awareness context。
  - [ ] viewport DPI awareness context。
  - [ ] Patina 进程和主窗口缩放是否发生变化。
- [ ] 逐项断言 `GetParent`、`WS_CHILD`、无 `WS_POPUP`、无任务栏按钮、无 Alt+Tab 项。
- [ ] 在 100% / 125% / 150% / 200% 和混合 DPI 双屏上创建与销毁 100 次，确认主窗口没有模糊、缩放跳变或位置漂移。
- [ ] 如果需要设置 thread DPI context，只在专用原生线程创建窗口前设置，并在创建后恢复；不得改变 Tauri UI 线程的 context。
- [ ] 记录 `SetThreadDpiHostingBehavior` 是否实际适用于当前父子方向；不能因为 API 存在就假设能修复 Explorer 作为父级的跨进程 DPI 问题。

#### 2.3 唯一渲染路径证明

- [ ] 在 `windows = 0.62.2` 增加 probe 所需 feature，至少核对：Direct2D、DirectWrite、DirectComposition/必要图像互操作、Controls、Accessibility。
- [ ] 使用 Direct2D + DirectWrite 绘制应用图标占位、表格数字、圆环、1 physical pixel 分隔线和 hover 背景。
- [ ] 使用逐像素 alpha 合成保留真实任务栏背景；GDI DIB/HDC 如果参与，只能作为缓冲/传输或 HICON 互操作，不能形成第二套 GDI renderer。
- [ ] 验证浅色、深色、透明任务栏、高对比度和颜色滤镜下没有黑底、白边、色键毛边或 ClearType 彩边。
- [ ] 模拟 render target 丢失，确认只重建设备资源；失败期间窗口隐藏，不切换 GDI 或 WebView。

#### 2.4 安全矩形证明

- [ ] 从 taskbar、tray、clock、task button host 与其他可见 Explorer 子窗口的矩形计算候选区。
- [ ] 候选区必须位于 taskbar client rect 内，并且不与托盘、时钟、任务按钮、Widgets/Search/系统入口的可见矩形相交。
- [ ] 宽度不足时返回 `no_safe_taskbar_space` 并隐藏；不得缩放到不可读、覆盖系统元素或修改 Explorer sibling 尺寸。
- [ ] 持续打开窗口直到任务栏拥挤，确认碰撞前会安全隐藏，空间恢复后能重新附加。

#### 2.5 闸门结论

- [ ] 把 probe 的可重复步骤、Windows build、DPI、窗口树和结论写回本阶段证据。
- [ ] 将有长期价值的 probe 断言转成测试；删除一次性 probe、环境变量和临时代码。
- [ ] 确认没有留下顶层可见窗口、GDI fallback 或 Explorer 几何修改。

停止条件，命中任意一项即暂停实施并回到 Project 重新确认：

- 跨进程 child 导致 Patina 主窗口 DPI context 被重置或持续模糊。
- 不能在不修改 Explorer sibling 的前提下找到稳定安全矩形。
- 逐像素透明在目标 Windows 10 / 11 build 上不能稳定成立。
- Explorer 重建会让 child 变成可见顶层窗口，且不能在其可见前可靠拦截。
- 只能依赖 Widget、WebView、topmost overlay 或另一种语言才能达到目标。

退出条件：四个证明全部通过，并且一次性 probe 已清理。

### 阶段 3：Tools 设置与持久化

目标：用最少设置形成可控、可恢复的产品入口。

- [ ] 在 `ToolsSettings` 合约中增加：
  - [ ] `taskbarViewEnabled: boolean`
  - [ ] `taskbarViewMode: "tracking" | "tools"`
- [ ] 默认值固定为 `enabled = false`、`mode = tracking`；新版本不应在未告知用户时占用任务栏。
- [ ] 在 Rust `domain/tools.rs` 增加对应语义类型，不用裸字符串在 app/platform 间传播。
- [ ] 在 `data/repositories/app_settings.rs` allowlist 增加 `taskbar_view_enabled` 与 `taskbar_view_mode`。
- [ ] 使用现有 `settings` key-value 表，不增加无必要 schema migration。
- [ ] 扩展持久化读取、归一化、patch、commit 与运行时 apply；非法 mode 回到当前 release default，不增加旧别名解析。
- [ ] 模式按钮触发的保存经过正式串行化 owner，避免与 Tools 设置保存互相覆盖。
- [ ] 模式切换采用“持久化成功后提交可见状态”：
  - [ ] 点击时进入短暂 pending/pressed 状态。
  - [ ] SQLite 成功后更新共享 mode 并重绘所有 taskbar 实例。
  - [ ] 失败时保持原模式，Tooltip/Tools 设置报告本地化失败，不制造已切换假象。
- [ ] 添加 repository 与 settings contract 测试：默认值、合法值、非法值、原子回滚、并发提交。

退出条件：不创建原生窗口也能完整保存、读取和恢复启用状态与模式。

### 阶段 4：可信追踪只读投影

目标：让 taskbar consumer 只读内存即可得到真实累计时长。

- [ ] 在 data session owner 增加窄查询，返回当前 active session 的：应用身份、session start、continuity group start、该应用在当前连续组中已经封口的有效时长。
- [ ] SQL 必须按 canonical app/session identity 和 continuity group 限定，不能只按显示名聚合。
- [ ] 给查询添加索引/查询计划检查；只有证据表明现有索引不足时才新增索引。
- [ ] 在 tracking engine 初始化和 active session/continuity 变化时读取或更新累计基线。
- [ ] 扩展 `TrackingRuntimeSnapshot` 或新增 engine-owned 内部只读 projection，至少包含：
  - [ ] 当前 canonical app identity。
  - [ ] display name 与 process path / icon identity。
  - [ ] 已确认累计毫秒。
  - [ ] 当前 session 可增长锚点。
  - [ ] freeze 边界和 presentation state 所需事实。
- [ ] 先调整 snapshot 更新顺序：最终 snapshot 必须反映本轮 session transition 之后成立的事实，不能在 mutation 前发布旧 active session。
- [ ] 暂停、排除、AFK、锁屏、睡眠、continuity timeout 和 probe failure 的每条封口路径都更新同一投影。
- [ ] 运行时重启后从数据库恢复一次基线；正常每秒 tick 不查询 SQLite。
- [ ] 测试至少覆盖：
  - [ ] 同应用持续追踪。
  - [ ] A -> B -> A 且 A 连续组复用，A 不包含 B 的时间。
  - [ ] A -> B 超过 continuity window 后返回 A，建立新组。
  - [ ] AFK、暂停、排除、probe failure 封口。
  - [ ] 崩溃恢复与 active session 修复后累计一致。
  - [ ] wall clock 倒退/前跳不产生负数或未确认增长。

退出条件：tracking runtime snapshot 本身已经能回答任务栏追踪模式，不需要 taskbar app/platform 再查 session 表。

### 阶段 5：Tools 只读投影

目标：复用正式 Tools runtime，不创建第二套计时循环。

- [ ] 将 `ToolsRuntimeState::snapshot()` 以 `pub(crate)` 或更窄语义接口开放给 app owner，不向 platform 暴露 Mutex。
- [ ] app 每次组合快照时读取内存中的 `ToolsRuntimeSnapshot`，不调用 `app::tools::get_snapshot()` 触发数据库 fetch。
- [ ] 将 current timer、pomodoro、next reminder 送入 domain selector。
- [ ] Tools mutation 和 runtime tick 后立即唤醒 taskbar projection；运行中的秒显示由 taskbar 1 Hz 显示 tick 推进。
- [ ] 不改变 Tools 到期、通知、暂停、恢复和持久化语义。
- [ ] 测试 timer + pomodoro 同时存在、提醒同时存在、暂停、完成、重置和无活动项。

退出条件：Tools 模式的每个像素事实都能从正式 runtime snapshot 确定。

### 阶段 6：原生宿主线程与生命周期

目标：建立一条不会阻塞 Tauri、不会泄漏 HWND/COM/GDI 资源的原生路径。

- [ ] 在 `platform/windows/taskbar_viewport/thread.rs` 建立专用原生线程。
- [ ] 在线程中初始化所需 COM apartment、注册 controller/surface window class，并运行 Win32 message loop。
- [ ] controller 是隐藏的 `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE` 顶层消息接收窗，只为接收 `TaskbarCreated` 等广播；永不 show，不是视觉 fallback。
- [ ] surface 只在父级和安全矩形已验证后以 `WS_CHILD` 创建。
- [ ] app 与 native thread 使用有界 command/event channel；WndProc 不执行 SQLite、Tauri async 或长任务。
- [ ] command 至少包含：Start、Stop、ApplySnapshot、ApplyModePending、ReconcileHosts、ApplyLocale/Theme。
- [ ] event 至少包含：OpenContent、SwitchMode、OpenContextMenu、HostAvailabilityChanged、FatalRenderError。
- [ ] 每个 HWND、HICON、HBITMAP、HDC、HMENU、tooltip、Direct2D/DirectWrite/COM 对象都有明确 RAII owner。
- [ ] `Drop` / app exit 顺序固定：停止接收新 snapshot -> 隐藏 surface -> 销毁 child/tooltip/UIA -> 退出 message loop -> join thread。
- [ ] native thread panic 或异常退出只使 taskbar viewport unavailable，不终止 tracking/tools 主链。
- [ ] 重启循环使用有上限的退避；不能每秒无限创建失败 HWND。
- [ ] 增加 handle/resource 计数测试或 diagnostics，证明重复 attach/detach 不泄漏。

退出条件：可以启动、停止、重复重建空白 surface，且 app 主窗口和追踪运行时不受影响。

### 阶段 7：宿主发现与几何

目标：把阶段 2 的证据实现为可测试的正式 profile 和几何算法。

- [ ] 枚举一个 `Shell_TrayWnd` 和所有 `Shell_SecondaryTrayWnd`，用 monitor handle/rect 建立稳定 identity。
- [ ] 校验 host 属于 Explorer/Shell 进程、可见、矩形有效且水平。
- [ ] 解析 profile 所需 tray/clock/task-button/widgets 子树；窗口类、父子链和矩形必须同时满足。
- [ ] 把屏幕坐标统一转换为目标 parent client 坐标，所有转换检查溢出和负坐标。
- [ ] 使用一个固定 DIP 宽度，按每个 host 的 `GetDpiForWindow` 转为 physical pixel；两种模式尺寸相同。
- [ ] 起始调优基线：总宽约 `128 DIP`，右侧切换区约 `28 DIP`，中间 `1 physical pixel` 分隔线；最终数值在阶段 12 由真实 UI 调整。
- [ ] 高度取 taskbar client 可用高度并保留克制上下内边距，不自行改变 taskbar 高度。
- [ ] 候选区默认位于通知区左侧；必须通过所有可见 sibling 交集检查。
- [ ] 多显示器每个安全 host 创建一份 surface，共享同一 snapshot 与 mode。
- [ ] 单个副任务栏失败只影响该 host；全局 status 记录 attached/total 数量。
- [ ] Windows 10 竖直任务栏返回 `vertical_taskbar_unsupported`，Tools 设置说明原因。
- [ ] 几何纯函数覆盖：负坐标副屏、上下排列显示器、100/125/150/200%、tray 宽度变化、无安全空间和整数边界。

退出条件：不会覆盖任何可见系统任务栏元素，也不会修改 Explorer sibling。

### 阶段 8：原生渲染与图标

目标：实现 Quiet Pro 的微型状态仪表，而不是缩小版卡片。

#### 8.1 视觉 token

- [ ] 在 native renderer owner 中定义语义 token：text primary/muted、separator、hover、pressed、focus、running、paused、warning、excluded、unavailable、progress track。
- [ ] token 从 Windows taskbar light/dark、高对比度和系统 text/accent facts解析；组件内部不散落 RGB、圆角和时长常量。
- [ ] surface 背景保持透明，不绘制大色块、渐变、玻璃、模糊、发光或阴影。
- [ ] hover/pressed 只绘制低对比度局部反馈，不形成圆角胶囊堆叠。

#### 8.2 Tracking 布局

- [ ] 主区绘制 18–20 DIP 应用图标和细状态环。
- [ ] 状态环只表达 running/paused/AFK/excluded/unavailable，不表达任意百分比。
- [ ] 图标右侧绘制时间；文字起点、基线和最大宽度固定。
- [ ] 普通状态不绘制应用名称、exe 名、窗口标题或标签词。
- [ ] 当前应用图标使用原生 owned icon/bitmap cache；不得每秒走 base64 -> PNG -> bitmap 解码。
- [ ] 缺少图标时使用中性的通用应用 glyph，不使用 exe 首字母作为噪声文本。

#### 8.3 Tools 布局

- [ ] 单工具使用一行：语义图标 + 时间。
- [ ] 双工具使用两行，每行图标、时间和状态清晰对齐；字号仍达到任务栏可读下限。
- [ ] stopwatch、countdown、pomodoro focus/break、reminder 图标必须在 100% DPI 可区分。
- [ ] countdown/pomodoro 已知总量使用细进度环；stopwatch/reminder 不显示假进度。
- [ ] 第三项及以后不挤入主显示，只出现在 Tooltip。

#### 8.4 切换区与动效

- [ ] 右侧固定切换按钮尺寸和位置不随模式变化。
- [ ] 按钮图标表达“将切换到的模式”，Tooltip 明确写出目标模式。
- [ ] content 与 switch 之间使用 1 physical pixel hairline separator。
- [ ] 模式切换只做不超过 120 ms 的内容 cross-fade，不做水平滑动和弹跳。
- [ ] 动效只在 Windows 动画与 Patina dynamic effects 都允许时运行；否则立即切换。
- [ ] 动画期间才启用短帧 timer，结束后回到事件驱动 + 1 Hz，不保留 60 FPS 循环。

#### 8.5 绘制正确性

- [ ] `WM_PAINT` / layered update 只消费 immutable snapshot，不持有 engine/data 锁。
- [ ] snapshot 未变化且数字秒未变化时不重绘。
- [ ] device-dependent resources 在 DPI/theme/device loss 后重建，device-independent resources 复用。
- [ ] 透明像素为正确 premultiplied alpha，图标和圆环边缘无黑边。
- [ ] 关闭时释放所有 device resource；1000 次重绘后 GDI/USER/COM 资源稳定。

退出条件：两模式已真实可见，所有静态与交互状态符合 Quiet Pro。

### 阶段 9：交互、Tooltip 与无障碍

目标：图标少文字不等于含义不可达。

- [ ] 把 surface 暴露为 UI Automation root，至少包含两个可调用子元素：main content 与 mode switch。
- [ ] 在 `WM_GETOBJECT` 对 `UiaRootObjectId` 返回 `IRawElementProviderSimple`，窗口销毁时断开 provider。
- [ ] main content 使用 Button control type / Invoke pattern；name 动态包含完整应用或工具名称、时间与状态。
- [ ] mode switch 使用 Button / Invoke pattern；name 明确为“切换到工具模式”或“切换到追踪模式”。
- [ ] 提供稳定 AutomationId，不用可变文案作为 identity。
- [ ] UIA property 改变时只在客户端监听且值真实变化时发送必要事件，避免每秒播报。
- [ ] 原生 Tooltip 使用 `TOOLTIPS_CLASS`，为 main content 与 switch 注册独立矩形。
- [ ] Tracking Tooltip 包含应用全名、完整累计时间和状态；不泄露窗口标题。
- [ ] Tools Tooltip 包含所有活动时间型工具摘要，包括主显示未展示的第三项以后内容。
- [ ] 左键 main content：
  - [ ] Tracking 模式打开主窗口并进入当前应用详情；没有可信应用时只打开 Dashboard。
  - [ ] Tools 模式打开主窗口并进入 Tools。
- [ ] 左键 switch：只请求持久化模式，不打开主窗口。
- [ ] 右键：打开精简的本地化原生菜单，至少包含“打开 Patina”“任务栏中隐藏”；行为复用 app/tray owner，不复制业务逻辑。
- [ ] 鼠标按下、移出、释放、双击和捕获丢失不会误触发两个 hit zone。
- [ ] passive repaint 不抢焦点；主动点击后主窗口恢复使用现有 foreground 策略。
- [ ] UIA Inspect/Narrator 人工验证两个元素的 name、role、state、Invoke 和边界矩形。

退出条件：无可见文字标签时，鼠标、屏幕阅读器和自动化仍能完整理解与操作。

### 阶段 10：主窗口导航与 Tools 设置

#### 10.1 可靠导航意图

- [ ] 增加 app-owned 的一次性 main-window intent state，支持 `OpenTools` 与 `OpenAppDetail`。
- [ ] intent 保存 canonical exe/app identity，不保存 HWND、HTML trigger 或易失的 React state。
- [ ] 任务栏点击先写入 intent，再请求显示主窗口。
- [ ] 主 WebView 已存在时及时消费；因 background optimization 被销毁时，在新页面 ready 后消费，不能丢事件。
- [ ] 多次快速点击只保留最新可执行 intent，消费后清除。
- [ ] 前端 app shell 将 `OpenTools` 交给正式 navigation owner。
- [ ] `OpenAppDetail` 进入 Dashboard/合适来源并调用 destination feature；没有 DOM trigger 时定义明确的关闭后焦点目标，不伪造按钮引用。
- [ ] 添加冷启动、隐藏主窗口、已销毁 WebView、重复点击和 stale intent 测试。

#### 10.2 Tools 设置入口

- [ ] 在 Tools 页面建立一个克制的设置入口；第一版使用工具页标题区的设置按钮打开同页设置面板，不创建全局 Settings 入口。
- [ ] 在 Tools 设置面板增加一个 QuietSwitch：“在任务栏显示 Patina 状态”。
- [ ] 说明文字只解释“显示当前追踪或工具时间”，不写底层 Win32 术语。
- [ ] 开关打开后显示紧凑状态：已连接、正在恢复、部分显示器可用、不可用。
- [ ] 不可用时显示有限本地化原因和“重试”动作；原始 HWND、路径和 OS 细节只进入 diagnostics/log。
- [ ] Tools 设置保存失败时保持旧开关，并显示清楚的就地错误反馈。
- [ ] 不增加 mode 设置；mode 只由任务栏固定按钮切换。
- [ ] 添加中英文文案、Rust native 文案和 i18n contract；不得在 Rust match 中私建中英文表。

#### 10.3 IPC 与 capability

- [ ] 如果 Tools 设置需要专用 status command，在现有 `commands/tools` owner 中增加薄命令。
- [ ] 同步 `bootstrap.rs` invoke handler、`build.rs` command manifest、`permissions/window-commands.toml` 和 `capabilities/default.json`。
- [ ] 不把 taskbar status command 加入 `widget-window-commands` 或 `widget.json`。
- [ ] Native surface 自身不运行 WebView，因此不为它创建 Tauri capability/window label。
- [ ] 运行 `npm run check:ipc-contracts:self-test` 与 `npm run check:ipc-contracts`。

退出条件：开关、状态、点击导航在主窗口存在或被销毁时都可靠。

### 阶段 11：恢复、主题、多屏与故障封口

- [ ] controller 注册并处理 `TaskbarCreated` 广播；收到后立即隐藏/销毁旧 surface，再延迟发现新 host。
- [ ] 处理 `WM_DISPLAYCHANGE`、`WM_SETTINGCHANGE`、`WM_THEMECHANGED`、taskbar geometry 变化和必要的 DPI 消息。
- [ ] 每次准备 show 或 repaint 前验证 `IsWindow(parent)`、`GetParent(surface)`、style 和安全矩形。
- [ ] 任意验证失败先 hide/destroy，绝不让失去父级的 surface 留在桌面。
- [ ] 重建退避建议从 250 ms 开始，逐步到 5 s；连续失败后进入 `Unavailable`，只由系统事件、用户重试或低频健康检查唤醒。
- [ ] Explorer 恢复成功后重建所有当前 taskbar host，并恢复同一持久化 mode。
- [ ] 自动隐藏任务栏完全跟随父级，不设置 `HWND_TOPMOST` 保持可见。
- [ ] 主屏切换、显示器增删、负坐标布局和休眠恢复后重新 reconcile。
- [ ] 主题复用现有 taskbar theme 事实或同一 Windows 消息，不再启动重复的注册表 watcher。
- [ ] 高对比度优先于 Patina 自定义配色；状态不能只靠颜色表达。
- [ ] app 正常退出、panic recovery 和 forced native-thread failure 均验证无 orphan surface。
- [ ] 标准自动化不得自动重启维护者真实 Explorer；使用可控 test host 模拟 parent destroy/recreate，真实 Explorer 重启列入人工验收。

退出条件：所有恢复行为仍是同一原生 child 实现，并且任何失败首先保持隐藏。

### 阶段 12：真实 UI 调整

目标：先看到可工作的真实任务栏 UI，再与维护者逐步调尺寸、间距、圆环和色调。

- [ ] 使用 `npm run tauri dev` 在维护者机器启用 taskbar viewport。
- [ ] 分别展示 Tracking 运行、AFK、暂停、排除、无数据、unavailable。
- [ ] 分别展示 stopwatch、countdown、pomodoro focus/break、reminder、双工具和无工具。
- [ ] 让维护者确认以下项目，而不是一次性开放为用户设置：
  - [ ] 总宽是否合适。
  - [ ] 图标与状态环尺寸。
  - [ ] 时间字号、字重和基线。
  - [ ] 双行工具密度。
  - [ ] 分隔线强度。
  - [ ] switch hit target 与图标含义。
  - [ ] 浅色/深色色调。
  - [ ] hover/pressed/focus 反馈。
  - [ ] 120 ms fade 是否需要更短或关闭。
- [ ] 调整值只进入 native semantic token/layout owner，不形成 Settings 里的自定义滑杆。
- [ ] 每轮调整复验 100% 与 150% DPI，避免只在当前截图尺寸成立。

退出条件：维护者在真实任务栏中确认第一版视觉基线可接受。

### 阶段 13：自动化、性能与人工验收

#### 13.1 Rust 单元与集成测试

- [ ] domain 状态/排序/格式化矩阵全部通过。
- [ ] tracking 连续组累计和 session transition 测试通过。
- [ ] settings repository、非法值与事务测试通过。
- [ ] discovery/profile 使用 synthetic window tree 覆盖成功与未知结构。
- [ ] geometry 覆盖多屏、DPI、碰撞、无空间与溢出。
- [ ] lifecycle 覆盖 parent destroy/recreate、重复事件、shutdown race 和退避。
- [ ] renderer snapshot/layout 使用确定性像素/几何断言，不用脆弱整图快照代替语义测试。
- [ ] UIA provider 生命周期、name/state 与 invoke 路由测试通过。

#### 13.2 Tauri runtime smoke

- [ ] 扩展 `tests/tauriRuntimeSmoke.test.ts` 或增加受统一治理的 taskbar runtime smoke。
- [ ] 在隔离数据库/配置下启动真实 Tauri runtime。
- [ ] 开启设置后找到 `Patina.TaskbarViewport.Surface`。
- [ ] 断言其父级 class 为受支持 taskbar host，style 为 child 且非 popup。
- [ ] 断言禁用或强制 unknown host 时 surface 不可见、没有顶层同类窗口。
- [ ] 断言模式切换持久化并在重启后恢复。
- [ ] 断言点击 Tools 能在 main WebView 被销毁后可靠导航。
- [ ] 不把真实用户配置、数据库或 Explorer 作为测试夹具。

#### 13.3 前端与 IPC

- [ ] Tools 设置状态测试覆盖 default/hover/active/focus/disabled/loading/error/unavailable。
- [ ] app navigation intent 覆盖主窗口 ready/recreate race。
- [ ] i18n、IPC、architecture、naming 和 style debt 检查通过。
- [ ] Widget 测试继续通过，证明没有借任务栏功能改写 Widget。

#### 13.4 性能与资源预算

- [ ] 空闲时没有 60 FPS 循环；无状态变化时最多 1 Hz 时间刷新和低频 host health check。
- [ ] taskbar viewport 不触发每秒 SQLite query。
- [ ] 10 分钟空闲与 10 分钟活动测量 Patina CPU/内存/USER/GDI handle 增量，并与关闭 viewport 基线对比。
- [ ] 1000 次 snapshot repaint 后 handle 数不持续增长。
- [ ] 100 次 mode switch、theme change、attach/detach 后内存回到稳定区间。
- [ ] 记录 p95 projection 和 render duration；如超出 1 Hz 帧预算的 10%，必须先定位，不能提高刷新率掩盖。
- [ ] 没有新增 WebView、进程或常驻 GPU 动画。

#### 13.5 人工 Windows 矩阵

- [ ] Windows 10：底部水平任务栏，100% / 150%。
- [ ] Windows 10：顶部水平任务栏（如果当前系统允许）。
- [ ] Windows 10：竖直任务栏明确显示 unsupported 且无 surface。
- [ ] Windows 11：居中任务栏，100% / 125% / 150% / 200%。
- [ ] Windows 11：左对齐任务栏。
- [ ] 单屏与双屏；副屏在左/右/上/下，含负坐标。
- [ ] 自动隐藏任务栏。
- [ ] 浅色、深色、高对比度。
- [ ] 托盘图标数量变化、任务按钮从少到拥挤。
- [ ] Explorer 手工重启后恢复，期间无 orphan top-level window。
- [ ] 睡眠/唤醒、锁屏/解锁、主屏切换、DPI 改变。
- [ ] Narrator/UIA Inspect。
- [ ] 中文与英文 Tooltip、Tools 设置、右键菜单。

退出条件：自动化与人工矩阵均有证据；不能用“我机器上看着可以”代替。

### 阶段 14：最终质量门、文档与 Project 收口

- [ ] 运行针对性命令并记录结果：
  - [ ] `npm run test:tools`
  - [ ] `npm run test:settings`
  - [ ] `npm run test:widget`
  - [ ] `npm run test:tauri-runtime-smoke`
  - [ ] `npm run check:rust`
- [ ] 单独运行并记录仓库最低门：
  - [ ] `npm test`
  - [ ] `npm run test:replay`
  - [ ] `npm run build`
- [ ] 运行完整门：`npm run check:full`。
- [ ] 如改动运行时 smoke，再次运行 `npm run test:tauri-runtime-smoke`，不能只引用之前结果。
- [ ] 检查 `git diff --check`、`git status --short` 和变更文件 owner。
- [ ] 确认不存在：
  - [ ] C++/C#/CMake/sidecar/DLL 新实现。
  - [ ] WebView taskbar window。
  - [ ] overlay/widget fallback。
  - [ ] `V2/New/Next` 命名。
  - [ ] 每秒 SQLite polling。
  - [ ] hardcoded user-visible native strings。
  - [ ] Explorer sibling 几何修改。
- [ ] 更新 `CHANGELOG.md` 的 `Unreleased / Added`，只描述用户可见能力。
- [ ] 若长期架构或质量规则没有变化，不修改长期母文档；只在实现暴露真实长期规则时更新相应 top-level doc。
- [ ] 将本文所有实施项与证据补齐后移到 `docs/archive/`。
- [ ] 重新读取 live Project。
- [ ] 确认本项最终 `Area = Tools`；任何 `Area = Taskbar` 的残留都视为 Project 收口未完成。
- [ ] 实现和全部验证通过后，告诉维护者把本项从 `In progress` 拖到 `Done`，并按 live 手动顺序报告新的完整 `Next` 补位方案。
- [ ] 如果仍等待外部 Windows build/设备验证，则建议 `In progress -> Blocked`，不能提前进入 `Done`。

退出条件：Definition of Done 全部满足，Project 状态建议与实际未完成条件一致。

## 9. Definition of Done

只有以下全部可勾选时，功能才算完成：

- [ ] 用户可以在 Tools 设置中明确启用或禁用任务栏视口；全局 Settings 没有重复开关。
- [ ] 启用后，每个有安全位置的受支持水平任务栏都出现真正 native child。
- [ ] 任意可见 surface 都通过 `GetParent + WS_CHILD + !WS_POPUP` 断言。
- [ ] Tracking 模式显示正确应用图标和真实连续组累计时间。
- [ ] AFK、暂停、排除、锁屏、睡眠和 probe failure 不产生假增长。
- [ ] Tools 模式正确显示单工具或最多双工具，且 stopwatch 不伪造进度。
- [ ] 固定 switch 手动切换模式，成功后持久化，绝不自动切换。
- [ ] 两模式尺寸一致、数字稳定、状态可区分、无多余常驻文字。
- [ ] 主内容点击可靠打开对应主窗口内容。
- [ ] Tooltip、右键菜单和 UI Automation 完整可用。
- [ ] Explorer 重启、显示器/DPI/主题变化后能恢复或诚实隐藏。
- [ ] 不支持或空间不足时 Tools 设置明确说明，桌面上没有 overlay。
- [ ] 没有 C++、独立 DLL、sidecar、新进程或 taskbar WebView。
- [ ] 没有每秒 SQLite 查询、handle 泄漏或持续高帧率绘制。
- [ ] 维护者已在真实 UI 中确认第一版尺寸、密度、圆环和色调。
- [ ] 针对性测试、仓库最低门、`check:full` 和 runtime smoke 全部通过。
- [ ] 文档、Changelog 和 live Project 收口完成。

## 10. 风险登记与封口策略

| 风险 | 影响 | 预防证据 | 失败时的唯一处理 |
| --- | --- | --- | --- |
| Explorer 内部结构变化 | 错位或覆盖系统元素 | profile + parent/class/rect 联合验证 | 隐藏并标记 unsupported |
| 跨进程 parent 改变 DPI context | 主窗口模糊或缩放异常 | 专用线程、前后 context 对比、混合 DPI 压测 | 停止项目并重新评估，不上 overlay |
| 无安全空白空间 | 与 tray/task button 冲突 | sibling 矩形交集检查与拥挤测试 | 隐藏该 host |
| Explorer 重启产生 orphan | 桌面出现错误顶层窗 | TaskbarCreated + show 前 parent/style 验证 | 立即 hide/destroy/recreate |
| 追踪累计语义错误 | 用户不再相信数据 | 连续组有效时长公式与 transition 测试 | 不显示未确认时间 |
| Tools 形成第二套计时 | 与 Tools 页面不一致 | 只读正式 runtime snapshot | 停止 taskbar projection，不独立推进 |
| Direct2D device loss | 黑块或崩溃 | resource recreation 与压力测试 | 隐藏并重建设备资源 |
| UIA COM 生命周期错误 | 崩溃、泄漏或不可访问 | provider disconnect、Inspect、handle 测试 | 标记 unavailable，修复后再显示 |
| 模式保存竞态 | UI 与重启状态不一致 | commit serialization + success-before-visible | 保留旧模式并报告失败 |
| 原生循环资源占用过高 | 违背安静常驻产品定位 | 事件驱动、1 Hz、性能基线 | 不发布，先降低工作量 |

## 11. 参考事实与实施约束来源

仓库内部事实：

- [`docs/product-principles-and-scope.md`](../product-principles-and-scope.md)
- [`docs/roadmap-and-prioritization.md`](../roadmap-and-prioritization.md)
- [`docs/architecture.md`](../architecture.md)
- [`docs/engineering-quality.md`](../engineering-quality.md)
- [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)
- [`docs/issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md)
- [`docs/localization.md`](../localization.md)
- `src-tauri/Cargo.toml` 当前使用 `windows = 0.62.2`，本地 crate 已确认提供所需 Win32、Direct2D、DirectWrite、Controls 与 Accessibility feature。

外部事实只用于解释 Windows 平台边界，不覆盖仓库产品规则：

- Microsoft [`SetParent`](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setparent)：父级变化不会自动修改 `WS_CHILD / WS_POPUP`，跨进程 DPI awareness 可能产生重置或异常。
- Microsoft [`TaskbarCreated`](https://learn.microsoft.com/windows/win32/shell/taskbar#taskbar-creation-notification)：Explorer 重建后会向顶层窗口广播任务栏重建消息。
- Microsoft [Mixed-Mode DPI Scaling](https://learn.microsoft.com/windows/win32/hidpi/high-dpi-improvements-for-desktop-applications)：窗口的 DPI context 与创建线程、父子托管行为相关，必须按窗口验证。
- Microsoft [Direct2D](https://learn.microsoft.com/windows/win32/direct2d/direct2d-overview) 与 [DirectWrite](https://learn.microsoft.com/windows/win32/directwrite/direct-write-portal)：用于高质量 2D 几何和文本绘制。
- Microsoft [Tooltip Controls](https://learn.microsoft.com/windows/win32/controls/tooltip-controls)：使用 `TOOLTIPS_CLASS` 为原生 hit zone 提供 Tooltip。
- Microsoft [`WM_GETOBJECT`](https://learn.microsoft.com/windows/win32/winauto/handling-the-wm-getobject-message) 与 [server-side UIA provider](https://learn.microsoft.com/windows/win32/winauto/uiauto-howto-expose-serverside-uiautomation-provider)：自绘原生控件必须显式暴露可访问对象。
- TrafficMonitor 的 [TaskBarDlg.cpp](https://github.com/zhongyang219/TrafficMonitor/blob/master/TrafficMonitor/TaskBarDlg.cpp) 证明成熟项目会使用原生 HWND、任务栏 child、DPI/多屏定位、Tooltip 和 Direct2D；Patina 只借鉴可验证的原生事实，不复制其“嵌入失败后顶层置顶”的 fallback。

## 12. 当前检查点

- [x] Project item 已建立；最近一次已验证字段为 `Next / Taskbar`。
- [x] 产品归属已改为 `Tools / 工具`，任务栏只作为 Windows 显示载体。
- [ ] live Project 的 `Area` 尚待从 `Taskbar` 同步纠正为 `Tools`；当前连接无法验证外部字段已经改变。
- [x] 产品形态、双模式、固定 switch、少文字和无 fallback 已确认。
- [x] 现有技术栈可通过 Rust `windows` crate 完成，不需要 C++。
- [x] 已识别现有 Widget、tracking、Tools、settings、Tauri capability 与 native platform owner。
- [x] 已确认追踪 runtime snapshot 缺少连续组真实累计投影，必须在接 UI 前补齐。
- [x] 已确认 Tools runtime 已有正式内存 snapshot，只需提供窄只读入口。
- [x] 已确认跨进程 DPI、安全矩形和 Explorer 重建是首个技术闸门。
- [ ] 实施尚未开始；当前不建议修改 Project 状态，也不需要调整 `Next` 窗口。
