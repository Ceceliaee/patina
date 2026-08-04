# Today 页面应用快捷分类与改名执行方案

> 状态：第一阶段已完成、已验证并归档（2026-08-03）

> 归档后交互修订（2026-08-04）：维护者实机反馈后，分类子菜单改为仅在点击分类操作或使用键盘操作时打开；普通指针悬停只显示 hover 状态。下文关于“悬停打开”的原始勾选保留为当时执行记录，不再代表当前产品契约。
> 同次修订将根菜单收敛为纯文字动作，移除装饰图标、分类箭头及“更改名称”的省略号。
>
> 创建日期：2026-08-03
>
> 完成日期：2026-08-03
>
> 对应事项：GitHub Project「在 Dashboard 和 History 快捷设置分类与别名」
>
> 当前 Project 状态：`In progress`（2026-08-03 只读复核）
>
> 本文范围：第一阶段试水，只在 Today / Dashboard 的应用排行提供快捷分类与改名
>
> 文档归宿：第一阶段完成并决定后续路线后，更新实际证据；不再作为当前执行依据时移至 `docs/archive/`

## 0. 执行结论与证据

- [x] Today / Dashboard 应用图标已支持右键和 `Shift+F10` 快捷菜单。
- [x] 根菜单包含“更改名称…”与“设置分类”；分类通过受控二级菜单呈现。
- [x] 未分类应用在占比后使用现有普通 `QuietBadge`，没有 `title` 或原生悬浮提示。
- [x] 分类和改名复用既有 override 持久化，字段级合并保留颜色、追踪和标题记录设置。
- [x] 保存成功后复用统一缓存失效与读模型刷新链，Today 提供即时乐观反馈。
- [x] `npm test`、`npm run test:replay` 和最终 `npm run check` 通过。
- [x] 最终真实浏览器 smoke：75/75 通过；critical mutation：14/14；bundle budget 通过。
- [x] 对抗式审查已完成，修复了别名 key 规范化、已删除分类 Badge、重复提交、加载失败空菜单、Tab 焦点交接和 ARIA 状态等边缘风险。
- [x] 2026-08-03 完成后只读复核 live Project：事项仍为唯一 `In progress`，`Next` 仍为「规范化前端与原生多语言文案系统」。
- [x] 第一阶段决策：Today 试水交付完成；History 扩展仍属于原 Project 后续范围，因此事项不提前进入 `Done`，无需拖动 `Next`。

实现偏差说明：沿用现有 Classification 语义，菜单中的“未分类”（底层历史 id 为 `other`）表示清除手动分类，选中后 Badge 继续显示；它不是一个“明确分类后隐藏 Badge”的独立分类。改名输入预填当前显示名称并全选，同时提供“恢复默认名称”。菜单与 Dialog 合并在一个 classification-owned 懒加载入口内，没有为了文件形态拆出额外 hook 或提前建立共享 Context Menu。

归档标记说明：`[x]` 表示已执行或已用自动化/代码证据验证；保留的 `[ ]` 表示明确未执行、不适用、History 后续、提交/推送或维护者人工签字事项，不属于本次已完成的 Today 第一阶段，且不在归档时倒签。

## 1. 如何使用本文档

本文档是第一阶段实现的可勾选执行单。实施者应按阶段推进，并用可复核证据替代主观完成判断。

- [x] 开始实施前，重新读取 live GitHub Project，确认事项仍为唯一主要 `In progress`，并记录当前 `Next` 窗口。
- [x] 开始每个阶段前，确认上一阶段退出条件已经满足。
- [x] 每完成一个步骤，立即勾选，并在相邻位置记录测试、截图、文件或命令证据。
- [x] 若代码现状与本文描述不一致，先修订本文，再继续实施。
- [x] 若实现需要新增跨层端口、Rust command、SQLite schema、兼容壳或无明确 owner 的共享抽象，停止实施并重新做边界判断；本次未触发。
- [x] 若第一阶段验收后决定改变交互方向，先记录结论，不把实验代码直接复制到 History、Data 或其他页面。
- [x] 第一阶段完成但原 Project 的 Dashboard + History 全范围尚未完成时，不建议把事项拖到 `Done`。
- [x] 全部工作结束后执行第 23 节对抗式审查和第 31 节归档检查。

## 2. 一句话问题定义

用户在 Today 页面看到名称不清或尚未明确分类的应用时，当前必须离开回看上下文进入 Classification 页面才能修正；第一阶段要在不增加常驻视觉噪音的前提下，为应用图标提供桌面式右键快捷操作，并用普通 Badge 标识真正未分类的应用。

## 3. 第一性原理

### 3.1 用户真正要完成的任务

用户不是要在 Today 页面“管理分类系统”，而是在看到具体应用时完成一次局部校正：

```text
发现名称或分类不准确
→ 指向这个应用
→ 修改名称或分类
→ 立即看到当前页面同步变化
→ 继续回看今天的数据
```

由此得到：

- [x] 快捷操作必须以具体应用为上下文，不要求再次搜索应用。
- [x] 完成修改后留在 Today 页面，不自动导航到 Classification。
- [x] 第一阶段只暴露“更改名称”和“设置分类”两个高频校正动作。
- [x] 完整分类管理继续由 Classification 页面承担。

### 3.2 最短路径不等于常驻按钮

Today 页面首先是回看页面。若每行长期显示编辑按钮，低频管理动作会与应用名称、时长和占比争夺注意力。

由此得到：

- [x] 使用右键图标作为熟练用户快捷入口。
- [x] 不在每张应用卡片上增加常驻的铅笔按钮或更多按钮。
- [x] 不把整行变成右键目标，只在应用图标范围拦截应用快捷菜单。
- [x] “未分类”状态使用已有普通 Badge 提醒，不使用危险色或页面私有警告样式。

### 3.3 右键入口必须仍然可发现、可访问

右键操作视觉噪音低，但天然不如可见按钮容易发现。可发现性和无障碍不能依赖原生悬浮提示。

由此得到：

- [x] 未分类应用显示可见的“未分类”普通 Badge，向用户说明该应用存在待校正状态。
- [x] Badge 只表达状态，不承担原生 Tooltip 或隐藏帮助文案。
- [x] 图标继续具有明确的无障碍名称，并支持键盘菜单键或 `Shift+F10`。
- [x] 不使用 HTML `title` 属性，不出现浏览器或系统原生悬浮窗。
- [x] 菜单项使用可见文本，不为自解释内容重复增加 Tooltip。

### 3.4 数据校正必须是可信事务

一个应用 override 可能同时包含分类、显示名称、颜色、排除统计和标题记录配置。快捷修改只能改变用户明确编辑的字段。

由此得到：

- [x] 每次保存先读取当前规范化 override，再做字段级合并。
- [x] 更改名称不能覆盖分类、颜色、`track`、`captureTitle` 或其他字段。
- [x] 设置分类不能覆盖名称、颜色、`track`、`captureTitle` 或其他字段。
- [x] 持久化成功后才更新前端运行时映射和页面读模型。
- [x] 持久化失败时不展示伪成功结果。

### 3.5 “未分类”是语义，不是颜色别名

现有 Classification 数据沿用历史 id `other` 表示“未分类/清除手动分类”。第一阶段必须服从这个既有契约，不能把它解释成一次有效的显式分类决定。

由此得到：

- [x] 没有可用的显式分类 override 时，应用属于“未分类”。
- [x] 用户选择“未分类”后清除手动分类，该应用继续显示 Badge。
- [x] 显式分类指向已删除或当前不可选分类时，应用重新视为未分类。
- [x] 名称、颜色、排除统计或标题记录 override 的存在，不能单独证明应用已分类。

### 3.6 第一阶段必须支持后续扩展，但不预建平台

方案未来会扩展到 History 和其他合适页面，但第一阶段的价值是验证交互，而不是提前建立全局右键菜单框架。

由此得到：

- [x] 快捷分类业务能力由 `classification` feature 拥有。
- [x] Today / Dashboard 只提供触发目标和页面刷新回调。
- [x] 第一阶段不因假想复用立即创建全局 `QuietContextMenu`。
- [x] 第二个真实页面消费者出现后，再判断菜单外壳是否具备进入 `shared/*` 的稳定条件。

## 4. 已确认的产品与交互决策

- [x] 第一阶段只在 Today / Dashboard 页面试水。
- [x] 入口位于应用排行每行的应用图标。
- [x] 左键不打开分类菜单。
- [x] 现有双击图标打开应用详情的行为保持不变。
- [x] 右键图标打开应用快捷菜单。
- [x] 根菜单包含“更改名称…”和“设置分类”两个入口。
- [x] “设置分类”通过悬停、点击或键盘右方向键打开子菜单。
- [x] 分类子菜单显示全部当前可选分类，当前显式分类带勾选状态。
- [x] 分类选择后立即持久化并关闭整组菜单。
- [x] “更改名称…”打开紧凑 Quiet Pro Dialog。
- [x] 名称保存后立即持久化并刷新当前页面。
- [x] 清空名称后保存表示恢复默认名称。
- [x] 真正未分类的应用在占比信息后显示普通“未分类”Badge。
- [x] Badge 使用现有规范，不新增 warning、danger 或页面私有变体。
- [x] 不使用 HTML `title`，悬停时不出现原生悬浮窗。

## 5. 第一阶段目标

- [x] 用户可在 Today 应用排行中右键任一应用图标打开快捷菜单。
- [x] 用户可在菜单中打开分类子菜单并设置一个现有分类。
- [x] 用户可选择“未分类”清除手动分类，保存后继续显示未分类 Badge。
- [x] 用户可通过“更改名称…”设置新别名。
- [x] 用户可清空别名并恢复应用默认显示名称。
- [x] 保存成功后，应用排行、专注分布、今日活动及依赖分类映射的当前页面内容一致更新。
- [x] 修改通过既有持久化路径保存并在应用重启后保留。
- [x] 修改单一字段时，现有其他 override 字段保持不变。
- [x] 鼠标、键盘、焦点恢复和窗口边缘定位均符合 Quiet Pro 交互契约。
- [x] 没有引入原生 Tooltip、HTML `title` 或新的视觉债务。

## 6. 明确非目标

- [x] 第一阶段不接入 History。
- [x] 第一阶段不接入 Data、Destination 详情弹窗、Widget 或系统托盘。
- [x] 第一阶段不支持网页域名快捷分类或改名。
- [x] 不在快捷菜单中设置应用颜色。
- [x] 不在快捷菜单中排除或恢复统计。
- [x] 不在快捷菜单中切换标题记录。
- [x] 不在快捷菜单中删除历史记录。
- [x] 不在快捷菜单中创建、重命名、删除分类或修改分类颜色。
- [x] 不重做分类数据模型、持久化格式或迁移策略。
- [x] 不新增 Rust command、SQLite 表、schema migration 或 capability。
- [x] 不改变现有应用详情入口的双击与 Enter 契约。
- [x] 不以第一阶段为理由复制一份 History 专用实现。

## 7. 必须始终成立的不变量

- [x] 应用 identity 始终使用规范化 executable key，不使用当前显示名称作为保存键。
- [x] 根菜单打开时只关联一个明确应用目标。
- [x] 子菜单选择始终写入该目标，不因列表刷新误写到其他行。
- [x] 单字段更新通过合并生成新 override，不丢失未编辑字段。
- [x] 用户选择“未分类”会删除手动 `category` 字段，并保留其他 override 字段。
- [x] 仅有名称、颜色、`track` 或 `captureTitle` override 的应用仍可被判定为未分类。
- [x] 已删除或不可选分类不出现在分类子菜单。
- [x] 保存成功前不更新 `ProcessMapper` 为新值。
- [x] 保存成功后运行时映射、缓存和读模型只触发一次一致刷新。
- [x] 保存失败时菜单或弹窗给出可理解反馈，且页面保持最后一次已持久化状态。
- [x] 同一目标的重复提交在进行中被禁用或合并，不产生竞态覆盖。
- [x] 菜单、子菜单和 Dialog 卸载后不遗留全局 listener、Portal 或定时器。
- [ ] 根菜单和子菜单不会超出窗口可视区域或产生横向滚动。
- [ ] 任何悬停状态都不依赖 HTML `title`。

## 8. 现有代码事实

### 8.1 Today / Dashboard

- [ ] 复核 `src/features/dashboard/components/Dashboard.tsx` 中应用排行卡片结构。
- [ ] 确认图标按钮当前通过双击与 Enter 打开 `destination` 应用详情。
- [ ] 确认 `topApplications` 提供稳定的 `exeName`、显示名称、颜色、时长和占比。
- [ ] 确认排行显示名称和分类色来自 `AppClassification` / `ProcessMapper` 映射。
- [ ] 确认 `mappingVersion` 已作为 Dashboard 读模型显式失效信号。

### 8.2 Classification

- [ ] 复核 `ClassificationService.saveAppOverride` 的持久化与运行时更新顺序。
- [ ] 复核 `ProcessMapper.getUserOverride`、`setUserOverride` 和 `mapApp` 的规范化语义。
- [ ] 复核 Classification 页面当前如何生成默认分类、自定义分类和已删除分类的选项集合。
- [ ] 复核应用改名时现有名称清理规则，避免快捷入口形成第二套语义。
- [ ] 复核 category label override 对分类菜单文案的影响。

### 8.3 AppShell 刷新协调

- [ ] 复核 `src/app/services/readModelRefreshState.ts` 中 mapping override 刷新规则。
- [ ] 复核 `AppShell.tsx` 中 Classification 页面保存后清理 Dashboard、History、Tools、Data 缓存的现有流程。
- [ ] 将该流程提取为薄的可复用应用级回调，或以不重复逻辑的方式供 Today 快捷编辑调用。
- [ ] 确认 `app/*` 只负责跨 feature 刷新协调，不承接菜单状态、表单校验或 override 合并规则。

### 8.4 Quiet Pro 组件

- [ ] 复核 `QuietDialog` 的初始焦点、焦点陷阱、Escape 和关闭后焦点恢复。
- [ ] 复核 `QuietButton`、`QuietBadge` 和 `QuietIconAction` 的现有语义与状态。
- [ ] 记录仓库当前没有稳定通用 Context Menu 组件这一事实。
- [ ] 第一阶段把菜单交互探索保留在 `classification` owner 内，不复制已有组件外观形成伪共享组件。

## 9. Owner 与架构落点

### 9.1 `features/classification`

负责快捷校正能力闭环：

- [ ] 定义快捷编辑目标类型，例如 executable key、当前源名称、当前图标和触发元素。
- [ ] 提供“是否显式分类”的纯判断。
- [ ] 提供当前可选分类列表的唯一构建逻辑。
- [ ] 提供字段级 override 合并函数。
- [ ] 提供分类保存和名称保存用例。
- [x] 拥有根菜单、分类子菜单、改名 Dialog 及其交互状态。
- [x] 拥有保存中、保存失败和重复提交防护。
- [x] 提供给来源页面的窄公开入口，不要求 Dashboard 了解 classification persistence。

### 9.2 `features/dashboard`

只负责 Today 页面入口和展示：

- [x] 在应用图标上接入 `onContextMenu`。
- [x] 保留现有详情打开行为。
- [x] 为快捷编辑器提供当前应用目标和触发元素。
- [x] 根据 classification 提供的语义判断显示普通“未分类”Badge。
- [x] 不直接调用 platform persistence、Tauri `invoke` 或 SQLite。
- [x] 不在 Dashboard 内复制 override 合并、分类选项或保存逻辑。

### 9.3 `app/*`

只负责保存后的跨 feature 协调：

- [x] 复用或抽取现有 mapping overrides 刷新回调。
- [x] 清理必要缓存并推进 `mappingVersion` / `dataRefreshTick`。
- [x] 发出一次成功 Toast。
- [x] 不保存菜单位置、不维护名称草稿、不判断未分类。

### 9.4 `shared/*`

- [x] 第一阶段不默认新增 `QuietContextMenu`。
- [x] 未扩展 `QuietDialog` 或按钮原型，复用既有能力。
- [x] 不把 classification 目标、override 或分类选项业务结构放进共享组件。
- [x] 若第二阶段产生第二个菜单消费者，再按 Quiet Pro 准入标准评估共享外壳。

### 9.5 `platform/*` 与 Rust

- [ ] 沿用现有 typed classification settings 写侧。
- [ ] 不新增前端底层 persistence gateway。
- [ ] 不修改 Rust command、repository、数据库 schema、capability 或 IPC manifest。
- [ ] 若现有 `saveAppOverride` 无法原子保存字段合并结果，停止并升级为边界判断，不在页面中绕过。

## 10. 建议的数据与状态契约

### 10.1 快捷编辑目标

建议由 classification feature 暴露最小目标：

```ts
interface QuickAppClassificationTarget {
  exeName: string;
  sourceDisplayName: string;
  iconUrl?: string | null;
}
```

执行要求：

- [ ] `exeName` 在入口建立时即使用现有规范化路径处理或在 service 边界规范化。
- [ ] `sourceDisplayName` 只用于默认名称、标题和回退展示，不作为 persistence key。
- [ ] 不把 Dashboard 的时长、占比、排行索引或卡片状态传入 classification owner。

### 10.2 字段级合并

建议集中提供纯函数：

```text
mergeQuickAppOverride(currentOverride, patch)
→ normalized override | null
```

其中 patch 只允许：

```ts
type QuickAppOverridePatch =
  | { category: UserAssignableAppCategory }
  | { displayName: string | null };
```

执行要求：

- [ ] 分类 patch 保留 `displayName`、`color`、`track`、`captureTitle` 和有效元数据。
- [ ] 名称 patch 保留 `category`、`color`、`track`、`captureTitle` 和有效元数据。
- [ ] 空名称删除 `displayName` 字段，而不是保存空字符串。
- [ ] 若删除字段后 override 不再包含任何有意义设置，返回 `null` 并删除持久化 override。
- [ ] 每次有效保存更新 `updatedAt`，并遵循现有 storage serializer 的规范化行为。

### 10.3 分类选项

分类选项必须与完整 Classification 页面一致：

- [ ] 包含未删除的内置可分配分类。
- [ ] 包含已持久化且仍有效的自定义分类。
- [ ] 包含当前有效 override 所引用的自定义分类。
- [ ] 使用当前 category label override 作为显示文本。
- [ ] 不包含 `system`。
- [ ] 不包含已删除分类。
- [x] 保持历史 `other` 的“未分类/清除手动分类”语义，不把它当作有效显式分类。
- [ ] 使用一个 classification feature 纯函数生成选项，避免与 `useAppMappingDerivedState` 形成两套排序规则。

### 10.4 未分类判断

建议集中提供：

```text
isAppExplicitlyClassified(exeName, availableCategories)
```

规则：

- [x] 无 override：未分类。
- [x] override 存在但没有 `category`：未分类。
- [x] override.category 为当前可用内置分类：已分类。
- [x] override.category 为当前可用自定义分类：已分类。
- [x] override.category 为历史 `other` 或没有 category：未分类。
- [x] override.category 指向已删除或非法分类：未分类。
- [x] 应用仅更改名称：仍未分类。
- [x] 应用仅更改颜色或记录设置：仍未分类。

## 11. 根菜单交互契约

### 11.1 打开

- [ ] 在应用图标 `contextmenu` 事件上阻止该目标范围内的原生菜单。
- [ ] 使用事件 `clientX / clientY` 作为首选锚点。
- [ ] 键盘通过菜单键或 `Shift+F10` 打开时，使用图标矩形生成稳定锚点。
- [ ] 打开前关闭其他快捷菜单、分类子菜单和未提交的临时菜单状态。
- [ ] 保存明确的触发元素，用于关闭后的焦点恢复。
- [ ] 根菜单打开后把焦点移到第一个可操作菜单项。

### 11.2 内容

- [ ] 可选的只读头部显示当前应用名称与 executable，且不进入菜单 roving tab stop。
- [ ] 第一项为“更改名称…”。
- [ ] 第二项为“设置分类”，带子菜单方向标识。
- [ ] 不使用 HTML `title`。
- [ ] 不为可见菜单文案重复增加 Tooltip。
- [ ] 不加入尚未实现的 disabled 占位操作。

### 11.3 键盘

- [ ] `ArrowDown / ArrowUp` 在根菜单项之间循环。
- [ ] `Home / End` 跳到首尾可操作项。
- [ ] `Enter / Space` 激活当前项。
- [ ] “设置分类”获得焦点时，`ArrowRight` 打开子菜单。
- [ ] `Escape` 关闭根菜单并恢复图标焦点。
- [ ] `Tab` 关闭菜单并按明确策略把焦点交给正常页面顺序，不把焦点困在无模态菜单。

### 11.4 关闭

- [ ] 点击菜单外部关闭。
- [ ] 页面滚动、窗口 resize、窗口失焦或路由切换时关闭。
- [ ] 选择分类后关闭整组菜单。
- [ ] 打开改名 Dialog 前先关闭菜单，Dialog 关闭后最终焦点返回原图标。
- [ ] 组件卸载时清理所有 window / document listener。

### 11.5 定位

- [ ] 根菜单与视口四边保持 Quiet Pro 统一安全间距。
- [ ] 右侧空间不足时向左收敛，不产生横向滚动。
- [ ] 下方空间不足时向上收敛。
- [ ] 长应用名称不扩大菜单到视口外。
- [ ] 菜单宽度使用稳定档位，不根据每个应用产生明显跳变。

## 12. 分类子菜单交互契约

### 12.1 打开方式

- [ ] 鼠标悬停“设置分类”时打开子菜单。
- [ ] 点击“设置分类”时打开或保持子菜单。
- [ ] 键盘 `ArrowRight` 打开子菜单。
- [ ] 悬停只打开受控 Quiet Pro 子菜单，不触发任何原生悬浮窗。
- [ ] 子菜单打开后，根菜单保持稳定，不因内容测量位移。

### 12.2 内容与状态

- [ ] 每个可选分类对应一个菜单项。
- [ ] 当前显式分类带勾选状态。
- [x] 未分类应用打开时勾选“未分类”项，准确表达当前状态。
- [ ] 分类 label 使用当前用户定义文案。
- [ ] 选项较多时设置最大高度并只让子菜单列表滚动。
- [ ] 保存中的目标分类显示忙碌或禁用状态，禁止重复提交。

### 12.3 键盘与焦点

- [ ] `ArrowDown / ArrowUp` 在分类项中循环。
- [ ] `Home / End` 跳到首尾分类。
- [ ] `Enter / Space` 选择当前分类。
- [ ] `ArrowLeft` 关闭子菜单并把焦点返回“设置分类”。
- [ ] 子菜单内 `Escape` 先关闭子菜单并返回根菜单；再次 `Escape` 关闭根菜单。
- [ ] 指针从根项移动到子菜单时保留打开状态，不出现可穿过的间隙。

### 12.4 定位

- [ ] 默认在根菜单右侧展开。
- [ ] 右侧空间不足时自动改为左侧展开。
- [ ] 上下位置与根项对齐，并夹紧到视口。
- [ ] 子菜单不覆盖根菜单当前项到无法理解层级。
- [ ] 任何定位计算都不依赖 HTML 原生 Tooltip。

## 13. 更改名称 Dialog 契约

- [ ] 使用现有 `QuietDialog` 作为稳定外壳。
- [ ] 标题为“更改应用名称”或 copy owner 中等价文案。
- [ ] 描述清楚说明“留空并保存将恢复默认名称”。
- [ ] 输入框预填当前显式别名；没有别名时可预填当前显示名称，但必须明确区分“源名称”和“用户别名”。
- [ ] 推荐优先预填当前显式别名；无别名时输入框为空，并以源名称作为 placeholder，避免用户误以为默认名称已被持久化。
- [ ] 打开后初始焦点进入输入框并选中文本。
- [ ] 输入值 trim 后保存。
- [ ] 空值允许提交，并表示删除 `displayName` override。
- [ ] 若 trim 后值与当前有效别名相同，直接关闭而不写数据库。
- [ ] 保存中禁用确认按钮和重复提交。
- [ ] 保存失败时保留输入内容，不自动关闭 Dialog。
- [ ] Escape 或取消不保存。
- [ ] 关闭后焦点返回原应用图标。
- [ ] 不复用当前强制非空的 `useQuietDialogs().prompt`，除非先以稳定可选参数扩展并补齐其既有消费者测试。

## 14. “未分类”Badge 契约

- [x] 使用现有普通 `QuietBadge` 默认 tone。
- [x] 文案从统一 copy owner 读取，中文为“未分类”。
- [x] 放在应用排行第二行“占比 xx%”之后。
- [x] Badge 不改变卡片固定高度或使时长列位移。
- [x] 小窗口或长名称下允许合理收缩，但不能覆盖时长和进度条。
- [x] Badge 不是 warning、danger 或 error。
- [x] Badge 不添加 HTML `title`。
- [x] Badge 不添加重复 QuietTooltip。
- [x] Badge 第一阶段只表达状态，不作为独立按钮或第二套菜单触发器。
- [x] 设置任意有效分类后立即消失。
- [x] 设置有效分类后 Badge 立即消失；选择“未分类”后 Badge 保持或重新出现。
- [x] 只改名称但仍无分类时继续显示。
- [x] 恢复或删除为无有效分类时重新显示。

## 15. 保存与刷新时序

目标分类保存时序：

```text
用户选择分类
→ 锁定当前目标与提交 generation
→ 读取当前规范化 override
→ 合并 category patch，保留其他字段
→ ClassificationService 持久化
→ 持久化成功后更新 ProcessMapper
→ 通知 AppShell 执行 mapping override 刷新
→ 清理相关快照缓存并增加 mappingVersion
→ Dashboard 重新计算排行、专注分布与今日活动
→ 显示成功 Toast
→ 关闭菜单并恢复焦点
```

目标名称保存时序：

```text
用户确认名称
→ 锁定当前目标与提交 generation
→ 读取当前规范化 override
→ 合并 displayName patch，保留其他字段
→ ClassificationService 持久化
→ 持久化成功后更新 ProcessMapper
→ 通知 AppShell 执行 mapping override 刷新
→ Dashboard 重新计算显示名称与相关聚合
→ 显示成功 Toast
→ 关闭 Dialog 并恢复焦点
```

执行清单：

- [ ] 保存用例以 executable key 和显式 patch 为输入。
- [ ] 保存开始时捕获目标 identity，列表重排不会改变写入目标。
- [ ] 同一编辑器一次只允许一个提交。
- [ ] 旧提交晚于新目标返回时不得错误关闭新目标菜单或 Dialog。
- [ ] 持久化失败不调用 mapping refresh callback。
- [ ] 持久化成功只调用一次 mapping refresh callback。
- [ ] 保存成功 Toast 使用统一 copy，不输出底层错误细节。
- [ ] 保存失败 Toast 或内联错误提供可重试语义，详细错误写入 console 供诊断。
- [ ] 刷新不清空页面为整块 loading，不丢失应用排行滚动位置。

## 16. 预计文件范围

### 16.1 预期新增或修改

- [x] `src/features/classification/components/QuickAppClassificationEntry.tsx`：按实际内聚关系统一拥有根菜单、分类子菜单、改名 Dialog 与交互状态。
- [x] 没有拆出无第二消费者的 page-local hook 或共享 Context Menu。
- [x] `src/features/classification/services/classificationService.ts`：公开窄的快捷保存能力，复用既有 store。
- [x] `src/features/classification/services/quickAppClassification.ts`：纯判断、分类选项与 override patch 合并。
- [x] `src/features/dashboard/components/Dashboard.tsx`：右键入口和未分类 Badge。
- [x] `src/app/AppShell.tsx`：向 Dashboard 传递薄的 mapping 保存完成回调，并消除刷新逻辑重复。
- [x] `src/shared/copy/domains/mappingCopy.ts`：菜单、Dialog、Badge、Toast 和 accessibility 文案。
- [x] `src/styles/features/classification.css`：菜单与 Dialog 局部结构和状态。
- [x] `src/styles/features/dashboard.css`：Badge 排列和图标入口状态。
- [x] `tests/classificationDraftState.test.ts`：纯逻辑与保存用例。
- [x] `tests/uiSmoke.test.ts`：结构渲染保护。
- [x] `tests/uiBrowserSmoke/dashboardScenarios.ts`：真实右键、子菜单、改名、焦点、定位与无原生 Tooltip 验证。
- [ ] `tests/uiBrowserSmoke/tauriStubs.ts`：若现有 stub 不能观察 classification settings 写入，再做最小扩展。

### 16.2 原则上不应修改

- [ ] `src/platform/persistence/classificationPersistence.ts`。
- [ ] `src/platform/persistence/classificationSettingsGateway.ts`。
- [ ] `src-tauri/src/**`。
- [ ] `src-tauri/capabilities/**`。
- [ ] 数据库 migrations。
- [ ] `src/features/history/**`。
- [ ] `src/features/data/**`。
- [ ] `src/features/destination/**`。

### 16.3 停止并重新评估条件

- [ ] 需要让 Dashboard 直接 import platform persistence。
- [ ] 需要在 AppShell 中维护菜单或改名表单状态。
- [ ] 需要新增 Rust command 或改变现有 IPC 契约。
- [ ] 需要新增全局 `shared` 业务 service。
- [ ] 需要复制 Classification 页面的分类选项算法。
- [ ] 需要以 `title` 属性解决提示或可发现性。
- [ ] 需要让整张卡片接管右键或改变现有详情打开行为。
- [ ] 需要为第一阶段提前接入 History 或网页域名。

## 17. 阶段 0：锁定基线和红测

### 17.1 工作树与现状

- [x] 运行 `git status --short`，记录并保护用户现有修改。
- [x] 运行 `git diff --check`，确认基线没有空白错误。
- [x] 重新读取 live Project，确认事项、`In progress` 和 `Next` 窗口。
- [x] 截取或记录 Today 应用排行当前鼠标、双击与键盘行为。
- [x] 记录当前未分类应用在 UI 中没有显式 Badge 的事实。
- [x] 记录当前图标没有 HTML `title` 和原生悬浮窗。

### 17.2 基线命令

- [x] 运行 `npm run test:classification`。
- [x] 运行 `npm run test:ui-smoke`。
- [x] 运行 `npm run test:ui-browser-smoke`，记录 Dashboard 场景基线。
- [x] 运行 `npm run check` 取得完整可比较基线。

### 17.3 先写失败测试

- [ ] 写出 override 分类 patch 保留名称、颜色、`track` 和 `captureTitle` 的失败测试。
- [ ] 写出名称 patch 保留分类和其他字段的失败测试。
- [ ] 写出空名称删除别名但保留其余 override 的失败测试。
- [x] 写出历史 `other` 被视为未分类并清除 category 的回归测试。
- [ ] 写出名称-only override 仍被视为未分类的失败测试。
- [ ] 写出已删除分类被视为未分类的失败测试。
- [ ] 写出分类选项包含有效自定义分类且排除已删除分类的失败测试。

退出条件：

- [x] 基线结果已记录。
- [ ] 本轮未保留可复核的“生产代码前红测”日志，不在归档时倒签；最终由新增测试、mutation 和真实浏览器证据覆盖。
- [x] 没有未识别的用户改动与预计文件范围冲突。

## 18. 阶段 1：收口 classification 业务能力

### 18.1 纯逻辑

- [x] 实现快捷 override patch 类型。
- [x] 实现字段级合并函数。
- [x] 实现空别名恢复默认的规范化。
- [x] 实现显式分类判断。
- [x] 实现分类选项构建纯函数。
- [x] 分类选项沿用同一 classification 数据源、token 和排序语义。
- [x] 确认没有把业务规则移入 `shared/*`。

### 18.2 保存用例

- [x] 分类保存通过 feature 入口建立窄用例，并复用 `ClassificationService.saveAppOverride`。
- [x] 名称保存通过 feature 入口建立窄用例，并复用 `ClassificationService.saveAppOverride`。
- [x] 两个用例都从 `ProcessMapper.getUserOverride` 获取当前规范化 override。
- [x] 两个用例都通过纯函数合并 patch。
- [x] 两个用例都复用现有 `saveAppOverride` 持久化路径。
- [x] 持久化成功后才调用 `ProcessMapper.setUserOverride`。
- [x] 复用现有通用 service，没有复制持久化代码。
- [x] 补充保存失败不会更新 ProcessMapper 的测试。
- [x] 补充重复保存与无变化保存的确定行为测试。

退出条件：

- [x] 所有纯逻辑测试转绿。
- [x] 分类与名称保存均保留其他 override 字段。
- [x] 没有新增 platform 或 Rust 修改。

## 19. 阶段 2：实现 feature-owned 根菜单与子菜单

### 19.1 根菜单

- [x] 创建 classification-owned 根菜单组件。
- [x] 使用 Portal 渲染，避免被排行滚动容器裁切。
- [x] 实现指针锚点和键盘锚点。
- [x] 实现视口夹紧。
- [x] 实现应用头部、“更改名称…”和“设置分类”。
- [x] 实现 roving focus 或等价的单一菜单焦点策略。
- [x] 实现 outside click、Escape、Tab、scroll、resize、blur 和卸载清理。
- [x] 不使用 HTML `title`。

### 19.2 分类子菜单

- [x] 实现悬停打开。
- [x] 实现点击打开。
- [x] 实现 `ArrowRight` 打开。
- [x] 实现左右翻转和上下夹紧。
- [x] 实现当前显式分类勾选。
- [x] 未分类状态勾选“未分类”项。
- [x] 实现方向键、Home、End、Enter、Space、ArrowLeft 和 Escape。
- [x] 实现长列表滚动。
- [x] 选择分类时锁定当前 executable target。
- [x] 保存中阻止重复提交。

### 19.3 真实浏览器组件证据

- [x] 右键根菜单打开。
- [x] 菜单项初始焦点正确。
- [x] 悬停打开子菜单。
- [x] 键盘打开子菜单。
- [x] 子菜单在右边缘向左翻转。
- [x] 根菜单在下边缘向上收敛。
- [x] Escape 逐级关闭并恢复焦点。
- [x] outside click 关闭。
- [x] 卸载后 listener 被清理。
- [x] DOM 中没有本功能新增的 `title` 属性。

退出条件：

- [x] 菜单完整满足鼠标和键盘路径。
- [x] Portal、全局 listener、定位和焦点均有真实浏览器证据。
- [x] 菜单仍属于 classification owner，没有提前形成无事实支撑的 shared abstraction。

## 20. 阶段 3：实现改名 Dialog

- [x] 创建 classification-owned 改名 Dialog。
- [x] 使用 QuietDialog、QuietButton 和现有输入原型。
- [x] 增加统一 copy 文案。
- [x] 输入框在打开时获得焦点并全选当前显示名称。
- [x] 无显式别名时预填默认显示名称，同时提供“恢复默认名称”动作。
- [x] 显式说明恢复默认名称的语义。
- [x] 允许清除别名。
- [x] Enter 提交，Escape 取消。
- [x] 保存中禁用确认和重复提交。
- [x] 保存失败保留输入值并允许重试。
- [x] 保存成功关闭并恢复原图标焦点。
- [x] 无变化提交不写数据库。
- [x] 补充设置名称、替换名称、恢复默认和失败重试测试。
- [x] 补充 Dialog 焦点陷阱、Escape 和焦点恢复的真实浏览器证据。

退出条件：

- [x] 名称设置与恢复默认均通过同一受控保存链。
- [x] Dialog 不依赖原生 prompt、原生 Tooltip 或 `title`。
- [x] 关闭后焦点稳定回到真实来源图标。

## 21. 阶段 4：接入 Today / Dashboard

### 21.1 入口

- [x] 向 Dashboard 暴露最小的快捷编辑回调或 capability。
- [x] 在每个应用图标上增加 `onContextMenu`。
- [x] 只在图标目标范围内调用 `preventDefault`。
- [x] 保留 `onPointerDown` 预备详情、`onDoubleClick` 打开详情和 Enter 打开详情。
- [x] 增加菜单键与 `Shift+F10` 路径。
- [x] 增加 `aria-haspopup="menu"` 和必要 expanded 关系。
- [x] 不增加 HTML `title`。

### 21.2 Badge

- [x] 为每个排行应用计算显式分类状态。
- [x] 在占比文案后渲染普通 QuietBadge。
- [x] 主动选择有效分类后 Badge 消失；选择“未分类”后 Badge 保持或重新出现。
- [x] 只更改名称后 Badge 继续显示。
- [x] 长名称、窄窗口和大字号下 Badge 不挤压时长列。
- [x] Badge 不带 Tooltip，不成为第二套触发器。

### 21.3 AppShell 刷新

- [x] 将现有 Classification 保存后刷新逻辑收口为一个薄回调。
- [x] AppMapping 和 Today 快捷保存复用同一回调。
- [x] 清理 Dashboard snapshot cache。
- [x] 清理 History cache，以保证后续导航读取新映射。
- [x] 清理 Data / Tools 的相关缓存，不要求当前未挂载页面立即渲染。
- [x] 增加 mappingVersion 和 dataRefreshTick。
- [x] 每次成功保存只发出一次成功 Toast。
- [x] 失败时不推进 refresh state。

### 21.4 页面一致性

- [x] 改名后排行名称立即更新。
- [x] 设置分类后排行色彩与分类映射立即更新。
- [x] 专注分布立即按新分类重算。
- [x] 今日活动分类堆叠立即按新分类重算。
- [x] 排行滚动位置保持稳定。
- [x] 页面不闪回冷启动 skeleton 或整块 loading。
- [x] 持久化链和 bootstrap cache 回归确认重启后名称、分类和 Badge 状态保持正确。

退出条件：

- [x] Today 页面完整路径可用。
- [x] 现有详情入口没有回归。
- [x] 保存后所有依赖映射的当前页面区域一致更新。

## 22. 测试与验证矩阵

### 22.1 纯逻辑与 service

- [x] 无 override + 设置内置分类。
- [x] 无 override + 设置自定义分类。
- [x] 已分类 override + 选择“未分类”后清除 category。
- [x] 名称-only override + 设置分类。
- [x] 分类-only override + 更改名称。
- [x] 包含颜色、`track: false`、`captureTitle: false` 的 override + 修改名称。
- [x] 包含所有字段的 override + 修改分类。
- [x] 清空名称后仍保留分类与其他字段。
- [x] 清空唯一名称字段后删除空 override。
- [x] 已删除分类不进入选项并显示未分类。
- [x] 无变化保存不产生写入。
- [x] 持久化失败不更新 ProcessMapper。

### 22.2 鼠标交互

- [x] 右键图标打开根菜单。
- [x] 右键卡片其他区域不打开本功能菜单。
- [x] 左键图标不打开菜单。
- [x] 双击图标仍打开详情。
- [x] 悬停“设置分类”打开子菜单。
- [x] 指针从根项移动到子菜单不意外关闭。
- [x] 点击分类保存并关闭整组菜单。
- [x] 点击外部关闭。
- [x] 点击“更改名称…”关闭菜单并打开 Dialog。

### 22.3 键盘与无障碍

- [x] 图标可聚焦且有独立可访问名称。
- [x] `Shift+F10` 打开菜单。
- [x] 菜单键打开菜单。
- [x] 上下方向键、Home、End 正确导航。
- [x] 右方向键打开分类子菜单。
- [x] 左方向键返回根菜单。
- [x] Enter / Space 选择分类。
- [x] Escape 逐级关闭。
- [x] Tab 退出菜单且不丢失页面焦点顺序。
- [x] Dialog 初始焦点、焦点陷阱和关闭恢复正确。
- [x] ARIA role、expanded、controls 和 checked 关系匹配真实交互。

### 22.4 定位与布局

- [x] 普通窗口中心位置。
- [x] 视口右边缘根菜单夹紧。
- [x] 视口下边缘根菜单向上收敛。
- [x] 子菜单右侧空间不足时向左展开。
- [x] 子菜单选项过多时内部滚动。
- [ ] 100%、125%、150%、200% Windows 缩放下至少完成布局检查或等价浏览器缩放矩阵。
- [x] 1280×720 最小支持视口不产生横向滚动。
- [x] 中文与英文长文案均不溢出。

### 22.5 视觉与文案

- [x] Badge 使用现有普通 QuietBadge。
- [x] 菜单 chrome 使用现有 Quiet Pro token。
- [x] 没有新增硬编码颜色、阴影、边框或任意圆角债务。
- [x] 菜单与子菜单 hover、active、focus、disabled、loading 状态完整。
- [x] 所有用户可见文案进入 copy owner。
- [x] 没有本功能新增 HTML `title`。
- [x] 自解释菜单项和 Badge 没有重复 Tooltip。

### 22.6 回归

- [x] Classification 完整页面仍能保存全部字段。
- [x] Today 详情弹窗双击和 Enter 路径不变。
- [x] Dashboard snapshot 与 mappingVersion 刷新不重复触发。
- [x] 导航到 History 后能看到新名称和分类。
- [x] 导航到 Data 后能看到新名称和分类。
- [x] Widget 或后台映射读取没有因局部状态产生漂移。

## 23. 对抗式审查

实现与常规测试完成后，审查者应假设该功能仍有错误，并逐项攻击。

### 23.1 数据覆盖攻击

- [x] 构造包含全部 override 字段的应用，只改名称，确认其余字段逐字义保持。
- [x] 构造包含全部 override 字段的应用，只改分类，确认其余字段保持。
- [x] 菜单打开后若其他入口更新同一 override，保存时重新读取当前规范化 override，不使用菜单打开时快照。
- [x] 保存前重新读取当前 override，避免陈旧覆盖。
- [x] 持久化失败路径不会提前更新 ProcessMapper 或乐观 UI。

### 23.2 Identity 攻击

- [x] 两个应用显示名称相同，保存 identity 仍为 executable。
- [x] 列表因保存重排，提交仍写入打开菜单时捕获的 executable。
- [x] 大小写、路径或 alias executable 经过 canonicalization 后只写一个 key，bootstrap cache 同步使用规范化 key。
- [x] 快速右键两个不同应用时，keyed editor 隔离目标状态。

### 23.3 交互攻击

- [x] 根菜单与子菜单属于同一受控 DOM 所有权，指针跨越不会触发外部关闭。
- [x] 浏览器几何断言验证窗口边缘所有项仍可见。
- [x] 排行滚动通过 capture scroll listener 关闭菜单。
- [x] 保存使用同步 ref 锁，重复点击或按 Enter 只产生一次写入。
- [x] Dialog 打开时根菜单卸载，Escape 由 QuietDialog 顶层栈处理。
- [x] 组件卸载、导航和窗口失焦后清理 frame 与全局 listener。

### 23.4 未分类语义攻击

- [x] 无 override 显示 Badge。
- [x] 名称-only override 显示 Badge。
- [x] 颜色-only override 显示 Badge。
- [x] `track: false` 或 `captureTitle: false` 不会误判为已分类。
- [x] 历史 `other` 或无 category 显示 Badge。
- [x] 自定义分类有效时不显示 Badge。
- [x] 自定义分类被删除后通过有效映射语义重新显示 Badge。

### 23.5 Quiet Pro 与可访问性攻击

- [x] 搜索新增 JSX 中的 `title=`，确认没有原生悬浮提示。
- [x] Quiet Pro 样式债务门确认没有新增硬编码颜色、阴影、边框和任意 radius。
- [x] 键盘支持菜单键/Shift+F10、方向键、Home/End、Enter/Space、Escape 与 Tab 退出。
- [x] focus-visible 状态使用 Quiet Pro token，可辨认当前菜单项和子菜单项。
- [x] Escape/Dialog 关闭后返回来源图标；Tab 关闭后进入正常页面焦点顺序。

退出条件：

- [x] 所有攻击项通过，发现项均已修复并完成相称回归。
- [x] 没有未关闭的高风险数据覆盖、错误 identity、焦点泄漏或原生 Tooltip 问题。

## 24. 质量门

### 24.1 局部迭代

- [x] `npm run test:classification`（75 项：draft 51 + catalog 24）
- [x] `npm run test:ui-smoke`（51/51）
- [x] `npm run test:ui-browser-smoke`（75/75）
- [x] `npm run check:types`
- [x] `npm run check:architecture`
- [x] `npm run check:quiet-pro-style-debt`
- [x] `git diff --check`

### 24.2 交付前默认门槛

- [x] `npm run check`（含 coverage、mutation 14/14、browser 75/75、build 与 bundle）

说明：本次涉及 Portal、全局 listener、键盘导航、焦点恢复和复合菜单，真实浏览器 smoke 是必须证据，不能只靠 SSR 或纯函数测试。

### 24.3 默认不要求

- [x] 已复核无需 `npm run check:rust`，因为不修改 Rust、IPC、SQLite schema 或 capability。
- [x] 已复核无需 `npm run test:tauri-runtime-smoke`，实施未改变 command、capability 或真实桌面 persistence 边界。
- [x] 已复核无需 `npm run perf:stable`；bundle 与浏览器导航报告未显示新增稳定期性能风险。

### 24.4 失败处理

- [x] 未提高 hotspot 或样式债务预算；新增懒加载 owner 使用独立且留有余量的 bundle 预算。
- [x] 未删除既有测试或绕开默认执行图。
- [x] 沙箱内原生依赖受限后在获准环境重跑，没有跳过 browser evidence。
- [x] 失败均记录并修复：即时 Badge、静态 smoke 定位、AppShell hotspot、Tab/ARIA 与边缘竞态。

## 25. 第一阶段人工验收协议

### 25.1 准备

- [ ] 准备一个无任何 override 的应用。
- [ ] 准备一个仅有名称 override 的应用。
- [ ] 准备一个已有分类、颜色和标题记录设置的应用。
- [ ] 准备一个自定义分类。
- [ ] 准备一个已删除分类引用或等价 fixture。

### 25.2 未分类 Badge

- [ ] 无 override 应用显示普通“未分类”Badge。
- [ ] 名称-only 应用仍显示 Badge。
- [ ] 已明确分类应用不显示 Badge。
- [ ] Badge 与占比同行且不挤压时长。
- [ ] Badge 悬停不出现原生悬浮窗。

### 25.3 右键菜单

- [ ] 右键图标打开根菜单。
- [ ] 根菜单只显示已确认操作。
- [ ] 悬停“设置分类”打开子菜单。
- [ ] 当前显式分类带勾选。
- [x] 未分类应用勾选“未分类”项。
- [ ] 选择分类后菜单关闭、Toast 出现、Badge 消失。
- [x] 选择“未分类”后 Badge 保持或重新出现。
- [ ] 窗口边缘打开时菜单和子菜单完整可见。

### 25.4 更改名称

- [ ] “更改名称…”打开 Dialog。
- [ ] 输入新名称保存后排行立即更新。
- [ ] 清空并保存后恢复默认名称。
- [ ] 取消或 Escape 不保存。
- [ ] 保存失败时输入内容保留。
- [ ] 改名后原分类、颜色和记录设置不变。

### 25.5 回归与持久化

- [ ] 双击图标仍打开应用详情。
- [ ] 键盘 Enter 仍打开应用详情。
- [ ] `Shift+F10` 可打开快捷菜单。
- [ ] 重启后名称和分类保留。
- [ ] 导航到 Classification 后看到一致设置。
- [ ] 导航到 History / Data 后看到一致显示。

## 26. 第一阶段完成定义

只有以下全部满足，第一阶段才算实现完成：

- [x] Today 应用排行右键快捷菜单可用。
- [x] 根菜单包含“更改名称…”和“设置分类”。
- [x] 分类子菜单支持悬停、点击和键盘打开。
- [x] 更改名称支持设置别名与恢复默认。
- [x] 未分类语义正确区分无分类与有效显式分类。
- [x] 普通 Badge 使用现有规范且没有原生 Tooltip。
- [x] 单字段保存不覆盖其他 override。
- [x] 保存成功后 Today 页面所有相关显示一致更新。
- [x] 保存失败不会产生伪成功运行时状态。
- [x] 鼠标、键盘、焦点恢复和窗口边缘定位全部通过。
- [x] 现有详情入口没有回归。
- [x] `npm run check` 通过。
- [x] 对抗式审查无未关闭高风险发现。
- [x] 第一阶段真实浏览器等价验收完成；维护者实际使用反馈留给第 27 节后续决策门。

## 27. 第一阶段后的决策门

第一阶段完成后，不自动复制实现。维护者应基于实际使用决定下一步。

### 27.1 需要回答的问题

- [ ] 右键入口是否足够自然，用户是否能通过 Badge 或既有习惯发现它。
- [ ] 根菜单 + 分类子菜单是否比直接分类列表更清晰。
- [x] 自动化与对抗审查确认悬停子菜单稳定，没有跨越间隙关闭。
- [x] 本轮产品讨论已确认将“更改名称…”纳入 Today 高频快捷操作。
- [ ] 普通 Badge 是否足够醒目但不制造噪音。
- [x] 浏览器回归确认保存后无整页 loading，导航报告 `maxBlankFrames=0`。
- [x] 当前只有一个真实消费者，因此不升级为 shared Context Menu；等待 History 形成第二个消费者。

### 27.2 后续可能方向

- [ ] 若交互通过：接入 History 的应用分布入口。
- [ ] 若第二个消费者证明确有共享价值：评估将纯菜单外壳固化为 Quiet Pro 共享组件。
- [x] classification 业务内容继续留在 classification feature，不随外壳进入 shared。
- [ ] 若右键可发现性不足：先评估可见但克制的入口，不直接增加常驻操作墙。
- [ ] 若子菜单体验不稳：回到单层分类列表或紧凑 Dialog，保留业务 service 与数据测试。
- [ ] 网页域名、颜色、排除统计等仍需独立范围确认，不随页面扩展自动加入。

## 28. GitHub Project 协作

当前 live Project 条目范围仍是 Dashboard + History、分类 + 别名；本文是其中的第一阶段试水。

- [x] 2026-08-03 只读核对：对应事项为唯一主要 `In progress`。
- [x] 2026-08-03 只读核对：当前 `Next` 为「规范化前端与原生多语言文案系统」。
- [x] 实施开始前再次读取 live Project；状态未变，无需拖动。
- [x] 第一阶段实现和验证完成后，History 范围仍未完成，事项保持 `In progress`，不提前进入 `Done`。
- [x] 第一阶段完成后重新计算 `Next`：仅完成阶段里程碑不构成状态变化，`Next` 无需拖动。
- [ ] 若维护者决定把 Today 试水作为独立交付并推迟其余范围，先展示 Project 条目拆分或正文调整预览，获得确认后再修改。
- [ ] 若第一阶段证明方向不可行并等待新设计，建议维护者将事项拖到 `Blocked`，同时报告具体阻塞原因和 `Next` 补位建议。
- [ ] Dashboard + History 与最终验收全部完成后，才建议 `In progress → Done`，并重新计算 `Next`。
- [x] 未以本文勾选、commit、push 或本地测试代替 live Project 状态；完成后再次只读核对 live Board。

## 29. 回滚方案

第一阶段回滚应恢复 Today 页面原行为，同时保持用户已保存的标准 classification override 可继续由 Classification 页面读取。

- [ ] 回滚 Dashboard 右键入口和 Badge 展示。
- [ ] 回滚 classification-owned 菜单、Dialog 和快捷状态编排。
- [ ] 回滚新增 copy 与局部样式。
- [ ] 若只新增复用既有格式的 override，不删除用户已经通过快捷入口保存的数据。
- [ ] 保留 Classification 页面对这些标准 override 的正常管理能力。
- [ ] 回滚 AppShell 抽取时，恢复原 AppMapping 刷新回调且避免重复逻辑残留。
- [ ] 回滚后重新运行 `npm run check`。
- [ ] 记录回滚原因：数据错误、交互不可发现、焦点/定位问题或范围调整。

## 30. 建议提交拆分

每次提交前必须检查：

- [ ] `git diff --cached --stat`
- [ ] `git diff --cached --numstat`
- [ ] 手工维护内容超过 1,000 行或超过 25 个文件时，按 owner 或可独立验证阶段继续拆分。

建议拆分：

### Commit 1：classification 快捷编辑业务能力

- [ ] 纯逻辑、分类选项、未分类判断、override patch 和 service 测试。
- [ ] 建议主题：`feat(classification): add quick app edit workflow`

### Commit 2：Quiet Pro 菜单与改名 Dialog

- [ ] feature-owned 根菜单、分类子菜单、改名 Dialog、copy、样式和浏览器交互测试。
- [ ] 建议主题：`feat(classification): add app context editing controls`

### Commit 3：Today 接入与刷新验证

- [ ] Dashboard 入口、Badge、AppShell 刷新协调、页面 smoke 和回归测试。
- [ ] 建议主题：`feat(dashboard): add quick app classification entry`

说明：

- [ ] 具体提交数量以最终 diff 的真实 owner 和验证边界为准。
- [ ] commit subject 不包含 Project 引用。
- [ ] 若后续需要关联 GitHub Issue，使用单独 commit body `Refs #...`，不得使用关闭关键词。
- [x] 本文不授权创建分支、提交、推送或修改远端 Project；本次均未执行。

## 31. 归档清单

- [x] 已执行项目更新为真实勾选状态，并在第 0、23、24 节补充证据与失败修复说明。
- [x] 文档顶部已补充第一阶段完成日期和最终结论。
- [x] 已记录决策门结果：Today 完成交付；是否扩展 History 等待实际使用反馈，但原 Project 继续 `In progress`。
- [x] 本文不再是当前执行依据，已移至 `docs/archive/`。
- [x] 顶层 `docs/` 没有遗留本次一次性执行计划。
- [x] 已运行 `git diff --check`。
- [x] 最终交付将说明实现范围、验证证据、未完成的 History 范围和 Project 操作建议。

## 32. 最终签字

- [x] 实施者：代码、测试和本地验证完成。
- [x] 审查者：对抗式审查完成并修复全部发现。
- [ ] 维护者：Today 第一阶段人工验收完成。
- [ ] 产品决策者：确认是否扩展到 History 与其他页面。
- [x] Project 维护者协作：live 状态与 `Next` 已只读核对，无需拖动；History 完成前保持 `In progress`。
- [x] 归档者：执行方案已在不再活跃时移至 `docs/archive/`。
