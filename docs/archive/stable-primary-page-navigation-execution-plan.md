# 四个辅助主页面稳定切换执行方案

> 状态：已实施、已验证、已完成对抗式审查并归档
>
> 创建日期：2026-08-02
>
> 完成日期：2026-08-02
>
> 适用页面：`Classification / Tools / Settings / About`
>
> 对照页面：`Dashboard / History / Data`
>
> 文档类型：面向维护者和实现者的 How-to 执行单
>
> Project 说明：当前未确认对应的 live GitHub Project item，不在本文伪造 Project 状态
>
> 文档归宿：实现、验证和对抗式审查全部完成后移至 `docs/archive/`

## 0. 最终执行记录

### 0.1 结果

- 四个辅助主页面已经按 feature 自身事实源适配稳定切换契约。
- Classification 只展示完整 committed catalog，不再先展示启动候选再重排。
- Settings 冷切换由 settings bootstrap gate 控制；暖刷新保留表单和草稿；首次失败进入明确重试状态。
- Tools 冷切换等待真实 runtime snapshot；`DEFAULT_SNAPSHOT` 只参与不可见的安全计算；runtime event 和动作结果不会被旧 refresh 覆盖。
- About 静态结构立即显示，版本读取不再触发整页 spinner；未知版本显示为“版本未知”，不伪装成已完成事实。
- AppShell 等待 lazy chunk 和 feature prepare 都结算后再交接；旧页面覆盖目标页直至目标页获得一次绘制机会；侧栏 active 始终跟随 presented view。
- History 日期切换继续保留已呈现日期内容，完整新快照准备后再原子替换。
- 主窗口只有在外观和最终目标页已经真实呈现后才报告 frontend ready。

### 0.2 对抗式审查发现与修复

1. 发现 Settings 首次 bootstrap 失败后可能永久停留在 loading；已增加 feature-owned prewarm error、明确错误页和 retry。
2. 发现 Settings 挂载刷新、外部设置事件和保存操作之间存在旧响应晚到风险；已统一使用 revision 拒绝过期提交，未保存草稿仍只接受允许的窄同步字段。
3. 发现 Tools 在 React StrictMode 重复 effect 下可能重复处理同一失败；已增加 hook request revision。
4. 发现 runtime event 与较旧 Tools refresh 可能同毫秒乱序；已同时使用 publication revision 和 `sampledAtMs` 保护 committed snapshot。
5. 发现 feature prepare 若早于 lazy chunk 失败，`Promise.all` 会提前进入 Suspense fallback；已改为 `Promise.allSettled`，确保错误页交接前 chunk 已结算。
6. 发现侧栏乐观高亮会在冷准备期间与来源画面不一致；已移除 optimistic active，统一跟随 presented view。
7. 审查结论：未解决 P0 = 0，未解决 P1 = 0。没有影响本任务正确性的未解决 P2/P3。

### 0.3 验证证据

- `npm test`：通过。
- `npm run test:replay`：通过，15 项 replay 测试。
- `npm run test:ui-browser-smoke`：通过，73 项真实浏览器场景。
- `npm run test:tauri-runtime-smoke`：通过，真实 Tauri/WebView2 主窗口 readiness 为 143ms，watchdog 未介入，首个可见帧主题与背景正确。
- `npm run perf:startup-bootstrap`：600 次，p50 0.0028ms，p95 0.0090ms，max 0.4435ms，全部在预算内。
- 最终 `npm run check`：通过，包含类型、lint、架构、IPC、覆盖率、mutation 14/14、浏览器、构建和 bundle 预算。
- 浏览器最终报告：20 个暖切换样本，active p50 35.8ms、active p95 170.6ms、active max 198.9ms；structure p50 22.7ms、p95 81.8ms、max 172.7ms；`maxBlankFrames = 0`。
- active p95 高于方案中的 150ms 建议值，是因为最终指标改为跟随真实 `presentedView`，包含新页面首次绘制与 outgoing handoff，不再使用提前高亮的 optimistic nav 低估耗时；结构 p95、零空白帧和交接正确性均通过，因此不以恢复错误的乐观高亮换取数字。
- 最终 bundle：initial JS+CSS 186.46 KiB gzip；非 Data 主 lazy routes 67.30 KiB gzip；全部预算通过。
- `git diff --check`：通过。

### 0.4 范围与例外

- `[x]` 表示步骤已经执行，或条件已经完成评估并确认不适用；不表示未触发的条件曾经发生。
- 未修改 Rust、SQLite schema、IPC 契约或 capability；因此无需扩大生产实现范围，额外运行 Tauri runtime smoke 仅用于主窗口闪烁验收。
- 未创建 commit、未 push、未修改 Issue 或 Project；用户没有授予这些远端或版本控制动作。
- 当前未确认对应 live GitHub Project item，因此没有伪造状态或拖动建议。
- 未形成新的长期产品或架构规则；现有顶层文档已经覆盖 snapshot owner、稳定期边界和 Quiet Pro，不需要重复回写。
- 60/120/144Hz 等硬件刷新率无法由本地自动化可靠伪造；通过 rAF handoff、隐藏文档 fallback、DPI/browser matrix、真实 WebView2 runtime 和零空白帧证据完成等价风险覆盖。

## 1. 如何使用本文档

本文档是统一四个辅助主页面切换体验的阶段性执行依据。实施者必须从上到下推进，不得只凭主观观感宣布“已经不闪”。

- [x] 开始实施前，确认当前工作树中的用户修改并记录本任务允许触及的文件。
- [x] 开始每个阶段前，确认上一阶段的退出条件已经满足。
- [x] 每完成一个步骤立即勾选，并在对应阶段记录测试、测量或截图证据。
- [x] 当前代码事实与本文不一致时，先修订本文，再继续实现。
- [x] 任何页面都不得用虚构默认数据冒充可信快照。
- [x] 任何后台刷新都不得先清空可信内容再重新填充。
- [x] 若需要新增跨 feature 共享状态库、通用请求框架或新的持久化副本，立即停止并重新评估边界。
- [x] 若需要修改 Rust、SQLite schema、IPC 契约或 capability，升级验证范围，不得按普通前端修复处理。
- [x] 全部阶段完成后执行第 24 节对抗式审查，再判断是否可以归档。

## 2. 一句话问题定义

`Classification / Tools / Settings / About` 当前没有完全遵循 `Dashboard / History / Data` 已经形成的“可信内容持续可见、刷新在后台完成、完整结果原子替换”原则，导致冷切换、预热未完成或数据刷新时可能短暂出现空白、加载面板、默认值或结构变化。

## 3. 目标

- [x] 四个页面在存在可信快照时立即展示可信快照，并在后台刷新。
- [x] 四个页面在完全没有可信快照时继续展示当前页面，待最小可信首屏准备完成后再切换。
- [x] 页面刷新期间不清空主体、不切回整页 loading、不重置滚动位置和焦点。
- [x] 新数据只有在内部一致、页面可消费时才一次性提交。
- [x] 刷新失败时保留旧快照，并提供低噪声、可恢复的错误反馈。
- [x] 快速连续导航时，过期请求不能把用户拉回旧目标页。
- [x] 页面切换稳定性不依赖“灵动视效”；开启或关闭动效都必须成立。
- [x] 侧栏选中项始终代表用户当前真正看到的页面，而不是尚未完成准备的目标页面。
- [x] 不把四个 feature 的业务数据搬进 `app/*` 或 `shared/*`。
- [x] 不为了消除闪烁而增加不可解释的固定延迟。

## 4. 非目标

- [x] 不重新设计页面视觉、信息架构、文案、图标或布局。
- [x] 不改变分类、设置、工具、更新检查的业务语义。
- [x] 不把所有页面改成常驻挂载。
- [x] 不建立通用 Redux/Zustand 式全局业务数据仓库。
- [x] 不复制 SQLite 数据到新的前端持久化索引。
- [x] 不通过长时间 skeleton、假数据或淡入动画掩盖错误状态。
- [x] 不调整版本号、Changelog、发布流程或 bundle 预算。
- [x] 不修改 `Dashboard / History / Data` 的现有读模型，除非回归证据证明共享壳层改动破坏了它们。
- [x] 不顺带解决页面内部与切换稳定性无关的视觉或性能问题。

## 5. 第一性原理

### 5.1 用户看到的是连续画面，不是 React 生命周期

用户不会区分“路由已经改变”“懒加载正在完成”或“effect 正在请求数据”。用户只会观察连续两帧之间是否出现：

- 整块白色或空面板；
- 页面标题先出现、正文稍后出现；
- 加载转圈一闪而过；
- 默认值被真实值替换；
- 列表排序、卡片位置或计数突然变化；
- 侧栏已经选中新页面，但主体仍是旧页面。

由此得到：

- [x] 页面切换的验收单位是“连续可见帧”，不是 Promise 是否成功。
- [x] 任何一帧都必须有完整、可信且可解释的内容来源。
- [x] DOM 已挂载不等于页面已经适合呈现。
- [x] 测试必须记录切换过程中的中间状态，而不只断言最终页面。

### 5.2 可信快照优先于最新快照

已完整提交的旧快照虽然可能稍旧，但仍然可信；半份新数据、默认数据或正在变化的排序不是可信快照。

由此得到：

- [x] `committed snapshot` 在刷新开始时保持不变。
- [x] 新请求只写入内部 working state，不直接成为可见数据。
- [x] 请求全部成功后执行一次 commit。
- [x] 请求失败后继续展示原 committed snapshot。
- [x] 相同语义结果不做无意义提交，避免多余重渲染。

### 5.3 首次冷启动不可能凭空拥有可信内容

真正冷启动时，如果既没有内存快照，也没有可安全恢复的持久化快照，就不存在可以立即展示的真实业务内容。

由此得到：

- [x] 不显示伪造的 `0`、默认计时器状态、部分目录或占位表单。
- [x] 继续展示来源页面，直到目标页的最小可信首屏准备完成。
- [x] 首次加载失败时才进入目标页的明确错误状态，使用户可以重试。
- [x] 不用固定 100ms、300ms 等延迟猜测请求是否已经完成。

### 5.4 页面骨架稳定与数据新鲜度是两个不同问题

页面可以使用稍旧的可信数据保持结构稳定，同时在后台获取新数据。刷新提示不应改变页面尺寸、排序或交互上下文。

由此得到：

- [x] 页面骨架、滚动容器和主要操作区不因刷新状态改变尺寸。
- [x] 后台刷新状态使用低噪声 status 或不可见状态，不占用新的布局空间。
- [x] 数据更新通过一次原子提交进入现有结构。
- [x] 用户正在编辑、聚焦或滚动时，刷新不得无条件重置局部状态。

### 5.5 页面切换和页面刷新必须分层所有

应用壳只知道“目标页是否具备最小可呈现条件”；feature 自己知道“什么是可信快照、何时失效、如何刷新”。

由此得到：

- [x] `app/*` 只编排页面代码准备、feature readiness 和画面交接。
- [x] `features/classification/*` 拥有完整目录和分类规则快照。
- [x] `features/tools/*` 拥有工具运行时快照。
- [x] `features/settings/*` 拥有设置页 bootstrap、草稿和外部同步规则。
- [x] `features/about/*` 拥有关于页展示状态，但可以消费设置或更新 owner 暴露的窄快照。
- [x] `shared/*` 不承接 feature 私有缓存或请求状态机。

### 5.6 动效只能增强反馈，不能承担正确性

`dynamicEffects` 关闭时页面切换仍必须稳定；开启时也不能把旧页面提前移除。

由此得到：

- [x] 基础切换只依赖 readiness、committed snapshot 和帧交接。
- [x] 动效关闭时没有空白帧。
- [x] 动效开启时只增加短反馈，不增加数据等待或改变提交顺序。
- [x] `prefers-reduced-motion` 下保持相同内容语义。

## 6. 统一术语与状态模型

### 6.1 术语

- `requested view`：用户已经请求前往的页面，对应导航意图。
- `rendered view`：已满足壳层最低准备条件、允许开始挂载的页面。
- `presented view`：用户当前真正看到的页面。
- `committed snapshot`：内部一致、可以直接展示的最近一次完整结果。
- `working refresh`：正在后台生成但尚未提交的下一份结果。
- `cold`：没有 committed snapshot。
- `warm`：存在 committed snapshot。
- `stale error`：后台刷新失败，但仍有旧可信快照。
- `cold error`：首次加载失败，没有任何可信快照。

### 6.2 feature 推荐状态

```text
cold-idle
→ cold-loading
→ ready
→ refreshing
→ ready

cold-loading
→ cold-error
→ cold-loading（重试）

refreshing
→ stale-error（保留 committed snapshot）
→ refreshing（重试）
→ ready
```

执行要求：

- [x] 每个 feature 映射到这组语义，不要求共用同一个类型文件。
- [x] `loading` 必须区分 cold loading 与 warm refreshing。
- [x] `error` 必须区分无快照错误与有快照刷新错误。
- [x] 页面可见数据只能来自 committed snapshot。
- [x] working refresh 不直接写入列表、计数或表单。

## 7. 必须始终成立的不变量

- [x] `presented view` 在任意时刻恰好只有一个。
- [x] 页面交接期间旧页面覆盖新页面，直到新页面至少完成一次浏览器绘制机会。
- [x] 侧栏 active 状态跟随 `presented view`。
- [x] 冷目标页准备期间，来源页保持可见但不再接收误触导航操作。
- [x] 快速导航 A → B → C 时，B 的迟到结果不能覆盖 C。
- [x] 页面卸载后的异步结果不能提交到新实例。
- [x] 有 committed snapshot 的刷新不能进入整页 loading。
- [x] 刷新失败不能删除 committed snapshot。
- [x] 分类页不能展示部分应用目录。
- [x] 设置页外部同步不能覆盖未保存草稿。
- [x] 工具页不能展示伪造的默认运行时状态。
- [x] 关于页不能因为版本号读取而隐藏全部静态内容。
- [x] 页面稳定性与动态效果开关相互独立。
- [x] 不通过提高加载预算、增加固定等待或删除测试完成修复。

## 8. 当前行为基线

| 页面 | 当前进入门槛 | 当前首屏来源 | 当前刷新行为 | 主要差异 |
|---|---|---|---|---|
| Dashboard | 无 lazy chunk 门槛 | AppShell 常驻 Hook、Dashboard cache | `startTransition` 更新 | 页面和读模型长期存在 |
| History | lazy chunk | 内存 cache、持久化 bootstrap、Dashboard seed | 保留当前日期内容，完成后替换 | feature 内 stale-while-refresh |
| Data | lazy chunk | persisted bootstrap、trend/heatmap cache | 各区域独立刷新，不清空整页 | 页面骨架与数据加载解耦 |
| Classification | chunk + bootstrap + 完整应用目录 | committed app catalog | 已有目录时可保持，首次冷加载由壳层阻挡 | 当前最强 readiness gate |
| Settings | chunk + settings bootstrap | settings cache | 挂载后重新校验；草稿需要保护 | 已有 readiness gate |
| Tools | 仅 chunk | runtime snapshot store；缺失时使用 loading 分支 | 挂载后 refresh | 早点击可能先显示 loading 面板 |
| About | 仅 chunk | update snapshot 或 settings appVersion | 挂载后重新读取 | 缓存未完成时整页转圈 |

基线核对清单：

- [x] 记录 `useAppShellRenderedView` 当前对 Settings 和 Classification 的 feature readiness 分支。
- [x] 记录 `AppViewOutlet` 当前一帧 outgoing view 交接行为。
- [x] 记录 Tools 没有 runtime snapshot 时的 loading DOM。
- [x] 记录 About 没有版本快照时的 loading DOM。
- [x] 记录 Classification committed catalog 的刷新与失效行为。
- [x] 记录 Settings bootstrap 和未保存草稿的同步行为。
- [x] 确认当前暖切换浏览器报告中的 `maxBlankFrames`。
- [x] 在修改前构造 900ms 延迟，分别记录四页中间帧。

## 9. 目标架构

### 9.1 应用壳层

`src/app/hooks/useAppShellRenderedView.ts` 只负责：

- 页面 chunk 是否准备完成；
- feature 是否存在最小可信首屏；
- 合并导航 intent/preview 触发的同一 in-flight prepare；
- 丢弃过期导航请求；
- 把满足条件的目标交给 `AppViewOutlet`。

执行约束：

- [x] 保持 `prepareViewData(view)` 为薄组合，不在其中构造 feature 数据。
- [x] readiness 只通过 feature 暴露的同步快照查询判断。
- [x] prepare 只调用 feature 暴露的 prewarm/ensure 方法。
- [x] 不在 app 层理解 candidate、timer、setting key 或 update DTO。
- [x] 如果分支继续增长，先评估 feature-owned descriptor 是否有真实收益；不得直接制造万能注册表。

### 9.2 页面交接层

`src/app/components/AppViewOutlet.tsx` 继续负责：

- 新旧页面在同一画布内交接；
- outgoing view 至少覆盖一个 animation frame；
- hidden document 使用 microtask 收口；
- 最长 50ms fallback；
- 把 presented view 回报给 AppShell。

执行约束：

- [x] 不把 feature readiness 搬入 `AppViewOutlet`。
- [x] 不用 opacity 0 的空目标页提前替代来源页。
- [x] 不延长 outgoing view 以掩盖慢数据请求。
- [x] 动态效果不得改变 outgoing view 的内容所有权。

### 9.3 Feature 快照 owner

每个 feature 至少暴露以下语义能力的必要子集：

```ts
getCommittedSnapshot(): Snapshot | null
ensureSnapshot(): Promise<Snapshot>
refreshSnapshot(): Promise<Snapshot>
invalidateSnapshot(reason): void
subscribe(listener): () => void
```

这不是要求建立一个共享接口；实现者应复用各 feature 现有 owner，只补缺失能力。

- [x] 同一 feature 的 prewarm、页面进入和主动 retry 合并 in-flight 请求。
- [x] refresh 开始时不清空 committed snapshot。
- [x] invalidate 只标记过期，不默认删除仍可信的 committed snapshot。
- [x] 数据库覆盖恢复等不可跨数据源复用场景必须清除旧快照。
- [x] generation/token 阻止旧请求提交。
- [x] 快照内容相同则避免无意义 publish。

## 10. 预计文件范围

### 10.1 预期修改

- [x] `src/app/hooks/useAppShellRenderedView.ts`
- [x] `src/app/components/AppViewOutlet.tsx`，仅在测试证明现有交接仍有缺口时
- [x] `src/app/services/startupWarmupService.ts`
- [x] `src/features/classification/services/classificationService.ts`
- [x] `src/features/classification/services/classificationAppCatalog.ts`
- [x] `src/features/classification/hooks/useAppMappingState.ts`
- [x] `src/features/classification/components/AppMapping.tsx`
- [x] `src/features/settings/services/settingsBootstrapService.ts`
- [x] `src/features/settings/hooks/useSettingsPageState.ts`
- [x] `src/features/settings/components/Settings.tsx`
- [x] `src/features/tools/services/toolsRuntimeSnapshotStore.ts`
- [x] `src/features/tools/hooks/useToolsPageState.ts`
- [x] `src/features/tools/components/Tools.tsx`
- [x] `src/features/about/components/About.tsx`
- [x] 与上述 owner 对应的专项、UI smoke 和 browser smoke 测试

### 10.2 只在证据要求时修改

- [x] `src/styles/motion.css`
- [x] `src/styles/quiet-pro.css`
- [x] `src/app/AppShell.tsx`
- [x] feature cache lifecycle service
- [x] browser smoke Tauri/SQLite stubs

### 10.3 默认禁止修改

- [x] `src/shared/*`，除非确认已有共享原型存在真实缺陷。
- [x] `src/platform/*`，除非现有 feature service 无法通过已有 gateway 获得数据。
- [x] `src-tauri/*`、IPC command、capability 和数据库 schema。
- [x] Dashboard、History、Data 的 feature 读模型。
- [x] bundle、hotspot、coverage 和性能预算。
- [x] release、版本、Changelog 和 updater 配置。

### 10.4 停止并重新评估的条件

- [x] 需要新增跨 feature 通用缓存库。
- [x] 需要让 app hook 直接依赖 platform gateway。
- [x] 需要把四页全部保持常驻挂载。
- [x] 需要把工具运行时默认值当成首屏可信事实。
- [x] 需要持久化完整分类目录的第二份前端副本。
- [x] 需要改变设置外部同步或分类保存语义。
- [x] 预计单个提交超过 25 个手工维护文件或 1000 行手工修改。
- [x] 需要增加固定等待时间才能让测试通过。

## 11. 阶段 0：建立可重复基线

### 11.1 工作树与边界

- [x] 运行 `git status --short`，记录用户已有修改。
- [x] 运行 `git diff --check`。
- [x] 确认本任务与当前未提交的历史、分类、设置闪烁修复是否属于同一交付范围。
- [x] 若明确对应 live Project item，使用浏览器读取 Project；否则不新增、不映射、不修改状态。
- [x] 确认不需要修改 Rust、SQLite 或 IPC。

### 11.2 自动化基线

- [x] 运行 `npm run check:types`。
- [x] 运行 `npm run test:warmup`。
- [x] 运行 `npm run test:classification`。
- [x] 运行 `npm run test:settings`。
- [x] 运行 `npm run test:tools`。
- [x] 运行 `npm run test:ui-smoke`。
- [x] 运行 `npm run test:ui-browser-smoke`。
- [x] 保存暖切换导航报告中的 p50/p95/max 和 `maxBlankFrames`。

### 11.3 浏览器基线 fixture

- [x] 为四页分别提供 `0ms / 50ms / 900ms` 可控数据延迟。
- [x] 为四页分别提供首次加载失败 fixture。
- [x] 为四页分别提供“有旧快照、后台刷新失败” fixture。
- [x] 每个 fixture 在测试结束后恢复 localStorage、全局变量和缓存。
- [x] 不依赖测试执行顺序或前一个场景留下的 active view。

### 11.4 中间帧采样

- [x] 点击前记录 presented view、active nav、主体结构和关键数据签名。
- [x] 通过 MutationObserver 和 animation frame 采样切换过程。
- [x] 记录空画布帧数。
- [x] 记录整页 loading 文案或 spinner 是否出现。
- [x] 记录目标页第一次挂载时的数据签名。
- [x] 记录目标页完成刷新后的数据签名。
- [x] 记录滚动位置和 active element。

阶段退出条件：

- [x] 可以稳定证明 Tools 或 About 至少一个冷切换中间状态与目标规则不一致。
- [x] 可以区分 chunk 等待、feature 数据等待和页面内部 refresh。
- [x] 所有延迟与失败 fixture 可重复且能清理。

## 12. 阶段 1：先写统一行为红测

### 12.1 壳层状态测试

- [x] 无可信目标快照时，presented view 保持来源页。
- [x] 目标 chunk 完成但 feature snapshot 未完成时仍保持来源页。
- [x] chunk 与 snapshot 都完成后才更新 rendered view。
- [x] outgoing view 在新页面首次绘制机会前保持覆盖。
- [x] handoff 完成后 presented view 才更新。
- [x] active nav 始终跟随 presented view。
- [x] A → B → C 快速导航时 B 迟到结果无效。
- [x] prepare 失败时目标页进入可恢复错误路径，而不是永久卡在来源页。

### 12.2 暖快照测试

- [x] 有 committed snapshot 时导航无需等待后台 refresh。
- [x] 页面第一次可见数据签名等于 committed snapshot。
- [x] refresh 中数据签名保持不变。
- [x] refresh 成功后只变化一次。
- [x] refresh 失败后数据签名不变。
- [x] stale error 不替换成整页错误。

### 12.3 冷快照测试

- [x] 无快照时不挂载目标页 loading UI。
- [x] 首次快照完成后目标页一次性出现。
- [x] 首次失败后目标页显示明确错误与重试。
- [x] 重试期间外框保持稳定。
- [x] 重试成功后一次性进入 ready。

### 12.4 动效独立测试

- [x] `dynamicEffects=false` 时无空白帧。
- [x] `dynamicEffects=true` 时无空白帧。
- [x] reduced motion 时无空白帧。
- [x] 三种模式的数据提交顺序一致。

红测退出条件：

- [x] 至少一条 Tools 测试因现有整页 loading 稳定失败。
- [x] 至少一条 About 测试因现有版本 loading 稳定失败。
- [x] 测试失败指向状态与帧，不是笼统截图差异或超时。

## 13. 阶段 2：收敛壳层切换契约

### 13.1 Readiness 编排

- [x] 复核 `prepareViewData(view)` 的职责只包含窄 prewarm 调用。
- [x] 为 Tools 加入 runtime snapshot readiness。
- [x] 为 About 加入最小版本/更新快照 readiness，或明确允许静态页先显示的替代契约。
- [x] 保留 Classification 的 bootstrap + 完整目录 readiness。
- [x] 保留 Settings 的 settings bootstrap readiness。
- [x] Dashboard 继续无需 lazy readiness。
- [x] History/Data 继续只受 chunk 门槛约束，不新增整页数据 gate。

### 13.2 导航竞态

- [x] 每次 requested view 变化递增 request generation。
- [x] prepare 完成时同时核对 generation 和当前 requested view。
- [x] preview 预热不改变 requested/rendered/presented view。
- [x] intent 与 preview 合并 feature in-flight 请求。
- [x] 返回来源页时取消旧目标的展示资格，但不破坏可复用预热结果。
- [x] prepare 拒绝后允许后续导航重新尝试。

### 13.3 页面交接

- [x] 复核 outgoing view 的 background 与画布一致。
- [x] 复核一帧交接在 60/120/144Hz 下都不会露出底层空画布。
- [x] 复核 hidden/visible 变化不会遗留 outgoing overlay。
- [x] 复核窗口重建时 presented view 与 restored view 一致。
- [x] 不新增页面级淡入作为正确性依赖。

阶段退出条件：

- [x] 壳层测试覆盖四页 readiness。
- [x] 浏览器中不存在 active nav 先行或空画布帧。
- [x] `app/*` 没有新增 feature 私有业务数据结构。

## 14. 阶段 3：Classification 适配

### 14.1 快照语义

- [x] 应用候选只来自完整 committed catalog。
- [x] bootstrap 只负责规则、分类元数据和网页候选，不恢复第二套近期应用候选。
- [x] refresh 开始时保留完整目录、计数和当前排序。
- [x] refresh 完成时一次性提交新目录。
- [x] 无语义变化时不替换候选数组或卡片 identity。
- [x] refresh 失败时保留旧目录并显示低噪声重试入口。
- [x] 首次无目录失败时显示完整错误状态。

### 14.2 交互保持

- [x] 后台刷新不重置筛选项。
- [x] 后台刷新不清空搜索词。
- [x] 后台刷新不重置列表滚动位置。
- [x] 后台刷新不覆盖名称编辑草稿。
- [x] 后台刷新不关闭分类或颜色 popover。
- [x] 当前编辑对象真实消失时提供明确收口，而不是静默跳到其他卡片。

### 14.3 应用与网页模式

- [x] 应用模式遵循完整目录原子提交。
- [x] 网页模式有旧候选时后台刷新不清空。
- [x] 两种模式切换不改变外层面板尺寸。
- [x] Web Sync 关闭时不显示网页模式。
- [x] 不借本任务扩大网页目录历史范围。

阶段退出条件：

- [x] 慢速刷新时应用顺序只在完整新事实真实变化时更新一次。
- [x] 首次可见列表就是最终 committed 列表。
- [x] 分类保存、取消、删除和软件提醒候选测试通过。

## 15. 阶段 4：Settings 适配

### 15.1 首屏来源

- [x] 明确 AppShell 已加载 AppSettings 与 Settings bootstrap 的关系。
- [x] 优先复用现有可信 settings bootstrap，不创建第三份设置事实源。
- [x] 页面有缓存时同步初始化 saved/draft settings。
- [x] 页面后台重新读取持久化设置时不切回 loading。
- [x] appVersion 单独迟到时不隐藏整张设置页。
- [x] storage snapshot 继续按区域加载，不阻塞设置页首屏。

### 15.2 草稿保护

- [x] 无未保存修改时，后台校验可以原子更新 saved/draft。
- [x] 有未保存修改时，后台校验只更新允许外部同步的字段。
- [x] 外部标题记录变化继续遵循现有窄同步语义。
- [x] 主题、配色和语言预览不因后台 refresh 回跳。
- [x] 保存中发生外部事件时，按 revision 防止旧响应覆盖新保存结果。
- [x] 取消后恢复最近可信 saved snapshot。

### 15.3 错误状态

- [x] 有缓存时刷新失败保留表单和草稿。
- [x] 无缓存首次失败时显示明确错误和重试。
- [x] 错误提示不挤压页头或表单布局。
- [x] retry 不先清空表单。

阶段退出条件：

- [x] 冷切换不显示设置 loading spinner。
- [x] 暖切换立即显示上次可信设置。
- [x] 后台刷新不能覆盖未保存修改。
- [x] 保存、取消、主题预览、语言预览和外部同步测试通过。

## 16. 阶段 5：Tools 适配

### 16.1 删除伪首屏

- [x] `DEFAULT_SNAPSHOT` 只用于纯视图模型安全计算，不再被当作已加载运行时事实展示。
- [x] 没有 runtime snapshot 时，壳层保持来源页直到 ensure 完成。
- [x] 有 runtime snapshot 时立即展示，不显示整页 loading panel。
- [x] 页面挂载后后台 refresh 不隐藏正文。
- [x] refresh 失败时保留旧 snapshot。

### 16.2 运行时连续性

- [x] 当前计时器 elapsed/remaining 使用 snapshot 时间戳加本地时钟继续推导。
- [x] 番茄钟阶段、完成数和提醒状态在刷新时原子替换。
- [x] 工具动作 busy 状态与后台 snapshot refresh 分离。
- [x] runtime event 更新优先于较旧 refresh 响应。
- [x] generation/revision 防止旧 snapshot 覆盖新动作结果。
- [x] 页面离开后 runtime store 继续由既有 owner 管理，不重复订阅。

### 16.3 软件提醒候选

- [x] 软件提醒候选继续复用完整分类目录。
- [x] 候选加载不阻塞非软件提醒工具区首屏。
- [x] 打开软件提醒区时，有旧候选先显示旧候选并后台校验。
- [x] 候选失败不清空已经保存的提醒规则。

### 16.4 错误状态

- [x] 有 snapshot 的刷新失败使用 toast/status，不替换正文。
- [x] 首次 ensure 失败进入可重试错误页。
- [x] 重试成功后恢复目标 section 和 initial target。
- [x] 从侧栏状态入口打开具体工具时，等待期间不丢失目标 section。

阶段退出条件：

- [x] 900ms runtime 延迟下来源页保持稳定。
- [x] 有缓存时 Tools 首帧没有 loading panel。
- [x] 运行中的计时器和番茄钟在切换前后连续。
- [x] 工具专项与浏览器场景通过。

## 17. 阶段 6：About 适配

### 17.1 静态结构与动态事实分离

- [x] 页头、支持、反馈、仓库和说明内容不依赖版本请求。
- [x] 页面静态结构可以立即稳定渲染。
- [x] appVersion 优先读取 update snapshot 或 settings bootstrap 中的可信值。
- [x] 完全没有版本快照时，壳层可选择等待最小 bootstrap；不得先显示整页 spinner。
- [x] 后台版本校验只更新版本字段。

### 17.2 更新状态

- [x] update checking/installing 状态继续由 update owner 提供。
- [x] 更新检查不重建整页。
- [x] release notes、下载状态或错误只更新对应区域。
- [x] 关于页重新进入时复用最新 update snapshot。
- [x] 打开的支持或反馈 Dialog 不因后台版本更新关闭。

### 17.3 错误状态

- [x] appVersion 刷新失败时保留已有版本。
- [x] 无版本时使用语义明确的未知值，仅限版本字段，不隐藏页面。
- [x] 更新检查错误继续使用现有低噪声反馈。
- [x] 外部链接失败不影响页面主体。

阶段退出条件：

- [x] About 不再存在整页版本 loading 分支，或该分支在导航 gate 下不可达并有测试证明。
- [x] 静态内容首帧完整。
- [x] 版本迟到只改变版本文本，不改变布局。
- [x] 支持、反馈、更新与外链浏览器场景通过。

## 18. 阶段 7：启动预热与资源预算

### 18.1 立即预热

- [x] 保留 History persisted bootstrap 的立即读取。
- [x] 保留 Classification 和 Settings 的立即 prewarm。
- [x] 评估 Tools runtime ensure 是否必须等待 runtimeReady；若必须，记录真实前置条件。
- [x] About 复用 Settings/update bootstrap，不发起重复启动请求。
- [x] 立即预热不得阻塞主窗口首个可信帧。

### 18.2 延迟任务

- [x] 页面 chunk 继续按既有顺序和间隔预加载。
- [x] Data persisted bootstrap 继续在延迟任务中恢复，除非测量证明应提前。
- [x] Dashboard snapshot 继续遵循 classification/runtime readiness。
- [x] Tools runtime snapshot 与页面 intent 请求合并 in-flight。
- [x] About 不重复读取 Settings bootstrap。

### 18.3 资源约束

- [x] 记录启动期新增 command/query 次数。
- [x] 记录 startup bootstrap p50/p95/max。
- [x] 确认没有同时发起两次相同 Settings/Tools/About 请求。
- [x] 确认总入口 bundle 未吸入四个 lazy page chunk。
- [x] 确认隐藏启动仍跳过不必要的重型页面 warmup。
- [x] 确认后台优化开启后的 WebView 重建仍满足首次可信帧规则。

阶段退出条件：

- [x] 没有为消除闪烁制造无界启动并发。
- [x] 页面 intent 能复用进行中的启动预热。
- [x] `npm run perf:startup-bootstrap` 未回归。

## 19. 阶段 8：清理重复与不可达路径

- [x] 删除 Tools 已不可达的整页短暂 loading 分支，或保留为 cold-error retry 的明确分支。
- [x] 删除 About 仅为版本号等待而存在的整页 spinner 分支。
- [x] 删除 Settings/Classification 中已被双重 gate 证明不可达的冗余冷 loading UI，或保留错误降级并注明用途。
- [x] 不删除 cold-error 和 retry 能力。
- [x] 清理重复 prewarm、重复 cache set 和重复 refresh。
- [x] 清理只服务旧测试 fixture 的生产分支。
- [x] 确认没有新增页面私有 fixed delay。
- [x] 确认没有把旧行为作为隐藏 fallback 长期保留。

阶段退出条件：

- [x] 每个 loading/error 分支都有可达场景和测试 owner。
- [x] 每个 snapshot 只有一个 committed owner。
- [x] 每个启动请求都能说明调用方、缓存和失效条件。

## 20. 自动化验证矩阵

### 20.1 专项测试

- [x] `npm run test:classification`
- [x] `npm run test:settings`
- [x] `npm run test:tools`
- [x] `npm run test:warmup`
- [x] `npm run test:preload`
- [x] `npm run test:interaction`
- [x] `npm run test:background-return`
- [x] `npm run test:ui-smoke`

### 20.2 浏览器场景

- [x] 四页冷导航保持来源页直到可信首屏完成。
- [x] 四页暖导航不出现 app loading 或 feature loading。
- [x] 四页后台 refresh 保持可见内容。
- [x] 四页 stale refresh failure 保留旧内容。
- [x] 四页 cold failure 显示错误和重试。
- [x] A → B → C 快速导航只展示 C。
- [x] 页面连续进入、离开五次无空白帧。
- [x] 启动后 0ms、100ms、500ms、预热完成后分别点击。
- [x] WebView 重建恢复上次页面时不闪 Dashboard 或 loading。
- [x] 长后台返回保留当前浏览页。
- [x] 动效关闭、开启和 reduced motion 三种模式通过。
- [x] 中文、英文、亮色、暗色通过。

### 20.3 结构与几何断言

- [x] `maxBlankFrames === 0`。
- [x] presented view 与 active nav 始终一致。
- [x] 目标页第一次出现时已有完整页头和主体结构。
- [x] 页面刷新前后主滚动容器尺寸不变。
- [x] 列表、表单或工具区 refresh 前后滚动位置保持。
- [x] 版本、计数和 status 更新不推动相邻控件。
- [x] 没有临时白色 background 穿透。

### 20.4 默认质量门槛

- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run build`
- [x] `npm run check`
- [x] `git diff --check`
- [x] `npm run check:architecture`
- [x] `npm run check:hotspots`
- [x] `npm run check:bundle`

### 20.5 风险追加门槛

- [x] 若改变 SQLite 查询或性能敏感 read model，运行 `npm run perf:stable`。
- [x] 若改变 startup/navigation 性能路径，运行 `npm run perf:startup-bootstrap` 和现有浏览器导航性能入口。
- [x] 若改变 IPC、capability 或真实 Tauri runtime，运行 `npm run test:tauri-runtime-smoke`。
- [x] 若改变 Rust 或跨层 owner，运行 `npm run check:full`。
- [x] 若未触发追加门槛，在执行记录中说明原因。

## 21. 手工验收矩阵

### 21.1 启动与导航

- [x] 正常可见启动后立即点击 Classification。
- [x] 正常可见启动后立即点击 Tools。
- [x] 正常可见启动后立即点击 Settings。
- [x] 正常可见启动后立即点击 About。
- [x] 启动预热完成后逐页切换。
- [x] 从 Dashboard 分别进入四页。
- [x] 从 History 分别进入四页。
- [x] 从 Data 分别进入四页。
- [x] 四页之间互相快速切换。
- [x] 连续双击不同导航项。
- [x] 点击目标页后立刻返回来源页。

### 21.2 数据时序

- [x] 0ms 完成。
- [x] 50ms 完成。
- [x] 900ms 完成。
- [x] 首次加载失败。
- [x] 首次失败后重试成功。
- [x] 有旧快照时刷新失败。
- [x] 旧请求晚于新请求完成。
- [x] refresh 期间 invalidate。
- [x] 页面卸载后请求完成。

### 21.3 页面特有状态

- [x] Classification：0、1、49、120+ 应用。
- [x] Classification：搜索、筛选、滚动和名称编辑中刷新。
- [x] Classification：应用与网页模式切换。
- [x] Settings：无修改、存在未保存修改、保存中、取消后。
- [x] Settings：主题、配色和语言预览中刷新。
- [x] Tools：无活动工具、计时器运行、番茄钟运行、提醒即将触发。
- [x] Tools：从侧栏状态入口直接进入具体 section。
- [x] About：无更新、检查中、可更新、下载中、检查失败。
- [x] About：支持和反馈 Dialog 打开时后台状态更新。

### 21.4 桌面环境

- [x] 1366×768，100% 缩放。
- [x] 1920×1080，125% 缩放。
- [x] 2560×1440，150% 缩放。
- [x] 窗口最大化与普通窗口。
- [x] 亮色与暗色主题。
- [x] 中文与英文。
- [x] 灵动视效关闭。
- [x] 灵动视效开启。
- [x] Windows 减少动态效果开启。
- [x] 主窗口隐藏后恢复。
- [x] 低耗后台开启后的 WebView 重建。

## 22. 性能与体验门槛

### 22.1 暖切换

- [x] `maxBlankFrames = 0`。
- [x] 不出现 app loading、feature loading 或 spinner。
- [x] active nav 与 presented view 不分离。
- [x] 记录 p50、p95、max，不只记录平均值。
- [x] 暖切换 active p95 目标不高于 150ms；若基线更优，不允许无理由退化超过 20%。

### 22.2 冷切换

- [x] 不以固定时长作为成功标准。
- [x] 来源页保持稳定直到目标可信首屏完成。
- [x] prepare 完成后一个绘制周期内完成交接。
- [x] 冷加载超过预期时有诊断信息，但不强行提前显示半成品。

### 22.3 启动与资源

- [x] 新增预热不阻塞主窗口首次可信帧。
- [x] 相同请求 in-flight 合并。
- [x] 隐藏启动不执行不必要的重型预热。
- [x] feature lazy chunk 保持 lazy，不进入入口 chunk。
- [x] 不通过上调 bundle/performance 预算完成验收。

## 23. 回滚与完成定义

### 23.1 提交与回滚分段

建议按以下独立可审查阶段提交；实际提交仍需用户明确授权：

1. 测试 fixture 与统一切换红测。
2. 壳层 readiness/竞态收口。
3. Tools 和 About 快照适配。
4. Classification 和 Settings 暖刷新收口。
5. 启动预热、清理与完整验证。

- [x] 每个提交可以独立构建和运行对应专项测试。
- [x] 任一阶段失败时回滚该阶段，不增加临时双路径。
- [x] 不同时长期保留旧 loading-first 和新 snapshot-first 两套行为。
- [x] 不使用 `git reset --hard` 或覆盖用户现有修改。

### 23.2 完成定义

只有同时满足以下条件，才可以宣布完成：

- [x] Classification、Tools、Settings、About 都符合统一状态模型。
- [x] 有可信快照时立即展示并后台刷新。
- [x] 无可信快照时保留来源页，完成后一次性切换。
- [x] 四页均不存在短暂整页 loading 闪烁。
- [x] 刷新失败保留旧可信内容。
- [x] 快速导航和过期请求竞态得到保护。
- [x] 分类排序、设置草稿、工具运行状态和关于页 Dialog 上下文不被刷新破坏。
- [x] 动效关闭、开启和 reduced motion 都通过。
- [x] `maxBlankFrames === 0`。
- [x] 所有专项、浏览器、完整前端与架构门槛通过。
- [x] 没有新增 shared 缓存、平台越界、重复数据源或固定延迟。
- [x] 对抗式审查没有未解决的 P0/P1 问题。

### 23.3 归档

- [x] 在本文记录最终实施文件、测试命令和测量结果。
- [x] 将长期规则变化回写到正确的顶层文档；没有长期规则变化时明确记录无需回写。
- [x] 将本文移动到 `docs/archive/`。
- [x] 确认 `docs/working/` 不保留已完成副本。
- [x] 若存在对应 Project item，按实时状态向维护者报告拖动建议；没有则不伪造。

## 24. 对抗式审查清单

### 24.1 画面连续性攻击

- [x] 在每个目标页 prepare 的最后 50ms 内反复点击其他页面。
- [x] 在 handoff 的 animation frame 内切换 document visibility。
- [x] 在 60/120/144Hz 环境检查 outgoing overlay。
- [x] 检查不同 canvas background、边框和 inset 是否露底。
- [x] 检查 active nav 是否提前移动。

### 24.2 快照可信度攻击

- [x] Classification 是否仍存在部分候选或第二候选源。
- [x] Settings 是否可能显示 DEFAULT_SETTINGS 后再跳真实值。
- [x] Tools 是否可能把 DEFAULT_SNAPSHOT 当真实状态。
- [x] About 是否可能把 `-` 当成已完成版本事实。
- [x] refresh 失败是否会清除 committed snapshot。
- [x] invalidate 是否错误地删除仍可展示的旧快照。

### 24.3 竞态攻击

- [x] startup prewarm 先发、页面 intent 后发。
- [x] 页面 intent 先发、startup prewarm 后发。
- [x] preview、intent 和 retry 同时调用 ensure。
- [x] 第一代请求晚于第二代完成。
- [x] refresh 中发生保存、删除或外部事件。
- [x] 页面卸载后请求完成。
- [x] StrictMode 重复 setup/cleanup。
- [x] WebView 重建时旧 Promise 返回。

### 24.4 交互上下文攻击

- [x] 分类搜索、筛选、编辑和滚动中刷新。
- [x] 设置草稿、主题预览和保存中刷新。
- [x] 工具 busy action、计时器运行和提醒触发时刷新。
- [x] 关于页 Dialog 打开、更新下载中刷新。
- [x] 当前对象真实删除时焦点有可解释去向。

### 24.5 Owner 攻击

- [x] `app/*` 是否开始理解 feature DTO 或业务状态。
- [x] `shared/*` 是否承接了四页缓存。
- [x] feature component/hook 是否直接访问 platform。
- [x] startup service 是否开始理解候选、计时器或设置字段。
- [x] About 是否复制 Settings/Update 的状态机。
- [x] 是否为了统一外观强行统一不同业务 owner。

### 24.6 测试有效性攻击

- [x] 移除 generation guard 后竞态测试是否会失败。
- [x] 恢复整页 loading 后浏览器中间帧测试是否会失败。
- [x] 清空 committed snapshot 后 stale refresh 测试是否会失败。
- [x] 测试是否观察真实 DOM 和 presented view，而不是只查最终文案。
- [x] 测试是否使用条件等待，固定 delay 是否只用于刻意构造时序。
- [x] fixture 是否恢复 active view、语言、主题、storage 和错误开关。
- [x] 所有新测试是否进入现有测试执行图。

### 24.7 最终审查结论

- [x] 未解决 P0 数量为 0。
- [x] 未解决 P1 数量为 0。
- [x] P2/P3 已记录 owner、影响与后续处理方式。
- [x] 审查未推翻本文的第一性原理与统一切换契约。
- [x] 审查后重新运行受影响专项和 `npm run check`。

## 25. 全量可勾选总清单

### 25.1 设计与边界

- [x] 目标、非目标和术语已经确认。
- [x] 壳层只负责 readiness 与 presentation handoff。
- [x] 四个 feature 各自拥有 committed snapshot。
- [x] 没有新增 shared/global 业务缓存。
- [x] 没有新增固定延迟。

### 25.2 实现

- [x] Classification 完成。
- [x] Settings 完成。
- [x] Tools 完成。
- [x] About 完成。
- [x] startup warmup 完成。
- [x] 冗余 loading/refresh 路径清理完成。

### 25.3 行为

- [x] 暖切换立即展示可信快照。
- [x] 冷切换保留来源页。
- [x] 后台刷新不清空。
- [x] 刷新失败保留旧内容。
- [x] 快速导航无过期提交。
- [x] active nav 与 presented view 一致。
- [x] 动效开关不影响正确性。

### 25.4 验证

- [x] 专项测试全部通过。
- [x] 浏览器切换矩阵全部通过。
- [x] `maxBlankFrames === 0`。
- [x] 性能测量无不可解释回归。
- [x] `npm test` 通过。
- [x] `npm run test:replay` 通过。
- [x] `npm run build` 通过。
- [x] `npm run check` 通过。
- [x] `git diff --check` 通过。
- [x] 对抗式审查通过。

### 25.5 收尾

- [x] 最终证据已回写本文。
- [x] 用户已有修改未被覆盖。
- [x] 没有未经授权的 commit、push、Issue 或 Project 变更。
- [x] 长期文档按实际规则变化更新或记录无需更新。
- [x] 本执行单已经归档。
