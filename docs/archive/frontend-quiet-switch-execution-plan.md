# 执行单：QuietSwitch 共享开关原语收口
Document Type: One-off Execution Plan

## 1. 背景

当前前端主路径里，大部分高频控件已经收进了 Quiet Pro 体系：

- 对话框已使用 `QuietDialog / QuietConfirmDialog / QuietPromptDialog`
- 下拉已使用 `QuietSelect`
- 颜色入口已使用 `QuietColorField`

但 `Settings` 页面里的几个布尔开关仍然是页面私有实现，而不是 Quiet Pro 的共享 `control` 原语。

当前仍属页面私有实现的开关包括：

- `tracking_paused`
- `launch_at_login`
- `start_minimized`

它们目前能正常工作，但存在两个问题：

1. 视觉和交互虽然接近 Quiet Pro，却没有形成共享原语，后续别的页面如果也需要开关，很容易继续复制页面私有实现。
2. 这些开关的状态、焦点、禁用态和可访问性细节都还散落在页面里，不符合“先扩设计系统，再接页面”的 Quiet Pro 方向。

因此这轮不做新的页面改版，只做一个很小的设计系统收口：

- 新增共享 `QuietSwitch`
- 只接入 `Settings`
- 保持现有行为不变

## 2. 本轮目标

完成后应达到：

- 前端存在一个可复用的 Quiet Pro 开关原语 `QuietSwitch`
- `Settings` 中现有 3 个页面私有开关改为使用 `QuietSwitch`
- 页面行为、保存逻辑、禁用逻辑不发生变化
- 视觉保持当前 Quiet Pro 方向，不做额外“设计感增强”

## 3. 范围

重点文件：

- `src/shared/components/QuietSwitch.tsx`
- `src/App.css`
- `src/features/settings/components/Settings.tsx`

如确有必要，可少量触及：

- `src/lib/copy.ts`

## 4. 非目标

- 不改 `App Mapping` 的行内状态按钮
- 不改 `Dashboard / History` 图表 tooltip
- 不改保存流、切页未保存提示、对话框逻辑
- 不扩展到 Rust / Tauri
- 不顺手重做 `Settings` 页布局

## 5. 核心要求

### 5.1 原语要求

`QuietSwitch` 必须明确具备：

- `default`
- `hover`
- `focus`
- `disabled`
- `checked`
- `unchecked`

并且：

- 外观要保持 Quiet Pro 的中性、克制、桌面工具感
- 不能做成移动端 App 风格的大彩色开关
- 开启时可以用语义色表达状态，但 surrounding chrome 仍应克制

### 5.2 行为要求

- 保持当前点击切换行为
- 保持当前禁用行为
- 支持键盘聚焦与可访问性语义
- 不改变 `Settings` 页现有数据流与草稿保存机制

### 5.3 结构要求

- 先抽共享原语，再替换 `Settings` 页面现有开关
- 不允许继续把样式细节留在 `Settings.tsx` 页面内部
- 不要新增页面私有 switch helper

## 6. 建议实现方向

推荐顺序：

1. 在 `src/shared/components/` 新增 `QuietSwitch.tsx`
2. 在 `src/App.css` 新增 `qp-switch-*` 语义样式
3. 用 `QuietSwitch` 替换 `Settings` 中：
   - `tracking_paused`
   - `launch_at_login`
   - `start_minimized`
4. 复核禁用态与布局未被改坏

实现时应优先复用现有 token：

- `--qp-success`
- `--qp-warning`
- `--qp-control-off`
- `--qp-border-subtle`
- `--qp-border-strong`
- `--qp-bg-panel`
- `--qp-text-disabled`

## 7. 执行阶段

### 阶段 A：建立 QuietSwitch 原语

执行项：

- [x] 新增 `QuietSwitch.tsx`
- [x] 定义共享 props，至少覆盖：`checked`、`disabled`、`onChange`、`ariaLabel`
- [x] 在 `App.css` 增加 `qp-switch-*` 样式角色
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] `QuietSwitch` 已能独立表达开/关、hover、focus、disabled
- [x] 样式属于 Quiet Pro，而不是页面临时拼装

### 阶段 B：接入 Settings

执行项：

- [x] 用 `QuietSwitch` 替换 `tracking_paused`
- [x] 用 `QuietSwitch` 替换 `launch_at_login`
- [x] 用 `QuietSwitch` 替换 `start_minimized`
- [x] 保持 `start_minimized` 依赖 `launch_at_login` 的禁用逻辑不变
- [x] 阶段 B 完成后运行 `npm run build`

验收门槛：

- [x] 三个开关行为与改造前一致
- [x] 禁用态、已开/未开态清楚
- [x] 页面布局没有因替换原语发生明显错位

### 阶段 C：收尾与复核

执行项：

- [x] 复核 `Settings` 页没有残留页面私有 switch 结构
- [x] 更新本执行单勾选状态
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 8. 完成定义

- [x] `QuietSwitch` 已成为共享原语
- [x] `Settings` 中 3 个开关已全部切到 `QuietSwitch`
- [x] 页面私有 toggle 结构已不再是主路径
- [x] `npm run build` 通过
- [x] 如受影响，`npm test` 通过

## 9. 给 GPT-5.3-Codex 的执行要求

- 严格限制在 `QuietSwitch + Settings 接入` 范围内
- 不要顺手继续改 `App Mapping`
- 不要顺手继续改图表 tooltip
- 不要扩展新的 Quiet Pro 大改版
- 每完成一个阶段，更新文档勾选状态并运行 `npm run build`
- 如果本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 10. 任务完成后的处理

本文档属于一次性执行单。

当本轮任务完成并验收通过后，应移入 `docs/archive/`，不要长期留在顶层 `docs/`。
