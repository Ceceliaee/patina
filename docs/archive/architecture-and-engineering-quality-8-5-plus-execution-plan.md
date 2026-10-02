# 架构与工程质量 8.5+ 提升执行方案

> 执行完成日期：2026-04-20
> 最终复评：架构 `8.6 / 10`，工程质量 `8.6 / 10`，综合 `8.6 / 10`
> 最终验证：`npm run release:check -- 0.3.2` 通过；`rg "features/settings/services/settingsRuntimeAdapterService" src/app` 结果归零
> 归档说明：本文已执行完成，后续仅作为阶段性历史记录，不再作为活动执行基线。

## 1. 文档定位

本文是把当前综合分从 `8.0` 提升到 `8.5+` 的阶段性执行方案。

它不是长期母文档，也不替代：

- [`../architecture.md`](../architecture.md)
- [`../engineering-quality.md`](../engineering-quality.md)
- [`../issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md)
- [`../roadmap-and-prioritization.md`](../roadmap-and-prioritization.md)

本文只回答 4 件事：

- 当前为什么还没有到 `8.5+`
- 为了达到 `8.5+` 必须完成哪些收口
- 这些收口的推荐顺序是什么
- 每一项完成后如何验收

本文应放在 `docs/working/` 下作为当前执行依据；方案完成后移入 `docs/archive/`。

---

## 2. 当前基线

当前评审基线：

- 架构：`8.3 / 10`
- 工程质量：`7.7 / 10`
- 综合：`8.0 / 10`

当前主要扣分项：

- Rust 单元测试资产存在，但默认 CI / 发布链没有真正执行 `cargo test`
- `features/settings` 有回流成全局基础设施 owner 的趋势
- `src/app/**` 反向依赖 `features/settings/services/settingsRuntimeAdapterService.ts`
- `src/shared/lib/settingsPersistenceAdapter.ts` 作为 persistence adapter 落在 `shared/*`，与长期口径不完全一致
- `useAppMappingState`、`useSettingsPageState` 等热点 owner 已偏厚，但缺少直接测试保护

关键证据文件：

- Rust 测试资产：[`src-tauri/src/engine/tracking/runtime.rs`](../../src-tauri/src/engine/tracking/runtime.rs)、[`src-tauri/src/domain/tracking.rs`](../../src-tauri/src/domain/tracking.rs)
- CI gate：[`../../.github/workflows/verify.yml`](../../.github/workflows/verify.yml)
- Release gate：[`../../.github/workflows/prepare-release.yml`](../../.github/workflows/prepare-release.yml)
- settings owner 回流点：
  - [`../../src/features/settings/services/settingsRuntimeAdapterService.ts`](../../src/features/settings/services/settingsRuntimeAdapterService.ts)
  - [`../../src/app/services/appRuntimeBootstrapService.ts`](../../src/app/services/appRuntimeBootstrapService.ts)
  - [`../../src/app/services/trackingPauseSettingsRuntimeService.ts`](https://github.com/Ceceliaee/patina/blob/07e69b852f55e0260ef6793e72746df78024db68/src/app/services/trackingPauseSettingsRuntimeService.ts)
  - [`../../src/app/AppShell.tsx`](../../src/app/AppShell.tsx)
  - [`../../src/shared/lib/settingsPersistenceAdapter.ts`](https://github.com/Ceceliaee/patina/blob/07e69b852f55e0260ef6793e72746df78024db68/src/shared/lib/settingsPersistenceAdapter.ts)
- 前端热点：
  - [`../../src/features/classification/hooks/useAppMappingState.ts`](../../src/features/classification/hooks/useAppMappingState.ts)
  - [`../../src/features/settings/hooks/useSettingsPageState.ts`](../../src/features/settings/hooks/useSettingsPageState.ts)

---

## 3. 目标定义

## 3.1 分数目标

- 架构达到 `8.5+`
- 工程质量达到 `8.4+`
- 综合达到 `8.5+`

## 3.2 达标标准

达到 `8.5+` 不等于“目录更好看”，而是至少满足：

- 默认自动化 gate 真实覆盖 Rust 单元测试，而不只是 `cargo check`
- `app/*` 不再依赖 settings feature 私有服务来完成应用启动和运行时同步
- `shared/*` 不再继续承接新的 persistence adapter 职责
- settings 相关 owner 明确分流到 `platform / app / features/settings`
- settings / classification 的关键状态与保存流程有更直接的测试保护
- 热点文件至少完成一轮 owner 内降噪，而不是继续累积

## 3.3 非目标

- 不做一次性全仓库重构
- 不为了 `8.5+` 立即拆完 [`../../src-tauri/src/engine/tracking/runtime.rs`](../../src-tauri/src/engine/tracking/runtime.rs) 全部复杂度
- 不扩张到 `9.0+` 级别的大范围历史兼容层清退
- 不引入新的“过渡公共层”来换取表面整齐

---

## 4. 执行原则

- [x] 所有动作先判定真实 owner，再决定文件落点
- [x] 先补 gate，再做结构收口
- [x] 不新增新的长期兼容壳；如果不得不加，必须写明退出条件
- [x] 热点拆解只在真实 owner 内进行，不通过跨层转移来“瘦身”
- [x] 每一阶段结束都要运行与风险匹配的验证链
- [x] 如果某一步开始把 `app/*`、`shared/*`、`commands/*` 重新变厚，立刻停下重判边界

---

## 5. 推荐阶段

建议按下面 6 个阶段推进：

1. 把 Rust 测试纳入默认可信门槛
2. 收口 settings 的 owner 边界
3. 清理 `app/*` 对 settings feature 的反向依赖
4. 给 settings / classification 关键状态层补直接测试
5. 在真实 owner 内做一轮热点降噪
6. 回写文档并复评

建议顺序不要打乱。

原因：

- 第 1 阶段先补 gate，后面改边界才有安全网
- 第 2、3 阶段先解决 owner 回流，再谈热点瘦身
- 第 4 阶段让新增结构有测试保护
- 第 5 阶段只做足够把综合分拉到 `8.5+` 的复杂度下降
- 第 6 阶段再把阶段事实沉淀到长期文档

---

## 6. 第一阶段：把 Rust 测试纳入默认可信门槛

阶段目标：

- 让 Rust 关键路径从“能编译”提升为“默认会被执行测试”
- 让 PR gate 与 release gate 都能拦住 Rust 运行时回归

当前问题：

- [`../../.github/workflows/verify.yml`](../../.github/workflows/verify.yml) 只跑 `cargo check`
- [`../../.github/workflows/prepare-release.yml`](../../.github/workflows/prepare-release.yml) 也只跑 `cargo check`
- 但 [`../../src-tauri/src/engine/tracking/runtime.rs`](../../src-tauri/src/engine/tracking/runtime.rs)、[`../../src-tauri/src/domain/tracking.rs`](../../src-tauri/src/domain/tracking.rs) 等文件里已经有大量 `#[test]`

执行清单：

- [x] 在 [`../../.github/workflows/verify.yml`](../../.github/workflows/verify.yml) 中新增 Rust 单元测试步骤
- [x] 让 verify workflow 至少执行：
- [x] `cargo check --manifest-path src-tauri/Cargo.toml --quiet`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml --quiet`
- [x] 在 [`../../.github/workflows/prepare-release.yml`](../../.github/workflows/prepare-release.yml) 中增加 `cargo test`
- [x] 评估是否补一个统一的本地命令入口，例如 `npm run check:rust` 或 `npm run check:full`
- [x] 如果新增脚本，确保 CI 与本地用同一入口，而不是两套不同命令
- [x] 记录 Rust 测试已进入默认 gate 的事实，供后续文档回写

硬性验收：

- [x] PR gate 默认执行 Rust 单元测试
- [x] Release gate 默认执行 Rust 单元测试
- [x] Rust 关键路径失败时，CI 能直接阻断

建议验证：

```powershell
npm run check
cargo check --manifest-path src-tauri/Cargo.toml --quiet
cargo test --manifest-path src-tauri/Cargo.toml --quiet
```

阶段完成后的预期收益：

- 工程质量：`+0.3 ~ +0.4`

---

## 7. 第二阶段：收口 settings 的 owner 边界

阶段目标：

- 把当前混在 `shared / app / features/settings` 之间的 settings 职责重新分流
- 让 settings feature 不再充当应用级基础设施 owner

## 7.1 目标 owner 图

推荐的 owner 划分如下：

| 能力 | 目标 owner | 不应继续落点 |
| --- | --- | --- |
| 原始 SQLite settings 读写 | `src/platform/persistence/*` | `shared/*` |
| tracker health 时间戳读取 | `src/platform/persistence/*` 或 `src/app/services/*` 对 platform 的薄包装 | `features/settings/*` |
| 应用启动时读取当前设置 | `src/app/services/*` 对 platform 的薄包装 | `features/settings/*` |
| Settings 页面的保存、备份、恢复、打开外链 | `src/features/settings/*` | `app/*` |
| 页面级 patch / cleanup / restore flow | `src/features/settings/*` | `shared/*` |

## 7.2 重点对象

- [`../../src/features/settings/services/settingsRuntimeAdapterService.ts`](../../src/features/settings/services/settingsRuntimeAdapterService.ts)
- [`../../src/shared/lib/settingsPersistenceAdapter.ts`](https://github.com/Ceceliaee/patina/blob/07e69b852f55e0260ef6793e72746df78024db68/src/shared/lib/settingsPersistenceAdapter.ts)
- [`../../src/platform/persistence/settingsPersistence.ts`](../../src/platform/persistence/settingsPersistence.ts)

执行清单：

- [x] 明确 `settingsRuntimeAdapterService` 中每个方法的真实 owner
- [x] 把“应用启动读取当前设置”从 settings feature service 中移出
- [x] 把“tracker health 时间戳读取”从 settings feature service 中移出
- [x] 评估 [`../../src/shared/lib/settingsPersistenceAdapter.ts`](https://github.com/Ceceliaee/patina/blob/07e69b852f55e0260ef6793e72746df78024db68/src/shared/lib/settingsPersistenceAdapter.ts) 的最终去向
- [x] 方案 A：迁回 `src/platform/persistence/*`
- [x] 未采用方案 B：拆成 `platform` 原始适配 + `app` 或 `features/settings` 的薄组合层
- [x] 不允许继续把它保留成“shared 下的 persistence adapter 桶”
- [x] 保留在 settings feature 内的部分，仅限 settings 页面的 feature 私有流程
- [x] 为拆分后的 owner 增加清晰命名，避免再次长成新全局服务

硬性验收：

- [x] `settingsRuntimeAdapterService` 不再承担应用级启动读取职责
- [x] `settingsRuntimeAdapterService` 不再承担 tracker health 读取职责
- [x] `shared/*` 不再继续承接 settings persistence adapter

建议验证：

```powershell
rg -n "loadTrackerHealthTimestamp|loadCurrentSettings" src/features/settings src/shared
npm run check
```

阶段完成后的预期收益：

- 架构：`+0.2 ~ +0.3`
- 工程质量：`+0.1 ~ +0.2`

---

## 8. 第三阶段：清理 `app/*` 对 settings feature 的反向依赖

阶段目标：

- 让 `app/*` 回到“应用壳层 / 启动 / 运行时编排”的角色
- 去掉 `app/* -> features/settings/*` 这条不必要的反向 owner 依赖

当前重点对象：

- [`../../src/app/AppShell.tsx`](../../src/app/AppShell.tsx)
- [`../../src/app/services/appRuntimeBootstrapService.ts`](../../src/app/services/appRuntimeBootstrapService.ts)
- [`../../src/app/services/trackingPauseSettingsRuntimeService.ts`](https://github.com/Ceceliaee/patina/blob/07e69b852f55e0260ef6793e72746df78024db68/src/app/services/trackingPauseSettingsRuntimeService.ts)

执行清单：

- [x] 清点 `src/app/**` 中所有直接 import `features/settings/services/settingsRuntimeAdapterService.ts` 的位置
- [x] 将 `appRuntimeBootstrapService` 改为依赖新的 app-owned 或 platform-owned 薄服务
- [x] 处理 [`../../src/app/AppShell.tsx`](../../src/app/AppShell.tsx) 中 `min_session_secs` 的即时保存逻辑
- [x] 为 `min_session_secs` 选择真实 owner
- [x] 选项 1：`app/services/*` 的应用级偏好写侧服务
- [x] 未采用选项 2：`features/history/*` 的 feature 私有写侧服务
- [x] 删除或吸收 [`../../src/app/services/trackingPauseSettingsRuntimeService.ts`](https://github.com/Ceceliaee/patina/blob/07e69b852f55e0260ef6793e72746df78024db68/src/app/services/trackingPauseSettingsRuntimeService.ts) 这种仅转发到 settings feature 的薄壳
- [x] 保持 `app/*` 只依赖真实环境边界或应用级编排 owner，不直接依赖 settings feature page owner

硬性验收：

- [x] `rg "features/settings/services/settingsRuntimeAdapterService" src/app` 结果归零
- [x] `AppShell` 不再直接通过 settings feature service 写设置
- [x] `app/*` 中不再存在“为了图方便从 settings feature 借基础能力”的路径

建议验证：

```powershell
rg -n "features/settings/services/settingsRuntimeAdapterService" src/app
npm run check
```

阶段完成后的预期收益：

- 架构：`+0.2 ~ +0.3`

---

## 9. 第四阶段：给 settings / classification 关键状态层补直接测试

阶段目标：

- 把当前“只有间接覆盖”的状态层补成更直接的测试保护
- 降低后续 owner 收口或热点降噪时的回归风险

当前缺口热点：

- [`../../src/features/settings/hooks/useSettingsPageState.ts`](../../src/features/settings/hooks/useSettingsPageState.ts)
- [`../../src/features/classification/hooks/useAppMappingState.ts`](../../src/features/classification/hooks/useAppMappingState.ts)
- [`../../src/features/classification/services/classificationService.ts`](../../src/features/classification/services/classificationService.ts)

执行策略：

- 优先测试纯函数、service、policy 和 save/diff 逻辑
- 不把第一轮测试目标设成重型 DOM / 浏览器集成
- 如果 hook 太厚，先抽出纯 helper，再测试 helper

执行清单：

- [x] 为 settings 保存 patch 构建逻辑补测试
- [x] 为 settings cleanup / backup / restore 关键分支补测试，至少覆盖成功与失败分支
- [x] 为 classification draft diff / commit 逻辑补测试
- [x] 为分类删除、颜色覆盖、custom category 处理补测试
- [x] 如果 hook 内纯逻辑不方便测，先抽出 feature 内 helper，不上升到 `shared/*`
- [x] 将新增测试纳入默认前端门槛

推荐测试落点：

- `tests/settingsPageState.test.ts`
- `tests/classificationDraftState.test.ts`
- 或在 `tests/trackingLifecycle/` 之外新增同级测试文件

硬性验收：

- [x] settings 至少新增一组直接测试
- [x] classification 至少新增一组直接测试
- [x] 新测试进入 `npm run check` 或等价默认前端门槛

建议验证：

```powershell
npm run check
```

阶段完成后的预期收益：

- 工程质量：`+0.2 ~ +0.3`

---

## 10. 第五阶段：在真实 owner 内做一轮热点降噪

阶段目标：

- 降低两个最突出的前端热点的维护噪音
- 只做够支撑 `8.5+` 的降噪，不做 `9.0+` 级别的大拆

当前目标：

- [`../../src/features/classification/hooks/useAppMappingState.ts`](../../src/features/classification/hooks/useAppMappingState.ts)
- [`../../src/features/settings/hooks/useSettingsPageState.ts`](../../src/features/settings/hooks/useSettingsPageState.ts)

执行清单：

- [x] 从 `useAppMappingState` 中抽出候选项过滤/排序纯函数
- [x] 从 `useAppMappingState` 中抽出 override 构建与 diff 相关纯 helper
- [x] 从 `useSettingsPageState` 中抽出 cleanup / backup / restore 的 feature 内 action helper
- [x] 保持拆出的新文件全部留在各自 feature 内
- [x] 不把这些页面私有状态机搬进 `shared/*`
- [x] 对拆出的 helper 补对应测试

明确延后项：

- [x] 本阶段不强求全面拆分 [`../../src-tauri/src/engine/tracking/runtime.rs`](../../src-tauri/src/engine/tracking/runtime.rs)
- [x] 本阶段不强求全面拆分 [`../../src-tauri/src/domain/tracking.rs`](../../src-tauri/src/domain/tracking.rs)
- [x] Rust 运行时的大规模 owner 内分解保留给 `9.0+` 阶段

硬性验收：

- [x] `useAppMappingState` 主文件显著缩短或至少去掉 1 到 2 块纯逻辑噪音
- [x] `useSettingsPageState` 主文件显著缩短或至少去掉 1 到 2 块流程 helper 噪音
- [x] 新拆出的逻辑都有明确 owner 和直接测试

建议验证：

```powershell
npm run check
```

阶段完成后的预期收益：

- 架构：`+0.1 ~ +0.2`
- 工程质量：`+0.1 ~ +0.2`

---

## 11. 第六阶段：文档回写与最终复评

阶段目标：

- 把已经完成的阶段事实回写到长期文档
- 结束本轮执行方案，避免 `docs/working/` 长期堆积

执行清单：

- [x] 将 Rust 测试进入默认 gate 的事实回写到 [`../engineering-quality.md`](../engineering-quality.md)
- [x] 如 release gate 发生变化，回写到 [`../versioning-and-release-policy.md`](../versioning-and-release-policy.md)
- [x] 如 settings owner 口径发生稳定变化，回写到 [`../architecture.md`](../architecture.md)
- [x] 重新运行完整验证链
- [x] 重新做一次架构与工程质量复评
- [x] 将本文逐项勾选并移入 `docs/archive/`

最终建议验证：

```powershell
npm run check
cargo check --manifest-path src-tauri/Cargo.toml --quiet
cargo test --manifest-path src-tauri/Cargo.toml --quiet
```

---

## 12. 8.5+ 的最低验收门槛

只有当下面这些判断同时成立时，才应把综合分上调到 `8.5+`：

- [x] PR gate 默认执行 Rust 单元测试
- [x] Release gate 默认执行 Rust 单元测试
- [x] `src/app/**` 不再依赖 `features/settings/services/settingsRuntimeAdapterService.ts`
- [x] `settingsRuntimeAdapterService` 已经收回到 settings feature 私有职责
- [x] `shared/*` 不再继续承担 settings persistence adapter
- [x] settings / classification 至少各有一组更直接的测试保护
- [x] 两个前端热点至少完成一轮 owner 内降噪
- [x] 长期文档与仓库现状一致

只完成其中一部分，通常仍应停留在 `8.2 ~ 8.4` 区间。

---

## 13. 分阶段预期分数

### 完成第一阶段后

- 架构：`8.3`
- 工程质量：`8.0 ~ 8.1`
- 综合：`8.1`

### 完成第二、第三阶段后

- 架构：`8.5 ~ 8.6`
- 工程质量：`8.1 ~ 8.2`
- 综合：`8.3 ~ 8.4`

### 完成第四、第五阶段后

- 架构：`8.5 ~ 8.7`
- 工程质量：`8.4 ~ 8.6`
- 综合：`8.5+`

### 完成第六阶段后

- 综合分稳定维持在 `8.5+`

---

## 14. 止损规则

如果执行过程中出现下面任一情况，应暂停并重判边界：

- [ ] 为了去掉 settings 回流，又新增了一个更厚的新全局 service
- [ ] 为了更方便测试，把页面私有逻辑搬进 `shared/*`
- [ ] 为了让 `app/*` 不依赖 feature，反而让 `app/*` 直接到处碰 DB 细节
- [ ] 新增 gate 明显过慢，导致团队倾向跳过默认门槛
- [ ] 热点拆解只是把一个厚文件切成多个无 owner 小文件

---

## 15. 执行顺序建议

建议按下面顺序推进：

1. 第一阶段
2. 第二阶段
3. 第三阶段
4. 第四阶段
5. 第五阶段
6. 第六阶段

如果资源有限，最低优先保留的顺序是：

1. 第一阶段
2. 第二阶段
3. 第三阶段
4. 第四阶段
5. 第六阶段

说明：

- 前三阶段决定这次能不能真正把架构与 owner 拉回 `8.5+` 轨道
- 第四阶段决定工程质量能不能过 `8.4+`
- 第五阶段是把分数从“刚够”拉到“更稳”的加分项
- 第六阶段保证这次收口不会只停留在一次性执行
