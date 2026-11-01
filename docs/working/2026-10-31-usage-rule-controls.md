# 使用限制规则操作

范围：将每日上限放到目标名称旁，提供开关、编辑每日上限和删除操作。保持现有紧凑行高、滚动间距和稳定列宽。

数据 owner 为工具规则 repository，运行时写入沿用 Tools mutation，界面沿用 Quiet Pro。新增启用状态独立于既有移除标记；已有移除规则保持隐藏。编辑保留规则身份并清除当天旧额度扩展，关闭和重新开启不重置当天提醒记录。

- [x] 完成持久化启用状态、更新上限与旧库升级，覆盖备份恢复及合并。
- [x] 完成三个操作、可访问名称、编辑验证与失败后保留状态。
- [x] 完成原生恢复复验并记录全部适用门禁结果。

使用拦截及 Git 发布不在本次范围内。定时提醒操作按下方后续请求追加。

## 已完成的验证

2026-10-31 本地验证：浏览器全量 228 项通过，最终工具页专项 17 项通过；覆盖 ToggleRight / ToggleLeft、待提交期间不闪暗、保持焦点、重复提交保护、编辑失败保留输入、删除和稳定滚动宽度。Rust 单元与集成测试、clippy、格式及边界检查通过。类型、lint、本地化、工具模型和共享 helper 检查通过。

最终前端构建与预算通过：初始 JS / CSS 为 200.62 KiB gzip，总量为 393.67 KiB gzip。本次清理无消费者的旧工具文案和重复样式，未进一步提高预算。

隔离 Tauri / WebView2 的 contracts、storage-restart 和 data-recovery 组通过；使用真实 SQLite 验证开关与上限落盘、延时兼容、Mini 权限拒绝、重启和存储迁移。data-recovery 首次在末尾的旧版本断言失败，数据库实际已升级至 19；同步断言并检查启用状态表后，整组复验通过。

## 剩余门禁

联网依赖审计仍报告现有开发依赖 minimatch、glob 的两项中等级别 advisory；Rust 审计通过。本次未修改依赖和锁文件，不宣称 `check:full` 全绿。依赖修复由后续依赖维护处理，依据[工程质量的依赖审计要求](../engineering-quality.md#5-默认验证门槛)完成后再关闭该门禁；本记录暂留 working。

## 定时提醒追加范围

2026-10-31 用户要求定时提醒使用同样的开关、编辑和删除按钮，并移除列表倒计时。左侧保留内容与日期时间；两类提醒共用 feature 内的行操作组件，图标为 16 px，点击区域为 28 px。

关闭保存为既有 status 列中的 paused 状态，不增加表或迁移，也不使用 cancelled 代替关闭。调度仅消费 scheduled；备份保留 paused，所有未结束提醒继续显示。编辑和开关通过 Tools mutation 更新原记录；已触发或已删除记录拒绝编辑。关闭保留原定时间，过期后开启先进入编辑，保存未来时间后才启用。

- [x] 在现有 repository、Tools mutation 和 IPC owner 中实现更新，保留提醒身份与删除语义。
- [x] 复用 Quiet Pro 图标动作和日期时间选择器，去掉倒计时及其无消费者的文案、旧状态和按钮样式。
- [x] 浏览器专项覆盖无闪暗、重复提交、失败保留输入、键盘开关、嵌套选择器、过期校验和关闭状态删除，18 项通过。
- [x] 完成默认门禁及原生权限、落盘验证，记录最终结果。

追加范围最终验证：`pnpm run check`、`pnpm run check:rust` 与原生 contracts 组通过。Rust 测试 886 项通过、8 项按现有配置忽略，集成测试与 clippy 通过；原生验证使用独立进程和真实 SQLite，覆盖暂停、编辑、恢复、删除与权限拒绝。最终构建初始 JS / CSS 为 200.51 KiB gzip，总量为 393.80 KiB gzip，保持原有预算。

定时提醒的 engine 与 repository 实现分别归入各自的 `tools/timed_reminders.rs`，调用方直接引用该 owner，未增加转发兼容层或放宽模块规模检查。上方已有依赖审计告警仍保留，未在本次更新依赖。

## 2026-11-01 交接复核

最终提醒表单采用 5:3:2 的内容、时间和重复列宽。`pnpm run check:full` 中的前端检查通过，包含 231 项浏览器测试、类型、lint、覆盖率、构建及体积预算；Rust 检查通过，包含 900 项单元测试、8 项既有忽略、原生探针集成测试和 9 项资源示例测试，以及格式、边界和 clippy。

该命令最终因依赖审计失败退出。联网审计仍报告 `minimatch` 的 `GHSA-g3hv-75wg-m249` 与 `glob` 的 `GHSA-3g3m-2fjr-6pw4`，均为开发工具链中的中等级别告警。注册表提供的修复版本分别要求 11.0.1 及 14.0.2 以上，需要跨主版本评估；此次交接保留依赖和锁文件，由依赖维护继续处理。

原生完整运行 `1793541231755-1c3f88f6-0b00-486a-9386-e6331d30cccf` 的 contracts、data-recovery、storage-restart 通过；webview-recovery 在恢复次数耗尽后的收尾断言失败，诊断为 `WebView teardown unconfirmed: CDP endpoint did not answer within 1000 ms`。窗口销毁日志、原生失败提示及继续落盘均已观察到，但调试目标的释放未得到确认。该问题继续由 `tests/tauriWebviewRecovery.ts` 与原生 WebView 生命周期 owner 排查，不把日志观察等同于完整恢复验收。

随后独立运行 window-lifecycle 通过，运行标识为 `1793541947896-83080f15-4968-49ff-8caa-df6f77f26107`。同一构建的 mini-input 在输入前置条件处失败：Windows 的 `SetPhysicalCursorPos` 返回失败，探针报告 `Cannot move to owned input target`。此次未完成 Mini 焦点及循环采样验证；需要可用的交互桌面，由 `tests/miniNativeProbe.ts` owner 复验。没有通过重复运行覆盖失败记录。

本次为当前开发进度的仓库交接，依赖安全与桌面完整验收仍未完成。本记录保留在 working。
