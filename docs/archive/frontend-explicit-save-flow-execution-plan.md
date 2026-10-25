# 执行单：前端显式保存 / 取消编辑收口

Document Type: One-off Execution Plan

## 1. 目标

本轮目标是把当前前端“编辑即自动保存”的交互，收口为“本地编辑 -> 显式保存 -> 可取消回滚”的稳定模式，并补上应用内切换页面时的未保存提示。

本轮覆盖以下两个高价值页面：

- [`src/features/settings/components/Settings.tsx`](../../src/features/settings/components/Settings.tsx)
- [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx)

本轮完成后，理想状态应变为：

- 用户修改设置、应用映射、分类颜色、分类映射时，先只更新页面本地 `draft`
- 只有点击“保存”后，才真正写入 persistence / runtime adapter
- 点击“取消”后，页面回到最近一次已保存快照
- 如果当前页面存在未保存修改，切换到应用内其他页面时会先提示确认
- 页面不再在“选择一下就自动落库”

本轮只处理前端编辑提交流程，不扩展新的 Rust / Tauri 重构。

## 2. 为什么先做这一轮

当前主路径是明显的“即时写入”：

- [`Settings.tsx`](../../src/features/settings/components/Settings.tsx) 里 `handleChange(...)` 会在字段变化后立刻调用 `SettingsRuntimeAdapterService.updateSetting(...)`
- [`AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx) 里的分类、颜色、名称、统计开关、标题记录开关都会即时调用 `ClassificationService.save*`
- [`CategoryColorControls.tsx`](../../src/features/classification/components/CategoryColorControls.tsx) 里的颜色修改也直接落库

这带来的问题不是“代码错了”，而是交互模式已经不适合当前稳定期：

- 用户没有试改空间
- 用户不能先改一组内容再统一确认
- 用户不能明确取消本次编辑
- 用户一旦切换页面，当前修改会在没有确认的情况下被自动带走或自动写入
- 如果继续把这类行为散落在组件事件里，后续更容易把页面层和 persistence 边界重新缠在一起

因此这轮应按“执行单模式”处理，而不是继续做局部即时修补。

## 3. 本轮范围

只处理前端显式保存 / 取消编辑 / 应用内切页未保存提示，不扩展新的后端、Rust、Tauri 命令改造。

重点涉及文件：

- `src/features/settings/components/Settings.tsx`
- `src/features/settings/services/settingsRuntimeAdapterService.ts`
- `src/features/settings/services/settingsPageService.ts`
- `src/features/settings/types.ts`
- `src/features/classification/components/AppMapping.tsx`
- `src/features/classification/components/CategoryColorControls.tsx`
- `src/features/classification/services/classificationService.ts`
- `src/features/classification/types.ts`
- `src/app/AppShell.tsx`
- `src/lib/copy.ts`

允许新增的合理落点：

- `src/features/settings/hooks/*`
- `src/features/classification/hooks/*`
- `src/features/settings/services/*` 内少量页面级提交 helper
- `src/features/classification/services/*` 内少量页面级提交 helper
- `src/app/*` 内少量仅用于应用内切页拦截的协调逻辑

## 4. 非目标

- 不改 Rust / Tauri 持久化实现
- 不新增新的通用跨 feature dirty-form 框架
- 不把 draft 管理抽到 `shared/*` 或 `src/lib/*`
- 不顺手做浏览器刷新、窗口关闭、系统退出级别的全局 unsaved-changes 守卫
- 不改备份、清理历史、恢复备份这类确认后本就应立即执行的动作
- 不改“删除应用记录”这类 destructive action 的即时确认逻辑

## 5. 核心边界要求

这轮最重要的不是“加两个按钮”，而是边界必须正确：

- `Settings` 页面拥有自己的“已保存快照 + 本地 draft + dirty 状态”
- `AppMapping` 页面拥有自己的“已保存快照 + 本地 draft + dirty 状态”
- persistence 写入只能发生在明确的“保存提交”步骤
- 页面事件处理器不再直接承担“用户点一下就立刻持久化”
- 应用内切页提示只负责拦截 `AppShell` 内部 view 切换，不负责更大的全局离开场景
- 如果需要 batch commit / diff 计算，应优先放在 feature 自己的 service / hook 中，不要造新的 shared 通用抽象

## 6. 执行阶段

### 阶段 A：Settings 页面切换为显式保存模式

目标：

- Settings 页不再在字段变化时即时写入

建议做法：

- 保留页面级 `saved snapshot` 与 `draft settings`
- 各个 `select` / `toggle` / 相关输入只更新本地 `draft`
- 页面头部的状态区改为“未保存更改 / 保存中 / 已保存”语义
- 新增明确的“保存”和“取消”操作
- 保存时仅提交发生变化的字段
- 取消时回滚到最近一次成功保存的快照

执行项：

- [x] `Settings.tsx` 从“字段 `onChange` 直接 `updateSetting`”改为“字段 `onChange` 只更新本地 `draft`”
- [x] 新增 Settings 页的显式“保存 / 取消”操作
- [x] `onSettingsChanged(...)` 只在保存成功后触发，不再在每次字段变化时触发
- [x] 如需 diff / batch save，收口到 settings feature 自己的 `service / hook`
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 修改 Settings 页字段后，不会立刻写入 persistence
- [x] 点击“保存”后才真正提交
- [x] 点击“取消”后恢复到最近一次已保存状态

### 阶段 B：App Mapping / 分类控制切换为显式保存模式

目标：

- 应用映射页与分类控制中的编辑项，不再即时落库

本轮应纳入 draft 的编辑项至少包括：

- 应用分类选择
- 应用颜色覆盖
- 应用显示名称
- “统计中 / 不统计”切换
- “记录标题 / 不记标题”切换
- 恢复默认 override
- 分类颜色调整
- 新建自定义分类
- 删除分类

建议做法：

- 页面维护 classification bootstrap 的已保存快照与本地 `draft`
- 所有映射类编辑先作用于本地 `draft`，再统一保存
- 保存时由 classification feature 自己的 `service` 负责 diff 与提交顺序
- `ProcessMapper` / facade 的内存更新只应发生在保存成功后，而不是 `draft` 阶段

仍保持即时执行的动作：

- 删除应用记录
- 备份 / 恢复 / 清理历史等确认型操作

执行项：

- [x] `AppMapping.tsx` 中映射类事件处理器改为只更新本地 `draft`
- [x] `CategoryColorControls.tsx` 改为参与同一页的 `draft`，而不是直接保存
- [x] 新增 App Mapping 页级“保存 / 取消”操作
- [x] `onOverridesChanged(...)` 只在保存成功后触发
- [x] 分类 feature 内如需新增 commit helper，只能落在该 feature 自己的 `service / hook`
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] 应用映射页上分类、颜色、名称、追踪状态、标题记录状态变更都不会即时写入 persistence
- [x] 分类控制中的颜色修改、新建分类、删除分类都参与同一页的显式保存流程
- [x] 保存成功前，不会触发 `mappingVersion` 的全局刷新联动

### 阶段 C：应用内切页未保存提示

目标：

- 当 Settings 或 App Mapping 存在未保存修改时，切换到应用内其他页面会先提示确认

边界要求：

- 只处理 `AppShell` 内部页面切换
- 不扩展到浏览器刷新、窗口关闭、系统退出
- 提示结果至少支持：
  - 继续切换并丢弃当前未保存修改
  - 留在当前页面继续编辑

建议做法：

- 由 `Settings` 和 `AppMapping` 向上暴露页面级 `dirty` 状态
- 由 `AppShell` 统一拦截 `Sidebar` 的 view 切换
- 在 `AppShell` 处理确认提示与最终导航提交
- 不把切页守卫做成新的全局 shared guard

执行项：

- [x] `Settings` 暴露页面级 dirty 状态给上层
- [x] `AppMapping` 暴露页面级 dirty 状态给上层
- [x] `AppShell.tsx` 拦截 view 切换，在存在未保存修改时先提示确认
- [x] 确认“放弃更改”后才允许切页
- [x] 取消切换时保留当前页面与当前 draft
- [x] 阶段 C 完成后运行 `npm run build`

验收门槛：

- [x] Settings 有未保存修改时，切换页面会先提示
- [x] App Mapping 有未保存修改时，切换页面会先提示
- [x] 选择留在当前页时，不会丢失 draft
- [x] 选择放弃更改后，才允许进入目标页面

### 阶段 D：交互一致性与文案同步

目标：

- 显式保存与未保存提示的交互要一致，并符合 Quiet Pro 的克制工作台气质

建议做法：

- 统一 `dirty / saving / saved / confirm discard` 的状态文案
- 状态区不再写“所有更改自动同步”
- 保存、取消、未保存提示的按钮语义清晰，但不过度喧闹
- 只在必要位置新增 copy，不要散落硬编码

执行项：

- [x] 更新 `src/lib/copy.ts` 中与自动同步相关的文案
- [x] 为 Settings / App Mapping / 切页提示补齐必要 copy
- [x] 保存成功、取消回滚、切页放弃确认后的页面反馈清晰但不过度提示
- [x] 阶段 D 完成后运行 `npm run build`

验收门槛：

- [x] UI 上不再暗示“选择后自动保存”
- [x] Settings 页与 App Mapping 页都具备清晰的“编辑中 / 已保存 / 未保存提示”反馈

### 阶段 E：回归验证与文档收尾

执行项：

- [x] 复查 settings feature 与 classification feature 没有新增跨 feature 通用 dirty helper
- [x] 复查 `src/lib/*` / `shared/*` 没有因为这轮需求重新长出不必要中间层
- [x] 更新本执行单勾选状态
- [x] 任务完成并验收通过后，将本文件移入 `docs/archive/`
- [x] 收尾运行 `npm run build`

如本轮引入或触发前端测试覆盖，再补跑：

- [ ] `npm test`

如果没有新增 / 影响现成测试链路，可不强制扩展测试框架。

## 7. 完成定义

满足以下条件，才算本轮完成：

- [x] Settings 页已切换为显式保存 / 取消模式
- [x] App Mapping 页及分类控制已切换为显式保存 / 取消模式
- [x] Settings 与 App Mapping 在存在未保存修改时，应用内切换页面会先提示确认
- [x] 页面组件不再在字段变化时直接写 persistence
- [x] feature 自己承接 `draft -> commit` 的页面业务逻辑，没有新建跨 feature 通用层
- [x] `npm run build` 通过
- [ ] 如本轮影响现有测试链路，相关 `npm test` 通过

## 8. 给 GPT-5.3-Codex 的执行要求

- 严格限定在前端显式保存 / 取消编辑 / 应用内切页未保存提示范围内
- 不扩展新的 Rust / Tauri 改造
- 不顺手做浏览器刷新、窗口关闭、系统退出级别的全局 unsaved-changes 守卫
- 不新增通用 shared dirty-form 抽象，`draft` 逻辑必须留在各自 feature 内
- 切页提示只允许落在 `AppShell` 协调层，不要倒灌进底层 persistence / shared 基础设施
- 先保证 owner 边界正确，再实现交互
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果本轮改动触发已有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 9. 任务完成后的处理

本文档属于一次性执行单。  
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
