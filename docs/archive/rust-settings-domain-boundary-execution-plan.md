# 架构执行单：Rust Settings / Domain 边界收口

Document Type: One-off Execution Plan

## 1. 目标

本轮目标是继续推进 [`docs/architecture-target.md`](architecture-target.md) 的阶段 4，把 Rust 侧“桌面行为 / 启动行为 / 设置存储”相关能力从当前的 `app/state + app/runtime + commands/settings` 混合状态，收口成更清楚的 `domain + data + app` 边界。

本轮完成后，理想状态应更接近：

- `domain` 承接桌面行为/启动行为的共享语义模型
- `data` 承接这些设置的读取与持久化边界
- `app` 只负责运行时状态同步与生命周期协调
- `commands/settings.rs` 继续保持薄，不再直接承接更多状态语义

## 2. 为什么先做这一轮

Rust 侧目前已经完成了：

- 入口与 runtime 装配收口
- `backup` 的 `data/domain` 第一块基础骨架

但“设置/桌面行为”这一块仍然偏混：

- [`src-tauri/src/app/state.rs`](../../src-tauri/src/app/state.rs) 同时定义了：
  - `CloseBehavior`
  - `MinimizeBehavior`
  - `DesktopBehaviorSettings`
  - `DesktopBehaviorState`
  - 若干 parse 辅助函数
- [`src-tauri/src/app/runtime.rs`](../../src-tauri/src/app/runtime.rs) 还在直接处理这些设置的读取与同步
- [`src-tauri/src/commands/settings.rs`](../../src-tauri/src/commands/settings.rs) 虽然已经不厚，但仍是围绕 app state 的直接入口

这意味着：

- `domain/settings` 仍是空白
- `data/repositories` 还没有覆盖“设置存储”这条核心链路
- 后续如果继续扩展桌面行为、启动策略、更多 runtime settings，很容易继续堆回 `app/*`

## 3. 本轮范围

只处理 Rust 侧 settings / desktop behavior / runtime state 相关边界，不扩展新的前端重构。

重点涉及文件：

- `src-tauri/src/app/state.rs`
- `src-tauri/src/app/runtime.rs`
- `src-tauri/src/commands/settings.rs`
- `src-tauri/src/data/mod.rs`
- `src-tauri/src/domain/mod.rs`

预计新增落点：

- `src-tauri/src/domain/settings.rs`
- `src-tauri/src/data/repositories/app_settings.rs`

如确有必要，可新增少量辅助模块，但必须围绕本轮主题。

## 4. 非目标

- 不重写 tracking engine
- 不调整 backup 链路
- 不扩展前端 runtime adapter
- 不一次性把所有 app state 都迁空
- 不为了完整 DDD 术语体系制造过重抽象

## 5. 执行阶段

### 阶段 A：提取 settings 领域模型到 `domain`

目标：

- 让桌面行为 / 启动行为的共享语义从 `app/state.rs` 中抽出来

建议迁出的内容：

- `CloseBehavior`
- `MinimizeBehavior`
- `DesktopBehaviorSettings`

建议落点：

- `src-tauri/src/domain/settings.rs`

执行项：

- [x] 新增 `src-tauri/src/domain/settings.rs`
- [x] `src-tauri/src/domain/mod.rs` 暴露 `settings`
- [x] `app/state.rs` 改为依赖 `domain::settings` 中的领域模型
- [x] 只保留 runtime state 本身和必要状态管理逻辑在 `app/state.rs`
- [x] 阶段 A 完成后已执行 `cargo check`

验收门槛：

- [x] `app/state.rs` 不再定义整套 settings 领域模型
- [x] `domain/settings.rs` 成为桌面行为语义的单一来源

### 阶段 B：建立 settings repository，收口设置读写边界

目标：

- 把 runtime 中针对桌面行为 / 启动设置的读取逻辑收口到 `data/repositories`

建议落点：

- `src-tauri/src/data/repositories/app_settings.rs`

建议承接的职责：

- 读取 close / minimize / launch settings
- 解析布尔值与行为值
- 返回 `domain::settings::DesktopBehaviorSettings`

执行项：

- [x] 新增 `data/repositories/app_settings.rs`
- [x] `data/repositories/mod.rs` 暴露该模块
- [x] `app/runtime.rs` 改为通过 repository 读取设置，而不是自己拼装/解析
- [x] 若已有 parse helper 更适合跟随领域模型或 repository，一并收口
- [x] 阶段 B 完成后已执行 `cargo check`

验收门槛：

- [x] `app/runtime.rs` 不再直接承担桌面行为设置解析细节
- [x] settings 存储读取边界进入 `data/repositories`

### 阶段 C：瘦身 `app/state` 与 `commands/settings`

目标：

- `app/state.rs` 更像纯 runtime state
- `commands/settings.rs` 更像命令入口，而不是状态语义中心

执行项：

- [x] 让 `app/state.rs` 只保留状态容器与更新逻辑
- [x] 让 `commands/settings.rs` 继续保持薄，避免引入新的 parse / domain 逻辑
- [x] 如有必要，在 `app/runtime.rs` 或小型 app service 中承接同步行为，但不要回流到 command
- [x] 阶段 C 完成后已执行 `cargo check`

验收门槛：

- [x] `commands/settings.rs` 没有变厚
- [x] `app/state.rs` 边界更清楚
- [x] `app/runtime.rs` / `data/repositories` / `domain/settings` 的职责分工可读

### 阶段 D：文档同步

执行项：

- [x] 更新本执行单勾选状态
- [x] 根据实际结果更新 [`docs/architecture-target.md`](architecture-target.md) 中阶段 4 的状态描述
- [x] 任务完成并验收通过后，将本文件移入 `docs/archive/`

## 6. 完成定义

满足以下条件，才算本轮完成：

- [x] `domain/settings.rs` 已建立并承接桌面行为领域模型
- [x] `data/repositories/app_settings.rs` 已建立并承接设置读取边界
- [x] `app/state.rs` 已明显瘦身为 runtime state 容器
- [x] `commands/settings.rs` 继续保持薄
- [x] `cargo check` 通过
- [x] `npm run build` 通过

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限定在 Rust settings / domain / repository 边界收口范围内
- 不扩展到新的前端重构
- 不做新的大规模目录革命
- 优先建立真实边界，不优先制造抽象
- 每完成一个阶段，更新文档勾选状态
- 每阶段至少运行 `cargo check`
- 全部完成后再运行一次 `npm run build`

## 8. 任务完成后的处理

本文件属于一次性执行单。
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
