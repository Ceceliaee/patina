# 执行单：Quiet Chart Tooltip 共享原语收口
Document Type: One-off Execution Plan

## 1. 背景

当前前端 Quiet Pro 收口已基本完成：

- 对话框已进入共享 Quiet Pro 原语
- 下拉已进入共享 Quiet Pro 原语
- 颜色入口已进入共享 Quiet Pro 原语
- `Settings` 开关与 `App Mapping` 行内控件也已开始收口到共享原语

但图表 tooltip 仍然停留在页面内联样式阶段，主要体现在：

- `Dashboard` 中饼图 tooltip
- `Dashboard` 中小时活跃图 tooltip
- `History` 中趋势图 tooltip

这些 tooltip 目前视觉上接近 Quiet Pro，但它们仍然把圆角、边框、阴影、背景、字号直接写在 TSX 的 `contentStyle` 里，而不是进入共享语义角色。

这意味着：

- 视觉一致性仍靠“复制同一段 style object”维持
- 后续新增图表时容易继续复制页面私有样式
- Quiet Pro 设计系统在“浮层类信息提示”这一类控件上仍缺一个稳定落点

因此这轮作为当前 Quiet Pro 收口清单的最后一项，只做图表 tooltip 的共享化。

## 2. 本轮目标

完成后应达到：

- 前端存在一个共享 Quiet Pro 图表 tooltip 落点
- `Dashboard / History` 的 Recharts tooltip 不再直接写页面私有 `contentStyle`
- tooltip 的圆角、边框、背景、阴影、字号、文本层级改为共享 Quiet Pro 语义样式
- 图表数据逻辑、formatter 行为、鼠标交互行为保持不变

## 3. 范围

重点文件：

- `src/shared/components/QuietChartTooltip.tsx`
  或
- `src/shared/lib/quietChartTooltip.ts`

以及：

- `src/App.css`
- `src/features/dashboard/components/Dashboard.tsx`
- `src/features/history/components/History.tsx`

允许在实现时二选一：

1. 做共享 tooltip 组件
2. 做共享 tooltip 样式/配置 helper

但无论选哪种，都必须避免继续在页面里保留内联 `contentStyle` 主路径。

## 4. 非目标

- 不改图表数据逻辑
- 不改图表 formatter 文案逻辑
- 不改图表布局
- 不改 `App Mapping`
- 不改 `Settings`
- 不改颜色选择器
- 不扩展到 Rust / Tauri
- 不顺手重做整页视觉

## 5. 核心要求

### 5.1 共享化要求

- `Dashboard / History` 的图表 tooltip 必须共用同一 Quiet Pro 落点
- 不允许继续在多个页面分别手写同构 `contentStyle`
- 如果使用 helper，也应让页面只保留最少接线

### 5.2 Quiet Pro 要求

tooltip 应体现：

- 中性
- 克制
- 清楚
- 信息优先

并保持：

- 小尺寸信息浮层语气
- 不做重阴影或装饰化浮层
- 不引入新的突兀颜色体系

### 5.3 行为要求

- 保持现有 tooltip 的出现时机不变
- 保持现有 formatter 行为不变
- `Dashboard` 柱状图的 `cursor` 行为可保留
- 不因共享化而改变图表交互反馈

## 6. 建议实现方向

推荐优先级：

1. 先确定“共享落点”形式
   - 若 Recharts 接线更适合 helper，就优先 helper
   - 若更适合统一内容渲染，就做共享组件
2. 在 `App.css` 中补 `qp-chart-tooltip-*` 相关样式角色
3. 替换 `Dashboard` 两处 tooltip
4. 替换 `History` 一处 tooltip
5. 复核没有残留页面私有 `contentStyle` 主路径

可复用已有 token：

- `--qp-bg-panel`
- `--qp-border-subtle`
- `--qp-text-primary`
- `--qp-text-secondary`
- `--qp-text-tertiary`
- `--qp-shadow-overlay`

## 7. 执行阶段

### 阶段 A：建立共享 Quiet Chart Tooltip 落点

执行项：

- [x] 新增共享 tooltip 组件或 helper
- [x] 在 `App.css` 中新增 `qp-chart-tooltip-*` 样式角色
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 图表 tooltip 已有稳定共享落点
- [x] 页面不再依赖复制粘贴 style object 才能维持 Quiet Pro 观感

### 阶段 B：接入 Dashboard / History

执行项：

- [x] 替换 `Dashboard` 饼图 tooltip
- [x] 替换 `Dashboard` 小时活跃图 tooltip
- [x] 替换 `History` 趋势图 tooltip
- [x] 保持 formatter 与交互行为不变
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] 3 处 tooltip 都已走共享 Quiet Pro 路径
- [x] 用户可见行为与改造前一致
- [x] 不出现布局回归或 tooltip 内容缺失

### 阶段 C：收尾与复核

执行项：

- [x] 复核页面内联 `contentStyle` 主路径已清掉
- [x] 更新本执行单勾选状态
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 8. 完成定义

- [x] Quiet Pro 图表 tooltip 已有共享实现
- [x] `Dashboard / History` 图表 tooltip 已全部接入
- [x] 页面私有 `contentStyle` 不再是主路径
- [x] `npm run build` 通过
- [ ] 如受影响，`npm test` 通过

## 9. 给 GPT-5.3-Codex 的执行要求

- 严格限制在 `Quiet Chart Tooltip` 共享化范围内
- 不要扩展到别的页面控件
- 不要顺手改图表布局或数据逻辑
- 不要顺手改 `App Mapping`、`Settings`、颜色选择器
- 不扩展到 Rust / Tauri
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 10. 任务完成后的处理

本文档属于一次性执行单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在顶层 `docs/`。
