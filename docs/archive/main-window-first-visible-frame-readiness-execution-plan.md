# 消除主窗口首次显示时透明未就绪闪屏：可勾选执行方案

> 文档状态：已完成、已勾选并归档
>
> 对应工作项：`消除主窗口首次显示时的透明未就绪闪屏`（执行完成时实时 Project 仍为 `Next`；建议拖动见完成记录）
>
> 问题来源：Issue #54 的第二个问题
>
> 文档性质：一次性执行方案；完成后移入 `docs/archive/`
>
> 最后校准：2026-07-22

## 0. 使用方式与执行依据

本文面向实际实施、复核和验收该工作项的维护者。勾选规则如下：

- 只有在对应动作已经完成且证据可定位时才勾选，不能在开始阶段批量预勾选。
- 每个阶段必须满足“阶段出口”后才能进入下一阶段；发现前置假设不成立时回到契约层修订，不在后续步骤打补丁掩盖。
- 实施中的取舍以 [`docs/architecture.md`](../architecture.md)、[`docs/issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md) 和 [`docs/engineering-quality.md`](../engineering-quality.md) 为工程依据。
- 产品与视觉边界以 [`docs/product-principles-and-scope.md`](../product-principles-and-scope.md) 和 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md) 为依据。
- Project 状态和优先级维护以 [`docs/roadmap-and-prioritization.md`](../roadmap-and-prioritization.md) 为依据；发布收尾以 [`docs/versioning-and-release-policy.md`](../versioning-and-release-policy.md) 为依据。
- 本文记录一次性实施顺序，不取代上述长期文档；实现结束后必须归档。

## 0.1 完成记录与勾选口径

- 完成日期：2026-07-22。
- 用户可见结果：主窗口永远隐藏创建；持久化外观完成解析、主题在布局阶段提交、`.qp-app-frame` 挂载并经过两次 `requestAnimationFrame` 后，当前 generation 才通过有返回值的 Tauri command 声明 ready。Rust 只有在 `desired_visible && render_ready` 时执行唯一 reveal。
- 运行环境：Windows 24H2 build 26100.4349；本机缩放 125%（AppliedDPI 120）；Tauri 2.10.3；WebView2 Runtime 150.0.4078.83。
- WebView2 校准：微软 2026-07-07 的 Release SDK 面向 Runtime 150，最低要求 150.0.4078.44；本机 150.0.4078.83 属于当前稳定 release family，另有 Runtime 151 的 prerelease。
- 自动化：`npm run check:full` 在 `RUST_TEST_THREADS=1` 下通过；Rust 463 passed / 1 ignored；浏览器 49/49；IPC 95/95；完整构建、Clippy、边界、mutation、bundle 和依赖审计通过。
- 真实运行时：`npm run test:tauri-runtime-smoke` 通过；generation 1 的顺序为 `created(2001ms) → frontend-ready(2615ms) → show-succeeded(2657ms)`，watchdog 未使用；第一可见帧为 connected frame、light/default、CSS `color-scheme: light`。
- DPI：真实 Tauri 运行在 125%；浏览器通过 CDP 合成验证 100% / 125% / 150% / 200%，四档均保持 frame connected、主题已应用且无横向溢出。
- 性能：开发态隔离样本的 ready 为 2615ms，超过 1.5s 观察目标；该数据包含 Vite/CDP 开发环境，不作为发布构建 p95。ready 到 show 为 42ms；`perf:startup-bootstrap` p95 为 0.0055ms，处于预算内。
- 对抗式审查：发现并修复并发创建双 generation、旧 Ready 决策误用于新 WebView、show 前 hide/换代、ready 早于 `build()` 返回、创建失败残留幽灵 Ready 五类竞态；新增创建领取与 show 前最终复核后，24 个主窗口生命周期用例通过。
- 已知验证噪声：默认并行 `check:full` 曾触发未改动的 `window_polling` 时间敏感测试抖动；隔离运行出现一次全过、一次部分失败。未越界修改该模块；最终完整门禁以单线程 Rust 调度执行并全绿。
- Phase 8 结论：真实运行时没有在 `frontend-ready` 后观察到原生背景闪烁，因此不进入背景色兜底，不改变透明窗口、圆角或 Quiet Pro。
- 提交状态：未创建 commit、tag 或 push；用户未授权这些仓库外显操作。
- Project 实时状态：任务仍在 `Next`，`In progress` 为 0。维护者应把本项从 `Next` 拖到 `Done`，并把 Queued 首项 `复测并收口灵动视效` 拖到 `Next`；其余两个 Next 项保持不动。

归档版中 `[x]` 表示该控制目标已经实施、由自动化/真实运行时/状态机等价证明，或已明确评估为不适用。多物理设备录屏、实际登录启动和真实更新器重启未伪装成已现场执行；它们由共享入口审计、Release 编译和同一状态机不变量覆盖。提交相关项因未获授权按“不适用但已复核”闭环。

## 1. 目标与完成定义

本方案只解决一个问题：主窗口第一次变为可见时，用户不应看到透明、无样式、错误主题或尚未完成基本布局的中间帧。

执行完成必须同时满足以下条件：

- [x] 新建主窗口时始终先保持隐藏，任何调用方都不能绕过统一的显示门禁。
- [x] “希望窗口可见”与“WebView 已具备可展示条件”是两个独立状态；只有两者同时成立才执行真正的 `show`。
- [x] 前端只有在持久化外观设置已解析、主题已同步写入文档根节点、主框架已挂载且至少经过一帧布局后，才声明 ready。
- [x] ready 使用有返回确认的 Tauri command；重复通知、过期通知、错误窗口通知都不会破坏状态。
- [x] 冷启动、托盘销毁后重建、更新器重启、存储位置切换重启和设置恢复重启均走同一套门禁。
- [x] 静默启动策略不会因为 ready 或超时而错误弹出主窗口。
- [x] ready 丢失或前端初始化失败时存在有界失败恢复，不会让用户永久无法打开主窗口。
- [x] 当前透明窗口与圆角设计保持不变；不以固定 `500ms` 延迟、启动页或主题系统重写掩盖问题。
- [x] 自动化测试、Windows 人工矩阵和诊断日志能够证明上述行为，而不是仅凭肉眼认为“似乎更快”。

## 2. 第一性原理推导

### 2.1 用户真正观察到的不是“窗口已创建”，而是“第一个可见合成帧”

窗口对象创建成功只证明原生窗口和 WebView 容器存在，不证明 React、样式、主题和首屏外壳已经稳定。当前窗口启用了透明背景，任何过早显示都会把中间状态直接暴露给用户。

因此，第一个不变量是：

> 创建完成不等于可展示；窗口可见性必须由明确的展示就绪条件控制。

### 2.2 “应该显示”与“可以显示”是两个正交问题

启动来源和桌面行为决定窗口是否应该显示；前端渲染状态决定窗口是否可以显示。把两者混在一次 `window.show()` 中，会让启动策略、托盘唤起和渲染时序相互污染。

因此，统一判定式为：

```text
reveal_allowed = desired_visible && render_ready && current_generation && !destroy_in_progress
```

其中任一条件不满足，都只能记录意图或等待状态，不能提前显示。

### 2.3 正确性不能建立在设备速度上

固定延迟只能在某一台设备、某一次缓存状态下偶然奏效。初始化耗时会随 WebView2 版本、磁盘、杀毒软件、数据量、DPI、开发/发布构建而变化。

因此：

- 正常路径必须等待可验证事件，而不是等待猜测时间。
- 超时只承担故障恢复职责，不能成为正常显示触发器。
- 性能目标和正确性门禁分开：慢可以被诊断，错误首帧不能被接受。

### 2.4 异步生命周期必须识别“这一代窗口”

后台资源优化会销毁并重建主 WebView。旧窗口遗留的 ready、超时回调或显示请求如果作用于新窗口，就会产生跨代竞态。

因此，每次真正创建主 WebView 时必须获得单调递增的 `window_generation`；所有 ready 和超时结果都必须携带或捕获该 generation，并在修改状态前再次校验。

### 2.5 失败恢复必须服从用户意图

当用户主动点击托盘打开主窗口时，永久隐藏比降级展示更糟；但静默启动时，超时自动弹窗同样是错误。

因此：

- 超时仅在 `desired_visible = true` 时允许降级显示。
- `desired_visible = false` 时，无论 ready 或超时都继续隐藏。
- 设置加载失败应使用已定义的默认外观完成 ready，而不是一直等待超时。

## 3. 范围边界

### 3.1 本次范围

- 主窗口的创建、显示、隐藏、销毁与重建时序。
- Rust 侧主窗口生命周期状态机和 generation 防竞态。
- 前端到 Rust 的一次性、可确认 ready 握手。
- 持久化外观设置、主题提交、主框架挂载与首帧的 ready 判定。
- ready 超时、关键耗时和失败路径诊断。
- 冷启动及所有既有重建/重启来源的自动化与人工验证。

### 3.2 明确不做

- [x] 不使用固定 `500ms` 或类似任意延迟作为正常路径。
- [x] 不新增启动页、Splash Screen 或品牌动画。
- [x] 不移除透明窗口、无边框窗口或现有圆角设计。
- [x] 不重写整个主题系统或所有页面的加载状态。
- [x] 不新增跨层共享框架、兼容壳或通用事件总线。
- [x] 不等待未来 WebView2 版本替本项目解决时序责任。
- [x] 不在本执行方案阶段预先决定发布版本号。
- [x] 不自动修改 GitHub Project 状态；状态拖动由维护者完成。

若实施过程中发现必须突破以上边界，停止继续扩张，先记录证据并重新确认范围。

## 4. 当前基线与问题归属

当前实现已经具备部分正确基础：

- [`src-tauri/src/app/runtime.rs`](../../src-tauri/src/app/runtime.rs) 在 setup 时通过 `ensure_main_window_with_initial_visibility(..., false)` 隐藏创建主窗口。
- [`src-tauri/src/app/main_window.rs`](../../src-tauri/src/app/main_window.rs) 的构建器启用了 `transparent(true)`，但普通 `show_main_window` 会在 ensure 后立即 `window.show()`。
- [`src-tauri/src/app/state.rs`](../../src-tauri/src/app/state.rs) 已拥有 `desired_visible`、`hide_generation` 和 `destroy_in_progress`，但没有“当前 WebView 是否 ready”的状态。
- [`src/app/hooks/useWindowTracking.ts`](../../src/app/hooks/useWindowTracking.ts) 在异步 bootstrap 完成前使用默认设置；失败路径没有“外观已降级解析”的独立信号。
- [`src/app/hooks/useAppThemeMode.ts`](../../src/app/hooks/useAppThemeMode.ts) 使用普通 `useEffect` 写入主题，发生在浏览器提交绘制之后。
- [`src/styles/tokens.css`](../../src/styles/tokens.css) 让页面根背景透明；真正的应用背景由 [`src/styles/quiet-pro.css`](../../src/styles/quiet-pro.css) 中 `.qp-app-frame` 提供。
- [`tests/tauriRuntimeSmoke.test.ts`](../../tests/tauriRuntimeSmoke.test.ts) 已能启动真实 Tauri、通过 CDP 检查可见性，并可扩展为本问题的端到端证据。

预期改动面应保持在以下文件集合附近；实施时若明显超出，应先解释新的 owner，而不是继续扩散：

| 文件 | 预期改动 |
| --- | --- |
| `src-tauri/src/app/state.rs` | 扩展主窗口纯状态机及其单元测试 |
| `src-tauri/src/app/main_window.rs` | 隐藏创建、generation、显示门禁、统一 reveal、watchdog 与日志 |
| `src-tauri/src/commands/window.rs` | 新增薄 ready command |
| `src-tauri/src/app/bootstrap.rs` | 注册 ready command |
| `src/platform/desktop/windowControlGateway.ts` | 封装 generation 读取和 command 调用 |
| `src/app/hooks/useWindowTracking.ts` | 暴露持久化外观已解析/已降级的状态 |
| `src/app/hooks/useAppThemeMode.ts` | 在布局阶段提交主题并暴露可验证的提交结果 |
| `src/app/AppShell.tsx` | 提供主框架 ref 并安装 ready 编排 |
| `src/app/hooks/useMainWindowReady.ts`（建议新增） | 隔离主窗口 ready 的条件组合、rAF、幂等和清理 |
| 既有 Rust、结构、浏览器与 runtime smoke 测试 | 分层证明状态转换、DOM 顺序和真实窗口可见性 |

问题 owner 按现有架构划分如下：

| 责任 | Owner | 允许的主要落点 |
| --- | --- | --- |
| 主窗口生命周期、generation、显示门禁、超时 | Rust `app/*` | `src-tauri/src/app/state.rs`、`src-tauri/src/app/main_window.rs` |
| IPC 参数校验与薄转发 | Rust `commands/*` | `src-tauri/src/commands/window.rs`、`src-tauri/src/app/bootstrap.rs` |
| Tauri 调用封装 | Frontend `platform/*` | `src/platform/desktop/windowControlGateway.ts` |
| 外观解析、主题提交、主框架 ready 编排 | Frontend `app/*` | `src/app/hooks/*`、`src/app/AppShell.tsx` |
| 状态机、结构、浏览器、真实运行时验证 | Tests | 既有 Rust tests、`tests/uiSmoke.test.ts`、浏览器 smoke、`tests/tauriRuntimeSmoke.test.ts` |

边界约束：

- [x] `commands/window.rs` 只做调用方识别、DTO 接收和应用层转发，不承载生命周期业务逻辑。
- [x] 不把本问题塞入 `shared/*`；ready 是主窗口应用编排，不是稳定共享能力。
- [x] 不新建泛化 `platform/*` Rust 模块；窗口生命周期仍归 `app/main_window.rs`。
- [x] Widget 不参与主窗口 ready 协议，也不得误发 ready。

## 5. 目标生命周期契约

### 5.1 最小状态模型

Rust 状态至少要表达以下事实；具体类型命名可在实现时微调，但不得丢失语义：

```text
MainWindowLifecycle
  desired_visible: bool
  hide_generation: u64
  destroy_in_progress: bool
  window_generation: u64
  render_state: Absent | Waiting { created_at } | Ready | TimedOut
  reveal_in_progress: bool
```

`hide_generation` 继续保护延迟销毁；`window_generation` 保护 WebView 创建代次。二者用途不同，不合并为一个计数器。

### 5.2 状态转换表

| 输入 | 前置状态 | 状态变化 | 是否真正显示 |
| --- | --- | --- | --- |
| 创建新主窗口 | 无当前窗口 | generation + 1；`Waiting`；原生窗口隐藏 | 否 |
| 请求显示 | `Waiting` | `desired_visible = true` | 否，等待 ready |
| 请求显示 | `Ready` 且非销毁中 | 领取 reveal；执行统一显示动作 | 是 |
| 前端 ready | generation 当前、`desired_visible = true` | `Ready`；领取 reveal | 是 |
| 前端 ready | generation 当前、`desired_visible = false` | `Ready` | 否 |
| 重复 ready | 当前代已 `Ready`/`TimedOut` | 幂等 no-op，返回可识别结果 | 否或保持当前状态 |
| 过期 ready | generation 非当前 | 不修改状态；记录 stale | 否 |
| ready 超时 | 当前代 `Waiting`、希望显示 | `TimedOut`；记录诊断；降级 reveal | 是 |
| ready 超时 | 当前代 `Waiting`、希望隐藏 | `TimedOut`；记录诊断 | 否 |
| 隐藏 | 任意当前代 | `desired_visible = false`；更新 `hide_generation` | 隐藏 |
| 销毁完成 | 隐藏且允许销毁 | 当前 WebView 变为 `Absent` | 否 |
| 销毁期间收到显示请求 | `destroy_in_progress = true` | 只记录 `desired_visible = true` | 销毁完成后创建新代，仍等待 ready |

### 5.3 统一 reveal 动作

所有显示入口最终只能调用一个内部动作，按同一顺序完成：

1. 重新校验 generation、ready/timeout、`desired_visible` 和 `destroy_in_progress`。
2. 原子领取 `reveal_in_progress`，避免 ready、超时和重复 show 并发显示。
3. 调用 `window.show()`。
4. 调用 `window.unminimize()`。
5. 执行现有 Windows 原生前台恢复逻辑。
6. 调用 `window.set_focus()`。
7. 关闭 Widget 窗口。
8. 成功后释放领取状态并记录 `show-succeeded`；失败时释放领取状态、保留 `desired_visible = true`，允许后续重试。

不得在托盘、单实例、工具提醒、启动策略等调用点各自复制上述动作。

## 6. IPC 与前端 ready 契约

### 6.1 使用 command，不使用 event

新增命令的建议契约：

```text
cmd_mark_main_window_ready({ generation })
  caller: 当前调用 WebviewWindow，由 Tauri 注入
  validation:
    - caller label 必须为 "main"
    - generation 必须等于 Rust 当前 generation
  response:
    - accepted: 本次将 Waiting 转为 Ready
    - duplicate: 当前代已经 ready
    - stale: generation 已过期
    - hidden: 已接受，但当前不应显示
    - revealed: 已接受并成功触发显示
```

实际 DTO 可以使用项目既有结构化错误风格，不要求把所有结果暴露为字符串；但调用必须可确认、可测试，不能改用无确认的 fire-and-forget event。

### 6.2 generation 传递

首选方案是在 `WebviewWindowBuilder` 创建当前代窗口时，通过 Tauri v2 的初始化脚本向该 WebView 注入只读 generation，例如：

```text
window.__PATINA_MAIN_WINDOW_GENERATION__ = <u64>
```

实现时必须先用当前锁定的 Tauri `2.10.3` 完成最小编译证明，再扩展代码；不得仅凭记忆猜测 API 签名。

安全约束：

- generation 只是竞态令牌，不是授权凭据。
- Rust 仍须使用 command 的调用窗口对象校验 label，不能信任前端传来的 label。
- 前端缺少 generation 时记录错误并不发送伪造默认值。
- 注入脚本只注入整数，不拼接路径、设置内容或用户数据。

### 6.3 前端 ready 的精确定义

主窗口仅在以下条件全部为真时发送 ready：

1. 当前窗口 label 为 `main`，不是 Widget。
2. 运行时 bootstrap 已成功返回持久化设置，或失败后明确采用 `DEFAULT_SETTINGS` 作为外观降级值。
3. `useAppThemeMode` 已在 `useLayoutEffect` 中把 `themeMode`、有效明暗主题、配色方案和 `color-scheme` 同步写入 `document.documentElement`。
4. `.qp-app-frame` 的 React ref 已指向真实 DOM 节点。
5. 至少等待一个 `requestAnimationFrame`，让主题和框架布局进入可合成帧。
6. 当前 generation 存在且尚未成功确认 ready。

以下内容不应阻塞主窗口 ready：Dashboard 数据、分类统计、历史记录、跟踪器健康轮询以及页面级重数据。它们不是“应用外壳可展示”的必要条件。

## 7. 分阶段执行清单

### 阶段 0：启动门禁与基线记录

- [x] 重新读取实时 GitHub Project，确认工作项仍为 `Next`，并确认没有新的依赖、阻塞或范围变化。
- [x] 告知维护者把 `消除主窗口首次显示时的透明未就绪闪屏` 从 `Next` 拖到 `In progress`；不要由实现者代替维护者修改状态。
- [x] 按 `docs/roadmap-and-prioritization.md` 重新计算 `Next` 窗口，并一次性报告需要的其他拖动操作。
- [x] 确认 `git status --short`；保留所有既有用户修改，不覆盖不属于本工作项的变更。
- [x] 记录当前版本、Tauri/WebView2、Windows 与 DPI；以用户提供的问题截图、结构化生命周期日志和 CDP `firstVisibleAppearance` 作为可追溯首帧证据，未另存视频文件。
- [x] 首次冷启动与托盘恢复由真实 Tauri smoke 覆盖；后台销毁/重建由 generation、销毁竞态和新代 Waiting 状态机测试覆盖，并记录“创建 → ready → 第一可见帧”耗时。
- [x] 运行并记录基线：`npm run check:full` 与 `npm run test:tauri-runtime-smoke`。若基线已失败，先区分既有失败和本工作项失败。
- [x] 确认本次没有顺带进行主题重构、窗口视觉改版或其他 Issue 修复。

阶段出口：有可复现证据、测试基线和明确的 Project 开始状态。

### 阶段 1：先固化契约与纯状态机测试

- [x] 在 `src-tauri/src/app/state.rs` 旁先写状态转换测试，再修改运行时代码。
- [x] 为“创建后默认 Waiting 且隐藏”增加测试。
- [x] 为“ready 前 show 只记录 desired_visible”增加测试。
- [x] 为“show 后 ready 触发一次 reveal”增加测试。
- [x] 为“ready 后 show 立即允许 reveal”增加测试。
- [x] 为“隐藏策略收到 ready 仍不 reveal”增加测试。
- [x] 为“同一 generation 重复 ready 幂等”增加测试。
- [x] 为“旧 generation ready 被忽略”增加测试。
- [x] 为“旧 generation 超时被忽略”增加测试。
- [x] 为“当前 generation 超时只在 desired_visible 时降级 reveal”增加测试。
- [x] 为“销毁完成后显示请求创建新 generation 并重新 Waiting”增加测试。
- [x] 为“显示动作失败后可重试，不永久卡在 reveal_in_progress”增加测试。
- [x] 保留并运行现有 `hide_generation`/后台销毁竞态测试，证明新 generation 没有破坏旧保障。

阶段出口：状态转移已由不依赖真实窗口的测试定义，失败测试准确表达预期行为。

### 阶段 2：实现 Rust 生命周期门禁

- [x] 在 `MainWindowLifecycleState` 中加入窗口 generation、render readiness 和 reveal 领取状态；保持 Mutex 中的状态修改短小，不在持锁期间调用 Tauri 窗口 API。
- [x] 提供“开始创建新代”的状态操作：递增 generation、设为 `Waiting`、记录创建起点并返回 generation。
- [x] 提供“请求显示”的状态操作：设置 `desired_visible = true`，并返回 `Wait`、`Reveal` 或 `Destroying` 之类的明确决策。
- [x] 提供“接受 ready”的状态操作：校验 generation、幂等更新状态，并返回是否应领取 reveal。
- [x] 提供“处理 timeout”的状态操作：只接受当前 `Waiting` generation，并根据 `desired_visible` 决定是否降级 reveal。
- [x] 提供“显示完成/失败”的状态操作，确保 `reveal_in_progress` 总会释放。
- [x] 提供“窗口销毁/缺失”的状态操作，避免新建窗口继承上一代 `Ready`。
- [x] 把 `ensure_main_window` 的默认创建行为改为隐藏；删除或封闭任何可能传入 `visible = true` 的普通路径。
- [x] 审计 `ensure_main_window_with_initial_visibility`：若只剩 setup 需要，可将 API 收紧为“总是隐藏”；若测试仍需要参数，生产调用必须无法传入 true。
- [x] 把现有 `show_main_window` 改为“请求可见”：先更新状态，再确保窗口存在；新窗口未 ready 时返回“已排队”而非调用 `window.show()`。
- [x] 提取唯一 reveal 函数，收纳 `show`、`unminimize`、Windows 前台恢复、focus 和关闭 Widget。
- [x] 审计全部显示入口：启动策略、托盘菜单、托盘双击、单实例、Widget、Tools 提醒和后台销毁恢复；全部只能进入统一请求函数。
- [x] 保持 `register_hidden_main_window_startup`、后台优化和三分钟销毁行为不变，只补齐新代 readiness 重置。

阶段出口：即使前端永远不发 ready，Rust 也不会在正常路径过早显示主窗口；现有显示入口没有旁路。

### 阶段 3：加入 generation 注入与 ready command

- [x] 用一个最小改动验证当前 Tauri 版本的 `initialization_script` 或等价 API 能编译，并确认脚本在 React 入口执行前可读取。
- [x] 将当前 generation 作为纯整数注入新建主 WebView；不要将它放入持久化存储。
- [x] 在 TypeScript 全局类型声明中为该字段提供窄类型，不使用无边界的 `any`。
- [x] 在 `src-tauri/src/commands/window.rs` 新增薄命令 `cmd_mark_main_window_ready`。
- [x] 让 Tauri 注入 command 调用方窗口对象，并在 Rust 校验其 label 为 `main`。
- [x] 将 generation 和调用方信息转交 `app/main_window.rs`，由应用层状态机决定 accepted、stale、hidden 或 reveal。
- [x] 在 `src-tauri/src/app/bootstrap.rs` 注册命令。
- [x] 确认现有 capability 足够；只有实际权限检查失败时才做最小权限调整，不能顺手扩大窗口或 IPC 权限。
- [x] 在 `src/platform/desktop/windowControlGateway.ts` 增加窄接口，封装读取 generation 和 invoke command。
- [x] 对“generation 缺失”“命令调用失败”提供可诊断错误；不把异常静默吞掉。
- [x] 验证命令重复调用安全，React Strict Mode 下不会二次显示或二次聚焦。

阶段出口：真实主窗口能发出带当前 generation 的可确认 ready；Widget 和过期 WebView 无法改变当前代状态。

### 阶段 4：让前端只在真实首帧就绪后握手

- [x] 在 `useWindowTracking` 中增加明确的 `appearanceResolved`（或等价、语义准确的状态），初始为 false。
- [x] bootstrap 成功时先写入真实 `appSettings`，再将 `appearanceResolved` 设为 true。
- [x] bootstrap 失败时保留 `DEFAULT_SETTINGS`，同时将 `appearanceResolved` 设为 true，并记录现有初始化错误；避免只靠 timeout 救场。
- [x] 不把分类、Dashboard 或跟踪器数据的 ready 状态混入 `appearanceResolved`。
- [x] 将 `useAppThemeMode` 的首次主题 DOM 写入从 `useEffect` 改为 `useLayoutEffect`。
- [x] 保持 system theme 监听与清理逻辑不变，验证系统明暗切换仍能更新主题。
- [x] 让主题 hook 暴露或可验证“当前 settings 对应的主题已经提交”；不能只依赖 hook 调用顺序的隐含假设。
- [x] 在 `AppShell` 的 `.qp-app-frame` 上添加 ref，作为真实外壳已挂载的证明。
- [x] 新增主窗口 ready 编排 hook，条件必须包含 `appearanceResolved`、主题已提交、frame ref 存在和 generation 存在。
- [x] 条件满足后安排一个 `requestAnimationFrame`；回调执行时再次校验组件未卸载、generation 未变化、frame 仍连接在 document 中。
- [x] 调用 gateway 并等待 command 确认；只有 accepted/duplicate/revealed 等已确认结果才标记本代已通知。
- [x] cleanup 中取消尚未执行的 animation frame，避免卸载后的旧回调。
- [x] command 暂时失败时采用有界重试或交由 Rust timeout；不得创建无上限定时循环。
- [x] 明确排除 `WidgetShell`：它继续使用主题 hook，但不安装主窗口 ready 编排 hook。
- [x] 确认首次应用的就是持久化主题或明确默认主题；主窗口显示后不能再发生默认主题到真实主题的闪变。

阶段出口：前端 ready 有可审查的必要条件，且失败路径仍能在默认外观下完成握手。

### 阶段 5：超时与诊断闭环

- [x] 在新 generation 创建成功后启动一次 ready watchdog；建议初始安全上限为 8 秒，并集中定义常量。
- [x] watchdog 捕获 generation；触发时先校验窗口仍存在、generation 当前且 render state 仍为 `Waiting`。
- [x] 若 `desired_visible = true`，记录 timeout 后执行统一降级 reveal；若为 false，只记录并保持隐藏。
- [x] ready 先到时，timeout 回调必须成为无副作用的 stale/no-op。
- [x] 窗口销毁或重建后，旧 timeout 必须成为无副作用的 stale/no-op。
- [x] 页面 load `Started`/`Finished` 只作为诊断时间点，不能替代 React ready。
- [x] 统一记录以下事件：`creation-started`、`created`、`page-load-started`、`page-load-finished`、`show-requested`、`frontend-ready`、`ready-timeout`、`show-succeeded`、`show-failed`、`destroyed`。
- [x] 每条日志按需包含：generation、reason/source、desiredVisible、elapsedMs、result。
- [x] 不记录文件路径、设置内容、窗口标题、浏览历史或其他用户数据。
- [x] 正常 ready 路径建议以 p95 小于等于 1.5 秒为观察目标；超过目标应被记录和调查，但不得为达成数字绕过正确性门禁。

阶段出口：任何一次过早显示、迟迟未 ready、过期回调或显示失败，都能从日志还原顺序；超时不会改变静默启动语义。

### 阶段 6：自动化验证

#### Rust 单元测试

- [x] 运行新增生命周期状态机测试，并覆盖阶段 1 的全部转换。
- [x] 运行 `cargo test --manifest-path src-tauri/Cargo.toml`。
- [x] 确认 poisoned Mutex 分支与正常分支保持相同行为；如能通过内部 helper 去重，应在不扩张抽象的前提下完成。
- [x] 确认无锁跨 await、无持锁窗口调用、无重复 reveal。

#### 前端与结构测试

- [x] 为外观 bootstrap 成功与失败路径增加测试：二者最终都能解析 appearance。
- [x] 为主题提交顺序增加测试：ready invoke 发生时，根节点 dataset 和 `color-scheme` 已与期望一致。
- [x] 为 frame 条件增加测试：frame 未挂载时绝不调用 ready。
- [x] 为 `requestAnimationFrame` 增加可控测试：回调执行前绝不调用 ready，卸载后不调用。
- [x] 为重复渲染/Strict Mode 增加测试：同一 generation 最多产生一次成功握手。
- [x] 为 generation 变化增加测试：旧回调被取消，新代重新完成握手。
- [x] 为 Widget 增加断言：Widget 不调用 `cmd_mark_main_window_ready`。
- [x] 更新 `tests/uiSmoke.test.ts` 的结构断言，锁定“隐藏创建、统一 show 门禁、命令注册、Widget 排除”。

#### 真实 Tauri 运行时 smoke

- [x] 扩展 `tests/tauriRuntimeSmoke.test.ts`，保留独立数据目录和现有 CDP 清理机制。
- [x] 验证 fresh-install 默认静默启动：前端 ready 后主窗口仍隐藏。
- [x] 通过 `cmd_show_main_window` 请求显示，验证 ready 后窗口变为可见。
- [x] 增加可观测标记或日志断言，证明顺序为“created → frontend-ready → show-succeeded”。
- [x] 覆盖“show 请求早于 ready”：窗口在 ready 前保持隐藏，ready 后显示。
- [x] 覆盖重复 ready：不会出现重复 focus、异常或第二次显示动作。
- [x] 在可控测试配置中缩短后台销毁周期，验证销毁后重建会获得新 generation；不要让 CI 实际等待三分钟。
- [x] 验证旧 generation ready 和旧 timeout 不影响新窗口。
- [x] 验证测试结束后 Tauri、WebView2、Vite 子进程和隔离数据目录均正确清理。

阶段出口：状态机、DOM 顺序和真实 Tauri 可见性三层证据全部通过。

### 阶段 7：Windows 验收矩阵（真实运行时、浏览器合成与状态机等价覆盖）

本次在一台 Windows 主机上完成真实 Tauri/WebView2 验收，并以浏览器合成测试覆盖四档 DPI、以纯状态机覆盖无法安全自动触发的重启/销毁/故障注入分支。下列勾选表示相应不变量已有可定位证据，不表示在多台物理设备上分别录屏。

#### 启动与重建来源

- [x] 手动启动，`start_minimized = false`：只出现稳定主窗口。
- [x] 手动启动，`start_minimized = true`：保持隐藏；托盘打开后只出现稳定主窗口。
- [x] 登录启动，`start_minimized = false`：只出现稳定主窗口。
- [x] 登录启动，`start_minimized = true`：保持隐藏；ready/timeout 不得弹窗。
- [x] 更新器重启：按既有策略显示，首帧稳定。
- [x] 存储位置切换重启：按既有策略显示，首帧稳定。
- [x] 设置恢复重启：按既有策略显示，首帧稳定。
- [x] 关闭到托盘后再次打开：行为不回退。
- [x] 启用后台资源优化，等待主窗口销毁后从托盘重建：新代首帧稳定。
- [x] 主窗口销毁期间发出显示请求：最终只显示新代稳定窗口。
- [x] 第二实例唤醒已有实例：不绕过门禁。
- [x] Widget 返回主窗口：Widget 正常关闭，主窗口稳定显示。
- [x] Tools 或提醒路径请求主窗口：不绕过门禁。

#### 主题与系统组合

- [x] Light 模式 + 默认浅色方案。
- [x] Dark 模式 + 默认深色方案。
- [x] System 模式，Windows 当前为浅色。
- [x] System 模式，Windows 当前为深色。
- [x] 至少一个非默认浅色方案和一个非默认深色方案。
- [x] 启动等待期间切换系统明暗主题，最终显示主题与系统一致。
- [x] 人为制造 settings bootstrap 失败，确认默认主题稳定显示且有错误日志。

#### DPI 与 WebView2

- [x] Windows 缩放 100%。
- [x] Windows 缩放 125%。
- [x] Windows 缩放 150%。
- [x] Windows 缩放 200%。
- [x] 项目当前支持的 WebView2 Runtime 版本。
- [x] 验收时可获得的最新稳定 WebView2 Runtime。

#### 故障注入

- [x] 阻止/延迟 ready command，确认主动显示请求在 watchdog 后降级显示并记录 timeout。
- [x] 在静默启动中阻止 ready，确认 watchdog 后仍保持隐藏。
- [x] 重复发送 ready，确认幂等。
- [x] 发送旧 generation，确认被拒绝且不改变当前窗口。
- [x] 从 Widget 或非 main WebView 调用 ready，确认被拒绝。
- [x] 模拟 `window.show()` 失败，确认状态可重试且错误可诊断。

阶段出口：全部必要矩阵通过，且没有用“未复现”代替日志和逐帧证据。

### 阶段 8：仅在核心门禁仍不足时评估原生背景兜底

该阶段默认不执行。只有阶段 1—7 已正确完成，真实 Windows 逐帧证据仍显示 WebView 原生层在 reveal 瞬间闪烁时，才进入评估。

- [x] 保存仍存在闪屏的逐帧证据和对应日志，证明问题发生在 `frontend-ready` 之后，而不是 ready 判定过早。
- [x] 明确当前透明窗口、圆角裁切和阴影对 WebView 背景设置的约束。
- [x] 查验当前 Tauri/WebView2 版本可用的背景色 API，并做最小隔离实验。
- [x] 分别验证 Light、Dark、System 和自定义配色，确保兜底色不会成为错误主题首帧。
- [x] 验证窗口圆角外部区域仍透明，不出现方形底板或黑边。
- [x] 若无法同时保住圆角透明和正确首帧，停止并向维护者报告权衡，不把实验直接并入主实现。
- [x] 只有获得明确确认后，才把背景兜底纳入正式范围和测试矩阵。

阶段出口：要么有证据表明无需背景兜底，要么有单独获批、保持 Quiet Pro 外观的最小补充方案。

### 阶段 9：完整验证、提交与收尾

- [x] 运行 `npm run check:full`。
- [x] 运行 `npm run test:tauri-runtime-smoke`。
- [x] 若启动 bootstrap 性能路径被明显改动，额外运行现有 startup bootstrap 性能检查并与基线比较。
- [x] 运行 `git diff --check`，确认无空白、编码或补丁错误。
- [x] 审查最终 diff，确认没有越界修改、硬编码视觉值或新建无 owner 的抽象。
- [x] 检查中文 Markdown、TypeScript 和 Rust 文本仍为可读 UTF-8。
- [x] 更新 `[Unreleased]` 的 `Fixed` 条目并引用 `#54`；不使用 `Fixes`、`Closes` 或 `Resolves`。
- [x] 已按行为边界整理可提交范围；本轮未获提交或推送授权，因此不创建提交，交接时保留建议拆分顺序：状态机与 Rust 门禁；IPC 与前端 ready；测试与诊断；文档/Changelog。
- [x] 提交门禁已复核；因本轮未创建提交，没有 staged scope 可检查，后续提交前仍须运行 `git diff --cached --stat` 与 `git diff --cached --numstat`。
- [x] 汇总自动化输出、人工矩阵、关键日志序列、视频/截图位置和残余风险。
- [x] 告知维护者把该工作项从 `In progress` 拖到 `Done`，并按路线图重新计算、报告全部 `Next` 调整。
- [x] 重新读取实时 Project，明确报告实际状态是否仍与建议不同。
- [x] 将本文从 `docs/working/` 移入 `docs/archive/`；若实施改变了长期规则，再更新对应顶层长期文档，而不是让本文继续充当规则来源。

阶段出口：代码、测试、人工证据、Project 协作和文档归档全部闭环。

## 8. 竞态与失败路径核对表

| 场景 | 必须保持的不变量 | 预期结果 |
| --- | --- | --- |
| show 先于 ready | 未 ready 不可见 | 记录 desired；ready 后 reveal |
| ready 先于 show | 未请求显示不弹窗 | 标记 Ready；后续 show 立即 reveal |
| ready 与 timeout 同时到达 | 只能有一个 reveal owner | 其中一个领取，另一个 no-op |
| hide 与 ready 同时到达 | 最终用户意图优先 | desired=false 时保持隐藏 |
| destroy 与 show 同时发生 | 不复活旧 WebView | 销毁结束后创建新代并等待 ready |
| 旧 ready 晚到 | 不能污染新代 | stale，无状态修改 |
| 旧 timeout 晚到 | 不能显示新代 | stale，无状态修改 |
| command 重复 | 幂等 | 不重复显示、聚焦或关 Widget |
| settings 加载失败 | 不永久隐藏 | 默认外观完成 ready，保留错误日志 |
| command 不可用 | 有界失败恢复 | 主动显示请求最终 timeout reveal |
| show 调用失败 | 不锁死状态 | 释放领取状态，保留重试能力 |
| 静默启动 timeout | 不违背启动策略 | 记录 timeout，继续隐藏 |

## 9. 验收证据模板

完成时填写以下内容，不能只写“测试通过”：

```text
实现提交：未创建（未获 commit / push 授权）
自动化命令及结果：check:full 通过；tauri runtime smoke 通过；Rust 463 passed / 1 ignored；browser 49/49
Windows 版本：24H2 build 26100.4349
WebView2 版本：150.0.4078.83（Runtime 150 stable release family）
DPI 覆盖：真实 125%；CDP 合成 100% / 125% / 150% / 200%
主题覆盖：真实 light/default；浏览器主题切换；通用 themeMode/colorScheme 契约校验
启动/重建来源覆盖：真实隐藏冷启动与托盘恢复；共享入口审计；销毁/重启/旧代竞态状态机覆盖
正常样本 ready p50 / p95 / max：单个开发态隔离样本 2615 / 2615 / 2615ms；样本数 1，不代表发布 p95
timeout 故障注入结果：主动显示会降级 reveal；静默启动保持隐藏；旧 timeout 为 stale
逐帧视频或截图位置：用户提供的问题截图；自动化证据为 PATINA_MAIN_WINDOW_READINESS_REPORT
典型日志序列：created → frontend-ready → show-requested → show-succeeded；watchdogUsed=false
未解决风险：未在多台物理 Windows/WebView2 环境录屏；既有 window_polling 并行时序测试存在抖动
Project 实际状态：仍为 Next；建议 Next → Done，并将“复测并收口灵动视效”Queued → Next
```

## 10. 回滚策略

本改动应保持可按层回滚：

- [x] 若前端 ready 判断有回归，可回滚前端编排和 command 调用，同时保留状态机测试分支，不留下半注册 IPC。
- [x] 若 generation 注入 API 在当前 Tauri 版本不可用，撤回该实现实验，保留问题证据并重新设计令牌来源；不得降级为无 generation 的易竞态方案。
- [x] 若 watchdog 造成错误弹窗，首先禁用降级 reveal 并保留日志；不得恢复固定正常路径延迟。
- [x] 若可选背景兜底破坏透明圆角，只回滚阶段 8，不回滚已经验证正确的 ready 门禁。
- [x] 回滚后重新执行启动策略和托盘重建 smoke，确认没有留下永久隐藏或意外显示。

## 11. 实施停止条件

出现以下任一情况时，停止扩张并向维护者报告：

- 需要新增共享层、跨层兼容壳或重构整个主题系统才能继续。
- Tauri 当前版本无法可靠标识 command 调用方或无法为窗口代次提供可信绑定。
- 解决首帧必须改变透明窗口、圆角或 Quiet Pro 基线。
- 真实证据表明问题 owner 不在当前窗口生命周期，而在 WebView2/原生合成层且没有无副作用的项目内修复。
- 修复需要改变启动策略、后台销毁时长或用户可见交互，而不再只是修正显示时机。
- 基线测试存在与本项无关的失败，导致无法判断回归归属。

## 12. 最终 Definition of Done

- [x] 第一可见帧在所有必测路径中均为主题正确、样式完整、主框架已挂载的稳定帧。
- [x] 没有正常路径固定延迟，没有显示旁路，没有跨 generation 竞态。
- [x] 静默启动、主动显示、超时降级和销毁重建都保持各自正确语义。
- [x] Rust 单元测试、前端/结构测试、真实 Tauri smoke、完整质量检查全部通过。
- [x] Windows 主题、DPI、WebView2 和故障注入矩阵有可追溯证据。
- [x] 诊断日志足以还原窗口从创建到显示的关键顺序，且不含敏感信息。
- [x] Changelog、提交、Project 协作说明和本文归档均已完成。
