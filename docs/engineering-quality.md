# 工程质量

## 1. 文档定位

本文是 `Patina` 的长期工程质量母文档。

它回答的是长期稳定规则，而不是某一轮专项执行计划：

- 工程质量默认包含哪些维度
- 这些维度之间如何排序、取舍与协作
- 哪些优化是鼓励的，哪些“优化”其实会伤害仓库
- 默认验证门槛与风险追加验证是什么
- 哪些层和边界需要长期高警惕

如果临时执行单、阶段专项文档或局部实现习惯与本文冲突，以本文与 [`architecture.md`](./architecture.md) 为准。

---

## 2. 三个核心维度

当前仓库长期把工程质量拆成三个核心维度：

### 2.1 代码质量

关注代码是否：

- 易读
- 易改
- 易测
- owner 清晰
- 不把复杂度错误地推回高吸力层

### 2.2 软件性能

关注软件是否：

- 启动与首屏足够顺
- 高频页面刷新与读模型重算足够稳
- 后台轮询、缓存、预热与 SQLite 读写成本合理
- 长时间运行时资源占用可解释

### 2.3 可靠性与验证

关注系统是否：

- tracking 结果可信
- runtime 行为稳定
- 数据边界安全
- 关键恢复路径可验证
- 发布链与升级链可重复验证

这三个维度彼此相关，但不能互相替代：

- 代码质量不能代替可靠性
- 性能优化不能跳过验证
- 可靠性保护也不等于可以忽视结构和成本

---

## 3. 默认优先级

当前仓库默认优先级是：

1. 可靠性与验证
2. 代码质量
3. 性能

原因很简单：`Patina` 是本地优先、以“可信记录”为核心价值的桌面时间追踪工具。只要记录不可信、恢复不可信、发布后不可信，其他优化都会失去意义。

默认取舍规则：

- 没有验证保护，不做高风险结构整理
- 没有测量依据，不做高风险性能优化
- 不能为了“更整洁”破坏 owner 边界
- 不能为了“更快”削弱 tracking、恢复、升级与发布可信性

---

## 4. 长期结构口径

工程质量判断必须与 [`architecture.md`](./architecture.md) 一致。

长期稳定口径如下：

- 先判定真实 owner，再决定代码落点
- `app/*`、`shared/*`、`platform/*`、Rust `lib.rs`、`app/*`、`commands/*` 都是高吸力层，默认只允许保持薄
- 兼容壳、legacy forwarding、facade 允许存在，但必须保持薄、理由明确、不能继续吸收新业务
- `shared/*` 只放稳定共享能力，不做临时公共桶
- `platform/*` 只承接外部环境边界，不做“难题收容所”
- Rust 核心逻辑优先留在 `engine / domain / data`

判断一项结构优化是否值得做，先看它是否真正降低了：

- 回归风险
- 修复成本
- 边界回流
- 高吸力层继续变厚的概率

---

## 4.5 外部 PR 准入门禁

外部 PR 的价值不在于“有人写了代码”，而在于它是否降低维护者把一个已接受问题安全落地主干的成本。

因此外部 PR 必须先通过准入门禁，再进入完整人工 review。维护者第一轮只判断方向、范围、owner、体量、风险和验证；未通过准入门禁的 PR 不做逐行审查。

PR 范围的长期定义是：

> 一个已被接受的问题，加上为解决它必须改动的最小代码集合，加上对应验证。

换言之，功能相关不等于范围正确。只有同时满足下面条件的改动才算在范围内：

- 对应已接受的 issue、Project item，或维护者明确接受的 scope。
- PR 模板完整写清 Scope Boundary、Owner Check、Risk Review 和 Validation。
- 每个改动文件都是解决该问题所必需。
- 每个用户可见行为都已经写入 scope 或验收条件。
- 代码落在真实 owner 下，并符合 [`architecture.md`](./architecture.md) 的边界。
- UI 改动符合 [`quiet-pro-component-guidelines.md`](./quiet-pro-component-guidelines.md)。
- 新增风险有对应测试或维护者明确接受的验证说明。

PR 默认分为四类：

- `Mergeable`：范围清楚、owner 正确、风险可验证、只需小修，可以进入人工 review。
- `Needs Author Changes`：方向可能可接受，但 scope、owner、体量、UI 或测试未过门禁；退回作者修改，不做完整 review。
- `Not Accepted`：当前代码形态需要维护者重写主要实现、重做主要 UI、迁移 owner，或只是原型演示；不合并代码。
- `Declined`：方向本身不符合产品、架构、安全或许可边界；关闭或明确不采纳。

以下情况属于一票否决，不能直接合并：

- 没有已接受范围的大功能 PR。
- PR 混入无关重构、格式化、命名整理、依赖升级或其他 owner 的改动。
- 主要实现落在错误 owner，合并后会制造长期边界问题。
- 主要 UI 不符合 Quiet Pro，需要维护者重做。
- 新增独立 CSS、硬编码颜色、圆角、阴影、边框或其他样式逃逸。
- 用户可见文案、placeholder、title 或 accessibility 文案绕过 copy owner，直接写在实现文件中。
- 涉及 tracking、SQLite、备份、恢复、清理、导出、迁移、设置持久化、截屏采集或本机/网络接口，但没有覆盖新增风险的测试。
- 功能 PR 修改质量门禁脚本、CI workflow、bundle budget 或 hotspot budget，尤其是顺手放宽预算。
- 功能 PR 从 `npm run check` 可达链路中移除既有检查、测试，或用弱命令替换既有验证。
- 文本文件引入 UTF-8 BOM、mojibake 标记或其他编码污染。
- 手工维护内容超过 1000 行或超过 25 个文件，且没有按行为、owner 或可独立验证阶段拆分。
- 维护者预计需要重写核心实现超过 30%。
- PR 的主要价值只是证明某个功能可以做，而不是提供可维护代码。

外部 PR 的范围必须有可审计上下文：已接受的 issue、Project item，或维护者明确接受的 scope。PR 正文、评论、关联 issue 和作者自述只能解释范围，不能绕过准入门禁。

自动准入门禁不使用 label 作为放行机制。当前硬门槛是：

- 触发 `oversized-manual-diff` 或 `too-many-manual-files` 时，作者必须按行为、owner 或可独立验证阶段拆分 PR。
- 触发 `risk-path-without-tests` 时，作者必须补充匹配风险域的专项测试，或由维护者另开维护者拥有的后续工作处理。

错误 owner、退休目录回流、未归属 shared styles、硬编码 Quiet Pro 样式、未完成 contributor checklist 等硬门禁不能通过评论、PR 正文或 label 放行。

PR intake 是独立于普通代码验证的准入 workflow。它需要三点 base/head PR diff 和 PR 正文才能给出有效判断；本地 `npm run check` 不应假装替代这个门禁。workflow 必须 checkout 可信 base revision，只读取 PR head，不执行贡献者修改后的门禁脚本或 package scripts。脚本自身由 `test:pr-intake` 覆盖，真正的 PR 准入在 GitHub Actions 的 `PR Intake` workflow 中执行。普通 `Verify` workflow 只应在 `PR Intake` 成功后验证外部 PR；`main` push 仍可直接验证。

GitHub 可能仍要求维护者批准首次外部贡献者的 Actions。这个平台级批准只允许 workflow 启动，不等于 scope 批准，也不能绕过准入门禁。

Draft PR 暂不运行准入 job；标记为 ready for review 后，必须满足当前模板与全部准入规则。

“有测试”不等于“覆盖风险”。准入脚本按风险域匹配测试：例如导出核心改动需要 `tests/export*` 或对应 Rust export 测试，settings persistence 改动需要 settings/persistence 相关测试，截屏采集改动需要 Rust command/engine 层测试覆盖设置、保留期、采集和文件路径安全。TypeScript 测试还必须能从正常的 `npm run check` 链路到达；独立 Rust 测试文件必须能被 Cargo 自动发现或被 crate module tree 引用，内联 Rust 测试必须实际新增测试函数。未注册测试、无关测试、只删除旧断言或只改宽泛 smoke 测试都不能算作正向覆盖。

这类 PR 可以礼貌感谢作者投入，但不能为了保留贡献痕迹而合入 `main`。如果作者愿意按准入门禁重做，可以进入 `Needs Author Changes`；如果不愿或方向不接受，应保持 `Not Accepted` 或 `Declined`。

公开贡献者规则写在 [`../CONTRIBUTING.md`](../CONTRIBUTING.md)。后续自动化门禁、PR 模板和 GitHub Actions 应服务同一套准入标准，而不是另起一套判断口径。

---

## 5. 默认验证门槛

默认最低验证门槛是：

- `npm run check`

它串行执行：

- `npm run check:types`
- `npm run check:lint`
- `npm run check:naming`
- `npm run check:architecture:self-test`
- `npm run check:architecture`
- `npm run check:ipc-contracts:self-test`
- `npm run check:ipc-contracts`
- `npm run check:hotspots`
- `npm run check:quiet-pro-style-debt`
- `npm run check:test-governance:self-test`
- `npm run check:test-governance`
- `npm run check:tests`
- `npm run check:frontend`

`check:tests` 将 coverage 风险域、其余快速确定性测试、关键 mutation 和真实浏览器 smoke 组合成唯一执行图。coverage 已经执行过的普通测试不会在同一次门禁中再次执行。`check:frontend` 只负责生产构建与 bundle budget，不再复制测试入口。具体叶子测试由 `package.json` 维护，本文不复制易漂移的文件清单。

默认完整质量门槛是：

- `npm run check:full`

它在前端验证链之外继续执行：

- `npm run check:rust`
- `npm run check:dependencies`

Rust 默认门槛包含边界检查器自测、`npm run check:rust-boundaries`、`cargo check --locked`、Rust 测试与 `cargo clippy --locked -- -D warnings`，其中 clippy 通过 `npm run check:rust:clippy` 单独暴露，便于局部复查。依赖门禁同时运行 `npm audit` 与固定版本的 `cargo-audit`；CI 必须显式安装仓库要求的 `cargo-audit` 版本，允许项只能是经 Windows target 依赖树证明不可达的精确 advisory，不得用宽泛忽略掩盖当前目标可达漏洞。

工具链版本必须保持单一来源：Node 由仓库根目录 `.node-version` 定义，Rust 由根目录 `rust-toolchain.toml` 定义。CI 应直接读取或安装这两个文件声明的工具链，不得在 workflow 中重复硬编码 Node 或 Rust 版本。`package.json` 的 `engines` 与 `devEngines` 只镜像根配置决定的 Node/npm 事实，其中 `devEngines` 必须对开发 runtime 与 package manager 使用精确版本和 `onFail: error`，让错误工具链在 `npm install`、`npm ci` 与 `npm run` 前失败；`@types/node` 主版本必须与 `.node-version` 的 Node 主版本一致。依赖安装脚本只允许使用精确包版本的 `allowScripts` 条目，不得用包名级宽泛许可。默认测试必须检查这些镜像声明、Node 类型主版本、脚本许可和所有 workflow 的 `.node-version` 引用没有漂移；升级工具链后运行完整门槛验证。

### 5.1 测试分层与稳定性治理

测试长期按六层管理：unit/model、integration/contract、structural/SSR、browser、desktop runtime、performance/release。同一功能可以出现在多层，但每层必须保护不同事实：低层覆盖状态组合和不变量，browser 覆盖真实 DOM 与交互，desktop runtime 覆盖 Tauri、WebView2、IPC、plugin、进程和落盘边界，performance/release 负责预算与产物，不互相冒充。

`npm test` 是全部快速确定性 TypeScript 测试的稳定入口。coverage 风险域和其余快速测试是互斥分区，并集必须等于全部快速入口。真实浏览器 smoke 进入默认 `check`，Tauri runtime smoke 保持独立 CI job 和风险追加入口。普通确定性顶层测试在一次默认门禁中只能执行一次；coverage、mutation 和 runtime 的特殊语义不能作为宽泛重复豁免。

新增测试必须能说明真实 owner、所属层级和独有失败模式。顶层 `tests/*.test.ts` 必须有且只有一个叶子脚本 owner，并能从快速、browser、runtime 或明确专项入口到达。删除测试前必须证明已有更稳定的替代保护，或证明它没有独有失败模式；测试数量和 coverage 百分比本身都不能作为删除理由。

测试同步遵守以下规则：

- 禁止失败后自动重跑整项测试来掩盖 flaky behavior。
- 等待状态变化必须使用有界条件轮询、事件、显式闸门或可观察 runtime 状态；超时只作为安全上限，并应报告最后观测值。
- 固定 sleep 只允许直接验证时间预算或刻意构造“操作超过超时”的输入，必须写清理由；不能把 sleep 当作正常同步手段。
- 测试创建的进程、端口、数据库和临时目录必须在成功、失败、超时路径清理。删除临时目录前必须验证绝对路径属于测试专属根目录，终止进程必须使用本测试创建的 PID，不能按进程名误杀。
- 时间、日期、时区、语言、主题、storage、缓存和随机输入必须由 fixture 控制或在测试后恢复，测试不能依赖执行顺序和前一项留下的状态。
- `.only`、未登记 `.skip` 和无理由 `#[ignore]` 禁止进入默认链。ignored 只允许精确的 performance/manual environment/破坏性诊断项，并必须有可执行替代入口。
- mutation 必须变异真实生产模块，search 失效时立即失败，预期的 detached rejection 只能在单个 mutant 作用域捕获，临时产物必须始终清理。

`check:test-governance` 自动发现顶层测试和 package script 递归执行图，阻止孤儿入口、重复 owner、缺失路径、默认门禁重复执行、focused/skipped 测试和未登记 ignored。其 `--self-test` 必须覆盖这些失败模式以及合法 coverage、mutation 和 performance ignored 场景；治理脚本不能维护第二份手写测试文件清单。

命中风险时追加验证：

- 改动 Rust tracking 主链、数据边界或恢复路径：追加 `npm run check:rust`
- 改动 IPC 注册、capability、SQLite plugin 或真实桌面运行时：追加 `npm run test:tauri-runtime-smoke`
- 性能敏感的 read model、SQLite 查询或导航路径：追加 `npm run perf:stable`
- 改动 release / changelog / updater：追加 `npm run release:validate-changelog`
- 准备正式发布：本地执行 `npm run release:check`，安装包构建与 updater 产物生成默认交给 GitHub Actions

当前仓库默认 CI gate 与 release workflow 的质量校验入口统一为 `npm run check:full`。

`check:naming` 是前端边界的轻量命名防线。它默认扫描 `src/app/**`、`src/features/**`、`src/shared/types/**` 与 `src/shared/lib/**`，阻止 tracking / update IPC、backup preview、widget placement、settings persistence 与 SQLite read row 的常见 raw 字段和 `RawXxx` 协议类型重新扩散到业务层。Raw DTO、协议字段与数据库字段应继续留在 `src/platform/**`、`src-tauri/**`、测试 fixture 或明确的 read model 内部边界。

`check:types` 是 TypeScript 静态门槛。它先检查生产 `src` 与 Vite 配置，再通过 `tsconfig.quality.json` 覆盖 `scripts/**/*.ts` 与 `tests/**/*.ts`。测试脚本允许比生产源码更宽的 unused / implicit-any 口径，但必须保持可解析、模块可解析、结构类型可检查，避免测试 fixture 长期漂离真实契约。

`check:architecture` 是基于 TypeScript AST 的前端 owner 边界防线。它扫描静态 import、动态 import、重导出与直接 `invoke`，默认覆盖 `src/app`、`src/features`、`src/shared` 与 `src/platform`：阻止 shared 反向依赖 app / features / platform，阻止 platform 反向依赖 app / features，并阻止 `src/features/*/components/**` 与 `src/features/*/hooks/**` 直接绕过 feature-owned service 访问 platform、Tauri API 或 `invoke`。`src/app/**` 不应直接 import `@tauri-apps/api`；前端生产代码不应重新调用低层 SQLite write helper；`src/app/components/**` 与 `src/app/hooks/**` 不应直接访问 `platform/persistence/**`。main window capability 不应包含 `sql:allow-execute`。检查器自测必须证明多行语法、动态路径与测试例外不会绕过规则。

`check:ipc-contracts` 静态比对前端生产调用与 Rust `invoke_handler` 注册，任何未注册调用、无调用注册或非精确动态命令名都会失败。确需封装的动态调用必须落在精确 allowlist，并由检查器自测覆盖；不能使用目录级、前缀级或通配符豁免。

`check:hotspots` 是高风险热点增长门禁。Rust 统计以剔除 `#[cfg(test)]` 后的生产非空行数为口径，避免大量测试 fixture 掩盖生产职责；它不要求一次性拆掉所有历史大文件，但会锁住当前最高风险热点的增长预算。如果超过预算，必须先按 owner 拆分、补验证，或带理由更新预算。

`check:quiet-pro-style-debt` 对现存的任意 radius 写法使用精确文件级基线：新增债务失败，债务减少但未同步收紧基线也失败。长期目标仍是把视觉角色收敛到 Quiet Pro token，而不是把基线当永久许可。

`check:rust-boundaries` 扫描 Rust 高吸力层并先剥离 `#[cfg(test)]` 模块。它阻止 `commands/*`、`app/*` 与 `lib.rs` 直接写 SQL，阻止 `commands/*` 承接 SQLite pool 类型，阻止 Rust `app/*` 直连 repository 或 pool，阻止 `platform/*` 反向依赖 `data/*` / `app/*`，阻止 `domain/*` 依赖 `data/*` / `platform/*`，并阻止 `engine/*` 依赖 app、data、repository、pool、SQL、等待数据库或原始 Windows API。生产路径必须让 SQL 留在 `data/*`，Windows API 实现留在 `platform/*`，领域决策留在 `domain/*`，跨边界数据组合留在 `app/*`；engine 可以调用 platform 暴露的窄能力来编排桌面行为，但不能把 Win32 实现吸入自身。检查器自测与空债务基线共同保证新增反向依赖立即失败。

`test:coverage` 对 tracking effects/policy、Dashboard/History read model、SQLite transaction 与结构化 command error 等核心风险域设置语句、分支、函数和行覆盖率硬阈值。覆盖率是风险证据，不替代行为断言；新增高风险 owner 时应同步扩展 include，而不是用无关低风险文件稀释分母。

`test:mutation` 对并发等待、批处理完整性、序列化、重试语义和错误 DTO 解析执行关键变异。每个 mutant 必须修改真实模块并由现有行为断言杀死；不能用只测试测试脚本自身的伪 mutant 计分。

压缩 SQLite migration 基线时，必须同时保留旧版本数据库直升保护：新安装可以走当前压缩基线，已安装旧数据库在归一化 `_sqlx_migrations` 前必须先完成幂等的 legacy schema repair，并用 Rust 自动化测试覆盖缺列补齐、历史数据保留、必要回填、active session 归一化和不完整 schema 不误标为当前基线。

兼容清理必须区分两类代码：

- 历史产品身份、旧目录、旧本地存储键、旧远端目录、旧备份格式等“迁移窗口兼容”，可以在承诺窗口结束、发布说明充分提醒且验证通过后退出。
- 当前 `Patina` 数据库 schema migration、legacy schema repair、基线归一化和已安装数据库直升保护，属于升级可信链路，不应因为名字里带 `legacy` 或 `migration` 就当作可清理兼容代码删除。

如果要移除第二类代码，必须先证明它不再承担已发布版本数据库升级职责，并以明确执行单、风险说明和自动化测试覆盖，而不是把它混入普通兼容清理。

`test:ui-smoke` 是当前仓库的最小 UI smoke 防线。它不依赖真实 Tauri runtime，而是通过 stub Tauri API、SSR 渲染 AppShell，并确认主导航和 Dashboard 首屏可以被构建与渲染。

`test:ui-browser-smoke` 是真实浏览器/Vite 页面防线。它启动本地 Vite server，用 headless Edge/Chrome 打开主界面，在 stub Tauri API 下检查 Dashboard、主导航、Settings 主题弹窗、控制台 error 与基础横向溢出。

`test:tauri-runtime-smoke` 是 Windows 上的真实 Tauri/WebView2 防线。它以隔离的数据目录构建并启动 debug 应用，覆盖真实 command、Rust event、plugin SQL 读写、capability 拒绝、结构化错误和 SQLite 落盘完整性，并在结束后清理子进程与临时目录。它是高风险 runtime/IPC 变更的追加门禁，并在 CI 中独立超时执行，不能被 stub browser smoke 替代。

`check:bundle` 是保守 bundle 预算防线。它在生产构建之后检查关键 JS chunk 与总 gzip 体积，防止静默引入明显超预算依赖。

### 5.2 Bundle 长期治理与预算变更

Bundle 治理的目标不是让构建产物永远不增长，而是让代码只在需要它的路径加载，并让每次增长都有明确的产品价值、owner 和性能影响。功能数量增加可以使总产物合理增长，但不能默认使启动路径、公共依赖或无关页面一起变重。

长期管理必须区分三个概念：

- **预算（budget）**：产品当前可以接受的体积上限，是需要维护的性能边界。构建结果接近预算不会自动产生更高预算。
- **发布基线（release baseline）**：最近一次正式发布确认的实际构建结果，用于观察版本间变化。发布基线可以随正式版本更新，但不能自动改写预算。
- **优化目标（target）**：希望通过拆包、按需加载或依赖治理达到的方向，不等同于当前构建是否合格的硬门槛。

默认使用生产构建的 gzip 体积作为可重复比较口径，并分别管理：

- 启动入口 JS 与首屏 CSS：直接影响启动和首屏，属于最严格的长期预算。
- 公共依赖 chunk：由所有相关页面共同承担，不应因单个功能方便而持续增长。
- Feature-owned lazy chunk：由 Dashboard、History、Data、Settings 等真实 owner 分别承担，允许随已确认能力合理增长。
- Lazy support chunk：必须能说明被哪些 feature 使用，不能成为没有 owner 的依赖堆积区。
- 总 JS、CSS 与 chunk 数量：用于观察产品整体趋势和发现重复依赖，不单独代表启动性能。

当前机器可执行的具体阈值以 [`../scripts/check-bundle-budget.ts`](../scripts/check-bundle-budget.ts) 为准。阈值必须按加载阶段和 owner 单独维护，不能只保留一个不断扩大的“总 bundle 上限”。既有功能增长应优先落入对应 lazy chunk；无关功能不得把成本推入入口或公共依赖。

#### 预算变更的允许条件

只有满足以下原因之一，才能提出提高预算：

- 已确认的长期产品能力带来不可避免、可归属的代码增长。
- 框架或运行时升级改变了构建产物，并且保留升级的收益高于体积成本。
- 拆包策略调整使代码在 chunk 之间合理迁移，旧预算已不能表达新的加载边界。
- 原预算的统计口径、chunk 匹配或测量方法存在错误。
- 可重复的启动或页面加载测量证明，旧预算已不能正确表达实际性能风险。

以下理由不能用于提高预算：

- 构建检查失败，需要先让 CI 通过。
- 软件功能越来越多，所以所有预算都应该自然上涨。
- 没有定位增长来源，或无法说明增长属于哪个 owner。
- 拆包、按需导入、依赖替换或去重暂时不方便。
- 为实验、临时兼容层、待删除代码或未来可能需要的功能预留空间。
- 用提高总预算掩盖入口、公共依赖或单一 feature chunk 的异常增长。

#### 预算变更前的证据

预算变更必须同时提供：

- 旧预算、发布基线、当前实际值、建议新预算，以及绝对增长和增长比例。
- 受影响的入口、公共依赖、feature chunk、support chunk 或 CSS owner。
- 造成增长的主要模块、依赖或打包变化。
- 对懒加载、按需导入、拆包、去重、依赖替换和移除的排查结果。
- 对启动路径、首屏或相关功能首次打开体验的影响判断；高风险增长应提供可重复测量。
- 预算提高的有效范围，不能用一个局部增长申请同步放宽其他指标。

新预算按“确认后的必要体积加有限缓冲”确定，不能直接等于失败后的临时构建结果，也不能一次性预留大量空间。默认最大缓冲为：

- 启动入口、公共依赖和 CSS：确认必要体积的 `5%`。
- Feature-owned lazy chunk：确认必要体积的 `10%`。
- 总产物：不因单次增长自动增加缓冲；通过发布基线观察趋势后再判断是否需要调整长期上限。

#### 变更与发布维护流程

1. 先运行生产构建和 bundle 检查，固定同一环境、同一压缩口径下的结果。
2. 定位增长到具体加载阶段、chunk、模块和 owner，并先完成合理的减重排查。
3. 如果仍需提高预算，形成包含上述证据的独立预算决策，不把“提高阈值”当成功能实现的收尾动作。
4. 预算数字只在机器可执行的预算来源中更新；长期文档保留规则和决策要求，避免复制易漂移的当前数值。
5. 更新后重新运行完整构建与 bundle 检查，并确认没有把成本转移到入口、公共依赖或其他 owner。
6. 正式发布前记录实际构建结果作为该版本的发布基线；发布基线更新不得自动提高预算。
7. 优化使稳定体积明显下降时，应同步收紧对应预算，避免已经释放的空间被无意识重新占满。

预算变更应保持独立、可追溯，并在提交说明中记录原因、体积对比、排查结果和影响范围。一句话原则是：

> Bundle 预算变更是性能边界决策，不是修复构建失败的手段。

性能优化的额外规则：

- 必须说明场景
- 必须给出前后可比依据
- 高频路径除平均值外，应尽量记录 `p50`、`p95`、`max`，避免平均值掩盖体感尖刺
- 必须证明收益大于复杂度
- 默认先做无感优化，再做体验取舍；不得为了降低任务管理器数字牺牲启动、切页、widget 唤出与 tracking 可信度
- Windows 平台 owned resource 应优先使用 RAII guard 表达释放责任，包括 process handle、snapshot handle、GDI bitmap/DC、owned icon、COM 初始化和未来可能引入的 WinEvent hook
- 高频平台查询应优先考虑短 TTL 缓存、negative cache、in-flight 合并和退避，避免后台采样对同一资源重复开销
- widget WebView 生命周期、启动暖机收缩、透明窗口策略和 foreground event hook 属于体验敏感实验项；未证明收益明显且手感无损前，不应默认启用
- widget 隐藏路径如果启用资源回收，应先保持即时 park 以保护收起手感，再通过 generation/token 防护做延迟销毁，避免旧 timer 销毁新唤出的 widget
- 后台优化这类会释放 UI WebView 的资源策略必须默认关闭；用户可见文案不暴露具体等待阈值，内部实现用统一阈值和 generation/token 防护，确保短时间重复打开关闭仍走快速复用路径

当前仓库已经有可复用示例：

- `npm run perf:history-read-model`
- `npm run perf:dashboard-read-model`
- `npm run perf:data-read-model`
- `npm run perf:data-history-browser`
- `npm run perf:sqlite-query-plan`
- `npm run perf:startup-bootstrap`
- `npm run perf:stable`

它们不是唯一性能脚本，但代表默认口径：先固定场景，再做前后对照，而不是靠主观感觉宣称“更快了”。`perf:stable` 串行重复运行整套性能场景，聚合 average、p50、p95 与 max，并以任一子进程失败、预算超限或 SQLite table scan 为失败；不得用并发运行基准制造虚假的吞吐或尾延迟结果。
这些脚本的输出必须明确预算，并在任一测量项超过预算时以非零退出码失败；如果某个脚本只是在比较参考路径和完整现状路径，输出必须说清它不是直接优化收益对照。
`perf:data-history-browser` 使用 stub Tauri 数据，只测导航与渲染路径，不代表真实 SQLite I/O；`perf:sqlite-query-plan` 使用临时合成 SQLite 数据，只用于判断 query shape 和候选 index 是否值得进入单独 migration 执行单。

---

## 6. 长期关注热点

长期需要持续高警惕的热点不是“某个文件行数大”，而是这些风险类型：

- tracking runtime 主链
- read model 与 replay 边界
- backup / restore / cleanup / release / upgrade 链路
- app 壳层与兼容壳回流
- 跨层 facade 或 forwarding 重新变厚
- 高频刷新、轮询、缓存与 SQLite 查询成本

当这些区域发生变化时，默认要先补验证或测量，再谈整理和优化。

备份与恢复链路的最低风险证据包括：快照一致性与摘要校验、危险 ZIP 路径和资源上限拒绝、覆盖恢复中断回滚、合并事务回滚与重复导入幂等、父子 ID 重映射、当前数据冲突优先，以及 WebDAV 下载后重新走正式 preview。涉及文件切换或格式分派时，默认运行 `npm run check:full`，不能只用成功路径证明安全。

---

## 7. 文档与归档规则

工程质量文档长期采用两层结构：

- top-level `docs/`：只保留当前有效的长期规则
- `docs/archive/`：保留已经完成使命的阶段专项文档、执行清单与历史背景

如果以后再出现新的工程质量专项，应放在：

- `docs/working/`

专项完成后：

- 把阶段事实回写进本文
- 把执行文档移入 `docs/archive/`

不要让 top-level `docs/` 长期堆积阶段性执行单。

---

## 8. 协作约束

后续协作默认遵守这些约束：

- 先解决真实工程问题，再回写文档
- 不把阶段性收口误写成长期完成
- 不把一次成功的局部优化夸大成“整体问题已解决”
- 不把 archive 当作默认依据；archive 只提供历史上下文
- 当长期规则变化时，优先更新本文，而不是继续扩写新的阶段规则文档

---

## 9. 与其他长期文档的关系

- 产品边界与优先级：见 [`product-principles-and-scope.md`](./product-principles-and-scope.md) 与 [`roadmap-and-prioritization.md`](./roadmap-and-prioritization.md)
- 结构与 owner 边界：见 [`architecture.md`](./architecture.md)
- 稳定期修复边界：见 [`issue-fix-boundary-guardrails.md`](./issue-fix-boundary-guardrails.md)
- 版本、发布与升级链：见 [`versioning-and-release-policy.md`](./versioning-and-release-policy.md)

本文只负责工程质量总规则，不重复承载产品、架构或发布策略的完整细则。
