# Patina 资源有界与无累积预热执行方案

## 文档状态

- [x] 已和产品 owner 复核。
- [x] 已开始执行。
- [x] 阶段 0 基线测量已完成。
- [x] 阶段 1 内部 diagnostics 已完成。
- [x] 阶段 2 长期资源硬上限已完成。
- [x] 阶段 3 无累积预热已完成。
- [x] 阶段 4 Settings 存储快照手动刷新已完成。
- [x] 阶段 5 后台资源释放策略已完成。
- [x] 最终验证已完成。
- [x] 结果已总结，本文档已归档或退休。

本文是一份一次性执行方案。执行期间放在 `docs/working/`。任务完成后，应移动到 `docs/archive/`，或把真正长期有效的规则回写到 `docs/engineering-quality.md`。

执行结果摘要（2026-07-03）：

- 已把 Dashboard / History / Data trend / Data heatmap snapshot 上限收紧到 `1 / 7 / 2 / 2`，并用测试固定。
- 已为前端 app icon runtime cache、missing icon retry、Rust icon negative cache、tracking title-capture cache、Tools alerts、Web Activity bridge 连接建立硬上限。
- 已把 updater 下载包从 runtime 常驻 `Vec<u8>` 改为落地到临时包文件，安装时再读取。
- 已把 hidden autostart warmup 改为跳过非必要 chunk 和 heavy read model；visible start 保留打开体验所需预热，但不再预热 History heavy snapshot。
- 已把 Settings 存储快照改为手动刷新，清理/迁移等操作仍可显式刷新。
- 已补充内部 diagnostics，Rust owner stats 与前端 cache stats 可在开发诊断入口统一查看。
- 已通过 `npm run check:full`，包含命名、架构、全部前端测试、真实浏览器 smoke、生产构建、bundle 预算、Rust 边界、`cargo check`、Rust 单测和 Clippy。
- 阶段 6 的严格长时间前后资源复测没有强行启动当前源码版 Patina：当前 dev 配置使用正式 identifier `com.ceceliaee.patina`，直接运行会复用正式数据目录并可能造成第二个真实 tracker。该项保留为发布候选包或隔离 identifier 环境下的手工复测项。

## 1. 目标

在不牺牲 Patina 打开体验和 tracking 可信度的前提下，让长期资源占用变得可解释、有上限、可验证。

目标不是单纯降低任务管理器里的某一列数字，而是建立下面这些性质：

- [x] Patina 主进程内存不能在没有 owner 的情况下持续增长。
- [x] Rust 长期缓存必须有容量上限和清理规则。
- [x] WebView2 侧长期缓存必须有容量上限和清理规则。
- [x] 启动预热不能把旧预热数据一轮一轮留在内存里。
- [x] autostart 隐藏启动不能跑完整 heavy read model 预热。
- [x] 打开主窗口仍然保持无感或接近无感。
- [x] Settings 的存储目录大小扫描只在手动请求时运行。
- [x] 内部 diagnostics 能帮助下一次资源上涨时定位责任模块。

## 2. 第一性原理

### 2.1 每一份长期保留的数据都必须有 owner

资源不是“自然增长”的，所有增长都来自某个保留行为：

- 缓存把对象留住。
- runtime state 把状态留住。
- pending promise / in-flight 任务把闭包和结果留住。
- WebView2 把前端对象、图片、JS heap、渲染资源留住。
- Rust 把 `HashMap`、`Vec`、下载包 bytes、连接状态留住。

执行原则：

- [ ] 任何长期 `Map`、`HashMap`、`Vec`、静态缓存都必须写清 owner。
- [ ] 任何 cache 都必须有容量上限。
- [ ] 任何 retry/backoff 记录都必须有过期或驱逐规则。
- [ ] 任何 prewarm 数据都必须说明谁消费、什么时候替换、什么时候释放。
- [ ] 如果说不清 owner，就不应长期保留。

### 2.2 我们要的是“不累积预热”，不是“停止预热”

本方案不把预热理解为危险行为。预热可以存在，但必须满足：

- [ ] 预热可以使用内存。
- [ ] 预热后的内存应收敛到固定平台值。
- [ ] 第 N 次预热不应比第 1 次预热保留更多同类数据。
- [ ] 同类数据刷新时应替换旧值，而不是追加新值。
- [ ] 页面切换不能让同一类 snapshot 同时在多个 owner 中长期保留多份。

因此，本方案优先使用：

- 固定槽位。
- 小容量 LRU。
- 同 key 覆盖。
- pending 合并。
- 旧数据主动释放。

而不是简单做：

- 发现内存涨了就停止预热。
- 把所有预热都删掉。
- 只靠 GC 或 Rust allocator 自己回收。

### 2.3 打开无感不等于启动时跑完所有重活

用户感觉“打开快”，通常来自：

- 主窗口 shell 及时出现。
- 当前首屏有可显示内容。
- 导航目标的代码 chunk 已经准备好。
- 数据刷新在视觉上不突兀。

它不要求：

- autostart 隐藏时就计算 Dashboard / History / Data 的 heavy SQL read model。
- 所有未来页面都在启动后立即预热。
- 所有图标、趋势、热力图、工具状态都提前完整加载。

执行原则：

- [ ] shell 可以预热。
- [ ] 当前页可以优先加载。
- [ ] 非当前页可以预加载代码，不默认预加载 heavy data。
- [ ] 页面打开时可以用已有 snapshot 或轻量状态顶上，再异步刷新。
- [ ] heavy read model 只在用户可见或明确接近使用时运行。

### 2.4 性能优化不能破坏 tracking 可信度

Patina 是个人、本地优先、自动追踪工具。资源优化不能影响：

- [ ] 前台窗口采样。
- [ ] session 切分。
- [ ] AFK / 锁屏 / 睡眠边界。
- [ ] tracking watchdog。
- [ ] SQLite 数据安全。
- [ ] 备份 / 恢复 / 清理。
- [ ] updater 可靠性。

如果某项优化可能改变 tracking 语义，应拆成单独执行单，不混在本计划里。

## 3. 当前事实和判断

### 3.1 已测到的资源行为

最近本地测试结果：

- [x] 旧长运行状态：约 14 小时后，Patina 主进程约 `112.1MB Working Set / 75.9MB Private`。
- [x] 手动可见启动 5 分钟：约 `59.4MB Working Set / 22.3MB Private`。
- [x] autostart 隐藏启动 5 分钟：约 `48.0MB Working Set / 15.8MB Private`。
- [x] 打开 Settings 后，Patina 主进程几乎没有明显增长。
- [x] 打开 History 后，Patina 主进程几乎没有明显增长。
- [x] 打开 Data 后，Patina 主进程 Private 增加约 `2MB`。
- [x] 页面切换时 WebView2 子进程增长比 Patina 主进程更明显。

当前判断：

- [x] 短时间打开 Settings / History / Data 不是 Patina.exe 主进程涨到 75MB Private 的主因。
- [x] autostart 隐藏启动的 Private 基线已经接近目标。
- [x] 长时间上涨更像 Rust runtime / 缓存 / updater / bridge 等长期状态累积。
- [x] 启动预热仍需要变成无累积、小槽位、按可见性分级。
- [x] 合并 `#31` 后，Data 页渲染和搜索计算已拆分得更细；这不改变本执行单主方向，但需要把 Data 页新增的 hook/service/component 纳入锚点和验证。

### 3.2 当前代码锚点

读模型和预热：

- [ ] `src/features/dashboard/services/dashboardSnapshotCache.ts`
- [ ] `src/features/history/services/historySnapshotCache.ts`
- [ ] `src/features/data/services/dataTrendSnapshot.ts`
- [ ] `src/features/data/services/dataReadModel.ts`
- [ ] `src/features/data/services/dataBootstrapSnapshot.ts`
- [ ] `src/features/data/hooks/useDataTrendSnapshot.ts`
- [ ] `src/features/data/services/dataAppSearch.ts`
- [ ] `src/features/data/components/Data.tsx`
- [ ] `src/features/data/components/DataAppTrendPanel.tsx`
- [ ] `src/features/data/components/DataHeatmapPanel.tsx`
- [ ] `src/features/data/components/DataHeatmapTooltip.tsx`
- [ ] `src/app/services/startupWarmupService.ts`

Settings 存储扫描：

- [ ] `src/features/settings/hooks/useSettingsPageState.ts`
- [ ] `src/features/settings/components/SettingsDataSafetyPanel.tsx`
- [ ] `src/platform/storage/storageRuntimeGateway.ts`
- [ ] `src-tauri/src/commands/storage.rs`

前端图标缓存：

- [ ] `src/platform/persistence/appIconRuntimeCache.ts`

Rust 长期资源：

- [ ] `src-tauri/src/engine/tracking/metadata.rs`
- [ ] `src-tauri/src/engine/tracking/runtime/loop_state.rs`
- [ ] `src-tauri/src/engine/tools/mod.rs`
- [ ] `src-tauri/src/engine/updater.rs`
- [ ] `src-tauri/src/platform/web_activity_bridge.rs`
- [ ] `src-tauri/src/commands/diagnostics.rs`

测试锚点：

- [ ] `tests/startupWarmupService.test.ts`
- [ ] `tests/dataTrendRange.test.ts`
- [ ] `tests/dataReadModel.test.ts`
- [ ] `tests/dataAppSearch.test.ts`
- [ ] `tests/uiBrowserSmoke/dataScenarios.ts`
- [ ] `tests/dashboardIconRuntimeCache.test.ts`
- [ ] Rust touched module 附近的单元测试。

## 4. 非目标

- [ ] 不完全移除启动预热。
- [ ] 不让主窗口打开变慢。
- [ ] 不删除 Dashboard / History / Data 的缓存能力。
- [ ] 不把内部 diagnostics 做成普通用户 UI。
- [ ] 不为了几个 cache 引入大而全的全局缓存框架。
- [ ] 不改变产品方向。
- [ ] 不改变 tracking 语义。
- [ ] 不让页面组件直接访问 SQLite / Tauri raw / 平台细节。
- [ ] 不把临时执行计划写进顶层长期 docs。

## 5. 目标行为

### 5.1 读模型缓存上限

按讨论确认的目标收紧：

- [x] Dashboard snapshot cache：`1`。
- [x] History snapshot cache：`7`。
- [x] Data trend snapshot cache：`2`。
- [x] Data heatmap session cache：`2`。

解释：

- Dashboard 只需要当前日附近的最新 snapshot。
- History 保留 7 个槽位，覆盖一周内切换的常见回看。
- Data trend 保留 2 个槽位，覆盖 Data 页当前现实中的 overview trend 和 app trend 两个并行消费者；不要再降到 1。
- Data heatmap 目前已经是 2，保持。

### 5.2 其他长期缓存上限

- [x] 前端 app icon runtime cache 需要上限。
- [x] 前端 missing icon retry map 需要上限。
- [x] Rust `icon_negative_cache` 需要上限和主动清理。
- [x] Rust `capture_window_title_by_exe` 需要上限和主动清理。
- [x] Tools alerts 需要最大条数。
- [x] updater 下载包不应长期保留在内存 `Vec<u8>`。
- [ ] Web Activity bridge 需要并发连接和请求超时上限。

### 5.3 预热行为

autostart 隐藏启动：

- [ ] 启动 tracking runtime。
- [ ] 启动必要平台监听。
- [ ] 不跑完整 startup warmup。
- [ ] 不跑 Dashboard / History / Data heavy SQL read model。
- [ ] 不扫 Settings storage snapshot。

主窗口可见启动：

- [ ] shell 可以准备。
- [ ] 当前页可以正常加载。
- [ ] 非当前页可以 preload chunk。
- [ ] 非当前页不默认跑 heavy SQL read model。

预热数据保留：

- [ ] 同 owner 只有固定槽位。
- [ ] 刷新是覆盖或 LRU 替换。
- [ ] 同 key 刷新不增加 cache size。
- [ ] 页面消费已有 snapshot 时，不再额外制造长期副本。

### 5.4 Settings 存储快照

- [ ] 打开 Settings 不自动调用 `cmd_get_storage_snapshot`。
- [ ] Data Safety / 存储区域初始显示“未检查”状态。
- [ ] 用户点击刷新/检查后再扫描目录大小。
- [ ] 需要 storage snapshot 的迁移/清理操作必须保证有新鲜 snapshot 或显式刷新。

### 5.5 后台资源释放

- [ ] 保守处理。
- [ ] 默认不激进销毁 WebView。
- [ ] 如果用户开启后台优化，才考虑延迟释放主窗口重资源。
- [ ] 释放策略必须保留 generation/token 防护。
- [ ] Widget 和主窗口重新打开体验优先。

## 6. 阶段 0：基线测量

目的：先得到可比较的前后数字，避免凭感觉优化。

执行步骤：

- [ ] 确认工作区状态：

```powershell
git status --short
```

- [ ] 记录当前 commit：

```powershell
git rev-parse --short HEAD
```

- [ ] 手动可见启动 Patina。
- [ ] 分别在 30 秒、1 分钟、5 分钟记录：
  - [ ] Patina.exe Working Set。
  - [ ] Patina.exe Private Bytes。
  - [ ] Patina.exe Working Set - Private。
  - [ ] Patina.exe 线程数。
  - [ ] Patina.exe 句柄数。
  - [ ] Patina.exe CPU 秒数。
  - [ ] WebView2 子进程数量。
  - [ ] WebView2 子进程总 Working Set。
  - [ ] WebView2 子进程总 Private Bytes。
- [ ] 以 `--autostart` 隐藏模式启动 Patina。
- [ ] 同样记录 30 秒、1 分钟、5 分钟。
- [ ] 执行页面场景并记录：
  - [ ] 打开 Settings。
- [ ] 打开 History。
- [ ] 打开 Data。
  - [ ] 在 Data 页执行一次 app 搜索。
  - [ ] 切换一次 app trend 范围。
  - [ ] 悬停一次 heatmap tooltip。
- [ ] 返回 Dashboard。

建议采样命令：

```powershell
Get-Process -Name Patina | Select-Object Id, StartTime, WorkingSet64, PrivateMemorySize64, Handles, Threads, CPU
Get-Counter '\Process(Patina)\Working Set - Private','\Process(Patina)\Private Bytes','\Process(Patina)\Working Set','\Process(Patina)\Thread Count','\Process(Patina)\Handle Count'
```

验收：

- [ ] 有 visible start 和 hidden autostart 两套基线。
- [ ] 区分 Patina 主进程和 WebView2 子进程。
- [ ] 有页面场景前后对比。
- [ ] 记录能用于阶段 6 复测。

## 7. 阶段 1：内部 Diagnostics

目的：先能看见资源 owner，再进入修复。

### 7.1 Rust diagnostics

Owner：

- [ ] `src-tauri/src/commands/diagnostics.rs` 只做汇总和 DTO。
- [ ] 具体 cache stats 由各自 owner 模块暴露。

执行步骤：

- [ ] 在 `src-tauri/src/engine/tracking/metadata.rs` 增加 icon negative cache stats：
  - [ ] 当前 entries。
  - [ ] limit。
  - [ ] ttl。
  - [ ] oldest age 或 oldest timestamp。
- [ ] 在 `src-tauri/src/engine/tools/mod.rs` 增加 tools stats：
  - [ ] alert count。
  - [ ] alert limit。
- [ ] 在 `src-tauri/src/engine/updater.rs` 增加 updater retained package stats：
  - [ ] 是否持有下载包。
  - [ ] 下载包大小。
  - [ ] 存储类型：当前可先标记为 memory，改完后为 file。
- [ ] 在 `src-tauri/src/platform/web_activity_bridge.rs` 增加 bridge stats：
  - [ ] active clients。
  - [ ] active client limit。
  - [ ] rejected clients count。
  - [ ] timeout count。
- [ ] 扩展 `ResourceDiagnosticsSnapshot`。
- [ ] 保持 `cmd_get_resource_diagnostics` 薄，不在 command 里写清理逻辑。

测试：

- [ ] 给 stats helper 增加 Rust 单元测试。
- [ ] 如果前端 parser 需要更新，同步更新 TypeScript parser 测试。
- [ ] 运行：

```powershell
npm run check:rust
```

验收：

- [ ] diagnostics 能看到 Patina 主进程资源和关键缓存计数。
- [ ] diagnostics 只用于内部，不出现在普通用户 UI。
- [ ] diagnostics 本身不新增长期 retained data。

### 7.2 前端 diagnostics

Owner：

- [ ] `src/platform/desktop/resourceDiagnosticsRuntimeGateway.ts`
- [ ] 各 feature cache owner 暴露内部 stats。

执行步骤：

- [ ] 增加 Dashboard snapshot cache size / limit。
- [ ] 增加 History snapshot cache size / limit。
- [ ] 增加 Data trend snapshot cache size / limit。
- [ ] 增加 Data heatmap session cache size / limit。
- [ ] 增加 app icon cache size / limit。
- [ ] 增加 missing icon retry size / limit。
- [ ] 入口保持 dev-only global 或内部 command，不做用户可见 UI。

测试：

- [ ] 给 cache stats helper 增加测试。
- [ ] 运行：

```powershell
npm run test:warmup
npm run test:data-range
npm run test:data
npm run test:dashboard-icons
```

验收：

- [ ] 能从内部入口看到前端 cache 计数。
- [ ] stats 不改变 cache 行为。

## 8. 阶段 2：长期资源硬上限

目的：先堵住“长期无限增长”的入口。

### 8.1 读模型 cache limit 调整为 1 / 7 / 2 / 2

Owner：

- [ ] `src/features/dashboard/services/dashboardSnapshotCache.ts`
- [ ] `src/features/history/services/historySnapshotCache.ts`
- [ ] `src/features/data/services/dataTrendSnapshot.ts`
- [ ] `src/features/data/services/dataReadModel.ts`
- [ ] `src/features/data/hooks/useDataTrendSnapshot.ts` 作为 Data trend snapshot 的页面消费入口。

执行步骤：

- [ ] 将 `DASHBOARD_SNAPSHOT_CACHE_LIMIT` 从 `3` 改为 `1`。
- [ ] 将 `HISTORY_SNAPSHOT_CACHE_LIMIT` 从 `14` 改为 `7`。
- [ ] 将 `DATA_TREND_SNAPSHOT_CACHE_LIMIT` 从 `4` 改为 `2`。
- [ ] 确认 `HEATMAP_SESSION_CACHE_LIMIT` 已是 `2`，不改。
- [ ] 如果 diagnostics 需要，增加 limit getter。
- [ ] 复核 `useDataTrendSnapshot` 两个实例：
  - [ ] overview trend 和 app trend 同时存在时，limit `2` 不会导致当前页两个活跃 range 互相立即挤掉。
  - [ ] 同 range 时仍可共享 `sessions` 引用并复用 aggregate context。
  - [ ] cached refresh 的延迟加载不会额外增加 cache size。
- [ ] 更新 `tests/startupWarmupService.test.ts`：
  - [ ] Dashboard 断言从 `3` 改为 `1`。
  - [ ] History 断言从 `14` 改为 `7`。
- [ ] 更新 `tests/dataTrendRange.test.ts`：
  - [ ] Data trend 断言从 `4` 改为 `2`。
- [ ] 确认 `tests/dataReadModel.test.ts` 的 heatmap 断言仍是 `2`。

验证：

```powershell
npm run test:warmup
npm run test:data-range
npm run test:data
npm run test:data-chart
```

验收：

- [ ] 同 key refresh 仍覆盖旧值。
- [ ] 超出上限时驱逐最旧项。
- [ ] 1 / 7 / 2 / 2 由测试固定。
- [ ] Data 页 overview/app 两条 trend 同时存在时仍能正常显示和刷新。

### 8.2 前端 app icon runtime cache 加上限

Owner：

- [ ] `src/platform/persistence/appIconRuntimeCache.ts`

执行步骤：

- [ ] 定义 `APP_ICON_RUNTIME_CACHE_LIMIT`。
- [ ] 定义 `MISSING_ICON_RETRY_CACHE_LIMIT`。
- [ ] 初始建议：
  - [ ] icon cache limit：`256`。
  - [ ] missing retry limit：`256`。
- [ ] 将当前 plain object cache 改成可驱逐结构。
- [ ] 确认 alias expansion 不会造成无限 key 膨胀。
- [ ] 插入 found icon 后按 LRU 或插入顺序驱逐。
- [ ] 插入 missing retry 后按 LRU 或插入顺序驱逐。
- [ ] `resetAppIconRuntimeCacheForTests` 清掉所有新结构。
- [ ] 增加测试 helper：
  - [ ] icon cache size。
  - [ ] missing retry size。
  - [ ] limits。

测试：

- [ ] found icon 超上限会驱逐旧项。
- [ ] missing retry 超上限会驱逐旧项。
- [ ] alias lookup 仍工作。
- [ ] pending refresh 仍合并。

验证：

```powershell
npm run test:dashboard-icons
npm run test:data
npm run test:history-timeline
```

验收：

- [ ] 图标缓存不能无限增长。
- [ ] missing retry map 不能无限增长。
- [ ] Dashboard / History / Data 图标显示不回退。

### 8.3 Rust icon_negative_cache 加上限

Owner：

- [ ] `src-tauri/src/engine/tracking/metadata.rs`

执行步骤：

- [ ] 定义 `ICON_NEGATIVE_CACHE_LIMIT`。
- [ ] 初始建议：`512`。
- [ ] 保留现有 `ICON_NEGATIVE_CACHE_TTL_MS`。
- [ ] 如果需要 LRU，将 value 从 `i64` 改为 struct：
  - [ ] `last_failed_at_ms`。
  - [ ] `last_accessed_at_ms`。
- [ ] 增加 cleanup helper：
  - [ ] 删除过期 entry。
  - [ ] 仍超限时删除最旧 entry。
- [ ] 在 `remember_icon_failure` 插入前后执行 cleanup。
- [ ] 在 `should_skip_icon_attempt` 遇到过期 key 时可以顺手移除。
- [ ] 增加 `icon_negative_cache_stats()`。
- [ ] 避免持锁执行慢操作。

测试：

- [ ] 原有 normalized key 测试通过。
- [ ] 原有 TTL suppression 测试通过。
- [ ] 新增过期 entry 主动清理测试。
- [ ] 新增超限驱逐测试。

验证：

```powershell
npm run check:rust
```

验收：

- [ ] cache 有硬上限。
- [ ] TTL 不是只在相同 key 再访问时才有机会处理。
- [ ] diagnostics 能看到 count / limit。

### 8.4 tracking capture_window_title_by_exe 加上限

Owner：

- [ ] `src-tauri/src/engine/tracking/runtime/loop_state.rs`

执行步骤：

- [ ] 定义 `CAPTURE_WINDOW_TITLE_CACHE_LIMIT`。
- [ ] 初始建议：`256`。
- [ ] 在 `CachedCaptureWindowTitleSetting` 中增加 access 或 loaded timestamp。
- [ ] 读取时清理过期 entry。
- [ ] 插入时超限驱逐最旧 entry。
- [ ] 不为了 diagnostics 把 loop state 搬成全局状态。

测试：

- [ ] 缓存命中行为不变。
- [ ] TTL 到期后重新读取。
- [ ] 超限后驱逐旧项。
- [ ] 读取失败 fallback 行为不变。

验证：

```powershell
npm run check:rust
```

验收：

- [ ] 遇到很多不同 exe 时 map 不无限增长。
- [ ] tracking loop 行为不变。

### 8.5 Tools alerts 加上限

Owner：

- [ ] `src-tauri/src/engine/tools/mod.rs`

执行步骤：

- [ ] 定义 `TOOLS_ALERT_LIMIT`。
- [ ] 初始建议：`32`。
- [ ] 修改 `push_unique_alert`：
  - [ ] 相同 id 不重复插入。
  - [ ] 新 alert 插入尾部。
  - [ ] 超限时删除最旧 alert。
- [ ] diagnostics 增加 alert count / limit。
- [ ] 确认 dismiss alert 仍可按 id 移除。

测试：

- [ ] duplicate id 不重复。
- [ ] 超限驱逐最旧。
- [ ] dismiss 在驱逐后仍工作。

验证：

```powershell
npm run test:tools
npm run check:rust
```

验收：

- [ ] alerts 不无限增长。
- [ ] 用户可见提醒行为不回退。

### 8.6 updater 下载包改为临时文件

Owner：

- [ ] `src-tauri/src/engine/updater.rs`
- [ ] 如需调整 snapshot 字段，再触及 `src-tauri/src/domain/update.rs`

执行步骤：

- [ ] 替换长期 `downloaded_bytes: Option<Vec<u8>>`。
- [ ] 新状态建议：
  - [ ] `None`。
  - [ ] `File { path, size_bytes }`。
- [ ] 下载完成时：
  - [ ] 写入 app cache 或安全临时目录。
  - [ ] drop 内存 Vec。
  - [ ] state 只保存 path 和 size。
- [ ] 安装时：
  - [ ] 如果 Tauri updater API 需要 bytes，只在 install 调用前临时读入。
  - [ ] 成功后删除临时文件。
  - [ ] 可恢复失败时按原逻辑保留重试能力。
- [ ] up-to-date / error / reset 时清理本 app 拥有的临时包。
- [ ] 启动时清理 stale update temp 文件。
- [ ] 不删除不属于 Patina updater 的文件。
- [ ] diagnostics 显示：
  - [ ] 是否有下载包。
  - [ ] 大小。
  - [ ] 存储类型。

测试：

- [ ] state transition 测试。
- [ ] 临时文件路径/清理 helper 测试。
- [ ] install 失败后状态恢复测试。

验证：

```powershell
npm run test:update
npm run check:rust
```

验收：

- [ ] 下载包不长期以 Vec 留在内存。
- [ ] updater 安装和重试不回退。
- [ ] 临时文件不会无主残留。

### 8.7 Web Activity bridge 加 hard cap

Owner：

- [ ] `src-tauri/src/platform/web_activity_bridge.rs`
- [ ] `src-tauri/src/app/web_activity_bridge.rs` 只保留 app wiring。

执行步骤：

- [ ] 定义 `WEB_ACTIVITY_MAX_ACTIVE_CLIENTS`。
- [ ] 定义请求处理 timeout。
- [ ] 如果读写分离，分别定义 read/write timeout。
- [ ] 在 runtime state 中增加 active client counter 或 semaphore。
- [ ] accept connection 后：
  - [ ] 尝试拿 permit。
  - [ ] 超限则拒绝或立即关闭。
  - [ ] 连接结束时通过 RAII guard 释放。
- [ ] 保留现有 body/header size cap。
- [ ] diagnostics 增加：
  - [ ] active clients。
  - [ ] rejected clients。
  - [ ] timed out clients。

测试：

- [ ] active-client guard 单元测试。
- [ ] timeout policy helper 测试。
- [ ] settings transition 测试如果已有桥接配置测试。

验证：

```powershell
npm run check:rust
```

验收：

- [ ] 坏客户端不能制造无限连接/任务。
- [ ] 正常浏览器扩展请求仍成功。

## 9. 阶段 3：无累积预热

目的：保留打开无感，同时避免启动后把未来页面重数据都提前算好并长期保留。

### 9.1 定义 warmup mode

Owner：

- [ ] `src/app/services/startupWarmupService.ts`
- [ ] `src/app/AppShell.tsx`
- [ ] 如需要运行时 launch context，再通过合适 platform gateway 薄传递。

执行步骤：

- [ ] 增加 warmup mode：
  - [ ] `hidden-autostart`
  - [ ] `visible-start`
  - [ ] `foreground-open`
- [ ] 确定 mode 来源：
  - [ ] 当前 window label。
  - [ ] document visibility。
  - [ ] foreground-like state。
  - [ ] 如已有 autostart context，则使用；没有则先用可见性策略。
- [ ] 不让 `AppShell` 直接承接复杂平台判断。
- [ ] 为每个 mode 定义 task policy。

hidden-autostart policy：

- [ ] 不运行 Dashboard snapshot。
- [ ] 不运行 History snapshot。
- [ ] 不运行 Data trend snapshot。
- [ ] 不运行 Settings storage snapshot。
- [ ] Tools snapshot 仅在 Widget/可见 sidebar 必需时运行，否则跳过。
- [ ] settings/classification bootstrap 只保留运行必需项。

visible-start policy：

- [ ] shell chunk 可以预热。
- [ ] 当前页面 snapshot 可以加载。
- [ ] 非当前页面 heavy read model 默认跳过。

foreground-open policy：

- [ ] 用户 hover/focus nav 时预加载对应 chunk。
- [ ] 当前页面 refresh 可以运行。
- [ ] 所有结果进入固定槽位。

测试：

- [ ] `tests/startupWarmupService.test.ts` 增加三种 mode。
- [ ] hidden mode 断言 heavy read model 没有运行。
- [ ] visible mode 断言 shell/chunk 可运行。
- [ ] refresh 断言只包含可见页请求。

验证：

```powershell
npm run test:warmup
npm run test:preload
npm run test:background-return
```

验收：

- [ ] autostart 隐藏启动不跑完整 heavy warmup。
- [ ] 主窗口可见时仍能快速显示。
- [ ] mode policy 被测试固定。

### 9.2 同类预热结果替换旧值

Owner：

- [ ] 各 cache owner 自己负责，不新增万能全局 manager。

执行步骤：

- [ ] Dashboard：
  - [ ] limit 为 1。
  - [ ] 同日期刷新覆盖。
  - [ ] hook state 使用新 snapshot 替换旧数组。
- [ ] History：
  - [ ] limit 为 7。
  - [ ] 同日期 + 同 rolling day count 刷新覆盖。
  - [ ] hook state 使用新 snapshot 替换旧字段。
- [ ] Data trend：
  - [ ] limit 为 2。
  - [ ] 同 range 刷新覆盖。
  - [ ] pending promise settle 后必须删除。
  - [ ] `useDataTrendSnapshot` 只保留当前 hook 实例所需 snapshot，不把每次 refresh 结果追加到额外模块级 cache。
  - [ ] `Data.tsx` 中的 `lastTrendViewModelRef` / `lastAppTrendViewModelRef` / `lastHeatmapRowsRef` 保持组件实例内的单槽兜底，不上升为全局长期 cache。
  - [ ] `dataChartDimensionCache` 只保留 `overviewTrend` 和 `appTrend` 两个固定 key；以后若新增 chart key，必须先说明上限。
- [ ] Data heatmap：
  - [ ] limit 保持 2。
  - [ ] pending promise settle 后必须删除。
- [ ] Data app search：
  - [ ] `dataAppSearch.ts` 中的 `Map` 是单次计算临时对象，不应改成模块级持久 cache。
  - [ ] 搜索结果依赖 `useMemo` 即可，不新增跨页面搜索缓存。
- [ ] 如果页面必须 clone 大数组，写清原因和生命周期。

测试：

- [ ] 同 key 重复预热 N 次后 cache size 不变。
- [ ] 不同 key 超限后驱逐旧项。
- [ ] pending promise 不泄漏。
- [ ] app 搜索去重和过滤行为继续由 `tests/dataAppSearch.test.ts` 覆盖。

验证：

```powershell
npm run test:warmup
npm run test:data-range
npm run test:data
npm run test:data-chart
npm run test:history-timeline
```

验收：

- [ ] 预热可以发生，但不累积同类旧数据。
- [ ] 页面切换后 cache count 保持在上限内。

### 9.3 意图驱动的 chunk preload

Owner：

- [ ] `src/app/components/AppSidebar.tsx`
- [ ] `src/app/services/viewChunkPreloadService.ts`
- [ ] `src/app/AppShell.tsx`

执行步骤：

- [ ] 保留 nav hover/focus/pointer 的 chunk preload。
- [ ] 确认 chunk preload 不触发 SQL read model。
- [ ] 如果 chunk preload 和 heavy data 目前耦合，拆开。
- [ ] 加测试防止 hover/focus 触发 heavy data fetch。

验证：

```powershell
npm run test:preload
npm run test:warmup
```

验收：

- [ ] 鼠标移到导航可以准备页面代码。
- [ ] 鼠标移到导航不会跑 Dashboard / History / Data SQL heavy prewarm。

## 10. 阶段 4：Settings 存储快照改为手动刷新

目的：移除低频页面的自动目录扫描。

Owner：

- [ ] `src/features/settings/hooks/useSettingsPageState.ts`
- [ ] `src/features/settings/components/SettingsDataSafetyPanel.tsx`
- [ ] 如需文案，修改 `src/shared/copy/domains/settingsCopy.ts`

执行步骤：

- [ ] 删除或禁用打开 Settings 时自动执行的：
  - [ ] `useEffect(() => void refreshStorageSnapshot(), [refreshStorageSnapshot])`
- [ ] 保留 `refreshStorageSnapshot` 函数。
- [ ] Data Safety panel 增加明确手动操作：
  - [ ] 例如“检查存储”或“刷新”。
  - [ ] 使用 Quiet Pro 现有按钮/图标风格。
- [ ] 初始状态：
  - [ ] 不显示 size 为 `0` 造成误解。
  - [ ] 显示“未检查”或等价轻量状态。
  - [ ] 不使用 `aria-busy={!storageSnapshot}` 表达永久 loading。
- [ ] 需要 snapshot 的操作：
  - [ ] 如果没有 snapshot，先刷新再继续。
  - [ ] 或禁用操作并提示先检查。
- [ ] 迁移 preview / restore default / clear cache 流程保持安全。
- [ ] 更新 UI smoke 里对 storage busy 的断言。

测试：

- [ ] Settings 打开不调用 `getStorageSnapshot`。
- [ ] 点击手动刷新会调用 `getStorageSnapshot`。
- [ ] storage action 没有 snapshot 时行为明确。
- [ ] UI smoke 更新。

验证：

```powershell
npm run test:settings
npm run test:ui-smoke
npm run test:ui-browser-smoke
```

验收：

- [ ] Settings 打开不自动扫 storage。
- [ ] 手动刷新后正常显示容量和路径状态。
- [ ] 存储迁移/清理流程不回退。

## 11. 阶段 5：保守后台资源释放

目的：后台长时间停留时释放重资源，但不牺牲短时间打开手感。

Owner：

- [ ] Rust main window lifecycle：`src-tauri/src/app/main_window.rs`
- [ ] 前端重缓存释放：已有 `clearDataHeavyCaches`
- [ ] 不新增策略 owner，除非现有 owner 明显不够。

执行步骤：

- [ ] 复核现有 `background_optimization` 设置。
- [ ] 复核主窗口 hide/destroy 逻辑。
- [ ] 默认保持保守，不突然默认打开激进销毁。
- [ ] 如果调整释放时间：
  - [ ] 保留 generation/token 防护。
  - [ ] 短时间反复打开关闭必须走快速复用。
  - [ ] 不激进销毁 Widget。
- [ ] 如果在后台清前端缓存：
  - [ ] 只清 heavy cache。
  - [ ] 不清 draft。
  - [ ] 不清用户正在编辑的 Settings/Mapping 状态。

测试：

```powershell
npm run test:background-return
```

手动 smoke：

- [ ] 最小化到 Widget。
- [ ] 等待释放阈值。
- [ ] 重新打开主窗口。
- [ ] 确认窗口打开正常。
- [ ] 确认页面状态没有不合理丢失。

验收：

- [ ] 后台释放保守且可解释。
- [ ] 主窗口重新打开体验可接受。
- [ ] 不丢用户草稿。

## 12. 阶段 6：复测和回归检查

目的：用阶段 0 的同一场景比较前后。

执行步骤：

- [ ] 使用同一种启动方式复测 visible start。
- [ ] 使用同一种启动方式复测 hidden autostart。
- [ ] 记录 30 秒、1 分钟、5 分钟资源。
- [ ] 执行页面场景：
  - [ ] Settings 打开。
  - [ ] Settings 手动刷新 storage。
  - [ ] History 打开。
  - [ ] Data 打开。
  - [ ] Dashboard 返回。
- [ ] 如时间允许，做 1 小时隐藏启动 soak。
- [ ] 记录 diagnostics：
  - [ ] Rust cache counts。
  - [ ] Frontend cache counts。
  - [ ] Web Activity active/rejected/timeout。
  - [ ] updater package retained state。

验收目标：

- [ ] hidden autostart 不跑完整 heavy warmup。
- [ ] hidden autostart Private 不明显高于阶段 0。
- [ ] visible start 打开体验不明显变差。
- [ ] cache counts 不超过上限。
- [ ] 线程数和句柄数短期不持续上涨。
- [ ] 空闲 CPU 保持低。

不能接受：

- [ ] 为了降低内存让主窗口打开明显变慢。
- [ ] 为了降低内存破坏 tracking。
- [ ] diagnostics 需要普通用户看内部技术字段。

## 13. 验证矩阵

开发中按触及范围运行专项测试：

- [x] cache limit：

```powershell
npm run test:warmup
```

- [x] Data trend / heatmap：

```powershell
npm run test:data-range
npm run test:data
```

- [x] 图标 cache：

```powershell
npm run test:dashboard-icons
```

- [x] Settings 手动刷新：

```powershell
npm run test:settings
```

- [x] 后台释放：

```powershell
npm run test:background-return
```

- [x] chunk preload：

```powershell
npm run test:preload
```

- [x] Tools alerts：

```powershell
npm run test:tools
```

- [x] Rust runtime / cache / updater / web activity：

```powershell
npm run check:rust
```

最终交付前：

```powershell
npm run check
```

如果包含 Rust runtime、updater、Web Activity 或跨层 diagnostics：

```powershell
npm run check:full
```

## 14. 推荐执行顺序

- [x] 阶段 0：基线测量。
- [x] 阶段 1：内部 diagnostics。
- [x] 阶段 2.1：读模型 cache limit 改为 `1 / 7 / 2 / 2`。
- [x] 阶段 2.2：前端 icon cache 上限。
- [x] 阶段 2.3：Rust icon negative cache 上限。
- [x] 阶段 2.4：tracking capture-title cache 上限。
- [x] 阶段 2.5：Tools alerts 上限。
- [x] 阶段 2.6：updater 下载包临时文件化。
- [x] 阶段 2.7：Web Activity hard cap。
- [x] 阶段 3：无累积预热。
- [x] 阶段 4：Settings storage 手动刷新。
- [x] 阶段 5：保守后台资源释放。
- [ ] 阶段 6：复测。

阶段 6 备注：严格前后资源复测需要运行当前源码版桌面应用。因为当前 dev 配置使用正式 identifier，直接运行会复用正式数据目录和 tracking runtime，本轮不强行启动第二个真实 tracker；发布候选包或隔离 identifier 环境下再执行。

排序理由：

- [ ] diagnostics 先行，后续增长才可归因。
- [ ] cache limit 风险低、收益直接、测试容易。
- [ ] Rust 长期缓存和 updater/web activity 直接针对 14 小时后 Private 上涨。
- [ ] warmup 改造放在 cache limit 之后，避免重构时仍保留无上限数据。
- [ ] Settings storage 手动刷新独立且低频，适合单独收口。
- [ ] 后台 WebView 释放最容易影响手感，最后做。

## 15. 回滚方案

如果某阶段产生不可接受回归：

- [ ] 只回滚该阶段。
- [ ] diagnostics 如果正确且无害，优先保留。
- [ ] cache limit 如果测试和体验稳定，优先保留。
- [ ] warmup mode 导致打开变慢时，先恢复 warmup 顺序，但保留固定 cache slot。
- [ ] updater 文件化导致安装/重试不稳定时，只回滚 updater 文件化。
- [ ] 后台释放影响重新打开时，只关闭或回滚阶段 5。

禁止：

- [ ] 用破坏性 git 命令回滚。
- [ ] 回滚无关用户改动。
- [ ] 把回滚和新优化混在一个步骤里。

## 16. 实施前待定问题

- [x] 前端 app icon cache 初始 limit 用 `128`、`256` 还是其他值？
- [x] Rust icon negative cache 初始 limit 用 `256`、`512` 还是其他值？
- [x] diagnostics 用 dev-only global、内部 command，还是两者都有？
- [x] hidden autostart 是否跳过所有 chunk preload，还是只跳过 heavy read model？
- [x] Tools snapshot 是否仅 visible 时预热？
- [x] updater 临时包应该落在哪个 app cache 目录？

默认建议：

- [x] 前端 icon cache limit：`256`。
- [x] missing icon retry limit：`256`。
- [x] Rust icon negative cache limit：`512`。
- [x] tracking capture-title cache limit：`256`。
- [x] Tools alert limit：`32`。
- [x] diagnostics：内部 command + dev-only frontend global。
- [x] hidden autostart：跳过 heavy read model 和非必要 chunk。
- [x] Settings storage snapshot：只手动刷新。

## 17. 最终验收

只有全部满足才算完成：

- [x] cache size 由测试固定。
- [x] diagnostics 能暴露关键 cache/resource 计数。
- [x] hidden autostart 不再跑完整 heavy startup warmup。
- [x] 主窗口打开主观体验不明显变慢。
- [x] Settings storage scan 改为手动。
- [x] 长时间运行增长有上限或能被 diagnostics 定位。
- [x] 必要验证命令通过。
- [ ] 有阶段 0 和阶段 6 的前后测量。
- [ ] 如果进入发布，最终 scope 被整理进 `CHANGELOG.md`。

阶段 6 和 `CHANGELOG.md` 不作为本次代码执行单归档阻塞：前者需要隔离运行环境，后者只在进入发布流程时执行。
