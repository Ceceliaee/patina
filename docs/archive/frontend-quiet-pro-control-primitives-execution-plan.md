# 执行单：Quiet Pro 控件原语收口

Document Type: One-off Execution Plan

## 1. 目标

本轮目标是把当前前端里仍然带有明显浏览器默认外观的“选项 / 提示”交互，收口到真正符合 `Quiet Pro` 的共享控件原语上。

这轮重点解决用户已经明确指出的两类问题：

- 原生提示框过于原始：`window.confirm(...)`、`window.prompt(...)`
- 原生下拉选项过于原始：`<select>` 打开后的系统默认菜单外观与 Quiet Pro 脱节

本轮完成后，理想状态应变为：

- 危险确认、未保存确认、自定义分类输入，不再出现浏览器默认弹框
- Settings / App Mapping / History 中当前仍使用原生 `<select>` 的位置，不再打开系统默认下拉菜单
- 这些交互在视觉、层级、按钮、焦点、hover、active、disabled 上都体现 Quiet Pro 的“安静、专业、克制”

本轮只处理前端 UI 原语与相关页面接入，不扩展 Rust / Tauri 架构改造。

## 2. 为什么这是单独一轮

当前页面主体框架已经比较接近 Quiet Pro，但截图里暴露出一个明显割裂：

- 壳层、面板、按钮、状态条已经使用了 Quiet Pro token
- 但关键交互原语仍然是浏览器默认样式

当前问题集中在：

- [`src/app/AppShell.tsx`](../../src/app/AppShell.tsx) 的未保存切页提示仍走 `window.confirm(...)`
- [`src/features/settings/components/Settings.tsx`](../../src/features/settings/components/Settings.tsx) 的清理/恢复确认仍走 `window.confirm(...)`
- [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx) 的新建分类仍走 `window.prompt(...)`，删除确认仍走 `window.confirm(...)`
- Settings / App Mapping / History 页面中的多个 `<select>` 虽然闭合态套了 `qp-control`，但展开后的选项列表仍是浏览器默认菜单

这不是某个页面单独“长得丑”，而是底层交互原语还没进入 Quiet Pro 体系。

因此这轮应按“执行单模式”处理：

- 先建立最小够用的共享 Quiet Pro 控件原语
- 再让具体页面接入
- 避免继续在页面里写一次性对话框和一次性下拉样式补丁

## 3. 本轮范围

只处理前端 Quiet Pro 控件原语与页面接入，不扩展新的后端、Rust、Tauri 命令改造。

重点涉及文件：

- `src/App.css`
- `src/app/AppShell.tsx`
- `src/features/settings/components/Settings.tsx`
- `src/features/classification/components/AppMapping.tsx`
- `src/features/history/components/History.tsx`
- `src/lib/copy.ts`
- `src/lib/confirm.ts`

允许新增的合理落点：

- `src/shared/components/*` 中新增 Quiet Pro 共享控件原语
- `src/shared/hooks/*` 中少量只服务于这些共享控件的 hook
- `src/shared/types/*` 中少量仅与共享 UI 原语有关的类型

推荐的新原语类型：

- `QuietDialog` / `QuietConfirmDialog`
- `QuietPromptDialog`
- `QuietSelect` 或等价的 Quiet Pro 自定义下拉原语

## 4. 非目标

- 不做整页信息架构重排
- 不重新设计 Dashboard / History / Settings / App Mapping 的页面布局
- 不扩展颜色系统或重做整套 token 主题
- 不把所有输入控件一次性全部重写，当前只聚焦“提示 / 选项”原语
- 不改颜色选择器 `input[type=color]` 的底层形态
- 不引入大型第三方 UI 框架，除非仓库现有能力无法完成且必须先与你确认
- 不改 Rust / Tauri

## 5. 核心边界要求

这轮最重要的不是“把对话框做得花哨”，而是 Quiet Pro 共享原语边界必须正确：

- 危险确认、普通确认、文本输入提示应优先落到共享 `dialog / prompt` 原语
- 选项下拉应优先落到共享 `select / listbox` 原语
- 页面只负责传入文案、选项、回调，不负责自己拼一次性 overlay 结构
- 不允许继续保留 `window.confirm(...)` / `window.prompt(...)` 作为主路径
- 不允许给单个页面单独造一套只在那里可用的“伪对话框”或“伪下拉”
- 共享控件必须符合 Quiet Pro：克制、稳定、清晰，不走夸张动效或重装饰

## 6. 执行阶段

### 阶段 A：建立 Quiet Pro 共享提示原语

目标：

- 用共享 Quiet Pro 对话框替换浏览器默认确认/输入提示的基础能力

建议做法：

- 建立共享 `dialog` 容器原语，统一 backdrop、surface、header、body、actions
- 建立共享 `confirm` 变体，支持：
  - 标题
  - 正文
  - 危险操作语义
  - 确认 / 取消按钮
- 建立共享 `prompt` 变体，支持：
  - 标题
  - 说明文案
  - 单行输入框
  - 输入校验 / disabled / confirm
- 补齐 `default / hover / active / focus / disabled`

执行项：

- [x] 在 `src/shared/components/*` 中新增 Quiet Pro 共享对话框原语
- [x] 补齐对话框所需的 token / 样式角色到 `src/App.css`
- [x] 保证键盘与关闭行为清晰可预测
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 新原语在视觉上明显不是浏览器默认弹框
- [x] 标题、正文、危险操作语义、按钮区层级清晰
- [x] 焦点、hover、disabled 状态完整

### 阶段 B：用 Quiet Pro 对话框替换当前原生提示

目标：

- 当前主路径不再依赖 `window.confirm(...)` / `window.prompt(...)`

本轮至少替换以下位置：

- [`src/app/AppShell.tsx`](../../src/app/AppShell.tsx) 的未保存切页确认
- [`src/features/settings/components/Settings.tsx`](../../src/features/settings/components/Settings.tsx) 的清理历史确认
- [`src/features/settings/components/Settings.tsx`](../../src/features/settings/components/Settings.tsx) 的恢复备份确认
- [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx) 的新建分类输入
- [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx) 的删除分类确认
- [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx) 的删除应用记录确认

执行项：

- [x] 将上述原生 confirm / prompt 入口替换为共享 Quiet Pro 对话框
- [x] 如 `src/lib/confirm.ts` 不再适合当前结构，收口为结构化文案辅助或移除旧字符串拼接职责
- [x] 文案进入 `src/lib/copy.ts`，不要散落硬编码
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] 应用内不再弹出浏览器默认确认框
- [x] 新建分类不再弹出浏览器默认输入框
- [x] 危险操作确认在视觉上与 Quiet Pro 体系一致

### 阶段 C：建立 Quiet Pro 共享选项原语

目标：

- 替换当前打开后仍显示浏览器默认菜单的原生 `<select>`

建议做法：

- 建立共享 `QuietSelect`
- 闭合态与当前 `qp-control` 体系对齐
- 展开态使用 Quiet Pro 自己的 panel / listbox / option 样式
- 支持：
  - `default`
  - `hover`
  - `active`
  - `focus`
  - `disabled`
  - 当前选中项高亮
  - 键盘可用的基础交互

执行项：

- [x] 在 `src/shared/components/*` 中新增 Quiet Pro 共享下拉原语
- [x] 补齐下拉 trigger / menu / option 所需样式角色到 `src/App.css`
- [x] 阶段 C 完成后运行 `npm run build`

验收门槛：

- [x] 新下拉展开后不再显示浏览器默认菜单
- [x] 闭合态与展开态都符合 Quiet Pro
- [x] 选中项、hover、focus 清晰可辨

### 阶段 D：替换当前页面中的原生下拉

目标：

- Settings / App Mapping / History 中当前暴露原始感的选项控件统一接入 Quiet Pro 下拉原语

本轮至少替换：

- [`src/features/settings/components/Settings.tsx`](../../src/features/settings/components/Settings.tsx) 中当前所有设置项下拉
- [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx) 中应用分类选择
- [`src/features/history/components/History.tsx`](../../src/features/history/components/History.tsx) 中时间流最少时长下拉

执行项：

- [x] Settings 页原生 `<select>` 改接共享 Quiet Pro 下拉
- [x] App Mapping 页分类选择改接共享 Quiet Pro 下拉
- [x] History 页时间流最少时长选择改接共享 Quiet Pro 下拉
- [x] 阶段 D 完成后运行 `npm run build`

验收门槛：

- [x] 截图中这类“原始”选项菜单不再出现
- [x] 页面控件观感与 Quiet Pro 主体骨架统一

### 阶段 E：分类控制弹层与交互一致性收口

目标：

- 分类控制弹层、自定义分类输入弹层、危险确认弹层在视觉语言上统一

建议做法：

- 分类控制现有弹层改为复用共享 dialog 骨架或至少与其视觉一致
- 统一 overlay 深度、surface 留白、关闭按钮、标题区、操作区
- 让“分类控制”与“确认 / 输入提示”看起来像同一套产品内对话层

执行项：

- [x] 分类控制弹层与共享 Quiet Pro dialog 体系对齐
- [x] 自定义分类输入弹层与危险确认弹层视觉语言统一
- [x] 阶段 E 完成后运行 `npm run build`

验收门槛：

- [x] 分类控制相关弹层不再像临时网页弹窗
- [x] 交互层之间的骨架、间距、按钮语义统一

### 阶段 F：回归验证与文档收尾

执行项：

- [x] 复查没有继续残留 `window.confirm(...)` / `window.prompt(...)` 主路径
- [x] 复查没有新增 page-local 一次性 dialog/select 结构
- [x] 更新本执行单勾选状态
- [x] 任务完成并验收通过后，将本文件移入 `docs/archive/`
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 7. 完成定义

满足以下条件，才算本轮完成：

- [x] 共享 Quiet Pro 对话框原语已建立并接入主路径
- [x] 共享 Quiet Pro 下拉原语已建立并接入 Settings / App Mapping / History 的目标位置
- [x] 应用中不再出现截图里这种浏览器默认提示框与默认下拉菜单
- [x] 没有新增 page-local UI workaround
- [x] `npm run build` 通过
- [ ] 如本轮影响现有测试链路，相关 `npm test` 通过

## 8. 给 GPT-5.3-Codex 的执行要求

- 严格限定在 Quiet Pro 控件原语与页面接入范围内
- 不扩展新的 Rust / Tauri 改造
- 不顺手重做整页布局
- 不引入大型第三方 UI 框架；优先用现有 React + Framer Motion + 仓库 token 构建最小共享原语
- 共享 `dialog / select` 原语只能落在 `src/shared/components/*` 等明确共享 UI 层，不要落到页面私有目录冒充通用能力
- 文案统一走 `src/lib/copy.ts`
- 如触及中文文案，必须保持 UTF-8，先修编码问题再继续
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 9. 任务完成后的处理

本文档属于一次性执行单。  
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
