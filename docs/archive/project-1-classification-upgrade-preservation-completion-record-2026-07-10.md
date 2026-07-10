# Project #1 分类配置升级保真：完成证据记录

Project：[`Patina Development Queue #1`](https://github.com/users/Ceceliaee/projects/1)

Issue：Refs [#37](https://github.com/Ceceliaee/patina/issues/37)

执行方案：[`project-1-classification-upgrade-preservation-adversarial-review-execution-plan-2026-07-10.md`](./project-1-classification-upgrade-preservation-adversarial-review-execution-plan-2026-07-10.md)

状态：实现与验证已完成，文档已归档；Project #1 已同步为 `Done`

## 1. 完成勾选与最终范围裁决

以下清单是根因确认后的最终适用完成门。原执行方案保留建档时的完整对抗式假设空间；其中安装器、数据根、WebView profile 等条件分支不会被伪装成已执行，因为证据已将根因定位到 Classification 冷启动读取的破坏性 writeback，这些分支不是本次生产改动的 owner。

- [x] 确认受支持升级边界：已成功启动 v1.5.2 的 Patina 数据状态及其后版本。
- [x] 修复前建立失败回归：`classificationStore.ts` 不提供只读解析边界，启动读取会删除当前版本不认识的 `__deleted_category::` 键。
- [x] 根因定位到 feature 私有持久化读取 owner，没有修改 UI、app shell、commands、schema 或数据路径。
- [x] 启动读取改为纯解析；未知、扩展、保留分类只忽略显示，不再产生删除写入。
- [x] 显式保存和用户主动删除仍沿用原校验与事务边界，没有放宽写入规则。
- [x] 旧 schema + 旧 migration history + 八类 classification settings 的升级与二次启动 raw snapshot 严格相等。
- [x] v1.8.2 现代 opaque custom category ID 的唯一恢复在下一次冷启动保持幂等。
- [x] 隔离浏览器 profile 冷启动保留未知升级键，且后端事务网关没有收到对应 delete mutation。
- [x] `npm run test:classification` 通过：39/39。
- [x] Rust 旧库升级聚焦测试通过：1/1。
- [x] `npm run test:ui-browser-smoke` 通过：27/27。
- [x] 最终 `npm run check:full` 通过：前端完整测试、真实浏览器 smoke、build、bundle、Rust boundary、315 个通过的 Rust 测试（1 个既有 ignored）和 Clippy 均成功。
- [x] `CHANGELOG.md` 已在 `Unreleased / Fixed` 记录用户结果并关联 Issue #37。
- [x] 未修改版本号、未触碰生产数据目录、未关闭或修改 GitHub Issue #37。
- [x] 执行单与完成记录均位于 `docs/archive/`。
- [x] Project #1 已更新为 `Done`：看板复核为 `In progress 0 / Done 1`，`Next` 保持 3 项。

## 2. 安装包矩阵裁决

建档阶段把完整 NSIS 安装包矩阵列为兜底验证，用于排查 identifier、数据根和 WebView profile 变化。最终证据表明：

1. v1.5.2 至当前版本的 production/local identifier、产品目录和 `patina.db` 契约未变化，release policy 测试继续通过。
2. 当前 schema preparation 对旧库中全部受保护分类行在升级与第二次启动后保持严格相等。
3. 真实失败发生在 schema 完成后的 Classification bootstrap 读取；旧实现会发出删除 mutation，新实现的隔离浏览器冷启动已证明不再发出该 mutation。
4. 本次没有修改 installer、数据路径、WebView profile 或 localStorage key。

因此，构建并安装多个旧 tag 不会覆盖新的因果边界，只会重复验证未变更的安装器路径；该条件分支被正式裁定为本次不适用，由“旧库升级双启动 fixture + 隔离浏览器冷启动 + 完整真实浏览器 smoke”替代。若后续出现路径或 profile 证据，应新建对应 Project item，而不是扩大本修复。

## 3. 风险登记与实际缓解

| 风险 | 实际缓解 |
| --- | --- |
| 把打开错误 DB 误判为 parser bug | 检查 canonical DB path 与 schema preparation；根因发生在其后的 Classification bootstrap |
| 只比较行数，遗漏语义损坏 | raw snapshot、effective snapshot 与 UI cold-start 三层断言 |
| 重复实现 Issue #32 | 保留 custom ID 回归；本次只移除未知 deleted-category 键的读取时删除 |
| 混淆 localStorage 与 SQLite | SQLite fixture 与隔离浏览器 profile 分开验证 |
| 第二次启动再次改写 | 双启动 raw snapshot 严格相等，二次解析无 mutation |
| 测试污染生产数据 | 使用内存 SQLite、浏览器 smoke 隔离存储与临时数据 |
| 过度积极修复未知数据 | 未知、扩展、保留或未来格式保持原始数据，只从当前有效集合忽略 |
| 制造高吸力层 | 修复只落在 feature 私有 store；未修改 app、shared、commands 或 lib.rs |
| 安装包只覆盖首次启动 | 以旧库双启动与浏览器冷启动替代不适用的安装包路径分支 |
| 无意扩大支持范围 | 支持边界锁定为已成功启动 v1.5.2 的数据状态及其后版本 |

## 4. 审查者反向提问结论

- [x] 已证明打开并升级的是同一份用户数据库状态。
- [x] 已分别排除 WebView profile、localStorage、schema 和数据路径作为本轮根因。
- [x] 最小失败测试指向读取时的隐式删除。
- [x] raw settings 行在升级与第二次启动保持严格相等。
- [x] owner 选择为 `classificationStore.ts`，未扩散到高吸力层。
- [x] 未知和歧义数据保持原样。
- [x] 第二次启动不会再次改写。
- [x] `npm run check:full` 真实完整通过。
- [x] Project 状态已同步为 `Done`，且未改变其他卡片状态或手动顺序。

## 5. 根因结论

- 根因层：Classification bootstrap 的持久化读取阶段存在破坏性 writeback。
- 首个失败阶段：`loadDeletedCategories()` 遇到当前版本不可持久化的分类键时调用 `deleteSettingValue()`。
- 真实 owner：`src/features/classification/services/classificationStore.ts`。
- 禁止扩散层：React 页面、`app/*`、Rust `commands/*`、SQLite schema、数据路径与 installer。
- 支持源版本边界：已安装并成功启动过 v1.5.2 的数据状态及其后版本；pre-1.5.2 仍遵循先经过 v1.5.2 的历史承诺。

## 6. 修复内容

- 生产代码：把 deleted-category rows 的解析提取为纯函数，加载路径只读，不再删除未知数据。
- 自动化 fixture：新增旧 schema/migration history 的 SQLite classification snapshot 测试、现代 ID 二次冷启动测试和隔离浏览器冷启动持久化测试。
- 兼容/repair 规则：当前可识别的 seeded deleted marker 正常生效；未知、扩展、保留或未来格式保持原始数据但不进入当前有效集合。
- 幂等策略：第二次 schema preparation raw snapshot 不变；已恢复的现代 category ID 第二次解析无 mutation；浏览器冷启动不发 delete mutation。
- 回滚策略：生产改动仅移除读取时的隐式删除；回滚代码即可恢复旧行为，不涉及 schema、迁移 marker 或不可逆数据变换。

## 7. 验证结果

- `npm run test:classification`：修复前新增测试因缺少只读解析 export 失败；修复后 39/39 通过。
- SQLite 升级聚焦测试：1/1 通过，升级与第二次启动 raw snapshot 严格相等。
- `npm run test:interaction`：9/9 通过。
- `npm run test:persistence`：6/6 通过。
- `npm run test:ui-browser-smoke`：27/27 通过，包含隔离 profile 冷启动保留未知升级设置。
- `npm run check:full`：通过；首次沙箱内运行仅因 `spawn EPERM` 中断，获准在沙箱外重跑后完整通过，最终代码再次完整通过。
- Windows 安装包升级矩阵：根因裁决后不适用，替代证据见本记录第 2 节。

## 8. Project 收尾

- Project #1 当前公开状态：`Done`。
- `Next` 补位状态：公开看板仍有 3 项 `Next`，无需补位，未改动其他卡片。
- 完成后状态：本地实现、验证、文档归档和 Project 外部状态同步均已完成。
- 正式发布后清理：待发布后执行。

## 9. 完成定义

本任务不是在“找到一个看起来像 bug 的函数”时完成，也不是在单元测试转绿时完成。只有当以下事实同时成立时，才算真正完成：

1. 已证明根因发生在哪一层。
2. 已用旧发布结构与隔离冷启动复现并固定回归。
3. 修复只改变真实 owner。
4. raw persistence、effective semantics、UI consumers 和 cold restart 四个层次都通过。
5. 修复对未知数据保守，对确定数据无损，对重复启动幂等。
6. 完整质量门、旧库双启动和隔离浏览器冷启动通过；安装包矩阵已按根因证据裁定为不适用。
7. Changelog、执行方案和完成记录归档完成；Project #1 已同步为 `Done`，`Next` 队列保持 3 项。
