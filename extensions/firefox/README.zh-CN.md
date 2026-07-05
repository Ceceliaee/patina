# Patina Web Sync

Patina 的 Firefox 系浏览器扩展伴随项目。

本文档说明扩展项目本身。面向用户的网页同步配置说明放在 Patina 设置页中。

英文项目说明见 [`README.md`](./README.md)。

## 用途

Patina Web Sync 会把 Firefox 系浏览器中的当前活动网页同步到本机 Patina，让 Patina 可以把网页活动纳入本地优先的时间记录。

## 当前分发方式

Patina Web Sync 当前通过 GitHub Releases 分发，并采用手动本地安装。
Firefox 系浏览器的正式用户安装包是经 Mozilla AMO `unlisted` 签名的 `.xpi`。

本目标暂不包含 Firefox Add-ons 上架材料。商店提交不在本轮范围内。

## 源码结构

- `manifest.json`：Firefox MV3 WebExtension manifest。
- `background.js`：用于活动标签页同步和本地 Patina 请求的后台脚本。
- `popup.html` / `popup.js`：浏览器操作弹窗。
- `options.html` / `options.js`：扩展选项页。
- `icons/`：扩展图标。
- `PRIVACY.md`：本扩展目标的隐私说明。

## 维护流程

检查扩展源码：

```bash
npm run extension:firefox:check
```

构建未打包扩展：

```bash
npm run extension:firefox:build
```

构建未签名开发 zip：

```bash
npm run extension:firefox:package
```

未签名 zip 会生成在：

```text
dist/extensions/firefox/patina-firefox-extension-v0.1.0.zip
```

这个 zip 只用于本地开发、临时调试或人工排查，不作为 GitHub Release 的 Firefox 用户安装附件。

构建签名 `.xpi`：

```bash
WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... npm run extension:firefox:sign
```

签名 `.xpi` 会生成在：

```text
dist/extensions/firefox/patina-firefox-extension-v0.1.0.xpi
```

文件名中的版本号来自 `manifest.json`。
正式 GitHub Release 只上传签名后的 `.xpi`。用户需要在 Firefox 附加组件管理器中选择“从文件安装附加组件”，并在 Patina 设置页中继续查看网页同步说明。

## 范围

- 只向本机 Patina 发送活动标签页的 URL、标题、favicon URL、隐身标记、标签页/窗口 id、浏览器类型和时间戳。
- 活动标签页变化时使用一次本地 HTTP POST；时间归属由 Patina 的前台应用追踪器处理。
- 使用浏览器提供的活动标签页元数据记录网站图标信息。
- 不读取页面 DOM、表单值、截图、剪贴板、浏览历史库或网页正文。
- 扩展配置保存在浏览器的本地扩展存储中。
