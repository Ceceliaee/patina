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

## 5. 默认验证门槛

默认最低验证门槛是：

- `npm run check`

它串行执行：

- `npm run check:naming`
- `npm run check:architecture`
- `npm test`
- `npm run test:replay`
- `npm run test:update`
- `npm run test:settings`
- `npm run test:widget`
- `npm run test:classification`
- `npm run test:data`
- `npm run test:persistence`
- `npm run test:interaction`
- `npm run test:release`
- `npm run test:ui-smoke`
- `npm run test:ui-browser-smoke`
- `npm run build`
- `npm run check:bundle`

默认完整质量门槛是：

- `npm run check:full`

它在前端验证链之外继续执行：

- `npm run check:rust`

Rust 默认门槛包含 `npm run check:rust-boundaries`、`cargo check`、Rust 测试与 `cargo clippy -- -D warnings`，其中 clippy 通过 `npm run check:rust:clippy` 单独暴露，便于局部复查。

命中风险时追加验证：

- 改动 Rust tracking 主链、数据边界或恢复路径：追加 `npm run check:rust`
- 改动 release / changelog / updater：追加 `npm run release:validate-changelog`
- 准备正式发布：本地执行 `npm run release:check`，安装包构建与 updater 产物生成默认交给 GitHub Actions

当前仓库默认 CI gate 与 release workflow 的质量校验入口统一为 `npm run check:full`。

`check:naming` 是前端边界的轻量命名防线。它默认扫描 `src/app/**`、`src/features/**`、`src/shared/types/**` 与 `src/shared/lib/**`，阻止 tracking / update IPC、backup preview、widget placement、settings persistence 与 SQLite read row 的常见 raw 字段和 `RawXxx` 协议类型重新扩散到业务层。Raw DTO、协议字段与数据库字段应继续留在 `src/platform/**`、`src-tauri/**`、测试 fixture 或明确的 read model 内部边界。

`check:architecture` 是前端 owner 边界的轻量结构防线。它默认扫描 `src/app`、`src/features`、`src/shared` 与 `src/platform`，阻止 shared 反向依赖 app / features / platform，阻止 platform 反向依赖 app / features，并阻止 `src/features/*/components/**` 与 `src/features/*/hooks/**` 直接绕过 feature-owned service 访问 platform、Tauri API 或 `invoke`。`src/app/components/**` 与 `src/app/hooks/**` 不应直接访问 `platform/persistence/**`。

`check:rust-boundaries` 是 Rust 高吸力层的轻量结构防线。它默认阻止 `commands/*`、`app/*` 与 `lib.rs` 直接写 SQL，阻止 `commands/*` 承接 SQLite pool 类型，阻止 `platform/*` 反向依赖 `data/*`，并阻止 `domain/*` 依赖 `data/*` 或 `platform/*`。测试代码可保留必要的局部例外，但生产路径应继续让 SQL 留在 `data/*`，平台细节留在 `platform/*`，领域决策留在 `domain/*`。

压缩 SQLite migration 基线时，必须同时保留旧版本数据库直升保护：新安装可以走当前压缩基线，已安装旧数据库在归一化 `_sqlx_migrations` 前必须先完成幂等的 legacy schema repair，并用 Rust 自动化测试覆盖缺列补齐、历史数据保留、必要回填、active session 归一化和不完整 schema 不误标为当前基线。

`test:ui-smoke` 是当前仓库的最小 UI smoke 防线。它不依赖真实 Tauri runtime，而是通过 stub Tauri API、SSR 渲染 AppShell，并确认主导航和 Dashboard 首屏可以被构建与渲染。

`test:ui-browser-smoke` 是真实浏览器/Vite 页面防线。它启动本地 Vite server，用 headless Edge/Chrome 打开主界面，在 stub Tauri API 下检查 Dashboard、主导航、Settings 主题弹窗、控制台 error 与基础横向溢出。

`check:bundle` 是保守 bundle 预算防线。它在生产构建之后检查关键 JS chunk 与总 gzip 体积，防止静默引入明显超预算依赖。

性能优化的额外规则：

- 必须说明场景
- 必须给出前后可比依据
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
- `npm run perf:startup-bootstrap`

它们不是唯一性能脚本，但代表默认口径：先固定场景，再做前后对照，而不是靠主观感觉宣称“更快了”。
这些脚本的输出必须明确预算，并在任一测量项超过预算时以非零退出码失败；如果某个脚本只是在比较参考路径和完整现状路径，输出必须说清它不是直接优化收益对照。

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
