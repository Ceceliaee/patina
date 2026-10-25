# 执行单：Quiet Pro 自有颜色选择界面收口

Document Type: One-off Execution Plan

## 1. 目标

本轮只处理一个明确问题：

- 当前点击颜色后出现的是系统/浏览器原生颜色选择界面
- 这块弹出的颜色选择 UI 不属于项目自己的 `Quiet Pro` 体系
- 它的视觉、排版、控件风格都和当前产品界面不一致

本轮目标是：

- 让“点击选颜色后出现的界面”回到项目自有的 Quiet Pro 控件体系
- 不再依赖原生颜色选择弹窗作为最终用户看到的主界面
- 同时保留 `HEX / RGB / HSL` 切换能力，但保持克制，不要做得太吵

## 2. 问题定位

当前问题的根因不是入口按钮样式，而是：

1. [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx)
   - 点击颜色块后会走原生 `<input type="color">`
   - 用户真正看到的是浏览器/系统自带颜色面板

2. [`src/features/classification/components/CategoryColorControls.tsx`](../../src/features/classification/components/CategoryColorControls.tsx)
   - 分类控制里同样复用了原生 `<input type="color">`
   - 所以同样会出现原生本地弹层

而原生颜色弹层：

- 无法按 Quiet Pro 风格进行有效定制
- 无法真正与我们当前产品视觉统一
- 即使补充入口 affordance，也解决不了“点击后还是系统界面”的核心问题

因此这轮不能继续停留在入口样式层，而必须把“点击后的颜色选择界面”收回为项目自己的 UI。

## 3. 本轮范围

只处理前端颜色选择弹层/面板本身。

重点文件：

- `src/features/classification/components/AppMapping.tsx`
- `src/features/classification/components/CategoryColorControls.tsx`

允许新增：

- `src/shared/components/*` 中的共享 Quiet Pro 颜色选择原语
- `src/shared/lib/*` 中的颜色转换 helper
- `src/App.css`
- `src/lib/copy.ts`

## 4. 非目标

- 不引入第三方颜色选择器库
- 不扩展 Rust / Tauri / 数据层
- 不重做整页布局
- 不做大型复杂“设计软件式”颜色工作台
- 不把颜色选择器做成高噪音、高装饰的大弹窗
- 不做全局主题系统或全局颜色偏好持久化

## 5. 核心边界要求

- 点击颜色后出现的 UI，必须是项目自有 Quiet Pro 界面
- 原生 `<input type="color">` 可以作为内部实现细节保留，也可以完全不用
- 但用户**最终看到和交互的主界面**不能再是原生系统/浏览器弹层

- 新颜色选择界面应满足：
  - Quiet Pro：克制、专业、清楚
  - 比原生面板更统一，但不要过度设计
  - 在 `App Mapping` 和 `分类控制` 中一致

- `HEX / RGB / HSL` 要求：
  - 可以切换
  - 比之前更可发现
  - 但权重不能超过颜色本身和业务操作

## 6. 推荐实现方向

推荐方向是做一个共享的 Quiet Pro 颜色弹层原语，例如：

- `QuietColorPopover`
- `QuietColorPicker`
- `colorFormatting.ts`

推荐交互结构：

- 颜色预览 swatch
- 一个小型颜色选择区域
- 当前格式值输入区
- 轻量 `HEX / RGB / HSL` 切换

推荐视觉形态：

- 小型 popover / anchored panel
- 不是系统弹窗
- 不是大号居中 modal

不推荐：

- 继续直接弹原生颜色面板
- 做成类似 Photoshop/Figma 的复杂面板
- 做很显眼的大 tabs / 大按钮

## 7. 执行阶段

### 阶段 A：建立共享 Quiet Pro 颜色弹层原语

目标：

- 形成项目自己的颜色选择界面

执行项：

- [x] 建立共享颜色格式化 helper
- [x] 建立共享 Quiet Pro 颜色弹层/选择原语
- [x] 支持基础状态：`default / hover / focus / disabled`
- [x] 支持 `HEX / RGB / HSL` 切换
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 点击颜色后出现的是项目自有界面，不再是原生本地弹层
- [x] 颜色选择弹层视觉上符合 Quiet Pro

### 阶段 B：接入 App Mapping 与分类控制

目标：

- 两个颜色入口统一到同一交互模型

执行项：

- [x] `App Mapping` 接入新颜色弹层
- [x] `CategoryColorControls` 接入同一原语
- [x] 如有新文案，统一收口到 `copy.ts`
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] 两处点击颜色后的 UI 一致
- [x] 两处都不再出现原生颜色选择弹层

### 阶段 C：回归与收尾

执行项：

- [x] 确认颜色修改、恢复默认、保存/取消流程不受影响
- [x] 确认颜色值提交结果和现有数据结构兼容
- [x] 更新本执行单勾选状态
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 8. 完成定义

- [x] 点击颜色后出现的是 Quiet Pro 自有颜色选择界面
- [x] 不再出现原生系统/浏览器颜色弹层
- [x] `HEX / RGB / HSL` 切换可发现但不喧宾夺主
- [x] `App Mapping` 与 `分类控制` 体验一致
- [x] 原有颜色修改、恢复默认、保存流程不受影响
- [x] `npm run build` 通过
- [ ] 如受影响，`npm test` 通过

## 9. 给 GPT-5.3-Codex 的执行要求

- 严格限定在“Quiet Pro 自有颜色选择界面”范围内
- 不要继续依赖原生颜色弹层作为主界面
- 不引入第三方颜色库
- 不扩展到 Rust / Tauri / 后端
- 不做大型复杂颜色工作台
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 10. 任务完成后的处理

本文件属于一次性执行单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在顶层 `docs/`。
