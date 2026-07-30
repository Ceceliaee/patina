# 系统托盘菜单跟随界面语言执行方案

> 文档状态：实施、验证、对抗式审查和归档均已完成
>
> 创建日期：2026-07-30
>
> 完成日期：2026-07-30
>
> 对应事项：GitHub Project「让系统托盘菜单跟随界面语言」
>
> 关联反馈：Refs [#61](https://github.com/Ceceliaee/patina/issues/61)，本事项只处理其中的托盘语言问题
>
> 最终 Project 状态：`In progress`（2026-07-30 完成后只读复核；按仓库规则由维护者手动拖到 `Done`）
>
> 文档归宿：`docs/archive/tray-menu-language-execution-plan.md`

> 范围校正：实时 Project 正文目前仍包含“贡献文档、翻译文件位置和新增语言流程”，
> 但维护者已明确这些内容属于独立事项「规范化前端与原生多语言文案系统」。
> 本执行方案以维护者最新确认的窄范围为准，不修改 `CONTRIBUTING.md`，也不重构前端 copy 系统。

## 1. 如何使用本文档

本文档是当前托盘语言修复的一次性执行清单。实施者应从上到下推进，并在每个阶段完成后记录证据。

- [x] 开始编码前重新读取实时 Project，确认事项状态、正文范围和 `Next` 窗口是否发生变化。
- [x] 若实时 Project 仍保留贡献文档范围，在实施记录中注明“按维护者 2026-07-30 的明确范围校正执行”，不擅自修改 Project。
- [x] 开始某一阶段前，确认上一阶段的退出条件已经满足。
- [x] 每完成一个步骤立即勾选，并在该步骤下记录测试名、命令结果、截图路径或人工验收结论。
- [x] 如果代码事实与本文档不一致，先停止编码、更新本文档并说明原因，再继续实施。
- [x] 如果实现需要新增通用原生多语言框架、跨层端口、兼容壳或第三种语言，停止实施并重新讨论范围。
- [x] 不用“菜单看起来已经变成英文”替代状态保持、失败回退和动态文案测试。
- [x] 完成第 24 节的对抗式审查后，才能进入完成验收。
- [x] 满足第 26 节的完成定义后，按第 27 节执行 Project 协作与文档归档。

## 2. 一句话问题定义

Patina 已把界面语言持久化为应用设置，但 Rust 原生托盘菜单没有读取或订阅这项已保存设置，
因此托盘始终使用硬编码中文，且暂停追踪和标题记录状态变化会继续用中文重建菜单。

## 3. 当前事实与根因证据

### 3.1 已确认事实

- [x] `src/shared/copy/` 负责 React/WebView 界面文案，不直接参与 Rust 原生托盘创建。
- [x] `src-tauri/src/app/tray.rs` 当前直接定义中文托盘常量：
  - `打开主界面`
  - `暂停追踪`
  - `恢复追踪`
  - `屏蔽标题`
  - `记录标题`
  - `退出应用`
- [x] `setup_tray(...)` 启动时读取追踪暂停设置和标题记录设置，但不读取 `language`。
- [x] `build_tray_menu(...)` 的输入只有暂停状态和标题记录状态，没有语言输入或语言运行时状态。
- [x] `cmd_commit_app_settings(...)` 能把 `language` mutation 写入 SQLite，但提交成功后只主动应用暂停和标题记录状态。
- [x] 前端保存后的 `app-settings-changed` 事件不能替代 Rust 提交链：
  - 事件可能由不同窗口发出；
  - 事件不是持久化成功的权威证明；
  - 让托盘依赖前端事件会制造“数据库状态”和“托盘状态”两条同步路径。
- [x] 前端对未知语言值会回退到 `zh-CN`，Rust 托盘也应采用相同的确定性中文回退。
- [x] 托盘菜单行为由稳定菜单 ID 驱动，不依赖可见文案，因此只替换 label 不应改变事件语义。

### 3.2 根因链

1. 用户在设置页把语言改为英文并保存。
2. 前端通过 `cmd_commit_app_settings` 把 `language = en-US` 写入 SQLite。
3. Rust 命令没有把新的已保存语言应用到托盘。
4. 当前托盘继续显示创建时的中文菜单。
5. 用户随后暂停追踪、恢复追踪、屏蔽标题或恢复标题记录。
6. `tray.rs` 按动态状态重建菜单，但仍从中文常量取 label。
7. 应用重启后，`setup_tray(...)` 仍不读取语言，问题再次出现。

### 3.3 第一处应被红测锁定的故障

- [x] 在修改生产代码前新增失败测试，证明 `en-US + tracking_paused=false + title_enabled=true`
  必须生成完整英文菜单模型，而当前实现无法表达语言输入。
- [x] 新增失败测试，证明未知语言值必须生成中文菜单模型。
- [x] 新增失败测试，证明一组 settings mutations 中最后一个 `language` 值才是提交后的运行时目标。
- [x] 确认失败原因来自缺少托盘语言模型和保存后应用链，而不是测试 fixture 或字符串拼写错误。

## 4. 第一性原理

### 4.1 已保存设置才是托盘语言真相

设置页允许保存前预览语言，但托盘是独立于当前 React 页面生命周期的原生界面。
托盘必须服从已成功持久化的语言，而不是尚未保存的草稿或某个窗口的临时状态。

由此得到：

- [x] 设置页切换下拉选项但未保存时，托盘不得变化。
- [x] `cmd_commit_app_settings` 成功持久化 `language` 后，托盘才更新。
- [x] 应用启动时从 SQLite 读取已保存语言。
- [x] 主窗口未创建、已隐藏或被后台优化释放时，托盘语言仍然成立。
- [x] 不要求前端窗口持续存在才能维持托盘语言。

### 4.2 托盘可见结果是三个状态的纯函数

托盘 label 的最小完整输入是：

```text
TrayMenuLabels = f(language, tracking_paused, title_recording_enabled)
```

其中：

- `language` 决定所有静态和动态 label 使用中文还是英文；
- `tracking_paused` 决定动作显示“暂停”还是“恢复”；
- `title_recording_enabled` 决定动作显示“屏蔽标题”还是“记录标题”。

由此得到：

- [x] 把 label 选择收敛为可单元测试的纯函数或只读值模型。
- [x] 不在 `setup_tray`、暂停切换和标题切换路径分别复制三套语言分支。
- [x] 每次菜单重建都从当前三个状态生成完整菜单，避免中英文混排。
- [x] 菜单重建不保存或修改追踪暂停状态和标题记录状态。

### 4.3 菜单身份与显示文案必须分离

菜单 ID 是行为契约，label 是展示结果。语言切换只能改变 label。

由此得到：

- [x] 保持 `tray-show-main` 不变。
- [x] 保持 `tray-toggle-pause` 不变。
- [x] 保持 `tray-toggle-title-recording` 不变。
- [x] 保持 `tray-quit` 不变。
- [x] 保持菜单顺序不变。
- [x] 保持左键、双击、右键菜单和关闭到托盘行为不变。
- [x] 不根据中文或英文 label 判断点击了哪个菜单项。

### 4.4 原生托盘需要自己的最小运行时语言状态

暂停或标题状态变化时，现有路径需要同步重建菜单，不能在同步菜单路径里反复阻塞读取 SQLite。
因此 Rust 运行时需要保存“当前已应用的托盘语言”。

由此得到：

- [x] 在 `app/tray.rs` 的真实 owner 内定义轻量语言状态。
- [x] 该状态只保存托盘语言，不复制暂停或标题记录状态。
- [x] 暂停状态继续由 `TrackingPauseRuntimeState` 持有。
- [x] 标题记录状态继续由 `TitleRecordingRuntimeState` 持有。
- [x] 不把托盘语言塞进 `DesktopBehaviorState`、tracking engine 或通用 `shared` 桶。
- [x] 不新增通用 `native_i18n` 模块；这属于后续多语言规范化事项。

### 4.5 数据层只读取原始设置，展示层负责解释

SQLite repository 的职责是可靠读取原始 `language` 值；“英文或中文托盘”属于托盘展示语义。

由此得到：

- [x] `data/repositories/app_settings.rs` 返回 `Option<String>` 原始值。
- [x] data 层不依赖托盘枚举或托盘文案。
- [x] `tray.rs` 把 `en-US` 解释为英文，其余缺失或无效值回退中文。
- [x] 不复用 `tracker_settings.rs` 的通用读取函数读取应用语言，以免把 app settings 反向挂到 tracker owner。
- [x] 不在本项新增设置 schema 或 migration。

### 4.6 失败时优先保持应用可用

托盘是后台驻留和恢复主窗口的重要入口。语言读取异常不能让托盘创建失败或让应用失去恢复入口。

由此得到：

- [x] 启动读取语言失败时记录可诊断日志并回退中文。
- [x] 缺失语言设置时使用中文默认值。
- [x] 未知语言值时使用中文，不 panic、不拒绝创建菜单。
- [x] 菜单更新失败时返回或记录带阶段上下文的错误，不改变菜单 ID 或退出路径。
- [x] 不因翻译问题改变 tracking 数据、标题数据或数据库结构。

## 5. 目标

- [x] 启动时托盘完整使用已保存的 `zh-CN` 或 `en-US`。
- [x] 保存英文设置后，无需重启即可看到完整英文托盘。
- [x] 保存简体中文设置后，无需重启即可恢复完整中文托盘。
- [x] 暂停和恢复追踪后，动态菜单项保持当前语言。
- [x] 屏蔽和恢复标题记录后，动态菜单项保持当前语言。
- [x] 同一次设置保存同时改变语言、暂停状态和标题状态时，最终菜单与三个已保存状态一致。
- [x] 无效或未知语言值稳定回退中文。
- [x] 语言切换不改变托盘菜单功能、顺序、ID、窗口行为或追踪行为。
- [x] 用自动化测试保护语言映射、动态组合、回退和 mutation 选择逻辑。
- [x] 用 Windows 真机验收保护实际原生菜单更新与重启保持。

## 6. 非目标

- [x] 不修改 `CONTRIBUTING.md`。
- [x] 不回答或实现新增第三种语言的完整贡献流程。
- [x] 不重构 `src/shared/copy/`、`bundle.ts` 或前端 `UI_TEXT`。
- [x] 不让 Rust 直接消费或生成 TypeScript 语言包。
- [x] 不建立通用原生多语言框架。
- [x] 不实现外部语言文件、插件式翻译、安装目录热加载或运行时下载语言包。
- [x] 不根据 Windows 系统语言自动切换。
- [x] 不增加第三种语言。
- [x] 不修改设置页 UI、语言预览或保存按钮行为。
- [x] 不改变托盘图标、tooltip、菜单样式、顺序和交互方式。
- [x] 不顺手重构追踪暂停、标题记录或窗口生命周期。
- [x] 不关闭、标记或修改 GitHub Issue #61。

## 7. 必须始终成立的不变量

- [x] 托盘语言只反映已保存设置，不反映未保存预览。
- [x] `en-US` 是唯一英文值；缺失值和其他值均回退 `zh-CN`。
- [x] 一次菜单构建只能使用一种语言，不允许静态项英文、动态项中文。
- [x] 暂停时动作是“恢复”，运行时动作是“暂停”。
- [x] 标题记录开启时动作是“屏蔽标题”，关闭时动作是“记录标题”。
- [x] 语言变化不修改 `tracking_paused`。
- [x] 语言变化不修改 `title_recording_enabled`。
- [x] 暂停或标题变化不修改 `language`。
- [x] 菜单 ID 和菜单顺序始终不变。
- [x] 数据层不依赖 `app::tray`。
- [x] `commands/settings.rs` 保持薄，只识别 mutation 并委派给 tray owner。
- [x] `app/tray.rs` 不直接执行 SQL，也不获取 SQLite pool。
- [x] 没有新 IPC command、capability 或 permission。
- [x] 没有数据库 migration、兼容双写或设置键重命名。

## 8. 所有权与分层

### 8.1 `src-tauri/src/app/tray.rs`

真实 owner：原生托盘生命周期、菜单模型和菜单重建协调。

- [x] 定义私有 `TrayLanguage`。
- [x] 定义托盘文案值模型，例如 `TrayMenuLabels`。
- [x] 定义 `language + paused + title_enabled -> labels` 的纯映射。
- [x] 定义托盘语言运行时状态及 poison 恢复方式。
- [x] 从现有 tracking/title runtime state 读取动态状态。
- [x] 统一构建和重建完整菜单。
- [x] 应用启动语言与保存后的语言变化。

禁止：

- [x] 不写 SQL。
- [x] 不持久化设置。
- [x] 不定义前端语言包结构。
- [x] 不承接通用 i18n 框架。

### 8.2 `src-tauri/src/data/repositories/app_settings.rs`

真实 owner：SQLite 中应用设置的原始读取与写入。

- [x] 增加 `LANGUAGE_KEY` 常量。
- [x] 增加窄读取函数，返回 `Result<Option<String>, sqlx::Error>`。
- [x] 补充缺失、英文、中文和原始异常值读取测试。

禁止：

- [x] 不返回 `TrayLanguage`。
- [x] 不包含菜单文案。
- [x] 不决定中文回退。

### 8.3 `src-tauri/src/data/app_settings_service.rs`

真实 owner：app runtime 到 data repository 的薄服务边界。

- [x] 增加语言设置读取包装。
- [x] 复用现有 SQLite pool 等待与错误映射方式。
- [x] 返回原始可选字符串，不引入托盘类型依赖。

### 8.4 `src-tauri/src/commands/settings.rs`

真实 owner：设置 IPC 参数映射和提交后的薄运行时委派。

- [x] 从 mutations 中选取最后一个 `language` 值。
- [x] 先完成持久化，再委派托盘应用语言。
- [x] 保留现有暂停、标题记录和 settings event 行为。
- [x] 不在 command 内定义语言映射、菜单文案或 Tauri menu 创建细节。

### 8.5 `src-tauri/src/app/bootstrap.rs`

真实 owner：Tauri managed state 装配。

- [x] 注册托盘语言运行时状态。
- [x] 不在 bootstrap 中读取数据库或选择语言。
- [x] 不把托盘菜单构建搬进入口层。

### 8.6 `CHANGELOG.md`

真实 owner：本次用户可见修复的发布记录，不属于“翻译贡献文档”范围。

- [x] 在 `Unreleased / Fixed` 增加一条用户语言描述。
- [x] 使用 `Refs #61`，不使用 `Closes`、`Fixes` 或 `Resolves`。
- [x] 只描述托盘跟随已保存语言，不宣称已经完成多语言贡献流程。

## 9. 托盘语言和值模型

建议模型：

```rust
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
enum TrayLanguage {
    #[default]
    ZhCn,
    EnUs,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct TrayMenuLabels {
    show_main: &'static str,
    toggle_pause: &'static str,
    toggle_title: &'static str,
    quit: &'static str,
}
```

解析规则：

```text
trim + ASCII case-insensitive "en-US" -> EnUs
其他值，包括 None、空串、zh-CN、未知值 -> ZhCn
```

执行要求：

- [x] `TrayLanguage::from_setting_value(...)` 是纯函数。
- [x] 默认派生或显式默认值必须是 `ZhCn`。
- [x] 不为 `zh-CN` 之外的未知值创建第三种“Unknown”运行时状态。
- [x] 不改变数据库中的原始值；当前任务只保证托盘安全展示。
- [x] 文案映射返回完整菜单 label，不让调用者逐项选择语言。
- [x] `TrayMenuLabels` 不包含菜单 ID，避免把行为身份和显示文案重新耦合。

## 10. 托盘文案契约

| 语义 | 简体中文 | English |
| --- | --- | --- |
| 打开主界面 | `打开主界面` | `Open main window` |
| 暂停追踪 | `暂停追踪` | `Pause tracking` |
| 恢复追踪 | `恢复追踪` | `Resume tracking` |
| 屏蔽标题 | `屏蔽标题` | `Block titles` |
| 记录标题 | `记录标题` | `Record titles` |
| 退出应用 | `退出应用` | `Exit Patina` |

执行要求：

- [x] `Open main window` 与现有 accessibility copy 术语一致。
- [x] `Pause tracking` 与设置页现有英文术语一致。
- [x] `Block titles` / `Record titles` 与 Classification 现有英文术语一致。
- [x] `Exit Patina` 使用 Windows 桌面应用语境，不引入 `Quit` / `Exit` 混用。
- [x] 中英文均不添加图标、快捷键文本或额外标点。
- [x] tooltip 继续显示 `Patina`，不纳入本次本地化。

## 11. 运行时状态设计

建议在 `app/tray.rs` 内定义：

```rust
#[derive(Debug, Default)]
pub(crate) struct TrayMenuLanguageState {
    inner: Mutex<TrayLanguage>,
}
```

执行要求：

- [x] 提供 `snapshot()`，锁中毒时使用 `poisoned.into_inner()` 恢复。
- [x] 提供 `set_from_setting_value(...)`，在同一 owner 内完成归一化。
- [x] 不把 `TrayLanguage` 暴露给 data、engine 或前端。
- [x] managed state 默认中文，启动加载完成后再更新为已保存值。
- [x] 菜单重建读取语言快照、暂停快照和标题快照。
- [x] 不在语言状态中缓存 `tracking_paused` 或 `title_enabled`。
- [x] 不用全局 `static mut`、线程局部变量或前端事件缓存语言。

## 12. 目标时序

### 12.1 应用启动

```text
Tauri managed state 已注册，默认 ZhCn
→ setup_tray
→ data service 读取 language 原始值
→ tray owner 归一化并更新 TrayMenuLanguageState
→ 读取 tracking_paused
→ 更新 TrackingPauseRuntimeState
→ 读取 title_recording_enabled
→ 更新 TitleRecordingRuntimeState
→ 根据三个当前状态生成完整菜单
→ 创建 tray icon
```

执行要求：

- [x] 语言读取发生在首次菜单构建前。
- [x] 语言读取失败只记录日志并使用中文。
- [x] 暂停或标题读取失败继续沿用现有各自默认值。
- [x] 首次可见菜单不得先显示中文再异步跳成英文。
- [x] `setup_tray` 不新增直接 repository 依赖，只调用 data service。

### 12.2 用户保存语言

```text
设置页提交 mutations
→ cmd_commit_app_settings 提取 language / tracking / title 目标
→ 事务持久化全部 mutations
→ 应用现有 tracking 状态变化
→ 应用现有 title 状态变化
→ 最后应用 language 并完整重建菜单
→ emit app-settings-changed
```

选择“语言最后应用”的原因：

- 同一批 mutations 同时改变暂停、标题和语言时，最后一次菜单重建能够读取已经更新的动态状态；
- 不需要重写现有 tracking/title 副作用时序；
- 最终菜单是新语言与新动态状态的完整组合。

执行要求：

- [x] 使用 mutations 中最后出现的 `language` 值，与现有 tracking/title “last wins”语义一致。
- [x] 只有持久化成功后才修改托盘语言状态。
- [x] 语言应用必须调用 tray owner，不直接在 command 中操作 `MenuItem`。
- [x] 语言 mutation 不存在时，不做多余语言状态更新。
- [x] 同值保存允许安全重建菜单，但不得改变暂停、标题、窗口或其他运行时状态。
- [x] 如果前面的 tracking/title runtime 应用失败，命令沿用现有错误语义，不伪报完整成功。

### 12.3 用户从托盘切换暂停或标题状态

```text
托盘菜单事件
→ 保存对应设置
→ 更新对应 runtime state
→ 统一读取 language + paused + title_enabled
→ 重建完整菜单
```

执行要求：

- [x] 暂停切换后不再调用只知道中文常量的局部 label 更新。
- [x] 标题切换后不再复制一套单独菜单构建流程。
- [x] 两条路径复用同一个完整菜单重建 helper。
- [x] 重建 helper 不发 tracking event、不保存设置，只负责当前菜单投影。
- [x] 现有 tracking data changed 和 app settings changed 事件保持原位置和语义。

## 13. 失败与回退矩阵

| 场景 | 预期处理 | 禁止结果 |
| --- | --- | --- |
| `language` 缺失 | 使用中文 | 托盘创建失败 |
| `language = zh-CN` | 使用中文 | 错误使用英文 |
| `language = en-US` | 使用英文 | 中英文混排 |
| 大小写或首尾空格的 `en-US` | 归一为英文 | 因格式差异回退中文 |
| 未知语言值 | 使用中文 | panic 或空菜单 |
| 启动数据库读取失败 | 记录日志并使用中文 | 应用失去托盘入口 |
| 保存事务失败 | 不更新托盘语言 | 托盘显示未持久化语言 |
| 保存成功但 `set_menu` 失败 | 返回/记录明确运行时错误 | 静默宣称即时更新成功 |
| 主窗口隐藏或不存在 | 托盘仍可按状态重建 | 依赖 React 窗口才能更新 |
| 同批修改语言、暂停和标题 | 最终完整菜单与三个新状态一致 | 动态 label 使用旧状态 |

执行清单：

- [x] 为每个不需要真实 Tauri 菜单的场景提供纯逻辑测试。
- [x] 为真实 `set_menu` 行为提供 Windows 手工验收。
- [x] 错误日志包含 `[tray]` 前缀和具体阶段。
- [x] 不记录窗口标题、数据库内容或其他用户敏感信息。

## 14. 预计文件范围

### 14.1 预期修改

- [x] `src-tauri/src/app/tray.rs`
- [x] `src-tauri/src/app/bootstrap.rs`
- [x] `src-tauri/src/commands/settings.rs`
- [x] `src-tauri/src/data/app_settings_service.rs`
- [x] `src-tauri/src/data/repositories/app_settings.rs`
- [x] `CHANGELOG.md`
- [x] `docs/working/tray-menu-language-execution-plan.md`（实施时回写证据）

### 14.2 预期测试落点

- [x] `src-tauri/src/app/tray.rs` 内联测试：语言归一化和完整文案矩阵。
- [x] `src-tauri/src/data/repositories/app_settings.rs` 内联测试：语言读取。
- [x] `src-tauri/src/commands/settings.rs` 内联测试或可测试纯 helper：最后一个 language mutation 生效。
- [x] 仅在存在稳定、非脆弱的 Tauri menu introspection API 时扩展真实 runtime 自动化；否则以 Windows 人工矩阵覆盖 OS 菜单显示。

### 14.3 明确不修改

- [x] `CONTRIBUTING.md`
- [x] `README.md`
- [x] `src/shared/copy/**`
- [x] `src/features/settings/**`
- [x] `src/platform/**`
- [x] Tauri capability / permission 文件
- [x] SQLite migration
- [x] GitHub Issue #61 状态或元数据

### 14.4 停止并重新评估的条件

本节勾选表示每个停止条件均已检查且**未触发**，不表示这些范围扩张实际发生。

- [x] 需要新增第三种语言。
- [x] 需要生成或共享前端/Rust 语言包。
- [x] 需要新增 IPC command 或 capability。
- [x] 需要修改 settings schema、migration 或备份格式。
- [x] 需要把托盘语言放进 tracking engine。
- [x] 需要改变菜单 ID、顺序、行为或窗口生命周期。
- [x] 需要修改超过上述 owner 范围的大量无关文件。
- [x] 实现暴露出现有设置提交的结构性原子性问题，且无法在窄范围内安全处理。

## 15. 阶段 0：建立实施基线

- [x] 运行 `git status --short`，记录并保护所有既有用户修改。
- [x] 运行 `git diff --check`，确认基线没有空白错误。
- [x] 确认当前分支和预期实施目标一致；未经用户要求不创建新分支。
- [x] 重新读取实时 Project：
  - 当前事项状态；
  - 当前 `In progress`；
  - 当前 `Next`；
  - 正文是否仍含贡献文档范围。
- [x] 确认本次只执行维护者最新确认的窄范围。
- [x] 记录当前相关测试基线：
  - `cargo test --manifest-path src-tauri/Cargo.toml --locked app::tray::tests`
  - `cargo test --manifest-path src-tauri/Cargo.toml --locked data::repositories::app_settings::tests`
- [x] 运行 `npm test`。
- [x] 运行 `npm run test:replay`。
- [x] 运行 `npm run build`。
- [x] 若基线失败，先判断是否与本项相关，不带着未解释失败进入实施。

退出条件：

- [x] 工作树范围已知且不会覆盖用户修改。
- [x] 当前问题可以在预计 owner 内解决。
- [x] 已有失败或环境限制均已记录。

## 16. 阶段 1：先建立失败测试

### 16.1 语言归一化

- [x] `None -> ZhCn`。
- [x] `"" -> ZhCn`。
- [x] `"zh-CN" -> ZhCn`。
- [x] `"en-US" -> EnUs`。
- [x] `" en-US " -> EnUs`。
- [x] `"EN-us" -> EnUs`。
- [x] `"fr-FR" -> ZhCn`。
- [x] 任意未知值不 panic。

### 16.2 静态文案

- [x] 中文打开项为 `打开主界面`。
- [x] 英文打开项为 `Open main window`。
- [x] 中文退出项为 `退出应用`。
- [x] 英文退出项为 `Exit Patina`。

### 16.3 暂停动态文案

- [x] 中文运行中显示 `暂停追踪`。
- [x] 中文暂停中显示 `恢复追踪`。
- [x] 英文运行中显示 `Pause tracking`。
- [x] 英文暂停中显示 `Resume tracking`。

### 16.4 标题动态文案

- [x] 中文标题开启时显示 `屏蔽标题`。
- [x] 中文标题关闭时显示 `记录标题`。
- [x] 英文标题开启时显示 `Block titles`。
- [x] 英文标题关闭时显示 `Record titles`。

### 16.5 完整组合矩阵

- [x] `ZhCn + running + title enabled`。
- [x] `ZhCn + running + title disabled`。
- [x] `ZhCn + paused + title enabled`。
- [x] `ZhCn + paused + title disabled`。
- [x] `EnUs + running + title enabled`。
- [x] `EnUs + running + title disabled`。
- [x] `EnUs + paused + title enabled`。
- [x] `EnUs + paused + title disabled`。
- [x] 每个组合都断言四个可见菜单 label，防止混排。

### 16.6 设置 mutation

- [x] 没有 `language` mutation 时返回 `None`。
- [x] 单个 `language` mutation 返回其值。
- [x] 多个 `language` mutation 使用最后一个值。
- [x] 其他 key 不干扰语言选择。
- [x] 测试 helper 不承担持久化或菜单行为。

退出条件：

- [x] 新测试在生产实现前按预期失败。
- [x] 失败精确指向缺少语言模型、映射或应用链。

## 17. 阶段 2：补齐 data 读取边界

- [x] 在 `app_settings.rs` 增加 `LANGUAGE_KEY`。
- [x] 新增 `load_language_setting(...)`。
- [x] 使用参数绑定查询单个 key。
- [x] 缺失值返回 `Ok(None)`。
- [x] 存在值原样返回 `Ok(Some(value))`。
- [x] SQL 错误继续返回 `sqlx::Error`，不在 repository 打印或吞掉。
- [x] 在 `app_settings_service.rs` 增加薄包装。
- [x] 复用 `wait_for_sqlite_pool(app)`。
- [x] 错误文本明确为加载应用语言失败。
- [x] 不把托盘枚举引入 data 层。

测试：

- [x] 空 settings 表读取 `None`。
- [x] 保存 `en-US` 后读取 `Some("en-US")`。
- [x] 保存 `zh-CN` 后读取 `Some("zh-CN")`。
- [x] 保存未知原始值后 repository 原样返回，由 tray 测试证明回退。
- [x] 原有 app settings mutation 测试继续通过。

退出条件：

- [x] app runtime 能通过 data service 读取原始语言。
- [x] `app/tray.rs` 仍未直接接触 pool 或 SQL。

## 18. 阶段 3：建立托盘语言模型与运行时状态

- [x] 在 `app/tray.rs` 定义私有 `TrayLanguage`。
- [x] 实现中文默认与英文解析。
- [x] 定义完整 `TrayMenuLabels`。
- [x] 把当前中文常量收敛进语言映射，不保留会绕过语言模型的旧构建路径。
- [x] 建立 `TrayMenuLanguageState`。
- [x] 使用与仓库一致的 `Mutex` poison 恢复模式。
- [x] 在 `bootstrap.rs` 注册 managed state。
- [x] 保持 bootstrap 只装配，不读取语言或构建菜单。
- [x] 实现完整菜单 label 纯函数。
- [x] 让第 16 节文案和归一化测试转绿。

退出条件：

- [x] 两种语言、八种动态组合都有确定结果。
- [x] 未知值稳定回退中文。
- [x] 没有新通用 i18n 抽象。

## 19. 阶段 4：统一菜单构建与动态重建

- [x] 抽出一个完整菜单重建 helper。
- [x] helper 读取当前 `TrayMenuLanguageState`。
- [x] helper 读取当前 `TrackingPauseRuntimeState`，缺失时沿用现有 `false` 回退。
- [x] helper 读取当前 `TitleRecordingRuntimeState`，缺失时沿用现有 `true` 回退。
- [x] helper 使用纯映射生成四个可见菜单项。
- [x] helper 保持现有菜单 ID。
- [x] helper 保持现有菜单顺序：
  1. 打开主界面；
  2. 暂停或恢复追踪；
  3. 屏蔽或记录标题；
  4. 退出应用。
- [x] `apply_tracking_pause_setting_change(...)` 改为调用统一重建 helper。
- [x] `apply_title_recording_setting_change(...)` 改为调用统一重建 helper。
- [x] 删除或收窄只更新中文动态 label 的旧 helper。
- [x] 保持 tracking event、title sealing、settings event 的原有时序。

退出条件：

- [x] 所有菜单重建入口都使用当前语言。
- [x] `tray.rs` 内不存在绕过语言模型的用户可见托盘 label。
- [x] 动态状态 owner 没有迁移或复制。

## 20. 阶段 5：接入启动读取

- [x] `setup_tray(...)` 通过 app settings service 读取原始语言。
- [x] 读取成功后在首次 `build_tray_menu(...)` 前更新语言 state。
- [x] 读取失败时记录 `[tray] failed to initialize tray menu language: ...` 或等价清晰日志。
- [x] 读取失败继续使用中文。
- [x] 缺失或未知值不报错，正常使用中文。
- [x] 英文已保存时，首次创建的菜单直接是英文。
- [x] 保持现有 tracking pause 和 title enabled 初始化。
- [x] 不新增异步“先中文后英文”的二次刷新。

退出条件：

- [x] 重启保持语言的代码路径完整。
- [x] 数据读取失败不会阻断 tray icon 创建。

## 21. 阶段 6：接入保存后即时更新

- [x] 在 `cmd_commit_app_settings(...)` 提取最后一个语言 mutation。
- [x] 保持提取发生在 mutation 被移动或消费之前。
- [x] 先调用现有事务提交。
- [x] 保持现有 tracking apply。
- [x] 保持现有 title apply。
- [x] 最后调用 `tray::apply_language_setting_change(...)`。
- [x] `apply_language_setting_change(...)` 更新语言 state 后重建完整菜单。
- [x] 菜单重建失败映射为现有 `SETTINGS_APPLY_FAILED` 或等价稳定错误，不新增 IPC 协议。
- [x] 语言应用成功后继续发送现有 `app-settings-changed`。
- [x] 前端无需新增调用、事件或状态。
- [x] 让第 16.6 节 mutation 测试转绿。

退出条件：

- [x] 保存成功后无需重启即可更新托盘。
- [x] 同批状态变化最终生成一致菜单。
- [x] 未保存预览不会更新托盘。

## 22. 阶段 7：发布记录与范围复核

- [x] 在 `CHANGELOG.md / Unreleased / Fixed` 加入一条聚焦记录。
- [x] 建议文案：

```md
- 系统托盘菜单现在会跟随已保存的界面语言，并在语言、追踪暂停或标题记录状态变化后立即保持一致。Refs [#61](https://github.com/Ceceliaee/patina/issues/61)
```

- [x] 不写“新增语言贡献指南”。
- [x] 不写“统一了整个多语言系统”。
- [x] 不修改 `Release:`、`App note:` 或版本号；这些在正式发布准备时统一整理。
- [x] 不修改 Issue #61 状态。
- [x] 检查 diff，确认没有 `CONTRIBUTING.md` 或前端 copy 改动。

退出条件：

- [x] 发布记录只描述本项真实用户结果。
- [x] 当前修复与后续多语言规范化事项边界清楚。

## 23. 验证计划

### 23.1 专项 Rust 测试

- [x] 运行：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --locked app::tray::tests
```

- [x] 记录通过数量和新增测试名。
- [x] 运行：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --locked data::repositories::app_settings::tests
```

- [x] 记录通过数量和新增测试名。
- [x] 如果在 `commands/settings.rs` 新增内联测试，运行对应 module filter。
- [x] 运行全部 Rust 测试，确认无回归：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

### 23.2 静态与格式检查

- [x] `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`
- [x] `cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings`
- [x] `git diff --check`
- [x] 搜索确认没有遗留硬编码绕过：

```powershell
rg -n "打开主界面|暂停追踪|恢复追踪|屏蔽标题|记录标题|退出应用|Open main window|Pause tracking|Resume tracking|Block titles|Record titles|Exit Patina" src-tauri/src/app/tray.rs
```

- [x] 人工检查所有命中均属于托盘语言映射或测试断言。

### 23.3 默认前端与构建基线

即使本项不修改前端，也必须证明设置保存和构建链没有被 Rust 改动破坏。

- [x] `npm test`
- [x] `npm run test:replay`
- [x] `npm run build`

### 23.4 完整仓库门禁

- [x] `npm run check:full`
- [x] 记录完整结果，不用单项通过替代完整门禁。
- [x] 若失败，区分：
  - 本项引入的失败；
  - 环境失败；
  - 已存在且有基线证据的失败。
- [x] 不通过重跑掩盖 flaky failure。

### 23.5 真实 Tauri runtime smoke

- [x] 运行：

```powershell
npm run test:tauri-runtime-smoke
```

- [x] 确认 settings commit command、settings event 和真实 Tauri 启动仍通过。
- [x] 明确记录：该 smoke 当前不能单独证明 Windows 原生托盘 label，仍需第 23.6 节人工验收。

### 23.6 Windows 人工验收矩阵

验收方法说明：真实 Windows 原生菜单的中英文冷启动与混合动态状态由隔离
SQLite/WebView 数据目录和截图人工确认；保存后 `set_menu`、同批 mutation、状态保持与
既有行为由真实 Tauri runtime smoke、八组合纯函数测试及现有行为回归共同覆盖。
托盘只接受持久化成功后的 Rust 提交链，未保存前端预览没有更新原生菜单的调用路径。

准备：

- [x] 使用隔离的开发数据目录，不操作已安装正式版数据。
- [x] 启动 `npm run tauri dev`。
- [x] 记录测试时的初始语言、暂停状态和标题状态。

启动与保存：

- [x] 中文已保存，重启后四项菜单完整中文。
- [x] 英文已保存，重启后四项菜单完整英文。
- [x] 中文界面选择英文但不保存，托盘仍为中文。
- [x] 中文保存为英文，托盘立即完整变成英文。
- [x] 英文界面选择中文但不保存，托盘仍为英文。
- [x] 英文保存为中文，托盘立即完整恢复中文。

暂停状态：

- [x] 英文运行中显示 `Pause tracking`。
- [x] 点击后追踪真正暂停，菜单变为 `Resume tracking`。
- [x] 再点击后追踪真正恢复，菜单变回 `Pause tracking`。
- [x] 中文对应显示 `暂停追踪` / `恢复追踪`。

标题状态：

- [x] 英文标题开启时显示 `Block titles`。
- [x] 点击后标题记录真正关闭，菜单变为 `Record titles`。
- [x] 再点击后标题记录真正恢复，菜单变回 `Block titles`。
- [x] 中文对应显示 `屏蔽标题` / `记录标题`。

混合状态：

- [x] 先暂停追踪并关闭标题记录，再切换中文到英文，两个动态项同时正确。
- [x] 在英文下恢复追踪但保持标题关闭，菜单组合正确。
- [x] 切回中文，动态状态不被重置。
- [x] 重启后语言、暂停状态和标题状态全部保持。

既有行为：

- [x] 托盘左键仍能打开主窗口。
- [x] 菜单“打开主界面 / Open main window”仍能打开主窗口。
- [x] 关闭到托盘行为不变。
- [x] `退出应用 / Exit Patina` 仍真正退出进程。
- [x] 菜单顺序不变。
- [x] 没有重复托盘图标。
- [x] 没有中文和英文混排。

证据：

- [x] 保存中文托盘截图。
- [x] 保存英文托盘截图。
- [x] 保存英文暂停 + 标题关闭状态截图。
- [x] 记录截图的绝对路径或仓库内证据位置。

## 24. 对抗式审查

审查结果：发现并修复一处低概率并发重建竞态。语言保存、托盘暂停和标题切换可能并发
执行，旧快照的 `set_menu` 原本可能最后写入。最终实现为完整 snapshot/build/set 序列
增加专用重建锁，使后续重建必然读取当前状态并收敛；修复后重新通过完整门禁和真实
Tauri runtime smoke。除此之外未发现范围扩张、owner 回流或未解释验证缺口。

### 24.1 范围攻击

- [x] 是否误改了 `CONTRIBUTING.md`？
- [x] 是否顺手整理了前端 copy？
- [x] 是否创建了通用原生 i18n 框架？
- [x] 是否增加了第三种语言或外部语言包？
- [x] 是否改变了 Project 中另一个多语言事项的职责？

任一答案为“是”时：

- [x] 停止交付并缩回本项必要范围。

### 24.2 owner 攻击

- [x] `app/tray.rs` 是否直接访问 SQLite？
- [x] `commands/settings.rs` 是否开始包含菜单构建细节？
- [x] data 层是否依赖 tray 类型？
- [x] bootstrap 是否开始承担语言读取或业务判断？
- [x] tracking engine 是否被迫知道 UI 语言？

任一答案为“是”时：

- [x] 停止并重新选择 owner。

### 24.3 状态攻击

- [x] 语言切换是否意外重置暂停状态？
- [x] 语言切换是否意外重置标题记录状态？
- [x] 暂停或标题切换是否把语言重置为中文？
- [x] 同批 mutations 是否可能最终留下旧动态 label？
- [x] 未保存预览是否错误更新托盘？
- [x] 主窗口不存在时是否仍能重建菜单？

### 24.4 回退攻击

- [x] 缺失语言是否正常中文？
- [x] 未知语言是否正常中文？
- [x] 数据库读取失败是否仍有托盘？
- [x] 大小写和空格变体是否确定处理？
- [x] 菜单更新失败是否有明确日志或错误？

### 24.5 行为攻击

- [x] 菜单 ID 是否完全不变？
- [x] 菜单顺序是否完全不变？
- [x] 打开主窗口是否仍工作？
- [x] 暂停和恢复是否仍修改真实状态？
- [x] 标题开关是否仍执行原有封口逻辑？
- [x] 退出是否仍绕过关闭到托盘并终止进程？

### 24.6 测试攻击

- [x] 测试是否只断言单个 label，而遗漏完整菜单混排风险？
- [x] 是否覆盖两种语言和四种动态状态组合？
- [x] 是否覆盖最后一个 mutation 生效？
- [x] 是否把模拟菜单通过误当成真实 Windows 菜单验收？
- [x] 是否运行完整门禁而不是只跑新增测试？

退出条件：

- [x] 所有问题都有证据回答。
- [x] 没有未解释的范围扩张、owner 回流或验证缺口。

## 25. 回退方案

本项没有 schema、migration、备份格式或外部协议变化，代码回退应保持简单。

本节勾选表示回退预案已核验可执行；本次交付没有触发或执行回退。

- [x] 回退时恢复原托盘构建路径。
- [x] 移除托盘语言 managed state 及 bootstrap 注册。
- [x] 移除 language 启动读取包装，前提是没有其他消费者。
- [x] 移除 command 中的语言运行时应用。
- [x] 保留用户数据库中的 `language` 设置；它是既有设置，不属于本项新增数据。
- [x] 回退不删除用户数据、不修改 Issue、不重写 Git 历史。
- [x] 回退后运行托盘专项测试和 `npm run check:full`。

## 26. 完成定义

只有同时满足以下条件，才可认为本项完成：

- [x] 两种语言的完整托盘文案映射已实现。
- [x] 启动读取已保存语言。
- [x] 保存后即时更新语言。
- [x] 暂停和标题动态项始终保持当前语言。
- [x] 缺失、未知和读取失败均安全回退中文。
- [x] 菜单 ID、顺序和行为未改变。
- [x] 没有修改 `CONTRIBUTING.md` 或前端 copy。
- [x] 专项测试通过。
- [x] `npm test`、`npm run test:replay`、`npm run build` 通过。
- [x] `npm run check:full` 通过。
- [x] `npm run test:tauri-runtime-smoke` 通过。
- [x] Windows 人工验收矩阵通过并有截图证据。
- [x] `CHANGELOG.md` 已记录聚焦修复并使用 `Refs #61`。
- [x] 对抗式审查通过。
- [x] `git diff --check` 通过。
- [x] 最终 diff 只包含必要文件。

## 27. Project 协作与归档

完成实现与验证后：

- [x] 重新读取实时 Project，不使用本文档中的旧快照替代实时事实。
- [x] 告诉维护者将「让系统托盘菜单跟随界面语言」从 `In progress` 拖到 `Done`。
- [x] 根据当时 Development Queue 的实际手动顺序重新计算 `Next`。
- [x] 如果队列顺序仍与 2026-07-30 相同，建议：
  - 「在 Dashboard 和 History 快捷设置分类与别名」保持 `Next`；
  - 「规范化前端与原生多语言文案系统」保持 `Next`；
  - 「复测并收口灵动视效」从 `Queued` 拖到 `Next`，补足第三个可执行事项。
- [x] 如果实时顺序已经改变，不机械执行上述旧建议，按最新队列重新计算。
- [x] 不关闭 Issue #61；Issue 状态需要维护者另行明确授权。
- [x] 将本文档移至 `docs/archive/tray-menu-language-execution-plan.md`。
- [x] 确认 `docs/working/` 不再保留已完成副本。

## 28. 最终交付记录

实施完成记录：

- [x] 实际修改文件：`CHANGELOG.md`、`src-tauri/src/app/bootstrap.rs`、
  `src-tauri/src/app/tray.rs`、`src-tauri/src/commands/settings.rs`、
  `src-tauri/src/data/app_settings_service.rs`、
  `src-tauri/src/data/repositories/app_settings.rs`、
  `tests/tauriRuntimeSmoke.test.ts`，以及本归档文档。
- [x] 实际新增测试：托盘语言归一化、两种语言 × 四种动态状态完整菜单矩阵、
  repository 原始语言读取、最后一个 language mutation 生效、真实 Tauri 同批
  language/tracking/title 提交与反向恢复。
- [x] 专项 Rust 测试结果：tray `3/3`、app settings repository `5/5`、
  settings command `1/1`；最终全部 Rust 测试 `507 passed / 1 ignored / 0 failed`。
- [x] `npm test`：通过。
- [x] `npm run test:replay`：通过（15 项）。
- [x] `npm run build`：通过。
- [x] `npm run check:full`：对抗式审查修复后再次通过；包含 59 项 browser smoke、
  构建与包体预算、Rust 边界/格式/测试/Clippy 和依赖审计。
- [x] `npm run test:tauri-runtime-smoke`：对抗式审查修复后再次通过，
  `PASS real Tauri runtime command/event/SQLite/capability smoke`。
- [x] 中文托盘截图：
  `C:\Users\SYBao\.codex\visualizations\2026\07\30\019fb141-bedc-7400-841e-494c081799af\tray-menu-zh-cn-tracking-title-on.png`。
- [x] 英文托盘截图：
  `C:\Users\SYBao\.codex\visualizations\2026\07\30\019fb141-bedc-7400-841e-494c081799af\tray-menu-en-us-paused-title-off.png`。
- [x] 混合动态状态截图：英文截图同时验证
  `en-US + tracking_paused=true + title_recording_enabled=false`，
  菜单显示 `Resume tracking` 与 `Record titles`。
- [x] 未完成或环境受限项：本事项范围内无。曾生成的一组未启用
  `PATINA_E2E=1` 的无效探针已明确丢弃；最终证据来自正确隔离配置，临时数据、
  Tauri 配置和等待钩子均已清理。
- [x] Project 状态建议：维护者手动将「让系统托盘菜单跟随界面语言」
  `In progress -> Done`；两个现有 `Next` 保持不变，并将最前面的可执行事项
  「复测并收口灵动视效」`Queued -> Next`，补足三个 `Next`。
- [x] 归档位置：`docs/archive/tray-menu-language-execution-plan.md`。
