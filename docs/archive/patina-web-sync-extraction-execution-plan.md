# Patina Web Sync 独立化执行方案

## 0. 文档定位

本文是一份临时执行单，用于把 `Patina Web Sync` 从 `Patina` 主仓库中独立出去。

执行完成后，本文不应长期停留在顶层规则体系中；若拆分已经完成，应将本文移入 `docs/archive/`，并把长期事实回写到相关顶层文档。

> 归档记录：本计划已于 2026-07-04 执行完成并归档；勾选项表示已执行、已迁移或已复核。Firefox AMO 签名未在迁仓验证中运行，保留为未来正式发布动作。

## 1. 第一性原理判断

### 1.1 先定义真实产品边界

- [x] 确认 `Patina` 的核心产品边界仍是个人、本地优先、Windows 桌面时间追踪工具。
- [x] 确认本次拆分不把 `Patina` 扩张为账号系统、云同步系统、团队 SaaS 或多端同步平台。
- [x] 确认 `Patina Web Sync` 是浏览器 companion，而不是 `Patina` 的核心运行时。
- [x] 确认网页活动记录在 `Patina` 中仍属于本地时间记录补全能力，而不是远程数据同步能力。

### 1.2 先定义系统不变量

拆分过程中必须保持以下不变量：

- [x] `Patina` 仍能在没有浏览器扩展时正常运行。
- [x] `Patina` 的本地数据库、备份、恢复、清理历史和网页活动回看语义不被破坏。
- [x] `Patina` 仍拥有网页活动接收端、token 校验、端口设置、数据写入和读模型。
- [x] `Patina Web Sync` 只负责读取浏览器 active tab，并把必要元数据发送到本机 `Patina`。
- [x] 浏览器扩展仍只连接 `127.0.0.1` 或 `localhost`，不引入远程服务。
- [x] 浏览器扩展仍不读取页面正文、表单内容、截图、剪贴板、浏览器历史数据库或 cookie。
- [x] Firefox 扩展的 `browser_specific_settings.gecko.id` 保持稳定。
- [x] Chromium 与 Firefox 扩展版本号继续由各自 `manifest.json` 管理。
- [x] 第一轮独立化后，优先让 Chromium 与 Firefox 使用一致的 manifest version。
- [x] 当前 Chromium 为 `0.1.0`，Firefox 为 `0.1.1`；对齐时应把 Chromium 提升到 `0.1.1`，不要降低 Firefox。
- [x] Firefox 已进入 AMO 签名链路后，后续同一 gecko id 的 manifest version 只能向前，不能回退到 `0.1.0`。

### 1.3 先定义拆分边界

本次拆分采用两个本地项目、两个 GitHub 仓库的边界：

```text
C:\Users\SYBao\Documents\Code\
  Patina\
  Patina-Web-Sync\
```

- [x] `Patina` 保留桌面主应用、Tauri runtime、SQLite 数据、Settings 指引和本机 HTTP 接收端。
- [x] `Patina-Web-Sync` 承接 Chromium / Firefox 浏览器扩展源码、扩展构建脚本、扩展发布工作流、扩展隐私政策和商店素材。
- [x] 不把 `Patina-Web-Sync` 放进 `Patina/extensions`。
- [x] 不使用 symlink 维持两个项目共享源码。
- [x] 不使用 git submodule 作为第一版拆分方式。
- [x] 不把 `Patina` 的 Rust `web_activity` engine、SQLite repository、History read model 或 Classification web domain 管理一起拆走。

### 1.4 先定义协议边界

`Patina` 与 `Patina Web Sync` 之间只通过本机 HTTP 协议协作。

- [x] `Patina` 是协议接收端 owner。
- [x] `Patina Web Sync` 是协议客户端实现。
- [x] 当前协议入口保持为 `POST /web-activity`。
- [x] 当前鉴权方式保持为 `Authorization: Bearer <token>`。
- [x] 当前本机地址范围保持为 `http://127.0.0.1:<port>` 和 `http://localhost:<port>`。
- [x] 当前 payload 字段至少覆盖 `browserClientId`、`browserKind`、`extensionVersion`、`tabId`、`windowId`、`url`、`title`、`favIconUrl`、`incognito`、`capturedAtMs`、`eventReason`。
- [x] `protocolVersion` 由扩展继续发送，但 `Patina` 当前不应因为拆分立刻引入复杂版本协商，除非另有明确需求。

## 2. 当前耦合点盘点

### 2.1 当前应迁出的内容

- [x] 迁出 `extensions/chromium/manifest.json`。
- [x] 迁出 `extensions/chromium/background.js`。
- [x] 迁出 `extensions/chromium/options.html`。
- [x] 迁出 `extensions/chromium/options.js`。
- [x] 迁出 `extensions/chromium/popup.html`。
- [x] 迁出 `extensions/chromium/popup.js`。
- [x] 迁出 `extensions/chromium/icons/*`。
- [x] 迁出 `extensions/chromium/README.md`。
- [x] 迁出 `extensions/chromium/README.zh-CN.md`。
- [x] 迁出 `extensions/chromium/PRIVACY.md`。
- [x] 迁出 `extensions/chromium/STORE_LISTING.md`。
- [x] 迁出 `extensions/firefox/manifest.json`。
- [x] 迁出 `extensions/firefox/background.js`。
- [x] 迁出 `extensions/firefox/options.html`。
- [x] 迁出 `extensions/firefox/options.js`。
- [x] 迁出 `extensions/firefox/popup.html`。
- [x] 迁出 `extensions/firefox/popup.js`。
- [x] 迁出 `extensions/firefox/icons/*`。
- [x] 迁出 `extensions/firefox/README.md`。
- [x] 迁出 `extensions/firefox/README.zh-CN.md`。
- [x] 迁出 `extensions/firefox/PRIVACY.md`。
- [x] 迁出 `extensions/store-assets/*`。
- [x] 迁出 `scripts/chromium-extension.ts`。
- [x] 迁出 `scripts/firefox-extension.ts`。

### 2.2 当前应留在 Patina 的内容

- [x] 保留 `src-tauri/src/platform/web_activity_bridge.rs`。
- [x] 保留 `src-tauri/src/app/web_activity_bridge.rs`。
- [x] 保留 `src-tauri/src/app/web_activity.rs`。
- [x] 保留 `src-tauri/src/engine/web_activity/mod.rs`。
- [x] 保留 `src-tauri/src/domain/web_activity.rs`。
- [x] 保留 `src-tauri/src/data/repositories/web_activity.rs`。
- [x] 保留 `src-tauri/src/data/backup*` 中与 `web_activity_segments` 相关的备份恢复能力。
- [x] 保留 `src/platform/persistence/webActivityRepository.ts`。
- [x] 保留 `src/platform/runtime/webActivityBridgeGateway.ts`。
- [x] 保留 Settings 中的网页同步开关、端口、token 和连接状态读取。
- [x] 保留 History / Data / Classification 中的网页活动展示和分类管理。
- [x] 保留 `web_activity_segments` schema、migration、repair、backup、restore 和 cleanup 语义。

### 2.3 当前应改写的 Patina 耦合点

- [x] `package.json` 中移除或替换 `extension:*` 脚本。
- [x] `package.json` 中更新 `release:check`，不再依赖扩展检查。
- [x] `.github/workflows/prepare-release.yml` 中移除扩展打包、Firefox 签名和扩展 asset 上传步骤。
- [x] `docs/versioning-and-release-policy.md` 中移除 Patina Release 必须包含扩展附件的长期规则。
- [x] `scripts/release.ts` 中移除 release notes 对 Patina Release 扩展附件的固定提示。
- [x] `README.md` 和 `README.zh-CN.md` 中更新 Patina Web Sync 的下载来源说明。
- [x] `src/shared/copy/domains/settingsCopy.ts` 中更新网页同步使用说明，指向独立 `Patina-Web-Sync` release 或商店入口。
- [x] `CHANGELOG.md` 的 `Unreleased` 中记录本次用户可见和内部发布链变化。

## 3. 阶段 A：准备与冻结

### 3.1 工作区准备

- [x] 在 `Patina` 仓库运行 `git status --short`。
- [x] 记录当前未提交改动，区分本次拆分相关改动和用户已有改动。
- [x] 若存在不相关未提交改动，不要回滚；执行时避开或按 owner 协同。
- [x] 确认 `docs/working/patina-web-sync-extraction-execution-plan.md` 是当前执行依据。
- [x] 确认本次不执行真实发布、不推 tag、不创建 GitHub Release，除非用户另行明确要求。

### 3.2 基线验证

- [x] 在 `Patina` 仓库运行 `npm run extension:chromium:check`，确认迁出前 Chromium 扩展基线可用。
- [x] 在 `Patina` 仓库运行 `npm run extension:firefox:check`，确认迁出前 Firefox 扩展基线可用。
- [x] 在 `Patina` 仓库运行 `npm run check:types`，确认迁出前 TypeScript 基线可用。
- [x] 若以上任一失败，先判断是否与本次拆分无关；不要把旧失败混入拆分提交。
- [x] 记录基线结果到执行记录或最终交付说明。

### 3.3 协议冻结

- [x] 新增或准备新增 `Patina/docs/web-activity-protocol.md`。
- [x] 在协议文档中写明 `POST /web-activity`。
- [x] 在协议文档中写明 Bearer token 鉴权。
- [x] 在协议文档中写明本机地址范围。
- [x] 在协议文档中写明请求 payload 字段、字段类型、隐私边界和忽略规则。
- [x] 在协议文档中写明响应语义：`ok`、`enabled`、`changed`、`serverTimeMs`、`code`、`message`。
- [x] 在协议文档中写明 `Patina` 是接收端 owner，`Patina-Web-Sync` 是客户端 owner。
- [x] 在协议文档中写明协议变更流程：先兼容接收端，再更新扩展，再移除旧兼容。

## 4. 阶段 B：创建本地 `Patina-Web-Sync` 项目

### 4.1 创建同级目录

- [x] 确认目标路径为 `C:\Users\SYBao\Documents\Code\Patina-Web-Sync`。
- [x] 若目标路径已存在，先检查其内容，不覆盖未知文件。
- [x] 若目标路径不存在，创建该目录。
- [x] 在 `Patina-Web-Sync` 中创建下面的目标结构：

```text
Patina-Web-Sync/
  package.json
  package-lock.json
  README.md
  README.zh-CN.md
  CHANGELOG.md
  LICENSE
  .gitignore
  docs/
    patina-web-activity-protocol.md
  src/
    chromium/
    firefox/
  scripts/
    chromium-extension.ts
    firefox-extension.ts
  store-assets/
```

- [x] 确认 `dist/`、`node_modules/`、`.web-extension-id`、签名产物和临时包产物进入 `.gitignore`。

### 4.2 复制扩展源码

- [x] 将 `Patina/extensions/chromium/*` 复制到 `Patina-Web-Sync/src/chromium/`。
- [x] 将 `Patina/extensions/firefox/*` 复制到 `Patina-Web-Sync/src/firefox/`。
- [x] 将 `Patina/extensions/store-assets/*` 复制到 `Patina-Web-Sync/store-assets/`。
- [x] 将 `Patina/scripts/chromium-extension.ts` 复制到 `Patina-Web-Sync/scripts/chromium-extension.ts`。
- [x] 将 `Patina/scripts/firefox-extension.ts` 复制到 `Patina-Web-Sync/scripts/firefox-extension.ts`。
- [x] 复制后检查 `src/chromium/manifest.json` 是否存在。
- [x] 复制后检查 `src/firefox/manifest.json` 是否存在。
- [x] 复制后检查 Chromium 图标文件是否存在。
- [x] 复制后检查 Firefox 图标文件是否存在。
- [x] 复制后检查隐私政策文件是否存在。

### 4.3 调整构建脚本路径

- [x] 在 `scripts/chromium-extension.ts` 中把 `SOURCE_DIR` 从 `extensions/chromium` 改为 `src/chromium`。
- [x] 在 `scripts/firefox-extension.ts` 中把 `SOURCE_DIR` 从 `extensions/firefox` 改为 `src/firefox`。
- [x] 保持 Chromium 输出路径为 `dist/extensions/chromium/...`，除非决定统一改为 `dist/chromium/...`。
- [x] 保持 Firefox 输出路径为 `dist/extensions/firefox/...`，除非决定统一改为 `dist/firefox/...`。
- [x] 更新脚本中的错误文案，不再提示 `extensions/chromium/manifest.json` 或 `extensions/firefox/manifest.json`。
- [x] 确认脚本仍检查 host permissions 只允许本机地址。
- [x] 确认脚本仍检查 CSP 不允许远程 fetch。
- [x] 确认脚本仍检查 Firefox 不使用 Chromium-only favicon permission。
- [x] 确认脚本仍检查 Firefox gecko id 稳定。

### 4.4 创建新项目 `package.json`

- [x] 设置 `name` 为 `patina-web-sync`。
- [x] 明确 `Patina-Web-Sync` 的 GitHub 仓库应是公开仓库，因为它是 `Patina` 的伴生浏览器扩展项目。
- [x] 在 `package.json` 中保留 `"private": true`，仅用于防止误发布到 npm；这不代表 GitHub 仓库是私有的。
- [x] 若未来明确要把共享工具包发布到 npm，再单独移除 `"private": true` 并补 npm 发布规则。
- [x] 设置项目自身版本号时，与浏览器 target 版本保持一致，第一轮建议使用 `0.1.1`。
- [x] 将 Chromium `manifest.json` 从 `0.1.0` 提升到 `0.1.1`，与当前 Firefox `manifest.json` 对齐。
- [x] 保留 Firefox `manifest.json` 为 `0.1.1`，不要回退。
- [x] Firefox 目标后续发布只能提升到大于 `0.1.1` 的版本；不要因迁仓、重建或补签名把 Firefox manifest version 回退。
- [x] 将 `package.json` 项目版本设为 `0.1.1`，并让发布 tag `v0.1.1` 对应两个浏览器 target 的同一版本线。
- [x] 设置 `"type": "module"`。
- [x] 添加 `extension:chromium:check`。
- [x] 添加 `extension:chromium:build`。
- [x] 添加 `extension:chromium:package`。
- [x] 添加 `extension:firefox:check`。
- [x] 添加 `extension:firefox:build`。
- [x] 添加 `extension:firefox:package`。
- [x] 添加 `extension:firefox:sign`。
- [x] 添加 `check`，串联 Chromium 与 Firefox check。
- [x] 添加 `release:check`，至少串联 `check` 和必要的版本/包名检查。
- [x] 添加 `web-ext` 到 devDependencies。
- [x] 添加 TypeScript 或 Node 类型依赖，确保脚本可被 `node --experimental-strip-types` 执行。

### 4.5 安装依赖并生成 lockfile

- [x] 在 `Patina-Web-Sync` 中运行 `npm install`。
- [x] 确认生成 `package-lock.json`。
- [x] 确认没有把 `node_modules/` 纳入 git。
- [x] 若网络或 registry 不可用，记录阻塞原因，并保留文件迁移结果。

### 4.6 新项目文档

- [x] 新建 `Patina-Web-Sync/README.md`，说明这是 Patina 的浏览器扩展 companion。
- [x] 新建 `Patina-Web-Sync/README.zh-CN.md`，提供中文说明。
- [x] 在 README 中说明本项目不是云同步服务。
- [x] 在 README 中说明需要本机 Patina 开启 Web Sync 后才能使用。
- [x] 在 README 中说明 Chromium 开发加载方式。
- [x] 在 README 中说明 Firefox 签名 `.xpi` 安装方式。
- [x] 在 README 中说明扩展只发送当前活动网页元数据到本机 Patina。
- [x] 在 README 中链接协议文档。
- [x] 新建 `CHANGELOG.md`，建立 `Unreleased` 区块。
- [x] 复制或引用协议文档到 `docs/patina-web-activity-protocol.md`。
- [x] 更新隐私政策中的仓库链接，指向新仓库路径。
- [x] 更新 Chrome Web Store listing draft 中的隐私政策链接，指向新仓库路径。

## 5. 阶段 C：验证独立扩展项目

### 5.1 静态检查

- [x] 在 `Patina-Web-Sync` 中运行 `npm run extension:chromium:check`。
- [x] 在 `Patina-Web-Sync` 中运行 `npm run extension:firefox:check`。
- [x] 在 `Patina-Web-Sync` 中运行 `npm run check`。
- [x] 若检查失败，优先修路径、manifest、权限或 CSP，不改变协议语义。

### 5.2 Chromium 构建验证

- [x] 在 `Patina-Web-Sync` 中运行 `npm run extension:chromium:build`。
- [x] 确认生成 Chromium unpacked build。
- [x] 在 `Patina-Web-Sync` 中运行 `npm run extension:chromium:package`。
- [x] 确认生成 `patina-chromium-extension-vX.Y.Z.zip`。
- [x] 解压 zip，确认内部有同名版本目录。
- [x] 确认版本目录内直接包含 `manifest.json`。
- [x] 确认 zip 未包含 README、privacy、store listing 或其他非运行文件，除非明确决定发布包包含它们。

### 5.3 Firefox 构建验证

- [x] 在 `Patina-Web-Sync` 中运行 `npm run extension:firefox:build`。
- [x] 确认生成 Firefox unpacked build。
- [x] 在 `Patina-Web-Sync` 中运行 `npm run extension:firefox:package`。
- [x] 确认生成 unsigned development zip。
- [x] 不在迁仓验证阶段运行 `npm run extension:firefox:sign`，即使本机具备 AMO 凭据。
- [x] 记录“未执行 Firefox AMO 签名；签名只在正式发布且 Firefox manifest version 已按 AMO 要求向前提升时执行”。
- [x] 若需要 Firefox 手工联动验证，使用 Firefox 临时调试加载方式或既有已签名 `.xpi`，不要为了验证迁仓重新签名当前版本。

### 5.4 手工联动验证

- [x] 启动本地 Patina 开发版或已安装版。
- [x] 在 Patina Settings 中开启网页同步。
- [x] 复制 Patina Settings 中显示的端口。
- [x] 复制 Patina Settings 中显示的 token。
- [x] 在 Chromium 系浏览器加载 `Patina-Web-Sync` 的 unpacked build。
- [x] 在 Chromium 扩展选项页填入端口和 token。
- [x] 打开一个普通 `https://` 页面。
- [x] 点击扩展中的手动同步，确认状态变为已同步。
- [x] 在 Patina History 或 Classification 中确认出现对应 domain。
- [x] 切换到另一个网页 domain，确认 Patina 记录更新。
- [x] 关闭 Patina Settings 中网页同步开关，确认扩展状态显示 Patina 网页同步未开启或等价错误。
- [x] 若需要 Firefox 验证，使用临时调试加载或既有已签名 `.xpi` 重复安装和同步验证。
- [x] 验证无痕窗口不会写入网页记录。
- [x] 验证 `chrome://extensions`、`about:addons` 等非 `http/https` 页面不会写入网页记录。

## 6. 阶段 D：建立 `Patina-Web-Sync` Git 仓库

### 6.1 本地 git 初始化

- [x] 在 `Patina-Web-Sync` 中运行 `git init -b main`。
- [x] 检查 `git status --short`。
- [x] 确认 `dist/` 没有进入 git。
- [x] 确认 `node_modules/` 没有进入 git。
- [x] 确认 `package-lock.json` 进入 git。
- [x] 确认 `src/chromium` 和 `src/firefox` 进入 git。
- [x] 确认 `scripts` 进入 git。
- [x] 确认 `docs`、README、CHANGELOG、隐私政策和 store assets 按预期进入 git。

### 6.2 初始提交

- [x] 创建初始提交，提交信息建议为 `chore: split Patina Web Sync into standalone project`。
- [x] 检查初始提交 diff。
- [x] 确认初始提交不包含本地 secrets。
- [x] 确认初始提交不包含 AMO API key、token、Patina 本机 token 或个人路径之外的敏感信息。

### 6.3 GitHub 仓库创建

- [x] 在 GitHub 创建新仓库，建议名称为 `patina-web-sync`。
- [x] 仓库描述使用“Browser extension companion for Patina local-first desktop time tracking”或等价描述。
- [x] 不把它描述成 cloud sync。
- [x] 配置远端 `origin` 指向新仓库。
- [x] 推送 `main`。
- [x] 在 GitHub 上确认 README 正常显示。
- [x] 在 GitHub 上确认隐私政策链接可访问。

### 6.4 新仓库 CI

- [x] 新增 `.github/workflows/check.yml`。
- [x] CI 使用 Node 22。
- [x] CI 运行 `npm ci`。
- [x] CI 运行 `npm run check`。
- [x] 若需要检查 package 输出，CI 可运行 `npm run extension:chromium:package` 和 `npm run extension:firefox:package`。
- [x] CI 不默认执行 Firefox AMO 签名。
- [x] 推送 CI workflow。
- [x] 确认 GitHub Actions check 通过。

### 6.5 新仓库发布工作流

- [x] 新增 `.github/workflows/release.yml`。
- [x] 触发条件使用 `vX.Y.Z` tag 或手动补跑已有 tag。
- [x] 发布前运行 `npm ci`。
- [x] 发布前运行 `npm run check`。
- [x] 发布时生成 Chromium zip。
- [x] 只有在正式发布 Firefox 新版本时，才使用 AMO secrets 生成 Firefox signed `.xpi`。
- [x] 正式签名前必须确认 Firefox `manifest.json` version 高于最近一次已签名或已提交 AMO 审核的版本；不要对同一版本号重复签名。
- [x] 若独立化第一轮不发布 Firefox 新版本，可迁移或引用既有已签名 `0.1.1` `.xpi`，不要触发新的 AMO 签名。
- [x] Release asset 上传 `patina-chromium-extension-vX.Y.Z.zip`。
- [x] Release asset 上传 `patina-firefox-extension-vX.Y.Z.xpi`。
- [x] Firefox unsigned zip 不作为正式用户安装 asset 上传。
- [x] Release notes 来自 `CHANGELOG.md` 对应版本节，或第一版先手写但保持用户可读。
- [x] 不在 Web Sync release 中发布 Patina Windows 安装包。

## 7. 阶段 E：回收 Patina 主仓库中的扩展耦合

### 7.1 删除或停止维护扩展源码

第一版建议在确认新仓库可独立构建后，再从 `Patina` 删除扩展源码。

- [x] 确认 `Patina-Web-Sync` 已经有独立可验证提交。
- [x] 确认 `Patina-Web-Sync` 的 Chromium check 通过。
- [x] 确认 `Patina-Web-Sync` 的 Firefox check 通过。
- [x] 在 `Patina` 中删除 `extensions/chromium`。
- [x] 在 `Patina` 中删除 `extensions/firefox`。
- [x] 在 `Patina` 中删除 `extensions/store-assets`。
- [x] 在 `Patina` 中删除 `scripts/chromium-extension.ts`。
- [x] 在 `Patina` 中删除 `scripts/firefox-extension.ts`。
- [x] 保留或新增 `docs/web-activity-protocol.md`，避免协议知识随扩展源码一起消失。

### 7.2 更新 Patina `package.json`

- [x] 移除 `extension:chromium:check`。
- [x] 移除 `extension:chromium:build`。
- [x] 移除 `extension:chromium:package`。
- [x] 移除 `extension:firefox:check`。
- [x] 移除 `extension:firefox:build`。
- [x] 移除 `extension:firefox:package`。
- [x] 移除 `extension:firefox:sign`。
- [x] 从 `release:check` 中移除扩展检查。
- [x] 若 `web-ext` 只被扩展脚本使用，从 `devDependencies` 移除 `web-ext`。
- [x] 运行 `npm install` 或 `npm install --package-lock-only` 更新 lockfile。
- [x] 确认 `package-lock.json` 中不再保留不需要的 `web-ext` 依赖，除非其他脚本仍使用它。

### 7.3 更新 Patina release workflow

- [x] 在 `.github/workflows/prepare-release.yml` 中删除 `Package Chromium extension` step。
- [x] 在 `.github/workflows/prepare-release.yml` 中删除 `Sign Firefox extension` step。
- [x] 从 `Publish GitHub Release` 的 `files` 列表中移除 `${{ env.CHROMIUM_EXTENSION_ASSET }}`。
- [x] 从 `Publish GitHub Release` 的 `files` 列表中移除 `${{ env.FIREFOX_EXTENSION_ASSET }}`。
- [x] 移除不再需要的 AMO secret 检查。
- [x] 保留 Windows installer 和 `latest.json` 发布逻辑。
- [x] 确认 R2 镜像逻辑仍只处理 Patina installer 和 updater metadata。

### 7.4 更新 Patina 发布规范

- [x] 在 `docs/versioning-and-release-policy.md` 中移除“Patina Release 必须附带扩展包”的规则。
- [x] 在 `docs/versioning-and-release-policy.md` 中写明浏览器扩展由独立 `Patina-Web-Sync` 仓库发布。
- [x] 在 `docs/versioning-and-release-policy.md` 中写明 Patina release 不再运行扩展打包和 AMO 签名。
- [x] 在 `docs/versioning-and-release-policy.md` 中写明 Patina 的最低发布验证不再包含 `npm run extension:*:check`。
- [x] 在 `docs/versioning-and-release-policy.md` 中保留“Patina Settings 指向扩展发布来源”的长期事实。
- [x] 在 `docs/versioning-and-release-policy.md` 中不要把 Web Sync release 与 Patina release 绑定成同版本号。

### 7.5 更新 Patina release notes 生成

- [x] 在 `scripts/release.ts` 中删除“浏览器扩展包：Chromium 系下载...”这类固定提示。
- [x] 不在 Patina release notes 中额外说明 Web Sync 独立发布；该信息由 `README.md`、`README.zh-CN.md` 和 Settings 使用说明承载。
- [x] 确认 `npm run test:release` 覆盖或更新相关断言。

### 7.6 更新 Patina 用户文案

- [x] 更新 `README.md` 中 Patina Web Sync 的说明。
- [x] 更新 `README.zh-CN.md` 中 Patina Web Sync 的说明。
- [x] 更新 `src/shared/copy/domains/settingsCopy.ts` 中中文安装步骤。
- [x] 更新 `src/shared/copy/domains/settingsCopy.ts` 中英文安装步骤。
- [x] 将“下载 Patina Release 附件中的 zip/xpi”改为“从 Patina Web Sync 发布页或商店入口下载”。
- [x] 保留端口、token、开启 Web Sync、打开扩展选项页等配置步骤。
- [x] 不在 UI 中加入大面积宣传或强品牌化入口，保持 Quiet Pro 克制。

### 7.7 更新 Patina changelog

- [x] 在 `CHANGELOG.md` 的 `Unreleased` 中记录用户可见变化：浏览器扩展改由独立 Patina Web Sync 项目发布。
- [x] 在 `CHANGELOG.md` 的 `Unreleased` 中记录内部变化：Patina release workflow 不再打包浏览器扩展。
- [x] 不使用 issue-closing 关键字。
- [x] 如果关联 issue，只使用 `Refs #...`。

## 8. 阶段 F：Patina 主仓库验证

### 8.1 快速边界检查

- [x] 在 `Patina` 中运行 `rg -n "extension:chromium|extension:firefox|chromium-extension|firefox-extension|patina-chromium-extension|patina-firefox-extension" package.json scripts .github docs src README.md README.zh-CN.md CHANGELOG.md`。
- [x] 确认只剩下预期的历史 changelog、协议说明或用户下载文案。
- [x] 在 `Patina` 中运行 `rg -n "extensions/chromium|extensions/firefox|extensions/store-assets" .`。
- [x] 确认没有生产脚本或 release workflow 继续依赖旧路径。

### 8.2 前端与发布测试

- [x] 在 `Patina` 中运行 `npm run check:types`。
- [x] 在 `Patina` 中运行 `npm run test:settings`。
- [x] 在 `Patina` 中运行 `npm run test:release`。
- [x] 在 `Patina` 中运行 `npm run check:architecture`。
- [x] 在 `Patina` 中运行 `npm run check:naming`。
- [x] 在 `Patina` 中运行 `npm run build`。
- [x] 若改动仅限文档和 release workflow，可根据风险说明降级；若触及 UI 文案和 release script，至少保留上述专项验证。

### 8.3 完整验证

- [x] 在 `Patina` 中运行 `npm run check`。
- [x] 若删除扩展脚本影响 lockfile 或 workflow，确保 `npm run check` 覆盖 release 测试和 build。
- [x] 若触及 Rust 接收端或 web activity engine，追加 `npm run check:rust`。
- [x] 若触及 `docs/versioning-and-release-policy.md` 或 `scripts/release.ts`，追加 `npm run release:validate-changelog`。

### 8.4 手工 smoke

- [x] 打开 Patina Settings。
- [x] 确认网页同步开关仍存在。
- [x] 确认端口和 token 显示仍存在。
- [x] 确认使用说明弹窗仍能打开。
- [x] 确认使用说明不再指向已删除的 Patina release asset。
- [x] 使用 `Patina-Web-Sync` unpacked build 向本机 Patina 同步一个网页。
- [x] 确认 History 或 Classification 仍能显示网页 domain。

## 9. 阶段 G：版本与发布策略切换

### 9.1 Patina 版本策略

- [x] 判断 Patina 本次变化是否用户可见。
- [x] 若只是发布链和文案变化，通常属于 `PATCH` 或当前 `Unreleased` 内部变化。
- [x] 若设置页用户安装路径发生明显变化，记录在 `Changed`。
- [x] 不因为 Web Sync 独立发布而提高 Patina major version。
- [x] 不让 Patina 版本号与 Web Sync 版本号绑定。

### 9.2 Patina-Web-Sync 版本策略

- [x] 独立维护 Chromium manifest version。
- [x] 独立维护 Firefox manifest version。
- [x] 当前 Chromium manifest version 为 `0.1.0`，独立化第一轮应提升到 `0.1.1`。
- [x] 当前 Firefox manifest version 为 `0.1.1`。
- [x] Firefox 同一 AMO / gecko id 的版本号只能递增；迁仓后第一版 Firefox 正式发布必须大于或等于当前已签名版本，并优先只向前提升。
- [x] 不为了让两个浏览器目标看起来整齐而把 Firefox 从 `0.1.1` 降回 `0.1.0`。
- [x] 两个浏览器目标优先同版本发布；第一轮对齐到 `0.1.1`。
- [x] 未来若某个浏览器目标单独变化，也优先在下一次共同发布时重新对齐版本。
- [x] 若未来仅一个浏览器目标变化，允许只提升对应 target 的 manifest version，但 release notes 必须说清。
- [x] Git tag 可以使用 `vX.Y.Z` 表示 Web Sync 项目版本。
- [x] 若 target 版本开始分叉，发布 asset 文件名继续来自各自 manifest version。

### 9.3 发布顺序

推荐第一轮顺序：

- [x] 先发布或至少推送 `Patina-Web-Sync` 新仓库。
- [x] 再更新 `Patina` 设置说明，指向新仓库。
- [x] 再移除 `Patina` release workflow 中的扩展附件。
- [x] 最后准备 Patina 下一个版本的 changelog。

不要反过来先删除 Patina 中的扩展发布路径，再让用户没有任何可下载来源。

## 10. 风险与回滚

### 10.1 主要风险

- [x] 风险：新仓库路径调整导致扩展脚本找不到 manifest。
- [x] 风险：Patina release workflow 删除扩展步骤后，release notes 或 release test 仍期待扩展附件。
- [x] 风险：Settings 使用说明指向不存在的下载地址。
- [x] 风险：Firefox AMO 签名 secrets 未迁移到新仓库。
- [x] 风险：Chrome Web Store 隐私政策链接仍指向旧仓库路径。
- [x] 风险：Patina 文档误把 Web Sync 独立化描述成云同步能力。
- [x] 风险：删除 `web-ext` 后 lockfile 或 CI 缓存出现不一致。

### 10.2 停止条件

出现以下情况时，停止删除 Patina 旧扩展源码：

- [x] `Patina-Web-Sync` 无法独立通过 Chromium check。
- [x] `Patina-Web-Sync` 无法独立通过 Firefox check。
- [x] 新仓库尚无可访问的 README 或 release 下载来源。
- [x] Patina Settings 文案无法给用户一个明确安装入口。
- [x] Firefox AMO 签名所需 secrets 无法迁移，但当前发布仍依赖 Firefox `.xpi`。

### 10.3 回滚策略

- [x] 如果只是新仓库构建失败，保留 Patina 中的原扩展源码，先不删除旧路径。
- [x] 如果 Patina release workflow 已改坏，回滚 workflow 中扩展删除相关 commit，直到新仓库发布链可用。
- [x] 如果 Settings 文案指向错误，先修文案，不改运行时。
- [x] 如果协议联动失败，优先检查扩展 endpoint、端口、token 和 payload 字段，不移动 Patina Rust 接收端。
- [x] 如果必须短期保留双轨发布，在 Patina changelog 中明确这是过渡期，不把双轨写成长期规则。

## 11. 完成定义

本执行单完成需要同时满足：

- [x] 本地存在 `C:\Users\SYBao\Documents\Code\Patina` 和 `C:\Users\SYBao\Documents\Code\Patina-Web-Sync` 两个同级项目。
- [x] `Patina-Web-Sync` 能独立运行 Chromium extension check。
- [x] `Patina-Web-Sync` 能独立运行 Firefox extension check。
- [x] `Patina-Web-Sync` 能独立生成 Chromium zip。
- [x] `Patina-Web-Sync` 能独立生成 Firefox unsigned development zip。
- [x] Firefox AMO 签名已从迁仓验证中排除，并只保留为未来正式发布动作。
- [x] `Patina` 不再包含扩展源码和扩展构建脚本。
- [x] `Patina` release workflow 不再打包或上传扩展 asset。
- [x] `Patina` release check 不再依赖扩展检查。
- [x] `Patina` Settings 仍能指导用户安装和配置 Web Sync。
- [x] `Patina` 本机 HTTP bridge、web activity engine、SQLite 数据和 History / Classification 展示保持可用。
- [x] `Patina` 顶层长期文档已更新，不再把扩展附件写成 Patina Release 的必备产物。
- [x] `CHANGELOG.md` 已记录本次拆分带来的用户可见变化和内部发布链变化。
- [x] `npm run check` 在 `Patina` 中通过，或最终说明中清楚记录未运行/失败原因。
- [x] `npm run check` 在 `Patina-Web-Sync` 中通过，或最终说明中清楚记录未运行/失败原因。

## 12. 建议提交切分

推荐按以下提交拆分，避免一个巨大提交同时改变两个仓库和发布链：

- [x] `Patina-Web-Sync`: `chore: create standalone web sync project`
- [x] `Patina-Web-Sync`: `ci: add web sync validation workflow`
- [x] `Patina-Web-Sync`: `docs: document Patina web activity protocol`
- [x] `Patina`: `docs: document web activity protocol handoff`
- [x] `Patina`: `chore: remove bundled web sync extension sources`
- [x] `Patina`: `ci: stop publishing browser extension assets`
- [x] `Patina`: `docs: point web sync setup to standalone project`

如果实际执行中某个提交必须合并，优先保持每个提交的 owner 清晰：新仓库初始化、Patina release 链调整、Patina 用户文案调整不要混成难以回滚的一团。

## 13. 后续清理

- [x] 拆分完成后，将本文移动到 `docs/archive/`。
- [x] 如果拆分改变长期发布策略，确认 `docs/versioning-and-release-policy.md` 已经承载长期规则。
- [x] 如果拆分改变长期架构边界，确认 `docs/architecture.md` 是否需要补充“浏览器扩展为外部 companion，不属于 Patina 主仓库”。
- [x] 如果只是执行事实变化，不要把本文继续扩写成第二份长期规则。
