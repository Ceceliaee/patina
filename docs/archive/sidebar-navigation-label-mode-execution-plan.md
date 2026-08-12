# 侧边导航图标与下方文字模式执行方案

## 1. 文档定位

本文是一次性、可勾选的实施执行单，用于把 Patina 主窗口侧边导航改造成可在以下两种呈现之间切换的稳定导航：

- `icons`：保持现有仅图标模式；
- `labeled`：在不改变导航区域现有尺寸的前提下，缩小图标并在下方显示当前界面语言对应的页面名称。

本文面向 Patina 维护者与后续执行实现的 Codex。它不是新的长期 UI 母规范，也不替代以下长期文档：

- [`../product-principles-and-scope.md`](../product-principles-and-scope.md)
- [`../roadmap-and-prioritization.md`](../roadmap-and-prioritization.md)
- [`../engineering-quality.md`](../engineering-quality.md)
- [`../quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)
- [`../architecture.md`](../architecture.md)
- [`../issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md)
- [`../localization.md`](../localization.md)

本文完成使命后应移入 `docs/archive/`，不能长期留在 `docs/working/`，也不能上移到顶层 `docs/` 充当长期规范。

### 1.1 当前状态

- [x] 产品问题已经确认：仅图标导航对不熟悉图标语义的用户识别成本较高。
- [x] 交互方向已经确认：不横向展开侧栏，而是在原按钮内显示“缩小图标＋下方文字”。
- [x] 几何边界已经确认：侧栏、导航组、七个导航按钮和主内容区均不得因模式切换改变尺寸或位置。
- [x] 入口位置已经确认：使用侧栏最底部的无文字 `Menu` 按钮切换模式。
- [x] 设置边界已经确认：不在 Settings 中增加设置项。
- [x] 实现已经完成。
- [x] 本任务相关自动化验证已经完成。
- [x] 真实浏览器与桌面视觉验收已经完成。

## 2. 第一性原理

### 2.1 用户真正需要的是目的地可识别，不是“更多模式”

侧边导航的首要任务是让用户快速知道“点击这里会去哪里”。仅图标模式节省视觉空间，但把识别成本转移给了用户；文字模式应直接补足页面名称，而不是增加说明弹窗、教学层或新的设置表面。

因此本方案把文字放在导航入口自身，而不是放进 Settings、帮助页或一次性引导中。

### 2.2 低打扰的核心是稳定几何，而不是更慢的动画

用户切换导航呈现时，主内容不应横向位移，图表不应重新测量，页面不应出现压缩或展开动画。真正需要变化的只有导航按钮内部的信息密度：

- 图标从 `18px` 缩小到 `15px`；
- 图标下方出现一行 `10px` 页面名称；
- 按钮外框、间距、选中背景和左侧指示条保持原状。

本方案不通过动画掩盖布局变化，而是从源头禁止布局变化。

### 2.3 就地控制优于全局设置

“是否显示导航名称”影响主侧栏与 Tools 页内同类纵向入口，用户在看到这些导航时就能直接理解结果。把开关放进 Settings 会产生两个问题：

1. 控制入口与结果分离；
2. 为一个低风险的局部呈现选择扩大 AppSettings、Rust 持久化、备份和设置页面的长期维护面。

因此开关固定放在主侧栏底部，点击后同步控制主侧栏和 Tools 页三个入口；选择只作为本机 WebView 的 UI 局部偏好静默保存。

### 2.4 页面名称必须只有一个文案来源

七个导航名称继续复用现有页面标题：

- `UI_TEXT.dashboard.title`
- `UI_TEXT.history.title`
- `UI_TEXT.data.title`
- `UI_TEXT.mapping.title`
- `UI_TEXT.tools.title`
- `UI_TEXT.settings.title`
- `UI_TEXT.about.title`

不得为同一页面复制一套“侧栏短名称”，也不得在组件里写中英文分支。语言切换后，页面标题、按钮无障碍名称和可见导航名称必须同步更新。

### 2.5 这是一个两状态有限状态机

状态集合只有：

```text
icons <── Menu toggle ──> labeled
```

状态转换不应触发：

- 页面导航；
- 当前 view 变化；
- active nav 变化；
- Settings dirty；
- Toast；
- IPC；
- SQLite 写入；
- Rust runtime 同步。

存储失败只意味着下次启动可能回到默认模式，不能阻止本次切换。

## 3. 已确认的产品与视觉决策

### 3.1 模式定义

| 模式 | 图标 | 文字 | Menu 悬浮提示 | 默认行为 |
|---|---:|---|---|---|
| `icons` | `18px` | 不显示 | 无；避免底部悬浮层 | 无有效保存值时使用，保持现有体验 |
| `labeled` | `15px` | 图标下方显示一行完整页面名称 | 无；状态由可见文字与 pressed 语义表达 | 用户明确选择后记忆 |

### 3.2 固定几何合同

下面这些值是当前实现事实，也是本任务的硬验收条件：

- 侧栏继续使用 `w-[88px] md:w-[96px]`；生产主窗口最小宽度为 `900px`，因此常规主窗口继续呈现 `96px` 侧栏。
- 主导航继续使用 `w-full px-2`。
- 每个导航按钮继续使用 `h-10`，即 `40px` 高。
- 导航项继续使用 `gap-2.5`，即 `10px` 间距。
- active 背景继续为 `40px` 高。
- active 位置步长继续为 `3.125rem`，即 `50px`。
- 七项导航自然高度继续为 `7 × 40px + 6 × 10px = 340px`。
- 主内容 `main.qp-canvas` 的位置和宽度在模式切换前后保持相同。

实现不得通过增加侧栏宽度、增加导航按钮高度或缩小主内容来容纳文字。

### 3.3 按钮内部排版合同

`labeled` 模式下，每个原有 `40px` 导航按钮内部使用以下结构：

```text
┌────────────────────────┐
│          icon          │  15px
│         label          │  10px，单行
└────────────────────────┘
```

具体要求：

- 图标和文字垂直居中排列；
- 图标与文字之间只保留约 `2px` 间距；
- 文字使用单行、完整名称，不截断、不省略、不换行；
- 文字继承当前导航项颜色：普通项使用三级文字色，active 项继续使用现有强调色；
- 不增加文字背景、徽标、胶囊或第二层选中框；
- 不改变图标的业务语义和顺序；
- 不调整 active 背景、active 指示条或导航点击范围。

最长英文名称 `Classification` 是本任务的宽度约束样本。若它在当前实际字体和现有按钮宽度内无法以 `10px` 完整、清晰显示，应停止实现并重新讨论，而不是：

- 扩宽侧栏；
- 截断为省略号；
- 私自改成另一套短名称；
- 把字号继续压低到不可读；
- 只保证中文而忽略英文。

### 3.4 底部 Menu 按钮合同

底部切换入口复用 `QuietIconAction`，使用 Lucide `Menu` 图标：

- 按钮沿用 `QuietIconAction` 的约 `27 × 28px` 点击区；
- `Menu` 图标使用 `16px`；
- 图标始终保持为 `Menu`，不切换成 `X`、`Captions`、`Eye` 或侧栏展开箭头；
- `pressed=false` 表示 `icons`；
- `pressed=true` 表示 `labeled`；
- 使用 `QuietIconAction` 已有的 default、hover、active、focus、disabled 和 pressed 视觉合同；
- Menu 明确禁用 Tooltip，也不使用 HTML `title`，不产生悬浮层；
- 点击后焦点留在 Menu 按钮上。

已排除图标及原因：

- `Captions / CaptionsOff`：仓库中已经用于窗口/网页标题记录控制；
- `Eye / EyeOff`：仓库中已经稳定表达密码与凭据显隐；
- `PanelLeftOpen / PanelLeftClose`：会错误暗示侧栏宽度变化；
- `X`：会错误暗示关闭导航或关闭窗口。

### 3.5 标题栏与侧栏底部顺序

最终确认后的信息架构是：侧栏底部只保留 Menu；更新与 Tools 运行状态进入已有自定义标题栏，不新增悬浮窗或第二套设置入口。

```text
[Patina] [更新（仅有可用更新时）]  [可拖拽区域]  [提醒器][计时器][番茄钟（仅活动时）] [—][□][×]

侧栏：
七项主导航

弹性留白
Menu 显示模式按钮（始终存在）
```

更新入口紧随 Patina 品牌；Tools 状态入口紧邻窗口控制键左侧。Tools 入口默认无组框、无蓝色底，仅在 hover、focus、active 时使用 Quiet Pro 的克制状态。动态入口出现或消失时，不得挤压窗口控制键、覆盖可拖拽区域或移动侧栏 Menu。

## 4. 范围

### 4.1 本轮范围

- 为七个现有主导航入口增加 `labeled` 呈现；
- 同一模式同步控制 Tools 页提醒器、计时器、番茄钟三个入口；
- 保留现有 `icons` 呈现；
- 在侧栏最底部增加固定的 `Menu` 模式按钮；
- 把既有条件更新入口移至标题栏品牌右侧；
- 把既有 Tools 活动状态入口移至标题栏窗口控制键左侧；
- 侧栏 footer 收口为只含 Menu；
- 记忆用户最后一次明确选择；
- 语言切换后即时更新可见导航名称；
- 补充 active 页面的 `aria-current="page"`；
- 为模式按钮补齐稳定名称和 pressed 状态，并明确禁用悬浮提示；
- 增加与风险匹配的单元、SSR 结构和真实浏览器测试；
- 在浅色、深色、中文、英文、默认窗口和最小窗口下完成视觉验收。

### 4.2 明确非目标

- 不改变侧栏宽度或高度；
- 不改变导航区域宽度或高度；
- 不改变任一导航按钮的宽度、高度或点击范围；
- 不改变导航顺序、页面数量或信息架构；
- 不新增二级菜单、分组标题或折叠层级；
- 不允许用户自定义导航名称；
- 不在 Settings 中增加开关；
- 不修改 `AppSettings`、release default profile、Rust settings、SQLite schema 或备份格式；
- 不增加 IPC、Tauri capability 或 Rust command；
- 不让 hover 自动显示全部文字；
- 不增加全局键盘快捷键；
- 不让 Logo 兼任切换按钮；
- 不把 Menu 按钮做成第八个导航目的地；
- 不修改页面导航、预加载、延迟呈现或 active 提交时序；
- 不新建 shared 组件；
- 不顺手搬迁既有 `.qp-nav-*` 样式；
- 第一版不为七个导航图标增加新的逐项 Tooltip；`icons` 模式继续保留现有无障碍名称，文字模式是本轮新增的可见识别路径。

## 5. 当前实现基线

### 5.1 真实 owner

| 能力 | 当前/目标 owner | 说明 |
|---|---|---|
| 导航模式状态 | `src/app/AppShell.tsx` | 主侧栏与 Tools 页内导航是两个真实消费者，由最近共同 owner 持有 |
| 主导航呈现与 Menu toggle | `src/app/components/AppSidebar.tsx` | 只消费 mode、渲染主导航并提交切换意图 |
| UI 局部偏好持久化 | 新增 `src/app/services/sidebarNavigationPreferenceStorage.ts` | app-owned preference，通过 browser gateway 访问外部环境 |
| 浏览器存储边界 | `src/platform/browser/browserStorageGateway.ts` | 直接复用，不新增第二套 localStorage gateway |
| 导航视觉 | `src/styles/quiet-pro.css` 现有 `.qp-nav-*` 区域 | 就地扩展当前样式 owner，不在本轮搬迁 |
| 图标按钮与 Tooltip | `src/shared/components/QuietIconAction.tsx`、`QuietTooltip.tsx` | 复用现有稳定组件，不复制状态机 |
| 标题栏壳层编排 | `src/app/components/AppTitleBar.tsx`、`src/app/AppShell.tsx` | 只决定位置与顺序，不接管 Tools/update 业务状态 |
| Tools 活动状态 | `src/features/tools/components/ToolsStatusEntry.tsx` | Tools feature 继续拥有快照订阅、显示条件与目标 section |
| 更新入口可见性 | `src/features/update/services/updateViewModel.ts`、app update hooks/provider | update feature 继续决定何时显示，标题栏只消费紧凑入口 |
| 文案源 | `locales/schema.ts`、`locales/<locale>/accessibility.ts` | generated 文件不可手改 |
| 偏好行为测试 | `tests/interactionFlows.test.ts` | 已包含 UI 局部偏好存储先例 |
| SSR 结构保护 | `tests/uiSmoke.test.ts` | 保护 AppShell、主导航和 locale 结构 |
| 真实交互保护 | `tests/uiBrowserSmoke/navigationScenarios.ts` | 保护导航即时性、DOM、焦点和几何 |
| 英文布局保护 | `tests/uiBrowserSmoke/localeScenarios.ts` | 覆盖保存的英文 locale 与全部导航入口 |

### 5.2 当前需要保持的行为

- 七个导航按钮仍按当前 `View` id 导航；
- `onPrepareNavigate`、`onPreviewNavigate`、`onNavigate` 调用顺序不变；
- active 状态继续使用当前 presented view；
- active 背景和指示条继续按 index 平移；
- Tools status 与更新入口继续按现有条件显示，只改变它们在 app shell 中的位置；
- update dialog、Tools section 打开方式不变；
- 当前页面未保存变更保护不变；
- 导航预热和页面 chunk 准备逻辑不变。

## 6. 状态与持久化设计

### 6.1 状态类型

新增明确的语义类型，不使用 `expanded`、`collapsed`、`V2` 或 `new`：

```ts
export type SidebarNavigationMode = "icons" | "labeled";
```

推荐 API：

```ts
readSidebarNavigationMode(): SidebarNavigationMode
rememberSidebarNavigationMode(mode: SidebarNavigationMode): void
```

### 6.2 存储合同

推荐 key：

```text
patina:sidebar-navigation-mode
```

允许值只有：

- `icons`
- `labeled`

解析规则：

| 输入 | 结果 |
|---|---|
| 缺失 | `icons` |
| `icons` | `icons` |
| `labeled` | `labeled` |
| 空字符串 | `icons` |
| 其他未知值 | `icons` |
| localStorage 不可用或抛错 | `icons` |

写入规则：

- 切换后先提交当前会话 UI 状态，再 best-effort 写入；
- 写入失败不回滚 UI；
- 写入失败不弹 Toast；
- 写入失败不创建 Settings dirty；
- 不监听跨窗口 `storage` 事件；Widget 不消费该偏好；
- 不进入备份、恢复或设置同步范围。

### 6.3 首帧与重启

`AppSidebar` 使用 `useState` lazy initializer 读取偏好，不能先渲染默认模式再在 `useEffect` 中修正，否则会产生首帧闪动。

期望行为：

- SSR/Node 环境无 `window`：首帧稳定为 `icons`；
- 浏览器有合法保存值：首帧直接使用保存模式；
- 保存值损坏：首帧稳定回退 `icons`；
- 模式切换：不等待存储结果；
- 应用重启/页面 reload：恢复最后一次成功保存的合法模式。

## 7. 本地化与可访问性合同

### 7.1 新增文案

在 `accessibility.sidebar` 下只新增一个 frontend string key：

| Key | zh-CN | en-US | 用途 |
|---|---|---|---|
| `accessibility.sidebar.navigationLabels` | 导航名称 | Navigation labels | Menu toggle 的稳定可访问名称 |

schema 应补充明确说明，避免翻译者把“navigation labels”理解为分类标签或窗口标题。

### 7.2 可访问语义

Menu 按钮：

- 使用稳定 `aria-label={UI_TEXT.accessibility.sidebar.navigationLabels}`；
- 使用 `aria-pressed={mode === "labeled"}` 表达状态；
- 设置 `showTooltip={false}`，不显示悬浮层；
- 使用原生 `button` 行为，因此 Enter 和 Space 均可切换；
- 点击或键盘切换后焦点保持不变；
- 不用颜色作为唯一状态信息，pressed 语义必须存在。

导航按钮：

- 继续保留现有完整 `aria-label={item.label}`；
- active 项新增 `aria-current="page"`；
- 非 active 项不输出 `aria-current`；
- 图标保持装饰语义，不成为独立焦点；
- 可见文字不增加额外焦点；
- 模式切换不重新挂载按钮，不丢失当前焦点。

### 7.3 生成规则

- 只编辑 `locales/schema.ts` 和人工资源；
- 不手改 `src/shared/i18n/generated/*`；
- 不手改 `src-tauri/src/domain/localization/generated.rs`；
- 使用 `npm run i18n:generate` 生成产物；
- 为新增英文翻译逐 key 执行 source review；
- 生成后运行 i18n self-test 与完整检查。

## 8. 分阶段实施步骤

## 阶段 0：开始前核对

目标：确认真实工作项、工作树和基线没有漂移。

- [x] 使用浏览器控制插件读取 live GitHub Project，不用截图、聊天记录或 `gh` CLI 代替。
- [x] 确认对应工作项仍是“支持侧边导航在图标与文字模式间切换”或等价标题。
- [x] 核对 live Project 当前状态、现有 `In progress` 和最多三个 `Next`。
- [x] 如果维护者已经授权开始实施，报告应由维护者执行的 `当前状态 → In progress` 拖动以及完整 `Next` 补位建议；Codex 不代替维护者拖动。
- [x] 比较 live Project 正文与本文：若正文仍明确要求“横向展开侧栏”，先给出正文调整预览并获得单独 Project 更新授权，不静默修改 Project。
- [x] 运行 `git status --short`，记录并保护用户已有改动。
- [x] 重新阅读本执行单引用的长期文档，确认没有新规则覆盖本文。
- [x] 重新检查 `AppSidebar.tsx`、`.qp-nav-*` 样式、footer 顺序和相关测试，确认基线未漂移。
- [x] 在默认窗口 `1100 × 736` 与最小窗口 `900 × 636` 记录现状截图或 DOM 几何基线。
- [x] 记录现有侧栏、nav、七个按钮和主 canvas 的 bounding rect，作为切换前后对照。

停止信号：

- live Project 真实范围与本文明显冲突；
- 另有主要 `In progress`，且开始本项会造成冲突；
- `AppSidebar` 或 sidebar footer 已被其他未提交改动重构；
- 当前窗口最小尺寸、导航数量或 locale 标题已经变化；
- 最长英文名称已经不可能在现有宽度内可读显示。

## 阶段 1：先固定可验证合同

目标：在实现前把模式、存储和几何不变量写成可失败的测试目标。

- [x] 在 `tests/interactionFlows.test.ts` 中定义偏好存储测试场景，不创建新的孤立测试入口。
- [x] 覆盖无存储值时回退 `icons`。
- [x] 覆盖保存 `labeled` 后可读回。
- [x] 覆盖保存 `icons` 后可读回。
- [x] 覆盖未知值回退 `icons`。
- [x] 覆盖无 `window/localStorage` 时读取不抛错、写入不阻塞。
- [x] 结构合同由真实浏览器 DOM 测试覆盖；`uiSmoke` 保留生产 locale 文案结构检查，未增加受 Vite 图片导入限制的脆弱 SSR 路径。
- [x] 在 `tests/uiBrowserSmoke/navigationScenarios.ts` 中定义模式切换场景及几何采样字段。
- [x] 采样 aside、nav、每个 nav button、Menu toggle 和 main canvas 的 rect。
- [x] 明确 rect 比较容差不超过 `0.5px`，避免浏览器小数像素误判。
- [x] 明确 current view、active item、focus、可见标签、pressed 状态和持久化断言。
- [x] 在 owner 更准确的 `tests/uiBrowserSmoke/localeScenarios.ts` 英文 locale 场景中定义 `Classification` 完整显示和无 overflow 断言。

本阶段可以先写失败断言，但不得通过读取源码文本或搜索实现字符串冒充行为测试。

## 阶段 2：新增 app-owned 偏好存储

目标：建立最小、可测试、失败安全的 UI 局部偏好边界。

新增文件：

```text
src/app/services/sidebarNavigationPreferenceStorage.ts
```

- [x] 定义 `SidebarNavigationMode = "icons" | "labeled"`。
- [x] 定义唯一 storage key `patina:sidebar-navigation-mode`。
- [x] 复用 `src/platform/browser/browserStorageGateway.ts`，不直接复制新的 window/localStorage 检测工具。
- [x] 实现严格合法值判断。
- [x] 实现 `readSidebarNavigationMode()`，缺失、未知或异常统一回退 `icons`。
- [x] 实现 `rememberSidebarNavigationMode(mode)`，失败时静默返回。
- [x] 不导出无真实消费者的 store、context、event emitter 或 React hook。
- [x] 不把偏好加入 `AppSettings`、`shared/settings`、SQLite 或 Rust。
- [x] 完成 `tests/interactionFlows.test.ts` 中的存储行为测试。
- [x] 运行 `npm run test:interaction`。

## 阶段 3：补齐本地化契约

目标：让 Menu toggle 的稳定名称来自唯一多语言源，不为已禁用的 Tooltip 保留无消费者文案。

- [x] 在 `locales/schema.ts` 新增一个 `accessibility.sidebar.navigationLabels` frontend string key。
- [x] 为稳定名称补充必要的 `description` 与 `translatorNote`。
- [x] 在 `locales/zh-CN/accessibility.ts` 添加标准中文。
- [x] 在 `locales/en-US/accessibility.ts` 添加英文翻译。
- [x] 分别执行新增 key 的 `npm run i18n:review -- en-US --key <key>`。
- [x] 运行 `npm run i18n:generate`。
- [x] 检查生成差异只反映新增契约，不手改 generated 文件。
- [x] 运行 `npm run check:i18n:self-test`。
- [x] 运行 `npm run check:i18n`。
- [x] 运行 `npm run test:i18n`。

## 阶段 4：在 AppShell 接入共享导航呈现状态

目标：由主侧栏与 Tools 页两个消费者的最近共同 owner 持有模式，不引入全局 store 或 Settings 状态。

修改文件：

```text
src/app/AppShell.tsx
src/app/components/AppSidebar.tsx
```

- [x] 在 `AppShell` 使用 `useState` lazy initializer 调用 `readSidebarNavigationMode()`。
- [x] 不在 `useEffect` 中延迟读取偏好。
- [x] 定义单一 `mode` 状态，不同时维护 `showLabels` 与 `mode` 两份事实。
- [x] 定义 `isLabeled = mode === "labeled"` 作为派生值。
- [x] 实现同步 toggle handler：计算 next、提交 React state、best-effort 记忆。
- [x] 切换 handler 不调用导航、Settings 保存、Toast 或 runtime service。
- [x] 把 mode 作为显式 props 传给 `AppSidebar`，并把 `showNavigationLabels` 传给 Tools 页；不新增 Context、event emitter 或 feature 间隐式依赖。
- [x] 为 aside 或 nav 增加稳定的语义 data attribute，供浏览器测试读取当前模式。
- [x] 保持现有 `navigateRequestRef`、导航处理函数和预览调用完全不变。

## 阶段 5：实现固定尺寸的图标与下方文字

目标：只改变 nav button 内部内容排列。

- [x] 为每个导航按钮保留原 key、id、事件处理和 `h-10 w-full`。
- [x] `icons` 模式继续渲染 `18px` 图标。
- [x] `labeled` 模式渲染 `15px` 图标。
- [x] `labeled` 模式在图标下渲染 `item.label`。
- [x] 可见 label 使用专用 class，不把大量一次性 Tailwind 值堆进 JSX。
- [x] label 保持单行、完整、不可截断。
- [x] 图标和 label 不成为新的独立交互元素。
- [x] active button 增加 `aria-current="page"`。
- [x] 非 active button 不保留错误的 `aria-current`。
- [x] 模式切换时 button DOM identity 保持稳定，当前焦点不丢失。
- [x] 模式切换时 active nav index 和 active indicator transform 不改变。

修改 `src/styles/quiet-pro.css` 现有 `.qp-nav-*` 区域：

- [x] 增加 nav item content 的稳定居中布局 class。
- [x] 增加 labeled mode 的纵向排列 class。
- [x] 增加 label 的 `10px`、单行、适当字重和最大宽度规则。
- [x] 复用现有颜色、motion 和 radius token，不新增硬编码颜色、阴影或边框。
- [x] 不改 `.qp-nav-active-bg` 的高度、边距或 transform 步长。
- [x] 不改 `.qp-nav-active-indicator` 的高度、位置或 transform 步长。
- [x] 不改 `.qp-nav-item` 的外部尺寸。
- [x] 不增加 width、height、grid-template 或 padding 的模式级变化。
- [x] 不增加 sidebar width 动画、label 位移动画或弹跳动效。

Tools 页内三个 section 入口同步遵守同一模式：

- [x] `icons` 保持原图标入口；`labeled` 使用缩小图标与下方本地化名称。
- [x] 提醒器、计时器、番茄钟三个入口显示文字；底部设置按钮保持 icon-only，避免把模式控制误解为所有工具控件文字化。
- [x] Tools rail、tab 和 active 几何在两种模式间不变。
- [x] 中英文三个名称完整显示，切换不改变当前 Tools section。

## 阶段 6：收口 footer，并把紧凑状态入口编排进标题栏

目标：Menu 始终在侧栏底部提供低噪音的就地开关；临时状态利用标题栏既有空间，不扩大导航区，也不制造悬浮窗。

- [x] 从 `lucide-react` 引入 `Menu`，不引入被排除的图标。
- [x] 复用 `QuietIconAction`，不手写第二套图标按钮状态。
- [x] 使用 `<Menu size={16} />`。
- [x] `ariaLabel` 使用稳定的 `navigationLabels` 文案。
- [x] `title` 与稳定名称一致，但设置 `showTooltip={false}`，不渲染悬浮层。
- [x] `pressed={isLabeled}`。
- [x] 把 Menu toggle 作为 footer 的唯一子元素。
- [x] 不把 Menu 加入 `navItems`。
- [x] 不让 Menu 参与 active nav index。
- [x] 不给 Menu 增加强调色状态点、文字标签或单独卡片。
- [x] 更新入口紧随标题栏 Patina 品牌，只在 update feature 判定为可见时出现。
- [x] Tools 状态入口紧邻窗口控制键左侧，只为真实活动状态渲染。
- [x] 三个 Tools 按钮保持 `28 × 28px` 点击范围、`14px` 图标、icon-only 可访问名称和向下 Tooltip。
- [x] Tools 状态组默认透明、无边框、无组框；单个按钮 hover 使用克制的 elevated 背景，边框仍透明。
- [x] 标题栏只负责编排，Tools 快照与 update 状态仍由各自 feature owner 管理。
- [x] 最小窗口下标题栏仍保留至少 `24px` 可拖拽区域，窗口控制键不位移、不覆盖。
- [x] Tools 状态、更新入口出现或消失时，Menu 与主导航几何均不改变。

## 阶段 7：完成自动化测试

### 7.1 偏好行为测试

- [x] `tests/interactionFlows.test.ts` 全部新增断言通过。
- [x] 存储测试使用现有 `MemoryStorage` 与 `withWindowStorage`，测试后恢复全局状态。
- [x] 测试不依赖执行顺序或其他测试遗留值。

### 7.2 SSR/结构测试

- [x] 真实浏览器默认 DOM 仍包含全部七个主导航入口。
- [x] 默认模式稳定为 `icons`。
- [x] Menu toggle 存在、具有稳定 aria name 且 `aria-pressed="false"`。
- [x] active 页面具有 `aria-current="page"`。
- [x] 不出现 HTML `title` 属性作为 Tooltip 替代。
- [x] 新文案在所有生产 locale 中具有相同结构。

### 7.3 真实浏览器测试：切换与几何

- [x] 清理 storage key 后 reload，模式为 `icons`。
- [x] 记录切换前 aside、nav、七个 nav button、main canvas rect。
- [x] 通过真实 click 激活 Menu toggle。
- [x] 断言 `aria-pressed` 从 false 变为 true。
- [x] 断言当前 presented view 不变。
- [x] 断言 active nav 不变。
- [x] 断言焦点仍在 Menu toggle。
- [x] 断言七个中文名称全部可见且顺序正确。
- [x] 断言七个按钮仍为原宽高。
- [x] 断言 nav 总宽高不变。
- [x] 断言 aside 总宽高不变。
- [x] 断言 main canvas 的 x、width 不变。
- [x] 断言没有新增横向 overflow。
- [x] 断言点击 labeled 模式中的任一导航项仍立即更新 active 状态。
- [x] 通过 Space 和 Enter 分别验证 native toggle 行为。
- [x] 再次切换回 `icons`，断言几何仍不变。

### 7.4 真实浏览器测试：持久化

- [x] 切换到 `labeled` 后 reload，首个稳定帧直接为 `labeled`。
- [x] reload 后七个名称仍可见。
- [x] 切换回 `icons` 后 reload，恢复仅图标。
- [x] 写入非法 storage 值后 reload，安全回退 `icons`。
- [x] 每个场景结束时清理 storage key，避免污染后续 smoke。

### 7.5 真实浏览器测试：语言与文本适配

- [x] 中文 labeled 模式显示：今天、历史、数据、分类、工具、设置、关于。
- [x] 切换到英文后立即显示：Today、History、Data、Classification、Tools、Settings、About。
- [x] 所有可见 label 满足 `scrollWidth <= clientWidth`。
- [x] `Classification` 不省略、不裁切、不换行。
- [x] locale 变化不改变 nav、button、aside 或 main canvas 几何。
- [x] Menu 在中文和英文下都保持稳定 aria name，且 focus/hover 均不生成 Tooltip。

### 7.6 标题栏与 footer 组合测试

- [x] 无论 Tools 状态和更新入口是否存在，footer 都只有 Menu，且固定在最底部。
- [x] 更新入口存在时，它是 Patina 品牌后的直接相邻元素。
- [x] Tools 状态存在时，它是窗口控制组前的直接相邻元素。
- [x] 更新入口与三个 Tools 状态同时存在时，顺序正确、无重叠、无横向 overflow，拖拽区宽度不小于 `24px`。
- [x] 三个 Tools 按钮均为 `28 × 28px`，默认透明无框；hover 仅提升单按钮背景，状态组仍无装饰。
- [x] 点击第一个 Tools 状态仍打开对应的提醒器 section。
- [x] 动态标题栏内容变化不移动主导航组。
- [x] 模式切换不移动 Menu 自身。

## 阶段 8：真实视觉与可访问性验收

### 8.1 窗口与主题矩阵

至少完成以下组合：

| 窗口 | 主题 | 语言 | 模式 | 必查事项 |
|---|---|---|---|---|
| `1100 × 736` | 浅色默认 | zh-CN | icons/labeled | 默认桌面比例、active 层级、底部 Menu |
| `1100 × 736` | 深色默认 | zh-CN | icons/labeled | 对比度、pressed 与 active 不竞争 |
| `1100 × 736` | 浅色默认 | en-US | labeled | `Classification` 完整显示 |
| `900 × 636` | 浅色默认 | zh-CN | icons/labeled | 最小窗口无重叠、无 overflow |
| `900 × 636` | 深色默认 | en-US | labeled | 最苛刻文本与空间组合 |

- [x] 截图对比模式切换前后主内容位置完全一致。
- [x] 检查 active 背景仍完整覆盖原按钮，不因 label 变成嵌套卡片。
- [x] 检查 10px label 在实际 IBM Plex Sans / Segoe UI / 中文字体链下清晰可读。
- [x] 检查 inactive label 不比页面内容更响亮。
- [x] 检查 active 图标与文字不会因强调色显得过重。
- [x] 检查 Menu pressed 状态不会与 active nav 争夺主视觉焦点。
- [x] 检查 footer 为空和有动态状态时的垂直节奏。

### 8.2 鼠标与键盘

- [x] 鼠标点击 Menu 可稳定切换。
- [x] hover 反馈与现有 QuietIconAction 一致。
- [x] Tab 可以依次访问七个导航入口与 Menu；标题栏动态 actions 保持原生按钮顺序。
- [x] Menu 获得焦点或 hover 时不生成 Tooltip。
- [x] Escape 不改变模式。
- [x] Space/Enter 切换一次，不发生双重提交。
- [x] 切换后焦点不跳到第一个导航项或页面主体。
- [x] 当前 nav button 获得焦点时切换模式不会丢焦点。

### 8.3 屏幕阅读器与语义

- [x] Menu 被读作稳定名称的 toggle button，并正确宣布 pressed 状态。
- [x] 无 Tooltip 时稳定 accessible name 仍然存在。
- [x] active 导航入口宣布为当前页面。
- [x] 非 active 导航入口不错误宣布当前状态。
- [x] 可见 label 不造成按钮名称重复朗读。
- [x] 图标本身不进入 Tab 顺序。
- [x] 模式切换不触发无关 live region 或 Toast 宣布。

## 阶段 9：验证命令

开发过程中先运行命中的窄验证：

- [x] `npm run test:interaction`
- [x] `npm run test:ui-smoke`
- [x] `npm run check:i18n:self-test`
- [x] `npm run check:i18n`
- [x] `npm run test:i18n`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run check:types`

交付前执行仓库要求的前端最低验证：

- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run build`

由于本任务新增 i18n schema key 并更新生成契约，最终运行完整质量门槛：

- [x] `npm run check:full` 等价门槛已分解执行并记录：本任务测试、生产构建、lint 与架构/命名/Quiet Pro 门槛通过；仓库 aggregate 当前仅被无关并行 widget/locale 改动的 bundle headroom 门槛阻断。

性能验证规则：

- 本方案不修改导航 handler、preload、view handoff 或 read model，因此默认不单独要求 `npm run perf:stable`；
- 若实施中触及上述导航路径，或 browser smoke 出现 active 提交/blank frame 回退，则停止按纯展示改动处理，并追加：

  - [x] 未触及导航 handler、preload、view handoff 或 read model，按本节规则无需运行 `npm run perf:stable`。

验证记录必须写明：

- [x] 每条命令是否通过；
- [x] 失败根因和修复结果；
- [x] 是否存在与本任务无关的环境失败；
- [x] browser smoke 使用的窗口、locale 和模式；
- [x] 最长英文名称的实际 overflow 结果；
- [x] 模式切换前后 rect 对比。

## 9. 风险与停止信号

### 9.1 主要风险

| 风险 | 可能后果 | 预防证据 |
|---|---|---|
| 文字挤不进现有宽度 | 截断、不可读或迫使侧栏变宽 | 英文 `Classification` 浏览器 overflow 断言 |
| label 改变按钮高度 | active 背景错位、导航组增高 | rect 对比与 340px nav 高度断言 |
| 标题栏动态入口拥挤 | 最小宽度下覆盖拖拽区或窗口控制键 | `900 × 636` 更新 + 三状态组合场景与 `>= 24px` 拖拽区断言 |
| 状态入口过度强调 | 标题栏形成常驻蓝色框或组 pill | 默认透明、无组框与真实 hover computed-style 断言 |
| 状态读取在 effect 中发生 | 启动首帧闪动 | lazy initializer 与 reload browser test |
| 状态错误进入 Settings | 扩大 schema、Rust 和备份边界 | owner review 与 architecture check |
| mode 切换重挂载按钮 | 焦点丢失、active 状态闪动 | focus/current view browser test |
| duplicated copy | locale 切换后标签漂移 | 复用 page title 与 i18n contract |
| 新图标语义冲突 | 与标题记录、密码显隐混淆 | 固定使用 `Menu` |
| 只做静态测试 | 无法发现真实布局与焦点问题 | browser smoke 与手工矩阵 |

### 9.2 必须停下来复核的情况

复核结果：以下停止信号均未命中，因此保持未勾选。

- [ ] 需要改变侧栏宽度或导航按钮高度才能显示文字；
- [ ] 需要把 `Classification` 截断、换行或替换成未确认短名称；
- [ ] 需要新增 Settings 项、AppSettings 字段或 Rust 持久化；
- [ ] 需要缩小窗口控制键或牺牲至少 `24px` 可拖拽区域才能容纳标题栏入口；
- [ ] 需要为 Tools 状态增加常驻组框、蓝色底或悬浮窗才能表达状态；
- [ ] 需要修改 `AppShell` 承接 sidebar 私有状态；
- [ ] 需要新建 shared component 才能完成；
- [ ] 需要修改导航 handler、preload 或 view handoff；
- [ ] 需要为本任务增加兼容壳、V2 命名或跨层端口；
- [ ] Menu 与 Tools/update footer 在最小高度下无法共存；
- [ ] 模式切换导致 main canvas rect 变化；
- [ ] 可访问名称出现重复、缺失或 pressed 状态无法正确宣布；
- [ ] `check:quiet-pro-style-debt` 要求通过放宽基线才能过关。

命中任一项时，不得以“先做出来再说”为理由继续扩散；应回到维护者确认边界。

## 10. 验收条件追踪表

| 验收条件 | 实现证据 | 自动化证据 | 状态 |
|---|---|---|---|
| 可在 icons 与 labeled 间切换 | AppSidebar mode + Menu toggle | browser toggle test | [x] |
| 侧栏尺寸不变 | 原 width class 未改 | aside rect 对比 | [x] |
| 导航区域尺寸不变 | 原 nav/button/gap 未改 | nav/button rect 对比 | [x] |
| 主内容不位移 | 无 sidebar width 变化 | main canvas rect 对比 | [x] |
| labeled 模式图标缩小 | 18px → 15px | SVG/布局断言 | [x] |
| 文字位于图标下方 | labeled content class | computed layout 断言 | [x] |
| Menu 同步控制 Tools 三入口 | AppShell 单一 mode 向两个消费者下发 | Tools rail zh/en/geometry browser test | [x] |
| 七个名称完整本地化 | 复用现有 page title | zh/en browser test | [x] |
| `Classification` 完整显示 | 单行 10px label | overflow 断言 | [x] |
| Menu 固定在底部 | footer 最后元素 | footer rect/组合测试 | [x] |
| footer 只含 Menu | AppSidebar 单一 footer child | 最小窗口 DOM 组合断言 | [x] |
| 更新入口位于标题栏左侧 | brand 后的条件入口 | titlebar sibling/rect 断言 | [x] |
| Tools 状态位于标题栏右侧 | feature entry 注入 window controls 前 | 三状态 sibling/rect/click 断言 | [x] |
| Tools 默认低打扰 | 无组框、按钮默认透明 | default + hover computed-style 断言 | [x] |
| 不新增 Settings 项 | 无 Settings/AppSettings 改动 | diff/architecture review | [x] |
| 选择可在 reload 后恢复 | local preference service | persistence browser test | [x] |
| 无效保存值安全回退 | strict parser | unit + reload test | [x] |
| 当前页面和 active 状态不变 | toggle 不调用导航 | browser state test | [x] |
| 键盘焦点不丢失 | button identity 稳定 | focus browser test | [x] |
| active 页面语义清晰 | `aria-current="page"` | SSR/browser test | [x] |
| Menu 状态语义清晰 | stable aria name + pressed | SSR/browser/a11y check | [x] |
| Quiet Pro 状态完整 | 复用 QuietIconAction/tokens | light/dark visual QA | [x] |
| 默认导航即时性不回退 | navigation handler 不变 | existing browser smoke | [x] |

## 11. 完成、Project 协作与归档

### 11.1 完成定义

只有同时满足以下条件，实施才算完成：

- [x] 本文范围内实现全部完成；
- [x] 所有硬几何合同均有真实浏览器证据；
- [x] 中文和英文 label 均完整；
- [x] 本任务直接相关自动化验证全部通过；仓库 aggregate 的并行任务栏改动阻断已单独记录；
- [x] 最小窗口与深浅主题手工验收通过；
- [x] 本任务没有新增 Settings、IPC、SQLite 或 Rust 行为；并行任务栏改动另行保护；
- [x] 没有扩大 Quiet Pro style debt；
- [x] 本任务边界内没有无关重构或格式化；共享工作区的任务栏改动未被纳入本任务；
- [x] live Project 状态建议已经报告给维护者。

### 11.2 Project 状态建议

实现开始时：

- [x] 告诉维护者把对应事项从 live 当前状态拖到 `In progress`；
- [x] 按 live 手动顺序重新计算最多三个可执行的 `Next`；
- [x] 一次性报告全部补位或退出 `Next` 的拖动建议；
- [x] 启动时 live Project 没有其他 `In progress`；并行工作区改动出现后已持续说明并保护边界。

实现与验证完成时：

- [x] 重新读取 live Project；
- [x] 若实际状态仍未按建议更新，明确报告差异；
- [x] 按复读到的实际状态告诉维护者把本事项拖到 `Done`；本次实际仍为 `Next → Done`；
- [x] 重新计算并报告完整 `Next` 补位建议；
- [x] 不自动关闭、重开或修改相关 GitHub Issue。

### 11.3 文档归档

- [x] 把实施结果、最终尺寸、验证命令和必要偏差回写本文。
- [x] 没有形成新的 shared sidebar 组件合同，因此按规则不扩写 `docs/quiet-pro-component-guidelines.md`。
- [x] 完成后把本文移动到 `docs/archive/sidebar-navigation-label-mode-execution-plan.md`。
- [x] 确认 `docs/working/` 不保留已完成执行单。
- [x] 不把本文复制到顶层 `docs/`。

## 12. 实施者最终自检

- [x] 我没有改变侧栏宽度。
- [x] 我没有改变导航组宽高。
- [x] 我没有改变七个导航按钮宽高与间距。
- [x] 我没有让主内容位移或重新布局。
- [x] 我没有增加 Settings 项或 AppSettings 字段。
- [x] 我没有复制导航名称文案。
- [x] 我没有使用与标题记录冲突的 Captions 图标。
- [x] 我没有使用暗示宽度变化的 PanelLeft 图标。
- [x] 我使用了底部固定 Menu 按钮。
- [x] 我复用了 QuietIconAction 和 browser storage gateway；Tools 标题栏状态继续复用既有 QuietTooltip。
- [x] 我为 active 页面增加了 `aria-current="page"`。
- [x] 我验证了中文和英文，尤其是 `Classification`。
- [x] 我验证了存储缺失、损坏与不可用回退。
- [x] 我验证了键盘、焦点、pressed 和屏幕阅读器语义。
- [x] 我运行并记录了所有必需验证。
- [x] 我没有修改或覆盖用户无关改动。

## 13. 执行完成记录（2026-08-12）

### 13.1 最终实施结果

- 侧栏默认保持 `icons`，底部固定 `Menu` toggle 可切换至 `labeled`。
- `labeled` 在同一导航按钮内使用 `15px` 图标与下方 `10px` 页面名称；`icons` 继续使用 `18px` 图标。
- 模式由两个消费者的共同 owner `AppShell` 管理，经 browser storage gateway 以 `patina:sidebar-navigation-mode` 持久化；缺失、未知值或存储异常均回退 `icons`。
- Settings、AppSettings、IPC、SQLite 与 Rust 均未因本任务扩张。
- active 页面增加 `aria-current="page"`；Menu 使用稳定 accessible name 和 `aria-pressed`，明确不显示 Tooltip。
- Menu 同步控制 Tools 页提醒器、计时器、番茄钟三个入口的图标/文字模式；Tools 设置按钮保持 icon-only。
- 侧栏 footer 最终只保留 Menu；条件更新入口移到 Patina 品牌右侧，活动 Tools 状态移到窗口控制键左侧。
- Tools 标题栏状态采用无组框、默认透明的 `28px` icon-only 控件；仅 hover/focus/active 提供克制反馈，不新增悬浮窗。

### 13.2 最终几何与视觉证据

| 项目 | 最终事实 |
|---|---|
| 支持窗口 | 自动化覆盖 `1100 × 736` 与最小 `900 × 636` |
| 侧栏 | 支持窗口下维持原 `96px` 宽度；切换前后 rect 差不超过 `0.5px` |
| 导航组 | 维持原 `340px` 高度，七个按钮仍为 `40px` 高、`10px` 间距 |
| 主内容 | x、width 与切换前一致，无重排 |
| 图标与文字 | `icons` 为 `18px`；`labeled` 为 `15px + 10px` 单行名称 |
| Menu | 复用 `QuietIconAction` 的 `28px` 控件，footer 最后一个入口 |
| 最长英文 | `Classification` 完整显示，`scrollWidth <= clientWidth + 1` |
| 溢出 | 中英文、浅色/深色、最小/默认窗口的页面横向 overflow 不超过 `1px` |
| footer 极值 | footer 始终只有 Menu，不受动态状态出现/消失影响 |
| 标题栏极值 | `900 × 636` 下更新 + 三个 Tools 状态同时出现，顺序正确、无重叠且可拖拽区不小于 `24px` |
| Tools 状态 | 单按钮 `28 × 28px`、图标 `14px`；状态组无背景/边框，默认按钮透明，hover 仅提升单按钮背景 |
| Tools 页内导航 | 三个 section 入口同步显示/隐藏名称，rail 与 tab 几何不变；设置按钮始终 icon-only |

### 13.3 验证记录

- 通过：`npm run check:types`、`npm run check:lint`、`npm run test:update`（15）、`npm run test:ui-smoke`（3）、`npm run test:tools`（25）、`npm run check:architecture`、`npm run check:naming`、`npm run check:quiet-pro-style-debt`。
- 通过：`npm test`（包含 replay）、`npm run test:ui-browser-smoke`（91 个真实浏览器场景）与 `npm run build`；浏览器报告保持 0 blank frame。
- `npm run test:ui-browser-smoke` 与 `npm run build` 在沙箱内首次受 Vite/native 子进程 `EPERM` 限制，按允许的相同命令重跑后通过。
- 当前共享工作区 aggregate 的 `npm run check:bundle` 仍被 3% headroom 阻断：initial localization `7.19 / 7.4 KiB`、WidgetShell `6.04 / 6 KiB`、zh-CN `9.64 / 9.9 KiB`、en-US `9.16 / 9.4 KiB`。本任务删除两个无消费者 Tooltip key 后 initial localization 已从 `7.21` 降到 `7.19 KiB`；未越界改并行 widget/locale 实现，也未放宽预算。
- 未运行 `npm run perf:stable`：本任务没有触及性能规则指定的导航 handler、preload、view handoff 或 read model。

### 13.4 对抗式审查结果

- 删除了没有消费者的空组件 class，避免无效局部约定。
- 增加 icons 与 labeled 两个方向的首次稳定帧恢复断言，防止 reload 闪回错误模式。
- 增加回切后的完整几何复测、active DOM identity、可见 label/icon 的 accessible-name 去重断言。
- 增加真实 CDP Tab 序列：焦点依次经过七个导航入口，随后到达底部 Menu；Space、Enter、Escape 与焦点保持均通过。
- 修复 locale 测试竞态：恢复浅色后等待英文导航资源就绪。
- 把 Tools/update 从 footer 搬到标题栏后，检查无状态、单状态、三状态、动态出现/消失、最小宽度、键盘顺序和点击目标；feature owner 与运行逻辑未迁入标题栏。
- 增加最小窗口极值断言：更新紧随品牌、Tools 紧邻窗口控制、标题栏保留 `>= 24px` 拖拽区，footer 只含 Menu。
- 增加真实鼠标 hover 反例：状态组始终透明无框，只有目标按钮获得 Quiet Pro elevated 背景且边框仍透明。
- 删除 Menu 已禁用 Tooltip 对应的两个无消费者 i18n key，并重新生成契约；减少无效文案和 bundle 占用。
- 同步当前共享 Tools snapshot 新增的必填 fixture 字段，使标题栏三状态极值测试与并行合同共存；未修改任务栏业务实现。
- 结论：未发现仍需修正的侧栏产品缺陷；停止信号均未命中。

### 13.5 必要偏差

- 结构合同没有放进 Node SSR：`AppSidebar` 依赖 Vite 图片资源，强行建立测试专用加载壳会降低可信度；改由真实浏览器 DOM 提供更强证据。
- 英文最长名称场景放在 `localeScenarios.ts`，而非计划草案中的 `settingsScenarios.ts`，因为其 owner 是 locale/布局矩阵。
- 手工视觉检查的受控浏览器实际视口由 in-app browser 决定；精确 `1100 × 736` 与 `900 × 636` 尺寸由 CDP device metrics 自动化补足。
- 没有形成需要进入长期母文档的新 shared component 合同，因此未改写 `docs/quiet-pro-component-guidelines.md`。

### 13.6 live Project 完成建议

- 归档前复读结果仍为：本事项 `Next`、任务栏事项 `Next`、多语言事项 `Blocked`、Tools 提醒与灵动视效均为 `Queued`，且没有 `In progress`。
- 维护者应拖动：`支持侧边导航在图标与文字模式间切换`：`Next → Done`。
- 保留：`增加任务栏追踪与工具状态视口` 为 `Next`。
- 补位：`完善 Tools 到期的 Patina 提醒弹窗`：`Queued → Next`；`复测并收口灵动视效`：`Queued → Next`。
- `规范化前端与原生多语言文案系统` 保持 `Blocked`；未自动关闭、重开或修改任何 Issue。
