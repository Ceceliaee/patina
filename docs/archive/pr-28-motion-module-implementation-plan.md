# PR #28 motion 模块化重构执行方案

状态：已完成，已归档

基准日期：2026-07-04

完成记录：已按本轮实际执行结果完成勾选。可选性能复核未单独触发；最终以浏览器 smoke、Data 专项测试、build、check 和 check:full 作为验收。

关联：Refs #28

## 1. 当前真实分支状态

- [x] 当前集成分支：`codex/integrate-pr-28-motion-module`
- [x] `origin/main`：`0f69a7163220f885ee9e386d1f1e65716197b910`
- [x] `origin/pr/28`：`9047f7026a5216f0c2468da210f6badf5158685d`
- [x] 合并方式：本地集成分支对 `origin/pr/28` fast-forward
- [x] 本地 merge commit：无，当前 `HEAD` 即 `9047f7026a5216f0c2468da210f6badf5158685d`
- [x] 合并冲突：无
- [x] 冲突文件：无
- [x] 初始 diff 范围：43 files changed, 747 insertions, 453 deletions

## 2. 第一性原理

- [x] Patina 的核心任务是让用户快速、可信地理解本机时间记录，不是展示转场。
- [x] Quiet Pro 的长期基线是克制、稳定、专业，动效只能帮助状态理解，不能比内容更显眼。
- [x] Data 页是高频阅读页，有数据时必须立即展示；只有真实数据未准备好时才允许安静占位。
- [x] 关闭增强动效只能关闭运动本身，不能改变布局、蓝条位置、内容层级、边框强度或数据呈现。
- [x] 会影响整页文字清晰度的全页 `transform`、`translate3d`、长驻 `will-change` 不适合做默认页面切换。
- [x] 动效是跨页面体验能力，应有独立 owner；feature 页面只声明语义，不各自维护一套 keyframes。
- [x] 系统 `prefers-reduced-motion` 应优先于应用内增强动效设置。

## 3. 目标与非目标

- [x] 保留 #28 中有价值的贡献：去掉 `framer-motion`、用 CSS 承接轻量动效、保留可选的侧边栏滑动。
- [x] 默认体验回到 Quiet Pro 稳态，增强动效默认关闭。
- [x] 新增独立 motion owner，集中处理增强动效模式、系统 reduced motion、语义 motion class。
- [x] Data 页移除装饰性 fade、pulse、伪 loading；有数据立即显示。
- [x] AppShell 移除基于 tab 距离的整页位移切换。
- [x] 侧边栏蓝条恢复主线原视觉位置，滑动只作为增强动效可选播放。
- [x] Tools 和 Classification 不再用横向位移动画推动整块内容。
- [x] Dialog、Toast、Popover 的 entry 动效统一收敛为短 opacity-only enhanced motion。
- [x] 不引入新的第三方动效库。
- [x] 不做发布、tag、push、关闭 PR 或修改 GitHub 状态。

## 4. 真实 diff 盘点

| 范围 | 文件 | 当前问题 | 目标处理 | 验证 |
| --- | --- | --- | --- | --- |
| 设置 | `src/shared/settings/releaseDefaultProfile.ts` | `dynamicEffects` 默认开启 | 改为默认关闭 | settings test |
| 设置 | `src/shared/copy/domains/settingsCopy.ts` | 文案强调“灵动视效” | 改为“增强动效”，说明只影响额外过渡 | UI smoke, copy parity |
| 设置 | `src/platform/persistence/appSettingsStore.ts` | 字段持久化正确 | 保留字段名和存储映射 | settings test |
| 设置 | `src-tauri/src/data/repositories/app_settings.rs` | 白名单新增正确 | 保留 Rust 白名单 | check:full |
| Shell | `src/app/AppShell.tsx` | 全页切换位移、duration 计算、toggle 全局 off class | 接入 motion hook，移除位移逻辑，设置 `data-qp-motion` | ui smoke, static rg |
| Sidebar | `src/app/components/AppSidebar.tsx` | active 层可滑动但蓝条偏内、偏宽 | 保留滑动层，恢复蓝条贴线内侧视觉 | manual visual, CSS rg |
| CSS token | `src/styles/tokens.css` | `.qp-dynamic-effects-off` 把全局 token 归零 | 移除全局归零，交给 motion 模块 | static rg |
| CSS base | `src/styles/quiet-pro.css` | `qp-content-fade-in`、skeleton pulse、popover animation、dialog animation、nav transition 散落 | 保留基础视觉，移除通用动画定义和默认 transition | static rg |
| CSS shell | `src/styles/app-shell.css` | `.qp-view-container` 全页 transform/will-change | 移除动画定义，保留布局 | static rg |
| CSS motion | `src/styles/motion.css` | 尚无独立 owner | 新增统一 enhanced/reduced motion | build |
| Motion TS | `src/shared/motion/**` | 尚无统一模式判断 | 新增模式 resolver 和 hook | unit/static |
| Data | `src/features/data/components/Data*.tsx` | 可见内容带 fade，heatmap 有 loading pulse prop | 删除装饰性 class 和 loading prop传递 | data/ui smoke |
| Data CSS | `src/styles/quiet-pro.css` | heatmap loading-state pulse | 删除 pulse 规则 | ui smoke, rg |
| Tools | `src/features/tools/components/*.tsx` | mode pane 用 key 重挂载并触发横向动画 | 删除 key 和横向动画，仅保留布局 | ui/browser smoke |
| Tools CSS | `src/styles/features/tools.css` | rail transition 和 pane keyframes feature-local | rail 视觉保留，transition 进 motion.css，删除 pane animation | rg, browser smoke |
| Classification | `src/features/classification/components/AppMapping.tsx` | contentPaneKey 重挂载，横向入场动画 | 删除 key 和局部 motion class | classification smoke |
| Classification CSS | `src/styles/features/classification.css` | 只有 motion keyframes | 删除文件和 import | rg, build |
| Dialog | `src/shared/components/QuietDialog.tsx` | animation 由 base CSS 默认播放 | 加语义 class，motion.css 控制 enhanced | ui smoke |
| Toast | `src/shared/components/QuietToastStack.tsx` | entry class 在 base CSS 默认播放 | 保留语义 class，motion.css 控制 enhanced | ui smoke |
| History popover | `src/features/history/components/*Popover.tsx` | popover animation 在 base CSS | 加语义 class，motion.css 控制 enhanced | browser smoke |
| 依赖 | `package.json`、`package-lock.json`、`scripts/check-bundle-budget.ts` | PR 已移除 `framer-motion` | 保留移除，清理测试 stub | build, rg |
| 测试 | `tests/*.test.ts`、`tests/uiBrowserSmoke/*` | 默认值、Data 断言、stale framer stub 需更新 | 补充断言并通过验证 | npm tests |

## 5. 执行顺序

- [x] Step 1：新增 `src/shared/motion/quietMotion.ts` 和 `useQuietMotionPreference.ts`。
- [x] Step 2：新增 `src/styles/motion.css`，在 `src/App.css` 导入，并把增强动效收敛到 `data-qp-motion="enhanced"`。
- [x] Step 3：Settings 默认关闭增强动效，更新中英文文案和相关测试。
- [x] Step 4：AppShell 接入 motion mode，移除 `VIEW_ORDER`、tab 距离 duration、全页 style、`qp-dynamic-effects-off`。
- [x] Step 5：AppSidebar 恢复蓝条几何位置，transition 只由 motion.css enhanced 模式启用。
- [x] Step 6：Data 删除 `qp-content-fade-in`、heatmap `loading` prop、loading-state pulse。
- [x] Step 7：Tools 删除内容 pane 横向动画和无必要的 key remount，rail transition 迁到 motion.css。
- [x] Step 8：Classification 删除局部 motion class、contentPaneKey、feature CSS import。
- [x] Step 9：Dialog、Toast、History popover 添加语义 motion class，并从 base CSS 删除默认 animation。
- [x] Step 10：删除重复/遗留 CSS：`qp-content-fade-in`、`qp-skeleton-pulse`、`qp-spin` 未使用项、`qp-view-fade-in`、`qp-popover-fade-in`。
- [x] Step 11：清理 stale `framer-motion` test stub，补 Data 和 motion 静态断言。
- [x] Step 12：运行局部测试、结构检查、build、check、check:full。
- [x] Step 13：静态搜索验收，必要时做视觉复核。
- [x] Step 14：勾选本文和预案实际完成项。
- [x] Step 15：归档到 `docs/archive/`，确认 `docs/working/` 不残留已完成执行单。

## 6. 逐文件修改清单

### 6.1 Motion owner

- [x] 文件：`src/shared/motion/quietMotion.ts`
  - 当前问题：无统一 owner 表达 enhanced/baseline/reduced。
  - 目标状态：纯函数定义 `QuietMotionMode`、`resolveQuietMotionMode`、语义 class helper。
  - 具体修改：新增类型和函数，不访问 DOM、数据库、Tauri。
  - 验证方式：build、ui smoke。

- [x] 文件：`src/shared/motion/useQuietMotionPreference.ts`
  - 当前问题：各处直接读取 settings 或 CSS token。
  - 目标状态：统一合并用户设置和 `prefers-reduced-motion`。
  - 具体修改：监听 media query，返回 `baseline`、`enhanced` 或 `reduced`。
  - 验证方式：build、static rg。

- [x] 文件：`src/styles/motion.css`
  - 当前问题：通用动效散在 base CSS 和 feature CSS。
  - 目标状态：只在 enhanced 模式启用 opacity-only entry 和小型 active-layer transition。
  - 具体修改：定义 `qp-motion-view-enter`、`qp-motion-overlay-enter`、`qp-motion-popover-enter`、`qp-toast-entry`、nav/tools active transition。
  - 验证方式：static rg、visual。

### 6.2 Settings

- [x] 文件：`src/shared/settings/releaseDefaultProfile.ts`
  - 修改：`dynamicEffects: false`。
  - 保留：字段名和 profile 结构。
  - 验证：`npm run test:settings`。

- [x] 文件：`src/shared/copy/domains/settingsCopy.ts`
  - 修改：中文 `增强动效`，英文 `Enhanced motion`。
  - 保留：copy key 不变，避免迁移风险。
  - 验证：copy parity smoke。

- [x] 文件：`tests/settingsPageState.test.ts`
  - 修改：默认值和 invalid fallback 从 true 改 false，测试名从 fallback on 改 fallback off。
  - 验证：`npm run test:settings`。

### 6.3 AppShell

- [x] 文件：`src/app/AppShell.tsx`
  - 当前问题：`VIEW_ORDER`、`prevViewIndexRef`、`viewTransitionStyle`、`changeRenderedView` 为整页位移服务。
  - 目标状态：只负责真实导航和懒加载 chunk；motion mode 作为根状态表达。
  - 具体修改：
    - 删除 `VIEW_ORDER`。
    - 删除基于 tab 距离的 offset/duration 逻辑。
    - 新增 `useQuietMotionPreference(appSettings.dynamicEffects)`。
    - 在根节点设置 `data-qp-motion`。
    - 同步 `document.documentElement.dataset.qpMotion` 给 portal overlay 使用。
    - `.qp-view-container` 不再带 inline style。
  - 验证：ui smoke、static rg。

### 6.4 Sidebar

- [x] 文件：`src/styles/quiet-pro.css`
  - 当前问题：蓝条 `left: calc(0.5rem + 3px)`、`width: 3px`，视觉比主线更抢。
  - 目标状态：蓝条等价于原 active button 内 `left: -1px; top: 9px; width: 2px; height: 22px`。
  - 具体修改：
    - active bg 保留 Quiet Pro background/border。
    - indicator 改为 `left: calc(0.5rem - 1px)`、`width: 2px`。
    - base CSS 不写 transition。
    - transform 改成 `translateY(...)`。
  - 验证：manual visual、static rg。

### 6.5 Data

- [x] 文件：`src/features/data/components/DataTrendPanel.tsx`
  - 修改：移除 `qp-content-fade-in`。
  - 验证：ui smoke。

- [x] 文件：`src/features/data/components/DataAppTrendPanel.tsx`
  - 修改：移除 grid 和 chart 上的 `qp-content-fade-in`。
  - 验证：data tests、ui smoke。

- [x] 文件：`src/features/data/components/DataHeatmapPanel.tsx`
  - 修改：删除 `loading` prop，删除 `qp-content-fade-in` 和 `data-heatmap-loading-state`。
  - 保留：placeholder rows、bootstrap rows、fresh rows 的立即显示路径。
  - 验证：data tests、ui smoke。

- [x] 文件：`src/features/data/components/Data.tsx`
  - 修改：不再向 heatmap panel 传 `loading`。
  - 保留：内部 `heatmapLoading` 仍用于判断 fresh/cache 行为和保存 bootstrap。
  - 验证：data tests。

### 6.6 Tools 与 Classification

- [x] 文件：`src/features/tools/components/TimerToolPanel.tsx`
  - 修改：移除 `key={effectiveMode}`。
  - 验证：ui smoke、browser smoke。

- [x] 文件：`src/features/tools/components/ReminderToolPanel.tsx`
  - 修改：移除 `key={reminderMode}`。
  - 验证：ui smoke、browser smoke。

- [x] 文件：`src/styles/features/tools.css`
  - 修改：删除 `tools-horizontal-pane-enter` keyframes 和 pane animation；active bg transition 迁到 motion.css。
  - 保留：面板布局、hidden 行为、active rail 视觉。
  - 验证：browser smoke。

- [x] 文件：`src/features/classification/components/AppMapping.tsx`
  - 修改：删除 `contentPaneKey` 和 `qp-classification-object-pane` class。
  - 保留：filter、search、object mode 结果立即渲染。
  - 验证：classification tests、ui smoke。

- [x] 文件：`src/styles/features/classification.css`
  - 修改：删除该仅含动效的 feature CSS。
  - 验证：build、static rg。

### 6.7 Overlay

- [x] 文件：`src/shared/components/QuietDialog.tsx`
  - 修改：为 backdrop 和 surface 增加 `qp-motion-overlay-enter`。
  - 验证：ui smoke。

- [x] 文件：`src/shared/components/QuietToastStack.tsx`
  - 修改：保留 `qp-toast-entry` 作为语义 class，由 motion.css 决定是否动画。
  - 验证：ui smoke。

- [x] 文件：`src/features/history/components/HistoryCalendarPopover.tsx`
  - 修改：增加 `qp-motion-popover-enter`。
  - 验证：browser smoke。

- [x] 文件：`src/features/history/components/HistoryTimelineDetailsPopover.tsx`
  - 修改：增加 `qp-motion-popover-enter`。
  - 验证：browser smoke。

## 7. 暂停条件

- [x] 如果发现 PR #28 还有新的固定等待、定时 loading、render stage，应暂停并重新盘点。
- [x] 如果 motion 模块需要承接业务状态或 Tauri IPC，应暂停重新定 owner。
- [x] 如果必须引入第三方动画库才能继续，应暂停确认。
- [x] 如果 `check:full` 暴露 Rust settings 迁移问题，应先修数据安全问题。

## 8. 验收清单

- [x] `rg "framer-motion" src tests package.json scripts` 无有效引用。
- [x] `rg "qp-content-fade-in|qp-skeleton-pulse|qp-dynamic-effects-off" src tests` 无有效引用。
- [x] `rg "translate3d" src/styles src/app src/features` 只允许非文本/既有必要小范围场景，不能有全页 view/container 或 feature pane 入场。
- [x] `.qp-view-container` 无 animation、transform、will-change。
- [x] Data 文件无 `renderStage`、无 `Loader2`、无 `qp-spin`。
- [x] `dynamicEffects` 默认值为 `false`。
- [x] `data-qp-motion` 有且只有 AppShell/motion owner 负责。
- [x] 默认状态增强动效关闭。
- [x] 开启动效后侧边栏可滑动，但蓝条位置不变。
- [x] 关闭动效后布局、蓝条、内容不变化。
- [x] Reduced motion 下 enhanced 动效不播放。

## 9. 验证命令

- [x] `npm run test:settings`
- [x] `npm run test:data`
- [x] `npm run test:data-chart`
- [x] `npm run test:interaction`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run check:naming`
- [x] `npm run check:architecture`
- [x] `npm run build`
- [x] `npm run check:bundle`
- [x] `npm run check`
- [x] `npm run check:full`

## 10. 归档

- [x] 本文全部按实际结果勾选。
- [x] 合并前预案同步勾选实际完成项。
- [x] 两份一次性执行单移动到 `docs/archive/`。
- [x] `docs/working/` 不残留已完成执行单。
