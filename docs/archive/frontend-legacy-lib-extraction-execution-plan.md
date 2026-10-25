# 架构执行单：前端 Legacy Lib 基础设施提取

Document Type: One-off Execution Plan

## 1. 目标

本轮目标是继续推进 [`docs/architecture-target.md`](architecture-target.md) 中“阶段 4：数据与领域边界深化”的前端部分。

重点不是 UI，也不是目录表演，而是把 `src/lib/*` 中目前最模糊、最容易继续膨胀的两块遗留基础设施拆清：

- `classification` 持久化与 runtime 快照链路
- `history / dashboard` 的 session 读取与编译链路

本轮完成后，应实现：

- `classification` 不再主要通过 `SettingsService` 横穿到底层设置存储
- `historyReadModelService` 不再继续挂着 `src/lib/services/sessionCompiler.ts` 这种遗留路径
- `src/lib/settings.ts`、`src/lib/db.ts`、`src/lib/services/sessionCompiler.ts` 的职责边界更清楚

## 2. 为什么先做这一轮

当前前端页面层边界已经基本收口完成，但 `architecture-target.md` 里点名的这几处遗留还在：

- `src/lib/settings.ts`
- `src/lib/db.ts`
- `src/lib/services/sessionCompiler.ts`

这几处的问题不是“还能不能用”，而是：

- 它们仍在承接过多 feature 语义
- 依赖方向还不够干净
- 如果继续往里加逻辑，`src/lib/*` 会再次变成新的万能层

所以现在最值得做的是：

- 先把 `classification` 相关持久化接口从 `SettingsService` 侧抽成更清楚的 feature/shared 基础设施
- 再把 `history/dashboard` 使用的 session 编译链路从旧 `lib/services` 路径提出来

## 3. 本轮范围

只处理前端基础设施边界提取，不扩展新的 Rust 重构。

重点涉及文件：

- `src/lib/settings.ts`
- `src/lib/db.ts`
- `src/lib/services/SettingsService.ts`
- `src/lib/services/sessionCompiler.ts`
- `src/shared/lib/historyReadModelService.ts`
- `src/app/services/processMapperRuntimeService.ts`
- `src/features/classification/services/classificationService.ts`

允许新增：

- `src/shared/lib/*`
- `src/features/classification/services/*`
- 必要的 `types.ts`

## 4. 非目标

- 不重写 `ProcessMapper`
- 不改数据库 schema
- 不调整 UI
- 不重做 `TrackingService`
- 不把所有 `src/lib/*` 一次性迁空

## 5. 执行阶段

### 阶段 A：提取 classification 持久化边界

目标：

- 把分类相关持久化能力从通用 `SettingsService` 中分离出更清楚的边界
- 让 `classificationService` 与 `processMapperRuntimeService` 不再直接认知一长串零散设置方法

建议落点：

- `src/features/classification/services/classificationPersistence.ts`
  或
- `src/shared/lib/classificationPersistence.ts`

选择原则：

- 若能力明显服务于 `classification` feature，优先放 `features/classification/services`
- 若能力同时被 `classification` 与 `app/runtime` 稳定复用，可放 `shared/lib`

至少应承接：

- `loadAppOverrides`
- `saveAppOverride`
- `loadCategoryColorOverrides`
- `saveCategoryColorOverride`
- `loadCustomCategories`
- `saveCustomCategory`
- `deleteCustomCategory`
- `loadDeletedCategories`
- `saveDeletedCategory`
- `loadObservedAppCandidates`

执行项：

- [x] 建立 classification 持久化边界文件
- [x] `classificationService` 改为消费新的 persistence 层，而不是直接找 `SettingsService`
- [x] `processMapperRuntimeService` 改为通过新的 runtime snapshot 入口获取分类相关快照
- [x] 评估 `SettingsService` 中上述 classification 专属方法是否还能保留；若保留，也应退化为底层适配角色
- [x] 阶段 A 完成后已运行 `npm run build`

验收门槛：

- [x] `classificationService` 不再直接依赖 `SettingsService`
- [x] `processMapperRuntimeService` 不再拼装一长串 classification 专属设置读取
- [x] 分类相关持久化语义集中到单一边界入口

### 阶段 B：提取 session 编译链路到 shared 基础设施

目标：

- 把 `history/dashboard` 使用的 session 读取与编译链路从旧 `src/lib/services/sessionCompiler.ts` 路径提出来

当前问题：

- `src/shared/lib/historyReadModelService.ts` 还依赖旧路径 `src/lib/services/sessionCompiler.ts`
- `src/lib/db.ts` 仍混着查询与 feature 语义判断

建议落点：

- `src/shared/lib/sessionReadCompiler.ts`
- `src/shared/lib/sessionReadRepository.ts`

或在现有 shared 命名体系下使用等价文件名，但必须表达：

- 一个负责“读”
- 一个负责“编译/转换”

执行项：

- [x] 提取 session compiler 到 `shared/lib` 的正确落点
- [x] 评估并提取 `db.ts` 中服务于 read model 的只读查询能力
- [x] `historyReadModelService` 改为依赖新的 shared 基础设施入口
- [x] `dashboard` / `history` 链路不再通过旧 `src/lib/services/sessionCompiler.ts` 路径间接承接核心读模型逻辑
- [x] 阶段 B 完成后已运行 `npm run build`

验收门槛：

- [x] `historyReadModelService` 不再 import 旧 `src/lib/services/sessionCompiler.ts`
- [x] session 读取与 session 编译的职责分离更清楚
- [x] `src/lib/db.ts` 的角色更偏遗留底层，而不是继续承接读模型主路径

### 阶段 C：收紧 `SettingsService` 与 `src/lib/*` 的长期角色

目标：

- 让 `SettingsService` 和 `src/lib/*` 更明确地退到“底层适配/遗留基础设施”角色

执行项：

- [x] 复查 `rg -n "SettingsService|sessionCompiler|db.ts|settings.ts" src`
- [x] 删除阶段 A/B 完成后产生的低价值旧入口直连
- [x] 如有必要，为遗留入口加简短说明注释，表明其是底层/过渡角色，不再作为新逻辑默认入口
- [x] 阶段 C 完成后已运行 `npm run build`

验收门槛：

- [x] `SettingsService` 更接近底层 adapter
- [x] `src/lib/services/sessionCompiler.ts` 若仍保留，应不再是主路径；若已迁空，可删除
- [x] `src/lib/*` 没有继续新增新的 feature 语义

### 阶段 D：文档同步

执行项：

- [x] 更新本执行单勾选状态
- [x] 根据实际结果更新 [`docs/architecture-target.md`](architecture-target.md) 中“阶段 4”的状态描述
- [x] 任务完成并验收通过后，将本文件移入 `docs/archive/`

## 6. 完成定义

满足以下条件，才算本轮完成：

- [x] `classification` 持久化链路已从 `SettingsService` 直接依赖中抽出
- [x] `processMapperRuntimeService` 通过更清楚的分类 runtime snapshot 入口工作
- [x] `historyReadModelService` 已不再依赖旧 `src/lib/services/sessionCompiler.ts`
- [x] `src/lib/db.ts` / `src/lib/settings.ts` / `SettingsService` 的角色更清楚，未继续扩大
- [x] `npm run build` 通过
- [x] 如有 Tauri 联动影响，`cargo check` 通过（本轮未触发 Tauri 联动改动）

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限定在“前端 legacy lib 基础设施提取”范围内
- 不扩展到新的 Rust 重构
- 不顺手改 UI
- 优先收口职责，不优先搬目录
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果改动影响到 Tauri 侧类型或前后端联动，再补跑 `cargo check`

## 8. 任务完成后的处理

本文件属于一次性执行单。
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
