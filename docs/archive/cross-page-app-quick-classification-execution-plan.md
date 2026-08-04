# 跨页面应用快捷分类与改名执行方案

> 文档类型：How-to / 可执行实施方案
>
> 状态：已完成，已验证，已归档
>
> 创建日期：2026-08-04
>
> 完成日期：2026-08-04
>
> 对应事项：GitHub Project「在 Dashboard 和 History 快捷设置分类与别名」
>
> 当前 Project 状态：`In progress`；状态移动由维护者在 Board 中手动完成
>
> 前置成果：Dashboard / Today 第一阶段已经完成并记录于 `docs/archive/today-app-quick-classification-execution-plan.md`
>
> 本文目标：把已验证的应用快捷分类与改名能力扩展到 Dashboard、History 和 Data 中所有符合条件的应用详情图标，同时把当前 Dashboard 私有接线整理为与 Destination 详情弹窗一致的“共享 Entry + 共享 launcher + 页面薄适配”结构

---

## 1. 执行目标

用户在查看应用统计上下文时，应能直接从应用图标完成两类高频修正：

1. 更改 Patina 中显示的应用名称。
2. 设置、变更或清除应用分类。

这项能力不能要求用户离开当前页面进入完整 Classification 管理页，也不能破坏图标现有的详情入口、列表选择、滚动、键盘操作或焦点恢复。

最终覆盖范围：

- [x] Dashboard / Today 应用排行图标已有可用试水实现。
- [x] Dashboard 迁移到共享 launcher，外观与行为保持不变。
- [x] History「当日分布」应用模式中的应用图标接入快捷操作。
- [x] Data 应用趋势左侧列表中的应用图标接入快捷操作。
- [x] Data 顶部“已选择应用”图标接入快捷操作。
- [x] 所有接入点继续保留原有双击详情行为。
- [x] 所有可见应用名称位置统一使用共享“未分类”状态组件。
- [x] 菜单、分类子菜单、改名 Dialog、Badge 视觉和交互状态机只有一个 owner。

### 1.1 用户可感知的完成结果

- [x] 左键双击应用图标仍打开原有详情弹窗。
- [x] `Enter` 仍打开原有详情弹窗。
- [x] 右键应用图标打开“更改名称 / 设置分类或更改分类”菜单。
- [x] `ContextMenu` 或 `Shift+F10` 打开同一菜单。
- [x] 分类子菜单只有在点击分类操作或使用明确键盘指令后才出现。
- [x] 分类列表可滚动，滚轮不会导致菜单消失。
- [x] 未分类应用在存在可见名称的列表中显示统一普通 Badge；Badge 高度和内部字号按所在名称行的实际字号、行高与密度适配，不能把 Dashboard 的尺寸原样套到 History 或 Data。
- [x] 保存后当前页面及其他核心页面立即显示一致结果。
- [x] 悬停不出现浏览器或 WebView 原生悬浮提示。

---

## 2. 范围边界

### 2.1 本阶段包含

- 应用名称 override 的快捷编辑。
- 应用分类 override 的快捷编辑和清除。
- Dashboard、History、Data 的应用图标入口。
- 应用未分类状态的共享展示组件。
- 菜单懒加载、打开、关闭、定位、焦点恢复和保存反馈。
- 保存后的映射版本更新、读模型失效和相关缓存清理。
- 鼠标、键盘、滚轮、窄窗口、浅色和深色模式验证。
- 对当前 Dashboard 实现做无行为变化的 owner 重构。

### 2.2 本阶段不包含

- [x] 不为网页域名提供应用分类或应用改名菜单。
- [x] 不为分类汇总色点提供快捷菜单。
- [x] 不为图表空白区域、应用整行或卡片容器提供右键菜单。
- [x] 不把 Dashboard、History 或 Data 改造成完整分类管理页。
- [x] 不重做分类数据模型、分类管理 Dialog 或 App Mapping 页面。
- [x] 不新增团队、云端或跨设备分类能力。
- [x] 不改变双击详情弹窗的内容、查询协议或视觉。
- [x] 不在图标上叠加强警告点、红色状态或新的页面私有装饰。
- [x] 不创建新的全局 AppShell Provider，除非执行中出现现有 launcher 模式无法解决且经过重新确认的硬阻塞。

### 2.3 接入资格

一个目标只有同时满足以下条件，才允许接入快捷应用操作：

- [x] 目标语义是 `app`，不是 `web` 或 `category`。
- [x] 能提供唯一、明确、非空的 `exeName`。
- [x] 能提供当前有效显示名称。
- [x] 能解析当前分类和未分类状态。
- [x] 触发区域是已经承担应用详情能力的图标。
- [x] 页面能在保存后进入统一映射刷新链路。

无法明确 executable 的聚合目标必须保持不可编辑，不能猜测、批量写入或借用 `identityKeys` 作为写入目标。

---

## 3. 第一性原理

### 3.1 一个图标可以承载多种输入意图，但每种意图必须可判定

应用图标同时承担详情和快捷修正并不矛盾，前提是输入协议明确：

| 输入 | 唯一结果 |
| --- | --- |
| 左键单击 | 保留页面原有语义；Dashboard / History 不执行动作，Data 继续执行选择语义 |
| 左键双击 | 打开应用详情 |
| `Enter` | 打开应用详情 |
| 右键 | 打开应用快捷菜单 |
| `ContextMenu` / `Shift+F10` | 打开应用快捷菜单 |
| `Escape` | 关闭当前最上层菜单或 Dialog |

- [x] 右键路径必须 `preventDefault()`，不出现系统或 WebView 默认菜单。
- [x] Data 的右键路径必须阻止行选择副作用。
- [x] 详情预加载只响应主按钮；右键 `mousedown` 不得准备详情请求。
- [x] 菜单打开不得自动打开分类子菜单。

### 3.2 业务身份、展示身份和详情查询身份必须分离

三个概念不能混用：

- `exeName`：应用分类和别名写入的唯一身份。
- `key`：当前详情对象或数据列表对象的主标识。
- `identityKeys`：详情读模型筛选底层活动记录时使用的一组查询键。

详情弹窗即使拥有多个 `identityKeys`，仍只展示一个逻辑应用或网页。快捷分类写入始终针对一个明确 `exeName`，不遍历、不批量修改 `identityKeys`。

- [x] Data 应用选项暴露显式 executable 字段。
- [x] 不使用 `secondaryText`、显示名称或图标 URL 猜测 executable。
- [x] 网页选项不携带应用快捷分类目标。

### 3.3 UI 只有一个 owner

以下 UI 和状态只能由 `classification` feature 拥有：

- 根菜单。
- 分类子菜单。
- 改名 Dialog。
- “未分类”Badge 的文字、尺寸、字重、字色和语义。
- 菜单定位、滚动、关闭和键盘导航。
- 保存中、错误和焦点恢复状态。

页面只能负责：

- 把页面数据映射为公开目标。
- 决定哪个现有图标可以触发。
- 保留页面自己的单击、双击和选择语义。
- 挂载共享 Entry。

- [x] 页面不得复制 `.quick-app-menu`、改名 Dialog 或分类选项 JSX。
- [x] 页面不得新增私有 Badge 颜色、字号、圆角或阴影。
- [x] 页面只能向共享状态组件声明语义密度，不能传入任意像素尺寸或页面名作为视觉分支。
- [x] 页面不得自行加载分类目录或直接拼装 override patch。

### 3.4 页面特有交互不能被伪装成通用 UI

不能为了“复用”创建一个强制所有页面使用相同 DOM 的万能图标组件：

- Dashboard 图标本身是独立按钮。
- History 图标是紧凑分布行内的独立按钮。
- Data 左侧列表的图标位于可选择的整行按钮内。
- Data 顶部已选图标是独立按钮。

因此共享边界应是 launcher、Entry、目标协议和状态组件，而不是强迫四种表面共用一套图标布局。

### 3.5 保存成功必须成为单一事实

保存完成后，用户不应看到一个页面已更新、另一个页面仍保留旧名称或旧分类。

- [x] 保存写入继续通过 ClassificationService 的既有 typed 边界。
- [x] 保存后统一触发 `mappingVersion` 更新。
- [x] 清理依赖映射的 Dashboard、History、Data 和 Tools 缓存。
- [x] 当前页面立即重算名称、分类、颜色和未分类状态。
- [x] 成功反馈只产生一次 Toast。
- [x] 失败时保留原值，不提前提交错误的乐观状态。

---

## 4. 当前实现基线

### 4.1 Destination 详情能力的既有抽象

现有详情弹窗已经证明以下分层适合 Patina：

1. `features/destination/types.ts` 定义统一详情目标。
2. `features/destination/hooks/useDestinationDetailLauncher.ts` 负责准备、打开、关闭和焦点恢复。
3. `features/destination/components/DestinationDetailDialogEntry.tsx` 负责唯一懒加载入口。
4. Dashboard、History、Data 保留各自的页面适配。

- [x] 详情弹窗 UI 只有一个 owner。
- [x] 页面没有复制详情弹窗。
- [x] Data 能在共享 launcher 之上保留选择和滚动恢复逻辑。
- [x] History 能在共享 launcher 之上注入日期和网页可用性逻辑。

本任务应复用这种边界，而不是把快捷菜单提升成新的全局 Provider。

### 4.2 Dashboard 当前试水实现

当前 Dashboard 已验证：

- [x] 图标右键打开根菜单。
- [x] 根菜单为纯文字，不包含装饰图标、箭头或省略号。
- [x] 已分类显示“更改分类”，未分类显示“设置分类”。
- [x] 分类子菜单点击后出现。
- [x] 分类列表滚轮不会导致菜单消失。
- [x] 改名 Dialog 已收敛为 Quiet Pro 紧凑规格。
- [x] “未分类”Badge 位于应用名称旁并使用普通规范。
- [x] 没有原生 `title` 悬浮提示。
- [x] 真实浏览器测试覆盖当前入口。

当前问题不是能力不可用，而是 Dashboard 仍直接拥有：

- `quickActionTarget` 页面状态。
- 懒加载函数。
- 坐标和焦点恢复接线。
- Entry 挂载代码。
- 局部 optimistic override 协调。

这些职责需要先被整理为公开 launcher，再扩展到其他页面。

### 4.3 History 接入点

History「当日分布」包含三种模式：应用、分类、网页。

- [x] 应用图标已经支持双击详情和 `Enter`。
- [x] 网页图标已经支持网页详情。
- [x] 分类模式使用色点而不是应用详情图标。
- [x] 只有 `item.kind === "app"` 的图标接入快捷应用操作。
- [x] 网页图标和分类色点保持现状。

### 4.4 Data 接入点

Data 应用趋势包含两个可见图标入口：

1. 左侧应用列表行内图标。
2. 顶部已选择应用图标。

- [x] 两处图标都支持双击详情。
- [x] 左侧整行单击承担选择语义。
- [x] Data 可在应用和网页模式之间切换。
- [x] 只有应用模式接入快捷应用操作。
- [x] 右键图标不得改变当前选择集合。
- [x] 顶部图标与左侧图标使用同一快捷菜单 owner。

---

## 5. 目标架构

```text
classification feature
├─ types.ts
│  ├─ QuickAppClassificationTarget
│  └─ QuickAppClassificationOpenRequest
├─ hooks/
│  └─ useQuickAppClassificationLauncher.ts
├─ components/
│  ├─ QuickAppClassificationEntry.tsx
│  ├─ QuickAppClassificationSurface.tsx
│  └─ QuickAppClassificationStatus.tsx
└─ services/
   ├─ classificationService.ts
   └─ quickAppClassification.ts

Dashboard / History / Data
├─ 构造 QuickAppClassificationTarget
├─ 把右键和键盘菜单事件交给 launcher
├─ 保留各自详情和选择语义
└─ 在页面根部挂载同一个 Entry
```

### 5.1 公开业务目标

建议契约：

```ts
interface QuickAppClassificationTarget {
  exeName: string;
  displayName: string;
  category: AppCategory;
}
```

- [x] `exeName` 在构造时 trim 并验证非空。
- [x] `displayName` 为空时回退到 executable，而不是把空文本传入 UI。
- [x] `category` 使用当前有效映射结果。
- [x] 目标中不保存鼠标坐标或 DOM 元素。

### 5.2 打开请求

建议契约：

```ts
interface QuickAppClassificationOpenRequest {
  target: QuickAppClassificationTarget;
  anchor: { clientX: number; clientY: number };
  returnFocusTo: HTMLElement | null;
}
```

业务目标与 UI 位置分开，确保后续可以从鼠标或键盘打开同一个菜单。

- [x] 鼠标右键使用事件坐标。
- [x] 键盘打开使用图标边界中心或稳定边缘锚点。
- [x] 关闭时默认把焦点还给 `returnFocusTo`。
- [x] Tab 从菜单离开时允许 Entry 提供相邻页面焦点作为覆盖目标。

### 5.3 共享 launcher

`useQuickAppClassificationLauncher` 应负责：

- 当前 active request。
- 预加载共享 Entry 模块。
- 从指针坐标打开。
- 从元素几何打开。
- 关闭与焦点恢复。
- 保存成功后的统一回调转发。
- 页面卸载或作用域切换时清理活动菜单。

建议公开能力：

```ts
{
  request,
  preload,
  openAtPointer,
  openAtElement,
  close,
}
```

- [x] launcher 不读取页面私有数据。
- [x] launcher 不直接处理 Data 选择状态。
- [x] launcher 不包含菜单 JSX。
- [x] launcher 关闭流程只执行一次焦点恢复。
- [x] Strict Mode 下没有重复监听或重复保存。

### 5.4 唯一懒加载 Entry

当前组件应拆成：

- `QuickAppClassificationSurface.tsx`：菜单、分类子菜单、改名 Dialog 和内部状态。
- `QuickAppClassificationEntry.tsx`：模块缓存、`lazy`、`Suspense` 和公开 preload。

- [x] 页面只 import Entry 和 launcher 的公开入口。
- [x] 页面不再自行声明动态 import。
- [x] 加载 fallback 保持 `null`，右键第一帧不出现临时 loading 文案。
- [x] 模块加载失败可再次尝试，不永久缓存 rejected Promise。

### 5.5 共享未分类状态组件

新增 `QuickAppClassificationStatus`，内部复用 `QuietBadge`：

- 文案从统一 copy owner 读取。
- 颜色和强调层级统一使用普通 neutral 语义。
- 接受 `density: "standard" | "dense"` 这类语义密度，不接受 `dashboard`、`history`、`data` 等页面名。
- `standard` 匹配 Dashboard 与 Data 实测为 18px 的应用名称行；`dense` 匹配 History 实测为 14px 的紧凑名称行。
- 每种密度的高度、横向 padding、内部字号、字重和行高只在共享组件或 QuietBadge 设计系统中定义。
- Badge 的外框高度应与所在名称行的 computed line-height 视觉匹配；验收以真实计算尺寸为准，不以固定截图像素猜测。
- 如果现有 `QuietBadge` 的 `regular` / `compact` 无法同时满足名称行匹配和普通字重，扩展一个新的共享语义规格；不得在页面 CSS 中覆盖 `.qp-badge`。
- 不接受页面自定义颜色、阴影、字号、字重或任意像素高度。
- 已分类时返回 `null`。

- [x] Dashboard 改用该组件。
- [x] Dashboard 使用 `standard` 密度，并验证 Badge 与 `text-sm` 名称行协调。
- [x] History 应用名称旁使用 `dense` 密度，并验证 Badge 不高于紧凑名称行的可接受视觉边界。
- [x] Data 左侧应用名称旁使用 `standard` 密度，并验证 Badge 不改变列表行高；真实浏览器计算尺寸表明 Data 名称行不是 History 式紧凑行。
- [x] Data 顶部纯图标区域不叠加新的视觉 Badge；其对应名称在列表中承担状态展示。
- [x] 无 `title`，不制造原生悬浮窗。

---

## 6. 文件级变更清单

### 6.1 Classification owner

- [x] 新增 `src/features/classification/types.ts`，承载公开快捷目标和打开请求。
- [x] 新增 `src/features/classification/hooks/useQuickAppClassificationLauncher.ts`。
- [x] 将当前 UI 主体移入 `src/features/classification/components/QuickAppClassificationSurface.tsx`。
- [x] 将 `QuickAppClassificationEntry.tsx` 收敛为唯一 lazy Entry。
- [x] 新增 `src/features/classification/components/QuickAppClassificationStatus.tsx`。
- [x] 若现有 Badge 两档尺寸无法满足三处名称行，扩展 `QuietBadge` 的共享语义尺寸及 `src/styles/quiet-pro.css`；不得添加页面私有 Badge 尺寸规则。
- [x] 保留 `src/features/classification/services/quickAppClassification.ts` 作为纯业务构造 owner。
- [x] 保留 `classificationService.ts` 作为加载和保存边界。
- [x] 清理已不再使用的页面私有 target 类型和动态 import。

### 6.2 AppShell 协调

- [x] 复用 `handleMappingOverridesChanged` 作为保存成功后的统一刷新入口。
- [x] 复用 `handleQuickActionError` 作为统一错误 Toast 入口。
- [x] 向 History 传递保存完成与错误回调。
- [x] 向 Data 传递保存完成回调；错误反馈优先复用 Data 已有 Toast 能力或统一回调，避免双 Toast。
- [x] 不在 AppShell 中渲染菜单或保存菜单坐标。

### 6.3 Dashboard

- [x] 删除页面私有 `quickActionTarget` 状态。
- [x] 删除页面私有 lazy import 函数。
- [x] 使用 launcher 的 `preload`、`openAtPointer`、`openAtElement`。
- [x] 保留现有双击详情的 `prepareDetail/openDetail`。
- [x] 评估并移除 `quickOverrides`；只有在 mappingVersion 无法保证同帧一致时才保留页面展示缓存。
- [x] 用共享状态组件替换直接 `QuietBadge` JSX。
- [x] 页面底部只挂载一个共享 Entry。
- [x] 迁移后截图和浏览器行为与迁移前一致。

### 6.4 History

- [x] `HistoryDayDistributionItem` 明确携带 app 快捷目标所需信息，或由上层构造完整目标。
- [x] `appDistributionItems` 使用当前映射后的显示名称、分类和 executable。
- [x] `HistoryDayDistributionPanel` 新增窄的快捷菜单回调，不 import ClassificationService。
- [x] 仅 app 图标处理 `onContextMenu`。
- [x] app 图标补充 `ContextMenu` / `Shift+F10` 键盘入口。
- [x] `aria-keyshortcuts` 同时表达 `Enter` 和快捷菜单键盘入口。
- [x] 网页图标继续只提供网页详情。
- [x] 分类模式继续只显示色点。
- [x] 在 History 页面根部挂载一个共享 Entry。
- [x] 在应用名称旁以 `dense` 密度渲染共享未分类状态组件。

### 6.5 Data 数据契约

- [x] 为应用趋势选项增加显式 `exeName` 或等价的 `classificationTarget` 字段。
- [x] 应用 option 从 view model 的 `app.exeName` 填充该字段。
- [x] 网页 option 明确不提供该字段。
- [x] 不能从 `identityKeys`、`secondaryText` 或 `displayName` 推断写入目标。
- [x] 如果 executable 缺失，图标保留详情能力但不提供快捷分类。
- [x] session selection state 克隆和恢复新增字段时不丢失数据。

### 6.6 Data UI 接线

- [x] 左侧列表只在事件目标命中 `[data-destination-detail-trigger]` 图标区域时处理右键。
- [x] 右键必须阻止整行 `onClick` 选择变化。
- [x] `mousedown` 详情准备增加主按钮检查，右键不准备详情。
- [x] 顶部已选图标直接接入指针和键盘菜单事件。
- [x] 应用模式提供快捷目标，网页模式不提供。
- [x] 左侧应用名称旁使用共享未分类状态组件的 `standard` 密度，且不改变原有列表行高。
- [x] 顶部纯图标区域不创建新的原生 tooltip 或页面私有状态点。
- [x] 在 Data 页面根部挂载一个共享 Entry。
- [x] 菜单关闭后焦点回到原图标，Data 选择和列表滚动保持不变。

### 6.7 样式与 copy

- [x] 快捷菜单样式继续只由 `src/styles/features/classification.css` 拥有。
- [x] History 和 Data 不新增 `.quick-app-menu*` 规则。
- [x] Badge 视觉通过共享状态组件和 QuietBadge 设计系统实现；不同名称行只选择语义密度，不编写页面私有尺寸覆盖。
- [x] 中文和英文快捷菜单文案保持键结构一致。
- [x] 不重新加入图标、右箭头或省略号。
- [x] 不重新加入已删除的改名说明句。
- [x] 不硬编码新的颜色、圆角、边框或阴影。

---

## 7. 分阶段执行步骤

## 阶段 A：锁定基线

目标：重构前先证明当前 Dashboard 和详情行为是什么，避免把已有缺陷与新回归混在一起。

- [x] 运行 `git status --short`，记录并保护所有现有用户改动。
- [x] 运行 `git diff --check`，确保开始时没有空白错误。
- [x] 运行当前 `npm run check:types`。
- [x] 运行当前 `npm run check:lint`。
- [x] 运行当前 `npm run test:ui-smoke`。
- [x] 运行当前 `npm run test:ui-browser-smoke`。
- [x] 记录 Dashboard 右键菜单的尺寸、文案和交互断言。
- [x] 记录 History 应用/网页图标的双击与键盘详情行为。
- [x] 记录 Data 左侧行选择、图标双击、顶部图标双击和滚动恢复行为。

退出条件：

- [x] 当前基线全部通过，或已有失败已被明确记录且与本任务分离。

## 阶段 B：先写目标协议与 launcher 测试

目标：在移动 UI 前锁定新的 owner 边界。

- [x] 为 target 规范化写测试：trim executable、空显示名回退、分类保留。
- [x] 为指针打开请求写测试：坐标、目标、焦点元素完整保存。
- [x] 为键盘打开请求写测试：从元素边界计算稳定锚点。
- [x] 为关闭写测试：默认恢复原图标焦点。
- [x] 为 Tab 离开写测试：允许覆盖默认焦点目标。
- [x] 为重复 close 写测试：不重复回调、不重复 focus。
- [x] 为 preload rejection 写测试：下一次可重试加载。
- [x] 确认 launcher 不 import Dashboard、History 或 Data。

退出条件：

- [x] 目标协议、launcher、懒加载恢复与焦点行为均有回归证据，且实现后全部通过。

## 阶段 C：建立共享 Entry 与 Surface

目标：让菜单 UI 和生命周期拥有与 Destination 相同的公共入口。

- [x] 将当前菜单/子菜单/改名 Dialog 的 JSX 原样迁移到 Surface。
- [x] 保留已验证的点击后展开分类行为。
- [x] 保留滚轮、外部滚动、外部点击和 Escape 规则。
- [x] 保留菜单第一帧稳定文案，不重新引入加载闪烁。
- [x] Entry 使用模块级 Promise 缓存和 rejected Promise 重置。
- [x] Entry 使用 `Suspense fallback={null}`。
- [x] launcher 集中处理关闭后的焦点恢复。
- [x] Surface 只通过回调报告保存结果和错误。
- [x] 删除 Surface 对页面结构的任何查询或假设，Tab 相邻焦点算法除外且需有测试。

退出条件：

- [x] Classification feature 内只有一个菜单 Surface 和一个 lazy Entry。

## 阶段 D：迁移 Dashboard，证明抽象无回归

目标：在扩展到新页面前，用已验证页面证明抽象正确。

- [x] 用共享 launcher 替换 `quickActionTarget`。
- [x] 用 Entry 公开 preload 替换 Dashboard 私有动态 import。
- [x] 把指针和键盘打开交给 launcher。
- [x] 保持详情双击路径完全独立。
- [x] 用共享状态组件替换页面直接 Badge。
- [x] 保存后通过统一映射刷新更新 Dashboard。
- [x] 验证设置分类后 Badge 消失。
- [x] 验证选择未分类后 Badge 保持或重新出现。
- [x] 验证改名后名称立即更新。
- [x] 验证菜单宽度、纯文字和无原生 tooltip 未变化。

退出条件：

- [x] Dashboard、History、Data 的完整 77 项真实浏览器场景继续通过。
- [x] Dashboard 不再拥有菜单 UI、坐标状态或动态 import。

## 阶段 E：接入 History

目标：为 History 应用图标增加快捷修正，不影响网页和分类模式。

- [x] 在 History 上层为 app item 构造明确快捷目标。
- [x] 将当前显示名称和有效分类传入目标。
- [x] 在应用图标右键时打开共享菜单。
- [x] 在应用图标使用 `ContextMenu` / `Shift+F10` 时打开共享菜单。
- [x] 双击和 `Enter` 继续打开原有详情。
- [x] 单击继续不打开详情或菜单。
- [x] 网页模式右键保持无应用快捷菜单。
- [x] 分类模式没有伪应用入口。
- [x] 应用名称旁显示共享未分类状态。
- [x] 保存后当日分布名称、分类分布和详情标题保持一致。

退出条件：

- [x] History 三种模式的行为矩阵全部通过。

## 阶段 F：补齐 Data 明确身份

目标：先解决写入身份，再接 UI，杜绝通过展示字段猜测 executable。

- [x] 扩展 Data app option 的显式 executable 契约。
- [x] 更新所有 app option 构造路径。
- [x] 更新 session state clone/restore。
- [x] 更新相关类型测试和 fixture。
- [x] 证明 web option 没有 executable。
- [x] 证明详情 `identityKeys` 仍按原逻辑工作。
- [x] 证明快捷写入只使用唯一 executable。

退出条件：

- [x] Data 的详情查询身份与分类写入身份在类型层面可区分。

## 阶段 G：接入 Data 左侧应用列表

目标：不破坏整行选择语义地接入图标右键。

- [x] 仅图标命中时构造快捷目标。
- [x] 右键不改变单选或 Ctrl 多选结果。
- [x] 右键不改变趋势图 series。
- [x] 右键不改变列表 scrollTop。
- [x] 双击图标继续打开详情。
- [x] 双击名称、时长或行空白不误开详情。
- [x] `Enter` 和 `Space` 保留既有详情/选择区分。
- [x] `ContextMenu` / `Shift+F10` 在可聚焦行上打开当前应用菜单。
- [x] 应用名称旁显示共享未分类状态。
- [x] 网页模式不出现快捷应用菜单或应用 Badge。

退出条件：

- [x] Data 选择、详情和快捷分类三条链路互不污染。

## 阶段 H：接入 Data 顶部已选图标

目标：让第二种 Data 图标入口使用完全相同的菜单 owner。

- [x] 顶部应用图标右键打开共享菜单。
- [x] 顶部应用图标双击继续打开详情。
- [x] `Enter` 继续打开详情。
- [x] `ContextMenu` / `Shift+F10` 打开快捷菜单。
- [x] 关闭菜单后焦点回到顶部图标。
- [x] 保存后顶部图标的 accessible name 和列表名称同步更新。
- [x] 不在纯图标上叠加页面私有 Badge。
- [x] 不增加原生 `title`。

退出条件：

- [x] Data 两类图标共用同一个 Entry 和 launcher 实例。

## 阶段 I：统一刷新与错误恢复

目标：保证保存结果全局一致，失败不污染当前显示。

- [x] 分类保存成功只调用一次全局映射更新入口。
- [x] 改名保存成功只调用一次全局映射更新入口。
- [x] Dashboard、History、Data 读模型收到新的 mappingVersion。
- [x] 相关 Dashboard、History、Data、Tools 缓存按现有策略失效。
- [x] 当前打开页面不需要离开再回来才能看到结果。
- [x] 保存失败时菜单/Dialog 保留可恢复状态。
- [x] 保存失败不关闭并展示成功 Toast。
- [x] 分类目录加载失败保留明确失败文案，不显示错误的“设置分类”。
- [x] 连续快速操作不会让较旧结果覆盖较新结果。

退出条件：

- [x] 跨页面一致性和错误恢复测试全部通过。

## 阶段 J：完整验证

- [x] `npm run check:types`
- [x] `npm run check:lint`
- [x] `npm run check:architecture`
- [x] `npm run check:quiet-pro-style-debt`
- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run build`
- [x] `git diff --check`
- [x] 检查 bundle budget，没有因三个页面重复加载菜单模块而增长三份实现。
- [x] 检查中文和英文 copy key parity。
- [x] 检查浅色、深色和动态外观。
- [x] 检查默认窗口、窄窗口和系统缩放。

退出条件：

- [x] 默认前端验证门全部通过。
- [x] 没有通过放宽断言、删除真实加载或跳过场景伪造通过。

---

## 8. 自动化测试设计

### 8.1 纯逻辑测试

- [x] target 规范化。
- [x] 未分类判断：无 override。
- [x] 未分类判断：名称-only override。
- [x] 未分类判断：历史 `other`。
- [x] 未分类判断：已删除分类。
- [x] 分类保存保留名称、颜色、track 和 captureTitle。
- [x] 改名保存保留分类和其他 override。
- [x] Data app option 提供唯一 executable。
- [x] Data web option 不提供 executable。
- [x] `identityKeys` 不参与快捷写入。

### 8.2 UI 静态契约测试

- [x] 菜单 Surface 只在 Classification feature 定义一次。
- [x] Dashboard、History、Data 不包含菜单 JSX。
- [x] 三个页面不定义 `.quick-app-menu*` 样式。
- [x] 三个页面使用共享未分类状态组件。
- [x] Dashboard、History、Data 的调用点只传 `standard` / `dense` 等语义密度，没有任意像素或页面专属 className；Dashboard/Data 使用 `standard`，History 使用 `dense`。
- [x] 根菜单只包含“更改名称”和分类动作纯文字。
- [x] 根菜单没有装饰 SVG。
- [x] 改名 Dialog 没有已删除的说明句。
- [x] 所有快捷入口没有 `title` 属性。

### 8.3 真实浏览器矩阵

| 页面/模式 | 图标 | 双击详情 | 右键菜单 | 键盘菜单 | Badge |
| --- | --- | --- | --- | --- | --- |
| Dashboard | 排行应用 | [x] | [x] | [x] | [x] |
| History / 应用 | 当日分布应用 | [x] | [x] | [x] | [x] |
| History / 分类 | 分类色点 | 不适用 | [x] 不出现 | 不适用 | 不适用 |
| History / 网页 | 网页图标 | [x] 网页详情 | [x] 不出现应用菜单 | [x] 不出现应用菜单 | 不适用 |
| Data / 应用 | 左侧图标 | [x] | [x] | [x] | [x] |
| Data / 应用 | 顶部已选图标 | [x] | [x] | [x] | 由列表名称承担 |
| Data / 网页 | 左侧/顶部网页图标 | [x] 网页详情 | [x] 不出现应用菜单 | [x] 不出现应用菜单 | 不适用 |

每个右键场景还必须验证：

- [x] 第一帧直接显示最终动作文案，无加载闪烁。
- [x] 悬停分类动作只显示 hover，不打开子菜单。
- [x] 点击分类动作才打开子菜单。
- [x] 子菜单滚轮可以滚动且保持打开。
- [x] 背景页面滚动按既有契约关闭菜单。
- [x] 点击外部关闭。
- [x] Escape 逐层关闭。
- [x] 菜单不超出 viewport。
- [x] 关闭后焦点回到正确图标。
- [x] 保存期间不能重复提交。

### 8.4 Data 专项回归

- [x] 右键左侧图标前后选中 key 完全相同。
- [x] 右键顶部图标前后选中 key 完全相同。
- [x] 右键不会触发 detail `prepare`。
- [x] 双击仍能使用 prepared detail，性能不退化。
- [x] 菜单关闭前后列表 scrollTop 相同。
- [x] 详情关闭后的选择快照恢复仍正常。
- [x] Ctrl 多选后右键其中一项不会丢失其他选择。

---

## 9. Quiet Pro 验收

- [x] 根菜单保持 148px 左右的紧凑宽度，除非真实本地化文案证明需要 token 化调整。
- [x] 根菜单无图标、无小箭头、无省略号。
- [x] 分类子菜单保留当前选中项勾选，因为它表达状态而非装饰。
- [x] 菜单背景、边框、圆角和阴影继续使用现有语义 token。
- [x] 菜单不会因页面不同产生不同尺寸或字体。
- [x] Badge 与名称处于同一视觉行；颜色和强调层级统一，尺寸按 `standard` / `dense` 语义密度适配名称行。
- [x] 真实浏览器分别读取 Dashboard、History、Data 的名称 computed font-size / line-height 与 Badge 高度，证明 Badge 没有明显高于或压低名称行。
- [x] Dashboard 的较大名称、History 的紧凑名称和 Data 的 18px 名称行分别保存尺寸断言，不能只用 Dashboard 结果代表全部页面。
- [x] Badge 不使用 warning、danger 或红色强调。
- [x] Data 紧凑列表不会因 Badge 挤压时长列。
- [x] History 紧凑分布行不会因 Badge 挤压时长与百分比。
- [x] 聚焦态清晰但不比内容更响亮。
- [x] reduced motion 下没有依赖动画才能理解的状态。

---

## 10. 对抗式审查

完整实现与常规测试通过后，必须开启独立的对抗式审查。审查目标不是证明实现正确，而是主动寻找能推翻完成结论的反例。

### 10.1 架构攻击

- [x] 搜索 Dashboard、History、Data 是否仍有复制的菜单 JSX。
- [x] 搜索页面是否直接调用 ClassificationService。
- [x] 搜索页面是否硬编码“未分类”、菜单宽度或 Badge 样式。
- [x] 检查 launcher 是否反向依赖页面 feature。
- [x] 检查是否为了复用把页面私有选择逻辑塞入 Classification。
- [x] 检查是否新增不必要的 AppShell 全局状态。

### 10.2 事件攻击

- [x] 在 Data 图标上分别执行单击、双击、右键、Ctrl+单击和拖动，观察串扰。
- [x] 在菜单打开瞬间滚动鼠标滚轮。
- [x] 在子菜单滚动条上按下、拖动和释放。
- [x] 右键后立即左键双击同一图标。
- [x] 左键单击准备详情后，右键另一个图标。
- [x] 菜单打开时切换页面。
- [x] 菜单打开时窗口改变大小。
- [x] 菜单靠近四个 viewport 边缘打开。

### 10.3 身份攻击

- [x] executable 大小写不同。
- [x] executable 前后有空白。
- [x] 显示名称相同但 executable 不同。
- [x] Data 详情目标拥有多个 `identityKeys`。
- [x] 应用只有名称 override，没有分类 override。
- [x] 分类 override 指向已删除分类。
- [x] 网页目标伪装成有 secondaryText 的应用。
- [x] executable 缺失时确认不会猜测写入。

### 10.4 保存竞态攻击

- [x] 快速连续选择两个分类。
- [x] 保存分类过程中打开改名。
- [x] 保存过程中按 Escape。
- [x] 保存返回前切换页面。
- [x] 模拟保存失败并重试。
- [x] 模拟分类目录首次加载失败后再次打开。
- [x] 验证较旧异步结果不能覆盖较新目标。

### 10.5 焦点与可访问性攻击

- [x] 仅使用键盘完成打开、选择、保存和关闭。
- [x] Shift+Tab 从菜单第一项离开。
- [x] Tab 从菜单最后一项离开。
- [x] Dialog 关闭后回到原图标。
- [x] 原图标因筛选消失时关闭不会抛错。
- [x] `aria-haspopup`、`aria-expanded` 和 `aria-keyshortcuts` 与实际状态一致。
- [x] 屏幕阅读器名称不把详情和快捷菜单描述混成一个错误动作。

### 10.6 视觉攻击

- [x] 中文和英文文案不会撑破菜单。
- [x] Badge 不覆盖名称或时长。
- [x] 125%、150%、175%、200% 缩放下菜单仍在 viewport 内。
- [x] 浅色、深色和动态外观下边界清晰。
- [x] 快速右键没有旧内容闪烁。
- [x] 页面之间的菜单样式完全一致。

### 10.7 审查结论

- [x] 所有发现按 blocker / high / medium / low 分类。
- [x] blocker 和 high 必须修复并重新运行相关矩阵。
- [x] medium 若延期，必须记录 owner、影响和后续事项，不得静默忽略。
- [x] 审查完成后再次运行 `git diff --check` 和受影响测试。

---

## 11. 完成定义

只有同时满足以下条件，任务才能勾选完成：

- [x] Dashboard、History、Data 的全部目标图标均已接入。
- [x] 网页、分类色点和非图标区域没有错误接入。
- [x] 双击详情、Data 选择和快捷菜单互不干扰。
- [x] 菜单 UI、改名 Dialog、分类子菜单和 Badge 各只有一个 owner。
- [x] 页面只保留目标映射和事件适配。
- [x] Data 使用明确 executable，不通过展示字段猜测。
- [x] 保存结果跨页面立即一致。
- [x] 无原生 tooltip、闪烁、滚轮关闭或焦点丢失。
- [x] 自动化测试和默认前端验证门全部通过。
- [x] 对抗式审查完成，blocker/high 已清零。
- [x] 工作文档中的实际步骤和验收项已按证据勾选。
- [x] 文档从 `docs/working/` 移入 `docs/archive/`。
- [x] 归档文档记录完成日期、验证命令和任何经确认的实现偏差。

---

## 12. Project 与交付协作

### 12.1 开始执行

当前 Project 事项已经是 `In progress`，执行开始时不需要维护者再次移动。若实读 Project 与本文记录不同，应报告差异，不擅自修改状态。

### 12.2 完成时

本事项标题虽然写有 Dashboard 和 History，但当前确认范围已经包括 Data。完成全部验收后：

- [x] 向维护者报告将「在 Dashboard 和 History 快捷设置分类与别名」从 `In progress` 拖到 `Done`。
- [x] 根据 `docs/roadmap-and-prioritization.md` 重新计算 Next 窗口并一次报告所有必要拖动。
- [x] 不以本地文档勾选、commit 或测试通过代替 Project 的真实状态更新。

### 12.3 Git 边界

- [x] 本方案不自动授权创建分支。
- [x] 本方案不自动授权提交。
- [x] 本方案不自动授权 push。
- [x] 本方案不自动授权修改 Issue、标签或远端 Project 字段。
- [x] 若用户后续明确要求提交，先检查 staged stat 和 numstat，并按仓库规则保持提交可审查。

---

## 13. 执行完成记录

### 13.1 实现结果

- 完成日期：2026-08-04。
- 共享 owner：`classification` feature 统一拥有目标协议、launcher、lazy Entry、Surface、改名 Dialog、分类子菜单和未分类状态组件。
- 页面适配：Dashboard、History 应用模式、Data 应用列表和顶部已选应用图标均只保留目标映射及事件接线；网页、分类色点和非图标区域未接入。
- 行为保持：应用双击/`Enter` 详情、Data 行选择和多选、列表滚动、详情准备及关闭后的焦点恢复保持原契约。
- 刷新链路：保存继续走 ClassificationService typed 边界，更新 ProcessMapper 与 bootstrap，并经统一回调刷新 mappingVersion 及 Dashboard、History、Data、Tools 相关缓存。
- 实现偏差：Data 名称行的真实 computed font-size/line-height 为 18px，因此使用共享 `standard` Badge；History 14px 紧凑行使用 `dense`。两档尺寸仍只有共享组件 owner，页面没有像素覆盖。
- Bundle 归属：真实产物中的快捷分类 lazy chunk 名称为 `QuickAppClassificationSurface`；预算检查按实际 chunk 校验，并为 Data 现有 19.48 kB 产物保留 3% 余量，没有复制三份菜单实现。

### 13.2 验证证据

- `npm run check:types`：通过。
- `npm run check:lint`：通过。
- `npm run check:architecture`：通过。
- `npm run check:quiet-pro-style-debt`：通过。
- `npm run check:hotspots`：通过；AppShell 与 History 适配均未突破热点预算。
- `npm test`：最终完整复跑通过，包含 `test:replay`、classification、Data、UI smoke 等默认套件。
- `npm run test:ui-browser-smoke`：77 项真实浏览器场景全部通过，覆盖三个页面、滚轮、点击后子菜单、Badge 尺寸、焦点、选择与详情隔离。
- `npm run build`：通过。
- `npm run check:bundle`：通过；快捷分类 Surface 约 2.77 KiB，Data lazy chunk 约 18.89 KiB（预算统计口径）。
- `git diff --check`：通过。

### 13.3 对抗式审查结论

- `high`（已修复）：Badge 的未分类判断与菜单文案曾可能读取不同事实；现统一由当前有效分类决定，Data 显式传递 `classificationCategory`，不从 `identityKeys` 或展示字段推断。
- `medium`（已修复）：Data 左侧列表缺少快捷菜单预加载；已在图标区域的 pointer/focus 路径预加载，避免首次右键暂空。
- `medium`（已修复）：目标构造只 trim、未拒绝空 executable；现显式抛错并有回归测试。
- 架构攻击：页面未复制菜单 JSX、未直接调用 ClassificationService、未定义私有快捷菜单或 Badge 视觉，launcher 不反向依赖页面。
- 事件与身份攻击：右键不改 Data 选择、不准备详情，web/category 不误接入，多个 `identityKeys` 不参与写入；顶部已选图标专项回归通过。
- 最终严重度：`blocker = 0`、`high = 0`、未延期 `medium = 0`；没有静默遗留项。

### 13.4 Project 维护建议

- live Board 于 2026-08-04 复核：本事项仍在 `In progress`，`Next` 有 1 项，`Queued` 有 2 项。
- 维护者应将「在 Dashboard 和 History 快捷设置分类与别名」从 `In progress` 拖到 `Done`。
- 为把 Next 窗口补足至 3 项，应将「复测并收口灵动视效」和「完善 Tools 到期的 Patina 提醒弹窗」从 `Queued` 拖到 `Next`；「规范化前端与原生多语言文案系统」继续留在 `Next`。
- 本地勾选与归档不替代以上 live Project 手动移动。

本文已按实际实现修订，不再作为进行中的执行依据；完成勾选后移入 `docs/archive/`。
