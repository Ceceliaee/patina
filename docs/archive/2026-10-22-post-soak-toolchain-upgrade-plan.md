# 长测结束后的工具链升级执行方案

> 状态：2026-10-23 原升级及跨仓共同工具对齐均已完成、勾选归档，并完成对抗式审查。Node、pnpm、Tauri CLI 和共同依赖 / Actions 已采用；Rust 独立验证完成并暂缓采用。未运行的远端 CI、ARM64 和发布验收已转交 SYBao。
> 创建：2026-10-22；更新：2026-10-23
> 执行 owner：后续工具链维护任务的执行者；范围与最终取舍由维护者 SYBao 确认。
> 启动条件：现有长测结束、结果已审阅，且 SYBao 再次明确要求执行。时间到达、监测完成通知或本计划存在都不触发执行。
> 关联：[长期后台运行可靠性整改执行方案](../working/2026-10-17-background-runtime-reliability-plan.md)。该计划拥有长测状态、时长、候选身份与验收结论；本文不复制其运行记录。

## 1. 目标和范围

在保留长测修复及其证据的前提下，升级 Node、pnpm 和 Tauri CLI，使本机与 CI 使用可复现、经过验证的版本组合。Rust 编译器另设对照验证阶段，结果单独签收。Vite 和 TypeScript 保持当前版本。

2026-10-22 仅登记方案；2026-10-23 长测结束后，SYBao 已授权执行升级、独立验证、勾选归档及完成后的对抗式审查。本次工具链工作不替换正式应用，不包含提交、推送或发布授权，也不启动新的自动跟进。

第 1 至 13 节记录原升级阶段；随后授权的共同依赖与 Actions 对齐由第 14 节单独持有，原阶段的锁图和验证结论不追溯扩大到追加候选。

| 项目 | 本计划的处理 | 范围边界 |
| --- | --- | --- |
| Node | 留在 24 LTS，升级到重新核实的安全维护版本 | 不顺带切换到新的大版本 |
| pnpm | 在 12 系列升级，验证原生程序、安装和审计链路 | 不新增安装策略、override 或宽泛脚本许可 |
| Tauri CLI | 更新项目内 `@tauri-apps/cli` 及必要的关联锁文件条目 | 不顺带升级 Tauri API、Rust crate 或插件 |
| Rust | 固定依赖图，分别验证旧、新编译器 | 先报告采用或暂缓的依据；默认版本的变更单独签收 |
| Vite / TypeScript | 保持当前声明和解析结果 | 不借重装、锁文件迁移或兼容性修复更新它们 |
| 其他依赖与发布 | 只观察变化及失败原因 | 新的依赖修复、版本发布、安装交付另按实际范围处理 |

本计划不要求先提交长测修复才能开始验证，但验证输入必须包含已确认保留的修复，且能与工具链改动逐项区分。提交、推送、分支、PR、tag、Release、Issue 和 Project 操作继续遵循 [AGENTS.md](../../AGENTS.md) 与 [CONTRIBUTING.md](../../CONTRIBUTING.md)，本计划不预授予这些权限。

## 2. 从第一性原理推导执行顺序

一次验证的对象不是版本号或 HEAD，而是“源码字节、两个锁文件、工具链、构建配置、宿主环境、目标架构”的组合。存在未提交修复时，HEAD 尤其不能代表完整测试输入。只有相关输入一致，旧证据才可能复用。

工具升级改变的是不同环节，必须观察各环节实际产出的结果：

| 环节 | 可能改变的事实 | 相应验证 |
| --- | --- | --- |
| Node 执行脚本 | TypeScript 去类型执行、模块加载、子进程、构建和测试行为 | 仓库原有前端质量入口及脚本测试 |
| pnpm 安装依赖 | 解析版本、平台可选包、安装布局、脚本执行许可、审计返回 | 冻结安装、依赖图比较、审计及最终完整门槛 |
| Tauri CLI 编排构建 | Cargo 调用、目标识别、开发配置合并、产物与打包行为 | CLI 入口、profile 测试、release 模式构建、真实桌面测试 |
| Rust 编译原生代码 | 编译诊断、优化、ABI、链接、原生资源生命周期 | 同源码与依赖的编译器对照、Rust 门槛和真实 Windows 行为 |
| Windows / WebView2 执行产物 | IPC、窗口恢复、记录落盘和进程回收 | 真实桌面证据；编译成功不能代替执行成功 |

因此先固定旧基线，再依次改变 Node、pnpm、Tauri CLI，最后形成主线候选；Rust 从主线候选另做对照。中间阶段用于定位问题，最终候选仍需完成适用的完整门槛。不要把每个阶段的结果拼成一个从未整体验证过的组合。

长测证明的是原候选在原环境中的表现。更换编译器或重新构建后，记录新产物摘要并补足受影响证据；不把原长测写成新产物已经通过的长测。是否需要新的持续观察，按实际差异、风险和长测计划中的验收要求决定，不在这里自动新增或启动另一轮长测。

## 3. 已核实的版本快照和真实 owner

下表是 2026-10-22 的检查结果，用于准备方案。执行时重新核对本地配置、实际命令和上游发布信息，再固定精确版本；不在安装命令里使用 `latest` 或浮动 `stable`。

| 工具 | 当前配置 / 解析版本 | 待复核候选 | 选择依据 |
| --- | --- | --- | --- |
| Node | `24.21.0` | `24.22.1` | [官方 24.22.1 LTS 安全发布](https://nodejs.org/en/blog/release/v24.22.1)；保持同一 LTS 系列 |
| pnpm | `12.3.4` | `12.15.0` | [官方 12.15.0 发布](https://github.com/pnpm/pnpm/releases/tag/v12.15.0)；同一主版本维护更新 |
| Tauri CLI | 声明 `^2.11.4`，解析 `2.11.4` | `2.12.4` | [官方 CLI 2.12.4 发布](https://github.com/tauri-apps/tauri/releases/tag/tauri-cli-v2.12.4)；需验证构建与打包兼容性 |
| Rust | `1.94.1` | `1.99.1`，仅独立验证 | [官方 1.99.1 发布](https://blog.rust-lang.org/2026/10/15/Rust-1.99.1/)；不能从新版修复清单推定旧版一定受影响 |
| Vite | 声明、解析均为 `8.2.4` | 保持 `8.2.4` | 用户明确暂不升级 |
| TypeScript | 声明 `~6.0.3`，解析 `6.0.3` | 保持声明和 `6.0.3` 解析结果 | 用户明确暂不升级；仓库脚本仍使用其编译器 API |

版本和命令以以下机器来源为准。执行时更新真实 owner，不在长期文档再维护一份版本清单。

| 内容 | owner / 入口 | 本次预计变化 |
| --- | --- | --- |
| Node 精确版本 | [`.node-version`](../../.node-version)、[`package.json`](../../package.json) 的 `engines.node` | 同步修改两处 |
| pnpm 精确版本 | `package.json` 的 `packageManager`、`engines.pnpm` | 同步修改两处 |
| Tauri CLI 与 JS 依赖图 | `package.json`、[`pnpm-lock.yaml`](../../pnpm-lock.yaml) | 只更新 CLI 必需条目 |
| 安装策略 | [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) | 保持不变 |
| Rust 精确版本及组件 | [`rust-toolchain.toml`](../../rust-toolchain.toml) | 独立实验先不修改；采用时才修改 |
| 应用 Rust 依赖图 | [`src-tauri/Cargo.toml`](../../src-tauri/Cargo.toml)、[`src-tauri/Cargo.lock`](../../src-tauri/Cargo.lock) | 工具链实验不更新依赖 |
| 版本检查与 CLI 包装 | [`scripts/check-toolchain.ts`](../../scripts/check-toolchain.ts)、[`scripts/tauri-cli.ts`](../../scripts/tauri-cli.ts) | 使用现有契约，不放宽校验 |
| 验证范围和 CI | [工程质量默认门槛](../engineering-quality.md#5-默认验证门槛)、`package.json`、[验证工作流](../../.github/workflows/verify.yml) | 核对 CI 继续从同一版本来源读取 |

## 4. G0：启动门槛

以下项目全部具备后才进入 G1。状态未明确时只补充计划和读取已有证据。

- [x] **G0-01** 从关联长测计划和实际结果确认长测已经结束；审阅有效时长、候选身份、退出原因和验收结论。预计结束时间或单个 `measurementComplete` 字段不等于完整验收通过。
- [x] **G0-02** 确认原任务是否仍需取证、修复、复测或保留特定运行环境。如果仍有依赖原工具链的工作，先由维护者决定先后顺序，不借本计划抢占环境。
- [x] **G0-03** 记录 SYBao 在长测结束后明确启动工具链工作的指令、时间和范围。只有“长测结束”通知而没有执行指令时，保持待启动。
- [x] **G0-04** 确认本次执行者、工作目录和证据目录；检查仍运行的开发服务、测试控制器及应用，保留其路径、PID 和创建时间。不要按进程名批量终止，也不要为了升级重启正式应用。
- [x] **G0-05** 重新核实第 3 节候选的版本、发布时间、撤回情况、平台支持和发行说明。若需要跨主版本或同时修改冻结项，先记录范围变化，由维护者决定；没有变化则按已授权范围继续。

**启动记录（2026-10-23）：** SYBao 明确要求开始执行至完成并归档，随后开启对抗式审查。第五轮完整测量与资源尾差风险接受决定由关联计划保留，当前无正式长测运行。已保存 1,264 个源文件的原始字节和摘要，独立 detached 工作区包含全部未提交修复；旧桌面验证的 953 项输入逐项一致。上游复核仍选用表中精确候选，pnpm 与 CLI 均已超过 24 小时等待期且未撤回。证据目录为 `artifacts/toolchain-upgrade/20261023-172642/`，不包含用户数据或凭据。

## 5. G1：保存基线和安排隔离验证

### 5.1 保存完整输入

- [x] **G1-01** 读取 `git status --short`、`git diff --stat`、`git diff --cached --stat`、`git rev-parse HEAD` 和 `git ls-files --others --exclude-standard`。分别登记已有修复、已有暂存内容、本计划文档和后续工具链改动，不操作暂存区。
- [x] **G1-02** 保存源文件清单及 SHA-256，包含构建 / 测试实际读取的未跟踪源码、配置和测试；另存两个锁文件、版本配置的摘要和原始字节。记录 Windows、MSVC / SDK、WebView2、Node、pnpm、Rust、Cargo、CLI 的实际版本与路径。敏感环境变量只记是否设置，不复制凭据。
- [x] **G1-03** 将证据放在新的忽略目录，例如 `artifacts/toolchain-upgrade/<本次唯一编号>/`。至少分为 `baseline`、`node`、`pnpm`、`tauri-cli`、`final`、`rust-control`、`rust-candidate`；保留失败日志，后续运行不覆盖同名记录。检查 `git check-ignore` 确认该目录不会进入提交。
- [x] **G1-04** 选择独立验证目录，使用同一份已确认源码和锁文件。若源码未提交，复制工作区的实际文件并核对清单、删除状态与摘要，不能只导出 HEAD 而丢失修复。已有适用隔离目录可复用；本计划不要求创建分支或 PR。
- [x] **G1-05** 为验证目录规划独立的 `node_modules` 和 Cargo 构建目录，实际安装留到 G2 完成代理检查后，不复用长测正在保存的产物路径。隔离副本应有属于自己的 Git 元数据供检查器使用，保留可追溯的原始基线；不要误用父目录仓库，也不要以空清单或缺失文件绕过扫描。
- [x] **G1-06** 比较源目录与副本的输入摘要。保存“基线 → 当前阶段”的差异，以便阶段回退只恢复该阶段的文件片段。不能使用 `git reset --hard`、`git clean` 或整文件恢复来丢弃共享工作区已有修改。

版本读取入口如下，先在原工作目录查询现有工具，逐条记录退出码；副本安装完成后再核对其结果一致：

```powershell
Get-Command node,pnpm,cargo,rustc -All | Select-Object Name,Source
node --version
pnpm --version
rustc -Vv
cargo -V
pnpm run tauri --version
pnpm run check:toolchain
Get-FileHash -Algorithm SHA256 .node-version,rust-toolchain.toml,package.json,pnpm-lock.yaml,src-tauri/Cargo.lock
```

## 6. G2：联网和工具切换准备

### 6.1 确认代理和独立工具环境

- [x] **G2-01** 在首次联网前检查实际工具的代理配置、当前进程 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` 及 Windows 系统代理状态；对 npm / pnpm、Git、Cargo / rustup、下载工具分别确认生效方式。报告脱敏后的配置来源，不输出带凭据的地址。
- [x] **G2-02** 沿用已有适用配置；工具未配置且系统启用了静态代理时，仅对本次命令或进程设置当前地址。系统只有 PAC 时先解析适用连接方式，不能把 PAC URL 当代理服务器。失败先验证代理可用性和工具实际使用情况，不默认转直连或改永久配置。
- [x] **G2-03** 对候选包检查当前 `minimumReleaseAge: 1440` 的准入及撤回状态；等待期未满足就等待或换用已符合要求的候选。保留 `engineStrict`、`verifyDepsBeforeRun`、`allowBuilds` 和现有 override，不为安装成功关闭它们。
- [x] **G2-04** 准备旧、新工具的可定位安装路径，优先使用独立版本目录和当前 PowerShell 进程的 PATH。保留旧工具以便回退，不一开始替换全机默认 Node / pnpm，不运行浮动的全局自更新命令。
- [x] **G2-05** 保存原进程 PATH 及本次要覆盖的 `RUSTUP_TOOLCHAIN`、`CARGO_TARGET_DIR`、`PATINA_COVERAGE_TARGET_DIR` 的原值 / 缺失状态。为每个阶段设置独立的 `CARGO_TARGET_DIR` 和 `PATINA_COVERAGE_TARGET_DIR`；后者覆盖 runtime harness 的构建目录，否则 harness 不沿用前者。退出阶段时恢复原值，原本未定义的变量恢复为未定义，不覆盖用户全局设置。

后续代码块是执行入口，不是已经执行的记录。每条命令都要检查退出码；任一步失败即停止依赖它的后续步骤。涉及安装和构建的命令只在 G0 完成后运行。

### 6.2 得到可比较的旧工具链结果

完成上述代理与目录准备后，才执行本小节的安装、联网审计和基线验证。

- [x] **G2-06** 用旧版本组合执行 `pnpm install --frozen-lockfile`，确认安装不改变锁文件，Vite / TypeScript 仍解析为冻结版本。安装失败先排查当前配置、代理和输入，不删除锁文件重算。
- [x] **G2-07** 按工程质量规则检查既有证据是否覆盖相同输入、工具链及环境。缺失或失效时执行 `pnpm run check:full`；相同输入的有效证据可以复用，必须注明来源和未重新执行的部分。
- [x] **G2-08** 为后续桌面比较保留旧组合的有效 runtime 证据；若没有匹配证据，在隔离目录运行 `pnpm run test:tauri-runtime-smoke`。先核对测试隔离设置及本阶段产物路径，再执行。
- [x] **G2-09** 将旧基线失败分为已有产品问题、工具链问题、环境 / 网络问题，并保留原始错误。旧基线不通过时不能把同一错误直接归咎于升级，也不能把旧失败改写成新候选通过；先解决或明确转交相应阻断事项。

长测修复仍未提交时，远端旧提交的失败只能作为线索。应使用当前已确认输入取得基线，尤其不能把应用 `Cargo.lock` 中已有的安全修复再次混入工具升级。

## 7. N：单独升级 Node

**控制变量：** pnpm、CLI、Rust 和两个锁文件保持基线版本。暂定目标为 `24.22.1`，以 G0 复核结果为准。

- [x] **N-01** 从目标版本的 Node 官方发布目录取得宿主架构对应的 Windows ZIP，例如 `node-v24.22.1-win-x64.zip`；ARM64 使用对应包。以该版本官方 `SHASUMS256.txt` 核对 SHA-256，记录下载来源与校验结果，再解压到本次工具目录。不要覆盖现有 `C:\Program Files\nodejs`。
- [x] **N-02** 在隔离验证目录用正常 UTF-8 文件编辑同步修改 `.node-version` 和 `package.json#engines.node`。保留文件中的其他改动，不修改 `engines.pnpm`、`packageManager` 或依赖版本。
- [x] **N-03** 将候选 Node 所在目录置于本次进程 PATH 前端，检查 `Get-Command node -All`、`node --version`、`node -p "process.execPath"`。继续使用旧 pnpm，运行 `pnpm run check:toolchain`，确认子命令实际使用候选 Node。
- [x] **N-04** 执行冻结安装并核对两个锁文件摘要。随后执行 `pnpm run check`，观察仓库现有的去类型脚本、测试、构建与 bundle 门槛是否正常；不改 TypeScript、Vite 或脚本开关来掩盖失败。
- [x] **N-05** 记录退出码、日志、输入摘要和实际 Node 路径。出现回归时以相同源码 / 依赖切回旧 Node 对照；能复现的差异先定位，再决定暂缓或安排最小兼容修复，不继续叠加下一项升级。

```powershell
node --version
node -p "process.execPath"
pnpm --version
pnpm run check:toolchain
pnpm install --frozen-lockfile
pnpm run check
```

**通过条件：** Node 的声明、实际路径和版本一致，锁文件不变，适用前端质量门槛通过。形成 N 阶段结果后再进入 P。

## 8. P：单独升级 pnpm

**控制变量：** 使用 N 阶段 Node，CLI 和 Rust 保持旧版本。暂定 pnpm `12.15.0`。

- [x] **P-01** 为候选 pnpm 创建独立安装前缀。可沿用 CI 的 npm 安装方式，并显式限定前缀和版本：`npm install --global --prefix <本次独立前缀> pnpm@12.15.0`。这里的前缀必须是本次工具目录的绝对路径，不使用默认全局位置；npm 只用于引导 pnpm，不在项目根执行 npm 依赖安装。
- [x] **P-02** 核对安装包的 bin 入口及宿主架构，找到其实际原生 `pnpm.exe`，记录路径和摘要。按 [pnpm 官方说明](https://pnpm.io/installation)，12 系列使用原生程序；仓库的 [审计入口](../../scripts/pnpm-audit.ts) 也校验原生入口，不能用旧 JavaScript 包装器冒充。
- [x] **P-03** 同步修改 `package.json#packageManager` 为 `pnpm@12.15.0`、`engines.pnpm` 为 `12.15.0`。将已确认的原生程序目录加入本次 PATH，核对 `Get-Command pnpm -All` 和 `pnpm --version`，避免项目版本选择机制悄悄切回旧版本。
- [x] **P-04** 首先执行 `pnpm install --frozen-lockfile`。若新 pnpm 不接受原格式，保存错误并确认是否确有格式迁移要求；只有必要时运行 `pnpm install --lockfile-only`，逐项解释差异后再冻结安装。格式更新不能夹带包版本漂移。
- [x] **P-05** 比较安装前后直接 / 传递依赖的名称、版本、integrity、平台可选包和安装策略。确认 Vite `8.2.4`、TypeScript `6.0.3` 及旧 CLI 解析不变，无新增 lockfile、override、脚本许可或来源改变。
- [x] **P-06** 运行下列工具链、审计行为测试和真实依赖审计；确认 `npm_execpath` 指向本次原生 pnpm。审计联网失败按 G2 排查，只有符合工程质量时效与摘要要求的离线证据才能标注为离线验证，不能冒充新鲜联网审计。

```powershell
pnpm --version
pnpm run check:toolchain
pnpm install --frozen-lockfile
pnpm list --depth 0
pnpm exec node -p "process.env.npm_execpath"
pnpm run test:dependency-audit
pnpm run check:dependencies
```

**通过条件：** 新 pnpm 可冻结安装相同依赖图，原生调用和审计链路通过。最终整体门槛仍在 F 阶段完成。

## 9. T：单独升级 Tauri CLI

**控制变量：** 使用 N、P 阶段工具，Rust 编译器和应用 Cargo 依赖保持基线。暂定 CLI `2.12.4`。

- [x] **T-01** 阅读候选 CLI 及跨越版本的发行说明，核对当前 Tauri API、Rust crate、插件、配置 schema 和最低 Rust 要求。CLI 版本号与应用 crate 版本号不要求机械同步；若真实兼容约束需要越界变更，记录具体约束并暂缓该项。
- [x] **T-02** 只将 `package.json` 中 CLI 声明改为 `^2.12.4`，再运行 `pnpm update @tauri-apps/cli@2.12.4 --lockfile-only`，核对实际写回的声明；保留原来的 caret 风格和指定的解析目标。禁止使用无包名的批量更新命令。
- [x] **T-03** 逐项审查 `pnpm-lock.yaml`：CLI 主包、Windows x64 / ARM64 及其他已声明的平台可选二进制应与目标版本配套；任何无关依赖变化都要还原或查明必要性。应用 `Cargo.lock`、Vite 和 TypeScript 保持原样。
- [x] **T-04** 执行冻结安装、CLI 版本 / 环境检查和 profile 测试。确认 `scripts/tauri-cli.ts` 的开发配置注入、显式配置传递及测试 profile 隔离继续有效，不启用忽略版本不匹配的开关。
- [x] **T-05** 在本阶段独立 Cargo 产物目录构建宿主架构的 release 模式程序，使用下列无 bundle 入口并保持 Cargo 锁定。保存二进制位置、SHA-256、构建日志和配置摘要；不运行或安装这个正式身份程序。
- [x] **T-06** 记录 CLI 内部依赖与应用依赖的审计边界。升级 CLI 不能据此宣称应用 `Cargo.lock` 的 advisory 已修复，应用审计仍按自己的锁文件执行。

```powershell
pnpm install --frozen-lockfile
pnpm run tauri --version
pnpm run tauri info
pnpm run test:tauri-profile
pnpm run tauri build --help
pnpm run tauri build --no-bundle --target x86_64-pc-windows-msvc -- --locked
```

上例构建目标适用于 x64 验证宿主；ARM64 原生宿主使用 `aarch64-pc-windows-msvc`。先从新 CLI 的帮助确认选项，再构建。无 bundle 构建证明构建入口与原生产物生成可用，不证明 NSIS 安装或 updater 可用。

## 10. F：主线候选整体签收

- [x] **F-01** 固定 Node + pnpm + CLI 的最终组合，保留旧 Rust。重新生成输入清单，确认三个工具配置一致，Vite / TypeScript 的声明和解析值未变，`Cargo.toml` / `Cargo.lock` 未被本次工具链任务改变。
- [x] **F-02** 在最终组合完成 `pnpm install --frozen-lockfile`、`pnpm run check:full`。命令组合以 `package.json` 为准；不因阶段测试通过而删除完整入口中的任何门槛。记录审计数据库 / 报告的新鲜度及最终锁文件摘要。
- [x] **F-03** 执行 `pnpm run test:tauri-runtime-smoke`。检查测试确实使用临时数据根、独立应用标识和本次 runtime 构建目录；现有 harness 的隔离实现见 [runtime smoke](../../tests/tauriRuntimeSmoke.test.ts)。该入口实际调用项目内 CLI，覆盖真实启动、IPC、数据库与窗口生命周期。
- [x] **F-04** 核对 runtime 日志中的候选路径、前端文件摘要、阶段结果与退出清理；记录恢复、重启、备份还原等已有断言的实际结果。失败先保留最后状态与原始日志，不自动重跑到成功、不提高超时或削弱断言。
- [x] **F-05** 核对 x64 与 ARM64 的原生验证安排。现有 CI 已提供两种原生 Rust 宿主；在获准推送后的对应候选 CI 或其他已授权原生环境补齐结果。x64 交叉编译只算编译证据，没有 ARM64 原生结果时明确登记缺口，不声称双架构验收完成。
- [x] **F-06** 对 CLI 的打包变化登记后续发布验收：两个架构的 NSIS、非管理员安装、保留数据路径、updater 签名及最终资产验证，按 [版本与发布规范](../versioning-and-release-policy.md) 执行。默认不在本地制造或安装正式包；没有发布 / 安装任务时将这些项目具名转交后续发布维护者，并注明尚未验证。
- [x] **F-07** 比较新旧结果，对二进制、依赖图、bundle 或资源指标的变化说明来源。若存在影响记录正确性或后台资源的信号，回到对应 owner 评估是否需要新增持续观察；没有证据时不声称升级后的长期稳定性已被旧长测证明。
- [x] **F-08** 将隔离目录的已验证最小差异应用回实际工作目录前，重新比较共享文件是否被其他任务改动。逐片段合并并复核输入；只有相关输入仍一致时才能复用隔离验证，否则重跑失效部分。
- [x] **F-09** 完成本机日常工具的采用：先记录当前安装方式、用户 / 系统 PATH 和回退入口，确认其他任务不再依赖旧工具路径；再按原有安装器或版本管理方式将默认 Node、pnpm 切到已验证的精确版本。Node 若仍由官方 Windows 安装器管理，使用已核验的对应架构安装包并保留原安装选项；pnpm 保持原生程序和一个明确入口。不要把临时证据目录长期加入 PATH，也不要遗留抢先解析的旧 shim。系统权限或其他任务占用使切换无法完成时，明确登记“隔离验证通过，本机默认工具待切换”。
- [x] **F-10** 新开普通 PowerShell 会话，在实际工作目录读取 `Get-Command node,pnpm -All`、实际版本、`process.execPath`，再执行 `pnpm run check:toolchain`、`pnpm install --frozen-lockfile`。确认这些结果不依赖实验会话的 PATH 或 Rust override，锁文件摘要不变；CI 与本机均继续读取同一仓库配置。环境切换若改变了其他相关输入，补足相应验证。

**阶段交付：** 可审查的 Node / pnpm / CLI 改动、完整门槛和真实桌面结果、仍未完成的架构或发布事项。不会因文档勾选而自动提交、推送或替换正式应用。

## 11. R：Rust 独立对照验证

Rust 阶段从已经固定的主线候选出发，保持源码、Node、pnpm、CLI、JS 锁文件和应用 Cargo 锁文件一致。升级编译器不能代替 Rust crate 的漏洞修复，也不能通过 `cargo update` 把两类变化混在一起。

- [x] **R-01** 确认后续启动指令包含 Rust 独立验证，固定旧版本与候选版本；阅读跨越版本的兼容性说明，重点检查 Windows MSVC、FFI、优化、链接以及依赖的最低 Rust 要求。暂定对照为 `1.94.1` 与 `1.99.1`。
- [x] **R-02** 用 rustup 并存安装精确候选及 `clippy`、`rustfmt`。不运行 `rustup update stable`、`rustup default` 或目录级永久 override。先保持 `rust-toolchain.toml` 原样，用进程范围 `RUSTUP_TOOLCHAIN` 选择实验版本。
- [x] **R-03** 为旧、新编译器分别使用独立 Cargo target 和 runtime target 目录，保留相同 MSVC / SDK / WebView2 环境；记录 `rustc -Vv` 和 `cargo -V`，防止 PATH 或 override 使两组实际使用同一编译器。
- [x] **R-04** 先获取旧编译器的有效对照结果，再在候选环境执行 `pnpm run check:rust`、`pnpm run check:dependencies` 和 `pnpm run test:tauri-runtime-smoke`。相同输入的 F 阶段旧编译器结果可复用；候选编译器结果必须独立取得。**执行完成，非全部通过：Clippy 退出 101，桌面焦点断言导致退出 1，详见 13.2。**
- [x] **R-05** 候选也完成 T 阶段的 release 模式无 bundle 构建，核对实际编译器及二进制身份。debug runtime 与 release 构建各自记录，不能互相代替；涉及优化或 ABI 的疑点需对 release 产物补充针对性执行证据。
- [x] **R-06** 重点审查现有真实 native helper、超时回收、退出 / 崩溃、Shell / COM、音频与句柄资源验证的覆盖情况。新增编译器告警、格式差异或行为回归逐项定位；不直接执行全仓格式化、不新增宽泛 lint 豁免，也不删除旧测试。
- [x] **R-07** 在 x64 与 ARM64 原生环境分别记录编译、测试和 Clippy 结果。交叉编译不能冒充 ARM64 执行；缺少环境时保留未完成项及责任人，不借本计划擅自推送以触发 CI。
- [x] **R-08** 汇总采用 / 暂缓建议，包括真实收益、兼容性代价、测试结果、资源差异及缺失证据。恢复旧 Rust 的进程选择；在采用结论单独签收前，仓库默认 `rust-toolchain.toml` 继续保持旧版本。
- **R-09（本次不适用，转交 SYBao）** 当前未采用候选；后续处理 13.2 的问题并明确采用后，再仅修改 `rust-toolchain.toml#channel`，保留组件和 profile。清除实验 override 后，以仓库配置驱动的实际工具重新核实版本，并按 `pnpm run check:full` 和真实桌面风险要求完成最终验收；相关输入未变的有效证据按工程质量规则复用，注明来源。需要源码兼容修复时独立列出差异、owner 和追加验证。承接条目为关联计划 T-02。

候选安装入口：

```powershell
rustup toolchain install 1.99.1 --profile minimal --component clippy --component rustfmt
```

候选验证示例；`<本次证据根>` 必须先换成 G1 已确认的绝对路径，旧版本按相同方法使用独立目录：

```powershell
$env:RUSTUP_TOOLCHAIN = '1.99.1'
$env:CARGO_TARGET_DIR = '<本次证据根>\rust-candidate\target'
$env:PATINA_COVERAGE_TARGET_DIR = '<本次证据根>\rust-candidate\runtime-target'
rustc -Vv
cargo -V
pnpm run check:rust
pnpm run check:dependencies
pnpm run test:tauri-runtime-smoke
```

`PATINA_COVERAGE_TARGET_DIR` 是当前 runtime harness 已有的构建目录覆盖入口；设置它不等于启用覆盖率采集。实验结束按 G2 保存值恢复环境。Rust 是否采用不阻止已经独立验收的 Node / pnpm / CLI 结果交付。

## 12. 停止条件与回退步骤

| 触发条件 | 立即动作 | 恢复或下一步 |
| --- | --- | --- |
| 长测或原任务仍依赖旧环境，或缺少启动指令 | 停在 G0 | 保留计划，等待真实结束和用户指令 |
| 输入摘要变化、共享文件出现新的并行改动 | 停止依赖旧基线的验证 / 合并 | 识别实际差异，重新固定输入并判断证据失效范围 |
| Vite / TypeScript、无关依赖或安装策略发生变化 | 不接受该阶段结果 | 只恢复本阶段差异，重新定向生成和审查锁文件 |
| Node / pnpm / CLI 回归 | 保存错误与输入，停止叠加下一升级 | 切回上一阶段工具和配置，使用同输入复现对照 |
| Rust 新告警、格式变化、链接或行为失败 | Rust 阶段保持未通过 | 保持旧默认编译器；最小修复或暂缓采用单独决策 |
| 网络 / 代理 / 审计新鲜度不满足 | 标记具体失败或未验证 | 排查 G2；恢复后补齐，不记为产品或工具兼容性通过 |
| 缺少 ARM64、打包或安装证据 | 明确相应结论的边界 | 指定后续环境 / 发布维护者，不冒充完整发行验收 |

- **RB-01（不适用）** 出现需回退的失败时，先保存版本、输入摘要、完整日志和最后可观察状态，标注失败阶段，保留证据目录。
- **RB-02（不适用）** 优先在隔离目录恢复上一阶段配置与锁文件的原始字节，并切回对应工具路径；若已合并回共享目录，先核对期间新改动，只撤回本任务的精确片段。本机默认工具已切换时，使用记录的安装器 / 版本管理入口恢复旧版本及必要的 PATH 变更，在新会话核实实际命令；期间新增的其他配置必须保留。
- **RB-03（不适用）** 以恢复后的对应 Node / pnpm 执行冻结安装及工具链检查，再补足确认恢复所需的受影响验证。恢复旧可执行文件而保留新锁文件不能算完整回退。
- **RB-04（不适用）** 只清理本任务创建且身份已核实的进程；删除或移动临时目录前确认绝对路径位于本次专属根目录。保留用户数据库、正式应用与长测证据，不用重装旧应用代替工具链回退。

本次未触发已采用工具链或本机安装的回退，以上恢复预案不适用。CLI 锁文件的无关依赖变化在签收前纠正；Rust 始终仅作进程级实验，没有先采用再回退。新旧 Node 安装器和原 pnpm 程序均已保留。临时测试进程由 harness 清理，隔离工作区已保存可恢复快照并归档；二进制与完整日志在清理前移存到本次证据根。

## 13. 结果登记与收口

每阶段记录实际命令、起止时间、退出码、工具路径 / 版本、输入摘要、目标架构、产物摘要、日志位置及偏差。表格只登记结果，不复制完整命令图或大体积日志。

| 阶段 | 实际输入 / 版本 | 检查与证据位置 | 结论 / 缺口 / 承接者 |
| --- | --- | --- | --- |
| G0 启动 | 2026-10-23 用户明确启动；长测结论由关联计划持有 | 本文第 4 节 | 启动条件具备 |
| G1 输入快照 | HEAD `70b265600b7839c84adcd3d7ad50bfb7c238b71b` 加 1,264 项实际输入；非仅 HEAD | `baseline.json`、`baseline-source/`、`overlay.json` | 隔离副本逐项一致；未操作暂存区 |
| G2 环境与旧基线 | Node 24.21.0、pnpm 12.3.4、CLI 2.11.4、Rust 1.94.1；Windows x64 | `baseline-full-1792747835716`；`baseline-runtime-comparison.json` | 完整门槛退出 0；旧桌面证据的 953 项输入一致 |
| N Node | 24.22.1，其余工具保持旧版本 | `node-install-1792748528311`、`node-check-1792748538790` | 冻结安装及完整前端门槛退出 0 |
| P pnpm | 12.15.0 原生程序；Node 24.22.1 | `pnpm-frozen-1792748895072`、`pnpm-audit-tests-1792748907767`、`pnpm-audit-1792748908990` | 安装与审计通过；应用依赖 YAML 文档逐字节不变 |
| T Tauri CLI | 2.12.4；应用 Cargo 图和 Rust 1.94.1 不变 | `cli-frozen-1792749081220`、`cli-profile-1792749178491`、`cli-release-1792749179119` | profile 4 项通过；x64 release 无 bundle 构建通过 |
| F 主线组合 | Node 24.22.1 / pnpm 12.15.0 / CLI 2.12.4 / Rust 1.94.1 | `final-full-1792749573769`、`final-runtime-1792750020345`、`default-tools.json` | 均通过，测试输入未变；本机默认工具切换及普通 PowerShell 冻结安装通过 |
| R Rust 对照 | 1.99.1，LLVM 23.1.1；其余输入与 F 一致 | `rust-check-1792750343495`、`rust-audit-1792750689452`、`rust-release-1792750725278`、`rust-runtime-1792751085289` | 格式、编译、测试、审计与 release 构建通过；Clippy 退出 101，桌面焦点断言导致退出 1；暂缓采用 |

证据均位于 `artifacts/toolchain-upgrade/20261023-172642/`；表中运行编号对应 `runs/<编号>/`，内含 `start.json`、`result.json` 和 `output.log`。输入摘要、命令、精确路径、环境、起止时间、退出码和原始失败输出保留在这些文件中。证据目录被 Git 忽略，未将日志、安装包或二进制加入源码。

### 13.1 依赖和运行结果

pnpm 初次冻结安装因旧包管理器元数据拒绝执行，随后只迁移首个 YAML 文档；应用依赖文档 SHA-256 仍为 `9d1b5eef1c2e12373bb0e5b2f51be7754435c7d0b6de30e09882f355ddd7af09`。CLI 定向更新曾额外把 Vite / ESLint 的 `jiti` peer 绑定从 2.6.1 改为 2.7.0，该结果被拒绝。保存原始输出后，保留 registry 生成的 CLI 条目并还原无关绑定；结构化比较与冻结安装确认其余应用依赖完全一致。最终锁文件 SHA-256 为 `25ba2896e3f943c8500ea7d0ef1bc565eaa7ad8dedee38a411626fa633293fe2`。

F 阶段完整门槛包含 899 项 Rust 库测试、1 项真实 helper 集成测试、9 项采样器测试、Clippy、浏览器场景和在线依赖审计；8 项 Rust 专项沿用原有忽略配置。桌面测试使用独立应用标识、临时数据库与独立 target，完成故障恢复、记录连续性、重启、备份还原及退出清理。与有效旧桌面证据比较，82 个前端产物摘要一致。二进制因重新构建而不同；没有把原长测或单次资源快照当作新产物的长期稳定性证明。

| 产物 | 字节数 | SHA-256 | 保留位置 |
| --- | --- | --- | --- |
| 主线 x64 release，Rust 1.94.1 | 45,974,016 | `f84f2d058ec071ee66a797d3422809a7193769ad264cc438520427bfd4f274e8` | `binaries/cli-release/Patina.exe` |
| 主线 x64 runtime，Rust 1.94.1 | 70,361,600 | `1be3df9a389ba0fea53f6f1c2ba931a4c73f1dc80bc061700a63851ae27f5928` | `binaries/final-runtime/Patina.exe` |
| Rust 1.99.1 x64 release | 45,741,056 | `53579a279c91b2690a9be8954365e6189c6dd6a6acb280c032e3bcffa69456e3` | `binaries/rust-release/Patina.exe` |
| Rust 1.99.1 x64 runtime | 67,087,872 | `79e25ff97e8ee422899376c9136b9fde827724bc5c7f916312df7c6c1101deaa` | `binaries/rust-runtime/Patina.exe` |

以上 release 程序仅构建、保存，未运行或安装。CLI 自身依赖修复和应用 Cargo 审计分开处理，未据 CLI 升级宣称应用 advisory 被修复。

### 13.2 Rust 采用结论与后续证据

Rust 1.99.1 暂缓采用，`rust-toolchain.toml` 保持 1.94.1。新编译器通过格式、编译、899 项库测试、真实 helper 生命周期测试和 9 项采样器测试，仍不能通过现有 `-D warnings` 门槛。具体诊断如下，未为通过实验修改业务代码或降低门槛：

| 位置 | 诊断 | 后续修复须保留的行为 |
| --- | --- | --- |
| `src-tauri/src/data/import/destructure/csv_source.rs:55` | `explicit_counter_loop` | CSV 错误行号与逐行读取语义 |
| `src-tauri/src/domain/widget.rs:349` | `unnecessary_sort_by` | 窗口几何匹配候选的稳定排序 |
| `src-tauri/src/platform/windows/icon.rs:230` | `chunks_exact_to_as_chunks` | 像素分组、通道变换及尾部处理 |
| `src-tauri/src/engine/tools/mod.rs:769` | 测试代码 `fetch_update` 弃用警告 | 原子计数更新与并发测试语义；旧 Rust 兼容性需另核实 |

独立桌面运行 `rust-runtime-1792751085289` 完成 WebView 故障恢复、重启、存储恢复与清理，但在 `tests/tauriRuntimeSmoke.test.ts:1628` 的 `widget has native focus before focus-loss control` 前置断言超时，因此整体退出 1。82 个前端产物摘要仍与对照一致。该次运行期间 Node 安装的 Windows 授权提示一直未处理；运行后观察到另一个程序占有前台焦点，但这不是失败瞬间的证据，不能据此确定原因或归因于编译器。未增加重试、放宽焦点断言或自动重跑；由 SYBao 的后续 Rust 任务在可控桌面环境中区分环境干扰和真实回归。

依据[官方 Rust 发布记录](https://doc.rust-lang.org/releases.html)，跨越版本涉及 Windows 线程局部析构、FFI 和 LLVM 变化，因此单独保留 native helper、Shell / COM、音频、超时回收与崩溃恢复的运行证据。新版修复清单不代表旧版必然存在对应缺陷。

后续由关联计划 T-02 至 T-04 具名承接：SYBao 安排 Rust 兼容性修复、桌面焦点失败的受控对照及采用签收；获准推送后对实际候选读取 x64 / ARM64 原生 CI；下一次发布任务补齐双架构 NSIS、非管理员安装、数据路径保留、updater 签名及资产验收。Rust 1.99.1 的 ARM64 对照需另选该编译器执行，不能复用仍读取 1.94.1 配置的 CI 结果。当前没有这些远端或安装证据，没有为取证自行推送或发布。

### 13.3 本机采用与收口

2026-10-23 18:44（UTC+8），SYBao 处理 Windows 管理员提示后，官方 Node MSI 退出 0，保留原七项安装功能。普通、非管理员 PowerShell 从注册表中的常规 PATH 解析到 `C:\Program Files\nodejs\node.exe` 24.22.1 和 `C:\Users\SYBao\AppData\Local\pnpm\pnpm.exe` 12.15.0；没有依赖实验路径或 Rust 环境覆盖。`check:toolchain`、冻结安装和 CLI 2.12.4 入口检查通过，锁文件摘要未变。

已安装 Node 的 SHA-256 为 `d702daa815eabbff763c7d3808e235cf031cf2ca70211b56847bc72f51e240e5`，pnpm 为 `6052300915b4d839772595dc15dd6539333bf2af440839d1f8c1ffe34c86b4fd`，均与完整验证使用的二进制一致。因此复用 F 阶段的有效完整门槛和桌面证据，没有把默认工具切换后的入口核验冒充再次执行全套测试。现有旧 Node 目录和 npm shim 未抢先解析，也未修改为实验路径。

实际仓库只接收 `.node-version`、`package.json` 和 `pnpm-lock.yaml` 的工具链差异，以及本计划和关联计划的状态变更。与启动快照逐项比较，其他已有修改及未跟踪源码保持原始字节，Cargo 文件和 Rust 配置未变。暂存区未操作，主分支 HEAD 未变，正式 Patina 进程和用户数据未被替换。

- [x] **C-01** Node / pnpm / CLI 的实际改动与通过证据一致；Vite / TypeScript 保持冻结，已有长测修复完整保留。
- [x] **C-02** Rust 验证有独立结论；采用、暂缓或剩余验证都有明确依据，没有把实验版本默认为正式工具链。
- [x] **C-03** 列清仍缺失的架构、打包、安装或持续观察证据，已完成、明确暂缓或转交具名责任人；不把未运行项目勾选为通过。
- **C-04（本次不适用）** 用户未要求提交或推送，本次没有执行。后续若要求提交，按 CONTRIBUTING 检查精确暂存差异，只包含获准范围；推送须有明确目的地授权，不沿用早先 Vite 任务的授权，不携带其他未提交修复。
- [x] **C-05** 若获准推送，读取对应候选的 CI 结果，核对 SHA 和实际工具版本；没有推送授权时登记本地结果和待远端验证项，不为完成清单自行推送。
- [x] **C-06** 更新本计划和关联计划中的后续事项状态，运行 `pnpm run check:docs` 并检查 UTF-8、链接及义务完整性。稳定事实有变化才更新其长期 owner，不为记录一次升级另造长期规则。
- [x] **C-07** 所有适用事项已完成、拒绝或转交后，将状态改为完成并按文档生命周期归档，修复相互链接。暂缓的 Rust 或后续发布证据必须有去处，不能在归档时消失。普通文档检查与 `pnpm run check:docs -- --archives` 均通过。

本次执行结果以本节和原始日志为准。Rust 的失败与未运行的架构 / 发布验收均按实际结果保留，完成本计划不等于这些候选或发行门槛已经通过。

### 13.4 原升级阶段的对抗式审查

18:49 的独立审查核对实际差异、完整锁图、registry 完整性、本机二进制、未提交修复和验证输入，未发现可操作问题。通过真实 `check:toolchain` 入口验证：旧 Node 或旧 pnpm 被拒绝，正确组合通过。审查证据为 `adversarial-review.json` 和 `review-lock.json`。本节结论针对第 13 节的原升级组合；以下追加阶段另行验证。

## 14. 跨仓共同工具对齐追加阶段

SYBao 在“检查 Eureka 工具链版本”聊天中要求相同工具链使用相同版本，并明确允许协调两个聊天。Patina 接收共同工具的精确对齐目标；两仓分别实施、验证、采用，最后由 Eureka 只读核对实际消费者图。本阶段不改变 Vite 8.2.4、TypeScript 6.0.3、Node 24.22.1、pnpm 12.15.0、Tauri CLI 2.12.4 和 Rust 1.94.1 的选择，也不扩展 Git 外部动作授权。

依赖版本由真实消费者及其 semver 约束决定。目标是共同工具的实际解析一致，不把不同可选 peer 上下文强行变成同一图。只在隔离候选中临时选择目标，随后恢复 `pnpm-workspace.yaml` 的原始字节，再标准化锁文件和冻结安装；不新增直接依赖、永久 override 或构建许可。

| 消费者范围 | 目标 |
| --- | --- |
| Vite / ESLint peer | jiti 2.7.0 |
| Babel 转换链 | parser / generator / traverse / types 7.29.8；core 保持 7.29.7 |
| Vite 文件匹配 | picomatch 4.0.7 |
| ESLint / typescript-eslint | eslint-utils 4.10.1、estree 类型 1.0.9、minimatch 10.2.6、acorn 8.18.0、flatted 3.4.4、ignore 7.0.8 |
| React Hooks lint | zod 4.5.4 |
| Babel source map | sourcemap-codec 1.6.0 |
| GitHub Actions | checkout v7.0.1 `3d3c42e5aac5ba805825da76410c181273ba90b1`；setup-node v7.0.0 `820762786026740c76f36085b0efc47a31fe5020` |

checkout v7 新增 fork PR 防护，会阻止当前 `workflow_run` 的已核验候选。保留可信 base gate、不可变 SHA、`contents: read`、不保存凭据、不启用缓存、不传递 secrets 和 GitHub 托管 runner；仅在依赖成功 candidate 的三个验证 job 中，为 `workflow_run` 条件式开启该输入。可信 candidate、PR Intake 和发布 checkout 不开启。工作流校验与 upstream guard 的正反例同时验证该边界；真实 Actions 执行仍需后续获准推送，不能用本地检查替代。

- [x] **A-01** 保存原阶段结束后的完整源文件基线，重新核实官方 registry 版本、发布时间与完整性，保留原阶段证据。
- [x] **A-02** 隔离候选只更新目标消费者及必要闭包；直接版本、包管理器文档和安装策略不变，冻结安装成功。
- [x] **A-03** 更新 Actions 精确 SHA，保护 fork PR 路径与可信脚本边界，完成正反例及现有 intake / release 检查。
- [x] **A-04** 运行最终候选 `check:full`、真实 Tauri runtime smoke，记录输入、产物、失败及清理结果。
- [x] **A-05** 将通过验证的精确差异采用到原目录，普通工具冻结安装确认锁字节不变；请 Eureka 只读复核共同消费者和 Actions。
- [x] **A-06** 对最终追加差异开展对抗式审查，完成文档检查、勾选、归档与隔离工作区清理；原 Rust 和远端验收缺口仍由 T-02 至 T-04 承接。

本阶段证据位于原证据目录的 `alignment/` 和新增 `runs/alignment-*` 中。原隔离工作区的恢复工具返回快照缺失，故创建新的 detached 验证工作区，并从实际源文件基线复制全部未提交修复；原阶段日志与二进制仍完整保留在原目录。

### 14.1 候选与门槛记录

`alignment/graph-review.json` 逐项比较 376 个 snapshot 节点及其边，结果等于指定 14 个版本替换后的原图；jiti 原来分开的 2.6.1 可选节点与 2.7.0 必需节点合并，消费者边仍保留原有可选属性。新增包的完整性与官方 registry 一致，其余包元数据、全部直接版本、管理器文档和安装策略保持不变。候选锁文件 SHA-256 为 `2a016e99cfd4b47f898ed4d0591991b0079b1f0dee160f3104f6409f40adb3a7`。

Actions tag 通过官方仓库 `ls-remote` 核实；[checkout 变更记录](https://github.com/actions/checkout/blob/v7.0.1/CHANGELOG.md)、[fork 防护源码](https://github.com/actions/checkout/blob/3d3c42e5aac5ba805825da76410c181273ba90b1/src/unsafe-pr-checkout-helper.ts)和 [setup-node 输入定义](https://github.com/actions/setup-node/blob/820762786026740c76f36085b0efc47a31fe5020/action.yml)用于核对兼容性。`alignment/workflow-review.json` 确认三个工作流除 27 处 Actions 引用与三个条件式放行输入外，解析后的语义完全相同。

`alignment/actions-guard.json` 保存官方 guard 源码摘要及四个本地上下文对照：fork 默认拒绝、可信 base 接受、显式放行接受、push 不受影响。`alignment/workflow-negative-results.json` 保存实际 intake 测试入口的正例及四种会失败的变更：去掉放行、改成无条件放行、在可信 checkout 放行、删除执行前 HEAD 核验。46 项 intake 测试与 release policy 测试通过；这些本地测试不代表已在 GitHub 托管 runner 执行新版 Actions。

两次完整检查曾分别因 Actions 注释写成完整版本、说明注释意外匹配 `secrets.` 检查而停止，原始失败日志保留。修正为仓库要求的主版本注释并改写说明后，所有原有断言保留。最终 `alignment-final-full-1792753433656` 于 19:03:53 至 19:13:55（UTC+8）通过，含真实浏览器、生产构建、899 项 Rust 库测试、1 项原生 helper 集成测试、9 项采样器测试、Clippy 和在线依赖审计，输入文件未变。

### 14.2 采用、复核与归档

`alignment-runtime-1792754055561` 于 19:14:15 至 19:18:34（UTC+8）通过并完成清理，含三类真实 WebView 故障、记录连续性、窗口状态、重启和存储迁移中断恢复。与旧对照的 82 个生产前端文件摘要全部一致。该次 x64 测试二进制为 70,361,600 字节，SHA-256 `fdb20151e02a5c8d523cf78c5b9b520c0a999ea0a78a30b1a01409052c96d42e`，保留于 `alignment/binaries/runtime/Patina.exe`；本阶段未重新构建发布安装包。

采用前逐字节核对原目录的六个目标文件仍匹配追加阶段基线，再复制锁文件、三个工作流及两处工作流测试。`alignment-root-frozen-1792754388477` 冻结安装成功，源码和锁文件均未变化。`alignment/adoption.json` 将采用文件绑定到通过的完整检查和桌面运行输入；后续文档收口不改变这些应用、依赖和工作流输入。

Eureka 于 19:20（UTC+8）完成原目录只读签收：12 个共同直接依赖一致；186 对递归节点中的 185 个共同包版本及完整性一致，唯一差异是不同宿主上下文中的 debug 可选 supports-color 8.1.1 / 7.2.0；20 条已安装消费者路径全部一致；checkout 与 setup-node 精确 SHA 一致。最终报告副本保存在 `alignment/eureka-final/`，包括 `review-patina-acceptance.json`、`shared-graph-1792754416250.json` 和 `installed-consumers-1792754416384.json`。

Eureka 归档后的 19:22 复核结果保持一致，其执行记录位于本机 `C:/Users/SYBao/Documents/Code/Eureka/docs/archive/2026-10-22-toolchain-alignment-upgrade-plan.md`；对应收尾报告副本为 `alignment/eureka-final/review-closing-after-archive.json`。

采用后进行单独的对抗式审查轮次，复核完整源文件基线、实际采用字节、锁图闭包、工具版本、工作流权限与正反例，未发现可操作问题。证据为 `alignment/final-adversarial-review.json`、`alignment/workflow-review.json` 和 `alignment/final-environment.json`。原有长测修复及其他未提交文件保持原始字节，HEAD 与暂存区不变，没有提交或推送。正式 Patina 仍为 10 月 22 日启动的 PID 10888，未替换安装程序或用户数据，隔离测试进程已全部退出。

隔离工作区已归档，所需原始日志、源文件基线、安装回退材料与测试产物保留在忽略目录。普通文档检查及包含归档的检查完成后收口。Rust 1.99.1 的失败、真实 GitHub Actions / ARM64 运行及发布安装验收仍按第 13.2 节转交 SYBao，不能据本地通过结果宣称这些门槛已通过。
