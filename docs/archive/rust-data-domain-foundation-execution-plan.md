# 架构执行单：Rust Data / Domain 基础骨架收口

Document Type: One-off Execution Plan

## 1. 目标

本轮目标是推进 [`docs/architecture-target.md`](architecture-target.md) 中的“阶段 4：数据与领域边界深化”。

重点不是再做一轮目录美化，而是让 Rust 侧真正开始具备：

- `data/` 负责数据访问与持久化边界
- `domain/` 负责备份/恢复相关的共享语义模型与 DTO
- `backup` 流程不再把 SQL、领域结构、文件序列化、兼容性判断全部塞进同一文件

## 2. 为什么先做这一轮

当前 Rust 结构虽然已经完成了入口、命令、运行时的大收口，但还存在一个典型问题：

- [`src-tauri/src/data/backup.rs`](../../src-tauri/src/data/backup.rs) 同时承担了：
  - 备份 payload 结构定义
  - 兼容性判断
  - 文件路径/文件 IO
  - SQL 查询
  - 恢复事务编排
  - 测试

这会导致：

- `data/` 还没有真正形成“仓储 + 持久化边界”
- `domain/` 仍基本空心化
- 后续如果继续扩展备份、导出导入、仓储、DTO，会再次把单文件做胖

所以这轮的目标是：用最小但正确的骨架，把 `backup` 这条链路做成 `data + domain` 的第一块样板。

## 3. 本轮范围

只处理 Rust 侧 `backup / repositories / domain DTO` 相关收口，不扩展到新的前端重构。

重点涉及文件：

- `src-tauri/src/data/backup.rs`
- `src-tauri/src/data/mod.rs`
- `src-tauri/src/domain/mod.rs`
- `src-tauri/src/commands/backup.rs`

预计新增落点：

- `src-tauri/src/domain/backup.rs`
- `src-tauri/src/data/repositories/mod.rs`
- `src-tauri/src/data/repositories/sessions.rs`
- `src-tauri/src/data/repositories/settings.rs`
- `src-tauri/src/data/repositories/icon_cache.rs`

如果实现过程中发现需要少量辅助文件，可以新增，但必须保持边界清晰。

## 4. 非目标

- 不重写整套 tracking 引擎
- 不重做 Tauri command 注册方式
- 不大规模改 `app/runtime`
- 不动前端 UI 或 feature 结构
- 不为了“DDD 完整”引入过重抽象

## 5. 执行阶段

### 阶段 A：提取备份相关领域模型到 `domain`

目标：

- 把 `backup` 相关的共享结构从 `data/backup.rs` 中提出来
- 让 `domain/` 不再空心化

建议落点：

- `src-tauri/src/domain/backup.rs`

建议迁出的类型：

- `BackupMeta`
- `BackupSession`
- `BackupSetting`
- `BackupIconCache`
- `BackupPayload`
- `BackupPreview`

可选：

- 如果兼容性结果结构合适，也可抽成领域语义类型，而不是继续用多个裸返回值

执行项：

- [x] 新增 `src-tauri/src/domain/backup.rs`
- [x] `src-tauri/src/domain/mod.rs` 暴露 `backup`
- [x] `src-tauri/src/data/backup.rs` 改为使用 `domain::backup::*`
- [x] 相关测试同步改到新类型入口
- [x] 阶段 A 完成后已执行 `cargo check`

验收门槛：

- [x] `data/backup.rs` 不再定义整套备份 DTO
- [x] `domain/` 开始承接真实共享语义，而不是继续空壳

### 阶段 B：建立 `data/repositories` 的第一批仓储边界

目标：

- 把 `backup` 用到的数据查询/恢复写入逻辑从单文件中拆到 `repositories`

建议落点：

- `src-tauri/src/data/repositories/mod.rs`
- `src-tauri/src/data/repositories/sessions.rs`
- `src-tauri/src/data/repositories/settings.rs`
- `src-tauri/src/data/repositories/icon_cache.rs`

这些仓储至少应承接：

- 导出时读取所有会话
- 导出时读取所有设置
- 导出时读取 icon cache
- 恢复时清空并写回对应数据

执行项：

- [x] 新增 `data/repositories` 模块
- [x] 将 `sessions` 相关 SQL 迁到 `repositories/sessions.rs`
- [x] 将 `settings` 相关 SQL 迁到 `repositories/settings.rs`
- [x] 将 `icon_cache` 相关 SQL 迁到 `repositories/icon_cache.rs`
- [x] `data/backup.rs` 改为通过 repositories 获取/写回数据，而不是直接写大段 SQL
- [x] 阶段 B 完成后已执行 `cargo check`

验收门槛：

- [x] `data/backup.rs` 不再直接承担大段表级 SQL 细节
- [x] 仓储命名和职责按表/数据边界清楚划分

### 阶段 C：把 `data/backup.rs` 收口成编排层

目标：

- 让 `data/backup.rs` 只负责：
  - 文件路径与文件 IO
  - 备份兼容性判断
  - 调用 repositories 组装 payload
  - 调用 repositories 执行恢复事务

不再负责：

- 定义所有 DTO
- 直接承载大段表级 SQL

执行项：

- [x] 收口 `load_backup_payload(...)`
- [x] 收口 `restore_backup_payload(...)`
- [x] 保留必要的文件编解码和路径逻辑
- [x] 若兼容性判断仍显混乱，提炼成更清楚的内部辅助函数或语义结构
- [x] 阶段 C 完成后已执行 `cargo check`

验收门槛：

- [x] `data/backup.rs` 主要变成 backup orchestration 文件
- [x] 文件长度和职责明显收缩
- [x] `commands/backup.rs` 保持薄，不发生回胖

### 阶段 D：文档同步

执行项：

- [x] 更新本执行单勾选状态
- [x] 在 [`docs/architecture-target.md`](architecture-target.md) 中把“阶段 4”更新为更准确的当前状态
- [x] 如果本轮完成后该执行单已无后续用途，归档到 `docs/archive/`

## 6. 完成定义

满足以下条件，才算本轮完成：

- [x] `domain/backup.rs` 已建立并承接备份相关 DTO / 语义结构
- [x] `data/repositories/*` 已建立并承接 `sessions / settings / icon_cache` 的备份读写边界
- [x] `data/backup.rs` 已明显收口为编排层
- [x] `commands/backup.rs` 没有回胖
- [x] `cargo check` 通过
- [x] `npm run build` 通过

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限定在 Rust `data/domain` 基础骨架收口范围内
- 不扩展前端重构
- 不做新的大规模目录革命
- 优先建立真实边界，不优先制造抽象
- 每完成一个阶段，更新文档勾选状态
- 每阶段至少跑 `cargo check`
- 全部完成后再跑一次 `npm run build`

## 8. 任务完成后的处理

本文件属于一次性执行单。
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
