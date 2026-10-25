# 架构执行单：前端 Core Store 边界收口

Document Type: One-off Execution Plan

## 1. 目标

本轮目标是继续推进 [`docs/architecture-target.md`](architecture-target.md) 的阶段 4，把前端遗留根层里最核心的两块底层存储能力真正压回“基础设施层”角色：

- `src/lib/settings.ts`
- `src/lib/db.ts`

本轮完成后，希望达成：

- `settings.ts` 更像底层 store/repository
- `db.ts` 更像底层 DB adapter
- feature 语义不再继续长在这两个文件里
- 前端主路径通过已经建立的 `shared/app/feature adapter` 消费这些底层能力

## 2. 为什么先做这一轮

前几轮已经完成了：

- 页面层与 runtime/service 边界收口
- `classificationPersistence`
- `sessionReadRepository / sessionReadCompiler`
- runtime / adapter 细粒度拆分

现在前端最大的遗留点不再是页面结构，而是：

- `src/lib/settings.ts` 里还混着分类、observed candidates、settings store、session 清理等多类语义
- `src/lib/db.ts` 还带着 read-model 过滤语义和历史兼容逻辑

如果不继续收口，这两个文件很容易再次成为“反向吸积层”。

## 3. 本轮范围

只处理前端 core store / DB 边界收口，不扩展新的 Rust 重构。

重点涉及文件：

- `src/lib/settings.ts`
- `src/lib/db.ts`
- `src/shared/lib/settingsPersistenceAdapter.ts`
- `src/shared/lib/classificationPersistence.ts`
- `src/shared/lib/sessionReadRepository.ts`
- `src/app/services/*`
- `src/features/settings/services/*`
- `src/features/classification/services/*`

允许新增：

- `src/shared/lib/*`
- `src/lib/*` 下少量更清楚命名的底层文件

## 4. 非目标

- 不重写 UI
- 不重写 `ProcessMapper`
- 不重做 `TrackingService`
- 不一次性迁空全部 `src/lib/*`
- 不改数据库 schema

## 5. 执行阶段

### 阶段 A：拆分 `settings.ts` 的底层职责

目标：

- 让 `settings.ts` 不再继续同时承接太多 feature 语义

建议拆分方向：

- `settingsStore` / `settingsRepository`
  - 纯设置键值读写
  - tracker health 时间戳
  - 通用 settings 访问
- `classificationStore`
  - app override
  - category color override
  - custom/deleted category
  - observed app candidate 读取与删除

落点建议：

- 若能直接拆到 `src/lib/settings-store.ts` / `src/lib/classification-store.ts`，可以接受
- 也可以采用等价命名，但必须表达“底层 store/repository”职责

执行项：

- [x] 从 `settings.ts` 中拆出“通用设置存储”与“分类相关存储”两块
- [x] `settingsPersistenceAdapter` 改为只接 settings store
- [x] `classificationPersistence` 改为只接 classification store
- [x] 保证旧 `settings.ts` 若暂时保留，不再是主路径默认实现入口

验收门槛：

- [x] `settings.ts` 不再继续承接完整 feature 语义合集
- [x] settings 与 classification 的底层存储职责分开
- [x] `shared` adapter 已切到更清晰的底层文件

### 阶段 B：拆分 `db.ts` 的 DB adapter 与 read-model 兼容逻辑

目标：

- 让 `db.ts` 回到更纯的 DB adapter 角色

当前问题：

- `src/lib/db.ts` 里仍有 read-model 过滤语义和 `ProcessMapper` 相关判断

建议方向：

- `db.ts` 只保留 `getDB()` 及最小数据库接入能力
- session/read-model 相关只读查询和过滤逻辑继续落在 `sessionReadRepository` / `sessionReadCompiler`

执行项：

- [x] 清理 `db.ts` 中与 read model / ProcessMapper 直接相关的兼容逻辑
- [x] 若某些历史兼容查询仍需要，迁到更清楚的 shared read 层
- [x] 为 `db.ts` 添加清晰职责注释，表明其仅为底层 DB adapter

验收门槛：

- [x] `db.ts` 不再继续承担 read-model 语义
- [x] read/query 逻辑主路径留在 `shared/lib/sessionReadRepository.ts`

### 阶段 C：收紧旧入口与命名

目标：

- 防止旧根层文件继续被当成“默认入口”

执行项：

- [x] 复查 `rg -n "from \\\".*lib/settings|from \\\".*lib/db" src`
- [x] 删除阶段 A/B 后的低价值旧直连
- [x] 如旧文件仍保留，增加简短注释说明：legacy / low-level only / not for new feature logic

验收门槛：

- [x] 新主路径优先走 adapter / store 边界，而不是重新回到 `settings.ts` / `db.ts`
- [x] 旧根层文件角色更清楚，不再继续膨胀

### 阶段 D：文档同步

执行项：

- [x] 更新本执行单勾选状态
- [x] 根据实际结果更新 [`docs/architecture-target.md`](architecture-target.md) 中阶段 4 的状态描述
- [x] 任务完成并验收通过后，将本文件移入 `docs/archive/`

## 6. 完成定义

满足以下条件，才算本轮完成：

- [x] `settings.ts` 的通用设置与 classification 相关存储职责已拆开
- [x] `db.ts` 已退回到底层 DB adapter 角色
- [x] `settingsPersistenceAdapter` / `classificationPersistence` / `sessionReadRepository` 已接到更清楚的底层边界
- [x] 新主路径没有继续回流到旧根层万能文件
- [x] `npm run build` 通过
- [x] 如有联动影响，`cargo check` 通过（本轮未涉及 Tauri 联动改动，无需补跑）

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限定在前端 core store / DB 边界收口范围内
- 不扩展新的 Rust 重构
- 不调整 UI
- 优先收口职责，不优先搬目录
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果改动影响到 Tauri 联动，再补跑 `cargo check`

## 8. 任务完成后的处理

本文件属于一次性执行单。
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
