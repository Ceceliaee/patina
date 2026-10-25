# 修正执行单：Rust Tray Menu Encoding Fix

Document Type: One-off Review Fix Plan

## 1. 背景

上一轮 `tray / tracker settings repository` 收口的主体已经通过：

- `tracking_paused` 的读写已统一进入 `tracker_settings` repository
- `app/tray.rs` 已退出 `settings` 表直连 SQL
- `cargo check`、`cargo test tracking_runtime --lib`、`npm run build` 都通过

但验收时发现一个阻塞问题：

- [`src-tauri/src/app/tray.rs`](../../src-tauri/src/app/tray.rs) 中 3 条托盘菜单文案仍是实际 mojibake，而不是终端显示假象

因此这轮只处理编码修复，不扩展新的架构收口。

## 2. 本轮目标

把 [`src-tauri/src/app/tray.rs`](../../src-tauri/src/app/tray.rs) 中 3 条托盘菜单文案修回可读的 UTF-8 中文，并确保文件在修改后仍保持正常 UTF-8 编码。

建议修正为：

- `打开主界面`
- `暂停/恢复追踪`
- `退出应用`

## 3. 本轮范围

只处理以下问题：

- `app/tray.rs` 中 3 条菜单文案的乱码修复
- 必要的最小校验
- 本修正单的勾选与归档

只涉及文件：

- `src-tauri/src/app/tray.rs`
- `docs/archive/rust-tray-menu-encoding-review-fix-plan.md`（完成后归档）

## 4. 非目标

- 不继续改动 `tracker_settings.rs`
- 不继续扩展 Rust `app / data / domain` 收口
- 不更新 `docs/architecture-target.md`
- 不顺手修改 tray 菜单交互或窗口行为
- 不扩展前端重构

## 5. 执行阶段

### 阶段 A：修复 tray 菜单文案乱码

执行项：

- [x] 将 `app/tray.rs` 中 3 条 mojibake 菜单文案改为可读 UTF-8 中文
- [x] 不改动其他逻辑、事件、ID、行为
- [x] 如终端显示异常，按字节或实际文件内容确认编码，不要误把终端乱码当作文件损坏

验收门槛：

- [x] [`src-tauri/src/app/tray.rs`](../../src-tauri/src/app/tray.rs) 中不再出现 `鎵撳紑` / `鏆傚仠` / `閫€鍑` 这类损坏字符串
- [x] 菜单文案恢复为可读中文

### 阶段 B：最小校验

执行项：

- [x] 运行 `cargo check`
- [x] 运行 `npm run build`

验收门槛：

- [x] `cargo check` 通过
- [x] `npm run build` 通过

### 阶段 C：文档收尾

执行项：

- [x] 更新本修正单勾选状态
- [x] 任务完成并验收通过后，将本文件移入 `docs/archive/`

## 6. 完成定义

满足以下条件，才算本轮完成：

- [x] `app/tray.rs` 中 3 条菜单文案已恢复为可读 UTF-8 中文
- [x] `cargo check` 通过
- [x] `npm run build` 通过

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限定在 `app/tray.rs` 菜单文案乱码修复范围内
- 不扩展新的 Rust 架构改造
- 不顺手修改其他中文文本
- 保持文件为 UTF-8；若终端显示乱码，以文件实际字节和内容为准判断
- 完成后更新文档勾选状态，并在验收通过后归档到 `docs/archive/`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md) 与 [`docs/architecture-target.md`](architecture-target.md)
