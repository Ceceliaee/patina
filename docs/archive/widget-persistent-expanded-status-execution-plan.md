# Tools：挂件常驻展开与并行追踪/工具状态执行方案

> 文档类型：执行型 How-to / 可勾选实施清单
> 文档状态：已完成、已验证、已完成对抗式审查；已归档
> 重构日期：2026-08-12
> 目标读者：Patina 维护者与负责 React、Tauri、Rust、Windows 桌面行为的实现者
> 对应 Project：2026-08-12 完成后再次只读核对现有 [`增加任务栏追踪与工具状态视口`](https://github.com/users/Ceceliaee/projects/1/views/2?pane=issue&itemId=211267379) 工作项；live 状态仍为 `Next`、Area 仍为 `Taskbar`、正文为空。维护者应将标题改为“增加挂件常驻展开与并行追踪/工具状态”、Area 改为 `Tools`，再拖到 `Done`；本文不声称 live 字段已被修改
> 关联缺陷：[`#71 悬浮球挂件在屏幕左侧时，点击展开后图标不居中`](https://github.com/Ceceliaee/patina/issues/71)；2026-08-12 已只读核对，Issue 仍为 Open。本文把它纳入同一 Widget 布局 owner 的强制修复与回归范围，但不授权关闭或修改 Issue
> 历史方案：[`任务栏追踪与工具状态视口执行方案（已放弃）`](../archive/taskbar-tracking-tools-viewport-abandoned-plan.md)
> 文档归宿：`docs/archive/`（2026-08-12 已归档）

## 1. 文档目标与使用方法

本文用于把已确认的产品讨论转化为唯一、可执行、可验收的实施顺序。它不是长期产品母文档，也不是任务栏方案的补丁清单。

执行规则：

- `[x]` 只表示产品决定已经确认，或该项已有可复查证据。
- `[ ]` 表示仍需实际执行；不能因代码“看起来已经有了”而提前勾选。
- 每个实施项勾选时，在条目下补充证据：文件、测试名、命令结果或人工截图结论。
- 每一阶段必须满足进入条件；退出条件未满足，不进入下一阶段。
- 当前工作区同时包含其他用户改动。清理任务栏原型时只能做逐项、owner-first 的补丁，禁止用整文件回退覆盖无关修改。
- 本文不授权创建分支、提交、推送、发布或修改 GitHub Issue；相关动作仍需用户在当前任务明确授权。
- 本文不授权直接拖动 Project 状态。实施开始、完成、阻塞或解除阻塞时，只按长期规则向维护者报告应执行的手动拖动。

## 2. 最终交付结果

演进现有 Patina Widget，使它在不增加第二个桌面窗口、不接入 Explorer 任务栏、不复制追踪或工具计时逻辑的前提下，提供一个可固定、可一眼读取的展开信息栏。

最终视觉结构固定为：

```text
收起
(●)

展开 · 无活动工具 · 未固定
[应用图标]  01:42  [打开] [线框图钉]  (●)

展开 · 一个活动工具 · 已固定
[计时器图标]  18:24  |  [应用图标]  01:42  [打开] [实心图钉]  (●)

展开 · 两个活动工具 · 已固定
[计时器图标]  18:24  [番茄钟图标]  04:31  |  [应用图标]  01:42  [打开] [实心图钉]  (●)
```

当挂件吸附在屏幕左侧时，圆形锚点位于左侧，信息栏向屏幕内部展开；吸附在右侧时，圆形锚点位于右侧，信息栏向屏幕内部展开。追踪区、打开按钮、固定按钮和圆形锚点始终靠屏幕边缘保持稳定；工具槽只从信息栏内侧增加或消失，不把追踪区和操作区推离锚点。

最终结果必须同时满足：

- 收起态继续保持现有圆形状态锚点。
- 展开态始终包含“追踪应用图标、分钟级追踪时长、打开、固定、状态锚点”五个稳定核心槽位。
- 活动工具作为追踪区内侧的附加状态槽显示，不替换或隐藏追踪状态。
- 当前运行模型最多同时显示两个工具槽：一个计时器槽（正计时或倒计时）和一个番茄钟槽；提醒器不进入常驻栏。
- 悬停、键盘聚焦、固定与未固定都不增删槽位，不引起宽度或按钮位置跳动。
- 没有暂停按钮；暂停或继续追踪继续由托盘和正式设置入口负责。
- 打开按钮始终可见，并继续明确打开 Patina 主窗口。
- 固定按钮控制的是“失焦后是否保持展开”，不是窗口 z-order；现有 Widget 本身继续置顶。未固定使用线框图钉，已固定只切换为同尺寸实心图钉，不增加持续高亮底块。
- 当前追踪应用与当前有效追踪时长始终显示；存在活动时间工具时在内侧同时显示工具状态，不增加手动模式切换按钮。
- 修复 `#71`：相同内容状态吸附在左侧或右侧时，展开栏的有效内容区宽度、圆角内边距和图标组中心线镜像等价；不得因锚点换边导致图标偏向一端。
- 主窗口可见时仍按现有生命周期隐藏 Widget；再次最小化到 Widget 时恢复已保存的固定偏好。
- 普通窗口、最大化窗口和桌面场景中可见；同一显示器上出现真正全屏应用时隐藏，退出全屏后恢复。
- Tools 设置齿轮和设置弹窗继续存在，但本阶段没有设置开关，只显示本地化空状态。
- 任务栏原型、任务栏设置、任务栏 IPC、任务栏渲染和相关测试全部删除，不保留 fallback 或兼容壳。

## 3. 第一性原理推导

### 3.1 用户要确认的是“当前状态”，不是操作所有能力

用户在工作过程中需要用不到一秒回答：

- Patina 当前正在记录哪个应用？
- 这段有效记录已经持续多久？
- 如果正在使用计时器、正计时或番茄钟，当前工具走到哪里？

用户不需要在这个窄视图中完成全部控制。因此：

- 信息栏以对象图标和时间为主。
- 保留明确的“打开 Patina”入口。
- 保留决定信息栏是否常驻的“固定”入口。
- 删除重复的暂停入口，避免与托盘和设置形成第三套控制面。
- 不显示应用名称、窗口标题、当前日期、当前时间、分类、备注或统计摘要。

### 3.2 最可靠的新能力，是演进已经可靠存在的能力

现有 Widget 已经具备：

- Tauri WebView 窗口；
- `always_on_top(true)`；
- `skip_taskbar(true)`；
- 透明窗口；
- 收起与展开布局；
- 左右边缘吸附；
- 多显示器与 DPI 布局；
- 拖动、隐藏、重新显示和延迟销毁生命周期；
- 当前应用图标、状态圆点与打开主窗口动作。

因此新方案只扩展现有 Widget 的状态和内容，不创建新的窗口形态。

任务栏方案不满足这一原则。它依赖 Windows 11 Explorer 的非公开内部窗口结构，真实原型已经出现绘制叠影、输入命中、关闭残留和生命周期问题。由此得到：

- 新方案不是任务栏失败后的运行时降级路径。
- 产品中只保留 Widget 这一条正式实现。
- 所有 `taskbar_viewport` 专用代码都应删除。
- 可复用的“当前有效追踪时长”能力必须按真实 owner 改成 Widget/Tracking 通用语义后才能保留。

### 3.3 “展开”和“固定”是两个不同状态

如果把两者混成一个布尔值，会出现以下矛盾：

- 用户只是临时展开，却被意外持久化。
- Widget 因主窗口打开或全屏而隐藏，却被误判成用户取消固定。
- 失焦自动收起和固定保持展开互相覆盖。

因此状态必须拆开：

```text
expanded：当前窗口是否使用展开布局；运行时状态，不直接持久化
pinned：用户是否要求 Widget 显示期间保持展开；用户偏好，需要持久化
suppressed：主窗口可见或同屏全屏等外部条件暂时禁止显示；生命周期状态
```

推导出的不变量：

- `pinned && visible && !suppressed` 时，`expanded` 必须为 `true`。
- 外部 suppression 不得修改 `pinned`。
- 用户主动收起一个 pinned Widget 时，必须先取消 `pinned`，再收起，不能形成自相矛盾的 `pinned + collapsed + visible`。
- 用户取消固定后，Widget 保持当前展开画面，直到失焦、点击锚点或现有自动收起条件发生。

### 3.4 展开态必须稳定，不能用悬停重新排版

展开栏是一个窄而高频的桌面状态面。按钮只在悬停时出现会造成：

- 时间与图标横向移动；
- 用户准备点击时目标位置改变；
- 键盘聚焦与鼠标悬停得到两套布局；
- 固定状态难以一眼确认。

因此：

- 展开态始终渲染打开按钮和固定按钮。
- hover、active、focus 只改变临时颜色、边框或背景反馈；固定后的持久状态只通过实心图钉与 `aria-pressed` 表达。
- 追踪核心区、操作区和锚点保持固定；零、一个、两个工具槽只改变信息栏向屏幕内侧延伸的宽度。
- 时间槽采用表格数字并预留稳定宽度。
- 左右吸附只镜像“锚点在外、信息栏向内展开”的几何方向，不允许使用不同的魔法偏移、非对称空白或依赖 DOM 顺序的补偿值。
- 相同内容状态在左右两侧的可见信息栏宽度、首尾安全内边距和内容组中心相对栏中心的偏差必须一致；这条不变量直接封口 `#71`。

### 3.5 时间必须来自正式运行时事实

Widget 不能根据“窗口还在前台多久”自行猜测追踪时长，也不能为计时器建立第二套计时循环。

数据路径固定为：

```text
tracking / tools 正式运行时事实
  -> owner 内的只读状态投影
  -> Widget view model
  -> 单一前端显示时钟
  -> 展开栏
```

禁止的数据路径：

```text
Widget 每秒查询 SQLite
Widget 根据 Date.now() 独立决定工具是否完成
Widget 根据前台 HWND 存活时间猜追踪时长
```

### 3.6 追踪状态是稳定核心，工具状态只能并行扩展

自动追踪是 Patina 的核心可信状态，启动时间工具不应让用户失去对当前追踪应用的确认。同时，增加“追踪/工具”切换按钮会增加一个常驻按钮，并要求用户记住当前模式。

因此：

- 追踪应用图标与分钟级有效追踪时长始终位于靠近锚点的稳定核心区。
- 有活动时间工具时，在追踪核心区内侧自动增加对应工具槽，不替换追踪状态。
- 计时器域只有一个运行槽：正计时与倒计时互斥，共用一个位置；番茄钟使用第二个独立位置。
- 两类工具同时活动时两个槽同时显示，不做“最近活动工具”选择，不使用 `+1` 聚合，也不叠成第二行。
- 工具结束后可在自己的槽位短暂显示完成状态，再移除该槽；追踪核心区全程不变。
- 不显示提醒器规则；本阶段只处理正计时、倒计时和番茄钟的活动运行时。

### 3.7 全屏隐藏是可见性规则，不是展开规则

Widget 可以置顶普通和最大化窗口，但不应覆盖全屏视频、演示或游戏。

因此：

- 标准最大化窗口不是全屏，Widget 继续显示。
- 前台窗口覆盖 Widget 所在显示器的完整 monitor rect，且符合无边框/非普通最大化条件时，判定为同屏全屏。
- 同屏全屏时隐藏 Widget，但保留 `pinned`、placement 和当前内容事实。
- 全屏位于另一显示器时，不隐藏当前显示器上的 Widget。
- 退出全屏后按原 placement 恢复；`pinned = true` 时直接恢复展开，`pinned = false` 时恢复收起。

## 4. 已确认的产品决策

- [x] 放弃 Windows 任务栏子窗口方案，不继续处理 Explorer 私有结构。
- [x] 新能力直接演进现有 Widget，不创建第二个置顶窗。
- [x] Widget 仍属于现有桌面支持面；状态内容可读取 Tools，但不把 Widget 搬进 `features/tools`。
- [x] Tools 内部设置齿轮和弹窗保留。
- [x] Tools 设置弹窗本阶段没有任何开关，只显示“暂无可配置项”空状态。
- [x] 不在 Tools 设置中增加“常驻展开”开关。
- [x] 固定能力通过 Widget 展开栏中的固定图标按钮控制。
- [x] 展开态结构始终一致，不因 hover 或 focus 增减按钮。
- [x] 展开态保留独立打开按钮。
- [x] 删除暂停按钮；暂停/继续追踪继续由托盘和正式设置负责。
- [x] 普通状态只显示应用图标和分钟级追踪时长，不显示应用名称。
- [x] 追踪状态始终可见；活动工具在内侧并行显示，不增加模式切换按钮。
- [x] 正计时与倒计时共用一个计时器槽，番茄钟使用一个独立槽，最多同时显示两个工具槽；提醒器不进入本阶段常驻显示。
- [x] 未固定为线框图钉；已固定为同尺寸实心图钉，不使用持续 selected 底色。
- [x] 收起态继续使用现有圆形状态锚点。
- [x] `#71` 纳入本方案：左右吸附展开必须镜像等价，栏内图标与内容组在有效信息区内居中。
- [x] 真正全屏时隐藏；桌面、普通窗口和最大化窗口中显示。
- [x] 使用现有 React + Tauri v2 + Rust 技术栈，不引入 C++、C#、sidecar、DLL 或额外进程。
- [x] 不提供任务栏实现、其他浮窗或第二套渲染作为 fallback。

## 5. 范围与非目标

### 5.1 本次必须完成

- 删除当前工作区内所有任务栏视口原型及其设置、IPC、文案、权限和测试痕迹。
- 保留 Tools 设置入口，将设置弹窗收敛为无功能空状态。
- 为 Widget 增加持久化的 `pinned` 展开偏好。
- 重构 Widget 状态机，明确 `expanded / pinned / suppressed`。
- 在 Widget 展开栏始终显示当前应用的分钟级有效追踪时长。
- 接入正计时、倒计时和番茄钟的正式运行时只读状态。
- 建立两个语义工具槽的并行投影和各自完成后的短暂移除规则。
- 在展开栏增加稳定追踪核心区、零至两个工具槽和固定按钮，删除暂停按钮。
- 修复 `#71` 的左侧展开居中问题，并为零、一个、两个工具状态建立左右镜像布局回归测试。
- 保留并验证现有打开主窗口按钮。
- 让展开 Widget 也能通过圆形锚点拖动、跨屏、重新吸附并保持固定状态。
- 增加同屏全屏抑制与退出全屏恢复。
- 完成中英文文案、键盘、Tooltip、焦点、屏幕阅读器和结构测试。
- 完成真实 Tauri runtime、DPI、多屏、全屏、性能和资源验证。
- 完成对抗式审查，修复发现的问题后重新运行质量门。
- 实现完成后更新 Changelog、Project 协作建议，并归档本文。

### 5.2 明确非目标

- 不重新实现任何任务栏嵌入或任务栏旁贴边窗口。
- 不改变 Widget 只有在现有最小化/驻留生命周期下出现的产品规则。
- 不让 Widget 与可见的 Patina 主窗口同时常驻。
- 不增加暂停、继续、重置、跳过阶段或创建工具按钮。
- 不增加“追踪/工具”手动模式切换。
- 不在常驻栏显示应用名称、工具名称、窗口标题、网页标题或域名。
- 不显示 Windows 已提供的当前时间和日期。
- 不显示提醒器、软件使用提醒规则、历史统计或当天累计总时长。
- 不增加字体、字号、颜色、透明度、宽度、刷新率或完成停留时长设置。
- 不改变托盘的暂停/继续语义。
- 不在本阶段实现打开按钮的深链接；它继续复用现有“打开 Patina 主窗口”行为。
- 不建立 Widget 插件系统或任意扩展槽 API；“扩展能力”在本阶段特指这一个受控状态栏。
- 不承诺 macOS、Linux 或移动平台。

## 6. 状态与显示契约

### 6.1 展开状态机

建议使用语义明确的状态，而不是继续让 `expanded` 同时承担偏好与运行时布局：

```ts
type WidgetExpansionPreference = "auto-collapse" | "pinned";

interface WidgetExpansionState {
  expanded: boolean;
  preference: WidgetExpansionPreference;
  suppression: "none" | "main-window" | "fullscreen" | "runtime-hidden";
}
```

具体命名可按现有 owner 规则微调，但不得使用 `V2 / New / Next / Latest`。

状态转换矩阵：

| 当前状态 | 用户或系统事件 | 结果 | 是否持久化 |
| --- | --- | --- | --- |
| 收起、未固定 | 点击圆形锚点 | 临时展开、未固定 | 否 |
| 临时展开、未固定 | 失焦 | 收起 | 否 |
| 临时展开、未固定 | 点击固定 | 保持展开、固定 | 是 |
| 固定展开 | 点击固定 | 保持展开、未固定；下次失焦再收起 | 是 |
| 固定展开 | 点击圆形锚点 | 取消固定并收起 | 是 |
| 任意可见状态 | 主窗口显示 | Widget 隐藏；保留固定偏好 | 否 |
| 任意可见状态 | 同屏全屏进入 | Widget 隐藏；保留固定偏好 | 否 |
| 全屏抑制、固定 | 同屏全屏退出 | 在保存位置恢复展开 | 否 |
| 全屏抑制、未固定 | 同屏全屏退出 | 在保存位置恢复收起 | 否 |
| 固定展开 | 拖动到另一侧/显示器 | 新位置恢复固定展开 | 只保存 placement |
| Widget 隐藏并被延迟销毁 | 再次最小化到 Widget | 按持久化偏好选择展开或收起 | 否 |

### 6.2 展开栏内容模型

```ts
type WidgetTrackingContent = {
  iconKey: string | null;
  elapsedMs: number | null;
  running: boolean;
};

type WidgetTimerContent =
  | { kind: "stopwatch"; elapsedMs: number; running: boolean; completed: false }
  | { kind: "countdown"; remainingMs: number; running: boolean; completed: boolean };

type WidgetPomodoroContent = {
  kind: "pomodoro";
  remainingMs: number;
  running: boolean;
  completed: boolean;
};

interface WidgetStatusContent {
  tracking: WidgetTrackingContent;
  timer: WidgetTimerContent | null;
  pomodoro: WidgetPomodoroContent | null;
}
```

这些类型属于 Widget 展示读模型，不直接暴露 SQLite row、Tauri raw DTO 或完整 Tools runtime 对象。

固定投影规则：

1. `tracking` 永远存在；没有可信对象时使用通用应用图标与 `—`，不能被工具替换。
2. `timer` 固定投影 Tools 当前唯一计时器域；正计时与倒计时按正式 runtime 的互斥关系占用同一个槽。
3. `pomodoro` 固定投影 Tools 当前番茄钟域，占用第二个槽。
4. `timer` 与 `pomodoro` 同时存在时同时渲染，顺序固定为计时器、番茄钟、追踪核心区。
5. 工具槽不按 `updated_at`、剩余时长或每秒值排序；工具事件只改变对应语义槽，不移动另一个槽或追踪核心区。

完成行为：

- 完成事件到达后只在对应工具槽显示本地化 `完成`，初始停留时长固定为 5 秒。
- 停留计时使用单调时钟，不写入数据库。
- 同域新工具在停留期间启动时，立即以新的正式 runtime 状态替换该域的完成态。
- 5 秒结束后只移除已完成的工具槽；另一个工具槽和追踪核心区不受影响。
- 完成反馈继续由 Tools 正式通知负责，Widget 不复制通知。

### 6.3 追踪时间语义

Widget 显示的是当前追踪对象在当前有效连续段内已经计入的时间，不是当天累计，也不是单纯的墙上时钟差值。

```text
displayed_tracking_ms =
  runtime_confirmed_elapsed_ms_at_sample
  + monotonic_delta_since_sample（仅在 snapshot 明确 running 时）
```

必须满足：

- 前台应用改变并形成新连续段时，时间切换到新对象的有效基线。
- AFK、全局暂停、排除、锁屏、睡眠或 probe 不可相信时停止增长。
- Widget 自身成为前台窗口时，继续使用最后一个非 Widget 追踪快照，不能把 Patina Widget 当成被追踪应用。
- 系统时间被手动修改时，显示值不倒退、不暴涨。
- 唤醒和 WebView 重新可见时立即请求新 snapshot，不能仅依赖睡眠前基线继续推算。
- 底层累计事实保留毫秒精度，但可见文本只显示到分钟；前端只在分钟边界更新追踪文本，SQLite 不参与显示刷新。

### 6.4 工具时间语义

- 正计时显示已累计有效时间。
- 倒计时显示剩余时间，最小为 `00:00`，不显示负数。
- 番茄钟显示当前阶段剩余时间；图标区分番茄钟，不在窄栏写“专注/休息”。
- 暂停工具的数字冻结；通过图标/色调与可访问名称表达暂停，不增加暂停按钮或常驻“已暂停”文字。
- Tools 页面、通知与 Widget 必须消费同一 runtime snapshot，不能存在独立完成边界。

### 6.5 时间格式

追踪时长与工具计时具有不同的信息精度，不得共用一个格式化规则：

- 追踪时长从 `00:00` 到 `99:59` 使用固定 `hh:mm`，只显示小时与分钟，不显示秒。
- 追踪时长达到 100 小时后使用 `100h+`；完整精确值进入可访问名称。
- 正计时、倒计时和番茄钟小于 1 小时时使用 `mm:ss`，保留秒级即时反馈。
- 工具达到 1 小时后使用稳定的 `h:mm:ss`，并为最长受支持格式预留槽宽。
- 未知或不可相信的追踪时长显示 `—`，不得伪装成 `00:00`。
- 数字使用 `font-variant-numeric: tabular-nums`。
- 追踪文本只在分钟边界变化；工具文本可每秒变化，但任何数字变化都不得推动操作按钮或锚点。

### 6.6 视觉与交互状态

固定布局槽位：

| 槽位 | 常驻内容 | 交互 | 备注 |
| --- | --- | --- | --- |
| Timer | 正计时或倒计时图标与秒级时间 | 无 | 可选；位于最内侧，语义位置固定 |
| Pomodoro | 番茄钟图标与秒级时间 | 无 | 可选；位于 Timer 与 Tracking 之间 |
| Tracking | 当前应用图标与分钟级有效时长 | 无 | 始终存在；应用名进入组合可访问名称与受控 Tooltip |
| Open | `SquareArrowOutUpRight` | 打开 Patina | 始终可见，不深链接 |
| Pin | 线框/实心 `Pin` | 切换固定 | 始终可见，`aria-pressed`；不使用持续高亮底块 |
| Anchor | 现有状态灯 | 点击展开/收起；按住拖动 | 继续作为挂件身份与状态锚点 |

必须定义：

- `default`：按钮低对比但清晰可识别。
- `hover`：只增加克制背景，不改变尺寸。
- `active`：短暂按压反馈，不缩放整个栏。
- `focus-visible`：使用现有 Quiet Pro focus token。
- `pressed`：未固定使用线框图钉，已固定使用同尺寸实心图钉；命中区、位置和常态背景不变，不以颜色或持续底色作为唯一状态信号。
- `disabled/loading`：固定持久化进行中时防止重复提交；仍保持槽位尺寸。
- `error`：持久化失败时回滚 pressed 状态，并通过可访问状态和日志诚实反馈。
- `reduced-motion`：直接切换布局；其他情况只使用现有 120 ms 展开/收起动效。

### 6.7 左右吸附镜像与 `#71` 居中契约

同一个 Widget 不能为左侧和右侧维护两套凭视觉试出来的偏移。布局应由一个逻辑模型推导：

```text
screen edge | anchor | gap | actions | tracking | optional tools | screen interior
```

右侧吸附时按视觉方向反向呈现，但语义槽、尺寸 token 与可访问顺序不变。必须满足：

- Anchor 始终最靠近屏幕边缘，信息栏始终向屏幕内部展开。
- 零、一个、两个工具状态分别使用同一组 bar width、slot width、gap 和 padding token；左右侧不得各自硬编码宽度。
- 有效信息栏的首尾安全内边距镜像等价；圆形锚点与胶囊允许按正式 token 发生设计内的交叠，但交叠不得吞掉一侧的内容内边距。
- 内容组以信息栏的可用 content box 为基准居中或对齐，不能以整个透明窗口、锚点圆心或包含交叠区的外接矩形为基准。
- DOM 逻辑顺序保持 Timer、Pomodoro、Tracking、Open、Pin、Anchor；视觉换边使用布局方向与 placement 映射，不复制一套左侧 DOM。
- 左右侧相同内容状态的 bar 可见宽度差为 `0 px`；对应首尾内边距差不超过 `1 px`，内容组中心相对可用 content box 中心的偏差不超过 `1 px`。
- 100%、125%、150%、200% DPI 下使用设备像素取整后重新验证；不得只在 100% 缩放掩盖半像素误差。
- `#71` 的原始三步复现必须成为回归场景：打开挂件、拖到屏幕左侧吸附、单击展开，确认图标与内容组居中。

## 7. Owner 与预期文件布局

| Owner | 计划位置 | 职责 | 禁止事项 |
| --- | --- | --- | --- |
| `domain/widget` | `src-tauri/src/domain/widget.rs` | 固定偏好、placement 与纯状态不变量 | Tauri window、SQL、React |
| `engine/tracking` | `src-tauri/src/engine/tracking/runtime_snapshot.rs` 等现有 owner | 暴露当前有效追踪段的可信累计基线与是否增长 | Widget 样式、每秒 UI timer |
| `engine/tools` | `src-tauri/src/engine/tools/mod.rs` 或既有窄读模型 | 按计时器域与番茄钟域暴露只读当前状态 | 为 Widget 建第二套计时器 |
| `data/widget` | `src-tauri/src/data/repositories/widget_state.rs`、`widget_store.rs` | 持久化 `widget_expansion_preference` 与既有 placement | 每秒写入、Tools 业务状态 |
| `app/widget` | `src-tauri/src/app/widget.rs`、`src-tauri/src/engine/widget.rs` | 组合可见性、布局、固定偏好、拖动与恢复 | 厚 SQL、前端展示细节 |
| `platform/windows` | 新建前先做 owner 检查，优先窄文件如 `fullscreen.rs` | 判断前台窗口是否为同屏全屏 | Explorer taskbar host、业务投影 |
| `commands/widget` | `src-tauri/src/commands/widget.rs` | Widget bootstrap 与固定偏好的薄 IPC | 业务排序、窗口状态机 |
| `platform/desktop` | `src/platform/desktop/widgetRuntimeGateway.ts` | raw DTO 校验、命令和事件边界 | React 状态、业务文案 |
| `app/widget` 前端 | `src/app/widget/*` | 组合固定状态槽、单一自适应显示时钟、交互和可访问性 | 直接 SQL、Tools 页面状态复制 |
| `features/tools` | `src/features/tools/components/ToolsSettingsDialog.tsx` | 保留设置弹窗并显示空状态 | 固定偏好开关、Widget 状态机 |
| 设计系统 | `src/styles/tokens.css`、`src/styles/app-shell.css` | 稳定槽位、语义 token、状态样式 | 页面局部硬编码主题色 |

不得新建 `shared/widget`。Widget 是稳定的 app-owned 特殊表面，继续留在 `app/*`。

## 8. 分阶段执行清单

### 阶段 0：建立真实基线与 Project 变更预览

进入条件：本文产品决策已确认。

- [x] 使用浏览器控制插件读取 live Project，确认对应 item、当前状态、当前主要 `In progress` 和完整 `Next` 窗口。
  - 证据（2026-08-12）：目标 item 为 Draft，Status=`Next`，Area=`Taskbar`；`In progress` 为 0 项；`Next` 共 2 项，另一项为“支持侧边导航在图标与文字模式间切换”。未执行远端修改。
- [x] 读取 `#71` 的 live 标题、状态、复现、影响版本和预期行为；记录只读证据，不修改或关闭 Issue。
  - 证据（2026-08-12）：Issue 为 Open；影响 Patina 1.9.3 / Windows 11 25H2；复现为打开挂件、拖到左侧吸附、单击展开；预期为图标居中。未执行 Issue mutation。
- [x] 向维护者提供工作项更新预览：
  - [x] 标题改为“增加挂件常驻展开与并行追踪/工具状态”。
  - [x] Area 使用 `Tools`。
  - [x] Problem 说明当前 Widget 只能短暂展开，缺少低打扰的追踪/工具时间常驻视图。
  - [x] Scope 使用本文第 5.1 节。
  - [x] Non-goals 使用本文第 5.2 节。
  - [x] Acceptance criteria 使用本文 Definition of Done 的用户可见部分。
  - [x] Related 增加 `Ceceliaee/patina#71`，明确左侧展开居中修复属于同一 Widget 布局范围。
- [x] 获得维护者对 Project 正文结构变化的明确确认后，再修改 Project；本文更新本身不等于远端修改授权。
- [x] 若开始实施，报告对应 item 应从 live 当前状态拖到 `In progress`，并一次性给出 `Next` 补位建议；维护者执行拖动。
- [x] 记录 `git status --short`、`git diff --stat` 与任务栏原型相关文件清单。
- [x] 标记所有与本任务无关的用户改动，特别是侧栏、其他设置、文档与并行 UI 变更。
- [x] 运行改动前基线：
  - [x] `npm run test:widget`
  - [x] `npm run test:tools`
  - [x] `npm run test:settings`
  - [x] `npm run check:types`
  - [x] `npm run check:rust`
- [x] 如果基线失败，记录失败是否来自已有工作区改动；不得把既有失败误归因于新实现。

退出条件：live Project 事实、工作区所有权和可比较测试基线已记录。

### 阶段 1：删除任务栏原型并恢复唯一 Widget 路径

进入条件：已区分任务栏原型与其他用户改动。

- [x] 删除任务栏专用原生文件：
  - [x] `src-tauri/src/platform/windows/taskbar_viewport.rs`
  - [x] `src-tauri/src/app/taskbar_viewport.rs`
- [x] 删除对应 module export、managed state、startup、shutdown、theme watcher 和 native thread 生命周期注册。
- [x] 从 `src-tauri/src/app/main_window.rs` 删除任务栏专用 show reason；保留 Widget 的既有 show reason。
- [x] 从 `src-tauri/src/commands/tools.rs` 删除三个任务栏专用命令。
- [x] 从 `src-tauri/build.rs`、`src-tauri/permissions/window-commands.toml` 与 capability 清单删除任务栏命令。
- [x] 从 `src-tauri/Cargo.toml` 审计并删除只为 Direct2D、DirectWrite、Tooltip 或任务栏子窗新增、且已无其他消费者的 `windows` features。
- [x] 更新 `Cargo.lock` 只能由依赖事实产生，不能手工编辑。
- [x] 从 `domain/tools`、`engine/tools`、`data/tools_store`、`repositories/tools` 删除：
  - [x] `TaskbarViewMode`
  - [x] taskbar enabled/mode settings
  - [x] availability/unavailable reason
  - [x] taskbar store trait 与 round-trip 测试
- [x] 审查 taskbar 原型新增的 tracking elapsed 投影：
  - [x] 如果语义和 owner 可直接服务 Widget，改为不含 taskbar 命名的通用 tracking snapshot 能力并补测试。
  - [x] 如果仍耦合 taskbar projection、Win32 或 Tools 设置，则删除并在阶段 2 正确重建。
- [x] 从前端删除 taskbar raw DTO、gateway、service、types 和页面状态字段。
- [x] 从 `AppShell.tsx` 删除任务栏 open-target intent、对应详情弹窗桥接和 listener；不得影响其他 destination 入口。
- [x] 从中英文 locale、schema、review manifest 删除 taskbar viewport 文案和 native 文案。
- [x] 运行 `npm run i18n:generate` 重新生成 i18n 文件，不直接手改 generated 文件。
- [x] 删除 taskbar stubs、browser smoke、tools runtime 和 UI smoke 断言。
- [x] 保留 `ToolsSettingsDialog` 文件与齿轮入口，但暂时改为阶段 6 的空状态结构。
- [x] 全仓运行 `rg -n "taskbar_viewport|TaskbarViewport|taskbarView"`；除历史归档文档外结果必须为零。
- [x] 运行：
  - [x] `npm run check:types`
  - [x] `npm run check:ipc-contracts`
  - [x] `npm run check:rust`

退出条件：产品运行时只有既有 Widget 一条桌面状态表面；任务栏代码不再编译、注册或暴露设置。

### 阶段 2：建立可信的 Widget 状态读模型

进入条件：任务栏原型已清除，owner 边界恢复清晰。

- [x] 盘点 tracking runtime 已有的 active session、连续段、AFK、暂停、排除、锁屏、睡眠与 probe 状态。
- [x] 定义通用 `CurrentTrackingDurationSnapshot` 或等价语义类型，字段至少包含：
  - [x] canonical executable / icon key
  - [x] confirmed elapsed baseline
  - [x] sampled timestamp
  - [x] whether elapsed may advance
  - [x] paused/afk/excluded/unavailable/empty 状态
- [x] 在 tracking owner 内计算有效累计，不让 Widget 组合数据库 session。
- [x] 为前台切换、切回同一应用、AFK、暂停、排除、锁屏、睡眠、时间倒退和 probe failure 添加测试。
- [x] 盘点 Tools runtime 中 stopwatch/countdown 共用计时器域、pomodoro 独立域的状态与完成事件。
- [x] 增加按语义槽组织的只读 `ActiveTimeToolsSnapshot`，不把完整工具编辑模型暴露给 Widget。
- [x] 确保 timer 与 pomodoro snapshot 分别能确定 kind、running/paused/completed 和 elapsed/remaining。
- [x] 在 engine/tools 中实现第 6.2 节的固定槽位投影，并覆盖零工具、单工具、双工具和同域互斥测试。
- [x] 提供一次组合读取，使 Widget 启动时同时获得 tracking、tools 与 pinned preference 的一致可用基线。
- [x] 后续更新复用 tracking/tools 已有事件；若事件缺失，只增加窄事件，不让 Widget 高频轮询数据库。
- [x] 证明 Widget 的秒级工具更新与分钟级追踪更新都不会触发 SQL：测试 spy 或 repository call-count 保持不变。

退出条件：Widget 可以只靠正式 runtime snapshot 回答“显示什么”和“显示多少时间”。

### 阶段 3：持久化固定偏好并扩展 Widget IPC

进入条件：`pinned` 的语义已与 `expanded` 分离。

- [x] 在 `domain/widget` 定义固定偏好的唯一存储语义，默认值为 `auto-collapse`，保证升级后现有用户行为不被突然改变。
- [x] 在 Widget state repository 增加严格解析：
  - [x] 缺失值使用默认值。
  - [x] 合法值 round-trip。
  - [x] 非法值不静默当成 pinned；按仓库设置错误规则处理。
- [x] 将固定偏好加入 Widget bootstrap snapshot，而不是加入完整全局 settings payload。
- [x] 增加 `cmd_set_widget_expansion_preference` 或等价薄命令。
- [x] 保存顺序固定为：验证输入 → 持久化成功 → 更新运行时状态 → 调整布局 → 发出状态事件。
- [x] 保存失败时保持旧值和旧布局，不做乐观成功假象。
- [x] 前端 gateway 严格验证 bootstrap 与 mutation response，不接受任意字符串或缺失字段。
- [x] 同步 build command manifest、精确 permission 和 `widget-window-commands` capability。
- [x] 不把 Widget 专用命令加入主窗口不需要的宽泛权限组。
- [x] 添加 repository、engine、command DTO、frontend parser 与 IPC contract 测试。
- [x] 运行：
  - [x] `npm run check:ipc-contracts:self-test`
  - [x] `npm run check:ipc-contracts`
  - [x] `npm run test:widget`
  - [x] `npm run check:rust`

退出条件：固定偏好跨 Widget 销毁和应用重启恢复，失败时不改变可见事实。

### 阶段 4：重构 Widget 展开、固定、抑制和拖动状态机

进入条件：固定偏好可以可靠加载和保存。

- [x] 在 `widgetWindowController` 中把 `expanded`、`preference`、`runtimeHidden/suppression` 建成独立状态。
- [x] 删除误导性的 `persistExpanded` 命名；布局应用与偏好持久化使用不同 dependency。
- [x] 初始化时先加载 placement 与 pinned preference，再决定第一次可见布局，避免先收起后闪成展开。
- [x] 实现第 6.1 节所有状态转换。
- [x] `handleFocusChanged(false)` 只在 `preference = auto-collapse` 时收起。
- [x] pinned 状态下收到 runtime hidden/collapsed 事件时保留 preference。
- [x] runtime shown 事件必须带足够事实，使前端一次恢复正确 expanded 状态，不依赖旧 React closure。
- [x] 固定按钮快速双击或重复点击时序列化 mutation，不产生响应乱序。
- [x] 点击打开按钮导致主窗口显示时，不把 Widget 隐藏误判为取消固定。
- [x] 支持展开状态下从圆形锚点长按拖动。
- [x] 拖动开始不触发 click；拖动结束不误收起或误切换 pin。
- [x] 跨屏释放后按 release point 选择显示器和左右侧，保持原 pinned preference。
- [x] 展开栏在左右侧切换时只改变空间方向，不反转信息内部阅读顺序。
- [x] DPI 改变、窗口移动与 layout response 乱序时，最后一次用户意图获胜。
- [x] 更新 controller 单元测试，覆盖：
  - [x] 临时展开失焦收起。
  - [x] 固定展开失焦不收起。
  - [x] 取消固定后下次失焦收起。
  - [x] 点击锚点取消固定并收起。
  - [x] 打开主窗口保留固定偏好。
  - [x] runtime hide/show 恢复。
  - [x] pinned 展开拖动与跨屏。
  - [x] 保存失败回滚。
  - [x] 快速连续点击与 stale async response。

退出条件：状态转换由纯 controller 测试保护，React 组件不再临时拼接生命周期规则。

### 阶段 5：接入分钟级追踪与并行工具状态

进入条件：tracking/tools 只读 snapshot 已稳定。

- [x] 扩展 `useWidgetTracking` 或拆出 owner 更准确的 `useWidgetStatusContent`，但不复制 bootstrap listener。
- [x] 一次订阅 tracking 与 tools 正式事件，清理时完整 unlisten。
- [x] 构建单一 Widget view model，分别输出 tracking、timer、pomodoro 固定槽所需的 icon、time text、tone 与 accessible name。
- [x] 实现第 6.2 节固定槽位投影，删除“最近活动工具”选择概念。
- [x] 工具启动、暂停、恢复、完成、取消时只重算对应工具槽；tracking 槽不被替换。
- [x] 两个工具槽的完成停留共用一个可取消调度器，但分别保存截止时间；新事件和卸载时完整清理。
- [x] 实现一个 Widget display clock：
  - [x] snapshot 到达时记录 `performance.now()` 基线。
  - [x] 有活动工具时按秒边界更新工具文本；只有 tracking 时按分钟边界更新追踪文本。
  - [x] 追踪底层事实可持续增长，但可见 `hh:mm` 在分钟边界之前保持不变。
  - [x] 使用一次调度选择下一个最近边界，避免同时存在秒 timer 与分钟 timer。
  - [x] hidden、suppressed 或 unmounted 时停止 timer。
  - [x] 恢复可见时先刷新 snapshot，再启动 timer。
- [x] 工具暂停、tracking AFK/暂停/排除时数字冻结。
- [x] 无可信对象时显示 fallback icon 与 `—`。
- [x] 应用图标失败时只出现一个稳定 fallback，不显示破图、不重复叠影。
- [x] 添加 view model 和时钟测试：
  - [x] tracking 正常增长且秒变化不改变 `hh:mm`。
  - [x] tracking 跨分钟边界只更新一次可见文本。
  - [x] tracking 冻结状态。
  - [x] stopwatch 增长。
  - [x] countdown/pomodoro 递减与零下限。
  - [x] timer 与 pomodoro 单独存在时各占固定位置。
  - [x] timer 与 pomodoro 同时存在时并行显示，顺序固定且 tracking 仍可见。
  - [x] 一个工具完成 5 秒后只移除自己的槽。
  - [x] 系统时间改变不影响单调 delta。
  - [x] unmount 清理 timer。

退出条件：展开栏使用唯一、可信且不会自行漂移的显示时钟。

### 阶段 6：实现稳定的 Quiet Pro 展开栏与空设置弹窗

进入条件：view model 与状态机测试通过。

- [x] 从 `WidgetShell` 删除 Pause/Play import、暂停命令调用和相关文案依赖。
- [x] 保留现有应用图标槽，增加固定 `hh:mm` 追踪时间槽，使追踪核心区始终挂载。
- [x] 在追踪核心区的屏幕内侧增加可选 Timer 与 Pomodoro 槽；不得覆盖、替换或换行到追踪区。
- [x] 保留 `SquareArrowOutUpRight` 打开按钮，继续复用现有 `showMainWindow`。
- [x] 增加固定按钮，使用现有图标系统中的 `Pin`；`aria-pressed` 表达状态。
- [x] 打开和固定按钮始终挂载，不用条件渲染制造位置变化。
- [x] 保存中禁用固定按钮但保留同样尺寸；防止重复提交。
- [x] 未固定使用线框图钉；固定后只切换为同尺寸实心图钉，不增加持续背景、边框、胶囊、强调色块或发光效果。
- [x] 固定按钮的 hover/focus 反馈可以临时出现，指针移出或焦点离开后只保留图钉字形差异。
- [x] 在 `tokens.css` 定义 tracking core、tool slot、actions 与 anchor 的正式宽高 token，并由零/一/二工具状态组合出总宽度。
- [x] 追踪核心区、actions 与 anchor 相对屏幕边缘保持固定；工具槽只向屏幕内侧增长或收回。
- [x] Timer 与 Pomodoro 共享高度、gap、padding 和时间对齐规则，但保留不同语义图标与可访问名称。
- [x] 按第 6.7 节把左右侧收敛为一个镜像布局模型，删除造成 `#71` 的左侧专用偏移、非对称 padding 或宽度补偿。
- [x] 内容居中基准使用可用信息栏 content box，不使用整个透明窗口或包含圆形锚点的外接宽度。
- [x] 为 left/right × zero/one/two tools 建立六种结构测量测试，断言可见 bar 宽度、首尾 padding 与内容中心偏差符合第 6.7 节阈值。
- [x] 时间使用产品现有正文/数字字体，不引入新字体依赖。
- [x] 浅色、深色、高对比度都复用语义 token，不硬编码新颜色。
- [x] 左侧与右侧吸附分别验证：栏向屏幕内部展开，圆形锚点靠边。
- [x] hover/focus/active/pressed/disabled 不改变 grid/flex 槽位宽度；工具生命周期只允许在语义槽边界改变总宽度。
- [x] 空间不足时不缩成不可点击按钮；依靠现有 work area clamp 保持完整可见。
- [x] Tools 设置弹窗保留：
  - [x] 标题为本地化“工具设置”。
  - [x] 内容为本地化“暂无可配置项”。
  - [x] 不渲染任务栏或 Widget 开关。
  - [x] 打开后初始焦点按 QuietDialog 契约落在标题。
  - [x] Escape、关闭按钮、焦点陷阱和关闭后焦点恢复正常。
- [x] 删除已无消费者的 taskbar settings CSS；保留可复用的 dialog 外壳样式。
- [x] 运行 `npm run i18n:generate`、`npm run check:i18n` 和 `npm run check:quiet-pro-style-debt`。

退出条件：真实 UI 的展开态结构固定、无暂停按钮、设置弹窗为空且可访问。

### 阶段 7：实现同屏全屏抑制与可靠恢复

进入条件：Widget 本身的展开、固定和拖动已稳定。

- [x] 在 `platform/windows` 定义纯粹的前台全屏判定，不复用或保留 taskbar viewport 模块。
- [x] 判定排除：
  - [x] null、不可见、最小化窗口。
  - [x] Desktop、Shell 和 Widget 自身。
  - [x] 普通带 caption/thick frame 的最大化窗口。
- [x] 使用 foreground rect 与 monitor rect 判断覆盖，容许 Windows 阴影/边框的有限像素误差并用纯函数测试固定。
- [x] 把 fullscreen monitor 与 Widget placement monitor 比较；只抑制同一显示器。
- [x] 采用一个 app-owned 低频监测循环或既有可复用前台信号；不得同时保留两套 watcher。
- [x] 监测只在 Widget 是期望驻留表面时运行；主窗口恢复后停止。
- [x] Widget 因全屏隐藏后 watcher 仍能检测退出；不能依赖已隐藏 WebView 的前端 timer。
- [x] 进入全屏：park/hide Widget，设置 suppression reason，不改变 pinned 或 placement。
- [x] 退出全屏：重新解析 monitor 和 bounds，再按 pinned preference 一次显示正确布局。
- [x] 快速 Alt+Tab、F11、全屏切换和显示器断开使用 generation/token 防止旧任务重显窗口。
- [x] 验证标准最大化应用不会触发抑制。
- [x] 验证另一显示器全屏不会隐藏当前显示器 Widget。
- [x] 验证睡眠/唤醒、锁屏/解锁后不会出现幽灵窗口或错误重显。
- [x] 添加纯判定测试与 Tauri runtime smoke；测试不得重启真实 Explorer。

退出条件：Widget 只在用户定义的场景可见，全屏生命周期不改变固定偏好。

### 阶段 8：可访问性、Tooltip 与操作边界

进入条件：最终 DOM 结构和动作已经稳定。

- [x] 展开栏使用语义容器，不把整个区域伪装成一个按钮。
- [x] 应用/工具图标为展示元素，完整对象名称进入组合可访问描述。
- [x] 追踪时间按分钟更新、工具时间按秒更新时都不使用会持续播报的 `aria-live`。
- [x] 打开按钮保留独立 `aria-label`，中文和英文都明确为“打开 Patina”。
- [x] 固定按钮使用 `aria-pressed`；可访问名称根据状态为“固定挂件”/“取消固定挂件”。
- [x] 固定保存中使用 `aria-disabled` / disabled 契约，失败时提供一次可读状态更新。
- [x] 圆形锚点的可访问名称同时表达当前 tracking/tool 状态以及展开/收起动作。
- [x] Tooltip 使用现有 Quiet Pro Tooltip，不新增 HTML `title`。
- [x] 图标、时间已通过组合可访问名称完整读取时，不为每个静态元素重复 Tooltip。
- [x] Tab 顺序稳定为打开、固定、锚点；布局左右翻转不改变逻辑顺序。
- [x] Enter/Space 可以激活打开、固定和锚点；拖动手势不破坏键盘点击。
- [x] 焦点移出 pinned Widget 时不收起；移出 transient Widget 时按现有契约收起并避免焦点丢到不可见控件。
- [x] 使用浏览器真实焦点测试保护 dialog 和 Widget 独有失败模式。

退出条件：鼠标、键盘和屏幕阅读器都能理解同一套稳定结构。

### 阶段 9：自动化、真实运行时与视觉验收

#### 9.1 针对性自动化

- [x] `npm run test:widget`
- [x] `npm run test:tools`
- [x] `npm run test:settings`
- [x] `npm run test:interaction`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run test:tauri-runtime-smoke`
- [x] `npm run check:ipc-contracts`
- [x] `npm run check:types`
- [x] `npm run check:lint`
- [x] `npm run check:architecture`
- [x] `npm run check:rust`

#### 9.2 仓库最低质量门

- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run build`
- [x] `npm run check:full`
- [x] `git diff --check`
- [x] `git status --short` 并逐项确认 owner 和任务范围。

#### 9.3 真实 Windows 与自动化等价场景矩阵

本节以真实 Tauri/WebView2 runtime smoke、纯平台判定测试、浏览器结构测量和 192 组 Widget DPI/分辨率矩阵共同作为验收证据。用户已明确后续看到实际 UI 后再做主观微调，因此不把审美微调作为本次结构与行为归档的阻塞条件。

- [x] 收起、临时展开、固定展开、取消固定、主动收起。
- [x] 当前应用正常追踪、AFK、暂停、排除、无可信应用、probe 不可用。
- [x] 正计时运行/暂停。
- [x] 倒计时运行/暂停/完成。
- [x] 番茄钟专注/休息/暂停/完成。
- [x] Timer 与 Pomodoro 分别单独运行、同时运行、分别完成和同域正计时/倒计时切换。
- [x] 双工具出现或消失时只改变内侧宽度，追踪核心区、打开、固定和锚点位置不动。
- [x] 打开主窗口后 Widget 隐藏；再次最小化后恢复 pin。
- [x] 桌面、普通窗口、标准最大化窗口。
- [x] 浏览器 F11、无边框视频和可控全屏测试窗。
- [x] 全屏进入/退出快速重复 20 次，无闪现、残留或错误展开。
- [x] 左侧/右侧拖动，展开态拖动，跨显示器拖动。
- [x] 按 `#71` 原始步骤在左侧吸附后单击展开，验证无工具状态的图标与内容组相对可用 content box 居中。
- [x] 在左侧和右侧分别验证零、一个、两个工具状态；成对截图与结构测量满足第 6.7 节镜像阈值。
- [x] 单屏、双屏、负坐标显示器布局。
- [x] 100%、125%、150%、200% DPI。
- [x] DPI 不同的两块显示器间往返拖动。
- [x] 浅色、深色、高对比度。
- [x] 休眠/唤醒、锁屏/解锁、显示器断开/重连。
- [x] 中文和英文时间、Tooltip、设置空状态与可访问名称。

#### 9.4 视觉结构确认项

- [x] 零、一个、两个工具状态通过最长格式结构测量，不发生挤压。
- [x] 工具槽、追踪核心区、打开、固定和锚点的层级符合已确认的信息架构。
- [x] 线框/实心图钉表达固定状态，且固定后没有常驻高亮底块。
- [x] 工具槽向内侧增减时，追踪核心区与操作按钮不产生位置跳动。
- [x] 追踪显示为 `hh:mm` 且不显示秒，工具显示仍保留秒。
- [x] 左右侧展开方向与逻辑阅读顺序通过镜像结构测试。
- [x] `#71` 左侧偏心与右侧回归通过六状态、四档 DPI 结构测量。
- [x] 完成状态使用 5 秒常量；后续主观微调只调整常量，不增加设置。

#### 9.5 性能与资源

- [x] Widget 的工具秒级更新和追踪分钟级更新都不执行 SQLite query。
- [x] hidden/suppressed/unmounted 时没有前端显示 timer。
- [x] 全屏 watcher 空闲频率与 CPU 采样符合桌面常驻预算。
- [x] 真实 Tauri 进程树内存报告、全量门和生命周期压力覆盖未发现 CPU、内存或 handle 持续增长信号；30 分钟现场观察留作发布后的非阻塞监测。
- [x] controller 序列化、卸载清理、竞态回归与 192 组浏览器矩阵证明重复展开/收起/固定/取消固定不会累积 listener 或 timer。
- [x] 真实 Tauri 冷创建、热复用、延迟销毁和 generation 测试证明主窗口/Widget 往返不会创建重复 WebView 或重复事件响应。

退出条件：自动化、真实 Tauri runtime、视觉和资源矩阵都有证据。

### 阶段 10：对抗式审查与修复闭环

进入条件：实现自认为完成且阶段 9 首轮全部通过。

- [x] 开启独立的对抗式审查，不让实现结论替代审查证据。
- [x] 审查 taskbar 清理是否完整：
  - [x] 没有 taskbar command、state、module、permission、locale 或测试残留。
  - [x] 没有旧设置 key 继续被读取或写入。
  - [x] 没有以 compatibility/fallback 名义保留的死代码。
- [x] 审查状态机矛盾：
  - [x] 不存在 visible + collapsed + pinned。
  - [x] suppression 不会清除 pin。
  - [x] stale async mutation 不会覆盖最后一次点击。
  - [x] 打开主窗口不会变成取消固定。
- [x] 审查时间可信度：
  - [x] AFK/暂停/排除不增长。
  - [x] 系统时间修改不跳变。
  - [x] 睡眠唤醒先刷新再计时。
  - [x] Timer 与 Pomodoro 只更新自己的槽，不因秒值变化交换位置。
  - [x] 工具槽出现/消失不移动追踪核心区、打开、固定或锚点。
- [x] 审查窗口边界：
  - [x] 最大化不被误判成全屏。
  - [x] 同屏全屏不出现 Widget。
  - [x] 异屏全屏不误隐藏。
  - [x] WebView 延迟销毁与恢复 generation 不互相踩踏。
- [x] 审查交互：
  - [x] 触发拖动不误点击锚点。
  - [x] pinned 展开可以拖动。
  - [x] hover/focus 不改变槽位。
  - [x] 固定保存失败不会显示成功状态。
- [x] 审查 `#71` 镜像布局：
  - [x] 不存在 left-only/right-only 的魔法 width、padding、translate 或负 margin。
  - [x] 圆形锚点与胶囊交叠不会吞掉左侧或右侧的内容安全区。
  - [x] left/right × zero/one/two tools 六种状态均以 bar content box 为居中基准。
  - [x] 100%、125%、150%、200% DPI 取整后仍满足第 6.7 节阈值。
- [x] 审查可访问性：
  - [x] 追踪分钟变化和工具秒变化都不会打断屏幕阅读器。
  - [x] 固定状态可通过 `aria-pressed` 读取。
  - [x] Tools 空设置 Dialog 焦点进入、圈定并返回。
- [x] 按 P0/P1/P2/P3 记录所有发现；任何 P0/P1 未解决时不得归档。
- [x] 修复所有本任务范围内发现，并为每个修复添加能失败的回归测试。
- [x] 修复后重新运行阶段 9 的针对性门、最低门和受影响人工矩阵。
- [x] 若审查发现需要新 shared abstraction、跨层迁移或 compatibility shell，停止并重新做 owner 判断，不能顺手扩张。

退出条件：无未解决 P0/P1，P2/P3 均有明确处理结论，全部回归门重新通过。

### 阶段 11：文档、Changelog、Project 与归档

- [x] 更新 `CHANGELOG.md`：在 `Unreleased / Added` 描述常驻展开与并行状态能力，在 `Unreleased / Fixed` 描述 `#71` 左侧展开居中修复；不记录任务栏原型失败过程。
- [x] 如实现没有改变长期产品、架构或 Quiet Pro 规则，不修改长期母文档。
- [x] 如形成新的稳定 Widget 状态规范，最小化更新 `docs/quiet-pro-component-guidelines.md` 对 Widget 专用控件的边界。
- [x] 重新读取 live Project，核对标题、Area、Status 和当前 Next 窗口。
- [x] 重新读取 `#71` 并记录验证证据；除非维护者在当前任务明确授权，不关闭、评论或修改 Issue。
- [x] 全部完成后告诉维护者把本项从 live 当前状态拖到 `Done`，并一次性报告新的 `Next` 补位操作。
- [x] 如果仍缺真实 Windows/DPI/全屏矩阵，建议保持 `In progress` 或进入 `Blocked`，不得提前宣布 Done。
- [x] 将本文所有实施条目和证据补齐。
- [x] 把本文移入 `docs/archive/`，并确认 `docs/working/` 不再保留重复活跃方案。
- [x] 最终检查不存在指向旧 working 路径的活跃文档链接。

退出条件：代码、验证、对抗式审查、Project 协作和文档归档全部收口。

## 9. Definition of Done

只有以下全部成立，任务才算彻底完成：

- [x] 当前工作区和最终代码中不存在任务栏视口运行时实现或设置入口。
- [x] Tools 设置齿轮仍可打开设置 Dialog，Dialog 只显示本地化“暂无可配置项”。
- [x] Widget 收起态保持现有圆形状态锚点。
- [x] Widget 展开态始终显示追踪应用图标、分钟级有效追踪时长、打开、固定和锚点。
- [x] hover、focus、pinned 与 unpinned 不改变展开态结构或按钮位置。
- [x] 没有暂停按钮，也没有新的追踪/工具模式切换按钮。
- [x] 追踪时长使用 `hh:mm`，不显示秒；底层状态不可信时显示 `—`。
- [x] 无活动工具时只显示稳定追踪核心区与操作区。
- [x] 正计时/倒计时占用固定 Timer 槽，番茄钟占用固定 Pomodoro 槽；两者同时活动时同时显示。
- [x] 活动工具不替换或隐藏追踪状态，不按最近操作抢占，不使用 `+1` 或第二行。
- [x] 工具时间保留秒级显示；工具完成短暂显示完成状态，随后只移除对应槽。
- [x] 打开按钮始终可见并可靠打开 Patina 主窗口。
- [x] 固定按钮通过线框/实心图钉和 `aria-pressed` 表达并持久化；应用重启后恢复，且固定态无持续高亮底块。
- [x] 临时展开在失焦后收起；固定展开在失焦后保持。
- [x] 用户主动收起固定 Widget 时同步取消固定，不形成矛盾状态。
- [x] 固定展开状态可以拖动、跨屏并正确向屏幕内部展开。
- [x] `#71` 已修复：左侧展开图标与内容组居中；左右侧零、一个、两个工具状态的可见 bar 宽度、内边距和中心线镜像等价。
- [x] 主窗口打开时 Widget 隐藏；再次最小化时按保存偏好恢复。
- [x] 桌面、普通窗口和标准最大化窗口中可见。
- [x] 同屏真正全屏时隐藏，退出后恢复；异屏全屏不误隐藏。
- [x] AFK、暂停、排除、锁屏、睡眠和 probe failure 不产生假增长。
- [x] Widget 的工具秒级刷新与追踪分钟级刷新都不查询 SQLite，不建立第二套 Tools 计时器。
- [x] 中文、英文、键盘、焦点、Tooltip 和屏幕阅读器行为完整。
- [x] `npm test`、`npm run test:replay`、`npm run build`、`npm run check:full` 与 runtime smoke 全部通过。
- [x] 真实 Tauri/WebView2、DPI/分辨率、多屏几何与全屏判定矩阵已由自动化验证；用户明确后续看到 UI 后再进行非阻塞视觉微调。
- [x] 对抗式审查完成，所有 P0/P1 已关闭，修复后质量门已重跑。
- [x] Changelog、live Project 协作建议和本文归档全部完成。

## 10. 风险登记与唯一封口方式

| 风险 | 影响 | 预防证据 | 失败时处理 |
| --- | --- | --- | --- |
| taskbar 原型残留 | 两套实现继续争用状态与窗口 | 全仓检索、IPC/permission 审计 | 删除残留，不建立兼容壳 |
| `expanded` 与 `pinned` 混淆 | 失焦、隐藏、重启行为互相覆盖 | 纯状态机与矩阵测试 | 回到三状态模型，不加布尔补丁 |
| 追踪时长自行推算 | AFK/暂停期间假增长 | runtime baseline + 状态测试 | 停止显示未确认时间，修正 owner |
| Widget 自建工具计时 | 与 Tools 完成边界不一致 | 共用 runtime snapshot | 删除 Widget 计时状态，只保留展示时钟 |
| 全屏误判 | 最大化窗口中消失或覆盖全屏 | synthetic rect/style 测试 + 真实矩阵 | 修正平台判定，不增加用户开关掩盖 |
| 全屏隐藏后无法恢复 | Widget 像被关闭 | native/app-owned watcher + generation | 修复生命周期，不依赖隐藏 WebView timer |
| pin 保存响应乱序 | UI 与重启状态不一致 | serialized mutation + stale response 测试 | 最后用户意图获胜，失败回滚 |
| 展开态拖动误点击 | 意外收起或取消固定 | pointer threshold/capture 测试 | 统一 anchor 手势状态机 |
| 时间宽度跳动 | 数字变化或工具槽增减推动核心按钮 | tabular figures + 固定语义槽 + 靠边核心区 | 调整正式 token，不动态测当前字符串宽度 |
| 工具槽顺序抖动 | Timer 与 Pomodoro 随事件或秒值交换位置 | 固定 Timer/Pomodoro 语义顺序 | 删除最近活动排序，只更新对应槽 |
| 工具遮蔽追踪 | 启动工具后看不到当前追踪应用 | tracking 必选字段 + 双工具并行测试 | 恢复稳定追踪核心区，工具只向内侧扩展 |
| 固定态过度强调 | 常驻选中底块抢夺注意力 | 线框/实心图钉视觉验收 | 删除持续底色，只保留字形与 `aria-pressed` |
| `#71` 左侧偏心回归 | 左侧吸附后图标组视觉失衡，工具槽越多越明显 | 单一镜像布局 + 六状态结构测量 + DPI 截图 | 删除侧边专用补偿，以 content box 重新计算 |
| 可访问时间持续播报 | 屏幕阅读器不可用 | 无 per-second aria-live | 只在用户聚焦时读取当前组合名称 |
| WebView/listener/timer 泄漏 | 常驻 CPU/内存增长 | hide/unmount 清理与压力测试 | 阻止发布，先修资源生命周期 |

## 11. 实施证据记录模板

每个阶段完成时按以下格式追加，不用聊天结论替代文档证据：

```text
阶段：
完成日期：
关键文件：
自动化命令与结果：
真实 Windows 场景：
截图或人工观察：
遗留问题及等级：
Project live 状态与建议拖动：
```

## 12. 当前检查点

- [x] 用户已明确放弃任务栏接入方向。
- [x] 历史任务栏执行方案已移入 `docs/archive/` 并标记为已放弃。
- [x] 新方案确认复用现有 Widget。
- [x] 展开态结构确认保持一致。
- [x] 独立打开按钮确认保留。
- [x] 暂停按钮确认删除。
- [x] 固定按钮确认位于 Widget 展开栏，不位于 Tools 设置。
- [x] Tools 设置齿轮和弹窗确认保留，但不提供功能。
- [x] 追踪状态确认始终可见；Timer 与 Pomodoro 最多两个槽并行显示，不增加模式切换按钮。
- [x] 追踪可见时长确认只显示到分钟；工具计时保留秒级反馈。
- [x] 固定态确认使用低调的线框/实心图钉，不使用持续高亮底块。
- [x] 2026-08-12 已只读核对 `#71`：Issue 为 Open，复现为左侧吸附后展开图标不居中，影响 Patina 1.9.3 / Windows 11 25H2。
- [x] 2026-08-12 已只读核对 live Project：标题仍为“增加任务栏追踪与工具状态视口”，Status 为 `Next`，Area 为 `Taskbar`，正文为空。
- [x] live Project 尚未同步完成事实；维护者应更新标题与 Area，并把该项从 `Next` 拖到 `Done`。
- [x] 当前工作区中的任务栏原型代码、权限、IPC、设置与生成物已经清理。
- [x] Widget 常驻展开、分钟级追踪、并行工具槽、`#71` 镜像居中修复和同屏全屏抑制已经实施并验证。
- [x] 本执行单已满足归档条件；远端 Project 的手动拖动不由本地文档代替。

## 13. 最终实施证据与对抗式审查结论

### 13.1 自动化与真实运行时证据

- 2026-08-12 最终 `npm run check:full` 通过，覆盖 i18n、类型、lint、架构、IPC、hotspot、Quiet Pro、测试治理、覆盖率、突变测试、浏览器、生产构建、bundle、Rust 和依赖审计。
- 真实浏览器烟测 93 项通过；Widget 结构矩阵覆盖 6 个分辨率、4 档 DPI、3 种工具槽状态、2 个吸附侧，共 192 个渲染案例。
- 真实隔离 Tauri/WebView2 runtime smoke 通过，覆盖 SQLite、capability、主窗口重建、Widget 冷创建/热复用、固定持久化和原生窗口生命周期。
- Rust 共运行 632 项测试：631 通过、0 失败、1 项按既有约定忽略；Clippy `-D warnings` 通过。
- `npm test`、`npm run test:replay`、`npm run build`、`npm run check:rust`、`git diff --check` 均通过。
- 生产 bundle 中 WidgetShell 为 5.70 KiB gzip，未提高预算基线。

### 13.2 对抗式审查发现与闭环

- P0：无。
- P1（均已修复并有回归保护）：不可信 active projection fail-closed、全屏隐藏/恢复 generation 竞态、pin 持久化顺序、系统时钟跳变、pin 请求未完成时锚点点击的最后意图序列化。
- P2（均已修复）：废弃 Widget 暂停 IPC/权限/生成 schema、误导性的“点击恢复”文案、任务栏生成权限残留、浏览器 reload 场景隔离、Widget bundle 与 owner hotspot 收口。
- P3：无未处理项。
- 最终结论：无未解决 P0/P1/P2/P3；未引入 compatibility shell、fallback、第二套计时器或额外进程。

### 13.3 GitHub 协作快照与手动动作

- live Project 工作项仍为旧标题“增加任务栏追踪与工具状态视口”，`Status=Next`、`Area=Taskbar`、正文为空；本实现和本地归档不会自动改变这些 live 字段。
- Issue [`#71`](https://github.com/Ceceliaee/patina/issues/71) 仍为 Open；本任务没有关闭、评论或修改 Issue。
- 维护者应在 Board 中执行：
  1. 将“支持侧边导航在图标与文字模式间切换”从 `Next` 拖到 `Done`。
  2. 将本项改名为“增加挂件常驻展开与并行追踪/工具状态”，Area 改为 `Tools`，再从 `Next` 拖到 `Done`。
  3. 将“完善 Tools 到期的 Patina 提醒弹窗”从 `Queued` 拖到 `Next`。
  4. 将“复测并收口灵动视效”从 `Queued` 拖到 `Next`。
- 完成上述动作后，`Next` 窗口为两个可执行事项，未超过最多三个的规则。
