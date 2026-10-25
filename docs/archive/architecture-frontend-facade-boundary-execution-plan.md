# 架构执行单：前端 Facade 与持久化边界收口

Document Type: One-off Execution Plan

## 1. 目标

本轮目标是继续推进 [`docs/architecture-target.md`](architecture-target.md) 中“阶段 2（前端状态与服务边界收口）”，把前端主路径上仍然直接依赖根层基础设施的部分进一步收口。

本轮完成后，前端新增代码应更接近以下边界：

- 页面组件默认不直接依赖 `src/lib/ProcessMapper.ts`
- 页面组件默认不直接依赖 `src/lib/services/SettingsService.ts`
- `ProcessMapper` 更接近运行时基础设施，只保留在 `app` 初始化链路和 `classification` 写入链路中
- `SettingsService` 更接近持久化适配器，而不是继续充当前端页面层的直接入口

## 2. 为什么先做这一轮

上一轮已经完成了：

- `AppShell` / `Dashboard` / `History` 的 feature 主路径归位
- `useWindowTracking`、`settingsPageService`、`classificationService` 的第一轮边界收口
- `ProcessMapper` 首次初始化下沉到 `app/runtime`

但当前仍有两个明显的遗留问题：

- 多个页面和格式化层仍直接读取 `ProcessMapper`
- `SettingsService` 仍承担过多“页面可直接调用的万能服务”角色

这两点不收掉，前端阶段 2 很难算真正完成。

## 3. 本轮范围

本轮只处理前端边界，不扩展到新的 Rust 架构重构。

优先落点：

- `src/shared/lib/*`
- `src/features/*/services/*`
- `src/app/services/*`

重点涉及文件：

- `src/app/AppShell.tsx`
- `src/features/dashboard/components/Dashboard.tsx`
- `src/features/dashboard/services/dashboardFormatting.ts`
- `src/features/history/components/History.tsx`
- `src/shared/lib/historyReadModelService.ts`
- `src/lib/services/sessionCompiler.ts`
- `src/features/classification/services/classificationService.ts`
- `src/features/settings/services/settingsPageService.ts`

## 4. 非目标

- 不重写 `ProcessMapper` 的内部实现
- 不重做设置存储结构
- 不改数据库 schema
- 不做新的 UI 重构
- 不为了目录整齐搬迁无收益文件

## 5. 执行阶段

### 阶段 A：建立共享只读 Facade，收掉页面对 `ProcessMapper` 的直连

目标：

- 在 `shared` 层建立只读分类/展示 Facade
- 让 `Dashboard`、`History`、`AppShell`、共享格式化逻辑优先通过 Facade 读取分类与覆盖信息

建议落点：

- `src/shared/lib/appClassificationFacade.ts`

Facade 至少应承接这些只读能力：

- `mapApp(...)`
- `getCategoryLabel(...)`
- `getCategoryColor(...)`
- `getUserOverride(...)`
- `shouldTrackApp(...)`

执行项：

- [x] 新增共享只读 Facade 文件
- [x] `src/app/AppShell.tsx` 改为消费 Facade，而不是直接 import `ProcessMapper`
- [x] `src/features/dashboard/components/Dashboard.tsx` 改为消费 Facade
- [x] `src/features/dashboard/services/dashboardFormatting.ts` 改为消费 Facade
- [x] `src/features/history/components/History.tsx` 改为消费 Facade
- [x] `src/shared/lib/historyReadModelService.ts` 与 `src/lib/services/sessionCompiler.ts` 评估是否可切到 Facade；若影响过大，至少统一到同一只读入口（本轮保留 `sessionCompiler` 作为共享低层直接读取入口，避免 `lib -> shared` 逆向依赖）

验收门槛：

- [x] 页面组件主路径不再直接 import `ProcessMapper`
- [x] 共享只读语义集中到单一 Facade 入口
- [x] `classification` feature 仍保留写入权，不被误降级

### 阶段 B：把 `SettingsService` 明确收口为持久化适配层

目标：

- 让 feature service 调用带页面/业务语义的方法
- 逐步减少页面和 app runtime 对 `SettingsService` 具体方法集合的直接认知

建议方式：

- 保留 `SettingsService` 作为底层 persistence adapter
- 在 feature/app 层继续补充更高层的 facade/service，而不是让调用方直接横穿到底层

执行项：

- [x] 盘点 `SettingsService` 当前仍被哪些 app/feature 文件直接依赖
- [x] `src/app/services/appRuntimeBootstrapService.ts` 仅保留真正 runtime 级依赖
- [x] `src/app/services/processMapperRuntimeService.ts` 如需读取设置，保持只读取 runtime 初始化快照，不外露存储细节
- [x] `src/features/classification/services/classificationService.ts` 承接分类 feature 所需设置读写，不把页面细节继续泄漏回组件
- [x] `src/features/settings/services/settingsPageService.ts` 继续承接设置页页面语义，避免组件回退到直接找 `SettingsService`

验收门槛：

- [x] 页面组件不直接 import `SettingsService`
- [x] `SettingsService` 在前端中的角色更像 persistence adapter，而不是页面万能入口
- [x] app/runtime 与 feature/service 的调用边界更清晰

### 阶段 C：收紧导入规则，校正“谁能直接碰基础设施”

目标：

- 把前端对根层基础设施的直接依赖压缩到少数授权入口

本轮期望保留直接访问权的区域：

- `src/app/services/*`
- `src/features/classification/services/*`
- `src/features/settings/services/*`
- 必要的共享底层编译/读模型服务

执行项：

- [x] 复查 `rg -n "ProcessMapper|SettingsService" src` 结果
- [x] 删除阶段 A/B 迁移后残留的低价值直连 import
- [x] 若出现新的 Facade/Service 命名重复或语义重叠，顺手合并，避免新增“万能 util”

验收门槛：

- [x] `ProcessMapper` 的直接消费者缩到 runtime 初始化链路、分类 feature 服务层、必要共享底层
- [x] `SettingsService` 的直接消费者缩到 app/service 与 feature/service 层
- [x] 页面组件层不再直接接触这两个根层基础设施

### 阶段 D：文档状态同步

执行项：

- [x] 更新本执行单勾选状态
- [x] 根据实际结果更新 [`docs/architecture-target.md`](architecture-target.md) 中“阶段 2”的状态描述
- [x] 若本轮完成后执行单不再需要，任务完成后归档到 `docs/archive/`

## 6. 完成定义

满足以下条件，才算本轮完成：

- [x] `AppShell`、`Dashboard`、`History` 主路径已不直接 import `ProcessMapper`
- [x] 页面组件层已不直接 import `SettingsService`
- [x] 新增 Facade/Service 没有再次变成“万能中转层”
- [x] `npm run build` 通过
- [x] 如涉及 Rust 联调或类型影响，`cargo check` 也通过（本轮未触发 Tauri 联动变更，无需额外执行）

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限定在“前端 Facade 与持久化边界收口”范围内
- 不扩展到新的 Rust 结构重排
- 不顺手做 UI 调整
- 优先收口边界，不优先搬目录
- 每完成一个阶段，更新文档勾选状态，并运行 `npm run build`
- 若某阶段改动影响到 Tauri 命令或类型联动，再补跑 `cargo check`

## 8. 任务完成后的处理

本文件属于一次性执行单。
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
