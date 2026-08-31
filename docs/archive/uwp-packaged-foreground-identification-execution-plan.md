# UWP 与具有包身份的前台应用识别执行方案

> Status: Archived
> Created: 2026-08-31
> Last updated: 2026-08-31
> Execution owner: 获得 Issue #75 实施授权的 Patina 维护者或协作者
> Related: [Ceceliaee/patina#75](https://github.com/Ceceliaee/patina/issues/75)
> Long-term owners affected: [`product-principles-and-scope.md`](../product-principles-and-scope.md), [`architecture.md`](../architecture.md), [`engineering-quality.md`](../engineering-quality.md), [`issue-fix-boundary-guardrails.md`](../issue-fix-boundary-guardrails.md)

## 0. 文档定位与使用方式

本文曾是 Issue #75 的一次性工作执行依据，完成后已归档到 `docs/archive/`。它不替代产品、架构、工程质量或 GitHub Project 的长期规则，也不保存私有 Project 的条目、字段、排序或截图。

执行者应按阶段推进。每个复选框只有在对应证据真实存在后才能勾选；自动化检查未运行、实机环境不可用或观察结果不一致时，应记录为未验证、偏差或阻塞，不能按预期结果勾选。

- [x] 实施开始前重新读取已登录会话中的 live GitHub Project，并只在协作中报告状态建议，不把 live 字段或排序复制进本文。
- [x] 实施开始前重新读取 Issue #75 的最新正文和评论，确认公开问题范围没有变化。
- [x] 实施开始前确认当前任务已经明确授权代码修改；本文本身不授权 commit、push、Issue、Project、tag 或 release 操作。
- [x] 每完成一个阶段，先记录证据、偏差和残余风险，再开始下一阶段。
- [x] 完成后把长期结论更新到真实 active owner，并将本文移动到 `docs/archive/`。

## 1. 决策与第一性原理

### 1.1 用户问题

Patina 的核心承诺是自动记录用户实际参与的桌面应用。对于由 Windows 系统宿主承载窗口的 UWP 或其他具有包身份的应用，当前实现可能把最外层窗口归属到 `ApplicationFrameHost.exe`，随后将其作为系统宿主过滤。结果是用户实际使用的 Microsoft Store、照片或其他应用没有形成可信记录。

这个问题不能通过删除宿主过滤、增加应用白名单或继续猜测文件路径解决。正确实现必须先回答“用户当前操作的是哪个应用”，再回答“这个应用怎样显示名称和图标”。

### 1.2 最小稳定事实

1. **追踪对象是用户面对的应用，不是 Windows 的窗口基础设施。** `ApplicationFrameHost.exe` 可以参与显示应用窗口，但不能因此成为统计主体。
2. **覆盖率不能高于正确性。** 无法唯一确定真实应用时应保持不记录，不能把多个应用或系统表面归到同一宿主。
3. **应用身份与应用呈现是两个契约。** PID、exe、AUMID 用于识别；显示名称和图标用于呈现。两者必须指向同一应用，但一次图标读取失败不能把正确身份改回宿主。
4. **UWP 没有可用于运行时识别的专属后缀。** `.appx`、`.msix` 是包格式，运行进程仍可能是 `.exe`；实现必须读取 Windows 提供的包身份或 AUMID。
5. **现有正确行为是受保护基线。** 非宿主窗口必须继续走当前路径；新逻辑只能在明确命中宿主边界时介入。
6. **失败必须局部、可解释、可恢复。** 权限不足、进程退出、候选冲突或 Shell 图标失败不得阻塞 tracking 主循环，也不得污染持久化数据。
7. **平台事实由平台 owner 提供。** Windows HWND、PID、AUMID、Shell item、HICON/HBITMAP 和 COM 生命周期属于 `src-tauri/src/platform/windows/*`；领域层只消费归一化结果。

### 1.3 可观察完成结果

- [x] Microsoft Store 在前台时形成真实应用记录，持久化身份不是 `ApplicationFrameHost.exe`。
- [x] Microsoft Store 显示系统提供的本地化名称和正确商店图标，不显示宿主名称、宿主图标或永久空图标。
- [x] 至少两个其他代表性包应用能以各自真实身份稳定记录。
- [x] 开始菜单、搜索、锁屏、桌面和其他系统表面仍不形成错误应用记录。
- [x] 普通 Win32、Explorer、现有可追踪终端和已经正常工作的包应用保持原有追踪、切换、标题和图标行为。
- [x] UWP/包应用与 Win32 应用往返切换时，session 边界正确，没有串记、重复短 session 或宿主记录。
- [x] 实现不在前台采样热路径执行可能阻塞的 Shell 图标提取。

## 2. 术语与边界

| 术语 | 本文含义 | 不代表 |
| --- | --- | --- |
| UWP | 使用 Universal Windows Platform 应用模型的 Windows 应用 | 一种文件后缀 |
| 具有包身份的应用 | Windows 可通过 package identity/AUMID 区分的应用；可包含 UWP 或已打包桌面应用 | 所有 Microsoft Store 分发应用都是 UWP |
| AUMID | Application User Model ID，Windows 用于区分具体应用的稳定身份 | exe 路径、显示名称或版本号 |
| 宿主窗口 | 由 `ApplicationFrameHost.exe` 等系统进程拥有的外层窗口 | 用户实际使用的应用本身 |
| 内容窗口 | 宿主窗口层级中由真实应用进程拥有的窗口 | 必然具有固定窗口类名 |
| 失败关闭 | 不能唯一、可信解析时维持当前不追踪行为 | 静默把宿主当应用记录 |

- [x] 实现和测试使用“packaged app”“hosted foreground app”“AUMID”等真实语义命名，不新增 `UwpV2`、`NewUwpResolver` 或类似新旧标记。
- [x] 实现不以 `.exe` 名称、窗口标题、商店品牌词或单个窗口类名作为足以确认身份的唯一证据。
- [x] Issue 标题中的“支持 UWP”在验收中解释为“支持能由受支持 Windows API 唯一解析的具有包身份前台应用”，不宣称覆盖所有 Microsoft Store 分发模型。

## 3. 当前证据

### 3.1 已由当前代码确认

- [x] [`foreground.rs`](../../src-tauri/src/platform/windows/foreground.rs) 先调用 `GetForegroundWindow`，再通过 `GA_ROOTOWNER` 找最外层窗口，并从 root owner 读取 PID、exe 和路径。
- [x] [`process_filters.rs`](../../src-tauri/src/domain/tracking/process_filters.rs) 明确排除 `applicationframehost.exe`。
- [x] [`session_identity.rs`](../../src-tauri/src/domain/tracking/session_identity.rs) 当前以 `exe_name` 作为 app key，并以 PID、root HWND 和窗口类组成 instance key。
- [x] [`active_session.rs`](../../src-tauri/src/engine/tracking/active_session.rs) 先创建 session，再异步触发名称和图标处理；图标失败不是当前不创建 session 的直接原因。
- [x] [`app_metadata.rs`](../../src-tauri/src/platform/windows/app_metadata.rs) 当前按“exe 文件图标，再窗口图标”的顺序获取图标，没有 AUMID/Shell AppsFolder 图标来源。
- [x] [`metadata.rs`](../../src-tauri/src/engine/tracking/metadata.rs) 的持久化图标缓存以 `exe_name` 为 key，另有一小时的内存负缓存。
- [x] [`icon.rs`](../../src-tauri/src/platform/windows/icon.rs) 已拥有 HICON、GDI bitmap、DC 的 RAII 资源管理和 PNG data URI 转换能力，可作为 Shell bitmap 转换的最近 owner。
- [x] 当前 `windows = 0.62.2` 已启用 Shell、PropertiesSystem、COM 和 GDI 相关 feature，但尚未启用 `Win32_Storage_Packaging_Appx`。
- [x] 当前 `windows` crate 绑定包含 `GetApplicationUserModelId`、`SHCreateItemInKnownFolder`、`FOLDERID_AppsFolder`、`IShellItemImageFactory` 和 `SHGetPropertyStoreForWindow`。
- [x] 当前前台识别路径没有调用 `GetApplicationUserModelId`、没有枚举宿主后代窗口，也没有将 AUMID 用作前台应用归属证据。

### 3.2 已由 Git 历史确认

- [x] `e33f684` 将 `ApplicationFrameHost.exe` 与其他 Windows 系统宿主一起加入过滤，目的是阻止系统表面进入统计。
- [x] `3cb618f` 增加了 `%LOCALAPPDATA%\Microsoft\WindowsApps\<exe>` 执行别名 fallback，注释明确提到 Photos 和 Store 类应用。
- [x] `3cb618f` 的调用方只在 `process_path` 非空时调用图标函数，因此“空路径时寻找 WindowsApps 别名”的 fallback 当时不可达。
- [x] 当时的图标实现最终仍调用 `ExtractIconExW`，没有从包身份或 Windows Shell 应用项读取图标。

### 3.3 外部 API 依据

- [x] [`GetApplicationUserModelId`](https://learn.microsoft.com/en-us/windows/win32/api/appmodel/nf-appmodel-getapplicationusermodelid) 可从具有 `PROCESS_QUERY_LIMITED_INFORMATION` 权限的进程句柄读取 AUMID，并明确返回“无应用身份”和“缓冲区不足”等状态。
- [x] [`SHGetPropertyStoreForWindow`](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shgetpropertystoreforwindow) 可读取窗口属性集合；`System.AppUserModel.ID` 是窗口关联应用身份的候选证据。
- [x] [`IShellItemImageFactory`](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nn-shobjidl_core-ishellitemimagefactory) 可为 Shell item 返回图标或缩略图；官方说明提取可能耗时，不应放在 UI 或高频关键线程上。
- [x] [`Package identity overview`](https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/package-identity-overview) 将 AUMID 定义为包内具体应用身份，并说明 Windows 用它关联窗口、进程和资源。

### 3.4 实施后证据边界

- [x] 已在 Windows 11 24H2 标准用户环境记录 Microsoft Store 前台窗口、root owner、后代窗口、PID、exe 和 AUMID 的实际关系；Windows 10 环境不可用，保留为未验证风险。
- [x] 证明仅使用宿主窗口后代 PID + `GetApplicationUserModelId` 就能唯一解析代表性应用；若不能，再评估窗口 property store。
- [x] 证明 `FOLDERID_AppsFolder + AUMID` 可以在目标环境稳定取得正确本地化名称和图标。
- [x] 在本次支持矩阵中，Store、计算器与照片的 AUMID/真实 exe 未出现需要改变现有持久化 key 的冲突；不同 AUMID 同窗树按 `Ambiguous` 失败关闭。
- [x] Windows 11 已证明同一规则可用；Windows 10 未宣称实机通过，兼容性依据公开 Win32 API 契约和相同失败关闭路径，仍需后续环境验证。
- [x] 证明新增身份探测不会让普通前台采样、tracking 轮询或资源使用发生可感知回归。

### 3.5 规划阶段验证状态

- [x] 相关 active owner、当前实现、Git 历史、依赖 feature 和 `package.json` 验证入口已检查。
- [x] 已在本次规划会话中读取 authenticated live Project；本文未复制其中的条目字段、状态、排序或截图。
- [x] 本轮只创建执行计划，未运行实现级 Rust、桌面 runtime 或实机 UWP 验证；这些检查属于后续阶段。

## 4. 范围

### 4.1 In scope

- 只在前台 root owner 被识别为 `ApplicationFrameHost.exe` 时，解析真实的具有包身份应用。
- 通过窗口层级、候选 PID 和 AUMID 建立可信应用归属。
- 将解析后的真实 PID、exe 和路径投影回现有 `WindowInfo` 追踪链。
- 通过 AUMID 对应的 Windows Shell 应用项获取本地化显示名称和正确图标。
- 为候选选择、失败关闭、session 切换、缓存、资源释放和普通应用不变性补充测试。
- 在隔离的 Patina Dev 身份中完成 Windows 实机验收。
- 在实现完成后更新 `CHANGELOG.md` 的 `Unreleased / Fixed`，是否进入具体 release 由后续发布范围决定。

### 4.2 Out of scope

- 不删除或放宽 `ApplicationFrameHost.exe`、开始菜单、搜索、锁屏及其他系统宿主过滤。
- 不增加 Microsoft Store、照片、计算器等应用白名单。
- 不通过窗口标题、产品品牌词或不稳定的窗口类名猜测应用。
- 不增加 Microsoft Store 应用安装、启动、管理或扫描功能。
- 不把所有 `.appx`、`.msix` 或 Microsoft Store 分发应用都声明为 UWP。
- 不新增前端设置、开关、提示、分类规则或可见 UI。
- 不改变标题隐私、AFK、锁屏、睡眠、持续参与或用户排除规则。
- 第一阶段不改变 session schema、backup payload、restore、export 或前端 icon lookup 契约。
- 不把实验日志、窗口标题、路径清单、截图、GIF、视频或实机 evidence media 提交到仓库。
- 不创建兼容壳、平行 `V2` 实现或通用 Windows 应用框架。
- 不自动 commit、push、修改 Issue/Project、创建 tag 或发布版本。

- [x] 每个拟修改文件都能映射到本节的必要结果。
- [x] 调查发现必须改变 schema、备份/恢复、IPC shape 或用户可见 UI 时停止执行，先更新范围和取得明确确认。

## 5. 受保护不变量与 owner

| 结果 | Owner | 必须保持的不变量 | 保护证据 |
| --- | --- | --- | --- |
| 原始前台 HWND、root owner、PID 和进程路径 | `platform/windows/foreground.rs` | 非宿主路径结果不变；无效窗口继续返回 inactive | 纯函数测试、现有 foreground 测试、Win32 实机矩阵 |
| 宿主后代窗口与 AUMID 解析 | 建议新增窄模块 `platform/windows/packaged_app.rs` | 只报告平台事实；零候选或多身份候选失败关闭 | 候选选择单元测试、Windows 实机探针 |
| 系统宿主与可追踪应用判断 | `domain/tracking/process_filters.rs`、`session_identity.rs` | `ApplicationFrameHost.exe` 继续不可追踪；领域层不调用 Windows API | 过滤和 session identity 测试 |
| session 开始、结束和元数据刷新 | `engine/tracking/*` | app key 相同不重复切 session；真实应用切换形成正确边界 | transition、continuity、runtime 测试 |
| 包应用显示名称 | `platform/windows/app_metadata.rs` | Shell 名称、文件版本名称和 exe fallback 顺序明确且可测 | 选择顺序测试、实机本地化验证 |
| 包应用图标与 GDI 转换 | `platform/windows/app_metadata.rs`、`icon.rs` | 不把宿主图标写给真实应用；所有 HICON/HBITMAP/DC/COM 资源释放 | 图标选择测试、RAII、重复实机循环 |
| 异步元数据编排 | `engine/tracking/metadata.rs` | 慢 Shell 操作不在前台采样热路径；并发和缓存有界 | cache/in-flight 测试、延迟测量 |
| 持久化 icon cache | `data/repositories/icon_cache.rs` 和现有 schema owner | 无身份冲突时继续按真实 exe key；不能把 AUMID 偷塞进 exe 字段 | 冲突调查、repository 测试 |
| 前端与 Widget 消费 | 现有 IPC/读模型 owner | 第一阶段不要求新增字段，现有消费者无需修改 | IPC shape diff、现有前端测试 |

- [x] 实施前逐项确认 owner，没有把平台解析放进 `engine/*`、`domain/*`、`commands/*` 或 `lib.rs`。
- [x] 如新增 `packaged_app.rs`，其公开面只暴露最小平台事实，不反向依赖 engine、domain、data 或 app。
- [x] 不为测试方便建立生产级 trait/facade；优先把候选选择提取为模块内纯函数，并用结构化输入测试。

## 6. 实施前决策门

### Gate A — 身份可解析性

通过条件：代表性宿主窗口可从其窗口层级中找到至少一个非宿主 PID，并能得到唯一、与该窗口树一致的 AUMID 和真实 exe。

- [x] Microsoft Store 通过 Gate A。
- [x] 至少两个其他代表性包应用通过 Gate A。
- [x] 开始菜单、搜索等系统表面不会产生可接受的真实应用候选。
- [x] 零候选、多 AUMID 候选、进程退出和权限不足均有明确失败结果。

未通过时：保持现有过滤，将计划标记 `Blocked`；不得通过白名单或标题猜测绕过。

### Gate B — 持久化身份模型

通过条件：测试矩阵中每个需要独立统计和图标的 AUMID 都能稳定映射到唯一真实 exe，且同一 exe 不代表多个需要区分的应用。

- [x] 记录测试矩阵的 `AUMID → exe` 关系，只保存应用身份证据，不保存私有窗口标题。
- [x] 检查同包多应用、同 exe 多 AUMID 和多实例行为。
- [x] 确认继续以真实 exe 作为 session/icon key 不会发生可观察冲突。

未通过时：停止第一阶段实现，另行评估持久化 `app_identity`/`icon_key`、migration、backup/restore、export 和前端 lookup；这属于需要重新确认的范围扩张。

### Gate C — 名称与图标

通过条件：Shell 应用项能为 Microsoft Store 和代表性应用返回正确本地化名称、透明背景正常且可辨认的应用图标。

- [x] Shell 图标不是 `ApplicationFrameHost.exe` 图标。
- [x] Shell 图标不是通用空白 exe 图标。
- [x] 图标在浅色和深色界面中均保持可辨认，不要求新增 UI 样式。
- [x] Shell API 暂时失败时不会写入错误永久缓存。

未通过时：不得以宿主图标或永久占位符宣告 UWP 支持完成。若必须解析 package manifest/PRI，先记录复杂度、语言/缩放资源和 Windows 版本风险，再更新计划和范围。

### Gate D — 非宿主不变性

通过条件：非 `ApplicationFrameHost.exe` 的窗口不执行后代枚举、AUMID 候选选择或 Shell 图标提取，现有 `WindowInfo` 和 session 决策保持等价。

- [x] 普通 Win32 快照在修改前后逐字段一致。
- [x] Explorer 应用窗口和 Explorer shell surface 的现有分流不变。
- [x] 系统过滤名单不因本功能缩短或改为宽泛例外。
- [x] 现有 icon cache 中的普通 exe key 和读取方式不变。

## 7. 执行阶段

### Phase 0 — 授权、环境与基线

目标：在任何代码修改前固定范围、运行环境、现有行为和工作树边界。

- [x] 读取 live Project，确认当前事项、并行 `In progress` 和 `Next` 窗口；只向维护者报告拖动建议。
- [x] 读取 Issue #75 最新状态，确认没有新增 Windows 版本、应用清单或验收要求。
- [x] 运行 `git status --short`，记录与 `platform/windows`、`engine/tracking`、`domain/tracking`、Cargo 或测试重叠的用户改动。
- [x] N/A：实施前没有与目标 owner 重叠且无法区分的用户改动；未执行 restore、重排或覆盖。
- [x] 记录可用测试环境：Windows 版本、build、架构、显示缩放、标准用户/管理员状态和代表性应用版本。
- [x] 至少准备一个 Windows 11 标准用户环境；若产品仍声明支持 Windows 10，准备 Windows 10 环境或将其标为明确未验证风险。
- [x] 确认使用 `npm run tauri dev` 的 `Patina Dev` 隔离身份，不能用 debug 构建接触正式 Patina 数据目录。
- [x] 运行修改前 `npm run check:rust`，保存通过/失败摘要；失败时先区分基线失败与任务风险。
- [x] 执行偏差：未保存修改前的数值延迟样本；以“普通非宿主零新增 API 调用、宿主查询有限枚举、Shell 不进入采样函数、单次 Shell 等待上限 2 秒”为结构预算，并由实机持续采样与最终门禁验证。

Phase 0 输出：环境表、基线检查结果、工作树边界和经确认的性能比较口径。

### Phase 1 — 可重复的窗口归属探针

目标：先观察真实 Windows 关系，不根据记忆设计解析器。

- [x] 在 debug-only 或临时本地诊断中记录以下非敏感字段：foreground HWND、root HWND、各自 PID/exe、后代 HWND/PID/exe、AUMID、解析结果和耗时。
- [x] 默认不记录窗口标题；若定位必须查看标题，只在本机临时观察，最终代码、日志和本文不保存标题值。
- [x] 临时诊断不得写 SQLite、发送事件、改变 session 或进入 release 构建。
- [x] 对每个测试应用连续观察至少三个稳定采样，避免把启动 splash、更新窗口或已退出 PID 当作正式关系。
- [x] Microsoft Store 已覆盖稳定前台、浏览、恢复和重新激活；隔离 Dev 数据中真实 Store session 持续增长并能正确封口。
- [x] 对照片和计算器或另两个可用代表性包应用重复观察。
- [x] N/A：设置应用不是本次宿主解析的必要验收样本；Store 与计算器覆盖宿主路径，照片覆盖直接拥有窗口的包应用路径，非宿主 bypass 有逐字段测试。
- [x] 系统表面处置完成：解析器只对 `ApplicationFrameHost.exe` root 介入，零候选/无 AUMID 均失败关闭；既有开始菜单、搜索、桌面和锁屏过滤未放宽。锁屏未执行人工登录边界测试，保留为实机残余风险。
- [x] Chrome 与 Explorer 已作实机对照；Obsidian 与终端由非宿主逐字段 bypass、完整 tracking/browser 回归门禁覆盖，没有逐个执行人工窗口矩阵。
- [x] 记录是否存在同一 root 下多个不同 AUMID、同一 AUMID 多个 PID、无 AUMID 子进程或只返回宿主 PID的情况。
- [x] Phase 1 完成后删除临时诊断，或在保留前为其确定长期 diagnostics owner、字段隐私和有界资源责任。

Phase 1 输出：不含私密标题的窗口关系矩阵，以及 Gate A/B 的初步结论。

### Phase 2 — 先建立纯决策模型

目标：把“哪些观察足以归属到真实应用”写成可测试规则，再接 Windows API。

- [x] 在 `platform/windows` 的最近 owner 中定义窄的内部候选结构，至少包含 PID、exe/path 可用性、AUMID 和候选窗口关系。
- [x] 定义清楚的解析结果：`NotApplicable`、`Resolved`、`Unavailable`、`Ambiguous`；名称可以按 Rust 语义调整，但不得把所有失败压成空字符串。
- [x] `NotApplicable` 只用于非目标宿主，调用方必须沿用现有结果。
- [x] `Resolved` 必须包含唯一 AUMID、非宿主 PID、非空真实 exe，并说明候选证据来源。
- [x] `Unavailable` 覆盖没有候选、进程退出、权限不足、无应用身份和 API 失败。
- [x] `Ambiguous` 覆盖同一前台窗口树中出现多个无法消歧的 AUMID。
- [x] 候选选择先按窗口树归属限定，再按 AUMID 一致性去重；不得按应用名称排序后取第一个。
- [x] 多个窗口/PID若属于同一 AUMID，可折叠为一个应用候选，但必须选择能解析真实 exe/path 的进程。
- [x] 宿主 PID、PID 0、空 AUMID、空 exe 和不属于目标窗口树的进程不能成为成功候选。
- [x] 为单候选成功、零候选、同 AUMID 多 PID、不同 AUMID 冲突、宿主 PID 混入、进程详情缺失和非宿主 bypass 添加纯单元测试。
- [x] 添加一个明确断言：解析失败时传给 domain 的仍是当前宿主结果，因此既有 filter 继续拒绝它。

Phase 2 输出：不依赖真实桌面的候选选择模型和失败关闭测试。

### Phase 3 — Windows 身份发现

目标：用受支持的 Windows API 为纯决策模型提供事实。

- [x] 在 `src-tauri/Cargo.toml` 只增加实际需要的 `windows` feature；预期至少需要 `Win32_Storage_Packaging_Appx`。
- [x] 使用现有 `OwnedHandle` 打开候选进程，权限保持为 `PROCESS_QUERY_LIMITED_INFORMATION`。
- [x] 按官方两阶段缓冲区模式调用 `GetApplicationUserModelId`：先取得长度，再分配 UTF-16 缓冲区并读取值。
- [x] 将 `APPMODEL_ERROR_NO_APPLICATION` 视为“该进程没有包应用身份”，而不是运行时错误。
- [x] 将进程已退出、访问被拒绝、缓冲区变化和无效 UTF-16 归入可诊断失败，不 panic。
- [x] 使用 `EnumChildWindows` 或经 Phase 1 证明足够的更窄窗口关系 API 收集目标 root 的后代 HWND/PID。
- [x] FFI callback 不允许 panic 穿过 Windows ABI；回调只收集最小事实，复杂判断在回调返回后执行。
- [x] 先尝试“窗口树候选 PID + 进程 AUMID”；只有 Phase 1 证明不足时才增加 `SHGetPropertyStoreForWindow`。
- [x] 如果使用窗口 property store，优先复用 typed `PKEY_AppUserModel_ID`；若 crate feature 暴露位置不合理，使用由微软属性定义核对过的窄本地常量并附来源，不引入无关平台能力。
- [x] 如果使用 COM，增加局部 RAII apartment guard，正确处理已经初始化和 `RPC_E_CHANGED_MODE`，只在本线程实际拥有初始化时调用 `CoUninitialize`。
- [x] 身份发现缓存以 PID、实际进程路径和短 TTL 约束，PID/path 不一致时立即失效；负缓存短于正缓存且总条目有上限。
- [x] 增加 cache 命中、过期、PID/path 变化、负缓存和容量上限测试。
- [x] 不在此阶段解析图标、读取 package 安装目录或扫描全部已安装 Appx 包。

#### 接入 `foreground.rs`

- [x] 保留当前 `GetForegroundWindow → GA_ROOTOWNER → get_process_info(root)` 主路径。
- [x] 当 root exe 不是 `ApplicationFrameHost.exe` 时直接返回当前结果，不进入新模块。
- [x] 当 root exe 是 `ApplicationFrameHost.exe` 时调用宿主解析器。
- [x] 成功时只替换应用归属字段：真实 `process_id`、`exe_name`、`process_path`；保留用户实际前台 HWND、root HWND、标题、窗口类、AFK 和 idle 值。
- [x] 失败或冲突时保留宿主身份，让现有 domain filter 继续拒绝；不得返回某个不完整候选。
- [x] `has_meaningful_change`、runtime fallback 和 window polling timeout 行为保持可解释。
- [x] 添加非宿主 bypass 的逐字段等价测试，以及宿主成功/失败的投影测试。

Phase 3 输出：Microsoft Store 等代表性宿主应用可被投影为真实 PID/exe/path，系统宿主过滤本身未改变。

### Phase 4 — AUMID 对应的名称与图标

目标：使用与真实应用身份一致的 Windows Shell 呈现，不再从宿主或执行别名猜图标。

#### Shell item 与名称

- [x] 在后台阻塞任务中初始化所需 COM apartment，不在 `get_active_window` 热路径创建 Shell item。
- [x] 使用 Phase 3 已验证的 AUMID 创建 `FOLDERID_AppsFolder` 下的 Shell item；在目标 Windows 版本中比较 `SHCreateItemInKnownFolder` 与必要的 parsing-name 路径，只保留经实机证明的 canonical 方法。
- [x] 通过 Shell item 取得本地化显示名称，并正确释放 Shell 分配的字符串/COM 资源。
- [x] 显示名称 fallback 顺序固定为：Shell 名称 → 当前文件版本信息 → 现有 exe stem fallback。
- [x] 不从 package 安装目录名、版本号目录或 manifest 原始资源 key 拼显示名称。
- [x] 为名称选择顺序、空白值、Shell 失败和经典 exe fallback 添加纯单元测试。

#### Shell icon

- [x] 先检查现有图标消费者的最大显示尺寸和 DPI 场景，再确定 Shell 请求 bitmap 尺寸；在执行记录中保存选择依据。
- [x] 通过 `IShellItemImageFactory::GetImage` 获取与 AUMID 对应的 HBITMAP，提取工作运行在有界 blocking task 中。
- [x] 在 `icon.rs` 将现有像素转换收口成可复用的 HBITMAP → PNG data URI 能力，不复制 BGRA/RGBA、GDI DC 或 PNG 编码逻辑。
- [x] 用 `OwnedBitmap` 或等价 RAII 保证 Shell 返回的 HBITMAP 必定 `DeleteObject`，包括编码失败路径。
- [x] 保持 alpha、宽高和 data URI 形状与现有前端消费者兼容。
- [x] 包应用图标选择顺序固定为：AUMID Shell icon → 真实 exe icon → 由真实应用 PID 拥有的窗口图标。
- [x] 当 root owner 是 `ApplicationFrameHost.exe` 时，禁止把 root owner 的 WM_GETICON/class icon 作为真实应用图标 fallback。
- [x] 所有来源失败时返回无图标并允许后续重试，不写入宿主图标或通用错误图标。
- [x] 为来源优先级、宿主图标禁止、Shell 失败、真实 exe fallback 和缓存 key 添加测试。

#### 异步、缓存与重试

- [x] `active_session` 将现有 `process_id` 传给 metadata 路径，或通过等价的内部方式让 metadata 可重新取得 AUMID；第一阶段不向前端/IPC新增字段。
- [x] Shell 名称/图标工作使用 `spawn_blocking` 或等价 blocking owner，不能同步占用 Tokio async worker 做可能缓慢的 Shell 提取。
- [x] 复用现有并发上限和 in-flight 合并，AUMID Shell cache 以规范化 AUMID 为 key，并设正/负 TTL 与容量上限。
- [x] 对包应用的 engine 负缓存包含 AUMID/来源，避免第一次时序失败把同一 exe 阻塞一小时。
- [x] 普通 exe 的既有缓存和 fallback 行为不因包应用路径改变。
- [x] 为 packaged positive/negative cache、AUMID 变化、并发合并和一次失败后的可重试性添加测试。

Phase 4 输出：真实应用身份、显示名称和图标形成一致的 presentation；Shell 提取与前台采样解耦。

### Phase 5 — Tracking 与 session 集成

目标：让成功解析的包应用进入现有 tracking，而不建立第二套 session 流程。

- [x] 成功解析后继续调用现有 `tracking::is_trackable_window`，不为包应用建立绕过 domain filter 的特殊入口。
- [x] `ApplicationFrameHost.exe` 本身继续通过现有 filter 返回不可追踪。
- [x] 真实应用 exe 若命中用户排除、lifecycle utility 或其他现有过滤，继续服从相同规则。
- [x] 继续以现有 app key 进行 session 切换，前提是 Gate B 已证明 exe key 足够区分本阶段范围。
- [x] 同一真实应用因 root HWND、子 HWND 或实例 PID 变化时，不应仅因 instance key 变化开启新 session；允许按现有规则刷新元数据。
- [x] 两个不同包应用之间切换必须结束前一 session 并开始后一 session。
- [x] 包应用切到 Win32、Win32 切回包应用时，session 结束时间、continuity group 和 title policy 使用现有逻辑。
- [x] AFK、锁屏、睡眠和恢复路径不新增包应用例外。
- [x] 持续参与/GSMTC 当前逻辑只消费解析后的真实 exe/path；除非 focused test 证明回归，本任务不修改其领域语义。
- [x] 为以下转换添加测试：未解析宿主保持不追踪、宿主解析成功开始 session、同一包应用实例变化不切 app、不同包应用切换、包应用/Win32 往返、包应用进入 AFK。

Phase 5 输出：包应用复用唯一 tracking 主链，未新增兼容或平行 session 实现。

### Phase 6 — 持久化身份检查

目标：明确第一阶段是否可以安全复用 `exe_name`，不在实现过程中被动引入 schema 变化。

- [x] 汇总 Phase 1/3 的 `AUMID → exe` 矩阵并执行 Gate B。
- [x] 若映射在支持范围内一一对应，Shell 图标仍存入现有真实 exe icon cache key。
- [x] 检查现有 frontend `resolveAppIconKeys` 和 SQL icon lookup 无需修改。
- [x] 添加 repository 或 session 集成测试，证明 UWP 图标写入真实 exe key，`applicationframehost.exe` 没有新 cache row。
- [x] 检查 backup/export payload 没有新增字段，SQLite schema 未变化。
- [x] 若发现身份冲突，停止并将状态改为 `Blocked`；另建经确认的 schema/migration 执行单，不能把 AUMID 填入 `exe_name` 冒充 exe。

Phase 6 输出：明确的“无需 schema”证据，或一个没有被隐藏的范围阻塞。

### Phase 7 — 自动化验证

目标：用能区分旧行为和目标行为的证据保护实现。

#### Focused Rust tests

- [x] 候选选择模型覆盖单候选、零候选、同 AUMID 多 PID、不同 AUMID 冲突和宿主混入。
- [x] `GetApplicationUserModelId` 封装的状态映射覆盖 success、no application、buffer resize 和 platform error；真实 API 调用由 Windows 实机补充。
- [x] foreground 投影覆盖非宿主不变、宿主成功和宿主失败关闭。
- [x] process filter 明确断言 `ApplicationFrameHost.exe` 仍不可追踪。
- [x] transition/continuity 覆盖 UWP 与 Win32 切换及同应用实例变化。
- [x] metadata/icon 选择覆盖 Shell、真实 exe、真实窗口和全部失败。
- [x] cache 测试覆盖正/负 TTL、容量、AUMID变化和 in-flight 合并。
- [x] 资源 guard 测试或可审计结构覆盖所有新增 HANDLE、HBITMAP、COM 和 Shell 内存所有权。

#### Repository gates

- [x] 运行 `npm run check:rust`，记录 Rust boundary、fmt、check、test 和 clippy 结果。
- [x] 运行 `npm run check:full`，确保最终状态通过默认、Rust、架构和依赖检查。
- [x] 若 IPC command、capability 或真实 Tauri registration 发生变化，追加 `npm run test:tauri-runtime-smoke`；第一阶段预期不需要这些变化。
- [x] 不通过删除断言、放宽 gate、增加宽泛 allowlist 或提高资源预算让检查变绿。
- [x] 所有 aggregate gate 在最后一次代码修改后重新运行，不能引用早期草稿结果。

Phase 7 输出：自动化检查摘要和仍需实机承担的不可自动化风险。

### Phase 8 — Windows 实机验收

目标：证明 Windows API、Shell presentation 和真实 session 行为，而不以单元测试冒充平台证据。

#### 应用矩阵

| 场景 | 预期身份 | 预期统计 | 预期图标 |
| --- | --- | --- | --- |
| Microsoft Store | 实际 Store exe/AUMID，绝非宿主 | 持续、正确记录 | Microsoft Store 图标 |
| 照片 | 该环境实际 exe/AUMID | 独立于 Store 记录 | 照片图标 |
| 计算器或另一代表性包应用 | 该环境实际 exe/AUMID | 独立记录 | 对应应用图标 |
| 设置 | 按实测窗口模型解析真实应用 | 按现有系统应用规则处理 | 不出现宿主图标 |
| 开始菜单 | 系统表面 | 不记录 | 不写 icon cache |
| 搜索 | 系统表面 | 不记录 | 不写 icon cache |
| 桌面/任务栏 | Explorer shell surface | 不记录 | 保持现有行为 |
| 锁屏/登录边界 | 系统表面 | 不记录并正确封口 | 不适用 |
| Chrome/Obsidian | 真实 Win32 exe | 与修改前一致 | 与修改前一致 |
| Explorer 文件窗口 | `explorer.exe` 应用窗口 | 与修改前一致 | 与修改前一致 |

- [x] Windows 11 标准用户矩阵已覆盖 Store、计算器、照片、Chrome、Explorer、宿主空候选、应用切换、持久化 session 和 icon cache；系统表面与排除规则由失败关闭和既有领域回归补充。
- [x] 在可用的 Windows 10 标准用户环境逐项执行矩阵；不可用时记录 `Unavailable`，不得写“Windows 10 已支持”。
- [x] 每个代表性包应用保持前台至少一个正常 tracking 观察周期，并验证 session 持续增长而不是只出现瞬时记录。
- [x] Store/Win32 往返和 Store/计算器、包应用/Win32 session 边界已由实机记录与 focused transition 测试覆盖；开始菜单往返没有单独人工计时，沿用系统表面失败关闭证据。
- [x] 最小化、恢复、关闭重开和快速切换已观察；“应用更新后路径变化”由 PID + 实际路径缓存失效测试替代，没有为验收主动更新系统应用。
- [x] 包应用继续经过现有用户排除与 lifecycle filter；focused domain/transition 和完整 tracking 回归通过。未修改用户真实排除设置。
- [x] 首次 Shell 图标提取在隔离 `Patina Dev` 身份完成；只读回查确认 Store、计算器和照片写入真实 exe key，未出现宿主 key，没有删除数据库或目录。
- [x] Store 图标经 AUMID Shell item 取得并人工检查为 Microsoft Store 彩色购物袋图标，不是宿主或空白图标；仓库未保存截图。
- [x] 实机为 125% DPI，64×64 透明 PNG 清晰无裁切；完整浏览器 UI smoke 覆盖 100%、125%、150%、200% 和主题状态。由于没有 UI 改动，未为同一原生 bitmap 另建主题专用视觉实现。
- [x] 执行偏差：没有自动关闭用户应用 20 次；改为在独立测试进程中连续执行 20 轮真实 Store“名称 + 图标”Shell 提取，结果 handle 327→329、GDI 40→40，并结合多轮实机 session 切换验证。临时资源测试已删除。
- [x] 无修改前数值延迟样本可直接对比；结构审计确认普通非宿主立即 `NotApplicable` 且不调用 Shell，宿主身份查询使用 10 秒正缓存/1 秒负缓存，Shell 工作由单线程有界队列承载并在 2 秒失败关闭；实机未触发 3 秒 foreground probe 安全超时。
- [x] N/A：没有观察到稳定性能回归；没有提高 foreground timeout 或放宽资源预算。

Phase 8 输出：按 OS/应用/场景记录的实机结果、图标判断、资源趋势和残余风险。

### Phase 9 — 文档、变更说明与收尾

目标：让长期事实回到真实 owner，并完成执行单生命周期。

- [x] 检查实现是否改变长期平台 owner、tracking 不变量或验证规则；只有真实长期规则变化时才更新对应 top-level doc。
- [x] 不把具体应用矩阵、临时 PID/HWND、私有 Project 状态或调试输出复制进长期文档。
- [x] 根据上一个已发布版本到最终实现的真实差异，在 `CHANGELOG.md` 的 `Unreleased` 中选择 `Added`、`Changed` 或 `Fixed`，添加面向用户的结果，并以独立 `Refs [#75](https://github.com/Ceceliaee/patina/issues/75)` 引用 Issue；不预设分类，不使用关闭关键词。
- [x] 更新本文所有已完成 checkbox、偏差、未验证项和最终日期。
- [x] 重新运行最终验证并记录结果。
- [x] 只在获得明确 commit 授权后创建本地 commit；只在获得当前任务明确 remote push 授权后推送。
- [x] 实现和风险匹配验证完成后，重新读取 live Project并建议维护者拖到 `Done`；本文不代替真实状态。
- [x] 将本文移动到 `docs/archive/uwp-packaged-foreground-identification-execution-plan.md`。
- [x] 移动后重新验证相对链接、UTF-8、标题层级和 docs gate。

## 8. 验证矩阵

| 风险 | Focused check | Aggregate gate | Pass evidence |
| --- | --- | --- | --- |
| 宿主被误记为应用 | 候选选择和 filter 单元测试 | `npm run check:rust` | 无 `ApplicationFrameHost.exe` session/cache row |
| 真实 UWP 身份漏记 | foreground 投影测试 + Store 实机 | `npm run check:full` | 真实 exe session 持续增长 |
| 多应用被合并 | 不同 AUMID/同 exe Gate B | `npm run check:rust` | 一一映射或明确阻塞 |
| 系统表面误记 | 零/冲突候选测试 + 既有系统 filter | `npm run check:full` | 无错误 session；人工锁屏矩阵列为残余风险 |
| Win32 行为回归 | 非宿主逐字段等价测试 | `npm run check:full` | Chrome/Explorer 实机与完整 tracking 回归一致 |
| session 碎片或串记 | transition/continuity tests | `npm run check:rust` | 切换矩阵边界正确 |
| 宿主/错误图标污染 | icon source selection tests | `npm run check:full` | AUMID Shell 图标人工确认为 Store 图标，宿主图标不在 fallback 中 |
| 首次失败长期无图标 | packaged negative-cache tests | `npm run check:rust` | AUMID 可重试，不被旧 key 阻塞一小时 |
| COM/GDI/HANDLE 泄漏 | RAII 审计 + 20 次循环 | `npm run check:rust` | diagnostics 无持续增长 |
| tracking 热路径阻塞 | 结构调用审计 + 实机持续采样 | `npm run check:full` | 非宿主无 Shell 调用；身份缓存有界；Shell 不在 foreground 函数中 |
| IPC/schema 意外扩张 | diff 与 schema/backup 检查 | `npm run check:full` | 第一阶段无新增持久化/前端契约 |
| Windows 版本差异 | Windows 10/11 实机矩阵 | 不可由自动 gate 替代 | 各环境结果或明确 `Unavailable` |

- [x] 每个命中风险都有 focused 证据。
- [x] 自动化、实机和不可用证据分开记录。
- [x] 未运行检查包含原因、残余风险和真正验证 owner。

## 9. 中止与升级条件

以下条件在本次执行中均未发生；若未来发生，应停止当前阶段，不继续“顺手补兼容”：

- Microsoft Store 无法从目标窗口树获得唯一 AUMID 和真实 exe。
- 必须依赖标题、品牌词、硬编码 package family 或应用白名单才能成功。
- 同一 exe 对应多个需要独立统计/图标的 AUMID，现有 schema 无法表达。
- 正确图标只能通过未支持/不稳定的私有 API，或必须手工解析复杂 PRI 资源而尚未评估语言与 DPI。
- 新解析误把开始菜单、搜索、桌面、锁屏或其他系统表面当成应用。
- 非宿主路径必须改变现有 tracking 规则才能让宿主应用工作。
- 需要新增 IPC/capability、跨层端口、兼容壳、数据库 migration 或前端身份模型。
- 前台采样、资源使用或 session 稳定性出现无法由当前 scope 局部修复的回归。
- Windows 10/11 行为需要两套无法解释退出条件的平行实现。
- 工作树出现与目标 owner 重叠且无法安全合并的用户改动。

中止后应：

- 保持 `ApplicationFrameHost.exe` 过滤和当前发布行为不变。
- 在本文“偏差与阻塞”记录具体证据，不写推测结论。
- 向维护者报告最小范围扩张、替代方案和新增风险，取得确认后再更新计划。

## 10. 回退与数据安全

第一阶段设计为无 schema、无新 IPC、只在宿主分支介入，因此回退边界应保持简单。

- [x] 所有实机验证使用隔离的 `Patina Dev` 数据目录，不在正式数据上试验。
- [x] 解析器未通过验收时，移除宿主分支接入即可恢复当前“宿主被过滤”的行为。
- [x] 错误解析不得写入正式用户数据库；若 Dev 数据出现错误 session，只处置明确的 Dev 数据，不对正式路径执行清理。
- [x] 不能通过 `git reset --hard`、宽泛 restore 或删除工作区回退；只对本任务明确文件使用正常代码修改。
- [x] 如果实现已经引入 schema 或持久化新字段，本文的简单回退不再成立，必须停止并建立 migration/rollback 计划。

## 11. 文档与生命周期检查

- [x] 本文归类为 working execution plan，不是 active long-term reference。
- [x] 本文的 reader job 是执行当前已确认问题，不强制归入长期 Diátaxis 文档类型。
- [x] 产品、架构、质量、Project 和发布规则通过链接引用真实 owner，没有在本文创建第二套长期政策。
- [x] 实施中的长期规则变化直接更新对应 active owner。
- [x] 临时日志、矩阵原始数据和媒体证据不提交为长期文档。
- [x] Markdown 保持 UTF-8，无 BOM、mojibake、错误 fence 或失效相对链接。
- [x] `docs/working/` 在完成前只保存仍作为执行依据的计划。

## 12. 完成与归档门槛

- [x] 所有适用实施项已勾选。
- [x] 不适用项写明原因，而不是静默留空。
- [x] Gate A、B、C、D 均通过，或维护者明确收窄了交付范围并更新验收。
- [x] Issue #75 的公开验收条件有对应证据。
- [x] 最终 `npm run check:rust` 通过。
- [x] 最终 `npm run check:full` 通过。
- [x] Windows 实机矩阵完成；不可用环境有明确残余风险。
- [x] 没有 `ApplicationFrameHost.exe` 错误 session 或 icon cache row。
- [x] 没有未归属的 schema、IPC、compatibility 或性能债务。
- [x] 与任务无关的用户改动未被覆盖。
- [x] `CHANGELOG.md` 已按真实发布结果更新。
- [x] live Project 已重新读取并给出状态/Next 建议，维护者负责实际拖动。
- [x] Status 和 Last updated 已更新。
- [x] 本文已移动到 `docs/archive/`，移动后的链接和 docs gate 已验证。

## 13. 执行记录

### 13.1 环境

| 日期 | Windows 版本/build | 架构 | 缩放 | 用户权限 | Patina identity | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-08-31 | Windows 11 24H2 / 26100 | AMD64 | 125%（AppliedDPI 120） | 标准用户（Medium integrity） | Patina Dev | Store 22603.1401.19.0；Calculator 11.2508.4.0；Photos 2026.11020.20001.0 |

### 13.2 决策门结果

| Gate | 结果 | 证据 | 决策人/日期 |
| --- | --- | --- | --- |
| A 身份可解析性 | Pass | Store 与计算器的 `ApplicationFrameHost.exe` 后代 PID 能取得唯一 AUMID/真实 exe；零候选和冲突失败关闭；照片直接拥有窗口 | Codex / 2026-08-31 |
| B 持久化身份模型 | Pass | 本次代表矩阵为稳定 AUMID→真实 exe；SQLite 与 IPC schema 不变，session/icon 继续使用真实 exe key | Codex / 2026-08-31 |
| C 名称与图标 | Pass | AppsFolder Shell item 返回 `Microsoft Store` 与正确 64×64 图标；名称/图标独立缓存；资源测试通过 | Codex / 2026-08-31 |
| D 非宿主不变性 | Pass | 非宿主立即 bypass；`ApplicationFrameHost.exe` filter 保留；Chrome/Explorer 实机与完整回归通过 | Codex / 2026-08-31 |

### 13.3 验证结果

| 检查 | 状态 | 证据摘要 | 残余风险 |
| --- | --- | --- | --- |
| Baseline `npm run check:rust` | Pass | 650 passed、1 ignored | 无 |
| Final `npm run check:rust` | Pass | 对抗审查修正后 681 total：680 passed、1 仓库既有 ignored；fmt、check、boundary、Clippy `-D warnings` 通过 | 无 |
| Final `npm run check:full` | Pass | 最终代码与浏览器夹具修正后在非沙箱完整重跑通过，含 103 browser smoke、mutation 27/27、frontend build、680 个 Rust 通过测试、Clippy 和依赖审计 | 无 |
| Windows 11 matrix | Pass with recorded deviations | Store、Calculator、Photos、Chrome、Explorer、失败关闭、切换、session/icon 持久化通过 | 锁屏和每个系统表面未逐项人工操作；由过滤与失败关闭测试覆盖 |
| Windows 10 matrix | Unavailable | 当前没有 Windows 10 标准用户环境；未宣称实机支持 | 后续发布验收应补一次 Windows 10 实机矩阵 |
| Resource/performance comparison | Pass with deviation | 20 轮真实 Shell 名称/图标提取：handle 327→329、GDI 40→40；普通路径结构上不进入 resolver/Shell | 缺少修改前数值延迟基线；以结构预算、缓存测试和持续实机采样替代 |

### 13.4 偏差与阻塞

- Windows 10 环境不可用；兼容路径只依据公开 API 契约、相同失败关闭和自动化测试，不能写成“Windows 10 已实机通过”。
- 未保存修改前采样延迟数值，也没有自动关闭用户应用 20 次；以普通路径零新增调用审计、宿主缓存/有界等待、20 轮真实 Shell 资源测试和多轮 Dev session 观察替代。
- 锁屏、Settings、Obsidian、终端与每个系统表面未逐个执行人工矩阵；这些路径不属于新解析成功分支，并由宿主限定、失败关闭、既有过滤和完整回归保护。
- 实施中先发现线程池线程各自初始化 COM 会使资源随线程数增长，改为一个专用 Shell owner；随后又发现名称请求顺带提取图标会延迟 session 创建，最终拆成名称/图标独立请求与独立缓存。两项修正均在最终门禁前完成。
- 对抗审查后的全量门禁连续两次停在同一个 History CDP 重复拖拽场景；诊断确认前一轮 `mouseReleased` 没有显式发送 `buttons: 0`，Chromium 保留按下状态，导致下一轮收不到新的按下事件。只修正该测试夹具后，单独 103 个 browser smoke 与最终 `check:full` 均通过；产品 UI 未改动。
- 没有新增或改变长期产品、架构、质量、schema、IPC 或 UI 规则，因此无需修改 top-level active owner；长期事实由现有 owner 与实现/测试继续承接。

### 13.5 完成记录

Issue #75 的本地实现与验收已完成：宿主窗口只在唯一 AUMID/真实 exe 可解析时投影到现有 tracking 流程，失败仍由既有 `ApplicationFrameHost.exe` filter 拒绝；Shell 名称和图标在有界后台 owner 中分别解析，真实 exe 继续拥有 session 与 icon cache。隔离 Dev 数据库只读回查得到 Calculator、Photos、Store 的真实 session 与图标行，没有 `ApplicationFrameHost.exe` 行。`CHANGELOG.md` 已更新；最终 Rust/full gate 通过；live Issue 与 Project 已只读复核，未执行 commit、push、Issue 或 Project mutation。本文归档后只作为历史执行证据，不作为未来实现事实来源。

### 13.6 对抗式审查

第一轮 risk-first review 找到并修复 3 项：同一 AUMID 的多个可见不同 exe 改为 `Ambiguous`，避免按 PID 随机改变持久化身份；Shell worker 在线程创建失败或断开后可以重新建立，不再把首次失败固化到进程生命周期；Shell 图标成功后不再继续执行 exe/窗口图标 fallback。新增候选冲突、进程详情缺失、worker 断开和 lazy icon source 断言；真实 Store worker 与 20 轮资源复测仍为 handle 327→329、GDI 40→40。

最终 full gate 后完成第二轮只读复审，重新攻击候选可见性与 exe 歧义、PID/路径缓存失效、worker 启动握手与断线竞争、Shell 名称/图标缓存隔离、图标 lazy fallback、失败关闭、普通 Win32 bypass、IPC/schema 不变性和测试夹具状态。未发现剩余 P0–P3 正确性、回归、资源所有权或缺测问题；`git diff --check`、文档治理和 changelog 验证均通过。
