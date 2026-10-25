# 执行单：分类控制弹层全屏布局收口

Document Type: One-off Execution Plan

## 1. 目标

本轮只处理 `App Mapping` 页面里“分类控制”弹层在大窗口 / 全屏下的 Quiet Pro 布局问题。

用户已经明确指出当前问题：

- 小窗口里还能接受
- 一旦窗口放大或全屏，弹层会显得又小、又碎、又空
- 整体不像 Quiet Pro 的“克制、稳定、专业”，反而像把一个小网页弹窗硬摆在大屏中央

本轮完成后，应达到：

- 分类控制弹层在大屏下有更合理的宽度和内容密度
- 卡片排布不再被挤成零碎的小块
- 标题区、内容区、操作区层级更清楚
- 仍然保持 Quiet Pro，而不是做成夸张的全屏大面板

## 2. 问题定位

当前观感发散主要来自 3 个点叠加：

1. 共享 `QuietDialog` 的默认 surface 宽度过窄：
   - [`src/App.css`](../../src/App.css) 中 `.qp-dialog-surface` 当前是固定 `width: min(560px, 100%)`
   - [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx) 虽然传了 `surfaceClassName="max-w-5xl"`，但这只限制最大宽度，不会真正把弹层拉宽

2. 分类卡片网格是“固定断点列数”，不是“按可读宽度自适应”：
   - [`src/features/classification/components/CategoryColorControls.tsx`](../../src/features/classification/components/CategoryColorControls.tsx) 当前是 `grid-cols-1 md:grid-cols-2 xl:grid-cols-3`
   - 在弹层本体偏窄时，三列会把每张卡片压得太小；在大屏时，弹层又没有顺势扩展，结果就是中间一小块内容悬着

3. 卡片内部信息与操作混在一行，导致横向空间一紧张就显得很碎：
   - 分类名、颜色码、色块、默认、删除都在同一行竞争宽度
   - Quiet Pro 需要的是更稳定的行结构和清晰的操作分组，而不是一排排小控件挤在一起

## 3. 本轮范围

只处理以下文件及其直接相关样式：

- `src/shared/components/QuietDialog.tsx`
- `src/App.css`
- `src/features/classification/components/AppMapping.tsx`
- `src/features/classification/components/CategoryColorControls.tsx`

允许的合理扩展：

- 为 `QuietDialog` 增加“宽弹层 / 大内容弹层”的明确尺寸角色
- 为分类控制弹层增加少量 feature-level className
- 为分类控制卡片增加更稳定的内部布局样式

## 4. 非目标

- 不重做 `App Mapping` 整页布局
- 不改 `Settings`、`History`、`Dashboard`
- 不把所有 QuietDialog 都改成大弹层
- 不引入新的 UI 框架
- 不扩展 Rust / Tauri
- 不顺手重写颜色选择器底层控件

## 5. 核心边界要求

- 大屏观感问题虽然暴露在 `CategoryColorControls`，但不能靠页面里硬塞一堆一次性宽度补丁解决
- 如果需要更宽的 Quiet Pro 弹层，应先在共享 dialog 上建立明确的尺寸角色，再由页面接入
- 分类控制的内容密度和卡片结构，应留在 feature 内解决，不要把分类业务布局逻辑倒灌进 shared dialog
- 视觉方向必须遵守 Quiet Pro：更稳、更整齐、更清楚，不是更花、更满、更吵

## 6. 执行阶段

### 阶段 A：建立适合大内容场景的 QuietDialog 尺寸角色

目标：

- 让共享 dialog 能支持“普通弹层”与“宽内容弹层”两种明确尺寸，而不是所有弹层都固定 560px

建议做法：

- 在 `QuietDialog` 保持现有基础骨架不变
- 给 surface 增加明确的尺寸 class / 角色，例如：
  - 默认尺寸：保留当前 confirm / prompt 使用
  - 宽尺寸：供分类控制这类内容弹层使用
- 宽尺寸应在大屏下更舒展，但仍保留合理最大宽度与边缘留白

执行项：

- [x] 为 `QuietDialog` 建立明确的宽弹层尺寸接入方式
- [x] 在 `src/App.css` 中补齐对应 Quiet Pro 尺寸样式
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 分类控制弹层在大屏下不再维持过窄宽度
- [x] 普通 confirm / prompt 不被连带放大

### 阶段 B：重排分类控制弹层内容布局

目标：

- 分类控制弹层在大屏下不再显得又空又碎，卡片信息更稳定

建议做法：

- `CategoryColorControls` 改为更稳的自适应卡片网格
  - 优先考虑基于最小卡片宽度的自适应方案，而不是简单 `xl:grid-cols-3`
- 每张分类卡片内部拆成更清楚的两段：
  - 信息段：分类点、名称、颜色码
  - 操作段：颜色选择、恢复默认、删除
- 让卡片高度、留白、操作区对齐更稳定

执行项：

- [x] `AppMapping` 的分类控制弹层接入宽尺寸 dialog
- [x] `CategoryColorControls` 改为更稳定的自适应网格
- [x] 分类卡片内部结构重排，减少一行内过多小控件竞争宽度
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] 全屏下弹层不再像一小块悬在中间
- [x] 分类卡片不再显得过密、过碎
- [x] 标题区、内容区、底部操作区层级清晰

### 阶段 C：Quiet Pro 回归收口

目标：

- 确认这轮只是把分类控制弹层做稳，而不是引入新的 page-local 视觉特例

执行项：

- [x] 复查没有把分类布局逻辑塞进 shared dialog
- [x] 复查没有把普通 confirm / prompt 误改成大尺寸
- [x] 更新执行单勾选状态
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 7. 完成定义

满足以下条件，才算本轮完成：

- [x] 分类控制弹层在全屏下宽度与留白合理
- [x] 分类卡片在大屏下具有稳定、可读、不过碎的布局
- [x] 普通 confirm / prompt 视觉与尺寸没有被误伤
- [x] 没有新增 page-local 粗暴宽度补丁来冒充设计系统
- [x] `npm run build` 通过
- [ ] 如本轮影响现有测试链路，相关 `npm test` 通过

## 8. 给 GPT-5.3-Codex 的执行要求

- 严格限定在分类控制弹层的大屏 Quiet Pro 布局收口范围内
- 优先通过共享 dialog 尺寸角色 + feature 内部内容布局解决，不要只在页面写一次性宽度 hack
- 不重做整页 `App Mapping`
- 不扩展 Rust / Tauri
- 不引入大型第三方 UI 框架
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 9. 任务完成后的处理

本文档属于一次性执行单。  
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
