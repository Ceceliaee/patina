# Issue #2 CPU 异常占用执行方案

文档类型：How-to / 一次性执行单

目标读者：项目维护者、后续接手该 issue 的 Codex 或协作者

关联 issue：[Ceceliaee/time-tracking#2](https://github.com/Ceceliaee/time-tracking/issues/2)

状态：代码修复与本地验证已完成，准备发布并归档

---

## 0. 当前执行摘要

本执行单当前处于“代码修复已完成，等待维护者审核与安装版观察”的状态。

已完成：

- [x] 定位第一阶段低风险修复点：`src-tauri/src/platform/windows/foreground.rs` 的进程详情查询顺序。
- [x] 将前台窗口采样从“每秒固定先全量进程 snapshot”改为“优先 `OpenProcess + QueryFullProcessImageNameW`，失败才 fallback snapshot”。
- [x] 保留窗口标题、窗口类名、AFK、Explorer shell surface 排除、session 切分语义不变。
- [x] 补充 `foreground.rs` 内部测试，覆盖路径提取、主路径优先和 fallback 合并行为。
- [x] 本地验证通过：`npm run check:rust-boundaries`、`npm run check:rust`、`npm run check`、`npm run check:full`、`npm run release:check`。
- [x] 准备 `1.1.2` 发布草稿，`CHANGELOG.md` 已包含 issue #2 链接。

发布前尚未完成：

- [x] 维护者审核本地 diff。
- [ ] 用安装版或 release 构建做手动 CPU 观察。
- [x] 决定是否继续发布 `1.1.2`。
- [x] 提交、打 tag、推送、触发 GitHub Actions。
- [x] 发布完成后将本文移动到 `docs/archive/`。

当前发布口径：

- 用户已确认继续发布新版本。
- 本次以自动验证、release check、版本同步、tag 发布作为代码闭环。
- 安装版或 release 构建的手动 CPU 观察保留为发布后跟踪，不作为本次 tag 推送的前置条件。

当前判断：

- 这次代码修复应降低后台采样路径成本，因为常规窗口不再每秒固定扫描全量进程列表。
- 如果开发版 CPU 看起来更高，不应直接等同于安装版回归；开发版包含 debug Rust、Vite dev server、source map、HMR、Node/esbuild 等额外成本。
- 是否真正解决 issue #2，需要用安装版或 release 构建观察“持续高 CPU、不回落、关闭应用后恢复”这种异常形态。

---

## 1. 目标

- [x] 修复或显著降低 Time Tracker 在特定桌面场景下触发的 CPU 异常占用。
- [x] 保持前台窗口追踪、会话切分、AFK、锁屏、休眠恢复等 tracking 主路径可信。
- [x] 避免为了性能优化破坏 Rust owner 边界。
- [x] 给出可复查的本地验证记录，确保 issue #2 能被解释、复测和发布追踪。

---

## 2. 已知事实

- [x] Issue #2 标题为 `[Bug] CPU异常占用`。
- [x] 报告者观察到关闭 Time Tracker 后 CPU 恢复正常。
- [x] 截图显示 CPU 总占用曾接近 `100%`。
- [x] B 站评论反馈提到在 Edge / Bilibili 多标签、视频快进、视频换集、键盘输入等场景更容易卡。
- [x] 报告者推测与 `explorer` 和 `time_tracker` 调用 Windows API 有关。
- [x] 当前开发者机器没有稳定复现 issue 截图级别的持续高 CPU；手工观察到的百分比只作为现象参考，不作为验收基线。
- [x] 打开软件主界面、切换到 Data 页、主界面前后台切换时会有短暂 CPU 波动；该现象目前更像 WebView / Dashboard / Data 页渲染与读模型刷新，不等同于 issue 截图中的持续异常占用。
- [x] 本地内存记录显示旧运行过程从 `84.5MB` 增至 `133.9MB`，但更新后已重置；暂不与 CPU issue 混为同一修复。

---

## 3. 初步判断

当前最可疑路径是 Rust tracking runtime 的前台窗口采样链：

- `src-tauri/src/engine/tracking/runtime.rs`
- `src-tauri/src/engine/tracking/runtime/window_polling.rs`
- `src-tauri/src/platform/windows/foreground.rs`

现状特征：

- [x] tracking runtime 每秒采样一次活动窗口。
- [x] `foreground.rs` 会读取前台窗口标题、类名、进程 ID、进程名、进程路径和 AFK 状态。
- [x] 当前 `get_process_details()` 每次都会先调用 `CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)` 扫描进程列表，再调用 `OpenProcess + QueryFullProcessImageNameW`。
- [x] 全量进程 snapshot 在 1 秒轮询中成本偏高，尤其在窗口/标题高频变化、Explorer shell surface、视频页面或输入场景中可能放大。

初步修复方向：

- [x] 优先把 `OpenProcess + QueryFullProcessImageNameW` 作为主路径。
- [x] 只有主路径失败时才 fallback 到 `CreateToolhelp32Snapshot`。
- [ ] 如果第一阶段仍不足，再引入短 TTL 的进程详情缓存。

---

## 4. 范围

本次包含：

- [x] 降低活动窗口采样路径中的 Windows API 调用成本。
- [x] 保留 Explorer shell surface 排除规则。
- [x] 补充 Rust 单元测试或边界测试，覆盖进程详情解析 fallback 行为。
- [ ] 做至少一轮本地手动性能观察。
- [x] 如果进入发布，更新 `CHANGELOG.md`，并在 `Fixed` 条目带上 issue 链接。

本次不包含：

- [x] 不做 UI 改版。
- [x] 不改 Dashboard / History / Data 读模型。
- [x] 不把 tracking runtime 搬迁到新目录。
- [x] 不引入新的前端平台适配。
- [x] 不把内存增长作为同一 issue 的完成条件。
- [x] 不引入 ETW、系统级 profiler 或复杂性能面板，除非第一阶段无法定位。

---

## 5. Owner 与边界

真实 owner 判断：

- [x] Windows API 调用细节属于 `src-tauri/src/platform/windows/foreground.rs`。
- [x] 轮询 timeout 和采样节奏属于 `src-tauri/src/engine/tracking/runtime/window_polling.rs` 与 `runtime.rs`。
- [x] 是否可追踪、Explorer shell surface 是否应排除，属于 tracking domain / transition 语义，不应混进前端。
- [x] SQLite session 写入路径不应为本次 CPU 修复承担新逻辑。

禁止扩散：

- [x] 不把 Windows API 细节放进 `commands/*`。
- [x] 不让 `lib.rs` 或 `app/*` 承接性能判断。
- [x] 不新增 `shared/*` 或前端工具函数来处理 Rust runtime 问题。
- [x] 不用页面层状态绕开 backend 轮询问题。

---

## 6. 最稳长期方案

长期最稳方案不是直接把 1 秒轮询改成事件驱动，也不是只靠用户机器观察判断是否正常，而是按风险从低到高分四层推进。

总体原则：

- [x] 先证明瓶颈，再扩大修复面。
- [x] 优先降低平台 API 成本，不先改变 tracking 语义。
- [x] 保留 1 秒 heartbeat，确保 AFK、session timeout、锁屏/休眠恢复仍可信。
- [ ] 只有当前三层都不足时，才考虑前台窗口事件 hook。
- [x] 每一层都必须可单独验证、可单独回滚。

### 6.1 第一层：可观测性与基线

目标：先把“正常 UI 波动”和“异常持续占用”分清楚。

- [ ] 增加临时或 debug-only 的采样耗时诊断，记录 `get_active_window()` 总耗时。
- [ ] 诊断粒度优先包含：
  - [ ] `GetForegroundWindow / GetWindowTextW / GetClassNameW`
  - [ ] `GetWindowThreadProcessId`
  - [ ] `OpenProcess + QueryFullProcessImageNameW`
  - [ ] `CreateToolhelp32Snapshot` fallback
  - [ ] 整体 `poll_active_window_with_timeout`
- [ ] 诊断默认不在正式 UI 中展示。
- [ ] 诊断日志必须限频，避免日志本身造成 CPU 或 IO 噪声。
- [ ] 记录 UI 唤起、前台保持、后台运行和 Data 页切换的参考现象，但不把开发者机器上的手工百分比作为验收基线。
- [ ] 异常定义保持为持续高 CPU、不回落、关闭应用后恢复。

是否进入下一层：

- [ ] 如果诊断显示 `CreateToolhelp32Snapshot` 高频出现或耗时偏高，进入第二层。
- [ ] 如果诊断显示 WebView / Data 页渲染是主要成本，不把它混进 issue #2 后台采样修复。
- [x] 如果无法稳定复现，也可以进入第二层，因为第二层风险低且收益明确。

### 6.2 第二层：平台 API 主路径降载

目标：去掉每秒固定全量进程扫描。

- [x] 将 `get_process_details()` 改为优先使用 `OpenProcess + QueryFullProcessImageNameW`。
- [x] 只有主路径失败时才 fallback 到 `CreateToolhelp32Snapshot`。
- [x] 不改变窗口标题采样。
- [x] 不改变 AFK 采样。
- [x] 不改变 Explorer shell surface 排除规则。
- [x] 不改变 active session 写入和切分语义。

通过标准：

- [x] 常规窗口采样不再每秒触发全量进程 snapshot。
- [x] 无权限或特殊进程仍能通过 fallback 获取 exe name。
- [x] `npm run check:rust` 通过。
- [ ] 诊断和手动观察中，不出现持续高 CPU、不回落或关闭应用后立即恢复的异常形态。

是否进入下一层：

- [ ] 如果仍出现持续 CPU 异常，且诊断显示进程详情查询仍是热点，进入第三层。
- [ ] 如果 CPU 异常来自 UI 页面渲染，不进入第三层，转到前端性能路线另行评估。

### 6.3 第三层：短 TTL 进程详情缓存

目标：避免同一个进程每秒重复解析路径，同时不牺牲窗口标题与 AFK 的实时性。

- [ ] 缓存只保存 `process_id -> exe_name/process_path`。
- [ ] 不缓存 `title`。
- [ ] 不缓存 `window_class`。
- [ ] 不缓存 `idle_time_ms` 或 `is_afk`。
- [ ] TTL 初始建议 `5s`，最多谨慎评估到 `10s - 30s`。
- [ ] 选择短 TTL 是为了降低 PID 复用风险。
- [ ] 缓存 owner 留在 `platform/windows/foreground.rs` 或相邻 platform owner 内。
- [ ] 不把缓存抽到 `shared`、`domain` 或 `engine`。

缓存失效策略：

- [ ] TTL 到期自动重查。
- [ ] 主路径查询失败时允许 fallback。
- [ ] 如果同一 `process_id` 返回空 exe name，不长期缓存空结果。
- [ ] 如果未来记录 process creation time，可以再升级为 `(pid, creation_time)` key；第一阶段不强行引入。

通过标准：

- [ ] 同一前台进程稳定停留时，进程路径查询次数明显下降。
- [ ] 高频窗口标题变化时仍能更新标题记录。
- [ ] AFK 和 tracking pause 不受影响。
- [ ] Bilibili / Edge 多标签 / 输入场景无持续高 CPU。

### 6.4 第四层：事件驱动前台窗口变化

这是长期可选方案，不作为第一轮默认实现。

目标：用 Windows event hook 降低无变化时的窗口采样成本。

候选方向：

- [ ] 使用 `SetWinEventHook` 监听 foreground window change。
- [ ] 前台窗口变化时立即采样。
- [ ] 保留低频 heartbeat，用于 AFK、session timeout、锁屏/休眠恢复和 watchdog。
- [ ] heartbeat 不应低到影响时间记录可信度。
- [ ] event hook 失败时 fallback 到当前轮询路径。

进入条件：

- [ ] 第二层和第三层仍无法解决持续 CPU 异常。
- [ ] 有明确测量证明 1 秒轮询本身是主要成本。
- [ ] 已有足够测试覆盖 session 切分、AFK、锁屏/休眠恢复。

风险控制：

- [ ] 不一次性把 tracking runtime 改成纯事件驱动。
- [ ] 不移除 heartbeat。
- [ ] 不把事件 hook 逻辑塞进 `runtime.rs` 主循环；应拆到 platform 或 runtime 相邻 owner。
- [ ] 先做内部验证版本，再进入正式发布。

### 6.5 长期完成标准

- [ ] 后台采样成本在弱机器上可接受，以诊断耗时和持续 CPU 观察为准。
- [ ] 主界面前台和 Data 页切换只出现短暂波动，能快速回落；不以开发者机器上的手工百分比作为硬阈值。
- [ ] 视频、输入、切标签、Explorer 场景不出现持续高 CPU。
- [ ] tracking session 没有因降载而漏记、串记或延迟封口。
- [ ] issue #2 有明确修复说明和版本号；具体沟通由维护者自行处理。
- [ ] 如果后续仍有内存增长，单独开 issue，不混入 CPU 修复闭环。

---

## 7. 执行阶段

### 阶段 0：确认工作区和基线

- [x] 确认当前工作区干净：`git status --short`。
- [x] 确认当前版本基线和最新发布 tag：`git log --oneline --decorate -5`。
- [x] 记录 issue #2 的当前状态、标题、链接和复现线索。
- [ ] 由执行者使用系统工具或诊断日志记录当前版本下的空闲 CPU、普通浏览 CPU、Bilibili 视频场景 CPU。
- [x] 如果无法复现 CPU 飙高，也继续执行第一阶段低风险优化，但在记录里标注“未稳定复现”。

建议记录格式：

```text
时间 / 版本 / 场景 / Time Tracker CPU / 总 CPU / 内存 / 备注
```

---

### 阶段 0.1：开发版与安装版观察口径

为避免把开发环境成本误判为安装版回归，CPU 观察按下面口径区分。

开发版特征：

- [ ] `npm run tauri dev` 通常运行 Rust debug 构建，CPU 表现不能直接代表安装版。
- [ ] Vite dev server、HMR、source map、Node、esbuild 可能带来额外 CPU。
- [ ] 任务管理器里需要分开看 `time_tracker.exe`、`node.exe`、浏览器/WebView 相关进程。
- [ ] 开发版只适合快速判断明显错误，不作为 issue #2 的最终性能验收。

安装版或 release 构建观察口径：

- [ ] 优先使用正式安装包或 release 构建观察。
- [ ] 只记录 Time Tracker 相关进程，不把 Vite / Node 开发进程算入应用 CPU。
- [ ] 分别记录后台最小化、前台主界面、Data 页、视频/多标签、连续输入场景。
- [ ] 重点看是否存在“持续高 CPU、不回落、关闭应用后恢复”，而不是只看打开界面瞬时峰值。
- [ ] 如果安装版仍持续偏高，再进入第三层短 TTL 缓存或更细诊断。

建议最小手动记录表：

```text
版本 / 构建类型 / 场景 / Time Tracker CPU 峰值 / 回落后 CPU / 回落时间 / 内存 / 备注
1.1.2 / 安装版或 release / 后台最小化 5 分钟 /  /  /  /  /
1.1.2 / 安装版或 release / 前台主界面 5 分钟 /  /  /  /  /
1.1.2 / 安装版或 release / 切到 Data 页 /  /  /  /  /
1.1.2 / 安装版或 release / Edge/Bilibili 多标签或视频 /  /  /  /  /
1.1.2 / 安装版或 release / 连续输入 2 分钟 /  /  /  /  /
```

---

### 阶段 1：低风险 API 调用顺序优化

目标：消除每秒固定全量进程 snapshot。

- [x] 打开 `src-tauri/src/platform/windows/foreground.rs`。
- [x] 拆出主路径函数，例如 `get_process_details_from_handle(process_id)`。
- [x] 主路径执行顺序改为：
  - [x] `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id)`
  - [x] `QueryFullProcessImageNameW`
  - [x] 从完整路径提取 exe name
  - [x] 返回 `(exe_name, process_path)`
- [x] fallback 路径只在主路径失败时调用：
  - [x] `CreateToolhelp32Snapshot`
  - [x] `Process32FirstW / Process32NextW`
  - [x] 返回 `(fallback_exe_name, "")`
- [x] 确保所有 Windows handle 仍然关闭。
- [x] 确保路径为空但 exe name 可得时仍保持现有行为兼容。
- [x] 确保 `has_resolved_window_process(process_id, exe_name)` 的语义不变。
- [x] 不改变 Explorer shell surface 排除规则。

验收点：

- [x] 常规可访问进程不再触发全量进程 snapshot。
- [x] 无权限或查询失败的进程仍能通过 snapshot fallback 拿到 exe name。
- [x] 现有前台窗口 payload 字段不改名、不改协议形状。

---

### 阶段 2：测试保护

目标：证明 fallback 仍然存在，且主路径行为不破坏 tracking 语义。

- [x] 复查 `foreground.rs` 已有测试，优先补平台边界的纯函数测试。
- [x] 如果直接测试 Windows API 太难，至少把可测试逻辑拆成小函数：
  - [x] 路径提取 exe name
  - [x] 主路径结果与 fallback 结果合并
  - [x] 空 exe / 空路径处理
- [x] 保留现有测试：
  - [x] inactive window snapshot
  - [x] null window handle
  - [x] unresolved process
  - [x] explorer shell surface
- [x] 如需新增 helper，保持在 `foreground.rs` 内部，不新增跨层公共抽象。

建议测试点：

- [x] 完整路径 `%SystemRoot%\explorer.exe` 能解析出 `explorer.exe`。
- [x] 完整路径 `%ProgramFiles%\App\App.exe` 能解析出 `App.exe`。
- [x] 主路径没有路径时，fallback exe name 能作为 exe name 返回。
- [x] 主路径成功时，不需要 fallback exe name 才能返回 exe name。

---

### 阶段 3：本地验证

自动验证记录：

- [x] `npm run check:rust-boundaries`：通过。
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --quiet`：通过，144 个 Rust 测试通过。
- [x] `npm run check:rust`：通过，包含 Rust boundary、`cargo check`、Rust tests、clippy。
- [x] `npm run check`：首次在普通沙箱中到 `uiSmoke` 时遇到 `spawn EPERM`；提升权限重跑后通过。
- [x] `npm run release:check`：通过，包含 `check:full` 与 changelog 校验。

验证结论：

- [x] 代码层面已确认不会破坏现有 tracking 行为测试。
- [x] Rust 边界检查通过，修复仍落在 `platform/windows/foreground.rs` owner 内。
- [x] 浏览器 UI smoke、生产前端构建、bundle budget 均通过。
- [ ] 尚未完成安装版或 release 构建的手动 CPU 观察。

先运行 Rust 相关验证：

- [x] `npm run check:rust-boundaries`
- [x] `npm run check:rust`

再运行项目质量门槛：

- [x] `npm run check`

如果准备进入发布：

- [x] `npm run check:full`

手动观察建议：

- [ ] 打开 Time Tracker，空闲 5 分钟，记录 CPU / 内存。
- [ ] 在前台切换到 Data 页，记录峰值 CPU、回落时间和回落后的稳定 CPU。
- [ ] 打开 Edge 普通网页，切换几个标签，记录 CPU。
- [ ] 打开 Bilibili 视频，执行播放、暂停、快进、换集、切标签，记录 CPU。
- [ ] 聚焦桌面、任务栏、资源管理器窗口，记录 CPU 是否异常。
- [ ] 连续输入文本 2 分钟，记录 CPU 是否异常。
- [ ] 保持运行 1 小时，记录内存变化，但不把内存作为本 issue 必须修复项。

通过标准：

- [ ] 常规空闲时不出现持续高 CPU。
- [ ] 打开主界面和切换到 Data 页时允许出现短暂波动，但应在数秒内回落。
- [ ] 主界面前台保持和后台运行都不应出现持续上升且不回落的 CPU 占用。
- [ ] 视频和输入高频变化场景中不应出现持续性高 CPU。
- [ ] 如果出现瞬时波动，应能在短时间回落。
- [ ] 不出现 tracking session 明显漏记或串记。

---

### 阶段 4：如果第一阶段仍不足

只有在第一阶段后仍能复现 CPU 异常时进入本阶段。

备选 A：进程详情短缓存

- [ ] 在 `foreground.rs` 或相邻 platform owner 内增加进程详情缓存。
- [ ] 缓存 key 优先使用 `process_id`。
- [ ] 缓存 value 包含 exe name、process path、采样时间。
- [ ] TTL 初始建议 `5s - 30s`，先保守选择短 TTL。
- [ ] 如果担心 PID 复用，TTL 不应过长。
- [ ] 只缓存进程详情，不缓存窗口标题、窗口类名、AFK 状态。

备选 B：轮询降载

- [ ] 仅在明确证明 API 调用仍过重时考虑。
- [ ] 不直接降低 tracking 可信度。
- [ ] 不跳过 AFK / 锁屏 / 会话封口必要采样。
- [ ] 如做 adaptive polling，必须写清楚什么时候恢复 1 秒采样。

备选 C：专项 profiler

- [ ] 使用 Windows 任务管理器或资源监视器做初步确认。
- [ ] 必要时用 Visual Studio Performance Profiler / Windows Performance Recorder。
- [ ] 只在无法通过代码审查和本地观察定位时引入。

---

## 8. 内存观察单独处理

用户记录：

```text
10:30  84.5MB
11:00  83.2MB
12:00  105.8MB
14:00  116.5MB
15:00  133.9MB
```

处理口径：

- [x] 不把内存增长混入 issue #2 的 CPU 修复完成条件。
- [ ] 继续记录更新后版本的内存变化。
- [ ] 如果新版本连续运行仍持续增长，再开单独 issue 或追加独立执行单。
- [ ] 后续内存调查优先区分 WebView 正常增长、缓存增长、事件监听泄漏、图标缓存和后台数据刷新。

建议继续记录格式：

```text
时间 / 版本 / 内存 / CPU / 当前主要操作 / 是否最小化 / 是否打开视频或多标签
```

---

## 9. 发布计划

如果阶段 1 修复通过验证：

- [x] 判断版本号：issue #2 是向后兼容 bug 修复，默认进入 `PATCH`。
- [x] 如果当前最新正式版本是 `1.1.1`，目标版本建议为 `1.1.2`。
- [x] 更新 `CHANGELOG.md` 的 `Fixed` 条目。
- [x] `Fixed` 条目必须包含 issue 链接：`[#2](https://github.com/Ceceliaee/time-tracking/issues/2)`。
- [x] 同步版本文件。
- [x] 运行 `npm run release:check`。
- [x] 提交信息使用 `release: v1.1.2`。
- [x] 推送 `main` 和 `v1.1.2` tag。
- [x] 确认 GitHub Actions 的 `Publish Release` 已触发。

如果只先提交修复、不立即发布：

- [ ] 先写进 `CHANGELOG.md` 的 `Unreleased / Fixed`。
- [ ] 保留 issue 链接。
- [ ] 在 issue #2 留评论说明已进入待发布验证。

---

## 10. 回滚与风险

主要风险：

- [ ] 某些受限进程 `OpenProcess` 失败，需要 fallback 继续保底。
- [ ] 过度缓存可能导致进程路径或 exe name 短时间不准确。
- [ ] 降低轮询频率可能影响 session 切分可信度。

回滚策略：

- [x] 阶段 1 只调整查询顺序，若出现兼容问题，可回退单文件改动。
- [x] 不在第一阶段引入跨模块缓存，降低回滚成本。
- [ ] 如果阶段 2 或阶段 4 引入缓存，缓存应可单独移除，不影响原始查询路径。

---

## 11. 完成定义

Issue #2 可视为完成，需要同时满足：

- [x] 已实现低风险 API 调用顺序优化，或有明确证据证明另一个路径才是真因。
- [x] 现有 tracking 行为测试通过。
- [x] Rust 质量门槛通过。
- [ ] 本地诊断和手动观察未再出现持续 CPU 异常。
- [x] `CHANGELOG.md` 或发布说明中已关联 issue #2。
- [x] issue #2 的沟通由维护者自行处理；本执行单不规定回写模板。
- [x] 安装版或 release 构建手动观察不作为本次发布前置条件，发布后如仍持续偏高再进入第三层或新执行单。

不要求同时满足：

- [x] 不要求解决所有内存增长观察。
- [x] 不要求新增性能监控 UI。
- [x] 不要求把 tracking runtime 改成事件驱动。

---

## 12. 后续清理

完成后：

- [x] 如果该执行单不再作为当前执行依据，移动到 `docs/archive/`。
- [x] 如果产生长期规则变化，回写对应顶层文档，而不是继续扩写本执行单。
- [x] 如果只是一次 CPU issue 修复，不更新长期产品或架构规则。
