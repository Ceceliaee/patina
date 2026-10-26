# 修正单：App Mapping 颜色值槽位对齐

Document Type: One-off Review Fix Plan

## 1. 背景

用户已确认，当前 `App Mapping` 里“看起来像分类没对齐”的真正原因不是分类下拉本身，而是颜色入口外侧显示的 `#HEX` 值。

当前现象是：

- 分类下拉列本身宽度基本稳定
- 但右侧颜色入口里的 `#HEX` 值槽位会因字符宽度差异产生轻微漂移
- 最终让整组控件在视觉上看起来像“分类没有对齐”

因此本轮不再处理分类列宽，而是改正为：

- 稳定颜色值显示槽位
- 让右侧控件组在各行之间保持一致的对齐感

## 2. 问题定位

当前主路径在：

- [`src/shared/components/QuietColorField.tsx`](../../src/shared/components/QuietColorField.tsx)
- [`src/App.css`](../../src/App.css)

关键点：

- 外侧 trigger 里当时直接渲染 `#HEX` 值：`src/shared/components/QuietColorField.tsx:249`（归档时行号）
- 对应样式 `.qp-color-trigger-value` 目前是内容自适应，只有 `min-width: 0`，没有稳定槽位宽度：`src/App.css:437`（归档时行号）

结果就是：

- 即使字符数相同，比例字体下不同数字/字母的实际占宽仍会不同
- 颜色入口整体宽度会轻微变化
- 连带让旁边的分类下拉看起来像没对齐

## 3. 本轮目标

只处理颜色值显示槽位的稳定化。

完成后应达到：

- 外侧 `#HEX` 值使用稳定槽位宽度
- 不同颜色值不会再引起整组控件轻微漂移
- 视觉上分类下拉与颜色入口的组合列上下对齐

## 4. 范围

重点文件：

- `src/shared/components/QuietColorField.tsx`
- `src/App.css`

如确有必要，允许少量触及：

- `src/features/classification/components/AppMapping.tsx`
- `src/features/classification/components/CategoryColorControls.tsx`

## 5. 非目标

- 不修改分类下拉逻辑
- 不改颜色选择器弹层功能
- 不改保存流
- 不重做整页布局
- 不扩展 Rust / Tauri / 后端

## 6. 核心要求

- 优先修 `#HEX` 值槽位，而不是误改分类宽度
- 外侧值显示应保持 Quiet Pro 风格，不变成突兀的代码块
- 可以使用：
  - 固定宽度槽位
  - 等宽数字/字符策略
  - `tabular-nums` 或近似等宽方案
  - `ch` 宽度约束

但要注意：

- 视觉上仍应像 Quiet Pro 的轻量值标签
- 不要把它做成很重的输入框感

## 7. 建议实现方向

推荐优先级：

1. 为 `.qp-color-trigger-value` 设定稳定宽度槽位
2. 让显示文本在槽位内以更稳定的字宽呈现
3. 如有必要，再对整个 trigger 做极少量宽度约束微调

不推荐：

- 去全局修改分类下拉宽度
- 为了对齐去压缩颜色入口整体布局
- 顺手改颜色弹层或分类列的其他行为

## 8. 执行阶段

### 阶段 A：稳定颜色值槽位

执行项：

- [x] 为外侧 `#HEX` 值建立稳定宽度槽位
- [x] 让不同 `#HEX` 文本在视觉上不再造成整组控件漂移
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 多行应用的右侧控件组在视觉上稳定对齐
- [x] 不再误以为分类下拉列本身没对齐

### 阶段 B：回归与收尾

执行项：

- [x] 复核颜色 trigger 外观没有被改坏
- [x] 复核颜色弹层与保存流程未受影响
- [x] 更新本修正单勾选状态
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 9. 完成定义

- [x] `#HEX` 外侧显示槽位已稳定
- [x] 右侧控件组不再因不同颜色值而轻微漂移
- [x] 分类下拉无需改动也已恢复视觉对齐感
- [x] `npm run build` 通过
- [ ] 如受影响，`npm test` 通过

## 10. 给 GPT-5.3-Codex 的执行要求

- 严格限定在颜色值槽位稳定化范围内
- 不要继续误修分类列宽
- 不扩展颜色弹层、不重做整页布局、不改 Rust / Tauri
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 11. 任务完成后的处理

本文件属于一次性修正单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在顶层 `docs/`。
