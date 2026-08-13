# 开发版与安装版运行身份隔离修复执行方案

> 状态：已完成、已归档
>
> 日期：2026-08-13
>
> 事故范围：昨晚工具页与挂件改造后，debug 进程以正式版身份启动并迁移正式数据库，导致旧安装版工具页无法读取新版 schema。

## 1. 目标

- [x] 保留开发版与安装版同时运行的产品能力。
- [x] 明确正式版、开发版、本地验证版各自拥有独立身份、数据目录、缓存目录和单实例作用域。
- [x] 让常用开发命令默认且自动使用 Dev 配置，不依赖开发者记住额外参数。
- [x] 即使绕过 npm 启动入口，debug 构建也不能打开正式版持久化目录。
- [x] 隔离修复不修改、不降级、不删除正式数据库及用户数据。
- [x] 不改变正式 `tauri build`、安装包和发布配置。
- [x] 完成自动化验证、真实双进程 smoke、对抗式审查和归档。

## 2. 第一性原理

### 2.1 运行身份先于进程是否共存

两个进程能否安全共存，不取决于它们是否同时运行，而取决于它们是否共享会产生副作用的资源。Patina 的资源集合包括：

- Tauri identifier；
- 单实例锁；
- roaming 数据目录与 `patina.db`；
- 数据 anchor、备份和导出默认目录；
- WebView 用户数据与缓存；
- updater 和运行时持久化状态。

因此安全条件是：

```text
safe coexistence
  = distinct runtime identity
  + distinct persistent roots
  + fail-closed debug guard
  + release command unchanged
```

### 2.2 migration 不能解决并发版本兼容

数据库 migration 的职责是把同一产品身份的数据从旧 schema 单向升级到新 schema。它不能保证旧二进制在新 schema 上继续工作，也不能作为开发版与安装版共享数据库的协调协议。

只要新 migration 删除、重命名或改变旧二进制依赖的结构，共享数据库就会让旧安装版失效。因此根治点必须位于运行入口和路径 owner，而不是在工具页补 try/catch，或长期保留两套业务表。

### 2.3 双层保护

单层脚本保护不足，因为开发者可以直接调用 CLI 或 Cargo；单层 Rust 保护也不足，因为错误只能到运行时才暴露。采用：

1. 入口层自动选中 `tauri.dev.conf.json`；
2. `platform/app_paths.rs` 在 debug + production identity 组合下失败关闭。

自动化 runtime smoke 只有同时声明 `PATINA_E2E=1` 和绝对 `PATINA_E2E_DATA_ROOT` 时可以绕过身份限制，并必须把所有持久化路径指向该根目录。

## 3. 已确认事实

- [x] 安装版进程路径为 `%LOCALAPPDATA%/Patina/Patina.exe`。
- [x] 旧 debug 进程路径为仓库 `src-tauri/target/debug/patina.exe`。
- [x] 两个进程可以同时存在；共存本身不是错误。
- [x] 默认 `tauri.conf.json` identifier 是 `com.ceceliaee.patina`。
- [x] `tauri.dev.conf.json` 已定义 `Patina Dev`、`PatinaDev` 和 `com.ceceliaee.patina.dev`。
- [x] 旧 `package.json` 的 `tauri` script 直接转发 CLI，`npm run tauri dev` 没有自动传 Dev 配置。
- [x] schema migration 13 已把工具提醒表迁为通用活动提醒表；旧安装版仍读取旧表。
- [x] 首次只读检查时，正式数据库 migration head 已是 13，新表数据存在，旧表不存在；这证明 debug 曾打开正式库。
- [x] 未改动的 1.9.3 安装版重新运行后自行把 migration head 归一到 12 并重建空旧表；该现象进一步证明新旧二进制不能共享数据库。本修复没有执行手工修库、逆向 migration 或兼容补写。
- [x] 不执行数据库回滚、手工建兼容表或删除正式数据。

## 4. Owner 与范围

### 4.1 允许修改

- [x] `scripts/tauri-cli.ts`：开发命令参数策略与 Tauri CLI 透传。
- [x] `package.json`：把统一 Tauri 入口接到 wrapper，并纳入快速测试。
- [x] `src-tauri/src/platform/app_paths.rs`：身份与持久化路径的 fail-closed owner。
- [x] `tests/tauriProfileIsolation.test.ts`：配置和命令合同。
- [x] `README.md`、`CONTRIBUTING.md`、`docs/architecture.md`：长期使用与架构规则。
- [x] 本执行方案：记录证据、验证、审查和归档状态。

### 4.2 明确非目标

- [x] 不改工具页 React 读取逻辑掩盖 schema 错误。
- [x] 不改 migration 13，不恢复被替代的旧表为长期双写结构。
- [x] 不让安装版和开发版轮流升级、降级同一数据库。
- [x] 不改变正式版 identifier、正式数据目录或安装路径。
- [x] 不在当前脏工作区生成或安装正式安装包。
- [x] 不发布版本、不推送远端、不创建 tag 或 Release。

## 5. 执行步骤

### 阶段 A：建立可失败合同

- [x] 新增测试：`tauri dev` 无显式配置时必须插入 `src-tauri/tauri.dev.conf.json`。
- [x] 新增测试：额外 dev 参数必须原样保留。
- [x] 新增测试：显式 local/E2E 配置不得被 wrapper 覆盖。
- [x] 新增测试：`tauri build` 与 bundle 参数不得获得 Dev 配置。
- [x] 新增测试：生产与开发配置的 identifier、productName、mainBinaryName 必须不同。
- [x] 先运行测试并确认缺少 wrapper 时失败。

退出条件：测试能准确区分开发入口保护和正式构建不变性。

### 阶段 B：修复开发入口

- [x] 新增一个纯参数规划函数，识别全局参数后的 `dev` 子命令；仅在没有显式 config 时插入 Dev 配置，并忽略 `--` 之后的 runner 参数。
- [x] 使用 Node 当前解释器直接调用仓库锁定的 `@tauri-apps/cli`，不依赖 shell 字符串拼接。
- [x] CLI cwd、环境变量、stdio 和退出码保持透传。
- [x] `package.json` 的 `tauri` script 接入 wrapper。
- [x] 快速测试套件纳入 profile isolation test。
- [x] 验证 `npm run tauri -- --help` 与 `npm run tauri -- dev --help` 可用。

退出条件：维护者继续使用原命令即可获得隔离 Dev 身份，release 子命令无行为变化。

### 阶段 C：补平台级失败关闭

- [x] 在 `platform/app_paths.rs` 定义“debug production profile 不允许持久化访问”的纯规则。
- [x] Dev 与 Local profile 在 debug 构建中允许访问各自目录。
- [x] release production profile 保持允许。
- [x] E2E 例外必须同时有开关和绝对隔离根目录。
- [x] E2E 直连 `product_roaming_data_dir` / `product_webview_data_dir` 时也必须返回隔离根，避免测试碰正式目录。
- [x] 错误消息必须给出安全启动命令与配置文件，不返回模糊数据库错误。
- [x] 增加 Rust 单元测试覆盖允许/拒绝矩阵。

退出条件：任何普通 debug + production identity 路径在创建目录或打开 SQLite 前失败。

### 阶段 D：文档与长期约束

- [x] README 说明开发版与安装版可同时运行且数据隔离。
- [x] CONTRIBUTING 中英文开发命令旁增加身份规则。
- [x] `docs/architecture.md` 记录运行身份与持久化隔离的唯一 owner 和 fail-closed 原则。
- [x] 完成后把本执行单状态改为“已完成、已归档”，移入 `docs/archive/`。

退出条件：后续协作者不需要依赖事故记忆就能使用安全入口并理解边界。

### 阶段 E：自动化验证

- [x] profile isolation Node test 通过。
- [x] Tauri root/dev help 参数透传通过。
- [x] `platform::app_paths` Rust 单元测试通过。
- [x] debug 与 release 两种 profile 下的 `platform::app_paths` 定向测试通过（各 7/7）。
- [x] `cargo check --release --locked` 通过，证明 release 生产路径正常编译。
- [x] `cargo fmt --check` 通过。
- [x] `git diff --check` 通过。
- [x] `npm run test` 通过。
- [x] `npm run test:replay` 通过（15/15）。
- [x] `npm run build` 通过；沙箱内原生 Tailwind 模块被 Windows `EPERM` 限制，按既有授权在非沙箱环境重跑后成功。
- [x] `npm run check:full` 已执行；本任务涉及的静态检查、测试、102 项浏览器 smoke 和构建均通过，仅并行存在的本地化改动触发三项既有 gzip headroom 门槛，见第 8 节。
- [x] `npm run test:tauri-runtime-smoke` 通过，且 smoke 的导出与数据库路径严格落在 E2E 隔离根。

退出条件：满足 SQLite、Rust runtime 和仓库默认完整门槛。

### 阶段 F：运行态收口

- [x] 按可执行文件绝对路径识别安装版与旧 debug 进程。
- [x] 只停止仓库 `target/debug/patina.exe`，不停止安装版进程。
- [x] 以安全入口 `npm run tauri -- dev --no-watch` 启动 Dev smoke。
- [x] 验证正式 `%LOCALAPPDATA%/Patina/Patina.exe` 与仓库 `target/debug/patina.exe` 可同时存在。
- [x] 验证安装版与 Dev 的进程路径、Tauri identifier 和产品目录对应预期。Cargo dev runner 仍名为 `patina.exe`；`mainBinaryName` 只约束正式 bundle，不能把这一事实误写成 `PatinaDev.exe`。
- [x] 验证 `%APPDATA%/Patina Dev/patina.db` 被独立初始化。
- [x] 验证 Dev 的持久化写入只落到 `%APPDATA%/Patina Dev`；隔离修复未打开或修复正式数据库。安装版本身继续运行时可能正常写入正式库，因此不使用不可靠的“文件时间不变”作为判据。
- [x] smoke 完成后只停止本次启动的 Dev 进程；安装版保持运行且可执行文件未被替换。

退出条件：真实 Windows 环境证明“共存 + 隔离”，而不是只证明配置文本不同。

## 6. 对抗式审查清单

- [x] 绕过 npm wrapper，直接让 debug 使用生产配置时，Rust guard 仍会在返回持久化根目录前拒绝。
- [x] 显式 `--config`、`-c`、`--config=...`、`-c=...` 不会被重复注入。
- [x] `build`、`bundle`、`info` 等非 dev 子命令完全透传；`npm run tauri -- build --help` 未获得 Dev 配置。
- [x] Dev 配置通过独立 Tauri identifier 改变单实例与系统路径作用域，而不只改窗口标题。
- [x] Dev 数据 anchor 由独立产品目录拥有，不读取正式版目录 anchor。
- [x] E2E 直接调用数据与 WebView 路径时必须返回显式绝对隔离根，不会退回 `%APPDATA%/Patina`。
- [x] 正式 release 不会被 debug guard 误拒绝；守卫调用均受 `#[cfg(debug_assertions)]` 限定，release 定向测试和 `cargo check --release` 已通过。
- [x] 当前修复没有长期双表、双写、兼容读取或 schema 回滚；曾评估的兼容实验已完整移除并以定向 `git diff --exit-code` 复核。
- [x] 当前验证没有执行 `tauri build`、安装或覆盖用户安装版；只调用了 `build --help` 和普通前端构建。
- [x] 工作区其他未提交改动被保留，没有批量格式化、覆盖或归入隔离实现。

## 7. 完成定义

- [x] 常用开发命令无需额外记忆即可安全启动 Dev profile。
- [x] 入口被绕过时仍有 Rust fail-closed 防线。
- [x] 开发版和安装版可同时运行，各自使用独立数据与单实例作用域。
- [x] 正式数据库没有被本隔离实现写入、回滚、修复或删除。
- [x] 正式 build 参数路径不变，release 编译通过。
- [x] 本任务要求的自动化门槛通过；完整门禁中与本任务无关的本地化 bundle headroom 超限已单独记录，没有用修改阈值掩盖。
- [x] 对抗式审查完成，发现项已修正或明确记录。
- [x] 执行单全部勾选并归档。

## 8. 当前结果记录

- 根因不是“开发时必然不能同时运行安装版”，而是 Dev 配置存在但未接入默认启动入口。
- 之前长期看似正常，是因为旧 schema 变化仍被旧二进制容忍；migration 13 首次把潜在身份冲突暴露成可见故障。
- 用户明确决策：安装版是最终设计基线；不以兼容写法、双表、逆 migration 或修库来适配开发失误。实现只修复开发入口与 debug 路径 owner。
- 当前已安装的 1.9.3 可执行文件保持原路径、版本与修改时间，验证期间未构建安装包、未覆盖安装目录。
- 真实共存 smoke：安装版使用 `%APPDATA%/Patina`，Dev 使用 `%APPDATA%/Patina Dev`；完成后仅清理 Dev 进程。
- `npm run check:full` 的任务相关步骤全部通过；最终 bundle budget 因并行未提交的本地化变更失败：initial localization 7.22 KiB（3% headroom 后超过 7.4 KiB）、zh-CN 9.67 KiB（超过带 headroom 的 9.9 KiB）、en-US 9.19 KiB（超过带 headroom 的 9.4 KiB）。隔离改动不进入这些前端 locale chunks，因此不在本任务修改阈值或并行功能代码。
- 对抗式审查补强了三处：wrapper 能识别全局参数后的 `dev`、不会把 `--` 后传给 runner 的 `--config` 误认为 Tauri 配置、且 release 守卫辅助函数仅在 debug 或测试编译中存在。
