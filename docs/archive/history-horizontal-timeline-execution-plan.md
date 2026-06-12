# History 横向日内时间轴执行方案

状态：已完成并归档  
创建日期：2026-06-10  
来源：GitHub Issue [#6](https://github.com/Ceceliaee/patina/issues/6) 第 4 点时间轴建议  
文档类型：How-to / 临时执行方案  
目标读者：后续实现者、代码审查者、维护者  
目标版本：第一版已完成（2026-06-10）  

本文件只讨论并规划 History 页面横向日内时间轴的第一版落地。它用于把当前想法拆成可执行、可验证、可回滚的小步骤。

完成本方案后，如果功能已经发布并不再作为当前执行依据，应按文档卫生规则将本文移动到 `docs/archive/`。

## 0. 执行定位

- [x] 本方案只覆盖 #6 中“类似 ActivityWatch / ManicTime / ScreenTimeTracker 的横向时间轴”这一部分。
- [x] 第一版目标是增强 `History` 的日内回看效率，让用户一眼看到当天活动分布、空档、切换和集中时段。
- [x] 第一版不改变追踪写入逻辑、不改变 SQLite schema、不新增 Rust command。
- [x] 第一版不把 `History` 扩展成多日/周/月/年统计页；长周期趋势仍归 `Data` 页面。
- [x] 第一版不实现浏览器插件、网页 URL 记录、截图记录、按目录自动分类。
- [x] 第一版不重做 Quiet Pro 视觉方向，只在现有 Quiet Pro 组件语言里增加一个安静的日内时间轴。
- [x] 如果实施过程中发现需要跨层数据迁移、Rust 写侧改动或新的持久化字段，应暂停并重新评估，而不是继续扩大本方案。

## 1. 产品与交互结论

### 1.1 页面归属

- [x] 横向日内时间轴归 `History` 页面。
- [x] `History` 继续回答“某一天具体怎么过的”。
- [x] `Data` 继续回答“一个时间范围内趋势如何”。
- [x] 不把横向时间轴放入 Dashboard 第一版，避免首屏信息过载。

### 1.2 第一版核心形态

- [x] 在 `History` 右侧时间线区域内新增一条横向日内时间轴。
- [x] 横轴默认表示选中日期的本地 00:00 到 24:00。
- [x] 如果选中日期是今天，数据自然只延伸到当前时间，未来时间保持空白。
- [x] 活动片段按真实开始时间和结束时间定位。
- [x] 没有记录的时间段保持为空白，不用颜色填满。
- [x] 时间轴下方或旁边保留现有列表，列表继续负责详细阅读。

### 1.3 展示维度按钮

- [x] 复用 History 当前“当日活动”卡片右上角的 `Layers3` 图标按钮。
- [x] 该按钮在第一版中升级为 History 页面的展示维度开关。
- [x] 当前持久化字段 `hourlyActivityChartMode` 继续保留，不做数据库或设置迁移。
- [x] 在 History 内部将 `hourlyActivityChartMode === "category"` 映射为“按分类显示”。
- [x] 在 History 内部将 `hourlyActivityChartMode === "total"` 映射为“按应用显示”。
- [x] 按分类显示时，当日活动柱状图和横向时间轴都按分类着色。
- [x] 按应用显示时，柱状图保持总活动模式，横向时间轴按应用着色。
- [x] 不新增第二个时间轴专用切换按钮，避免页面出现重复状态。

### 1.4 列表与时间轴分工

- [x] 横向时间轴负责扫读当天分布、空档和切换节奏。
- [x] 现有纵向列表负责查看应用名、持续时间、标题明细和合并后的可读活动段。
- [x] 不直接删除现有列表。
- [x] 不把列表做成隐藏的二级入口，第一版保留可见。
- [x] 点击时间轴片段时，显示对应片段的简要信息。
- [x] 如果实现成本可控，点击片段后同时高亮或定位到对应列表项；如果会显著扩大范围，留到第二版。

## 2. Owner 与边界

### 2.1 前端 owner

- [x] 页面 owner：`src/features/history/`。
- [x] 组件 owner：`src/features/history/components/`。
- [x] 纯展示模型 owner：`src/features/history/services/`。
- [x] 样式 owner：新增或扩展 `src/styles/features/history.css`。
- [x] 共享层只复用现有 Quiet Pro 原型和分类能力，不新增跨 feature 通用时间轴组件。

### 2.2 不允许的落点

- [x] 不把时间轴业务逻辑塞进 `src/app/*`。
- [x] 不在页面组件里直接访问 SQLite 或 Tauri API。
- [x] 不在 `src/shared/*` 新建通用时间轴工具，除非后续 Dashboard/Data 明确复用且语义稳定。
- [x] 不新增 `src/lib/*` 或 `src/types/*`。
- [x] 不在 Rust `commands/*`、`lib.rs` 或 `app/*` 中增加时间轴逻辑。

### 2.3 允许的小范围改动

- [x] 可以在 `History.tsx` 中接入新的时间轴组件。
- [x] 可以新增 `HistoryHorizontalTimeline.tsx` 这类 History 私有组件。
- [x] 可以新增 `historyTimelineViewModel.ts` 这类 History 私有纯函数服务。
- [x] 可以扩展 `UI_TEXT.history` 和 `UI_TEXT.accessibility.history` 文案。
- [x] 可以增加针对时间轴展示模型的轻量测试。
- [x] 可以更新 UI smoke / browser smoke，以覆盖时间轴的基础渲染。

## 3. 数据策略

### 3.1 数据来源

- [x] 横向时间轴使用 `buildHistoryReadModel` 已返回的 `compiledSessions`。
- [x] 纵向列表继续使用 `timelineSessions`。
- [x] 不直接使用原始 `daySessions` 渲染时间轴，因为其中还没有完成前端读模型归一、裁剪和标题清洗。
- [x] 不使用 `timelineSessions` 作为横向时间轴数据源，因为它经过活动保持时间合并，可能隐藏真实空档和短切换。

### 3.2 会话裁剪规则

- [x] 时间轴片段必须裁剪到选中日期的本地日范围内。
- [x] 跨午夜会话只显示当天重叠部分。
- [x] live session 继续依赖 `materializeLiveSessions` 后的读模型结果。
- [x] 如果 tracker health 标记 live session stale，沿用现有读模型的诊断和封口结果，不在时间轴组件里重新判断。

### 3.3 片段与列表的差异

- [x] 时间轴片段展示更接近真实活动分布。
- [x] 列表展示继续保留 `mergeThresholdSecs` 合并后的可读活动段。
- [x] `minSessionSecs` 第一版继续只影响现有列表，不默认隐藏时间轴真实片段。
- [x] 如果时间轴因为极短片段过密而不可读，第二版再讨论“最短可视片段”或“密度合并”。
- [x] 第一版不引入新的设置项控制时间轴密度。

### 3.4 颜色策略

- [x] 按应用显示时，优先使用用户对应用设置的颜色。
- [x] 按应用显示时，如果没有用户颜色，沿用现有 icon theme color 或默认分类色。
- [x] 按分类显示时，使用分类颜色。
- [x] 分类色只用于片段、图例和必要识别，不改变面板 chrome。
- [x] 不新增页面私有硬编码调色板。

### 3.5 图例策略

- [x] 时间轴提供紧凑图例，帮助解释当前颜色含义。
- [x] 图例按当前显示维度聚合。
- [x] 图例默认按当天总时长从高到低排序。
- [x] 图例最多展示 6 到 8 项，剩余项合并成“其他”或省略到 tooltip 中。
- [x] 图例不做重型筛选器，不提供多选过滤。

## 4. 文件级执行清单

### 4.1 预检

- [x] 运行 `git status --short`，确认当前工作树状态。
- [x] 确认没有用户正在编辑同一批文件。
- [x] 阅读或复核 `docs/product-principles-and-scope.md`。
- [x] 阅读或复核 `docs/quiet-pro-component-guidelines.md`。
- [x] 阅读或复核 `docs/architecture.md`。
- [x] 阅读或复核 `docs/issue-fix-boundary-guardrails.md`。
- [x] 确认本次只执行本方案的第一版范围。

### 4.2 展示模型

- [x] 新增 `src/features/history/services/historyTimelineViewModel.ts`。
- [x] 在该文件中定义 `HistoryTimelineDisplayMode = "app" | "category"`。
- [x] 在该文件中定义 `HistoryTimelineSegment`。
- [x] `HistoryTimelineSegment` 至少包含：
  - [x] `id`
  - [x] `sourceSessionId`
  - [x] `appKey`
  - [x] `exeName`
  - [x] `displayName`
  - [x] `category`
  - [x] `categoryLabel`
  - [x] `startTime`
  - [x] `endTime`
  - [x] `duration`
  - [x] `startRatio`
  - [x] `endRatio`
  - [x] `widthRatio`
  - [x] `titleSamples`
  - [x] `titleSampleDetails`
  - [x] `isLive`
- [x] 在该文件中定义 `HistoryTimelineLegendItem`。
- [x] `HistoryTimelineLegendItem` 至少包含：
  - [x] `key`
  - [x] `label`
  - [x] `duration`
  - [x] `percentage`
  - [x] `category`
  - [x] `exeName`
- [x] 新增 `buildHistoryTimelineViewModel` 纯函数。
- [x] `buildHistoryTimelineViewModel` 入参包含：
  - [x] `sessions`
  - [x] `selectedDate`
  - [x] `nowMs`
  - [x] `mode`
- [x] `buildHistoryTimelineViewModel` 输出包含：
  - [x] `segments`
  - [x] `legendItems`
  - [x] `axisTicks`
  - [x] `dayStartMs`
  - [x] `dayEndMs`
  - [x] `visibleEndMs`
- [x] axis ticks 默认为 `00:00`、`06:00`、`12:00`、`18:00`、`24:00`。
- [x] 今天的 `visibleEndMs` 可以是当前时间，但比例基准仍保持一整天，避免今天和历史日尺度不一致。
- [x] 所有 ratio 保持在 `0` 到 `1` 范围。
- [x] duration 为非负数。
- [x] 空 sessions 返回空 segments 和空 legendItems，但 axis ticks 仍可渲染。

### 4.3 时间轴组件

- [x] 新增 `src/features/history/components/HistoryHorizontalTimeline.tsx`。
- [x] 组件 props 至少包含：
  - [x] `viewModel`
  - [x] `mode`
  - [x] `icons`
  - [x] `iconThemeColors`
  - [x] `onSegmentActivate`
  - [x] `activeSegmentId`
- [x] 组件不直接读取 DB、Tauri、settings store 或 runtime gateway。
- [x] 组件内部只处理布局、可访问性标签和轻量交互。
- [x] 每个片段使用 `button` 或等价可聚焦元素。
- [x] 每个片段提供 `aria-label`，包含应用/分类、开始时间、结束时间、时长。
- [x] 片段支持鼠标点击。
- [x] 片段支持键盘 Enter / Space 激活。
- [x] 片段 hover 和 focus 使用 Quiet Pro 克制反馈。
- [x] 片段 active 状态有清楚边界，但不使用霓虹、发光或大阴影。
- [x] 极短片段保持真实起点，同时提供最小可点击区域或可访问 fallback。
- [x] 空状态显示简短文字，复用 `UI_TEXT.history.emptyDay` 或新增更精确文案。
- [x] 不在时间轴内部创建卡片套卡片结构。

### 4.4 接入 `History.tsx`

- [x] 从 `historyView` 中取出 `compiledSessions`。
- [x] 新增 `historyTimelineMode` 局部常量：
  - [x] `hourlyActivityChartMode === "category"` 时为 `"category"`。
  - [x] 其他情况为 `"app"`。
- [x] 使用 `useMemo` 调用 `buildHistoryTimelineViewModel`。
- [x] 把 `HistoryHorizontalTimeline` 插入右侧时间线面板。
- [x] 时间轴位置建议放在右侧面板标题控制区下方、纵向列表上方。
- [x] 保持现有 min session 控制仍在右侧时间线标题区。
- [x] 保持现有列表映射和标题详情弹窗逻辑。
- [x] 点击时间轴片段时，复用现有标题详情弹窗能力，或新增同规格的轻量 popover。
- [x] 如果复用现有 `toggleTimelineSessionDetails`，确认传入的 title detail 数据结构一致。
- [x] 点击空白区域或 Escape 关闭时间轴详情。
- [x] 切换日期、切换显示维度、刷新数据时清理 active segment 状态。
- [x] 不在 `History.tsx` 中加入大段比例计算或聚合逻辑。

### 4.5 展示维度按钮文案

- [x] 保留 `Layers3` 图标按钮。
- [x] 更新 History 中按钮 title，使其表达“切换 History 展示维度”而不只描述柱状图。
- [x] 新增或调整中文文案：
  - [x] `UI_TEXT.history.showByCategory`
  - [x] `UI_TEXT.history.showByApp`
  - [x] `UI_TEXT.history.timelineDistribution`
  - [x] `UI_TEXT.history.timelineLegendMore`
- [x] 新增或调整英文文案，保持 copy key 与中文一致。
- [x] 如果 Dashboard 仍只控制柱状图，Dashboard 文案可保持现状。
- [x] 如果共享按钮文案会影响 Dashboard，拆分 History 和 Dashboard 的 copy key。
- [x] 运行 copy key 对齐测试，确保 `zh-CN` 和 `en-US` 结构一致。

### 4.6 样式

- [x] 新增 `src/styles/features/history.css`。
- [x] 在 `src/App.css` 中导入 `./styles/features/history.css`。
- [x] 新增样式只覆盖 History 时间轴相关 class。
- [x] 不迁移或重写现有 History 样式，避免把本任务扩大成样式整理。
- [x] 使用现有 token：
  - [x] `--qp-bg-panel`
  - [x] `--qp-bg-elevated`
  - [x] `--qp-border-subtle`
  - [x] `--qp-border-strong`
  - [x] `--qp-text-primary`
  - [x] `--qp-text-secondary`
  - [x] `--qp-text-tertiary`
  - [x] `--qp-track-muted`
  - [x] `--qp-chart-grid`
  - [x] `--qp-motion-fast`
  - [x] `--qp-motion-ease`
- [x] 不硬编码新的中性背景、边框、阴影或圆角。
- [x] 分类/应用颜色通过 style 变量注入到片段，不写死在 CSS。
- [x] 时间轴轨道高度固定，避免 hover 或动态内容导致布局跳动。
- [x] 时间刻度不遮挡片段。
- [x] 图例在宽度不足时换行或隐藏低优先项，不挤压主轨道。
- [x] 低高度窗口下，时间轴进入紧凑模式。
- [x] 窄窗口下，右侧面板内容不产生不可控横向溢出。
- [x] 片段 focus-visible 可见。
- [x] disabled/empty/loading 状态不出现跳动。

### 4.7 交互细节

- [x] Hover 片段时提高边界或透明度，不改变片段尺寸。
- [x] Active 片段时显示更清楚的边框。
- [x] 点击片段显示详情：
  - [x] 应用名或分类名
  - [x] 开始时间
  - [x] 结束时间或“至今”
  - [x] 时长
  - [x] 标题明细数量
  - [x] 可用时显示标题样本
- [x] 标题样本沿用现有清洗规则，不在组件里重新清洗窗口标题。
- [x] Escape 关闭详情。
- [x] 点击时间轴外部关闭详情。
- [x] 日期切换关闭详情。
- [x] 展示维度切换关闭详情。
- [x] loading 状态下保留稳定空间，不显示刺眼 skeleton。

### 4.8 可访问性

- [x] 时间轴区域提供清楚的 `aria-label`。
- [x] 每个 segment 的 `aria-label` 可独立理解。
- [x] 颜色不是唯一信息来源，segment label / aria label 必须包含应用或分类。
- [x] 键盘可以进入 segment。
- [x] 键盘可以打开和关闭详情。
- [x] focus 状态不依赖颜色差异过小的反馈。
- [x] 图例项不作为必须交互入口，避免误导。

## 5. 测试计划

### 5.1 新增单元测试

- [x] 新增 `tests/historyTimelineViewModel.test.ts`。
- [x] 在 `package.json` 中新增 `test:history-timeline` 脚本。
- [x] 将 `test:history-timeline` 加入 `check:frontend`。
- [x] 测试空 day 返回空 segments 且保留 axis ticks。
- [x] 测试普通 session 生成正确 `startRatio`、`endRatio`、`widthRatio`。
- [x] 测试跨午夜 session 被裁剪到选中日期。
- [x] 测试今天 live session 使用 `nowMs` 后的可见结束时间。
- [x] 测试 app mode legend 按应用聚合并按 duration 排序。
- [x] 测试 category mode legend 按分类聚合并按 duration 排序。
- [x] 测试极短 session 不产生负 width。
- [x] 测试 sessions 顺序不依赖输入顺序。

### 5.2 更新 UI smoke

- [x] 更新 `tests/uiSmoke.test.ts`。
- [x] 断言 `History` 页面仍避免 visible loading copy。
- [x] 断言新增 history timeline component 文件存在。
- [x] 断言 `App.css` 导入 `styles/features/history.css`。
- [x] 断言中英文 copy key 结构仍一致。

### 5.3 更新 browser smoke

- [x] 更新 `tests/uiBrowserSmoke.test.ts`。
- [x] 打开 History 页面后等待 `.history-horizontal-timeline` 出现。
- [x] 断言至少有一个 `.history-horizontal-timeline-segment`，前提是 stub 数据包含当天 sessions。
- [x] 点击当前 `Layers3` 按钮后，断言时间轴根元素 mode 属性或 class 从 app 切换到 category。
- [x] 断言切换后 `hourly_activity_chart_mode` 仍按现有设置持久化。
- [x] 点击一个 segment 后，断言详情 popover 出现。
- [x] 按 Escape 后，断言详情 popover 关闭。
- [x] 检查主界面没有明显横向溢出。

### 5.4 手动视觉验证

- [x] 启动本地 dev server。
- [x] 用浏览器打开应用。
- [x] 在浅色默认主题下检查 History 时间轴。
- [x] 在深色主题下检查 History 时间轴。
- [x] 切换到分类模式，确认柱状图和时间轴一起变化。
- [x] 切换回应用模式，确认时间轴按应用区分。
- [x] 选择今天，确认未来时间为空白。
- [x] 选择历史日，确认完整 24 小时尺度稳定。
- [x] 检查 1366px 宽度下无文本重叠。
- [x] 检查低高度窗口下列表仍可滚动。

## 6. 验证命令

### 6.1 局部验证

- [x] `npm run test:history-timeline`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run build`

### 6.2 交付前最低验证

- [x] `npm run check`

### 6.3 什么时候追加验证

- [x] 如果改动了 Rust、SQLite、IPC 或 tracking runtime，停止执行本方案并重新定范围。
- [x] 如果意外触及 Rust 边界，追加 `npm run check:rust`。
- [x] 如果改动版本、changelog、release 脚本，追加 release 相关验证。

## 7. 验收标准

- [x] History 页面出现横向日内时间轴。
- [x] 时间轴能表达真实空档，而不是把全天压成连续彩条。
- [x] 时间轴按应用模式和按分类模式都能工作。
- [x] 现有 `Layers3` 按钮控制 History 的展示维度。
- [x] 当日活动柱状图和横向时间轴在分类模式下保持一致的维度语义。
- [x] 现有纵向列表仍可用。
- [x] 标题详情仍可查看。
- [x] 日期切换仍可用。
- [x] min session 控制仍影响列表展示。
- [x] 新增 UI 符合 Quiet Pro：克制、清楚、低噪音。
- [x] 没有新增 page-local 硬编码 chrome 颜色。
- [x] 没有新增跨层访问、DB 直接访问或 Rust command。
- [x] `npm run check` 通过。

## 8. 明确非目标

- [x] 不实现 History 的周/月/年/自定义时间段。
- [x] 不改变 Data 页现有范围选择逻辑。
- [x] 不实现“按分类查看”的独立大页面。
- [x] 不实现浏览器 URL 级记录。
- [x] 不实现浏览器插件。
- [x] 不实现截图记录。
- [x] 不实现按目录自动分类。
- [x] 不新增团队、云端、账号或 SaaS 相关能力。
- [x] 不新增全局图表库或重量级依赖。
- [x] 不重构整个 History 页面。
- [x] 不把已有 History 样式从 `quiet-pro.css` 大规模迁移出来。

## 9. 风险与处理

### 9.1 时间轴过密

- [x] 风险：短时间频繁切换导致片段过多，视觉拥挤。
- [x] 第一版处理：保留真实分布，片段使用细线和 hover/focus 识别。
- [x] 不在第一版新增复杂聚合规则。
- [x] 如果实际不可读，第二版评估“视觉聚合但详情保真”的策略。

### 9.2 `hourlyActivityChartMode` 命名不完全贴合

- [x] 风险：字段名表示 hourly chart，但现在同时影响 History 时间轴。
- [x] 第一版处理：不迁移持久化字段，只在 History 局部用 `historyTimelineMode` 语义转换。
- [x] 后续如果 Dashboard/History 展示维度继续扩展，再单独设计设置字段重命名或兼容迁移。

### 9.3 组件变厚

- [x] 风险：`History.tsx` 已经较大，直接塞入时间轴逻辑会继续变厚。
- [x] 第一版处理：新增 History 私有组件和服务，把计算和渲染拆开。
- [x] 不借机做全文件重构。

### 9.4 颜色语义混乱

- [x] 风险：按应用和按分类共用一组颜色时用户难以理解。
- [x] 第一版处理：图例和 aria label 明确当前模式。
- [x] 切换按钮文案明确下一步动作。

### 9.5 Browser smoke 不稳定

- [x] 风险：browser smoke 对布局和异步加载敏感。
- [x] 第一版处理：只增加必要断言，不做过细像素级断言。
- [x] 如需视觉像素检查，放在手动验证或后续专项。

## 10. 建议执行顺序

- [x] 第一步：确认本方案范围。
- [x] 第二步：新增 `historyTimelineViewModel.ts` 和单元测试。
- [x] 第三步：新增 `HistoryHorizontalTimeline.tsx` 静态渲染。
- [x] 第四步：在 `History.tsx` 接入时间轴。
- [x] 第五步：接入现有 `Layers3` 按钮的页面展示维度语义。
- [x] 第六步：补充样式文件并导入。
- [x] 第七步：补充 copy。
- [x] 第八步：接入点击详情。
- [x] 第九步：补 UI smoke / browser smoke。
- [x] 第十步：运行局部验证。
- [x] 第十一步：运行 `npm run check`。
- [x] 第十二步：做一次人工视觉检查。
- [x] 第十三步：根据结果决定是否进入提交或继续迭代。

## 11. 完成后的收尾

- [x] 如果后续提交关联 #6，只使用 `Refs #6`，不使用 `Closes`、`Fixes` 或 `Resolves`。
- [x] 不关闭、重开、标记或修改 GitHub issue，除非用户明确要求。
- [x] 如果需要 changelog，描述为 History 日内时间轴增强，不宣称完成 #6 全部内容。
- [x] 如果第一版发布后本文不再作为当前执行依据，将本文移动到 `docs/archive/`。
- [x] 如果第一版只完成部分范围，在本文顶部更新状态和剩余项，不制造新的顶层临时文档。


## 归档记录

- [x] 2026-06-10 已完成第一版 History 横向日内时间轴实现。
- [x] 已复用现有 `Layers3` 展示维度按钮，未新增重型筛选系统。
- [x] 已完成视图模型测试、UI smoke、浏览器 smoke、构建与前端完整检查。
- [x] 条件性扩大范围条目均已检查且未触发：未改 SQLite schema，未新增 Rust command，未移动跨层 owner。
- [x] 已按文档卫生规则从 `docs/working/` 归档到 `docs/archive/`。
