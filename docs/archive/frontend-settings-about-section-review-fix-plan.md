# 修正单：Settings 发布信息迁移到关于区块
Document Type: One-off Review Fix Plan

## 1. 背景

当前 `Settings` 页中，`发布信息 / 当前版本 / 更新说明 / 问题反馈` 被放在 `数据安全` 区块内。

这会带来两个问题：

- 信息架构语义不准确：`数据安全` 应只承载备份、恢复、清理历史等数据操作
- `应用信息` 与 `数据操作` 混放，降低设置页扫读清晰度

从 Quiet Pro 的长期结构看，`发布信息` 更适合归到一个低噪音、信息型的 `关于` 区块，而不是继续留在 `数据安全` 中。

## 2. 本轮目标

只修复 `Settings` 页的信息架构：

- 将 `发布信息` 从 `数据安全` 区块移出
- 在同一页内新增或接入一个 `关于` 区块
- 保留 `当前版本 / 更新说明 / 问题反馈` 的现有行为

完成后应达到：

- `数据安全` 只保留与本地数据相关的操作
- `关于` 成为应用信息与发布入口的承载位置
- 不新增独立 About 页面
- 不改变备份、恢复、清理历史、链接打开等现有逻辑

## 3. 范围

重点文件：

- `src/features/settings/components/Settings.tsx`
- `src/lib/copy.ts`
- `src/App.css`

如确有必要，允许少量补充：

- `src/shared/components/QuietSubpanel.tsx`
- `src/shared/components/QuietActionRow.tsx`

## 4. 非目标

- 不新建独立 `About` 页面
- 不扩展到 `App Mapping / Dashboard / History`
- 不改备份、恢复、清理逻辑
- 不改 `openUrl(...)` 目标链接
- 不扩展到 Rust / Tauri
- 不重做整页布局

## 5. 核心要求

### 5.1 信息架构修正

- `数据安全` 区块内只保留：
  - 备份
  - 恢复
  - 清理历史
- `发布信息` 不再出现在 `数据安全` 下

### 5.2 关于区块

- 在 `Settings` 页内新增或接入一个 `关于` 区块
- 该区块应承载：
  - 当前版本
  - 更新说明
  - 问题反馈
- `关于` 区块视觉权重应低于高风险数据操作区

### 5.3 Quiet Pro 要求

- `关于` 区块应保持 Quiet Pro 的低噪音信息感
- 更像“应用信息面板”，而不是“操作工作台”
- 保持克制，不要做成醒目的品牌卡片

### 5.4 行为保持不变

- `当前版本` 继续显示当前 `appVersion`
- `更新说明` 继续打开 GitHub Releases
- `问题反馈` 继续打开 GitHub Issues
- 不改变保存/取消、脏状态、toast 等其他设置页行为

## 6. 执行阶段

### 阶段 A：调整区块结构

执行项：

- [x] 从 `数据安全` 中移出 `发布信息`
- [x] 在 `Settings` 页增加 `关于` 区块
- [x] `关于` 区块与现有设置区块保持一致的 Quiet Pro 面板节奏
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] `数据安全` 语义收正
- [x] `关于` 区块位置清楚、不会喧宾夺主

### 阶段 B：整理文案与样式

执行项：

- [x] 将 `发布信息` 文案调整为更适合 `关于` 语义的命名
- [x] 必要时补充 `关于` 区块标题或说明文案
- [x] 复核按钮样式与区块层级，确保符合 Quiet Pro
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] 文案语义与区块语义一致
- [x] 信息面板与危险/数据操作面板层级分离清楚

### 阶段 C：收尾

执行项：

- [x] 复核 `更新说明 / 问题反馈` 链接行为未变
- [x] 更新本文档勾选状态
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 7. 完成定义

- [x] `发布信息` 已完全移出 `数据安全`
- [x] `Settings` 页已有独立 `关于` 区块
- [x] `当前版本 / 更新说明 / 问题反馈` 仍可正常使用
- [x] `数据安全` 只承载数据安全相关操作
- [x] `npm run build` 通过
- [ ] 如受影响，`npm test` 通过

## 8. 给 GPT-5.3-Codex 的执行要求

- 严格限定在 `Settings` 页的信息架构调整
- 不要顺手做独立 About 页面
- 不要扩展到其他 feature
- 不要改数据逻辑与链接目标
- 保持 Quiet Pro 低噪音信息区风格
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 9. 任务完成后的处理

本文档属于一次性修正单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不长期留在顶层 `docs/`。
