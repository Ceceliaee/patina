# 开机启动后台资源策略执行方案

创建日期：2026-07-13

状态：已完成并归档

文档类型：一次性 How-to 执行方案

执行归属：Tauri 启动编排、主窗口生命周期、托盘与 Widget 协作
完成去向：全部验收通过后勾选完整，并移动到 `docs/archive/`

## 1. 最终目标

- [x] 开机自启动且“启动时最小化”生效时，由“后台资源优化”统一决定是否保留主窗口 WebView。
- [x] 后台资源优化关闭时，保留当前速度优先行为：创建并隐藏主 WebView，用户点击托盘后快速显示。
- [x] 后台资源优化开启时，采用与现有低耗后台一致的行为：先创建并隐藏主 WebView 完成轻量预热，隐藏满 3 分钟后销毁。
- [x] 后台资源优化开启且 3 分钟销毁已完成后，原生不变量为 `get_webview_window("main").is_none()`。
- [x] 后台追踪、AFK、锁屏、休眠、媒体参与、网页活动、提醒、更新检查和托盘操作不依赖主窗口存在。
- [x] 用户点击托盘、选择托盘“打开主界面”或触发单实例唤起时，统一按需创建并显示唯一主窗口。
- [x] 点击后尽快出现 Quiet Pro 轻量界面骨架，目标为 100～200 ms 内出现窗口或可见反馈，主要内容约 0.5～1 秒内可用；性能目标必须以实测记录为准，不作为未经测量的硬编码承诺。
- [x] 主窗口按需创建路径与“后台资源优化”销毁主窗口后的恢复路径完全复用，不维护两套窗口创建逻辑。
- [x] 开机设置异步加载不得覆盖用户已经执行的打开、关闭或退出意图。
- [x] Windows 原生 `Patina Local` release 对照已验证：前三分钟保留隐藏 WebView，阈值后 WebView2 归零；任务管理器分组仅作为观察信息。
- [x] 完成 Rust、前端、真实浏览器 smoke 与隔离 Windows release 回归；未生成或安装 MSI/NSIS。

## 2. 第一性原理

### 2.1 产品运行的必要核心不是主界面

- [x] Patina 的核心价值是持续、可信地记录桌面活动，而不是持续显示主界面。
- [x] SQLite、追踪循环、AFK/锁屏/休眠监听、音频与媒体信号、网页活动桥接、提醒和更新检查均属于后台核心。
- [x] 主窗口是查看和控制后台核心的界面，不应成为后台核心能够运行的前置条件。
- [x] 因此“开机后台启动”首先应保证后台核心成立，其次才决定是否需要创建 UI。

### 2.2 不可见不等于不存在

- [x] `visible(false)` 或 `window.hide()` 只改变窗口可见性，不会删除 WebView2、顶层窗口对象及其资源。
- [x] Windows 任务管理器的“应用/后台进程”是系统展示结果，不是可靠的产品状态模型。
- [x] 资源优先模式分为两个真实状态：前三分钟主 WebView 存在但隐藏；销毁完成后主 WebView 不存在。

### 2.3 快速打开与最低后台占用存在真实取舍

- [x] 保留隐藏 WebView 可以缩短再次显示的时间，但会持续占用 UI 资源。
- [x] 销毁 WebView 可以获得真正的托盘后台状态，但销毁后的首次点击需要重新创建窗口和加载前端壳。
- [x] 本任务不替用户强制选择单一取舍，而是让现有“后台资源优化”成为统一策略开关。
- [x] 后台资源优化关闭代表速度优先，允许长期保留隐藏主 WebView；开启代表资源优先，先提供 3 分钟快速返回窗口，随后销毁主 WebView。
- [x] 资源优先模式销毁后的首次点击性能通过既有按需重建路径优化，不延长销毁阈值或偷偷永久保留隐藏主窗口。

### 2.4 用户意图高于迟到的启动策略

- [x] “启动时最小化”只决定自动启动完成时的初始状态。
- [x] 用户点击托盘后产生了更新、更强的显示意图，异步加载完成的旧启动策略不得再次隐藏窗口。
- [x] 更新后重开、单实例唤起和显式退出同样属于高优先级意图，必须覆盖普通开机最小化决策。

## 3. 当前实现与问题根因

- [x] `src-tauri/src/lib.rs` 通过 `--autostart` 判断本次是否由开机自启动触发。
- [x] `src-tauri/src/app/bootstrap.rs` 在 Tauri setup 中先执行存储迁移和 SQLite 初始化，再进入 runtime setup。
- [x] `src-tauri/src/app/runtime.rs` 当前无条件调用 `ensure_main_window_with_initial_visibility`；开机启动只是传入 `false`。
- [x] `src-tauri/src/app/main_window.rs` 即使 `visible` 为 `false`，仍会构造完整 `WebviewWindow` 并加载前端入口。
- [x] `src-tauri/src/app/runtime.rs` 随后再次调用 `window.hide()`，但没有进入 `MainWindowLifecycleState::hide()`。
- [x] `src-tauri/src/app/desktop_behavior.rs` 异步读取持久化设置，并根据开机最小化、Widget 和更新后重开意图再次操作窗口。
- [x] `src-tauri/src/app/tray.rs` 的手动关闭到托盘会调用 `hide_main_window_for_background`，与开机隐藏路径不一致。
- [x] 实施前默认关闭后台资源优化，因此当时开机创建的隐藏主 WebView通常会长期保留；完成后的首装默认已改为开启。
- [x] 前端能够识别 `hidden-autostart`，但只跳过 Dashboard、History、Data、Settings、Tools 和懒加载页面等重预热；基础 WebView 和 React 壳仍已创建并常驻。
- [x] 当前测试覆盖隐藏启动的前端预热策略和设置语义，但没有分别覆盖“速度优先时窗口存在但隐藏”和“资源优先时窗口根本不存在”两组原生生命周期不变量。

## 4. 对抗式审查结论

- [x] 当前实现没有让“后台资源优化”控制开机最小化路径；即使资源优化开启，开机隐藏的主 WebView 也不会进入 3 分钟延迟销毁生命周期。
- [x] 直接删除 runtime 中的主窗口创建会破坏“启动时不最小化”、Widget 启动和更新后重开，因此不能只改一行。
- [x] 当前异步设置同步可能在用户快速点击托盘后再次隐藏已打开窗口，存在用户意图被迟到启动策略覆盖的竞态。
- [x] 如果主窗口创建失败，托盘打开、单实例唤起和错误反馈必须保持可恢复，不能造成只能结束进程的死状态。
- [x] 如果 Widget 启动依赖主窗口提供显示器信息，移除主窗口后必须使用 Widget 已有的主显示器回退路径。
- [x] Tauri 全局事件可能在没有前端监听者时发出；前端首次创建后必须通过当前快照读取恢复状态，不能只依赖启动期间的事件。
- [x] 任务管理器分类只能作为人工观察项；自动化应验证窗口存在性、唯一性和行为状态机。

## 5. 范围

### 5.1 本任务包含

- [x] 重构开机启动的 UI 决策顺序。
- [x] 后台资源优化关闭时，托盘式开机启动创建并保留隐藏主窗口。
- [x] 后台资源优化开启时，托盘式开机启动创建隐藏主窗口，并在持续隐藏满 3 分钟后销毁。
- [x] 主窗口按需创建、显示、聚焦和单实例复用。
- [x] Widget 开机启动在没有主窗口时仍能显示。
- [x] 用户打开意图与异步设置加载竞态保护。
- [x] 更新后重开主界面的优先级保护。
- [x] 后台核心与 UI 存在性的依赖审计。
- [x] 原生状态测试、前端回归测试和隔离 `Patina Local` release 人工验收。
- [x] 通过销毁后 single-instance 唤起验证可恢复性；本轮未把非精确脚本耗时冒充 UI 性能指标，也未发现需要扩大范围的性能瓶颈。

### 5.2 非目标

- [x] 不改变时间追踪、SQLite 或提醒运行时的业务规则。
- [x] 不改变“开机自启动”“启动时最小化”“最小化到 Widget”“关闭到托盘”的用户可见设置含义。
- [x] 保留“后台资源优化”用户设置；首装或缺失键时默认开启，已有用户保存的开启/关闭值均不覆盖。
- [x] 不用 `WS_EX_TOOLWINDOW`、伪装 owner window 等 Windows 样式技巧绕过任务管理器分类。
- [x] 不新增独立原生启动窗、第二套主窗口或无窗口 WebView2 预热系统。
- [x] 不在开机时执行完整重页面预热；只保留现有 `hidden-autostart` 轻量前端壳，并在后台资源优化开启时按 3 分钟阈值销毁。
- [x] 不把前端页面预热扩大为本任务的主要范围。
- [x] 不调整追踪采样间隔、数据库 schema、备份格式或发布版本号。
- [x] 不为未发布的中间实现保留无意义兼容分支。

## 6. 启动行为矩阵

| 启动来源 | 持久化设置/意图 | 期望主窗口 | 期望 Widget | 期望托盘 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 普通手动启动 | 任意 | 创建并显示 | 不显示 | 按关闭策略决定 | 保持当前普通启动体验 |
| 开机自启动 | `start_minimized = false` | 创建并显示 | 不显示 | 按关闭策略决定 | 设置读取后显示主界面 |
| 开机自启动 | `start_minimized = true`、Taskbar、后台资源优化关闭 | 创建并隐藏 | 不创建 | 显示 | 速度优先，保留基础 WebView 预热 |
| 开机自启动 | `start_minimized = true`、Taskbar、后台资源优化开启 | 创建并隐藏，3 分钟后销毁 | 不创建 | 显示 | 资源优先，复用低耗后台逻辑 |
| 开机自启动 | `start_minimized = true`、Widget、后台资源优化关闭 | 创建并隐藏 | 创建并显示 | 按关闭策略决定 | 保留主 WebView，Widget 可快速切回主界面 |
| 开机自启动 | `start_minimized = true`、Widget、后台资源优化开启 | 创建并隐藏，3 分钟后销毁 | 创建并显示 | 按关闭策略决定 | 主 WebView 按低耗策略回收，Widget 保持显示 |
| 任意启动 | 更新后重开意图存在 | 创建并显示 | 不显示 | 按关闭策略决定 | 更新重开优先于最小化 |
| 托盘后台中 | 用户点击托盘或“打开主界面” | 按需创建并显示 | 关闭/停靠 | 保留 | 用户意图优先 |
| 托盘后台中 | 第二实例启动 | 按需创建并显示 | 关闭/停靠 | 保留 | 复用唯一实例 |
| 主窗口显示中 | 重复点击托盘/二次启动 | 复用、恢复并聚焦 | 不显示 | 保留 | 不重复创建 |
| 主窗口关闭到托盘 | 后台资源优化关闭 | 隐藏并保留 | 按当前策略 | 保留 | 不改变普通模式 |
| 主窗口关闭到托盘 | 后台资源优化开启且超过阈值 | 销毁 | 按当前策略 | 保留 | 再打开走同一懒创建路径 |
| 任意状态 | 用户显式退出 | 销毁并退出 | 销毁并退出 | 移除 | 不拦截退出 |

## 7. 目标状态机

### 7.1 主窗口状态

- [x] 使用现有 `MainWindowLifecycleState` 或在其 owner 内扩展必要状态，表达至少以下语义：`Absent`、`Creating`、`Hidden`、`Visible`。
- [x] 如果不需要显式枚举，也必须用等价不变量阻止并发重复创建。
- [x] `show_main_window` 在窗口不存在时创建，在窗口存在时复用，在创建进行中时合并重复请求。
- [x] `show_main_window` 成功后统一执行 `show`、`unminimize`、Windows 前台恢复、`set_focus` 和关闭 Widget。
- [x] `hide_main_window_for_background` 只处理已经存在的窗口，不隐式创建窗口。
- [x] 延迟销毁任务必须继续使用 generation/意图检查，不能销毁刚被用户重新打开的窗口。

### 7.2 启动决策状态

- [x] 将“是否由 autostart 启动”“持久化启动设置”和“后台资源优化”组合成一个可测试的启动决策。
- [x] 决策至少区分：显示主窗口、隐藏并长期保留主窗口、隐藏并安排 3 分钟销毁、显示 Widget、更新后显示主窗口。
- [x] 启动决策函数只返回意图，不直接执行 Tauri 副作用。
- [x] 执行层根据决策调用主窗口、Widget 或无 UI 路径。
- [x] 用户打开主窗口后，启动决策不得再执行隐藏副作用。
- [x] 用户显式退出后，任何迟到异步任务不得重新创建窗口。

## 8. 阶段一：建立纯启动决策模型

- [x] 在修改窗口副作用前，先确定启动决策的真实 owner；优先留在 `src-tauri/src/domain/settings.rs` 或一个薄且可测试的 app 编排决策中。
- [x] 定义输入：是否 autostart、`DesktopBehaviorSettings`（包含 `background_optimization`）、是否存在更新后重开意图。
- [x] 定义输出：`ShowMainWindow`、`KeepHiddenMainWindow`、`OptimizeHiddenMainWindow`、`ShowWidget { optimize_main_window }` 或语义等价的类型。
- [x] 明确普通手动启动不等待持久化设置即可显示主窗口，避免普通启动首屏回退。
- [x] 明确更新后重开优先级高于 autostart 最小化。
- [x] 明确 `launch_at_login = false` 但进程意外携带 `--autostart` 时的安全行为；以本次真实启动来源和持久化设置共同决定，不制造永久隐藏死状态。
- [x] 为行为矩阵中的每个启动组合增加纯 Rust 单元测试。
- [x] 测试名称描述用户行为，不只描述布尔组合。

## 9. 阶段二：统一开机隐藏与低耗销毁生命周期

- [x] 修改 `src-tauri/src/app/runtime.rs`，普通手动启动仍创建并显示主窗口。
- [x] autostart 继续通过现有窗口 owner 创建不可见主 WebView，保留 `hidden-autostart` 轻量壳预热。
- [x] 开机隐藏后必须进入与手动关闭到托盘相同的 `MainWindowLifecycleState::hide()` 生命周期，不再只调用孤立的 `window.hide()`。
- [x] 持久化设置加载完成且后台资源优化关闭时，不安排销毁，隐藏主 WebView长期保留。
- [x] 持久化设置加载完成且后台资源优化开启时，复用现有 `MAIN_WINDOW_DESTROY_AFTER_BACKGROUND_SECS = 3 * 60` 计划销毁逻辑。
- [x] 不新增第二个开机专用定时器、第二套 generation 或不同阈值。
- [x] 3 分钟到期时重新检查主窗口仍然隐藏、用户没有请求显示、后台资源优化仍然开启，再执行 `window.destroy()`。
- [x] runtime setup 仍按顺序初始化数据库之后所需的电源、音频、媒体、网页活动、远端状态、追踪、Watchdog、Tools 和 Updater。
- [x] 主 WebView 销毁后，setup tray 和后台运行时不依赖主窗口继续存在；确认菜单和事件处理在零窗口状态下正常。
- [x] `ExitRequested` 在主 WebView 已销毁但托盘存活时仍保持应用运行。
- [x] 如果 desktop behavior 设置读取失败，记录错误并保留已创建的隐藏主 WebView；正常缺失键读取则按首装默认开启低耗后台。
- [x] 普通手动启动若主窗口创建失败，保留明确错误日志并验证托盘是否仍可尝试恢复。

## 10. 阶段三：重构设置加载后的窗口决策

- [x] 修改 `src-tauri/src/app/desktop_behavior.rs`，不再把整个 autostart 分支包在 `if let Some(main_window)` 内。
- [x] 持久化设置加载完成后先生成启动决策，再执行对应动作。
- [x] `ShowMainWindow` 调用统一的 `show_main_window`，允许窗口不存在时创建。
- [x] `KeepHiddenMainWindow` 创建或复用主窗口并保持隐藏，同时把生命周期登记为隐藏但不安排销毁。
- [x] `OptimizeHiddenMainWindow` 创建或复用主窗口、登记隐藏生命周期并安排 3 分钟销毁。
- [x] `ShowWidget { optimize_main_window: false }` 保留隐藏主 WebView并显示 Widget。
- [x] `ShowWidget { optimize_main_window: true }` 显示 Widget，同时对隐藏主 WebView 安排同一 3 分钟销毁；销毁主窗口不得影响 Widget。
- [x] 更新后重开意图使用统一 `show_main_window`，并关闭可能存在的 Widget。
- [x] 设置读取完成后更新 `DesktopBehaviorState` 和托盘可见性，保持当前设置同步职责。
- [x] 设置读取失败时不回退到依赖前端的决策。

## 11. 阶段四：统一所有主窗口打开入口

- [x] 托盘左键单击继续调用统一 `show_main_window`。
- [x] 托盘双击不会与单击并发创建两个窗口。
- [x] 托盘菜单“打开主界面”调用同一入口。
- [x] single-instance 回调调用同一入口。
- [x] Widget 的“打开主界面”命令调用同一入口。
- [x] 后台资源优化销毁后的恢复调用同一入口。
- [x] Win+D 后恢复、最小化恢复和正常隐藏恢复继续走现有 Windows 前台激活逻辑。
- [x] 主窗口创建中的重复打开请求被合并；创建完成后最终意图为显示并聚焦。
- [x] 创建失败不会把生命周期状态永久卡在 `Creating`，下一次点击可以重试。
- [x] 每次只允许一个标签为 `main` 的 WebViewWindow。

## 12. 阶段五：消除异步设置竞态

- [x] 为“用户已请求显示主窗口”建立可查询的生命周期意图。
- [x] autostart 设置同步执行 `KeepHiddenMainWindow`、`OptimizeHiddenMainWindow` 或 `ShowWidget` 前，检查用户是否已主动请求显示主窗口。
- [x] 用户已经请求显示时，迟到的启动最小化决策只更新设置状态，不再隐藏或替换当前窗口。
- [x] 用户在设置读取期间点击托盘，主窗口最终保持显示并获得焦点。
- [x] 用户在设置读取期间触发 single-instance，主窗口最终保持显示。
- [x] 更新后重开与用户主动打开同时发生时，只创建一个窗口。
- [x] 用户显式退出与创建请求并发时，以退出为准，不重新创建窗口。
- [x] Widget 创建与用户打开主窗口并发时，以最新用户主窗口意图为准，并安全关闭/停靠 Widget。
- [x] 增加确定性测试，不依赖真实 sleep 制造竞态。

## 13. 阶段六：后台核心独立性审计

- [x] 审计 `runtime_tasks`，确认 updater、tracking、watchdog 和 tools runtime 只依赖 `AppHandle` 与托管状态。
- [x] 审计电源、音频、媒体、网页活动和远端状态桥接，确认不通过主窗口启动。
- [x] 审计启动期 `app.emit` 调用：没有窗口监听时允许丢弃通知事件，但状态必须保存在 Rust state、SQLite 或可重新查询快照中。
- [x] 审计前端首次挂载流程，确认 Dashboard、History、Data、Tools、更新状态和追踪状态均能主动读取当前快照。
- [x] 发现仅依赖启动事件的状态时，在真实 owner 内补充可查询快照，不在 AppShell 堆积兼容逻辑。
- [x] 确认零主窗口状态下持续追踪不会把 Patina 自己误识别为前台应用。
- [x] 确认托盘暂停追踪和标题记录开关在零主窗口状态下仍能写入并更新菜单。
- [x] 确认通知、提醒和 updater 不会因为没有主 WebView 而 panic 或阻塞。

## 14. 阶段七：首次点击体验与恢复验证

- [x] 保留既有 hidden-autostart 轻量预热，不额外预加载 lazy view chunk。
- [x] 三分钟内保持隐藏 WebView，可直接复用。
- [x] 三分钟销毁后由 single-instance 调用统一 `show_main_window`，实测唯一主进程重新创建 6 个 WebView2 进程。
- [x] 重建继续复用已初始化的 SQLite 与 Rust 后台状态，不重新启动后台核心。
- [x] 对抗式审查补充 `destroy_in_progress` 意图合并：销毁临界区中的打开请求在销毁结束后统一重建。
- [x] 未引入第二窗口、第二套创建入口或额外骨架。
- [x] 本轮脚本包含固定等待和系统查询开销，不能作为精确 UI 延迟测量；因此不记录虚假的 100～200 ms 数字。
- [x] 未观察到需要为本任务扩大性能优化范围的瓶颈。

## 15. 阶段八：自动化测试

### 15.1 Rust 决策与状态测试

- [x] 覆盖普通启动决策为显示主窗口。
- [x] 覆盖 autostart + start minimized + Taskbar + 后台资源优化关闭为 keep-hidden-main-window。
- [x] 覆盖 autostart + start minimized + Taskbar + 后台资源优化开启为 optimize-hidden-main-window。
- [x] 覆盖 autostart + start minimized + Widget + 后台资源优化关闭为 show-widget-with-warm-main。
- [x] 覆盖 autostart + start minimized + Widget + 后台资源优化开启为 show-widget-and-optimize-hidden-main。
- [x] 覆盖 autostart + 不最小化为显示主窗口。
- [x] 覆盖更新后重开覆盖 keep-hidden、optimize-hidden 和 Widget 决策。
- [x] 覆盖用户显示意图使迟到最小化决策失效。
- [x] 覆盖退出意图阻止迟到创建。
- [x] 覆盖主窗口创建失败后可以重试。
- [x] 覆盖并发/重复 show 请求最终只有一个创建结果。

### 15.2 Tauri 生命周期验证

- [x] 断言后台资源优化开启时，autostart 初始主窗口存在但不可见。
- [x] 断言不足 3 分钟时主窗口仍存在，达到 3 分钟且条件未变化时主窗口被销毁。
- [x] 断言速度优先 keep-hidden 超过 3 分钟后主窗口仍存在但不可见。
- [x] 断言 3 分钟内打开会取消旧销毁资格，旧任务不得销毁已显示窗口。
- [x] 断言用户重新关闭到托盘后生成新的隐藏 generation，并从这次隐藏重新计算完整 3 分钟。
- [x] 断言等待期间关闭后台资源优化会使旧销毁任务安全失效。
- [x] 断言托盘打开后主窗口存在、可见并获得显示意图。
- [x] 断言 Widget 启动不需要主窗口提供 monitor。
- [x] 断言后台资源优化销毁后仍可通过同一入口重建。
- [x] 如 Tauri mock 无法可靠覆盖原生窗口，保留纯决策测试并把原生存在性列入正式版人工 gate，不编造脆弱测试。

### 15.3 前端回归测试

- [x] 保留并更新 `hidden-autostart` 预热测试，使其不再暗示隐藏主 WebView一定存在。
- [x] 普通 visible-start 预热策略保持不变。
- [x] 主窗口首次创建后能够获取当前追踪和设置快照。
- [x] 前端不依赖 autostart 期间已发出的事件完成初始化。
- [x] Dashboard、History、Data、Settings、Tools 和 Widget 相关 smoke 测试通过。

### 15.4 质量命令

- [x] 运行命中的 Rust 专项测试。
- [x] 运行 `npm test`。
- [x] 运行 `npm run test:replay`。
- [x] 运行 `npm run test:warmup`。
- [x] 运行 `npm run test:background-return`。
- [x] 运行 `npm run test:widget`。
- [x] 运行 `npm run test:update`。
- [x] 运行 `npm run test:ui-smoke`。
- [x] 运行 `npm run test:ui-browser-smoke`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run check:full`，覆盖 Rust boundary、cargo check、Rust tests 和 clippy。

## 16. 阶段九：Windows 原生 release 验收

### 16.1 验收环境与隔离

- [x] 使用 `tauri build --config src-tauri/tauri.local.conf.json --no-bundle` 构建 `PatinaLocal.exe`。
- [x] 未生成、安装或覆盖 MSI/NSIS；正式版 `Patina` 数据目录和可执行文件未被触碰。
- [x] 测试数据使用独立的 `%APPDATA%\\Patina Local`，WebView 使用独立的 `%LOCALAPPDATA%\\Patina Local`。
- [x] 测试后关闭进程、注销临时 Patina Local 自启动项，并验证系统 Run 项只剩正式版 Patina。
- [x] 测试后删除两个 Patina Local 隔离目录并验证均不存在。

### 16.2 资源优先三分钟销毁

- [x] 设置 `launch_at_login=1`、`start_minimized=1`、`minimize_behavior=taskbar`、`background_optimization=1`。
- [x] 以明确的 `--autostart` 参数启动 release 可执行文件。
- [x] 启动后三分钟前主进程存活，隐藏主 WebView 对应 6 个 WebView2 进程。
- [x] 15:17:06（尚未到阈值）WebView2 仍为 6。
- [x] 15:17:21（超过阈值）WebView2 归零，PatinaLocal 主进程继续存活。
- [x] 验证结果证明销毁的是主 WebView，不是后台追踪宿主进程。

### 16.3 销毁后恢复

- [x] WebView2 归零后启动第二实例触发 single-instance。
- [x] 第二实例正常退出，原主进程保持唯一。
- [x] 原主进程主窗口句柄恢复，WebView2 从 0 恢复为 6。
- [x] 恢复复用统一 `show_main_window` 路径，没有第二套 autostart 专用创建逻辑。

### 16.4 速度优先对照

- [x] 将 `background_optimization` 改为 `0`，其余 autostart/Taskbar 设置保持一致。
- [x] 15:18:37 至 15:21:38 跨越三分钟阈值，主进程持续存活。
- [x] 全程 WebView2 数量保持 6，证明速度优先不会被错误回收。
- [x] 资源优先与速度优先的原生不变量已在同一 release 构建上形成对照。

### 16.5 未伪造的边界

- [x] 本轮没有执行真实注销/重新登录；用明确携带 `--autostart` 的隔离 release 进程验证相同代码路径。
- [x] 本轮没有把任务管理器“应用/后台进程”分类当作稳定 API；使用进程存活与 WebView2 进程数验证。
- [x] Widget、更新后重开、普通启动和快速竞态由纯决策测试、生命周期测试、全量 Rust 测试和浏览器 smoke 覆盖。

## 17. 对抗式回归清单

- [x] 没有把“窗口不可见”误当成“窗口不存在”。
- [x] 没有只修任务管理器展示；后台资源优化开启并达到 3 分钟阈值后确实不存在主 WebView。
- [x] 没有擅自改变后台资源优化关闭时的速度优先行为。
- [x] 没有为了资源优先延迟销毁破坏 Widget 开机启动。
- [x] 没有让普通手动启动等待异步设置读取。
- [x] 没有让迟到设置覆盖用户最新操作。
- [x] 没有产生两个主窗口或两个 Widget。
- [x] 没有让创建失败永久锁死生命周期状态。
- [x] 没有让无前端监听期间的事件成为状态恢复唯一来源。
- [x] 没有让追踪、提醒、更新或托盘依赖主窗口存在。
- [x] 没有在 `lib.rs`、commands 或 frontend AppShell 中堆积新的厚业务逻辑。
- [x] 没有新增无 owner 的 shared/platform 抽象或兼容壳。
- [x] 没有用 sleep 型不稳定测试代替确定性状态验证。
- [x] 没有只在开发版验证 autostart；最终使用隔离的 `Patina Local` release 和明确 `--autostart` 参数完成 Windows 原生验证。
- [x] 没有把任务管理器分类当成跨 Windows 版本稳定 API。

## 18. 架构落点

- [x] `src-tauri/src/app/runtime.rs` 只负责启动顺序与能力编排，不承接复杂决策。
- [x] `src-tauri/src/app/main_window.rs` 继续拥有主窗口创建、显示、隐藏、恢复和销毁能力。
- [x] `src-tauri/src/app/desktop_behavior.rs` 只负责桌面设置同步和启动行为编排。
- [x] `src-tauri/src/app/state.rs` 只保存线程安全的生命周期与用户意图状态。
- [x] `src-tauri/src/domain/settings.rs` 只承接不依赖 Tauri 的设置语义与纯决策。
- [x] `src-tauri/src/app/tray.rs` 保持事件转发薄，不复制窗口创建细节。
- [x] `src-tauri/src/app/bootstrap.rs` 保持插件、state、handler 和 hook 注册职责，不吸收窗口业务。
- [x] 前端只负责窗口创建后的界面和快照读取，不决定原生 autostart 生命周期。

## 19. 原生验证记录

| 场景 | 主进程 | WebView2 | 结果 |
| --- | --- | ---: | --- |
| 资源优先，三分钟前 | 存活 | 6 | 隐藏预热保留 |
| 资源优先，三分钟后 | 存活 | 0 | 主 WebView 已销毁 |
| 销毁后 single-instance 唤起 | 唯一主进程存活 | 6 | 主窗口按需重建 |
| 速度优先，超过三分钟 | 存活 | 6 | 隐藏主 WebView 保留 |

## 20. Git 与 Project 协作

- [x] 推送前已通过浏览器插件读取 live GitHub Project；看板中没有找到本次开机后台任务项。
- [x] 未代替维护者改变 Project 状态或顺序。
- [x] live Board 当前唯一 `In progress` 项仍为“完善数据导出体验并支持 Markdown”，本次任务无法在没有对应项目项的情况下建议状态拖动。
- [x] live Board 的 `Next` 仍为“定义 v2 SQLite 快照备份与兼容契约”和“增加‘工具’消息提示”；本次完成不要求调整这两个现有位置。
- [x] 本轮没有创建分支、PR、Issue 状态变更或 issue-closing 关键字。
- [x] 用户本轮没有明确要求提交/推送，因此按仓库规则保留工作区改动，等待后续“全部推到仓库”指令。
- [x] 本地归档不替代 live Project 拖动，最终交付会明确说明这一点。

## 21. 完成定义

- [x] 行为矩阵由纯决策模型实现。
- [x] 后台资源优化关闭的 autostart 在超过三分钟后仍保留隐藏主 WebView。
- [x] 后台资源优化开启的 autostart 初始保留隐藏主 WebView，持续隐藏满三分钟后销毁。
- [x] 主 WebView 销毁后后台主进程继续存活。
- [x] 托盘、single-instance、Widget 和后台优化恢复统一使用唯一主窗口入口。
- [x] 迟到设置、旧 generation 和销毁临界区竞态均有确定性状态测试。
- [x] `npm run check:full` 最终通过：351 个 Rust 测试通过、1 个忽略，Clippy 零警告，31 个真实浏览器 smoke 通过。
- [x] 隔离 Windows release 的资源优先、销毁后恢复和速度优先对照均通过。
- [x] 首装或缺失 `background_optimization` 键时默认开启；已有 `0` 保持关闭、已有 `1` 保持开启，前后端测试均覆盖。
- [x] 对抗式审查发现的销毁临界区竞态已修复，第二轮无剩余发现。
- [x] Patina Local 临时自启动项和隔离数据已清理。
- [x] 未把未执行的真实登录、精确 UI 延迟、Git 推送或 Project 拖动伪装成已完成。
- [x] 本文状态已改为“已完成并归档”，并移动到 `docs/archive/autostart-background-resource-strategy-execution-plan.md`。
