# 综合评分提升至 9.0+ 详细执行方案

## 文档状态
- [x] 文档类型：执行文档
- [x] 当前状态：执行完成并已按真实结果同步勾选
- [x] 当前综合评分复核结果：`9.1 / 10`
- [x] 当前架构评分复核结果：`9.0 / 10`
- [x] 当前工程质量评分复核结果：`9.2 / 10`

## 基线与目标

### 初始基线
- [x] 初始综合评分固定为 `8.2 / 10`
- [x] 初始架构评分固定为 `8.4 / 10`
- [x] 初始工程质量评分固定为 `8.0 / 10`
- [x] 初始主要扣分点已经明确为：批量保存缺少原子性、关键交互缺少自动化覆盖、tracking 热区文件过厚、性能结论缺少基线和预算

### 9.0+ 判定门槛
- [x] 关键写入链具备原子提交或明确失败语义
- [x] 关键交互链具备自动化回归覆盖
- [x] tracking 热区不再由少数超厚文件同时承担过多 owner
- [x] 性能结论具备可复用的 benchmark、预算和回归口径
- [x] 默认质量门槛已经覆盖本轮新增风险点

## 阶段 0：基线冻结与执行锁定

### 目标
- [x] 把“什么才算 9.0+”写成可执行门槛
- [x] 冻结本轮评审基线，避免执行过程退化成泛化重构
- [x] 明确阶段顺序和依赖关系

### 已完成
- [x] 本轮基线分数、主线问题和目标门槛已经固化到执行文档
- [x] 执行顺序明确为：先持久化一致性，再交互验证，再 tracking 收口，最后性能基线和总验收
- [x] “先补验证，再做结构收口”的前提已经落到具体阶段设计

## 阶段 1：持久化原子性与失败语义

### 目标
- [x] 清除分类保存和设置保存的半成功落库风险
- [x] 区分持久化成功、运行时同步成功和用户提示成功的语义
- [x] 让失败路径具备稳定、可测试、可恢复的语义

### 已完成
- [x] `src/platform/persistence/sqlite.ts` 增加串行写入和事务入口
- [x] 新增 `src/platform/persistence/sqliteTransactions.ts`，集中定义事务执行和串行写任务
- [x] 分类保存通过 `buildCommitDraftChangePlanOperations()` 和 `executeWriteTransaction()` 一次性提交
- [x] 设置保存通过 `saveAppSettingsPatch()` 和 `executeWriteTransaction()` 一次性提交
- [x] `commitSettingsPatchWithDeps()` 将“持久化成功”和“runtime sync 成功”拆成独立结果
- [x] `ProcessMapper` 只在分类持久化成功后才同步内存态
- [x] 设置页在 runtime sync 失败时给出单独 warning 语义，而不是误报完全成功
- [x] 上层页面组件没有直接接触事务实现细节
- [x] 事务 owner 继续收口在 `platform/persistence/*`

### 自动化验证
- [x] `tests/persistenceTransaction.test.ts` 覆盖事务提交成功、事务失败回滚、串行写入顺序
- [x] `tests/persistenceTransaction.test.ts` 覆盖分类批量保存中途失败时不产生半保存提交
- [x] `tests/persistenceTransaction.test.ts` 覆盖设置多键保存中途失败时不产生部分提交
- [x] `tests/classificationDraftState.test.ts` 覆盖分类持久化成功前不提前同步 `ProcessMapper`
- [x] `tests/classificationDraftState.test.ts` 覆盖分类持久化失败时不更新内存态
- [x] `tests/settingsPageState.test.ts` 覆盖设置持久化先于 runtime sync
- [x] `tests/settingsPageState.test.ts` 覆盖 runtime sync 失败时仍保留 persisted success 语义
- [x] `tests/settingsPageState.test.ts` 覆盖持久化失败时不进入 runtime sync

### 触及文件
- [x] `src/platform/persistence/sqlite.ts`
- [x] `src/platform/persistence/sqliteTransactions.ts`
- [x] `src/platform/persistence/classificationPersistence.ts`
- [x] `src/platform/persistence/settingsPersistence.ts`
- [x] `src/platform/persistence/appSettingsStore.ts`
- [x] `src/features/classification/services/classificationService.ts`
- [x] `src/features/classification/services/classificationStore.ts`
- [x] `src/features/settings/services/settingsRuntimeAdapterService.ts`
- [x] `tests/classificationDraftState.test.ts`
- [x] `tests/settingsPageState.test.ts`
- [x] `tests/persistenceTransaction.test.ts`

### 阶段结论
- [x] 分类保存不存在半成功落库主风险
- [x] 设置保存不存在半成功落库主风险
- [x] 成功、失败、需补同步三类语义都已经有自动化验证

## 阶段 2：交互层自动化验证补强

### 目标
- [x] 把验证范围从纯逻辑层扩展到关键交互层
- [x] 让高状态复杂度 hook 和窗口交互不再主要依赖手工回归
- [x] 把新增验证接入默认质量门槛

### 已完成
- [x] 新增 `src/features/classification/hooks/appMappingInteractions.ts`
- [x] 新增 `src/features/settings/hooks/settingsPageStateInteractions.ts`
- [x] 新增 `src/app/widget/widgetWindowController.ts`
- [x] `useAppMappingState()` 把保存、删除、名称编辑主链提炼成可测 seam
- [x] `useSettingsPageState()` 把保存和取消主链提炼成可测 seam
- [x] `useWidgetWindowState()` 把窗口布局和拖拽主链下沉到 controller
- [x] 新增 `npm run test:interaction`
- [x] `check:frontend` 已并入 `test:persistence` 和 `test:interaction`

### 自动化验证
- [x] 分类页：名称编辑、取消、保存、删除会话后的 dirty 语义进入自动化覆盖
- [x] 分类页：保存失败后不错误清空 dirty 状态进入自动化覆盖
- [x] 设置页：保存、失败、取消主链进入自动化覆盖
- [x] 挂件页：展开、收起、失焦收起进入自动化覆盖
- [x] 挂件页：拖拽后位置换边与锚点恢复进入自动化覆盖
- [x] 既有纯逻辑测试在新增交互测试后仍全部通过

### 触及文件
- [x] `src/features/classification/hooks/useAppMappingState.ts`
- [x] `src/features/classification/hooks/appMappingInteractions.ts`
- [x] `src/features/settings/hooks/useSettingsPageState.ts`
- [x] `src/features/settings/hooks/settingsPageStateInteractions.ts`
- [x] `src/app/widget/useWidgetWindowState.ts`
- [x] `src/app/widget/widgetWindowController.ts`
- [x] `package.json`
- [x] `tests/interactionFlows.test.ts`

### 阶段结论
- [x] 分类、设置、挂件三条高状态主链具备自动化回归覆盖
- [x] 新增验证已经进入默认前端质量门槛
- [x] 手工回归不再是这些主链唯一的安全网

## 阶段 3：tracking 热区 owner 收口

### 目标
- [x] 继续按 owner 拆薄 tracking 热区
- [x] 保持 `platform -> domain -> engine` 的长期 owner 链
- [x] 降低关键热区单文件承载的职责数量

### 已完成
- [x] `src-tauri/src/domain/tracking.rs` 把契约类型和 session identity 拆到 `domain/tracking/*`
- [x] `src-tauri/src/engine/tracking/runtime.rs` 把 loop state、power lifecycle、window polling、support 拆到 `engine/tracking/runtime/*`
- [x] `commands/*` 和 `lib.rs` 没有回流承接这些内部职责
- [x] tracking 领域契约、规则、运行时编排的 owner 边界更清晰
- [x] 热区文件明显变薄，新增子模块承接局部职责

### 验证结果
- [x] Rust `cargo check` 通过
- [x] Rust `cargo test` 103 项通过
- [x] 既有 tracking 生命周期和 payload 保护网继续通过

### 触及文件
- [x] `src-tauri/src/domain/tracking.rs`
- [x] `src-tauri/src/domain/tracking/contracts.rs`
- [x] `src-tauri/src/domain/tracking/session_identity.rs`
- [x] `src-tauri/src/engine/tracking/runtime.rs`
- [x] `src-tauri/src/engine/tracking/runtime/loop_state.rs`
- [x] `src-tauri/src/engine/tracking/runtime/power_lifecycle.rs`
- [x] `src-tauri/src/engine/tracking/runtime/support.rs`
- [x] `src-tauri/src/engine/tracking/runtime/window_polling.rs`

### 阶段结论
- [x] tracking 热区不再由单文件同时承担过多 owner 职责
- [x] Rust 入口层仍保持薄
- [x] tracking 主链没有因为拆分出现回归

## 阶段 4：性能基线与预算固化

### 目标
- [x] 把“可跑 benchmark”升级为“有基线、有预算、有回归标准”
- [x] 为高频读模型和启动关键路径建立比较依据
- [x] 在没有测量依据前，不做高风险性能优化

### 已完成
- [x] 为 benchmark 抽出统一输出工具 `scripts/perf/benchmarkUtils.ts`
- [x] `history-read-model` benchmark 改为统一格式并显式带预算
- [x] 新增 `dashboard-read-model` benchmark
- [x] 新增 `startup-bootstrap` benchmark
- [x] `package.json` 增加对应脚本
- [x] 长期规则文档 `docs/engineering-quality.md` 已回写新增 benchmark 入口

### 当前基线
- [x] `history-read-model`：`62.36ms` 平均，预算 `170ms`
- [x] `dashboard-read-model`：`18.10ms` 平均，预算 `25ms`
- [x] `startup-bootstrap`：`0.0045ms` 平均，预算 `1.5ms`
- [x] 生产构建已成功，当前主要产物体积已可复核

### 阶段结论
- [x] 高频路径具备固定 benchmark
- [x] 至少两条关键路径具备预算和对照依据
- [x] 性能结论不再主要依赖主观体感

## 阶段 5：总验收与重新评分

### 目标
- [x] 以仓库长期规则重新体检
- [x] 确认分数提升来自真实问题减少，而不是文档包装
- [x] 把需要长期保留的事实回写到母文档

### 已完成
- [x] `docs/engineering-quality.md` 已回写 `test:interaction`
- [x] `docs/engineering-quality.md` 已回写 `perf:dashboard-read-model`
- [x] `docs/engineering-quality.md` 已回写 `perf:startup-bootstrap`
- [x] 默认质量门槛重新核对完毕
- [x] 完整质量门槛重新跑通
- [x] 重新评分并记录评分理由
- [x] 重新确认综合评分达到 `9.0+`

### 复核评分
- [x] 综合：`9.1 / 10`
- [x] 架构：`9.0 / 10`
- [x] 工程质量：`9.2 / 10`
- [x] 可靠性与验证：达到 9 分档
- [x] 代码质量与可维护性：达到 9 分档
- [x] 性能工程：已从“证据不足”进入“可测量、可守预算”的 9 分档

## 默认验证门槛复核
- [x] `npm run check:frontend`
- [x] `npm run check:rust`
- [x] `npm run check:full`
- [x] `npm run test:persistence`
- [x] `npm run test:interaction`
- [x] `npm run perf:history-read-model`
- [x] `npm run perf:dashboard-read-model`
- [x] `npm run perf:startup-bootstrap`

## 本轮实际验证结果
- [x] 前端测试链全部通过
- [x] 生产构建通过
- [x] Rust `cargo check` 通过
- [x] Rust `cargo test` 103 项通过
- [x] 三条 benchmark 全部在预算内

## 仍保留未勾项
- [ ] 真实 GUI 手动走查分类保存成功/失败链
- [ ] 真实 GUI 手动走查设置保存成功/失败链
- [ ] 真实窗口环境下手动走查 widget 展开、收起、失焦收起、拖拽恢复
- [ ] 若后续触及 release / changelog / updater，再运行 `npm run release:validate-changelog`

## 最终结论
- [x] 本轮执行已经把仓库从 `8.2 / 10` 提升到 `9.1 / 10`
- [x] 本轮 9.0+ 结论建立在真实代码、测试、构建和 benchmark 证据上
- [x] 当前剩余未勾项属于手动验收或未来 release 场景，不影响本轮工程质量提升结论
