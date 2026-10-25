# 修正单：颜色格式切换实验回退

Document Type: One-off Review Fix Plan

## 1. 背景

上一轮“颜色编辑入口与颜色格式切换 affordance”改造虽然完成了技术目标：

- 抽出了 `QuietColorField`
- 增加了 `HEX / RGB / HSL` 轻量循环切换
- 把原生 `<input type="color">` 收成了内部实现细节

但实际视觉与交互效果**不符合当前用户预期**。

用户明确反馈：

- “我要的不是这个效果”
- 希望**改回去**

因此本轮不是继续增强这套新方案，而是：

- 回退上一轮颜色 affordance 实验
- 恢复到更接近上一版、已被接受的颜色入口观感
- 不在本轮继续尝试新的颜色交互方案

## 2. 本轮目标

只做一件事：

- 把颜色控件相关 UI 回退到上一版更接近原始页面观感的状态

具体来说：

- `App Mapping` 的颜色入口回到上一版较简单的行内结构
- `分类控制` 弹层中的颜色入口也回到上一版较简单的结构
- 移除这轮新引入、但用户不接受的颜色格式切换 affordance

## 3. 范围

重点文件：

- `src/features/classification/components/AppMapping.tsx`
- `src/features/classification/components/CategoryColorControls.tsx`
- `src/shared/components/QuietColorField.tsx`
- `src/shared/lib/colorFormatting.ts`
- `src/App.css`

## 4. 非目标

- 不继续优化 `HEX / RGB / HSL` 切换体验
- 不尝试第二版新的颜色控件设计
- 不重做整页布局
- 不扩展 Rust / Tauri / 数据层
- 不顺手修改其他 Quiet Pro 组件

## 5. 核心要求

- 这是一次**回退修正**，不是继续迭代上一轮实验方案
- 目标是恢复到“更像之前”的效果，而不是做一个新的折中版
- 如果 `QuietColorField` / `colorFormatting.ts` 在回退后已无实际使用，应一并删除
- 不要保留半残留状态：
  - 不要页面回退了，但共享原语和样式还挂在代码里
  - 不要顶层 `docs/` 留下本轮完成后的活动修正单

## 6. 执行阶段

### 阶段 A：回退页面接入

执行项：

- [ ] `App Mapping` 回退到上一版颜色入口结构
- [ ] `CategoryColorControls` 回退到上一版颜色入口结构
- [ ] 移除页面中对新颜色格式切换 affordance 的接入
- [ ] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [ ] 页面颜色入口观感回到上一版方向
- [ ] 不再出现本轮新引入的格式切换 UI

### 阶段 B：清理共享残留

执行项：

- [ ] 若 `QuietColorField.tsx` 不再使用，则删除
- [ ] 若 `colorFormatting.ts` 不再使用，则删除
- [ ] 清理 `App.css` 中仅为这轮实验新增的颜色控件样式
- [ ] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [ ] 仓库中不残留无主共享颜色实验代码
- [ ] 颜色入口恢复后仍能正常修改颜色、恢复默认、参与保存

### 阶段 C：文档与收尾

执行项：

- [ ] 更新本修正单勾选状态
- [ ] 收尾运行 `npm run build`

如本轮改动影响既有测试链路，再补跑：

- [ ] `npm test`

## 7. 完成定义

- [ ] 颜色入口已回退到上一版更接近原始观感的状态
- [ ] `QuietColorField` / `colorFormatting` 等实验性残留已清理或确认仍有必要
- [ ] 颜色修改、恢复默认、保存流程仍正常
- [ ] `npm run build` 通过
- [ ] 如受影响，`npm test` 通过

## 8. 给 GPT-5.3-Codex 的执行要求

- 严格按“回退上一轮颜色 affordance 实验”处理
- 不要继续设计第二版新颜色控件
- 不要保留半回退状态
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 9. 任务完成后的处理

本文件属于一次性修正单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在顶层 `docs/`。
