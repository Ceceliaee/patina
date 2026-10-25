# 架构执行单：Rust Tracking Runtime Data / Domain 边界收口

Document Type: One-off Execution Plan

## 1. 目标

本轮目标是继续推进 [`docs/architecture-target.md`](architecture-target.md) 的阶段 4，把 Rust 侧目前最厚、最混杂的一条核心链路真正压回清晰边界：

- `src-tauri/src/engine/tracking_runtime.rs`

本轮完成后，希望达成：

- `engine/tracking_runtime.rs` 更接近运行时编排层，而不是继续同时承接 SQL、存储键解析、icon cache 写入、session 事务细节、领域结构
- `data/repositories/*` 开始承接 tracking runtime 主路径里的真实读写边界，而不只服务 backup
- `domain/` 开始承接 tracking 相关共享语义与 DTO，而不只停留在 `backup` / `settings`
- `commands/*` 继续保持薄，不需要为这轮改动回胖

## 2. 为什么先做这一轮

前几轮已经完成了：

- Rust 入口与 runtime 装配收口
- `backup` 的 `data/domain` 第一轮基础骨架
- `settings / desktop behavior` 的 `domain + repository` 收口
- 前端阶段 4 的多轮基础设施去耦

当前最明显的 Rust 遗留，已经不在 `commands/*`，而是在 `src-tauri/src/engine/tracking_runtime.rs`：

- 文件同时定义 runtime health、事件 payload、窗口切换决策、部分存储结构
- 文件里仍有大段 `sqlx` 查询与更新
- settings key 读取、session sealing、metadata refresh、icon cache 写入都直接混在 engine 内
- 这会让 `data/` 和 `domain/` 虽然已经起步，但还没有真正吃下 tracking 主链

如果不先收这一块，Rust 阶段 4 的“data/domain 不再空心化”就很难继续往前推进。

## 3. 本轮范围

只处理 Rust tracking runtime 主链的 `engine / data / domain` 边界收口，不扩展新的前端重构。

重点涉及文件：

- `src-tauri/src/engine/tracking_runtime.rs`
- `src-tauri/src/data/repositories/sessions.rs`
- `src-tauri/src/data/repositories/settings.rs`
- `src-tauri/src/data/repositories/icon_cache.rs`
- `src-tauri/src/data/repositories/mod.rs`
- `src-tauri/src/domain/mod.rs`

允许新增：

- `src-tauri/src/domain/tracking.rs`
- `src-tauri/src/data/repositories/tracker_settings.rs`
- 少量围绕 tracking runtime 的辅助模块，但必须表达清楚 `data` 或 `domain` 职责

## 4. 非目标

- 不重写 Windows foreground/platform 实现
- 不重做前端 tracking runtime gateway
- 不改变 Tauri 事件名或前后端协议语义
- 不一次性拆空整个 `engine/tracking_runtime.rs`
- 不顺手扩展到 backup 或 settings 的第二轮大重构

## 5. 执行阶段

### 阶段 A：提取 tracking 领域语义到 `domain`

目标：

- 把 tracking runtime 中真正具有共享语义的结构，从 engine 文件中提出来

建议优先评估迁出：

- `TrackingDataChangedPayload`
- `WindowTransitionDecision`
- `WindowSessionIdentity`
- 其他明显不应长期留在 engine 文件头部的 tracking 语义结构

建议落点：

- `src-tauri/src/domain/tracking.rs`

执行项：

- [x] 新增 `src-tauri/src/domain/tracking.rs`
- [x] `src-tauri/src/domain/mod.rs` 暴露 `tracking`
- [x] `tracking_runtime.rs` 改为依赖 `domain::tracking::*`
- [x] 仅保留纯 engine 私有、且明显不需要共享的内部结构在 `tracking_runtime.rs`
- [x] 阶段 A 完成后运行 `cargo check`

验收门槛：

- [x] `tracking_runtime.rs` 文件头不再同时定义一串 tracking 领域结构
- [x] `domain/` 开始承接 tracking 真实语义，而不只是 backup/settings

### 阶段 B：把 tracking runtime 的数据库访问下沉到 repositories

目标：

- 让 engine 不再直接写大段 SQL

建议方向：

- `sessions.rs`
  - `load_active_session`
  - `end_active_sessions`
  - `refresh_active_session_metadata`
  - `start_session`
  - `normalize_closed_session_durations`
- `icon_cache.rs`
  - icon 是否已缓存
  - icon upsert
- `tracker_settings.rs` 或扩展 `settings.rs`
  - `tracking_paused`
  - `afk_timeout_secs`
  - tracker heartbeat / sample timestamps
  - capture-title override 读取
  - startup self-heal marker 读写

执行项：

- [x] 将 session 相关 SQL 从 `tracking_runtime.rs` 迁入 `data/repositories/sessions.rs`
- [x] 将 icon cache 相关 SQL 从 `tracking_runtime.rs` 迁入 `data/repositories/icon_cache.rs`
- [x] 为 tracker settings 建立清晰的 repository 边界，避免 engine 继续直连 settings 表
- [x] `tracking_runtime.rs` 改为调用 repositories，而不是直接执行 `sqlx::query(...)`
- [x] 阶段 B 完成后运行 `cargo check`

验收门槛：

- [x] `tracking_runtime.rs` 不再承接主要表级 SQL 细节
- [x] tracking runtime 依赖的数据库读写已有清晰 repository 落点

### 阶段 C：把 `tracking_runtime.rs` 收口成 orchestration + platform coordination

目标：

- 让 engine 文件主要保留：
  - poll / watch 主循环
  - 调用 platform 获取窗口状态
  - 组合领域决策与 repository 调用
  - 发事件

不再继续承担：

- settings key 解析细节
- 表级 SQL
- icon cache 存储细节
- 大量领域结构定义

执行项：

- [x] 收口 `run(...)` / `watch(...)` / `handle_power_lifecycle_event(...)` 周边依赖
- [x] 清理 engine 中已迁出的 SQL helper、settings helper、icon helper
- [x] 保留必要的 runtime health 与平台交互逻辑在 engine 层
- [x] 若本轮改动触及现有 Rust 单元测试，同步更新测试入口与依赖
- [x] 阶段 C 完成后运行 `cargo check`

验收门槛：

- [x] `tracking_runtime.rs` 更像 orchestration 文件而不是万能实现文件
- [x] 改动后 `commands/tracking.rs` 没有回胖
- [x] `app/runtime.rs` 不需要吸收原本属于 repository/domain 的细节

### 阶段 D：验证与文档同步

执行项：

- [x] 更新本执行单勾选状态
- [x] 根据实际结果更新 [`docs/architecture-target.md`](architecture-target.md) 中阶段 4 的状态描述
- [x] 任务完成并验收通过后，将本文件移入 `docs/archive/`

## 6. 完成定义

满足以下条件，才算本轮完成：

- [x] `domain/tracking.rs` 已建立并承接 tracking 共享语义
- [x] tracking runtime 依赖的 session/settings/icon cache 读写已进入 `data/repositories`
- [x] `tracking_runtime.rs` 已明显收口为 orchestration 层
- [x] `cargo check` 通过
- [x] 如 tracking_runtime 相关单测受影响，相关 `cargo test` 通过
- [x] `npm run build` 通过

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限定在 Rust tracking runtime 的 `engine / data / domain` 边界收口范围内
- 不扩展到新的前端重构
- 不改变现有前后端协议语义
- 优先下沉 SQL 与 tracking 共享语义，不优先做目录表演
- 每完成一个阶段，更新文档勾选状态并运行 `cargo check`
- 若改动影响到 tracking runtime 相关单元测试，补跑对应 `cargo test`
- 全部完成后再运行一次 `npm run build`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md) 与 [`docs/architecture-target.md`](architecture-target.md)

## 8. 任务完成后的处理

本文件属于一次性执行单。
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
