# Quiet Pro 组件体系规范化执行方案

> 状态：已完成  
> 文档类型：一次性执行型 How-to  
> 适用对象：Patina 维护者与后续编码代理  
> 长期依据：[`quiet-pro-component-guidelines.md`](../ui.md)、[`architecture.md`](../architecture.md)、[`engineering-quality.md`](../quality.md)<br>
> 完成去向：执行、验收和对抗式审查全部完成后移入 `docs/archive/`

## 1. 任务定义

本任务不是重新设计 Patina，也不是把所有原生 HTML 控件替换成自研组件。

本任务要解决的真实问题是：

- 同一种交互是否存在多套无法解释的实现；
- 共享组件是否真的拥有稳定、跨 feature 的语义；
- feature 私有组件是否被错误上提到 `shared/*`；
- 控件的状态、键盘行为、焦点、禁用和错误反馈是否完整；
- Quiet Pro 的视觉规则是否已经成为可执行契约，而不只是一组 CSS 类；
- 后续新增组件时，是否有足够明确的准入与验证门槛。

最终目标是形成一套“小而稳定”的组件体系：该共享的稳定共享，该留在 feature 的明确留在 feature，例外可解释，关键交互可验证。

## 2. 第一性原理

### 2.1 组件存在的理由

组件不是为了减少文件数量，也不是为了追求代码表面统一。一个组件只有在至少创造下列一种长期价值时才值得存在：

1. **行为一致性**：焦点、键盘、关闭、禁用、加载等规则只实现一次。
2. **语义一致性**：相同产品含义使用相同名称、状态和视觉强度。
3. **变更杠杆**：一次修改可以安全改善多个真实使用点。
4. **风险隔离**：复杂交互或可访问性细节被封装在明确 owner 中。
5. **验证复用**：核心契约可以通过少量高价值测试保护。

如果抽取只减少了几行 JSX，却增加 props、条件分支和跨 feature 耦合，就不应抽取。

### 2.2 共享的成立条件

一个能力进入 `src/shared/components/*` 前，必须同时满足：

- 已有至少两个真实、独立的跨 feature 使用场景，或它本身就是稳定的全局 UI 原型；
- 语义不依赖某个页面的业务状态；
- props 能用产品/交互语言描述，而不是暴露某个页面的内部变量；
- 不直接访问 Tauri、SQLite、runtime gateway 或 feature service；
- 可以定义清楚的状态矩阵和可访问性契约；
- 预计未来修改时，多数消费者应当一起变化。

不满足这些条件的实现默认留在最小 feature 作用域。

### 2.3 一致性不是同质化

需要统一的是：

- 相同语义；
- 相同交互契约；
- 相同视觉角色；
- 相同风险处理。

不需要强行统一的是：

- 业务目标不同的日历；
- 数据可视化专用交互；
- 标题栏、侧栏等壳层控件；
- 时间线、颜色选择器等具有独特输入模型的复杂控件；
- 仅仅“长得有点像”但状态机不同的组件。

### 2.4 原生元素不是债务

`<button>`、`<input>` 等原生元素本身不是问题。只有在下列情况下才构成治理对象：

- 同一语义出现多套样式或行为；
- 缺少必要状态或可访问性；
- 页面重复实现已有共享契约；
- 局部硬编码逃离 Quiet Pro token；
- feature 为了方便复制了复杂交互状态机。

本任务不设置“原生标签数量归零”指标。

### 2.5 稳定期的改造原则

- 先建立事实，再抽象。
- 先保护行为，再迁移实现。
- 一次只迁移一个组件族。
- 每个阶段都必须可独立验证、可停止、可回退。
- 不借组件规范化顺手重写页面状态、数据流或业务文案。
- 不以视觉统一为理由改变用户已经形成的操作习惯。

## 3. 当前基线

以下数字是执行方案编写时的静态基线，正式执行第一阶段必须重新生成并校准。

### 3.1 已有共享组件

`src/shared/components/` 当前包含 23 个 `Quiet*` 组件，覆盖：

- 容器与结构：`QuietPageHeader`、`QuietActionRow`、`QuietSubpanel`；
- 操作：`QuietIconAction`、`QuietInlineAction`、`QuietDangerAction`；
- 状态与反馈：`QuietBadge`、`QuietToast`、`QuietToastStack`、`QuietTooltip`；
- 对话框：`QuietDialog`、`QuietConfirmDialog`、`QuietPromptDialog`；
- 选择与输入：`QuietSelect`、`QuietSwitch`、`QuietStepperSlider`、`QuietSegmentedFilter`、`QuietRangeControl`；
- 日期时间：`QuietDatePicker`、`QuietDateRangePicker`、`QuietTimePicker`；
- 专用展示/输入：`QuietChartTooltip`、`QuietColorField`。

其中多个复杂组件已超过 250 行：

- `QuietColorField`：约 427 行；
- `QuietSelect`：约 315 行；
- `QuietTimePicker`：约 265 行；
- `QuietDateRangePicker`：约 262 行；
- `QuietDatePicker`：约 253 行。

行数不是拆分理由，但这些组件应优先检查状态机、焦点、定位、清理和测试覆盖。

### 3.2 原生控件使用面

在 `src/app` 与 `src/features` 的 TSX 中，当前约有 125 处原生 `button/input/select/textarea` 使用点：

| Owner | 基线数量 | 初始判断 |
| --- | ---: | --- |
| `features/settings` | 55 | 高重复概率，也是数据操作与确认风险最高的区域 |
| `features/tools` | 28 | 输入状态多，存在工具专用交互，不宜盲目共享 |
| `features/history` | 13 | 时间线和日期导航专用交互较多，性能敏感 |
| `features/classification` | 8 | 已较多使用 Quiet 组件，剩余多为业务输入 |
| `features/update` | 8 | 状态、重试和确认行为需要一致 |
| `app` | 6 | 标题栏、侧栏、widget 属于壳层专用控件 |
| `features/about` | 5 | 弹窗内操作，适合核对通用 action 契约 |
| `features/data` | 2 | 数据筛选输入，性能和渲染稳定性优先 |

这些数量只用于确定审查范围，不作为迁移 KPI。

### 3.3 当前明显缺口

- 已有 `.qp-button-primary / secondary / danger` 样式，但没有统一的普通文本按钮组件契约；
- 多个 `Quiet*` 组件有真实消费者，但缺少专门的组件行为测试；
- 现有 UI smoke 中有不少源码结构断言，不能替代真实 DOM、键盘和焦点测试；
- `QuietDialog` 已被广泛使用，但弹窗内 action、初始焦点、焦点恢复和嵌套弹层需要系统核对；
- 日期、时间、选择器、Tooltip 和颜色选择器是复杂共享控件，应以行为风险而非视觉相似度决定拆分；
- 设置页多个面板标题结构高度相似，但当前视觉层级已经成立，是否抽取只能根据重复成本和语义稳定性判断，不能因扫描器命中而修改设计。

## 4. 目标与成功标准

### 4.1 目标

- 建立完整、可复查的组件资产清单；
- 为共享组件建立明确 owner、用途、状态和可访问性契约；
- 合并确实重复的组件实现；
- 保留合理的 feature 专用组件，并记录原因；
- 为高风险共享控件补齐行为保护；
- 把长期成立的规则回写到 Quiet Pro 母文档和自动化门禁；
- 不改变现有页面信息架构、业务语义和高频操作路径。

### 4.2 可验收成功标准

- [x] `src/app`、`src/features`、`src/shared/components` 中的 UI 组件全部进入资产清单，没有“未分类”项。
- [x] 每个 `shared` 组件都有明确原型、消费者、状态矩阵、可访问性规则和 owner 结论。
- [x] 每处候选重复实现均有“合并 / 保留 / 删除 / 延后”结论及证据。
- [x] 新增共享组件全部满足共享准入条件，没有仅服务单一页面的万能抽象。
- [x] 所有迁移保持既有文案、数据流、页面结构和默认交互语义。
- [x] Dialog、Select、Tooltip、日期时间控件等高风险组件拥有真实 DOM 行为测试。
- [x] 键盘、焦点、禁用、加载、错误和空状态均有明确处理或明确“不适用”。
- [x] 没有新增硬编码 Quiet Pro 视觉债务。
- [x] 默认 `npm run check` 通过。
- [x] 如触及 History/Data 导航或渲染，必须执行性能门禁：直接覆盖变更路径的浏览器基准应通过；`perf:stable` 的非相关读模型波动必须保留证据，禁止调高预算掩盖。
- [x] 对抗式审查未发现 P0/P1 问题；P2 问题已修复或形成明确后续项。
- [x] 长期规则已回写，执行文档已勾选并归档。

## 5. 范围与非目标

### 5.1 本次范围

- `src/shared/components/*`；
- `src/styles/tokens.css`、`src/styles/quiet-pro.css` 及相关 feature CSS；
- `src/app/components/*` 和 `src/app/widget/*` 中的壳层控件；
- 各 `src/features/*/components/*` 中的 UI 原型与原生控件使用；
- 与组件契约直接相关的 copy owner、类型和测试；
- UI smoke、browser smoke、组件行为测试与必要治理脚本；
- `docs/quiet-pro-component-guidelines.md` 的长期规则回写。

### 5.2 明确非目标

- [x] 不重做七个主页面的视觉设计。
- [x] 不改变 Dashboard、History、Data 的读模型或数据加载策略。
- [x] 不改 Rust、SQLite、IPC 或 Tauri runtime，除非执行中发现真实阻塞并另行升级范围。
- [x] 不把所有原生 HTML 元素替换成共享组件。
- [x] 不引入外部组件库或设计系统依赖。
- [x] 不建立 Storybook，除非后续证明维护收益高于新增工具链成本。
- [x] 不借机统一业务上不同的日历、时间线、图表 Tooltip 或颜色输入。
- [x] 不修改已经成立的设置面板标题视觉层级。
- [x] 不通过放宽 bundle、hotspot、style debt 或测试门禁完成迁移。

## 6. Owner 与分类规则

每个候选组件按以下顺序判断：

1. **它是否只服务一个 feature 的业务交互？**
   - 是：留在 `features/<owner>/components`。
2. **它是否属于 app shell、titlebar、sidebar 或 widget 生命周期？**
   - 是：留在 `app/*`。
3. **它是否是稳定、跨 feature、低业务上下文的 Quiet Pro 原型？**
   - 是：可以进入 `shared/components`。
4. **它是否直接依赖平台或持久化能力？**
   - 是：组件本身不得进入 shared；先通过 feature service 或 platform gateway 隔离。
5. **它是否只是两段 JSX 看起来相似？**
   - 是：默认不抽取，先证明行为和未来变化方向一致。

每个资产必须归入以下一种结果：

- `Shared primitive`：稳定的交互基础件；
- `Shared composition`：稳定组合原型，如 Dialog、PageHeader；
- `Feature component`：由业务 owner 持有；
- `App-shell component`：由壳层 owner 持有；
- `Native justified`：合理使用原生元素，无需封装；
- `Duplicate candidate`：有证据表明应合并；
- `Deprecated shell`：仅为兼容，必须注明退出条件。

## 7. 执行总览

本任务分成八个阶段。只有当前阶段的验收项全部完成，才能勾选并进入下一阶段。

1. 基线冻结与资产盘点；
2. 重复与风险审计；
3. 组件契约设计；
4. 高风险交互保护；
5. 分批迁移；
6. 自动化治理；
7. 全量验收；
8. 对抗式审查与归档。

## 8. 阶段一：基线冻结与资产盘点

### 8.1 建立资产清单

- [x] 新建 `docs/working/quiet-pro-component-inventory.md`。
- [x] 列出全部 `src/shared/components/*.tsx`。
- [x] 列出 `app` 和各 feature 的页面级、弹窗级、控件级组件。
- [x] 统计原生 `button/input/select/textarea` 使用点，但不预设它们需要迁移。
- [x] 列出 `src/styles/quiet-pro.css` 中全部 `.qp-*` 可复用原型。
- [x] 列出各 feature CSS 中疑似重复的 control、dialog、popover、panel、chip、status 样式。
- [x] 记录每个组件的真实消费者，不能只根据文件名判断用途。
- [x] 记录组件是否含 portal、全局 listener、timer、ResizeObserver、滚动/定位逻辑。
- [x] 记录组件是否含用户可见 copy；如有，确认 copy owner。

### 8.2 为每个资产填写固定字段

- [x] 名称与路径；
- [x] 当前 owner；
- [x] 原型类别；
- [x] 真实消费者；
- [x] 业务上下文依赖；
- [x] 支持的状态；
- [x] 键盘行为；
- [x] 焦点行为；
- [x] ARIA/语义元素；
- [x] 定位、滚动和窗口边界行为；
- [x] 当前测试；
- [x] 样式 owner 与 token 使用；
- [x] 初步结论；
- [x] 风险等级。

### 8.3 固定行为基线

- [x] 运行 `npm run check`，确认执行前主线为绿。
- [x] 记录七个页面的基本打开、返回和滚动行为。
- [x] 记录所有现有 Dialog、Popover、Select、Tooltip 的打开/关闭入口。
- [x] 记录 Settings、History、Data 当前首帧与热返回体验。
- [x] 如基线本身失败，先记录真实失败，不把既有问题归因于本任务。

### 8.4 阶段验收

- [x] 清单覆盖率为 100%。
- [x] 没有仅凭文件名或 CSS 类名下结论。
- [x] 每个候选都有真实消费者证据。
- [x] 基线结果可重复。

## 9. 阶段二：重复与风险审计

### 9.1 按组件族逐项对比

- [x] **普通按钮**：对比 primary、secondary、danger、text、icon、inline action。
- [x] **图标按钮**：核对尺寸、label、tooltip、focus ring、disabled。
- [x] **Switch**：核对 success/warning tone、label 关联、禁用和保存中状态。
- [x] **Slider/Stepper**：核对 min/max/step、输入同步、方向键、格式化和禁用。
- [x] **Dialog**：核对 backdrop、Escape、初始焦点、焦点陷阱、关闭后焦点恢复。
- [x] **Select/Listbox**：核对上下键、Enter/Escape、禁用项、滚动和边界定位。
- [x] **Tooltip/Popover**：核对 hover/focus、延迟、视口翻转、portal 和清理。
- [x] **日期时间**：核对 locale、月切换、范围边界、禁用日期、键盘和时区。
- [x] **面板与标题**：核对结构重复，但不把已成立的视觉差异误判为问题。
- [x] **Badge/Chip/Status**：核对是否表达真实语义，避免把装饰当状态。
- [x] **Toast/进度**：核对时序、重复消息、错误状态和卸载清理。

### 9.2 识别重复必须同时满足的证据

- [x] 语义相同；
- [x] 用户操作目标相同；
- [x] 状态矩阵基本相同；
- [x] 可访问性契约相同；
- [x] 未来视觉和行为预期一起变化；
- [x] 抽取后 props 不需要泄露 feature 业务字段。

缺少任一关键证据时，结论应为“保留 feature 专用”，而不是“先抽出来再说”。

### 9.3 风险分级

- [x] `R1`：纯展示、无状态、无 portal；
- [x] `R2`：有 hover/active/disabled 或简单受控状态；
- [x] `R3`：有键盘、焦点、portal、定位、日期或复合输入；
- [x] `R4`：涉及危险操作、异步保存、恢复、删除或跨窗口行为。

迁移顺序默认不是从 R1 到 R4 盲目推进，而是：先为 R3/R4 补保护，再从证据最充分、收益最高的组件族开始迁移。

### 9.4 输出审计结论

- [x] 为每个候选标记 `合并 / 保留 / 删除 / 延后`。
- [x] `合并` 项写清目标 owner 和消费者。
- [x] `保留` 项写清业务差异，不使用“暂时不动”作为理由。
- [x] `删除` 项证明没有真实消费者或已被稳定替代。
- [x] `延后` 项写清缺少的证据和重新评估条件。

## 10. 阶段三：组件契约设计

### 10.1 定义统一契约模板

每个共享组件必须明确：

- [x] 解决的问题；
- [x] 适用场景；
- [x] 禁止场景；
- [x] 受控/非受控模式；
- [x] props 与默认值；
- [x] `default / hover / active / focus / disabled`；
- [x] 必要时的 `loading / selected / empty / error`；
- [x] 键盘映射；
- [x] 焦点进入、移动、关闭和恢复；
- [x] ARIA 角色、名称和状态；
- [x] 尺寸与 tone 允许值；
- [x] 使用的 Quiet Pro token；
- [x] 响应式与视口边界；
- [x] 测试责任；
- [x] 真实消费者示例。

### 10.2 普通按钮决策门

仓库当前有通用按钮样式但没有统一文本按钮组件。执行时必须先回答：

- [x] 是否至少存在两个跨 feature、同语义的文本按钮消费者；
- [x] `primary / secondary / danger` 是否足以表达现有 action；
- [x] 是否需要 `loading`，以及 loading 时是否保留宽度；
- [x] 是否需要图标槽位，图标位置是否有限定；
- [x] 是否应允许 `asChild` 或多态元素；默认答案为否，除非有真实需求；
- [x] 是否能避免形成拥有大量布尔 props 的万能按钮。

只有这些问题有稳定答案时才新增 `QuietButton`；否则继续使用语义类与合理原生按钮。

### 10.3 面板标题决策门

- [x] 先确认 Settings 五个面板标题的结构是否长期一致。
- [x] 确认抽取是否减少真实重复，而不隐藏页面语义。
- [x] 保留当前“图标 + 标题 + 分隔线”的视觉结果。
- [x] 不因 `kill-ai-slop` 静态误报改变字号或层级。
- [x] 如只服务 Settings，优先建立 Settings feature 私有组件，而不是直接进入 shared。

### 10.4 复杂组件拆分门

对于超过 250 行的共享组件，只有在下列情况才拆分：

- [x] 存在可独立命名、独立测试的状态机或定位逻辑；
- [x] 拆分后 owner 更清晰；
- [x] 不增加跨文件跳转却没有复用收益；
- [x] 不把 feature 规则下沉进 shared helper；
- [x] 拆分前已有行为测试保护。

## 11. 阶段四：高风险交互保护

### 11.1 测试基础设施选择

- [x] 评估现有 browser smoke 是否足以承载组件行为测试。
- [x] 优先复用当前 Vite + headless Edge/Chrome 环境。
- [x] 如需新增测试工具，先证明现有工具无法可靠覆盖目标行为。
- [x] 不为组件测试引入体量显著的运行时依赖。
- [x] 测试必须进入现有 `npm run check` 可达执行图，并满足测试治理门禁。

### 11.2 Dialog 契约测试

- [x] 点击入口后 Dialog 可见且拥有可访问名称。
- [x] 初始焦点落在明确元素上。
- [x] Tab/Shift+Tab 不泄漏到背景页面。
- [x] Escape 按契约关闭；危险进行中状态除外时必须有明确规则。
- [x] 点击 backdrop 是否关闭由 props 明确决定。
- [x] 关闭后焦点返回触发元素。
- [x] 背景不可误操作。
- [x] disabled/loading action 不重复提交。

### 11.3 Select、Tooltip 与 Popover 测试

- [x] 触发器可通过键盘打开。
- [x] 方向键移动高亮项。
- [x] Enter/Space 选择符合角色规范。
- [x] Escape 关闭并恢复焦点。
- [x] disabled 项不能选择。
- [x] 视口边缘可以翻转或收敛，不产生横向溢出。
- [x] Tooltip 可由 hover 与 focus 触发，并在卸载后清理。

### 11.4 日期时间控件测试

- [x] 月份跨年切换正确。
- [x] 最小/最大日期边界正确。
- [x] 范围开始、结束和反向选择规则正确。
- [x] locale 显示与内部值分离。
- [x] 键盘可以完成核心选择路径。
- [x] 关闭/取消不会泄漏临时值。
- [x] 时区和当天边界使用固定 fixture。

### 11.5 Switch 与 Slider 测试

- [x] label 与控件正确关联。
- [x] Space/方向键行为正确。
- [x] min/max/step 不越界。
- [x] disabled 状态不能触发回调。
- [x] 保存中状态不会产生重复写入。
- [x] 展示值与提交值一致。

## 12. 阶段五：分批迁移

每一批迁移都遵循同一循环：先选定候选，补行为测试，迁移最少消费者，验证，再决定是否继续。

### 12.1 批次 A：Dialog 与 action

- [x] 统一基于 `QuietDialog` 的结构契约。
- [x] 核对 Confirm/Prompt 是否只是稳定组合层。
- [x] 识别 feature Dialog 中重复的 footer/action 写法。
- [x] 普通按钮契约成立后先评估 About、Update 等低业务耦合消费者；Update 迁移，About 品牌/渠道入口按专用契约保留。
- [x] 最后迁移 Settings 中涉及导出、恢复、清理的 R4 操作。
- [x] 不改变危险操作确认步骤和默认按钮含义。

### 12.2 批次 B：基础表单控件

- [x] 核对 `QuietSwitch`、`QuietStepperSlider`、`QuietSegmentedFilter`。
- [x] 迁移确实重复的 Settings 控件写法。
- [x] 保留 Tools 中具有专用解析、计时状态或组合输入的 feature 组件。
- [x] 保留原生 input 作为语义正确的底层元素。
- [x] 不改变现有设置保存时机。

### 12.3 批次 C：Select、Tooltip、日期和时间

- [x] 先完成 R3 行为测试。
- [x] 核对 portal、listener、timer 和定位清理。
- [x] 消除明确重复的弹层定位或键盘状态机。
- [x] History 专用日期导航与共享 DatePicker 分别判断，不按外观合并。
- [x] Data 日期范围与 Settings 导出范围复用同一稳定契约时才继续共享。

### 12.4 批次 D：面板、状态和展示原型

- [x] 核对 `QuietActionRow`、`QuietSubpanel`、`QuietBadge`、`QuietPageHeader`。
- [x] 设置面板标题如需抽取，默认放入 Settings feature。
- [x] 清理完全重复且无业务含义的结构类。
- [x] 不把 feature 图表、时间线、状态卡片强行包装为通用 Panel。
- [x] 不形成 cards-in-cards 或无语义 badge。

### 12.5 每批迁移后的强制检查

- [x] 查看 diff，确认没有业务逻辑顺带迁移。
- [x] 检查新增 props 是否来自通用语义，而不是页面内部变量。
- [x] 检查 shared 是否新增 feature import 或 platform import。
- [x] 运行命中的专项测试。
- [x] 运行 `npm run check:types`。
- [x] 运行 `npm run check:lint`。
- [x] 浏览器核验受影响交互。
- [x] 记录迁移结论和未迁移原因。

## 13. 阶段六：自动化治理

### 13.1 长期文档回写

- [x] 将已经验证成立的组件准入条件回写到 `docs/quiet-pro-component-guidelines.md`。
- [x] 补充共享组件与 feature 组件的 owner 判断。
- [x] 补充普通按钮、Dialog、Popover、表单控件的状态最低要求。
- [x] 不把一次性文件路径、数量和迁移清单写入长期母文档。

### 13.2 自动化门禁决策

只有机器能可靠判断的事实才进入门禁：

- [x] 禁止 shared 反向依赖 feature/app/platform：沿用架构门禁。
- [x] 禁止新增 Quiet Pro 硬编码视觉债务：沿用 style debt 门禁。
- [x] 检查新增共享组件是否至少有测试：仅在误报可控时加入。
- [x] 检查组件测试是否进入唯一执行图：沿用 test governance。
- [x] 不以正则禁止原生 `<button>` 或 `<input>`。
- [x] 不以文件行数直接判定组件失败。
- [x] 新门禁必须有 self-test，覆盖合法与非法样本。

### 13.3 依赖与 bundle 保护

- [x] 不新增组件库依赖。
- [x] 如新增测试依赖，记录 gzip/安装成本和替代方案。
- [x] 运行构建和 bundle budget。
- [x] 不因迁移失败提高 bundle 预算。

## 14. 阶段七：全量验收

### 14.1 静态与结构验证

- [x] `npm run check:types`
- [x] `npm run check:lint`
- [x] `npm run check:architecture:self-test`
- [x] `npm run check:architecture`
- [x] `npm run check:quiet-pro-style-debt`
- [x] `npm run check:test-governance:self-test`
- [x] `npm run check:test-governance`

### 14.2 行为验证

- [x] 组件专项行为测试通过。
- [x] `npm test` 通过。
- [x] `npm run test:ui-browser-smoke` 通过。
- [x] 七个页面均可正常进入、返回和滚动。
- [x] 所有受影响 Dialog、Popover、Select、Tooltip 可用鼠标和键盘完成核心路径。
- [x] 控制台 error 为 0。
- [x] 页面不存在新增横向溢出。

### 14.3 性能验证

如迁移触及 History、Data、Dashboard 或首次加载路径：

- [x] 已执行 `npm run perf:stable`；读模型套件受 Node 版本与遗留开发进程影响出现跨模块非重复波动，未调预算；本任务直接相关的浏览器性能基准三轮全部通过。
- [x] 对比迁移前后的 average、p50、p95、max。
- [x] History 首次进入无新增 1–2 秒空白。
- [x] History/Data 热返回无数据闪烁。
- [x] 页面点击反馈不因 lazy chunk 或 portal 初始化变慢。
- [x] 不通过提前加载全部复杂弹窗来换取表面速度。

### 14.4 默认总门槛

- [x] `npm run check`
- [x] 已运行 `npm run check:full`：前端、Rust、Clippy 与依赖审计全部通过。
- [x] 不适用：本轮未修改真实 Tauri/IPC 行为，因此未追加 `npm run test:tauri-runtime-smoke`。

## 15. 回滚与停止条件

出现下列任一情况，停止当前批次并回滚到上一稳定状态：

- [x] 已核验，未触发：抽取后需要大量 feature 专用布尔 props；
- [x] 已核验，未触发：shared 组件开始读取业务 service、平台 gateway 或持久化；
- [x] 已核验，未触发：为兼容旧消费者引入第二套长期 API；
- [x] 已核验，未触发：History/Data 出现首帧空白、热返回闪烁或可感知导航退化；
- [x] 已核验，未触发：键盘、焦点或屏幕阅读器行为比迁移前更差；
- [x] 已核验，未触发：为通过门禁需要扩大 allowlist、预算或 style debt 基线；
- [x] 已核验，未触发：diff 混入数据流、文案、业务规则或无关重构；
- [x] 已核验，未触发：无法用一句话说明组件真实 owner。

停止后必须：

- [x] 不适用（未触发停止条件）：记录失败假设；
- [x] 不适用（未触发停止条件）：恢复上一批次通过的实现；
- [x] 不适用（未触发停止条件）：保留新增的有效行为测试；
- [x] 不适用（未触发停止条件）：将候选改为“保留”或“延后”，并写明重新评估条件。

## 16. 提交与审查切片

本任务实施时应按独立可验证边界拆分，不把全量迁移压成一个提交：

1. 资产清单与契约；
2. 测试基础与高风险组件保护；
3. Dialog/action 迁移；
4. 基础表单控件迁移；
5. Select/日期时间/Tooltip 迁移；
6. 展示原型与样式收口；
7. 门禁、长期文档与归档。

每个切片都必须：

- [x] owner 单一或高度相关；
- [x] 行为可独立验证；
- [x] 不依赖尚未提交的隐式中间状态；
- [x] working diff 已人工审查；维护者要求不提交，本轮未建立 staged diff；
- [x] 不超过仓库提交体量规则；
- [x] 不自动提交或推送，除非维护者明确授权。

## 17. 对抗式审查

所有实施和验证完成后，开启一次独立于实现思路的对抗式审查。

### 17.1 抽象攻击

- [x] 找出只服务一个消费者的 shared 组件。
- [x] 找出 props 超过实际语义、通过布尔组合模拟多个组件的实现。
- [x] 找出为了“统一”而隐藏业务差异的组件。
- [x] 找出仅减少 JSX、却增加理解成本的抽取。
- [x] 找出 shared 中出现的 feature、platform 或 runtime 语义。

### 17.2 行为攻击

- [x] 快速重复点击 action，检查重复提交。
- [x] 在 Dialog/Popover 打开时连续按 Escape、Tab、Shift+Tab。
- [x] 在视口边缘、窄窗口和滚动容器中打开弹层。
- [x] 在 disabled/loading 切换瞬间操作控件。
- [x] 切换页面后检查 listener、timer、portal 是否残留。
- [x] 在日期跨月、跨年、当天边界测试选择器。

### 17.3 视觉攻击

- [x] 检查七个页面的控件密度是否仍符合 Quiet Pro。
- [x] 检查 action 强度是否被错误统一。
- [x] 检查 focus ring 是否清晰但不过度喧闹。
- [x] 检查圆角、边框、阴影和动效是否仍走 token。
- [x] 检查是否引入 pill spam、cards-in-cards 或无语义 badge。
- [x] 重新运行 `kill-ai-slop`，只把命中当线索，逐项人工复核。

### 17.4 性能攻击

- [x] 冷启动后首次进入 History、Data、Settings。
- [x] 页面间连续往返至少 20 次。
- [x] 重复打开和关闭复杂 Dialog/Popover。
- [x] 检查 lazy chunk 是否被意外并入入口。
- [x] 对比性能基线的 p95 和 max，而不只看平均值。

### 17.5 审查结论门槛

- [x] P0/P1：必须修复后重新全量验证。
- [x] P2：本任务引入的问题必须修复；既有问题需明确证据和后续 owner。
- [x] P3：可以记录，但不得用其扩大本任务范围。
- [x] 审查必须同时寻找“抽取过度”和“重复未收口”，不能只攻击一个方向。

## 18. 完成与归档

只有以下条件全部满足，任务才算彻底完成：

- [x] 阶段一至阶段七全部完成并有验证证据。
- [x] 对抗式审查完成，阻断问题清零。
- [x] 资产清单中的每项都有最终结论。
- [x] 长期成立的规则已回写到顶层母文档。
- [x] 临时数量、迁移过程和一次性判断没有污染长期母文档。
- [x] 本文所有完成项按真实结果勾选，未完成项不得批量伪勾选。
- [x] 本文状态更新为“已完成”。
- [x] 本文移动到 `docs/archive/quiet-pro-component-system-execution-plan.md`。
- [x] 临时资产清单如仍有长期参考价值，提炼后归档；否则删除。
- [x] `git status` 中只保留本任务确认范围内的变更。

## 19. 执行记录模板

每个阶段完成时追加一条记录：

```md
### YYYY-MM-DD · 阶段 N

- 完成范围：
- 关键决定：
- 保留的 feature 专用实现：
- 新增/删除的 shared 组件：
- 验证命令与结果：
- 性能对比（如适用）：
- 遗留风险：
- 下一阶段准入结论：通过 / 不通过
```

## 20. 当前执行状态

- [x] 阶段一：基线冻结与资产盘点
- [x] 阶段二：重复与风险审计
- [x] 阶段三：组件契约设计
- [x] 阶段四：高风险交互保护
- [x] 阶段五：分批迁移
- [x] 阶段六：自动化治理
- [x] 阶段七：全量验收
- [x] 阶段八：对抗式审查与归档

当前结论：任务已完成并通过对抗式审查。P0 0、P1 0、由本任务引入且未修复的 P2 0；所有勾选均由代码、资产清单、自动化门禁、真实浏览器或人工复核支持。

## 21. 实际执行记录

### 2026-07-16 · 阶段一至三

- 完成范围：建立全量资产清单，分类 shared/app/feature/native 资产，按 R1–R4 审计风险与 owner。
- 关键决定：新增跨 feature 的 `QuietButton`；Settings 面板标题只抽为 feature-owned `SettingsPanelHeader`；不追求原生标签清零。
- 保留的 feature 专用实现：History 日历/时间线、Data delegated tooltip、About 品牌入口、Tools 图标操作。
- 验证：类型、Lint、架构、样式债务和测试治理门禁通过。
- 准入结论：通过。

### 2026-07-16 · 阶段四至六

- 完成范围：修复嵌套 Dialog topmost 键盘契约、Select/DatePicker/TimePicker/ColorField/Tooltip/Toast 可访问性；迁移普通文本 action；稳定浏览器临时目录清理。
- 新增 shared：`QuietButton`；新增 feature component：`SettingsPanelHeader`；删除 shared：无。
- 自动化：补真实浏览器键盘、焦点恢复、ARIA 与嵌套 Dialog 断言；长期规则回写 `quiet-pro-component-guidelines.md`。
- 包体反证：曾尝试扩大 compound-control 迁移，lazy support 超过 6.25 KiB 即撤回；最终 6.11 KiB，未放宽预算。
- 准入结论：通过。

### 2026-07-16 · 阶段七至八

- 全量验证：`npm run check:full` 通过；Rust 377 passed / 1 ignored；依赖审计 0 可达漏洞。
- 浏览器：31/31 场景通过，console error 0，无新增横向溢出。
- 性能：直接相关浏览器基准三轮全部通过、History/Data 各 24 个热路径样本；History 冷首帧 144.1–170.7ms，热首帧平均 51.0–54.9ms，最差 P95 75.7ms。
- 性能异常记录：`perf:stable` 的读模型套件在 Node 24 + 遗留高 CPU 开发进程下 Data 超预算；按 Node 22 清理环境后 History 5/5 通过，Dashboard 首轮 average 27.38ms 略超 25ms而 P95/max 通过。本轮未修改相关读模型，未调整预算；该既有验证稳定性债务归 `scripts/perf/stable-benchmark-suite.ts` 与仓库 Node 版本执行纪律所有，不归组件层。
- 对抗式审查：kill-ai-slop 扫描 274 个文件、21 个原始命中，人工复核后确认整改项 0；P0/P1 0，本任务遗留 P2 0。
- 归档结论：通过。
