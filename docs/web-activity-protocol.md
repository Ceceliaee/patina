# Patina Web Activity 协议

## 目的

本文定义 Patina 与 Patina Web Sync 之间的本机协议。

Patina 拥有接收端和本地数据行为。Patina Web Sync 拥有浏览器扩展客户端，负责把活动标签页元数据发送给本机 Patina 应用。

## 边界

- 该协议仅用于本机通信。
- 客户端连接到 `http://127.0.0.1:<port>` 或 `http://localhost:<port>`。
- 鉴权使用 Patina Settings 显示的 bearer token。
- 该协议不是云同步、账号、分析或远程采集 API。
- 浏览器扩展发布由公开的 [`patina-web-sync`](https://github.com/Ceceliaee/patina-web-sync) companion 仓库负责。

## 接口

```http
POST /web-activity
Authorization: Bearer <token>
Content-Type: application/json
```

## Request Body

浏览器扩展发送 camelCase 字段的 JSON object 作为 request body：

```json
{
  "protocolVersion": 1,
  "browserClientId": "uuid-or-client-id",
  "browserKind": "chrome",
  "extensionVersion": "0.2.0",
  "url": "https://example.com/search?q=export-me#result",
  "title": "Example Page",
  "favIconUrl": "https://example.com/favicon.ico",
  "incognito": false
}
```

`url` 是浏览器提供的完整页面 URL，包括 path、query 和 fragment。Patina 在本机保存该值，供数据导出的 `url` / “URL 地址”字段使用，同时从中提取域名用于分类和统计。查询参数可能包含搜索词或其他敏感内容，因此商店声明和隐私政策必须明确披露完整 URL。

当前扩展客户端在发送前会跳过 incognito/private 标签页。普通 `http` / `https` 标签页仍使用协议 v1 payload，并可继续携带 `incognito: false` 字段以保持 shape 兼容。

Chromium 系客户端发送 `browserClientId`、`browserKind` 和 `extensionVersion`，用于本机客户端区分和兼容诊断。Firefox 142+ 客户端将这些字段归为可选的 `technicalAndInteraction` 数据；只有用户授予对应内置权限时才发送。Patina 接收端必须兼容这三个字段缺失。

新客户端不再发送 `tabId`、`windowId`、`capturedAtMs` 或 `eventReason`。接收端可以继续宽容解析旧客户端字段，但不得要求新客户端恢复这些非必要字段。

## 活动资格与有效截止

网页记录必须依附当前有效、来源匹配且未暂停或排除的原生浏览器会话；连接成功本身不授予计时资格。网页有效区间不得超出所属会话，原生截止回溯时也适用。

接收端要求原生成功采样不超过 8 秒，HTTP 处理排队不超过 5 秒。旧客户端的 `capturedAtMs` 必须位于当前会话内，且满足 `0 ≤ 接收时刻 − capturedAtMs ≤ 5000ms`；缺省使用接收时刻。暂停、锁屏、休眠、恢复或桥接配置变化后，旧请求不得恢复已失效的活动。关闭网页记录或清空 token 时结束当前网页，重新启用需新观察。

观察有效期为 45 秒，包含 30 秒扩展周期和 15 秒调度余量。读取时固定 `now`，截止取 `min(now, last_observation + 45s)`，原生会话更早的截止优先。过期后即使 URL 相同也开启新片段；失联可能少记，45 秒不代表正常前台切换精度。

## 无页面信息的停止通知

自动、周期和手动同步均只报告聚焦窗口中的活动普通标签，发送前重新确认；旧观察不得覆盖新页面。v1 无法让桌面端独立区分同 exe 的窗口或配置，扩展负责确认焦点；缺少可选技术字段时，不得把默认值 `chrome` 当作来源证明。

此前可能已发送网页时，浏览器失焦、标签关闭或切到内部/私密页面须发送 v1 停止通知：`url: "about:blank"`、`incognito: false`，不携带页面标题、图标、实际 URL 或停止原因。技术字段遵循上述同意规则。通知不创建网页记录，只结束同一来源、同一原生会话内尚有效的网页；worker 重启不能丢失尚需停止的状态。

## 忽略或拒绝的输入

以下情况中，Patina 会忽略或拒绝记录：

- token 缺失或无效
- Patina 中 Web Sync 已关闭
- URL 缺失或无效
- URL scheme 不是 `http` 或 `https`
- 浏览器标签页处于 incognito/private 状态

Patina 接收端仍必须保留 incognito/private 忽略逻辑。这是旧扩展、异常客户端或恶意本机客户端的第二道防线；它不能替代新扩展客户端的发送前过滤。

非 HTTP URL 不作为网页记录；符合活动资格的停止通知按上一节处理。

## Response Body

Success response body：

```json
{
  "ok": true,
  "enabled": true,
  "changed": true,
  "serverTimeMs": 1710000000000
}
```

Web Sync disabled 使用 HTTP `409`，response body：

```json
{
  "ok": false,
  "enabled": false,
  "code": "web-recording-disabled",
  "message": "Patina web recording is off.",
  "serverTimeMs": 1710000000000
}
```

Error response body 使用 `ok: false`、稳定的 `code` 和人类可读的 `message`。

扩展客户端只有在 HTTP status 成功且 JSON response body 显式包含 `ok: true` 时，才应把本次同步视为成功。任意非 JSON `2xx` 响应、缺少 `ok: true` 的响应或 `ok: false` 响应都不得显示为已同步。

有效网页请求收到成功响应但 `changed: false` 时，扩展在 1 秒后最多补一次重新确认的观察，以处理聚焦通知早于原生采样的情况。新页面事件取消该次重试，持续拒绝不触发快速重试循环。

## 变更策略

协议变更应优先保证接收端兼容：

1. Patina 同时接收旧客户端和新客户端 shape。
2. Patina Web Sync 开始发送新的 shape。
3. 只有经过单独兼容性决策后，才移除旧兼容。

浏览器商店审核可能让扩展发布慢于 Patina release，因此 Patina 不应要求普通桌面更新必须同日升级扩展。

未发送停止通知的旧扩展依靠原生结束或观察有效期截止。旧接收端能解析停止通知，不代表具备原生会话归属及回溯保证；跨仓验收与发布顺序遵循各仓库的版本与发布政策。
