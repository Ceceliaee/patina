# 架构执行单：前端 Runtime / Adapter 职责拆分

Document Type: One-off Execution Plan

## 1. 目标

本轮目标是继续推进 [`docs/architecture-target.md`](architecture-target.md) 的阶段 4，把前端剩余最模糊的“万能 service”边界继续拆清。

本轮重点针对：

- `src/lib/services/SettingsService.ts`
- `src/lib/services/TrackingService.ts`
- [`src/app/services/appRuntimeBootstrapService.ts`](../../src/app/services/appRuntimeBootstrapService.ts)
- [`src/app/services/appSettingsRuntimeService.ts`](../../src/app/services/appSettingsRuntimeService.ts)
- `src/features/settings/services/settingsPageService.ts`
- [`src/app/hooks/useWindowTracking.ts`](../../src/app/hooks/useWindowTracking.ts)

目标状态：

- `SettingsService` 更明确地退到 legacy persistence / invoke adapter 角色
- `TrackingService` 更明确地退到 runtime gateway 角色
- `app` 和 `settings` feature 不再继续直接认知一大串混合职责方法
- “设置存储”“桌面行为”“备份对话框”“tracking runtime 事件订阅”这几类能力边界更清楚

## 2. 为什么先做这一轮

上一轮已经把：

- `classification` 持久化链路
- `history/dashboard` 的 session read/compiler 主路径

从 `src/lib/*` 里抽出来了一步。

但当前还有两个明显遗留：

### `SettingsService` 仍然太像万能入口

它同时承接了：

- 设置存储
- 分类设置存储
- observed app 候选读取
- 备份导入导出命令
- 文件选择对话框

虽然页面组件已经不直接碰它，但 `app` 和 `feature service` 仍容易把它当万能入口继续扩写。

### `TrackingService` 仍然太像混合 runtime 网关

它同时承接了：

- 当前窗口读取
- tracking 事件订阅
- AFK 设置
- desktop behavior / launch behavior 调用

长期上，这会让：

- `useWindowTracking`
- `appRuntimeBootstrapService`
- `appSettingsRuntimeService`

继续依赖一个过厚的 runtime service。

## 3. 本轮范围

只处理前端 runtime / adapter 边界，不扩展 Rust 架构重构。

允许新增落点：

- `src/app/services/*`
- `src/shared/lib/*`
- `src/features/settings/services/*`

## 4. 非目标

- 不调整 UI
- 不重写 `ProcessMapper`
- 不重做 `classificationPersistence`
- 不重做 `sessionReadRepository / sessionReadCompiler`
- 不一次性迁空全部 `src/lib/services/*`

## 5. 执行阶段

### 阶段 A：拆出 settings persistence 与 backup/runtime adapter

目标：

- 不再让 `SettingsService` 同时代表“设置存储”和“备份/文件对话框 runtime”

建议拆分方向：

- `settingsPersistenceAdapter`
  - 承接 `load / update / trackerHealth / settings store` 等偏存储职责
- `backupRuntimeAdapter`
  - 承接 `pickBackupFile / pickBackupSaveFile / exportBackup / previewBackup / restoreBackup`

落点建议：

- `src/shared/lib/settingsPersistenceAdapter.ts`
- `src/shared/lib/backupRuntimeAdapter.ts`

执行项：

- [x] 建立设置持久化 adapter
- [x] 建立备份 runtime adapter
- [x] `settingsPageService` 改为消费新的 adapter，而不是继续直接找 `SettingsService`
- [x] `appRuntimeBootstrapService` / `appSettingsRuntimeService` 评估后改用更明确的设置 adapter
- [x] `SettingsService` 若暂时保留，应退化为 legacy façade 或 compatibility layer，而不是主路径入口
- [x] 阶段 A 完成后已运行 `npm run build`

验收门槛：

- [x] `settingsPageService` 不再直接 import `SettingsService`
- [x] `appRuntimeBootstrapService` / `appSettingsRuntimeService` 只认知各自需要的 adapter
- [x] `SettingsService` 角色明显退到兼容层

### 阶段 B：拆出 tracking runtime gateway 与 desktop behavior adapter

目标：

- 不再让 `TrackingService` 同时承接“窗口追踪事件订阅”和“桌面行为设置变更”

建议拆分方向：

- `trackingRuntimeGateway`
  - 当前窗口
  - active window change
  - tracking data change
  - AFK timeout
- `desktopBehaviorRuntimeAdapter`
  - setDesktopBehavior
  - setLaunchBehavior

落点建议：

- `src/app/services/trackingRuntimeGateway.ts`
- `src/app/services/desktopBehaviorRuntimeAdapter.ts`

执行项：

- [x] 建立 tracking runtime gateway
- [x] 建立 desktop behavior runtime adapter
- [x] `useWindowTracking` 改为消费新的 runtime gateway / adapter
- [x] `appRuntimeBootstrapService` 与 `appSettingsRuntimeService` 改为按职责接入
- [x] `TrackingService` 若暂时保留，应退为兼容层，而不再作为主路径默认入口
- [x] 阶段 B 完成后已运行 `npm run build`

验收门槛：

- [x] `useWindowTracking` 不再直接依赖旧 `TrackingService`
- [x] desktop behavior 调整不再通过混合 runtime service 横穿
- [x] `TrackingService` 不再是前端主路径默认网关

### 阶段 C：收紧旧 adapter 的长期角色

目标：

- 把 `SettingsService` / `TrackingService` 定位明确为 legacy adapter 或 compatibility layer

执行项：

- [x] 复查 `rg -n "SettingsService|TrackingService" src`
- [x] 删除阶段 A/B 迁移后产生的低价值旧入口直连
- [x] 如保留旧入口，在文件头增加清晰注释，说明其是 legacy/compatibility layer
- [x] 阶段 C 完成后已运行 `npm run build`

验收门槛：

- [x] `SettingsService` / `TrackingService` 的直接消费者明显减少
- [x] 新主路径已切到更细粒度的 runtime / persistence adapter
- [x] 不再出现“一个服务同时管存储、runtime、对话框、事件订阅”的情况

### 阶段 D：文档同步

执行项：

- [x] 更新本执行单勾选状态
- [x] 根据实际完成情况更新 [`docs/architecture-target.md`](architecture-target.md) 中阶段 4 的状态描述
- [x] 任务完成并验收通过后，将本文件移入 `docs/archive/`

## 6. 完成定义

满足以下条件，才算本轮完成：

- [x] `settingsPageService` 已不再直接依赖 `SettingsService`
- [x] `useWindowTracking` 已不再直接依赖 `TrackingService`
- [x] `appRuntimeBootstrapService` / `appSettingsRuntimeService` 改为按职责依赖更细粒度 adapter
- [x] `SettingsService` / `TrackingService` 已退化为 legacy/compatibility layer 或被明显瘦身
- [x] `npm run build` 通过
- [x] 如有联动影响，`cargo check` 通过（本轮未触发 Tauri 联动改动）

## 7. 给 GPT-5.3-Codex 的执行要求

- 严格限定在“前端 runtime / adapter 职责拆分”范围内
- 不扩展到新的 Rust 架构重构
- 不调整 UI
- 优先收口职责，不优先搬目录
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果改动影响到 Tauri 联动，再补跑 `cargo check`

## 8. 任务完成后的处理

本文件属于一次性执行单。
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
