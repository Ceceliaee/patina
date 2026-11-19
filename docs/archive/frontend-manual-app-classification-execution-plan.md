# 执行单：应用分类改为完全手动确认

Document Type: One-off Execution Plan

## 1. 文档定位

本文是一次性执行方案，用于将当前应用分类语义从“内置映射 / 关键字规则自动分类 + 用户覆盖”收口为：

> 自动记录应用，手动分类应用。

本文只负责本轮实施步骤、边界、验证与退出条件，不替代长期文档。

长期依据：

- [`../product-principles-and-scope.md`](../product.md)
- [`../roadmap-and-prioritization.md`](../product.md#优先级)
- [`../architecture.md`](../architecture.md)
- [`../engineering-quality.md`](../quality.md)
- [`../issue-fix-boundary-guardrails.md`](../quality.md#修复与回归证据)
- [`../quiet-pro-component-guidelines.md`](../ui.md)
- [`../versioning-and-release-policy.md`](../release.md)

## 2. 背景

当前应用分类同时存在三种来源：

1. `src/shared/classification/defaultMappings.ts` 中的内置应用映射。
2. `src/shared/classification/processMapper.ts` 中的关键字分类规则。
3. 用户在应用页保存的 app override。

这会产生一个可信度问题：

- 软件数量很多，内置映射不可能长期覆盖完整。
- 关键字规则可能误判，例如进程名、应用名或路径中碰巧包含宽泛关键词。
- 自动分类后的应用直接进入“已分类”，用户不容易发现它已经被系统分到了错误位置。
- 分类属于用户语义，不是系统能够稳定推断的客观事实。同一个应用可能被不同用户归为办公、学习、开发或其他类别。

当前产品长期原则强调：

- 自动记录优先于手工计时。
- 用户必须能理解系统在做什么。
- 分类、重命名和配色属于可管理的应用语义层。
- 可信度问题高于体验润色。

因此，本轮不是继续扩充白名单或优化猜测规则，而是删除“自动业务分类”这条产品语义。

## 3. 已确认的产品决策

以下决策已经确认，本轮实施时不再重新发散：

- [x] 自动记录前台应用保持不变。
- [x] 新出现的普通应用统一进入“未分类”。
- [x] 只有用户主动选择并保存分类后，应用才进入对应分类和“已分类”筛选。
- [x] 不展示“建议分类”。
- [x] 不保留关键字规则作为隐藏建议器。
- [x] 删除分类下拉框中的“自动识别”选项。
- [x] 删除应用卡片中的“恢复默认识别”操作。
- [x] 用户选择“未分类”时，语义是撤销手动分类。
- [x] 已有用户手动保存的分类继续保留。
- [x] 已有分类颜色、自定义分类、统计开关、标题记录开关、应用名称覆盖继续保留。

## 4. 语义边界

本轮删除的是：

- 普通应用的自动业务分类。
- 普通应用的关键字业务分类。
- 应用页中的“自动识别”分类入口。
- 应用卡片中的“恢复默认识别”入口。

本轮必须保留的是：

- Windows 前台应用自动记录。
- 系统进程、安装器、更新器、卸载器和临时进程过滤。
- 应用可执行文件名归一化。
- 已知辅助进程到主应用身份的别名归一化，例如 tray、widget、helper。
- 已知应用的稳定显示名称，例如 `wps.exe -> WPS Office`。
- 用户手动保存的分类、名称、颜色、统计开关和标题记录开关。
- “恢复默认颜色”独立入口。

不得把“删除自动分类”误做成：

- 删除系统进程过滤。
- 删除应用名称识别。
- 删除别名归一化。
- 删除分类颜色体系。
- 删除用户 app override。
- 修改 Rust tracking 主链。

## 5. 目标行为

### 5.1 分类解释规则

| 场景 | 目标分类 |
| --- | --- |
| 普通应用首次出现，没有用户分类 override | `other`，即“未分类” |
| 已知普通应用首次出现，例如 `wps.exe`、`chrome.exe`、`sublime_text.exe` | `other`，即“未分类” |
| 未知普通应用首次出现 | `other`，即“未分类” |
| 普通应用进程名或应用名命中旧关键字，例如包含 `code`、`book`、`office` | `other`，即“未分类” |
| 用户手动选择内置分类并保存 | 使用用户选择的分类 |
| 用户手动选择自定义分类并保存 | 使用用户选择的自定义分类 |
| 用户将已分类应用改为“未分类”并保存 | 清除手动分类，回到 `other` |
| 应用只有名称、颜色、统计开关或标题记录 override，没有分类 override | `other`，即“未分类” |
| 系统进程或噪音进程 | 继续排除，不进入普通应用分类路径 |

### 5.2 应用页交互规则

分类下拉框：

- 不再显示“自动识别”。
- 保留用户可选择的内置分类、自定义分类和“未分类”。
- “未分类”继续放在列表末尾，降低误触。

应用卡片：

- 删除“恢复默认识别”操作。
- 保留“记录标题 / 不记录标题”切换。
- 保留“计入统计 / 不计入统计”切换。
- 保留“删除应用记录”操作。
- 保留独立的“恢复默认颜色”图标操作。

名称恢复：

- 删除整卡重置后，仍必须保留恢复默认名称的路径。
- 当前名称编辑流程支持将输入框清空后回退到自动识别到的应用显示名。
- 本轮应验证该行为仍然成立，不新增另一个“恢复默认识别”变体。

## 6. 旧用户兼容规则

### 6.1 无需数据库迁移的部分

当前普通应用自动分类来自源码默认映射和关键字规则，不是批量写入数据库的分类结果。

因此规则移除后：

- [x] 没有用户分类 override 的普通应用会自然回到“未分类”。
- [x] Dashboard、History、Data 和 App Mapping 会通过统一 `ProcessMapper` 语义看到新的分类结果。
- [x] 不需要修改 `sessions` 表。
- [x] 不需要新增 SQLite migration。
- [x] 不需要改备份格式。

### 6.2 必须保留的持久化数据

以下数据不得被清理或覆盖：

- [x] `__app_override::*` 中用户手动保存的有效分类。
- [x] `__app_override::*` 中用户保存的显示名称。
- [x] `__app_override::*` 中用户保存的应用颜色。
- [x] `__app_override::*` 中用户保存的统计开关。
- [x] `__app_override::*` 中用户保存的标题记录开关。
- [x] `__category_color_override::*`。
- [x] `__category_default_color_assignment::*`。
- [x] `__custom_category::*`。
- [x] `__deleted_category::*`。

### 6.3 历史 `category: "other"` override

`other` 表示未分类，不应继续作为有意义的手动分类值制造额外状态。

推荐实现：

- 新保存路径中，用户选择“未分类”时清除 `category` 字段，而不是写入 `category: "other"`。
- 如果同一应用还有名称、颜色、统计开关或标题记录开关，只删除分类字段并保留其他 override。
- 如果删除分类字段后不再剩余任何有效 override，则删除该应用的 `__app_override::*` 设置项。
- 读取旧数据时允许历史 `category: "other"` 继续按未分类解释。
- 本轮不为清理历史 `category: "other"` 强行新增迁移；如果顺手归一化，必须通过现有 transition 机制完成，并补测试。

## 7. 架构判断

### 7.1 处理模式

本轮属于：

- `边界判断模式 -> 小范围执行单`

原因：

- 表面上是应用页交互调整。
- 实际上影响 Dashboard、History、Data、Widget 和 App Mapping 共用的分类解释语义。
- 真实 owner 是 `src/shared/classification/*`，而不是只在页面里隐藏按钮。
- 不需要 Rust、SQLite schema 或跨层迁移。

### 7.2 允许修改的 owner

共享分类 owner：

- `src/shared/classification/processMapper.ts`
- `src/shared/classification/defaultMappings.ts`
- `src/shared/classification/processNormalization.ts`
- `src/shared/classification/appClassification.ts`
- 如确有必要，`src/shared/classification/categoryTokens.ts`

Classification feature：

- `src/features/classification/hooks/useAppMappingState.ts`
- `src/features/classification/hooks/appMappingStateHelpers.ts`
- `src/features/classification/hooks/appMappingInteractions.ts`
- `src/features/classification/components/AppMapping.tsx`
- `src/features/classification/components/AppMappingCandidateCard.tsx`
- `src/features/classification/services/classificationDraftState.ts`
- `src/features/classification/services/classificationStore.ts`

共享文案：

- `src/shared/copy/uiText.ts`

测试：

- `tests/trackingLifecycle/processMapper.ts`
- `tests/classificationDraftState.test.ts`
- `tests/interactionFlows.test.ts`
- `tests/trackingReplay.test.ts`
- 如现有 smoke 覆盖需要同步，`tests/uiSmoke.test.ts`
- 如真实浏览器 smoke 覆盖需要同步，`tests/uiBrowserSmoke.test.ts`

发布说明：

- `CHANGELOG.md`

### 7.3 禁止扩散的层

本轮默认不得修改：

- `src-tauri/**`
- SQLite schema 与 migration
- backup payload
- `src/app/**`
- Settings feature
- tracking runtime
- 会话切分、AFK、锁屏、睡眠和持续参与逻辑

如果实施过程中发现必须修改上述区域，停止实施，回到边界判断，不要继续把本轮扩大为跨层改造。

## 8. 推荐实现方向

### 8.1 将已知应用映射降级为身份元数据

`src/shared/classification/defaultMappings.ts` 当前同时承担：

- 稳定显示名称。
- 普通应用默认业务分类。
- 系统进程保留分类。
- 别名归一化依赖的已知身份信息。

本轮应拆开这些语义。

推荐方向：

- 保留已知应用显示名称。
- 保留本地化名称。
- 保留别名归一化所需的主应用身份信息。
- 对系统进程保留明确的内部排除标记或等价的保留语义。
- 删除普通应用的默认业务分类决策。

实现时优先选择最小改动，但命名必须避免继续让后续维护者误以为普通应用应自动进入办公、开发、浏览器等业务分类。

### 8.2 删除关键字业务分类

`src/shared/classification/processMapper.ts` 中的关键字分类规则应删除。

包括但不限于：

- `CATEGORY_BY_KEYWORD`
- `buildSearchText`
- `classifyByKeywords`
- `heuristic` 分类分支

删除后：

- 普通应用没有用户分类 override 时统一映射为 `other`。
- `appName` 仍可用于普通应用的回退显示名称。
- `processPath` 如果不再被分类逻辑消费，应评估是否从 `MappingHints` 中移除；如果保留，必须说明仍由哪个稳定语义消费。

### 8.3 收窄 `ProcessMapper` 的职责

目标职责：

- 解析 canonical executable。
- 应用稳定显示名称。
- 应用用户 override。
- 为未分类普通应用返回 `other`。
- 为系统排除项保持内部保留语义。
- 提供分类颜色。
- 判断是否计入统计。

不再承担：

- 普通应用默认分类。
- 普通应用关键字分类。
- 分类建议。

### 8.4 删除页面中的自动识别交互

在 classification feature 内：

- 删除 `AUTO_CATEGORY_VALUE`。
- 删除分类选项中的 `UI_TEXT.mapping.autoCategory`。
- 将 `handleCategoryAssign` 改为：选择 `other` 时清除分类字段，选择其他分类时保存用户分类字段。
- 删除 `handleResetAppOverride` 以及仅为该操作服务的 props、回调和文案。
- 保持颜色、名称、统计开关和标题记录开关各自的独立恢复路径。

### 8.5 保持用户分类解释一致

以下位置都必须继续通过统一 `ProcessMapper` 语义工作，不允许各自补页面私有规则：

- Dashboard 分类分布。
- Dashboard 小时活动分类分层。
- History 分类展示。
- Data 分类聚合。
- Widget 当前应用名称。
- App Mapping 的“未分类 / 已分类”计数与筛选。

## 9. 详细执行阶段

### 9.1 阶段 A：冻结行为基线与测试清单

目标：

- 在改实现前，先把新语义写成可执行测试。

执行项：

- [x] 在 `tests/trackingLifecycle/processMapper.ts` 中增加普通已知应用默认进入 `other` 的测试。
- [x] 覆盖 `wps.exe`、`chrome.exe`、`sublime_text.exe` 至少三个已知普通应用。
- [x] 增加未知应用默认进入 `other` 的测试。
- [x] 增加旧关键字命中不再自动分类的测试。
- [x] 至少覆盖包含 `code`、`book` 或 `office` 的普通进程名。
- [x] 增加用户手动分类 override 仍然优先生效的测试。
- [x] 增加只有名称 / 颜色 / 统计开关 / 标题记录开关 override 时，分类仍然保持 `other` 的测试。
- [x] 保留系统进程过滤、生命周期辅助进程过滤和别名归一化现有测试。
- [x] 运行测试并确认新增测试在旧实现下失败，失败原因与预期一致。

阶段验收：

- [x] 新语义已经由测试明确表达。
- [x] 测试失败点集中在自动业务分类，不涉及 tracking 主链回归。

### 9.2 阶段 B：拆分身份元数据与业务分类

目标：

- 删除普通应用自动业务分类，同时保留名称识别、别名归一和系统排除。

执行项：

- [x] 盘点 `DEFAULT_APP_MAPPINGS` 中普通应用、系统应用和别名归一依赖。
- [x] 选择最小且清晰的数据结构表达已知应用身份元数据。
- [x] 删除普通应用默认业务分类决策。
- [x] 为系统排除项保留明确内部语义。
- [x] 确认 `processNormalization.ts` 的 derived alias 和 lifecycle alias 行为不回退。
- [x] 确认 `resolveCanonicalDisplayName()` 仍能返回稳定显示名称。
- [x] 确认 `explorer.exe` 仍能按语言显示“文件资源管理器 / File Explorer”。
- [x] 确认 `DouYin_Tray.exe` 等辅助进程仍归一到主应用身份。
- [x] 运行 `npm test`。

阶段验收：

- [x] 普通已知应用首次出现时统一为“未分类”。
- [x] 系统与噪音进程仍不会进入普通统计路径。
- [x] 应用稳定名称和别名归一没有回退。

### 9.3 阶段 C：删除关键字业务分类

目标：

- 彻底移除不再使用的模糊分类规则，不保留隐藏建议逻辑。

执行项：

- [x] 删除 `CATEGORY_BY_KEYWORD`。
- [x] 删除关键字分类 helper。
- [x] 删除 `heuristic` 分类分支。
- [x] 复查 `MappingConfidence` 是否仍有真实调用方。
- [x] 复查 `AppInfo.source` 是否仍需要 `heuristic`。
- [x] 复查 `MappingHints.processPath` 是否仍有真实语义。
- [x] 删除已经失去用途的类型、字段或分支。
- [x] 不新增“建议分类”“置信度”或隐藏推荐替代逻辑。
- [x] 运行 `npm test`。

阶段验收：

- [x] 普通应用分类只可能来自用户保存的分类 override 或 `other`。
- [x] 仓库中不存在普通应用关键字自动分类逻辑。
- [x] 仓库中不存在分类建议逻辑。

### 9.4 阶段 D：收口分类页交互

目标：

- 让应用页完整表达“手动分类”语义。

执行项：

- [x] 删除 `AUTO_CATEGORY_VALUE`。
- [x] 删除分类下拉框中的“自动识别”选项。
- [x] 保持“未分类”位于分类选项末尾。
- [x] 用户选择“未分类”时，只清除 category override。
- [x] 用户选择“未分类”时，保留同一应用已保存的名称覆盖。
- [x] 用户选择“未分类”时，保留同一应用已保存的颜色覆盖。
- [x] 用户选择“未分类”时，保留同一应用已保存的统计开关。
- [x] 用户选择“未分类”时，保留同一应用已保存的标题记录开关。
- [x] 删除 `handleResetAppOverride`。
- [x] 删除 `AppMappingCandidateCard` 的 `onResetOverride` prop。
- [x] 删除应用卡片中的“恢复默认识别”操作。
- [x] 删除中英文 `UI_TEXT.mapping.restoreDefaultApp`。
- [x] 删除中英文 `UI_TEXT.mapping.autoCategory`。
- [x] 复查 `UI_TEXT.settings.otherReviewReset` 等历史文案是否仍有调用方；仅删除确认未使用且与本轮语义冲突的死文案。
- [x] 保留独立“恢复默认颜色”操作。
- [x] 验证名称输入清空后仍能回退到识别到的显示名称。
- [x] 运行 `npm run test:classification`。
- [x] 运行 `npm run test:interaction`。

阶段验收：

- [x] 页面不再出现“自动识别”。
- [x] 页面不再出现“恢复默认识别”。
- [x] 用户可以通过选择“未分类”撤销手动分类。
- [x] 所有非分类 override 都有明确保留或恢复路径。

### 9.5 阶段 E：处理旧 override 兼容

目标：

- 保留用户已有手动设置，并避免 `other` 继续制造无意义持久化。

执行项：

- [x] 增加历史 `category: "other"` 读取测试。
- [x] 确认历史 `category: "other"` 按未分类解释。
- [x] 确认新保存路径不会新增 `category: "other"`。
- [x] 确认清除分类后，如果仍有名称、颜色、统计开关或标题记录开关，其他字段继续保存。
- [x] 确认清除分类后，如果不再有任何有效字段，对应 app override 会被删除。
- [x] 如果增加 transition 归一化，补充 transition mutation 测试。
- [x] 如果不增加 transition 归一化，在代码注释或测试命名中明确“旧值兼容读取，新值不再写入”。
- [x] 运行 `npm run test:classification`。
- [x] 运行 `npm run test:persistence`。

阶段验收：

- [x] 已有用户手动分类不丢失。
- [x] 历史 `other` override 不会破坏新语义。
- [x] 不需要 SQLite migration。

### 9.6 阶段 F：跨页面读模型回归

目标：

- 确认共享分类语义变更不会在 Dashboard、History、Data 或 Widget 中出现分叉。

执行项：

- [x] 更新 `tests/trackingReplay.test.ts` 中受影响的自动分类预期。
- [x] 增加未手动分类应用统一计入 `other` 的回归测试。
- [x] 增加手动分类 override 能传播到 Dashboard 分类分布的回归测试。
- [x] 增加手动分类 override 能传播到小时活动分类分层的回归测试。
- [x] 复查 History 读模型继续使用统一分类结果。
- [x] 复查 Data 读模型继续使用统一分类结果。
- [x] 复查 Widget 当前应用名称不受业务分类移除影响。
- [x] 运行 `npm run test:replay`。
- [x] 运行 `npm run test:data`。
- [x] 运行 `npm run test:data-chart`。
- [x] 运行 `npm run test:widget`。

阶段验收：

- [x] 未手动分类的普通应用在各页面一致显示为“未分类”。
- [x] 手动分类保存后，各页面一致使用用户分类。
- [x] Widget 名称展示没有回退。

### 9.7 阶段 G：Quiet Pro UI 走查

目标：

- 删除操作后保持应用卡片清晰、紧凑，不留下布局空洞。

执行项：

- [x] 检查应用卡片右下角操作区在删除“恢复默认识别”后仍然对齐稳定。
- [x] 检查窄窗口下操作区换行仍然可扫读。
- [x] 检查“未分类 / 已分类”筛选计数符合新语义。
- [x] 检查分类下拉框默认显示“未分类”。
- [x] 检查用户切换分类、取消、保存后的状态提示。
- [x] 检查中文界面。
- [x] 检查英文界面。
- [x] 如 UI smoke fixture 受影响，更新 fixture。
- [x] 运行 `npm run test:ui-smoke`。
- [x] 运行 `npm run test:ui-browser-smoke`。

阶段验收：

- [x] 删除操作后没有新增一次性样式。
- [x] UI 继续符合 Quiet Pro 的克制、清晰和可长期使用基线。
- [x] 中文和英文文案都不再残留“自动识别”语义。

### 9.8 阶段 H：完整验证与发布记录

目标：

- 按稳定期默认门槛完成收尾。

执行项：

- [x] 运行 `npm run check:naming`。
- [x] 运行 `npm run check:architecture`。
- [x] 运行 `npm run check`。
- [x] 手动复查 `git diff --stat`。
- [x] 手动复查 `git diff -- src/shared/classification src/features/classification src/shared/copy tests CHANGELOG.md`。
- [x] 在 `CHANGELOG.md` 的 `[Unreleased]` 中记录用户可感知变化。
- [x] `CHANGELOG.md` 条目说明“应用分类改为由用户手动确认，未手动分类的应用统一进入未分类”。
- [x] 如关联 GitHub issue #6，仅使用 `[#6](https://github.com/Ceceliaee/time-tracking/issues/6)` 引用，不使用 issue-closing 关键词。
- [x] 更新本文档勾选状态。
- [x] 验收完成后将本文档移入 `docs/archive/`。

如实施过程中触及 Rust、SQLite schema、IPC 契约或 tracking 主链，停止并重新评估；只有明确升级范围后才追加：

- [x] 不适用：未触及 Rust、SQLite schema、IPC 契约或 tracking 主链，无需追加 `npm run check:full`。

阶段验收：

- [x] 默认验证链通过。
- [x] changelog 已记录最终用户行为变化。
- [x] 本文档完成后已归档。

## 10. 测试矩阵

### 10.1 共享分类

- [x] 已知普通应用无 override -> `other`。
- [x] 未知普通应用无 override -> `other`。
- [x] 旧关键字命中普通应用无 override -> `other`。
- [x] 用户分类 override -> 用户分类。
- [x] 自定义分类 override -> 自定义分类。
- [x] 名称 override 不改变分类。
- [x] 颜色 override 不改变分类。
- [x] `track: false` override 不改变分类解释，但会排除统计。
- [x] `captureTitle: false` override 不改变分类。
- [x] 系统进程继续排除。
- [x] lifecycle utility 继续排除。
- [x] 已知别名继续归一。
- [x] 已知显示名称继续生效。

### 10.2 Classification 页面

- [x] 默认分类下拉框显示“未分类”。
- [x] 分类下拉框没有“自动识别”。
- [x] 应用卡片没有“恢复默认识别”。
- [x] 手动选择分类后 dirty 状态正确。
- [x] 手动选择“未分类”后 dirty 状态正确。
- [x] 取消后恢复保存态。
- [x] 保存成功后 runtime mapper 同步。
- [x] 保存失败后 dirty 状态保留。
- [x] 清空自定义名称后恢复默认显示名称。
- [x] 恢复默认颜色继续可用。
- [x] 统计开关继续可用。
- [x] 标题记录开关继续可用。
- [x] 删除记录继续可用。

### 10.3 跨页面

- [x] Dashboard 分类分布使用手动分类。
- [x] Dashboard 小时活动分类分层使用手动分类。
- [x] History 使用手动分类。
- [x] Data 使用手动分类。
- [x] Widget 名称展示不回退。
- [x] App Mapping 的“未分类 / 已分类”计数正确。

### 10.4 兼容

- [x] 旧手动分类保留。
- [x] 旧名称覆盖保留。
- [x] 旧颜色覆盖保留。
- [x] 旧统计开关保留。
- [x] 旧标题记录开关保留。
- [x] 旧 `category: "other"` 安全解释为未分类。
- [x] 不新增 SQLite migration。
- [x] 不修改备份格式。

## 11. 完成定义

只有同时满足以下条件，本轮才算完成：

- [x] 普通应用不再通过内置映射自动进入业务分类。
- [x] 普通应用不再通过关键字规则自动进入业务分类。
- [x] 仓库中不存在分类建议逻辑。
- [x] 未手动分类的普通应用统一进入“未分类”。
- [x] 用户手动保存的分类继续优先生效。
- [x] 系统进程过滤、噪音过滤、别名归一和稳定名称没有回退。
- [x] 应用页不再显示“自动识别”。
- [x] 应用页不再显示“恢复默认识别”。
- [x] 用户可以通过选择“未分类”撤销手动分类。
- [x] 名称、颜色、统计开关和标题记录开关仍可独立管理。
- [x] 不修改 Rust tracking 主链。
- [x] 不新增 SQLite migration。
- [x] 不修改备份格式。
- [x] `npm run check` 通过。
- [x] `CHANGELOG.md` 已记录最终用户行为变化。
- [x] 本文档已更新勾选状态并移入 `docs/archive/`。

## 12. 停止信号

出现以下任一情况，停止按本执行单继续实施：

- 需要修改 `src-tauri/**` 才能完成。
- 需要修改 SQLite schema 或新增 migration。
- 需要修改 backup payload 或恢复逻辑。
- 需要新增跨 feature facade。
- 需要把分类规则塞进 `app/*`、页面组件或 `platform/*`。
- 需要为了保留自动分类而重新引入建议器、置信度 UI 或目录规则。
- 无法明确区分“系统进程排除”与“普通应用业务分类”。
- 删除整卡重置后发现某项用户设置失去恢复路径，且不能在 classification feature 内补齐。

遇到停止信号后，应重新按 [`../issue-fix-boundary-guardrails.md`](../quality.md#修复与回归证据) 判断是边界修正还是新的执行单。

## 13. 非目标

本轮明确不做：

- 不做建议分类。
- 不做 AI 分类。
- 不做目录自动分类。
- 不做 exe 完整路径展示。
- 不做按具体分类筛选应用。
- 不重做分类管理弹窗。
- 不重做 Dashboard、History 或 Data UI。
- 不修改分类颜色视觉体系。
- 不新增批量分类操作。
- 不新增 onboarding 分类引导。
- 不关闭、不重开、不打标签或修改 GitHub issue 状态。

## 14. 给后续实施者的执行要求

- 先补测试，再改实现。
- 每完成一个阶段，立即更新本文档对应勾选状态。
- 新逻辑必须落在真实 owner 内。
- 不在页面里复制一套分类判断。
- 不通过数据库迁移掩盖源码规则问题。
- 不删除系统进程过滤和别名归一。
- 不新增分类建议的替代实现。
- 交付前必须运行 `npm run check`。
- 完成后将本文档移入 `docs/archive/`，不要长期留在 `docs/working/`。

## 15. 升级兼容补充

实施后通过旧安装版数据库与开发版对照发现：旧版正确的自动分类结果来自源码映射和关键字规则，不会自动写入 `__app_override::*`。直接删除自动规则会让升级用户已经接受的分类回到“未分类”。

已增加一次性兼容桥接：

- [x] 首次升级时只扫描已有历史记录中的应用。
- [x] 对没有手动分类 override 的历史应用，按旧版规则固化一次分类 override。
- [x] 已有手动分类优先，不被兼容回填覆盖。
- [x] 只有名称、颜色、统计或标题记录 override 时，兼容回填合并分类字段并保留其他字段。
- [x] 使用 `__classification_manual_confirmation_migration::v1` marker 保证只执行一次。
- [x] marker 与回填 override 通过同一批 settings mutation 原子提交。
- [x] Rust classification settings 白名单允许 migration marker，避免初始化失败后 Dashboard 暂时显示为空。
- [x] 分类映射初始化异常时仍保留已加载的全局主题设置，避免设置页与其他页面主题暂时分裂。
- [x] 新出现的应用仍统一进入“未分类”，不会恢复持续自动识别。

退出条件：

- `src/features/classification/services/legacyAutoClassificationMigration.ts` 是临时兼容壳，不是长期分类 owner。
- 当支持从旧自动分类版本直接升级的兼容窗口结束后，应删除该模块、`classificationStore.ts` 中对应 marker 与执行入口，以及相关兼容测试。
- 删除前先确认发布策略不再支持旧版本直接升级，或已通过中间版本完成迁移覆盖。
