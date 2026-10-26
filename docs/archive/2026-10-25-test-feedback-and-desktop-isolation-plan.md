# 测试反馈时延与桌面占用整改执行方案

> 状态：本机适用验收及最终质量门槛通过，已按结项处置勾选归档；未执行的环境试点、设备矩阵与收益对照见 §10.5。
> 创建 / 更新：2026-10-25。
> 执行责任：本轮实施与本机验收已结项；维护者 Ceceliaee 承接 §10.5 的环境、设备与对照工作，代码归属见各步骤。
> 本次范围：用户已授权执行整改、完成后勾选归档并进行对抗式审查；用户确认没有独立 Windows 环境，采用本机集中验收。不提交或推送。

优先把“构建、准备数据、证明合约”和“独占 Windows 输入”分开，再减少重复准备和无效等待。先做运行归属、计时和小范围分组试点；真实 Windows 能力仍由真实环境证明。降低总耗时、缩短首次反馈和减少用户不能正常使用桌面的时间是三个不同目标，不能用其中一个冒充另一个。

本方案已归档，只保留执行历史。长期规则仍由[工程质量](../engineering-quality.md#5-默认验证门槛)、[架构](../architecture.md)、[产品原则](../product-principles-and-scope.md)、[发布政策](../versioning-and-release-policy.md)和 [AGENTS.md](../../AGENTS.md#documentation-hygiene) 持有。下文设计保留编写时的决策依据；最终实施结果与结项处置以第 10 节为准。

## 1. 目标与边界

### 1.1 需要证明的产品不变量

测试的价值是区分“产品满足承诺”和“产品在某种条件下失效”，不是积累运行分钟数。选层时先问：若把 Windows、Tauri、真实输入或真实时间替换掉，哪个错误会因此变得不可见？

| 不变量 | 较低成本保护 | 仍需要真实边界的失败模式 |
| --- | --- | --- |
| 取得的有效活动样本按规则提交，不因窗口关闭、恢复或元数据探测失效串记 | tracking 状态机、故障端口、受控时钟、SQLite 事务测试 | WebView 消失或子进程失效时 Rust 是否继续提交；真实进程退出后是否残留；不能用 UI 心跳代替数据库进度 |
| 已发布数据可升级、备份恢复不丢事实，失败保留可恢复状态 | migration、快照摘要、路径拒绝、事务回滚、幂等反例 | Windows 文件锁、WAL/pool 重开、注册表提交、进程中断、真实 WebView profile 落盘与迁移 |
| main / mini 权限隔离，敏感操作拒绝错误窗口 | manifest / handler / permission 静态一致性、Rust caller guard | 打包注册、Tauri ACL、plugin 和真实 window label 是否共同生效；stub invoke 成功不能证明拒绝边界 |
| UI 使用权威数据，订阅、乱序请求和卸载不污染新状态 | unit/model、contract、SSR、headless browser | 真正替换数据库或重建 WebView 后，事件、IPC、缓存是否指向新世代 |
| mini 悬停展开不抢焦点，收起区域不挡输入，拖动与全屏行为正确 | 几何模型、状态机、DOM 键盘和内容测试 | HWND 激活、物理坐标、原生命中测试、拖动消息、DPI / 显示器工作区；DOM click 或 CDP 输入不能证明这些系统事实 |
| 隐藏主窗口到期释放，旧任务不销毁重开的窗口 | generation / token 与时钟边界的确定性测试 | Windows 可见性与最小化不同、真实调度与 WebView 生命周期衔接；保留有界真实时间验收 |
| 资源不会随重复操作持续积累，常用交互满足预算 | 清理路径、订阅计数、算法复杂度和查询计划 | 原生句柄 / 线程、WebView 子进程树、GC、真实展开延迟与稳定空闲；单次功能成功不证明长期资源边界 |

真实 Tauri 测试可以不用系统鼠标，但仍可能创建窗口、托盘、通知或对话框并改变前台。只能称为“无主动输入的原生合约组”，不能承诺在用户工作桌面上绝对无干扰。需要这种承诺时，应把进程放到已验证的独立环境。

### 1.2 成功条件

整改验收同时满足：必需风险全部可达；数据、权限和 Windows 行为断言不弱化；每组独立准备与清理；失败能定位到构建、环境、fixture、产品或采样；用户桌面独占区间可观测且缩短。具体收益以同环境、同输入的前后测量填写，不预设节省百分比。

不采用删除断言、降低阈值、失败自动重跑、按机器静默 skip 或跳过当前默认门槛。也不通过增加生产专用测试后门、缩短生产等待阈值、不断抢回焦点或禁用用户输入来换取通过。

当前工作区同时存在 mini 与挂件退役的既有修改。后续实施先固定候选及相关字节摘要；不把整个工作区当成本任务成果，不停止开发版或安装版，不重置他人的改动。

## 2. 证据快照与当前执行图

### 2.1 证据口径

本次核对基线 HEAD 为 `106894b0d2e86aa136412962f8a480a07901f9e9`，但调查对象是包含未提交修改的工作区，HEAD 不能代表这些测试的内容。下表是 2026-10-25 的决策快照；执行前重新核对所列 owner，不把此表维护成第二份机器清单。

“源码事实”表示当前路径可直接观察；“历史证据”只说明那次候选与环境；“待验证”不能写成已具备能力。本次没有测得当前完整门槛的总耗时、首次反馈、桌面独占时长或 flaky 率。

### 2.2 当前命令关系

命令组合以 [package.json](../../package.json) 为准。下图只保留影响本方案的分支；省略的检查仍必须保留。

```text
check:full
├─ check
│  ├─ toolchain / i18n / docs / types / lint / 各边界与治理检查
│  ├─ check:tests
│  │  ├─ test:coverage → test:fast:covered + coverage 阈值
│  │  ├─ test:fast:remaining
│  │  ├─ test:mutation
│  │  └─ test:ui-browser-smoke → headless browser + Vite dev server
│  └─ check:frontend → build（tsc + Vite）+ bundle 检查
├─ check:rust → 边界及自测 + fmt + cargo check + cargo test + clippy
└─ check:dependencies

test → test:fast:covered + test:fast:remaining
test:tauri-runtime-smoke（独立风险入口，不在 check:full 内）
└─ 隔离 Vite production build/preview → Tauri dev --no-watch 构建与启动
   → 串行原生断言 / 多次真实重启 → 清理
perf:desktop-lifecycle → test:tauri-runtime-smoke --resource-cycles
perf:stable → 7 个 benchmark，每个串行 5 次，共 35 次
release:check → check:full + release:validate-changelog
```

[Verify workflow](../../.github/workflows/verify.yml) 在可信 candidate job 后分开执行 frontend、Rust x64 / ARM64 和 Tauri runtime。runtime 当前使用 `windows-latest`，job 上限 25 分钟、runtime step 上限 15 分钟；脚本另有 480 秒构建启动上限和 30 秒 WebView 启动上限。它们是失败上限，不能当成实测耗时。新增分组不可让这些总上限在清理前强杀后留下无人诊断的失败。

触发入口是 main push、成功的 PR Intake `workflow_run`、带 PR number 的手动 dispatch；不是任意本地分支都可直接运行。候选解析由 [check-verify-candidate.ts](../../scripts/check-verify-candidate.ts) 拥有：默认分支的可信 workflow、固定 head/base、重新执行可信 base intake、候选 HEAD 断言、只读权限与不持久化凭据均须保留。本次未查询 live Actions 成功率，未触发远端运行。不能为了试验而直接推送或绕过 intake；远端操作仍需对应授权。

### 2.3 耗时、输入与依赖的源码证据

| 位置 / 可检索符号 | 已核对事实 | 决策影响 |
| --- | --- | --- |
| [tauriRuntimeSmoke.test.ts](../../tests/tauriRuntimeSmoke.test.ts)：参数解析、`buildVite`、`COLD_BUILD_TIMEOUT_MS` | 只接受无参数或 `--resource-cycles`；一次运行构建隔离静态资源，再经 Tauri CLI 编译启动；默认 target 已是 `src-tauri/target/runtime-smoke` | 首先分离 prepare 与 execute 的生命周期；保持测试产物隔离，不能只新增参数后让每组重复冷构建 |
| 同入口：`stopResidualRuntimeBinary`、`stopProcessTree`、`finally` | 有 PID 树终止、端口 / profile / 测试注册表清理及错误聚合；残留处理仍枚举同路径 Patina 进程 | 共享 target 不是运行归属证明。并发或中断后可能存在另一轮同路径进程；先补 run ID、PID 启动身份与所有权证据 |
| 同入口：`verifyBackupReplaceRuntime`、`storageRestart` | 一个 root、数据库和 CDP client 贯穿大量场景；后续存储迁移读取先前种入的关联、排名和 profile 标记 | 分组必须自己创建前置数据；跨重启、恢复和缓存失效这类有因果关系的序列仍保留在同组 |
| [tauriMiniWindowRuntime.ts](../../tests/tauriMiniWindowRuntime.ts)：`verifyMiniWindowRuntime` | 普通流程已有真实拖动 / 焦点 / hover、100 次暖展开、20 次完整关闭重开；资源模式再静置 10 分钟 | 不能把普通 runtime 叫作短 smoke；功能不变量与统计预算需拆开安排，不能直接减循环数后宣称等价 |
| [miniNativeProbe.ts](../../tests/miniNativeProbe.ts)：`startMiniNativeProbe` | 建 WinForms 输入窗口；调用 `SetPhysicalCursorPos`、`mouse_event`、`SetForegroundWindow`、`WindowFromPoint`；最终还恢复旧鼠标 / 前台 | 这是系统输入独占区。恢复旧前台也可能打断已恢复工作的用户；取消时不得反复重夺焦点 |
| 同 probe：`lock` / `unlock` / `suspend` / `resume` | 向测试进程的 power observer 发原生消息 | 证明消息处理路径，不代表真的锁屏、睡眠、设备唤醒已验收；真实设备矩阵仍另行承担 |
| [tauriBackgroundPolicyRuntime.ts](../../tests/tauriBackgroundPolicyRuntime.ts)：`verifyRestoredBackgroundPolicy`；主入口隐藏启动 | 真实 29 / 31 秒边界、31 秒最小化观察、新隐藏 29 秒后等待销毁；主入口还验证自然 30 秒销毁 | 这些等待验证真实时间及状态，不应机械替换为立即完成；先把其他组合下沉到受控时钟，再保留原生边界证据 |
| [tauriWebviewRecovery.ts](../../tests/tauriWebviewRecovery.ts)：`verifyWebviewRecovery` / `verifyWebviewRecoveryLimit` | renderer exit、unresponsive、browser exit 与耗尽恢复预算；unresponsive 允许 90 秒等待；耗尽项依赖此前故障次数并观察原生对话框 | 恢复预算需有独立前置条件；CDP 断开时序影响原生故障通知；没有系统鼠标不等于没有桌面影响 |
| [tauriResourceLifecycle.ts](../../tests/tauriResourceLifecycle.ts)：`verifyDesktopResourceLifecycle` | 30 轮五页面导航、对话框及最小化 / 显示；每页完成后 450 ms 作为负载驻留，最后 60 秒静置；入口分别运行 forced / natural GC 两种模式 | 此处有真实窗口变化，但页面 click / Escape 主要走 DOM / CDP，不能统称为移动系统鼠标；两种 GC 口径都保留 |
| [browserHarness.ts](../../tests/uiBrowserSmoke/browserHarness.ts)：`launchBrowser` | 默认 `--headless=new`；browser smoke 使用真实浏览器 DOM，但 IPC 为场景 stub | 无需再次“改成 headless”；可复用浏览器资源治理，不可把它当真实 Tauri / SQLite 证据 |
| [stable-benchmark-suite.ts](../../scripts/perf/stable-benchmark-suite.ts) | 7 × 5 串行运行；预算超限、子进程失败、禁止的 table scan 均失败 | 多次样本是统计设计，不是失败重试；多数不控制系统鼠标，仍会占 CPU / I/O，不能与基准同机并发制造假收益 |
| [native_probe_lifecycle.rs](../../src-tauri/tests/native_probe_lifecycle.rs) 与 [acceptance.rs](../../src-tauri/src/platform/windows/native_probe/acceptance.rs) | 默认 `cargo test` 还会运行真实 Windows helper 生命周期和资源断言；音频资源以第 8 / 32 次采样比较线程等预算 | “check:full 不含 Tauri smoke”不等于“全部都是纯模型测试”。这条资源波动链单独诊断，不能归因于鼠标或直接搬出默认门槛 |
| [full-rust.ts](../../scripts/coverage/full-rust.ts) / [full-frontend.ts](../../scripts/coverage/full-frontend.ts) | 全仓 coverage 是专项；Rust 包含真实桌面 instrumentation 路径 | 后续分组必须兼容 coverage 的入口与 flush；instrumented 结果不用于性能比较 |

### 2.4 共享 fixture 与可能重复成本

当前串行依赖可概括为：

```text
同一个隔离 root / DB / profile / 注册表键 / 端口 / 日志 / CDP
  → 隐藏启动、主窗就绪、tray 与桥接端口恢复
  → 网页关联与备份样本、页面状态
  → mini（会释放并重建 main，返回新的 CDP client）
  → 关联 / 匿名 / 数据与内存断言
  → 可选资源循环
  → WebView 三种故障 → 事件 / bootstrap 持久化
  → 覆盖恢复 → 恢复后后台策略 → SQL 拒绝 → WebDAV
  → 种入排名 → 耗尽恢复预算 → 真实冷重启
  → 关联持久化 → profile 落盘标记 → 多种存储迁移及六个中断阶段
  → 关闭退出 → 最终 DB / 进程 / 目录清理
```

这里只标识拆分需要断开的边，不复制每个断言。[runtimeDatabase.ts](../../tests/runtimeDatabase.ts) 拥有已有 SQLite 访问 helper；[tauriWebDavRuntime.ts](../../tests/tauriWebDavRuntime.ts) 使用 loopback HTTP server 和测试凭据，迁移时保留 server / Credential Manager 的创建与清理责任。时间冻结、页面 localStorage、主题、语言、设置、SQLite trigger、事件订阅与进程世代都必须显式准备或恢复。

下列项目是调查方向，不是已确认浪费：

- `check:types` 和 `build` 都包含 TypeScript 工作，但项目范围与产物语义不完全相同；先测量、比较输入与输出，不能直接删其中一个。
- `check:frontend` 与 runtime 都构建前端，但当前 outDir、服务地址与用途不同；只有配置和资产字节一致时才能复用。browser smoke 的 Vite dev server 不是同一份 production build。
- `cargo check`、`cargo test`、clippy 和 runtime build 可共享增量产物的一部分，也各自有不同语义；测量实际重编译，不能仅凭命令重复出现认定重复验证。
- 普通 runtime 与 `perf:desktop-lifecycle` 各跑一次会重复整条原生链；这是优先消除的编排成本，但在风险映射和等价入口建立前仍执行现有要求。
- 当前 coverage-covered 与 remaining 是互斥分区；默认门槛并没有简单地执行两次 `pnpm test`。[测试治理检查器](../../scripts/check-test-suite-governance.ts) 是入口唯一性与重复检测的 owner，不新增文档清单覆盖它。
- 独立 CI job 的重复 setup / build 可能换来并行反馈和隔离；需同时记录 wall time 与 runner-minutes，不能只优化一个指标。

### 2.5 历史失败证据如何使用

[挂件退役记录](../archive/2026-10-25-widget-retirement-execution-plan.md) 和忽略目录 `artifacts/widget-retirement/` 提供诊断样本，本次未重跑。原始路径均相对仓库根目录，不能依赖这些本地产物让其他机器通过门槛。

| 历史记录 | 可得结论 | 不能推导的结论 |
| --- | --- | --- |
| `runtime-final-4.log` 第 31 轮暖展开：鼠标与前台偏离要求 | 输入前提在那次运行中确实改变，需保留 HWND / 坐标 / expected 状态 | 所有原生失败都由用户造成，或产品一定无故障 |
| `runtime-final.log` 至 `runtime-final-3.log` 及归档说明 | profile 标记落盘与 renderer 崩溃注入时序也曾有问题 | 延长 sleep、自动重试或禁止用户操作能修复这些 fixture 问题 |
| `runtime-final-5.log` | 当次完整原生链通过，含 100 次暖展开；可用于基线场景发现 | 当前持续编辑后的工作区或托管 runner 已全部通过 |
| `desktop-lifecycle-2.log`、`perf-final.log` | 已有完整资源运行及 35 次稳定基准的历史记录 | 可以跨机器直接比较毫秒值，或免除后续相关输入变化的复测 |
| `review-rust.log` / `review-native-probe.log` | 音频 helper 线程从 5 增到 8 超过允许增量 2；原预算下单独复核通过，耗时 75.79 秒 | 首次失败可删除、已找到原因，或默认追加一次重试即可接受 |

## 3. 测量设计

先区分五个主指标，再决定优化优先级。事件用单调时钟计算持续时间，UTC 时间用于关联日志；不把源码中的 timeout 当样本。

| 指标 | 起止与统计单位 | 需要同时记录 |
| --- | --- | --- |
| 总耗时 `T_total` | 用户发起该验证到所有要求结果和清理完成；本地按一次 invocation，CI 另报排队与执行 | 冷 / 热构建、各 phase、关键路径、runner-minutes；失败和取消也保留，不只报最快通过 |
| 首次反馈 `T_first` | 发起到首个有明确风险含义的验证结果；启动日志不算 | 首个失败时间、首个快速组完成时间、完整风险覆盖完成时间，避免“一个 lint 先通过”掩盖其余很慢 |
| 构建 `T_build` | frontend / Rust prepare 的开始到产物可启动并完成身份核验 | 各工具耗时、增量命中、版本、target、配置 / 资产摘要、是否有覆盖率插桩 |
| 桌面独占 `T_exclusive` | 从声明并取得测试会话输入使用权到释放；多个区间取并集 | 最长连续区间、次数、开始/结束原因；另报窗口可见 / 激活区间、用户机器与远端机器分别统计 |
| 失败与不稳定率 | 首跑失败率 = 同一输入 / 环境分层下首跑失败数 / 有效首跑数；flaky 率 = 其中经受控复核确认同输入结果不一致的首跑失败数 / 有效首跑数 | 分组的产品失败、环境前提不成立、fixture 失败、输入干扰、采样超预算、未知原因；样本数、疑似项与未分类项 |

只有同输入无修复的诊断复核出现不同结果，才记录为“疑似不稳定”；受控复核确认输入和环境可比后再计入 flaky，根因另行分类，产品自身的间歇故障也不能因此豁免。证据不足时报告已确认计数、疑似计数和未知，不能称为零 flaky。首跑失败率不等于已确认 flaky 率。环境不满足和取消独立报告，不从报表消失，也不计为成功。复核不能覆盖原记录或把结果改为绿灯。

首次基线优先解析已有日志，缺少 phase 起止的项标为未知。后续只在已授权的独立交互环境补测：同一固定候选各一次冷构建与暖构建；只有环境试点需要重复样本时，事先固定轮数和目的，所有轮次都纳入结果。暂不设置收益百分比或 flaky KPI。验收表填写前后同口径数据、样本数、保留预算、剩余瓶颈及复杂度成本。

## 4. 目标分层与独立场景组

### 4.1 执行层与测试语义

这是执行调度的四类，不替代工程质量已有六层测试模型。

| 执行类别 | 承担的工作 | 环境与限制 |
| --- | --- | --- |
| 本地后台确定性 / 无界面 | unit/model、integration/contract、SSR、静态 gate、headless browser；编译与 fixture 离线准备 | 首先返回反馈。真实 native helper 测试单独标注其 Windows / 资源依赖，不伪称纯确定性；CPU / I/O 仍需限制并发 |
| 真实 Tauri 合约 | ACL / IPC、SQLite pool、真实事件、备份恢复、持久 profile、窗口重建后读取 | 不主动移动系统鼠标；仍有窗口 / tray / 对话框风险，优先独立 Windows 环境；不用 DOM stub 替代真实调用 |
| Windows 独占交互 | 物理拖动、hover 不激活、命中区域、原生关闭、全屏与输入恢复 | 每个交互会话串行；已验证的输入桌面与显示条件；短阶段集中执行 |
| 长时资源 / 性能 | 100 次暖展开分位数、20 次完整重开资源、10 分钟空闲、30 轮资源循环、稳定 benchmark | 保留原预算、样本量与负载；独立环境串行测量；无系统输入的 benchmark 也不能与原生测量抢资源 |

### 4.2 拟分组及每组的独立边界

分组是固定、显式的函数编排，不建立插件系统或可任意组合的场景 DSL。入口的一个 typed registry 同时驱动选择、完整执行和结果汇总；[package.json](../../package.json) 只提供调用入口，不再维护另一份场景文件清单。helper 保持非顶层 `.test.ts`，新增测试入口必须登记唯一叶子 owner。

| 拟组名 | 准备 / 就绪条件 | 保留断言及真实边界 | 清理、超时与失败现场 | 拟代码位置 |
| --- | --- | --- | --- | --- |
| `contracts`，首个试点 | 新 profile / DB，正常 main 就绪、明确 main / mini label、已知允许调用成功；为 SQL 边界准备自己的数据 | main / mini ACL、plugin SQL 拒绝、敏感 guard、mini 允许读取；拒绝发生在参数解析前，前后数据库不变 | 关闭本组 mini 与进程，比较 fixture 快照；IPC 有界超时记录命令、label、错误类别与 DB 差异，不打印秘密 | 复用 [tauriSqlBoundaryRuntime.ts](../../tests/tauriSqlBoundaryRuntime.ts)、[tauriMiniContentRuntime.ts](../../tests/tauriMiniContentRuntime.ts)；从 mini 流程提取权限断言到拟 `tests/tauriPermissionRuntime.ts` |
| `data-recovery` | 本组种入网页 / 应用关联、匿名事实、备份与缓存对照数据；停止或控制不应参与对照的后台输入；等到 read model 可信 | 恢复前后事实、合并优先级、幂等、图标 / 事件、重建后的新 pool、SQL 与 WebDAV 安全 | 移除 trigger / clock / subscription，关闭 loopback server 与本组凭据；失败保存最小 fixture 摘要和最后 projection 状态 | 复用现有 `tauri*Runtime.ts` 数据 helper；主入口 `verifyBackupReplaceRuntime` 按行为抽到拟 `tests/tauriBackupRuntime.ts` |
| `storage-restart` | 独立 DB 与 profile；写入自有排名与标记，先验证初始空值，再观察 backing store；每个故障阶段从可声明状态开始 | 目录迁移、缓存迁移 / 清理、默认位置恢复、旧目录移除、六个中断阶段、重启后数据与 profile 保留 | 每次重启登记新 PID / profile 身份；按阶段记录注册表与源 / 目标状态，超时不盲删未知目录 | 把主入口 `storageRestart` 和相关断言移到拟 `tests/tauriStorageRuntime.ts`，复用 `runtimeDatabase.ts` |
| `webview-recovery` | 独立 app、明确恢复计数起点、native subscription ready、数据库已有提交；耗尽测试自行制造所需次数 | 三种真实故障、记录继续、世代递增、原生恢复耗尽提示与不再重建 | 精确终止本组 browser PID；捕获故障发送 / CDP detach / 原生通知时序、最后 DB 提交；保留 90 秒等已有上限 | [tauriWebviewRecovery.ts](../../tests/tauriWebviewRecovery.ts)，入口只编排 |
| `window-lifecycle` | 分别声明 fresh-install、恢复后 legacy-disabled 等数据前提，不能依赖前组恢复；准备 main / mini 正向路径 | 隐藏启动、tray / single-instance、真实 29 / 31 秒边界、任务栏最小化、main 释放 mini 仍可读、关闭退出与最后 checkpoint | 观察 native 日志 / generation / DB 进度；超时保留原始时间线；退出测试只杀本组进程 | 主入口相关块及 [tauriBackgroundPolicyRuntime.ts](../../tests/tauriBackgroundPolicyRuntime.ts)；必要时拟 `tests/tauriWindowLifecycleRuntime.ts` |
| `mini-input` | 新进程、自有 mini 设置、目标 HWND、显示器坐标与输入前台已核验；所有内容准备先完成 | 每条功能路径至少一次真实操作：三边拖动、展开不激活、命中透传、held、全屏、重开偏好、失败回滚 / 恢复后可交互 | 每次动作前后采样 expected/actual；前提破坏立即停止注入；释放按键、probe、mini；功能不等同于 p95 验收 | [tauriMiniWindowRuntime.ts](../../tests/tauriMiniWindowRuntime.ts)、[miniNativeProbe.ts](../../tests/miniNativeProbe.ts) |
| `resources` | 独立干净 fixture、可比环境、无插桩、进程树完整；分别声明 mini 与导航资源的预热基线 | 原 100 / 20 次、10 分钟、两种 GC 的 30 轮 / 60 秒、全部资源阈值；与功能组共用动作，不复制实现 | 采样不足、树不完整、桌面干扰或预算超限均非通过；保留全部样本、清理残留与 GC 口径 | [tauriMiniWindowRuntime.ts](../../tests/tauriMiniWindowRuntime.ts)、[tauriResourceLifecycle.ts](../../tests/tauriResourceLifecycle.ts)，必要时仅拆 mini 测量 helper |

`perf:stable` 和 native helper 的资源验收各自留在原 owner，第一轮不合并到 `resources`。后续若证据表明应该调整 native helper 的默认路由，另做工程质量政策评估，保留真实 helper 故障、超时、回收和资源覆盖。

主入口尚未在表中单列的断言也必须归属：typed settings 的成功 / 结构化错误、真实事件送达、bridge 端口占用后恢复及诊断不泄露 token 进入 `contracts`；read model 就绪 / fallback、网页聚合、bootstrap 保存清除与最终数据库核对进入 `data-recovery`；首次可见主题、reload readiness、tray 偏好冷重启进入 `window-lifecycle`。普通进程树诊断及采样 helper 的超时回退 / 非超时错误传播由 harness 及其行为测试保护，资源验收仍要求完整进程树，不接受 root-only 回退。P0-2 再逐断言复核，不能因上述分组表较短而丢弃主入口剩余内容。

需要连续状态才能证明的不变量留在同组：例如“先暖缓存，再恢复，再读新数据”“先发生三种故障，再耗尽恢复预算”“先写标记，再迁移再重启”。独立的意思是组间不借状态，不是把有因果关系的每个动作分进程。

### 4.3 最小 harness 与准备产物

拟新增 `tests/tauriRuntimeHarness.ts`，只承接从主入口提取的构建、进程、端口、CDP、run root、诊断与清理；领域 fixture 仍在相应 helper，确实共享的建库准备才进入拟 `tests/tauriRuntimeFixtures.ts`。不创建通用 runner 包，不把测试编排放入生产 `src/app` / Rust app owner，也不为测试搬迁产品业务逻辑。

prepare 阶段先完成工具链 / 依赖前提检查、前端 production assets、独立 target 的 Rust 构建与只读产物身份记录，不启动 Patina 主窗口。execute 阶段才创建每组 profile、注册表测试键和 runtime 进程。已有 `PATINA_E2E_FRONTEND_URL`、profile 路径由生产现存 E2E 边界处理；必须核对 `TAURI_CONFIG`、编译时 devUrl / identifier 与运行时 URL，不能假设换端口后任意旧 exe 都能用。

可以提前准备合成数据描述、静态文件和备份样本，但依赖生产 migration / app bootstrap 的数据库就绪仍在组启动后观察。不能把正在使用的 SQLite 文件或带 WAL 的现场直接复制成“通用已就绪 fixture”，也不能预先塞入最终 schema 来绕过本来要验证的升级路径。

第一轮在同一次 invocation 内构建一次、preview 一次，各组串行消费同一已验证产物但用不同 root / storage ID / CDP port；避免一开始做跨任务缓存。若需要提前 prepare、稍后 execute，只允许同一候选的短期显式产物凭证，验证源码 / 配置 / lock / 工具链 / target / instrumentation 和资产摘要。错配或来源不明拒绝使用并要求重新 prepare；不得按文件时间或“exe 存在”认定可用。

共享 Cargo target 的构建互斥；运行中的 exe 不覆盖。完整入口与单组入口调用同一实现。候选改变只失效相应产物和证据，但第一版可以保守重建，避免为微小命中收益引入不可信缓存。跨 CI job 传递产物时，还要绑定可信 candidate SHA、构建 job 身份及摘要，不能消费任意 PR 上传物。

### 4.4 就绪、取消与输入使用权

按以下阶段输出进度，日志中说明当前是否可能改变窗口或输入：

```text
prepare（不启动产品窗口）
→ environment-check（会话 / 产物 / profile / 端口）
→ native-contracts（可能有窗口，但不主动注入系统输入）
→ input-acquire → mini-input → input-release
→ 非输入收尾 / 诊断 / cleanup
```

资源专项单独报告长时间保持桌面条件的区间。即使 10 分钟内没有移动鼠标，只要用户移动会破坏空闲前提，该区间仍是独占成本，不能从统计中排除。使用远端环境可以让用户本机独占为零，但远端测试会话仍被占用。

启动交互阶段前明确组名、候选、目标环境、是否移动鼠标、预计区间（没有数据则写未知）、取消方式；不增加工程质量已取消的额外确认开关。若环境前提不成立，在第一条输入之前失败并报告需要的环境。现有任务授权不等于当前这次文档任务获准执行这些步骤。

就绪必须靠可观察条件：服务可连接、实际 URL / window label、frontend-ready / generation、内容提交、native subscription、数据库提交进度、profile 持久化、进程退出。超时记录最后值和阶段；延长 timeout 必须解释实测原因，不以 sleep 当同步。真实预算测试中的等待保留真实时间，不用 fake clock 冒充系统证据。

输入阶段使用会话级互斥并记录 HWND、PID 启动身份、输入 desktop、显示器 bounds / DPI、实际 cursor、前台和预期动作。每个操作前后验证约束；观察到前台或坐标偏离，只能说“输入前提已改变”，不能自动判定是谁操作。先停止后续注入、释放本组按下的按钮，再留证和退出；不持续把鼠标挪回、不调用阻断用户输入的机制、不自动重跑。

取消路径需覆盖 Ctrl+C、父进程退出、组 deadline 和 CI cancellation。清理有独立有界预算，汇总 primary error 与 cleanup error；只处理记录到本次 run ID 的进程、窗口、端口、profile、凭据、注册表键和目录。核验 PID 创建时间 / executable / profile 或等价持有句柄，防止 PID 复用。证据不足时不终止进程，报告未清理对象并阻止下一组复用现场。开发版被锁时不得先杀开发版，应使用隔离产物。

在 Windows 单一 shell 内清理，递归删除前检查解析后的绝对路径及 reparse / 越界风险，必须落在本次测试根。不能依赖 `finally` 保证处理操作系统强制终止；评估 owned job object 或监督进程时先验证 Tauri 重启的子进程归属，不能误伤主机上其它应用。普通取消尽量恢复本次实际改变的状态；用户已接管桌面后不强行恢复旧前台。

## 5. Windows 执行环境选择

先复用现有托管 Windows CI 验证能成立的部分；物理输入必须经过能力试点，不能从 `runs-on` 推断成功或失败。官方资料核对日期：2026-10-25。

GitHub 文档确认每个普通托管 job 使用新 VM、job 完成后销毁，这支持与用户电脑隔离，但没有据此保证 Patina 的物理鼠标、前台、tray、显示器及 WebView 故障场景可用。[GitHub-hosted runners](https://docs.github.com/en/actions/how-tos/manage-runners/github-hosted-runners/use-github-hosted-runners)

Windows 交互 window station 同时只有一个 active input desktop。因此任务视图中的另一个虚拟桌面、另建一个 Win32 desktop 或第二块显示器，都不能直接当作同时拥有独立鼠标与焦点的证明。[Microsoft：Desktops](https://learn.microsoft.com/en-us/windows/win32/winstation/desktops)

Microsoft 的 Azure Pipelines 指南强调桌面 UI agent 的交互会话要求，并提示 RDP 断开可能锁定会话。该指南对 Microsoft-hosted agent 的支持结论不能直接套到 GitHub runner；这里仅用它识别交互登录、service 模式、锁屏和远程断连的验证风险，不照搬自动登录或会话切换命令到用户电脑。[Microsoft：UI testing considerations](https://learn.microsoft.com/en-us/azure/devops/pipelines/test/ui-testing-considerations?view=azure-devops)

| 方案 | 适用与优点 | 限制 / 成本 | 进入正式路由前的证据 |
| --- | --- | --- | --- |
| 现有 GitHub-hosted Windows job，优先试用 | 已有可信候选链、短期 VM、日志；用户本机不被占用；适合编译、合约与已证实可运行的原生组 | 冷构建、排队、runner-minutes；镜像 / WebView2 更新；虚拟显示与硬件不代表用户机器；不能假设可用物理前台 | 实际 session / desktop、HWND 可见性、SetCursor / foreground / hit-test 成功、DPI、tray、WebView 故障、清理；完整 required 结果而非 skip |
| 独立 Windows VM，按需启动 | 独立客体输入与 profile；可固定快照 / 工具链；即使本机托管 VM，测试不应接管宿主鼠标 | Windows 许可、内存 / 磁盘 / CPU、镜像维护；guest-tools / 远程连接 / 分辨率变动；共享宿主负载影响性能 | 客体交互进程、无用户数据、断连后保持所需状态；宿主与客体输入隔离实测；无控制台时仍能完成；性能只与同 VM 配置对比 |
| 独立物理 Windows 设备 | 更接近真实 GPU / 多屏 / DPI / 电源行为；可作为性能与设备验收基线 | 设备、电力、更新、远程维护和单会话排队；仍需隔离账号和现场清理 | 固定电源 / 显示 / 驱动 / WebView2；锁屏、睡眠、多屏负坐标等真实设备验收；同机前后对照 |
| 用户当前桌面，过渡兜底 | 无新增设备；可做明确范围的真实设备人工验收 | 用户无法并行工作，输入容易失效，窗口组也可能抢焦点 | 明确短区间提示、预检、取消和已通过的安全清理；不作为长循环的常态执行环境 |

自托管 runner 若需要接入，先从按需手工运行固定可信候选开始，确认环境收益后再决定是否注册。不能为了省 setup 把可长期驻留、含用户数据或凭据的电脑开放给外部候选。保留可信 base intake、固定 SHA、最小权限与隔离的测试账号；环境复用不扩大代码信任。GitHub 提醒特权触发结合不可信 checkout 有安全风险。[GitHub：Secure use](https://docs.github.com/en/actions/reference/security/secure-use)

不在本任务采购、创建 VM、修改系统登录 / 电源策略、开放 RDP 或注册 runner。成本比较先填写已有设备、维护时间、冷启动分钟、失败诊断工时及 runner 用量，不臆造账单。没有合格独立环境时，相关验证保持未完成，不能把“环境不可用”改成 CI 成功。

## 6. 覆盖、政策与证据复用

### 6.1 两步迁移，避免入口悄悄变薄

第一步只提取、测量和提供受影响分组。无参数 `test:tauri-runtime-smoke` 与 `--resource-cycles` 保持现有范围和失败语义；所有断言仍可达。单组结果用于定位与开发反馈，不自动免除当前风险追加入口。

第二步在完整对照通过后，才提出长期路由调整：`test:tauri-runtime-smoke` 保留所有必需功能 / 合约组，统计性长循环由 `perf:desktop-lifecycle` 调用同一实现的资源组；新建明确的“完整桌面验收”聚合入口，单次 prepare 后执行功能与资源的并集、无重复场景。具体命令名在实施时由 package scripts 确认，本文不把拟名称写成现有操作说明。

第二步改变了当前普通 runtime 中 100 次暖展开和 20 次重开的执行位置，必须先在[工程质量](../engineering-quality.md#51-测试分层与稳定性治理)说明保护依据、触发范围、完整验收入口和缺证据时的失败行为，再同步 package / workflow / 操作说明；同一个变更中验收，不允许先从实现里删循环、等以后补规则。当前质量与贡献者操作说明在此阶段前继续生效。

拟触发规则如下，只有完成政策步骤后才可启用：

| 改动或验收场景 | 至少保留的原生 / 专项证据 | 何时扩大为完整验收 |
| --- | --- | --- |
| IPC、capability、SQL plugin、窗口 caller guard | `contracts` 的允许 + 拒绝矩阵；相关数据组；当前默认门槛 | 公共注册 / harness / profile / 构建配置变化、影响面不明确时执行所有功能组；不以静态检查替代 runtime |
| SQLite、备份、存储 / profile、恢复和持久化 | `data-recovery`、`storage-restart`，并验证恢复后窗口 / IPC 读取 | 跨组数据世代、bootstrap、权限或重启路径变化时所有功能组；性能敏感路径继续 `perf:stable` |
| mini、窗口生命周期、全屏 / 焦点 / 原生几何、WebView / detector | 对应功能组与 `resources`；预算与循环数不变 | 新 runner、显示配置、WebView2 / Tauri 升级、跨窗口 owner 或输入 harness 修改时完整桌面验收 |
| 资源回收、轮询、订阅、缓存、进程树、采样和预算实现 | 对应功能组 + 完整资源组；保留 forced / natural 区别 | 不能判断影响域，或改变测量方法时同环境旧 / 新完整对照 |
| read model、SQLite 查询、导航性能 | 继续现有 `perf:stable` 路由，资源影响另加桌面组 | 不因拆桌面组而减掉 7 × 5；后续采样设计变更须另有依据 |
| 测试分组 / 构建复用 / 清理 / 风险路由本身 | 全部功能与资源覆盖对照、负向场景、治理自测 | 每次改变必需组选择或证据聚合均完整核对，不能让 planner 只测自身 happy path |
| 发布级验收 | 保持 `release:check`、release workflow 与安装交付要求；为候选取得有效完整桌面证据 | 相关输入、环境或 release 身份变化则失效重跑；x64 runtime 不冒充 ARM64 实机证据 |

完整入口汇总 required group IDs、选中范围和各组状态。必需组缺失、未运行、环境不满足、取消、失败或清理未完成均不能成功；被条件排除的组必须能说明合法路由依据。CI 不使用 `continue-on-error`、无条件成功 fallback 或宽泛 paths-ignore 隐藏必需场景。完整执行是结果集合完整，不要求所有场景挤在同一个进程。

长期 owner 分工：工程质量负责默认与风险门槛；package scripts / 场景 registry 负责执行事实；Verify workflow 负责候选与 job；[测试治理检查器](../../scripts/check-test-suite-governance.ts)负责入口完整性及重复执行；[CONTRIBUTING.md](../../CONTRIBUTING.md)只在操作步骤实际变化时同步；发布政策只在发布契约确实变化时修改。该方案现在不改任何这些 owner。

### 6.2 证据复用与失效

每个组的结果记录 run ID、候选 HEAD 与相关未提交文件摘要、命令 / 组 ID、fixture 输入、断言 / 规则版本、工具链 / lock、Windows / WebView2 / 架构 / 显示环境、开始结束、退出状态、清理和产物摘要。首次实现只存普通 JSON 与原始日志，复用通过显式核对，不做自动跨任务“命中即跳过”的缓存系统。

| 变化 | 失效范围 |
| --- | --- |
| 仅本执行记录或不影响行为的说明 | 不使已验证代码的证据自动失效；本次文档检查另做 |
| 某组 helper / fixture / 断言改变 | 该组及依赖其 fixture 的证据；不能引用旧通过覆盖新断言 |
| 公共 harness、E2E 路径、身份 / 权限、构建配置、lock 或工具链改变 | 受影响的所有组；影响不能精确界定时完整重验 |
| 产品 owner 改变 | 按风险表扩展到合约、窗口、存储、资源等受影响组；共享 owner 不可只测一个调用方 |
| base / candidate / 规则变化 | 重新评估候选与证据关联；相关字节相同只是一部分条件，不自动跨可信边界复用 |
| 硬件、负载、显示、驱动或运行时版本改变 | 性能基线不可直接比较；原生环境能力需重验；不动预算来适应更慢机器 |
| 首次失败后人为修复或诊断复核 | 创建新结果并关联原失败；旧失败永久保留状态；只重跑失效组及必要跨组链，不自动循环直到通过 |

不能把一组的成功日志拼成另一个环境的完整通过，也不能把中断的长测拼接成连续时长。复用只适用于有效证据，不能免除质量 owner 的默认门槛；默认命令是否支持消费已验证结果，须有明确实现与政策，未建立之前不要手工拆掉命令中的检查。

## 7. 分阶段执行清单

以下清单保留最初的验收目标和动作。勾选表示已落实该项注明的结项处置；标题标为“转交”“本轮不实施”或“保守分支”的项目不表示原计划测试已执行。最终证据和剩余责任由第 10 节说明，第 9 节保留中途状态。此单不授权创建分支、PR、提交、推送、dispatch 或配置外部环境。

执行依赖不是章节号的简单串联：P4-1 可与 P0 同时调查；P1 的机制与无输入反例、P2-1/2 的代码就绪后即可做 P4-2 最小环境试点，必要时接 P4-3。P1 的拖动取消实测、P2-3 与 P3 的原生验收使用这一步确认的环境，代码提取和后台测试可先继续。P3 与 P4 完成后再进入 P5 → P6 → P7，避免先完成交互改造才发现没有能运行它的环境。

### P0. 固定候选和测量基线

- [x] **P0-1 固定本轮范围与输入。**
  目的：防止把同时编辑的 mini 内容或旧记录当成本轮候选。位置：本执行单、Git 只读状态、所涉源码与 package scripts。
  动作：取得实际实施请求后记录 HEAD、相关 tracked / untracked 字节摘要、锁文件、工具链和环境；按当前 owner 重核第 2 节，已有变更保留。
  依赖：实施范围确定。验证 / 通过：候选变化能被摘要检测，不包含私人路径或凭据；无无法归属的待覆盖修改。失败处置：暂停依赖候选的验证，继续不依赖它的文档核对。

- [x] **P0-2 建立不变量到断言的覆盖对照。**
  目的：拆分时不漏测或重复测。位置：现有原生入口及 helper、测试治理脚本；临时对照保存在本单或忽略的实施证据目录。
  动作：给现有有独有失败模式的场景标识 ID、fixture 前提、输入 / 可见窗口 / 真实时间需求、失败观测与拟组；从源码导出可执行集合，不另造长期文件清单。
  依赖：P0-1。验证 / 通过：所有当前断言都有去向；复用 / 下沉项列出保留的真实边界；未归类数为零。失败处置：该项仍在原完整路径，不先删除或跳过。

- [x] **P0-3 已完成分阶段计时；旧新冷 / 暖对照转交。**
  目的：先找到等待、构建与独占的实际成本。位置：`tests/tauriRuntimeSmoke.test.ts`，后续迁到 runtime harness；benchmark 继续原 owner。
  动作：为 prepare、launch、fixture、各场景、输入区间、cleanup 记录单调时钟和 run ID；先离线解析既有日志，再在合格环境补一次冷 / 暖基线；记录未知项。
  依赖：P0-1、P0-2；原生运行须已有实施授权和环境。验证 / 通过：失败 / 取消同样产生完整 phase 结果，`T_total` 与区间并集可核算。失败处置：修计时或记录缺口，不用不完整样本报优化收益。

### P1. 安全运行边界与构建准备

- [x] **P1-1 提取薄 runtime harness。**
  目的：让分组共享机制并各自拥有状态。位置：主入口 → 拟 `tests/tauriRuntimeHarness.ts`；保留已有 `browserHarness.ts` 的通用 CDP / bounded wait。
  动作：先原样提取启动、日志、端口、root、CDP 与 finally，不同时重写领域断言；明确每个资源的创建者 / 关闭者。
  依赖：P0-2。验证 / 通过：类型、lint、治理检查通过；完整行为对照相同且无重复 owner。失败处置：缩小提取范围，保持旧入口可执行，不维护两份实现。

- [x] **P1-2 用本次运行身份替换宽泛残留清理。**
  目的：保障用户开发 / 安装实例和并行测试。位置：harness 的进程登记、`stopResidualRuntimeBinary` 与 probe 生命周期。
  动作：登记 root PID、创建时间、exe、profile、重启后的新 root、后代及所属 run；通过持有句柄或可验证身份终止；共享 target 构建互斥，未知同路径进程拒绝清理。
  依赖：P1-1。验证 / 通过：用测试拥有的两个隔离进程构造同名 / 同路径、PID 身份不符与归属缺失反例，清理 A 不影响 B；绝不以用户真实进程做负向夹具。失败处置：停止该运行并报未清理对象，不扩大到按名称杀进程。

- [x] **P1-3 完成超时与取消的清理闭环（本机验收）。**
  目的：用户中断后尽快归还输入并留下可信失败。位置：harness、`miniNativeProbe.ts`、server / 凭据 fixture。
  动作：引入单次取消传播与独立 cleanup deadline；处理 startup、等待 IPC、拖动按下、重启和资源静置时取消；核验临时目录绝对路径和测试注册表键。
  依赖：P1-2。验证 / 通过：受控子进程模拟与独立桌面实测均能停止注入、释放按钮、关闭 owned 资源并保留 primary / cleanup 错误；强制终止的局限明确。失败处置：不启动后续组，先补监督 / 所有权；不删除失败现场中的未知路径。

- [x] **P1-4 分离 prepare 与 execute，先实现本次运行内复用。**
  目的：构建不占桌面，分组不重复编译。位置：harness、必要的 package scripts；核对现有 Tauri E2E URL / profile 边界。
  动作：先 build production assets 与独立 Rust 产物，验证配置和摘要；同次运行只启一个静态 preview，各组独立 profile。产物被运行锁定时不覆盖，不停止开发实例。
  依赖：P1-1、P1-2。验证 / 通过：prepare 不启动 Patina 窗口 / probe；两组使用同一已验证产物；配置、端口绑定或 instrumentation 错配均拒绝，不悄悄启动旧 exe。失败处置：保留同次构建的保守路径，暂不跨 invocation 复用。

### P2. 以真实权限合约做小范围试点

- [x] **P2-1 建立 `contracts` 的独立 fixture。**
  目的：证明原生组可以不借前面数分钟的状态。位置：SQL boundary、mini 内容 / 权限 helper；拟 `tauriPermissionRuntime.ts`。
  动作：新 root 启动，种入最小合约数据，明确 main/mini 就绪与 allowed 正向控制；不调用 mini 输入 probe，不把生产窗口行为改成测试专用模式。
  依赖：P1-3、P1-4。验证 / 通过：从空环境独立通过，SQL / 敏感拒绝与 DB 不变保护齐备；记录实际窗口影响。失败处置：补缺失前提，不临时先跑整个 mini 流程来凑状态。

- [x] **P2-2 添加单组选择并保留无参数语义。**
  目的：得到快反馈，同时不改变当前完整门槛。位置：主入口的 typed registry、package scripts、测试治理 owner。
  动作：拟支持严格的 `--group` 选择；未知组、空集合、重复 / 冲突参数明确失败；无参数仍调用全部旧范围，`--resource-cycles` 保持旧语义。
  依赖：P2-1。验证 / 通过：正向选组只执行一次，完整选组覆盖旧集合；遗漏必需项、异常退出、清理失败都传递非零结果；治理自测覆盖新调用形式。失败处置：不启用局部入口的验收用途。

- [x] **P2-3 验证试点可重复且与执行顺序无关。**
  目的：证明 fixture 隔离，而非一次侥幸成功。位置：contracts 结果、harness 的隔离测试。
  动作：在固定候选下预先安排独立运行、完整入口内运行、交换与邻组的顺序；保留每次结果。用隔离故障夹具验证拒绝失效、错 label、启动失败和 cleanup 失败会被发现。
  依赖：P2-2，以及 P4-2 / P4-3 确认的合约运行环境。验证 / 通过：相同合约结果、无跨组数据 / 端口 / profile 泄漏；任何失败都有分类，不能“重跑到绿”计通过。失败处置：暂停扩组，定位共享状态或原生环境前提。

- [x] **P2-4 已验证独立反馈；未建立量化收益基线。**
  目的：避免抽象成本高于收益。位置：本单试点记录和计时日志。
  动作：比较新旧 contracts 首次反馈、build 次数、窗口影响与清理；记录代码复杂度及仍不确定的行为。
  依赖：P2-3。验证 / 通过：试点能独立执行且诊断更直接，没有断言 / 预算减少；收益可解释才进入 P3。失败处置：修正边界或撤销没有收益的抽象，不以已投入工作为理由推广。

### P3. 扩展分组并集中输入阶段

- [x] **P3-1 拆出数据与存储组的自有前提。**
  目的：消除排名、恢复、标记、主题等隐式顺序依赖。位置：backup / storage 拟 helper 与既有 `tauri*Runtime.ts` 数据 owner。
  动作：为恢复前缓存、恢复后事实、WebDAV、六个中断阶段分别声明 seed 与 oracle；保留原缓存失效链和标记落盘后再重启的条件。
  依赖：P2-4。验证 / 通过：单组、完整组及不同组顺序结果一致；中断阶段仍证明源 / 目标、注册表与数据一致性。失败处置：保留因果链在同组，修 fixture，不加宽泛清库或任意 sleep。

- [x] **P3-2 拆出恢复与窗口生命周期组。**
  目的：让长等待有明确风险归属。位置：WebView recovery、background policy、window lifecycle helper。
  动作：耗尽组自行准备恢复次数；保留 crash 发送、CDP detach、native failure、DB 继续与新 generation 的完整时间线；重建 fresh-install / restore 场景。
  依赖：P3-1 的 fixture 模式稳定。验证 / 通过：各组无需前组故障历史；29 / 31 秒、最小化不销毁、三种故障和耗尽提示都保留真实观察。失败处置：区分故障注入未成立与产品未恢复，不统一扩大超时。

- [x] **P3-3 把所有系统输入动作聚到明确区间。**
  目的：缩短一次占用并让用户知道何时能继续工作。位置：`tauriMiniWindowRuntime.ts`、`miniNativeProbe.ts`、harness phase。
  动作：内容 / ACL / 数据先准备；输入开始时核验环境，集中三边拖动、hover、hit-test、fullscreen；结束即关闭输入 fixture；主窗生命周期仍按其窗口影响另记。
  依赖：P1-3、P3-2。验证 / 通过：输入日志区间外没有隐藏的 cursor / focus 操作；最后恢复行为也记入区间；没有通过 mock 消除必要原生断言。失败处置：重新划分区间，不能把“未计量”写成零占用。

- [x] **P3-4 加入输入前提失效诊断。**
  目的：停止与人争夺桌面。位置：native probe 采样、mini 输入组。
  动作：动作前后核对 foreground、cursor、HWND、moving、工作区与 snapshot；超出预期就停止注入并取消该组。只记录测试相关窗口身份，不采集其它应用内容。
  依赖：P3-3。验证 / 通过：在独立环境用本测试拥有的竞争窗口 / cursor 操作模拟前提破坏，明确非通过且安全释放；正常不激活行为仍由真实系统值判定。失败处置：保留未知归因，不循环 set foreground。

- [x] **P3-5 对所有等待逐一归类。**
  目的：消除无效同步，同时保留真实时间测试。位置：第 2 节所列 runtime / resource helper 和对应低层状态机测试。
  动作：将等待分为 ready 条件、生产时间边界、测量窗口、负载驻留；ready 使用有界事件 / 轮询，最后值进入诊断；真实时间和资源负载保留。
  依赖：P3-1 至 P3-4。验证 / 通过：每处固定 delay 都有测量或边界理由；低层 fake clock 测试保护组合，原生时间证据没有被替代。失败处置：缺观测接口时先分析已有 diagnostics，必要新增窄观测须按架构 owner 审查，不改生产策略凑快。

### P4. 验证独立 Windows 环境

- [x] **P4-1 盘点现有 CI 证据与可用环境。**
  目的：优先复用已有能力，避免先采购。位置：Verify workflow、可信 candidate 脚本、已授权的 Actions 只读日志。
  动作：核对当前真实 runtime run 的 candidate、镜像和分组失败；登记可用托管 / VM / 物理设备及费用前提。联网 CLI 操作前按本机约定检查工具、环境与系统代理，不输出凭据或写永久代理。
  依赖：P0-1；如无 live 访问，记录不可得。验证 / 通过：区分 workflow 配置与实际已通过场景；环境 owner 明确。失败处置：不拿归档或本地通过替代 live 结果，继续本地确定性工作。

- [x] **P4-2 托管 Windows 三次能力试点已转交，未执行。**
  目的：回答真实输入是否可运行，而非凭 runner 名猜测。位置：受保护 candidate 后的专用试点步骤 / job，复用 contracts 与 native probe。
  动作：先 contracts，再在测试自有窗口核验 session、input desktop、可见 HWND、cursor / foreground / hit-test、DPI、tray 与取消；预先固定三次独立运行记录，失败全部保留。
  依赖：P1 的进程归属、无输入取消验证及 probe 退出保护已就绪，P2-1/2 代码就绪，P4-1 已核对；不以尚未取得环境的原生验收结果作为前提，不等待全部 P3 改造。远端触发及配置变更有明确授权，不能直接 push 来取得许可。
  验证 / 通过：每次所需能力均有真实观测，无 skip；三次只是试点样本，不宣称长期稳定率。失败处置：按能力分类，将不支持组转 P4-3，原 required 状态保持未完成。

- [x] **P4-3 独立 VM / 设备本轮不实施，采用用户选择的本机验收。**
  目的：承接托管环境不能可靠证明的系统事实。位置：环境配置记录；不得把本机账号、秘密或私有资产写入仓库。
  动作：先取得明确环境配置授权，再配置测试账号 / 临时 profile、交互运行方式、显示及远程断连前提；先本地固定候选手工执行，不急于接自托管 runner。
  依赖：P4-2 的具体能力缺口。验证 / 通过：用户宿主鼠标不被客体动作接管；需要的窗口 / 输入能力、取消、重启后清理均成立；记录许可 / 维护成本。失败处置：保留人工实机验收责任，不做同会话虚拟桌面兜底冒充隔离。

- [x] **P4-4 已固定本机测量口径；跨环境比较转交。**
  目的：避免把 VM 更慢误当产品回归或以更快硬件制造收益。位置：结果元数据、既有 benchmark owner。
  动作：记录硬件 / vCPU、内存、驱动、OS、WebView2、DPI、显示器、供电与背景负载；性能前后使用相同配置且不并发 benchmark；升级环境单独建立基线。
  依赖：P4-2 或 P4-3。验证 / 通过：所有性能对比能判定是否可比；原预算不自动调整。失败处置：不可比只报告功能结论，性能验收交给固定基线环境。

### P5. 资源专项和验证政策同步迁移

- [x] **P5-1 给长循环建立独立可执行资源组。**
  目的：避免每次资源验收重跑所有不相关数据链。位置：mini / desktop resource helper 与 registry。
  动作：保留 100 次暖展开、20 次关闭重开、10 分钟空闲、forced / natural 各 30 轮及 60 秒静置；单独准备 warm baseline；功能组和资源组共用动作，不复制断言实现。
  依赖：P3、P4 的环境可用。验证 / 通过：原预算与采样口径相同，进程树完整，所有测量点和失败输出仍在；旧入口此时仍包含原范围。失败处置：对比 fixture / warmup 差异，不调阈值。

- [x] **P5-2 写明路由变化的保护依据。**
  目的：让长循环迁移成为可审查的政策变化。位置：工程质量 §5 / §5.1、必要的贡献者操作说明；本单保留决策证据。
  动作：先按第 6 节逐项确定保留的功能不变量、迁出的统计证明、强制资源触发、完整验收与缺证据的结果；未知影响走全量。仅事实改变处更新 owner，不重复整张机器清单。
  依赖：P0-2、P5-1 与完整对照的初步证据。验证 / 通过：无需读 working plan 就能判断门槛；正反例说明资源风险不会绕过；文档治理及政策自测通过。失败处置：保持现有默认语义，不先从实现里删长循环。

- [x] **P5-3 已落实 package / CI 保守分支，保留完整默认门槛。**
  目的：既缩短常用反馈，又让所有必需证据有入口。位置：package、registry、Verify workflow、test governance；发布 workflow 按实际受影响合同核对。
  动作：在 P5-2 的同一可审查改动中启用功能入口、独立资源入口及单次 prepare 的完整聚合；候选输出 SHA 传到每个 job；保留 check:full 覆盖、Rust x64 / ARM64 和安全边界。用实测冷构建、组上限与清理预算核对 job / step deadline，长资源组不能沿用容纳不下完整负载的旧上限，也不能靠无限超时掩盖卡死。
  依赖：P5-2；CI 改动与执行按对应授权。验证 / 通过：任何 required 组缺失 / 超时 / 环境失败使聚合非通过；旧风险均在路由里，coverage / mutation / budget 无静默减少。失败处置：恢复到原有编排，保留已通过的隔离和诊断改进。

- [x] **P5-4 已复用准备产物；拒绝未测量的检查删减。**
  目的：只优化实测冗余。位置：package scripts、TypeScript / Cargo 构建配置、测试治理；不动产品代码。
  动作：用 P0 计时验证类型检查范围、构建资产、Cargo target 与 CI setup 成本；只在输出 / 输入等价和失败模式仍被保护时复用。每次只处理一个可证明的重复点。
  依赖：P5-3 稳定。验证 / 通过：默认确定性顶层测试一次且并集完整，类型 / 构建 / bundle / Rust / 依赖检查均仍成立；wall time 和资源成本都有报告。失败处置：保留重复但有语义的工作，不为统一流程引入大框架。

### P6. 负向验证、完整覆盖与最终复核

- [x] **P6-1 本机失败传播和取消矩阵已验证；真实锁屏前提转交。**
  目的：确保“快”不会掩盖漏测。位置：harness 的行为测试、治理自测、隔离环境运行。
  动作：覆盖坏组名、漏 required 组、准备产物过期、端口冲突、非交互 / 锁定前提、fixture 不落盘、CDP 断连、子进程退出、输入前提破坏、资源采样缺失、超预算、清理失败和取消。
  依赖：P5-3。验证 / 通过：每个反例触发预期失败阶段与非成功汇总；日志不包含秘密；未知进程不被终止。失败处置：修对应 owner 后只重跑受影响反例和必要回归，保留原失败。

- [x] **P6-2 完成语义覆盖对照与分范围原生验收。**
  目的：证明拆分后没有丢失独有失败模式。位置：P0-2 对照、旧候选证据、新完整入口结果。
  动作：固定可比产品字节与环境，逐场景对应功能、拒绝、故障、真实时间和资源预算；对替代项说明更低层保护与仍保留的原生边界；运行完整并集。
  依赖：P6-1。验证 / 通过：必需场景零遗漏、零未解释重复，所有 required 组通过且 cleanup 成功；旧证据失效就补测，不虚构对照。失败处置：把遗漏项恢复到完整入口后再评估。

- [x] **P6-3 验证跨组状态与长期采样边界。**
  目的：发现单组独立后仍残留的全局状态。位置：完整 registry、资源组与环境记录。
  动作：对可交换组使用固定的另一执行顺序；重跑全新 root 与已有构建两种情形；资源组串行运行且保持完整时长；检查端口、profile、注册表、凭据和窗口残留。
  依赖：P6-2。验证 / 通过：改变组顺序不改结果；所有资源阈值在可比环境成立，不把 instrumentation / root-only 采样计为性能通过。失败处置：定位共享状态；不能靠强制固定偶然顺序掩盖。

- [x] **P6-4 运行与最终 diff 匹配的门槛。**
  目的：验证测试基础设施本身的风险。位置：工程质量、package scripts、实际改动文件。
  动作：至少按桌面 runtime / 架构实现边界执行 `check:full`，追加完整原生与资源证据；治理 / 政策变化执行 docs 和 test-governance 自测及相关正反例；触及性能 owner 时保留既有性能路由。
  依赖：最终代码 / 配置稳定。验证 / 通过：每份证据绑定最终输入；有效历史证据可复用但缺失项不冒充通过。失败处置：明确阻塞组与残余风险，继续独立检查，不改门槛求通过。

- [x] **P6-5 已记录实测与维护成本；量化收益对照转交。**
  目的：确认用户实际获得更短反馈和更少桌面占用。位置：本单验收记录与忽略的原始结果。
  动作：分别填写总耗时、首次反馈、build、独占并集 / 最长连续区间、首跑失败及疑似 flaky 的前后值；按机器和冷 / 热构建分层，注明样本数、runner-minutes 和环境成本。
  依赖：P6-4。验证 / 通过：收益有同口径依据；风险覆盖无降低，额外文件 / 框架 / 维护成本合理。失败处置：保留有价值的安全隔离，明确未达目标项及承接 owner，不宣称整改完成。

- [x] **P6-6 完成边界复核；未覆盖设备验收已转交。**
  目的：防止自动化通过被扩大为全部设备承诺。位置：维护者的独立设备验收、发布验收记录。
  动作：确认真正的锁屏 / 睡眠、多屏 / DPI、任务栏与硬件相关行为由哪个环境证明；消息注入、单屏 VM、x64 测试的不足明确登记。确认用户本机开发 / 安装实例与数据未被测试干扰。
  依赖：P6-5。验证 / 通过：每个剩余设备项已执行或明确移交维护者并说明不覆盖的发布风险；未执行不能打通过。失败处置：保留未完成环境验收，不更改已有证据结论。

### P7. 收口与归档

- [x] **P7-1 将已成立的规则归还长期 owner。**
  目的：避免 working plan 成为隐藏操作手册。位置：工程质量、必要的架构 / 贡献说明、package / workflows。
  动作：只写实际改变的合同，链接机器事实；删除迁移期重复实现和过时命令说明；未改变的 owner 不为“完成任务”修改。
  依赖：P6。验证 / 通过：新读者无需本单就能选择正确门槛；所有临时例外已结束或有明确退出条件。失败处置：补真实 owner，不增加另一份长期总清单。

- [x] **P7-2 复核文档与证据，再决定完成。**
  目的：保留失败和剩余责任。位置：本单及必要 owner。
  动作：逐项核对已执行、明确拒绝或转交的事项；检查 UTF-8、链接、状态与实际日志；记录未实现 / 未验收内容、责任人和下一触发条件。
  依赖：P7-1。验证 / 通过：所有适用实施与验收项有真实结论，没有把环境缺失或未运行标绿。失败处置：本单继续留在 working，不因写完文档归档。

- [x] **P7-3 归档完成的执行单。**
  目的：保持 active 文档准确。位置：`docs/working/` → `docs/archive/` 及引用入口。
  动作：方案不再活跃且所有适用项已完成、拒绝或转交后移动，修复相对链接；原始失败和测量按既有产物策略保留。
  依赖：P7-2。验证 / 通过：文档检查通过，长期政策不依赖 archive，维护者能找到剩余验收 owner。失败处置：暂不归档。完成本地方案或归档仍不授权任何远端状态修改。

## 8. 初始方案交付记录（实施前）

本次只完成现有 owner / 脚本 / fixture / 历史日志的只读核对、官方 Windows / runner 资料核对和方案编写。没有运行应用构建、原生 smoke、性能 benchmark 或任何会占鼠标 / 焦点 / 窗口的测试；没有执行 CI、环境配置、提交、推送或修改其它任务的 mini 产品内容。

以下检查只验收本次文档，不验收 P0 至 P7。

| 本次检查 | 结果 |
| --- | --- |
| `pnpm run check:docs` | 通过；扫描 22 份文档，顶层长期文档 10/10；包含本次未跟踪的新执行单 |
| UTF-8、链接 / 锚点、Markdown 与未勾选清单 | 严格 UTF-8 解码、无替代字符 / NUL、无行尾空白、代码围栏配对通过；36 处本地文件链接存在，锚点由文档检查器核对；33 个唯一实施项，全部未勾选 |
| 与所引用源码 / 政策的事实核对、任务写入范围 | 已核对本文引用的脚本、workflow、场景及历史记录；本任务仅新增此执行单，没有必要修改长期入口或 owner |

文档检查首次因沙箱不允许 Node 启动只读 `git ls-files` 而报 `spawnSync git EPERM`；经批准在沙箱外执行同一命令后通过。该次环境错误保留，不属于产品测试结果。

本节只记录方案编写时的结果。实施后的证据和剩余责任见下一节。

## 9. 第一轮实施与复核记录（输入验收暂缓时）

### 9.1 范围与最终实现

用户授权执行整改，明确没有独立 Windows 环境，选择本机集中验收。资源验收期间检测到外部光标移动后，用户进一步要求“先完成其余工作，稍后再验收”。因此本轮完成实现、后台检查和对抗式审查，输入与资源的完整通过证据仍待补齐，执行单继续留在 working。

本轮基线是 HEAD `106894b0d2e86aa136412962f8a480a07901f9e9` 加执行开始时的未提交内容；忽略目录 `artifacts/test-feedback/baseline/manifest.json` 保存 18 个相关文件的摘要，`pre-extraction.ts` 保存提取前入口。挂件退役、mini 产品及连续滑动修改属于同期工作，不算本任务成果。所有测试结果绑定产品和测试字节摘要，不能只凭 HEAD 复用。

当前实现由下列 owner 持有：

- `tauriRuntimeSmoke.test.ts` 只监督 worker；`tauriRuntimeProcess.ts` / `.ps1` 通过持有 Windows Job 和进程句柄管理本轮子树，先挂入 Job 再恢复执行。桌面互斥防止两个原生运行争用输入，同路径的独立进程不会被清理。
- `tauriRuntimeHarness.ts` 拥有准备产物、独立 profile、preview、CDP 和清理。prepare 只构建；执行前核对源码、配置、Node、instrumentation、exe 和静态资源摘要。每组使用新 profile，复用同份构建产物。P1-4 的 preview 采用按组关闭重开，保持端口和服务器清理也归当前组；同一时刻只有一个，不重复构建。
- `tauriRuntimeOptions.ts` 拥有七组选择和完整结果集合；`tauriRuntimeRunner.ts` 按组编排并保留断言与清理错误；`tauriRuntimeReport.ts` 保存阶段、结果、环境和失败链。
- 各领域模块拥有自己的 seed、因果链及 oracle。权限合约不启动输入 probe；资源组复用普通 mini 行为并追加原有长样本。
- `miniNativeProbe.ts` 在注入前检查输入桌面、光标和前台，取消时释放本 probe 按下的按钮；外部输入出现后停止，不夺回前台。强制终止未确认优雅退出时报告清理失败。
- `scripts/run-cargo-quality.ts` 将默认 Rust 质量产物放在独立 target，解决实测到的开发路径产物访问冲突；显式 target 仍由调用方控制。

没有迁出默认入口里的 100 次暖展开或 20 次关闭重开。没有缩短 10 分钟静置、forced / natural 各 30 轮及 60 秒静置，也没有放宽资源、coverage、mutation、bundle 或 Rust 门槛。CI 仅补充锁定依赖获取和阶段日志上传，保留可信 candidate、固定 SHA、x64 / ARM64 与原有完整 runtime job。未触发远端运行。

### 9.2 覆盖对照与已保留的边界

提取前 AST 清单包含 228 个 `assert`、`verify`、seed 和 tracker 调用；提取后有 251 个。13 处文本不一致逐一核对为严格参数解析、session 字段、句柄退出状态、调用参数、隔离清理或数据库路径变化，没有以调用数代替语义审查。

| 原独有边界 | 当前归属及保留的证据 |
| --- | --- |
| SQL 拒绝、main / mini 内容与权限、bridge 端口失败恢复 | `tauriPermissionRuntime.ts`；真实 invoke 拒绝、允许操作及 DB 不变正反控制 |
| 备份替换、WebDAV、read model、设置 / 事件与恢复后后台策略 | `tauriDataRecoveryRuntime.ts` / `tauriRuntimeFixtures.ts`；独立数据，保留 29 / 31 秒及最小化观察 |
| 排名与主题冷重启、profile 落盘、注册表迁移、六阶段进程中断 | `tauriStorageRestartRuntime.ts`；独立 seed，最终恢复默认位置后再做全库完整性检查 |
| 三类 WebView 故障、恢复世代与耗尽提示 | `tauriRecoveryRuntime.ts`；真实故障、数据库继续提交和原生提示 |
| 隐藏启动、30 秒销毁、单实例恢复、正常退出及最后提交 | `tauriWindowLifecycleRuntime.ts`；真实时间、Job 全部进程退出、SQLite checkpoint |
| HWND、拖动、hover、焦点、命中、全屏与 mini 生命周期 | `tauriInputRuntime.ts` / `tauriMiniWindowRuntime.ts`；所有 probe 注入在明确输入阶段内 |
| 内存、句柄、线程、完整进程树与长时间增长 | 独立 `resources` 入口；原预算和循环保留，完整验收待继续 |

准备与就绪等待使用有界条件；真实 29 / 31 秒、自然销毁、资源静置和操作驻留仍在原 owner。未取得同候选旧入口的冷 / 暖完整基线，因此不声称总耗时或桌面占用已降低某个百分比。

### 9.3 本机证据与失败处置

环境为 Windows 11 `10.0.26100` x64、Node `v24.22.1`、i5-13400F、约 32 GiB 内存，WebView2 `155.0.4283.62`。原始结果位于忽略目录 `artifacts/runtime-smoke/<run-id>/result.json`，包含产品 / 测试摘要和单调计时；以下耗时仅为当次本机观察，不是性能前后对比。

| 证据 | 结果与适用范围 |
| --- | --- |
| prepare | 已多次独立完成，无 Patina 窗口或输入 probe；同份 manifest 被多个组复用。最新本轮产品摘要 `4c4636ec0ba1b1998dd8ff1fe98f57aed46a550387583411a97f45143fac96c2` |
| contracts | 独立及完整入口首组均通过，已准备产物下约 6–7 秒反馈 |
| data-recovery | 独立及完整入口内通过，约 118–123 秒；保留恢复后的真实后台时间边界 |
| storage-restart | 发现中途提前终止应用导致 CDP 超时；已将停机与数据库终检移至最后，独立完整组通过，约 25 秒 |
| window-lifecycle / webview-recovery | 新候选按 window → recovery → contracts 的不同顺序通过，分别 34.99 / 67.16 / 6.71 秒；run 前缀分别为 `1792930724236`、`1792930760544`、`1792930828809`，各组清理成功 |
| 输入保护 | 测试自有竞争窗口导致预期失败；按下鼠标后取消，再由新 probe 证实按钮释放；三边拖动与连续反向通过 |
| resources | run `1792930587250-10fe31e1-4667-4450-ba13-e4b4eb6bd576` 因外部光标移动失败，已清理，未进入 10 分钟静置。用户要求稍后验收，不记作性能通过 |
| harness 反例 | 严格参数 / 必需结果集合、stale manifest、配置及产物篡改、端口冲突、非零退出、取消、同路径非本轮进程、桌面互斥及清理失败通过；日志写入失败仍清理临时目录、监督器突然退出后 Job 收回完整子树且无关进程存活的反例通过 |
| 后台门槛 | 类型、lint、测试治理及自测通过；首轮 frontend 完整检查通过，含 coverage、27 个 mutation 与 201 个 browser 场景。随后产品候选变化及另一轮 browser 超时不由旧证据抵扣 |
| Rust / 依赖 | 独立 quality target 的 Rust check/test/clippy/fmt 和在线依赖审计通过；最新候选复核同样通过：868 个单测、8 个原有 ignored、1 个原生进程测试及 9 个集成测试，clippy 无 warning |

原始失败保留：早期嵌套 Job 重用产生 AccessDenied，改为每次 stop 后创建新 Job；默认 debug target 产物访问失败后改用 quality target；存储组提前终止导致的 CDP 超时已修复。没有终止用户安装版或开发版。外部输入失败没有自动重跑到绿。

### 9.4 对抗式审查与剩余责任

本轮审查基于提取前入口和实际新增模块，覆盖归属、取消竞态、部分启动失败、准备产物失配、参数 / 结果集合绕过和日志失败。发现并修复：日志写入错误跳过后续临时目录 / 注册表清理；监督器清理错误覆盖原始失败；probe 强制终止被当作优雅退出。日志失败反例、监督器崩溃及子树回收、监督器 suite、类型和 lint 复核通过；probe 强制终止属于待补的取消矩阵，不冒充已实测。当前没有剩余已确认的代码缺陷，资源和完整候选门槛的证据缺口仍阻止整体验收通过。

| 未结项 | 处置 / owner / 继续条件 |
| --- | --- |
| P0-3、P2-4、P4-4、P6-5 的旧新可比收益 | 保留分组和安全隔离；拒绝在没有可比基线时迁出默认循环或宣称总时延收益。维护者 Ceceliaee 选定稳定候选及空闲桌面后补冷 / 暖样本；未知值保持未知 |
| P1-3、P2-3、P3-5、P6-1 的完整取消 / 故障矩阵 | 无窗口反例、输入竞争与按下取消已通过；完整 startup / IPC / restart / idle 中断矩阵及锁屏前提尚未穷尽。继续本机输入验收时补齐，不能将已有单点反例扩大为全矩阵通过 |
| P4-2 托管三次试点 | 转交 Ceceliaee，在授权推送或 dispatch 后执行。只读核对的 Verify run `40162347490` 的 runtime 未通过，不能证明新候选托管能力；不为取得证据擅自推送 |
| P4-3 独立 VM / 设备 | 用户确认没有，采用本机验收；本轮不配置 VM，不承诺宿主桌面隔离。未来环境由 Ceceliaee 决定 |
| P5-1、P6-2 / 3 / 4 完整资源及聚合结果 | 独立入口已实现，保留所有原有预算。用户恢复验收后，重核候选摘要；资源组和其余必需组全部通过且清理成功后才能勾选 |
| P5-3 / 4 编排及重复构建优化 | 采用保守分支：不拆远端 job、不迁出默认统计循环、不以未测量的重复为由删除检查；只保留 prepare 复用、独立资源入口和已证实需要的 target 隔离 |
| P6-6 多屏 / DPI、真实锁屏 / 睡眠、ARM64 输入 | 转交维护者 Ceceliaee 的设备 / 发布验收。消息注入、x64 本机和只读 CI 日志不覆盖这些承诺 |
| P7-2 / 3 最终结项与归档 | 输入 / 资源及最终候选门槛完成后复核本单、修复移动链接并归档；当前保持未勾选，不将“实现完成”写成“验收完成” |

## 10. 恢复本机验收后的记录

用户恢复本机输入与资源验收，并确认期间保持鼠标空闲。以下记录承接第 9 节的待验收项；未执行的独立环境试点和设备矩阵仍保留原责任人。

### 10.1 候选与失败处置

本轮产品摘要为 `ba6aca2627b6c7ed6fb92fc646616a76cdeca7228f29935e6da55627d28a1eaf`。完整入口 run `1792933791101-af0fce20-649c-4815-9857-10416dc4baeb` 的 contracts、data-recovery、storage-restart、webview-recovery、window-lifecycle 均通过并清理成功；资源组在崩溃注入处失败，整轮状态保留 failed。

继续验收发现并修复两个测试同步问题：mini 崩溃注入等待附着调试器的 Inspector 事件，可能阻止进入原生故障观察；现先取得浏览器侧传输回执再断开调试器，仍以原生故障和新世代为 oracle。像素采样切换停靠边后缺少已渲染起始状态；现等待原生快照、DOM 边缘及动画状态一致后采样，六组 60 帧采样和原反向阈值均保留。

run `1792934320135-c51cfc2d-18a5-4d46-afcc-f75a19f22c48` 完成 100 次展开和 10 分钟静置后，因光标从测试位置移开而非通过退出。未把静置片段拼接为最终资源通过。用户再次确认继续后，增加静置期间每 5 秒的只读 native 检查，及时发现输入前提变化；退出清理也不再额外显示主窗口。失败结果及日志均保留。

准备产物校验补入 `tsconfig.json` 和 `tsconfig.node.json`，防止构建配置变化后仍接受旧 manifest。这两份配置本轮未修改；摘要范围扩大属于校验修复，后续重新 prepare 验证。CI 普通原生步骤改为 20 分钟、job 改为 30 分钟，容纳 8 分钟冷构建与实测约 8 分钟普通 runtime 并集及清理；未扩大产品断言和资源组预算，也未执行远端 job。

### 10.2 取消与清理反例

真实 worker 的启动、原生无响应等待、存储重启、报告写入失败及资源静置取消全部按预期非零退出；每例均验证 owned 子树归零和临时 profile 删除。报告写入失败由仅替换当轮 `result.json` 为目录触发，仍产生 session 清理日志，且原始失败与报告失败同时保留。

| 取消位置 | run 前缀 | 取消到退出 |
| --- | --- | --- |
| startup | `1792935130023` | 378 ms |
| IPC / recovery wait | `1792935131507` | 375 ms |
| storage restart | `1792935182803` | 300 ms |
| report write failure | `1792935194323` | 357 ms |
| resource idle | `1792935216086` | 513 ms |

另以持有身份句柄的方式暂停本测试自己的 probe，确认 5 秒优雅退出上限后强制终止会明确报清理未确认，且 owned probe 已退出。暂停前按钮未按下；真实按下取消释放按钮由输入组的独立反例验证。原始记录保存在忽略目录 `artifacts/test-feedback/cancellation-matrix.json` 与 `probe-forced-close.json`。这些取消反例不计为功能或性能组通过。

### 10.3 原生输入和资源的最终证据

mini 完整输入 / 资源阶段在 run `1792935377638-6327e4c4-9881-46cf-b593-dd3a668c6261` 中完成，随后进入主窗口资源阶段。六组各 60 帧像素采样、三边拖动、命中与焦点、全屏与电源消息、单实例、mini 原生崩溃恢复、偏好持久化、main 自然销毁及重建均通过；输入 probe 清理成功。长样本没有拼接或缩短。

| 本机测量 | 结果 |
| --- | --- |
| 100 次暖悬停 | p50 157.07 ms，p95 173.29 ms，原 p95 250 ms 预算通过；冷展开 464.77 ms 单列 |
| mini 连续静置 | 604.55 秒；隐藏内容无额外读取或 reveal，GDI 31 → 31，根进程句柄 725 → 726，原 worker / detector / CPU / 进程树预算通过 |
| 20 次完整关闭重开 | 根进程句柄 731 → 731，GDI 31 → 31，线程 51 → 51 |
| 主窗口 forced GC | 30 轮与 60 秒静置完整完成；四个样本 DOM listener 均为 320、节点均为 359、interval 均为 1；句柄 692 → 684，完整进程树和内存预算通过 |
| 主窗口 natural GC | 30 轮与 60 秒静置完整完成；interval 均为 1，句柄 690 → 700，完整进程树和内存预算通过；未回收 listener 不冒充 retained listener 口径 |

该 mini run 的主窗口 forced GC 阶段原先失败：采样先 GC、再调用原生诊断 IPC，IPC 自己创建的临时 event target 被随后 DOM 计数采入。真实应用负向控制观测到相同 283 个节点下 listener 为 313 → IPC 后 338 → 再 GC 后 313，记录在 `artifacts/test-feedback/resource-measurement-control.json`。修复仅把原生诊断放到 forced GC 之前，并增加连接节点的监听器诊断；所有预算保持不变。

修正后的 forced 模式由 run `1792936834410-46d2a7db-4d80-4663-8edc-7d7feeae175e` 使用实际 `verifyDesktopResourceLifecycle` 完成；natural 模式由 run `1792936486789-8b1b4c93-f37d-4f89-bfbd-4aee6e5d4aae` 完成，其执行顺序不受 forced GC 修正影响。两次 targeted 运行退出码为 0，清理完成。它们使用实际 owner 和新 profile，不复制或删除原断言。

最终 prepare 为 `1792936421392-f5d3b64b-9667-4cd9-b6c9-038cda50510e`。指纹范围补入两份未改动的 TypeScript 配置后，产品摘要为 `f6e57e127bd2a8d3b248f496e1dbe15a74f0902acfe4e721a290688f6a8f0c5f`。核对证明此前 836 个产品输入字节未变，重建前端字节相同；新范围包含 838 个文件，旧 manifest 被明确拒绝。新 manifest 的 contracts run `1792937066788-174a7082-eb2b-4afa-84c7-b603467e74bc` 通过并清理成功。

`artifacts/test-feedback/final-native-acceptance.json` 是分范围证据索引，不是改写后的 runner 结果。五个非输入组引用 §10.1 中各自通过并完成清理的结果，mini 引用已完整结束的输入 / 资源阶段，主窗口引用上述对应模式；原组合 run 仍为 failed。这里不声称最后一次完整组合命令退出码为 0。复用依据是未变化的产品输入和对应测试路径，受修正影响的 forced 路径已重新完整验证。

### 10.4 等待、编排与收益结论

就绪等待采用有界状态观察。保留的固定时间各有实际含义：29 / 31 秒证明后台释放边界；650 ms 观察键盘、菜单和触摸保护；600 ms 观察浮动检测；500 ms 观察暂停优先级或 held detector；150 ms 是拖动按下驻留；250 ms 证明关闭后 worker 不再运行；普通 mini 的 1 秒与资源模式连续 10 分钟是各自空闲采样窗口；资源页面的 450 ms 为负载驻留，最后 60 秒为空闲测量。probe 的短等待用于消息泵 / 有界原生采样，取消和强制清理另有硬上限。像素起点与崩溃注入的同步缺口已按 §10.1 修正。

分组、独立 fixture、run ID、阶段日志、prepare 复用、资源独立入口及 quality target 均已落地。已准备产物下，本轮五个非输入组从 launch 至 cleanup 分别为 5.28、122.48、24.07、66.25、33.71 秒；这些是本机单次观察。额外维护成本主要来自 Windows Job 监督、产物校验及分领域 fixture；这些模块分别承担运行归属、拒绝过期产物和独立执行的必要责任，没有另建通用测试框架。

未建立同候选旧入口的冷 / 暖对照，不能证明总时间或桌面占用减少了多少。原 100 次悬停、20 次重开仍在普通完整入口，资源组保持所有长样本；不拆远端 job，也不删除尚未证明冗余的类型、构建或预算检查。这是 P2-4、P5-3 / 4 的保守结项分支，量化收益另由下表承接。

### 10.5 剩余责任的结项处置

| 项目 | 最终处置、责任人及触发条件 |
| --- | --- |
| P0-3、P2-4、P4-4、P6-5 的旧新冷 / 暖与跨环境比较 | 本轮完成阶段测量，不声明量化优化收益。对照工作转交 Ceceliaee；在稳定候选、可比旧入口和固定空闲环境均可得时重新立项测量 |
| P4-2 托管 Windows 三次试点 | 未执行，转交 Ceceliaee；取得对应推送或 dispatch 授权后验证候选与输入能力。本机结果不证明托管能力 |
| P4-3 独立 VM / 设备 | 用户选择本机，本轮不配置独立环境；未来由 Ceceliaee 决定环境与费用，不声称宿主桌面隔离已成立 |
| P6-1 的真实锁屏前提与 P6-6 设备矩阵 | 未执行，转交 Ceceliaee 的设备 / 发布验收；真实锁屏、睡眠、多屏 / DPI 和 ARM64 输入需要对应设备。消息注入与 x64 本机测试不替代这些场景 |

上述转交不产生远端 Issue / Project 状态变化，也不表示设备或发布验收通过。本轮适用的本机验收已完成；最终质量检查和归档核对另记于下一节。

### 10.6 最终门槛、对抗式复核与归档

最终 `pnpm run check:full` 于 2026-10-25 执行通过，退出码 0，用时 429.55 秒。包括类型、lint、架构与治理及自测、快速测试、运行监督器反例、风险域 coverage、27/27 mutation、205 个 browser 场景、生产构建与 bundle、Rust 格式 / check / clippy、869 个单测、1 个原生进程生命周期测试及 9 个集成测试，以及在线依赖审计；8 个既有 ignored 保持原样。结果和日志位于忽略目录 `artifacts/test-feedback/final-quality-result.json` 与 `final-quality.log`。

实现与验收完成后，对本任务测试基础设施 diff 做对抗式自审，复核了 Windows Job 归属、部分启动与强制退出、取消期间输入释放、原始失败与报告失败聚合、准备产物失配、缺组 / 重复组拒绝、真实断言的提取去向、性能采样以及 CI deadline。期间发现的报告写入阻断清理、probe 强制退出误判、mini 故障注入与像素起点同步、构建配置漏入指纹、forced GC 采样顺序问题均已修复，并有相应真实反例或受影响路径验收。当前没有剩余已确认的可操作缺陷；§10.5 仍是明确的验证限制，不扩大自审结论至同期其它任务的全部产品 diff。

最终引用的五次原生运行清理阶段均完成，临时 profile 残留为零。33 个执行项按完成、拒绝或转交处置勾选；本单移入 `docs/archive/`。没有提交、推送、修改远端状态或终止用户开发 / 安装实例。

归档后 `check:docs` 通过，扫描 21 份 active 文档、顶层 owner 10/10；另核对本归档的严格 UTF-8、33 个唯一结项标记、36 处本地链接及源路径已移除。`git diff --check` 通过。最终源码摘要再次匹配原生验收证据。
