# 架构执行单：Rust Tray / Tracker Settings Repository 边界收口

Document Type: One-off Execution Plan

## 1. 目标

本轮目标是继续推进 [`docs/architecture-target.md`](architecture-target.md) 的阶段 4，但范围只收 Rust `app` 层里残留的一处 settings 直连：

- [`src-tauri/src/app/tray.rs`](../../src-tauri/src/app/tray.rs)

本轮完成后，期望达到：

- `app/tray.rs` 不再直接执行 `settings` 表 SQL
- `tracking_paused` 的读取与写入统一收口到 [`src-tauri/src/data/repositories/tracker_settings.rs`](../../src-tauri/src/data/repositories/tracker_settings.rs)
- `app` 层只保留 tray 交互、运行时编排、事件触发
- Rust 阶段 4 再向“app / engine / data / domain` 职责更清楚”推进一小步，而不是继续把 settings 细节留在壳层

## 2. 为什么先做这一轮

上一轮已经完成了 tracking runtime 主链的 `engine / data / domain` 收口：

- `domain/tracking.rs` 已建立
- `tracking_runtime.rs` 中的 session / icon cache / tracker settings 主路径已下沉到 `data/repositories/*`

但当前仍有一个明显残余：

- [`src-tauri/src/app/tray.rs`](../../src-tauri/src/app/tray.rs) 里还保留了 `tracking_paused` 的本地 SQL 读写 helper
- 同时 [`src-tauri/src/data/repositories/tracker_settings.rs`](../../src-tauri/src/data/repositories/tracker_settings.rs) 已经承接了同一张 `settings` 表中与 tracker runtime 相关的其他 key

这意味着当前存在：

- 同一类 tracker settings 被分散在 `app` 与 `data/repositories` 两处
- `tracking_paused` 读路径虽然已经在 runtime 主链进入 repository，但写路径仍留在 tray 壳层
- `app/tray.rs` 同时承担 UI 行为和底层持久化细节，不符合长期目标

这是一个小范围但高价值的补口，适合在不扩展新重构主题的前提下继续推进阶段 4。

## 3. 本轮范围

只处理 Rust `tray / tracker settings repository` 边界收口，不扩展新的前端改造，也不重新打开 tracking runtime 主链重构。

重点涉及文件：

- `src-tauri/src/app/tray.rs`
- `src-tauri/src/data/repositories/tracker_settings.rs`
- `src-tauri/src/data/repositories/mod.rs`

允许少量连带调整：

- `src-tauri/src/app/runtime.rs`
- 与本轮相关的 Rust 单元测试
- [`docs/architecture-target.md`](architecture-target.md)

## 4. 非目标

- 不继续拆 `tracking_runtime.rs`
- 不重做 `app_settings.rs` 或通用 settings repository 体系
- 不扩展新的前端执行项
- 不顺手重构 tray 菜单文案、窗口行为或 UI 交互
- 不为了一次性“完全去 SQL”而改动 backup / restore / migration 链路

## 5. 执行阶段

### 阶段 A：把 `tracking_paused` 写边界并回 `tracker_settings`

目标：

- 让 `tracking_paused` 的读写都在 `tracker_settings.rs` 闭环

建议做法：

- 在 [`tracker_settings.rs`](../../src-tauri/src/data/repositories/tracker_settings.rs) 中补齐 `save_tracking_paused_setting(...)`
- 复用现有 `save_setting_value(...)`，不要在 `app/tray.rs` 再保留重复 SQL

执行项：

- [x] `tracker_settings.rs` 新增或暴露 `save_tracking_paused_setting(...)`
- [x] `tracking_paused` 对应 key 常量只保留在 repository 边界
- [x] 阶段 A 完成后运行 `cargo check`

验收门槛：

- [x] `tracker_settings.rs` 成为 `tracking_paused` 持久化的单一来源
- [x] `app/tray.rs` 不再声明自己的 `TRACKING_PAUSED_KEY`

### 阶段 B：让 `app/tray.rs` 退回编排角色

目标：

- `app/tray.rs` 只负责菜单事件、状态切换编排与 runtime event 发射

建议做法：

- 删除 `app/tray.rs` 内部的 `load_tracking_paused_setting(...)` / `save_tracking_paused_setting(...)`
- `toggle_tracking_paused(...)` 改为直接调用 `tracker_settings` repository
- 保持 `emit_tracking_data_changed(...)` 仍在 tray 编排层触发，不把事件责任下沉到 repository

执行项：

- [x] `app/tray.rs` 删除本地 SQL helper
- [x] `toggle_tracking_paused(...)` 改为调用 `tracker_settings::{load_tracking_paused_setting, save_tracking_paused_setting}`
- [x] `app/tray.rs` 仅保留 tray UI 行为、runtime 协调、错误日志与事件发射
- [x] 阶段 B 完成后运行 `cargo check`

验收门槛：

- [x] `app/tray.rs` 中不再出现 `sqlx::query(...)`
- [x] `app/tray.rs` 明显更像 app orchestration 文件，而不是持久化实现文件

### 阶段 C：验证共享 repository 未影响 runtime 主链

目标：

- 因为 `tracker_settings.rs` 同时服务 `tracking_runtime.rs` 与 `tray.rs`，需要确认这次补口没有把共享底层边界改坏

执行项：

- [x] 如本轮改动触及 `tracker_settings.rs` 的公共接口，补跑 `cargo test tracking_runtime --lib`
- [x] 收口后复查 `src-tauri/src/app/` 下是否还残留对 `settings` 表的同类直连 SQL
- [x] 阶段 C 完成后运行 `cargo check`

验收门槛：

- [x] `tracking_runtime` 相关测试保持通过
- [x] `app/tray.rs` 不再是 Rust `app` 层里的 settings 表直连例外

### 阶段 D：文档同步

执行项：

- [x] 更新本执行单勾选状态
- [x] 根据实际结果同步更新 [`docs/architecture-target.md`](architecture-target.md) 中阶段 4 的状态描述
- [x] 任务完成并验收通过后，将本文件移入 `docs/archive/`

## 6. 完成定义

满足以下条件，才算本轮完成：

- [x] `tracker_settings.rs` 已承接 `tracking_paused` 的完整读写边界
- [x] `app/tray.rs` 已删除本地 SQL helper
- [x] `app/tray.rs` 不再直接访问 `settings` 表
- [x] `cargo check` 通过
- [x] 如改动影响共享 repository 接口，`cargo test tracking_runtime --lib` 通过
- [x] `npm run build` 通过

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限定在 Rust `tray / tracker settings repository` 边界收口范围内
- 不扩展到新的前端重构
- 不顺手继续拆 `tracking_runtime.rs`
- 优先复用现有 `tracker_settings.rs`，不要再平行新建一个同类 repository
- 每完成一个阶段，更新文档勾选状态并运行 `cargo check`
- 如果本轮改动影响到 `tracker_settings.rs` 的共享接口或相关测试，再补跑 `cargo test tracking_runtime --lib`
- 全部完成后再运行一次 `npm run build`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md) 与 [`docs/architecture-target.md`](architecture-target.md)

## 8. 任务完成后的处理

本文件属于一次性执行单。
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
