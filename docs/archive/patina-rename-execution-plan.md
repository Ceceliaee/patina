# Patina 改名执行方案

## 归档结果

- [x] 代码侧产品显示名、README、GitHub 链接、issue 模板、active docs、发布标题和安装包命名已迁移到 `Patina`。
- [x] 本版本按决策保留 `com.timetracker*` identifier、`sqlite:timetracker.db` / `timetracker.db` 和 WebDAV credential target。
- [x] WebDAV 默认目录已迁移到 `/Patina`，并保留 `/TimeTracker` 远端备份合并路径。
- [x] 新旧自家进程名、旧备份格式、旧远端 index 和旧 localStorage key 均保留兼容读取或迁移。
- [x] 版本已同步到 `1.5.0`，`CHANGELOG.md` 已加入 2026-06-09 发布记录。
- [x] `npm run release:check` 已通过。
- [x] `npm run tauri build` 已验证生成 `patina.exe` 与 `Patina_1.5.0_x64-setup.exe`；本机缺少 `TAURI_SIGNING_PRIVATE_KEY`，最终签名发布需由带密钥的 CI/发布环境完成。
- [x] 旧名残留已复核：剩余项属于历史记录、保留的底层身份、数据库兼容、备份兼容、WebDAV 迁移来源、旧进程过滤、测试 fixture 或等待 GitHub/local 路径外部改名。

本文是一次性工作文档，用于指导将本项目从 `Time Tracker` 改名为 `Patina`。

它不是长期产品规则。执行完成、发布验证通过后，应将本文移动到 `docs/archive/`，或在确认不再需要后删除。

## 1. 目标与范围

- [ ] 将软件对外显示名从 `Time Tracker` 改为 `Patina`。
- [ ] 将 GitHub 仓库从 `Ceceliaee/time-tracking` 改为 `Ceceliaee/patina`。
- [ ] 将本地工作目录从 `Time Tracking` 改为 `Patina`。
- [ ] 将发布标题、安装包名称、README、issue 模板、应用内链接和更新配置同步到 `Patina`。
- [ ] 保留必要的旧名称兼容，避免破坏用户已有数据、备份、更新路径和自家进程过滤。

## 2. 非目标

- [ ] 不改变产品方向；仍保持个人、本地优先、Windows 桌面时间追踪工具定位。
- [ ] 不引入新的 UI 视觉方向；所有界面改名仍遵守 Quiet Pro。
- [ ] 不重写 `docs/archive/*` 中的历史事实，除非明确要做全历史文本统一。
- [ ] 不默认关闭、重开、标记或修改 GitHub issues。
- [ ] 不使用 issue-closing 关键词，例如 `Closes`、`Fixes`、`Resolves`。

## 3. 执行原则

- [ ] 用户可见名称优先统一为 `Patina`。
- [ ] 机器可读、兼容相关标识谨慎处理，先判断是否影响升级、数据目录、备份格式或更新链路。
- [ ] 新格式可以使用 `Patina`，旧格式必须继续可读。
- [ ] 修改 active docs 时同步长期规则；历史归档文档默认保留原语境。
- [ ] 本地目录改名放在代码提交、远端推送、GitHub 仓库改名之后执行。
- [ ] 每一轮改名后都运行残留搜索，确认剩余旧名称是否属于允许保留项。

## 4. 命名决策

执行前先冻结下面这些命名，避免中途出现第二套 slug。

- [ ] 显示名：`Patina`
- [ ] GitHub 仓库名：`patina`
- [ ] 本地文件夹名：`Patina`
- [ ] npm package name：`patina`
- [ ] Rust crate name：`patina`
- [ ] Rust lib name：`patina_lib`
- [ ] 发布标题：`Patina vX.Y.Z`
- [ ] Windows 安装包：`Patina_X.Y.Z_x64-setup.exe`
- [ ] 新备份文件名前缀：`Patina-backup-`
- [ ] 新 WebDAV 默认目录：`/Patina`

### 4.1 Tauri Identifier 决策

这是本次改名最高风险决策之一。本版本先不迁移底层身份。

- [ ] 正式版 identifier 保持 `com.timetracker`。
- [ ] 开发版 identifier 保持 `com.timetracker.dev`。
- [ ] 本地发布验证版 identifier 保持 `com.timetracker.local`。
- [ ] 本版本不把 identifier 改为 `com.ceceliaee.patina`。
- [ ] 本版本不迁移 app config 目录、app data 目录或 WebDAV credential target。
- [ ] 本版本不把 `sqlite:timetracker.db` / `timetracker.db` 改为 `sqlite:patina.db` / `patina.db`。
- [ ] 未来底层身份迁移单独作为后续版本处理。

### 4.2 未来底层身份迁移预留

未来版本如果要清理底层旧名，应单独建立执行方案，而不是混入本次改名。

- [ ] 目标 identifier 可评估为 `com.ceceliaee.patina`。
- [ ] 目标数据库名可评估为 `patina.db`。
- [ ] 迁移必须自动完成，不要求用户手动复制文件。
- [ ] 迁移必须幂等；重复启动不会重复覆盖新数据。
- [ ] 新身份已有数据时，不得用旧数据覆盖。
- [ ] 旧身份数据存在但新身份数据不存在时，复制旧数据到新身份目录。
- [ ] 复制成功后保留旧数据目录作为回滚兜底。
- [ ] 旧备份、旧远端备份迁移来源、旧 WebDAV 凭据和旧进程名过滤应继续兼容到迁移稳定后。

## 5. 基线扫描

执行前先确认旧名称分布。

- [ ] 搜索主要旧名称：

```powershell
rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!src-tauri/target/**' --glob '!dist-release/**' --glob '!updater-publish/**' "Time Tracker|Time Tracking|time-tracking|TimeTracker|time_tracker|timetracker|time-tracker|TimeTracking" .
```

- [ ] 将搜索结果分为下面几类：
  - [ ] 用户可见文案。
  - [ ] README、贡献指南、issue 模板、GitHub 链接。
  - [ ] Tauri 配置、窗口标题、托盘、通知。
  - [ ] 发布脚本、GitHub Actions、安装包命名、更新地址。
  - [ ] Rust crate、lib 名称、cfg 名称、exe 名称。
  - [ ] 自家进程过滤和分类默认映射。
  - [ ] 备份格式、WebDAV 默认目录、远端备份 index。
  - [ ] 测试 fixture 和断言。
  - [ ] `docs/archive/*` 历史资料。

- [ ] 建立允许残留清单：
  - [ ] 旧进程名兼容：`time_tracker.exe`、`time-tracker.exe`、`timetracker.exe`。
  - [ ] 旧备份格式兼容：`TimeTrackerBackup`。
  - [ ] 旧备份文件兼容：`TimeTracker-backup-*.zip`。
  - [ ] 旧 WebDAV 远端备份迁移来源：`/TimeTracker`。
  - [ ] 旧 GitHub URL redirect 或历史 release 链接。
  - [ ] `CHANGELOG.md` 历史版本记录。
  - [ ] `docs/archive/*` 历史文档。

## 6. 前端用户可见名称

- [ ] 修改 `index.html`：
  - [ ] `<title>Time Tracker</title>` 改为 `<title>Patina</title>`。

- [ ] 修改 `src/app/components/AppTitleBar.tsx`：
  - [ ] `APP_TITLE` 改为 `Patina`。

- [ ] 修改 `src/features/about/components/AboutPanel.tsx`：
  - [ ] About 页面主标题改为 `Patina`。

- [ ] 修改 `src/shared/copy/uiText.ts`：
  - [ ] 中文支持弹窗中的 `Time Tracker` 改为 `Patina`。
  - [ ] 英文支持弹窗中的 `Time Tracker` 改为 `Patina`。
  - [ ] 只替换已有介绍文案中的产品名，不借改名新增副标题或 slogan。

- [ ] 修改 widget 可见标题：
  - [ ] `src-tauri/src/app/widget.rs` 中 `Time Tracker Widget` 改为 `Patina Widget`。
  - [ ] `src/app/widget/widgetViewModel.ts` 中用户可见 widget 标题改为 `Patina Widget`。
  - [ ] 保留旧 widget 标题过滤，避免旧窗口或测试样本进入活动统计。

- [ ] 修改 Rust 侧窗口、托盘和通知 fallback：
  - [ ] `src-tauri/src/app/main_window.rs` 中主窗口标题改为 `Patina`。
  - [ ] `src-tauri/src/app/tray.rs` 中托盘 tooltip 改为 `Patina`。
  - [ ] `src-tauri/src/engine/tools/notification.rs` 中 fallback 应用名改为 `Patina`。

## 7. Tauri 配置

- [ ] 修改 `src-tauri/tauri.conf.json`：
  - [ ] `productName` 改为 `Patina`。
  - [ ] `identifier` 保持 `com.timetracker`。
  - [ ] `app.windows[0].title` 改为 `Patina`。
  - [ ] GitHub updater endpoint 改为 `https://github.com/Ceceliaee/patina/releases/latest/download/latest.json`。
  - [ ] R2 updater endpoint 暂时保留不变，除非 R2 路径策略也同步调整。

- [ ] 修改 `src-tauri/tauri.dev.conf.json`：
  - [ ] `productName` 改为 `Patina Dev`。
  - [ ] `identifier` 保持 `com.timetracker.dev`。
  - [ ] 开发窗口标题改为 `Patina Dev`。
  - [ ] GitHub updater endpoint 改为新仓库。

- [ ] 修改 `src-tauri/tauri.local.conf.json`：
  - [ ] `productName` 改为 `Patina Local`。
  - [ ] `identifier` 保持 `com.timetracker.local`。
  - [ ] 本地窗口标题改为 `Patina Local`。
  - [ ] GitHub updater endpoint 改为新仓库。

## 8. Package、Cargo 与 Exe 名称

- [ ] 修改 `package.json`：
  - [ ] `"name": "time-tracker"` 改为 `"name": "patina"`。

- [ ] 修改 `package-lock.json`：
  - [ ] 根 package name 改为 `patina`。
  - [ ] 确认 lockfile 没有不必要的依赖 churn。

- [ ] 修改 `src-tauri/Cargo.toml`：
  - [ ] `[package].name = "time_tracker"` 改为 `patina`。
  - [ ] `authors = ["Time Tracker maintainers"]` 改为 `["Patina maintainers"]`。
  - [ ] `[lib].name = "time_tracker_lib"` 改为 `patina_lib`。

- [ ] 修改 `src-tauri/src/main.rs`：
  - [ ] `time_tracker_lib::run()` 改为 `patina_lib::run()`。

- [ ] 修改 cfg 名称：
  - [ ] `src-tauri/build.rs` 中 `time_tracker_local_build` 改为 `patina_local_build`。
  - [ ] `src-tauri/src/lib.rs` 中 cfg 条件同步改为 `patina_local_build`。
  - [ ] `src-tauri/src/app/runtime.rs` 中 cfg 条件同步改为 `patina_local_build`。

- [ ] 运行 Rust 检查，让 `src-tauri/Cargo.lock` 中 crate 名随之更新。

```powershell
cargo check --manifest-path src-tauri/Cargo.toml --quiet
```

## 8.1 本版本不迁移 SQLite 与数据目录

本版本只做产品显示名、仓库名和发布命名迁移。底层身份、数据库和数据目录留给未来版本单独迁移。

- [ ] 不新增 `src-tauri/src/data/identity_migration.rs`。
- [ ] 不修改 `src-tauri/src/data/sqlite_pool.rs` 中的 `SQLITE_DB_NAME`。
- [ ] 保持 Rust 数据库 URL：`sqlite:timetracker.db`。
- [ ] 保持 Rust 数据库文件名：`timetracker.db`。
- [ ] 保持前端 SQLite 入口 `src/platform/persistence/sqlite.ts` 中的 `sqlite:timetracker.db`。
- [ ] 保持 Tauri SQL preload：
  - [ ] `src-tauri/tauri.conf.json` 继续使用 `sqlite:timetracker.db`。
  - [ ] `src-tauri/tauri.dev.conf.json` 继续使用 `sqlite:timetracker.db`。
  - [ ] `src-tauri/tauri.local.conf.json` 继续使用 `sqlite:timetracker.db`。
- [ ] 保持 Tauri SQL capabilities：
  - [ ] `src-tauri/capabilities/default.json` 继续授权 `sqlite:timetracker.db`。
  - [ ] `src-tauri/capabilities/widget.json` 继续授权 `sqlite:timetracker.db`。
- [ ] 不迁移 app config 目录。
- [ ] 不迁移 app data 目录。
- [ ] 不改 WebDAV Credential Manager target：
  - [ ] 继续使用 `com.timetracker.backup.webdav.default`。
- [ ] 未来版本如需迁移底层身份，再单独新增迁移模块、marker、旧目录复制和失败处理。

## 9. 自家进程过滤与分类兼容

改名后新 exe 可能变成 `patina.exe`。必须避免 Patina 记录自己。

- [ ] 在自家进程过滤中加入：
  - [ ] `patina.exe`
  - [ ] `patina`
  - [ ] `patina widget`，如相关过滤使用窗口标题。

- [ ] 保留旧进程名过滤：
  - [ ] `time_tracker.exe`
  - [ ] `time_tracker`
  - [ ] `time-tracker.exe`
  - [ ] `time tracker.exe`
  - [ ] `timetracker.exe`

- [ ] 修改 `src-tauri/src/domain/tracking/process_filters.rs`。
- [ ] 修改 `src/shared/classification/processNormalization.ts`。
- [ ] 修改 `src/shared/classification/defaultMappings.ts`：
  - [ ] 新增 `patina.exe` -> `{ name: "Patina", category: "system" }`。
  - [ ] 旧 exe 映射可保留为 `{ name: "Patina", category: "system" }`，也可保留显示为 `Time Tracker` 作为历史进程；推荐显示为 `Patina`，减少用户看到旧名。
- [ ] 修改 `src/app/widget/widgetViewModel.ts`。
- [ ] 修改 `tests/trackingLifecycle/shared.ts`。
- [ ] 更新相关测试 fixture。

## 10. 备份与 WebDAV 兼容

备份和远端目录属于用户数据边界，不能只做字符串替换。

- [ ] 修改 `src-tauri/src/data/backup.rs`：
  - [ ] 新导出的备份文件名使用 `Patina-backup-{timestamp}.zip`。
  - [ ] 文件选择器 filter 文案改为 `Patina backup`。
  - [ ] 新错误文案改为 `Patina backup`。
  - [ ] 继续接受旧 `TimeTrackerBackup` 格式。
  - [ ] 继续接受旧 `TimeTracker-backup-*.zip` 文件名。

- [ ] 修改 `src-tauri/src/data/remote_backup.rs`：
  - [ ] 新远端 index 的 `product` 使用 `Patina`。
  - [ ] 读取远端 index 时接受旧 `Time Tracker`。
  - [ ] 新生成远端备份文件名使用 `Patina-backup-*.zip`。
  - [ ] 旧远端备份仍可预览、下载、恢复。

- [ ] 修改 WebDAV 默认目录：
  - [ ] `src/platform/persistence/remoteBackupSettingsStore.ts` 中默认目录改为 `/Patina`。
  - [ ] `src-tauri/src/platform/webdav.rs` 中默认目录改为 `/Patina`。
  - [ ] 已保存远端目录如果是旧固定目录 `/TimeTracker`，升级后自动改写为 `/Patina`。
  - [ ] 当前产品没有暴露 WebDAV 远端目录自定义输入，不需要保留“用户自定义目录”分支。
  - [ ] `/TimeTracker` 只作为旧版本远端备份迁移来源保留，不再作为保存值或默认值。
  - [ ] 如果已有远端 `/TimeTracker` 备份，首次使用 WebDAV 时应能迁移或合并到 `/Patina`，避免用户升级后看不到旧远端备份。
  - [ ] 测试中覆盖 `/Patina` 默认值、旧固定目录 `/TimeTracker` 保存值自动改写，以及旧远端备份可迁移或合并。

- [ ] 修改凭据说明：
  - [ ] `src-tauri/src/platform/credentials.rs` 中 WebDAV credential comment 改为 `Patina WebDAV backup credential`。
  - [ ] 如 Windows Credential Manager 以 comment 识别，不应删除旧凭据读取路径。

## 11. 更新、发布脚本与 CI

- [ ] 修改 `scripts/release.ts`：
  - [ ] 默认 latest.json URL 改为 `https://github.com/Ceceliaee/patina/releases/latest/download/latest.json`。
  - [ ] 安装包名从 `TimeTracker_${version}_x64-setup.exe` 改为 `Patina_${version}_x64-setup.exe`。
  - [ ] release asset 准备逻辑同步新文件名。
  - [ ] release 校验测试同步新命名。

- [ ] 修改 `.github/workflows/prepare-release.yml`：
  - [ ] GitHub Release 标题从 `Time Tracker v${version}` 改为 `Patina v${version}`。
  - [ ] 上传附件从 `TimeTracker_${version}_x64-setup.exe` 改为 `Patina_${version}_x64-setup.exe`。
  - [ ] R2 mirror 中安装包对象名同步改为 `Patina_${version}_x64-setup.exe`。
  - [ ] 如果 R2 公开路径不改，确认新 manifest URL 与对象路径一致。

- [ ] 修改 `tests/releasePolicy.test.ts`：
  - [ ] GitHub latest.json URL 改为新仓库。
  - [ ] 安装包断言改为 `Patina_X.Y.Z_x64-setup.exe`。

- [ ] 修改 Rust updater URL：
  - [ ] `src-tauri/src/engine/updater.rs` 中 release base URL 改为新仓库。
  - [ ] `src-tauri/src/domain/update.rs` 中测试 fixture 改为新仓库。

- [ ] 检查旧版本升级路径：
  - [ ] GitHub rename 后，旧 `time-tracking` URL 应由 GitHub 自动 redirect。
  - [ ] 如果旧版本 updater 不跟随 redirect 或 release asset 文件名变化导致失败，需要保留旧 release asset 或提供兼容说明。

## 12. README、贡献指南与 GitHub 模板

- [ ] 修改 `README.md`：
  - [ ] 标题改为 `# Patina`。
  - [ ] icon alt 改为 `Patina icon`。
  - [ ] badges 链接改为 `Ceceliaee/patina`。
  - [ ] release 链接改为新仓库。
  - [ ] issue 链接改为新仓库。
  - [ ] clone 命令改为 `git clone https://github.com/Ceceliaee/patina.git`。
  - [ ] 目录命令改为 `cd patina`。
  - [ ] 正文中的产品名改为 `Patina`。

- [ ] 修改 `README.zh-CN.md`：
  - [ ] 与英文 README 同步。
  - [ ] 中文描述保持“个人、本地优先、桌面时间追踪工具”。

- [ ] 修改 `CONTRIBUTING.md`：
  - [ ] 标题和正文产品名改为 `Patina`。
  - [ ] upstream URL 改为 `https://github.com/Ceceliaee/patina.git`。
  - [ ] 保留个人、本地优先、Windows 桌面范围。

- [ ] 修改 `.github/ISSUE_TEMPLATE/bug_report.yml`：
  - [ ] 产品名改为 `Patina`。
  - [ ] 版本字段 label 改为 `Patina Version / Patina 版本`。

- [ ] 修改 `.github/ISSUE_TEMPLATE/feature_request.yml`：
  - [ ] 产品名改为 `Patina`。
  - [ ] 产品边界描述保持不变。

- [ ] 修改 `.github/ISSUE_TEMPLATE/config.yml`：
  - [ ] CONTRIBUTING 链接改为新仓库。

## 13. Active Docs 更新

只更新 top-level active docs，不从 archive 反推当前规则。

- [ ] 修改 `docs/product-principles-and-scope.md`：
  - [ ] 产品名改为 `Patina`。
  - [ ] 一句话定义保留原产品方向。

- [ ] 修改 `docs/roadmap-and-prioritization.md`：
  - [ ] 产品名改为 `Patina`。
  - [ ] 当前阶段目标保持不变。

- [ ] 修改 `docs/engineering-quality.md`：
  - [ ] 产品名改为 `Patina`。
  - [ ] 工程质量方向保持不变。

- [ ] 修改 `docs/architecture.md`：
  - [ ] 产品名改为 `Patina`。
  - [ ] 架构层级和 owner 规则不因改名改变。

- [ ] 修改 `docs/issue-fix-boundary-guardrails.md`：
  - [ ] 产品名改为 `Patina`。

- [ ] 修改 `docs/versioning-and-release-policy.md`：
  - [ ] 当前示例 release 标题改为 `Patina vX.Y.Z`。
  - [ ] GitHub Release 标题规则改为 `Patina vX.Y.Z`。
  - [ ] 安装包附件命名规则改为 `Patina_X.Y.Z_x64-setup.exe`。
  - [ ] issue 示例链接改为 `Ceceliaee/patina`。
  - [ ] 如果本次改名随版本发布，按发布规范同步当前代码版本字段。

- [ ] 修改 `CHANGELOG.md`：
  - [ ] 在 `[Unreleased]` 的 `Changed` 中加入产品与仓库改名说明。
  - [ ] 不重写历史 release 标题和历史版本事实，除非明确做历史文本统一。

## 14. GitHub 仓库改名

建议先完成代码改动、本地验证和提交，再执行远端仓库改名。

- [ ] 确认当前分支和 remote：

```powershell
git status --short
git remote -v
```

- [ ] 在 GitHub Web UI 执行：
  - [ ] 打开仓库 Settings。
  - [ ] 在 General 中将 repository name 从 `time-tracking` 改为 `patina`。
  - [ ] 更新 repository description。
  - [ ] 更新 topics。

- [ ] 或使用 GitHub CLI：

```powershell
gh repo rename patina --repo Ceceliaee/time-tracking
```

- [ ] 修改本地 remote：

```powershell
git remote set-url origin https://github.com/Ceceliaee/patina.git
```

- [ ] 验证 remote：

```powershell
git remote -v
git ls-remote --heads origin
```

- [ ] 打开旧 URL `https://github.com/Ceceliaee/time-tracking`，确认 GitHub redirect 正常。
- [ ] 打开新 URL `https://github.com/Ceceliaee/patina`，确认 README、issues、releases 可访问。

## 15. 本地文件夹改名

本地目录改名放在最后做，避免 IDE、终端和 dev server 占用路径。

- [ ] 关闭运行中的 Tauri dev、Vite dev、测试进程和相关终端。
- [ ] 确认所有需要提交的改动已经提交或至少明确保留。
- [ ] 关闭当前 IDE 窗口。
- [ ] 在父目录执行：

```powershell
Rename-Item -LiteralPath "C:\Users\SYBao\Documents\Code\Time Tracking" -NewName "Patina"
```

- [ ] 重新打开：

```text
C:\Users\SYBao\Documents\Code\Patina
```

- [ ] 重新检查 remote：

```powershell
git remote -v
```

- [ ] 搜索旧绝对路径：

```powershell
rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!src-tauri/target/**' "C:\\Users\\SYBao\\Documents\\Code\\Time Tracking|Time Tracking" .
```

- [ ] 只保留测试 fixture 或历史归档中必要的旧路径。

## 16. 验证

### 16.1 基础验证

- [ ] 运行命名边界检查：

```powershell
npm run check:naming
```

- [ ] 运行架构边界检查：

```powershell
npm run check:architecture
```

- [ ] 运行前端验证：

```powershell
npm run check:frontend
```

- [ ] 运行 Rust 验证：

```powershell
npm run check:rust
```

- [ ] 运行完整验证：

```powershell
npm run check:full
```

### 16.2 发布前验证

- [ ] 如果准备随改名发布正式版本，运行：

```powershell
npm run release:check
```

- [ ] 检查 release notes 输出：

```powershell
npm run release:notes -- X.Y.Z
```

- [ ] 检查 latest.json 生成逻辑：

```powershell
npm run release:latest -- X.Y.Z https://example.com/Patina_X.Y.Z_x64-setup.exe test-signature dist-release/test-latest.json windows-x86_64
```

### 16.3 残留搜索

- [ ] 执行最终残留搜索：

```powershell
rg -n --hidden --glob '!node_modules/**' --glob '!dist/**' --glob '!src-tauri/target/**' --glob '!dist-release/**' --glob '!updater-publish/**' "Time Tracker|Time Tracking|time-tracking|TimeTracker|time_tracker|timetracker|time-tracker|TimeTracking" .
```

- [ ] 对每一个残留旧名称标注原因：
  - [ ] 兼容必须保留。
  - [ ] 历史记录可保留。
  - [ ] 测试 fixture 需要保留。
  - [ ] 应继续改掉。

## 17. 升级兼容实测

至少用一个旧版本安装态做升级验证。

- [ ] 使用当前已发布版本创建或准备真实数据：
  - [ ] 至少一条活动会话。
  - [ ] 至少一个应用分类。
  - [ ] 至少一个应用重命名。
  - [ ] 至少一个本地备份。
  - [ ] 如果使用 WebDAV，至少一个远端备份。

- [ ] 安装或运行 `Patina` 构建。
- [ ] 验证正式版 identifier 仍为 `com.timetracker`。
- [ ] 验证数据库仍使用 `timetracker.db`，没有创建 `patina.db`。
- [ ] 验证旧数据仍能显示在 Dashboard。
- [ ] 验证 History 可打开旧记录。
- [ ] 验证 Data 页面可读取长期统计。
- [ ] 验证分类、重命名和颜色设置保留。
- [ ] 验证 `patina.exe` 不会被记录成普通活动。
- [ ] 验证旧 `time_tracker.exe` 历史记录不会污染未分类列表。
- [ ] 验证旧 `TimeTracker-backup-*.zip` 可恢复。
- [ ] 验证新 `Patina-backup-*.zip` 可导出并恢复。
- [ ] 验证旧固定 `/TimeTracker` WebDAV 设置升级后改写为 `/Patina`。
- [ ] 验证旧远端 `/TimeTracker` 备份可迁移或合并到 `/Patina`。
- [ ] 验证新用户默认 WebDAV 目录为 `/Patina`。
- [ ] 验证 WebDAV Credential Manager target 仍使用旧 target，不触发底层身份迁移。
- [ ] 验证应用内更新入口打开新 GitHub Releases 页面。
- [ ] 验证旧 GitHub URL redirect 对 updater 没有明显影响。
- [ ] 验证 launch-at-login/autostart 设置在升级后仍符合用户原设置。
- [ ] 验证 Windows 开始菜单、桌面快捷方式、卸载项显示为 `Patina`。

## 18. 版本与发布

### 18.1 版本判断

- [ ] 本方案不修改 Tauri identifier、数据库名或数据目录身份。
- [ ] 产品名、仓库名、发布命名和 WebDAV 默认目录改名属于用户可感知变化，默认按 `MINOR` 候选处理，例如 `1.5.0`。
- [ ] 如果最终范围只剩文案和仓库链接，可重新评估是否使用 `PATCH`，但不应忽略改名对用户的可见影响。
- [ ] 未来若单独迁移底层身份，再按当时范围重新评估 `MAJOR`。

### 18.2 发布准备

- [ ] 同步版本文件：
  - [ ] `package.json`
  - [ ] `package-lock.json`
  - [ ] `src-tauri/tauri.conf.json`
  - [ ] `src-tauri/Cargo.toml`
  - [ ] `docs/versioning-and-release-policy.md`

- [ ] 整理 `CHANGELOG.md`。
- [ ] 运行 `npm run release:check`。
- [ ] 提交：

```powershell
git add -A
git commit -m "rename product to Patina"
```

- [ ] 推送：

```powershell
git push origin main
```

- [ ] 创建并推送 tag：

```powershell
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

- [ ] 确认 GitHub Actions `Publish Release` 被触发。
- [ ] 确认 Release 标题为 `Patina vX.Y.Z`。
- [ ] 确认 Release asset 包含 `Patina_X.Y.Z_x64-setup.exe`。
- [ ] 确认 latest.json 指向新安装包。

## 19. 回滚与补救

- [ ] 如果 GitHub rename 后发现 updater 无法访问新仓库：
  - [ ] 先确认旧 URL redirect 是否正常。
  - [ ] 必要时在旧路径可访问的 release 中保留兼容 asset。
  - [ ] 不要删除旧 release 或重写已发布 tag。

- [ ] 如果旧备份无法恢复：
  - [ ] 立即停止发布。
  - [ ] 恢复旧 `TimeTrackerBackup` 读取兼容。
  - [ ] 增加旧备份 fixture 测试。

- [ ] 如果旧默认 `/TimeTracker` 没有迁移到 `/Patina`：
  - [ ] 检查 `remoteBackupSettingsStore` 的旧默认迁移逻辑。
  - [ ] 补充旧默认值回归测试。
  - [ ] 确认 UI 没有残留旧固定目录。

- [ ] 如果新 exe 被记录进活动：
  - [ ] 补充 `patina.exe` 进程过滤。
  - [ ] 补充 widget 标题过滤。
  - [ ] 补充回归测试。

## 20. 完成标准

- [ ] 应用内用户可见名称全部为 `Patina`。
- [ ] 正式版 Tauri identifier 仍为 `com.timetracker`。
- [ ] 开发版和本地版 identifier 仍为 `com.timetracker.dev` 与 `com.timetracker.local`。
- [ ] 数据库仍使用 `timetracker.db` / `sqlite:timetracker.db`。
- [ ] 不新增底层身份迁移模块或数据目录迁移。
- [ ] README、贡献指南、issue 模板和 active docs 已同步。
- [ ] GitHub 仓库已改为 `Ceceliaee/patina`。
- [ ] 本地目录已改为 `C:\Users\SYBao\Documents\Code\Patina`。
- [ ] 发布标题和安装包命名使用 `Patina`。
- [ ] WebDAV 默认目录为 `/Patina`，旧默认 `/TimeTracker` 保存值会自动迁移到 `/Patina`。
- [ ] 旧远端 `/TimeTracker` 备份有迁移或合并路径，升级后不会从 WebDAV 恢复列表中消失。
- [ ] 旧数据、旧备份、旧 WebDAV 凭据和旧进程名过滤仍兼容。
- [ ] `npm run check:full` 通过。
- [ ] 如果发布，`npm run release:check` 通过。
- [ ] 最终残留旧名都有明确原因。
- [ ] 本文已归档到 `docs/archive/`，或按当前文档卫生规则处理。
