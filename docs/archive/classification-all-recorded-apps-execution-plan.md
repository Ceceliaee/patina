# Classification 管理全部已记录应用：执行归档

## 0. 归档状态

- [x] 文档类型：一次性执行单与完成证据
- [x] 对应工作项：GitHub Project「让 Classification 可管理全部已记录应用」
- [x] 需求背景：[GitHub Issue #51](https://github.com/Ceceliaee/patina/issues/51)
- [x] 执行日期：2026-07-19
- [x] 最终状态：实现、验证和对抗式审查完成
- [x] 归档日期：2026-07-19
- [x] 编码：UTF-8

本文记录本次一次性实施过程，不替代 `docs/` 下的产品、架构、工程质量、Quiet Pro 与路线图长期文档。

## 1. 最终产品契约

### 1.1 第一性原理

Classification 管理的是仍有实际活动记录的应用身份。时间范围和默认排序可以影响呈现顺序，但不能决定历史应用是否还能被发现。

最终集合为：

```text
全部已记录应用
  = Patina 原生 sessions 中的 executable
  ∪ 精确导入 sessions 中的 executable
  ∪ 聚合导入时间桶中的 executable
  - 系统级或明确不可追踪身份
  → canonical executable 去重
```

应用映射不是目录来源。某应用的所有原生与导入记录被删除后，其孤立映射随之清理，不再把已经没有记录的应用复活到目录。

### 1.2 用户最终确认的呈现方式

- [x] 移除 30 天产品范围限制。
- [x] 移除前 120 项的永久目录限制。
- [x] 进入“分类”应用视图后自动取得并展示全部已记录应用。
- [x] 不提供“近期 / 全部”切换。
- [x] 不提供日期范围控件。
- [x] 不显示“加载更多应用”按钮。
- [x] 不显示“已显示 N 个应用”独立文案。
- [x] 筛选恢复括号数量：`全部（总数）`、`已分类（数量）`、`未分类（数量）`。
- [x] 搜索期间括号继续表示完整目录总数，不冒充当前搜索命中数。
- [x] 网页域名 Classification 不在本项扩张。

### 1.3 “全部展示”与内部读取

用户可见层没有批次边界；数据库内部仍采用稳定 keyset 和有限查询页，随后由页面 controller 自动连续取完。

```text
进入 Classification
  → SQLite 每次返回最多 120 个 raw executable 聚合行
  → feature 每批最多产出 60 个 canonical 应用
  → controller 自动继续读取
  → source exhausted
  → 页面拥有完整目录并全部展示
```

内部批次只用于避免单次数据库调用和单次转换失控，不再形成用户必须操作的分页或可见上限。

## 2. Owner 与边界

- [x] SQLite 查询 owner：`src/platform/persistence/classificationPersistence.ts`。
- [x] 数据访问接线：`src/features/classification/services/classificationStore.ts`。
- [x] feature facade：`src/features/classification/services/classificationService.ts`。
- [x] 目录分页、canonical 合并和自动取完 controller：`src/features/classification/services/classificationAppCatalog.ts`。
- [x] 应用筛选与排序：`src/features/classification/services/classificationCandidateFiltering.ts`。
- [x] React 生命周期与错误恢复：`src/features/classification/hooks/useClassificationAppCatalog.ts`。
- [x] 页面 draft、图标和删除后刷新接线：`src/features/classification/hooks/useAppMappingState.ts`。
- [x] 页面展示：`src/features/classification/components/AppMapping.tsx`。
- [x] 未新增 schema migration。
- [x] 未新增 Tauri command。
- [x] 未把全部历史目录写入启动 bootstrap cache。
- [x] 未改变 Tools 的近期候选读取契约。
- [x] 未新增 shared 临时抽象或恢复已退出的根目录层。

## 3. 数据查询实施步骤

### 3.1 聚合来源

- [x] 原生 `sessions` 按 `exe_name` 聚合 `MAX(start_time)`。
- [x] `import_exact_sessions` 按 `exe_name` 聚合 `MAX(start_time)`。
- [x] `import_time_buckets` 按 `exe_name` 聚合 `MAX(bucket_start_time)`。
- [x] 三个来源在 SQLite 内 `UNION ALL`。
- [x] 同一 raw executable 跨来源再次聚合。
- [x] 原生来源优先提供应用名称；导入来源作为回退。
- [x] 返回 `has_native_records`，删除语义能够区分记录来源。

### 3.2 稳定游标

- [x] 主排序为 `last_seen_ms DESC`。
- [x] tie-breaker 为 `exe_name ASC`。
- [x] cursor 同时包含 `lastSeenMs` 和 `rawExeName`。
- [x] 下一页条件严格排除已经消费的 cursor 行。
- [x] 相同时间戳的多个 executable 有专项测试。
- [x] raw cursor 推进与 canonical seen set 分离。
- [x] canonical alias 跨页不会重复形成卡片。
- [x] 无进展时 controller 抛出可重试错误，避免无限循环。

### 3.3 搜索与安全

- [x] SQL 参数全部通过占位符传入。
- [x] `%`、`_` 和反斜杠按字面量转义。
- [x] SQL 注入 payload 作为普通数据处理。
- [x] SQL 查询仍支持原始 app name / exe name 搜索与专项性能测量。
- [x] 页面完成全目录加载后，用户搜索在完整目录上本地执行。
- [x] 本地搜索覆盖有效显示名、原始应用名、canonical executable、用户别名和分类名称。
- [x] 搜索不再重新读取数据库，因此不会被原始名称预筛掉别名或分类匹配。
- [x] 搜索不会让孤立映射重新成为应用目录数据。

## 4. 页面状态与交互

- [x] 冷 bootstrap 继续保持原有安静占位，不显示页面 loading 文案。
- [x] 目录自动读取期间不引入新的高噪音控件。
- [x] 首次目录失败复用页面级错误与“重试”。
- [x] 重试重新开始完整目录读取。
- [x] controller generation 防止旧请求覆盖新请求或卸载后的页面。
- [x] 没有记录时显示现有空状态。
- [x] 搜索没有匹配时显示“没有找到匹配的应用”。
- [x] 筛选括号使用完整目录计数，搜索时保持总数不变。
- [x] `excluded` 仍使用图标入口，不新增干扰数字。
- [x] 分类、别名、颜色、排除统计和标题记录继续复用现有 draft/save 流程。
- [x] 删除应用全部记录后清除相关 draft、saved override、名称编辑状态和 bootstrap cache。
- [x] 删除后自动重新读取完整目录，已无记录的应用立即消失。
- [x] 图标请求以完整 canonical executable 集合为输入并继续复用缓存。
- [x] Quiet Pro 组件、token、圆角和状态层级保持不变。

## 5. 自动化测试清单

### 5.1 目录与 SQLite 单元测试

- [x] 30 天以前的原生或导入应用可返回。
- [x] 相同 `lastSeenMs` 的 keyset 顺序稳定。
- [x] `%`、`_`、反斜杠按字面量搜索。
- [x] SQL 注入 payload 不改变查询结构，也不破坏表。
- [x] raw executable 的大小写/alias canonical 去重。
- [x] 内部 raw 扫描预算会返回可继续 cursor，而不是形成永久上限。
- [x] 仅有映射、没有记录的应用不会被目录复活。
- [x] 搜索结果同样要求底层存在活动记录。
- [x] 单个 feature batch 不超过 60 个 canonical 卡片。
- [x] controller 自动耗尽 130 项以上的所有内部批次。
- [x] 只有当前 generation 可以提交结果。

### 5.2 真实浏览器回归

- [x] fixture 提供 130 个应用，覆盖原 120 项之后的深历史应用。
- [x] 自动加载完成后显示 `全部（130）`。
- [x] 页面不存在“加载更多应用”。
- [x] 页面不存在“已显示 N 个应用”。
- [x] 30 天以前的目标应用可见且可搜索。
- [x] 孤立映射不显示，搜索也不会将其复活。
- [x] 无匹配搜索显示正确空状态，同时括号仍为完整目录总数。
- [x] 首次查询失败有页面级错误和重试。
- [x] 清空搜索恢复完整目录。
- [x] 45 条真实浏览器 UI smoke 全部通过。

### 5.3 全套门禁

- [x] `npm run check` 最终退出码为 0。
- [x] TypeScript 主配置与 quality 配置通过。
- [x] ESLint 零 warning。
- [x] naming boundary 通过。
- [x] architecture self-test 与 architecture boundary 通过。
- [x] IPC contract self-test 与 91/91 contract 检查通过。
- [x] quality hotspot growth guard 通过。
- [x] Quiet Pro style debt guard 通过。
- [x] test governance self-test 与正式检查通过。
- [x] 覆盖率门禁通过。
- [x] 全部 fast remaining tests 通过。
- [x] critical mutation 8/8 killed，得分 100%。
- [x] 45 条真实浏览器 smoke 通过。
- [x] `npm run build` 通过。
- [x] bundle budget 通过。
- [x] Tauri 真实 command/event/SQLite/capability smoke 通过。
- [x] `git diff --check` 通过。

## 6. 性能证据

专项 fixture：

- 80,000 条原生 session。
- 20,000 条精确导入记录。
- 10,000 条聚合导入记录。
- 1,500 个不同应用。
- 每个 SQLite 内部查询页返回 120 行。
- 每个场景 12 次迭代。

结果：

| 场景 | average | p95 | max | 基础表全表扫描 |
| --- | ---: | ---: | ---: | --- |
| 首批目录 | 19.73 ms | 23.87 ms | 23.87 ms | 否 |
| 深页 cursor | 17.88 ms | 20.67 ms | 20.67 ms | 否 |
| SQL 原始名称搜索 | 18.75 ms | 22.43 ms | 22.43 ms | 否 |

- [x] 三个场景均在专项预算内。
- [x] query plan 使用三个现有 covering index 完成 executable 聚合。
- [x] 每个 executable 的最新名称通过现有索引查找。
- [x] `baseTableScans` 为空。
- [x] 未因性能引入 migration 或新索引。
- [x] 完整 `perf:stable` 组合套件在工具窗口内两次分别超过 120 秒和 300 秒；没有得到失败结论。
- [x] 本项专项基准独立完成并保留完整可复核数据。

## 7. Bundle 证据

- [x] initial JS + CSS：297.00 KiB gzip，预算内。
- [x] lazy JS：84.93 KiB gzip，低于 85 KiB 预算。
- [x] total JS + CSS：381.94 KiB gzip，预算内。
- [x] AppMapping 页面块：14.34 KiB gzip，低于 18 KiB 页面预算。
- [x] 未提高任何 bundle budget 数字。
- [x] 将稳定的候选筛选逻辑归入 Classification feature service，避免页面块重复承担服务逻辑。

## 8. 对抗式审查

### 8.1 已攻击的假设

- [x] 大量记录是否导致原始 session 传到前端：否，只传应用级聚合行。
- [x] 相同时间戳是否导致漏页/重复：专项 keyset 测试通过。
- [x] canonical alias 是否跨批重复：seen set 与测试覆盖。
- [x] 全部行被过滤时是否无限循环：cursor 进展检查和无进展错误保护。
- [x] 查询失败是否清空永久状态：仅页面目录状态失败，持久化 draft 不被破坏。
- [x] retry 是否复用污染 cursor：retry 从新 generation 和空 cursor 开始。
- [x] 卸载后的请求是否回写：cleanup 递增 generation。
- [x] `%`/`_`/反斜杠或注入 payload 是否扩大结果：参数化和字面量测试通过。
- [x] 删除最后一份记录是否留下不可见配置：override 清理和目录 reload 覆盖。
- [x] 仅映射应用是否违反“实际记录”边界：不会进入目录，并有回归测试。
- [x] 搜索是否只覆盖原始数据库名称：审查发现问题并已修复为全目录本地搜索。
- [x] 搜索是否错误改变括号“总数”：审查后固定为完整目录总数，并有浏览器断言。
- [x] 页面是否重新出现“已显示 N 个应用”或“加载更多”：浏览器断言均为否。
- [x] UI 是否引入新视觉体系：Quiet Pro guard 与浏览器回归通过。

### 8.2 审查结论

- [x] 发现 1 个实质语义缺陷：数据库原始名称预筛会漏掉只匹配别名/分类名的记录型应用。
- [x] 修复：完整目录只读取一次，搜索在全部已加载目录上本地执行。
- [x] 修复后重新运行 Classification tests、45 条浏览器 tests、生产 build、bundle 与完整 `npm run check`。
- [x] 未发现剩余阻断级或高优先级问题。

## 9. Project 完成检查点

2026-07-19 完成后只读核对 live Project：

- `In progress`：让 Classification 可管理全部已记录应用。
- `Next`：增加网站域名历史趋势分析。
- `Next`：让 Web Sync 自动识别安装扩展的浏览器。
- `Queued`：在 Dashboard 和 History 快捷设置分类与别名。

- [x] live Project 已在完成事件后重新读取。
- [x] 本项仍是唯一主要 `In progress`。
- [x] 本次未代替维护者修改 Project 状态。
- [x] 建议维护者手动拖动：本项 `In progress → Done`。
- [x] 完成后补足第三个 Next：`在 Dashboard 和 History 快捷设置分类与别名` 从 `Queued → Next`。
- [x] 其余两个 Next 保持不变。
- [x] Issue #51 未被关闭、重开、加标签或改状态。

## 10. 最终总检查

- [x] Classification 默认目录覆盖全部仍有实际记录的应用。
- [x] 30 天和 120 项不再是用户可见管理边界。
- [x] 页面自动展示全部目录，不需要用户触发分页。
- [x] SQLite 内部读取仍有稳定游标、单页限制和无进展保护。
- [x] 括号恢复为完整目录总数。
- [x] “已显示 N 个应用”已删除。
- [x] 搜索覆盖完整目录及显示名、别名、分类名。
- [x] canonical identity 跨来源、跨页不重复。
- [x] 孤立映射不会复活已删除应用。
- [x] bootstrap 与 Tools 继续保持原有近期轻量读取。
- [x] 网页域名 Classification 未被扩张。
- [x] 页面符合 Quiet Pro。
- [x] 自动化、真实浏览器、真实 Tauri、SQLite 与性能证据完整。
- [x] 对抗式审查完成，发现项已修复并复验。
- [x] 执行单已从 `docs/working/` 移至 `docs/archive/`。

