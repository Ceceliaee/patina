# 执行单：窗口标题明细可信采样
Document Type: One-off Execution Plan

> 状态：已完成并归档。
>
> 归档规则：本执行单只作为本轮标题明细能力的实施依据。执行完成并完成必要事实回写后，应移动到 `docs/archive/`，不要长期停留在顶层长期文档区。

## 1. 背景

历史页时间线条目目前可以展开“活动详情浮层”，展示同一应用时间段内的窗口标题明细。

当前实现的标题来源主要是 `sessions.window_title`。这能表达“某段 session 的标题”，但不是真正的标题变化流水：

- active session 中标题变化时，当前实现会刷新 `window_title`。
- session 合并后，前端只能从若干 session 的最终标题中推导 `titleSampleDetails`。
- 如果同一个 session 内连续切换多个网页、文件或设置页，中间标题可能被覆盖。
- 浮层看起来像“标题历史”，但数据模型本身并不保证它完整可信。

这与当前产品方向中的“可信、可读、可控”相关，属于核心回看体验与数据可信度改进，而不是装饰性 UI 调整。

## 2. 本轮目标

完成后应达到：

- 窗口标题变化被记录为独立、可查询、可裁剪的时间片段。
- 历史页浮层展示的每一行都来自真实标题采样记录，而不是仅由 session 最终标题推断。
- 用户关闭某个应用的标题记录时，不再保存该应用的新标题样本。
- 旧数据库可以安全升级，旧历史数据仍可按兼容路径显示。
- 备份、恢复、清理历史与历史读模型都覆盖标题样本数据。
- 运行时写入成本可控，不因每秒轮询产生无意义重复写入。

## 3. 非目标

- 不做 OCR、浏览器标签页 API、编辑器插件或应用内部深度集成。
- 不记录全文输入、剪贴板、网页内容或文件内容。
- 不做云同步、账号、跨设备标题历史。
- 不把标题样本做成独立搜索产品或复杂审计日志。
- 不重做历史页整体布局，不引入新的视觉方向。
- 不改变现有应用分类、统计口径、时间线合并默认规则。
- 不移除 `sessions.window_title`，它仍可作为兼容摘要字段保留。

## 4. 设计原则

- [x] 可信优先：浮层展示的标题明细必须能追溯到实际采样记录。
- [x] 本地优先：所有标题样本继续只写入本地 SQLite。
- [x] 可控优先：继续尊重每个应用的标题记录开关。
- [x] 最小数据原则：只在标题变化或 session 边界变化时写入，不做逐秒重复日志。
- [x] owner 清晰：Rust 写侧归 tracking runtime / data，前端展示归 history read model / UI。
- [x] Quiet Pro 克制：浮层继续沿用现有 Quiet Pro 浮层样式，不把标题明细做成醒目的新组件。

## 5. 推荐数据模型

新增表：

```sql
CREATE TABLE IF NOT EXISTS session_title_samples (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    start_time INTEGER NOT NULL,
    end_time INTEGER,
    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_title_samples_session_time
ON session_title_samples(session_id, start_time);

CREATE INDEX IF NOT EXISTS idx_session_title_samples_time
ON session_title_samples(start_time, COALESCE(end_time, start_time));
```

实施时需确认 SQLite 对表达式索引在当前插件环境中的兼容性。若表达式索引带来兼容风险，优先只保留：

```sql
CREATE INDEX IF NOT EXISTS idx_session_title_samples_time
ON session_title_samples(start_time, end_time);
```

字段语义：

- `session_id`：归属的 `sessions.id`。
- `title`：经过标题记录开关判断后的原始标题值；空标题不插入。
- `start_time`：该标题开始被观察到的时间戳，毫秒。
- `end_time`：该标题结束时间；当前活跃标题可为 `NULL`，session 封口时补齐。

## 6. Owner 与落点

- [x] Rust 平台采样 owner：`src-tauri/src/platform/windows/foreground.rs`
  - 继续只负责读取前台窗口标题，不承接标题样本业务规则。
- [x] Rust tracking 行为 owner：`src-tauri/src/engine/tracking/*`
  - 负责判断 session 边界、标题变化、标题样本开闭。
- [x] Rust 数据 owner：`src-tauri/src/data/repositories/*`
  - 新增或扩展 repository，承接标题样本 SQL。
- [x] Rust schema owner：`src-tauri/src/data/schema.rs`
  - 承接表结构与当前基线 schema。
- [x] 前端 SQLite 读边界 owner：`src/platform/persistence/sessionReadRepository.ts`
  - 查询 session 时带出标题样本 raw row，并映射到前端模型。
- [x] 前端 read model owner：`src/shared/lib/sessionReadCompiler.ts`
  - 负责裁剪、合并、去重、限制展示数量。
- [x] History UI owner：`src/features/history/components/History.tsx`
  - 只负责展示 `titleSampleDetails`，不做数据推断主逻辑。

禁止落点：

- [x] 不把标题样本写入逻辑放进 `commands/*`。
- [x] 不让 `lib.rs`、`app/*` 承接 SQL 或标题变化判断。
- [x] 不让 History 组件直接访问 SQLite。
- [x] 不新增根层 `src/lib/*` 或 `src/types/*`。
- [x] 不把新逻辑塞进 `shared/*` 作为临时公共桶。

## 7. 阶段 0：执行前确认

- [x] 确认当前分支工作区状态，避免覆盖用户未提交改动。
- [x] 确认当前 `sessions.window_title` 的读写路径：
  - [x] `foreground.rs` 读取标题。
  - [x] `loop_state.rs` 应用 `captureTitle` 开关。
  - [x] `transition.rs` 判断标题变化。
  - [x] `sessions.rs` 写入或刷新 `window_title`。
  - [x] `sessionReadRepository.ts` 读取历史 session。
  - [x] `sessionReadCompiler.ts` 构造 `titleSampleDetails`。
- [x] 确认备份/恢复当前只处理 `sessions`，没有标题样本表。
- [x] 确认清理历史记录当前删除 session 的路径和 SQL owner。
- [x] 确认测试基线可运行：
  - [x] `npm test`
  - [x] `npm run test:replay`
  - [x] `npm run check:rust`

## 8. 阶段 1：Schema 与迁移

- [x] 在 `src-tauri/src/data/schema.rs` 的当前 baseline schema 中新增 `session_title_samples`。
- [x] 确认 foreign key 策略：
  - [x] 推荐 `ON DELETE CASCADE`，让删除 session 时自动清理标题样本。
  - [x] 若当前 SQLite 连接未稳定启用 foreign keys，则清理逻辑必须显式删除标题样本。
- [x] 新增旧库直升保护：
  - [x] 已有数据库缺表时自动补表。
  - [x] 已有数据库有 `sessions.window_title` 时，不强制回填所有旧标题样本。
  - [x] 可选轻量回填：每条有非空 `window_title` 的旧 session 生成一个同范围 sample。
  - [x] 回填必须幂等，不能重复插入。
- [x] 新增 schema 相关 Rust 测试：
  - [x] 新安装数据库包含标题样本表和索引。
  - [x] 旧数据库升级后补齐标题样本表。
  - [x] 旧数据库重复启动不会重复回填。
  - [x] active session 归一化逻辑不被新表破坏。

## 9. 阶段 2：Rust 数据仓储

- [x] 新增 `src-tauri/src/data/repositories/session_title_samples.rs`，或在 `sessions.rs` 中添加清晰的标题样本小节。
- [x] 推荐新增独立 repository，避免 `sessions.rs` 继续变厚。
- [x] 暴露最小写侧 API：
  - [x] `start_title_sample(session_id, title, start_time)`
  - [x] `finish_active_title_sample(session_id, end_time)`
  - [x] `replace_active_title_sample(session_id, title, timestamp)`
  - [x] `finish_title_samples_for_active_sessions(end_time)`
- [x] 所有 SQL 必须参数化。
- [x] 多步操作必须事务化：
  - [x] 关闭旧 sample + 插入新 sample 同事务。
  - [x] session 封口 + sample 封口同事务，或有明确补偿策略。
- [x] 写入前规整：
  - [x] `title.trim()` 后为空则不插入。
  - [x] `start_time` 不早于 session start。
  - [x] `end_time` 不早于 `start_time`。
- [x] 新增 Rust repository 测试：
  - [x] 新标题开始时插入 sample。
  - [x] 标题不变时不重复插入。
  - [x] 标题变化时旧 sample 封口，新 sample 开始。
  - [x] session 结束时最后 sample 被封口。
  - [x] 恶意标题字符串不会破坏 SQL 或表结构。

## 10. 阶段 3：Tracking Runtime 接入

- [x] 在 active session 创建成功后，立即为非空标题创建首个 title sample。
- [x] 在同一 trackable app 内标题变化时：
  - [x] 保留现有 `window_title` 摘要刷新行为，作为兼容字段。
  - [x] 同步关闭上一条 title sample。
  - [x] 插入新 title sample。
- [x] 在 app 变化、AFK、暂停、锁屏、睡眠、watchdog、自愈封口时：
  - [x] 结束 active session 的同时结束 active title sample。
- [x] 在 `captureTitle = false` 时：
  - [x] `tracked_window.title` 继续清空。
  - [x] 不插入新 title sample。
  - [x] 如果此前存在 active title sample，必须在关闭标题记录或下一次 runtime 采样时封口。
- [x] 避免逐秒重复写入：
  - [x] 标题不变时不写 sample 表。
  - [x] 只更新 heartbeat / runtime timestamp，不更新 sample。
- [x] 新增 runtime 测试：
  - [x] 同一 app 标题变化不会切 session，但会新增 title sample。
  - [x] 同一 app 窗口实例变化且标题变化，sample 正确切换。
  - [x] 标题记录关闭后不写 sample。
  - [x] tracking pause 会封口 sample。
  - [x] lock / suspend 会封口 sample。
  - [x] watchdog seal 会封口 sample。

## 11. 阶段 4：备份、恢复、清理

- [x] 备份结构新增标题样本数据：
  - [x] 在 domain backup 类型中新增 `title_samples` 或等价字段。
  - [x] 导出时包含 `session_title_samples`。
  - [x] 恢复时按 session 关系恢复样本。
- [x] 恢复策略：
  - [x] 全量恢复先清空 `session_title_samples`，再恢复 sessions 与 samples。
  - [x] 合并恢复需避免重复 sample。
  - [x] 如果备份来自旧版本且没有 samples，恢复仍成功。
- [x] 清理历史：
  - [x] 如果 foreign key cascade 可靠，验证删除 session 后 sample 自动删除。
  - [x] 如果不依赖 cascade，清理路径先删 sample 再删 session。
- [x] 新增测试：
  - [x] 新备份包含标题样本。
  - [x] 旧备份没有标题样本也能恢复。
  - [x] 合并恢复不会重复插入相同 sample。
  - [x] 清理历史会删除对应标题样本。

## 12. 阶段 5：前端类型与读取

- [x] 扩展 `src/shared/types/sessions.ts`：
  - [x] 为 `HistorySession` 增加 `titleSampleDetails?: TitleSampleDetail[]`，或新增稳定类型后复用。
  - [x] 字段名保持前端 `camelCase`。
- [x] 扩展 `src/platform/persistence/sessionReadRepository.ts`：
  - [x] 查询目标 range 内 session。
  - [x] 查询这些 session 对应的 title samples。
  - [x] raw row 只停留在 platform/persistence 内部。
  - [x] 映射为前端模型后再返回。
- [x] 查询策略建议：
  - [x] 先查 session 列表。
  - [x] 若 session id 为空，直接返回。
  - [x] 再用 session id 集合查 samples。
  - [x] 注意 SQLite 参数数量；如果未来 session 数很多，分批查询。
- [x] 对旧数据兼容：
  - [x] 若 session 没有 samples，但 `windowTitle` 非空，read model 可继续生成一条兼容 sample。
  - [x] 兼容 sample 只能用于旧数据或异常缺 sample 的 session；新采样链路不得依赖它表达真实标题明细。
  - [x] 兼容 sample 允许显示为整段 session 标题，因为旧数据没有更细时间片；如后续 UI 需要区分，可在模型里保留 `source: "legacy-window-title"` 这类内部标记。
  - [x] 兼容逻辑放在 read model 或 mapper，不能放在 UI 组件里。
- [x] 新增前端 persistence / read model 测试：
  - [x] sample raw row 正确映射。
  - [x] 无 samples 的旧 session 仍能显示旧标题。
  - [x] 有 samples 时优先使用 samples。

## 13. 阶段 6：Read Model 合并与裁剪

- [x] 更新 `sessionReadCompiler.ts`：
  - [x] `prepareSession` 优先使用 session 自带 sample details。
  - [x] 对 sample 按当前 range 裁剪。
  - [x] 对相同标题只合并连续、重叠或间隔极短的相邻 sample。
  - [x] 禁止把同一标题在不同时间出现的首尾时间直接拉成一个大跨度。
  - [x] 空标题过滤。
  - [x] 单个 timeline 合并块最多保留 6 条展示样本。
- [x] 保留现有清理逻辑：
  - [x] `cleanWindowTitle` 继续清理常见浏览器/IDE后缀。
  - [x] 标题等于应用显示名时不展示。
- [x] 合并规则：
  - [x] session 直接合并时合并 sample details。
  - [x] timeline 跨间隔合并时合并 sample details。
  - [x] 被 range 裁剪后 start/end 不合法的 sample 丢弃。
- [x] 防止标题时间膨胀：
  - [x] 一个 sample 的 `startTime/endTime` 必须来自真实采样片段或裁剪后的真实片段。
  - [x] 不允许用 timeline 合并块的 `startTime/endTime` 覆盖单个标题 sample 的时间。
  - [x] 不允许因为标题重复，就把中间隔着其他标题的两段合并成一段。
  - [x] 若 active sample 的 `endTime` 为空，只能以当前 `nowMs` 或 session end 作为临时展示终点。
  - [x] 若 sample 时间缺失或不可信，优先丢弃该 sample；只有旧 `windowTitle` fallback 可以退化为整段 session 标题。
- [x] 新增测试：
  - [x] 标题样本跨 session 合并保留不同时间段。
  - [x] 相同标题连续出现时去重并扩展时间范围。
  - [x] 相同标题非连续出现时保留为两条，不拉成一个覆盖中间时间的大段。
  - [x] 任何标题 sample 不会被扩展到整个 timeline 合并块，除非它是明确的旧 `windowTitle` fallback。
  - [x] 超过 6 条时保留稳定顺序与上限。
  - [x] range 裁剪后样本时间不越界。
  - [x] 旧 `windowTitle` fallback 不被破坏。

## 14. 阶段 7：History UI 展示

- [x] `History.tsx` 继续消费 `session.titleSampleDetails`。
- [x] UI 组件不直接推断数据库字段来源。
- [x] 当没有可展示标题时隐藏详情按钮。
- [x] 当标题记录关闭造成无标题样本时，不显示空浮层。
- [x] 保持现有浮层行为：
  - [x] `createPortal(..., document.body)`。
  - [x] fixed positioning。
  - [x] 空间不足时向上展开。
  - [x] 点击外部 / Escape / 滚动关闭。
- [x] 保持 Quiet Pro：
  - [x] 不新增强视觉容器。
  - [x] 不引入大阴影、重模糊、彩色强调背景。
  - [x] 只在必要时微调 `.history-activity-popover-*`。
- [x] 补 UI smoke 或组件测试：
  - [x] 有多个标题样本时能渲染多行。
  - [x] 无标题样本时不出现详情按钮。
  - [x] 长标题换行不撑破浮层。

## 15. 阶段 8：应用映射标题开关语义

- [x] 复核 App Mapping 中“记录标题 / 不记录标题”的文案是否仍准确。
- [x] 关闭标题记录时，明确它影响后续标题样本记录。
- [x] 不在本轮新增大段说明文案。
- [x] 如需提示，优先复用现有 Quiet Pro tooltip / badge / status 原型。
- [x] 测试标题开关：
  - [x] 设置保存后 runtime 读取生效。
  - [x] 关闭后不产生新 title sample。
  - [x] 重新开启后从下一次可见标题开始记录。

## 16. 阶段 9：性能与数据增长控制

- [x] 写入频率：
  - [x] 同一标题连续停留时只写一次。
  - [x] 标题高频变化时按变化写入，不逐秒补重复。
- [x] 读模型：
  - [x] history 查询避免 N+1。
  - [x] samples 查询受 session id 范围限制。
  - [x] 合并前过滤空标题和不可见样本。
- [x] 数据增长：
  - [x] 标题样本随清理历史一起删除。
  - [x] 备份体积增加可解释。
  - [x] 不新增单独 retention 设置，除非后续真实需求出现。
- [x] 可选性能验证：
  - [x] `npm run perf:history-read-model`
  - [x] 对比有 samples / 无 samples 的 history read model 成本。

## 17. 阶段 10：验证清单

局部开发期间建议逐步运行：

- [x] Rust schema / repository 局部测试。
- [x] Rust tracking runtime 相关测试。
- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run test:data`
- [x] `npm run test:persistence`
- [x] `npm run test:interaction`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run build`
- [x] `npm run check:rust`

交付前最低门槛：

- [x] `npm run check`
- [x] `npm run check:rust`

如果合并为发布候选：

- [x] `npm run check:full`
- [x] 更新 `CHANGELOG.md` 的 `Unreleased`
- [x] 按实际变化判断版本类型，不预设 patch/minor

## 18. 手工验收场景

- [x] 打开 Chrome，在同一个 Chrome session 内切换多个网页标题，历史浮层显示多个标题时间片段。
- [x] 在 Chrome 中先打开标题 A，再切到标题 B，再切回标题 A，历史浮层不得把标题 A 显示成覆盖 A-B-A 的整段时间。
- [x] 打开 VSCode/VSCodium/Antigravity，在同一应用内切换文件，历史浮层显示文件标题变化。
- [x] 关闭某个应用的标题记录，继续使用该应用，历史浮层不新增后续标题。
- [x] 重新开启标题记录，后续新标题重新出现。
- [x] 锁屏或暂停追踪后，最后一条标题 sample 被正确封口。
- [x] 清理一段历史后，对应标题样本不再残留。
- [x] 从旧备份恢复后，旧记录仍能显示兼容标题摘要。
- [x] 从新备份恢复后，标题明细完整保留。
- [x] 长标题不会溢出历史浮层。
- [x] 历史页滚动时浮层关闭或重定位行为保持现状。

## 19. 风险与回滚策略

主要风险：

- [x] 标题样本表增长过快。
- [x] session 封口时 sample 未封口，导致历史时间范围异常。
- [x] 旧库升级或旧备份恢复漏处理新表。
- [x] 清理历史后 sample 残留。
- [x] 前端 read model 误把 sample 时间算入 duration。

缓解策略：

- [x] 只在标题变化时写入。
- [x] session 封口路径统一补 sample 封口。
- [x] schema repair 覆盖旧库缺表。
- [x] 备份恢复测试覆盖有 samples / 无 samples 两类备份。
- [x] read model 中 sample 只作为展示明细，不参与 duration 统计。

回滚策略：

- [x] 保留 `sessions.window_title` 作为兼容摘要字段。
- [x] 若 sample 读路径出问题，可临时回退到旧 `windowTitle` fallback。
- [x] 不删除旧字段，不破坏旧历史 session 的基本展示。

## 20. 完成定义

本执行单完成时必须同时满足：

- [x] 数据库存在稳定的 `session_title_samples` 表及索引。
- [x] Rust runtime 能在标题变化时写入可信 sample。
- [x] 所有 session 封口路径会封口 active title sample。
- [x] 标题记录开关控制 sample 写入。
- [x] 备份、恢复、清理历史覆盖 sample 表。
- [x] History 浮层展示来自 sample details，并兼容旧数据。
- [x] 默认验证门槛通过。
- [x] `CHANGELOG.md` 按用户可理解方式记录变化。
- [x] 本执行单移动到 `docs/archive/`，如有长期规则变化再回写顶层长期文档。
