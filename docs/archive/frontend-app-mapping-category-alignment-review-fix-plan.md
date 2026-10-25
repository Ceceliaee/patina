# 修正单：App Mapping 分类选择对齐

Document Type: One-off Review Fix Plan

## 1. 背景

当前 `App Mapping` 页面右侧控制区里，“分类选择”这一列没有稳定对齐。

实际表现是：

- 不同行里的分类选择控件左右起点不稳定
- 视觉上这一列像是在轻微漂移
- 页面整体扫描感被破坏，即使功能本身是正常的

这属于 Quiet Pro 下的布局收口问题，不是功能问题。

## 2. 问题定位

当前主路径在：

- [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx)
- [`src/shared/components/QuietSelect.tsx`](../../src/shared/components/QuietSelect.tsx)

现状里 `AppMapping` 给分类选择传的是类似 `min-w-[132px]` 的下限宽度，而不是稳定列宽。

结果是：

- 分类标签内容长度不同
- `QuietSelect` 外层宽度会跟着内容略有变化
- 整个右侧控制区又是右对齐布局
- 于是“分类选择”这一列的左边界/右边界看起来不稳定

本轮核心不是改 `QuietSelect` 的全局行为，而是让 `AppMapping` 里的这一个布局槽位稳定下来。

## 3. 本轮目标

只处理 `App Mapping` 页面中分类选择这一列的对齐。

完成后应达到：

- 所有应用行里的分类选择控件共用稳定列宽
- 这一列上下对齐，视觉上形成清楚的竖向轨道
- 不影响颜色控件、保存流、排序、弹层逻辑

## 4. 范围

重点文件：

- `src/features/classification/components/AppMapping.tsx`

如确有必要，允许少量调整：

- `src/App.css`
- `src/shared/components/QuietSelect.tsx`

## 5. 非目标

- 不修改颜色选择器逻辑
- 不重做 `App Mapping` 整页布局
- 不修改分类排序规则
- 不扩展 Rust / Tauri / 后端
- 不做全局 `QuietSelect` 视觉重构

## 6. 核心要求

- 分类选择这一列必须使用稳定宽度，不再随内容轻微漂移
- 控件内部文本仍应支持截断/正常显示
- 颜色入口与“默认”按钮继续保持现有相对位置，不顺手改右侧其他交互
- 修复应尽量落在 `AppMapping` 局部布局，而不是影响全局所有 `QuietSelect`

## 7. 建议实现方向

推荐优先级：

1. 在 `AppMapping` 中把分类选择槽位改成固定宽度容器
2. 让 `QuietSelect` 在这个槽位里撑满宽度
3. 如仍有必要，再补极少量局部样式类

不推荐：

- 直接全局改 `QuietSelect` 默认宽度
- 顺手调整颜色入口宽度策略
- 借机重排整行 controls

## 8. 执行阶段

### 阶段 A：稳定分类选择槽位

执行项：

- [ ] 让 `AppMapping` 中分类选择使用固定列宽，而不是 `min-width` 漂移策略
- [ ] 保证 `QuietSelect` 在该槽位中稳定撑满
- [ ] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [ ] 所有应用行中的分类选择控件上下对齐
- [ ] 不再出现这一列左右边界轻微漂移

### 阶段 B：回归与收尾

执行项：

- [ ] 复核颜色入口、默认按钮、保存流未受影响
- [ ] 更新本修正单勾选状态
- [ ] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 9. 完成定义

- [ ] `App Mapping` 中分类选择这一列已稳定对齐
- [ ] 仅局部修复，没有带出颜色选择器或整页布局副作用
- [ ] `npm run build` 通过
- [ ] 如受影响，`npm test` 通过

## 10. 给 GPT-5.3-Codex 的执行要求

- 严格限定在 `App Mapping` 分类选择列对齐修复范围内
- 优先局部修复，不要全局改 `QuietSelect`
- 不扩展颜色选择器、不重做整页布局、不改 Rust / Tauri
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 11. 任务完成后的处理

本文件属于一次性修正单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在顶层 `docs/`。
