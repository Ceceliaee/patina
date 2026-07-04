# PR #28 动效模块化吸收执行方案

状态：已完成，已归档

基准日期：2026-07-04

完成记录：已按本轮实际执行结果完成勾选。可选性能复核未单独触发；最终以浏览器 smoke、Data 专项测试、build、check 和 check:full 作为验收。

关联：Refs #28

## 1. 文档目的

本文是一份合并前预案，用于指导如何在本地集成 PR #28，并约束后续如何把其中可取的动效能力收敛为一个可维护、可关闭、不会破坏 Quiet Pro 基线的独立 motion 模块。

它不替代合并后的真实执行方案。PR #28 合并到本地集成分支后，必须先基于实际落下来的代码、文件范围、冲突解决结果和新增行为，重新从第一性原理写一份详细的可勾选执行方案，再开始重构实现。

本文不作为长期设计规范。执行完成后，如果形成新的长期规则，应回写到 `docs/quiet-pro-component-guidelines.md` 或相关长期文档；本文随后移入 `docs/archive/`。

## 2. 第一性原理

### 2.1 用户真正要完成的任务

Patina 是个人、本地优先、Windows 桌面时间追踪工具。用户打开应用的主要目的不是观看转场，而是快速理解：

- 今天用了多少时间
- 时间分布是否可信
- 历史记录是否清楚
- Data 页趋势、热力图、应用排行是否立刻可读
- 设置和分类管理是否稳定可控

因此动效只能服务于状态反馈和空间连续性，不能成为用户注意力的主要对象。

### 2.2 Quiet Pro 对动效的基本约束

Quiet Pro 的动效应当短、轻、有反馈意义，并且去掉动效后界面仍然成立。

本次吸收 PR #28 时，必须遵守以下不变量：

- 动效不能改变页面的视觉结构。
- 动效关闭后，布局、控件位置、蓝条位置、边框、颜色和信息层级不应变化。
- 动效不能制造数据等待。
- Data 页有数据就立即显示；只有真实数据未准备好时才允许真实 loading。
- 不对整页文字容器使用容易导致 WebView 字体发虚的全页 `transform` / `translate3d` / 长驻 `will-change`。
- 不把页面私有动效散落到各 feature 文件中。
- 不为了视觉“灵动”牺牲核心页面的可读性、性能和长期维护性。

### 2.3 模块化的原因

动效属于跨页面的体验能力。如果每个页面各自写 `duration`、`ease`、`keyframes`、`will-change`、开关判断，后续会出现三个问题：

- 同一类动效在不同页面表现不一致。
- 关闭动效时很难确认是否真的关闭干净。
- 后续维护者需要在多个 feature 中理解同一套动效语义。

因此本次不应继续把动效散在 `AppShell`、`Data`、`Tools`、`Classification`、`Dialog`、`Toast` 等位置，而应收敛为一个独立 motion 模块。

## 3. 目标结果

- [x] #28 在本地集成分支中完成吸收和重构，不直接让远端 `main` 短暂进入不理想状态。
- [x] 合并 #28 后，先写出一份基于真实分支状态的详细可勾选执行方案。
- [x] 动效实现集中到一个独立 motion 模块中。
- [x] 页面组件只声明语义动效，不直接定义复杂 keyframes、duration、ease 或全局开关逻辑。
- [x] 默认体验保持 Quiet Pro 稳态，不默认启用高级/增强动效。
- [x] 设置页只控制增强动效，不影响基础 hover、focus、active 等必要交互反馈。
- [x] 关闭增强动效时，视觉结构与开启时一致，只是动画不播放。
- [x] Data 页移除装饰性 fade、pulse、伪 loading。
- [x] 侧边栏保留可选滑动，但蓝条位置、宽度、长度和视觉强度回到当前主线基线。
- [x] 主视图切换不使用全页 `translate3d` 或长驻 `will-change`。
- [x] 通过与风险匹配的自动化验证和人工视觉核对。
- [x] 执行完成后更新本执行单勾选状态，并归档到 `docs/archive/`。

## 4. 非目标

- [x] 不重新设计 Quiet Pro。
- [x] 不新增大型视觉风格方向。
- [x] 不把 Data 页性能优化混入本执行单；Data 性能优化已经由独立工作处理，本执行单只处理 #28 带来的动效吸收。
- [x] 不为动效引入新的第三方动画库。
- [x] 不做发布版本号、changelog、tag 或 GitHub Release 操作。
- [x] 不关闭、合并、标记或修改 GitHub issue / PR 状态，除非后续明确要求。

## 5. 推荐分支与集成策略

### 5.0 方案准备

- [x] 写成本合并前预案，并放入 `docs/working/`。
- [x] 明确本文是临时预案，不是长期设计规范。
- [x] 明确本文不替代合并后的真实执行方案。
- [x] 明确执行完成后需要更新勾选状态并归档。
- [x] 执行前复读本文的目标、非目标和验收标准，确认后续操作仍按本文推进。

### 5.1 分支策略

- [x] 确认当前工作区干净。
- [x] 同步最新 `origin/main`。
- [x] 同步最新 `origin/pr/28`。
- [x] 从 `main` 创建本地集成分支，建议名称：

```text
codex/integrate-pr-28-motion-module
```

- [x] 在该分支上合并 `origin/pr/28`。
- [x] 所有重构都在该分支继续追加提交。
- [x] 不在远端 `main` 上直接合入当前 #28。

### 5.2 合并后的第一件事

- [x] 不立刻修 UI。
- [x] 先记录合并后的实际变更范围：

```text
git diff --stat origin/main...HEAD
git diff --name-only origin/main...HEAD
```

- [x] 确认 PR #28 当前至少包含这些变更类型：
  - settings 持久化中的 `dynamic_effects`
  - AppShell 主视图切换动效
  - AppSidebar 侧边栏滑动动效
  - Data 页 fade / heatmap loading state
  - Tools / Classification 子页面动效
  - Dialog / Toast / History popover 动效
  - `framer-motion` 依赖移除
  - 相关测试更新

### 5.3 合并后重新写详细执行方案

合并 #28 后必须先写新的详细执行方案，再进入任何重构实现。原因是 PR 分支可能已经新增、删除、移动或重写代码；合并冲突解决也可能改变真实风险面。不能用合并前预案替代合并后的实际执行单。

- [x] 创建新的合并后执行方案文档，建议路径：

```text
docs/working/pr-28-motion-module-implementation-plan.md
```

- [x] 在新方案开头写明它基于哪个真实分支和提交：
  - 当前集成分支名
  - `origin/main` commit
  - `origin/pr/28` commit
  - 本地 merge commit
  - 是否发生冲突
  - 冲突文件列表

- [x] 从第一性原理重新写判断前提，而不是直接复制本文：
  - Patina 的核心任务是什么
  - Quiet Pro 为什么要求动效短、轻、不抢内容
  - Data 页为什么不能为了动画等待数据
  - 关闭动效为什么只能关闭运动，不能改变视觉结构
  - 为什么 motion 需要独立 owner，而不是散进页面

- [x] 列出真实 diff 盘点表，至少包含：
  - 文件路径
  - 变更类型
  - 所属 owner
  - 是否保留
  - 是否重构
  - 是否删除
  - 主要风险
  - 验证方式

- [x] 对真实代码逐项分类：
  - Motion 设置与持久化
  - AppShell 主视图切换
  - AppSidebar active 状态
  - Data 页相关改动
  - Tools 子页面和 rail 动效
  - Classification 筛选 / 对象模式动效
  - Dialog / Toast / History popover
  - CSS token / keyframes / feature CSS
  - 依赖与 bundle budget
  - 自动化测试改动
  - Rust settings 白名单改动

- [x] 写出逐文件执行步骤，不只写概括方向。

每个涉及修改的文件都应至少写清：

```text
- [x] 文件：src/...
  - 当前问题：
  - 目标状态：
  - 具体修改：
  - 保留内容：
  - 删除内容：
  - 验证方式：
```

- [x] 写出执行顺序，避免先改页面再发现 motion owner 不成立。
- [x] 写出暂停条件：
  - 合并后 diff 超过本文预期范围
  - 出现新的数据等待或 loading 逻辑
  - 需要改变长期文档规则才能继续
  - 需要引入第三方动效依赖
  - 需要让 `app/*` 或 `shared/*` 承接厚业务逻辑
- [x] 写出验收门槛：
  - 静态搜索项
  - 局部测试项
  - `npm run check`
  - `npm run check:full`
  - 人工视觉验收项
- [x] 新方案写完后，先更新本文勾选状态，再按新方案执行。

## 6. Motion 模块设计

### 6.1 模块 owner

- [x] 新增稳定共享 UI 能力 owner：

```text
src/shared/motion/
```

- [x] 新增 CSS-only motion 样式文件：

```text
src/styles/motion.css
```

- [x] 在 `src/App.css` 中导入 `motion.css`。
- [x] `motion.css` 只承接跨页面可复用的 motion token、语义 class 和 keyframes。
- [x] feature 私有样式文件不得新增一套局部 keyframes 来表达同类动效。

### 6.2 建议文件结构

- [x] 创建 `src/shared/motion/quietMotion.ts`。

职责：

- 定义增强动效是否启用的统一判断。
- 定义 motion 模式类型。
- 定义语义 class 辅助函数。
- 不读取数据库。
- 不访问 Tauri。
- 不依赖具体 feature。

建议语义：

```ts
export type QuietMotionMode = "baseline" | "enhanced" | "reduced";

export function resolveQuietMotionMode(options: {
  enhancedMotionEnabled: boolean;
  prefersReducedMotion: boolean;
}): QuietMotionMode;

export function quietMotionClass(name: string, enabled: boolean): string;
```

- [x] 创建 `src/shared/motion/useQuietMotionPreference.ts`。

职责：

- 监听 `prefers-reduced-motion: reduce`。
- 把用户设置和系统 reduced motion 合并为统一模式。
- 只返回模式，不写业务状态。

建议语义：

```ts
export function useQuietMotionPreference(enhancedMotionEnabled: boolean): QuietMotionMode;
```

### 6.3 根节点状态表达

- [x] 在 AppShell 根节点或 `document.documentElement` 上设置统一属性，而不是多个页面各自 toggle class。

建议属性：

```text
data-qp-motion="baseline"
data-qp-motion="enhanced"
data-qp-motion="reduced"
```

- [x] `baseline` 表示 Quiet Pro 必要交互反馈存在，但不播放增强动效。
- [x] `enhanced` 表示允许轻量增强动效。
- [x] `reduced` 表示系统或用户要求减少动效，增强动效必须关闭。

### 6.4 CSS 组织规则

- [x] 在 `src/styles/tokens.css` 保留通用 motion token，但不要通过全局把所有 motion token 改成 `0ms` 来关闭动效。
- [x] 在 `src/styles/motion.css` 中定义增强动效专用变量，例如：

```css
:root {
  --qp-motion-enhanced-view: 120ms;
  --qp-motion-enhanced-nav: 160ms;
  --qp-motion-enhanced-overlay: 120ms;
}
```

- [x] 用根属性控制增强动效：

```css
:root[data-qp-motion="baseline"] .qp-motion-enhanced,
:root[data-qp-motion="reduced"] .qp-motion-enhanced {
  animation: none;
  transition-duration: 0ms;
}
```

- [x] 不让关闭增强动效影响普通 hover、focus、active 的必要状态反馈。
- [x] 删除重复定义的 `.qp-content-fade-in`。
- [x] 删除未使用或不应保留的 `qp-skeleton-pulse`。

## 7. Settings 调整

### 7.1 默认值

- [x] 将增强动效默认值设为关闭。
- [x] 如果沿用 #28 的字段名 `dynamicEffects`，其默认值应改为 `false`。
- [x] 如果重命名字段，必须同步更新：
  - `src/shared/settings/appSettings.ts`
  - `src/shared/settings/releaseDefaultProfile.ts`
  - `src/platform/persistence/appSettingsStore.ts`
  - `src-tauri/src/data/repositories/app_settings.rs`
  - settings 相关测试

### 7.2 用户文案

- [x] 设置项建议命名为“增强动效”，避免让用户误解它是核心能力。
- [x] 文案应表达它只影响额外动效，不影响正常交互反馈。

建议中文：

```text
增强动效
为导航、弹窗和轻量切换启用额外过渡。关闭后界面结构和内容显示不变。
```

建议英文：

```text
Enhanced motion
Adds optional transitions for navigation, overlays, and light view changes. Turning it off keeps layout and content unchanged.
```

### 7.3 保存行为

- [x] 设置页继续通过现有 settings 保存流程持久化。
- [x] 不新增单独的 localStorage 临时开关。
- [x] 保存失败时遵守 Settings 当前错误处理路径。
- [x] 设置变更后 AppShell 应即时应用 motion 模式，不要求重启。

## 8. AppShell 主视图切换重构

### 8.1 移除当前风险点

- [x] 移除全页 `translate3d`。
- [x] 移除 `.qp-view-container` 上的长驻 `will-change: transform, opacity`。
- [x] 移除基于跨越 tab 数量计算位移距离和 duration 的逻辑。
- [x] 不为了表现“动量”改变页面切换节奏。

### 8.2 保留允许的行为

- [x] 保留当前 lazy view preload 逻辑。
- [x] 保留 `renderedView` 防止未加载 chunk 时直接切换到空白页的行为。
- [x] 如果保留视图进入动效，只允许 opacity-only。
- [x] opacity-only 动效只在 `data-qp-motion="enhanced"` 时生效。
- [x] duration 控制在 Quiet Pro 范围内，建议不超过 `120ms`。

### 8.3 结构要求

- [x] 不新增会影响 flex 高度、滚动、overflow 的临时 wrapper。
- [x] 如果必须保留 wrapper，它必须：
  - 始终存在，不随开关变化增删
  - `min-height`、`overflow`、`flex` 行为与当前主线一致
  - 关闭增强动效时不改变布局

## 9. 侧边栏动效重构

### 9.1 视觉基线

- [x] 蓝条回到当前主线位置和强度。
- [x] 蓝条视觉规格应等价于当前主线：

```text
left: -1px relative to active button
top: 9px
width: 2px
height: 22px
border-radius: full
color: var(--qp-accent-default)
```

- [x] active 背景仍应是 Quiet Pro 当前强度：

```text
background: var(--qp-accent-muted)
border-color: color-mix(in srgb, var(--qp-accent-default) 25%, var(--qp-border-subtle))
```

### 9.2 滑动实现

- [x] 可以保留移动的 active 背景层和 indicator 层，但必须精确对齐当前主线按钮内的 active 视觉。
- [x] indicator 宽度不得从 `2px` 放大到更抢眼的宽度。
- [x] indicator 不得向按钮内部偏移成“悬浮条”。
- [x] 滑动只在 `data-qp-motion="enhanced"` 时播放。
- [x] `baseline` / `reduced` 模式下 active 层可以瞬间定位，但最终视觉必须相同。

### 9.3 交互行为

- [x] 保留 hover preload。
- [x] 保留 keyboard focus 行为。
- [x] 不使用 `flushSync` 只为制造动画。
- [x] 不延迟真实导航。
- [x] optimistic active view 失败时仍能回退到真实 current view。

## 10. Data 页清理

### 10.1 移除装饰性动效

- [x] 从 `DataTrendPanel` 移除 `qp-content-fade-in`。
- [x] 从 `DataAppTrendPanel` 移除 `qp-content-fade-in`。
- [x] 从 `DataHeatmapPanel` 移除 `qp-content-fade-in`。
- [x] 移除 heatmap loading pulse。
- [x] 移除 `data-heatmap-loading-state` 中的动画表达。
- [x] 删除不再需要的 `loading` prop，除非它服务真实无数据 loading。

### 10.2 保持数据原则

- [x] 有 bootstrap/cache 内容时立即显示。
- [x] 有 fresh 内容时立即替换。
- [x] 没有内容时只使用当前主线已有的安静占位方式。
- [x] 不新增固定等待时间。
- [x] 不新增为了动画存在的 `renderStage`。
- [x] 不新增 spinner 覆盖 Data 正常内容。

### 10.3 验证防线

- [x] 扩展或保留 UI smoke 断言，确保 Data regular view 不出现：
  - `renderStage`
  - 固定 loading timeout
  - `Loader2`
  - `qp-spin`
  - `qp-skeleton-pulse`
  - 装饰性 `qp-content-fade-in`

## 11. Tools 与 Classification 动效收敛

### 11.1 Tools

- [x] Tools 侧边小 rail 的 active 背景可进入 motion 模块，但视觉强度必须维持 Quiet Pro。
- [x] Tools 子页面切换不使用横向 `translate3d` 推动整块文字内容。
- [x] 如果保留子页面增强动效，只允许 opacity-only，且只在 enhanced 模式启用。
- [x] 关闭增强动效时，Tools 子页面结构、滚动和 active 状态不变。

### 11.2 Classification

- [x] 移除 feature-local `qp-classification-object-pane-enter` keyframes。
- [x] 如果保留筛选切换动效，改用 motion 模块中的语义 class。
- [x] 不使用横向 `translate3d` 推动候选卡片列表。
- [x] 搜索、筛选、对象模式切换不得因为动效延迟结果展示。

## 12. Dialog、Toast、History Popover 收敛

### 12.1 Dialog

- [x] 可以从 `framer-motion` 替换为 CSS entry 动效。
- [x] Dialog entry 动效应为短 opacity-only 或非常轻的 overlay 动效。
- [x] 不为了 exit 动效引入延迟关闭。
- [x] Escape、backdrop click、focus 行为不得改变。

### 12.2 Toast

- [x] Toast entry 可以保留轻量 opacity。
- [x] Toast 不要求为了 exit 动效延迟移除。
- [x] Toast 队列、tone、位置和宽度不得改变。

### 12.3 History Popover

- [x] Popover 可保留轻量 entry。
- [x] 不使用可能导致文字发虚的持续 transform。
- [x] Calendar popover、timeline details popover 的定位逻辑不得改变。
- [x] 不因动画影响 hover、scroll、wheel 或选择日期。

## 13. 依赖与 bundle

- [x] 确认是否彻底移除 `framer-motion`。
- [x] 如果移除，清理：
  - `package.json`
  - `package-lock.json`
  - `scripts/check-bundle-budget.ts` 中 motion chunk 预算
  - tests 中不再需要的 framer-motion stub
- [x] 如果仍有文件引用 `framer-motion`，不得移除依赖。
- [x] 执行前后对比 bundle 输出，确认没有新增明显体积风险。

## 14. 自动化验证计划

### 14.1 局部验证

- [x] `npm run test:settings`
- [x] `npm run test:data`
- [x] `npm run test:data-chart`
- [x] `npm run test:interaction`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`

### 14.2 结构和质量验证

- [x] `npm run check:naming`
- [x] `npm run check:architecture`
- [x] `npm run build`
- [x] `npm run check:bundle`

### 14.3 完整验证

因为本执行单触及 settings 持久化白名单和 Rust app settings repository，最终必须运行：

- [x] `npm run check`
- [x] `npm run check:full`

### 14.4 可选性能复核

如果 Data 或页面切换体感仍有争议，追加：

- [x] `npm run perf:data-history-browser`

执行时记录：

- [x] 基准分支
- [x] 集成分支
- [x] p50
- [x] p95
- [x] max
- [x] 是否能说明真实体感差异

## 15. 人工视觉验收

### 15.1 默认状态

- [x] 新安装或默认设置下，增强动效关闭。
- [x] 默认状态看起来接近当前主线 Quiet Pro。
- [x] Dashboard / History / Data / Tools / Settings 切换不出现文字发虚。
- [x] Data 页不出现为了动效产生的 loading、pulse、闪烁。
- [x] 热力图切换没有明显变慢或“等动画”的感觉。

### 15.2 开启动效后

- [x] 侧边栏 active 状态滑动，但蓝条仍贴在当前主线位置。
- [x] 主视图最多轻 opacity 进入，不做全页位移。
- [x] Dialog / Toast / Popover 动效短且不抢注意力。
- [x] Tools / Classification 切换不让内容像整块横向滑动。
- [x] 长文本和数字没有发虚。

### 15.3 关闭后

- [x] 关闭增强动效后，布局不变化。
- [x] 关闭增强动效后，蓝条位置不变化。
- [x] 关闭增强动效后，页面内容不变化。
- [x] 关闭增强动效后，只是不播放增强动画。

### 15.4 Reduced Motion

- [x] 系统 `prefers-reduced-motion: reduce` 时，即使设置中开启增强动效，也应进入 reduced 模式。
- [x] reduced 模式不影响可见状态表达。

## 16. 静态检查清单

执行完成后用搜索确认：

- [x] `src/features/data/**` 中没有 `qp-content-fade-in`。
- [x] `src/features/data/**` 中没有 `qp-skeleton-pulse`。
- [x] `src/features/data/**` 中没有 `renderStage`。
- [x] `src/app/AppShell.tsx` 中没有基于 tab 距离计算页面位移动效。
- [x] `.qp-view-container` 不使用 `translate3d`。
- [x] `.qp-view-container` 不使用长驻 `will-change`。
- [x] feature CSS 中没有新增与 motion 模块重复的通用 keyframes。
- [x] `qp-content-fade-in` 没有在多个 CSS 文件重复定义。
- [x] `data-qp-motion` 或等价 motion root state 只有一个 owner。

## 17. 验收标准

本执行单只有在全部满足以下条件时才算完成：

- [x] 功能上，应用可正常导航、设置、查看 Data、使用 Tools、打开 Dialog / Toast。
- [x] 视觉上，默认状态保持 Quiet Pro 稳态。
- [x] 交互上，增强动效可开可关，关闭不改变视觉结构。
- [x] 性能上，没有引入 Data 页或热力图切换体感回退。
- [x] 架构上，动效能力集中在 motion 模块，不散落为 feature-local 体系。
- [x] 验证上，`npm run check` 和 `npm run check:full` 通过，或记录清楚无法运行的原因和剩余风险。
- [x] 文档上，本执行单已勾选实际完成项。

## 18. 归档步骤

执行完成后：

- [x] 回看本文所有 checkbox，按实际完成情况更新。
- [x] 如果形成长期 motion 规则，回写 `docs/quiet-pro-component-guidelines.md` 的动效章节。
- [x] 如果形成新的代码 owner 约定，回写 `docs/architecture.md` 的前端 shared / styles 说明。
- [x] 将本文从 `docs/working/` 移到 `docs/archive/`。
- [x] 确认 `docs/working/` 不残留已完成的一次性执行单。

## 19. 建议执行顺序总览

- [x] Step 0：写成并复核本合并前预案。
- [x] Step 1：执行前复读本文目标、非目标和验收标准。
- [x] Step 2：确认干净工作区并创建本地集成分支。
- [x] Step 3：合并最新 #28。
- [x] Step 4：记录合并后 diff 范围。
- [x] Step 5：基于合并后的真实代码，写新的详细可勾选执行方案。
- [x] Step 6：复核新方案是否覆盖真实 diff、逐文件步骤、暂停条件和验收门槛。
- [x] Step 7：按新方案新增 motion 模块和 `motion.css`。
- [x] Step 8：按新方案把 settings 中增强动效默认值改为关闭，并接入统一 motion 模式。
- [x] Step 9：按新方案重构 AppShell，移除全页位移动效和长驻 `will-change`。
- [x] Step 10：按新方案重构 AppSidebar，恢复蓝条原位视觉，只保留可选滑动。
- [x] Step 11：按新方案清理 Data 页装饰性 fade / pulse / loading。
- [x] Step 12：按新方案收敛 Tools、Classification、Dialog、Toast、History popover 动效到 motion 模块。
- [x] Step 13：按新方案清理依赖、重复 CSS 和过时测试 stub。
- [x] Step 14：按新方案补充或调整测试断言。
- [x] Step 15：运行局部验证。
- [x] Step 16：运行 `npm run check`。
- [x] Step 17：运行 `npm run check:full`。
- [x] Step 18：进行人工视觉验收。
- [x] Step 19：更新本文和新方案的勾选状态。
- [x] Step 20：确认后再决定如何进入 `main`。
- [x] Step 21：完成后归档本文和新方案。
