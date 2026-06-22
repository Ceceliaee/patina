# 网页同步使用说明入口执行方案

状态：已完成并归档  
日期：2026-06-21  
文档类型：How-to / 一次性执行方案  
目标读者：后续实现该功能的开发者  

## 1. 目标

- [x] 在 `Settings / 服务 / 网页同步` 区块里增加一个轻量的“使用说明”按钮。
- [x] 按钮只在用户可能需要帮助时出现：
  - [x] 网页同步开关关闭时不出现。
  - [x] 网页同步开关开启但尚未配置成功时出现。
  - [x] 配置成功后不出现。
  - [x] 端口或 Token 被修改、保存前后重新变成未验证状态时再次出现。
- [x] 点击按钮后打开一个 Quiet Pro 风格弹窗，说明浏览器扩展如何连接 Patina。
- [x] 不改变网页同步已有保存、Token 生成、端口校验和运行时记录行为。

## 2. 判断依据

- [x] 产品方向：该改动提升 `Settings` 的行为透明度和用户控制感，仍然服务个人、本地优先的桌面时间追踪。
- [x] UI 基线：入口必须安静、克制、低打扰，遵守 `Quiet Pro`。
- [x] 架构边界：主要 owner 是 `features/settings`。组件和 hook 不应直接访问 Tauri 或 platform gateway。
- [x] 稳定期模式：该需求属于小型 UI/状态增强；如果实现时发现需要新增跨层协议或 Rust 厚逻辑，应暂停并重新升级为边界判断。

参考文档：

- [x] `docs/product-principles-and-scope.md`
- [x] `docs/roadmap-and-prioritization.md`
- [x] `docs/engineering-quality.md`
- [x] `docs/quiet-pro-component-guidelines.md`
- [x] `docs/architecture.md`
- [x] `docs/issue-fix-boundary-guardrails.md`

## 3. 非目标

- [x] 不新增网页登录、云同步、账号体系或团队协作能力。
- [x] 不把网页同步说明做成常驻提示条。
- [x] 不新增“以后不再提示”之类持久化偏好。
- [x] 不改变浏览器扩展协议、HTTP 路径、Token 认证逻辑或网页记录写入逻辑。
- [x] 不在弹窗里暴露完整 Token 明文；Token 仍由现有输入框的显示按钮控制。
- [x] 不新增外链，除非已经存在明确的扩展安装页面或用户另行确认。

## 4. 当前代码落点

- [x] 网页同步 UI 当前在 `src/features/settings/components/SettingsInterfacePanel.tsx`。
- [x] 设置页状态当前在 `src/features/settings/hooks/useSettingsPageState.ts` 和 `src/features/settings/hooks/settingsPageStateInteractions.ts`。
- [x] 设置页运行时适配当前在 `src/features/settings/services/settingsRuntimeAdapterService.ts`。
- [x] 网页同步运行时快照已有 platform gateway：`src/platform/runtime/webActivityBridgeGateway.ts`。
- [x] Rust 命令已暴露 `cmd_get_web_activity_bridge_snapshot`。
- [x] 弹窗可复用 `src/shared/components/QuietDialog.tsx`。
- [x] 局部样式可放在 `src/styles/features/settings.css`。
- [x] UI 文案统一放在 `src/shared/copy/uiText.ts`。

## 5. 产品与交互决策

- [x] 按钮文案使用“使用说明”，英文使用 `Guide` 或 `How to use`。
- [x] 按钮位置放在“网页同步”标题右侧，也就是截图红框附近。
- [x] 按钮使用小尺寸二级按钮或 inline help chip，不使用强调色按钮。
- [x] 图标优先用 `CircleHelp` 或 `BookOpen`，尺寸保持 `13px` 到 `14px`。
- [x] 按钮不占用开关右侧主操作位，避免和开关形成竞争。
- [x] 弹窗标题使用“网页同步使用说明”。
- [x] 弹窗内容只写必要步骤，不写长篇概念解释。
- [x] 弹窗底部只保留“关闭”按钮，第一版不做复制端口/复制 Token。

## 6. “配置成功”的定义

不要把“保存成功”当成“配置成功”。

- [x] 配置成功应基于运行时快照：
  - [x] `snapshot.enabled === true`
  - [x] `snapshot.connected === true`
- [x] `connected` 表示浏览器扩展最近成功向 Patina 发送过网页活动，当前 Rust 端窗口为 30 秒。
- [x] 如果快照读取失败，视为未确认成功，不显示错误状态，但继续显示“使用说明”入口。
- [x] 如果当前草稿端口或 Token 与已保存值不同，视为当前配置未完成，即使旧连接仍然显示 `connected`。
- [x] 如果当前草稿开关为关闭，按钮永远不显示。

建议抽成可测试的纯函数，逻辑等价于：

```ts
showHelp =
  draft.webActivityEnabled
  && (
    normalizedDraftToken.length === 0
    || draft.webActivityPort !== saved.webActivityPort
    || normalizedDraftToken !== normalizedSavedToken
    || !snapshot
    || !snapshot.enabled
    || !snapshot.connected
  );
```

## 7. 详细执行步骤

### 7.1 准备与确认

- [x] 运行 `git status --short`，确认工作区状态。
- [x] 重新阅读本执行方案，确认没有扩展到非目标范围。
- [x] 打开并确认以下文件的当前实现：
  - [x] `src/features/settings/components/Settings.tsx`
  - [x] `src/features/settings/components/SettingsInterfacePanel.tsx`
  - [x] `src/features/settings/hooks/useSettingsPageState.ts`
  - [x] `src/features/settings/services/settingsRuntimeAdapterService.ts`
  - [x] `src/platform/runtime/webActivityBridgeGateway.ts`
  - [x] `src/shared/copy/uiText.ts`
  - [x] `src/styles/features/settings.css`

### 7.2 新增可测试的显示规则

- [x] 新建 `src/features/settings/services/webActivitySetupState.ts`。
- [x] 在该文件内定义最小输入类型：
  - [x] `draftEnabled`
  - [x] `draftPort`
  - [x] `draftToken`
  - [x] `savedEnabled`
  - [x] `savedPort`
  - [x] `savedToken`
  - [x] `snapshot`
- [x] 实现 `shouldShowWebActivityHelp(input)`。
- [x] 在函数内部统一 `trim()` Token。
- [x] 关闭状态直接返回 `false`。
- [x] 草稿 Token 为空直接返回 `true`。
- [x] 草稿端口或 Token 与已保存值不一致时返回 `true`。
- [x] 快照为空或读取失败时返回 `true`。
- [x] 快照 `enabled && connected` 时返回 `false`。
- [x] 其他情况返回 `true`。
- [x] 不在该服务中访问 Tauri、DOM、localStorage 或 React。

### 7.3 接入运行时快照读取

- [x] 在 `SettingsRuntimeAdapterService` 中新增一个薄方法，例如 `getWebActivityBridgeSnapshot()`。
- [x] 该方法内部调用 `getWebActivityBridgeSnapshot` platform gateway。
- [x] 不让 `SettingsInterfacePanel.tsx` 或 settings hook 直接 import `src/platform/runtime/webActivityBridgeGateway.ts`。
- [x] 保持返回类型为现有 `WebActivityBridgeSnapshot`，不要新增重复 DTO。
- [x] 快照读取失败时由调用方捕获，不在 service 层吞掉错误。

### 7.4 新增 settings 专属 hook

- [x] 新建 `src/features/settings/hooks/useWebActivitySetupState.ts`。
- [x] 输入参数使用 `savedSettings` 和 `draftSettings`，两者为 `AppSettings | null`。
- [x] hook 内部维护：
  - [x] `snapshot`
  - [x] `snapshotAvailable` 或 `snapshotError`
  - [x] 必要时的 `lastCheckedAtMs`
- [x] 当 `draftSettings?.webActivityEnabled !== true` 时：
  - [x] 停止轮询。
  - [x] 清空快照状态。
  - [x] 返回 `showWebActivityHelp: false`。
- [x] 当草稿开关开启时：
  - [x] 立即读取一次快照。
  - [x] 每 5 秒左右轻量轮询一次，直到配置成功或开关关闭。
  - [x] 组件卸载时清理 timer。
  - [x] 读取失败只记录 `console.warn`，不打扰用户。
- [x] 当以下值变化时立即重新评估：
  - [x] `draftSettings.webActivityEnabled`
  - [x] `draftSettings.webActivityPort`
  - [x] `draftSettings.webActivityToken`
  - [x] `savedSettings.webActivityEnabled`
  - [x] `savedSettings.webActivityPort`
  - [x] `savedSettings.webActivityToken`
- [x] hook 返回：
  - [x] `showWebActivityHelp`
  - [x] `webActivityBridgeSnapshot`
  - [x] 可选 `webActivityHelpReason`，仅测试或调试使用，不一定进入 UI。

### 7.5 连接到 Settings 页面

- [x] 在 `Settings.tsx` 调用 `useWebActivitySetupState({ savedSettings, draftSettings })`。
- [x] 将 `showWebActivityHelp` 作为 prop 传入 `SettingsInterfacePanel`。
- [x] 不把轮询逻辑塞进 `Settings.tsx` 主组件。
- [x] 不把运行时快照存进全局 app settings。
- [x] 不引入新的持久化字段。

### 7.6 修改 SettingsInterfacePanel

- [x] 扩展 `SettingsInterfacePanelProps`：
  - [x] `showWebActivityHelp: boolean`
- [x] 在组件内部新增本地 state：
  - [x] `webActivityHelpOpen`
- [x] 从 `lucide-react` 引入选定图标：
  - [x] 推荐 `CircleHelp`
  - [x] 若视觉更安静可选 `BookOpen`
- [x] 将“网页同步”标题改成横向标题组：
  - [x] 标题文本保持原样。
  - [x] `showWebActivityHelp` 为 `true` 时渲染按钮。
  - [x] 按钮使用 `type="button"`。
  - [x] 按钮点击后 `setWebActivityHelpOpen(true)`。
  - [x] 按钮有 `aria-label`。
- [x] 保持右侧 `QuietSwitch` 位置不变。
- [x] 保持开关开启后才显示端口和 Token 字段的现有行为。
- [x] 在组件返回值中加入 `QuietDialog`。
- [x] 弹窗 `open={webActivityHelpOpen}`。
- [x] 弹窗 `onClose={() => setWebActivityHelpOpen(false)}`。
- [x] 弹窗 actions 只放一个二级“关闭”按钮。

### 7.7 弹窗内容

- [x] 弹窗正文使用一个短说明加一个有序步骤列表。
- [x] 中文建议文案：
  - [x] 标题：`网页同步使用说明`
  - [x] 描述：`通过浏览器扩展把当前活动网页同步到 Patina。`
  - [x] 步骤 1：`安装并启用 Patina 浏览器扩展。`
  - [x] 步骤 2：`在扩展中填写本页端口和 Token。`
  - [x] 步骤 3：`保持网页同步开关开启，并保存设置。`
  - [x] 步骤 4：`切到一个普通网页，等待 Patina 接收一次活动。`
  - [x] 步骤 5：`连接成功后，此入口会自动隐藏。`
- [x] 英文文案同步补齐，避免破坏双语 UI。
- [x] 如需显示当前端口，只显示端口号，不重复显示 Token 明文。
- [x] 如果端口草稿为空或非法，弹窗使用当前已保存端口或提示先输入有效端口。
- [x] 可补一条轻提示：隐身窗口和 `chrome://` 这类非普通网页不会记录。
- [x] 不在弹窗中解释内部 HTTP endpoint、Rust 命令名或数据库表。

### 7.8 样式实现

- [x] 在 `src/styles/features/settings.css` 增加局部类。
- [x] 建议类名：
  - [x] `.settings-inline-help-button`
  - [x] `.settings-web-activity-help-list`
  - [x] `.settings-web-activity-help-note`
- [x] 使用现有 token：
  - [x] `var(--qp-bg-panel)`
  - [x] `var(--qp-bg-elevated)`
  - [x] `var(--qp-border-subtle)`
  - [x] `var(--qp-border-strong)`
  - [x] `var(--qp-text-secondary)`
  - [x] `var(--qp-text-primary)`
  - [x] `var(--qp-text-tertiary)`
  - [x] `var(--qp-accent-default)` 仅用于 focus ring 或小图标，不做强色块。
- [x] 定义完整状态：
  - [x] default
  - [x] hover
  - [x] active
  - [x] focus-visible
  - [x] disabled 如果按钮未来需要禁用
- [x] 保持圆角在现有 7px 到 8px 档位内。
- [x] 不新增阴影、重背景、渐变、模糊或高饱和装饰。
- [x] 小屏下允许标题和按钮换行，不允许挤压右侧开关。

### 7.9 文案文件修改

- [x] 在 `src/shared/copy/uiText.ts` 的 `accessibility.settings` 中增加：
  - [x] `openWebActivityHelp`
- [x] 在 `settings` 中增加：
  - [x] `webActivityHelpAction`
  - [x] `webActivityHelpTitle`
  - [x] `webActivityHelpDescription`
  - [x] `webActivityHelpSteps`
  - [x] 可选 `webActivityHelpNote`
- [x] 同步增加英文覆盖，不依赖 `...ZH_CN_UI_TEXT.settings` 继承中文。
- [x] 检查所有新增 key 都被实际引用。
- [x] 确认没有中文 key 缺英文翻译导致英文界面混中文。

### 7.10 单元测试

- [x] 新增 `tests/webActivitySetupState.test.ts`，或把纯函数测试纳入 `tests/settingsPageState.test.ts`。
- [x] 覆盖以下场景：
  - [x] 草稿开关关闭时返回 `false`。
  - [x] 草稿开关开启、快照为空时返回 `true`。
  - [x] 草稿开关开启、快照 `enabled && connected` 时返回 `false`。
  - [x] 快照 connected 但 snapshot enabled 为 false 时返回 `true`。
  - [x] 草稿 Token 为空时返回 `true`。
  - [x] 草稿 Token 与已保存 Token 不一致时返回 `true`。
  - [x] 草稿端口与已保存端口不一致时返回 `true`。
  - [x] Token 只有首尾空格差异时按 trim 后结果判断。
- [x] 如果新增独立测试文件，同步更新 `package.json` 的合适 test script。

### 7.11 UI smoke 与浏览器验证测试

- [x] 更新 `tests/uiSmoke.test.ts`：
  - [x] 检查 `SettingsInterfacePanel` 引入 `QuietDialog`。
  - [x] 检查新增 help 文案 key 存在。
  - [x] 检查 Settings 没有直接 import platform runtime gateway。
- [x] 更新 `tests/uiBrowserSmoke.test.ts`：
  - [x] 在 Tauri stub 中支持 `cmd_get_web_activity_bridge_snapshot`。
  - [x] 场景 A：网页同步关闭时，“使用说明”不可见。
  - [x] 场景 B：打开网页同步，stub 返回 disconnected，“使用说明”可见。
  - [x] 场景 C：点击“使用说明”，弹窗出现。
  - [x] 场景 D：关闭弹窗后页面可继续操作。
  - [x] 场景 E：stub 返回 connected 且设置已保存，“使用说明”隐藏。
  - [x] 场景 F：修改端口或 Token 后，即使之前 connected，按钮重新出现。
  - [x] 检查 390px 宽度下标题、按钮、开关和输入框不重叠。

### 7.12 手动核查

- [x] 启动本地应用或 Vite smoke 环境。
- [x] 进入 Settings。
- [x] 确认网页同步关闭时没有按钮。
- [x] 打开网页同步，确认按钮出现在“网页同步”标题旁。
- [x] 点击按钮，确认弹窗内容清晰且没有视觉噪音。
- [x] 关闭弹窗，确认焦点和页面状态正常。
- [x] 保存设置后，在扩展未连接时按钮仍显示。
- [x] 模拟或实际完成扩展连接后，确认按钮自动隐藏。
- [x] 修改 Token 或端口后，确认按钮重新出现。
- [x] 切换中文和英文，确认文案都正确。
- [x] 检查浅色和深色主题下按钮与弹窗都符合 Quiet Pro。

### 7.13 验证命令

局部验证：

- [x] `npm run test:settings`
- [x] `npm run test:ui-smoke`
- [x] `npm run test:ui-browser-smoke`
- [x] `npm run build`

交付前验证：

- [x] `npm run check`

只有在实现过程中修改 Rust、Tauri command、web activity bridge 协议或运行时主链时，才追加：

- [x] `npm run check:rust`
- [x] 或直接运行 `npm run check:full`

## 8. 验收标准

- [x] 网页同步关闭时，服务面板无“使用说明”按钮。
- [x] 网页同步开启但扩展未连接时，按钮显示。
- [x] 点击按钮能打开使用说明弹窗。
- [x] 弹窗可通过“关闭”、Esc 和 backdrop 正常关闭。
- [x] 已保存配置且扩展最近连接成功时，按钮隐藏。
- [x] 修改端口或 Token 后，按钮重新显示。
- [x] 按钮与弹窗在 390px 宽度下不遮挡、不溢出、不挤压开关。
- [x] 没有新增 hardcoded 颜色、阴影或圆角尺度。
- [x] 组件和 hook 没有直接访问 platform gateway。
- [x] 新增测试覆盖显示规则。
- [x] `npm run check` 通过，或如未运行需明确说明原因。

## 9. 风险与处理

- [x] 旧连接导致按钮过早隐藏。
  - [x] 处理：只有草稿端口和 Token 与已保存值一致时，才允许用 `snapshot.connected` 隐藏按钮。
- [x] 快照读取失败导致用户看不到帮助。
  - [x] 处理：读取失败视为未配置，继续显示帮助入口。
- [x] 轮询增加无意义开销。
  - [x] 处理：只在草稿开关开启时轮询，配置成功后可降低频率或停止。
- [x] 文案太重，让设置页显得像教程页。
  - [x] 处理：说明放进弹窗，页面只保留小按钮。
- [x] 视觉入口太显眼。
  - [x] 处理：使用二级按钮、低对比图标和现有 token。
- [x] 英文界面漏翻译。
  - [x] 处理：新增 key 时同步补英文覆盖，并在 smoke 中检查。

## 10. 回滚方案

- [x] 已记录：如需回滚，移除 `SettingsInterfacePanel` 中的按钮和 `QuietDialog`。
- [x] 已记录：如需回滚，移除 `useWebActivitySetupState` hook。
- [x] 已记录：如需回滚，移除 `webActivitySetupState` 纯函数及对应测试。
- [x] 已记录：如需回滚，移除 `SettingsRuntimeAdapterService.getWebActivityBridgeSnapshot` 新方法。
- [x] 已记录：如需回滚，移除 `uiText.ts` 新增文案 key。
- [x] 已记录：如需回滚，移除 `settings.css` 新增局部样式。
- [x] 已记录：如需回滚，保留既有网页同步设置行为不受影响。


## 11. 完成记录

- [x] 已实现网页同步“使用说明”入口、QuietDialog 弹窗、显示规则 hook、双语文案和 Quiet Pro 样式。
- [x] 已用运行时快照 `enabled && connected` 作为配置成功依据，并在端口或 Token 草稿变化时重新显示入口。
- [x] 已补充 settings 单元测试、静态 UI smoke 和真实浏览器 UI smoke 场景。
- [x] 已通过 `npm run check`。
- [x] 本次未修改 Rust、Tauri command、网页同步 HTTP 协议或运行时主链，因此无需追加 `npm run check:rust`。
- [x] 内置浏览器实例不可用；最终交互核查由 `npm run test:ui-browser-smoke` 的真实浏览器场景覆盖。
- [x] 已启动本地 Vite dev server：`http://127.0.0.1:5173/`。
- [x] 已按文档卫生要求归档到 `docs/archive/`。
