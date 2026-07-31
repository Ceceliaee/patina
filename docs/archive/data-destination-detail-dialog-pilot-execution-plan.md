# 数据页对象详情弹层试点执行方案

## 0. 文档信息

- 文档类型：一次性执行方案。
- 目标读者：Patina 维护者与后续实现者。
- 当前状态：已完成、已验证、已执行对抗式审查并归档。
- 创建日期：2026-07-30。
- 当前执行范围：仅改造 `Data / 数据` 页。
- 归档位置：`docs/archive/data-destination-detail-dialog-pilot-execution-plan.md`。
- 长期依据：
  - `docs/product-principles-and-scope.md`
  - `docs/roadmap-and-prioritization.md`
  - `docs/engineering-quality.md`
  - `docs/quiet-pro-component-guidelines.md`
  - `docs/architecture.md`
  - `docs/issue-fix-boundary-guardrails.md`

本文是实现前的唯一执行依据，不替代上述长期文档。

## 1. 背景

数据页的“应用趋势 / 网页趋势”模块目前已经具备：

- 普通点击回到单选。
- `Ctrl + 点击` 增减多选。
- 应用与网页分别保留会话内选择。
- 最多同时比较 7 个对象。
- 多选线条按选择顺序呈现。
- 趋势图和对象热力图按当前范围展示。
- 趋势图或热力格双击可进入对应日期的历史页。
- 列表底部已经显示“`双击详情 · Ctrl 多选`”提示。

但“对象双击详情”仍只有提示，没有实际功能。当前页面可以回答“哪些应用或网页占用了时间”，还不能在不离开数据页的情况下继续回答：

- 这个对象在所选时期内如何变化。
- 哪一天值得进一步查看。
- 这一天具体在什么时间段出现。
- 对应的窗口标题或网页记录是什么。

本轮以数据页为试点，验证一个不属于导航、不切换路由、只分析单个对象的大尺寸详情弹层。

## 2. 第一性原理

### 2.1 比较与检查是两种任务

数据页现有模块负责横向比较：

- 单选用于查看一个对象。
- 多选用于比较多个对象。
- 趋势和热力图负责说明长期变化与节奏。

详情弹层负责纵向检查：

- 一次只检查一个对象。
- 从范围趋势逐步进入某一天。
- 从某一天进入日内时间轴和活动记录。

两个任务不能混成一个界面。详情弹层不承担多对象比较，数据页主体也不继续堆叠时间轴和记录列表。

### 2.2 对象、范围、日期必须彼此独立

详情分析至少包含三个独立状态：

1. 对象：某个应用或某个网页域名。
2. 范围：近 7 天、近 30 天、近一年、自然周、自然月、自然年或自定义范围。
3. 聚焦日期：时间轴和记录列表当前解释的某一天。

不能用“当前选中对象”隐式替代详情对象，也不能用趋势范围的结束日期无条件替代聚焦日期。

### 2.3 只显示可证明的数据

- 趋势使用现有有效活动聚合口径。
- 应用时间轴使用精确 session 和已保存的标题样本。
- 网页时间轴使用精确网页活动片段。
- 没有标题时明确显示未记录状态，不拼接或推断不存在的标题。
- 没有活动时显示空状态，不伪造零值片段。
- 当前活动的结束位置按现有实时边界裁剪，不写回数据库。

### 2.4 复用已稳定的日期规则

详情弹层必须使用数据页现有的日期范围组件和算法：

- `DataTrendRangeControl`
- `DataTrendRangePicker`
- `QuietDateRangePicker`
- `resolveDataTrendRange`
- `getAdjacentDataTrendRangeSelection`

不为详情弹层新增第二套周、月、年、自定义或恢复逻辑。

### 2.5 先验证真实需求，再扩大共享边界

长期目标可以让今天、历史和数据页都打开同一个对象详情层，但本轮只有数据页是确认范围。

因此：

- 本轮 owner 是 `features/data`。
- 不提前新增应用级全局详情 Provider。
- 不提前把详情状态塞进 `app/*`。
- 不因为未来可能复用就把 Data 私有业务组件放进 `shared/*`。
- 第二个页面真正接入时，再根据已经稳定的 props、读模型和交互语义决定是否提升 owner。

## 3. 已确认决策

- [x] 当前只改数据页。
- [x] 应用与网页对象都纳入试点。
- [x] 双击对象行或对象图标打开详情。
- [x] 弹层不属于左侧导航，不增加新路由。
- [x] 弹层不显示应用热力图或网页热力图。
- [x] 弹层复用数据页现有日期范围控件和日历。
- [x] 弹层一次只分析一个对象。
- [x] 数据页现有 Ctrl 多选继续承担比较。
- [x] 弹层关闭后保留原数据页的选择、模式、范围和滚动位置。
- [x] 趋势图和热力格双击进入历史日期的现有语义不变。
- [x] 弹层内部不显示“应用 / 网页”切换；对象自身已经决定类型。
- [x] 弹层内部不显示左侧导航栏或复制页面标题栏。
- [x] 本轮不接入今天页和历史页。

## 4. 目标

### 4.1 用户目标

用户在数据页双击某个应用或网页后，可以在同一页面上下文中：

1. 确认正在分析的对象。
2. 使用与数据页一致的日期范围控件切换分析时期。
3. 查看该对象在时期内的趋势和摘要。
4. 选择或移动到某一天。
5. 查看这一天的 24 小时时间轴。
6. 查看这一天的精确活动记录。
7. 关闭弹层并返回原来的比较状态。

### 4.2 产品目标

- 增强 Data 的长期活动理解效率。
- 不把数据页扩张成新的 History 页面。
- 不改变时间统计口径。
- 不引入新的持久化状态。
- 用一次局部试点验证未来全局详情层是否值得推广。

### 4.3 工程目标

- 保持 Data feature 自闭环。
- 复用现有日期范围和 Quiet Dialog 能力。
- 复用现有聚合与精确日数据通道。
- 将日期、对象身份、请求时序和展示模型写成可单测的纯逻辑。
- 防止弹层加载造成数据页白屏、闪烁或选择跳动。

## 5. 非目标

本轮明确不做：

- [x] 不给今天页增加入口。
- [x] 不给历史页增加入口。
- [x] 不新增第四个导航页面。
- [x] 不新增 URL、路由或浏览器历史记录。
- [x] 不把弹层提升为应用级全局 Provider。
- [x] 不在弹层中加入热力图。
- [x] 不支持多个对象的联合详情。
- [x] 不在弹层中切换应用与网页类型。
- [x] 不增加分类编辑、重命名、配色或删除记录功能。
- [x] 不修改 Web Sync 协议。
- [x] 不修改浏览器扩展。
- [x] 不增加数据库 migration。
- [x] 不新增云端、账号或跨设备状态。
- [x] 不为弹层范围单独发明日期组件。
- [x] 不改变数据页趋势图或热力格双击进入历史的行为。
- [x] 不把 History 私有 React 组件直接导入 Data。
- [x] 不为了试点复制完整 History 页面。

## 6. 当前代码事实

### 6.1 数据页入口

当前主要文件：

- `src/features/data/components/Data.tsx`
- `src/features/data/components/DataAppTrendPanel.tsx`
- `src/features/data/services/dataDestinationState.ts`
- `src/features/data/services/dataDestinationSessionState.ts`
- `src/styles/features/data.css`

当前列表行是 `button`：

- `onClick` 负责普通单选或 Ctrl 多选。
- `Ctrl + Enter / Ctrl + Space` 负责键盘多选。
- 尚未绑定对象详情双击。

### 6.2 已选图标

`DataAppTrendPanel` 头部会按 `selectedOptions` 顺序渲染已选对象图标，但当前：

- 图标是 `span`。
- 图标被标记为 `aria-hidden`。
- 图标没有详情交互。

如果本轮让已选图标成为入口，必须把它改成真实可访问控件，不能只在 `span` 上添加鼠标事件。

### 6.3 已占用的双击语义

`Data.tsx` 当前已经维护：

- 总趋势活动日期。
- 目的地趋势活动日期。
- 趋势图双击进入历史日期。
- 热力格双击进入历史日期。

对象详情双击只能绑定到对象行或对象图标，不能冒泡到趋势图和热力格容器。

### 6.4 日期范围

`DataTrendRangeControl` 已经提供：

- 默认滚动范围。
- 自然周、月、年。
- 自定义范围。
- 左右相邻范围导航。
- 特殊范围恢复到近 7 天。
- 与 `QuietDateRangePicker` 对接的日历弹层。

详情弹层应直接使用该组件，不复制其 JSX 和日期算法。

### 6.5 弹层基础

`QuietDialog` 已经提供：

- `createPortal(document.body)`。
- 模态语义。
- Escape 关闭。
- 焦点圈定。
- 关闭后恢复焦点。
- 背景遮罩。
- Quiet Pro token、边框、圆角和阴影。

详情弹层应扩展 `surfaceClassName`，不新增第二套 Dialog 基础设施。

### 6.6 数据通道

范围趋势已有：

- 应用聚合：`loadDataTrendSnapshot` 与 `buildDataAppTrendViewModelFromAggregate`。
- 网页聚合：`loadDataWebActivitySnapshot` 与 `buildDataWebTrendViewModel`。
- 网页聚合的 typed Rust command 与缓存通道。

精确日数据已有：

- 应用：`getHistoryByDate` / `getSessionsInRange`。
- 网页：`getWebActivitySegmentsInRange`。
- 应用标题样本：`HistorySession.titleSampleDetails`。
- 网页标题与 URL：`WebActivitySegment.title` / `url`。

本轮应先复用这些已有通道。只有证明确实无法满足单日读取或身份过滤时，才允许升级为新的 typed command。

## 7. 信息架构

### 7.1 弹层结构

```text
┌──────────────────────────────────────────────────────────────┐
│ [图标] 对象名称                               [日期范围] [×] │
│        exe / domain                                         │
├──────────────────────────────────────────────────────────────┤
│ 总时长          日均/月均        活跃天数        峰值日      │
├──────────────────────────────────────────────────────────────┤
│ 使用趋势                                                     │
│                                                              │
│                        单对象趋势图                          │
├──────────────────────────────────────────────────────────────┤
│ 聚焦日期                                      [上一日][下一日]│
│                                                              │
│ 00:00 ────── ███ ── ██ ───────── █████ ──────── 24:00       │
├──────────────────────────────────────────────────────────────┤
│ 活动记录                                                     │
│ 10:22–10:48  标题 / 页面                           26m       │
│ 11:03–11:16  标题 / 页面                           13m       │
└──────────────────────────────────────────────────────────────┘
```

### 7.2 视觉层级

从高到低：

1. 对象身份与关闭动作。
2. 日期范围控制。
3. 四项摘要。
4. 趋势。
5. 聚焦日期。
6. 日内时间轴。
7. 活动记录。

不增加装饰性大标题、渐变背景、玻璃模糊、发光或营销式说明。

### 7.3 弹层尺寸

- 复用 `QuietDialog`。
- 宽度参考现有 History 扩展时间轴弹层，不新造视觉体系。
- 目标宽度约为 `min(1180px, calc(100vw - 64px))`，最终以现有支持窗口的视觉验证调整。
- 最大高度不超过视口减去 Quiet Pro 外边距。
- Header 固定在 Dialog 结构上部。
- Body 独立纵向滚动并使用稳定 scrollbar gutter。
- 不让背景数据页随弹层内容滚动。
- 不复制左侧导航、数据页标题卡或应用外壳。

### 7.4 响应式

- 宽屏：摘要四列，趋势和时间轴使用完整横向空间。
- 中等宽度：摘要保持四列或按现有指标最小宽度收缩。
- 窄屏：摘要改为两列；日期控件可以换行但 DOM 顺序不变。
- 任何支持宽度下不产生页面级横向滚动。
- 时间轴允许内部最小宽度，但不能把 Dialog 撑出视口。

## 8. 交互契约

### 8.1 对象列表

| 操作 | 结果 |
| --- | --- |
| 普通点击对象行 | 替换为单选 |
| Ctrl + 点击对象行 | 增加或移除比较对象 |
| 双击对象行 | 打开该对象详情 |
| Space | 普通单选 |
| Ctrl + Space | 增减多选 |
| Enter | 打开当前聚焦对象详情 |
| Ctrl + Enter | 保留现有增减多选 |

键盘事件必须显式拦截，避免 Enter 打开详情后又触发普通点击。

### 8.2 已选图标

- 每个已选图标使用真实 `button` 或等价可访问控件。
- 双击图标打开对应对象详情。
- 键盘聚焦后按 Enter 打开详情。
- 单击图标不改变选择顺序。
- 控件具有对象名称和“查看详情”的可访问名称。
- 不在图标旁新增持久可见文字按钮。
- 图标顺序继续等于 Ctrl 加入顺序。

### 8.3 双击与多选状态

目标语义：

- 双击只决定要检查的对象。
- 详情弹层不重新定义比较集合。
- 关闭弹层后，比较集合与打开前一致。

实现必须保存：

- 打开前的应用选择 key 顺序。
- 打开前的网页选择 key 顺序。
- 当前应用/网页模式。
- 左侧列表 scrollTop。
- 打开触发元素。

对象行的原生双击会先产生普通点击。实现时必须选择一种可证明的状态策略：

1. 在首个 pointer down 捕获比较状态快照。
2. 双击确认后以快照作为关闭恢复状态。
3. 打开弹层时将后台比较状态恢复为快照，避免弹层期间刷新错误对象。
4. 不通过长期延迟所有单击来等待双击。

如果实现无法在不产生明显选择闪烁的情况下完成，应暂停并重新评估入口事件模型，不能把闪烁作为既定结果接受。

### 8.4 图表和热力格

- 数据页主体趋势图双击：继续打开历史日期。
- 数据页主体对象热力格双击：继续打开历史日期。
- 详情弹层趋势图单击某个日点：改变聚焦日期。
- 详情弹层趋势图双击不跳转历史，避免弹层内出现第二套离开路径。
- 月粒度趋势点单击：将弹层自己的范围切换到对应自然月，再显示日粒度趋势。
- 弹层关闭不修改数据页主体范围。

### 8.5 关闭

- Escape 关闭。
- 右上角关闭按钮关闭。
- 点击遮罩关闭，因为弹层没有未保存编辑。
- 关闭后恢复打开前焦点。
- 如果原触发元素已卸载，焦点退回对象列表容器或当前选中对象行。
- 关闭后恢复列表滚动位置。

## 9. 日期与时间语义

### 9.1 范围状态

弹层拥有自己的 `DataTrendRangeSelection`：

- 打开时复制数据页目的地面板当前范围。
- 弹层内修改范围不写回数据页。
- 同一次打开期间保留弹层自己的范围。
- 关闭后销毁本次弹层范围。
- 再次打开时重新从数据页当前范围初始化。

这能确保所有入口使用同一个日历，同时不会让弹层操作悄悄改变背景比较页。

### 9.2 范围控件

直接复用：

```text
[恢复] [上一范围] [近 7 天 / 第 N 周 / N 月 / N 年 / 自定义] [下一范围]
```

- 默认滚动范围没有恢复按钮。
- 自然周、月、年和自定义范围显示无占位的恢复按钮。
- 左右导航语义与数据页主体完全相同。
- 未来范围禁用规则完全相同。
- 点击中间按钮打开同一个 `DataTrendRangePicker`。

### 9.3 聚焦日期

聚焦日期独立于范围：

- 首次打开优先选择当前范围内最近一个有该对象记录的日期。
- 当前范围没有记录时选择范围结束日期，并显示空状态。
- 单击日粒度趋势点更新聚焦日期。
- 上一日、下一日按本地日历日移动，不跳过无活动日期。
- 聚焦日期不能越出当前范围。
- 聚焦日期不能进入未来。
- 范围变化后：
  - 原聚焦日期仍在新范围内则保留。
  - 否则选择新范围内最近一个有记录的日期。
  - 仍无记录则选择新范围结束日期。

### 9.4 月粒度

近一年或自然年可使用月粒度趋势：

- 月点本身不能直接作为 24 小时时间轴日期。
- 单击月点后，将弹层范围切换为对应自然月。
- 自然月加载完成后选择该月最近一个有记录的日期。
- 用户可使用恢复按钮回到近 7 天。

### 9.5 本地时间

- 所有日边界使用本地日历日。
- 不使用固定 `24 * 60 * 60 * 1000` 代替日历日移动。
- DST 环境下日范围允许不是固定 24 小时，但可见坐标仍按当地 00:00–24:00 解释。
- 当前日活动片段裁剪到当前时间。

## 10. 对象身份

### 10.1 详情目标

建议定义 Data 私有类型：

```ts
type DataDestinationDetailTarget = {
  mode: "app" | "web";
  key: string;
  identityKeys: string[];
  displayName: string;
  secondaryText: string;
  iconUrl: string | null;
  color: string;
};
```

### 10.2 应用身份

不能只用展示名或 `exeName` 文本相等过滤精确 session。

必须：

- 使用与数据统计相同的 `resolveStatisticalDataAppKey`。
- 保留合并应用对象对应的 `sourceAppKeys`。
- 将 `sourceAppKeys` 传入详情 target 的 `identityKeys`。
- 精确日 session 的归一 key 命中任一 `identityKeys` 才属于当前对象。
- 用户别名只改变显示，不改变统计身份。
- 分类映射、别名合并和排除统计继续服从现有口径。

如果当前 `DataAppOption` 没有暴露 `sourceAppKeys`，应在 Data read model 内补齐明确字段，而不是在 Dialog 中猜测。

### 10.3 网页身份

- 以标准化后的 `normalizedDomain` 为唯一 key。
- 大小写、前后空格和历史 domain 展示差异不能产生两个详情对象。
- 展示名继续使用网页覆盖规则。
- favicon 继续使用现有缓存结果。
- Web Sync 关闭时网页模式本身隐藏，因此不能打开网页详情。

## 11. 读模型设计

### 11.1 文件 owner

建议新增或扩展：

- `src/features/data/components/DataDestinationDetailDialog.tsx`
- `src/features/data/components/DataDestinationDetailTimeline.tsx`
- `src/features/data/components/DataDestinationDetailRecords.tsx`
- `src/features/data/hooks/useDataDestinationDetail.ts`
- `src/features/data/services/dataDestinationDetailState.ts`
- `src/features/data/services/dataDestinationDetailReadModel.ts`
- `src/features/data/services/dataDestinationDetailSnapshot.ts`
- `src/shared/copy/domains/dataCopy.ts`
- `src/styles/features/data.css`

文件是否拆分以真实复杂度为准。不得为了目录对称创建没有职责的空文件。

### 11.2 范围趋势

应用：

- 复用 `loadDataTrendSnapshot`。
- 复用 `buildDataAppTrendViewModelFromAggregate`。
- 只传入详情对象的 identity。
- 单对象线条使用对象颜色。
- 不渲染图例。

网页：

- 复用 `loadDataWebActivitySnapshot`。
- 复用 `buildDataWebTrendViewModel`。
- 只传入一个标准化 domain。
- 不发热力图请求。
- 不因为详情弹层再维护第二套 Web 热力图缓存。

### 11.3 精确日数据

应用：

- 使用 `getHistoryByDate` 或等价单日精确读取。
- 读取 title samples。
- 将 session 裁剪到聚焦日边界。
- 使用统一应用身份 helper 过滤。
- 对当前仍活跃 session 使用现有实时结束边界。

网页：

- 使用 `getWebActivitySegmentsInRange` 读取聚焦日。
- 按 `normalizedDomain` 过滤。
- 将片段裁剪到聚焦日边界。
- 对结束时间为空的活动片段按现有 current-time 规则裁剪。

### 11.4 时间轴

Data feature 内创建只服务单对象的纯 view model：

- 输入为已过滤的应用 session 或网页 segment。
- 输出统一的时间轴 segment。
- 每个 segment 至少包含：
  - `id`
  - `startTime`
  - `endTime`
  - `duration`
  - `startRatio`
  - `endRatio`
  - `title`
  - `secondaryText`
- 坐标范围固定为聚焦日 00:00–24:00。
- 相邻且标题相同的片段可以按现有合并阈值合并。
- 标题不同的片段不能为了视觉简化而合并。
- 重叠片段不能重复累计总时长。

本轮不直接导入 `features/history/components/*`。如果实现过程中发现纯时间轴几何与 History 完全相同，应先做边界判断；只有语义已经稳定且两个 feature 都是真实消费者时，才允许提取低上下文的 shared 纯能力。

### 11.5 活动记录

记录列表按开始时间升序：

- 开始与结束时间。
- 持续时长。
- 窗口标题或网页标题。
- 应用可补充可证明的标题样本。
- 网页可补充可证明的 URL 或 domain。
- 过长文本单行截断，悬停或聚焦提供完整文本。
- 未记录标题时显示统一 unavailable 文案。
- 不把应用名或 domain 伪装成被记录的页面标题。

### 11.6 摘要

继续使用现有四项：

- 总时长。
- 日均或月均。
- 活跃天数。
- 峰值日。

摘要来自当前弹层范围的单对象趋势读模型，不从活动记录列表重新求和。

## 12. 状态与请求时序

### 12.1 状态模型

建议由 `useDataDestinationDetail` 持有：

- `open`
- `target`
- `rangeSelection`
- `resolvedRange`
- `focusedDateKey`
- `trendSnapshot`
- `daySnapshot`
- `trendStatus`
- `dayStatus`
- `trendRequestKey`
- `dayRequestKey`
- `selectionSnapshot`
- `listScrollSnapshot`
- `triggerElement`

### 12.2 冷启动

- 双击后在同一帧打开稳定尺寸的 Dialog shell。
- 对象图标、名称、secondary text 和当前范围可立即从列表状态显示。
- 趋势与日详情分别加载。
- 冷加载只显示局部 skeleton，不隐藏整个 Dialog。
- Skeleton 尺寸等于 ready 内容的主要几何。

### 12.3 范围切换

- 新趋势请求开始时保留旧趋势，标记为 refreshing。
- 新结果完成后一次性提交。
- 不先清空图表再加载。
- 不卸载 Dialog。
- 不改变背景 Data 面板 ready 状态。

### 12.4 日期切换

- 新日请求开始时保留时间轴外框与记录列表高度。
- 可以淡化旧内容并显示局部更新状态。
- 新结果完成后替换。
- 快速连续切换日期时，旧请求不能覆盖新日期。

### 12.5 请求身份

趋势 request key 至少包含：

- mode
- object key
- resolved range cache key
- mapping/cache version

日详情 request key 至少包含：

- mode
- object key
- focused date key
- mapping/cache version

每次提交结果前校验当前 request key。

### 12.6 关闭与重开

- 关闭时取消或忽略未完成请求。
- 已完成范围趋势可以复用现有缓存。
- 不为单日详情增加无界缓存。
- 如果增加短期缓存，必须有明确上限和清理入口。
- 重新打开另一对象时不得短暂显示上一对象的标题或记录。

## 13. Loading、Empty 与 Error

### 13.1 冷加载

- Header 和日期控件立即可见。
- 摘要显示稳定占位。
- 趋势区显示固定高度 skeleton。
- 时间轴和记录区显示固定高度 skeleton。
- 不出现整块纯白或纯空 Dialog。

### 13.2 无范围数据

- 摘要显示 0 或 `-`，按现有数据页语义选择。
- 趋势显示空状态。
- 聚焦日期使用范围结束日期。
- 时间轴显示“当天没有该对象的活动记录”。
- 记录列表为空。

### 13.3 无标题

- 时间片段仍显示。
- 标题位置显示“未记录标题”或网页等价文案。
- 不把空标题当作加载失败。

### 13.4 请求失败

- 趋势失败和日详情失败分别处理。
- 一个区域失败不阻止另一区域显示。
- 有旧数据时保留旧数据并提示更新失败。
- 无旧数据时显示局部错误和重试。
- 不自动关闭弹层。

## 14. 无障碍

- `QuietDialog` 提供 `role="dialog"`、`aria-modal` 和焦点圈定。
- Dialog 标题包含对象名称。
- 图标必须有可访问名称。
- 关闭按钮有明确中文/英文标签。
- 日期范围控件继续使用现有 aria 文案。
- 时间轴具有说明对象与日期的 `aria-label`。
- 每条记录可以通过键盘聚焦或被读屏顺序读取。
- 颜色不是区分时间片段状态的唯一方式。
- 聚焦趋势点后，读屏可获得日期与时长。
- Escape 关闭后焦点回到原入口。
- Enter 打开详情；Space 保留选择语义。
- 不使用只有鼠标双击才能完成的唯一入口。

## 15. 文案

在 `dataCopy` 中集中补充，禁止组件内硬编码中英文。

建议语义：

- 详情标题：对象名称。
- 对象类型辅助文本：`应用` / `网页`。
- 趋势标题：`使用趋势`。
- 时间轴标题：`日内时间轴`。
- 记录标题：`活动记录`。
- 上一日 / 下一日。
- 未记录标题。
- 当天没有该对象的活动记录。
- 加载详情失败。
- 重试。
- 查看对象详情。

英文必须同步补齐。

## 16. 分阶段执行步骤

### 阶段 0：实施前基线

- [x] 读取本文与长期规范。
- [x] 检查工作树，区分用户既有改动。
- [x] 已尝试读取 live Project；本机 `gh` keyring 凭据失效，未能取得可信的 live Project 结果，也未修改任何远端状态。
- [x] 因未能确认对应现有事项，不提供无依据的 `In progress` 拖动建议；该异常不阻塞本地产品实现。
- [x] 记录当前 Data 相关聚焦测试结果。
- [x] 记录并核对当前数据页宽屏、窄屏、浅色、深色基线；完成后用真实 Chromium 多视口、多 DPI 和双主题场景复验。
- [x] 验证普通点击、Ctrl 多选、趋势双击、热力格双击当前均正常。
- [x] 确认 Web Sync 开启与关闭两种基线。

退出条件：

- [x] 范围、owner、现有行为和回归基线已确认。

### 阶段 1：锁定对象身份与交互状态

目标文件：

- `src/features/data/services/dataDestinationState.ts`
- `src/features/data/services/dataDestinationDetailState.ts`
- `tests/dataDestinationState.test.ts`
- 新增详情状态单测文件。

步骤：

- [x] 定义 `DataDestinationDetailTarget`。
- [x] 为应用目标保留 `sourceAppKeys / identityKeys`。
- [x] 为网页目标固定 normalized domain。
- [x] 增加从 panel option 构建 detail target 的纯函数。
- [x] 增加打开前选择快照类型。
- [x] 增加聚焦日期解析纯函数。
- [x] 增加范围变化后聚焦日期协调纯函数。
- [x] 增加月点进入自然月的纯函数。
- [x] 增加 request key 编码函数。
- [x] 不把 React、DOM 或请求写进纯状态文件。

单测：

- [x] 合并应用身份能命中全部 source keys。
- [x] 网页 domain 大小写归一。
- [x] 最近有活动日期正确。
- [x] 无活动时回退范围结束日期。
- [x] 范围缩小后聚焦日期正确迁移。
- [x] 月点正确进入自然月。
- [x] request key 对 mode、对象、范围和日期敏感。

退出条件：

- [x] 对象身份和日期状态不依赖组件临时判断。

### 阶段 2：实现单对象趋势读模型

目标文件：

- `src/features/data/services/dataDestinationDetailReadModel.ts`
- `src/features/data/services/dataDestinationDetailSnapshot.ts`
- `src/features/data/hooks/useDataDestinationDetail.ts`
- 现有 Data 聚合服务的最小扩展。

步骤：

- [x] 应用详情复用现有 aggregate snapshot。
- [x] 网页详情复用现有 web aggregate snapshot。
- [x] 网页详情不触发热力图请求。
- [x] 单对象摘要与趋势使用现有统计口径。
- [x] 趋势颜色使用对象颜色。
- [x] 不渲染图例。
- [x] 增加有界缓存或复用现有缓存，不创建无界 Map。
- [x] 加入 request key 和 stale response 防护。
- [x] 保留旧趋势直到新趋势 ready。
- [x] 错误状态与 refreshing 状态分离。

单测：

- [x] 应用趋势与数据页同对象同范围结果一致。
- [x] 网页趋势与数据页同 domain 同范围结果一致。
- [x] 多选背景不影响单对象详情。
- [x] 快速换范围时旧结果不能覆盖新结果。
- [x] Web Sync 关闭时不发网页请求。

退出条件：

- [x] 单对象趋势无需复制统计逻辑。

### 阶段 3：实现精确日详情读模型

目标文件：

- `src/features/data/services/dataDestinationDetailReadModel.ts`
- `src/features/data/services/dataDestinationDetailSnapshot.ts`
- 必要的 platform 现有 gateway。

步骤：

- [x] 按本地日期计算单日范围。
- [x] 应用读取精确 session 和标题样本。
- [x] 应用按 `identityKeys` 过滤。
- [x] 网页读取精确 segment。
- [x] 网页按 normalized domain 过滤。
- [x] 所有片段裁剪到日期边界。
- [x] 当前日片段裁剪到当前时间。
- [x] 构建统一 timeline segment。
- [x] 构建记录列表。
- [x] 合并相邻同标题片段时保留总时长正确性。
- [x] 重叠记录不重复统计。
- [x] 标题为空时输出明确 unavailable 状态。
- [x] 加入 day request key 和 stale response 防护。

停止条件：

- [x] 如果现有前端精确读取必须拉取过大范围或产生明显性能问题，停止并升级为 typed targeted command 方案。
- [x] 如果需要新增 Rust / IPC，先补充 owner、契约、权限和 runtime smoke 计划，不静默扩展。

退出条件：

- [x] 一个日期可以生成可证明的单对象时间轴和记录列表。

### 阶段 4：实现详情 Dialog 骨架

目标文件：

- `src/features/data/components/DataDestinationDetailDialog.tsx`
- `src/styles/features/data.css`
- `src/shared/copy/domains/dataCopy.ts`

步骤：

- [x] 使用 `QuietDialog`。
- [x] 设置 Data 私有 `surfaceClassName`。
- [x] Header 显示图标、名称、secondary text。
- [x] Header 右侧放现有 `DataTrendRangeControl`。
- [x] 加入 Quiet Pro 关闭按钮。
- [x] 不显示应用/网页切换。
- [x] 不显示导航栏。
- [x] 不显示热力图。
- [x] 建立摘要、趋势、时间轴、记录四个稳定区域。
- [x] Body 使用独立纵向滚动。
- [x] 冷加载时保持稳定几何。
- [x] 深浅主题只使用现有 token。

状态检查：

- [x] default
- [x] hover
- [x] active
- [x] focus-visible
- [x] disabled
- [x] cold-loading
- [x] refreshing
- [x] empty
- [x] partial-error
- [x] blocking-error

退出条件：

- [x] Dialog 骨架不依赖真实数据也能稳定打开、关闭和恢复焦点。

### 阶段 5：接入对象行与已选图标

目标文件：

- `src/features/data/components/DataAppTrendPanel.tsx`
- `src/features/data/components/Data.tsx`
- `src/styles/features/data.css`
- `src/shared/copy/domains/accessibilityCopy.ts`

步骤：

- [x] 为对象行增加双击详情。
- [x] 为对象行增加 Enter 详情。
- [x] 保留 Space 单选。
- [x] 保留 Ctrl + Space / Ctrl + Enter 多选。
- [x] 阻止详情双击冒泡到其他容器。
- [x] 把已选图标改为真实可访问控件。
- [x] 图标单击不改变选择。
- [x] 图标双击与 Enter 打开详情。
- [x] 捕获打开前选择、模式、滚动和焦点快照。
- [x] 打开 Dialog 时恢复背景比较集合。
- [x] 关闭后再次确认比较集合与顺序。
- [x] 关闭后恢复 list scrollTop。
- [x] 不改变 7 项上限。
- [x] 不改变应用/网页各自的会话选择。
- [x] 不改变图标顺序。

浏览器交互检查：

- [x] 双击未选对象。
- [x] 双击已选单对象。
- [x] 双击多选中的第一个对象。
- [x] 双击多选中的中间对象。
- [x] 双击头部已选图标。
- [x] 快速单击不会被误判为双击。
- [x] 慢速双击不会产生选择闪烁。

退出条件：

- [x] “双击详情 · Ctrl 多选”文案与真实行为一致。

### 阶段 6：接入范围、趋势与日期下钻

目标文件：

- `DataDestinationDetailDialog.tsx`
- `useDataDestinationDetail.ts`
- `dataDestinationDetailState.ts`
- `dataDestinationDetailReadModel.ts`

步骤：

- [x] 打开时复制数据页当前目的地范围。
- [x] 使用同一个 `DataTrendRangeControl`。
- [x] 日历、自定义、周、月、年和恢复行为一致。
- [x] 弹层范围与背景范围状态隔离。
- [x] 范围切换保留旧内容到新内容 ready。
- [x] 单击日点更新聚焦日期。
- [x] 单击月点进入对应自然月。
- [x] 上一日、下一日不越过范围。
- [x] 未来日期禁用。
- [x] 聚焦日期变化只刷新日详情区域。
- [x] 范围变化刷新摘要与趋势，并协调聚焦日期。

退出条件：

- [x] 同一日期组件在数据页主体和详情弹层中表现一致。

### 阶段 7：实现时间轴与活动记录

目标文件：

- `DataDestinationDetailTimeline.tsx`
- `DataDestinationDetailRecords.tsx`
- `dataDestinationDetailReadModel.ts`
- `src/styles/features/data.css`

步骤：

- [x] 绘制 00:00–24:00 时间轴。
- [x] 时间片段使用对象颜色和 Quiet Pro 中性色。
- [x] 时间片段 hover / focus 显示时间、时长、标题。
- [x] 不用多色图例。
- [x] 记录按时间升序。
- [x] 长标题截断并可访问完整内容。
- [x] 当前活动有明确状态但不使用高噪声动画。
- [x] 无活动显示局部空状态。
- [x] 无标题显示 unavailable 文案。
- [x] 不显示不存在的标题或 URL。
- [x] 时间轴与记录列表使用同一批精确日数据。

退出条件：

- [x] 用户可以从趋势点追到日内片段和具体记录。

### 阶段 8：加载稳定性、错误与性能

- [x] Dialog 打开不等待趋势请求完成。
- [x] Dialog 外框不随数据状态改变尺寸。
- [x] 切换范围不清空整个内容。
- [x] 切换日期不清空整个内容。
- [x] 应用切网页背景状态变化不影响已打开详情对象。
- [x] 关闭 Dialog 不触发背景 Data 重载。
- [x] 重新打开另一对象不闪现上一对象数据。
- [x] 刷新提示延迟出现，短请求不闪提示。
- [x] 局部错误不传播为整个 Data 页面错误。
- [x] 当前数据变化事件只刷新必要快照。
- [x] 缓存有明确容量和清理路径。
- [x] 不增加无界 listener、timer 或 pending promise。

性能验收：

- [x] 双击后一个 animation frame 内出现 Dialog shell。
- [x] 有缓存时趋势首屏直接可见。
- [x] 日详情只读取一个本地日历日。
- [x] 快速范围和日期切换没有旧响应回跳。
- [x] 背景 Data 面板 DOM 不被卸载。

退出条件：

- [x] 试点没有重现此前数据页白屏、闪屏或整块 loading 问题。

### 阶段 9：响应式与视觉验收

- [x] 1280×820 窗口通过。
- [x] 当前支持的最窄窗口通过。
- [x] 全屏通过。
- [x] Windows 100% 缩放通过。
- [x] Windows 125% 缩放通过。
- [x] Windows 150% 缩放通过。
- [x] 浅色主题通过。
- [x] 深色主题通过。
- [x] 中文通过。
- [x] 英文长对象名通过。
- [x] 最长日期标签与恢复按钮同时存在时通过。
- [x] 标题、日期控件和关闭按钮不重叠。
- [x] 时间轴不越出 Dialog。
- [x] 记录列表滚动不推动 Header。
- [x] 背景页面不横向滚动。

退出条件：

- [x] 详情层看起来属于现有 Patina，而不是一个嵌入网页。

### 阶段 10：自动化验证

纯函数测试建议：

- `tests/dataDestinationDetailState.test.ts`
- `tests/dataDestinationDetailReadModel.test.ts`

扩展：

- `tests/uiSmoke.test.ts`
- `tests/uiBrowserSmoke/dataScenarios.ts`

单元测试：

- [x] 对象身份归一。
- [x] 合并应用 source keys。
- [x] 聚焦日期选择。
- [x] 范围协调。
- [x] 月下钻。
- [x] 本地日边界。
- [x] 当前日裁剪。
- [x] 时间轴比例。
- [x] 相邻片段合并。
- [x] 重叠片段去重。
- [x] 无标题语义。
- [x] stale response 防护。

Browser Smoke：

- [x] 普通单击仍是单选。
- [x] Ctrl 多选仍保持顺序。
- [x] 双击应用行打开应用详情。
- [x] 双击网页行打开网页详情。
- [x] 双击头部图标打开对应详情。
- [x] Enter 打开详情。
- [x] Space 单选。
- [x] Ctrl + Space 多选。
- [x] Dialog 无导航栏、无热力图、无模式切换。
- [x] Dialog 复用日期范围控件。
- [x] 弹层内范围变化不改变背景范围。
- [x] 关闭后恢复选择和滚动。
- [x] 主体趋势双击仍打开历史。
- [x] 主体热力格双击仍打开历史。
- [x] Web Sync 关闭时不存在网页详情入口。
- [x] 空数据、无标题、失败和重试通过。
- [x] 快速切换不白屏、不回跳。
- [x] Escape 与关闭按钮恢复焦点。

静态契约：

- [x] Data 没有导入 History 私有 React 组件。
- [x] 没有新增 app 全局详情状态。
- [x] 没有新增 shared 业务详情组件。
- [x] 没有复制日期算法。
- [x] 没有新增热力图到 Dialog。
- [x] 中英文文案完整。

退出条件：

- [x] 交互、数据、无障碍和 owner 边界都有自动化证据。

### 阶段 11：完整质量门

聚焦验证：

- [x] 运行新增详情单元测试。
- [x] `npm run test:data`
- [x] `npm run test:data-range`
- [x] `npm run test:data-chart`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`

仓库最低验证：

- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run build`

质量门：

- [x] `npm run check:types`
- [x] `npm run check:lint`
- [x] `npm run check:architecture`
- [x] `npm run check:quiet-pro-style-debt`
- [x] `npm run check`

条件验证：

- [x] 不适用：未新增或修改 typed Rust command，因此无需运行 `npm run test:tauri-runtime-smoke`。
- [x] 不适用：未触及 Rust、IPC 或 capability，因此无需运行 `npm run check:full`。
- [x] 不适用：沿用现有聚合快照与单日读取边界，没有改变稳定性能基线，因此无需运行 `npm run perf:stable`。

退出条件：

- [x] 与实际改动风险匹配的验证全部通过。

### 阶段 12：完成、对抗式审查与归档

- [x] 对照第 17 节完成定义逐项复核。
- [x] 执行第 19 节对抗式审查。
- [x] 修复所有高风险和中风险问题。
- [x] 重跑受影响验证。
- [x] 记录实际文件、测试、截图环境和剩余风险。
- [x] 将完成项勾选。
- [x] 将本文移动到 `docs/archive/`。
- [x] 已再次尝试读取 live Project；仍被失效的本机 `gh` keyring 凭据阻塞，未把本地结果伪装成远端结果。
- [x] 因无法确认对应事项，不提供无依据的 `Done` 拖动建议；凭据恢复后应重新核对。
- [x] 因无法读取可信的 live Project 排序与状态，没有凭空计算 `Next` 窗口；凭据恢复后按路线图文档重新计算。
- [x] 不用本地归档代替 live Project 状态。
- [x] 只有用户明确要求时才创建提交。
- [x] 只有用户明确要求推送时才执行 git push。

## 17. 完成定义

只有同时满足以下条件，任务才算完成：

- [x] 数据页应用对象可以通过双击行或图标打开详情。
- [x] 数据页网页对象可以通过双击行或图标打开详情。
- [x] 键盘 Enter 可以打开详情。
- [x] 普通单选、Ctrl 多选和 7 项上限没有回归。
- [x] 详情一次只分析一个对象。
- [x] 详情没有导航栏、没有热力图、没有应用/网页切换。
- [x] 详情使用现有日期范围控件与日历。
- [x] 弹层范围变化不修改背景数据页范围。
- [x] 摘要和趋势与数据页现有统计口径一致。
- [x] 日内时间轴来自精确日记录。
- [x] 活动记录只显示可证明的标题、URL 和时间。
- [x] 无标题、无数据和错误状态表达诚实。
- [x] 关闭后恢复原选择、顺序、模式、滚动与焦点。
- [x] 主体趋势和热力格双击进入历史的行为不变。
- [x] 范围与日期快速切换没有白屏、闪屏或旧响应回跳。
- [x] Web Sync 关闭时没有网页详情入口。
- [x] 深浅主题、长英文、窄窗口和高 DPI 通过。
- [x] 没有提前新增 app 全局 owner 或 shared 业务组件。
- [x] 自动化、真实浏览器视觉与几何验证通过。
- [x] 对抗式审查没有未处理的高风险或中风险。
- [x] 方案完成勾选并归档。

## 18. 测试矩阵

### 18.1 入口与选择

| 场景 | 预期 |
| --- | --- |
| 单选 A，双击 A | 打开 A 详情 |
| 多选 A、B、C，双击 B | 打开 B 详情；关闭后仍为 A、B、C |
| 多选 A、B、C，双击未选 D | 打开 D 详情；关闭后仍为 A、B、C |
| 双击头部第 3 个图标 | 打开第 3 个对象 |
| Enter | 打开聚焦对象详情 |
| Space | 普通单选 |
| Ctrl + Space | 增减多选 |
| Ctrl + Enter | 增减多选 |
| 7 项已满后打开详情 | 不改变 7 项选择 |

### 18.2 范围

| 场景 | 预期 |
| --- | --- |
| 背景为近 7 天 | 详情初始为近 7 天 |
| 背景为第 N 周 | 详情初始为第 N 周 |
| 背景为某月 | 详情初始为该月 |
| 背景为某年 | 详情初始为该年 |
| 背景为自定义范围 | 详情继承该范围 |
| 详情修改范围 | 背景范围不变 |
| 详情恢复 | 详情回到近 7 天 |
| 当前范围向未来移动 | 下一范围禁用 |
| 单击月点 | 进入对应自然月 |

### 18.3 日期与时间轴

| 场景 | 预期 |
| --- | --- |
| 范围内有活动 | 默认聚焦最近有记录日 |
| 范围内无活动 | 聚焦范围结束日并显示空状态 |
| 单击日点 | 聚焦对应日期 |
| 上一日 / 下一日 | 按本地日历日移动 |
| 无活动日期 | 显示空时间轴，不跳过 |
| 今天 | 裁剪到当前时间 |
| 跨午夜 session | 正确裁剪到日边界 |
| DST 日 | 日期与可见 00:00–24:00 语义正确 |

### 18.4 应用与网页

| 场景 | 预期 |
| --- | --- |
| 合并应用身份 | 全部 source keys 纳入 |
| 应用别名 | 只改变显示名 |
| 应用标题关闭 | 有时间片段，标题 unavailable |
| 网页 domain 大小写差异 | 归为一个对象 |
| 网页无 title | 显示未记录标题 |
| 网页有 URL 无 title | 不把 URL 假装成标题 |
| Web Sync 关闭 | 网页入口不存在 |
| 网页请求失败 | 局部错误，可重试 |

### 18.5 加载与竞争

| 场景 | 预期 |
| --- | --- |
| 首次冷开 | Shell 立即出现，局部 skeleton |
| 有缓存打开 | 直接显示旧快照并后台更新 |
| 快速切范围 | 最后一次请求获胜 |
| 快速切日期 | 最后一个日期获胜 |
| 加载中关闭 | 不再提交已关闭结果 |
| A 加载中改开 B | 不闪现 A 的内容 |
| 局部失败 | 其他区域保持可用 |

## 19. 对抗式审查清单

以下问题项的勾选表示“已审查”，不表示问题成立。除实施记录明确列出的修复项与接受项外，审查结果均为“未发现该问题”。

### 19.1 产品语义攻击

- [x] 详情是否只是把 History 页面复制进 Dialog？
- [x] 详情是否与多对象比较重复？
- [x] 是否因为没有标题而编造了标题？
- [x] 是否把网页 URL 当成已记录页面标题？
- [x] 是否把月趋势点错误当成某一天？
- [x] 是否在范围内无数据时自动跳到范围外日期？
- [x] 是否加入了用户没有要求的热力图、分类或编辑功能？

### 19.2 交互攻击

- [x] 双击是否先把多选永久折叠成单选？
- [x] 单击是否因等待双击而产生明显迟滞？
- [x] 双击对象是否误触趋势图的历史跳转？
- [x] 双击图标是否因 nested button 产生无效 HTML？
- [x] Enter、Space 和 Ctrl 组合是否互相冲突？
- [x] 关闭后焦点是否丢到 body？
- [x] 关闭后列表是否跳回顶部？
- [x] 遮罩关闭是否造成未预期状态残留？

### 19.3 日期攻击

- [x] 是否复制了 `DataTrendRangeControl` 的日期逻辑？
- [x] 是否把自然周重新写成另一套周算法？
- [x] 是否用固定 24 小时移动本地日历日？
- [x] 是否允许完整范围进入未来？
- [x] 月点下钻后恢复是否回到近 7 天？
- [x] 详情范围变化是否悄悄修改背景范围？
- [x] 聚焦日期是否越出当前范围？

### 19.4 数据正确性攻击

- [x] 应用精确 session 是否使用了错误的展示名匹配？
- [x] 合并应用是否漏掉 source keys？
- [x] 网页是否没有标准化 domain？
- [x] session 是否在日边界外重复计时？
- [x] 重叠片段是否被重复求和？
- [x] 当前活动是否错误延伸到未来？
- [x] 摘要是否由列表重新求和而偏离聚合口径？
- [x] 排除统计对象是否重新出现在详情？

### 19.5 异步与性能攻击

- [x] 打开 Dialog 是否触发整个 Data 页面重载？
- [x] 切换范围是否先清空图表？
- [x] 切换日期是否使 Dialog 高度塌陷？
- [x] A 的旧响应是否覆盖 B？
- [x] 旧日期响应是否覆盖新日期？
- [x] 网页详情是否误发热力图请求？
- [x] 是否创建无界缓存？
- [x] 关闭后是否仍有 listener、timer 或 promise 提交状态？

### 19.6 视觉攻击

- [x] Dialog 是否像另一个网页而不是 Patina？
- [x] 是否新增硬编码颜色、圆角、阴影或边框？
- [x] 是否出现过度遮罩、模糊或动效？
- [x] 日期控件是否与标题或关闭按钮重叠？
- [x] 长标题是否挤压日期控件？
- [x] 时间轴是否在窄屏溢出？
- [x] Loading、empty 和 ready 是否改变外框尺寸？
- [x] 深色主题是否出现低对比文本？

### 19.7 架构攻击

- [x] 是否把 Data 私有详情状态提前放进 `app/*`？
- [x] 是否把 Data 业务组件提前放进 `shared/*`？
- [x] 是否直接导入 History 私有 React 组件？
- [x] 是否在页面组件内直接查询数据库？
- [x] 是否把 raw DTO 传到 React 展示层？
- [x] 是否为了试点新增不必要的 Rust command？
- [x] 是否让 `Data.tsx` 继续明显变厚而没有局部 hook owner？

审查退出条件：

- [x] 每项发现都有“修复 / 接受 / 移出本轮”的书面结论。
- [x] 高风险和中风险全部解决。
- [x] 接受的低风险写入实施记录并说明后续触发条件。

### 19.8 本轮审查结论

| 级别 | 攻击面 | 发现 | 处置 |
| --- | --- | --- | --- |
| 中 | 异步反馈 | 详情范围刷新若立即显示文案，短请求会产生一次可见闪动 | 复用主面板语义，增加 240 ms 延迟刷新提示；`aria-busy` 仍立即更新 |
| 中 | 无障碍语义 | 可交互趋势点位于 `role="img"` 容器下会形成冲突语义 | 交互模式改为 `role="group"`，非交互模式保持 `role="img"` |
| 中 | owner 边界 | 详情展示状态继续堆入 `Data.tsx` 会使页面组件变厚 | 抽取 Data 私有 `useDataDestinationDetailPresentation` hook |
| 中 | 数据正确性 | 标题样本只覆盖 session 一部分时，未覆盖时段可能被丢失 | 将未覆盖区间保留为明确的无标题记录，确保记录总时长可证明 |
| 低 | 身份归一 | locale-sensitive 小写转换可能在特殊区域设置下改变 identity | 改为 locale-independent `toLowerCase()` |
| 接受 | 推广边界 | 今天页和历史页尚未接入统一详情入口 | 本轮按用户要求只试点数据页；数据页稳定后再单独讨论提升 owner |
| 接受 | 日历时区 | 本地日时间轴按真实本地日边界计算，DST 日可能不是固定 24 小时 | 与计划中的本地日语义一致；若未来出现跨时区或 DST 用户报告再专项验证 |

审查后没有未处理的高风险或中风险问题。

## 20. 回滚方案

### 20.1 UI 回滚

- 移除 Data 对象详情 Dialog 渲染。
- 移除对象行和图标的详情事件。
- 保留原有普通单选、Ctrl 多选和底部提示的既有结构。
- 不影响趋势图和热力格历史跳转。

### 20.2 状态回滚

- 详情状态为 Data 内存状态，不需要 migration。
- 不修改应用/网页会话选择存储结构。
- 不修改数据页趋势范围存储结构。

### 20.3 数据回滚

- 本轮只读，不写入 session、网页记录、分类或设置。
- 不新增数据库表或字段。
- 回滚不需要数据修复。

### 20.4 触发条件

出现以下任一情况，应回滚或暂停扩大范围：

- 双击稳定破坏 Ctrl 多选。
- 弹层时间统计与数据页口径不一致。
- 精确日读取产生不可接受的主线程或数据库压力。
- 快速切换持续出现旧响应覆盖。
- Dialog 在支持窗口尺寸下无法稳定呈现。
- 为了实现试点必须把厚业务逻辑放进 `app/*` 或 `shared/*`。

## 21. 试点结束后的推广门槛

本轮完成不自动授权今天页和历史页接入。

只有满足以下条件，才进入下一轮讨论：

- [x] 数据页入口使用稳定。
- [x] 对象、范围、日期三个状态边界清楚。
- [x] 应用和网页读模型都通过。
- [x] 双击与多选没有长期冲突。
- [x] Dialog 布局在真实数据下稳定。
- [x] 日期范围组件可以无分叉复用。
- [x] Data 私有 props 已经稳定，能够识别真正的跨 feature 接口。
- [x] 已完成一次对抗式审查。

下一轮再决定：

- 是否把 Dialog 提升到 app-level 全局协调。
- 哪些纯 UI 或纯 read-model 能力适合进入 shared。
- 今天页传入什么初始日期上下文。
- 历史页传入什么初始日期上下文。
- 三个页面的对象入口如何统一。

## 22. 实施记录

- [x] 开始日期：2026-07-30。
- [x] 完成日期：2026-07-30。
- [x] 对应 Project 事项：已两次尝试读取 live Project；本机 `gh` keyring 凭据失效，无法确认对应事项，未执行任何远端状态变更。
- [x] 实际修改文件：
  - Data 编排与交互：`Data.tsx`、`DataAppTrendPanel.tsx`、`useDataDestinationDetailPresentation.ts`。
  - 详情读取与状态：`useDataDestinationDetail.ts`、`dataDestinationDetailState.ts`、`dataDestinationDetailReadModel.ts`。
  - 详情 UI：`DataDestinationDetailDialog.tsx`、`DataDestinationDetailDialogFallback.tsx`、`DataDestinationDetailTimeline.tsx`、`DataDestinationDetailRecords.tsx`、`dataDestinationDetailCopy.ts`、`data.css`。
  - 既有能力扩展：`NativeTrendChart.tsx`、`QuietDialog.tsx`、Data 应用/网页 read model、搜索、选择与 session state。
  - 验证与预算：详情单元测试、Data 浏览器场景、UI smoke、bundle budget 与 `package.json`。
- [x] 聚焦测试结果：详情状态 5 项、详情读模型 5 项、`test:data`、`test:data-range`、`test:data-chart`、`test:ui-smoke` 51 项均通过；Data-only 真实浏览器场景 14 项通过。
- [x] 最低验证结果：`npm test`、`npm run test:replay`、`npm run build` 均作为 `npm run check` 的组成部分通过。
- [x] 完整质量门结果：`npm run check` 全部通过，包含 types、lint、architecture、IPC、hotspot、Quiet Pro style debt、test governance、覆盖率、replay、mutation、60 项浏览器 UI smoke、build 与 bundle budget。
- [x] 真实浏览器视觉验证环境：Chromium 1280×820@100%、720×720@150%、1920×1080@125%、390×900@150%；覆盖中文浅色与英文深色、长文案、共享日历、弹层几何、无横向溢出和背景 DOM 稳定性。
- [x] 对抗式审查结论：发现并修复 5 项中低风险问题；没有未处理的高风险或中风险，详见 19.8。
- [x] 已知剩余风险：今天页和历史页接入刻意留在下一轮；DST 本地日语义只在出现跨时区实际反馈时再专项扩展。
- [x] 提交记录：用户未要求创建提交，本轮未提交。
- [x] 推送记录：用户未要求推送，本轮未推送。
- [x] 归档日期：2026-07-30。
