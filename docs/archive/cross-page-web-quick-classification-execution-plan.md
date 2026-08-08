# 跨页面网页快捷分类与别名执行方案

## 0. 文档状态

- 状态：已完成并归档
- 文档类型：面向维护者的 How-to 执行方案
- 适用仓库：Patina 主仓库
- 对应 Project 事项：`在 Dashboard 和 History 快捷设置分类与别名`
- 当前 live Project 状态（2026-08-08 只读核对）：`Done`
- 任务性质：补齐已发布跨页面快捷操作中遗漏的网页目标，不建立第二套快捷菜单
- 执行依据：本文件只在任务执行期间作为工作清单；完成后勾选并移入 `docs/archive/`

---

## 1. 问题与目标

当前 Dashboard、History 和 Data 已经为应用图标提供统一的右键快捷入口，用户可以更改名称以及设置、更改或清除分类。History 和 Data 同时展示网页域名，并且网页图标已经可以双击打开统一详情弹窗，但网页图标没有接入相同的右键快捷入口。

这造成了一个用户可感知的不一致：

- 同一个页面里的应用图标可以直接修正语义，网页图标却必须离开当前上下文进入 Classification。
- 应用和网页在 Classification 中都支持名称与分类管理，但核心页面只暴露了应用分支。
- 现有共享组件的名称、目标协议和保存实现均绑定 `exeName`，无法安全接收 `normalizedDomain`。
- 如果直接在 History 或 Data 为网页复制菜单，会重新制造多个 UI owner，后续样式和行为修改必须逐页同步。

本任务的目标是：

- [x] 所有已经支持双击网页详情的图标，都能使用同一套右键快捷界面更改网页名称和分类。
- [x] 应用继续以 `exeName` 作为唯一写入身份，网页继续以 `normalizedDomain` 作为唯一写入身份。
- [x] 应用和网页共享一个菜单、一个分类子菜单、一个改名 Dialog、一个 launcher 和一个未分类 Badge 组件。
- [x] 页面只负责把当前读模型转换成带类型的目标，不负责决定如何读取或保存 override。
- [x] 保存后当前页面立即更新，History、Data、Classification 以及后续打开的其他页面结果一致。
- [x] 双击详情、Data 选择、多选、滚动和趋势图状态不发生回归。
- [x] 实现通过完整验证和对抗式审查后，工作文档完成勾选并归档。

---

## 2. 第一性原理

### 2.1 用户操作的本质

右键菜单不是“应用专属菜单”，它表达的是对一个可分类目标执行两个语义操作：

1. 修改用户可见名称。
2. 修改用户分配的分类。

应用和网页的差异不在用户意图，而在目标身份和持久化协议。因此共享层应围绕“可分类目标”建模，而不是围绕某个页面或某种图标建模。

### 2.2 身份必须先于展示

展示名称不能承担写入身份：

- 两个应用可能显示相同名称，但拥有不同 `exeName`。
- 一个网页可能被用户重命名，但写入身份仍应是标准化域名。
- 原始 `domain` 可能存在大小写、前后空白或历史格式差异；保存必须使用 `normalizedDomain`。

因此任何快捷写入请求都必须携带显式、带类型且经过规范化的身份。不得从 `displayName`、secondary text、详情 `identityKeys` 或 DOM 文本反推写入 key。

### 2.3 共用 UI 不等于合并数据模型

Classification 当前已经证明两类对象可以共用管理页面和分类定义，同时保持两套 override：

- 应用：`Record<exeName, AppOverride>`。
- 网页：`Record<normalizedDomain, WebDomainOverride>`。

本任务不把二者强行合并成一张通用数据表，也不让网页伪装成应用。正确边界是：

- UI 生命周期共用。
- 分类目录共用。
- patch 意图共用。
- 目标身份、override 类型、字段保留规则和持久化适配器按 `kind` 分流。

### 2.4 一个视觉行为只能有一个 owner

菜单位置、点击后打开分类子菜单、滚轮行为、外部关闭、Dialog、文案、Badge 和 Quiet Pro 样式必须继续由 Classification feature 统一拥有。History、Data 和 Dashboard 不得各自复制 JSX、CSS、异步加载或保存逻辑。

### 2.5 保存是事务边界，不是页面事件

页面上的 `onContextMenu` 只负责发出打开请求。真正保存必须经过 Classification feature 的 typed service 边界，并在成功后统一更新：

- 持久化设置；
- bootstrap cache；
- 当前读模型使用的 mapping/version 信号；
- 受影响页面缓存或快照。

失败时不能先更新页面再假装成功，也不能关闭界面并丢失用户输入。

### 2.6 完成意味着行为闭环

“网页能弹出菜单”不足以证明任务完成。完整闭环至少包括：

- 正确目标；
- 正确字段保留；
- 正确持久化；
- 当前页面即时一致；
- 跨页面再次读取一致；
- 旧行为无回归；
- 自动化验证和反例攻击均通过。

---

## 3. 当前实现事实

### 3.1 已有可复用能力

- [x] `QuickAppClassificationSurface` 已拥有根菜单、点击后分类子菜单、改名 Dialog、滚动与外部关闭规则。
- [x] `QuickAppClassificationEntry` 已负责懒加载和 rejected Promise 重试。
- [x] `useQuickAppClassificationLauncher` 已负责打开请求、锚点和关闭后的焦点恢复。
- [x] `QuickAppClassificationStatus` 已提供 `dense` / `standard` 两档未分类 Badge。
- [x] `buildQuickAppCategoryOptions` 已从应用 override、网页 override 和分类定义中构建统一分类目录。
- [x] Classification 的完整页面保存已经同时处理 `AppOverride` 与 `WebDomainOverride`。
- [x] History 和 Data 的网页读模型已经携带 `normalizedDomain`、显示名称、有效分类和 favicon。
- [x] 网页详情已使用 `normalizedDomain` 作为详情查询身份。

### 3.2 当前阻塞点

- [x] 快捷目标只有 `{ exeName, displayName, category }`，没有 `kind`。
- [x] Surface 直接调用 `ProcessMapper.getUserOverride`，因此只能读取应用 override。
- [x] Surface 直接调用 `ClassificationService.saveAppOverride`，因此只能保存应用。
- [x] `ClassificationService` 没有供快捷操作使用的单条网页 override 保存入口。
- [x] `classificationStore` 只有批量变更计划能写网页 override，单条 mutation builder 仍是私有函数。
- [x] 页面和测试通过 `target.exeName` 判断当前打开目标，无法表达网页目标。
- [x] 组件和 CSS 名称均带 `QuickApp`，继续直接扩展会让 owner 名称与真实职责不一致。

---

## 4. 范围

### 4.1 本次必须包含

- [x] 把快捷目标改成应用/网页判别联合类型。
- [x] 建立按目标种类分流的 override 读取、patch 构建和保存边界。
- [x] 将现有应用专属组件重命名为中性的快捷分类组件，并保持单一实现。
- [x] History 网页模式中，所有当前可双击打开网页详情的图标接入右键快捷入口。
- [x] Data 网页模式左侧列表的详情图标接入右键快捷入口。
- [x] Data 网页模式顶部当前选择图标接入右键快捷入口。
- [x] 网页未分类状态在存在可见名称的紧凑列表中使用共享 Badge。
- [x] Badge 尺寸根据已有语义密度适配名称行，不允许页面传任意像素。
- [x] 保存后的本地状态、bootstrap cache 和页面刷新链路一致。
- [x] 更新中英文文案中语义上仍写死“应用”的通用快捷操作文本。
- [x] 补齐纯逻辑、静态契约、真实浏览器和回归测试。

### 4.2 明确不包含

- [x] 不重做 Classification 页面布局或卡片。
- [x] 不合并 `AppOverride` 与 `WebDomainOverride` 数据结构。
- [x] 不改变设置表 key 前缀或迁移历史数据。
- [x] 不改变网页采集、URL/标题记录、域名标准化或浏览器扩展协议。
- [x] 不给非详情入口的装饰性 favicon、时间轴色点或图例增加右键行为。
- [x] 不给 Dashboard 虚构网页排行；当前 Dashboard 没有网页目标时保持不变。
- [x] 不把完整 Classification 管理能力塞进快捷菜单；排除统计、颜色、标题记录等仍留在 Classification。
- [x] 不增加原生 tooltip、图标、小箭头、三个点或新的页面专属说明文案。
- [x] 不在此计划中自动创建分支、提交、push、发布或修改远端 Project。

### 4.3 接入判定规则

一个图标只有同时满足以下条件才接入：

- [x] 它代表唯一的应用或网页目标。
- [x] 它当前已经是详情入口，或与现有详情入口是同一个可交互图标。
- [x] 页面读模型能直接提供 `exeName` 或 `normalizedDomain`。
- [x] 右键不会改变原有单击、双击、选择或滚动语义。

---

## 5. 目标架构

### 5.1 判别联合目标

目标协议应表达真实身份，而不是给可选字段打补丁：

```ts
type QuickClassificationTarget =
  | {
      kind: "app";
      exeName: string;
      displayName: string;
      category: AppCategory;
    }
  | {
      kind: "web";
      normalizedDomain: string;
      displayName: string;
      category: AppCategory;
    };
```

约束：

- [x] `app` 分支只能包含 `exeName`。
- [x] `web` 分支只能包含 `normalizedDomain`。
- [x] 两个构造器分别验证和规范化身份。
- [x] `displayName` 为空时回退到各自身份，不影响写入 key。
- [x] 目标必须提供当前有效分类，菜单文案和选中态不额外猜测。
- [x] 提供稳定 `targetKey` 辅助函数，格式显式包含 kind，例如 `app:<exe>` 与 `web:<domain>`。

### 5.2 共享 patch，分开的 builder

用户意图可以统一表示为：

```ts
interface QuickClassificationPatch {
  category?: UserAssignableAppCategory | null;
  displayName?: string | null;
}
```

但字段保留必须由两类 builder 分别负责：

- [x] 应用 builder 保留 `color`、`track`、`captureTitle` 和有效的其他应用字段。
- [x] 网页 builder 保留 `color`、`enabled`、`captureTitle` 和有效的其他网页字段。
- [x] 设置分类不删除名称或控制字段。
- [x] 改名不删除分类或控制字段。
- [x] 清空名称只恢复默认名称，不清除分类。
- [x] 选择“未分类/其他”只清除分类字段，不清除名称或控制字段。
- [x] 没有任何有效字段时才返回 `null`，由存储层删除对应 setting。

### 5.3 typed adapter 边界

Surface 不应自行访问 `ProcessMapper` 或网页 store。Classification feature 提供以下语义能力：

- [x] `getQuickClassificationOverride(target)`：按 kind 返回当前 override 快照。
- [x] `buildQuickClassificationOverride(target, current, patch)`：按 kind 调用正确 builder。
- [x] `saveQuickClassificationOverride(target, override)`：按 kind 调用正确 service。
- [x] `isQuickClassificationUnclassified(category/deletedCategories)`：使用同一规则判断 Badge 和菜单文案。

如果 TypeScript 难以安全表达异构返回类型，应使用按 kind 明确分支的内部函数或 adapter map；不得用 `any`、宽泛断言或把两个 override 强行交叉合并。

### 5.4 网页单条保存链路

需要新增与 `saveAppOverride` 对称的网页保存能力：

- [x] `classificationStore.saveWebDomainOverride(normalizedDomain, override)` 复用现有 normalization 和 mutation builder。
- [x] 空或非法域名明确拒绝或无副作用返回，行为由测试固定。
- [x] `ClassificationService.saveWebDomainOverride` 更新持久化后同步 bootstrap cache。
- [x] cache 中只更新目标域名，不覆盖其他网页 override。
- [x] 保存失败不修改 cache。
- [x] 保存成功触发统一 classification/mapping 更新通知。
- [x] Classification 完整页面的批量保存继续复用同一 mutation 规则，避免单条和批量规范化漂移。

### 5.5 单一 UI owner

目标组件命名应反映通用职责：

- [x] `QuickAppClassificationSurface` → `QuickClassificationSurface`。
- [x] `QuickAppClassificationEntry` → `QuickClassificationEntry`。
- [x] `useQuickAppClassificationLauncher` → `useQuickClassificationLauncher`。
- [x] `QuickAppClassificationStatus` → `QuickClassificationStatus`。
- [x] `quickAppClassification.ts` → 中性 quick classification service 文件。
- [x] CSS 类从 `.quick-app-*` 迁移为 `.quick-classification-*`，旧类完全删除或只保留有明确期限的薄兼容层。
- [x] 页面不得保留旧组件副本。
- [x] lazy chunk 仍只有一份 Surface。

重命名应在测试保护下机械完成，不与页面行为变化混成不可审查的大步提交。

### 5.6 刷新与一致性

- [x] 应用保存继续更新 `ProcessMapper` 与 app bootstrap cache。
- [x] 网页保存更新 web bootstrap cache，不写入 `ProcessMapper`。
- [x] 两种保存都通过同一个上层 `onClassificationChanged`/现有等价通知刷新 `mappingVersion`。
- [x] History web read model 重新读取目标域名的名称和分类。
- [x] Data web trend read model 重新读取目标域名的名称和分类。
- [x] Classification 后续打开时读取到相同结果。
- [x] 快速连续保存时，旧请求不得覆盖新目标的结果。

---

## 6. 页面行为矩阵

| 页面/模式 | 目标入口 | 双击详情 | 右键快捷操作 | 未分类 Badge | 备注 |
| --- | --- | --- | --- | --- | --- |
| Dashboard / 应用 | 排行应用图标 | 保持 | 保持 | 保持 | 用于证明应用分支无回归 |
| Dashboard / 网页 | 当前不存在 | 不适用 | 不新增 | 不新增 | 不制造虚假页面能力 |
| History / 应用 | 当日分布应用图标 | 保持 | 保持 | 保持 | 现有路径回归 |
| History / 网页 | 当日分布网页图标 | 保持网页详情 | 新增 | 新增，使用紧凑密度 | 本任务主要入口 |
| History / 分类 | 分类色点 | 保持现状 | 不新增 | 不适用 | 不存在唯一应用/域名身份 |
| Data / 应用 | 左侧列表图标 | 保持 | 保持 | 保持 | 选择状态不得变化 |
| Data / 应用 | 顶部已选图标 | 保持 | 保持 | 由名称行承担 | 现有路径回归 |
| Data / 网页 | 左侧列表图标 | 保持网页详情 | 新增 | 新增，按名称行密度 | 不改变行选择 |
| Data / 网页 | 顶部已选图标 | 保持网页详情 | 新增 | 由对应名称行承担 | 不增加图标叠层 Badge |

所有新增右键入口共同满足：

- [x] 右键只命中图标交互区域。
- [x] 根菜单第一帧直接显示最终文案，不出现旧目标或加载占位闪烁。
- [x] 根菜单只有“更改名称”和“设置分类/更改分类”。
- [x] 已分类目标显示“更改分类”，未分类目标显示“设置分类”。
- [x] 悬停分类项只显示 hover；点击后才出现分类子菜单。
- [x] 子菜单可使用鼠标滚轮滚动且不会消失。
- [x] 外部页面滚动、外部点击、窗口 resize 和失焦沿用现有关闭契约。
- [x] 菜单和 Dialog 不使用原生 `title`。
- [x] 根菜单无图标、无小箭头、无三个点；分类当前项保留状态勾选。
- [x] 改名 Dialog 不显示已删除的说明句。

---

## 7. 分阶段执行清单

## 阶段 A：冻结基线与盘点入口

目标：先证明当前行为，再修改抽象。

- [x] 记录 `git status --short`，确认无意外工作区改动。
- [x] 运行 `npm run check:types`。
- [x] 运行 `npm run check:lint`。
- [x] 运行 `npm test`。
- [x] 运行 `npm run test:replay`。
- [x] 运行 `npm run test:ui-smoke`。
- [x] 运行 `npm run test:ui-browser-smoke`。
- [x] 记录当前真实浏览器场景数量和任何既有失败。
- [x] 列出 Dashboard、History、Data 全部详情图标入口。
- [x] 标记每个入口的目标 kind、身份字段、名称字段、分类字段和密度。
- [x] 确认 History 网页图标直接拥有 `normalizedDomain`。
- [x] 确认 Data 左侧和顶部网页 option 直接拥有 `normalizedDomain`。
- [x] 确认 Dashboard 当前没有网页排行目标。

退出条件：

- [x] 当前基线通过，或既有失败已被记录且能与本任务隔离。
- [x] 所有计划接入点都有显式网页身份，不需要从展示文本猜测。

## 阶段 B：先写目标协议与纯逻辑测试

目标：在改 UI 前锁定身份边界。

- [x] 将目标改为 `kind: "app" | "web"` 判别联合。
- [x] 分别建立应用目标和网页目标构造器。
- [x] 为 executable trim、空值拒绝和显示名回退写测试。
- [x] 为 normalized domain trim/标准化、空值拒绝和显示名回退写测试。
- [x] 为稳定 `targetKey` 写应用/网页不碰撞测试。
- [x] 证明网页目标不能携带 `exeName`。
- [x] 证明应用目标不能携带 `normalizedDomain`。
- [x] 证明详情 `identityKeys` 不参与快捷写入。
- [x] 为应用 builder 的字段保留写测试。
- [x] 为网页 builder 的字段保留写测试。
- [x] 为清空名称、清空分类和最后一个有效字段被清除写测试。
- [x] 为已删除分类和 `other` 的未分类判断写测试。

退出条件：

- [x] 类型层无法构造身份含混的快捷目标。
- [x] 两类 override patch 行为均由纯逻辑测试锁定。

## 阶段 C：建立网页单条持久化边界

目标：先让网页拥有与应用对称、可独立验证的保存能力。

- [x] 将现有网页 override normalization 提炼为单条和批量共用规则。
- [x] 新增 store 单条保存方法并复用 setting mutation builder。
- [x] 测试新增网页 override。
- [x] 测试更新网页 override。
- [x] 测试传入 `null` 删除网页 override setting。
- [x] 测试非法/空域名不产生错误 key。
- [x] 测试保存保留 `enabled`、`captureTitle`、`color` 和未修改字段。
- [x] 新增 ClassificationService 网页保存方法。
- [x] 测试成功后只更新对应 bootstrap cache 项。
- [x] 测试删除后只移除对应 cache 项。
- [x] 测试失败时 cache 不提前变化。
- [x] 确认不向 `ProcessMapper` 写入网页 override。

退出条件：

- [x] 不经过任何页面组件即可独立保存并重新加载网页名称和分类。

## 阶段 D：将快捷操作 owner 泛化

目标：让已有 UI 真正服务两类目标，而不是添加第二套 UI。

- [x] 按目标架构重命名组件、hook、service 和 CSS 类。
- [x] 更新 lazy Entry 的模块缓存和 rejected Promise 恢复测试。
- [x] launcher 使用中性 open request 和 target key。
- [x] Surface 不再直接 import `ProcessMapper`。
- [x] Surface 打开时通过 typed adapter 读取当前 override。
- [x] Surface 保存时通过 typed adapter 分派应用或网页。
- [x] Surface 的菜单文案只依赖有效分类，不依赖目标种类。
- [x] 改名初值使用用户 override 名称，否则使用目标显示名称。
- [x] “恢复默认名称”对应用和网页使用相同呈现、不同底层 key。
- [x] `onSaved` 返回带 kind 的结果或只发出无歧义的 change event，页面不接收错误 override 类型。
- [x] 更新 Entry key、active target 判断和 focus restore，使应用/网页 key 不碰撞。
- [x] 搜索并删除所有页面对旧 `QuickApp*` owner 的引用。

退出条件：

- [x] Classification feature 内只有一个快捷菜单 Surface、一个 lazy Entry 和一个 launcher。
- [x] Surface 中不存在按页面分支，也不存在复制的应用/网页 JSX。

## 阶段 E：泛化未分类 Badge

目标：用一个组件适配不同页面的名称尺寸。

- [x] 将状态组件改为中性名称。
- [x] 继续只接受 `dense` / `standard` 等语义密度，不接受像素高度。
- [x] Dashboard 应用名称行保持当前 `standard`。
- [x] History 应用和网页紧凑名称行使用 `dense`。
- [x] Data 根据当前实际 computed 名称尺寸选择既有语义档位。
- [x] 网页是否未分类由当前有效分类决定，不因存在 name-only override 而隐藏 Badge。
- [x] 已分类、分类被删除、选择 `other`、只有别名四种状态有测试。
- [x] Badge 继续使用普通 neutral 规范，字色、字号、字重和高度由 QuietBadge token 决定。
- [x] 名称过长时优先截断名称，Badge 和时长列不被压缩消失。

退出条件：

- [x] 应用和网页 Badge 只有一个 owner。
- [x] 不同名称字号下 Badge 都与名称处于同一视觉行。

## 阶段 F：接入 History 网页目标

目标：让网页模式获得快捷管理，同时保持详情和三种模式隔离。

- [x] History 上层按分布项 kind 构造应用或网页目标。
- [x] 网页目标使用读模型中的 `normalizedDomain`，不使用 label/domain 文本作为 key。
- [x] 网页图标右键打开共享菜单。
- [x] 网页图标双击继续打开网页详情。
- [x] 应用模式的现有右键和详情行为不变。
- [x] 分类模式不构造伪目标、不出现快捷菜单。
- [x] 网页名称旁显示共享未分类 Badge。
- [x] 保存网页别名后当前分布名称和详情标题一致。
- [x] 保存网页分类后分布、分类统计和颜色读取一致。
- [x] 切换应用/分类/网页模式时关闭过期菜单请求。
- [x] 菜单打开期间日期变化不会把保存应用到错误域名。

退出条件：

- [x] History 三种模式的目标、详情、菜单和 Badge 行为矩阵通过。

## 阶段 G：接入 Data 网页左侧列表

目标：不破坏 Data 整行选择语义地接入网页图标。

- [x] Data web option 显式提供快捷目标所需 category 和 normalizedDomain。
- [x] 仅网页详情图标命中时打开菜单。
- [x] 右键不改变单选结果。
- [x] 右键不改变 Ctrl 多选结果。
- [x] 右键不改变趋势图 series。
- [x] 右键不改变列表 scrollTop。
- [x] 右键不触发详情 prepare/open。
- [x] 双击网页图标继续打开网页详情。
- [x] 双击名称、时长或空白区域不误开菜单。
- [x] 网页名称旁显示共享 Badge。
- [x] 保存名称后列表和趋势标题即时更新。
- [x] 保存分类后未分类 Badge、分类统计和颜色即时更新。

退出条件：

- [x] Data 网页选择、详情和快捷操作三条链路互不污染。

## 阶段 H：接入 Data 顶部网页图标

目标：让 Data 的第二个网页详情入口复用同一目标和 launcher。

- [x] 顶部当前网页图标右键打开共享菜单。
- [x] 顶部图标使用与左侧 option 相同的 normalizedDomain。
- [x] 顶部图标双击继续打开网页详情。
- [x] 关闭菜单后焦点回到原图标。
- [x] 保存后顶部名称、accessible name 和左侧列表名称同步。
- [x] 不在纯图标上叠加额外 Badge。
- [x] 不增加页面专属菜单实例或 CSS。
- [x] 从网页切回应用时不会复用旧网页请求。

退出条件：

- [x] Data 应用/网页、左侧/顶部四类入口共用同一个 launcher 和 Entry owner。

## 阶段 I：统一刷新、失败与竞态处理

目标：保证成功一致、失败可恢复、异步不串目标。

- [x] 网页分类成功只触发一次全局更新入口。
- [x] 网页改名成功只触发一次全局更新入口。
- [x] Dashboard 应用现有刷新链路不回归。
- [x] History、Data、Classification 后续读取相同网页 override。
- [x] 当前页面无需离开再回来即可看到结果。
- [x] 保存失败时菜单或 Dialog 保留可恢复状态。
- [x] 保存失败不显示成功 Toast、不更新本地快照。
- [x] 分类目录加载失败显示明确失败状态，不误显示可用“设置分类”。
- [x] 快速从域名 A 切换到域名 B，A 的旧异步结果不能覆盖 B。
- [x] 保存过程中关闭或切页，不会把回调写入已经变化的目标。
- [x] 连续选择分类时防止重复提交。

退出条件：

- [x] 成功、失败、重试和跨目标竞态均有自动化证据。

## 阶段 J：Quiet Pro 与本地化验收

目标：扩展目标，不放大界面噪声。

- [x] 根菜单宽度、内边距、字号、边框、圆角和阴影继续使用现有 token。
- [x] 网页和应用打开的菜单 computed style 一致。
- [x] 根菜单没有目标类型图标或额外标题。
- [x] 分类子菜单仍在点击后才出现。
- [x] 子菜单高度受 viewport 限制并使用现有 custom scrollbar。
- [x] Badge 使用普通 neutral 样式，不使用 warning、danger 或红色提醒。
- [x] 中文和英文的“更改名称”“设置分类”“更改分类”“未分类”含义适用于应用与网页。
- [x] aria label 不再把通用菜单错误称为“应用菜单”。
- [x] 所有文案 key 的中英文 parity 通过。
- [x] 浅色、深色和动态外观下边界清晰。
- [x] reduced motion 下不依赖动画理解状态。
- [x] 默认窗口、窄窗口和 125%–200% 缩放下菜单不越界。

退出条件：

- [x] 新增网页能力看起来与现有应用能力完全同源，没有页面特制感。

## 阶段 K：完整自动化验证

- [x] `npm run check:types`
- [x] `npm run check:lint`
- [x] `npm run check:architecture`
- [x] `npm run check:quiet-pro-style-debt`
- [x] `npm run check:hotspots`
- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run build`
- [x] `npm run check:bundle`
- [x] `git diff --check`
- [x] 检查中文 `.ts/.tsx/.md` 内容仍为可读 UTF-8。
- [x] 检查快捷分类 lazy chunk 只存在一份，没有应用/网页各生成一份 Surface。
- [x] 检查没有通过删除真实加载、放宽断言或跳过场景伪造通过。

退出条件：

- [x] 仓库默认最低验证门 `npm test`、`npm run test:replay` 和 `npm run build` 全部通过。
- [x] 受影响前端专项检查和真实浏览器场景全部通过。

## 阶段 L：对抗式审查

目标：主动寻找能够推翻“任务已完成”的反例。

### L.1 架构攻击

- [x] 搜索 Dashboard、History、Data 是否复制菜单 JSX。
- [x] 搜索页面是否直接调用 ClassificationService 或 persistence store。
- [x] 搜索页面是否新增 `.quick-*menu` 私有样式。
- [x] 检查 launcher 是否反向依赖 History 或 Data。
- [x] 检查通用 Surface 是否出现页面名称判断。
- [x] 检查是否把网页 override 塞入 ProcessMapper。
- [x] 检查是否引入 `any` 或宽泛类型断言掩盖联合类型问题。

### L.2 身份攻击

- [x] executable 大小写不同、带空白或 canonical alias。
- [x] normalizedDomain 大小写不同、带空白或格式异常。
- [x] 网页显示名称与另一个域名相同。
- [x] 应用显示名称与网页显示名称相同。
- [x] `app:github.com` 与 `web:github.com` 的 target key 不碰撞。
- [x] Data 详情拥有多个 identityKeys 时仍只使用 normalizedDomain 写入。
- [x] 页面缺失显式身份时拒绝打开，不猜测写入。

### L.3 字段破坏攻击

- [x] 只改网页名称后 `enabled=false` 仍保留。
- [x] 只改网页分类后 `captureTitle=false` 仍保留。
- [x] 恢复默认名称后分类和颜色仍保留。
- [x] 清除分类后别名和排除状态仍保留。
- [x] 应用原有 `track=false` 和 `captureTitle=false` 仍保留。

### L.4 事件攻击

- [x] 在 Data 网页图标上分别执行单击、双击、右键、Ctrl+单击和拖动。
- [x] 右键后立刻滚动菜单和分类子菜单。
- [x] 拖动子菜单滚动条后释放。
- [x] 右键后立刻双击同一图标。
- [x] 菜单打开时切换 History 模式或 Data 应用/网页 tab。
- [x] 菜单打开时改变日期、范围和窗口尺寸。
- [x] 在 viewport 四角打开菜单。

### L.5 保存竞态攻击

- [x] 域名 A 保存返回前打开域名 B。
- [x] 连续快速选择两个分类。
- [x] 分类保存过程中打开改名。
- [x] 保存返回前切换页面。
- [x] 模拟持久化失败后重试。
- [x] 模拟 bootstrap 首次加载失败后再次打开。
- [x] 证明旧请求不能覆盖新目标。

### L.6 视觉攻击

- [x] 最长中英文名称不会覆盖 Badge 或时长。
- [x] History dense Badge 不高于名称行。
- [x] Data 名称行与 Badge 垂直对齐。
- [x] 125%、150%、175%、200% 缩放下菜单和 Dialog 可用。
- [x] 浅色、深色、动态外观下菜单层级一致。
- [x] 快速右键不同目标不闪现旧名称、旧分类或加载文案。

### L.7 审查结论

- [x] 所有发现按 blocker / high / medium / low 分类。
- [x] blocker 和 high 必须修复并重跑相关矩阵。
- [x] medium 若延期，必须记录 owner、影响和后续处理，不得静默忽略。
- [x] 修复审查发现后再次运行受影响测试和 `git diff --check`。
- [x] 最终记录 `blocker`、`high` 和未延期 `medium` 的数量。

退出条件：

- [x] `blocker = 0`、`high = 0`，且没有未记录的 medium。

## 阶段 M：完成、归档与 Project 协作

- [x] 在本文逐项按真实证据勾选，不提前批量勾选。
- [x] 填写完成日期、主要实现文件、测试命令和实现偏差。
- [x] 更新需要长期保留的架构或 UI 文档；若长期规则未变化则不制造重复文档。
- [x] 将本文从 `docs/working/` 移至 `docs/archive/`。
- [x] 归档后确认 top-level `docs/` 没有遗留一次性方案。
- [x] 报告维护者将 Project 事项从 `In progress` 拖到 `Done`。
- [x] 重新读取 live Project 并按路线图规则报告 Next 窗口所需的全部拖动。
- [x] 明确本地勾选、测试、commit 或归档均不替代 live Project 状态。

退出条件：

- [x] 代码、验证、审查、文档归档和协作报告全部闭环。

---

## 8. 测试设计

### 8.1 纯逻辑测试

- [x] 应用/网页目标构造与规范化。
- [x] target key 的 kind 隔离。
- [x] 两类 override patch 的字段保留。
- [x] 分类与名称分别修改、清除和恢复。
- [x] 未分类判断的无 override、name-only、`other`、已删除分类场景。
- [x] 网页单条 store mutation 的新增、更新、删除和非法 key。
- [x] bootstrap cache 的成功更新和失败不变。

### 8.2 静态契约测试

- [x] 通用 Surface 只定义一次。
- [x] Dashboard、History、Data 不包含菜单 JSX。
- [x] 页面不直接 import classification store/service。
- [x] 页面不定义快捷菜单或 Badge 私有视觉。
- [x] 通用组件和 hook 不再以 `QuickApp` 命名。
- [x] target 联合类型不包含可同时存在的 optional `exeName`/`normalizedDomain`。
- [x] 所有快捷入口没有 `title` 属性。
- [x] 根菜单无装饰 SVG、箭头和省略号。

### 8.3 真实浏览器测试

每个应用和网页入口至少验证：

- [x] 第一帧直接显示最终根菜单。
- [x] 当前分类决定“设置分类/更改分类”。
- [x] 点击后才打开分类子菜单。
- [x] 当前分类带勾选状态。
- [x] 子菜单滚轮滚动保持打开。
- [x] 外部点击和页面滚动按契约关闭。
- [x] Escape 逐层关闭。
- [x] 菜单不越出 viewport。
- [x] 改名保存和恢复默认名称。
- [x] 分类设置、更改与清除。
- [x] 保存期间不能重复提交。
- [x] 关闭后返回正确触发图标。

### 8.4 Data 专项回归

- [x] 左侧网页图标右键前后选中 key 完全相同。
- [x] 顶部网页图标右键前后选中 key 完全相同。
- [x] Ctrl 多选后右键其中一个域名不会丢失其他选择。
- [x] 右键不会触发 detail prepare/open。
- [x] 双击仍能使用 prepared detail。
- [x] 菜单关闭前后 scrollTop 相同。
- [x] 详情关闭后的选择快照恢复正常。
- [x] 应用与网页 tab 切换不复用错误 target。

---

## 9. 预计文件边界

以下是预期 owner，不代表执行时必须机械修改每个文件；实际改动应以最小充分范围为准。

### Classification owner

- `src/features/classification/types.ts`
- `src/features/classification/services/quickAppClassification.ts`（计划重命名）
- `src/features/classification/services/classificationStore.ts`
- `src/features/classification/services/classificationService.ts`
- `src/features/classification/components/QuickAppClassificationSurface.tsx`（计划重命名）
- `src/features/classification/components/QuickAppClassificationEntry.tsx`（计划重命名）
- `src/features/classification/components/QuickAppClassificationStatus.tsx`（计划重命名）
- `src/features/classification/hooks/useQuickAppClassificationLauncher.ts`（计划重命名）

### 页面适配

- `src/features/history/components/HistoryDayDistributionQuickActions.tsx`
- `src/features/history/components/HistoryDayDistributionPanel.tsx`
- `src/features/history/components/History.tsx`
- `src/features/data/components/Data.tsx`
- `src/features/data/components/DataAppTrendPanel.tsx`
- Dashboard 文件仅做通用组件重命名和应用回归，不新增网页 UI。

### 读模型与类型（只在缺少显式字段时修改）

- `src/features/history/services/historyWebActivityViewModel.ts`
- `src/features/data/services/dataReadModel.ts`
- `src/features/data/services/dataWebActivityReadModel.ts` 或当前实际网页趋势 owner
- `src/shared/types/webActivity.ts` 只承载稳定共享数据类型，不放页面状态。

### 测试与样式

- `tests/classificationDraftState.test.ts` 或新增聚焦 quick classification 测试文件
- `tests/historyWebActivityViewModel.test.ts`
- `tests/dataWebActivityReadModel.test.ts`
- `tests/uiSmoke.test.ts`
- `tests/uiBrowserSmoke/historyScenarios.ts`
- `tests/uiBrowserSmoke/dataScenarios.ts`
- 当前拥有 `.quick-app-*` 样式的全局 Quiet Pro 样式文件
- `scripts/check-bundle-budget.ts`

边界约束：

- [x] 不新增 `src/lib/` 或 `src/types/` 根层。
- [x] 不把快捷分类业务状态塞入 `app/*`。
- [x] 不把页面私有逻辑塞入 `shared/*`。
- [x] 不创建无 owner 的通用 `utils`。
- [x] Tauri/Rust 层不应因本任务发生变化。

---

## 10. 风险与回退策略

### 风险一：泛化时破坏现有应用菜单

- 预防：先写判别联合和 adapter 测试，再迁移 Surface。
- 回退：保留同一 Surface 的 app adapter，不恢复页面私有实现。

### 风险二：网页保存丢失排除或标题设置

- 预防：网页 builder 必须以当前完整 override 为输入，并有字段保留测试。
- 回退：停止接 UI，先修复 typed save boundary；不得用页面合并对象临时补丁。

### 风险三：Data 右键改变选择

- 预防：只在详情图标阻止默认 context menu，并保持行事件链不变。
- 回退：移除该入口接线，保留共享能力，直到事件隔离测试通过。

### 风险四：刷新链路只更新当前页面

- 预防：保存成功走统一 mapping/classification version，不维护页面私有永久副本。
- 回退：保留持久化结果，修复统一失效边界；不得要求用户离开页面手动刷新。

### 风险五：大规模重命名掩盖行为差异

- 预防：重命名与行为变更分阶段，使用静态契约和 diff 审查。
- 回退：若中性重命名造成无关风险，可短期保留文件名，但必须保证只有一个 Surface，并在完成记录中说明偏差与后续 owner。

---

## 11. 完成定义

只有同时满足以下条件，任务才能宣布完成：

- [x] History 和 Data 中所有符合接入规则的网页详情图标均可右键操作。
- [x] 应用和网页共享一个目标协议、launcher、Entry、Surface、Dialog、分类子菜单和 Badge owner。
- [x] 应用写入只使用 exeName，网页写入只使用 normalizedDomain。
- [x] 两类保存都保留未修改的 override 字段。
- [x] 保存后当前页面和后续打开页面立即一致。
- [x] Dashboard 应用路径、History 三模式和 Data 选择/详情均无回归。
- [x] 无原生 tooltip、加载闪烁、悬停自动开子菜单、菜单滚轮消失或页面私有 UI。
- [x] Badge 的字号、字重、字色和高度符合 QuietBadge 现有规范，并适配页面名称尺寸。
- [x] 默认验证门、专项测试、真实浏览器矩阵和 bundle 检查全部通过。
- [x] 对抗式审查完成，blocker/high 清零且 medium 有明确处置。
- [x] 本文按证据勾选、填写完成记录并移入 `docs/archive/`。
- [x] live Project 的实际状态差异和维护者所需拖动已明确报告。

---

## 12. Project 协作与 Git 边界

### 12.1 开始执行时

2026-08-08 live Board 显示原事项已在 `Done`。由于本任务补齐的是原验收结果中遗漏的网页分支，开始实际编码时已向维护者报告以下建议；维护者没有执行临时状态拖动，因此 live 状态在实施期间继续保持 `Done`：

- [x] 已报告可将 `在 Dashboard 和 History 快捷设置分类与别名` 从 `Done` 临时拖回 `In progress`；live Board 未执行该拖动。
- [x] 不新建第二个重复事项，除非维护者明确决定把发布后缺口拆成独立 item。
- [x] 若同一时刻只允许一个 `In progress`，先按路线图规则处理当前 `规范化前端与原生多语言文案系统` 的真实状态，再开始本任务。
- [x] 状态拖动由维护者在 Board 视图手动完成，Codex 不代为修改。

当前 Board 同时显示：

- `In progress`：1 项。
- `Next`：2 项。
- `Queued`：2 项。

开始、完成、阻塞或解除阻塞时均需重新读取 live Project，并一次性报告 Next 窗口所需调整；本计划不提前假定届时项目状态仍与 2026-08-08 相同。

### 12.2 Git 边界

- [x] 本计划的创建不授权提交或 push。
- [x] 后续若用户要求“全部推到仓库”，按仓库规则包含全部当前改动并拆成可审查提交。
- [x] 提交前检查 `git diff --cached --stat` 和 `git diff --cached --numstat`。
- [x] 相关 commit subject 保持简洁，Issue 引用使用独立 body 段落。
- [x] 不使用 `Closes`、`Fixes` 或 `Resolves`，除非用户明确要求关闭 Issue。
- [x] tag、Release 和远端 Issue/Project 修改需要各自明确授权。

---

## 13. 执行完成记录

以下记录对应 2026-08-08 完成态：

- 完成日期：2026-08-08。
- 实际共享 owner：`QuickClassificationEntry`、`QuickClassificationSurface`、`useQuickClassificationLauncher`、`QuickClassificationStatus` 与 `quickClassification.ts`；应用和网页共用同一个懒加载 Surface，CSS owner 已统一为 `.quick-classification-*`。
- History 接入结果：应用与网页分布图标均由同一目标协议打开快捷菜单；网页使用 `normalizedDomain` 写入，右键不触发详情，双击详情保持原行为；网页改名保存、恢复默认名称与未分类 Badge 已由真实浏览器回归验证。
- Data 接入结果：应用/网页左侧详情图标和顶部已选图标均复用同一入口；网页 option 明确携带 `normalizedDomain`、有效分类与未分类状态；右键前后选中 key、滚动与详情状态不变。
- 持久化与刷新结果：新增单条网页 override mutation 与 service cache 更新；保存保留 `enabled=false`、`captureTitle=false`、颜色和未修改字段，只更新目标域名的 bootstrap cache；页面继续通过统一 `mappingVersion` 刷新。
- Quiet Pro 验收结果：菜单、Dialog 与 Badge 继续复用现有 token 和共享组件；无原生 tooltip、菜单图标、小箭头或三个点；分类子菜单仅点击后出现并可滚轮滚动；Badge 继续使用 neutral 语义密度。
- 自动化验证命令与结果：`npm run check:types`、`npm run check:lint`、`npm run check:i18n`、`npm run check:architecture`、`npm run check:quiet-pro-style-debt`、`npm run check:hotspots`、`npm test`、`npm run test:replay`、`npm run test:classification`、`npm run test:data`、`npm run test:history-timeline`、`npm run test:ui-smoke`、`npm run test:ui-browser-smoke`、`npm run build`、`npm run check:bundle` 与 `git diff --check` 全部通过；真实浏览器场景共 78 项；生产包只有一个 `QuickClassificationSurface` lazy chunk，bundle gate 计为 gzip 2.96 KiB。
- 对抗式审查发现与修复：共发现 3 个 medium，分别为 Data web 运行时 adapter 漏传网页快捷字段、CSS owner 仍使用 `.quick-app-*`、已删除分类仍可能显示“更改分类”；全部修复并重跑相关矩阵。最终 `blocker=0`、`high=0`、未延期 `medium=0`。
- 经确认的实现偏差：没有新增页面私有 UI、Rust/Tauri 变更或数据迁移；对话框通用文案从“更改应用名称/应用名称”收口为“更改名称/名称”；本任务未创建 commit、push、tag、Release 或远端 Project 变更。
- live Project 最终状态与维护者拖动建议：只读复核显示对应事项仍为 `Done`，无需再拖动；现有 `In progress` 为“规范化前端与原生多语言文案系统”，现有 `Next` 为“让系统托盘图标适配明暗主题并区分追踪状态”和“为发布安装包生成哈希与构建来源证明”。按手动顺序补足第三个近期窗口时，建议维护者将“复测并收口灵动视效”从 `Queued` 拖到 `Next`；本地勾选与归档不替代 live Project 状态。
