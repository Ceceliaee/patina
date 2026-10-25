# 架构验收修正单：前端 Legacy Lib 提取收口

Document Type: One-off Review Fix Plan

## 1. 背景

上一轮 [`docs/archive/frontend-legacy-lib-extraction-execution-plan.md`](frontend-legacy-lib-extraction-execution-plan.md) 已经完成了主要迁移：

- `classificationPersistence` 已建立
- `sessionReadRepository` / `sessionReadCompiler` 已建立
- `historyReadModelService` 已接到 shared 新入口
- `sessionCompiler.ts` 已降级为兼容转发

但验收时发现两处仍需要收口的问题。

## 2. 本轮目标

只修复以下两个验收问题，不扩展新的架构重构：

- `sessionReadRepository` 与 `sessionReadCompiler` 的职责重复
- `classificationService` 的公开类型仍直接绑定 legacy `src/lib/settings.ts`

## 3. 本轮范围

只允许修改这些相关文件：

- `src/shared/lib/sessionReadRepository.ts`
- `src/shared/lib/sessionReadCompiler.ts`
- `src/shared/lib/historyReadModelService.ts`
- `src/shared/lib/classificationPersistence.ts`
- `src/features/classification/services/classificationService.ts`

必要时可补类型导出，但不扩展到新的目录迁移。

## 4. 执行项

### 问题 A：读层与编译层职责重复

现状：

- `src/shared/lib/sessionReadRepository.ts` 读取 sessions 后已经按 `ProcessMapper.shouldTrack(...)` 做过滤
- [`src/shared/lib/sessionReadCompiler.ts`](../../src/shared/lib/sessionReadCompiler.ts) 又再次执行相同的 tracking 判定

目标：

- 明确“谁负责读、谁负责编译”
- 避免同一业务规则在两个 shared 基础设施里各写一份

建议方向：

- `sessionReadRepository` 只负责读与最小必要的数据规范化
- `sessionReadCompiler` 负责 read model 语义上的追踪筛选、归并、展示名解析

执行要求：

- [x] 将 tracking 过滤规则收口到单一位置
- [x] `sessionReadRepository` 不再承接重复的 read-model 业务判定
- [x] `historyReadModelService` 仍能通过新 shared 主路径正常工作

### 问题 B：classification public contract 泄漏 legacy 类型来源

现状：

- [`src/features/classification/services/classificationService.ts`](../../src/features/classification/services/classificationService.ts) 仍直接从 `src/lib/settings.ts` 引 `ObservedAppCandidate`

目标：

- 让 `classification` 的公开类型通过新的 persistence/shared 边界暴露
- 不再让 feature service 对 legacy store 模块保留直接类型耦合

执行要求：

- [x] 在 `src/shared/lib/classificationPersistence.ts` 导出 `ObservedAppCandidate`
- [x] `classificationService.ts` 改为从新边界导入该类型
- [x] 不改变现有 feature API 语义

## 5. 验收门槛

- [x] `sessionReadRepository` 与 `sessionReadCompiler` 的职责边界不再重复
- [x] tracking 判定逻辑只保留单一主路径
- [x] `classificationService` 不再直接从 `src/lib/settings.ts` 获取 `ObservedAppCandidate`
- [x] `npm run build` 通过
- [x] 如有联动影响，`cargo check` 通过（本次无联动影响）

## 6. 文档处理

- [x] 更新本修正单勾选状态
- [x] 修正完成后，将本文件移入 `docs/archive/`

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限制在本修正单列出的两个问题内
- 不继续扩展前端或 Rust 架构重构
- 不调整 UI
- 完成后运行 `npm run build`
- 如有联动影响，再补跑 `cargo check`
