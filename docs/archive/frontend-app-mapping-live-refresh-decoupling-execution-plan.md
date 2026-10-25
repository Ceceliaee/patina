# 执行单：App Mapping 脱离实时追踪刷新信号

Document Type: One-off Execution Plan

## 1. 目标

本轮只处理一个问题：

- 当用户使用截图软件截图、导致活动窗口/追踪状态发生一次短暂变化时，`App Mapping` 页面会闪一下，然后整页刷新到新列表状态

本轮目标是让 `App Mapping` 脱离“实时追踪刷新信号”，避免因为截图、切窗、短暂焦点变化等实时追踪事件而整页重载。

完成后应达到：

- `App Mapping` 在用户停留页面期间保持稳定
- 截图软件、切窗、短暂活跃窗口变化不会让它闪一下再重载
- 用户正在看的列表、滚动位置、草稿状态不会因为实时 tracking 事件被打断

## 2. 问题定位

当前可疑主链已经比较明确：

1. [`src/app/hooks/useWindowTracking.ts`](../../src/app/hooks/useWindowTracking.ts)
   - `onTrackingDataChanged(...)` 每次收到 tracking 侧更新时，会执行 `setSyncTick((tick) => tick + 1)`

2. [`src/app/AppShell.tsx`](../../src/app/AppShell.tsx)
   - `refreshSignal = syncTick + dataRefreshTick`
   - 这个 `refreshSignal` 同时被传给 `History` 和 `AppMapping`

3. [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx)
   - `useEffect(..., [refreshKey])` 中会重新 `loadClassificationBootstrap()`
   - 也就是只要 `refreshKey` 变了，`App Mapping` 就整页重新加载

因此，截图软件触发一次活动窗口切换或 tracking 数据变化后：

- `syncTick` 增加
- `refreshSignal` 增加
- `AppMapping` 重新跑 bootstrap
- 用户看到“闪一下并刷新”

这属于刷新信号边界接错，不应该通过识别或排除某个截图软件来修。

## 3. 本轮范围

只处理 `App Mapping` 与父层刷新信号的边界收口。

重点文件：

- `src/app/AppShell.tsx`
- `src/features/classification/components/AppMapping.tsx`

如确有必要，允许少量触及：

- `src/features/classification/types.ts`
- `src/features/classification/services/classificationService.ts`

## 4. 非目标

- 不修改 tracking runtime / Tauri / Rust
- 不改 Dashboard 的实时刷新
- 不改 History 的实时刷新逻辑
- 不通过“特殊排除截图软件 exe”来规避问题
- 不顺手重做 `App Mapping` 布局或保存流程
- 不改变应用排序规则本身

## 5. 核心边界要求

- `App Mapping` 是配置/映射编辑页，不应绑定到每一次 tracking 活动刷新
- 实时数据刷新需求主要属于 Dashboard / History，不属于 `App Mapping`
- `App Mapping` 的重新加载只能由明确的“映射页自身需要刷新”的原因触发，而不是由任意 tracking 事件触发
- 如果需要保留手动/显式刷新能力，应使用单独的 refresh 触发源，不要继续复用全局 `refreshSignal`

## 6. 执行阶段

### 阶段 A：切断 App Mapping 对实时 tracking refreshSignal 的依赖

目标：

- `App Mapping` 不再因为 `syncTick` 变化而重跑 bootstrap

建议做法：

- 在 `AppShell` 中，不再把全局 `refreshSignal` 直接传给 `AppMapping`
- 如 `AppMapping` 不需要父层强制刷新，可移除该 prop
- 如仍需要父层显式刷新能力，则改成独立于 `syncTick` 的专用 refresh tick

执行项：

- [ ] `AppShell` 中将 `AppMapping` 与实时 `refreshSignal` 解耦
- [ ] `AppMapping` 中 bootstrap `useEffect` 不再跟随 tracking 实时信号触发
- [ ] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [ ] 活动窗口/追踪状态变化不再触发 `App Mapping` 整页重载

### 阶段 B：保留 App Mapping 合法的显式刷新路径

目标：

- 切断实时刷新后，`App Mapping` 仍能在真正需要时刷新候选数据

建议做法：

- 保留首次进入页面时的 bootstrap
- 保留删除会话后该页自身的本地刷新路径
- 如果父层确实需要触发 `App Mapping` 刷新，必须改成独立的显式信号，而不是复用 tracking sync tick

执行项：

- [ ] 复查 `handleDeleteAllSessions` 或同类路径仍能刷新当前页候选列表
- [ ] 复查映射保存、取消、切页 dirty 状态不受这次改动破坏
- [ ] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [ ] `App Mapping` 只在页面初始化或明确的映射页动作后刷新
- [ ] 不因截图、切窗、短暂焦点变化而刷新

### 阶段 C：回归验证与文档收尾

执行项：

- [ ] 复查 `Dashboard` / `History` 的实时刷新没有被误伤
- [ ] 更新本执行单勾选状态
- [ ] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 7. 完成定义

满足以下条件，才算本轮完成：

- [ ] 截图或类似活动窗口切换不再导致 `App Mapping` 闪一下并整页刷新
- [ ] `App Mapping` 已脱离实时 tracking refreshSignal
- [ ] 页面初始化与显式刷新路径仍然正常
- [ ] `Dashboard` / `History` 的实时刷新未被误伤
- [ ] `npm run build` 通过
- [ ] 如本轮影响现有测试链路，相关 `npm test` 通过

## 8. 给 GPT-5.3-Codex 的执行要求

- 严格限定在 `App Mapping` 与父层刷新信号边界收口范围内
- 不扩展到 Rust / Tauri / tracking runtime
- 不通过增加“截图软件特判”来绕过问题
- 不顺手改应用排序、布局、保存流程
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 9. 任务完成后的处理

本文档属于一次性执行单。  
当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
