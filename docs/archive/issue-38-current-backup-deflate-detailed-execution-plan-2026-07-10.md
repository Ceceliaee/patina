# Issue #38 当前备份 Deflated 识别：详细可勾选执行方案

Refs [#38](https://github.com/Ceceliaee/patina/issues/38)

状态：已完成并归档

文档类型：How-to / 对抗式审查与执行方案

适用版本基线：Patina `1.8.2`

目标读者：Patina 维护者、代码审查者与后续执行代理

真实 owner：`src-tauri/src/data/backup` 与 `src-tauri/Cargo.toml` 中的 ZIP 解码能力

## 0. 一句话目标

让符合当前 `PatinaBackup` 契约的备份在内部 entry 路径和解压内容完全不变时，无论 ZIP entry 使用 `Stored` 还是标准 `Deflated`，都能被 Patina 正确预览与恢复；不得因此放宽备份结构、内容校验、版本校验，也不得把早期 Time Tracker 兼容代码重新加入主程序。

## 1. 明确范围

### 1.1 本方案必须解决

- [x] 当前格式 `PatinaBackup` 由 Patina 导出后，被常见压缩软件重新压缩为标准 ZIP Deflate，Patina仍能识别。
- [x] ZIP entry 的时间戳从默认时间改为压缩软件写入的时间后，识别结果不受影响。
- [x] Patina 自己生成的备份继续使用 `Stored`，不改变现有导出格式与导出性能特征。
- [x] 原有 `manifest.format`、固定 entry 路径、CRC32 内容校验、备份版本和 restore safety 校验全部保留。
- [x] 新行为具有自动化回归，能在以后依赖特性被误删时直接失败。
- [x] Changelog 关联具体 Issue #38，不关联 GitHub Project。

### 1.2 本方案明确不解决

- [x] 不兼容早期 `TimeTrackerBackup` 格式。
- [x] 不兼容旧式仅含 `backup.json` 的 ZIP。
- [x] 不从旧 `%APPDATA%\com.timetracker` 数据目录自动迁移。
- [x] 不把遗留用户迁移脚本、PowerShell 或 CMD 工具加入 Patina 安装包或运行时。
- [x] 不新增 CSV、SQLite 或 Parquet 导入功能。
- [x] 不把 ZIP 外包一层目录、重命名 entry 或缺失文件解释为“压缩方式兼容”。
- [x] 不关闭、评论、标记或改变 Issue #38 状态，除非维护者另行明确授权。

早期版本与遗留用户已经有独立迁移工具。本方案只修复当前备份格式的容器解码能力，两者不得混合。

## 2. 第一性原理

### 2.1 什么才是“有效备份”

一个可由 Patina 恢复的文件必须同时满足五层条件：

1. **文件层**：用户选择的路径存在，文件能够完整读取。
2. **容器层**：文件是合法 ZIP，使用应用明确支持的标准 compression method。
3. **结构层**：ZIP 根目录存在 `manifest.json`、`checksums.json` 和 manifest 声明的固定数据 entry。
4. **语义层**：`manifest.format == "PatinaBackup"`，JSON 可解析，entry 解压内容通过应用级 CRC32 校验。
5. **恢复层**：备份版本与 schema 处于当前 restore safety 支持范围，数据库恢复仍通过既有事务执行。

可把识别条件简化为：

```text
accepted = readable_file
        AND valid_zip
        AND supported_compression_method
        AND required_root_entries_present
        AND manifest_format_is_PatinaBackup
        AND entry_contents_match_checksums
        AND backup_version_is_supported
```

本问题只允许修改 `supported_compression_method`：从仅具备 Stored 解码能力，变为具备 Stored 与 Deflated 解码能力。其他条件必须保持不变。

### 2.2 为什么压缩方式不应决定业务有效性

`Stored` 与 `Deflated` 是 ZIP entry 的容器编码。只要解压后的 entry 名称和字节内容相同：

- manifest 语义相同；
- JSON 数据相同；
- 应用级 CRC32 相同；
- 恢复结果应相同。

因此，“同一当前格式备份只因 compression method 从 0 变为 8 就被拒绝”属于解码能力缺失，不属于备份格式不兼容。

### 2.3 为什么不能顺带兼容旧格式

旧 `TimeTrackerBackup` 与当前 `PatinaBackup` 的差异属于业务格式、字段和迁移边界，不只是 ZIP compression method。把二者混在一次修复中会产生三个问题：

- 把已经独立交付的迁移工具重新复制进长期运行时；
- 模糊当前备份契约，使恢复链路承担无限历史格式；
- 增加数据合并、冲突和回滚风险，超出 Deflate 缺陷的真实 owner。

所以本方案只支持“当前格式、容器重压”，不支持“旧格式、数据迁移”。

## 3. 可证伪假设

开始改代码前，必须分别验证以下假设，不能只根据错误提示猜测：

- [x] **H1：缺少 Deflate 解码后端。** `zip` 依赖关闭默认特性，且没有启用 `_deflate-any` 对应后端，因此方法编号 `8` 被解析为不支持。
- [x] **H2：业务代码显式限制 Stored。** 审查结果为否；读取逻辑没有检查 `CompressionMethod::Stored`，限制来自依赖编译特性。
- [x] **H3：时间戳必须是 1980-01-01。** 审查结果为否；读取和校验逻辑不使用 ZIP entry 时间戳。
- [x] **H4：压缩软件改变了内部目录。** 这是独立失败条件；根目录缺少固定 entry 时仍应拒绝。
- [x] **H5：用户文件实际是旧 Time Tracker 格式。** 这是独立兼容问题，应交给迁移工具，而不是由本修复放宽格式。
- [x] **H6：压缩软件改写了解压内容。** 应用级 checksum 会拒绝，不能为了导入成功绕过。

## 4. 对抗测试矩阵

| 编号 | 输入变量 | 应有结果 | 是否属于本方案 |
| --- | --- | --- | --- |
| M1 | 当前 `PatinaBackup` + Stored + 根目录结构不变 | 接受 | 是，正向基线 |
| M2 | 当前 `PatinaBackup` + Deflated + entry 名称和内容不变 | 接受 | 是，目标行为 |
| M3 | M2 + ZIP 时间戳改为当前日期 | 接受 | 是，排除时间戳误因 |
| M4 | 当前 `PatinaBackup` + 混合 Stored/Deflated | 底层支持两者时可读取 | 是，能力推论 |
| M5 | 当前格式 + entry 内容被改写 | 拒绝，checksum mismatch | 是，负向保护 |
| M6 | 当前格式 + 缺少必需 entry | 拒绝，指出缺少文件 | 是，负向保护 |
| M7 | 当前格式整体放进一个外层目录 | 拒绝，根目录无 manifest | 否，结构被改变 |
| M8 | `TimeTrackerBackup` + Stored | 拒绝，unsupported format | 否，交给迁移工具 |
| M9 | `TimeTrackerBackup` + Deflated | 拒绝，unsupported format | 否，交给迁移工具 |
| M10 | 旧 `backup.json` ZIP | 拒绝，不是当前结构化备份 | 否，交给迁移工具 |
| M11 | 纯 JSON 文件伪装成 ZIP | 拒绝 | 是，负向保护 |
| M12 | 加密 ZIP、Bzip2、XZ、Zstd 或 Deflate64 | 拒绝，未启用 | 否，不扩大格式面 |

## 5. 执行前检查

### 5.1 仓库与工作区

- [x] 确认工作目录为 Patina 仓库根目录。
- [x] 记录当前分支与 HEAD，不创建额外分支或 PR。
- [x] 运行 `git status --short`，识别并保护已有的 Project #1 未提交改动。
- [x] 不覆盖、不重置、不整理与 Issue #38 无关的用户改动。
- [x] 确认版本文件显示当前基线为 `1.8.2`。

### 5.2 长期规则

- [x] 阅读产品原则，确认本地备份可靠性属于核心数据安全范围。
- [x] 阅读架构文档，确认真实 owner 是 Rust `data/backup`，不是命令层、`lib.rs` 或前端页面。
- [x] 阅读稳定期修复守卫，选择“小范围 owner 内修复”，不引入兼容壳。
- [x] 阅读版本与发布规范，确认修复进入 `Unreleased / Fixed` 并关联 Issue #38。

### 5.3 基线代码

- [x] 确认导出器在 `encode_backup_archive` 中显式使用 `CompressionMethod::Stored`。
- [x] 确认读取入口是 `read_backup_payload`，预览和恢复共用该入口。
- [x] 确认 `decode_structured_backup_archive` 继续负责 manifest、entry 与 checksum 校验。
- [x] 确认现有测试已覆盖 Stored round-trip、缺失 entry、旧格式与事务回滚。
- [x] 确认当前没有 Deflated 回归测试。

## 6. 详细执行步骤

### 阶段 A：建立红灯证据

- [x] A1. 在 `src-tauri/src/data/backup/archive_tests.rs` 建立测试模块，使回归属于 archive owner，不继续膨胀 `backup.rs` 热点文件。
- [x] A2. 构造最小但合法的当前 `BackupPayload`，至少包含：
  - [x] 当前 backup version；
  - [x] 当前 schema version；
  - [x] 一条 session；
  - [x] 一条 setting；
  - [x] 其余当前格式集合字段为空数组。
- [x] A3. 使用生产 `encode_backup_archive` 生成 Stored 正向基线，避免测试手写出一个与生产格式漂移的 manifest。
- [x] A4. 逐条读取基线 ZIP entry，断言 compression method 为 `Stored`。
- [x] A5. 编写测试辅助函数：
  - [x] 顺序读取每个 entry；
  - [x] 保留原 entry 名称；
  - [x] 保留解压后的原始字节；
  - [x] 只把 compression method 改为 `Deflated`；
  - [x] 把 entry 时间戳改为 `2026-07-10 12:00:00`，排除 1980 时间戳假设。
- [x] A6. 逐条断言重压后的 entry 确实为 `Deflated`，避免测试实际上仍写出 Stored。
- [x] A7. 把重压结果写到系统临时目录，通过真实 `read_backup_payload(path)` 入口读取，而不是仅调用内部 JSON parser。
- [x] A8. 无论测试成功或失败，都尝试删除临时文件，避免污染用户备份目录。
- [x] A9. 在修改依赖前运行：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml structured_backup_archive_recompressed_with_deflate_still_decodes
```

- [x] A10. 记录预期红灯：`CompressionMethod::Deflated` 在当前构建中不存在，证明依赖没有编译 Deflate 能力。

### 阶段 B：确认根因而非绕过

- [x] B1. 检查 `src-tauri/Cargo.toml`，确认原配置为：

```toml
zip = { version = "4.6.1", default-features = false }
```

- [x] B2. 检查本地 `zip 4.6.1` 源码，确认：
  - [x] 未启用 `_deflate-any` 时，method 8 映射为 `Unsupported(8)`；
  - [x] `CompressionMethod::Deflated` 只在 Deflate feature 启用时存在；
  - [x] 实际读取需要 `flate2` 解码器。
- [x] B3. 确认生产读取代码没有 `compression() == Stored` 之类的主动限制。
- [x] B4. 确认无需修改 manifest schema、备份版本或恢复策略。
- [x] B5. 裁决真实根因：**编译期缺少标准 Deflate 解码后端**。

### 阶段 C：实施最小修复

- [x] C1. 只修改 `zip` 依赖特性：

```toml
zip = { version = "4.6.1", default-features = false, features = ["deflate-flate2-zlib-rs"] }
```

- [x] C2. 选择 `deflate-flate2-zlib-rs` 的原因：
  - [x] 提供标准 Deflate 编解码；
  - [x] 保持纯 Rust 后端；
  - [x] 不恢复 `zip` 的整组默认特性；
  - [x] 不启用 AES、Bzip2、XZ、Zstd 或 Deflate64。
- [x] C3. 允许 Cargo 机械更新 `Cargo.lock`，核对只增加/连接必要的 `flate2` 与 `zlib-rs` 依赖。
- [x] C4. 不修改 `encode_backup_archive` 的 Stored 选项。
- [x] C5. 不修改 `read_zip_entry` 的 entry 名称规则。
- [x] C6. 不修改 `verify_backup_checksums`。
- [x] C7. 不修改 `manifest.format == "PatinaBackup"` 判断。
- [x] C8. 不修改 restore transaction、merge/replace 策略或数据库 schema。
- [x] C9. 不增加 Time Tracker parser、旧格式枚举或路径探测。

### 阶段 D：把红灯变为绿灯

- [x] D1. 重新运行定向 Deflated 测试。
- [x] D2. 确认重压后的所有 entry 均为 `Deflated`。
- [x] D3. 确认真实文件入口成功返回 `BackupPayload`。
- [x] D4. 对比关键字段：
  - [x] backup version 相同；
  - [x] exported timestamp 相同；
  - [x] session 数量相同；
  - [x] setting 数量相同。
- [x] D5. 由成功通过的应用级 checksum 间接证明 entry 解压内容未改变。

### 阶段 E：负向保护与回归

- [x] E1. 运行整个备份测试组：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml data::backup
```

- [x] E2. 确认 Stored 当前格式仍 round-trip。
- [x] E3. 确认声明 title samples 但缺少文件时仍拒绝。
- [x] E4. 确认 `TimeTrackerBackup` 仍返回 unsupported format。
- [x] E5. 确认纯 JSON 仍不是受支持备份。
- [x] E6. 确认旧 `backup.json` ZIP 仍不是受支持备份。
- [x] E7. 确认恢复写入失败时事务仍回滚。
- [x] E8. 确认 merge 恢复仍保持幂等和 session ID 映射。
- [x] E9. 确认 replace 恢复仍正确处理 title samples。

### 阶段 F：架构与热点守卫

- [x] F1. 初次把回归写入 `backup.rs` 后运行 `npm run check:hotspots`。
- [x] F2. 记录守卫失败：`backup.rs` 从 1114 行增长到 1195 行。
- [x] F3. 不提高热点预算，不用“只是测试”作为长期膨胀理由。
- [x] F4. 将本轮 archive 回归落到 `data/backup/archive_tests.rs`，在 `backup.rs` 仅注册子模块。
- [x] F5. 重新运行热点守卫，确认 `backup.rs` 为 1096 行并通过。
- [x] F6. 确认没有把逻辑移入 `lib.rs`、commands、shared 或其他高吸引层。

### 阶段 G：完整验证

- [x] G1. 运行 Rust 格式检查：

```powershell
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

- [x] G2. 运行 Rust 全检：

```powershell
npm run check:rust
```

- [x] G3. 确认 Rust 边界检查通过。
- [x] G4. 确认全部 Rust 测试结果为 316 passed、1 ignored。
- [x] G5. 确认 Clippy 使用 `-D warnings` 通过。
- [x] G6. 运行仓库全检：

```powershell
npm run check:full
```

- [x] G7. 沙箱内浏览器 smoke 若因 Vite/esbuild `spawn EPERM` 失败，只把它记录为环境限制，不误判为代码回归。
- [x] G8. 按授权在沙箱外重跑同一条 `npm run check:full`，不得只补跑局部命令后宣称全检完成。
- [x] G9. 确认 27 个真实浏览器 smoke 全部通过。
- [x] G10. 确认生产构建和 bundle budget 通过。
- [x] G11. 运行 `git diff --check`，确认无空白错误。
- [x] G12. 对中文 Markdown 做严格 UTF-8 解码校验。

### 阶段 H：发布记录与归档

- [x] H1. 在 `CHANGELOG.md / Unreleased / Fixed` 写用户可理解的最终结果。
- [x] H2. 使用 `Refs [#38](https://github.com/Ceceliaee/patina/issues/38)`。
- [x] H3. 不使用 `Closes`、`Fixes` 或 `Resolves`。
- [x] H4. 不关联 GitHub Project 或 Project item。
- [x] H5. 文案只声称当前 Patina 格式的 Deflated 容器问题已修复。
- [x] H6. 文案不声称旧 Time Tracker 数据已经兼容。
- [x] H7. 执行单全部勾选后移入 `docs/archive/`。
- [x] H8. 未修改 Issue #38 状态、标签或评论。
- [x] H9. 未提交、推送或发布，等待维护者另行授权。

## 7. 验收标准

### 7.1 功能验收

- [x] 当前 Patina 格式 + Stored：成功识别。
- [x] 当前 Patina 格式 + Deflated：成功识别。
- [x] ZIP 时间戳不是 1980-01-01：成功识别。
- [x] entry 路径和解压内容在重压前后保持一致。
- [x] 预览与恢复共用的真实读取入口具备新能力。

### 7.2 安全与数据边界

- [x] 不把 ZIP entry 解压到磁盘，因此没有新增路径穿越式文件写入。
- [x] 固定根目录 entry 名称仍必须存在。
- [x] manifest format 仍必须是 `PatinaBackup`。
- [x] 应用级 CRC32 仍必须一致。
- [x] restore safety 与事务恢复仍保持原行为。
- [x] 加密 ZIP 和其他压缩算法未被顺带启用。
- [x] 旧格式没有进入主程序。

### 7.3 工程质量

- [x] 修复只发生在依赖能力和 archive 测试 owner。
- [x] 没有修改 Tauri IPC、权限或前端 API。
- [x] 没有增加新兼容壳。
- [x] 没有提高热点预算。
- [x] 锁文件变化与依赖特性一致。
- [x] 全量验证通过。

### 7.4 文档与追踪

- [x] Changelog 关联 Issue #38。
- [x] Changelog 不关联 Project。
- [x] 方案明确排除早期版本兼容。
- [x] 迁移工具仍是遗留用户的唯一入口。
- [x] 执行证据与残余风险已经记录。

## 8. 停手条件

出现任意一项时，不得继续把它伪装成小修：

- [ ] 必须放宽 `manifest.format` 才能让样本通过。
- [ ] 必须忽略或重算不一致的应用级 checksum。
- [ ] 必须探测旧 Time Tracker 数据目录或数据库。
- [ ] 必须合并旧 schema、旧字段或旧设置冲突。
- [ ] 必须把迁移工具嵌入安装包或应用运行时。
- [ ] 必须修改 restore transaction 或数据库 owner。
- [ ] 必须支持加密 ZIP、Deflate64 或其他压缩算法。
- [ ] 必须在高风险层增加新的兼容壳。
- [ ] 真实样本证明 Bandizip 同时改写了 entry 内容，而不只是 compression method 和元数据。

本轮没有触发以上停手条件。

## 9. 回滚方案

如果 Deflate 特性导致构建、依赖或运行时回归，应按以下顺序回滚，且不得覆盖其他未提交改动：

- [ ] R1. 仅撤销 `src-tauri/Cargo.toml` 的 `zip` feature 变化。
- [ ] R2. 让 Cargo 机械恢复对应 `Cargo.lock` 依赖关系。
- [ ] R3. 保留失败回归测试作为未解决问题证据，或在明确放弃能力时同步修改其预期。
- [ ] R4. 移除尚未成立的 Changelog 修复声明。
- [ ] R5. 重新运行 `npm run check:rust` 和 `npm run check:full`。
- [ ] R6. 在 Issue #38 记录阻塞原因前另行取得维护者授权。

当前实现通过全部验证，因此未执行回滚。

## 10. 残余风险

### 10.1 解压资源放大

当前读取链路会把用户选择的 ZIP 文件和 JSON entry 读入内存。支持 Deflated 后，恶意或损坏文件可能用较小压缩体积声明很大的解压内容。

本轮没有凭空增加固定大小上限，原因是仓库尚未定义经过产品验证的合法长期备份容量，随意设置 100 MiB、512 MiB 或 1 GiB 都可能误伤真实长期用户。

如果以后处理该风险，应作为独立任务完成：

- [ ] 定义压缩文件总大小上限。
- [ ] 定义所有声明 entry 的累计解压大小上限。
- [ ] 在分配大内存前检查 ZIP header 中的 uncompressed size。
- [ ] 使用有上限的流式读取，防止伪造 header 绕过。
- [ ] 为超限错误增加明确的中英文用户提示。
- [ ] 使用合法大备份与压缩炸弹样本做双向回归。

### 10.2 压缩软件改变内部结构

如果用户压缩的是“包含备份内容的文件夹”，ZIP 根目录可能变成：

```text
Patina-backup/
  manifest.json
  checksums.json
  data/
```

当前契约要求 `manifest.json` 位于 ZIP 根目录，因此仍会拒绝。该行为是结构校验，不是 Deflate 缺陷。

### 10.3 软件品牌不等于 ZIP 方法

本回归验证的是标准 ZIP `Deflated`，不是对某个 Bandizip 版本的特殊兼容承诺。只要压缩软件保留 entry 路径和解压内容，结果应一致；如果软件改写结构或内容，则按相应校验失败处理。

## 11. 实际执行证据

| 验证 | 实际结果 |
| --- | --- |
| 修改前定向测试 | 编译失败：`CompressionMethod::Deflated` 不存在 |
| 修改后 Deflated 定向测试 | 1 passed |
| 备份测试组 | 14 passed |
| 热点守卫 | 通过；`backup.rs` 1096 行 |
| `npm run check:rust` | 316 passed、1 ignored，Clippy 通过 |
| `npm run check:full` | 通过 |
| 真实浏览器 smoke | 27 passed |
| 生产构建 | 通过 |
| Bundle budget | 通过 |
| `git diff --check` | 通过 |
| UTF-8 校验 | 通过 |

## 12. 最终裁决

### 12.1 根因裁决

Issue #38 对 compression method 的描述在 Patina `1.8.2` 上成立。原依赖配置关闭了 `zip` 默认特性，却没有启用 Deflate 解码后端。读取代码虽然没有主动限制 Stored，底层仍会把 ZIP method 8 视为 unsupported，从而导致“未能确认备份文件”。

### 12.2 交付裁决

- [x] 当前格式 `PatinaBackup` 可使用 Stored 或标准 Deflated。
- [x] ZIP entry 时间戳不是识别条件。
- [x] Patina 导出格式仍为 Stored。
- [x] 业务格式与校验没有放宽。
- [x] 旧 Time Tracker 兼容没有进入软件。
- [x] 遗留用户继续使用独立迁移工具。
- [x] Issue #38 保持打开且未被外部修改。

### 12.3 完成定义

本方案的完成不等于“所有历史备份都能导入”。完成的严格定义是：

> 一份符合当前 `PatinaBackup` 业务契约的备份，在 entry 路径和解压内容不变时，不再因为 ZIP compression method 从 Stored 变为 Deflated 而被拒绝。

该定义已经由定向回归、负向矩阵和 `npm run check:full` 证明满足。
