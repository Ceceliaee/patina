# 挂件退役与迷你窗 owner 收口执行方案

> 状态：本地实施与自动化验收完成，已归档；实机验收已转交
> 创建 / 更新：2026-10-25
> 实施 owner：承接本方案的实现者；产品与设备验收：Ceceliaee
> 目标：迷你窗独立拥有必要能力，完整移除旧挂件及“最小化到挂件”设置
> 本次交付：挂件退役实现、执行与验收记录；仅有实际结果的项目勾选

## 1. 从第一性原理确定终态

### 1.1 用户需要的是能力，不是两套小窗实现

桌面小窗的价值是低打扰地查看当前记录与工具状态、在需要时返回主窗口。窗口的位置、收起、展开和关闭是承载这些能力的交互机制。迷你窗已经提供独立入口与自己的窗口生命周期，旧挂件无需继续作为第二套承载机制存在。

退役的收益应体现为窗口、状态、后台任务、配置、接口和维护路径的实际减少。将 `widget` 整体改名为 `mini`，或者在旧文件中保留转发函数，不能达到这个目标。

| 必要事实 | 推导出的实现约束 | 可观察结果 |
| --- | --- | --- |
| 一个桌面信息面只需要一套窗口机制 | 保留 mini，移除旧挂件的创建、布局、监听、回收和恢复链 | 运行时不会创建 label 为 `widget` 的窗口或启动它的专属任务 |
| 内容的事实来源仍是追踪与工具运行时 | mini 消费现有快照，不复制 tracker、计时器或番茄钟状态机 | 主窗口释放后 mini 仍显示同源状态；关闭 mini 不停止追踪或工具 |
| 最小化有明确的系统语义 | 主窗口统一最小化到任务栏，删除可选策略 | 不再存在最小化设置字段、分支或保存入口 |
| 迷你窗由用户独立打开 | 保留标题栏入口，打开 mini 不隐藏 main | main 和 mini 可同时存在，main 聚焦不关闭 mini |
| 当前数据比被移除功能的偏好更重要 | 精确清理失效偏好，保留追踪事实、工具数据和其他设置 | 升级与恢复后旧配置不再生效，业务数据保持原义 |
| 权限由窗口职责决定 | mini 继续只读内容，只能执行必要窗口操作 | mini 无法修改追踪、工具、数据库、凭据或恢复状态 |
| 所有权应服从职责与依赖方向 | mini 私有能力归 mini；平台事实与公共业务留在真实 owner | 不出现 platform 反向依赖 mini 业务，入口不承接业务实现 |

### 1.2 已确定的产品行为

- 主标题栏保留独立的“打开迷你窗”按钮。
- 主窗口最小化进入任务栏，不打开 mini，也不隐藏到仅剩小窗。
- 设置 → 常驻 → 窗口行为移除整行“最小化到挂件”。不新增“最小化到任务栏”开关，也不替换为“最小化到迷你窗”。
- “关闭到后台”“显示托盘图标”“开机自启动”“静默启动”继续沿用现有语义。
- mini 保留顶部 / 左右停靠、悬停展开、延迟收起、自由浮动、保持展开、关闭和返回主窗口能力。
- mini 的记录状态、当前活动、图标、时长、工具状态、主题与语言维持当前口径；不借本次退役增加工具控制、追踪开关或今日统计。
- 现有 `mini_window_preferences` 保留。旧挂件位置和固定展开偏好不自动转换成 mini 偏好。

### 1.3 “不留兼容和冗余”的边界

交付代码不得保留旧挂件窗口、旧命令别名、旧事件桥接、旧配置读写、双写路径、功能开关或回退到挂件的分支。内部调用方在同一交付范围内全部切换，旧模块和导出实际删除。

旧设置名称可以出现在必要的数据清理 migration、升级 / 恢复测试和历史文档中。这些记录用于处理仍可能进入当前程序的旧数据库，不恢复旧功能。它们的保留和删除服从[架构中的兼容边界](../architecture.md#37-例外必须显式且尽量变薄)及[版本与发布政策](../versioning-and-release-policy.md)，不以字符串零命中为验收标准。

`Chrome_WidgetWin_1`、第三方程序的 `widget` 后缀、分类别名与历史发布记录不属于 Patina 挂件实现，不得随关键词批量删除。

## 2. 范围、前置条件与证据边界

### 2.1 本次实施范围

1. mini 内容、启动读取、图标读取和几何依赖的 owner 收口。
2. 旧最小化策略及设置全链删除。
3. 旧挂件偏好的精确清理，覆盖启动升级、SQLite 快照覆盖恢复和合并恢复。
4. 旧挂件窗口、生命周期、权限、事件、样式、测试和工具接线退役。
5. 本地化、当前文档与实际行为同步。
6. 数据、追踪、桌面运行时、权限和资源生命周期验证。

本方案不包含新增产品能力、改变 mini 视觉方向、重构追踪算法、扩大备份支持范围、删除用户历史、自动操作真实用户数据库、Git 提交 / 推送、Issue / Project 修改或发布。执行与外部操作授权遵循根 [AGENTS.md](../../AGENTS.md)。

### 2.2 工作区前置条件

编写本方案时，工作区包含尚未提交的 mini 实现、共享读取调整、权限产物、测试与文档变更。后续实施以包含这些变更的实际工作区为基础，不能仅从 `HEAD` 推断 mini 的实现，也不能用重置工作区来取得“干净基线”。

- [x] P0-01 记录实施开始时的 `git status --short`、当前提交和相关文件差异；将已有 mini 变更与本次退役新增变更区分清楚。
- [x] P0-02 确认工作区未被其他正在执行的任务并发改写；发生重叠时先协调受影响文件，继续不冲突的工作。
- [x] P0-03 重读[架构](../architecture.md)、[修复边界](../issue-fix-boundary-guardrails.md)、[工程质量](../engineering-quality.md)、[Quiet Pro](../quiet-pro-component-guidelines.md)和[本地化](../localization.md)的相关条款。
- [x] P0-04 【不适用：本次没有指定或明确映射的 Project item】如果实施任务明确对应现有 Project item，按[Project 维护](../github-project-maintenance.md)读取已登录的 live state；访问失败如实报告，不把私有条目复制到本文件。
- [x] P0-05 使用隔离测试 profile 和合成数据库准备升级 / 恢复夹具；记录真实数据目录与测试目录的隔离边界。
- [x] P0-06 根据实际源码建立调用清单，覆盖静态 import、动态 import、Rust module tree、IPC 字符串、capability、事件、生成配置和测试入口。

P0 完成条件：基线可识别，受保护数据与工作区边界明确，后续每项删除都有实际生产消费者依据。

### 2.3 现有证据可以证明什么

编写方案时，源码中的 mini 已有独立 label、入口、偏好和生命周期，但仍依赖 widget 命名下的内容与几何实现。本次已将这些存续能力迁入 mini owner。[mini 阶段归档](../archive/2026-10-24-mini-window-replacement-plan.md)记录了当时的自动化结果及人工设备验收边界，只作为历史参考。

本次退役会改变上述输入。先前通过的测试不能直接证明退役后的行为。混合 DPI、多屏、设备输入、锁屏恢复与最终操作手感仍需按第 8 节确认，不因计划归档而视为通过。

## 3. 当前依赖与目标 owner

下表是本次实施的定位地图；具体符号和测试入口仍以源码与 [package.json](../../package.json) 为准。目标名称表示拟采用的职责，不要求为每一行新增一个文件。

| 当前落点 | 当前承担的职责 | 退役后的归属与处理 |
| --- | --- | --- |
| `src/app/mini/MiniContent.tsx`、`MiniShell.tsx` | 使用 widget 内容模型、图标与返回主窗口接口 | 改为直接消费 mini 内容 owner 和既有窗口 gateway |
| `src/app/widget/widgetViewModel.ts`、`widgetStatusViewModel.ts` | 活动名称、状态优先级、时间显示、工具投影展示 | 保留 mini 实际消费的部分，归 `src/app/mini/`；删除旧布局专用派生 |
| `src/app/hooks/useCompactTracking.ts` | 两个小窗共用的订阅、快照、健康读取，仍带 `pinned` 与 widget 命名 | 只剩 mini 消费后归 mini，保留请求顺序与停用逻辑，去除旧固定展开状态 |
| `widgetBootstrapService.ts`、`widgetIconService.ts`、`useWidgetObjectIcon.ts` | 分类 / 关联初始化、图标读取与失效保护 | mini 私有组合归 mini；分类规则和通用图标缓存留在现有 owner |
| `src/platform/desktop/widgetRuntimeGateway.ts` | 混合内容 IPC、旧窗口操作、窗口身份和主窗恢复 | mini 内容 IPC 归 mini gateway；窗口身份与主窗恢复归现有窗口适配 owner；旧操作删除 |
| `src-tauri/src/app/widget.rs`、`engine/widget.rs` | 旧窗口编排，以及仍被 mini 使用的内容快照 / 投影 | mini 专用快照编排归 `app/mini_window`；纯投影归对应 domain / engine owner；旧生命周期删除 |
| `src-tauri/src/domain/widget.rs` | 旧布局、投影 DTO、物理几何和显示器匹配 | mini 私有规则归 `domain/mini_window`；确有平台共同消费者的物理值类型使用窄领域 owner |
| `src-tauri/src/platform/windows/fullscreen.rs` | 返回目前名为 `WidgetPhysicalRect` 的系统几何事实 | 保持平台事实职责，改用不携带 widget / mini 业务语义的物理矩形类型 |
| `src-tauri/src/data/repositories/widget_runtime.rs`、`data/widget_store.rs` | bootstrap 查询，以及旧位置 / 展开偏好存储接线 | mini bootstrap 读取归 mini data owner；旧位置与展开 store / port 删除 |
| `src-tauri/src/commands/widget.rs` | 内容读取、旧布局操作、主窗口恢复和鼠标查询 | mini 内容命令归 mini；主窗口恢复归 window；无剩余消费者的命令删除 |
| `app/main_window.rs`、`app/state.rs`、`app/tray.rs` | main 与 widget 交接、显示意图、延迟释放和入口恢复 | 删除挂件交接分支，保留 main 自身关闭到后台、重建和防陈旧回调机制 |
| settings 各层及 `SettingsResidentPanel.tsx` | 最小化策略类型、默认值、存储、同步和开关 | 删除完整策略链；最小化只调用任务栏路径 |

### 3.1 归属判断规则

- 只有 mini 使用的函数直接放在 mini 对应层，不为已退役的第二个消费者保留“共享小窗框架”。
- 追踪快照、工具运行时、分类关联、图标缓存、主题和语言保持其原有事实 owner，mini 只组合和展示。
- 几何值类型若仍由 Windows 全屏检测与 mini 同时使用，可归入窄的中性领域模块，例如拟新增的 `domain/window_geometry.rs`；不要让 `platform/windows` 引入 `app/mini_window` 或 mini 交互策略。
- 主窗口恢复使用已有 `app/main_window` / tray 编排，不能为 mini 再实现一套恢复与重建链。
- `commands` 仅接收参数、检查窗口权限和调用 owner；`App.tsx` 仅负责窗口路由与应用装配。

## 4. P1：收口 mini 仍需的能力

P1 的终点是 mini 无需依靠旧挂件窗口模块即可工作。内部实施可以先移动调用方、随后删除旧消费者，但最终交付不得存在两套实现或保留兼容导出。

### 4.1 内容、bootstrap 与图标

- [x] P1-01 列出 `MiniContent` 实际使用的状态字段和纯函数，区分当前活动显示、追踪健康、工具投影与旧挂件布局；只保留前三类。
- [x] P1-02 将必要的内容模型和格式化函数移到 `src/app/mini/`，更新直接调用和类型引用；不在旧路径保留 re-export。
- [x] P1-03 将 `useCompactTracking` 收口为 mini 私有读取 owner；删除 `WidgetTrackingSnapshot` 等旧命名与不再被消费的返回值。读取启停由 mini 当前生命周期驱动。
- [x] P1-04 删除 bootstrap 中的旧 `pinned` 字段、数据库查询绑定、解析与 React 状态。mini 的保持展开只读取自己的 `Preferences.held`，不得存在第二份事实。
- [x] P1-05 保留 bootstrap 中当前必需的主题、语言、分类覆盖与应用关联数据；不扩大为读取全部设置。重新核对匿名活动和名称 / 图标处理。
- [x] P1-06 将图标 hook / service 归入 mini，继续使用现有图标缓存和图标修订通知；保留 key 切换、异步返回过期、卸载和失败时的处理。
- [x] P1-07 将内容快照的 Rust DTO、投影构建和编排移到相应 mini owner。保留 transition 锁、采样时间、身份一致性校验和失败语义。
- [x] P1-08 工具事件直接复用现有 `tools-runtime-changed` 及 `toolsRuntimeGateway` 中适用的订阅能力；删除 `onWidgetToolsChanged` 包装，保留工具的公共事件。
- [x] P1-09 保留“订阅先于首次读取”“只接受最新请求”“失败保留最后有效值”“卸载使请求失效”的约束。收起 / 抑制期间停止不必要读取，展开后获取新内容。
- [x] P1-10 验证时间外推、陈旧样本、暂停 / 空闲 / 异常状态、0–2 个工具、工具完成短暂显示、Patina 自身前台及匿名活动。不能因改名丢掉原有保护。

### 4.2 几何与序列化

- [x] P1-11 逐项标记旧几何定义的消费者：mini 几何、mini 原生窗口适配、Windows 全屏检测、旧挂件及测试。只迁移有存续消费者的定义。
- [x] P1-12 将 mini 专用显示器匹配、拖放目标与坐标规则归 mini 领域 owner；纯物理值类型按第 3.1 节处理，避免复制两套矩形或点类型。
- [x] P1-13 删除旧挂件左右窄条、工具槽扩宽、旧 anchor 与旧展开尺寸的规则和常量；不迁入 mini 继续闲置。
- [x] P1-14 保持 `mini_window_preferences` 的 JSON 字段和含义不变。Rust 类型改名不能改变现有 `monitor`、`work_area`、坐标、浮动矩形和 `held` 的序列化结果。
- [x] P1-15 用现有 mini 偏好样本验证读取、保存、重新打开与跨屏恢复；缺失 / 损坏值维持已有默认处理，不读取 widget 偏好兜底。

### 4.3 IPC 与调用方切换

- [x] P1-16 为 mini 内容 bootstrap、图标和 presentation 使用明确的 mini 命令名，统一修改 Rust handler、`build.rs`、permission set、前端 gateway 和测试 fixture；不保留 `cmd_get_widget_*` 别名。
- [x] P1-17 将 `cmd_show_main_window` 从旧 widget 模块移到已有窗口命令 owner；该操作继续调用唯一的 main 恢复路径，修正 `MainWindowShowReason::Widget` 等错误归因。
- [x] P1-18 将 `resolveCurrentAppWindowLabel` 等仍需的窗口身份适配移到现有 desktop window owner；最终应用窗口路由只区分 main 与 mini。
- [x] P1-19 检查 `cmd_is_primary_mouse_button_down` 及其前端导出是否还有消费者；只在真实边界仍需要时保留，删除仅服务旧拖动流程的 IPC。
- [x] P1-20 同步 `scripts/check-ipc-contracts.ts` 的命令分类和自测；类型、IPC 静态检查和内容 focused tests 通过后进入窗口拆除。

P1 完成条件：mini 的存续能力均有直接 owner；旧路径没有为了 mini 而保留的转发层；现有 mini 偏好与内容语义通过针对性验证。

## 5. P2：删除最小化策略和旧窗口生命周期

### 5.1 设置全链删除

- [x] P2-01 从 `SettingsResidentPanel` 删除“最小化到挂件”行、props 和回调；清理 `Settings.tsx` 的对应接线，不留隐藏开关或空白占位。
- [x] P2-02 从 `AppSettings`、`DEFAULT_SETTINGS`、`releaseDefaultProfile`、设置 normalization、持久化 key 映射和设置草稿比较中删除 `minimizeBehavior`。
- [x] P2-03 从 `useDesktopLaunchBehaviorSync` 删除对应依赖，确认仍由关闭行为和托盘设置触发必要同步。
- [x] P2-04 从 Rust `DesktopBehaviorSettings`、`MinimizeBehavior`、解析器、默认值和 `repositories/app_settings` 中删除策略字段与读取 / 写入分支。
- [x] P2-05 更新受影响的命令 DTO、设置保存校验与事件载荷；旧字段不再由当前前端发送，不再由正常设置保存路径写回。
- [x] P2-06 设置保存 / 取消 / 脏状态测试覆盖剩余选项，确认删除一个字段没有让其他设置被默认值覆盖。

### 5.2 main 与 widget 的交接退出

- [x] P2-07 将 `minimize_main_window` 收敛为任务栏最小化；保留最小化失败的正常错误反馈，不再执行挂件显示、main 隐藏、重试或回滚流程。
- [x] P2-08 删除 `minimize_main_window_to_widget`、`show_widget_for_minimize_with_retry`、`rollback_widget_minimize` 及仅服务这些路径的故障注入和诊断计数。
- [x] P2-09 从 `MainWindowLifecycleState` 删除挂件交接状态及 begin / commit / cancel 方法。逐项核对 generation、显示意图与待处理销毁 token，保留仍用于 main 重建或关闭到后台的机制。
- [x] P2-10 删除 main 聚焦 / 显示时关闭挂件的 Rust 接线，以及 `App.tsx` 中同步挂件可见性的 effect 和窗口订阅。
- [x] P2-11 从 tray 窗口事件分派、应用退出和主窗恢复路径删除 widget 分支；保留 tray 本身及 mini 的退出清理。
- [x] P2-12 从 bootstrap 移除 `WidgetWindowLifecycleState` 的管理注册；从 runtime 移除 `start_widget_fullscreen_watcher`，核对启动后不再有旧轮询任务。
- [x] P2-13 删除旧挂件创建、park、延迟销毁、全屏抑制 / 恢复、拖动、贴边和固定展开实现；mini 继续使用自己的单一 worker 与状态机。
- [x] P2-14 在 `webview_recovery` 中移除 `WindowKind::Widget`、恢复分支和诊断槽位。同步索引 / 数组 / 枚举映射，验证 main 与 mini 的登记、崩溃隔离、退避和退出取消仍正确。
- [x] P2-15 删除 `WidgetShell` 的 lazy import 与路由；未知 label 不得通过旧挂件分支获得内容或权限。

### 5.3 入口可达性

- [x] P2-16 覆盖 main 正常、最小化、关闭到后台、WebView 已释放四种状态；mini 返回主窗口时应复用或重建同一个 main。
- [x] P2-17 覆盖 mini 未打开、已打开、关闭和打开失败；最小化不能意外打开 mini，main 聚焦不能意外关闭 mini。
- [x] P2-18 覆盖“关闭到后台”与“显示托盘图标”的现有组合，尤其托盘关闭且 main 不可见的场景；核对既有恢复入口和二次启动行为，不把 mini 变成唯一救援入口。
- [x] P2-19 复查静默启动、自启动、更新重启和存储重启路径；旧挂件默认值消失后仍采用各自既有的启动 / 恢复策略。

P2 完成条件：当前产品不存在最小化策略选择；挂件不再参与任何窗口生命周期；主窗口和 mini 的可达性有正向运行证据。

## 6. P3：精确清理旧偏好并保护恢复流程

### 6.1 清理范围

当前已确认的失效 settings key 为：

| key | 退役处理 |
| --- | --- |
| `minimize_behavior` | 删除整项，无论旧值为 `widget`、`taskbar`、空值还是无效值；不再写入一个固定 `taskbar` 值 |
| `widget_placement` | 删除，不转换成 mini 位置 |
| `widget_expansion_preference` | 删除，不转换成 mini 的 `held` |
| `widget_side` | 删除旧位置遗留项 |
| `widget_anchor_y` | 删除旧位置遗留项 |

只删除已证明归旧挂件所有的精确 key，不使用 `LIKE '%widget%'` 或前缀通删。保留 `mini_window_preferences`、关闭 / 托盘 / 启动设置、主题语言、分类关联、凭据引用及所有追踪、导入和工具数据。若发现其他旧 key，先核对其写入者和消费语义再加入清理范围。

### 6.2 升级与数据清理顺序

- [x] P3-01 在 `data/schema.rs` 追加有版本记录的精确清理 migration；版本号按实施时的实际 migration head 选择，不修改已发布 migration 的 SQL 或 checksum。
- [x] P3-02 同步 `sqlite_pool` 的 migration head 覆盖检查、当前状态判定与历史归一化逻辑。数据清理不能仅因表结构已经存在就被推定为完成。
- [x] P3-03 专门测试 `normalize_current_baseline_migration_history_for_pool` 在 migration 前后都执行的路径：不能提前写入清理完成记录，也不能在第二次归一化时删除有效清理记录、导致每次启动重复迁移。
- [x] P3-04 对缺失旧 key、部分旧 key、全部旧 key、损坏 JSON / 无效字符串和无 mini 偏好的数据库执行升级；成功后旧 key 不存在，其他数据按字段值保持。
- [x] P3-05 对已经有 mini 偏好的数据库执行升级，验证其原始 JSON 及实际打开位置 / 保持展开结果不变。
- [x] P3-06 验证清理与 migration 完成标记的事务边界。失败时报告具体错误，不发布未通过准备的连接池；下一次启动可重试，不能靠吞错进入默认设置。
- [x] P3-07 连续打开、关闭、重新准备同一测试数据库，证明升级幂等，没有新增持久化开关或独立的“挂件退役完成”配置。

### 6.3 旧 SQLite 快照恢复

现有 `prepare_snapshot_backup` 会先对解出的候选库执行 `prepare_pool_schema`；覆盖恢复随后替换产品库，合并恢复从候选库读出记录后写入目标库。因此应优先让同一数据清理 migration 作用于候选库，避免在 UI、backup writer 和 merge 层各复制一份过滤表。

- [x] P3-08 沿预览、候选准备、覆盖、合并和连接池替换入口确认实际调用链，覆盖 schema 历史完整和需要归一化的受支持旧快照。
- [x] P3-09 覆盖恢复：候选库先完成清理与现有校验，再进入现有替换协议；恢复完成后的活动连接池读不到旧 key。
- [x] P3-10 合并恢复：候选库在 `load_backup_records` 前完成清理，`insert_missing_for_restore` 不会重新插入旧 key；目标端原有 mini 偏好继续遵守现有“已有设置优先”规则。
- [x] P3-11 覆盖恢复中 mini 偏好按现有覆盖语义来自备份；备份没有该项时使用 mini 默认值，不暗中保留目标库设置或读取旧挂件位置。
- [x] P3-12 测试候选清理失败、校验失败和替换中断。保留源备份与原库，复用已有回滚标记与恢复协议，不增加一套挂件专属备份 / 回滚机制。
- [x] P3-13 完成恢复后重新导出 SQLite 快照，再解包检查：不携带已清理 key；业务记录、mini 偏好和既有恢复规则仍有效。
- [x] P3-14 验证恢复与数据位置重启后，mini 的命令从当前 `AppSqlitePool` 读取，不继续持有替换前的连接池或旧设置缓存。

P3 完成条件：新装、直接升级、覆盖恢复和合并恢复都收敛到同一当前状态；失败保持既有恢复保障；没有为保留旧挂件功能而留下 reader、适配器或运行时分支。

## 7. P4：删除剩余文件、权限与配套资产

### 7.1 源码与追踪边界

- [x] P4-01 在 P1 消费者迁移完成后删除 `src/app/widget/`，删除旧 hook、`widgetRuntimeGateway.ts` 及相应导出；所有保留能力已从最终路径直接引用。
- [x] P4-02 删除 Rust `app/widget.rs`、`commands/widget.rs`、`engine/widget.rs`、`domain/widget.rs`、`data/widget_store.rs`、`repositories/widget_state.rs` 和 `repositories/widget_runtime.rs`；同步各 `mod.rs`。只有存续职责已迁出后才删文件。
- [x] P4-03 核对 `domain/tracking/process_filters.rs`、`session_identity.rs` 与 engine 中仅识别 `Patina Widget` 的控制表面分支，删除随旧窗口消失而失去生产触发者的逻辑。
- [x] P4-04 对挂件曾使用的“保持上一个追踪投影 / 会话”分支逐项证明消费者已消失，再简化调用方。不能把 `Patina Widget` 字符串替换成 `Patina Mini` 后自动赋予 mini 同样语义。
- [x] P4-05 保持 main 与 mini 当前身份处理和计时规则；用确定性测试证明 Patina 自身前台、AFK、暂停、工具运行与前台应用切换不会被本次删除改变。
- [x] P4-06 将 widget 专属行为测试退役；保留并迁移仍覆盖内容顺序、陈旧数据、匿名处理、时长或追踪不变量的测试。每项删除应能说明所保护行为为何已退出或由哪个测试继续保护。

### 7.2 权限和事件

- [x] P4-07 删除 `src-tauri/capabilities/widget.json`、`widget-window-commands` permission set、旧命令注册和分类；同步 main / mini 的精确命令集合。
- [x] P4-08 删除 `widget-runtime-shown`、`widget-runtime-collapsed` 的发送、订阅与 fixture；保留 tracking、settings、tools、icons 等仍有消费者的公共事件。
- [x] P4-09 重新生成 Tauri 权限 schema；生成内容应无旧挂件命令 / capability，不能手改生成 JSON 冒充源配置变更。
- [x] P4-10 窄化 mini 的权限，只保留现有职责所需的内容读取、自身窗口操作和返回 main。不得引入 SQL plugin、设置全量读取、工具控制或敏感命令权限。
- [x] P4-11 main-only Rust caller guard 的测试覆盖 mini 和未知 label；真实 runtime denial matrix 改为 main / mini，并保留未知 caller 的独立拒绝检查。
- [x] P4-12 从有效窗口主动调用已删除的旧命令，确认运行时失败；从 mini 调用敏感 main-only 命令确认拒绝。不能只检查命令名称从文本中消失。

### 7.3 样式、语言与构建

- [x] P4-13 删除 `app-shell.css` 中旧挂件选择器、专属动画和 `tokens.css` 中 `--qp-widget-*`；先核对共享主题 / 控件消费者，保留 mini 使用的 Quiet Pro token。
- [x] P4-14 将 mini 仍用的 `widget.*` 和 `accessibility.widget.*` 消息归到 mini 对应契约，删除仅服务旧界面的消息。资源 bundle 采用 mini 名称，不保留旧 namespace 别名。
- [x] P4-15 删除 `minimizeToWidget` 相关设置与无障碍消息。同步 `locales/schema.ts`、全部生产 locale、资源装载声明、翻译复核信息和翻译包术语。
- [x] P4-16 按[本地化流程](../localization.md#4-修改或新增文案)复核文案并运行 `pnpm run i18n:generate`；禁止直接编辑 generated 资源或人工伪造复核 hash。
- [x] P4-17 删除旧 widget bundle 预算项、入口断言与诊断字段；为存续的 mini 入口保留相应预算，不通过扩大阈值掩盖回归。
- [x] P4-18 梳理 `test:widget` 当前承载的旧 view-model 与 mini 测试，重命名 / 拆分为反映当前职责的叶子入口，更新默认测试图，确保每个测试仍有唯一可达 owner。
- [x] P4-19 更新 browser fixture、subscription probe、Tauri runtime、background policy、resource lifecycle、mutation 和架构 / 命名 / intake 检查中的旧接线。保留这些工具对存续行为的独有保护。

### 7.4 当前文档

- [x] P4-20 更新 `docs/architecture.md`：main / mini 两窗口模型、mini 独立内容 owner、权限矩阵和统一任务栏最小化契约。
- [x] P4-21 核对 `engineering-quality.md`、`quiet-pro-component-guidelines.md`、`localization.md` 中仍以 widget 为当前消费者的条款，改为真实存续表面，保留权限、资源和回归义务。
- [x] P4-22 检查 README、用户设置说明和当前 working 文档；只修改已改变的事实与失效链接。历史 archive 和已发布 changelog 保留其历史含义。
- [x] P4-23 实施完成后按发布政策记录用户可感知的移除与行为变化；不在本方案预设版本号，不把文档记录当作发布完成。

P4 完成条件：旧文件与注册实际消失，生成产物和测试图与源码一致，当前文档不再承诺挂件行为。

## 8. P5：验证矩阵与执行门槛

### 8.1 必须验证的场景

| 层级 | 场景 | 通过条件 |
| --- | --- | --- |
| 数据 | 全新数据库 | 无退役 key，mini 使用自己的默认值 |
| 数据 | 旧默认 `widget`、旧 `taskbar`、损坏偏好升级 | 精确清理，业务数据不变，启动可重复 |
| 数据 | 当前表结构但 migration 历史不同 | 清理不会被错误跳过，也不会每次启动被重新登记 |
| 数据 | 含旧偏好的 SQLite 快照覆盖 / 合并 | 源备份未改写，旧 key 不回流，设置优先级保持原契约 |
| 数据 | 清理或替换失败 / 中断 | 原数据可恢复，失败不发布候选连接池，不假报成功 |
| 内容 | 正常 / 持续参与 / 暂停 / 空闲 / 异常 / 陈旧样本 | 名称、状态、时间和图标与当前语义一致 |
| 内容 | 分类 / 关联 / 匿名变化、0–2 工具、工具完成 | 状态同源、无泄露、无重复状态机 |
| 浏览器 | 设置移除一行后保存 / 取消与键盘导航 | 无残留开关、空白分隔或无效焦点，其他设置正常 |
| 浏览器 | mini 主题、语言、键盘菜单和错误恢复 | 全部生产语言及浅 / 深主题可用，不重新引入旧消息 |
| 桌面 | main 最小化，mini 未开 / 已开 | main 进入任务栏，mini 保持自身状态，不创建 widget |
| 桌面 | main 聚焦、关闭到后台、被释放、从 mini 返回 | main 可恢复且不重复创建，mini 不被错误关闭 |
| 桌面 | tray 显示 / 隐藏、自启动、静默启动、重启 | 原有可达性和启动语义保持 |
| 权限 | mini 调用敏感命令，main / mini 调用退役命令 | 均按边界拒绝，main 正常权限保持 |
| 故障 | main / mini renderer 崩溃、过期回调、应用退出 | 故障隔离、可恢复，旧任务不复活，退出无残留 |
| 资源 | 重复开关 / 收起、长时间静置、仅 mini 存活 | 无 widget WebView / worker，无监听、线程或句柄持续增长 |
| 实机 | 混合 DPI、多屏、负坐标、拔屏、锁屏 / 睡眠 | 窗口可找回、几何正确、悬停不抢焦点、透明区不拦截无关点击 |

### 8.2 自动化执行

命令均从仓库根目录运行，以实施时的 `package.json` 为准。阶段 focused checks 用来定位问题；最终完整门槛仍按[工程质量](../engineering-quality.md#5-默认验证门槛)执行。

- [x] P5-01 运行受影响的 mini 内容、几何、设置与数据升级 focused tests；新测试通过实际 owner 行为断言，不使用源码字符串搜索冒充行为覆盖。
- [x] P5-02 检查类型、IPC、架构、Rust 边界、命名、测试治理和对应自测；有规则变更时验证其正反场景，没有放宽目录级例外。
- [x] P5-03 运行 `pnpm run check:full`，覆盖当前默认前端 / browser 门槛、Rust 格式 / 编译 / 测试 / clippy 和依赖检查。
- [x] P5-04 运行 `pnpm run test:tauri-runtime-smoke`，获得真实 main / mini 生命周期、命令、权限、数据库和恢复证据。
- [x] P5-05 运行 `pnpm run perf:desktop-lifecycle`，验证已调整的生命周期场景；旧 widget 场景可退役，main / mini 的资源、恢复和退出保护必须可达。
- [x] P5-06 对资源结果记录环境、profile、WebView / worker / 进程数、监听、句柄、线程及冷 / 暖唤出测量口径；不把不同进程集合的内存差直接写成 mini 独立收益。
- [x] P5-07 如果更改了性能敏感查询或读取路径，按风险追加 `pnpm run perf:stable`；只记录本次输入下实际获得的结果。
- [x] P5-08 如果实施中修改 changelog，运行 `pnpm run release:validate-changelog`；本文本身不要求构建安装包或启动发布流程。
- [x] P5-09 对失败先定位再修复；变更影响了哪些证据就重跑哪些证据，不用盲目整套重跑掩盖不稳定测试。所有未执行项记录原因与验收 owner。

CLI 联网检查按本机代理偏好执行：先检查对应工具配置、代理环境变量与当前 Windows 系统代理，沿用适用配置；不输出凭据，不写死端口，不修改永久代理设置。依赖审计离线证据只能按工程质量中的有效性条件使用。

### 8.3 人工设备与产品验收

- [x] P5-10 【已转交 Ceceliaee；未作产品签收】在下一次安装版验收时确认标题栏 mini 入口、统一任务栏最小化和设置行移除后的日常操作符合预期。
- [x] P5-11 【已转交 Ceceliaee；未作多屏实机验收】在下一次安装版验收时测试混合 DPI、跨屏拖动、顶部 / 左右停靠、负坐标及拔屏恢复；浏览器 DPR 模拟与领域几何测试不替代此项。
- [x] P5-12 【真实设备部分已转交 Ceceliaee】下一次安装版验收检查物理锁屏、睡眠恢复及日常全屏应用交互。自动化注入 power 消息、合成全屏窗口、悬停焦点与下层窗口点击的结果单独记录，不冒充物理设备签收。
- [x] P5-13 【已转交 Ceceliaee；未执行】下一次安装版验收按可用设备检查触屏、左右键互换、实体 Alt+F4、系统高对比度与极窄工作区。未在本任务切换用户的系统输入 / 显示配置。
- [x] P5-14 【处置完成】本任务交付为本地源码与自动化证据；不宣称具备上述设备矩阵的正式发布验收。涉及窗口可找回、点击和数据正确性的实机缺口由 Ceceliaee 在正式发布前完成；失败时修复当前 main / mini owner，不恢复旧挂件。

本节勾选表示转交或交付判断已完成，带“未执行 / 未验收”的项目不计为测试通过。转交 owner 与下一验收点均已具名；不以本方案归档替代设备验收。

## 9. P6：残留检查、故障处理与完成条件

### 9.1 残留检查

以下只读搜索用于发现候选，命中需按实际语义核对。命令从仓库根目录执行，搜索无结果时 `rg` 的退出码 1 表示无命中。

```powershell
rg -n --glob '!**/generated/**' --glob '!**/gen/schemas/**' 'Widget|widget|挂件|minimizeBehavior|minimize_behavior|minimizeToWidget' src src-tauri locales tests scripts package.json
rg -n 'cmd_.*widget|widget-window-commands|widget-runtime-|Patina Widget' src src-tauri tests scripts
rg -n 'widget|Widget|挂件|最小化' README.md README.zh-CN.md docs --glob '*.md' --glob '!docs/archive/**'
```

- [x] P6-01 每个 Patina 旧挂件生产命中都有处理结果；最终不保留旧窗口实现、配置消费者、事件桥接、命令别名或导出壳。
- [x] P6-02 单独核对生成权限、语言资源、构建 chunk、诊断与 package script；第一条搜索排除的生成目录仍需从各自产物检查。
- [x] P6-03 保留的旧名称仅用于必要数据清理 / 测试 / 历史事实或第三方语义；逐项说明，不建立允许整个 widget 目录继续存在的宽泛豁免。
- [x] P6-04 对生产代码、测试、工具和文档分别记录新增 / 删除范围，确认减少了实际机制；若只是搬迁并新增层级，重新收敛实现。
- [x] P6-05 复查最终差异没有覆盖已有 mini 工作，也没有顺带修改第三方进程归一化、追踪算法、备份格式或无关设置。

### 9.2 故障与回退原则

| 失败点 | 处理 |
| --- | --- |
| mini 内容缺失或权限失败 | 回到对应 DTO / gateway / permission owner 修复，阻断依赖该结果的验收；不重新注册旧命令别名 |
| 最小化后 main 无法找回 | 修复 main 可达性与生命周期，暂停交付；不改成自动打开 mini 或恢复旧挂件 |
| 数据清理失败 | 使用现有启动 / 候选准备错误路径，保留原库与备份；只在隔离夹具验证修复后重试 |
| 恢复中断 | 使用现有替换协议恢复原库，核对 marker、WAL 和连接池发布顺序；不手删真实用户文件绕过恢复 |
| 资源或设备行为回归 | 定位存续窗口的任务 / generation / 几何 owner，修复或明确移交；不得假报验收完成 |
| 需要撤回代码变更 | 只撤回本任务差异，保留工作区原有变更；代码撤回不等于数据库降级，不让旧程序直接打开已升级生产库 |

### 9.3 收尾

- [x] P6-06 全部适用实施项有实际结果；不适用项记录原因，转交项写清 owner 和验收边界，不把计划动作勾成已完成。
- [x] P6-07 更新真实长期 owner，删除或修复失效链接；当前规则不依赖本执行方案或旧 archive 才能理解。
- [x] P6-08 运行 `pnpm run check:docs`，检查本方案及修改文档的 UTF-8、相对链接、锚点与事实一致性。
- [x] P6-09 完成最终差异审查：旧机制已消失、数据安全边界仍有效、所需验证通过，剩余风险已明确处置。
- [x] P6-10 方案不再有活动工作后更新状态，移动到 `docs/archive/` 并修复引用。Git 与远端操作按本任务实际授权另行执行。

## 10. 执行记录

本节仅记录本次实施结果，不复制私有 Project 状态或用户数据。验证记录应注明实际命令、受影响输入、结果及必要的诊断位置；失败和未执行必须与通过区分。

| 阶段 | 结果 | 验证 / 偏差 |
| --- | --- | --- |
| 方案编写 | 已完成源码与 owner 核对，形成待执行方案 | `pnpm run check:docs` 通过（22 份文档）；UTF-8 严格解码及命令存在性核对通过。首次检查因受限环境无法启动 Git 子进程而失败，解除该执行限制后通过；未运行应用或退役验收测试 |
| P0 基线与范围 | 完成 | 基线提交 `106894b0d2e86aa136412962f8a480a07901f9e9`；保存包含原有 mini 工作的源码快照及摘要。无 Project 映射；所有升级与恢复使用合成库，runtime 使用隔离临时 profile |
| P1 mini owner 收口 | 完成 | 内容、bootstrap、图标和几何归入 mini；公共物理类型归 `domain/window_geometry.rs`。去掉 pinned 和失效字段，协议转换留在 gateway，复用既有归一化与工具事件 |
| P2 设置与生命周期退役 | 完成 | 最小化策略全链删除；main 只执行任务栏最小化，保留关闭后台与重建；恢复槽位仅 main / mini |
| P3 升级与恢复清理 | 完成 | migration 17 精确清理 5 个 key；历史归一化检查数据后置条件。候选准备复用相同迁移，覆盖／合并及失败不改写源备份 |
| P4 文件、权限与资产清理 | 完成 | 删除旧模块、capability、事件、样式、语言 namespace、测试入口；同步母文档及 Unreleased。生成资源和权限产物没有旧名称 |
| P5 自动化与设备验收 | 完整门槛、最终普通 runtime、资源专项及性能基准通过 | 原生测试修正与失败记录见下文；实机矩阵已按第 8.3 节转交，未宣称人工验收通过 |
| P6 残留检查与收尾 | 完成并归档 | 106 项均有执行、转交或不适用处置；当前契约回写长期 owner，未提交、推送或发布 |

### Bundle 边界决策（2026-10-25）

基线为本任务开始时包含 mini 未提交工作的源码快照；隔离目录使用相同 Vite 配置、工具链和未改动资源重新构建。当前构建与基线均按 `gzipSync` 默认压缩口径统计 KiB。该工作区基线不冒充已发布版本基线。

| 产物 | 工作区基线 | 当前 | 变化 |
| --- | ---: | ---: | ---: |
| MiniShell | 2.896 | 5.780 | +2.885（+99.6%） |
| 原共享内容 chunk | 2.521 | 已并入 MiniShell | — |
| MiniShell + 原共享内容 | 5.416 | 5.780 | +0.364（+6.7%） |
| index JS | 60.302 | 58.494 | -1.808（-3.0%） |
| 全部 JS | 358.594 | 352.737 | -5.856（-1.6%） |
| CSS | 31.127 | 29.122 | -2.005（-6.4%） |
| JS / CSS chunk 数 | 70 | 68 | -2 |

mini 成为内容模型唯一消费者后，共享内容块自然合并；bootstrap 和 IPC 的部分逻辑从 index 转入 mini 懒加载块。旧 MiniShell 预算 3 KiB、共享内容预算 2.6 KiB 不再表达这个边界。删除挂件块及其 6 KiB 预算，仅将新的 MiniShell owner 预算设为 6.2 KiB，相对实测保留 7.3% 缓冲，包含检查器要求的 3% 余量；其余预算不放宽。初始入口、总 JS 与 CSS 均缩小。

已移除失效偏好、旧窗口操作、旧状态和重复 bootstrap normalization。mini 继续按需加载；仅为恢复旧 chunk 名称再拆分单消费者模块会增加产物与维护入口，没有对应收益。当前证据支持加载边界调整，不将总包缩小推断为实际窗口唤出延迟改善；窗口耗时以真实 runtime 测量为准。原始同口径对比保存在忽略的 `artifacts/widget-retirement/bundle-comparison.json`。

### 范围与残留核对

以任务起点快照对比，生产前端代码净减少 2,038 行，Rust 源码（含内置测试）净减少 2,164 行；TypeScript 测试脚本净减少 1,724 行，工具脚本净减少 39 行。迁入 mini 的内容与几何实现已计入新增量，数字不是只统计删除文件。详细差异保存在忽略的 `artifacts/widget-retirement/task.diff`。生成语言 / 权限产物及 JSON 夹具不计入这些源码数字。

现存旧词逐类核对：迁移及其后置条件保存精确旧 key；升级、恢复与退役命令拒绝测试保存历史输入；`Chrome_WidgetWin_1` 是 Windows 第三方窗口类；`Douyin_widget`、通用 helper/widget/tray 后缀和 display-name 打分属于应用识别。`continuity.rs` 中名为 widget 的局部夹具实际为 SearchHost，覆盖不可记录系统窗口的连续性，未改变其逻辑。历史归档及已发布 changelog 保持历史语义。不存在挂件生产目录、旧命令别名、旧 namespace、旧 permission、旧 watcher 或转发壳。

`CHANGELOG.md` 的 Unreleased 已记录独立 mini、任务栏最小化、设置移除及旧偏好清理；已修正尚未发布段落里与终态冲突的窗口描述。`pnpm run release:validate-changelog` 通过；未改版本号或执行发布。

### 已完成的自动化证据

- `pnpm run check:full` 通过：201 项浏览器场景、全部快速测试、coverage、27/27 关键 mutation、构建 / bundle、Rust 边界 / 格式 / 编译 / clippy 及依赖审计。Rust 库测试 865 通过、8 项专项忽略；native probe 集成测试及 9 项 Windows 资源采样器 example 测试通过。存储迁移与恢复的库内测试包含在前述 865 项中。
- `pnpm run perf:desktop-lifecycle` 通过，实际入口为 `test:tauri-runtime-smoke --resource-cycles`。它完整执行 main / mini、真实权限拒绝、SQLite 恢复、存储迁移故障恢复和资源场景。之后发现退出夹具仍用最小化制造后台任务，已改为关闭到后台再唤回，并另行补跑普通 runtime；资源实现与工作负载未改变。
- main / mini 均拒绝退役命令；mini 拒绝 SQL、设置全量读取、恢复、凭据和更新安装等敏感命令。主窗口正常最小化不创建小窗；mini 已打开时，最小化与聚焦均保持 mini。
- 主窗口自然隐藏约 30 秒后释放，追踪继续落盘；mini 会话代次不变，能继续读取当前 presentation，并通过自身按钮重建 main。恢复旧备份后，29 秒唤回取消旧销毁任务，31 秒时任务栏最小化仍保留 WebView；再次关闭到后台约 30.1 秒后释放，mini 连续请求只重建一个 main，约 354 ms 后可以读取恢复后的事实。
- Windows 原生拖动 / 停靠、透明命中区域、悬停不激活、合成全屏与 power 消息、保持展开、20 次完整关闭重开、mini renderer 崩溃、main renderer 崩溃 / 无响应 / browser 退出及恢复预算耗尽均通过。

### 资源测量口径与结果

环境为隔离 debug Tauri 进程、生产形状的静态 Vite 资产、Windows 和 WebView2 `155.0.4283.62`。原生几何样本来自 2560 × 1440 显示器、2560 × 1380 工作区；浏览器另外覆盖 DPR 1 / 1.25 / 1.5 / 2。数据目录、存储注册项与 WebView profile 均使用测试命名空间，没有升级真实用户数据库。

mini 首次打开从标题栏点击计至实际内容就绪约 565 ms；100 次暖展开计至内容出现并提交两帧，p50 149 ms、p95 168 ms，满足 250 ms 预算。该值不等同于完整动画结束，动画参数仍为 180 ms。

收起静置约 602 秒，观测到的内容 / 健康 IPC 读取为 0，意外展开为 0，监听器不增加；检测 worker 为 1，关闭后为 0。mini 20 次关闭重开前后均为 649 个原生句柄、41 个线程，关闭后为 629 个句柄、40 个线程。仅 mini 存活时确认为一个 WebView，完整应用进程树为 17 个进程，仍能独立读取状态并重建 main。

主界面资源工作负载为每组 30 次页面 / 对话框 / 任务栏最小化及恢复循环，再静置 60 秒；完整应用进程树均为 17 个进程。下表的内存为整个进程树的私有内存，单位 MiB。

| GC 口径 / 采样点 | 句柄 | 线程 | 监听器 | interval | 进程树私有内存 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 强制 GC，第 5 轮 | 625 | 37 | 328 | 1 | 376.71 |
| 强制 GC，第 30 轮 | 631 | 39 | 328 | 1 | 432.55 |
| 强制 GC，静置后 | 627 | 36 | 328 | 1 | 303.91 |
| 自然 GC，第 5 轮 | 627 | 36 | 1332 | 1 | 436.74 |
| 自然 GC，第 30 轮 | 635 | 38 | 1354 | 1 | 488.77 |
| 自然 GC，静置后 | 633 | 36 | 729 | 1 | 339.45 |

两组均满足既有内存、句柄、线程、窗口、进程、GDI / USER 与 interval 预算；仅强制 GC 结果用于保留对象的 DOM / 监听器预算。mini 收起 10 分钟前后的全进程树私有内存从约 421.58 MiB 到 589.48 MiB，原生主进程只增加约 0.59 MiB；该区间 main 也存活，不能归因为 mini 独立开销或据此宣称长时内存不增长。上述循环结束后的保留量检查另有明确 GC 口径。短时自动化不证明无限运行无泄漏，也不以不同进程集合的内存差宣称 mini 节省量。

原始结果保存在忽略的 `artifacts/widget-retirement/desktop-lifecycle-2.log`、`runtime-summary.json`，以及 `artifacts/quality-9plus/desktop-lifecycle-forced-1792919786353.json`、`desktop-lifecycle-natural-1792919942140.json`。

### 验证中失败的处置

| 失败或缺口 | 处理与证据边界 |
| --- | --- |
| 默认 Cargo target 中的开发程序正在运行，测试链接无法替换可执行文件 | 使用隔离的 `src-tauri/target/runtime-smoke` 构建与测试，未终止正在运行的开发版或安装版 |
| 首轮完整门槛暴露迁移版本期望、前端协议命名与浏览器夹具不一致 | 修正版本 17 期望；在 gateway 归一化原始设置；修正 mini 节点选择器及 tools 事件负载。最终 `check:full` 全部通过，未放宽这些门槛 |
| 旧 MiniShell / shared chunk 预算与新的单消费者边界不匹配 | 使用任务起点源码重建同口径基线，按上表更新唯一 owner 的预算；总 JS、初始入口及 CSS 均减少 |
| mini renderer 故障注入有未观察到通知的运行 | 启用 CDP Page 域并补充现场诊断后，资源专项及一次普通 runtime 的此项通过；随后诊断发现调试连接保持期间没有原生通知，断开后才出现 `RendererExited`。夹具改为确保命令发送后断开 CDP，再等待原生故障和恢复；生产恢复策略与预算不变，以最终完整补跑确认 |
| 退出测试仍用最小化制造后台销毁前置条件 | 改为真实关闭到后台、等待隐藏再唤回，最后切换退出策略；普通 runtime 补跑验证这条最终测试路径 |
| 普通 runtime 补跑在首次存储重启后读不到刚写入的浏览器标记 | 原夹具在 `setItem` 返回后立即重启，没有证明标记进入持久 profile。补充初始空值控制和隔离 profile 文件中的落盘前置检查，保留每次重启后的读回断言；最终补跑单独记录，不用较早通过的资源运行覆盖这次失败 |
| 随后一次补跑在原生左侧拖动后的悬停展开超时 | 原断言没有记录 HWND 与鼠标坐标，无法确认根因。补充 HWND 已到达目标边缘的前置断言和失败现场诊断；保留 3 秒展开预算、焦点与再次收起检查，不改生产行为 |
| 修正崩溃注入后的补跑在第 31 轮暖展开失败 | 崩溃恢复通过；失败现场的实际鼠标为 `(2210,409)`，测试要求的顶部悬停位置为 `(1280,1)`，前台也离开输入夹具。记录为原生输入前提被外部改变，协调不干扰输入的执行时段；不将此轮计为通过 |
| 较早的性能套件在浏览器导航采样第 2 轮失败 | 隔离原生输入测试后串行运行 `perf:stable`，7 组各 5 轮全部通过（2026-10-25 09:44 UTC）；不把并发负载当作已确认根因，未放宽性能预算。完整结果位于忽略的 `artifacts/widget-retirement/perf-final.log` |
| 物理设备和产品体验未人工验收 | 按第 8.3 节交给 Ceceliaee，在下一次安装版验收时补齐；本地归档不代表发布签收 |

校验期间的权限限制只影响验证进程启动；相同本地命令在获准执行后完成。数据故障注入中的预期错误与校验失败分开记录。关闭日志中的 WebView2 `Chrome_WidgetWin_0` 注销诊断不代表 Patina 挂件仍存在；资源专项完成全部断言并以退出码 0 结束。

### 最终验收与归档

2026-10-25 09:52 UTC，最终 `test:tauri-runtime-smoke` 完整通过并以退出码 0 结束。原始记录为忽略的 `artifacts/widget-retirement/runtime-final-5.log`；此前未完成的运行保留为 `runtime-final.log` 与 `runtime-final-2.log` 至 `runtime-final-4.log`，不计为通过。

本轮覆盖全部 mini 原生场景、100 次暖展开（p50 148 ms、p95 169 ms）、主窗口释放与重建、三类 WebView 故障与恢复预算耗尽、真实权限拒绝、备份恢复、持久 profile 迁移及 6 个存储中断阶段。最终退出夹具确实先关闭到后台再唤回，随后执行退出；测试确认没有残留 runtime 进程、没有意外窗口重建，且最后追踪检查点保留。

| 验证入口 | 最终结果与范围 |
| --- | --- |
| `pnpm run check:full` | 通过；覆盖退役实现。其后调整原生测试夹具与文档；归档后的审查另修正一处等价 SQL 查询中的多余占位符，追加 Rust 验证见下节 |
| `pnpm run check:types` 与受影响测试文件的 ESLint | 最后一次夹具修改后通过 |
| `pnpm run test:tauri-runtime-smoke` | 当前最终夹具完整通过，退出码 0 |
| `pnpm run perf:desktop-lifecycle` | 完整资源专项通过；后续夹具修正未改变资源工作负载或生产代码 |
| `pnpm run perf:stable` | 7 组、35 次运行通过；浏览器导航使用 headless 浏览器，查询与渲染口径依各自 benchmark 定义 |
| `pnpm run check:hotspots`、`pnpm run check:docs`、`git diff --check` | 收尾检查通过；文本按 UTF-8 保存 |
| `pnpm run release:validate-changelog` | 通过；仅核对 Unreleased 文本，未执行发布 |

长期行为归属 [architecture](../architecture.md)、[engineering quality](../engineering-quality.md)、[Quiet Pro](../quiet-pro-component-guidelines.md) 和 [localization](../localization.md)。当前计划没有未处置的实施项；人工设备及产品签收按第 8.3 节继续由 Ceceliaee 在下一次安装版验收中完成。归档不扩大为生产数据升级、安装包验收或正式发布承诺。

## 11. 归档后的对抗式审查

审查基于任务起点的工作区快照与最终实现之间的差异，包含未跟踪文件，并结合现有 main / mini 调用方、故障路径及测试入口检查。`HEAD` 只标识仓库基线，不将本任务开始前的 mini 工作误计为退役新增实现。本节为本地自审记录。

| 反例 / 风险 | 核对结果与证据 |
| --- | --- |
| migration history 被归一化后跳过数据清理，或清理失败却留下 version 17 | 历史修复同时检查旧 key 缺失的后置条件；正常 / 异常历史、无效偏好和触发器中止夹具验证未提前标记、事务回退与重试 |
| 旧备份把设置重新带回，或清理误伤 mini / 业务事实 | 覆盖与合并均先升级提取候选；精确 5 个 key 清理，原 ZIP hash、mini JSON、会话 / 标题 / 图标与合并目标设置优先级均有断言 |
| mini 通过直接 IPC 绕过 UI，或旧命令仍注册 | 核对 build / handler / capability / 权限生成链；真实 runtime 拒绝 SQL、敏感读取、写入、恢复及旧命令，并以允许的 mini 内容命令作正向对照 |
| 请求乱序、暂停切换或恢复旧数据库后读到失效事实 | presentation 读取持有 tracking transition 锁；前端沿用单一请求序号、先订阅后读和卸载失效；data owner 每次取得当前连接池。共享刷新器的乱序 / 卸载测试、mini 浏览器失败与旧 epoch 测试及真实恢复后读取证据保留 |
| main 聚焦或最小化关闭 mini，旧延迟任务销毁重建后的 main | 已去掉挂件交接；现存 generation / hide token 与退出状态守卫保留。29/31 秒边界、mini 独立存活、单次重建及退出无残留均经真实 runtime 验证 |
| 全部几何搬进 mini 后造成平台反向依赖，或旧偏好 JSON 形状改变 | 公共物理类型位于 `domain/window_geometry`；Windows 全屏检测不依赖 mini 模块。mini 专属显示器规则归 mini；完整负坐标偏好经过实际反序列化与 bounds 对照 |
| 删除测试掩盖存续行为，或放宽预算得到通过 | 删除的是旧窗口专属行为；内容、主题、权限、资源和恢复保护已转入 main / mini 实际路径。数据、原生和性能失败保留记录；仅 bundle owner 变化按同口径实测调整预算 |

发现并修正 **1 项 P3 清理遗漏**：[`load_desktop_behavior_settings`](../../src-tauri/src/data/repositories/app_settings.rs) 删除最小化字段后仍有 5 个 `IN` 占位符，只绑定 4 个 key。SQLite 将多余未绑定参数视作 NULL，未扩大返回行集合，但留下了无意义的第五个槽位；已收敛为 4 个占位符和 4 次绑定。既有 repository 测试实际读取这些设置，无需添加重复 SQL 文本断言。

本次修正不改变行集合、IPC 形状或窗口时序，原生与资源证据继续适用。追加 `pnpm run check:rust` 的边界检查及自测、格式、编译和 865 项库测试通过；8 项专项仍按既有配置忽略。该命令随后在未修改的 `native_probe_lifecycle` 音频资源采样处失败：线程数从 5 增至 8，超过允许增加 2 的预算，详见忽略的 `artifacts/widget-retirement/review-rust.log`。

未修改探针代码或预算，单独复核 `cargo test --manifest-path src-tauri/Cargo.toml --locked --quiet --test native_probe_lifecycle` 后通过（75.79 秒），记录为 `artifacts/widget-retirement/review-native-probe.log`。再执行文档测试、9 项 `windows-resource-sample` example 测试及 `check:rust:clippy`，全部通过，Rust 命令图的剩余分项已补齐。首跑失败仍作为一次真实资源采样超预算记录，不推断未经证实的原因，也不把复核通过解释为从无波动。

审查发现的 1 项代码清理遗漏已修复并复核，没有未处置的审查项；归档后的文档检查、相对文件链接、UTF-8 与 106 项清单检查通过。实机设备覆盖及长期内存趋势仍受第 8.3 节和资源测量说明限制，不能从自动化通过推导为无限运行或完整设备矩阵的保证。
