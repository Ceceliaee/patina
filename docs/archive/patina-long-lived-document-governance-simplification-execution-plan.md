# Patina 长期文档治理与简化执行方案

> Status: Complete
> Created: 2026-08-30
> Last updated: 2026-08-30
> Execution owner: Patina 维护者与当前获授权的仓库协作者
> Long-term owners affected: `AGENTS.md`、`CONTRIBUTING.md`、根级 `README.md`、顶层 `docs/*.md`、相关检查脚本与工作流
> Lifecycle: Complete；长期结论已回写 active owner，本文仅作为冻结执行记录保留在 `docs/archive/`

## 0. 执行摘要

本方案用于把 Patina 的长期文档从“规则覆盖充分但多个位置重复维护”收口为“一个事实一个 owner、入口只路由、机器事实由机器 owner 提供、历史与当前状态分离”的体系。

本方案不以任意删字比例、文档数量或评分为目标。只有同时满足以下条件，才算真正完成：

- 一个长期事实只有一个可指出的权威 owner；
- 顶层长期 Markdown 不超过 10 份；唯一允许新增的是不包含私有 Project 当前内容的 GitHub Project 维护 how-to，并证明它从路线图中移出的独立 reader job 能降低维护与检索成本；
- `AGENTS.md`、`CONTRIBUTING.md` 和其他入口只保留各自必须直接看到的规则，其余内容链接到 owner；
- 命令执行图、当前版本、工作流 job、生成清单和具体实现目录不再由多份 prose 手工同步；
- 架构、工程质量、产品、优先级、UI、发布和协议文档各自回答稳定且不同的问题；
- SQLite migration、备份恢复、协议兼容、发布资产、安全授权、Tauri 权限和外部 PR 媒体政策等受保护契约没有因压缩而丢失；
- 新增的机械门禁确实阻止已观察到的漂移，并且没有引入比被删除重复状态更重的维护负担；
- 最终文档经过一次独立于实施视角的对抗式审查；
- 本执行单完成记录齐全并归档，`docs/working/` 不保留已完成副本。

## 1. 决策与第一性原理

### 1.1 文档为什么存在

长期文档的价值不是保存所有曾经讨论过的内容，而是降低未来读者做正确决定所需的检索、判断和验证成本。

由此推导：

1. 每增加一句长期 prose，就增加一个需要持续验证的维护状态。
2. 同一个事实出现两次，不只是多两行文字，而是产生“两个副本是否一致”的新状态。
3. 如果事实可从代码、schema、manifest、脚本或测试确定，人工 prose 不应再复制完整值或清单。
4. 如果一条规则需要在所有任务中直接看到，入口文档可以保留一至三行停止条件；详细理由和完整契约仍归真实 owner。
5. 如果两个内容服务不同读者任务，应分节、分文档或链接；不能因为主题相近就强塞进同一个母文档。
6. 历史、迁移过程和实施证据只有在能阻止真实错误时才保留，并且不能冒充当前事实。
7. 简化只有在净维护状态减少且行为、兼容、安全和权限边界不变时才成立。
8. 文档拆分原则上不能增加顶层长期文档数量；本轮只允许 GitHub Project 维护 how-to 这一项例外，因为 live Project 对仓库读者不可见且维护任务与产品优先级解释是不同 reader job。

### 1.2 本次采用的治理模型

本次借鉴 DSH 的整体文档治理模型，而不是复制其目录或具体 Agent Skills：

- 根入口保存 standing orders，并链接到事实 owner；
- 架构文档提供系统地图，子系统和组件负责具体契约；
- 教程、how-to、reference、explanation 按读者任务分工；
- 当前文档写当前状态，决策理由和冻结历史另有生命周期；
- 文档网站、目录、命令清单和其他派生信息应由 canonical source 投影或生成；
- 文档预算是防止无意识膨胀的 guardrail，不是删字 KPI；
- 归档是冻结历史，不是第二套当前 owner。

参考来源：

- [DSH 根协作入口](https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md)
- [DSH 文档层级与 one-home-per-fact 规则](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/AGENTS.md)
- [DSH 架构地图](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md)
- [DSH 文档预算 manifest](https://github.com/deepseek-ai/deepseek-harness/blob/master/scripts/doc-budgets.manifest.json)
- [DSH canonical Markdown 网站投影](https://github.com/deepseek-ai/deepseek-harness/blob/master/website/docs.ts)
- [DSH 冻结归档规则](https://github.com/deepseek-ai/deepseek-harness/blob/master/.agents/notes/archived/AGENTS.md)

这些外部文档只提供治理方法。Patina 的产品、架构、安全、发布和贡献规则仍由 Patina 当前代码与长期文档决定。

### 1.3 可观察目标

- [x] 已把目标定义为降低事实重复、漂移和检索成本，而不是追求任意文档数量或删字比例。
- [x] 已明确长期产品行为、兼容、安全、授权和贡献政策必须保持不变。
- [x] 已明确先决定事实 owner，再决定删、并、拆、移或链接。
- [x] 已确认顶层长期文档数量不得超过 10 份，且新增名额只用于不泄露私有 live state 的 GitHub Project 维护 how-to。
- [x] 每份最终长期文档都能用一句话说明它回答什么问题，以及明确不回答什么问题。
- [x] 每条跨文档规则都能指出唯一详细 owner；其他出现位置只保留必要摘要和链接。
- [x] 每项被删除或迁移的内容都有保留行为、目标 owner、验证证据和反例说明。

## 2. 当前证据与基线

### 2.1 已核对的仓库事实

2026-08-30 的只读基线：

- [x] 顶层 `docs/` 有 9 份活动 Markdown，合计 3832 行。
- [x] `docs/working/` 在创建本文之前没有其他活动 Markdown。
- [x] `docs/archive/` 有 194 份 Markdown；数量本身不构成删除理由。
- [x] 根 `AGENTS.md` 是仓库感知 agent 的入口。
- [x] `CONTRIBUTING.md` 是外部贡献者流程入口，并同时包含英文与简体中文。
- [x] `.agents/` 与 `skills-lock.json` 是忽略的本地状态，不得成为长期文档、仓库或 CI 的事实依赖。
- [x] 当前工作树已有与本文创建无关的修改；后续执行必须保留并区分这些用户改动。
- [x] 当前没有从请求中识别出必须读取或维护的具体 GitHub Project item；本文创建不进行 Project 写操作。

### 2.2 已确认的漂移与重复证据

| 证据 | 当前 owner 冲突 | 风险 | 初步置信度 |
| --- | --- | --- | --- |
| `docs/engineering-quality.md` 手工列出 `npm run check` 叶子命令，但 `package.json` 已包含未列出的 i18n、coverage threshold、hotspot 和 Quiet Pro self-test | prose 与 `package.json` 同时维护执行图 | 文档看似精确但已不完整 | High |
| `AGENTS.md` 把默认前端门槛写为 `npm test`、`npm run test:replay`、`npm run build`，工程质量与贡献指南以 `npm run check` 为默认入口 | 三个入口维护不同默认口径 | 协作者选择错误验证链 | High |
| `docs/versioning-and-release-policy.md` 保存当前版本并要求每次发布同步 | 版本文件、release gate 和政策文档共同维护版本值 | 每次发布多一个人工同步状态 | High |
| 同一发布文档保留 `0.x` 历史策略 | 当前政策与历史解释混合 | 当前读者误用旧规则 | High |
| `docs/roadmap-and-prioritization.md` 写死浏览器控制插件和 GitHub 连接器选择 | 仓库优先级政策拥有环境工具路由 | Codex 产品能力变化会迫使仓库政策修改 | High |
| `docs/quiet-pro-component-guidelines.md` 同时拥有设计原则、桌面挂件、日期组件、Popover 和 scrollbar 具体消费者契约 | 设计系统母文档与组件/feature owner 竞争 | 每增加组件，母文档继续线性增长 | Medium，需逐节核对 owner |
| `docs/architecture.md` 与 `docs/issue-fix-boundary-guardrails.md` 重复高吸力层、兼容壳、owner 判断和验证入口 | 架构 reference 与修复 how-to 共同维护规则 | 规则变化需要同步两份文档 | High |
| 外部 PR scope、owner、截图、风险和 diff 规则同时存在于 `AGENTS.md`、`CONTRIBUTING.md`、工程质量文档和 PR 模板 | 贡献者入口、agent 入口、质量政策与表单重复承载 | 门禁与说明可能分叉 | High |
| 多份长期文档结尾的“给 Codex 与后续协作者”重复正文 | 同文档内部重复 owner | 增加扫描成本，后续局部修改易漏同步 | High，逐条确认无独有义务后删除 |

### 2.3 需要在执行时补足的证据

- [x] 对所有活动长期文档建立“段落主题—当前 owner—目标 owner—处理动作”清单。
- [x] 对每条命令、版本、路径、默认值、工作流名称和当前组件清单追到代码、manifest、脚本、测试或 active owner。
- [x] 对 Quiet Pro 具体组件契约查找真实组件、消费者和 browser test，确认不能只因篇幅大就删除。
- [x] 对外部 PR 规则对比 `CONTRIBUTING.md`、PR 模板、intake policy、intake checker 和测试，确认哪个是语义 owner、哪个是派生入口。
- [x] 对 release workflow 规则对比版本政策、`package.json` scripts、`.github/workflows/*` 和 release tests，区分政策不变量与实现步骤。
- [x] 对 Web Activity、备份、恢复、migration、updater、授权和 Tauri capability 做 protected-boundary 标记。
- [x] 对所有拟新增文档证明其读者任务独立且净减少检索成本；不能仅为“分类漂亮”增加文件。

## 3. 范围与非目标

### 3.1 范围内

- 根 `AGENTS.md` 的长期入口职责与链接。
- 根 `README.md` 中面向用户和贡献者的长期入口信息。
- `CONTRIBUTING.md` 的贡献者路径、准入规则和双语结构。
- `.github/pull_request_template.md` 与文档 owner 的一致性。
- 9 份顶层 `docs/*.md` 的 owner、读者任务、当前状态、重复和实现细节。
- `package.json`、相关脚本、测试、workflow 和源代码，仅作为机器事实 owner 和防漂移门禁证据。
- 必要且有净收益的文档预算、链接或 owner 防漂移检查。
- 本执行单的验证、完成记录和归档。

### 3.2 范围外

- [x] 不改变 Patina 产品功能、交互语义、数据行为或当前路线优先级。
- [x] 不改变 Quiet Pro 视觉方向，只改变规则的归属和表达。
- [x] 不改变 SQLite schema、migration、备份格式、恢复行为或兼容窗口。
- [x] 不改变 Web Activity 请求、响应、鉴权、兼容策略或跨仓发布接受条件。
- [x] 不改变发布版本、创建 tag、发布 Release 或生成正式资产。
- [x] 不改变外部 PR 必须提供仓库外 UI 截图、仓库不得保存审查截图/GIF/视频的政策。
- [x] 不删除 `docs/archive/`，不按年龄或数量批量清理历史文档。
- [x] 不建立手工维护的全局文档索引来替代真实 owner 和链接。
- [x] 不把长期规则迁入 `.agents/`、本地 Skills 或其他忽略状态。
- [x] 不把本次文档治理扩张为产品代码重构、目录搬迁或 UI 组件重写。
- [x] 不隐含授权 commit、push、tag、Release、Issue 或 Project 写操作。

## 4. 目标文档体系与事实 owner

### 4.1 目标 owner 矩阵

| 主题 | 目标 owner | 主要读者任务 | 保留内容 | 不再拥有的内容 |
| --- | --- | --- | --- | --- |
| 全局协作入口与高风险停止条件 | `AGENTS.md` | repository-aware agent 进入任务前查 standing orders | 必读路由、授权边界、少量必须直接可见的禁止项 | 完整架构、UI、Project、PR 和验证细则副本 |
| 产品是谁、服务谁、做什么、不做什么 | `docs/product-principles-and-scope.md` | Explanation / decision reference | 用户、价值、范围、非目标、新功能准入 | 路线排序、具体 backlog、页面实现清单 |
| 当前阶段为什么这样排序 | `docs/roadmap-and-prioritization.md` | Explanation / prioritization reference | 路线主题、排序维度、打断条件 | GitHub Project 的逐步操作手册和工具路由 |
| GitHub Project 维护 | `docs/github-project-maintenance.md` | How-to | live state 核对方法、字段、状态、权限和完成清理流程 | 产品优先级理由、具体 Codex 插件名称、私有 Project 当前内容 |
| 系统结构、数据流、边界和 owner 地图 | `docs/architecture.md` | Architecture explanation / reference | 稳定分层、owner map、通道、不变量、落点决策 | 验证执行图、迁移历史、组件级目录百科 |
| 风险模型与质量政策 | `docs/engineering-quality.md` | Engineering reference | 质量维度、风险域、顶层门槛、准入原则、预算变更原则 | `npm run check` 叶子清单、脚本实现 walkthrough、其他 owner 的完整契约 |
| 稳定期问题怎样选择处理模式 | `docs/issue-fix-boundary-guardrails.md` | How-to / decision tree | 小修、边界判断、执行单、停止信号、验证路由 | 架构层定义、高吸力层完整副本、命令图 |
| Quiet Pro 长期设计系统 | `docs/quiet-pro-component-guidelines.md` | Design-system reference | 气质、token、通用组件准入、状态、可访问性和验证原则 | 单个 feature/组件消费者的完整行为百科 |
| 本地化消息契约 | `docs/localization.md` | Reference，必要时链接 how-to | schema、资源、runtime、生成和失败契约 | 与参考查找无关的冗长操作教程，是否拆分由 Phase 7 决定 |
| SemVer、changelog、发布与资产安全 | `docs/versioning-and-release-policy.md` | Release policy reference / maintainer how-to | 版本政策、不可变性、兼容窗口、changelog、资产和发布阻断条件 | 当前版本副本、历史策略、通用 push/Issue 规则、workflow job 全量复述 |
| Patina 与 Web Sync 线协议 | `docs/web-activity-protocol.md` | Protocol reference | request/response、鉴权、字段、兼容和变更顺序 | 扩展商店操作教程或 Patina 通用发布流程 |
| 外部贡献者路径 | `CONTRIBUTING.md` | Tutorial + contributor reference | 准备、scope、owner、实现、验证、PR、review | 架构和质量文档的完整重复解释 |
| PR 证据采集 | `.github/pull_request_template.md` | Form / checklist | 必填字段、风险、验证、外部截图入口 | 第二套政策解释 |
| 命令与执行图 | `package.json` 和脚本 | Machine reference | 当前 scripts 与组合关系 | prose 中的完整叶子清单 |
| workflow job 与发布实现 | `.github/workflows/*` 和验证脚本 | Executable owner | job、步骤、参数、失败条件实现 | 政策文档中的逐行镜像 |

### 4.2 不变量

| 不变量 | 长期 owner | 验证证据 |
| --- | --- | --- |
| Patina 继续以个人、本地优先、Windows 桌面时间追踪为产品边界 | 产品原则 | 产品文档与入口链接审查 |
| `app / features / shared / platform` 和 Rust owner 方向不变 | 架构 | 架构文档、现有边界检查 |
| 默认验证入口由真实 package scripts 决定 | `package.json` | script graph 与相关测试 |
| released data、migration、backup/restore 和协议兼容不因 prose 简化而删除 | release/protocol/architecture owners | 关键词审计、相关现有测试与 diff review |
| 可见 UI PR 继续要求仓库外截图，仓库不保存审查媒体 | `CONTRIBUTING.md` + PR template，agent 入口保留停止条件 | intake policy/checker/tests |
| push、tag、Release、Issue、Project 写操作仍需各自授权 | `AGENTS.md` | 文档审查；本任务不执行远程写入 |
| `.agents/` 和本地 Skills 不成为仓库或 CI 依赖 | `AGENTS.md` | Git status、长期文档扫描 |
| archive 只提供历史上下文，不成为 active owner | `AGENTS.md` 文档卫生规则 | active link scan、working/archive 检查 |

## 5. 简化候选与准入门槛

### 5.1 High-confidence 候选

每项只有在执行时完成证据复核后才能勾选实施。

#### H1 — 删除手写验证叶子清单

- 保持不变：默认顶层验证入口、风险追加验证和门禁强度。
- 当前问题：多个文档手工复述 `npm run check` 执行图，且至少一份已经落后于 `package.json`。
- 目标 owner：`package.json` 与脚本拥有执行图；工程质量文档拥有入口语义和风险追加原则。
- 净减少：删除重复命令项和同步义务，不增加新的执行入口。
- 反例：如果某个子命令本身是长期安全义务而不只是实现步骤，应保留义务名称，但不复制完整组合顺序。
- [x] 对照当前 script graph 和所有文档命中。
- [x] 确认被删项可由顶层入口或风险规则完整覆盖。
- [x] 删除叶子镜像并修正 AGENTS 默认口径。
- [x] 运行脚本图相关现有检查。

#### H2 — 删除长期政策中的当前版本副本

- 保持不变：版本文件一致、tag/Release/updater 一致和 release gate。
- 目标 owner：版本文件与 release validator。
- 净减少：每次发布少一个人工同步状态。
- 反例：发布政策仍可使用非当前版本的格式示例。
- [x] 确认所有版本同步脚本和测试不依赖政策文档中的当前版本字面量。
- [x] 删除当前版本字段及所有“同步本文版本”的流程步骤。
- [x] 更新相关 validator/test，使其不要求文档版本副本。
- [x] 保留版本一致性政策与发布校验入口。

#### H3 — 移除当前文档中的历史策略和迁移叙述

- 保持不变：当前 SemVer、当前架构、兼容窗口和真实退出条件。
- 目标 owner：Git 历史、归档计划或仍有未来价值的决策记录。
- 净减少：当前读者不再判断某段规则是否仍有效。
- 反例：备份 reader 的 90 天退出窗口是当前兼容契约，不是可删历史。
- [x] 搜索 `之前`、`曾经`、`不再`、`上一轮`、`历史策略`、PR/commit 叙述。
- [x] 对每个命中区分当前负保证、兼容事实和纯历史。
- [x] 只删除或归档纯历史；保留仍约束当前行为的事实。

#### H4 — 去除仓库政策中的具体 agent/plugin 工具路由

- 保持不变：必须读取 live GitHub Project，缓存、截图或旧结果不能代替当前状态。
- 目标 owner：仓库只拥有结果与权限要求；具体工具选择由运行环境能力决定。
- 净减少：Codex 工具产品更新不再要求修改路线图政策。
- [x] 把“使用某插件/禁止某连接器”改为能力和结果导向规则。
- [x] 保留登录、实时性、不可用时报告和无权写入的要求。
- [x] 搜索其他长期文档中的具体本地 Skill、插件或连接器名称。

#### H5 — 收口外部 PR 政策副本

- 保持不变：accepted scope、owner、risk、diff size、验证、外部截图和禁止仓库媒体政策。
- 目标 owner：`CONTRIBUTING.md` 保存贡献者可读语义；PR template 采集；intake policy/checker 执行；工程质量保存风险模型；AGENTS 保存一至数条阻断性 standing order。
- 净减少：四套文字不再完整同步。
- [x] 建立字段到 owner/checker 的映射。
- [x] 保证英文与中文贡献规则语义一致。
- [x] 保证 PR template 每个必填项都有长期 owner。
- [x] 保证 intake tests 覆盖不能仅靠文档声明保证的硬门禁。
- [x] 删除工程质量和 AGENTS 中的完整重复解释，保留路由与停止条件。

#### H6 — 删除重复的尾部 agent 摘要

- 保持不变：所有独有义务和停止条件。
- 当前问题：多份文档在正文后再次用“给 Codex 与后续协作者”复述相同规则。
- 净减少：同一文档内不再维护两份结论。
- [x] 逐条标记为“正文已拥有”“入口应拥有”或“独有事实”。
- [x] 将独有事实迁到正文 owner。
- [x] 删除只重复正文的尾部摘要。

### 5.2 Medium-confidence 候选

以下事项只有在 owner、读者任务和净减少量得到证明后实施。

#### M1 — Quiet Pro 组件级契约下沉

- [x] 逐节核对桌面挂件、Dialog/Popover、日期控件、详情弹窗、scrollbar 的真实 owner 和消费者。
- [x] 区分全局设计系统规则与单个组件/feature 契约。
- [x] 优先迁入已有组件 owner、邻近 README/JSDoc 或测试；没有真实读者任务时不新建文档。
- [x] 顶层 Quiet Pro 只保留可用于所有 UI 任务的原则、准入和路由。
- [x] 如果迁移会制造多个新文档且净维护状态增加，拒绝拆分并改为内部压缩。

#### M2 — GitHub Project 维护 how-to 在现有 owner 内独立成节

- [x] 证明路线优先级解释与 Project 操作是两个独立读者任务。
- [x] 证明独立 section 会被 `AGENTS.md` 稳定链接并且不复制优先级理由。
- [x] section 只写 live state、字段、状态、权限、验证和清理。
- [x] 不为该流程新增顶层长期文档。

#### M3 — 本地化 reference 与贡献 how-to 分离

- [x] 测量当前读者查 schema/runtime 契约和执行新语言流程时需要扫描的无关内容。
- [x] 只有两条路径都足够独立且稳定时拆分。
- [x] 无论拆分与否，命令必须按实际形式验证，runtime 契约必须保持一个 owner。

#### M4 — CONTRIBUTING 双语结构治理

- [x] 确认当前单文件双语结构是否导致链接、标题或更新不同步。
- [x] 比较“保持单文件并加一致性检查”和“拆成 sibling pair”的净维护成本。
- [x] 未证明净收益前不进行大规模双语搬迁。

### 5.3 明确拒绝的诱人方案

- [x] 不按统一比例压缩每份文档。
- [x] 不因为 `docs/archive/` 有 194 份文档就批量删除。
- [x] 不删除 migration、repair、backup reader、protocol compatibility 或 updater fallback。
- [x] 不把所有组件细则移进一个新的万能“UI 参考大全”。
- [x] 不建立新的手工 `INDEX.md` 复制文档清单。
- [x] 不让 `.agents/` 或某个本地 Skill 成为文档治理唯一 owner。
- [x] 不用脚本自动重写中文 Markdown。
- [x] 不为达到预算而删掉失败行为、例外、原因或负保证。

## 6. 执行阶段

### Phase 0 — 冻结范围并建立 owner ledger

目标：在修改长期文档前，记录所有事实归属和受保护边界。

- [x] 记录 `git status --short`、`git diff --stat` 和当前用户改动范围。
- [x] 确认只编辑本方案列出的文档与必要门禁文件，不覆盖无关脏改动。
- [x] 列出 9 份活动文档、AGENTS、README、CONTRIBUTING、PR template 的标题、行数、heading 数、命令数和路径事实数。
- [x] 为每个一级/二级 section 填写：主要读者任务、事实类型、当前 owner、目标 owner、处理动作、保护证据。
- [x] 搜索所有跨文档重复的强规则、命令、路径、版本、当前清单和尾部摘要。
- [x] 搜索所有 archive 链接，确认没有活动文档把 archive 当当前 owner。
- [x] 搜索 `.agents/skills/`、具体 Skill 名称、插件/连接器产品名和本地 registry/lock 文件名。
- [x] 标记所有 SQLite、migration、backup/restore、protocol、release、security、permission、push、Issue/Project authority 相关段落为 protected。
- [x] 记录基线指标；指标只用于比较净变化，不作为删字目标。
- [x] 完成 owner ledger 后再开始 Phase 1。

阶段验收：

- [x] 每个拟删、拟移或拟拆段落都有目标 owner和保护理由。
- [x] 没有仅凭“太长”“看起来重复”进入实施的候选。
- [x] Medium 候选已明确证据缺口和升级为 High 的条件。

### Phase 1 — 先修复机器事实与当前状态漂移

目标：先消除已经可以证明错误或多余的事实副本。

- [x] 以 `package.json` 为准读取 `check`、`check:full`、`check:rust`、`check:frontend`、release scripts 的真实执行图。
- [x] 修正 `AGENTS.md`、工程质量、架构、修复守则、贡献指南和发布文档中的默认验证关系。
- [x] 长期 prose 只保留顶层入口、风险条件和 owner 链接，不复制完整叶子顺序。
- [x] 检查 `npm run test:replay` 是否由默认入口覆盖；如果不是，明确它的风险触发条件，不能模糊宣称被 `npm run check` 包含。
- [x] 以版本文件和 validator 为准，移除版本政策中的当前版本副本及其同步要求。
- [x] 修正仍使用旧页面名称或旧 owner 名称的活动文档；以当前 localization/schema 和代码 owner 为证据。
- [x] 删除或迁移纯历史策略，保留当前兼容窗口和负保证。
- [x] 运行命中的现有 script/validator tests。
- [x] 记录每项事实为 `Verified`、`Owner-verified`、`Removed` 或 `Unavailable`。

阶段验收：

- [x] 任意默认验证问题只有一个详细答案。
- [x] 当前版本不再由政策文档维护。
- [x] 活动文档不存在已确认的旧页面名、旧目录名或旧 workflow 名。

### Phase 2 — 收口架构母文档

目标：把架构文档恢复为系统地图和 owner 决策 reference。

- [x] 保留系统现实、边界、不变量、前后端长期结构、owner 判断和禁止事项。
- [x] 检查当前 feature 列表：只有它表达稳定产品架构时保留；纯实现 inventory 改为高层能力或链接代码 owner。
- [x] 删除上一轮迁移叙述和指向 archive 的默认阅读路径。
- [x] 删除验证叶子清单，链接工程质量的顶层门槛和 `package.json` owner。
- [x] 合并重复的“新增代码决策顺序”和“新增代码落点规则”，但保留前端/Rust 差异。
- [x] 合并重复的禁止事项、重点防守区和健康落地指标；不同用途确实需要时保留清楚边界。
- [x] 把组件或 feature 私有实现细节下沉到真实 owner，不能迁入 `shared/*` 或 `platform/*` 这类新文字垃圾桶。
- [x] 更新所有指向被改 heading 的链接。

阶段验收：

- [x] 新协作者可以从架构文档回答“能力属于谁”和“新代码放哪里”。
- [x] 新协作者不需要在架构文档中维护脚本图或执行历史。
- [x] 架构文档没有依赖 archive 才能解释当前结构。

### Phase 3 — 把修复守则压缩为决策 how-to

目标：保留三种处理模式，删除对架构和质量 owner 的复述。

- [x] 用一张决策表表达小修、边界判断、执行单的触发条件、允许动作、停止信号和下一步。
- [x] 保留“先判断 owner，再决定实现”的主决策。
- [x] 兼容壳规则只保留修复时必须直接看到的停止条件，完整兼容政策链接架构/release owner。
- [x] 高吸力层完整定义链接架构，不再复制目录清单和理由。
- [x] 验证部分按风险链接工程质量，只保留如何选择门槛。
- [x] 删除重复尾部 agent 摘要，独有义务迁入正文。

阶段验收：

- [x] 读者能在一次扫描内完成模式选择。
- [x] 架构层定义和命令执行图各自只有一个详细 owner。

### Phase 4 — 重构工程质量与外部 PR 文档边界

目标：工程质量保存风险模型，不再成为所有 checker 和 PR 表单的百科。

- [x] 保留代码质量、性能、可靠性三个维度及其优先关系。
- [x] 保留风险驱动验证、测试独有失败模式、质量 gate 不可静默削弱等长期原则。
- [x] 把具体 checker 实现 walkthrough 改为“保护什么、机器 owner 在哪里、何时运行”的短 reference。
- [x] 删除 `npm run check` 叶子列表，改为顶层命令与 `package.json` 链接。
- [x] 把 localization 的完整操作细节留给 localization owner，工程质量只保留质量义务和风险路由。
- [x] 建立外部 PR 字段—政策—表单—checker—test 映射。
- [x] `CONTRIBUTING.md` 保留贡献者需要理解的完整规则。
- [x] PR template 只采集门禁所需字段和证据，不复制长篇政策。
- [x] intake policy/checker/tests 保持硬门禁的可执行 owner。
- [x] AGENTS 只保留 review 前必须直接看到的停止条件和 owner 链接。
- [x] 工程质量只保留为什么这些风险阻断 review，不复制贡献教程。
- [x] 保证可见 UI PR 仍要求仓库外截图，并禁止把截图、GIF、视频和 evidence-media 提交进仓库。

阶段验收：

- [x] 修改一条 PR 准入政策时，可以明确列出唯一 prose owner 和必要派生文件。
- [x] checker 拒绝的每个硬门禁都能在贡献者入口中找到解释。
- [x] prose 声明不能绕过自动门禁，自动门禁也不创造未文档化政策。

### Phase 5 — 收口 Quiet Pro 母文档

目标：保留长期设计系统，逐项判断组件细则是否下沉。

- [x] 保留 Quiet Pro 定义、允许/禁止、token、密度、排版、动效和通用可访问性原则。
- [x] 对 `panel/control/chip/status` 等稳定原型保留准入定义。
- [x] 对桌面挂件规则确认 `app/*` owner、现有组件和测试。
- [x] 对 Dialog、Popover、Tooltip、Select、Listbox 和日期组件确认共享组件 owner 与 browser test。
- [x] 对 scrollbar 规则确认 canonical CSS owner、feature 消费者和 geometry/accessibility tests。
- [x] 将 feature 私有布局、单个消费者、实现路径和测试案例移到最近 owner；只在它们改变全局 Quiet Pro 契约时留在母文档。
- [x] 不为每个组件新建文档；优先已有 README/JSDoc/test，必要新增文档必须说明读者任务。
- [x] 顶层文档为下沉契约保留可发现链接，而不是复制内容。
- [x] 复核所有 hard rule 和用户已确认的 UI 方向没有被削弱。

阶段验收：

- [x] Quiet Pro 母文档可以用于评审任何 UI，而不要求加载所有 feature 私有细节。
- [x] 组件独有失败模式仍有代码邻近说明或可重复 browser test。
- [x] 没有仓库内新增截图、GIF 或视频证据。

### Phase 6 — 分离优先级与 Project 操作

目标：路线图解释“为什么先做”，独立 Project how-to 解释“怎样维护 live 队列”，且不复制私有 live state。

- [x] 保留产品阶段、北极星、路线主题、排序维度、打断和降级条件。
- [x] 删除与产品原则重复的价值定义；保留必要链接。
- [x] 把具体 Project 字段、状态、权限、补位、人工排序和清理流程标记为独立 reader job。
- [x] 按 M2 新建 `docs/github-project-maintenance.md`，并从路线图迁出维护 how-to；顶层长期文档总数不得超过 10。
- [x] 新文档不得记录私有 Project 的当前条目、排序、字段值或截图，只能记录可公开复用的维护契约。
- [x] 无论是否拆分，都删除具体 Codex 插件/连接器产品名。
- [x] 保留必须读取 live Project、不能用缓存/截图/聊天代替、无写权限时明确报告等结果契约。
- [x] 保留维护者实际拖动状态、结构变更需预览确认、Issue 与 Project 状态独立等授权边界。
- [x] 更新 AGENTS 的 Project 路由，使其只保存必须直接执行的 standing order。

阶段验收：

- [x] 产品优先级变化不要求修改 Project 工具操作细节。
- [x] Codex 工具产品变化不要求修改产品路线政策。
- [x] Project 维护流程仍能独立完成并有可观察成功状态。

### Phase 7 — 收口版本发布、产品和本地化文档

#### 7A. 版本与发布

- [x] 保留 SemVer、已发布版本不可变、changelog、资产校验、跨仓签收、updater 和兼容窗口。
- [x] 删除当前版本副本和 `0.x` 历史策略。
- [x] 删除通用 push 授权与 Issue 引用格式副本，链接 AGENTS/CONTRIBUTING owner。
- [x] 把 workflow job 的逐步镜像压缩为政策级阶段、阻断条件和 workflow 链接。
- [x] 不删除旧备份 reader 的仍有效退出条件。
- [x] 不改变 Patina Web Sync 跨仓发布接受契约。
- [x] 运行 release validator 与相关测试的非发布模式；不创建 tag 或 Release。

#### 7B. 产品原则

- [x] 保留产品定义、核心用户、价值、范围、非目标和新功能准入。
- [x] 删除与路线图重复的具体优先级顺序。
- [x] 把具体页面名清单改为稳定能力类，除非页面本身就是明确产品边界。
- [x] 删除重复尾部 agent 摘要，保留越界时停止确认的义务。

#### 7C. 本地化

- [x] 保留消息 schema、生成边界、runtime、复数、失败和安全输入契约。
- [x] 执行 M3 的拆分证据判断。
- [x] 如果不拆分，用明确的 reference/how-to section 边界降低扫描成本。
- [x] 逐条执行或 owner-verify 文档展示的安全命令；需要未知语言审校或外部 XLSX 时不虚构通过。
- [x] 不修改用户可见翻译内容。

#### 7D. Web Activity 协议

- [x] 按协议 protected boundary 逐段复核。
- [x] 只修复可证明的当前事实、链接或 reader navigation 问题。
- [x] 不因追求统一篇幅而删除字段、错误响应、隐私说明或兼容顺序。
- [x] 如果没有高置信简化，明确记录“保持不变”。

阶段验收：

- [x] 发布政策不再维护当前版本或完整 workflow 镜像。
- [x] 产品原则与路线图分别拥有“做什么”和“先做什么”。
- [x] 本地化读者可以快速进入 reference 或贡献流程。
- [x] Web Activity 协议兼容性零变化。

### Phase 8 — 精简入口与导航

目标：最后修改入口，保证所有目标 owner 已经存在。

- [x] `AGENTS.md` 的 Always Read First 指向全部有效 owner。
- [x] 每个 standing order 控制在完成任务所需的最小直接上下文；完整细则链接 owner。
- [x] 保留授权、安全、编码、archive、媒体和高风险停止条件。
- [x] 删除已经由 active owner 完整承载的架构、Quiet Pro、Project、PR 和验证长副本。
- [x] `README.md` 只保留产品用户、下载、核心功能、隐私、构建和贡献入口，不复制内部治理。
- [x] `CONTRIBUTING.md` 的第一次贡献路径从 prerequisites 到 PR 有可观察终点。
- [x] CONTRIBUTING 的 reference 段落可查 scope、owner、验证、review 和 merge 规则。
- [x] 检查所有相对链接和 heading anchors。
- [x] 检查英文与中文贡献内容的义务、例外和命令一致。

阶段验收：

- [x] 新 agent 从 AGENTS 可以找到 owner，但不会一次加载所有实现百科。
- [x] 新贡献者只读 CONTRIBUTING 和被链接 owner 即可准备合格 PR。
- [x] 没有新增手工文档总索引。

### Phase 9 — 建立最小防复发门禁

目标：只机械保护已实际发生且可稳定判断的漂移。

#### 9.1 候选门禁

- [x] 检查现有脚本是否已能承接文档链接、预算或 owner 规则；优先扩展 owner，不先新建框架。
- [x] 评估每份长期文档的非空字符数、heading 数和最大 section，选择适合中文的检索成本指标。
- [x] 如果采用预算，为每份文档设置完成收口后的 ceiling 和至少 5% 合理余量；预算是 guardrail，不是目标。
- [x] 如果采用链接检查，验证相对文件和 `#fragment`，并提供合法与非法 fixture。
- [x] 只对可机械判定的禁项加 gate，例如 active docs 指向不存在文件、具体本地 Skill 路径成为依赖、版本政策重新保存当前版本。
- [x] 不尝试用 regex 判断所有语义 owner 或自动删除重复 prose。
- [x] 新 gate 必须有自测证明至少一个有效样本通过、一个目标失败样本被拒绝。
- [x] 新 gate 必须进入明确顶层命令，并在工程质量中只记录它保护的风险，不复制实现。

#### 9.2 净收益停止条件

- [x] 如果 checker 需要大量 allowlist、手工文档 inventory 或频繁误报，拒绝加入。
- [x] 如果预算只能迫使删掉必要契约，调整或拒绝预算，不能削弱规则。
- [x] 如果现有 Markdown/link 工具能满足需求，优先采用现有工具而不是手写替代品。
- [x] 记录新增文件、配置、测试和维护状态与被消除重复状态的净比较。

阶段验收：

- [x] 每个新增 gate 都对应本次已经观察到的真实失败模式。
- [x] gate 的机器 owner、失败信息和修复入口明确。
- [x] 没有把 ignored `.agents/` 状态变成 CI 输入。

### Phase 10 — 最终验证与对抗式审查

目标：在归档前主动尝试证明本次简化是错误的。

#### 10.1 常规验证

- [x] 重新生成活动文档 inventory 和 before/after 指标。
- [x] 验证 UTF-8、无 BOM、无 mojibake。
- [x] 验证 Markdown headings、fences、tables 和相对 links。
- [x] 搜索不存在的路径、旧页面名、旧 workflow 名、当前版本副本和具体本地 Skill 名称。
- [x] 搜索 archive 链接，确认只提供历史上下文且不作为 owner。
- [x] 运行新增或修改的 docs gate focused tests。
- [x] 如果修改 `package.json` 或质量脚本，运行 `npm run check`。
- [x] 只有触及 Rust、架构执行边界或 active owner 要求时才运行 `npm run check:full`；否则记录不适用理由。
- [x] 运行 `git diff --check`。
- [x] 复查 `git status --short`，确认没有把 `.agents/`、截图、GIF、视频或临时证据加入仓库。

#### 10.2 对抗式审查问题

- [x] 能否找到被删除但仍没有新 owner 的长期义务？
- [x] 能否找到两个文档仍对同一命令、版本、默认值或 PR 门禁给出不同答案？
- [x] AGENTS 是否被压缩到无法在高风险动作前提供必要停止条件？
- [x] 架构文档是否仍能指导前端/Rust 新代码落点？
- [x] 工程质量是否仍能区分代码质量、性能、可靠性和风险追加验证？
- [x] Quiet Pro 是否仍保留所有跨页面必须遵守的 token、状态、可访问性和媒体证据规则？
- [x] Project 流程是否因移除具体工具名而失去 live state、登录或权限失败处理？
- [x] release 文档是否误删了 backup reader、updater、asset integrity 或跨仓兼容条件？
- [x] Web Activity 协议是否有任何字段、错误、隐私或兼容语义发生变化？
- [x] CONTRIBUTING、PR template 与 intake checker 是否仍对 scope、owner、风险、截图和 diff size 一致？
- [x] 新 docs gate 是否可以被简单格式变化绕过，或者会误伤正常 prose？
- [x] 是否为了看起来像 DSH 而创建了不符合 Patina 规模和 owner 的新层级？
- [x] 是否存在“行数减少但文档跳转次数、owner 数或维护状态反而增加”的伪简化？
- [x] 是否有用户原有未提交改动被覆盖、重排或误计入本任务？

#### 10.3 审查处置

- [x] 每个发现分类为 blocking、follow-up、rejected concern 或 false positive。
- [x] blocking 问题在归档前修复并重新验证。
- [x] follow-up 必须进入明确 active owner 或经维护者确认的新工作项，不能只留在本文未勾选。
- [x] rejected concern 记录拒绝理由，避免后续重复提出诱人但不安全的简化。
- [x] 审查完成后再运行最终 aggregate gate，不能复用修复前结果。

## 7. 验证矩阵

| 风险 | Focused check | Aggregate gate | 通过证据 |
| --- | --- | --- | --- |
| Markdown 编码损坏 | UTF-8/BOM/mojibake 扫描 | `git diff --check` | 文件可读且无编码标记 |
| 相对链接或 anchor 失效 | docs link checker 或等价脚本 | `npm run check`，若 checker 接入 | 合法 fixture 通过、失效 fixture 被拒绝 |
| 验证命令 prose 再次漂移 | script graph 对照与相关测试 | `npm run check` | prose 只声明顶层入口，执行图来自 `package.json` |
| 当前版本形成第二 owner | release validator focused tests | release validation 非发布模式 | 政策文档无当前版本副本 |
| PR 门禁语义分叉 | intake policy/checker tests | `npm run check` | template、贡献指南和 checker 映射一致 |
| 架构 owner 规则丢失 | architecture checker/self-test | `npm run check` | owner 边界测试保持通过 |
| Quiet Pro 组件契约丢失 | 命中结构/browser tests | `npm run check` | 独有失败模式仍有测试 owner |
| release/backup/protocol 兼容损坏 | release/protocol keyword ledger 与现有 tests | 需要时 `npm run check:full` | protected 条目逐项保留 |
| 文档无意识膨胀 | doc budget focused tests（如采用） | `npm run check` | ceiling 有余量且反例失败 |
| ignored Agent 状态进入仓库 | `git status --short` | N/A | `.agents/` 和 local lock 未进入 diff |
| 审查媒体进入仓库 | tracked file/extension/path scan | intake/docs gate（如适用） | 无新增 screenshot/GIF/video/evidence-media |

- [x] 每个实际改动风险都有 focused evidence。
- [x] 最终 aggregate gate 在最后一次修正后执行。
- [x] 未运行的检查记录原因、残余风险和验证 owner。
- [x] 没有把“计划 checkbox 已勾选”当作产品事实已经验证的替代品。

## 8. 文档生命周期与归档

### 8.1 执行期间

- [x] 本文保持在 `docs/working/`，并作为本轮唯一活动执行单。
- [x] 每个 checkbox 只在证据存在后勾选。
- [x] 偏差、阻塞和拒绝候选写入对应阶段，不用聊天记录代替。
- [x] 长期结论直接更新 active owner，不依赖本文继续解释。
- [x] 不修改已有 archive 文档来伪造当前一致性。

### 8.2 归档前门槛

- [x] 所有适用实施项均已勾选。
- [x] 不适用项已写明理由，没有静默遗留空框。
- [x] Medium 候选已实施、拒绝或转移到明确 owner。
- [x] 所有长期规则都有 active owner。
- [x] 最终常规验证通过。
- [x] 对抗式审查完成且 blocking 问题清零。
- [x] 本文 Status 改为 `Complete`，Last updated 更新为实际日期。
- [x] 完成记录填写实际交付、验证、偏差、残余风险和 before/after 指标。
- [x] 本文从 `docs/working/` 移到 `docs/archive/`。
- [x] 移动后重新验证相对链接和 `docs/working/` 状态。
- [x] active 文档不链接归档后的本文作为当前 owner。

## 9. 完成定义

只有以下结果同时成立，任务才能宣布彻底完成：

- [x] 长期文档 owner 矩阵已经落地，不只是写在计划里。
- [x] 已确认的命令、版本、历史、工具路由和 PR 政策重复已经处理。
- [x] 架构、质量、修复、Quiet Pro、路线图、发布、产品、本地化和协议各自保留明确职责。
- [x] 所有 protected boundary 都有逐项保留证据。
- [x] 必要防漂移门禁已加入，或者有证据证明新增 gate 的净成本更高而明确拒绝。
- [x] 仓库没有新增审查截图、GIF、视频、evidence-media 或本地 Agent 状态。
- [x] 未覆盖用户既有改动，最终 diff 可以按 owner 独立审查。
- [x] 对抗式审查通过。
- [x] 本执行单完成勾选、填写记录并归档。

## 10. 完成记录

> 执行完成时填写；Draft 阶段不得预填“通过”。

### 10.1 实际交付

- 新增 `docs/github-project-maintenance.md` 作为第 10 份长期文档，承接私有 Project 的维护方法，但不保存 live item、排序、字段值或截图。
- `roadmap-and-prioritization.md` 只保留优先级政策并路由到 Project how-to；具体 agent/plugin 产品名已移除。
- 架构、修复、工程质量和 Quiet Pro 文档分别收口为 owner 地图、决策 how-to、风险模型和跨页面设计系统；组件消费者、checker walkthrough、命令叶子图和重复尾部摘要已删除或链接到机器 owner。
- 发布政策不再保存当前版本或 `0.x` 历史策略；`scripts/release.ts` 与 release tests 不再读写政策文档版本值。
- AGENTS 的默认验证口径统一为 `npm run check`，Project 与 Quiet Pro standing orders 链接各自完整 owner。
- 新增 `scripts/check-doc-governance.ts` 及 self-test，机械保护 10 份上限、相对文件与 fragment、当前版本副本、具体 Project 工具路由和 ignored Agent Skill 链接，并接入默认 `npm run check`。
- `localization.md` 明确 reference/how-to 边界；`web-activity-protocol.md` 经 protected-boundary 复核后保持不变。
- 外部 PR 的仓库外截图要求和禁止提交审查媒体政策保持不变；既有 intake policy/checker/test 改动未被覆盖。

### 10.2 Before / after 指标

| 指标 | Before | After | 解释 |
| --- | ---: | ---: | --- |
| 活动长期文档数量 | 9 | 10 | 唯一新增项是独立的私有 Project 维护 how-to |
| 活动长期文档总行数 | 3832 | 3100 | 新增 128 行 Project how-to 后仍净减少 732 行 |
| 已确认的重复事实组 | 8 | 0 个未解决 | 命令、版本、历史、工具路由、组件消费者、架构/修复、PR 和尾部摘要均已收口 |
| 手工维护的命令执行图副本 | 3 | 0 个完整叶子镜像 | `package.json` 是执行图 owner；长期文档只保留入口和风险语义 |
| 保存当前版本字面量的政策文档 | 1 | 0 | release 工具与 tests 也不再要求该副本 |
| 具体本地 Skill/plugin 路由命中 | 2 个具体 Project 工具名 | 0 | 仓库规则改为 capability、live result 和权限契约 |
| 未解决的 protected-boundary 缺口 | 0 个已知 | 0 | 备份、migration、协议、发布、安全、媒体和授权契约均有 active owner |

### 10.3 实际验证

- 2026-08-30：`npm run check:docs:self-test`、`npm run check:docs`、`npm run check:types`、`npm run check:lint`，退出码 0。
- 2026-08-30：`npm run test:release`、`npm run release:validate-version-files -- 1.9.4`、`npm run release:validate-changelog -- 1.9.4`，退出码 0。
- 2026-08-30：UTF-8 fatal decode、BOM/mojibake 扫描、活动链接/fragment、媒体扩展与 ignored Agent state 扫描，均通过。
- 2026-08-30：`npm run check` 首次在沙箱中于 Vite browser smoke 启动阶段因 `spawn EPERM` 失败；相同命令在获批的沙箱外环境退出码 0，包含 103 个 browser smoke、27/27 mutation、coverage、PR intake、build 和 bundle gate。
- 2026-08-30：`git diff --check` 通过。未运行 `npm run check:full`：本轮没有修改 Rust、依赖、schema、IPC/capability 或架构执行边界；`npm run check` 与 focused release 验证覆盖了实际改动。

### 10.4 批准偏差与拒绝候选

- 用户在执行期间把顶层长期文档上限从 9 调整为 10；新增名额只用于 Project how-to，且明确禁止复制私有 live state。
- 拒绝逐文档字符/heading 预算：它需要维护第二份文档 inventory，且可能推动删除必要契约；采用总数上限、链接和已观察漂移的窄 gate。
- 拒绝拆分本地化文档：reference 与 how-to 共用同一消息契约和读者路径，新增第 11 份文档没有净收益。
- 拒绝继续缩短架构、bundle、migration、备份 reader、发布资产和协议段落：它们仍拥有独有安全或兼容义务。
- `web-activity-protocol.md` 无高置信简化，保持不变；README 现有产品素材不属于本轮新增审查证据，也未改动。
- 对抗式审查发现 2 个 blocking 门禁缺口：fragment 未校验、英文工具名可绕过；均已补 self-test 并修复。无 follow-up，其他诱人简化按上述理由拒绝。

### 10.5 残余风险与后续 owner

- 无已知 blocking 残余风险。
- 语义上的 one-home-per-fact 不能完全由 regex 判断，继续由文档作者和 review 负责；机器 gate 只保护本轮可稳定机械判断的失败模式。
- 私有 Project 的当前内容仍只能在有权限的 live Project 中验证；仓库文档刻意不保存该状态。

### 10.6 归档结果

- 归档路径：`docs/archive/patina-long-lived-document-governance-simplification-execution-plan.md`。
- 移动后重新运行 docs governance、UTF-8/link 检查和最终 aggregate gate；`docs/working/` 不保留本文副本，active 文档不依赖本文作为 owner。
