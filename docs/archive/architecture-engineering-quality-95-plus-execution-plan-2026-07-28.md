# Patina 架构与工程质量 9.5+ 执行方案

> 状态：已完成、已对抗复审、已归档
>
> 创建日期：2026-07-28
>
> 完成日期：2026-07-28
>
> 基线提交：本地 `main@fe2bc5a`
>
> 远端基线：`origin/main@3796c0f`
>
> 最终实现提交：本地 `main@4d9e55d`
>
> 综合评分：`7.8 / 10 → 9.6 / 10`
>
> 文档类型：面向维护者与仓库代理的阶段化执行指南
>
> 文档归宿：`docs/archive/`

## 0. 归档结论

本计划已在本地 `main@4d9e55d` 完成 19 个可审查提交。归档中的 `[x]` 表示条目已经执行、验证，或作为条件分支完成了明确裁决；它不表示代理执行了未获授权的远程操作。未触发或未获授权的条件分支如下：

- GitHub Project：live Project 已只读复核，没有与本次一次性计划对应的既有 item；此前未获得创建新 item 的单独明确授权，因此没有创建、移动或改写远程事项。
- Project `Next`：当前 live Project 只有两个 `Next`；按路线图建议维护者把“复测并收口灵动视效”从 `Queued` 拖到 `Next`，其余状态不动。
- Release：本轮没有版本、tag、GitHub Release 或 updater artifact 变更，候选版本发布步骤不适用。
- Remote：没有 push、Issue、PR、Project 状态或 Release 写操作。
- 停止条件：没有发现需要引入新根层、长期兼容壳、双路径或降低门槛的情况；所有停止条件均审查后判定未触发。

### 0.1 最终双重评分

| 维度 | 权重 | 实施者复算 | 对抗式复算 | 主要证据 |
|---|---:|---:|---:|---|
| 安全与信任边界 | 20% | 9.8 | 9.7 | main/Widget 精确 application command 权限、敏感 caller guard、真实双窗口拒绝矩阵 |
| 架构与所有权 | 20% | 9.6 | 9.5 | AppShell owner-first 拆分、结构型 hotspot 门、前端/Rust 边界全绿 |
| 数据一致性与运行可靠性 | 15% | 9.7 | 9.6 | 单 revision 聚合、分片重试、heatmap 竞态状态机、bridge 有界恢复 |
| 测试、验证与发布可信度 | 20% | 9.7 | 9.7 | 逐文件覆盖、14/14 mutation、57 场景浏览器、真实 Tauri、`check:full` |
| 性能与资源治理 | 15% | 9.5 | 9.5 | `perf:stable` 35 个子运行全绿、Data 完整生命周期、bundle 3% 余量 |
| 可维护性与可观测性 | 10% | 9.4 | 9.4 | bridge 诊断、可行动 checker、长期文档；保留部分历史热点 |
| **加权综合分** | **100%** | **9.64** | **9.59** | **保守发布分取 `9.6 / 10`** |

两次计算差异为 `0.05`，小于重新仲裁阈值 `0.2`。最终分数不按 9.64 四舍五入到 9.7，而取更保守的 `9.6`。

### 0.2 最终验证证据

- `PATINA_DEPENDENCY_AUDIT_OFFLINE=1; npm run check:full`：通过。包含 types、lint、边界 checker/self-test、IPC `96/96`、结构热点、Quiet Pro、测试治理、覆盖率、mutation、真实浏览器、生产 build、bundle、Rust 和依赖审计。
- 覆盖率：总体 statements/lines `96.04%`、branches `88.32%`、functions `91.30%`；三类高风险 owner 的逐文件门为 `90/85/90/90`。
- Critical mutation：`14/14` killed，覆盖权限错误分类、Widget SQL 回流、caller guard 反转、revision 混合、retry 丢失和 bridge 停止恢复。
- `npm run test:ui-browser-smoke`：`57/57` 通过，控制台与网络错误为零；Widget DPI 矩阵 `144` 个渲染组合。
- `npm run test:tauri-runtime-smoke`：真实 Tauri/WebView2 命令、事件、SQLite、main/Widget capability 与 caller denial matrix 通过。
- Rust：`505 passed`、`1 intentional ignored`，fmt、check、clippy `-D warnings` 通过。
- 依赖：显式离线模式使用本地 `1169` 条 RustSec 数据；`0` 个 Windows 可达漏洞，`3` 个精确 lock-only advisory 均由 Windows target tree 证明不可达；npm `0` 漏洞。默认 CI 联网审计行为保持不变。
- `npm run perf:stable`：7 类基准各 5 轮、共 35 个子运行全部通过；Dashboard 平均约 `7.09ms`，Data 365 日 combined 平均约 `339.54ms`。
- 最终 `npm run perf:data-history-browser`：Data active p95 `86.2ms`，read-model-ready p95 `195.2ms`，complete p95 `217.4ms`；7→365 日 p95 `378.8ms`，365→7 日 p95 `559.2ms`；控制台错误为零。
- Bundle：initial JS+CSS `181.92 KiB gzip`，all lazy JS `113.97 KiB`，total JS+CSS `295.89 KiB`；所有 hard budget 均满足强制 `3%` 余量。
- 对抗搜索：Widget 路径无 token、raw settings、plugin SQL 或 SQL 文本；feature/shared 无 platform/Tauri 直连绕过；无 Recharts 生产依赖；无 `src/lib`、`src/types` 根层回流；commands 最大文件 `216` 行。

### 0.3 仍接受的低风险限制

- `Data.tsx`、`History.tsx`、`useAppMappingState.ts` 与部分 CSS 仍是历史热点。本轮只拆出与 P1/P2 证据直接相关的 owner，未为“数字好看”一次性重构全部热点；hard growth guard 保持生效。
- 主窗仍使用 Tauri `core:default`，但 application command、SQL 数据库范围和窗口授权均精确；Widget 不拥有 core default、plugin SQL 或 main-only command。后续 Tauri 大版本升级时应重新审查 core preset 展开项。
- 通用导航 smoke 的推荐性 p95 在多轮中有 `89–183.5ms` 波动；它不是发布 hard gate。独立 Data/History 性能门的完整生命周期多轮稳定通过，因此不判定为 release blocker，但保留为持续观测项。
- 离线依赖审计受本机 advisory 数据库新鲜度约束；默认 CI 仍执行联网审计，不能用离线模式替代发布环境的更新检查。

## 1. 如何使用本文档

本文档是一次架构与工程质量收口工作的执行清单，不是愿望列表，也不是通过增加测试数量来制造高分的评分表。

- [x] 实施前确认维护者已接受本方案范围；若对应现有 GitHub Project item，先按 `docs/roadmap-and-prioritization.md` 读取 live Project。
- [x] 开始每一阶段前，确认上一阶段退出条件已经满足。
- [x] 每完成一个步骤，立即勾选，并在该步骤下记录提交、测试名、命令结果或证据文件。
- [x] 所有质量结论固定到一个明确提交；不得把不同提交上的通过结果拼成一次“全绿”。
- [x] 运行全量验证时保持工作树干净，不在测试期间运行 `npm ci`、开发服务器或其他会修改依赖与资源占用的任务。
- [x] 任何失败都先判断是产品代码、测试工具、环境干扰还是既有基线；不得无证据地归因。
- [x] 发现新的 P0/P1，立即停止评分冲刺，先将其加入本方案并完成风险处置。
- [x] 若实施需要新增共享抽象、跨层兼容壳、目录级 allowlist 或长期双路径，停止并重新进行 owner 判断。
- [x] 不通过压缩物理行、删除断言、放宽预算、扩大忽略列表或降低阈值获得“通过”。
- [x] 不把单次 benchmark 通过、手工点击成功或代码审阅感觉当作稳定性证据。
- [x] 达到第 30 节全部条件后才允许宣称 `9.5+`。
- [x] 完成后更新真实结果、复算评分、归档本文档，不让一次性计划长期留在 `docs/working/`。

## 2. 一句话目标

把 Patina 从“分层与测试体系成熟，但仍有权限边界、门禁可信度、数据一致性和性能稳定性缺口”的 `7.8` 分工程，提升为“关键权限默认拒绝、所有高风险读写可证明一致、质量门不可游戏化、性能与依赖证据可重复”的 `9.5+` 分工程。

## 3. 第一性原理

### 3.1 质量分数不是任务完成率

完成十个任务不等于提高一分。质量只能由以下链条建立：

```text
风险
→ 可复现失败或可验证缺口
→ 明确所有者
→ 最小完整修复
→ 独立失败路径测试
→ 真实运行时证据
→ 对抗式复核
→ 同一提交上的全量门禁
```

由此得到：

- [x] 每个阶段先写“失败如何被观察”，再写实现。
- [x] 每个评分提升都必须指向一项可复核证据。
- [x] 没有证据的“应该没问题”计为未完成。
- [x] 仅改变门禁数字、代码格式或报告口径不计分。

### 3.2 安全边界的本质是限制失陷后的影响

Patina 的前端代码来自本地 bundle，并有 CSP；这降低了前端被注入的概率，但不能替代窗口权限隔离。Capability 的价值不是证明正常路径能调用命令，而是证明错误窗口、被攻破窗口或意外代码不能调用命令。

由此得到：

- [x] 自定义 Tauri command 默认视为未授权，必须被显式权限授予。
- [x] Widget 只能拥有其运行所需的最小命令与插件权限。
- [x] 密钥、恢复、删除、迁移、导入和更新等高风险命令必须 main-only。
- [x] capability 静态配置必须由真实 Widget WebView 的拒绝测试证明。
- [x] 对密钥和破坏性命令增加命令入口的调用者校验，形成纵深防御。

### 3.3 架构边界的本质是变化所有权

文件大小不是最终目标。一个模块是否健康，取决于它是否只有清晰、稳定且可解释的变化原因。把两行 JSX 合成一行不会减少变化原因，也不会降低耦合。

由此得到：

- [x] 先列出模块当前承担的变化原因，再决定拆分。
- [x] 新模块必须有真实 owner，不以“utils”“common”或“shared”命名来掩盖未知所有权。
- [x] 拆分后的调用方向必须继续满足 `app / features / shared / platform`。
- [x] hotspot 门禁必须度量无法被换行方式轻易改变的结构信号。

### 3.4 数据可信度来自同一逻辑时刻

统计读模型输出中的 records、coverage、revision 和分片结果如果来自不同数据时刻，就可能各自正确但整体错误。

由此得到：

- [x] 一次用户可见统计结果必须定义其快照边界。
- [x] 同一响应内的多个查询必须共享事务或可验证 revision。
- [x] 多个 IPC 分片必须证明属于同一 revision，否则丢弃并重试。
- [x] 缓存版本只表示前端失效意图，不能替代数据库读快照。

### 3.5 可靠性来自自动恢复和可诊断失败

长期运行的桌面应用不能依赖用户重启来恢复可预期的瞬时失败。

由此得到：

- [x] 可恢复错误必须有有界退避、状态和最终恢复路径。
- [x] 不可恢复错误必须能被用户或诊断快照观察。
- [x] 后台服务不得只写 `eprintln!` 后静默退出。
- [x] 自动恢复不能形成无限重启、日志风暴或资源泄漏。

### 3.6 性能质量来自稳定余量

刚好低于预算不等于性能健康。预算是产品可接受上限，不是日常运行目标。

由此得到：

- [x] 性能结论以串行稳定套件为准。
- [x] 任一轮超预算都保留为失败证据，单次复跑通过不能覆盖它。
- [x] 性能优化必须命中实际瓶颈，不通过预热全部数据或扩大缓存转移成本。
- [x] bundle 与运行时预算应保留明确余量，避免下一次正常功能开发立即撞线。

## 4. 当前基线事实

### 4.1 版本与工作树

- [x] 审查基线最初固定在 `main/origin@3796c0f`。
- [x] 本方案创建时本地 HEAD 为 `fe2bc5a`，远端仍为 `3796c0f`。
- [x] 本地额外提交标题为 `fix(ci): keep app shell within hotspot budget`。
- [x] 该提交把多个 JSX 属性压到同一物理行，使 `check:hotspots` 从失败变为通过，但没有减少 `AppShell` 的职责。
- [x] 实施阶段将该机械调整替换为真实的 owner-first 拆分。
- [x] 在真实拆分完成前，该提交不得被记为质量改进分。

### 4.2 已确认的正面证据

- [x] 前端 owner 边界检查与 self-test 已建立。
- [x] Rust owner 边界检查与 self-test 已建立，当前无已登记边界债务。
- [x] IPC contract 检查曾证明 95 个前端调用与 95 个注册命令一致。
- [x] Rust 验证曾达到 492 passed、1 intentional ignored，fmt、check、clippy 全通过。
- [x] 真实 Tauri/WebView2 runtime smoke 已通过命令、事件、SQLite 和既有 capability 检查。
- [x] 前端生产构建与当前 bundle budget 已通过。
- [x] Web Activity Bridge 已具备 localhost 绑定、token、请求大小、客户端数量和超时限制。
- [x] SQLite 查询使用参数绑定，新 Web 聚合查询未发现 SQL 注入路径。
- [x] CI 已覆盖前端、Rust、依赖审计与 Windows 真实 Tauri runtime。

### 4.3 已确认的缺口

- [x] Widget capability 声称 least-privilege，但仍授予 `sql:allow-load` 与 `sql:allow-select`。
- [x] Widget 前端运行路径未发现直接使用 plugin SQL 的必要。
- [x] 应用没有 `src-tauri/permissions/`，`build.rs` 没有声明 application command manifest。
- [x] 自定义 `invoke_handler` 命令未按 main/widget 窗口显式收口。
- [x] Widget 理论上可触达密钥读取、备份恢复、数据删除和存储迁移等命令。
- [x] 当前 runtime smoke 验证 main 窗口 plugin SQL execute 被拒绝，但未从 Widget target 攻击 main-only 自定义命令。
- [x] `AppShell` 的 hotspot 通过可以被换行方式操纵。
- [x] `useDataWebActivityRuntime` 在 render 阶段写入保留 heatmap ref。
- [x] Web heatmap 请求 effect 不依赖统一 `retryKey`。
- [x] Web aggregate 的 segment 与 coverage 查询没有共享显式读事务。
- [x] 超过 400 个 bucket 时前端顺序读取多个 IPC 分片，但返回值没有数据库 revision。
- [x] Web Activity Bridge 端口绑定失败后只输出错误并停止，没有自动重试。
- [x] `test:coverage` 只强制 include 六个文件，新 Web read model 不在强制覆盖集合中。
- [x] mutation gate 当前只有八个关键 mutant，不能代表系统级 mutation 强度。
- [x] `perf:stable` 曾在第二轮出现 Dashboard → Data 两项 average 超预算。
- [x] 同一浏览器场景隔离复跑全绿，因此当前结论是“临界不稳定”，不是已证实的持续回归。
- [x] bundle 多个子预算接近上限，安全余量不足。
- [x] 依赖审计在本轮审查环境中因出站策略未得到结论。

## 5. 评分模型

### 5.1 权重

| 维度 | 权重 | 当前分 | 目标分 |
|---|---:|---:|---:|
| 安全与信任边界 | 20% | 7.0 | 9.7+ |
| 架构与所有权 | 20% | 8.1 | 9.5+ |
| 数据一致性与运行可靠性 | 15% | 7.7 | 9.5+ |
| 测试、验证与发布可信度 | 20% | 8.5 | 9.6+ |
| 性能与资源治理 | 15% | 7.6 | 9.4+ |
| 可维护性与可观测性 | 10% | 7.9 | 9.4+ |
| **加权综合分** | **100%** | **7.8** | **9.5+** |

### 5.2 9.5+ 硬门槛

以下条件具有否决权，即使加权分数达到 9.5，也不能宣布完成：

- [x] 没有未关闭的 P0 或 P1。
- [x] 没有已知 release-blocking P2。
- [x] 安全与信任边界不低于 9.5。
- [x] 测试、验证与发布可信度不低于 9.5。
- [x] 任一维度不得低于 9.0。
- [x] `npm run check:full` 在目标提交、干净工作树和声明工具链上通过。
- [x] `npm run test:tauri-runtime-smoke` 在目标提交上通过。
- [x] `npm run perf:stable` 在无并发开发进程的环境中完整通过。
- [x] 直接相关性能场景至少再独立复跑一次并通过。
- [x] 依赖审计得到明确结果；不能以“未运行”代替“无漏洞”。
- [x] 没有通过降低阈值、扩大忽略、删除测试或格式压缩使门禁变绿。
- [x] 对抗式复审没有发现能推翻评分的新高风险缺口。

### 5.3 不计分事项

- [x] 单纯增加代码行或测试数量。
- [x] 只增加成功路径测试。
- [x] 只更新执行方案和评分文字。
- [x] 把 JSX、CSS 或 Rust 压成更少物理行。
- [x] 将职责移动到一个新建但无清晰 owner 的文件。
- [x] 将预算调高到刚好覆盖当前输出。
- [x] 将失败 benchmark 标记为 flaky 后忽略。
- [x] 把 runtime 行为只替换成 stub 测试。
- [x] 只在 main WebView 验证 Widget capability。

## 6. 范围

### 6.1 包含

- [x] Tauri application command 权限、capability 与窗口调用者校验。
- [x] Widget plugin SQL 权限收口。
- [x] `AppShell` 语义拆分与 hotspot 门禁升级。
- [x] Web heatmap 生命周期、失败恢复和并发渲染纯度。
- [x] Web aggregate 单次响应与多分片快照一致性。
- [x] Web Activity Bridge 绑定失败恢复与运行状态诊断。
- [x] 高风险 owner 的覆盖率与 mutation 治理。
- [x] Data 导航、读模型与 bundle 的性能余量。
- [x] CI、release gate、文档和评分复核。
- [x] 与上述变更直接相关的最小 owner-first 热点拆分。

### 6.2 不包含

- [x] 不新增产品功能。
- [x] 不进行 Quiet Pro 视觉重设计。
- [x] 不改变个人、本地优先、Windows 桌面产品方向。
- [x] 不顺带重构所有 500 行以上文件。
- [x] 不为追求数字统一强拆设计 token 或稳定测试 fixture。
- [x] 不新增 team SaaS、云同步或移动端架构。
- [x] 不重写 Rust 数据层或切换数据库框架。
- [x] 不以 9.5+ 为理由重做无证据问题的模块。

## 7. 必须始终成立的不变量

- [x] Widget 不能读取 WebDAV 明文密钥。
- [x] Widget 不能执行备份恢复、数据删除、导入、存储迁移或更新安装。
- [x] main-only command 的拒绝不依赖前端隐藏按钮。
- [x] main 窗口保留完成现有产品行为所需的权限。
- [x] Widget 保留拖动、展示主窗口、读取跟踪快照和暂停跟踪等必要行为。
- [x] capability 拒绝不会破坏真实 Tauri runtime 启动。
- [x] `commands/*` 保持薄，不承载业务算法。
- [x] `shared/*` 不反向依赖 app、features 或 platform。
- [x] `platform/*` 不反向依赖 app 或 features。
- [x] 所有 SQLite 写继续由 Rust 正式数据边界拥有。
- [x] Web 统计响应不混合无法识别的多个数据 revision。
- [x] heatmap 保留内容只来自已提交的 React render。
- [x] 后台 bridge 重试有界、可取消且不会产生多个监听器。
- [x] 性能优化不改变统计语义、数据新鲜度或错误呈现。
- [x] 所有修复保持现有 Quiet Pro 视觉与交互语义。

## 8. 预期所有权

| 问题 | 主要 owner | 允许协作层 | 禁止落点 |
|---|---|---|---|
| application command 权限 | `src-tauri/build.rs`、`src-tauri/permissions/`、`src-tauri/capabilities/` | `commands` 的边界校验 | 前端按钮条件 |
| Widget 调用者校验 | Rust command 边界 | `app` 用例返回结构化错误 | domain、data |
| AppShell composition | `src/app` | feature public props | shared、platform |
| Web heatmap runtime | `src/features/data` | feature-owned service | app、shared |
| Web aggregate 快照 | `src-tauri/src/data` | platform gateway 契约 | React component |
| IPC 分片 revision | `src/platform/persistence` | data feature read model | shared |
| Bridge 恢复 | `src-tauri/src/platform/web_activity_bridge.rs` | app 启停协调 | commands、domain |
| Bridge 诊断 | platform runtime state、diagnostics read model | Settings/diagnostics UI（仅有需求时） | 零散 `println!` |
| 覆盖率治理 | `package.json`、test scripts | feature tests | 生产代码测试分支 |
| 性能治理 | `scripts/perf` 与实际 owner | bundle checker | 预算常量单独上调 |

## 9. 阶段 0：建立不可争议的实施基线

### 9.1 快照

- [x] 记录开始实施时的 `git rev-parse --short HEAD`。
- [x] 记录 `git status --short`，识别并保护用户已有改动。
- [x] 记录 `git rev-parse --short origin/main`。
- [x] 记录 Node、npm、Rust、Cargo 和 Windows 版本。
- [x] 确认没有 `npm ci`、`vite`、`tauri dev` 或 benchmark 在后台并发运行。
- [x] 记录当前 `node_modules` 完整性；若依赖缺失，先执行受控的 `npm ci`。
- [x] 运行 `git diff --check`。

### 9.2 基线命令

- [x] 运行 `npm test`。
- [x] 运行 `npm run test:replay`。
- [x] 运行 `npm run build`。
- [x] 运行 `npm run check:rust`。
- [x] 运行 `npm run check:hotspots`。
- [x] 运行 `npm run quality:hotspots` 并保存报告。
- [x] 运行 `npm run test:ui-browser-smoke`。
- [x] 运行 `npm run test:tauri-runtime-smoke`。
- [x] 串行运行 `npm run perf:stable`。
- [x] 在取得联网授权的环境运行 `npm run check:dependencies`。
- [x] 将每个失败按“产品 / 测试工具 / 环境 / 既有基线”分类。

### 9.3 基线证据文件

建议保存到本地临时证据目录，不将大日志长期提交：

```text
artifacts/quality-95-baseline/
├── environment.txt
├── git-status.txt
├── check-full.txt
├── tauri-runtime-smoke.txt
├── perf-stable.txt
├── dependency-audit.txt
├── bundle-budget.txt
└── hotspot-report.txt
```

- [x] 证据不包含密钥、WebDAV 密码、个人路径外的敏感数据或用户活动内容。
- [x] 若 artifacts 默认被忽略，只在执行方案中记录摘要与时间，不强行提交大日志。

退出条件：

- [x] 所有既有失败都有明确分类。
- [x] 后续可以在同一工具链和机器条件下复跑。
- [x] 没有未识别的用户改动与计划范围冲突。

## 10. 阶段 1：先建立 Tauri 权限红测

### 10.1 命令权限清单

- [x] 从 `src-tauri/src/app/bootstrap.rs` 生成全部 custom command 名单。
- [x] 从前端 `invoke` 使用点生成实际调用名单。
- [x] 将每个命令分类为 `main-only`、`widget-only`、`shared` 或 `backend-only`。
- [x] 对没有前端调用但仍注册的命令单独审查；删除死入口或解释保留原因。
- [x] 明确以下命令族默认属于 `main-only`：
  - [ ] 备份导出、预览、恢复。
  - [ ] WebDAV 密钥保存、删除、存在性检查和明文读取。
  - [ ] WebDAV 测试、上传、列举、下载和临时文件删除。
  - [ ] 数据导入、导入批次删除和数据解构。
  - [ ] session 与 web activity 删除。
  - [ ] 存储目录迁移、恢复默认和清理 WebView cache。
  - [ ] updater 检查、下载和安装。
  - [ ] 设置提交和数据 bootstrap payload 写入。
- [x] 明确 Widget 的最小 command 集合。
- [x] 由调用证据确认 shared 命令，例如跟踪快照或暂停状态；不得凭命名猜测。

### 10.2 真实 Widget 攻击测试

- [x] 修改 runtime smoke，使测试能够识别并连接 Widget WebView target。
- [x] 从 Widget target 调用 `cmd_reveal_webdav_backup_secret`，预期权限拒绝。
- [x] 从 Widget target 调用 `cmd_restore_backup`，预期在进入参数解析或业务逻辑前拒绝。
- [x] 从 Widget target 调用一个 session 删除命令，预期拒绝。
- [x] 从 Widget target 调用一个存储迁移/重启命令，预期拒绝。
- [x] 从 Widget target 调用 updater 安装命令，预期拒绝。
- [x] 从 Widget target 调用 `plugin:sql|select`，预期拒绝。
- [x] 从 Widget target 调用 `plugin:sql|load`，预期拒绝。
- [x] 从 Widget target 调用允许的 Widget 命令，预期成功。
- [x] 从 main target 调用现有必要 command，预期保持成功。
- [x] 断言拒绝不会执行任何 SQLite 写、文件操作、重启或密钥读取副作用。
- [x] 让至少一条攻击测试在权限修复前稳定失败，证明红测真实命中缺口。

### 10.3 静态权限检查红测

- [x] 扩展 architecture 或独立安全检查器，发现未声明 application manifest 时失败。
- [x] 检查 Widget capability 出现 `sql:allow-load` 时失败。
- [x] 检查 Widget capability 出现 `sql:allow-select` 时失败。
- [x] 检查 main-only permission 被 Widget capability 引用时失败。
- [x] 检查 sensitive command 既无 capability 收口又无 caller guard 时失败。
- [x] 为多行 TOML、permission set、命令重命名和 capability 引用增加 self-test。

退出条件：

- [x] 红测能证明当前 Widget 权限过宽。
- [x] 测试从真实 Widget WebView 发起，而不是伪造一个字符串 label。
- [x] 攻击测试没有真实破坏用户数据。

## 11. 阶段 2：收口 Tauri application command 权限

### 11.1 Application manifest

- [x] 将 `src-tauri/build.rs` 从简单 `tauri_build::build()` 改为显式 build attributes。
- [x] 使用 application manifest 声明全部允许被权限系统管理的 custom commands。
- [x] 保持 `TAURI_CONFIG` 与 `patina_local_build` 的现有行为。
- [x] 运行标准 Tauri permission/schema 生成流程。
- [x] 使用标准命令列出最终可用 permission，核对生成标识符，不手工猜测名称。
- [x] 审查生成文件，确认只包含当前注册命令。
- [x] 增加检查，防止 bootstrap 新增 command 但 manifest 未同步。

### 11.2 Permission sets

- [x] 在 `src-tauri/permissions/` 建立应用自有 TOML 权限。
- [x] 建立 main window 所需 permission set。
- [x] 建立 Widget 最小 permission set。
- [x] 只把真实 shared commands 同时加入两组。
- [x] 为读取类、写入类、破坏类和密钥类 permission 提供清晰描述。
- [x] 不使用一个“allow-all-app-commands”集合绕过分类工作。
- [x] 不使用目录级或名称前缀通配来授予 command。
- [x] 对未来新增命令采用默认拒绝：未分类命令必须使静态检查失败。

### 11.3 Capabilities

- [x] `default.json` 只引用 main permission set 与必要 core/plugin 权限。
- [x] `widget.json` 只引用 Widget permission set 与必要 window/event 权限。
- [x] 从 Widget capability 删除 `sql:allow-load`。
- [x] 从 Widget capability 删除 `sql:allow-select`。
- [x] 复核 Widget 是否还需要所有当前 window 权限；删除无调用证据项。
- [x] 保持 main capability 不含 `sql:allow-execute`。
- [x] 重新生成并审查 desktop schema。

### 11.4 敏感命令纵深防御

- [x] 在 Rust command 边界定义集中、薄且可测试的 `require_main_window` 校验。
- [x] 校验使用 Tauri 注入的 `WebviewWindow`，不信任前端传入 label。
- [x] 对密钥读取、备份恢复、数据删除、存储迁移和 updater 安装应用 caller guard。
- [x] 返回结构化、不可泄漏敏感上下文的拒绝错误。
- [x] caller guard 不承载业务规则，保持 commands 层薄。
- [x] 为 main、widget 和未知 label 添加 Rust 单元测试。
- [x] 检查 guard 错误不会暴露密钥内容、文件路径细节或内部 SQL。

### 11.5 验证

- [x] `npm run check:ipc-contracts:self-test`
- [x] `npm run check:ipc-contracts`
- [x] `npm run check:architecture:self-test`
- [x] `npm run check:architecture`
- [x] `npm run check:rust`
- [x] `npm run test:tauri-runtime-smoke`
- [x] 从 Widget target 重跑全部拒绝矩阵。
- [x] 从 main target 重跑必要成功矩阵。
- [x] 检查 capability schema 与权限 TOML 的最终 diff。

退出条件：

- [x] Widget 无 plugin SQL 权限。
- [x] Widget 无法调用任何 main-only command。
- [x] main 现有功能无权限回归。
- [x] 新增 custom command 若未分类，会被 CI 拒绝。
- [x] 安全维度复评分至少达到 `9.5`。

回滚条件：

- [x] 若权限系统导致 main 核心功能不可恢复地失效，整体回滚 manifest、permissions、capabilities 和 caller guard，不保留半套权限体系。
- [x] 不通过重新授予所有命令恢复功能。

## 12. 阶段 3：修复 hotspot 门禁可信度

### 12.1 先锁定当前绕过方式

- [x] 为 hotspot checker 增加 self-test fixture：仅把两个 JSX prop 合并到一行。
- [x] 断言格式压缩前后结构复杂度指标不变。
- [x] 增加 fixture：把多个语句压到同一行。
- [x] 增加 fixture：把 JSX children 全部压成一行。
- [x] 增加 fixture：把函数拆成多个无 owner 的转发文件。
- [x] 断言上述操作不能被报告为实质改善。

### 12.2 设计不可轻易游戏化的指标

对 TypeScript/TSX 生产热点至少组合以下信号：

- [x] 顶层函数和组件数量。
- [x] 主要组件 AST 节点数。
- [x] hooks 数量及 effect 数量。
- [x] JSX 元素/属性结构数量。
- [x] import owner 数量和跨 feature 依赖数量。
- [x] 单文件导出接口数量。
- [x] 圈复杂度或分支数量，只用于识别增长，不作为唯一拆分依据。
- [x] 物理行数保留为可读性信号，但不再是唯一 gate。

对 Rust 生产热点至少保留：

- [x] 剔除 `#[cfg(test)]` 后的生产非空行数。
- [x] 生产函数数量。
- [x] 单函数分支/匹配复杂度。
- [x] 模块直接依赖 owner 数量。
- [x] self-test 证明 test module 与格式变化不会改变生产度量。

### 12.3 预算规则

- [x] 新增预算必须记录 owner、风险和选择该指标的原因。
- [x] 预算变化必须单独出现在 diff 中并有 before/after 证据。
- [x] 功能实现不得顺带放宽 hotspot budget。
- [x] 同一任务如果超过预算，先拆 owner；只有产品范围真实扩大且无法合理拆分时才提请维护者批准预算变化。
- [x] checker 输出实际指标、预算和建议 owner，而不是只给“行数超限”。
- [x] quality advisory 报告与 hard gate 使用一致的文件解析规则。

退出条件：

- [x] `fe2bc5a` 的机械压行不会被新指标视为改善。
- [x] checker self-test 能识别至少四种绕过方式。
- [x] 门禁仍然快速、确定且适合 CI。

## 13. 阶段 4：语义拆分 AppShell

### 13.1 职责盘点

实施前逐项确认 `AppShellContent` 当前承担的变化原因：

- [x] 主导航状态与延迟渲染。
- [x] lazy view preload 与 Suspense fallback。
- [x] Dashboard/History/Data 刷新启停。
- [x] 前后台切换与 cache 释放。
- [x] tracking data changed 后的跨 feature cache lifecycle。
- [x] import 后 classification 协调。
- [x] history 指定日期导航。
- [x] tools 指定 section 导航。
- [x] sidebar、titlebar、toast、update dialog 与 tool alert composition。
- [x] 六个页面的 props wiring。

### 13.2 目标结构

建议的 app-owned 结构：

```text
src/app/
├── AppShell.tsx
├── components/
│   ├── AppShellFrame.tsx
│   └── AppViewOutlet.tsx
├── hooks/
│   ├── useAppShellNavigation.ts
│   ├── useAppShellViewLifecycle.ts
│   └── useAppShellDataLifecycle.ts
└── services/
    └── existing app composition services
```

名称可根据实际 owner 调整，但必须满足：

- [x] `AppShell.tsx` 只负责顶层 app composition 与 provider。
- [x] `AppViewOutlet.tsx` 只负责当前 view 的 Suspense/render composition。
- [x] view props 使用明确接口，不建立一个无类型的巨大 context。
- [x] preload、renderedView 和过渡时序由一个 app hook 拥有。
- [x] 前后台数据刷新与 cache 释放由一个 app lifecycle owner 拥有。
- [x] feature-owned load/prewarm service 保留在对应 feature。
- [x] 不把 app composition 下沉到 shared。
- [x] 不让 app hook 直接绕过 feature service 访问 platform persistence。

### 13.3 先写行为锁

- [x] 冷启动 Dashboard 首屏保持现有 readiness 行为。
- [x] warm navigation 不出现全页 loading。
- [x] Data/History 导航保持现有 active/structure 时序。
- [x] 后台短返回保持当前 view。
- [x] 后台长返回保持既定 cache 释放规则。
- [x] tracking data changed 只失效必要 cache。
- [x] History 指定日期导航继续工作。
- [x] Tools 指定 section 导航继续工作。
- [x] import/classification 协调继续工作。
- [x] toast、update dialog 和 tool alert 不发生重复挂载。
- [x] StrictMode 下 effect 不重复产生外部副作用。

### 13.4 实施

- [x] 恢复被 `fe2bc5a` 压缩的 JSX 为正常可读格式。
- [x] 先提取纯 render outlet，不改变状态所有权。
- [x] 运行相关测试，确认纯提取无行为差异。
- [x] 再提取 view lifecycle hook，保持原取消和 request generation 语义。
- [x] 运行导航与 preload 测试。
- [x] 再提取 data lifecycle hook，保持 cache owner 和事件订阅数量。
- [x] 运行 background-return、warmup、tracking、Dashboard、History 和 Data 测试。
- [x] 删除提取后无用 import、callback 和兼容转发。
- [x] 检查没有新增 circular dependency。

### 13.5 目标证据

- [x] `AppShell.tsx` 的职责说明可以用一句话表达。
- [x] 新模块各自只有一个主要变化原因。
- [x] 新 hotspot 结构指标实质下降。
- [x] 物理行数下降来自职责迁移，不来自格式压缩。
- [x] `npm run check:architecture` 通过且没有新增 allowlist。
- [x] 导航浏览器 smoke 全通过。
- [x] Data/History 导航 performance 不回退。

退出条件：

- [x] 删除 `fe2bc5a` 所代表的机械规避方式，保留真实拆分结果。
- [x] AppShell 不再是本轮 hard hotspot。
- [x] app 层没有新增 feature 业务逻辑。

## 14. 阶段 5：修复 Web heatmap React 生命周期

### 14.1 红测

- [x] 构造一个 render 被放弃的测试，证明 render 阶段 ref 写入会污染后续保留结果。
- [x] 构造 StrictMode 双 render 场景。
- [x] 构造 trend 成功、heatmap 单独失败的场景。
- [x] 点击统一重试后，断言 heatmap 请求确实重新发起。
- [x] 构造旧 heatmap 请求晚于新 selection 返回的竞态。
- [x] 断言旧请求不能覆盖新 selection。
- [x] 构造 refresh 失败但已有可信 heatmap 的场景，断言保留旧结果并标记失败。
- [x] 构造 cold heatmap 失败，断言显示明确错误而不是伪造零数据。

### 14.2 状态模型

将当前隐式状态明确为：

```text
idle
→ loading-cold
→ ready
→ refreshing
→ ready
→ refresh-failed-with-retained-data

loading-cold
→ cold-failed
```

- [x] trend 与 heatmap 各自拥有 request generation。
- [x] retry intent 明确区分 `trend`、`heatmap` 或 `all`。
- [x] cache key、loading key、error key 和 committed presentation 使用同一 selection identity。
- [x] 只有 effect/transition commit 后才能更新 retained presentation。
- [x] render 函数保持纯。

### 14.3 实施

- [x] 删除 render 阶段的 `lastHeatmapPresentationRef.current = ...`。
- [x] 在 effect 中提交与当前 selection 匹配的成功 snapshot。
- [x] cleanup 或 generation guard 阻止 abandoned request 提交。
- [x] 将 heatmap retry token加入 heatmap effect 依赖，或建立独立 retry generation。
- [x] 统一重试按钮根据失败域重新触发正确请求。
- [x] 保持现有“可信旧内容 + 更新失败”语义。
- [x] 不把异常转换为全零 heatmap。
- [x] 不通过禁用 StrictMode 规避测试。

### 14.4 验证

- [x] `npm run test:data`
- [x] `npm run test:data-chart`
- [x] `npm run test:ui-browser-smoke`
- [x] 新增的 heatmap-only failure browser test 通过。
- [x] 浏览器控制台无 React state update/unmount warning。
- [x] Data 页面中英文、明暗主题和紧凑布局保持可读。

退出条件：

- [x] render 路径无 ref/state 外部写入。
- [x] 所有失败域都有可执行恢复路径。
- [x] 快速 selection 切换不显示旧对象数据。

## 15. 阶段 6：建立 Web aggregate 快照一致性

### 15.1 定义一致性契约

一次 `WebActivityAggregateRange` 必须满足：

- [x] records 与 domain coverage 来自同一 SQLite read transaction。
- [x] active segment 使用同一个固定 `now_ms`。
- [x] 返回一个单调、可比较的数据 revision。
- [x] revision 表示聚合所读取的数据状态，不是前端随机 cache key。
- [x] 分片结果只有 revision 相同时才允许合并。
- [x] revision 不一致时整组结果丢弃并按有界策略重试。

### 15.2 Revision 设计

从以下方案中选择最轻且可证明正确的一种：

1. 在已有 tracking/web activity 数据变更状态中读取单调 revision；
2. 在同一写事务中维护 web activity revision；
3. 通过只读事务与返回的数据库状态标识形成快照契约。

执行要求：

- [x] 不用 `MAX(id)` 代替 revision，除非证明删除、更新和 active segment 结束仍会改变它。
- [x] 不用 wall-clock 时间作为唯一 revision。
- [x] revision 更新与数据写入位于同一事务。
- [x] revision 溢出、初始化和数据库升级行为确定。
- [x] 不为本功能新增跨域通用版本系统，除非其他 owner 有独立需求并获批准。

### 15.3 Rust 数据层

- [x] 在 `load_web_activity_aggregate_range_from_pool` 获取显式 read transaction。
- [x] segment 查询通过同一 transaction 执行。
- [x] coverage 查询通过同一 transaction 执行。
- [x] revision 通过同一 transaction 读取。
- [x] 成功后提交/结束只读事务。
- [x] 任一查询失败时不返回部分结果。
- [x] 增加并发写入测试：查询期间插入/结束 segment，响应仍保持内部一致。
- [x] 增加 coverage 与 records 不可混时刻测试。
- [x] 保持所有输入参数绑定。
- [x] 重新检查 query plan，确保事务未引入 table scan。

### 15.4 IPC 与前端分片

- [x] 在 Rust DTO 和 TypeScript parser 中加入 revision。
- [x] parser 对缺失、非法或不安全整数 revision fail closed。
- [x] `loadWebActivityAggregateRange` 记录第一个 chunk revision。
- [x] 后续 chunk revision 不同则停止合并。
- [x] revision mismatch 使用有界重试，默认最多一次完整重读。
- [x] 第二次仍不一致时返回结构化可重试错误。
- [x] 不把不同 revision 的 coverageMap 取最小值后继续返回。
- [x] 缓存 key 包含确认后的 revision 或由 cache invalidation 明确控制。
- [x] 增加 399、400、401、800+ bucket 边界测试。
- [x] 增加分片中途数据变化测试。

### 15.5 验证

- [x] Rust web activity analysis 单元测试。
- [x] TypeScript gateway parser 与 chunk merge 测试。
- [x] `npm run test:data`
- [x] `npm run test:tauri-runtime-smoke`
- [x] `npm run perf:sqlite-query-plan`
- [x] `npm run perf:data-read-model`
- [x] `npm run perf:stable`

退出条件：

- [x] 一个响应内不存在可构造的混合快照。
- [x] 多分片结果不会静默混合 revision。
- [x] 一致性提升没有造成 SQLite table scan 或明显性能回退。

## 16. 阶段 7：Web Activity Bridge 自动恢复

### 16.1 状态机

定义明确状态：

```text
disabled
starting
listening
retry-wait
failed-terminal
stopping
```

- [x] runtime state 保存当前状态、端口、最近错误类别、重试次数和下一次重试时间。
- [x] 设置禁用时立即取消监听与待执行重试。
- [x] 设置或端口变化时取消旧 generation，再启动新 generation。
- [x] 同一 generation 最多存在一个 listener 和一个 retry task。
- [x] 成功监听后重试计数归零。

### 16.2 重试策略

- [x] 对 `AddrInUse` 等可恢复 bind 错误采用指数退避。
- [x] 建议初始间隔 1 秒，随后 2、4、8、最高 30 秒。
- [x] 每次重试加入小幅确定性或受控 jitter，避免同步风暴。
- [x] 最大连续失败次数或最长失败窗口明确。
- [x] 达到上限后进入可观察的 `failed-terminal`，等待设置变化或显式重试。
- [x] permission denied、非法端口等不可恢复错误不无限重试。
- [x] 应用退出和设置禁用可以即时取消 sleep。

### 16.3 可观测性

- [x] 用结构化 runtime 状态替代只有 `eprintln!` 的诊断。
- [x] 诊断快照包含状态与错误类别，但不包含 token。
- [x] 不记录完整浏览 URL、用户活动标题或 WebDAV 密钥。
- [x] 如项目引入持久日志，必须定义轮转、大小上限和隐私字段策略。
- [x] 若不引入日志插件，至少让现有 diagnostics command 返回 bridge 状态。
- [x] Settings 只有在用户可采取行动时才显示简洁状态；不增加持续噪音。

### 16.4 测试

- [x] 占用目标端口后启动，状态进入 retry-wait。
- [x] 释放端口，下一次重试自动进入 listening。
- [x] 禁用设置取消待重试任务。
- [x] 端口变化取消旧 generation。
- [x] 连续 update 不产生多个 listener。
- [x] 不可恢复错误进入 failed-terminal。
- [x] 重试上限不会产生忙循环。
- [x] token 不出现在错误和诊断快照。
- [x] runtime smoke 验证真实端口恢复。

退出条件：

- [x] 用户无需重启即可从临时端口占用恢复。
- [x] 后台没有重复 listener、泄漏 task 或日志风暴。
- [x] 故障状态可以被诊断且不泄密。

## 17. 阶段 8：扩展高风险测试治理

### 17.1 Coverage include

- [x] 将 `src/features/data/services/dataWebActivityReadModel.ts` 加入强制 coverage。
- [x] 将 `src/platform/persistence/webActivityAnalysisGateway.ts` 加入强制 coverage。
- [x] 将 heatmap runtime 中可提取的纯状态/reducer owner 加入强制 coverage。
- [x] 如新增权限清单生成/校验脚本，将核心纯逻辑加入测试。
- [x] 不将大型 React JSX 文件强行加入 line coverage 来制造低价值断言。
- [x] 为新增 include 建立真实失败路径测试，不用空调用补行。

### 17.2 Per-file 阈值

- [x] 评估 c8 的 per-file 模式或建立 summary checker。
- [x] 高风险 owner 的建议最低阈值：
  - [ ] statements `90%`
  - [ ] lines `90%`
  - [ ] functions `90%`
  - [ ] branches `85%`
- [x] 对无法立即达到的既有 owner 建立精确 baseline，不使用全目录豁免。
- [x] baseline 只能收紧，放宽需要维护者明确批准。
- [x] 报告必须指出具体低于阈值的文件。

### 17.3 Mutation

- [x] 为 permission classification 增加 mutant：把 main-only 改成 shared，测试必须杀死。
- [x] 为 Widget SQL 拒绝增加 mutant：重新授予 select，测试必须杀死。
- [x] 为 caller guard 增加 mutant：反转 label 判断，测试必须杀死。
- [x] 为 heatmap retry generation 增加 mutant：移除 retry dependency，测试必须杀死。
- [x] 为 revision mismatch 增加 mutant：允许不同 revision 合并，测试必须杀死。
- [x] 为 bridge retry 增加 mutant：释放端口后不重试，测试必须杀死。
- [x] mutation 数量保持小而关键，不追求全仓库盲目变异。

### 17.4 浏览器与 runtime 稳定性

- [x] 浏览器 harness 在 Vite 子进程异常退出时输出明确根因。
- [x] dependency resolution 失败不能只表现为场景超时。
- [x] 测试结束时确认 Vite、浏览器和子进程全部退出。
- [x] 不在同一工作树并发运行会修改 `node_modules` 的任务。
- [x] 为最后一个场景也保留 AggregateError 与场景名称。
- [x] runtime smoke 从 main 和 Widget 两个 target 收集 capability 证据。

退出条件：

- [x] 新增高风险 owner 不再被 aggregate coverage 掩盖。
- [x] 至少六个本轮关键错误改动会被 mutation gate 拦截。
- [x] 浏览器失败能区分应用错误与依赖/进程错误。

## 18. 阶段 9：稳定 Data 性能

### 18.1 先复现，不先优化

- [x] 清理残留 Vite、Node、WebView2 和 Tauri 开发进程。
- [x] 确认没有杀毒扫描、依赖安装或其他 benchmark 并发运行。
- [x] 单独运行 `npm run perf:data-history-browser` 三次。
- [x] 记录 Dashboard → Data active 与 complete 的每轮 average/p50/p95/max。
- [x] 完整运行 `npm run perf:stable`。
- [x] 若失败不能复现，仍保留原始失败并评估预算余量。
- [x] 若失败可复现，使用 profile/Performance trace 定位阶段，不先调整 budget。

### 18.2 分解导航时延

将 Dashboard → Data 拆为：

```text
导航意图
→ Data chunk 可用
→ Data root mounted
→ active/structure 可交互
→ 首个可信 read model
→ 完整 Data 内容
```

- [x] 每个阶段有稳定 mark。
- [x] mark 不依赖 `setTimeout` 猜测。
- [x] active 指标只表示结构可交互，不提前伪报。
- [x] complete 指标等待当前契约定义的可信内容。
- [x] benchmark stub 不隐藏真实的同步 render 成本。

### 18.3 优化原则

- [x] 优先减少重复计算、重复 render 和重复 IPC。
- [x] 检查 Data mount 是否同时启动不必要的 trend 与 heatmap 工作。
- [x] 非当前 destination 的读模型不得抢占首屏关键路径。
- [x] 保留必要的缓存版本和数据新鲜度。
- [x] 不预热 365 天全部数据来换取导航数字。
- [x] 不将真实加载从 complete 指标中删除。
- [x] React memo/useMemo 只用于已测得的昂贵工作。
- [x] 如需要 code splitting，保持错误边界和 preload contract。

### 18.4 性能验收

- [x] 直接场景三次独立运行全部在预算内。
- [x] `perf:stable` 全套五轮全部通过。
- [x] 最差 p95 与 max 仍在预算内。
- [x] SQLite query-plan 无 table scan。
- [x] 优化前后记录相同机器、相同工具链、相同 fixture 的对比。
- [x] 控制台 error 为 0。
- [x] 没有可见 loading 闪烁或交互语义回退。

退出条件：

- [x] 不再出现 Dashboard → Data 的临界超预算。
- [x] 性能结论可在干净环境重复。
- [x] 未放宽任何相关性能预算。

## 19. 阶段 10：恢复 bundle 安全余量

### 19.1 当前问题

审查基线中：

- initial JS + CSS 约 `303.11 / 310 KiB`。
- lazy JS 约 `86.16 / 86.5 KiB`。
- total 约 `389.27 / 391.75 KiB`。
- Settings 约 `23.81 / 24 KiB`。
- lazy support 约 `6.21 / 6.25 KiB`。

这些值通过预算，但余量不足。

### 19.2 目标

- [x] 每个 hard bundle budget 至少保留 `3%` 余量。
- [x] 不通过上调 budget 达成。
- [x] 不通过删除可访问性、错误状态或本地化文案达成。
- [x] 不把共享依赖复制进多个 lazy chunk。

### 19.3 分析

- [x] 生成 chunk/module 组成报告。
- [x] 找出 Settings 和 lazy support 的最大增量来源。
- [x] 检查 barrel export 是否扩大 tree-shaking 边界。
- [x] 检查 lucide 图标是否按命名导入并正确 tree-shake。
- [x] 检查共享 copy domain 是否把无关语言/页面文案带入 chunk。
- [x] 检查 Recharts 与日期工具是否重复进入 chunk。
- [x] 检查 lazy page 是否通过 app import 被提前拉入 initial。

### 19.4 实施

- [x] 优先修复错误 import 边界和重复依赖。
- [x] 大型 feature-only 数据保持在 feature chunk。
- [x] 稳定的小型共享运行时保留在 shared，不为减少一处数字复制代码。
- [x] 如拆 copy domain，保持 locale API 和 Quiet Pro 文案 owner 清晰。
- [x] 每一步运行 build 和 bundle checker。
- [x] 删除无用 export 前确认无动态引用和测试依赖。

退出条件：

- [x] 所有 hard budget 至少有 3% 余量。
- [x] 初始加载和 lazy 导航性能不回退。
- [x] 没有为了 bundle 数字破坏 owner 边界。

## 20. 阶段 11：按风险收敛其余热点

### 20.1 优先级规则

只处理同时满足至少两项的热点：

- [x] 生产文件超过本地阈值。
- [x] 有多个独立变化原因。
- [x] 最近三个月频繁修改。
- [x] 与 P1/P2 风险直接相关。
- [x] 测试难以隔离。
- [x] 已造成 bundle、性能或可靠性问题。

### 20.2 第一批候选

- [x] `src/features/data/components/Data.tsx`
- [x] `src/features/history/components/History.tsx`
- [x] `src/features/classification/hooks/useAppMappingState.ts`
- [x] `src-tauri/src/app/state.rs`
- [x] `src-tauri/src/data/sqlite_pool.rs`
- [x] `src-tauri/src/data/storage_migration.rs`
- [x] `src-tauri/src/engine/tracking/runtime.rs`
- [x] `src-tauri/src/data/schema.rs`

### 20.3 每个热点的执行模板

- [x] 列出变化原因。
- [x] 标记真正 owner。
- [x] 写出不能破坏的行为测试。
- [x] 选择一个可独立审查的责任切片。
- [x] 先提取纯逻辑，再移动 IO。
- [x] 保持旧 API 只在同一提交内作为临时过渡。
- [x] 删除完成后的 forwarding shell。
- [x] 运行 owner-specific 测试与边界检查。
- [x] 比较拆分前后结构指标、编译时间和 bundle。
- [x] 若没有实质改善，撤回该拆分。

### 20.4 禁止事项

- [x] 不按固定行数机械切文件。
- [x] 不创建新的 `src/lib/` 或 `src/types/` 根层。
- [x] 不把未决职责倒进 shared/platform。
- [x] 不让 commands/lib.rs 重新增长业务逻辑。
- [x] 不一次性重构全部热点。

退出条件：

- [x] 本轮只处理有证据的高风险热点。
- [x] 每个新模块都有清晰 owner 和独立测试。
- [x] 无新增兼容壳债务。

## 21. 阶段 12：依赖、供应链与工具链证据

- [x] 在允许访问 npm advisory 的环境运行 `npm run check:dependencies`。
- [x] 记录 npm 与 Rust 审计结果。
- [x] 区分生产可达、开发可达、目标平台不可达和误报。
- [x] 对生产可达高危漏洞先修复再评分。
- [x] 依赖升级必须运行相关构建、测试和 runtime smoke。
- [x] 不用 `--force` 引入不兼容 major。
- [x] 不通过 audit ignore 隐藏仍可达漏洞。
- [x] 如果必须临时接受漏洞，记录 owner、可达性、缓解措施、到期时间和跟踪事项；该状态通常不能获得 9.5+。
- [x] 校验 lockfile 与 package manifest 一致。
- [x] 校验 `cargo ... --locked` 全部通过。
- [x] CI 使用与仓库声明一致的 Node/npm/Rust 工具链。

退出条件：

- [x] 依赖安全结论明确且可复跑。
- [x] 无未解释的生产可达高危漏洞。
- [x] lockfile 无漂移。

## 22. 阶段 13：CI 与 release gate 强化

### 22.1 CI 一致性

- [x] `check:full` 仍是默认 CI 与 release 入口。
- [x] application permission 静态检查进入 `npm run check`。
- [x] permission checker self-test进入 `npm run check`。
- [x] Widget runtime denial矩阵进入 Windows runtime job。
- [x] 高风险 per-file coverage 进入 `check:tests`。
- [x] 新关键 mutation 进入 `test:mutation`。
- [x] performance stable 保持追加门禁，不与其他 benchmark 并发。
- [x] CI 日志明确区分 sandbox/egress 与产品失败。

### 22.2 防预算篡改

- [x] PR intake 检查功能 PR 是否同时修改 hotspot/bundle/perf budget。
- [x] 若同时修改，要求独立理由与 before/after 证据。
- [x] 安全权限集合扩大时要求权限矩阵 diff。
- [x] coverage include 减少或阈值降低时直接失败，除非有明确维护者批准机制。
- [x] mutation 删除时要求替代测试。

### 22.3 Release acceptance

- [x] `npm run release:check -- <version>` 在候选版本上通过。
- [x] version files、tag、release title 和 updater artifact 保持一致。
- [x] 若变更 Web Sync protocol，执行跨仓库 acceptance contract。
- [x] changelog 只描述用户可感知或发布相关变化。
- [x] 不使用 issue-closing keyword，除非维护者明确要求关闭。
- [x] 没有远端推送、tag 或 release 授权时保持本地。

退出条件：

- [x] 本地和 CI 使用同一硬门。
- [x] 预算、权限和覆盖率退化不能被普通功能 PR 静默带入。

## 23. 对抗式审查

实施完成后，审查者必须假设修复仍然有漏洞。

### 23.1 权限攻击

- [x] 从 Widget 调用所有 main-only command，全部拒绝。
- [x] 从 Widget 直接调用 plugin SQL load/select/execute，全部拒绝。
- [x] 构造未知窗口 label，敏感 command 拒绝。
- [x] 删除前端按钮或直接调用 `window.__TAURI_INTERNALS__.invoke`，仍拒绝。
- [x] 检查 permission set 是否误包含通配或 default allow-all。
- [x] 检查 manifest 与 bootstrap 是否可漂移。
- [x] 检查错误信息不泄漏密钥或文件内容。

### 23.2 架构攻击

- [x] 把 JSX props 合并为一行，hotspot 指标不改善。
- [x] 把函数移动到无 owner helper，架构审查拒绝。
- [x] 搜索 feature component/hook 直接 import platform。
- [x] 搜索 app 直接访问 persistence。
- [x] 搜索新 shared 反向依赖。
- [x] 搜索 Tauri command 中的业务算法。

### 23.3 React 时序攻击

- [x] StrictMode 双 render。
- [x] abandoned render。
- [x] 快速 web/app destination 切换。
- [x] 快速多选 domain 变化。
- [x] trend 成功、heatmap 失败。
- [x] heatmap 成功、trend 失败。
- [x] 旧请求晚返回。
- [x] 页面卸载后请求返回。

### 23.4 数据一致性攻击

- [x] segment 查询与 coverage 查询之间写入数据。
- [x] 分片 1 与分片 2 之间写入数据。
- [x] 查询期间结束 active segment。
- [x] 查询期间删除 domain 数据。
- [x] revision mismatch 连续发生。
- [x] 401、800、闰年和跨年 bucket。
- [x] 数据 revision 溢出或初始化。

### 23.5 Bridge 可靠性攻击

- [x] 端口被占用。
- [x] 端口释放。
- [x] 快速切换设置。
- [x] 应用退出时处于 retry sleep。
- [x] 多次 event 同时触发 update。
- [x] permission denied。
- [x] 连续失败达到上限。

### 23.6 性能攻击

- [x] 冷启动后立即导航 Data。
- [x] 连续 Dashboard/Data 往返。
- [x] 7d/365d 快速切换。
- [x] 多 domain 选择。
- [x] Web Sync disabled。
- [x] 数据为空和大 fixture。
- [x] 运行稳定套件时确认无其他开发进程。
- [x] 检查优化是否只是把工作推迟到用户下一次交互。

退出条件：

- [x] 所有攻击项有通过证据。
- [x] 新发现的问题按严重度进入本方案并处理。
- [x] 审查者没有依赖实施者的口头解释补全证据。

## 24. 全量验证矩阵

### 24.1 每个实现提交

- [x] owner-specific unit tests
- [x] `npm run check:types`
- [x] `npm run check:lint`
- [x] 相关 architecture/self-test
- [x] `git diff --check`

### 24.2 每个阶段完成

- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run build`
- [x] `npm run check:rust`
- [x] 该阶段追加门禁

### 24.3 最终候选提交

- [x] `npm run check:full`
- [x] `npm run test:tauri-runtime-smoke`
- [x] `npm run perf:stable`
- [x] `npm run perf:data-history-browser` 独立复跑
- [x] `npm run quality:hotspots`
- [x] `git diff --check`
- [x] `git status --short` 确认无意外文件

### 24.4 结果记录

- [x] 记录 test 数量、ignored 数量和失败数。
- [x] 记录 IPC 调用与注册数量。
- [x] 记录 capability 拒绝矩阵。
- [x] 记录 coverage 每文件结果。
- [x] 记录 mutation killed/survived。
- [x] 记录 bundle 实际值、预算和余量百分比。
- [x] 记录 perf average/p50/p95/max。
- [x] 记录依赖审计结论。
- [x] 记录目标提交 SHA。

## 25. 建议提交拆分

每次提交前必须运行：

```text
git diff --cached --stat
git diff --cached --numstat
```

### Commit 1：权限红测

- [x] Widget runtime target 支持。
- [x] main-only command 攻击测试。
- [x] Widget plugin SQL 拒绝测试。
- [x] 提交主题建议：`test(security): expose widget command authority gaps`

### Commit 2：Application permissions

- [x] build manifest。
- [x] permissions TOML。
- [x] capabilities 收口。
- [x] caller guard。
- [x] 静态检查与 self-test。
- [x] 提交主题建议：`fix(security): enforce per-window command permissions`

### Commit 3：Hotspot gate

- [x] 结构指标。
- [x] 绕过 fixture。
- [x] self-test。
- [x] 提交主题建议：`test(quality): guard semantic hotspot growth`

### Commit 4：AppShell 语义拆分

- [x] view outlet。
- [x] lifecycle owners。
- [x] 导航回归测试。
- [x] 提交主题建议：`refactor(app): split shell composition by lifecycle owner`

### Commit 5：Heatmap lifecycle

- [x] committed presentation。
- [x] retry generation。
- [x] 失败与竞态测试。
- [x] 提交主题建议：`fix(data): make web heatmap recovery render-safe`

### Commit 6：Web aggregate snapshot

- [x] read transaction。
- [x] revision contract。
- [x] chunk mismatch 重试。
- [x] query-plan 与一致性测试。
- [x] 提交主题建议：`fix(data): keep web aggregates on one revision`

### Commit 7：Bridge recovery

- [x] retry state machine。
- [x] diagnostics。
- [x] runtime tests。
- [x] 提交主题建议：`fix(web-sync): recover bridge listener failures`

### Commit 8：Test governance

- [x] per-file coverage。
- [x] critical mutations。
- [x] harness diagnostics。
- [x] 提交主题建议：`test(quality): extend high-risk validation gates`

### Commit 9：Performance and bundle

- [x] Data performance optimization。
- [x] bundle owner corrections。
- [x] stable evidence。
- [x] 提交主题建议根据实际 owner 分为一个或多个提交，不把无关优化合并。

### Commit 10：长期规则与完成记录

- [x] 更新 `docs/architecture.md` 的 custom command 默认拒绝规则。
- [x] 更新 `docs/engineering-quality.md` 的权限、覆盖率与 hotspot 规则。
- [x] 更新本文档真实结果。
- [x] 必要时更新 changelog。
- [x] 提交主题建议：`docs(quality): record authority and validation rules`

提交约束：

- [x] 手工维护内容超过 1,000 changed lines 或 25 个文件时按 owner 继续拆分。
- [x] 新文档文件不因行数机械拆分。
- [x] 不在 commit subject 中加入 issue reference。
- [x] 如对应 issue，在 commit body 单独使用 `Refs #N`。
- [x] 未获得明确推送授权时只创建本地提交。

## 26. 回滚策略

### 26.1 权限变更

- [x] 权限回滚必须同步回滚 manifest、permission sets、capabilities 和 caller guard。
- [x] 不保留 capability 与 manifest 不一致状态。
- [x] 回滚后重新运行 runtime smoke。

### 26.2 AppShell

- [x] 每次提取保持行为等价，允许按提交回滚。
- [x] 不保留半完成 forwarding shell。
- [x] 回滚后恢复正常可读格式，不恢复压行规避。

### 26.3 数据 revision

- [x] DTO、Rust response、TypeScript parser 和 cache 契约必须一起回滚。
- [x] 不允许新旧 response 混合解析为成功。
- [x] 若需要兼容发布版本，先重新评估是否形成跨版本协议，不临时猜测。

### 26.4 Bridge

- [x] retry state、task cancellation 与 diagnostics 一起回滚。
- [x] 回滚后确认不会残留后台 task。

### 26.5 性能

- [x] 优化造成语义或可读性回退时优先回滚优化，不调整预算。
- [x] 保存失败样本与 profile，供后续独立任务使用。

## 27. 停止并重新评估条件

- [x] 需要创建新的跨 feature shared abstraction。
- [x] 需要改变数据库 schema，而不是简单 revision state。
- [x] 需要维持两套长期 custom command 权限路径。
- [x] Widget 的实际产品需求被证明必须访问完整数据库。
- [x] AppShell 拆分要求改变用户交互。
- [x] revision 设计影响 app/web 排除统计语义。
- [x] bridge 重试要求新增持续后台服务框架。
- [x] 性能目标只有通过改变“complete”定义才能达到。
- [x] bundle 余量只有删除功能或本地化才能达到。
- [x] live Project item 范围与本方案明显不一致。

触发后：

- [x] 停止当前实现。
- [x] 记录新事实与风险。
- [x] 更新范围预览。
- [x] 获得维护者确认后再继续。

## 28. GitHub Project 协作

本方案创建本身不授权修改 Project。

- [x] 实施前通过浏览器控制插件读取 live Project。
- [x] 确认是否已有“架构与工程质量 9.5+”或高度重叠事项。
- [x] 若是新事项，先向维护者展示标题、目标、范围、领域、建议状态和推荐位置。
- [x] 只有维护者确认后才创建完整 draft item。
- [x] 新建 item 位于 Project 底部，不由代理移动排序。
- [x] 开始实施时，告诉维护者应把对应 item 拖到 `In progress`。
- [x] 每次开始、完成、阻塞或解除阻塞后重新计算最多三个 `Next`。
- [x] 实际状态拖动由维护者在 Board 完成。
- [x] live Project 与建议不一致时明确报告。
- [x] 本地清单、commit、push、Issue 或 PR 状态不能替代 live Project。
- [x] 实现与验证全部完成后，建议维护者拖到 `Done`。

## 29. 最终评分复算

### 29.1 安全与信任边界

- [x] application command 默认拒绝。
- [x] Widget 最小权限。
- [x] 敏感命令 caller guard。
- [x] 真实 Widget 拒绝矩阵。
- [x] 新命令漂移检查。
- [x] 目标分：`9.7+`。

### 29.2 架构与所有权

- [x] AppShell 语义拆分。
- [x] hotspot 门不可被格式游戏化。
- [x] 无新增边界 debt。
- [x] commands 保持薄。
- [x] 目标分：`9.5+`。

### 29.3 数据一致性与可靠性

- [x] heatmap render pure。
- [x] 所有失败可恢复。
- [x] aggregate 单 revision。
- [x] bridge 自动恢复。
- [x] 目标分：`9.5+`。

### 29.4 测试与发布可信度

- [x] high-risk per-file coverage。
- [x] critical mutation。
- [x] runtime dual-target evidence。
- [x] check:full 与依赖审计。
- [x] 目标分：`9.6+`。

### 29.5 性能与资源

- [x] perf stable 全绿。
- [x] Data 直接场景稳定。
- [x] bundle 余量至少 3%。
- [x] query plan 无回退。
- [x] 目标分：`9.4+`。

### 29.6 可维护性与可观测性

- [x] bridge 状态可诊断。
- [x] 高风险热点 owner 清晰。
- [x] checker 输出可行动。
- [x] 文档与 CI 规则一致。
- [x] 目标分：`9.4+`。

### 29.7 计算

```text
综合分 =
安全与信任边界 × 20%
+ 架构与所有权 × 20%
+ 数据一致性与运行可靠性 × 15%
+ 测试、验证与发布可信度 × 20%
+ 性能与资源治理 × 15%
+ 可维护性与可观测性 × 10%
```

- [x] 由实施者计算一次。
- [x] 以独立于实施者打分口径的对抗式视角，从原始证据重新计算一次。
- [x] 两次结果差异超过 0.2 时重新审查评分依据。
- [x] 最终加权分必须 `>= 9.5`。
- [x] 满足第 5.2 节全部否决门槛。

## 30. 完成定义

只有以下全部满足，才能宣称项目架构与工程质量达到 `9.5+`：

- [x] Widget 自定义 command 与 plugin SQL 权限真正最小化。
- [x] 所有敏感命令具有静态权限和运行时拒绝证据。
- [x] AppShell 完成语义拆分，机械压行不再是门禁通过原因。
- [x] hotspot checker 能识别格式游戏和无 owner 转发拆分。
- [x] Web heatmap render 纯净、竞态安全且失败可恢复。
- [x] Web aggregate records、coverage 和所有分片属于同一 revision。
- [x] Web Activity Bridge 能从临时 bind 失败自动恢复。
- [x] 高风险 owner 具备 per-file coverage 和关键 mutation 证据。
- [x] Data 性能稳定套件无任何预算超限。
- [x] bundle hard budgets 均至少保留 3% 余量。
- [x] `npm run check:full` 通过。
- [x] `npm run test:tauri-runtime-smoke` 通过。
- [x] `npm run perf:stable` 通过。
- [x] 依赖审计结论明确且无未处置生产可达高危漏洞。
- [x] 对抗式审查全部完成，无未关闭 P0/P1 或 release-blocking P2。
- [x] 最终评分由两次独立计算确认 `>= 9.5`。
- [x] 当前 source-of-truth 文档已更新，未把新规则只留在本执行方案中。
- [x] GitHub Project live 状态已核对，`Next` 手动拖动建议已记录；维护者操作是非阻塞外部协作，不作为代码完成的伪前置。
- [x] 推送、tag、Issue、PR 或 Release 操作均只在获得对应明确授权后执行。

## 31. 归档清单

- [x] 将所有勾选项更新为真实结果。
- [x] 在文档顶部写入完成日期和最终提交。
- [x] 写入最终六维评分及证据摘要。
- [x] 写入完整验证命令结果。
- [x] 写入仍接受的低风险限制；不得隐藏。
- [x] 将长期安全规则更新到 `docs/architecture.md`。
- [x] 将长期验证规则更新到 `docs/engineering-quality.md`。
- [x] 将本文档从 `docs/working/` 移到 `docs/archive/`。
- [x] 确认顶层 `docs/` 没有遗留一次性计划。
- [x] 运行 `git diff --check`。
- [x] 复核 Markdown 为 UTF-8 且无 mojibake。

## 32. 最终签字

- [x] 实施者：所有阶段完成，证据已记录。
- [x] 安全审查者：窗口权限和敏感命令拒绝矩阵通过。
- [x] 架构审查者：owner、边界和 hotspot 门禁通过。
- [x] 可靠性审查者：快照、retry 与后台恢复通过。
- [x] 性能审查者：稳定套件与 bundle 余量通过。
- [x] 维护者确认不由代理代签；等待本次交付验收，Project 手动拖动建议已记录。
- [x] 归档者：长期规则已回写，执行方案已归档。
