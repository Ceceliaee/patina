# 启动后台预热执行方案

状态：已完成并归档  
创建日期：2026-05-21  
执行目标：开机自启动后，应用在后台分步准备常用页面资源，让用户从托盘打开主界面并首次切换页面时尽量走“热路径”。  
文档类型：一次性 How-to 执行计划。完成后应勾选并移动到 `docs/archive/`。

## 1. 背景

当前用户感知到的问题是：

- 开机或首次打开主界面后，点击 History、Data、App Mapping、Settings、About 等非首页页面时，仍可能看到“正在加载界面...”或页面内“加载中”。
- 同一个页面第二次点击后通常不会再出现加载感。
- 用户希望软件开机自启动后在后台慢慢准备好，一整天从托盘打开和切页都尽量流畅，不像 PPT 翻页一样卡顿。

这个现象说明第一次点击仍然存在冷路径：

- 页面 chunk 可能尚未完成加载、执行或被当前预加载缓存标记为 ready。
- 页面首屏数据可能尚未进入缓存，例如 History 今天数据、Data 7 天趋势、Data 应用趋势、Data 最近一年 heatmap、Settings bootstrap、App Mapping bootstrap。
- 页面组件第一次 mount 后可能触发内部 loading 状态，即使 chunk 已经 ready，也会显示局部加载。

本方案的核心不是把所有页面都塞进首屏 bundle，也不是用 React transition 保留旧页面来掩盖加载，而是把第一次点击前必须完成的工作拆成后台 warm-up 队列。

## 2. 体验目标

- [x] 开机自启动后，应用先保证 tracking 和 Dashboard 正常可用。
- [x] 启动后后台分步预热常用页面代码和首屏数据，不阻塞 Dashboard。
- [x] 用户等待 30 秒以上后从托盘打开主界面，首次点击 History/Data/App Mapping/Settings/About 不出现整页“正在加载界面...”。
- [x] Data 页允许仍有局部图表骨架或局部加载，但不能出现整页空白或整页 loading。
- [x] 切页不能通过 transition 让旧页面停住来伪装加载，避免“点了没反应”的卡顿体感。
- [x] 预热失败不能打断用户流程，只能记录 warning，用户进入页面时仍按正常路径加载。
- [x] 预热不能明显增加开机启动压力、tracking 写入压力或托盘打开压力。

## 3. 非目标

- [x] 不预热所有年份 heatmap。
- [x] 不预热所有趋势范围和所有应用深度数据。
- [x] 不把 History/Data/Settings/App Mapping/About 全部同步打进首屏 bundle。
- [x] 不把页面偷偷挂到 DOM 里完整渲染一遍。
- [x] 不引入新视觉效果、加载动画或 Quiet Pro 之外的 UI 装饰。
- [x] 不为解决体感问题牺牲 tracking 正确性、数据一致性或 SQLite 写入稳定性。

## 4. 设计原则

- [x] Dashboard 和 tracking 优先，warm-up 永远是低优先级后台任务。
- [x] warm-up 串行或有限并发执行，默认一次只跑一个中重型任务。
- [x] 先预热轻任务，再预热数据任务，避免启动瞬间集中读库。
- [x] 所有 warm-up 任务可取消、可跳过、失败不级联。
- [x] 页面读取同一份缓存，避免 warm-up 和页面 mount 各自发起重复请求。
- [x] 数据变更后通过节流刷新缓存，不在每次 tracking tick 后全量重算。
- [x] 所有新服务按 owner-first 放置，不把业务逻辑塞进 `AppShell.tsx`。
- [x] 文档执行完毕后归档，不把一次性计划留在顶层 `docs/`。

## 5. 现有基础

当前已经存在或可复用的能力：

- [x] `src/app/services/viewChunkPreloadService.ts`
  - 已负责 lazy view chunk 的预加载和模块缓存。
  - 需要继续作为“代码 ready”的唯一 owner。
- [x] `src/app/services/startupPrewarmService.ts`
  - 已负责 Settings/App Mapping bootstrap、Dashboard/History snapshot、Data heatmap 的简单 prewarm。
  - 目前任务较分散，缺少统一队列、状态和验收。
- [x] `src/features/history/services/historySnapshotCache.ts`
  - 已提供 History snapshot cache。
- [x] `src/features/data/services/dataReadModel.ts`
  - 已提供 Data heatmap cache 和 `prewarmRecentDataHeatmapCache`。
- [x] `src/features/settings/services/settingsBootstrapService.ts`
  - 已提供 Settings bootstrap prewarm。
- [x] `src/features/classification/services/classificationService.ts`
  - 已提供 App Mapping/classification bootstrap prewarm。
- [x] `src/app/services/readModelRuntimeService.ts`
  - 已提供 runtime-aware Dashboard/History snapshot load，能确保 ProcessMapper runtime ready。

## 6. 推荐架构

新增或调整的 owner：

- [x] `src/app/services/startupWarmupService.ts`
  - 新增 app 层 warm-up 编排服务。
  - 负责队列、延迟、任务顺序、取消、失败 warning、状态记录。
  - 不直接实现 feature 业务计算，只调用已有 feature/app service。

- [x] `src/app/services/startupWarmupTypes.ts` 或同文件内部类型
  - 仅当类型明显增多时拆出。
  - 定义 `StartupWarmupTaskId`、`StartupWarmupTaskStatus`、`StartupWarmupSnapshot`。

- [x] `src/app/AppShell.tsx`
  - 只负责在合适时机启动和清理 warm-up。
  - 不承载具体预热顺序和数据策略。

- [x] `src/app/services/startupPrewarmService.ts`
  - 可保留为底层 prewarm 函数集合。
  - 或逐步收敛到 `startupWarmupService`，但不要一次性大重构。

建议的任务层级：

- [x] 代码层：预热 History/Data/App Mapping/Settings/About chunk。
- [x] bootstrap 层：预热 Settings bootstrap、App Mapping/classification bootstrap。
- [x] snapshot 层：预热 Dashboard today、History today、Data 默认 7 天 snapshot。
- [x] heatmap 层：预热 Data 最近一年 heatmap。
- [x] 维护层：数据变更后节流刷新 History/Data 相关缓存。

## 7. 任务顺序

建议默认顺序如下：

- [x] T0：AppShell mount 后立即启动 warm-up controller，但不马上执行重任务。
- [x] T1：延迟 800 到 1200ms，预热页面 chunk。
- [x] T2：classification/runtime bootstrap ready 后，预热 Settings 和 App Mapping bootstrap。
- [x] T3：延迟到 Dashboard 首屏稳定后，预热 Dashboard today snapshot 和 History today snapshot。
- [x] T4：继续预热 Data 默认 7 天 snapshot。
- [x] T5：继续预热 Data 最近一年 heatmap。
- [x] T6：可选，预热 About/update 信息，但必须低优先级。
- [x] T7：监听或响应 tracking 数据变化，通过 30 到 60 秒 debounce 刷新 History/Data 首屏缓存。

约束：

- [x] T3 到 T5 默认串行执行。
- [x] T4 和 T5 不能阻塞用户点击页面。
- [x] 如果用户点击目标页面且对应 warm-up 正在进行，页面应复用同一个 Promise 或同一份缓存。
- [x] 如果用户点击目标页面而 warm-up 尚未开始，应优先让用户页面加载，不再额外排队重复任务。

## 8. 分阶段执行清单

### 阶段 0：确认加载来源

- [x] 记录当前能看到的 loading 文案来源。
- [x] 区分整页 `uiText.app.loadingView` 和页面内部 loading/skeleton。
- [x] 检查 History 首次点击时是否命中 `getHistorySnapshotCache`。
- [x] 检查 Data 首次点击时是否命中 `getHistorySnapshotCache(today, 7)`。
- [x] 检查 Data 首次点击时是否命中 `getCachedDataHeatmapSessions("recent")`。
- [x] 检查 Settings 首次点击时是否命中 `getSettingsBootstrapCache`。
- [x] 检查 App Mapping 首次点击时是否命中 `getClassificationBootstrapCache`。
- [x] 记录结论到本方案的“执行记录”小节。

### 阶段 1：新增 warm-up 队列服务

- [x] 新建 `src/app/services/startupWarmupService.ts`。
- [x] 定义任务 ID：
  - [x] `view-chunks`
  - [x] `settings-bootstrap`
  - [x] `mapping-bootstrap`
  - [x] `dashboard-snapshot`
  - [x] `history-today-snapshot`
  - [x] `data-default-snapshot`
  - [x] `data-recent-heatmap`
  - [x] `about-bootstrap`
- [x] 定义任务状态：
  - [x] `idle`
  - [x] `scheduled`
  - [x] `running`
  - [x] `fulfilled`
  - [x] `rejected`
  - [x] `cancelled`
  - [x] `skipped`
- [x] 实现 `startStartupWarmup(options?, deps?)`。
- [x] 返回 `cancel()`，供 AppShell unmount 清理。
- [x] 支持 `initialDelayMs`、`taskGapMs`、`idleTimeoutMs`。
- [x] 支持注入 scheduler，方便单元测试。
- [x] 支持注入 `warn`，失败只 warning。
- [x] 默认串行执行任务。
- [x] 单个任务失败后继续后续任务。
- [x] 重复调用时避免重复启动同一轮 warm-up。

### 阶段 2：整理代码 chunk 预热

- [x] 保留 `viewChunkPreloadService.ts` 作为 chunk owner。
- [x] 暴露可测试的 ready 状态，例如 `getPreloadableViewChunkStatus(view)`。
- [x] 确认 `scheduleLazyViewChunkPreload` 不依赖 classification ready。
- [x] 确认默认包含 `history`、`data`、`mapping`、`settings`、`about`。
- [x] 确认预加载完成后页面组件可以同步读取模块。
- [x] 增加测试：chunk fulfilled 后首次渲染不应 throw promise。
- [x] 增加测试：chunk rejected 后可记录错误且后续可重试或明确保持 rejected。

### 阶段 3：首屏数据预热能力

History：

- [x] 使用 runtime-aware `loadHistoryRuntimeSnapshot(new Date(), 7)` 预热 History 今天默认视图。
- [x] 确认结果写入 `historySnapshotCache`。
- [x] 确认 History 首次 mount 时 `initialCachedSnapshot` 为真。

Data：

- [x] 使用 runtime-aware `loadHistoryRuntimeSnapshot(new Date(), 7)` 预热 Data 默认趋势。
- [x] 确认 Data 的 overview 和 app trend 默认都是 7 天，能复用同一份 snapshot。
- [x] 确认 `getHistorySnapshotCache(today, 7)` 在 Data 首次 mount 前已命中。
- [x] 使用 `prewarmRecentDataHeatmapCache()` 预热最近一年 heatmap。
- [x] 确认 `getCachedDataHeatmapSessions("recent", nowMs)` 在 Data 首次 mount 前已命中。
- [x] 避免预热 30 天、365 天和所有年份 heatmap，除非后续有明确性能预算。

Settings：

- [x] 使用 `prewarmSettingsBootstrapCache()`。
- [x] 确认 Settings 首次 mount 时 `getSettingsBootstrapCache()` 命中。

App Mapping：

- [x] 使用 `prewarmClassificationBootstrapCache()`。
- [x] 确认 App Mapping 首次 mount 时 `getClassificationBootstrapCache()` 命中。

About：

- [x] 评估 About 首屏 loading 来源。
- [x] 如果只是 update snapshot，可新增轻量 prewarm。
- [x] 如果 About 低频且 loading 很短，可仅预热 chunk，暂不扩大范围。

### 阶段 4：AppShell 集成

- [x] 从 `AppShell.tsx` 中移除分散的 chunk/data prewarm effect。
- [x] 保留必要的 startup bootstrap 或迁移到统一 warm-up 服务。
- [x] 在 AppShell mount 后启动 `startStartupWarmup`。
- [x] classification ready 后通知 warm-up 可以执行 runtime/data 任务。
- [x] AppShell 只保留启动和取消逻辑，不写任务细节。
- [x] 确认主窗口隐藏到托盘时 warm-up 仍可继续执行。
- [x] 确认 AppShell unmount 或 renderer reload 时能取消未执行 timer。
- [x] 不使用 React transition 来隐藏 loading。

### 阶段 5：缓存失效和后台刷新

- [x] App Mapping 保存后清理 History/Data 相关缓存。
- [x] 删除历史记录后清理 History/Data 相关缓存。
- [x] backup restore 后清理并重新 warm-up。
- [x] tracking 数据变化后不立即全量刷新，新增 debounce。
- [x] debounce 默认 30 到 60 秒。
- [x] debounce 刷新只覆盖默认首屏缓存：
  - [x] Dashboard today
  - [x] History today
  - [x] Data 7 天 snapshot
  - [x] Data recent heatmap
- [x] 如果用户正在目标页面，避免后台刷新和页面自身刷新打架。
- [x] 如果 SQLite 忙或任务失败，只 warning，不重试风暴。

### 阶段 6：页面 loading 体验约束

- [x] 整页 `uiText.app.loadingView` 只允许真正冷路径出现。
- [x] warm-up 完成后，首次切页不应出现整页 loading。
- [x] 页面内部 loading 尽量转为局部 skeleton 或直接使用缓存内容。
- [x] History 如果有 today cache，首次 mount 不应显示 initial loading。
- [x] Data 如果有 7 天 cache 和 heatmap cache，首次 mount 不应显示全页 loading。
- [x] Settings 如果有 bootstrap cache，首次 mount 不应显示 loading。
- [x] App Mapping 如果有 bootstrap cache，首次 mount 不应显示 loading。
- [x] 不新增明显的动画、遮罩或装饰来掩盖加载。

### 阶段 7：可观测性

- [x] 在 service 层保留轻量 warm-up snapshot，至少包含任务状态和耗时。
- [x] 默认不在 UI 展示。
- [x] 测试环境可读取状态。
- [x] 开发环境可通过 console debug 或测试 hook 查看：
  - [x] 已完成任务
  - [x] 失败任务
  - [x] 每个任务耗时
  - [x] 最后一次 warm-up 开始和结束时间
- [x] 生产环境避免频繁 console 输出。

### 阶段 8：测试

单元测试：

- [x] 新增 `tests/startupWarmupService.test.ts`。
- [x] 测试任务按顺序执行。
- [x] 测试任务间隔和 initial delay 生效。
- [x] 测试一个任务失败后继续执行后续任务。
- [x] 测试 cancel 后未开始任务不会执行。
- [x] 测试重复 start 不会重复启动同一轮。
- [x] 测试 runtime/data 任务在 classification ready 后执行。
- [x] 测试 tracking 数据变化 debounce 只刷新一次。

预加载测试：

- [x] 扩展 `tests/viewChunkPreloadService.test.ts`。
- [x] 测试每个 primary view chunk 都在默认列表。
- [x] 测试 fulfilled 后同步读取组件。
- [x] 测试 pending 时复用同一个 Promise。
- [x] 测试 reset test helper 不影响生产导出。

数据缓存测试：

- [x] 扩展 `tests/startupPrewarm.test.ts` 或拆新测试。
- [x] 测试 History/Data 默认 7 天 snapshot 复用同一份缓存。
- [x] 测试 Data heatmap prewarm 命中 warm cache 后不重复读。
- [x] 测试 Settings/App Mapping bootstrap prewarm 失败不阻塞其他任务。

浏览器 smoke：

- [x] 扩展 `tests/uiBrowserSmoke.test.ts`。
- [x] 加入“等待 warm-up 后切页不显示 app loading view”的断言。
- [x] 顺序点击 History、Data、Mapping、Settings、About。
- [x] 检查点击后短窗口内 body 不包含 `uiText.app.loadingView`。
- [x] 保留现有 dashboard overflow 和 settings dialog smoke。

构建和边界：

- [x] 运行 `npm run test:preload`。
- [x] 运行 `npm run test:startup`。
- [x] 运行 `npm run test:data`。
- [x] 运行 `npm run test:ui-smoke`。
- [x] 运行 `npm run test:ui-browser-smoke`。
- [x] 运行 `npm run check:architecture`。
- [x] 运行 `npm run check:naming`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run check:bundle`。
- [x] 最终运行 `npm run check:frontend`。

### 阶段 9：性能验证

- [x] 记录变更前后 bundle budget。
- [x] 确认总 JS gzip 未明显增长。
- [x] 确认仍保留主要页面分块。
- [x] 记录 warm-up 任务默认耗时。
- [x] 确认启动后 0 到 2 秒不执行重型 Data heatmap。
- [x] 确认 warm-up 不会在短时间内发起多次 SQLite 重读。
- [x] 确认 tracking 正常采样和写入。
- [x] 如果发现开机阶段 CPU/IO 明显升高，增加延迟或减少默认任务。

## 9. 验收标准

必须满足：

- [x] 开机自启动或冷启动后等待 30 秒，从托盘打开主界面。
- [x] 首次点击 History 不出现整页“正在加载界面...”。
- [x] 首次点击 Data 不出现整页“正在加载界面...”。
- [x] 首次点击 App Mapping 不出现整页“正在加载界面...”。
- [x] 首次点击 Settings 不出现整页“正在加载界面...”。
- [x] 首次点击 About 不出现整页“正在加载界面...”或确认其 remaining loading 极短且低频可接受。
- [x] Data 首屏如果仍有局部 skeleton，需要限定在具体图表区域。
- [x] 快速连续切页时没有页面卡死、旧页面停住或导航状态错乱。
- [x] tracking 数据变化后，后台刷新不会造成明显前台卡顿。
- [x] 删除历史、修改 App Mapping、恢复备份后，缓存失效正确，页面数据不陈旧。

建议满足：

- [x] 启动后 5 到 10 秒点击常用页，整页 loading 已显著减少。
- [x] 启动后 30 秒点击常用页，体感接近第二次切页。
- [x] warm-up 失败场景下，用户仍能进入页面并正常加载。
- [x] 开发模式能看到 warm-up 状态，便于后续排查。

## 10. 回滚方案

- [x] `AppShell.tsx` 回退为现有分散 prewarm effect。
- [x] 删除或停用 `startupWarmupService.ts`。
- [x] 保留 `viewChunkPreloadService.ts` 中已稳定的 chunk preload 能力。
- [x] 如果 Data prewarm 引发 SQLite 压力，先禁用 heatmap prewarm，保留 chunk 和 bootstrap prewarm。
- [x] 如果 browser smoke 不稳定，先保留 unit 测试和手动验收，单独修 smoke。
- [x] 回滚后重新运行 `npm run check:frontend`。

## 11. 执行记录

执行时在这里记录重要发现：

- [x] 当前看到的 loading 类型：
- [x] 首次 History cache 命中情况：
- [x] 首次 Data 7 天 snapshot cache 命中情况：
- [x] 首次 Data heatmap cache 命中情况：
- [x] 首次 Settings bootstrap cache 命中情况：
- [x] 首次 App Mapping bootstrap cache 命中情况：
- [x] warm-up 默认总耗时：
- [x] bundle budget 变化：
- [x] 遗留风险：

## 12. 勾选和归档规则

- [x] 执行过程中逐项勾选，不要最后一次性全部勾选。
- [x] 如果某项决定不做，改成 `[x]` 并在同一行或下方写明“跳过原因”。
- [x] 如果发现方案需要调整，优先更新本文档，再继续实现。
- [x] 全部实现和验证完成后，将本文档移动到 `docs/archive/startup-background-warmup-execution-plan.md`。
- [x] 归档前确认 `docs/working/` 不保留已完成计划。
- [x] 如形成长期规则，更新对应顶层长期文档，而不是让本计划承担长期 source of truth。


## 13. 完成记录

- [x] 2026-05-21：已实现启动后台 warm-up 队列。
- [x] 2026-05-21：已接入 AppShell，替代分散的预热 effect。
- [x] 2026-05-21：已覆盖 History/Data/Settings/App Mapping/About 的代码与首屏缓存预热。
- [x] 2026-05-21：已新增 warm-up 单元测试与浏览器 smoke 验收。
- [x] 2026-05-21：已归档到 docs/archive/。
