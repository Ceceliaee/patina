# 架构执行单：前端 Legacy Service 退场与低层 Helper 归位

Document Type: One-off Execution Plan

## 1. 目标

本轮目标是继续推进 [`docs/architecture-target.md`](architecture-target.md) 的阶段 4，在前端已完成 facade / runtime adapter / core store / DB 边界收口之后，把 `src/lib/services/*` 中剩余的 legacy 兼容壳与错位 helper 再收一轮。

重点文件：

- `src/lib/services/SettingsService.ts`
- `src/lib/services/TrackingService.ts`
- `src/lib/services/sessionCompiler.ts`
- `src/lib/services/TitleCleaner.ts`
- `src/lib/services/trackingLifecycle.ts`
- [`src/shared/lib/sessionReadCompiler.ts`](../../src/shared/lib/sessionReadCompiler.ts)
- `src/types/tracking.ts`

本轮完成后，希望达到：

- 已无主路径消费者的 legacy service 壳被删除或降到最小兼容层
- 仍然需要保留的底层 helper 不再挂在模糊的 `src/lib/services/*` 命名下
- 跟踪类型与纯函数 helper 的落点更符合真实职责
- 前端阶段 4 剩余遗留点进一步减少，`src/lib/*` 不再保留空心 compatibility 文件

## 2. 为什么先做这一轮

前几轮已经完成了：

- 前端 facade 与持久化边界收口
- runtime / adapter 细粒度拆分
- `classificationPersistence`
- `sessionReadRepository / sessionReadCompiler`
- `settings-store / classification-store`
- `db.ts` adapter 化

当前剩余的前端遗留里，最小但最容易拖延的一块是 `src/lib/services/*`：

- `SettingsService` / `TrackingService` / `sessionCompiler` 已经是 legacy compatibility 壳，但仍然留在仓库里
- `TitleCleaner` 是纯 helper，却仍挂在 `services` 名下
- `trackingLifecycle` 同时承载纯函数和类型定义，但当前主要只剩类型侧引用
- `TitleCleaner.ts` 内已可见 mojibake 文本，继续在其上叠改动风险较高

这类文件继续保留，会让后续人误以为它们仍是可扩展主路径入口。

## 3. 本轮范围

只处理前端 legacy service 退场与低层 helper 落点归位，不扩展新的 Rust 重构。

允许新增落点：

- `src/shared/lib/*`
- `src/types/*`
- `src/lib/*` 下更清楚命名的低层 helper 文件
- 必要的 `src/app/services/*` 纯运行时落点

## 4. 非目标

- 不改 UI
- 不重写 `ProcessMapper`
- 不重做 `settings-store` / `classification-store`
- 不修改数据库 schema
- 不顺手扩大到新的 Rust data/domain 重构
- 不为了目录整齐做大规模搬迁

## 5. 执行阶段

### 阶段 A：退场已空心化的 legacy compatibility service

目标：

- 把已经没有主路径消费者的 legacy service 壳真正退场

当前观察：

- `src` 主路径里已看不到对 `SettingsService` / `TrackingService` / `sessionCompiler` 的有效 import
- 这三个文件已更像过渡残留，而不是仍有价值的边界

执行项：

- [x] 复查 `rg -n "SettingsService|TrackingService|sessionCompiler" src tests`
- [x] 若确认 `SettingsService.ts` 无有效消费者，直接删除；若发现边缘调用，则降为最小 compatibility barrel
- [x] 若确认 `TrackingService.ts` 无有效消费者，直接删除；若发现边缘调用，则降为最小 compatibility barrel
- [x] 若确认 `sessionCompiler.ts` 无有效消费者，直接删除；若发现边缘调用，则降为最小 compatibility barrel
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] `src` 主路径不再依赖上述 legacy service 壳
- [x] `src/lib/services/*` 中不再保留“无人使用但看起来还能继续扩写”的兼容文件

### 阶段 B：归位仍有价值的底层 helper 与类型

目标：

- 把仍在使用的纯 helper / 共享类型移到更符合职责的位置

建议方向：

- `TitleCleaner.ts`
  - 先修复编码问题
  - 再迁到更清楚的 low-level helper 落点，例如 `src/shared/lib/windowTitleCleaner.ts` 或等价命名
- `trackingLifecycle.ts`
  - 若只剩 `TrackedWindow` 类型仍被消费，则把类型并回 `src/types/tracking.ts`
  - 若纯函数仍有调用者，则迁到更清楚的 runtime/helper 落点，而不是继续挂在 generic `services` 目录

执行项：

- [x] 先检查 `TitleCleaner.ts` 是否存在 mojibake；若存在，先修复编码后再继续编辑
- [x] 将 `cleanWindowTitle` 迁到更清楚的 helper 文件，并更新 [`src/shared/lib/sessionReadCompiler.ts`](../../src/shared/lib/sessionReadCompiler.ts) 的引用
- [x] 评估 `trackingLifecycle.ts` 的纯函数是否仍有有效调用者
- [x] 若 `trackingLifecycle.ts` 仅剩类型用途，则把 `TrackedWindow` 类型收口到 `src/types/tracking.ts` 并删除原文件
- [x] 若 `trackingLifecycle.ts` 中部分纯函数仍需保留，则迁到更清楚的 low-level/runtime helper 文件，并让类型定义不再从 `src/lib/services/*` 反向导出
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] [`src/shared/lib/sessionReadCompiler.ts`](../../src/shared/lib/sessionReadCompiler.ts) 不再从 `src/lib/services/*` import `TitleCleaner`
- [x] `src/types/tracking.ts` 不再依赖 `src/lib/services/trackingLifecycle.ts`
- [x] 本轮触及的 `.ts` 文件中不再引入新的 mojibake

### 阶段 C：收紧 `src/lib/services/*` 的长期角色

目标：

- 让 `src/lib/services/*` 不再同时混着 compatibility 壳、纯 helper、类型来源和运行时边界

执行项：

- [x] 复查 `Get-ChildItem src/lib/services` 结果
- [x] 删除阶段 A/B 后产生的低价值空文件或仅剩单行转发的遗留文件
- [x] 若某个文件必须临时保留，在文件头增加简短注释，说明其仅为 low-level / legacy compatibility，不作为新逻辑默认入口
- [x] 根据实际结果更新 [`docs/architecture-target.md`](architecture-target.md) 中阶段 4 的状态描述
- [x] 阶段 C 完成后运行 `npm run build`

验收门槛：

- [x] `src/lib/services/*` 中剩余文件的职责是清楚的
- [x] 前端主路径不再回流到 legacy service 壳
- [x] `architecture-target.md` 已反映本轮完成后的剩余遗留项

### 阶段 D：文档与归档

执行项：

- [x] 更新本执行单勾选状态
- [x] 任务完成并验收通过后，将本文件移入 `docs/archive/`

## 6. 完成定义

满足以下条件，才算本轮完成：

- [x] `SettingsService.ts` / `TrackingService.ts` / `sessionCompiler.ts` 已被删除或降到最小兼容层
- [x] `TitleCleaner` 已迁到更清楚的 helper 落点，且编码正常
- [x] `TrackedWindow` 类型与 `trackingLifecycle` 的纯函数职责已分清
- [x] `src/lib/services/*` 不再保留空心 legacy service 壳
- [x] `npm run build` 通过
- [x] 如改动影响到 Tauri 联动，再补跑 `cargo check`（本轮未触发 Tauri 联动改动，无需补跑）

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限定在“前端 legacy service 退场与低层 helper 归位”范围内
- 不扩展新的 Rust 架构改造
- 不调整 UI
- 优先删除空心 compatibility 壳，再归位仍有价值的 helper
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果改动影响到 Tauri 联动，再补跑 `cargo check`
- 工作区当前可能已有未提交改动；不要回退无关修改，只处理本轮触及文件
- 同时遵循 [`AGENTS.md`](../../AGENTS.md) 与 [`docs/architecture-target.md`](architecture-target.md)

## 8. 任务完成后的处理

本文件属于一次性执行单。
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
