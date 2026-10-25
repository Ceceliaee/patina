# 执行单：App Mapping 行内控件 Quiet Pro 原语收口
Document Type: One-off Execution Plan

## 1. 背景

当前 `App Mapping` 页面已经完成了较多 Quiet Pro 收口：

- 对话框已使用共享 Quiet 对话框
- 分类下拉已使用 `QuietSelect`
- 颜色入口已使用 `QuietColorField`

但页面里仍有一批“视觉上接近 Quiet Pro、实现上仍是页面私有拼装”的行内控件，主要包括两类：

1. 顶部筛选 chips
   - `全部`
   - `未分类`
   - `已分类`
2. 每行记录右侧的轻量行内操作
   - `记录标题 / 不记标题`
   - `统计中 / 不统计`
   - `恢复默认`
   - `删除应用记录`

这些控件当前能正常工作，但仍存在两个长期问题：

- 它们还不是共享原语，后续别的页面如果需要类似交互，很容易继续复制页面私有实现
- 它们的状态和视觉规则还散落在 `AppMapping.tsx` 页面里，不符合 Quiet Pro “先扩设计系统，再接页面”的方向

因此这轮不做整页改版，只做一个很小的前端设计系统收口：

- 新增共享 `QuietSegmentedFilter`
- 新增共享 `QuietInlineAction`
- 只接入 `App Mapping`
- 保持当前页面行为不变

## 2. 本轮目标

完成后应达到：

- 前端存在可复用的 Quiet Pro 分段筛选原语 `QuietSegmentedFilter`
- 前端存在可复用的 Quiet Pro 行内轻操作原语 `QuietInlineAction`
- `App Mapping` 顶部筛选 chips 与每行右侧轻操作都接到共享原语
- 页面行为、保存流、删除流、过滤逻辑保持不变
- 视觉继续保持当前 Quiet Pro 方向，不做额外“设计感增强”

## 3. 范围

重点文件：

- `src/shared/components/QuietSegmentedFilter.tsx`
- `src/shared/components/QuietInlineAction.tsx`
- `src/App.css`
- `src/features/classification/components/AppMapping.tsx`

如确有必要，可少量触及：

- `src/lib/copy.ts`

## 4. 非目标

- 不改 `Settings` 页开关或其他控件
- 不改 `History` / `Dashboard`
- 不处理图表 tooltip
- 不改颜色选择器
- 不改保存流、切页未保存提示、排序逻辑
- 不扩展到 Rust / Tauri
- 不重做 `App Mapping` 整页布局

## 5. 核心要求

### 5.1 QuietSegmentedFilter

`QuietSegmentedFilter` 至少应支持：

- `default`
- `hover`
- `selected`
- `focus`
- `disabled`

并且：

- 视觉上应保持 Quiet Pro 的轻量过滤 chips 语气
- 不能做成很像营销页 tab 或高对比主按钮
- 计数 `({count})` 仍应保留在标签里

### 5.2 QuietInlineAction

`QuietInlineAction` 至少应支持：

- `default`
- `hover`
- `focus`
- `disabled`

并允许表达轻量语义变体，例如：

- `neutral`
- `accent`
- `warning`
- `danger`

但要注意：

- 它仍然是“行内轻操作”，不是主要 CTA
- 危险态可以有语义色，但 surrounding chrome 必须继续克制
- 图标只是辅助，不应成为主视觉

### 5.3 结构要求

- 先抽共享原语，再替换 `AppMapping.tsx` 页面现有私有拼装
- 不允许继续在 `AppMapping.tsx` 内保留另一套并行的私有样式规则
- 不要新增 feature 私有的 `filter helper` 或 `action helper`

## 6. 建议实现方向

推荐顺序：

1. 在 `src/shared/components/` 新增 `QuietSegmentedFilter.tsx`
2. 在 `src/shared/components/` 新增 `QuietInlineAction.tsx`
3. 在 `src/App.css` 增加对应 `qp-segmented-*` / `qp-inline-action-*` 样式角色
4. 用 `QuietSegmentedFilter` 替换 `App Mapping` 顶部筛选 chips
5. 用 `QuietInlineAction` 替换 `App Mapping` 每行右侧轻操作
6. 复核布局与行为未被改坏

实现时优先复用现有 token：

- `--qp-accent-default`
- `--qp-accent-muted`
- `--qp-warning`
- `--qp-danger`
- `--qp-border-subtle`
- `--qp-border-strong`
- `--qp-bg-panel`
- `--qp-bg-elevated`
- `--qp-text-primary`
- `--qp-text-secondary`
- `--qp-text-tertiary`
- `--qp-text-disabled`

## 7. 执行阶段

### 阶段 A：建立共享原语

执行项：

- [x] 新增 `QuietSegmentedFilter.tsx`
- [x] 新增 `QuietInlineAction.tsx`
- [x] 在 `App.css` 增加 `qp-segmented-*` / `qp-inline-action-*` 样式
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 两个控件都已形成可复用共享原语
- [x] 状态定义完整，不再依赖页面私有 class 拼装

### 阶段 B：接入 App Mapping

执行项：

- [x] 用 `QuietSegmentedFilter` 替换顶部筛选 chips
- [x] 用 `QuietInlineAction` 替换每行右侧轻操作
- [x] 保持过滤逻辑不变
- [x] 保持标题记录、统计开关、恢复默认、删除记录行为不变
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] 用户可见行为与改造前一致
- [x] 行内操作层级更统一，但没有喧宾夺主
- [x] 页面布局没有因原语替换而明显错位

### 阶段 C：收尾与复核

执行项：

- [x] 复核 `App Mapping.tsx` 不再残留旧的页面私有 chips/action 主路径
- [x] 更新本执行单勾选状态
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 8. 完成定义

- [x] `QuietSegmentedFilter` 已成为共享原语
- [x] `QuietInlineAction` 已成为共享原语
- [x] `App Mapping` 顶部筛选已接入共享原语
- [x] `App Mapping` 行内轻操作已接入共享原语
- [x] 页面私有拼装不再是主路径
- [x] `npm run build` 通过
- [ ] 如受影响，`npm test` 通过

## 9. 给 GPT-5.3-Codex 的执行要求

- 严格限制在 `App Mapping` 行内控件 Quiet Pro 原语收口范围内
- 不要扩展到 `Settings`
- 不要顺手继续改图表 tooltip
- 不要顺手继续改颜色选择器
- 不要扩展新的 Quiet Pro 大改版
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 10. 任务完成后的处理

本文档属于一次性执行单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在顶层 `docs/`。
