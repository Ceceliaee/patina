# 工程质量

## 1. 文档定位

本文是 `Time Tracker` 的长期工程质量母文档。

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

原因很简单：`Time Tracker` 是本地优先、以“可信记录”为核心价值的桌面时间追踪工具。只要记录不可信、恢复不可信、发布后不可信，其他优化都会失去意义。

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
- `npm test`
- `npm run test:replay`
- `npm run test:update`
- `npm run test:settings`
- `npm run test:widget`
- `npm run test:classification`
- `npm run test:persistence`
- `npm run test:interaction`
- `npm run build`

默认完整质量门槛是：

- `npm run check:full`

它在前端验证链之外继续执行：

- `npm run check:rust`

命中风险时追加验证：

- 改动 Rust tracking 主链、数据边界或恢复路径：追加 `npm run check:rust`
- 改动 release / changelog / updater：追加 `npm run release:validate-changelog`
- 准备正式发布：本地执行 `npm run release:check`，安装包构建与 updater 产物生成默认交给 GitHub Actions

当前仓库默认 CI gate 与 release workflow 的质量校验入口统一为 `npm run check:full`。

`check:naming` 是前端边界的轻量命名防线。它默认扫描 `src/app/**`、`src/features/**`、`src/shared/types/**` 与 `src/shared/lib/**`，阻止 tracking / update IPC、backup preview、widget placement、settings persistence 与 SQLite read row 的常见 raw 字段重新扩散到业务层。Raw DTO、协议字段与数据库字段应继续留在 `src/platform/**`、`src-tauri/**` 或明确的 read model 内部边界。

性能优化的额外规则：

- 必须说明场景
- 必须给出前后可比依据
- 必须证明收益大于复杂度

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
