# Dashboard 与 History 小时柱分类分层切换执行方案

## 1. 文档定位

本文是一份临时执行单，用于规划 `Dashboard` 与 `History` 页面小时柱状图的分类分层切换能力。

本文不是长期设计规范，也不是已经完成的实现记录。执行完成并验收后，应将本文移入 `docs/archive/`，避免让一次性方案长期停留在 `docs/working/`。

文档类型：`How-to / Execution Plan`

目标读者：

- 负责实现本轮小时图增强的开发者
- 负责复核 Quiet Pro 一致性、读模型 owner 和回归验证的协作者

目标结果：

- 保留现有单色小时柱作为默认视图
- 在 Dashboard“今日活动”和 History“当日活动”标题右侧分别新增一个克制的 `Layers3` 图标按钮
- 用户点击后，可在当前页面的同一张小时图中查看按应用分类堆叠的时长构成
- Dashboard 与 History 使用同一套分类聚合、排序、折叠和 tooltip 规则
- 不引入新的持久化、平台能力或运行时职责

---

## 2. 已确认的范围变化

本轮讨论已经确认：

- [x] Dashboard 与 History 的小时柱分类能力保持一致
- [x] 不采用“只在 Dashboard 试做、History 暂时保持单色”的范围
- [x] 两个页面应复用同一个小时聚合 owner，避免规则逐渐漂移

“保持一致”具体表示：

- 两处都保留单色总活动模式
- 两处都提供 `Layers3` 切换按钮
- 两处都使用相同分类系列数量限制
- 两处都使用相同稳定排序
- 两处都使用相同 remainder 语义
- 两处都使用相同分类 tooltip 语义

“保持一致”不表示：

- 两个页面之间实时同步按钮状态
- 离开一个页面后，另一个页面自动继承当前模式
- 将模式写入 settings 或数据库

推荐基线：

- 每个页面实例独立维护本地模式状态
- 每次进入页面时默认显示单色总活动柱

---

## 3. 当前实现与边界问题

### 3.1 Dashboard 当前实现

Dashboard 的“今日活动”卡片位于：

- `src/features/dashboard/components/Dashboard.tsx`

Dashboard 小时读模型接入点位于：

- `src/features/dashboard/services/dashboardReadModel.ts`
  - `hourlyActivity: buildHourlyActivity(compiledSessions)`

### 3.2 History 当前实现

History 的“当日活动”卡片位于：

- `src/features/history/components/History.tsx`

History 小时读模型接入点位于：

- `src/features/history/services/historyReadModel.ts`
  - `hourlyActivity: buildHourlyActivity(compiledSessions)`

### 3.3 当前共用逻辑

现有小时聚合函数位于：

- `src/features/dashboard/services/dashboardFormatting.ts`
  - `buildHourlyActivity(sessions)`

当前事实：

- Dashboard 使用该函数。
- History 也跨 feature 导入该函数。
- 现有函数只返回每小时总分钟数。

### 3.4 本轮需要顺手收口的 owner

原先将新增 builder 继续放进 Dashboard feature 的方案不再合适。

原因：

- 分类小时聚合将同时服务 Dashboard 与 History。
- 它已经是稳定的跨 feature 纯读模型能力。
- 如果继续放在 `features/dashboard/*`，History 会继续反向依赖 Dashboard 私有服务。

推荐新 owner：

- `src/shared/lib/hourlyActivityCompiler.ts`

该文件只负责：

- 按小时切分 session
- 生成单色总活动小时数据
- 生成分类分层小时数据
- 保持堆叠和总分钟数一致

该文件不负责：

- 页面状态
- Recharts 渲染
- tooltip 组件
- settings
- SQLite
- Tauri IPC
- Rust runtime

---

## 4. 产品与设计目标

### 4.1 用户问题

现有单色小时柱可以回答：

- 某个小时活跃了多久
- 哪些时段更集中

但它不能直接回答：

- 某个小时主要由哪些类型的活动组成
- 开发、沟通、浏览等分类在一天中如何变化
- 某一段高峰是否来自单一分类，还是多个分类叠加

### 4.2 Quiet Pro 方向

本轮增强应保持：

- 默认界面安静，不主动增加大量彩色信息
- 分类视图由用户显式开启
- 每张小时图只增加一个图标按钮
- 分类颜色只服务数据理解，不改变卡片外围 chrome
- 不新增图例墙、额外说明卡或大块装饰
- 两个页面使用相同控件语义，降低学习成本

### 4.3 非目标

本轮明确不做：

- [x] 不新增图表设置页
- [x] 不持久化用户的图表模式偏好
- [x] 不在 Dashboard 与 History 之间同步临时模式状态
- [x] 不新增数据库字段或 Tauri IPC
- [x] 不改变现有应用分类规则
- [x] 不改变分类颜色管理逻辑
- [x] 不改变 Dashboard 专注分布环形图的现有 `4 / 6 + 其余` 响应式规则
- [x] 不新增可拖拽排序、筛选弹窗或分类图例面板
- [x] 不将本轮扩展成通用图表框架重构
- [x] 不改变 History 日期选择、时间线、应用分布和标题详情行为

---

## 5. 推荐交互方案

### 5.1 两处入口

分别在以下标题右侧增加一个 `Layers3` 图标按钮：

| 页面 | 卡片标题 | 按钮位置 |
| --- | --- | --- |
| Dashboard | `今日活动` | 标题行右侧 |
| History | `当日活动` | 标题行右侧 |

### 5.2 按钮行为

| 状态 | 图标 | 图表内容 | Tooltip 文案 | 按钮状态 |
| --- | --- | --- | --- | --- |
| 默认 | `Layers3` | 现有单色总活动柱 | `按分类显示` | 未按下 |
| 分类模式 | `Layers3` | 分类堆叠柱 | `显示总活动` | 已按下 |

推荐规则：

- 默认进入页面时保持单色模式。
- 点击按钮后，只改变当前页面实例的本地状态。
- 再次点击后恢复单色模式。
- 按钮使用 `aria-pressed` 表达切换状态。
- 分类模式开启时，按钮使用 Quiet Pro 的 pressed 状态。
- 两个页面使用同一组中英文文案。

### 5.3 数据表达

分类模式仍然保持：

- 横轴：`00:00` 到 `23:00`
- 纵轴：每小时累计分钟数，固定 `0 - 60`
- 每根柱子：一个小时的总活动
- 柱子内部：按分类拆分的分钟数

### 5.4 稳定排序

分类系列应先按“所选当天累计分类时长”生成稳定排序，再将同一排序应用到全部 24 根柱子。

推荐采用：

- Tooltip：按当天累计分类时长从高到低展示
- 视觉堆叠：从上到下按当天累计分类时长从高到低排列
- Recharts `<Bar>` 声明顺序：按展示顺序反转，以便实现“高时长分类在上方”

不推荐采用：

- 每个小时独立按该小时分类时长重新排序

原因：

- 同一种颜色在相邻柱子中的位置会持续跳动
- 用户更难横向追踪同一分类
- 两个页面之间更难形成稳定认知

---

## 6. 实现前必须确认的产品决策

以下项目在开始写实现代码前必须逐项确认。

### 6.1 模式默认值

- [x] 确认两个页面默认模式均为“总活动单色柱”
- [x] 确认两个页面各自使用组件本地状态，不写入 settings
- [x] 确认页面之间不需要同步临时模式状态
- [x] 确认离开页面后允许恢复默认模式

推荐结论：全部确认。

### 6.2 图标按钮

- [x] 确认两个页面均只使用一个 `Layers3` 图标按钮
- [x] 确认不同时显示第二个单色图标
- [x] 确认按钮分别放在“今日活动”和“当日活动”标题右侧
- [x] 确认未开启时 tooltip 为“按分类显示”
- [x] 确认开启后 tooltip 为“显示总活动”

推荐结论：全部确认。

### 6.3 分类系列数量

候选方案：

| 方案 | 规则 | 优点 | 代价 |
| --- | --- | --- | --- |
| A | 展示全部分类 | 信息完整 | 分类较多时色块与 tooltip 容易变吵 |
| B | 前 `5` 类 + “其他分类” | 稳定、克制，适合两处小时图 | 低占比分类会被合并 |
| C | 前 `6` 类 + “其他分类” | 信息量略高 | 接近视觉噪音上限 |

推荐采用方案 B：

- [x] 最多展示所选当天累计时长最高的 `5` 个真实分类
- [x] 其余分类合并为一个 synthetic remainder series
- [x] synthetic remainder series 使用独立内部 key，不与真实 `other` 分类共用 key
- [x] synthetic remainder series 的显示名称使用“其他分类”
- [x] 真实 `other` 分类继续显示为“未分类”

说明：

- “其他分类”代表被折叠的低占比分类集合。
- “未分类”代表分类系统中的真实 `other` 分类。
- 两者必须在数据结构和界面文案上保持可区分。

### 6.4 堆叠排序

- [x] 确认全部小时柱使用同一套“所选当天累计分类时长”排序
- [x] 确认视觉顺序为从上到下按当天累计分类时长从高到低排列
- [x] 确认 remainder series 固定放在堆叠底部
- [x] 确认 tooltip 使用同一套从高到低顺序，但不显示该小时为 `0m` 的分类

推荐结论：全部确认。

### 6.5 Tooltip 内容

推荐分类模式 tooltip：

```text
09:00 · 总活动 48m
开发     31m
浏览     12m
通讯      5m
```

需要确认：

- [x] 确认 tooltip 顶部同时显示小时与该小时总活动
- [x] 确认分类条目显示分类色点、分类名称和分钟数
- [x] 确认隐藏 `0m` 分类
- [x] 确认分类条目按稳定排序展示
- [x] 确认单色模式 tooltip 保持现有语义

推荐结论：全部确认。

---

## 7. 架构边界

### 7.1 处理模式判断

范围扩大后，本轮不再只是 Dashboard feature 内部小修。

本轮属于：

- Dashboard 与 History 的一致性增强
- 跨 feature 纯读模型 owner 收口
- 现有共享控件的小幅状态补全

本轮仍然不需要触及平台层或 Rust，但应按“边界判断模式”执行：

- 先确定 shared owner
- 再迁移现有调用方
- 最后接入两处 UI

### 7.2 真实 owner

共享小时聚合 owner：

- `src/shared/lib/hourlyActivityCompiler.ts`

页面接入 owner：

- `src/features/dashboard/services/dashboardReadModel.ts`
- `src/features/dashboard/components/Dashboard.tsx`
- `src/features/history/services/historyReadModel.ts`
- `src/features/history/components/History.tsx`

共享控件 owner：

- `src/shared/components/QuietIconAction.tsx`
- `src/styles/app-shell.css`

用户可见文案 owner：

- `src/shared/copy/uiText.ts`

### 7.3 允许修改

实现允许修改：

- `src/shared/lib/hourlyActivityCompiler.ts`
- `src/features/dashboard/services/dashboardFormatting.ts`
- `src/features/dashboard/services/dashboardReadModel.ts`
- `src/features/dashboard/components/Dashboard.tsx`
- `src/features/history/services/historyReadModel.ts`
- `src/features/history/components/History.tsx`
- `src/shared/components/QuietIconAction.tsx`
- `src/styles/app-shell.css`
- `src/shared/copy/uiText.ts`

如确有页面私有样式需要，允许修改：

- `src/styles/features/dashboard.css`
- `src/styles/quiet-pro.css`

样式边界说明：

- 新增的通用图标按钮 pressed / focus-visible 状态放入 `src/styles/app-shell.css`。
- Dashboard 私有样式放入 `src/styles/features/dashboard.css`。
- History 当前既有小时图样式位于 `src/styles/quiet-pro.css`；只允许做与现有 History 卡片一致的最小调整。
- 不为本轮顺手迁移整段 History CSS。

测试允许修改：

- `tests/trackingReplay.test.ts`
- `tests/uiSmoke.test.ts`
- `tests/uiBrowserSmoke.test.ts`
- 必要时补充现有 tracking lifecycle 测试

### 7.4 默认禁止扩散

- `src/app/*`
- `src/platform/*`
- `src-tauri/*`
- 数据库 migration
- settings persistence

### 7.5 兼容策略

推荐：

- 将 `buildHourlyActivity(...)` 从 `dashboardFormatting.ts` 移入 `shared/lib/hourlyActivityCompiler.ts`
- Dashboard 与 History 直接改为从新 owner 导入
- 不在 `dashboardFormatting.ts` 长期保留 forwarding export

实施时必须先搜索调用方：

- [x] 运行 `rg -n "buildHourlyActivity" src tests scripts`
- [x] 确认所有调用方都已迁移
- [x] 没有无法立即迁移的真实兼容调用方，不保留 forwarding export

### 7.6 QuietIconAction 边界

`QuietIconAction` 当前已支持：

- 图标
- tooltip
- disabled
- tone
- className

但它尚未显式支持 pressed 状态。

推荐做法：

- [x] 为 `QuietIconAction` 增加可选 `pressed?: boolean`
- [x] 仅当调用方传入 `pressed` 时渲染 `aria-pressed`
- [x] pressed 状态使用现有 Quiet Pro token
- [x] 不新增新的共享按钮组件
- [x] 不把小时图 mode 或页面状态放入 `QuietIconAction`

这是对现有稳定 control archetype 的小幅补全。

---

## 8. 目标读模型设计

### 8.1 新 shared 文件

新增：

- `src/shared/lib/hourlyActivityCompiler.ts`

该文件接管现有总活动模型，并新增分类模型。

### 8.2 保留总活动模型

现有类型保持兼容：

```ts
export interface HourlyActivityPoint {
  hour: string;
  minutes: number;
}
```

现有函数保持兼容：

```ts
buildHourlyActivity(sessions): HourlyActivityPoint[]
```

原因：

- Dashboard 与 History 的单色模式仍然需要该模型
- 本轮新增能力不应破坏现有行为

### 8.3 新增分类小时模型

推荐新增类型：

```ts
export interface HourlyCategorySeries {
  dataKey: string;
  category: AppCategory | null;
  name: string;
  color: string;
  totalMinutes: number;
  isRemainder: boolean;
}

export interface HourlyCategoryActivityPoint {
  hour: string;
  minutes: number;
  [dataKey: string]: string | number | null;
}

export interface HourlyCategoryActivity {
  points: HourlyCategoryActivityPoint[];
  series: HourlyCategorySeries[];
}
```

说明：

- `points` 提供 Recharts 所需的 24 小时扁平数据。
- `series` 提供动态 `<Bar>` 渲染所需的 key、名称、颜色和排序信息。
- `dataKey` 使用图表安全的内部 key，例如 `category0`、`category1`、`remainder`。
- 不直接将自定义分类 ID 当作 Recharts `dataKey`。
- 自定义分类 ID 可能包含编码字符，不应让其进入图表字段路径语义。

### 8.4 新增 builder

推荐新增：

```ts
buildHourlyCategoryActivity(
  sessions,
  options,
): HourlyCategoryActivity
```

推荐 options：

```ts
interface BuildHourlyCategoryActivityOptions {
  visibleCategoryLimit: number;
}
```

### 8.5 小时切分 helper

现有 `buildHourlyActivity(...)` 已经实现 session 跨小时切分。

为避免两套规则漂移：

- [x] 在 `hourlyActivityCompiler.ts` 内提取文件私有 helper
- [x] helper 逐段产出 `hourIndex` 与 `durationMs`
- [x] `buildHourlyActivity(...)` 复用该 helper
- [x] `buildHourlyCategoryActivity(...)` 也复用该 helper
- [x] helper 保持文件私有，不新增第二个 util

推荐 helper 形态：

```ts
function forEachHourlySessionSegment(
  session: HistorySession,
  visit: (hourIndex: number, durationMs: number) => void,
) {
  // existing hour slicing behavior
}
```

### 8.6 分类解析

每段 session 应使用现有分类系统解析：

```ts
AppClassification.mapApp(session.exeName, {
  appName: session.appName,
})
```

需要做到：

- [x] 使用 `mapped.category` 作为分类归属
- [x] 使用 `AppClassification.getCategoryLabel(category)` 作为显示名称
- [x] 使用 `AppClassification.getCategoryColor(category)` 作为分类颜色
- [x] 使用局部 `Map` 缓存同一应用的分类解析结果
- [x] 不在组件层重新执行分类判断
- [x] 不绕过用户分类覆盖与分类颜色覆盖

### 8.7 聚合与 remainder

推荐算法：

1. 初始化 24 个小时桶。
2. 遍历 session。
3. 解析 session 分类。
4. 按小时拆分 session。
5. 同时累计每小时总分钟数、每小时每分类分钟数和当天每分类总分钟数。
6. 按当天分类总分钟数从高到低排序。
7. 保留前 `visibleCategoryLimit` 个真实分类。
8. 将剩余分类合并为 synthetic remainder。
9. 输出 24 个图表 point 与动态 series。

需要注意：

- [x] remainder 使用独立 key，例如 `remainder`
- [x] remainder 的 `category` 使用 `null`
- [x] remainder 显示名称使用 `UI_TEXT.dashboard.remainingCategories`
- [x] remainder 颜色优先复用中性语义 token，例如 `var(--qp-text-tertiary)`
- [x] 实际 `other` 分类仍使用分类注册表中的颜色
- [x] 每小时总分钟数必须与分类堆叠分钟数总和一致
- [x] Dashboard 与 History 不允许分别生成不同 series 规则

### 8.8 舍入策略

推荐：

- 聚合过程内部保留浮点分钟数
- 最终输出 point 时统一 `Math.round(...)`
- 对每个小时校正 remainder 或最后一个非零分类，使分类分钟数之和等于该小时 `minutes`

原因：

- 跨小时切分会产生非整数分钟
- 如果每个分类独立 round，累加结果可能与总柱相差 `1m`
- Tooltip 和视觉高度应与总活动语义一致

### 8.9 两个 read model 接入

在 `DashboardReadModel` 与 `HistoryReadModel` 中均新增：

```ts
hourlyCategoryActivity: HourlyCategoryActivity;
```

在两个 builder 中：

- [x] 保留现有 `hourlyActivity`
- [x] 新增 `hourlyCategoryActivity`
- [x] 使用 shared builder
- [x] 使用同一个命名常量限制 visible category 数量
- [x] 不复制聚合逻辑

推荐 visible limit 常量 owner：

- `src/shared/lib/hourlyActivityCompiler.ts`

例如：

```ts
export const HOURLY_CATEGORY_VISIBLE_LIMIT = 5;
```

---

## 9. 分步执行清单

### 阶段 0：执行前复核

- [x] 重新阅读 `AGENTS.md`
- [x] 重新阅读 `docs/quiet-pro-component-guidelines.md`
- [x] 重新阅读 `docs/architecture.md`
- [x] 重新阅读 `docs/issue-fix-boundary-guardrails.md`
- [x] 运行 `git status --short`
- [x] 确认工作区是否存在与本任务无关的用户改动
- [x] 对照第 6 节确认产品决策
- [x] 第 6 节关键决策均已确认，无需停止实现

完成标准：

- 两个页面的一致性语义已经明确
- shared owner 已经确认
- 没有需要进入平台层或持久化层的隐性要求

### 阶段 1：搜索调用方并建立 shared owner

目标文件：

- `src/shared/lib/hourlyActivityCompiler.ts`
- `src/features/dashboard/services/dashboardFormatting.ts`

步骤：

- [x] 运行 `rg -n "buildHourlyActivity" src tests scripts`
- [x] 记录现有调用方
- [x] 新增 `src/shared/lib/hourlyActivityCompiler.ts`
- [x] 将 `HourlyActivityPoint` 移入新 owner
- [x] 将 `buildHourlyActivity(...)` 移入新 owner
- [x] 从 `dashboardFormatting.ts` 移除旧实现
- [x] 将调用方导入改为 shared owner
- [x] 不保留无必要的 forwarding export

完成标准：

- `buildHourlyActivity(...)` 只有一个真实 owner
- Dashboard 和 History 不再通过 Dashboard 私有格式化模块共用小时能力

### 阶段 2：提取小时切分 helper

目标文件：

- `src/shared/lib/hourlyActivityCompiler.ts`

步骤：

- [x] 从现有 `buildHourlyActivity(...)` 提取文件私有小时切分 helper
- [x] 保持跨小时切分行为不变
- [x] 保持 `buildHourlyActivity(...)` 输入输出不变
- [x] 确认午夜附近的小时推进仍然正确
- [x] 确认 session `endTime` 缺失时仍沿用当前 fallback 行为

完成标准：

- 原有单色小时柱行为不变
- helper 可供分类 builder 复用

### 阶段 3：新增分类小时 builder

目标文件：

- `src/shared/lib/hourlyActivityCompiler.ts`

步骤：

- [x] 新增 `HourlyCategorySeries`
- [x] 新增 `HourlyCategoryActivityPoint`
- [x] 新增 `HourlyCategoryActivity`
- [x] 新增 `BuildHourlyCategoryActivityOptions`
- [x] 新增 `HOURLY_CATEGORY_VISIBLE_LIMIT`
- [x] 新增 `buildHourlyCategoryActivity(...)`
- [x] 使用局部 `Map` 缓存分类解析结果
- [x] 聚合当天分类总分钟数
- [x] 聚合每小时分类分钟数
- [x] 应用稳定排序
- [x] 应用 visible limit
- [x] 合并 synthetic remainder
- [x] 应用统一舍入与逐小时校正
- [x] 保证 empty sessions 输出 24 个空小时点和空 series

完成标准：

- builder 可独立生成两处图表所需完整数据
- 每小时堆叠总和与 `minutes` 一致
- 真实 `other` 与 synthetic remainder 不混淆

### 阶段 4：接入两个 read model

目标文件：

- `src/features/dashboard/services/dashboardReadModel.ts`
- `src/features/history/services/historyReadModel.ts`

步骤：

- [x] Dashboard read model 从 shared owner 导入总活动与分类 builder
- [x] History read model 从 shared owner 导入总活动与分类 builder
- [x] 两个 read model 均新增 `hourlyCategoryActivity`
- [x] 两个 read model 均保留 `hourlyActivity`
- [x] 两个 read model 均使用 `HOURLY_CATEGORY_VISIBLE_LIMIT`
- [x] 不复制分类聚合逻辑
- [x] 不改变其他读模型字段

完成标准：

- Dashboard 与 History 同时拥有单色和分类小时数据
- 两处共用同一个聚合实现

### 阶段 5：补齐中英文文案

目标文件：

- `src/shared/copy/uiText.ts`

推荐新增：

```ts
dashboard: {
  showHourlyActivityByCategory: "...",
  showTotalHourlyActivity: "...",
  remainingCategories: "...",
  hourlyTotal: "...",
}
```

中文建议：

```text
按分类显示
显示总活动
其他分类
总活动
```

英文建议：

```text
Show by category
Show total activity
Other categories
Total activity
```

步骤：

- [x] 在 `ZH_CN_UI_TEXT.dashboard` 中补齐文案
- [x] 在 `EN_US_UI_TEXT.dashboard` 中补齐对应文案
- [x] 两个页面复用同一组文案
- [x] 保持中英文 key 结构一致
- [x] 不在组件中硬编码用户可见字符串

完成标准：

- 文案可随语言切换
- `uiSmoke` 的 copy key 对称测试继续通过

### 阶段 6：补齐 QuietIconAction pressed 状态

目标文件：

- `src/shared/components/QuietIconAction.tsx`
- `src/styles/app-shell.css`

步骤：

- [x] 为 `QuietIconAction` 增加可选 `pressed?: boolean`
- [x] pressed 传入时增加 `aria-pressed={pressed}`
- [x] pressed 为 `true` 时增加稳定 class，例如 `qp-icon-action-pressed`
- [x] 使用现有 token 定义 pressed 状态
- [x] pressed 状态保持克制，不增加发光、重阴影或新硬编码颜色
- [x] 检查 hover、active、focus-visible、disabled 与 pressed 组合
- [x] 如现有 focus-visible 不足，补充通用图标按钮 focus-visible 样式
- [x] 不改变现有 QuietIconAction 调用方的默认样式

推荐 pressed 样式语义：

- border：基于 `--qp-accent-default` 与 `--qp-border-subtle` 混合
- background：`--qp-accent-muted`
- color：`--qp-accent-default`

完成标准：

- 新 pressed 能力可同时服务两个页面
- 旧调用方不传 pressed 时行为不变

### 阶段 7：接入 Dashboard 图标切换

目标文件：

- `src/features/dashboard/components/Dashboard.tsx`
- 如需要：`src/styles/features/dashboard.css`

步骤：

- [x] 从 `lucide-react` 导入 `Layers3`
- [x] 导入 `QuietIconAction`
- [x] 新增组件本地模式类型，例如 `"total" | "category"`
- [x] 默认 state 使用 `"total"`
- [x] 将“今日活动”标题行改为左右布局
- [x] 在标题右侧放置单个 `Layers3` 按钮
- [x] `pressed={mode === "category"}`
- [x] tooltip 根据当前模式切换
- [x] 点击后在 `"total"` 与 `"category"` 之间切换
- [x] 按钮增加稳定定位 class，例如 `dashboard-pulse-mode-toggle`
- [x] 不在按钮旁增加常驻说明文字

完成标准：

- 默认视图视觉上接近现状
- 分类切换入口可发现，但不会抢过标题

### 阶段 8：接入 History 图标切换

目标文件：

- `src/features/history/components/History.tsx`
- 如需要：`src/styles/quiet-pro.css`

步骤：

- [x] 从 `lucide-react` 导入 `Layers3`
- [x] 导入 `QuietIconAction`
- [x] 新增组件本地模式类型，例如 `"total" | "category"`
- [x] 默认 state 使用 `"total"`
- [x] 将“当日活动”标题行改为左右布局
- [x] 在标题右侧放置单个 `Layers3` 按钮
- [x] `pressed={mode === "category"}`
- [x] tooltip 根据当前模式切换
- [x] 点击后在 `"total"` 与 `"category"` 之间切换
- [x] 按钮增加稳定定位 class，例如 `history-pulse-mode-toggle`
- [x] 不影响 loading 状态、日期切换或其他 History 行为

完成标准：

- History 与 Dashboard 使用同一交互语义
- History 现有信息密度保持稳定

### 阶段 9：渲染两处分类堆叠柱

目标文件：

- `src/features/dashboard/components/Dashboard.tsx`
- `src/features/history/components/History.tsx`

步骤：

- [x] 两处单色模式继续使用现有 `hourlyActivity`
- [x] 两处分类模式切换到 `hourlyCategoryActivity.points`
- [x] 两处分类模式根据 `hourlyCategoryActivity.series` 动态渲染 `<Bar>`
- [x] 每个分类 `<Bar>` 使用相同 `stackId`
- [x] `<Bar>` 使用 series 的 `dataKey`、`name` 和 `color`
- [x] Recharts 声明顺序与目标上下堆叠顺序一致
- [x] 两处现有 `XAxis`、`YAxis`、margin 和卡片尺寸保持不变
- [x] 分类模式不新增 legend
- [x] 空数据模式不报错

圆角处理：

- [x] 已验证普通 stacked bar 没有明显内部圆角断层，无需新增 shape
- [x] 不为了圆角引入通用图表框架

完成标准：

- 每根柱子高度仍表达该小时总活动
- 两个页面的分类色块规则一致
- 分类色块没有明显视觉断层

### 阶段 10：接入分类模式 Tooltip

目标文件：

- `src/features/dashboard/components/Dashboard.tsx`
- `src/features/history/components/History.tsx`
- 仅在确有必要时：`src/shared/components/QuietChartTooltip.tsx`

步骤：

- [x] 两处单色模式保留现有 tooltip formatter
- [x] 两处分类模式使用 series `name` 展示分类名称
- [x] 两处分类模式 label 显示小时与总分钟数
- [x] 两处分类模式隐藏 `0m` 分类
- [x] 两处分类模式 tooltip 顺序与稳定分类排序一致
- [x] synthetic remainder 使用“其他分类”
- [x] 真实 other 使用“未分类”
- [x] 优先通过图表 point 的 `null` 值与 Recharts 默认行为隐藏空项
- [x] 为 `QuietChartTooltip` 增加可选空项过滤能力，并保持默认行为兼容其他图表

完成标准：

- tooltip 不展示无意义的 `0m` 行
- 两处 tooltip 与柱子颜色、顺序和总高度一致

### 阶段 11：读模型自动化测试

优先目标文件：

- `tests/trackingReplay.test.ts`

新增测试：

- [x] shared 分类 builder 能按小时拆分跨小时 session
- [x] 同一小时多个分类能正确聚合
- [x] 24 小时 point 始终完整输出
- [x] 空 sessions 输出空 series
- [x] 分类 series 按全天累计时长稳定排序
- [x] 每小时分类堆叠总和等于该小时 `minutes`
- [x] 超出 visible limit 的分类进入 synthetic remainder
- [x] synthetic remainder 不会与真实 `other` 分类混淆
- [x] 用户分类覆盖能进入分类小时模型
- [x] 用户分类颜色覆盖能进入 series color
- [x] 原有 `buildHourlyActivity(...)` 行为保持不变
- [x] Dashboard read model 同时产出单色和分类小时数据
- [x] History read model 同时产出单色和分类小时数据
- [x] Dashboard 与 History 对同一 session 集合生成一致的分类小时结果

完成标准：

- 核心聚合规则有自动化保护
- 两个页面不会逐渐形成不同规则

### 阶段 12：SSR 与真实浏览器 smoke

目标文件：

- `tests/uiSmoke.test.ts`
- `tests/uiBrowserSmoke.test.ts`

SSR smoke：

- [x] Dashboard SSR 渲染仍通过
- [x] 主导航仍完整
- [x] “专注分布”和“应用排行”仍存在
- [x] Dashboard 分类切换按钮存在可识别 aria label

真实浏览器 smoke：

- [x] 打开 Dashboard 后能找到分类切换按钮
- [x] Dashboard 初始 `aria-pressed` 为 `false`
- [x] 点击 Dashboard 按钮后 `aria-pressed` 变为 `true`
- [x] 再次点击 Dashboard 按钮后恢复为 `false`
- [x] 切换到 History 后能找到分类切换按钮
- [x] History 初始 `aria-pressed` 为 `false`
- [x] 点击 History 按钮后 `aria-pressed` 变为 `true`
- [x] 再次点击 History 按钮后恢复为 `false`
- [x] 两个页面切换过程无 console error
- [x] Dashboard 与 History 视口均无横向溢出
- [x] 如浏览器 stub 数据含多分类，确认分类模式渲染多个 stacked bar series

完成标准：

- 两个页面的切换交互均有最小真实浏览器保护

### 阶段 13：局部验证

开发过程中先运行：

- [x] `npm run test:replay`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run build`

读模型增加额外聚合后运行：

- [x] `npm run perf:dashboard-read-model`
- [x] `npm run perf:history-read-model`

检查性能输出：

- [x] 两个性能脚本通过预算
- [x] 性能预算通过，无需追加缓存优化

完成标准：

- 局部功能、构建和性能均无明显回归

### 阶段 14：完整验证

交付前运行：

- [x] `npm run check`

本轮默认不要求：

- [x] 不要求 `npm run check:full`

如果实现过程意外触及 Rust、IPC、SQLite 或高风险平台边界：

- [x] 未触及 Rust、IPC、SQLite 或高风险平台边界，无需运行 `npm run check:full`

完成标准：

- 仓库默认前端质量门槛通过
- shared owner 收口通过架构检查

### 阶段 15：人工视觉验收

建议使用本地 Vite 页面与 in-app Browser 检查。

桌面尺寸至少覆盖：

- [x] `1280 x 820`
- [x] `1100 x 760`
- [x] `900 x 760`

主题至少覆盖：

- [x] 深色主题
- [x] 浅色主题

语言至少覆盖：

- [x] 中文
- [x] English

Dashboard 验收：

- [x] 默认单色视图与现状接近
- [x] `Layers3` 按钮不会压缩“今日活动”标题
- [x] 分类色块不会让卡片显得嘈杂
- [x] Dashboard 没有横向滚动条

History 验收：

- [x] 默认单色视图与现状接近
- [x] `Layers3` 按钮不会压缩“当日活动”标题
- [x] loading 状态布局稳定
- [x] 日期切换后分类数据跟随所选日期刷新
- [x] History 没有横向滚动条

两处共同验收：

- [x] pressed 状态清晰但克制
- [x] 小时柱内部没有明显圆角断层
- [x] tooltip 不溢出视口
- [x] tooltip 分类名较长时仍可读
- [x] 自定义分类较多时 remainder 正常出现
- [x] “未分类”与“其他分类”不会造成误解
- [x] 鼠标点击按钮可切换
- [x] 键盘 Tab 可聚焦按钮
- [x] Enter / Space 可切换
- [x] tooltip 文案随模式变化
- [x] 离开页面再返回后恢复默认单色模式
- [x] 空数据时切换不会报错

### 阶段 16：收尾

- [x] 运行 `git diff --stat`
- [x] 运行 `git diff --check`
- [x] 确认没有无关文件变化
- [x] 确认两个页面行为一致
- [x] 确认没有新增 hardcoded 视觉值
- [x] 确认没有新增临时 facade 或公共垃圾桶
- [x] 确认没有触及 platform、Rust 或 persistence
- [x] 如本轮进入待发布范围，将用户可感知变化写入 `CHANGELOG.md` 的 `Unreleased`
- [x] 完成验收后将本文移入 `docs/archive/`

---

## 10. 推荐文件修改清单

| 文件 | 预期改动 | 边界说明 |
| --- | --- | --- |
| `src/shared/lib/hourlyActivityCompiler.ts` | 新增 shared owner；承接总活动与分类小时聚合 | 稳定跨 feature 纯读模型能力 |
| `src/features/dashboard/services/dashboardFormatting.ts` | 移除旧 `buildHourlyActivity(...)` 实现 | 退出错误 owner |
| `src/features/dashboard/services/dashboardReadModel.ts` | 从 shared owner 构建两套小时数据 | Dashboard 接入 |
| `src/features/history/services/historyReadModel.ts` | 从 shared owner 构建两套小时数据 | History 接入 |
| `src/features/dashboard/components/Dashboard.tsx` | 新增本地模式状态、`Layers3` 按钮、stacked bars 与 tooltip | Dashboard UI 私有编排 |
| `src/features/history/components/History.tsx` | 新增本地模式状态、`Layers3` 按钮、stacked bars 与 tooltip | History UI 私有编排 |
| `src/shared/copy/uiText.ts` | 增加两处共用的中英文文案 | 用户可见 copy owner |
| `src/shared/components/QuietIconAction.tsx` | 补充 pressed 状态 | 现有共享 control 的稳定补全 |
| `src/styles/app-shell.css` | 补充通用 icon action pressed / focus-visible 样式 | 共享 control 样式 owner |
| `src/styles/features/dashboard.css` | 可选：补 Dashboard 标题行局部样式 | 只放 Dashboard 私有样式 |
| `src/styles/quiet-pro.css` | 可选：对既有 History 小时卡片做最小样式调整 | 不做整段迁移 |
| `tests/trackingReplay.test.ts` | 增加 shared builder 与两处 read model 一致性测试 | 读模型回归保护 |
| `tests/uiSmoke.test.ts` | 增加 SSR 最小存在性检查 | SSR 回归保护 |
| `tests/uiBrowserSmoke.test.ts` | 增加两个页面的真实浏览器切换检查 | 交互回归保护 |

不应修改：

| 区域 | 原因 |
| --- | --- |
| `src/app/*` | 不需要壳层编排 |
| `src/platform/*` | 不需要外部环境能力 |
| `src-tauri/*` | 不需要 Rust runtime 或 IPC |
| migration / persistence | 不持久化模式，不改变数据结构 |

---

## 11. 风险与处理策略

### 11.1 跨 feature owner 继续放错位置

风险：

- History 继续依赖 Dashboard 私有格式化模块
- 后续两个页面规则漂移

处理：

- 将小时聚合移动到 `shared/lib/hourlyActivityCompiler.ts`
- 两个 read model 直接导入 shared owner
- 不长期保留 Dashboard forwarding export

### 11.2 分类色过多

风险：

- 图表变得嘈杂
- tooltip 过长

处理：

- 使用 visible limit
- 超出部分合并为 synthetic remainder
- 不新增常驻 legend

### 11.3 真实 other 与 remainder 混淆

风险：

- 用户无法区分“未分类应用”和“被折叠的低占比分类”

处理：

- 内部 key 分离
- 文案分离
- 颜色分离

### 11.4 舍入后堆叠高度不一致

风险：

- tooltip 分类分钟数之和与总分钟数不同
- 彩色柱和单色柱高度有细微差异

处理：

- 内部先保留浮点值
- 最终逐小时统一舍入
- 对最后一个非零系列做差值校正

### 11.5 Recharts stacked bar 内部圆角断层

风险：

- 每一层都出现顶部圆角
- 色块间出现不自然缝隙

处理：

- 先做视觉验证
- 必要时增加最小可复用 shape
- 不上升为通用图表框架

### 11.6 两个 read model 成本增加

风险：

- 高频刷新新增分类解析与小时聚合

处理：

- 在 builder 内缓存同一应用的分类解析
- 运行 Dashboard 与 History 两个性能脚本
- 不引入全局缓存或跨层状态

### 11.7 shared 控件扩散

风险：

- 为两个按钮把 `QuietIconAction` 写成图表专用组件

处理：

- 只补通用 `pressed` 能力
- 不把 mode、tooltip 文案或页面状态放入 shared

---

## 12. 验收标准

功能验收：

- [x] Dashboard 默认仍显示现有单色小时柱
- [x] History 默认仍显示现有单色小时柱
- [x] 两处标题右侧均存在单个 `Layers3` 图标按钮
- [x] 两处点击按钮后均显示分类堆叠小时柱
- [x] 两处再次点击后均恢复单色柱
- [x] 两处分类视图中每根柱子的总高度与单色模式一致
- [x] 两处分类 tooltip 均能解释该小时的分类构成
- [x] History 日期切换后分类数据跟随刷新
- [x] 两处空数据下切换稳定

设计验收：

- [x] 符合 Quiet Pro：安静、专业、克制
- [x] 没有新增大块装饰或常驻 legend
- [x] 没有 hardcoded 新颜色、圆角、阴影
- [x] 分类色只服务数据理解
- [x] 图标按钮有完整 hover、pressed、focus-visible、disabled 语义
- [x] 两个页面的交互表达一致

架构验收：

- [x] 小时聚合真实 owner 位于 `shared/lib`
- [x] Dashboard 与 History 不再通过 Dashboard 私有模块共享小时聚合
- [x] 页面组件不承接分类聚合逻辑
- [x] shared 控件只做已有 control 的最小补全
- [x] 没有新增 platform、Rust、SQLite 或 IPC 改动
- [x] 没有新增临时 facade、兼容壳或公共垃圾桶

验证验收：

- [x] `npm run test:replay`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run perf:dashboard-read-model`
- [x] `npm run perf:history-read-model`
- [x] `npm run build`
- [x] `npm run check`
- [x] 人工视觉验收完成

---

## 13. 执行终止条件

实现过程中如果出现以下任一情况，应停止按本执行单继续扩展，并重新讨论：

- [ ] 需要新增跨 feature 的通用图表框架
- [ ] 需要新增 settings 持久化
- [ ] 需要修改 SQLite 或 IPC
- [ ] 分类堆叠使任一小时卡片明显过载
- [ ] visible limit 无法在“信息完整”和“Quiet Pro 克制”之间取得平衡
- [ ] Recharts 圆角或 tooltip 限制迫使实现复杂度显著膨胀
- [ ] 性能基准出现无法通过局部缓存解决的明显回退
- [ ] 为保持两处一致，需要把页面私有逻辑错误提升到 shared

---

## 14. 完成定义

只有在以下条件全部满足时，本轮才算完成：

- [x] 第 6 节产品决策已经确认
- [x] 第 9 节全部实施阶段已经完成
- [x] 第 12 节全部验收项已经完成
- [x] `git diff --check` 无异常
- [x] `npm run check` 通过
- [x] 没有发现边界回流
- [x] 文档已从 `docs/working/` 移入 `docs/archive/`

---

## 15. 执行结果

本执行单已完成并归档。

实现结果：

- Dashboard“今日活动”和 History“当日活动”均保留默认单色柱。
- 两处均新增 `Layers3` 图标按钮，可切换分类堆叠柱。
- 两处共享应用壳层中的会话内模式状态，切换页面后保持同步，不写入 settings 或数据库。
- 两处复用 `src/shared/lib/hourlyActivityCompiler.ts` 和 `src/shared/charts/HourlyActivityChart.tsx`。
- 分类模式按卡片宽度使用每小时前 `4 / 6` 类与 synthetic remainder；每根小时柱内部按该小时实际时长独立排序。
- 真实“未分类”和折叠后的“其他”保持分离。
- `QuietIconAction` 已补齐通用 pressed 与 focus-visible 状态。

验证结果：

- `npm run test:replay`
- `npm run test:ui-smoke`
- `npm run test:ui-browser-smoke`
- `npm run perf:dashboard-read-model`
- `npm run perf:history-read-model`
- `npm run build`
- `npm run check`
- `git diff --check`

视觉复核：

- in-app Browser 未能附着本地页面，因此改用现有真实浏览器 smoke 的 headless Edge / Chrome 路径导出临时截图。
- 已人工检查 Dashboard 与 History 的浅色、深色分类态截图。
- 临时截图辅助代码和图片均已移除，不进入最终 diff。

---

## 16. 后续变更：持久化小时图模式

初次实现完成后，产品决策进一步明确：小时图模式不应只在当前应用会话中保留，而应在重新打开应用后继续生效。

本节覆盖本文前面关于“不持久化用户图表模式偏好”的历史假设。旧段落保留用于记录当时的执行边界，不再代表最终行为。

最终行为：

- Dashboard 与 History 继续共享同一个小时图模式。
- 用户切换模式后，界面立即更新。
- 模式通过现有 `AppSettings` 持久化链写入 `settings` 表，key 为 `hourly_activity_chart_mode`。
- 重新打开应用后，模式从 settings 恢复。
- 非法或缺失的历史值回退为默认 `total`。
- 现有 settings 表是 key-value 存储，因此不需要新增 migration。

追加修改范围：

- `src/shared/settings/appSettings.ts`
- `src/shared/settings/releaseDefaultProfile.ts`
- `src/platform/persistence/appSettingsStore.ts`
- `src/app/services/appSettingsRuntimeService.ts`
- `src/app/AppShell.tsx`
- settings、persistence、widget、interaction 与浏览器 smoke 测试夹具

追加验证：

- `npm run test:settings`
- `npm run test:persistence`
- `npm run test:ui-browser-smoke`
- `npm run check`
- `git diff --check`
