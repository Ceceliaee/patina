# 架构与工程质量 9.0+ 可勾选执行文档

> 状态：已完成，已归档  
> 文档类型：临时执行文档 / How-to  
> 位置：`docs/archive/architecture-engineering-quality-9-plus-execution-plan-2026-05-13.md`  
> 基线日期：2026-05-13  
> 最近复核：2026-05-14，已补齐归档完成态、验证记录与未完成项说明  
> 基线评分：架构 8.3 / 工程质量 8.1 / 综合 8.2  
> 目标评分：综合 9.0+  
> 适用对象：后续维护者、仓库协作者、Codex 类 repository-aware agent

## 0. 使用规则

- [x] 本文曾作为当前一轮架构与工程质量提升的执行依据；归档后只保留为完成记录。
- [x] 完成后已移动到 `docs/archive/`，不再长期留在 `docs/working/`。
- [x] 未把本文当作长期母文档；只有长期规则或真实架构事实变化时才更新顶层 `docs/`。
- [x] 执行中优先遵守顶层长期文档：[`../architecture.md`](../architecture.md)、[`../engineering-quality.md`](../quality.md)、[`../quiet-pro-component-guidelines.md`](../ui.md)、[`../product-principles-and-scope.md`](../product.md)、[`../roadmap-and-prioritization.md`](../product.md#优先级)、[`../issue-fix-boundary-guardrails.md`](../quality.md#修复与回归证据)、[`../versioning-and-release-policy.md`](../release.md)。
- [x] 所有 Markdown 文件保持 UTF-8。
- [x] 未通过 PowerShell `>`, `>>`, `Set-Content`, `Out-File` 改写 Markdown 或源码文件。
- [x] 每个阶段先判断 owner，再决定文件位置和实现方式。
- [x] 未为了降低行数做目录美容式拆分。
- [x] 未为了 9.0+ 引入新的长期中间层、兼容壳或跨层 facade。
- [x] 当前工作区已有用户改动时，先读 diff 并保护它们，没有擅自还原。

## 1. 当前基线

本轮基线来自 2026-05-13 的仓库检查。评分口径按长期文档优先级：可靠性与验证 > 代码质量 > 性能。

当前分数：

- 架构：`8.3 / 10`
- 工程质量：`8.1 / 10`
- 可靠性与验证：`8.8 / 10`
- 性能：`8.5 / 10`
- 综合：`8.2 / 10`

当前强项：

- `npm run check:full` 通过。
- 前端边界检查、命名检查、所有现有 TS 测试、构建、bundle budget 通过。
- Rust `cargo check` 与 108 个 Rust 测试通过。
- 三个性能脚本通过且在预算内。
- 前端根层只保留 `app / features / shared / platform`。
- Rust 根层只保留 `app / commands / data / domain / engine / platform`。
- `src/lib`、`src/types` 没有回潮。
- `src-tauri/src/lib.rs` 保持薄入口。
- 前端 Tauri / SQLite 访问基本收在 `platform/*`。

当前主要扣分项：

- Rust `engine/tracking/*` 仍直接持有 `Pool<Sqlite>` / `sqlx` 类型，核心行为层与数据实现耦合偏近。
- `src/shared/lib/sessionReadRepository.ts` 从 `platform/persistence` re-export 类型，是薄兼容壳，但仍属于 `shared -> platform` 的边界异味。
- `src/App.css` 约 4094 行，主题 token、组件原型、页面布局和局部修正规则过于集中。
- `SettingsAppearancePanel.tsx` 维护主题 swatch 列表，和 `App.css` 中的主题 token 存在同步成本。
- `cargo clippy -- -D warnings` 当前失败 11 项，其中包含两个参数过多的结构信号。
- 默认质量门槛没有包含 clippy。
- 前端没有 ESLint / Prettier 等通用静态质量工具，主要依赖 TypeScript strict 与自定义边界脚本。
- UI smoke 仍偏最小化，缺少真实浏览器/WebView 交互级验证。

本文创建前工作区已存在的代码改动：

- `src-tauri/src/domain/update.rs`
- `src-tauri/src/engine/updater.rs`
- `src/App.css`
- `src/features/dashboard/components/Dashboard.tsx`
- `src/features/update/services/updateViewModel.ts`
- `tests/updateViewModel.test.ts`

这些代码改动不属于本文创建动作；后续执行时必须先确认它们的意图，避免覆盖。

本文创建后已完成一轮顶层长期文档同步，当前工作区还会看到以下长期文档改动：

- `docs/architecture.md`
- `docs/issue-fix-boundary-guardrails.md`
- `docs/product-principles-and-scope.md`
- `docs/quiet-pro-component-guidelines.md`
- `docs/versioning-and-release-policy.md`

这些文档改动用于让长期事实与当前仓库状态对齐；后续执行阶段仍应以最新 `git status --short` 和 diff 为准。

## 2. 目标定义

本轮目标不是“看起来更整齐”，而是把综合评分稳定提升到 `9.0+`，并能用代码边界、验证命令和文档事实支撑。

达到 `9.0+` 必须同时满足：

- [x] 关键 Rust 行为层不再直接依赖 SQLite 实现细节，已通过明确的数据端口/仓储边界隔离。
- [x] `shared/*` 不再反向承接平台 persistence 类型壳。
- [x] CSS / 主题系统从单体文件和手写同步列表中明显收敛。
- [x] clippy 清零，并进入默认 Rust / 完整质量门槛。
- [x] 当前完整质量门槛继续通过。
- [x] 性能预算继续通过。
- [x] UI smoke 覆盖从 SSR 最小渲染提升到真实浏览器/Vite 页面路径。
- [x] 顶层长期文档与本轮真实结果一致。

## 3. 非目标

- [x] 未扩展产品方向到团队 SaaS、云同步、移动端优先或游戏化生产力。
- [x] 未重写 tracking 主链。
- [x] 未为降低文件行数做无收益拆分。
- [x] 未恢复根层 `src/lib/` 或 `src/types/`。
- [x] 未把 `shared/*` 变成新的临时桶。
- [x] 未把 `platform/*` 变成困难问题收容区。
- [x] 未把 Rust `commands/*` 或 `app/*` 变成业务中心。
- [x] 未改变 Quiet Pro 的长期 UI 方向。
- [x] 未在本轮引入大型依赖或新框架。

## 4. 分数路径

| 阶段 | 预计综合分 | 说明 |
| --- | ---: | --- |
| 基线 | 8.2 | gate 强，但 Rust 数据耦合、shared 壳、CSS/主题集中、clippy 缺口明显 |
| 完成阶段 1 | 8.35-8.45 | 工作区与基线锁定，避免误伤已有改动 |
| 完成阶段 2 | 8.55-8.70 | clippy 清零并纳入门槛，工程质量余量提升 |
| 完成阶段 3 | 8.75-8.90 | Rust engine/data 边界收口，架构核心扣分下降 |
| 完成阶段 4 | 8.85-9.00 | shared 薄壳退役，前端边界更干净 |
| 完成阶段 5 | 8.95-9.10 | CSS/主题系统收敛，Quiet Pro 可维护性提升 |
| 完成阶段 6-8 | 9.0+ | 验证、性能、文档和最终复评闭环 |

## 5. 阶段 1：锁定工作区与验证基线

### 目标

确认当前工作区状态、既有改动归属和验证基线，避免后续执行覆盖用户改动或基于旧结论行动。

### 执行清单

- [x] 运行 `git status --short`，记录当前所有改动。
- [x] 对当前所有已修改文件运行 `git diff --stat`。
- [x] 阅读已修改文件的 diff，区分本文创建前已有代码改动、长期文档同步改动与后续执行改动。
- [x] 确认刚同步的长期文档不会在后续执行中被旧计划或旧结论覆盖。
- [x] 如需继续改动这些文件，先确认改动不会覆盖已有意图。
- [x] 重新运行 `npm run check:full`。
- [x] 重新运行三个性能脚本。
- [x] 重新运行 `cargo fmt --manifest-path src-tauri/Cargo.toml --check`。
- [x] 重新运行 `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`，记录失败项。
- [x] 若终端中文输出乱码，用 `-Encoding UTF8` 重新读取，不判定源码损坏。

### 建议命令

```powershell
git status --short
git diff --stat
npm run check:full
npm run perf:history-read-model
npm run perf:dashboard-read-model
npm run perf:startup-bootstrap
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

### 完成标准

- [x] 当前工作区改动归属清楚。
- [x] 完整 gate 仍通过。
- [x] 性能脚本仍通过。
- [x] clippy 失败项已修复，最终通过结果已记录到本文执行证据区。

## 6. 阶段 2：清零 Clippy 并纳入质量门槛

### 目标

让 Rust 静态质量从“能编译能测试”提升到“默认不带明显 lint 债”。这是从 8.x 到 9.x 的低风险高收益步骤。

### 当前已知失败类型

- `needless_borrow`
- `single_match`
- `needless_borrows_for_generic_args`
- `too_many_arguments`
- `manual_find`
- `unnecessary_cast`
- `cast_abs_to_unsigned`

### 执行清单

- [x] 修复 `src-tauri/src/app/tray.rs` 中的 needless borrow。
- [x] 将 `src-tauri/src/app/tray.rs` 中单分支 `match` 改为清晰的 `if`。
- [x] 修复 `src-tauri/src/data/backup.rs` 中的 needless generic borrow。
- [x] 修复 `src-tauri/src/platform/windows/icon.rs` 中无意义 cast。
- [x] 使用 `unsigned_abs()` 替代 `abs() as u32`。
- [x] 将 `resolve_tracking_status` 的 8 个参数整理为输入 struct，放在 `domain/tracking.rs` 的真实 owner 内。
- [x] 将 `resolve_tracking_status_with_runtime` 的 11 个参数整理为输入 struct，放在 `engine/tracking/sustained_participation.rs` 相邻 owner 内。
- [x] 修复 `manual_find`，同时保持可读性。
- [x] 运行 `cargo fmt --manifest-path src-tauri/Cargo.toml`。
- [x] 运行 `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings`。
- [x] 运行 `npm run check:rust`。
- [x] 新增 `check:rust:clippy` 并接入 `check:rust` / `check:full`。
- [x] 更新 `docs/engineering-quality.md` 中 Rust 默认质量门槛描述。

### Owner 判断

- [x] 机械 lint 修复留在原文件。
- [x] 参数 struct 只在真实 owner 内建立，未放进 `shared` 或 `data`。
- [x] 纯领域状态输入放在 `domain/tracking`。
- [x] 带 runtime state 的输入放在 `engine/tracking`。

### 验收门槛

- [x] `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` 通过。
- [x] `npm run check:rust` 通过。
- [x] clippy 进入本地可重复脚本。
- [x] 长期文档已记录 clippy 属于默认完整门槛。

## 7. 阶段 3：收口 Rust Engine 与 SQLite 数据边界

### 目标

降低 `engine/tracking/*` 对 SQLite 具体实现的耦合，让核心行为层依赖更明确的数据端口或仓储接口，而不是到处持有 `Pool<Sqlite>`。

### 当前候选点

- `src-tauri/src/engine/tracking/runtime.rs`
- `src-tauri/src/engine/tracking/continuity.rs`
- `src-tauri/src/engine/tracking/active_session.rs`
- `src-tauri/src/engine/tracking/session_timeout.rs`
- `src-tauri/src/engine/tracking/startup.rs`
- `src-tauri/src/engine/tracking/metadata.rs`
- `src-tauri/src/engine/tracking/watchdog.rs`
- `src-tauri/src/engine/updater.rs`
- `src-tauri/src/engine/widget.rs`

### 推荐路线

不要一次性抽象全仓库 repository trait。优先按真实高频链路做小步收口：

1. 先定义 tracking runtime 所需的数据操作集合。
2. 将 SQL 具体调用继续留在 `data/repositories/*`。
3. 让 `engine/tracking/*` 通过小的 data-facing function 或 port 调用。
4. 测试优先覆盖行为，不强求立刻 mock 掉所有数据库。

### 执行清单

- [x] 盘点 `engine/tracking/*` 中所有 `use sqlx::{Pool, Sqlite}`。
- [x] 按行为分组列出需要的数据能力：active session、tracker settings、continuity、metadata、startup seal、watchdog seal。
- [x] 标记哪些函数只是转发 repository，哪些函数包含真实 engine 行为。
- [x] 对 active session 链路先做最小收口。
- [x] 将连续性启动与 active session 相关数据写入细节收口到 data-facing owner。
- [x] 保留 engine 对 icon cache side effect 的编排 owner，并通过 runtime data store 包装数据访问。
- [x] 对 startup seal 链路做第二个收口点。
- [x] 对 watchdog/session_timeout 链路做第三个收口点。
- [x] 每完成一个收口点，运行 Rust tracking 相关测试。
- [x] 避免把所有数据函数塞入一个新的万能 `data/tracking_service.rs`。
- [x] 新模块按能力命名为 `data/tracking_runtime.rs`。
- [x] 更新 tracking runtime 相关 owner 事实，并在长期架构文档中记录边界变化。

### 硬性验收

- [x] `engine/tracking/runtime.rs` 生产代码不再直接 import `sqlx`。
- [x] 至少 3 个 `engine/tracking/*` 文件移除 `Pool<Sqlite>` 直接类型依赖。
- [x] `commands/*` 和 `app/*` 没有因此变厚。
- [x] `data/*` 承接的是数据边界，不承接 runtime 流程判断。
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --quiet` 通过。
- [x] `npm run check:full` 通过。

### 停止条件

- [x] 未触发：没有为收口重写 tracking 主循环。
- [x] 未触发：没有出现万能 tracking data service。
- [x] 未触发：行为测试没有大量失效。

## 8. 阶段 4：退役 `shared/lib/sessionReadRepository.ts` 薄壳

### 目标

消除 `shared -> platform` 的反向依赖异味，让 session read model 类型有稳定归属。

### 当前问题

`src/shared/lib/sessionReadRepository.ts` 当前只是：

```ts
export type {
  DailySummary,
  HistorySession,
} from "../../platform/persistence/sessionReadRepository.ts";
```

这很薄，但 `shared/lib` 仍依赖 `platform/persistence`，不符合长期边界口径。

### 推荐路线

- 将 `HistorySession`、`DailySummary` 等稳定前端读模型类型移动到 `src/shared/types/history.ts` 或 `src/shared/types/sessions.ts`。
- `platform/persistence/sessionReadRepository.ts` 返回这些 shared types。
- `shared/lib/sessionReadCompiler.ts` 从 shared type 文件导入类型。
- feature read model 从 shared type 文件导入类型，而不是从 shared lib 兼容壳导入。
- 最后删除 `src/shared/lib/sessionReadRepository.ts`。

### 执行清单

- [x] 查找所有 `shared/lib/sessionReadRepository` 调用方。
- [x] 新建稳定类型 owner 文件。
- [x] 将 `HistorySession`、`DailySummary` 类型迁入新 owner。
- [x] 更新 `platform/persistence/sessionReadRepository.ts` 导入类型。
- [x] 更新 `shared/lib/sessionReadCompiler.ts` 导入类型。
- [x] 更新 Dashboard / History / Data 相关 feature 导入。
- [x] 删除 `src/shared/lib/sessionReadRepository.ts`。
- [x] 将 `check:naming` 和 `check:architecture` 自测确认仍通过。
- [x] 增加边界检查规则：`src/shared/**` 不允许导入 `src/platform/persistence/**`。

### 验收门槛

- [x] `rg -n "platform/persistence" src/shared` 无结果。
- [x] `rg -n "sessionReadRepository" src/shared/lib src/features src/app` 不再指向旧薄壳。
- [x] `npm run check` 通过。
- [x] `npm run test:replay` 通过。

## 9. 阶段 5：收敛 CSS 与主题系统

### 目标

降低 `App.css` 和 `SettingsAppearancePanel.tsx` 的长期维护成本，让 Quiet Pro token、主题库和页面局部规则有清楚 owner。

### 当前问题

- `src/App.css` 包含约 4094 行样式。
- 主题 token、基础组件、页面布局、Dashboard 修正规则混在同一文件。
- `SettingsAppearancePanel.tsx` 中的 `COLOR_SCHEME_OPTIONS` 手写 swatch 与 CSS token 分离维护。
- 仍有少量硬编码颜色、圆角、阴影在 CSS 后段出现。

### 推荐路线

不引入 CSS-in-JS 或新 styling 框架。优先做文件内 owner 分区或小文件拆分：

- `src/styles/tokens.css`
- `src/styles/quiet-pro.css`
- `src/styles/app-shell.css`
- `src/styles/features/dashboard.css`
- `src/styles/features/settings.css`

如果当前构建习惯更适合单入口，也可以保留 `App.css` 作为 import 汇总入口。

### 执行清单

- [x] 盘点 `App.css` 中所有一级区块，标注 token、primitive、app shell、feature page、widget、dialog、responsive。
- [x] 保留 `App.css` 作为总入口，避免一次性修改所有 import。
- [x] 抽取 token 与 theme scheme 到独立文件。
- [x] 抽取 Quiet Pro component primitive。
- [x] 抽取 Dashboard 局部规则。
- [x] 抽取 Settings / theme dialog 局部规则。
- [x] 将 `COLOR_SCHEME_OPTIONS` 的 swatch 数据迁到共享主题定义文件。
- [x] 保证新增主题数据 owner 不在 page component 内部。
- [x] 检查硬编码颜色：保留业务分类色和 swatch，其他 chrome 优先走 token。
- [x] 检查硬编码 radius/shadow：优先走 Quiet Pro token。
- [x] 未改变视觉方向，未引入大面积渐变、重阴影、玻璃拟态。

### 验收门槛

- [x] `App.css` 不再是全部样式事实来源，职责明显变薄。
- [x] 主题列表和主题 token 有单一数据 owner 或清楚同步规则。
- [x] Settings 页面不再维护大段 theme library 常量。
- [x] Dashboard 当前布局修复仍保留。
- [x] `npm run build` 通过。
- [x] `npm run test:ui-smoke` 通过。
- [x] 真实浏览器 smoke 检查无明显布局破坏。

### 停止条件

- [x] 未触发：拆 CSS 没有导致大量页面样式回归。
- [x] 未触发：没有需要改动 Quiet Pro 长期视觉方向。

## 10. 阶段 6：增强 UI Smoke 与交互验证

### 目标

把 UI 验证从最小 SSR smoke 提升到能发现真实浏览器布局、控制台错误和核心导航问题的水平。

### 推荐路线

优先使用现有 Vite + browser automation 能力，不急于引入大型 E2E 套件。如果引入 Playwright，需要确保 CI 成本可接受。

### 执行清单

- [x] 确认当前 `test:ui-smoke` 覆盖范围和局限。
- [x] 增加真实 Vite 页面 smoke：启动 Vite，打开主界面，检查 console error。
- [x] 检查主导航入口：Dashboard、History、Data、App Mapping、Settings、About。
- [x] 检查 Settings theme dialog 能打开并关闭。
- [x] 检查 Dashboard 在当前 responsive layout 下无明显横向溢出。
- [x] 检查 widget shell 覆盖范围；本轮真实浏览器 smoke 聚焦主窗口核心路径。
- [x] 将 smoke 命令接入 `check:frontend` / `check:full`。
- [x] 不适用：真实浏览器 smoke 成本可接受，未采用手动 fallback。

### 验收门槛

- [x] 有一条可重复 UI smoke 命令覆盖真实浏览器页面。
- [x] smoke 不依赖外部网络。
- [x] smoke 失败时能定位到页面或 console 错误。
- [x] `npm run check:full` 仍通过，且 UI browser smoke 已属于完整门槛。

## 11. 阶段 7：评估前端通用静态质量工具

### 目标

在不破坏当前 TypeScript strict 与自定义边界脚本的前提下，补上基础 lint/format 守门。

### 本轮结论

本轮未引入 ESLint / Prettier，也不把它们作为 9.0+ 阻塞项。原因是当前收益不够抵消一次性配置与潜在格式化 diff 成本；本轮已经把更高风险的质量缺口补到默认门槛中，包括 TypeScript strict、自定义架构边界脚本、Rust clippy、SSR UI smoke、真实浏览器 UI smoke、构建、bundle budget、Rust check/test。

### 执行清单

- [x] 评估是否引入 ESLint，结论是本轮暂不引入。
- [x] 评估如果引入 ESLint 的范围，结论是后续应先针对 `src`、`tests`、`scripts` 启用低争议规则。
- [x] 评估是否引入 Prettier，结论是本轮暂不强制全仓格式化。
- [x] 明确本轮不新增 `lint`、`format:check`、`format` 脚本。
- [x] 避免一次性格式化全仓导致大量无关 diff。
- [x] 未将新 lint 工具接入 `check`；改由现有 TypeScript strict、自定义边界脚本和新增 clippy / browser smoke 提升默认门槛。
- [x] 更新 `docs/engineering-quality.md` 的默认验证门槛，记录本轮真实新增项。

### 验收门槛

- [x] 本轮采用可接受替代：不新增前端通用 lint/format 脚本。
- [x] TypeScript strict、自定义边界脚本、UI smoke、构建与 bundle budget 均通过。
- [x] 没有产生大量无关格式化 diff。
- [x] 没有让通用 lint 与现有 `check:naming`、`check:architecture` 职责冲突。

### 可接受替代

如果本阶段成本大于收益，可以暂不引入 ESLint/Prettier，但必须满足：

- [x] TypeScript strict 继续通过。
- [x] 自定义边界脚本继续覆盖架构核心风险。
- [x] 在本文最终复评中说明为什么通用 lint 不阻塞 9.0。

## 12. 阶段 8：最终验证、文档回写与归档

### 目标

用可重复命令和代码边界证明综合评分达到 9.0+，并把阶段性计划归档。

### 最终验证命令

```powershell
git status --short
npm run check:full
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
npm run perf:history-read-model
npm run perf:dashboard-read-model
npm run perf:startup-bootstrap
rg -n "platform/persistence" src/shared
rg -n "from .*platform/persistence|platform/persistence" src/features
```

### 文档回写清单

- [x] clippy 进入默认门槛后，已更新 [`../engineering-quality.md`](../quality.md)。
- [x] Rust engine/data 边界发生长期事实变化后，已更新 [`../architecture.md`](../architecture.md)。
- [x] CSS/主题 owner 发生长期事实变化后，已更新 [`../quiet-pro-component-guidelines.md`](../ui.md)。
- [x] release gate 增加新验证后，已更新 [`../versioning-and-release-policy.md`](../release.md)。
- [x] 未把本文的阶段步骤复制进长期文档。
- [x] 已将本文完成状态、验证结果、最终评分写入执行证据区。
- [x] 已将本文移动到 `docs/archive/`。

### 最终复评清单

- [x] 架构评分重新评估。
- [x] 工程质量评分重新评估。
- [x] 可靠性与验证评分重新评估。
- [x] 性能评分重新评估。
- [x] 综合评分重新计算。
- [x] 所有未完成项都有明确残余风险说明。
- [x] 不适用：综合未低于 9.0，没有 9.0+ 阻塞项。

## 13. 不达标时的止损规则

执行中出现以下情况时，应暂停：

- [x] 未触发：清理 `engine/sqlx` 耦合没有让 `commands/*` 或 `app/*` 变厚。
- [x] 未触发：退役 `shared` 薄壳没有建立新的跨层 facade。
- [x] 未触发：拆 CSS 没有制造大量页面局部 hardcode。
- [x] 未触发：没有为引入 lint 产生大规模无关格式化 diff。
- [x] 未触发：通过 clippy 没有写出明显更难读的代码。
- [x] 未触发：提高分数没有降低 tracking、backup、restore、release 的可信度。
- [x] 未触发：`npm run check:full` 没有变得过慢或不稳定。

## 14. 执行证据记录区

> 最终完成记录（2026-05-13）：本轮已完成 Rust tracking 数据边界收口、clippy 接入完整门槛、shared 薄壳退役、CSS/主题 owner 收敛、真实浏览器 UI smoke 增强、性能预算复核与长期文档回写。执行文档完成后移入 `docs/archive/`，不再作为 `docs/working/` 中的活动计划。

### 14.1 基线记录

- [x] 基线 `git status --short`：
  - 记录：执行前工作区已有长期文档、Rust tracking、前端读模型、update、Dashboard 与 `App.css` 等阶段性改动；执行中按 diff 继续承接，没有回滚既有改动。
- [x] 基线 `npm run check:full`：
  - 结果：最终复核通过；该命令现包含前端测试、SSR UI smoke、真实浏览器 UI smoke、构建、bundle budget、Rust check/test/clippy。
- [x] 基线 clippy：
  - 结果：`cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` 最终通过，并通过 `npm run check:rust:clippy` 纳入 `check:full`。
- [x] 基线性能：
  - `history-read-model`：通过；current average `66.954ms` / budget `170ms`。
  - `dashboard-read-model`：通过；average `18.237ms` / budget `25ms`。
  - `startup-bootstrap`：通过；average `0.0032ms` / budget `1.5ms`。

### 14.2 Clippy 清零记录

- [x] 修改文件：
  - 记录：清理 Rust lint，整理 `resolve_tracking_status` / sustained participation 输入结构，并保留 owner 在 `domain/tracking.rs` 与 `engine/tracking/sustained_participation.rs`。
- [x] 新增脚本：
  - 记录：新增 `npm run check:rust:clippy`，并由 `npm run check:rust` / `npm run check:full` 调用。
- [x] 验证结果：
  - 记录：`npm run check:full` 与独立 clippy 均通过。

### 14.3 Rust 数据边界收口记录

- [x] 修改文件：
  - 记录：新增 `src-tauri/src/data/tracking_runtime.rs`，并让 runtime、transition、metadata、session_timeout、watchdog、power lifecycle、continuity、startup 等生产路径通过 `TrackingRuntimeDataStore` 访问数据能力。
- [x] 移除的 `engine` 直接 `sqlx` 依赖：
  - 记录：`runtime.rs`、`continuity.rs`、`session_timeout.rs`、`startup.rs`、`watchdog.rs` 等生产代码不再直接持有 `Pool<Sqlite>`；剩余 `sqlx` 使用主要在 engine 测试辅助与断言中。
- [x] 新增或调整的数据 owner：
  - 记录：`TrackingRuntimeDataStore` 承接 active session、tracker timestamp、startup self-heal、icon cache 与 runtime settings 数据端口。
- [x] 验证结果：
  - 记录：`npm run check:full` 通过；Rust `cargo check`、108 个 Rust 测试与 clippy 通过。

### 14.4 Shared 薄壳退役记录

- [x] 删除或替换的文件：
  - 记录：删除 `src/shared/lib/sessionReadRepository.ts`。
- [x] 新类型 owner：
  - 记录：新增 `src/shared/types/sessions.ts` 作为 `HistorySession` / `DailySummary` 的稳定前端读模型类型 owner。
- [x] 边界检查结果：
  - 记录：`rg -n "platform/persistence" src/shared` 无结果；`check:architecture` 增加 `shared-no-platform-persistence` 自测并通过。

### 14.5 CSS / 主题系统收敛记录

- [x] 新增或拆分的样式文件：
  - 记录：`src/App.css` 变为 CSS 入口；样式拆入 `src/styles/tokens.css`、`src/styles/quiet-pro.css`、`src/styles/app-shell.css`、`src/styles/features/settings.css`、`src/styles/features/dashboard.css`。
- [x] 主题数据 owner：
  - 记录：新增 `src/shared/settings/colorSchemeOptions.ts`，Settings 组件不再维护主题 swatch 列表。
- [x] UI smoke / build 结果：
  - 记录：`npm run test:ui-smoke`、`npm run test:ui-browser-smoke`、`npm run build`、`npm run check:bundle` 均通过。

### 14.6 UI Smoke 增强记录

- [x] 新增命令：
  - 记录：新增 `npm run test:ui-browser-smoke`，并接入 `npm run check:frontend` / `npm run check:full`。
- [x] 覆盖页面：
  - 记录：真实 Vite 页面中覆盖 Dashboard 首屏、Dashboard/History/Data/App Mapping/Settings/About 主导航、Settings 主题弹窗打开/关闭、Dashboard 横向溢出检查。
- [x] console error 检查：
  - 记录：通过 headless Edge/Chrome CDP 捕获 `console.error`、runtime exception 与 browser log error；最终为零。

### 14.7 最终复评记录

- [x] 最终架构评分：`9.1 / 10`
- [x] 最终工程质量评分：`9.2 / 10`
- [x] 最终可靠性与验证评分：`9.3 / 10`
- [x] 最终性能评分：`8.8 / 10`
- [x] 最终综合评分：`9.1 / 10`
- [x] 评分理由：关键 Rust 数据边界已有实质端口收口，shared 反向 persistence 薄壳退役，CSS/主题 owner 清晰，完整门槛包含 clippy 与真实浏览器 UI smoke，性能预算保持通过。
- [x] 残余风险：未引入 ESLint/Prettier；engine 测试中仍直接使用 sqlx 断言数据库状态；真实浏览器 smoke 依赖本地或 CI 环境存在 Edge/Chrome/Chromium。
- [x] 后续建议：后续只在真实改动触及时继续压缩测试内 sqlx 辅助与补前端通用 lint，不为形式整齐再做大范围搬迁。

### 14.8 归档完整性复核

- [x] 归档文档顶部位置已从 `docs/working/` 改为 `docs/archive/`。
- [x] 已完成目标、阶段验收、最终验证、文档回写和 9.0+ 宣布条件均已改为完成态。
- [x] 未执行或暂不执行的 ESLint / Prettier 路径已改为明确的可接受替代说明。
- [x] 止损规则已从待办项改为“未触发”记录，避免误读为未完成任务。
- [x] `docs/working/` 不再保留本轮计划文件。

## 15. 正式宣布 9.0+

以下判断已经同时成立，因此本轮可以正式把综合分上调到 `9.0+`：

- [x] `npm run check:full` 通过。
- [x] `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` 通过。
- [x] 三个性能脚本通过。
- [x] Rust engine/data 边界至少完成一轮实质收口。
- [x] `shared/lib/sessionReadRepository.ts` 已退役，且不再形成 `shared -> platform/persistence` 依赖。
- [x] CSS / 主题系统有清楚 owner，`App.css` 明显变薄并作为样式入口。
- [x] UI smoke 不再只依赖最小 SSR，已有真实浏览器 Vite 验证路径。
- [x] 顶层长期文档与当前事实一致。
- [x] 没有引入新的高吸力层回流。
- [x] 没有把本轮计划长期滞留在 `docs/working/`。

最终结论：本轮综合评分 `9.1 / 10`，可以宣布达到 `9.0+`。
