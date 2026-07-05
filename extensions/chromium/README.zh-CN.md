# Patina Web Sync

Patina 的 Chromium MV3 浏览器扩展伴随项目。

本文档说明扩展项目本身。面向用户的网页同步配置说明放在 Patina 设置页中。

英文项目说明见 [`README.md`](./README.md)。

## 用途

Patina Web Sync 会把 Chromium 系浏览器中的当前活动网页同步到本机 Patina，让 Patina 可以把网页活动纳入本地优先的时间记录。

## 当前分发方式

Patina Web Sync 当前通过 GitHub Releases 分发，并采用手动本地安装。

Chrome Web Store 上架材料保留在本仓库中，供未来提交商店使用；当前扩展尚未发布到 Chrome Web Store。

## 源码结构

- `manifest.json`：Chromium MV3 扩展 manifest。
- `background.js`：用于活动标签页同步和本地 Patina 请求的 service worker。
- `popup.html` / `popup.js`：浏览器操作弹窗。
- `options.html` / `options.js`：扩展选项页。
- `icons/`：扩展图标。
- `PRIVACY.md`：Chrome Web Store 隐私政策草案。
- `STORE_LISTING.md`：Chrome Web Store 商店信息草案。

## 维护流程

检查扩展源码：

```bash
npm run extension:chromium:check
```

构建未打包扩展：

```bash
npm run extension:chromium:build
```

构建发布 zip：

```bash
npm run extension:chromium:package
```

可上传的 zip 会生成在：

```text
dist/extensions/chromium/patina-chromium-extension-v0.1.0.zip
```

文件名中的版本号来自 `manifest.json`。
zip 内包含一个带版本号的扩展目录。用户需要在浏览器扩展页加载解压后的目录，并在 Patina 设置页中继续查看网页同步说明。

## 范围

- 只向本机 Patina 发送活动标签页的 URL、标题、favicon、隐身标记、标签页/窗口 id、浏览器类型和时间戳。
- 活动标签页变化时使用一次本地 HTTP POST；时间归属由 Patina 的前台应用追踪器处理。
- 使用浏览器本地 favicon 缓存，把活动标签页图标转成本地数据用于图标颜色。
- 不读取页面 DOM、表单值、截图、剪贴板、浏览历史库或网页正文。
- 扩展配置保存在浏览器的本地扩展存储中。

## Chrome Web Store 草案

- 隐私政策：[`PRIVACY.md`](./PRIVACY.md)
- 商店信息草案：[`STORE_LISTING.md`](./STORE_LISTING.md)
