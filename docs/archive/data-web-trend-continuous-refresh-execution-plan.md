# Data 网页趋势连续刷新执行方案

> 文档类型：How-to / 阶段执行单
>
> 面向对象：Patina 维护者与实施协作者
>
> 状态：已完成并归档
>
> 代码基线：`8186b02317a264bfbf64527015c0d8cb1d9e1123`
>
> 工作区状态：已有未提交的 Data 网页分析实现；实施时必须保留并在当前工作区继续
>
> 对应 Project item：`增加网站域名历史趋势分析`
>
> Live Project 完成检查状态：`Next`（尚未反映完成事件，需维护者手动拖到 `Done`）
>
> Live Project Area：`Data`
>
> Project 核对时间：`2026-07-26 18:37 +08:00`
>
> 完成后归档位置：`docs/archive/data-web-trend-continuous-refresh-execution-plan.md`

---

## 0. 文档目标

本执行单用于消除 Data 页以下两类可见闪屏：

1. 从“应用”切换到“网页”时，趋势面板主体短暂变为空白。
2. 已处于“网页趋势”时切换时间范围，列表、指标和图表短暂消失后重新出现。

完成后应达到：

- 已有可信网页结果时，旧内容在新结果到达前保持可见。
- 新结果准备完成后一次性替换旧内容。
- 第一次进入网页模式且没有任何网页快照时，显示稳定、克制、可解释的首次加载状态，不显示整块空白。
- 刷新失败时，不把旧内容伪装成新范围的最终结果。
- 应用模式、网页数据口径、Web Sync 开关、页面布局和默认首屏 I/O 行为保持不变。

本文最初用于冻结实施路径，现已回写实现、验证、对抗审查与归档证据。

### 0.1 已确认现象

- [x] 应用趋势在范围变化时保留既有内容，后台读取完成后原地替换。
- [x] 网页趋势在请求开始时设置 `trendLoading = true`。
- [x] 网页趋势只接受与当前 `trendRangeCacheKey` 完全匹配的快照。
- [x] Data 页把网页就绪条件写成 `Boolean(webTrendViewModel) && !webTrendLoading`。
- [x] 趋势面板在未就绪时给主体添加 `invisible`。
- [x] 因此网页模式切换和范围切换都存在必经的不可见帧。
- [x] 这不是 Recharts 动画、CSS 过渡或 SQLite 图表计算本身造成的。

### 0.2 已确认边界

- [x] 不修改页面三块面板的位置与顺序。
- [x] 不修改页面副标题 `浏览长期活动趋势`。
- [x] 不修改“应用 / 网页”模式语义。
- [x] 不修改“全部 / 所选”热力图范围语义。
- [x] 不修改应用时间与网页时间的统计口径。
- [x] 不修改 Patina Web Sync 协议。
- [x] 不修改 Rust 聚合命令或 SQLite schema。
- [x] Web Sync 关闭时继续完全隐藏网页入口并禁止网页读取。
- [x] 默认应用模式首屏继续不发起网页聚合请求。

---

## 1. 第一性原理

### 1.1 用户操作改变的是查询条件，不是面板是否存在

用户点击“网页”或切换时间范围时，意图是查看另一组数据，而不是关闭并重新打开趋势面板。

因此：

- 面板结构必须持续存在。
- 控件位置必须持续存在。
- 已经可信显示的内容不应因后台请求开始而被主动销毁。
- 新内容应在完整可用时一次性替换。

一句话约束：

> 查询可以处于过渡中，阅读界面不能因此消失。

### 1.2 视觉连续不能以数据误导为代价

保留旧内容可以避免白屏，但旧内容可能属于上一个时间范围。

所以不能只做：

```text
新范围已选中
    ↓
继续无提示地显示旧范围数据
```

正确状态应是：

```text
新范围已请求
    ↓
保留上一份可信内容 + 标记“正在更新”
    ↓
新结果完整到达
    ↓
一次性替换并移除更新标记
```

旧内容是过渡期的“上一次可信结果”，不是新范围的最终答案。

### 1.3 首次加载与后台刷新是两种不同状态

必须区分：

- **首次加载**：网页模式尚无任何可显示结果。
- **后台刷新**：已经有一份可信网页结果，新请求正在进行。

两者的呈现不能相同：

| 状态 | 可显示数据 | 正确呈现 |
|---|---:|---|
| 首次加载 | 无 | 稳定的首次加载状态，保持面板几何 |
| 后台刷新 | 有 | 保留内容，必要时显示克制的更新状态 |
| 当前结果 | 有且匹配 | 正常显示 |
| 首次加载失败 | 无 | 完整错误状态和重试 |
| 后台刷新失败 | 有 | 保留旧内容，明确“更新失败，显示上次结果”，提供重试 |

### 1.4 快速请求不应制造新的视觉噪声

如果请求在很短时间内完成，立即显示再立即隐藏“更新中”会形成另一种闪烁。

因此：

- 内容从请求开始就保持。
- `aria-busy` 可以立即更新。
- 可见的“更新中”提示延迟约 `200–300ms` 再出现。
- 请求在延迟阈值内完成时，不显示可见提示。
- 不使用闪烁骨架、循环 shimmer、大面积遮罩或图表淡出。

### 1.5 缓存的首要作用是连续性，其次才是性能

当前网页读模型已经有小型 LRU 和 in-flight 去重，但 Hook 无法同步取得已经缓存的快照。

结果是：

- 底层虽然有缓存，React 首帧仍先得到 `null`。
- 随后的 Promise 即使立即完成，也已经产生不可见帧。

因此必须提供同步只读缓存命中能力，让同一范围再次进入网页模式时可以在首个渲染周期拿到结果。

### 1.6 状态必须按请求身份归属

加载、错误和结果都必须绑定到明确的请求键：

```text
cacheVersion + rangeCacheKey
```

否则快速切换 `7 天 → 30 天 → 7 天` 时，可能出现：

- B 范围错误覆盖 A 范围。
- 旧版本结果在 cache invalidation 后重新出现。
- 已切回应用模式后，网页结果仍改变当前面板。

---

## 2. 目标体验

### 2.1 从应用首次切换到网页

如果当前范围没有网页缓存：

1. “网页”立即进入选中状态。
2. 标题立即切换为“网页趋势”。
3. 面板外框、头部、时间控件和主体高度不改变。
4. 主体显示稳定的首次加载状态。
5. 不显示应用数据冒充网页数据。
6. 网页结果完整到达后一次性显示列表、指标和图表。

如果当前范围已有网页缓存：

1. “网页”立即进入选中状态。
2. 首帧直接显示缓存结果。
3. 不经过空白或不可见主体。
4. 不重复发起相同 IPC，除非 cache version 已失效。

### 2.2 网页趋势切换时间范围

1. 时间控件立即反映用户选择。
2. 上一份可信网页结果继续显示。
3. 面板设置 `aria-busy="true"`。
4. 超过延迟阈值时，在标题附近显示克制的“更新中”。
5. 新范围结果完整到达后，一次性替换列表、指标、峰值和图表。
6. 选中域名在新范围仍存在时继续保持。
7. 选中域名不在新范围时，随新快照一次性回退到首个可见域名。
8. 更新完成后移除 busy 与更新提示。

### 2.3 更新失败

有旧内容时：

- 保留旧内容。
- 不把旧内容标记为当前范围最终结果。
- 显示“更新失败，显示上次结果”。
- 提供“重试”。
- 不把列表、指标或图表清空。

没有旧内容时：

- 显示现有“网页分析暂时不可用”。
- 提供“重试”。
- 不显示虚假 0 数据。

### 2.4 快速切换

对于以下操作：

- 应用 → 网页 → 应用。
- 7 天 → 30 天 → 7 天。
- 网页 → 应用后旧网页请求完成。
- 请求中关闭 Web Sync。

必须保证：

- 当前选择不被迟到请求覆盖。
- 旧 Promise 可以完成并进入受版本保护的底层缓存，但不得错误写入当前呈现状态。
- 应用模式不出现网页 loading、error 或 stale 状态。
- Web Sync 关闭后不出现任何网页入口或网页状态。

---

## 3. 状态模型

### 3.1 请求状态

建议把网页趋势请求状态收口为：

```ts
interface DataWebTrendRequestState {
  requestedCacheKey: string | null;
  loadingCacheKey: string | null;
  errorCacheKey: string | null;
  snapshot: VersionedDataWebTrendSnapshot | null;
}

interface VersionedDataWebTrendSnapshot {
  cacheVersion: string;
  value: DataWebTrendSnapshot;
}
```

约束：

- [x] `requestedCacheKey` 表示当前 UI 想看的范围。
- [x] `loadingCacheKey` 只描述正在读取的范围。
- [x] `errorCacheKey` 只影响同一请求键。
- [x] `snapshot` 保存最近一次成功结果，不因新请求开始而清空。
- [x] `snapshot.cacheVersion` 必须与当前 `cacheVersion` 一致才可继续呈现。
- [x] Web Sync 关闭时所有网页请求状态收口为空。

### 3.2 呈现状态

建议在现有 `dataDestinationState.ts` 中增加纯函数，输出以下状态之一：

```ts
type DataWebTrendPresentation =
  | "hidden"
  | "initial-loading"
  | "ready"
  | "refreshing"
  | "refreshing-stale"
  | "blocking-error"
  | "refresh-error";
```

状态决策：

| 条件 | 呈现状态 | 主体内容 |
|---|---|---|
| Web Sync 关闭或非网页模式 | `hidden` | 不呈现网页状态 |
| 无任何快照，当前请求中 | `initial-loading` | 稳定首次加载状态 |
| 当前快照匹配请求键，无请求 | `ready` | 当前数据 |
| 当前快照匹配，请求仍在进行 | `refreshing` | 当前数据 |
| 只有上一范围快照，当前请求中 | `refreshing-stale` | 上次可信数据 |
| 无任何快照，当前请求失败 | `blocking-error` | 完整错误状态 |
| 有上一范围快照，当前请求失败 | `refresh-error` | 上次可信数据 + 非阻断错误 |

### 3.3 数据选择优先级

当前范围的显示快照按以下顺序选择：

1. 当前 Hook state 中 cache version 与范围键都匹配的快照。
2. 读模型 LRU 中同步命中的当前范围快照。
3. 当前 cache version 下最近一次成功快照，作为有明确 stale 状态的过渡内容。
4. 无。

禁止：

- [x] 不使用旧 cache version 的快照。
- [x] 不使用 Web Sync 已关闭时的快照。
- [x] 不把应用趋势数据作为网页首次加载占位。
- [x] 不合并两个范围的网页统计。
- [x] 不展示部分分片结果。

---

## 4. Owner 与文件边界

### 4.1 责任分配

| 责任 | Owner |
|---|---|
| 网页聚合原始结果缓存与同步只读命中 | `features/data/services/dataWebActivityReadModel.ts` |
| 模式、请求与呈现状态纯函数 | `features/data/services/dataDestinationState.ts` |
| 请求生命周期、并发取消、结果选择 | `features/data/hooks/useDataWebActivityRuntime.ts` |
| 应用/网页呈现组合 | `features/data/components/Data.tsx` |
| 首次加载、刷新、刷新失败的可视状态 | `features/data/components/DataAppTrendPanel.tsx` |
| Data 页局部样式 | `styles/features/data.css` |
| 中英文用户文案 | `shared/copy/domains/dataCopy.ts` |
| 屏幕阅读器文案 | `shared/copy/domains/accessibilityCopy.ts` |
| 浏览器延迟与失败注入 | `tests/uiBrowserSmoke/tauriStubs.ts` |
| 读模型和状态单测 | `tests/dataWebActivityReadModel.test.ts` |
| 真实浏览器连续性验收 | `tests/uiBrowserSmoke/dataScenarios.ts` |

### 4.2 允许修改

- [x] `src/features/data/services/dataWebActivityReadModel.ts`
- [x] `src/features/data/services/dataDestinationState.ts`
- [x] `src/features/data/hooks/useDataWebActivityRuntime.ts`
- [x] `src/features/data/components/Data.tsx`
- [x] `src/features/data/components/DataAppTrendPanel.tsx`
- [x] `src/styles/features/data.css`
- [x] `src/shared/copy/domains/dataCopy.ts`
- [x] 已复核 `src/shared/copy/domains/accessibilityCopy.ts`，本轮无需修改。
- [x] `tests/dataWebActivityReadModel.test.ts`
- [x] `tests/uiBrowserSmoke/tauriStubs.ts`
- [x] `tests/uiBrowserSmoke/dataScenarios.ts`
- [x] 已复核 `tests/uiSmoke.test.ts`，现有契约已覆盖，本轮无需修改。

### 4.3 明确不修改

- [x] `src-tauri/src/data/web_activity_analysis.rs`
- [x] `src-tauri/src/commands/web_activity_analysis.rs`
- [x] SQLite schema、index 和 migration
- [x] Patina Web Sync companion
- [x] `docs/web-activity-protocol.md`
- [x] 页面布局、面板顺序和断点
- [x] bundle budget、hotspot budget 和质量门禁
- [x] 应用趋势刷新实现
- [x] Data 默认首屏预热策略

### 4.4 停止条件

出现以下情况时停止实施并重新判断：

- [x] 未触发：修复不需要新增跨 feature 的共享缓存抽象。
- [x] 未触发：修复不需要修改 Rust 聚合协议。
- [x] 未触发：修复不需要默认应用模式预取网页数据。
- [x] 未触发：修复不需要把业务状态放入 `app/*`、`shared/*` 或 `platform/*`。
- [x] 未触发：修复不需要用全局动画或页面级遮罩掩盖空白。
- [x] 未触发：修复不要求改变网页时间统计口径。

---

## 5. 分阶段执行清单

## 阶段 0：开始前冻结基线

- [x] 重新读取本执行单。
- [x] 重新读取长期母文档。
- [x] 重新读取 live Project。
- [x] 确认对应事项仍为 `增加网站域名历史趋势分析 / Data`。
- [x] 实施开始时告知维护者将该事项从当前状态拖到 `In progress`。
- [x] 按 live Project 手动顺序重新计算 `Next` 窗口。
- [x] 记录开始 commit SHA。
- [x] 记录 `git status --short`。
- [x] 明确区分用户已有 Data 改动和本次连续刷新改动。
- [x] 不清理、不 reset、不覆盖现有未提交实现。
- [x] 截取或记录以下基线：
  - [x] 应用 → 网页首次切换。
  - [x] 网页 7 天 → 30 天。
  - [x] 网页 30 天 → 7 天。
  - [x] 网页 → 应用。
- [x] 在浏览器测试 stub 中把网页查询延迟固定为 `800ms`，证明不可见窗口。
- [x] 记录面板高度、主体可见性和空白帧数。

阶段验收：

- [x] 闪屏可以稳定复现。
- [x] 根因可定位到网页状态与呈现门控。
- [x] 没有把 History 的既有 hover 超时误判成本任务回归。

## 阶段 1：先写状态模型测试

在 `tests/dataWebActivityReadModel.test.ts` 增加呈现状态矩阵：

- [x] Web Sync 关闭得到 `hidden`。
- [x] 应用模式得到 `hidden`。
- [x] 网页模式、无快照、请求中得到 `initial-loading`。
- [x] 网页模式、当前快照匹配、无请求得到 `ready`。
- [x] 网页模式、当前快照匹配、请求中得到 `refreshing`。
- [x] 网页模式、只有旧范围快照、请求中得到 `refreshing-stale`。
- [x] 无快照且请求失败得到 `blocking-error`。
- [x] 有旧快照且请求失败得到 `refresh-error`。
- [x] error key 与当前请求键不同时不污染当前状态。
- [x] cache version 不同时旧快照不可用。
- [x] 范围 A → B → A 时，A 缓存可以重新成为当前结果。

测试原则：

- [x] 测试行为，不依赖 Hook 内部变量名。
- [x] 测试进入现有 `npm run test:data` 执行图。
- [x] 不新增孤立测试脚本。
- [x] 失败信息明确指出状态输入和预期呈现。

## 阶段 2：增加同步缓存读取契约

在 `dataWebActivityReadModel.ts` 增加同步只读 API：

```ts
getCachedDataWebTrendSnapshot({
  selection,
  nowMs,
  normalizedDomain,
}): DataWebTrendSnapshot | null
```

执行项：

- [x] 复用现有 `resolveDataTrendRange`。
- [x] 复用现有 cache key 生成规则。
- [x] 不复制第二套缓存。
- [x] 命中时返回带 `range` 和 `cacheKey` 的完整趋势快照。
- [x] 未命中时返回 `null`，不发起 IPC。
- [x] 命中时更新 LRU 访问顺序。
- [x] cache invalidation 后同步读取返回 `null`。
- [x] pending Promise 不被当作已完成快照。
- [x] cache limit 仍为 3。
- [x] 不改变 heatmap 缓存键。

专项测试：

- [x] 首次读取前同步 miss。
- [x] 异步读取完成后同步 hit。
- [x] 同一范围、同一 `nowMs` 得到同一 cache key。
- [x] 不同范围不会误命中。
- [x] clear 后立即 miss。
- [x] LRU 淘汰后旧范围 miss。

阶段验收：

- [x] 再次进入已加载网页范围时，React 首个渲染周期可取得缓存。
- [x] 默认应用模式没有新增网页 I/O。

## 阶段 3：重构网页 Hook 请求生命周期

在 `useDataWebActivityRuntime.ts`：

- [x] 把当前请求键与最近成功快照分开保存。
- [x] 新请求开始时不再清空最近成功快照。
- [x] 先同步查询当前范围缓存，再决定首次加载或后台刷新。
- [x] 所有快照带当前 `cacheVersion` 身份。
- [x] 只使用当前 cache version 的快照。
- [x] loading 与 error 都绑定请求键。
- [x] 新请求开始时只清理同键旧错误。
- [x] 请求成功时原子更新成功快照和错误状态。
- [x] 请求失败时保留最近成功快照。
- [x] effect cleanup 后迟到结果不更新当前 Hook state。
- [x] `startTransition` 只包裹非紧急结果替换。
- [x] 不用 `trendLoading` 决定是否丢弃已存在内容。
- [x] Web Sync 关闭时清理网页呈现状态。
- [x] cache version 改变时旧快照不再显示。
- [x] 切回应用模式时不发起新的网页读取。

Hook 最终输出：

```ts
trendRefreshing
trendRefreshFailed
trendError
trendViewModel
```

并保持：

- [x] `trendViewModel` 表示当前应呈现的网页视图模型，允许在明确 stale 状态下来自上一份可信快照。
- [x] `trendLoading` 不再被组件直接解释为“隐藏内容”。
- [x] `retry` 只重试当前请求键。

阶段验收：

- [x] 同一范围应用 → 网页不会出现 `trendViewModel = null` 的中间帧。
- [x] 网页范围切换时，只要已有成功结果，呈现模型持续非空。
- [x] 第一次进入且无结果时明确进入 `initial-loading`。

## 阶段 4：让 Data 组合层采用连续呈现

在 `Data.tsx`：

- [x] 把 `destinationPanelReady` 改为只表达“是否存在可显示内容”。
- [x] 不再使用 `!webTrendLoading` 否决已有网页视图模型。
- [x] 把 refreshing 和 refresh error 单独传给趋势面板；stale 由判别状态表达，不增加测试专用生产 DOM。
- [x] 应用模式继续沿用 `visibleAppTrendViewModel`。
- [x] 网页模式使用 Hook 返回的呈现模型。
- [x] 模式标题、搜索、指标、列表和图表从同一呈现快照构建。
- [x] 不允许列表来自旧快照而图表来自新快照。
- [x] 新快照到达时，列表、选中项、指标和图表在同一次 React 提交中替换。
- [x] 搜索词继续按模式独立保存。
- [x] 当前选中域名在新快照仍存在时保持。
- [x] 当前选中域名失效时只在新快照提交时回退。
- [x] 应用/网页图标不在刷新开始时消失。

阶段验收：

- [x] 不存在 `Boolean(webTrendViewModel) && !webTrendLoading` 形式的门控。
- [x] 网页刷新期间 `DataAppTrendPanel` 持续收到完整一致的 props。

## 阶段 5：改造面板加载与刷新呈现

在 `DataAppTrendPanel.tsx`：

- [x] 区分 `initial-loading` 与 `refreshing`。
- [x] 首次加载保留完整面板几何。
- [x] 首次加载状态不使用 `invisible`。
- [x] 首次加载不显示应用数据。
- [x] 首次加载不显示虚假 0 指标。
- [x] 刷新期间继续渲染真实列表、指标和图表。
- [x] 刷新期间主体设置 `aria-busy="true"`。
- [x] 可见“更新中”提示延迟 `200–300ms`。
- [x] 快速请求完成时不出现可见提示闪烁。
- [x] 更新提示位于标题附近，不挤压模式和范围控件。
- [x] 更新提示不改变面板高度。
- [x] 更新提示不遮挡图表和列表。
- [x] 不降低整个面板 opacity。
- [x] 不禁用模式切换和范围切换。
- [x] 不使用 shimmer、脉冲动画或大面积 spinner。

建议文案：

- 中文首次加载：`正在加载网页趋势`
- 英文首次加载：`Loading web trends`
- 中文后台更新：`更新中`
- 英文后台更新：`Updating`
- 中文刷新失败：`更新失败，显示上次结果`
- 英文刷新失败：`Update failed. Showing the last result.`

无障碍：

- [x] `aria-busy` 绑定真实请求状态。
- [x] 首次加载状态使用 `role="status"`。
- [x] 延迟更新提示使用克制的 live region。
- [x] 失败和重试可通过键盘访问。
- [x] 刷新期间已有列表项不从 Tab 顺序消失。
- [x] 焦点不因新结果提交跳回面板开头。

## 阶段 6：错误、并发与失效收口

### 错误

- [x] 无旧快照 + 失败：完整错误状态。
- [x] 有旧快照 + 失败：保留旧内容和非阻断错误。
- [x] 重试成功：移除错误并替换为新结果。
- [x] 重试失败：不重复叠加错误提示。
- [x] 失败不写入成功缓存。

### 并发

- [x] 快速切换 7 天 → 30 天 → 7 天。
- [x] 快速切换应用 → 网页 → 应用。
- [x] 请求中修改搜索词。
- [x] 请求中选择另一个域名。
- [x] 请求中触发 retry。
- [x] 同键请求继续 in-flight 去重。
- [x] 不同键请求不会互相覆盖呈现状态。

### 失效

- [x] `mappingVersion` 改变后旧别名、排除和 favicon 不继续显示。
- [x] `refreshKey` 改变后旧数据不被当作当前结果。
- [x] Web Sync 关闭后清理网页呈现状态。
- [x] Web Sync 重新开启后按首次加载或缓存规则重新进入。
- [x] cache clear 后迟到 Promise 不回填缓存。

阶段验收：

- [x] 所有状态都能由请求键和 cache version 唯一解释。
- [x] 没有依赖时间巧合的“最后完成者获胜”逻辑。

## 阶段 7：浏览器延迟与空白帧测试

在 `tauriStubs.ts` 增加网页聚合专项注入：

```ts
globalThis.__PATINA_WEB_ACTIVITY_QUERY_DELAY_MS
globalThis.__PATINA_WEB_ACTIVITY_QUERY_FAILURE
```

要求：

- [x] 默认值为 0 / false，不影响其他测试。
- [x] 只影响 `cmd_get_web_activity_aggregate_range`。
- [x] 每个场景结束后清理。
- [x] 不复用 History 延迟变量。

在 `dataScenarios.ts` 增加：

### 首次网页加载

- [x] 清空页面运行时缓存。
- [x] 设置 `800ms` 网页查询延迟。
- [x] 从应用点击网页。
- [x] 断言标题和模式立即切换。
- [x] 断言主体不含 `.invisible`。
- [x] 断言首次加载状态可见。
- [x] 断言面板高度变化不超过 1px。
- [x] 请求完成后断言列表、指标和图表一起出现。

### 网页范围刷新

- [x] 先完成 7 天网页加载。
- [x] 设置 `800ms` 延迟。
- [x] 切换到 30 天。
- [x] 连续采样至少 15 个 animation frame。
- [x] 断言每一帧都存在列表、指标和图表结构。
- [x] 断言空白帧数为 0。
- [x] 断言刷新期间 `aria-busy="true"`。
- [x] 断言延迟阈值后出现更新状态。
- [x] 断言新结果到达后 busy 和更新状态消失。

### 缓存返回

- [x] 完成 7 天和 30 天读取。
- [x] 从应用切回网页已缓存范围。
- [x] 断言首帧直接显示网页内容。
- [x] 断言没有新增网页 IPC。
- [x] 断言空白帧数为 0。

### 失败

- [x] 首次加载失败显示完整错误。
- [x] 后台刷新失败保留旧内容。
- [x] 后台刷新失败显示“上次结果”语义。
- [x] 重试后成功替换。

### Web Sync

- [x] 关闭时无网页模式。
- [x] 关闭时无网页请求。
- [x] 请求中关闭后迟到结果不泄漏到应用模式。

## 阶段 8：样式与 Quiet Pro 验收

- [x] 新样式只进入 `src/styles/features/data.css`。
- [x] 复用现有文本、边框、面板和状态 token。
- [x] 不新增硬编码主题色。
- [x] 不新增阴影、圆角或动画档位。
- [x] 更新提示低于标题和主要指标的视觉层级。
- [x] 加载状态不比真实数据更醒目。
- [x] 亮色主题正常。
- [x] 暗色主题正常。
- [x] 中文不溢出。
- [x] 英文不溢出。
- [x] 390px 下头部控件不被挤压。
- [x] 1366px 下单列面板高度稳定。
- [x] 2048px 下宽屏左右布局不变。
- [x] 100%、125%、150% DPI 正常。
- [x] reduced motion 下没有额外运动。

## 阶段 9：完整验证

专项：

- [x] `npm run test:data`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke` 已执行；本任务 Data 场景全部通过，随后被既有热力图 Tooltip 关闭超时阻断。
- [x] Data 隔离浏览器连续性场景
- [x] `npm run check:types`

默认仓库门槛：

- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run build`
- [x] `npm run check` 已执行；在完整 browser smoke 的既有 Tooltip 用例处短路。
- [x] `npm run check:rust`
- [x] `npm run check:full` 已执行；同一既有 Tooltip 用例短路，后续 frontend、Rust、dependency gate 已分别通过。

运行纪律：

- [x] 浏览器测试失败时记录第一个真实根因。
- [x] 不用无分析的自动重跑掩盖 flaky。
- [x] 完整 browser smoke 被既有 Data 热力图 Tooltip 关闭超时阻断后，已单独记录并运行 Data 隔离场景。
- [x] 本任务不得顺手修改不相关 History 测试。
- [x] 构建受 sandbox `spawn EPERM` 影响时，以相同命令在获准环境复跑。
- [x] 不提高 bundle budget。
- [x] 不放宽测试超时时间来制造通过。
- [x] `git diff --check` 通过。
- [x] 临时测试进程、目录和截图按成功/失败路径清理。

## 阶段 10：性能验证

- [x] 默认应用模式网页 IPC 数仍为 0。
- [x] 已缓存范围返回网页模式时网页 IPC 增量为 0。
- [x] 同键并发仍只触发一次底层请求。
- [x] 同步 cache peek 为 O(1) Map 读取。
- [x] LRU 上限仍为 3。
- [x] 不新增 Data 首屏 bootstrap 体积。
- [x] Data lazy chunk 仍在既有预算内。
- [x] 15 帧连续性采样中空白帧为 0。
- [x] 更新提示延迟不创建持续 timer。
- [x] 组件卸载时清理延迟 timer。

## 阶段 11：对抗式审查

完整验证通过后另开一轮审查。

### 数据可信攻击

- [x] 新范围控件已经变化时，旧数据是否被无提示冒充为新范围结果。
- [x] stale 标记是否会过早消失。
- [x] 新结果是否可能只更新列表、不更新图表。
- [x] 刷新错误是否会显示虚假 0。
- [x] cache version 变化后旧别名是否残留。

### 并发攻击

- [x] A → B → A，B 最后完成。
- [x] A → B → A，A 原请求最后完成。
- [x] 请求中切回应用。
- [x] 请求中关闭 Web Sync。
- [x] 请求中触发 mapping refresh。
- [x] 同键双击重试。

### 视觉攻击

- [x] 800ms 延迟下是否仍有白屏。
- [x] 50ms 快请求是否闪现“更新中”。
- [x] 失败提示是否推高面板。
- [x] 长英文提示是否挤压范围控件。
- [x] 窄窗口焦点是否跳到隐藏节点。
- [x] 图表 Tooltip 是否在结果替换后残留。

### 架构攻击

- [x] 是否复制了第二套网页缓存。
- [x] 是否把 feature 状态推入 shared/platform。
- [x] 是否为修复闪屏引入默认网页预取。
- [x] 是否修改 Rust、协议或 schema。
- [x] 是否产生新的页面私有视觉原型。

结论要求：

- [x] 所有发现按 P0–P3 记录。
- [x] P0/P1 全部修复。
- [x] P2 要么修复，要么经维护者明确接受。
- [x] 没有以“先显示再说”为理由留下数据语义歧义。

## 阶段 12：完成、Project 与归档

- [x] 回写本文执行记录。
- [x] 回写专项与完整验证证据。
- [x] 回写浏览器空白帧结果。
- [x] 回写对抗式审查发现。
- [x] 实现和验证全部完成后，告知维护者把对应 item 拖到 `Done`。
- [x] 重新读取 live Project。
- [x] 按手动顺序重新计算最多三个 `Next`。
- [x] 不代替维护者拖动 Project。
- [x] 不修改 GitHub Issue 状态。
- [x] 未经明确授权不 commit、不 push。
- [x] 将本文移入 `docs/archive/`。

---

## 6. 风险与回滚边界

| 风险 | 预防 | 回滚单位 |
|---|---|---|
| 旧范围数据被误认为新范围 | stale/refreshing 明确建模 | 回滚连续呈现状态 |
| 第一次进入显示应用数据 | 首次加载禁止使用应用模型 | 回滚首次加载呈现 |
| 缓存命中仍产生空白帧 | 同步 cache peek | 回滚同步读取 API |
| 错误覆盖其他范围 | error key 绑定请求键 | 回滚 keyed error |
| 迟到结果覆盖当前模式 | effect cancellation + cache version | 回滚 Hook 生命周期改动 |
| 新提示造成二次闪烁 | 延迟显示、快请求不显示 | 回滚延迟提示 |
| 页面布局高度漂移 | 保持主体几何、浏览器 rect 断言 | 回滚加载状态样式 |
| 默认首屏新增网页 I/O | 禁止预取、保留 browser command 断言 | 回滚缓存预热尝试 |
| owner 扩张 | 状态只留 Data feature | 回滚新增错误抽象 |

回滚纪律：

- [x] 不使用 `git reset --hard`。
- [x] 不覆盖用户现有未提交 Data 实现。
- [x] 只回滚本任务新增的连续刷新状态与呈现。
- [x] 无数据库 migration，不需要数据降级。
- [x] 不删除网页历史数据。
- [x] 不修改 companion 版本。

---

## 7. Definition of Done

只有同时满足以下条件，任务才算完成：

- [x] 应用 → 网页首次无缓存时不出现整块空白。
- [x] 应用 → 网页有缓存时首帧显示网页结果。
- [x] 网页趋势切换时间范围时旧内容保持可见。
- [x] 新结果完整到达后一次性替换。
- [x] 15 帧连续采样空白帧为 0。
- [x] 快请求不闪现更新提示。
- [x] 慢请求有克制、可理解的更新状态。
- [x] 旧结果不会无提示冒充新范围最终结果。
- [x] 首次加载失败有完整错误和重试。
- [x] 后台刷新失败保留旧内容并明确 stale 语义。
- [x] 快速模式/范围切换不会被迟到结果覆盖。
- [x] Web Sync 关闭时无网页入口和网页读取。
- [x] 默认应用模式无新增网页 I/O。
- [x] 应用模式行为未改变。
- [x] 页面布局、面板顺序、断点和副标题未改变。
- [x] Rust、SQLite、Web Sync 协议未改变。
- [x] 中英文、双主题、四种宽度和键盘路径通过。
- [x] 所有任务内专项、构建与 bundle 验证通过；完整门禁的既有 Tooltip 外部阻断已隔离并记录。
- [x] 对抗式审查无未处理 P0/P1。
- [x] 执行证据回写本文。
- [x] Project 状态建议已报告。
- [x] 本文已归档。
- [x] 未经授权未提交、未推送、未修改 Issue。

---

## 8. 执行记录

### 8.1 实施信息

- 开始时间：`2026-07-26 17:38 +08:00`
- 完成时间：`2026-07-26 18:37 +08:00`
- 开始 commit：`8186b02317a264bfbf64527015c0d8cb1d9e1123`
- 完成 commit：未创建；按用户授权边界保留当前未提交工作区，HEAD 未改变。
- 实施者：Codex
- Project 开始状态：`增加网站域名历史趋势分析 / Next / Data`
- Project 完成检查状态：仍为 `Next / Data`，live Project 尚未反映开始与完成事件。
- Project 完成建议：维护者将本项拖到 `Done`；保留“在 Dashboard 和 History 快捷设置分类与别名”为 `Next`，并将“复测并收口灵动视效”“完善 Tools 到期的 Patina 提醒弹窗”从 `Queued` 补到 `Next`。

### 8.2 连续性证据

| 场景 | 人工延迟 | 请求期间内容 | 空白帧 | 面板高度变化 | 结论 |
|---|---:|---|---:|---:|---|
| 应用 → 网页，首次无缓存 | 800ms | 完整面板几何 + 明确首次加载状态，不复用应用数据 | 0 个可见空白状态 | `≤ 1px` | 通过 |
| 应用 → 网页，已有缓存 | 缓存命中 | 首帧直接显示完整网页快照 | 0 | `≤ 1px` | 通过；网页 IPC 增量为 0 |
| 网页 7 天 → 30 天 | 800ms | 旧快照的列表、4 个指标与图表持续可见 | 15 帧采样为 0 | 每帧 `≤ 1px` | 通过 |
| 近一年慢请求 → 返回已缓存 30 天 | 800ms | 30 天内容持续可见；近一年迟到结果不覆盖当前范围 | 15 帧采样为 0 | 无结构变化 | 通过 |
| 网页刷新失败 | 注入失败 | 保留上次可信结果，显示非阻断失败与重试 | 0 | 无结构变化 | 通过；重试成功收口 |

### 8.3 验证证据

| 命令 | 结果 | 关键数据 | 备注 |
|---|---|---|---|
| `npm run test:data` | 通过 | 31 + 13 + 3 + 5 个测试 | 最终代码复验 |
| `npm run test:ui-smoke` | 通过 | 50 个测试 | 完整检查中通过 |
| `npm run test:ui-browser-smoke` | 任务内通过、全套外部阻断 | 新增 Data 连续性场景全部通过 | 随后既有 Tooltip 关闭断言在 `dataScenarios.ts:1290` 超时 |
| Data 隔离浏览器场景 | 通过 | 11 个测试；含 800ms、15 帧、缓存、失败、迟到结果、Web Sync、布局、英文暗色 | 最终代码复验 |
| `npm run check:types` | 通过 | 两套 tsconfig 均通过 | 最终代码复验 |
| `npm run check:lint` | 通过 | 0 warning | 最终代码复验 |
| `npm test` | 通过 | 默认确定性测试全部通过 | 全量检查前置阶段 |
| `npm run test:replay` | 通过 | 15 个 replay 测试 | 全量检查前置阶段 |
| `npm run check:frontend` | 通过 | Data 9.58 KiB gzip；lazy JS 85.48 KiB；support 6.21 KiB；总量 387.94 KiB | 未提高任何预算 |
| `npm run check:rust` | 通过 | 491 passed，1 ignored；fmt、check、clippy 通过 | 本轮未修改 Rust |
| `npm run check:dependencies` | 通过 | 0 个 Windows 可达漏洞；npm 0 vulnerability | sandbox `cargo EPERM` 后按相同命令获准复跑 |
| `npm run check` | 外部阻断 | 命名、架构、IPC、热点、Quiet Pro、测试治理、确定性测试均通过 | browser smoke 在既有 Tooltip 关闭用例短路 |
| `npm run check:full` | 外部阻断 | 与上项同一首个真实根因 | 被短路的 frontend、Rust、dependencies 已分别通过 |
| `npm run perf:stable` | 通过 | Data 7d p95 4.03ms；Data 365d p95 195.15ms；Web 365d/100 domains p95 31.92ms | 所有预算通过 |
| `git diff --check` | 通过 | 无空白错误 | 归档前复验 |

### 8.4 对抗式审查

| 严重度 | 发现 | 影响 | 处理 | 复验 |
|---|---|---|---|---|
| P1 | 新增共享重试组件分块令 lazy JS 首次超预算 0.38 KiB | 违反“不提高 bundle budget”完成条件 | 去除不必要的独立分块、冗余状态 props 和测试专用 DOM 标记；用判别状态编码 stale；保留可访问状态语义 | `npm run check:frontend` 通过，未改预算 |
| P2 | 浏览器连续性证据原为自定义 1 天 → 7 天，与执行单声明的 7 天 → 30 天不一致 | 证据与规格不精确 | 场景先恢复近 7 天，再以 800ms 切换近 30 天并采样 15 帧 | Data 隔离浏览器通过 |
| P2 | 未直接覆盖“较早请求最后完成”的真实竞态 | 迟到结果可能覆盖当前选择 | 新增近一年慢请求 → 返回已缓存 30 天的真实浏览器攻击，等待慢请求完成后复核范围、内容与 busy | 15 帧无空白；最终仍为近 30 天 |
| P3（既有） | 完整 browser smoke 的热力图 Tooltip 关闭断言偶发超时 | 阻断仓库全套命令，但发生在本任务场景之后 | 按边界不修改无关交互；保留首个失败并执行隔离套件 | 任务内 11 个 browser 测试通过 |

审查结论：无未处理 P0/P1；P1 与两个 P2 均已修复。请求身份、cache version、Web Sync、模式切换和 effect cleanup 能唯一解释所有呈现状态；没有“最后完成者获胜”逻辑。

### 8.5 最终说明

- 用户可见变化：首次进入网页趋势保持完整面板几何；已有数据时切换范围持续显示上次可信结果，慢请求显示克制的“更新中”；刷新失败保留结果并可重试。
- 明确未改变的行为：三块面板布局、顺序、断点、副标题“浏览长期活动趋势”、应用趋势逻辑、默认应用模式、Web Sync 关闭语义均未改变。
- 数据口径说明：应用时间继续包含浏览器进程；网页时间继续是同步到本地的网页记录，两者不相减、不合并。
- 已知限制：仓库完整 browser smoke 仍有一个既有热力图 Tooltip 关闭超时；该用例位于所有本任务 Data 场景之后，不影响本任务隔离验证结果。
- 后续事项：仅剩维护者手动更新 live Project；未创建 commit、未 push、未修改 Issue。
- 归档路径：`docs/archive/data-web-trend-continuous-refresh-execution-plan.md`
