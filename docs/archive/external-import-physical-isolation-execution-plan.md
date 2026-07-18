# 外部导入数据物理隔离执行方案

状态：已完成并归档

## 目标

从第一性原理出发，Patina 本机采集数据与外部导入数据具有不同所有者：

- `sessions` 只由 Patina tracking 主链拥有。
- `import_*` 只由外部导入子系统拥有。
- 删除某次外部导入必须只删除该批次拥有的数据，SQL 不得以任何形式删除、更新或重写 `sessions`。
- 页面可以在读取阶段组合两类数据，但持久化所有权不能因展示方便而混合。

## 非目标

- [x] 不改变 Patina 通用 CSV v1 的字段合同。
- [x] 不把小时汇总伪造成精确时间轴。
- [x] 不增加旧、新导入结构长期并存的兼容层。
- [x] 不修改分类设置、图标缓存、Web 活动、备份或 tracking 行为。
- [x] 不提交、不推送、不关闭 #50。

## 执行前事实

- [x] #50 的有效实现已经提炼进 `main`，本任务在该实现上继续安全收口，不再合并外部 PR。
- [x] 当前 `import_time_buckets` 已与 `sessions` 分离。
- [x] 当前精确外部会话仍写入 `sessions`，再由 `import_exact_records.session_id` 标记所有权。
- [x] 当前批次删除会对 `sessions` 执行带子查询的 `DELETE`；正常数据下不会删除本机记录，但不满足物理隔离不变量。
- [x] live Project 中“建立通用时间记录导入能力”当前已经位于 `In progress`。

## 目标结构

- [x] 新增最终表 `import_exact_sessions`，直接保存外部精确会话事实。
- [x] `import_exact_sessions` 只外键关联 `import_batches`，不得关联 `sessions`。
- [x] `import_time_buckets` 继续只外键关联 `import_batches`。
- [x] 删除批次只删除 `import_batches`，依靠 `import_*` 内部外键级联。
- [x] 最终 schema 不保留 `import_exact_records`。
- [x] History 读取 `sessions + import_exact_sessions`，但继续排除 `import_time_buckets`。
- [x] Dashboard、Data 与 Classification 按可用粒度读取本机会话、外部精确会话和外部小时汇总。

## 执行步骤

### 1. 测试先行

- [x] 增加仓库测试：导入精确会话后 `sessions` 行数不变。
- [x] 增加仓库测试：精确事实只写入 `import_exact_sessions`。
- [x] 增加仓库测试：删除批次后本机 `sessions` 内容逐字段不变。
- [x] 增加静态合同测试：批次删除实现不得包含 `DELETE FROM sessions`。
- [x] 增加读取合同测试：History 联合 `import_exact_sessions`，但不联合 `import_time_buckets`。
- [x] 增加迁移测试：旧第 6 步结构中的外部精确会话被完整搬移，原本的本机会话保持不变。
- [x] 先运行新增测试并记录预期失败，证明测试能捕获当前混表设计。

### 2. 数据库迁移

- [x] 保留已经发布到 `main` 的第 6 步 migration 内容与 checksum。
- [x] 新增第 7 步 migration，创建 `import_exact_sessions` 及必要索引。
- [x] 第 7 步在同一迁移事务中复制旧外部精确事实、移除旧外部 session 行并删除 `import_exact_records`。
- [x] 第 7 步遇到不完整或不一致的旧关联时失败关闭，不静默丢弃数据。
- [x] schema 完整性检查覆盖新表列、索引、外键方向、guard 退出和旧表退出事实。
- [x] migration history 归一化只补齐真实缺失步骤，不误标第 7 步完成。

### 3. 写入与删除 owner 收口

- [x] 精确导入直接写 `import_exact_sessions`。
- [x] 不再写 `sessions` 或 `session_title_samples`。
- [x] 去重指纹从 `import_exact_sessions + import_time_buckets` 读取。
- [x] 批次计数从隔离表读取。
- [x] 删除只参数化删除 `import_batches`，不存在对核心表的写操作。
- [x] 所有写入和删除继续使用单事务，失败完整回滚。

### 4. 读取模型按需组合

- [x] History 查询把外部精确会话映射为现有 `HistorySession` 形状。
- [x] History 标题详情只使用外部精确记录自带标题，不制造不存在的标题样本。
- [x] Dashboard 与 Data 汇总同时包含本机会话、外部精确会话和小时汇总。
- [x] Classification 应用发现和统计同时包含三类事实。
- [x] 最早记录时间同时考虑三类事实。
- [x] 所有删除本机数据的现有命令继续只作用于 `sessions`，不会顺带删除外部数据。

### 5. 验证

- [x] 新增失败测试转绿。
- [x] `npm run test:import` 通过（6/6）。
- [x] Rust 导入与迁移专项测试通过。
- [x] `npm run check:full` 通过（403 passed、1 ignored；浏览器烟测 43/43）。
- [x] `git diff --check` 通过。
- [x] 使用真实本地 `patina.db` 前记录 integrity、foreign key、session 数量与 import 数量（执行前记录：sessions 57335，三类 import 均为 0）。
- [x] 启动迁移后确认 integrity 与 foreign key 正常，本机 session 数量不因空导入迁移减少（最终复核：integrity `ok`、foreign key 无错误、sessions 57441，三类 import 均为 0；增长来自运行中的正常 tracking）。

### 6. 对抗式审查

- [x] 搜索生产代码，确认批次删除链路不存在 `DELETE FROM sessions`。
- [x] 构造本机记录与外部记录同 exe、同时间的碰撞场景，删除外部批次后本机记录仍完整。
- [x] 构造第二批次，确认删除第一批不影响第二批。
- [x] 构造迁移失败场景，确认不完整旧关联不会被静默吞掉。
- [x] 检查外键方向，确认不存在从 `import_*` 级联到 Patina 核心表的路径。
- [x] 检查读取页面，确认无可用粒度时不制造展示数据。
- [x] 审查发现 schema 验证未检查外键方向与 guard 残留；补齐拒绝规则及两个回归测试后，相关测试与完整门禁重新通过。

### 7. 收尾与归档

- [x] 将所有已完成项目勾选。
- [x] 将状态改为“已完成并归档”。
- [x] 移入 `docs/archive/`，不留在 `docs/working/`。
- [x] 复核 live Project 并报告维护者应执行的状态拖动及 `Next` 窗口建议。

## 完成判据

只有同时满足以下条件，任务才算彻底完成：

- [x] 外部精确会话、小时汇总和批次元数据全部由 `import_*` 表拥有。
- [x] 删除外部批次在代码、SQL 与外键三个层面都无法删除 Patina 本机记录。
- [x] 旧第 6 步数据安全迁移到唯一最终结构。
- [x] 所有按需展示行为保持正确。
- [x] 完整门禁和对抗式审查均通过。
- [x] 执行单已勾选归档。

## 最终结果

- TDD 先证明旧结构会失败：History 未读取隔离精确表，且导入后 `sessions` 行数发生变化。
- 第 7 步迁移把旧外部精确事实移入 `import_exact_sessions`；迁移不一致时整个事务失败关闭。
- 批次删除只删除 `import_batches`，外部子表在自身所有权范围内级联，核心 `sessions` 没有删除路径。
- 对抗式审查额外补强 schema 外键方向与 migration guard 残留校验。
- 未提交、未推送、未关闭或合并 #50。
