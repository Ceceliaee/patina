# 修正单：显式保存切页提示补漏

Document Type: One-off Review Fix Plan

## 1. 背景

上一轮“前端显式保存 / 取消编辑收口”主路径已经完成，但验收时发现一个剩余漏口：

- [`src/features/classification/components/AppMapping.tsx`](../../src/features/classification/components/AppMapping.tsx) 中“应用名称编辑”仍先暂存在 `nameDrafts`
- 名称只有在 `blur / Enter` 时才真正写入页面主 `draftState`
- [`src/app/AppShell.tsx`](../../src/app/AppShell.tsx) 的切页拦截只依赖页面上报的 `dirty`

这会导致一个边界漏洞：

- 用户在应用名称输入框中修改文本后，若直接点击侧边栏切页
- `AppShell` 可能在 `dirty` 还没反映这次名称修改前就完成导航
- 刚输入但尚未提交到 `draftState` 的名称会直接丢失，也不会弹出未保存提示

本修正单只处理这一条漏口。

## 2. 目标

修复 `App Mapping` 中“应用名称正在编辑时直接切页”的未保存提示漏洞，确保：

- 名称输入过程本身就能参与未保存判断，或
- 在切页拦截前先把正在编辑的名称安全并入当前页面 draft

最终效果必须满足：

- 用户只要在名称输入框中产生了未保存修改，就不能静默切走页面
- 切页时要么先提示“放弃更改”，要么先把编辑值安全并入当前 draft，再按统一规则判断
- 不得重新引入即时持久化

## 3. 范围

只允许修改与这条漏口直接相关的前端文件：

- `src/features/classification/components/AppMapping.tsx`
- `src/app/AppShell.tsx`
- 如确有必要，`src/lib/copy.ts`

允许的最小配套改动：

- `App Mapping` 的名称编辑状态参与 `dirty` 判断
- 切页前对“正在编辑名称”的本地值做安全收口

## 4. 非目标

- 不改 Settings 页
- 不改分类颜色、分类增删、追踪开关等其他显式保存路径
- 不改 Rust / Tauri
- 不扩展成浏览器刷新、窗口关闭、系统退出级别的全局 unsaved-changes 守卫
- 不新增 shared 级通用 dirty-form 或导航守卫基础设施

## 5. 边界要求

- 问题 owner 仍然是 `classification feature + AppShell 内部切页协调`
- 修复必须留在 `AppMapping` 与 `AppShell` 之间完成
- 不允许把“名称输入中间态”绕过页面 draft 直接写入 persistence
- 不允许为了修这一点，把整套切页逻辑下沉到 `shared/*` 或 `src/lib/*`

## 6. 执行阶段

### 阶段 A：名称输入中间态纳入未保存判断

目标：

- 只要名称输入框里存在尚未确认的变更，页面就应表现为“有未保存修改”

可接受实现方向，二选一即可：

1. 让 `nameDrafts` 直接参与 `hasUnsavedChanges` 计算
2. 在切页前或输入交互边界，把当前正在编辑的名称安全并入 `draftState`

执行项：

- [x] 修复名称输入中间态不会触发未保存提示的问题
- [x] 保持名称编辑仍属于页面级 draft，而不是即时持久化
- [x] 阶段 A 完成后运行 `npm run build`

验收门槛：

- [x] 在 `App Mapping` 中修改应用名称但尚未保存时，直接点击侧边栏切页，不会静默丢失修改
- [x] 此时会按统一规则触发未保存提示，或先安全收口再进入统一提示逻辑

### 阶段 B：回归验证与文档收尾

执行项：

- [x] 复查 `App Mapping` 其他显式保存路径没有回退成即时持久化
- [x] 更新本修正单勾选状态
- [x] 修复完成并验收通过后，将本文档移入 `docs/archive/`
- [x] 收尾运行 `npm run build`

如本轮改动影响现有测试链路，再补跑：

- [ ] `npm test`

## 7. 完成定义

满足以下条件，才算本轮完成：

- [x] `App Mapping` 的名称输入中间态不再绕过未保存提示
- [x] 应用内切页时不会静默丢失尚未保存的名称修改
- [x] 没有重新引入即时持久化
- [x] `npm run build` 通过
- [ ] 如本轮影响现有测试链路，相关 `npm test` 通过

## 8. 给 GPT-5.3-Codex 的执行要求

- 严格限定在 `App Mapping` 名称输入未保存提示补漏范围内
- 不扩展新的保存流程重构
- 不修改 Settings 页
- 不扩展全局导航守卫
- 不新增 shared 通用 dirty-form / unsaved guard 基础设施
- 完成后更新文档勾选状态并运行 `npm run build`
- 如果本轮改动影响现有测试链路，再补跑 `npm test`
- 同时遵循 [`AGENTS.md`](../../AGENTS.md)、[`docs/architecture-target.md`](architecture-target.md) 与 [`docs/quiet-pro-component-guidelines.md`](../quiet-pro-component-guidelines.md)

## 9. 完成后处理

本文档属于一次性修正单。  
修复完成并验收通过后，应移入 `docs/archive/`，不要长期留在 `docs/` 顶层。
