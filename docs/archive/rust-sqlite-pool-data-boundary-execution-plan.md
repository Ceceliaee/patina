# 架构执行单：Rust SQLite Pool / Data Boundary 收口

Document Type: One-off Execution Plan

## 1. 目标

本轮目标是继续推进 [`docs/architecture-target.md`](architecture-target.md) 的阶段 4，但范围只收 Rust 运行时里还挂在 `app` 层的一段底层数据库能力：

- [`src-tauri/src/app/runtime.rs`](../../src-tauri/src/app/runtime.rs) 中的 sqlite pool 获取逻辑
- `sqlite:timetracker.db` 这类 DB 入口常量

本轮完成后，希望达到：

- sqlite pool 的定位与等待逻辑回到 `data` 层，而不是继续挂在 `app/runtime.rs`
- `engine/tracking_runtime.rs`、`data/backup.rs`、`app/tray.rs` 不再反向依赖 `app/runtime.rs` 获取数据库连接
- `app/runtime.rs` 只保留应用编排、启动协调、autostart / tray / runtime restart 相关职责
- `lib.rs` 中的 sqlite plugin DB 标识与 `data` 层使用同一来源，避免继续散落常量

## 2. 为什么先做这一轮

上一轮已经完成了：

- Rust `settings` 读边界进入 `data/repositories/app_settings.rs`
- Rust tracking runtime 主链的 session / tracker settings / icon cache 读写下沉到 `data/repositories/*`
- `app/tray.rs` 中 `tracking_paused` 的 settings 直连收口

但当前仍有一个明显的基础设施职责错位：

- [`app/runtime.rs`](../../src-tauri/src/app/runtime.rs) 仍然拥有 `wait_for_sqlite_pool(...)`
- [`data/backup.rs`](../../src-tauri/src/data/backup.rs) 和 `src-tauri/src/engine/tracking_runtime.rs` 还要反向依赖 `app/runtime.rs`
- `sqlite:timetracker.db` 这个 DB 入口字符串同时影响 `lib.rs` plugin 装配和运行时 pool 查找，但目前没有清晰的单一来源

这意味着：

- `app` 层还在承接数据基础设施，而不是只做应用编排
- `data` 虽然已经有 repositories，但“如何拿到 DB pool” 这件事还没真正归位
- 后续如果继续扩展数据职责，很容易继续从 `app/runtime.rs` 借基础设施

这是一个小范围但高价值的阶段 4 补口，适合继续推进 Rust `app / data` 边界。

## 3. 本轮范围

只处理 Rust sqlite pool / DB 入口常量的 `app -> data` 边界收口，不扩展新的前端改造，也不重新打开 tracking runtime 主链重构。

重点涉及文件：

- `src-tauri/src/app/runtime.rs`
- `src-tauri/src/app/tray.rs`
- `src-tauri/src/data/backup.rs`
- `src-tauri/src/engine/tracking_runtime.rs`
- `src-tauri/src/data/mod.rs`
- `src-tauri/src/lib.rs`

建议新增落点：

- `src-tauri/src/data/sqlite_pool.rs`

允许少量连带调整：

- `src-tauri/src/commands/backup.rs`
- 受本轮影响的 Rust 单元测试
- [`docs/architecture-target.md`](architecture-target.md)

## 4. 非目标

- 不继续拆 `tracking_runtime.rs` 的业务逻辑
- 不新增一整套通用 repository/service 框架
- 不改动 Tauri 命令协议
- 不重做 backup 业务路径
- 不调整前端任何代码
- 不顺手整理 tray 文案、事件名或 runtime health 语义

## 5. 执行阶段

### 阶段 A：把 sqlite pool 基础设施移入 `data`

目标：

- 让 sqlite pool 获取能力从 `app/runtime.rs` 退回 `data`

建议落点：

- `src-tauri/src/data/sqlite_pool.rs`

建议承接职责：

- DB URL / DB name 常量，例如 `sqlite:timetracker.db`
- `wait_for_sqlite_pool(...)`
- 与 `tauri_plugin_sql::DbInstances` / `DbPool` 相关的底层等待逻辑

执行项：

- [x] 新增 `src-tauri/src/data/sqlite_pool.rs`
- [x] `src-tauri/src/data/mod.rs` 暴露该模块
- [x] 将 `wait_for_sqlite_pool(...)` 从 `app/runtime.rs` 迁出到 `data/sqlite_pool.rs`
- [x] 将 sqlite DB 入口常量收口到 `data` 层单一来源
- [x] 阶段 A 完成后运行 `cargo check`

验收门槛：

- [x] `app/runtime.rs` 不再定义 `wait_for_sqlite_pool(...)`
- [x] `data/sqlite_pool.rs` 成为 sqlite pool 获取逻辑的单一来源

### 阶段 B：更新调用方，消除对 `app/runtime.rs` 的基础设施反向依赖

目标：

- 让真正需要 DB pool 的模块直接依赖 `data`，而不是经由 `app/runtime.rs`

重点调用方：

- [`src-tauri/src/data/backup.rs`](../../src-tauri/src/data/backup.rs)
- `src-tauri/src/engine/tracking_runtime.rs`
- [`src-tauri/src/app/tray.rs`](../../src-tauri/src/app/tray.rs)
- [`src-tauri/src/app/runtime.rs`](../../src-tauri/src/app/runtime.rs)

执行项：

- [x] 上述调用方改为依赖 `data::sqlite_pool::wait_for_sqlite_pool(...)`
- [x] `app/runtime.rs` 仅保留 `now_ms`、autostart、desktop behavior sync、runtime orchestration
- [x] 如合适，`lib.rs` 的 sqlite plugin 装配也改为复用 `data` 层的 DB 常量
- [x] 阶段 B 完成后运行 `cargo check`

验收门槛：

- [x] `data/backup.rs` 与 `engine/tracking_runtime.rs` 不再 import `app::runtime::wait_for_sqlite_pool`
- [x] `lib.rs` 与 `data/sqlite_pool.rs` 不再维护两份独立 DB 标识字符串

### 阶段 C：验证 app/data 边界没有回流

目标：

- 确保这次下沉没有让 `app` 层重新吸收数据基础设施，且现有主路径保持通过

执行项：

- [x] 复查 `src-tauri/src/app/` 下是否还残留类似“供 data/engine 调用的 DB 基础设施 helper”
- [x] 如本轮改动影响 tracking runtime 或 backup 相关测试，补跑对应 `cargo test`
- [x] 阶段 C 完成后运行 `cargo check`

建议优先补跑：

- [x] `cargo test tracking_runtime --lib`

如 backup 相关测试存在且被影响，再补跑对应测试；如果当前仓库没有现成 backup 单测入口，可不额外扩展。

验收门槛：

- [x] `app/runtime.rs` 更像纯 app orchestration 文件
- [x] `data` 层开始承接“如何拿到 DB pool”这类基础设施职责

### 阶段 D：文档同步

执行项：

- [x] 更新本执行单勾选状态
- [x] 根据实际结果同步更新 [`docs/architecture-target.md`](architecture-target.md) 中阶段 4 的状态描述
- [x] 任务完成并验收通过后，将本文件移入 `docs/archive/`

## 6. 完成定义

满足以下条件，才算本轮完成：

- [x] `data/sqlite_pool.rs` 已建立并承接 sqlite pool 获取逻辑
- [x] `app/runtime.rs` 不再承接 sqlite pool 基础设施
- [x] `data/backup.rs`、`engine/tracking_runtime.rs`、`app/tray.rs` 已改为依赖 `data` 层 pool helper
- [x] `lib.rs` 与运行时 pool 查找共用单一 DB 标识来源
- [x] `cargo check` 通过
- [x] 如相关主路径受影响，`cargo test tracking_runtime --lib` 通过
- [x] `npm run build` 通过

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限定在 Rust sqlite pool / DB 入口常量的 `app -> data` 边界收口范围内
- 不扩展到新的前端重构
- 不继续拆 tracking runtime 业务逻辑
- 优先建立真实基础设施边界，不优先制造新的抽象层
- 每完成一个阶段，更新文档勾选状态并运行 `cargo check`
- 如果本轮改动影响 tracking runtime 相关测试，再补跑 `cargo test tracking_runtime --lib`
- 全部完成后再运行一次 `npm run build`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md) 与 [`docs/architecture-target.md`](architecture-target.md)

## 8. 任务完成后的处理

本文件属于一次性执行单。
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
