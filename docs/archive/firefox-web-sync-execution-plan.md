# Firefox 系网页同步执行方案

状态：已归档（自动化完成；真实 Firefox/Zen 手工验收因本机未安装对应浏览器未执行）  
关联：Refs #29  
文档类型：一次性执行计划  
目标读者：Patina 维护者与后续实现者  

## 0. 执行结果

- [x] 新增 `extensions/firefox/` Firefox 系 Patina Web Sync 扩展源码、README 和隐私说明。
- [x] 新增 `scripts/firefox-extension.ts` 与 `extension:firefox:*` npm 脚本。
- [x] Firefox 扩展采用 MV3 `background.scripts`，不使用 Chromium `background.service_worker` 或 `/_favicon/` 缓存路径。
- [x] Rust 网页活动前台浏览器判断收口为 Chromium / Firefox 两个族群。
- [x] Chromium 系白名单保留既有目标并新增 `thorium.exe`、`centbrowser.exe`、`catsxp.exe`、`360chromex.exe`。
- [x] Firefox 系白名单新增 `firefox.exe`、`zen.exe`、`floorp.exe`、`iceweasel.exe`。
- [x] 明确排除 `opera_gx.exe`、`360chrome.exe`、`tor.exe`、`librewolf.exe`、`waterfox.exe`、`noraneko.exe`、`ungoogled-chromium.exe`、`helium.exe`、`supermium.exe`、`edge.exe`、`egde.exe`。
- [x] 分类默认映射新增 Firefox 系和新增 Chromium 系候选的可读名称。
- [x] 设置页网页同步说明改为 Chromium / Firefox 两套扩展包口径，并写明 Firefox 系当前通过 `about:debugging#/runtime/this-firefox` 临时载入。
- [x] GitHub Release workflow 会分别打包并上传 `patina-chromium-extension-vX.Y.Z.zip` 与 `patina-firefox-extension-vX.Y.Z.zip`。
- [x] 发布说明生成器、版本发布政策、测试和 `CHANGELOG.md` 已同步。
- [x] `npm run extension:chromium:check` 通过。
- [x] `npm run extension:firefox:check` 通过。
- [x] `npm run extension:chromium:package` 通过，并确认 zip 内部根目录为 `patina-chromium-extension-v0.1.0/`。
- [x] `npm run extension:firefox:package` 通过，并确认 zip 内部根目录为 `patina-firefox-extension-v0.1.0/`。
- [x] `npm run test:classification`、`npm run test:release`、`npm run test:ui-smoke`、`npm run check:rust` 通过。
- [x] `npm run release:check` 在沙箱外重跑通过；沙箱内首次失败原因为 Vite/esbuild 子进程 `spawn EPERM`。
- [ ] Firefox / Zen 真实 Windows 手工验收未执行：本机未找到 `firefox.exe`、`zen.exe` 或对应安装目录。
- [x] 本文已从 `docs/working/` 归档到 `docs/archive/`。

## 1. 文档目标

本文从第一性原理出发，定义如何把 Patina 的网页同步能力从当前的 Chromium 系扩展，扩展到 Firefox 系浏览器。

本文不是长期母文档。任务完成、验收通过并把长期规则回写到对应顶层文档后，本文应移动到 `docs/archive/`。

## 2. 第一性原理

### 2.1 Patina 为什么需要网页同步

- Patina 的核心价值是本地优先的个人桌面时间追踪。
- 桌面前台窗口只能告诉 Patina 用户正在使用某个浏览器，例如 Chrome 或 Firefox。
- 浏览器内部有多个网站、标签页和任务上下文。只记录浏览器应用时间，无法回答“这段浏览器时间主要花在哪些网站上”。
- 网页同步的目的不是替代应用时间，而是在浏览器应用时间之下提供网站维度的子视角。

### 2.2 网页同步必须满足什么

- 必须只记录当前活动标签页的必要上下文：网站地址、页面标题、网站图标和时间边界。
- 必须继续本地优先：浏览器扩展只发给本机 Patina，不发给云端服务。
- 必须不扫描浏览器历史库。
- 必须不读取网页正文、表单、密码、截图、剪贴板或 Cookie。
- 必须不记录隐私窗口、无痕窗口或同类私密窗口。
- 必须由 Patina 桌面端确认当前前台应用确实是支持的浏览器，避免后台浏览器标签变化误写入时间。

### 2.3 为什么不能只加 `firefox.exe`

只加桌面端 exe 白名单只解决一个问题：Patina 不再拒绝 Firefox 前台窗口。

但完整支持还需要：

- 一个 Firefox 系扩展目录。
- Firefox 系 manifest。
- Firefox 系构建、检查、打包脚本。
- 发布附件命名和工作流。
- 设置页安装说明。
- 隐私说明和 README。
- Rust 端浏览器族群命名与测试。
- 真实 Firefox 与 Zen 手工验收。

因此 #29 不应被实现成“在白名单里补两个 exe”。它应该作为“新增 Firefox 系网页同步目标”处理。

## 3. 当前事实

### 3.1 当前已支持能力

- 当前扩展源码在 `extensions/chromium/`。
- 当前 npm 脚本为：
  - `extension:chromium:check`
  - `extension:chromium:build`
  - `extension:chromium:package`
- 当前发布包命名为 `patina-chromium-extension-vX.Y.Z.zip`。
- 当前 Rust 端 `is_supported_browser_exe` 只允许 Chromium 系前台浏览器写入网页活动。
- 当前设置页说明指向 Chromium 扩展包。

### 3.2 当前未支持能力

- 没有 `extensions/firefox/`。
- 没有 Firefox 系扩展检查、构建、打包脚本。
- 没有 `patina-firefox-extension-vX.Y.Z.zip` 发布附件。
- 没有 Firefox 系安装说明。
- Rust 端没有 Firefox 系网页同步前台浏览器白名单。
- 没有 Firefox / Zen 网页同步自动化测试或手工验收记录。

## 4. 命名口径

### 4.1 用户口径

- 使用 `Chromium 系浏览器扩展`。
- 使用 `Firefox 系浏览器扩展`。
- 不把 `Chrome` 当作整派名字。
- 不把 `Blink` / `Gecko` 放进用户主文案。

### 4.2 代码口径

- 保留 `extensions/chromium`。
- 新增 `extensions/firefox`。
- 保留 `extension:chromium:*`。
- 新增 `extension:firefox:*`。
- 不新增 `extension:gecko:*`。
- 不新增 `extensions/gecko`。

### 4.3 发布包口径

- Chromium 系：`patina-chromium-extension-vX.Y.Z.zip`。
- Firefox 系：`patina-firefox-extension-vX.Y.Z.zip`。

### 4.4 浏览器范围口径

- 能力名称：Firefox 系网页同步。
- 第一版正式验收浏览器：Firefox、Zen。
- 候选 Firefox 系浏览器：Floorp、Iceweasel。
- 不默认承诺：Tor Browser、Mullvad Browser 等强隐私导向浏览器。

候选浏览器只有完成真实 Windows 手工验收后，才能进入用户可见的“已验证支持”列表。

### 4.5 Windows exe 名称确认

本节记录 2026-06-30 对候选浏览器 Windows 进程名的执行前确认。后端白名单必须写真实 `.exe` 名称，不能写品牌名。

Chromium 系确认结果：

- `chrome.exe`：Chrome 主进程；ungoogled-chromium、Helium、Supermium 的当前 Windows 便携包主进程也都是 `chrome.exe`。
- `chromium.exe`：保留现有兼容项。
- `msedge.exe`：Microsoft Edge；不要写 `edge.exe`，也不要写用户草案中的 `egde`。
- `brave.exe`：Brave。
- `opera.exe`：Opera。
- `vivaldi.exe`：Vivaldi。
- `arc.exe`：Arc。
- `thorium.exe`：Thorium 当前 Windows ZIP 主进程。
- `centbrowser.exe`：Cent Browser。
- `catsxp.exe`：Catsxp Browser / 猫眼浏览器。
- `360chromex.exe`：360 极速浏览器 X；后端统一小写比较，覆盖 `360ChromeX.exe`。

不建议加入的 Chromium 系品牌名：

- `ungoogled-chromium.exe`：当前 Windows 包主进程是 `chrome.exe`。
- `helium.exe`：当前 Windows 包主进程是 `chrome.exe`，另有 `helium_update_helper.exe`，不是浏览器前台主进程。
- `supermium.exe`：当前 Windows 包主进程是 `chrome.exe`。
- `360chrome.exe`：旧版 360 极速浏览器；本轮只保留新版 360 极速浏览器 X。

Firefox 系确认结果：

- `firefox.exe`：Firefox；Tor Browser 的浏览器部分也基于 Firefox，但不因此默认承诺 Tor Browser。
- `zen.exe`：Zen。
- `floorp.exe`：Floorp。
- `iceweasel.exe`：Iceweasel / libportable Iceweasel Windows 包常见主进程。

不建议加入的 Firefox 系项：

- `tor.exe`：不应按这个名字支持 Tor Browser。Tor Browser 场景有更强隐私预期，应单独做显式 opt-in 或路径级判断。
- `noraneko.exe`：Floorp 构建流程中可见，但不属于本轮用户草案里的稳定目标。
- `librewolf.exe`：本轮不加入 Firefox 系候选。
- `waterfox.exe`：本轮不加入 Firefox 系候选。

确认方式和主要来源：

- 通过 GitHub Release 资产和 ZIP 中央目录确认 ungoogled-chromium、Helium、Supermium、Thorium 的 Windows 包内 `.exe`。
- 通过官方仓库、公开包清单和安装路径样例确认 Zen、Floorp、Iceweasel、Cent Browser、Catsxp、360 极速浏览器的 `.exe`。
- 主要入口：
  - ungoogled-chromium Windows：`https://github.com/ungoogled-software/ungoogled-chromium-windows/releases/latest`
  - Helium Windows：`https://github.com/imputnet/helium-windows/releases/latest`
  - Supermium：`https://github.com/win32ss/supermium/releases/latest`
  - Thorium：`https://github.com/gz83/thorium/releases/tag/M144.0.7559.254`
  - Zen：`https://github.com/zen-browser/desktop`
  - Floorp：`https://github.com/Floorp-Projects/Floorp`
  - Tor Browser 支持资料：`https://github.com/torproject/support`

## 5. 总体架构目标

### 5.1 目标链路

```text
Firefox 系浏览器
  -> extensions/firefox/background.js
  -> http://127.0.0.1:<port>/web-activity
  -> src-tauri/src/platform/web_activity_bridge.rs
  -> src-tauri/src/app/web_activity.rs
  -> src-tauri/src/engine/web_activity/mod.rs
  -> src-tauri/src/data/repositories/web_activity.rs
  -> web_activity_segments
```

### 5.2 不改变的东西

- 不改本地 HTTP bridge 的路径：继续使用 `/web-activity`。
- 不改 Token 认证模型。
- 不改网页活动数据库表结构，除非实现中证明必要。
- 不把网页活动改成 Tauri IPC。
- 不引入 Native Messaging，除非 HTTP bridge 在 Firefox 中被证明不可行。
- 不扫描浏览器历史库。
- 不把 Firefox 系支持扩展为云同步、账号或远程服务。

### 5.3 允许改变的东西

- 增加 Firefox 系扩展目录。
- 增加 Firefox 系 npm 脚本。
- 增加 Firefox 系发布包。
- 增加 Rust 端浏览器族群模型。
- 增加设置页帮助文案。
- 增加扩展隐私说明和 README。
- 增加自动化测试和手工验收清单。

## 6. 分阶段执行清单

## 阶段 0：执行前复核

- [ ] 确认当前工作区未提交改动是否属于本任务。
- [ ] 如果存在无关改动，保留并避开，不回滚。
- [ ] 确认 #29 仍然 open。
- [ ] 不在 commit、changelog、PR 或 issue 评论中使用关闭关键字。
- [ ] 后续引用 issue 时使用 `Refs #29`。
- [ ] 重新阅读当前长期约束：
  - [ ] `docs/product-principles-and-scope.md`
  - [ ] `docs/roadmap-and-prioritization.md`
  - [ ] `docs/engineering-quality.md`
  - [ ] `docs/quiet-pro-component-guidelines.md`
  - [ ] `docs/architecture.md`
  - [ ] `docs/issue-fix-boundary-guardrails.md`
  - [ ] `docs/versioning-and-release-policy.md`

验收：

- [ ] 能明确说明本任务属于“核心页面体验 + 追踪可信度”范围，而不是产品方向扩张。
- [ ] 能明确说明本任务不引入云端、团队、账号或移动端路线。

## 阶段 1：当前网页同步边界盘点

- [ ] 盘点 Chromium 扩展源码：
  - [ ] `extensions/chromium/manifest.json`
  - [ ] `extensions/chromium/background.js`
  - [ ] `extensions/chromium/options.html`
  - [ ] `extensions/chromium/options.js`
  - [ ] `extensions/chromium/popup.html`
  - [ ] `extensions/chromium/popup.js`
  - [ ] `extensions/chromium/README.md`
  - [ ] `extensions/chromium/README.zh-CN.md`
  - [ ] `extensions/chromium/PRIVACY.md`
  - [ ] `extensions/chromium/STORE_LISTING.md`
- [ ] 盘点 Chromium 打包脚本：
  - [ ] `scripts/chromium-extension.ts`
  - [ ] `package.json`
  - [ ] `.github/workflows/prepare-release.yml`
- [ ] 盘点 Rust 端网页同步链路：
  - [ ] `src-tauri/src/domain/web_activity.rs`
  - [ ] `src-tauri/src/platform/web_activity_bridge.rs`
  - [ ] `src-tauri/src/app/web_activity.rs`
  - [ ] `src-tauri/src/engine/web_activity/mod.rs`
  - [ ] `src-tauri/src/data/repositories/web_activity.rs`
- [ ] 盘点前端说明入口：
  - [ ] `src/shared/copy/domains/settingsCopy.ts`
  - [ ] `src/features/settings/components/SettingsInterfacePanel.tsx`
  - [ ] `src/features/settings/services/webActivitySetupState.ts`
- [ ] 盘点现有测试：
  - [ ] `tests/uiSmoke.test.ts`
  - [ ] `tests/settingsPageState.test.ts`
  - [ ] Rust `web_activity` 相关测试。

验收：

- [ ] 列出当前 Chromium 扩展依赖 Chrome-only API 的位置。
- [ ] 列出 Rust 端拒绝 Firefox 系前台窗口的位置。
- [ ] 列出发布流程里只打 Chromium 扩展包的位置。

## 阶段 2：外部技术事实确认

本阶段只做确认，不做代码修改。

- [ ] 查阅 Mozilla / MDN 当前 WebExtensions 文档。
- [ ] 确认 Firefox Manifest V3 background 的推荐写法。
- [ ] 确认 Firefox 对 `background.scripts` 与 `background.service_worker` 的当前支持状态。
- [ ] 确认 `tabs.Tab.url`、`tabs.Tab.title`、`tabs.Tab.favIconUrl` 所需权限。
- [ ] 确认 Firefox 扩展是否可以向 `http://127.0.0.1:<port>/web-activity` 发起 fetch。
- [ ] 确认 Firefox 对 `host_permissions` 中 localhost / 127.0.0.1 的表现。
- [ ] 确认 Firefox 中 favicon 获取策略：
  - [ ] 是否可直接使用 `tab.favIconUrl`。
  - [ ] 是否需要降级为 URL favicon。
  - [ ] 是否不应移植 Chromium 的 `/_favicon/` 缓存机制。
- [ ] 确认 Zen 扩展加载方式：
  - [ ] 是否可直接加载 Firefox WebExtension。
  - [ ] 是否需要额外 manifest 字段。
  - [ ] 是否有签名或开发者模式限制。

验收：

- [ ] 在执行记录中写清楚 Firefox 扩展背景脚本采用的 manifest 方案。
- [ ] 在执行记录中写清楚 favicon 采用的策略。
- [ ] 如果发现 Firefox 无法稳定使用本地 HTTP bridge，暂停并重新评估，不继续硬做。

## 阶段 3：确定 Firefox 系扩展设计

- [ ] 决定是否复制 Chromium 目录起步，或提取共享资产后生成两个目标。
- [ ] 默认优先采用轻量复制起步：
  - [ ] 保持 `extensions/chromium` 独立。
  - [ ] 新增 `extensions/firefox` 独立。
  - [ ] 只在重复明显且稳定后，再考虑共享构建资产。
- [ ] 设计 `extensions/firefox/manifest.json`：
  - [ ] `manifest_version` 使用 Firefox 当前推荐版本。
  - [ ] `name` 继续使用 `Patina Web Sync`，除非发布平台要求区分。
  - [ ] `version` 独立于 Chromium 扩展版本。
  - [ ] 权限只包含网页同步所需最小集合。
  - [ ] host 权限只允许本地 Patina bridge 地址。
  - [ ] background 配置符合 Firefox 当前支持状态。
  - [ ] 保留 options page。
  - [ ] 保留 popup。
  - [ ] 保留 icons。
- [ ] 设计 `extensions/firefox/background.js`：
  - [ ] 使用 Firefox 可用的 WebExtensions API。
  - [ ] 保留 active tab 事件监听。
  - [ ] 保留定时心跳。
  - [ ] 保留手动同步。
  - [ ] 保留 Token 认证。
  - [ ] 保留隐私窗口跳过。
  - [ ] 将 `browserKind` 设为 `firefox` 或可识别的 Firefox 系值。
  - [ ] 对 Zen 做可解释识别，不能识别时也不影响记录。
- [ ] 设计 favicon 策略：
  - [ ] 优先使用 tab metadata 中的 favicon URL。
  - [ ] 不使用 Chromium `/_favicon/` 专用路径。
  - [ ] favicon 为空时允许 Rust / 前端走现有 fallback。
  - [ ] 不为拿 favicon 请求网页正文。
- [ ] 保持 options / popup 的用户行为与 Chromium 扩展一致。

验收：

- [ ] Firefox 扩展不会请求比 Chromium 扩展更宽的权限，除非有明确理由。
- [ ] Firefox 扩展不会把数据发给非本地地址。
- [ ] Firefox 扩展可以在未连接、Token 错误、Patina 关闭、网页同步关闭时显示合理状态。

## 阶段 4：Rust 端浏览器族群建模

- [ ] 在 `src-tauri/src/domain/web_activity.rs` 中收口浏览器支持逻辑。
- [ ] 不继续让 `is_supported_browser_exe` 成为不可解释的长列表。
- [ ] 引入清晰的内部模型，例如：
  - [ ] `WebActivityBrowserFamily`
  - [ ] `Chromium`
  - [ ] `Firefox`
- [ ] 提供判断函数，例如：
  - [ ] `resolve_web_activity_browser_family(exe_name: &str) -> Option<WebActivityBrowserFamily>`
  - [ ] `is_supported_browser_exe(exe_name: &str) -> bool`
- [ ] 保持现有 Chromium exe 行为不变：
  - [ ] `chrome.exe`
  - [ ] `msedge.exe`
  - [ ] `brave.exe`
  - [ ] `opera.exe`
  - [ ] `vivaldi.exe`
  - [ ] `arc.exe`
  - [ ] `chromium.exe`
- [ ] 新增已确认 Chromium 系 exe 候选：
  - [ ] `thorium.exe`
  - [ ] `centbrowser.exe`
  - [ ] `catsxp.exe`
  - [ ] `360chromex.exe`
- [ ] 不新增这些品牌名式 exe：
  - [ ] `ungoogled-chromium.exe`
  - [ ] `helium.exe`
  - [ ] `supermium.exe`
  - [ ] `360chrome.exe`
  - [ ] `edge.exe`
  - [ ] `egde.exe`
- [ ] 新增 Firefox 系 exe 候选：
  - [ ] `firefox.exe`
  - [ ] `zen.exe`
  - [ ] `floorp.exe`
  - [ ] `iceweasel.exe`
- [ ] 不新增这些强隐私或非稳定目标 exe：
  - [ ] `tor.exe`
  - [ ] `noraneko.exe`
  - [ ] `librewolf.exe`
  - [ ] `waterfox.exe`
- [ ] 将候选 exe 分为：
  - [ ] 已自动化覆盖。
  - [ ] 已手工验收。
  - [ ] 仅候选，不进入用户可见已验证列表。
- [ ] 确认 `engine/web_activity/mod.rs` 只依赖 domain 函数，不复制 exe 列表。
- [ ] 为新增族群补 Rust 单元测试：
  - [ ] Chromium 系仍通过。
  - [ ] Firefox 系通过。
  - [ ] 大小写和空格归一化通过。
  - [ ] 未支持 exe 返回 false。
  - [ ] Firefox 系前台且 extension payload 有效时可写入 segment。
  - [ ] Firefox 系非前台或 AFK 时封口。

验收：

- [ ] 浏览器族群判断只在 domain owner 内维护。
- [ ] engine 层不出现新的浏览器 exe 硬编码。
- [ ] Rust 测试覆盖 Firefox 系允许写入和离开浏览器封口。

## 阶段 5：默认应用映射与分类体验

- [ ] 检查 `src/shared/classification/defaultMappings.ts`。
- [ ] 保留现有 `firefox.exe` 默认名称。
- [ ] 新增 Firefox 系候选浏览器默认显示名：
  - [ ] `zen.exe` -> `Zen`
  - [ ] `floorp.exe` -> `Floorp`
  - [ ] `iceweasel.exe` -> `Iceweasel`
- [ ] 不自动把这些应用分类成某个固定分类，除非现有产品规则已经这样做。
- [ ] 更新分类相关测试，确认默认名称可用于候选列表和显示。

验收：

- [ ] Firefox 系浏览器在分类页显示可读名称。
- [ ] 新增默认名称不改变用户已保存 override。
- [ ] 不恢复历史自动分类。

## 阶段 6：新增 Firefox 扩展目录

- [ ] 新建 `extensions/firefox/`。
- [ ] 添加 Firefox 扩展文件：
  - [ ] `manifest.json`
  - [ ] `background.js`
  - [ ] `options.html`
  - [ ] `options.js`
  - [ ] `popup.html`
  - [ ] `popup.js`
  - [ ] `icons/icon-32.png`
  - [ ] `icons/icon-64.png`
  - [ ] `icons/icon-128.png`
  - [ ] `README.md`
  - [ ] `README.zh-CN.md`
  - [ ] `PRIVACY.md`
- [ ] 如果复制 Chromium UI 文件：
  - [ ] 将用户可见“Chromium”说明改成 Firefox 系。
  - [ ] 保持连接设置行为一致。
  - [ ] 保持中英文文案结构一致。
  - [ ] 不引入 Firefox 商店草案，除非本轮明确准备上架。
- [ ] 如果复用图标：
  - [ ] 确认许可证和来源仍然适用。
  - [ ] 不生成不必要的新视觉资产。
- [ ] 将 Firefox 扩展内 `browserKind` 设为稳定值：
  - [ ] 默认 `firefox`。
  - [ ] 如果能可靠识别 Zen，可发送 `zen`，否则不要硬猜。
- [ ] 确认 payload 字段与 Rust `BrowserActiveTabPayload` 完全兼容。

验收：

- [ ] `extensions/firefox` 可以独立作为未打包扩展目录加载。
- [ ] 扩展界面仍然只负责连接状态，不把状态搬到 Patina 设置页。
- [ ] Firefox 扩展隐私说明与实际行为一致。

## 阶段 7：新增 Firefox 扩展脚本

- [ ] 新建 `scripts/firefox-extension.ts`，或提取通用扩展打包脚本后配置两个 target。
- [ ] 默认优先新建 `scripts/firefox-extension.ts`，避免一次性抽象过大。
- [ ] 添加 npm 脚本：
  - [ ] `extension:firefox:check`
  - [ ] `extension:firefox:build`
  - [ ] `extension:firefox:package`
- [ ] Firefox check 至少验证：
  - [ ] `extensions/firefox/manifest.json` 存在且 JSON 合法。
  - [ ] manifest version 合法。
  - [ ] background 配置符合 Firefox target。
  - [ ] 权限只包含所需权限。
  - [ ] host permissions 限于本地 Patina bridge。
  - [ ] CSP 不允许远程任意地址。
  - [ ] options / popup / icons 齐全。
  - [ ] background 不包含 Chromium `/_favicon/` 专用逻辑。
  - [ ] background 包含 `/web-activity` 上报逻辑。
  - [ ] background 包含隐私窗口跳过逻辑。
- [ ] Firefox build 输出：
  - [ ] `dist/extensions/firefox/unpacked`
- [ ] Firefox package 输出：
  - [ ] `dist/extensions/firefox/patina-firefox-extension-vX.Y.Z.zip`
- [ ] zip 内部根目录：
  - [ ] `patina-firefox-extension-vX.Y.Z/`

验收：

- [ ] `npm run extension:firefox:check` 通过。
- [ ] `npm run extension:firefox:build` 通过。
- [ ] `npm run extension:firefox:package` 通过。
- [ ] Firefox zip 解压后不会把文件散落到当前目录。

## 阶段 8：设置页说明更新

- [ ] 更新 `src/shared/copy/domains/settingsCopy.ts`。
- [ ] 将“下载 Patina Web Sync 扩展包：patina-chromium-extension-v...zip”改成分浏览器系说明。
- [ ] 中文说明建议包含：
  - [ ] Chromium 系浏览器使用 `patina-chromium-extension-v...zip`。
  - [ ] Firefox 系浏览器使用 `patina-firefox-extension-v...zip`。
  - [ ] 解压对应 zip。
  - [ ] 在对应浏览器扩展管理页加载解压后的目录。
  - [ ] 在扩展设置页填写 Patina 端口和 Token。
  - [ ] 保持 Patina 网页同步开关开启并保存。
- [ ] 英文说明同步等价结构。
- [ ] 不在设置页宣称未手工验收的浏览器“已支持”。
- [ ] 不新增大块常驻说明。
- [ ] 如果说明过长，保持现有 help dialog 结构，不把服务面板变重。
- [ ] 更新 UI smoke 中对 settings copy 的断言。

验收：

- [ ] 中英文 copy key 结构保持一致。
- [ ] 设置页帮助弹窗仍符合 Quiet Pro。
- [ ] 没有新增营销式文案。

## 阶段 9：发布流程更新

- [ ] 更新 `package.json` 的 release 检查链。
- [ ] 将 `npm run extension:firefox:check` 加入发布前验证。
- [ ] 更新 `.github/workflows/prepare-release.yml`：
  - [ ] 打包 Chromium 扩展。
  - [ ] 打包 Firefox 扩展。
  - [ ] 上传 `patina-chromium-extension-vX.Y.Z.zip`。
  - [ ] 上传 `patina-firefox-extension-vX.Y.Z.zip`。
  - [ ] 保持 R2 不同步浏览器扩展包，除非长期发布策略变更。
- [ ] 更新 release notes 生成逻辑，如当前脚本需要显式列出附件。
- [ ] 更新 `docs/versioning-and-release-policy.md`：
  - [ ] 说明两个扩展包命名。
  - [ ] 说明两个扩展包版本独立来自各自 manifest。
  - [ ] 说明 GitHub Release 附件包含 Chromium 与 Firefox 扩展包。
  - [ ] 说明 R2 仍不同步扩展包。
- [ ] 如果 Firefox 扩展版本与 Chromium 扩展版本不同，确认工作流能分别读取两个 manifest。

验收：

- [ ] 发布检查脚本能覆盖 Firefox 扩展。
- [ ] workflow 不再只假设一个 extension asset。
- [ ] 发布文档和 workflow 行为一致。

## 阶段 10：自动化测试

- [ ] Rust 测试：
  - [ ] `is_supported_browser_exe` 覆盖 Chromium 系。
  - [ ] `is_supported_browser_exe` 覆盖 Firefox 系。
  - [ ] `record_active_tab` 覆盖 Firefox 前台写入。
  - [ ] `seal_if_tracking_inactive` 覆盖离开 Firefox 后封口。
- [ ] Node / frontend 测试：
  - [ ] `tests/uiSmoke.test.ts` 检查 settings copy 提到两类扩展包。
  - [ ] `tests/uiSmoke.test.ts` 检查 Firefox 扩展不包含 Chromium-only favicon cache 断言。
  - [ ] 新增或扩展 extension check，覆盖 Firefox manifest。
- [ ] 发布脚本测试：
  - [ ] 如果已有 release policy 测试涉及 extension asset，补 Firefox asset。
- [ ] 分类测试：
  - [ ] 默认映射覆盖 `zen.exe` 等 Firefox 系候选。

验收命令：

- [ ] `npm run extension:chromium:check`
- [ ] `npm run extension:firefox:check`
- [ ] `npm run test:classification`
- [ ] `npm run test:ui-smoke`
- [ ] `npm run check:rust`
- [ ] `npm run check:frontend`
- [ ] `npm run release:check`

说明：

- 若只完成非发布范围的局部代码，可先运行命中的专项命令。
- 准备合并完整 #29 时，默认必须跑 `npm run release:check`，因为发布附件和版本规则被触及。

## 阶段 11：手工验收

### 11.1 Firefox 验收

- [ ] 构建 Firefox 扩展包。
- [ ] 解压 `patina-firefox-extension-vX.Y.Z.zip`。
- [ ] 在 Firefox 扩展管理页加载扩展。
- [ ] 在 Patina 设置页开启网页同步。
- [ ] 复制端口和 Token 到 Firefox 扩展设置页。
- [ ] 打开普通网页 `https://github.com/`。
- [ ] 确认扩展显示连接成功。
- [ ] 确认 Patina History / Classification 能看到网页活动。
- [ ] 切换到另一个域名，确认旧 segment 封口，新 segment 开始。
- [ ] 从 Firefox 切到 VS Code 或其他应用，确认当前网页 segment 封口。
- [ ] 切回 Firefox，确认新网页 segment 开始。
- [ ] 打开隐私窗口，确认不写入网页记录。
- [ ] 打开 `about:` 或浏览器内部页，确认不写入网页记录。
- [ ] 关闭 Patina 网页同步开关，确认扩展不继续写入。
- [ ] Token 错误时，确认扩展显示错误，不写入。

### 11.2 Zen 验收

- [ ] 在 Zen 中加载 Firefox 扩展。
- [ ] 重复 Firefox 验收中的连接、写入、切换、封口、隐私窗口、内部页测试。
- [ ] 确认 Patina 前台窗口 exe 识别为 `zen.exe`。
- [ ] 确认 `zen.exe` 的网页活动能写入。
- [ ] 记录 Zen 是否能可靠给出 favicon。
- [ ] 如果 Zen 的扩展环境与 Firefox 不一致，记录差异，不扩大承诺。

### 11.3 候选浏览器验收

只有需要把候选浏览器写入用户可见支持列表时，才执行本节。

- [ ] Floorp：
  - [ ] 确认 exe 名。
  - [ ] 加载扩展。
  - [ ] 完成基础写入和封口验收。
- [ ] Iceweasel：
  - [ ] 确认 exe 名。
  - [ ] 加载扩展。
  - [ ] 完成基础写入和封口验收。

验收：

- [ ] Firefox 和 Zen 都完成真实 Windows 验收。
- [ ] 未验收候选浏览器不进入用户可见已验证列表。
- [ ] 手工验收记录写入本执行方案或后续归档说明。

## 阶段 12：文档与发布说明

- [ ] 更新 `extensions/firefox/README.md`。
- [ ] 更新 `extensions/firefox/README.zh-CN.md`。
- [ ] 更新 `extensions/firefox/PRIVACY.md`。
- [ ] 如 Chromium README 中存在“唯一扩展包”口径，改成 Chromium 系自身说明。
- [ ] 更新 `docs/versioning-and-release-policy.md`。
- [ ] 准备 changelog：
  - [ ] 在 `CHANGELOG.md` 的 `Unreleased` 中记录用户可见变化。
  - [ ] 使用 `Refs #29`，不使用关闭关键字。
- [ ] 如果要评论 GitHub issue：
  - [ ] 说明新增 Firefox 系扩展支持。
  - [ ] 说明已验证浏览器。
  - [ ] 说明未验证候选浏览器边界。
  - [ ] 不关闭 issue，除非用户明确要求。

验收：

- [ ] 用户能从设置页知道自己该下载哪个扩展包。
- [ ] 发布策略文档与 GitHub Actions 一致。
- [ ] 隐私说明与实际采集范围一致。

## 阶段 13：最终验证门槛

完整完成 #29 前，至少执行：

- [ ] `npm run extension:chromium:check`
- [ ] `npm run extension:firefox:check`
- [ ] `npm run check:frontend`
- [ ] `npm run check:rust`
- [ ] `npm run release:check`

如果改动触及发布 workflow：

- [ ] 本地检查 workflow 中两个扩展附件变量。
- [ ] 确认两个扩展 zip 都在 GitHub Release 上传列表中。
- [ ] 不在本地手工生成正式安装包或 updater artifact，除非是在排查发布流水线。

如果无法运行某个验证：

- [ ] 在交付说明中明确写出未运行的命令。
- [ ] 写明原因。
- [ ] 写明残余风险。

## 7. 风险清单

- [ ] Firefox MV3 background 行为与 Chromium 不一致，导致 service worker 方案不能直接复用。
- [ ] Firefox favicon 不能使用 Chromium `/_favicon/` 缓存机制，导致 favicon 行为与 Chromium 不完全一致。
- [ ] Zen 扩展环境与 Firefox 存在差异。
- [ ] Firefox 系候选浏览器 exe 名不稳定。
- [ ] 用户误以为所有 Firefox fork 都已验证。
- [ ] 发布流程只上传一个扩展包，导致设置页说明与 release 附件不一致。
- [ ] 权限说明不清楚，降低用户对本地优先和隐私边界的信任。

## 8. 回滚策略

如果 Firefox 扩展实现失败：

- [ ] 保留 Chromium 扩展原行为。
- [ ] 不发布 `patina-firefox-extension-vX.Y.Z.zip`。
- [ ] 设置页不展示 Firefox 扩展安装步骤。
- [ ] Rust 端若已经添加 Firefox 系 exe，但没有官方扩展包，应评估是否保留为未公开能力。
- [ ] changelog 不写成已支持 Firefox 系。

如果发布流程改动失败：

- [ ] 回退 workflow 中 Firefox 附件上传。
- [ ] 保留源码但不进入 release package。
- [ ] 在 `Unreleased` 中标记为内部准备，不写成用户可用能力。

## 9. 完成定义

只有同时满足以下条件，才算 #29 完成：

- [ ] `extensions/firefox` 存在并可构建、可打包。
- [ ] Firefox 扩展能把活动网页同步到本机 Patina。
- [ ] Rust 端支持 Firefox 系前台浏览器写入网页 segment。
- [ ] Firefox 和 Zen 在 Windows 上完成手工验收。
- [ ] 设置页说明能指导用户选择 Chromium 或 Firefox 扩展包。
- [ ] GitHub Release workflow 会上传两个扩展包。
- [ ] 发布与版本政策文档已同步。
- [ ] 自动化验证通过。
- [ ] changelog 使用用户可理解语言记录变化。
- [ ] 没有使用 issue-closing 关键字，除非用户明确要求关闭 #29。

## 10. 后续非目标

本轮完成后仍不自动包含：

- [ ] Firefox Add-ons 商店上架。
- [ ] Chrome Web Store / Edge Add-ons 正式审核。
- [ ] Safari / WebKit 支持。
- [ ] Tor Browser / Mullvad Browser 默认支持。
- [ ] Native Messaging 迁移。
- [ ] 云端网页同步。
- [ ] 跨设备同步。

这些如果未来要做，应单独开执行方案。
