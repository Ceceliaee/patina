# PR #35 数据导出合并前加固执行方案

Refs: PR #35 `feat: add data export (CSV/SQLite/Parquet) with Settings panel`

## 文档定位

本文是一份临时执行方案，用于在保留 #35 原作者贡献的前提下，完成数据导出功能的合并前加固。

- 文档类型：How-to / 执行计划
- 目标读者：接下来实际处理 #35 的仓库维护者或 agent
- 当前状态：已完成并归档
- 完成后处理：若计划执行完毕并不再作为当前依据，应移动到 `docs/archive/`

本文不是长期产品规则、长期架构规则或发布说明。若本文与顶层长期文档冲突，以顶层长期文档为准。

## 执行归档结果

- [x] 已保留 #35 原始提交 `617581f`，未 squash 原作者贡献。
- [x] 已追加修复提交 `5c13be1`，修复导出时间范围、字段校验、CSV 防注入、SQLite 覆盖导出和 command 边界。
- [x] 已在本地 `main` 使用 merge commit `a64db45` 合并 PR #35 修复分支。
- [x] 已追加测试提交 `7bb2aa8`，覆盖 exporter 级 CSV/SQLite/空字段边界。
- [x] 已确认本地 `main` 包含 #35 原始 commit、修复 commit、merge commit 和后续测试 commit。
- [x] 已按用户要求停止在本地合并状态，未推送 `origin/main`。
- [x] 已保留用户原有 `README.md`、`README.zh-CN.md` 工作区改动，未纳入本次提交。
- [x] 已将本文从 `docs/working/` 移动到 `docs/archive/`。

### 验证记录

- [x] `npm run test:export` 通过。
- [x] `cargo test --manifest-path src-tauri/Cargo.toml export --quiet` 通过，8 个 export 相关测试通过。
- [x] `npm run check:types` 通过。
- [x] `cargo check --manifest-path src-tauri/Cargo.toml --quiet` 通过。
- [x] `npm run check:naming` 通过。
- [x] `npm run check:architecture` 通过。
- [x] `npm run check:hotspots` 通过。
- [x] `npm run check:rust` 通过。
- [x] `npm run test:ui-browser-smoke` 在非沙箱环境重跑通过。
- [x] `npm run build` 在非沙箱环境重跑通过。
- [x] `npm run check:bundle` 通过。
- [x] `npm run check:frontend` 在沙箱内执行到 `test:ui-browser-smoke` 时遇到 Vite/esbuild `spawn EPERM`；失败项与被短路的 `build` 已分别在非沙箱环境重跑通过。

### 后置记录

- [ ] 远端推送未执行，等待用户确认。
- [ ] 之前误创建的 sibling worktree `C:\Users\SYBao\Documents\Code\Patina-pr35-export-hardening` 仍保留，等待用户决定是否删除。
- [ ] Tauri 桌面应用手动导出冒烟未单独执行；本轮用浏览器 smoke、构建验证、Rust exporter 级测试和完整 Rust 检查替代。
- [ ] 更深的 Quiet Pro dialog primitive 收敛、Parquet timestamp logical type、大数据流式导出仍作为后置事项。

## 当前执行口径

- [x] 本文只定义执行方案，不代表当前已经开始代码修复。
- [x] 在用户明确要求执行前，不创建修复 commit、不合并分支、不推送远端。
- [x] 若用户要求执行，本轮最多执行到“本地 `main` 已合并、验证结果已汇报”的状态。
- [x] 本地合并完成后必须暂停，向用户汇报 commit、验证结果和剩余风险。
- [x] 未经用户再次确认，不推送 `origin/main`，不更新远端 PR，不创建新 PR。
- [x] 若执行中误创建临时 worktree 或本地分支，应先汇报，不擅自删除或继续推进。

## 第一性原理

数据导出不是一个普通 UI 新功能。它的本质是把用户本地时间追踪数据复制到应用边界之外，因此它必须先满足下面几个基本事实。

### 1. 导出必须忠实表达用户选择

用户选择的时间范围、字段和格式，必须和实际输出一致。

- 选择“本月”就不能导出全量数据。
- 选择 0 个字段不能暗中变成全字段导出。
- 选择一个时间区间时，跨区间边界但与区间有重叠的记录不能静默丢失。

### 2. 导出不能破坏已有数据和已有文件

导出应只读 Patina 主数据库，不修改追踪数据。

对于输出文件，用户期望一次导出得到一个确定结果，而不是把新数据追加进旧导出文件导致重复、混合或 schema 冲突。

### 3. 导出文件会离开 Patina 的信任边界

CSV 会被 Excel、Numbers、LibreOffice 或其他表格工具打开。窗口标题、网页标题、URL 等内容可能来自外部环境，不能假设它们是安全文本。

### 4. `main` 是稳定线，不是半成品缓冲区

当前仓库处于 `1.x` 稳定阶段。#35 的产品方向是合理的，但不能把已知导出正确性问题直接合入 `main` 后再说“以后优化”。

### 5. 保留贡献比重写历史更重要

#35 的原始 commit 应保留在最终历史中。后续加固通过追加 commit 完成，不 squash 掉原作者提交。

## 目标

- [x] 保留 #35 原始提交与作者归属。
- [x] 修复合并前必须处理的导出正确性和安全问题。
- [x] 让 Tauri command 重新保持薄边界。
- [x] 补上覆盖关键导出语义的自动化测试。
- [x] 通过与风险匹配的验证门槛后，再合回 `main`。
- [x] 合回本地 `main` 后停止，不推送远端，等待用户确认。

## 非目标

- [ ] 不在本轮扩展到云同步、团队导出、账号体系或 SaaS 报表。
- [ ] 不新增侧边栏入口。导出仍嵌入 Settings。
- [ ] 不把 UI polish 作为本轮合并 blocker，除非它影响可用性或测试。
- [ ] 不在本轮实现超大数据流式导出优化。
- [ ] 不在本轮重做 Parquet 高级 schema，例如 timestamp logical type。
- [ ] 不修改 tracking 记录逻辑。
- [ ] 不修改主数据库 schema。
- [ ] 不关闭、重开、标记或自动关闭 GitHub issue / PR。

## 合并前必须修复的问题

- [x] 默认时间范围不生效：当前默认显示“本月”，但实际导出传空时间范围。
- [x] SQLite 导出到已有文件会追加或失败：当前会打开已有 `.db` 并继续插入。
- [x] 清空字段后反而导出全部字段：UI 显示 `0 / 11`，后端把空数组当默认全字段。
- [x] 时间范围过滤漏掉跨区间记录：当前只看 `start_time` 是否落在区间内。
- [x] CSV 公式注入风险：CSV 宣称可用 Excel 打开，但未处理 `=`, `+`, `-`, `@` 等开头文本。
- [x] Rust command 直接拿 SQLite pool：`commands/export.rs` 不应承接数据边界细节。

## 可后置处理的问题

- [ ] Export 面板和字段弹窗的 Quiet Pro polish。
- [ ] 硬编码 glow、`shadow-xl`、局部圆角覆盖收敛到 token 或现有 dialog primitive。
- [ ] 导出格式推荐文案微调。
- [ ] 更强的 Parquet 类型语义。
- [ ] 大数据分批读取和写入性能优化。

## 推荐分支策略

### 推荐方式：独立 worktree

当前主工作区可能已有未提交改动，例如 README。为避免切分支时影响用户改动，优先使用独立 worktree。

- [ ] 确认主工作区状态。

```powershell
git status --short
```

- [ ] 拉取 PR 引用。

```powershell
git fetch origin pull/35/head:refs/remotes/origin/pr/35
```

- [ ] 在仓库同级目录创建独立 worktree。

```powershell
git worktree add ..\Patina-pr35-export-hardening origin/pr/35
```

- [ ] 进入新 worktree。

```powershell
Set-Location ..\Patina-pr35-export-hardening
```

- [ ] 创建本地修复分支。

```powershell
git switch -c pr-35-export-hardening
```

### 可选方式：当前工作区直接建分支

仅当当前未提交改动不会被切分支影响时使用。

- [ ] 确认当前未提交改动不会与 #35 冲突。
- [ ] 从 PR head 创建分支。

```powershell
git switch -c pr-35-export-hardening origin/pr/35
```

## 阶段 0：执行前确认

- [ ] 确认 #35 仍以 `main` 为 base。
- [ ] 确认 #35 仍只有预期的导出相关变更。
- [ ] 确认未使用 squash 方式准备合并。
- [ ] 确认不使用会自动关闭 issue / PR 的关键词。
- [ ] 确认本轮提交信息只使用 `Refs #35` 或 PR 链接做追溯。
- [ ] 重新阅读以下长期文档的相关约束：
  - [ ] `docs/product-principles-and-scope.md`
  - [ ] `docs/roadmap-and-prioritization.md`
  - [ ] `docs/engineering-quality.md`
  - [ ] `docs/quiet-pro-component-guidelines.md`
  - [ ] `docs/architecture.md`
  - [ ] `docs/issue-fix-boundary-guardrails.md`
  - [ ] `docs/versioning-and-release-policy.md`

## 阶段 1：建立导出模型的不变量

### 1.1 定义时间范围语义

- [ ] 明确 V1 导出语义：导出与时间范围有重叠的完整记录，不裁剪记录内容。
- [ ] 明确时间范围内部使用半开区间：`[startTime, endExclusive)`。
- [ ] UI 的结束日期若是 `2026-07-07`，内部应转成 `2026-07-08 00:00:00.000` 的 exclusive end。
- [ ] 若用户只提供开始时间，导出所有在开始时间之后仍有重叠的记录。
- [ ] 若用户只提供结束时间，导出所有在结束时间之前开始的记录。
- [ ] 若用户不提供时间范围，导出所有记录。
- [ ] 对 active record 的 `end_time IS NULL`，比较时使用导出执行时的 `now_ms` 或 range end 作有效结束时间。
- [ ] 不在 V1 输出中裁剪 `start_time/end_time/duration`，避免把导出变成第二套聚合逻辑。

### 1.2 定义字段选择语义

- [ ] `None` 或未传字段只表示使用默认字段。
- [ ] `Some([])` 或空数组表示用户显式选择了 0 个字段，必须被拒绝。
- [ ] 字段顺序按用户选择顺序输出。
- [ ] 重复字段应去重并保持首次出现的位置。
- [ ] 未知字段必须报错，不能忽略。
- [ ] `duration_ms` 是导出接口字段名，SQLite 源表列名仍为 `duration`。
- [ ] `page_title` 是导出接口字段名，SQLite 源表列名仍为 `title`。

### 1.3 定义输出文件语义

- [ ] CSV 和 Parquet 使用覆盖式导出。
- [ ] SQLite 也必须使用覆盖式导出。
- [ ] SQLite 导出应先写临时文件，成功后替换目标文件。
- [ ] 如果 SQLite 导出失败，目标旧文件应保持不变。
- [ ] 如果 CSV 或 Parquet 导出失败，应尽量避免留下误导性的完整文件；若暂不能原子替换，至少在错误路径中清理部分文件。

### 1.4 定义 CSV 安全语义

- [ ] 任何可能由外部输入控制的文本字段都必须经过 Excel 公式防护。
- [ ] 如果字段首个非空白字符是 `=`, `+`, `-`, `@`，导出前加安全前缀。
- [ ] 保留原始文本内容的可读性。
- [ ] 数字字段不走文本公式防护。
- [ ] 增加自动化测试覆盖公式注入样例。

## 阶段 2：先写或调整测试

本阶段目标是让关键问题先被测试表达出来。允许先提交 failing tests，也允许在同一个修复 commit 中提交测试和实现，但最终必须能证明这些问题不会回归。

### 2.1 Rust 导出核心测试

- [ ] 在 `src-tauri/src/engine/export/` 下为导出核心逻辑增加测试模块。
- [ ] 使用临时 SQLite 源库构造最小数据：
  - [ ] 一个完全落在范围内的 session。
  - [ ] 一个开始早于范围但结束落在范围内的 session。
  - [ ] 一个开始在范围内但结束晚于范围的 session。
  - [ ] 一个完全在范围外的 session。
  - [ ] 对 web activity segments 做相同覆盖。
- [ ] 测试区间重叠查询会包含前三类、排除完全范围外记录。
- [ ] 测试 `end_time IS NULL` 的 active record 在合理有效结束时间下能被包含。
- [ ] 测试未知字段返回错误。
- [ ] 测试重复字段去重且保持顺序。
- [ ] 测试空字段数组返回错误。
- [ ] 测试 CSV 公式防护：
  - [ ] `=cmd`
  - [ ] `+SUM(1,1)`
  - [ ] `-1+2`
  - [ ] `@HYPERLINK(...)`
  - [ ] 前导空白后跟公式字符
- [ ] 测试 SQLite 重复导出同一路径不会重复追加。
- [ ] 测试 SQLite 导出失败时不破坏已有目标文件，若实现成本过高，至少记录为明确未覆盖风险。

### 2.2 前端导出状态测试

- [ ] 将 `Export.tsx` 中的时间范围推导逻辑抽到 feature-owned service，例如 `src/features/export/services/exportRange.ts`。
- [ ] 增加前端测试文件，例如 `tests/exportRange.test.ts`。
- [ ] 测试默认 preset `thisMonth` 会生成非空时间范围。
- [ ] 测试 `today`, `thisWeek`, `thisMonth`, `thisYear` 均生成 start/end。
- [ ] 测试 custom start/end 会转成 `[start, endExclusive)`。
- [ ] 测试 custom start 晚于 end 时返回校验错误。
- [ ] 测试切换 preset 后，导出请求使用 preset 对应范围，而不是旧 custom state。

### 2.3 UI 交互测试的最低要求

- [ ] 若不新增浏览器专项测试，至少保证现有 `test:ui-smoke` 和 `test:ui-browser-smoke` 能通过。
- [ ] 若时间允许，在 browser smoke 中补一个 Settings 中存在“数据导出”面板的轻量断言。
- [ ] 不在本轮为了 UI polish 写大范围视觉测试。

## 阶段 3：修复前端导出请求语义

### 3.1 拆出纯逻辑

- [ ] 新增或调整 `src/features/export/services/exportRange.ts`。
- [ ] 将 preset 类型、格式类型、日期计算函数从组件中抽出。
- [ ] 暴露一个纯函数，例如：

```ts
resolveExportTimeRange({
  preset,
  customStartDate,
  customEndDate,
  now,
})
```

- [ ] 返回结构包含：
  - [ ] `startTime`
  - [ ] `endTimeExclusive`
  - [ ] `error`

### 3.2 修复默认值

- [ ] 默认 preset 仍可保持 `thisMonth`。
- [ ] 初始日期 state 必须由 `thisMonth` 推导，或者导出时直接按 preset 推导，不依赖空 state。
- [ ] 页面首屏显示的推荐文案和实际导出范围一致。

### 3.3 修复 custom 校验

- [ ] custom 模式下，开始日期和结束日期都必须存在。
- [ ] custom 开始日期不能晚于结束日期。
- [ ] custom 校验失败时禁用导出按钮或显示明确错误。
- [ ] 不把非法 custom 范围传给 Rust command。

### 3.4 修复字段配置交互

- [ ] 字段弹窗确认时，若字段数为 0，应阻止确认并显示轻量提示。
- [ ] Export 主按钮在字段数为 0 时禁用。
- [ ] 后端仍必须防空字段，不能只依赖 UI。
- [ ] `configFieldsCount` 与实际后端语义一致。

### 3.5 保持 feature 边界

- [ ] `Export.tsx` 不直接 import `platform/*`。
- [ ] `features/export/services/exportService.ts` 继续作为 feature-owned proxy。
- [ ] 组件不直接调用 `invoke`。

## 阶段 4：收紧 Rust 命令与 owner 边界

### 4.1 命令层保持薄

- [ ] `src-tauri/src/commands/export.rs` 只保留：
  - [ ] Tauri command 入口
  - [ ] request DTO
  - [ ] response DTO
  - [ ] save file dialog
  - [ ] DTO 到 engine request 的映射
- [ ] 从 `commands/export.rs` 移除直接 `wait_for_sqlite_pool` 调用。
- [ ] 从 `commands/export.rs` 移除直接 `Pool<Sqlite>` 类型暴露。
- [ ] `cmd_export_data` 委托到 `crate::engine::export::export_data(...)` 或同等 owner。

### 4.2 Engine / data 分工

- [ ] `engine/export` 负责导出流程编排：
  - [ ] 解析 format
  - [ ] 校验字段
  - [ ] 获取源数据
  - [ ] 调用对应 writer
  - [ ] 统一返回 row count
- [ ] SQL 查询和 row 映射可以暂留在 `engine/export`，但若继续增长，应拆到 `data` owner。
- [ ] 不让 `commands/*` 写 SQL。
- [ ] 不让 `app/*` 参与导出业务逻辑。

### 4.3 清理冗余 command

- [ ] 检查 `cmd_export_data_to_parquet`, `cmd_pick_parquet_save_file`, `cmd_get_parquet_export_fields` 是否仍被前端使用。
- [ ] 若新 UI 只使用统一 `cmd_export_data` 和 `cmd_pick_export_save_file`，删除未使用的旧 Parquet 专用 command。
- [ ] 同步清理 `dataExportGateway.ts` 中未使用函数。
- [ ] 同步清理 `register_invoke_handlers` 中未使用 command。
- [ ] 若为了兼容 PR 内部过渡保留它们，必须保持薄转发并说明退出条件。

## 阶段 5：修复 Rust 导出正确性

### 5.1 统一字段定义

- [ ] 建立单一字段白名单，避免 CSV/SQLite/Parquet 各自维护一份容易漂移的字段列表。
- [ ] 字段定义至少包含：
  - [ ] public field key
  - [ ] source group
  - [ ] source column
  - [ ] output type
  - [ ] nullable
  - [ ] default selected
- [ ] CSV/SQLite/Parquet 使用同一份 resolved fields。
- [ ] 字段解析区分默认字段和显式空字段。

### 5.2 统一时间范围查询

- [ ] 新增统一的 time range resolver。
- [ ] SQL 从 `start_time >= ? AND start_time <= ?` 改为区间重叠逻辑。
- [ ] 有 start 和 end 时使用：

```sql
WHERE start_time < ?
  AND COALESCE(end_time, ?) > ?
```

- [ ] 参数顺序明确：
  - [ ] 第一个 `?` 为 `endExclusive`
  - [ ] 第二个 `?` 为 active record 的 effective end
  - [ ] 第三个 `?` 为 `startTime`
- [ ] 只有 start 时，至少使用：

```sql
WHERE COALESCE(end_time, ?) > ?
```

- [ ] 只有 end 时，至少使用：

```sql
WHERE start_time < ?
```

- [ ] 无范围时不加 WHERE。
- [ ] 为 sessions 和 web activity 使用同样语义。

### 5.3 修复 CSV 导出

- [ ] CSV 文件写入使用临时文件，成功后替换目标文件，或明确清理失败部分文件。
- [ ] 写入 BOM 保持 Excel 兼容。
- [ ] 对文本字段调用公式防护函数。
- [ ] 保持 csv crate 负责 quote / escaping，不手写 CSV 拼接。
- [ ] 输出 row count 等于实际写入记录数。

### 5.4 修复 SQLite 导出

- [ ] 不再直接连接目标路径写入。
- [ ] 使用同目录临时 SQLite 文件。
- [ ] 使用 `SqliteConnectOptions::new().filename(temp_path).create_if_missing(true)`，避免手写 URI 拼接。
- [ ] 创建表前确保临时文件不存在或已清理。
- [ ] 写入在事务中进行。
- [ ] 写入完成后关闭连接池。
- [ ] 成功后替换目标文件。
- [ ] 失败后清理临时文件，保留原目标文件。
- [ ] 重复导出同一路径结果仍只有本次记录，不重复追加。

### 5.5 修复 Parquet 导出

- [ ] 使用统一字段解析和统一时间范围查询。
- [ ] 对空字段数组返回错误。
- [ ] 保持当前 string time 输出，除非单独升级 Parquet schema。
- [ ] 输出 row count 等于 RecordBatch rows。
- [ ] 若 selected fields 为空，不创建空 schema parquet。

## 阶段 6：CSV 公式注入防护细节

- [ ] 新增函数，例如 `sanitize_csv_text_for_excel(value: &str) -> String`。
- [ ] 判定首个非空白字符。
- [ ] 若首个非空白字符属于 `=`, `+`, `-`, `@`，在原字符串前加单引号或其他明确安全前缀。
- [ ] 对普通文本保持原样。
- [ ] 对空字符串保持原样。
- [ ] 对时间格式字符串保持原样。
- [ ] 对 `duration_ms` 数字字段保持数字语义，不转成带前缀文本。
- [ ] 在测试中读取 CSV 输出文本，确认危险值已被保护。

## 阶段 7：Quiet Pro 最小收敛

本阶段只做不会扩大范围的小收敛。不要把 UI polish 变成阻塞主线的设计重做。

- [ ] 删除字段弹窗中的硬编码 purple glow。
- [ ] 如果改动很小，用现有 `qp-dialog-backdrop` / `qp-dialog-surface` 替代 `bg-black/40`, `shadow-xl`, `rounded-[16px]`。
- [ ] 若替换会引起布局重做，先保留 UI，记录为后置 polish。
- [ ] 不新增新的颜色、阴影、半径 token，除非确实需要长期语义角色。
- [ ] 不新增大面积视觉风格。

## 阶段 8：验证

### 8.1 局部验证

- [ ] 运行新增前端导出范围测试。

```powershell
node --experimental-strip-types --experimental-specifier-resolution=node tests/exportRange.test.ts
```

- [ ] 运行 Rust 导出相关测试。

```powershell
cargo test --manifest-path src-tauri/Cargo.toml export
```

- [ ] 运行 Rust 边界检查。

```powershell
npm run check:rust-boundaries
```

- [ ] 运行前端架构检查。

```powershell
npm run check:architecture
```

- [ ] 运行类型检查。

```powershell
npm run check:types
```

### 8.2 完整验证

因为本轮改动触及 Rust、IPC、SQLite 数据边界和 Settings UI，合并前默认跑完整质量门槛。

- [ ] 运行完整检查。

```powershell
npm run check:full
```

- [ ] 若 `check:full` 因环境问题失败，记录具体失败命令、失败原因和已完成的替代验证。
- [ ] 不用“PR 作者说跑过”替代本轮修复后的验证。

### 8.3 手动冒烟

- [ ] 启动本地开发环境。
- [ ] 打开 Settings。
- [ ] 确认 Data Safety 后出现数据导出面板。
- [ ] 不修改时间范围，直接导出，确认不是全量导出。
- [ ] 自定义一个跨天范围，确认跨边界记录被包含。
- [ ] 导出 CSV，确认 Excel 风险字段被安全前缀保护。
- [ ] 连续两次导出 SQLite 到同一路径，确认没有重复追加。
- [ ] 字段清空后确认无法导出。
- [ ] 浅色和深色主题下确认面板可读。

## 阶段 9：提交策略

### 9.1 推荐提交拆分

- [ ] 保留 #35 原始 commit 不变。
- [ ] 添加一个或多个后续修复 commit。
- [ ] 推荐拆分：
  - [ ] `fix: harden data export semantics`
  - [ ] `test: cover data export edge cases`
  - [ ] 如有必要：`refactor: keep export commands thin`
- [ ] commit body 可写 `Refs #35`，不要写会自动关闭 issue / PR 的关键词。

### 9.2 提交前检查

- [ ] `git diff --check` 通过。
- [ ] `git status --short` 只包含本轮预期文件。
- [ ] 没有修改用户已有的 README 未提交改动。
- [ ] 没有引入顶层临时 docs。
- [ ] 没有修改 `docs/archive/*` 作为执行依据。

## 阶段 10：合回 main

### 10.1 本地合并

- [ ] 回到主仓库 main。

```powershell
git switch main
```

- [ ] 确认 main 更新到目标远端。

```powershell
git fetch origin main
git status --short
```

- [ ] 如 main 未更新，先按仓库当前协作规则处理同步。
- [ ] 使用保留历史的 merge，不 squash。

```powershell
git merge --no-ff pr-35-export-hardening
```

- [ ] 若发生冲突，只解决与导出相关的冲突，不顺手改无关文件。

### 10.2 合并后验证

- [ ] 合并后再次运行：

```powershell
npm run check:full
```

- [ ] 确认提交历史中仍包含 #35 原始作者 commit。

```powershell
git log --oneline --decorate -5
```

- [ ] 确认没有 squash 掉原始 commit。
- [ ] 到这里必须暂停执行，向用户汇报本地合并结果。
- [ ] 汇报内容至少包括：
  - [ ] 当前分支和最新 commit。
  - [ ] #35 原始 commit 是否仍在历史中。
  - [ ] 运行过的验证命令与结果。
  - [ ] 未运行或失败的验证及原因。
  - [ ] 是否存在需要用户决定的剩余风险。

### 10.3 远端推送确认

默认不执行。仅当用户在本地合并结果汇报后再次明确要求推送时，才进入本节。

- [ ] 推送到 `origin/main`。

```powershell
git push origin main
```

- [ ] 不创建 PR，除非用户明确要求。
- [ ] 不关闭 #35，除非用户明确要求。

## 回滚策略

- [ ] 若修复分支失败，不合并到 `main`。
- [ ] 若已在修复分支上失败，继续追加修复 commit，不改写 #35 原始 commit。
- [ ] 若合并到 main 后立刻发现问题且尚未推送，可使用非破坏性方式回退 merge commit。
- [ ] 若已经推送 main，先评估是否需要 revert merge commit，再单独修复。
- [ ] 不使用 `git reset --hard` 或强推，除非用户明确要求并理解后果。

## 验收标准

- [x] 默认“本月”导出实际使用本月范围。
- [x] 所有 preset 导出范围可解释且有测试。
- [x] custom 日期非法时不能导出。
- [x] 空字段选择不能导出。
- [x] 未知字段被拒绝。
- [x] 重复字段被去重且顺序稳定。
- [x] CSV 文本字段有公式注入防护。
- [x] SQLite 导出到已有路径不会重复追加。
- [x] 时间范围按区间重叠导出，跨边界记录不漏。
- [x] `commands/export.rs` 不再直接拿 SQLite pool。
- [x] `npm run check:full` 通过，或失败原因和替代验证被清楚记录。
- [x] #35 原始 commit 保留在最终历史中。
- [x] 没有会自动关闭 issue / PR 的关键词。

## 后置事项

- [ ] 将 Export UI 的弹窗、阴影、圆角和插入线效果收敛到 Quiet Pro token / dialog primitive。
- [ ] 评估是否要把导出入口从 Settings 中拆出独立信息架构。
- [ ] 评估大数据导出的流式读取和分批写入。
- [ ] 评估 Parquet timestamp logical type。
- [x] 若本执行方案完成，移动到 `docs/archive/`。
