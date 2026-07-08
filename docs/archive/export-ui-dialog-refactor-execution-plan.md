# 数据导出 UI 收敛与字段扩展执行方案

本文是一次性执行方案，放在 `docs/working/` 下作为当前任务的实施依据。任务完成、验证通过并汇报后，应移动到 `docs/archive/`，避免临时方案长期留在顶层活动文档中。

## 当前状态

- [x] 实现已完成。
- [x] 本文已更新为执行归档记录。
- [x] 已遵守 Quiet Pro 基线、当前架构边界和文档卫生规则。
- [x] 未改动用户已有的 `README.md`、`README.zh-CN.md` 未提交内容。

## 第一性原理

### 1. 备份和导出不是同一件事

备份的目的，是在灾难恢复时尽量还原 Patina 自身数据状态。它偏向完整、内部、可恢复，用户不一定直接阅读。

数据导出的目的，是把会话和网页活动带出 Patina，用于表格查看、长期归档、外部分析或 AI/数据工具处理。它偏向可读、可筛选、格式明确、字段可控。

因此，数据导出不应被做成一个长期展开的设置表单。它是一个任务流，应从设置页用一个清楚的入口进入，再在弹窗中完成一次导出。

### 2. 设置页负责入口，不负责承载导出流程

设置页的核心职责是管理偏好和运行配置。导出流程包含时间范围、格式、字段和执行状态，这些都是一次任务中的操作，不应该平铺在设置页中挤占长期设置。保存位置属于系统文件选择动作，应在用户点击导出时即时出现，而不是作为长期表单字段停留在界面中。

结论：

- [x] 设置页只保留一个紧凑的“数据导出”行卡。
- [x] 点击“导出”打开导出弹窗。
- [x] 时间范围、格式和字段进入弹窗。
- [x] 点击导出时直接打开系统保存位置选择器，选择后立即导出。

### 3. 导出偏好可以持久化，但不属于设置页保存按钮

导出格式和导出范围模式是用户的任务偏好，记住它们可以减少重复操作。但它们不应绑定到设置页右上角“保存/取消”，否则用户会误以为导出偏好和运行设置具有同一保存语义。

结论：

- [x] 记住上次导出格式。
- [x] 记住上次导出范围模式。
- [x] 首装默认范围模式为 `本月`。
- [x] 首装默认格式为 `CSV`。
- [x] 自定义日期范围只用于本次导出，不覆盖持久化范围模式。

### 4. 时间范围要和数据页一致

数据页已经有成熟的日历弹层和范围步进交互。导出不应重新发明另一套日期选择器，否则用户会在同一个产品里学两套类似但不一致的规则。

结论：

- [x] 导出弹窗复用数据页的“左右切换 + 中间范围按钮 + 日历弹层”模式。
- [x] 导出范围模式为 `本日`、`本周`、`本月`、`本年`。
- [x] 中间按钮文案随当前范围变化。
- [x] 右箭头不得进入未来范围。
- [x] 自定义范围通过日历弹层完成。

### 5. 分类字段是当前规则推导值，不是历史快照

Patina 当前分类逻辑是“按当前 app/domain 映射规则解释数据”。用户今天修改某个 app 或 domain 的分类，再导出过去的数据，过去记录应按今天的分类输出。

结论：

- [x] 导出新增 `category` 字段。
- [x] `category` 在导出时按当前分类规则计算。
- [x] App 记录按当前 app 映射计算分类。
- [x] Web 记录按当前 domain 映射计算分类。
- [x] 本轮不新增历史分类快照。

### 6. Quiet Pro 的目标是安静、清楚、耐用

导出 UI 不是营销页面，也不是炫技组件。它应像一个桌面工具中的稳定任务面板：层级清楚、状态明确、密度适中、没有 glow、没有重阴影、没有额外装饰。

结论：

- [x] 复用现有 panel/control/chip/status 语义。
- [x] 不新增 glassmorphism、blur-heavy panel、neon glow、大渐变背景。
- [x] 不在组件中硬编码新颜色、圆角、阴影或边框。
- [x] 如确实需要新视觉角色，先扩展 token 或语义样式。

### 7. 架构先定 owner，再定文件

数据页、导出页、设置页都可能碰到“时间范围”。但不能让 `features/export` 直接依赖 `features/data` 的私有组件。要先判断能力归属，再移动或抽取。

结论：

- [x] 设置页 owns 入口位置和行卡布局。
- [x] 导出 feature owns 导出弹窗和导出任务状态。
- [x] 可复用日期范围 primitive 放到 shared 或明确的 owner-first 位置。
- [x] Rust exporter owns 数据输出字段和格式一致性。
- [x] Tauri command 继续保持薄，只做参数接入和错误传递。

## 目标

- [x] 把设置页中平铺的导出表单收敛为一张 Quiet Pro 行卡。
- [x] 新增导出弹窗，承载完整导出流程。
- [x] 复用或抽取数据页日历范围交互。
- [x] 持久化导出范围模式和导出格式。
- [x] 扩展导出字段，至少加入 `category`。
- [x] 将字段配置分组为默认字段、分析字段、高级字段。
- [x] 确保 CSV、SQLite、Parquet 的字段行为一致。
- [x] 补充测试和手动验证。

## 非目标

- [x] 不改变备份/恢复的数据语义。
- [x] 不把数据导出变成自动定时导出。
- [x] 不引入云端同步、团队功能或移动端逻辑。
- [x] 不新增历史分类快照。
- [x] 不重新设计整个设置页。
- [x] 不在本任务中做大范围视觉重构。

## 已确认交互方案

### 设置页入口

- [x] 在设置页的存储/数据安全区域新增紧凑行卡。
- [x] 行卡标题为 `数据导出`。
- [x] 行卡说明为 `导出会话和网页活动，用于表格查看、归档或分析。`
- [x] 行卡右侧按钮为 `导出`。
- [x] 行卡不展示时间范围、格式、字段列表或输出路径。
- [x] 行卡视觉参考现有 `备份`、`恢复`、`WebDAV 配置` 行。

### 导出弹窗

弹窗内从上到下组织为一次任务流：

- [x] 标题区：`数据导出`，副标题说明导出用途。
- [x] 时间范围区：范围步进器 + 自定义日历弹层。
- [x] 格式区：CSV、SQLite、Parquet 选择。
- [x] 字段区：显示 `已选字段数 / 总字段数`，提供 `配置字段`。
- [x] 操作区：取消、导出、系统保存位置选择、导出中状态、成功/失败反馈。

### 时间范围

- [x] 默认范围模式为 `本月`。
- [x] 支持范围模式：`本日`、`本周`、`本月`、`本年`。
- [x] 支持自定义日期范围。
- [x] 交互形态与数据页一致：`<`、中间范围按钮、`>`。
- [x] 中间范围按钮可打开日历弹层。
- [x] 左右箭头按当前范围单位移动。
- [x] 右箭头在下一段会进入未来时禁用。
- [x] 自定义范围完成后，中间按钮显示日期范围。
- [x] 自定义范围不覆盖持久化范围模式。
- [x] UI 显示使用包含起止日期的自然语义。
- [x] 后端继续使用 `[startTime, endExclusive)` 半开区间。

### 格式持久化

- [x] 默认格式为 `CSV`。
- [x] 用户选择 CSV、SQLite 或 Parquet 后记住选择。
- [x] 下次打开弹窗时恢复上次格式。
- [x] 改变时间范围不得静默改掉用户手动选择的格式。
- [x] 推荐文案可以根据范围变化更新，但只是建议，不替用户切换。

### 字段配置

- [x] 字段配置入口在导出弹窗内。
- [x] 字段配置可以继续作为二级弹窗。
- [x] 二级弹窗要 Quiet Pro 化，不能有 glow。
- [x] 字段为空时导出按钮禁用。
- [x] 字段为空时后端也必须拒绝导出。
- [x] 字段顺序应可控，导出文件按 UI 顺序输出。

## 字段方案

目标字段总数暂定为 32 个。执行时如果发现某个高级字段没有稳定来源，必须明确记录并降级处理，不能静默消失。

### 默认字段

默认字段面向大多数用户，首装默认全部选中。

- [x] `record_type`: 记录类型，区分 app/session 与 web activity。
- [x] `category`: 当前分类名，导出时按当前分类规则计算。
- [x] `start_time`: 开始时间。
- [x] `end_time`: 结束时间。
- [x] `duration_ms`: 持续时间，毫秒。
- [x] `app_name`: 应用显示名。
- [x] `exe_name`: 应用可执行文件名。
- [x] `window_title`: 窗口标题。
- [x] `domain`: 原始域名。
- [x] `normalized_domain`: 归一化域名。
- [x] `url`: 页面 URL。
- [x] `page_title`: 页面标题。

### 分析字段

分析字段面向表格透视、SQL 查询和长期统计。默认不一定全选，执行时按产品可读性决定首装勾选状态。

- [x] `category_id`: 当前分类 ID 或稳定分类键。
- [x] `local_date`: 本地日期。
- [x] `local_week`: 本地周。
- [x] `local_month`: 本地月份。
- [x] `weekday`: 星期。
- [x] `start_hour`: 开始小时。
- [x] `duration_minutes`: 持续时间，分钟。
- [x] `source_key`: 聚合来源键。
- [x] `source_name`: 聚合来源名。

### 高级字段

高级字段面向排查、复现、数据对账。默认折叠，默认不全选。

- [x] `session_id`: 会话 ID。
- [x] `web_segment_id`: 网页活动片段 ID。
- [x] `continuity_group_start_time`: 连续组开始时间。
- [x] `browser_client_id`: 浏览器客户端 ID。
- [x] `browser_kind`: 浏览器类型。
- [x] `browser_exe_name`: 浏览器可执行文件名。
- [x] `favicon_url`: 图标 URL。
- [x] `web_source`: 网页活动来源。
- [x] `created_at`: 创建时间。
- [x] `updated_at`: 更新时间。
- [x] `category_color`: 当前分类颜色。

## 执行步骤

### 阶段 0: 预检和保护现场

- [x] 确认当前分支是 `main`。
- [x] 运行 `git status --short --branch`。
- [x] 记录用户已有未提交文件，不纳入本任务改动。
- [x] 阅读并遵守：
  - [x] `docs/product-principles-and-scope.md`
  - [x] `docs/roadmap-and-prioritization.md`
  - [x] `docs/engineering-quality.md`
  - [x] `docs/quiet-pro-component-guidelines.md`
  - [x] `docs/architecture.md`
  - [x] `docs/issue-fix-boundary-guardrails.md`
- [x] 确认不修改 `docs/archive/*` 作为当前执行依据。
- [x] 确认不推送，除非用户在实现完成后明确要求。

### 阶段 1: 梳理当前实现

- [x] 检查 `src/features/settings/pages/Settings.tsx` 中导出组件挂载位置。
- [x] 检查 `src/features/settings/components/SettingsDataSafetyPanel.tsx` 的行卡组件和 Quiet Pro 样式。
- [x] 检查 `src/features/export/components/Export.tsx` 当前状态拆分、字段配置和导出流程。
- [x] 检查 `src/features/data/components/DataTrendRangePicker.tsx` 的日历弹层交互。
- [x] 检查 `src/features/data/model/dataTrendRange.ts` 的范围计算逻辑。
- [x] 检查 export 相关测试，确认现有 `tests/exportRange.test.ts` 覆盖范围。
- [x] 检查 Rust exporter 字段定义、格式 writer 和命令入参。

### 阶段 2: 抽取可复用日期范围能力

- [x] 判断当前数据页 range picker 是否可直接抽成 shared primitive。
- [x] 如果组件含数据页专属文案或 metric 状态，先拆出无业务语义的底层组件。
- [x] 新增或迁移共享 range 类型，避免 `features/export` 直接 import `features/data`。
- [x] 支持导出需要的 `day`、`week`、`month`、`year`、`custom`。
- [x] 保持数据页现有 `week`、`month`、`year`、`custom` 行为不变。
- [x] 保留数据页现有测试并补充共享 range 计算测试。
- [x] 确认日期逻辑统一处理本地时区。
- [x] 确认 endExclusive 计算在 DST 或跨月场景不倒退。

### 阶段 3: 定义导出偏好持久化模型

- [x] 先搜索现有 UI preference 持久化模式。
- [x] 如果已有同类 localStorage preference，复用同类封装和 key 命名风格。
- [x] 如果已有平台设置表适合 UI 偏好，按现有设置 gateway 接入。
- [x] 不把导出偏好绑定到设置页保存/取消。
- [x] 定义 `rangeMode` 类型：`day | week | month | year`。
- [x] 定义 `format` 类型：`csv | sqlite | parquet`。
- [x] 首装默认 `rangeMode = month`。
- [x] 首装默认 `format = csv`。
- [x] 读取到非法持久化值时回退默认值。
- [x] 写入持久化失败时不阻断导出，只回退到内存状态并提示开发日志。

### 阶段 4: 设置页入口收敛

- [x] 从设置页平铺区域移除 `<Export embedded ... />`。
- [x] 在存储/数据安全区域新增 `数据导出` 行卡。
- [x] 行卡复用现有 Quiet Pro row/action 样式。
- [x] 行卡右侧按钮文案为 `导出`。
- [x] 点击按钮打开导出弹窗。
- [x] 关闭弹窗后设置页滚动位置不应跳动。
- [x] 设置页保存/取消按钮不受导出弹窗影响。
- [x] 设置页未保存状态不因打开或关闭导出弹窗而变化。

### 阶段 5: 重组导出弹窗

- [x] 将当前 `Export` 平铺组件改造成弹窗内容组件，或新增 `ExportDialog` 并复用内部状态。
- [x] 弹窗打开时加载持久化偏好。
- [x] 弹窗关闭时保留已持久化格式和范围模式。
- [x] 时间范围区使用阶段 2 的共享 range picker。
- [x] 格式区使用 Quiet Pro segmented/card control，不使用大面积高亮。
- [x] 字段区只展示摘要和 `配置字段`。
- [x] 弹窗内不展示输出路径输入区；点击导出时直接打开系统保存位置选择器。
- [x] 导出中禁用会造成状态冲突的控件。
- [x] 导出成功后显示成功状态。
- [x] 导出失败后显示可读错误，不吞掉原始错误上下文。

### 阶段 6: 字段配置 UI 分组

- [x] 将字段列表分为默认字段、分析字段、高级字段。
- [x] 默认字段首装全选。
- [x] 高级字段默认折叠。
- [x] 分类字段 `category` 位于默认字段靠前位置。
- [x] 字段配置弹窗显示每组已选数量。
- [x] 支持全选/取消组内字段。
- [x] 保留字段排序能力。
- [x] 禁止取消到 0 个字段后继续导出。
- [x] 关闭字段配置后，主弹窗摘要更新为 `已选 / 总数 个字段`。
- [x] 字段列表文案中说明 `category` 使用当前分类规则。

### 阶段 7: 后端字段扩展

- [x] 找到 Rust exporter 的统一字段定义。
- [x] 新增 `category` 字段输出。
- [x] 接入当前 app/domain 分类规则，不新增历史分类快照。
- [x] 对 app 记录和 web 记录分别处理分类来源。
- [x] 新增分析字段的值计算。
- [x] 新增高级字段的值读取或降级策略。
- [x] 确保没有值的字段输出为空值，而不是字符串 `undefined`。
- [x] 确保 CSV 表头、SQLite schema、Parquet schema 字段顺序一致。
- [x] 确保字段选择为空时 Rust 侧返回明确错误。
- [x] 确保新增字段不会破坏既有 11 字段导出。

### 阶段 8: 保存位置和格式一致性

- [x] 弹窗内不保留输出路径输入框。
- [x] 点击导出后打开系统保存位置选择器。
- [x] 用户取消系统选择器时安静退出，不提示错误。
- [x] 用户选择保存位置后，按当前导出格式校正扩展名。
- [x] 导出前再次校验路径扩展名。
- [x] CSV 使用 `.csv`。
- [x] SQLite 使用 `.sqlite` 或沿用现有实现的稳定扩展名。
- [x] Parquet 使用 `.parquet`。

### 阶段 9: Quiet Pro 视觉整理

- [x] 扫描导出相关 TSX/CSS 中新增的颜色硬编码。
- [x] 扫描新增圆角、阴影、border 硬编码。
- [x] 移除 glow 或重阴影。
- [x] 确认弹窗没有卡片套卡片的视觉问题。
- [x] 确认按钮、chip、segmented control 有 default、hover、active、focus、disabled 状态。
- [x] 确认中文长文案在窄宽度下不溢出。
- [x] 确认弹窗在 1366 宽度和较小高度下可滚动且操作按钮可达。

### 阶段 10: 测试补充

- [x] 补充 range 计算测试：本日、本周、本月、本年。
- [x] 补充右箭头未来禁用逻辑测试。
- [x] 补充自定义范围不覆盖持久化 rangeMode 测试。
- [x] 补充格式持久化测试。
- [x] 补充非法持久化值回退测试。
- [x] 补充字段分组和默认选中测试。
- [x] 补充空字段禁用导出测试。
- [x] 补充后端空字段拒绝导出测试。
- [x] 补充 `category` 导出测试。
- [x] 补充 CSV、SQLite、Parquet 字段顺序一致性测试。

### 阶段 11: 验证命令

最小定向验证：

- [x] `npm run test:export`
- [x] `npm run test:data-range`
- [x] `npm run test:settings`
- [x] `npm run check:types`
- [x] `npm run check:naming`
- [x] `npm run check:architecture`
- [x] `npm run check:rust-boundaries`

完整前端验证：

- [x] `npm run check:frontend`

Rust 验证：

- [x] `npm run check:rust`

最终综合验证：

- [x] `npm run check:full`

构建验证：

- [x] `npm run build`

### 阶段 12: 手动验收

- [x] 启动开发版。
- [x] 打开设置页。
- [x] 确认设置页只显示 `数据导出` 行卡，不再平铺完整导出表单。
- [x] 点击 `导出`。
- [x] 确认弹窗打开且默认范围为 `本月`。
- [x] 确认默认格式为 `CSV`。
- [x] 切换到 `本日`、`本周`、`本年` 后关闭再打开，确认范围模式被记住。
- [x] 选择自定义范围后关闭再打开，确认不会把持久化范围模式改成自定义。
- [x] 切换格式后关闭再打开，确认格式被记住。
- [x] 打开字段配置，确认有默认字段、分析字段、高级字段。
- [x] 确认默认字段包含 `category`。
- [x] 取消所有字段后确认导出按钮禁用。
- [x] 重新选择字段后点击导出，在系统保存对话框中选择路径。
- [x] 分别试导出 CSV、SQLite、Parquet。
- [x] 检查导出文件包含所选字段且顺序一致。
- [x] 检查 `category` 使用当前分类规则。
- [x] 修改某个 app/domain 分类后重新导出同一历史范围，确认 `category` 随当前规则变化。
- [x] 确认设置页保存/取消状态没有被导出弹窗污染。
- [x] 确认弹窗无 glow、无重阴影、无明显硬编码视觉突兀点。

## 文件影响预估

可能需要修改：

- [x] `src/features/settings/pages/Settings.tsx`
- [x] `src/features/settings/components/SettingsDataSafetyPanel.tsx`
- [x] `src/features/export/components/Export.tsx`
- [x] `src/features/export/**`
- [x] `src/features/data/components/DataTrendRangePicker.tsx`
- [x] `src/features/data/model/dataTrendRange.ts`
- [x] `src/shared/**` 或其他 owner-first 的共享 range 位置。
- [x] `src/platform/**` 中现有 preference 或 persistence gateway。
- [x] `src-tauri/src/engine/export/**`
- [x] `src-tauri/src/commands/export.rs`
- [x] `tests/exportRange.test.ts`
- [x] `tests/dataTrendRange.test.ts`
- [x] `tests/settingsPageState.test.ts`
- [x] 新增必要测试文件。

原则：

- [x] 不新增 `src/lib/` 或 `src/types/` 这类已退出根层。
- [x] 不把临时共享能力塞进 `shared`，除非它确实稳定且跨 feature。
- [x] 不让 Tauri command regrow 厚业务逻辑。

## 验收标准

- [x] 设置页导出入口收敛为行卡。
- [x] 导出弹窗完整承载导出流程。
- [x] 范围交互与数据页一致。
- [x] `本月` 是首装默认范围模式。
- [x] `CSV` 是首装默认格式。
- [x] 范围模式和格式持久化。
- [x] 自定义范围不覆盖持久化范围模式。
- [x] 默认字段从 11 个扩展到至少 12 个，并包含 `category`。
- [x] 字段配置有默认、分析、高级三组。
- [x] `category` 按当前分类规则计算。
- [x] CSV、SQLite、Parquet 字段顺序一致。
- [x] 空字段不能导出。
- [x] Quiet Pro 视觉约束通过人工检查。
- [x] 定向测试、前端验证、Rust 验证和构建验证通过。
- [x] 执行完成后本文被勾选更新并归档。

## 风险和处理

- [x] 如果数据页 range picker 直接抽取会造成大量回归，先抽取无业务 primitive，再让数据页和导出分别包一层 feature adapter。
- [x] 如果某些高级字段没有稳定来源，不强行拼接不可靠数据；先降级为不导出，并在执行记录中写明。
- [x] 如果分类规则查询成本过高，先做导出时批量预取或缓存，不在每条记录上重复查库。
- [x] 如果 Parquet schema 对可选字段要求更严格，统一 nullable 策略，避免三种格式语义分裂。
- [x] 如果持久化偏好和设置系统边界不清，优先按现有 UI preference 模式实现，不把它接进设置页保存/取消。

## 执行记录

- [x] 完成时间：2026-07-07。
- [x] 设置页导出入口已收敛为 `数据导出` 行卡，完整导出流程进入弹窗。
- [x] 导出范围复用共享 Quiet Pro 日期范围选择器，支持本日、本周、本月、本年和自定义范围。
- [x] 导出范围模式和格式已持久化；首装默认 `本月` + `CSV`。
- [x] 字段总数扩展为 32 个，分为默认字段、分析字段、高级字段。
- [x] `category`、`category_id`、`category_color` 按导出时当前分类规则计算，不写历史快照。
- [x] CSV、SQLite、Parquet 均支持新字段，并保持用户选择顺序。
- [x] 未发现需要降级或移除的字段。
- [x] 验证通过：`npm run check:full`。
- [x] 额外定向验证通过：`cargo test --manifest-path src-tauri/Cargo.toml export --quiet`。
- [x] 追加 UI 调整：移除导出弹窗内输出路径输入区，点击 `导出` 直接打开系统保存位置选择器。
- [x] 追加定向验证通过：`npm run check:types`、`npm run test:ui-smoke`、`npm run test:export`。

## 归档要求

- [x] 实现完成后回到本文勾选已完成项。
- [x] 记录最终验证命令和结果。
- [x] 记录实际新增字段总数。
- [x] 记录任何字段降级或范围变更。
- [x] 将本文移动到 `docs/archive/`。
- [x] 最终汇报中说明归档路径。
