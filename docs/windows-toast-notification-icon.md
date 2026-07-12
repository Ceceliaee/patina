# Windows Toast 通知系统实现记录

## 概述

Windows 系统通知（Toast）功能为 Patina 的定时工具（番茄钟、倒计时、软件使用时间提醒、通用提醒）提供原生 WinRT 通知弹窗，支持：

- 标题与正文
- 左上角应用图标（AUMID + exe 图标提取，仅生产环境 MSI 安装生效）
- 正文/区域图标（`appLogoOverride` 图像）
- 工具特定操作按钮（暂停、跳过、延后提醒等）
- 点击通知正文激活主窗口
- 按钮点击触发对应工具操作
- 注册表 AUMID 注册（系统设置→通知列表展示）
- 开发环境/生产环境双模式

---

## 架构

### 双层通知机制（Two‑tier）

```
send_tool_alert()
  ├─ [cfg(windows) + should_use_dev_windows_toast_identity()]
  │   └─ platform::windows::notifications::send()   ← 自定义 WinRT Toast
  │       ├─ XmlDocument 构造 XML
  │       ├─ ToastNotificationManager → ToastNotifier
  │       ├─ TypedEventHandler 处理激活/按钮事件
  │       └─ SetCurrentProcessExplicitAppUserModelID + AUMID 注册表
  │
  └─ app.notification().builder().show()             ← Tauri 兜底
      └─ tauri-plugin-notification v2.3.3
          └─ notify-rust v4.17.0 (传递依赖)
              └─ tauri-winrt-notification v0.7.2 (传递依赖, windows v0.61.3)
```

### 文件地图

| 文件 | 层 | 职责 |
|------|-----|------|
| `src-tauri/src/engine/tools/mod.rs` | engine | `send_tool_alert()` 入口，读设置，调度通知 |
| `src-tauri/src/engine/tools/notification.rs` | engine | 封装 `send()`，构建按钮/回调，Guard |
| `src-tauri/src/platform/windows/notifications.rs` | platform | WinRT 通知核心：XML→显示+注册表 |
| `src-tauri/src/app/runtime.rs` | app | 启动时 `initialize()` AUMID + 图标写入 |
| `src-tauri/src/data/repositories/app_settings.rs` | data | 白名单 `enable_system_notifications` / `enable_in_app_notifications` |
| `src/shared/settings/appSettings.ts` | shared FE | `enableSystemNotifications`、`enableInAppNotifications` 字段 |
| `src/features/settings/components/SettingsInterfacePanel.tsx` | FE | 界面切换开关 |

### 关键 Guard：`should_use_dev_windows_toast_identity()`

`src-tauri/src/engine/tools/notification.rs:364`

仅在 exe 位于 `target/debug/` 或 `target/release/` 目录时启用自定义 WinRT 路径。
否则回退 Tauri 兜底（不支持按钮、场景、图标）。

---

## 实现细节

### 1. AUMID 注册（`register_app_user_model_id`）

写入 `HKCU\Software\Classes\AppUserModelId\{app_id}`：

| 值名 | 值内容 | 用途 |
|------|--------|------|
| `DisplayName` | `Patina` | 系统设置→通知中的应用名称 |
| `ExePath` | `patina.exe` 全路径 | 从 exe 提取左上角小图标 |
| `ShowInSettings` | `1` | 在系统通知设置中显示 |

**不设置 `IconUri`**：该值仅影响系统设置→通知列表的图标，且会干扰 `ExePath` 的图标提取。左上角 Toast 小图标由 `ExePath` → exe 内置图标提取。

**已移除 `IconBackgroundColor`**：该值不影响 Toast 显示，此前设为 `#00000000`（透明）无实际效果。

### 2. 图标嵌入与写入（`write_embedded_icon`）

- 编译时 `include_bytes!("icons/icon.png")` 嵌入 512×512 主图标
- 写入 exe 同级目录（`patina-notification-icon.png`）
- 用于 Toast XML 中 `<image placement="appLogoOverride">` 的正文区域图标

### 3. Toast XML 构造

```
<toast duration="long">
  <visual>
    <binding template="ToastGeneric">
       <image placement="appLogoOverride"
              src="file:///E:/path/patina-notification-icon.png"
              alt=""/>
      <text id="1">提醒</text>
      <text id="2">时间到了</text>
    </binding>
  </visual>
  <actions>
    <action content="{n} 分钟后提醒" arguments="snooze_10min"/>
    <action content="知道了" arguments="dismiss"/>
  </actions>
</toast>
```

- `Url::from_file_path()` 生成合法 `file:///` URI（自动编码空格、特殊字符）
- `xml_escape()` 自定义 XML 转义，无外部依赖

### 4. 按钮动作处理

| 动作 | 触发工具 | 行为 |
|------|----------|------|
| `dismiss` | 全部 | 结束提醒 |
| `pause` | Pomodoro | 暂停当前番茄钟 |
| `skip` | Pomodoro | 跳过当前阶段 |
| `pomodoro_snooze` | Pomodoro | 延后提醒 |
| `countdown_reset` | Countdown | 重置倒计时 |
| `countdown_add_5min` | Countdown | 增加 5 分钟 |
| `snooze_10min` | Reminder | 10 分钟后重新提醒 |
| `snooze_today` | SoftwareReminder | 今日不再提醒 |
| 空（点击正文） | 全部 | 激活主窗口 |

### 5. 设置集成

- 前端开关：`SettingsInterfacePanel.tsx` → `enableSystemNotifications`、`enableInAppNotifications`
- 存储键：`enable_system_notifications` / `enable_in_app_notifications`（SQLite + 白名单）
- 默认值：均为 `true`
- `send_tool_alert()` 异步读 DB 分别决定是否发送系统通知和是否弹应用内通知

---

## 前端状态

### SettingsInterfacePanel.tsx

系统通知开关（`enableSystemNotifications`）和应用内通知开关（`enableInAppNotifications`）位于"界面"（Interface）设置面板，均使用 `Toggle` 组件，标签文案支持中英文。

---

## 已知限制

### 左上角应用图标在开发模式下无法显示

**问题**：Windows Toast 通知的左上角小图标（位于标题文字左侧的 48×48 区域）在 `npm run tauri dev` 开发模式下始终显示为空白白色方块。

**根因**：
Windows 渲染 Toast 顶部应用图标的优先级：
1. 检查通知绑定的 AUMID
2. **在开始菜单中查找绑定了相同 AUMID 的快捷方式**，提取快捷方式关联的 exe 内置图标
3. 未找到快捷方式时，读取注册表 AUMID 关联的 ExePath 提取图标（**此方式在 Toast 弹窗上不可靠**）
4. 完全匹配不到 → 显示空白方格占位

**为何开发模式不可行**：
- `tauri dev` 不会创建开始菜单快捷方式，因此优先级 2 失效
- `ExePath` 注册表（优先级 3）对 Toast banner 的图标提取在部分 Windows 版本上不可靠
- 我们之前尝试的 `appLogoOverride` XML（方案 A）、AUMID `IconUri`（方案 B）、`windows` 直发（方案 C）均针对的是正文区域图标（`appLogoOverride`），与左上角应用图标是**完全不同的两套机制**

**修复方式**：
手动创建带 AUMID 绑定的开始菜单快捷方式，以管理员 PowerShell 执行：
```powershell
$s = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Patina.lnk")
$s.TargetPath = "E:\Patina v1.8.2\patina\src-tauri\target\debug\patina.exe"
$s.WorkingDirectory = "E:\Patina v1.8.2\patina\src-tauri\target\debug"
$s.AppUserModelID = "com.ceceliaee.patina"
$s.Save()
taskkill /f /im explorer.exe; Start-Process explorer.exe
```

**生产环境**：Tauri MSI 安装包自动创建带正确 AUMID 的开始菜单快捷方式，左上角图标无需额外配置即正常显示。

---

## 依赖分析

### 直接依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `windows` | 0.62.2 | Win32 + WinRT API：注册表、通知、XML、Foundation |
| `url` | 2 | `Url::from_file_path()` 生成 `file:///` URI |
| `tauri-plugin-notification` | 2 | 跨平台兜底通知 |
| `tauri-winrt-notification` | ~~0.7.2~~ **已移除** | 原直接依赖，替换为 `windows` 直发 |

### 新增 windows feature

`Data_Xml_Dom`、`UI_Notifications`、`Foundation`

### 传递依赖中的 windows 版本冲突

- 项目直接依赖：`windows` v0.62.2
- `tauri-plugin-notification` → `notify-rust` → `tauri-winrt-notification` → `windows` v0.61.3

两版 `windows` 共存，虽不影响编译但增加构建时间。

---

## 优化机会

### ✅ 已完成

1. **[冗余注册表写入]** `register_app_user_model_id()` 在 `initialize()`（`call_once`）和 `send()`（每次通知）中都被调用。注册表值在不同通知间不变，`send()` 中的调用是冗余的，已移除。

2. **[幽灵参数]** `runtime.rs` 向 `notifications::initialize()` 传递 `resource_dir()/icons/icon.ico` 路径，但该参数被 `initialize()` 标记为 `_icon_path` 完全忽略。参数与调用均已清理。

5. **[空 Scenario 生成脏 XML]** `Scenario::Default` 对应 `""`，在 format 中产生 `<toast duration="long" >`（尾部多余空格）。已改用条件 `push_str` 避免空属性。

6. **[日志泄漏]** `eprintln!("[notifications] ...")` 在 release 构建中也会输出。已全部移除（`notifications.rs` 和 `notification.rs`）。

8. **[冗余 hint-crop]** `build_icon_xml()` 输出 `hint-crop="none"`，该属性仅在圆形裁剪时需要。已移除。

11. **[图标后台回退]** `write_embedded_icon()` 有 exe 目录失败时回退 `%TEMP%` 的兜底逻辑。已简化为单一 exe 目录路径。

12. **[未使用 IconBackgroundColor]** `register_app_user_model_id()` 写入无实际用途的 `IconBackgroundColor` 注册表值。已移除。

13. **[未使用 app_name]** `ToastOptions` 包含 `app_name` 字段但仅用于已移除的冗余注册表调用。已从结构体移除。

### 未完成（待评估）

3. **[xml_escape 自制 vs 标准库]** `xml_escape()` 手写 XML 转义，与 `quick_xml::escape` 功能重复。可考虑统一使用 `quick_xml`（已是 `tauri-winrt-notification` 的传递依赖，本项目中仍间接存在）。

4. **[构建体积]** `windows` crate 两个版本（0.62.2 + 0.61.3）共存，增加构建时间和输出体积。长远可考虑推动 `tauri-winrt-notification` 升级到最新 `windows`，或移除 `tauri-plugin-notification` 依赖。

7. **[图标尺寸]** 嵌入的是 `icon.png`（512×512），而 toast `appLogoOverride` 规范建议 48×48。可改用 `Square44x44Logo.png`（44×44，更接近）。目前不影响显示，因为 `Url::from_file_path()` 正常编码，Windows 会缩放。

9. **[actions 字符串分配]** 每次通知都分配 `String::new()` 并在有按钮时拼接。可用 `Option<String>` 表示无按钮场景。

10. **[windows feature 清单维护]** `Cargo.toml` 中 `windows` 的 feature 列表很长（30+ 项），部分可能已不再使用。建议定期审计并清理。

---

## 测试与验证

- `cargo check` ✓
- `tsc --noEmit` ✓
- `npm test` ✓（91 tests pass）
- 运行：`npm run tauri dev` → 触发定时器/番茄钟/提醒通知

### 日志关键输出

调试 `eprintln!` 日志已在清理中移除。如需诊断通知问题，可临时添加 `eprintln!` 或在 `set_process_app_user_model_id()`/`XmlDocument::LoadXml()` 等返回的错误中查看 `Result::Err` 描述。

---

## 参考

- [Toast content](https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/adaptive-interactive-toasts)
- [Quickstart: Send a local toast notification from a desktop app](https://learn.microsoft.com/en-us/windows/apps/design/shell/tiles-and-notifications/send-local-toast-desktop)
- [AppUserModelID](https://learn.microsoft.com/en-us/windows/win32/shell/appids)
- [docs/architecture.md](../architecture.md)
- [docs/engineering-quality.md](../engineering-quality.md)
- [docs/quiet-pro-component-guidelines.md](../quiet-pro-component-guidelines.md)
