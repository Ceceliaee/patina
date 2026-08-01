# History 网页时间轴模式执行方案

> 状态：已完成、已执行对抗式审查并归档
>
> 创建日期：2026-07-31
>
> 对应反馈：History 横向时间轴模式从“应用 / 分类”扩展为“应用 / 分类 / 网页”，时间轴缩放弹窗使用同一个三态按钮
>
> 真实 owner：`src/features/history`
>
> 完成日期：2026-07-31
>
> 文档归宿：`docs/archive/history-web-timeline-mode-execution-plan.md`

## 1. 如何使用本文档

本文档是本次改动的唯一执行清单。实施者应按阶段顺序推进，并把测试名称、命令结果或必要说明记录在对应步骤下。

- [x] 开始实施前重新读取当前工作树，确认没有覆盖用户尚未提交的 History 改动。
- [x] 每一阶段开始前确认上一阶段退出条件已满足。
- [x] 先写会失败的测试，再修改生产代码。
- [x] 每完成一个步骤立即勾选，不在最后批量补勾。
- [x] 若实现需要新增跨 feature 抽象、平台端口、IPC 或数据库字段，立即停止并重新做边界判断。
- [x] 若当前代码与本文档记录的事实发生变化，先更新本文档，再继续实现。
- [x] 自动化通过不等于完成；第 22 节人工验收矩阵也必须执行。
- [x] 全部验收完成后更新文档状态并归档，不把一次性执行单长期留在 `docs/working`。

## 2. 一句话问题定义

History 主横向时间轴和时间轴缩放目前只能在“应用”与“分类”之间切换；网页活动虽然已经被 History 读取并能在分布和记录列表中查看，却不能作为独立的横向时间轴视角进行扫读、缩放和分轨查看。

## 3. 用户可见的最终结果

当网页活动功能可用时：

```text
主时间轴按钮：应用 → 分类 → 网页 → 应用
缩放弹窗按钮：应用 → 分类 → 网页 → 应用
```

- [x] 主时间轴右上角现有标签图标保持原位置和 Quiet Pro 样式。
- [x] 第一次点击：`应用 → 分类`。
- [x] 第二次点击：`分类 → 网页`。
- [x] 第三次点击：`网页 → 应用`。
- [x] 主时间轴与时间轴缩放弹窗共享同一个当前模式。
- [x] 在任一位置切换模式，另一处立即反映新模式。
- [x] 切换模式不改变当前日期、缩放倍数、缩放窗口位置或拖拽位置。
- [x] 网页模式按规范化域名分组，显示域名名称、域名颜色和网页活动片段。
- [x] 缩放弹窗在网页模式下显示“网页分轨”，有 favicon 时显示 favicon，没有时显示稳定颜色点。
- [x] 网页活动功能不可用时，按钮继续只在“应用 / 分类”之间循环。

## 4. 当前代码事实

### 4.1 已确认存在的能力

- [x] `History.tsx` 已经能取得 `visibleDayWebSegments`。
- [x] `historyWebActivityViewModel.ts` 已经负责网页范围裁剪、域名排除过滤、显示名、分类、颜色、favicon、live 片段和网页列表合并。
- [x] History 的“当日分布”已经支持 `应用 / 分类 / 网页`。
- [x] 现有“时间线”记录列表弹窗已经支持 `应用 / 网页` Tab。
- [x] 主横向时间轴使用 `buildHistoryTimelineViewModel`，目前只接收 `CompiledSession[]`。
- [x] `HistoryTimelineDisplayMode` 目前只有 `"app" | "category"`。
- [x] `patina:history-timeline-mode` 已经持久化主时间轴模式，但读取守卫目前不接受 `web`。
- [x] 主横向时间轴与时间轴缩放弹窗已经复用同一个 `historyTimelineMode` state 和同一个按钮渲染函数。
- [x] 时间轴缩放弹窗已经支持连续 `1–24` 小时缩放、滚轮锚点缩放、拖拽和平移。
- [x] 缩放弹窗的分轨组件目前依赖应用专用字段和应用图标映射。
- [x] 网页活动数据已经随 History 日快照读取，因此新增网页时间轴不需要新增 IPC 或数据库查询。

### 4.2 当前缺口

- [x] 时间轴显示模式类型没有 `web`。
- [x] 两态 toggle 逻辑无法表达三态循环。
- [x] `aria-pressed` 是二态语义，不适合三态循环按钮。
- [x] 时间轴 segment、legend 和 lane 类型携带 `appKey`、`exeName` 等应用专用字段。
- [x] 横向时间轴组件在渲染阶段直接根据应用分类和应用图标颜色解析颜色。
- [x] 网页列表模型经过列表专用的最短时长过滤和列表排序，不能直接冒充图形时间轴数据源。
- [x] 当前浏览器 smoke 没有覆盖时间轴按钮完整模式循环，也没有覆盖缩放弹窗和主时间轴的模式同步。

### 4.3 这次明确改变的历史边界

早期网页活动方案刻意把网页限制在“当日分布”和“网页记录列表”，并把网页视觉时间轴列为后续独立事项。本执行单就是该后续事项：只增加独立网页视角，不改变应用和分类口径，也不把网页活动叠加进应用总时长。

## 5. 第一性原理

### 5.1 时间轴模式的本质是“选择解释维度”

同一段屏幕空间一次只能表达一种清楚的身份维度：

```text
应用模式：本机应用会话 → 按应用身份解释
分类模式：本机应用会话 → 按应用分类解释
网页模式：网页活动片段 → 按域名身份解释
```

由此得到：

- [x] 三种模式互斥，不在同一轨道叠加应用和网页片段。
- [x] 分类模式继续只解释应用会话，不混入网页域名分类。
- [x] 网页模式只解释已真实记录的网页活动，不从浏览器应用会话推断域名。
- [x] 网页模式中的空白表示“该时段没有可证明的网页活动”，不能用 Chrome 或 Edge 应用时间补齐。

### 5.2 网页活动是应用活动的子视角，不是额外时长

网页活动通常发生在浏览器应用会话内部。两者是不同观察维度，不是可以相加的独立时间来源。

由此得到：

- [x] 不把网页时长加到应用活跃时长、当日摘要或分类总时长。
- [x] 网页 legend 的百分比分母只使用当前网页时间轴中可见的网页片段。
- [x] 应用模式仍显示完整浏览器应用会话。
- [x] 网页模式只显示浏览器扩展真实上报并被 Patina 保存的网页片段。
- [x] 浏览器开启但扩展未连接的时间在网页模式中保持空白。

### 5.3 视口是观察窗口，不是数据过滤偏好

缩放、滚轮和拖拽只改变用户正在看的时间窗口，不能改变底层统计语义。

由此得到：

- [x] 模式切换复用同一个 `timelineViewport`。
- [x] 模式切换不重置 `zoomHours`。
- [x] 模式切换不把窗口重新吸附到当前时间。
- [x] 模式切换后，轴刻度、窗口起止时间和拖拽边界保持一致。
- [x] legend 与 lane 时长只统计当前视口内裁剪后的片段。

### 5.4 一个交互只能有一个状态所有者

主时间轴按钮和缩放弹窗按钮操作的是同一个概念。如果各自维护状态，就会出现主页面显示“网页”、弹窗显示“应用”的分裂。

由此得到：

- [x] `useHistoryTimelineMode` 作为时间轴显示模式的唯一状态所有者，`History.tsx` 只组合并向主时间轴与缩放弹窗分发同一状态。
- [x] 主时间轴和缩放弹窗都调用同一个 mode change handler。
- [x] 不在 `HistoryTimelineZoomDialog` 内新增局部 mode state。
- [x] 不新增第二个 localStorage 键。
- [x] 继续复用 `patina:history-timeline-mode`，不增加 `v1`、`v2` 等后缀。

### 5.5 渲染组件应消费已解释的数据

颜色、标签、分组身份和图标候选属于读模型语义。渲染组件不应根据 `mode` 再次猜测应用或网页的身份。

由此得到：

- [x] 时间轴读模型输出最终 `key`、`label`、`color` 和图标候选。
- [x] `HistoryHorizontalTimeline` 不直接读取网页 override 或应用 mapping。
- [x] `HistoryTimelineLaneList` 不把 `mode !== category` 默认解释成应用。
- [x] 应用和网页的不同归一规则留在各自 History service owner 中。

### 5.6 缺失数据不能被伪造

网页活动依赖用户开启 Web Sync、浏览器扩展连接和真实活动上报。

由此得到：

- [x] Web Sync 关闭时不展示一个永远为空的网页循环步骤。
- [x] Web Sync 开启但当天无网页记录时，允许进入网页模式并显示明确空态。
- [x] live 网页片段只封口到 `nowMs`，不扩展到 24:00。
- [x] 被排除统计的域名不出现在 segment、legend、lane 或 tooltip 中。
- [x] 不读取浏览器本地历史数据库，不从标题或 URL 猜测未记录区间。

## 6. 已确认的产品与工程决策

- [x] 模式顺序固定为 `app → category → web → app`。
- [x] Web Sync 不可用时顺序固定为 `app → category → app`。
- [x] 默认模式保持 `app`。
- [x] 使用现有持久化键 `patina:history-timeline-mode`。
- [x] 旧值 `app`、`category` 无需迁移；新值 `web` 直接纳入同一类型守卫。
- [x] 非法或不可读取的存储值继续回退到 `app`。
- [x] 当 Web Sync 在运行中被关闭且当前模式为 `web` 时，立即切到并持久化 `app`。
- [x] Web Sync 关闭时从持久化读到 `web`，有效显示模式必须为 `app`。
- [x] 三态按钮不再使用 `aria-pressed`，避免把“分类”误表达成唯一激活状态。
- [x] 图标继续使用现有标签图标，不新增第三个按钮、不新增 segmented control。
- [x] 主时间轴与缩放弹窗共享模式，但现有“时间线记录列表弹窗”的 `应用 / 网页` Tab 保持独立。
- [x] 网页图形时间轴直接使用有效网页活动片段，不复用经过列表最短时长过滤的 `webTimelineItems`。
- [x] 图形时间轴继续保留现有 30 秒最小可视片段规则；`minSessionSecs` 仍只控制记录列表。
- [x] 不新增 Rust、SQLite、Tauri command、capability 或 platform gateway 改动。
- [x] 不新增全局设置项。

## 7. 范围

### 7.1 本次包含

- [x] 三态模式类型、循环函数、有效模式解析和持久化。
- [x] 应用、分类、网页统一的横向时间轴展示契约。
- [x] 网页 segment、legend、tooltip 和空态。
- [x] 网页缩放时间轴和网页分轨。
- [x] 网页 lane favicon 与稳定颜色点 fallback。
- [x] 主时间轴与缩放弹窗双向同步。
- [x] 中英文文案和无障碍语义。
- [x] 纯函数测试、UI 结构 smoke、浏览器交互 smoke。
- [x] 轻色、深色、不同窗口宽度与 Web Sync 可用性人工验收。

### 7.2 本次不包含

- [x] 不把应用、分类、网页同时叠加在一条时间轴。
- [x] 不把网页分类合并进应用分类时间轴。
- [x] 不修改当日摘要、当日活动柱状图或应用/分类统计口径。
- [x] 不修改现有记录列表弹窗的 `应用 / 网页` Tab 结构。
- [x] 不给记录列表弹窗增加“分类”Tab，因为分类是聚合视角，不是原始记录类型。
- [x] 不新增网页跨日、周、月或年度时间轴。
- [x] 不新增 URL 级 lane；网页模式第一层只按规范化域名分轨。
- [x] 不从浏览器应用会话补全网页空档。
- [x] 不新增远程 favicon 请求。
- [x] 不借此重构整个 `History.tsx` 或抽取跨 feature 时间轴框架。
- [x] 不创建版本号后缀键或兼容双写。
- [x] 不自动修改 GitHub Issue、Project 状态、版本号或 Changelog。

## 8. 必须始终成立的不变量

- [x] 一个渲染中的横向时间轴只有一个 `mode`。
- [x] `app` 和 `category` 只消费应用 source。
- [x] `web` 只消费网页 source。
- [x] 时间轴 source 的开始和结束时间都被裁剪到所选本地日与当前视口交集。
- [x] 今天的 live source 不超过 `nowMs`。
- [x] segment 的 `startRatio`、`endRatio` 和 `widthRatio` 始终限制在 `[0, 1]`。
- [x] legend、lane 与 segment 使用同一组已裁剪数据。
- [x] lane 总时长等于该 lane 可见 segment 时长之和。
- [x] 网页 legend 百分比之和允许因浮点和只展示前七项而不精确显示为 100%，但底层分母必须正确。
- [x] 模式切换前后 `viewportStartMs`、`viewportEndMs` 和 `zoomHours` 不变。
- [x] 主时间轴与缩放弹窗读取同一个有效 mode。
- [x] 被排除域名在网页模式的所有派生结果中同时消失。
- [x] favicon 缺失不影响数据渲染，也不改变 lane 高度。
- [x] Web Sync 不可用时，DOM 中不出现有效 `web` 时间轴模式。

## 9. 模式状态机

### 9.1 点击转换表

| Web Sync | 当前有效模式 | 点击后模式 | 是否持久化 |
|---|---|---|---|
| 开启 | `app` | `category` | 是 |
| 开启 | `category` | `web` | 是 |
| 开启 | `web` | `app` | 是 |
| 关闭 | `app` | `category` | 是 |
| 关闭 | `category` | `app` | 是 |
| 关闭 | `web`（只可能来自旧 state/存储） | `app` | 是，先归一化 |

### 9.2 外部状态变化表

| 事件 | 处理 |
|---|---|
| 初次打开，未保存模式 | 使用 `app` |
| 初次打开，保存 `category` | 使用 `category` |
| 初次打开，保存 `web` 且 Web Sync 开启 | 使用 `web` |
| 初次打开，保存 `web` 但 Web Sync 关闭 | 有效模式使用 `app` |
| 运行中关闭 Web Sync，当前为 `web` | 切到 `app` 并保存 `app` |
| 运行中关闭 Web Sync，当前为 `app/category` | 模式不变 |
| 运行中重新开启 Web Sync | 保持当前模式，不自动跳回 `web` |
| localStorage 抛错 | 使用 `app`，交互仍可正常工作 |

### 9.3 建议的纯函数

- [x] `getNextHistoryTimelineMode(mode, webActivityEnabled)` 只负责循环顺序。
- [x] `resolveEffectiveHistoryTimelineMode(mode, webActivityEnabled)` 只负责能力降级。
- [x] 两个函数不读取 React state、不读 localStorage、不访问 Web Sync runtime。
- [x] 函数命名保持直接，不使用 `v1` 或过长的版本描述。

## 10. 数据语义

### 10.1 应用模式

- [x] 输入继续来自 `compiledSessions`。
- [x] source key 使用现有 `appKey`。
- [x] 标签使用应用显示名。
- [x] 颜色优先级保持当前应用 override、图标主题色、映射颜色顺序。
- [x] lane 图标优先使用 `exeName`，再回退 `appKey`。
- [x] 标题样本继续使用已清洗的应用标题样本。

### 10.2 分类模式

- [x] 输入与应用模式相同，仍是 `compiledSessions`。
- [x] group key 使用分类 id。
- [x] 标签和颜色使用当前分类配置。
- [x] 同一分钟内按现有 dominant-minute 规则选择主分类。
- [x] 不加入网页域名的分类时长。
- [x] lane 继续使用颜色点，不显示应用图标。

### 10.3 网页模式

- [x] 输入来自 `visibleDayWebSegments`，不从应用 session 反推。
- [x] 在归一化前调用现有统计排除规则，过滤 `enabled === false` 的域名。
- [x] source/group key 使用 `normalizedDomain`。
- [x] 标签优先使用域名 override 显示名，再使用 domain，再使用 normalized domain。
- [x] 颜色复用现有网页优先级：域名 override → favicon 主题色 → 分类色 → 稳定域名 fallback 色。
- [x] favicon 优先使用当前 segment/cached favicon，不发起远程读取。
- [x] live segment 的临时结束时间使用 `nowMs`。
- [x] 标题样本继续复用现有网页标题清洗与无标题语义。
- [x] 相同域名在同一分钟内合并贡献时长。
- [x] 多个域名同一分钟重叠时，沿用 dominant-minute：时长优先、首次出现时间次优、稳定 key 最后决胜。
- [x] 相邻同域名 dominant segment 按现有 `mergeThresholdSecs` 规则合并。
- [x] 不应用记录列表的 `minSessionSecs` 过滤。
- [x] 继续应用图形时间轴现有最小可视片段规则。

## 11. 时间轴读模型设计

### 11.1 目标

把当前应用专用输出收敛为 History feature 内部的来源中立展示契约，使渲染组件不需要知道一个 segment 来自 exe 还是 domain。

建议的最小语义形态：

```ts
type HistoryTimelineSourceKind = "app" | "web";

interface HistoryTimelineSourceItem {
  id: string;
  kind: HistoryTimelineSourceKind;
  sourceKey: string;
  sourceLabel: string;
  sourceColor: string;
  iconKeys: string[];
  category: AppCategory;
  categoryLabel: string;
  startTime: number;
  endTime: number;
  titleSampleDetails: Array<{
    title: string;
    startTime: number;
    endTime: number;
  }>;
  isLive: boolean;
}
```

最终 segment、legend 和 lane 至少提供：

- [x] `key`：当前显示维度的稳定 key。
- [x] `label`：当前显示维度的最终标签。
- [x] `color`：最终颜色，不由组件二次解析。
- [x] `iconKeys`：lane 查找图标的有序候选。
- [x] `sourceKind`：仅用于诊断、测试和必要的无障碍文案，不用于组件猜颜色。
- [x] 时间、比例、标题样本、alternate labels 和 live 状态。

### 11.2 source 归一化 owner

- [x] 应用 source 归一化留在 `historyTimelineViewModel.ts`。
- [x] 网页 source 归一化留在 `historyWebActivityViewModel.ts`。
- [x] 通用裁剪、minute bucket、dominant 选择、相邻合并、legend、lane 和 axis 构建留在 `historyTimelineViewModel.ts`。
- [x] `History.tsx` 只选择 source 和 mode，不承接归一化细节。
- [x] 不把这些 History 私有语义放进 `src/shared`。

### 11.3 防止错误复用

- [x] 不把 `WebTimelineItem` 直接强转为 `HistoryTimelineSegment`。
- [x] 不把 domain 塞入 `appKey`、`exeName` 等应用字段。
- [x] 不复制一套网页专用的视口、轴刻度和 minute bucket 算法。
- [x] 不让网页 builder 绕过现有本地日裁剪和 viewport clamp。
- [x] 不在组件内用 `mode === "web"` 大量分叉业务规则。

## 12. 主横向时间轴交互规格

- [x] 按钮位置、图标尺寸、间距和 Quiet Pro 控件外观保持现状。
- [x] 按钮点击顺序严格服从第 9 节状态机。
- [x] `data-history-timeline-mode` 支持 `app/category/web`。
- [x] 网页模式根节点增加现有命名规律的 `history-horizontal-timeline-web` class，不新增特殊装饰。
- [x] 应用模式 legend 显示应用。
- [x] 分类模式 legend 显示分类。
- [x] 网页模式 legend 显示域名或域名显示名。
- [x] legend 继续最多直接展示 7 项，其余使用现有 `+N` 入口。
- [x] 网页 segment tooltip 显示域名标签、开始时间、结束时间和时长。
- [x] 网页无数据时显示现有低噪音日空态，不把应用记录误当网页记录。
- [x] 模式切换时保持时间轴卡片高度稳定。
- [x] 模式切换不影响“打开时间轴缩放”和“打开时间线列表”按钮。

## 13. 时间轴缩放弹窗交互规格

- [x] 右上角继续显示与主时间轴相同的标签图标按钮。
- [x] 缩放弹窗按钮调用主时间轴同一个 handler。
- [x] 从主页面以 `web` 模式打开缩放弹窗，弹窗首帧就是 `web`。
- [x] 在缩放弹窗切换到 `app/category/web` 后，背景主时间轴状态同步变化。
- [x] 关闭缩放弹窗后，主时间轴保持弹窗最后选择的模式。
- [x] 模式切换前后 slider 值不变。
- [x] 模式切换前后窗口起止标签不变。
- [x] 模式切换前后拖拽和平移位置不变。
- [x] 网页模式上方缩放时间轴使用当前 viewport 裁剪后的网页 segment。
- [x] 网页模式下方标题为“网页分轨”。
- [x] 每个网页 lane 按规范化域名分组。
- [x] lane 左侧优先显示 favicon；没有 favicon 时显示对应颜色点。
- [x] lane 右侧时长只统计当前 viewport 可见片段。
- [x] lane 内嵌小轨道与上方总轨道使用相同 segment 几何。
- [x] 网页模式没有可见记录时显示“当前时间段暂无记录”。
- [x] 滚轮缩放、横向滚动和拖拽在网页模式下与应用/分类完全一致。

## 14. 与现有“时间线记录列表弹窗”的关系

当前展开按钮打开的是原始记录列表阅读界面，其 `应用 / 网页` Tab 表示记录来源；三态按钮表示横向图形时间轴的聚合维度。两者不是同一个状态机。

- [x] 保留记录列表弹窗现有 `timelineDialogMode: "app" | "web"`。
- [x] 不把 `category` 加入记录列表 Tab。
- [x] 不让主横向时间轴切到 `web` 时自动改变记录列表弹窗的 Tab。
- [x] 不让记录列表弹窗切换 Tab 时改变横向时间轴模式。
- [x] 两个弹窗继续各自承担：缩放弹窗用于视觉细看，记录列表弹窗用于逐条阅读和标题详情。
- [x] 浏览器 smoke 明确覆盖两套状态互不污染。

## 15. 文案与无障碍

### 15.1 文案

- [x] 中文增加“按网页显示”。
- [x] 英文增加“Show by web”或与现有 History 术语一致的短文案。
- [x] 中文增加“网页分轨”。
- [x] 英文增加“Web lanes”。
- [x] 若使用当前/下一模式组合 aria 文案，中英文都必须由 copy owner 提供，不能在 JSX 中拼中文。

### 15.2 三态按钮语义

- [x] 移除该按钮的 `pressed`/`aria-pressed` 二态表达。
- [x] `title` 表达下一次点击结果，例如当前 `category` 时为“按网页显示”。
- [x] `aria-label` 同时表达当前模式和下一模式，例如“当前按分类显示，切换到网页”。
- [x] 图标保持 `aria-hidden`，按钮本身提供名称。
- [x] 键盘 `Tab` 可聚焦，`Enter` 与 `Space` 各只前进一步。
- [x] 模式变化后焦点仍停留在同一按钮。

### 15.3 时间轴内容语义

- [x] 网页 segment aria label 包含域名标签、起止时间和时长。
- [x] 网页 lane 行 aria label 包含域名标签和当前视口时长。
- [x] favicon 使用空 `alt`，避免重复朗读相邻域名文字。
- [x] 缺失 favicon 的颜色点标记为 `aria-hidden`。

## 16. 加载、空态、错误与刷新

- [x] History 日期快照冷加载时继续使用稳定时间轴外框，不闪出错误模式。
- [x] 网页数据已经可用但 favicon/主题色仍在准备时，先用稳定域名颜色点渲染，不阻塞时间轴数据。
- [x] favicon 到达后只替换固定尺寸图标槽，不改变 lane 布局。
- [x] Web Sync 开启且当天无网页活动时，网页模式显示真实空态。
- [x] Web Sync 关闭时，网页模式从循环中消失，不显示虚假空态。
- [x] History 刷新失败且保留旧快照时，网页时间轴与其他 History 区域一样继续显示最后可用数据。
- [x] live 网页片段随现有 `nowMs` 刷新，不新增第二个计时器。
- [x] mapping/域名 override 更新后，网页时间轴标签、颜色和排除状态随现有依赖刷新。
- [x] 不显示“更新中”字样。

## 17. 所有权与允许修改的文件

### 17.1 主要修改点

- [x] `src/features/history/services/historyTimelineViewModel.ts`
  - 扩展 mode 类型。
  - 建立来源中立的 segment/legend/lane 输出。
  - 复用一套裁剪、dominant-minute、合并、视口、legend 和 lane 算法。
- [x] `src/features/history/services/historyWebActivityViewModel.ts`
  - 增加网页图形时间轴 source 归一化入口。
  - 复用现有域名过滤、标签、颜色、favicon 和标题清洗规则。
- [x] `src/features/history/services/historyLayoutPreferenceStorage.ts`
  - 接受 `web`。
  - 增加有效模式解析与循环纯函数，或把循环函数放到相邻明确 owner。
- [x] `src/features/history/components/History.tsx`
  - 组合唯一 mode state。
  - 选择应用/网页 source。
  - 主时间轴和缩放弹窗接入同一个有效 view model。
  - 处理 Web Sync 关闭时的降级。
- [x] `src/features/history/hooks/useHistoryTimelineMode.ts`
  - 统一拥有三态状态、循环、持久化和 Web Sync 降级。
- [x] `src/features/history/hooks/useHistoryTimelineViews.ts`
  - 共享应用/网页归一化 source，分别编译全日与缩放视口。
  - 把数据未就绪与真实空态分开，不让 favicon/主题色增强阻塞网页片段。
- [x] `src/features/history/components/HistoryHorizontalTimeline.tsx`
  - 消费读模型提供的最终 label/color。
  - 支持 `web` class、data 属性、tooltip 和 aria label。
- [x] `src/features/history/components/HistoryTimelineZoomDialog.tsx`
  - 支持网页 lane 标题和来源图标映射。
- [x] `src/features/history/components/HistoryTimelineLaneList.tsx`
  - 从应用专用图标解析收敛为 source icon candidates。
  - 支持网页 favicon 与颜色点 fallback。
- [x] `src/shared/copy/domains/historyCopy.ts`
  - 增加中英文三态按钮与网页 lane 文案。
- [x] `src/styles/features/history.css`
  - 仅在确有需要时增加 web mode/fallback 的 feature-local 样式。

### 17.2 测试修改点

- [x] `tests/historyTimelineViewModel.test.ts`
- [x] `tests/historyWebActivityViewModel.test.ts`
- [x] `tests/uiSmoke.test.ts`
- [x] `tests/uiBrowserSmoke/historyScenarios.ts`

### 17.3 禁止扩散

- [x] 不修改 `src/app/*`。
- [x] 不修改 `src/platform/*`。
- [x] 不修改 `src-tauri/*`。
- [x] 不新增数据库 migration、command 或 capability。
- [x] 不把 History source 类型移到 `src/shared/types`。
- [x] 不因当前 `History.tsx` 较长而顺手做页面级大拆分。
- [x] 如果 `check:hotspots` 因真实新增逻辑失败，只按明确 owner 拆分相邻 History service，不创建通用 util 桶。

## 18. 性能与 React 状态约束

- [x] 不因模式切换重新发起网页 IPC；使用当前日快照已有数据。
- [x] 应用 source 与网页 source 分别用 `useMemo` 归一化。
- [x] 当前有效 mode 只选择 source，不复制整份数组到 React state。
- [x] 全日概览和缩放视口可以各编译一次，但共享已归一化 source。
- [x] mode change 使用函数式 `setState`，避免读取陈旧 mode。
- [x] effect 依赖使用 mode、Web Sync enabled 等原始值，不依赖每次新建的对象。
- [x] 不在 render 中为每个 segment 重复查询 override、分类映射或 favicon。
- [x] legend/lane 聚合继续使用 `Map`，不为每个 segment 扫描完整数组。
- [x] 不新增全局事件监听器。
- [x] 模式切换期间不重建滚轮/拖拽监听器；viewport interaction 继续由现有 hook 所有。

## 19. 分阶段执行步骤

### 阶段 0：冻结基线并写红测

- [x] 记录实施前 `git status --short`，确认工作树已有用户改动范围。
- [x] 运行 `npm run test:history-timeline`，记录当前基线。
- [x] 运行 `npm run test:ui-smoke`，记录当前基线。
- [x] 在 preference 测试中增加 `web` 读写期望，确认生产代码尚未通过。
- [x] 在纯函数测试中增加三态循环与 Web Sync 关闭降级矩阵，确认生产代码尚未通过。
- [x] 在网页 view model 测试中增加网页图形时间轴期望，确认 builder 尚不存在或结果不满足。
- [x] 在 UI smoke 中增加缩放弹窗网页 lane 文案和非二态按钮断言。
- [x] 在浏览器 smoke 中先写主时间轴三次点击和缩放弹窗同步场景。

退出条件：红测失败原因必须指向缺失的网页时间轴能力，而不是 fixture、选择器或测试环境错误。

### 阶段 1：完成三态状态机与持久化

- [x] 将 `HistoryTimelineDisplayMode` 扩展为 `"app" | "category" | "web"`。
- [x] 更新 localStorage 类型守卫接受 `web`。
- [x] 实现并测试 mode 循环纯函数。
- [x] 实现并测试 Web Sync 能力降级纯函数。
- [x] 用函数式 state update 替换当前二态 toggle。
- [x] Web Sync 关闭且当前为 `web` 时，切换并持久化 `app`。
- [x] 从存储读取非法值或访问失败时继续返回 `app`。
- [x] 移除三态按钮的 `pressed` 属性。

退出条件：不接入网页数据时，应用/分类现有行为无回归；持久化和转换表测试全部通过。

### 阶段 2：收敛来源中立的时间轴契约

- [x] 为输入 source 定义最小稳定字段。
- [x] 为输出 segment 增加最终 `key/label/color/iconKeys/sourceKind`。
- [x] 为 legend 增加最终 `color`。
- [x] 为 lane 增加最终 `color` 和 `iconKeys`。
- [x] 将应用颜色解析从组件移入应用 source 归一化。
- [x] 保持现有应用和分类的 segment 数、时间比例、dominant 结果、legend 排序和 lane 排序。
- [x] 更新现有测试 fixture，禁止用 domain 冒充 app 字段。
- [x] 确认 `HistoryHorizontalTimeline` 与 `HistoryTimelineLaneList` 不再自行猜来源业务语义。

退出条件：现有应用/分类全部专项测试通过，渲染输出与改造前等价。

### 阶段 3：构建网页图形时间轴 source

- [x] 从 `visibleDayWebSegments` 构建网页 source items。
- [x] 复用统计排除过滤。
- [x] 复用域名显示名和规范化 key。
- [x] 复用网页颜色优先级。
- [x] 复用 favicon 候选。
- [x] 复用网页标题样本清洗。
- [x] 正确处理 `endTime === null` 的 live segment。
- [x] 复用通用本地日/视口裁剪。
- [x] 复用 minute bucket、dominant 和 merge threshold。
- [x] 生成网页 segment、legend 和 lane。
- [x] 确认不使用 `minSessionSecs` 过滤图形时间轴。

退出条件：网页纯函数测试覆盖裁剪、live、排除、重叠、合并、颜色、图标、legend、lane 和空态。

### 阶段 4：接入主横向时间轴

- [x] 在 `History.tsx` 计算有效 mode。
- [x] 应用/分类选择应用 source，网页选择网页 source。
- [x] 生成全日主时间轴 view model。
- [x] 把有效 mode 传给 `HistoryHorizontalTimeline`。
- [x] 更新按钮 title 和 aria label。
- [x] 保持标签图标和现有按钮位置。
- [x] 网页模式 legend、segment、tooltip 和空态接入。
- [x] 确认网页模式不影响当日摘要、当日活动和当日分布状态。

退出条件：主页面可完整循环 `app → category → web → app`，每种模式展示正确 source。

### 阶段 5：接入时间轴缩放与网页分轨

- [x] 使用与主时间轴相同的有效 mode 和 source 构建 viewport view model。
- [x] 缩放弹窗右上角按钮继续复用同一个 action renderer/handler。
- [x] `HistoryTimelineZoomDialog` 支持网页标题“网页分轨”。
- [x] `HistoryTimelineLaneList` 支持 favicon/icon candidates。
- [x] 缺失 favicon 时使用 lane color 点。
- [x] 网页 lane 时长与 viewport 裁剪一致。
- [x] 模式切换不修改 viewport state。
- [x] 模式切换不取消或重建滚轮/拖拽能力。
- [x] 网页空视口使用“当前时间段暂无记录”。

退出条件：在缩放弹窗内三态循环、滚轮、拖拽、slider、lane 和空态全部工作；关闭后主页面模式同步。

### 阶段 6：完成文案、无障碍和 Quiet Pro 收口

- [x] 补齐中英文 mode 文案和 lane 文案。
- [x] 三态按钮不再输出 `aria-pressed`。
- [x] aria label 同时说明当前与下一模式。
- [x] 键盘操作每次只推进一个状态。
- [x] 网页 segment 和 lane 有完整可读名称。
- [x] favicon/fallback 槽位固定，不产生布局跳动。
- [x] 不新增硬编码 chrome 颜色、圆角、阴影或装饰。
- [x] 深浅主题都使用现有 token 和数据颜色。

退出条件：UI smoke 与键盘人工检查通过，无新增 Quiet Pro 风格债务。

### 阶段 7：补齐自动化回归

- [x] 完成第 20 节所有纯函数测试。
- [x] 完成第 21 节所有浏览器交互测试。
- [x] 运行 `npm run test:history-timeline`。
- [x] 运行 `npm run test:ui-smoke`。
- [x] 运行 `npm run test:ui-browser-smoke`。
- [x] 运行 `npm run check`。
- [x] 若读模型基准受影响，运行 `npm run perf:history-read-model` 和 `npm run perf:stable`。
- [x] 记录每条命令结果与失败重跑原因。

退出条件：专项和默认前端门禁全部通过，性能无明显退化。

### 阶段 8：人工验收与收尾

- [x] 执行第 22 节完整矩阵。
- [x] 使用临时截图复核主时间轴网页模式，验收后不归档截图。
- [x] 使用临时截图复核缩放弹窗网页模式和网页分轨，验收后删除截图。
- [x] 确认没有误改记录列表弹窗状态。
- [x] 检查最终 diff 只落在 History owner、copy、测试和必要 feature 样式。
- [x] 若进入发布范围，再决定是否更新 `CHANGELOG.md`。
- [x] 更新本文档勾选和验证证据。
- [x] 完成后移动到 `docs/archive/`。

## 20. 确定性测试矩阵

### 20.1 模式与持久化

- [x] 默认读取 `app`。
- [x] `app/category/web` 都能往返 localStorage。
- [x] 非法值回退 `app`。
- [x] localStorage 不可访问时安全回退。
- [x] Web Sync 开启：`app → category → web → app`。
- [x] Web Sync 关闭：`app → category → app`。
- [x] Web Sync 关闭时 `web` 有效模式回退 `app`。

### 20.2 网页 source 与裁剪

- [x] 片段裁剪到本地日开始。
- [x] 片段裁剪到本地日结束。
- [x] 片段裁剪到缩放 viewport。
- [x] 今天 live 片段封口到 `nowMs`。
- [x] 未来部分不显示。
- [x] 视口外片段不进入 segment、legend 或 lane。
- [x] 不足最小可视时长的片段按现有规则过滤。

### 20.3 域名语义

- [x] 相同 normalized domain 聚合为同一个 legend/lane。
- [x] 自定义显示名进入 legend、lane 和 tooltip。
- [x] 自定义颜色优先。
- [x] favicon 主题色次优。
- [x] 已分类域名使用分类色。
- [x] 未分类且无图标时使用稳定 fallback 色。
- [x] disabled 域名完全消失。
- [x] favicon 缺失时 iconKeys 不造成异常。

### 20.4 dominant-minute 与合并

- [x] 单一分钟单域名生成一个 segment。
- [x] 同一分钟多段同域名累加时长。
- [x] 同一分钟多域名按时长选 dominant。
- [x] 时长相同按首次出现时间决胜。
- [x] 仍相同按稳定 key 决胜。
- [x] 相邻同域名按 merge threshold 合并。
- [x] 不同域名不因短间隔被合并。
- [x] alternate labels 使用网页标签而不是应用名。

### 20.5 视口不变量

- [x] 三种模式轴刻度一致。
- [x] 三种模式 viewport 起止一致。
- [x] legend/lane 时长只计算当前视口交集。
- [x] 模式切换不修改 zoom preference。
- [x] 模式切换不修改 viewport start。

## 21. 浏览器交互 Smoke 矩阵

- [x] Web Sync 开启且有应用、分类、网页 fixture。
- [x] 初始 `data-history-timeline-mode="app"`。
- [x] 点击主按钮一次变为 `category`。
- [x] 再点一次变为 `web`，legend 出现 fixture 域名。
- [x] 再点一次回到 `app`。
- [x] 三态按钮没有 `aria-pressed`。
- [x] 每一步 aria label 指向正确的下一模式。
- [x] 网页 segment hover tooltip 显示域名和时间。
- [x] 在 `web` 模式打开缩放弹窗，弹窗 timeline 也是 `web`。
- [x] 记录弹窗内 zoom hours、window start 和 window end。
- [x] 在弹窗点击模式按钮，主时间轴同步变化。
- [x] 切换后 zoom hours、window start 和 window end 不变。
- [x] 网页 lane 数量、域名标签和 favicon/fallback 正确。
- [x] 网页模式滚轮缩放 0.2 小时有效。
- [x] 网页模式拖拽平移有效。
- [x] 关闭弹窗后主时间轴保持最后模式。
- [x] 打开记录列表弹窗，其 `应用 / 网页` Tab 状态不受三态按钮污染。
- [x] Web Sync 关闭 fixture 下点击只在 `app/category` 循环。
- [x] Web Sync 开启但无网页记录时，网页模式显示空态且按钮仍能继续回到 `app`。
- [x] disabled 域名不出现在主时间轴、缩放时间轴或 lane。

## 22. 人工验收矩阵

### 22.1 核心路径

- [x] 今天：应用、分类、网页三态循环顺序正确。
- [x] 历史日期：三态循环顺序正确。
- [x] 网页模式只显示真实网页活动区间。
- [x] 浏览器应用存在但网页数据缺失时，网页模式保留空档。
- [x] 主时间轴和缩放弹窗双向同步。
- [x] 缩放后切换模式，时间窗口不跳。
- [x] 拖拽后切换模式，时间窗口不跳。
- [x] 关闭并重新打开应用后恢复上次有效模式。

### 22.2 网页身份

- [x] 有 favicon 的域名显示 favicon。
- [x] 无 favicon 的域名显示稳定颜色点。
- [x] 自定义域名名称立即反映。
- [x] 自定义域名颜色立即反映。
- [x] 域名改分类后颜色规则与现有网页分布一致。
- [x] 域名排除后从所有网页时间轴派生结果消失。
- [x] 恢复统计后既有历史重新出现，排除期间不补记。

### 22.3 状态边界

- [x] Web Sync 关闭时没有网页循环步骤。
- [x] Web Sync 重新开启时不自动抢占当前模式。
- [x] 当天无网页记录时空态清楚且低噪音。
- [x] 缩放到无网页记录窗口时显示“当前时间段暂无记录”。
- [x] History 刷新失败保留旧内容时，网页时间轴不整块消失。
- [x] live 网页片段随时间增长，但不超出当前时间。

### 22.4 视觉与布局

- [x] 1366×768 深色主题。
- [x] 1366×768 浅色主题。
- [x] 1600px 以上宽屏。
- [x] 1900px 以上宽屏。
- [x] 主时间轴三种模式高度一致。
- [x] 缩放弹窗三种模式工具栏不位移。
- [x] 网页 lane favicon/fallback 不造成文本跳动。
- [x] legend 超过 7 项时 `+N` tooltip 正常。
- [x] 没有新增图标外框、强阴影、渐变、霓虹或卡片套卡片。

### 22.5 键盘与辅助技术

- [x] `Tab` 可到达主时间轴模式按钮。
- [x] `Enter` 每次只切换一步。
- [x] `Space` 每次只切换一步。
- [x] 焦点在模式变化后不丢失。
- [x] 屏幕阅读器能听到当前模式和下一模式。
- [x] 网页 segment 与 lane 的名称和时长可理解。
- [x] 缩放弹窗关闭后焦点恢复符合现有 Dialog 行为。

## 23. 风险与防错

### 23.1 双计风险

风险：把网页时长叠加到应用或分类总时长，造成当日统计超过真实活跃时间。

防错：

- [x] 三种模式互斥。
- [x] 不修改摘要和应用分类读模型。
- [x] 测试断言网页 legend 分母独立。

### 23.2 数据缺口被误认为 bug

风险：网页模式存在空档，而应用模式显示 Chrome，用户可能认为时间轴漏记。

防错：

- [x] 不伪造数据。
- [x] 空态和产品文案保持“网页记录”语义。
- [x] 验收中明确检查扩展未上报区间。

### 23.3 组件继续依赖应用字段

风险：把 domain 塞进 `appKey/exeName` 能快速显示，但会制造长期语义债务。

防错：

- [x] 建立 source-neutral 输出。
- [x] 测试 fixture 禁止依赖伪应用字段。
- [x] 组件只读最终 label/color/iconKeys。

### 23.4 三态按钮仍保留二态无障碍语义

风险：`aria-pressed=true` 只在分类模式出现，会错误暗示分类是“开”、其他模式是“关”。

防错：

- [x] 移除 `pressed`。
- [x] 用当前模式 + 下一模式 aria label 表达循环操作。
- [x] UI smoke 明确断言不存在 `aria-pressed`。

### 23.5 模式切换重置视口

风险：mode memo 或 effect 依赖错误导致每次切换重新聚焦当前时间。

防错：

- [x] viewport state 与 mode state 分离。
- [x] 只在日期变化或打开缩放弹窗初始化视口。
- [x] 浏览器 smoke 比较切换前后窗口属性。

### 23.6 `History.tsx` 继续变厚

风险：把网页归一化和颜色规则直接塞入页面组件。

防错：

- [x] 页面只做选择与组合。
- [x] 网页规则进入 `historyWebActivityViewModel.ts`。
- [x] 通用时间轴几何进入现有时间轴 service。
- [x] 不新增 page-local helper 堆积业务规则。

### 23.7 性能回归

风险：每种模式每次 render 都重新构建整日 source、legend 和 lanes。

防错：

- [x] source 归一化 memo 化。
- [x] 只对当前有效 mode 编译视图。
- [x] 全日和 viewport 编译共享 source。
- [x] 必要时运行 History 基准和稳定基准。

## 24. 回滚策略

本次不涉及数据库、IPC 或持久化 schema，因此回滚应保持为前端 feature 内可逆改动。

- [x] 回滚 UI 接入时，先恢复两态 mode union 与循环函数。
- [x] `patina:history-timeline-mode=web` 在旧代码中会被现有守卫视为非法并回退 `app`，无需迁移脚本。
- [x] 回滚网页 builder 不影响已有网页分布和网页记录列表。
- [x] 回滚不得删除或改写用户的网页活动数据。
- [x] 若只发现网页 lane 问题，可以暂时隐藏网页 lane，但不能让主/弹窗模式状态分裂；优先整体回滚网页视觉模式。

## 25. 验证命令与证据记录

### 25.1 开发期快速验证

```powershell
npm run test:history-timeline
npm run test:ui-smoke
npm run check:types
npm run check:lint
```

- [x] `npm run test:history-timeline`：结果记录。
- [x] `npm run test:ui-smoke`：结果记录。
- [x] `npm run check:types`：结果记录。
- [x] `npm run check:lint`：结果记录。

### 25.2 交互验证

```powershell
npm run test:ui-browser-smoke
```

- [x] 记录总通过数。
- [x] 若存在与本事项无关的既有失败，记录测试名、基线证据和隔离复跑结果，不把失败静默忽略。

### 25.3 默认前端门禁

```powershell
npm run check
```

- [x] `npm run check` 运行到热点门禁；本事项 owner 全部通过，仓库级结果仅被并行迁移修改的 `src/styles/tokens.css` 与 `src/app/AppShell.tsx` 热点增长阻断，见第 29 节。
- [x] bundle budget 无新增超限。
- [x] architecture、naming、IPC、test governance 与 History hotspot 通过；并行迁移的非 History hotspot 单独记录。

### 25.4 性能复核（出现明显读模型扩展或基准波动时）

```powershell
npm run perf:history-read-model
npm run perf:stable
```

- [x] 记录平均值与最差 p95。
- [x] 与实施前基线比较。
- [x] 若明显退化，先优化 source 归一化和重复编译，不通过放宽预算掩盖问题。

## 26. Project、Issue 与发布边界

- [x] 本执行单创建时不修改 GitHub Project。
- [x] 正式开始实施前，按仓库规则通过浏览器读取 live Project，确认是否已有相同或高度重叠事项。
- [x] 若没有现有事项，先向维护者展示新增 draft item 预览；未经明确 Project 更新授权不创建。
- [x] 实施开始后若对应已有事项，只向维护者报告建议拖动到 `In progress`，不代替维护者拖动。
- [x] 实现和验证完成后只报告建议拖动到 `Done`，不自动修改 Issue 状态。
- [x] 不使用 `Closes`、`Fixes` 或 `Resolves`。
- [x] 若未来提交需要引用历史反馈，只在 commit body 使用独立 `Refs #6` 段落，不放在 subject。
- [x] 只有进入实际发布范围时才更新 `CHANGELOG.md` 的 `Unreleased`。
- [x] 本事项不单独承诺版本号、发布日期或 Target release。

## 27. 完成定义

只有以下条件全部满足，事项才算完成：

- [x] 主时间轴在 Web Sync 开启时完整循环 `应用 → 分类 → 网页 → 应用`。
- [x] Web Sync 关闭时只循环 `应用 ↔ 分类`。
- [x] 网页模式只显示真实网页活动，不与应用时间双计。
- [x] 主时间轴和缩放弹窗共享同一个模式状态。
- [x] 缩放弹窗网页模式包含网页总轨道和网页分轨。
- [x] 模式切换不改变日期、缩放倍数或视口位置。
- [x] 现有记录列表弹窗 `应用 / 网页` Tab 未被错误绑定到三态状态。
- [x] 网页排除、显示名、颜色、favicon 和 live 语义一致。
- [x] 三态按钮无 `aria-pressed` 误导，键盘与屏幕阅读器语义正确。
- [x] 应用/分类原有时间轴测试无回归。
- [x] 网页纯函数和浏览器交互回归测试齐全。
- [x] 本事项可归责门禁通过；`npm run check` 的并行迁移例外已完整记录并有隔离复跑证据。
- [x] 人工验收矩阵通过；视觉截图仅用于临时复核，不作为仓库归档附件。
- [x] 最终 diff 没有越出允许 owner。
- [x] 文档勾选、验证记录和实际代码一致。
- [x] 文档已移入 `docs/archive/`。

## 28. 最终总清单

- [x] 基线已冻结。
- [x] 红测已建立。
- [x] 三态状态机完成。
- [x] 持久化完成。
- [x] 来源中立时间轴契约完成。
- [x] 网页 source 完成。
- [x] 主横向时间轴网页模式完成。
- [x] 时间轴缩放网页模式完成。
- [x] 网页分轨完成。
- [x] 中英文文案完成。
- [x] 无障碍完成。
- [x] 专项测试完成。
- [x] 浏览器交互测试完成。
- [x] 本事项默认门禁完成，仓库级并行迁移例外已记录。
- [x] 人工验收完成。
- [x] Project/Issue 边界已遵守。
- [x] 文档已归档。

## 29. 完成证据

### 29.1 实现结果

- 三态循环已接入 History 主横向时间轴与时间轴缩放弹窗，状态顺序为 `app → category → web → app`。
- Web Sync 不可用时，有效状态自动降级并持久化为 `app`，后续只循环 `app ↔ category`。
- 应用、分类与网页共用来源中立的裁剪、minute bucket、dominant 选择、相邻合并、legend、lane 与轴刻度构建。
- 网页 source 只来自真实 `visibleDayWebSegments`；排除域名、live 封口、显示名、颜色和 favicon 候选均复用现有 History 网页规则。
- 主时间轴与缩放弹窗共享同一 mode 和 viewport；记录列表弹窗的 `应用 / 网页` Tab 保持独立。
- favicon 与主题色是可选增强：网页数据已就绪时先渲染稳定颜色点，视觉资源到达后原位替换。

### 29.2 自动化与性能

| 命令 | 结果 |
| --- | --- |
| `npm run test:history-timeline` | 通过：35 个 History 时间轴、17 个网页时间轴、21 个 History 读模型、3 个格式化测试。 |
| `node ... tests/uiBrowserSmoke.test.ts --history-web-timeline-only` | 通过：4/4；覆盖域名排除、三态循环、Enter/Space、焦点保持、主/缩放同步、滚轮缩放、拖拽、Web Sync 降级与真实空态。 |
| `npm run check:types` | 通过。 |
| `npm run check:lint` | 全仓通过；最终 History/test 范围 ESLint 也通过。 |
| `npm run check:naming` | 通过。 |
| `npm run check:architecture` | 通过。 |
| `npm run check:ipc-contracts` | 通过：97 个 platform call 与 97 个注册命令一致。 |
| `npm run check:test-governance` | 通过：41 个顶层测试，无默认门禁重复。 |
| `npm run build` | 通过：430 modules；History lazy chunk gzip 16.46 kB。 |
| `npm run test:mutation` | 通过：14/14，mutation score 100%。 |
| `npm run test:replay` | 通过：15/15。 |
| `npm run perf:history-read-model` | 通过：当前读模型平均 29.89ms，p95 33.30ms，预算 170/255ms。 |
| `npm run perf:stable` | 通过：5 轮 History 当前读模型平均 30.65ms，最差 p95 38.05ms，最差 max 62.29ms。 |

### 29.3 仓库级并行改动例外

以下失败均在本事项专项通过后复跑并定位，没有静默忽略，也没有擅自修改并行 owner：

- `npm run check` 在热点门禁停止：`src/styles/tokens.css` 与 `src/app/AppShell.tsx` 超出基线；History 自身为 1170 行、AST 5379、最大函数 AST 1814，全部低于 History 预算。
- `npm test` 在已完成本事项相关前半段后停止：并行 destination 迁移已删除 `tests/dataDestinationDetail*.test.ts`，但当时 `package.json` 仍引用旧文件名。
- `npm run test:ui-smoke` 的本事项结构断言通过，随后因并行迁移已删除 `src/features/data/components/DataDestinationDetailDialog.tsx`、旧测试仍读取该路径而停止。
- 完整 `npm run test:ui-browser-smoke` 中全部 History 场景通过，随后在 Data 详情场景等待旧 selector 超时；运行期间还观察到并行 CSS 编辑触发的 Vite 临时解析错误。此前并行迁移开始前的完整基线为 64/64 通过。
- `npm run check:bundle` 报告初始 AppShell、destination lazy chunk、共享 copy bundle 等并行迁移问题；没有报告 History lazy chunk 超限。
- `npm run check:quiet-pro-style-debt` 要求把 `HistoryTimelineLists.tsx` 的既有债务基线从 8 收紧到 4；该文件的列表卡片收敛属于本事项开始前已有改动，本事项未改写其基线。

### 29.4 视觉验收

- 使用临时截图复核了 1366×768 深浅主题、1600×900、1920×900，以及 1366×768 深浅主题缩放弹窗。
- 自动化确认 1600px 与 1920px 宽屏没有横向溢出。
- 视觉复核确认按钮位置、卡片高度、legend 密度、lane 对齐、favicon/颜色点槽位和深浅主题均符合 Quiet Pro；未新增图标外框、强阴影、渐变或霓虹。
- 临时截图已按维护者要求删除，不作为仓库归档内容。

### 29.5 对抗式审查

审查按“假设实现有错”的方式检查状态竞争、存储异常、可选资源延迟、空态误判、deterministic tie、键盘语义、视口保持、跨页面测试污染和热点预算。发现并修复：

1. 把三态状态和双视图编译分别收敛到 `useHistoryTimelineMode`、`useHistoryTimelineViews`，使 `History.tsx` 回到热点预算内。
2. 增加 localStorage 访问异常时 mode 读取回退与写入不抛错测试。
3. 区分网页数据快照与 favicon/主题色增强，避免可选视觉资源阻塞真实网页片段。
4. 区分加载占位与真实空态，避免缩放弹窗在网页数据未就绪时误报“当前时间段暂无记录”，同时保证模式按钮可切回。
5. 增加 dominant-minute 的“时长 → 首次出现 → 稳定 key”完整决胜测试。
6. 增加 Space 切换和切换后焦点保持的真实浏览器覆盖。
7. 将 History 专项场景用于重新挂载的中转页改为“今天”，避免与正在迁移的 Data 页面耦合。
8. 增加 1600/1920 宽屏无溢出检查和临时截图复核。

最终结论：没有遗留的 History 网页时间轴阻断性或高风险审查发现。

### 29.6 GitHub Project 与发布边界

- 完成前只读复核 live `Patina Development Queue`：`Queued 2`、`Next 2`、`In progress 0`、`Blocked 3`、`Done 26`。
- 没有与“History 网页时间轴三态模式”相同或高度重叠的现有事项，因此没有可建议从 `In progress` 拖到 `Done` 的卡片。
- 未创建 draft item，未拖动 Project 状态，未修改 Issue、Changelog、版本号、分支、提交或远端。
