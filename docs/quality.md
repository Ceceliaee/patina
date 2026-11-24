# 工程质量与修复

追踪事实、用户数据、权限与升级的正确性优先。先保障正确性与可验证性，再考虑代码质量与性能。性能取舍须有同等条件下的测量。开发者可依据影响范围选择定位方法、实现顺序和定向检查。[系统架构](architecture.md)说明数据、生命周期与依赖的归属。

## 验证范围

局部改动以覆盖实际行为、消费者和失败路径的相关验证作为本地完成条件；不因任务收尾、提交或推送而升级为全量测试。全量验证用于 CI、正式发布和跨模块改动。定向入口见[测试分层](#测试分层)。

本机遇到火绒拦截时，保留检测名、文件路径和未完成的检查。同一目标即使重编译后文件名中的哈希改变，也停止本机重试，包括会构建或执行它的聚合命令。更新窗口按[本机 UI Automation 验收](#本机更新窗口验收)检查。

截至 2026-11-24，开发机已有 `Trojan/ShellLoader.gx` 隔离记录，涉及 `xtask.exe`、桌面窗口测试和 `patina-updater` 库测试。在这台机器上，`cargo xtask …`、已被拦截的具名测试和包含它们的 `cargo test-headless` 留给 CI。

| 实际改动 | 本地验收范围 |
| --- | --- |
| 纯文档 | `cargo xtask docs check`，核对事实、UTF-8、链接和义务；治理或验证政策变化追加 `cargo test -p xtask docs::` 及受影响规则的正反场景 |
| 局部窗口、QuietPro 控件或选项持久化 | 所属 Rust 模块或活动数据契约、受影响的具名原生交互用例，以及相关格式、编译或本地化检查；不运行无关页面与资源长测 |
| 局部 Rust、tracking、SQLite 或桌面 runtime 行为 | 受影响模块及真实消费者的测试、相关 Rust 静态检查和命中风险的原生/数据专项；不因涉及 Rust 或持久化就运行全仓测试 |
| 跨模块改动 | 桌面工作区 运行 `cargo test-headless --locked` 及受影响 crate 的格式、编译和 Clippy 检查，并补命中风险的原生专项；仓库工具或公共构建链变化追加 `cargo xtask check tools`。 |
| 正式发布 | `cargo xtask check` 和 `cargo xtask release validate-changelog`，并遵循[发布验收](release.md#发布前的最低验证门槛) |

按行为影响判断跨模块，不按文件数量判断：一个功能的组件、存储 helper 和测试可以属于局部改动；公共 API、共享状态、全局样式、schema、权限或依赖变化若影响多个消费者，则覆盖这些消费者并使用跨模块门槛。影响范围不明时先追踪调用与数据流，再扩大到能覆盖影响的范围。

涉及 changelog、更新器或发布的改动也运行 `cargo xtask release validate-changelog`。

检查器、模板或操作说明变化还须验证真实使用路径，扩展名不能豁免风险。纯文档默认使用文档检查。[仓库检查入口](../xtask/src/check.rs)定义命令的执行顺序，`Cargo.toml` 与各 crate manifest、Cargo module tree 拥有 桌面测试入口；长期 prose 不复制执行图。顶层门禁不得静默移除既有检查、测试、coverage include 或阈值。

`cargo xtask check` 覆盖仓库工具、原生 Rust、格式、编译、测试、clippy 与依赖安全。依赖审计只允许经 Windows target 依赖树证明不可达的精确 advisory；受控离线模式仍须运行本地快照和例外可达性校验，但不能替代发布 CI 的联网新鲜度。

根 [rust-toolchain.toml](../rust-toolchain.toml) 固定 Rust 工具链。从仓库根目录运行 Cargo。Wasm 构建显式指定目标。第三方 GitHub Actions 固定到完整提交 SHA。

`cargo xtask audit` 刷新公告并检查参与构建的锁文件。`--offline` 使用本地公告库，适用于开发复核；发布验收采用联网结果。

验证证据绑定受影响的输入、环境和风险。同一任务中相关输入未变化、证据仍有效时，不因接下来提交、推送或补写执行记录而重复检查；代码、配置、依赖、base 或验证规则变化后重新判断受影响范围，只重跑失效的证据。无法运行的相关检查应明确原因和残余风险，不得记为通过。

## 修复与回归证据

从可观察的结果和原始数据找到负责该行为的模块，修复后核对同一入口。简单文案或局部实现可以直接用现有检查验证。并发、权限、持久化与进程生命周期等仅靠成功结果无法区分的风险，需要能显现原缺陷的复现、失败输入或负向对照。跨模块时追溯数据来源、实际调用者和事务边界，避免在消费方另建状态或绕过校验。

发现改动涉及共享 API、兼容窗口、数据恢复或不可逆操作时，重新核对影响和授权。已授权的独立工作可以继续。历史格式的适用条件与退出要求见[发布兼容](release.md#旧备份读取器的丢弃窗口)，抽象和依赖的落点见[架构](architecture.md)。需要交接或恢复工作时按[执行记录](documentation.md#工作记录与归档)留证。

备份与恢复链路按受影响行为覆盖：快照一致性与摘要校验、危险 ZIP 路径和资源上限拒绝、覆盖恢复中断回滚、合并事务回滚与重复导入幂等、父子 ID 重映射、当前数据冲突优先，以及 WebDAV 下载后重新走正式 preview。涉及文件切换或格式分派时必须验证受影响的失败与恢复路径；跨模块影响按[验证范围](#验证范围)运行全量，不能只用成功路径证明安全。

## 测试分层

桌面端和 QuietPro 的自动化测试统一用 Rust 编写，包括控件交互、Windows 桌面验收和资源采样测试。单元测试随被测模块维护，集成测试放在对应 crate 的 `tests/` 目录，通过 `cargo test` 运行。无头交互使用 GPUI `TestAppContext`，验证真实控件的输入、状态和回调，不创建原生窗口。真实窗口、Windows 集成及长时间采样目标通过 `native-tests` feature 显式启用，并保留 `#[ignore]`，验收时按测试名运行。默认 `cargo test` 不构建这些原生测试目标；`cargo test-headless` 聚合 workspace 单元、契约与无头交互测试。无头测试不替代像素渲染、UIA、托盘、安装和升级验收。

### 桌面测试文件与定向入口

按被测行为放置测试：

- 纯计算、状态转换和控件模型的单元测试留在所属生产模块。
- [活动契约](../crates/activity/tests/contracts.rs) 在临时 SQLite 库上验证查询、分类、设置及存储操作。涉及实时采样、关窗续录或退出封口时使用真实进程生命周期用例。[窗口与进程](../apps/patina/tests/lifecycle.rs)
- QuietPro 无头控件交互放在 `crates/quietpro/tests/headless.rs`，启用 `test-support` 后运行；复用生产控件，断言指针、键盘、禁用状态与回调行为。
- 页面窗口交互放在 `apps/patina/tests/pages/`，由 `pages.rs` 注册；Today 交互由 `today.rs` 注册，QuietPro 控件交互放在 `crates/quietpro/tests/`。布局用例直接进入对应页面或弹窗，不以导入、备份等无关长流程作为前置步骤。
- 专用会话资源采样与基线对照保留具名 ignored 用例；普通页面布局修改不自动触发资源长测。跨 target 复用的环境与 fixture 放在 `crates/test-support/`，页面私有断言留在页面测试模块。

以下命令从仓库根目录执行；依赖已缓存时可加 `--offline`。名称不确定时，用 `cargo test --locked -p <crate> --test <target> -- --list` 核对完整名称（原生目标另加 `--features native-tests`，无头交互目标另加 `--features test-support`），再执行所需用例。例如：

```sh
cargo test-headless --locked
cargo test --locked -p quietpro --features test-support --test headless
cargo test --locked -p patina-activity --test contracts services::web_sync_guide_data_is_localized_and_preserves_actions -- --exact
cargo test --locked -p patina --features native-tests --test pages storage::settings_webdav_layout -- --ignored --exact --test-threads=1
cargo test --locked -p patina --features native-tests --test lifecycle -- --ignored --test-threads=1
cargo test --locked -p quietpro --features native-tests --test controls accessible_controls -- --ignored --exact --test-threads=1
```

一次执行同一领域时可使用模块过滤器；不能用 `--include-ignored` 无差别执行带资源、凭据或专用会话前提的用例。Cargo 零匹配可能返回成功退出码，验收还须核对实际执行数非零；`--no-run` 只证明编译。移动测试时核对新旧清单、断言与 ignore 理由，保持默认聚合可达。

显式启用的原生窗口用例从 Cargo 入口自动进入[临时 Win32 测试桌面](../crates/test-support/src/lib.rs)，驱动、Patina 和渲染进程在同一非输入桌面完成交互，退出后释放。纯数据和控件模型用例直接运行。

测试入口受阻时，标明未运行的用例。其他入口获得的证据单独说明实际覆盖的行为。

验收真实前台焦点、系统托盘、物理鼠标或交互会话资源基线时，使用专用 Windows 虚拟机或独立交互登录会话。在该环境的 PowerShell 中设置进程级 `$env:PATINA_DEDICATED_TEST_SESSION = '1'`，再运行对应的具名用例或 `native-lifecycle` 示例。这个变量声明运行环境已经专用，设置它本身不会创建会话。日常桌面保持未设置；显式选中这类用例时，测试会在启动窗口前报告缺少专用会话。

编辑时运行命中 owner 的最小有效检查；完成时确认相关检查覆盖实际消费者及故障路径，局部改动即可结束本地验证。跨模块改动和正式发布按[验证范围](#验证范围)运行全量入口。修复失败后只重验失效范围；共享状态、执行顺序或聚合编排改变时重验对应组合。数据安全、权限和跨进程风险应在实现过程中验证。

本地按实际影响范围验收；CI 负责可信候选的完整集合、双架构与独立 runtime，发布另按[发布政策](release.md)验收。局部任务完成不以本地全量或等待 CI 为前提；合并仍需同一候选的必需 CI 检查成功。报告已验证的范围，不能把局部通过表述为全量或 CI 通过。

### 本机更新窗口验收

在独立 Windows 测试会话中使用调试版 Patina 和 Windows UI Automation 客户端（例如 Windows SDK 的 Inspect）。从仓库根目录执行下列命令，或在已有调试版本上设置相同的进程环境。`PATINA_PROFILE_PARENT` 指向新建的临时资料目录，`PATINA_UPDATE_FIXTURE` 指向本机与 CI 共用的[离线更新样本](../crates/updater/tests/fixtures/feed/manifest.json)。

```powershell
# PowerShell 7.4+
cargo build --locked -p patina --bin patina
if ($LASTEXITCODE -ne 0) { throw "Patina build failed" }
$testProfile = New-Item -ItemType Directory -Path (Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString()))
Start-Process .\target\debug\patina.exe -ArgumentList '--today' -Environment @{
    PATINA_PROFILE_PARENT = $testProfile.FullName
    PATINA_UPDATE_FIXTURE = (Resolve-Path 'crates/updater/tests/fixtures/feed').Path
}
```

在 UI Automation 树中选择该实例的「关于 → 检查更新」，核对测试版本 `0.1.0 → 0.2.0` 和说明 `Migration fixture release notes`。调用下载按钮，等安装按钮可用，再打开安装确认并取消。确认框应关闭，已下载的更新仍可安装，宿主仍在运行。验收后从托盘退出测试实例，再清理此次创建的临时资料目录。

完整的[更新交互用例](../apps/patina/tests/updater.rs)由 [Windows x64 和 ARM64 CI](../.github/workflows/verify.yml) 运行，覆盖跨页导航、Esc 取消和无效安装包等失败路径。

<a id="风险追加与桌面验收"></a>

### 各层证据与覆盖范围

仓库工具测试覆盖翻译资源、发布产物、依赖审计及外部 PR 准入。Rust 单元测试保护状态转换，活动数据契约覆盖数据库、旧结构升级、备份与恢复。QuietPro 无头测试覆盖控件行为，隔离桌面测试覆盖真实窗口、输入、系统集成和进程回收。

同一测试在不同发布架构上需使用实际目标产物。安装器、更新签名、真实系统托盘和长期资源采样仍按对应环境验收。移除旧格式支持前应验证已发布版本的升级义务、迁移与恢复。

## 性能与资源生命周期

性能优化须提供可比较的场景与证据：

- 必须说明场景
- 必须给出前后可比依据
- 高频路径除平均值外，应尽量记录 `p50`、`p95`、`max`，避免平均值掩盖体感尖刺
- 必须证明收益大于复杂度
- 默认先做无感优化，再做体验取舍；不得为了降低任务管理器数字牺牲启动、切页、mini 唤出与 tracking 可信度
- Windows 平台 owned resource 应优先使用 RAII guard 表达释放责任，包括 process handle、snapshot handle、GDI bitmap/DC、owned icon、COM 初始化和事件钩子
- 高频平台查询应优先考虑短 TTL 缓存、negative cache、in-flight 合并和退避，避免后台采样对同一资源重复开销
- 窗口资源策略变更时验证后台资源、重开延迟与状态恢复。须区分常驻录制进程和可释放的窗口进程，并复核可见性与窗口世代。

托盘与 Mini 的资源测量见[常驻场景](../apps/patina/tests/resources.rs)。[前台切页场景](../apps/patina/tests/pages/foreground_resources.rs)使用页面测试的侧栏和原生控件驱动。两者共用 [Windows 进程树采样器](../apps/patina/examples/windows-resource-sample.rs)。长期口径是固定场景后比较 average、p50、p95 与 max，以子进程失败、预算超限或不允许的 SQLite table scan 为失败；不得并发运行制造虚假吞吐，也不得把模拟数据路径描述成真实 SQLite I/O。生命周期测量必须等待可信 read model 与实际内容提交，以窗口内容实际提交为测量终点，保留同等加载工作。

## 外部 PR 的风险与证据

外部 PR 先判断是否降低维护者安全落地一个已接受问题的成本，再进入逐行 review。完整贡献者政策由 [`../CONTRIBUTING.md`](../CONTRIBUTING.md) 拥有，PR 模板负责采集，`xtask/src/ci/` 实施准入并用合成 Git 记录和工作流事件验证拒绝条件；本文只拥有风险模型。

范围、体量、owner、UI 与表单门禁按[CONTRIBUTING 的准入要求](../CONTRIBUTING.md#33-pull-request-intake-gate)判断。任一门禁失败即停止完整 review；可信 base 的自动判定不能被作者声明或 label 绕过。本文要求验证匹配真实风险，不能只看 diff 大小：

| 风险域 | 需要保护的事实 |
| --- | --- |
| tracking、SQLite、持久化、导出、备份/恢复、清理与 migration | 正确性、数据保留、失败及恢复路径 |
| 截屏采集、本机或网络接口 | 隐私、权限、鉴权、撤销和关闭行为 |
| UI | Quiet Pro、实际交互与可重复证据；截图按[贡献要求](../CONTRIBUTING.md#74-include-external-screenshots-for-ui-changes)提供 |

审查结果分为 `Mergeable`、`Needs Author Changes`、`Not Accepted` 或 `Declined`，由实际准入和审查结果决定。

测试必须真正覆盖命中的风险域并能被默认测试图或 Cargo module tree 到达。未注册测试、无关 smoke、只删除断言或只写“已测试”都不是正向证据。插件能力、窗口消息或安装交接的授权边界变化须验证允许和拒绝路径，涵盖过期的工具实例、错版对端或无效安装凭据等实际受影响情形。

## 工程表述

文档、注释、评审、变更日志和贡献者说明应准确表达可验证的工程事实。

- 保留 actor、触发条件、义务、禁止、例外、失败行为、原因和验证证据；
- 不把 `must` 弱化成 `should`，不把 scoped default 改写成绝对规则；
- 公共 API 文档只记录调用者无法从签名直接得知的返回、失败、所有权、时序、副作用和兼容性契约；
- 内部注释只解释非局部不变量、平台限制、安全理由或反直觉决策，不逐行复述实现；
- 诊断信息必须指出失败对象、可操作原因和下一步，不使用无上下文的“失败”或“出错”；
- 删除代码逐行复述、实现过程日记、review 辩解、无证据质量声明和 chain-of-thought 残留；
- 用户可见产品文案和翻译继续服从 [`localization.md`](./localization.md)，不能由通用 prose 整理绕过消息契约；
- 长期文档的归属、更新与归档见[文档治理](documentation.md)。

## 本地化验证

本地化资源变更必须通过真实仓库 i18n 检查，覆盖 key、参数、CLDR 复数类别、source-review hash、generated stale 和硬编码，并运行相关类型与界面测试。仅修改现有文案或译文不默认运行工具 self-test；修改 formatter、schema、生成器、validator、新增语言工具或其相关依赖时，运行对应行为测试和自测。新增语言仍验证注册、生成、原生表面和消费者；影响跨模块的本地化结构变更按[验证范围](#验证范围)运行全量。完整 CI 保留 i18n 自测。完整 schema、XLSX 不可信输入、生成和贡献流程由 [`localization.md`](./localization.md) 拥有；发布说明正文与其界面消息的边界由[发布规范](./release.md#release-与-app-note) 拥有。
