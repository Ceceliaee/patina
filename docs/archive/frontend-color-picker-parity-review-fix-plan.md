# 修正单：Quiet Pro 颜色选择器功能对齐与样式回调

Document Type: One-off Review Fix Plan

## 1. 背景

上一轮已经把“点击颜色后出现原生系统/浏览器颜色弹层”改成了项目自有的 Quiet Pro 颜色弹层。

但当前结果与真实需求仍然不符，用户已明确补充了 5 个要求：

1. 点击前的样式要恢复到之前更顺眼的版本
2. 点击后的功能要与原生颜色选择器尽量一致，改的是 UI，不是削功能
3. 当前实现把取色器能力弄没了
4. 当前弹层会被页面/窗口内容遮挡
5. 原始真正要修的点，是“点击后 RGB / HSL / HEX 切换不明显”，而不是把这一整套功能改弱

因此本轮不是继续沿着“简化版自定义颜色弹层”迭代，而是：

- 保留 Quiet Pro 自有 UI 方向
- 同时把功能能力拉回到接近原生颜色选择器的水平
- 并把点击前的入口观感恢复到之前已被接受的版本

## 2. 本轮目标

只处理颜色选择器这一个交互链路，目标拆成三部分：

### 2.1 点击前

- 颜色入口外观回到之前更自然、更顺眼的样式
- 不保留当前这版过于“压缩”和“工具感过强”的壳层

### 2.2 点击后

- 颜色选择界面仍然是项目自有 Quiet Pro UI
- 但功能能力要尽量与原生颜色选择器对齐

至少应覆盖：

- 颜色主选区
- hue 调整
- 取色器
- `HEX / RGB / HSL` 切换
- 对应格式下的值编辑

### 2.3 弹层层级与可见性

- 弹层不能再被列表滚动区、父面板或窗口内容遮挡/裁切
- 需要稳定显示在正确层级之上

## 3. 问题定位

当前版本的偏差主要有三类：

### 3.1 点击前样式偏差

[`src/shared/components/QuietColorField.tsx`](../../src/shared/components/QuietColorField.tsx)
[`src/App.css`](../../src/App.css)

- 当前收口后的 trigger 外观与用户前面认可的版本不同
- 颜色入口看起来更像实验性工具控件，而不是之前更自然的行内 Quiet Pro control

### 3.2 点击后功能缺失

[`src/shared/components/QuietColorField.tsx`](../../src/shared/components/QuietColorField.tsx)
[`src/shared/lib/colorFormatting.ts`](../../src/shared/lib/colorFormatting.ts)

- 当前虽然有自有 popover，但功能只覆盖了预设色与 `Hue / Sat / Light` 滑条
- 取色器缺失
- 当前格式值虽可切换，但表现方式还不够接近原生
- 没有真正达到“改 UI，不减功能”

### 3.3 弹层被遮挡

[`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx)
[`src/App.css`](../../src/App.css)

- 当前颜色弹层挂在行内容器内
- 映射列表与分类控制弹层都处在滚动/裁切容器里
- 所以 popover 会出现被父层内容遮挡、裁切、覆盖的问题

## 4. 本轮范围

只处理颜色选择器相关 UI。

重点文件：

- `src/shared/components/QuietColorField.tsx`
- `src/shared/lib/colorFormatting.ts`
- `src/features/classification/components/AppMapping.tsx`
- `src/features/classification/components/CategoryColorControls.tsx`
- `src/App.css`

如确有必要，允许少量补充：

- `src/lib/copy.ts`
- `src/shared/components/*` 中与 popover / portal / overlay 相关的极小共享支持

## 5. 非目标

- 不扩展 Rust / Tauri / 后端
- 不重做整个 App Mapping 页面布局
- 不重做分类控制弹层整体布局
- 不引入第三方颜色选择器库
- 不做大型“设计软件级”颜色工作台
- 不顺手继续调整保存流、分类流或历史页

## 6. 核心要求

### 6.1 点击前样式

- 恢复到更接近之前已被认可的样式节奏
- 保留 Quiet Pro，但不要保留当前这版过于实验性的入口观感
- 入口应继续是次级控件，不要抢过分类选择与主要操作

### 6.2 点击后功能对齐原生

- 自有 Quiet Pro 颜色界面必须尽量对齐原生能力，而不是做“缩水版”

最低要求：

- [x] 有颜色主选区，不只是几条滑杆
- [x] 有 hue 控制
- [x] 有取色器能力
- [x] 有 `HEX / RGB / HSL` 显式切换
- [x] 切换后可编辑对应格式值

### 6.3 交互可发现性

- `HEX / RGB / HSL` 切换要比原生当前状态更容易被看见
- 但不能做成高噪音 tab 栏或主按钮
- 应该是 Quiet Pro 的次级 segmented/chip/control

### 6.4 层级与裁切

- 颜色弹层不能被滚动区裁切
- 不能被当前卡片或下方卡片遮住
- 不能被分类控制弹层内容区裁切
- 应优先采用稳定的 portal / overlay / fixed-position 挂载方式，而不是继续挂在滚动项内部绝对定位

## 7. 建议实现方向

推荐方向：

- 保留 `QuietColorField` 作为共享入口
- 重做它的内部弹层结构，使其变成：
  - 入口 trigger 恢复到之前认可的外观方向
  - 点击后通过 portal/popup 挂到稳定层级
  - 弹层内部补齐原生级核心能力

颜色弹层建议至少包含：

- 颜色主选区
- hue 滑条
- eyedropper / 取色器按钮
- 格式切换 control：`HEX / RGB / HSL`
- 当前格式对应的值输入区

注意：

- 取色器如果依赖浏览器/运行时能力，必须做 feature detection
- 如果当前 Tauri/WebView 运行时不支持该能力，不允许静默删掉；应提供明确 fallback 或在实现说明中标出真实限制

## 8. 执行阶段

### 阶段 A：恢复点击前入口样式

目标：

- 入口视觉回到之前更自然的版本

执行项：

- [x] 调整 `QuietColorField` 的 trigger 外观，使其回到之前已认可的样式方向
- [x] `App Mapping` 与 `分类控制` 入口保持一致
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 点击前入口不再是当前这版“过于实验性”的样式
- [x] 入口更接近之前用户认可的效果

### 阶段 B：把点击后功能补到原生级核心能力

目标：

- 改 UI，不减功能

执行项：

- [x] 增加颜色主选区
- [x] 保留或补齐 hue 控制
- [x] 补回取色器能力
- [x] 增加清楚但克制的 `HEX / RGB / HSL` 切换
- [x] 为当前格式提供可编辑输入
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] 点击后的能力接近原生颜色选择器，而不是缩水版
- [x] 取色器重新可用
- [x] `HEX / RGB / HSL` 切换比之前更明显

### 阶段 C：解决遮挡与裁切

目标：

- 颜色弹层稳定显示，不被页面内容遮挡

执行项：

- [x] 将颜色弹层改为不会被滚动区裁切的挂载方式
- [x] 复核 `App Mapping` 与 `分类控制` 中的层级都正确
- [x] 阶段 C 完成后运行 `npm run build`

验收门槛：

- [x] 弹层不会被卡片或滚动容器裁切
- [x] 弹层不会被下方内容遮住

### 阶段 D：回归与收尾

执行项：

- [x] 确认颜色修改、恢复默认、保存/取消流程未受影响
- [x] 确认两处颜色入口交互一致
- [x] 确认新文案统一收口，不混入零散英文
- [x] 更新本修正单勾选状态
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 9. 完成定义

- [x] 点击前入口样式已恢复到更接近之前认可版本的观感
- [x] 点击后仍是 Quiet Pro 自有 UI
- [x] 点击后功能已对齐原生颜色选择器的核心能力
- [x] 取色器重新可用
- [x] `HEX / RGB / HSL` 切换更容易被发现
- [x] 弹层不再被页面内容遮挡或裁切
- [x] `App Mapping` 与 `分类控制` 两处体验一致
- [x] `npm run build` 通过
- [ ] 如受影响，`npm test` 通过

## 10. 给 GPT-5.3-Codex 的执行要求

- 严格限定在颜色选择器 review fix 范围内
- 点击前样式要回到之前更顺眼的版本
- 点击后要做到“改 UI，不减原生功能”
- 不要再交付缩水版颜色选择器
- 不要继续把弹层挂在会被裁切的滚动容器里
- 不引入第三方颜色库
- 不扩展到 Rust / Tauri / 后端
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 11. 任务完成后的处理

本文件属于一次性修正单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在顶层 `docs/`。
