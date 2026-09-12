# 加权 90+ 改进的对抗式审查记录

> 状态：已确认 A1～A15 完成修复及独立复核；按用户要求停止追加长测并归档  
> 日期：2026-09-12  
> 归属：[加权 90+ 执行方案](quality-90-plus-execution-plan-2026-09-12.md)

本地实施及默认完整验证通过后，于 09:49 UTC 开始交叉审查。首次审查输入为 HEAD `6353c6ab1665d6135d810b039ced1bbb8d8ff93a` 加工作树，896 项输入摘要为 `1b5a42a5126861801992810f2b6e3f36cc2e4fbd123a3c4fe09739a4d05f0050`。该输入实际通过 131 项浏览器检查、745 项 Rust 测试及其余 `check:full` 门禁。随后发现的问题继续实施，不把旧绿色当作修复后的验证。

审查覆盖本轮改动及其真实调用链，按数据安全、边界、失败、竞态、恢复、容量检查。三个复核方向分别是数据与恢复、前端状态与缓存、CI 与运行时；复核者优先检查其他实现者的代码。用户同期的贡献与文档修改保留，未因审查提交、推送或改变远端状态。

## 已确认问题与处理

| 编号 / 级别 | 可复现的触发与后果 | 原始证据 | 当前处置 |
| --- | --- | --- | --- |
| A1 / P1；必要重置为 P2 | 覆盖恢复的新池在删除恢复标记前可被公开。Windows 句柄禁止删除标记时，恢复返回错误，但候选池仍可用；残留标记会让后续启动选择原库回滚，形成丢弃恢复后写入的风险。另两项必要的定时配置重置原在提交后执行，失败会截断通知。 | `artifacts/quality95/restore-commit/marker-old-order-red.log`；实际 Windows OS32 拒绝删除。`reset-behavior-red.log` 用真实 SQLite abort 触发器分别拒绝 legacy/snapshot 路径的必要重置。 | 必要配置准备与磁盘提交先于公开新池；失败关闭候选并恢复原库。备份 35 项、恢复 26 项专项通过，外部作者复核无新问题；`runtime-mutation-chains.log` 又通过真实 AppHandle 覆盖恢复、缓存刷新、投影重建及后续追踪写入。故障触发器与正常 IPC 分别提供证据，不冒称已在活跃 Tauri 内复现断电丢失。 |
| A2 / P1；政策路径保护为 P2 | `check:rust` 前置 `exit 0 &&` 后，原脚本文本仍在，旧正则图比较接受候选；真实 Windows shell 直接成功退出，检查未执行。既有 `pr-intake-policy.ts` 自身也缺少精确路径保护。 | `artifacts/quality95/intake-short-circuit-red.log`：实际检查标记不存在、shell exit 0，同时真实 Intake CLI 输出通过。政策路径另有实际拒绝反例。 | 受限命令结构与保序检查拒绝未知 shell 组合，保留明确新增测试入口；政策文件加入保护。46 项测试、类型和 lint 通过，作者外交叉复核无新问题；原 NUL Git 路径解析保留。远端 A→B 编排仍未实测。 |
| A3 / P2，共两项 | History 成功日与失败请求日跨月后，月份按请求日打开，但日期选中与焦点使用呈现日，导致所见月没有可进入的日期。时间线弹窗的箭头名称也可能与实际请求目标不同。 | `artifacts/quality95/history-cross-month-red.log`：月份 2026-08，selected 为空、focused 为 null、可 Tab 日期数为 0；`history-dialog-date-red.log` 记录名称为次日之后一天、实际请求为次日的错配。 | 弹层选择/焦点及箭头名称使用请求日期，已显示数据的标题使用呈现日期；21 项真实浏览器读取与键盘场景通过，类型/lint 通过，作者外复核无新问题。 |
| A4 / P2 | 共用热力图 hook 将固定 320 ms 等待也施加给目的地读取，完整内容条件等待该读取，Data 导航超过原平均预算。 | `artifacts/quality95/perf-stable-final.log`：complete average 564.05 ms，预算 500 ms；同次 read-model-ready average 176 ms。 | 删除固定等待，保留首帧后调度、取消与完成条件。最终五轮套件通过：Data complete 各轮平均值的均值 206.32 ms、最差轮 p95 347.70 ms；日志 `perf-stable-post-focus.log`。期间只有不被该套件使用的 native runtime 测试文件变化，产品与性能输入一致，逐文件核对见 `perf-post-focus-summary.json`。 |

这里区分“本轮引入”和“沿调用链发现的既有缺口”：A4 属于本轮合并读取逻辑后的回归；A1/A2/A3 的相关旧行为已经存在，不能把修复范围外的原始缺陷伪称为本轮新增。已确认的核心缺陷仍需处理。

## Tools 轮询事务

**A5 / P2：** Tools 的同一 tick 原先分别提交四类任务。真实 SQLite 触发器拒绝最后一项番茄钟统计写入时，前面的提醒、活动提醒和倒计时已被消费，整个调用却返回错误，事件没有交给调用者。旧实现实际留下 `fired / 已触发日期 / completed`；证据为 `artifacts/quality95/tools-tick-atomic-red.log`。

现由 `SqliteToolsStore` 持有一次轮询的事务，四项 repository 操作共用该事务，提交成功才返回事件。真实故障下全部状态回滚，解除故障后的下一次调用返回四类事件，再次调用不重复；相关 45 项 Rust 测试及格式检查通过，日志与五文件身份见 `tools-tick-atomic-green.log`、`tools-tick-atomic-fmt.log`、`tools-tick-atomic-inputs.json`。仅测试调用使用的 Pool 包装留在测试模块；生产 SQL 各有一个实现。此项保证的是本次事务与事件批次构造的一致性，不声称解决提交后进程崩溃造成的通知投递中断。

## 收口清单

最终组合回归于 10:11 UTC 暴露 **A6 / P2：快捷分类菜单关闭后的迟到回焦**。输入前后摘要均为 `6ea157bea6be0429b65420337a2ce7e1104454dc16292d8cd09d5af8361aa00c`，失败发生在 Data 网页对象菜单关闭后的键盘焦点断言，`check:full` 因此未通过。受控真实浏览器反例确认：前一菜单关闭回调仍排在下一帧，用户已经聚焦列表按钮，旧回调却把焦点抢回顶部图标；列表节点仍连接，并非节点删除。证据为 `artifacts/quality95/data-quick-focus-red.log`。修复由原 launcher 立即归还焦点并去掉无必要的延迟；13 项专项浏览器、类型和 lint 通过，真实 native 分类菜单流程也通过。最终组合检查仍待完成，不以专项绿色替代。

**A7 / 测量工具缺口：** 一年数据集首次真实测量时，入口沿用托盘启动后的隐藏主窗，却直接开始页面交互；History 导航在 15 秒后超时。`artifacts/quality95/runtime-r1-final.log` 与事件文件保留该失败，不能把它解释为有效的正常可见窗口性能样本。修复使用原生显示命令，确认窗口和文档均可见后才开始导航计时，并记录真实可见状态。另将运行失败与清理失败分开记录，避免普通测量失败被误记为清理失败；相关 profile 测试为 14 项通过。R1 后续真实采样与独立时长对账成功，见 `runtime-r1-visible-final.json`；这表示测量完成，延迟目标仍未达到。

该数据集还包含没有子样本的旧式标题。首次开库会通过原兼容路径补齐标题样本；schema、索引及迁移身份本身完整。此初始化成本和后续已启动窗口的导航分别记录，不删除旧标题数据来换取更好的分数，也不把页面测量当成进程冷启动结果。

## 真实容量复验的未达标项

R1 可见窗口的 30 次热导航中，History 最新读取完成 p95 为 514.7 ms，Data 完整内容 p95 为 265.1 ms。History 现有 runtime 条件等待 `ready/empty`，而可信的同日缓存可能在 `refreshing` 时已显示，因此 514.7 ms 保留为最新读取完成时间；后续同次采样追加有意义内容时间，并校验日期与 mapping 身份，不通过放宽状态名单签收。

R1 全年选择的 30 次暖缓存完整内容 p95 为 916.4 ms，超过本计划 400 ms 目标；首次选择为 434.7 ms。年度 UI 实际使用日级聚合，独立月级 IPC 探针不是同一负载，不能直接相减归因。年度计时从 Apply 提交开始；日期选择器操作另记。普通导航访问的是夹具范围之外的当前空日，不代表密集历史日首屏。

**A8 / P2：** 趋势 hook 的暖缓存路径仍固定等待 320 ms，然后才读取。这与 A4 的共用热力图是不同的生产路径。已仅删除该常量和调度参数，保留双 RAF、idle、取消、身份及完整内容条件；68 项 Node、15 项浏览器及类型/lint 通过。证据为 `artifacts/quality95/r1-trend-delay-diagnosis.md`。实际年度性能收益待同夹具复验，不能预先用减法算作通过。

R3 在 10:36 UTC 的运行未进入采样：原生窗口在 8 秒 readiness watchdog 后仍隐藏，10 秒测量前置条件失败，清理成功。输入前后摘要均为 `564020d27e86e0d6568d3eda2056c3bd4b609c50c6daa11e5fb3dba61528563a`；日志 `runtime-r3-final.log` 保留失败。以下诊断定位了启动迁移和空尾段查询，不能把此次运行记成有效 R3 性能结果。

## 分类迁移与资源测量

**A9 / P2：分类迁移的全量事实传输。** 真实 R3 启动诊断中，旧 SQL 调用返回 1,101,570 行，耗时 19,760 ms；前端 ready 约在 26,899 ms。调用返回后至后续 Promise 处理之间约 6,092 ms，尚无 CPU profile 将这段时间全部归因给某个函数。诊断仅延长观察，不改变正常可见性门槛、事实数据或迁移 marker，见 `artifacts/quality95/runtime-r3-startup-diagnostic-v2.json`。

原 settings command、classification service 和 repository 现在持有这次读取，复用现有事实优先级，只把原始应用身份与名称返回给旧分类规则。旧前端全量读取、重复聚合和仅测试消费的包装已删除；marker 与分类修改仍原子提交。13 组旧生产结果通过真实 SQLite 对照，102 项 Node、16 项 Rust、类型、lint、格式及边界检查通过。main 成功与 Widget 拒绝已加入原 runtime，但尚未执行；真实性能也待重测。实现、兼容细节及输入身份见 `artifacts/quality95/classification-migration-evidence.md`，不把目录缓存当作语义相同的替代数据。

**A10 / 测量工具缺口：进程失读与合法零值。** 资源采样器原先可能丢弃暂时无法读取身份的子进程，从而把不完整的总量当作完整采样；`GetGuiResources` 返回的合法 0 也需要与错误区分。现在保留已确认身份及不确定后代，缺失会阻止对应指标验收；身份恢复、父链传播与 PID 复用分别处理。采样器在快照前记录时间，快照后才创建的进程保守记为本轮缺失，不宣称获得了原子的全系统快照。

CPU 首次计数没有前一基线，允许仅首样本为空；后续缺失仍不具备验收资格。6 项采样器 Rust 测试与 16 项 profile 测试通过，包括实际 Windows GUI API 的合法零值及无效句柄。跨作者复核还修复了孤儿进程失读后无法恢复和父链身份更新未继续传播的问题。见 `artifacts/quality95/resource-sampler-lifecycle-review.md`、`resource-sampler-lifecycle-green.log`。这些是工具有效性证据，尚没有新的 10 分钟或 8 小时资源实测。

**A11 / 测量工具缺口：完成帧之间的状态回退。** 导航探针第一次观察到 ready 后等待下一帧，旧回调只检查 History 的可信身份，允许同日同分类版本已退回 refreshing 的页面被记为最新读取完成。年度探针也可能在最终帧丢失 ready、范围、总量或图点条件后仍返回成功。两条真实生成表达式均在受控帧测试中先红后绿；最终帧现在重新检查对应的完整条件，状态回退则继续原有轮询，同一个 15 秒 deadline 不重启。17 项 profile、类型和 lint 通过，证据为 `artifacts/quality95/runtime-history-final-frame-red.log`、`runtime-annual-final-frame-red.log` 及对应绿色日志。原有内容显示时间仍单独保留；这不改变产品加载状态或性能门槛。

## 大库范围查询与统计生命周期

**A12 / P2：空尾段和近期范围扫描历史事实。** 原生事实读取使用 `start_time < end` 索引，再过滤 `COALESCE(end_time, now) > start`。范围位于大量历史之后时，零结果仍需检查旧事实；History 的三个同池读取还会依次排队。只增加结束时间索引并不足以让 SQLite 选择它，强制使用该索引则使早期日期退化，已保存这两个不采用的结果。

现于 migration 15 追加 `sessions(end_time, start_time)` 索引，并分析 sessions 的全部竞争索引；已发布的 1～14 SQL 和校验值保持。原 repository 的半开范围改为可用索引的等价 OR 条件，开放会话、来源优先级与排序不变。真实 SQLx 诊断中，R1/R3 早期日期约 3.84/3.46 ms，近期约 3.76/3.73 ms，当前空日约 0.35/0.68 ms；这些是诊断均值，不是最终 IPC 或页面 p95。新增索引实际占用约 8.1/24.3 MB，1000 次带原触发器的结束时间更新事务约增加 0.6/0.5 ms；该写入样本不代表单次追踪提交成本。

统计维护放在原 SQLite maintenance owner，由现有读模型 worker 在空闲时调用。初稿 `optimize(0x10002)` 每轮仍请求分析两个单行配置表，并触发统计重新加载；它没有重复分析 sessions，本次也未观察到 WAL 增长。跨作者复核后改为 `optimize(0x2)`，由 SQLite 检查查询使用过的统计和缺少统计的索引。生产与测试共用唯一掩码，回退旧值会使同一默认测试失败；没有解析调试 SQL 来驱动生产行为。

R1/R3 重复检查十次的平均耗时为 0.116/0.100 ms、p95 为 0.167/0.130 ms，调试结果没有待执行分析；初次补齐其余表统计仍有约 696/2201 ms 成本。空库增长、真实配置点读、再次开库后增长及统计失败的非致命处理有对应测试。证据为 `artifacts/quality95/read-path-716b8509/optimizer-costs.json`、`optimizer-costs-mask2.json`、`optimizer-mask-regression-red.log` 和 `optimizer-mask-restored-green.log`。原始夹具仍为 schema 14，最终真实运行须复制并经正常升级，不能用预改原库替代。

- [x] 固定首次审查输入、默认验证与作者之外的复核分工。
- [x] 对确认的问题保存可失败证据，区分错误假设、编译错误、产品反例与测试工具反例。
- [x] 完成全部确认问题的最小修复，并补齐对应实际入口回归。
- [x] 由未实施该修复的复核者复查提交边界、失败传播与新增维护成本。
- [x] 绑定最终源码、生成资源、锁文件和验证结果，检查旧绿色是否仍适用。
- [x] 将本地可执行范围的实际五维评分写回主执行方案；正式运行、长期和人工等扩展证据按用户要求列范围外未验证，不扣分、不记通过。

本记录按用户调整后的加权 90+ 目标收口，各维度仍如实评分。是否归档按主执行方案的实际验收状态和[文档生命周期](../../AGENTS.md#documentation-hygiene)处理。

## 最终组合复核的补充发现

11:37～11:41 UTC 的 `check:full` 在 History 最后一个日历键盘场景失败，输入前后均为 `fa2c887001d019da77b3cf17e176e33c001268b487f210f14e3b79d0325aa4bf`。清理前诊断确认日期、弹层关闭及回焦正确；夹具却仍识别旧六参数 SQL，使七参数范围查询收到其他日期事实，空日因此被标记 ready。修复夹具按实际 end/start 参数过滤并拒绝未知形状；15 项专项浏览器、类型和 lint 通过，见 `artifacts/quality95/history-closeout-fixture-evidence.md`。这是验证夹具缺陷，不能归因为产品导航失败，也不能抹去该次 full 失败。

**A13 / P2：恢复后的暂停状态读取失败。** 旧库最近验证过的 `tracking_paused=false` 缓存，在恢复含 true 的数据库后若首次读取失败，仍可能被追踪循环复用。原循环的正常验证间隔使重读不能立即发生；恢复前后都已暂停的原 native 场景没有区分力。真实 SQLite 暂时不可读的反例已使旧实现失败，见 `artifacts/quality95/restore-pause-old-red.log`。

修复由原 pause owner 表达“暂停且尚未验证”，读取开始前进入该状态；失败保持暂停并允许下一轮立即重验，成功仍使用真实持久值。独立复核还发现初始化可能在锁外迟到发布旧值，现将原 startup、pause/title 初始化一起纳入既有 title update → tracking transition 临界区，防止跨恢复读取和发布。没有增加新的调度或 generation 框架。恢复的提交成功语义保持，不能引导用户重复恢复。

98 项追踪测试全部通过，包括实际 SQLite 连续读取失败、安全暂停、即时重验和成功恢复 false；证据为 `artifacts/quality95/restore-pause-final-green.log`。跨作者复核确认锁顺序及错误/取消释放，见 `artifacts/quality95/restore-pause-independent-review.md`；没有将这次静态锁复核称为动态并发实测。12:01～12:02 UTC 的实际 normal 运行成功，确认当前值 0、备份值 1 的不同值切换，替换后暂停与恢复的心跳均进入新池；持久值接线与内部失败保护由不同层级证据承担，未在完整 Tauri 内注入 SELECT 故障。日志及输入关联见 `artifacts/quality95/runtime-90-a13-normal-evidence.md`。随后默认 Rust 主套件包含本次保护并全部通过。

12:00 UTC 的组合检查中，137 项浏览器、前端构建及包体通过；Rust 为 756 通过、1 失败、2 个原有 ignored。失败的旧备份夹具先建立当前 v15，再动态只删除最后的 v15 元数据，却硬编码删除 v14 表和 trigger，因此实际既不是 v13 也不是完整 v14。生产 schema 校验正确拒绝了该不一致结构。修复只在测试中用原生产迁移构建真实 v13 前缀，继续验证旧库缺少当前表时应先验证迁移指纹再升级，没有删除原测试含义。11 项备份专项及随后 757 项 Rust 主测试、6 项采样器测试通过。原失败及输入 `8362dfbeb02eb43fb7d0048ddc66dca0cdbd29ad1917868e5f11eba9f33ff8c3` 保留于 `artifacts/quality95/check-90-a13-full.log`；修复证据见 `snapshot-prefix-fixture-repair.md`。

最后 Clippy 拒绝分类优先级的布尔大小比较；等价改写为 `named && !previous_named` 后，7 项真实分类对照测试、格式和 Clippy 通过，联网依赖审计也通过。最终 897 项机器输入摘要为 `dd6729e5292945a39cce089345ca7bf7e2dc8e306a41cb126ff1eb5a10b02880`。默认图按实际变更及受影响检查分段闭合，见 `artifacts/quality95/default-gates-90-evidence.md`；原失败命令不改写为成功，也不将最后布尔改写前的 normal 冒充最终全部文件摘要下的一次运行。

## 短时资源复验的后续发现

12:29 UTC 完成的 R1 测量固定在上述候选，页面内容和真实 IPC 对账有效；密集日有意义内容 p95 为 283.2 / 279.1 ms，未达到 150 ms；暖全年 p95 为 352.4 ms，达到 400 ms。原记录见 `artifacts/quality95/runtime-90-r1-observation.md`。两者是不同交互，不用空日 48.8 ms 替代密集日。

**A15 / 测量工具缺口：资源场景身份丢失。** 采样约 440 秒后主窗出现 `background-idle` 回收，进程树从包含 WebView 变成仅有根进程；旧测量入口只检查采样完整性，仍输出 completed。全过程不能签为主窗闲置十分钟。原日志、121 个样本和结果保持，修复由同一测量入口观察场景身份并明确拒绝发生变化的验收，不关闭追踪、强行重开窗口或删除负样本。资源采样完成与场景验收资格分别表达，跨作者复核及最终实际接线正在进行。

**A14 / P2：追踪轮询的历史全表扫描。** 混合场景全进程单核 CPU 平均 25.15%、p95 44.61%，主要在根进程，主窗回收后仍有成本。独立调用链确认同窗不变时仍每秒调用 `load_active_session`；它附带的闭合时长子查询使用 `LOWER(exe_name)`，无法利用现有原名索引。真实 SQLx 在专属 R1/R3 副本中显示 `SCAN closed`，即使当前应用没有任何历史，也分别需约 150～165 / 446～512 ms 一次。证据为 `artifacts/quality95/active-session-cf9351fe/sqlx-baseline-candidate.json`。

候选在同一查询加入既有 NOCASE 索引预筛，并保留原 LOWER 谓词精确过滤，计划变为索引检索；无历史当前应用分别约 0.08～0.24 / 0.11～0.33 ms。高频历史应用仍约 66～77 ms，因此不宣称所有输入常量时间，也不将此单项诊断当作整个应用 CPU 已达标。修复及连续组、大小写、异常字符串边界回归正在原 sessions owner 完成，未改旧迁移或新增索引。目录与平台条件性调用的独立核对见 `runtime-cpu-other-paths-readonly.md`，没有证据将它们认定为本次全部 CPU 的主因。该本地异常仍在评分范围内，不能因排除正式或八小时验收而忽略。

## 最终收口

最后追踪查询 5 项 owner、98 项 tracking 及完整 Rust 759＋6 项通过，源码 SHA `07e47ce5145eb811b4a2dffa791677310b67d0acf2b2feb0decf725edbf3fc14`，独立复核见 `artifacts/quality95/active-session-independent-review.md`。未新增索引或改变原 LOWER/连续组匹配。

A15 的独立挑战另发现结束竞态：采样结束后的最后检查成功时，已经在途的周期检查可能读到暂停并拒绝，旧 finally 却吞掉这个拒绝。实际生成表达式、真实 helper 与受控 SQL Promise 交错得到 RED。修复仅在采样结束后停止安排新轮询、等待在途观察完成，再执行最后检查；23 项默认 profile、类型/lint 和独立同交错 GREEN 通过，失败不能签收且清理成功。见 `artifacts/quality95/resource-scene-independent-review.md`、`resource-scene-validity-evidence.md`。每五秒原生/设置点读属于测量开销，不估算扣除，也不宣称连续原子 OS 观察。

最终机器输入 `36b5bc9ec77962e9bcec669a156d5d5141570cf1b95dd48f9b66d0b8e444f849`，897 项。此前主文各时间段的“待复验”是当时状态；当前没有遗留的已确认 P0/P1/P2 实现问题，但最后新候选完整桌面、R1/R3 与资源观察器原生失败接线没有执行。用户要求尽快结束后，不再新增运行；这些本地缺证计入工程/性能评分，正式、八小时、人工扩展不计分、不记通过。

主计划最终五维 95/94/92/92/78，加权 **91.15/100**，达到约定加权 90+。性能未达到 90，原密集 History 和资源目标没有伪报通过。最后一次本地构建成功，最近实际桌面回归通过核心流程；最后查询优化后的桌面回归缺证仍明确保留。
