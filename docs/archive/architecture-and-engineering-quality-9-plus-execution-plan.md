# 架构与工程质量 9.0+ 提升执行方案

## 1. 文档定位

本文是把当前综合分从 `7.5` 提升到 `9.0+` 的阶段性执行方案。

它不是长期母文档，也不替代：

- [`../architecture.md`](../architecture.md)
- [`../engineering-quality.md`](../engineering-quality.md)
- [`../issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md)
- [`../roadmap-and-prioritization.md`](../roadmap-and-prioritization.md)

本文只回答 4 件事：

- 当前为什么还是 `7.5`
- 拉升到 `9.0+` 必须完成哪些结构与质量收口
- 这些事情的执行顺序是什么
- 每一项完成后如何验收

---

## 2. 当前基线

当前真实评分基线：

- 架构：`7.8 / 10`
- 工程质量：`7.2 / 10`
- 综合：`7.5 / 10`

当前主要扣分项：

- 默认验证门槛没有覆盖仓库里现有的全部测试
- `shared/*` 仍保留反向依赖 `features/*` 的兼容壳
- `app/*` 仍有少量直接触碰持久化适配的代码
- 前端与 Rust 仍有若干复杂度热点文件
- CI 与发布链虽然可用，但还不足以支撑 `9.0+` 的“默认可信”

---

## 3. 目标定义

## 3.1 分数目标

- 架构达到 `9.0+`
- 工程质量达到 `9.0+`
- 综合达到 `9.0+`

## 3.2 达标标准

达到 `9.0+` 不等于“看起来更整齐”，而是至少满足：

- 默认验证门槛真实覆盖关键现有测试资产
- `shared/*` 不再依赖 `features/*` 承接稳定能力
- `app/*`、Rust `commands/*`、`lib.rs` 继续保持薄
- 关键兼容壳要么退役，要么被明确限制为临时薄转发
- 复杂度热点显著下降，后续维护成本有实质改善
- CI 与 release gate 能默认拦住关键路径回归

## 3.3 非目标

- 不做一次性全仓库重构
- 不为了“9.0+”引入新的长链抽象
- 不为低频边缘场景扩张产品表面
- 不把稳定期收口演变成平台化扩张

---

## 4. 执行原则

- [x] 每一步先判定真实 owner，再决定改动位置
- [x] 所有涉及边界的改动优先走最小收口，不走目录美容式迁移
- [x] 不新增新的兼容壳，除非同时写清 owner 与退出条件
- [x] 每一阶段结束都要跑与风险匹配的验证链
- [x] 只有上一阶段达标后，才进入下一阶段

---

## 5. 总体阶段

建议按下面 6 个阶段推进：

1. 验证门槛补齐
2. `shared/*` 边界收口
3. `app/*` 薄化与 owner 回收
4. 热点复杂度拆解
5. CI / 发布链硬化
6. 文档回写与最终复评

建议顺序不要打乱。

原因：

- 第 1 阶段先补验证，后面的收口才有安全网
- 第 2、3 阶段先解决边界错位，再谈热点拆解
- 第 4 阶段是在边界清晰后做复杂度下降，不然容易一边拆一边继续错放 owner
- 第 5 阶段把前面收口成果变成默认守门
- 第 6 阶段再更新长期文档与归档

---

## 6. 第一阶段：验证门槛补齐

阶段目标：

- 让“默认最低验证门槛”真实覆盖当前仓库已有关键测试
- 消除“测试存在但默认不跑”的盲区

完成标准：

- `npm run check` 或其等价默认前端门槛，覆盖当前前端关键测试资产
- 更新 UI / view model 相关测试进入默认链路
- PR / 本地执行对关键路径回归有一致口径

执行清单：

- [x] 盘点当前所有 Node/TS 测试入口，列出“已被默认脚本覆盖”和“未被默认脚本覆盖”的清单
- [x] 将 [tests/updateViewModel.test.ts](../../tests/updateViewModel.test.ts) 纳入默认前端验证门槛
- [x] 明确 `npm test`、`npm run test:replay`、`npm run check` 的职责边界，避免未来继续出现“新增测试但未接线”
- [x] 如果继续使用分散脚本，新增统一聚合脚本，避免手工记忆多个测试入口
- [x] 为更新流程、view model、关键页面状态机补一轮测试覆盖缺口盘点
- [x] 对每一个未进入默认门槛但声称“关键”的测试，做二选一处理
- [x] 处理方式一：接入默认门槛
- [x] 处理方式二：明确降级为非默认门槛并记录理由
- [x] 校验 `npm run check` 与仓库文档中的“默认最低验证门槛”完全一致

验收门槛：

- [x] `npm run check` 覆盖 tracking 生命周期
- [x] `npm run check` 覆盖 replay
- [x] `npm run check` 覆盖 update view model 或其等价关键 UI 状态机测试
- [x] 不再存在“仓库里已有关键测试，但默认门槛完全不执行”的情况

建议验证：

```powershell
npm run check
node --experimental-strip-types --experimental-specifier-resolution=node tests/updateViewModel.test.ts
```

阶段完成后预期分数变化：

- 工程质量：`+0.4 ~ +0.6`

---

## 7. 第二阶段：`shared/*` 边界收口

阶段目标：

- 清理 `shared/*` 对 `features/*` 的反向依赖
- 把“确实稳定共享”的能力放进真实共享 owner
- 让“兼容壳”显式变薄或退役

当前重点对象：

- [src/shared/lib/appClassificationFacade.ts](https://github.com/Ceceliaee/patina/blob/841804074493e383ffcc1a0ad30edad31a350339/src/shared/lib/appClassificationFacade.ts)
- [src/shared/lib/historyReadModelService.ts](https://github.com/Ceceliaee/patina/blob/841804074493e383ffcc1a0ad30edad31a350339/src/shared/lib/historyReadModelService.ts)

推荐 owner 判断：

- 分类 canonical normalization、category token、只读映射规则，如果确实被 dashboard/history/appshell 多处稳定依赖，应升级为真正的 `shared` 能力
- 分类 UI 编辑、draft、保存、删除、分类控制，继续留在 `features/classification/*`
- dashboard/history 的 feature 私有 read model 入口，继续留在各自 feature，不应再通过 `shared/lib/historyReadModelService.ts` 提供“历史兼容公共入口”

执行清单：

- [x] 为“分类稳定共享能力”写出最小 owner 清单
- [x] 明确哪些能力应该进入 `shared/*`
- [x] 明确哪些能力必须留在 `features/classification/*`
- [x] 将 `appClassificationFacade` 依赖的稳定只读能力迁移到真实共享 owner
- [x] 替换 `AppShell`、`History`、`Dashboard`、`shared/lib/*` 对旧 facade 的依赖
- [x] 把 `shared/lib/appClassificationFacade.ts` 降为临时薄转发，或在同阶段直接删除
- [x] 盘点 `historyReadModelService.ts` 的剩余调用方
- [x] 将剩余调用方改为直接依赖真实 owner
- [x] 删除 `shared/lib/historyReadModelService.ts`，如果必须保留则明确标记退出条件与禁止新增调用
- [x] 运行 import 边界检查，确保 `src/shared/**` 不再直接 import `src/features/**`

硬性验收：

- [x] `src/shared/** -> src/features/**` 的直接依赖归零
- [x] `shared/*` 内不再承担 feature 私有规则转发
- [x] 所有保留的兼容壳都只有薄转发，不新增逻辑

建议验证：

```powershell
rg -n "../../features|../features" src/shared -g "*.ts" -g "*.tsx"
npm run check
```

阶段完成后预期分数变化：

- 架构：`+0.5 ~ +0.7`
- 工程质量：`+0.2 ~ +0.3`

---

## 8. 第三阶段：`app/*` 薄化与 owner 回收

阶段目标：

- 把 `app/*` 里残留的直接持久化操作、feature 私有规则、临时 owner 回收到真实归属层

当前重点对象：

- [src/app/AppShell.tsx](../../src/app/AppShell.tsx)
- `app/services/*`
- `app/hooks/*`

优先处理点：

- [AppShell.tsx](../../src/app/AppShell.tsx) 直接调用 `saveSetting`
- 任何 `app/*` 中直接 import `shared/lib/*Persistence*`、`platform/persistence/*`、feature 私有 service 的情况

执行清单：

- [x] 审计 `src/app/**` 对 persistence adapter、DB adapter、feature 私有 service 的直接依赖
- [x] 给每一处直接依赖做 owner 归类
- [x] 将 `AppShell` 中的 `min_session_secs` 直接持久化操作迁回 settings owner
- [x] 明确“应用壳层只编排，不直接执行 feature 写侧持久化”的规则
- [x] 检查 `app/hooks/*` 是否承接了应属于 feature 或 platform 的规则
- [x] 对 `app/services/*` 中仍带 feature 私有语义的逻辑做回收
- [x] 补充约束性测试或现有测试断言，防止未来再次把写侧逻辑塞回 `app/*`

硬性验收：

- [x] `src/app/**` 不再直接 import settings 持久化 adapter
- [x] `src/app/**` 不直接写 SQL
- [x] `src/app/**` 不直接承接 feature 私有写侧规则

建议验证：

```powershell
rg -n "settingsPersistenceAdapter|platform/persistence|saveSetting\\(" src/app -g "*.ts" -g "*.tsx"
npm run check
```

阶段完成后预期分数变化：

- 架构：`+0.3 ~ +0.5`

---

## 9. 第四阶段：热点复杂度拆解

阶段目标：

- 降低最明显的大文件维护成本
- 让复杂度下降发生在正确 owner 内部，而不是通过跨层转移来“看起来变小”

当前重点对象：

- [src/features/classification/components/AppMapping.tsx](../../src/features/classification/components/AppMapping.tsx)
- [src/features/settings/components/Settings.tsx](../../src/features/settings/components/Settings.tsx)
- [src-tauri/src/engine/tracking/runtime.rs](../../src-tauri/src/engine/tracking/runtime.rs)

原则：

- 前端页面仍留在原 feature 内拆分，不回流 `shared/*`
- Rust tracking 主链仍留在 `engine/tracking/*`
- 不为拆文件而拆文件，只拆明确职责块

### 9.1 AppMapping 拆解

执行清单：

- [x] 将 `AppMapping.tsx` 中的 bootstrap / draft state / save flow 拆到 feature 内 hooks 或 services
- [x] 将分类对话框、候选项列表、名称编辑编排拆成局部 owner
- [x] 将“候选项过滤与排序规则”收口为 feature 内纯函数
- [x] 保持页面组件只负责组装、渲染和事件连接

验收：

- [x] `AppMapping.tsx` 主文件明显缩短
- [x] 拆出的逻辑全部留在 `features/classification/*`
- [x] 没有把页面私有逻辑挪进 `shared/*`

### 9.2 Settings 页面拆解

执行清单：

- [x] 将 `Settings.tsx` 中的页面级流程拆为更小的 feature 内 hooks 或 services
- [x] 继续减少页面层中的 bootstrap / save / backup / restore 编排噪音
- [x] 保持 settings 行为 owner 仍在 `features/settings/*`

验收：

- [x] `Settings.tsx` 更接近 page composition，而不是操作流程中心

### 9.3 Rust tracking runtime 拆解

执行清单：

- [x] 把 `runtime.rs` 中的循环状态加载、seal 规则、power 生命周期、helper 分组拆到 `engine/tracking/*` 内明确 owner 文件
- [x] 保持 `run()` 负责主链编排，不继续吸收 helper 细节
- [x] 将 runtime 测试按职责拆散，减少单文件超长测试区
- [x] 保证 tracking 核心行为仍留在 `engine/tracking/*`，不回流 `app/*`、`commands/*` 或 `domain/*`

验收：

- [x] `runtime.rs` 主文件明显变短
- [x] `engine/tracking/*` 内职责边界更清晰
- [x] 关键 tracking 行为测试仍覆盖原链路

建议验证：

```powershell
npm run check
cargo check --manifest-path src-tauri/Cargo.toml --quiet
```

阶段完成后预期分数变化：

- 架构：`+0.2 ~ +0.4`
- 工程质量：`+0.4 ~ +0.6`

---

## 10. 第五阶段：CI 与发布链硬化

阶段目标：

- 把前面完成的“默认质量要求”变成自动守门，而不是只靠人工记忆

执行清单：

- [x] 增加面向 PR 的默认验证 workflow
- [x] workflow 至少覆盖 `npm run check`
- [x] workflow 对 Rust 关键路径覆盖 `cargo check --manifest-path src-tauri/Cargo.toml --quiet`
- [x] 对 release 相关改动明确是否需要 `npm run release:check`
- [x] 确保 CI 使用与本地一致的脚本入口，而不是重新拼装一套隐性命令
- [x] 明确失败策略：关键 gate 失败则不允许合并
- [x] 把新增 gate 回写到长期文档或 README 的贡献/验证说明

硬性验收：

- [x] PR 有自动 gate
- [x] gate 与本地脚本一致
- [x] 关键路径回归不再依赖人工手动补跑

建议验证：

- [x] 在 CI 中跑一次完整门槛并确认失败/成功路径正确

阶段完成后预期分数变化：

- 工程质量：`+0.4 ~ +0.5`

---

## 11. 第六阶段：文档回写与最终复评

阶段目标：

- 把执行结果沉淀成长期规则
- 关闭阶段性方案，避免长期依赖临时文档

执行清单：

- [x] 回写 `architecture.md` 中受本轮收口影响的长期事实
- [x] 回写 `engineering-quality.md` 中实际执行后的默认门槛与协作规则
- [x] 如果新增了 CI / 验证口径，更新 README 或贡献说明
- [x] 对已退休兼容壳、已迁移 owner、已完成 gate 做最终盘点
- [x] 对本方案逐项打勾，留下最终结果
- [x] 重新做一次架构与工程质量复评
- [x] 本方案完成后移入 `docs/archive/`

最终验收门槛：

- [x] 默认验证门槛真实覆盖关键测试资产
- [x] `shared/*` 不再依赖 `features/*`
- [x] `app/*` 继续保持薄，不直接承接写侧持久化
- [x] Rust `lib.rs`、`commands/*` 继续保持薄
- [x] 关键复杂度热点完成一轮 owner 内拆解
- [x] PR gate 已经自动化
- [x] 长期文档与仓库现状一致

---

## 12. 阶段性打分目标

建议按下面节奏看分数，而不是只看最终结果：

### 完成第一阶段后

- 架构：`7.8`
- 工程质量：`7.8 ~ 8.0`
- 综合：`7.9`

### 完成第二、第三阶段后

- 架构：`8.5 ~ 8.7`
- 工程质量：`8.0 ~ 8.2`
- 综合：`8.3 ~ 8.4`

### 完成第四阶段后

- 架构：`8.7 ~ 8.9`
- 工程质量：`8.5 ~ 8.7`
- 综合：`8.6 ~ 8.8`

### 完成第五、第六阶段后

- 架构：`9.0+`
- 工程质量：`9.0+`
- 综合：`9.0+`

---

## 13. 不达标时的止损规则

如果执行过程中出现下面任一情况，应暂停并重新收口，而不是继续硬推：

- [x] 为了删兼容壳，反而新增了更厚的新中间层
- [x] 为了缩短文件，把 owner 错放到 `shared/*` 或 `app/*`
- [x] 为了提高分数，增加了大量形式化流程但没有真实守住回归
- [x] 默认验证门槛变得过慢，导致团队绕开它
- [x] 复杂度拆解没有降低理解成本，只是把逻辑切成更多文件

---

## 14. 建议执行节奏

建议采用下面节奏：

- [x] 第 1 周：完成第一阶段
- [x] 第 2 周：完成第二阶段
- [x] 第 3 周：完成第三阶段
- [x] 第 4 至 5 周：完成第四阶段
- [x] 第 6 周：完成第五、六阶段并复评

如果资源有限，最低优先保留的顺序是：

1. 第一阶段
2. 第二阶段
3. 第三阶段
4. 第五阶段
5. 第四阶段
6. 第六阶段

说明：

- 第四阶段很重要，但它建立在前面边界已经清晰的前提上
- 如果没有前两阶段，直接拆大文件通常很难把综合分拉到 `9.0+`

---

## 15. 最终定义：什么时候算真的达到 9.0+

只有当下面这些判断同时成立时，才应把综合分正式上调到 `9.0+`：

- [x] 不是“文档说会做”，而是仓库结构已经真实收口
- [x] 不是“测试存在”，而是默认门槛真的会跑它们
- [x] 不是“compatibility shell 还在以后再删”，而是关键兼容壳已经退役或被证明足够薄
- [x] 不是“个别文件短了”，而是热点维护成本真的下降
- [x] 不是“手工补跑都能过”，而是 CI 默认能守住关键链路

只满足其中一部分，最多只能算 `8.x`。
