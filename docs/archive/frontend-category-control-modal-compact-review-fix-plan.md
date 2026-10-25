# 修正单：分类控制弹层恢复紧凑观感

Document Type: One-off Review Fix Plan

## 1. 背景

上一轮“分类控制弹层全屏布局收口”虽然解决了“太小、太碎”的一部分问题，但方向修过头了。

用户真实想要的是：

- 全屏时不要难看
- 但整体仍然保留之前小窗口里那种紧凑、稳定、安静的弹层观感

而不是：

- 为了适配全屏，把分类控制弹层做成明显更宽、更像网页大面板的布局
- 让卡片网格和卡片内部结构为了“自适应”变得比以前更散、更弱、更不像 Quiet Pro

所以这轮不是继续“优化全屏”，而是把分类控制弹层拉回到更接近原先小窗口效果的 Quiet Pro 紧凑形态。

## 2. 当前问题

当前观感不对，主要来自这几个点：

1. 分类控制弹层使用了 `size="wide"`：
   - [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx)
   - 这让弹层的视觉角色从“紧凑操作弹层”变成了“内容型大面板”

2. `QuietDialog` 新增的宽尺寸角色把这类弹层拉向“大屏专用宽布局”：
   - [`src/shared/components/QuietDialog.tsx`](../../src/shared/components/QuietDialog.tsx)
   - [`src/App.css`](../../src/App.css)

3. 分类卡片改成了 `auto-fit/minmax` 自适应网格：
   - [`src/features/classification/components/CategoryColorControls.tsx`](../../src/features/classification/components/CategoryColorControls.tsx)
   - 这在大屏下不一定更好看，反而破坏了之前更稳定的“固定密度、固定节奏”

4. 卡片内部两段式结构把原本利落的一行信息拆得过散：
   - 信息和操作之间的距离被放大
   - 视觉重心不再像原来的紧凑控制卡片

## 3. 本轮目标

只做一件事：

- 让分类控制弹层在全屏下恢复“接近之前小窗口效果”的紧凑、美观、稳定观感

完成后应满足：

- 全屏时弹层仍是一个中等宽度、中心稳定的 Quiet Pro 操作弹层
- 不再走“宽弹层 + 大内容面板”的方向
- 分类卡片恢复更稳定的节奏，不再因为自适应和拆段而显得发散

## 4. 本轮范围

只允许处理以下文件：

- `src/shared/components/QuietDialog.tsx`
- `src/App.css`
- `src/features/classification/components/AppMapping.tsx`
- `src/features/classification/components/CategoryColorControls.tsx`

重点是“修回设计方向”，不是继续扩新原语。

## 5. 非目标

- 不重做整个 `App Mapping`
- 不修改 `Settings`、`History`、`Dashboard`
- 不重做 QuietDialog 所有尺寸体系
- 不继续探索“更适合大屏的分类控制布局”
- 不扩展 Rust / Tauri

## 6. 修正原则

- 以“之前小窗口效果”为视觉锚点，而不是以“全屏下尽量铺开”为目标
- 优先恢复稳定的固定节奏，而不是继续做响应式炫技
- Quiet Pro 需要的是克制、统一、可靠，不是为了适配大屏而把弹层做成内容页

## 7. 执行阶段

### 阶段 A：撤回分类控制弹层的过宽策略

目标：

- 分类控制弹层回到中等宽度、稳定居中的操作弹层观感

执行项：

- [ ] 取消 `AppMapping` 中分类控制弹层对 `size="wide"` 的依赖，或改为更接近原紧凑效果的接入方式
- [ ] 如 `QuietDialog` 的宽尺寸角色仅服务这次过度修正，应避免让分类控制继续使用它
- [ ] 保留必要的最大高度与内部滚动，不让长内容撑坏弹层
- [ ] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [ ] 全屏下分类控制弹层不再呈现“大面板”感
- [ ] 整体宽度接近之前小窗口时的舒适观感

### 阶段 B：恢复分类卡片的稳定密度

目标：

- 分类卡片恢复更像“小型控制项”的视觉节奏，而不是稀疏内容卡片

执行项：

- [ ] 去掉当前 `auto-fit/minmax` 式自适应网格，改回更稳定的列布局
- [ ] 优先恢复接近之前小窗口效果的两列节奏；窄窗口可退回单列，但不要在大屏无限漂移
- [ ] 卡片内部结构恢复更紧凑的信息 + 控制排布，不要为了“分段”而显得更散
- [ ] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [ ] 分类卡片在大屏下仍保持紧凑、清晰、顺手
- [ ] 卡片之间不再显得过疏
- [ ] 卡片内部不再显得像拆开的网页区块

### 阶段 C：回归确认

目标：

- 确认这轮是“恢复原本正确方向”，不是新一轮风格漂移

执行项：

- [ ] 复查分类控制弹层整体观感更接近之前小窗口效果
- [ ] 复查普通 confirm / prompt 没有被误伤
- [ ] 更新修正单勾选状态
- [ ] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 8. 完成定义

满足以下条件，才算本轮完成：

- [ ] 分类控制弹层全屏时恢复紧凑、稳定、顺眼的 Quiet Pro 观感
- [ ] 视觉效果更接近之前小窗口下用户认可的版本
- [ ] 没有继续沿着“大屏宽弹层”方向发散
- [ ] `npm run build` 通过
- [ ] 如本轮影响现有测试链路，相关 `npm test` 通过

## 9. 给 GPT-5.3-Codex 的执行要求

- 这是一份 review-fix，只修“分类控制弹层过度大屏化”的问题
- 以“恢复之前小窗口效果”为视觉目标，不要继续做全屏增强
- 不重做整页 `App Mapping`
- 不扩展 Rust / Tauri
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 10. 任务完成后的处理

本文档属于一次性修正单。  
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
