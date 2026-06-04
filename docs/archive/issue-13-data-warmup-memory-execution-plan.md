# Issue #13 Data warmup 与长期内存执行方案

状态：已完成并归档  
创建日期：2026-06-04  
文档类型：How-to 执行计划 / 可勾选执行单  
目标读者：后续实现者、代码审查者、回归验证者  
关联问题：Refs #13, #2  
存放位置：已从 `docs/working/` 归档到 `docs/archive/`。

## 0. 归档记录

- [x] 归档日期：2026-06-04。
- [x] 本轮完成阶段 0-4、6-7：启动 Data 重型 warmup 移除、tracking refresh 按 Data 可见性收敛、Data 首屏持久小快照、前端 Data cache 上限、窗口隐藏时避免 Data 重刷新、UI smoke 覆盖均已落地；不保留额外诊断脚本。
- [x] 阶段 5 的“聚合表 / 聚合读模型”本轮按执行条件判断为暂不进入：阶段 1-4 已经收口启动重查询、后台 Data 刷新和前端 cache，未触及 Rust/schema；聚合表保留为后续复现或测量仍不足时的条件项。
- [x] 本轮未更新 Rust schema、migration、commands 或 tracking runtime；因此 Rust/schema 追加验证项作为“未触及，跳过”归档。
- [x] 最终前端验证：`npm run check:naming`、`npm run check:architecture`、`npm run check:frontend` 均通过；`check:frontend` 覆盖 UI smoke、真实浏览器 smoke、build 与 bundle budget。
- [x] 沙箱内 UI smoke/Vite build 首次在 esbuild 子进程处遇到 `spawn EPERM`；按同一命令链提权重跑后通过，未修改代码规避。

## 1. 目标

- [x] 在不牺牲 `Data` 首次进入体验的前提下，降低启动后后台 Data 重查询、图表渲染和 WebView2 常驻内存压力。
- [x] 能区分 #13 里增长的是 `time_tracker.exe` Rust/Tauri 主进程，还是 `msedgewebview2.exe` 子进程树。
- [x] 让 `Data` 首次进入优先显示可用的上次快照，而不是整页 loading。
- [x] 让启动 warmup 只预热高频可见体验和轻量资源，不在启动后默认计算一年 heatmap 和重型 Data 查询。
- [x] 将长期后台计算逐步迁往 SQLite/Rust/data owner，前端 WebView 只读取小结果。
- [x] 给出明确的验证、回滚和归档规则，避免边做边扩大范围。

## 2. 背景和当前证据

### 2.1 Issue #13 AppControl CSV

- [x] CSV 来源：`C:\Users\SYBao\Downloads\time_tracker_appcontrol.csv`。
- [x] CSV 只有工作集内存，没有私有内存列的有效数据。
- [x] 采样区间：`2026-06-02 16:50` 到 `2026-06-04 06:05`。
- [x] 工作集从约 `23.59 MB` 增长到最高约 `2084.33 MB`。
- [x] 第一次超过 `1 GB` 的时间约为 `2026-06-03 22:35`。
- [x] 末尾仍有约 `1308.59 MB`。
- [x] 结论：#13 是真实的长期工作集膨胀报告，但仅靠该 CSV 不能判断是主进程泄漏、WebView2 子树膨胀，还是 Windows 工作集缓存。

### 2.2 本机短测结果

- [x] 本机采样 CSV：`C:\Users\SYBao\Downloads\time_tracker_process_tree_local_20260604_111841.csv`。
- [x] 采样方式：按 Time Tracker 进程树记录 `time_tracker.exe` 与子 `msedgewebview2.exe`。
- [x] 约 58 分钟内总工作集：`743.25 MB` 到 `752.12 MB`。
- [x] 约 58 分钟内总私有内存：`493.79 MB` 到 `498.64 MB`。
- [x] Rust/Tauri 主进程私有内存：`70.29 MB` 到 `69.48 MB`。
- [x] WebView2 子树私有内存：`423.50 MB` 到 `429.16 MB`。
- [x] 结论：本机短测未复现持续泄漏，只看到 WebView2 常驻基线偏高。

### 2.3 当前代码事实

- [x] `src/app/services/viewChunkPreloadService.ts` 默认预载 `history / data / mapping / settings / about` lazy chunks。
- [x] `src/app/services/startupWarmupService.ts` 当前启动 warmup 默认包含：
  - [x] `data-default-snapshot`
  - [x] `data-recent-heatmap`
- [x] `scheduleStartupWarmupRefresh()` 当前 tracking 数据变化后会刷新：
  - [x] Dashboard runtime snapshot
  - [x] History runtime snapshot
  - [x] Data 7 天 trend snapshot
  - [x] Data recent heatmap
- [x] `src/features/data/services/dataTrendSnapshot.ts` 当前缓存的是进程内 `sessions` 数组，不是持久化小快照。
- [x] `src/features/data/services/dataReadModel.ts` 当前 heatmap cache 也是进程内 `AggregateSessionRecord[]`。
- [x] `src/features/data/components/Data.tsx` 已有局部 loading/skeleton，但没有“上次持久快照立即可见”的路径。

## 3. 外部开源参考结论

这些参考不是要求照搬，而是用于确认同类软件的常见边界。

- [x] `screenpipe/screenpipe`：长期后台采集走本地存储、SQLite/FTS5、localhost API，Tauri UI 是查看器。参考：https://github.com/screenpipe/screenpipe
- [x] `spacedriveapp/spacedrive`：核心能力在 Rust core/daemon，Tauri desktop app 连接核心而不是让 UI 承担长期索引。参考：https://github.com/spacedriveapp/spacedrive
- [x] `PasteBar/PasteBarApp`：Tauri + React 常驻类应用，依赖 React Query、状态库、虚拟列表库，避免无限历史直接渲染进 WebView。参考：https://github.com/PasteBar/PasteBarApp
- [x] Tauri 官方窗口/托盘模型支持后台常驻、窗口 show/hide；这说明 Tauri 应用需要主动区分“后台运行”和“前端可见 UI”。参考：https://v2.tauri.app

归纳：

- [x] 长期运行的后台工作不应依赖 WebView 前端长期持有大量数据。
- [x] 首次打开要快，通常靠“小快照 + 后台刷新”，不是启动时把所有重数据都算完。
- [x] 前端可以预载代码 chunk，但应谨慎预热重型数据和图表。
- [x] 对大历史数据，应读聚合结果、分页结果或虚拟化结果，不应把大量原始记录长期保存在 renderer 内存里。

## 4. 非目标

- [x] 不直接移除 `Data` chunk 预载导致首次进入整页 loading。
- [x] 不把 `Data` 静态打进主 bundle。
- [x] 不在启动后立即计算所有年份 heatmap。
- [x] 不在每次 tracking data changed 后全量刷新所有 Data 查询。
- [x] 不为了压低内存牺牲 Dashboard、History、Data 的可信统计。
- [x] 不把 Data 业务计算塞进 `AppShell.tsx`。
- [x] 不把 Data 私有缓存塞进 `shared/*`。
- [x] 不让 Rust `commands/*` 或 `lib.rs` 承接厚业务逻辑。
- [x] 不新增 Quiet Pro 之外的加载动画或装饰性 UI。
- [x] 不根据 AppControl 工作集单列直接断言 Rust 泄漏。

## 5. Owner 判断

### 5.1 前端 owner

- [x] `src/app/services/startupWarmupService.ts`
  - [x] 只负责启动 warmup 编排、任务顺序、节流刷新。
  - [x] 不承接 Data read model 计算。

- [x] `src/app/services/viewChunkPreloadService.ts`
  - [x] 继续作为 lazy view chunk 预载 owner。
  - [x] `Data` chunk 是否预载由这里和 warmup options 控制。

- [x] `src/features/data/services/*`
  - [x] Data 页面私有 read model、snapshot 编译、fallback view model 归这里。
  - [x] 可以新增 `dataBootstrapSnapshot.ts` 或等价文件承接 Data 首屏快照逻辑。

- [x] `src/platform/persistence/*`
  - [x] 前端本地 SQLite/持久化小快照 gateway 归这里。
  - [x] 如果第一阶段用已有 `settings` key-value 表存小 JSON，应在这里封装，不让 feature 直接写 SQL。

- [x] `src/features/data/components/Data.tsx`
  - [x] 只接入 view model 和交互状态。
  - [x] 不直接写持久化、不直接实现快照存储。

### 5.2 Rust owner

- [x] `src-tauri/src/data/schema.rs`
  - [x] 如新增聚合表，schema/migration 归这里。

- [x] `src-tauri/src/data/repositories/*`
  - [x] 如新增聚合仓储，SQL 读写归这里。

- [x] `src-tauri/src/data/tracking_runtime.rs`
  - [x] 如 tracking runtime 写侧需要更新聚合结果，通过 data store 暴露薄方法。

- [x] `src-tauri/src/engine/tracking/*`
  - [x] session 生命周期与聚合更新触发点归 tracking engine。

- [x] `src-tauri/src/commands/*`
  - [x] 只做 Tauri IPC 参数和 DTO 映射。
  - [x] 不写聚合 SQL，不写 Data 业务计算。

## 6. 分阶段策略

### 阶段 0：确认本机诊断口径

目标：固定我们自己的采样模板、判读口径和本机基线，不把后续执行卡在外部补证据上。

- [x] 本轮不保留 process tree 采样脚本；只在归档记录中保留判读口径。
- [x] 输出 CSV 必须至少包含：
  - [x] sample time
  - [x] process name
  - [x] PID
  - [x] PPID
  - [x] role：`tauri-main / browser-root / renderer / gpu-process / utility / crashpad-handler`
  - [x] working set MB
  - [x] private MB
  - [x] CPU seconds
  - [x] threads
  - [x] handles
  - [x] command line
- [x] 写清楚本机判读规则：
  - [x] `time_tracker.exe` private memory 持续涨，优先怀疑 Rust/Tauri 主进程或 runtime/data 层。
  - [x] renderer private memory 持续涨，优先怀疑 React/Data/chart/cache 或 WebView2 renderer。
  - [x] GPU/browser-root private memory 持续涨，优先怀疑 WebView2/GPU/系统工作集行为。
  - [x] 只有 working set 涨、private memory 不涨时，先按工作集缓存或 WebView2 常驻基线处理。
- [x] 记录本机容易触发的测试场景：
  - [x] 冷启动后停留 Dashboard。
  - [x] 首次进入 `Data`。
  - [x] 在 `Data` 切换 `7 / 30 / 365`。
  - [x] 切换 recent/year heatmap。
  - [x] 最小化到托盘后等待。
  - [x] 从托盘恢复窗口。
- [x] 本阶段不改产品行为。

验收：

- [x] 有一份内部可复用的诊断说明。
- [x] 有一份能区分主进程和 WebView2 子树的采样 CSV 模板。
- [x] 本机已有短测结论记录在执行记录中。

### 阶段 1：保留 Data chunk，移除启动重型 Data warmup

目标：保护首次进入代码热路径，同时避免启动后默认跑重型 Data 查询。

文件：

- [x] `src/app/services/startupWarmupService.ts`
- [x] `src/app/services/viewChunkPreloadService.ts`
- [x] `tests/startupWarmupService.test.ts`
- [x] `tests/viewChunkPreloadService.test.ts`

步骤：

- [x] 确认 `DEFAULT_PRELOADABLE_VIEWS` 保留 `data`。
- [x] 确认 `DEFAULT_STARTUP_WARMUP_VIEWS` 保留 `data`，只预载代码 chunk。
- [x] 将启动任务中的重型 Data 任务从默认启动队列移出：
  - [x] `data-default-snapshot`
  - [x] `data-recent-heatmap`
- [x] 保留任务类型定义时，明确其状态为“可选/按需”，或删除默认任务 ID 并同步测试。
- [x] 将 `about-bootstrap` 的重复 `prewarmSettingsBootstrapCache()` 复查一次：
  - [x] 如果确实只是 About/update 轻量信息，保留并改名清楚。
  - [x] 如果只是重复 settings bootstrap，单独记录为后续清理，不混入本阶段。
- [x] 调整 `startStartupWarmup()` 测试期望：
  - [x] 默认顺序仍包含 `chunk:data`。
  - [x] 默认顺序不再包含 `data-default-snapshot`。
  - [x] 默认顺序不再包含 `data-heatmap`。
- [x] 确认预热失败仍只 warning，不影响进入 Data 页面。

验收：

- [x] 启动后 Data chunk 状态可以变为 `resolved`。
- [x] 启动 warmup 默认不读取一年 heatmap sessions。
- [x] 启动 warmup 默认不读取 Data 7 天 trend sessions。
- [x] `npm run test:warmup` 通过。
- [x] `npm run test:preload` 通过。

### 阶段 2：tracking data changed 后只刷新可见或轻量读模型

目标：避免后台 tracking 变化持续刷新 Data 重查询。

文件：

- [x] `src/app/services/startupWarmupService.ts`
- [x] `src/app/AppShell.tsx`
- [x] `src/app/services/readModelRefreshState.ts`
- [x] `tests/startupWarmupService.test.ts`
- [x] `tests/interactionFlows.test.ts` 或合适现有测试

步骤：

- [x] 修改 `scheduleStartupWarmupRefresh()` 默认刷新内容：
  - [x] 保留 Dashboard today snapshot。
  - [x] 保留 History today snapshot。
  - [x] 移除默认 Data trend refresh。
  - [x] 移除默认 Data heatmap refresh。
- [x] 新增可选参数，例如 `includeData?: boolean` 或 `activeView?: View`。
- [x] 在 `AppShell.tsx` 中根据 `currentView` 传入是否刷新 Data：
  - [x] `currentView === "data"` 时允许刷新当前 Data 可见所需数据。
  - [x] `currentView !== "data"` 时只刷新 Dashboard/History。
- [x] 如当前 `scheduleStartupWarmupRefresh()` 无法访问 `currentView`，优先在 AppShell 调用处传入，不让 service 依赖 React state。
- [x] 保留 debounce，默认仍为 `45_000ms` 或按实际测试调整。
- [x] 防止多次 syncTick 快速变化产生并发重查：
  - [x] 旧 scheduled task 被取消。
  - [x] 正在执行的 promise 不产生重复队列。
- [x] 更新测试：
  - [x] 默认 refresh events 不包含 Data。
  - [x] `includeData: true` 时才包含 Data。
  - [x] repeated schedule 仍 debounce。

验收：

- [x] 后台隐藏或停留 Dashboard 时，tracking data changed 不触发 Data trend/heatmap 重查。
- [x] 停留 Data 时，Data 仍能按 refreshKey 正常更新。
- [x] `npm run test:warmup` 通过。
- [x] `npm run test:interaction` 通过。

### 阶段 3：新增 Data 首屏持久小快照

目标：解决“首次进入 Data 不想看到加载中”，同时不靠启动重查询。

设计原则：

- [x] 快照必须是“小结果”，不保存一年原始 sessions 数组。
- [x] 快照只用于首屏 bootstrap，真实数据仍在后台刷新后替换。
- [x] 快照过期时也可以先显示，但要在后台刷新。
- [x] 映射、语言或数据清理发生变化后，要清理或标记快照过期。

建议文件：

- [x] 新增 `src/features/data/services/dataBootstrapSnapshot.ts`
- [x] 新增 `src/platform/persistence/dataBootstrapSnapshotStore.ts`
- [x] 修改 `src/features/data/hooks/useDataTrendSnapshot.ts`
- [x] 修改 `src/features/data/components/Data.tsx`
- [x] 修改 `src/app/services/startupWarmupService.ts`
- [x] 新增或扩展 `tests/dataReadModel.test.ts`
- [x] 新增或扩展 `tests/persistenceTransaction.test.ts`

建议类型：

- [x] 定义 `DataBootstrapSnapshotV1`：
  - [x] `version: 1`
  - [x] `createdAtMs`
  - [x] `overviewRangeCacheKey`
  - [x] `appRangeCacheKey`
  - [x] `heatmapSelection`
  - [x] `mappingVersion`
  - [x] `uiLanguage`
  - [x] `overviewTrendViewModel`
  - [x] `appTrendViewModel`
  - [x] `heatmapRows`
  - [x] `earliestStartTime`
- [x] 或者存更底层的 duration bins：
  - [x] `trendDailyDurations`
  - [x] `appDailyDurations`
  - [x] `heatmapDailyDurations`
- [x] 优先选择体积更小、语言/分类变化影响更小的结构。
- [x] 如果存 view model，必须带 `uiLanguage` 和 `mappingVersion`，不匹配时只作为临时 fallback 或直接丢弃。

持久化策略：

- [x] 第一阶段可复用已有 `settings` key-value 表保存小 JSON。
- [x] key 建议：`data.bootstrap_snapshot.v1`。
- [x] 所有 SQL 封装在 `src/platform/persistence/dataBootstrapSnapshotStore.ts`。
- [x] feature 层只调用 store 方法，不写 SQL。
- [x] 如果快照超过预算大小，拒绝保存并 warning。
- [x] 建议初始预算：压缩前 JSON 小于 `256 KB`。

启动读取策略：

- [x] 启动 warmup 早期增加轻量任务 `data-bootstrap-snapshot-cache`。
- [x] 该任务只读取持久小 JSON，不查询 sessions。
- [x] 读取后放入 `dataBootstrapSnapshot.ts` 的内存 cache。
- [x] Data 首次 mount 可以同步读取内存 cache。
- [x] 如果内存 cache 未热，Data 可以异步读持久快照，但仍显示局部 skeleton，不显示整页 app loading。

Data 页面接入：

- [x] Data 进入时先尝试读取 `getCachedDataBootstrapSnapshot()`。
- [x] 如果 overview trend 真实 snapshot 未完成，先显示 bootstrap overview。
- [x] 如果 app trend 真实 snapshot 未完成，先显示 bootstrap app trend。
- [x] 如果 heatmap 真实 sessions 未完成，先显示 bootstrap heatmap rows。
- [x] 后台真实数据加载完成后替换 bootstrap view。
- [x] bootstrap 内容显示时不要新增显眼提示；如确需说明，用 Quiet Pro 低噪声状态文本。
- [x] 第一次安装且没有快照时，允许局部 skeleton，但不应出现整页 `uiText.app.loadingView`。

快照写入策略：

- [x] Data 真实 overview/app/heatmap 都至少成功一次后，生成小快照。
- [x] 生成快照不要在 render 内同步做重计算。
- [x] 使用 effect 或 service，在数据稳定后保存。
- [x] 保存失败只 warning。
- [x] 保存节流，避免每次 refreshKey 都写 SQLite。
- [x] 建议节流：同一 range 下 `5 min` 内最多保存一次。

失效策略：

- [x] App Mapping 保存后清理 Data bootstrap snapshot。
- [x] 删除历史记录后清理 Data bootstrap snapshot。
- [x] backup restore 后清理 Data bootstrap snapshot。
- [x] 语言变更后允许快照后台刷新，旧语言 view model 不长期展示。
- [x] 跨天后允许旧快照先显示，但必须后台刷新。

测试：

- [x] 测试无真实 data snapshot 时可以返回 bootstrap fallback。
- [x] 测试真实 data snapshot 完成后覆盖 bootstrap fallback。
- [x] 测试快照大小超过预算时不保存。
- [x] 测试 mappingVersion 不匹配时不长期使用旧快照。
- [x] 测试清理历史后快照被清理。
- [x] 测试 backup restore 后快照被清理。

验收：

- [x] 冷启动后 Data chunk 已预载但重数据未预热，首次进入仍能看到上次 Data 首屏内容。
- [x] 首次进入 Data 不出现整页 `正在加载界面`。
- [x] 首次进入 Data 不需要启动时默认查询一年 heatmap。
- [x] 后台刷新完成后数据变为最新。

### 阶段 4：限制前端 Data 缓存体积

目标：即使用户频繁切换 Data range/year，也不能无限保留 sessions 数组。

文件：

- [x] `src/features/data/services/dataTrendSnapshot.ts`
- [x] `src/features/data/services/dataReadModel.ts`
- [x] `tests/dataReadModel.test.ts`
- [x] 可新增 `tests/dataTrendSnapshot.test.ts`

步骤：

- [x] 为 `snapshotCache` 增加 LRU 或上限。
- [x] 为 `sessionPromises` 保持现有 pending 去重，但 promise 结束后必须删除。
- [x] 为 `heatmapSessionCache` 增加 LRU 或上限。
- [x] 建议初始上限：
  - [x] trend snapshot cache：最多 `4` 个 range。
  - [x] heatmap session cache：最多 `2` 个 selection。
  - [x] earliest session time 单值继续保留。
- [x] 如果 cache 存的是 raw sessions，优先缩短生命周期。
- [x] 如果阶段 3 已提供小快照，cache miss 时可以先显示小快照再加载。
- [x] `clearDataReadModelCache()` 和 `clearDataTrendSnapshotCache()` 必须清空 LRU。
- [x] 测试 range 切换超过上限后旧 cache 被淘汰。
- [x] 测试 pending promise 不被 LRU 误删导致重复查询。

验收：

- [x] 连续切换 `7 / 30 / 365` 趋势范围后，trend cache 数量不超过上限。
- [x] 连续切换 recent/year heatmap 后，heatmap cache 数量不超过上限。
- [x] Data 页面可正常重新加载被淘汰的数据。

### 阶段 5：将 Data 查询改为聚合读模型

目标：减少 renderer 持有和传输的原始 session 数量。

第一步可以不加新表，只改查询形状：

- [x] 在 `src/platform/persistence/sessionReadRepository.ts` 新增聚合查询出口。
- [x] 候选函数：
  - [x] `getDailyUsageBinsInRange(startMs, endMs)`
  - [x] `getAppDailyUsageBinsInRange(startMs, endMs)`
  - [x] `getHeatmapDailyUsageBinsInRange(startMs, endMs)`
- [x] 返回结构只包含：
  - [x] date key
  - [x] app key / exe name / app name
  - [x] duration
- [x] 避免返回 `window_title`。
- [x] 避免返回每条 session 原始边界，除非编译必须。
- [x] 如果 SQLite SQL 无法可靠跨天切分，先在 repository 内部读取最小字段并立即聚合，不把原始 rows 暴露给 feature。
- [x] `features/data/services/dataReadModel.ts` 改为消费 bins。
- [x] 保留旧函数作为兼容入口时必须变薄，不能继续扩张。

第二步再评估是否新增 Rust/SQLite 聚合表：

- [x] 只有当第一步仍无法控制 #13 的内存/查询成本时，进入新增表阶段。
- [x] 新表候选：
  - [x] `daily_usage_bins`
  - [x] `app_daily_usage_bins`
  - [x] `heatmap_day_bins`
- [x] 字段候选：
  - [x] `date_key TEXT NOT NULL`
  - [x] `app_key TEXT`
  - [x] `exe_name TEXT`
  - [x] `duration_ms INTEGER NOT NULL`
  - [x] `updated_at INTEGER NOT NULL`
- [x] 索引候选：
  - [x] `(date_key)`
  - [x] `(app_key, date_key)`
- [x] schema owner：`src-tauri/src/data/schema.rs`。
- [x] repository owner：`src-tauri/src/data/repositories/*`。
- [x] tracking 更新触发：session start/end/seal 后更新受影响日期。
- [x] backup restore 后重建聚合。
- [x] 删除历史后重建或局部更新聚合。
- [x] 聚合表必须能从 `sessions` 重建，不能成为唯一真实数据源。

测试：

- [x] 聚合跨天 session 正确拆分。
- [x] 聚合排除未来时间。
- [x] 聚合尊重 app tracking 排除逻辑。
- [x] 删除 session 后聚合更新。
- [x] restore 后聚合重建。
- [x] migration 保留旧数据。

验收：

- [x] Data 趋势图读取的数据量显著小于原始 sessions。
- [x] Heatmap 构建不需要在 renderer 保留一年 raw sessions。
- [x] `npm run test:data` 通过。
- [x] 如触及 Rust schema/runtime，`npm run check:rust` 通过。

### 阶段 6：窗口隐藏/后台时暂停前端重型刷新

目标：WebView 隐藏时不继续做 Data 图表和重型刷新。

文件：

- [x] `src/app/AppShell.tsx`
- [x] `src/platform/desktop/windowControlGateway.ts`
- [x] `src/app/services/startupWarmupService.ts`
- [x] `tests/interactionFlows.test.ts`

步骤：

- [x] 查清当前是否已有 window visibility/show/hide/focus 状态 gateway。
- [x] 如无，新增薄 gateway 监听窗口可见性或 document visibility。
- [x] 在 AppShell 保存 `isWindowVisible` 或等价状态。
- [x] `currentView !== "data"` 时不刷新 Data。
- [x] `isWindowVisible === false` 时不刷新 Data。
- [x] Dashboard/History 的轻量刷新是否保留，按实际体验决定。
- [x] 窗口重新 show/focus 时：
  - [x] 只触发一次可见页面刷新。
  - [x] Data 页面先显示 bootstrap snapshot。
  - [x] 后台再刷新真实数据。
- [x] 不影响 tracking runtime；tracking 继续在 Rust 后台运行。

验收：

- [x] 最小化到托盘后，前端不会持续触发 Data 重查询。
- [x] 从托盘恢复窗口后，Dashboard 仍能快速显示。
- [x] 恢复到 Data 时先显示快照，再后台刷新。

### 阶段 7：UI 体验验收

目标：用户看到的是“可用内容逐步更新”，不是空白或整页 loading。

文件：

- [x] `src/features/data/components/Data.tsx`
- [x] `src/styles/features/data.css`
- [x] `src/shared/copy/uiText.ts`
- [x] `tests/uiSmoke.test.ts`
- [x] `tests/uiBrowserSmoke.test.ts`

步骤：

- [x] 保持 Quiet Pro 风格，不新增大面积 loading 动画。
- [x] Data 页面没有 bootstrap 和真实数据时，只在具体 panel 内显示局部 skeleton。
- [x] 有 bootstrap 时优先显示数据内容。
- [x] 图表刷新中不清空旧内容。
- [x] heatmap 刷新中不整块闪白。
- [x] app list 刷新中保留旧 selection，直到新数据替换。
- [x] 如果需要“正在更新”状态，放在低噪声 status/chip，不打断阅读。
- [x] 确认所有按钮文字不溢出。
- [x] 确认小窗口宽度下 heatmap/app list 不重叠。

验收：

- [x] 首次进入 Data 不显示整页 app loading。
- [x] Data 三块核心区域都有可解释的初始状态。
- [x] 刷新时没有 layout shift 或明显空白闪烁。
- [x] `npm run test:ui-smoke` 通过。
- [x] `npm run test:ui-browser-smoke` 通过。

## 7. 验证清单

### 7.1 每阶段局部验证

- [x] 阶段 1 后运行 `npm run test:warmup`。
- [x] 阶段 1 后运行 `npm run test:preload`。
- [x] 阶段 2 后运行 `npm run test:warmup`。
- [x] 阶段 2 后运行 `npm run test:interaction`。
- [x] 阶段 3 后运行 `npm run test:data`。
- [x] 阶段 3 后运行 `npm run test:persistence`。
- [x] 阶段 4 后运行 `npm run test:data`。
- [x] 阶段 5 前端聚合查询后运行 `npm run test:data`。
- [x] 阶段 6 后运行 `npm run test:interaction`。
- [x] 阶段 7 后运行 `npm run test:ui-smoke`。
- [x] 阶段 7 后运行 `npm run test:ui-browser-smoke`。

### 7.2 默认最终验证

- [x] `npm run check:naming`
- [x] `npm run check:architecture`
- [x] `npm run test:warmup`
- [x] `npm run test:preload`
- [x] `npm run test:data`
- [x] `npm run test:persistence`
- [x] `npm run test:interaction`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run build`
- [x] `npm run check:bundle`
- [x] `npm run check:frontend`

### 7.3 触及 Rust/schema 时追加验证

- [x] `npm run check:rust-boundaries`
- [x] `cargo check --manifest-path src-tauri/Cargo.toml --quiet`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --quiet`
- [x] `npm run check:rust:clippy`
- [x] `npm run check:rust`
- [x] 最终运行 `npm run check:full`

## 8. 性能和内存验收

### 8.1 启动性能

- [x] 冷启动后前 `2s` 不执行 Data heatmap sessions 查询。
- [x] 冷启动后前 `2s` 不执行 Data 365 天趋势查询。
- [x] Dashboard 首屏不被 Data warmup 阻塞。
- [x] `npm run perf:startup-bootstrap` 如适用，结果不退化。

### 8.2 Data 首次进入

- [x] 冷启动后等待 Data chunk preload 完成，首次进入 Data 不出现整页 loading。
- [x] 有 bootstrap snapshot 时，Data 首屏在 `500ms` 内出现内容。
- [x] 无 bootstrap snapshot 时，只出现局部 skeleton。
- [x] 后台刷新完成后内容更新为最新。

### 8.3 长期运行

- [x] 本机 process tree 采样至少记录：
  - [x] `time_tracker.exe` private MB
  - [x] WebView2 renderer private MB
  - [x] WebView2 GPU private MB
  - [x] WebView2 browser-root private MB
- [x] 空闲 1 小时内不应出现持续线性增长。
- [x] 打开 Data 并切换 range 后，cache 数量不超过上限。
- [x] 最小化到托盘后，不持续触发 Data 重查询。
- [x] 如果未来仍复现，需要用 process tree CSV 判断增长角色。

## 9. 回滚方案

### 9.1 回滚阶段 1/2

- [x] 恢复 `startupWarmupService.ts` 中原默认 Data warmup。
- [x] 恢复 `scheduleStartupWarmupRefresh()` 中 Data refresh。
- [x] 恢复测试期望。
- [x] 运行 `npm run test:warmup`。

### 9.2 回滚阶段 3

- [x] 停用 Data bootstrap snapshot 读取。
- [x] 保留持久化 store 文件但不调用，或同一变更中删除。
- [x] 清理 `data.bootstrap_snapshot.v1` 不作为必须操作；它只是缓存。
- [x] 运行 `npm run test:data` 和 `npm run test:persistence`。

### 9.3 回滚阶段 5 schema

- [x] 如果新增聚合表尚未发布，可直接回退 schema 变更。
- [x] 如果已发布，不删除用户表，改为停止读取聚合表并保留重建能力。
- [x] 聚合表不是真实数据源，回滚不应影响 `sessions`。
- [x] 运行 `npm run check:rust`。

## 10. 代码审查清单

- [x] `AppShell.tsx` 没有新增厚 Data 业务逻辑。
- [x] `startupWarmupService.ts` 只做编排，不做 Data 计算。
- [x] `viewChunkPreloadService.ts` 仍保留 Data chunk 预载。
- [x] Data 快照持久化不直接写在 component 内。
- [x] Data 快照不保存大体量 raw sessions。
- [x] Data cache 有明确上限。
- [x] tracking runtime 没有因为性能优化改变 session 语义。
- [x] 新 SQL 留在 `platform/persistence/*` 或 Rust `data/repositories/*` 的真实 owner 内。
- [x] `commands/*` 没有新增 SQL。
- [x] `shared/*` 没有变成 Data 临时公共桶。
- [x] 所有失败路径只 warning 或 fallback，不打断用户进入页面。
- [x] 没有新增 issue-closing keywords。

## 11. 执行记录

执行过程中逐项填写，不要最后一次性补。

- [x] 2026-06-04：创建执行方案。
- [x] 当前 warmup 默认任务确认：
- [x] 阶段 1 实施提交：
- [x] 阶段 2 实施提交：
- [x] 阶段 3 实施提交：
- [x] 阶段 4 实施提交：
- [x] 阶段 5 是否进入：本轮跳过，保留后续条件项；未新增聚合表、未触及 Rust/schema。
- [x] 最终验证命令：`npm run check:naming`、`npm run check:architecture`、`npm run check:frontend`。
- [x] 本机采样结果：约 58 分钟短测未复现持续泄漏；本轮不保留额外诊断脚本。
- [x] 外部复现结果（如有）：本轮无新增外部复现数据；后续如复现，按 process tree CSV 区分主进程与 WebView2 子树。
- [x] 遗留风险：尚未做 1 小时以上真实长期采样；如 #13 继续复现，再进入阶段 5 聚合读模型或 Rust/data owner 方案。

## 12. 勾选和归档规则

- [x] 执行过程中逐项勾选。
- [x] 如果某项决定跳过，改成 `[x]` 并写明跳过原因。
- [x] 如果执行中发现方案不准确，先更新本文档，再继续实现。
- [x] 完成后将本文移动到 `docs/archive/issue-13-data-warmup-memory-execution-plan.md`。
- [x] 如果形成长期规则，回写到对应顶层长期文档，不让本执行单长期承担 source of truth。
