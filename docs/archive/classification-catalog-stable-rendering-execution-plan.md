# 分类目录稳定首屏与原子刷新执行方案

> 文档类型：How-to / 结构性执行方案
> 目标读者：Patina 维护者与实际执行本方案的代码代理
> 当前状态：已完成实现、验证与对抗式审查，归档于 2026-07-29
> 长期依据：`product-principles-and-scope.md`、`roadmap-and-prioritization.md`、`engineering-quality.md`、`quiet-pro-component-guidelines.md`、`architecture.md`、`issue-fix-boundary-guardrails.md`

## 0. 完成与归档记录

本节是本执行单的最终执行记录。后续章节保留方案制定时的细粒度清单和推演过程，用于审计当时的决策；本节记录实际完成范围、用户在执行中的覆盖决策和最终证据。

归档状态下，后续清单中的 `[x]` 表示该门槛已经完成，或已经审查并按条件不适用、用户明确覆盖、现有自动化等方式关闭；它不表示每一个条件分支都实际发生。实际执行结果、例外和证据以本节为准。

### 0.1 最终结果

- [x] 应用目录改为 feature-owned 的完整快照，页面不再先发布最近 30 天候选再替换完整目录。
- [x] 启动预热和页面进入共享同一份 in-flight 请求与 committed snapshot。
- [x] 完整目录跨页读取保留并校验 `sourceRevision`；revision 混合时整轮重试一次，连续不一致时拒绝发布。
- [x] 旧 generation、失效中的旧请求和卸载后的迟到请求均不能覆盖新快照。
- [x] 有完整快照的刷新失败保留原列表与原计数，并提供低噪声重试入口。
- [x] 无完整快照的首次失败继续使用既有阻塞式错误与重试语义。
- [x] 筛选文案从冷态起始终显示括号：未知值为 `（—）`，完成后替换为真实数字，不伪造 `0`。
- [x] 按用户执行中新增的明确要求，不为计数或刷新入口预留宽度，不增加固定 item 宽度。
- [x] 浏览器验收改为保护工具栏高度和同一行结构；自然内容宽度可以随 `（—）` 到真实数字发生小幅变化，但不得导致换行或布局重排。
- [x] 应用卡片只从 committed complete catalog 派生；bootstrap 候选不再进入可见应用目录、计数、搜索或排序。
- [x] 网页模式维持现有数据范围和稳定面板语义，本任务没有把它扩张为“完整历史网页目录”。
- [x] 导入和删除全部历史会显式失效应用目录；导入后的目录刷新失败不会反向清掉已经成功加载的分类 bootstrap。
- [x] 没有修改 Rust 表、Web Sync 协议、分类语义或新增全局共享缓存框架。

### 0.2 实际文件范围

- [x] 平台契约：`src/platform/persistence/classificationPersistence.ts`
- [x] 分类目录服务与快照状态机：`src/features/classification/services/classificationAppCatalog.ts`
- [x] 分类 service 接口与预热：`src/features/classification/services/classificationService.ts`
- [x] React 外部快照接入：`src/features/classification/hooks/useClassificationAppCatalog.ts`
- [x] 页面派生状态：`src/features/classification/hooks/useAppMappingState.ts`
- [x] 稳定计数、冷态和错误反馈：`src/features/classification/components/AppMapping.tsx`
- [x] 导入后的显式失效：`src/app/hooks/useImportClassificationCoordinator.ts`
- [x] 状态机、revision、竞态和身份复用测试：`tests/classificationAppCatalog.test.ts`
- [x] 真实浏览器冷态、完整目录和同一行结构测试：`tests/uiBrowserSmoke/classificationScenarios.ts`

### 0.3 验证证据

- [x] `npm run test:classification`：46 条 draft state + 24 条 catalog 测试通过。
- [x] `npm run test:warmup`：12 条通过。
- [x] `npm run test:persistence`：7 + 4 条通过。
- [x] `npm run test:ui-smoke`：50 条通过。
- [x] `npm run test:ui-browser-smoke`：58 条真实浏览器测试通过。
- [x] `npm run check`：类型、Lint、命名、架构、IPC、hotspot、Quiet Pro、测试治理、覆盖率、默认测试、变异测试、浏览器测试、构建和包体预算全部通过。
- [x] 关键变异测试：14/14 killed。
- [x] `npm run perf:classification-app-catalog`：首屏 p50 14.27ms / p95 15.23ms；深页 p50 14.01ms / p95 15.64ms；搜索 p50 16.17ms / p95 19.24ms；均低于预算且无 base table scan。
- [x] `git diff --check` 通过。
- [x] 真实浏览器证据覆盖冷启动、失败重试、130 项完整目录、窄屏同一行结构、中文/英文和受支持 DPI 矩阵。

### 0.4 对抗式审查结论

- [x] 事实源攻击：未发现第二个可见应用候选数组；计数、搜索和排序均只依赖 committed complete catalog。
- [x] 竞态攻击：新增并通过 warmup/page dedupe、latest generation、refresh 期间 invalidate、mixed revision、冷失败 retry 测试。
- [x] 数据完整性攻击：older-than-30-days、native/imported、alias/canonical、孤儿 mapping 和删除失效语义均有既有或新增测试保护。
- [x] Owner 攻击：缓存仍归 classification feature；component/hook 未直接调用 platform gateway；startup 只调用 feature prewarm。
- [x] 视觉攻击：撤销曾引起窄屏换行的 92px item 定宽；最终实现没有预留宽度，浏览器测试证明加载前后控件不换行、不改变高度。
- [x] 错误攻击：审查中补齐 retained snapshot 的可恢复入口，并修复目录刷新失败误伤 bootstrap cache 的错误传播。
- [x] 测试有效性攻击：latest-generation 测试已从空断言改为真实乱序请求；几何测试读取真实 DOM；等待条件有界；所有新增测试进入 `npm run check`。
- [x] 未解决 P0：0。
- [x] 未解决 P1：0。
- [x] 已知且由用户明确选择的权衡：不预留宽度，因此未知计数变为真实数字时允许自然字宽的小幅变化，但不允许换行或结构重排。
- [x] live GitHub Project 读取因本机代理 `127.0.0.1:9` 不可达而未取得可确认条目；未伪造或代替维护者修改 Project 状态。

## 1. 如何使用本文档

本文档用于消除分类页应用目录的两类可见不稳定：

1. 顶部筛选项从“没有括号和数字”跳成“带括号和数字”。
2. 下方应用卡片先显示启动候选，随后被完整目录整体替换并重新排序。

执行时遵守以下规则：

- [x] 本文档按“执行单模式”编写，因为修复会同时触及分类 feature、启动预热与持久化读模型边界。
- [x] 本文档放在 `docs/working/`，不作为新的长期母文档。
- [x] 开始实现前，确认当前工作树中已有用户改动并记录冲突风险。
- [x] 开始某一阶段前，确认上一阶段的退出条件已经满足。
- [x] 每完成一个步骤，立即勾选，并在步骤下记录测试、截图、命令结果或代码位置。
- [x] 不把“页面看起来不跳了”当作完成，必须用状态、请求次数和元素几何证据证明。
- [x] 若实现需要新增 Rust 表、修改网页同步协议、改变分类语义或新增通用共享抽象，立即停止并重新确认范围。
- [x] 若实现发现当前代码事实与本文档不一致，先修订本文档并说明原因，再继续编码。
- [x] 实现和常规验证完成后，执行第 30 节的对抗式审查。
- [x] 对抗式审查通过后，将本文档移入 `docs/archive/`。

## 2. 一句话问题定义

分类页目前同时使用“最近 30 天启动候选”和“完整应用目录”两个不同完备度的数据集合：界面先发布前者，等待后者完成后再整体替换，导致计数标签改变结构、列表重新排序和用户视觉上下文跳动。

## 3. 当前事实与根因证据

### 3.1 已确认的界面事实

- [x] 应用模式的筛选项在完整目录加载期间只显示“全部 / 已分类 / 未分类”。
- [x] 完整目录加载完成后，筛选项变为“全部 (N) / 已分类 (N) / 未分类 (N)”。
- [x] 这次结构变化会改变分段控件宽度，并推动同一工具栏中的搜索框或相邻控件。
- [x] 应用卡片会先使用启动候选渲染，完整目录完成后再采用另一份候选集合。
- [x] 完整目录提交后会重新执行按显示名称和 executable identity 的排序。
- [x] 新加入、名称升级或从别名归一到 canonical identity 的候选可能插入现有列表前方。
- [x] 应用图标容器已有固定尺寸，图标异步替换不是列表整体换位的主要原因。
- [x] 网页模式当前与应用模式使用不同的候选加载链路，不能假设两者已天然共享同一稳定状态机。

### 3.2 已确认的代码事实

- [x] `useAppMappingState.ts` 使用 `classificationBootstrapCache` 中的 `observed` 作为应用候选初值。
- [x] `ClassificationService.loadObservedAppCandidates()` 默认只读取最近 30 天，并限制候选数量。
- [x] `useClassificationAppCatalog.ts` 另行读取完整 `recorded_app_catalog`。
- [x] `useClassificationAppCatalog.ts` 在没有完整目录缓存时先把 `initialCandidates` 写入可见 state。
- [x] 完整目录完成后，hook 用完整候选数组整体替换当前可见数组。
- [x] `loadAll` 依赖 `initialCandidates` 数组引用；启动 bootstrap 刷新产生新的数组引用后，会使 effect 失效并重新请求。
- [x] `AppMapping.tsx` 通过 `activeCountsReady` 在目录加载阶段完全省略计数括号。
- [x] `classificationScenarios.ts` 当前明确断言不应在完整目录完成前显示数字。
- [x] `classificationAppCatalog.test.ts` 中“only the latest catalog generation may update visible state”测试目前没有行为断言。
- [x] 当前 `recorded_app_catalog` 由 Rust 持久化活动读模型持有，并通过 typed command 提供分页、revision 和读取路径信息。
- [x] `classificationPersistence.ts` 当前把活动目录页映射成分类目录页时丢弃了 `sourceRevision` 和 `readPath`。
- [x] 网页候选当前由 `loadObservedWebDomainCandidates(days = 30, limit = 120)` 提供，不得在没有进一步证据时称为“完整历史网页目录”。

### 3.3 当前测试事实

- [x] `npm run test:classification` 当前通过 46 条分类 draft state 测试和 17 条应用目录测试。
- [x] 当前通过只证明既有行为被实现，不证明首屏计数和卡片位置稳定。
- [x] 浏览器 smoke 当前保护了“加载中不显示完整计数”的旧决策，修复时必须更新而不是保留。
- [x] 当前测试没有测量分段控件的宽度、搜索框 X 坐标或首批卡片位置。
- [x] 当前测试没有证明 bootstrap 数组引用改变时不会重启完整目录请求。
- [x] 当前测试没有证明跨页读取时 source revision 变化会被识别并重试。

## 4. 根因链与竞态时序

### 4.1 当前冷启动时序

```text
进入分类页
→ bootstrap 尚未完成
→ 页面保留空结构
→ bootstrap 返回最近 30 天应用候选
→ 页面发布最近候选和应用卡片
→ 完整 recorded_app_catalog 查询开始或继续
→ 顶部计数仍被隐藏
→ 完整目录全部读取完成
→ 页面整体替换候选数组
→ 重新归一化、筛选和按名称排序
→ 顶部补上括号和数字
→ 卡片发生插入、换位或显示名称变化
```

### 4.2 当前暖启动或返回页面时序

```text
进入分类页
→ bootstrap cache 立即提供最近候选
→ completeCatalogCache 可能存在，也可能不存在
→ 页面仍发起 bootstrap 后台刷新
→ setCandidates 写入新的数组引用
→ useClassificationAppCatalog 的 loadAll identity 改变
→ effect cleanup 使旧 generation 失效
→ 再次启动完整目录读取
→ 可能重新发布最近候选或旧完整缓存
→ 完整目录完成后再次提交
```

### 4.3 可见跳动的直接原因

- 顶部跳动不是数字变化本身，而是 label DOM 文本结构由无计数变成有计数。
- 列表跳动不是 React key 错误，而是可见候选集合和排序输入被整体替换。
- 重复请求不是用户操作触发，而是 effect 把数组引用当作目录失效信号。
- 目录读模型已经存在，但前端没有把它包装成“可跨挂载复用、原子提交、显式失效”的完整快照。

## 5. 第一性原理

### 5.1 一个界面只能有一个候选事实源

同一时刻用于下面四件事的候选集合必须完全相同：

1. 卡片列表。
2. “全部 / 已分类 / 未分类 / 排除”的计数。
3. 搜索输入的候选范围。
4. 分类、排除与名称覆盖所作用的 identity 集合。

- [x] 应用模式的候选事实源确定为最后一次完整提交的 canonical 应用目录快照。
- [x] 最近 30 天候选只能服务启动辅助、图标预取或其他明确用途，不再作为分类页应用列表的临时事实源。
- [x] 实现后证明列表、计数和搜索都消费同一 `committedSnapshot.candidates`。
- [x] 删除任何“列表用 A、计数等 B 完成后再显示”的双事实分支。

### 5.2 完整快照原则

“已经加载 40 个，共 48 个”不是一个可发布为完整分类目录的事实。

- [x] 分类页只发布完整目录快照。
- [x] 分页读取属于内部实现，不允许每页推动可见列表。
- [x] 所有分页必须属于同一可接受 revision。
- [x] 只有最后一页成功、canonical 去重完成且 revision 一致时，才能原子提交。
- [x] 任一页失败时不得覆盖上一份完整快照。

### 5.3 原子发布原则

一次新目录提交必须同时更新：

- canonical 候选集合；
- 快照 revision 或 generation；
- 完成时间；
- 后续派生计数与排序的唯一输入。

- [x] 不允许先更新列表再更新计数。
- [x] 不允许先清空旧快照再等待新快照。
- [x] 不允许错误请求、旧 generation 或中途取消请求提交可见结果。

### 5.4 陈旧但完整优于新鲜但残缺

后台刷新期间，上一份完整快照虽然可能稍旧，但仍然自洽；部分新数据则会让计数、筛选和列表互相矛盾。

- [x] 有完整快照时，刷新期间继续展示该快照。
- [x] 刷新失败时，继续展示该快照，并提供低噪声可恢复反馈。
- [x] 只有没有任何完整快照的真实冷启动，才显示稳定的首次加载结构。
- [x] 错误状态不得把已有列表和计数替换成整块空白。

### 5.5 精确数字必须对应精确集合

- [x] 不把最近 30 天候选数量冒充完整目录数量。
- [x] 不在完整快照未知时显示 `0`。
- [x] 冷启动未知态使用稳定占位，例如 `全部 (—)`，而不是删除括号。
- [x] 数字更新和候选提交发生在同一次 React commit 所消费的同一快照上。

### 5.6 异步工作不得改变控件骨架

- [x] 筛选项从加载到完成始终保持相同文字结构。
- [x] 计数槽使用 tabular numerals 和可预测的最小宽度。
- [x] 不使用 shimmer、大面积 loading 遮罩、淡出整张面板或列表位移动画掩盖问题。
- [x] 首次加载、刷新、错误和完成状态下，筛选栏主要控件的几何保持稳定。

### 5.7 请求必须由语义事件驱动

允许触发目录刷新的是：

- 数据导入完成；
- 应用或网页历史删除完成；
- 数据清理或恢复完成；
- 活动目录 revision 明确变化且产品决定立即刷新；
- 用户点击重试；
- 首次没有完整快照；
- 显式失效 API。

不允许触发目录刷新的包括：

- 数组引用改变；
- 父组件普通 re-render；
- 图标加载完成；
- 分类颜色变化；
- 搜索文本变化；
- 筛选项变化；
- 主题或语言变化。

## 6. 已确认的产品与工程决策

- [x] 修复属于 `Classification` 高频核心页面体验问题。
- [x] 使用现有 Quiet Pro 分段控件和面板骨架，不重新设计页面。
- [x] 应用完整目录继续以 Rust `recorded_app_catalog` 为事实 owner。
- [x] 用户分类、重命名、配色和排除规则继续留在前端 classification feature 组合，不固化进 Rust 活动目录。
- [x] 前端 classification service 拥有“读取完整目录、canonical 合并、快照缓存、显式失效”的 feature 规则。
- [x] hook 只订阅和编排快照生命周期，不拥有第二份跨挂载目录缓存。
- [x] `app/services/startupWarmupService.ts` 只负责调度预热，不承接分类目录规则。
- [x] 页面组件只消费可见状态，不直接访问 platform gateway。
- [x] 不新增根层 `src/lib/`、`src/types/` 或新的 shared 公共桶。
- [x] 不为了消除跳动修改分类规则、默认分类、排除语义或保存流程。
- [x] 不给目录设置人为的 5 项、7 项或 120 项可见上限；分页只控制内部读取成本。
- [x] 网页模式必须获得一致的稳定呈现规则，但本执行单不默认新增“全历史网页目录”Rust 表。
- [x] 如果产品验收要求网页分类也覆盖全部历史域名，应单独确认数据范围和 Rust owner，不能在本修复中静默扩张。

## 7. 目标

- [x] 常规进入分类页时，顶部直接显示稳定的计数结构。
- [x] 已有完整快照时，刷新过程中计数不消失、不变成破折号。
- [x] 没有完整快照时，筛选项显示稳定占位，不改变按钮宽度。
- [x] 应用卡片不再从最近 30 天候选切换到完整目录候选。
- [x] bootstrap 产生等价新数组时，不重新启动完整目录请求。
- [x] 完整目录刷新只在原子提交点更新一次可见候选。
- [x] 多页目录读取期间不逐页更新卡片。
- [x] 旧请求、取消请求和 revision 不一致请求无法覆盖新快照。
- [x] 应用与网页模式切换时，面板骨架、筛选栏和已有列表不闪空。
- [x] 刷新失败时保留最后一次完整可读结果。
- [x] 卡片 focus、编辑状态和滚动上下文不因后台刷新无故丢失。
- [x] 首屏稳定性具有自动化浏览器证据。

## 8. 非目标

- [x] 不修改分类页整体布局、双栏断点或卡片视觉设计。
- [x] 不修改页面标题、副标题和导航。
- [x] 不重新定义“全部 / 已分类 / 未分类 / 排除”的业务含义。
- [x] 不改变应用和网页排除后的统计语义。
- [x] 不改变用户重命名、颜色、分类选择和标题记录开关。
- [x] 不给应用目录增加新的手动分页或“加载更多”按钮。
- [x] 不引入远程缓存、账号、云同步或跨设备目录。
- [x] 不修改 Patina Web Sync 协议。
- [x] 不为本问题新增通用数据请求框架。
- [x] 不把所有页面迁移到新的全局缓存方案。
- [x] 不用动画、延时显示或人为 sleep 掩盖竞态。
- [x] 不为了测试方便降低既有错误、重试或完整目录语义。

## 9. 必须始终成立的不变量

- [x] `visibleCandidates === committedSnapshot.candidates`。
- [x] `counts` 只从 `visibleCandidates + currentDraftOverrides` 派生。
- [x] 应用搜索只作用于 `visibleCandidates`。
- [x] 完整快照存在时，`refreshing` 不改变 `visibleCandidates`。
- [x] 完整快照不存在时，不显示伪造的 `0`。
- [x] 同一个请求 generation 最多提交一次完整快照。
- [x] 旧 generation 永远不能提交。
- [x] 多页应用目录快照内的 `sourceRevision` 必须一致。
- [x] revision 不一致时丢弃整次中间结果并有界重试。
- [x] background refresh 失败不删除现有完整快照。
- [x] canonical executable 是应用卡片的稳定 key。
- [x] normalized domain 是网页卡片的稳定 key。
- [x] 图标、主题色和 favicon 更新不改变候选顺序。
- [x] 用户编辑名称时，不因输入中的临时文本持续重新排序。
- [x] 保存或取消编辑后的合法排序变化只发生一次且可解释。
- [x] 页面组件、hook 不直接调用 Tauri 或 persistence gateway。
- [x] startup warmup 不保存 classification 私有状态机。

## 10. 所有权与分层

### 10.1 Rust `data/activity_read_model/*`

职责：

- 维护跨启动可重建的 `recorded_app_catalog`。
- 提供稳定 keyset 分页。
- 返回 `sourceRevision`、读取路径和 fallback 信息。
- 保证事实和派生状态的事务边界。

执行要求：

- [x] 先证明现有 Rust command 已提供本方案需要的 revision 信息。
- [x] 如果现有契约足够，不修改 Rust。
- [x] 如果必须修改 Rust DTO，只修改数据读取契约，不把分类规则下沉到 Rust。
- [x] 不在 `commands/*` 添加目录组合或分类计数逻辑。

### 10.2 `src/platform/persistence/*`

职责：

- 解析 typed command payload。
- 保留 Rust 已返回的 `sourceRevision`、`readPath`、`fallbackReason`。
- 映射为前端平台模型。

执行要求：

- [x] `classificationPersistence.ts` 不再丢弃目录 revision。
- [x] parser 对缺失、非法和非有限 revision 明确失败。
- [x] gateway 不承担 canonical executable 或分类映射。

### 10.3 `src/features/classification/services/*`

职责：

- 读取全部应用目录页。
- canonicalize 和合并 alias。
- 验证跨页 revision。
- 管理最后一次完整目录快照。
- 合并并发请求。
- 暴露显式 `prewarm / refresh / invalidate / retry / subscribe` 能力。

执行要求：

- [x] 优先扩展 `classificationAppCatalog.ts` 或增加一个 feature-owned snapshot service。
- [x] 不把缓存放到 `shared/*`。
- [x] 不让页面组件知道分页 cursor。
- [x] 不让 startup service 知道目录页合并细节。

### 10.4 `src/features/classification/hooks/*`

职责：

- 订阅 feature-owned 快照。
- 把快照、draft state、搜索和筛选组合成页面 view state。
- 在组件挂载、卸载和重试时调用语义 API。

执行要求：

- [x] 移除 `initialCandidates` 数组引用驱动的 effect identity。
- [x] 不在 hook 内再维护独立 module-level `completeCatalogCache`。
- [x] 不在刷新开始时把可见 state 重置为 bootstrap 候选。

### 10.5 `src/features/classification/components/*`

职责：

- 渲染完整快照、稳定占位、错误与刷新反馈。
- 保持筛选栏和列表骨架稳定。

执行要求：

- [x] `AppMapping.tsx` 不再通过省略括号表达加载状态。
- [x] 组件不判断目录是否完整；只消费明确的 view state。
- [x] 更新中反馈不得成为页面最强视觉元素。

### 10.6 `src/app/services/startupWarmupService.ts`

职责：

- 在既有前台预热预算内调度 classification snapshot prewarm。
- 记录预热任务成功、失败或跳过。

执行要求：

- [x] 只调用 classification feature 暴露的预热入口。
- [x] 不复制候选、计数、revision 或 retry 状态。
- [x] 不因为 classification 预热失败阻塞应用启动。

## 11. 目标目录快照状态机

### 11.1 建议模型

```ts
type CatalogSnapshotStatus =
  | "cold"
  | "ready"
  | "refreshing"
  | "error";

interface CompleteAppCatalogSnapshot {
  candidates: ObservedAppCandidate[];
  sourceRevision: number;
  completedAtMs: number;
}

interface AppCatalogSnapshotState {
  status: CatalogSnapshotStatus;
  committed: CompleteAppCatalogSnapshot | null;
  requestGeneration: number;
  error: unknown | null;
}
```

这是意图模型，不要求逐字照抄。实现前必须确认：

- [x] `sourceRevision` 在 projection 和事实 fallback 下是否始终可比较。
- [x] `completedAtMs` 只用于诊断和刷新策略，不进入用户统计语义。
- [x] `error` 不直接把原始技术字符串显示给用户。
- [x] `refreshing + committed !== null` 是合法常态。
- [x] `error + committed !== null` 保留可读内容。
- [x] `error + committed === null` 才进入阻塞式首次加载错误。

### 11.2 状态转换

```text
cold
  └─ load success ──────────────> ready(snapshot)
  └─ load failure ──────────────> error(no snapshot)

ready(snapshot)
  └─ refresh requested ─────────> refreshing(snapshot)

refreshing(snapshot)
  └─ refresh success ───────────> ready(new snapshot)
  └─ refresh failure ───────────> error(old snapshot)
  └─ newer generation starts ───> refreshing(old snapshot)

error(old snapshot)
  └─ retry ─────────────────────> refreshing(old snapshot)

error(no snapshot)
  └─ retry ─────────────────────> cold/loading
```

- [x] 每条状态转换都有 unit/model 测试。
- [x] 未列出的状态组合无法由公开 API 构造。
- [x] 旧请求完成不会改变当前 generation 的状态。

## 12. 应用目录加载与缓存契约

### 12.1 分页读取

- [x] 第一页记录 `expectedRevision`。
- [x] 后续每页必须返回同一 revision。
- [x] 任一页 revision 不同，丢弃全部累积候选。
- [x] revision 不一致最多自动重试一个有界次数。
- [x] 超出重试次数后保留旧快照并进入可恢复错误。
- [x] 每页继续遵守现有 raw page 和 canonical batch 预算。
- [x] 内部批次不调用可见 state 更新。
- [x] 目录结束后统一 canonical 去重、名称优先级升级和稳定排序输入构建。

### 12.2 快照缓存

- [x] 缓存保存结构化完整快照，而不是裸候选数组。
- [x] 缓存只在完整请求成功后替换。
- [x] 缓存可跨 classification 组件卸载和重新挂载复用。
- [x] 缓存不能跨数据库覆盖恢复继续冒充有效。
- [x] 缓存不写入 localStorage 或新的持久化表。
- [x] 并发预热和页面请求合并到同一 in-flight promise。
- [x] 已有快照时的普通页面挂载不重复发起相同 refresh。

### 12.3 失效与刷新

- [x] `invalidate()` 只标记快照过期，不立即清空已提交内容。
- [x] `refresh()` 在过期或显式请求时加载新快照。
- [x] `retry()` 复用同一状态机，不绕过 generation。
- [x] `prewarm()` 与页面 `refresh()` 共享 in-flight 请求。
- [x] 删除历史完成后先失效，再刷新。
- [x] 数据恢复、导入和清理完成后通过现有 app 协调点触发失效。

## 13. 网页目录的一致性处理

网页模式当前没有与 `recorded_app_catalog` 对等的已确认全历史 Rust 目录。本执行单先处理“稳定呈现一致性”，不伪造数据完备度。

### 13.1 本轮必须完成

- [x] 网页候选仍由现有明确 owner 加载。
- [x] 网页候选刷新采用“保留上一份完整结果，成功后一次提交”。
- [x] 切换到网页模式时，不先清空再重建列表。
- [x] 网页计数始终与当前网页候选集合一致。
- [x] 网页刷新错误不清空已有网页列表。
- [x] 网页 favicon 更新不改变候选顺序和卡片高度。
- [x] Web Sync 关闭时继续隐藏网页模式，不改变现有产品语义。

### 13.2 必须先核对的范围问题

- [x] 明确当前网页候选的产品语义是“最近 30 天”还是“完整已记录域名”。
- [x] 明确 `limit = 120` 是否会截断真实可管理域名。
- [x] 如果验收要求完整历史网页目录，停止本执行单的数据实现部分。
- [x] 为完整网页目录另写跨 Rust data、IPC 和 classification 的执行单。
- [x] 未经确认不得新增 `recorded_web_domain_catalog` 表。

## 14. 启动预热、页面进入与后台刷新时序

### 14.1 目标冷启动

```text
应用启动
→ startup warmup 调用 classification catalog prewarm
→ feature service 合并或启动唯一目录请求
→ 用户进入分类页
→ 若完整快照已完成：直接显示快照与准确计数
→ 若尚未完成：显示稳定结构和 (—)，不显示最近候选卡片
→ 请求完成：一次提交完整候选与准确计数
```

### 14.2 目标暖启动或返回页面

```text
用户返回分类页
→ 同步读取最后一次完整快照
→ 立即显示原列表与准确计数
→ 若快照仍有效：不请求
→ 若快照已失效：后台刷新但继续显示旧快照
→ 新完整快照成功后一次提交
```

### 14.3 执行步骤

- [x] 在 startup warmup policy 中确认 classification catalog 的优先级和预算。
- [x] 不把完整目录加载加入阻塞首窗口显示的关键路径。
- [x] 页面与 warmup 同时请求时证明只发生一个底层目录读取。
- [x] 页面卸载不取消仍对全局快照有价值的预热请求。
- [x] 页面专属订阅卸载后不再接收 React state 更新。
- [x] StrictMode 开发环境下不重复发起两个真实目录请求。

## 15. 计数标签稳定呈现规则

### 15.1 文案结构

以下结构从首次渲染起保持不变：

```text
全部 (—)     → 全部 (48)
已分类 (—)   → 已分类 (48)
未分类 (—)   → 未分类 (0)
```

- [x] 不再出现只有“全部”而没有括号的中间态。
- [x] 不使用 `全部 (0)` 表示未知。
- [x] 网页模式采用相同结构。
- [x] 排除按钮继续使用既有图标语义，不强行添加可见数字。

### 15.2 几何稳定

- [x] 计数数字使用 tabular numerals。
- [x] 计数槽提供足够但克制的最小 inline size。
- [x] 样式放在现有 Quiet Pro 或 classification feature 样式 owner。
- [x] 不硬编码新颜色、圆角、阴影或边框。
- [x] `全部 (—)` 到 `全部 (48)` 时，搜索框 X 坐标变化不超过浏览器像素容差。
- [x] 三位数和四位数目录数量不会截断或推坏右侧操作区。
- [x] 1366px、当前小屏断点和 1920px 下无横向溢出。

### 15.3 刷新反馈

- [x] 有旧快照时不把数字改回破折号。
- [x] 快速刷新不闪现“更新中”文案。
- [x] 慢刷新若需要提示，使用低噪声 status 或可访问状态，不占用计数槽。
- [x] 刷新提示不改变工具栏高度。

## 16. 应用卡片顺序与身份稳定规则

### 16.1 稳定 identity

- [x] 应用卡片 `key` 继续使用 canonical executable。
- [x] 网页卡片 `key` 继续使用 normalized domain。
- [x] alias 合并在快照提交前完成。
- [x] 同一 canonical identity 不产生两个卡片。

### 16.2 稳定排序

- [x] 排序只消费 committed candidates 和稳定 display name。
- [x] 图标、主题色、favicon 和 total duration 更新不改变名称排序。
- [x] 名称编辑期间继续使用编辑开始时的排序快照。
- [x] 编辑提交后允许发生一次由用户操作直接导致的合法排序变化。
- [x] 后台刷新没有目录成员或显示名称变化时，卡片顺序完全不变。

### 16.3 滚动和焦点

- [x] 原子刷新前记录当前可见锚点卡片 identity 和相对滚动偏移。
- [x] 新快照确实插入前置卡片时，恢复用户原先正在查看的锚点位置。
- [x] 当前聚焦卡片仍存在时，刷新后焦点保持。
- [x] 当前编辑卡片仍存在时，不因后台刷新丢失未保存草稿。
- [x] 当前卡片已被真实删除时，焦点回退到邻近卡片或列表容器。
- [x] 不通过强制固定列表顺序掩盖真实名称排序变化。

## 17. 缓存失效事件矩阵

| 事件 | 应用目录 | 网页候选 | 计数 | 是否立即清空 |
| --- | --- | --- | --- | --- |
| 首次进入且无快照 | 加载 | 加载既有来源 | 未知占位 | 否 |
| 返回页面 | 复用 | 复用 | 保持准确 | 否 |
| 应用分类/配色修改 | 不失效 raw 目录 | 不失效 raw 候选 | 立即从 draft 重算 | 否 |
| 应用重命名提交 | 不失效 raw 目录 | 不适用 | 立即重算 | 否 |
| 网页重命名提交 | 不适用 | 不失效 raw 候选 | 立即重算 | 否 |
| 排除/恢复统计 | 不失效 raw 目录 | 不失效 raw 候选 | 立即重算 | 否 |
| 删除应用全部历史 | 失效并刷新 | 不变 | 新快照后更新 | 否 |
| 删除网页域名历史 | 不变 | 失效并刷新 | 新结果后更新 | 否 |
| 数据导入完成 | 失效并刷新 | 按导入内容判断 | 新快照后更新 | 否 |
| 数据清理完成 | 失效并刷新 | 失效并刷新 | 新结果后更新 | 否 |
| 数据库覆盖恢复 | 强制失效 | 强制失效 | 未知占位或新快照 | 允许丢弃旧数据库快照 |
| 图标加载完成 | 不变 | 不适用 | 不变 | 否 |
| favicon 加载完成 | 不适用 | 不变 | 不变 | 否 |
| 搜索/筛选变化 | 不变 | 不变 | 不变 | 否 |
| 主题/语言变化 | 不变 | 不变 | 文案重渲染 | 否 |

执行要求：

- [x] 逐项核对当前代码中的真实事件入口。
- [x] 为每个会失效的事件指定唯一调用点。
- [x] 不通过“任何 tracking-data-changed 都全量刷新”制造高频目录扫描。
- [x] 如果采用 revision 触发，增加 debounce/in-flight 合并并给出性能证据。

## 18. 错误、重试与降级策略

### 18.1 有完整快照

- [x] 刷新失败后继续显示原卡片和原计数。
- [x] 显示可恢复但低噪声的错误状态。
- [x] 重试不先清空。
- [x] 重试成功后原子替换。

### 18.2 无完整快照

- [x] 显示稳定首次加载结构。
- [x] 筛选项使用 `(—)`。
- [x] 搜索和分类操作在没有候选事实时保持禁用或明确不可用。
- [x] 请求失败后显示现有 Quiet Pro 错误与重试入口。
- [x] 错误面板不改变外层容器高度。

### 18.3 Revision 变化

- [x] 检测跨页 revision 变化。
- [x] 丢弃整次累积结果。
- [x] 使用新 generation 从第一页重新开始。
- [x] 重试次数有界。
- [x] 最终失败时不发布混合 revision 快照。

## 19. 预计文件范围

### 19.1 预期修改

- [x] `src/features/classification/components/AppMapping.tsx`
- [x] `src/features/classification/hooks/useAppMappingState.ts`
- [x] `src/features/classification/hooks/useClassificationAppCatalog.ts`
- [x] `src/features/classification/hooks/useAppMappingDerivedState.ts`
- [x] `src/features/classification/services/classificationAppCatalog.ts`
- [x] `src/features/classification/services/classificationService.ts`
- [x] `src/platform/persistence/classificationPersistence.ts`
- [x] `src/platform/persistence/activityReadModelGateway.ts`，仅在 parser/类型契约需要时
- [x] `src/app/services/startupWarmupService.ts`
- [x] `tests/classificationAppCatalog.test.ts`
- [x] `tests/classificationDraftState.test.ts`
- [x] `tests/startupWarmupService.test.ts`
- [x] `tests/uiBrowserSmoke/classificationScenarios.ts`
- [x] `tests/uiBrowserSmoke/tauriStubs.ts`
- [x] classification 对应 feature CSS 或既有 Quiet Pro 原型样式文件

### 19.2 只在证据要求时修改

- [x] `src-tauri/src/data/activity_read_model/*`
- [x] `src-tauri/src/commands/activity_read_model.rs`
- [x] Tauri command DTO 与 capability 文件
- [x] `scripts/perf/classification-app-catalog-benchmark.ts`
- [x] `src/shared/components/QuietSegmentedFilter.tsx`

### 19.3 默认禁止修改

- [x] Data、Dashboard、History 的读模型与页面。
- [x] Web Sync 协议与扩展仓库。
- [x] classification 分类规则和默认 category token。
- [x] release、版本号、changelog 和 updater。
- [x] bundle budget、hotspot budget 和质量门槛阈值。
- [x] `src/shared/*`，除非已有共享原型存在真实缺陷且获得单独边界确认。

### 19.4 停止并重新评估的条件

- [x] 需要新增完整网页目录 Rust 表。
- [x] 需要新增或改变 IPC command 名称。
- [x] 需要改变 `recorded_app_catalog` schema。
- [x] 需要让 startup service 持有 classification 私有缓存。
- [x] 需要把缓存抽到 shared 或全局请求框架。
- [x] 需要改变应用分类、排除或删除历史语义。
- [x] 预计改动超过 25 个手工维护文件或单提交超过 1000 行手工改动。

## 20. 阶段 0：建立基线与可观测证据

### 20.1 工作树和 Project

- [x] 运行 `git status --short`，记录本任务之外的未提交修改。
- [x] 确认不覆盖 Data 页面等现有用户改动。
- [x] 如果本任务明确对应 live GitHub Project item，使用浏览器插件读取当前状态。
- [x] 如对应 item 已获准开始，告诉维护者将其拖到 `In progress`，并报告 `Next` 补位建议。
- [x] 不在本地文档中伪造 Project 状态。

### 20.2 功能基线

- [x] 运行 `npm run test:classification`。
- [x] 运行 `npm run test:warmup`。
- [x] 运行现有 classification 浏览器场景。
- [x] 在冷启动、暖启动和返回页面三种场景录制 DOM 状态时序。
- [x] 记录目录 command 的真实调用次数。
- [x] 记录 `全部` 筛选项宽度和搜索框 X 坐标。
- [x] 记录前 10 个应用卡片的 identity、top/left 坐标和顺序。
- [x] 记录从无计数到有计数的时间点。

### 20.3 基线退出条件

- [x] 能稳定复现至少一次计数结构跳变。
- [x] 能稳定复现或通过 fixture 构造一次卡片换位。
- [x] 能证明换位来自候选整体替换，而不是图标自然尺寸。
- [x] 能证明 bootstrap 等价数组可能触发目录 effect 重启。
- [x] 基线命令失败时已区分既有失败与本任务回归。

## 21. 阶段 1：先写失败测试

### 21.1 目录状态机测试

- [x] 有旧快照时，调用 refresh 后 committed snapshot 保持不变。
- [x] refresh 成功后只提交一次。
- [x] refresh 失败后保留旧快照。
- [x] 无快照失败时进入可重试错误。
- [x] 旧 generation 完成时不提交。
- [x] 重复 prewarm 和页面 load 合并为一个请求。
- [x] invalidate 不清空 committed snapshot。

### 21.2 Revision 测试

- [x] 多页 revision 相同可以提交。
- [x] 第二页 revision 改变时整次结果不提交。
- [x] revision 改变后从第一页有界重试。
- [x] 连续 revision 变化超过预算时保留旧快照并报错。
- [x] projection 和 facts fallback 的 revision 解析保持有效。

### 21.3 Effect 和数组引用测试

- [x] `initialCandidates` 内容相同但数组引用变化时不重新请求。
- [x] bootstrap refresh 不把完整目录降级成最近候选。
- [x] 图标 map 变化不重新请求目录。
- [x] 搜索和筛选变化不重新请求目录。
- [x] StrictMode 双挂载不产生两个未合并的底层请求。

### 21.4 浏览器几何测试

- [x] 首次 150ms 内筛选项已经包含括号结构。
- [x] 完成加载后筛选栏高度不变。
- [x] `全部` 筛选项宽度变化在容差内。
- [x] 搜索框 X 坐标变化在容差内。
- [x] 有缓存后台刷新时，前 10 个稳定 identity 的坐标不变。
- [x] 加载图标前后卡片高度不变。
- [x] 页面返回时立即保留上次完整计数。

### 21.5 红测退出条件

- [x] 至少一条测试因旧的“隐藏括号”逻辑稳定失败。
- [x] 至少一条测试因 bootstrap 候选替换完整目录稳定失败。
- [x] 至少一条测试因空的 latest-generation 保护稳定失败。
- [x] 测试失败信息能够指向状态机、请求次数或几何变化，不是笼统超时。

## 22. 阶段 2：建立完整应用目录快照服务

- [x] 定义 feature-owned 完整目录快照类型。
- [x] 把裸 `completeCatalogCache` 升级为结构化 snapshot state。
- [x] 把 in-flight promise、generation 和 committed snapshot 放到同一 owner。
- [x] 保留现有 canonical executable 合并规则。
- [x] 保留 alias 名称升级优先级。
- [x] 从 platform 映射中保留 source revision。
- [x] 在 controller 中校验跨页 revision。
- [x] controller 只在完成时发出一次提交。
- [x] 增加 `prewarm`。
- [x] 增加 `getSnapshot` 或等价同步读取。
- [x] 增加 `subscribe` 或使用 `useSyncExternalStore` 所需的稳定接口。
- [x] 增加 `invalidate`。
- [x] 增加 `refresh/retry`。
- [x] 并发调用共享一个 in-flight 请求。
- [x] 旧 generation 结果丢弃。
- [x] 请求失败保留 committed snapshot。

阶段退出条件：

- [x] unit/model 测试覆盖所有状态转换。
- [x] 完整目录测试不再包含空断言。
- [x] 现有 130 项完整目录 fixture 仍全部加载。
- [x] older-than-30-days 应用仍能进入最终快照。
- [x] 没有新增 shared 或 app 私有业务 owner。

## 23. 阶段 3：消除双候选源和引用驱动请求

- [x] `useClassificationAppCatalog` 不再接收会频繁变化的 `initialCandidates` 作为可见目录。
- [x] 最近 30 天 `candidates` 不再传给完整目录 hook 作为 fallback UI。
- [x] hook 订阅完整目录 snapshot service。
- [x] hook effect 依赖稳定语义入口，不依赖候选数组。
- [x] bootstrap 更新仍可更新 overrides、网页候选和 bootstrap icons。
- [x] bootstrap 更新不覆盖完整应用候选。
- [x] `useAppMappingDerivedState` 的应用候选只来自 committed snapshot。
- [x] `counts` 和 `filteredCandidates` 使用同一数组引用。
- [x] 目录刷新期间保持上一 committed candidate array。
- [x] retry 走 snapshot service，不创建第二套请求。

阶段退出条件：

- [x] 等价 bootstrap 刷新不会增加目录 command 次数。
- [x] 应用卡片不再从最近候选切到完整候选。
- [x] 分类草稿、保存、取消和删除流程专项测试通过。

## 24. 阶段 4：接入启动预热与显式失效

- [x] 在 classification feature 暴露预热入口。
- [x] startup warmup 调用该入口但不阻塞主窗口。
- [x] prewarm 与页面挂载合并请求。
- [x] 页面进入时同步消费已完成快照。
- [x] 导入完成后失效应用目录。
- [x] 删除应用历史后失效并刷新。
- [x] 数据清理后失效相关目录。
- [x] 数据库覆盖恢复后强制丢弃旧数据库快照。
- [x] 普通分类、颜色、重命名和排除编辑不刷新 raw 目录。
- [x] 评估 tracking data changed 是否需要目录刷新。
- [x] 如果需要，使用 revision 与有界合并，不对每个心跳刷新。

阶段退出条件：

- [x] startup warmup 测试证明失败不阻塞启动。
- [x] 并发预热和页面进入只有一次真实目录读取。
- [x] 恢复或清理后不会显示旧数据库目录。

## 25. 阶段 5：修复计数与列表视觉稳定性

### 25.1 计数

- [x] 删除“加载中完全省略括号”的分支。
- [x] 冷启动显示 `(—)`。
- [x] 已有快照刷新时继续显示旧准确数字。
- [x] 原子提交后一次更新新数字。
- [x] 增加稳定计数槽样式。
- [x] 暗色和亮色主题使用既有 token。
- [x] 窄屏和全屏无溢出。

### 25.2 列表

- [x] 首次没有完整快照时不发布最近候选列表。
- [x] 有完整快照时不在刷新开始清空。
- [x] 新快照无语义变化时复用稳定候选对象或避免无意义 commit。
- [x] 新快照有真实变化时一次提交。
- [x] 保留卡片 identity、焦点和编辑草稿。
- [x] 必要时实现 feature-owned scroll anchor 恢复。
- [x] 图标加载只替换固定容器内容。

### 25.3 错误与刷新反馈

- [x] 有旧快照错误时不切换为整面板错误页。
- [x] 无快照错误时保留现有显式重试。
- [x] 快速刷新不闪提示。
- [x] 慢刷新提示不改变布局。

阶段退出条件：

- [x] 浏览器几何测试通过。
- [x] 人工慢速 fixture 下看不到括号结构跳变。
- [x] 人工慢速 fixture 下看不到最近候选被完整目录换位。

## 26. 阶段 6：应用与网页模式一致性

- [x] 为网页候选定义明确的 committed/refreshing/error 状态。
- [x] 网页模式有旧候选时刷新不清空。
- [x] 应用与网页切换不改变外层面板高度。
- [x] 两种模式筛选项使用相同计数结构。
- [x] 两种模式的搜索框位置稳定。
- [x] 两种模式的错误反馈等级一致。
- [x] Web Sync 关闭时网页选项仍完全隐藏。
- [x] Web Sync 开启后第一次进入网页模式不显示虚假 `0`。
- [x] 核对网页 30 天和 120 项边界，并记录为已确认产品事实或后续事项。

阶段退出条件：

- [x] 应用和网页模式切换浏览器场景通过。
- [x] 没有借本轮修复新增全历史网页目录。
- [x] 如果发现网页目录产品范围不满足，已停止扩张并形成独立待确认范围。

## 27. 阶段 7：验证与性能门槛

### 27.1 专项测试

- [x] `npm run test:classification`
- [x] `npm run test:warmup`
- [x] `npm run test:persistence`
- [x] `npm run test:ui-smoke`
- [x] classification 对应浏览器 smoke 场景

### 27.2 性能验证

- [x] `npm run perf:classification-app-catalog`
- [x] 记录冷启动目录读取总时长。
- [x] 记录暖启动同步快照读取时间。
- [x] 记录分页 command 次数。
- [x] 记录 prewarm + 页面并发时 command 次数。
- [x] 记录 p50、p95、max，而不是只记录平均值。
- [x] 若改变 Rust read model、SQLite 查询或刷新频率，运行 `npm run perf:stable`。
- [x] 不通过提高预算让性能检查通过。

### 27.3 默认门槛

- [x] `npm run check`
- [x] `git diff --check`
- [x] 检查没有新增 mojibake、UTF-8 BOM 或中文编码损坏。
- [x] 检查没有新增 Quiet Pro style debt。
- [x] 检查没有新增孤儿测试入口。

### 27.4 风险追加门槛

- [x] 若修改 platform typed command payload 或 Rust DTO，运行 `npm run test:tauri-runtime-smoke`。
- [x] 若修改 Rust data owner、IPC 或架构边界，运行 `npm run check:full`。
- [x] 若只完成前端 feature 内收口且未改变底层契约，记录为何无需 Rust 追加验证。

## 28. 手工验收矩阵

### 28.1 启动状态

- [x] 冷启动后立刻进入分类页。
- [x] 启动预热已完成后进入分类页。
- [x] 启动预热尚未完成时进入分类页。
- [x] 从其他页面返回分类页。
- [x] 分类页连续进入、离开五次。
- [x] 开发 StrictMode 下重复挂载。
- [x] 生产构建下首次进入。

### 28.2 数据规模

- [x] 0 个应用。
- [x] 1 个应用。
- [x] 48 个应用。
- [x] 60 个应用边界。
- [x] 61 个应用跨内部 batch。
- [x] 120 个应用。
- [x] 130 个应用跨旧限制。
- [x] 多个 alias 合并为同一 canonical executable。
- [x] 名称缺失，只能使用 executable fallback。
- [x] 全部应用已分类。
- [x] 全部应用未分类。
- [x] 存在排除应用。

### 28.3 网络和错误模拟

本地产品不依赖远程网络，但仍需模拟 IPC/SQLite 读取时序：

- [x] 50ms 快速完成。
- [x] 900ms 慢速完成。
- [x] 第二页失败。
- [x] 最后一页失败。
- [x] revision 在第二页改变。
- [x] 第一次失败后重试成功。
- [x] 有旧快照时刷新失败。
- [x] 无旧快照时首次加载失败。

### 28.4 交互状态

- [x] 搜索中后台刷新。
- [x] 已分类筛选中后台刷新。
- [x] 未分类筛选中后台刷新。
- [x] 卡片名称编辑中后台刷新。
- [x] 分类下拉打开时后台刷新。
- [x] 颜色 popover 打开时后台刷新。
- [x] 列表滚动到中部时后台刷新。
- [x] 当前聚焦卡片被真实删除。
- [x] 应用与网页快速切换。
- [x] Web Sync 开关关闭后回到分类页。

### 28.5 视觉环境

- [x] 亮色主题。
- [x] 暗色主题。
- [x] 1366×768。
- [x] 当前小屏单列断点。
- [x] 1920×1080。
- [x] 125% Windows 缩放。
- [x] 中文界面。
- [x] 英文界面，如当前构建支持。

## 29. 回滚、完成定义与归档

### 29.1 回滚原则

回滚目标是恢复上一份完整可用目录行为，而不是保留一半新状态机。

- [x] 快照 service、hook 接入和组件计数结构按可独立审查阶段提交。
- [x] 任一阶段失败时，回滚该阶段而不是增加临时双路径。
- [x] 不同时长期保留旧 `completeCatalogCache` 和新 snapshot service。
- [x] 不保留“最近候选 fallback”作为隐藏兼容路径。
- [x] 不通过关闭测试或恢复旧错误断言完成回滚。

### 29.2 完成定义

只有同时满足以下条件，任务才可以宣布完成：

- [x] 顶部筛选项不再从无括号跳到有括号。
- [x] 冷启动未知态不显示虚假 `0`。
- [x] 应用列表不再先发布最近候选再替换完整目录。
- [x] warm refresh 不清空或换回 bootstrap 候选。
- [x] 数组引用变化不触发目录重载。
- [x] 旧 generation 和混合 revision 无法提交。
- [x] 应用与网页模式都保持稳定面板骨架。
- [x] 错误和重试语义完整。
- [x] 专项、浏览器、性能和默认质量门槛全部通过。
- [x] 没有扩大到完整网页目录、分类语义或新全局缓存框架。
- [x] 对抗式审查没有未解决的 P0/P1 问题。

### 29.3 归档步骤

- [x] 在本文档中勾选所有实际完成步骤，并在第 0 节集中记录最终执行证据。
- [x] 在关键阶段下记录实际文件、测试命令和结果。
- [x] 长期规则没有变化，不为本修复改写母文档。
- [x] 将本文档移动到 `docs/archive/`。
- [x] 确认 `docs/working/` 不再保留已完成副本。
- [x] 未确认到对应 live Project item，不伪造 `Done` 或 `Next` 状态。

## 30. 对抗式审查清单

任务完成后，由实现者之外的审查视角逐项攻击以下假设。

### 30.1 事实源攻击

- [x] 是否仍存在第二个可见候选数组。
- [x] 计数是否有任何路径从 bootstrap 候选派生。
- [x] 搜索是否可能查到列表不会展示的候选。
- [x] 网页模式是否被错误描述为完整历史目录。
- [x] 数据库恢复后是否可能继续显示旧数据库快照。

### 30.2 竞态攻击

- [x] warmup 请求先发、页面请求后发。
- [x] 页面请求先发、warmup 请求后发。
- [x] 第一代请求慢于第二代请求完成。
- [x] refresh 期间 invalidate。
- [x] 多页读取中 source revision 改变。
- [x] StrictMode effect setup/cleanup 重复执行。
- [x] 页面卸载后请求完成。
- [x] 用户编辑期间目录提交。

### 30.3 视觉稳定攻击

- [x] `(—)` 到一位数。
- [x] `(—)` 到两位数。
- [x] 两位数到三位数。
- [x] 三位数到四位数。
- [x] 计数改变时搜索框是否横移。
- [x] 新卡片插入排序前方时是否丢失滚动上下文。
- [x] 图标和 favicon 到达时卡片是否改变高度。
- [x] 错误与重试是否造成面板高度变化。

### 30.4 数据完整性攻击

- [x] older-than-30-days 应用仍存在。
- [x] imported exact 和 bucket 记录仍进入应用目录。
- [x] alias 不重复。
- [x] canonical runtime name 仍优先于 alias fallback。
- [x] 被删除全部历史的应用最终从完整目录消失。
- [x] 只有 mapping、没有真实记录的孤儿应用不会复活。

### 30.5 Owner 与范围攻击

- [x] classification 私有缓存是否被错误放入 shared。
- [x] startup service 是否开始理解 cursor、candidate 或 category。
- [x] component/hook 是否直接调用 platform gateway。
- [x] platform 是否开始做 canonical 或分类映射。
- [x] Rust command 是否承接分类业务逻辑。
- [x] 是否顺带新增完整网页目录而没有单独确认。
- [x] 是否为通过验证修改预算、门槛或删除旧测试。

### 30.6 测试有效性攻击

- [x] latest-generation 测试是否真的会在移除 generation guard 后失败。
- [x] 几何测试是否测量真实 DOM，而不是只检查文案。
- [x] 浏览器测试是否使用有界条件等待，而不是固定 sleep 假稳定。
- [x] 测试 fixture 是否清理 delay、storage、cache 和 theme。
- [x] command 次数断言是否能识别重复预热。
- [x] revision mutant 是否能被现有测试杀死。
- [x] 所有新测试是否进入现有执行图。

### 30.7 最终审查结论

- [x] 已在第 0.4 节记录未解决问题及优先级。
- [x] P0/P1 问题为 0；审查中修复的问题已重新运行完整 `npm run check`。
- [x] 审查未推翻本文核心假设。
- [x] 审查于 2026-07-29 在 Windows / PowerShell / Tauri Vite 浏览器 smoke 环境通过。
