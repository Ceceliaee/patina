# 挂件单屏回归与跨屏边缘吸附修复执行方案

> 文档类型：执行型 How-to / 可勾选执行单  
> 目标读者：Patina 维护者与负责实施、复核的 Codex 代理  
> 当前状态：第二轮实现、完整自动化、单屏真实 Tauri/WebView2 验证与对抗式审查已完成；按维护者指令重新归档  
> 对应 Project：`修复挂件单屏回归与跨屏边缘吸附坐标错误`  
> 对应 Issues：`Refs #55`、`Refs #64`  
> Project 最近一次只读字段：`Status = In progress`，`Area = Widget`；状态拖动仍由维护者执行  
> 文档位置：`docs/archive/`；本文不再作为活动实施依据

## 0.0 重新开启原因（2026-08-05）

- [x] 维护者提供单屏左右两张新截图：原生窗口虽在屏幕边缘，但可见半圆总有一侧内缩；截图动作后错误侧可能互换。
- [x] 已撤回“单屏左右可见结果均正确”的上一轮结论；旧证据只覆盖 native outer rect，没有覆盖 React `widget-shell-left/right`。
- [x] 已建立真实 Tauri/WebView2 红测：窗口稳定挂载后由 Rust 把 native placement 从左改为右，原生右边缘正确，但 DOM 仍保持 `widget-shell-left`，10 秒内不会自行一致。
- [x] RCA 根因：Rust 应用布局与 React 渲染侧别是两份状态；`widget-runtime-shown` 原先不携带 canonical placement，非当前 controller 发起的布局会只移动原生窗口而不更新 DOM。
- [x] 修复方向：每次 native layout 成功后通过现有 runtime event 携带同一份 canonical `WidgetPlacement`，前端 controller 据此同步渲染侧别；不新增共享抽象或通用窗口框架。
- [x] 真实 runtime 已双向验证 native 左/右工作区边缘、DOM side class、可见半圆跨越对应窗口边缘，并在用例结束恢复原持久化侧别。
- [x] 完整门禁和第二轮对抗式审查已通过；本执行单证据已更新并重新归档。

### 第二轮最终证据

- [x] 修复前真实 Tauri/WebView2 红测稳定复现：native 已切到右侧，DOM 10 秒内仍保持左侧。
- [x] `widget-runtime-shown` 现在携带 Rust 实际应用的 canonical `WidgetPlacement`；gateway 校验 DTO，controller 同步 React 渲染侧别。
- [x] 对抗式审查建立第二条红测并发现初始化乱序：旧数据库读取会覆盖更新的 runtime event；以 placement revision 护栏修复后红测转绿。
- [x] 真实 runtime 完成左 → 右 → 左切换；每一步同时断言原生窗口贴合工作区、DOM class 同侧、半圆矩形跨越对应窗口边缘。
- [x] `npm run test:interaction`：16 项通过。
- [x] `npm run check:full`：全部前端/架构/IPC/browser/build/Rust/依赖门禁通过；Rust 522 passed、1 ignored，npm 0 漏洞，Rust 0 个 Windows 可达漏洞。
- [x] `npm run test:tauri-runtime-smoke`：真实 Tauri/WebView2、SQLite、capability、首次创建、复用、持久化及双向可见侧别通过。
- [x] `git diff --check` 通过；未修改 CSS、Quiet Pro token、数据库 schema、版本号或 changelog。
- [x] live Project 只读复核仍为 `In progress`；本地归档不替代维护者的 Board 状态操作。

## 0. 执行结果与可复核证据

- [x] live Project 已先更新范围并由维护者拖入 `In progress`；实施开始时已重新读取验证。
- [x] 已确认执行环境为单显示器 `2048 × 1152`、工作区 `2048 × 1104`、125% DPI，并用真实 Tauri/WebView2 runtime 验证。
- [x] 已关联 Issue #55（跨屏/混合 DPI）与 Issue #64（单屏可见侧别回归），并以两组故障证据共同定义本次修复边界。
- [x] 已建立并观察失败红测：断开的 affinity 会劫持安全回退链；修复前得到 `Some(0)`，期望 `None`。
- [x] 已建立并观察失败红测：释放点已进入副屏但窗口矩形仍主要位于主屏时，旧矩形算法会错误选择主屏。
- [x] finalize 现在捕获物理释放点，由 Rust 用它一次性决定目标显示器和最近左右边；读取失败时才回退到最终窗口矩形。
- [x] 目标屏选定后，`anchorY` 使用目标屏最终 DPI 尺寸计算，150% → 125% 不再因旧窗口高度产生纵向漂移。
- [x] 断开的保存显示器不再任意映射到“几何上最近”的现存屏幕；只有名称匹配或工作区完全一致才恢复 affinity，否则进入既有安全 fallback。
- [x] 前端立即结束当前 generation，并等待该 generation 的释放点 Promise；迟到的旧释放点不能提前结束或覆盖新拖动。
- [x] 单屏真实 runtime 已断言左右两边精确贴合工作区物理边缘、DOM 同侧、可见半圆跨越对应边缘、Y 完全可见，且左侧位置落盘并能重新加载。
- [x] 合成矩阵覆盖单/多屏、负 X/Y、屏幕间隙、任务栏工作区、100%/125%/150%/200% DPI 和 150% ↔ 125% 混合 DPI。
- [x] `npm run check:full` 最终通过：77 个 browser smoke、生产构建、架构/IPC/热点/测试治理门禁、Rust 522 passed / 1 ignored、Clippy 与格式全部通过。
- [x] `npm run test:tauri-runtime-smoke` 最终通过真实 Tauri/WebView2、SQLite、capability、左右物理边缘与恢复验证。
- [x] 依赖审计通过：npm 0 漏洞，Rust 0 个 Windows 可达漏洞。
- [x] 两轮对抗式审查共发现并修复“旧释放点污染新 generation”“混合 DPI 使用源屏高度计算 anchor”“native/DOM 侧别分裂”和“旧初始化覆盖新 runtime event”四项问题；复修后完整门禁再次全绿。
- [x] 未改视觉、CSS、Quiet Pro token、数据库 schema、主窗口行为、版本号或 changelog；未创建通用多屏框架。
- [x] 未提交、未推送、未更改 Issue 状态；符合当前任务授权边界。
- [x] 本执行单与被其取代的上一轮执行单已移入 `docs/archive/`。

### 验证边界

当前机器没有第二块物理显示器，因此新实现的真实双屏后验只能在可测试构建交付给 Issue #55 报告者后补充。该限制没有被伪装成真机证据：跨屏结论来自释放点红测、负坐标/混合 DPI 确定性矩阵和真实单屏 Tauri 边缘链路；Project 是否进入 `Done` 仍由维护者结合此证据决定。

## 1. 一句话目标

先用可复核证据恢复挂件在单显示器主屏上“改坏前”的正确行为，再让多显示器拖动、左右吸附、半隐藏、持久化与恢复全部以挂件最终所在显示器的真实工作区和 DPI 为准，并证明跨屏修复没有再次破坏单屏。

## 2. 如何使用本文档

- [ ] 开始实施前，由维护者在 GitHub Project `Board` 视图将对应事项从 `Next` 拖到 `In progress`。
- [ ] Codex 在下一次状态检查点重新读取 live Project，确认状态已实际变更；聊天说明、commit 或本地文档不能替代 live Project。
- [ ] 严格按阶段顺序执行；未满足当前阶段退出条件时，不进入下一阶段。
- [ ] 每完成一个复选项立即勾选，并在相邻位置记录证据：commit、测试名、命令结果、日志、截图或人工验证环境。
- [ ] 任何“最后正常版本”“根因”“已修复”结论都必须有可重复证据，不凭记忆、截图观感或提交标题推断。
- [ ] 如果实现需要新增跨层端口、共享抽象、兼容壳或改变 `app / commands / platform / engine / data` 的 owner，立即触发第 21 节停止条件，先修订执行单。
- [ ] 自动化验证通过但缺少必要的 Windows 单屏或多屏真机证据时，只能记录为“自动化完成、硬件验收待补”，不能进入 `Done`。
- [ ] 全部验收通过后执行第 22 节对抗式复核，再由维护者将 Project 事项从 `In progress` 拖到 `Done`。
- [ ] 事项进入 `Done` 且执行单不再作为当前依据后，将本文移入 `docs/archive/`。

## 3. 已确认的产品契约

以下不是待讨论建议，而是本次执行必须保护的边界：

- [x] 挂件是屏幕边缘型、低打扰入口，不是自由漂浮窗。
- [x] 单屏与多屏均只允许吸附目标显示器的左侧或右侧。
- [x] 在屏幕中间松手时，挂件仍吸附到最终所在显示器最近的真实左右边缘。
- [x] 半隐藏只相对真实工作区边缘成立，不相对虚拟桌面总边界或错误偏移位置成立。
- [x] 本次需要修复当前单显示器主屏回归；“保持当前版本行为”不是验收基线。
- [x] 单屏正确基线来自改坏前最后一个经真实使用确认正常的版本，并需要通过 Git 历史和可重复输入输出重新确认。
- [x] 多屏修复不得改变单屏的尺寸、吸附、半隐藏、展开方向、拖动结束和重启恢复语义。
- [x] 不改变挂件视觉设计、信息结构、动效或功能模块。
- [x] 不调整主窗口多显示器行为。

## 4. 为什么采用执行单模式

本事项表面上是窗口位置错误，实际同时触及：

- Rust 领域几何与位置不变量；
- Tauri 窗口、显示器枚举、工作区和 DPI 边界；
- 应用级窗口生命周期与拖动完成事务；
- SQLite 设置中的位置持久化与缺屏恢复；
- 前端拖动 generation、尾部 moved 事件和 DPI 事件竞态；
- 单屏历史行为兼容与多屏真机验收。

因此它满足稳定期“跨层且容易在修复时隐性重构”的执行单条件。实施必须先锁定 owner、事实、阶段和验收，不得按“哪里能改就在哪里补判断”的小修方式推进。

## 5. 第一性原理

### 5.1 用户看到的是窗口最终边界，不是内部计算过程

窗口是否正确，只由这些可观察事实决定：

1. 挂件最终外部矩形在哪里；
2. 该矩形属于哪块真实显示器；
3. 它是否贴在该显示器真实工作区的左边或右边；
4. React 渲染侧别是否与原生 placement 是同一侧；
5. 半隐藏圆点是否实际跨越该侧窗口边缘，而不是出现在窗口内侧；
6. 可见宽度、窗口尺寸和纵向位置是否与产品契约一致；
7. 重启或拓扑变化后是否恢复到合理可见位置。

执行约束：

- [ ] 不用“调用成功”“保存成功”替代最终边界正确。
- [ ] 不用 CSS 位置或前端状态替代 Tauri 原生窗口外部矩形，也不用原生外框正确替代可见 DOM 贴边正确；两者必须作为联合不变量验证。
- [ ] 不用主窗口所在显示器推断挂件目标显示器。
- [ ] 不用虚拟桌面总宽度推断某块屏幕的真实边缘。

### 5.2 坐标只有在同一语义和单位下才能比较

显示器选择需要比较挂件矩形与显示器工作区。比较双方必须同时满足：

- 同一坐标空间：Windows 虚拟桌面坐标；
- 同一单位：物理像素；
- 同一矩形语义：外部窗口矩形与显示器工作区矩形；
- 同一时间快照：一次拖动完成事务内获取的数据。

执行约束：

- [ ] 物理矩形只与物理工作区比较。
- [ ] 逻辑尺寸只在选定目标显示器后，使用该显示器 scale factor 转换一次。
- [ ] 不把不同显示器的逻辑坐标直接拼成一个虚拟桌面。
- [ ] 不假设主屏原点为 `(0, 0)`，也不把负坐标钳制为零。
- [ ] 不假设显示器相邻、同高、同宽、同 DPI 或按固定顺序枚举。

### 5.3 一次拖动完成事务只能选择一个目标显示器

若读取最终矩形时选中显示器 B，但保存、尺寸换算或吸附阶段重新查询后又使用 A，系统必然产生回弹或跳屏。

执行约束：

- [ ] 一次 finalize 只枚举一次显示器快照。
- [ ] 一次 finalize 只选择一次目标显示器。
- [ ] 位置解析、尺寸换算、持久化和实际移动复用同一目标显示器对象或稳定标识。
- [ ] 后续阶段不得用 `current_monitor()`、主窗口显示器或主屏覆盖已选目标。
- [ ] 新一代拖动开始后，旧 finalize 结果不得移动窗口或更新前端状态。

### 5.4 持久化保存用户意图，不保存偶然环境

用户意图是“哪块显示器、哪一侧、什么纵向相对位置”，不是某次启动时的绝对像素坐标。

执行约束：

- [ ] 长期位置继续表达为 monitor affinity、`left/right` 和归一化 `anchorY`。
- [ ] 不保存 scale factor 作为显示器身份。
- [ ] 不把绝对 X/Y 当作唯一长期真相。
- [ ] 显示器暂时缺失时允许安全回退，但临时回退不得静默覆盖原 affinity。
- [ ] 只有用户在新目标上完成明确拖动，才更新持久化 affinity。

### 5.5 回归修复必须先证明旧行为，再修改生产代码

“以前是好的”意味着存在一个历史正确输出。若不先把它固化为测试，跨屏修复仍可能再次改变单屏。

执行约束：

- [ ] 先找到最后正常候选版本和首个异常候选版本。
- [ ] 先提取单屏输入输出基线。
- [ ] 先让至少一条新回归测试在当前生产代码上稳定失败。
- [ ] 再修改生产代码。
- [ ] 修复后同时证明新测试转绿、旧测试仍绿、真机行为恢复。

## 6. 当前已知代码事实

- [x] `src-tauri/src/domain/widget.rs` 已定义 `WidgetPhysicalRect`、`WidgetMonitorAffinity`、`WidgetPlacement`、目标显示器选择和 affinity 匹配。
- [x] 当前 `WidgetPlacement` 只表达 `monitor + side + anchorY`，与边缘吸附产品语义一致，不需要引入自由位置模式。
- [x] `src-tauri/src/app/widget.rs::finalize_widget_drag` 当前读取挂件 `outer_position` 和 `outer_size`，枚举显示器并保存位置后重新应用布局。
- [x] `resolve_widget_bounds_from_work_area` 当前负责根据工作区、目标侧、可见宽度和 `anchorY` 计算最终物理边界。
- [x] `src/app/widget/widgetWindowController.ts` 当前拥有拖动 generation、延迟 finalize、重复 moved 合并和 DPI refresh 协调。
- [x] `src-tauri/src/data/repositories/widget_state.rs` 当前把完整 `WidgetPlacement` 作为 `widget_placement` JSON 存入现有设置表。
- [x] Rust 已有负坐标、显示器选择、DPI 矩阵和位置恢复相关测试。
- [x] TypeScript 已有拖动 finalize、竞态和 DPI layout 相关交互测试。
- [x] Windows Tauri runtime smoke 已覆盖 widget command、位置持久化和 main/widget 权限边界的一部分。
- [x] 旧的 `docs/working/widget-cross-monitor-drag-snap-execution-plan.md` 记录了上一轮实现过程；它只能作为历史证据输入，不能覆盖本次新确认的“单屏当前已回归”事实。

## 7. 尚未证明的关键事实

在这些问题得到证据前，不得宣称已知道根因：

- [ ] 最后一个单屏行为正确的确切 commit 或 tag 是哪个。
- [ ] 第一个可稳定复现单屏异常的 commit 或 tag 是哪个。
- [ ] “主屏改坏”具体表现是 X、Y、宽高、可见宽度、展开方向、拖动结束、恢复位置中的哪一项或哪几项。
- [ ] 回归是否只发生在某个 DPI、任务栏位置、窗口复用路径或首次创建路径。
- [ ] 回归是否来自显示器 affinity 优先级、单屏 fallback、物理/逻辑转换、外部/内部尺寸差异或异步竞态。
- [ ] 当前多屏问题是否能由纯领域输入复现，还是只在真实 Tauri/WebView2 事件顺序中出现。
- [ ] 现有自动化为什么没有阻止这次单屏回归：缺输入、断言错误、测试层级错误，还是生产路径未被调用。

## 8. 根因假设与证据排序

以下只是假设，不得直接据此修改代码：

1. 单屏恢复时，保存的 monitor affinity 或 work area 改变了旧 fallback 选择顺序。
2. 窗口首次创建时使用逻辑位置，随后又使用物理位置，导致单屏特定 DPI 下二次换算。
3. `outer_size`、builder `inner_size` 与透明无边框窗口实际尺寸之间出现语义差异。
4. finalize 在保存后强制重新布局，改变了旧版本已经正确的单屏拖动收尾时机。
5. DPI change 和拖动 finalize 的 generation 协调仍存在单屏竞态。
6. 工作区原点或任务栏偏移参与了不正确的 X/Y 计算。
7. 测试只证明纯函数输出，没有证明真实 show/reuse/finalize 路径使用同一数据。

证据优先级从高到低：

1. 同一硬件、同一配置、不同历史 revision 的可重复真实桌面对照；
2. 能稳定红绿切换的自动化回归测试；
3. 带阶段、坐标单位和 monitor identity 的诊断日志；
4. 当前代码静态推理；
5. 提交标题、旧计划描述或人的记忆。

## 9. Owner 与允许修改边界

### 9.1 `src-tauri/src/domain/widget.rs`

允许：

- [ ] 定义与修正纯几何值对象、不变量、目标显示器选择、side/anchor 解析和 affinity 匹配。
- [ ] 添加不依赖 Tauri、SQLite 或 Windows API 的确定性测试。

禁止：

- [ ] 不读取窗口、显示器或数据库。
- [ ] 不引入 Tauri 类型作为领域输入。
- [ ] 不承接异步生命周期编排。

### 9.2 `src-tauri/src/app/widget.rs`

允许：

- [ ] 协调一次 Tauri 窗口/显示器快照、领域计算、存储端口和实际窗口副作用。
- [ ] 保持 show/reuse/finalize/restore 的应用级生命周期顺序。

禁止：

- [ ] 不写 SQL、不获取 SQLite pool、不复制 repository 逻辑。
- [ ] 不沉淀可独立测试的厚几何规则；纯规则应回到 `domain/widget.rs`。
- [ ] 不扩张为所有窗口的通用布局中心。

### 9.3 `src-tauri/src/commands/widget.rs`

- [ ] 只保留命令入口、caller 上下文、DTO/错误转发。
- [ ] 不加入显示器枚举、坐标换算或持久化判断。

### 9.4 `src-tauri/src/data/*widget*`

- [ ] 只负责 `WidgetPlacement` 的原子读写、解析失败回退和必要的旧键清理。
- [ ] 不决定目标显示器、吸附侧或恢复策略。

### 9.5 `src/platform/desktop/widgetRuntimeGateway.ts`

- [ ] 只封装 Tauri IPC、事件和 raw DTO 映射。
- [ ] 不重新实现 Rust 显示器选择或坐标公式。

### 9.6 `src/app/widget/widgetWindowController.ts`

- [ ] 只负责前端拖动生命周期、generation、延迟收尾、重复事件合并和 UI 状态同步。
- [ ] 不枚举显示器、不决定 side/anchor、不持久化第二份位置事实。

### 9.7 明确禁止扩散的区域

- [ ] 不新增 `src/shared/*` widget 几何工具。
- [ ] 不把逻辑放进 `WidgetShell.tsx` 或 CSS。
- [ ] 不修改主窗口位置 owner，除非证据证明挂件回归由主窗口传入的 `preferred_monitor` 契约直接造成；若发生，先修订本文。
- [ ] 不为绕过边界检查器增加目录级 allowlist。
- [ ] 不修改无关 capability、permission、IPC manifest 或 schema 生成物。

## 10. 目标坐标契约

### 10.1 领域输入

一次拖动完成所需最小事实：

```text
window_rect_physical:
  x: i32
  y: i32
  width: u32
  height: u32

monitors_snapshot[]:
  stable_name: Option<String>
  work_area_physical:
    x: i32
    y: i32
    width: u32
    height: u32
  scale_factor: f64   # 只用于选中后的尺寸换算，不参与 identity
```

### 10.2 目标显示器选择

- [ ] 丢弃无效工作区候选：宽或高为零。
- [ ] 优先选择与窗口矩形相交面积最大的显示器。
- [ ] 相交面积并列时，优先包含窗口中心点的显示器。
- [ ] 没有相交时，选择窗口中心到工作区距离最短的显示器。
- [ ] 最终并列使用稳定 key 打破，不依赖枚举顺序。
- [ ] 单显示器输入必须稳定返回唯一有效显示器，不进入多屏特例分支改变计算语义。

### 10.3 吸附侧

- [ ] 使用窗口中心 X 与目标工作区中心 X 比较。
- [ ] 左半区选择 `Left`，右半区选择 `Right`。
- [ ] 正好位于中心线时采用已确认的确定性规则，并通过历史单屏基线决定是否保持当前 `Right` 规则。
- [ ] 不计算“距离虚拟桌面左/右边缘”。
- [ ] 不引入吸附阈值或 `Floating` 状态。

### 10.4 纵向锚点

```text
max_y_offset = max(work_area.height - widget.height, 0)
anchor_y = clamp((window.y - work_area.y) / max_y_offset, 0, 1)
```

- [ ] `anchorY` 必须有限并落在 `[0, 1]`。
- [ ] `max_y_offset = 0` 时明确回退为 `anchorY = 0`。
- [ ] 恢复时只做一次取整，并记录采用的舍入规则。
- [ ] 顶部、底部及偏移工作区均有边界测试。

### 10.5 最终物理边界

- [ ] 使用目标显示器 scale factor 将已确认逻辑尺寸转换为物理尺寸。
- [ ] 左侧 X 只由目标工作区左边缘与半隐藏偏移计算。
- [ ] 右侧 X 只由目标工作区右边缘、窗口物理宽度与半隐藏偏移计算。
- [ ] Y 只由目标工作区原点、可用高度和 `anchorY` 计算。
- [ ] 工作区比挂件小的极端输入仍产生确定、尽可能可见的安全结果。

## 11. 单屏历史基线契约

“恢复以前效果”必须被转成可比较数据，而不是一句人工描述。

### 11.1 必须记录的环境事实

- [ ] Windows 版本与显示缩放设置。
- [ ] 显示器分辨率、工作区矩形和 scale factor。
- [ ] 任务栏位置、自动隐藏状态及其对工作区的影响。
- [ ] Patina revision、构建方式和数据目录是否隔离。
- [ ] 挂件是首次创建、窗口复用还是从 idle park 恢复。

### 11.2 必须采集的行为样本

每个样本记录拖动前矩形、释放矩形、最终矩形、side、anchorY、可见宽度和重启后矩形：

- [ ] 默认右侧位置。
- [ ] 左侧顶部、中部、底部。
- [ ] 右侧顶部、中部、底部。
- [ ] 屏幕中心偏左释放。
- [ ] 屏幕中心偏右释放。
- [ ] 展开后收起。
- [ ] 最小化首次创建挂件。
- [ ] 主窗口恢复后再次最小化并复用挂件。
- [ ] 重启应用后恢复。
- [ ] DPI 变化后恢复。

### 11.3 基线判定规则

- [ ] 至少一个历史 revision 在同一环境中全部符合用户确认的正确观感。
- [ ] 当前 revision 在同一环境中至少一项稳定偏离。
- [ ] 两者差异能转成数值或状态断言。
- [ ] 若无法找到单一“最后正常 revision”，按行为维度分别确定基线，不强行制造一个错误的统一节点。
- [ ] 最终将基线输入输出固化进 Rust 单元测试、TypeScript controller 测试或 runtime smoke 中合适的层级。

## 12. 恢复与持久化契约

### 12.1 保存

- [ ] finalize 生成一个规范化 `WidgetPlacement`。
- [ ] 保存值与实际应用布局使用同一个 placement。
- [ ] 保存失败时不得报告成功，也不得让前端接受未持久化位置为最终事实。
- [ ] 实际移动失败与保存失败使用不同阶段错误，便于诊断。

### 12.2 启动恢复

- [ ] 先加载并规范化保存值。
- [ ] 有 monitor affinity 时，先按稳定名称匹配；同名候选使用几何消歧。
- [ ] 名称失效时使用保存工作区几何选择最接近候选。
- [ ] 无有效 affinity 时，按明确的 preferred/current/main/primary 规则选择安全显示器。
- [ ] 单屏时所有合法保存值最终映射到唯一屏幕，但 side/anchor 不应被无故重写。

### 12.3 缺屏与拓扑变化

- [ ] 保存目标缺失时，临时落到安全可见显示器。
- [ ] 临时回退不自动保存，从而保留原 affinity 意图。
- [ ] 原目标恢复后，可以再次匹配并恢复。
- [ ] 用户在回退屏幕上完成新拖动后，才更新 affinity。
- [ ] 分辨率、工作区和 DPI 变化后使用当前目标工作区重新计算，而不复用旧绝对边界。

## 13. 前端拖动与竞态契约

- [ ] `beginUserDrag` 递增 generation，并取消旧的待处理 finalize。
- [ ] `endUserDrag` 只请求当前 generation 的 finalize。
- [ ] 尾部 moved 事件只延后或合并当前 finalize，不产生第二套位置计算。
- [ ] 同一 generation 同时只有一个 in-flight finalize。
- [ ] 新 generation 开始后旧结果不能更新 placement、触发视觉 settled 或移动窗口。
- [ ] expanded、hidden、disposed 状态下不错误 finalize。
- [ ] DPI change 在拖动或 finalize 中只标记 pending，待安全时机重新应用当前布局。
- [ ] runtime layout 触发的 moved 事件不会被误认为用户拖动。
- [ ] 所有 timer 在 dispose、隐藏和 generation 切换路径清理。

## 14. 范围与非目标

### 14.1 本次范围

- [ ] 单显示器主屏当前回归的定位与修复。
- [ ] 多显示器最终目标选择与真实边缘吸附。
- [ ] 负坐标、混合 DPI、任务栏工作区和拓扑变化。
- [ ] 位置持久化、恢复和临时缺屏回退。
- [ ] 拖动 finalize 与 DPI/moved 竞态。
- [ ] 与风险匹配的 Rust、TypeScript、browser/runtime 和真机验证。

### 14.2 非目标

- [ ] 不新增自由漂浮位置、吸附阈值或任意 X/Y 持久化。
- [ ] 不改变挂件视觉尺寸；若证据证明当前尺寸常量本身被误改，只恢复历史正确值，不做新设计。
- [ ] 不改变信息模块、计时器、番茄钟、状态灯或文案。
- [ ] 不建立通用多显示器窗口布局框架。
- [ ] 不调整主窗口的恢复、最大化或多屏行为。
- [ ] 不借机重命名或迁移无关 widget 模块。
- [ ] 不修改 release、版本号或 changelog，除非后续收到独立发布授权。

## 15. 预计文件范围

### 15.1 高概率修改

- [ ] `src-tauri/src/domain/widget.rs`：纯几何、不变量及回归测试。
- [ ] `src-tauri/src/app/widget.rs`：Tauri 窗口/显示器快照和布局事务。
- [ ] `src/app/widget/widgetWindowController.ts`：仅在竞态证据命中时调整。
- [ ] `tests/interactionFlows.test.ts`：controller 拖动、DPI 与 stale result 回归。
- [ ] `tests/tauriRuntimeSmoke.test.ts`：真实 command、落盘和窗口 runtime 证据。

### 15.2 证据命中后才允许修改

- [ ] `src-tauri/src/data/repositories/widget_state.rs`：仅当持久化/恢复是根因。
- [ ] `src-tauri/src/engine/widget.rs`：仅当现有存储端口语义不足，且仍保持薄。
- [ ] `src-tauri/src/commands/widget.rs`：仅当 DTO 或错误上下文需要修正。
- [ ] `src/platform/desktop/widgetRuntimeGateway.ts`：仅当 raw DTO 映射或 IPC 结果解析有问题。
- [ ] `src/app/widget/useWidgetWindowState.ts`：仅当 hook 接线或 lifecycle 造成回归。
- [ ] `src-tauri/src/app/main_window.rs`：仅当 `preferred_monitor` 传递被证据证明是根因，并先重新做 owner 判断。

### 15.3 默认不修改

- [ ] `src/app/widget/WidgetShell.tsx`。
- [ ] Widget CSS 与 Quiet Pro token。
- [ ] `src/shared/*`。
- [ ] 主窗口 capability 与无关 command manifest。
- [ ] 数据库 schema migration。

## 16. 阶段 0：启动与基线保护

### 16.1 Project 与工作区

- [ ] 维护者将事项 `Next → In progress`。
- [ ] 重新读取 live Project，确认 `In progress` 最多一个，并重新计算最多三个 `Next` 的补位建议。
- [ ] 运行 `git status --short`，记录并保护所有既有用户修改。
- [ ] 运行 `git diff --check`，确认基线无空白错误。
- [ ] 记录当前 `HEAD`、tag、Node、npm、Rust 和 Windows 环境。

### 16.2 当前门禁基线

- [ ] 运行 `npm run test:widget`。
- [ ] 运行 `npm run test:interaction`。
- [ ] 运行 `npm run check:rust`。
- [ ] 若环境允许，运行 `npm run test:tauri-runtime-smoke`。
- [ ] 记录所有既有失败并区分环境失败与产品失败。

### 16.3 文档卫生

- [ ] 核对旧 `docs/working/widget-cross-monitor-drag-snap-execution-plan.md` 是否仍有未完成的真实硬件门槛。
- [ ] 若旧计划已停止作为执行依据，将其移入 `docs/archive/`；若仍保留未完成证据，在旧文档顶部明确它只记录上一轮实现，当前执行以本文为准。

### 16.4 退出条件

- [ ] Project、工作树、工具链和测试基线均已记录。
- [ ] 没有与本次预计文件范围冲突的未知用户修改。
- [ ] 当前事项尚未修改生产代码。

## 17. 阶段 1：复现并确定最后正常基线

### 17.1 把“改坏”转成现象表

- [ ] 在当前 revision 单屏环境逐项执行第 11.2 节样本。
- [ ] 为每个异常记录期望、实际、误差、触发次数和是否稳定复现。
- [ ] 判断异常发生在首次创建、窗口复用、拖动 finalize、展开/收起还是重启恢复。
- [ ] 判断异常是否与 DPI、任务栏或已有 `widget_placement` 数据相关。
- [ ] 使用隔离数据目录对比“全新配置”和“升级后已有配置”。

### 17.2 缩小历史范围

优先审查但不预设有罪的候选提交：

- `4e14a57`：DPI layout 与 minimize handoff；
- `abb899e`：DPI matrix 测试；
- `90215fd`：monitor-aware placement；
- `a452a01`：单一目标显示器 finalize；
- `1c0fe83`：Rust-owned drag finalization。

执行步骤：

- [ ] 读取这些提交的 diff，列出它们分别改变了哪些单屏可观察结果。
- [ ] 在安全的临时 worktree 或等价隔离环境构建候选 revision，不修改当前工作树。
- [ ] 使用同一显示器、DPI、任务栏和数据 fixture 对候选 revision 重复测试。
- [ ] 找到“最后正常 / 首个异常”相邻范围；若无法二分，记录无法二分的原因。
- [ ] 不执行破坏当前工作树的 `git reset --hard` 或覆盖式 checkout。

### 17.3 增加诊断可观测性

仅在现有日志不足时：

- [ ] 为 debug/test 路径记录 finalize generation。
- [ ] 记录最终 window physical rect。
- [ ] 记录一次 monitors snapshot 的 name、work area 和 scale factor。
- [ ] 记录选中目标及选择理由。
- [ ] 记录 placement、最终 physical bounds 和 save/apply 阶段。
- [ ] 日志不包含用户内容、窗口标题或无关隐私数据。
- [ ] 临时诊断在完成根因定位后删除或收敛为可维护的 debug 日志。

### 17.4 退出条件

- [ ] 当前单屏异常至少有一条稳定复现路径。
- [ ] 最后正常输出已量化，或已明确分维度建立基线。
- [ ] 根因范围缩小到一个 owner 或一条跨 owner 契约。
- [ ] 已能解释为什么现有测试未阻止回归。

## 18. 阶段 2：先写失败测试

### 18.1 单屏历史 golden 测试

- [ ] 为最后正常版本的逻辑尺寸到物理尺寸映射建立固定输入输出。
- [ ] 为左/右 collapsed bounds 建立固定输入输出。
- [ ] 为 left/right/top/bottom taskbar 工作区建立输入输出。
- [ ] 为 100%、125%、150%、200% DPI 建立矩阵。
- [ ] 为中心偏左/偏右释放后的 side 与 anchor 建立输入输出。
- [ ] 为首次创建与窗口复用分别覆盖最终边界。
- [ ] 至少一条测试在修改生产代码前因当前回归稳定失败。

### 18.2 多屏领域测试

- [ ] 副屏位于主屏右侧。
- [ ] 副屏位于主屏左侧且 X 为负。
- [ ] 副屏位于主屏上方且 Y 为负。
- [ ] 副屏位于主屏下方。
- [ ] 窗口跨越屏幕边界时按最大相交面积选择。
- [ ] 窗口中心位于候选工作区时正确消歧。
- [ ] 窗口位于屏幕间隙时选择最近工作区。
- [ ] 枚举顺序反转时选择结果不变。
- [ ] 单屏矩阵结果与多屏算法退化到单候选时完全一致。

### 18.3 finalize 事务测试

- [ ] 读取最终矩形后只枚举一次显示器。
- [ ] 保存与 apply 使用同一目标显示器和 placement。
- [ ] 不调用主窗口或主屏覆盖已选目标。
- [ ] 保存失败不继续移动并返回阶段错误。
- [ ] apply 失败保留可诊断状态并不报告成功。

### 18.4 前端竞态测试

- [ ] release 后多个 moved 事件只形成一个有效 finalize。
- [ ] 新 generation 使旧结果失效。
- [ ] DPI change 不打断正在进行的 finalize。
- [ ] runtime layout moved 不触发用户拖动 finalize。
- [ ] hidden/disposed 路径清理 timer 和结果更新。

### 18.5 退出条件

- [ ] 新测试分别保护单屏历史行为、多屏目标选择和竞态，不在多个层重复断言同一事实。
- [ ] 至少一条生产回归测试当前为红。
- [ ] 测试失败原因指向真实生产行为，不是错误 fixture 或未接入的孤儿测试。
- [ ] 新测试已接入现有 `test:widget`、`test:interaction`、Rust 测试或 runtime smoke 执行图。

## 19. 阶段 3：最小实现

### 19.1 修正纯领域规则

- [ ] 只修改已被失败测试命中的几何或不变量。
- [ ] 保持 `WidgetPlacement = monitor + side + anchorY`，除非证据证明现有字段无法表达已确认产品契约。
- [ ] 确保单屏输入是多屏算法的自然单候选情形，而不是另造一套长期公式。
- [ ] 若为了保护历史行为需要单屏兼容分支，写明触发条件、必要性和未来是否退出，避免隐式永久特例。

### 19.2 修正 Tauri 应用协调

- [ ] 在 finalize 事务内冻结窗口矩形和显示器快照。
- [ ] 选定目标后不重新查询其他 monitor source 覆盖它。
- [ ] 首次创建与窗口复用最终都通过同一物理 bounds 应用函数收敛。
- [ ] builder 的逻辑位置只用于不可见创建初值；最终可见边界以明确 physical bounds 为准。
- [ ] 检查 set size / set position 顺序是否造成可见中间帧或错误 moved 事件。

### 19.3 修正恢复与持久化

- [ ] 只有证据命中时修改 repository 或恢复优先级。
- [ ] 保留已发布 `widget_placement` JSON 的读取能力和非法值安全默认。
- [ ] 不为本次修复新增数据库 migration。
- [ ] 临时缺屏回退不覆盖 affinity。

### 19.4 修正前端生命周期

- [ ] 只有竞态测试命中时修改 controller。
- [ ] 保持前端不拥有显示器几何和最终 side/anchor 决策。
- [ ] 保持 gateway 只做 IPC 和 DTO 映射。
- [ ] 不为修位置改变 WidgetShell UI。

### 19.5 退出条件

- [ ] 阶段 2 的失败测试全部转绿。
- [ ] 没有新增自由漂浮、第二套坐标模型或无 owner helper。
- [ ] 生产改动限制在证据命中的最小 owner 集合。
- [ ] `commands/*`、`app/*`、`shared/*` 和 `platform/*` 未无理由变厚。

## 20. 阶段 4：验证矩阵

### 20.1 快速专项验证

- [x] `npm run test:widget`
- [x] `npm run test:interaction`
- [x] 运行命中的 Rust widget 测试；最终 `check:full` 中 Rust 522 passed、1 ignored。
- [x] `git diff --check`

### 20.2 默认与完整门禁

- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run build`
- [x] `npm run check`
- [x] `npm run check:full`
- [x] `npm run test:tauri-runtime-smoke`

说明：

- `npm run check` 是默认前端、测试、browser 和 bundle 门禁。
- 本次触及 Rust 核心窗口行为、持久化和真实 Tauri runtime，因此交付前必须执行 `check:full` 与 `test:tauri-runtime-smoke`。
- 不以 browser stub 代替真实 Tauri/WebView2 窗口证据。

### 20.3 自动化场景矩阵

| 场景 | 100% | 125% | 150% | 200% | 必须证明 |
|---|---:|---:|---:|---:|---|
| 单屏首次创建 | [ ] | [ ] | [ ] | [ ] | 历史正确尺寸与默认边缘 |
| 单屏左侧拖动 | [ ] | [ ] | [ ] | [ ] | 正确 side、anchor、半隐藏 |
| 单屏右侧拖动 | [ ] | [ ] | [ ] | [ ] | 正确 side、anchor、半隐藏 |
| 单屏重启恢复 | [ ] | [ ] | [ ] | [ ] | 与保存位置一致且可见 |
| 同 DPI 双屏双向拖动 | [ ] | [ ] | [ ] | [ ] | 不回弹、不跳屏 |
| 混合 DPI A → B | [ ] | [ ] | [ ] | [ ] | 使用 B 的工作区与 DPI |
| 混合 DPI B → A | [ ] | [ ] | [ ] | [ ] | 使用 A 的工作区与 DPI |
| 负 X 副屏 | [ ] | [ ] | [ ] | [ ] | 不钳制为零、不回主屏 |
| 负 Y 副屏 | [ ] | [ ] | [ ] | [ ] | 目标和纵向锚点正确 |
| 目标屏断开 | [ ] | [ ] | [ ] | [ ] | 安全回退且不覆盖 affinity |

### 20.4 真实 Windows 单屏验收

- [ ] 使用用户实际出现回归的主屏环境。
- [ ] 与阶段 1 确认的最后正常版本逐项对照。
- [ ] 验证首次创建、窗口复用、拖动、展开/收起和重启。
- [ ] 验证当前已有数据与全新数据目录。
- [ ] 记录最终结论和必要截图/日志路径。

### 20.5 真实 Windows 多屏验收

- [ ] 主屏 → 副屏。
- [ ] 副屏 → 主屏。
- [ ] 副屏在左侧的负坐标布局。
- [ ] 同 DPI 双屏。
- [ ] 至少一组混合 DPI 双屏。
- [ ] 每块屏幕左侧和右侧。
- [ ] 屏幕中心释放后吸附到该目标屏最近真实边缘。
- [ ] 重启恢复。
- [ ] 断开目标屏后安全回退；重新连接后行为符合 affinity 契约。

### 20.6 退出条件

- [ ] 所有必需命令通过，失败项有明确根因且已修复。
- [ ] 单屏真机恢复到最后正常行为。
- [ ] 多屏真机不存在回弹、跳屏或虚拟边缘。
- [ ] 无现有挂件交互回归。

## 21. 必须停止并重新评估的条件

出现任一项时，停止编码并修订 Project/执行单：

- [ ] 实际需求需要自由漂浮或任意 X/Y 持久化。
- [ ] 必须改变 `WidgetPlacement` 的长期产品语义才能修复。
- [ ] 必须新增通用窗口/显示器 platform 抽象，但当前只有 Widget 一个真实消费者。
- [ ] 必须让前端直接枚举显示器或决定最终吸附。
- [ ] 必须让 `commands/*`、`lib.rs` 或 `shared/*` 承接厚逻辑。
- [ ] 必须修改主窗口多屏行为。
- [ ] 必须新增数据库 schema migration 或新旧位置双写。
- [ ] 最后正常基线无法在任何历史 revision 重现，且用户期望无法量化。
- [ ] 自动化与真机结果相互矛盾，尚未解释差异。
- [ ] 预计修改超过 25 个文件或 1,000 行手工维护内容，且无法按 owner 拆分。

## 22. 对抗式完成复核

### 22.1 产品语义

- [ ] 单屏确实恢复“改坏前”的效果，而不是把当前错误重新定义为正确。
- [ ] 多屏仍是边缘吸附，不存在自由漂浮路径。
- [ ] 中间释放仍吸附到最终目标显示器最近的真实边缘。
- [ ] 半隐藏只发生在真实工作区边缘。

### 22.2 坐标正确性

- [ ] 目标选择全程使用同一份物理坐标快照。
- [ ] DPI 只在目标选定后参与尺寸转换。
- [ ] 负坐标未被错误钳制。
- [ ] 任务栏工作区偏移已覆盖。
- [ ] 单屏是多屏算法的正确退化结果。

### 22.3 生命周期与数据

- [ ] finalize 只选择一次目标并只保存一次。
- [ ] 旧 generation 不覆盖新拖动。
- [ ] 临时缺屏回退不覆盖 affinity。
- [ ] 已有 `widget_placement` 数据可读取并安全规范化。
- [ ] 错误路径不报告假成功。

### 22.4 架构

- [ ] 纯规则留在 domain。
- [ ] Tauri 副作用协调留在 app。
- [ ] command 仍然薄。
- [ ] SQL 仍然只在 data。
- [ ] 前端 gateway/controller 没有复制 Rust 几何事实。
- [ ] 没有新增共享垃圾桶、临时 facade 或无退出条件兼容壳。

### 22.5 测试质量

- [x] 新测试能在回归代码上失败：native/DOM 分裂与初始化乱序均已观察到确定红灯。
- [x] 每层测试保护不同失败模式：controller 保护状态顺序，runtime smoke 保护真实原生边缘与可见 DOM 几何。
- [x] 测试进入现有执行图，没有孤儿入口或重复 owner。
- [x] 没有用固定 sleep 掩盖事件竞态；runtime 以状态条件等待，controller 用可控 Promise 复现乱序。
- [x] runtime smoke 和真机证据没有被纯函数测试替代。

## 23. 完成、Project 状态与归档

- [x] 汇总实现文件、关键决策、测试命令和真机矩阵结果。
- [x] 运行 `git status --short`、`git diff --stat` 与 `git diff --check`，确认没有无关改动。
- [ ] 如需提交，按 owner/行为拆成可审查 commit，并在提交前检查 staged stat 与 numstat。
- [x] 未收到当前任务明确 push 授权，未推送远端。
- [x] 实现与全部相应验证完成后，告诉维护者将对应事项 `In progress → Done`。
- [x] 已重新计算最多三个 `Next`：当前只有两个 `Next` 且没有 `Queued` 候选，因此没有可执行的补位拖动。
- [ ] 维护者完成拖动后，重新读取 live Project 验证。
- [x] 将本文从 `docs/working/` 移入 `docs/archive/`。
- [x] 本次只恢复既有行为并补齐联合不变量，没有把一次性细节散入长期文档。

## 24. 最终完成定义

只有同时满足以下条件，事项才算完成：

- [ ] 已用证据确定并固化最后正常的单屏行为。
- [ ] 当前单屏主屏回归已在用户实际环境恢复。
- [ ] 多屏双向拖动使用最终目标显示器的真实工作区和 DPI。
- [ ] 不再出现回弹、跳屏或虚拟边缘。
- [ ] 负坐标、混合 DPI、任务栏工作区、重启和缺屏回退均有证据。
- [ ] 快速测试、默认门禁、完整 Rust 门禁和 Tauri runtime smoke 全部通过。
- [ ] 必要的单屏与多屏真机验收通过。
- [ ] owner 边界未回流，未引入自由漂浮或无关重构。
- [ ] live Project 已由维护者拖到 `Done` 并重新核对。
- [x] 执行单已归档。
