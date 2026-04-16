# 架构迁移长期执行清单

## 1. 文档定位

本文件是基于 [`architecture-target.md`](./architecture-target.md) 制定的长期执行清单。

它不是时间表，不承诺截止日期，也不要求一次性完成整轮重构。

它的作用是：

- 把长期架构方向拆成可逐项推进的小任务
- 让后续迁移始终有明确的下一步
- 让仓库维护者随时知道当前迁移到了什么阶段
- 让后续 Codex / GPT 协作者可以直接按清单推进，而不是每次重做全局判断

如果本文件与 [`architecture-target.md`](./architecture-target.md) 冲突，以长期架构文档为准；本文件应随之更新。

---

## 2. 使用方式

### 2.1 勾选规则

每个任务只有在下面条件都满足时才可以勾选：

- 代码已经落地
- 相关导入关系已经更新
- 没有引入新的边界回流
- 必要时已有最基本的验证
- 相关文档或注释没有因此失真

### 2.2 执行粒度

本清单故意把任务拆小。

默认原则是：

- 一次任务，尽量只推动一小步
- 一次任务，尽量只解决一个明确边界问题
- 如果某项任务落地时发现需要跨层迁移，应先停下并补充或重排清单，而不是边做边扩张

### 2.3 允许调整

本清单中的目标落点和建议文件名，描述的是“推荐 owner”而不是机械搬运规则。

如果执行过程中发现：

- 更合适的 owner 层
- 更自然的 feature 边界
- 更小的安全拆分路径

可以调整实现方式，但不要改变任务的架构意图。

---

## 3. 当前阶段快照

下面这些事项已经基本成立，可以视为当前已完成的基础盘：

- [x] 前端已建立 `app / features / shared` 主骨架
- [x] `dashboard / history / classification / settings / update` 已有明确前端 feature 落点
- [x] Rust 已建立 `app / commands / platform / engine / data / domain` 主骨架
- [x] Rust `data/` 已经形成 sqlite pool、migrations、repositories 的清晰边界
- [x] `architecture-target.md` 已更新为当前长期目标版本

下面这些事项是当前尚未完成的关键迁移里程碑：

- [x] 前端已建立清晰的 `platform/` 外部边界层
- [x] 前端根层 `src/types/` 已清空并退出长期架构
- [x] 前端 `src/lib/` 已迁空并删除
- [x] 前端 `shared/lib/*` 已收敛为稳定共享能力，不再混放适配器
- [x] Rust tracking engine 已拆成 `engine/tracking/` 下的多个清晰子模块
- [x] Rust `app/runtime.rs` 与 `lib.rs` 已进一步瘦身
- [x] Rust `domain/` 已从 DTO 集合进化为稳定语义层

如果只想快速判断当前处于哪一阶段，可以先看这一节。

---

## 4. 执行顺序总览

本清单默认按下面顺序推进：

1. 前端建立 `platform/` 边界
2. 前端逐步清空 `src/lib/`
3. 前端继续清理 `shared/lib/*`、`src/types/*`、`app/*` 边界
4. Rust 拆分 tracking engine
5. Rust 充实 `domain/`
6. Rust 继续瘦身 `app/` 与 `lib.rs`
7. 最终收口与删除遗留目录

这不是硬性 waterfall。

如果某次具体任务只触及其中一小块，可以直接推进那一小块，但不要违背整体顺序的方向。

---

## 5. 阶段一：前端 `platform/` 基础边界

本阶段目标：

- 把前端与 Tauri / SQLite / 本地桌面环境的交互从散点收敛到明确边界
- 让后续迁移 `src/lib/*` 时有稳定落点

### 5.1 建立目录与规则

- [x] 创建 `src/platform/` 基础目录，并定义最小的子边界组织方式
- [ ] 约定 `src/platform/` 只承接外部环境适配，不承接页面私有业务逻辑
- [x] 约定 `src/platform/` 下优先按能力边界命名子目录，而不是按技术名命名
- [ ] 约定新增 runtime command / event gateway 默认进入 `src/platform/`
- [ ] 约定新增 SQLite 访问入口默认进入 `src/platform/`

### 5.2 收口 runtime gateway

- [x] 将 `src/app/services/trackingRuntimeGateway.ts` 迁到 `src/platform/runtime/` 下的 tracking runtime gateway 落点
- [x] 将 `src/app/services/updateRuntimeGateway.ts` 迁到 `src/platform/runtime/` 下的 update runtime gateway 落点
- [x] 将 `src/app/services/desktopBehaviorRuntimeAdapter.ts` 迁到 `src/platform/` 下的桌面行为 gateway 落点
- [x] 更新所有相关 import，保证前端不再通过旧位置访问这些 gateway

### 5.3 收口备份与更新适配

- [x] 将 `src/shared/lib/backupRuntimeAdapter.ts` 迁到 `src/platform/` 下的备份 gateway 落点
- [x] 明确 update 相关“载荷类型”与“平台调用”分层，确保类型仍留在 `shared/types` 或 feature owner，平台调用进入 `src/platform/`

### 5.4 收口 SQLite 基础入口

- [x] 将 `src/lib/db.ts` 迁到 `src/platform/` 下的 SQLite 入口落点
- [x] 保证页面组件层不再直接依赖根层 DB 入口
- [x] 保证后续本地读写都优先通过 `src/platform/` 暴露的稳定入口访问

完成本阶段后，前端应该已经具备“平台边界层”的基础骨架。

---

## 6. 阶段二：前端迁出 `src/lib/*` 中的持久化与适配器

本阶段目标：

- 先迁最容易确认 owner 的部分
- 优先清掉“显然不该继续留在 `src/lib`”的能力

### 6.1 settings 持久化迁移

- [x] 将 `src/lib/settings-store.ts` 中的 SQLite 持久化责任迁到 `src/platform/` 下的 settings 持久化落点
- [x] 保留 settings 语义与类型的稳定 owner，不让设置语义继续和底层 SQL 混在一起
- [x] 重写 `src/shared/lib/settingsPersistenceAdapter.ts` 对新平台落点的依赖
- [x] 确认 settings feature 不再从 `src/lib/settings-store.ts` 直接取能力

### 6.2 classification 持久化迁移

- [x] 将 `src/lib/classification-store.ts` 中的 SQLite 持久化责任迁到 `src/platform/` 下的 classification 持久化落点
- [x] 保留 classification 语义和草稿提交逻辑在 classification owner 层
- [x] 重写 `src/shared/lib/classificationPersistence.ts` 对新平台落点的依赖
- [x] 确认 classification feature 不再从 `src/lib/classification-store.ts` 直接取能力

### 6.3 runtime 读模型适配迁移

- [x] 重新审视 `src/app/services/readModelRuntimeService.ts` 的 owner，区分其中的“平台前置刷新”与“页面读模型缓存协调”
- [x] 确认当前读模型前置刷新没有纯平台侧能力需要迁入 `src/platform/`
- [x] 将页面侧 snapshot cache 读取保留在 dashboard/history feature owner，app 仅保留运行时加载编排

完成本阶段后，`src/lib/*store*` 和 DB 相关遗留压力应明显下降。

---

## 7. 阶段三：前端迁出 `src/lib/*` 中的分类与配置语义

本阶段目标：

- 把真正属于 classification 或 shared config 的能力归位
- 避免 `src/lib` 继续保留核心业务语义

### 7.1 `ProcessMapper` 归位

- [x] 已明确 `ProcessMapper.ts` 的长期 owner 为 classification 语义服务，后续目标落点为 `src/features/classification/services/ProcessMapper.ts`（而非 `shared/lib` 或 `platform`）
- [x] 将 `src/lib/ProcessMapper.ts` 迁到 classification owner 层或稳定共享语义层
- [x] 更新 `classificationService`、`appClassificationFacade`、dashboard/history 使用方的 import

### 7.2 归位分类辅助逻辑

- [x] 将 `processNormalization` 迁到 `src/features/classification/services/processNormalization.ts`，并保留 `src/lib/processNormalization.ts` 作为 legacy wrapper
- [x] 将 `categoryColorRegistry` 迁到 `src/features/classification/services/`，并保留 `src/lib/categoryColorRegistry.ts` 作为 legacy wrapper
- [x] 保证分类颜色与分类语义不再依赖根层 `src/lib/*`

### 7.3 归位分类配置

- [x] 已明确 `src/lib/config/categoryTokens.ts` 的长期 owner 为 classification 配置/语义层，后续目标落点为 `src/features/classification/config/categoryTokens.ts`（而非 `shared` 或 `platform`）
- [x] 已明确 `src/lib/config/defaultMappings.ts` 的长期 owner 为 classification 默认映射配置，后续目标落点为 `src/features/classification/config/defaultMappings.ts`（而非 `shared` 或 `platform`）
- [x] 将 classification 独有配置迁到 classification owner 层
- [x] 确认当前无 truly shared 的稳定分类配置需要迁入 `shared/`，分类配置已归 classification owner

### 7.4 归位设置默认配置

- [x] 重新确定设置默认配置的长期 owner 为 `src/shared/settings/releaseDefaultProfile.ts`
- [x] 保证默认设置配置不再以“根层 lib 配置”形式长期存在

完成本阶段后，`src/lib/config/*` 应只剩少量未归位内容，或已经整体迁空。

---

## 8. 阶段四：前端清理 `shared/lib/*` 的角色混放

本阶段目标：

- 保住 `shared` 的长期价值
- 防止 `shared/lib/*` 接替 `src/lib/*` 成为新的遗留桶

### 8.1 区分共享只读能力与平台适配

- [x] 确认 `shared/lib/*Adapter*` 中已无纯平台适配残留；`settingsPersistenceAdapter` 不迁入 `platform`，留待 `shared/settings` 收敛
- [x] 保证 `shared/lib/*` 不再直接承担 Tauri 调用或 raw SQLite 访问入口

### 8.2 区分共享读模型与 feature 读模型

- [x] 已确认 `shared/lib/historyReadModelService.ts` 当前混有共享 session 编译能力与 dashboard/history 私有读模型拼装，后续应拆分为 shared core + feature owner
- [x] 把 dashboard 私有读模型类型与拼装迁回 `features/dashboard/*` owner（`shared/lib/historyReadModelService.ts` 仅保留 history 侧）
- [x] 把 history 私有读模型拼装迁回 `features/history/*`
- [x] 已确认 shared owner 仅保留真正跨 feature 共享的 session 编译核心（`shared/lib/readModelCore.ts`、`shared/lib/sessionReadCompiler.ts`）；dashboard/history 私有读模型与 formatting 已回归 feature owner，`shared/lib/historyReadModelService.ts`、`shared/lib/sessionReadRepository.ts` 仅保留 legacy 兼容壳

### 8.3 收口共享 facade

- [x] 重新审视 `shared/lib/appClassificationFacade.ts` 是否仍是稳定共享 facade（结论：仍是；当前仅薄封装 `ProcessMapper` 的跨 feature 稳定分类能力，不承载 feature 私有规则）
- [x] 复核 `shared/lib/appClassificationFacade.ts` 未混入页面私有格式化、临时 UI 规则、feature-specific state logic 或 classification 编辑流程私货；本项无需代码迁移
- [x] 保证 shared facade 只暴露稳定、低上下文依赖的能力（当前对外仅 `mapApp / getCategoryLabel / getCategoryColor / getUserOverride / shouldTrackApp`，均为无持久化副作用的分类查询能力）

完成本阶段后，`shared/lib/*` 应更接近“稳定共享能力”，而不是“临时过渡层”。

---

## 9. 阶段五：前端收紧 `app/*` 与 feature 边界

本阶段目标：

- 让 `app/` 回到壳层与运行时编排身份
- 避免 `AppShell` 和 app services 继续变厚

### 9.1 瘦身 `AppShell.tsx`

- [x] 提取 `AppShell.tsx` 中的视图切换与脏状态协调逻辑
- [x] 提取 `AppShell.tsx` 中的 toast 生命周期协调逻辑
- [x] 提取 `AppShell.tsx` 中的 update 入口协调逻辑
- [x] 保证 `AppShell.tsx` 主要保留壳层组合与全局布局职责（当前 `AppShell` 仅保留壳层布局、跨 feature 接线与少量 app 编排：prewarm 触发、activeApp 派生、`handleMinSessionSecsChange`；视图脏状态、toast 生命周期、update 入口已分别下沉到 `useAppShellNavigation/useAppShellToasts/useAppShellUpdateEntry`）

### 9.2 收口启动与预热逻辑

- [x] 重新审视 `startupPrewarmService.ts` 的 owner（结论：长期 owner 仍在 `app/services`；其职责是启动阶段跨 feature 预热编排，当前同时协调 settings/classification bootstrap cache 与 dashboard/history snapshot cache，不属于单一 feature 或纯平台适配）
- [x] 将纯 feature cache 预热迁回对应 feature（dashboard/history snapshot cache 预热入口已回归 `features/*/services/*SnapshotCache.ts`，`startupPrewarmService` 仅编排调用）
- [x] 只把真正跨 feature 的启动编排保留在 `app/*`（当前 `startupPrewarmService` 仅并行编排 settings/classification bootstrap 与 dashboard/history snapshot 预热入口，并统一处理 `Promise.allSettled` 失败记录；具体预热实现已回归各 feature owner）

### 9.3 收口窗口追踪 hook

- [x] 重新审视 `useWindowTracking.ts` 中的职责混合（结论：存在明显职责混合；当前同一 hook 同时承担 app runtime bootstrap 读取、平台事件订阅、tracking pause settings 同步、tracker health 轮询刷新、desktop/launch behavior 副作用同步）
- [x] 把平台订阅保持在 app/runtime 边界（`useWindowTracking.ts` 已改为依赖 `app/services/appRuntimeTrackingService.ts` 订阅入口，不再直接依赖 `platform/runtime/trackingRuntimeGateway.ts` 订阅 API）
- [x] 把 settings 同步、desktop behavior 反应式更新、tracker health 刷新等逻辑按 owner 分离（当前已分离为 `trackingPauseSettingsSyncService`、`useDesktopLaunchBehaviorSync`、`trackerHealthPollingService`；`useWindowTracking` 仅保留 bootstrap + 订阅编排）

完成本阶段后，前端 `app/*` 应更明显地表现为壳层与编排层。

---

## 10. 阶段六：前端清理根层 `src/types/*`

本阶段目标：

- 去掉前端根层 `types/`
- 让类型跟随真实 owner

### 10.1 `tracking.ts` 归位

- [x] 明确 `src/types/tracking.ts` 的长期 owner；当前按“最小安全迁移”收敛到 `src/shared/types/tracking.ts`
- [x] 将 `TrackedWindow`、`TrackingWindowSnapshot`、`TrackingDataChangedPayload`、`TrackerHealth*` 以及现有 parse/guard helper 一并迁到 `shared/types/tracking.ts`，暂不在本阶段继续拆分到 `platform`
- [x] 更新所有引用，移除对根层 `src/types/tracking.ts` 的依赖

### 10.2 `app.ts` 归位

- [x] 明确 `src/types/app.ts` 的长期 owner 为 `src/shared/types/app.ts`
- [x] 将 `AppStat` / `View` 的使用方直接收口到 `shared/types/app.ts`
- [x] 更新所有引用，移除对根层 `src/types/app.ts` 的依赖

### 10.3 删除根层类型目录

- [x] 确认 `src/types/` 已无长期 owner 文件
- [x] 删除空的根层 `src/types/`

完成本阶段后，前端根层 `src/types/` 已完成退出，类型边界已进一步收口到 `shared/types` 与 feature owner。

---

## 11. 阶段七：前端删除 `src/lib/`

本阶段目标：

- 让 `src/lib/` 从“持续缩小”变成“实际消失”

### 11.1 清点遗留

- [x] 列出 `src/lib/` 中剩余文件及其 owner 去向
- [x] 为每个剩余文件补齐迁移目标，而不是允许它无限期滞留

当前清点结果（以仓库现状为准）：

- [x] `src/lib/` 已无剩余文件；阶段七遗留清点已收口

### 11.2 迁空目录

- [x] 将 `src/lib/copy.ts` 迁到 `src/shared/copy/uiText.ts`，并完成所有调用方 import 收口
- [x] 删除已无业务引用的 legacy compatibility barrel：`src/lib/settings.ts`
- [x] 清理空的 `src/lib/debug/`
- [x] 清理空的 `src/lib/services/`
- [x] 清理迁移后已无引用的 `src/lib/config/`
- [x] 删除已无业务引用的 legacy wrapper：`src/lib/settings-store.ts`、`src/lib/classification-store.ts`、`src/lib/ProcessMapper.ts`、`src/lib/processNormalization.ts`、`src/lib/categoryColorRegistry.ts`

### 11.3 删除目录

- [x] 确认仓库内已无对 `src/lib/*` 的正常业务引用
- [x] 删除空的 `src/lib/`
- [x] 更新相关文档，明确前端已完成 `src/lib/` 退出

完成本阶段后，前端应达到“终局架构里不再保留 `src/lib/`”的状态。

---

## 12. 阶段八：Rust 拆分 tracking engine

本阶段目标：

- 解决 `engine/tracking_runtime.rs` 过厚问题
- 让 tracking 核心行为按职责拆分，而不是继续堆在单文件中

### 12.1 抽离 transition 规则

- [x] 抽离窗口切换规划逻辑（如 transition planning / identity / trackable judgment）
- [x] 让 session 切换决策拥有更清晰的 engine owner 模块
- [x] 保持原有行为与测试语义不变

### 12.2 抽离 watchdog 逻辑

- [x] 抽离 tracker stall / watchdog seal 判断逻辑（`should_watchdog_seal` 已迁至 `engine/tracking_watchdog.rs`）
- [x] 抽离 watchdog 相关状态和辅助函数（`RuntimeHealthState` 与 watchdog seal 辅助逻辑已迁至 `engine/tracking_watchdog.rs`）
- [x] 确保 watchdog 逻辑不再和主循环实现混在同一大段中（watchdog 主循环已从 `tracking_runtime.rs` 迁出到独立模块）

### 12.3 抽离 startup self-heal

- [x] 抽离 tracker 初始化与 startup self-heal 逻辑（`initialize_tracker` 与 startup sealing / repair notes 已迁至 `engine/tracking_startup.rs`）
- [x] 让 initialization / repair 逻辑拥有单独 owner（`resolve_startup_seal_time` 与 startup self-heal summary 持久化辅助逻辑由 `tracking_startup.rs` 承载）

### 12.4 抽离 metadata / icon 逻辑

- [x] 抽离应用名、图标、版本元数据提取逻辑（`map_app_name`、版本信息读取辅助函数、`ensure_icon_cache`、`resolve_icon_source_path` 已迁至 `engine/tracking_metadata.rs`）
- [x] 确保 tracking 主链保留业务编排，而不是承载大量平台元数据细节（`tracking_runtime.rs` 仅保留 `start_session` 编排并调用 `tracking_metadata` 接口）

### 12.5 收口目录

- [x] 根据拆分结果引入 `engine/tracking/` 子模块结构（已落地 `tracking/mod.rs` + `runtime/transition/watchdog/startup/metadata`）
- [x] 更新 `engine/mod.rs`，让 tracking engine 以模块而非单文件存在（已收口为 `pub mod tracking;`，外部引用迁移到 `engine::tracking::*`）

完成本阶段后，`tracking_runtime.rs` 不应再是单个超厚核心文件。

---

## 13. 阶段九：Rust 充实 `domain/`

本阶段目标：

- 让 `domain/` 从“共享 struct 容器”逐步成长为稳定语义层

### 13.1 tracking 领域语义

- [x] 重新审视 `domain/tracking.rs` 中哪些内容只是 DTO，哪些应该成为领域类型（本轮已将 `WindowSessionIdentity` / `WindowTransitionDecision` 作为领域语义类型补齐方法，`TrackingDataChangedPayload` 保持契约 DTO 并补构造器）
- [x] 为 session identity、transition decision、tracking payload 建立更清晰的领域语义边界（已落地 `from_window_fields`、`is_same_app`、`is_same_instance`、`has_mutation_plan`、`resolved_end_time`、`mutation_reason`、`TrackingDataChangedPayload::new`）
- [x] 将 tracking 规则中稳定的不变量尽量表达在 domain 中，而不是散落在 engine 细节里（`should_track`、lifecycle utility process/window/title 判断、version-like token、likely system process 规则已迁入 `domain/tracking.rs`，并引入 `WindowTrackingCandidate`；`engine/tracking/transition.rs` 仅保留 `WindowInfo -> domain` 薄适配）

### 13.2 settings 领域语义

- [x] 重新审视 `domain/settings.rs` 的职责（已补齐 `DesktopBehaviorSettings` 的稳定语义 API：`with_desktop_behavior / with_launch_behavior / with_raw_desktop_behavior / from_storage_values`）
- [x] 把稳定的设置语义、解析规则、不变量保留在 domain 层（close/minimize raw 解析、布尔解析、默认值合并、tray visibility 与 autostart minimized 规则均由 `domain/settings.rs` 承接，并补充单元测试覆盖）
- [x] 避免 settings 语义散落回 commands 或 app 层（`commands/settings.rs` 改为调用 state 的 raw 更新入口；`app/state.rs` 统一通过 domain 方法更新；`data/repositories/app_settings.rs` 通过 domain 构造表达存储默认合并）

### 13.3 backup / update 契约

- [x] 重新审视 `domain/backup.rs` 与 `domain/update.rs` 的边界（`domain/backup.rs` 已承接 backup version/schema 常量、compatibility 判定与 preview 构造语义；`domain/update.rs` 已承接 `UpdateSnapshot` 状态转换语义方法）
- [x] 确保 backup / update 相关共享契约由 domain 承接，而不是落回 commands 或 data（`data/backup.rs` 仅保留文件读写/JSON decode/DB restore-export 编排并调用 domain 契约；`engine/updater.rs` 保留 Tauri `Update` 与 bytes 状态，但 snapshot 字段变更通过 domain 方法表达）

完成本阶段后，`domain/` 应开始成为“稳定语义中层”。

---

## 14. 阶段十：Rust 继续瘦身 `app/` 与 `lib.rs`

本阶段目标：

- 让 entry / app 装配更清楚
- 防止 setup 与 runtime 协调重新长成大文件

### 14.1 瘦身 `lib.rs`

- [x] 重新审视 `lib.rs` 中 builder 装配职责
- [x] 抽出可独立表达的 setup / registration 组装逻辑（已落地 `src-tauri/src/app/bootstrap.rs`，承接 builder setup、plugin registration、invoke handler registration 与 setup hooks 组装）
- [x] 保证 `lib.rs` 主要保留“主装配入口”身份（当前 `lib.rs` 仅保留 context 获取、runtime 输入准备、sqlite legacy migration repair 与 bootstrap 调用）

### 14.2 瘦身 `app/runtime.rs`

- [x] 拆分 desktop behavior 同步逻辑（已落地 `src-tauri/src/app/desktop_behavior.rs`，承接 `apply_autostart`、`sync_desktop_behavior_from_storage` 与 autostart 启动窗口处理）
- [x] 拆分 updater 启动逻辑（已落地 `src-tauri/src/app/runtime_tasks.rs`，承接 startup auto-check task 启动）
- [x] 拆分 tracking runtime 启动与守护逻辑（已落地 `src-tauri/src/app/runtime_tasks.rs`，承接 tracking runtime/watchdog restart loop）
- [x] 确保 `app/runtime.rs` 不再持续堆积第二层业务实现（当前 `app/runtime.rs` 主要保留 setup 编排：power watcher、tray 初始化、desktop behavior sync 触发、updater/tracking task 启动）

### 14.3 保持 commands 薄

- [x] 复查 `commands/*` 是否有回胖迹象（`commands/backup.rs` 存在 restore 后副作用串联，`commands/settings.rs` 存在 desktop behavior 状态+副作用编排；`commands/update.rs`、`commands/tracking.rs`、`commands/apps.rs` 当前保持薄）
- [x] 如果某个命令文件开始变厚，优先把逻辑迁回 `app / engine / data`（新增 `app/backup.rs` 承接 restore 后刷新编排；`app/desktop_behavior.rs` 新增 command service 入口承接 settings 行为应用，`commands/*` 回归 IPC 边界适配）

完成本阶段后，Rust entry 与 app 层应更接近最终装配形态。

---

## 15. 阶段十一：最终收口检查

本阶段目标：

- 用一轮清点确认长期目标真正落地

### 15.1 前端收口检查

- [x] 确认新增前端代码默认已落在 `app / features / shared / platform`
- [x] 确认页面组件层不再直接依赖 DB 或平台细节
- [x] 确认 `shared/lib/*` 不再承担新的过渡职责
- [x] 确认前端已无 `src/lib/` 与根层 `src/types/`

完成说明（2026-04-16）：
- 本轮通过目录与 import 扫描确认前端新增代码落点稳定在 `app / features / shared / platform`，无 `src/lib/*` 与根层 `src/types/*` 回流。
- 页面组件层（`features/*/components`）未直接依赖 DB、Tauri 插件或平台细节；`Settings.tsx` 的外链打开已收口到 `settingsRuntimeAdapterService`，底层 `@tauri-apps/plugin-opener` 由 `src/platform/desktop/externalUrlGateway.ts` 承接，应用版本读取由 `src/platform/desktop/appInfoGateway.ts` 承接，SQLite 入口仅位于 `src/platform/persistence/sqlite.ts`。
- `shared/lib/*` 当前以稳定共享能力为主；保留的 legacy 兼容壳（如 `historyReadModelService.ts`、`sessionReadRepository.ts`）仅做兼容与类型转发，本轮未新增过渡职责。

### 15.2 Rust 收口检查

- [x] 确认新增 Rust 核心逻辑默认进入 `engine / domain / data`
- [x] 确认 `commands/*` 与 `lib.rs` 没有重新变厚
- [x] 确认 tracking engine 已为多模块结构
- [x] 确认 `domain/` 已承接稳定语义契约

完成说明（2026-04-16）：
- 本轮通过 `src-tauri/src/{app,commands,data,domain,engine,lib.rs}` 扫描确认：新增核心链路逻辑保持在 `engine / domain / data`，`commands/*` 维持 IPC 参数接收与转发职责，`lib.rs` 维持入口装配职责（context/runtime 输入准备 + bootstrap 调用），未出现回胖。
- `engine/tracking/` 当前已稳定为多模块结构：`mod.rs` + `runtime.rs`、`transition.rs`、`watchdog.rs`、`startup.rs`、`metadata.rs`，`engine/mod.rs` 以 `pub mod tracking;` 暴露，不再是单文件 tracking runtime 形态。
- `domain/` 已承接稳定语义契约：`tracking`（identity/decision/trackable 规则）、`settings`（desktop behavior 语义与解析规则）、`backup`（compatibility/preview 契约）、`update`（snapshot 状态迁移语义）均有对应测试覆盖。

### 15.3 文档收口检查

- [x] 回看 [`architecture-target.md`](./architecture-target.md)，确认文档描述与仓库现状一致
- [x] 如有必要，更新本清单为“维护期版本”，移除已无价值的历史迁移项

完成说明（2026-04-16）：
- 已在 [`architecture-target.md`](./architecture-target.md) 补充“维护期注记”，明确前端 `platform/`、前端 `src/lib/` / `src/types/` 退出、Rust tracking 多模块化、Rust `domain/` 语义层、Rust 入口瘦身等事项已成为当前长期基线；文档中仍保留的迁移期体检与优先级段落，统一视为历史背景，不再作为当前执行 backlog。
- 本清单自本阶段起按“维护期版本”理解：阶段一到阶段十五保留为已完成迁移记录与边界审计依据，不再继续扩写新的历史迁移项；后续若出现新的结构性工作，应直接回到长期文档判断是否值得进入新的维护期执行单，而不是把本清单重新扩张成长期 backlog。

---

## 16. 执行时的默认约束

- 不为了勾选速度做大爆炸搬迁
- 不为了删除 `src/lib/` 而制造新的边界混乱
- 不把 `shared/*` 做成新的垃圾桶
- 不把 `platform/*` 做成新的万能目录
- 不把“文件移动完成”误判为“职责已经收口”
- 一次任务只推进一小步，但每一步都必须让结构更清楚

---

## 17. 给后续协作者的说明

如果以后基于本清单推进，请默认遵守下面这条规则：

- 优先完成一个清晰的小任务，再勾选一项
- 不要一次跨越多个阶段同时大改
- 如果执行中发现 owner 判断与本清单不一致，先修正文档再继续
- 如果某个任务已经自然完成，应及时勾选，不要让文档状态长期落后于代码状态

本清单的目标不是“看起来计划很多”，而是让长期迁移始终看得见、走得动、对得上当前阶段。
