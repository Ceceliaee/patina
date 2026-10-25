# 执行单：颜色格式切换可发现性收口

Document Type: One-off Execution Plan

## 1. 目标

本轮只处理一个前端交互问题：

- 当前颜色编辑入口直接暴露了系统/浏览器原生颜色控件，视觉上像“本地控件”，和项目现有 Quiet Pro 控件体系不一致
- 原生颜色选择器内部虽然可能支持 `RGB / HSL / HEX` 切换，但在项目 UI 中几乎没有可感知提示
- 用户很难意识到“颜色值不仅能看 HEX，还可以切换格式”
- 但这次也**不要**把提示做得过于抢眼，不能破坏 `Quiet Pro` 的安静、克制基调

本轮目标是：

- 让颜色编辑入口首先看起来属于我们自己的 Quiet Pro UI，而不是浏览器/系统自带控件
- 让颜色格式切换能力在 UI 中“可发现，但不喧宾夺主”
- 保持现有颜色编辑主流程稳定，不重做整个颜色选择器
- 在 `App Mapping` 与 `分类控制` 两处形成一致、可复用的 Quiet Pro 表达

## 2. 问题定位

当前颜色编辑主路径主要在两处：

1. [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx)
   - 应用行内颜色区域当前只直接展示颜色值文本与原生 `<input type="color">`
   - 页面上默认只显式露出 `HEX` 结果，没有任何格式切换 affordance

2. [`src/features/classification/components/CategoryColorControls.tsx`](../../src/features/classification/components/CategoryColorControls.tsx)
   - 分类控制弹层中同样只直接显示颜色字符串与原生 `<input type="color">`
   - 同样没有可理解的“格式可切换”入口

因此目前的问题不是“颜色值不能改”，而是：

- 颜色编辑入口本身是原生本地控件观感，和产品 UI 断层
- 格式切换能力被埋在原生颜色控件内部
- 项目自己的 Quiet Pro 层没有提供统一的颜色编辑壳层与轻量提示
- 用户只能靠偶然发现

## 3. 本轮范围

只处理前端颜色编辑入口、颜色值展示与格式切换 affordance。

重点文件：

- `src/features/classification/components/AppMapping.tsx`
- `src/features/classification/components/CategoryColorControls.tsx`

如确有必要，允许少量新增或调整：

- `src/shared/components/*` 中新增一个轻量共享颜色展示/格式切换原语
- `src/shared/lib/*` 中新增颜色格式转换 helper
- `src/App.css`
- `src/lib/copy.ts`

## 4. 非目标

- 不做大型、复杂、设计感过重的颜色工作台
- 不引入第三方颜色选择器库
- 不扩展 Rust / Tauri / 数据层改造
- 不重做 `App Mapping` 或 `分类控制` 的整体布局
- 不把格式切换做成高噪音 tabs、重按钮、显眼强调条
- 不新增“全局主题/偏好设置”级别的持久化格式偏好

## 5. 核心边界要求

- 颜色格式切换必须是 `Quiet Pro` 风格：
  - 默认克制
  - 可在 hover / focus / 当前值区域中被自然发现
  - 不能抢过颜色本身和业务信息层级

- 颜色编辑入口必须先回到“项目自己的控件体系”：
  - 用户第一眼看到的应该是 Quiet Pro 的 swatch / field / panel
  - 不能继续把原生本地颜色控件直接当成最终 UI 暴露
  - 如需继续借助浏览器原生能力，也只能作为内部实现细节，不能作为主要视觉壳层

- “可发现，但不太明显”的具体含义：
  - 用户在看颜色值区域时，能意识到当前显示格式，例如 `HEX`
  - 用户可以用 1 次点击或非常直观的轻交互切到 `RGB / HSL`
  - 该入口应看起来像一个轻量 control / chip，而不是主操作按钮

- 两个颜色入口必须一致：
  - `App Mapping` 行内颜色控制
  - `分类控制` 弹层中的分类颜色控制

- 优先形成可复用的小原语，而不是两处各写一套页面私有样式

## 6. 建议实现方向

推荐方向：

- 先形成一个项目自有的 Quiet Pro 颜色编辑壳层
- 在颜色值展示旁补一个**轻量格式标识 + 切换入口**
- 如果需要选色面板，应做成轻量、克制的小型 Quiet Pro 浮层/面板，而不是继续直接依赖原生颜色控件视觉
- 入口形态优先考虑：
  - 细小 segmented/chip 形式
  - 或安静的 `QuietSelect`
  - 或点击当前格式标签后循环切换 `HEX / RGB / HSL`

不推荐：

- 大面积新增说明文案
- 做成主按钮级别的视觉权重
- 为每个颜色项塞入一整排明显 tabs
- 继续把浏览器/系统原生颜色控件直接暴露成主要 UI

如果需要共享封装，优先考虑类似：

- `QuietColorField`
- `QuietColorValue`
- `QuietColorFormatSwitch`
- `QuietColorPopover`
- `colorFormatting.ts`

命名不必拘泥于上面，只要边界清楚即可。

## 7. 执行阶段

### 阶段 A：抽出 Quiet Pro 颜色编辑原语

目标：

- 形成统一的颜色编辑壳层与格式切换表达

执行项：

- [x] 形成项目自有的 Quiet Pro 颜色编辑入口，不再直接暴露原生本地控件观感
- [x] 定义 `HEX / RGB / HSL` 的格式化 helper
- [x] 形成一个 Quiet Pro 风格的轻量格式切换/展示原语
- [x] 保证该原语具备 `default / hover / focus / disabled` 基本状态
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 颜色入口第一眼看起来属于项目自己的控件体系
- [x] 当前显示格式在 UI 中可被看见
- [x] 控件权重仍低于保存、分类、删除等主要操作

### 阶段 B：接入 App Mapping 与分类控制

目标：

- 两个颜色入口统一体验

执行项：

- [x] 将应用行内颜色展示区接入新的格式切换/展示原语
- [x] 将分类控制中的颜色展示区接入同一原语或同一交互模型
- [x] 如新增文案或格式标签，统一收口到 `copy.ts`
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] `App Mapping` 与 `分类控制` 的颜色格式切换体验一致
- [x] 用户能自然注意到当前是 `HEX / RGB / HSL` 中的哪一种
- [x] 用户看到的颜色编辑入口不再像浏览器/系统原生本地控件
- [x] 视觉上仍然是 Quiet Pro 的次级 control，而不是主按钮

### 阶段 C：回归与收尾

执行项：

- [x] 确认原有颜色修改、恢复默认、保存/取消流程未受影响
- [x] 确认颜色切换只改变显示/编辑格式表达，不破坏实际颜色值提交
- [x] 更新本执行单勾选状态
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 8. 完成定义

满足以下条件，才算本轮完成：

- [x] 颜色值区域能清楚但克制地显示当前格式
- [x] 用户能在 `HEX / RGB / HSL` 间完成轻量切换
- [x] 颜色编辑入口不再呈现明显的原生本地 UI 观感
- [x] 两个颜色入口体验一致
- [x] 没有把颜色控件做成过度醒目的大控件
- [x] 原有颜色编辑、恢复默认、保存流不受影响
- [x] `npm run build` 通过
- [ ] 如受影响，相关 `npm test` 通过

## 9. 给 GPT-5.3-Codex 的执行要求

- 严格限定在“颜色格式切换可发现性”范围内
- 同时修掉“颜色入口是原生本地控件、与 Quiet Pro 不一致”这个根问题
- 保持 `Quiet Pro`：可发现，但不要太明显
- 优先做轻量共享原语，不要两处页面私有拼装
- 不引入第三方颜色库
- 不做大型复杂颜色工作台
- 不扩展到 Rust / Tauri / 后端
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 10. 任务完成后的处理

本文件属于一次性执行单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在顶层 `docs/`。
