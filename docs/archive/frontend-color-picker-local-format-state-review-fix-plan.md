# 修正单：颜色选择器格式状态局部化

Document Type: One-off Review Fix Plan

## 1. 背景

当前颜色选择器已经基本通过验收，但还剩一个低风险残余：

- `HEX / RGB / HSL` 切换状态仍挂在页面级
- 一个颜色弹层里切到 `RGB / HSL` 后，别的颜色弹层下次打开也会继承这个模式

这不影响主流程，但和“切换只作用于当前弹层内部”的预期不完全一致。

## 2. 本轮目标

只处理一个点：

- 将格式切换状态从页面级共享，收回到每个 `QuietColorField` 自己内部

完成后应达到：

- 当前颜色弹层里切到 `RGB / HSL / HEX`，只影响这个弹层
- 其他颜色弹层打开时仍从自己的默认内部状态开始
- 外侧 trigger 仍保持固定 `#HEX` 展示，不受影响

## 3. 范围

重点文件：

- `src/shared/components/QuietColorField.tsx`
- `src/features/classification/components/AppMapping.tsx`
- `src/features/classification/components/CategoryColorControls.tsx`

如确有必要，允许少量补充：

- `src/shared/lib/colorFormatting.ts`

## 4. 非目标

- 不改颜色选择器视觉样式
- 不改保存流
- 不改 Rust / Tauri
- 不重做颜色弹层能力

## 5. 核心要求

- `format` 状态应由单个 `QuietColorField` 自己维护
- 页面层不再统一持有 `colorFormat`
- 外侧 trigger 继续固定显示 `#HEX`
- 内部 `HEX / RGB / HSL` 切换逻辑保持不变，只改作用域

## 6. 执行阶段

### 阶段 A：下沉格式状态

执行项：

- [ ] 将 `QuietColorField` 改为内部维护格式状态
- [ ] 从 `AppMapping` 移除页面级 `colorFormat`
- [ ] 从 `CategoryColorControls` 移除对应 prop 传递
- [ ] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [ ] 一个颜色弹层内切换格式，不再影响其他颜色弹层

### 阶段 B：收尾

执行项：

- [ ] 复核点击前 trigger、点击后切换、保存/取消流程未受影响
- [ ] 更新本修正单勾选状态
- [ ] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 7. 完成定义

- [ ] `HEX / RGB / HSL` 切换状态已局部化到单个颜色弹层
- [ ] 外侧 trigger 仍固定显示 `#HEX`
- [ ] 现有颜色修改流程不受影响
- [ ] `npm run build` 通过
- [ ] 如受影响，`npm test` 通过

## 8. 给 GPT-5.3-Codex 的执行要求

- 严格限定在颜色格式状态作用域修复范围内
- 不扩展新的 UI 改造
- 不改保存流
- 不改 Rust / Tauri
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 9. 任务完成后的处理

本文件属于一次性修正单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在顶层 `docs/`。
