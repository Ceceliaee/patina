# 稳定期问题修复边界守则

## 1. 文档定位

本文是稳定期修复的决策 how-to：先判断问题 owner，再选择足够轻的执行模式。长期分层与 owner 由 [`architecture.md`](./architecture.md) 定义，风险与验证由 [`engineering-quality.md`](./engineering-quality.md) 定义；本文不复制它们的完整清单。

它不授权扩大范围、创建兼容壳、跨层搬迁、commit、push、Issue、Project 或发布操作。

## 2. 第一原则

修复不是“让症状消失”，而是在真实 owner 处恢复契约，并用能失败的证据保护它。

默认顺序：

1. 写清可观察症状、正确结果和最小复现。
2. 沿数据流、调用链和状态 owner 找到第一处错误事实。
3. 判断是局部实现错误、owner 边界不清，还是多阶段高风险工作。
4. 选择最轻但足够的模式。
5. 在真实 owner 处修复，新增能够区分修复前后的验证。
6. 检查高吸力层、兼容层和无关 diff 是否变厚。

“改动小”不代表可以改在错误位置；“测试通过”也不证明 owner 正确。

## 3. 三种处理模式

| 模式 | 适用条件 | 允许动作 | 必须停止并升级的信号 | 交付 |
| --- | --- | --- | --- | --- |
| 小修 | 单一 owner、行为边界清楚、改动局部、风险可由现有或一个 focused test 覆盖 | 在 owner 内修改实现与测试，运行风险匹配验证 | 需要新共享抽象、跨层迁移、兼容壳、schema/协议/恢复语义变化 | 简短根因、改动、验证 |
| 边界判断 | 症状跨层、存在两个候选 owner、高吸力层正吸收逻辑、修复位置会改变长期边界 | 只读追踪 owner，比较方案，确认落点后实施最小变更 | 无法在现有架构内说明 owner，或需要多 owner 协调和退出条件 | owner 判断、拒绝方案、实施与验证 |
| 执行单 | 多阶段、跨 owner、高风险数据/发布/协议工作，或需要迁移和可恢复顺序 | 在 `docs/working/` 建一次性清单，逐项验证，完成后归档 | 范围、授权、兼容或不可逆动作未确认 | 完整清单、证据、偏差、归档记录 |

模式可以升级，不能为了形式完整而一开始就创建执行单。已进入执行单的任务也不能用 checkbox 代替真实证据。

## 4. 小修流程

小修同时满足：

- owner 唯一且与架构一致；
- 不新增跨 feature 共享能力、平台边界或转发层；
- 不改变 released data、外部协议、migration、备份恢复、发布资产或权限语义；
- focused test 能直接覆盖失败模式；
- diff 不夹带重构、命名清理或格式化。

执行时先写失败测试或确认已有测试在修复前能失败，再做最小实现。若调查发现错误事实属于上游 owner，移动修复位置而不是在调用方补第二套规则。

## 5. 边界判断流程

边界判断至少回答：

1. 哪个模块拥有原始事实、生命周期和失败行为？
2. 哪个层只应消费或编排，而不应重新解释事实？
3. 修复是否让 `app/*`、`shared/*`、`platform/*`、Rust `lib.rs` 或 `commands/*` 变厚？
4. 是否存在唯一 canonical 实现，还是正在形成 `V2 / New / Compat` 并行链？
5. 若保留例外，它服务哪个真实已发布或外部兼容边界，何时删除？

选择能减少长期状态和跨层知识的方案。页面局部 workaround、宽泛 shared helper、万能 platform adapter 和厚 command handler 默认都是需要重新判断的信号。

## 6. 执行单流程

执行单只服务当前任务，必须：

- 放在 `docs/working/`，声明范围、非目标、受保护边界、阶段和验证；
- 把每个跨 owner 动作拆成可观察终点；
- 记录不可用验证、偏差与残余风险，不虚构通过；
- 长期结论直接更新 active owner；
- 完成所有适用项并经过审查后移到 `docs/archive/`；
- 不让 archive 或本地 Agent 状态成为后续执行前提。

## 7. 必须先停下来的信号

出现下列任一项，不能继续按“顺手小修”推进：

- 需要新增共享抽象、跨层端口、平台适配或 composition 关系；
- 需要在调用方复制源 owner 的规则、缓存或状态机；
- 需要新增 compatibility shell、legacy reader 或双写路径，但没有真实兼容对象与退出条件；
- 会改变 SQLite schema、migration、备份/恢复、数据清理、协议、updater、签名、capability 或权限；
- 会改变 Quiet Pro 的长期视觉方向或交互语义；
- 需要删除、覆盖或迁移不可恢复的数据；
- 当前工作树改动与目标 owner 重叠且无法安全区分；
- 只有扩大用户授权或远程写入才能继续。

前六类升级模式并核对对应长期 owner；后两类停止并请求方向或权限。

## 8. 风险路由与验证

- 结构和 owner：按 [`architecture.md`](./architecture.md) 及其边界门禁。
- 可见 UI：按 [`quiet-pro-component-guidelines.md`](./quiet-pro-component-guidelines.md)，覆盖状态、键盘、焦点、可访问性和可重复 browser test。
- 数据、恢复、runtime、依赖与发布：按 [`engineering-quality.md`](./engineering-quality.md) 选择风险证据。
- 版本、资产、updater 与兼容窗口：按 [`versioning-and-release-policy.md`](./versioning-and-release-policy.md)。
- Web Activity：按 [`web-activity-protocol.md`](./web-activity-protocol.md)。
- 本地化：按 [`localization.md`](./localization.md)。

默认入口是 `npm run check`；触及 Rust、架构执行边界或发布级风险时使用 `npm run check:full`。当前命令图由 `package.json` 拥有，本文不列出叶子命令。无法运行的检查必须说明原因、残余风险和真正的验证 owner。

## 9. 完成判断

修复完成必须同时满足：

- 可观察症状消失，focused evidence 能在旧行为上失败；
- 修复位于真实 owner，没有在调用方形成第二套事实；
- 高吸力层、兼容层和公共 API 没有无理由变厚；
- 与任务无关的用户改动未被覆盖；
- 风险匹配验证通过，未运行项有明确说明；
- 临时执行单已更新长期 owner 并按生命周期归档。
