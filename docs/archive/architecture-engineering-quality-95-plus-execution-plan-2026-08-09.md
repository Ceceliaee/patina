# Patina 架构与工程质量 95+ 可勾选执行方案（已完成归档）

> 状态：已完成并归档
> 创建日期：2026-08-09
> 文档类型：How-to / 阶段性执行计划
> 适用对象：Patina 维护者、后续实现代理、代码审查者
> 执行结果：95 / 100
> 目标：在本计划明确的审计范围内，以可复核证据达到 95 / 100 或以上

## 1. 文档目的

本计划把已有架构、工程质量、测试、重复代码和死代码审查结论转换成可以逐项执行、逐项验收、逐项回滚的工作清单。

本计划不以“完成了多少任务”作为质量证明。95+ 只能由以下事实共同成立后得出：

1. 已确认的高风险缺陷已被修复；
2. 修复后的行为由正确 owner 下的测试证明；
3. 重复实现和无效接口被减少，而不是换一种方式隐藏；
4. 默认门禁能够阻止同类问题回归；
5. 完整验证结果可由其他维护者复现。

## 2. 范围与非范围

### 2.1 本计划包含

- 已确认的存储迁移路径身份和写探针问题；
- WebDAV 传输策略、凭据 profile 隔离和原生凭据释放问题；
- Data 热力图失败状态和启动预热竞态；
- 源码字符串测试过度、覆盖分母偏窄和 mutation 风险覆盖不足；
- 已确认的失效 CSS、多余导出和重复实现；
- Data 等热点缺少增长预算的问题；
- 将本轮改进固化为持续质量门禁；
- 完整本地验证、证据记录和重新评分。

### 2.2 本计划明确不包含

以下工作已经决定延期，不能因为本计划达到 95+ 就宣称它们已经完成：

- 全文件操作故障注入和断电恢复矩阵；
- 历史版本数据库和备份逐级升级矩阵；
- 完整渗透测试、DNS rebinding 和恶意服务端测试；
- 长时间运行、百万级真实数据和系统资源耐久测试；
- 安装、升级、降级、卸载的完整机器矩阵；
- UNC、网络盘、OneDrive、不同文件系统的完整 Windows 矩阵；
- 全量无障碍人工审查和视觉截图矩阵。

因此，本计划的 95+ 表示“当前已审范围内的架构与工程质量评分”，不是全局发布安全认证。

## 3. 如何使用这份计划

### 3.1 勾选规则

- `[ ]`：尚未开始，或没有足够证据；
- `[~]`：Markdown 不支持的中间状态不要写入文档；进行中状态应在 Project 中由维护者维护；
- `[x]`：实现、测试、验证和证据记录全部完成；
- 只有代码存在、测试通过、验收条件满足三者同时成立时才能勾选；
- 仅有提交、PR、截图或口头确认不能替代验收证据；
- 发现新的 P1/P2 时，停止提高评分，先把问题加入对应阶段；
- 每完成一个阶段，重新运行该阶段要求的最小验证，不等待最后统一补测。

### 3.2 每个任务的证据格式

完成任务后，在任务下追加：

```text
证据：
- 代码：<文件和关键行>
- 测试：<测试名称和测试文件>
- 命令：<实际运行命令>
- 结果：<通过数量、关键输出或失败说明>
- 审查：<owner、边界和回滚点确认>
```

### 3.3 Project 与 Git 规则

- [x] 执行前确认本计划是否映射到现有 GitHub Project item；若映射，读取 live Project，但不替维护者拖动状态。
- [x] 每次开始、完成、阻塞或解除阻塞时，报告应由维护者执行的 Board 状态和 `Next` 窗口调整。
- [x] 未经明确请求，不创建分支、不创建 PR、不推送远端。
- [x] 本计划中的“建议提交”只是拆分建议，不构成提交或推送授权。
- [x] 每次提交前检查 `git diff --cached --stat` 和 `git diff --cached --numstat`。
- [x] 手工维护内容超过 1,000 行变更或 25 个文件时，按 owner 和行为拆分提交。

## 4. 第一性原理

质量工作的判断顺序必须固定。后面的目标不能牺牲前面的目标：

1. **数据正确性**：不能丢失、覆盖、重复或误删用户数据；
2. **安全边界**：凭据和用户数据不能通过不安全传输或错误 profile 泄露；
3. **失败可恢复性**：错误必须显式、可重试，不能永久 loading 或留下半完成状态；
4. **owner 清晰度**：能力必须放在真实 owner 下，不能为了去重制造万能 shared；
5. **测试信号质量**：测试应证明合同，而不是锁定文本、函数名和排版；
6. **维护成本**：减少重复、接口面和热点增长；
7. **性能与发布可信度**：改进不能损害启动、交互、包体和发布一致性；
8. **视觉一致性**：UI 改动继续服从 Quiet Pro，不因工程重构改变产品行为。

任何“代码更少”“抽象更多”“覆盖率更高”的方案，如果降低前四项，应直接拒绝。

## 5. 评分模型与硬门槛

### 5.1 当前基线

| 维度 | 权重 | 当前得分 | 主要扣分原因 |
|---|---:|---:|---|
| 数据正确性与数据安全 | 20 | 11 | 路径别名、固定写探针、破坏性清理前缺少最终身份复核 |
| 安全与权限 | 15 | 9 | HTTP WebDAV、凭据跨 profile、`CredFree` 提前返回 |
| 架构与 owner 边界 | 15 | 13 | 主体结构健康，少量重复 owner 和过宽导出面 |
| 可靠性与状态机 | 15 | 11 | Data 拒绝未处理、启动预热竞态 |
| 测试与验证信号 | 15 | 13 | 门禁强，但源码字符串测试过多、覆盖分母偏窄 |
| 可维护性与债务 | 10 | 8 | 重复函数、失效 CSS、多余导出、热点缺少预算 |
| 性能与发布工程 | 10 | 9 | 性能与运行时证据充分，但稳定基准不在持续门禁 |
| **合计** | **100** | **74** |  |

### 5.2 95+ 最低目标

| 维度 | 95+ 最低得分 | 必要结果 |
|---|---:|---|
| 数据正确性与数据安全 | 19 / 20 | 所有已知破坏性路径关闭，回归测试覆盖 |
| 安全与权限 | 14 / 15 | 远端 HTTPS、凭据隔离、原生资源安全释放 |
| 架构与 owner 边界 | 14 / 15 | 无新增边界倒退，去重按真实 owner 落位 |
| 可靠性与状态机 | 14 / 15 | 失败、取消、重试和过期请求均显式处理 |
| 测试与验证信号 | 14 / 15 | 源码文本过拟合显著减少，高风险 owner 具有直接证据 |
| 可维护性与债务 | 10 / 10 | 确认的死 CSS、重复和多余接口已清理并防回退 |
| 性能与发布工程 | 10 / 10 | 构建、包体、运行时烟测、依赖和稳定性能全部通过 |
| **合计** | **95 / 100** |  |

### 5.3 硬性封顶条件

- [x] 不存在未关闭的已知 P1；否则总分最高 79。
- [x] 不存在影响核心页面、数据写入或后台状态机的未关闭 P2；否则总分最高 89。
- [x] `npm run check:full` 的等价完整门禁通过；否则总分最高 84。
- [x] 真实浏览器和真实 Tauri runtime smoke 通过；否则总分最高 89。
- [x] 没有通过扩大 allowlist、降低阈值或删除有效测试来制造通过结果；否则不得重新评分。
- [x] 每个已修复问题都存在至少一个修复前会失败、修复后会通过的测试。
- [x] 所有新增共享能力均完成 owner 审查；存在万能 bucket 或跨层倒置时总分最高 94。

## 6. 当前验证基线

开始实现前，保留以下已有事实，不重复把它们当作新成果计分：

- 前端生产构建与 bundle budget 已通过；
- 82 个真实浏览器 smoke 已通过；
- 真实 Tauri/WebView2/IPC/SQLite runtime smoke 已通过；
- Rust 606 个测试通过、1 个有理由的 ignored；
- Rust fmt、boundary、Clippy `-D warnings` 已通过；
- 依赖审计为 0 个 Windows 可达漏洞；
- 7 组稳定性能基准各运行 5 次并通过；
- TypeScript 覆盖率报告为行 96.3%、函数 92.85%、分支 89.88%，但只覆盖 9 个指定 owner；
- 默认测试入口不存在重复执行；
- 运行时 TS/TSX 文件全部可从 `main.tsx` 到达；
- 没有确认的大面积可执行死代码或未引用资产；
- 本地 `main` 比 `origin/main` 超前 29 个提交，远端 CI 不能代表当前本地状态。

## 7. 阶段 0：冻结基线和执行边界

### 目标

让后续每次变更都能与同一基线比较，避免一边修复、一边改变评分口径。

### 执行步骤

- [x] Q95-0.1 运行 `git status --short --branch`，记录当前分支、ahead/behind 和工作区状态。
- [x] Q95-0.2 识别用户已有未提交改动；任何非本计划改动都保持原样，不纳入整理。
- [x] Q95-0.3 运行 `node --experimental-strip-types scripts/check-test-suite-governance.ts --report`，保存当前测试入口数量。
- [x] Q95-0.4 运行 `npm run quality:hotspots`，记录 Data、History、CSS、测试文件和 Rust owner 的当前结构指标。
- [x] Q95-0.5 保存 `artifacts/coverage/coverage-summary.json` 的当前指标，仅作为比较基线，不提交生成物。
- [x] Q95-0.6 将第 5 节评分表复制到执行记录区，所有加分必须引用具体证据。
- [x] Q95-0.7 确认本轮不顺带处理延期审计事项，除非实现过程中发现它们直接阻塞已确认问题。

### 验收条件

- [x] 基线命令能够在当前机器重复运行。
- [x] 工作区无来源不明的变更。
- [x] 每个阶段的 owner、验证命令和回滚点已经明确。

## 8. 阶段 1：关闭存储迁移 P1

### 8.1 真实路径身份与重叠校验

#### 第一性问题

路径字符串不同不代表文件系统对象不同。任何破坏性操作都必须基于解析后的身份，而不是仅依赖 `Path::starts_with`、大小写折叠或斜杠替换。

#### 执行步骤

- [x] Q95-1.1 在 `src-tauri/src/data/storage_migration.rs` 的现有测试模块中先增加失败用例。
- [x] Q95-1.2 覆盖包含 `.`、`..`、尾部分隔符和大小写变化的等价目标路径。
- [x] Q95-1.3 增加“目标解析后等于当前数据目录”的拒绝用例。
- [x] Q95-1.4 增加“目标解析后位于当前目录内部或上方”的拒绝用例。
- [x] Q95-1.5 在 Windows 下增加 reparse point/junction 用例；若测试环境无法安全创建，必须把限制写入测试理由，并至少对生产路径实施 fail-closed 拒绝。
- [x] Q95-1.6 设计一个 owner 明确的路径身份函数：解析最近存在的祖先、规范化剩余尾部、识别 reparse point，并返回可比较身份。
- [x] Q95-1.7 不把路径工具放入泛化 `shared`；它应属于 Rust `platform` 文件系统边界，或保持为 storage migration 私有能力。
- [x] Q95-1.8 在 preview/schedule、重启后执行前、最终清理前分别复核路径身份。
- [x] Q95-1.9 在 `clean_old_data_payload` 前再次确认源和目标不指向同一真实目录；失败时保留两边数据并记录维护错误。
- [x] Q95-1.10 确保任何无法规范化、无法读取 metadata 或遇到未知 reparse 行为的情况都 fail closed。

#### 验收条件

- [x] 所有词法等价路径被识别为相同路径。
- [x] junction/reparse 不能绕过重叠校验。
- [x] 清理函数不可能在身份未确认时删除旧数据。
- [x] 正常自定义路径和恢复默认路径仍然通过。

### 8.2 无破坏写权限探针

#### 第一性问题

“检查目录是否可写”不能改变任何预先存在的用户数据。

#### 执行步骤

- [x] Q95-1.11 先增加“目录中已存在 `.patina-write-probe`，内容和文件仍完整”的失败测试。
- [x] Q95-1.12 生成不可预测的 probe 名称，至少包含进程、时间或安全随机后缀。
- [x] Q95-1.13 使用 `OpenOptions::create_new(true)`，禁止截断现有文件。
- [x] Q95-1.14 为 probe 创建 RAII guard，正常返回、错误返回和 panic unwind 时都只清理自己创建的文件。
- [x] Q95-1.15 若名称碰撞，生成新名称或返回明确错误，绝不打开既有文件。
- [x] Q95-1.16 写入、flush、关闭并删除 probe；任何阶段失败都返回可诊断错误。
- [x] Q95-1.17 数据目录和 WebView cache 目录复用同一安全 probe owner，不保留两份实现。

#### 验收条件

- [x] 既有同名文件不会被打开、截断或删除。
- [x] probe 残留只可能来自无法删除且已明确报告的文件。
- [x] 数据和 cache 的 probe 语义完全一致。

### 阶段验证

- [x] `cargo test --manifest-path src-tauri/Cargo.toml --locked storage_migration`
- [x] `npm run check:rust`
- [x] `npm run test:tauri-runtime-smoke`
- [x] 人工检查所有 `remove_dir_all`、`remove_file`、rename 和 anchor 切换调用是否位于身份校验之后。

### 回滚点

- 路径身份与 probe 分成两个独立提交；任一回滚不能恢复固定文件名覆盖行为。
- 如果 junction 兼容策略不明确，保持拒绝迁移，不回退到词法放行。

## 9. 阶段 2：关闭 WebDAV 和凭据 P1

### 9.1 传输策略

#### 第一性问题

Basic Auth 的安全性完全依赖 TLS。允许任意远端 HTTP 等同于允许凭据和备份流量明文传输。

#### 执行步骤

- [x] Q95-2.1 为配置规范化增加非 loopback HTTP 被拒绝的测试。
- [x] Q95-2.2 明确允许策略：远端只允许 HTTPS；如确需本机开发，HTTP 仅允许经过严格判断的 loopback。
- [x] Q95-2.3 不把任意 `localhost` 字符串直接当成可信远端；策略必须基于明确 host/IP 规则并记录限制。
- [x] Q95-2.4 `platform/webdav.rs` 和 `remote_backup_settings.rs` 使用同一 URL 策略 owner，避免保存时允许、请求时拒绝或相反。
- [x] Q95-2.5 已保存的不安全远端配置不得静默继续运行；加载后显示明确错误并停止自动任务。
- [x] Q95-2.6 不自动删除用户配置或凭据，给用户修改地址的恢复路径。
- [x] Q95-2.7 Settings UI 在保存和测试连接时展示同一安全错误，不使用模糊“连接失败”吞掉策略原因。
- [x] Q95-2.8 保持 `Policy::none()`，继续禁止携带凭据自动跟随重定向。

#### 验收条件

- [x] 公网或局域网非 loopback HTTP 无法保存、测试或执行。
- [x] HTTPS 行为保持兼容。
- [x] 不安全旧配置进入显式可恢复失败状态。

### 9.2 profile 隔离和原生资源释放

#### 执行步骤

- [x] Q95-2.9 将 Credential Manager target 从固定 `default` 改为包含稳定 `AppProfile::key()` 的 target。
- [x] Q95-2.10 让凭据 API 接收 `AppHandle`、profile 或已经解析的 credential target，不在底层猜测 profile。
- [x] Q95-2.11 Production 可以读取一次旧 target 并迁移到 production target；Local 和 Dev 禁止继承 production 旧凭据。
- [x] Q95-2.12 旧凭据迁移必须先写入新 target、读回验证，再删除旧 target。
- [x] Q95-2.13 为 `CredReadW` 返回指针增加 RAII guard，保证 UTF-8 错误和所有提前返回都会调用 `CredFree`。
- [x] Q95-2.14 密码临时 buffer 在 API 返回后尽可能清零；若增加依赖，先完成依赖和 owner 审查。
- [x] Q95-2.15 增加纯函数测试，证明 production/local/dev target 唯一且稳定。
- [x] Q95-2.16 增加 Windows 条件测试或隔离 runtime smoke，证明三个 profile 不互相读写或删除。

#### 验收条件

- [x] 三个 profile 使用三个不同 target。
- [x] Local/Dev 不能读取 production secret。
- [x] 任意凭据解析失败都释放系统内存。
- [x] Production 旧凭据迁移不造成密码丢失。

### 阶段验证

- [x] `cargo test --manifest-path src-tauri/Cargo.toml --locked webdav`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --locked credentials`
- [x] `npm run check:rust`
- [x] `npm run test:tauri-runtime-smoke`
- [x] `npm run check:dependencies`

## 10. 阶段 3：修复可靠性和状态机

### 10.1 Data 热力图失败状态

#### 第一性问题

异步读取必须拥有完整状态机：请求开始、成功、失败、取消、过期。`finally` 只结束 loading，不能表达失败；无 `catch` 会把失败变成未处理拒绝。

#### 执行步骤

- [x] Q95-3.1 为年度热力图和 destination 热力图定义明确状态：`idle | loading | ready | failed`。
- [x] Q95-3.2 状态中保留上一次可信数据、错误种类、请求 key/revision 和 retry 入口。
- [x] Q95-3.3 先增加 service/component 测试：首次加载失败时离开 loading 并显示可重试错误。
- [x] Q95-3.4 增加已有缓存刷新失败测试：保留旧数据并显示“更新失败，显示上次结果”。
- [x] Q95-3.5 增加 retry 成功测试：错误清除、数据更新、loading 结束。
- [x] Q95-3.6 增加过期请求测试：旧年份请求晚到时不能覆盖新选择。
- [x] Q95-3.7 所有 fire-and-forget Promise 在 owner 内部消化拒绝，不依赖全局 unhandled rejection。
- [x] Q95-3.8 非 web 和 web 路径使用一致的失败语义，但不强行共享不同的数据请求状态机。
- [x] Q95-3.9 增加真实浏览器场景，模拟 SQLite 读取拒绝和恢复。

#### 验收条件

- [x] 任意读取失败都不会永久 loading。
- [x] 控制台没有未处理 Promise rejection。
- [x] 缓存数据在刷新失败时继续可信展示。
- [x] retry 和过期请求均有直接测试。

### 10.2 启动预热 controller 所有权

#### 执行步骤

- [x] Q95-3.10 为每次 warmup 创建唯一 controller identity。
- [x] Q95-3.11 `.finally` 只有在全局 active 仍指向当前 controller 时才能清空。
- [x] Q95-3.12 `cancel()` 只取消当前实例，不得清除之后启动的新实例。
- [x] Q95-3.13 增加确定性测试：A 启动、A 取消、B 启动、A 完成，active 仍为 B。
- [x] Q95-3.14 增加第三次 start 测试：B 运行时 C 必须复用 B，不能并发启动。
- [x] Q95-3.15 增加 B 完成后的重新启动测试，证明单例最终能够正常释放。
- [x] Q95-3.16 保持 warmup 失败为非致命，不让预热错误阻断主界面。

#### 验收条件

- [x] cancel/restart 不会清除新 controller。
- [x] 同一时间最多一个有效 warmup。
- [x] StrictMode/remount 顺序下没有重复重任务。

### 阶段验证

- [x] `npm run test:data`
- [x] `npm run test:warmup`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run check:types`
- [x] `npm run check:lint`

## 11. 阶段 4：重新平衡测试体系

### 11.1 处置源码读取测试

#### 第一性问题

测试应该证明外部合同。源码文本只能证明某段文本仍存在，既可能阻止安全重构，也可能在行为已经错误时继续通过。

#### 执行步骤

- [x] Q95-4.1 列出 `tests/uiSmoke.test.ts` 中全部 54 个测试，并给每个测试标记唯一类别：行为、架构、样式 owner、IPC、数据安全、SSR、i18n。
- [x] Q95-4.2 对 51 个读取源码的测试逐项选择：迁移到 owner 测试、迁移到 AST checker、由浏览器测试替代、或保留并写明不可替代原因。
- [x] Q95-4.3 用户可见行为只由真实浏览器或组件行为测试负责；删除对应源码 regex 断言。
- [x] Q95-4.4 IPC 注册只由 `check-ipc-contracts` 负责；删除 `importDataContract.test.ts` 中逐命令匹配 bootstrap 文本的重复测试。
- [x] Q95-4.5 Rust SQL 所有权和破坏性行为放回 Rust repository/data 测试；禁止用 `doesNotMatch(/DELETE FROM .../)` 代替行为验证。
- [x] Q95-4.6 Quiet Pro owner 和共享组件合同放入结构化 style/architecture checker；不再在 UI smoke 中匹配类名排版。
- [x] Q95-4.7 保留真正有价值的 SSR 启动测试、语言结构合同和无法从外部观察的少量稳定结构合同。
- [x] Q95-4.8 扩展 test governance：未经精确 allowlist，不允许测试直接读取 `src/` 或 `src-tauri/src/` 后做文本断言。
- [x] Q95-4.9 allowlist 每项必须包含 owner、理由和退出条件；不得使用目录级宽泛正则。
- [x] Q95-4.10 迁移完成后重新统计源码读取测试数量；目标为“零个未解释源码读取测试”，而不是追求任意绝对数量。

#### 验收条件

- [x] 每个被删除的静态断言都有更强证据，或被证明没有独立价值。
- [x] 等价重命名或移动 owner 不再造成无行为变化的测试失败。
- [x] Test governance 能阻止重新添加未经批准的源码字符串测试。

### 11.2 调整覆盖率和 mutation 风险权重

#### 执行步骤

- [x] Q95-4.11 将 Data 热力图状态、startup warmup、存储前端 gateway 等新高风险 TS owner纳入 per-file coverage。
- [x] Q95-4.12 对新增 owner 采用 90/85/90/90 的行、分支、函数、语句最低值，或记录无法达到的具体不可执行分支。
- [x] Q95-4.13 不通过移除 `--all`、缩小 include 或排除失败文件提高覆盖率。
- [x] Q95-4.14 为路径身份、probe、HTTP 策略、profile target、请求过期和 controller identity 增加 mutation 等价反证。
- [x] Q95-4.15 mutation 数量不作为目标；每个 mutant 必须对应一个真实可发生的错误实现。
- [x] Q95-4.16 评估并记录 Rust coverage 工具链；若当前轮不引入工具，至少输出高风险 owner 的测试矩阵和每个分支的直接测试名称。
- [x] Q95-4.17 保持 browser smoke 与 runtime smoke 独立，不把重型测试重复加入 `npm test`。

#### 验收条件

- [x] 已确认的六类核心缺陷都存在修复前失败的测试。
- [x] 覆盖率分母扩大后仍通过门禁。
- [x] 默认门禁继续保证每个确定性测试只执行一次。

## 12. 阶段 5：清理死代码和接口冗余

### 12.1 确认的失效 CSS

#### 执行步骤

- [x] Q95-5.1 删除或修正未被组件使用的 `settings-theme-entry-active`、description、subview、subview-header、subview-back。
- [x] Q95-5.2 删除未使用的 `settings-local-paths-message-action`。
- [x] Q95-5.3 将错误的 `.qp-select` 后代选择器核对为实际 `.qp-select-root`/`.qp-select-trigger`；只保留能匹配真实 DOM 的规则。
- [x] Q95-5.4 删除未使用的 `tools-mode-toolbar` 和 `tools-mode-description`。
- [x] Q95-5.5 删除未使用的 `history-horizontal-timeline-lane`。
- [x] Q95-5.6 对动态 tone、placement 和 status 类保持谨慎；`qp-badge-*`、widget status、popover placement 不因静态扫描假阳性删除。
- [x] Q95-5.7 运行浏览器场景并检查 Settings、Tools、History 的默认/hover/active/focus/disabled 状态。

### 12.2 收窄 TypeScript 导出面

#### 执行步骤

- [x] Q95-5.8 重新生成 79 个 internal-only value export、180 个 internal-only type export 和 94 个 test-consumed export 清单。
- [x] Q95-5.9 对只在本文件使用的声明移除 `export`，不删除其运行时行为。
- [x] Q95-5.10 对只因测试而导出的内部函数，优先改测公开行为；确需保留时使用明确 `ForTests`/`__...Internals` 命名。
- [x] Q95-5.11 动态 import 的 named export 必须由 TypeScript language service 复核，不能依据现有 advisory regex 直接删除。
- [x] Q95-5.12 每批只处理一个 owner，运行对应测试和 `check:types` 后再继续。
- [x] Q95-5.13 不删除任何只有一次运行时调用但 owner 清晰的函数；低调用量不等于死代码。

#### 验收条件

- [x] internal-only export 数量显著下降，剩余项均有理由。
- [x] 没有新增 barrel file 或兼容 shell 掩盖导出问题。
- [x] 所有动态 import 和 lazy route 继续构建成功。

## 13. 阶段 6：低风险重复代码合并

### 13.1 直接复用已有 owner

- [x] Q95-6.1 `sessionReadRepository.ts` 复用 `appIconRuntimeCache.ts` 的 `resolveAppIconKeys`，删除复制实现。
- [x] Q95-6.2 Dashboard 和 History 的 executable 去重逻辑收归稳定的图标/会话辅助 owner，保留输入类型差异。
- [x] Q95-6.3 classification icon alias 写入复用同一键解析，不再维护并行算法。

### 13.2 稳定跨 feature 能力

- [x] Q95-6.4 将 `minDate`、`maxDate`、`countInclusiveLocalDays`、`getIsoWeek` 收归 `shared/lib/localDateRange.ts` 或扩展现有 `localDate.ts`。
- [x] Q95-6.5 Data range 和 Settings export range 使用同一日期实现，并保留各自的业务选择状态机。
- [x] Q95-6.6 将 `stableDomainColor` 和唯一调色板收归 shared classification color owner。
- [x] Q95-6.7 合并完全相同的 executable fallback display name 算法。
- [x] Q95-6.8 为这些 shared 能力增加直接单元测试；消费 feature 不重复测试算法内部细节。

### 13.3 feature 内共享

- [x] Q95-6.9 将 `minutesToTime`、`timeToMinutes`、`formatDateTime`、`formatSize` 收归 `features/settings/services/scheduledTaskPresentation.ts`。
- [x] Q95-6.10 Backup 和 Scheduled Export 对话框只共享展示原语，不共享 target、format、fields 和错误状态机。
- [x] Q95-6.11 Destination 内两个时间显示组件共享 feature-owned `formatTime`。
- [x] Q95-6.12 Data trend/web snapshot 的 LRU touch 逻辑抽取为 data feature 私有缓存原语。

### 13.4 边界守卫与浏览器存储

- [x] Q95-6.13 盘点 12 个 `isRecord` 的数组语义，分别命名为 `isPlainRecord` 和 `isObjectRecord`，禁止模糊合并。
- [x] Q95-6.14 合并完全相同的 `isFiniteNumber`、`isNullableString`、`isStringArray`。
- [x] Q95-6.15 建立稳定的 browser storage gateway，统一 SSR、SecurityError 和 localStorage 不可用处理。
- [x] Q95-6.16 feature preference service 继续拥有 key、默认值和数据迁移，不把业务语义放进 storage gateway。

### 13.5 测试辅助代码

- [x] Q95-6.17 评估用 Node `node:test` 替代 32 份自定义 `runTest`；若暂不迁移，至少提供一个统一 runner。
- [x] Q95-6.18 复用 `tests/helpers/trackingTestHarness.ts` 的 canonical session builder，删除无差异的 `makeSession`。
- [x] Q95-6.19 合并 localStorage/window 生命周期测试 helper，并保证测试后恢复全局状态。
- [x] Q95-6.20 Rust 只在 schema 和生命周期一致时共享 in-memory SQLite fixture；不同 repository 的最小 schema 测试保持独立。

### 不得执行的合并

- [x] Q95-6.21 不建立万能 `clamp`；不同异常、NaN 和边界语义保持在 owner 内。
- [x] Q95-6.22 不把 Data、History、Destination 合并成配置驱动的万能页面组件。
- [x] Q95-6.23 不把 backup/export 的完整执行流程合并成一个泛型状态机。
- [x] Q95-6.24 不把每张表的 restore repository 合并成动态 SQL 万能 repository。
- [x] Q95-6.25 不重新引入 `src/lib/`、`src/types/` 或无 owner 的 Rust shared bucket。

### 阶段验证

- [x] 每个去重前先运行对应测试，建立行为基线。
- [x] 每个去重后运行对应 owner 测试、`check:types` 和 `check:architecture`。
- [x] 阶段结束运行 `npm run test`、`npm run build` 和 `npm run check:bundle`。

## 14. 阶段 7：受控 Rust 架构整合

本阶段涉及新共享能力和跨 owner 调整，必须先做边界判断，不能与小型去重混在同一提交。

### 14.1 时间能力

- [x] Q95-7.1 盘点 26 个 `now_ms()` 的返回类型、错误处理和测试注入需求。
- [x] Q95-7.2 对纯平台 wall clock 提供明确的 `unix_millis_i64` / `unix_millis_u64`。
- [x] Q95-7.3 domain 决策继续接收 `now_ms` 参数，不直接依赖 platform clock。
- [x] Q95-7.4 需要可控时间的 engine/data 服务继续使用注入 clock，不因去重降低可测试性。
- [x] Q95-7.5 删除重复函数后运行 tracking、tools、backup、export、updater 和 Windows platform 测试。

### 14.2 Scheduled Backup / Export app 协调层

- [x] Q95-7.6 对比 `app/scheduled_backup.rs` 和 `app/scheduled_export.rs`，只提取约 89.7% 相同的协调生命周期。
- [x] Q95-7.7 新 owner 放在 `app` 内，负责 get/save/run/tick/lock/reset/emit 的组合，不接管 data 业务。
- [x] Q95-7.8 backup/export 保留独立公开入口和独立错误类型。
- [x] Q95-7.9 提取 domain cadence 原语前，先证明 `latest_due_slot`、`next_slot_after`、weekday 规则完全同义。
- [x] Q95-7.10 repository 只共享稳定的 run lifecycle 映射；不同表、字段和恢复语义保持独立。
- [x] Q95-7.11 data execution、远端上传、本地文件发布和导出格式保持不同 owner。
- [x] Q95-7.12 为共享协调层增加一套合同测试，backup/export 各自保留业务测试。

### 停止条件

出现以下任一情况时停止本阶段，不继续泛型化：

- [x] 需要运行时字符串选择表名或命令；
- [x] 泛型参数数量超过它减少的业务分支；
- [x] 错误信息开始失去 backup/export 的具体语义；
- [x] 测试必须同时构造两个领域的大量无关字段；
- [x] 新模块成为 app/data/engine/platform 的共同 bucket。

## 15. 阶段 8：热点预算和持续防回退

### 执行步骤

- [x] Q95-8.1 将 `src/features/data/components/Data.tsx` 加入 hotspot baseline，记录 lines、AST、branches、hooks、effects、owners 和最大函数复杂度。
- [x] Q95-8.2 初始预算不得高于当前实际值加任意宽松余量；若本轮已降低，预算使用降低后的值。
- [x] Q95-8.3 将 startup warmup、Settings schedule owner 和新的共享边界加入 advisory 或硬门禁，按风险选择。
- [x] Q95-8.4 为源码读取测试数量增加治理报告和精确 allowlist 检查。
- [x] Q95-8.5 为 internal-only export 增加 advisory 报告，先报告再决定是否硬门禁。
- [x] Q95-8.6 改进 unused export 检测，使其理解 dynamic import、type import 和 alias，禁止使用现有正则候选作为自动删除依据。
- [x] Q95-8.7 保持完整 `perf:stable` 为发布/高风险变更验证；在默认 CI 中加入足够轻量且稳定的性能哨兵。
- [x] Q95-8.8 CI Action 逐步固定到 commit SHA；更新流程保留明确的版本审查点。
- [x] Q95-8.9 不降低 bundle budget、coverage threshold 或 hotspot budget 来换取绿色。

### 验收条件

- [x] 同类源码读取测试无法未经说明重新进入。
- [x] Data 热点不能无预算增长。
- [x] 动态 import 不再被 unused export 报告误判。
- [x] 性能和包体回退能在合并前被发现。

## 16. 阶段 9：完整验证和重新评分

### 16.1 最小完整命令集

按顺序执行并记录完整结果：

- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run test:mutation`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run build`
- [x] `npm run check:bundle`
- [x] `npm run check:rust`
- [x] `npm run check:dependencies`
- [x] `npm run test:tauri-runtime-smoke`
- [x] `npm run perf:stable`
- [x] `npm run check:full`

如沙箱因 `spawn EPERM` 或原生 Node binding 无法运行，应在获得批准后于沙箱外重跑同一命令。环境失败不能记为代码通过，也不能记为代码失败。

### 16.2 结果核对

- [x] TypeScript/Rust 测试无失败、无未经批准的 skip/ignore。
- [x] Coverage 分母包含新增高风险 owner，阈值没有降低。
- [x] Mutation 覆盖所有已确认错误模式。
- [x] Browser smoke 没有 console error、unhandled rejection 或永久 loading。
- [x] Tauri runtime smoke 证明真实窗口、IPC、SQLite 和 capability 正常。
- [x] Bundle 各预算未回退。
- [x] Perf stable 与 2026-08-09 基线比较，无无法解释的显著回退。
- [x] Dependency audit 无可达漏洞。
- [x] `git status --short --branch` 只包含本计划预期改动。

### 16.3 人工代码审查

- [x] 所有破坏性文件操作前都有最终目标身份检查。
- [x] 所有凭据读取路径都有 RAII 释放。
- [x] 所有 fire-and-forget Promise 都有拒绝 owner。
- [x] 所有 singleton/全局 controller 的清理都检查实例身份。
- [x] 所有 shared 能力都有至少两个稳定消费者，且语义一致。
- [x] 没有为了减少重复而制造跨 feature 私有实现依赖。
- [x] Quiet Pro UI 行为和产品范围未改变。

## 17. 95+ Definition of Done

只有下列全部勾选后，才允许重新评分为 95+：

### 正确性与安全

- [x] 路径别名和 reparse 无法绕过存储迁移重叠校验。
- [x] 写权限 probe 不接触任何既有文件。
- [x] 破坏性清理前进行最终路径身份复核。
- [x] 远端 WebDAV 强制 HTTPS，只有明确 loopback 策略可以使用 HTTP。
- [x] production/local/dev 凭据完全隔离。
- [x] Credential Manager 分配在所有返回路径释放。

### 可靠性

- [x] Data 热力图失败、缓存失败、重试和过期请求均有状态和测试。
- [x] 启动预热 cancel/restart 竞态关闭。
- [x] 没有已知核心 P2。

### 测试信号

- [x] 51 个源码读取测试全部完成分类和处置。
- [x] 没有未经解释的源码文本合同测试。
- [x] 高风险 owner 已进入直接 coverage/mutation 或明确测试矩阵。
- [x] 默认门禁无重复执行。

### 维护性

- [x] 确认的失效 CSS 已清理。
- [x] internal-only 导出已收窄，剩余项有理由。
- [x] 高价值复制实现已合并到正确 owner。
- [x] Data 和新增共享能力拥有 hotspot 防回退预算。
- [x] 没有新增万能 shared、compatibility shell 或动态 SQL 抽象。

### 完整验证

- [x] 第 16.1 节所有命令通过。
- [x] 第 5.3 节所有硬性封顶条件解除。
- [x] 第 5.2 节各维度均达到最低得分。
- [x] 重新评分附带逐项证据，不使用主观“感觉更好”。

## 18. 建议提交拆分

这些是未来得到提交授权后的建议，不构成当前提交或推送授权：

1. `fix(storage): harden migration path identity`
2. `fix(storage): make write probes non-destructive`
3. `fix(backup): require secure WebDAV transport`
4. `fix(credentials): isolate WebDAV secrets by profile`
5. `fix(data): model heatmap failures explicitly`
6. `fix(app): preserve warmup controller ownership`
7. `test(quality): rebalance source contract coverage`
8. `refactor(frontend): consolidate stable shared helpers`
9. `refactor(rust): centralize stable time and schedule coordination`
10. `chore(quality): enforce hotspot and export governance`
11. `docs(quality): record 95-plus acceptance evidence`

每个提交应满足：

- 主题单一；
- 能独立解释；
- 尽可能独立验证；
- 不使用 issue-closing keyword；
- 如关联 Issue，在提交正文单独写 `Refs #<number>`；
- 未获明确授权不推送。

## 19. 回滚原则

- [x] 每个 P1 修复独立提交，避免与大规模重构绑定。
- [x] 回滚抽象时保留安全行为和回归测试。
- [x] 不使用 `git reset --hard` 或覆盖用户工作区。
- [x] UI 重构可回滚到旧组件，但不能恢复已证明错误的失败状态或安全策略。
- [x] 数据迁移代码只允许回滚到“更保守地拒绝”，不能回滚到“可能破坏性放行”。
- [x] WebDAV 兼容问题只允许回滚 UI 提示，不允许恢复任意远端 HTTP。

## 20. 执行记录

### 阶段状态

- [x] 阶段 0：冻结基线和执行边界
- [x] 阶段 1：关闭存储迁移 P1
- [x] 阶段 2：关闭 WebDAV 和凭据 P1
- [x] 阶段 3：修复可靠性和状态机
- [x] 阶段 4：重新平衡测试体系
- [x] 阶段 5：清理死代码和接口冗余
- [x] 阶段 6：低风险重复代码合并
- [x] 阶段 7：受控 Rust 架构整合
- [x] 阶段 8：热点预算和持续防回退
- [x] 阶段 9：完整验证和重新评分

### 评分记录

| 日期 | 数据安全 /20 | 安全 /15 | 架构 /15 | 可靠性 /15 | 测试 /15 | 维护性 /10 | 性能发布 /10 | 总分 | 证据 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 2026-08-09 | 11 | 9 | 13 | 11 | 13 | 8 | 9 | 74 | 初始对抗式审查 |
| 2026-08-10 | 19 | 14 | 14 | 14 | 14 | 10 | 10 | **95** | 见下方“执行证据”；分数只适用于第 2 节已审范围 |

### 新发现记录

| ID | 严重度 | 发现 | owner | 处理阶段 | 状态 |
|---|---|---|---|---|---|
| Q95-N1 | P1 | 存储迁移可被真实路径别名/重叠关系绕过，且固定探针可能接触既有文件 | `data/storage_migration` | 阶段 1 | 已关闭 |
| Q95-N2 | P1 | WebDAV 可使用非 loopback HTTP，凭据 target 未按 profile 隔离，原生分配存在提前返回释放风险 | `platform/webdav`、`platform/credentials` | 阶段 2 | 已关闭 |
| Q95-N3 | P2 | Data 热力图拒绝路径可能永久 loading，旧请求可能覆盖新请求 | `features/data` | 阶段 3 | 已关闭 |
| Q95-N4 | P2 | 已取消的旧 startup warmup 可清除新的 active controller | `app/startup warmup` | 阶段 3 | 已关闭 |
| Q95-N5 | P2 | 两个已无前端调用的破坏性 IPC 仍保持注册和权限面 | `commands/persistence`、`data/user_data_maintenance` | 阶段 5/8 | 已关闭 |
| Q95-A1 | P1 | WebView cache 目标可在计划后、重启前被 junction 替换，执行和旧 cache 清理缺少真实身份复核 | `data/storage_migration` | 完成后对抗式审查 | 已关闭 |
| Q95-A2 | P1 | 数据根与 cache 根只做同类比较；组合迁移中 cache 可经 junction 落入待删除的旧数据根 | `data/storage_migration` | 完成后对抗式审查 | 已关闭 |
| Q95-A3 | P1 | 预先放置的 migration staging reparse point 缺少显式 fail-closed 删除策略 | `data/storage_migration_cleanup` | 完成后对抗式审查 | 已关闭 |
| Q95-A4 | P2 | Credential Manager 的零长度/空指针旧 blob 可触发 Rust 空指针 slice 未定义行为 | `platform/credentials` | 完成后对抗式审查 | 已关闭 |
| Q95-A5 | P2 | Data 冷失败退出 loading 后，页面根完成态仍无法结算 | `features/data` | 完成后对抗式审查 | 已关闭 |
| Q95-A6 | P2 | 源码读取治理可被 `readFileSync(resolve("src/..."))` 绕过 | `scripts/check-test-suite-governance` | 完成后对抗式审查 | 已关闭 |

### 执行证据（2026-08-10）

#### 执行边界与版本控制

- 基线和收口时分支均为 `main...origin/main [ahead 29]`；本任务没有创建分支、暂存、提交、推送、PR 或 tag。
- 已核对 live GitHub Project：没有与本计划直接映射的现有 item，因此没有需要维护者拖动的 Board 状态，也没有改变 `Next` 窗口。
- 提交前检查和拆分规则属于本轮 N/A：用户明确要求保留未提交工作区；仍执行了 `git diff --stat`、`git diff --numstat`、`git diff --check` 供人工审阅，其中 `git diff --check` 通过。
- RustSec 本地 advisory cache 曾包含 7 个非索引残留路径并导致同一 advisory 重复解析；它们没有被删除，而是可恢复地移至 `C:\Users\SYBao\.cargo\advisory-db-untracked-backup-20260810`，随后依赖审计通过。

#### P1：数据安全与传输安全

- 路径安全 owner 收归 `src-tauri/src/data/storage_path_safety.rs`：以最近存在祖先的真实身份解析剩余尾部，拒绝等价、父子、junction/reparse 重叠；preview、schedule、重启执行和破坏性清理前均复核，无法确认时 fail closed。
- 写权限探针使用唯一名称、`create_new(true)` 和 RAII guard；写入、flush、关闭、删除均显式检查，既有 `.patina-write-probe` 与并发碰撞测试证明不会打开、截断或删除其他文件。数据目录和 WebView cache 使用同一 owner。
- WebDAV 统一由 `platform/webdav.rs` 判定：远端仅 HTTPS；HTTP 只允许 IP 字面量 loopback，拒绝 `localhost`、非 loopback、嵌入式凭据和非 HTTP(S) scheme；重定向继续使用 `Policy::none()`。
- Credential Manager target 包含稳定 `AppProfile::key()`；只有 Production 可一次性读取旧 target，且迁移顺序为写新值、读回验证、删除旧值。Local/Dev 不读取或删除 Production legacy target。
- `CredReadW` 分配由 RAII guard 在所有返回路径调用 `CredFree`，临时密码字节使用 zeroize；profile target/legacy routing 有纯函数测试，真实 Tauri smoke 验证最终命令注册、capability 和运行时路径可用。

#### P2：可靠性与状态机

- Data 年度和 destination 热力图具备显式 loading/ready/failed 语义；冷失败退出 loading，缓存刷新失败保留可信数据，retry 可恢复，请求 key/revision 阻止过期响应覆盖新选择。真实浏览器场景覆盖 SQLite 拒绝、恢复和无未处理 rejection。
- startup warmup 以 controller identity 管理所有权；旧实例的 `cancel()` 和 `.finally()` 只有仍为 active 时才可清理。确定性测试覆盖 A 取消、B 启动、A 完成、B 复用及完成后再次启动。

#### 测试信号、死代码与复用

- `tests/uiSmoke.test.ts` 从 54 个静态/混合断言缩减为 2 个行为合同；51 个源码读取测试均完成迁移、替代或删除。源码文本治理只保留精确到“测试文件 + 生产文件”的跨语言导出合同例外，并要求 owner、理由和退出条件；当前为 0 个未解释源码读取测试。
- 默认治理报告：45 个顶层测试、43 个 fast 测试、44 个 check 测试、0 个重复入口、0 个失败；唯一 Rust ignore 为明确登记的 `session_range_query_plan_report`，通过 `npm run perf:sqlite-query-plan`/`perf:stable` 单独运行。
- Mutation 从既有集合扩至 27 个真实错误模式，27/27 均被杀死；覆盖路径身份/probe、WebView 执行期/跨根/staging reparse、HTTP、profile target/原生 blob、热力图 stale/retry/冷失败结算和 controller identity。
- TypeScript 覆盖分母扩展至 11 个直接 owner：总行/语句 96.23%、函数 93.75%、分支 89.28%；`startupWarmupService` 为 95.02/94.44/85.48/95.02，`dataHeatmapSnapshot` 为 100/100/96.29/100，`dataWebHeatmapRequestState` 为 100/100/92/100（行/函数/分支/语句）。薄 `storageRuntimeGateway` 本轮仅收窄类型导出、没有新增决策分支，风险行为由 Rust 路径 owner 与真实 runtime smoke 覆盖，因此未人为增加无价值的 invoke-wrapper 行覆盖。
- 当前环境没有安装 `cargo llvm-cov`；本轮没有为取得数字临时引入工具或降低门槛，而是以 618 项 Rust 单元/集成测试、真实 Tauri smoke 和下方高风险矩阵作为直接证据。
- unused-export advisory 使用 TypeScript language service 并理解静态/动态 import、type import 和 alias；最终 `internal-only=0`、`unreferenced=0`、`test-only=105`。234 个仅文件内使用的 export modifier 被移除，确认无引用的函数、IPC 和旧 guard 被删除；test-only 项作为公开行为测试逐步迁移清单，不冒充死代码。
- 清理确认失效的 Settings/Tools/History CSS；保留动态 tone/placement/status 类。共享能力按真实 owner 落位：本地日期、domain color、可执行名/icon identity、settings 展示原语、destination 时间格式、Data LRU、runtime type guards、browser storage gateway 和测试全局恢复 helper。
- Rust wall clock 收归 `platform/clock.rs`，domain 决策继续使用注入时间；`engine/tools` 保留局部 `Utc::now()`，因为仅为一次去重增加 platform owner 会使该热点的 `dependencyOwners` 从 1 增至 2，违反本轮精确 no-growth 预算，后续只能随真实 owner 拆分处理。Scheduled Backup/Export 只抽取 app 协调机制，业务策略、数据执行、错误语义和 repository 继续独立。

#### Rust 高风险 owner 测试矩阵

| owner / 风险 | 直接证据 |
|---|---|
| `data/storage_migration`：真实路径别名、父子重叠、junction、清理前竞态 | 词法等价、最近存在祖先、父/子、Windows junction、pre-cleanup 重校验和正常迁移测试 |
| `data/storage_path_safety`：探针碰撞、截断、残留 | 既有 sentinel、不碰撞、并发探针、RAII 清理和失败诊断测试 |
| `data/storage_migration_cleanup`：staging/替换目标为 reparse，cache 跨根落入旧数据根 | 执行期 junction、清理前 identity、跨根 cache junction、staging junction 保留哨兵和 27 个 mutation 合同 |
| `platform/webdav`：明文传输、凭据 URL、重定向泄露 | HTTPS/loopback/localhost/嵌入凭据/不可信路径/禁止重定向测试 |
| `platform/credentials`：profile 越权、legacy 迁移、系统内存释放 | target 唯一性、Production-only legacy routing、RAII/zeroize 代码合同和完整 Windows 编译/Clippy |
| `app/scheduled_task_runtime`：共享协调层改变领域语义 | Backup/Export 各自业务测试、共享锁/运行生命周期合同与 618 项 Rust 全量回归 |
| `data/user_data_maintenance`：死 IPC 移除误伤数据维护 | repository 行为测试、IPC 注册/权限一致性门禁和真实 runtime smoke |
| `platform/clock`：符号、精度与边界倒置 | i64/u64 单元测试、Rust boundary gate、全量 Rust 测试 |

#### 最终命令证据

| 命令 / 门禁 | 结果 |
|---|---|
| `npm test` | 通过 |
| `npm run test:replay` | 15 项通过 |
| `npm run test:mutation` | 27/27 mutants killed |
| `npm run test:ui-browser-smoke` | 83 项真实浏览器场景通过 |
| `npm run build` + `npm run check:bundle` | 通过；initial 196.29 KiB gzip、all lazy 143.58 KiB、total 339.87 KiB |
| `npm run check:rust` | 618 passed、0 failed、1 个已登记 performance ignore；fmt、boundary、Clippy `-D warnings` 通过 |
| `npm run check:dependencies` | npm 0 vulnerability；Rust 0 个 Windows 可达漏洞，3 个 lock-only advisory 均验证不可达 |
| `npm run test:tauri-runtime-smoke` | 真实 Tauri/WebView2/IPC/SQLite 通过 |
| `npm run perf:stable` | 7 组基准各 5 次通过；Data combined 365 p95 297.85 ms，browser 7d→365 p95 486.14 ms，365→7d p95 437.02 ms，热 History meaningful p95 73.90 ms，startup p95 0.006 ms |
| `npm run check:full` | 对抗式修复后最终退出码 0，201.6 秒 |

#### 完成后对抗式审查结论

- 审查策略：把计划阶段、重启阶段和清理阶段视为可被独立改变的状态；交叉组合 data/cache 根；向 Windows API 输入合法但边界化的空 blob；用等价代码形态攻击治理正则；把“退出 loading”和“页面已结算”分开验证。
- 共确认 3 个 P1 和 3 个 P2，均已先构造反例、再修复、再加入直接测试/mutation。安全删除策略单独落到 `storage_migration_cleanup.rs`，并设置 53 行、15 branch、3 function 的精确热点预算；没有放宽原 `Data.tsx` 或 `storage_migration.rs` 的预算。
- 修复后再次通过 `check:full`、真实 Tauri runtime smoke 和完整 `perf:stable`。最终没有未关闭的已知 P1/P2；保留的 P3/审慎边界仍是未安装 Rust 行覆盖工具、`Data.tsx` 历史热点尚未行为保持型拆分，以及 105 个 test-only export 需要长期随公开行为测试迁移复查。
- 对抗式审查没有改变 95/100：新增问题在交付前全部关闭，但上述残余不确定性仍不支持上调评分。

#### 重新评分说明

- 数据安全 19/20：已知破坏性路径全部关闭；保留 1 分用于尚未通过另一套文件系统/故障注入环境验证的残余不确定性。
- 安全 14/15：HTTPS、profile 隔离和 RAII 已落地；保留 1 分用于未在测试中写入真实用户 Credential Manager 的审慎边界。
- 架构 14/15：owner 和边界门禁通过；`Data.tsx` 仍是 1,680 行热点，已锁定无余量预算但尚未完成行为保持型拆分。
- 可靠性 14/15：已知核心 P2 关闭；保留 1 分用于跨机器/长时间运行尚未覆盖的环境故障。
- 测试 14/15：信号质量显著提高且完整门禁通过；未安装 Rust 行覆盖工具，因此不声称 15/15。
- 维护性 10/10：在本计划确认范围内，死 CSS、未引用导出/IPC、高价值重复实现和防回退预算已全部处理；这不表示仓库未来不存在新增债务。
- 性能发布 10/10：本轮要求的构建、包体、runtime、依赖、Action 固定 SHA 和稳定性能证据全部通过。
- 最终得分 **95/100**。这是第 2 节范围内的证据评分，不是全局发布安全认证。

## 21. 完成后的文档处理

- [x] 若本计划改变了长期规则，更新对应顶层文档，而不是把新规则只留在本计划中。
- [x] 架构规则更新到 `docs/architecture.md`。
- [x] 测试、性能和质量门禁更新到 `docs/engineering-quality.md`。
- [x] Project 优先级或 Next 规则更新到 `docs/roadmap-and-prioritization.md`。
- [x] 本计划不再是当前执行依据后，移动到 `docs/archive/`。
- [x] 不把已完成的一次性计划长期保留在 `docs/working/`。
