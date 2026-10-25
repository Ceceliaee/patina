# 执行单：Quiet Pro 前端尾部收口总任务
Document Type: One-off Execution Plan

## 1. 背景

当前前端主路径已经基本进入 `Quiet Pro` 基线：

- 对话框已进入共享原语
- 下拉已进入共享原语
- 颜色入口已进入共享原语
- 开关已进入共享原语
- `App Mapping` 的筛选与行内轻操作已进入共享原语
- 图表 tooltip 已进入共享原语

剩余问题不再是“大块页面风格不一致”，而是一些零散但长期会反复回流的尾部 UI：

1. `Settings` 中“数据安全”区块仍然是页面私有拼装
2. `Settings` 中危险动作按钮仍然不是共享 Quiet Pro 危险动作原语
3. `App Mapping` 中仍有少量页面私有小控件未收进系统
4. `CategoryColorControls` 中“默认 / 删除”等仍是局部按钮
5. `ToastStack` 视觉接近 Quiet Pro，但还不是明确共享 `toast` 原语

这些问题分开做当然可以，但它们属于同一类“前端 Quiet Pro 尾部收口”。  
因此本轮允许合并成一个一次性收尾任务，但必须严格限制范围，避免借机扩成新一轮整页重构。

## 2. 本轮目标

完成后应达到：

- 前端剩余高频 UI 尾巴基本全部进入 Quiet Pro 共享原语或明确语义角色
- `Settings`、`App Mapping`、`CategoryColorControls`、`ToastStack` 的零散页面私有 UI 不再作为主路径存在
- 用户可见行为保持不变
- 不开启新的视觉方向，也不顺手做大面积“美化”

## 3. 范围

重点范围仅限以下 4 类：

### 3.1 Settings 数据安全区块

涉及：

- 备份/恢复卡片
- 发布信息卡片
- 清理数据危险区块

目标：

- 将这些卡片收为更稳定的 Quiet Pro `panel / sub-panel / action-row` 语义
- 减少页面内硬拼装感

### 3.2 Settings 危险动作原语

涉及：

- 清理数据按钮
- 其他同类危险/次危险按钮（如适合同步收口）

目标：

- 建立共享 Quiet Pro 危险动作按钮或危险操作原语
- 不再让危险操作长期停留在页面私有 class 拼装

### 3.3 App Mapping / CategoryColorControls 零散尾巴

涉及：

- 应用名编辑按钮
- exe badge
- 颜色旁“默认”按钮
- 分类控制中的“默认 / 删除”按钮

目标：

- 将这批高频小控件收成共享 `chip / inline icon action / inline reset action` 一类的 Quiet Pro 小原语
- 不改页面业务逻辑

### 3.4 ToastStack

涉及：

- 成功 / 警告 / 信息 toast

目标：

- 将 `ToastStack` 升成明确共享 `QuietToast` 风格落点
- 统一边框、背景、文字、图标、阴影语义

## 4. 非目标

- 不改 Rust / Tauri
- 不改图表数据逻辑
- 不改图表布局
- 不改 `App Mapping` 保存流或切页未保存提示
- 不改颜色选择器能力
- 不改新的信息架构或页面结构
- 不重做 `Dashboard / History / Settings / App Mapping` 整页布局
- 不新增新的“设计风格试验”

## 5. 核心要求

### 5.1 原语优先

- 优先新增或扩共享 Quiet Pro 原语
- 不允许用“再补一点页面私有 class”来完成这轮任务
- 但也不要为了抽象而抽象，原语要足够小、足够明确

### 5.2 行为不变

- 本轮是 UI 系统收口，不是交互改版
- 所有按钮、卡片、toast、轻操作都应保持既有行为
- 不得顺手改变提交、删除、恢复、弹窗、导航等逻辑

### 5.3 Quiet Pro 一致性

- 中性
- 克制
- 清楚
- 长时间使用不累

禁止：

- 大阴影强化“设计感”
- 新的花哨 hover
- 过度彩色化
- 单页面专属风格处理

## 6. 建议实现方向

推荐按下面顺序执行：

1. 先定义本轮要新增或补齐的共享原语
   - 危险动作按钮 / 行内重置动作 / icon action / toast 原语
2. 在 `App.css` 中补齐对应 `qp-*` 样式角色
3. 先接入 `Settings`
4. 再接入 `App Mapping / CategoryColorControls`
5. 最后接 `ToastStack`
6. 统一复核页面内是否还残留旧的私有主路径

## 7. 执行阶段

### 阶段 A：补齐剩余共享原语

执行项：

- [x] 建立本轮所需共享原语或共享样式角色
- [x] 至少覆盖：
  - 危险动作
  - 行内 reset/icon action
  - toast 视觉原语
- [x] 在 `App.css` 中补齐对应 `qp-*` 语义样式
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 本轮目标控件已存在共享 Quiet Pro 落点
- [x] 不再依赖页面私有样式拼装作为唯一实现

### 阶段 B：接入 Settings

执行项：

- [x] 收口“数据安全”区块中的卡片与动作行
- [x] 收口危险动作按钮
- [x] 保持现有行为与布局层级不变
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] `Settings` 中数据安全区块更统一
- [x] 危险动作不再是页面私有样式主路径

### 阶段 C：接入 App Mapping / CategoryColorControls

执行项：

- [x] 收口应用名编辑按钮
- [x] 收口 exe badge
- [x] 收口颜色旁“默认”按钮
- [x] 收口分类控制中的“默认 / 删除”按钮
- [x] 阶段 C 完成后运行 `npm run build`

验收门槛：

- [x] `App Mapping` 与分类控制的零散尾巴已进入系统
- [x] 页面行为不变，视觉更一致

### 阶段 D：接入 ToastStack

执行项：

- [x] 将 toast 收口为明确共享 Quiet Pro `toast` 风格落点
- [x] 保持成功 / 警告 / 信息三种语义
- [x] 阶段 D 完成后运行 `npm run build`

验收门槛：

- [x] toast 不再只是“接近 Quiet Pro”，而是明确属于 Quiet Pro 原语体系

### 阶段 E：收尾复核

执行项：

- [x] 复核 `Settings / App Mapping / CategoryColorControls / ToastStack` 中本轮目标 UI 已不再依赖旧的页面私有主路径
- [x] 更新本执行单勾选状态
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 8. 完成定义

- [x] `Settings` 数据安全区块与危险动作已收口
- [x] `App Mapping / CategoryColorControls` 零散尾巴已收口
- [x] `ToastStack` 已成为明确 Quiet Pro 原语落点
- [x] 前端主路径剩余“非 Quiet Pro 系统化 UI”已显著降到尾部级别
- [x] `npm run build` 通过
- [ ] 如受影响，`npm test` 通过

## 9. 给 GPT-5.3-Codex 的执行要求

- 允许一次任务完成本轮全部 UI 尾部收口
- 但必须严格限制在本文定义的 4 类范围内
- 不要扩成整页重做
- 不要顺手引入新的视觉方向
- 不要扩展到 Rust / Tauri
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 10. 任务完成后的处理

本文档属于一次性执行单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在顶层 `docs/`。
