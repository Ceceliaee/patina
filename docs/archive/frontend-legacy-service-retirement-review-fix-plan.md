# 架构验收修正单：前端 Legacy Service 退场补漏

Document Type: One-off Review Fix Plan

## 1. 背景

上一轮 [`docs/archive/frontend-legacy-service-retirement-execution-plan.md`](frontend-legacy-service-retirement-execution-plan.md) 已完成主要迁移：

- `SettingsService.ts`
- `TrackingService.ts`
- `sessionCompiler.ts`
- `TitleCleaner.ts`
- `trackingLifecycle.ts`

这些 legacy 壳与错位 helper 已基本退场，新的 helper 落点也已建立：

- [`src/shared/lib/windowTitleCleaner.ts`](../../src/shared/lib/windowTitleCleaner.ts)
- `src/shared/lib/trackingWindowLifecycle.ts`
- `src/types/tracking.ts`

但验收时发现 3 个未闭环问题，因此本轮只做补漏，不扩展新的架构重构。

## 2. 本轮目标

只修复以下 3 个验收问题：

- 测试入口仍残留旧路径 import
- `npm test` 的 Node ESM 解析链路未恢复
- `windowTitleCleaner.ts` 仍残留 mojibake

本轮完成后，应满足：

- `npm run build` 通过
- `npm test` 通过
- `npm run test:replay` 通过
- 本轮触及的 `.ts` 文件不再新增或保留明显 mojibake

## 3. 本轮范围

只允许修改与本次补漏直接相关的文件。

优先涉及：

- [`tests/trackingLifecycle.test.ts`](../../tests/trackingLifecycle.test.ts)
- [`tests/trackingReplay.test.ts`](../../tests/trackingReplay.test.ts)
- [`src/shared/lib/windowTitleCleaner.ts`](../../src/shared/lib/windowTitleCleaner.ts)
- `src/lib/categoryColorRegistry.ts`
- `src/shared/lib/historyReadModelService.ts`

必要时允许补改与测试链路直接相关的 import 文件，但不要扩大到新的目录迁移或功能重构。

## 4. 非目标

- 不改 UI
- 不重写 `ProcessMapper`
- 不继续做新的 `src/lib/*` 清理
- 不扩展 Rust data/domain 重构
- 不顺手重排全仓 import 风格
- 不改数据库 schema

## 5. 执行项

### 问题 A：测试入口仍引用已删除的旧服务路径

现状：

- [`tests/trackingLifecycle.test.ts`](../../tests/trackingLifecycle.test.ts) 仍在引用已不存在的 `src/lib/services/HistoryService.ts`
- [`tests/trackingReplay.test.ts`](../../tests/trackingReplay.test.ts) 也仍在引用同一路径

目标：

- 让测试入口切到当前真实主路径，而不是继续依赖已删除的 legacy service

执行要求：

- [x] 复查 `rg -n "HistoryService\\.ts|HistoryService" tests src`
- [x] 将两个测试文件改为引用当前有效的读模型入口
- [x] 若名称已从 `HistoryService` 演进为 `HistoryReadModelService`，测试应同步更新命名，而不是再补一个 legacy compatibility 壳回去

验收门槛：

- [x] `tests/` 中不再 import 已删除的 `src/lib/services/HistoryService.ts`
- [x] 不为迁就测试而重新引入 legacy service 文件

### 问题 B：Node `--experimental-strip-types` 链路下仍有 import 解析失败

现状：

- `npm test` 当前会在 `src/lib/categoryColorRegistry.ts` 处触发 `ERR_MODULE_NOT_FOUND`
- 根因是当前测试运行方式对 extensionless ESM import 更敏感，至少本次失败链路中的 `categoryTokens` 引用未正确解析

目标：

- 在不做全仓 import 风格重排的前提下，修复当前测试依赖链上的解析失败点

执行要求：

- [x] 只沿 `npm test` / `npm run test:replay` 实际失败链路修复必要 import
- [x] 优先修复触发失败的 extensionless import，例如 `categoryTokens`
- [x] 若修完一个点后测试继续暴露同链路其他解析点，继续沿失败链路最小修补，直到两个测试脚本都恢复通过
- [x] 不把本轮扩大成“全仓统一加 .ts 后缀”

验收门槛：

- [x] `npm test` 通过
- [x] `npm run test:replay` 通过
- [x] 本轮对 import 的修改保持在最小范围

### 问题 C：`windowTitleCleaner.ts` 仍残留 mojibake

现状：

- [`src/shared/lib/windowTitleCleaner.ts`](../../src/shared/lib/windowTitleCleaner.ts) 中仍有明显乱码正则
- 这与上一轮“先修编码问题再迁移”的目标不一致

目标：

- 真正修复编码或改写为等价且可读的规则表达
- 保留原有标题清洗意图，不因为修编码而 silently 降级行为

执行要求：

- [x] 先修复 `windowTitleCleaner.ts` 的 mojibake，再继续修改其他相关逻辑
- [x] 若原始中文词面已不可可靠恢复，可用更稳妥、可读的等价规则替代，但需保持行为意图清楚
- [x] 检查本轮触及的测试样例中是否也存在同类 mojibake；若有，按最小范围一并修复

验收门槛：

- [x] `windowTitleCleaner.ts` 中不再保留明显 mojibake 片段
- [x] 本轮触及的测试与 helper 文件编码可读

## 6. 完成定义

满足以下条件，才算本轮完成：

- [x] 两个测试入口已切到当前有效主路径
- [x] `npm run build` 通过
- [x] `npm test` 通过
- [x] `npm run test:replay` 通过
- [x] `windowTitleCleaner.ts` 已无明显 mojibake
- [x] 如本轮未触发 Tauri 联动改动，则无需补跑 `cargo check`

## 7. 文档处理

- [x] 更新本修正单勾选状态
- [x] 本轮若只是在补验收问题，默认不改 [`docs/architecture-target.md`](architecture-target.md)，除非现有状态描述已被事实证伪
- [x] 修正完成并验收通过后，将本文件移入 `docs/archive/`

## 8. 给 GPT-5.3-Codex 的执行要求

- 严格限制在本修正单列出的 3 个问题内
- 不继续扩展前端或 Rust 架构重构
- 不调整 UI
- 优先恢复测试入口与测试链路，再处理 helper 编码补漏
- 完成后至少运行：
  - `npm run build`
  - `npm test`
  - `npm run test:replay`
- 若改动意外影响到 Tauri 联动，再补跑 `cargo check`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md) 与 [`docs/architecture-target.md`](architecture-target.md)
