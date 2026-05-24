# 综合评分 9.0+ 执行方案

## 1. 文档定位

本文是一次性执行计划，目标是把当前 `1.1.0` 候选状态从综合约 `8.2 / 10` 提升到 `9.0+ / 10`。

它不是长期规则文档。执行完成后，应按仓库文档卫生规则归档到 `docs/archive/`。

## 2. 当前基线

当前状态基于最近一次真实检查：

- 综合评分：`8.2 / 10`
- 架构评分：`8.4 / 10`
- 前端验证：`npm run check` 已通过
- Rust 验证：`npm run check:rust` 已通过
- 主进程内存：约 `94-104 MB Working Set`，约 `61-64 MB Private`
- 当前预期版本：`1.1.0`

当前主要加分项：

- 窗口标题采样已经形成可用闭环。
- Rust 写侧、SQLite 独立表、前端 read model、History UI 基本串通。
- 备份、恢复、清理和标题记录开关联动已有覆盖。
- 前端与 Rust 自动化验证均通过。

当前主要扣分项：

- History 时间线中 `活动 / 标题` chip 仍有少量内部指标感，需要真实视口巡检与微调。
- 标题样本属于隐私敏感数据，但产品说明、设置提示、备份提示还不够完整。
- 标题样本长期增长策略尚未明确，缺少数据量预算与退化场景验证。
- schema / restore / legacy repair 已可用，但发布级迁移证据还可以更硬。
- `1.1.0` 发布收口尚未完成，仍停留在候选开发状态。

## 3. 目标评分口径

完成后应达到：

- 综合评分：`>= 9.0 / 10`
- 架构评分：`>= 8.8 / 10`
- UI / 产品体验：`>= 8.8 / 10`
- 数据安全与隐私说明：`>= 9.0 / 10`
- 发布准备度：`>= 9.0 / 10`

目标不是“加更多功能”，而是让当前窗口标题采样能力更可信、更清楚、更可长期维护。

## 4. 非目标

- [x] 不引入云同步、账号、团队协作或 SaaS 方向。
- [x] 不做大型页面改版或新视觉方向。
- [x] 不为 `History` 单页新增不可复用的强视觉风格。
- [x] 不破坏已发布 `1.0.x` 数据兼容性。
- [x] 不把标题样本逻辑回流到页面组件、`app/*`、Rust `commands/*` 或 `lib.rs`。

## 5. 阶段 A：确认评分基线与发布范围

目标：把“为什么是 8.2，怎么到 9.0”变成可追踪事实。

- [x] 记录当前完整 diff 范围。
  - 命令：`git diff --stat`
  - 验收：确认窗口标题采样相关变更范围没有混入无关重构。
- [x] 确认最近已发布版本。
  - 命令：`git log --oneline --decorate --max-count=20`
  - 验收：明确本轮发布基于 `1.0.1 -> 1.1.0`。
- [x] 整理本轮用户可感知变化清单。
  - 文件：`CHANGELOG.md`
  - 验收：清单只写最终结果，不写中间 UI 试错过程。
- [x] 标注本计划初始评分。
  - 当前综合：`8.2`
  - 当前架构：`8.4`
  - 目标综合：`9.0+`

## 6. 阶段 B：History 标题详情 UI 打磨

目标：让历史页标题详情入口达到“用户能扫懂，不抢主信息，不挤压时长”的水平。

### B1. chip 语义与视觉

- [x] 复核 `活动 N · 标题 M` 是否是最终常驻文案。
  - 文件：`src/shared/copy/uiText.ts`
  - 验收：中文和英文都足够短；英文不导致常见行溢出。
- [x] 复核 chip 与应用名、箭头按钮的垂直对齐。
  - 文件：`src/features/history/components/History.tsx`
  - 验收：白框下沿与应用名视觉下沿一致，箭头不漂浮。
- [x] 复核 chip 与箭头按钮的关系。
  - 验收：箭头贴近 `标题 M`，用户能理解它展开标题详情。
- [x] 复核无标题样本时的展示策略。
  - 验收：`标题 0` 不应给出可展开按钮；如果展示 `标题 0`，必须不暗示可点。
- [x] 复核长应用名场景。
  - 验收：应用名优先截断，chip 和右侧时长不被挤出。
- [x] 复核英文场景。
  - 验收：`Act N · Titles M` 在窄窗口下仍不挤压时长。

### B2. 详情浮层

- [x] 复核浮层标题。
  - 当前建议：`标题详情` / `Title details`
  - 验收：浮层标题解释的是窗口标题明细，不再叫活动详情。
- [x] 复核长列表滚动。
  - 文件：`src/styles/quiet-pro.css`
  - 验收：大量标题样本时浮层保持 `max-height` 与滚动，不溢出窗口。
- [x] 复核标题重复合并结果。
  - 验收：连续相同标题合并；中间隔着其他标题时不错误合并。
- [x] 复核标题清洗效果。
  - 验收：常见 `- AppName` 后缀不会让标题列表噪音过高。

### B3. 真实视口巡检

- [x] 用真实浏览器 smoke 或本地应用检查 900px 最小宽度。
  - 验收：History 时间线无横向溢出。
- [x] 检查 1100px 默认宽度。
  - 验收：chip、箭头、时长之间层级稳定。
- [x] 检查英文 UI。
  - 验收：英文不破坏行高、间距和右侧时长可读性。
- [x] 检查高数据量日期。
  - 验收：滚动流畅，浮层定位不遮挡严重。

## 7. 阶段 C：标题样本隐私与控制力补强

目标：标题样本不只是能记录，还要让用户知道它是什么、如何控制、如何被备份和清理。

### C1. 设置页说明

- [x] 检查标题记录开关当前说明。
  - 文件候选：`src/features/settings/components/*`
  - 验收：说明明确“窗口标题可能包含网页、文件名或文档名”。
- [x] 补充关闭后的行为说明。
  - 验收：用户知道关闭后不再保存新的标题样本，但既有历史是否保留要说清楚。
- [x] 补充清空标题/清理历史的说明。
  - 文件候选：`src/platform/persistence/settingsPersistence.ts`、设置页 copy
  - 验收：清理动作与标题样本删除行为一致且可解释。

### C2. 备份与恢复说明

- [x] 在备份相关 UI 或 changelog 中说明标题样本会进入备份。
  - 验收：用户不会误以为备份只包含应用级时长。
- [x] 恢复预览或恢复说明中提及标题样本。
  - 验收：恢复新备份后标题详情可保留这件事对用户透明。
- [x] 确认旧备份恢复行为。
  - 验收：没有标题样本的旧备份仍可恢复，不出现误导性错误。

### C3. 隐私风险口径

- [x] 为 release note 准备一句用户可读的隐私说明。
  - 建议口径：标题明细用于历史回看，仍保存在本地，并可通过标题记录开关控制后续保存。
- [x] 确认不扩大数据出站范围。
  - 验收：没有新增网络上传、账号或云端依赖。

## 8. 阶段 D：标题样本数据增长与性能预算

目标：把“长期运行会不会变重”从感觉变成预算和验证。

### D1. 数据量预算

- [x] 定义标题样本合理增长假设。
  - 示例：高频切换用户每天 `500-3000` 条标题样本。
  - 验收：计划中明确正常、偏高、异常三个数据量区间。
- [x] 评估现有索引是否覆盖高频查询。
  - 文件：`src-tauri/src/data/schema.rs`
  - 验收：History 范围查询能使用 `session_id/start_time` 或 `start_time/end_time` 索引。
- [x] 检查读取批量大小。
  - 文件：`src/platform/persistence/sessionReadRepository.ts`
  - 验收：`IN` 批量不超过 SQLite 参数风险，且大日期范围可接受。

### D2. 压力测试与基准

- [x] 增加或运行 History read model 性能基准。
  - 命令：`npm run perf:history-read-model`
  - 验收：记录标题样本前后或高样本量场景的耗时。
- [x] 增加大量标题样本 fixture。
  - 文件候选：`tests/trackingLifecycle/*` 或 perf fixture
  - 验收：至少覆盖多 session、多 title、重复 title、跨天 clipping。
- [x] 检查 bundle 预算。
  - 命令：`npm run check:bundle`
  - 验收：标题详情 UI 不引入明显新依赖。

### D3. 保留策略判断

- [x] 判断是否需要本轮实现标题样本保留策略。
  - 默认建议：如果性能和数据库体积可控，本轮不新增保留策略，只记录后续观察项。
  - 验收：有明确决定，而不是遗留成隐性风险。
- [x] 本轮不需要实现标题样本保留策略；如后续观察到真实增长压力，再先写边界判断再实现。
  - 非目标：不做复杂隐私中心或规则引擎。

## 9. 阶段 E：迁移、备份、恢复硬化

目标：让 schema 变化和备份恢复达到发布级可信。

### E1. 旧库直升

- [x] 覆盖没有 `session_title_samples` 表的旧库。
  - 文件：`src-tauri/src/data/sqlite_pool.rs`
  - 验收：启动 repair 后表和索引存在，旧 sessions 保留。
- [x] 覆盖旧库已有 active session 的场景。
  - 验收：active session 归一化不破坏标题样本表创建。
- [x] 覆盖不完整 schema。
  - 验收：不误标为当前 baseline，不丢历史数据。

### E2. 备份导出

- [x] 验证新备份包含 `data/session_title_samples.json`。
  - 文件：`src-tauri/src/data/backup.rs`
  - 验收：导出的标题样本字段完整：`id/session_id/title/start_time/end_time`。
- [x] 验证空标题样本导出。
  - 验收：没有标题样本时备份结构仍稳定。

### E3. 备份恢复

- [x] 覆盖旧备份恢复。
  - 验收：没有标题样本文件的备份恢复成功。
- [x] 覆盖新备份 replace 恢复。
  - 验收：恢复后标题样本与 sessions 对齐，不残留旧样本。
- [x] 覆盖 merge 恢复。
  - 验收：不会重复插入同一 session/title/time 样本。
- [x] 覆盖孤儿样本。
  - 验收：不存在 session 的标题样本不应破坏恢复。

## 10. 阶段 F：架构收口复核

目标：架构评分从 `8.4` 提升到 `8.8+`，重点是证明没有新回流。

- [x] Rust 写侧 owner 复核。
  - 验收：标题样本写入留在 `engine/tracking/*` 编排与 `data/repositories/*` 仓储，不进 `commands/*`。
- [x] 前端读侧 owner 复核。
  - 验收：SQLite raw row 只在 `platform/persistence/sessionReadRepository.ts` 内部存在。
- [x] UI owner 复核。
  - 验收：History 组件只消费 compiled model，不直接读 DB 或拼 SQL。
- [x] shared 使用复核。
  - 验收：`sessionReadCompiler` 保持稳定共享读模型逻辑，不承接平台细节。
- [x] backup owner 复核。
  - 验收：domain 类型和 data 读写边界清楚，不互相反向依赖。
- [x] 删除不必要的兼容壳或测试 helper。
  - 验收：保留的 test-only wrapper 均有 `#[cfg(test)]`。
- [x] 跑架构门禁。
  - 命令：`npm run check:architecture`
  - 命令：`npm run check:rust-boundaries`

## 11. 阶段 G：真实使用巡检

目标：补自动化测试很难覆盖的真实质感问题。

### G1. 窗口标题采样主路径

- [x] Chrome 连续切换多个网页。
  - 验收：History 中同一时间线项能看到多个标题。
- [x] VSCodium 切换多个文件。
  - 验收：重复同一文件不会刷屏，中间切到其他文件后能保留非连续段。
- [x] 抖音 / 视频类应用低交互使用。
  - 验收：标题样本不影响原有持续参与/活动保持逻辑。
- [x] 微信 / 聊天类应用。
  - 验收：无标题或敏感标题场景不导致 UI 误导。

### G2. 设置控制主路径

- [x] 对某应用关闭标题记录后继续使用。
  - 验收：后续不再新增该应用标题样本。
- [x] 重新开启标题记录。
  - 验收：从后续可见标题继续记录，不回填关闭期间标题。
- [x] 清空窗口标题。
  - 验收：对应标题样本同步清理。
- [x] 清理历史记录。
  - 验收：sessions 和 title samples 一致删除。

### G3. 备份恢复主路径

- [x] 导出包含标题样本的新备份。
- [x] 恢复新备份。
- [x] 恢复旧备份。
- [x] 检查恢复后的 History 标题详情。

## 12. 阶段 H：发布收口到 1.1.0

目标：从“候选功能完成”进入“可发布状态”。

- [x] 确认版本号为 `1.1.0`。
  - 文件：`package.json`
  - 文件：`package-lock.json`
  - 文件：`src-tauri/tauri.conf.json`
  - 文件：`src-tauri/Cargo.toml`
- [x] 更新长期版本文档当前版本字段。
  - 文件：`docs/versioning-and-release-policy.md`
- [x] 整理 `CHANGELOG.md`。
  - 验收：`Unreleased` 落成 `[1.1.0] - YYYY-MM-DD`。
  - 验收：`Release:`、`App note:`、`App note en:` 都是用户语言。
- [x] 新建空 `Unreleased`。
- [x] 运行 changelog 校验。
  - 命令：`npm run release:validate-changelog -- 1.1.0`
- [x] 运行完整发布前校验。
  - 命令：`npm run release:check`
- [x] 准备 release note 摘要。
  - 验收：3-6 条用户可感知变化，不直接搬 Internal。

## 13. 阶段 I：最终评分复核

目标：只有真实达到 9.0+ 才结束。

- [x] 复核综合评分。
  - UX：`>= 8.8`
  - 数据安全：`>= 9.0`
  - 架构：`>= 8.8`
  - 验证：`>= 9.0`
  - 发布准备：`>= 9.0`
- [x] 复核剩余风险。
  - 验收：没有高严重级别未处理项。
- [x] 复核是否仍有未解释的大 diff。
  - 命令：`git diff --stat`
- [x] 复核无关改动。
  - 命令：`git status --short`
- [x] 记录最终验证命令结果。
  - `npm run check`
  - `npm run check:rust`
  - `npm run release:validate-changelog -- 1.1.0`
  - `npm run release:check`

最终记录：

- 综合评分：`9.1 / 10`
- 架构评分：`8.9 / 10`
- UI / 产品体验：`9.0 / 10`
- 数据安全与隐私说明：`9.1 / 10`
- 发布准备度：`9.2 / 10`
- `npm run perf:history-read-model`：通过；`4900` 段会话、`19600` 条标题样本，当前完整 read model 平均 `94.60ms`，预算 `170ms`。
- `npm run check`：通过；首次沙箱内在 UI smoke 的 esbuild spawn 处遇到 `EPERM`，提权重跑通过。
- `npm run check:rust`：通过；Rust 测试 `141 passed`，clippy `-D warnings` 通过。
- `npm run release:validate-changelog -- 1.1.0`：通过。
- `npm run release:check`：通过；含前端完整检查、Rust 完整检查与 changelog 校验。
- `npm run test:ui-browser-smoke`：通过；覆盖 History 中文 `900px / 1100px`、长应用名、多标题详情滚动与英文 `Titles N` chip。

## 14. 完成与归档

- [x] 所有必须项完成后，将本文从 `docs/working/` 移动到 `docs/archive/`。
- [x] 归档前确认本文勾选状态反映真实结果。
- [x] 如果执行中产生长期规则变化，只更新对应长期文档，不把临时经验留在本执行单里。

## 15. 9.0+ 的最低完成线

如果时间有限，至少完成以下项目后才允许声称达到 `9.0+`：

- [x] History UI 在中文、英文、窄窗口、长应用名、多标题下真实巡检通过。
- [x] 标题样本隐私与备份说明补齐。
- [x] 标题样本数据增长经过性能或压力验证。
- [x] 旧库直升、新旧备份恢复、清理路径都有测试或真实验证。
- [x] 架构门禁、前端完整检查、Rust 完整检查全部通过。
- [x] `1.1.0` changelog 与 release 文案完成发布级收口。
