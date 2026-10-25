# 修正单：App Mapping 分类顺序与未分类收口

Document Type: One-off Review Fix Plan

## 1. 背景

本轮只修 `App Mapping / 分类控制` 里新暴露出来的 3 个问题：

1. 分类控制界面的分类顺序不够稳定，用户希望有明确顺序，而不是看起来像随意排列
2. `未分类` 属于内置分类语义，不应该在“分类控制”里作为可管理、可删除的分类出现
3. 分类页里又出现了 `Time Tracker / uninstall.exe` 这类不该进入人工分类页面的自家程序候选

这轮是 review-fix，只修这 3 个问题，不继续扩展 Quiet Pro 布局重做。

## 2. 当前问题定位

### 问题 A：分类控制顺序不稳定

当前分类控制弹层的数据来自：

- [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx)

其中：

- `orderedAssignableCategories` 主要沿用 `USER_ASSIGNABLE_CATEGORIES` 的内置顺序
- 自定义分类单独按中文标签排序
- 最终 `colorControlCategories` 直接复用了这份列表

这会导致分类控制界面的顺序更像“实现细节顺序”，而不是用户可理解的稳定展示顺序。

### 问题 B：`未分类` 出现在分类控制里

当前：

- `other` / `未分类` 仍属于 `USER_ASSIGNABLE_CATEGORIES`
- `colorControlCategories` 直接取自 `orderedAssignableCategories`

结果：

- `未分类` 会出现在分类控制里
- 还带着删除按钮，看起来像可以管理或删除的普通分类

但用户要求很明确：

- `未分类` 是内置兜底分类
- 它不应在“分类控制”里出现为可删除项
- 它仍然可以保留在应用分类下拉与筛选语义里，但不属于“可管理分类”

### 问题 C：自家程序又进入未分类列表

当前候选源头在：

- `src/lib/classification-store.ts`

这里会：

- 先用 `resolveCanonicalExecutable(...)`
- 再用 `shouldTrackProcess(...)`
- 再排除 `mapped.category === "system"`

但截图表明仍有：

- `Time Tracker`
- `uninstall.exe`

这说明“自家程序 / 安装卸载别名”没有被完整规范化或过滤掉，导致它们重新进入人工分类页。

## 3. 本轮目标

完成后应满足：

- 分类控制弹层里的分类顺序是稳定、可理解的
- `未分类` 不再出现在分类控制弹层中
- `未分类` 仍保留在应用分类下拉和列表筛选语义中
- 自家程序及其安装/卸载别名不再进入 `App Mapping` 的候选列表

## 4. 本轮范围

只允许修改这些相关文件：

- `src/features/classification/components/AppMapping.tsx`
- `src/features/classification/components/CategoryColorControls.tsx`
- `src/features/classification/services/classificationService.ts`
- `src/lib/classification-store.ts`
- `src/lib/processNormalization.ts`
- `src/lib/config/defaultMappings.ts`
- 如确有必要，`src/lib/ProcessMapper.ts`

## 5. 非目标

- 不重做 `App Mapping` 的 Quiet Pro 布局
- 不改 `Settings`、`History`、`Dashboard`
- 不修改保存 / 取消流程
- 不扩展 Rust / Tauri
- 不新增新的全局分类系统抽象

## 6. 核心修正原则

- “可分配分类” 和 “可管理分类” 要分开
  - `未分类` 可以是可分配分类
  - 但不应是可管理 / 可删除分类
- 分类控制的展示顺序应以用户可理解的标签顺序为主，而不是常量定义顺序
- 自家程序过滤应尽量收在候选源头或可复用的规范化规则中，不要在页面里硬写一次性排除

## 7. 执行阶段

### 阶段 A：收口分类控制展示顺序

目标：

- 分类控制弹层中的分类顺序明确且稳定

建议做法：

- 为“分类控制弹层展示用分类列表”单独建立明确派生值
- 该列表按展示标签做 `localeCompare(..., "zh-CN")` 排序
- 不直接复用“应用下拉可分配分类列表”

执行项：

- [x] 为分类控制建立单独的展示列表派生值
- [x] 分类控制弹层中的分类按展示标签稳定排序
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 分类控制顺序稳定、可预期
- [x] 不再依赖实现常量顺序来决定弹层展示顺序

### 阶段 B：把 `未分类` 从分类控制中移除

目标：

- `未分类` 不再作为可管理分类出现在分类控制里

执行项：

- [x] 分类控制弹层数据源中排除 `other`
- [x] `CategoryColorControls` 不再渲染 `未分类`
- [x] 删除分类流程不再触达 `other`
- [x] 保持 `未分类` 在应用分类下拉和筛选标签中的正常语义
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] 分类控制里不再看到 `未分类`
- [x] 应用分类下拉仍可选 `未分类`
- [x] “未分类”筛选页签仍正常工作

### 阶段 C：收口自家程序候选过滤

目标：

- 自家程序及其安装/卸载别名不再进入人工分类页

建议做法：

- 优先修在候选源头或 executable 规范化规则
- 不要在 `AppMapping.tsx` 里追加一次性 `filter(exe !== ...)`

执行项：

- [x] 明确 `time_tracker.exe` / `time-tracker.exe` / `uninstall.exe` 等自家生命周期别名的规范化或过滤路径
- [x] `loadObservedAppCandidates(...)` 输出不再包含这些自家程序候选
- [x] 如需补充默认系统映射或非追踪进程规则，收口到正确底层位置
- [x] 阶段 C 完成后运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

验收门槛：

- [x] 截图里这种 `Time Tracker / uninstall.exe` 不再出现在“未分类”列表
- [x] 过滤逻辑落在候选源头或规范化层，而不是页面临时补丁

## 8. 完成定义

满足以下条件，才算本轮完成：

- [x] 分类控制展示顺序稳定
- [x] `未分类` 不再出现在分类控制弹层
- [x] `未分类` 仍保留在分类选择和筛选语义中
- [x] 自家程序候选不再进入 `App Mapping`
- [x] `npm run build` 通过
- [ ] 如本轮影响现有测试链路，相关 `npm test` 通过

## 9. 给 GPT-5.3-Codex 的执行要求

- 这是 review-fix，只修这 3 个问题
- 不要顺手继续改 Quiet Pro 布局方向
- 不要在页面里写一次性过滤补丁来掩盖候选源头问题
- “可分配分类”和“可管理分类”必须明确分开
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 10. 任务完成后的处理

本文档属于一次性修正单。  
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
