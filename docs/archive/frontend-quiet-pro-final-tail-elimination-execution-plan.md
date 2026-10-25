# 执行单：Quiet Pro 前端最终尾巴清零
Document Type: One-off Execution Plan

## 1. 背景

当前前端主路径已经基本进入 Quiet Pro 体系：

- 对话框、下拉、颜色入口、开关、图表 tooltip、toast、分段筛选、行内轻操作都已有共享原语
- `Dashboard / History / Settings / App Mapping` 的主体验已基本统一到 Quiet Pro

当前剩下的，不再是“大块 UI 不像 Quiet Pro”，而是最后一批“仍然可复用、却还没有完全系统化”的尾巴。

这批尾巴主要表现为：

1. 仍有少量可复用 Quiet Pro 角色只存在于 CSS class，没有对应共享组件
2. 仍有少量页面在直接拼装这些角色，而不是通过共享原语接入
3. 这些尾巴继续留着不会马上出戏，但会让后续维护重新滑回“页面私有实现”

本轮目标就是把这批“值得系统化的尾巴”一次清干净。

## 2. 先定义：什么算“尾巴”

本执行单中的“尾巴”只指：

- 当前主路径中仍然明显可复用
- 且已经具备稳定 Quiet Pro 语义
- 但还没有进入共享组件层的 UI 角色

当前明确纳入本轮范围的尾巴包括：

- `qp-subpanel`
- `qp-action-row`
- `qp-reset-action`

以及它们在页面中的直接使用位置。

## 3. 明确排除：什么不算“尾巴”

以下内容不属于本轮目标，不要为了“追求 100% 零 inline / 零 class”而误改：

- 数据驱动的业务色内联样式
  - 例如分类色、图表色、应用 accent 色
- 几何定位内联样式
  - 例如颜色弹层定位、拖拽 thumb 定位
- 页面布局级 utility class
  - 例如 `flex / grid / gap / min-w / truncate`
- 已经稳定存在的共享语义样式角色
  - 即便它们未必都需要单独抽成组件，也不属于本轮必须处理对象

也就是说：

- 本轮不是做“零 CSS class / 零 style”
- 本轮是做“把剩余还值得组件化的 Quiet Pro 角色收完”

## 4. 本轮目标

完成后应达到：

- 剩余可复用 Quiet Pro 尾巴进入共享组件层
- `Settings / App Mapping / CategoryColorControls` 中本轮目标角色不再直接以页面私有方式主路径存在
- 前端主路径剩余未系统化 UI 降到“只有合理保留的布局与数据驱动样式”

## 5. 范围

重点文件：

- `src/shared/components/QuietSubpanel.tsx`
- `src/shared/components/QuietActionRow.tsx`
- `src/shared/components/QuietResetAction.tsx`
- `src/App.css`
- `src/features/settings/components/Settings.tsx`
- `src/features/classification/components/AppMapping.tsx`
- `src/features/classification/components/CategoryColorControls.tsx`

如确有必要，可少量触及：

- `src/shared/components/index` 一类导出位置

## 6. 非目标

- 不改 Rust / Tauri
- 不改业务逻辑
- 不改保存流
- 不改排序逻辑
- 不改颜色选择器能力
- 不改图表数据逻辑或布局
- 不重做页面结构
- 不再开启新的 Quiet Pro 设计方向

## 7. 核心要求

### 7.1 组件化要求

本轮至少将以下角色组件化：

- `QuietSubpanel`
- `QuietActionRow`
- `QuietResetAction`

要求：

- 共享组件必须有明确语义，而不是“把一串 class 包起来”
- 保持 Quiet Pro 的中性、克制、稳定
- 保持当前视觉层级，不要因为组件化而变重

### 7.2 接入要求

- `Settings` 中数据安全区块应使用 `QuietSubpanel / QuietActionRow`
- `App Mapping` 与 `CategoryColorControls` 中的“默认”动作应使用 `QuietResetAction`
- 不允许保留“新组件 + 旧 class 主路径并存”

### 7.3 结束判定要求

本轮结束后，可以接受：

- 仍存在数据驱动 inline style
- 仍存在布局级 utility class

但不应再存在：

- 本轮目标角色仍只靠页面直接写 `qp-subpanel / qp-action-row / qp-reset-action`

## 8. 建议实现方向

推荐顺序：

1. 新增 `QuietSubpanel`
2. 新增 `QuietActionRow`
3. 新增 `QuietResetAction`
4. 用新组件替换 `Settings`
5. 用新组件替换 `App Mapping / CategoryColorControls`
6. 复核 `App.css` 中对应样式角色是否仍清晰、必要

## 9. 执行阶段

### 阶段 A：补齐最终共享组件

执行项：

- [x] 新增 `QuietSubpanel.tsx`
- [x] 新增 `QuietActionRow.tsx`
- [x] 新增 `QuietResetAction.tsx`
- [x] 让 `App.css` 中对应样式角色服务于共享组件，而不是继续服务页面私有拼装
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 本轮目标角色都已有共享组件落点
- [x] 组件语义清楚，不是单纯 class 搬运

### 阶段 B：接入 Settings

执行项：

- [x] `Settings` 数据安全区块改接 `QuietSubpanel / QuietActionRow`
- [x] 保持导出 / 恢复 / 反馈 / 更新说明 / 清理行为不变
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] `Settings` 中本轮目标角色不再由页面直接拼装
- [x] 视觉与交互不发生回归

### 阶段 C：接入 App Mapping / CategoryColorControls

执行项：

- [x] `App Mapping` 颜色旁“默认”改接 `QuietResetAction`
- [x] `CategoryColorControls` 中“默认”改接 `QuietResetAction`
- [x] 阶段 C 完成后运行 `npm run build`

验收门槛：

- [x] 两处 reset 动作都已进入共享组件
- [x] 页面行为与视觉层级保持不变

### 阶段 D：最终复核

执行项：

- [x] 复核本轮目标角色已无页面私有主路径残留
- [x] 更新本执行单勾选状态
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 10. 完成定义

- [x] `QuietSubpanel` 已建立并接入
- [x] `QuietActionRow` 已建立并接入
- [x] `QuietResetAction` 已建立并接入
- [x] `Settings / App Mapping / CategoryColorControls` 中本轮目标尾巴已全部清掉
- [x] 前端主路径剩余“非系统化 Quiet Pro UI”仅剩合理保留项
- [x] `npm run build` 通过
- [ ] 如受影响，`npm test` 通过

## 11. 给 GPT-5.3-Codex 的执行要求

- 这是 Quiet Pro 前端最终尾巴清零任务，但范围只限本文定义对象
- 不要把“清零”误解成去消灭所有 inline style 或所有 utility class
- 只收当前仍值得组件化的 Quiet Pro 角色
- 不要扩展到 Rust / Tauri
- 不要重做页面
- 不要顺手改变交互逻辑
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 12. 任务完成后的处理

本文档属于一次性执行单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在顶层 `docs/`。
