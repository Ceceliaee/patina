# Patina 架构与工程质量 9.0+ 执行方案

状态：已完成并归档  
创建日期：2026-06-10  
完成日期：2026-06-10  
文档类型：执行型 How-to / Working Plan  
目标评分：综合真实评分 `9.0+`，架构评分 `9.0+`，工程质量评分 `9.0+`  
当前基线：2026-06-10 真实审查结论约为综合 `8.0 / 10`，架构 `8.3 / 10`，工程质量 `7.8 / 10`。  
最终评分：综合 `9.1 / 10`，架构 `9.0 / 10`，工程质量 `9.2 / 10`。  
后续独立清理文档：[`patina-d10-compatibility-cleanup-plan.md`](./patina-d10-compatibility-cleanup-plan.md)

本文是阶段性执行方案的完成记录。本轮先执行 9.0+ 质量提升，不在本文中执行旧 Time Tracker 身份兼容清理；兼容清理到期后直接按独立清理文档执行。

## 执行结果

- [x] 阶段 A 完成：修复 Vite dependency scan 扫描 `src-tauri/target/.../tauri-codegen-assets/*.html` 导致的 browser smoke 红灯。
- [x] 阶段 A 验证完成：`npm run test:ui-browser-smoke` 已连续两次单独通过。
- [x] 阶段 A 验证完成：`npm run check:full` 已通过。
- [x] 阶段 B 完成：本轮改动仍排除 D+10 兼容清理，旧兼容词只保留为未到期时间盒例外。
- [x] 阶段 B 完成：边界脚本 `check:naming`、`check:architecture`、`check:rust-boundaries` 均通过。
- [x] 阶段 C 完成：`src-tauri/src/data/repositories/tools.rs` 的备份/恢复仓储职责已抽到 `src-tauri/src/data/repositories/tools/backup_restore.rs`，外部调用路径通过 re-export 保持不变。
- [x] 阶段 C 完成：`sqlite_pool.rs`、`backup.rs`、`runtime.rs` 的剩余体量主要来自测试块、未到期兼容例外或已存在子模块；本轮未为行数做无收益大搬迁。
- [x] 阶段 D 完成：Vite dep-scan 入口约束已保留注释，browser smoke 仍覆盖真实 Vite server + browser 路径。
- [x] 阶段 E 完成：三项性能基准均已通过预算。
- [x] 阶段 F 完成：`npm run release:check` 已通过。
- [x] 已确认本轮没有新增旧 Time Tracker 身份兼容入口、fallback、迁移壳或页面层判断。
- [x] 已确认 D+10 兼容清理继续由 `docs/working/patina-d10-compatibility-cleanup-plan.md` 后续独立执行。
- [x] 本文件已归档到 `docs/archive/`。

## 验证摘要

- [x] `npm run test:ui-browser-smoke`：通过，23 项 browser UI smoke。
- [x] `npm run test:ui-browser-smoke`：第二次通过，23 项 browser UI smoke。
- [x] `npm run check:full`：通过。
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --quiet tools`：通过，19 项 tools Rust 测试。
- [x] `npm run check:rust`：通过，212 项 Rust 测试与 clippy `-D warnings`。
- [x] `npm run perf:history-read-model`：通过，`current-history-read-model` 平均 `117.75ms`，预算 `170ms`。
- [x] `npm run perf:dashboard-read-model`：通过，平均 `20.90ms`，预算 `25ms`。
- [x] `npm run perf:startup-bootstrap`：通过，平均 `0.0029ms`，预算 `1.5ms`。
- [x] `npm run release:check`：通过。

## 原始计划备查

以下保留执行前的原始清单。条件分支、候选路径和未触发事项不逐项回勾；本次实际完成状态以上方“执行结果”和“验证摘要”为准。

## 本轮范围

- [ ] 本轮执行验证链修复、非兼容架构收口、防回流护栏、性能与资源复核。
- [ ] 本轮不删除旧 Time Tracker 身份兼容代码。
- [ ] 本轮不要求 `patina-d10-compatibility-cleanup-plan.md` 完成。
- [ ] 本轮只确认兼容清理已被独立文档承接，且当前改动不扩大旧兼容面。
- [ ] 如果执行本方案时已经到达 D+10 且无延期理由，应暂停本方案，先按独立清理文档完成兼容退出，再回来复评。
- [ ] 如果执行本方案时尚未到达 D+10，可把旧兼容视为未到期、已隔离的时间盒例外，不作为本轮 9.0+ 阻塞项。

## 0. 总原则

- [ ] 先修真实红灯，再做结构收口。
- [ ] 先判断 owner，再移动或拆分代码。
- [ ] 不为了行数好看做无收益拆分。
- [ ] 不把 `app/*`、`shared/*`、`platform/*`、Rust `lib.rs`、`commands/*` 写厚。
- [ ] 不恢复已退出的根层 `src/lib/*` 或 `src/types/*`。
- [ ] 不把兼容窗口清理混入本轮 9.0+ 改造提交。
- [ ] 不在 D+10 准入条件满足前清理旧 Time Tracker 身份兼容代码；满足后按独立清理文档处理。
- [ ] 不修改 `docs/archive/*` 作为当前执行依据，除非只是验证历史来源。
- [ ] 中文 Markdown 只用正常代码编辑或补丁方式修改，避免 PowerShell 输出重写造成编码问题。
- [ ] 每个阶段结束都记录实际验证结果，而不是只勾选主观完成。

## 1. 评分口径

### 1.1 当前扣分事实

- [ ] 默认完整门槛 `npm run check:full` 当前不能通过。
- [ ] 单独 `npm run test:ui-browser-smoke` 当前不能通过。
- [ ] browser smoke 失败集中在 Vite dependency scan，把 `src-tauri/target/.../tauri-codegen-assets/*.html` 作为扫描入口之一。
- [ ] 生产 `npm run build` 可通过，说明失败更像 dev server / browser smoke 验证链问题，而不是 TypeScript 或生产构建问题。
- [ ] `npm run check:rust` 可通过，Rust 边界、`cargo check`、212 个 Rust 测试和 clippy `-D warnings` 当前成立。
- [ ] `npm run check:naming`、`npm run check:architecture`、`npm run check:rust-boundaries` 当前通过。
- [ ] 旧 Time Tracker 身份兼容仍在运行时代码里，但本轮将其视为 D+10 前的时间盒兼容例外，不在本方案中清理。
- [ ] 若干 owner 文件偏厚，包括 `src-tauri/src/data/repositories/tools.rs`、`src-tauri/src/data/sqlite_pool.rs`、`src-tauri/src/data/backup.rs`、`src-tauri/src/engine/tracking/runtime.rs`、`src/features/history/components/History.tsx`、`src/features/data/components/Data.tsx`。

### 1.2 评分上限

- [ ] 如果 `npm run check:full` 仍失败，综合评分不得宣称超过 `8.2`。
- [ ] 如果当前日期尚未到达 D+10，且兼容清理已有独立文档承接，旧兼容本身不阻塞本轮 `9.0+` 评分。
- [ ] 如果 D+10 清理未执行但已经超出兼容窗口，综合评分不得宣称超过 `8.5`。
- [ ] 如果到达 D+10 后执行清理但缺少迁移后、全新安装、跳过窗口验证，综合评分不得宣称超过 `8.8`。
- [ ] 如果 `commands/*`、`lib.rs`、`app/*` 或前端 `shared/*` 因重构变厚，综合评分不得宣称超过 `8.7`，即使测试通过。
- [ ] 只有当默认门槛、关键 owner 复杂度、验证可靠性收口，且兼容债处于未到期隔离或已按独立文档清理状态时，才允许重新评估 `9.0+`。

### 1.3 9.0+ 完成定义

- [ ] `npm run check:full` 在普通本地环境通过。
- [ ] `npm run check:full` 在存在 `src-tauri/target` 历史构建产物时仍通过。
- [ ] `npm run release:check` 通过。
- [ ] `npm run test:ui-browser-smoke` 可单独连续运行两次通过。
- [ ] `npm run check:naming`、`npm run check:architecture`、`npm run check:rust-boundaries` 仍通过。
- [ ] `npm run check:rust` 仍通过。
- [ ] `npm run build` 与 `npm run check:bundle` 仍通过。
- [ ] 当前日期尚未达到 D+10，或已经达到 D+10 且独立兼容清理文档已完成。
- [ ] 本轮改动没有新增旧 Time Tracker 身份兼容入口、fallback、迁移壳或页面层判断。
- [x] [`patina-d10-compatibility-cleanup-plan.md`](./patina-d10-compatibility-cleanup-plan.md) 仍能作为后续直接执行依据。
- [ ] 高吸力层没有新增厚逻辑。
- [ ] 重构后的关键 owner 文件有清晰职责说明、局部测试或现有专项测试保护。
- [ ] 最终审查给出新分数和仍未解决的残余风险。

## 2. 阶段 A：修复验证链红灯

目标：先让仓库默认质量门槛重新可信。没有这一步，后续架构评分不应上调。

### 2.1 复现和定位

- [ ] 确认工作树状态，记录无关未提交改动：

```bash
git status --short
```

- [ ] 单独运行 browser smoke，确认当前失败形态：

```bash
npm run test:ui-browser-smoke
```

- [ ] 记录失败日志中 `Failed to scan for dependencies from entries` 的所有 HTML entry。
- [ ] 确认是否包含 `src-tauri/target/.../tauri-codegen-assets/*.html`。
- [ ] 确认 `index.html` 本身仍是期望入口。
- [ ] 确认生产构建是否通过：

```bash
npm run build
```

- [ ] 如果构建也失败，先区分是沙箱 `esbuild spawn EPERM` 还是真实构建错误。
- [ ] 确认 `tests/uiBrowserSmoke.test.ts` 中 `createServer` 使用的 config、root、server 和 plugin 设置。
- [ ] 确认 `vite.config.ts` 是否缺少限制 dependency scan entry 的配置。

### 2.2 Owner 判断

- [ ] 如果 `npm run dev` 也可能被 `src-tauri/target` 影响，owner 是 `vite.config.ts`。
- [ ] 如果只有 browser smoke 的临时 Vite server 受影响，owner 是 `tests/uiBrowserSmoke.test.ts` 的 test server config。
- [ ] 不把修复放进页面组件、Dashboard、AppShell 或 feature 代码。
- [ ] 不通过删除 `src-tauri/target` 作为长期修复。
- [ ] 不通过跳过 `test:ui-browser-smoke` 作为长期修复。

### 2.3 推荐修复路径

- [ ] 优先在 Vite 配置或 browser smoke server 配置中显式限制 dependency scan entry 为 `index.html`。
- [ ] 候选实现一：在 `vite.config.ts` 添加 `optimizeDeps.entries = ["index.html"]`。
- [ ] 候选实现二：只在 `tests/uiBrowserSmoke.test.ts` 的 `createServer` options 中添加 `optimizeDeps.entries = ["index.html"]`。
- [ ] 如果采用候选实现一，确认 `tauri dev`、普通 `vite` dev server 和 browser smoke 都共享收益。
- [ ] 如果采用候选实现二，确认不掩盖真实开发服务器中的同类问题。
- [ ] 保持现有 Tauri stub plugin，不把 Tauri API stub 扩散到生产配置。
- [ ] 检查 `server.close()`、browser process cleanup 和 temp profile cleanup 在失败路径仍会执行。
- [ ] 如果失败路径 cleanup 不完整，补 `finally` 保护，但不要改变 smoke 测试的断言范围。
- [ ] 不降低 Dashboard 首屏等待断言，不把 timeout 调大当作主要修复。

### 2.4 验证

- [ ] 单独运行 browser smoke：

```bash
npm run test:ui-browser-smoke
```

- [ ] 再连续运行一次 browser smoke：

```bash
npm run test:ui-browser-smoke
```

- [ ] 运行前端完整链：

```bash
npm run check
```

- [ ] 运行完整链：

```bash
npm run check:full
```

- [ ] 确认 `src-tauri/target` 仍存在时检查通过。
- [ ] 记录修复前后是否影响 `npm run build` 输出 chunk。
- [ ] 如果 chunk 变化明显，运行 bundle 检查：

```bash
npm run check:bundle
```

### 2.5 阶段 A 完成标准

- [ ] `test:ui-browser-smoke` 单独连续两次通过。
- [ ] `npm run check:full` 通过。
- [ ] 没有降低 UI smoke 覆盖范围。
- [ ] 没有删除构建产物目录作为规避。
- [ ] 没有把测试配置污染到生产运行时代码。

## 3. 阶段 B：非兼容架构复评

目标：在不触碰旧身份清理的前提下，确认本轮质量提升真正改善了验证链、owner 清晰度和边界可靠性。

### 3.1 本轮变更边界审计

- [ ] 确认本轮范围说明仍排除兼容清理。
- [ ] 确认本轮改动没有把旧身份判断搬到 `commands/*`、`lib.rs` 或前端页面层。
- [ ] 确认本轮改动没有新增 quarantine、二次迁移或新的 fallback。
- [ ] 确认本轮改动没有删除通用 SQLite schema migration 能力。
- [ ] 确认本轮改动没有删除用户旧目录中的未知文件。
- [ ] 如需抽查旧词，只用于确认没有新增回流，不作为本轮删除清单：

```bash
rg -n "com\.timetracker|timetracker\.db|TimeTrackerBackup|com\.timetracker\.backup\.webdav\.default|Time Tracker" src-tauri src tests scripts
```

- [ ] 如果抽查发现本轮新增旧兼容入口，先修正回流，再继续本轮计划。

### 3.2 文件体量复测

- [ ] 统计重点文件行数：

```bash
Get-ChildItem -Recurse -File src,src-tauri/src,tests,scripts | Where-Object { @('.ts','.tsx','.rs','.css') -contains $_.Extension } | ForEach-Object { $lineCount = (Get-Content -LiteralPath $_.FullName).Count; [PSCustomObject]@{ Lines = $lineCount; Path = $_.FullName.Substring($PWD.Path.Length + 1) } } | Sort-Object Lines -Descending | Select-Object -First 40 | Format-Table -AutoSize
```

- [ ] 记录 `sqlite_pool.rs` 当前行数和非兼容职责分组。
- [ ] 记录 `tools.rs` 当前行数和 repository 职责分组。
- [ ] 记录 `backup.rs` 当前行数，明确哪些复杂度属于后续兼容清理。
- [ ] 记录 `remote_backup.rs` 当前行数，明确哪些复杂度属于后续兼容清理。
- [ ] 记录 `tracking/runtime.rs` 当前行数和运行时职责分组。
- [ ] 记录前端 AppShell、History、Data 等大组件当前行数。
- [ ] 如果仍存在明显厚 owner 文件，进入阶段 C。

### 3.3 边界复测

- [ ] 运行前端命名边界：

```bash
npm run check:naming
```

- [ ] 运行前端架构边界：

```bash
npm run check:architecture
```

- [ ] 运行 Rust 边界：

```bash
npm run check:rust-boundaries
```

- [ ] 确认没有因为本轮改造引入新的兼容壳。
- [ ] 确认 `commands/*` 没有新增业务判断。
- [ ] 确认 `lib.rs` 没有新增业务判断。
- [ ] 确认前端页面组件没有承担旧身份兼容判断。

## 4. 阶段 C：厚 owner 文件收口

目标：只在真实复杂度仍然影响维护时拆分 owner 文件。拆分必须保留 owner，不制造新边界。

### 4.1 通用准入

- [ ] 阶段 A 已完成。
- [ ] 本轮范围已确认排除兼容清理。
- [ ] 阶段 B 已完成。
- [ ] 本阶段不触碰旧身份兼容清理代码。
- [ ] `npm run check:full` 当前通过。
- [ ] 已确认目标文件的问题不是单纯行数，而是职责混杂、测试困难或修改风险高。
- [ ] 已列出目标文件内部的职责分组。
- [ ] 已确认拆分后的文件仍在真实 owner 层内。
- [ ] 已确认拆分不会新增 `shared/*`、`platform/*` 或 `commands/*` 临时桶。

### 4.2 `sqlite_pool.rs` 收口

owner：`src-tauri/src/data/*`。  
目标：让 `sqlite_pool.rs` 回到 pool 打开、注册、重开和 migration orchestration，避免同时承载旧身份迁移、schema repair、baseline normalization、测试 fixture 和路径清理。

- [ ] 先标注旧 identity 迁移代码为后续 D+10 清理范围，本轮不围绕它做拆分。
- [ ] 复查剩余函数，分组为 pool lifecycle、migration source、schema repair、baseline normalization、test helpers。
- [ ] 如果 schema repair 仍超过局部可读范围，考虑新增 `src-tauri/src/data/schema_repair.rs`。
- [ ] 将 legacy schema repair 相关函数移动到 `data/schema_repair.rs`，但仅限当前 `patina.db` schema 直升保护。
- [ ] 将 baseline normalization helper 保持在 `data` 层，不进入 `app` 或 `commands`。
- [ ] 保持 `initialize_app_sqlite` 对外签名稳定。
- [ ] 保持 `reopen_sqlite_pool` 对外签名稳定。
- [ ] 保持 `wait_for_sqlite_pool` 对外签名稳定。
- [ ] 移动测试时优先保留原断言语义，不改成只测函数存在。
- [ ] 运行：

```bash
npm run check:rust
```

- [ ] 再运行：

```bash
npm run check:full
```

### 4.3 `data/repositories/tools.rs` 收口

owner：`src-tauri/src/data/repositories/*`。  
目标：把工具页持久化仓储按提醒、计时器、番茄钟、快照、备份恢复分开，同时不把业务流程推回 `engine/tools` 或 `commands/tools`。

- [ ] 列出当前公开函数清单。
- [ ] 标注每个函数属于 reminder、software reminder、timer、pomodoro、snapshot、backup restore、row mapping 中的哪一类。
- [ ] 选择模块形态：将 `tools.rs` 转为 `tools/mod.rs`，并新增同 owner 子模块。
- [ ] 候选子模块：
  - [ ] `reminders.rs`
  - [ ] `software_reminders.rs`
  - [ ] `timers.rs`
  - [ ] `pomodoro.rs`
  - [ ] `snapshot.rs`
  - [ ] `restore.rs`
  - [ ] `rows.rs`
- [ ] `tools/mod.rs` 只保留 public re-export、共享常量和少量组合函数。
- [ ] 不改变 `engine/tools` 的调用语义。
- [ ] 不改变 Tauri command 参数或返回 DTO。
- [ ] 不把 SQL 写入 `engine/tools`。
- [ ] 不把 SQL 写入 `commands/tools`。
- [ ] 迁移后运行：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --quiet tools
```

- [ ] 再运行：

```bash
npm run check:rust
```

### 4.4 `backup.rs` 与 `remote_backup.rs` 收口

owner：`src-tauri/src/data/*` 与 `src-tauri/src/platform/webdav.rs`。  
目标：让备份格式、预览、安全判断、导出、恢复、远程索引各自清楚，避免恢复链路继续膨胀。

- [ ] 先把旧 backup identity 和旧 remote path merge 标注为后续 D+10 清理范围，本轮只收口非兼容备份复杂度。
- [ ] 复查 `backup.rs` 中 manifest、zip IO、preview、restore、export、test helper 的边界。
- [ ] 如果仍明显偏厚，考虑建立 `src-tauri/src/data/backup/` 子模块目录。
- [ ] 候选子模块：
  - [ ] `format.rs`
  - [ ] `preview.rs`
  - [ ] `export.rs`
  - [ ] `restore.rs`
  - [ ] `checksums.rs`
- [ ] 保持 `cmd_export_backup`、`cmd_restore_backup`、`cmd_preview_backup` 调用路径不变。
- [ ] 保持 restore strategy 语义不变。
- [ ] 不把 WebDAV HTTP 细节放入 backup format 模块。
- [ ] 对远程备份的当前 Patina 产品路径保持现有语义不变。
- [ ] 运行：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --quiet backup
```

- [ ] 运行：

```bash
npm run test:settings
```

- [ ] 运行：

```bash
npm run check:rust
```

### 4.5 `engine/tracking/runtime.rs` 收口

owner：`src-tauri/src/engine/tracking/*`。  
目标：保持 runtime 主循环编排薄化，不把 transition、metadata、power lifecycle、startup sealing、session timeout 重新揉回主文件。

- [ ] 先列出 `runtime.rs` 中仍承载的非编排函数。
- [ ] 如果函数已经有相邻 owner 模块，优先移动到相邻 owner。
- [ ] power lifecycle 相关逻辑归 `engine/tracking/runtime/power_lifecycle.rs` 或现有 power owner。
- [ ] window polling 相关逻辑归 `engine/tracking/runtime/window_polling.rs`。
- [ ] loop state 相关逻辑归 `engine/tracking/runtime/loop_state.rs`。
- [ ] session transition 相关逻辑归 `engine/tracking/transition.rs`。
- [ ] startup sealing 相关逻辑归 `engine/tracking/startup.rs`。
- [ ] 不改变 tracking event reason 字符串。
- [ ] 不改变 Tauri event 名称。
- [ ] 不改变 SQLite session 写侧语义。
- [ ] 运行：

```bash
cargo test --manifest-path src-tauri/Cargo.toml --quiet tracking
```

- [ ] 运行：

```bash
npm test
```

- [ ] 运行：

```bash
npm run test:replay
```

- [ ] 运行：

```bash
npm run check:full
```

### 4.6 前端 AppShell 和大页面收口

owner：`src/app/*` 与对应 `src/features/*`。  
目标：降低 UI 维护成本，不改变用户操作路径，不新增视觉方向。

- [ ] 先确认 browser smoke 已稳定通过。
- [ ] `AppShell.tsx` 只拆跨 feature 编排辅助，不把 feature 私有规则拉进 app。
- [ ] AppShell 可优先提取：
  - [ ] read model refresh effect 组合
  - [ ] cache invalidation effect 组合
  - [ ] background return home effect 组合
  - [ ] page props builder
- [ ] `History.tsx` 只拆 feature-owned presentational 子组件。
- [ ] `Data.tsx` 只拆 feature-owned chart、heatmap、range panel、app trend 子组件。
- [ ] 拆分后的组件继续使用 Quiet Pro 现有 CSS 和 shared components。
- [ ] 不把 page-local helper 放进 `shared/*`，除非已证明是稳定跨 feature 能力。
- [ ] 不改变现有 copy key 和语言切换行为。
- [ ] 运行：

```bash
npm run test:ui-smoke
```

- [ ] 运行：

```bash
npm run test:ui-browser-smoke
```

- [ ] 运行命中的 feature 测试：

```bash
npm run test:data
npm run test:data-range
npm run test:data-chart
npm run test:interaction
```

- [ ] 最后运行：

```bash
npm run check:full
```

## 5. 阶段 D：增加防回流护栏

目标：让 9.0+ 不是一次性整理结果，而是后续不容易回落。

### 5.1 旧身份防回流

- [ ] 本轮不新增会禁止现有旧兼容代码的硬性边界脚本。
- [ ] D+10 清理完成后，再决定是否新增旧身份边界检查脚本。
- [ ] 如果新增，命名为 `scripts/check-legacy-identity-boundaries.ts` 或合并进现有 release policy 测试。
- [ ] 检查范围默认包括 `src-tauri/src`、`src`、`scripts`。
- [ ] 测试文件中只允许明确的“拒绝旧格式”fixture 保留旧词。
- [ ] `docs/archive` 和历史 changelog 不纳入运行时代码检查。
- [ ] 将检查接入 `npm run check` 或 `npm run release:check` 前先评估误报成本。
- [ ] 新增自测，确保脚本能捕获旧 identifier、旧数据库名、旧 credential target。

### 5.2 厚文件防回流

- [ ] 决定是否新增轻量体量报告脚本，而不是硬性阻断。
- [ ] 如果新增，只报告高风险 owner 文件超过阈值，不阻止文档、copy、tokens、CSS 这类天然长文件。
- [ ] 初始阈值建议：
  - [ ] Rust `commands/*` 超过 250 行需要人工复核。
  - [ ] Rust `lib.rs` 超过 120 行需要人工复核。
  - [ ] 前端 `src/app/AppShell.tsx` 超过 600 行需要人工复核。
  - [ ] Rust `data/*` 单文件超过 1500 行需要人工复核。
  - [ ] Rust `engine/tracking/runtime.rs` 超过 1000 行需要人工复核。
- [ ] 不把体量阈值作为机械评分依据，只作为 review 提醒。

### 5.3 Browser smoke 防回流

- [ ] 在 browser smoke 测试中保留真实 Vite server + browser 路径。
- [ ] 保留 Dashboard 首屏、主导航、Settings 弹窗、console error、横向溢出检查。
- [ ] 如果新增 optimizeDeps 限制，补一条注释说明是为了避免扫描 Tauri build artifacts。
- [ ] 不把 browser smoke 改成 SSR-only。
- [ ] 不删除 `test:ui-browser-smoke` 在 `check:frontend` 中的位置。

## 6. 阶段 E：性能与资源复核

目标：确保结构收口没有用性能换整洁。

### 6.1 基准测试

- [ ] 跑历史读模型基准：

```bash
npm run perf:history-read-model
```

- [ ] 跑 Dashboard 读模型基准：

```bash
npm run perf:dashboard-read-model
```

- [ ] 跑启动 bootstrap 基准：

```bash
npm run perf:startup-bootstrap
```

- [ ] 记录每项输出和预算。
- [ ] 如果某项超过预算，先判断是测试环境波动还是真实回归。
- [ ] 不在没有测量依据时做性能优化。

### 6.2 资源与运行时复核

- [ ] 如果改动 Windows platform 资源管理，检查 RAII guard 是否仍表达释放责任。
- [ ] 如果改动 foreground/window/icon/media/audio 查询，检查缓存、negative cache、in-flight 合并和退避是否仍合理。
- [ ] 如果改动 widget 生命周期，确认短时间反复展开/收起仍走快速复用路径。
- [ ] 如果改动 tracking 主链，确认 AFK、锁屏、睡眠、暂停、startup sealing、watchdog sealing 都有测试覆盖。

## 7. 阶段 F：发布与最终验收

### 7.1 最终自动验证

- [ ] 运行默认完整质量门槛：

```bash
npm run check:full
```

- [ ] 运行发布检查：

```bash
npm run release:check
```

- [ ] 如果目标版本已确定，运行指定 changelog 校验：

```bash
npm run release:validate-changelog -- <version>
```

- [ ] 单独复跑 browser smoke：

```bash
npm run test:ui-browser-smoke
```

- [ ] 单独复跑 Rust：

```bash
npm run check:rust
```

- [ ] 单独复跑 bundle：

```bash
npm run check:bundle
```

### 7.2 最终人工审查

- [ ] 重新检查 top 40 最大文件，确认剩余厚文件都有合理 owner。
- [ ] 重新检查旧词搜索结果。
- [ ] 重新检查 `commands/*`、`lib.rs`、`app/*` 是否保持薄。
- [ ] 重新检查 `shared/*` 是否没有变成临时桶。
- [ ] 重新检查 `platform/*` 是否没有变成万能目录。
- [ ] 重新检查 browser smoke 是否仍覆盖真实浏览器路径。
- [ ] 重新检查 D+10 独立清理文档是否处于未到期待执行、延期、已执行后归档三者之一。

### 7.3 最终评分

- [ ] 给出新的综合评分。
- [ ] 给出新的架构评分。
- [ ] 给出新的工程质量评分。
- [ ] 明确是否达到 `9.0+`。
- [ ] 明确仍未达到 `9.0+` 时的阻塞项。
- [ ] 明确剩余风险是否影响发布。
- [ ] 若长期规则发生变化，回写 top-level `docs/engineering-quality.md` 或 `docs/architecture.md`。
- [ ] 若只是阶段事实，不回写长期文档，归档本文。

## 8. 推荐执行顺序

1. [ ] 阶段 A：修复 browser smoke / Vite dep-scan 红灯。
2. [ ] 阶段 B：做非兼容架构复评。
3. [ ] 阶段 C：只对仍明显偏厚的 owner 文件做收口。
4. [ ] 阶段 D：补防回流护栏。
5. [ ] 阶段 E：跑性能与资源复核。
6. [ ] 阶段 F：完整发布级验收并重新评分。
7. [ ] 后续：到 D+10 且满足准入后，按独立清理文档执行兼容清理。

## 9. 非目标

- [ ] 不新增产品功能。
- [ ] 不改变 Quiet Pro 视觉方向。
- [ ] 不扩张到团队 SaaS、云同步、账号体系或移动端。
- [ ] 不重写 tracking runtime。
- [ ] 不把前端 SQLite 通道一次性迁移到 Rust，除非另写执行单。
- [ ] 不为了降低文件行数牺牲 owner 清晰度。
- [ ] 不为了通过测试降低测试覆盖。
- [ ] 不在本方案中执行正式发布；发布需要另按版本与发布规范执行。
