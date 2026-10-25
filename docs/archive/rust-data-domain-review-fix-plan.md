# 架构验收修正单：Rust Data / Domain 文案编码修复

Document Type: One-off Review Fix Plan

## 1. 背景

上一轮 [`docs/archive/rust-data-domain-foundation-execution-plan.md`](rust-data-domain-foundation-execution-plan.md) 的结构性目标基本成立：

- `domain/backup.rs` 已建立
- `data/repositories/*` 已建立
- `data/backup.rs` 已从“SQL + DTO + 编排混合体”收口为以编排为主的文件

但验收时发现一个阻塞问题：

- [`src-tauri/src/data/backup.rs`](../../src-tauri/src/data/backup.rs) 中备份兼容性提示文案出现乱码

这会直接影响用户看到的备份预览与恢复失败提示，因此必须修掉后才能判定本轮完全通过。

## 2. 本轮目标

只修复备份兼容性提示字符串的编码/内容问题，不扩展任何新的架构重构。

## 3. 本轮范围

只允许修改以下相关内容：

- `src-tauri/src/data/backup.rs`
- 如确有必要，可调整与其直接相关的测试或文档状态

不允许：

- 新增目录迁移
- 继续拆模块
- 调整前端
- 扩大到其他 Rust 文件

## 4. 执行项

### 问题 A：修复备份兼容性提示乱码

现象位置：

- `src-tauri/src/data/backup.rs:136`（归档时行号）
- `src-tauri/src/data/backup.rs:147`（归档时行号）
- `src-tauri/src/data/backup.rs:158`（归档时行号）
- `src-tauri/src/data/backup.rs:167`（归档时行号）

执行要求：

- [x] 把 mojibake 文案恢复成正常可读中文
- [x] 文案语义保持不变：
  - 备份版本过高时提示需升级应用
  - 备份版本较旧时提示按兼容模式恢复
  - schema 版本过高时提示需升级应用
  - 兼容时提示可直接恢复
- [x] 保持文件为 UTF-8
- [x] 不通过危险的 shell 重定向方式改写 markdown 或源码文本

建议恢复后的文案语义：

- `备份格式版本 {x} 高于当前支持的 {y}，请升级应用后再恢复。`
- `备份格式版本 {x} 低于当前版本 {y}，将按兼容模式尝试恢复。`
- `备份 schema 版本 {x} 高于当前支持的 {y}，请升级应用后再恢复。`
- `当前版本可直接恢复该备份。`

## 5. 验收门槛

- [x] `src-tauri/src/data/backup.rs` 中不再出现乱码提示
- [x] 备份预览与恢复错误消息可正常返回前端
- [x] `cargo check` 通过
- [x] `npm run build` 通过

## 6. 文档处理

- [x] 更新本修正单勾选状态
- [x] 若修正完成，本文件归档到 `docs/archive/`

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限制在本修正单列出的乱码问题内
- 不继续扩展 data/domain 重构
- 保持 UTF-8 文本可读性
- 完成后运行 `cargo check` 与 `npm run build`
