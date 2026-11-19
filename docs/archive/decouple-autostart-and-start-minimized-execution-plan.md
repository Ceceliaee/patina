# 将开机自启动与静默启动设置解耦：已归档执行方案

## 0. 文档状态

- 文档类型：一次性 How-to / 执行单
- 面向对象：Patina 维护者与负责本项实现、验证的协作者
- 对应工作项：GitHub Project draft item「将开机自启动与启动时最小化设置解耦」
- 需求来源：[GitHub Issue #54](https://github.com/Ceceliaee/patina/issues/54) 的第一个问题
- 当前阶段：已完成、已复审、已归档
- 创建日期：2026-07-19
- 长期依据：
  - [`product-principles-and-scope.md`](../product.md)
  - [`roadmap-and-prioritization.md`](../product.md#优先级)
  - [`engineering-quality.md`](../quality.md)
  - [`architecture.md`](../architecture.md)
  - [`issue-fix-boundary-guardrails.md`](../quality.md#修复与回归证据)
  - [`quiet-pro-component-guidelines.md`](../ui.md)

本文是本项实施期间的临时执行依据，不替代上述长期文档。实现与验证完成后，应按第 15 节将本文移入 `docs/archive/`。

### 0.1 最终执行核验

- [x] “开机自启动”与“静默启动”已在 UI、持久化和运行时三层解耦。
- [x] 首装默认继续保持两个开关都开启；没有增加旧配置兼容迁移。
- [x] 用户可见名称最终确认为“静默启动”。
- [x] 中文提示严格为“启动后隐藏主窗口进入托盘。”
- [x] 手动启动和 `--autostart` 使用相同的 `start_minimized` 判定。
- [x] 更新重启、存储重启和设置读取失败保持显示主窗口。
- [x] 隐藏启动固定进入托盘，不显示挂件，并在配置隐藏托盘时提供临时安全入口。
- [x] Settings 真实浏览器回归验证了“关闭开机自启动后仍可启用、保存并重新载入静默启动”。
- [x] 真实 Tauri smoke 在隔离 identifier 和数据目录中验证了首装默认隐藏、原生窗口不可见以及显式恢复后可见。
- [x] `npm test`、`npm run test:replay`、48 项 UI smoke、44 项浏览器 smoke、25 项启动边界 Rust 测试和真实 Tauri runtime smoke 通过。
- [x] 没有修改 Issue #54 的第二个透明未就绪闪屏问题，没有新增 schema、migration 或启动配置档案。
- [x] 独立对抗式审查完成，六项首轮发现和两项复审发现均已修复，最终复审结论为 no findings。
- [x] 执行单已移动到 `docs/archive/`。

下文保留实施前的逐项工作分解作为审计轨迹；本节是实现后的权威完成清单。无法安全自动化的真实 Windows 登录注册没有在用户机器上执行，等价来源判断由 Rust 单元测试覆盖，真实窗口行为由隔离 Tauri runtime smoke 覆盖。

### 0.2 勾选规则

- `[ ]` 表示尚未完成。
- `[x]` 只表示对应行为已经实施并取得要求的验证证据。
- 父级任务只有在所有子任务完成后才能勾选。
- 不得因为代码已经写完，就提前勾选需要真实 Windows 或完整验证链证明的任务。
- 如果实现方案偏离本文已确认决策，应先更新本文并取得维护者确认，再继续实施。

### 0.3 完成时的 Project 现场

2026-07-19 只读核对 live Project 时，发现：

- `In progress`：让 Classification 可管理全部已记录应用
- `In progress`：将开机自启动与启动时最小化设置解耦
- `Next`：增加网站域名历史趋势分析
- `Next`：让 Web Sync 自动识别安装扩展的浏览器

这仍与“同一时间最多保留一个主要 `In progress`”的长期规则冲突。实现、验证和复审已经完成，维护者需要在 Board 视图执行：

- [ ] 将「将开机自启动与启动时最小化设置解耦」从 `In progress` 拖到 `Done`。
- [ ] 保持「让 Classification 可管理全部已记录应用」为唯一的 `In progress`。
- [ ] 将「在 Dashboard 和 History 快捷设置分类与别名」从 `Queued` 拖到 `Next`，与现有两个 `Next` 共同恢复三个事项的窗口。

聊天说明、本文、commit、Issue 状态或本地 checklist 都不能代替 live Project 状态。

### 0.4 实际实现摘要

- 启动决策由 Rust 领域模型统一拥有：手动启动和 `--autostart` 都只依据 `start_minimized` 决定显示或隐藏；更新重启、存储重启和设置恢复显式显示主窗口。
- 原生主窗口始终先以隐藏状态创建，启动设置在窗口创建前同步读取，避免错误首显后再隐藏。
- `launch_at_login` 只负责 Windows 自启动注册；前端仅在持久化设置加载完成后同步该注册状态。
- 隐藏启动固定留在托盘，不显示挂件；配置要求隐藏托盘时，以可逆的安全托盘保证应用仍有恢复入口。
- 更新后的重开意图改为“读取后、启动策略成功应用后再清除”，避免启动中途失败丢失意图。
- 主窗口恢复统一走托盘安全入口，只有窗口确实显示成功后才解除临时安全托盘。

### 0.5 最终验证与审查证据

- `npm test`：通过。
- `npm run test:replay`：15 项通过。
- `npm run test:ui-smoke`：48 项通过。
- `npm run check:types`：通过。
- `npm run check:rust`：通过；Rust 共 423 项通过、1 项忽略，fmt、边界检查和 Clippy 通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --locked app:: --quiet`：25 项启动边界测试通过。
- `npm run test:ui-browser-smoke`：44 项通过，覆盖关闭开机自启动后独立保存并重载静默启动。
- `npm run test:tauri-runtime-smoke`：通过，覆盖原生窗口初始隐藏和显式恢复。
- `git diff --check`：通过。
- `npm run check:full` 在对抗修复前完整通过；最终修复后又分别复验代码边界、类型、浏览器、真实 runtime、完整 Rust 门禁和依赖审计。`npm run check:dependencies` 最终通过：npm 0 vulnerabilities，Rust 0 个 Windows 可达漏洞。
- 独立对抗式审查最终结论：no findings。首轮识别的恢复路径、自启动同步、重开意图、托盘保活与测试空集风险均已修复并复验。
- 没有在用户系统执行真实 Windows 登录注册或重启，以避免改变外部系统状态；来源判定由 Rust 测试覆盖，原生窗口行为由隔离 runtime smoke 覆盖。

---

## 1. 目标

本项要把两个目前被错误耦合的决策拆开：

1. `开机自启动`：Windows 登录后是否自动创建 Patina 进程。
2. `静默启动`（内部字段仍为 `start_minimized`）：Patina 在普通启动后是否隐藏主窗口并进入托盘。

完成后，用户可以关闭开机自启动，同时独立开启启动时最小化。此时用户手动启动 Patina，应用应直接在托盘后台运行，不先显示主窗口。

### 1.1 用户可见结果

- [ ] “静默启动”在“开机自启动”关闭时仍可操作。
- [ ] 两个开关可以独立保存，并在重启后保持。
- [ ] 中文设置项名称为“静默启动”。
- [ ] 中文说明文字严格为“启动后隐藏主窗口进入托盘。”
- [ ] 英文名称与说明表达相同语义，不再出现“仅随开机自启动生效”的说法。
- [ ] 手动启动与开机自启动使用同一套“启动时最小化”偏好。
- [ ] 更新重启、存储位置切换重启等用户明确触发的受控重启仍显示主窗口。
- [ ] 已运行时再次启动 Patina，或从托盘、挂件恢复主窗口时，主窗口可靠显示并获得焦点。
- [ ] 启动时最小化不会显示挂件；“最小化到挂件”只控制用户在运行中手动最小化主窗口的行为。

### 1.2 完成定义

只有同时满足以下条件，本项才算完成：

- [ ] 产品语义与第 3 节一致。
- [ ] 实现职责与第 4 节 owner 边界一致。
- [ ] 第 8 节行为矩阵全部有自动化测试或明确的可重复验证证据。
- [ ] 第 12 节自动化验证全部通过。
- [ ] 第 13 节 Windows 手工回归全部通过。
- [ ] 没有顺带实现 Issue #54 的白闪问题。
- [ ] 没有新增数据库 schema、兼容迁移或启动配置档案。
- [ ] live Project 已按实际结果完成状态调整。

---

## 2. 第一性原理

### 2.1 进程创建与窗口呈现是两个独立问题

操作系统是否启动 Patina，只决定进程是否存在；进程创建后是否展示主窗口，是应用自己的 UI 生命周期决策。两者没有必然依赖关系。

因此，正确模型必须是：

```text
是否由 Windows 登录触发进程
              │
              └── launch_at_login

进程已经启动后，普通启动是否展示主窗口
              │
              └── start_minimized
```

禁止继续使用下面这种耦合模型：

```text
should_hide = launch_at_login && start_minimized
```

正确模型是：

```text
should_hide_regular_start = start_minimized
```

`launch_at_login` 只参与 Windows autostart 注册，不参与普通启动后的主窗口可见性判断。

### 2.2 用户明确触发的受控重启必须保留操作闭环

更新安装、存储目录切换、WebView 缓存操作等流程都由用户在可见界面中明确触发。重启是该操作的后半段，用户需要看到重启已经完成、结果已经生效，或继续处理失败信息。

因此：

```text
普通启动       → 遵守 start_minimized
开机自启动     → 遵守 start_minimized
更新重启       → 强制显示主窗口
存储操作重启   → 强制显示主窗口
设置读取失败   → 强制显示主窗口（fail open）
```

### 2.3 后台启动不能制造不可访问进程

如果主窗口隐藏，用户必须仍然拥有可靠的恢复入口。即使用户配置了“关闭窗口时退出”，启动时最小化也不能产生既无主窗口、又无托盘入口的进程。

因此：

- 后台启动期间必须保证托盘入口可见。
- 用户从托盘打开主窗口后，可以恢复其正常“关闭到托盘 / 关闭后退出”配置语义。
- 托盘创建或隐藏启动准备失败时，必须回退到显示主窗口，而不是继续隐藏。
- 已运行时再次启动 Patina，必须作为显式恢复操作显示主窗口。

### 2.4 “启动时最小化”与“最小化到挂件”不能再次耦合

“最小化到挂件”描述的是用户在应用运行过程中主动最小化主窗口时的去向。“启动时最小化”描述的是进程启动后的初始可见状态。

两个行为发生在不同生命周期阶段，因此：

- 启动时最小化固定进入托盘后台。
- 不因为 `minimize_behavior == widget` 就在启动时显示挂件。
- 手动最小化仍按既有 `taskbar / widget` 设置工作。

### 2.5 设置必须在第一次展示窗口之前生效

如果先创建可见窗口，再异步读取 `start_minimized` 并隐藏窗口，用户仍会看到主窗口闪现。功能表面上“最终隐藏”，但没有满足“直接进入托盘”的要求。

因此，启动顺序必须满足：

```text
初始化存储与 SQLite
    → 读取启动相关设置与重启意图
    → 判定启动来源
    → 计算初始 UI 策略
    → 创建正确初始可见性的主窗口
    → 建立托盘与恢复入口
    → 启动其他运行时任务
```

本项只要求在窗口创建前得到正确可见性决策；不实现主题 ready 信号、WebView 首帧兜底或透明闪屏治理。

---

## 3. 已确认的产品决策

以下决策已经由维护者确认，实施时不再重新解释：

- [x] “开机自启动”与“启动时最小化”是两个独立设置。
- [x] 首次安装继续默认开启“开机自启动”。
- [x] 首次安装继续默认开启“启动时最小化”。
- [x] 不为旧配置增加兼容迁移。
- [x] 不新增“设置是否已显式确认”标记。
- [x] 不新增数据库 schema 或 migration。
- [x] 启动时最小化固定隐藏主窗口并进入托盘，不显示挂件。
- [x] 中文设置项名称最终确认为“静默启动”。
- [x] 中文说明文字为“启动后隐藏主窗口进入托盘。”
- [x] 更新重启和存储操作重启仍显示主窗口，但不把这些例外写成长篇设置说明。
- [x] Issue #54 的白闪问题不在本项处理。

### 3.1 启动来源行为表

| 启动来源 | `start_minimized = false` | `start_minimized = true` |
| --- | --- | --- |
| 手动首次启动 | 显示主窗口 | 隐藏主窗口，进入托盘 |
| Windows 开机自启动 | 显示主窗口 | 隐藏主窗口，进入托盘 |
| 更新安装后的重启 | 显示主窗口 | 显示主窗口 |
| 存储目录或缓存操作重启 | 显示主窗口 | 显示主窗口 |
| 设置读取失败后的恢复启动 | 显示主窗口 | 显示主窗口 |
| 已运行时再次启动 Patina | 显示并聚焦主窗口 | 显示并聚焦主窗口 |
| 用户点击托盘“显示 Patina” | 显示并聚焦主窗口 | 显示并聚焦主窗口 |
| 用户从挂件恢复 | 显示并聚焦主窗口 | 显示并聚焦主窗口 |

### 3.2 设置组合行为表

| `launch_at_login` | `start_minimized` | 手动启动 | Windows 登录启动 |
| --- | --- | --- | --- |
| `false` | `false` | 显示主窗口 | 不自动启动 |
| `false` | `true` | 进入托盘 | 不自动启动 |
| `true` | `false` | 显示主窗口 | 自动启动并显示主窗口 |
| `true` | `true` | 进入托盘 | 自动启动并进入托盘 |

`launch_at_login = false` 不得让 `start_minimized` 失效、被强制改写或无法保存。

---

## 4. Owner 与边界

本项属于跨层启动链路修复，按稳定期守则使用执行单模式。跨层不代表可以任意扩散；每一层只处理自己的事实。

### 4.1 前端 Settings owner

主要文件：

- `src/features/settings/components/Settings.tsx`
- `src/features/settings/components/SettingsResidentPanel.tsx`
- `src/shared/copy/domains/settingsCopy.ts`
- `src/shared/copy/domains/accessibilityCopy.ts`

允许承担：

- 展示两个独立开关。
- 删除“启动时最小化”对“开机自启动”的禁用依赖。
- 展示已确认的中英文名称、说明与无障碍名称。
- 继续使用现有设置保存流程。

禁止承担：

- 自行推断启动来源。
- 直接控制 Tauri 窗口或托盘。
- 在 React 中补一次启动时隐藏。
- 新增页面私有 persistence workaround。

### 4.2 前端 app 启动预热 owner

主要文件：

- `src/app/AppShell.tsx`
- `src/app/services/startupWarmupService.ts`
- `tests/startupWarmupService.test.ts`

允许承担：

- 把当前仅表示 `hidden-autostart` 的命名改成能覆盖手动隐藏启动的中性命名，例如 `hidden-startup`。
- 隐藏启动时继续跳过不必要的重型首屏预热。

禁止承担：

- 判断 autostart 注册状态。
- 决定 Rust 主窗口是否显示。
- 为手动隐藏启动复制第二套 warmup 流程。

### 4.3 Rust domain owner

主要文件：

- `src-tauri/src/domain/settings.rs`

允许承担：

- 定义启动来源的稳定语义。
- 根据 `DesktopBehaviorSettings` 与启动来源返回唯一的启动 UI 策略。
- 保证 `launch_at_login` 不参与启动窗口可见性计算。
- 保证 `minimize_behavior` 不参与启动目的地计算。

建议保持最小改动：在现有 `StartupUiStrategy` 附近定义明确的 `StartupSource`，避免为了单一执行单新增泛化模块。

禁止承担：

- 调用 Tauri API。
- 读取 SQLite。
- 修改托盘或窗口。
- 知道更新器、存储命令的实现细节。

### 4.4 Rust data owner

主要文件：

- `src-tauri/src/data/app_settings_service.rs`
- `src-tauri/src/data/repositories/app_settings.rs`
- `src-tauri/src/data/repositories/update_state.rs`

允许承担：

- 读取已有桌面行为设置。
- 读取并消费已有更新后重开主窗口意图。
- 返回数据事实，不决定窗口策略。

禁止承担：

- 新增兼容迁移。
- 将 `launch_at_login` 与 `start_minimized` 合并成派生值。
- 创建或显示窗口。
- 把启动来源策略写入数据库。

### 4.5 Rust app composition owner

主要文件：

- `src-tauri/src/app/bootstrap.rs`
- `src-tauri/src/app/runtime.rs`
- `src-tauri/src/app/desktop_behavior.rs`
- `src-tauri/src/app/main_window.rs`
- `src-tauri/src/app/tray.rs`

允许承担：

- 在 SQLite 初始化后、主窗口创建前读取启动设置。
- 把 autostart 参数、更新重启意图和存储重启结果归一为启动来源。
- 将 domain 返回的启动 UI 策略应用到窗口、托盘和后台资源生命周期。
- 保证失败时显示主窗口。
- 保证隐藏启动期间有托盘恢复入口。

禁止承担：

- 在 `lib.rs` 增加业务判断。
- 让 `commands/*` 承担启动编排。
- 直接实现 repository 查询。
- 新建第二套窗口生命周期中心。
- 顺带实现 WebView ready 协议或透明闪屏方案。

### 4.6 不应修改的区域

除非实施中出现与本文冲突的新证据，否则本项不应修改：

- `src-tauri/src/engine/tracking/*`
- `src-tauri/src/data/schema.rs` 及数据库 migration
- `src-tauri/tauri.conf.json` 的透明窗口配置
- updater 下载、安装业务流程
- storage migration 的文件迁移业务
- widget 的布局、位置或交互设计
- `src/shared/*` 中与 copy、既有设置类型无关的模块
- 版本号、CHANGELOG 与发布工件

---

## 5. 当前根因清单

实施前先用代码证明根因仍然存在。若仓库已经变化，必须更新本节后再继续。

- [ ] 在 `Settings.tsx` 中确认 `startMinimizedDisabled={!draftSettings.launchAtLogin}` 仍存在。
- [ ] 在 `SettingsResidentPanel.tsx` 中确认 `startMinimizedDisabled` 会传给 `QuietSwitch.disabled`。
- [ ] 在 `domain/settings.rs` 中确认现有判断使用 `launch_at_login && start_minimized`。
- [ ] 确认现有 `startup_ui_strategy` 把普通手动启动固定解释为显示主窗口。
- [ ] 确认现有启动策略会在 `minimize_behavior == widget` 时显示挂件。
- [ ] 在 `runtime.rs` 中确认主窗口初始可见性在设置异步读取前只依据 `launched_by_autostart` 决定。
- [ ] 确认 `desktop_behavior::spawn_sync_from_storage` 在主窗口创建后才读取设置。
- [ ] 确认更新重启意图由 `take_post_install_reopen_main_window` 提供。
- [ ] 确认存储重启由 `handled_storage_restart` 提供。
- [ ] 确认 single-instance 回调、托盘菜单和挂件恢复当前都会调用 `show_main_window`。
- [ ] 确认首装默认值在前端与 Rust 侧均为 `launch_at_login = true`、`start_minimized = true`。

根因可以压缩为三条：

1. UI 把独立设置做成了从属控件。
2. domain 把两个值合并成了同一条件。
3. runtime 在读取真实设置前就决定并创建了可见窗口。

---

## 6. 实施前检查

### 6.1 仓库与授权

- [ ] 运行 `git status --short --branch`，确认工作区状态。
- [ ] 识别所有已有未提交改动，确保不覆盖用户工作。
- [ ] 重新读取本执行单与相关长期文档。
- [ ] 确认用户已经明确授权开始代码实施；仅确认执行方案不等于实施授权。
- [ ] 重新读取 live Project。
- [ ] 如果另一个主要事项仍为 `In progress`，先向维护者报告冲突，不自行切换状态。
- [ ] 当本项真正开始且没有主线冲突时，告诉维护者将本项从 `Next` 拖到 `In progress`。
- [ ] 开始事件发生后，按 Project 手动顺序重新计算最多三个 `Next`，一次报告全部人工拖动建议。

### 6.2 基线验证

- [ ] 运行命中的 Rust domain 测试，记录基线结果。
- [ ] 运行 `tests/uiSmoke.test.ts`，记录基线结果。
- [ ] 运行 `tests/startupWarmupService.test.ts`，记录基线结果。
- [ ] 如果基线失败，先判断是否与本项相关；不得把既有失败伪装成本项回归。
- [ ] 记录当前 `npm run check:full` 是否可在本机完成，以及真实 Tauri smoke 的运行前提。

### 6.3 停止信号

出现以下任一情况时，暂停实施并重新确认：

- [ ] 实现需要新增数据库 migration 或兼容标记。
- [ ] 实现需要更改透明窗口、主题首帧或 WebView ready 协议。
- [ ] 实现需要让页面直接调用窗口、托盘或 SQLite。
- [ ] 实现需要在 `lib.rs`、`commands/*` 或 `shared/*` 增加厚逻辑。
- [ ] 无法在窗口显示前取得可靠的设置值。
- [ ] 无法保证隐藏启动始终有恢复入口。
- [ ] 更新或存储重启来源无法可靠区分。
- [ ] 真实实现要求改变第 3 节已确认产品语义。

---

## 7. 详细执行步骤

## 7.1 阶段一：先把行为契约写成测试

目标：在改生产代码之前，用测试锁定独立设置语义与启动来源优先级。

- [ ] 在 `src-tauri/src/domain/settings.rs` 的测试模块中新增或改写启动策略测试。
  - [ ] 覆盖手动启动、开机自启动、更新重启、存储重启和设置读取失败恢复。
  - [ ] 覆盖 `start_minimized` 的 `true / false`。
  - [ ] 明确断言 `launch_at_login` 不改变手动启动可见性。
  - [ ] 明确断言 `minimize_behavior` 不会让启动策略改为显示挂件。
  - [ ] 明确断言更新重启与存储重启始终显示主窗口。

- [ ] 在 `src-tauri/src/app/bootstrap.rs` 的测试模块中为启动来源归一逻辑补测试。
  - [ ] 无特殊标记时解析为手动启动。
  - [ ] `--autostart` 解析为开机自启动。
  - [ ] 更新重开意图解析为更新重启。
  - [ ] `handled_storage_restart` 解析为存储重启。
  - [ ] 同时存在多个信号时，用户明确触发的重启优先于 autostart 参数。
  - [ ] 设置读取失败走可见恢复策略。

- [ ] 更新 `tests/uiSmoke.test.ts` 的 copy 契约测试。
  - [ ] 中文 label 断言为“静默启动”。
  - [ ] 中文 hint 断言为“启动后隐藏主窗口进入托盘。”
  - [ ] 中文无障碍名称使用“切换静默启动”。
  - [ ] 英文 label、hint 与无障碍名称使用相同独立语义。
  - [ ] 删除“only applies to launch at login”相关断言。

- [ ] 增加结构断言，证明 UI 不再禁用该开关。
  - [ ] `Settings.tsx` 不再传递 `startMinimizedDisabled`。
  - [ ] `SettingsResidentPanel.tsx` 的 props 不再声明该字段。
  - [ ] 对应 `QuietSwitch` 不再由 `launchAtLogin` 控制 `disabled`。

阶段完成判据：

- [ ] 新测试能准确描述第 3 节行为。
- [ ] 在生产代码尚未修改时，至少有针对旧耦合行为的测试按预期失败。
- [ ] 测试失败原因是语义尚未实现，而不是测试环境或无关错误。

## 7.2 阶段二：建立明确的启动来源模型

目标：把多个布尔值改造成可读、可穷举、可测试的启动来源。

- [ ] 在 `domain/settings.rs` 的现有启动策略附近定义最小 `StartupSource`。
- [ ] 至少表达以下来源：
  - [ ] `Manual`
  - [ ] `Autostart`
  - [ ] `UpdateRestart`
  - [ ] `StorageRestart`
  - [ ] 设置读取失败的可见恢复来源或等价显式策略

- [ ] 不用一组新的 `is_xxx: bool` 代替枚举。
- [ ] 不把托盘点击、挂件恢复或 single-instance 激活伪装成进程启动来源；这些是现有窗口恢复动作。
- [ ] 在 `bootstrap.rs` 中建立纯函数，将已有事实归一为 `StartupSource`。
- [ ] 固定来源优先级：
  1. 设置读取失败恢复
  2. 存储操作重启
  3. 更新重启
  4. 开机自启动
  5. 手动启动
- [ ] 保留已有更新重启意图的消费语义，不重复消费或提前清除。
- [ ] 保留存储迁移完成后显示主窗口的现有承诺。

阶段完成判据：

- [ ] runtime 不再通过“autostart 布尔值 + reopen 布尔值”的组合猜测启动来源。
- [ ] 启动来源的每个变体都有单元测试。
- [ ] 归一逻辑是纯判断，不调用窗口、托盘或数据库 API。

## 7.3 阶段三：解耦 domain 设置语义

目标：让启动 UI 策略只根据 `start_minimized` 与启动来源决定。

- [ ] 删除或重命名 `should_start_minimized_on_autostart`，不得继续返回 `launch_at_login && start_minimized`。
- [ ] 让 `startup_ui_strategy` 接收明确的 `StartupSource`。
- [ ] 普通手动启动和开机自启动采用相同规则：
  - [ ] `start_minimized = false` → 显示主窗口。
  - [ ] `start_minimized = true` → 隐藏主窗口并进入托盘。
- [ ] 更新重启、存储重启和恢复启动始终返回显示主窗口。
- [ ] 启动策略不读取 `launch_at_login`。
- [ ] 启动策略不读取 `minimize_behavior`。
- [ ] 如果现有 `StartupUiStrategy::ShowWidget` 只服务启动路径，将其从启动策略中移除。
- [ ] 如果 `KeepHiddenMainWindow / OptimizeHiddenMainWindow` 仍需区分后台资源策略，保留最小必要变体，但使用中性“托盘启动”语义命名。
- [ ] 不改变 `with_launch_behavior` 的独立字段保存能力。
- [ ] 保持前端与 Rust 的首装默认值均为 `true / true`。

阶段完成判据：

- [ ] `launch_at_login` 只影响 autostart 注册。
- [ ] `start_minimized` 只影响普通启动后的初始 UI。
- [ ] `minimize_behavior` 只影响运行中的手动最小化。
- [ ] 第 7.1 节 domain 测试全部通过。

## 7.4 阶段四：把设置读取移动到窗口创建之前

目标：消除“先显示，再异步隐藏”的错误时序。

- [ ] 在 `bootstrap.rs` 的 setup 链中保持以下前置顺序：
  - [ ] 先处理待执行的存储迁移。
  - [ ] 再初始化 SQLite pool。
  - [ ] 再读取 `DesktopBehaviorStartupState`。
  - [ ] 再归一启动来源。
  - [ ] 最后调用 runtime 窗口与托盘装配。

- [ ] 将已加载的 `DesktopBehaviorSettings` 与 `StartupSource` 作为明确启动上下文传给 `runtime::setup` 或等价 app 组合入口。
- [ ] 不让 `runtime::setup` 再次从 repository 重复读取同一启动设置。
- [ ] 删除或收口当前晚于窗口创建的 `spawn_sync_from_storage` 启动同步路径。
- [ ] 保留运行期间前端设置保存后的现有 runtime 同步命令；不要误删 `cmd_set_launch_behavior`。
- [ ] 设置读取成功后，在创建主窗口前更新 `DesktopBehaviorState`。
- [ ] 设置读取失败时：
  - [ ] 记录清晰错误日志。
  - [ ] 使用可见恢复策略。
  - [ ] 不因为默认 `start_minimized = true` 而隐藏窗口。
  - [ ] 不让整个应用因非结构性设置读取失败变成不可访问后台进程。

阶段完成判据：

- [ ] 第一次调用 `ensure_main_window_with_initial_visibility` 前，真实设置与启动来源都已确定。
- [ ] 普通隐藏启动从未创建过可见主窗口。
- [ ] 不存在随后才纠正初始可见性的异步竞态。
- [ ] 更新重启意图只消费一次。

## 7.5 阶段五：应用窗口与托盘启动策略

目标：让正确策略在 Tauri 生命周期中可靠落地，并保留恢复入口。

- [ ] runtime 根据 domain 策略决定主窗口初始可见性。
- [ ] 可见启动：
  - [ ] 创建或确保主窗口可见。
  - [ ] 更新 `MainWindowLifecycleState` 的 desired-visible 语义。
  - [ ] 保持既有聚焦与前台恢复行为。
- [ ] 托盘启动：
  - [ ] 主窗口以不可见状态创建，或按现有安全路径保持隐藏。
  - [ ] 不调用显示主窗口后再隐藏的路径。
  - [ ] 不显示 widget。
  - [ ] 按 `background_optimization` 决定是否调度隐藏主窗口资源释放。

- [ ] 为隐藏启动增加安全托盘规则。
  - [ ] 在主窗口不可见期间确保托盘图标可见。
  - [ ] 此安全规则不依赖 `close_behavior == tray`。
  - [ ] 用户从托盘显示主窗口后，重新应用其正常托盘可见性设置。
  - [ ] `close_behavior == exit` 时，显示主窗口后仍保持既有关闭退出语义。

- [ ] 处理失败回退。
  - [ ] 托盘创建失败时停止隐藏启动并显示主窗口，或让 setup 明确失败退出；不得留下无入口进程。
  - [ ] 隐藏生命周期登记失败且主窗口未被其他动作显示时，回退到显示主窗口。
  - [ ] 恢复入口失败时写入可定位日志。

- [ ] 保留显式恢复路径。
  - [ ] single-instance 回调始终显示主窗口。
  - [ ] 托盘菜单和托盘点击始终显示主窗口。
  - [ ] widget 关闭或恢复始终显示主窗口。
  - [ ] 隐藏窗口因资源优化被销毁后，恢复动作能重建并显示主窗口。

阶段完成判据：

- [ ] 所有隐藏启动都有托盘入口。
- [ ] 隐藏启动不显示 widget。
- [ ] 所有显式恢复动作都能覆盖 `start_minimized = true`。
- [ ] `close_behavior`、`minimize_behavior` 与后台资源优化的既有运行期行为没有回归。

## 7.6 阶段六：解除设置界面耦合

目标：让 UI 准确呈现已经独立的产品语义。

- [ ] 修改 `Settings.tsx`。
  - [ ] 删除 `startMinimizedDisabled={!draftSettings.launchAtLogin}`。
  - [ ] 保留 `startMinimizedChecked` 与 `onStartMinimizedChange`。
  - [ ] 不在关闭 `launchAtLogin` 时自动改写 `startMinimized`。

- [ ] 修改 `SettingsResidentPanel.tsx`。
  - [ ] 删除 `startMinimizedDisabled` prop。
  - [ ] 删除传给 `QuietSwitch` 的对应 `disabled`。
  - [ ] 保持 QuietSwitch 现有 default、hover、active、focus 和 disabled 原型，不新增局部样式。

- [ ] 修改中文 copy。
  - [ ] label：`静默启动`
  - [ ] hint：`启动后隐藏主窗口进入托盘。`
  - [ ] accessibility：使用“切换静默启动”。

- [ ] 修改英文 copy。
  - [ ] label：`Start minimized`
  - [ ] hint：`Hide the main window and start in the tray.`
  - [ ] accessibility：`Toggle start minimized`

- [ ] 不增加解释更新重启、存储重启例外的长文案。
- [ ] 不增加新的 badge、tooltip、dialog 或一页专用视觉样式。
- [ ] 确认中英文 copy key 结构继续一致。

阶段完成判据：

- [ ] 关闭“开机自启动”后，“启动时最小化”仍可点击。
- [ ] 四种设置组合都能形成独立 draft patch。
- [ ] 保存、取消与重新载入行为复用现有设置页流程。
- [ ] UI 与 Quiet Pro 基线一致，没有新增视觉角色。

## 7.7 阶段七：收口误导性命名

目标：避免手动隐藏启动进入一条仍叫“hidden autostart”的前端路径。

- [ ] 检查 `src/app/AppShell.tsx` 对 `document.visibilityState` 的启动模式判断。
- [ ] 将 `hidden-autostart` 改为中性、准确的 `hidden-startup` 或等价名称。
- [ ] 同步修改 `startupWarmupService.ts` 类型与条件分支。
- [ ] 同步修改 `tests/startupWarmupService.test.ts`。
- [ ] 保持现有隐藏启动优化：跳过不必要的 chunk 与重型 read model 预热。
- [ ] 不新增一条仅供手动隐藏启动使用的重复 warmup 分支。
- [ ] 搜索仓库，确认用户可见 copy、测试名称和日志中不再把隐藏启动等同于 autostart。

阶段完成判据：

- [ ] 隐藏启动路径命名可同时覆盖手动启动与开机自启动。
- [ ] 原有 warmup 性能行为保持不变。

## 7.8 阶段八：补齐自动化回归

目标：不仅证明纯函数正确，还证明真实 Tauri 启动时序正确。

- [ ] Rust domain 测试覆盖第 3.1 节全部来源。
- [ ] Rust app 测试覆盖启动来源优先级与 fail-open。
- [ ] UI smoke 覆盖 copy 与解除 disabled 结构。
- [ ] 浏览器 settings 场景覆盖：
  - [ ] 关闭“开机自启动”。
  - [ ] 确认“静默启动”仍 enabled。
  - [ ] 独立切换并保存。
  - [ ] 重新载入后保持。
  - [ ] 中英文切换后 label、hint 与无障碍名称正确。

- [ ] 扩展真实 Tauri runtime smoke 或增加相邻的聚焦 smoke。
  - [ ] 使用隔离的临时数据目录。
  - [ ] 不污染真实 autostart 注册、真实数据库或真实 WebView 数据目录。
  - [ ] 复用现有 `PATINA_E2E_*` 隔离机制。
  - [ ] 至少验证一个可见普通启动与一个隐藏普通启动。
  - [ ] 验证隐藏启动期间原生主窗口不可见、托盘恢复后可见。
  - [ ] 验证 `--autostart` 与手动启动在相同设置下得到相同策略。
  - [ ] 验证显式更新/存储重启意图覆盖隐藏偏好。
  - [ ] 验证第二次启动或等价显式恢复动作能显示主窗口。
  - [ ] 测试结束后确认临时目录、进程与 WebView2 子进程清理完成。

- [ ] 如果真实 runtime smoke 无法稳定自动检查 Windows 原生窗口可见性：
  - [ ] 不用 DOM `visibilityState` 冒充原生窗口证据。
  - [ ] 优先使用按进程 PID 查询 HWND 与 `IsWindowVisible` 的测试 helper。
  - [ ] 若仍不可自动化，记录边界原因，并用第 13 节可重复人工步骤补齐证据。

阶段完成判据：

- [ ] 测试保护的是用户行为，而不只是函数名或源码正则。
- [ ] 新增的真实 runtime 测试进入现有执行图。
- [ ] 没有用临时 allowlist 绕过架构或 IPC 门禁。

---

## 8. 验收矩阵

实施者应逐项记录“自动化测试名称”或“人工验证证据”。没有证据的行不能勾选。

### 8.1 设置组合

- [ ] `launch=false, minimized=false`：手动启动显示主窗口；Windows 不自动启动。
- [ ] `launch=false, minimized=true`：手动启动不显示主窗口，托盘可恢复；Windows 不自动启动。
- [ ] `launch=true, minimized=false`：手动启动与 Windows 登录启动均显示主窗口。
- [ ] `launch=true, minimized=true`：手动启动与 Windows 登录启动均直接进入托盘。

### 8.2 启动来源

- [ ] 手动启动遵守 `start_minimized`。
- [ ] `--autostart` 启动遵守 `start_minimized`，不额外依赖 `launch_at_login`。
- [ ] 更新重启忽略隐藏偏好并显示主窗口。
- [ ] 存储目录切换重启忽略隐藏偏好并显示主窗口。
- [ ] WebView 缓存相关受控重启忽略隐藏偏好并显示主窗口。
- [ ] 设置读取失败时显示主窗口并留下诊断日志。

### 8.3 恢复入口

- [ ] 隐藏启动时托盘图标可见。
- [ ] 单击或双击托盘可显示并聚焦主窗口。
- [ ] 托盘菜单“显示 Patina”可显示并聚焦主窗口。
- [ ] 已运行时再次启动 Patina 可显示并聚焦主窗口。
- [ ] 主窗口被后台资源优化销毁后，托盘恢复可重建窗口。
- [ ] widget 恢复路径不受启动偏好影响。
- [ ] `close_behavior=exit` 与隐藏启动组合不会产生不可访问进程。

### 8.4 与其他设置的正交性

- [ ] `minimize_behavior=taskbar` 不改变启动目的地。
- [ ] `minimize_behavior=widget` 不会在启动时显示 widget。
- [ ] `background_optimization=false` 时隐藏主窗口保留资源，但仍可恢复。
- [ ] `background_optimization=true` 时隐藏主窗口可按既有时序释放资源并恢复。
- [ ] `close_behavior=tray` 保持既有关闭到托盘行为。
- [ ] `close_behavior=exit` 保持既有关闭退出行为。

### 8.5 设置界面

- [ ] “静默启动”永远不是因“开机自启动”关闭而 disabled。
- [ ] 两个开关可按任意顺序切换。
- [ ] 保存后只提交实际变化的 patch。
- [ ] 取消后两个开关都恢复保存值。
- [ ] 重启后两个值独立保持。
- [ ] 中文文案完全符合已确认文本。
- [ ] 英文文案准确、简短且 key 结构一致。

---

## 9. 文件级修改清单

实际 diff 可能少于本清单，但不应无理由扩大到清单外 owner。

### 9.1 预期修改

- [ ] `src-tauri/src/domain/settings.rs`
  - 启动来源、策略语义与 domain 测试。
- [ ] `src-tauri/src/app/bootstrap.rs`
  - 设置预读、来源归一、受控重启优先级与测试。
- [ ] `src-tauri/src/app/runtime.rs`
  - 使用预计算启动上下文创建正确初始可见性的窗口。
- [ ] `src-tauri/src/app/desktop_behavior.rs`
  - 应用预加载设置，移除晚到的启动同步，落实托盘启动策略。
- [ ] `src-tauri/src/app/main_window.rs`
  - 仅在需要时调整初始生命周期登记与显式恢复。
- [ ] `src-tauri/src/app/tray.rs`
  - 仅在需要时增加隐藏启动安全托盘与恢复后配置回归。
- [ ] `src/features/settings/components/Settings.tsx`
  - 移除 disabled 依赖。
- [ ] `src/features/settings/components/SettingsResidentPanel.tsx`
  - 移除 disabled prop 与控件禁用。
- [ ] `src/shared/copy/domains/settingsCopy.ts`
  - 中英文 label 与 hint。
- [ ] `src/shared/copy/domains/accessibilityCopy.ts`
  - 中英文无障碍名称。
- [ ] `src/app/AppShell.tsx`
  - 隐藏启动模式的中性命名。
- [ ] `src/app/services/startupWarmupService.ts`
  - 中性模式名及分支。
- [ ] `tests/startupWarmupService.test.ts`
  - 对应模式测试。
- [ ] `tests/uiSmoke.test.ts`
  - copy、结构与重启语义保护。
- [ ] `tests/uiBrowserSmoke/settingsScenarios.ts`
  - 真实浏览器中的独立开关行为。
- [ ] `tests/tauriRuntimeSmoke.test.ts` 或相邻聚焦 smoke
  - 真实启动时序与窗口/托盘证据。

### 9.2 原则上不修改

- [ ] `src-tauri/src/lib.rs` 保持薄装配入口。
- [ ] `src-tauri/src/commands/settings.rs` 保持 IPC 转发；除非契约真的变化，否则不改。
- [ ] `src-tauri/src/data/repositories/app_settings.rs` 不增加迁移；现有独立字段读取已足够时不改。
- [ ] `src-tauri/src/data/repositories/update_state.rs` 保持现有更新重开意图语义。
- [ ] `src-tauri/src/commands/storage.rs` 保持现有受控重启业务流程。
- [ ] `src-tauri/tauri.conf.json` 不处理透明窗口或背景色。
- [ ] 不新增 `src/lib/*`、`src/types/*` 或临时 shared helper。

---

## 10. 风险、诊断与回滚

### 10.1 风险一：隐藏但无入口

触发方式：`start_minimized=true`，同时正常托盘配置为隐藏或托盘创建失败。

- [ ] 实现安全托盘覆盖。
- [ ] 覆盖 `close_behavior=exit` 组合测试。
- [ ] 托盘失败时回退显示主窗口。
- [ ] 日志包含启动来源、策略与恢复结果。

### 10.2 风险二：设置读取太晚

触发方式：主窗口已经可见后才异步读取设置。

- [ ] 用代码顺序与 runtime 测试证明设置在窗口创建前读取。
- [ ] 删除晚到纠正路径，避免保留两套启动决策中心。
- [ ] 不用固定延迟隐藏窗口。

### 10.3 风险三：受控重启被隐藏

触发方式：更新或存储重启携带 autostart 参数，普通隐藏偏好错误覆盖用户操作意图。

- [ ] 固定启动来源优先级。
- [ ] 保留并测试更新重开意图。
- [ ] 保留并测试 `handled_storage_restart`。

### 10.4 风险四：启动时错误显示 widget

触发方式：继续复用旧 `minimize_behavior` 分支。

- [ ] domain 测试证明两种 minimize behavior 得到相同启动策略。
- [ ] runtime 测试证明启动时不创建 widget。

### 10.5 风险五：首装默认值不一致

触发方式：前端 default 与 Rust default 分别演进。

- [ ] 测试或静态检查确认两侧均为 `true / true`。
- [ ] 不增加兼容 migration。
- [ ] 不把默认值偷偷改成 `false` 规避测试。

### 10.6 回滚原则

如果实施后发现严重回归：

- [ ] 优先回滚本项行为改动，不修改或清理用户数据库值。
- [ ] 保留 `launch_at_login` 与 `start_minimized` 原始持久化字段。
- [ ] 不执行破坏性数据修复，因为本项没有数据迁移。
- [ ] 若回滚后 Project item 仍未完成，向维护者建议保持或恢复为 `In progress`；只有无法继续且存在明确外部依赖时才建议 `Blocked`。
- [ ] 记录触发回滚的场景与缺失测试，再更新执行单后继续。

---

## 11. 诊断要求

本项不要求建设完整启动遥测，但关键失败必须可定位。

- [ ] 启动日志能够区分：manual、autostart、update restart、storage restart、settings recovery。
- [ ] 日志记录最终 UI 策略：show main 或 start in tray。
- [ ] 设置读取失败日志包含可理解的阶段信息，但不输出敏感设置内容。
- [ ] 托盘安全覆盖或失败回退有明确日志。
- [ ] widget 不应出现在启动策略日志中。
- [ ] 不记录 WebDAV token、Web Sync token、窗口标题或其他隐私内容。
- [ ] 日志只服务诊断，不成为决定行为的隐藏状态。

---

## 12. 自动化验证清单

按从快到慢的顺序执行。任何一步失败都应先定位，不能直接跳到下一步并宣布完成。

### 12.1 专项验证

- [ ] 运行 Rust 启动设置与 bootstrap 相关单元测试。
- [ ] 运行 `tests/startupWarmupService.test.ts`。
- [ ] 运行 `tests/uiSmoke.test.ts`。
- [ ] 运行 Settings 浏览器 smoke 场景。
- [ ] 运行新增的启动策略聚焦 runtime smoke。

### 12.2 仓库默认验证

- [ ] 运行 `npm test`。
- [ ] 运行 `npm run test:replay`。
- [ ] 运行 `npm run build`。
- [ ] 运行 `npm run check`。

### 12.3 Rust 与边界验证

- [ ] 运行 `npm run check:rust-boundaries:self-test`。
- [ ] 运行 `npm run check:rust-boundaries`。
- [ ] 运行 `npm run check:ipc-contracts:self-test`。
- [ ] 运行 `npm run check:ipc-contracts`。
- [ ] 运行 `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`。
- [ ] 运行 `cargo check --manifest-path src-tauri/Cargo.toml --locked --quiet`。
- [ ] 运行 `cargo test --manifest-path src-tauri/Cargo.toml --locked --quiet`。
- [ ] 运行 `cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings`。
- [ ] 运行 `npm run check:full`。

### 12.4 真实桌面 runtime

- [ ] 在 Windows 运行 `npm run test:tauri-runtime-smoke`。
- [ ] 确认 smoke 使用隔离数据目录与独立 identifier。
- [ ] 确认测试未注册真实 debug autostart 路径。
- [ ] 确认 smoke 后没有残留 Patina、WebView2 或 Vite 进程。
- [ ] 确认临时目录清理成功。

### 12.5 结果记录

- [ ] 在实现交付说明中列出实际运行的命令。
- [ ] 对每个失败或跳过项说明原因与风险。
- [ ] 不把类型检查、源码正则或 DOM 存在当成真实窗口可见性证据。
- [ ] 所有必要验证通过前，不建议 Project 进入 `Done`。

---

## 13. Windows 手工回归步骤

真实 autostart 注册在 debug 构建中受到保护，因此至少需要一次安装版或等价 release 环境验证。

### 13.1 准备

- [ ] 使用不会覆盖重要用户数据的测试环境或备份后的本地环境。
- [ ] 确认系统托盘允许找到 Patina 图标。
- [ ] 记录当前四个相关设置：开机自启动、启动时最小化、关闭到托盘、最小化到挂件。
- [ ] 确认可以通过任务管理器结束测试进程。

### 13.2 手动启动组合

- [ ] 关闭开机自启动，关闭启动时最小化，退出后手动启动：主窗口显示。
- [ ] 关闭开机自启动，开启启动时最小化，退出后手动启动：主窗口从未显示，托盘出现。
- [ ] 从托盘显示 Patina：主窗口显示并聚焦。
- [ ] 在应用已隐藏运行时再次启动 Patina：现有主窗口显示并聚焦，不产生第二实例。

### 13.3 开机自启动组合

- [ ] 开启开机自启动，关闭启动时最小化，重新登录：Patina 自动启动并显示主窗口。
- [ ] 开启开机自启动，开启启动时最小化，重新登录：Patina 自动启动到托盘，主窗口不闪现。
- [ ] 登录后从托盘恢复：主窗口可靠显示。

### 13.4 正交设置

- [ ] 开启“最小化到挂件”后执行隐藏启动：启动时不显示挂件。
- [ ] 启动后打开主窗口，再手动最小化：仍按“最小化到挂件”显示挂件。
- [ ] 关闭“关闭到托盘”并开启启动时最小化：启动时仍有临时安全托盘入口。
- [ ] 从安全托盘打开主窗口后关闭窗口：应用按“关闭后退出”结束。
- [ ] 开启低耗后台：隐藏足够时长后仍能从托盘重建主窗口。

### 13.5 受控重启

- [ ] 开启启动时最小化后执行更新重启：重启后主窗口显示。
- [ ] 开启启动时最小化后执行数据目录切换并立即重启：重启后主窗口显示。
- [ ] 开启启动时最小化后执行 WebView 缓存相关立即重启：重启后主窗口显示。
- [ ] 每个流程只启动一个新实例，没有重复窗口。

### 13.6 失败恢复

- [ ] 模拟或使用测试注入让设置读取失败：应用显示主窗口并记录错误。
- [ ] 验证托盘恢复失败不会让进程永久隐藏。
- [ ] 验证任务管理器中没有测试结束后的残留进程。

手工回归只验证本项行为；白闪、透明未就绪首帧应记录到独立 Project item，不在本项扩展 scope。

---

## 14. Project 检查点与交付

### 14.1 开始实施

- [ ] 重新读取 live Project。
- [ ] 确认当前唯一主要 `In progress`。
- [ ] 如果维护者决定暂停其他主线并开始本项，明确报告所有需要的人工拖动。
- [ ] 本项实际开始后，建议将其拖到 `In progress`。
- [ ] 按手动顺序重新计算三个 `Next`，不凭本地文档猜测。

### 14.2 实施中

- [ ] 每次发现阻塞时判断它是否是真正未满足的前置条件。
- [ ] 只有真正无法继续时才建议 `In progress → Blocked`。
- [ ] 修复普通测试失败不等于进入 `Blocked`。
- [ ] 如果 scope 需要扩大，先更新本文并取得维护者确认。

### 14.3 完成

- [ ] 代码实现完成。
- [ ] 自动化验证完成。
- [ ] Windows 手工回归完成。
- [ ] 重新读取 live Project。
- [ ] 告诉维护者将本项从 `In progress` 拖到 `Done`。
- [ ] 根据实时手动顺序重新计算三个 `Next`，一次报告所有补位或降级操作。
- [ ] 明确说明 GitHub Issue #54 尚包含第二个白闪问题；除非维护者另行授权，不关闭或修改 Issue。

### 14.4 Git 与提交边界

- [ ] 在提交前检查 `git diff --stat` 与实际文件范围。
- [ ] 确认没有混入与本项无关的用户改动。
- [ ] 如果用户要求推送，按仓库规则检查 staged stat 与 numstat。
- [ ] commit 只引用 Issue，例如 `Refs #54`；不使用 `Closes`、`Fixes` 或 `Resolves`。
- [ ] 未经明确要求不创建分支或 Pull Request。
- [ ] 未经明确要求不关闭、重开或修改 Issue。

---

## 15. 文档退出条件

本文不应长期留在 `docs/working/`。

### 15.1 实现完成后

- [ ] 更新本文的最终结果摘要，记录实际方案与验证证据。
- [ ] 删除已经失真的候选步骤，不把未采用方案留作当前指令。
- [ ] 将本文移动到 `docs/archive/`。
- [ ] 如果实施改变了长期规则，只更新对应顶层母文档，不把长期规则仅留在归档执行单中。

### 15.2 方案被取消或替代后

- [ ] 标注取消原因或替代文档。
- [ ] 将本文移动到 `docs/archive/`。
- [ ] 不在顶层 `docs/` 新增同类一次性计划。

---

## 16. 最终复核清单

交付前由实施者逐项回答：

- [ ] 两个设置是否在 UI、持久化与 runtime 三层都真正独立？
- [ ] 手动启动是否在主窗口第一次显示前就读取了 `start_minimized`？
- [ ] `launch_at_login` 是否只控制 Windows autostart 注册？
- [ ] `minimize_behavior` 是否只控制运行中的手动最小化？
- [ ] 更新与存储重启是否始终显示主窗口？
- [ ] 设置读取失败是否 fail open？
- [ ] 隐藏启动是否始终有托盘恢复入口？
- [ ] 已运行时再次启动是否能显示并聚焦主窗口？
- [ ] 是否没有实现白闪治理、主题 ready 协议或固定延迟？
- [ ] 是否没有新增 migration、兼容标记或启动配置档案？
- [ ] 是否没有让 `lib.rs`、`commands/*`、`shared/*` 或页面层重新变厚？
- [ ] 是否通过了与风险匹配的完整验证？
- [ ] 是否按 live Project 事实报告了状态与 `Next` 调整？
- [ ] 是否准备在完成后归档本文？

只有全部答案为“是”，本项才能被视为真正完成。
